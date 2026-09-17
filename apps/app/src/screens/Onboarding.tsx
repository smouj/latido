import { useState } from 'react'

import { Icon, BrandMark } from '@/components/Icon'
import { useLatido } from '@/state/store'
import { CONNECTORS } from '@latido/engine'
import { sourceLabel } from '@/components/primitives'

const INTERESTS = [
  { slug: 'ai', query: 'inteligencia artificial' },
  { slug: 'opensource', query: 'open source' },
  { slug: 'dev', query: 'desarrollo' },
  { slug: 'gaming', query: 'videojuegos' },
  { slug: 'world', query: 'mundo' },
  { slug: 'spain', query: 'españa' },
  { slug: 'security', query: 'seguridad' },
  { slug: 'hardware', query: 'hardware' },
] as const

const STARTER_SOURCES = ['hackernews', 'bluesky', 'github', 'reddit'] as const

/**
 * Primera vez. Tres decisiones y a escuchar: de dónde, qué te interesa y
 * cuándo avisarte. Se puede saltar y mirar con datos de ejemplo.
 */
export function Onboarding(): JSX.Element {
  const { t, completeOnboarding, toggleSource, sources, rules } = useLatido()
  const [interests, setInterests] = useState<string[]>(['ai', 'opensource'])

  const enabled = new Set(sources.filter((source) => source.enabled).map((source) => source.kind))
  const hasRules = rules.some((rule) => rule.enabled)

  return (
    <div className="onboarding">
      <div className="onboarding__panel">
        <div className="inline">
          <span className="brand__mark">
            <BrandMark />
          </span>
          <span>
            <span className="display" style={{ fontSize: 'var(--text-2xl)', display: 'block' }}>
              latido
            </span>
            <span className="micro faint">{t('app.tagline')}</span>
          </span>
        </div>

        <div className="stack stack--tight">
          <h1 className="heading">{t('onboarding.title')}</h1>
          <p className="body muted">{t('onboarding.lead')}</p>
        </div>

        <div className="onboarding__steps">
          <section className="step">
            <div className="step__head">
              <span className="step__index">1</span>
              <span className="step__title">{t('onboarding.step1')}</span>
            </div>
            <div className="choice-grid">
              {STARTER_SOURCES.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  className="choice"
                  aria-pressed={enabled.has(kind)}
                  onClick={() => toggleSource(kind, !enabled.has(kind))}
                >
                  <span className="inline">
                    <span className="chip__dot" style={{ background: `var(--source-${kind})` }} />
                    {sourceLabel(kind)}
                  </span>
                  <Icon name="check" size="sm" className="choice__check" />
                </button>
              ))}
              {CONNECTORS.rss ? (
                <span className="choice" aria-hidden="true" style={{ opacity: 0.6 }}>
                  <span className="inline">
                    <span className="chip__dot" style={{ background: 'var(--source-rss)' }} />
                    {t('sources.addFeed')}
                  </span>
                  <span className="micro faint">→ {t('nav.sources')}</span>
                </span>
              ) : null}
            </div>
          </section>

          <section className="step">
            <div className="step__head">
              <span className="step__index">2</span>
              <span className="step__title">{t('onboarding.step2')}</span>
            </div>
            <div className="choice-grid">
              {INTERESTS.map((entry) => (
                <button
                  key={entry.slug}
                  type="button"
                  className="choice"
                  aria-pressed={interests.includes(entry.slug)}
                  onClick={() =>
                    setInterests(
                      interests.includes(entry.slug)
                        ? interests.filter((slug) => slug !== entry.slug)
                        : [...interests, entry.slug],
                    )
                  }
                >
                  <span>{t(`interests.${entry.slug}` as 'interests.ai')}</span>
                  <Icon name="check" size="sm" className="choice__check" />
                </button>
              ))}
            </div>
          </section>

          <section className="step">
            <div className="step__head">
              <span className="step__index">3</span>
              <span className="step__title">{t('onboarding.step3')}</span>
            </div>
            <p className="small muted">
              {hasRules
                ? `${rules.filter((rule) => rule.enabled).length} ${t('alerts.rules').toLowerCase()}`
                : t('alerts.emptyHint')}
            </p>
            <div className="kindlist">
              {rules.slice(0, 4).map((rule) => (
                <span className="tag" key={rule.id}>
                  {t(`alerts.kind.${rule.kind}` as 'alerts.kind.topic_surge')}
                </span>
              ))}
            </div>
          </section>
        </div>

        <div className="stack stack--tight">
          <button
            type="button"
            className="btn btn--primary btn--block"
            onClick={() =>
              completeOnboarding(INTERESTS.filter((entry) => interests.includes(entry.slug)).map((entry) => entry.query))
            }
          >
            <Icon name="activity" size="sm" />
            {t('onboarding.start')}
          </button>
          <span className="micro faint inline">
            <Icon name="shield" size="sm" />
            {t('onboarding.localOnly')}
          </span>
          <span className="micro faint inline">
            <Icon name="radio" size="sm" />
            {t('app.firstRunHint')}
          </span>
        </div>
      </div>
    </div>
  )
}
