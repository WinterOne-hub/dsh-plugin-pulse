import { readFile, mkdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { openDemand } from '../src/demand.js'

const port = Number(process.env.PULSE_PORT ?? 4173)
const bind = process.env.PULSE_BIND ?? '127.0.0.1'
const origins = new Set((process.env.PULSE_ALLOWED_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean))
const localVoting = process.argv.includes('--local-voting')
const gatewaySecret = process.env.PULSE_GATEWAY_SECRET ?? ''
const voterKey = process.env.PULSE_VOTER_KEY ?? ''
const authenticated = Boolean(gatewaySecret || voterKey)
if (authenticated && (localVoting || gatewaySecret.length < 32 || voterKey.length < 32 || gatewaySecret === voterKey)) {
  throw new Error('Public voting requires two distinct secrets of at least 32 characters and npm run serve')
}
if (localVoting && bind !== '127.0.0.1' && bind !== '::1') throw new Error('Local voting requires a loopback listener')
const voteMode = localVoting ? 'local' : authenticated ? 'authenticated' : 'disabled'
const hash = value => createHash('sha256').update(value).digest()
const expectedGatewaySecret = authenticated ? hash(gatewaySecret) : null
const topics = JSON.parse(await readFile(new URL('../data/topics.json', import.meta.url), 'utf8'))
const dbFile = resolve(process.env.PULSE_DB ?? (localVoting ? '.pulse/demand.sqlite' : '.pulse/public-demand.sqlite'))
await mkdir(dirname(dbFile), { recursive: true, mode: 0o700 })
const store = openDemand(dbFile, topics)
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>插件风向标 · DeepSeek Harness</title>
<style>html{color-scheme:light dark}body{margin:0;background:light-dark(#edf3f5,#12212a)}#app{max-width:1000px;margin:24px auto;padding:0 12px}</style>
<div id="app" data-vote-mode="${voteMode}"></div><script type="module" src="/preview.js"></script></html>`
const buckets = new Map()
const salt = randomBytes(32)
function rateLimited(address) {
  const time = Date.now()
  const key = createHmac('sha256', salt).update(address || 'unknown').digest('hex')
  const entry = buckets.get(key)
  if (entry?.expiry > time) return ++entry.count > 20
  if (buckets.size >= 10000) return true
  buckets.set(key, { count: 1, expiry: time + 600000 })
  return false
}
function authenticatedVoter(headers) {
  const secret = headers['x-pulse-gateway-secret']
  const subject = headers['x-pulse-user']
  if (typeof secret !== 'string' || !timingSafeEqual(hash(secret), expectedGatewaySecret) ||
      typeof subject !== 'string' || !/^[a-zA-Z0-9._:@|-]{1,256}$/.test(subject)) return null
  return createHmac('sha256', voterKey).update(subject).digest('hex')
}
const cleanup = setInterval(() => {
  store.prune()
  for (const [key, entry] of buckets) if (entry.expiry <= Date.now()) buckets.delete(key)
}, 60000)
cleanup.unref()
store.prune()

const server = createServer(async (req, res) => {
  const { origin } = req.headers
  const currentPort = server.address()?.port ?? port
  const loopbackHosts = ['localhost', '127.0.0.1', '[::1]'].map(host => host + ':' + currentPort)
  const localRequest = localVoting && loopbackHosts.includes(req.headers.host)
  const allowOrigin = origin && (origins.has(origin) || (localRequest && loopbackHosts.some(host => origin === 'http://' + host)))
  const send = (code, value, type = 'application/json; charset=utf-8') => {
    res.writeHead(code, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff' })
    res.end(type.startsWith('application/json') ? JSON.stringify(value) : value)
  }
  if (allowOrigin) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    if (authenticated) res.setHeader('Access-Control-Allow-Credentials', 'true')
  }
  res.setHeader('Vary', 'Origin')
  res.setHeader('Cache-Control', 'no-store')
  const path = req.url?.split('?')[0]
  try {
    if (req.method === 'OPTIONS' && path === '/api/votes' && allowOrigin && (authenticated || localRequest)) {
      res.writeHead(204, { 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' })
      return res.end()
    }
    if (req.method === 'GET') {
      if (path === '/') return send(200, html, 'text/html; charset=utf-8')
      if (path === '/api/rankings' || path === '/snapshot.json') {
        res.setHeader('Access-Control-Allow-Origin', '*')
        return send(200, path === '/api/rankings' ? store.rankings()
          : JSON.parse(await readFile(new URL('../dist/snapshot.json', import.meta.url), 'utf8')))
      }
      if (path === '/preview.js') {
        const file = await readFile(new URL('../dist' + path, import.meta.url))
        return send(200, file, 'text/javascript; charset=utf-8')
      }
    }
    if (req.method === 'POST' && path === '/api/votes') {
      if (!authenticated && !localRequest) return send(403, { error: 'Voting is disabled' })
      if (origin && !allowOrigin) return send(403, { error: 'Origin not allowed' })
      if (localVoting && !allowOrigin) return send(403, { error: 'Local browser origin required' })
      const voter = authenticated ? authenticatedVoter(req.headers) : null
      if (authenticated && !voter) return send(401, { error: 'Authentication required' })
      if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) return send(415, { error: 'Expected JSON' })
      if (rateLimited(voter ?? req.socket.remoteAddress)) return send(429, { error: 'Try again later' })
      let size = 0
      const chunks = []
      for await (const chunk of req.iterator({ destroyOnReturn: false })) {
        size += chunk.length
        if (size > 1024) { req.resume(); return send(413, { error: 'Request too large' }) }
        chunks.push(chunk)
      }
      let payload
      try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { return send(400, { error: 'Invalid JSON' }) }
      const expectedFields = authenticated ? 'topic' : 'topic,visitor'
      if (!payload || Object.keys(payload).sort().join(',') !== expectedFields) return send(400, { error: 'Invalid vote' })
      const result = authenticated ? store.voteAuthenticated(payload.topic, voter) : store.vote(payload.topic, payload.visitor)
      return send(result ? 200 : 400, result ?? { error: 'Invalid vote' })
    }
    return send(404, { error: 'Not found' })
  } catch {
    return send(500, { error: 'Service unavailable' })
  }
})
server.requestTimeout = 10000
server.headersTimeout = 10000
server.on('close', () => { clearInterval(cleanup); store.close() })
server.listen(port, bind, () => console.log('插件风向标预览：http://' + (bind.includes(':') ? '[' + bind + ']' : bind) + ':' + server.address().port))
