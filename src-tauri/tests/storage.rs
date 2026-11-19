//! Integration tests for the Rust storage backend (port of backend/main.py).

use std::fs;
use std::io::Read;
use std::path::Path;

use nodefable_lib::models::{AssetEntry, NodeData, SaveRequest};
use nodefable_lib::protocol::{parse_range, split_asset_path};
use nodefable_lib::storage::{self, *};
use serde_json::{json, Value};
use tempfile::TempDir;

fn node(id: &str, group: Option<&str>, targets: &[&str]) -> NodeData {
    serde_json::from_value(json!({
        "id": id,
        "title": id.to_uppercase(),
        "text": format!("text of {id}"),
        "choices": targets.iter().map(|t| json!({"target_node_id": t, "text": format!("go {t}")})).collect::<Vec<_>>(),
        "group": group,
    }))
    .unwrap()
}

fn req(name: &str, nodes: Vec<NodeData>, groups: Option<Value>) -> SaveRequest {
    serde_json::from_value(json!({
        "name": name,
        "variables": {"hp": 10, "name": "Alex"},
        "setup": {"MAX": 3},
        "nodes": nodes,
        "groups": groups,
    }))
    .unwrap()
}

fn read(path: &Path) -> Value {
    serde_json::from_slice(&fs::read(path).unwrap()).unwrap()
}

#[test]
fn safe_name_matches_python_rules() {
    assert_eq!(safe_name("My Journey").unwrap(), "My Journey");
    assert_eq!(safe_name("a/b\\c").unwrap(), "a_b_c");
    assert_eq!(safe_name("  ..evil<>:*?|\"name..  ").unwrap(), "evilname");
    assert_eq!(safe_name("Ünïcødé-1.0_x").unwrap(), "Ünïcødé-1.0_x");
    assert_eq!(safe_name("./.").unwrap(), "_", "slash becomes _ before stripping dots (as in Python)");
    for bad in ["", "   ", "..", "<>|", "..."] {
        assert_eq!(safe_name(bad).unwrap_err().status, 400, "{bad:?} must be rejected");
    }
    assert_eq!(default_group_label("chapter_2"), "Chapter 2");
    assert_eq!(default_group_label("myGROUP_one"), "Mygroup One");
}

#[test]
fn resolve_asset_path_rejects_traversal_and_symlink_escape() {
    let tmp = TempDir::new().unwrap();
    let assets = tmp.path().join("P/assets");
    fs::create_dir_all(assets.join("bg")).unwrap();
    assert_eq!(resolve_asset_path(&assets, "bg/forest.png").unwrap(), assets.join("bg/forest.png"));
    assert_eq!(resolve_asset_path(&assets, "\\bg\\x.png").unwrap(), assets.join("bg/x.png"));
    assert_eq!(resolve_asset_path(&assets, "").unwrap(), assets);
    for bad in ["../secret", "bg/../../x", "..", "a/../../.."] {
        assert_eq!(resolve_asset_path(&assets, bad).unwrap_err().status, 400, "{bad}");
    }
    #[cfg(unix)]
    {
        fs::create_dir_all(tmp.path().join("outside")).unwrap();
        std::os::unix::fs::symlink(tmp.path().join("outside"), assets.join("link")).unwrap();
        assert_eq!(resolve_asset_path(&assets, "link/file.txt").unwrap_err().status, 400);
    }
}

#[test]
fn save_then_load_roundtrip_partitions_by_group() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();
    let nodes = vec![
        node("side_panel", Some("side_panel"), &[]),
        node("start", None, &["forest"]),
        node("forest", Some("ch1"), &["start", ""]),
    ];
    let res = save_project(root, &req("My Story", nodes, None)).unwrap();
    assert_eq!(res, json!({"status": "ok", "name": "My Story"}));

    let manifest = read(&root.join("My Story/manifest.json"));
    assert_eq!(manifest["version"], 2);
    assert_eq!(manifest["variables"], json!({"hp": 10, "name": "Alex"}));
    assert_eq!(manifest["setup"], json!({"MAX": 3}));
    let ids: Vec<&str> = manifest["groups"].as_array().unwrap().iter().map(|g| g["id"].as_str().unwrap()).collect();
    assert_eq!(ids, ["side_panel", "ch1"], "group-less node goes to side_panel; first-appearance order");
    let sp = &manifest["groups"][0];
    assert_eq!(sp["label"], "Side Panel");
    assert_eq!(sp["node_count"], 2);
    assert_eq!(sp["slug_ids"][1], json!({"slug_id": "start", "connections": ["forest"]}));
    assert_eq!(manifest["groups"][1]["slug_ids"][0]["connections"], json!(["start"]), "empty targets dropped");

    let ch1 = read(&root.join("My Story/groups/ch1.json"));
    assert_eq!(ch1["group_id"], "ch1");
    assert_eq!(ch1["nodes"][0]["x"], json!(0.0));
    assert_eq!(ch1["nodes"][0]["on_enter"], Value::Null, "model_dump-style nulls");
    assert!(fs::read_to_string(root.join("My Story/manifest.json")).unwrap().contains("\n    \"name\""), "4-space indent");

    let all = load_project(root, "My Story", None).unwrap();
    assert_eq!(all.nodes.iter().map(|n| n.id.as_str()).collect::<Vec<_>>(), ["side_panel", "start", "forest"]);
    let only = load_project(root, "My Story", Some(&["ch1".into(), "ch1".into(), " ".into()])).unwrap();
    assert_eq!(only.nodes.len(), 1, "requested groups are de-duplicated");
    assert_eq!(load_project(root, "Nope", None).unwrap_err().status, 404);
}

#[test]
fn unloaded_groups_are_preserved_and_stale_groups_removed() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();
    let meta = |ids: &[&str]| Some(Value::Array(ids.iter().map(|id| json!({"id": id, "label": format!("L-{id}")})).collect()));
    save_project(root, &req("P", vec![node("a", Some("ch1"), &[]), node("b", Some("ch2"), &[])], meta(&["side_panel", "ch1", "ch2"]))).unwrap();

    // ch2 not loaded in the editor (no nodes sent) but still listed → its file is kept untouched.
    let before = fs::read(root.join("P/groups/ch2.json")).unwrap();
    save_project(root, &req("P", vec![node("a", Some("ch1"), &[])], meta(&["side_panel", "ch1", "ch2", "new"]))).unwrap();
    assert_eq!(fs::read(root.join("P/groups/ch2.json")).unwrap(), before);
    let m = read(&root.join("P/manifest.json"));
    let ch2 = m["groups"].as_array().unwrap().iter().find(|g| g["id"] == "ch2").unwrap();
    assert_eq!(ch2["node_count"], 1);
    assert_eq!(ch2["label"], "L-ch2");
    assert_eq!(read(&root.join("P/groups/new.json"))["node_count"], 0, "new empty group file created");

    // Deleted group: no longer listed → file removed.
    save_project(root, &req("P", vec![node("a", Some("ch1"), &[])], meta(&["side_panel", "ch1"]))).unwrap();
    assert!(!root.join("P/groups/ch2.json").exists());
    assert!(!root.join("P/groups/new.json").exists());

    // groups = None (old clients) never deletes files.
    fs::write(root.join("P/groups/keep.json"), "{}").unwrap();
    save_project(root, &req("P", vec![node("a", Some("ch1"), &[])], None)).unwrap();
    assert!(root.join("P/groups/keep.json").exists());
}

#[test]
fn save_validates_name_and_variables() {
    let tmp = TempDir::new().unwrap();
    assert_eq!(save_project(tmp.path(), &req("", vec![], None)).unwrap_err().status, 422);
    assert_eq!(save_project(tmp.path(), &req(&"x".repeat(101), vec![], None)).unwrap_err().status, 422);
    assert_eq!(save_project(tmp.path(), &req("<>", vec![], None)).unwrap_err().status, 400);
    let mut r = req("P", vec![], None);
    r.variables.insert("bad".into(), Value::Null);
    assert_eq!(save_project(tmp.path(), &r).unwrap_err().status, 422);
}

#[test]
fn legacy_project_json_is_migrated() {
    let tmp = TempDir::new().unwrap();
    let pdir = tmp.path().join("Old");
    fs::create_dir_all(&pdir).unwrap();
    fs::write(
        pdir.join("project.json"),
        json!({"variables": {"gold": 5}, "nodes": [
            {"id": "side_panel", "title": "SP", "text": ""},
            {"id": "start", "title": "S", "text": "hi", "choices": [{"target_node_id": "end", "text": "go"}]},
            {"id": "end", "title": "E", "text": "bye"}
        ]})
        .to_string(),
    )
    .unwrap();
    let m = load_manifest(tmp.path(), "Old").unwrap();
    assert!(!pdir.join("project.json").exists());
    assert_eq!(m["variables"], json!({"gold": 5}));
    assert_eq!(m["groups"][0]["id"], "side_panel");
    assert_eq!(m["groups"][1], json!({"id": "default", "label": "Default", "node_count": 2,
        "slug_ids": [{"slug_id": "start", "connections": ["end"]}, {"slug_id": "end", "connections": []}]}));
    let p = load_project(tmp.path(), "Old", None).unwrap();
    assert_eq!(p.nodes[1].group.as_deref(), Some("default"));
}

#[test]
fn orphan_group_files_and_old_slug_ids_are_adopted() {
    let tmp = TempDir::new().unwrap();
    let pdir = tmp.path().join("P");
    fs::create_dir_all(pdir.join("groups")).unwrap();
    fs::write(
        pdir.join("manifest.json"),
        json!({"name": "P", "version": 2, "variables": {}, "setup": {}, "groups": [
            {"id": "ch1", "label": "One", "node_count": 1, "slug_ids": ["a"]},
            {"id": "empty", "label": "E", "node_count": 0, "slug_ids": []}
        ]})
        .to_string(),
    )
    .unwrap();
    let nodes_a = json!([{"id": "a", "title": "A", "text": "", "choices": [{"target_node_id": "z", "text": ""}]}]);
    fs::write(pdir.join("groups/ch1.json"), json!({"nodes": nodes_a}).to_string()).unwrap();
    fs::write(pdir.join("groups/empty.json"), json!({"label": "Filled", "nodes": [{"id": "e1", "title": "", "text": ""}]}).to_string()).unwrap();
    fs::write(pdir.join("groups/zz_orphan.json"), json!({"nodes": [{"id": "o", "title": "", "text": ""}]}).to_string()).unwrap();
    fs::write(pdir.join("groups/broken.json"), "{not json").unwrap();

    let m = load_manifest(tmp.path(), "P").unwrap();
    let g = m["groups"].as_array().unwrap();
    assert_eq!(g[0]["slug_ids"], json!([{"slug_id": "a", "connections": ["z"]}]), "old flat slug_ids upgraded");
    assert_eq!(g[1], json!({"id": "empty", "label": "Filled", "node_count": 1, "slug_ids": [{"slug_id": "e1", "connections": []}]}));
    assert_eq!(g[2]["id"], "zz_orphan");
    assert_eq!(g[2]["label"], "Zz Orphan");
    assert_eq!(g.len(), 3, "unparsable group file skipped");
}

#[test]
fn list_saves_sorted_newest_first() {
    let tmp = TempDir::new().unwrap();
    save_project(tmp.path(), &req("Older", vec![], None)).unwrap();
    std::thread::sleep(std::time::Duration::from_millis(20));
    save_project(tmp.path(), &req("Newer", vec![], None)).unwrap();
    fs::create_dir_all(tmp.path().join("not_a_project")).unwrap();
    let names: Vec<String> = list_saves(tmp.path()).unwrap().into_iter().map(|s| s.name).collect();
    assert_eq!(names, ["Newer", "Older"]);
}

#[test]
fn asset_operations() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();
    save_project(root, &req("P", vec![], None)).unwrap();
    let a = root.join("P/assets");

    let up = upload_asset(root, "P", "C:\\pics\\forest.png", "bg", b"PNG").unwrap();
    assert_eq!(up["rel_path"], "bg/forest.png");
    assert_eq!(fs::read(a.join("bg/forest.png")).unwrap(), b"PNG");
    assert_eq!(upload_asset(root, "P", ".hidden", "", b"x").unwrap()["rel_path"], "hidden");
    assert_eq!(upload_asset(root, "P", "x.png", "../out", b"x").unwrap_err().status, 400);
    assert_eq!(upload_asset(root, "P", "..", "", b"x").unwrap_err().status, 400);
    assert_eq!(upload_asset(root, "Missing", "x.png", "", b"x").unwrap_err().status, 404);

    create_folder(root, "P", "music/sfx").unwrap();
    assert!(a.join("music/sfx").is_dir());

    assert_eq!(rename_asset(root, "P", "bg/forest.png", "woods.png").unwrap()["status"], "ok");
    assert!(a.join("bg/woods.png").exists());
    assert_eq!(rename_asset(root, "P", "bg/woods.png", "a/b").unwrap_err().status, 400);
    assert_eq!(rename_asset(root, "P", "bg/nope.png", "x").unwrap_err().status, 404);
    fs::write(a.join("bg/taken.png"), "t").unwrap();
    assert_eq!(rename_asset(root, "P", "bg/woods.png", "taken.png").unwrap_err().status, 409);

    copy_asset(root, "P", "bg", "bg_copy").unwrap();
    assert!(a.join("bg_copy/woods.png").exists());
    assert_eq!(copy_asset(root, "P", "bg", "bg/inner").unwrap_err().status, 400, "folder into itself");
    move_asset(root, "P", "bg_copy/woods.png", "music/woods.png").unwrap();
    assert!(a.join("music/woods.png").exists() && !a.join("bg_copy/woods.png").exists());
    assert_eq!(move_asset(root, "P", "music/woods.png", "bg/taken.png").unwrap_err().status, 409);

    let tree = list_assets(root, "P").unwrap();
    let names: Vec<String> = tree
        .iter()
        .map(|e| match e {
            AssetEntry::Folder { name, .. } => format!("{name}/"),
            AssetEntry::File { name, .. } => name.clone(),
        })
        .collect();
    assert_eq!(names, ["bg/", "bg_copy/", "music/", "hidden"], "folders first, then files, sorted");
    assert_eq!(serde_json::to_value(&tree[3]).unwrap(), json!({"name": "hidden", "type": "file", "file_size": 1, "url": "/api/assets/P/hidden"}));

    assert_eq!(delete_asset(root, "P", "bg").unwrap()["deleted_count"], 2);
    assert!(!a.join("bg").exists());
    assert_eq!(delete_asset(root, "P", "").unwrap_err().status, 400, "cannot delete assets root");
    assert_eq!(delete_asset(root, "P", "bg").unwrap_err().status, 404);

    assert_eq!(find_asset_file(root, "P", "music/woods.png").unwrap(), a.join("music/woods.png"));
    assert_eq!(find_asset_file(root, "P", "assets/music/woods.png").unwrap(), a.join("music/woods.png"), "legacy assets/ prefix");
    assert_eq!(find_asset_file(root, "P", "music").unwrap_err().status, 404, "folders are not served");
}

#[cfg(unix)]
#[test]
fn deleting_a_symlinked_folder_only_removes_the_link() {
    let tmp = TempDir::new().unwrap();
    save_project(tmp.path(), &req("P", vec![], None)).unwrap();
    let a = tmp.path().join("P/assets");
    fs::create_dir_all(a.join("real")).unwrap();
    fs::write(a.join("real/keep.txt"), "k").unwrap();
    std::os::unix::fs::symlink(a.join("real"), a.join("alias")).unwrap();
    delete_asset(tmp.path(), "P", "alias").unwrap();
    assert!(!a.join("alias").exists());
    assert!(a.join("real/keep.txt").exists());
}

#[test]
fn story_html_escapes_script_close_and_inlines_css() {
    let template = "<html><head><link rel=\"stylesheet\" href=\"template_styles.css\"></head><body><script>\n// __STORY_DATA_PLACEHOLDER__\n</script></body></html>";
    let data = json!({"nodes": [{"text": "</script><script>alert(1)</script> and <link rel=\"stylesheet\" href=\"template_styles.css\">"}]});
    let html = build_story_html(template, Some("body{}"), &data, Some("nfasset://localhost/My%20P/")).unwrap();
    assert_eq!(html.matches("</script>").count(), 1, "only the template's own closing tag");
    assert!(html.contains("<\\/script><script>alert(1)<\\/script>"));
    assert!(html.contains("<head>\n<base href=\"nfasset://localhost/My%20P/\">"));
    assert!(html.contains("<style>\nbody{}\n</style>"));
    assert!(html.contains("href=\\\"template_styles.css\\\">"), "story text is never treated as the stylesheet marker");
    assert!(html.contains("const STORY_DATA = {"));
}

#[test]
fn legacy_asset_urls_are_rewritten() {
    let mut v = json!({"text": "{img: /api/assets/My Proj/bg/forest.png, alt=x} and (/api/assets/P/a.mp3)", "list": [{"t": "/api/assets/P/x.png"}]});
    rewrite_asset_urls(&mut v);
    assert_eq!(v["text"], "{img: assets/bg/forest.png, alt=x} and (assets/a.mp3)", "matches main.py");
    assert_eq!(v["list"][0]["t"], "assets/x.png");
}

#[test]
fn export_zip_contains_game_and_assets() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path().join("data");
    save_project(&root, &req("P", vec![node("start", Some("ch1"), &[])], None)).unwrap();
    upload_asset(&root, "P", "a.png", "bg", b"PNGDATA").unwrap();
    upload_asset(&root, "P", "notes.txt", "", b"hello").unwrap();
    let dest = tmp.path().join("out/P.zip");
    let template = "<head></head><script>// __STORY_DATA_PLACEHOLDER__</script>";
    storage::export_zip(&root, "P", template, None, &dest).unwrap();

    let mut zip = zip::ZipArchive::new(fs::File::open(&dest).unwrap()).unwrap();
    let mut names: Vec<String> = (0..zip.len()).map(|i| zip.by_index(i).unwrap().name().to_string()).collect();
    names.sort();
    assert_eq!(names, ["assets/bg/a.png", "assets/notes.txt", "index.html"]);
    let mut html = String::new();
    zip.by_name("index.html").unwrap().read_to_string(&mut html).unwrap();
    assert!(html.contains("\"id\": \"start\"") && !html.contains("<base"), "export has no <base href>");
    assert_eq!(zip.by_name("assets/bg/a.png").unwrap().compression(), zip::CompressionMethod::Stored);
    let leftovers: Vec<_> = fs::read_dir(tmp.path().join("out")).unwrap().collect();
    assert_eq!(leftovers.len(), 1, "no temp files left behind");
}

#[test]
fn nfasset_url_parsing_and_ranges() {
    assert_eq!(split_asset_path("/My%20Story/assets/bg/forest%20dark.png"), Some(("My Story".into(), "bg/forest dark.png".into())));
    assert_eq!(split_asset_path("/My%20Story%2Fassets%2Fbg%2Fa.png"), Some(("My Story".into(), "bg/a.png".into())), "convertFileSrc form");
    assert_eq!(split_asset_path("/P/other/a.png"), None);
    assert_eq!(split_asset_path("/P/assets/"), None);

    assert_eq!(parse_range("bytes=0-99", 1000), Some(Ok((0, 99))));
    assert_eq!(parse_range("bytes=900-", 1000), Some(Ok((900, 999))));
    assert_eq!(parse_range("bytes=-100", 1000), Some(Ok((900, 999))));
    assert_eq!(parse_range("bytes=0-5000", 1000), Some(Ok((0, 999))));
    assert_eq!(parse_range("bytes=0-", 100_000_000), Some(Ok((0, 4 * 1024 * 1024 - 1))), "open ranges are chunked");
    assert_eq!(parse_range("bytes=1000-", 1000), Some(Err(())));
    assert_eq!(parse_range("items=0-1", 1000), None);
}

#[test]
fn preview_requests_assets_in_cors_mode_but_export_does_not() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path().join("data");
    save_project(&root, &req("P", vec![node("start", Some("ch1"), &[])], None)).unwrap();
    let template = "<html><head><title>t</title></head><body><script>// __STORY_DATA_PLACEHOLDER__</script></body></html>";
    let preview = storage::preview_html(&root, "P", template, None, "nfasset://localhost/P/").unwrap();
    assert_eq!(preview.matches("window.NF_ASSET_CORS = true").count(), 1);
    assert!(preview.find("NF_ASSET_CORS").unwrap() < preview.find("</head>").unwrap(), "flag set before the runtime script runs");
    let dest = tmp.path().join("P.zip");
    storage::export_zip(&root, "P", template, None, &dest).unwrap();
    let mut html = String::new();
    zip::ZipArchive::new(fs::File::open(&dest).unwrap()).unwrap().by_name("index.html").unwrap().read_to_string(&mut html).unwrap();
    assert!(!html.contains("NF_ASSET_CORS"), "exported games keep plain media markup");
}
