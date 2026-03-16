// translator.js — Translate WSB articles to Traditional Chinese (HK style)
// Uses Claude API with full HK financial translation rules
import { config as dotenvConfig } from 'dotenv'; dotenvConfig({ override: true });
import Anthropic from '@anthropic-ai/sdk';
import { getPendingTranslations, updateTranslation, updateKeyPointsEn } from './db.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Program title mapping ─────────────────────────────────────────────────────

const PROGRAM_TITLES = {
  'Wall Street Breakfast': '華爾街早市快訊',
  'Wall Street Lunch':     '華爾街午間財經',
  'Wall Street Brunch':    '華爾街投資動向',
  'Wall Street Roundup':   '華爾街收市總結',
  'Wall Street RoundUp':   '華爾街收市總結',
  'What Moved Markets This Week': '本週市場焦點',
  'Wall Street Week Ahead': '華爾街下週前瞻',
};

function getProgramTitle(titleEn) {
  for (const [key, val] of Object.entries(PROGRAM_TITLES)) {
    if (titleEn.toLowerCase().includes(key.toLowerCase())) return val;
  }
  return null; // no prefix for standalone articles
}

// ── Claude translation system prompt ─────────────────────────────────────────

const SYSTEM_PROMPT = `You are a professional financial translator for Hong Kong media.
Translate English Wall Street financial articles into Traditional Chinese for Hong Kong readers.
Your style should resemble 信報, 經濟日報, Now 財經, Bloomberg 中文版, Reuters 中文.
Tone: professional, neutral, concise.

STRICT RULES — follow exactly:

1. LANGUAGE: Traditional Chinese (HK) ONLY. Never use Simplified Chinese.
   - Correct: 市場、投資、經濟、企業、業績
   - Wrong: 市场、投资、经济、企业、业绩

2. KEEP IN ENGLISH (do not translate):
   - Company names: Oracle, Apple, Microsoft, Goldman Sachs, etc.
     ✅ "Oracle 公布季度業績"  ❌ "甲骨文公布季度業績"
   - Stock tickers: ORCL, AAPL, CVX, TSLA — keep exactly as written
   - People names: Jerome Powell, Donald Trump, Rena Sherbill, etc.
     ✅ "聯儲局主席 Jerome Powell 表示"
   - Numbers, percentages, dollar amounts: $17.19B, +22%, $449.99

3. TICKERS: Never include stock tickers in the article title.
   ✅ Title: "Oracle 業績勝預期 股價急升"
   ❌ Title: "Oracle (ORCL) 業績勝預期 股價急升"

4. FAITHFUL TRANSLATION:
   - Translate paragraph by paragraph
   - Preserve paragraph structure and line breaks
   - Do NOT summarize, condense, or add context
   - Do NOT invent data, numbers, or background information

5. HK FINANCIAL TERMINOLOGY (use these, not mainland equivalents):
   - Federal Reserve → 聯儲局 (not 美联储)
   - Interest rates → 利率
   - Earnings → 業績
   - Revenue → 收入
   - Shares / Stock price → 股價
   - Investors → 投資者
   - Market → 市場
   - Quarter → 季度
   - Fiscal year → 財年
   - Guidance → 業績指引
   - Beat estimates → 勝預期
   - Miss estimates → 遜預期
   - Premarket → 盤前
   - Year over year → 按年

Return ONLY the translated text with no explanation or commentary.`;

// ── Claude translation call ───────────────────────────────────────────────────

async function claudeTranslate(text, context = '') {
  if (!text || text.trim().length < 3) return text;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: context
        ? `Translate this ${context} to Traditional Chinese (HK):\n\n${text}`
        : `Translate to Traditional Chinese (HK):\n\n${text}`
    }]
  });

  return response.content[0]?.text?.trim() || text;
}

// ── Translate full content in paragraphs ──────────────────────────────────────

async function translateFullContent(content) {
  const paragraphs = content.split('\n\n').filter(Boolean);
  console.log(`[translator] Translating ${paragraphs.length} paragraphs...`);

  // Batch paragraphs into chunks of ~8000 chars to reduce API calls
  const BATCH_CHARS = 8000;
  const batches = [];
  let currentBatch = [];
  let currentLen = 0;

  for (const p of paragraphs) {
    if (currentLen + p.length > BATCH_CHARS && currentBatch.length > 0) {
      batches.push(currentBatch);
      currentBatch = [p];
      currentLen = p.length;
    } else {
      currentBatch.push(p);
      currentLen += p.length;
    }
  }
  if (currentBatch.length > 0) batches.push(currentBatch);

  const translatedBatches = [];
  for (let i = 0; i < batches.length; i++) {
    const batchText = batches[i].join('\n\n');
    const translated = await claudeTranslate(batchText, 'article content');
    translatedBatches.push(translated);
    if (i < batches.length - 1) await new Promise(r => setTimeout(r, 500));
  }

  return translatedBatches.join('\n\n');
}

// ── Generate key points via Claude ───────────────────────────────────────────

function hasGoodKeyPoints(keyPointsJson) {
  try {
    const kp = JSON.parse(keyPointsJson || '[]');
    if (kp.length === 0) return false;
    const hasTimestamps = kp.some(p => /\(\d+:\d{2}\)/.test(p));
    const hasDialogue = kp.some(p => /^[A-Z][a-z]+ [A-Z][a-z]+:/.test(p.trim()));
    return !hasTimestamps && !hasDialogue;
  } catch { return false; }
}

async function generateKeyPoints(title, fullContent) {
  console.log('[translator] Generating key points via Claude...');
  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 800,
      messages: [{
        role: 'user',
        content: `Read this Wall Street financial news article and write 3-5 concise summary bullet points in English.

Rules:
- Each bullet must be a complete sentence capturing a key market insight or news item
- Keep ALL company names, stock tickers (e.g. ORCL, CVX), numbers, and percentages in English
- Focus on the most important market-moving facts
- Return plain sentences only, one per line, no bullet symbols

Article title: ${title}

Article content:
${fullContent.slice(0, 4000)}`
      }]
    });

    const text = response.content[0]?.text?.trim() || '';
    const bullets = text.split('\n').map(l => l.replace(/^[-•*\d.]+\s*/, '').trim()).filter(l => l.length > 30);
    if (bullets.length === 0) return null;
    console.log(`[translator] Generated ${bullets.length} key points`);
    return bullets;
  } catch (err) {
    console.log(`[translator] Key point generation failed: ${err.message}`);
    return null;
  }
}

// ── Build translated title with program prefix ────────────────────────────────

async function translateTitle(titleEn) {
  const programPrefix = getProgramTitle(titleEn);

  // Strip the "Wall Street Breakfast Podcast:" part to get just the story title
  const storyTitle = titleEn
    .replace(/^Wall Street (Breakfast Podcast|Breakfast|Lunch|Brunch|Roundup|RoundUp|Week Ahead):\s*/i, '')
    .replace(/^What Moved Markets This Week\s*/i, '')
    .trim();

  // If no story title (e.g. bare series name), just return the prefix
  if (!storyTitle && programPrefix) return programPrefix;

  // For standalone articles with no series prefix, translate the full title
  const titleToTranslate = storyTitle || titleEn;

  // Translate story title, ensuring no tickers in output
  const translatedStory = await claudeTranslate(
    `Translate this financial article title to Traditional Chinese (HK style). Keep company names in English. Do NOT include stock tickers. Return only the translated title, nothing else:\n\n${titleToTranslate}`,
    'title'
  );

  // Strip any accidentally included tickers from title (e.g. "(ORCL)")
  const cleanTitle = translatedStory.replace(/\([A-Z]{1,5}\)/g, '').trim();

  return programPrefix ? `${programPrefix}：${cleanTitle}` : cleanTitle;
}

// ── Translate a single article ────────────────────────────────────────────────

export async function translateArticle(article) {
  console.log(`[translator] Translating: ${article.title_en}`);

  if (!article.full_content_en || article.full_content_en.length < 50) {
    console.log(`[translator] Skipping — insufficient source content`);
    return false;
  }

  try {
    // 1. Title with program prefix
    const titleZh = await translateTitle(article.title_en);
    await new Promise(r => setTimeout(r, 300));

    // 2. Key points — generate if missing/bad, then translate
    let kpEn = JSON.parse(article.key_points_en || '[]');
    if (!hasGoodKeyPoints(article.key_points_en)) {
      const generated = await generateKeyPoints(article.title_en, article.full_content_en);
      if (generated) {
        kpEn = generated;
        updateKeyPointsEn(article.id, JSON.stringify(kpEn));
      }
    }

    // Translate all key points in a single API call
    const keyPointsZh = [];
    if (kpEn.length > 0) {
      const numbered = kpEn.map((kp, i) => `${i + 1}. ${kp}`).join('\n');
      const result = await claudeTranslate(numbered, 'summary bullet points (return same numbered format, one per line)');
      const lines = result.split('\n').map(l => l.replace(/^\d+\.\s*/, '').trim()).filter(Boolean);
      keyPointsZh.push(...(lines.length === kpEn.length ? lines : lines));
    }

    // 3. Summary (first bullet join as summary_zh)
    const summaryZh = keyPointsZh.length > 0 ? keyPointsZh[0] : '';

    // 4. Full article
    const fullZh = await translateFullContent(article.full_content_en);

    // 5. Catalyst watch (if present)
    let catalystZh = '';
    if (article.catalyst_watch_en) {
      catalystZh = await translateFullContent(article.catalyst_watch_en);
    }

    updateTranslation(article.id, {
      title_zh: titleZh,
      summary_zh: summaryZh,
      key_points_zh: JSON.stringify(keyPointsZh),
      full_content_zh: fullZh,
      catalyst_watch_zh: catalystZh,
      translate_status: 'complete'
    });

    console.log(`[translator] ✓ Translated: ${titleZh}`);
    return true;

  } catch (err) {
    console.error(`[translator] ✗ Failed: ${article.title_en}`, err.message);
    updateTranslation(article.id, {
      title_zh: '',
      summary_zh: '',
      key_points_zh: '[]',
      full_content_zh: '',
      catalyst_watch_zh: '',
      translate_status: 'failed'
    });
    return false;
  }
}

// ── Main: Translate all pending articles ─────────────────────────────────────

export async function translatePending() {
  const pending = getPendingTranslations();
  console.log(`[translator] ${pending.length} articles pending translation`);

  let translated = 0;
  for (const article of pending) {
    const ok = await translateArticle(article);
    if (ok) translated++;
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`[translator] Done. ${translated}/${pending.length} translated.`);
  return translated;
}

// CLI usage: node backend/translator.js
if (process.argv[1]?.includes('translator')) {
  translatePending().catch(console.error);
}
