import { Icon } from '@/components/Icon'
import { useLatido } from '@/state/store'

/**
 * Cabecera del canal central: título de la vista, estado real de la conexión y
 * las acciones de siempre (buscar, tema, idioma, sondear). Se queda pegada
 * arriba.
 *
 * El indicador dice la verdad: si el flujo en directo está conectado lo dice, y
 * si solo hay sondeo también. Nunca un "en vivo" decorativo.
 */
export function Header({ title, subtitle }: { title: string; subtitle?: string }): JSX.Element {
  const { t, polling, lastPollAt, lang, theme, setTheme, setLang, poll, query, setQuery, realtime, pollError } =
    useLatido()

  const realtimeLabel = t(`realtime.${realtime}` as 'realtime.live')
  const realtimeOn = realtime === 'live'
  const recentPoll = lastPollAt !== null && Date.now() - lastPollAt < 15 * 60 * 1000
  const tone = realtimeOn ? 'live--on' : recentPoll ? 'live--ok' : pollError ? 'live--warn' : ''

  return (
    <>
      <header className="header">
        <div className="header__titles">
          <span className="header__title">{title}</span>
          {subtitle ? <span className="header__subtitle">{subtitle}</span> : null}
        </div>

        <span className="header__spacer" />

        <label className="search-field">
          <Icon name="search" size="sm" />
          <input
            value={query}
            placeholder={t('app.searchPlaceholder')}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={t('app.search')}
          />
          {query ? (
            <button type="button" className="icon-btn" onClick={() => setQuery('')} aria-label={t('app.close')}>
              <Icon name="close" size="sm" />
            </button>
          ) : null}
        </label>

        <span className={`live ${tone}`} title={realtimeOn ? realtimeLabel : t('app.refresh')}>
          <span className="live__dot" />
          {polling ? t('app.refreshing') : realtimeLabel}
        </span>

        <button
          type="button"
          className="icon-btn"
          onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
          title={theme === 'light' ? t('app.theme.toDark') : t('app.theme.toLight')}
          aria-label={t('app.theme.toDark')}
        >
          <Icon name={theme === 'light' ? 'moon' : 'sun'} />
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={() => setLang(lang === 'es' ? 'en' : 'es')}
          title={t('app.language')}
          aria-label={t('app.language')}
        >
          <span className="mono micro">{lang.toUpperCase()}</span>
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={() => void poll()}
          disabled={polling}
          title={t('app.refresh')}
          aria-label={t('app.refresh')}
        >
          <Icon name="refresh" />
        </button>
      </header>
    </>
  )
}
