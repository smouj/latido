import { useEffect, useState } from 'react'

import { Icon } from '@/components/Icon'
import { sourceLabel } from '@/components/primitives'
import { useLatido } from '@/state/store'
import type { TranslateProviderKind } from '@latido/engine'
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
    realtime,
    realtimeDetail,
    lastPollAt,
    sources,
    platform,
    setPlatform,
    translation,
    setTranslation,
    setTranslationKey,
    testTranslation,
    clearTranslations,
    translationReady,
    translationError,
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
        <span className="label">{t('theme.title')}</span>
        <p className="small muted">{t('theme.hint')}</p>
        <div className="theme-grid">
          {(['windows', 'macos', 'linux'] as const).map((name) => (
            <button
              key={name}
              type="button"
              className={`theme-card ${platform === name ? 'theme-card--on' : ''}`}
              aria-pressed={platform === name}
              onClick={() => setPlatform(name)}
            >
              <span className={`theme-swatch theme-swatch--${name}`} aria-hidden="true">
                <span className="theme-swatch__bar" />
                <span className="theme-swatch__bar theme-swatch__bar--short" />
                <span className="theme-swatch__accent" />
              </span>
              <span className="theme-card__name">{t(`theme.${name}` as 'theme.windows')}</span>
              <span className="theme-card__hint">{t(`theme.${name}Hint` as 'theme.windowsHint')}</span>
            </button>
          ))}
        </div>
        <div className="segmented" role="group" aria-label={t('theme.appearance')}>
          {(['system', 'light', 'dark'] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={theme === value ? 'is-on' : ''}
              aria-pressed={theme === value}
              onClick={() => setTheme(value)}
            >
              {t(`theme.${value}` as 'theme.system')}
            </button>
          ))}
        </div>
      </section>

      <section className="section">
        <span className="label">{t('translate.title')}</span>
        <p className="small muted">{t('translate.hint')}</p>

        <div className="row">
          <span className="row__text">
            <span className="row__title">{t('translate.enabled')}</span>
            <span className="row__hint">{t('translate.enabledHint', { lang: lang.toUpperCase() })}</span>
          </span>
          <button
            type="button"
            className="switch"
            aria-checked={translation.enabled}
            aria-label={t('translate.enabled')}
            onClick={() => setTranslation({ enabled: !translation.enabled })}
          />
        </div>

        <div className="row">
          <span className="row__text">
            <span className="row__title">{t('translate.provider')}</span>
            <span className="row__hint">
              {translationReady ? t('translate.ready') : t('translate.notConfigured')}
            </span>
          </span>
          <select
            className="select"
            value={translation.kind}
            aria-label={t('translate.provider')}
            onChange={(event) =>
              setTranslation({ kind: event.target.value as TranslateProviderKind })
            }
          >
            <option value="none">{t('translate.none')}</option>
            <option value="libre">LibreTranslate</option>
            <option value="deepl">DeepL</option>
            <option value="openai">OpenAI</option>
          </select>
        </div>

        {translation.kind === 'libre' || translation.kind === 'openai' ? (
          <label className="field">
            <span className="label">{t('translate.endpoint')}</span>
            <input
              className="input"
              value={translation.endpoint}
              placeholder={translation.kind === 'libre' ? 'https://libretranslate.com' : 'https://api.openai.com/v1'}
              onChange={(event) => setTranslation({ endpoint: event.target.value })}
            />
          </label>
        ) : null}

        {translation.kind === 'openai' ? (
          <label className="field">
            <span className="label">{t('translate.model')}</span>
            <input
              className="input"
              value={translation.model}
              placeholder="gpt-4o-mini"
              onChange={(event) => setTranslation({ model: event.target.value })}
            />
          </label>
        ) : null}

        {translation.kind !== 'none' ? (
          <label className="field">
            <span className="label">{t('translate.keyPlaceholder')}</span>
            <input
              className="input"
              type="password"
              autoComplete="off"
              defaultValue=""
              placeholder={t('translate.keyPlaceholder')}
              onBlur={(event) => {
                const value = event.target.value.trim()
                if (value.length > 0) void setTranslationKey(value)
              }}
            />
          </label>
        ) : null}

        <div className="inline inline--wrap">
          <button type="button" className="btn btn--outline btn--small" onClick={() => void testTranslation()}>
            <Icon name="check" size="sm" />
            {t('translate.test')}
          </button>
          <button type="button" className="btn btn--ghost btn--small" onClick={() => clearTranslations()}>
            <Icon name="trash" size="sm" />
            {t('translate.clearCache')}
          </button>
        </div>

        {translationError ? <p className="small warn-text">{translationError}</p> : null}
      </section>

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
            <span className="row__title">{t('settings.realtime')}</span>
            <span className="row__hint">
              {t(`realtime.${realtime}` as 'realtime.live')}
              {realtimeDetail ? ` · ${realtimeDetail}` : ''}
              {lastPollAt ? ` · ${t('app.updated', { time: new Date(lastPollAt).toLocaleTimeString() })}` : ''}
            </span>
          </span>
          <span className="tag">Jetstream</span>
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
          {import.meta.env.DEV ? (
            <button type="button" className="btn btn--ghost btn--small" onClick={() => loadSample()}>
              <Icon name="sparkles" size="sm" />
              {t('settings.demoDev')}
            </button>
          ) : null}
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
        <span className="label">{t('sources.health')}</span>
        <p className="small muted">
          {t('realtime.hintOff')}
        </p>
        <div className="kindlist">
          {sources
            .filter((source) => source.enabled)
            .map((source) => (
              <span className="tag" key={source.kind}>
                {sourceLabel(source.kind)}
                <span className={source.lastOkAt ? 'delta' : 'faint'}>{source.lastOkAt ? 'ok' : '—'}</span>
              </span>
            ))}
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
          <span className="tag">v0.2.0</span>
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
