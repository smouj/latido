import { useMemo, useState } from 'react'

import { PostCard } from '@/components/PostCard'
import { Avatar, EmptyState } from '@/components/primitives'
import { Icon } from '@/components/Icon'
import { useLatido } from '@/state/store'
import { getEngine } from '@/state/store'

/**
 * Siguiendo: el sustituto real del "following" de una red social. Aquí la
 * unidad no es la cuenta de una plataforma, sino la persona, la empresa o el
 * proyecto: aparezcan donde aparezcan.
 */
export function FollowingScreen(): JSX.Element {
  const { t, entities, watchEntity, selectItem } = useLatido()
  const [slug, setSlug] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  const watched = entities.filter((entity) => entity.watch)
  const list = (watched.length > 0 ? watched : entities).filter((entity) =>
    entity.name.toLowerCase().includes(filter.toLowerCase()),
  )

  const timeline = useMemo(() => {
    if (!slug) return []
    return getEngine().entityTimeline(slug, 40)
    // El motor cambia por referencia; `entities` marca cuándo hay datos nuevos.
  }, [slug, entities.length])

  return (
    <>
      {watched.length > 0 ? (
        <div className="chips">
          <button type="button" className="chip" aria-pressed={slug === null} onClick={() => setSlug(null)}>
            {t('app.all')} · {watched.length}
          </button>
          {watched.map((entity) => (
            <button
              key={entity.slug}
              type="button"
              className="chip"
              aria-pressed={slug === entity.slug}
              onClick={() => setSlug(entity.slug)}
            >
              <Icon name="eye" size="sm" />
              {entity.name}
            </button>
          ))}
        </div>
      ) : null}

      <div className="content content--narrow">
        {slug ? (
          <section className="section">
            <div className="section__head">
              <span className="label">
                {t('following.timeline')} · {entities.find((entity) => entity.slug === slug)?.name}
              </span>
              <span className="mono micro faint">{timeline.length}</span>
            </div>
            {timeline.length === 0 ? (
              <EmptyState icon="users" title={t('empty.noItems')} hint={t('empty.hint')} />
            ) : (
              <div className="stream">
                {timeline.map((item) => (
                  <PostCard key={item.id} item={item} />
                ))}
              </div>
            )}
            <button type="button" className="btn btn--ghost btn--small" onClick={() => setSlug(null)}>
              <Icon name="chevronDown" size="sm" />
              {t('app.less')}
            </button>
          </section>
        ) : (
          <>
            <section className="section section--tight">
              <label className="search-field">
                <Icon name="search" size="sm" />
                <input
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  placeholder={t('app.searchPlaceholder')}
                  aria-label={t('app.search')}
                />
              </label>
            </section>

            <section className="section">
              {list.length === 0 ? (
                <EmptyState icon="users" title={t('following.empty')} hint={t('following.emptyHint')} />
              ) : (
                <div className="grid-cards">
                  {list.map((entity) => {
                    const count = getEngine().entityTimeline(entity.slug, 200).length
                    return (
                      <article className="entity-card" key={entity.slug}>
                        <div className="entity-card__head">
                          <Avatar name={entity.name} size="sm" />
                          <span className="grow">
                            <span className="entity-card__name truncate">{entity.name}</span>
                            <span className="entity-card__kind">{entity.kind}</span>
                          </span>
                        </div>
                        <span className="mono micro faint">
                          {t('following.across', { count })} · {count} {t('radar.volume').toLowerCase()}
                        </span>
                        <div className="inline">
                          <button
                            type="button"
                            className={`btn btn--small ${entity.watch ? 'btn--primary' : 'btn--outline'}`}
                            onClick={() => watchEntity(entity.slug)}
                          >
                            <Icon name={entity.watch ? 'check' : 'plus'} size="sm" />
                            {entity.watch ? t('following.watching') : t('following.watch')}
                          </button>
                          <button
                            type="button"
                            className="btn btn--ghost btn--small"
                            onClick={() => setSlug(entity.slug)}
                            disabled={count === 0}
                          >
                            {t('following.timeline')}
                          </button>
                          {count > 0 ? (
                            <button
                              type="button"
                              className="btn btn--ghost btn--small"
                              onClick={() => {
                                const [first] = getEngine().entityTimeline(entity.slug, 1)
                                if (first) selectItem(first.id)
                              }}
                            >
                              <Icon name="chevronRight" size="sm" />
                            </button>
                          ) : null}
                        </div>
                      </article>
                    )
                  })}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </>
  )
}
