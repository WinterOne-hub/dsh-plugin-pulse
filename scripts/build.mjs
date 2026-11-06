import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { makeCore } from '../src/core.js'
import { mountPulse } from '../src/ui.js'

const file = path => new URL('../' + path, import.meta.url)
const read = path => readFile(file(path), 'utf8')
function url(key) {
  const value = process.env[key]
  if (!value) return ''
  const parsed = new URL(value)
  if (parsed.username || parsed.password || parsed.hash || (parsed.protocol !== 'https:' &&
      !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)))) {
    throw new Error(key + ' must be HTTPS or a loopback HTTP URL')
  }
  if (key === 'PULSE_DEMAND_URL' && parsed.search) throw new Error(key + ' must not have a query string')
  return parsed.href
}
const [raw, topics, css] = await Promise.all([
  read('data/snapshot.json').catch(err => {
    if (err.code !== 'ENOENT') throw err
    return JSON.stringify({ schema: 1, generatedAt: null, npmDay: null, snapshotDay: null, rows: [] })
  }),
  read('data/topics.json'), read('src/pulse.css')
])
const snapshot = JSON.parse(raw)
if (snapshot.generatedAt !== null && !makeCore().validSnapshot(snapshot)) throw new Error('Invalid bundled snapshot')
const options = JSON.stringify({
  snapshot, topics: JSON.parse(topics), css,
  demandUrl: url('PULSE_DEMAND_URL'), demandAuthenticated: process.env.PULSE_DEMAND_AUTHENTICATED === '1',
  snapshotUrl: url('PULSE_SNAPSHOT_URL'), issueUrl: url('PULSE_ISSUE_URL')
})
const shared = `const makeCore = ${makeCore.toString()};
const mountPulse = ${mountPulse.toString()};
const options = ${options};`
const loader = `window.__ModuleLoader__.load({
  id: 'dsh-plugin-pulse',
  factory: (require) => {
    const { createElement, useEffect, useRef } = require('react');
    ${shared}
    function Panel() {
      const target = useRef(null);
      useEffect(() => mountPulse(target.current, { ...options, core: makeCore(), profile: 'dshDesktop' in globalThis ? 'desktop' : 'web' }), []);
      return createElement('div', { ref: target });
    }
    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'dsh-plugin-pulse',
          order: 65,
          label: () => '插件风向标'
        }, Panel));
      }
    };
  }
});\n`
await mkdir(file('dist/'), { recursive: true })
await Promise.all([
  writeFile(file('dist/client.js'), loader),
  writeFile(file('dist/preview.js'), shared + `
const root = document.querySelector('#app');
const mode = root.dataset.voteMode;
mountPulse(root, { ...options, core: makeCore(), demandUrl: mode === 'disabled' ? '' : '/api', demandAuthenticated: mode === 'authenticated' });\n`),
  writeFile(file('dist/snapshot.json'), raw)
])
console.log('Built Harness client and local preview.')
