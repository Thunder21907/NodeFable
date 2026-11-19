//! NodeFable desktop / Android app: Tauri v2 shell around the editor in
//! `frontend/editor`, with a fully local Rust backend (replaces the FastAPI
//! server in `backend/main.py`).
//!
//! * Projects live in `<local data dir>/nodefable/data/<Project>/`
//!   (`~/.local/share/nodefable/data` on Linux; the app's internal files
//!   directory on Android). Override with the `NODEFABLE_DATA_DIR` env var.
//! * `commands` — IPC handlers used by `frontend/editor/js/api.js`.
//! * `protocol` — the `nfasset://` scheme serving project assets.

pub mod commands;
pub mod models;
pub mod protocol;
pub mod storage;

use std::path::PathBuf;

use tauri::{AppHandle, Manager, Runtime};

use crate::commands::AppState;

/// Environment variable that overrides the project data directory.
pub const DATA_DIR_ENV: &str = "NODEFABLE_DATA_DIR";

fn resolve_data_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, Box<dyn std::error::Error>> {
    if let Some(dir) = std::env::var_os(DATA_DIR_ENV).filter(|d| !d.is_empty()) {
        return Ok(PathBuf::from(dir));
    }
    Ok(app.path().local_data_dir()?.join("nodefable").join("data"))
}

/// WebKitGTK's DMA-BUF renderer crashes on many Wayland + NVIDIA setups
/// ("Gdk Error 71 (Protocol error) dispatching to Wayland display" and the
/// window never appears). Disable it unless the user chose a value.
#[cfg(target_os = "linux")]
fn apply_linux_webkit_workarounds() {
    const VAR: &str = "WEBKIT_DISABLE_DMABUF_RENDERER";
    if std::env::var_os(VAR).is_none() {
        // Called first thing in `run()`, before any other thread exists.
        std::env::set_var(VAR, "1");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "linux")]
    apply_linux_webkit_workarounds();

    tauri::Builder::default()
        .setup(|app| {
            let data_dir = resolve_data_dir(app.handle())?;
            std::fs::create_dir_all(&data_dir)?;
            app.manage(AppState { data_dir });
            Ok(())
        })
        .register_uri_scheme_protocol("nfasset", |ctx, request| {
            let state = ctx.app_handle().state::<AppState>();
            protocol::handle(&state.data_dir, &request)
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_saves,
            commands::load_manifest,
            commands::load_project,
            commands::save_project,
            commands::list_assets,
            commands::upload_asset,
            commands::create_folder,
            commands::rename_asset,
            commands::move_asset,
            commands::copy_asset,
            commands::delete_asset,
            commands::build_preview_html,
            commands::export_project_zip,
        ])
        .run(tauri::generate_context!())
        .expect("error while running NodeFable");
}
