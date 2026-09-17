import { useMemo } from 'react'

import { TrendCard } from '@/components/TrendCard'
import { PostCard } from '@/components/PostCard'
import { EmptyState } from '@/components/primitives'
import { Icon } from '@/components/Icon'
import { useLatido } from '@/state/store'

type StateFilter = 'all' | 'breaking' | 'emerging' | 'rising'

/**
 * Radar: la pantalla que responde a "¿qué está creciendo y por qué?". Arriba,
 * los temas ordenados por pulso; al elegir uno, se abre su conversación
 * completa —todas las redes, en un solo hilo— sin salir de la vista.
 */
export function RadarScreen(): JSX.Element {
  const { t, trends, selectTrend, selectedTrendId, items } = useLatido()
  const filters = useLatido((state) => state.filters)
  const setFilters = useLatido((state) => state.setFilters)

  const state = (filters.topics[0] as StateFilter | undefined) ?? 'all'
  const visible = useMemo(
    () => (state === 'all' ? trends : trends.filter((trend) => trend.state === state)),
    [state, trends],
  )

  const conversation = useMemo(() => {
    if (!selectedTrendId) return []
    return items.filter((item) => item.clusterId === selectedTrendId)
  }, [items, selectedTrendId])

  const states: { key: StateFilter; label: string }[] = [
    { key: 'all', label: t('app.all') },
    { key: 'breaking', label: t('radar.breaking') },
    { key: 'emerging', label: t('radar.emerging') },
    { key: 'rising', label: t('radar.rising') },
  ]

  return (
    <>
      <div className="chips">
        {states.map((entry) => (
          <button
            key={entry.key}
            type="button"
            className="chip"
            aria-pressed={state === entry.key}
            onClick={() => setFilters({ topics: entry.key === 'all' ? [] : [entry.key] })}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="content content--narrow">
        {visible.length === 0 ? (
          <EmptyState icon="radar" title={t('radar.empty')} hint={t('empty.hint')} />
        ) : (
          visible.map((trend, index) => <TrendCard key={trend.id} trend={trend} rank={index + 1} />)
        )}

        {selectedTrendId && conversation.length > 0 ? (
          <section className="section">
            <div className="section__head">
              <span className="label">
                <Icon name="layers" size="sm" /> {t('feed.conversation')}
              </span>
              <span className="mono micro faint">{conversation.length}</span>
            </div>
            <div className="stream">
              {conversation.map((item) => (
                <PostCard key={item.id} item={item} grouped={conversation.length} />
              ))}
            </div>
            <button type="button" className="btn btn--ghost btn--small" onClick={() => selectTrend(null)}>
              <Icon name="chevronDown" size="sm" />
              {t('app.less')}
            </button>
          </section>
        ) : null}
      </div>
    </>
  )
}
