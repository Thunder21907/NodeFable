"""Extract global variables and setup constants from SugarCube init passages.

Operates on already-unescaped passage text. It understands the two real-world
ways a SugarCube story declares globals:

- ``<<set $var to <expr>>``            -> a story variable (NodeFable ``state``)
- ``<<set setup.const to <expr>>``     -> an immutable constant (NodeFable ``setup``)
- ``<<run setup.const.xxx(...)>>``     -> a runtime mutation of a constant (noted)
- ``<<IncludeAtInitOnce "Name">>>`` custom init-include widgets pull in more
  init passages, which are followed transitively so every global is found even
  though the definitions are spread across ``*Init`` passages.

Values are resolved with :mod:`converter.js_eval`; anything outside the safe
JS subset is flagged ``resolved: false`` and preserved for a later stage.
"""

import re

from .js_eval import Unresolved, dir_type, evaluate

__all__ = ["INCLUDE_MACROS", "ScanResult", "scan_globals"]

INCLUDE_MACROS = {
    "includeatinitonce",
    "includeatonce",
    "include",
    "display",
}

VARIABLE_TARGET = re.compile(r"^\$(\w+)$")
CONSTANT_TARGET = re.compile(r"^setup\.(\w+)$")
BASE_TARGET = re.compile(r"^[a-zA-Z_]\w*$")

RUN_CONSTANT = re.compile(r"\bsetup\.(\w+)\b")

_ASSIGNED_RE = re.compile(
    r"^(?P<target>[^\s]+)\s+(?:to|=)\s+(?P<value>.*)$", re.IGNORECASE | re.DOTALL
)


class ScanResult:
    """Globals discovered across the resolved init-passage set."""

    def __init__(self):
        # name -> {"value":..., "resolved":bool, "type":str, "expression":str,
        #          "defined_in":[passage names]}
        self.variables = {}
        self.constants = {}
        # Constant names reached only via <<run ...>> mutations (no value).
        self.mutated_constants = set()
        self.init_passages = []          # ordered list of passages scanned

    def to_dict(self):
        def _entry(d):
            out = {}
            for name, info in d.items():
                out[name] = {
                    "value": info.get("value"),
                    "resolved": info.get("resolved", True),
                    "type": info.get("type"),
                    "expression": info.get("expression"),
                    "defined_in": list(info.get("defined_in", [])),
                }
            return out
        return {
            "init_passages": list(self.init_passages),
            "variables": _entry(self.variables),
            "constants": _entry(self.constants),
            "mutated_constants": sorted(self.mutated_constants),
        }


# ---------------------------------------------------------------------------
# Macro scanning helpers
# ---------------------------------------------------------------------------

def iter_macros(text):
    """Yield ``(macro_name, args_str)`` for every top-level ``<<...>>`` block.

    Quote-, comment-, and bracket-aware. A ``>>`` inside a string, a ``/* */``
    or ``//`` comment, or inside a balanced ``( [ {`` group does not close the
    macro — this keeps multi-line ``<<set ... to new Map([...])>>`` literals
    from swallowing the following macros.
    """
    i = 0
    n = len(text)
    while i < n:
        start = text.find("<<", i)
        if start == -1:
            return
        j = start + 2
        depth = 0          # nested << >>
        stack = []         # open ( [ {  not inside a string/comment
        quote = None
        while j < n:
            ch = text[j]
            nxt = text[j + 1] if j + 1 < n else ""
            if quote:
                if ch == quote and text[j - 1] != "\\":
                    quote = None
                j += 1
                continue
            if ch in ("'", '"', "`"):
                quote = ch
                j += 1
                continue
            if ch == "/" and nxt == "*":            # block comment
                k = text.find("*/", j + 2)
                j = n if k == -1 else k + 2
                continue
            if ch == "/" and nxt == "/":            # line comment
                k = text.find("\n", j + 2)
                j = n if k == -1 else k
                continue
            if ch == "<" and nxt == "<":
                depth += 1
                j += 2
                continue
            if ch == ">" and nxt == ">":
                if depth > 0:
                    depth -= 1
                elif not stack:
                    break
                j += 2
                continue
            if ch in "([{":
                stack.append(ch)
                j += 1
                continue
            if ch in ")]}":
                if stack:
                    stack.pop()
                j += 1
                continue
            j += 1
        body = text[start + 2:j]
        name, _, args = body.partition(" ")
        yield name.strip(), args
        i = j + 2


def split_commas(s):
    """Split ``s`` on commas that are not inside () [] {} or quotes."""
    parts = []
    start = 0
    depth = 0
    quote = None
    i = 0
    while i < len(s):
        ch = s[i]
        if quote:
            if ch == quote and s[i - 1] != "\\":
                quote = None
        elif ch in ("'", '"'):
            quote = ch
        elif ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
        elif ch == "," and depth == 0:
            parts.append(s[start:i])
            start = i + 1
        i += 1
    parts.append(s[start:])
    return parts


# ---------------------------------------------------------------------------
# Extraction
# ---------------------------------------------------------------------------

def _resolve_init_passages(passages):
    """Return ordered init passages: StoryInit + transitively-included *Init."""
    ordered = []
    seen = set()
    pending = ["StoryInit"] if "StoryInit" in passages else []

    while pending and len(ordered) < 5000:
        name = pending.pop(0)
        if name in seen or name not in passages:
            continue
        seen.add(name)
        p = passages[name]
        ordered.append(name)
        for macro_name, args in iter_macros(p.text):
            if macro_name.lower() in INCLUDE_MACROS:
                quoted = re.findall(r'"([^"]+)"', args)
                for target in quoted:
                    if target in passages and target not in seen:
                        pending.append(target)
    return ordered


def _record(store, key, value, resolved, expression, passage):
    info = store.setdefault(key, {
        "value": None, "resolved": False, "type": None,
        "expression": None, "defined_in": [],
    })
    info["defined_in"].append(passage)
    if resolved:
        info["value"] = value
        info["resolved"] = True
        info["type"] = dir_type(value)
    else:
        info["type"] = _guess_type(expression)
    if expression is not None and info.get("expression") is None:
        info["expression"] = expression


def _guess_type(expr):
    expr = expr.strip()
    if expr.lower() in ("[]", ):
        return "array"
    if expr.startswith("[") or expr.startswith("new Map") or expr.lower().startswith("new map"):
        return "array"
    if expr.startswith("{"):
        return "dict"
    if expr.startswith(('"', "'", "`")):
        return "string"
    if expr in ("true", "false"):
        return "bool"
    if expr in ("null", "undefined"):
        return "null"
    try:
        float(expr)
        return "int" if expr.isdigit() else "float"
    except ValueError:
        return "other"


def _process_passage(passage, result, scope, var_scope):
    text = passage.text
    for name, args in iter_macros(text):
        low = name.lower()
        if low == "set":
            _apply_set(args, passage.name, result, scope, var_scope)
        elif low == "run":
            _apply_run(args, passage.name, result)


def _apply_set(args, passage, result, scope, var_scope):
    for target, value_src in _parse_assignments(args):
        target = target.strip()
        value_src = value_src.strip()
        if not target or not value_src:
            continue
        vm = VARIABLE_TARGET.match(target)
        cm = CONSTANT_TARGET.match(target)
        if vm:
            try:
                value = evaluate(value_src, scope, var_scope)
                name = vm.group(1)
                _record(result.variables, name, value, True, value_src, passage)
                var_scope[name] = value
            except Unresolved:
                _record(result.variables, vm.group(1), None, False, value_src, passage)
        elif cm:
            try:
                value = evaluate(value_src, scope, var_scope)
                scope[cm.group(1)] = value
                _record(result.constants, cm.group(1), value, True, value_src, passage)
            except Unresolved:
                _record(result.constants, cm.group(1), None, False, value_src, passage)


def _find_assign_sep(s):
    """Index of the first top-level ``to``/``=`` assignment separator.

    Returns the index of the ``to`` (word) or ``=`` token, or None. Scans
    outside quotes and bracket groups so object literals don't confuse it.
    """
    depth = 0
    quote = None
    i = 0
    while i < len(s):
        ch = s[i]
        if quote:
            if ch == quote and s[i - 1] != "\\":
                quote = None
            i += 1
            continue
        if ch in ("'", '"', "`"):
            quote = ch
            i += 1
            continue
        if ch in "([{":
            depth += 1
            i += 1
            continue
        if ch in ")]}":
            depth -= 1
            i += 1
            continue
        if depth == 0:
            if ch == "=":
                return i
            if ch in "tT" and s.startswith("to", i) and \
                    (i == 0 or s[i - 1].isspace()) and \
                    (i + 2 >= len(s) or s[i + 2].isspace()):
                return i
        i += 1
    return None


def _parse_assignments(args):
    """Parse a ``<<set ...>>`` argument string into (target, value) pairs.

    Handles the common single form (``$x to 1``), repeated (``$a to 1,
    $b to 2``) and SugarCube's multi-target shorthand (``$a, $b to 1, 2``
    pairs targets with values positionally).
    """
    sep = _find_assign_sep(args)
    if sep is not None:
        lhs = args[:sep].strip()
        rhs = args[sep:].strip()
        rhs = re.sub(r"^(?:to|=)\s*", "", rhs)
        targets = [t.strip() for t in split_commas(lhs) if t.strip()]
        values = [v.strip() for v in split_commas(rhs) if v.strip()]
        if targets and len(values) == len(targets):
            return list(zip(targets, values))
        if targets and len(values) == 1:
            return [(t, values[0]) for t in targets]

    out = []
    for chunk in split_commas(args):
        m = _ASSIGNED_RE.match(chunk.strip())
        if m:
            out.append((m.group("target").strip(), m.group("value").strip()))
    return out


def _apply_run(args, passage, result):
    for m in RUN_CONSTANT.finditer(args):
        result.mutated_constants.add(m.group(1))


def scan_globals(passages):
    """Scan init passages and return a :class:`ScanResult`."""
    init_names = _resolve_init_passages(passages)
    result = ScanResult()
    result.init_passages = init_names
    scope = {}
    var_scope = {}
    for name in init_names:
        _process_passage(passages[name], result, scope, var_scope)
    return result