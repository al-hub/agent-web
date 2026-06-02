# AGENTS.md

## Project

This repository is for **Hybrid Explorer v15**, a personal worldview exploration browser.

The preferred UX comes from the v13 direction:

- Left pane: curated site map.
- Right pane: exploration window.
- Site click automatically switches to read mode.
- Simple buttons: `첫화면`, `URL복사`, `탐험저장`, `원문`.
- Exploration history is stored in `localStorage`.

## Core Problem

Do not rely on iframe as the main browsing engine.

iframe limitations:

- Many sites block embedding.
- Parent page cannot read cross-origin iframe navigation URL.
- URL copy remains stuck at initial URL.
- Browser security prevents reliable deep-link tracking.

## v15 Goal

Replace iframe with a **Proxy Browser** architecture.

Required deliverables:

- `frontend/index.html`
- `frontend/app.js`
- `frontend/styles.css`
- `worker/src/index.js`
- `worker/wrangler.toml`
- `data/sites.json`
- docs in `docs/`

The frontend calls a Cloudflare Worker endpoint:

```text
/api/proxy?url=<targetUrl>
```

The worker fetches target HTML, sanitizes it, rewrites links, and returns an HTML fragment.

## Required UX

Right top buttons:

1. `첫화면`
2. `URL복사`
3. `탐험저장`
4. `원문`

Rules:

- No KR button.
- No tracking link card UI.
- No iframe in the main browsing path.
- Mode badges must be tiny and non-intrusive.
- Site click should switch to read mode automatically.
- Clicking the right title should reload the selected site's first URL inside the proxy view.

## Site Mode Policy

Use `proxy` for static document sites, blogs, reports, and knowledge-base pages.

Use `reader` for image-heavy magazines, chart-heavy sites, and pages where CSS/JS is likely to break.

Use `external` for 3D maps, booking sites, login/search-heavy services, and strong JavaScript apps.

## MVP Proxy Sites

Start with:

- GeekNews
- Simon Willison
- HORIZON
- Quanta Magazine
- KDI
- KIET
- World History Encyclopedia
- The Marginalian
- Morgan Housel
- 서울사랑

## Testing Checklist

- Site click switches to read mode.
- Proxy page renders for a proxy-mode site.
- Clicking a rewritten link updates `currentUrl`.
- `URL복사` copies updated `currentUrl`.
- `탐험저장` stores updated `currentUrl`.
- `첫화면` reloads `currentSite.url`.
- `원문` opens `currentUrl`.
- External-mode sites show fallback card.
- No iframe is used as the main browsing engine.
