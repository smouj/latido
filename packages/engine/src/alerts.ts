/**
 * Reglas de aviso.
 *
 * El usuario decide qué merece interrumpirle. Las alertas se evalúan contra
 * tendencias (no contra items sueltos), así que "avísame si algo crece ×3"
 * significa algo: se refiere a un tema con al menos N publicaciones.
 */
import type { AlertEvent, AlertRule, Item, Trend } from './types'

export interface AlertEvaluation {
  events: AlertEvent[]
  /** Estado de enfriamiento, para persistir entre ciclos. */
  fired: Map<string, number>
}

export const DEFAULT_RULES: Omit<AlertRule, 'id' | 'createdAt'>[] = [
  { kind: 'multi_source', enabled: true, minSources: 3, minGrowth: 2.5, cooldownMs: 45 * 60 * 1000 },
  { kind: 'global_breaking', enabled: true, minSources: 4, minGrowth: 4, cooldownMs: 30 * 60 * 1000 },
  { kind: 'project_velocity', enabled: false, minGrowth: 0.8, cooldownMs: 6 * 60 * 60 * 1000 },
]

export function createRule(rule: Omit<AlertRule, 'createdAt'> & { createdAt?: number }): AlertRule {
  return { createdAt: Date.now(), ...rule }
}

function matchesQuery(trend: Trend, items: Item[], query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) return true
  const inTrend =
    trend.title.toLowerCase().includes(needle) ||
    trend.keywords.some((keyword) => keyword.includes(needle)) ||
    trend.entities.some((entity) => entity.includes(needle))
  if (inTrend) return true
  return items.some(
    (item) =>
      (item.title ?? '').toLowerCase().includes(needle) ||
      (item.body ?? '').toLowerCase().includes(needle) ||
      item.tags.some((tag) => tag.includes(needle)),
  )
}

/**
 * Evalúa todas las reglas activas contra el conjunto de tendencias del ciclo.
 * `fired` se pasa y se devuelve: la app lo persiste para sobrevivir reinicios.
 */
export function evaluateAlerts(input: {
  rules: AlertRule[]
  trends: Trend[]
  itemsByCluster: Map<string, Item[]>
  now: number
  fired?: Map<string, number>
}): AlertEvaluation {
  const { rules, trends, itemsByCluster, now } = input
  const fired = new Map(input.fired ?? [])
  const events: AlertEvent[] = []

  for (const rule of rules) {
    if (!rule.enabled) continue
    const cooldown = rule.cooldownMs ?? 30 * 60 * 1000
    const minGrowth = rule.minGrowth ?? 1

    for (const trend of trends) {
      if (trend.growth < minGrowth) continue
      if (trend.coverage < (rule.minSources ?? 1)) continue
      if (rule.sources && rule.sources.length > 0) {
        const sources = new Set(trend.sources.map((entry) => entry.source))
        if (![...sources].some((source) => rule.sources?.includes(source))) continue
      }

      const items = itemsByCluster.get(trend.id) ?? []

      switch (rule.kind) {
        case 'multi_source':
          if (trend.coverage < (rule.minSources ?? 3)) continue
          break
        case 'global_breaking':
          if (trend.state !== 'breaking' && trend.state !== 'emerging') continue
          break
        case 'topic_surge':
          if (trend.state === 'quiet') continue
          break
        case 'watched_entity':
          if (!rule.query || !trend.entities.includes(rule.query.trim().toLowerCase())) continue
          break
        case 'keyword':
          if (!rule.query || !matchesQuery(trend, items, rule.query)) continue
          break
        case 'project_velocity':
          if (trend.volume < 5) continue
          break
      }

      const key = `${rule.id}::${trend.id}`
      const last = fired.get(key) ?? 0
      if (now - last < cooldown) continue

      fired.set(key, now)
      events.push({
        id: `alert:${key}:${now}`,
        ruleId: rule.id,
        kind: rule.kind,
        trendId: trend.id,
        title: trend.title,
        reason: trend.reason,
        createdAt: now,
        read: false,
        snapshot: {
          score: trend.score,
          velocity: trend.velocity,
          growth: trend.growth,
          coverage: trend.coverage,
          volume: trend.volume,
          sources: trend.sources,
        },
      })
    }
  }

  return { events, fired }
}

/** Descarta el estado de reglas que ya no existen. Mantiene el mapa pequeño. */
export function pruneFired(fired: Map<string, number>, now: number, maxAgeMs = 24 * 60 * 60 * 1000): Map<string, number> {
  const next = new Map<string, number>()
  for (const [key, at] of fired) if (now - at <= maxAgeMs) next.set(key, at)
  return next
}
