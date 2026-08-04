# Frontend — Technical Reference

## Overview

The NodeFable graph canvas frontend is a set of **standard ES modules**. `app.js` is the entrypoint (loaded via `<script type="module" src="app.js"></script>`); it initializes Drawflow + CodeMirror, calls the wiring functions, and exposes window-level handlers for inline HTML attributes (`onclick`/`onchange`/`onblur`). All business logic lives in `frontend/editor/js/` modules. There is no framework.

| Module | Responsibility |
|---|---|
| `js/constants.js` | `SVG_LINK`, `SVG_EDIT`, `SVG_CLOSE` markup, `MAX_UNDO` |
| `js/state.js` | The single mutable `state` object + slug helpers (`slugify`, `generateUniqueSlug`, `getNodeSlug`, `getNodeIdBySlug`, `getNodeTitleBySlug`, `ensureNodeData`) |
| `js/ui-utils.js` | `showLoader`/`hideLoader`, `showToast`, `escapeHtml`/`escapeRegex`, `showIdError`/`hideIdError`, `validateSlugOnBlur` |
| `js/history.js` | Undo/redo snapshots (`_captureSnapshot`, `snapshotState`, `captureCurrentState`, `restoreState`, `undo`, `redo`) |
| `js/codemirror-setup.js` | `nodefable` CodeMirror mode, `nodeFableHint` autocomplete, editor bridge (`isSpellcheckActive`, `getEditorValue`, `setEditorValue`, `insertAtCursor`, `insertMarkdown`, `toggleSpellcheck`) |
| `js/validation.js` | `validateDeadEnds`, `validateOrphans`, `runValidation` |
| `js/variables-manager.js` | Variable CRUD + `renderVariables` |
| `js/asset-explorer.js` | Asset tree/grid, breadcrumbs, copy/cut/paste/rename/delete/upload, `insertImage` |
| `js/node-editor.js` | Passage editor, node CRUD, linking, choices/on_enter editors |
| `js/group-manager.js` | Groups/portals: add/edit/collapse/load/move/delete, portal I/O label + output lines, batched node/connection creation |
| `js/graph-engine.js` | `setupEditorEvents`, `injectOverlayToNode`/`_createOverlay`, `ensureSidePanelNode` |
| `js/event-delegation.js` | All `setup*()` wiring, context menu, keyboard shortcuts, modal + save/load/export/import functions, `filterNodes` |

> **Note on circular imports:** `history.js` ↔ `node-editor.js`, `history.js` ↔ `event-delegation.js`, and `node-editor.js` ↔ `group-manager.js` import each other. This is safe because the bindings are only *used at call time* (inside function bodies, after `DOMContentLoaded`), never during module evaluation. All cross-module references are exported `function` declarations, which are hoisted at module instantiation.

## Global State

> All former globals now live on the exported `state` object in `js/state.js` and are referenced with a `state.` prefix (e.g. `state.nodesData`, `state.editor`, `state.selectedNodeId`). The exceptions kept as true module-local `let`s are `selectedLoadName` and `contextMenuTargetId` in `js/event-delegation.js`. Constants `SVG_LINK`, `SVG_EDIT`, `SVG_CLOSE` moved to `js/constants.js`.

| State property | Type | Purpose |
|---|---|---|
| `state.editor` | `Drawflow` | The Drawflow canvas instance |
| `state.selectedNodeId` | `number \| null` | Currently selected node's Drawflow numeric ID |
| `state.linkingFromId` | `number \| null` | Node ID from which a link is being drawn |
| `state.nodesData` | `object` | Keyed by Drawflow numeric ID → `{title, text, choices, slug, on_enter, is_start, group}` |
| `state.slugToNodeId` | `object` | Slug → Drawflow numeric ID reverse lookup |
| `state.variables` | `object` | Keyed by variable name → `{type, value}` |
| `state.isEditingVariable` | `boolean` | True while the variable form is in edit mode |
| `state.editVariableBackup` | `object \| null` | Backup `{name, type, value}` of the variable being edited |
| `state.isLoading` | `boolean` | True during project/group load to suppress `connectionCreated` side effects and bypass RAF throttle |
| `state.currentProjectName` | `string \| null` | Name of the currently loaded/saved project |
| `state.loaderCount` | `number` | Reference counter for nested loader calls |
| `state.toastTimeout` | `number \| null` | Timeout ID for auto-dismissing toast notifications |
| `state.searchDebounceTimer` | `number \| null` | Timeout ID for search input debounce |
| `state.undoStack` | `array` | Snapshot history for undo |
| `state.redoStack` | `array` | Snapshot history for redo |
| `state.undoInProgress` | `boolean` | Prevents re-snapshotting during undo/restore |
| `state.cmEditor` | `CodeMirror` | CodeMirror 5 instance for the markdown editor (`#passage-content-editor`) |
| `state.aeCurrentPath` | `string` | Current folder path in Asset Explorer (empty = root) |
| `state.aeClipboard` | `object \| null` | `{action: "copy"\|"cut", paths: [...]}` for copy/paste operations |
| `state.aeSelectedPaths` | `Set<string>` | Set of currently selected file paths in Asset Explorer grid |
| `state.groupsManifest` | `object \| null` | Loaded project manifest with groups list |
| `state.portalNodeIds` | `object` | Group ID → Drawflow portal node ID mapping |
| `state.loadedGroupIds` | `Set` | Set of group IDs that have been loaded as full nodes |
| `state.editingPortalNodeId` | `number \| null` | Portal node ID whose group editor is open |
| `state.collapsedGroupsData` | `object` | Group ID → cached full node data (used to reload a collapsed group without a fetch) |
| `state.portalOutputSvg` | `object` | Portal node ID → array of SVG elements drawn to linked nodes |
| `state.collapsingSlugs` | `Set` | Slugs of a group being collapsed; `nodeRemoved` skips choice/link stripping for them so cross-group connections survive |

`MAX_UNDO` (50) and SVG icon constants `SVG_LINK`, `SVG_EDIT`, `SVG_CLOSE` live in `js/constants.js`.

---

## Initialization

| Variable | Type | Purpose |
|---|---|---|
| `editor` | `Drawflow` | The Drawflow canvas instance |
| `selectedNodeId` | `number \| null` | Currently selected node's Drawflow numeric ID |
| `linkingFromId` | `number \| null` | Node ID from which a link is being drawn |
| `nodesData` | `object` | Keyed by Drawflow numeric ID → `{title, text, choices, slug, on_enter, is_start, group}` |
| `slugToNodeId` | `object` | Slug → Drawflow numeric ID reverse lookup |
| `variables` | `object` | Keyed by variable name → `{type, value}` |
| `isEditingVariable` | `boolean` | True while the variable form is in edit mode |
| `editVariableBackup` | `object \| null` | Backup `{name, type, value}` of the variable being edited |
| `isLoading` | `boolean` | True during project/group load to suppress `connectionCreated` side effects and bypass RAF throttle |
| `currentProjectName` | `string \| null` | Name of the currently loaded/saved project |
| `selectedLoadName` | `string \| null` | Selected item in the load modal list |
| `loaderCount` | `number` | Reference counter for nested loader calls |
| `toastTimeout` | `number \| null` | Timeout ID for auto-dismissing toast notifications |
| `searchDebounceTimer` | `number \| null` | Timeout ID for search input debounce |
| `MAX_UNDO` | `50` | Maximum snapshots in undo stack |
| `undoStack` | `array` | Snapshot history for undo |
| `redoStack` | `array` | Snapshot history for redo |
| `undoInProgress` | `boolean` | Prevents re-snapshotting during undo/restore |
| `cmEditor` | `CodeMirror` | CodeMirror 5 instance for the markdown editor (`#passage-content-editor`) |
| `aeCurrentPath` | `string` | Current folder path in Asset Explorer (empty = root) |
| `aeClipboard` | `object \| null` | `{action: "copy"\|"cut", paths: [...]}` for copy/paste operations |
| `aeSelectedPaths` | `Set<string>` | Set of currently selected file paths in Asset Explorer grid |
| `groupsManifest` | `object \| null` | Loaded project manifest with groups list |
| `portalNodeIds` | `object` | Group ID → Drawflow portal node ID mapping |
| `loadedGroupIds` | `Set` | Set of group IDs that have been loaded as full nodes |
| `editingPortalNodeId` | `number \| null` | Portal node ID whose group editor is open |
| `collapsedGroupsData` | `object` | Group ID → cached full node data (used to reload a collapsed group without a fetch) |
| `portalOutputSvg` | `object` | Portal node ID → array of SVG elements drawn to linked nodes |
| `contextMenuTargetId` | `number \| null` | Node ID that was right-clicked |

SVG icon constants `SVG_LINK`, `SVG_EDIT`, `SVG_CLOSE` hold inline SVG markup for the overlay buttons.

---

## Initialization

### `DOMContentLoaded` handler

1. Gets `#tab-graph` container, creates `new Drawflow(container)` and calls `editor.start()`.
2. Monkey-patches `editor.updateConnectionNodes` with a last-call-wins RAF throttle (avoids layout thrashing during drag, bypassed during `isLoading`).
3. Sets `zoom_max = 2.0`, `zoom_min = 0.15`, `zoom_value = 0.05`, `curvature = 0.3`.
4. Calls `setupEditorEvents()`.
5. Registers a `mousedown` listener on the container to fix Drawflow panning when clicking a container gap.
6. Registers a `wheel` listener that calls `_repositionPortalOutputs()` after zoom (Ctrl/Cmd+wheel).
7. Calls `setupDelegation()` (which internally runs `setupTabs()`, `setupModalEvents()`, `setupEditorDelegation()`, `setupAssetDelegation()`, `setupAEToolbar()`, `setupVariableDelegation()`, `setupNodeOverlayDelegation()`, `setupButtonDelegation()`, `setupSearch()`, `setupContextMenu()`) and `setupKeyboardShortcuts()` (all in `js/event-delegation.js`).
8. Initializes CodeMirror 5 on `#passage-content-editor` with the custom `nodefable` mode (see below), `material-darker` theme, line numbers, line wrapping, bracket matching, `viewportMargin: Infinity`, and `extraKeys` (`Enter` → `newlineAndIndentContinueMarkdownList`, `Ctrl-Space` → autocomplete).
9. Wires CodeMirror + textarea auto-save listeners (see Markdown Auto-Save).
10. Registers global `keydown` listener for keyboard shortcuts (Ctrl+S, Ctrl+Z/Y, Delete/Backspace, Escape) via `setupKeyboardShortcuts()`.
11. Calls `ensureSidePanelNode()` after 100ms delay.

---

## CodeMirror: `nodefable` mode & autocomplete

### Custom mode

`CodeMirror.defineMode('nodefable', ...)` wraps the built-in `markdown` mode with an `overlayMode` that tokenizes NodeFable syntax:

| Token | Match |
|---|---|
| `keyword` | `{if:}` / `{elseif:}` / `{else}` / `{endif}`, `{set:}`, `{redirect:}`, `{textfield:}`, `{textarea:}`, `{number:}`, `{checkbox:}`, `{dropdown:}`, `{radiogroup}`, `{endradiogroup}`, `{radiobutton:}`, `{wait:...}{endwait}`, `{endwait}`, `{dialogue:}`, `{enddialogue}`, `{img:}`, `{video:}`, `{audio:}`, `{while:}` / `{endwhile}`, `{do}`, `{break}`, `{continue}`, `{for:}` / `{endfor}`, `{unset:}`, `{include:}`, `{init}` / `{endinit}` |
| `builtin` | `{random:n,m}`, `notify(`, `game.newGame(` |
| `variable-2` | `{var:state.x}` / `{var state.x}`, bare `state.varname` / `temp.varname`, array access `state.myarray[0]` / `state.myarray[state.id]` and `.size` |
| `atom` | `true` / `false` |
| `number` | numeric literals |

### Autocomplete provider

`CodeMirror.registerHelper('hint', 'nodeFableHint', ...)`. Context detection (cursor-based, inspecting the line before the cursor):

- Inside `[...](...)`: suggests `node:` / `action:` prefixes; after `node:` suggests matching slugs from `slugToNodeId`; after `action:` suggests matching action IDs scanned across all nodes.
- After `state.` / `temp.`: suggests matching variable names from `variables`.
- After `{include:`: suggests matching passage slugs from `slugToNodeId`.
- A bare `state`/`temp` / `state.`/`temp.` token: suggests `state.` and `temp.`.
- General word completion: suggests the NodeFable keyword list (`if:`, `elseif:`, `else`, `endif`, `set:`, `redirect:`, `random:`, `textfield:`, `textarea:`, `number:`, `checkbox:`, `dropdown:`, `radiogroup`, `radiobutton:`, `endradiogroup`, `var:`, `wait:`, `endwait`, `dialogue:`, `enddialogue`, `img:`, `video:`, `audio:`, `while:`, `endwhile`, `do`, `break`, `continue`, `for:`, `endfor`, `unset:`, `include:`, `init`, `endinit`, `true`, `false`, `notify(`, `game.newGame()`).

`inputRead` triggers autocomplete automatically after typing `.` or `:`. `hintOptions.completeSingle = false`.

---

## Drawflow Event Wiring

### `setupEditorEvents()`

Finds the `.drawflow` DOM element, then registers all Drawflow and DOM event listeners. If `.drawflow` is not found, logs an error and returns early (no events are wired).

Then iterates `document.querySelectorAll('.drawflow-node')` to inject overlays (deferred) and collapse buttons into any nodes that already exist.

#### Drawflow events

| Event | Handler | Behaviour |
|---|---|---|
| `nodeSelected` | `openPassageEditor(nodeId)` | Opens the passage editor for the clicked node (skipped while `linkingFromId !== null`). |
| `nodeUnselected` | `closePassageEditor()` | Hides the passage editor. |
| `nodeCreated` | `injectOverlayToNode(nodeId, true)` | Defers overlay injection until first hover. |
| `nodeMoved` + container `mousemove` | Live portal-line reposition | Drawflow dispatches `nodeMoved` only on drag end, so `setupEditorEvents` also listens for `mousemove` on `state.editor.container` (registered after Drawflow's own handler so node positions are already updated) and, when `state.editor.drag` is set, RAF-throttled (last-call-wins) `_repositionPortalOutputs()` re-glues portal SVG lines to their endpoints during the drag. |

| `nodeRemoved` | Cleanup + choice cleanup | Deletes the node from `nodesData` and `slugToNodeId`. Unless the slug is in `collapsingSlugs` (a group collapse in progress), removes orphaned choice references from all other nodes and strips their `[text](node:slug)` markdown links. Runs `validateDeadEnds()`, `validateOrphans()`, and `_refreshPortalOutputs()`. Calls `closePassageEditor()` if the removed node was selected. |
| `connectionCreated` | Choice creation | **Skips during `isLoading`.** Portal-target case: maps the input port index to a portal slug, pushes a `{targetSlug, text, prerequisite, mutation}` choice and inserts the markdown link. Portal-source case: blocked with an alert and the connection is removed. Normal case: pushes a `{targetSlug, text, prerequisite, mutation, connectionId}` choice, inserts `[Title](node:slug)` at cursor or appends, re-renders choices, runs validation, refreshes portal outputs. |
| `connectionRemoved` | Choice cleanup + snapshot | Takes undo snapshot. Portal-target case: removes the choice whose slug matches the port index. Normal case: removes the matching choice by `targetSlug` and strips the markdown link from text — **unless** the target slug is in `collapsingSlugs` (a group collapse in progress), in which case the choice + markdown are preserved so the portal's inbound lines still render and nothing is lost on save. Re-renders choices, runs validation, refreshes portal outputs. |

#### DOM events on `.drawflow`

| Event | Behaviour |
|---|---|
| `mousedown` (capture phase) | If click lands on `.drawflow-node`, exits pan mode before Drawflow's handler fires. |
| `click` | Ignores `.node-overlay` clicks. Closes passage editor if click is on empty canvas. Handles linking-mode target clicks (`handleLinkTargetClick`). |
| `dblclick` | Opens passage editor and switches to Markdown Editor tab. |

---

## Tab Management

### `setupTabs()`

Binds `click` handlers to each `.tab-btn`. On click: removes `active` from all, adds to clicked button, shows corresponding `#tab-{name}`. Refreshes CodeMirror when switching to the markdown tab and `refreshAssets()` when switching to the asset-explorer tab.

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

Ensures `nodesData[nodeId]` exists with all required fields (`title`, `text`, `choices`, `slug`, `is_start`, `on_enter`, `group`). Fills in missing fields with defaults (`group` defaults to `'side_panel'`). Slug is generated once and persisted.

### `addNode()`

1. Takes an undo snapshot.
2. Generates random position (50–450 × 50–350).
3. Calls `editor.addNode('story_node', 1, 1, posX, posY, 'story_node', {}, 'New Node')`.
4. Creates `nodesData[nodeId]` with `{title, text, choices, slug, is_start: false, group: ''}` and a unique slug.
5. Calls `_setupNodeCollapseButton(nodeId)`.
6. Opens the passage editor for the new node.

### `addGroup()`

Creates a unique group ID (`chapter_N`), pushes a group entry into `groupsManifest`, and creates a `portal_node` on the canvas with metadata (`isPortal: true`, `portalGroupId`, `portalGroupLabel`, `portalNodeCount: 0`, `portalSlugIds: []`). Applies portal styling, labels I/O, sets up portal action buttons, and renders portal outputs.

### `ensureSidePanelNode()`

Creates a node with slug `side_panel` (including `is_start: false`) if it does not already exist. Called after init and after every project load.

### `injectOverlayToNode(nodeId, deferred)`

Finds the `.drawflow-node` DOM element by `[data-id="{nodeId}"]`. If no `.node-overlay` exists, either creates it immediately or (when `deferred` is true) attaches a `mouseenter` listener that creates it on first hover. `_createOverlay` builds the Edit ✎ / Delete ✖ / Link 🔗 button row — the Link button is omitted for portal nodes (outbound portal connections are read-only).

### `updateStartBadgeOnCanvas(nodeId)`

Adds or removes a green "START" badge on the node's Drawflow element based on `nodesData[nodeId].is_start`.

### `toggleUtilityNode(checked)`

Called from the `#passage-is-utility` checkbox `onchange`. Sets `nodesData[selectedNodeId].is_utility = checked` (no exclusivity — multiple utility nodes allowed) and calls `updateUtilityBadgeOnCanvas(selectedNodeId)`.

### `updateUtilityBadgeOnCanvas(nodeId)`

Adds or removes a grey "utility" left border (`node-utility` class) on the node's Drawflow element based on `nodesData[nodeId].is_utility`. Called on selection (`openPassageEditor`), save (`updateCurrentNode` / `saveCurrentContent`), toggle, creation, import, and load.

### `editNode(nodeId)`

Calls `openPassageEditor(parseInt(nodeId))`. Wired to overlay's Edit button.

### `deleteNodeOverlay(nodeId)`

Takes undo snapshot. Prompts for confirmation, calls `editor.removeNodeId(...)`, cleans up `nodesData` and `slugToNodeId`, closes passage editor.

### `deleteCurrentNode()`

Same as `deleteNodeOverlay` but operates on `selectedNodeId`. Protected by confirmation. Wired to Delete/Backspace key.

---

## Linking Mode

### `startLinking(nodeId)`

Sets `linkingFromId = parseInt(nodeId)`, adds `is-linking` class to `<body>`. Wired to overlay's Link button.

### `cancelLinking()`

Clears `linkingFromId`, removes `is-linking` class.

### `handleLinkTargetClick(targetId, inputName)`

Self-link cancels. If the target is a portal: with a specific `input_N` port it takes an undo snapshot and connects (mapped to a portal slug by `connectionCreated`); otherwise alerts "Cannot link to a portal group". Normal case: takes undo snapshot, calls `editor.addConnection(...)`, then cancels linking mode.

---

## Passage Editor

### `openPassageEditor(nodeId, skipDirtyCheck)`

1. If `!skipDirtyCheck` and switching nodes, auto-saves the previous node's content via `saveCurrentContent()`.
2. Sets `selectedNodeId = parseInt(nodeId)` (normalized to number), calls `ensureNodeData`.
3. If the node is a portal (`data.isPortal`), hides the passage editor and opens the group editor instead.
4. Otherwise shows `#passage-editor`, populates title, content, slug, and error state.
5. Shows/hides `#passage-is-start` and `#passage-is-utility` checkboxes (both hidden for `side_panel`), sets their state from `data.is_start` / `data.is_utility`.
6. Calls `populateGroupDropdown()`, `renderChoices`, `renderOnEnter`, `updateStartBadgeOnCanvas`, `updateUtilityBadgeOnCanvas`.

### `closePassageEditor()`

Sets `selectedNodeId = null` and `editingPortalNodeId = null`, hides `#passage-editor` and `#group-editor`, shows `#no-selection-msg`.

---

## Group Editor

### `openGroupEditor(nodeId)`

For a portal node, shows `#group-editor`, populates the group ID and label fields, wires blur/save handlers to `saveGroupEditor()`, and calls `renderGroupNodeList(groupId)`.

### `saveGroupEditor()`

Validates a non-empty group ID. Updates the portal node data (`portalGroupId`, `portalGroupLabel`, title) and the canvas label. Updates `groupsManifest` (label; migrates the entry's `id` if renamed). Migrates `portalNodeIds` and `collapsedGroupsData` keys on rename. Re-renders the node list and shows a toast.

### `renderGroupNodeList(groupId)`

Lists the group's members from the manifest's `groups[].slug_ids` (the canonical, synced membership). For each member slug, resolves the display via the loaded canvas node (title + `#drawflowId`), the collapse cache (`collapsedGroupsData` title), or falls back to the slug itself for on-disk-only nodes. If the group isn't in the manifest yet, falls back to scanning loaded canvas nodes.

### `populateGroupDropdown()`

Populates `#passage-group` from `groupsManifest`, preserving the current node's group selection.

### `changeNodeGroup(newGroup)` (async)

Updates `nodesData[selectedNodeId].group`, then syncs the manifest membership via `_syncGroupMembership(slug, oldGroup, newGroup)` (adds the slug to the new group's `slug_ids`, removes it from the old group's). Enforces the "portal only when a group is unloaded" invariant: if the target group currently has a portal stub on canvas (`state.portalNodeIds[newGroup]`), the group is now loaded, so it either runs `loadGroupFromPortal()` (when the group has cached/on-disk data — bringing all its nodes in) or calls `_removePortalNode()` (fresh empty group — just drops the stub).

### `_syncGroupMembership(slug, oldGroup, newGroup)`

Mutates `state.groupsManifest.groups` so `slug_ids` stays in sync with live assignments: removes `slug` from `oldGroup` (if different) and appends `{slug_id: slug, connections: []}` to `newGroup`. Tolerates legacy flat-string `slug_ids` entries.

### `removeNodeFromGroups(slug, group)`

Removes a deleted node's slug from its group's `slug_ids`. Called by `deleteCurrentNode()` / `deleteNodeOverlay()`.

### `_removePortalNode(portalNodeId)`

Removes a portal stub from canvas and state: cleans its SVG lines in `state.portalOutputSvg`, calls `editor.removeNodeId()`, deletes `nodesData`/`portalNodeIds` entries, then re-renders the output lines of all remaining portals. Also used by `loadGroupFromPortal()`.

### `_getGroupNodeIds(groupId)`

Derived helper: scans `state.nodesData` for non-portal nodes whose `group` matches and returns their Drawflow node IDs. Replaces the removed `state.groupNodeIds` index; used by `collapseGroup()` and the node-count label in `saveGroupEditor()`.

---

## Slug Validation

### `showIdError(msg)`, `hideIdError()`, `validateSlugOnBlur()`

Validates slug uniqueness and non-emptiness on blur. Shows/hides error indicator. Called by the `passage-id` blur handler.

---

## Choice Rendering

### `renderChoices(nodeId)`

Renders `#choices-list`. For each choice: target title, extracted link text, Remove button, Prerequisite and Mutation inputs (`choice-prereq-{index}`, `choice-mutation-{index}`).

---

## Inline Action Blocks

Action blocks are a runtime walker directive (`{action: text, condition, behavior}...{endaction}`) — there is no editor-side Actions panel or structured data model. See the Runtime section below for `applyActionBlock` and the walker branch. The editor contains no action UI.

---

## On-Enter Auto-Redirect

### `renderOnEnter(nodeId)`, `toggleOnEnter(nodeId, enabled)`, `updateOnEnterField(nodeId)`

Checkbox to enable/disable auto-redirect. When enabled: target dropdown (`onenter-target`), condition input, mutation input. `toggleOnEnter` sets `nodesData[nodeId].on_enter = {target_node_id, condition, mutation}` or `null`. `updateOnEnterField` syncs the three fields from the DOM on change.

Text-based `{redirect:slug}` patterns (in node text) are also respected by validation: `validateDeadEnds()` treats a node with a text redirect as not a dead end, and `validateOrphans()` follows redirect targets during BFS.

---

## Editor Mode Helpers

### `isSpellcheckActive()`

True when the native textarea (`#passage-content-native`) is visible (spellcheck mode on).

### `getEditorValue()` / `setEditorValue(val)`

Read/write the active editor — the native textarea in spellcheck mode, otherwise CodeMirror. Both are kept in sync.

### `insertAtCursor(text)`

Inserts text at the current cursor/selection in whichever editor is active.

### `toggleSpellcheck()`

Toggles between CodeMirror and the native textarea (enabling browser spellcheck), keeping both contents in sync.

---

## Content Editing (Markdown Toolbar)

### `insertMarkdown(before, after)`

Wraps selected text with formatting markers, respecting the active editor (spellcheck textarea or CodeMirror).

### `insertImage()`

Requires `currentProjectName`. Uploads a file to `POST /api/assets/{name}/upload`, inserts `{img: <url>, alt=<name>}` at cursor, calls `refreshAssets()` (see `docs/guide.md`).

---

## Save Data

### `saveCurrentContent(nodeId)`

Lightweight content sync: reads title, content, and slug from DOM and writes to `nodesData[nodeId]` (also re-keys `slugToNodeId` if the slug changed). Used for auto-save on node switch, title blur, and slug blur.

### `updateCurrentNode()`

Takes undo snapshot. Reads title, slug, content from DOM. Syncs `is_start` from checkbox (enforces single-start — unchecks all others). Updates slug references across all nodes (`choices[].targetSlug`, `on_enter.target_node_id`). Syncs group from dropdown and choice prerequisites/mutations from the DOM. Updates the Drawflow node label. Re-renders choices and on-enter.

---

## Variable Management

### `showVariableForm()`, `hideVariableForm()`, `addVariable()`, `editVariable()`, `deleteVariable()`, `renderVariables()`

Full CRUD for global variables with type-specific parsing (int, float, bool, string).

- `editVariable(name)` — called when clicking a variable in the list. Saves a backup (`editVariableBackup`), deletes the variable, pre-fills the form, changes submit button to "Save Changes". If another edit was in progress, restores the prior backup first.
- `hideVariableForm()` — hides the form and clears fields. If called during an edit, restores the variable from backup and refreshes the list.
- `addVariable()` — validates and parses values, clears `editVariableBackup` (so `hideVariableForm` doesn't re-restore), stores the variable, hides the form, re-renders.

---

## Asset Management

### `refreshAssets()`

Async. Fetches `GET /api/assets/{name}` (returns tree). Calls `renderAssetTree()` for left panel. If Asset Explorer tab is active, also calls `renderAssetExplorer()`. Hides `#asset-section` if no assets.

### `renderAssetTree(nodes, container, parentPath)`

Recursively renders tree view into `#asset-tree`. Folders show a toggle (▶) and 📁 icon. Files show thumbnail, syntax string, and delete button. Folder rows have inline "new folder" and "upload" buttons. The per-file syntax string comes from `assetSyntax(url, name)` — a `{img: url, alt=…}` directive for images and `{video: url}` for `mp4`/`webm`/`ogg`/`mov` files.

### `assetSyntax(url, name)`

Returns the copyable directive for a file: `{img: <url>, alt=<name>}` (alt = name minus extension, non-alphanumeric chars → `_`) for images, `{video: <url>}` for video files (`VIDEO_EXTS`), or `null` for other files (no syntax shown).

### `renderAssetTreeChildren(nodes, parentPath)`

Recursive helper that returns HTML string for child nodes (used inside expandable containers).

### `getEntriesAtPath(tree, path)`

Walks the tree array following `path.split('/')` to find folder children. Returns `[]` on missing folder.

### `renderAssetExplorer(tree)`

Entry point for Asset Explorer tab rendering. Calls `renderBreadcrumb()` and `renderAEGrid()`.

### `renderBreadcrumb(path)`

Renders clickable breadcrumb segments from `aeCurrentPath`. Each segment navigates via `aeNavigate()`.

### `renderAEGrid(entries)`

Renders grid view in `#ae-file-grid`. Folders show 📁 icon. Image files show thumbnail; other files show 📄. Displays file size. Clicking a folder navigates into it. Selection state from `aeSelectedPaths`.

### `updateAEToolbar()`

Enables/disables Rename (only when exactly 1 selected), Delete/Copy/Cut (when ≥1 selected), Paste (when clipboard has items).

### `aeNavigate(path)`

Sets `aeCurrentPath`, clears selection, calls `refreshAssets()`.

### `aeNewFolder(targetPath)`

Prompts for name, sends `POST /api/assets/{name}/folder`, refreshes.

### `aeUpload(targetPath)`

Opens file picker (multi-file), uploads each to `POST /api/assets/{name}/upload` with folder param, refreshes.

### `aeDelete(singlePath)`

Iterates all paths in `aeSelectedPaths` (or the single path), sends `DELETE` for each. Shows combined toast with total deleted count. Clears selection.

### `aeRename()`

Operates on the single selected path (no-op if 0 or >1 selected). Prompts for new name, sends `PUT /api/assets/{name}/rename`, refreshes.

### `aeCopy()` / `aeCut()`

Store all selected paths as `aeClipboard = {action: "copy"|"cut", paths: [...]}`.

### `aePaste()`

Iterates all clipboard paths, copies or moves each to `aeCurrentPath`. Clears clipboard after cut. Shows combined toast.

### Grid interaction (delegation, in `setupAssetDelegation`)

- **Click on empty area** — clears all selections
- **Ctrl+Click / Meta+Click on file or folder** — toggles selection (multi-select)
- **Click on file (no modifier)** — clears previous, selects only that item
- **Click on folder (no modifier)** — navigates into it (clears selection)
- Breadcrumb clicks navigate; tree toggles/copy/delete/new-folder/upload handled via delegation.

---

## Validation

### `validateDeadEnds()`

Scans all non-`side_panel` nodes. If a node has zero outgoing choices AND no `on_enter` redirect AND no text-based `{redirect:slug}` pattern, adds `node-dead-end` class (red border). Otherwise removes it. Utility nodes (`is_utility: true`) are exempt — same guard as `side_panel`.

### `validateOrphans()`

Runs BFS from the start node across choice targets, `on_enter` targets, and text-based `{redirect:slug}` targets (parsed from all nodes' text). If no `is_start` node exists, falls back to the first non-`side_panel` slug. Nodes not visited (excluding `side_panel` and utility nodes `is_utility: true`) get `node-orphan` class (dashed orange border + dimmed). The start-node fallback is unaffected by `is_utility`.

### `runValidation()`

Runs both checks and shows an `alert()` summary: count of dead-end and orphan nodes.

**Triggered on:** project load, connection created/removed, node removed. Also available via Validate toolbar button.

---

## Modal System

### `closeModal()`, `openModal(type)`, `formatMtime(ts)`, `fetchSaves()`

Standard modal lifecycle. `fetchSaves()` calls `GET /api/saves`.

### `renderSaveList(saves)`, `renderLoadList(saves)`

Render the save/load lists using `escapeHtml()` and `data-name` attributes. No inline onclick — uses event delegation.

### `setupModalEvents()`

Registers delegation click listeners on `#save-list` and `#load-list`. Reads `item.dataset.name`, highlights the selected item, sets `selectedLoadName` (load) or fills `#save-name-input` (save).

### `showSaveModal()`, `showLoadModal()`

Async. Fetch saves, render list, open modal.

### `confirmSave()`

Async. Syncs textarea content. Reads project name. Builds the payload via `_buildSavePayload(name)` and POSTs to `/api/save`. Shows loader, then toast on success. Sets `currentProjectName`.

### `confirmLoad()`

Async. Clears undo/redo stacks. Fetches the manifest (`GET /api/load/manifest?name=...`), restores variables, fetches only the `side_panel` group (`GET /api/load?name=...&groups=side_panel`), clears the canvas, creates side_panel nodes and their connections, then calls `createPortalNode()` for every other group. Runs `_refreshPortalOutputs()`, updates start badges, validation, and re-applies search filter. Shows loader and toast. See Event Flow Diagrams.

### `_buildSavePayload(name)`

Serializes loaded nodes (choices → `target_node_id`, on_enter, `is_start`, `group`), variables, cached collapsed-group data (from `collapsedGroupsData`), and the groups manifest.

---

## Import

### `showImportModal()`, `importNode()`

The Import modal pastes a single node as JSON. `importNode()` validates that input is a JSON object with non-empty `id` and `title`. A node with `id === 'side_panel'` replaces the existing side panel node; otherwise a unique slug is generated. Choices and `on_enter` are normalized, `is_start` enforced single-start, and the node is added to the canvas. Runs `runValidation()`.

---

## Export & Preview

### `exportGame()`

Async. Requires `currentProjectName`. **Auto-saves** via `saveProjectSilent()` before redirecting to `/api/export/{name}`. Shows loader.

### `previewGame()`

Async. Requires `currentProjectName`. Auto-saves via `saveProjectSilent()`, then fetches `GET /api/preview/{name}`. Opens preview URL in new tab. Shows loader.

### `saveProjectSilent()`

Async. Syncs textarea content to `nodesData`. Serializes via `_buildSavePayload(currentProjectName)` and POSTs to `/api/save`. Throws on failure.

---

## Undo/Redo System

### Global state

`MAX_UNDO = 50`, `undoStack`, `redoStack`, `undoInProgress`.

### `_captureSnapshot()`

Deep-clones `nodesData`, copies `slugToNodeId`, and reads all Drawflow connections + node positions (`_posX`, `_posY` from the Drawflow data).

### `snapshotState()`

Skips while `undoInProgress` or `isLoading`. Pushes the snapshot to `undoStack`, caps at 50, clears `redoStack`.

### `captureCurrentState()`

Same as `snapshotState()` but returns the snapshot instead of pushing to a stack.

### `restoreState(snap)`

Clears canvas, rebuilds all nodes via `editor.addNode()` with an `oldToNewId` mapping, restores connections using the new IDs, and restores `slugToNodeId` with remapped IDs. In a RAF: refreshes connection paths, runs validation, re-applies start/side-panel classes, and re-applies the search filter.

### `undo()` / `redo()`

Pop from respective stack, push current state to the other stack, call `restoreState()`. Show toast feedback.

**Snapshot trigger points:** `addNode()`, `deleteNodeOverlay()`, `deleteCurrentNode()`, `handleLinkTargetClick()`, `connectionRemoved`, `updateCurrentNode()`, `collapseGroup()`.

---

## Keyboard Shortcuts

Registered in the global `keydown` handler:

| Key | Action |
|---|---|
| `Ctrl+S` | Save. If project named, silent-save + toast. If unnamed, open save modal. Skips when typing in an input. |
| `Ctrl+Z` | Undo (skipped when an input/textarea is focused so native undo applies) |
| `Ctrl+Shift+Z` / `Ctrl+Y` | Redo |
| `Delete` / `Backspace` | Delete selected node (only when not in input) |
| `Escape` | Cancel linking → clear search → close modal → deselect node |

Uses `e.code` for letter keys, `e.key` for non-letter keys. Checks `e.metaKey` for Mac compatibility.

---

## Node Search / Filter

### `filterNodes(query)`

Iterates all nodes. If query matches node title or slug (case-insensitive), adds `node-search-match` class (blue glow). Non-matching nodes get `node-search-mismatch` class (opacity 0.15, pointer-events: none). Empty query clears all classes. Returns match count.

### `setupSearch()`

Registered in `DOMContentLoaded`. Attaches `input` event with 150ms debounce. Escape key clears the search and blurs the input.

Re-applied after project load and after undo/restore.

---

## Loading Indicators

### `showLoader(msg)`

Reference-counted. Displays a modal overlay with spinner and message text.

### `hideLoader()`

Decrements counter. Hides overlay when count reaches 0.

### `showToast(msg)`

Creates a fixed bottom-center toast element that auto-dismisses after 2 seconds with fade-out.

**Used in:** `confirmSave()`, `confirmLoad()`, `previewGame()`, `exportGame()`, `saveGroupEditor()`, `changeNodeGroup()`, `aeDelete()` / `aeRename()` / `aePaste()` / `aeNewFolder()`, group load/collapse/delete, undo/redo.

---

## Start Node Marker

### `is_start` field

Each node in `nodesData` has `is_start: bool`. The `#passage-is-start` checkbox in the passage editor toggles this via `toggleStartNode()` (called from `onchange`). When checked, all other nodes are unchecked (single-start enforcement). The `side_panel` node hides the checkbox.

Each node also has `is_utility: bool`. The `#passage-is-utility` checkbox toggles it via `toggleUtilityNode()` (called from `onchange`). Unlike `is_start` there is **no exclusivity** — any number of nodes may be utility. The `side_panel` node hides this checkbox too (it has its own special-casing and cannot be flagged utility). `is_utility` is a validation/editor concern only: the flag exempts the node from `validateDeadEnds()` and `validateOrphans()` (mirroring the `side_panel` guard) and adds a grey `node-utility` border on canvas, but the node **stays in the exported game** — the runtime `{include:}` splice needs its text.

**Bug fix (Jul 2026):** Drawflow passes `nodeId` as a string in events. The `parseInt(nid) !== selectedNodeId` comparison in both `toggleStartNode()` and `updateCurrentNode()` therefore failed intermittently (`4 !== "4"`), causing the loop to clear the current node's own `is_start`. Fixed by normalizing `selectedNodeId = parseInt(nodeId)` in `openPassageEditor()`. Note: `selectedNodeId` can go stale when switching nodes — always read from the event argument, not `selectedNodeId`, for checks that must reference a specific node from an event context.

`updateStartBadgeOnCanvas()` adds/removes a green "START" badge on the Drawflow node element. `updateUtilityBadgeOnCanvas()` toggles the grey `node-utility` border.

Serialized in `_buildSavePayload()` (used by both `confirmSave()` and `saveProjectSilent()`). Loaded in `confirmLoad()`.

---

## Markdown Auto-Save

- CodeMirror `change` listener syncs text to `nodesData[selectedNodeId].text` and the native textarea.
- Native textarea `input` listener syncs back to `nodesData` in spellcheck mode.
- `openPassageEditor()` with dirty-check calls `saveCurrentContent()` on the previous node before switching.
- Title and slug blur handlers auto-save.
- `saveProjectSilent()` and `confirmSave()` sync editor content at the top via `getEditorValue()`.

---

## Group System & Portals

### Portal nodes

Portal nodes (`.node-portal`) represent unloaded groups on the canvas. They have dashed borders, dimmed appearance, and per-slug I/O circles labeled with the group's slug ids. Selecting a portal opens the group editor (right sidebar) showing group name/label fields and a list of nodes in the group.

`portalOutputSvg` holds synthetic SVG curves drawn from a portal's outputs (rendered/refreshed by `_renderPortalOutputs` / `_refreshPortalOutputs` / `_positionPortalOutputLine`). Two kinds of directed lines are drawn, one per slug row:

- **Inbound** — a loaded node whose `choices` target a slug in the portal's group: line from the loaded node's `output_1` to the portal's `input_{i+1}` (directed node → portal).
- **Outbound** — the portal's own `portalSlugIds[i].connections` (from the manifest): lines from `output_{i+1}` to the resolved targets. A target resolves to a loaded passage node via `slugToNodeId`, or to another collapsed portal's `input_{M+1}` circle (`_resolvePortalTargetEl`). Intra-group targets are skipped. Outbound portal connections are **read-only** — the `connectionCreated` handler still blocks portal-source links.

All portals are refreshed (`_refreshPortalOutputs`) on zoom, after connection changes, and after expand/collapse/delete so lines re-point to whichever nodes/portals are currently on the canvas. Each line stores its endpoints on `svg._portalRefs`; the `nodeMoved` event (registered in `setupEditorEvents`) and the Ctrl/Cmd+wheel zoom handler call `_repositionPortalOutputs()`, which re-positions existing lines via their stored refs (no DOM churn). Positioning math mirrors Drawflow's `updateConnectionNodes`: screen-space `getBoundingClientRect()` offsets are scaled by `1/zoom` into the precanvas's untransformed coordinate space, so lines stay glued at any zoom/pan.

### Group actions

| Function | Purpose |
|---|---|
| `addGroup()` | Creates a new group (`chapter_N`) + portal node, adds to `groupsManifest` |
| `createPortalNode(group, x, y)` | Creates a Drawflow portal node with metadata, labels I/O, portal action buttons, renders outputs |
| `openGroupEditor(nodeId)` / `saveGroupEditor()` / `renderGroupNodeList(groupId)` | Group editor panel for a portal node (id, label, node list) |
| `populateGroupDropdown()` / `changeNodeGroup(newGroup)` | Assign a node to a group via the passage editor dropdown; syncs the manifest `slug_ids` via `_syncGroupMembership()`; if the group has a portal stub it is removed (fully loaded via `loadGroupFromPortal()` when the group has cached/on-disk data, else dropped via `_removePortalNode()`) |
| `_removePortalNode(portalNodeId)` | Removes a portal stub from canvas/state (SVG lines, `removeNodeId`, `nodesData`, `portalNodeIds`), refreshes remaining portals |
| `_getGroupNodeIds(groupId)` | Derived group membership from `state.nodesData` (replaces the old `groupNodeIds` index) |
| `_syncGroupMembership(slug, oldGroup, newGroup)` | Syncs the manifest `slug_ids` on assign/unassign (removes from old group, appends to new) |
| `removeNodeFromGroups(slug, group)` | Removes a deleted node's slug from its group's `slug_ids` |
| `loadGroupFromPortal(nodeId)` | Loads a group's full nodes (or cached `collapsedGroupsData`), replaces the portal |
| `moveToGroupFromPortal(nodeId)` | Unloads all groups except the target, loads the selected group, recreates other portal stubs |
| `deleteGroupFromPortal(nodeId)` | Removes portal + updates manifest (and clears cached collapsed data) |
| `collapseGroup(groupId)` | Caches the group's full node data, marks its slugs in `collapsingSlugs`, removes its nodes, creates a portal stub at the centroid, clears `collapsingSlugs`, refreshes all portals |
| `_setupPortalActions(nodeId)` | Adds Load / Move / Delete buttons to a portal node |
| `_setupNodeCollapseButton(nodeId)` | Adds a collapse (⬆) button to loaded nodes that belong to a group |
| `_labelPortalIO(nodeId, slugIds)` | Labels portal I/O circles with slug ids, aligns content rows |
| `_renderPortalOutputs(portalNodeId)` | Draws inbound + outbound synthetic SVG connection lines for one portal |
| `_refreshPortalOutputs()` | Re-renders portal output lines for every portal with SVG entries |
| `_resolvePortalTargetEl(targetSlug, currentPortalId)` | Resolves an outbound target slug → loaded passage node's `input_1` circle (falls back to the node element) or another collapsed portal's `input_{M+1}` circle |
| `_drawPortalOutputLine(portalNodeId, outputEl, targetEl)` | Creates a synthetic SVG line from a portal output to a target element |
| `_positionPortalOutputLine(...)` | Positions a portal SVG line (RAF-wrapped, uses `_positionPortalOutputLineSync`) |
| `_positionPortalOutputLineSync(...)` | Positions a portal SVG line synchronously; scales rect offsets by `1/zoom` (Drawflow-compatible) |
| `_repositionPortalOutputs()` | Re-positions all existing portal SVG lines from their stored `svg._portalRefs` (used on node drag + zoom) |

### Context menu

`setupContextMenu()` shows `#context-menu` on right-click inside `#tab-graph`:

- **Portal node:** Load Group, Move to Group, Delete Group.
- **Normal node** (not `side_panel`): Collapse Group, Delete Node.

`hideContextMenu()` hides the menu; clicks outside or Escape close it. `contextMenuTargetId` stores the right-clicked node.

### Collapse / expand lifecycle

```
collapseGroup(groupId)
  ├─ snapshotState()
  ├─ nodes = _getGroupNodeIds(groupId)        ← derived from nodesData
  ├─ collect node data + positions (nodesData + drawflow pos)
  ├─ collapsedGroupsData[groupId] = nodeData
  ├─ add group slugs to collapsingSlugs   ← nodeRemoved skips stripping these
  ├─ editor.removeNodeId() for each node; clear nodesData/slugToNodeId/loadedGroupIds
  ├─ createPortalNode({id, label, node_count, slug_ids}, centerX, centerY)
  ├─ collapsingSlugs.clear()
  └─ _refreshPortalOutputs()   ← new portal + all others redraw

loadGroupFromPortal(portalNodeId)
  ├─ nodes = collapsedGroupsData[groupId]     ← cache consumed BEFORE the
  │           (no project name needed)          currentProjectName fetch guard
  ├─ nodes ?? fetch /api/load?groups=groupId
  ├─ _removePortalNode(portalNodeId)          ← portal node + portalOutputSvg
  │                                            lines removed; other portals refresh
  ├─ createNodesBatched(nodes, batchSize)   ← RAF-chunked node creation
  │   └─ choices populated directly from node.choices (intra-group, cross-group
  │      to collapsed portals, and dangling targets all preserved — no data
  │      loss on expand→save; also feeds portal inbound line rendering).
  │      Reads `target_node_id ?? targetSlug` so both fetched group files and
  │      the collapse cache (which stores frontend `targetSlug` format) work.
  ├─ collect connections (intra-group + cross-group via slugToNodeId)
  ├─ isLoading = true
  ├─ createConnectionsBatched(connections)   ← RAF-chunked, suppresses connectionCreated
  ├─ isLoading = false
  ├─ loadedGroupIds.add(groupId)
  ├─ updateConnectionNodes + updateStartBadgeOnCanvas for all
  ├─ _refreshPortalOutputs()   ← other portals re-point to real nodes
  └─ validateDeadEnds(); validateOrphans()
```

### Chunked rendering

```
createNodesBatched(nodes, onNodeCreated, batchSize=50)
  ─ Returns Promise<slugToDrawflowId>
  ─ Adds nodes in batches via requestAnimationFrame
  ─ Used by loadGroupFromPortal for large group loads

createConnectionsBatched(connections, onConnectionCreated, batchSize=100)
  ─ Returns Promise
  ─ Adds connections in RAF batches, updating the loader text
  ─ Run under isLoading=true so connectionCreated side effects are suppressed
```

### Deferred overlay injection

`injectOverlayToNode(nodeId, deferred=true)` — when `deferred` is true, the overlay (Edit/Delete/Link buttons) is only injected on first mouseenter, not at node creation time. Reduces DOM work during large project loads.

---

## Event Flow Diagrams

### Adding a node

```
addNode()
  ├─ snapshotState()
  └─ editor.addNode(...)
       └─ fires nodeCreated → injectOverlayToNode(nodeId, true)
  └─ nodesData[nodeId] = { ..., is_start: false, group: '' }
  └─ slugToNodeId[slug] = nodeId
  └─ _setupNodeCollapseButton(nodeId)
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
                 ├─ (portal target) map port → slug, push choice, insert link
                 ├─ (portal source) alert + remove connection
                 ├─ create choice, push to choices[]
                 ├─ insert [Title](node:slug) into content
                 ├─ renderChoices(sourceId)
                 └─ validateDeadEnds(); validateOrphans(); _refreshPortalOutputs()
       └─ cancelLinking()
```

### Loading a project (group-aware flow)

```
confirmLoad()
  ├─ undoStack = []; redoStack = []
  ├─ fetch /api/load/manifest?name=...        ← manifest only (lightweight)
  ├─ restore variables from manifest
  ├─ fetch /api/load?name=...&groups=side_panel  ← only side_panel nodes
  ├─ editor.removeNodeId(...) for each existing node
  ├─ nodesData = {}, slugToNodeId = {}, groupsManifest = manifest
  ├─ first pass: editor.addNode(...) side_panel nodes
  ├─ second pass: editor.addConnection(...) for side_panel choices
  ├─ loadedGroupIds.add('side_panel')
  ├─ createPortalNode(group) for every other group  ← portals on canvas
  ├─ _refreshPortalOutputs()
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

---

## Runtime Engine (`template.html`)

The exported game is `template.html` (one page, the full runtime). It does **no live evaluation in the editor** — all directives run only when the exported game renders.

### Rendering pipeline

```
render(nodeId)
  ├─ resolve() → node text (choices/on_enter merged)
  ├─ if text contains {redirect:} → run processDirectives(), fire redirect, re-enter render()
  └─ else
       ├─ _preprocessText(text)
       │    ├─ processDirectives(text)   ← directives: {set:} {var:} {if:} {while:} {do} {break} {continue} {for:} {unset:} {init} {include:} {action:}
       │    └─ strip remaining {redirect:} directives
       └─ renderContent(text)
            ├─ {random:} resolved
            ├─ HTML-escape (links/images/bold/italic/headings rendered)
            ├─ {wait:}/{dialogue:} blocks → animated containers
            ├─ {var:} placeholder tokens (\u0000nfvar_<n>\u0000) → captured values
            └─ choice links (prerequisites evaluated → class="disabled", indices into the merged list)
```

### Directive walker

`processDirectives(text)` is a single recursive-descent pass that resolves directives **in textual order** (a behavior change from the old pipeline, where all `{if:}` blocks were resolved before any `{set:}` ran). Each pass over a loop body re-evaluates every directive against current `state` and `temp`.

Helpers (all on the runtime `Game`/engine object):

| Helper | Role |
|---|---|
| `processDirectives(text)` | Public entry point; dispatches on each directive. |
| `_processDirectives(text, inLoop)` | Recursive body handler; returns `{ text, signal }` where `signal` is `'break'`, `'continue'`, or `null`. Out-of-loop `{break}`/`{continue}` render as literal text. |
| `_selectIfBranch(condText)` | Evaluates one `{if:}`/`{elseif:}` condition; returns `{ result, remaining }` — the condition truthiness and the text after that tag. |
| `_parseIfBranches(condText, body, elseText, rest, inLoop)` | Splits the block into branches (`if`/`elseif`/`else`), picks the first truthy branch, and processes it. |
| `_runWhile(condText, body, rest, inLoop)` | 0-or-more loop. Iterates: evaluate condition → process body → propagate `break`/`continue`. Stops after **1000 iterations** (`notify("Loop limit exceeded")`). |
| `_runDoWhile(condText, body, rest, inLoop)` | 1-or-more loop. Runs the body first, then checks the `{while: condition}` tag that closes it. Same 1000-iteration cap. |
| `_runFor(init, condition, update, body)` | C-style loop. Runs `init` once via the mutation pipeline (creating the variable), then iterates `condition` → body → `update`, propagating `break`/`continue` (`{continue}` still runs the update clause; `{break}` exits before it). Same 1000-iteration cap. |
| `_findWhileEnd(text)` | Returns `{ endIndex, endLength, body, found }` — the position of the matching `{endwhile}`, else `-1`/`false`. |
| `_findDoWhileEnd(text)` | Returns `{ endIndex, endLength, body, condition, found }` — the matching `{while:...}` that closes the do-block, else `-1`/`false`. |
| `_findForEnd(text)` | Returns `{ body, init, condition, update, end }` — the matching `{endfor}` (nesting-aware, counts `{for:}`/`{endfor}` depth, skips `{do}` blocks atomically), else `null` when the header has fewer than 3 semicolon-separated clauses or the block is unclosed. |
| `_findInitEnd(text)` | Returns `{ body, end }` — the matching `{endinit}` (nesting-aware, counts `{init}`/`{endinit}` depth), else `null`. |
| `_includeCount` / `_includeLimitNotified` | Per-render-pass state: how many passages have been spliced, and whether the one-time `Include limit exceeded.` toast already fired. |
| `_includedChoices` | Accumulator of the choices merged in by `{include:}` during the current `processDirectives` pass (reset at the top of every pass). |
| `_activeChoices` | The merged choice list `render()` / `renderSidePanel()` hand to `renderContent` and `navigateTo`. |
| `_actionBlocks` | Per-render capture of raw action-block bodies, in walker encounter order (reset at the top of `render()` and in `init()`). Each rendered block pushes its body and emits `data-action-block="<index>"`. |
| `_actionBlockLinks` | Per-render array of the anchor HTML for each rendered action block (same index as `_actionBlocks`). The walker pushes the link and emits a `\u0000nfaction_<idx>\u0000` placeholder token instead of raw HTML; `renderContent` restores the anchor **after** HTML-escaping so the tag survives. |
| `_audio` | Persistent url-keyed cache of `HTMLAudioElement`s plus per-render bookkeeping (see §`{audio:}` directives below). Never torn down on navigation; re-created on `init()`. |

### `{action:}` blocks

`processDirectives` dispatches on `{action:` (case-insensitive) **before** the `{set:}` branch, so a body's `{set:}` is never executed during render. The walker:

1. Finds the matching `{endaction}` via `text.indexOf` (first one wins — nesting unsupported). Unclosed → renders `{action:` literally.
2. Splits params on commas: `label` (first field), optional `condition`, optional `behavior` (`disable` default / `hide`).
3. Pushes the **raw body** onto `this._actionBlocks` and records its index.
4. Evaluates the condition via `_evalBool` (try/catch → false). If false and behavior is `hide`, the whole block emits nothing; otherwise it pushes the anchor HTML (`<a href="#" data-action-block="<idx>" class="disabled">label</a>` when disabled) onto `_actionBlockLinks` and emits a `\u0000nfaction_<idx>\u0000` token. `renderContent` swaps the token back to the anchor after escaping.

The body is **not walked for execution** at render — it is skipped verbatim between the two tags, so its `{set:}`/`{redirect:}` never fire on page load. Body directives only execute on click via `applyActionBlock`.

### `applyActionBlock(idx)`

The click delegation on `#app` matches `a[data-action-block]` (non-disabled only) and calls `applyActionBlock(parseInt(link.dataset.actionBlock, 10))`. It:

1. Reads `this._actionBlocks[idx]` (no-op if missing).
2. Runs `_processDirectives(body, false)` — executing `{set:}`/`{unset:}`/`{include:}`/nested `{if:}`/loops — and **discards the output**. `_freshEntry` is false here, so `{init}` in a body is skipped (init only fires on entry).
3. Checks `_checkRedirects(out.text)` — a `{redirect: slug}` in the body navigates via `render(redirect)` (after `autoSave()`); the walker never strips redirects, so the body's survives to be honored here.
4. Otherwise captures `#main-panel`'s `scrollTop`, re-renders the current node, and calls `_restoreScroll` to put the scroll position back, then `autoSave()`.

`_restoreScroll(scroller, target)` re-applies `scroller.scrollTop = target` on every animation frame until it sticks or 300 frames elapse. A single restore (even inside one `requestAnimationFrame`) is a no-op when the re-render recreates media (`{img:}`/`{video:}`) that starts at ~0 height, collapsing the content so the browser clamps `scrollTop` to 0; retrying each frame until the media loads lets the content grow back to accept the old position. Redirects deliberately skip this and scroll to top.

`_actionBlocks` is reset at the top of `render()` and in `init()`. Passage blocks precede side-panel blocks within a render cycle (passage renders first, then `renderSidePanel()`), and both standalone `renderSidePanel()` calls follow a full render, so indices stay in sync with the DOM. `renderContent` no longer handles action links — the `[text](action:id)` transform was removed (those links now fall through to the plain-text fallback).

### `{audio:}` directives

The walker dispatches on `{audio:` (case-insensitive, matched by `/\{audio:([^}]+)\}/i`) **after** the `{set:}`/`{unset:}` branches, consumes the tag, and emits **no output** — it is a pure side-effect directive. The captured param string is handed to `this._audio.directive(params)`.

`_audio` is the persistent audio registry (created fresh on `init()`):

| Member | Purpose |
|---|---|
| `tracks` | `url -> HTMLAudioElement` cache (lazy-created, never torn down across navigation) |
| `active` | `Set<url>` declared by the current render pass |
| `musicVolume` / `sfxVolume` | per-channel master volumes (default `1`); future settings-button hooks |
| `directive(params)` | Parses the url + options, dispatches verbs, or declares a play intent |
| `ensurePlaying(url, opts)` | Cache-or-create the element, set `loop`/`volume`/`preload="metadata"`, start with optional fade; re-declaring a playing track is a no-op |
| `pauseTrack(url)` / `stopTrack(url)` / `restartTrack(url)` | one-time verbs on a named url |
| `stopUndeclared()` | Stops (pause + reset to 0) every cached track **not** in `active`, then clears `active` for the next render |
| `stopAll()` | Stops and deletes all cached tracks; clears `active` |
| `setMasterVolume(channel, v)` | Updates `musicVolume`/`sfxVolume` and re-applies volume to cached tracks on that channel |

`directive(params)` splits on commas (first field = url, the track's identity), then scans the option fields: `music`/`sfx` select the channel, `loop` (bare or `=false`) sets looping, `volume=0..1` and `fade=ms` are parsed (values clamped), and a bare `stop`/`pause`/`restart` is a **one-time verb** that takes precedence for that render (it does **not** add the url to `active`). Unknown keys are ignored; spaces around `=` are fine. A play intent does `active.add(url)` then `ensurePlaying(url, {channel, loop, volume, fade})`.

Play-state is tracked per track via an internal `_nfState` flag (`'stopped'` / `'playing'` / `'paused'`) set on the element — `HTMLMediaElement` has no `playState` property. `_playWithFade` ramps volume over `fade` ms with `requestAnimationFrame` and calls `track.play()` (promise rejection swallowed). Every `_audio` method guards `window.Audio` availability and corrupt urls fail silently.

Lifecycle wiring: `render()` calls `renderSidePanel()` then `this._audio.stopUndeclared()` then `runWaitSequences()` — the single reconcile point where declared tracks keep playing and everything else stops. `newGame()` and `loadGame()` call `this._audio.stopAll()` before re-rendering (audio state is never saved). Side-panel `{audio:}` declarations run through `renderSidePanel()` → `processDirectives`, so HUD music is re-declared every render and a passage cannot stop it. Audio inside `{if:}` branches, loops, and `{include:}` splices works (walker-processed); like `{set:}`, it does **not** run inside `{wait:}`/`{dialogue:}` bodies (handled at `renderContent` time).

### `{init}` blocks

The walker dispatches on `{init}` (6 chars) / `{endinit}` (9 chars), exactly lowercase. `render()` sets `this._freshEntry = nodeId !== this.currentNodeId || this.currentNodeId == null` at the top of a render pass (before `processDirectives`), and the side panel shares that flag (a side-panel re-render with a new main passage is fresh).

When the walker meets `{init}` at the **top level** (`!inLoop && !this._inInit`) and `this._freshEntry` is true, it runs `_processDirectives(block.body, false)` and **discards the output** — body `{set:}` mutations apply, everything else executes but contributes nothing to the text. A `try/finally` resets `this._inInit` while the body runs, so nested `{init}` blocks are found and consumed-skipped (their mutations never run). Skipped cases (not fresh, inside a loop, nested) consume the block silently. An unmatched `{init}` (no `{endinit}`) renders literally. Multiple top-level `{init}` blocks run in textual order. `loadGame()` sets `this.currentNodeId = save.currentNodeId;` **before** `this.render(save.currentNodeId);` so a startup load isn't mis-detected as a fresh entry and doesn't re-apply saved setup.

Loop conditions are JS expressions evaluated against `state` and `temp` via `_evalBool` (so `state.items.size > 0` works for arrays).

### `{for:}` blocks

The walker dispatches on `{for:}` (6 chars) / `{endfor}` (8 chars), exactly lowercase. `_findForEnd(text)` parses the header (`^\{for:\s*([^}]+)\}`), splits it on `;` into `init` / `condition` / `update` (raw JS clauses; a header with fewer than 3 clauses renders literally), and finds the matching `{endfor}` while counting nested `{for:}`/`{endfor}` and skipping `{do}` blocks atomically via `_findDoWhileEnd`. `_runFor` executes `init` once through `_evalMutation` (creating the variable, like `for (var i = 0; …)`), then loops `condition` → body → `update` with the same 1000-iteration cap. `_findDoWhileEnd` itself forwards `{for:` to `_findForEnd` so a `{for:}` first in a `{do}` body is not mistaken for its closing `{while:}`.

### `{unset:}` blocks

`{unset: state.name}` → `delete this.state[name]`; `{unset: temp.name}` → `delete this.temp[name]`; `{unset: temp}` → `this.temp = {}`. Forms that match neither (`{unset: nonsense}`) render literally. Only the exact lowercase `{unset:}` spelling dispatches.

### `temp` scratch namespace

`this.temp` is a sibling of `this.state` on the engine object; it is **never serialized** (saves serialize only `state`). Every eval helper (`_evalBool`, `_evalMutation`, `_evalValue`) and the two inline `new Function` sites (choice prerequisite, pair condition) receive `'temp'` as a scope parameter binding `temp = this.temp`. `render()` discards it at the start of every fresh render (`if (this._freshEntry) this.temp = {};`), so a new passage starts clean while re-renders of the same passage (action clicks / form events pass the current `nodeId`, so `_freshEntry` is false) keep `temp` — letting an `{init}` build a `temp.items` array that the display code re-reads. `loadGame()` and `loadFromSlot()` reset `this.temp = {}` after restoring `state`. The constructor seeds `temp: {}`. `_norm` rewrites `.size` to `.length` for both `state.` and `temp.` prefixes.

### `{var:}` placeholder mechanism

Instead of a `{var:}`-focused regex pass, the walker now **snapshots** the value of each `{var:}` into `this._varValues[]` and emits a placeholder token `\u0000nfvar_<n>\u0000`. Arrays are snapshotted to their joined string (`join(', ')`) and other values via `String(...)` at capture time, so a stored token is never a live reference into `state` — later mutations (e.g. `{set: state.arr[i] += 1}` inside a loop) cannot leak back into an earlier capture. `renderContent` substitutes these tokens back **after** HTML escaping, so interpolated values that contain HTML (e.g. a variable holding `<b>text</b>`) still render as HTML — matching the pre-refactor behavior. A loop body using `{var:}` captures the value from its own iteration (not the final loop state).

Other helpers shared with the walker: `_norm` (rewrites `state.x.size`/`temp.x.size` → `.length`), `_evalBool`, `_evalMutation` (wraps the mutation in `try/catch`), `_evalValue`. All three eval helpers take a `'temp'` scope argument so their `new Function('state', 'temp', …)` bodies can read the scratch namespace.

### `{include:}` directive

The walker dispatches on `{include: slug}` (matched case-insensitively, so `{INCLUDE: x}` also works; documented lowercase) **after** `{unset:}`. It resolves `slug` against `this.nodes`, and:

- **Unknown slug** → the tag renders literally (author-visible).
- **Safety cap:** `_includeCount` (reset to 0 at the top of each `processDirectives` pass) stops expansion after **100 splices**; the `{include:}` tag is then dropped and `notify('Include limit exceeded.')` fires exactly once per pass via the `_includeLimitNotified` flag.
- **List merge:** the target's `choices` are pushed onto `_includedChoices` **before** its text is walked, so innermost/nested includes accumulate in textual order. When `_inInit` is true (an `{init}` body), mutations from the included text apply but choices are **not** pushed — init output is suppressed, so any links pushed there would never render and would shift the `data-choice-index` alignment.
- **Recursion:** the target's text is walked with the **same `inLoop` flag**, so `{break}`/`{continue}`/`{while:}` inside an included passage behave as if written inline. A `{redirect:}` in included text stays in the walker output and is caught by `render()`'s `_checkRedirects`.
- **No `on_enter`:** only `text` is spliced; the target's `on_enter` hook never runs.
- **Index-alignment invariant:** the merged list handed to `renderContent` must contain exactly the choices whose links survive the walk — an untaken `{if:}` branch pushes nothing and emits no links. `render()` builds `mergedChoices` = host choices + `_includedChoices`, stores it as `_activeChoices` **before** calling `renderSidePanel()` (the side panel's own `processDirectives` pass resets the `_includedChoices` accumulator), and passes the merged list to `renderContent` so `data-choice-index` attributes line up with `navigateTo` lookups. Inline action blocks need no such bookkeeping: the walker captures each body into `_actionBlocks` and emits `data-action-block="<index>"` inline, and `applyActionBlock(idx)` reads the capture at click time.

### Form elements

`renderContent` expands six form tags after HTML-escaping, each emitting a native control bound to a `state.` variable via `data-target-var` with a `data-nf-type` discriminator and a per-render unique id (`_formCounters` — `textfield`/`checkbox`/`radiogroup`/`dropdown`/`textarea`/`number` — reset at the top of `render()`):

| Tag | Output | Commit |
|---|---|---|
| `{textfield: var, hint, mode}` | `<input type="text" class="nf-textfield">` | `input` (live) / `blur` / Enter (onEnterKey, default) |
| `{textarea: var, hint, mode, rows}` | `<textarea class="nf-textarea" rows>` | `input` (live) / `blur` (default); Enter inserts a newline |
| `{number: var, min, max, step}` | `<input type="number" class="nf-number">` | `input` → `el.valueAsNumber`; empty field writes nothing |
| `{checkbox: var, value}` | `<input type="checkbox" class="nf-checkbox">` | `change`; toggle or set/type-reset `value` |
| `{dropdown: var, opt…}` | `<select class="nf-dropdown">` | `change` → `state[var] = el.value`; option matching `state` preselected |
| `{radiogroup}`+`{radiobutton: var, value}` | `<span class="nf-radiogroup">` of radio inputs | `change` → sets the value, re-renders the side panel |

Event wiring is delegated on `#app`: the `input` handler covers textfield/textarea (`live`) and number; the `blur` handler covers textfield/textarea (`blur`); the `change` handler covers checkbox/radio/dropdown; the `keydown` handler commits textfields on Enter (`nfType === 'textfield'` only, so textareas are untouched). Every commit calls `_reRender()`, which preserves the active element's id + cursor for live inputs.

### Media directives (`{img:}` / `{video:}`)

`renderContent` expands `{img: url, options}` and `{video: url, options}` into `<img>`/`<video>` elements using the shared `_parseMediaOptions(params)` helper (returns `{ target, w, h, alt, autoplay, repeat, mute }`, defaults `autoplay=true, repeat=true, mute=false`). Options are comma-separated `key=value` pairs; a key with no `=` is a `true` flag; the key and value are trimmed after splitting on the first `=`, so `w = 128` and spaces in the target work. `w`/`h` take the leading integer of the value and are emitted into the inline `style` as `;width:Npx`/`;height:Mpx` (CSS-based, mirroring the old `{img:w=..}` behavior); `alt` is dropped if empty or containing `,`/`}`/`"`. `{video:}` defaults `autoplay=true, repeat=true, mute=false` and always emits `controls` + `preload="metadata"`; `autoplay`/`loop`/`muted` attributes appear only when true; `alt` maps to `aria-label`. Browsers block *audible* autoplay, so pass `mute` for reliable ambient playback (documented caveat, not enforced).

**Legacy removal.** The markdown image forms `![alt](url)` and `![alt](url){img:...}` are **no longer recognized**. `renderContent` protects them at the top of the pipeline with a placeholder token (`\u0000nflegacy_<n>\u0000`, restored right before `{var:}` substitution) so they render **literally** — visibly broken text the author must convert, not a mangled link or a bogus image. The old `<img>`/`{img:}` regexes were deleted. `_rewrite_asset_urls` (`backend/main.py`) now stops its asset-URL match at `,`/`}` (`([^)"\s,}]+)`) so `{img: url, w=64}` targets and adjacent directives rewrite correctly on export/preview.

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

**Bypassed during `isLoading`** so that during project/group load every `addConnection` call renders its SVG path synchronously.

---

## Event Delegation Setup

| Function | Listens on | Handles |
|---|---|---|
| `setupEditorDelegation()` | `#choices-list` | Remove-choice buttons |
| `setupButtonDelegation()` | `document.body` | `[data-action]` buttons: `addNode`, `addGroup`, `showSaveModal`, `showLoadModal`, `exportGame`, `previewGame`, `runValidation`, `openTutorial`, `showVariableForm`, `addVariable`, `hideVariableForm`, `refreshAssets`, `updateCurrentNode`, `deleteCurrentNode`, `confirmSave`, `confirmLoad`, `importNode`, `confirmImport`, `closeModal` |
| `setupNodeOverlayDelegation()` | `#tab-graph` | Overlay `edit` / `delete` / `link` buttons |
| `setupAssetDelegation()` | `#asset-tree`, `#ae-file-grid`, `#ae-breadcrumb` | Tree toggle/copy/delete/new-folder/upload; grid selection + navigation; breadcrumb |
| `setupAEToolbar()` | `#ae-toolbar` | `newFolder`, `upload`, `rename`, `delete`, `copy`, `cut`, `paste` |
| `setupVariableDelegation()` | `#var-list` | Click item → edit; delete button → delete |
| `setupModalEvents()` | `#save-list`, `#load-list` | Item selection |

---

## Utility Functions

### `escapeHtml(str)`

Escapes `&`, `<`, `>`, `"`, `'` for safe HTML interpolation.

### `getLinkTextFromContent(content, targetSlug)`

Extracts display text from `[text](node:slug)` markdown link.

### `escapeRegex(str)`

Escapes special regex characters.

### `removeChoiceLink(sourceId, targetSlug)`

Calls `editor.removeSingleConnection(sourceId, targetId, ...)` to remove a connection by slug lookup.

---

## Converter: Twine → NodeFable

File: `backend/convert_twine.py`

Converts SugarCube (Twine 2) HTML stories to NodeFable project JSON.

### Usage

```sh
python3 backend/convert_twine.py
```

Output: `backend/data/TherapistRemastered/project.json`

### Pipeline Overview

The converter implements a 10-phase pipeline:

| Phase | Function(s) | Purpose |
|-------|-------------|---------|
| 1 | `convert_say_macros`, `convert_mcsay`, `convert_mcthink` | Dialogue/thought formatting |
| 1 | `convert_links`, `convert_link_macro`, `convert_goto` | `[text](node:slug)` links |
| 1 | `convert_set_macro`, `convert_run_macro`, `convert_if_macro` | `{set:}`, `{if:}` blocks |
| 1 | `convert_textbox`, `convert_radiobutton` | Form elements |
| 2 | `convert_time_macros` | Time/calendar → `{set:}` chains |
| 3 | `expand_stat_widgets` | Recursive widget expansion for stat macros |
| 4 | `convert_location_links` | Location link widgets |
| 5 | `convert_nextlink_widgets` | Next-link widgets |
| 6 | `convert_check_widgets` | Random event `Check*` widgets |
| 7 | `convert_dynamic_links` | Dynamic link list placeholders |
| 8 | `collect_init_mutations` | Init mutations for Start node |
| 9 | `convert_character_macros` | Character dialogue and face images |
| 10 | `convert_images`, `convert_video_fallback` | Image/video asset references |

### Key Conversions

| SugarCube | NodeFable |
|-----------|-----------|
| `<<if $x gt 5>>` | `{if: state.x > 5}` |
| `<<set $x to 10>>` | `{set: state.x = 10}` |
| `<<run State.setVar("x",v)>>` | `{set: state.x = v}` |
| `<<link "text" "target">>` | `[text](node:slug)` |
| `[[text\|passage]]` | `[text](node:slug)` |
| `<<goto "passage">>` | `{redirect: node:slug}` |
| `random(a,b)` | `(Math.floor(Math.random() * (b - a + 1)) + a)` |
| `previous()` | `state._previous` |
| `setup.numberOr(v,d)` | `((typeof v === "number") ? v : d)` |
| `Math.clamp(x,mn,mx)` | `Math.max(mn, Math.min(mx, x))` |
| `<<textbox "$x" d>>` | `{textfield: state.x, d}` |
| `<<radiobutton "$x" v>>` | `{radiobutton: state.x, v}` |
| `<<addHours N>>` | `{set: hour += N}{if: hour >= 24}...{endif}` |
| `$$varname` | `$state.varname` (literal `$` preserved) |

### Widget Expansion Strategy

Widgets (from `<<widget "Name">>...<</widget>>`) are expanded inline at conversion time:

- **Stat widgets** (e.g., `AddSexCorrRep`, `UpdateCanDoFlags`): Recursively expanded with argument substitution. Must contain `_args[N]`, `<<set`, `<<run`, or `<<if` to qualify.
- **Location widgets** (e.g., `BarLink`, `HomeLink`): Converted to `{if:} [link](node:)` patterns.
- **Next-link widgets** (e.g., `ParkNextLinkOrShocked`): Converted to direct links.
- **Check widgets** (`Check*`): Limited expansion to `{if: random:}` + `{redirect:}`.
- **Compute widgets**: Stat/computation widgets expanded to `{set:}`/`{if:}` chains.
- **Unrecognized**: Left as `[MacroName: args]` placeholders.

### Known Limitations

- Videos: `<<video>>` remains as `[Video: filename]` placeholder. Only still images from `[img[...]]` are embedded.
- Dynamic links: `<<FirstDynamicLink>>`, `Activities`, dynamic `<<include>>` → `[Activities:]` placeholder.
- Complex DOM: `BuyClothesTable`, `WardrobeTable`, `ComputeClothesStats` → `[MacroName:]` placeholder.
- `<<for>>` loops: Stripped (body content preserved).
- `<<script>>` blocks: Stripped entirely.
- Temp variables (`_varname`): Expanded as `state._varname` when part of known widget chains.
- `state._previous` must be tracked at runtime to make `previous()` work — not implemented.
- `Math.trunc` and standard JS Math functions work in the template engine.

### Limitations per-pass

- `<<for>>` loops: 701 stripped
- `[Video:]` placeholders: 1952
- `[link:]` placeholders: 2
- `[Activities:]` placeholders: 9
- Complex widget placeholders: 3
