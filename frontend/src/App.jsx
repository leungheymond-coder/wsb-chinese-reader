import { useState, useEffect } from 'react'
import ArticleList from './components/ArticleList'
import ArticleDetail from './components/ArticleDetail'
import { IconRefresh } from '@tabler/icons-react'
import { NAVY, GOLD } from './tokens'
import { Button } from '@/components/ui/button'
import { Toaster } from '@/components/ui/sonner'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { toast } from 'sonner'

const API = '/api'

export default function App() {
  const [articles, setArticles] = useState([])
  const [loading, setLoading] = useState(true)
  const [currentArticle, setCurrentArticle] = useState(null)
  const [lang, setLang] = useState('zh')
  const [fetching, setFetching] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 640)

  useEffect(() => {
    loadArticles().then(() => {
      // On initial load, check if URL has an article ID (e.g. /#/article/15)
      const match = window.location.hash.match(/^#\/article\/(\d+)$/)
      if (match) openArticleById(parseInt(match[1]))
    })
  }, [])

  // Handle browser back/forward navigation
  useEffect(() => {
    const onPopState = () => {
      const match = window.location.hash.match(/^#\/article\/(\d+)$/)
      if (match) openArticleById(parseInt(match[1]))
      else setCurrentArticle(null)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 640)
    window.addEventListener('resize', onResize, { passive: true })
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    const onScroll = () => {
      setScrolled(prev => {
        if (!prev && window.scrollY > 70) return true
        if (prev && window.scrollY < 50) return false
        return prev
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Reset scroll when navigating to/from article
  useEffect(() => {
    window.scrollTo(0, 0)
    setScrolled(false)
  }, [currentArticle])

  async function loadArticles() {
    try {
      const res = await fetch(`${API}/articles`)
      const data = await res.json()
      setArticles(data)
    } catch {
      toast.error('無法載入文章。請確保伺服器正在運行。')
    } finally {
      setLoading(false)
    }
  }

  async function openArticleById(id) {
    try {
      const res = await fetch(`${API}/articles/${id}`)
      const full = await res.json()
      full.key_points_en = Array.isArray(full.key_points_en) ? full.key_points_en : JSON.parse(full.key_points_en || '[]')
      full.key_points_zh = Array.isArray(full.key_points_zh) ? full.key_points_zh : JSON.parse(full.key_points_zh || '[]')
      setCurrentArticle(full)
    } catch { /* ignore */ }
  }

  async function triggerFetch() {
    setFetching(true)
    toast.info(lang === 'zh' ? '正在搜尋並翻譯最新文章…' : 'Fetching and translating latest articles…')
    try {
      await fetch(`${API}/fetch`, { method: 'POST' })
      setTimeout(() => {
        loadArticles()
        setFetching(false)
        toast.success(lang === 'zh' ? '文章已更新！' : 'Articles updated!')
      }, 5000)
    } catch {
      setFetching(false)
      toast.error(lang === 'zh' ? '抓取失敗，請稍後再試。' : 'Fetch failed. Please try again.')
    }
  }

  const latestDate = articles[0]
    ? new Date(articles[0].published_at || articles[0].translated_at).toLocaleString(
        lang === 'zh' ? 'zh-HK' : 'en-US',
        { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }
      )
    : null

  // Hero is expanded only on listing page when not scrolled
  const isExpanded = !currentArticle && !scrolled

  return (
    <div className="min-h-screen text-[#090a0c]" style={{ background: '#f9f9f9' }}>

      {/* Header — animates between hero and compact */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 50,
          background: NAVY,
          overflow: 'hidden',
          height: isExpanded ? (isMobile ? '160px' : '220px') : '67px',
          transition: 'height 0.45s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        {/* ── Expanded hero panel ── */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            padding: isMobile ? '0 16px 20px' : '0 24px 28px',
            opacity: isExpanded ? 1 : 0,
            transform: isExpanded ? 'translateY(0)' : 'translateY(12px)',
            transition: 'opacity 0.3s ease, transform 0.35s ease',
            pointerEvents: isExpanded ? 'auto' : 'none',
          }}
        >
          <div style={{ maxWidth: '768px', margin: '0 auto' }}>
            {/* Source label + rule */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
              <span style={{ color: GOLD, fontSize: '11px', fontWeight: 600, letterSpacing: '1.2px', textTransform: 'uppercase', opacity: 0.8, fontStyle: 'italic' }}>
                Seeking Alpha
              </span>
              <div style={{ flex: 1, height: '1px', background: 'rgba(240,192,32,0.25)' }} />
            </div>

            {/* Main title */}
            <h1 style={{
              fontFamily: "'Sharp Grotesk', sans-serif",
              fontWeight: 600,
              fontStyle: 'italic',
              fontSize: isMobile ? '40px' : '64px',
              lineHeight: 1.05,
              color: GOLD,
              margin: 0,
              letterSpacing: '-1px',
            }}>
              {lang === 'zh' ? '華爾街早報' : 'Wall Street Morning Post'}
            </h1>
          </div>
        </div>

        {/* ── Compact header panel ── */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '67px',
            display: 'flex',
            alignItems: 'center',
            padding: '0 24px',
            opacity: isExpanded ? 0 : 1,
            transform: isExpanded ? 'translateY(-8px)' : 'translateY(0)',
            transition: 'opacity 0.3s ease 0.05s, transform 0.35s ease',
          }}
        >
          <div style={{ maxWidth: '768px', margin: '0 auto', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            {/* Left: brand */}
            <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
              <span style={{ color: GOLD, fontSize: '10px', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', fontStyle: 'italic', opacity: 0.8 }}>
                Seeking Alpha
              </span>
              <span style={{
                fontFamily: "'Sharp Grotesk', sans-serif",
                fontWeight: 600,
                fontStyle: 'italic',
                fontSize: '18px',
                color: GOLD,
                letterSpacing: '-0.3px',
              }}>
                {lang === 'zh' ? '華爾街早報' : 'Wall Street Morning Post'}
              </span>
            </div>

            {/* Right: updated date + language toggle */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              {latestDate && (
                <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.6)', display: 'none' }} className="sm:!block">
                  {lang === 'zh' ? `更新：${latestDate}` : `Updated: ${latestDate}`}
                </span>
              )}
              {/* Language toggle — dark bg variant */}
              <ToggleGroup
                type="single"
                value={lang}
                onValueChange={(v) => v && setLang(v)}
                style={{ background: 'rgba(255,255,255,0.15)', borderRadius: '8px', padding: '4px', height: '32px', gap: 0 }}
              >
                <ToggleGroupItem
                  value="zh"
                  style={{
                    fontSize: '12px', fontWeight: 600, borderRadius: '6px', height: '24px', padding: '0 12px',
                    background: lang === 'zh' ? 'white' : 'transparent',
                    color: lang === 'zh' ? NAVY : 'white',
                  }}
                >
                  中文繁體
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="en"
                  style={{
                    fontSize: '12px', fontWeight: 600, borderRadius: '6px', height: '24px', padding: '0 12px',
                    background: lang === 'en' ? 'white' : 'transparent',
                    color: lang === 'en' ? NAVY : 'white',
                  }}
                >
                  EN
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
          </div>
        </div>
      </header>

      {/* Controls bar — listing page only */}
      {!currentArticle && (
        <div style={{ background: '#f9f9f9', borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
          <div className="max-w-3xl mx-auto px-4 py-[8px] flex items-center justify-between gap-2 flex-wrap">
            <Button
              onClick={triggerFetch}
              disabled={fetching}
              size="sm"
              className="bg-black text-[#fbfeff] text-[12px] rounded-[8px] hover:bg-black/80"
            >
              <IconRefresh size={14} className={fetching ? 'animate-spin' : ''} />
              {fetching
                ? (lang === 'zh' ? '抓取中…' : 'Fetching…')
                : (lang === 'zh' ? '抓取並翻譯最新文章' : 'Fetch & Translate Latest')}
            </Button>
            <span className="text-[rgba(0,0,0,0.55)] text-[11px]">
              {lang === 'zh' ? '自動抓取：每日 上午 7:30 (EST)' : 'Auto-fetch: daily 7:30 AM EST'}
            </span>
          </div>
        </div>
      )}

      {/* Main content */}
      <main className="max-w-3xl mx-auto px-4 py-5">
        {currentArticle ? (
          <ArticleDetail
            article={currentArticle}
            lang={lang}
            onBack={() => { window.history.pushState(null, '', '/'); setCurrentArticle(null) }}
          />
        ) : (
          <ArticleList
            articles={articles}
            loading={loading}
            lang={lang}
            onSelect={async (article) => {
              window.history.pushState(null, '', `#/article/${article.id}`)
              await openArticleById(article.id)
            }}
          />
        )}
      </main>

      {/* Footer */}
      <footer style={{ borderTop: '1px solid rgba(0,0,0,0.08)', marginTop: '40px', background: '#f9f9f9' }}>
        <div className="max-w-3xl mx-auto px-4 py-6 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span style={{ color: 'rgba(9,10,12,0.4)', fontSize: '12px' }}>
            {lang === 'zh' ? '© 華爾街早報 · 由 Seeking Alpha 提供原文' : '© Wall Street Morning Post · Source: Seeking Alpha'}
          </span>
          <span style={{ color: 'rgba(9,10,12,0.4)', fontSize: '12px' }}>
            {lang === 'zh' ? '每日自動更新 · 繁體中文（香港）' : 'Auto-updated daily · Traditional Chinese (HK)'}
          </span>
        </div>
      </footer>

      <Toaster position="bottom-right" />
    </div>
  )
}
