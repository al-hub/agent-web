export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/api/proxy') {
      return handleProxy(request, url);
    }

    return new Response('Not found', {
      status: 404,
      headers: {
        'content-type': 'text/plain; charset=utf-8'
      }
    });
  }
};

async function handleProxy(request, requestUrl) {
  const targetParam = requestUrl.searchParams.get('url');
  const mode = requestUrl.searchParams.get('mode') || 'proxy';
  const sessionId = requestUrl.searchParams.get('hxSessionId') || '';
  const bridgeMode = requestUrl.searchParams.get('bridge') === '1' || Boolean(sessionId);
  const debugMode = requestUrl.searchParams.get('debug') === '1';
  const rawMode = requestUrl.searchParams.get('raw') === '1';

  if (!targetParam) {
    return jsonError('Missing url query parameter', 400);
  }

  let targetUrl;
  try {
    targetUrl = new URL(targetParam);
  } catch {
    return jsonError('Invalid target url', 400);
  }

  const forwardOptions = rawMode
    ? await buildRawForwardOptions(request, targetUrl)
    : buildDocumentForwardOptions(targetUrl);
  const response = await fetch(targetUrl.toString(), forwardOptions);

  if (rawMode) {
    return new Response(response.body, {
      status: response.status,
      headers: sanitizeResponseHeaders(response.headers, {
        'cache-control': 'no-store'
      })
    });
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
    return renderUnsupported(targetUrl, contentType);
  }

  const html = await response.text();
  if (isChallengeResponse(response.status, html)) {
    return renderBlocked(targetUrl, response.status);
  }
  const title = extractTitle(html) || targetUrl.hostname;
  const fragment = buildFragment(html, targetUrl, mode, title, { sessionId, bridgeMode, debugMode });

  return new Response(fragment, {
    status: response.status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

function buildDocumentForwardOptions(targetUrl) {
  const headers = new Headers();
  headers.set(
    'accept',
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8'
  );
  headers.set('accept-language', 'en-US,en;q=0.9,ko;q=0.8');
  headers.set('cache-control', 'no-cache');
  headers.set('pragma', 'no-cache');
  headers.set('referer', `${targetUrl.origin}/`);
  headers.set('user-agent', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HybridExplorer/15.0 Safari/537.36');
  headers.set('upgrade-insecure-requests', '1');
  return {
    redirect: 'follow',
    headers
  };
}

async function buildRawForwardOptions(request, targetUrl) {
  const method = request.method || 'GET';
  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.set('user-agent', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HybridExplorer/15.0 Safari/537.36');
  headers.set('accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8');
  headers.set('accept-language', 'en-US,en;q=0.9,ko;q=0.8');
  headers.set('cache-control', 'no-cache');
  headers.set('pragma', 'no-cache');
  headers.set('referer', `${targetUrl.origin}/`);
  headers.set('upgrade-insecure-requests', '1');

  const options = {
    method,
    redirect: 'follow',
    headers
  };

  if (method !== 'GET' && method !== 'HEAD') {
    options.body = await request.clone().arrayBuffer();
  }

  return options;
}

function sanitizeResponseHeaders(headers, overrides = {}) {
  const result = new Headers(headers);
  result.delete('content-encoding');
  result.delete('transfer-encoding');
  result.delete('content-length');
  for (const [key, value] of Object.entries(overrides)) {
    result.set(key, value);
  }
  return result;
}

function buildFragment(html, baseUrl, mode, title, options = {}) {
  const { sessionId = '', bridgeMode = false, debugMode = false } = options;
  const headAssets = bridgeMode ? extractHeadAssets(html, baseUrl) : '';
  let fragment = extractBody(html);
  fragment = stripNoise(fragment, mode, bridgeMode);
  fragment = rewriteFragment(fragment, baseUrl, mode, sessionId, bridgeMode, debugMode);
  const bridgeScript = bridgeMode ? buildBridgeScript(sessionId, debugMode) : '';

  return `
    <style>
      :host {
        display: block;
      }
      .proxy-fragment {
        display: block;
        width: 100%;
        min-height: 100%;
        color: #272421;
      }
      .proxy-fragment img,
      .proxy-fragment video,
      .proxy-fragment svg,
      .proxy-fragment canvas {
        max-width: 100%;
        height: auto;
      }
      .proxy-fragment iframe,
      .proxy-fragment script,
      .proxy-fragment noscript,
      .proxy-fragment object,
      .proxy-fragment embed {
        display: none !important;
    }
    </style>
    ${headAssets}
    <section class="proxy-fragment" data-source-url="${escapeAttr(baseUrl.toString())}" data-source-title="${escapeAttr(title)}" data-mode="${escapeAttr(mode)}">
      ${fragment}
      ${bridgeScript}
    </section>
  `;
}

function extractBody(html) {
  const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) {
    return bodyMatch[1];
  }
  return html;
}

function extractHeadAssets(html, baseUrl) {
  const headMatch = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i);
  if (!headMatch) return '';

  const head = headMatch[1];
  const styles = [
    ...(head.match(/<style\b[^>]*>[\s\S]*?<\/style>/gi) || []),
    ...(head.match(/<link\b[^>]*rel=["'][^"']*stylesheet[^"']*["'][^>]*>/gi) || [])
  ];

  return styles
    .map((tag) => rewriteHeadAsset(tag, baseUrl))
    .join('\n');
}

function extractTitle(html) {
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (!titleMatch) return '';
  return decodeEntities(titleMatch[1].replace(/\s+/g, ' ').trim());
}

function stripNoise(fragment, mode, bridgeMode) {
  let output = fragment
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, '')
    .replace(/<template\b[\s\S]*?<\/template>/gi, '')
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, '')
    .replace(/<object\b[\s\S]*?<\/object>/gi, '')
    .replace(/<embed\b[\s\S]*?<\/embed>/gi, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi, '');

  output = output.replace(/<style\b[\s\S]*?<\/style>/gi, '');

  if (mode === 'reader') {
    const candidate = pickReaderCandidate(output);
    if (candidate) {
      output = candidate;
    }

    output = output.replace(/<(nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi, '');
  }

  return output;
}

function pickReaderCandidate(fragment) {
  const candidates = [
    extractLargestMatch(fragment, /<article\b[^>]*>[\s\S]*?<\/article>/gi),
    extractLargestMatch(fragment, /<main\b[^>]*>[\s\S]*?<\/main>/gi),
    extractLargestMatch(fragment, /<section\b[^>]*>[\s\S]*?<\/section>/gi)
  ].filter(Boolean);

  if (candidates.length > 0) {
    return candidates[0];
  }

  return '';
}

function extractLargestMatch(fragment, pattern) {
  const matches = fragment.match(pattern);
  if (!matches || matches.length === 0) return '';
  return matches.sort((a, b) => b.length - a.length)[0];
}

function rewriteHeadAsset(tag, baseUrl) {
  if (/^<style\b/i.test(tag)) {
    return tag;
  }

  return tag.replace(
    /\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i,
    (match, _whole, dq, sq, bare) => {
      const raw = dq ?? sq ?? bare ?? '';
      const resolved = rewriteAssetUrl(raw, baseUrl);
      return `href="${escapeAttr(resolved)}"`;
    }
  );
}

function rewriteFragment(fragment, baseUrl, mode, sessionId, bridgeMode, debugMode) {
  let output = fragment.replace(/<script\b[\s\S]*?<\/script>/gi, '');

  output = output.replace(
    /\b(href|src|action|poster|data)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    (match, attr, _whole, dq, sq, bare) => {
      const raw = dq ?? sq ?? bare ?? '';
      const rewritten = rewriteUrl(raw, baseUrl, attr.toLowerCase(), mode, sessionId, bridgeMode);
      if (debugMode && attr.toLowerCase() === 'href') {
        return `${attr}="${escapeAttr(rewritten)}" data-hx-original-href="${escapeAttr(raw)}" data-hx-rewritten-href="${escapeAttr(rewritten)}"`;
      }
      return `${attr}="${escapeAttr(rewritten)}"`;
    }
  );

  output = output.replace(/\bsrcset\s*=\s*("([^"]*)"|'([^']*)')/gi, (match, _whole, dq, sq) => {
    const raw = dq ?? sq ?? '';
    return `srcset="${escapeAttr(rewriteSrcset(raw, baseUrl))}"`;
  });

  output = output.replace(/\bstyle\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi, (match, _whole, dq, sq, bare) => {
    const raw = dq ?? sq ?? bare ?? '';
    return `style="${escapeAttr(rewriteStyleUrls(raw, baseUrl, mode, sessionId, bridgeMode, debugMode))}"`;
  });

  output = output.replace(/\btarget\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi, 'target="_self"');

  return output;
}

function rewriteUrl(raw, baseUrl, attr, mode, sessionId, bridgeMode) {
  const value = raw.trim();
  if (!value) return value;

  if (
    value.startsWith('#') ||
    value.startsWith('mailto:') ||
    value.startsWith('tel:') ||
    value.startsWith('javascript:') ||
    value.startsWith('data:') ||
    value.startsWith('blob:')
  ) {
    return value;
  }

  let resolved;
  try {
    resolved = new URL(value, baseUrl).toString();
  } catch {
    return value;
  }

  if (attr === 'href') {
    if (bridgeMode) {
      return `/api/proxy?url=${encodeURIComponent(resolved)}&mode=${encodeURIComponent(mode)}&bridge=1&hxSessionId=${encodeURIComponent(sessionId)}`;
    }
    return `/api/proxy?url=${encodeURIComponent(resolved)}`;
  }

  if (bridgeMode) {
    return `/api/proxy?url=${encodeURIComponent(resolved)}&raw=1`;
  }

  return resolved;
}

function rewriteAssetUrl(raw, baseUrl) {
  const value = raw.trim();
  if (!value) return value;

  if (
    value.startsWith('#') ||
    value.startsWith('mailto:') ||
    value.startsWith('tel:') ||
    value.startsWith('javascript:') ||
    value.startsWith('data:') ||
    value.startsWith('blob:')
  ) {
    return value;
  }

  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return value;
  }
}

function rewriteSrcset(srcset, baseUrl) {
  return srcset
    .split(',')
    .map((entry) => {
      const trimmed = entry.trim();
      if (!trimmed) return trimmed;

      const [rawUrl, ...rest] = trimmed.split(/\s+/);
      const resolved = rewriteUrl(rawUrl, baseUrl, 'src');
      return [resolved, ...rest].join(' ');
    })
    .join(', ');
}

function rewriteStyleUrls(styleText, baseUrl, mode, sessionId, bridgeMode, debugMode) {
  return String(styleText).replace(
    /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi,
    (match, _quote, raw) => `url("${escapeAttr(rewriteUrl(raw, baseUrl, 'src', mode, sessionId, bridgeMode))}")`
  );
}

function isChallengeResponse(status, html) {
  if (status !== 403 && status !== 429) return false;

  const text = String(html || '').toLowerCase();
  return (
    text.includes('enable javascript and cookies to continue') ||
    text.includes('vercel security checkpoint') ||
    text.includes('security checkpoint') ||
    text.includes('just a moment') ||
    text.includes('attention required') ||
    text.includes('_cf_chl_opt') ||
    text.includes('cloudflare')
  );
}

function renderBlocked(targetUrl, status) {
  return new Response(
    `
      <section class="proxy-fragment">
        <div style="max-width:720px;margin:4rem auto;padding:1.5rem;border:1px solid rgba(31,27,22,.12);border-radius:20px;background:#fffaf1;">
          <div style="display:inline-flex;padding:4px 10px;border-radius:999px;background:rgba(122,74,20,.12);color:#7a4a14;font-size:12px;letter-spacing:.08em;text-transform:uppercase;">Blocked</div>
          <h2 style="margin:14px 0 10px;font-family:Georgia,serif;">원문 사이트가 보안 검문소를 요구합니다</h2>
          <p style="margin:0;color:#6f6659;line-height:1.7;">${escapeHtml(targetUrl.toString())}</p>
          <p style="margin:10px 0 0;color:#6f6659;line-height:1.7;">HTTP ${escapeHtml(String(status || 403))}</p>
          <p style="margin:10px 0 0;color:#6f6659;line-height:1.7;">이 페이지는 Cloudflare 챌린지에 막혀 있어 프록시 브라우저 안에서 자동으로 펼칠 수 없습니다.</p>
        </div>
      </section>
    `,
    {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8'
      }
    }
  );
}

function buildBridgeScript(sessionId, debugMode = false) {
  const safeSessionId = JSON.stringify(sessionId || 'unknown');
  const safeDebugMode = JSON.stringify(Boolean(debugMode));
  return `
    <script>
      (() => {
        const sessionId = ${safeSessionId};
        const debugMode = ${safeDebugMode};
        const targetOrigin = location.origin;
        const sourceUrl = new URL(location.href).searchParams.get('url') || location.href;
        let currentUrl = sourceUrl;
        let heightTimer = null;
        let titleTimer = null;
        let sweepStarted = false;
        let sweepStarted = false;

        function resolveTargetUrl(raw) {
          if (!raw) return currentUrl;
          try {
            return new URL(raw, currentUrl || sourceUrl).toString();
          } catch {
            return currentUrl;
          }
        }

        function extractProxyTarget(raw) {
          if (!raw) return currentUrl;
          try {
            const parsed = new URL(raw, location.origin);
            if (parsed.pathname === '/api/proxy' || parsed.pathname.endsWith('/api/proxy')) {
              return parsed.searchParams.get('url') || currentUrl;
            }
          } catch {
            // ignore and fall through
          }
          return resolveTargetUrl(raw);
        }

        function isPlaceholderSrc(value) {
          if (!value) return true;
          const text = String(value).trim().toLowerCase();
          return (
            text.startsWith('data:image/') ||
            text.includes('placeholder') ||
            text.includes('spacer.gif') ||
            text.includes('1x1') ||
            text.includes('blank.gif')
          );
        }

        function resolveAssetUrl(raw) {
          try {
            const resolved = new URL(raw, currentUrl || sourceUrl).toString();
            const proxy = new URL('/api/proxy', location.origin);
            proxy.searchParams.set('url', resolved);
            proxy.searchParams.set('raw', '1');
            return proxy.toString();
          } catch {
            return raw;
          }
        }

        function debug(payload = {}) {
          if (!debugMode) return;
          send('HX_DEBUG', payload);
        }

        function nodeSnapshot(node) {
          if (!node || !node.getAttribute) return null;
          return {
            tag: node.tagName || '',
            cls: node.className || '',
            src: node.getAttribute('src') || '',
            dataSrc: node.getAttribute('data-src') || '',
            srcset: node.getAttribute('srcset') || '',
            dataSrcset: node.getAttribute('data-srcset') || '',
            poster: node.getAttribute('poster') || '',
            loading: node.getAttribute('loading') || '',
            bg: node.style?.backgroundImage || '',
            width: node.getAttribute('width') || '',
            height: node.getAttribute('height') || ''
          };
        }

        function promoteLazyAssets(root = document) {
          const selectors = [
            'img',
            'source',
            'iframe',
            'video',
            '[style*="background"]'
          ];
          const changes = [];
          for (const node of root.querySelectorAll(selectors.join(','))) {
            const before = debugMode ? nodeSnapshot(node) : null;
            if (node.getAttribute?.('loading') === 'lazy') {
              node.setAttribute('loading', 'eager');
            }

            const lazySrc = node.getAttribute?.('data-src') || node.getAttribute?.('data-lazy-src') || node.getAttribute?.('data-original') || node.getAttribute?.('data-url');
            const lazySrcset = node.getAttribute?.('data-srcset') || node.getAttribute?.('data-lazy-srcset');

            if (lazySrc && (!node.getAttribute('src') || isPlaceholderSrc(node.getAttribute('src')))) {
              node.setAttribute('src', resolveAssetUrl(lazySrc));
            }
            if (lazySrcset && !node.getAttribute('srcset')) {
              node.setAttribute('srcset', rewriteSrcset(lazySrcset, new URL(sourceUrl)));
            }

            const bg = node.getAttribute?.('data-bg') || node.getAttribute?.('data-background-image') || node.getAttribute?.('data-background');
            if (bg && node.style) {
              node.style.backgroundImage = 'url("' + resolveAssetUrl(bg) + '")';
            }

            if (node.tagName === 'VIDEO' && lazySrc && !node.getAttribute('poster')) {
              node.setAttribute('poster', resolveAssetUrl(lazySrc));
            }

            if (node.classList) {
              node.classList.remove('lazyload', 'lazyloading');
              node.classList.add('lazyloaded');
            }

            if (debugMode) {
              const after = nodeSnapshot(node);
              if (before && after && JSON.stringify(before) !== JSON.stringify(after)) {
                changes.push({ before, after });
              }
            }
          }

          if (debugMode && changes.length) {
            debug({
              kind: 'lazy-promote',
              url: currentUrl,
              count: changes.length,
              samples: changes.slice(0, 6)
            });
          }
        }

        function detectBlockedPage() {
          const text = String((document.title || '') + ' ' + (document.body?.innerText || '')).toLowerCase();
          if (!text) return null;

          const patterns = [
            'vercel security checkpoint',
            'security checkpoint',
            'failed to verify your browser',
            'we\'re verifying your browser',
            'we are verifying your browser',
            'enable javascript and cookies to continue',
            'just a moment',
            'attention required | cloudflare',
            'attention required',
            'cloudflare',
            '_cf_chl_opt',
            'code 99',
            '보안 검문소',
            '브라우저를 확인하지 못했습니다'
          ];

          if (patterns.some((pattern) => text.includes(pattern))) {
            return '원문이 Vercel 보안 검문소에 막혀 있습니다. 원문 열기를 사용하세요.';
          }

          return null;
        }

        function send(type, payload = {}) {
          try {
            window.parent?.postMessage({ type, sessionId, ...payload }, targetOrigin);
          } catch {
            // ignore
          }
        }

        function debug(payload = {}) {
          if (!debugMode) return;
          send('HX_DEBUG', payload);
        }

        function queueHeight() {
          clearTimeout(heightTimer);
          heightTimer = setTimeout(() => {
            const height = Math.max(
              document.documentElement?.scrollHeight || 0,
              document.body?.scrollHeight || 0,
              document.documentElement?.offsetHeight || 0,
              document.body?.offsetHeight || 0
            );
            send('HX_HEIGHT', { height });
          }, 50);
        }

        function queueTitle() {
          clearTimeout(titleTimer);
          titleTimer = setTimeout(() => {
            send('HX_TITLE', { title: document.title, url: currentUrl });
          }, 25);
        }

        function prefetchViewportSweep() {
          if (sweepStarted) return;
          if (!document.body || !document.documentElement) return;
          if (document.body.scrollHeight < window.innerHeight * 1.5) return;
          sweepStarted = true;

          const positions = [];
          const limit = Math.min(document.body.scrollHeight, window.innerHeight * 4);
          for (let y = 0; y <= limit; y += Math.max(320, Math.round(window.innerHeight * 0.8))) {
            positions.push(y);
          }
          positions.push(0);

          let index = 0;
          const step = () => {
            if (index >= positions.length) {
              window.scrollTo(0, 0);
              queueHeight();
              promoteLazyAssets();
              return;
            }
            window.scrollTo(0, positions[index]);
            promoteLazyAssets();
            queueHeight();
            index += 1;
            setTimeout(step, 80);
          };

          setTimeout(step, 120);
        }

        function reportUrl() {
          const blockedMessage = detectBlockedPage();
          if (blockedMessage) {
            send('HX_ERROR', { reason: 'blocked', message: blockedMessage, url: currentUrl });
            return;
          }
          send('HX_URL', { url: currentUrl, title: document.title });
          if (debugMode) {
            const nodes = document.querySelectorAll('img, source, video, iframe, [style*="background"]');
            const lazyNodes = document.querySelectorAll('.lazyload, .lazyloading');
            debug({
              kind: 'asset-summary',
              url: currentUrl,
              total: nodes.length,
              lazy: lazyNodes.length,
              img: document.querySelectorAll('img').length,
              source: document.querySelectorAll('source').length,
              video: document.querySelectorAll('video').length,
              iframe: document.querySelectorAll('iframe').length
            });
          }
          queueHeight();
          queueTitle();
          promoteLazyAssets();
          prefetchViewportSweep();
        }

        const pushState = history.pushState;
        history.pushState = function (...args) {
          const ret = pushState.apply(this, args);
          if (args.length > 2) {
            currentUrl = resolveTargetUrl(args[2]);
          }
          queueMicrotask(reportUrl);
          return ret;
        };

        const replaceState = history.replaceState;
        history.replaceState = function (...args) {
          const ret = replaceState.apply(this, args);
          if (args.length > 2) {
            currentUrl = resolveTargetUrl(args[2]);
          }
          queueMicrotask(reportUrl);
          return ret;
        };

        window.addEventListener('popstate', reportUrl);
        window.addEventListener('hashchange', () => {
          currentUrl = resolveTargetUrl(location.hash || currentUrl);
          reportUrl();
        });
        window.addEventListener('load', () => {
          currentUrl = sourceUrl;
          reportUrl();
          send('HX_READY', { url: currentUrl, title: document.title });
        });

        document.addEventListener('click', (event) => {
          const anchor = event.target.closest?.('a[href]');
          if (!anchor) return;
          const nextUrl = extractProxyTarget(anchor.getAttribute('href'));
          if (nextUrl) {
            currentUrl = nextUrl;
            send('HX_NAV', { url: currentUrl, title: document.title, href: anchor.getAttribute('href') || '' });
          }
          debug({
            kind: 'click',
            href: anchor.getAttribute('href'),
            originalHref: anchor.getAttribute('data-hx-original-href') || '',
            rewrittenHref: anchor.getAttribute('data-hx-rewritten-href') || '',
            currentUrl
          });
          queueMicrotask(() => setTimeout(reportUrl, 0));
        }, true);

        document.addEventListener('submit', () => {
          queueMicrotask(() => setTimeout(reportUrl, 0));
        }, true);

        const mutationObserver = new MutationObserver(() => {
          queueHeight();
          queueTitle();
          promoteLazyAssets();
          prefetchViewportSweep();
        });
        if (document.head) mutationObserver.observe(document.head, { subtree: true, childList: true, characterData: true });
        if (document.body) mutationObserver.observe(document.body, { subtree: true, childList: true, characterData: true });

        reportUrl();
      })();
    </script>
  `;
}

function renderUnsupported(targetUrl, contentType) {
  return new Response(
    `
      <section class="proxy-fragment">
        <div style="max-width:720px;margin:4rem auto;padding:1.5rem;border:1px solid rgba(31,27,22,.12);border-radius:20px;background:#fffaf1;">
          <div style="display:inline-flex;padding:4px 10px;border-radius:999px;background:rgba(122,74,20,.12);color:#7a4a14;font-size:12px;letter-spacing:.08em;text-transform:uppercase;">Unsupported</div>
          <h2 style="margin:14px 0 10px;font-family:Georgia,serif;">This URL is not HTML</h2>
          <p style="margin:0;color:#6f6659;line-height:1.7;">${escapeHtml(targetUrl.toString())}</p>
          <p style="margin:10px 0 0;color:#6f6659;line-height:1.7;">Content-Type: ${escapeHtml(contentType || 'unknown')}</p>
        </div>
      </section>
    `,
    {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8'
      }
    }
  );
}

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8'
    }
  });
}

function escapeAttr(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeHtml(value) {
  return escapeAttr(value);
}

function decodeEntities(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
