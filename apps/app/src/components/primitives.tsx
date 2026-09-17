/**
 * Piezas pequeñas reutilizables. Todas reciben datos, no estado global: se
 * pueden probar y reutilizar sin montar la app entera.
 */
import type { ReactNode } from 'react'

import type { SourceKind, TrendState } from '@latido/engine'

import { useLatido } from '@/state/store'
import { compactNumber, hueOf, initialsOf, percent, times } from '@/lib/format'

import { Icon, type IconName } from './Icon'

// ── botones y enlaces ───────────────────────────────────────────────────────

export function ActionButton({
  icon,
  label,
  onClick,
  active = false,
  title,
}: {
  icon: IconName
  label?: string | number
  onClick?: () => void
  active?: boolean
  title?: string
}): JSX.Element {
  return (
    <button
      type="button"
      className={`post__action ${active ? 'post__action--on' : ''}`}
      onClick={(event) => {
        event.stopPropagation()
        onClick?.()
      }}
      title={title}
      aria-label={title}
      aria-pressed={active}
    >
      <Icon name={icon} size="sm" />
      {label !== undefined && label !== '' ? <span>{label}</span> : null}
    </button>
  )
}

export function ExternalLink({
  href,
  children,
  className,
}: {
  href: string
  children: ReactNode
  className?: string
}): JSX.Element {
  return (
    <a
      className={className}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(event) => event.stopPropagation()}
    >
      {children}
    </a>
  )
}

// ── identidad ───────────────────────────────────────────────────────────────

export function Avatar({
  name,
  url,
  size = 'md',
}: {
  name: string
  url?: string
  size?: 'sm' | 'md' | 'lg'
}): JSX.Element {
  const classes = ['avatar', size === 'sm' ? 'avatar--sm' : size === 'lg' ? 'avatar--lg' : ''].filter(Boolean).join(' ')
  if (url) {
    return (
      <span className={classes}>
        <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" />
      </span>
    )
  }
  const hue = hueOf(name)
  return (
    <span
      className={classes}
      style={{
        background: `color-mix(in srgb, hsl(${hue} 45% 55%) 16%, var(--color-surface-raised))`,
        color: `hsl(${hue} 40% 62%)`,
      }}
      aria-hidden="true"
    >
      {initialsOf(name)}
    </span>
  )
}

const SOURCE_LABELS: Record<SourceKind, string> = {
  bluesky: 'Bluesky',
  reddit: 'Reddit',
  hackernews: 'HN',
  rss: 'RSS',
  github: 'GitHub',
  mastodon: 'Mastodon',
  youtube: 'YouTube',
  lemmy: 'Lemmy',
  demo: 'Ejemplo',
}

export function sourceLabel(source: SourceKind): string {
  return SOURCE_LABELS[source] ?? source
}

export function SourceDot({ source, withLabel = false }: { source: SourceKind; withLabel?: boolean }): JSX.Element {
  return (
    <span className="inline" title={sourceLabel(source)}>
      <span className="chip__dot" style={{ background: `var(--source-${source}, var(--color-text-faint))` }} />
      {withLabel ? <span className="micro muted">{sourceLabel(source)}</span> : null}
    </span>
  )
}

// ── estado de una tendencia ─────────────────────────────────────────────────

export function StateBadge({ state }: { state: TrendState }): JSX.Element {
  const { t } = useLatido()
  const key = `radar.${state}` as const
  const label = t(key)
  return <span className={`state state--${state}`}>{label}</span>
}

export function TrendDelta({ growth }: { growth: number }): JSX.Element {
  const { lang } = useLatido()
  const down = growth < 0
  return (
    <span className={`delta ${down ? 'delta--down' : ''}`} title={percent(growth, lang)}>
      {percent(growth, lang)}
    </span>
  )
}

// ── barras y series ─────────────────────────────────────────────────────────

export function Meter({
  label,
  value,
  max,
  suffix,
}: {
  label: string
  value: number
  max: number
  suffix?: string
}): JSX.Element {
  const width = max <= 0 ? 0 : Math.min(100, Math.round((value / max) * 100))
  return (
    <div className="meter">
      <span className="truncate">{label}</span>
      <span className="meter__track">
        <span className="meter__fill" style={{ width: `${width}%` }} />
      </span>
      <span className="meter__value">{suffix ?? compactNumber(value)}</span>
    </div>
  )
}

/**
 * Sparkline de barras. Marca en acento los cubos que superan la media: el ojo
 * ve la explosión sin leer ningún número.
 */
export function Sparkline({
  values,
  className = '',
  height = 32,
}: {
  values: number[]
  className?: string
  height?: number
}): JSX.Element | null {
  if (values.length === 0) return null
  const max = Math.max(...values, 1)
  const average = values.reduce((sum, value) => sum + value, 0) / values.length
  const gap = 2
  const width = 100
  const barWidth = Math.max(1.5, (width - gap * (values.length - 1)) / values.length)

  return (
    <svg
      className={`sparkline ${className}`}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Serie de ${values.length} intervalos`}
    >
      {values.map((value, index) => {
        const barHeight = max <= 0 ? 1 : Math.max(1, (value / max) * height)
        const tone = value >= average * 1.6 ? 'hot' : value >= average ? 'warm' : ''
        return (
          <rect
            key={index}
            className={`sparkline__bar ${tone ? `sparkline__bar--${tone}` : ''}`}
            x={index * (barWidth + gap)}
            y={height - barHeight}
            width={barWidth}
            height={barHeight}
            rx={1}
          />
        )
      })}
    </svg>
  )
}

export function ScoreBar({ score }: { score: number }): JSX.Element {
  return (
    <span className="score-bar">
      <span className="score-bar__track">
        <span className="score-bar__fill" style={{ width: `${Math.max(3, Math.min(100, score))}%` }} />
      </span>
      <span className="mono micro muted">{score}</span>
    </span>
  )
}

// ── estados vacíos y carga ──────────────────────────────────────────────────

export function EmptyState({
  icon = 'search',
  title,
  hint,
  action,
}: {
  icon?: IconName
  title: string
  hint?: string
  action?: ReactNode
}): JSX.Element {
  return (
    <div className="empty">
      <span className="empty__icon">
        <Icon name={icon} size="lg" />
      </span>
      <span className="empty__title">{title}</span>
      {hint ? <span className="empty__hint">{hint}</span> : null}
      {action}
    </div>
  )
}

export function SkeletonList({ rows = 6 }: { rows?: number }): JSX.Element {
  return (
    <div className="stream" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div className="post" key={index}>
          <span className="skeleton" style={{ width: '2.5rem', height: '2.5rem', borderRadius: '999px' }} />
          <div className="post__main">
            <span className="skeleton skeleton--line" style={{ width: '30%' }} />
            <span className="skeleton skeleton--line" style={{ width: '80%' }} />
            <span className="skeleton skeleton--line" style={{ width: '60%' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

// ── textos compuestos ───────────────────────────────────────────────────────

/** Traduce el motivo estructurado de una tendencia. */
export function ReasonText({ code, params }: { code: string; params: Record<string, number | string> }): JSX.Element {
  const { t, lang } = useLatido()
  const key = `reason.${code}` as 'reason.velocity_spike'
  const translated = t(key, {
    ...params,
    velocity: params['velocity'] === undefined ? '' : times(Number(params['velocity']), lang).replace('×', ''),
    growth: params['growth'] === undefined ? '' : String(params['growth']),
  })
  return <span>{translated}</span>
}
