# 華爾街早報 · WSB Chinese Reader

Auto-fetches Wall Street Breakfast articles from Seeking Alpha, translates them to **Traditional Chinese (繁體中文)**, and sends email notifications when new articles are ready.

## Features
- 📰 Auto-fetches WSB articles at **7:30 AM and 3:00 PM HKT** daily
- 🈶 Translates to Traditional Chinese via Claude AI (strict no-hallucination)
- 💾 Stores raw English source + Chinese translation in SQLite
- 📧 Email notifications when new articles are translated
- 🌐 Responsive web app with EN/中文繁體 toggle
- ✅ Accuracy-first: only translates what's actually in the source

## Quick Start

```bash
# 1. Install dependencies
npm install
npx playwright install chromium

# 2. Set up environment
cp .env.example .env
# Edit .env with your ANTHROPIC_API_KEY, SMTP credentials, and NOTIFY_EMAIL

# 3. Start the server (includes scheduler)
npm start
# → http://localhost:3000

# Manual fetch (run pipeline now)
node backend/scheduler.js --run-now

# Test email
node backend/emailer.js --test
```

## Environment Variables

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Your Anthropic API key |
| `SMTP_HOST` | SMTP server (e.g. smtp.gmail.com) |
| `SMTP_PORT` | SMTP port (587) |
| `SMTP_USER` | SMTP username/email |
| `SMTP_PASS` | SMTP password or app password |
| `NOTIFY_EMAIL` | Where to send article notifications |
| `PORT` | Server port (default: 3000) |
| `TZ` | Timezone: `Asia/Hong_Kong` |
| `SA_COOKIE` | (Optional) Seeking Alpha session cookie JSON for full articles |

## Accuracy Policy
- **Strict no-hallucination**: Only translates content actually present in the source
- Company names, tickers, numbers, and percentages stay in English
- Raw English source stored alongside every translation for verification
- Articles marked `incomplete` if Seeking Alpha paywall blocks full content

## Project Structure
```
backend/
  server.js      — Express API (GET /api/articles, GET /api/articles/:id, POST /api/fetch)
  db.js          — SQLite schema and query helpers
  fetcher.js     — Playwright-based SA article fetcher
  translator.js  — Claude API translation pipeline
  emailer.js     — Nodemailer email notifications
  scheduler.js   — node-cron jobs (7:30am, 3pm HKT)
frontend/
  index.html     — Responsive web app
```
