import { useEffect } from 'react'

import { CommandPalette, Toasts } from '@/components/CommandPalette'
import { Header } from '@/components/Header'
import { Rail } from '@/components/Rail'
import { Sidebar, TabBar } from '@/components/Sidebar'
import { SkeletonList } from '@/components/primitives'
import { AlertsScreen } from '@/screens/Alerts'
import { ExploreScreen } from '@/screens/Explore'
import { FeedScreen } from '@/screens/Feed'
import { FollowingScreen } from '@/screens/Following'
import { ItemScreen } from '@/screens/Item'
import { ListsScreen } from '@/screens/Lists'
import { Onboarding } from '@/screens/Onboarding'
import { RadarScreen } from '@/screens/Radar'
import { SearchScreen } from '@/screens/Search'
import { SettingsScreen } from '@/screens/Settings'
import { SourcesScreen } from '@/screens/Sources'
import { useLatido, type ViewKey } from '@/state/store'

/** Título y subtítulo de cada vista. La cabecera los usa tal cual. */
const HEADINGS: Record<ViewKey, { title: string; subtitle?: string }> = {
  home: { title: 'feed.title', subtitle: 'feed.subtitle' },
  breaking: { title: 'breaking.title', subtitle: 'breaking.subtitle' },
  radar: { title: 'radar.title', subtitle: 'radar.subtitle' },
  following: { title: 'following.title', subtitle: 'following.subtitle' },
  explore: { title: 'explore.title', subtitle: 'explore.subtitle' },
  search: { title: 'search.title' },
  bookmarks: { title: 'bookmarks.title', subtitle: 'bookmarks.subtitle' },
  alerts: { title: 'alerts.title', subtitle: 'alerts.subtitle' },
  lists: { title: 'lists.title', subtitle: 'lists.subtitle' },
  sources: { title: 'sources.title', subtitle: 'sources.subtitle' },
  settings: { title: 'settings.title' },
  item: { title: 'feed.title' },
}

export function App(): JSX.Element {
  const ready = useLatido((state) => state.ready)
  const onboarded = useLatido((state) => state.onboarded)
  const view = useLatido((state) => state.view)
  const t = useLatido((state) => state.t)
  const init = useLatido((state) => state.init)
  const poll = useLatido((state) => state.poll)
  const readyState = useLatido((state) => state.polling)

  useEffect(() => {
    void init()
  }, [init])

  // Un sondeo al volver a la ventana: no tiene sentido gastar red en segundo plano.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void poll()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [poll])

  // Sondeo periódico: el más rápido de las fuentes activas, con suelo de 60 s.
  useEffect(() => {
    const sources = useLatido.getState().sources
    const fastest = Math.min(
      ...sources.filter((source) => source.enabled).map((source) => source.pollMs ?? 300_000),
      300_000,
    )
    const interval = setInterval(() => void poll(), Math.max(60_000, fastest))
    return () => clearInterval(interval)
  }, [poll])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      const state = useLatido.getState()
      if (event.key.toLowerCase() === 'r') void state.poll()
      if (event.key.toLowerCase() === 'g') {
        const next = (event.shiftKey ? 'radar' : 'home') as ViewKey
        state.setView(next)
      }
      if (event.key === '/') {
        event.preventDefault()
        state.openPalette(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!ready) {
    return (
      <div className="shell shell--wide">
        <div className="column column--center">
          <SkeletonList rows={8} />
        </div>
      </div>
    )
  }

  if (!onboarded) return <Onboarding />

  const heading = HEADINGS[view]
  const title = t(heading.title as 'feed.title')
  const subtitle = heading.subtitle ? t(heading.subtitle as 'feed.subtitle') : undefined

  return (
    <>
      <div className="shell">
        <Sidebar />

        <main className="column column--center">
          <Header title={title} subtitle={subtitle} />

          {view === 'home' ? <FeedScreen mode="home" /> : null}
          {view === 'breaking' ? <FeedScreen mode="breaking" /> : null}
          {view === 'bookmarks' ? <FeedScreen mode="bookmarks" /> : null}
          {view === 'radar' ? <RadarScreen /> : null}
          {view === 'following' ? <FollowingScreen /> : null}
          {view === 'explore' ? <ExploreScreen /> : null}
          {view === 'search' ? <SearchScreen /> : null}
          {view === 'alerts' ? <AlertsScreen /> : null}
          {view === 'lists' ? <ListsScreen /> : null}
          {view === 'sources' ? <SourcesScreen /> : null}
          {view === 'settings' ? <SettingsScreen /> : null}
          {view === 'item' ? <ItemScreen /> : null}

          <footer className="column__foot">
            <span>
              {t('app.updated', { time: readyState ? t('app.refreshing') : t('app.live') })} ·{' '}
              <a href="https://github.com/smouj/latido" target="_blank" rel="noopener noreferrer">
                latido
              </a>{' '}
              · AGPL-3.0
            </span>
          </footer>
        </main>

        <Rail />
      </div>

      <TabBar />
      <CommandPalette />
      <Toasts />
    </>
  )
}
