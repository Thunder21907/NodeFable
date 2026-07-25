from fastapi import FastAPI, HTTPException, Query, UploadFile, File
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field
import json
import os
import io
import zipfile
import re
from typing import Dict, List

from backend.schemas.project import ProjectSchema, NodeData, VariableValue

app = FastAPI()

DATA_DIR = "backend/data"
os.makedirs(DATA_DIR, exist_ok=True)

FRONTEND_DIR = "frontend/editor"

class SaveRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    variables: Dict[str, VariableValue] = Field(default_factory=dict)
    nodes: List[NodeData] = Field(default_factory=list)

def safe_name(name: str) -> str:
    name = name.replace('/', '_').replace('\\', '_')
    name = re.sub(r'[^\w\s\-.]', '', name)
    return name.strip()

@app.get("/")
async def read_root():
    return {"message": "NodeFable API is running"}

@app.post("/api/save")
async def save_project(req: SaveRequest):
    try:
        name = safe_name(req.name)
        project_dir = os.path.join(DATA_DIR, name)
        assets_dir = os.path.join(project_dir, "assets")
        os.makedirs(assets_dir, exist_ok=True)

        filepath = os.path.join(project_dir, "project.json")
        data = {
            "name": name,
            "variables": req.variables,
            "nodes": [n.model_dump() for n in req.nodes]
        }
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=4)
        return {"status": "ok", "name": name}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save project: {str(e)}")

@app.get("/api/saves")
async def list_saves():
    try:
        files = []
        for entry in os.listdir(DATA_DIR):
            project_dir = os.path.join(DATA_DIR, entry)
            project_file = os.path.join(project_dir, "project.json")
            if os.path.isdir(project_dir) and os.path.exists(project_file):
                mtime = os.path.getmtime(project_file)
                files.append({"name": entry, "mtime": mtime})
        files.sort(key=lambda f: f["mtime"], reverse=True)
        return {"saves": files}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/load", response_model=ProjectSchema)
async def load_project(name: str = Query(..., description="Project folder name")):
    safe = safe_name(name)
    filepath = os.path.join(DATA_DIR, safe, "project.json")
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail=f"Project '{name}' not found")
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            data = json.load(f)
        return ProjectSchema(variables=data.get("variables", {}), nodes=data.get("nodes", []))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load project: {str(e)}")

@app.get("/api/assets/{name}")
async def list_assets(name: str):
    safe = safe_name(name)
    assets_dir = os.path.join(DATA_DIR, safe, "assets")
    if not os.path.exists(assets_dir):
        return {"assets": []}
    files = []
    for fname in sorted(os.listdir(assets_dir)):
        fpath = os.path.join(assets_dir, fname)
        if os.path.isfile(fpath):
            files.append(fname)
    return {"assets": files}

@app.post("/api/assets/{name}")
async def upload_asset(name: str, file: UploadFile = File(...)):
    safe = safe_name(name)
    assets_dir = os.path.join(DATA_DIR, safe, "assets")
    if not os.path.isdir(assets_dir):
        raise HTTPException(status_code=404, detail="Project not found or assets directory missing")

    filename = file.filename.replace('/', '_').replace('\\', '_')
    if not filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    filepath = os.path.join(assets_dir, filename)

    try:
        content = await file.read()
        with open(filepath, "wb") as f:
            f.write(content)
        return {"status": "ok", "filename": filename, "url": f"/api/assets/{safe}/{filename}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to upload asset: {str(e)}")

@app.get("/api/assets/{name}/{filename}")
async def get_asset(name: str, filename: str):
    safe = safe_name(name)
    safe_file = filename.replace('/', '_').replace('\\', '_')
    filepath = os.path.join(DATA_DIR, safe, "assets", safe_file)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="Asset not found")
    return FileResponse(filepath)

@app.delete("/api/assets/{name}/{filename}")
async def delete_asset(name: str, filename: str):
    safe = safe_name(name)
    safe_file = filename.replace('/', '_').replace('\\', '_')
    if not safe_file:
        raise HTTPException(status_code=400, detail="Invalid filename")
    filepath = os.path.join(DATA_DIR, safe, "assets", safe_file)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="Asset not found")
    try:
        os.remove(filepath)
        files = []
        assets_dir = os.path.join(DATA_DIR, safe, "assets")
        if os.path.isdir(assets_dir):
            for fname in sorted(os.listdir(assets_dir)):
                fpath = os.path.join(assets_dir, fname)
                if os.path.isfile(fpath):
                    files.append(fname)
        return {"status": "ok", "assets": files}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete asset: {str(e)}")

@app.get("/api/export/{name}")
async def export_project(name: str):
    safe = safe_name(name)
    project_dir = os.path.join(DATA_DIR, safe)
    project_file = os.path.join(project_dir, "project.json")
    if not os.path.exists(project_file):
        raise HTTPException(status_code=404, detail="Project not found")

    with open(project_file, "r", encoding="utf-8") as f:
        project_data = json.load(f)

    asset_pattern = re.compile(r'/api/assets/' + re.escape(safe) + r'/([^)"\s]+)')
    def rewrite_urls_in_node(obj):
        if isinstance(obj, dict):
            for k, v in obj.items():
                if isinstance(v, str):
                    obj[k] = asset_pattern.sub(r'assets/\1', v)
                else:
                    rewrite_urls_in_node(v)
        elif isinstance(obj, list):
            for item in obj:
                rewrite_urls_in_node(item)

    rewrite_urls_in_node(project_data)

    template_path = os.path.join(FRONTEND_DIR, "template.html")
    with open(template_path, "r", encoding="utf-8") as f:
        template = f.read()

    story_json = json.dumps(project_data, indent=2)
    template = template.replace('// __STORY_DATA_PLACEHOLDER__', 'const STORY_DATA = ' + story_json + ';')

    # Inline CSS for self-contained export
    css_path = os.path.join(FRONTEND_DIR, "template_styles.css")
    if os.path.exists(css_path):
        with open(css_path, "r", encoding="utf-8") as f:
            css_content = f.read()
        template = template.replace(
            '<link rel="stylesheet" href="template_styles.css">',
            f'<style>\n{css_content}\n</style>'
        )

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("index.html", template)

        assets_dir = os.path.join(project_dir, "assets")
        if os.path.isdir(assets_dir):
            for fname in os.listdir(assets_dir):
                fpath = os.path.join(assets_dir, fname)
                if os.path.isfile(fpath):
                    zf.write(fpath, "assets/" + fname)

    zip_buffer.seek(0)
    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename={safe}.zip"}
    )


@app.get("/api/preview/{name}")
async def preview_project(name: str):
    safe = safe_name(name)
    project_dir = os.path.join(DATA_DIR, safe)
    project_file = os.path.join(project_dir, "project.json")
    if not os.path.exists(project_file):
        raise HTTPException(status_code=404, detail="Project not found")

    with open(project_file, "r", encoding="utf-8") as f:
        project_data = json.load(f)

    template_path = os.path.join(FRONTEND_DIR, "template.html")
    with open(template_path, "r", encoding="utf-8") as f:
        template = f.read()

    story_json = json.dumps(project_data, indent=2)
    template = template.replace('// __STORY_DATA_PLACEHOLDER__', 'const STORY_DATA = ' + story_json + ';')

    # Inline CSS so preview works when served by the server
    css_path = os.path.join(FRONTEND_DIR, "template_styles.css")
    if os.path.exists(css_path):
        with open(css_path, "r", encoding="utf-8") as f:
            css_content = f.read()
        template = template.replace(
            '<link rel="stylesheet" href="template_styles.css">',
            f'<style>\n{css_content}\n</style>'
        )

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
