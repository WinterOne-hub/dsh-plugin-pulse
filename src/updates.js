export function createUpdateChecker({ core, releaseRepo, packageName, packageVersion }) {
  const repoUrl = core.githubRepoUrl(releaseRepo)
  const cacheKey = 'dsh-plugin-pulse.release.v2:' + releaseRepo + ':' + packageVersion
  const hour = 60 * 60 * 1000
  const listeners = new Set()
  let update = null
  let getManager

  function publish(value) {
    update = value
    for (const listener of listeners) listener(update)
  }

  function applyVersion(version) {
    const valid = core.isNewerVersion(version, packageVersion) ? version : null
    if (valid === (update?.version ?? null) ||
        update?.phase === 'installing' || update?.phase === 'restart') return
    publish(valid ? { version: valid, url: repoUrl + '/releases/tag/v' + valid, phase: 'available' } : null)
  }

  return {
    usePluginManager(resolveManager) {
      getManager = resolveManager
    },
    async install() {
      if (!update || update.phase === 'installing' || update.phase === 'restart') return
      const candidate = update
      publish({ ...candidate, phase: 'installing' })
      try {
        const manager = getManager?.()
        if (!manager) throw new Error('Plugin manager unavailable')
        const inventory = await manager.listBundles()
        const installed = inventory.ok && inventory.value.find(bundle => bundle.name === packageName)
        if (!installed?.installed || !installed.enabled || installed.readOnlyReason) {
          throw new Error('Installed plugin not editable')
        }
        if (!core.isNewerVersion(candidate.version, installed.version)) {
          if (!core.isNewerVersion(installed.version, packageVersion)) throw new Error('Installed version unknown')
          publish({ ...candidate, phase: 'restart' })
          return
        }
        const tag = 'v' + candidate.version
        const asset = repoUrl + '/releases/download/' + tag + '/' + packageName + '-' + candidate.version + '.tgz'
        const requestId = crypto.randomUUID()
        let result
        try {
          const reply = await manager.installBundle(asset, { enabled: true, requestId })
          if (reply.ok) result = reply.value
        } catch { /* recover through the manager before allowing a retry */ }
        if (!result) {
          const reply = await manager.waitForInstall(requestId)
          if (reply.ok) result = reply.value
        }
        if (result?.bundle !== packageName ||
            !['applied', 'restart-required'].includes(result.application)) throw new Error('Install failed')
        publish({ ...candidate, phase: 'restart' })
      } catch {
        publish({ ...candidate, phase: 'error' })
      }
    },
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
