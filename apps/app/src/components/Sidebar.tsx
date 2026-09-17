import { Icon, type IconName } from '@/components/Icon'
import { useLatido, type ViewKey } from '@/state/store'

interface NavEntry {
  key: ViewKey
  icon: IconName
  labelKey: 'nav.home' | 'nav.breaking' | 'nav.radar' | 'nav.following' | 'nav.explore' | 'nav.bookmarks' | 'nav.alerts' | 'nav.lists' | 'nav.sources' | 'nav.settings'
}

const PRIMARY: NavEntry[] = [
  { key: 'home', icon: 'home', labelKey: 'nav.home' },
  { key: 'breaking', icon: 'flame', labelKey: 'nav.breaking' },
  { key: 'radar', icon: 'radar', labelKey: 'nav.radar' },
  { key: 'following', icon: 'users', labelKey: 'nav.following' },
  { key: 'explore', icon: 'compass', labelKey: 'nav.explore' },
]

const YOURS: NavEntry[] = [
  { key: 'bookmarks', icon: 'bookmark', labelKey: 'nav.bookmarks' },
  { key: 'alerts', icon: 'bell', labelKey: 'nav.alerts' },
  { key: 'lists', icon: 'layers', labelKey: 'nav.lists' },
  { key: 'sources', icon: 'radio', labelKey: 'nav.sources' },
  { key: 'settings', icon: 'settings', labelKey: 'nav.settings' },
]

/** Barra lateral de escritorio. La marca, dos grupos y el estado del archivo. */
export function Sidebar(): JSX.Element {
  const { t, view, setView, counts, openPalette } = useLatido()

  const unread = useLatido((state) => state.alerts.filter((event) => !event.read).length)

  return (
    <nav className="sidebar" aria-label={t('nav.primary')}>
      <button type="button" className="brand" onClick={() => setView('home')}>
        <span className="brand__mark">
          <Icon name="pulse" />
        </span>
        <span className="stack stack--tight" style={{ gap: 0, alignItems: 'flex-start' }}>
          <span className="brand__name">latido</span>
          <span className="brand__tag">{t('app.tagline')}</span>
        </span>
      </button>

      <button
        type="button"
        className="btn btn--outline btn--block"
        onClick={() => openPalette(true)}
        aria-keyshortcuts="Control+K"
      >
        <Icon name="command" size="sm" />
        {t('app.commandPalette')}
        <span className="mono micro faint grow text-right">⌘K</span>
      </button>

      <div className="nav">
        {PRIMARY.map((entry) => (
          <NavItem key={entry.key} entry={entry} current={view} onSelect={setView} label={t(entry.labelKey)} />
        ))}
      </div>

      <div className="nav nav__group">
        <span className="label nav__label">{t('nav.yours')}</span>
        {YOURS.map((entry) => (
          <NavItem
            key={entry.key}
            entry={entry}
            current={view}
            onSelect={setView}
            label={t(entry.labelKey)}
            badge={entry.key === 'alerts' ? unread : entry.key === 'bookmarks' ? counts.items : undefined}
            badgeLabel={entry.key === 'alerts' ? String(unread) : undefined}
          />
        ))}
      </div>

      <div className="sidebar__footer">
        <span className="label">{t('explore.stats')}</span>
        <span className="inline mono micro faint">
          <Icon name="database" size="sm" />
          {counts.items} · {counts.trends} · {counts.clusters}
        </span>
      </div>
    </nav>
  )
}

function NavItem({
  entry,
  current,
  onSelect,
  label,
  badge,
  badgeLabel,
}: {
  entry: NavEntry
  current: ViewKey
  onSelect: (view: ViewKey) => void
  label: string
  badge?: number
  badgeLabel?: string
}): JSX.Element {
  const active = current === entry.key
  return (
    <button
      type="button"
      className="nav__item"
      aria-current={active ? 'page' : undefined}
      onClick={() => onSelect(entry.key)}
    >
      <Icon name={entry.icon} />
      <span className="nav__text">{label}</span>
      {badge !== undefined && badge > 0 ? (
        <span className={`nav__badge ${entry.key === 'bookmarks' ? 'nav__badge--quiet' : ''}`}>
          {badgeLabel ?? (badge > 99 ? '99+' : badge)}
        </span>
      ) : null}
    </button>
  )
}

const TABS: NavEntry[] = [
  { key: 'home', icon: 'home', labelKey: 'nav.home' },
  { key: 'radar', icon: 'radar', labelKey: 'nav.radar' },
  { key: 'search', icon: 'search', labelKey: 'nav.explore' },
  { key: 'alerts', icon: 'bell', labelKey: 'nav.alerts' },
  { key: 'settings', icon: 'settings', labelKey: 'nav.settings' },
]

/** Pestañas inferiores: la app tiene que ser cómoda también en el móvil. */
export function TabBar(): JSX.Element {
  const { t, view, setView } = useLatido()
  const unread = useLatido((state) => state.alerts.filter((event) => !event.read).length)
  return (
    <nav className="tabbar" aria-label={t('nav.primary')}>
      {TABS.map((entry) => (
        <button
          key={entry.key}
          type="button"
          className="tabbar__item"
          aria-current={view === entry.key ? 'page' : undefined}
          onClick={() => setView(entry.key)}
        >
          <Icon name={entry.icon} />
          <span>{t(entry.labelKey)}</span>
          {entry.key === 'alerts' && unread > 0 ? <span className="nav__badge">{unread}</span> : null}
        </button>
      ))}
    </nav>
  )
}
