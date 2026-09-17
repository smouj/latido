import { useMemo, useState } from 'react'

import type { Item } from '@latido/engine'

import { PostCard } from '@/components/PostCard'
import { EmptyState, SkeletonList, sourceLabel } from '@/components/primitives'
import { Icon } from '@/components/Icon'
import { useLatido } from '@/state/store'
import { TrendCard } from '@/components/TrendCard'

export type FeedMode = 'home' | 'breaking' | 'bookmarks'

/**
 * El flujo. Un mismo componente para tres vistas porque comparten la misma
 * gramática visual: cabecera, filtros y lista. Cambia el origen de los datos,
 * no la forma de leerlos.
 *
 * Ojo con Zustand: los selectores deben devolver referencias estables. Contar
 * agrupaciones dentro de un selector crea un `Map` nuevo en cada render y deja
 * la interfaz en un bucle de actualización. Se calcula con `useMemo`.
 */
export function FeedScreen({ mode }: { mode: FeedMode }): JSX.Element {
  const { t, items, trends, ready, filters, setFilters, realtime, poll } = useLatido()

  const byCluster = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of items) {
      if (!item.clusterId) continue
      counts.set(item.clusterId, (counts.get(item.clusterId) ?? 0) + 1)
    }
    return counts
  }, [items])

  const bookmarked = useLatido((state) => state.bookmarkedIds)
  const visible: Item[] =
    mode === 'bookmarks' ? items.filter((item) => bookmarked.includes(item.id)) : items

  const hot = useMemo(
    () => trends.filter((trend) => trend.state === 'breaking' || trend.state === 'emerging'),
    [trends],
  )

  // Pintar cuatrocientas publicaciones de golpe no aporta nada y cuesta caro:
  // se enseña una página y el resto entra a demanda.
  const [window, setWindow] = useState(60)
  const page = visible.slice(0, window)

  if (!ready) return <SkeletonList />

  return (
    <div className="content content--narrow">
      {mode === 'home' ? <TopicFilters /> : null}

      {mode === 'breaking' ? (
        <section className="section">
          <div className="section__head">
            <span className="label">{t('breaking.subtitle')}</span>
            <span className="mono micro faint">{hot.length}</span>
          </div>
          {hot.length === 0 ? (
            <EmptyState icon="flame" title={t('breaking.empty')} hint={t('empty.hint')} />
          ) : (
            hot.map((trend, index) => <TrendCard key={trend.id} trend={trend} rank={index + 1} />)
          )}
        </section>
      ) : null}

      <section className="stream" aria-label={t('feed.title')}>
        {visible.length === 0 ? (
          mode === 'bookmarks' ? (
            <EmptyState icon="bookmark" title={t('bookmarks.empty')} hint={t('bookmarks.emptyHint')} />
          ) : (
            <EmptyState
              icon={realtime === 'connecting' ? 'radio' : 'search'}
              title={t('feed.emptyReal')}
              hint={t('feed.emptyRealHint')}
              action={
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => {
                    void poll()
                    setFilters({ topics: [], sources: [], onlyWatched: false })
                  }}
                >
                  <Icon name="refresh" size="sm" />
                  {t('app.refresh')}
                </button>
              }
            />
          )
        ) : (
          <>
            {page.map((item) => (
              <PostCard
                key={item.id}
                item={item}
                grouped={item.clusterId ? (byCluster.get(item.clusterId) ?? 0) : 0}
              />
            ))}
            {visible.length > page.length ? (
              <div className="more-button">
                <button type="button" className="btn btn--outline" onClick={() => setWindow(window + 60)}>
                  <Icon name="chevronDown" size="sm" />
                  {t('app.more')} · {visible.length - page.length}
                </button>
              </div>
            ) : null}
          </>
        )}
      </section>
    </div>
  )
}

/** Filtros del flujo: qué se mira y de dónde viene. */
export function TopicFilters(): JSX.Element {
  const { t, entities, sources, filters, toggleTopic, toggleSourceFilter, setFilters } = useLatido()

  const topEntities = [...entities]
    .filter((entity) => entity.watch)
    .concat(entities.filter((entity) => !entity.watch))
    .slice(0, 5)
  const enabledSources = sources.filter((source) => source.enabled)

  return (
    <div className="chips">
      <button
        type="button"
        className="chip"
        aria-pressed={filters.topics.length === 0 && filters.sources.length === 0 && !filters.onlyWatched}
        onClick={() => setFilters({ topics: [], sources: [], onlyWatched: false })}
      >
        <Icon name="activity" size="sm" />
        {t('app.all')}
      </button>

      <button
        type="button"
        className="chip"
        aria-pressed={filters.onlyWatched}
        onClick={() => setFilters({ onlyWatched: !filters.onlyWatched })}
      >
        <Icon name="eye" size="sm" />
        {t('feed.onlyWatched')}
      </button>

      <span className="divider" style={{ width: 1, height: '1.25rem' }} />

      {topEntities.map((entity) => (
        <button
          key={entity.slug}
          type="button"
          className="chip"
          aria-pressed={filters.topics.includes(entity.slug)}
          onClick={() => toggleTopic(entity.slug)}
        >
          {entity.watch ? <Icon name="eye" size="sm" /> : null}
          {entity.name}
        </button>
      ))}

      <span className="divider" style={{ width: 1, height: '1.25rem' }} />

      {enabledSources.map((source) => (
        <button
          key={source.kind}
          type="button"
          className="chip"
          aria-pressed={filters.sources.includes(source.kind)}
          onClick={() => toggleSourceFilter(source.kind)}
        >
          <span className="chip__dot" style={{ background: `var(--source-${source.kind})` }} />
          {sourceLabel(source.kind)}
        </button>
      ))}

      <span className="grow" />

      <button
        type="button"
        className="chip"
        aria-pressed={filters.sort === 'engaged'}
        onClick={() => setFilters({ sort: filters.sort === 'engaged' ? 'recent' : 'engaged' })}
      >
        <Icon name="trend" size="sm" />
        {filters.sort === 'engaged' ? t('feed.sortEngaged') : t('feed.sortRecent')}
      </button>
    </div>
  )
}
