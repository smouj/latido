import { TrendRailRow } from '@/components/TrendCard'
import { EmptyState, Meter, sourceLabel } from '@/components/primitives'
import { Icon } from '@/components/Icon'
import { getEngine, useLatido } from '@/state/store'
import { compactNumber, relativeTime } from '@/lib/format'

/**
 * Explorar: la vista de conjunto. Tendencias, reparto por red y salud del
 * archivo local. Sirve para entender de dónde sale todo lo demás.
 */
export function ExploreScreen(): JSX.Element {
  const { t, trends, items, counts, lang, selectTrend, selectItem, entities } = useLatido()

  const bySource = new Map<string, number>()
  for (const item of items) bySource.set(item.source, (bySource.get(item.source) ?? 0) + 1)
  const maxSource = Math.max(1, ...bySource.values())

  const stats = getEngine().stats()
  const oldest = stats.oldestItemAt ? relativeTime(stats.oldestItemAt, Date.now(), lang) : '—'
  const newest = stats.newestItemAt ? relativeTime(stats.newestItemAt, Date.now(), lang) : '—'

  const topKeywords = new Map<string, number>()
  for (const trend of trends) {
    for (const keyword of trend.keywords.slice(0, 3)) {
      topKeywords.set(keyword, (topKeywords.get(keyword) ?? 0) + trend.volume)
    }
  }
  const keywords = [...topKeywords.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18)

  return (
    <div className="content content--narrow">
      <section className="section">
        <div className="section__head">
          <span className="label">{t('explore.topics')}</span>
          <span className="mono micro faint">{trends.length}</span>
        </div>
        {trends.length === 0 ? (
          <EmptyState icon="compass" title={t('empty.noTrends')} hint={t('empty.hint')} />
        ) : (
          trends.slice(0, 8).map((trend, index) => <TrendRailRow key={trend.id} trend={trend} rank={index + 1} />)
        )}
      </section>

      <section className="section">
        <span className="label">{t('explore.entities')}</span>
        <div className="kindlist">
          {entities.slice(0, 24).map((entity) => (
            <button
              key={entity.slug}
              type="button"
              className="chip"
              onClick={() => {
                const [first] = getEngine().entityTimeline(entity.slug, 1)
                if (first) selectItem(first.id)
                else selectTrend(trends[0]?.id ?? null)
              }}
            >
              {entity.watch ? <Icon name="eye" size="sm" /> : null}
              {entity.name}
            </button>
          ))}
        </div>
      </section>

      <section className="section">
        <span className="label">{t('explore.bySource')}</span>
        {bySource.size === 0 ? (
          <p className="small faint">—</p>
        ) : (
          [...bySource.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([source, count]) => (
              <Meter key={source} label={sourceLabel(source as never)} value={count} max={maxSource} />
            ))
        )}
      </section>

      <section className="section">
        <span className="label">{t('explore.stats')}</span>
        <div className="grid-cards">
          <div className="panel">
            <span className="metric__label">{t('radar.volume')}</span>
            <span className="metric__value">{compactNumber(counts.items, lang)}</span>
            <span className="metric__hint">{oldest} → {newest}</span>
          </div>
          <div className="panel">
            <span className="metric__label">{t('radar.title')}</span>
            <span className="metric__value">{counts.trends}</span>
            <span className="metric__hint">{counts.clusters} {t('nav.radar').toLowerCase()}</span>
          </div>
          <div className="panel">
            <span className="metric__label">{t('nav.alerts')}</span>
            <span className="metric__value">{counts.alerts}</span>
            <span className="metric__hint">{t('alerts.subtitle')}</span>
          </div>
        </div>
      </section>

      <section className="section">
        <span className="label">{t('explore.topics')} · palabras</span>
        <div className="kindlist">
          {keywords.map(([keyword, weight]) => (
            <span className="tag" key={keyword}>
              {keyword} <span className="mono faint">{compactNumber(weight, lang)}</span>
            </span>
          ))}
        </div>
      </section>
    </div>
  )
}
