# NodeFable Syntax & Rules Guide

Reference for writing interactive stories in the NodeFable JSON format.

---

## 1. Complete JSON Schema

```json
{
    "name": "string — folder name for the project",
    "variables": {
        "var_name": bool | int | str
    },
    "setup": {
        "const_name": bool | int | str | list  (immutable boot-time constants)
    },
    "nodes": [
        {
            "id": "unique_slug",
            "title": "Display title for the passage",
            "text": "Story content with markup",
            "x": 0.0,
            "y": 0.0,
            "is_start": false,
            "is_utility": false,
            "group": "chapter_1",
            "choices": [
                {
                    "target_node_id": "slug_of_target_node",
                    "text": "Auto-populated link text",
                    "prerequisite": "JS expression or null",
                    "mutation": "JS statement or null"
                }
            ],
            "on_enter": {
                "condition": "JS expression or null",
                "target_node_id": "slug_to_redirect_to",
                "mutation": "JS statement or null"
            }
        }
    ]
}
```

### On Enter Fields

| Field | Required | Description |
|---|---|---|
| `condition` | No (`null`) | JS expression. If null or evaluates to true, the redirect fires |
| `target_node_id` | Yes | The node to navigate to if condition is met |
| `mutation` | No (`null`) | JS statement executed before the redirect |

---

## 1b. Node IDs (Slugs)

Every node has a unique `id` (slug). The slug is:
- Auto-generated from the node's title when the node is created
- URL-safe: lowercase letters, numbers, underscores — no spaces or special characters
- Used in all references: `[text](node:slug)` links, `target_node_id` in choices, and `on_enter.target_node_id`
- **Editable** in the passage editor's **Node ID** field — changing a slug automatically updates all references across the project

If a slug already exists, the editor appends a numeric suffix (`room_2`, `room_3`, etc.).

---

## 2. Text Markup Reference

Processed in the runtime engine: directive resolution (`processDirectives` — conditionals `{if:}`, mutations `{set:}`, loops `{while:}`/`{do}`, interpolation `{var:}`), and redirect stripping are handled in `render()` and `_preprocessText()`. HTML rendering (images, links, waits, bold/italic, `{random:}`) is in `renderContent()`.

| Syntax | Output | Example |
|---|---|---|---|---|
| `[text](node:slug)` | Clickable link that navigates to another passage | `[Go north](node:forest)` |
| `{action: label, cond}...{endaction}` | Clickable link that runs its body once on click | `{action: Fight}state.goblin_hp -= 5{endaction}` |
| `{random:max}` | Random integer 0 to max inclusive | `{random:10}` |
| `{random:min,max}` | Random integer min to max inclusive | `{random:3,8}` |
| `{set: expr}` | Inline mutation — executes JS expression at render time | `{set: state.time_text = "Morning"}` |
| `{var:state.name}` | Replaced with the current value of `state.name` (`state`/`temp`/`setup` paths) | `HP: {var:state.hp}` |
| `{if: condition}yes{else}no{endif}` | Conditionally rendered block (evaluated against `state`) | `{if: state.has_key}Door unlocked!{endif}` |
| `{while: condition}...{endwhile}` | Repeat body while condition is true (0+ times) | `{while: state.i < 3}{var: state.i}{endwhile}` |
| `{do}...{while: condition}` | Repeat body until condition false (1+ times) | `{do}Roll{set: state.n += 1}{while: state.n < 3}` |
| `{for: init; cond; update}...{endfor}` | C-style loop: init once, repeat body while cond, run update each pass | `{for: state.i = 0; state.i < 3; state.i += 1}{var: state.i}{endfor}` |
| `{break}` | Exit the innermost loop immediately | `{if: state.hp <= 0}{break}{endif}` |
| `{continue}` | Skip to the next iteration's condition check | `{if: state.skip}{continue}{endif}` |
| `{unset: state.name}` | Delete a variable from `state` or `temp`; `{unset: temp}` clears all scratch | `{unset: state.hp}` |
| `{init}...{endinit}` | Setup block — mutations run once per fresh entry; body produces no output | `{init}{set: state.items = [1,2,3]}{endinit}` |
| `{include: slug}` | Splice another passage's text into this one (choices merge; inline action blocks work) | `{include: prologue}` |
| `{action: label, cond}...{endaction}` | Clickable link whose body runs once on click (see §5) | `{action: Attack}state.enemy_hp -= 5{endaction}` |
| `{wait:N}...{endwait}` | Timed sequence — content fades in N ms, then fades out (500ms fade default) | `{wait:2000}...{endwait}` |
| `{wait:N,fade:M}...{endwait}` | Wait sequence with custom fade duration M (ms) | `{wait:2000,fade:800}text{endwait}` |
| `{live:N}...{endlive}` | Timed region — body executes once every N ms, then re-renders the passage (see §Live Regions) | `{live:1000}⏱ {var:state.bomb}{endlive}` |
| `{dialogue:...}...{enddialogue}` | Styled dialogue block with optional image and speaker | `{dialogue: Bob}Hello!{enddialogue}` |
| `**bold text**` | Bold | `**warning**` |
| `*italic text*` | Italic | `*whisper*` |
| `# Heading` | `<h1>` | `# The Dark Forest` |
| `## Heading` | `<h2>` | `## A Clearing` |
| `### Heading` | `<h3>` | `### A Sign` |
| `{img: url, w=.., h=.., alt=..}` | Image with optional width/height/alt | `{img: assets/map.png, w=400}` |
| `{video: url, autoplay, repeat, mute, w=.., h=..}` | Video player (controls always on) | `{video: assets/rain.mp4, w=480}` |
| `{table: ...}...{endtable}` | Table block (see §Tables & Stat Bars) | `{table: w=600, center}...{endtable}` |
| `{tr: ...}...{endtr}` | Table row | `{tr: align=center}...{endtr}` |
| `{td: ...}...{endtd}` | Table cell | `{td: w=200, valign=top}Name{endtd}` |
| `{bar: expr, max=.., w=.., color=..}` | Stat bar (fill = `value/max`, clamped 0–100%) | `{bar: state.hp, max=100, w=198}` |
| Blank line | New paragraph | |
| Unmatched `[...](...)` | Plain text (fallback) | |

### Wait Sequences (Time Transitions)

Use `{wait:N,fade:M}...{endwait}` to create timed fade-in/fade-out sequences. Each `{wait:N,fade:M}...{endwait}` block is a single item. Multiple blocks play sequentially.

- `N` = visible duration in ms (required)
- `M` = fade-in/out duration in ms (optional, default 500)

```json
"text": "I drift off...\n\n{wait:1500,fade:600}\n{img: assets/dream.jpeg}\n\nA surreal moment...\n{endwait}\n\nI wake with a start."
```

Content after the final `{endwait}` remains hidden until all sequences finish, then fades in smoothly. Content before the first `{wait:N}` renders immediately. Multiple wait blocks run sequentially. Variable interpolation and markdown work inside wait items.

**Wait blocks and re-renders.** A wait sequence **reveals once per entry** to a passage (same rule as `{init}`). If the passage re-renders for any reason after entry — typing in a `{textfield: ..., commit=live}`, clicking an `{action:}`, or a live-region tick — the wait content is re-emitted **already revealed** (its final state, instantly visible), so the reveal is never replayed. A `{wait:}` block inside `{init}` produces nothing (init bodies are mutation-only).

### Live Regions (`{live:N}...{endlive}`)

`{live:N}...{endlive}` is a **timed region**. `N` is the refresh interval in **milliseconds** (first field, trimmed). Every `N` ms the region's body executes **once** — its `{set:}`/`{unset:}` mutations fire — then the engine re-renders the whole passage and side panel (the same cascade any user action triggers). The region's display always flows through the normal render path; a full re-render per tick is what keeps the passage, side panel, and every region in sync.

```json
"text": "{live:1000}{if: state.bomb > 0}{set: state.bomb -= 1}{endif}⏱ {var:state.bomb}{endlive}"
```

Recipes:

```
{live: 1000}{if: state.bomb > 0}{set: state.bomb -= 1}{endif}⏱ {var:state.bomb}{endlive}          countdown (stops when the guard no-ops)
{live: 2000}{set: state.hp = Math.min(state.hp + 1, state.maxhp)}HP {var:state.hp}/{var:state.maxhp}{endlive}   regen
{live: 60}{set: state.typed = (state.typed||0) + 1}{var: state.sentence.substring(0, state.typed)}{endlive}      typewriter
{live: 250}{random: 0, 9}{endlive}                                                                               flicker
{live: 1000}{set: state.elapsed = (state.elapsed||0) + 1}Elapsed {var:state.elapsed}s{endlive}                   clock
{live: 1000}{if: state.bomb <= 0}{redirect: boom}{endif}{endlive}                                               timed transition
```

**Display-only refresh.** During every render the region body is skipped by the walker (stored raw), and at the end of a render each region's display is refreshed in **render-only mode** — side-effect directives (`{set:}`, `{unset:}`, `{include:}`, `{audio:}`, `{redirect:}`, `{break}`, `{continue}`, `{init}` blocks, `{live:}`/`{action:}`/`{wait:}` blocks, loops, and form tags) are consumed without executing or emitting (a single `console.warn` per directive kind). Everything else renders normally: text, `{var:}`, `{if:}` branches, `{random:}` (re-rolls per refresh), `{img:}`, `{video:}`, `{table:}`/`{tr:}`/`{td:}`/`{bar:}`, `{dialogue:}`, and `[text](node:slug)` links. So a tick = exactly one body execution + one re-render — a passage `{set:}` followed by a render updates the region's display **without re-incrementing** the region's own counters.

**Notes and limitations**

- A `{live:}` region in the `side_panel` node works like any other passage: it ticks across navigation (its timer is re-registered on every render).
- `{live:}` tags are case-insensitive; the interval is clamped to a 50 ms floor.
- An unclosed `{live:` (no `{endlive}`) or a non-numeric interval (`{live: fast}`) renders literally. No nested `{live:}`.
- Region bodies are display + mutation only: no `{wait:}`, `{action:}`, nested `{live:}`, form inputs, or loops inside (inert in render-only; loops are also inert during ticks to avoid mutation-in-loop hazards).
- Ticks are the only time-driven mutation source; every tick re-renders the whole page, so keep the passage light. `{random:}` and `{video:}` in the passage body re-resolve/recreate per tick.
- A ticking region alongside a `commit:live` textfield can move the focus/caret mid-typing (the re-render preserves focus but not an active drag/caret selection).

### Conditional Text

Conditional blocks use `{if: condition}...{elseif: condition}...{else}...{endif}` syntax. Condition is a JS expression evaluated against `state` at render time. Supports nesting and chained `{elseif:}` branches. Processed BEFORE all other markup, so conditionals can wrap images, links, and variable interpolation.

```json
"text": "{if: state.gold >= 10}Rich!{elseif: state.gold >= 5}Middle.{else}Broke.{endif}\n\n[Go to College](node:college)"
```

### Inline Mutations

Use `{set: expression}` inside passage text to execute JS at render time. The expression is evaluated as JavaScript and runs in the game state context, so you can assign variables via `state.varname = value` and call `notify()`. Inline mutations execute when the passage renders, **before** HTML escaping, variable interpolation, and link rendering.

```json
"text": "The time is {set: state.time_text = \"Morning\"}.\nThe sun rises over the horizon. Time: {var:state.time_text}"
```

The expression can be any valid JS statement:
- `{set: state.greeting = "Hello there"}` — string assignment
- `{set: state.hp -= 10}` — decrement
- `{set: state.has_key = true}` — boolean
- `{set: state.gold += 50}` — increment
- `{set: state.gold += 10; notify(\"Found $10!\")}` — multi-statement with notification
- `{set: state.obj = helper.clone({ a: 1, b: [2, 3] })}` — object literals are brace-aware: `{set:}` scans past nested `{}` (and braces inside strings), so arrays of objects and `helper.clone({...})` parse correctly. `{if:}` conditions still do **not** support object literals (keep them in `{set:}` RHS).

**Important:** Unlike choice/action mutations, `{set:}` runs every time the passage renders, including during side panel refresh. Avoid side effects that should only fire once unless guarded by a condition.

### Loops

Two loop forms are available in passage text (main passage and side panel):

- `{while: condition}...{endwhile}` — body runs **0 or more** times, while `condition` is true.
- `{do}...{while: condition}` — body runs **1 or more** times; the `{while: condition}` tag closes the block and is checked after each run.
- `{for: init; cond; update}...{endfor}` — C-style loop: the `init` clause runs once, then the body repeats while `cond` is true, and the `update` clause runs after each pass.

The condition is a JS expression evaluated against `state` (and `temp`). Everything inside the body is re-evaluated each iteration, so `{var:}`, `{set:}`, `{if:}`, and nested loops all see the current state:

```json
"text": "{set: state.i = 0}{while: state.i < 3}{var: state.i}{set: state.i = state.i + 1}{endwhile}"
```

Renders as `012`. Iterating an array:

```json
"text": "{set: state.i = 0}{while: state.i < state.items.size}Item {var: state.i}: {var: state.items[state.i]}\n{set: state.i = state.i + 1}{endwhile}"
```

**`{for:}` form.** The three clauses are raw JS separated by semicolons, just like a C/JS `for` loop:

```json
"text": "{for: state.i = 0; state.i < 3; state.i += 1}{var: state.i}{endfor}"
```

Renders as `012`. The `init` clause is executed via the mutation pipeline, so it **creates the variable** if it isn't declared yet — no prior `{set:}` needed. The `update` clause also runs on every pass including the one taken by `{continue}`; `{break}` exits before the update runs. The loop variable keeps its final value in `state` after the loop ends. If the header has fewer than three clauses, the tag renders literally. A zero-iteration loop still runs `init` (creating the variable), and an uninitialized variable in `cond`/`update` is `undefined`.

Nested loops mix freely — `{for:}` inside `{while:}`/`{do}`, and vice versa. The one rule from `{while:}` applies: a nested `{while:}` cannot be the first directive inside a `{do}` body.

- `{break}` exits the innermost loop immediately; text before it in the body is kept, text after it in that iteration is dropped.
- `{continue}` skips the rest of the current iteration and jumps to the loop's update clause (`{for:}`) or condition check (`{while:}`/`{do}`).
- Outside any loop, `{break}` / `{continue}` render as literal text.

```json
"text": "{set: state.i = 0}{while: state.i < 9}{var: state.i}{if: state.i == 2}{break}{endif}{set: state.i = state.i + 1}{endwhile}"
```
Renders as `012`.

**Safety:** each loop stops after 1000 iterations and shows a "Loop limit exceeded" toast, so an infinite loop (e.g. a condition that never becomes false) can't freeze the tab.

**Snapshots:** `{var:}` captures a value at the moment it is read, so a whole-array `{var:}` before a loop shows the original contents even if the loop mutates that array later in the same render pass.

**Limitations:** a nested `{while:}` cannot appear as the first directive inside a `{do}` body (the first `{while:}` there always closes the do-block). Form elements inside loop bodies resolve against the final state, not per-iteration values.

### Initialization (One-Time Setup)

`{init}...{endinit}` separates one-time setup from display. Its body runs its `{set:}` mutations **once per fresh entry** and produces **no output** — useful for preparing arrays or counters that the rest of the passage reads while re-rendering:

```json
"text": "{init}{set: state.items = [1,2,3]}{set: state.i = 0}{endinit}{while: state.i < state.items.size}{var: state.items[state.i]}{set: state.i = state.i + 1}{endwhile}"
```

- **Fresh entry** = arriving at a passage (from a link, redirect, or new game) *or* when the side panel appears on a newly-entered main passage. Re-renders of the same passage (after a mutation, without leaving it) do **not** re-run `{init}` — the flag-guard pattern `{if: state.is_init}...{endif}` cannot express "mutate once but keep displaying", but init can.
- **Output suppressed:** anything inside the block other than `{set:}` mutations (e.g. `{var:}`, `{if:}`, `{while:}`) still executes but contributes nothing to the displayed text.
- **Once-only guarantee:** the body runs at most once per entry. If the block's `{endinit}` never appears, the literal text `{init}` is shown.
- **Rules:** `{init}` is only honored at the top level of a passage (not inside a loop or another `{init}`); nested or loop-inside init blocks are consumed and ignored. An `{init}` inside a `{if:}` branch is legal and runs only if that branch is taken on a fresh entry.
- **Scratch iterators:** use `temp` (see *Scratch Variables* below) for loop counters so setup never clobbers a story variable. No declaration is needed — `{set: temp.i = 0}` creates the property.
- The side panel's `{init}` runs each time a new main passage is entered (entering a passage counts as fresh for the side panel too).

### Scratch Variables (`temp`)

`temp` is a second namespace next to `state` for **throwaway values** — loop counters, temporary flags, intermediate results. It works in every expression context `state` does (`{set:}`, `{var:}`, `{if:}`, `{while:}`, `{for:}`, action mutations, choice prerequisites, on-enter conditions, the side panel):

```json
"text": "{for: temp.i = 0; temp.i < 3; temp.i += 1}{var: temp.i}{endfor}"
```

- **Never saved:** `temp` lives on the runtime object, not in `state`, so it is never serialized into a save. Reloading a save starts with a clean `temp`.
- **Lifecycle:** `temp` is discarded every time you enter a new passage (a fresh render). Re-renders of the **same** passage (an action click, a form event) keep `temp`, so an `{init}` setup that builds a `temp.items` array stays available to the display code until you leave the passage.
- **`{unset:}`** can delete from either namespace: `{unset: state.name}` deletes the key from `state`, `{unset: temp.name}` from `temp`, and `{unset: temp}` clears all scratch values at once. A malformed form renders literally.

### Setup Constants (`setup`)

`setup` is a third namespace for **immutable, boot-time constants** — global catalogs, metadata, and config that must not be saved per-slot and never change mid-game (wardrobe lists, stat names, status texts, author info). It is readable everywhere expressions are evaluated and writable **nowhere** after the game starts.

- **Declare** setup constants in the editor's Variables panel with the **scope** dropdown set to `setup`, or author them in the reserved **`setup`** node (a passsage auto-created like the side panel). In the node, use `{set: setup.name = value}`:
  ```
  {set: setup.clothes_all_bottoms = [{ name: "Skirt", price: 80 }]}
  {set: setup.stats_name = { "$Gen": "Genitalia", "$Fem": "Femininity" }}
  {set: setup.game_author = "SomebodyElseSg"}
  ```
- **Read** it everywhere expressions work — `{var: setup.author}`, `{if: setup.maxhp > 100}`, `{set: state.x = setup.catalog[0]}`, loop bounds (`{for: ... setup.list.length ...}`), and `{bar: setup.MAX_HP, max=100}`.
- **Immutable.** After boot, `setup` is deep-frozen. A write (`{set: setup.x = 5}`) fails with a console warning and leaves `setup` unchanged; nested writes into a frozen array (`setup.arr.push(x)`) silently no-op. Treat it as read-only.
- **Not saved / identical every slot.** `setup` is never written to a save. It is rebuilt at boot so it is byte-identical in every save slot, with zero save-bloat.
- **JSON-safe data only.** Arrays, objects, strings, numbers, booleans. No functions, no `Map`/`Set`/`Date`. If a source uses a `Map` (e.g. `stats_name`), convert it to a plain object and use `setup.map[key]` instead of `setup.map.get(key)`.
- **`.size` works** — `setup.items.size` aliases to `setup.items.length`, like `state`/`temp`.
- **Utility node pattern.** Keep a shared `{set:}` in the `setup` node; it runs once at boot (output text discarded). `{audio:}` in the setup node is suppressed at boot.

### Helper Functions (`helper`)

`helper` is a frozen, engine-provided scope of **script utility functions** for expressions. It is read-only and never saved.

```
{set: state.dice = helper.random(1, 6)}
{set: state.hp = helper.clamp(state.hp + 10, 0, 100)}
{set: state.gift = helper.either("roses", "chocolates", "book")}
{set: temp.items = helper.clone(setup.catalog)}
{set: state.deck = state.deck.shuffle()}
{set: state.pick = state.pool.random()}
{if: helper.random(1, 20) >= 10} Success {endif}
```

| Helper | Semantics |
|---|---|
| `helper.random(min, max)` | Random **integer, inclusive** both ends. 1 arg → `0..max`; 0 args → throws. |
| `helper.either(...values)` | Random element (one-level flattened). |
| `helper.clone(value)` | Deep clone — handles arrays, plain objects, `Date`, `Map`, `Set`, `RegExp`; honors a `.clone()` method. |
| `helper.clamp(x, lo, hi)` | `Math.max(lo, Math.min(hi, x))`. **The** clamp mechanism — there is no `Math.clamp`/`Number.prototype.clamp`. |

**Value methods** (called on the value itself, e.g. `state.list.shuffle()`): `Array` — `first`, `last`, `count(needle)`, `countWith(pred)`, `contains` *(legacy)*, `concatUnique`, `toUnique`, `toShuffled`, `random`, `randomMany(n)`, `includesAll`, `includesAny`, `append`/`prepend` *(legacy), `delete`/`deleteAll`/`deleteAt`/`deleteFirst`/`deleteLast`/`deleteWith`, `pluck`, `pluckMany(n)`, `pushUnique`, `unshiftUnique`, `shuffle`. `String` — `toUpperFirst`, `first`, `last`, `count(needle)`, `contains` *(legacy), `splice`, `splitOrEmpty`.

- **`helper` is not a `{var:}` display scope.** Assign a computed value into `state`/`temp` first: `{set: state.roll = helper.random(1,6)}` then `{var: state.roll}`.
- **Legacy flags:** `append`/`prepend`/`contains` and `Array.delete` are legacy-compat (older SugarCube); prefer native `push`/`unshift`/`includes`/`deleteAll` for new stories.
- All randomness uses `Math.random` (no seeded/replayable runs).

### Including other passages

Use `{include: slug}` to splice another passage's text into the current passage at render time. The tag is matched case-insensitively (write it lowercase): `{include: prologue}`.

- **Text is concatenated in place** — included text is processed like any other markup, so `{var:}`, `{if:}`, loops, images, and nested `{include:}` all work inside it. A `{redirect:}` in the included text redirects the player, but only if the include is actually reached.
- **Choices merge.** Links in the included passage become real, clickable choices in the host passage — mutations, prerequisites, and on-enter hooks all work. The host's own choices come first, then included ones in textual order (innermost includes first). Inline action blocks written in the included text render and work normally.
- **`{on_enter}` is not inherited** — the included passage's on-enter hook does not run.
- **Unknown slug:** if no passage matches, `{include: missing}` renders literally so the author notices.
- **Circular includes** are the author's responsibility. A safety counter stops expansion after 100 splices per render pass and shows a one-time toast (`Include limit exceeded.`).
- **Inside `{init}`:** text mutations apply but the merged choices are dropped (init output is suppressed anyway).
- **Reusable:** the same passage can be included in many places; each splice is independent. The classic use is a shared footer or a "welcome" preamble referenced by several passages.
- **Utility nodes:** mark a content-only passage (one that exists purely to be spliced, never navigated into) as a *utility node* in the editor (`is_utility: true`) to exempt it from orphan/dead-end reachability warnings. This flag is editor/validation only — the passage stays in the exported game so `{include:}` can find it.

```json
"text": "The inn is quiet tonight.\n\n{include: inn_description}\n\n{include: tavern_menu}"
```

### Images & Video

Use `{img: url, options}` for images and `{video: url, options}` for video. `url` can be:
- An uploaded asset URL: `/api/assets/GameName/filename.png`
- During export, asset URLs are rewritten to `assets/filename.png`
- External web URLs also work

Options are comma-separated `key=value` pairs (spaces around `=` are fine — `w = 128` works). A key with no `=` is a `true` flag. Unknown keys are ignored. The target is everything before the first comma, so **spaces in filenames are preserved** (`{img: /api/assets/G/A forest.png}` works). The target and `alt` value cannot contain `,`, `}`, or `"`.

| Directive | Options | Defaults |
|---|---|---|
| `{img: url, w=200, h=300, alt=The map}` | `w`, `h` (px), `alt` (accessibility text) | none — natural size, `max-width:100%` |
| `{video: url, autoplay, repeat, mute, w=480, h=270}` | `autoplay`, `repeat` (loop), `mute` (booleans); `w`, `h` | autoplay `true`, repeat `true`, mute `false` |
| `{audio: url, music, loop, volume=0.4, fade=800}` | `music`/`sfx` channel, `loop`, `volume=1`, `fade=0`; bare flags or `key=value` | loop `false`, volume 1, fade 0; default channel is `music` |

```
{img: assets/alex.jpeg, w=200}
{img: assets/banner.png, w=800, h=200}
{img: assets/divider.png, h=50, alt=Section divider}
{video: assets/rain.mp4, w=480, h=270}
{video: assets/intro.webm, autoplay=false, mute}
```

### Tables & Stat Bars

`{table:}...{endtable}`, `{tr:}...{endtr}`, `{td:}...{endtd}`, and `{bar:}` are **display-only** tags — no mutations, no schema change. They are processed entirely at render time; the walker passes them through untouched.

| Tag | Renders to | Params |
|-----|-----------|--------|
| `{table: ...}...{endtable}` | `<table class="nf-table">` | `w=` (px width), `center` (centers table), `border=` (1px cell borders), `cellpadding=` (px cell padding), `cellspacing=` (px spacing), `class=` (extra class) |
| `{tr: ...}...{endtr}` | `<tr>` | `align=` (`text-align`), `class=` |
| `{td: ...}...{endtd}` | `<td class="nf-cell">` | `w=` (px width), `align=`, `valign=`, `colspan=N`, `rowspan=N`, `class=` |
| `{bar: expr, max=100, w=, color=, class=}` | filled `<div>` bar | `expr` = raw JS expression (everything before the first comma); `max=` (default 100); `w=` (px width, default 100%); `color=` (fill color, default theme blue); `class=` |

```
{table: w=600, center, border=1, cellpadding=4}
{tr:}
{td: w=200}Name{endtd}
{td:}Health{endtd}
{endtr}
{tr:}
{td:}Alex{endtd}
{td:}{bar: state.hp, max=100, w=180}{endtd}
{endtr}
{endtable}
```

**Bar value rule.** The expression is evaluated at render time; fill width = `value / max × 100`, clamped to `0–100%`. `undefined`/`null` (e.g. a `state.x` that hasn't been set) → **0% fill** (empty bar). An invalid expression (throws) → the tag renders **literally** so you notice the mistake.

**Newline hygiene.** Tags on their own lines work best: each open tag consumes one preceding newline and each close tag consumes one following newline, so `{endtd}\n{td:}` becomes `</td><td>` with no `<br>` between cells. Don't use **blank lines inside a table region** — a surviving `\n` becomes a stray `<br>`.

**Cell content is normal markup.** Cells can contain `{var:}`, bold/italic, links, `{img:}`, `{dialogue:}`, forms, and `{bar:}`. A `{bar:}` inside a `{live:}` region re-evaluates every tick, so bars stay live. Put `{table:}` at the start of its own paragraph — it renders as a block.

### Audio Directives

Use `{audio: url, options}` for background music and sound effects. `url` points to an uploaded audio file (`mp3`, `wav`, `ogg`, `m4a`, `aac`, `flac`). During export, asset URLs are rewritten from `/api/assets/GameName/file.mp3` to `assets/file.mp3`. External web URLs also work.

Options use the same comma-`key=value` grammar as images/video. The target (URL) is everything before the first comma. Bare flags without `=` act as boolean true; `key=value` pairs require an equals sign. Spaces around `=` are fine. Unknown keys are ignored.

| Directive | Options | Defaults |
|---|---|---|
| `{audio: url}` | Declare/ensure playing on default music channel (idempotent) | none — track starts or stays playing |
| `{audio: url, music}` | Same as bare directive; explicit music channel | default `music` channel |
| `{audio: url, sfx}` | Play on sound effects channel | explicitly selects `sfx` channel |
| `{audio: url, stop}` | Pause track and reset to 0 (like a "fade out" without animation) | pauses + currentTime = 0 |
| `{audio: url, pause}` | Pause track at current position (position kept for resume) | preserves currentTime |
| `{audio: url, restart}` | Reset to 0 and play from start (idempotent on already-playing) | resets then plays |

Other options:
- `loop` — loop the track (default **false**)
- `volume=1` — per-track volume 0–1; default is 1. Combined with channel master volume via `musicVolume`/`sfxVolume`
- `fade=N` — fade-in duration in ms on start (0 = instant; default 0)

```json
{audio: assets/bg.mp3, loop}
{audio: assets/hover.ogg, sfx}
{audio: assets/silence.mp3, stop}
```

**Audio lifecycle rule:** After each full render (passage text + `{include:}` splices), any cached track **not declared** by a play-directive in that render is stopped. Re-declaring an already-playing track is a no-op. This means:
- Per-passage music declares → stops when you leave
- Cross-passage BGM re-declare every passage — DRY via `{include:}` + a `music` utility node (see §Including)
- Always-on HUD music in side panel can't be stopped by a passage (side-panel tracks are always declared)
- Simply don't re-declare to silence, or use `{audio: url, stop}`

**Autoplay caveat:** Browsers block audible autoplay until page interaction. The game requires "New Game" click for initial sound; later declarations after navigation are always fine. Same as video.

> **Tip:** Use `{include: music_node}` with a utility node that re-declares your BGM in every passage to avoid duplication.

### Dialogue Blocks

### Dialogue Blocks

Use `{dialogue:...}...{enddialogue}` to render styled dialogue boxes. The optional parameters inside the opening tag determine the layout:

| Syntax | Result |
|---|---|
| `{dialogue:}text{enddialogue}` | Dialogue text only, no avatar or name |
| `{dialogue: Name}text{enddialogue}` | Name displayed on the left |
| `{dialogue: {img: url}}text{enddialogue}` | Image avatar (56×56 circle) on the left |
| `{dialogue: {img: url}, Name}text{enddialogue}` | Image avatar with name below it |

The body supports all inline markup: bold, italic, images (`{img:}`), video, links, and `{var:state.x}` interpolation.

```json
"text": "{dialogue: {img: assets/alex.jpeg}, Alex}I've got {var:state.gold} gold. Want to trade?{enddialogue}"
```

Image paths follow the same rules as regular passage images — asset URLs are rewritten to `assets/` during export.

---

## 2b. Interactive Form Elements

Form elements let players input data directly into the story — typing text, toggling checkboxes, or selecting radio options. Each element is bound to a story variable and updates it automatically.

### TextField

**Syntax:** `{textfield: state.var, hint, commit_mode}`

Renders a text input field. The variable name uses `state.` prefix in the tag but the field auto-creates the variable.

| Part | Required | Description |
|------|----------|-------------|
| `state.var` | Yes | The story variable to bind to |
| `hint` | No | Placeholder text (grayed out when empty) |
| `commit_mode` | No | Controls when the variable updates: `live`, `blur`, or `onEnterKey` (default) |

**Commit Modes:**

| Mode | Behavior |
|------|----------|
| `live` | Updates `state.var` on every keystroke |
| `blur` | Updates `state.var` when the field loses focus |
| `onEnterKey` | Updates `state.var` when the player presses Enter (default) |

**Examples:**
```
What is your name? {textfield: state.player_name, Enter your name, blur}

Enter your age: {textfield: state.age, , onEnterKey}
```
> Note: No notifications fire on textfield changes, even in `live` mode.

### CheckBox

**Syntax:** `{checkbox: state.var, value}`

Renders a checkbox. When `value` is omitted, the variable toggles as a boolean. When `value` is set, checking sets the variable to that value; unchecking resets it based on the variable's type.

| Part | Required | Description |
|------|----------|-------------|
| `state.var` | Yes | The story variable to bind to |
| `value` | No | If set, checking sets `state.var = value`; unchecking resets to type default |

**Type-aware reset on uncheck:**

| Variable type | Reset value |
|---------------|-------------|
| boolean | `false` |
| number | `0` |
| string | `""` (empty string) |

**Examples:**
```
{checkbox: state.has_sword} Has Sword            ← toggles true/false

{checkbox: state.occupation, farmer} Farmer      ← sets state.occupation = "farmer"
{checkbox: state.occupation, blacksmith} Blacksmith
```

### Radio Button Groups

**Syntax:** `{radiogroup}...{endradiogroup}` wrapping `{radiobutton: state.var, value}`

Only one radio button per group can be selected. Group membership is determined by the `{radiogroup}...{endradiogroup}` wrapper. Selecting a radio button immediately updates the variable and re-renders the side panel (HUD).

| Element | Description |
|---------|-------------|
| `{radiogroup}` | Opens a radio button group |
| `{radiobutton: state.var, value}` | A single radio option; text after the tag is the label |
| `{endradiogroup}` | Closes the group |

**Example:**
```
Choose your class:
{radiogroup}
{radiobutton: state.class, warrior} Warrior
{radiobutton: state.class, mage} Mage
{radiobutton: state.class, rogue} Rogue
{endradiogroup}
```

Text after each `{radiobutton:...}` tag is rendered as regular content (can include bold, links, etc.). The radio group is displayed as a bordered container with stacked options.

### TextArea

**Syntax:** `{textarea: state.var, hint, commit_mode, rows}`

Renders a multi-line text input. Multi-line content can't commit on Enter (Enter inserts a newline), so the default `commit_mode` is `blur`.

| Part | Required | Description |
|------|----------|-------------|
| `state.var` | Yes | The story variable to bind to |
| `hint` | No | Placeholder text (grayed out when empty) |
| `commit_mode` | No | `live` (every keystroke) or `blur` (on blur); default `blur` |
| `rows` | No | Visible height in lines; default `3` |

**Examples:**
```
Tell your story: {textarea: state.bio, What happened?, blur}

Live draft: {textarea: state.draft, , live, 5}
```

### Number

**Syntax:** `{number: state.var, min, max, step}`

Renders a numeric stepper. The value updates live as the player types or uses the spinner arrows, stored as a JS `Number`. **Clearing the field does not overwrite the variable** — the previous value is kept (avoids `number → ""` type flips).

| Part | Required | Description |
|------|----------|-------------|
| `state.var` | Yes | The story variable to bind to |
| `min` | No | Minimum allowed value |
| `max` | No | Maximum allowed value |
| `step` | No | Increment amount (e.g. `0.5`); default browser stepping |

**Examples:**
```
Enter your age: {number: state.age, 1, 150}
Score: {number: state.score, 0, 100, 5}
```

### Dropdown

**Syntax:** `{dropdown: state.var, opt1, opt2, ...}`

Renders a select dropdown; each comma-separated param after `state.var` becomes an option whose value **and label** are the raw text. Options **cannot contain commas** (the tag is comma-split). The option whose value matches the variable is preselected; if the variable is unset or matches nothing, the first option is shown — so **declare the variable with the desired default option value** for a meaningful preselection.

**Example:**
```
Choose your class: {dropdown: state.class, warrior, mage, rogue}
```

Selecting an option immediately updates `state.var` and re-renders the passage.

---

## 3. Variable System

### Declaration
In the `variables` object of the project JSON:
```json
"variables": {
    "hp": 100,
    "has_key": false,
    "player_name": ""
}
```

### Supported Types
| JSON type | JS typeof | Notes |
|---|---|---|
| `true` / `false` | `boolean` | |
| `123` | `number` | Integers and floats |
| `"string"` | `string` | Enter raw text without quotes in the editor form (e.g., `Alex` not `"Alex"`) |
| `["a", "b", 1]` | `array` | Enter as `["a", "b"]` in the editor form; values are re-parsed with JSON when saved |
| `{...}` | `dict` | JSON-safe plain object (Map surrogate). Enter as strict JSON, e.g. `{"name":"Sandra","progress":0}` |

### Object Variables (`dict`)
A variable of type `dict` stores a plain JS object — the JSON-safe stand-in for a Map. Use it for keyed collections where each key holds an object (e.g. `$clients` keyed by day, each `{name, gender, progress}`). The object serializes to/from the manifest as ordinary JSON (no special encoding).

**In the editor form:** pick the `dict` type and enter **strict JSON** (no trailing commas, unquoted keys, or comments):
```
{"name":"Sandra","gender":1,"progress":0}
```

**Authoring a keyed collection at runtime** (`{set:}` uses Spec 34's brace-aware scanner for object literals):
```
{set: state.clients = {}}
{set: state.clients[1] = {name:"Sandra", gender:1, progress:0}}
{set: state.clients[1] = state.clients[1] || {name:"Sandra", gender:1, progress:0}}   # set-if-absent
{set: delete state.clients[1]}                                                        # delete
```

**Object-as-Map access** (bracket indexing; **no** `.get/.has/.delete` method calls — a plain object has none):
- has: `{if: state.clients[state.dayW] !== undefined}`
- get: `state.clients[state.dayW].name`
- set: `state.clients[state.dayW] = {name:"Sandra", progress:0}`
- delete: `{set: delete state.clients[state.dayW]}`

**Display** — a bracketed chain reads a field off the entry:
```
{var: state.clients[state.dayW].name}
```

`{var:}` resolution order (Spec 35): array → joined with `, `; a **whole object** (non-array) → the macro text is emitted unchanged (**never** `[object Object]`); `undefined`/eval-error/missing parent → macro text unchanged; scalar → `String(value)`. `.size` aliasing only applies to `(state|temp|setup)\.\w+` roots; `.size` after a bracket index or on a plain object is unsupported (resolves `undefined`). No nested brackets — one index + a dot-field chain only.

### Arrays
Variables of type `array` hold an ordered list. Enter them in the variable form as JSON, e.g. `["sword", "shield", "potion"]`.

- Read a single element with the index: `{var: state.inventory[0]}`.
- Read the whole array with `{var: state.inventory}` (elements joined with `, `).
- Loop over elements with a counter and the array's `.size`:
  `{set: state.i = 0}{while: state.i < state.inventory.size}{var: state.inventory[state.i]}{set: state.i = state.i + 1}{endwhile}`
- Test emptiness / membership in conditions, e.g. `{if: state.inventory.size > 0}...{endif}`.

### Interpolation in Text
Use `{var:state.varname}` in the node `text` field. At render time it is replaced with the current value. Shows as `{var:state.varname}` if the variable doesn't exist. The shorter `{state.varname}` is also accepted.

### Variables in Expressions
Always reference as `state.variablename`:
- Prerequisites: `state.hp > 0 && state.has_key == true`
- Mutations: `state.hp -= 10`
- Assignments: `state.has_key = true`
- Strings: `state.player_name = "Hero"`

---

## 4. Choices System

### How Choices Work
When you write `[text](node:target_slug)` in the `text` field, you must also add a corresponding entry in the `choices` array.

### Choice Fields

| Field | Required | Description |
|---|---|---|
| `target_node_id` | Yes | Must match the slug in the `[text](node:slug)` link |
| `text` | Auto | Filled from the `[...]` part of the link markup |
| `prerequisite` | No (`null`) | JS expression evaluated before the link is shown. If it returns `false`, the link is disabled (grayed out, not clickable) |
| `mutation` | No (`null`) | JS statement executed when the player clicks this choice |

### Prerequisite Evaluation
```javascript
// How the runtime evaluates prerequisites
try {
    return !!new Function('state', 'try { return ' + prerequisite + '; } catch(e) { return false; }')(state);
} catch {
    disabled = true;
}
```
The expression gets `state` as a parameter. Return a truthy/falsy value.

### Mutation Order
When a choice is clicked:
1. Prerequisite is checked (player can't click if disabled)
2. Mutation executes (if present)
3. Navigation to the target node occurs

---

## 5. Inline Action Blocks

### How Action Blocks Work
Actions are inline paired directives. Clicking the label executes the block's body — a side-effect block of `{set:}`/`{unset:}`/`{include:}`/`{if:}`/loops — exactly once, then re-renders the current node and auto-saves. Unlike choices, action blocks do NOT navigate (unless the body contains `{redirect:}`).

### Syntax

```
{action: text, condition, behavior}body{endaction}
```

| Part | Required | Description |
|---|---|---|
| `text` | Yes | The clickable label, rendered as a link. Static text only (no `{var:}` interpolation); a comma splits params so keep labels comma-free |
| `condition` | No | JS expression vs `state`/`temp`, same engine as choice prerequisites. If false, the link renders disabled (default) or is hidden (`hide` behavior) |
| `behavior` | No | `disable` (default) or `hide`. With `disable`, a false condition gray-outs the link; with `hide`, the whole block renders nothing |
| `body` | — | Side-effect directives executed on click. Never rendered as visible output |

### Examples

```markdown
{action: Pay 10 gold, state.gold >= 10}{set: state.gold -= 10}{set: state.bought = true}{endaction}
{action: Open the chest, state.has_key == true, hide}{set: state.chest_opened = true}{endaction}
```

### Body Contents

The body may contain `{set:}`, `{unset:}`, `{include:}`, nested `{if:}`/`{elseif:}`/`{else}`, loops, and `{audio:}` (see §Audio). A `{redirect: slug}` inside the body navigates on click. The body is skipped verbatim during render — its mutations never fire on page load.

### Common Action Pattern: Combat
Old condition-mutation pairs map to nested `{if:}` branches (first-match-wins order preserved with `{elseif:}`/`{else}`):

```markdown
{action: Attack}{if: state.goblin_hp > 10}{set: state.goblin_hp -= 10}{else}{set: state.goblin_hp = 0}{set: state.gold += 10}{endif}{endaction}
```

### Click-to-Reveal Recipe
Set a flag in the body, then gate the revealed content with `{if:}` in the surrounding passage text:

```markdown
{action: Open the chest}{set: state.has_key = true}{endaction}
{if: state.has_key}You found a rusty key.{else}A locked chest sits here.{endif}
```

### Side Panel Buttons
Put an action block in the `side_panel` node's text to create a persistent HUD button.

### Limitations
- The body never renders visible output — reveal-on-click uses a flag + `{if:}`.
- The label is static (no `{var:}` interpolation inside the tag).
- A comma in the label splits params (label = first field).
- No nested `{action:}` blocks; an unclosed `{action:` renders literally as text.

---

## 6. On Enter Redirect System

### How On Enter Works
Any node can have an `on_enter` field. When the node is about to render, the engine checks the condition. If met (or condition is null), it executes the mutation (if any), then navigates to the target node instead of displaying the current node's content.

### On Enter Evaluation
```javascript
// How the runtime evaluates on_enter
if (node.on_enter && node.on_enter.target_node_id) {
    let shouldRedirect = true;
    if (node.on_enter.condition) {
        shouldRedirect = !!new Function('state', 'try { return ' + node.on_enter.condition + '; } catch(e) { return false; }')(this.state);
    }
    if (shouldRedirect) {
        // Execute mutation, then redirect
        this.render(node.on_enter.target_node_id);
        return;
    }
}
```

### Common Patterns

**One-time urgent scene (use `_visited` to prevent re-trigger):**
```json
"on_enter": {
    "condition": "state.day >= 7 && !state.rent_paid && !state._visited.rent_confrontation",
    "target_node_id": "rent_confrontation"
}
```

**Conditional character encounter:**
```json
"on_enter": {
    "condition": "state.maya_affection >= 15 && state.time_of_day == 'afternoon'",
    "target_node_id": "maya_park_approach"
}
```

### Text-Based Redirects

You can embed redirects directly in a node's text:

```
{redirect:slug}
```

For **conditional redirects**, wrap them in `{if:}` blocks:

```
{if: condition}{redirect:target_slug}{endif}
```

Multiple conditional redirects are evaluated left-to-right, first match wins. The `{if:}...{endif}` block is stripped from displayed text. You can also embed `{set:}` mutations inside the block:

```
{if: state.femininity >= 1}{set: state.femininity += 1}{redirect:dream_gender1}{endif}
{if: state.femininity >= 5}{redirect:dream_gender5}{endif}
```

Unconditional `{redirect:slug}` also works standalone (no `{if:}` wrapper). Text-based redirects are checked **before** the legacy `on_enter` field.

#### `{redirect: back}` — history-back redirect

The reserved target `back` routes to history-back navigation (the same action as the nav-back button) rather than rendering a passage. It is the content-level equivalent of SugarCube's `<<back>>` macro. The typical recipe is a "Back" link:

```
{action: Back}{redirect: back}{endaction}
```

It also works auto-on-entry (`{redirect: back}` alone in a node's text) and from a live tick (`{live: 1000}{if: state.leaving}{redirect: back}{endif}{endlive}`). `back` is **reserved** — a passage literally named `back` cannot be targeted by `{redirect: back}` (use `[text](node:slug)` instead). With no prior history it silently does nothing (its tag is still stripped).

### Pitfalls

| Pitfall | Why | Fix |
|---|---|---|
| No loop guard | Redirect chains infinitely (A→B→A) | Use `state._visited` in conditions |
| Redirect after mutation still shows source | The target node renders, not the source | That's correct — the redirect replaces the current node |
| Mutation runs every time condition is met | If condition stays true, redirect fires repeatedly | Add `state._visited.target` condition to fire once |

---

## 7. Notification System

### Auto-Detection
After every mutation, the engine compares numeric variable values before and after. Any changes (except `day`) are displayed as toast notifications at the bottom of the screen:

| Before | After | Notification |
|--------|-------|-------------|
| `money: 50` | `money: 47` | "Money -3" |
| `confidence: 20` | `confidence: 25` | "Confidence +5" |
| `maya_affection: 5` | `maya_affection: 15` | "Maya Affection +10" |

### Custom Notifications
Writers can call `notify("message")` inside any mutation string:

```javascript
// In a choice or action mutation:
state.has_key = true;
notify("You found a rusty key under the mat!");
```

The `notify` function is passed as a parameter to the mutation's `new Function()` call, so it's always available.

### CSS
Notifications appear as a fixed overlay at the bottom-center of the screen (CSS id: `#game-toast`). Auto-dismiss after 2.5 seconds.

---

## 8. Save/Load System

### Auto-Save
The game automatically saves to `localStorage` (key `storyeditor_save`) after every choice or action mutation. The save includes:
- All variable values (including `_visited`)
- Current node ID
- Project name (to prevent cross-project save conflicts)

### Auto-Restore
On page load, the engine checks for a save matching the current project name. If found, it restores the state and resumes at the saved node.

### New Game
The "New Game" button (top-right corner) clears the save and reloads the page for a fresh start.

### Save Format
```json
{
    "projectName": "MyGame",
    "state": { "...all variables and _visited..." },
    "currentNodeId": "bedroom",
    "timestamp": 1712345678
}
```

---

## 9. Preview

The editor's **Preview Game** button provides a fast testing workflow:
1. **Auto-saves** the current editor state (no manual save required)
2. Generates `preview.html` in the project folder (`backend/data/<name>/preview.html`)
3. Serves the HTML directly from the server at `/api/preview-file/<name>`
4. Opens the preview in a new browser tab

Unlike export, preview does NOT create a ZIP — it writes the HTML file and serves it with assets via relative paths. Use preview for quick iteration cycles.

---

## 10. Runtime Behavior

### Start Node Determination
```javascript
const mainNodeIds = nodeIds.filter(id => id !== 'side_panel');
const explicitStart = mainNodeIds.find(id => this.nodes[id].is_start === true);
this.startNode = explicitStart || (mainNodeIds.length > 0 ? mainNodeIds[0] : (nodeIds.length > 0 ? nodeIds[0] : null));
```
The node with `is_start: true` is the start. If none is marked, the first non-`side_panel` node in the `nodes` array is used. If all nodes are `side_panel`, falls back to the very first node (or `null` if empty).

### Render Cycle
1. The directive walker (`processDirectives`) resolves `{set:}` mutations, `{var:}` interpolation, `{if:}/{elseif:}/{else}/{endif}` branches, and `{while:}/{do}` loops in textual order (each pass through a loop body re-evaluates all directives against current state)
2. `{redirect:}` in resolved text is checked — if found, the redirect fires (mutations have already been applied by the walker)
3. On Enter redirect is checked (if condition met, redirect to target node)
4. Remaining `{redirect:}` directives are stripped
5. Text is converted to HTML: `{random:}` resolved, HTML-escaped, images, links, bold/italic, and headings rendered, `{wait:}` blocks converted to animated containers, `{dialogue:}` blocks rendered as styled dialogue boxes, `{var:}` placeholder tokens replaced with the captured state values
6. Choice prerequisites and action-block conditions are evaluated during render (failing links get `class="disabled"`; hidden blocks render nothing)
7. The HTML is injected into the passage-content div
8. Side panel is re-rendered (via the same `_preprocessText` pipeline)
9. Wait sequences are started (timed fade-in/out animations)

### Side Panel
The `side_panel` node is rendered once on init and re-rendered after every mutation. It does NOT show choices — but inline action blocks in its text render as persistent HUD buttons, and `{var:state.x}` interpolation works.

---

## 11. Common Patterns & Pitfalls

### Minimum Viable Story
```json
{
    "name": "Minimal",
    "variables": { "step": 1 },
    "nodes": [
        {
            "id": "side_panel",
            "title": "Status",
            "text": "Step: {var:state.step}",
            "choices": []
        },
        {
            "id": "start",
            "title": "Start",
            "text": "You are at the beginning. [Go forward](node:cave)",
            "choices": [
                { "target_node_id": "cave", "prerequisite": null, "mutation": "state.step += 1" }
            ]
        },
        {
            "id": "cave",
            "title": "Cave",
            "text": "You found the cave.",
            "choices": []
        }
    ]
}
```

### Pitfalls to Avoid

| Pitfall | Why | Fix |
|---|---|---|---|
| Missing `side_panel` node | The engine expects it; may crash or behave oddly | Always include one |
| Choice without matching `[link](node:slug)` | Choice exists but player can't see it | Add the markdown link in `text` |
| Markdown link without matching choice | Link renders as plain text fallback | Add the choice entry |
| Using `variable_name` instead of `state.variable_name` | Expression evaluates against undefined | Always prefix with `state.` |
| Action block with an unclosed `{endaction}` | Renders literally as text | Always close the block |
| Comma in an action label | Splits params (label truncates) | Keep labels comma-free |
| Two nodes with the same slug `id` | One overwrites the other in the map | Use unique slugs |
| On Enter redirect without loop guard | Can cause infinite redirect loop (A→B→A) | Use `state._visited.target_id` in the condition |
| On Enter mutation runs every visit | If condition stays true, triggers repeatedly | Add `_visited` flag check to fire once |
| Notify() in expression context | `notify()` only works in mutation strings | Use it inside `mutation` fields, not `prerequisite` |
| Conditional text with missing `{endif}` | Engine may drop content after the block | Always close with `{endif}` |
| `{elseif:}` after `{else}` | `{else}` must be the final branch | Put `{elseif:}` branches before `{else}` |

### Variable Name Rules
- Lowercase and underscores preferred (e.g., `has_key`, `player_hp`)
- Avoid spaces and special characters
- Must be valid JS identifiers when accessed as `state.varname`

### Expression Examples

| Purpose | Expression |
|---|---|
| Has item | `state.has_key == true` |
| Health check | `state.hp > 0` |
| Compound | `state.hp > 20 && state.has_key == true` |
| Numeric comparison | `state.gold >= 50` |
| Always true (no gate) | `null` (omit the field or set to null) |
| Decrement | `state.hp -= 10` |
| Set boolean | `state.has_key = true` |
| Set number | `state.gold = 50` |
| Multiple statements | `state.gold -= 10; state.has_key = true` |
| String assignment | `state.name = "Hero"` |
| Mutation with notification | `state.money += 10; notify("Found $10!")` |
| On Enter condition | `state.day >= 7 && !state.rent_paid && !state._visited.overdue` |
| Conditional text | `{if: state.confidence > 20}Stand tall.{elseif: state.confidence > 10}Unsure.{else}Shrink back.{endif}` |

### Time Advancement Guidelines

Only advance `time_of_day` for **substantial activities** that would logically consume the time slot:
- Full classes, work shifts, multi-hour dates → advance time
- Brief encounters, quick conversations, short errands → do NOT advance time

Players should be able to experience multiple brief interactions within the same time slot. A passing conversation in the quad should not prevent them from attending class that same morning.
