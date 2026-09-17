//! Sesión del navegador para Latido.
//!
//! El problema que resuelve: Reddit y la búsqueda de Bluesky responden 403 a una
//! petición anónima. El usuario ya tiene sesión abierta en su navegador, así que
//! la aplicación puede reutilizarla en lugar de pedir una cuenta nueva.
//!
//! Cómo está cifrado (familia Chromium en Windows, que es lo que hacemos aquí):
//!
//! 1. Los valores de la tabla `cookies` empiezan por `v10` y van cifrados con
//!    **AES-256-GCM**: `v10` + nonce de 12 bytes + texto cifrado + etiqueta.
//! 2. La clave de 32 bytes está en `Local State`, en `os_crypt.encrypted_key`,
//!    en base64 y precedida por la marca `DPAPI`.
//! 3. Esa clave, a su vez, está cifrada con **DPAPI** del usuario de Windows
//!    (`CryptUnprotectData`). Solo el usuario que abrió el navegador puede
//!    descifrarla: si falla, no hay forma de inventarse el dato y la aplicación
//!    lo dice en vez de rellenar el hueco.
//!
//! Este módulo es deliberadamente puro: no llama al sistema operativo. DPAPI se
//! inyecta como función (`unprotect`), lo que permite probar todo el camino
//! —descifrado incluido— en cualquier plataforma, y deja el código específico de
//! Windows reducido a una llamada.
//!
//! Nota sobre `hkdf`: no aparece porque el esquema `v10` **no** deriva la clave
//! con HKDF; la clave es directamente el resultado de DPAPI. Añadirlo sería
//! decoración, no criptografía.

use std::fmt;

mod dpapi;

pub use dpapi::dpapi_unprotect;

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Marca que Chrome antepone a la clave cifrada de `Local State`.
pub const DPAPI_PREFIX: &str = "DPAPI";
/// Prefijo de los valores cifrados con la clave derivada de `Local State`.
pub const V10_PREFIX: &[u8] = b"v10";
/// Prefijo nuevo (Chrome 127 y posteriores) que exige la identidad de la app.
pub const V20_PREFIX: &[u8] = b"v20";

/// Diferencia entre el epoch de Windows/WebKit (1601) y el de Unix, en ms.
const WINDOWS_EPOCH_OFFSET_MS: i64 = 11_644_473_600_000;
/// Tamaño máximo de la cabecera `Cookie` que aceptamos construir.
const MAX_HEADER_BYTES: usize = 8_192;

/// Fallo al leer la sesión. Siempre con mensaje en español y sin datos inventados.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionError {
    /// `Local State` no tiene la clave, o no es lo que esperábamos.
    MissingKey(String),
    /// DPAPI no pudo descifrar la clave (otro usuario, otro equipo, perfil corrupto).
    Dpapi(String),
    /// El valor de la cookie no está en un formato que sepamos descifrar.
    UnsupportedValue(String),
    /// El texto cifrado no cuadra con la clave: clave equivocada o dato dañado.
    Undecryptable(String),
    /// No hay ninguna cookie utilizable para esos dominios.
    NoCookies(String),
}

impl fmt::Display for SessionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            SessionError::MissingKey(detail) => format!(
                "no encuentro la clave de cifrado del navegador: {detail}. Comprueba que has elegido un perfil que exista."
            ),
            SessionError::Dpapi(detail) => format!(
                "Windows no ha podido descifrar la clave del navegador con DPAPI: {detail}. Suele pasar si el perfil es de otro usuario de Windows o de otro equipo; no se inventa ningún dato."
            ),
            SessionError::UnsupportedValue(detail) => format!("no puedo leer esta cookie: {detail}"),
            SessionError::Undecryptable(detail) => format!(
                "la clave del navegador no descifra estas cookies: {detail}. No se inventa ningún dato."
            ),
            SessionError::NoCookies(detail) => format!("no hay cookies utilizables: {detail}"),
        };
        write!(formatter, "{message}")
    }
}

impl std::error::Error for SessionError {}

/// Una fila de la tabla `cookies` de Chromium, ya leída de SQLite.
///
/// `value_encrypted` es el contenido de `encrypted_value`; `value_plain` es el de
/// `value`, que en instalaciones antiguas guardaba el texto sin cifrar.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CookieRow {
    pub host_key: String,
    pub name: String,
    pub path: String,
    pub value_plain: Option<String>,
    pub value_encrypted: Vec<u8>,
    /// Microsegundos desde 1601 (epoch de WebKit). `0` = cookie de sesión.
    pub expires_utc: i64,
    /// `false` = cookie de sesión: vale mientras viva el navegador.
    pub has_expires: bool,
    pub is_secure: bool,
    pub is_httponly: bool,
}

/// Clave de 32 bytes que Chromium usa como clave AES-256-GCM.
pub type SessionKey = [u8; 32];

/// Forma mínima de `Local State` que nos interesa.
#[derive(Debug, Deserialize)]
struct LocalState {
    os_crypt: Option<OsCrypt>,
}

#[derive(Debug, Deserialize)]
struct OsCrypt {
    encrypted_key: Option<String>,
}

/// Extrae de `Local State` la clave cifrada con DPAPI, ya sin la marca `DPAPI`.
///
/// Devuelve los bytes tal cual están en el archivo: descifrarlos es cosa de
/// `key_from_encrypted`, que recibe la función de DPAPI.
pub fn encrypted_key_from_local_state(local_state_json: &str) -> Result<Vec<u8>, SessionError> {
    let parsed: LocalState = serde_json::from_str(local_state_json)
        .map_err(|error| SessionError::MissingKey(format!("`Local State` no es JSON válido ({error})")))?;
    let encoded = parsed
        .os_crypt
        .and_then(|crypt| crypt.encrypted_key)
        .ok_or_else(|| SessionError::MissingKey("`Local State` no trae `os_crypt.encrypted_key`".to_string()))?;

    let decoded = base64::engine::general_purpose::STANDARD
        .decode(encoded.trim())
        .map_err(|error| SessionError::MissingKey(format!("la clave no es base64 válido ({error})")))?;

    let stripped = decoded
        .strip_prefix(DPAPI_PREFIX.as_bytes())
        .ok_or_else(|| SessionError::MissingKey(format!("la clave no empieza por `{DPAPI_PREFIX}`")))?;

    if stripped.is_empty() {
        return Err(SessionError::MissingKey("la clave está vacía".to_string()));
    }
    Ok(stripped.to_vec())
}

/// Descifra con DPAPI la clave y comprueba que mida los 32 bytes de AES-256.
///
/// `unprotect` es la primitiva del sistema (`CryptUnprotectData` en Windows). En
/// las pruebas se inyecta una función de mentira, que es justo lo que permite
/// comprobar todo el camino sin depender del sistema operativo.
pub fn key_from_encrypted(
    encrypted_key: &[u8],
    unprotect: impl FnOnce(&[u8]) -> Result<Vec<u8>, String>,
) -> Result<SessionKey, SessionError> {
    if encrypted_key.is_empty() {
        return Err(SessionError::MissingKey("la clave cifrada está vacía".to_string()));
    }
    let plain = unprotect(encrypted_key).map_err(SessionError::Dpapi)?;
    if plain.len() != 32 {
        return Err(SessionError::MissingKey(format!(
            "la clave descifrada mide {} bytes y debería medir 32",
            plain.len()
        )));
    }
    let mut key: SessionKey = [0u8; 32];
    key.copy_from_slice(&plain);
    Ok(key)
}

/// Descifra el valor de una cookie.
///
/// Acepta los dos caminos que existen de verdad:
///  - `v10`: AES-256-GCM con la clave de `Local State`. Las versiones antiguas
///    anteponían al texto un resumen SHA-256 del dominio, así que se recorta si
///    está.
///  - texto plano: instalaciones antiguas guardaban `value` sin cifrar.
///
/// `v20` (Chrome 127+) se rechaza con un mensaje claro: exige la identidad de la
/// aplicación ante el servicio elevado de Windows y no se puede leer desde aquí.
pub fn decrypt_cookie_value(
    encrypted: &[u8],
    plain: Option<&str>,
    host_key: &str,
    key: &SessionKey,
) -> Result<String, SessionError> {
    if encrypted.is_empty() {
        return Ok(plain.unwrap_or_default().to_string());
    }

    if encrypted.starts_with(V20_PREFIX) {
        return Err(SessionError::UnsupportedValue(
            "está cifrada con el esquema `v20` (Chrome 127 o posterior), que exige la identidad de la propia aplicación. \
             Cierra Chrome, ábrelo sin iniciar sesión o usa un perfil donde la sesión se guarde con `v10`."
                .to_string(),
        ));
    }

    if !encrypted.starts_with(V10_PREFIX) {
        // Sin prefijo reconocible: puede ser texto plano guardado en `encrypted_value`.
        if let Ok(text) = std::str::from_utf8(encrypted) {
            if !text.is_empty() && text.chars().all(|character| !character.is_control()) {
                return Ok(text.to_string());
            }
        }
        return Err(SessionError::UnsupportedValue(
            "no empieza por `v10` ni es texto legible".to_string(),
        ));
    }

    let payload = &encrypted[V10_PREFIX.len()..];
    if payload.len() < 12 + 16 {
        return Err(SessionError::Undecryptable("el valor es demasiado corto".to_string()));
    }
    let (nonce, ciphertext) = payload.split_at(12);

    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|error| SessionError::Undecryptable(format!("clave AES no válida ({error})")))?;
    let mut decrypted = cipher
        .decrypt(Nonce::from_slice(nonce), ciphertext)
        .map_err(|_| {
            SessionError::Undecryptable(
                "el descifrado AES-256-GCM ha fallado (clave de otro perfil o valor dañado)".to_string(),
            )
        })?;

    // Prefijo histórico con el resumen del dominio: se quita si está.
    if decrypted.len() > 32 {
        let digest = Sha256::digest(host_key.as_bytes());
        if decrypted[..32] == digest[..] {
            decrypted.drain(..32);
        }
    }

    String::from_utf8(decrypted)
        .map_err(|error| SessionError::Undecryptable(format!("el texto no es UTF-8 válido ({error})")))
}

/// Convierte el vencimiento de Chromium (µs desde 1601) a milisegundos Unix.
pub fn chrome_expiry_to_unix_ms(expires_utc: i64) -> i64 {
    if expires_utc <= 0 {
        return 0;
    }
    expires_utc / 1000 - WINDOWS_EPOCH_OFFSET_MS
}

/// ¿Sirve esta cookie para `host`?
///
/// Regla de RFC 6265: `host_key` con punto inicial cubre el dominio y sus
/// subdominios; sin punto, solo el nombre exacto.
pub fn host_matches(host_key: &str, host: &str) -> bool {
    let host = host.trim().trim_end_matches('.').to_ascii_lowercase();
    let host_key = host_key.trim().trim_end_matches('.').to_ascii_lowercase();
    if host_key.is_empty() || host.is_empty() {
        return false;
    }
    if let Some(domain) = host_key.strip_prefix('.') {
        return host == domain || host.ends_with(&format!(".{domain}"));
    }
    host == host_key
}

/// ¿Está caducada? Las cookies de sesión (`has_expires = false`) nunca lo están:
/// viven mientras viva el navegador, y eso es exactamente lo que queremos copiar.
pub fn is_expired(row: &CookieRow, now_ms: i64) -> bool {
    if !row.has_expires || row.expires_utc <= 0 {
        return false;
    }
    chrome_expiry_to_unix_ms(row.expires_utc) <= now_ms
}

/// Construye la cabecera `Cookie` para un conjunto de hosts.
///
/// - Solo entran cookies que casan con alguno de los hosts pedidos: nunca se
///   manda la sesión de un sitio a otro.
/// - Se descartan las caducadas y las que no tienen valor.
/// - Gana el `path` más largo cuando hay nombres repetidos, y el orden final es
///   de `path` más específico a más general, como manda la norma.
pub fn cookie_header(rows: &[CookieRow], hosts: &[&str], now_ms: i64) -> Result<String, SessionError> {
    let mut usable: Vec<&CookieRow> = rows
        .iter()
        .filter(|row| !row.name.trim().is_empty())
        .filter(|row| hosts.iter().any(|host| host_matches(&row.host_key, host)))
        .filter(|row| !is_expired(row, now_ms))
        .collect();

    usable.sort_by(|left, right| {
        right
            .path
            .len()
            .cmp(&left.path.len())
            .then_with(|| left.name.cmp(&right.name))
    });

    let mut chosen: Vec<(String, String)> = Vec::new();
    for row in usable {
        if chosen.iter().any(|(name, _)| name == &row.name) {
            continue;
        }
        let value = row.value_plain.clone().unwrap_or_default();
        chosen.push((row.name.clone(), value));
    }

    if chosen.is_empty() {
        return Err(SessionError::NoCookies(format!(
            "el navegador no tiene cookies para {}",
            hosts.join(", ")
        )));
    }

    let mut header = String::new();
    for (name, value) in &chosen {
        let pair = format!("{name}={value}");
        if header.len() + pair.len() + 2 > MAX_HEADER_BYTES {
            break;
        }
        if !header.is_empty() {
            header.push_str("; ");
        }
        header.push_str(&pair);
    }

    if header.is_empty() {
        return Err(SessionError::NoCookies("la cabecera resultante está vacía".to_string()));
    }
    Ok(header)
}

/// Deshace el cifrado de una fila completa, dejando el valor listo en
/// `value_plain`. Se usa una sola vez, al importar: lo guardado en el llavero es
/// la cabecera ya montada, no la base de datos entera.
pub fn resolve_row(row: &mut CookieRow, key: &SessionKey) -> Result<(), SessionError> {
    let plain = decrypt_cookie_value(
        &row.value_encrypted,
        row.value_plain.as_deref(),
        &row.host_key,
        key,
    )?;
    row.value_plain = Some(plain);
    row.value_encrypted.clear();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Función de DPAPI de mentira: "descifrar" es sumar 1 a cada byte. Así se
    /// prueba el camino completo sin depender de Windows.
    fn fake_unprotect(data: &[u8]) -> Result<Vec<u8>, String> {
        Ok(data.iter().map(|byte| byte.wrapping_add(1)).collect())
    }

    /// Cifra como lo haría Chrome: `v10` + nonce + texto cifrado + etiqueta.
    fn encrypt_like_chrome(plain: &[u8], key: &SessionKey) -> Vec<u8> {
        let cipher = Aes256Gcm::new_from_slice(key).expect("clave válida");
        let nonce = [7u8; 12];
        let mut out = V10_PREFIX.to_vec();
        out.extend_from_slice(&nonce);
        out.extend_from_slice(&cipher.encrypt(Nonce::from_slice(&nonce), plain).expect("cifra"));
        out
    }

    fn local_state_with_key(raw_key: &[u8]) -> String {
        let mut protected = DPAPI_PREFIX.as_bytes().to_vec();
        protected.extend(raw_key.iter().map(|byte| byte.wrapping_sub(1)));
        let encoded = base64::engine::general_purpose::STANDARD.encode(&protected);
        format!(r#"{{"os_crypt":{{"encrypted_key":"{encoded}"}},"profile":{{"info_cache":{{}}}}}}"#)
    }

    fn row(host_key: &str, name: &str, path: &str, value: &str) -> CookieRow {
        let mut row = CookieRow {
            host_key: host_key.to_string(),
            name: name.to_string(),
            path: path.to_string(),
            has_expires: true,
            expires_utc: 13_400_000_000_000_000,
            is_secure: true,
            is_httponly: true,
            ..Default::default()
        };
        row.value_plain = Some(value.to_string());
        row
    }

    #[test]
    fn extrae_la_clave_de_local_state() {
        let raw = [9u8; 32];
        let json = local_state_with_key(&raw);
        let encrypted = encrypted_key_from_local_state(&json).expect("clave presente");
        assert_eq!(encrypted, raw.iter().map(|byte| byte.wrapping_sub(1)).collect::<Vec<u8>>());
        let key = key_from_encrypted(&encrypted, fake_unprotect).expect("dpapi de mentira");
        assert_eq!(key, raw);
    }

    #[test]
    fn local_state_sin_clave_da_error_claro() {
        let error = encrypted_key_from_local_state(r#"{"os_crypt":{}}"#).unwrap_err();
        assert!(matches!(error, SessionError::MissingKey(_)));
        assert!(error.to_string().contains("clave"));
    }

    #[test]
    fn una_clave_que_no_mide_32_bytes_no_cuela() {
        let error = key_from_encrypted(&[1, 2, 3], |_| Ok(vec![1, 2, 3])).unwrap_err();
        assert!(error.to_string().contains("32"));
    }

    #[test]
    fn descifra_una_cookie_v10_de_ida_y_vuelta() {
        let key = [3u8; 32];
        let encrypted = encrypt_like_chrome(b"sesion-real", &key);
        let value = decrypt_cookie_value(&encrypted, None, ".reddit.com", &key).expect("descifra");
        assert_eq!(value, "sesion-real");
    }

    #[test]
    fn recorta_el_resumen_del_dominio_de_las_cookies_antiguas() {
        let key = [5u8; 32];
        let host_key = ".reddit.com";
        let mut plain = Sha256::digest(host_key.as_bytes()).to_vec();
        plain.extend_from_slice(b"valor-antiguo");
        let encrypted = encrypt_like_chrome(&plain, &key);
        let value = decrypt_cookie_value(&encrypted, None, host_key, &key).expect("descifra");
        assert_eq!(value, "valor-antiguo");
    }

    #[test]
    fn con_otra_clave_avisa_en_vez_de_inventar() {
        let encrypted = encrypt_like_chrome(b"secreto", &[1u8; 32]);
        let error = decrypt_cookie_value(&encrypted, None, ".reddit.com", &[2u8; 32]).unwrap_err();
        assert!(matches!(error, SessionError::Undecryptable(_)));
        assert!(error.to_string().contains("No se inventa"));
    }

    #[test]
    fn rechaza_v20_con_explicacion() {
        let mut encrypted = V20_PREFIX.to_vec();
        encrypted.extend_from_slice(&[0u8; 40]);
        let error = decrypt_cookie_value(&encrypted, None, ".reddit.com", &[0u8; 32]).unwrap_err();
        assert!(error.to_string().contains("v20"));
    }

    #[test]
    fn acepta_el_valor_en_texto_plano_de_instalaciones_antiguas() {
        let value = decrypt_cookie_value(&[], Some("a-mano"), ".reddit.com", &[0u8; 32]).unwrap();
        assert_eq!(value, "a-mano");
    }

    #[test]
    fn empareja_dominios_como_manda_la_norma() {
        assert!(host_matches(".reddit.com", "www.reddit.com"));
        assert!(host_matches(".reddit.com", "reddit.com"));
        assert!(!host_matches(".reddit.com", "otrodominio.com"));
        assert!(!host_matches(".reddit.com", "notreddit.com"));
        assert!(host_matches("www.reddit.com", "www.reddit.com"));
        assert!(!host_matches("www.reddit.com", "old.reddit.com"));
        assert!(host_matches(".REDDIT.com", "www.Reddit.com"));
        assert!(!host_matches("", "www.reddit.com"));
    }

    #[test]
    fn las_cookies_de_sesion_no_caducan() {
        let mut sesion = row(".reddit.com", "reddit_session", "/", "x");
        sesion.has_expires = false;
        sesion.expires_utc = 0;
        assert!(!is_expired(&sesion, i64::MAX));

        let caducada = row(".reddit.com", "vieja", "/", "y");
        assert!(is_expired(&caducada, i64::MAX));
    }

    #[test]
    fn monta_la_cabecera_con_path_mas_especifico_primero() {
        let mut corta = row(".reddit.com", "a", "/", "1");
        corta.has_expires = false;
        let mut larga = row(".reddit.com", "b", "/r/technology", "2");
        larga.has_expires = false;
        let rows = vec![corta, larga];

        let header = cookie_header(&rows, &["www.reddit.com"], 0).expect("cabecera");
        assert_eq!(header, "b=2; a=1");
    }

    #[test]
    fn gana_el_path_mas_especifico_cuando_se_repite_el_nombre() {
        let mut general = row(".reddit.com", "token", "/", "general");
        general.has_expires = false;
        let mut especifica = row(".reddit.com", "token", "/r/technology", "especifica");
        especifica.has_expires = false;

        let header = cookie_header(&[general, especifica], &["www.reddit.com"], 0).expect("cabecera");
        assert_eq!(header, "token=especifica");
    }

    #[test]
    fn no_manda_la_sesion_de_un_sitio_a_otro() {
        let mut reddit = row(".reddit.com", "reddit_session", "/", "secreta");
        reddit.has_expires = false;
        let error = cookie_header(&[reddit], &["public.api.bsky.app"], 0).unwrap_err();
        assert!(matches!(error, SessionError::NoCookies(_)));
    }

    #[test]
    fn una_fila_cifrada_se_resuelve_y_se_limpia() {
        let key = [8u8; 32];
        let mut fila = CookieRow {
            host_key: ".reddit.com".to_string(),
            name: "reddit_session".to_string(),
            path: "/".to_string(),
            value_encrypted: encrypt_like_chrome(b"abc123", &key),
            has_expires: false,
            ..Default::default()
        };
        resolve_row(&mut fila, &key).expect("resuelve");
        assert_eq!(fila.value_plain.as_deref(), Some("abc123"));
        assert!(fila.value_encrypted.is_empty());

        let header = cookie_header(&[fila], &["www.reddit.com"], 0).expect("cabecera");
        assert_eq!(header, "reddit_session=abc123");
    }

    #[cfg(not(windows))]
    #[test]
    fn fuera_de_windows_dpapi_lo_dice_claro() {
        let error = dpapi_unprotect(&[1, 2, 3]).unwrap_err();
        assert!(error.contains("Windows"));
    }

    #[test]
    fn la_cabecera_no_crece_sin_control() {
        let mut rows = Vec::new();
        for index in 0..200 {
            let mut fila = row(".reddit.com", &format!("c{index}"), "/", &"x".repeat(200));
            fila.has_expires = false;
            rows.push(fila);
        }
        let header = cookie_header(&rows, &["www.reddit.com"], 0).expect("cabecera");
        assert!(header.len() <= MAX_HEADER_BYTES);
        assert!(header.len() > 1000);
    }
}
