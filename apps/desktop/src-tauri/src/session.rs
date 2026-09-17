//! Sesión del navegador: reutilizar la sesión que el usuario ya tiene abierta.
//!
//! El caso real: Reddit responde 403 a quien no lleva sesión. La aplicación no
//! pide una cuenta nueva ni se inventa datos: lee las cookies que el navegador ya
//! tiene guardadas, monta **una sola cabecera `Cookie`** para los dominios de esa
//! fuente y la guarda en el llavero del sistema.
//!
//! Reglas que se respetan a rajatabla:
//!  - Se guarda en el llavero **solo la cabecera ya montada**: no la base de
//!    datos entera, ni cookies de dominios que no hagan falta.
//!  - La base de datos del navegador se abre **en solo lectura**. No se copia, no
//!    se modifica, no se sube a ningún sitio.
//!  - Si algo falla (base bloqueada, clave de otro perfil, esquema `v20`), se
//!    devuelve un error en español y **no se inventa ningún dato**.
//!
//! El algoritmo de descifrado vive en el crate `latido-chrome-session`, que es
//! lógica pura y está cubierto por pruebas. Aquí solo queda el acceso al sistema:
//! rutas de Windows, SQLite y llavero.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use keyring::Entry;
use latido_chrome_session::{
    cookie_header, encrypted_key_from_local_state, key_from_encrypted, resolve_row, CookieRow,
    SessionError,
};
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};

const SERVICE: &str = "app.latido.desktop";
/// Prefijo de los secretos que guardan una sesión importada.
const KEY_PREFIX: &str = "session.cookie.";

/// Navegadores de la familia Chromium que sabemos leer. El orden es el orden en
/// que se enseñan en Ajustes.
const BROWSERS: &[(&str, &str, &str)] = &[
    ("chrome", "Google Chrome", "Google\\Chrome\\User Data"),
    ("edge", "Microsoft Edge", "Microsoft\\Edge\\User Data"),
    ("brave", "Brave", "BraveSoftware\\Brave-Browser\\User Data"),
    ("chromium", "Chromium", "Chromium\\User Data"),
    ("vivaldi", "Vivaldi", "Vivaldi\\User Data"),
];

/// Un perfil de navegador con sesión guardada.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserProfile {
    pub kind: String,
    pub label: String,
    pub profile: String,
    /// Ruta de la base de datos de cookies (solo lectura).
    pub cookies_db: String,
    pub local_state: String,
    /// `true` si la base de datos está accesible en este momento.
    pub available: bool,
    /// Si no está accesible, por qué (en español).
    pub detail: Option<String>,
}

/// Lo que se enseña de una sesión importada: **sin** la cabecera.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub domains: Vec<String>,
    pub names: Vec<String>,
    pub browser: String,
    pub profile: String,
    pub imported_at: u64,
}

/// Lo que se guarda en el llavero: la cabecera montada y su procedencia.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionRecord {
    header: String,
    domains: Vec<String>,
    names: Vec<String>,
    browser: String,
    profile: String,
    imported_at: u64,
}

impl From<SessionRecord> for SessionSummary {
    fn from(record: SessionRecord) -> Self {
        SessionSummary {
            domains: record.domains,
            names: record.names,
            browser: record.browser,
            profile: record.profile,
            imported_at: record.imported_at,
        }
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

fn entry(key: &str) -> Result<Entry, String> {
    let name = format!("{KEY_PREFIX}{key}");
    Entry::new(SERVICE, &name).map_err(|error| format!("llavero no disponible: {error}"))
}

fn user_data_dir(kind: &str) -> Result<PathBuf, String> {
    let (_, label, relative) = BROWSERS
        .iter()
        .find(|(candidate, _, _)| *candidate == kind)
        .ok_or_else(|| format!("navegador desconocido: {kind}"))?;
    let base = std::env::var("LOCALAPPDATA")
        .map_err(|_| format!("{label}: este sistema no expone LOCALAPPDATA (solo Windows)"))?;
    Ok(Path::new(&base).join(relative))
}

/// Perfiles de un navegador: los que tienen base de datos de cookies.
///
/// Se busca en disco en lugar de fiarse de `Local State` porque un perfil puede
/// existir sin estar anunciado, y al revés.
fn profiles_of(user_data: &Path) -> Vec<String> {
    let mut found = Vec::new();
    let Ok(entries) = fs::read_dir(user_data) else {
        return found;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let has_cookies = path.join("Network").join("Cookies").exists() || path.join("Cookies").exists();
        if !has_cookies {
            continue;
        }
        if let Some(name) = path.file_name().and_then(|name| name.to_str()) {
            found.push(name.to_string());
        }
    }
    found.sort_by(|left, right| {
        // `Default` primero; luego `Profile 1`, `Profile 2`… y el resto alfabético.
        let weight = |name: &str| match name {
            "Default" => 0,
            other => other
                .strip_prefix("Profile ")
                .and_then(|rest| rest.parse::<u32>().ok())
                .map(|number| number + 1)
                .unwrap_or(1000),
        };
        weight(left).cmp(&weight(right)).then_with(|| left.cmp(right))
    });
    found
}

fn cookies_db_of(user_data: &Path, profile: &str) -> PathBuf {
    let profile_dir = user_data.join(profile);
    let modern = profile_dir.join("Network").join("Cookies");
    if modern.exists() {
        return modern;
    }
    profile_dir.join("Cookies")
}

/// Lista los navegadores y perfiles que se pueden leer en este equipo.
#[tauri::command]
pub fn session_browsers() -> Result<Vec<BrowserProfile>, String> {
    let mut result = Vec::new();
    for (kind, label, _) in BROWSERS {
        let Ok(user_data) = user_data_dir(kind) else {
            continue;
        };
        if !user_data.exists() {
            continue;
        }
        for profile in profiles_of(&user_data) {
            let cookies_db = cookies_db_of(&user_data, &profile);
            let available = cookies_db.exists();
            let detail = if available {
                None
            } else {
                Some("no encuentro la base de datos de cookies de este perfil".to_string())
            };
            result.push(BrowserProfile {
                kind: (*kind).to_string(),
                label: (*label).to_string(),
                profile,
                cookies_db: cookies_db.to_string_lossy().to_string(),
                local_state: user_data.join("Local State").to_string_lossy().to_string(),
                available,
                detail,
            });
        }
    }
    Ok(result)
}

/// Abre la base de datos de cookies en solo lectura.
///
/// El navegador en marcha la mantiene bloqueada: cuando pasa, se dice tal cual,
/// porque el usuario tiene la solución a mano (cerrarlo y volver a intentarlo).
fn open_cookies(path: &Path) -> Result<Connection, String> {
    if !path.exists() {
        return Err(format!(
            "no existe la base de datos de cookies en {}",
            path.display()
        ));
    }
    Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|error| describe_locked(error.to_string(), path))
}

fn describe_locked(message: String, path: &Path) -> String {
    let lower = message.to_lowercase();
    let locked = lower.contains("locked")
        || lower.contains("utilizado")
        || lower.contains("being used")
        || lower.contains("sharing violation")
        || lower.contains("denied");
    if locked {
        format!(
            "el navegador tiene la base de datos de cookies abierta ({}). Ciérralo y vuelve a intentarlo.",
            path.display()
        )
    } else {
        format!("no he podido abrir la base de datos de cookies: {message}")
    }
}

fn read_key(local_state: &Path) -> Result<latido_chrome_session::SessionKey, SessionError> {
    let json = fs::read_to_string(local_state).map_err(|error| {
        SessionError::MissingKey(format!("no puedo leer `Local State` ({error})"))
    })?;
    let encrypted = encrypted_key_from_local_state(&json)?;
    key_from_encrypted(&encrypted, latido_chrome_session::dpapi_unprotect)
}

/// Importa la sesión de un perfil para un conjunto de dominios.
///
/// Devuelve solo el resumen; la cabecera `Cookie` se queda en el llavero y se lee
/// aparte, con `secret_get`, justo cuando hay que hacer la petición.
#[tauri::command]
pub fn session_import(
    browser: String,
    profile: String,
    key: String,
    domains: Vec<String>,
) -> Result<SessionSummary, String> {
    let domains: Vec<String> = domains
        .into_iter()
        .map(|domain| domain.trim().to_lowercase())
        .filter(|domain| !domain.is_empty())
        .collect();
    if domains.is_empty() {
        return Err("no se ha indicado ningún dominio que importar".to_string());
    }

    let user_data = user_data_dir(&browser)?;
    let cookies_db = cookies_db_of(&user_data, &profile);
    let connection = open_cookies(&cookies_db)?;

    let session_key = read_key(&user_data.join("Local State")).map_err(|error| error.to_string())?;

    let mut statement = connection
        .prepare(
            "SELECT host_key, name, path, value, encrypted_value, expires_utc, has_expires, is_secure, is_httponly \
             FROM cookies",
        )
        .map_err(|error| format!("no he podido leer la tabla de cookies: {error}"))?;

    let rows = statement
        .query_map([], |row| {
            let encrypted: Vec<u8> = row.get::<_, Option<Vec<u8>>>(4)?.unwrap_or_default();
            let plain: Option<String> = row.get::<_, Option<String>>(3)?;
            Ok(CookieRow {
                host_key: row.get::<_, Option<String>>(0)?.unwrap_or_default(),
                name: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                path: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                value_plain: plain.filter(|value| !value.is_empty()),
                value_encrypted: encrypted,
                expires_utc: row.get::<_, Option<i64>>(5)?.unwrap_or(0),
                has_expires: row.get::<_, Option<i64>>(6)?.unwrap_or(1) != 0,
                is_secure: row.get::<_, Option<i64>>(7)?.unwrap_or(1) != 0,
                is_httponly: row.get::<_, Option<i64>>(8)?.unwrap_or(0) != 0,
            })
        })
        .map_err(|error| format!("no he podido leer la tabla de cookies: {error}"))?;

    let hosts: Vec<&str> = domains.iter().map(String::as_str).collect();
    let mut usable: Vec<CookieRow> = Vec::new();
    let mut undecryptable = 0usize;
    let mut unsupported: Option<String> = None;

    for row in rows {
        let mut row = row.map_err(|error| format!("fila de cookie ilegible: {error}"))?;
        if !domains
            .iter()
            .any(|domain| latido_chrome_session::host_matches(&row.host_key, domain))
        {
            continue;
        }
        match resolve_row(&mut row, &session_key) {
            Ok(()) => usable.push(row),
            Err(SessionError::UnsupportedValue(detail)) => {
                unsupported.get_or_insert(detail);
            }
            Err(_) => undecryptable += 1,
        }
    }

    if usable.is_empty() {
        let mut detail = format!("el perfil `{profile}` no tiene cookies para {}", domains.join(", "));
        if undecryptable > 0 {
            detail.push_str(&format!("; {undecryptable} no se han podido descifrar"));
        }
        if let Some(reason) = unsupported {
            detail.push_str(&format!("; {reason}"));
        }
        return Err(SessionError::NoCookies(detail).to_string());
    }

    let header = cookie_header(&usable, &hosts, now_ms() as i64).map_err(|error| error.to_string())?;
    let mut names: Vec<String> = usable.iter().map(|row| row.name.clone()).collect();
    names.sort();
    names.dedup();

    let record = SessionRecord {
        header,
        domains: domains.clone(),
        names,
        browser: browser.clone(),
        profile: profile.clone(),
        imported_at: now_ms(),
    };
    let serialized = serde_json::to_string(&record)
        .map_err(|error| format!("no he podido preparar la sesión: {error}"))?;
    entry(&key)?
        .set_password(&serialized)
        .map_err(|error| format!("no he podido guardar la sesión en el llavero: {error}"))?;

    Ok(record.into())
}

/// Resumen de la sesión guardada, sin la cabecera: para pintar Ajustes.
#[tauri::command]
pub fn session_peek(key: String) -> Result<Option<SessionSummary>, String> {
    let entry = entry(&key)?;
    match entry.get_password() {
        Ok(serialized) => match serde_json::from_str::<SessionRecord>(&serialized) {
            Ok(record) => Ok(Some(record.into())),
            Err(_) => Ok(None),
        },
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(format!("no he podido leer la sesión del llavero: {error}")),
    }
}

/// Olvida la sesión importada de una fuente.
#[tauri::command]
pub fn session_forget(key: String) -> Result<(), String> {
    match entry(&key)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!("no he podido borrar la sesión del llavero: {error}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn los_perfiles_ordenan_default_primero() {
        let mut names = vec![
            "Profile 2".to_string(),
            "System Profile".to_string(),
            "Default".to_string(),
            "Profile 1".to_string(),
            "Guest Profile".to_string(),
        ];
        names.sort_by(|left, right| {
            let weight = |name: &str| match name {
                "Default" => 0,
                other => other
                    .strip_prefix("Profile ")
                    .and_then(|rest| rest.parse::<u32>().ok())
                    .map(|number| number + 1)
                    .unwrap_or(1000),
            };
            weight(left).cmp(&weight(right)).then_with(|| left.cmp(right))
        });
        assert_eq!(
            names,
            vec!["Default", "Profile 1", "Profile 2", "Guest Profile", "System Profile"]
        );
    }

    #[test]
    fn una_base_bloqueada_se_explica_en_espanol() {
        let message = describe_locked(
            "unable to open database file: El proceso no puede obtener acceso al archivo porque está siendo utilizado en otro proceso. (os error 32)".to_string(),
            Path::new("C:\\Cookies"),
        );
        assert!(message.contains("Ciérralo"));
        assert!(message.contains("cookies"));
    }

    fn _compile_time_check() {
        // El navegador desconocido no revienta: devuelve un error explicado.
        let _: Result<PathBuf, String> = user_data_dir("navegador-inventado");
    }
}
