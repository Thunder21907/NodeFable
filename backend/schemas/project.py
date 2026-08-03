from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional, Union

# Supported types for game variables (bool, int, float, str, list)
VariableValue = Union[bool, int, float, str, list]

class ChoiceLink(BaseModel):
    target_node_id: str = Field(..., description="The ID of the node this choice leads to")
    text: str = Field(..., description="The text displayed on the button for this choice")
    prerequisite: Optional[str] = Field(None, description="JS expression evaluated before showing/enabling this choice")
    mutation: Optional[str] = Field(None, description="JS statement executed when this choice is selected")

class OnEnter(BaseModel):
    condition: Optional[str] = Field(None, description="JS condition to trigger redirect")
    target_node_id: str = Field(..., description="Node to redirect to")
    mutation: Optional[str] = Field(None, description="JS mutation before redirect")

class NodeData(BaseModel):
    id: str = Field(..., description="Unique identifier for the node")
    title: str = Field(..., description="The title of the passage/node")
    text: str = Field(..., description="The content of the story text for this node")
    x: float = Field(0.0, description="Canvas X coordinate")
    y: float = Field(0.0, description="Canvas Y coordinate")
    choices: List[ChoiceLink] = Field(default_factory=list)
    on_enter: Optional[OnEnter] = Field(None, description="Auto-redirect on entering this node")
    is_start: bool = Field(False, description="If true, this node is the starting point of the game")
    group: str = Field("side_panel", description="The group this node belongs to")

class GroupSlugInfo(BaseModel):
    slug_id: str = Field(..., description="Node slug identifier")
    connections: List[str] = Field(default_factory=list, description="List of target node slugs this node connects to")

class GroupInfo(BaseModel):
    id: str = Field(..., description="Group identifier")
    label: str = Field(..., description="Human-readable group label")
    node_count: int = Field(0, description="Number of nodes in this group")
    slug_ids: List[GroupSlugInfo] = Field(default_factory=list, description="List of node slug info with connections")

class ManifestSchema(BaseModel):
    name: str = Field(..., description="Project name")
    version: int = Field(2, description="Schema version")
    variables: Dict[str, VariableValue] = Field(default_factory=dict)
    groups: List[GroupInfo] = Field(default_factory=list, description="List of groups")

class GroupDataSchema(BaseModel):
    group_id: str = Field(..., description="Group identifier")
    nodes: List[NodeData] = Field(default_factory=list)

class ProjectSchema(BaseModel):
    variables: Dict[str, VariableValue] = Field(default_factory=dict)
    nodes: List[NodeData] = Field(default_factory=list)
