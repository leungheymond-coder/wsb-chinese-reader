// alerter.js — Scan articles for watchlisted tickers and send email alerts
import { config as dotenvConfig } from 'dotenv'; dotenvConfig({ override: true });
import { Resend } from 'resend';
import { getAllWatchlistsWithEmail, getArticleById } from './db.js';

const resend = new Resend(process.env.RESEND_API_KEY);
const APP_URL = process.env.APP_URL || 'http://localhost:3000';

// Scan a newly translated article for watchlisted tickers and send alerts
export async function scanAndAlert(articleId) {
  const article = getArticleById(articleId);
  if (!article) return;

  const subscriptions = getAllWatchlistsWithEmail();
  if (!subscriptions.length) return;

  // Build a map: ticker → [emails]
  const tickerMap = {};
  for (const { clerk_user_id, ticker, email } of subscriptions) {
    if (!tickerMap[ticker]) tickerMap[ticker] = [];
    tickerMap[ticker].push(email);
  }

  // Check which watched tickers appear in this article
  const content = `${article.title_en || ''} ${article.full_content_en || ''} ${article.tickers || ''}`;
  const matched = new Map(); // email → [tickers]

  for (const [ticker, emails] of Object.entries(tickerMap)) {
    // Match ticker as a whole word (avoids partial matches like "AI" in "PAID")
    const re = new RegExp(`\\b${ticker}\\b`, 'i');
    if (re.test(content)) {
      for (const email of emails) {
        if (!matched.has(email)) matched.set(email, []);
        matched.get(email).push(ticker);
      }
    }
  }

  if (!matched.size) return;

  console.log(`[alerter] ${matched.size} user(s) to notify for article ${articleId}`);

  for (const [email, tickers] of matched.entries()) {
    await sendTickerAlert(email, tickers, article);
    await new Promise(r => setTimeout(r, 200)); // avoid rate limits
  }
}

async function sendTickerAlert(email, tickers, article) {
  const tickerList = tickers.join('、');
  const articleUrl = `${APP_URL}/#/article/${article.id}`;
  const titleZh = article.title_zh || article.title_en;
  const titleEn = article.title_en;

  const subject = `🔔 ${tickerList} 出現於今日華爾街早報`;

  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto; color: #090a0c;">
      <div style="background: #1a1f3a; padding: 20px 24px; border-radius: 8px 8px 0 0;">
        <p style="color: #f0c020; font-size: 12px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; margin: 0 0 4px;">
          股票提醒
        </p>
        <h1 style="color: #f0c020; font-size: 22px; font-weight: 700; margin: 0;">
          ${tickerList} 出現於今日報道
        </h1>
      </div>

      <div style="background: white; border: 1px solid #e5e7eb; border-top: none; padding: 24px; border-radius: 0 0 8px 8px;">
        <p style="font-size: 14px; color: #6b7280; margin: 0 0 16px;">
          您追蹤的股票 <strong style="color: #090a0c;">${tickerList}</strong> 在以下文章中被提及：
        </p>

        <div style="border-left: 3px solid #f0c020; padding-left: 16px; margin-bottom: 20px;">
          <p style="font-size: 17px; font-weight: 600; margin: 0 0 4px;">${titleZh}</p>
          <p style="font-size: 13px; color: #6b7280; margin: 0;">${titleEn}</p>
        </div>

        <a href="${articleUrl}"
           style="display: inline-block; background: #1a1f3a; color: #f0c020; padding: 10px 20px;
                  border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 600;">
          查看全文 →
        </a>

        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0 16px;" />
        <p style="font-size: 12px; color: #9ca3af; margin: 0;">
          華爾街早報 · <a href="${APP_URL}" style="color: #9ca3af;">wsbchinesereader.com</a>
        </p>
      </div>
    </div>
  `;

  try {
    await resend.emails.send({
      from: 'WSB早報提醒 <alerts@resend.dev>',
      to: email,
      subject,
      html
    });
    console.log(`[alerter] ✓ Alert sent to ${email} for ${tickers.join(', ')}`);
  } catch (err) {
    console.error(`[alerter] ✗ Failed to send alert to ${email}:`, err.message);
  }
}
