export function createUpdateChecker({ core, releaseRepo, packageName, packageVersion }) {
  const repoUrl = core.githubRepoUrl(releaseRepo)
  const cacheKey = 'dsh-plugin-pulse.release.v2:' + releaseRepo + ':' + packageVersion
  const hour = 60 * 60 * 1000
  const listeners = new Set()
  let update = null

  function applyVersion(version) {
    const valid = core.isNewerVersion(version, packageVersion) ? version : null
    if (valid === (update?.version ?? null)) return
    update = valid ? { version: valid, url: repoUrl + '/releases/tag/v' + valid } : null
    for (const listener of listeners) listener(update)
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      listener(update)
      return () => listeners.delete(listener)
    },
    start(window) {
      if (!repoUrl || !packageName || !packageVersion) return () => {}
      const controller = new AbortController()
      let nextCheck = 0
      let pending = false
      try {
        const cached = JSON.parse(window.localStorage.getItem(cacheKey))
        const now = Date.now()
        if (cached?.expires > now && cached.expires <= now + hour) {
          nextCheck = cached.expires
          applyVersion(cached.version)
        }
      } catch { /* storage is optional */ }

      async function refresh() {
        if (controller.signal.aborted || pending || Date.now() < nextCheck) return
        pending = true
        nextCheck = Date.now() + 15 * 60 * 1000
        try {
          const response = await window.fetch('https://api.github.com/repos/' + releaseRepo + '/releases?per_page=20', {
            cache: 'no-cache',
            credentials: 'omit',
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)])
          })
          if (!response.ok) return
          const releases = await response.json()
          if (!Array.isArray(releases) || controller.signal.aborted) return
          const version = core.findUpdate(releases, packageVersion, packageName)
          nextCheck = Date.now() + hour
          try { window.localStorage.setItem(cacheKey, JSON.stringify({ version, expires: nextCheck })) }
          catch { /* the in-memory result remains available */ }
          applyVersion(version)
        } catch { /* retry later and retain any known update */ }
        finally { pending = false }
      }

      void refresh()
      window.addEventListener('focus', refresh, { signal: controller.signal })
      const timer = window.setInterval(refresh, 15 * 60 * 1000)
      return () => {
        controller.abort()
        window.clearInterval(timer)
      }
    }
  }
}
