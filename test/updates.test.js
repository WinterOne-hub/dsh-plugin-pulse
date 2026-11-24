import assert from 'node:assert/strict'
import { test } from 'node:test'
import { makeCore } from '../src/core.js'
import { createUpdateChecker } from '../src/updates.js'

function fixture(t) {
  const name = 'dsh-plugin-pulse'
  const checker = createUpdateChecker({
    core: makeCore(), releaseRepo: 'owner/pulse', packageName: name, packageVersion: '0.1.4'
  })
  let state
  t.after(checker.subscribe(value => { state = value }))
  const window = new EventTarget()
  window.setInterval = setInterval
  window.clearInterval = clearInterval
  window.localStorage = {
    getItem: () => JSON.stringify({ expires: Date.now() + 60000, version: '0.1.5' })
  }
  t.after(checker.start(window))
  return { name, checker, state: () => state }
}

test('an update only mutates the profile after a click and coalesces duplicate clicks', async t => {
  const { name, checker, state } = fixture(t)
  let count = 0
  checker.usePluginManager(() => ({
    listBundles: async () => ({ ok: true, value: [{ name, version: '0.1.4', installed: true, enabled: true }] }),
    installBundle: async (url, options) => {
      count++
      assert.equal(url, 'https://github.com/owner/pulse/releases/download/v0.1.5/dsh-plugin-pulse-0.1.5.tgz')
      assert.equal(options.enabled, true)
      assert.match(options.requestId, /^[0-9a-f-]{36}$/)
      assert.equal(options.approvedBuilds, undefined)
      return { ok: true, value: { bundle: name, application: 'restart-required' } }
    }
  }))
  assert.equal(state().phase, 'available')
  assert.equal(count, 0)
  await Promise.all([checker.install(), checker.install()])
  assert.equal(count, 1)
  assert.equal(state().phase, 'restart')
  await checker.install()
  assert.equal(count, 1)
})

test('a failed update can be retried and an already installed version only needs restart', async t => {
  const { name, checker, state } = fixture(t)
  let version = '0.1.4'
  let count = 0
  checker.usePluginManager(() => ({
    listBundles: async () => ({ ok: true, value: [{ name, version, installed: true, enabled: true }] }),
    installBundle: async () => {
      count++
      return { ok: true, value: { application: 'failed' } }
    }
  }))
  await checker.install()
  assert.equal(state().phase, 'error')
  version = '0.1.5'
  await checker.install()
  assert.equal(state().phase, 'restart')
  assert.equal(count, 1)
})

test('manual checks bypass the cached release and can retry a network failure', async t => {
  const name = 'dsh-plugin-pulse'
  const checker = createUpdateChecker({
    core: makeCore(), releaseRepo: 'owner/pulse', packageName: name, packageVersion: '0.1.5'
  })
  const window = new EventTarget()
  window.setInterval = setInterval
  window.clearInterval = clearInterval
  window.localStorage = {
    getItem: () => JSON.stringify({ expires: Date.now() + 60000, version: null }),
    setItem() {}
  }
  let requests = 0
  window.fetch = async (url, options) => {
    assert.equal(options.cache, 'no-store')
    if (url.includes('raw.githubusercontent.com')) return { ok: false }
    requests++
    return {
      ok: requests !== 1,
      json: async () => requests === 2 ? [] : [{
        tag_name: 'v0.1.6', draft: false,
        assets: [{ name: name + '-0.1.6.tgz', state: 'uploaded' }]
      }]
    }
  }
  t.after(checker.start(window))
  assert.equal(requests, 0)
  assert.deepEqual(await Promise.all([checker.check(), checker.check()]), ['error', 'error'])
  assert.equal(requests, 1)
  assert.equal(await checker.check(), 'current')
  assert.equal(await checker.check(), 'available')
})

test('the published index can confirm the current version when the Releases API fails', async t => {
  const checker = createUpdateChecker({
    core: makeCore(), releaseRepo: 'owner/pulse', packageName: 'dsh-plugin-pulse', packageVersion: '0.1.6'
  })
  const window = new EventTarget()
  window.setInterval = setInterval
  window.clearInterval = clearInterval
  window.localStorage = { getItem: () => null, setItem() {} }
  window.fetch = async url => {
    if (url.includes('api.github.com')) throw new Error('Network error')
    assert.equal(url, 'https://raw.githubusercontent.com/owner/pulse/main/data/release.json')
    return { ok: true, json: async () => ({ packageName: 'dsh-plugin-pulse', version: '0.1.6' }) }
  }
  t.after(checker.start(window))
  assert.equal(await checker.check(), 'current')
})
