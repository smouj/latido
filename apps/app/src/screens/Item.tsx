import { useMemo } from 'react'

import { PostCard } from '@/components/PostCard'
import { Avatar, EmptyState, SourceDot, sourceLabel } from '@/components/primitives'
import { Icon } from '@/components/Icon'
import { useLatido } from '@/state/store'
import { clockTime, compactNumber, hostOf, longDate, relativeTime } from '@/lib/format'
import { copyToClipboard, openExternal } from '@/platform/bridge'

/**
 * Detalle de una publicación: el texto completo, de dónde viene y —lo
 * importante— el resto de la conversación. Ese hilo cruzado entre redes es lo
 * que ninguna plataforma te puede enseñar.
 */
export function ItemScreen(): JSX.Element {
  const { t, lang, selectedItemId, items, selectTrend, toggleBookmark, toast, bookmarkedIds } = useLatido()

  const item = items.find((entry) => entry.id === selectedItemId) ?? null
  const conversation = useMemo(
    () => (item?.clusterId ? items.filter((entry) => entry.clusterId === item.clusterId) : []),
    [item, items],
  )

  if (!item) {
    return (
      <div className="content content--narrow">
        <EmptyState icon="info" title={t('empty.noItems')} hint={t('empty.hint')} />
      </div>
    )
  }

  const bookmarked = bookmarkedIds.includes(item.id)

  return (
    <div className="content content--narrow">
      <article className="section">
        <div className="inline">
          <Avatar name={item.author.displayName ?? item.author.handle} url={item.author.avatarUrl} size="lg" />
          <span className="grow stack stack--tight">
            <span className="strong">{item.author.displayName ?? item.author.handle}</span>
            <span className="micro faint inline">
              <SourceDot source={item.source} withLabel />
              <span aria-hidden="true">·</span>
              <span>{item.author.handle}</span>
            </span>
          </span>
          <span className="stack stack--tight" style={{ alignItems: 'flex-end' }}>
            <span className="mono micro faint">{clockTime(item.publishedAt, lang)}</span>
            <span className="micro faint">{longDate(item.publishedAt, lang)}</span>
          </span>
        </div>

        {item.title ? <h2 className="title">{item.title}</h2> : null}
        {item.body ? <p className="body">{item.body}</p> : null}

        <div className="trend__metrics">
          <div className="metric">
            <span className="metric__label">{t('app.source')}</span>
            <span className="metric__value" style={{ fontSize: 'var(--text-md)' }}>
              {sourceLabel(item.source)}
            </span>
            <span className="metric__hint">{item.lang?.toUpperCase() ?? '—'}</span>
          </div>
          <div className="metric">
            <span className="metric__label">{t('radar.engagement')}</span>
            <span className="metric__value">
              {compactNumber(
                (item.metrics.likes ?? 0) + (item.metrics.reposts ?? 0) + (item.metrics.replies ?? 0),
                lang,
              )}
            </span>
            <span className="metric__hint">
              ✚ {compactNumber(item.metrics.likes ?? 0, lang)} · ⇄ {compactNumber(item.metrics.reposts ?? 0, lang)}
            </span>
          </div>
          <div className="metric">
            <span className="metric__label">{t('feed.groupOf', { count: conversation.length })}</span>
            <span className="metric__value">{conversation.length}</span>
            <span className="metric__hint">
              {item.clusterId ? t('feed.conversation') : '—'}
            </span>
          </div>
        </div>

        <div className="inline inline--wrap">
          <button type="button" className="btn btn--outline btn--small" onClick={() => void openExternal(item.url)}>
            <Icon name="external" size="sm" />
            {hostOf(item.url)}
          </button>
          <button
            type="button"
            className={`btn btn--small ${bookmarked ? 'btn--primary' : 'btn--outline'}`}
            onClick={() => {
              toggleBookmark(item.id)
              toast(t('app.saved'), 'ok')
            }}
          >
            <Icon name="bookmark" size="sm" />
            {t('app.save')}
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--small"
            onClick={async () => {
              const copied = await copyToClipboard(item.url)
              toast(copied ? t('app.copied') : t('error.generic'), copied ? 'ok' : 'warn')
            }}
          >
            <Icon name="copy" size="sm" />
            {t('app.copyLink')}
          </button>
          {item.clusterId ? (
            <button
              type="button"
              className="btn btn--ghost btn--small"
              onClick={() => selectTrend(item.clusterId ?? null)}
            >
              <Icon name="activity" size="sm" />
              {t('radar.title')}
            </button>
          ) : null}
        </div>

        {item.tags.length > 0 ? (
          <div className="kindlist">
            {item.tags.map((tag) => (
              <span className="tag" key={tag}>
                #{tag}
              </span>
            ))}
          </div>
        ) : null}

        <span className="micro faint">
          {t('sources.lastOk', { time: relativeTime(item.ingestedAt, Date.now(), lang) })} · {item.origin}
        </span>
      </article>

      {conversation.length > 1 ? (
        <section className="stream">
          {conversation
            .filter((entry) => entry.id !== item.id)
            .map((entry) => (
              <PostCard key={entry.id} item={entry} grouped={conversation.length} />
            ))}
        </section>
      ) : null}
    </div>
  )
}
