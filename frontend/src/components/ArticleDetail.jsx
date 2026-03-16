import { IconArrowLeft, IconExternalLink, IconAlertTriangle } from '@tabler/icons-react'
import { NAVY as PRIMARY, TEXT_BODY, TEXT_SECONDARY, TEXT_MUTED, KP_BG, KP_BORDER, KP_SHADOW, BORDER_SUBTLE } from '../tokens'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'

export default function ArticleDetail({ article, lang, onBack }) {
  const zh = lang === 'zh'
  const title = zh ? (article.title_zh || article.title_en) : article.title_en
  const subtitle = zh ? article.title_en : null
  const keyPoints = zh ? (article.key_points_zh || []) : (article.key_points_en || [])
  const fullContent = zh ? (article.full_content_zh || '') : (article.full_content_en || '')
  const catalyst = zh ? (article.catalyst_watch_zh || '') : (article.catalyst_watch_en || '')
  const tickers = JSON.parse(article.tickers || '[]')

  const date = article.published_at
    ? new Date(article.published_at).toLocaleString(zh ? 'zh-HK' : 'en-US', {
        timeZone: 'America/Toronto',
        year: 'numeric', month: zh ? 'numeric' : 'long', day: 'numeric',
        weekday: 'long', hour: '2-digit', minute: '2-digit'
      })
    : ''

  return (
    <div>
      {/* Back button */}
      <Button variant="ghost" size="sm" onClick={onBack} className="mb-5 -ml-2" style={{ color: PRIMARY }}>
        <IconArrowLeft size={16} /> {zh ? '返回文章列表' : 'Back to articles'}
      </Button>

      {/* Main article content — no card */}
      <div className="mb-6">
        {/* Date */}
        <p className="text-[14px] mb-[8px]" style={{ color: TEXT_SECONDARY }}>{date}</p>

        {/* Title */}
        <h1 className="text-[26px] sm:text-[32px] font-semibold italic leading-snug mb-[4px]" style={{ color: PRIMARY }}>{title}</h1>

        {/* Subtitle */}
        {subtitle && (
          <p className="text-[16px] mb-3" style={{ color: TEXT_SECONDARY }}>{subtitle}</p>
        )}

        {/* Tickers + source link */}
        <div className="flex flex-wrap items-center gap-1.5 mb-[24px]">
          {tickers.map(t => (
            <Badge key={t} variant="secondary" className="font-mono tracking-[0.275px] text-[12px] font-semibold">{t}</Badge>
          ))}
          {article.sa_url && (
            <Button asChild variant="ghost" size="sm" className="opacity-75 hover:opacity-100 text-[14px] font-bold" style={{ color: PRIMARY }}>
              <a href={article.sa_url} target="_blank" rel="noopener noreferrer">
                <IconExternalLink size={12} /> {zh ? '原文' : 'Source'}
              </a>
            </Button>
          )}
        </div>

        {/* Incomplete warning */}
        {article.fetch_status === 'incomplete' && (
          <Alert className="mb-4 border-yellow-500/30 bg-yellow-500/10 text-yellow-700 text-[14px]">
            <IconAlertTriangle className="text-yellow-600" />
            <AlertDescription className="text-yellow-700 text-[14px]">
              {zh
                ? '原文抓取不完整（可能需要 Seeking Alpha 訂閱）。以下翻譯僅基於已獲取的內容。'
                : 'Article content is incomplete (may require a Seeking Alpha subscription). Translation is based on available content only.'}
            </AlertDescription>
          </Alert>
        )}

        {/* Key points */}
        {keyPoints.length > 0 && (
          <div
            className="rounded-[10px] px-[17px] pt-[15px] pb-[14px] mb-[32px] flex flex-col gap-[10px]"
            style={{ background: KP_BG, border: KP_BORDER, boxShadow: KP_SHADOW }}
          >
            <h3 className="text-[16px] font-semibold tracking-[1.1px]" style={{ color: PRIMARY }}>
              {zh ? '重點摘要 · Summary' : 'Summary'}
            </h3>
            <ul className="flex flex-col gap-2">
              {keyPoints.map((kp, i) => (
                <li key={i} className="text-[16px] text-body pl-4 relative leading-[1.8]">
                  <span className="absolute left-0" style={{ color: PRIMARY }}>•</span>
                  {kp}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Full content */}
        <div>
          {fullContent ? (
            <p className="text-[16px] leading-[1.8] text-body whitespace-pre-wrap">
              {fullContent}
            </p>
          ) : (
            <p className="text-[14px] text-body">
              {zh ? '全文內容尚未獲取。' : 'Full article content not yet available.'}
            </p>
          )}
        </div>
      </div>

      {/* Catalyst Watch */}
      {catalyst && (
        <div style={{ borderTop: '1px solid rgba(0,0,0,0.08)', paddingTop: '20px' }}>
          <h3 className="text-[16px] font-semibold tracking-[1.1px] mb-3" style={{ color: PRIMARY }}>
            {zh ? '催化劑觀察 · Catalyst Watch' : 'Catalyst Watch'}
          </h3>
          <ul className="flex flex-col gap-2">
            {catalyst.split(/\n\n+/).filter(Boolean).map((p, i) => (
              <li key={i} className="text-[16px] text-body pl-4 relative leading-[1.8]">
                <span className="absolute left-0" style={{ color: PRIMARY }}>•</span>
                {p.trim()}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
