// tokens.js — Design token references for use in React components
// Raw values live in globals.css under --wsb-* variables.
// To retheme the app, edit globals.css only — changes propagate here and to shadcn automatically.

// ── Brand Colors ──────────────────────────────────────────────
export const NAVY         = 'var(--wsb-navy)'
export const GOLD         = 'var(--wsb-gold)'
export const BLUE         = 'var(--wsb-blue)'
export const BLUE_BRIGHT  = 'var(--wsb-blue-bright)'

// ── Backgrounds ───────────────────────────────────────────────
export const BG_PAGE      = 'var(--wsb-bg-page)'
export const BG_CARD      = 'var(--wsb-bg-card)'

// ── Text ──────────────────────────────────────────────────────
export const TEXT_BODY      = 'var(--wsb-text-body)'       // paragraphs, bullet points
export const TEXT_SECONDARY = 'var(--wsb-text-secondary)'  // dates, subtitles, captions
export const TEXT_MUTED     = 'var(--wsb-text-muted)'      // empty states, loading

// ── Muted Navy Surfaces (ticker tags, key points box, etc.) ───
export const BG_MUTED      = 'var(--wsb-bg-muted)'      // rgba(13,46,95,0.05)
export const BORDER_BRAND  = 'var(--wsb-border-brand)'  // rgba(13,46,95,0.2)

// ── Borders ───────────────────────────────────────────────────
export const BORDER_SUBTLE = 'var(--wsb-border-subtle)'

// ── Key Points Card ───────────────────────────────────────────
export const KP_BG     = BG_MUTED
export const KP_BORDER = '1px solid var(--wsb-border-brand)'
export const KP_SHADOW = 'var(--wsb-kp-shadow)'   // includes offset + spread
