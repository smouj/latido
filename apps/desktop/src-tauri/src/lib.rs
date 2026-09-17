//! Arranque de la aplicación de escritorio.
//!
//! El shell es deliberadamente delgado: ventana, avisos del sistema, apertura de
//! enlaces, secretos en el llavero del sistema y un archivo SQLite duradero. El
//! análisis —conectores, clustering y tendencias— vive en el motor TypeScript y
//! se ejecuta dentro del WebView, así que hay una sola implementación.

mod archive;
mod secrets;
mod session;
mod state;

use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;

use crate::archive::Archive;

pub fn run() {
    tauri::Builder::default()
        // Una sola instancia: dos ventanas leyendo las mismas fuentes no aportan
        // nada y multiplican las peticiones a las redes.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let handle = app.handle();
            let archive = Archive::open(handle)?;
            app.manage(archive);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            state::state_load,
            state::state_save,
            state::state_clear,
            archive::archive_sync,
            archive::archive_stats,
            archive::archive_export,
            secrets::secret_set,
            secrets::secret_get,
            secrets::secret_delete,
            session::session_browsers,
            session::session_import,
            session::session_peek,
            session::session_forget,
            notify,
            open_external,
        ])
        .run(tauri::generate_context!())
        .expect("no se pudo arrancar Latido");
}

/// Aviso del sistema. Se usa para lo que de verdad interrumpe: un tema que
/// empieza a crecer y que el usuario pidió vigilar.
#[tauri::command]
fn notify(app: AppHandle, title: String, body: String) -> Result<(), String> {
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|error| error.to_string())
}

/// Abre un enlace con el navegador del sistema. Solo `http(s)`: nunca `file://`
/// ni esquemas que puedan lanzar aplicaciones arbitrarias.
#[tauri::command]
fn open_external(app: AppHandle, url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("solo se abren enlaces http(s)".to_string());
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|error| error.to_string())
}
