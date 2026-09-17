import { useEffect, useMemo, useRef, useState } from 'react'

import { Icon, type IconName } from '@/components/Icon'
import { getEngine, useLatido, type ViewKey } from '@/state/store'
import { relativeTime } from '@/lib/format'
import type { Item } from '@latido/engine'

interface Command {
  id: string
  label: string
  hint?: string
  icon: IconName
  run: () => void
}

/**
 * Paleta de comandos (⌘K / Ctrl+K): la forma rápida de moverse sin ratón.
 * Busca a la vez en los comandos y en el archivo local de publicaciones.
 */
export function CommandPalette(): JSX.Element | null {
  const paletteOpen = useLatido((state) => state.paletteOpen)
  const openPalette = useLatido((state) => state.openPalette)
  const setView = useLatido((state) => state.setView)
  const setTheme = useLatido((state) => state.setTheme)
  const setLang = useLatido((state) => state.setLang)
  const selectItem = useLatido((state) => state.selectItem)
  const poll = useLatido((state) => state.poll)
  const t = useLatido((state) => state.t)
  const lang = useLatido((state) => state.lang)

  const [term, setTerm] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!paletteOpen) {
      setTerm('')
      return
    }
    inputRef.current?.focus()
  }, [paletteOpen])

  useEffect(() => {
    if (!paletteOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') openPalette(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [paletteOpen, openPalette])

  const commands = useMemo<Command[]>(() => {
    const go = (view: ViewKey) => () => {
      setView(view)
      openPalette(false)
    }
    return [
      { id: 'go-home', label: t('nav.home'), icon: 'home', run: go('home') },
      { id: 'go-breaking', label: t('nav.breaking'), icon: 'flame', run: go('breaking') },
      { id: 'go-radar', label: t('nav.radar'), icon: 'radar', run: go('radar') },
      { id: 'go-following', label: t('nav.following'), icon: 'users', run: go('following') },
      { id: 'go-explore', label: t('nav.explore'), icon: 'compass', run: go('explore') },
      { id: 'go-bookmarks', label: t('nav.bookmarks'), icon: 'bookmark', run: go('bookmarks') },
      { id: 'go-alerts', label: t('nav.alerts'), icon: 'bell', run: go('alerts') },
      { id: 'go-sources', label: t('nav.sources'), icon: 'radio', run: go('sources') },
      { id: 'go-settings', label: t('nav.settings'), icon: 'settings', run: go('settings') },
      {
        id: 'poll',
        label: t('app.refresh'),
        icon: 'refresh',
        run: () => {
          void poll()
          openPalette(false)
        },
      },
      {
        id: 'theme-dark',
        label: t('settings.themeDark'),
        icon: 'moon',
        run: () => {
          setTheme('dark')
          openPalette(false)
        },
      },
      {
        id: 'theme-light',
        label: t('settings.themeLight'),
        icon: 'sun',
        run: () => {
          setTheme('light')
          openPalette(false)
        },
      },
      {
        id: 'theme-system',
        label: t('settings.themeSystem'),
        icon: 'globe',
        run: () => {
          setTheme('system')
          openPalette(false)
        },
      },
      {
        id: 'lang',
        label: lang === 'es' ? 'English' : 'Español',
        icon: 'globe',
        run: () => {
          setLang(lang === 'es' ? 'en' : 'es')
          openPalette(false)
        },
      },
    ]
  }, [lang, openPalette, poll, setLang, setTheme, setView, t])

  if (!paletteOpen) return null

  const needle = term.trim().toLowerCase()
  const matchingCommands = commands.filter((command) => command.label.toLowerCase().includes(needle))
  const matchingItems: Item[] = needle.length > 1 ? getEngine().search(term, 6) : []

  return (
    <div className="overlay" onClick={() => openPalette(false)} role="presentation">
      <div className="palette" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
        <div className="palette__input">
          <Icon name="search" />
          <input
            ref={inputRef}
            value={term}
            placeholder={t('app.commandHint')}
            onChange={(event) => setTerm(event.target.value)}
            aria-label={t('app.commandPalette')}
          />
          <span className="mono micro">esc</span>
        </div>
        <div className="palette__list">
          {matchingCommands.map((command, index) => (
            <button
              key={command.id}
              type="button"
              className="palette__item"
              data-active={index === 0 ? 'true' : undefined}
              onClick={command.run}
            >
              <Icon name={command.icon} size="sm" />
              {command.label}
              {command.hint ? <small>{command.hint}</small> : null}
            </button>
          ))}
          {matchingItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className="palette__item"
              onClick={() => {
                selectItem(item.id)
                openPalette(false)
              }}
            >
              <Icon name="activity" size="sm" />
              <span className="truncate">{item.title ?? item.body ?? item.url}</span>
              <small>{relativeTime(item.publishedAt, Date.now(), lang)}</small>
            </button>
          ))}
          {matchingCommands.length === 0 && matchingItems.length === 0 ? (
            <p className="empty__hint" style={{ padding: 'var(--space-4)' }}>
              {t('search.noResults', { query: term })}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

/** Avisos flotantes: confirmaciones breves, nunca diálogos que bloquean. */
export function Toasts(): JSX.Element {
  const toasts = useLatido((state) => state.toasts)
  const dismiss = useLatido((state) => state.dismissToast)
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <button key={toast.id} type="button" className={`toast toast--${toast.tone}`} onClick={() => dismiss(toast.id)}>
          <Icon name={toast.tone === 'ok' ? 'check' : toast.tone === 'warn' ? 'info' : 'activity'} size="sm" />
          {toast.message}
        </button>
      ))}
    </div>
  )
}
