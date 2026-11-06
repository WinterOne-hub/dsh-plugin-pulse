import { readFile, rename, writeFile } from 'node:fs/promises'
import { makeCore } from '../src/core.js'

const { day, sumWindow, validSnapshot, githubRepoUrl, matchesGithubManifest } = makeCore()
const location = name => new URL('../data/' + name, import.meta.url)
const seeds = JSON.parse(await readFile(location('seeds.json'), 'utf8'))
const read = async (file, fallback) => {
  try { return JSON.parse(await readFile(location(file), 'utf8')) }
  catch (err) { if (err.code !== 'ENOENT') throw err; return fallback }
}
const previous = await read('snapshot.json', { rows: [] })
const history = await read('stars.json', {})
const now = new Date().toISOString()
const snapshotDay = now.slice(0, 10)
const npmDay = day(now, -2)
const token = process.env.GITHUB_TOKEN
const failures = []
const githubRequests = new Map()
let nextDownloadAt = 0
async function npmDownloads(url) {
  const start = Math.max(Date.now(), nextDownloadAt)
  nextDownloadAt = start + 2200
  await new Promise(resolve => setTimeout(resolve, Math.max(0, start - Date.now())))
  return request(url)
}

async function request(url, options = {}) {
  for (let attempt = 0; ; attempt++) {
    let response
    try {
      response = await fetch(url, { ...options, signal: AbortSignal.timeout(15000) })
    } catch (err) {
      if (attempt === 2) throw err
      await new Promise(resolve => setTimeout(resolve, 350 * (2 ** attempt)))
      continue
    }
    if (response.ok) return response.json()
    if (attempt === 2 || (response.status < 500 && response.status !== 429)) {
      throw new Error('HTTP ' + response.status)
    }
    const wait = Number(response.headers.get('retry-after'))
    if (wait > 10) throw new Error('HTTP ' + response.status + ' (retry later)')
    await new Promise(resolve => setTimeout(resolve, wait ? wait * 1000 : 500 * (2 ** attempt)))
  }
}

function github(repo) {
  const key = repo.toLowerCase()
  if (!githubRequests.has(key)) githubRequests.set(key,
    request('https://api.github.com/repos/' + repo, {
      headers: { Accept: 'application/vnd.github+json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }
    }).catch(err => { failures.push('GitHub ' + repo + ': ' + err.message); return null }))
  return githubRequests.get(key)
}

async function githubInstallable(repo, name, version) {
  if (!githubRepoUrl(repo)) return false
  try {
    const response = await fetch('https://raw.githubusercontent.com/' + repo + '/HEAD/package.json', {
      signal: AbortSignal.timeout(10000)
    })
    return response.ok && matchesGithubManifest(await response.json(), name, version)
  } catch { return false }
}

async function collect({ name, category, repo, description, descriptionEn, sharedStars = false }) {
  const encoded = encodeURIComponent(name)
  const old = previous.rows.find(row => row.name === name)
  let pkg
  try { pkg = await request('https://registry.npmjs.org/' + encoded) }
  catch (err) {
    failures.push('npm metadata ' + name + ': ' + err.message)
    if (!old) return null
    return { ...old, title: name, description, descriptionEn, category, repo, tags: [], githubInstall: false,
      ...(previous.snapshotDay === snapshotDay ? {} : { stars: null, sharedStars: null, stars7: null }),
      ...(previous.npmDay === npmDay ? {} : { downloads30: null, downloads7: null, previousDownloads7: null, downloadsGrowth: null })
    }
  }
  const latest = pkg.versions?.[pkg['dist-tags']?.latest]
  if (!latest?.dsh?.bundle || latest.private || latest.deprecated) {
    failures.push('Excluded ' + name + ': latest release does not declare an active DSH bundle')
    return null
  }
  const bundleDates = Object.entries(pkg.versions).filter(([, version]) => version.dsh?.bundle)
    .map(([version]) => pkg.time?.[version]).filter(value => typeof value === 'string').sort()
  const firstRelease = bundleDates[0]?.slice(0, 10) ?? null
  const currentDownloads = previous.npmDay === npmDay && old?.downloads30 != null
  const [download, repository, githubInstall] = await Promise.all([
    currentDownloads ? null : npmDownloads('https://api.npmjs.org/downloads/range/' + day(npmDay, -29) + ':' + npmDay + '/' + encoded)
      .catch(err => { failures.push('npm downloads ' + name + ': ' + err.message); return null }),
    github(repo),
    githubInstallable(repo, name, latest.version)
  ])
  const counts = Object.fromEntries((download?.downloads ?? []).map(entry => [entry.day, entry.downloads]))
  const downloads30 = currentDownloads ? old.downloads30 : download ? sumWindow(counts, npmDay, 30, firstRelease) : null
  const downloads7 = currentDownloads ? old.downloads7 : download ? sumWindow(counts, npmDay, 7, firstRelease) : null
  const previousDownloads7 = currentDownloads ? old.previousDownloads7 : download ? sumWindow(counts, day(npmDay, -7), 7, firstRelease) : null
  const stars = Number.isSafeInteger(repository?.stargazers_count) && !repository.fork ? repository.stargazers_count : null
  const repoHistory = repository?.id ? (history[repository.id] ??= {}) : {}
  if (stars !== null) repoHistory[snapshotDay] = stars
  const baseline = repoHistory[day(snapshotDay, -7)]
  return {
    name, title: name, description, descriptionEn, category, tags: [],
    repo, githubInstall, version: latest.version, engines: typeof latest.engines?.dsh === 'string' ? latest.engines.dsh.slice(0, 250) : null, firstRelease,
    downloads30, downloads7, previousDownloads7,
    downloadsGrowth: downloads7 === null || previousDownloads7 === null ? null : downloads7 - previousDownloads7,
    stars: sharedStars ? null : stars ?? (previous.snapshotDay === snapshotDay ? old?.stars ?? null : null),
    sharedStars: sharedStars ? stars ?? (previous.snapshotDay === snapshotDay ? old?.sharedStars ?? null : null) : null,
    stars7: sharedStars ? null : stars !== null && Number.isSafeInteger(baseline) ? stars - baseline
      : previous.snapshotDay === snapshotDay ? old?.stars7 ?? null : null
  }
}

const rows = []
for (let i = 0; i < seeds.length; i += 5) rows.push(...await Promise.all(seeds.slice(i, i + 5).map(collect)))
const valid = rows.filter(Boolean)
if (!valid.some(row => row.downloads30 !== null || row.stars !== null || row.sharedStars !== null)) {
  throw new Error('No live metrics; existing snapshot preserved. ' + failures.join(' | '))
}
for (const repoHistory of Object.values(history)) {
  for (const date of Object.keys(repoHistory)) if (date < day(snapshotDay, -35)) delete repoHistory[date]
}
const snapshot = { schema: 1, generatedAt: now, npmDay, snapshotDay, rows: valid }
if (!validSnapshot(snapshot)) throw new Error('Invalid catalog snapshot; existing snapshot preserved.')
for (const [name, data] of [['stars.json', history], ['snapshot.json', snapshot]]) {
  const next = location(name + '.tmp')
  await writeFile(next, JSON.stringify(data, null, 2) + '\n')
  await rename(next, location(name))
}
console.log('Collected ' + valid.length + ' verified npm bundles; ' + failures.length + ' warnings.')
if (failures.length) console.warn(failures.join('\n'))
