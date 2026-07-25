from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional, Union

# Supported types for game variables (bool, int, str)
VariableValue = Union[bool, int, str]

class ChoiceLink(BaseModel):
    target_node_id: str = Field(..., description="The ID of the node this choice leads to")
    text: str = Field(..., description="The text displayed on the button for this choice")
    prerequisite: Optional[str] = Field(None, description="JS expression evaluated before showing/enabling this choice")
    mutation: Optional[str] = Field(None, description="JS statement executed when this choice is selected")

class ActionPair(BaseModel):
    condition: Optional[str] = Field(None, description="Optional JS condition for this pair")
    mutation: str = Field(..., description="JS mutation statement for this pair")

class ActionData(BaseModel):
    id: str = Field(..., description="Unique identifier for this action within the node")
    text: str = Field(..., description="The display text for the action link")
    pairs: List[ActionPair] = Field(default_factory=list, description="List of condition+mutation pairs")

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
    actions: List[ActionData] = Field(default_factory=list)
    on_enter: Optional[OnEnter] = Field(None, description="Auto-redirect on entering this node")
    is_start: bool = Field(False, description="If true, this node is the starting point of the game")

class ProjectSchema(BaseModel):
    variables: Dict[str, VariableValue] = Field(default_factory=dict)
    nodes: List[NodeData] = Field(default_factory=list)
