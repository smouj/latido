/**
 * @latido/engine — superficie pública.
 *
 * Los tests y la app importan solo desde aquí. Si algo no está exportado, no es
 * parte del contrato.
 */
export * from './types'
export {
  STOPWORDS,
  fnv1a64,
  hammingDistance,
  jaccard,
  normalizeText,
  simhash,
  simhashSimilarity,
  slugify,
  titleFromKeywords,
  tokenize,
  topKeywords,
} from './text'
export { ENTITY_SEED, canonicalUrl, detectLanguage, extractEntities, normalizeItem, type RawItem } from './normalize'
export { Clusterer, type ClusterOptions } from './cluster'
export {
  TrendEngine,
  bucketize,
  cohesionOf,
  computeTrend,
  engagementOf,
  sourceBreakdown,
  type TrendInput,
  type TrendOptions,
} from './trend'
export { DEFAULT_RULES, createRule, evaluateAlerts, pruneFired } from './alerts'
export {
  MemoryStore,
  SNAPSHOT_VERSION,
  createSessionState,
  type ItemQuery,
  type StoreSnapshot,
  type StoreStats,
  type TrendPoint,
} from './store'
export { MIGRATIONS, SCHEMA_SQL, SCHEMA_VERSION } from './store/schema'
// `normalize` ya exporta un `detectLanguage` (devuelve 'und' cuando duda), así
// que el detector del motor de traducción —más estricto, devuelve null— se
// publica con nombre propio para no romper el contrato existente.
export {
  TranslationQueue,
  createTranslator,
  detectLanguage as detectSourceLanguage,
  type QueueOptions,
  type TranslateConfig,
  type TranslateContext,
  type TranslateProviderKind,
  type Translator,
} from './translate'
export { LatidoEngine, type EngineOptions } from './engine'
export {
  CONNECTORS,
  BlueskyStream,
  DEMO_STORIES,
  RateLimiter,
  USER_AGENT,
  defaultSourceConfigs,
  demoRawItems,
  mapWithConcurrency,
  parseFeed,
  seededRandom,
  stripHtml,
  type Connector,
  type FetchContext,
} from './sources'
