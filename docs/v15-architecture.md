# Hybrid Explorer v15 Architecture

## Problem

iframe cannot reliably track navigation URLs across origins.

## Solution

Proxy Browser

Frontend
+
Cloudflare Worker
+
HTML link rewriting

Flow:

Site Click
→ Proxy Request
→ Worker Fetch
→ HTML Sanitization
→ Link Rewrite
→ Render
→ URL Tracking
→ URL Copy
→ Exploration Save

## Worker Endpoint

/api/proxy?url=<targetUrl>

## Future

v16: Readability.js
v17: Worldview Graph
v18: GitHub Markdown Export
v19: AI Curator
v20: Personal Worldview OS
