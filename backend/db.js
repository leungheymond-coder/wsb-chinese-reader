// db.js — SQLite database setup and query helpers
// Uses Node 24's built-in node:sqlite (no native compilation needed)
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || __dirname;
const DB_PATH = join(DATA_DIR, 'wsb.db');

const db = new DatabaseSync(DB_PATH);

// Enable WAL mode for better concurrency
db.exec('PRAGMA journal_mode = WAL');

// Create articles table
db.exec(`
  CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sa_url TEXT UNIQUE NOT NULL,
    sa_article_id TEXT,
    title_en TEXT,
    title_zh TEXT,
    summary_en TEXT,
    summary_zh TEXT,
    key_points_en TEXT,       -- JSON array of strings
    key_points_zh TEXT,       -- JSON array of strings
    full_content_en TEXT,     -- Raw fetched English (source of truth)
    full_content_zh TEXT,     -- Full Traditional Chinese translation
    published_at TEXT,
    fetched_at TEXT,
    translated_at TEXT,
    fetch_status TEXT DEFAULT 'pending',   -- pending | complete | incomplete | failed
    translate_status TEXT DEFAULT 'pending', -- pending | complete | failed
    email_sent INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// Add new columns if they don't exist (SQLite ALTER TABLE has no IF NOT EXISTS)
['tickers', 'catalyst_watch_en', 'catalyst_watch_zh', 'thumbnail_url'].forEach(col => {
  try { db.exec(`ALTER TABLE articles ADD COLUMN ${col} TEXT DEFAULT ''`); } catch {}
});

// Indexes
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_published_at ON articles(published_at DESC);
  CREATE INDEX IF NOT EXISTS idx_fetch_status ON articles(fetch_status);
  CREATE INDEX IF NOT EXISTS idx_email_sent ON articles(email_sent);
`);

// ── Queries ──────────────────────────────────────────────────────────────────

export function getAllArticles({ lang = 'zh', limit = 50 } = {}) {
  return db.prepare(`
    SELECT id, sa_url, title_en, title_zh, summary_en, summary_zh,
           key_points_en, key_points_zh, tickers, thumbnail_url, published_at, fetched_at, translated_at,
           fetch_status, translate_status
    FROM articles
    WHERE translate_status = 'complete'
    ORDER BY published_at DESC
    LIMIT ?
  `).all(limit);
}

export function getArticleById(id) {
  return db.prepare(`SELECT * FROM articles WHERE id = ?`).get(id);
}

export function getArticleByUrl(url) {
  return db.prepare(`SELECT * FROM articles WHERE sa_url = ?`).get(url);
}

export function upsertArticle(data) {
  const stmt = db.prepare(`
    INSERT INTO articles (sa_url, sa_article_id, title_en, published_at, fetch_status)
    VALUES (@sa_url, @sa_article_id, @title_en, @published_at, 'pending')
    ON CONFLICT(sa_url) DO NOTHING
  `);
  return stmt.run(data);
}

export function updateFetchedContent(id, data) {
  const stmt = db.prepare(`
    UPDATE articles SET
      title_en = @title_en,
      tickers = @tickers,
      thumbnail_url = @thumbnail_url,
      summary_en = @summary_en,
      key_points_en = @key_points_en,
      full_content_en = @full_content_en,
      catalyst_watch_en = @catalyst_watch_en,
      fetched_at = datetime('now'),
      fetch_status = @fetch_status
    WHERE id = @id
  `);
  return stmt.run({ ...data, id });
}

export function updateTranslation(id, data) {
  const stmt = db.prepare(`
    UPDATE articles SET
      title_zh = @title_zh,
      summary_zh = @summary_zh,
      key_points_zh = @key_points_zh,
      full_content_zh = @full_content_zh,
      catalyst_watch_zh = @catalyst_watch_zh,
      translated_at = datetime('now'),
      translate_status = @translate_status
    WHERE id = @id
  `);
  return stmt.run({ ...data, id });
}

export function updateKeyPointsEn(id, keyPointsJson) {
  return db.prepare(`UPDATE articles SET key_points_en = ? WHERE id = ?`).run(keyPointsJson, id);
}

export function markEmailSent(id) {
  return db.prepare(`UPDATE articles SET email_sent = 1 WHERE id = ?`).run(id);
}

export function getPendingTranslations() {
  return db.prepare(`
    SELECT * FROM articles
    WHERE fetch_status = 'complete' AND translate_status = 'pending'
    ORDER BY published_at ASC
  `).all();
}

export function getUnnotifiedArticles() {
  return db.prepare(`
    SELECT * FROM articles
    WHERE translate_status = 'complete' AND email_sent = 0
    ORDER BY published_at ASC
  `).all();
}

export default db;
