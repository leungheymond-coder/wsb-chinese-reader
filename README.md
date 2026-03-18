# 華爾街早報 · WSB Chinese Reader

Auto-fetches Wall Street Breakfast articles from Seeking Alpha, translates them to **Traditional Chinese (繁體中文, HK style)**, and sends email notifications when new articles are ready.

## Features
- 📰 Auto-fetches WSB articles at **7:30 AM and 1:30 PM EST** daily
- 🈶 Translates to Traditional Chinese (HK) via Claude AI — strict no-hallucination policy
- 💾 Stores raw English source + Chinese translation in SQLite
- 📧 Email notifications via Resend when new articles are translated
- 🌐 Responsive web app with EN/中文繁體 language toggle
- 🖼 Thumbnails from SA og:image with Pexels fallback

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Set up environment
cp .env.example .env
# Edit .env with your API keys

# 3. Start the server
npm start
# → http://localhost:3000
```

## Environment Variables

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API key (translation) |
| `GEMINI_API_KEY` | Gemini API key (article fetch fallback) |
| `TAVILY_API_KEY` | Tavily API key (article content fetching) |
| `RESEND_API_KEY` | Resend API key (email notifications) |
| `NOTIFY_EMAIL` | Where to send article notifications |
| `APP_URL` | Your app's public URL (for email deep links) |
| `SA_EMAIL` | Seeking Alpha login email (Playwright, currently blocked) |
| `SA_PASSWORD` | Seeking Alpha password |
| `PORT` | Server port (default: 3000) |
| `TZ` | Timezone: `America/Toronto` |
| `DATA_DIR` | SQLite DB directory (Railway: `/data`) |
| `FETCH_SECRET` | Protects `/api/fetch` from public abuse |
| `VITE_FETCH_SECRET` | Same value — baked into frontend build |
| `VITE_SHOW_FETCH_BUTTON` | Set `true` locally to show manual fetch button |

## Content Fetching Pipeline
1. **Playwright** — blocked by SA PerimeterX on Railway, falls through
2. **Tavily Extract** — direct URL scrape, works ~65% for same-day articles
3. **Tavily Search** — indexed content, works for articles 1–2 days old
4. **Gemini** (`gemini-2.5-flash`) — last resort, returns summaries only

## Accuracy Policy
- **Strict no-hallucination**: Only translates content actually present in the source
- Company names, tickers, numbers stay in English
- Articles marked `incomplete` if full content cannot be fetched
- Raw English source stored alongside every translation for verification

## Project Structure
```
backend/
  server.js      — Express API + static file serving
  db.js          — SQLite schema and query helpers
  fetcher.js     — Article fetcher (Playwright → Tavily → Gemini)
  translator.js  — Claude API translation pipeline (HK Traditional Chinese)
  emailer.js     — Resend email notifications
  scheduler.js   — node-cron jobs (7:30 AM, 1:30 PM EST)
frontend/
  src/App.jsx             — Main app with listing + detail routing
  src/components/         — ArticleList, ArticleDetail
```
