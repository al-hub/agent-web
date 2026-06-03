# Agent Web

Hybrid Explorer v15

A personal worldview exploration browser.

## Current Direction

- v13 layout retained
- iframe removed from the main browsing path
- proxy browser endpoint at `/api/proxy?url=<targetUrl>`
- URL tracking, URL copy, and exploration history enabled

## Entry Points

- [`frontend/index.html`](frontend/index.html)
- [`frontend/app.js`](frontend/app.js)
- [`frontend/styles.css`](frontend/styles.css)
- [`worker/src/index.js`](worker/src/index.js)
- [`worker/wrangler.toml`](worker/wrangler.toml)

## Reference Docs

- [`AGENTS.md`](AGENTS.md)
- [`docs/v15-architecture.md`](docs/v15-architecture.md)
- [`docs/v15-mvp.md`](docs/v15-mvp.md)
- [`docs/remote-browser.md`](docs/remote-browser.md)
- [`docs/site-map.md`](docs/site-map.md)
- [`docs/site-mode-decision-table.md`](docs/site-mode-decision-table.md)

## Local Dev

Run the combined frontend + proxy dev server:

```bash
npm run dev
```

Open:

```text
http://localhost:3000/
```

If you are in WSL and `localhost` does not resolve from the Windows browser, use the WSL IP instead:

```bash
hostname -I
```

Then open:

```text
http://<wsl-ip>:3000/
```
