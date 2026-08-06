"""Parse a Twine export HTML file into story metadata + raw passages.

Only the parts we need for conversion are read:

- the ``<tw-storydata>`` element  -> title, ``startnode`` pid, IFID, format/version
- every ``<tw-passagedata>``      -> ``name``, ``pid``, ``tags``, ``position``,
                                    ``size`` and the raw (escaped) body text

Passage bodies are HTML-unescaped so SugarCube macros (``<<set $x to 1>>``),
links (``[[x|y]]``) and markdown are plain text again for later stages.
"""

import html
import re

from .classifier import classify

__all__ = ["STORYDATA_RE", "PASSAGE_RE", "parse_file", "Passage"]


STORYDATA_RE = re.compile(
    r"<tw-storydata\b(?P<attrs>[^>]*)>(?P<body>.*?)</tw-storydata>",
    re.IGNORECASE | re.DOTALL,
)

PASSAGE_RE = re.compile(
    r"<tw-passagedata\b(?P<attrs>[^>]*)>(?P<body>.*?)</tw-passagedata>",
    re.IGNORECASE | re.DOTALL,
)

ENUM_ATTR = re.compile(r"\b(?P<key>name|pid|tags|position|size)=\"(?P<val>[^\"]*)\"", re.IGNORECASE)


class Passage:
    """One raw passage from a Twine/SugarCube export."""

    __slots__ = ("name", "pid", "tags", "position", "size", "text", "kind")

    def __init__(self, name: str, pid: str, tags: list, position, size, text: str):
        self.name = name
        self.pid = pid
        self.tags = tags or []
        self.position = position      # (x, y) or None
        self.size = size              # (w, h) or None
        self.text = text              # unescaped body
        self.kind = classify(name, self.tags)

    def to_dict(self):
        return {
            "pid": self.pid,
            "tags": list(self.tags),
            "kind": self.kind,
            "position": list(self.position) if self.position else None,
            "size": list(self.size) if self.size else None,
            "text": self.text,
        }


def _parse_attrs(attrs: str):
    def _pair(m):
        key = m.group("key").lower()
        val = m.group("val")
        if key == "tags":
            val = [t for t in val.split(",") if t] if val else []
        elif key == "position":
            val = _pair_coords(val)
        elif key == "size":
            val = _pair_coords(val)
        return key, val
    return dict(_pair(m) for m in ENUM_ATTR.finditer(attrs) if m.group("key") in
                {"name", "pid", "tags", "position", "size"})


def _pair_coords(raw: str):
    """Parse a 'x,y' coordinate string into (float, float) or None."""
    try:
        x, y = raw.split(",", 1)
        return (float(x), float(y))
    except (ValueError, AttributeError):
        return None


def _unescape(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    return html.unescape(text).strip("\n")


class ParsedStory:
    """Full result of parsing a Twine export."""

    def __init__(self, title, startnode_pid, ifid, format, format_version, passages):
        self.title = title
        self.startnode_pid = startnode_pid
        self.ifid = ifid
        self.format = format
        self.format_version = format_version
        self.passages = passages          # dict name -> Passage

    def by_pid(self, pid):
        for p in self.passages.values():
            if p.pid == pid:
                return p
        return None


_STORYDATA_ATTR = re.compile(
    r'\b(?P<key>name|startnode|ifid|format|format-version)="(?P<val>[^"]*)"',
    re.IGNORECASE,
)


def parse_file(path: str) -> ParsedStory:
    """Read an export file and return a :class:`ParsedStory`."""
    with open(path, encoding="utf-8") as f:
        text = f.read()
    return parse_text(text, source=path)


def parse_text(text: str, source: str = "<string>") -> ParsedStory:
    """Parse export HTML given as a string."""
    meta = {"title": None, "startnode_pid": None, "ifid": None,
            "format": None, "format_version": None}
    story_el = STORYDATA_RE.search(text)
    if story_el:
        for m in _STORYDATA_ATTR.finditer(story_el.group("attrs")):
            key = m.group("key").lower()
            if key == "name":
                key = "title"
            elif key == "startnode":
                key = "startnode_pid"
            elif key == "format-version":
                key = "format_version"
            meta[key] = m.group("val")

    passages = {}
    for m in PASSAGE_RE.finditer(text):
        attrs = _parse_attrs(m.group("attrs"))
        name = attrs.get("name")
        if not name:
            continue
        body = _unescape(m.group("body"))
        passages[name] = Passage(
            name=name,
            pid=attrs.get("pid", ""),
            tags=attrs.get("tags", []),
            position=attrs.get("position"),
            size=attrs.get("size"),
            text=body,
        )

    return ParsedStory(
        title=meta["title"],
        startnode_pid=meta["startnode_pid"],
        ifid=meta["ifid"],
        format=meta["format"],
        format_version=meta["format_version"],
        passages=passages,
    )