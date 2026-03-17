// emailer.js — Send email notifications for newly translated articles
import { config as dotenvConfig } from 'dotenv'; dotenvConfig({ override: true });
import { Resend } from 'resend';
import { getUnnotifiedArticles, markEmailSent } from './db.js';

const resend = new Resend(process.env.RESEND_API_KEY);

// ── Format email HTML ─────────────────────────────────────────────────────────

function buildEmailHTML(articles) {
  const articleBlocks = articles.map(a => {
    const keyPoints = JSON.parse(a.key_points_zh || '[]');
    const kpHTML = keyPoints.length > 0
      ? `<div style="background:rgba(13,46,95,0.05);border:1px solid rgba(13,46,95,0.15);border-radius:8px;padding:14px 16px;margin:12px 0;">
          <div style="font-size:10px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:#0D2E5F;margin-bottom:8px;">重點摘要 · Summary</div>
          <ul style="margin:0;padding-left:16px;">${keyPoints.map(kp => `<li style="margin:5px 0;color:rgba(9,10,12,0.9);font-size:14px;line-height:1.6;">${kp}</li>`).join('')}</ul>
        </div>`
      : '';
    const pubDate = a.published_at
      ? new Date(a.published_at).toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' })
      : '';
    const appUrl = `${process.env.APP_URL || 'http://localhost:3000'}`;

    return `
      <div style="border:1px solid rgba(0,0,0,0.1);border-radius:12px;padding:20px 24px;margin-bottom:20px;background:#ffffff;">
        <div style="color:rgba(9,10,12,0.55);font-size:11px;margin-bottom:10px;">${pubDate} · Seeking Alpha Wall Street Breakfast</div>
        <h2 style="margin:0 0 4px 0;font-size:20px;font-weight:600;color:#0D2E5F;line-height:1.3;">${a.title_zh || a.title_en}</h2>
        <div style="color:rgba(9,10,12,0.55);font-size:12px;margin-bottom:14px;">${a.title_en}</div>
        ${kpHTML}
        <a href="${appUrl}" style="display:inline-block;margin-top:14px;padding:9px 18px;background:#0D2E5F;color:#ffffff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;">閱讀全文 →</a>
      </div>
    `;
  }).join('');

  return `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
    <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Poppins,sans-serif;background:#f9f9f9;margin:0;padding:24px;">
      <div style="max-width:600px;margin:0 auto;">
        <div style="background:#0D2E5F;padding:22px 28px;border-radius:12px 12px 0 0;">
          <div style="color:#f0c020;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;font-weight:600;font-style:italic;opacity:0.85;margin-bottom:6px;">Seeking Alpha</div>
          <h1 style="color:#f0c020;margin:0;font-size:26px;font-weight:700;font-style:italic;letter-spacing:-0.5px;">華爾街早報</h1>
          <div style="color:rgba(255,255,255,0.6);font-size:12px;margin-top:4px;">Wall Street Breakfast · 繁體中文翻譯</div>
        </div>
        <div style="background:#f9f9f9;padding:24px 28px;border-radius:0 0 12px 12px;border:1px solid rgba(0,0,0,0.08);border-top:none;">
          <p style="color:rgba(9,10,12,0.9);margin:0 0 20px 0;font-size:14px;">
            ${articles.length === 1 ? '有 1 篇新文章已翻譯完成，請閱覽：' : `有 ${articles.length} 篇新文章已翻譯完成，請閱覽：`}
          </p>
          ${articleBlocks}
          <div style="color:rgba(9,10,12,0.35);font-size:11px;margin-top:20px;text-align:center;">
            由 Claude AI 翻譯 · 嚴格遵守原文 · 不添加推測內容
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
}

// ── Send notification email ───────────────────────────────────────────────────

export async function sendNewArticleNotification(articles) {
  if (!articles || articles.length === 0) return;

  const subject = articles.length === 1
    ? `【華爾街早報】${articles[0].title_zh || articles[0].title_en}`
    : `【華爾街早報】${articles.length} 篇新文章已翻譯完成`;

  const { data, error } = await resend.emails.send({
    from: 'WSB Reader <onboarding@resend.dev>',
    to: process.env.NOTIFY_EMAIL,
    subject,
    html: buildEmailHTML(articles)
  });

  if (error) throw new Error(error.message);
  console.log(`[emailer] ✓ Email sent: ${data.id} (${articles.length} articles)`);
  articles.forEach(a => markEmailSent(a.id));
  return data;
}

// ── Main: Send notifications for all unnotified articles ─────────────────────

export async function notifyPending() {
  const articles = getUnnotifiedArticles();
  if (articles.length === 0) {
    console.log('[emailer] No new articles to notify');
    return 0;
  }

  console.log(`[emailer] Sending notification for ${articles.length} articles`);
  await sendNewArticleNotification(articles);
  return articles.length;
}

// CLI test: node backend/emailer.js --test
if (process.argv[1]?.includes('emailer')) {
  if (process.argv.includes('--test')) {
    console.log('[emailer] Sending test email...');
    sendNewArticleNotification([{
      id: 0,
      title_en: 'Wall Street Breakfast: Oracle Beat Sends Shares Up',
      title_zh: '華爾街早報：Oracle 業績超預期，股價大漲',
      summary_zh: 'Oracle (ORCL) 登上今日最大升幅榜。截至2月28日止季度，Oracle 調整後每股盈利 $1.79，收入按年增長22%至 $17.19B，雙雙超越市場預期。',
      key_points_zh: JSON.stringify([
        'Oracle Q3（截至2月28日）：調整後 EPS $1.79，收入 $17.19B（按年增22%），雙超預期',
        'Q4 FY2026 指引：收入 $18.93B–$19.24B',
        'Nintendo (NTDOY) 東京盤中最多急升10.5%'
      ]),
      published_at: new Date().toISOString()
    }]).then(() => console.log('[emailer] Test email sent!')).catch(console.error);
  } else {
    notifyPending().catch(console.error);
  }
}
