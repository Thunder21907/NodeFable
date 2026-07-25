# Backend API Reference

**File:** `backend/main.py` (233 lines)  
**Framework:** FastAPI  
**Data:** Flat JSON files under `backend/data/<GameName>/`

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

### `SaveRequest` (line 22–25)

| Field | Type | Constraints | Default | Description |
|-------|------|-------------|---------|-------------|
| `name` | `str` | `min_length=1, max_length=100` | (required) | Project name, used as folder name |
| `variables` | `Dict[str, VariableValue]` | — | `{}` | Initial story variables |
| `nodes` | `List[NodeData]` | — | `[]` | All story nodes |

`VariableValue = Union[bool, int, str]` (defined in `backend/schemas/project.py:5`).

### `ProjectSchema` (response model for `/api/load`)

| Field | Type | Description |
|-------|------|-------------|
| `variables` | `Dict[str, VariableValue]` | The project's variable definitions |
| `nodes` | `List[NodeData]` | All story nodes with choices, actions, on_enter, is_start |

See `docs/guide.md` for full schema detail of `NodeData`, `ChoiceLink`, `ActionPair`, `ActionData`, `OnEnter`.

## Helper Functions

### `safe_name(name: str) -> str` (line 27–28)

Sanitizes a project name by replacing `/` and `\` with `_`. Prevents directory traversal. Used by every endpoint that touches the filesystem.

## API Endpoints

### Endpoint Summary

| # | Method | Path | Purpose | Line |
|---|--------|------|---------|------|
| 1 | `GET` | `/` | Health check | 32 |
| 2 | `POST` | `/api/save` | Save a project | 36 |
| 3 | `GET` | `/api/saves` | List saved projects | 56 |
| 4 | `GET` | `/api/load` | Load a project | 71 |
| 5 | `GET` | `/api/assets/{name}` | List assets for a project | 84 |
| 6 | `POST` | `/api/assets/{name}` | Upload an asset | 97 |
| 7 | `GET` | `/api/assets/{name}/{filename}` | Serve an asset file | 117 |
| 8 | `DELETE` | `/api/assets/{name}/{filename}` | Delete an asset | 126 |
| 9 | `GET` | `/api/export/{name}` | Download project as ZIP | 148 |
| 10 | `GET` | `/api/preview/{name}` | Generate preview.html in project dir | 199 |
| 11 | `GET` | `/api/preview-file/{name}` | Serve generated preview.html | 224 |

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
3. Writes `project.json` containing `name`, `variables`, and serialised `nodes`
4. Overwrites any existing project with the same name

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

### 4. Load Project

```
GET /api/load?name=<project_name>
```

**Line:** 69–80

**Query parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | `string` | Yes | Project folder name |

**Response (200)** — `ProjectSchema`:
```json
{
  "variables": { "hp": 100 },
  "nodes": [ { "id": "node_1", "title": "...", ... } ]
}
```

**Error handling:**
- `404` — `"Project '<name>' not found"` if `project.json` does not exist
- `500` — `"Failed to load project: <reason>"` on JSON parse error or other exception

---

### 5. List Assets

```
GET /api/assets/{name}
```

**Line:** 82–93

| Path param | Description |
|------------|-------------|
| `name` | Project folder name |

**Response (200):**
```json
{ "assets": ["bg.png", "music.ogg"] }
```
Returns empty array if the `assets/` directory does not exist.

**Error handling:** None explicit (returns `{"assets": []}` if missing).

---

### 6. Upload Asset

```
POST /api/assets/{name}
```

**Line:** 95–113

| Path param | Description |
|------------|-------------|
| `name` | Project folder name |

**Request:** `multipart/form-data` with a field `file` (any file type).

**Response (200):**
```json
{ "status": "ok", "filename": "bg.png", "url": "/api/assets/MyGame/bg.png" }
```

**Error handling:**
- `404` — `"Project not found or assets directory missing"` if the assets directory does not exist
- `400` — `"Invalid filename"` if the uploaded file has no filename after sanitization
- `500` — `"Failed to upload asset: <reason>"` on write failure

**Behavior:**
1. Sanitizes filename (replaces `/` and `\` with `_`)
2. Overwrites any existing file with the same name

---

### 7. Serve Asset

```
GET /api/assets/{name}/{filename}
```

**Line:** 115–122

| Path param | Description |
|------------|-------------|
| `name` | Project folder name |
| `filename` | Asset filename |

**Response (200):** The raw file bytes (`FileResponse`). MIME type is auto-detected by FastAPI/Starlette.

**Error handling:**
- `404` — `"Asset not found"` if the file does not exist

**Security:** Both `name` and `filename` are sanitized via `safe_name()` to prevent path traversal.

---

### 8. Delete Asset

```
DELETE /api/assets/{name}/{filename}
```

**Line:** 126–146

| Path param | Description |
|------------|-------------|
| `name` | Project folder name |
| `filename` | Asset filename to delete |

**Response (200):**
```json
{ "status": "ok", "assets": ["remaining_file1.png", "remaining_file2.png"] }
```
Returns the updated list of remaining assets after deletion.

**Error handling:**
- `400` — `"Invalid filename"` if the filename is empty after sanitization
- `404` — `"Asset not found"` if the file does not exist
- `500` — `"Failed to delete asset: <reason>"` on filesystem error

**Behavior:**
1. Sanitizes both `name` and `filename` via `safe_name()`
2. Deletes the file from `<DATA_DIR>/<name>/assets/<filename>`
3. Returns the updated asset list

---

### 9. Export Project (ZIP Download)

```
GET /api/export/{name}
```

**Line:** 148–196

| Path param | Description |
|------------|-------------|
| `name` | Project folder name |

**Response (200):** A `.zip` file download with:
- `index.html` — self-contained story (template.html with `STORY_DATA` injected)
- `assets/<filename>` — all files from the project's `assets/` directory

**Content-Disposition:** `attachment; filename=<name>.zip`

**Error handling:**
- `404` — `"Project not found"` if `project.json` does not exist

**Export pipeline (in order):**

1. Load `project.json` from disk
2. **URL rewriting** — Walk the entire JSON tree recursively. Replace every string matching `/api/assets/<safe>/(...)` with `assets/$1` so that asset references point to local files inside the ZIP (lines 159–171)
3. Load `frontend/editor/template.html`
4. Replace the placeholder `// __STORY_DATA_PLACEHOLDER__` with `const STORY_DATA = <JSON>;`
5. Create an in-memory ZIP containing:
   - The modified `index.html`
   - Every file from `assets/` at path `assets/<filename>`
6. Stream the ZIP to the client via `StreamingResponse`

---

### 10. Generate Preview

```
GET /api/preview/{name}
```

**Line:** 199–221

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

### 11. Serve Preview File

```
GET /api/preview-file/{name}
```

**Line:** 224–230

| Path param | Description |
|------------|-------------|
| `name` | Project folder name |

**Response (200):** `preview.html` served as `text/html`.

**Error handling:**
- `404` — `"Preview not found"` if `preview.html` has not been generated yet

---

## Asset Handling Summary

### Upload flow
`POST /api/assets/{name}` → sanitizes filename → writes bytes to `<DATA_DIR>/<name>/assets/<file>` → returns JSON with access URL.

### Serve flow
`GET /api/assets/{name}/{filename}` → sanitizes both params → returns raw file via `FileResponse`.

### URL rewriting (export only)
On export, all asset URLs in the project JSON are rewritten from `/api/assets/MyGame/bg.png` to `assets/bg.png` so they resolve correctly inside the ZIP. Preview does **not** rewrite URLs because it expects the live server to be running.

### Asset directory structure
```
backend/data/
  MyGame/
    project.json
    assets/
      bg.png
      music.ogg
```

## File Layout on Disk
```
backend/
  main.py                  ← this file
  schemas/
    project.py             ← Pydantic schemas
  data/
    <GameName>/
      project.json         ← story data
      preview.html         ← generated by /api/preview/{name}
      assets/
        <filename>         ← uploaded assets
frontend/
  editor/
    template.html          ← HTML template (placeholder: // __STORY_DATA_PLACEHOLDER__)
    index.html             ← SPA entry point (served at /editor/)
    app.js                 ← main editor logic
```
