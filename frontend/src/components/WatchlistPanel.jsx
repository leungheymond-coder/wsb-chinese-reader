import { useState, useEffect } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { NAVY, GOLD } from '../tokens'

export default function WatchlistPanel({ lang, onClose }) {
  const { getToken } = useAuth()
  const [tickers, setTickers] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function authFetch(path, options = {}) {
    const token = await getToken()
    return fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(options.headers || {})
      }
    })
  }

  useEffect(() => {
    authFetch('/api/watchlist')
      .then(r => r.json())
      .then(data => setTickers(data.map(d => d.ticker)))
      .catch(() => setError('無法載入自選股'))
      .finally(() => setLoading(false))
  }, [])

  async function addTicker() {
    const t = input.trim().toUpperCase()
    if (!t) return
    if (tickers.includes(t)) { setError(lang === 'zh' ? '已在自選股中' : 'Already in watchlist'); return }
    setError('')
    const res = await authFetch('/api/watchlist', {
      method: 'POST',
      body: JSON.stringify({ ticker: t })
    })
    if (res.ok) {
      setTickers(prev => [t, ...prev])
      setInput('')
    } else {
      const d = await res.json()
      setError(d.error || (lang === 'zh' ? '無效股票代號' : 'Invalid ticker'))
    }
  }

  async function removeTicker(ticker) {
    await authFetch(`/api/watchlist/${ticker}`, { method: 'DELETE' })
    setTickers(prev => prev.filter(t => t !== ticker))
  }

  return (
    <div style={{ background: '#f0f4ff', borderBottom: '1px solid rgba(26,31,58,0.12)' }}>
      <div className="max-w-3xl mx-auto px-4 py-4">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 700, color: NAVY, margin: 0 }}>
            🔔 {lang === 'zh' ? '自選股提醒' : 'Ticker Alerts'}
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: '18px', lineHeight: 1 }}>×</button>
        </div>

        <p style={{ fontSize: '12px', color: '#6b7280', margin: '0 0 12px' }}>
          {lang === 'zh'
            ? '當追蹤的股票出現於文章時，即時電郵通知。'
            : 'Get an email alert when a followed ticker appears in an article.'}
        </p>

        {/* Input row */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
          <input
            value={input}
            onChange={e => { setInput(e.target.value.toUpperCase()); setError('') }}
            onKeyDown={e => e.key === 'Enter' && addTicker()}
            placeholder={lang === 'zh' ? '輸入股票代號，如 NVDA' : 'Enter ticker, e.g. NVDA'}
            maxLength={10}
            style={{
              flex: 1, border: '1px solid #d1d5db', borderRadius: '6px',
              padding: '7px 12px', fontSize: '13px', fontWeight: 600,
              textTransform: 'uppercase', outline: 'none'
            }}
          />
          <button
            onClick={addTicker}
            style={{
              background: NAVY, color: GOLD, border: 'none', borderRadius: '6px',
              padding: '7px 16px', fontSize: '13px', fontWeight: 700, cursor: 'pointer'
            }}
          >
            {lang === 'zh' ? '加入' : 'Add'}
          </button>
        </div>

        {error && <p style={{ fontSize: '12px', color: '#ef4444', margin: '0 0 8px' }}>{error}</p>}

        {/* Ticker chips */}
        {loading ? (
          <p style={{ fontSize: '12px', color: '#9ca3af' }}>{lang === 'zh' ? '載入中…' : 'Loading…'}</p>
        ) : tickers.length === 0 ? (
          <p style={{ fontSize: '12px', color: '#9ca3af' }}>
            {lang === 'zh' ? '尚未追蹤任何股票' : 'No tickers followed yet'}
          </p>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {tickers.map(ticker => (
              <span key={ticker} style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                background: NAVY, color: GOLD, borderRadius: '6px',
                padding: '4px 10px', fontSize: '13px', fontWeight: 700
              }}>
                {ticker}
                <button
                  onClick={() => removeTicker(ticker)}
                  style={{ background: 'none', border: 'none', color: 'rgba(240,192,32,0.6)', cursor: 'pointer', padding: 0, fontSize: '14px', lineHeight: 1 }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
