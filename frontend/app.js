const STORAGE_KEYS = {
  state: 'hybrid-explorer-v15-state',
  history: 'hybrid-explorer-v15-history',
  saved: 'hybrid-explorer-v15-saved',
  leftWidth: 'hybrid-explorer-v15-left-width'
};

const els = {
  siteMap: document.getElementById('site-map'),
  siteCount: document.getElementById('site-count'),
  viewerTitleLink: document.getElementById('viewer-title-link'),
  viewerDesc: document.getElementById('viewer-desc'),
  modeIdle: document.getElementById('mode-idle'),
  modeProxy: document.getElementById('mode-proxy'),
  modeRemote: document.getElementById('mode-remote'),
  modeReader: document.getElementById('mode-reader'),
  modeExternal: document.getElementById('mode-external'),
  proxyUrlInput: document.getElementById('proxy-url-input'),
  proxyGoBtn: document.getElementById('proxy-go-btn'),
  viewer: document.getElementById('viewer'),
  btnHome: document.getElementById('btn-home'),
  btnCopy: document.getElementById('btn-copy'),
  btnSave: document.getElementById('btn-save'),
  btnOriginal: document.getElementById('btn-original'),
  clearHistory: document.getElementById('clear-history'),
  historyList: document.getElementById('history-list'),
  resizer: document.getElementById('resizer'),
  loadingTemplate: document.getElementById('loading-template'),
  remoteTemplate: document.getElementById('remote-template'),
  blockedTemplate: document.getElementById('blocked-template'),
  externalTemplate: document.getElementById('external-template')
};

const appState = {
  sites: [],
  groups: [],
  currentSite: null,
  currentUrl: '',
  history: [],
  saved: [],
  leftWidth: 90,
  remoteSession: null,
  remoteFrame: null,
  remoteOverlay: null,
  remoteFrameUrl: '',
  remoteBusy: false,
  remoteResizeObserver: null
};

const PROXY_ENDPOINT = '../api/proxy';

let resizing = false;
let toastTimer = null;
let currentProxyShadowRoot = null;

init().catch((error) => {
  console.error(error);
  renderError('앱을 시작할 수 없습니다.', error);
});

async function init() {
  appState.sites = await loadSites();
  appState.groups = groupSites(appState.sites);
  appState.history = readJsonStorage(STORAGE_KEYS.history, []);
  appState.saved = readJsonStorage(STORAGE_KEYS.saved, []);
  appState.leftWidth = readJsonStorage(STORAGE_KEYS.leftWidth, 90);

  renderSiteMap();
  bindActions();
  renderSavedList();
  setSplit(appState.leftWidth);

  const restored = readJsonStorage(STORAGE_KEYS.state, null);
  const initialSite =
    restored?.selectedSiteTitle
      ? appState.sites.find((site) => site.title === restored.selectedSiteTitle) ?? appState.sites[0]
      : appState.sites[0];

  const initialUrl = restored?.currentUrl || initialSite?.url || '';
  if (initialSite) {
    await selectSite(initialSite, {
      url: initialUrl,
      shouldPersist: false,
      shouldRecord: false
    });
  } else {
    updateHeader();
    renderLoadingState();
  }
}

async function loadSites() {
  const response = await fetch(new URL('../data/sites.json', window.location.href));
  if (!response.ok) {
    throw new Error(`사이트 목록을 불러오지 못했습니다. (${response.status})`);
  }

  const sites = await response.json();
  return sites.map((site, index) => ({
    ...site,
    id: `${site.title}-${index}`
  }));
}

function groupSites(sites) {
  const categories = [];
  const seen = new Set();

  for (const site of sites) {
    if (!seen.has(site.category)) {
      seen.add(site.category);
      categories.push(site.category);
    }
  }

  return categories.map((category) => ({
    category,
    sites: sites.filter((site) => site.category === category)
  }));
}

function renderSiteMap() {
  els.siteCount.textContent = `${appState.sites.length} sites`;
  els.siteMap.innerHTML = appState.groups
    .map(
      (group) => `
        <section class="site-group" data-category="${escapeHtml(group.category)}">
          <h2>${escapeHtml(group.category)}</h2>
          <div class="site-list">
            ${group.sites
              .map(
                (site) => `
                  <button
                    type="button"
                    class="site-item"
                    data-site-id="${escapeHtml(site.id)}"
                    aria-current="false"
                  >
                    <span class="site-name">${escapeHtml(site.title)}<b>보기</b></span>
                    <span class="site-mode">${escapeHtml(site.mode)}</span>
                    ${site.desc ? `<span class="site-desc">${escapeHtml(site.desc)}</span>` : ''}
                  </button>
                `
              )
              .join('')}
          </div>
        </section>
      `
    )
    .join('');

  for (const button of els.siteMap.querySelectorAll('[data-site-id]')) {
    button.addEventListener('click', async () => {
      const site = appState.sites.find((item) => item.id === button.dataset.siteId);
      if (site) {
        await selectSite(site, { url: site.url });
      }
    });
  }
}

function bindActions() {
  els.viewerTitleLink.addEventListener('click', () => {
    reloadFirstUrl();
  });

  els.btnHome.addEventListener('click', () => {
    reloadFirstUrl();
  });

  els.btnCopy.addEventListener('click', async () => {
    await copyCurrentUrl();
  });

  els.btnSave.addEventListener('click', () => {
    saveExploration();
  });

  els.btnOriginal.addEventListener('click', () => {
    openOriginal();
  });

  els.viewer.addEventListener('click', onViewerClick);

  els.proxyGoBtn.addEventListener('click', () => {
    const url = els.proxyUrlInput.value.trim();
    if (url) navigateToUrl(url);
  });

  els.proxyUrlInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      const url = els.proxyUrlInput.value.trim();
      if (url) navigateToUrl(url);
    }
  });

  els.clearHistory.addEventListener('click', () => {
    if (!confirm('탐험 저장 이력을 삭제할까요?')) return;
    appState.saved = [];
    localStorage.removeItem(STORAGE_KEYS.saved);
    renderSavedList();
    toast('탐험 저장 이력을 삭제했습니다.');
  });

  els.resizer.addEventListener('mousedown', startResize);
  els.resizer.addEventListener('touchstart', startResize, { passive: false });
  window.addEventListener('mousemove', onResizeMove);
  window.addEventListener('touchmove', onResizeTouchMove, { passive: false });
  window.addEventListener('mouseup', stopResize);
  window.addEventListener('touchend', stopResize);
  window.addEventListener('blur', stopResize);
}

async function selectSite(site, options = {}) {
  const url = normalizeUrl(options.url || site.url);

  appState.currentSite = site;
  appState.currentUrl = url;
  appState.remoteSession = null;
  appState.remoteFrame = null;

  updateHeader();
  updateActiveSite();
  persistState(options.shouldPersist !== false);
  recordVisit(url, site);

  if (site.mode === 'remote') {
    renderLoadingState();
    try {
      const session = await createRemoteSession(site, url);
      if (appState.currentUrl !== url || appState.currentSite?.id !== site.id) {
        return;
      }

      appState.remoteSession = session;
      renderRemoteState(site, session);
      return;
    } catch (error) {
      console.error(error);
      renderRemoteState(site, {
        sessionId: 'scaffold',
        currentUrl: url,
        status: 'unavailable',
        note: error?.message || 'remote session unavailable'
      });
      return;
    }
  }

  if (site.mode === 'external') {
    renderExternalState(site, url);
    return;
  }

  renderLoadingState();

  try {
    const fragment = await fetchProxyFragment(url, site.mode);
    if (appState.currentUrl !== url || appState.currentSite?.id !== site.id) {
      return;
    }

    renderProxyFragment(fragment);
  } catch (error) {
    console.error(error);
    renderErrorState(site, url, error);
  }
}

async function fetchProxyFragment(url, mode) {
  const endpoint = new URL(PROXY_ENDPOINT, window.location.href);
  endpoint.searchParams.set('url', url);
  endpoint.searchParams.set('mode', mode || 'proxy');

  const response = await fetch(endpoint.toString(), {
    headers: {
      Accept: 'text/html'
    }
  });

  if (!response.ok) {
    throw new Error(`proxy fetch failed: ${response.status}`);
  }

  return response.text();
}

async function createRemoteSession(site, url) {
  const viewport = {
    width: Math.max(900, Math.round((els.viewer.clientWidth || window.innerWidth * 0.48) - 48)),
    height: Math.max(700, Math.round(window.innerHeight * 0.7))
  };

  const response = await fetch('/api/remote/session', {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      title: site.title,
      category: site.category,
      mode: site.mode,
      url,
      viewport,
      bridgeDebug: Boolean(site.bridgeDebug)
    })
  });

  if (!response.ok) {
    throw new Error(`remote session failed: ${response.status}`);
  }

  return response.json();
}

async function navigateRemoteSession(url) {
  if (!appState.remoteSession?.sessionId) {
    return createRemoteSession(appState.currentSite, url);
  }

  const response = await fetch(`/api/remote/session/${encodeURIComponent(appState.remoteSession.sessionId)}/navigate`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({ url })
  });

  if (!response.ok) {
    throw new Error(`remote navigate failed: ${response.status}`);
  }

  return response.json();
}

function renderProxyFragment(fragmentHtml) {
  els.viewer.innerHTML = '';
  const host = document.createElement('div');
  host.className = 'proxy-host';
  els.viewer.appendChild(host);
  mountShadowFragment(host, fragmentHtml);
  els.proxyUrlInput.value = appState.currentUrl || '';
  updateHeader();
}

function mountShadowFragment(host, fragmentHtml) {
  currentProxyShadowRoot = host.attachShadow({ mode: 'open' });
  currentProxyShadowRoot.innerHTML = fragmentHtml;
  currentProxyShadowRoot.addEventListener('click', onViewerClick);
}

function renderLoadingState() {
  currentProxyShadowRoot = null;
  appState.remoteFrame = null;
  appState.remoteOverlay = null;
  const node = els.loadingTemplate.content.cloneNode(true);
  els.viewer.replaceChildren(node);
  els.proxyUrlInput.value = appState.currentUrl || '';
  setModePills(appState.currentSite?.mode || 'idle');
}

function renderExternalState(site, url) {
  currentProxyShadowRoot = null;
  appState.remoteFrame = null;
  appState.remoteOverlay = null;
  const node = els.externalTemplate.content.cloneNode(true);
  els.viewer.replaceChildren(node);

  const openButton = els.viewer.querySelector('[data-external-open]');
  const copyButton = els.viewer.querySelector('[data-external-copy]');

  openButton?.addEventListener('click', () => openUrl(url));
  copyButton?.addEventListener('click', async () => {
    await writeClipboard(url);
    toast('현재 URL을 복사했습니다.');
  });

  els.proxyUrlInput.value = url;
  updateHeader(site.mode);
}

function renderBlockedState(site, url, message) {
  currentProxyShadowRoot = null;
  appState.remoteFrame = null;
  appState.remoteOverlay = null;
  const node = els.blockedTemplate.content.cloneNode(true);
  els.viewer.replaceChildren(node);

  const openButton = els.viewer.querySelector('[data-blocked-open]');
  const copyButton = els.viewer.querySelector('[data-blocked-copy]');
  const messageEl = els.viewer.querySelector('[data-blocked-message]');

  if (messageEl && message) {
    messageEl.textContent = message;
  }

  openButton?.addEventListener('click', () => openUrl(url));
  copyButton?.addEventListener('click', async () => {
    await writeClipboard(url);
    toast('현재 URL을 복사했습니다.');
  });

  els.proxyUrlInput.value = url;
  updateHeader('external');
}

function renderRemoteState(site, session) {
  currentProxyShadowRoot = null;
  if (appState.remoteResizeObserver) {
    appState.remoteResizeObserver.disconnect();
    appState.remoteResizeObserver = null;
  }
  const node = els.remoteTemplate.content.cloneNode(true);
  els.viewer.replaceChildren(node);

  const stageEl = els.viewer.querySelector('[data-remote-stage]');
  const sessionEl = els.viewer.querySelector('[data-remote-session]');
  const statusEl = els.viewer.querySelector('[data-remote-status]');
  const urlEl = els.viewer.querySelector('[data-remote-url]');
  const frameEl = els.viewer.querySelector('[data-remote-frame]');
  const overlayEl = els.viewer.querySelector('[data-remote-overlay]');

  appState.remoteFrame = frameEl;
  appState.remoteOverlay = overlayEl;
  appState.remoteSession = session || appState.remoteSession;
  const resolvedUrl = normalizeUrl(session?.currentUrl || appState.currentUrl || site.url);

  sessionEl.textContent = session?.sessionId || 'scaffold';
  statusEl.textContent = session?.status || 'idle';
  urlEl.textContent = resolvedUrl;

  els.proxyUrlInput.value = resolvedUrl;
  if (resolvedUrl && resolvedUrl !== appState.currentUrl) {
    appState.currentUrl = resolvedUrl;
    persistState();
    recordVisit(resolvedUrl, site);
  }

  if (frameEl && appState.remoteSession?.sessionId) {
    bindRemoteViewport(stageEl, frameEl);
    setRemoteBusy(true);
    refreshRemoteFrame(appState.remoteSession.sessionId);
  }

  updateHeader(site.mode);
}

function renderErrorState(site, url, error) {
  currentProxyShadowRoot = null;
  if (appState.remoteResizeObserver) {
    appState.remoteResizeObserver.disconnect();
    appState.remoteResizeObserver = null;
  }
  appState.remoteFrame = null;
  appState.remoteOverlay = null;
  els.viewer.innerHTML = `
    <div class="state-card">
      <div class="state-flag">Error</div>
      <h2>프록시 페이지를 불러오지 못했습니다</h2>
      <p>${escapeHtml(error?.message || 'Unknown error')}</p>
      <div class="state-actions">
        <button type="button" data-retry>다시 시도</button>
        <button type="button" data-open-original>원문 열기</button>
      </div>
    </div>
  `;

  els.viewer.querySelector('[data-retry]')?.addEventListener('click', () => {
    selectSite(site, { url });
  });
  els.viewer.querySelector('[data-open-original]')?.addEventListener('click', () => {
    openUrl(url);
  });

  els.proxyUrlInput.value = url;
  updateHeader(site.mode);
}

function renderError(message, error) {
  currentProxyShadowRoot = null;
  if (appState.remoteResizeObserver) {
    appState.remoteResizeObserver.disconnect();
    appState.remoteResizeObserver = null;
  }
  appState.remoteFrame = null;
  appState.remoteOverlay = null;
  els.viewer.innerHTML = `
    <div class="state-card">
      <div class="state-flag">Error</div>
      <h2>${escapeHtml(message)}</h2>
      <p>${escapeHtml(error?.message || 'Unknown error')}</p>
    </div>
  `;
  setModePills('idle');
}

function updateHeader(modeOverride) {
  const site = appState.currentSite;
  const mode = modeOverride || site?.mode || 'idle';

  els.viewerTitleLink.textContent = site ? `${site.title} ↻` : '탐험할 사이트를 선택하세요';
  els.viewerDesc.textContent = site
    ? `${site.category} · ${mode} · 현재 URL: ${appState.currentUrl || site.url}`
    : '왼쪽 리스트에서 사이트를 누르면 자동으로 읽기 모드로 전환됩니다.';
  els.proxyUrlInput.value = appState.currentUrl || '';
  setModePills(mode);
  document.title = site ? `${site.title} · Hybrid Explorer v15` : 'Hybrid Explorer v15';
}

function updateActiveSite() {
  for (const button of els.siteMap.querySelectorAll('[data-site-id]')) {
    const site = appState.sites.find((item) => item.id === button.dataset.siteId);
    const isActive = site?.id === appState.currentSite?.id;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-current', isActive ? 'true' : 'false');
  }
}

function reloadFirstUrl() {
  if (!appState.currentSite) return;
  if (appState.currentSite.mode === 'remote') {
    selectSite(appState.currentSite, { url: appState.currentSite.url });
    return;
  }
  selectSite(appState.currentSite, { url: appState.currentSite.url });
}

function navigateToUrl(url) {
  if (!appState.currentSite) return;

  if (appState.currentSite.mode === 'remote') {
    appState.currentUrl = normalizeUrl(url);
    updateHeader('remote');
    persistState();
    recordVisit(appState.currentUrl, appState.currentSite);
    setRemoteBusy(true);
    navigateRemoteSession(appState.currentUrl)
      .then((session) => {
        appState.remoteSession = session;
        renderRemoteState(appState.currentSite, session);
      })
      .catch((error) => {
        console.error(error);
        toast('원격 세션 이동에 실패했습니다.');
      })
      .finally(() => {
        setRemoteBusy(false);
      });
    return;
  }

  if (appState.currentSite.mode === 'external') {
    openUrl(url);
    return;
  }

  appState.currentUrl = normalizeUrl(url);
  updateHeader();
  persistState();
  recordVisit(appState.currentUrl, appState.currentSite);
  selectSite(appState.currentSite, { url: appState.currentUrl, shouldPersist: false });
}

async function copyCurrentUrl() {
  if (!appState.currentUrl) return;
  await writeClipboard(appState.currentUrl);
  toast('현재 URL을 복사했습니다.');
}

function openOriginal() {
  if (!appState.currentUrl) return;
  openUrl(appState.currentUrl);
}

function openUrl(url) {
  window.open(url, '_blank', 'noopener,noreferrer');
}

function recordVisit(url, site) {
  const entry = {
    siteTitle: site.title,
    category: site.category,
    mode: site.mode,
    url,
    visitedAt: new Date().toISOString()
  };

  appState.history = [
    entry,
    ...appState.history.filter((item) => item.url !== entry.url)
  ].slice(0, 120);
  localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(appState.history));

  persistState();
}

function saveExploration() {
  if (!appState.currentSite || !appState.currentUrl) return;

  const entry = {
    siteTitle: appState.currentSite.title,
    category: appState.currentSite.category,
    mode: appState.currentSite.mode,
    url: appState.currentUrl,
    savedAt: new Date().toISOString()
  };

  appState.saved = [
    entry,
    ...appState.saved.filter((item) => item.url !== entry.url)
  ].slice(0, 120);
  localStorage.setItem(STORAGE_KEYS.saved, JSON.stringify(appState.saved));
  renderSavedList();
  toast('탐험 경로를 저장했습니다.');
}

function persistState(shouldWrite = true) {
  if (!shouldWrite) return;

  const payload = {
    selectedSiteTitle: appState.currentSite?.title || null,
    currentUrl: appState.currentUrl || null
  };

  localStorage.setItem(STORAGE_KEYS.state, JSON.stringify(payload));
}

function onViewerClick(event) {
  const anchor = event.target.closest('a[href]');
  if (!anchor) return;

  const href = anchor.getAttribute('href');
  if (!href) return;

  if (href.startsWith('#')) {
    const nextUrl = `${stripHash(appState.currentUrl)}${href}`;
    appState.currentUrl = nextUrl;
    updateHeader();
    persistState();
    recordVisit(nextUrl, appState.currentSite);
    return;
  }

  if (
    href.startsWith('mailto:') ||
    href.startsWith('tel:') ||
    href.startsWith('javascript:')
  ) {
    return;
  }

  event.preventDefault();

  const nextUrl = extractProxyUrl(href) || href;
  if (!nextUrl) return;

  if (appState.currentSite?.mode === 'external') {
    openUrl(nextUrl);
    return;
  }

  navigateToUrl(nextUrl);
}

function extractProxyUrl(href) {
  try {
    const parsed = new URL(href, window.location.href);
    if (parsed.pathname.endsWith('/api/proxy') || parsed.pathname === '/api/proxy') {
      return parsed.searchParams.get('url');
    }
  } catch {
    return null;
  }
  return null;
}

function normalizeUrl(url) {
  const proxied = extractProxyUrl(url);
  const raw = proxied || url;
  try {
    return new URL(raw, window.location.href).toString();
  } catch {
    return raw;
  }
}

function stripHash(url) {
  try {
    const parsed = new URL(url, window.location.href);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return url.split('#')[0];
  }
}

async function writeClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
  }
}

function setModePills(mode) {
  const map = {
    idle: els.modeIdle,
    proxy: els.modeProxy,
    remote: els.modeRemote,
    reader: els.modeReader,
    external: els.modeExternal
  };

  for (const pill of Object.values(map)) {
    pill.classList.remove('active', 'wait');
  }

  const key = map[mode] ? mode : 'idle';
  map[key].classList.add(key === 'idle' ? 'wait' : 'active');
}

function bindRemoteViewport(stageEl, frameEl) {
  if (!stageEl || !frameEl) return;

  frameEl.onload = () => setRemoteBusy(false);

  stageEl.onclick = (event) => {
    if (!appState.remoteSession?.sessionId || appState.remoteBusy) return;
    event.preventDefault();
    const point = getRemoteViewportPoint(frameEl, event);
    if (!point) return;
    performRemoteViewportAction('click', point);
  };

  stageEl.onwheel = (event) => {
    if (!appState.remoteSession?.sessionId || appState.remoteBusy) return;
    event.preventDefault();
    performRemoteViewportAction('scroll', {
      deltaX: event.deltaX,
      deltaY: event.deltaY
    });
  };

  if (appState.remoteResizeObserver) {
    appState.remoteResizeObserver.disconnect();
  }

  let lastSize = '';
  appState.remoteResizeObserver = new ResizeObserver((entries) => {
    const entry = entries[0];
    if (!entry || !appState.remoteSession?.sessionId) return;
    const width = Math.round(entry.contentRect.width);
    const height = Math.round(Math.max(700, Math.min(window.innerHeight * 0.7, width * 0.8)));
    const nextSize = `${width}x${height}`;
    if (nextSize === lastSize) return;
    lastSize = nextSize;
    performRemoteViewportAction('resize', { width, height }, { silent: true });
  });
  appState.remoteResizeObserver.observe(stageEl);
}

function getRemoteViewportPoint(frameEl, event) {
  const rect = frameEl.getBoundingClientRect();
  const viewport = appState.remoteSession?.viewport;
  if (!rect.width || !rect.height || !viewport) return null;

  return {
    x: ((event.clientX - rect.left) * viewport.width) / rect.width,
    y: ((event.clientY - rect.top) * viewport.height) / rect.height
  };
}

async function performRemoteViewportAction(action, payload, options = {}) {
  if (!appState.remoteSession?.sessionId) return;

  const sessionId = encodeURIComponent(appState.remoteSession.sessionId);
  setRemoteBusy(true);

  try {
    const response = await fetch(`/api/remote/session/${sessionId}/${action}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`remote ${action} failed: ${response.status}`);
    }

    const session = await response.json();
    appState.remoteSession = session;
    syncRemoteSessionState(session);
    refreshRemoteFrame(session.sessionId);
  } catch (error) {
    console.error(error);
    if (!options.silent) {
      toast('원격 화면 조작에 실패했습니다.');
    }
    setRemoteBusy(false);
  }
}

function syncRemoteSessionState(session) {
  const resolvedUrl = normalizeUrl(session?.currentUrl || appState.currentUrl || '');
  const previousUrl = appState.currentUrl;
  appState.remoteSession = session;
  if (resolvedUrl) {
    appState.currentUrl = resolvedUrl;
    persistState();
    if (resolvedUrl !== previousUrl && appState.currentSite) {
      recordVisit(resolvedUrl, appState.currentSite);
    }
  }

  const sessionEl = els.viewer.querySelector('[data-remote-session]');
  const statusEl = els.viewer.querySelector('[data-remote-status]');
  const urlEl = els.viewer.querySelector('[data-remote-url]');
  if (sessionEl) sessionEl.textContent = session?.sessionId || 'scaffold';
  if (statusEl) statusEl.textContent = session?.status || 'idle';
  if (urlEl) urlEl.textContent = resolvedUrl || '-';
  els.proxyUrlInput.value = resolvedUrl || '';
  updateHeader('remote');
}

function refreshRemoteFrame(sessionId) {
  if (!appState.remoteFrame || !sessionId) return;
  const nextUrl = `/api/remote/session/${encodeURIComponent(sessionId)}/frame?t=${Date.now()}`;
  appState.remoteFrameUrl = nextUrl;
  appState.remoteFrame.src = nextUrl;
}

function setRemoteBusy(isBusy) {
  appState.remoteBusy = isBusy;
  if (appState.remoteOverlay) {
    appState.remoteOverlay.hidden = !isBusy;
  }
}

function renderSavedList() {
  const list = appState.saved.slice(0, 20);

  if (!list.length) {
    els.historyList.innerHTML = `
      <div class="history-item">
        아직 탐험 저장 이력이 없습니다. 탐험저장을 누르면 여기에 저장됩니다.
      </div>
    `;
    return;
  }

  els.historyList.innerHTML = list
    .map(
      (item) => `
        <div class="history-item">
          <b>${escapeHtml(item.savedAt || '')}</b> · ${escapeHtml(item.category)}
          <br />
          ${escapeHtml(item.siteTitle)}
          <br />
          <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.url)}</a>
        </div>
      `
    )
    .join('');
}

function startResize(event) {
  resizing = true;
  document.body.classList.add('dragging');
  document.body.style.userSelect = 'none';
  event.preventDefault();
}

function stopResize() {
  if (!resizing) return;
  resizing = false;
  document.body.classList.remove('dragging');
  document.body.style.userSelect = '';
}

function onResizeMove(event) {
  if (!resizing) return;
  setSplit((event.clientX / window.innerWidth) * 100);
}

function onResizeTouchMove(event) {
  if (!resizing) return;
  const touch = event.touches[0];
  if (!touch) return;
  setSplit((touch.clientX / window.innerWidth) * 100);
  event.preventDefault();
}

function setSplit(percent) {
  const value = Math.min(90, Math.max(10, percent));
  appState.leftWidth = value;
  document.documentElement.style.setProperty('--left-width', `${value}vw`);
  localStorage.setItem(STORAGE_KEYS.leftWidth, JSON.stringify(value));
}

function readJsonStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function toast(message) {
  let toastEl = document.querySelector('.toast');
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'toast';
    document.body.appendChild(toastEl);
  }

  toastEl.textContent = message;
  toastEl.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('is-visible'), 1800);
}
