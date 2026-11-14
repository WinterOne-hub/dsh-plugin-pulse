import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { makeCore } from '../src/core.js'
import { mountPulse } from '../src/ui.js'
import { createUpdateChecker } from '../src/updates.js'

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
const [raw, topics, css, manifest] = await Promise.all([
  read('data/snapshot.json').catch(err => {
    if (err.code !== 'ENOENT') throw err
    return JSON.stringify({ schema: 1, generatedAt: null, npmDay: null, snapshotDay: null, rows: [] })
  }),
  read('data/topics.json'), read('src/pulse.css'), read('package.json').then(JSON.parse)
])
const snapshot = JSON.parse(raw)
if (snapshot.generatedAt !== null && !makeCore().validSnapshot(snapshot)) throw new Error('Invalid bundled snapshot')
const repository = new URL(manifest.repository.url.replace(/^git\+/, ''))
const releaseRepo = repository.hostname === 'github.com' ? repository.pathname.slice(1).replace(/\.git$/, '') : ''
const defaultSnapshotUrl = releaseRepo ? 'https://raw.githubusercontent.com/' + releaseRepo + '/main/data/snapshot.json' : ''
const options = JSON.stringify({
  snapshot, topics: JSON.parse(topics), css,
  packageName: manifest.name, packageVersion: manifest.version,
  releaseRepo,
  demandUrl: url('PULSE_DEMAND_URL'), demandAuthenticated: process.env.PULSE_DEMAND_AUTHENTICATED === '1',
  snapshotUrl: process.env.PULSE_SNAPSHOT_URL === undefined ? defaultSnapshotUrl : url('PULSE_SNAPSHOT_URL'), issueUrl: url('PULSE_ISSUE_URL')
})
const shared = `const makeCore = ${makeCore.toString()};
const mountPulse = ${mountPulse.toString()};
const options = ${options};
const core = makeCore();
const updates = (${createUpdateChecker.toString()})({ ...options, core });`
const loader = `window.__ModuleLoader__.load({
  id: 'dsh-plugin-pulse',
  factory: (require) => {
    const { createElement, useEffect, useRef, useState } = require('react');
    const { Toast } = require('@deepseek-ai/dsh-client-ui-primitives');
    ${shared}
    const panelId = 'dsh-plugin-pulse';
    function PulseIcon({ size = 18 }) {
      return createElement('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
        strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true
      }, createElement('path', { d: 'M4 19h16M6 15v-3m6 3V8m6 7V4' }));
    }
    function Panel({ openPluginManager }) {
      const target = useRef(null);
      useEffect(() => mountPulse(target.current, { ...options, core, updates, openPluginManager }), [openPluginManager]);
      return createElement('section', { style: { height: '100%', overflowY: 'auto', padding: 'clamp(8px, 2vw, 24px)' } },
        createElement('div', { ref: target, style: { maxWidth: 1050, margin: '0 auto' } }));
    }
    let notifiedVersion;
    function UpdateNotice() {
      const [notice, setNotice] = useState(null);
      useEffect(() => {
        const unsubscribe = updates.subscribe(update => {
          if (!update || notifiedVersion === update.version) return;
          notifiedVersion = update.version;
          setNotice(update);
        });
        const stop = updates.start(window);
        return () => { unsubscribe(); stop(); };
      }, []);
      if (!notice) return null;
      const close = () => setNotice(null);
      return createElement(Toast, {
        key: notice.version,
        text: '插件风向标 v' + notice.version + ' 可用',
        holdMs: 12000,
        actions: [
          { label: '查看更新', onClick: () => { window.open(notice.url, '_blank', 'noopener,noreferrer'); close(); } },
          { label: '稍后', onClick: close }
        ],
        onDone: close
      });
    }
    return {
      inject: ['slots', 'layout'],
      apply(ctx) {
        const openPluginManager = () => ctx.layout.selectPanel('plugins');
        const MainPanel = () => createElement(Panel, { openPluginManager });
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay', id: 'dsh-plugin-pulse.update-notice'
        }, UpdateNotice));
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: panelId }, MainPanel));
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: panelId, order: 5, label: '插件风向标'
        }, PulseIcon));
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
updates.start(window);
mountPulse(root, { ...options, core, updates, demandUrl: mode === 'disabled' ? '' : '/api', demandAuthenticated: mode === 'authenticated' });\n`),
  writeFile(file('dist/snapshot.json'), raw)
])
console.log('Built Harness client and local preview.')
