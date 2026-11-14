import { appendFile, readFile } from 'node:fs/promises'
import { makeCore } from '../src/core.js'

const { githubRepoUrl, matchesGithubManifest } = makeCore()
const seeds = JSON.parse(await readFile(new URL('../data/seeds.json', import.meta.url), 'utf8'))
const known = new Set(seeds.map(row => row.repo.toLowerCase()))
const knownPackages = new Set(seeds.map(row => row.name))
const token = process.env.GITHUB_TOKEN
const headers = { Accept: 'application/vnd.github+json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }
const query = new URLSearchParams({ q: 'topic:dsh-plugin fork:false archived:false', sort: 'updated', per_page: '30' })
const searchResponse = await fetch('https://api.github.com/search/repositories?' + query, {
  headers, signal: AbortSignal.timeout(15000)
})
if (!searchResponse.ok) throw new Error('GitHub discovery returned HTTP ' + searchResponse.status)
const { items } = await searchResponse.json()
if (!Array.isArray(items)) throw new Error('Unexpected GitHub discovery response')

async function json(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) })
  return response.ok ? response.json() : null
}

async function verify(repo) {
  if (!githubRepoUrl(repo)) return null
  try {
    const root = await json('https://raw.githubusercontent.com/' + repo + '/HEAD/package.json')
    if (!root || typeof root.name !== 'string' ||
        !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(root.name) ||
        knownPackages.has(root.name) || !matchesGithubManifest(root, root.name, root.version)) return null
    const latest = await json('https://registry.npmjs.org/' + encodeURIComponent(root.name) + '/latest')
    if (!latest || latest.deprecated || !matchesGithubManifest(latest, root.name, latest.version)) return null
    if (typeof latest.version !== 'string' || !/^[a-z0-9.+-]+$/i.test(latest.version)) return null
    const npmRepo = (typeof latest.repository === 'string' ? latest.repository : latest.repository?.url) ?? ''
    if (typeof npmRepo !== 'string') return null
    const normalizedRepo = npmRepo.toLowerCase().replace(/^git\+/, '').replace(/\.git\/?$/, '').replace(/\/$/, '')
    if (normalizedRepo !== githubRepoUrl(repo).toLowerCase()) return null
    return { repo, name: root.name, version: latest.version }
  } catch { return null }
}

const repos = items.map(item => item.full_name).filter(repo => typeof repo === 'string' && !known.has(repo.toLowerCase()))
const candidates = []
for (let i = 0; i < repos.length; i += 5) {
  for (const candidate of await Promise.all(repos.slice(i, i + 5).map(verify))) {
    if (!candidate || knownPackages.has(candidate.name)) continue
    candidates.push(candidate)
    knownPackages.add(candidate.name)
  }
}

const summary = [
  '### New DSH plugin candidates',
  '',
  candidates.length
    ? 'The GitHub root and published npm metadata both declare a DSH bundle. Review the install source and add a bilingual summary before listing.'
    : 'No unlisted candidates matched in the repositories checked.',
  ...candidates.map(item => '- [' + item.repo + '](' + githubRepoUrl(item.repo) + ') · `' + item.name + '@' + item.version + '`'),
  ''
].join('\n')
console.log(summary)
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary)
