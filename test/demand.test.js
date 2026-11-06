import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { openDemand } from '../src/demand.js'

test('deduplicates by topic and visitor, publishes only enough recent signals and expires old votes', t => {
  let now = Date.UTC(2026, 10, 6)
  const store = openDemand(':memory:', [{ id: 'voice' }, { id: 'mobile' }], () => now)
  t.after(() => store.close())
  const visitor = randomUUID()
  assert.equal(store.vote('other', visitor), null)
  assert.equal(store.vote('voice', 'arbitrary'), null)
  assert.deepEqual(store.vote('voice', visitor), { added: true })
  assert.deepEqual(store.vote('voice', visitor.toUpperCase()), { added: false })
  assert.deepEqual(store.vote('mobile', visitor), { added: true })
  for (let i = 0; i < 3; i++) store.vote('voice', randomUUID())
  assert.deepEqual(store.rankings().rankings, [])
  store.vote('voice', randomUUID())
  assert.deepEqual(JSON.parse(JSON.stringify(store.rankings().rankings)), [{ topic: 'voice', count: 5 }])
  now += 30 * 86400000
  assert.deepEqual(store.rankings().rankings, [])
  assert.deepEqual(store.vote('voice', visitor), { added: true })
  now += 36 * 86400000
  store.prune()
  assert.deepEqual(store.rankings().rankings, [])
})
