import { useMemo } from 'react'

import { PostCard } from '@/components/PostCard'
import { EmptyState } from '@/components/primitives'
import { Icon } from '@/components/Icon'
import { getEngine, useLatido } from '@/state/store'

/** Buscar en todo el archivo local: títulos, texto y etiquetas. */
export function SearchScreen(): JSX.Element {
  const { t, query, trends, selectTrend } = useLatido()

  const results = useMemo(() => (query.trim().length > 1 ? getEngine().search(query, 80) : []), [query])
  const matchingTrends = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (needle.length < 2) return []
    return trends.filter(
      (trend) =>
        trend.title.toLowerCase().includes(needle) ||
        trend.keywords.some((keyword) => keyword.includes(needle)),
    )
  }, [query, trends])

  if (query.trim().length < 2) {
    return (
      <div className="content content--narrow">
        <EmptyState icon="search" title={t('search.title')} hint={t('search.hint')} />
      </div>
    )
  }

  return (
    <div className="content content--narrow">
      {matchingTrends.length > 0 ? (
        <section className="section">
          <span className="label">{t('search.inTrends')}</span>
          <div className="kindlist">
            {matchingTrends.slice(0, 8).map((trend) => (
              <button key={trend.id} type="button" className="chip" onClick={() => selectTrend(trend.id)}>
                <Icon name="radar" size="sm" />
                {trend.title}
                <span className="mono faint">{trend.score}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section className="section section--tight">
        <span className="label">{t('search.results', { count: results.length })}</span>
      </section>

      {results.length === 0 ? (
        <EmptyState icon="search" title={t('search.noResults', { query })} hint={t('search.hint')} />
      ) : (
        <div className="stream">
          {results.map((item) => (
            <PostCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  )
}
