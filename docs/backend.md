# Backend API Reference

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

`NodeData` now includes a `group: str` field (default `"side_panel"`). Nodes are partitioned by group on save.

### `ProjectSchema` (response model for `/api/load`)

| Field | Type | Description |
|-------|------|-------------|
| `variables` | `Dict[str, VariableValue]` | The project's variable definitions |
| `nodes` | `List[NodeData]` | All story nodes with choices, on_enter, is_start |

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
  "nodes": [ { "id": "node_1", "title": "...", "group": "chapter_1", ... } ]
}
```

**Error handling:**
- `404` — `"Project '<name>' not found"` if project does not exist
- `500` — `"Failed to load project: <reason>"` on error

**Behavior:**
- When `groups` is specified, only reads the corresponding group files from `groups/<id>.json`
- When `groups` is omitted, merges all group files into one response
- Each node now includes a `group` field indicating which group it belongs to

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
| `filepath` | Relative path within assets (e.g. `bg/forest.png`) |

**Response (200):** Raw file bytes (`FileResponse`).

**Error handling:**
- `404` — `"Asset not found"`
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
