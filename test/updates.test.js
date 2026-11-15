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
