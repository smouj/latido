import { Icon } from '@/components/Icon'
import { useLatido } from '@/state/store'

/**
 * Cabecera del canal central: título de la vista, estado del sondeo y las
 * acciones de siempre (buscar, tema, idioma, sondear). Se queda pegada arriba.
 */
export function Header({ title, subtitle }: { title: string; subtitle?: string }): JSX.Element {
  const { t, polling, lastPollAt, lang, theme, setTheme, setLang, poll, query, setQuery, counts } = useLatido()

  const live = lastPollAt !== null && Date.now() - lastPollAt < 15 * 60 * 1000

  return (
    <>
      <header className="header">
        <div className="header__titles">
          <span className="header__title">{title}</span>
          {subtitle ? <span className="header__subtitle">{subtitle}</span> : null}
        </div>

        <span className="header__spacer" />

        <label className="search-field" style={{ maxWidth: '16rem' }}>
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

        <span className={`live ${live ? 'live--on' : ''}`} title={live ? t('app.live') : t('app.paused')}>
          <span className="live__dot" />
          {polling ? t('app.refreshing') : live ? t('app.live') : t('app.paused')}
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
          <Icon name="refresh" className={polling ? 'spin' : ''} />
        </button>
      </header>
      <div className="sr-only" aria-live="polite">
        {counts.items} {t('sources.items', { count: counts.items })}
      </div>
    </>
  )
}
