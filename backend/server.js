// server.js — Express REST API + static frontend serving
import { config as dotenvConfig } from 'dotenv'; dotenvConfig({ override: true });
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import { clerkMiddleware, requireAuth, getAuth } from '@clerk/express';
import { getAllArticles, getArticleById, upsertUser, getWatchlist, addToWatchlist, removeFromWatchlist } from './db.js';
import { startScheduler, runPipeline, isPipelineRunning } from './scheduler.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(clerkMiddleware({
  publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
  secretKey: process.env.CLERK_SECRET_KEY
}));

// ── API Routes ────────────────────────────────────────────────────────────────

// GET /api/articles — list all translated articles
app.get('/api/articles', (req, res) => {
  const articles = getAllArticles({ limit: 100 });
  res.json(articles.map(a => ({
    ...a,
    key_points_en: JSON.parse(a.key_points_en || '[]'),
    key_points_zh: JSON.parse(a.key_points_zh || '[]')
  })));
});

// GET /api/articles/:id — get single article with full content
app.get('/api/articles/:id', (req, res) => {
  const article = getArticleById(parseInt(req.params.id));
  if (!article) return res.status(404).json({ error: 'Not found' });
  res.json({
    ...article,
    key_points_en: JSON.parse(article.key_points_en || '[]'),
    key_points_zh: JSON.parse(article.key_points_zh || '[]')
  });
});

// POST /api/fetch — manually trigger a fetch+translate run (protected)
app.post('/api/fetch', async (req, res) => {
  const secret = process.env.FETCH_SECRET;
  if (secret && req.headers['x-fetch-secret'] !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (isPipelineRunning()) {
    return res.json({ message: 'Pipeline already running — try again shortly' });
  }
  res.json({ message: 'Fetch pipeline started' });
  runPipeline('manual');
});

// POST /api/auth/sync — called after login to store user email in our DB
app.post('/api/auth/sync', requireAuth(), (req, res) => {
  const { userId } = getAuth(req);
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  upsertUser(userId, email);
  res.json({ ok: true });
});

// GET /api/watchlist — get current user's tickers
app.get('/api/watchlist', requireAuth(), (req, res) => {
  const { userId } = getAuth(req);
  const tickers = getWatchlist(userId);
  res.json(tickers);
});

// POST /api/watchlist — add a ticker
app.post('/api/watchlist', requireAuth(), (req, res) => {
  const { userId } = getAuth(req);
  const { ticker } = req.body;
  if (!ticker || !/^[A-Z0-9.]{1,10}$/i.test(ticker.trim())) {
    return res.status(400).json({ error: 'Invalid ticker' });
  }
  addToWatchlist(userId, ticker.trim());
  res.json({ ok: true, ticker: ticker.toUpperCase().trim() });
});

// DELETE /api/watchlist/:ticker — remove a ticker
app.delete('/api/watchlist/:ticker', requireAuth(), (req, res) => {
  const { userId } = getAuth(req);
  removeFromWatchlist(userId, req.params.ticker);
  res.json({ ok: true });
});

// GET /api/status — health check
app.get('/api/status', (req, res) => {
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    timezone: 'America/Toronto'
  });
});

// ── Serve Frontend ────────────────────────────────────────────────────────────

const FRONTEND_DIST = join(__dirname, '../frontend/dist');
const FRONTEND_PUBLIC = join(__dirname, '../frontend');

// Try built dist first, fallback to raw frontend folder
app.use(express.static(FRONTEND_DIST));
app.use(express.static(FRONTEND_PUBLIC));

// SPA fallback — serve index.html for all non-API routes
app.get('*', (req, res) => {
  const indexPaths = [
    join(FRONTEND_DIST, 'index.html'),
    join(FRONTEND_PUBLIC, 'index.html')
  ];
  const found = indexPaths.find(p => existsSync(p));
  if (found) return res.sendFile(found);
  res.status(404).send('Frontend not built. Run: cd frontend && npm run build');
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[server] 🚀 Running at http://localhost:${PORT}`);
  console.log(`[server] API: http://localhost:${PORT}/api/articles`);
  startScheduler();
});
