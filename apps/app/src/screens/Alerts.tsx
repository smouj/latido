import { useState } from 'react'

import { EmptyState } from '@/components/primitives'
import { Icon, type IconName } from '@/components/Icon'
import { useLatido } from '@/state/store'
import { relativeTime } from '@/lib/format'
import type { AlertKind, AlertRule } from '@latido/engine'

const KINDS: { kind: AlertKind; icon: IconName }[] = [
  { kind: 'multi_source', icon: 'layers' },
  { kind: 'global_breaking', icon: 'flame' },
  { kind: 'topic_surge', icon: 'trend' },
  { kind: 'keyword', icon: 'search' },
  { kind: 'watched_entity', icon: 'eye' },
  { kind: 'project_velocity', icon: 'star' },
]

/** Avisos: la bandeja de lo que el usuario pidió saber, y las reglas que la alimentan. */
export function AlertsScreen(): JSX.Element {
  const { t, lang, alerts, rules, addRule, toggleRule, removeRule, selectTrend, markAllRead, entities } = useLatido()
  const [draft, setDraft] = useState<{ kind: AlertKind; query: string; minGrowth: number; minSources: number }>({
    kind: 'keyword',
    query: '',
    minGrowth: 1,
    minSources: 1,
  })

  const unread = alerts.filter((event) => !event.read).length

  return (
    <div className="content content--narrow">
      <section className="section section--tight between">
        <span className="label">
          {alerts.length} · {unread} {t('feed.unread', { count: unread }).replace(/\d+/, '').trim()}
        </span>
        <button type="button" className="btn btn--ghost btn--small" onClick={markAllRead} disabled={unread === 0}>
          <Icon name="check" size="sm" />
          {t('alerts.markAllRead')}
        </button>
      </section>

      {alerts.length === 0 ? (
        <EmptyState icon="bell" title={t('alerts.empty')} hint={t('alerts.emptyHint')} />
      ) : (
        <div className="stream">
          {alerts.map((event) => (
            <article className={`alert-item ${event.read ? '' : 'alert-item--unread'}`} key={event.id}>
              <span className="alert-item__icon">
                <Icon name={KINDS.find((entry) => entry.kind === event.kind)?.icon ?? 'bell'} size="sm" />
              </span>
              <span className="grow stack stack--tight" style={{ gap: 2 }}>
                <span className="alert-item__title">{event.title}</span>
                <span className="micro faint">
                  {t(`alerts.kind.${event.kind}` as 'alerts.kind.topic_surge')} ·{' '}
                  {t('alerts.triggered', { time: relativeTime(event.createdAt, Date.now(), lang) })}
                </span>
              </span>
              <span className="inline">
                <span className="alert-item__meta">
                  ×{event.snapshot.velocity.toFixed(1)} · {event.snapshot.coverage}
                </span>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => selectTrend(event.trendId)}
                  title={t('app.open')}
                  aria-label={t('app.open')}
                >
                  <Icon name="chevronRight" size="sm" />
                </button>
              </span>
            </article>
          ))}
        </div>
      )}

      <section className="section">
        <div className="section__head">
          <span className="label">{t('alerts.rules')}</span>
          <span className="mono micro faint">{rules.length}</span>
        </div>

        {rules.length === 0 ? (
          <p className="small faint">{t('alerts.emptyHint')}</p>
        ) : (
          rules.map((rule: AlertRule) => (
            <div className="row" key={rule.id}>
              <span className="row__text">
                <span className="row__title">
                  {t(`alerts.kind.${rule.kind}` as 'alerts.kind.topic_surge')}
                  {rule.query ? ` · ${rule.query}` : ''}
                </span>
                <span className="row__hint">
                  {t('alerts.minGrowth')} ×{rule.minGrowth ?? 1} · {t('alerts.minSources')} {rule.minSources ?? 1}
                </span>
              </span>
              <span className="inline">
                <button
                  type="button"
                  role="switch"
                  aria-checked={rule.enabled}
                  aria-label={t('alerts.enabled')}
                  className="switch"
                  onClick={() => toggleRule(rule.id)}
                />
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => removeRule(rule.id)}
                  aria-label="Eliminar"
                  title="Eliminar"
                >
                  <Icon name="trash" size="sm" />
                </button>
              </span>
            </div>
          ))
        )}

        <div className="panel">
          <span className="label">{t('alerts.newRule')}</span>
          <div className="choice-grid">
            {KINDS.map((entry) => (
              <button
                key={entry.kind}
                type="button"
                className="choice"
                aria-pressed={draft.kind === entry.kind}
                onClick={() => setDraft({ ...draft, kind: entry.kind })}
              >
                <span className="inline">
                  <Icon name={entry.icon} size="sm" />
                  {t(`alerts.kind.${entry.kind}` as 'alerts.kind.topic_surge')}
                </span>
                <Icon name="check" size="sm" className="choice__check" />
              </button>
            ))}
          </div>

          {draft.kind === 'keyword' || draft.kind === 'watched_entity' ? (
            <label className="field">
              <span className="label">{t('alerts.query')}</span>
              {draft.kind === 'watched_entity' ? (
                <select
                  className="select"
                  value={draft.query}
                  onChange={(event) => setDraft({ ...draft, query: event.target.value })}
                >
                  <option value="">—</option>
                  {entities.slice(0, 40).map((entity) => (
                    <option key={entity.slug} value={entity.slug}>
                      {entity.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="input"
                  value={draft.query}
                  onChange={(event) => setDraft({ ...draft, query: event.target.value })}
                  placeholder="openai, gta vi, rust…"
                />
              )}
            </label>
          ) : null}

          <div className="inline" style={{ gap: 'var(--space-4)' }}>
            <label className="field grow">
              <span className="label">{t('alerts.minGrowth')}</span>
              <input
                className="input"
                type="number"
                min={0}
                step={0.5}
                value={draft.minGrowth}
                onChange={(event) => setDraft({ ...draft, minGrowth: Number(event.target.value) })}
              />
            </label>
            <label className="field grow">
              <span className="label">{t('alerts.minSources')}</span>
              <input
                className="input"
                type="number"
                min={1}
                value={draft.minSources}
                onChange={(event) => setDraft({ ...draft, minSources: Number(event.target.value) })}
              />
            </label>
          </div>

          <button
            type="button"
            className="btn btn--primary"
            disabled={(draft.kind === 'keyword' && draft.query.trim().length < 2) || (draft.kind === 'watched_entity' && !draft.query)}
            onClick={() => {
              addRule({
                id: `rule-${draft.kind}-${Date.now().toString(36)}`,
                kind: draft.kind,
                enabled: true,
                ...(draft.query ? { query: draft.query.trim() } : {}),
                minGrowth: draft.minGrowth,
                minSources: draft.minSources,
                cooldownMs: 30 * 60 * 1000,
              })
              setDraft({ kind: draft.kind, query: '', minGrowth: 1, minSources: 1 })
            }}
          >
            <Icon name="plus" size="sm" />
            {t('alerts.newRule')}
          </button>
        </div>
      </section>
    </div>
  )
}
