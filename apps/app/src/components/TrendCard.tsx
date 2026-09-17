import { memo } from 'react'

import type { Trend } from '@latido/engine'

import { Icon } from '@/components/Icon'
import { ReasonText, ScoreBar, Sparkline, StateBadge, TrendDelta, sourceLabel } from '@/components/primitives'
import { compactNumber, relativeTime } from '@/lib/format'
import { useLatido } from '@/state/store'

/** Tarjeta completa de un tema: la vista del Radar y el detalle. */
export const TrendCard = memo(function TrendCard({ trend, rank }: { trend: Trend; rank?: number }): JSX.Element {
  const t = useLatido((state) => state.t)
  const lang = useLatido((state) => state.lang)
  const selected = useLatido((state) => state.selectedTrendId === trend.id)

  const toggle = (): void => useLatido.getState().selectTrend(selected ? null : trend.id)

  return (
    <article
      className={`trend trend--${trend.state} ${selected ? 'trend--selected' : ''}`}
      onClick={toggle}
    >
      <div className="trend__head">
        {rank !== undefined ? <span className="trend__rank mono">{String(rank).padStart(2, '0')}</span> : null}
        <h3 className="trend__title">{trend.title}</h3>
        <StateBadge state={trend.state} />
        <span className="trend__score mono" title={t('radar.score')}>
          {trend.score}
        </span>
      </div>

      <div className="trend__meta">
        <span>{t('radar.startedAgo', { time: relativeTime(trend.firstSeen, Date.now(), lang) })}</span>
        <span aria-hidden="true">·</span>
        <span className="mono">{t('radar.volume')}: {compactNumber(trend.volume, lang)}</span>
        <span aria-hidden="true">·</span>
        <span className="mono">{t('radar.coverage')}: {trend.coverage}</span>
        <span className="grow" />
        <TrendDelta growth={trend.growth} />
      </div>

      <Sparkline values={trend.sparkline} />

      {selected ? (
        <>
          <div className="trend__metrics">
            <div className="metric">
              <span className="metric__label">{t('radar.score')}</span>
              <span className="metric__value">{trend.score}</span>
              <ScoreBar score={trend.score} />
            </div>
            <div className="metric">
              <span className="metric__label">{t('radar.velocity')}</span>
              <span className="metric__value">×{trend.velocity.toFixed(2)}</span>
              <span className="metric__hint">{t('radar.peak')} · {t('radar.now')}</span>
            </div>
            <div className="metric">
              <span className="metric__label">{t('radar.volume')}</span>
              <span className="metric__value">{compactNumber(trend.volume, lang)}</span>
              <span className="metric__hint">{t('radar.startedAgo', { time: relativeTime(trend.firstSeen, Date.now(), lang) })}</span>
            </div>
            <div className="metric">
              <span className="metric__label">{t('radar.coverage')}</span>
              <span className="metric__value">{trend.coverage}</span>
              <span className="metric__hint">{t('following.across', { count: trend.coverage })}</span>
            </div>
            <div className="metric">
              <span className="metric__label">{t('radar.engagement')}</span>
              <span className="metric__value">{compactNumber(trend.engagement, lang)}</span>
              <span className="metric__hint">✚ 💬 ⇄</span>
            </div>
            <div className="metric">
              <span className="metric__label">{t('radar.novelty')}</span>
              <span className="metric__value">{Math.round(trend.novelty * 100)}</span>
              <span className="metric__hint">{t('radar.state')}</span>
            </div>
          </div>

          <div className="stack stack--tight">
            <span className="label">{t('radar.whereGrowing')}</span>
            {trend.sources.map((entry) => (
              <div className="meter" key={entry.source}>
                <span className="truncate">{sourceLabel(entry.source)}</span>
                <span className="meter__track">
                  <span className="meter__fill" style={{ width: `${Math.round(entry.share * 100)}%` }} />
                </span>
                <span className="meter__value">{Math.round(entry.share * 100)}%</span>
              </div>
            ))}
          </div>

          <div className="reason">
            <Icon name="info" size="sm" />
            <span>
              <span className="reason__title">{t('radar.why')}</span>
              <ReasonText code={trend.reason.code} params={trend.reason.params} />
            </span>
          </div>

          <div className="inline inline--wrap">
            <button
              type="button"
              className="btn btn--outline btn--small"
              onClick={(event) => {
                event.stopPropagation()
                toggle()
              }}
            >
              <Icon name="activity" size="sm" />
              {t('feed.conversation')}
            </button>
            <span className="tag">{trend.keywords.slice(0, 5).join(' · ')}</span>
          </div>
        </>
      ) : (
        <Sparkline values={trend.sparkline} className="sparkline--rail" height={20} />
      )}
    </article>
  )
})

/** Versión mínima para la columna derecha. */
export const TrendRailRow = memo(function TrendRailRow({
  trend,
  rank,
}: {
  trend: Trend
  rank: number
}): JSX.Element {
  const lang = useLatido((state) => state.lang)
  return (
    <button
      type="button"
      className="rail-trend"
      onClick={() => useLatido.getState().selectTrend(trend.id)}
    >
      <span className="grow">
        <span className="rail-trend__title">
          <span className="mono faint">{rank} </span>
          {trend.title}
        </span>
      </span>
      <span className="rail-trend__meta">
        {trend.volume > 0 ? (
          <span className={trend.growth >= 0 ? 'delta' : 'delta delta--down'}>
            {trend.growth >= 0 ? '+' : '−'}
            {Math.abs(Math.round(trend.growth * 100))} %
          </span>
        ) : (
          <span className="faint">—</span>
        )}
      </span>
      <span className="rail-trend__meta">
        {compactNumber(trend.volume, lang)} · {trend.coverage} {lang === 'es' ? 'redes' : 'nets'}
      </span>
      <span className="rail-trend__spark">
        <Sparkline values={trend.sparkline} className="sparkline--rail" height={18} />
      </span>
    </button>
  )
})
