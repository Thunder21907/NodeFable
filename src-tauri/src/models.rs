//! Serde models mirroring `backend/schemas/project.py` (Pydantic).
//!
//! Field order matches the Pydantic models so serialized output (`model_dump`
//! order, `None` → `null`, `0.0` floats) is identical to the Python backend.
//! Unknown fields are ignored, like Pydantic's default `extra = "ignore"`.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// Variable value: bool, int, float, str, list or dict (never `null`).
pub type VariableMap = Map<String, Value>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ChoiceLink {
    pub target_node_id: String,
    pub text: String,
    #[serde(default)]
    pub prerequisite: Option<String>,
    #[serde(default)]
    pub mutation: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct OnEnter {
    #[serde(default)]
    pub condition: Option<String>,
    pub target_node_id: String,
    #[serde(default)]
    pub mutation: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct NodeData {
    pub id: String,
    pub title: String,
    pub text: String,
    #[serde(default)]
    pub x: f64,
    #[serde(default)]
    pub y: f64,
    #[serde(default)]
    pub choices: Vec<ChoiceLink>,
    #[serde(default)]
    pub on_enter: Option<OnEnter>,
    #[serde(default)]
    pub is_start: bool,
    #[serde(default)]
    pub is_utility: bool,
    #[serde(default)]
    pub is_function: bool,
    #[serde(default)]
    pub group: Option<String>,
}

/// `POST /api/save` body (`SaveRequest` in main.py).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaveRequest {
    pub name: String,
    #[serde(default)]
    pub variables: VariableMap,
    #[serde(default)]
    pub setup: VariableMap,
    #[serde(default)]
    pub nodes: Vec<NodeData>,
    /// Group metadata (`[{id, label, ...}]`); `None` = not sent.
    #[serde(default)]
    pub groups: Option<Vec<Value>>,
}

/// `GET /api/load` response (`ProjectSchema`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Project {
    pub variables: VariableMap,
    pub setup: VariableMap,
    pub nodes: Vec<NodeData>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SaveEntry {
    pub name: String,
    pub mtime: f64,
}

/// Asset tree entry (`_build_asset_tree`): folders carry `children`, files
/// carry `file_size` + `url`.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(untagged)]
pub enum AssetEntry {
    Folder {
        name: String,
        #[serde(rename = "type")]
        kind: &'static str,
        children: Vec<AssetEntry>,
    },
    File {
        name: String,
        #[serde(rename = "type")]
        kind: &'static str,
        file_size: u64,
        url: String,
    },
}
