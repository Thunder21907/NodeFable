# Backend Reference

NodeFable has a **fully local Rust backend** in `src-tauri/` (Tauri v2, desktop + Android). It replaces the FastAPI server in `backend/main.py`, which is documented further below as the **legacy** reference until it is removed. The editor talks to whichever backend is present through `frontend/editor/js/api.js` (`isTauri()` → Tauri IPC, otherwise HTTP).

## Rust backend (`src-tauri/`)

### Layout

| File | Role |
|---|---|
| `Cargo.toml` | Crate `nodefable` (lib `nodefable_lib`, `staticlib`/`cdylib`/`rlib` for Android). Deps: `tauri 2`, `serde`, `serde_json` (`preserve_order`), `tempfile`, `zip 2` (deflate), `regex`, `percent-encoding`, `mime_guess`. |
| `tauri.conf.json` | `identifier: com.nodefable.app`, `frontendDist: ../frontend/editor` (no build step), window `main` 1400×900 (min 360×480), `csp: null`. |
| `capabilities/default.json` | `core:default` for window `main` (app commands need no plugin permissions). |
| `src/main.rs` | Desktop entry → `nodefable_lib::run()`. |
| `src/lib.rs` | `run()` (also the Android `mobile_entry_point`): data dir, `nfasset` protocol, command registration, Linux WebKit workaround. |
| `src/models.rs` | Serde mirrors of `backend/schemas/project.py` (`NodeData`, `ChoiceLink`, `OnEnter`, `SaveRequest`, `Project`, `SaveEntry`, `AssetEntry`). Field order / `null`s / defaults match Pydantic `model_dump`. |
| `src/storage.rs` | All storage logic (pure functions over a data-dir `root`): names & paths, legacy migration, manifest loading, save, assets, story HTML, zip export. `ApiError { status, detail }` mirrors FastAPI's status codes and `detail` messages. |
| `src/commands.rs` | `#[tauri::command]` wrappers (async, so file I/O never blocks the UI thread). |
| `src/protocol.rs` | `nfasset://` asset server with HTTP Range support. |
| `tests/storage.rs` | Integration tests (`cargo test`). |
| `examples/nfcli.rs` | Dev-only CLI over `storage` (parity checks); not part of the app. |

### Data directory

`<local data dir>/nodefable/data/<Project>/` — `~/.local/share/nodefable/data` on Linux (`$XDG_DATA_HOME` respected), `%LOCALAPPDATA%\nodefable\data` on Windows, `~/Library/Application Support/nodefable/data` on macOS, the app's internal files dir on Android. Override with **`NODEFABLE_DATA_DIR`** (tests / pointing the app at another folder). The on-disk format (`manifest.json` + `groups/*.json` + `assets/`) is identical to the Python backend's, so project folders can be copied between them.

### Commands (IPC) ↔ legacy HTTP routes

| Command (args from `api.js`) | Returns | Legacy route |
|---|---|---|
| `list_saves()` | `[{name, mtime}]` newest first | `GET /api/saves` |
| `load_manifest(name)` | manifest (legacy `project.json` migrated, orphan group files adopted, flat `slug_ids` upgraded) | `GET /api/load/manifest` |
| `load_project(name, groups?)` | `{variables, setup, nodes}` (nodes validated as `NodeData`; `groups` = list, de-duplicated; empty/absent = all) | `GET /api/load` |
| `save_project(req)` | `{status, name}`; name 1–100 chars, top-level variable/setup values may not be `null` (422) | `POST /api/save` |
| `list_assets(name)` | asset tree (folders first, sorted) | `GET /api/assets/{name}` |
| `upload_asset` | `{status, filename, url, rel_path}` — **raw binary IPC body** with percent-encoded headers `x-nf-name`, `x-nf-filename`, `x-nf-folder` (a JSON body `{name, filename, folder, bytes}` is also accepted) | `POST …/upload` |
| `create_folder(name, path)` | `{status, path}` | `POST …/folder` |
| `rename_asset(name, path, newName)` | `{status}` (409 if target exists) | `PUT …/rename` |
| `move_asset(name, fromPath, toPath)` / `copy_asset(…)` | `{status}` | `PUT …/move`, `POST …/copy` |
| `delete_asset(name, filepath)` | `{status, deleted_count}` | `DELETE …/{path}` |
| `build_preview_html(name)` | full game HTML (string) with `<base href>` = the project's `nfasset` URL; shown in the editor's preview overlay via `srcdoc` | `GET /api/preview` + `/api/preview-file` |
| `export_project_zip(name, dest?)` | `{status, path}`; default `~/Downloads/<Project>.zip` on desktop, `<app data>/nodefable/exports/` otherwise | `GET /api/export/{name}` |

Errors reject with the `detail` string (e.g. `Project 'x' not found`); `api.js`'s `invokeTauri` wraps it in an `Error`.

### `nfasset` protocol

Serves `<data>/<Project>/assets/<path>` for editor thumbnails and the preview. URL form depends on the platform (Tauri custom-scheme rules): `nfasset://localhost/<Project>/assets/<path>` on Linux/macOS, `http://nfasset.localhost/<Project>/assets/<path>` on Windows/Android. `api.resolveEditorAssetUrl` uses Tauri's `convertFileSrc(path, 'nfasset')`, which percent-encodes the whole path into one segment — the handler decodes both forms. Paths go through `resolve_asset_path`, folders/missing files → 404, traversal → 400. `Range: bytes=…` → 206 (open-ended ranges served in 4 MiB chunks, so large audio/video stream and seek without loading whole files); `Access-Control-Allow-Origin: *` and exposed `Content-Range` / `Content-Length` / `Accept-Ranges` (the editor origin differs from the asset origin).

**Media must be requested in CORS mode.** Under `cargo tauri dev` the editor page is served from `http://127.0.0.1:1430`, and WebKitGTK refuses a plain (no-CORS) `<img>`/`<video>`/`<audio>` load from an `http://` page to the `nfasset://` scheme (the element shows an empty/black box; `fetch()` of the same URL works). A CORS-mode request succeeds because the scheme answers `Access-Control-Allow-Origin: *`. So: the editor's asset thumbnails carry `crossorigin="anonymous"`, and `build_preview_html` injects `<script>window.NF_ASSET_CORS = true;</script>` before `</head>`, which makes the runtime add `crossorigin="anonymous"` to `{img:}` / `{video:}` and set `crossOrigin` on `{audio:}` tracks. Exported games never get the flag (a standalone `index.html` opened from `file://` must keep plain media requests).

### Behaviour vs. the Python backend

Verified identical on all 12 projects in `backend/data` (212 strict comparisons — manifests, full and per-group loads, story payloads, asset trees, every file written by a save round-trip, exported zips). Deliberate differences, all stricter/safer:
- asset paths are validated per component (`..`, absolute and drive paths rejected) and must stay inside `assets/` after resolving symlinks;
- all writes (JSON and uploads) are atomic (temp file in the same folder + rename); the zip export streams assets from disk and stores already-compressed media;
- deleting a symlinked folder removes only the link; copying a folder skips nested symlinks; copying/moving a folder into itself is rejected (400);
- duplicate ids in the save request's `groups` metadata are written once; adopted orphan group files are appended in name order;
- the template stylesheet is inlined *before* the story JSON is injected (story text can't match the `<link>` marker); `</` in story JSON is escaped as `<\/`; zip entries always use `/`.

### Platform notes

- **Linux:** `run()` sets `WEBKIT_DISABLE_DMABUF_RENDERER=1` (unless already set) — WebKitGTK's DMA-BUF renderer crashes on Wayland with NVIDIA ("Gdk Error 71 (Protocol error)"), and the window never appears.
- **Android:** same crate (`#[cfg_attr(mobile, tauri::mobile_entry_point)]`); the Android project is generated by `cargo tauri android init` into `src-tauri/gen/android`.

### Development

Use `./tauri-manager.sh` from the repo root (interactive menu, or `./tauri-manager.sh dev|test|verify|deb|rpm|appimage|android|android-x86|android-release|install|phone|data|…`). Android commands source `~/Android/env.sh` (full JDK with `javac`, `ANDROID_HOME`, `NDK_HOME`) and run `cargo tauri android init` if `src-tauri/gen/android` is missing; release APKs are signed via `tools/android-signing.sh` (reads `~/Android/keystore.properties` at build time — no secrets in the repo). `scripts/generate_perf_project.js` writes its 1000-node test project into the same data folder.

Plain cargo equivalents:

```sh
cd src-tauri
cargo test                      # storage + protocol tests
cargo run                       # desktop app (debug)
NODEFABLE_DATA_DIR=/some/folder cargo run       # use another projects folder
cargo tauri dev | build         # with tauri-cli (bundles, Android: cargo tauri android dev|build)
```

---

# Legacy: Python FastAPI backend (`backend/main.py`)

> Kept for reference until removal. The Rust backend above is the replacement.


**File:** `backend/main.py`  
**Framework:** FastAPI  
**Data:** Per-group JSON files under `backend/data/<GameName>/groups/` + `manifest.json`

## Imports & Dependencies

| Import | Source | Purpose |
|--------|--------|---------|
| `FastAPI`, `HTTPException`, `Query`, `UploadFile`, `File` | `fastapi` | Web framework, error handling, request utilities |
| `StaticFiles` | `fastapi.staticfiles` | Mounting frontend static directory |
| `FileResponse`, `StreamingResponse` | `fastapi.responses` | Serving asset files and ZIP downloads |
| `BaseModel`, `Field` | `pydantic` | Request/response model validation |
| `json`, `os`, `io`, `zipfile`, `re`, `pathlib.Path` | stdlib | File I/O, ZIP creation, URL rewriting |
| `Dict`, `List`, `Optional` | `typing` | Type hints |
| `ProjectSchema`, `NodeData`, `VariableValue` | `backend.schemas.project` | Pydantic schemas for project data (see `docs/guide.md`) |

No lockfile. The only external packages are `fastapi`, `uvicorn[standard]`, and `python-multipart`.

## Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| `DATA_DIR` | `"backend/data"` | Root directory for all project folders (auto-created on startup) |
| `FRONTEND_DIR` | `"frontend/editor"` | Static frontend directory mounted at `/editor` |

## Static File Mounting

```python
# Line 233
app.mount("/editor", StaticFiles(directory=FRONTEND_DIR, html=True), name="editor")
```

Everything under `frontend/editor/` is served at `/editor/...`. The `html=True` flag enables automatic fallback to `index.html` for directory requests.

## Models

### `SaveRequest`

| Field | Type | Constraints | Default | Description |
|-------|------|-------------|---------|-------------|
| `name` | `str` | `min_length=1, max_length=100` | (required) | Project name, used as folder name |
| `variables` | `Dict[str, VariableValue]` | — | `{}` | Initial story variables |
| `nodes` | `List[NodeData]` | — | `[]` | All story nodes (excluding portals) |
| `groups` | `List[Dict]` | — | `None` | Group metadata with id, label, etc. |

`VariableValue = Union[bool, int, float, str, list]` (defined in `backend/schemas/project.py:5`).

`NodeData` now includes a `group: Optional[str]` field (default `None` — the group file the node was loaded from is authoritative; Pydantic no longer injects `"side_panel"` into nodes that omit the field), an `is_utility: bool` field (default `False`, editor/validation-only — nodes stay in the export so `{include:}` can splice them), and an `is_function: bool` field (default `False` — marks a node as a `{fn:}` catalogue, excluded from navigation and validation). Nodes are partitioned by group on save (`n.get("group") or "side_panel"`). `is_function` round-trips through Pydantic (`model_dump` / coercion) with no backend code changes; manifest version stays `2`.

### `ProjectSchema` (response model for `/api/load`)

| Field | Type | Description |
|-------|------|-------------|
| `variables` | `Dict[str, VariableValue]` | The project's variable definitions |
| `nodes` | `List[NodeData]` | All story nodes with choices, on_enter, is_start, is_utility |

See `docs/guide.md` for full schema detail of `NodeData`, `ChoiceLink`, `OnEnter`.

## Helper Functions

### `safe_name(name: str) -> str` (line 27–28)

Sanitizes a project name by replacing `/` and `\` with `_`. Prevents directory traversal. Used by every endpoint that touches the filesystem.

## API Endpoints

### Endpoint Summary

| # | Method | Path | Purpose |
|---|--------|------|---------|
| 1 | `GET` | `/` | Health check |
| 2 | `POST` | `/api/save` | Save a project |
| 3 | `GET` | `/api/saves` | List saved projects |
| 4 | `GET` | `/api/load/manifest` | Load project manifest only |
| 5 | `GET` | `/api/load` | Load project (filtered by groups) |
| 6 | `GET` | `/api/assets/{name}` | List assets as a tree |
| 7 | `POST` | `/api/assets/{name}/upload` | Upload an asset |
| 8 | `POST` | `/api/assets/{name}/folder` | Create a folder |
| 9 | `PUT` | `/api/assets/{name}/rename` | Rename a file or folder |
| 10 | `PUT` | `/api/assets/{name}/move` | Move a file or folder |
| 11 | `POST` | `/api/assets/{name}/copy` | Copy a file or folder |
| 12 | `GET` | `/api/assets/{name}/{filepath:path}` | Serve an asset file |
| 13 | `DELETE` | `/api/assets/{name}/{filepath:path}` | Delete a file or folder (recursive) |
| 14 | `GET` | `/api/export/{name}` | Download project as ZIP |
| 15 | `GET` | `/api/preview/{name}` | Generate preview.html in project dir |
| 16 | `GET` | `/api/preview-file/{name}` | Serve generated preview.html |

---

### 1. Health Check

```
GET /
```

| | |
|---|---|
| **Line** | 30–32 |
| **Purpose** | Returns a simple JSON message confirming the server is running |
| **Response** | `{"message": "NodeFable API is running"}` |
| **Errors** | None |

---

### 2. Save Project

```
POST /api/save
```

**Line:** 34–52

**Request body** (`application/json`) — `SaveRequest` model:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes (1–100 chars) | Project name, sanitized to folder name |
| `variables` | `object` | No | Map of variable names to `bool`/`int`/`string` values |
| `nodes` | `array` | No | Array of `NodeData` objects |

**Response (200):**
```json
{ "status": "ok", "name": "<sanitized_name>" }
```

**Error handling:**
- `500` — JSON with `detail: "Failed to save project: <reason>"` on any exception (disk full, permissions, etc.)

**Behavior:**
1. Sanitizes `name` via `safe_name()`
2. Creates directory `<DATA_DIR>/<name>/` and `<DATA_DIR>/<name>/assets/`
3. Partitions incoming nodes by their `group` field
4. Writes per-group files to `<DATA_DIR>/<name>/groups/<group_id>.json`
5. Writes/updates `manifest.json` with group metadata (labels, counts, slug_ids)
6. Preserves group labels from the `groups` field in the request payload
7. Overwrites any existing project with the same name

---

### 3. List Saves

```
GET /api/saves
```

**Line:** 54–67

**Response (200):**
```json
{
  "saves": [
    { "name": "MyGame", "mtime": 1712345678.0 },
    ...
  ]
}
```
Sorted by modification time, newest first. Only directories containing a `project.json` are listed.

**Error handling:**
- `500` — returns `{"detail": "<exception message>"}`

---

### 4. Load Manifest (lightweight)

```
GET /api/load/manifest?name=<project_name>
```

**Purpose:** Returns only the manifest (group list with `slug_ids` + connections, variable definitions) without any node body data. Used by the frontend to show the group selector before loading any nodes.

**Response (200):**
```json
{
  "name": "MyGame",
  "version": 2,
  "variables": { "hp": 100 },
  "groups": [
    { "id": "side_panel", "label": "Side Panel", "node_count": 1, "slug_ids": [{ "slug_id": "side_panel", "connections": [] }] },
    { "id": "chapter_1", "label": "Chapter 1", "node_count": 300, "slug_ids": [{ "slug_id": "c1_start", "connections": ["c1_forest"] }] }
  ]
}
```

**Error handling:**
- `404` — `"Project '<name>' not found"`
- Auto-migrates legacy projects (single `project.json`) to new format on first access

### 5. Load Project

```
GET /api/load?name=<project_name>
GET /api/load?name=<project_name>&groups=side_panel,chapter_1
```

**Query parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | `string` | Yes | Project folder name |
| `groups` | `string` | No | Comma-separated group IDs to load. If omitted, loads ALL groups (backward compatible) |

**Response (200)** — `ProjectSchema`:
```json
{
  "variables": { "hp": 100 },
  "nodes": [ { "id": "node_1", "title": "...", "group": null, ... } ]
}
```

**Error handling:**
- `404` — `"Project '<name>' not found"` if project does not exist
- `500` — `"Failed to load project: <reason>"` on error

**Behavior:**
- When `groups` is specified, only reads the corresponding group files from `groups/<id>.json`
- When `groups` is omitted, merges all group files into one response
- Each node carries only the fields stored in its group file: nodes saved without a `group` field come back as `"group": null` (never invented as `"side_panel"`); the frontend derives group membership from the requested group instead, so loading a non-`side_panel` group can no longer reset nodes to the Side Panel group on save

---

### 6. List Assets (tree)

```
GET /api/assets/{name}
```

**Line:** ~513

| Path param | Description |
|------------|-------------|
| `name` | Project folder name |

**Response (200):**
```json
{
  "tree": [
    { "name": "bg", "type": "folder", "children": [
      { "name": "forest.png", "type": "file", "file_size": 12345, "url": "/api/assets/MyGame/bg/forest.png" }
    ]},
    { "name": "icon.png", "type": "file", "file_size": 8901, "url": "/api/assets/MyGame/icon.png" }
  ]
}
```
Returns hierarchical tree structure. Folders first, then files, alphabetically sorted. `file_size` in bytes. Empty `assets/` dir returns `{"tree": []}`.

---

### 7. Upload Asset

```
POST /api/assets/{name}/upload
```

**Line:** ~521

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | path | Yes | Project folder name |
| `file` | `UploadFile` (form) | Yes | File to upload |
| `folder` | string (form) | No | Subdirectory path within assets (e.g. `bg/castle`) |

**Response (200):**
```json
{ "status": "ok", "filename": "forest.png", "url": "/api/assets/MyGame/bg/forest.png" }
```

**Error handling:**
- `404` — `"Project not found or assets directory missing"`
- `400` — `"Invalid filename"`
- `500` — `"Failed to upload asset: <reason>"`

**Behavior:** Creates intermediate directories if `folder` is specified. Overwrites existing file with same name.

---

### 8. Create Folder

```
POST /api/assets/{name}/folder
```

**Body:** `{"path": "bg/castle/interior"}` (JSON)

Creates nested folders under `assets/`. No-op if already exists.

---

### 9. Rename

```
PUT /api/assets/{name}/rename
```

**Body:** `{"path": "bg/old_name.png", "new_name": "new_name.png"}` (JSON)

Renames a file or folder. Returns `409` if target already exists.

---

### 10. Move

```
PUT /api/assets/{name}/move
```

**Body:** `{"from_path": "bg/old.png", "to_path": "new/old.png"}` (JSON)

Moves a file or folder. Creates intermediate directories for destination. Returns `409` if target exists.

---

### 11. Copy

```
POST /api/assets/{name}/copy
```

**Body:** `{"from_path": "bg/file.png", "to_path": "new/file.png"}` (JSON)

Copies a file or folder (recursive copy for folders). Returns `409` if target exists.

---

### 12. Serve Asset

```
GET /api/assets/{name}/{filepath:path}
```

| Param | Description |
|-------|-------------|
| `name` | Project folder name |
| `filepath` | Relative path within assets (e.g. `bg/forest.png`). The literal path is tried first; if it is not a file and starts with `assets/`, the prefix is stripped and retried (so relative `assets/bg/forest.png` URLs work while a real sub-folder named `assets/` stays reachable). |

**Response (200):** Raw file bytes (`FileResponse`).

**Error handling:**
- `404` — `"Asset not found"` (also for folders — only regular files are served)
- `400` — `"Invalid path"` if path escapes `assets/` directory

Uses `{filepath:path}` FastAPI path converter to capture multi-segment paths. Route must be defined after all other `/api/assets/{name}/...` routes to avoid conflicts.

---

### 13. Delete Asset / Folder

```
DELETE /api/assets/{name}/{filepath:path}
```

| Param | Description |
|-------|-------------|
| `name` | Project folder name |
| `filepath` | Relative path to delete (file or folder) |

**Response (200):**
```json
{ "status": "ok", "deleted_count": 5 }
```

Recursive for folders. Returns count of deleted files (1 for single file, N for folders).

**Error handling:**
- `400` — `"Invalid path"` if path escapes `assets/`
- `404` — `"Path not found"`
- `500` — `"Failed to delete: <reason>"` on filesystem error

---

### 14. Export Project (ZIP Download)

```
GET /api/export/{name}
```

**Line:** 148–196

| Path param | Description |
|------------|-------------|
| `name` | Project folder name |

**Response (200):** A `.zip` file download with:
- `index.html` — self-contained story (template.html with `STORY_DATA` injected)
- `assets/<path>` — all files from the project's `assets/` directory (subdirectory structure preserved)

**Content-Disposition:** `attachment; filename=<name>.zip`

**Error handling:**
- `404` — `"Project not found"` if `project.json` does not exist

**Export pipeline (in order):**

1. Load manifest + merge ALL group files from `groups/`
2. **URL rewriting** — Walk the entire JSON tree recursively. Replace every string matching `/api/assets/<safe>/(...)` with `assets/$1` so that asset references point to local files inside the ZIP
3. Load `frontend/editor/template.html`
4. Replace the placeholder `// __STORY_DATA_PLACEHOLDER__` with `const STORY_DATA = <JSON>;`
5. Create an in-memory ZIP containing:
   - The modified `index.html`
   - Every file from `assets/` via `os.walk`, preserving subdirectory structure at `assets/<relative_path>`
6. Stream the ZIP to the client via `StreamingResponse`

---

### 15. Generate Preview

```
GET /api/preview/{name}
```

| Path param | Description |
|------------|-------------|
| `name` | Project folder name |

**Response (200):**
```json
{ "url": "/api/preview-file/MyGame" }
```

**Error handling:**
- `404` — `"Project not found"` if `project.json` does not exist

**Preview pipeline:**
1. Load `project.json` from disk
2. Load `frontend/editor/template.html`
3. Replace placeholder with `STORY_DATA` (same injection as export, but **no** URL rewriting — asset URLs remain as `/api/assets/...` for live server access)
4. Write the result to `preview.html` inside the project directory (overwrites any existing)
5. Return a JSON object with a URL to serve the file

---

### 16. Serve Preview File

```
GET /api/preview-file/{name}
```

| Path param | Description |
|------------|-------------|
| `name` | Project folder name |

**Response (200):** `preview.html` served as `text/html`.

**Error handling:**
- `404` — `"Preview not found"` if `preview.html` has not been generated yet

---

## Asset System

### Tree response
`GET /api/assets/{name}` returns a hierarchical tree. Folders sorted first, then files, both alphabetically.

### Upload flow
`POST /api/assets/{name}/upload` with optional `folder` form field → writes bytes to `assets/<folder>/<file>` → returns JSON with access URL.

### Folder CRUD
| Action | Endpoint |
|--------|----------|
| Create | `POST /api/assets/{name}/folder` |
| Rename | `PUT /api/assets/{name}/rename` |
| Move | `PUT /api/assets/{name}/move` |
| Copy | `POST /api/assets/{name}/copy` |
| Delete | `DELETE /api/assets/{name}/{filepath:path}` (recursive) |

### Serve flow
`GET /api/assets/{name}/{filepath:path}` → returns raw file via `FileResponse`.

### URL rewriting (export only)
On export, all asset URLs in the project JSON are rewritten from `/api/assets/MyGame/bg/castle.png` to `assets/bg/castle.png` so they resolve correctly inside the ZIP. Preview does **not** rewrite URLs because it expects the live server to be running.

### Asset directory structure (with subfolders)
```
backend/data/
  MyGame/
    manifest.json
    groups/
      side_panel.json
      chapter_1.json
    assets/
      icon.png
      bg/
        forest.png
        castle/
          tower.png
      music/
        theme.ogg
```

## File Layout on Disk
```
backend/
  main.py                  ← this file
  schemas/
    project.py             ← Pydantic schemas
  data/
    <GameName>/
      manifest.json        ← project metadata, group list, node→group mapping
      groups/
        <group_id>.json    ← full node data for each group
      preview.html         ← generated by /api/preview/{name}
      assets/              ← uploaded assets (can have subfolders)
        icon.png
        bg/
          forest.png
frontend/
  editor/
    template.html          ← HTML template (placeholder: // __STORY_DATA_PLACEHOLDER__)
    index.html             ← SPA entry point (served at /editor/)
    app.js                 ← main editor logic
```
