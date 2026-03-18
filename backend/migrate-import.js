// migrate-import.js — One-time script to import articles from a JSON export into the DB
// Usage: railway run node backend/migrate-import.js
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config as dotenvConfig } from 'dotenv'; dotenvConfig({ override: true });
import { DatabaseSync } from 'node:sqlite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || __dirname;
const DB_PATH = join(DATA_DIR, 'wsb.db');

const db = new DatabaseSync(DB_PATH);

// Read export file (passed as arg or default path)
const exportPath = process.argv[2] || '/tmp/wsb-articles-export.json';
const articles = JSON.parse(readFileSync(exportPath, 'utf8'));

console.log(`[migrate] DB path: ${DB_PATH}`);
console.log(`[migrate] Importing ${articles.length} articles...`);

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
    ?, ?, ?, ?,
    ?, ?, ?, ?,
    ?, ?,
    ?, ?,
    ?, ?,
    ?, ?, ?,
    ?, ?, ?
  )
`);

let inserted = 0;
let skipped = 0;

for (const a of articles) {
  const result = insert.run(
    a.sa_url, a.sa_article_id, a.title_en, a.title_zh,
    a.summary_en, a.summary_zh, a.key_points_en, a.key_points_zh,
    a.full_content_en, a.full_content_zh,
    a.catalyst_watch_en, a.catalyst_watch_zh,
    a.tickers, a.thumbnail_url,
    a.published_at, a.fetched_at, a.translated_at,
    a.fetch_status, a.translate_status, a.email_sent
  );
  if (result.changes > 0) {
    inserted++;
    console.log(`  ✓ Imported: ${a.title_en?.slice(0, 60)}`);
  } else {
    skipped++;
    console.log(`  — Skipped (already exists): ${a.title_en?.slice(0, 60)}`);
  }
}

console.log(`\n[migrate] Done — ${inserted} inserted, ${skipped} skipped.`);
