# Remote Browser Viewport

## Purpose

`remote` is the high-fidelity fallback layer for sites where the proxy browser diverges too far from the original page.

The goal is to preserve:

- the site’s own rendering behavior
- accurate live URL tracking
- `URL복사`
- `탐험저장`
- `첫화면`

## Architecture

The current implementation uses:

- a singleton Playwright Chromium process in `dev-server.js`
- one browser context and page per remote session
- server-side navigation, click, scroll, and resize control
- screenshot refresh through `/api/remote/session/:id/frame`
- a frontend viewport that sends coordinates back to the server

This keeps the app state simple while showing the original page much more faithfully.

## API surface

The frontend manages a small remote session record through:

- `POST /api/remote/session`
- `GET /api/remote/session/:id`
- `POST /api/remote/session/:id/navigate`
- `POST /api/remote/session/:id/click`
- `POST /api/remote/session/:id/scroll`
- `POST /api/remote/session/:id/resize`
- `GET /api/remote/session/:id/frame`
- `DELETE /api/remote/session/:id`

The server returns a session payload with:

- `sessionId`
- `status`
- `currentUrl`
- `title`
- `viewport`

The frontend renders the latest frame directly in the right pane and uses the returned `currentUrl` for `URL복사`, `탐험저장`, `첫화면`, and `원문`.

## MVP site candidates

- Nautilus
- Visual Capitalist

These are the first sites to test as `remote` because they are the most likely to differ from the proxy browser.

Aeon is excluded from the remote set because it commonly triggers Vercel security checks in this environment and is better handled as `external`.
