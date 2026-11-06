export function mountPulse(root, { core, snapshot, topics, demandUrl = '', demandAuthenticated = false, snapshotUrl = '', issueUrl = '', css, openPluginManager }) {
  const doc = root.ownerDocument
  const host = root.shadowRoot ?? root.attachShadow({ mode: 'open' })
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c])
  const pretty = new Intl.NumberFormat('zh-CN')
  const fmt = value => Number.isSafeInteger(value) ? pretty.format(value) : '—'
  const tabs = { popular: '最受欢迎', trending: '新插件飙升', demand: '最期待功能' }
  const tabNames = { popular: 'popular', trending: 'trending', demand: 'requests' }
  const intros = {
    popular: ['插件热度', '按公开下载量或 GitHub Stars 排序。'],
    trending: ['新插件增长', '仅统计最近 60 天首次发布的插件。'],
    demand: ['功能需求', '没找到合适的插件？告诉我们你需要什么功能。']
  }
  const state = { tab: 'popular', metric: 'npm', query: '', category: '', report: false, counts: [], status: '', busy: false, loadError: false }
  let disposed = false
  const abort = new AbortController()
  const style = doc.createElement('style')
  style.textContent = css
  const app = doc.createElement('main')
  app.className = 'pulse'
  host.append(style, app)
  app.innerHTML = `
    <header class="console">
      <div class="console-bar"><span class="brand"><span class="console-icon" aria-hidden="true">&gt;_</span> dsh / plugin-pulse</span><span class="catalog-size"></span></div>
      <div class="console-body">
        <h1>插件风向标</h1>
        <div class="search">
          <div class="command"><span aria-hidden="true" class="prompt">$</span><label class="sr-only" for="pulse-search">搜插件</label><input id="pulse-search" type="search" maxlength="120" spellcheck="false" placeholder="搜索插件名或功能"><button class="search-key" type="button" data-action="search" aria-label="聚焦插件搜索" aria-keyshortcuts="/" title="在此面板按 / 聚焦搜索"><kbd>/</kbd></button></div>
          <button class="primary" type="button" data-action="report"><span aria-hidden="true">+</span> 提需求</button>
        </div>
      </div>
    </header>
    <nav aria-label="榜单">${Object.entries(tabs).map(([key, label]) => `<button type="button" data-tab="${key}">${label}<small aria-hidden="true">${tabNames[key]}</small></button>`).join('')}</nav>
    <div class="toolbar">
      <label>分类 <select id="pulse-category"><option value="">全部分类</option></select></label>
      <label>指标 <select id="pulse-metric"><option value="npm">npm 下载</option><option value="stars">GitHub Stars</option></select></label>
    </div>
    <div id="pulse-report" hidden></div>
    <section id="pulse-results" aria-label="榜单内容"></section>
    <p class="status" role="status"></p>
    <footer><span>公开数据：<a href="https://docs.github.com/en/rest/activity/starring" target="_blank" rel="noreferrer">GitHub</a> · <a href="https://github.com/npm/registry/blob/main/docs/download-counts.md" target="_blank" rel="noreferrer">npm</a></span><span>社区项目 · 非 DeepSeek 官方榜单</span></footer>
  `
  const input = app.querySelector('input')
  const category = app.querySelector('#pulse-category')
  const metric = app.querySelector('#pulse-metric')
  const results = app.querySelector('#pulse-results')
  const report = app.querySelector('#pulse-report')
  const status = app.querySelector('.status')
  const notify = message => { if (!disposed) status.textContent = message }
  const validName = /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/
  function installActions(row) {
    const repoUrl = core.githubRepoUrl(row.repo)
    const copy = repoUrl ? `<button type="button" class="quiet" data-copy="${escape(repoUrl)}" aria-label="复制 ${escape(row.name)} 的 GitHub 地址">复制 GitHub 地址</button>` : ''
    if (!openPluginManager || !validName.test(row.name) || !/^[a-z0-9.+-]+$/i.test(row.version)) return copy
    const target = core.installTarget(row)
    const label = target === repoUrl ? '复制 GitHub 地址' : '复制包名和版本'
    return `<button type="button" class="quiet" data-install="${escape(target)}" aria-label="去安装 ${escape(row.name)}" title="${label}，打开插件管理器">去安装 ↗</button>${copy}`
  }
  const rowLink = row => core.githubRepoUrl(row.repo) ?? 'https://www.npmjs.com/package/' + row.name
  const gridHead = (label, field = '插件') => `<div class="grid-head" aria-hidden="true"><span>#</span><span>${field}</span><span>${label} ↓</span></div>`
  const rowMarkup = (row, rank, value, caption, note = '') => `
    <li class="row">
      <span class="position">${rank === null ? '·' : String(rank).padStart(2, '0')}</span>
      <div class="row-main"><div class="row-title"><a href="${escape(rowLink(row))}" target="_blank" rel="noreferrer">${escape(row.title || row.name)}</a><span class="tag">${escape(row.category)}</span></div>
        <p lang="zh-CN">${escape(row.description)}</p>${row.descriptionEn ? `<p lang="en">${escape(row.descriptionEn)}</p>` : ''}<div class="row-meta"><span class="meta">v${escape(row.version)} ${row.engines ? ' · DSH ' + escape(row.engines) : ''} ${note ? ' · ' + escape(note) : ''}</span>
        ${installActions(row)}</div>
      </div>
      <div class="metric"><strong>${escape(value)}</strong><small>${escape(caption)}</small></div>
    </li>`
  function hydrateCategories() {
    app.querySelector('.catalog-size').textContent = fmt(snapshot.rows.length) + ' packages'
    const values = [...new Set(snapshot.rows.map(row => row.category))].sort((a, b) => a.localeCompare(b, 'zh'))
    if (!values.includes(state.category)) state.category = ''
    category.replaceChildren(new Option('全部分类', ''), ...values.map(value => new Option(value, value)))
    category.value = state.category
  }
  function renderReport() {
    report.hidden = !state.report
    app.querySelector('[data-action=report]').setAttribute('aria-expanded', String(state.report))
    if (!state.report) return
    const suggestions = core.suggest(topics, state.query)
    const choices = [...suggestions, ...topics.filter(t => !suggestions.includes(t))]
    report.innerHTML = `<form class="report-box">
      <h3>提交功能需求</h3>
      <label>功能主题<select name="topic" required>
        <option value="">请选择</option>
        ${choices.map(topic => `<option value="${escape(topic.id)}" ${topic === suggestions[0] ? 'selected' : ''}>${escape(topic.label)}</option>`).join('')}
      </select></label>
      <div class="report-actions"><button type="submit" ${demandUrl && !state.busy ? '' : 'disabled'}>确认提交</button><button type="button" class="quiet" data-action="close">取消</button></div>
      ${!demandUrl ? '<p>暂时无法提交需求。</p>' : ''}
      ${issueUrl ? `<p>没有对应主题？<a href="${escape(issueUrl)}" target="_blank" rel="noreferrer">到 GitHub 提议新主题（公开）</a></p>` : ''}
    </form>`
  }
  function render() {
    const { tab, query, metric: chosen } = state
    for (const button of app.querySelectorAll('[data-tab]')) button.setAttribute('aria-pressed', String(button.dataset.tab === tab))
    app.querySelector('.toolbar').hidden = tab === 'demand'
    let markup = `<header class="section-head"><div><h2>${intros[tab][0]}</h2><p>${intros[tab][1]}</p></div>`
    if (tab === 'demand') {
      markup += '<span class="pill">最近 30 天</span></header>'
      const matched = query.trim() ? core.suggest(topics, query) : topics
      const rows = state.counts.filter(row => matched.some(topic => topic.id === row.topic))
      if (!rows.length) markup += `<div class="empty"><h3>${!demandUrl ? '需求榜暂未开放' : state.loadError ? '暂时无法加载需求榜' : state.counts.length && query.trim() ? '没有匹配的需求' : '暂时没有上榜需求'}</h3></div>`
      else markup += gridHead('提交数', '主题') + '<ol>' + rows.map(row => `<li class="row"><span class="position">${String(state.counts.indexOf(row) + 1).padStart(2, '0')}</span><div class="row-main"><strong>${escape(matched.find(t => t.id === row.topic).label)}</strong></div><div class="metric"><strong>${fmt(row.count)}</strong><small>次提交</small></div></li>`).join('') + '</ol>'
      const quick = matched.length ? matched : topics
      markup += '<div class="topics"><h3>我也需要</h3><div>' + quick.map(topic => `<button data-topic="${escape(topic.id)}">${escape(topic.label)}</button>`).join('') + '</div></div>'
    } else {
      const date = chosen === 'npm' ? snapshot.npmDay : snapshot.snapshotDay
      const filtered = core.search(snapshot.rows.filter(row => !state.category || row.category === state.category), query)
      const ranked = core.rank(filtered, tab, chosen, date)
      const dateText = date ? '数据截至 ' + date + ' UTC' : '等待首份数据'
      const old = date && Date.now() - Date.parse(date) > 4 * 86400000
      markup += `<span class="pill">${escape(dateText + (old ? ' · 可能滞后' : ''))}</span></header>`
      const rankingRows = ranked.map((row, index) => {
        if (tab === 'popular') return rowMarkup(row, index + 1, fmt(chosen === 'npm' ? row.downloads30 : row.stars), chosen === 'npm' ? '近 30 天下载' : '仓库 Stars')
        return rowMarkup(row, index + 1, '+' + fmt(chosen === 'npm' ? row.downloadsGrowth : row.stars7),
          chosen === 'npm' ? '近 7 天相对前 7 天' : '近 7 天 Stars 净增',
          (row.firstRelease ? 'npm 首发 ' + row.firstRelease : '') +
          (chosen === 'npm' ? ' · 下载 ' + fmt(row.previousDownloads7) + ' → ' + fmt(row.downloads7) : ''))
      })
      if (rankingRows.length) markup += gridHead(tab === 'popular' ? (chosen === 'npm' ? '下载 / 30d' : 'Stars') : '净增 / 7d') + '<ol>' + rankingRows.join('') + '</ol>'
      else markup += `<div class="empty"><h3>${!filtered.length && query.trim() ? '没找到合适的插件' : '当前没有符合条件的插件'}</h3><p>试试换个关键词、分类或指标。</p>${query.trim() ? '<button data-action="report">我需要这个功能</button>' : ''}</div>`
      if (tab === 'popular' || query.trim()) {
        const unranked = filtered.filter(row => !ranked.includes(row))
        if (unranked.length) markup += `<h3 class="subhead">${tab === 'popular' && chosen === 'stars' ? '仓库级指标及暂无 Stars 的条目' : '其他目录条目'}</h3><ul>` + unranked.map(row =>
          rowMarkup(row, null, chosen === 'stars' && tab === 'popular' ? fmt(row.sharedStars) : '—',
            chosen === 'stars' && tab === 'popular' && Number.isFinite(row.sharedStars) ? '共享仓库 Stars' : '未参与此榜')).join('') + '</ul>'
      }
      if (filtered.length && query.trim()) markup += '<div class="topics"><button data-action="report">这些插件不满足需求</button></div>'
    }
    results.innerHTML = markup
  }
  function openReport(topic) {
    state.report = true
    renderReport()
    const select = report.querySelector('select')
    if (topic) select.value = topic
    select.focus()
  }
  const api = part => demandUrl.replace(/\/$/, '') + part
  async function loadDemand() {
    if (!demandUrl) return
    try {
      const response = await fetch(api('/rankings'), { signal: abort.signal, credentials: 'omit' })
      if (!response.ok) throw new Error('request failed')
      const { rankings } = await response.json()
      if (!Array.isArray(rankings)) throw new Error('invalid data')
      state.counts = rankings.filter(row => row && topics.some(topic => topic.id === row.topic) && Number.isSafeInteger(row.count) && row.count >= 5)
      state.loadError = false
    } catch { state.loadError = true }
    if (!disposed && state.tab === 'demand') render()
  }
  function identity() {
    const key = 'dsh-plugin-pulse.demand.v1'
    const now = Date.now()
    let stored
    try { stored = JSON.parse(localStorage.getItem(key)) } catch {}
    if (stored && typeof stored.id === 'string' && now - stored.created < 30 * 86400000) return stored.id
    const id = crypto.randomUUID()
    localStorage.setItem(key, JSON.stringify({ id, created: now }))
    return id
  }
  app.addEventListener('click', async event => {
    const button = event.target.closest('button')
    if (!button) return
    const { tab, topic, action, copy, install } = button.dataset
    if (tab) { state.tab = tab; render(); if (tab === 'demand') void loadDemand() }
    if (topic || action === 'report') openReport(topic)
    if (action === 'search') input.focus()
    if (action === 'close') { state.report = false; renderReport(); app.querySelector('[data-action=report]').focus() }
    const value = install || copy
    if (value) {
      try {
        await navigator.clipboard.writeText(value)
        if (disposed) return
        if (install && openPluginManager) openPluginManager()
        else notify('已复制 GitHub 地址。')
      } catch {
        if (disposed || !button.isConnected) return
        const row = button.closest('.row-main')
        let field = row.querySelector('.install-spec')
        if (!field) {
          field = doc.createElement('input')
          field.className = 'install-spec'
          field.readOnly = true
          row.append(field)
        }
        field.setAttribute('aria-label', install ? '安装地址或包名' : 'GitHub 仓库地址')
        field.value = value
        field.focus()
        field.select()
      }
    }
  })
  app.addEventListener('keydown', event => {
    if (event.key !== '/' || event.isComposing || event.ctrlKey || event.metaKey || event.altKey ||
        event.target.closest('input, textarea, select, [contenteditable]')) return
    event.preventDefault()
    input.focus()
  })
  report.addEventListener('submit', async event => {
    event.preventDefault()
    if (!demandUrl || state.busy) return
    const topic = new FormData(event.target).get('topic')
    if (!topics.some(item => item.id === topic)) return
    state.busy = true
    const submit = event.submitter
    if (submit) submit.disabled = true
    notify('正在提交需求…')
    try {
      const response = await fetch(api('/votes'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: demandAuthenticated ? 'include' : 'omit',
        body: JSON.stringify(demandAuthenticated ? { topic } : { topic, visitor: identity() }), signal: abort.signal
      })
      if (response.status === 401) { notify('请先登录，再提交需求。'); return }
      if (!response.ok) throw new Error('提交失败')
      const data = await response.json()
      notify(data.added ? '已记录你的需求。' : '这个主题你已经提交过了。')
      state.report = false
      renderReport()
      app.querySelector('[data-action=report]').focus()
      void loadDemand()
    } catch { notify('提交失败，请稍后再试。') }
    finally { state.busy = false; if (submit?.isConnected) submit.disabled = false }
  })
  input.addEventListener('input', () => { state.query = input.value; render(); if (state.report) renderReport() })
  category.addEventListener('change', () => { state.category = category.value; render() })
  metric.addEventListener('change', () => { state.metric = metric.value; render() })
  const snapshotKey = 'dsh-plugin-pulse.snapshot.v1:' + snapshotUrl
  const newerSnapshot = incoming => core.validSnapshot(incoming) &&
    (!snapshot.generatedAt || incoming.generatedAt >= snapshot.generatedAt)
  if (snapshotUrl) {
    try {
      const cached = JSON.parse(localStorage.getItem(snapshotKey))
      if (newerSnapshot(cached)) snapshot = cached
    } catch { /* use bundled snapshot */ }
  }
  hydrateCategories()
  render()
  if (snapshotUrl) void (async () => {
    try {
      const response = await fetch(snapshotUrl, { credentials: 'omit', signal: abort.signal })
      if (!response.ok || !response.body) return
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let raw = ''
      let size = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > 4 * 1024 * 1024) { await reader.cancel(); return }
        raw += decoder.decode(value, { stream: true })
      }
      const incoming = JSON.parse(raw + decoder.decode())
      if (disposed || !newerSnapshot(incoming)) return
      snapshot = incoming
      hydrateCategories()
      render()
      try { localStorage.setItem(snapshotKey, JSON.stringify(incoming)) } catch { /* memory cache remains available */ }
    } catch { /* last valid snapshot remains available */ }
  })()
  return () => { disposed = true; abort.abort(); host.replaceChildren() }
}
