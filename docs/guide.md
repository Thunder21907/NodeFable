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
    "nodes": [
        {
            "id": "unique_slug",
            "title": "Display title for the passage",
            "text": "Story content with markup",
            "x": 0.0,
            "y": 0.0,
            "is_start": false,
            "group": "chapter_1",
            "choices": [
                {
                    "target_node_id": "slug_of_target_node",
                    "text": "Auto-populated link text",
                    "prerequisite": "JS expression or null",
                    "mutation": "JS statement or null"
                }
            ],
            "actions": [
                {
                    "id": "unique_action_id",
                    "text": "Button display text",
                    "pairs": [
                        {
                            "condition": "JS expression or null",
                            "mutation": "JS statement"
                        }
                    ]
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

Processed in the runtime engine: conditional resolution (`processConditionals`), mutations (`{set:}`), and redirect stripping are handled in `render()` and `_preprocessText()`. HTML rendering (images, links, waits, bold/italic, variable interpolation `{var:}`) is in `renderContent()`.

| Syntax | Output | Example |
|---|---|---|---|---|
| `[text](node:slug)` | Clickable link that navigates to another passage | `[Go north](node:forest)` |
| `[text](action:id)` | Clickable link that triggers an action | `[Fight](action:a0)` |
| `{random:max}` | Random integer 0 to max inclusive | `{random:10}` |
| `{random:min,max}` | Random integer min to max inclusive | `{random:3,8}` |
| `{set: expr}` | Inline mutation — executes JS expression at render time | `{set: state.time_text = "Morning"}` |
| `{var:state.name}` | Replaced with the current value of `state.name` | `HP: {var:state.hp}` |
| `{if: condition}yes{else}no{endif}` | Conditionally rendered block (evaluated against `state`) | `{if: state.has_key}Door unlocked!{endif}` |
| `{wait:N}...{endwait}` | Timed sequence — content fades in N ms, then fades out (500ms fade default) | `{wait:2000}...{endwait}` |
| `{wait:N,fade:M}...{endwait}` | Wait sequence with custom fade duration M (ms) | `{wait:2000,fade:800}text{endwait}` |
| `{dialogue:...}...{enddialogue}` | Styled dialogue block with optional image and speaker | `{dialogue: Bob}Hello!{enddialogue}` |
| `**bold text**` | Bold | `**warning**` |
| `*italic text*` | Italic | `*whisper*` |
| `# Heading` | `<h1>` | `# The Dark Forest` |
| `## Heading` | `<h2>` | `## A Clearing` |
| `### Heading` | `<h3>` | `### A Sign` |
| `![alt](url)` | Image | `![map](assets/map.png)` |
| Blank line | New paragraph | |
| Unmatched `[...](...)` | Plain text (fallback) | |

### Wait Sequences (Time Transitions)

Use `{wait:N,fade:M}...{endwait}` to create timed fade-in/fade-out sequences. Each `{wait:N,fade:M}...{endwait}` block is a single item. Multiple blocks play sequentially.

- `N` = visible duration in ms (required)
- `M` = fade-in/out duration in ms (optional, default 500)

```json
"text": "I drift off...\n\n{wait:1500,fade:600}\n![dream_scene](assets/dream.jpeg)\n\nA surreal moment...\n{endwait}\n\nI wake with a start."
```

Content after the final `{endwait}` remains hidden until all sequences finish, then fades in smoothly. Content before the first `{wait:N}` renders immediately. Multiple wait blocks run sequentially. Variable interpolation and markdown work inside wait items.

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

**Important:** Unlike choice/action mutations, `{set:}` runs every time the passage renders, including during side panel refresh. Avoid side effects that should only fire once unless guarded by a condition.

### Images
Use `![alt](url)` where `url` can be:
- An uploaded asset URL: `/api/assets/GameName/filename.png`
- During export, asset URLs are rewritten to `assets/filename.png`
- External web URLs also work

Custom dimensions: append `{img:w=200,h=300}` right after the closing `)` to set width and/or height. Use `w=` for width, `h=` for height, comma-separated. Omit either for auto scaling based on aspect ratio.

```
![Alex](assets/alex.jpeg){img:w=200}
![Banner](assets/banner.png){img:w=800,h=200}
![Divider](assets/divider.png){img:h=50}
```

### Dialogue Blocks

Use `{dialogue:...}...{enddialogue}` to render styled dialogue boxes. The optional parameters inside the opening tag determine the layout:

| Syntax | Result |
|---|---|
| `{dialogue:}text{enddialogue}` | Dialogue text only, no avatar or name |
| `{dialogue: Name}text{enddialogue}` | Name displayed on the left |
| `{dialogue: ![img](url)}text{enddialogue}` | Image avatar (56×56 circle) on the left |
| `{dialogue: ![img](url), Name}text{enddialogue}` | Image avatar with name below it |

The body supports all inline markdown: bold, italic, images, links, and `{var:state.x}` interpolation.

```json
"text": "{dialogue: ![portrait](assets/alex.jpeg), Alex}I've got {var:state.gold} gold. Want to trade?{enddialogue}"
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

## 5. Actions System

### How Actions Work
Actions are triggered by `[text](action:action_id)` links. Unlike choices, actions do NOT navigate — they only modify state and re-render the current node.

### Action Fields

| Field | Required | Description |
|---|---|---|
| `id` | Yes | Unique within the node. Referenced by `[text](action:id)` |
| `text` | Yes | Display text shown in the link (overrides the `[text]` portion) |
| `pairs` | Yes | Array of condition+mutation objects |

### Pairs Logic (First-Match Wins)

The runtime iterates through `pairs` in order and executes the **first** matching pair's mutation, then stops. A pair matches if:

- `condition` is `null` (always matches), OR
- `condition` evaluates to `true`

```javascript
for (const pair of action.pairs) {
    let met = true;
    if (pair.condition) {
        met = !!new Function('state', 'try { return ' + pair.condition + '; } catch(e) { return false; }')(this.state);
    }
    if (met) {
        new Function('state', pair.mutation)(this.state);
        break;  // first match wins, then stop
    }
}
```

### Pair Fields

| Field | Required | Description |
|---|---|---|
| `condition` | No (`null`) | JS expression. If `null`, this pair always matches |
| `mutation` | Yes | JS statement to execute |

### Common Action Pattern: Combat
```json
{
    "id": "a0",
    "text": "Attack",
    "pairs": [
        {
            "condition": "state.goblin_hp > 10",
            "mutation": "state.goblin_hp -= 10"
        },
        {
            "condition": "state.goblin_hp <= 10",
            "mutation": "state.goblin_hp = 0; state.gold += 10"
        }
    ]
}
```
This handles the "still alive" vs "just killed" cases.

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
1. Conditional blocks `{if:}/{elseif:}/{else}/{endif}` are resolved to the winning branch
2. `{redirect:}` in resolved text is checked — if found, `{set:}` mutations execute and redirect fires (returns to step 1 with target node)
3. On Enter redirect is checked (if condition met, redirect to target node)
4. `{set:}` mutations are executed, remaining `{redirect:}` directives are stripped
5. Text is converted to HTML: `{random:}` resolved, HTML-escaped, images, links, bold/italic, and headings rendered, `{wait:}` blocks converted to animated containers, `{dialogue:}` blocks rendered as styled dialogue boxes, `{var:}` tokens replaced with current state values
6. Choice prerequisites and action conditions are evaluated during link rendering (failing links get `class="disabled"`)
7. The HTML is injected into the passage-content div
8. Side panel is re-rendered (via the same `_preprocessText` pipeline)
9. Wait sequences are started (timed fade-in/out animations)

### Side Panel
The `side_panel` node is rendered once on init and re-rendered after every mutation. It does NOT show choices or actions — only its `text` content with variable interpolation using `{var:state.x}`.

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
            "choices": [],
            "actions": []
        },
        {
            "id": "start",
            "title": "Start",
            "text": "You are at the beginning. [Go forward](node:cave)",
            "choices": [
                { "target_node_id": "cave", "prerequisite": null, "mutation": "state.step += 1" }
            ],
            "actions": []
        },
        {
            "id": "cave",
            "title": "Cave",
            "text": "You found the cave.",
            "choices": [],
            "actions": []
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
| Multiple conditions matching in action pairs | Only the FIRST match executes | Order pairs from most-to-least specific |
| Forgetting `"actions": []` on a node | Engine may error on undefined | Always include the field |
| Non-unique action `id`s within a node | Wrong action may trigger | Use sequential ids: a0, a1, a2... |
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
