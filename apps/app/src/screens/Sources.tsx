import { useState } from 'react'

import { Icon } from '@/components/Icon'
import { sourceLabel } from '@/components/primitives'
import { useLatido } from '@/state/store'
import { CONNECTORS } from '@latido/engine'
import { relativeTime } from '@/lib/format'
import { isDesktop } from '@/platform/bridge'

/**
 * Fuentes: transparencia total. Qué se lee, cada cuánto, qué falló y por qué.
 * Una app que no enseña esto está pidiendo confianza a ciegas.
 */
export function SourcesScreen(): JSX.Element {
  const { t, lang, sources, toggleSource, updateSourceOptions, poll, polling, toast } = useLatido()
  const [openKind, setOpenKind] = useState<string | null>(null)
  const desktop = isDesktop()

  return (
    <div className="content content--narrow">
      <section className="section section--tight between">
        <span className="label">
          {sources.filter((source) => source.enabled).length}/{sources.length} · {t('sources.subtitle')}
        </span>
        <button type="button" className="btn btn--outline btn--small" disabled={polling} onClick={() => void poll()}>
          <Icon name="refresh" size="sm" className={polling ? 'spin' : ''} />
          {polling ? t('app.refreshing') : t('app.refresh')}
        </button>
      </section>

      <section className="section">
        {sources.map((source) => {
          const connector = CONNECTORS[source.kind]
          const open = openKind === source.kind
          const blocked = connector?.requiresProxy && !desktop
          return (
            <article className="panel" key={source.kind}>
              <div className="panel__head">
                <span className="inline">
                  <span className="chip__dot" style={{ background: `var(--source-${source.kind})` }} />
                  <span className="row__title">{sourceLabel(source.kind)}</span>
                </span>
                <span className="inline">
                  <span className={`tag ${source.lastError ? 'state--fading' : ''}`}>
                    {source.lastError
                      ? t('sources.error', { message: source.lastError })
                      : source.lastOkAt
                        ? t('sources.lastOk', { time: relativeTime(source.lastOkAt, Date.now(), lang) })
                        : t('sources.never')}
                  </span>
                  <button
                    type="button"
                    role="switch"
                    className="switch"
                    aria-checked={source.enabled}
                    aria-label={t('sources.enabled')}
                    onClick={() => toggleSource(source.kind)}
                  />
                </span>
              </div>

              <div className="inline inline--wrap">
                <span className="micro faint">{connector?.defaultPollMs ? `${Math.round(connector.defaultPollMs / 60000)} min` : '—'}</span>
                {source.requiresProxy ? (
                  <span className="tag">
                    <Icon name="shield" size="sm" />
                    {desktop ? 'proxy local' : t('sources.needsProxy')}
                  </span>
                ) : null}
                {blocked ? <span className="tag state--fading">CORS</span> : null}
                <span className="grow" />
                <button
                  type="button"
                  className="btn btn--ghost btn--small"
                  onClick={() => setOpenKind(open ? null : source.kind)}
                >
                  <Icon name={open ? 'chevronDown' : 'chevronRight'} size="sm" />
                  {t('sources.configure')}
                </button>
                <button
                  type="button"
                  className="btn btn--outline btn--small"
                  disabled={!source.enabled || polling}
                  onClick={async () => {
                    await poll([source.kind])
                    toast(`${sourceLabel(source.kind)} · ${t('sources.pollNow')}`, 'ok')
                  }}
                >
                  <Icon name="refresh" size="sm" />
                  {t('sources.pollNow')}
                </button>
              </div>

              {open ? (
                <div className="stack stack--tight">
                  {(connector?.options ?? []).map((option) => (
                    <label className="field" key={option.key}>
                      <span className="label">{option.label}</span>
                      <input
                        className="input"
                        defaultValue={String(source.options[option.key] ?? option.defaultValue ?? '')}
                        placeholder={option.placeholder}
                        onBlur={(event) => {
                          const value = event.target.value
                          if (value === String(source.options[option.key] ?? '')) return
                          updateSourceOptions(source.kind, { [option.key]: value })
                        }}
                      />
                    </label>
                  ))}
                  {connector?.options.length === 0 ? <span className="micro faint">—</span> : null}
                </div>
              ) : null}
            </article>
          )
        })}
      </section>

      <section className="section">
        <span className="label">{t('sources.health')}</span>
        <p className="small muted">
          {t('sources.needsProxy')} · {desktop ? 'escritorio' : 'navegador'}
        </p>
        <div className="kindlist">
          {sources.map((source) => (
            <span className="tag" key={source.kind}>
              {sourceLabel(source.kind)}
              <span className={source.lastOkAt ? 'delta' : 'faint'}>
                {source.lastOkAt ? 'ok' : '—'}
              </span>
            </span>
          ))}
        </div>
      </section>
    </div>
  )
}
