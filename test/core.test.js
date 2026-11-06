import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { makeCore } from '../src/core.js'

const { day, rank, search, suggest, sumWindow } = makeCore()

test('installation uses a matching GitHub root or falls back to the listed package version', () => {
  const { githubRepoUrl, matchesGithubManifest, installTarget } = makeCore()
  const row = { name: '@example/kit', version: '1.2.3', repo: 'example/plugins' }
  const manifest = { name: row.name, version: row.version, dsh: { bundle: { patch: './cordis.patch.yml' } } }
  assert.equal(matchesGithubManifest(manifest, row.name, row.version), true)
  assert.equal(matchesGithubManifest({ ...manifest, private: true }, row.name, row.version), false)
  assert.equal(matchesGithubManifest({ ...manifest, version: '1.2.4' }, row.name, row.version), false)
  assert.equal(installTarget({ ...row, githubInstall: true }), 'https://github.com/example/plugins')
  assert.equal(installTarget(row), '@example/kit@1.2.3')
  assert.equal(githubRepoUrl('example/..'), null)
})

test('snapshot validation rejects malformed remote rows and accepts the bundled catalog', () => {
  const { validSnapshot } = makeCore()
  const snapshot = JSON.parse(readFileSync(new URL('../data/snapshot.json', import.meta.url), 'utf8'))
  assert.equal(validSnapshot(snapshot), true)
  const withRows = (...rows) => ({ ...snapshot, rows })
  const row = snapshot.rows[0]
  assert.equal(validSnapshot(withRows({ ...row, name: 123 }, { ...row, name: 456 })), false)
  assert.equal(validSnapshot(withRows(row, row)), false)
  assert.equal(validSnapshot(withRows({ ...row, firstRelease: '2026-02-31' })), false)
  assert.equal(validSnapshot(withRows({ ...row, downloads30: '1000' })), false)
})
const asOf = '2026-11-04'
const old = { name: 'old', firstRelease: '2026-08-01', downloadsGrowth: 800, stars: 7 }
const rising = { name: 'new', firstRelease: '2026-10-30', downloadsGrowth: 50, downloads30: 120, stars7: 3 }
const shallow = { name: 'tiny', firstRelease: '2026-11-01', downloadsGrowth: 9, stars: 3 }
const unknown = { name: 'unknown', firstRelease: null, downloadsGrowth: 100, downloads30: 900, stars: null, sharedStars: 9999 }
const future = { name: 'future', firstRelease: '2026-11-05', downloadsGrowth: 100 }
const rows = [old, rising, shallow, unknown, future]

test('public signals stay separate and missing values do not enter rankings', () => {
  assert.deepEqual(rank(rows, 'popular', 'npm', asOf), [unknown, rising])
  assert.deepEqual(rank(rows, 'popular', 'stars', asOf), [old, shallow])
  assert.deepEqual(rank(rows, 'trending', 'npm', asOf), [rising])
  assert.deepEqual(rank(rows, 'trending', 'stars', asOf), [rising])
  assert.deepEqual(rank(rows, 'trending', 'npm', null), [])
})

test('counts require every post-release day, with zeros permitted before release', () => {
  const counts = { [asOf]: 8, [day(asOf, -1)]: 0 }
  assert.equal(sumWindow(counts, asOf, 7, day(asOf, -1)), 8)
  assert.equal(sumWindow(counts, asOf, 7, day(asOf, -2)), null)
  assert.equal(sumWindow(counts, asOf, 7, null), null)
})

test('bilingual lookup separates names, normalized terms, and unrelated substrings', () => {
  const list = [{ name: 'dsh-notify', description: '任务完成通知', tags: ['voice'] }, { name: 'dsh-other' }]
  const topics = [{ id: 'voice', label: '语音输入', aliases: ['voice input', '语音', 'rag'] }]
  assert.deepEqual(search(list, '  ＶＯＩＣＥ 通知 '), [list[0]])
  assert.equal(suggest(topics, '实时语音转写')[0].id, 'voice')
  assert.equal(suggest(topics, 'Can I use voice input?')[0].id, 'voice')
  assert.deepEqual(suggest(topics, 'drag'), [])
})
