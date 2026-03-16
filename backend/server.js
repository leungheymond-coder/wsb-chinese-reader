// server.js — Express REST API + static frontend serving
import { config as dotenvConfig } from 'dotenv'; dotenvConfig({ override: true });
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import { getAllArticles, getArticleById } from './db.js';
import { discoverAndFetchNew } from './fetcher.js';
import { translatePending } from './translator.js';
import { notifyPending } from './emailer.js';
import { startScheduler } from './scheduler.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

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

// POST /api/fetch — manually trigger a fetch+translate run
app.post('/api/fetch', async (req, res) => {
  res.json({ message: 'Fetch pipeline started' });
  // Run async, don't block response
  try {
    await discoverAndFetchNew();
    await translatePending();
    await notifyPending();
  } catch (err) {
    console.error('[server] Manual fetch error:', err);
  }
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
