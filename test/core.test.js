import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { makeCore } from '../src/core.js'

const { day, rank, search, suggest, sumWindow } = makeCore()

test('update notices select the highest published version with an uploaded install package', () => {
  const { findUpdate, isNewerVersion } = makeCore()
  const name = 'dsh-plugin-pulse'
  const release = (version, options = {}) => ({
    tag_name: 'v' + version, draft: false, prerelease: true,
    assets: [{ name: name + '-' + version + '.tgz', state: 'uploaded' }], ...options
  })
  assert.equal(findUpdate([
    release('0.1.9'), release('0.1.10'), release('0.2.0', { assets: [] }),
    release('0.3.0', { draft: true }), release('1.0.0', { assets: [{ name: name + '-1.0.0.tgz', state: 'new' }] })
  ], '0.1.2', name), '0.1.10')
  assert.equal(findUpdate([release('0.1.2'), release('0.1.1')], '0.1.2', name), null)
  assert.equal(isNewerVersion('0.2.0/../issues', '0.1.2'), false)
})

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
const rising = { name: 'new', firstRelease: '2026-10-18', downloadsGrowth: 50, downloads30: 120, downloads7: 80, previousDownloads7: 30, stars: 7, stars7: 3, starsPrevious7: 1 }
const shallow = { name: 'tiny', firstRelease: '2026-11-01', downloadsGrowth: 9, stars: 3 }
const unknown = { name: 'unknown', firstRelease: null, downloadsGrowth: 100, downloads30: 900, stars: null, sharedStars: 9999 }
const future = { name: 'future', firstRelease: '2026-11-05', downloadsGrowth: 100 }
const rows = [old, rising, shallow, unknown, future]

test('public signals stay separate and missing values do not enter rankings', () => {
  assert.deepEqual(rank(rows, 'popular', 'npm', asOf), [unknown, rising])
  assert.deepEqual(rank(rows, 'popular', 'stars', asOf), [rising, old, shallow])
  assert.deepEqual(rank(rows, 'trending', 'npm', asOf), [rising])
  assert.deepEqual(rank(rows, 'trending', 'stars', asOf), [rising])
  assert.deepEqual(rank(rows, 'trending', 'npm', null), [])
})

test('trends balance momentum and scale and keep launches out of rankings', () => {
  const { justReleased, trend } = makeCore()
  const item = (name, downloads7, previousDownloads7, extra = {}) => ({
    name, downloads7, previousDownloads7, firstRelease: '2026-10-01', ...extra
  })
  const established = item('established', 20000, 18000)
  const gaining = item('gaining', 800, 250)
  const sparse = item('sparse', 20, 1)
  const launch = item('launch', 20000, 0, { firstRelease: '2026-11-02' })
  const incomplete = item('incomplete', 800, null)
  const list = [established, gaining, sparse, launch, incomplete]
  assert.deepEqual(rank(list, 'trending', 'npm', asOf), [gaining, established, sparse])
  assert.deepEqual(justReleased(list, asOf), [launch])
  assert.equal(trend({ ...gaining, stars7: 30 }, 'stars', asOf), null)
  assert.equal(trend({ ...gaining, stars: 50, stars7: 30, starsPrevious7: 10 }, 'stars', asOf).delta, 30)
})

test('mature plugins and small positive download gains can enter trends', () => {
  const { trend } = makeCore()
  const row = { name: 'mature', firstRelease: '2026-01-01', downloads7: 20, previousDownloads7: 19 }
  assert.equal(trend(row, 'npm', asOf).delta, 1)
  assert.deepEqual(rank([row], 'trending', 'npm', asOf), [row])
  for (const extra of [
    { downloads7: 19 }, { previousDownloads7: 20 }, { previousDownloads7: 21 },
    { previousDownloads7: null }, { previousDownloads7: -1 }, { firstRelease: null },
    { firstRelease: day(asOf, -13) }, { firstRelease: day(asOf, 1) }
  ]) assert.equal(trend({ ...row, ...extra }, 'npm', asOf), null)
  assert.ok(trend({ ...row, firstRelease: day(asOf, -14) }, 'npm', asOf))
})

test('star trends need one weekly gain and balance volume with relative growth', () => {
  const { trend } = makeCore()
  const row = { name: 'growing', firstRelease: '2026-01-01', stars: 101, stars7: 1 }
  assert.equal(trend(row, 'stars', asOf).delta, 1)
  assert.equal(trend({ ...row, starsPrevious7: 10 }, 'stars', asOf).score,
    trend(row, 'stars', asOf).score)
  for (const extra of [{ stars7: null }, { stars7: 0 }, { stars7: -1 }, { stars: null }, { stars: 0 }]) {
    assert.equal(trend({ ...row, ...extra }, 'stars', asOf), null)
  }
  const tiny = { ...row, name: 'tiny', stars: 1 }
  const gaining = { ...row, name: 'gaining', stars: 100, stars7: 30 }
  const large = { ...row, name: 'large', stars: 10000, stars7: 100 }
  assert.deepEqual(rank([tiny, large, gaining], 'trending', 'stars', asOf), [gaining, large, tiny])
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
