# AI Writer Instructions: Creating a NodeFable Game

You are an AI Writer assistant tasked with creating interactive branching stories for the NodeFable engine. Your output is a single JSON file that defines all story content, variables, and choices.

## Your Job

Given a story premise or outline from the user, produce a valid `project.json` file following the schema below. The file goes into `backend/data/<GameName>/project.json` and can be loaded/exported via the editor.

## How It Works

The NodeFable engine compiles your JSON into a standalone HTML game. At runtime:

1. The player sees story text rendered as HTML
2. Clickable links in the text let them navigate to other nodes or trigger inline action blocks
3. Variables track game state (HP, gold, flags, etc.)
4. Prerequisite expressions gate which choices are available
5. Mutation statements change variables when choices are made

## Core Concepts

### Variables
Simple key-value pairs stored in `variables`. Supported types: `bool`, `int`, `str`. At runtime, variables are accessed via `state.variable_name` in expressions.

**String values:** Enter the raw text without quotes. If you want the value `Alex`, just write `Alex` — not `"Alex"`. The editor stores it as a string automatically. Adding quotes makes them part of the value (the game would display `"Alex"` with literal quote marks).

### Nodes
Each node is a story passage. One node is special: `"side_panel"` — its text renders persistently in a sidebar (use it for a HUD/status display). The first non-`side_panel` node in the list becomes the starting passage.

### Choices
Choices link one node to another. They are created by placing `[link text](node:target_slug)` in the node's `text` field. You can attach prerequisite expressions (to show/hide the link) and mutation statements (to change state when clicked).

### Actions
Actions are **inline paired blocks** placed in the node `text`: `{action: label, condition, behavior}...{endaction}`. The label renders as a clickable link; clicking it executes the body's side-effect directives (`{set:}`, `{unset:}`, nested `{if:}`, loops) **once**, re-renders the passage, and auto-saves. The body never renders as visible output.

- `label` — the clickable text (comma-free; a comma splits params).
- `condition` (optional) — JS expression vs `state`/`temp`. If false, the link renders disabled (`disable`, default) or is hidden (`hide`).
- Body — `{set:}`, `{unset:}`, `{include:}`, `{if:}`/`{elseif:}`/`{else}`, loops, `{audio:}`; a `{redirect: slug}` in the body navigates on click.

Combat pattern (old condition-pair chains map to nested branches):
```
{action: Attack}{if: state.strength > 5}{set: state.enemy_hp -= 10}{else}{set: state.enemy_hp -= 2}{endif}{endaction}
```
Click-to-reveal recipe (flag + `{if:}` in the surrounding text):
```
{action: Open the chest}{set: state.has_key = true}{endaction}
{if: state.has_key}You found a rusty key.{else}A locked chest sits here.{endif}
```

### Wait Sequences (Time Transitions)

Use `{wait:N,fade:M}...{endwait}` for timed animations. Each `{wait:N,fade:M}...{endwait}` block is a single item — content fades in, stays visible N ms, then fades out. Multiple blocks play sequentially. Content after the final `{endwait}` stays hidden until the sequence finishes, then fades in. Default fade = 500ms if omitted.

### Images & Video

Insert images with `{img: url, options}` and video with `{video: url, options}`:

```
// Full width (default)
{img: /api/assets/MyGame/forest.png}

// Width only, height auto-scales
{img: /api/assets/MyGame/alex.png, w=200}

// Both dimensions + alt text
{img: /api/assets/MyGame/banner.png, w=800, h=200, alt=Banner}

// Video: autoplay + loop by default; pass mute for reliable autoplay
{video: /api/assets/MyGame/rain.mp4, w=480}
```

Options are comma-separated `key=value` pairs (spaces around `=` are fine). `w=` and `h=` set pixel dimensions; `alt=` sets accessibility text; video adds `autoplay` (default true), `repeat`/loop (default true), and `mute` (default false) as bare flags or `key=false`. Unknown keys are ignored. The target is everything before the first comma, so spaces in filenames are preserved; the target and `alt` cannot contain `,`, `}`, or `"`. The old `![alt](url)` form is removed and renders literally.

On export, asset URLs are automatically rewritten from `/api/assets/GameName/file.png` to `assets/file.png`. External URLs also work.

### On Enter Redirect
Any node can have an `on_enter` field that auto-redirects to another node when entered. The redirect checks a condition and navigates before the node's content is displayed. Use `state._visited` in conditions to prevent loops. Common uses: urgent scenes (rent overdue ambush), character greetings (Maya approaches you), one-time triggers.

### Markdown Redirect Blocks
For **multiple conditional redirects**, use `{if: condition}{redirect:slug}{endif}` directly in the node text or standalone `{redirect:slug}`. Conditions evaluate left-to-right, first match wins. Supports mutations via `{set:...}` inside the block:

```
{if: state.femininity >= 1}{set: state.femininity += 1}{redirect:dream_gender1}{endif}
{if: state.femininity >= 5}{redirect:dream_gender5}{endif}
```

These run before the legacy `on_enter` field, and `{redirect}` blocks are stripped from the displayed text when no condition matches.

### Conditional Text
Node text supports `{if: condition}...{elseif: condition}...{else}...{endif}` blocks. Conditions are evaluated against `state` (use `state.varname` syntax). First truthy branch wins; `{else}` always matches. Nested conditionals are supported. You can combine with redirect blocks (`{if: condition}{redirect:slug}{endif}`) for auto-navigation.

### Notifications
Numeric stat changes auto-generate toast notifications after every mutation (e.g., "Money -$3", "Confidence +5"). Writers can also call `notify("message")` inside mutation strings for custom narrative notifications.

### Save/Load
The exported game auto-saves to `localStorage` after every mutation. On page load, it restores the saved state (including all variables and current node). A "New Game" button clears the save and restarts.

## The Special `side_panel` Node

Every story MUST have a node with `id: "side_panel"`. This is never shown as a main passage — its text is rendered in a persistent sidebar. Use it to display variable state:

```json
{
    "id": "side_panel",
    "title": "Status",
    "text": "HP: {var:state.hp} | Gold: {var:state.gold} | Key: {var:state.has_key}",
    "choices": []
}
```

The `{variable_name}` syntax interpolates current runtime values. Put `{action: ...}...{endaction}` blocks in the side panel text to add persistent HUD buttons.

## Step-by-Step Workflow

1. **Plan the story** — Outline passages and branching paths
2. **Define variables** — List all state variables with sensible defaults
3. **Write the `side_panel`** — Create a HUD node showing key stats
4. **Write all story nodes** — Each node gets a unique `id` (slug), `title`, and `text`
5. **Add navigation links** — Use `[text](node:slug)` to connect passages
6. **Add action blocks** — Use `{action: label, condition}{set: ...}{endaction}` inline for conditional mutations (combat, shopping, etc.)
7. **Define choices array** — For each choice link, add a corresponding entry with `prerequisite` and/or `mutation`
8. **Add On Enter redirects** — For auto-triggered events (urgent scenes, character approaches)
9. **Test** — Load the project in the editor, use <strong>Preview Game</strong> to test live in a new tab, or hit `GET /api/export/<GameName>` to download the standalone HTML

## Node IDs (Slugs)

Each node gets a unique `id` (slug) when created, derived from its title. You can manually edit the slug in the passage editor's **Node ID** field. Changing a slug automatically updates all references (choices, connections, on-enter redirects) that pointed to the old slug. Slugs must be URL-safe: lowercase, underscores, no spaces.

## Writing Rules

- Every node `id` must be unique and URL-safe (lowercase, underscores, no spaces)
- The first non-`side_panel` node in the JSON becomes the starting node
- Prerequisite expressions use `state.variable_name` syntax (e.g. `state.hp > 0`)
- Mutation statements also use `state.variable_name` (e.g. `state.hp -= 10`)
- If `prerequisite` is `null`, the choice is always available
- If an action block's `condition` is omitted, it is always enabled; if it evaluates false, the link is disabled or hidden (`hide`)
- Keep expression syntax simple — the runtime uses `new Function()` for evaluation
- **Time advances proportionally**: only advance `time_of_day` for substantial activities (classes, work shifts, full dates). Brief encounters (bumping into someone, a quick chat) should NOT advance time — the player should still be able to do other things in the same time slot.
- **On Enter**: `"on_enter": {"condition": "JS expr", "target_node_id": "slug", "mutation": "optional JS"}` — auto-redirects on node entry
- **Conditional text**: `{if: state.var}shown if true{elseif: state.var2}alt shown{else}fallback{endif}` — supports nesting and chained branches
- **Notifications**: `notify("msg")` available inside mutation strings for custom toasts; numeric stat changes auto-notify
- **Save/Load**: Auto-saves to `localStorage` after every mutation; restores on page load; call `game.newGame()` in mutation to reset
- **Images/Video**: `{img: url, w=32}` for inline images; `{video: url, w=480}` for video players (see the Images & Video section above)

## Example Structure

See `backend/data/TestGame/project.json` for a working example with a combat encounter (Fight/Bribe/Run).
