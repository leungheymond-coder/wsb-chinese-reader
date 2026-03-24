// fetcher.js — Fetch Wall Street Breakfast articles from Seeking Alpha
// Strategy: RSS feed → Playwright with persistent login session → Claude web search fallback
import { config as dotenvConfig } from 'dotenv'; dotenvConfig({ override: true });
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import Anthropic from '@anthropic-ai/sdk';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

chromium.use(StealthPlugin());
import { upsertArticle, getArticleByUrl, updateFetchedContent, getAllArticles } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || __dirname;
const SESSION_FILE = join(DATA_DIR, 'sa-session.json'); // persisted login cookies
const RSS_URL = 'https://seekingalpha.com/author/wall-street-breakfast.xml';

// Matches all WSB-family article titles published by the WSB author
const WSB_TITLE_RE = /^Wall Street (Breakfast Podcast:|Breakfast:|Lunch:|Brunch:|Week Ahead|Roundup:)|^What Moved Markets This Week/i;

// ── RSS Feed Parser ───────────────────────────────────────────────────────────

export async function fetchArticleList() {
  console.log('[fetcher] Fetching RSS feed...');
  const res = await fetch(RSS_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Accept': 'application/rss+xml, application/xml, text/xml'
    }
  });

  if (!res.ok) throw new Error(`RSS fetch failed: ${res.status}`);

  const xml = await res.text();
  const articles = parseRSS(xml);
  console.log(`[fetcher] Found ${articles.length} WSB articles in RSS`);
  return articles;
}

function parseRSS(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const item = match[1];
    const title = extractTag(item, 'title');
    const link = extractTag(item, 'link') || extractTag(item, 'guid');
    const pubDate = extractTag(item, 'pubDate');

    const cleanTitle = title ? title.replace(/<!\[CDATA\[|\]\]>/g, '').trim() : '';
    if (cleanTitle && link) {
      const articleId = link.match(/article\/(\d+)/)?.[1] || null;
      items.push({
        title_en: cleanTitle,
        sa_url: link.trim(),
        sa_article_id: articleId,
        published_at: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString()
      });
    }
  }
  return items;
}

function extractTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return match ? (match[1] || match[2] || '').trim() : null;
}

// ── Session helpers ───────────────────────────────────────────────────────────

function sessionExists() {
  return existsSync(SESSION_FILE);
}

// ── SA Login ─────────────────────────────────────────────────────────────────

async function loginToSA(page) {
  const email = process.env.SA_EMAIL;
  const password = process.env.SA_PASSWORD;

  if (!email || !password) {
    console.log('[fetcher] SA_EMAIL/SA_PASSWORD not set — skipping login');
    return false;
  }

  console.log(`[fetcher] Logging in to Seeking Alpha as ${email}...`);
  try {
    // Go directly to login page
    await page.goto('https://seekingalpha.com/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    const loginPageTitle = await page.title();
    const loginPageUrl = page.url();
    console.log(`[fetcher] Login page — title: "${loginPageTitle}" url: ${loginPageUrl}`);

    // Log all visible input fields for debugging
    const inputs = await page.evaluate(() =>
      [...document.querySelectorAll('input')].map(i => ({ type: i.type, name: i.name, placeholder: i.placeholder, id: i.id }))
    );
    console.log('[fetcher] Inputs found on page:', JSON.stringify(inputs));

    // Step 1: Enter email (SA uses a two-step form)
    const emailSel = 'input[type="email"], input[name="email"], input[placeholder*="email" i], input[placeholder*="Email" i]';
    await page.waitForSelector(emailSel, { timeout: 10000 });
    await page.fill(emailSel, email);
    await page.waitForTimeout(500);

    // Click Continue/Next to proceed to password step
    const continueSel = 'button:has-text("Continue"), button:has-text("Next"), button[type="submit"]';
    await page.click(continueSel, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // Step 2: Enter password
    const passSel = 'input[type="password"], input[name="password"], input[placeholder*="password" i]';
    await page.waitForSelector(passSel, { timeout: 10000 });
    await page.fill(passSel, password);
    await page.waitForTimeout(500);

    // Submit
    const submitSel = 'button[type="submit"], button:has-text("Sign In"), button:has-text("Log In")';
    await page.click(submitSel, { timeout: 5000 });

    // Wait for login to complete (URL changes away from login page)
    await Promise.race([
      page.waitForURL(url => !url.includes('/login') && !url.includes('/sign-in'), { timeout: 15000 }),
      page.waitForSelector('[data-test-id="user-menu"], [class*="userMenu"], [aria-label="Account menu"]', { timeout: 15000 })
    ]);

    console.log('[fetcher] ✓ Login successful');
    return true;
  } catch (err) {
    console.log(`[fetcher] Login failed: ${err.message}`);
    return false;
  }
}

// ── Block detection ───────────────────────────────────────────────────────────

async function isBlocked(page) {
  const url = page.url();
  const title = await page.title();

  // PerimeterX challenge page
  if (title.includes('Access Denied') || title.includes('Just a moment') || title.includes('Checking your browser')) {
    return true;
  }
  // Redirected to login
  if (url.includes('/login') || url.includes('/sign-in')) {
    return true;
  }
  // Paywall / subscriber-only prompt
  const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 500) || '');
  if (bodyText.includes('Subscribe to') || bodyText.includes('Premium article') || bodyText.includes('Sign In to read')) {
    return true;
  }
  return false;
}

// ── Full Article Fetcher (Playwright) ─────────────────────────────────────────

export async function fetchFullArticle(url) {
  console.log(`[fetcher] Fetching full article: ${url}`);
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-dev-shm-usage',
    ]
  });

  try {
    // Load persisted session if available, otherwise start fresh
    const contextOptions = {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
      viewport: { width: 1440, height: 900 },
      locale: 'en-US',
      timezoneId: 'America/New_York',
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Upgrade-Insecure-Requests': '1'
      }
    };

    if (sessionExists()) {
      contextOptions.storageState = SESSION_FILE;
      console.log('[fetcher] Loaded saved SA session');
    }

    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();

    // Helper: load a page and extract raw article content
    const loadAndExtract = async () => {
      await page.waitForSelector('[data-test-id="article-content"], .article-content, #content', { timeout: 10000 })
        .catch(() => {});
      await page.waitForTimeout(2500);
      return page.evaluate(() => {
        const selectors = [
          '[data-test-id="article-content"]',
          '.article-content-body',
          '[class*="articleBody"]',
          '[class*="article-body"]',
          'article',
        ];
        let articleEl = null;
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el) { articleEl = el; break; }
        }
        if (!articleEl) articleEl = document.querySelector('main');
        if (!articleEl) return { text: '', tickers: [], thumbnailUrl: '' };

        articleEl.querySelectorAll('[class*="ad"], [class*="paywall"], [class*="author-bio"], script, style').forEach(e => e.remove());

        const headerTickerEls = document.querySelectorAll(
          '[data-test-id="post-page-header"] a[href*="/symbol/"], ' +
          '[class*="ArticleHeader"] a[href*="/symbol/"], ' +
          '[class*="article-header"] a[href*="/symbol/"]'
        );
        let tickers = [...new Set([...headerTickerEls].map(a => {
          const m = a.href.match(/\/symbol\/([A-Z][A-Z0-9.]{0,7})/);
          return m ? m[1] : null;
        }).filter(Boolean))];

        if (tickers.length === 0) {
          const rawText = articleEl.innerText;
          const dateLineMatch = rawText.match(/\d{1,2}:\d{2} [AP]M ET([A-Z][A-Z0-9., ]{0,50})(?:\n|$)/);
          if (dateLineMatch) {
            tickers = dateLineMatch[1].split(',').map(t => t.trim()).filter(t => /^[A-Z][A-Z0-9.]{0,7}$/.test(t));
          }
        }

        const thumbnailUrl = document.querySelector('meta[property="og:image"]')?.content || '';
        return { text: articleEl.innerText.trim(), tickers, thumbnailUrl };
      });
    };

    // First attempt
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    let raw = await loadAndExtract();

    const looksPaywalled = (text) => text.length < 500 ||
      text.includes('Subscribe to') ||
      text.includes('Premium article') ||
      text.includes('Sign In to read');

    // If content is short/paywalled or page is blocked → try login and retry
    if (looksPaywalled(raw.text) || await isBlocked(page)) {
      console.log('[fetcher] Content incomplete or session expired — attempting login...');
      const loggedIn = await loginToSA(page);

      if (loggedIn) {
        await context.storageState({ path: SESSION_FILE });
        console.log('[fetcher] Session saved to disk');

        // Retry the article now that we're logged in
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        raw = await loadAndExtract();
      }
    }

    const title = await page.title();
    const isPaywalled = raw.text.length < 500 ||
      raw.text.includes('Subscribe to') ||
      raw.text.includes('Premium article');

    const parsed = parseWSBArticle(raw.text);
    const hasContent = parsed.mainContent.length > 100;

    // Save updated session after every successful fetch
    if (!isPaywalled) {
      await context.storageState({ path: SESSION_FILE }).catch(() => {});
    }

    return {
      title_en: title.replace(' | Seeking Alpha', '').trim(),
      tickers: raw.tickers,
      thumbnail_url: raw.thumbnailUrl || '',
      summary_bullets: parsed.summaryBullets,
      full_content_en: parsed.mainContent,
      catalyst_watch: parsed.catalystWatch,
      fetch_status: (isPaywalled || !hasContent) ? 'incomplete' : 'complete',
      is_paywalled: isPaywalled || !hasContent
    };

  } finally {
    await browser.close();
  }
}

// ── WSB Article Content Parser ───────────────────────────────────────────────

function parseWSBArticle(rawText) {
  const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);

  const SKIP = l => (
    /^\d+[\.\d]*[KMB]?\s*Followers?$/i.test(l) ||
    /^(Subscribe|Follow|Share|Save|Comments?|Podcasts?|Wall Street Breakfast|Seeking Alpha)$/i.test(l) ||
    /^Listen below or on the go/i.test(l) ||
    /^This is an abridged transcript\.?$/i.test(l) ||
    /via (Getty Images|iStock|Shutterstock|AP Photo|Reuters|Bloomberg)/i.test(l) ||
    /©/.test(l) ||
    /^\d+$/.test(l) ||
    /\(\d{2}:\d{2}\)$/.test(l) ||
    // SA boilerplate / anti-bot / UI strings
    /Seeking Alpha'?s flagship daily business newsletter/i.test(l) ||
    /please enable Javascript and cookies/i.test(l) ||
    /Is this happening to you frequently\? Please report it/i.test(l) ||
    /If you have an ad.?blocker enabled/i.test(l) ||
    /Please disable your ad.?blocker and refresh/i.test(l) ||
    /Entering text into the input field will update the search result/i.test(l)
  );

  const summaryIdx    = lines.findIndex(l => l === 'Summary');
  const transcriptIdx = lines.findIndex(l => /This is an abridged transcript/i.test(l));
  const trendingIdx   = lines.findIndex(l => /What.?s Trending on Seeking Alpha/i.test(l));
  const catalystIdx   = lines.findIndex(l => /^Catalyst watch:/i.test(l));
  const economicIdx   = lines.findIndex(l => /^Economic calendar:/i.test(l));

  let summaryBullets = [];
  if (summaryIdx !== -1) {
    const end = transcriptIdx !== -1 ? transcriptIdx : summaryIdx + 20;
    summaryBullets = lines.slice(summaryIdx + 1, end)
      .filter(l => !SKIP(l) && l.length >= 30)
      .slice(0, 5);
  }

  let mainContent = '';
  if (transcriptIdx !== -1) {
    const end = trendingIdx !== -1 ? trendingIdx : (catalystIdx !== -1 ? catalystIdx : lines.length);
    mainContent = lines.slice(transcriptIdx + 1, end)
      .filter(l => !SKIP(l))
      .join('\n\n');
  }

  // Fallback 1: if no transcript marker, use everything after summary bullets as content
  if (!mainContent && summaryIdx !== -1) {
    const end = trendingIdx !== -1 ? trendingIdx : (catalystIdx !== -1 ? catalystIdx : lines.length);
    const startIdx = transcriptIdx !== -1 ? transcriptIdx + 1 : summaryIdx + 1;
    mainContent = lines.slice(startIdx, end)
      .filter(l => !SKIP(l) && l.length >= 20)
      .join('\n\n');
  }

  // Fallback 2: non-podcast articles (no Summary or transcript markers) — use all body text
  if (!mainContent) {
    const end = trendingIdx !== -1 ? trendingIdx : (catalystIdx !== -1 ? catalystIdx : lines.length);
    mainContent = lines.slice(0, end)
      .filter(l => !SKIP(l) && l.length >= 20)
      .join('\n\n');
  }

  let catalystWatch = '';
  if (catalystIdx !== -1) {
    const end = economicIdx !== -1 ? economicIdx : lines.length;
    catalystWatch = lines.slice(catalystIdx + 1, end)
      .filter(l => !SKIP(l))
      .join('\n\n');
  }

  return { summaryBullets, mainContent, catalystWatch };
}

// ── Markdown Cleaner ─────────────────────────────────────────────────────────
// Strips markdown formatting from Tavily raw_content before parsing

function cleanMarkdown(text) {
  return text
    // Remove markdown images: ![alt](url)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '')
    // Remove markdown links: [text](url) → text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    // Remove bare URLs
    .replace(/https?:\/\/\S+/g, '')
    // Remove markdown headings (keep text)
    .replace(/^#{1,6}\s+/gm, '')
    // Remove bold/italic: **text** or *text* or __text__ → text
    .replace(/(\*{1,2}|_{1,2})([^*_]+)\1/g, '$2')
    // Remove horizontal rules
    .replace(/^[-*_]{3,}\s*$/gm, '')
    // Remove markdown navigation artifacts like [Skip to content]
    .replace(/\[Skip to [^\]]+\]/gi, '')
    // Collapse multiple blank lines into one
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── Tavily Extract (direct URL scrape — works for fresh articles) ─────────────

async function fetchArticleViaTavilyExtract(url) {
  if (!process.env.TAVILY_API_KEY) return null;

  console.log(`[fetcher] Trying Tavily extract for: ${url}`);
  try {
    const res = await fetch('https://api.tavily.com/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        urls: [url.split('?')[0]]  // strip query params
      })
    });

    if (!res.ok) {
      console.log(`[fetcher] Tavily extract HTTP ${res.status}`);
      return null;
    }

    const data = await res.json();
    const result = (data.results || [])[0];
    if (!result?.raw_content || result.raw_content.length < 500) {
      console.log('[fetcher] Tavily extract: no usable content');
      return null;
    }

    console.log(`[fetcher] Tavily extract: got ${result.raw_content.length} chars`);
    const cleaned = cleanMarkdown(result.raw_content);
    const parsed = parseWSBArticle(cleaned);
    const content = parsed.mainContent || cleaned;
    return {
      full_content_en: content,
      summary_bullets: parsed.summaryBullets || [],
      catalyst_watch: parsed.catalystWatch || '',
      tickers: [],
      thumbnail_url: result.images?.[0] || result.image || '',
      fetch_status: content.length > 200 ? 'complete' : 'incomplete',
      is_paywalled: false
    };
  } catch (err) {
    console.log(`[fetcher] Tavily extract failed: ${err.message}`);
    return null;
  }
}

// ── Tavily Search Fallback (works for articles indexed 1-2 days ago) ──────────

async function fetchArticleViaTavily(title, url) {
  if (!process.env.TAVILY_API_KEY) return null;

  console.log(`[fetcher] Trying Tavily search for: ${title}`);
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query: `${title} site:seekingalpha.com`,
        search_depth: 'advanced',
        include_raw_content: true,
        max_results: 5
      })
    });

    if (!res.ok) {
      console.log(`[fetcher] Tavily search HTTP ${res.status}`);
      return null;
    }

    const data = await res.json();
    const slug = url.split('?')[0].split('/').pop();
    const results = (data.results || []).filter(r =>
      r.raw_content &&
      r.raw_content.length > 500 &&
      r.url?.includes(slug)
    );
    const match = results[0];

    if (!match) {
      console.log('[fetcher] Tavily search: no usable results');
      return null;
    }

    console.log(`[fetcher] Tavily search: got ${match.raw_content.length} chars from ${match.url}`);
    const cleaned = cleanMarkdown(match.raw_content);
    const parsed = parseWSBArticle(cleaned);
    const content = parsed.mainContent || cleaned;
    console.log(`[fetcher] Tavily search: parsed to ${content.length} chars`);
    return {
      title_en: title,
      full_content_en: content,
      summary_bullets: parsed.summaryBullets || [],
      catalyst_watch: parsed.catalystWatch || '',
      tickers: [],
      thumbnail_url: match.image || '',
      fetch_status: content.length > 200 ? 'complete' : 'incomplete',
      is_paywalled: false
    };
  } catch (err) {
    console.log(`[fetcher] Tavily search failed: ${err.message}`);
    return null;
  }
}

// ── Gemini Web Search Fallback ────────────────────────────────────────────────
// Uses Google Gemini's built-in Google Search grounding to find article content
// Key already in .env as GEMINI_API_KEY — no sign-up needed

async function fetchArticleViaGemini(title, url) {
  if (!process.env.GEMINI_API_KEY) {
    console.log('[fetcher] No GEMINI_API_KEY — skipping Gemini fallback');
    return null;
  }

  console.log(`[fetcher] Trying Gemini web search fallback for: ${title}`);
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `Find and return the FULL text of this Seeking Alpha article: "${title}" (${url}).
Include every paragraph, bullet point, company name, ticker, and number verbatim. Do not summarize or shorten.`
            }]
          }],
          tools: [{ google_search: {} }]
        })
      }
    );

    if (!res.ok) {
      const err = await res.text();
      console.log(`[fetcher] Gemini HTTP ${res.status}: ${err.slice(0, 100)}`);
      return null;
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts
      ?.filter(p => p.text)
      ?.map(p => p.text)
      ?.join('\n')
      ?.trim();

    if (!text || text.length < 300) {
      console.log('[fetcher] Gemini: response too short');
      return null;
    }

    console.log(`[fetcher] Gemini: got ${text.length} chars`);
    return {
      title_en: title,
      full_content_en: text,
      summary_bullets: [],
      tickers: [],
      fetch_status: 'complete',
      is_paywalled: false
    };
  } catch (err) {
    console.log(`[fetcher] Gemini fallback failed: ${err.message}`);
    return null;
  }
}

// ── Claude Web Search Fallback (secondary) ────────────────────────────────────

async function fetchArticleViaClaude(title, url) {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  console.log(`[fetcher] Trying Claude web search fallback for: ${title}`);
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 4000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{
        role: 'user',
        content: `Search for and retrieve the full text of this Seeking Alpha Wall Street Breakfast article: "${title}" (${url}).
Return ALL the article content verbatim — every bullet point, company mention, and number. Do not summarize.`
      }]
    });
    const fullText = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    if (fullText.length < 200) return null;
    return { title_en: title, full_content_en: fullText, summary_bullets: [], tickers: [], fetch_status: 'complete', is_paywalled: false };
  } catch (err) {
    console.log(`[fetcher] Claude fallback failed: ${err.message}`);
    return null;
  }
}

// ── Thumbnail Fetchers ────────────────────────────────────────────────────────

// Layer 1: fetch og:image meta tag directly from SA (lightweight HTTP, no browser)
async function fetchOgImage(url) {
  try {
    const res = await fetch(url.split('?')[0], {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Accept': 'text/html,application/xhtml+xml'
      },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return null;
    const html = await res.text();
    const match = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
                || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    const imgUrl = match?.[1];
    if (imgUrl) console.log(`[fetcher] og:image found: ${imgUrl.slice(0, 60)}...`);
    return imgUrl || null;
  } catch {
    return null;
  }
}

// Layer 2: search Pexels for a relevant stock photo based on article title
async function fetchPexelsImage(title) {
  if (!process.env.PEXELS_API_KEY) return null;
  const query = title
    .replace(/^Wall Street (Breakfast Podcast:|Breakfast:|Lunch:|Brunch:|Week Ahead:|Roundup:)\s*/i, '')
    .replace(/^What Moved Markets This Week\s*/i, '')
    .replace(/[^\w\s]/g, '')
    .trim() || 'Wall Street finance';
  try {
    const res = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=1&orientation=landscape`,
      { headers: { Authorization: process.env.PEXELS_API_KEY } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const imgUrl = data.photos?.[0]?.src?.medium || null;
    if (imgUrl) console.log(`[fetcher] Pexels image found for: "${query}"`);
    return imgUrl;
  } catch {
    return null;
  }
}

// Resolve thumbnail: og:image → Pexels → empty
async function resolveThumbnail(url, title) {
  return (await fetchOgImage(url)) || (await fetchPexelsImage(title)) || '';
}

// ── Web Search Fallback: Tavily → Gemini ─────────────────────────────────────
// Note: Claude refused to reproduce copyrighted article content so it's excluded

export async function fetchArticleViaWebSearch(title, url) {
  return (await fetchArticleViaTavilyExtract(url)) ||
         (await fetchArticleViaTavily(title, url)) ||
         (await fetchArticleViaGemini(title, url));
}

// ── Main: Discover & Fetch New + Retry Incomplete Articles ────────────────────

export async function discoverAndFetchNew() {
  console.log('[fetcher] Starting discovery run...');
  const rssArticles = await fetchArticleList();

  // Process articles from last 2 days (EST) to catch any missed due to downtime
  const now = new Date();
  const yesterdayEST = new Date(now - 24 * 60 * 60 * 1000).toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
  const todayEST = now.toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
  const todaysArticles = rssArticles.filter(a => {
    const articleDate = new Date(a.published_at).toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
    return articleDate === todayEST || articleDate === yesterdayEST;
  });

  console.log(`[fetcher] ${todaysArticles.length} article(s) from last 2 days (${yesterdayEST} – ${todayEST} EST)`);
  let processedCount = 0;

  for (const article of todaysArticles) {
    const existing = getArticleByUrl(article.sa_url);

    // Skip articles already fully fetched
    if (existing && existing.fetch_status === 'complete') continue;

    // Register in DB if new
    if (!existing) upsertArticle(article);
    const row = getArticleByUrl(article.sa_url);

    console.log(`[fetcher] ${existing ? 'Retrying incomplete' : 'New article'}: ${article.title_en}`);

    try {
      let content = null;

      // Try Playwright first — if browser isn't installed (e.g. Railway), skip to fallback
      try {
        content = await fetchFullArticle(article.sa_url);
      } catch (playwrightErr) {
        console.log(`[fetcher] Playwright unavailable — trying web search fallback...`);
      }

      // Fallback to web search if Playwright failed, was blocked, or returned incomplete content
      if (!content || content.is_paywalled || content.fetch_status === 'incomplete') {
        console.log('[fetcher] Trying web search fallback...');
        const fallback = await fetchArticleViaWebSearch(article.title_en, article.sa_url);
        if (fallback) content = fallback;
      }

      // If all methods failed, create an incomplete placeholder
      if (!content) content = { title_en: article.title_en, full_content_en: '', summary_bullets: [], tickers: [], thumbnail_url: '', catalyst_watch: '', fetch_status: 'incomplete', is_paywalled: false };

      // Resolve thumbnail if none found during content fetch
      if (!content.thumbnail_url) {
        content.thumbnail_url = await resolveThumbnail(article.sa_url, article.title_en);
      }

      const resolvedTitle = (content.is_paywalled || !content.full_content_en)
        ? article.title_en
        : (content.title_en || article.title_en);

      const bullets = content.summary_bullets || [];
      updateFetchedContent(row.id, {
        title_en: resolvedTitle,
        tickers: JSON.stringify(content.tickers || []),
        thumbnail_url: content.thumbnail_url || '',
        summary_en: bullets.join(' '),
        key_points_en: JSON.stringify(bullets),
        full_content_en: content.full_content_en || '',
        catalyst_watch_en: content.catalyst_watch || '',
        fetch_status: content.fetch_status
      });
      console.log(`[fetcher] ✓ Fetched: ${article.title_en} (${content.fetch_status})`);
      processedCount++;
    } catch (err) {
      console.error(`[fetcher] ✗ Failed to fetch ${article.sa_url}:`, err.message);
      updateFetchedContent(row.id, {
        title_en: article.title_en,
        tickers: '[]',
        thumbnail_url: '',
        summary_en: '',
        key_points_en: '[]',
        full_content_en: '',
        catalyst_watch_en: '',
        fetch_status: 'failed'
      });
    }

    await new Promise(r => setTimeout(r, 2000));
  }

  console.log(`[fetcher] Done. ${processedCount} article(s) fetched/retried.`);
  return processedCount;
}

// CLI usage: node backend/fetcher.js
if (process.argv[1]?.includes('fetcher')) {
  discoverAndFetchNew().catch(console.error);
}
