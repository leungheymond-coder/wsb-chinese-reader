import { NAVY, TEXT_SECONDARY, TEXT_MUTED, BORDER_SUBTLE } from '../tokens'
import { Badge } from '@/components/ui/badge'

const PLACEHOLDER = '/placeholder.png'

export default function ArticleList({ articles, loading, lang, onSelect }) {
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3" style={{ color: TEXT_MUTED }}>
        <div className="w-8 h-8 border-2 border-[rgba(9,10,12,0.15)] rounded-full animate-spin" style={{ borderTopColor: NAVY }} />
        <span className="text-sm">載入文章中…</span>
      </div>
    )
  }

  if (articles.length === 0) {
    return (
      <div className="text-center py-20" style={{ color: TEXT_MUTED }}>
        <p className="text-base mb-1">📰 尚無文章</p>
        <p className="text-sm">點擊「抓取並翻譯最新文章」開始</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {articles.map(article => (
        <ArticleCard key={article.id} article={article} lang={lang} onSelect={onSelect} />
      ))}
    </div>
  )
}

function ArticleCard({ article, lang, onSelect }) {
  const title = lang === 'zh' ? (article.title_zh || article.title_en) : article.title_en
  const subtitle = lang === 'zh' ? article.title_en : null
  const keyPoints = lang === 'zh' ? (article.key_points_zh || []) : (article.key_points_en || [])
  const tickers = JSON.parse(article.tickers || '[]')

  const date = article.published_at
    ? new Date(article.published_at).toLocaleString(lang === 'zh' ? 'zh-HK' : 'en-US', {
        timeZone: 'America/Toronto',
        year: 'numeric', month: lang === 'zh' ? 'numeric' : 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
      })
    : ''

  const thumbnail = article.thumbnail_url || PLACEHOLDER

  return (
    <div
      className="group rounded-[14px] overflow-hidden cursor-pointer hover:brightness-[0.97] transition-all flex flex-col sm:flex-row"
      style={{ borderBottom: '1px solid rgba(0,0,0,0.08)' }}
      onClick={() => onSelect(article)}
    >
      {/* Thumbnail — full-width on mobile, fixed on desktop */}
      <div className="flex-shrink-0 sm:p-4 sm:pr-0">
        <img
          src={thumbnail}
          alt=""
          className="w-full aspect-video object-cover sm:aspect-auto sm:w-[198px] sm:h-[112px] sm:rounded-[8px]"
        />
      </div>

      {/* Content */}
      <div className="flex flex-col gap-2 sm:gap-3 p-3 sm:p-4 min-w-0">
        {/* Date + EN subtitle */}
        <div className="flex items-center gap-[10px] flex-wrap">
          <span className="text-[12px]" style={{ color: TEXT_SECONDARY }}>{date}</span>
          {subtitle && (
            <span className="text-[12px] truncate" style={{ color: TEXT_SECONDARY }}>{subtitle}</span>
          )}
        </div>

        <h2 className="text-[18px] sm:text-[22px] font-semibold leading-snug line-clamp-2 transition-colors text-[color:var(--wsb-navy)] group-hover:text-[color:var(--wsb-blue)]">{title}</h2>

        {tickers.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tickers.map(t => (
              <Badge key={t} variant="secondary" className="font-mono tracking-[0.275px] text-[12px] font-semibold">{t}</Badge>
            ))}
          </div>
        )}

        {keyPoints.length > 0 && (
          <ul className="flex flex-col gap-1">
            {keyPoints.slice(0, 3).map((kp, i) => (
              <li key={i} className="text-[14px] pl-3 relative leading-[19.5px] line-clamp-2" style={{ color: 'rgba(9,10,12,0.9)' }}>
                <span className="absolute left-0" style={{ color: NAVY }}>•</span>
                {kp}
              </li>
            ))}
          </ul>
        )}

        {article.fetch_status === 'incomplete' && (
          <span className="inline-block text-[14px] px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-600 border border-yellow-500/30">
            ⚠ 原文不完整
          </span>
        )}
      </div>
    </div>
  )
}
