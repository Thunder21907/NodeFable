//! `#[tauri::command]` handlers — the IPC equivalents of the FastAPI routes.
//! Names and arguments match `frontend/editor/js/api.js` (Tauri maps camelCase
//! JS args such as `newName` / `fromPath` to the snake_case parameters here).
//! Errors are returned as the same `detail` strings the HTTP API produced.
//!
//! Commands are `async` so file I/O runs on Tauri's async runtime threads
//! instead of blocking the UI (main) thread.

use std::path::PathBuf;

use percent_encoding::{percent_decode_str, utf8_percent_encode, AsciiSet, NON_ALPHANUMERIC};
use serde_json::{json, Value};
use tauri::ipc::InvokeBody;
use tauri::{AppHandle, Runtime, State};

use crate::models::{AssetEntry, Project, SaveEntry, SaveRequest};
use crate::storage::{self, ApiError};

/// Shared app state: where projects live.
pub struct AppState {
    pub data_dir: PathBuf,
}

type CmdResult<T> = Result<T, String>;

fn e(err: ApiError) -> String {
    err.detail
}

/// Characters kept as-is in a URL path segment (RFC 3986 unreserved).
const SEGMENT: &AsciiSet = &NON_ALPHANUMERIC.remove(b'-').remove(b'_').remove(b'.').remove(b'~');

/// URL of a project folder on the `nfasset` protocol. Tauri serves custom
/// schemes as `nfasset://localhost/…` on Linux/macOS/iOS and as
/// `http://nfasset.localhost/…` on Windows and Android.
pub fn project_base_url(project: &str) -> String {
    let seg = utf8_percent_encode(project, SEGMENT);
    if cfg!(any(windows, target_os = "android")) {
        format!("http://nfasset.localhost/{seg}/")
    } else {
        format!("nfasset://localhost/{seg}/")
    }
}

/// `template.html` + `template_styles.css` from the bundled frontend.
fn template_assets<R: Runtime>(app: &AppHandle<R>) -> CmdResult<(String, Option<String>)> {
    let resolver = app.asset_resolver();
    let get = |p: &str| {
        resolver
            .get(p.to_string())
            .or_else(|| resolver.get(format!("/{p}")))
            .map(|a| String::from_utf8_lossy(&a.bytes).into_owned())
    };
    let template = get("template.html").ok_or("Game template (template.html) is missing from the app bundle")?;
    Ok((template, get("template_styles.css")))
}

#[tauri::command]
pub async fn list_saves(state: State<'_, AppState>) -> CmdResult<Vec<SaveEntry>> {
    storage::list_saves(&state.data_dir).map_err(e)
}

#[tauri::command]
pub async fn load_manifest(state: State<'_, AppState>, name: String) -> CmdResult<Value> {
    storage::load_manifest(&state.data_dir, &name).map_err(e)
}

#[tauri::command]
pub async fn load_project(state: State<'_, AppState>, name: String, groups: Option<Vec<String>>) -> CmdResult<Project> {
    storage::load_project(&state.data_dir, &name, groups.as_deref()).map_err(e)
}

#[tauri::command]
pub async fn save_project(state: State<'_, AppState>, req: SaveRequest) -> CmdResult<Value> {
    storage::save_project(&state.data_dir, &req).map_err(e)
}

#[tauri::command]
pub async fn list_assets(state: State<'_, AppState>, name: String) -> CmdResult<Vec<AssetEntry>> {
    storage::list_assets(&state.data_dir, &name).map_err(e)
}

/// Upload a file into `assets/<folder>/`. The editor sends the file as a raw
/// binary IPC body with `x-nf-name`, `x-nf-filename` and `x-nf-folder`
/// headers (percent-encoded); a JSON body `{name, filename, folder, bytes}`
/// is accepted too.
#[tauri::command]
pub async fn upload_asset(state: State<'_, AppState>, request: tauri::ipc::Request<'_>) -> CmdResult<Value> {
    let header = |k: &str| {
        request
            .headers()
            .get(k)
            .and_then(|v| v.to_str().ok())
            .map(|v| percent_decode_str(v).decode_utf8_lossy().into_owned())
            .unwrap_or_default()
    };
    let (name, filename, folder, bytes) = match request.body() {
        InvokeBody::Raw(bytes) => (header("x-nf-name"), header("x-nf-filename"), header("x-nf-folder"), bytes.clone()),
        InvokeBody::Json(v) => {
            let s = |k: &str| v.get(k).and_then(Value::as_str).unwrap_or("").to_string();
            let bytes: Vec<u8> = serde_json::from_value(v.get("bytes").cloned().unwrap_or(Value::Null))
                .map_err(|_| "Upload body must contain `bytes`".to_string())?;
            (s("name"), s("filename"), s("folder"), bytes)
        }
    };
    storage::upload_asset(&state.data_dir, &name, &filename, &folder, &bytes).map_err(e)
}

#[tauri::command]
pub async fn create_folder(state: State<'_, AppState>, name: String, path: String) -> CmdResult<Value> {
    storage::create_folder(&state.data_dir, &name, &path).map_err(e)
}

#[tauri::command]
pub async fn rename_asset(state: State<'_, AppState>, name: String, path: String, new_name: String) -> CmdResult<Value> {
    storage::rename_asset(&state.data_dir, &name, &path, &new_name).map_err(e)
}

#[tauri::command]
pub async fn move_asset(state: State<'_, AppState>, name: String, from_path: String, to_path: String) -> CmdResult<Value> {
    storage::move_asset(&state.data_dir, &name, &from_path, &to_path).map_err(e)
}

#[tauri::command]
pub async fn copy_asset(state: State<'_, AppState>, name: String, from_path: String, to_path: String) -> CmdResult<Value> {
    storage::copy_asset(&state.data_dir, &name, &from_path, &to_path).map_err(e)
}

#[tauri::command]
pub async fn delete_asset(state: State<'_, AppState>, name: String, filepath: String) -> CmdResult<Value> {
    storage::delete_asset(&state.data_dir, &name, &filepath).map_err(e)
}

/// Full game HTML for the in-app preview (`<iframe srcdoc>`); relative
/// `assets/…` URLs resolve through `<base href>` to the `nfasset` protocol.
#[tauri::command]
pub async fn build_preview_html<R: Runtime>(app: AppHandle<R>, state: State<'_, AppState>, name: String) -> CmdResult<String> {
    let (template, css) = template_assets(&app)?;
    let safe = storage::safe_name(&name).map_err(e)?;
    storage::preview_html(&state.data_dir, &name, &template, css.as_deref(), &project_base_url(&safe)).map_err(e)
}

/// Folder exports go to: the user's Downloads folder on desktop, or
/// `<app data>/nodefable/exports` where that is unavailable (Android).
fn export_dir<R: Runtime>(app: &AppHandle<R>, data_dir: &std::path::Path) -> PathBuf {
    #[cfg(desktop)]
    {
        use tauri::Manager;
        if let Ok(d) = app.path().download_dir() {
            return d;
        }
    }
    let _ = app;
    data_dir.parent().map(|p| p.join("exports")).unwrap_or_else(|| data_dir.join("exports"))
}

/// Export `<Project>.zip` (index.html + assets/). `dest` (absolute path) is
/// optional; by default the zip is written to `export_dir()`.
#[tauri::command]
pub async fn export_project_zip<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    name: String,
    dest: Option<String>,
) -> CmdResult<Value> {
    let (template, css) = template_assets(&app)?;
    let safe = storage::safe_name(&name).map_err(e)?;
    let dest = match dest {
        Some(d) if !d.trim().is_empty() => PathBuf::from(d),
        _ => export_dir(&app, &state.data_dir).join(format!("{safe}.zip")),
    };
    let path = storage::export_zip(&state.data_dir, &name, &template, css.as_deref(), &dest).map_err(e)?;
    Ok(json!({ "status": "ok", "path": path.to_string_lossy() }))
}
