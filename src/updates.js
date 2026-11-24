export function createUpdateChecker({ core, releaseRepo, packageName, packageVersion }) {
  const repoUrl = core.githubRepoUrl(releaseRepo)
  const cacheKey = 'dsh-plugin-pulse.release.v2:' + releaseRepo + ':' + packageVersion
  const hour = 60 * 60 * 1000
  const listeners = new Set()
  let update = null
  let getManager
  let checkNow

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
    check() {
      return checkNow?.() ?? Promise.resolve('error')
    },
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
      let pending
      try {
        const cached = JSON.parse(window.localStorage.getItem(cacheKey))
        const now = Date.now()
        if (cached?.expires > now && cached.expires <= now + hour) {
          nextCheck = cached.expires
          applyVersion(cached.version)
        }
      } catch { /* storage is optional */ }

      async function fetchRelease(manual) {
        nextCheck = Date.now() + 15 * 60 * 1000
        try {
          const response = await window.fetch('https://api.github.com/repos/' + releaseRepo + '/releases?per_page=20', {
            cache: manual ? 'no-store' : 'no-cache',
            credentials: 'omit',
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)])
          })
          if (!response.ok) return 'error'
          const releases = await response.json()
          if (!Array.isArray(releases) || controller.signal.aborted) return 'error'
          const version = core.findUpdate(releases, packageVersion, packageName)
          nextCheck = Date.now() + hour
          try { window.localStorage.setItem(cacheKey, JSON.stringify({ version, expires: nextCheck })) }
          catch { /* the in-memory result remains available */ }
          applyVersion(version)
          return version ? 'available' : 'current'
        } catch { return 'error' }
      }
      function refresh(manual) {
        if (pending) return pending
        if (controller.signal.aborted || (!manual && Date.now() < nextCheck)) return
        pending = fetchRelease(manual).finally(() => { pending = undefined })
        return pending
      }

      const scheduled = () => { void refresh(false) }
      const check = () => refresh(true)
      checkNow = check
      scheduled()
      window.addEventListener('focus', scheduled, { signal: controller.signal })
      const timer = window.setInterval(scheduled, 15 * 60 * 1000)
      return () => {
        if (checkNow === check) checkNow = undefined
        controller.abort()
        window.clearInterval(timer)
      }
    }
  }
}
