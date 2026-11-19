//! Project storage: a Rust port of `backend/main.py` (FastAPI).
//!
//! Everything here works on an explicit data-directory `root`
//! (`~/.local/share/nodefable/data` in the app) so it can be unit-tested
//! without Tauri. On-disk format, migrations and responses match the Python
//! backend; the deliberate differences (all stricter / safer) are:
//! * asset paths are validated component-by-component (no `..`, absolute or
//!   drive-prefixed paths) and must stay inside `assets/` after symlinks;
//! * every file write is atomic (temp file in the same directory + rename);
//! * deleting a symlinked folder removes the link, not the target's files;
//! * copying/moving a folder into itself is rejected;
//! * duplicate ids in the saved `groups` metadata are written once;
//! * zip entries always use `/` separators;
//! * template CSS is inlined before the story data is injected, so story
//!   text can never match the stylesheet marker.

use std::collections::{HashMap, HashSet};
use std::fmt;
use std::fs;
use std::io::{self, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::LazyLock;
use std::time::UNIX_EPOCH;

use regex::Regex;
use serde::Serialize;
use serde_json::{json, Map, Value};

use crate::models::{AssetEntry, NodeData, Project, SaveEntry, SaveRequest};

pub const MANIFEST_VERSION: u64 = 2;
const STYLESHEET_LINK: &str = r#"<link rel="stylesheet" href="template_styles.css">"#;
const STORY_PLACEHOLDER: &str = "// __STORY_DATA_PLACEHOLDER__";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/// HTTP-style error (`status` mirrors the FastAPI status code, `detail` its
/// message) so the editor shows the same messages in both backends.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApiError {
    pub status: u16,
    pub detail: String,
}

impl ApiError {
    pub fn new(status: u16, detail: impl Into<String>) -> Self {
        Self { status, detail: detail.into() }
    }
    pub fn bad_request(detail: impl Into<String>) -> Self {
        Self::new(400, detail)
    }
    pub fn not_found(detail: impl Into<String>) -> Self {
        Self::new(404, detail)
    }
    pub fn conflict(detail: impl Into<String>) -> Self {
        Self::new(409, detail)
    }
    pub fn internal(detail: impl Into<String>) -> Self {
        Self::new(500, detail)
    }
    fn invalid_path() -> Self {
        Self::bad_request("Invalid path")
    }
}

impl fmt::Display for ApiError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.detail)
    }
}

impl std::error::Error for ApiError {}

impl From<io::Error> for ApiError {
    fn from(e: io::Error) -> Self {
        Self::internal(e.to_string())
    }
}

impl From<serde_json::Error> for ApiError {
    fn from(e: serde_json::Error) -> Self {
        Self::internal(e.to_string())
    }
}

pub type ApiResult<T> = Result<T, ApiError>;

/// Wrap any error as a 500 with a context prefix, keeping 4xx errors as-is
/// (FastAPI's `except HTTPException: raise` / `except Exception: 500`).
fn ctx<T>(r: ApiResult<T>, prefix: &str) -> ApiResult<T> {
    r.map_err(|e| if e.status >= 500 { ApiError::internal(format!("{prefix}: {}", e.detail)) } else { e })
}

// ---------------------------------------------------------------------------
// Names, paths, JSON I/O
// ---------------------------------------------------------------------------

/// Python: `re.sub(r'[^\w\s\-.]', '', name.replace('/', '_').replace('\\', '_'))`
/// then `.strip().strip('.').strip()`; empty → 400.
pub fn safe_name(name: &str) -> ApiResult<String> {
    let replaced = name.replace(['/', '\\'], "_");
    let filtered: String = replaced
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '_' || c.is_whitespace() || *c == '-' || *c == '.')
        .collect();
    let cleaned = filtered.trim().trim_matches('.').trim();
    if cleaned.is_empty() {
        return Err(ApiError::bad_request("Invalid project name"));
    }
    Ok(cleaned.to_string())
}

/// Python `str.title()` on `gid.replace("_", " ")`.
pub fn default_group_label(gid: &str) -> String {
    let mut out = String::with_capacity(gid.len());
    let mut prev_alpha = false;
    for c in gid.replace('_', " ").chars() {
        if c.is_alphabetic() {
            if prev_alpha {
                out.extend(c.to_lowercase());
            } else {
                out.extend(c.to_uppercase());
            }
            prev_alpha = true;
        } else {
            out.push(c);
            prev_alpha = false;
        }
    }
    out
}

pub fn project_dir(root: &Path, name: &str) -> ApiResult<PathBuf> {
    Ok(root.join(safe_name(name)?))
}

fn groups_dir(root: &Path, name: &str) -> ApiResult<PathBuf> {
    Ok(project_dir(root, name)?.join("groups"))
}

fn manifest_path(root: &Path, name: &str) -> ApiResult<PathBuf> {
    Ok(project_dir(root, name)?.join("manifest.json"))
}

fn legacy_path(root: &Path, name: &str) -> ApiResult<PathBuf> {
    Ok(project_dir(root, name)?.join("project.json"))
}

pub fn assets_dir(root: &Path, name: &str) -> ApiResult<PathBuf> {
    Ok(project_dir(root, name)?.join("assets"))
}

/// `groups/<safe_name(gid) or "unnamed">.json`
fn group_file_name(gid: &str) -> String {
    format!("{}.json", safe_name(gid).unwrap_or_else(|_| "unnamed".to_string()))
}

fn group_path(root: &Path, name: &str, gid: &str) -> ApiResult<PathBuf> {
    Ok(groups_dir(root, name)?.join(group_file_name(gid)))
}

fn ensure_project_dirs(root: &Path, name: &str) -> ApiResult<()> {
    let pdir = project_dir(root, name)?;
    fs::create_dir_all(pdir.join("groups"))?;
    fs::create_dir_all(pdir.join("assets"))?;
    Ok(())
}

/// Atomically replace `path` with `bytes` (temp file in the same dir + rename).
pub fn atomic_write(path: &Path, bytes: &[u8]) -> ApiResult<()> {
    let parent = path.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or(Path::new("."));
    fs::create_dir_all(parent)?;
    let mut tmp = tempfile::NamedTempFile::new_in(parent)?;
    tmp.write_all(bytes)?;
    tmp.as_file().sync_all()?;
    tmp.persist(path).map_err(|e| ApiError::from(e.error))?;
    Ok(())
}

/// JSON with 4-space indent (Python `json.dump(..., indent=4)`).
pub fn atomic_write_json(path: &Path, value: &Value) -> ApiResult<()> {
    let mut buf = Vec::new();
    let fmt = serde_json::ser::PrettyFormatter::with_indent(b"    ");
    let mut ser = serde_json::Serializer::with_formatter(&mut buf, fmt);
    value.serialize(&mut ser)?;
    atomic_write(path, &buf)
}

fn read_json(path: &Path) -> ApiResult<Value> {
    let bytes = fs::read(path)?;
    Ok(serde_json::from_slice(&bytes)?)
}

fn obj_str<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(Value::as_str).unwrap_or("")
}

fn nodes_of(group_file: &Value) -> Vec<Value> {
    group_file.get("nodes").and_then(Value::as_array).cloned().unwrap_or_default()
}

// ---------------------------------------------------------------------------
// slug_ids helpers / migrations
// ---------------------------------------------------------------------------

fn choice_targets(node: &Value) -> Vec<Value> {
    node.get("choices")
        .and_then(Value::as_array)
        .map(|cs| {
            cs.iter()
                .map(|c| obj_str(c, "target_node_id"))
                .filter(|t| !t.is_empty())
                .map(|t| Value::String(t.to_string()))
                .collect()
        })
        .unwrap_or_default()
}

/// `[{slug_id, connections}]` for a list of node objects.
pub fn build_slug_info(nodes: &[Value]) -> Vec<Value> {
    nodes
        .iter()
        .filter(|n| !obj_str(n, "id").is_empty())
        .map(|n| json!({ "slug_id": obj_str(n, "id"), "connections": choice_targets(n) }))
        .collect()
}

/// Old flat `["slug", ...]` → `[{slug_id, connections}]` (connections from `nodes`).
fn convert_slug_ids_if_old(slug_ids: &[Value], nodes: &[Value]) -> Vec<Value> {
    match slug_ids.first() {
        None => Vec::new(),
        Some(first) if first.is_object() => slug_ids.to_vec(),
        Some(_) => {
            let by_id: HashMap<&str, &Value> = nodes
                .iter()
                .filter(|n| !obj_str(n, "id").is_empty())
                .map(|n| (obj_str(n, "id"), n))
                .collect();
            slug_ids
                .iter()
                .map(|sid| {
                    let sid = sid.as_str().unwrap_or("");
                    let connections = by_id.get(sid).map(|n| choice_targets(n)).unwrap_or_default();
                    json!({ "slug_id": sid, "connections": connections })
                })
                .collect()
        }
    }
}

/// `gdata.get("slug_ids", [n.id for n in nodes])` converted to the new format.
fn group_file_slug_ids(gdata: &Value) -> Vec<Value> {
    let nodes = nodes_of(gdata);
    let raw: Vec<Value> = match gdata.get("slug_ids").and_then(Value::as_array) {
        Some(a) => a.clone(),
        None => nodes.iter().map(|n| Value::String(obj_str(n, "id").to_string())).collect(),
    };
    convert_slug_ids_if_old(&raw, &nodes)
}

fn group_file_node_count(gdata: &Value) -> u64 {
    gdata.get("node_count").and_then(Value::as_u64).unwrap_or_else(|| nodes_of(gdata).len() as u64)
}

fn needs_migration(root: &Path, name: &str) -> ApiResult<bool> {
    let pdir = project_dir(root, name)?;
    Ok(pdir.is_dir() && !manifest_path(root, name)?.exists() && legacy_path(root, name)?.exists())
}

fn group_file_json(gid: &str, label: &str, nodes: &[Value]) -> Value {
    json!({
        "group_id": gid,
        "label": label,
        "node_count": nodes.len(),
        "slug_ids": build_slug_info(nodes),
        "nodes": nodes,
    })
}

fn group_entry_json(gid: &str, label: &str, node_count: u64, slug_ids: Vec<Value>) -> Value {
    json!({ "id": gid, "label": label, "node_count": node_count, "slug_ids": slug_ids })
}

/// Old single `project.json` → manifest + `groups/side_panel.json` + `groups/default.json`.
fn migrate_legacy_project(root: &Path, name: &str) -> ApiResult<()> {
    let src = legacy_path(root, name)?;
    let data = read_json(&src)?;
    let nodes: Vec<Value> = data.get("nodes").and_then(Value::as_array).cloned().unwrap_or_default();
    let variables = data.get("variables").cloned().unwrap_or_else(|| json!({}));

    let (mut side, mut other): (Vec<Value>, Vec<Value>) =
        nodes.into_iter().partition(|n| obj_str(n, "id") == "side_panel");

    let mut groups = Vec::new();
    for (gid, label, list) in [("side_panel", "Side Panel", &mut side), ("default", "Default", &mut other)] {
        if list.is_empty() {
            continue;
        }
        for n in list.iter_mut() {
            if let Some(o) = n.as_object_mut() {
                o.insert("group".into(), Value::String(gid.into()));
            }
        }
        atomic_write_json(&group_path(root, name, gid)?, &group_file_json(gid, label, list))?;
        groups.push(group_entry_json(gid, label, list.len() as u64, build_slug_info(list)));
    }

    let manifest = json!({
        "name": safe_name(name)?,
        "version": MANIFEST_VERSION,
        "variables": variables,
        "setup": {},
        "groups": groups,
    });
    atomic_write_json(&manifest_path(root, name)?, &manifest)?;
    fs::remove_file(&src)?;
    Ok(())
}

/// Upgrade manifest `slug_ids` from flat strings (in memory only).
fn migrate_manifest_slug_ids(manifest: &mut Value, root: &Path, name: &str) -> ApiResult<()> {
    let Some(groups) = manifest.get_mut("groups").and_then(Value::as_array_mut) else { return Ok(()) };
    let is_old = |g: &Value| g.get("slug_ids").and_then(Value::as_array).and_then(|a| a.first()).is_some_and(Value::is_string);
    if !groups.iter().any(is_old) {
        return Ok(());
    }
    for g in groups.iter_mut() {
        if !is_old(g) {
            continue;
        }
        let gpath = group_path(root, name, obj_str(g, "id"))?;
        let nodes = if gpath.exists() { nodes_of(&read_json(&gpath)?) } else { Vec::new() };
        let slug_ids: Vec<Value> = g["slug_ids"].as_array().cloned().unwrap_or_default();
        let converted = convert_slug_ids_if_old(&slug_ids, &nodes);
        g["slug_ids"] = Value::Array(converted);
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

/// Load `manifest.json` (migrating legacy projects first) and adopt group files
/// that exist on disk but are missing from / emptier than the manifest.
pub fn load_manifest(root: &Path, name: &str) -> ApiResult<Value> {
    let pdir = project_dir(root, name)?;
    let not_found = || ApiError::not_found(format!("Project '{name}' not found"));
    if !pdir.is_dir() {
        return Err(not_found());
    }
    if needs_migration(root, name)? {
        migrate_legacy_project(root, name)?;
    }
    let mpath = manifest_path(root, name)?;
    if !mpath.exists() {
        return Err(not_found());
    }
    let mut manifest = read_json(&mpath)?;
    if !manifest.is_object() {
        return Err(ApiError::internal("manifest.json is not an object"));
    }

    let gdir = groups_dir(root, name)?;
    if gdir.is_dir() {
        let mut files: Vec<String> = fs::read_dir(&gdir)?
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|f| f.ends_with(".json"))
            .collect();
        files.sort(); // deterministic order for adopted orphans

        let groups = manifest
            .as_object_mut()
            .expect("checked above")
            .entry("groups")
            .or_insert_with(|| json!([]));
        if !groups.is_array() {
            *groups = json!([]);
        }
        let groups = groups.as_array_mut().expect("array");
        let mut existing: HashSet<String> = groups.iter().map(|g| obj_str(g, "id").to_string()).collect();

        for fname in files {
            let gid = fname[..fname.len() - 5].to_string();
            let Ok(gdata) = read_json(&gdir.join(&fname)) else { continue };
            if !gdata.is_object() {
                continue;
            }
            let file_count = group_file_node_count(&gdata);
            let file_slugs = group_file_slug_ids(&gdata);
            let file_label = gdata
                .get("label")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| default_group_label(&gid));

            if existing.contains(&gid) {
                if let Some(g) = groups.iter_mut().find(|g| obj_str(g, "id") == gid) {
                    let count = g.get("node_count").and_then(Value::as_u64).unwrap_or(0);
                    let has_slugs = g.get("slug_ids").and_then(Value::as_array).is_some_and(|a| !a.is_empty());
                    if file_count > 0 && (count == 0 || !has_slugs) {
                        g["node_count"] = json!(file_count);
                        g["slug_ids"] = Value::Array(file_slugs);
                        g["label"] = Value::String(file_label);
                    }
                }
            } else {
                groups.push(group_entry_json(&gid, &file_label, file_count, file_slugs));
                existing.insert(gid);
            }
        }
    }

    migrate_manifest_slug_ids(&mut manifest, root, name)?;
    Ok(manifest)
}

fn load_group_nodes(root: &Path, name: &str, gid: &str) -> ApiResult<Vec<Value>> {
    let gpath = group_path(root, name, gid)?;
    if !gpath.exists() {
        return Ok(Vec::new());
    }
    Ok(nodes_of(&read_json(&gpath)?))
}

fn manifest_map(manifest: &Value, key: &str) -> Map<String, Value> {
    manifest.get(key).and_then(Value::as_object).cloned().unwrap_or_default()
}

/// `(setup, variables, raw node objects)`.
pub type RawProject = (Map<String, Value>, Map<String, Value>, Vec<Value>);

/// Raw node objects of the requested groups (`None`/empty = every group in
/// manifest order), plus setup and variables.
pub fn load_raw(root: &Path, name: &str, groups: Option<&[String]>) -> ApiResult<RawProject> {
    let manifest = load_manifest(root, name)?;
    let ids: Vec<String> = match groups.map(|g| g.iter().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect::<Vec<_>>()) {
        Some(list) if !list.is_empty() => {
            let mut seen = HashSet::new();
            list.into_iter().filter(|g| seen.insert(g.clone())).collect()
        }
        _ => manifest
            .get("groups")
            .and_then(Value::as_array)
            .map(|gs| gs.iter().map(|g| obj_str(g, "id").to_string()).collect())
            .unwrap_or_default(),
    };
    let mut nodes = Vec::new();
    for gid in ids {
        nodes.extend(load_group_nodes(root, name, &gid)?);
    }
    Ok((manifest_map(&manifest, "setup"), manifest_map(&manifest, "variables"), nodes))
}

/// `GET /api/load` — nodes validated against the `NodeData` schema.
pub fn load_project(root: &Path, name: &str, groups: Option<&[String]>) -> ApiResult<Project> {
    ctx(
        (|| {
            let (setup, variables, raw) = load_raw(root, name, groups)?;
            let nodes = raw
                .into_iter()
                .map(|n| {
                    let id = obj_str(&n, "id").to_string();
                    serde_json::from_value::<NodeData>(n)
                        .map_err(|e| ApiError::internal(format!("invalid node '{id}': {e}")))
                })
                .collect::<ApiResult<Vec<_>>>()?;
            Ok(Project { variables, setup, nodes })
        })(),
        "Failed to load project",
    )
}

pub fn list_saves(root: &Path) -> ApiResult<Vec<SaveEntry>> {
    let mut out = Vec::new();
    if !root.is_dir() {
        return Ok(out);
    }
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let pdir = entry.path();
        if !pdir.is_dir() {
            continue;
        }
        let manifest = pdir.join("manifest.json");
        let check = if manifest.exists() { manifest } else { pdir.join("project.json") };
        if let Ok(meta) = fs::metadata(&check) {
            let mtime = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs_f64())
                .unwrap_or(0.0);
            out.push(SaveEntry { name: entry.file_name().to_string_lossy().into_owned(), mtime });
        }
    }
    out.sort_by(|a, b| b.mtime.partial_cmp(&a.mtime).unwrap_or(std::cmp::Ordering::Equal));
    Ok(out)
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

/// `POST /api/save`: partition nodes by group, write `groups/<id>.json`, keep
/// (never overwrite) files of groups that are listed but not loaded, delete
/// group files no longer listed, then write `manifest.json`.
pub fn save_project(root: &Path, req: &SaveRequest) -> ApiResult<Value> {
    let len = req.name.chars().count();
    if !(1..=100).contains(&len) {
        return Err(ApiError::new(422, "Project name must be 1-100 characters"));
    }
    for (scope, map) in [("variables", &req.variables), ("setup", &req.setup)] {
        if let Some((k, _)) = map.iter().find(|(_, v)| v.is_null()) {
            return Err(ApiError::new(422, format!("Invalid {scope} value for '{k}': null is not allowed")));
        }
    }
    let safe = safe_name(&req.name)?;
    ctx(save_inner(root, &safe, req), "Failed to save project")?;
    Ok(json!({ "status": "ok", "name": safe }))
}

fn save_inner(root: &Path, safe: &str, req: &SaveRequest) -> ApiResult<()> {
    ensure_project_dirs(root, safe)?;

    // Partition, keeping first-appearance order (Python dict insertion order).
    let mut order: Vec<String> = Vec::new();
    let mut grouped: HashMap<String, Vec<Value>> = HashMap::new();
    for n in &req.nodes {
        let gid = n.group.clone().filter(|g| !g.is_empty()).unwrap_or_else(|| "side_panel".into());
        if !grouped.contains_key(&gid) {
            order.push(gid.clone());
        }
        grouped.entry(gid).or_default().push(serde_json::to_value(n)?);
    }
    if !grouped.contains_key("side_panel") {
        order.push("side_panel".into());
        grouped.insert("side_panel".into(), Vec::new());
    }

    let meta: Vec<&Map<String, Value>> = req.groups.iter().flatten().filter_map(Value::as_object).collect();
    let label_lookup: HashMap<&str, &str> = meta
        .iter()
        .map(|g| (g.get("id").and_then(Value::as_str).unwrap_or(""), g.get("label").and_then(Value::as_str).unwrap_or("")))
        .collect();

    let mut groups_list: Vec<Value> = Vec::new();
    for gid in &order {
        let nodes = &grouped[gid];
        let label = label_lookup.get(gid.as_str()).map(|s| s.to_string()).unwrap_or_else(|| default_group_label(gid));
        atomic_write_json(&group_path(root, safe, gid)?, &group_file_json(gid, &label, nodes))?;
        groups_list.push(group_entry_json(gid, &label, nodes.len() as u64, build_slug_info(nodes)));
    }

    // Groups listed in the metadata without nodes in this payload: newly
    // created groups, or unloaded groups whose files must not be overwritten.
    let mut written: HashSet<String> = order.iter().cloned().collect();
    for g in &meta {
        let gid = g.get("id").and_then(Value::as_str).unwrap_or("");
        if gid.is_empty() || !written.insert(gid.to_string()) {
            continue;
        }
        let mut label = g.get("label").and_then(Value::as_str).unwrap_or("").to_string();
        if label.is_empty() {
            label = default_group_label(gid);
        }
        let gpath = group_path(root, safe, gid)?;
        let entry = if gpath.exists() {
            let edata = read_json(&gpath)?;
            let file_label = edata.get("label").and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_string);
            group_entry_json(gid, &file_label.unwrap_or(label), group_file_node_count(&edata), group_file_slug_ids(&edata))
        } else {
            atomic_write_json(&gpath, &json!({ "group_id": gid, "label": label, "node_count": 0, "slug_ids": [], "nodes": [] }))?;
            group_entry_json(gid, &label, 0, Vec::new())
        };
        groups_list.push(entry);
    }

    // Stale group cleanup (only when the client sent its group list).
    if req.groups.is_some() {
        let gdir = groups_dir(root, safe)?;
        if gdir.is_dir() {
            let valid: HashSet<String> = groups_list
                .iter()
                .map(|g| obj_str(g, "id"))
                .filter(|id| !id.is_empty())
                .map(group_file_name)
                .collect();
            for entry in fs::read_dir(&gdir)?.filter_map(|e| e.ok()) {
                let fname = entry.file_name().to_string_lossy().into_owned();
                if fname.ends_with(".json") && !valid.contains(&fname) {
                    let _ = fs::remove_file(entry.path());
                }
            }
        }
    }

    let manifest = json!({
        "name": safe,
        "version": MANIFEST_VERSION,
        "variables": req.variables,
        "setup": req.setup,
        "groups": groups_list,
    });
    atomic_write_json(&manifest_path(root, safe)?, &manifest)
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

/// Resolve `rel` inside `assets_dir`. Rejects `..`, absolute and drive-prefixed
/// paths, and anything that escapes `assets_dir` through a symlink.
/// An empty `rel` resolves to `assets_dir` itself.
pub fn resolve_asset_path(assets_dir: &Path, rel: &str) -> ApiResult<PathBuf> {
    let norm = rel.replace('\\', "/");
    let norm = norm.trim_matches('/');
    let mut target = assets_dir.to_path_buf();
    for comp in Path::new(norm).components() {
        match comp {
            Component::Normal(c) => target.push(c),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => return Err(ApiError::invalid_path()),
        }
    }
    // Symlink escape check on the deepest existing ancestor.
    if let Ok(base) = assets_dir.canonicalize() {
        let mut probe = target.as_path();
        loop {
            if let Ok(real) = probe.canonicalize() {
                if !real.starts_with(&base) {
                    return Err(ApiError::invalid_path());
                }
                break;
            }
            match probe.parent() {
                Some(p) if p.starts_with(assets_dir) => probe = p,
                _ => break,
            }
        }
    }
    Ok(target)
}

fn rel_string(base: &Path, path: &Path) -> String {
    path.strip_prefix(base)
        .map(|p| p.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect::<Vec<_>>().join("/"))
        .unwrap_or_default()
}

fn build_asset_tree(dir: &Path, prefix: &str, project: &str) -> Vec<AssetEntry> {
    let Ok(rd) = fs::read_dir(dir) else { return Vec::new() };
    let mut names: Vec<String> = rd.filter_map(|e| e.ok()).map(|e| e.file_name().to_string_lossy().into_owned()).collect();
    names.sort();
    let mut out = Vec::new();
    for d in names.iter().filter(|n| dir.join(n).is_dir()) {
        let sub = if prefix.is_empty() { d.clone() } else { format!("{prefix}/{d}") };
        out.push(AssetEntry::Folder { name: d.clone(), kind: "folder", children: build_asset_tree(&dir.join(d), &sub, project) });
    }
    for f in names.iter().filter(|n| dir.join(n).is_file()) {
        let path = if prefix.is_empty() { f.clone() } else { format!("{prefix}/{f}") };
        let size = fs::metadata(dir.join(f)).map(|m| m.len()).unwrap_or(0);
        out.push(AssetEntry::File { name: f.clone(), kind: "file", file_size: size, url: format!("/api/assets/{project}/{path}") });
    }
    out
}

pub fn list_assets(root: &Path, name: &str) -> ApiResult<Vec<AssetEntry>> {
    let safe = safe_name(name)?;
    Ok(build_asset_tree(&assets_dir(root, &safe)?, "", &safe))
}

/// Final file name of an upload (directory parts are ignored, like the Python
/// `os.path.basename` after normalisation; a bare leading-dot name is stripped).
fn upload_basename(filename: &str) -> ApiResult<String> {
    let norm = filename.replace('\\', "/");
    let has_dir = norm.trim_start_matches('/').contains('/');
    let mut base = norm.rsplit('/').find(|s| !s.is_empty()).unwrap_or("").to_string();
    if !has_dir {
        base = base.trim_start_matches('.').to_string();
    }
    if base.is_empty() || base == "." || base == ".." {
        return Err(ApiError::bad_request("Invalid filename"));
    }
    Ok(base)
}

pub fn upload_asset(root: &Path, name: &str, filename: &str, folder: &str, bytes: &[u8]) -> ApiResult<Value> {
    let safe = safe_name(name)?;
    let adir = assets_dir(root, &safe)?;
    if !adir.is_dir() {
        return Err(ApiError::not_found("Project not found or assets directory missing"));
    }
    let base = upload_basename(filename)?;
    let folder = folder.replace('\\', "/");
    let folder = folder.trim_matches('/');
    let target_dir = if folder.is_empty() { adir.clone() } else { resolve_asset_path(&adir, folder)? };
    let dest = resolve_asset_path(&adir, &if folder.is_empty() { base.clone() } else { format!("{folder}/{base}") })?;
    ctx(
        (|| {
            fs::create_dir_all(&target_dir)?;
            atomic_write(&dest, bytes)
        })(),
        "Failed to upload asset",
    )?;
    let rel = if folder.is_empty() { base.clone() } else { format!("{folder}/{base}") };
    Ok(json!({ "status": "ok", "filename": base, "url": format!("/api/assets/{safe}/{rel}"), "rel_path": rel }))
}

pub fn create_folder(root: &Path, name: &str, path: &str) -> ApiResult<Value> {
    let adir = assets_dir(root, name)?;
    let target = resolve_asset_path(&adir, path)?;
    ctx(fs::create_dir_all(&target).map_err(ApiError::from), "Failed to create folder")?;
    Ok(json!({ "status": "ok", "path": path }))
}

pub fn rename_asset(root: &Path, name: &str, path: &str, new_name: &str) -> ApiResult<Value> {
    let adir = assets_dir(root, name)?;
    let old = resolve_asset_path(&adir, path)?;
    if old == adir {
        return Err(ApiError::invalid_path());
    }
    if fs::symlink_metadata(&old).is_err() {
        return Err(ApiError::not_found("Path not found"));
    }
    if new_name.is_empty() || new_name.contains('/') || new_name.contains('\\') || new_name == "." || new_name == ".." {
        return Err(ApiError::invalid_path());
    }
    let parent_rel = rel_string(&adir, old.parent().unwrap_or(&adir));
    let new_rel = if parent_rel.is_empty() { new_name.to_string() } else { format!("{parent_rel}/{new_name}") };
    let new_path = resolve_asset_path(&adir, &new_rel)?;
    if new_path == adir {
        return Err(ApiError::invalid_path());
    }
    if fs::symlink_metadata(&new_path).is_ok() {
        return Err(ApiError::conflict("Target already exists"));
    }
    ctx(fs::rename(&old, &new_path).map_err(ApiError::from), "Failed to rename")?;
    Ok(json!({ "status": "ok" }))
}

fn src_dst(root: &Path, name: &str, from: &str, to: &str) -> ApiResult<(PathBuf, PathBuf)> {
    let adir = assets_dir(root, name)?;
    let src = resolve_asset_path(&adir, from)?;
    let dst = resolve_asset_path(&adir, to)?;
    if src == adir || dst == adir {
        return Err(ApiError::invalid_path());
    }
    if fs::symlink_metadata(&src).is_err() {
        return Err(ApiError::not_found("Source not found"));
    }
    if fs::symlink_metadata(&dst).is_ok() {
        return Err(ApiError::conflict("Target already exists"));
    }
    if src.is_dir() && dst.starts_with(&src) {
        return Err(ApiError::bad_request("Cannot move or copy a folder into itself"));
    }
    Ok((src, dst))
}

pub fn move_asset(root: &Path, name: &str, from: &str, to: &str) -> ApiResult<Value> {
    let (src, dst) = src_dst(root, name, from, to)?;
    ctx(
        (|| {
            if let Some(p) = dst.parent() {
                fs::create_dir_all(p)?;
            }
            fs::rename(&src, &dst)?;
            Ok(())
        })(),
        "Failed to move",
    )?;
    Ok(json!({ "status": "ok" }))
}

/// Copy a file or folder tree. The top-level `src` was already confined to
/// `assets/` by `resolve_asset_path`; symlinks *inside* a copied folder could
/// point anywhere, so they are skipped rather than followed.
fn copy_recursive(src: &Path, dst: &Path) -> io::Result<()> {
    if src.is_dir() {
        fs::create_dir_all(dst)?;
        for entry in fs::read_dir(src)? {
            let entry = entry?;
            if entry.file_type()?.is_symlink() {
                continue;
            }
            copy_recursive(&entry.path(), &dst.join(entry.file_name()))?;
        }
        Ok(())
    } else {
        fs::copy(src, dst).map(|_| ())
    }
}

pub fn copy_asset(root: &Path, name: &str, from: &str, to: &str) -> ApiResult<Value> {
    let (src, dst) = src_dst(root, name, from, to)?;
    ctx(
        (|| {
            if let Some(p) = dst.parent() {
                fs::create_dir_all(p)?;
            }
            copy_recursive(&src, &dst)?;
            Ok(())
        })(),
        "Failed to copy",
    )?;
    Ok(json!({ "status": "ok" }))
}

fn count_files(dir: &Path) -> u64 {
    fs::read_dir(dir)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .map(|e| match e.file_type() {
                    Ok(t) if t.is_dir() => count_files(&e.path()),
                    _ => 1,
                })
                .sum()
        })
        .unwrap_or(0)
}

pub fn delete_asset(root: &Path, name: &str, filepath: &str) -> ApiResult<Value> {
    let adir = assets_dir(root, name)?;
    let target = resolve_asset_path(&adir, filepath)?;
    if target == adir {
        return Err(ApiError::invalid_path());
    }
    let meta = fs::symlink_metadata(&target).map_err(|_| ApiError::not_found("Path not found"))?;
    let deleted = ctx(
        (|| {
            if meta.is_dir() {
                let n = count_files(&target);
                fs::remove_dir_all(&target)?;
                Ok(n)
            } else {
                // Plain files and symlinks (a linked folder loses only the link).
                fs::remove_file(&target)?;
                Ok(1)
            }
        })(),
        "Failed to delete",
    )?;
    Ok(json!({ "status": "ok", "deleted_count": deleted }))
}

/// File for an asset request path relative to `assets/` (`GET /api/assets/...`):
/// the literal path first, then without a leading `assets/`.
pub fn find_asset_file(root: &Path, name: &str, rel: &str) -> ApiResult<PathBuf> {
    let adir = assets_dir(root, name)?;
    let rel = rel.trim_matches('/');
    let target = resolve_asset_path(&adir, rel)?;
    if target.is_file() {
        return Ok(target);
    }
    if let Some(stripped) = rel.strip_prefix("assets/") {
        let alt = resolve_asset_path(&adir, stripped)?;
        if alt.is_file() {
            return Ok(alt);
        }
    }
    Err(ApiError::not_found("Asset not found"))
}

// ---------------------------------------------------------------------------
// Story HTML (preview / export)
// ---------------------------------------------------------------------------

static LEGACY_ASSET_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"/api/assets/[^/]+/([^)"\s,}]+)"#).expect("valid regex"));

/// Rewrite legacy `/api/assets/<project>/<path>` URLs to relative
/// `assets/<path>` in every string value of every object (like main.py).
pub fn rewrite_asset_urls(v: &mut Value) {
    match v {
        Value::Object(map) => {
            for val in map.values_mut() {
                if let Value::String(s) = val {
                    if s.contains("/api/assets/") {
                        *s = LEGACY_ASSET_RE.replace_all(s, "assets/$1").into_owned();
                    }
                } else {
                    rewrite_asset_urls(val);
                }
            }
        }
        Value::Array(items) => items.iter_mut().for_each(rewrite_asset_urls),
        _ => {}
    }
}

/// Inject the story into `template.html`: optional `<base href>`, inline the
/// stylesheet, then `const STORY_DATA = …;` with `</` escaped as `<\/` so story
/// text can never close the `<script>` element.
pub fn build_story_html(template: &str, css: Option<&str>, data: &Value, base_href: Option<&str>) -> ApiResult<String> {
    let mut html = template.to_string();
    if let Some(base) = base_href {
        let escaped = base.replace('&', "&amp;").replace('"', "&quot;");
        html = html.replacen("<head>", &format!("<head>\n<base href=\"{escaped}\">"), 1);
    }
    if let Some(css) = css {
        html = html.replace(STYLESHEET_LINK, &format!("<style>\n{css}\n</style>"));
    }
    let story_json = serde_json::to_string_pretty(data)?.replace("</", "<\\/");
    Ok(html.replace(STORY_PLACEHOLDER, &format!("const STORY_DATA = {story_json};")))
}

/// `{name, variables, setup, nodes}` with every group's raw nodes and legacy
/// asset URLs rewritten to `assets/…`.
pub fn story_payload(root: &Path, name: &str) -> ApiResult<Value> {
    let safe = safe_name(name)?;
    let (setup, variables, nodes) = load_raw(root, name, None)?;
    let mut data = json!({ "name": safe, "variables": variables, "setup": setup, "nodes": nodes });
    rewrite_asset_urls(&mut data);
    Ok(data)
}

/// Standalone game HTML for the in-app preview; `base_href` points relative
/// `assets/…` URLs at the project folder (the `nfasset` protocol in the app).
pub fn preview_html(root: &Path, name: &str, template: &str, css: Option<&str>, base_href: &str) -> ApiResult<String> {
    let data = story_payload(root, name)?;
    let html = build_story_html(template, css, &data, Some(base_href))?;
    // Preview-only flag: the runtime then loads images/video/audio in CORS
    // mode, which WebKit requires for nfasset:// media on an http:// page
    // (the `cargo tauri dev` server). Exports never get it.
    Ok(html.replacen("</head>", "<script>window.NF_ASSET_CORS = true;</script>\n</head>", 1))
}

fn is_precompressed(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).as_deref(),
        Some(
            "png" | "jpg" | "jpeg" | "gif" | "webp" | "avif" | "mp3" | "ogg" | "oga" | "opus" | "m4a" | "aac" | "flac" | "mp4"
                | "m4v" | "webm" | "mov" | "woff" | "woff2" | "zip" | "gz"
        )
    )
}

fn walk_files(dir: &Path, out: &mut Vec<PathBuf>) -> io::Result<()> {
    let mut entries: Vec<_> = fs::read_dir(dir)?.filter_map(|e| e.ok()).collect();
    entries.sort_by_key(|e| e.file_name());
    for e in entries {
        let p = e.path();
        if p.is_dir() {
            walk_files(&p, out)?;
        } else if p.is_file() {
            out.push(p);
        }
    }
    Ok(())
}

/// Write `<dest>` as a zip: `index.html` (the full game) + `assets/**`.
/// Assets are streamed from disk (not buffered in memory); already-compressed
/// media is stored rather than deflated. The zip is written to a temp file in
/// the destination folder and renamed into place when complete.
pub fn export_zip(root: &Path, name: &str, template: &str, css: Option<&str>, dest: &Path) -> ApiResult<PathBuf> {
    use zip::write::SimpleFileOptions;
    use zip::CompressionMethod;

    let data = story_payload(root, name)?;
    let html = build_story_html(template, css, &data, None)?;
    let adir = assets_dir(root, name)?;

    let parent = dest.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or(Path::new("."));
    fs::create_dir_all(parent)?;
    let tmp = tempfile::NamedTempFile::new_in(parent)?;
    {
        let mut zw = zip::ZipWriter::new(tmp.as_file());
        let deflate = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        let stored = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        let zerr = |e: zip::result::ZipError| ApiError::internal(format!("Export failed: {e}"));
        zw.start_file("index.html", deflate).map_err(zerr)?;
        zw.write_all(html.as_bytes())?;
        if adir.is_dir() {
            let mut files = Vec::new();
            walk_files(&adir, &mut files)?;
            for f in files {
                let arc = format!("assets/{}", rel_string(&adir, &f));
                zw.start_file(arc, if is_precompressed(&f) { stored } else { deflate }).map_err(zerr)?;
                let mut src = fs::File::open(&f)?;
                io::copy(&mut src, &mut zw)?;
            }
        }
        zw.finish().map_err(zerr)?;
    }
    tmp.as_file().sync_all()?;
    tmp.persist(dest).map_err(|e| ApiError::from(e.error))?;
    Ok(dest.to_path_buf())
}
