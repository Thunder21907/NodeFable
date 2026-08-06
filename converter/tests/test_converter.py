"""Unit tests for the SugarCube -> NodeFable converter (step 1).

Run with:  python -m unittest discover converter/tests
"""

import unittest

from converter import js_eval
from converter.extract import iter_macros, scan_globals, split_commas
from converter.registry import build_registry
from converter.twine_parser import parse_text

# ---------------------------------------------------------------------------
# Synthetic SugarCube export
# ---------------------------------------------------------------------------

SAMPLE = """<!DOCTYPE html>
<html><head><meta name="format" content="SugarCube">
<title>Sample</title></head><body>
<tw-storydata name="My Test Story" startnode="2" ifid="ABCD-1234"
              format="SugarCube" format-version="2.37.3" hidden>
<style role="stylesheet" type="text/twine-css">body{}</style>
<script role="script" type="text/twine-javascript">window.setup=window.setup||{};</script>
<tw-passagedata name="StoryInit" pid="1" tags="" position="100,100" size="100,100">
&lt;&lt;set $cash to 500&gt;&gt;
&lt;&lt;set $name to "Alex"&gt;&gt;
&lt;&lt;set $fragile, $done to true, false&gt;&gt;
&lt;&lt;set setup.author to "Sandra"&gt;&gt;
&lt;&lt;set setup.stats_name to new Map([
  ["$HP", "Health"],
  ["$MP", "Magic"],
])&gt;&gt;
&lt;&lt;run setup.timers.push("$mins")&gt;&gt;
&lt;&lt;IncludeAtInitOnce "ProfileInit"&gt;&gt;
</tw-passagedata>
<tw-passagedata name="ProfileInit" pid="9" tags="" position="100,100" size="100,100">
&lt;&lt;set $base to "Fem0_Blonde"&gt;&gt;
&lt;&lt;set $profilepic to "passages/profile/" + $base + "_thumb.jpg"&gt;&gt;
&lt;&lt;set setup.content_warnings to ["Humiliation", "BDSM"]&gt;&gt;
</tw-passagedata>
<tw-passagedata name="Start" pid="2" tags="" position="100,100" size="100,100">
You wake up. [[Go to the forest|Forest]]
</tw-passagedata>
<tw-passagedata name="Forest" pid="3" tags="" position="200,100" size="100,100">
Tall trees. [[Home|Home]]
</tw-passagedata>
<tw-passagedata name="Home" pid="4" tags="" position="300,100" size="100,100">
Cozy.
</tw-passagedata>
<tw-passagedata name="Secret Script" pid="5" tags="script" position="0,0" size="0,0">
console.log("hi");
</tw-passagedata>
<tw-passagedata name="Theme" pid="6" tags="stylesheet" position="0,0" size="0,0">
html{}
</tw-passagedata>
<tw-passagedata name="Badge" pid="7" tags="widget" position="0,0" size="0,0">
&lt;&lt;widget "badge"&gt;&gt;...&lt;&lt;/widget&gt;&gt;
</tw-passagedata>
</tw-storydata>
</body></html>
"""


class TestParser(unittest.TestCase):
    def setUp(self):
        self.story = parse_text(SAMPLE)

    def test_story_metadata(self):
        self.assertEqual(self.story.title, "My Test Story")
        self.assertEqual(self.story.ifid, "ABCD-1234")
        self.assertEqual(self.story.format, "SugarCube")
        self.assertEqual(self.story.format_version, "2.37.3")
        self.assertEqual(self.story.startnode_pid, "2")

    def test_passage_count(self):
        self.assertEqual(len(self.story.passages), 8)

    def test_classification(self):
        kinds = {n: p.kind for n, p in self.story.passages.items()}
        self.assertEqual(kinds["StoryInit"], "special")
        self.assertEqual(kinds["Start"], "content")
        self.assertEqual(kinds["Secret Script"], "script")
        self.assertEqual(kinds["Theme"], "stylesheet")
        self.assertEqual(kinds["Badge"], "widget")

    def test_unescape(self):
        self.assertIn("<<set $cash to 500>>", self.story.passages["StoryInit"].text)
        self.assertIn("[[Go to the forest|Forest]]",
                      self.story.passages["Start"].text)

    def test_position(self):
        self.assertEqual(self.story.passages["Forest"].position, (200.0, 100.0))


class TestJsEval(unittest.TestCase):
    def test_literals(self):
        self.assertEqual(js_eval.evaluate("500", {}), 500)
        self.assertEqual(js_eval.evaluate('"Alex"', {}), "Alex")
        self.assertEqual(js_eval.evaluate("true", {}), True)
        self.assertEqual(js_eval.evaluate("[1, 2, 3]", {}), [1, 2, 3])

    def test_object_literal(self):
        self.assertEqual(
            js_eval.evaluate("{ desc: 'Pants', price: 40, tags: [] }", {}),
            {"desc": "Pants", "price": 40, "tags": []},
        )

    def test_map_becomes_dict(self):
        out = js_eval.evaluate(
            'new Map([["$HP", "Health"], ["$MP", "Magic"]])', {})
        self.assertEqual(out, {"$HP": "Health", "$MP": "Magic"})

    def test_map_with_comments(self):
        out = js_eval.evaluate(
            'new Map([\n'
            '  /* a comment with "quotes" and ] */\n'
            '  ["a", { x: 1 }], // line comment\n'
            '  ["b", 2],\n'
            '])', {})
        self.assertEqual(out, {"a": {"x": 1}, "b": 2})

    def test_string_keys_not_mangled(self):
        self.assertEqual(js_eval.evaluate('"$Gen"', {}), "$Gen")

    def test_var_concat(self):
        out = js_eval.evaluate(
            '"passages/profile/" + $base + "_thumb.jpg"', {}, {"base": "Fem0_Blonde"})
        self.assertEqual(out, "passages/profile/Fem0_Blonde_thumb.jpg")

    def test_math(self):
        self.assertEqual(js_eval.evaluate("Math.floor(2.7)", {}), 2)

    def test_unresolved(self):
        with self.assertRaises(js_eval.Unresolved):
            js_eval.evaluate("setup.missing.splice(1)", {})
        with self.assertRaises(js_eval.Unresolved):
            js_eval.evaluate("someFunc(1)", {})


class TestExtract(unittest.TestCase):
    def setUp(self):
        self.story = parse_text(SAMPLE)
        self.result = scan_globals(self.story.passages)

    def test_init_includes_followed(self):
        self.assertIn("ProfileInit", self.result.init_passages)

    def test_variables(self):
        v = self.result.variables
        self.assertEqual(v["cash"]["value"], 500)
        self.assertEqual(v["name"]["value"], "Alex")
        self.assertTrue(v["fragile"]["resolved"])
        self.assertEqual(v["fragile"]["value"], True)
        self.assertEqual(v["done"]["value"], False)

    def test_var_concat_resolved(self):
        self.assertEqual(
            self.result.variables["profilepic"]["value"],
            "passages/profile/Fem0_Blonde_thumb.jpg",
        )

    def test_constants(self):
        c = self.result.constants
        self.assertEqual(c["author"]["value"], "Sandra")
        self.assertEqual(c["stats_name"]["value"], {"$HP": "Health", "$MP": "Magic"})
        self.assertEqual(c["content_warnings"]["value"], ["Humiliation", "BDSM"])

    def test_mutated_constants(self):
        self.assertIn("timers", self.result.mutated_constants)


class TestMacroScanner(unittest.TestCase):
    def test_multiline_map_not_swallowing(self):
        text = (
            "<<set setup.a to new Map([\n"
            '  ["k", { v: 1 }],\n'
            '])>>\n'
            "<<set $x to 1>>\n"
        )
        macros = list(iter_macros(text))
        self.assertEqual(len(macros), 2)
        self.assertIn("new Map", macros[0][1])
        self.assertEqual(macros[1][1].strip(), "$x to 1")

    def test_split_commas_respects_groups(self):
        self.assertEqual(
            split_commas('{ a: [1,2], b: 3 }, 4'),
            ['{ a: [1,2], b: 3 }', ' 4'],
        )


class TestRegistry(unittest.TestCase):
    def setUp(self):
        import tempfile, os
        self.tmp = tempfile.NamedTemporaryFile("w", suffix=".html",
                                               delete=False, encoding="utf-8")
        self.tmp.write(SAMPLE)
        self.tmp.close()
        self.registry = build_registry(self.tmp.name)

    def tearDown(self):
        import os
        os.unlink(self.tmp.name)

    def test_title_and_start(self):
        self.assertEqual(self.registry["title"], "My Test Story")
        self.assertEqual(self.registry["start_passage"], "Start")

    def test_counts(self):
        self.assertEqual(len(self.registry["passages"]), 8)
        self.assertGreaterEqual(len(self.registry["variables"]), 5)
        self.assertGreaterEqual(len(self.registry["constants"]), 3)

    def test_all_resolved(self):
        self.assertFalse(
            [n for n, i in self.registry["variables"].items() if not i["resolved"]])
        self.assertFalse(
            [n for n, i in self.registry["constants"].items() if not i["resolved"]])


if __name__ == "__main__":
    unittest.main()