# app.js — Technical Reference

## Overview

`app.js` is the sole frontend JavaScript file for the NodeFable graph canvas. It manages the Drawflow instance, a custom node data store (`nodesData`), a slug–ID mapping (`slugToNodeId`), global variables, passage editing, save/load modals, export, preview, and asset management. The file follows a flat procedural style with no framework — all functions and state are globals or attached to `window`.

---

## Global State

| Variable | Type | Purpose |
|---|---|---|
| `editor` | `Drawflow` | The Drawflow canvas instance |
| `selectedNodeId` | `number \| null` | Currently selected node's Drawflow numeric ID |
| `linkingFromId` | `number \| null` | Node ID from which a link is being drawn |
| `nodesData` | `object` | Keyed by Drawflow numeric ID → `{title, text, choices, actions, slug, on_enter, is_start}` |
| `slugToNodeId` | `object` | Slug → Drawflow numeric ID reverse lookup |
| `variables` | `object` | Keyed by variable name → `{type, value}` |
| `isEditingVariable` | `boolean` | True while the variable form is in edit mode |
| `editVariableBackup` | `object \| null` | Backup `{name, type, value}` of the variable being edited |
| `isLoading` | `boolean` | True during project load to suppress `connectionCreated` side effects |
| `currentProjectName` | `string \| null` | Name of the currently loaded/saved project |
| `selectedSaveName` | `string \| null` | Selected item in the save modal list |
| `selectedLoadName` | `string \| null` | Selected item in the load modal list |
| `loaderCount` | `number` | Reference counter for nested loader calls |
| `toastTimeout` | `number \| null` | Timeout ID for auto-dismissing toast notifications |
| `searchDebounceTimer` | `number \| null` | Timeout ID for search input debounce |
| `MAX_UNDO` | `50` | Maximum snapshots in undo stack |
| `undoStack` | `array` | Snapshot history for undo |
| `redoStack` | `array` | Snapshot history for redo |
| `undoInProgress` | `boolean` | Prevents re-snapshotting during undo/restore |

---

## Initialization

### `DOMContentLoaded` handler

1. Gets `#tab-graph` container.
2. Creates `new Drawflow(container)` and calls `editor.start()`.
3. Monkey-patches `editor.updateConnectionNodes` with a last-call-wins RAF throttle (avoids layout thrashing during drag, bypassed during `isLoading`).
4. Sets `zoom_max = 2.0`, `zoom_min = 0.15`, `zoom_value = 0.05`, `curvature = 0.3`.
5. Calls `setupEditorEvents()`, `setupTabs()`, `setupModalEvents()`, `setupSearch()`.
6. Registers a `mousedown` listener on the container for Drawflow panning fix.
7. Registers blur listener on `#passage-content` for auto-save.
8. Registers global `keydown` listener for keyboard shortcuts (Ctrl+S, Ctrl+Z/Y, Delete, Escape).
9. Calls `ensureSidePanelNode()` after 100ms delay.

---

## Drawflow Event Wiring

### `setupEditorEvents()`

Finds the `.drawflow` DOM element, then registers all Drawflow and DOM event listeners. If `.drawflow` is not found, logs an error and returns early (no events are wired).

Then iterates `document.querySelectorAll('.drawflow-node')` to inject overlays into any nodes that already exist.

#### Drawflow events

| Event | Handler | Behaviour |
|---|---|---|
| `nodeSelected` | `openPassageEditor(nodeId)` | Opens the passage editor for the clicked node (skipped while `linkingFromId !== null`). |
| `nodeUnselected` | `closePassageEditor()` | Hides the passage editor. |
| `nodeCreated` | `injectOverlayToNode(nodeId)` | Adds Edit/Delete/Link overlay buttons to the new node's DOM element. |
| `nodeRemoved` | Cleanup + choice cleanup | Deletes the node from `nodesData` and `slugToNodeId`. Removes orphaned choice references from all other nodes. Runs `validateDeadEnds()` and `validateOrphans()`. Calls `closePassageEditor()` if the removed node was selected. |
| `connectionCreated` | Choice creation | Skips during `isLoading`. Creates a `{targetSlug, text, prerequisite, mutation, connectionId}` choice object and pushes it to the source node's `choices` array. Inserts a markdown link at cursor or appends to content. Re-renders choices. Runs `validateDeadEnds()` and `validateOrphans()`. |
| `connectionRemoved` | Choice cleanup + snapshot | Takes undo snapshot. Removes the matching choice by `targetSlug`. Strips the markdown link from text. Re-renders choices. Runs validation. |

#### DOM events on `.drawflow`

| Event | Behaviour |
|---|---|
| `mousedown` (capture phase) | If click lands on `.drawflow-node`, exits pan mode before Drawflow's handler fires. |
| `click` | Ignores `.node-overlay` clicks. Closes passage editor if click is on empty canvas. Handles linking mode target clicks. |
| `dblclick` | Opens passage editor and switches to Markdown Editor tab. |

---

## Tab Management

### `setupTabs()`

Binds `click` handlers to each `.tab-btn`. On click: removes `active` from all, adds to clicked button, shows corresponding `#tab-{name}`.

---

## Slug Utilities

### `slugify(text)`

Converts arbitrary text to URL-safe slug: lowercase, non-alphanumeric → `_`, leading/trailing `_` stripped. Falls back to `'unnamed'`.

### `generateUniqueSlug(baseSlug)`

Appends `_2`, `_3`, etc. until unique in `slugToNodeId`.

### `getNodeSlug(nodeId)`

Returns `nodesData[nodeId].slug` or `null`.

### `getNodeIdBySlug(slug)`

Returns `slugToNodeId[slug]` or `null`.

### `getNodeTitleBySlug(slug)`

Returns the title of the node identified by the slug, or the slug itself if not found.

### `getNodeTitle(nodeId)`

Returns `nodesData[nodeId].title` or `'Node ' + nodeId`.

---

## Node Data Management

### `ensureNodeData(nodeId)`

Ensures `nodesData[nodeId]` exists with all required fields (`title`, `text`, `choices`, `slug`, `is_start`, `actions`, `on_enter`). Fills in missing fields with defaults. Slug is generated once and persisted.

### `addNode()`

1. Takes an undo snapshot.
2. Generates random position (50–450 × 50–350).
3. Calls `editor.addNode('story_node', 1, 1, posX, posY, 'story_node', {}, 'New Node')`.
4. Creates `nodesData[nodeId]` with `{is_start: false}` and unique slug.
5. Opens the passage editor for the new node.

### `ensureSidePanelNode()`

Creates a node with slug `side_panel` (including `is_start: false`) if it does not already exist. Called after init and after every project load.

### `injectOverlayToNode(nodeId)`

Finds the `.drawflow-node` DOM element by `[data-id="{nodeId}"]`. If no `.node-overlay` exists, creates a `div.node-overlay` with Edit ✎, Delete ✖, and Link 🔗 buttons. Each button calls `event.stopPropagation()`.

### `updateStartBadgeOnCanvas(nodeId)`

Adds or removes a green "START" badge on the node's Drawflow element based on `nodesData[nodeId].is_start`.

### `editNode(nodeId)`

Calls `openPassageEditor(parseInt(nodeId))`. Wired to overlay's Edit button.

### `deleteNodeOverlay(nodeId)`

Takes undo snapshot. Prompts for confirmation, calls `editor.removeNodeId(...)`, cleans up `nodesData` and `slugToNodeId`, closes passage editor.

### `deleteCurrentNode()`

Same as `deleteNodeOverlay` but operates on `selectedNodeId`. Protect by confirming.

---

## Linking Mode

### `window.startLinking(nodeId)`

Sets `linkingFromId = parseInt(nodeId)`, adds `is-linking` class to `<body>`.

### `cancelLinking()`

Clears `linkingFromId`, removes `is-linking` class.

### `handleLinkTargetClick(targetId)`

Takes undo snapshot. If `linkingFromId` is null or self-link, cancels. Otherwise calls `editor.addConnection(...)`, then cancels linking mode.

---

## Passage Editor

### `openPassageEditor(nodeId, skipDirtyCheck)`

1. If `!skipDirtyCheck` and switching nodes, auto-saves previous node's content via `saveCurrentContent()`.
2. Sets `selectedNodeId = parseInt(nodeId)` (normalized to number), calls `ensureNodeData`.
3. Shows `#passage-editor`, populates title, content, slug, and error state.
4. Shows/hides `#passage-is-start` checkbox (hidden for `side_panel`), sets its state.
5. Calls `renderChoices`, `renderActions`, `renderOnEnter`, `updateStartBadgeOnCanvas`.

### `closePassageEditor()`

Sets `selectedNodeId = null`, hides `#passage-editor`, shows `#no-selection-msg`.

---

## Slug Validation

### `showIdError(msg)`, `hideIdError()`, `validateSlugOnBlur()`

Validates slug uniqueness and non-emptiness on blur. Shows/hides error indicator.

---

## Choice Rendering

### `renderChoices(nodeId)`

Renders `#choices-list`. For each choice: target title, link text, Remove button, Prerequisite and Mutation inputs.

---

## Action Rendering & Management

### `renderActions(nodeId)`, `deleteAction`, `addPair`, `removePair`, `updateAction`

Full CRUD for action condition-mutation pairs. Each action has a text input, Update/Remove buttons, and per-pair Condition/Mutation inputs.

---

## On-Enter Auto-Redirect

### `renderOnEnter(nodeId)`, `toggleOnEnter`, `updateOnEnterField`

Checkbox to enable/disable auto-redirect. When enabled: target dropdown, condition input, mutation input.

### Text-Based Redirects (`_checkRedirects`)

Added Jul 2026. The `render()` method first calls `processConditionals(node.text)` to resolve all conditional branches (`{if:}/{elseif:}/{else}/{endif}`), then calls `_checkRedirects()` on the resolved text. `_checkRedirects` is now a simple regex scan for `{redirect:slug}` — condition resolution is handled by the separate `processConditionals` pass. Supports `{set:}` mutations (executed via `_executeMutations` before redirect). Unconditional `{redirect:slug}` works naturally. `renderContent()` no longer handles conditionals, mutations, or redirect stripping — these are moved into `render()` and `_preprocessText()` for a cleaner pipeline.

---

## Content Editing (Markdown Toolbar)

### `insertMarkdown(before, after)`

Wraps selected text with formatting markers.

### `insertImage()`

Requires `currentProjectName`. Uploads file to `POST /api/assets/{name}`, inserts `![alt](url)` at cursor, refreshes asset list. Optionally append `{img:w=200,h=300}` after the closing `)` to set custom image dimensions (see `docs/guide.md`).

### `insertAction()`

Requires `selectedNodeId`. Generates a globally unique action ID (`a0`, `a1`, ...) by scanning all nodes. Creates action with default pair.

### `deduplicateActionIds()`

Fixes duplicate action IDs across all nodes. Called at end of `confirmLoad()`.

---

## Save Data

### `saveCurrentContent(nodeId)`

Lightweight content sync: reads title, content, and slug from DOM and writes to `nodesData[nodeId]`. Used for auto-save on node switch (Feature 10).

### `updateCurrentNode()`

Takes undo snapshot. Reads title, slug, content from DOM. Syncs `is_start` from checkbox (enforces single-start — unchecks all others). Updates slug references across all nodes. Syncs choice prerequisites/mutations and action pairs from the DOM. Updates Drawflow node label. Re-renders choices and on-enter.

---

## Variable Management

### `showVariableForm()`, `hideVariableForm()`, `addVariable()`, `editVariable()`, `deleteVariable()`, `renderVariables()`

Full CRUD for global variables with type-specific parsing (int, float, bool, string).

- `editVariable(name)` — called when clicking a variable in the list. Saves a backup (`editVariableBackup`), deletes the variable, pre-fills the form, changes submit button to "Save Changes". If another edit was in progress, restores the prior backup first.
- `hideVariableForm()` — hides the form and clears fields. If called during an edit, restores the variable from backup and refreshes the list.
- `addVariable()` — validates and parses values, clears `editVariableBackup` (so `hideVariableForm` doesn't re-restore), stores the variable, hides the form, re-renders.

---

## Asset Management

### `loadAssetList()`

Async. Fetches `GET /api/assets/{name}`. If assets exist, renders each with thumbnail, syntax string, and delete button (✕). Clicking an asset copies its syntax. Clicking ✕ calls `deleteAsset()`.

### `window.copyAssetSyntax(el)`

Copies `.asset-syntax` text to clipboard with green flash feedback.

### `deleteAsset(filename)`

Async. Confirms with user, sends `DELETE /api/assets/{name}/{filename}`, refreshes asset list in `finally` block. Shows toast on success.

---

## Validation (Feature 3)

### `validateDeadEnds()`

Scans all non-`side_panel` nodes. If a node has zero outgoing choices AND no `on_enter` redirect AND no text-based `{redirect:slug}` pattern, adds `node-dead-end` class (red border). Otherwise removes it.

### `validateOrphans()`

Runs BFS from the start node across choice targets, `on_enter` targets, and text-based `{redirect:slug}` targets (parsed from all nodes' text). Nodes not visited (excluding `side_panel`) get `node-orphan` class (dashed orange border + dimmed).

### `runValidation()`

Runs both checks and shows an `alert()` summary: count of dead-end and orphan nodes.

**Triggered on:** project load, connection created/removed, node removed. Also available via Validate toolbar button.

---

## Modal System

### `closeModal()`, `openModal(type)`, `formatMtime(ts)`, `fetchSaves()`

Standard modal lifecycle. `fetchSaves()` calls `GET /api/saves`.

### `renderSaveList(saves)`, `renderLoadList(saves)`

Render the save/load lists using `escapeHtml()` and `data-name` attributes. Feature 1 fix: no inline onclick — uses event delegation instead.

### `setupModalEvents()`

Registers delegation click listeners on `#save-list` and `#load-list`. Reads `item.dataset.name`, highlights the selected item, sets `selectedSaveName` / `selectedLoadName`. Replaces the old `window.selectSave` / `window.selectLoad` functions.

### `showSaveModal()`, `showLoadModal()`

Async. Fetch saves, render list, open modal.

### `confirmSave()`

Async. Syncs textarea content. Reads project name. Iterates `nodesData`, serializes choices, actions, on_enter, and `is_start`. POSTs to `/api/save`. Shows loader, then toast on success.

### `confirmLoad()`

Async. Clears undo/redo stacks. Syncs textarea content. Fetches project JSON. Clears canvas, creates nodes in two passes. Loads `is_start` from project data. Calls `updateStartBadgeOnCanvas` for all nodes. Runs validation and re-applies search filter. Shows loader and toast.

---

## Export & Preview

### `exportGame()`

Async. Requires `currentProjectName`. **Auto-saves** via `saveProjectSilent()` before redirecting (Feature 4). Shows loader. Redirects to `/api/export/{name}`.

### `previewGame()`

Async. Requires `currentProjectName`. Auto-saves via `saveProjectSilent()`, then fetches `GET /api/preview/{name}`. Opens preview URL in new tab. Shows loader.

### `saveProjectSilent()`

Async. Syncs textarea content to `nodesData`. Serializes nodes (including `is_start`) and variables. POSTs to `/api/save` using `currentProjectName`. Throws on failure.

---

## Undo/Redo System (Feature 6)

### Global state

`MAX_UNDO = 50`, `undoStack`, `redoStack`, `undoInProgress`.

### `snapshotState()`

Deep-clones `nodesData`, copies `slugToNodeId`, and reads all Drawflow connections + node positions (`_posX`, `_posY`). Pushes to `undoStack`, caps at 50, clears `redoStack`.

### `captureCurrentState()`

Same as `snapshotState()` but returns the snapshot instead of pushing to a stack.

### `restoreState(snap)`

Clears canvas, rebuilds all nodes via `editor.addNode()` with an `oldToNewId` mapping. Restores connections using the new IDs. Restores `slugToNodeId` with remapped IDs. Runs validation and re-applies search filter.

### `undo()` / `redo()`

Pop from respective stack, push current state to the other stack, call `restoreState()`. Show toast feedback.

**Snapshot trigger points:** `addNode()`, `deleteNodeOverlay()`, `deleteCurrentNode()`, `handleLinkTargetClick()`, `connectionRemoved`, `updateCurrentNode()`.

---

## Keyboard Shortcuts (Feature 5)

Registered in the global `keydown` handler:

| Key | Action |
|---|---|
| `Ctrl+S` | Save. If project named, silent-save + toast. If unnamed, open save modal. |
| `Ctrl+Z` | Undo (if undo function exists) |
| `Ctrl+Shift+Z` / `Ctrl+Y` | Redo |
| `Delete` / `Backspace` | Delete selected node (skipped when input/textarea focused) |
| `Escape` | Cancel linking → close modal → clear search → deselect node |

Uses `e.code` for letter keys, `e.key` for non-letter keys. Checks `e.metaKey` for Mac compatibility.

---

## Node Search / Filter (Feature 9)

### `filterNodes(query)`

Iterates all nodes. If query matches node title or slug (case-insensitive), adds `node-search-match` class (blue glow). Non-matching nodes get `node-search-mismatch` class (opacity 0.15, pointer-events: none). Empty query clears all classes.

### `setupSearch()`

Registered in `DOMContentLoaded`. Attaches `input` event with 150ms debounce. Escape key clears the search and blurs the input.

Re-applied after project load and after undo/restore.

---

## Loading Indicators (Feature 7)

### `showLoader(msg)`

Reference-counted. Displays a modal overlay with spinner and message text.

### `hideLoader()`

Decrements counter. Hides overlay when count reaches 0.

### `showToast(msg)`

Creates a fixed bottom-center toast element that auto-dismisses after 2 seconds with fade-out.

**Used in:** `confirmSave()` ("Saving..." / "Project saved!"), `confirmLoad()` ("Loading..." / "Loaded: ..."), `previewGame()` ("Generating preview..."), `exportGame()` ("Exporting..."), `deleteAsset()` ("Deleted: ..."), undo/redo.

---

## Start Node Marker (Feature 2)

### `is_start` field

Each node in `nodesData` has `is_start: bool`. The `#passage-is-start` checkbox in the passage editor toggles this via `toggleStartNode()` (called from `onchange`). When checked, all other nodes are unchecked (single-start enforcement). The `side_panel` node hides the checkbox.

**Bug fix (Jul 2026):** Drawflow passes `nodeId` as a string in events. The `parseInt(nid) !== selectedNodeId` comparison in both `toggleStartNode()` and `updateCurrentNode()` therefore failed intermittently (`4 !== "4"`), causing the loop to clear the current node's own `is_start`. Fixed by normalizing `selectedNodeId = parseInt(nodeId)` in `openPassageEditor()`. Note: `selectedNodeId` can go stale when switching nodes — always read from the event argument, not `selectedNodeId`, for checks that must reference a specific node from an event context.

`updateStartBadgeOnCanvas()` adds/removes a green "START" badge on the Drawflow node element.

Serialized in both `confirmSave()` and `saveProjectSilent()`. Loaded in `confirmLoad()`.

---

## Markdown Auto-Save (Feature 10)

- `blur` listener on `#passage-content` syncs text to `nodesData[selectedNodeId].text`.
- `openPassageEditor()` with `skipDirtyCheck` calls `saveCurrentContent()` on the previous node before switching.
- `saveProjectSilent()` and `confirmSave()` sync textarea content at the top.

---

## Utility Functions

### `escapeHtml(str)`

Escapes `&`, `<`, `>`, `"`, `'` for safe HTML interpolation.

### `getLinkTextFromContent(content, targetSlug)`

Extracts display text from `[text](node:slug)` markdown link.

### `escapeRegex(str)`

Escapes special regex characters.

### `window.removeChoiceLink(sourceId, targetSlug)`

Calls `editor.removeSingleConnection(sourceId, targetId, ...)` to remove a connection by slug lookup.

---

## Performance: `updateConnectionNodes` Monkey-patch

The original `editor.updateConnectionNodes` is bound and wrapped with a last-call-wins RAF throttle:

```
updateConnectionNodes(nodeId)
  ├─ if isLoading → origUpdate(nodeId) immediately
  └─ else
       ├─ cancel any pending RAF
       └─ schedule RAF → on next frame: updatePending = null, origUpdate(nodeId)
```

**Bypassed during `isLoading`** so that during project load every `addConnection` call renders its SVG path synchronously.

---

## Event Flow Diagrams

### Adding a node

```
addNode()
  ├─ snapshotState()
  └─ editor.addNode(...)
       └─ fires nodeCreated → injectOverlayToNode(nodeId)
  └─ nodesData[nodeId] = { ..., is_start: false }
  └─ slugToNodeId[slug] = nodeId
  └─ openPassageEditor(nodeId)
```

### Creating a connection (drag link)

```
startLinking(sourceId)           ← user clicks 🔗
  └─ linkingFromId = sourceId
  └─ body.classList.add('is-linking')

click on target node
  └─ handleLinkTargetClick(targetId)
       ├─ snapshotState()
       └─ editor.addConnection(sourceId, targetId, ...)
            └─ fires connectionCreated
                 ├─ ensureNodeData for both
                 ├─ create choice, push to choices[]
                 ├─ insert [Title](node:slug) into content
                 ├─ renderChoices(sourceId)
                 └─ validateDeadEnds(); validateOrphans()
       └─ cancelLinking()
```

### Loading a project

```
confirmLoad()
  ├─ undoStack = []; redoStack = []
  ├─ sync textarea content
  ├─ fetch /api/load?name=...
  ├─ isLoading = true
  ├─ editor.removeNodeId(...) for each existing node
  ├─ nodesData = {}, slugToNodeId = {}
  ├─ first pass: editor.addNode(...) each node, populate nodesData (with is_start)
  ├─ second pass: editor.addConnection(...) for each choice
  ├─ deduplicateActionIds()
  ├─ isLoading = false
  ├─ updateStartBadgeOnCanvas() for all nodes
  ├─ requestAnimationFrame → validateDeadEnds(), validateOrphans(), re-apply search
  └─ ensureSidePanelNode()
```

### Exporting

```
exportGame()
  ├─ showLoader('Exporting...')
  ├─ await saveProjectSilent()
  └─ window.location.href = /api/export/{name}
```
