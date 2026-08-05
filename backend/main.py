from fastapi import FastAPI, HTTPException, Query, UploadFile, File
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field
import json
import os
import io
import zipfile
import re
import shutil
from typing import Dict, List, Optional

from backend.schemas.project import ProjectSchema, NodeData, VariableValue, GroupSlugInfo

app = FastAPI()

DATA_DIR = "backend/data"
os.makedirs(DATA_DIR, exist_ok=True)

FRONTEND_DIR = "frontend/editor"

MANIFEST_VERSION = 2


class SaveRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    variables: Dict[str, VariableValue] = Field(default_factory=dict)
    setup: Dict[str, VariableValue] = Field(default_factory=dict, description="Immutable boot-time constants (setup scope)")
    nodes: List[NodeData] = Field(default_factory=list)
    groups: Optional[List[Dict]] = Field(None, description="Group metadata with labels")


def safe_name(name: str) -> str:
    name = name.replace('/', '_').replace('\\', '_')
    name = re.sub(r'[^\w\s\-.]', '', name)
    return name.strip()


# ---------------------------------------------------------------------------
# Manifest / Group helpers
# ---------------------------------------------------------------------------

def _project_dir(name: str) -> str:
    return os.path.join(DATA_DIR, safe_name(name))


def _groups_dir(name: str) -> str:
    return os.path.join(_project_dir(name), "groups")


def _manifest_path(name: str) -> str:
    return os.path.join(_project_dir(name), "manifest.json")


def _legacy_path(name: str) -> str:
    return os.path.join(_project_dir(name), "project.json")


def _group_path(name: str, group_id: str) -> str:
    safe = safe_name(group_id) or "unnamed"
    return os.path.join(_groups_dir(name), f"{safe}.json")


def _ensure_project_dirs(name: str):
    os.makedirs(_project_dir(name), exist_ok=True)
    os.makedirs(_groups_dir(name), exist_ok=True)
    os.makedirs(os.path.join(_project_dir(name), "assets"), exist_ok=True)


# ---------------------------------------------------------------------------
# Migration helpers
# ---------------------------------------------------------------------------

def _needs_migration(name: str) -> bool:
    """True if the project exists only in legacy format (project.json / version 1)."""
    pdir = _project_dir(name)
    if not os.path.isdir(pdir):
        return False
    if os.path.exists(_manifest_path(name)):
        return False
    return os.path.exists(_legacy_path(name))


def _build_slug_info(nodes: list) -> list:
    """Build slug_ids entries with {slug_id, connections} from a list of node dicts/models."""
    result = []
    for n in nodes:
        if isinstance(n, dict):
            sid = n.get("id", "")
            choices = n.get("choices", [])
        else:
            sid = getattr(n, "id", "")
            choices = getattr(n, "choices", [])
        if not sid:
            continue
        connections = []
        for c in choices:
            tid = c.get("target_node_id", "") if isinstance(c, dict) else getattr(c, "target_node_id", "")
            if tid:
                connections.append(tid)
        result.append({"slug_id": sid, "connections": connections})
    return result


def _convert_slug_ids_if_old(slug_ids: list, nodes: list = None) -> list:
    """Convert old flat string slug_ids to new {slug_id, connections} format if needed."""
    if not slug_ids:
        return []
    if isinstance(slug_ids[0], dict):
        return slug_ids
    if nodes is None:
        return [{"slug_id": sid, "connections": []} for sid in slug_ids]
    nodes_by_id = {}
    for n in nodes:
        sid = n.get("id", "") if isinstance(n, dict) else getattr(n, "id", "")
        if sid:
            nodes_by_id[sid] = n
    result = []
    for sid in slug_ids:
        node = nodes_by_id.get(sid, {})
        choices = node.get("choices", []) if isinstance(node, dict) else getattr(node, "choices", [])
        connections = [c.get("target_node_id", "") if isinstance(c, dict) else getattr(c, "target_node_id", "") for c in choices]
        connections = [c for c in connections if c]
        result.append({"slug_id": sid, "connections": connections})
    return result


def _migrate_manifest_slug_ids(manifest: dict, name: str):
    """Upgrade manifest slug_ids from flat strings to {slug_id, connections} objects.
    Reads group files to compute connections. Only modifies manifest in memory."""
    groups = manifest.get("groups", [])
    needs_migration = False
    for g in groups:
        slug_ids = g.get("slug_ids", [])
        if slug_ids and isinstance(slug_ids[0], str):
            needs_migration = True
            break
    if not needs_migration:
        return
    for g in groups:
        slug_ids = g.get("slug_ids", [])
        if not slug_ids or not isinstance(slug_ids[0], str):
            continue
        gpath = _group_path(name, g["id"])
        nodes = []
        if os.path.exists(gpath):
            with open(gpath, "r", encoding="utf-8") as gf:
                gdata = json.load(gf)
            nodes = gdata.get("nodes", [])
        nodes_by_id = {n.get("id", ""): n for n in nodes if isinstance(n, dict)}
        new_slug_ids = []
        for sid in slug_ids:
            node = nodes_by_id.get(sid, {})
            choices = node.get("choices", []) if isinstance(node, dict) else []
            connections = [c.get("target_node_id", "") for c in choices if isinstance(c, dict) and c.get("target_node_id")]
            new_slug_ids.append({"slug_id": sid, "connections": connections})
        g["slug_ids"] = new_slug_ids


def _migrate_legacy_project(name: str):
    """Convert old single project.json into manifest + per-group files."""
    src = _legacy_path(name)
    with open(src, "r", encoding="utf-8") as f:
        data = json.load(f)

    nodes: list = data.get("nodes", [])
    variables: dict = data.get("variables", {})

    side_panel_nodes = [n for n in nodes if n.get("id") == "side_panel"]
    other_nodes = [n for n in nodes if n.get("id") != "side_panel"]

    groups = []

    if side_panel_nodes:
        for n in side_panel_nodes:
            n["group"] = "side_panel"
        gpath = _group_path(name, "side_panel")
        os.makedirs(os.path.dirname(gpath), exist_ok=True)
        with open(gpath, "w", encoding="utf-8") as f:
            json.dump({
                "group_id": "side_panel",
                "label": "Side Panel",
                "node_count": len(side_panel_nodes),
                "slug_ids": _build_slug_info(side_panel_nodes),
                "nodes": side_panel_nodes
            }, f, indent=4)
        groups.append({
            "id": "side_panel",
            "label": "Side Panel",
            "node_count": len(side_panel_nodes),
            "slug_ids": _build_slug_info(side_panel_nodes)
        })

    if other_nodes:
        for n in other_nodes:
            n["group"] = "default"
        gpath = _group_path(name, "default")
        os.makedirs(os.path.dirname(gpath), exist_ok=True)
        with open(gpath, "w", encoding="utf-8") as f:
            json.dump({
                "group_id": "default",
                "label": "Default",
                "node_count": len(other_nodes),
                "slug_ids": _build_slug_info(other_nodes),
                "nodes": other_nodes
            }, f, indent=4)
        groups.append({
            "id": "default",
            "label": "Default",
            "node_count": len(other_nodes),
            "slug_ids": _build_slug_info(other_nodes)
        })

    manifest = {
        "name": safe_name(name),
        "version": MANIFEST_VERSION,
        "variables": variables,
        "setup": {},
        "groups": groups
    }
    with open(_manifest_path(name), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=4)

    os.remove(src)


def _load_manifest(name: str) -> dict:
    """Load manifest.json, auto-migrating if needed. Appends orphaned group
    files (present on disk but missing from the manifest) to the manifest."""
    pdir = _project_dir(name)
    if not os.path.isdir(pdir):
        raise HTTPException(status_code=404, detail=f"Project '{name}' not found")

    if _needs_migration(name):
        _migrate_legacy_project(name)

    mpath = _manifest_path(name)
    if not os.path.exists(mpath):
        raise HTTPException(status_code=404, detail=f"Project '{name}' not found")

    with open(mpath, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    # Scan groups directory for files not listed in the manifest
    groups_dir = _groups_dir(name)
    if os.path.isdir(groups_dir):
        existing_ids = {g["id"] for g in manifest.get("groups", [])}
        for fname in os.listdir(groups_dir):
            if not fname.endswith(".json"):
                continue
            gid = fname[:-5]
            gpath = os.path.join(groups_dir, fname)
            try:
                with open(gpath, "r", encoding="utf-8") as gf:
                    gdata = json.load(gf)
                file_node_count = gdata.get("node_count", len(gdata.get("nodes", [])))
                file_slug_ids = _convert_slug_ids_if_old(
                    gdata.get("slug_ids", [n.get("id", "") for n in gdata.get("nodes", [])]),
                    gdata.get("nodes", [])
                )
                file_label = gdata.get("label", gid.replace("_", " ").title())

                if gid in existing_ids:
                    # Sync manifest entry if the file has data the manifest is missing
                    for g in manifest.setdefault("groups", []):
                        if g["id"] == gid:
                            if file_node_count > 0 and (g.get("node_count", 0) == 0 or not g.get("slug_ids")):
                                g["node_count"] = file_node_count
                                g["slug_ids"] = file_slug_ids
                                g["label"] = file_label
                            break
                else:
                    # Orphaned group file — append to manifest
                    manifest.setdefault("groups", []).append({
                        "id": gid,
                        "label": file_label,
                        "node_count": file_node_count,
                        "slug_ids": file_slug_ids
                    })
                    existing_ids.add(gid)
            except (json.JSONDecodeError, KeyError):
                continue

    _migrate_manifest_slug_ids(manifest, name)
    return manifest


def _load_group_nodes(name: str, group_id: str) -> list:
    """Load nodes for a single group. Returns [] if the group file is missing."""
    gpath = _group_path(name, group_id)
    if not os.path.exists(gpath):
        return []
    with open(gpath, "r", encoding="utf-8") as f:
        data = json.load(f)
    return data.get("nodes", [])


def _load_all_nodes(name: str) -> tuple[dict, dict, list]:
    """Load setup, variables and all nodes from all groups. Returns (setup, variables, nodes)."""
    manifest = _load_manifest(name)
    setup = manifest.get("setup", {})
    variables = manifest.get("variables", {})
    all_nodes = []
    for g in manifest.get("groups", []):
        all_nodes.extend(_load_group_nodes(name, g["id"]))
    return setup, variables, all_nodes


def _load_specific_groups(name: str, group_ids: list[str]) -> tuple[dict, dict, list]:
    """Load setup, variables and only nodes from the requested groups. Returns (setup, variables, nodes)."""
    manifest = _load_manifest(name)
    setup = manifest.get("setup", {})
    variables = manifest.get("variables", {})
    all_nodes = []
    seen = set()
    for gid in group_ids:
        if gid in seen:
            continue
        seen.add(gid)
        all_nodes.extend(_load_group_nodes(name, gid))
    return setup, variables, all_nodes


def _save_manifest_and_groups(name: str, variables: dict, nodes: list, groups_meta: list = None, setup: dict = None):
    """Partition nodes by group, write per-group files, and save manifest."""
    safe = safe_name(name)
    _ensure_project_dirs(safe)

    grouped: dict[str, list] = {}

    for n in nodes:
        gid = n.get("group", "side_panel") if isinstance(n, dict) else getattr(n, "group", "side_panel")
        if isinstance(n, dict):
            sid = n.get("id", "")
        else:
            sid = n.id
        grouped.setdefault(gid, []).append(n)

    # Ensure side_panel group exists
    if "side_panel" not in grouped:
        grouped["side_panel"] = []

    # Build a label lookup from groups_meta
    label_lookup = {}
    if groups_meta:
        for g in groups_meta:
            if isinstance(g, dict):
                label_lookup[g.get("id", "")] = g.get("label", "")

    groups_list = []
    for gid, g_nodes in grouped.items():
        gpath = _group_path(safe, gid)
        os.makedirs(os.path.dirname(gpath), exist_ok=True)
        serialized = [n.model_dump() if not isinstance(n, dict) else n for n in g_nodes]
        label = label_lookup.get(gid, gid.replace("_", " ").title())
        with open(gpath, "w", encoding="utf-8") as f:
            json.dump({
                "group_id": gid,
                "label": label,
                "node_count": len(g_nodes),
                "slug_ids": _build_slug_info(g_nodes),
                "nodes": serialized
            }, f, indent=4)
        groups_list.append({
            "id": gid,
            "label": label,
            "node_count": len(g_nodes),
            "slug_ids": _build_slug_info(g_nodes)
        })

    # Preserve groups from groups_meta that have no nodes in the payload
    # (e.g. newly created groups, or unloaded groups whose data must not be overwritten)
    if groups_meta:
        written_gids = set(grouped.keys())
        for g in groups_meta:
            gid = g.get("id", "") if isinstance(g, dict) else ""
            if not gid or gid in written_gids:
                continue
            label = g.get("label", "") if isinstance(g, dict) else ""
            if not label:
                label = gid.replace("_", " ").title()
            gpath = _group_path(safe, gid)
            os.makedirs(os.path.dirname(gpath), exist_ok=True)
            if os.path.exists(gpath):
                # File exists — read real metadata, do NOT overwrite
                with open(gpath, "r", encoding="utf-8") as ef:
                    edata = json.load(ef)
                g_node_count = edata.get("node_count", len(edata.get("nodes", [])))
                g_slug_ids = _convert_slug_ids_if_old(
                    edata.get("slug_ids", [n.get("id", "") for n in edata.get("nodes", [])]),
                    edata.get("nodes", [])
                )
                g_label = edata.get("label", "") or label
            else:
                # New group — write an empty file once
                with open(gpath, "w", encoding="utf-8") as nf:
                    json.dump({
                        "group_id": gid,
                        "label": label,
                        "node_count": 0,
                        "slug_ids": [],
                        "nodes": []
                    }, nf, indent=4)
                g_node_count = 0
                g_slug_ids = []
                g_label = label
            groups_list.append({
                "id": gid,
                "label": g_label,
                "node_count": g_node_count,
                "slug_ids": g_slug_ids
            })

    manifest = {
        "name": safe,
        "version": MANIFEST_VERSION,
        "variables": variables,
        "setup": setup or {},
        "groups": groups_list
    }
    # Drop the redundant node_to_group field if it ever lingers in memory
    manifest.pop("node_to_group", None)
    with open(_manifest_path(safe), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=4)


# ---------------------------------------------------------------------------
# Asset URL rewriting (shared by export / preview)
# ---------------------------------------------------------------------------

def _rewrite_asset_urls(obj: any, safe: str):
    pattern = re.compile(r'/api/assets/' + re.escape(safe) + r'/([^)"\s,}]+)')
    def _walk(o):
        if isinstance(o, dict):
            for k, v in o.items():
                if isinstance(v, str):
                    o[k] = pattern.sub(r'assets/\1', v)
                else:
                    _walk(v)
        elif isinstance(o, list):
            for item in o:
                _walk(item)
    _walk(obj)


def _build_story_html(project_data: dict) -> str:
    """Inject project data into template.html and inline CSS."""
    template_path = os.path.join(FRONTEND_DIR, "template.html")
    with open(template_path, "r", encoding="utf-8") as f:
        template = f.read()

    story_json = json.dumps(project_data, indent=2)
    template = template.replace(
        '// __STORY_DATA_PLACEHOLDER__',
        'const STORY_DATA = ' + story_json + ';'
    )

    css_path = os.path.join(FRONTEND_DIR, "template_styles.css")
    if os.path.exists(css_path):
        with open(css_path, "r", encoding="utf-8") as f:
            css_content = f.read()
        template = template.replace(
            '<link rel="stylesheet" href="template_styles.css">',
            f'<style>\n{css_content}\n</style>'
        )
    return template


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/")
async def read_root():
    return {"message": "NodeFable API is running"}


# --- Save ---

@app.post("/api/save")
async def save_project(req: SaveRequest):
    try:
        name = safe_name(req.name)
        _ensure_project_dirs(name)

        variables = req.variables
        setup = req.setup
        nodes = [n.model_dump() for n in req.nodes]
        groups_meta = req.groups

        _save_manifest_and_groups(name, variables, nodes, groups_meta, setup)
        return {"status": "ok", "name": name}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save project: {str(e)}")


# --- List saves ---

@app.get("/api/saves")
async def list_saves():
    try:
        files = []
        for entry in os.listdir(DATA_DIR):
            pdir = os.path.join(DATA_DIR, entry)
            if not os.path.isdir(pdir):
                continue
            # Check for manifest.json (new) or project.json (legacy)
            check = _manifest_path(entry) if os.path.exists(os.path.join(pdir, "manifest.json")) else _legacy_path(entry)
            if os.path.exists(check):
                mtime = os.path.getmtime(check)
                files.append({"name": entry, "mtime": mtime})
        files.sort(key=lambda f: f["mtime"], reverse=True)
        return {"saves": files}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# --- Load manifest only (lightweight) ---

@app.get("/api/load/manifest")
async def load_manifest(name: str = Query(..., description="Project folder name")):
    try:
        manifest = _load_manifest(name)
        return manifest
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load manifest: {str(e)}")


# --- Load project (full node data, optional groups filter) ---

@app.get("/api/load", response_model=ProjectSchema)
async def load_project(
    name: str = Query(..., description="Project folder name"),
    groups: Optional[str] = Query(None, description="Comma-separated group IDs to load")
):
    try:
        if groups:
            gids = [g.strip() for g in groups.split(",") if g.strip()]
            setup_vars, variables, nodes = _load_specific_groups(name, gids)
        else:
            setup_vars, variables, nodes = _load_all_nodes(name)
        return ProjectSchema(variables=variables, setup=setup_vars, nodes=nodes)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load project: {str(e)}")


# ---------------------------------------------------------------------------
# Assets helpers
# ---------------------------------------------------------------------------

def _build_asset_tree(assets_dir: str, prefix: str = "", project_name: str = None) -> list:
    if not os.path.isdir(assets_dir):
        return []
    if project_name is None:
        project_name = os.path.basename(os.path.dirname(assets_dir))
    entries = []
    try:
        names = sorted(os.listdir(assets_dir))
    except OSError:
        return []
    dirs = sorted([n for n in names if os.path.isdir(os.path.join(assets_dir, n))])
    files = sorted([n for n in names if os.path.isfile(os.path.join(assets_dir, n))])
    for d in dirs:
        sub_prefix = f"{prefix}/{d}" if prefix else d
        children = _build_asset_tree(os.path.join(assets_dir, d), sub_prefix, project_name)
        entries.append({
            "name": d,
            "type": "folder",
            "children": children
        })
    for f in files:
        path = f"{prefix}/{f}" if prefix else f
        fpath = os.path.join(assets_dir, f)
        size = os.path.getsize(fpath) if os.path.exists(fpath) else 0
        entries.append({
            "name": f,
            "type": "file",
            "file_size": size,
            "url": f"/api/assets/{project_name}/{path}"
        })
    return entries


@app.get("/api/assets/{name}")
async def list_assets(name: str):
    safe = safe_name(name)
    assets_dir = os.path.join(DATA_DIR, safe, "assets")
    tree = _build_asset_tree(assets_dir)
    return {"tree": tree}


@app.post("/api/assets/{name}/upload")
async def upload_asset(name: str, file: UploadFile = File(...), folder: str = ""):
    safe = safe_name(name)
    assets_dir = os.path.join(DATA_DIR, safe, "assets")
    if not os.path.isdir(assets_dir):
        raise HTTPException(status_code=404, detail="Project not found or assets directory missing")

    filename = file.filename or "unnamed"
    # Allow subdirectory slashes in filename from browser — normalize
    filename = filename.replace('\\', '/')
    # Strip any leading .. or absolute path shenanigans
    filename = os.path.normpath(filename).lstrip('/').lstrip('.')
    if not filename:
        raise HTTPException(status_code=400, detail="Invalid filename")

    # If folder param provided, prepend it
    target_folder = folder.replace('\\', '/').strip('/') if folder else ""
    if target_folder:
        target_dir = os.path.join(assets_dir, target_folder)
        os.makedirs(target_dir, exist_ok=True)
    else:
        target_dir = assets_dir

    filepath = os.path.join(target_dir, os.path.basename(filename))
    try:
        content = await file.read()
        with open(filepath, "wb") as f:
            f.write(content)
        rel_path = f"{target_folder}/{os.path.basename(filename)}" if target_folder else os.path.basename(filename)
        url = f"/api/assets/{safe}/{rel_path}"
        return {"status": "ok", "filename": os.path.basename(filename), "url": url}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to upload asset: {str(e)}")


class FolderCreateRequest(BaseModel):
    path: str


@app.post("/api/assets/{name}/folder")
async def create_folder(name: str, req: FolderCreateRequest):
    safe = safe_name(name)
    assets_dir = os.path.join(DATA_DIR, safe, "assets")
    target = os.path.join(assets_dir, req.path.strip('/'))
    try:
        os.makedirs(target, exist_ok=True)
        return {"status": "ok", "path": req.path}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create folder: {str(e)}")


class RenameRequest(BaseModel):
    path: str
    new_name: str


@app.put("/api/assets/{name}/rename")
async def rename_asset(name: str, req: RenameRequest):
    safe = safe_name(name)
    assets_dir = os.path.join(DATA_DIR, safe, "assets")
    old_path = os.path.normpath(os.path.join(assets_dir, req.path.strip('/')))
    if not old_path.startswith(os.path.normpath(assets_dir)):
        raise HTTPException(status_code=400, detail="Invalid path")
    if not os.path.exists(old_path):
        raise HTTPException(status_code=404, detail="Path not found")
    parent = os.path.dirname(old_path)
    new_path = os.path.join(parent, req.new_name)
    if os.path.exists(new_path):
        raise HTTPException(status_code=409, detail="Target already exists")
    try:
        os.rename(old_path, new_path)
        return {"status": "ok"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to rename: {str(e)}")


class MoveRequest(BaseModel):
    from_path: str
    to_path: str


@app.put("/api/assets/{name}/move")
async def move_asset(name: str, req: MoveRequest):
    safe = safe_name(name)
    assets_dir = os.path.join(DATA_DIR, safe, "assets")
    src = os.path.normpath(os.path.join(assets_dir, req.from_path.strip('/')))
    dst = os.path.normpath(os.path.join(assets_dir, req.to_path.strip('/')))
    if not src.startswith(os.path.normpath(assets_dir)) or not dst.startswith(os.path.normpath(assets_dir)):
        raise HTTPException(status_code=400, detail="Invalid path")
    if not os.path.exists(src):
        raise HTTPException(status_code=404, detail="Source not found")
    if os.path.exists(dst):
        raise HTTPException(status_code=409, detail="Target already exists")
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    try:
        os.rename(src, dst)
        return {"status": "ok"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to move: {str(e)}")


class CopyRequest(BaseModel):
    from_path: str
    to_path: str


@app.post("/api/assets/{name}/copy")
async def copy_asset(name: str, req: CopyRequest):
    safe = safe_name(name)
    assets_dir = os.path.join(DATA_DIR, safe, "assets")
    src = os.path.normpath(os.path.join(assets_dir, req.from_path.strip('/')))
    dst = os.path.normpath(os.path.join(assets_dir, req.to_path.strip('/')))
    if not src.startswith(os.path.normpath(assets_dir)) or not dst.startswith(os.path.normpath(assets_dir)):
        raise HTTPException(status_code=400, detail="Invalid path")
    if not os.path.exists(src):
        raise HTTPException(status_code=404, detail="Source not found")
    if os.path.exists(dst):
        raise HTTPException(status_code=409, detail="Target already exists")
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    try:
        if os.path.isdir(src):
            shutil.copytree(src, dst)
        else:
            shutil.copy2(src, dst)
        return {"status": "ok"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to copy: {str(e)}")


class DeleteRequest(BaseModel):
    path: str


@app.delete("/api/assets/{name}/{filepath:path}")
async def delete_asset(name: str, filepath: str):
    safe = safe_name(name)
    assets_dir = os.path.join(DATA_DIR, safe, "assets")
    target = os.path.normpath(os.path.join(assets_dir, filepath.strip('/')))
    if not target.startswith(os.path.normpath(assets_dir)):
        raise HTTPException(status_code=400, detail="Invalid path")
    if not os.path.exists(target):
        raise HTTPException(status_code=404, detail="Path not found")
    try:
        deleted_count = 0
        if os.path.isdir(target):
            for root, dirs, files in os.walk(target, topdown=False):
                for name_file in files:
                    os.remove(os.path.join(root, name_file))
                    deleted_count += 1
                for dir_name in dirs:
                    os.rmdir(os.path.join(root, dir_name))
            os.rmdir(target)
        else:
            os.remove(target)
            deleted_count = 1
        return {"status": "ok", "deleted_count": deleted_count}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete: {str(e)}")


@app.get("/api/assets/{name}/{filepath:path}")
async def get_asset(name: str, filepath: str):
    safe = safe_name(name)
    assets_dir = os.path.join(DATA_DIR, safe, "assets")
    safe_path = filepath.strip('/')
    target = os.path.normpath(os.path.join(assets_dir, safe_path))
    if not target.startswith(os.path.normpath(assets_dir)):
        raise HTTPException(status_code=400, detail="Invalid path")
    if not os.path.exists(target):
        raise HTTPException(status_code=404, detail="Asset not found")
    return FileResponse(target)


# --- Export ---

@app.get("/api/export/{name}")
async def export_project(name: str):
    safe = safe_name(name)
    project_dir = _project_dir(name)

    setup, variables, nodes = _load_all_nodes(name)
    project_data = {
        "name": safe,
        "variables": variables,
        "setup": setup,
        "nodes": [n.model_dump() if not isinstance(n, dict) else n for n in nodes]
    }

    _rewrite_asset_urls(project_data, safe)

    template = _build_story_html(project_data)

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("index.html", template)

        assets_dir = os.path.join(project_dir, "assets")
        if os.path.isdir(assets_dir):
            for root, dirs, files in os.walk(assets_dir):
                for fname in files:
                    fpath = os.path.join(root, fname)
                    arcname = os.path.join("assets", os.path.relpath(fpath, assets_dir))
                    zf.write(fpath, arcname)

    zip_buffer.seek(0)
    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename={safe}.zip"}
    )


# --- Preview ---

@app.get("/api/preview/{name}")
async def preview_project(name: str):
    safe = safe_name(name)
    project_dir = _project_dir(name)

    setup, variables, nodes = _load_all_nodes(name)
    project_data = {
        "name": safe,
        "variables": variables,
        "setup": setup,
        "nodes": [n.model_dump() if not isinstance(n, dict) else n for n in nodes]
    }

    template = _build_story_html(project_data)

    preview_path = os.path.join(project_dir, "preview.html")
    with open(preview_path, "w", encoding="utf-8") as f:
        f.write(template)

    return {"url": f"/api/preview-file/{safe}"}


@app.get("/api/preview-file/{name}")
async def preview_file(name: str):
    safe = safe_name(name)
    preview_path = os.path.join(DATA_DIR, safe, "preview.html")
    if not os.path.exists(preview_path):
        raise HTTPException(status_code=404, detail="Preview not found")
    return FileResponse(preview_path, media_type="text/html")


app.mount("/editor", StaticFiles(directory=FRONTEND_DIR, html=True), name="editor")
