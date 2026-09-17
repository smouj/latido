import { memo } from 'react'

import { ActionButton, Avatar, ExternalLink, SourceDot } from '@/components/primitives'
import { Icon } from '@/components/Icon'
import { useLatido } from '@/state/store'
import { clockTime, compactNumber, hostOf, relativeTime } from '@/lib/format'
import type { Item } from '@latido/engine'

/**
 * Una publicación del flujo.
 *
 * Jerarquía: autor y red arriba (contexto), titular en el medio (lo que se lee)
 * y métricas abajo (lo que se compara). Si el item forma parte de un tema
 * agrupado, se dice cuántas publicaciones hablan de lo mismo.
 *
 * Va memoizada a propósito: con el flujo en directo el flujo se repinta cada
 * pocos segundos, y solo debe volver a pintarse lo que ha cambiado. Las acciones
 * se piden al almacén en el momento del clic, no por suscripción.
 */
export const PostCard = memo(function PostCard({
  item,
  grouped = 0,
}: {
  item: Item
  grouped?: number
}): JSX.Element {
  const lang = useLatido((state) => state.lang)
  const t = useLatido((state) => state.t)
  const bookmarked = useLatido((state) => state.bookmarkedIds.includes(item.id))

  const title = item.title?.trim()
  const body = item.body?.trim()

  const saved = (): void => {
    const store = useLatido.getState()
    store.toggleBookmark(item.id)
    store.toast(t('app.saved'), 'ok')
  }

  return (
    <article
      className={`post ${grouped > 1 ? 'post--grouped' : ''}`}
      onClick={() => {
        const store = useLatido.getState()
        store.markRead([item.id])
        store.selectItem(item.id)
      }}
    >
      <Avatar name={item.author.displayName ?? item.author.handle} url={item.author.avatarUrl} />

      <div className="post__main">
        <div className="post__meta">
          <SourceDot source={item.source} />
          <span className="post__author truncate">{item.author.handle}</span>
          <span aria-hidden="true">·</span>
          <span className="mono">{clockTime(item.publishedAt, lang)}</span>
          <span aria-hidden="true">·</span>
          <span>{relativeTime(item.publishedAt, Date.now(), lang)}</span>
          {grouped > 1 ? (
            <span className="tag" title={t('feed.groupOf', { count: grouped })}>
              <Icon name="layers" size="sm" />
              {grouped}
            </span>
          ) : null}
        </div>

        {title ? <h3 className="post__title">{title}</h3> : null}
        {body ? <p className="post__body clamp-4">{body}</p> : null}

        <div className="post__actions">
          <ActionButton
            icon="bookmark"
            label={t('app.save')}
            active={bookmarked}
            title={t('app.save')}
            onClick={saved}
          />
          {item.metrics.likes ? (
            <ActionButton icon="star" label={compactNumber(item.metrics.likes, lang)} title="Me gusta" />
          ) : null}
          {item.metrics.replies ? (
            <ActionButton icon="reply" label={compactNumber(item.metrics.replies, lang)} title="Respuestas" />
          ) : null}
          {item.metrics.reposts ? (
            <ActionButton icon="repeat" label={compactNumber(item.metrics.reposts, lang)} title="Reposts" />
          ) : null}
          {item.metrics.comments ? (
            <ActionButton icon="reply" label={compactNumber(item.metrics.comments, lang)} title="Comentarios" />
          ) : null}
          {item.metrics.stars ? (
            <ActionButton icon="star" label={compactNumber(item.metrics.stars, lang)} title="Estrellas" />
          ) : null}
          {item.clusterId ? (
            <button
              type="button"
              className="post__action post__action--group"
              onClick={(event) => {
                event.stopPropagation()
                useLatido.getState().selectTrend(item.clusterId ?? null)
              }}
            >
              <Icon name="activity" size="sm" />
              {t('feed.conversation')}
            </button>
          ) : null}
          <ExternalLink href={item.url} className="post__action">
            <Icon name="external" size="sm" />
            {hostOf(item.url)}
          </ExternalLink>
        </div>
      </div>
    </article>
  )
})

/** Fila compacta para resultados de búsqueda y paneles. */
export const PostRow = memo(function PostRow({ item }: { item: Item }): JSX.Element {
  const lang = useLatido((state) => state.lang)
  return (
    <button
      type="button"
      className="rail-trend"
      onClick={() => useLatido.getState().selectItem(item.id)}
    >
      <span className="grow">
        <span className="rail-trend__title">{item.title ?? item.body ?? item.url}</span>
      </span>
      <span className="rail-trend__meta">{relativeTime(item.publishedAt, Date.now(), lang)}</span>
    </button>
  )
})
