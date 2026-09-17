import { Icon } from '@/components/Icon'
import { Sparkline, sourceLabel } from '@/components/primitives'
import { TrendRailRow } from '@/components/TrendCard'
import { useLatido } from '@/state/store'
import { compactNumber } from '@/lib/format'

/**
 * Columna derecha: el contexto que no cabe en el flujo. Tendencias, lo que
 * emerge, reparto por red y —si hace falta— el aviso de que son datos de
 * ejemplo. Nunca compite con el centro: informa de un vistazo.
 */
export function Rail(): JSX.Element {
  const { t, trends, items, entities, demoMode, lang, selectTrend } = useLatido()

  const top = trends.slice(0, 5)
  const emerging = trends
    .filter((trend) => trend.state === 'emerging' || trend.state === 'breaking')
    .slice(0, 3)
  const watched = entities.filter((entity) => entity.watch).slice(0, 4)

  const distribution = new Map<string, number>()
  for (const item of items) distribution.set(item.source, (distribution.get(item.source) ?? 0) + 1)
  const total = items.length || 1
  const shares = [...distribution.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)

  return (
    <aside className="rail" aria-label={t('nav.explore')}>
      {demoMode ? (
        <div className="panel">
          <span className="label">{t('app.demo')}</span>
          <p className="small muted">{t('app.demoNotice')}</p>
        </div>
      ) : null}

      <section className="panel panel--flat">
        <div className="panel__head">
          <span className="label">{t('radar.title')}</span>
          <span className="mono micro faint">{trends.length}</span>
        </div>
        {top.map((trend, index) => (
          <TrendRailRow key={trend.id} trend={trend} rank={index + 1} />
        ))}
      </section>

      {emerging.length > 0 ? (
        <section className="panel">
          <div className="panel__head">
            <span className="label">{t('radar.emerging')}</span>
            <Icon name="sparkles" size="sm" />
          </div>
          {emerging.map((trend) => (
            <button key={trend.id} type="button" className="rail-trend" onClick={() => selectTrend(trend.id)}>
              <span className="grow">
                <span className="rail-trend__title">{trend.title}</span>
              </span>
              <span className="rail-trend__meta">
                ×{trend.velocity.toFixed(1)} · {trend.coverage}
              </span>
              <span className="rail-trend__spark">
                <Sparkline values={trend.sparkline} className="sparkline--rail" height={16} />
              </span>
            </button>
          ))}
        </section>
      ) : null}

      {watched.length > 0 ? (
        <section className="panel panel--flat">
          <span className="label">{t('following.title')}</span>
          {watched.map((entity) => (
            <div className="rail-trend" key={entity.slug}>
              <span className="grow">
                <span className="rail-trend__title">{entity.name}</span>
              </span>
              <span className="rail-trend__meta">{t('following.watching')}</span>
            </div>
          ))}
        </section>
      ) : null}

      <section className="panel">
        <span className="label">{t('explore.bySource')}</span>
        {shares.length === 0 ? (
          <p className="small faint">—</p>
        ) : (
          shares.map(([source, count]) => (
            <div className="meter" key={source}>
              <span className="truncate">{sourceLabel(source as never)}</span>
              <span className="meter__track">
                <span className="meter__fill" style={{ width: `${Math.round((count / total) * 100)}%` }} />
              </span>
              <span className="meter__value">{compactNumber(count, lang)}</span>
            </div>
          ))
        )}
      </section>

      <footer className="rail-foot">
        <a href="https://github.com/smouj/latido" target="_blank" rel="noopener noreferrer">
          GitHub
        </a>
        <a href="https://github.com/smouj/latido/blob/main/docs/DESIGN.md" target="_blank" rel="noopener noreferrer">
          {t('settings.appearance')}
        </a>
        <a href="https://github.com/smouj/latido/blob/main/docs/PRIVACY.md" target="_blank" rel="noopener noreferrer">
          {t('settings.data')}
        </a>
        <span>AGPL-3.0</span>
      </footer>
    </aside>
  )
}
