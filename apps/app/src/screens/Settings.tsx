import { useEffect, useState } from 'react'

import { Icon } from '@/components/Icon'
import { useLatido } from '@/state/store'
import { compactNumber } from '@/lib/format'
import { platformName, storageUsage } from '@/platform/bridge'

/** Ajustes: apariencia, idioma, datos y transparencia sobre qué se guarda. */
export function SettingsScreen(): JSX.Element {
  const {
    t,
    lang,
    theme,
    setTheme,
    setLang,
    retentionDays,
    setRetention,
    counts,
    exportState,
    importState,
    wipe,
    toast,
    demoMode,
    loadSample,
  } = useLatido()

  const [usage, setUsage] = useState(0)

  useEffect(() => {
    void storageUsage().then(setUsage)
  }, [counts.items])

  const download = (): void => {
    const blob = new Blob([exportState()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `latido-${new Date().toISOString().slice(0, 10)}.json`
    anchor.click()
    URL.revokeObjectURL(url)
    toast(t('settings.export'), 'ok')
  }

  const restore = (file: File): void => {
    const reader = new FileReader()
    reader.onload = async () => {
      const ok = await importState(String(reader.result))
      toast(ok ? t('settings.saved') : t('error.generic'), ok ? 'ok' : 'warn')
    }
    reader.readAsText(file)
  }

  return (
    <div className="content content--narrow">
      <section className="section">
        <span className="label">{t('settings.appearance')}</span>
        <div className="row">
          <span className="row__text">
            <span className="row__title">{t('settings.theme')}</span>
            <span className="row__hint">{t('settings.themeSystem')} · {theme}</span>
          </span>
          <span className="inline">
            <button
              type="button"
              className={`btn btn--small ${theme === 'dark' ? 'btn--primary' : 'btn--outline'}`}
              onClick={() => setTheme('dark')}
            >
              <Icon name="moon" size="sm" />
              {t('settings.themeDark')}
            </button>
            <button
              type="button"
              className={`btn btn--small ${theme === 'light' ? 'btn--primary' : 'btn--outline'}`}
              onClick={() => setTheme('light')}
            >
              <Icon name="sun" size="sm" />
              {t('settings.themeLight')}
            </button>
            <button
              type="button"
              className={`btn btn--small ${theme === 'system' ? 'btn--primary' : 'btn--outline'}`}
              onClick={() => setTheme('system')}
            >
              <Icon name="globe" size="sm" />
              {t('settings.themeSystem')}
            </button>
          </span>
        </div>

        <div className="row">
          <span className="row__text">
            <span className="row__title">{t('settings.language')}</span>
            <span className="row__hint">{lang === 'es' ? 'Español' : 'English'}</span>
          </span>
          <span className="inline">
            <button
              type="button"
              className={`btn btn--small ${lang === 'es' ? 'btn--primary' : 'btn--outline'}`}
              onClick={() => setLang('es')}
            >
              ES
            </button>
            <button
              type="button"
              className={`btn btn--small ${lang === 'en' ? 'btn--primary' : 'btn--outline'}`}
              onClick={() => setLang('en')}
            >
              EN
            </button>
          </span>
        </div>
      </section>

      <section className="section">
        <span className="label">{t('settings.data')}</span>
        <p className="small muted">{t('settings.dataHint')}</p>

        <div className="row">
          <span className="row__text">
            <span className="row__title">{t('settings.retention')}</span>
            <span className="row__hint">
              {retentionDays === 0 ? t('settings.forever') : t('settings.days', { count: retentionDays })}
            </span>
          </span>
          <input
            type="range"
            min={0}
            max={365}
            step={5}
            value={retentionDays}
            onChange={(event) => setRetention(Number(event.target.value))}
            aria-label={t('settings.retention')}
          />
        </div>

        <div className="row">
          <span className="row__text">
            <span className="row__title">{t('settings.storage')}</span>
            <span className="row__hint">
              {t('settings.storageDetail', {
                items: compactNumber(counts.items, lang),
                trends: counts.trends,
                size: usage > 0 ? `${(usage / 1024 / 1024).toFixed(1)} MB` : platformName(),
              })}
            </span>
          </span>
          <span className="tag">{demoMode ? t('app.demo') : t('app.live')}</span>
        </div>

        <div className="inline inline--wrap">
          <button type="button" className="btn btn--outline btn--small" onClick={download}>
            <Icon name="download" size="sm" />
            {t('settings.export')}
          </button>
          <label className="btn btn--outline btn--small">
            <Icon name="upload" size="sm" />
            {t('settings.import')}
            <input
              type="file"
              accept="application/json"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) restore(file)
              }}
            />
          </label>
          <button type="button" className="btn btn--ghost btn--small" onClick={() => loadSample()}>
            <Icon name="sparkles" size="sm" />
            {t('app.demo')}
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--small"
            onClick={() => {
              if (window.confirm(t('settings.clearConfirm'))) void wipe()
            }}
          >
            <Icon name="trash" size="sm" />
            {t('settings.clear')}
          </button>
        </div>
      </section>

      <section className="section">
        <span className="label">{t('app.shortcuts')}</span>
        <div className="row">
          <span className="row__text">
            <span className="row__title">{t('app.commandPalette')}</span>
            <span className="row__hint">{t('app.commandHint')}</span>
          </span>
          <span className="tag mono">⌘K</span>
        </div>
        <div className="row">
          <span className="row__text">
            <span className="row__title">{t('app.refresh')}</span>
            <span className="row__hint">{t('sources.subtitle')}</span>
          </span>
          <span className="tag mono">R</span>
        </div>
      </section>

      <section className="section">
        <span className="label">{t('settings.about')}</span>
        <p className="small muted">{t('settings.aboutText')}</p>
        <div className="inline inline--wrap">
          <span className="tag">AGPL-3.0</span>
          <span className="tag">v0.1.0</span>
          <span className="tag">{platformName()}</span>
          <a
            className="tag"
            href="https://github.com/smouj/latido"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Icon name="external" size="sm" />
            github.com/smouj/latido
          </a>
        </div>
      </section>
    </div>
  )
}
