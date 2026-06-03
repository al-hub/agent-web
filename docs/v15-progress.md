# Hybrid Explorer v15 Progress

## Current State

Hybrid Explorer v15 now has two distinct browsing paths:

- `proxy`: Cloudflare Worker HTML fetch, sanitization, and link rewrite
- `remote`: Playwright Chromium viewport rendering through the local Node dev server

The main browsing path no longer depends on an iframe for `remote`.

## Major Changes Completed

### 1. Playwright remote service added

`dev-server.js` now manages remote browser sessions with:

- singleton Playwright Chromium launch
- one browser context and page per remote session
- session cleanup with idle timeout
- request blocking for media and tracking resources
- local Chromium shared library wiring through `.chromium-libs`

### 2. Remote mode changed from fragment render to viewport render

The old `remote` path used:

- Playwright page load
- HTML extraction
- fragment re-render in the frontend

The new `remote` path uses:

- Playwright page load
- screenshot frame delivery through `/api/remote/session/:id/frame`
- browser-side click, scroll, resize, and navigate APIs
- frontend image viewport with coordinate-based interaction

### 3. Remote APIs expanded

The local remote service now supports:

- `POST /api/remote/session`
- `GET /api/remote/session/:id`
- `POST /api/remote/session/:id/navigate`
- `POST /api/remote/session/:id/click`
- `POST /api/remote/session/:id/scroll`
- `POST /api/remote/session/:id/resize`
- `GET /api/remote/session/:id/frame`
- `DELETE /api/remote/session/:id`

Remote session payload now returns:

- `sessionId`
- `status`
- `kind`
- `currentUrl`
- `title`
- `viewport`

### 4. Frontend remote UI updated

The remote viewer now renders:

- a screenshot-based viewport image
- a loading overlay during remote actions
- session, status, and current URL metadata

Remote interaction is now driven by:

- image click to `POST /click`
- wheel scroll to `POST /scroll`
- size observation to `POST /resize`
- URL input and `첫화면` to `POST /navigate`

## Verification Completed

The following behaviors were verified against the local dev server:

- proxy mode renders for a proxy site
- external mode shows fallback UI
- remote mode loads a viewport image
- remote mode keeps the main browsing path free of iframe usage
- remote viewport click updates `currentUrl`
- `URL복사` copies the latest `currentUrl`
- `탐험저장` stores the latest `currentUrl`
- `첫화면` resets to the selected site's first URL
- `원문` opens the live `currentUrl`

Validated remote target during testing:

- `Nautilus`

## Known Limits

- `remote` currently uses screenshot refresh, not live streaming
- keyboard input is not implemented
- drag, text selection, hover-only menus, and complex gestures are not implemented
- click accuracy depends on the displayed viewport scale and target size
- the Playwright-backed remote service currently lives in `dev-server.js`, not in the Worker

## Next Practical Options

1. Improve remote interaction fidelity:
add keyboard input, better click calibration, and optional double-click or drag support.

2. Expand remote site verification:
test `Visual Capitalist` and identify per-site viewport quirks.

3. Split the remote service out of `dev-server.js`:
move Playwright session code into a dedicated module once behavior is stable.
