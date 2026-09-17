//! Archivo SQLite.
//!
//! El motor mantiene el estado vivo en memoria (rápido y fácil de probar) y la
//! aplicación guarda además una copia duradera en SQLite: publicaciones, temas y
//! su serie temporal. El esquema es el mismo que documenta
//! `packages/engine/src/store/schema.ts` y el índice FTS5 se mantiene solo, con
//! disparadores, así que cualquiera puede abrir el archivo con `sqlite3` y
//! buscar dentro sin pasar por Latido.

use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

/// Versión del esquema. Si sube, hay que añadir la migración correspondiente en
/// `packages/engine/src/store/schema.ts` **y** aquí.
const SCHEMA_VERSION: i64 = 1;

/// Mismas sentencias que el motor, en el mismo orden.
const SCHEMA_SQL: &str = include_str!("schema.sql");

pub struct Archive {
    path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchiveItem {
    pub id: String,
    pub source: String,
    pub url: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub lang: Option<String>,
    pub author_handle: String,
    #[serde(default)]
    pub author_name: Option<String>,
    pub published_at: i64,
    pub ingested_at: i64,
    #[serde(default)]
    pub likes: i64,
    #[serde(default)]
    pub replies: i64,
    #[serde(default)]
    pub reposts: i64,
    #[serde(default)]
    pub comments: i64,
    #[serde(default)]
    pub stars: i64,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub entities: Vec<String>,
    #[serde(default)]
    pub cluster_id: Option<String>,
    pub simhash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchiveTrend {
    pub id: String,
    pub title: String,
    pub state: String,
    pub score: i64,
    pub velocity: f64,
    pub growth: f64,
    pub volume: i64,
    pub coverage: i64,
    pub first_seen: i64,
    pub last_seen: i64,
    #[serde(default)]
    pub reason_code: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchivePayload {
    pub items: Vec<ArchiveItem>,
    pub trends: Vec<ArchiveTrend>,
    #[serde(default)]
    pub pruning_days: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ArchiveStats {
    pub posts: i64,
    pub trends: i64,
    pub clusters: i64,
    pub bytes: u64,
    pub path: String,
}

impl Archive {
    /// Abre (o crea) el archivo y deja el esquema aplicado.
    pub fn open(app: &AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
        let dir = app
            .path()
            .app_data_dir()
            .map_err(|error| format!("no se pudo resolver el directorio de datos: {error}"))?;
        fs::create_dir_all(&dir)?;
        let archive = Self {
            path: dir.join("latido.sqlite"),
        };
        let connection = archive.connection()?;
        connection.execute_batch(SCHEMA_SQL)?;
        connection.execute(
            "INSERT INTO meta (key, value) VALUES ('schema_version', ?1)
             ON CONFLICT (key) DO UPDATE SET value = excluded.value",
            [SCHEMA_VERSION.to_string()],
        )?;
        Ok(archive)
    }

    /// Una conexión por llamada: con WAL es barato y evita compartir estado
    /// mutable entre hilos.
    fn connection(&self) -> rusqlite::Result<Connection> {
        let connection = Connection::open(&self.path)?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        connection.pragma_update(None, "synchronous", "NORMAL")?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        Ok(connection)
    }

    pub fn sync(&self, payload: &ArchivePayload) -> rusqlite::Result<ArchiveStats> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;

        {
            let mut upsert_post = transaction.prepare(
                "INSERT INTO posts (
                    id, source, external_id, url, title, body, lang, author_id, author_handle,
                    author_name, published_at, ingested_at, likes, replies, reposts, comments,
                    stars, tags_json, entities_json, cluster_id, simhash, origin
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16,
                           ?17, ?18, ?19, ?20, ?21, 'archivo')
                 ON CONFLICT (id) DO UPDATE SET
                    title = excluded.title,
                    body = excluded.body,
                    likes = MAX(posts.likes, excluded.likes),
                    replies = MAX(posts.replies, excluded.replies),
                    reposts = MAX(posts.reposts, excluded.reposts),
                    comments = MAX(posts.comments, excluded.comments),
                    stars = MAX(posts.stars, excluded.stars),
                    cluster_id = excluded.cluster_id",
            )?;

            for item in &payload.items {
                let external_id = item.id.split_once(':').map(|(_, rest)| rest).unwrap_or(&item.id);
                upsert_post.execute(rusqlite::params![
                    item.id,
                    item.source,
                    external_id,
                    item.url,
                    item.title,
                    item.body,
                    item.lang,
                    format!("{}:{}", item.source, item.author_handle),
                    item.author_handle,
                    item.author_name,
                    item.published_at,
                    item.ingested_at,
                    item.likes,
                    item.replies,
                    item.reposts,
                    item.comments,
                    item.stars,
                    serde_json::to_string(&item.tags).unwrap_or_else(|_| "[]".into()),
                    serde_json::to_string(&item.entities).unwrap_or_else(|_| "[]".into()),
                    item.cluster_id,
                    item.simhash,
                ])?;
            }
        }

        {
            let mut upsert_cluster = transaction.prepare(
                "INSERT INTO clusters (id, keywords_json, entities_json, centroid, first_seen, last_seen)
                 VALUES (?1, '[]', '[]', '0000000000000000', ?2, ?3)
                 ON CONFLICT (id) DO UPDATE SET last_seen = MAX(clusters.last_seen, excluded.last_seen)",
            )?;
            let mut upsert_trend = transaction.prepare(
                "INSERT INTO trends (
                    id, title, state, score, velocity, growth, volume, coverage, engagement,
                    novelty, cohesion, first_seen, last_seen, reason_code, reason_json, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, 0, 0, ?9, ?10, ?11, '{}', ?12)
                 ON CONFLICT (id) DO UPDATE SET
                    title = excluded.title,
                    state = excluded.state,
                    score = excluded.score,
                    velocity = excluded.velocity,
                    growth = excluded.growth,
                    volume = excluded.volume,
                    coverage = excluded.coverage,
                    last_seen = excluded.last_seen,
                    reason_code = excluded.reason_code,
                    updated_at = excluded.updated_at",
            )?;
            let mut upsert_point = transaction.prepare(
                "INSERT INTO trend_points (trend_id, at, score, volume, velocity)
                 VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT (trend_id, at) DO UPDATE SET
                    score = excluded.score, volume = excluded.volume, velocity = excluded.velocity",
            )?;

            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|duration| duration.as_millis() as i64)
                .unwrap_or(0);

            for trend in &payload.trends {
                upsert_cluster.execute(rusqlite::params![trend.id, trend.first_seen, trend.last_seen])?;
                upsert_trend.execute(rusqlite::params![
                    trend.id,
                    trend.title,
                    trend.state,
                    trend.score,
                    trend.velocity,
                    trend.growth,
                    trend.volume,
                    trend.coverage,
                    trend.first_seen,
                    trend.last_seen,
                    trend.reason_code,
                    now,
                ])?;
                let bucket = now - (now % 60_000);
                upsert_point.execute(rusqlite::params![
                    trend.id,
                    bucket,
                    trend.score,
                    trend.volume,
                    trend.velocity,
                ])?;
            }
        }

        if let Some(days) = payload.pruning_days {
            if days > 0 {
                let cutoff = now_millis() - days * 86_400_000;
                transaction.execute("DELETE FROM posts WHERE published_at < ?1", [cutoff])?;
            }
        }

        transaction.commit()?;
        self.stats()
    }

    pub fn stats(&self) -> rusqlite::Result<ArchiveStats> {
        let connection = self.connection()?;
        let posts: i64 = connection.query_row("SELECT COUNT(*) FROM posts", [], |row| row.get(0))?;
        let trends: i64 = connection.query_row("SELECT COUNT(*) FROM trends", [], |row| row.get(0))?;
        let clusters: i64 = connection.query_row("SELECT COUNT(*) FROM clusters", [], |row| row.get(0))?;
        let bytes = fs::metadata(&self.path).map(|meta| meta.len()).unwrap_or(0);
        Ok(ArchiveStats {
            posts,
            trends,
            clusters,
            bytes,
            path: self.path.to_string_lossy().to_string(),
        })
    }

    /// Copia de seguridad consistente: `VACUUM INTO` deja un archivo íntegro en
    /// una sola operación de SQLite, sin copiar WAL a mano y sin depender de la
    /// API de respaldo, que cambia de forma entre versiones de `rusqlite`.
    pub fn export(&self, destination: &Path) -> rusqlite::Result<String> {
        let connection = self.connection()?;
        if let Some(parent) = destination.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if destination.exists() {
            fs::remove_file(destination).ok();
        }
        let target = destination.to_string_lossy().to_string();
        connection.execute("VACUUM INTO ?1", [target])?;
        Ok(destination.to_string_lossy().to_string())
    }
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

#[tauri::command]
pub fn archive_sync(
    archive: tauri::State<'_, Archive>,
    payload: ArchivePayload,
) -> Result<ArchiveStats, String> {
    archive.sync(&payload).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn archive_stats(archive: tauri::State<'_, Archive>) -> Result<ArchiveStats, String> {
    archive.stats().map_err(|error| error.to_string())
}

/// Exporta el archivo a la carpeta de descargas del usuario.
#[tauri::command]
pub fn archive_export(
    app: AppHandle,
    archive: tauri::State<'_, Archive>,
) -> Result<String, String> {
    let directory = app
        .path()
        .download_dir()
        .or_else(|_| app.path().app_data_dir())
        .map_err(|error| error.to_string())?;
    let stamp = now_millis() / 1000;
    let destination = directory.join(format!("latido-archivo-{stamp}.sqlite"));
    archive
        .export(&destination)
        .map_err(|error| error.to_string())
}
