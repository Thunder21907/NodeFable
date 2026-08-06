"""Restricted JavaScript *expression* evaluator for extracting SugarCube constants.

Only a deliberately small, JSON-safe subset of JS expressions is supported —
enough to resolve story constants that are literal at build time:

- literals: numbers, strings ('...' / "..."), booleans, ``null``, ``undefined``
- arrays  : ``[a, b, c]``
- objects : ``{key: v, "key": v}`` (plain object, keys become strings)
- ``new Map([ [k, v], ...])``  -> converted to a plain object (guide-compliant)
- arithmetic: ``+  -  *  /``   (``+`` also does string concatenation)
- unary ``-``
- parenthesised sub-expressions
- member access ``.prop`` against already-resolved ``setup.*`` constants
- whitelisted ``Math.*`` (floor/ceil/round/min/max/abs/random is *not* stable)

Anything else (function calls other than Map/whitelisted Math, ``new`` of
other types, logical operators, ternaries, template literals, and so on)
raises :class:`Unresolved` and the caller flags the constant as unresolved.

This intentionally does **not** execute arbitrary JS: an AST whitelist bounds
what can run and a constrained globals dict is supplied to ``eval``. The
source is author-driven (a story file the user chose to import), but we still
keep to the safe subset.
"""

import ast
import math
import re

__all__ = ["Unresolved", "dir_type", "evaluate", "try_evaluate"]


class Unresolved(Exception):
    """Raised when an expression uses constructs outside the safe subset."""


# ---------------------------------------------------------------------------
# Whitelisted globals provided to the evaluator
# ---------------------------------------------------------------------------

class _MathShim:
    """A tiny namespace exposing deterministic ``Math`` functions."""
    floor = staticmethod(math.floor)
    ceil = staticmethod(math.ceil)
    round = staticmethod(round)
    trunc = staticmethod(math.trunc)
    abs = staticmethod(abs)
    min = staticmethod(min)
    max = staticmethod(max)
    sqrt = staticmethod(math.sqrt)
    pow = staticmethod(pow)


def _make_map(*pairs):
    """Map constructor: ``new Map([ [k, v], ...])`` -> plain dict."""
    if not pairs:
        return {}
    if len(pairs) == 1 and isinstance(pairs[0], (list, tuple)):
        return dict(pairs[0])
    return dict(pairs)


_RESERVED = {
    "Math": _MathShim(),
    "Map": _make_map,
    "undefined": None,
    "NaN": float("nan"),
    "Infinity": float("inf"),
    "Number": (lambda v: float(v)),
}


# ---------------------------------------------------------------------------
# Pre-processing
# ---------------------------------------------------------------------------

def _strip_new_map(source: str) -> str:
    """Replace ``new Map(<args>)`` tokens with ``_nf_map(<args>)``.

    Uses a balanced-paren scan so nested arrays ``[ [k, v], ... ]`` are kept.
    """
    def repl(m):
        return "_nf_map" + m.group(1)
    return re.sub(r"\bnew\s+Map(\([^)]*\))", repl, source)


_WORD_RE = re.compile(r"\b(?:undefined|true|false|null)\b")
_VAR_RE = re.compile(r"\$([A-Za-z_]\w*)")
_TOKENS = {"undefined": "None", "true": "True", "false": "False", "null": "None"}


def _preprocess_js(source: str) -> str:
    """String-aware JS preprocessor.

    Outside string literals: strips ``/* */`` and ``//`` comments, maps
    ``undefined/true/false/null`` to Python spellings, and rewrites ``$var``
    identifiers to ``__nf_var_<name>``. String/template literal contents are
    left verbatim so keys/values like ``"$Gen"`` are untouched.
    """
    parts = []
    i = 0
    n = len(source)
    while i < n:
        ch = source[i]
        # string literal -> copy verbatim (handling escapes)
        if ch in ("'", '"', "`"):
            start = i
            i += 1
            while i < n:
                c = source[i]
                if c == "\\":
                    i += 2
                    continue
                if c == ch:
                    i += 1
                    break
                i += 1
            parts.append(source[start:i])
            continue
        # block comment
        if ch == "/" and i + 1 < n and source[i + 1] == "*":
            end = source.find("*/", i + 2)
            i = n if end == -1 else end + 2
            parts.append(" ")
            continue
        # line comment
        if ch == "/" and i + 1 < n and source[i + 1] == "/":
            end = source.find("\n", i + 2)
            i = n if end == -1 else end
            continue
        parts.append(ch)
        i += 1

    text = "".join(parts)

    # rewrite tokens only in code segments (split again on strings)
    out = []
    i = 0
    n = len(text)
    while i < n:
        ch = text[i]
        if ch in ("'", '"', "`"):
            start = i
            i += 1
            while i < n:
                c = text[i]
                if c == "\\":
                    i += 2
                    continue
                if c == ch:
                    i += 1
                    break
                i += 1
            out.append(text[start:i])
            continue
        # find next token boundary
        j = i
        while j < n and not (text[j] in ("'", '"', "`")):
            j += 1
        seg = text[i:j]
        seg = _WORD_RE.sub(lambda m: _TOKENS[m.group(0)], seg)
        seg = _VAR_RE.sub(r"__nf_var_\1", seg)
        out.append(seg)
        i = j
    return "".join(out)


# ---------------------------------------------------------------------------
# AST validation / normalisation
# ---------------------------------------------------------------------------

_ALLOWED = (
    ast.Expression, ast.Constant, ast.List, ast.Tuple, ast.Dict,
    ast.UnaryOp, ast.USub, ast.BinOp, ast.Add, ast.Sub, ast.Mult, ast.Div,
    ast.Call, ast.Attribute, ast.Name,
)


def _validate_and_normalise(node):
    """Return a transformed node, raising Unresolved on anything unsafe.

    Object-literal bare keys (``{key: v}``) arrive as ``Name`` keys in a
    ``ast.Dict``; JS semantics treat them as string keys, so they are replaced
    with string ``Constant``s here.
    """
    if isinstance(node, ast.Expression):
        node.body = _validate_and_normalise(node.body)
        return node
    if isinstance(node, ast.Dict):
        keys = []
        for k in node.keys:
            if k is None:                      # ``{...spread}``
                raise Unresolved("object spread")
            if isinstance(k, ast.Name) and k.id not in ("True", "False", "None", "undefined"):
                k = ast.Constant(value=k.id)
            keys.append(_validate_and_normalise(k))
        vals = [_validate_and_normalise(v) for v in node.values]
        # rebuild dict to keep guards simple
        d = ast.Dict()
        d.keys = keys
        d.values = vals
        return d
    if isinstance(node, ast.Call):
        func = node.func
        name = func.id if isinstance(func, ast.Name) else (
            func.attr if isinstance(func, ast.Attribute) and isinstance(func.value, ast.Name)
            and func.value.id == "Math" else None
        )
        if name not in ("_nf_map", "floor", "ceil", "round", "trunc", "abs", "min", "max", "sqrt", "pow"):
            raise Unresolved(f"call to unsupported '{name}'")
        if len(node.keywords):
            raise Unresolved("keyword arguments")
        args = [_validate_and_normalise(a) for a in node.args]
        c = ast.Call(func=func, args=args, keywords=[])
        return c
    if isinstance(node, ast.Attribute):
        _validate_and_normalise(node.value)
        return node
    if isinstance(node, ast.Name):
        if node.id in _RESERVED or node.id == "_nf_map" or node.id.startswith("__nf_var_"):
            return node
        raise Unresolved(f"free identifier '{node.id}'")
    if isinstance(node, ast.List):
        node.elts = [_validate_and_normalise(e) for e in node.elts]
        return node
    if isinstance(node, ast.Tuple):
        node.elts = [_validate_and_normalise(e) for e in node.elts]
        return node
    if isinstance(node, ast.UnaryOp):
        if not isinstance(node.op, ast.USub):
            raise Unresolved("unsupported unary op")
        node.operand = _validate_and_normalise(node.operand)
        return node
    if isinstance(node, ast.BinOp):
        if not isinstance(node.op, (ast.Add, ast.Sub, ast.Mult, ast.Div)):
            raise Unresolved("unsupported binary op")
        node.left = _validate_and_normalise(node.left)
        node.right = _validate_and_normalise(node.right)
        return node
    if isinstance(node, ast.Constant) and isinstance(node.value, (str, int, float, bool)) or (
        isinstance(node, ast.Constant) and node.value is None
    ):
        return node
    raise Unresolved(f"unsupported syntax {type(node).__name__}")


def _can_evaluate(node, scope) -> bool:
    """Cheap pre-check: reject clear non-JSON outputs we can't serialise."""
    ok_types = (bool, int, float, str, list, dict, type(None))
    if isinstance(node, (ast.List, ast.Tuple, ast.Dict)):
        for child in (_validate_and_normalise(node).elts if isinstance(node, (ast.List, ast.Tuple))
                      else _validate_and_normalise(node).values):
            if not _can_evaluate(child, scope):
                return False
        return True
    return True


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def dir_type(value) -> str:
    """Map a resolved Python value to a JSON-ish type name."""
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "bool"
    if isinstance(value, int):
        return "int"
    if isinstance(value, float):
        return "float"
    if isinstance(value, str):
        return "string"
    if isinstance(value, (list, tuple)):
        return "array"
    if isinstance(value, dict):
        return "dict"
    return "other"


def evaluate(source: str, scope: dict, vars_scope: dict = None):
    """Evaluate a JS expression string against constant ``scope``.

    ``scope`` maps already-resolved ``setup`` constants by name so expressions
    like ``setup.foo + 1`` resolve. ``vars_scope`` (optional) maps resolved
    ``$variables`` by name (without the ``$``) so string concatenation like
    ``"passages/profile/" + $base + ".jpg"`` resolves too. Returns a JSON-safe
    Python value or raises :class:`Unresolved`.
    """
    src = source.strip()
    if not src:
        raise Unresolved("empty expression")
    src = _preprocess_js(src)
    src = _strip_new_map(src)
    try:
        tree = ast.parse(src, mode="eval")
    except SyntaxError as e:
        raise Unresolved(f"syntax error: {e.msg}") from e

    tree = _validate_and_normalise(tree)

    if not _can_evaluate(tree, scope):
        raise Unresolved("non-serialisable value")

    globals_dict = dict(_RESERVED)
    globals_dict["_nf_map"] = _make_map
    globals_dict["setup"] = scope
    # sugar: bare references to setup constants
    for k, v in scope.items():
        globals_dict.setdefault(k, v)
    # sugar: $variable references inside concatenation
    for k, v in (vars_scope or {}).items():
        globals_dict[f"__nf_var_{k}"] = v

    # Re-compile from a fresh ast to avoid touching the caller's node.
    expr = ast.fix_missing_locations(ast.copy_location(tree, tree))
    code = compile(expr, "<sugarcube-const>", "eval")

    try:
        value = eval(code, {"__builtins__": {}}, globals_dict)
    except Exception as e:                      # noqa: BLE001
        raise Unresolved(f"eval failure: {e}") from e

    if isinstance(value, tuple):
        value = list(value)
    _ensure_json_safe(value)
    return value


def _ensure_json_safe(value):
    """Recursively reject anything that won't survive JSON (e.g. NaN/Inf)."""
    if isinstance(value, float) and (value != value or value in (float("inf"), float("-inf"))):
        raise Unresolved("non-finite number")
    if isinstance(value, list):
        for item in value:
            _ensure_json_safe(item)
    elif isinstance(value, dict):
        for k, v in value.items():
            if not isinstance(k, (str, int, float, bool)):
                raise Unresolved(f"non-JSON object key: {k!r}")
            _ensure_json_safe(v)


def try_evaluate(source: str, scope: dict, vars_scope: dict = None):
    """Return ``(value, resolved)`` — never raises."""
    try:
        return evaluate(source, scope, vars_scope), True
    except Unresolved:
        return None, False