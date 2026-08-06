"""Passage classification for a Twine/SugarCube export.

Determines which passages are special/system scaffolding vs. real story
content, so later stages know what to skip, what to mine for variables, and
what becomes a NodeFable node.
"""

__all__ = ["SPECIAL_NAMES", "SYSTEM_TAGS", "classify"]

# Passage names reserved by Twine/SugarCube for metadata or boot logic.
SPECIAL_NAMES = {
    "StoryTitle",
    "StoryData",
    "StoryInit",
    "StoryCaption",
    "StoryMenu",
    "StoryAuthor",
    "StoryIncludes",
    "StorySettings",
    "StoryInterface",
    "StoryExport",
}

# Tag names that mark a passage as engine scaffolding rather than story text.
SYSTEM_TAGS = {
    "script": "script",
    "stylesheet": "stylesheet",
    "widget": "widget",
    "Twine.private": "private",
    "header": "header",
    "footer": "footer",
}


def classify(name: str, tags) -> str:
    """Return a kind string for a passage.

    Priority: reserved special name > recognized system tag > content.
    """
    if name in SPECIAL_NAMES:
        return "special"
    for tag in tags:
        kind = SYSTEM_TAGS.get(tag)
        if kind:
            return kind
        lower = tag.lower()
        if "script" in lower or "stylesheet" in lower or "widget" in lower:
            return SYSTEM_TAGS.get(tag, tag.lower())
    return "content"