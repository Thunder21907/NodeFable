//! Dev-only CLI over the storage layer (not part of the app), used for
//! backend parity checks against the old Python server:
//!   cargo run --example nfcli -- <cmd> <data_root> [args…]
//! cmds: saves | manifest NAME | project NAME [g1,g2] | payload NAME |
//!       assets NAME | save REQUEST.json | export NAME DEST.zip TEMPLATE CSS
use std::path::Path;

use nodefable_lib::storage;

fn main() {
    let a: Vec<String> = std::env::args().skip(1).collect();
    let root = Path::new(&a[1]);
    let out = match a[0].as_str() {
        "saves" => storage::list_saves(root).map(|v| serde_json::to_value(v).unwrap()),
        "manifest" => storage::load_manifest(root, &a[2]),
        "project" => {
            let groups: Option<Vec<String>> = a.get(3).map(|g| g.split(',').map(str::to_string).collect());
            storage::load_project(root, &a[2], groups.as_deref()).map(|v| serde_json::to_value(v).unwrap())
        }
        "payload" => storage::story_payload(root, &a[2]),
        "assets" => storage::list_assets(root, &a[2]).map(|v| serde_json::to_value(v).unwrap()),
        "save" => {
            let req = serde_json::from_slice(&std::fs::read(&a[2]).unwrap()).unwrap();
            storage::save_project(root, &req)
        }
        "export" => {
            let t = std::fs::read_to_string(&a[4]).unwrap();
            let css = std::fs::read_to_string(&a[5]).ok();
            storage::export_zip(root, &a[2], &t, css.as_deref(), Path::new(&a[3])).map(|p| serde_json::json!(p))
        }
        other => panic!("unknown command {other}"),
    };
    match out {
        Ok(v) => println!("{}", serde_json::to_string(&v).unwrap()),
        Err(e) => {
            println!("{}", serde_json::json!({"__error__": e.status, "detail": e.detail}));
        }
    }
}
