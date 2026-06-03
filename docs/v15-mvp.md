# Hybrid Explorer v15 MVP

## What changed

v15 replaces iframe browsing with a proxy browser path:

- The left pane is a curated site map.
- The right pane is a reading surface.
- Proxy-mode sites are fetched through `/api/proxy?url=<targetUrl>`.
- Links are rewritten so the browser can keep tracking the updated URL.
- Exploration history is stored in `localStorage`.

## Site modes

- `proxy`: static documents, blogs, reports, knowledge-base pages
- `remote`: Playwright Chromium viewport rendering for higher-fidelity pages
- `external`: 3D maps, booking services, login/search-heavy services, strong JS apps

## MVP list

The initial catalog is defined in [`data/sites.json`](../data/sites.json).

## Files

- [`frontend/index.html`](../frontend/index.html)
- [`frontend/app.js`](../frontend/app.js)
- [`frontend/styles.css`](../frontend/styles.css)
- [`worker/src/index.js`](../worker/src/index.js)
- [`worker/wrangler.toml`](../worker/wrangler.toml)

## Behavior checklist

- Site click switches to read mode automatically.
- Clicking the selected title reloads the first URL for that site.
- `첫화면` reloads the selected site's first URL.
- `URL복사` copies the live `currentUrl`.
- `탐험저장` persists the live `currentUrl` to `localStorage`.
- `원문` opens the live `currentUrl` in a new tab.
- `remote` mode uses a Playwright-backed session and returns the live `currentUrl` from Chromium.
- External sites show a fallback card instead of proxy rendering.
- No iframe is used in the main browsing path.
