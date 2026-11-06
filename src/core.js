export function makeCore() {
  const DAY = 86400000
  const normalize = value => String(value ?? '').normalize('NFKC').toLowerCase().trim()
  const day = (date, offset = 0) => new Date(Date.parse(date) + offset * DAY).toISOString().slice(0, 10)
  const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && day(value) === value
  const boundedText = (value, limit) => typeof value === 'string' && value.length <= limit
  const validCount = value => value === null || (Number.isSafeInteger(value) && value >= 0)
  const validChange = value => value === null || Number.isSafeInteger(value)
  function githubRepoUrl(repo) {
    if (typeof repo !== 'string' || !/^[a-z0-9-]+\/(?!\.{1,2}$)[a-z0-9_.-]+$/i.test(repo)) return null
    return 'https://github.com/' + repo
  }
  const matchesGithubManifest = (manifest, name, version) => Boolean(manifest?.dsh?.bundle &&
    manifest.private !== true && manifest.name === name && manifest.version === version)
  const installTarget = row => (row.githubInstall && githubRepoUrl(row.repo)) || row.name + '@' + row.version
  function validSnapshot(snapshot) {
    if (snapshot?.schema !== 1 || !validDate(snapshot.npmDay) || !validDate(snapshot.snapshotDay) ||
        snapshot.npmDay > snapshot.snapshotDay || !boundedText(snapshot.generatedAt, 24) ||
        !Number.isFinite(Date.parse(snapshot.generatedAt)) || new Date(snapshot.generatedAt).toISOString() !== snapshot.generatedAt ||
        !Array.isArray(snapshot.rows) || !snapshot.rows.length || snapshot.rows.length > 5000) return false
    const names = new Set()
    for (const row of snapshot.rows) {
      if (!row || !boundedText(row.name, 214) || !/^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/.test(row.name) || names.has(row.name) ||
          !boundedText(row.title, 214) || !boundedText(row.description, 250) || !boundedText(row.category, 80) ||
          !(row.descriptionEn === undefined || boundedText(row.descriptionEn, 250)) ||
          !Array.isArray(row.tags) || row.tags.length > 20 || !row.tags.every(tag => boundedText(tag, 128)) ||
          !boundedText(row.repo, 140) || !githubRepoUrl(row.repo) ||
          !(row.githubInstall === undefined || typeof row.githubInstall === 'boolean') ||
          !boundedText(row.version, 128) || !/^[a-z0-9.+-]+$/i.test(row.version) ||
          !(row.engines === null || boundedText(row.engines, 250)) || !(row.firstRelease === null || validDate(row.firstRelease)) ||
          ![row.downloads30, row.downloads7, row.previousDownloads7, row.stars, row.sharedStars].every(validCount) ||
          ![row.downloadsGrowth, row.stars7].every(validChange)) return false
      names.add(row.name)
    }
    return true
  }
  const search = (rows, query) => {
    const terms = normalize(query).split(/\s+/).filter(Boolean)
    return rows.filter(row => {
      const corpus = normalize([row.name, row.title, row.description, row.descriptionEn, row.category, ...(row.tags ?? [])].join(' '))
      return terms.every(term => corpus.includes(term))
    })
  }
  function suggest(topics, query) {
    const q = normalize(query)
    if (!q) return []
    return topics.map(topic => ({
      topic,
      score: Math.max(0, ...[topic.label, ...topic.aliases].map(normalize).map(alias =>
        q === alias ? 100 + alias.length : (/[\u3400-\u9fff]/u.test(alias)
          ? q.includes(alias)
          : (' ' + q.replace(/[^\p{L}\p{N}]+/gu, ' ') + ' ').includes(' ' + alias + ' ')) ? alias.length : 0))
    })).filter(entry => entry.score > 0).sort((a, b) => b.score - a.score).map(entry => entry.topic)
  }
  const sortBy = (rows, key) => rows.filter(row => Number.isFinite(row[key]))
    .sort((a, b) => b[key] - a[key] || a.name.localeCompare(b.name, 'en'))
  function rank(rows, tab, metric, asOf) {
    if (tab === 'popular') {
      return sortBy(rows, metric === 'stars' ? 'stars' : 'downloads30')
    }
    if (!asOf) return []
    const key = metric === 'stars' ? 'stars7' : 'downloadsGrowth'
    const cutoff = day(asOf, -59)
    return sortBy(rows.filter(row => row.firstRelease && row.firstRelease >= cutoff &&
      row.firstRelease <= asOf && row[key] >= (metric === 'stars' ? 1 : 10)), key)
  }
  function sumWindow(counts, end, width, firstRelease) {
    let sum = 0
    for (let i = 0; i < width; i++) {
      const date = day(end, -i)
      const count = counts[date]
      if (Number.isSafeInteger(count) && count >= 0) sum += count
      else if (!firstRelease || date >= firstRelease) return null
    }
    return sum
  }
  return { day, search, suggest, rank, sumWindow, validSnapshot, githubRepoUrl, matchesGithubManifest, installTarget }
}
