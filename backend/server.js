// server.js — Express REST API + static frontend serving
import { config as dotenvConfig } from 'dotenv'; dotenvConfig({ override: true });
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import db, { getAllArticles, getArticleById } from './db.js';
import { startScheduler, runPipeline, isPipelineRunning } from './scheduler.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

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

// POST /api/migrate — one-time import of articles (protected, remove after use)
app.post('/api/migrate', (req, res) => {
  const secret = process.env.FETCH_SECRET;
  if (secret && req.headers['x-fetch-secret'] !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const articles = req.body;
  if (!Array.isArray(articles)) return res.status(400).json({ error: 'Expected array of articles' });

  const insert = db.prepare(`
    INSERT OR IGNORE INTO articles (
      sa_url, sa_article_id, title_en, title_zh,
      summary_en, summary_zh, key_points_en, key_points_zh,
      full_content_en, full_content_zh,
      catalyst_watch_en, catalyst_watch_zh,
      tickers, thumbnail_url,
      published_at, fetched_at, translated_at,
      fetch_status, translate_status, email_sent
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `);

  let inserted = 0, skipped = 0;
  for (const a of articles) {
    const result = insert.run(
      a.sa_url, a.sa_article_id, a.title_en, a.title_zh,
      a.summary_en, a.summary_zh, a.key_points_en, a.key_points_zh,
      a.full_content_en, a.full_content_zh,
      a.catalyst_watch_en, a.catalyst_watch_zh,
      a.tickers, a.thumbnail_url,
      a.published_at, a.fetched_at, a.translated_at,
      a.fetch_status, a.translate_status, a.email_sent ?? 1
    );
    result.changes > 0 ? inserted++ : skipped++;
  }
  res.json({ inserted, skipped });
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
