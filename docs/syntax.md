# NodeFable Engine Syntax — Language Catalogue

The coding language that runs **inside a node's passage text**. This document is the
authoritative reference for every directive, markdown capability, and expression call the
engine understands, and is the primary guide for learning to write with the language and
for refining the Twine/SugarCube → NodeFable converter.

- Each directive is given its **syntax**, its **arguments**, its **output** and its
  **edge-case behavior**.
- After the Quick Reference, a progressively-built **tutorial** teaches how the directives
  work **together**, from a first passage to a complete game scene.
- The final sections catalogue the expression scopes, the runtime API, and the render
  pipeline order, which is where "how they interact" is defined.

> **Source of truth.** This document is verified against the engine code:
>
> - `frontend/editor/template.html` — the single-page runtime (`init()`, the directive
>   walker `_processDirectives`, and the HTML renderer `renderContent`).
> - `frontend/editor/js/codemirror-setup.js` — the editor tokenizer + autocomplete list.
> - `tests/suites/*.test.js` — behavioral tests (`regression`, `back`, `wait`,
>   `live_region`, `audio`, `fn_nodes`, `helpers`, `objects`, `setup`, `tables`).

> **Not this document:** the JSON project schema (node `text`/`choices`/`on_enter`
> structure) lives in `docs/guide.md`; the converter's own docs live in `converter/README.md`.

---

## 1. Quick Reference

### 1.1 Markdown

| Style | Syntax | Output |
|---|---|---|
| Bold | `**text**` | `<strong>` |
| Italic | `*text*` | `<em>` |
| Heading 1 | `# text` (start of line) | `<h1>` |
| Heading 2 | `## text` (start of line) | `<h2>` |
| Heading 3 | `### text` (start of line) | `<h3>` |
| Paragraph | blank line between blocks | `</p><p>` |
| Line break | single newline | `<br>` |
| Link (generic) | `[label](url)` (no `node:` prefix) | stripped to plain `label` |
| Bullet/numbered list | `- item` / `1. item` | **not** converted — literal text (see §3.1) |

### 1.2 Links & choices

| Directive | Purpose |
|---|---|
| `[text](node:slug)` | Clickable choice that navigates to passage `slug`. Needs a matching `choices[]` entry (`target_node_id`, optional `prerequisite`, `mutation`). |
| `[text](node:pre_{print:state.x})` | **Dynamic link** — the slug is built from a variable at render (see L18). |

### 1.3 Display & random

| Directive | Purpose |
|---|---|
| `{print:state.x}` / `{print state.x}` / `{print: state.x}` | Substitute a variable value (roots `state`/`temp`/`setup`, one bracket index `[..]`, dotted-field chain allowed). |
| `{random:max}` | Random integer `0`…`max`, inclusive. |
| `{random:min,max}` | Random integer `min`…`max`, inclusive. |

### 1.4 Conditionals & flow control

| Directive | Purpose |
|---|---|
| `{if: expr}…{elseif: expr}…{else}…{endif}` | Keep only the first truthy branch's text. Nestable. |
| `{while: expr}…{endwhile}` | Repeat body while `expr` true (0+ times). |
| `{do}…{while: expr}` | Repeat body until `expr` false (1+ times). |
| `{for: init; cond; update}…{endfor}` | C-style loop. |
| `{break}` / `{continue}` | Exit / skip iteration of the innermost loop. |
| `{init}…{endinit}` | One-time-per-entry mutation setup; no visible output. |

### 1.5 Mutations & state

| Directive | Purpose |
|---|---|
| `{set: expr}` | Execute a JS statement/expression in the story context at render time. |
| `{unset: state.x}` | Delete `state.x` (also `temp.x`, or `temp` to clear all scratch). |
| `{redirect: slug}` | Auto-navigate on render. `{redirect: back}` = go back in history. |

### 1.6 Composition

| Directive | Purpose |
|---|---|
| `{include: slug}` | Splice another passage's text into place; its choices merge in. |

### 1.7 Actions

| Directive | Purpose |
|---|---|
| `{action: label, condition, behavior}…{endaction}` | Clickable label; body runs on click (never at render). `behavior`: `disable` (default) or `hide`. |

### 1.8 Functions

| Directive | Purpose |
|---|---|
| `{fn: name, p1, p2}…{endfn}` | Define a named function (in an `is_function` node). |
| `{return: expr}` | Return a value from a function body. |
| `{call: name, e1, e2}` | Directive form — interpolate the return like `{print:}`. |
| `call("name", e1, e2)` | Inline expression form — raw value usable in any expression. |

### 1.9 Form elements

| Directive | Purpose |
|---|---|
| `{textfield: state.var, hint, mode}` | Text input. `mode`: `live`/`blur`/`onEnterKey` (default). |
| `{textarea: state.var, hint, mode, rows}` | Multi-line input; default `blur`, `rows=3`. |
| `{number: state.var, min, max, step}` | Numeric stepper (live). |
| `{checkbox: state.var, value}` | Toggle, or set/reset-to-type-default. |
| `{dropdown: state.var, opt1, opt2, …}` | Select box (options cannot contain commas). |
| `{radiogroup}…{radiobutton: state.var, val}…{endradiogroup}` | Radio group; one per group. |

### 1.10 Media

| Directive | Purpose |
|---|---|
| `{img: url, w=, h=, alt=}` | Image, max-width 100%, optional pixel size. |
| `{video: url, autoplay, repeat, mute, w=, h=}` | Video player (controls always on). |
| `{audio: url, channel, loop, volume=, fade=, verb}` | Audio; channels `music`/`sfx`, verbs `stop`/`pause`/`restart`. |

### 1.11 Dialogue

| Directive | Purpose |
|---|---|
| `{dialogue: name}…{enddialogue}` | Styled speech block. |
| `{dialogue: {img: url}}…{enddialogue}` | Avatar on the left. |
| `{dialogue: {img: url}, name}…{enddialogue}` | Avatar + name below it. |

### 1.12 Timing

| Directive | Purpose |
|---|---|
| `{wait:N,fade:M}…{endwait}` | Timed sequence: fade in, stay `N` ms, fade out (`M` ms, default 500). |
| `{live:N}…{endlive}` | Timed region: body executes once every `N` ms then re-renders. |

### 1.13 Tables & stat bars

| Directive | Purpose |
|---|---|
| `{table: w=, center, border=, cellpadding=, cellspacing=, class=}…{endtable}` | Table. |
| `{tr: align=, class=}…{endtr}` | Row. |
| `{td: w=, align=, valign=, colspan=, rowspan=, class=}…{endtd}` | Cell. |
| `{bar: expr, max=, w=, color=, class=}` | Filled stat bar (`value/max`, clamped 0–100%). |

### 1.14 Runtime API & expression scopes

| Construct | Purpose |
|---|---|
| `state.x` | Saved game state; serialized. |
| `temp.x` | Scratch namespace; never saved; discarded on fresh entry. |
| `setup.x` | Immutable boot-time constants; deep-frozen, never saved. |
| `helper.random(a,b)` / `either(…)` / `clone(v)` / `clamp(x,lo,hi)` | Utility functions, read-only. |
| `state.x.size` | Alias for `.length` on `state`/`temp`/`setup` array roots. |
| `Array.prototype` extensions | `first`, `last`, `count`, `contains`, …, `shuffle`, `random`, … |
| `String.prototype` extensions | `toUpperFirst`, `first`, `last`, `contains`, `splice`, … |
| `notify("message")` | Show a toast (from any mutation context). |
| `game.newGame()` | Restart the game (clear saves). |
| `state._visited.<slug>` | Has the player been to this passage? |---

## 2. Tutorial — writing stories in the language

Each lesson introduces directives and, just as importantly, **how they interact**. Copy the
passage text into the editor's Markdown tab; the *choices* shown alongside are the
connection cards you create by linking nodes.

### L1 — A first passage (interpolation + a choice)

A passage is text, `{print:}` substitutions, and `[text](node:slug)` links.

```
You stand in a quiet clearing. {print:state.gold} gold coins jingle in your purse.
[Go north](node:north_forest)
```

Node data (the connection card the editor builds for you):

```
choices: [ { target_node_id: "north_forest", text: "Go north" } ]
```

**What's happening.** At render, `{print:state.gold}` is replaced by the current value of
`state.gold` (a fresh game may show `0`). The `[text](node:north_forest)` link becomes an
inline clickable link; clicking runs the choice's `mutation` first, then navigates to the
node.

**How directives interact.** The *link* and the *choice card* are two views of the same
connection. A `[text](…)` link without a matching card renders, but is unstyled/ungated —
always keep them in sync (the editor keeps connections in sync automatically).

Two kinds of `{…}` — same family, different jobs:

```
{print:state.gold}                shows — displays a value
{set: state.gold = 0}             mutates — no visible text
```

`{print:}` substitutes. `{set:}` executes. Muddle them and your story breaks — that's the
#1 gotcha in the language.

### L2 — Mutations before display (same-passage ordering)

```
The merchant eyes your coin purse.
{set: state.gold -= 5}
Now it holds {print:state.gold}.
```

**What's happening.** `{set:}` runs during the directive pass, **before** any text is
rendered. So `{print:state.gold}` in the *same* passage already sees the new value — you
can mutate and display in one paragraph. The full order is:

1. **Directive pass** (`_processDirectives`): `{set:}`, `{if:}`, loops, `{redirect:}`,
   `{include:}`, `{print:}` capture, etc., in textual order.
2. **HTML pass** (`renderContent`): random values, media, tables, bold/italic, etc.

**How it interacts.** Because `{set:}` re-runs *every* render, avoid one-shot side effects
in bare text. Use a guard (L3), `{init}` (L5), or an action body (L8).

### L3 — Branching text (conditionals)

```
{if: state.gold >= 10}
The man looks at your purse and nods.
{elseif: state.gold >= 1}
He shrugs. "A little, maybe."
{else}
"Offer nothing? Ha."
{endif}
```

**What's happening.** Exactly one branch's text survives — the **first** whose condition
evaluates truthy. Nesting is allowed; `{elseif:}` chains and `{else}` are optional.
Conditions run against `state`, `setup`, `helper`, `temp` and `call` just like expressions
elsewhere.

**How it interacts.** Branch bodies can contain *anything*, including `{set:}`. This is how
conditional redirects and conditional reveals are built:

- Conditional redirect: `{if: state.femininity >= 5}{redirect:dream5}{endif}` (redirects
  are text-level, must be in the passage body, and are checked *before* the legacy
  On Enter field).
- Conditional mutation: `{if: state.gold >= 5}{set: state.gold -= 5}{endif}`.

A **choice-card prerequisite** (`state.gold >= 10` on the card) *disables* the whole link;
an `{if:}` in the text *removes/gates only the text itself*. Prefer `{if:}` when the
decision is about which page text is written, use the prerequisite only for what choices are
available.

### L4 — Persistent stats across passages (prerequisite + mutation)

A hit-point-fighting scene:

```
node: encounter_goblin
text:
A goblin snarls. You have {print:state.hp} HP.
[Attack!](node:combat)

card "Attack!" -> combat:
  prerequisite: state.hp > 0
  mutation: state.goblin_hp -= 5; notify("You strike the goblin (-5)")

node: combat
text:
The goblin takes the hit. {print:state.goblin_hp} HP left.
```

**What's happening.** The prerequisite is evaluated at render — if false the link gets a
`disabled` class (greyed, unclickable). Mutations run **on click**, before navigation, then
the passage sees updated `state`. `notify("…")` in a mutation string pops a toast.

**How it interacts.** Mutations can use anything expressions can. `state.hp` lives on, and
the `_visited` field marks nodes:

- One-time gates: `prerequisite: state._visited.compound == undefined && state.day > 3`
  runs exactly once (set it via an on-click mutation or a condition).

After every click that changes *numeric* variables, auto-toasts appear (`Gold -3`,
`Maya Affection +5`); `day` is excluded.

### L5 — Repeatable inventory loops (temp, init, arrays)

```
{init}{set: state.backpack = ["rope","rations","key"]}{set: temp.i = 0}{endinit}
{while: temp.i < state.backpack.size}{print:state.backpack[temp.i]} {set: temp.i += 1}{endwhile}
```

- `{init}…{endinit}` runs **once per fresh entry** (arriving at the passage), produces **no
  visible output**, and is where setup mutations belong. It does **not** re-run on a
  same-passage re-render (action click, form event).
- `temp.i` is scratch space — never saved. A fresh entry starts it from `0`.
- `while` loops evaluate `expr` against current state each iteration. `.size` on a root
  array aliases `.length`.
- The whole array also prints: `{print:state.backpack}` → `rope, rations, key`.

**Safety:** every loop stops after 1000 iterations (a toast warns). `{break}` / `{continue}`
control iteration; outside a loop they are printed as literal text.

### L6 — Composing fragments (`{include:}`)

```
The tavern is hot and loud.
{include: tavern_hall}
{include: menu_board}
```

`{include: slug}` splices the target passage's **text** into place at render time —
processed like any other markup (conditionals, images, loops, even nested includes). Its
**choices merge** into the current passage: the host's own choices render first, then
included ones in textual order (innermost first).

- Unknown slug → the tag renders literally (so you notice).
- The included passage's **On Enter** hook does NOT run.
- Nested includes share one limit: exceed **100 splices** in a render → an "Include limit
  exceeded" toast and it stops.
- To suppress dead-end/orphan warnings on a passage that exists only to be included, mark
  the node a **Utility node** (`is_utility: true`). It's editor-only; the text stays in the
  export so the include can find it.
- A `{redirect:}` inside included text only redirects when that include is actually reached.

### L7 — Once-only logic (`{init}` + re-render semantics)

`{init}` is your correct tool for "set up *once per entry*, keep showing after":

```
{init}{set: state.started = (state.started || 0) + 1}{endinit}
You have {print:state.started} start(s).
```

Re-renders (action clicks, `commit:live` typing, live ticks) **do not** re-run the block —
so `started` counts *entries*, not *renders*. The flag-guard pattern
`{if: state.started}…{endif}` cannot express "added once, still displayed" — `{init}` can.

### L8 — Action blocks (clickable side-effects)

Actions are inline pairs. Clicking the label runs the body's side-effects **once**, then
re-renders the passage and auto-saves. The body is **not rendered/not displayed**.

```
{action: Search the sack}{set: state.key = true}{unset: state.mystery}{endaction}
```

**Click-to-reveal recipe** — set a flag in the body, gate the text with `{if:}`:

```
{action: Open the chest}{set: state.has_key = true}{endaction}
{if: state.has_key}You found a rusty key.{else}A locked chest grins.{endif}
```

**Condition + behavior** (3rd param):

```
{action: Pay 10 gold, state.gold >= 10}state.gold -= 10{endaction}
{action: Open the vault, state.has_key == true, hide}state.vault = true{endaction}
```

- `condition` — JS expression; `false` → label is `disabled` (default) or the whole block
  hidden (`hide`).
- The body is **not executed at render** — only on click. Its `{set:}`, nested `{if:}`,
  loops, `{audio:}`, `{include:}` run client-side in the click handler.
- `{redirect: slug}` in the body navigates on click: `{redirect: back}` is the Back-button
  recipe `{action: Back}{redirect: back}{endaction}`.
- No nesting; an unclosed `{action:` prints literally. `notify()` works in the body.

### L9 — Functions (shared logic)

A node marked **Function** (`is_function: true` in the UI) is a catalogue — its body holds
one or more `{fn:}` blocks:

```
{fn: double, x}
    {return: temp.x * 2}
{endfn}

{fn: addReputation, amt}
    {set: state.reputation = state.reputation + temp.amt}
{endfn}
```

Use them **anywhere** — directive-like (interpolates the return like `{print:}`):

```
{call: double, 21}
Just {print: call("double", state.x)} damage.
```

or as a raw expression inside other expressions:

```
{set: state.total = call("add", state.total, 10)}
{if: call("hasItem", state.sword) > 0}You have the sword.{endif}
```

**Semantics.** Parameters bind into `temp.<param>` (you must write `temp.`). `state`
mutations inside a body **persist**; the caller's `temp` is restored after. Without a
`{return:}` the function yields nothing; body text is never displayed. Names are global —
last definition wins. Recursion depth is limited (50).

### L10 — Setup constants (immutable)

`setup` is a frozen scope for values identical on every playthrough (max HP, prices, item
catalogs). Declare in the **Setup node** or the Variables panel `setup` tab:

```
{set: setup.MAX_HP = 100}
{set: setup.PRICE_POTION = 25}
{set: setup.items = [{ name: "Sword", price: 80 }]}
```

- Runs **once at boot**, before the first render; then the scope is deep-frozen.
- Read everywhere expressions work: `{print: setup.PRICE_POTION}`,
  `{if: state.hp > setup.MAX_HP * 0.5}`, loop bounds, `{bar: setup.max, max=100}`.
- Never saved; identical on every save slot. `setup` is **not** writable at runtime.

### L11 — Media & dialogue

```
{img: assets/alex.png, w=200, alt=Alex}
{video: assets/rain.mp4, w=480, mute}
```

- `{img: url, w=, h=, alt=}` — responsive (`max-width:100%`); `w`/`h` in css px.
- `{video: url, autoplay, repeat, mute, w=, h=}` — controls always shown; autoplay defaults
  true but browsers block *audible* autoplay — pass `mute`.
- `{audio: url, music/sfx, loop, volume=0..1, fade=ms}` — plays on the chosen channel;
  verbs `stop`, `pause`, `restart`. Lifecycle: after each render, any cached track not
  declared by the render is stopped — so *declare your BGM every passage* (via
  `{include: music_node}`) or it stops when you leave.

Dialogue:

```
{dialogue: {img: assets/alex.png}, Alex}Hey, I'm Alex.{enddialogue}
```

Body accepts inline markup (bold, links, `{print:}`).

### L12 — Timed scenes

```
{wait:1500,fade:600}
A flash of lightning...
{endwait}

I wake with a start.
```

- `N` = visible duration ms (required), `M` = fade ms (default 500). Fade sequence:
  fade in → visible N → fade out.
- Multiple `{wait:}` blocks play sequentially. Content after the last `{endwait}` stays
  hidden till all finish.
- A wait only **reveals once per entry**; on a re-render (typing, action, live tick) the
  content is shown already-revealed instead of replaying. Block references preserved.

### L13 — Live regions (time-based dynamics)

```
{live:1000}{if: state.bomb > 0}{set: state.bomb -= 1}{endif}⏱ {print:state.bomb}{endlive}
```

- Runs the body **every N ms**, mutating once, then re-renders the whole passage + side panel.
- The render-time refresh is side-effect-free: a passage `{set:}` never re-increments the
  region's own counters.
- Use in the `side_panel` to tick state across passages.
- Min interval 50; unclosed / non-numeric `{live: fast}` renders literally.
- `{live: 1000}{if: state.bomb <= 0}{redirect: boom}{endif}{endlive}` — a timed transition
  once a condition is met.

### L14 — Forms

```
What is your name? {textfield: state.player_name, Enter your name, blur}
Class: {dropdown: state.class, warrior, mage, rogue}
Score: {number: state.score, 0, 100, 5}
{checkbox: state.has_sword} has a sword
{radiogroup}{radiobutton: state.class, magic} Mage{endradiogroup}
```

Forms bind to `state.var`. Modes: `live` (each keystroke), `blur` (on focus-out),
`onEnterKey` (default). `{checkbox:}` toggles a bool or writes a value; unchecking resets to
the type default (`false`/`0`/`""`). Watch the comma rule on `{dropdown:}` — options cannot
contain commas.

### L15 — Tables & stat bars

```
{table: w=600, center, border=1}
{tr:}{td: w=200}Name{endtd}{td:}Health{endtd}{endtr}
{tr:}{td:}Alex{endtd}{td:}{bar: state.hp, max=100, w=180}{endtd}{endtr}
{endtable}
```

- `{bar: expr, max=100, w=, color=}` — fill = `value/max`, clamped 0–100%. An unset value
  gives an **empty** bar; a throwing expression renders the tag literally (so you notice).
- Table tags are **display-only** — cell content can still be normal markup (`{print:}`,
  links, `{img:}`), including a `{bar:}` that re-evaluates under live tick.
- Newline hygiene: open tags eat a preceding `\n`, close tags eat a following `\n`, so
  cells join without stray `<br>`. A blank line inside the table → `<br>` leak; keep it on
  one line.

### L16 — Bringing it all together (a full scene)

A shop scene combining everything seen so far:

```
setup node:
{set: setup.MAX_HP = 100}
{set: setup.PRICE_POTION = 25}
{set: setup.items = [{ name: "Sword", price: 80 }, { name: "Potion", price: 25 }]}

shop passage:
{audio: assets/shop.mp3, music, loop}

The smith looks you over. You have {print:state.gold} gold.

{table: w=500, center}
{tr:}{td:}Item{endtd}{td:}Price{endtd}{endtr}
{for: temp.i = 0; temp.i < setup.items.size; temp.i += 1}
{tr:}{td:}{print:setup.items[temp.i].name}{endtd}{td:}{print:setup.items[temp.i].price}{endtd}{endtr}
{endfor}
{endtable}

{action: Buy a potion, state.gold >= setup.PRICE_POTION}{set: state.gold -= setup.PRICE_POTION}{endaction}
{action: Leave}{redirect: exit}{endaction}
```

State flows: `setup` holds immutable prices; the `for` loop builds the price table from the
catalog; the action guards on gold and mutates it on click; leaving is a redirect. This is
the language at full power — directives collaborating.

### L17 — Nested conditionals (`{if:}` inside `{if:}`)

A branch body may itself be a full `{if:}` block. Gates compose when an outer condition is
just the prerequisite for a finer-grained test:

```
{set: state.day = 4}
{set: state.has_letter = true}

{if: state.day >= 3}
The guard looks you over. {if: state.has_letter}
"The captain's expecting you," he says, waving you in.
{else}
"No letter, no entry." He plants himself across the door.
{endif}
{else}
The gate is shut for the day.
{endif}
```

**What's happening.** Over a day-3 gate, the guard's reply further branches on the letter.
Each `{endif}` closes the innermost open `{if:}`, so the `{else}` above belongs to the
*inner* block. Indentation is for reading only — the engine tracks depth, not layout.

**How it interacts.** Tags that abutting each other are fine:
`{if: a}{if: b}{if: c}deep{endif}{endif}{endif}` is three nested blocks on one line. Depths
are unbounded; each level still follows the first-truthy-branch rule, and any level may use
`{elseif:}`/`{else}`. Nesting is the natural way to build tiered replies, bandit-bounty
tables, or dialogue trees that share a starting condition:

```
{if: state.gold >= 100}
    "Five hundred for the job."
    {if: state.maya_affection >= 5}{set: setup.price_override = 400}{endif}
{elseif: state.gold >= 10}
    "Hmph. Two hundred, and not a copper less."
{else}
    He waves you off. "Come back with real gold."
{endif}
```

### L18 — Dynamic links (`{print:}` builds the node slug)

A link target doesn't need to be a literal slug — `{print:}` inside `node:…` is resolved
at render, so one link line can reach many nodes:

```
{set: state.bar_event = state.bar_event || "saloon"}
Take the back room? [Step inside](node:bar_event_{print:state.bar_event})
```

If `state.bar_event` holds `"saloon"`, the resolved target is `node:bar_event_saloon`; make
it `"inn"` earlier in the story and the very same link navigates to `bar_event_inn`. The
`choices[]` connection cards must exist for **each** possible slug
(`bar_event_saloon`, `bar_event_inn`, …) with their own mutations.

**What's happening.** The walker resolves `{print:state.bar_event}` *before* the link is
built, so the anchor's `data-node` carries the final slug (the `{print:}` placeholder is
restored into the attribute). Because the slug isn't usable as a `choices[]` index at build
time, click matching falls back to looking up the choice **by its `target_node_id`** — so
the card's mutation still runs and its `prerequisite` is still enforced, just at click time
instead of at render.

**Caveats to design around.**

- The render-time grey-out does **not** apply to a dynamic link: the engine can't resolve
  the final slug when it stamps the `disabled` class, so a failing prerequisite shows the
  link normally — but clicking it does nothing (the click-time check still blocks it). For a
  visibly disabled state, gate the link with an `{if:}` around it instead.
- Every value the variable can take must have a real node; a resolved slug with no matching
  node simply doesn't navigate (link stays on the passage).
- The `{print:}` expression is read at render, so set the variable earlier in the same
  passage (or in an `{init}` block) — a `{set:}` placed *after* the link line won't retro-resolve it.

---

## 3. Detailed reference

### 3.1 Markdown support (exact)

The runtime parses only a small markdown subset; everything else is plain text.
(CodeMirror's full markdown is for **editing**; the exported engine renders this subset.)

```
**bold**   → <strong>bold</strong>
*italic*   → <em>italic</em>          (underscore variants are NOT supported)
###  text  → <h3>text</h3>            (line-start)
##  text  → <h2>text</h2>
#  text   → <h1>text</h1>
"blank line" split → paragraph boundary
single newline → <br>
[text](url-without-node:) → text (label only)
```

**Lists:** `- item` and `1. item` (the editor's toolbar inserts) are **not** converted by
the engine. They render as plain lines with `<br>` between them. The converter must not
emit list markup expecting `<ul>`/`<li>`.

**Links (external):** `[label](https://…site)` is reduced to its plain `label` — there is no
`<a href>` external-link output. Only `node:` links navigate.

### 3.2 Node links & choices

```
[display](node:slug)
```

- Rendered inline as a clickable. Must correspond (via `node:slug`) to a `choices[]` entry
  on that passage.
- **prerequisite**: JS expr — `false` → link gets `disabled` class (greyed, unclickable).
- **mutation**: JS statement executed on click **before** navigation.
- Multiple links to the same slug each map back to the same card / index in order.
- The link text is the author's `[display]`; cards may carry `text` for syncing.
- **Dynamic slug**: `[text](node:pre_{print:state.x})` — the `{print:}` is resolved at
  render and the anchor carries the final slug. Choice matching then falls back to
  `target_node_id`, so mutation/prerequisite run at **click** time and the render-time
  grey-out does not apply (see L18).

### 3.3 `{print:}` value interpolation

- Syntax: `{print:state.x}`, `{print state.x}`, `{print: state.x}`.
- Root must be `state.` / `temp.` / `setup.`. One bracket index is allowed
  (`state.myarray[0]`, `state.clients[state.dayW]`) plus a trailing field chain
  (`state.clients[day].name`).
- Array values print joined with `", "`. A whole object/dict prints the **macro text
  unchanged** (never `[object Object]`) — print a field instead.
- `undefined` value / missing parent → macro text unchanged (author-noticeable).
- The value is captured during the walker, so a loop capturing `{print:}` reads its own
  iteration, and a later `{set:}` on that value does not leak backwards.
- `{print:}` may also be embedded *inside* another directive's argument — e.g. a dynamic
  node slug `[x](node:a{print:state.y})` (see L18).

### 3.4 `{random:}`

`{random:max}` ∈ `[0, max]`; `{random:min,max}` ∈ `[min, max]` — both inclusive, via
`Math.random` + rounding.

### 3.5 Conditionals

```
{if: EXPR}  body  {elseif: EXPR2}  body  {else}  body  {endif}
```

- EXPR is a JS expression evaluated against `state`, `setup`, `helper`, `temp`, `call`.
- First truthy branch wins; `{elseif:}` / `{else}` optional; nesting supported.
- Tokens are exact-lowercase `{if:}`, `{elseif:}`, `{else}`, `{endif}` (see §3.12 case).
- An unclosed condition whose EXPR cannot be evaluated → tag renders literally.

### 3.6 Loops

```
{while: EXPR}body{endwhile}
{do}body{while: EXPR}
{for: initClause; cond; update}body{endfor}
{break} / {continue}
```

- `for` init runs via the mutation pipeline (creates the var), `cond` each pass, `update`
  after the body; `continue` still runs `update`; `break` skips it.
- **1000-iteration safety cap** + "Loop limit exceeded" toast. `break`/`continue` outside
  a loop print literally.
- No `foreach`/`for…of`; the converter maps SugarCube `<<for …>>` to `{for: …}`.

### 3.7 `{set:}` / `{unset:}`

- `{set: JS_STATEMENT}` — brace-aware scanner: object literals and nested braces parse
  correctly; quoted strings respected. Runs during the directive pass, before any display.
- Examples:
  - `{set: state.gold += 10}`
  - `{set: state.items = ["a","b"]}`
  - `{set: state.o[state.k] = {n:1}}`
  - `{set: setup-created values }` in the Setup node at boot.
- `{unset: state.x}` / `{unset: temp.x}` / `{unset: temp}` — delete one key / clear all
  scratch. Exact lowercase.

### 3.8 `{redirect:}`

- `{redirect: slug}` — auto-navigate on render. Checked **first** (before On Enter).
- `{redirect: back}` — reserved: history-back navigation (same as the Back button).
- `{redirect:}` inside an action body (and inside a live tick) navigates on click/tick.
- A passage whose slug is literally `back` cannot be targeted by `{redirect: back}` — use a
  `[text](node:slug)` link instead.

### 3.9 `{include:}`

`{include: slug}` — **case-insensitive**. Splices text; merges choices (host first,
innermost first). 100-splice cap per render (`this._includeCount`). See L6.

### 3.10 `{action:}`

`{action: label, condition, behavior}…{endaction}`. Behavior `disable` (default) / `hide`.
Body is never rendered and does not run at render; clicking runs the body, re-renders, and
auto-saves. See L8.

### 3.11 Media options (common grammar)

Bare flag = `true`; `key=value`; spaces around `=` allowed; unknown keys ignored; the
target (URL) is everything before the first comma, so spaces are preserved. For
`alt`/`id`/etc.: a value containing `,`, `}`, `"` is rejected.

### 3.12 Case sensitivity

| Tag set | Case |
|---|---|
| `{if:}`, `{elseif:}`, `{else}`, `{endif}`, `{while:}`, `{endwhile}`, `{do}`, `{for:}`, `{endfor}`, `{break}`, `{continue}`, `{init}`, `{endinit}`, `{set:}`, `{unset:}`, `{redirect:}` | exact lowercase |
| `{include:}`, `{audio:}`, `{action:}`, `{live:}`, `{print` | case-insensitive |

> Convention: write **everything lowercase**; only the lenient group tolerates other cases.

### 3.13 Render-only pass (live regions & side-panel refresh)

In the live display-refresh and side-panel refresh, side-effect directives (`{set:}`,
`{unset:}`, `{include:}`, `{audio:}`, `{redirect:}`, `{break}`, `{continue}`, `{init}`
blocks, `{action:}`/`{live:}`/`{wait:}` blocks, loops, form tags) are consumed without
running (a console.warn once per kind). Everything else — text, `{print:}`, `{if:}`
branches, `{random:}`, images/video/tables/`{bar:}`, dialogue, links — renders normally.

---

## 4. Expression scopes & runtime API

### 4.1 Scopes

| Scope | Semantics |
|---|---|
| `state.x` | Player-visible game state; **serialized into saves**. |
| `temp.x` | Scratch namespace; never saved; created on fresh entry; survives re-renders of the same passage. |
| `setup.x` | Immutable boot constants; identical on every save; read-only after boot. |
| `helper.method()` | Engine utility functions; read-only. |
| `call("fn", …)` | Runs a `{fn:}` function and returns its value. |

### 4.2 `helper` functions

`helper.random(min, max)` (inclusive; 1-arg = `0..max`), `helper.either(a, b, c…)`
(random element, flattened), `helper.clone(value)` (deep), `helper.clamp(x, lo, hi)`.

### 4.3 Array prototype extensions (SugarCube-compatible)

`first` • `last` • `count(a)` • `countWith(pred)` • `contains(v)` (legacy) • `concatUnique`
• `toUnique` • `toShuffled` • `random()` • `randomMany(n)` • `includesAll` • `includesAny`
• `append`/`prepend` (legacy) • `delete` (deprecated) / `deleteAll` / `deleteAt` /
`deleteFirst` / `deleteLast` / `deleteWith` • `pluck` / `pluckMany` • `pushUnique` /
`unshiftUnique` • `shuffle`.

### 4.4 String prototype extensions

`toUpperFirst` • `toLocaleUpperFirst` • `first` • `last` • `count` • `contains` (legacy)
• `splice` • `splitOrEmpty`.

### 4.5 Runtime API

- `notify("message")` — toast (usable in any mutation context).
- `game.newGame()` — clears saves & relaunches the story.
- `state._visited.<slug>` — has the player visited this passage?
- `helper` is not a display scope — `{print:helper.x}` does not work; store into `state`
  first.

### 4.6 `.size`

`(state|temp|setup).word.size` → `.length`. Only on the root; invalid after a bracket.

---

## 5. Render pipeline & ordering

For the converter, the important **in-order resolution rule** — each pass sees the *result*
of the previous:

```
Pass 1 (walker `_processDirectives`, left-to-right):
  conditional blocks {if:}/{elseif:}/{else}/{endif}
  {set:} / {unset:}
  {redirect:}
  {print:} capture
  loops ({for:}/{while:}/{do}), {break}/{continue}
  {init}{endinit}
  {include:} — splice recursively
  {action:} — body skipped at render
  {live:} — boundary capture
  {fn:}/{return:}/{call:}
  expressions at each text position see the *current* state

Pass 2 (renderer `renderContent`):
  {random:}
  HTML-escape (`<` / `>`)
  form elements → inputs
  {img:} / {video:}
  [text](node:slug) → links (prerequisite / merged choices)
  tables / bars
  strip generic [text](url)
  **bold** / *italic* → HTML
  # headings
  {wait:}{endwait} → animate-once containers
  paragraphs (`\n\n` → `</p><p>`, `\n` → `<br>`)
  {dialogue:} blocks
  placeholder restore (print/action/live values)
```

The **last** pass restores placeholders *after* escaping, so values that contain HTML
render as HTML — keep that in mind when sanitizing.

---

## 6. Fallbacks & edge cases

- Any unknown / unclosed directive prints **literally** (author-visible).
- `{set:}` throwing → warning, no crash.
- Loop > 1000 iterations → toast + stop.
- Include cap → "Include limit exceeded" toast.
- `[label](http://…)` → plain label.
- Missing prerequisite value → grey disabled link.
- `setup` write at runtime → console.warn, value unchanged.
- `{print:}` of a whole object → macro text unchanged.

---

## 7. Legacy / removed

- `![alt](url)` and `![alt](url)` images — legacy markdown image syntax, **not recognized**
  by the current engine; renders as visible text. Convert to `{img:}`.
- `[text](action:…)` action links — removed; use `{action:}` blocks.
- `{widget: name, args}` — unused by the engine; converter maps widget calls to `{call:}`
  and widget bodies to `{fn:}` nodes.
- A short `{state.varname}` shorthand was documented in an earlier guide — **not supported**
  by the current walker; use `{print:state.varname}`.

---

## 8. Source-of-truth & tests

- `frontend/editor/template.html` — the runtime walker + `renderContent`.
- `frontend/editor/js/codemirror-setup.js` — the editor tokenizer + autocomplete.
- Tests covering the above: `tests/suites/regression.test.js`, `back.test.js`,
  `wait.test.js`, `live_region.test.js`, `audio.test.js`, `fn_nodes.test.js`,
  `helpers.test.js`, `objects.test.js`, `setup.test.js`, `tables.test.js`.

Run `node tests/run.js` in the repo root after changing the engine.