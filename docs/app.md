# Frontend — Technical Reference

> **Branching convention:** `main` is the stable, user-facing branch (default clone, release-tagged, branch-protected). `develop` is the staging branch where active feature work happens. All engine changes land on `develop` and are merged into `main` only after `node tests/run.js` passes. See `README.md → Branches & Releases`.

## Overview

The NodeFable graph canvas frontend is a set of **standard ES modules**. `app.js` is the entrypoint (loaded via `<script type="module" src="app.js"></script>`); it initializes `CanvasEngine` + CodeMirror, calls the wiring functions, and exposes window-level handlers for inline HTML attributes (`onclick`/`onchange`/`onblur`). All business logic lives in `frontend/editor/js/` modules. There is no framework.

| Module | Responsibility |
|---|---|
| `js/constants.js` | `SVG_LINK`, `SVG_EDIT`, `SVG_CLOSE` markup, `MAX_UNDO` |
| `js/canvas-engine.js` | Custom zero-reflow `CanvasEngine` class replacing Drawflow (nodes, SVG Bezier connections, pan, zoom, Pointer Events, pinch-zoom, 500ms touch long-press `contextmenu`) |
| `js/api.js` | Unified transport adapter (`isTauri`, `invokeTauri`, `cleanAssetRelPath`, `resolveEditorAssetUrl`, `normalizeLegacyAssetUrls`) and `api` transport methods for saves, manifest/project load & save, assets CRUD, preview, and export (routes via Tauri IPC or HTTP `fetch`) |
| `js/state.js` | The single mutable `state` object (`variables`, `setupVariables`, …) + slug helpers (`slugify`, `generateUniqueSlug`, `getNodeSlug`, `getNodeIdBySlug`, `getNodeTitleBySlug`, `ensureNodeData`) |
| `js/ui-utils.js` | `showLoader`/`hideLoader`, `showToast`, `escapeHtml`/`escapeRegex`, `showIdError`/`hideIdError`, `validateSlugOnBlur`, responsive drawer helpers (`isDrawerLayout`, `openDrawer`, `closeDrawers`, `toggleDrawer`; breakpoint `DRAWER_BREAKPOINT = 1024`) |
| `js/viewer-overlay.js` | In-app fullscreen viewer `#preview-overlay` / `#preview-frame` for the game preview and the tutorial (`openGamePreview`, `openTutorial`, `openViewer`, `closeViewer`, `restartViewer`, `isViewerOpen`, `setupViewerOverlay`) |
| `js/history.js` | Undo/redo snapshots (`_captureSnapshot`, `snapshotState`, `captureCurrentState`, `restoreState`, `undo`, `redo`) |
| `js/codemirror-setup.js` | `nodefable` CodeMirror mode, `nodeFableHint` autocomplete, editor bridge (`isSpellcheckActive`, `getEditorValue`, `setEditorValue`, `insertAtCursor`, `insertMarkdown`, `toggleSpellcheck`) |
| `js/validation.js` | `validateDeadEnds`, `validateOrphans`, `runValidation` |
| `js/variables-manager.js` | Variable CRUD + `renderVariables` |
| `js/asset-explorer.js` | Asset tree/grid, breadcrumbs, copy/cut/paste/rename/delete/upload, `insertImage` |
| `js/node-editor.js` | Passage editor, node CRUD, linking, choices/on_enter editors |
| `js/group-manager.js` | Groups/portals: add/edit/collapse/load/move/delete, portal I/O label + output lines, batched node/connection creation |
| `js/graph-engine.js` | `setupEditorEvents`, `injectOverlayToNode`/`_createOverlay`, `ensureSidePanelNode`, `ensureSetupNode` |
| `js/event-delegation.js` | All `setup*()` wiring, context menu, keyboard shortcuts, modal + save/load/export/import functions, `filterNodes` |
| `js/node-search.js` | Header search suggestions dropdown (`setupSearchSuggestions`, `rankSearchSuggestions`, `collectSearchEntries`, `focusNodeOnCanvas`) |

> **Note on circular imports:** `history.js` ↔ `node-editor.js`, `history.js` ↔ `event-delegation.js`, and `node-editor.js` ↔ `group-manager.js` import each other. This is safe because the bindings are only *used at call time* (inside function bodies, after `DOMContentLoaded`), never during module evaluation. All cross-module references are exported `function` declarations, which are hoisted at module instantiation.

## Global State

> All former globals now live on the exported `state` object in `js/state.js` and are referenced with a `state.` prefix (e.g. `state.nodesData`, `state.editor`, `state.selectedNodeId`). The exceptions kept as true module-local `let`s are `selectedLoadName` and `contextMenuTargetId` in `js/event-delegation.js`. Constants `SVG_LINK`, `SVG_EDIT`, `SVG_CLOSE` moved to `js/constants.js`.

| State property | Type | Purpose |
|---|---|---|
| `state.editor` | `CanvasEngine` | The `CanvasEngine` graph canvas instance (`window.Drawflow` alias) |
| `state.selectedNodeId` | `number \| null` | Currently selected node's Drawflow numeric ID |
| `state.linkingFromId` | `number \| null` | Node ID from which a link is being drawn |
| `state.nodesData` | `object` | Keyed by Drawflow numeric ID → `{title, text, choices, slug, on_enter, is_start, group}` |
| `state.slugToNodeId` | `object` | Slug → Drawflow numeric ID reverse lookup |
| `state.variables` | `object` | Keyed by variable name → `{type, value}` (state scope) |
| `state.setupVariables` | `object` | Keyed by variable name → `{type, value}` (setup/constants scope, persisted in manifest) |
| `state.isEditingVariable` | `boolean` | True while the variable form is in edit mode |
| `state.editVariableBackup` | `object \| null` | Backup `{name, type, value, scope}` of the variable being edited |
| `state.isLoading` | `boolean` | True during bulk project/group load: bypasses the `updateConnectionNodes` RAF throttle (edges draw synchronously) and suppresses `snapshotState()` |
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

`MAX_UNDO` (50), `MAX_PORTAL_ROWS` (30) and SVG icon constants `SVG_LINK`, `SVG_EDIT`, `SVG_CLOSE` live in `js/constants.js`.

---

## Initialization

| Variable | Type | Purpose |
|---|---|---|
| `editor` | `CanvasEngine` | The `CanvasEngine` graph canvas instance |
| `selectedNodeId` | `number \| null` | Currently selected node's Drawflow numeric ID |
| `linkingFromId` | `number \| null` | Node ID from which a link is being drawn |
| `nodesData` | `object` | Keyed by Drawflow numeric ID → `{title, text, choices, slug, on_enter, is_start, group}` |
| `slugToNodeId` | `object` | Slug → Drawflow numeric ID reverse lookup |
| `variables` | `object` | Keyed by variable name → `{type, value}` |
| `isEditingVariable` | `boolean` | True while the variable form is in edit mode |
| `editVariableBackup` | `object \| null` | Backup `{name, type, value}` of the variable being edited |
| `isLoading` | `boolean` | True during bulk project/group load: bypasses the `updateConnectionNodes` RAF throttle (edges draw synchronously) and suppresses `snapshotState()` |
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

### `DOMContentLoaded` handler (`app.js`)

1. Gets `#tab-graph` container, creates `new CanvasEngine(container)` and calls `state.editor.start()`.
2. Wraps `state.editor.updateConnectionNodes` with a per-node RAF coalescer: every node requested during a frame is updated once on the next frame (bypassed during `state.isLoading`). See *Performance* below.
3. Sets `zoom_max = 2.0`, `zoom_min = 0.15`, `zoom_value = 0.05`, `curvature = 0.3`.
4. Calls `setupEditorEvents()`.
5. Wires `#canvas-zoom-controls` (`[data-canvas-zoom]` buttons `in`, `reset` (1:1), `out`, `fit`) to `state.editor.zoom_in()`, `zoom_reset()`, `zoom_out()`, and `zoomToFit()`.
6. Wires responsive side drawers for `<=1024px` viewports via the `ui-utils.js` helpers: `#toggle-vars-drawer` → `toggleDrawer('var-panel')`, `#toggle-inspector-drawer` → `toggleDrawer('sidebar')`; `#drawer-backdrop`, the drawers' close buttons and `Escape` call `closeDrawers()`. The Inspector drawer also opens on a node tap (`nodeTapped`) and from the node overlay's Edit button.
7. Calls `setupDelegation()` (which internally runs `setupTabs()`, `setupModalEvents()`, `setupEditorDelegation()`, `setupAssetDelegation()`, `setupAEToolbar()`, `setupVariableDelegation()`, `setupNodeOverlayDelegation()`, `setupButtonDelegation()`, `setupSearch()`, `setupContextMenu()`, `setupViewerOverlay()`) and `setupKeyboardShortcuts()` (all in `js/event-delegation.js`).
8. Initializes CodeMirror 5 on `#passage-content-editor` with the custom `nodefable` mode (see below), `material-darker` theme, line numbers, line wrapping, bracket matching, `viewportMargin: Infinity`, and `extraKeys` (`Enter` → `newlineAndIndentContinueMarkdownList`, `Ctrl-Space` → autocomplete).
9. Wires CodeMirror + textarea auto-save listeners (see Markdown Auto-Save).
10. Registers global `keydown` listener for keyboard shortcuts (Ctrl+S, Ctrl+Z/Y, Delete/Backspace, Escape) via `setupKeyboardShortcuts()`.
11. Calls `ensureSidePanelNode()` and `ensureSetupNode()` after a 100ms delay (both reserved nodes appear on any fresh canvas).

---

## Canvas Engine (`js/canvas-engine.js`)

`CanvasEngine` is a zero-reflow, touch-and-mouse-capable replacement for Drawflow (v0.0.60), also assigned to `window.Drawflow` for compatibility. It preserves the `.parent-drawflow` / `.drawflow` / `.drawflow-node` / `svg.connection` DOM structure and `drawflow.drawflow.Home.data` data shape expected by the rest of the editor.

### Event contract (programmatic vs. user intent)

- **Programmatic calls are silent.** `addConnection`, `removeSingleConnection`, `removeConnectionNodeId`, `removeNodeId` and `clear` do **not** dispatch `connectionCreated` / `connectionRemoved` / `nodeRemoved`. Project load, group collapse/expand/switch and undo/redo therefore never trigger choice/markdown side effects, and no `collapsingSlugs`-style guards are needed.
- **User intents opt in** with a trailing `{ notify: true }` option: linking mode (`handleLinkTargetClick`), unlinking from the choices list (`removeChoiceLink`) or the edge context menu, and node deletion (`deleteCurrentNode` / `deleteNodeOverlay` → only `nodeRemoved`; the node's edges are torn down silently).
- **Engine-handled interactions** (dropping a dragged link on a port, Delete/Backspace on a selected edge, `removeConnection()`) dispatch `beforeUserEdit` *before* mutating (graph-engine takes the undo snapshot there) and then notify.
- **Render hooks always fire:** `nodeCreated`, `nodeResized`, `nodeSelected`, `nodeUnselected`, `nodeMoved` (drag end), `nodeTapped` (press + release on a node without movement, long-press or cancel), `mouseMove` (during node drag), `connectionSelected`, `connectionUnselected`, `zoom`, `translate`.

### Constructor properties

| Property | Default | Purpose |
|---|---|---|
| `container` | `container` | Host DOM element (`#tab-graph`); receives `.parent-drawflow` and `tabIndex = 0` in `start()`. `.parent-drawflow` must not set `display` (tab visibility is owned by `.tab-content` / `.tab-content.active`) |
| `precanvas` | `null` | Inner `.drawflow` element created by `start()`, transformed via `translate(canvas_x, canvas_y) scale(zoom)` with `transform-origin: 0 0` |
| `zoom`, `zoom_max`, `zoom_min`, `zoom_value` | `1`, `2.0`, `0.15`, `0.05` | Current zoom scale and bounds/step |
| `curvature` | `0.3` | Bezier control-point factor for `createCurvature()` |
| `canvas_x`, `canvas_y` | `0`, `0` | Current canvas pan offset in screen pixels |
| `editor_selected` | `false` | True while panning the canvas |
| `drag` | `false` | True while dragging a node |
| `connection` | `false` | True while dragging a new port-to-port connection |
| `node_selected`, `connection_selected`, `ele_selected` | `null` | Currently selected node element / selected edge `.main-path` |
| `nodeIdCounter` | `1` | Auto-incrementing numeric node ID counter |
| `events` | `{}` | Registered event listeners keyed by event name |
| `module` | `'Home'` | Active module name |
| `drawflow` | `{ drawflow: { Home: { data: {} } } }` | Node metadata, positions (`pos_x`, `pos_y`), measured size (`_w`, `_h`) and port connection maps |
| `_pointers`, `_pinch`, `_longPressTimer` | `Map`, `null`, `null` | Active pointers; pinch state `{origin, prev: {dist, midX, midY}}`; 500ms touch long-press timer |
| `_lastPointerType`, `_suppressNativeCtxUntil` | `null`, `0` | Used to de-duplicate the engine's synthetic long-press `contextmenu` and the browser's native one |
| `_resizeObserver` | `ResizeObserver \| null` | Observes every node element; keeps `_w` / `_h` current |
| `_dragState`, `_panState`, `_connState` | `null` | Transient gesture state during node drag, canvas pan, and temporary SVG connection drag |

### Methods

| Method | Behaviour |
|---|---|
| `on(event, callback)` / `dispatch(event, details)` | Registers and invokes listeners (see *Event contract*). |
| `start()` | Adds `.parent-drawflow` + `tabIndex = 0` to `container`, creates `<div class="drawflow">` as `precanvas`, creates the `ResizeObserver`, and calls `_bindEvents()`. |
| `addNode(name, numInputs, numOutputs, posX, posY, className, data, title)` | Creates `.drawflow-node` with `.inputs`, `.drawflow_content_node`, and `.outputs` ports. **`title` is rendered with `textContent`** (never parsed as HTML — node titles from imported JSON / project files cannot inject markup). Records the entry in `drawflow.drawflow.Home.data[id]`, observes the element for resizes, dispatches `nodeCreated`, returns `id`. |
| `hasConnection(idOutput, idInput, outputClass, inputClass)` | True if that exact edge exists. |
| `addConnection(idOutput, idInput, outputClass, inputClass, options)` | Deduplicates and records the link on both nodes' port lists, creates `<svg class="connection node_in_node-{in} node_out_node-{out} {outClass} {inClass}">` with `.hit-path` + `.main-path`, routes it via `updateConnectionNodes`. Returns `true` if created. Dispatches `connectionCreated` only with `{ notify: true }`. |
| `updateConnectionNodes(id)` | Finds all `svg.connection` elements for `nodeId` and recomputes their box + path from `_getPortCoords()` (pure math, no layout reads). |
| `removeSingleConnection(idOutput, idInput, outputClass, inputClass, options)` | Removes the connection from both nodes and its SVG (clearing `connection_selected` if it pointed at it). Returns `true` if something was removed. Dispatches `connectionRemoved` only with `{ notify: true }`. |
| `removeConnectionNodeId(id)` | Silently removes every inbound and outbound connection attached to `nodeId`. |
| `removeNodeId(id, options)` | Silently removes the node's edges, unobserves + removes its DOM element and data entry, clears selection/drag state for it. Dispatches `nodeRemoved` only with `{ notify: true }`. |
| `zoomTo(z, px, py)` | Clamps `z` and zooms keeping the container-local point `(px, py)` fixed on screen (default: container centre). Dispatches `zoom`. |
| `zoomToFit({ padding = 40, maxZoom = 1, animate })` | Frames the bounding box of every node (sizes from `_w` / `_h` or defaults) in the container, never zooming in past `maxZoom`, via `centerOn()`. Used by the **Fit** zoom button. |
| `zoom_in()` / `zoom_out()` / `zoom_reset()` | `zoomTo(zoom ± zoom_value)` / `zoomTo(1)` anchored at the canvas centre (used by `#canvas-zoom-controls`). |
| `zoom_refresh()` | Clamps `zoom`, re-applies the transform, dispatches `zoom`. |
| `panBy(dx, dy)` | Moves the viewport and dispatches `translate`. |
| `clear()` | Silent full reset: disconnects the `ResizeObserver`, cancels gestures, empties `precanvas` (including portal lines) and the data map, clears selection. |
| `clearSelection()` | Silently drops node + edge selection (used by Escape). |
| `removeConnection()` | User intent: removes the selected edge (`beforeUserEdit` → `removeSingleConnection(..., { notify: true })`). |
| `getPortCoords(nodeId, portClass, isOutput)` / `_getPortCoords(...)` | Port centre in world coordinates. Uses `_w` / `_h` (measured once, then kept current by the `ResizeObserver` → `nodeResized`), falling back to `208` (portal `248`) × `68` while unmeasured. Story nodes centre vertically (`h / 2`); portal rows (`.portal_node` / `.node-portal`) use `28 + idx * 29` to align with `_labelPortalIO`. |
| `positionConnectionSvg(svg, p1, p2)` | Public router: sizes the SVG to the exact Bezier bounding box and sets `.main-path` / `.hit-path`. Also used for portal lines. |
| `createCurvature(...)` | Cubic Bezier `M ... C ...` path using `Math.abs(x2 - x1) * curvature`. |
| `_bindEvents()` | See below. |

### Input handling (`_bindEvents`)

- **Pointer Events** on `container`; `pointermove` / `pointerup` / `pointercancel` are also tracked on `window` (de-duplicated via an `__nfHandled` flag), so node drags, pans and link drags keep following the pointer after it leaves the canvas. Pointer capture is deliberately **not** used — it would retarget `click` away from nodes and break linking mode.
- Interactive child controls (`button, input, select, textarea, .node-overlay, .portal-actions, .node-collapse-btn, #canvas-zoom-controls`) are ignored.
- **Link drag** from a story node's `.output`: draws a dashed `svg.temp-connection`; on release `document.elementFromPoint` picks the drop target. `.input` → that port; a story node's body → `input_1`; a **portal body is ignored** (a slug row must be targeted explicitly). Dropping onto a port that is **already linked** from the same output toggles the link off (`beforeUserEdit` → `removeSingleConnection(..., { notify: true })`). **Portal outputs never start a drag** (read-only).
- **Unplug / re-plug (input side):** pressing a *linked* `.input` arms an unplug; moving more than 6px detaches the most recent link on that port (`beforeUserEdit` type `connectionDetach`, then a silent removal) and its source end follows the pointer as a temp connection. On release: another port / story-node body → re-plugged there and `connectionRewired` `{output_id, output_class, from: {input_id, input_class}, to: {input_id, input_class}}` is dispatched; the original port → restored silently; a port the source already links to, a portal body or empty canvas → `connectionRemoved` for the old edge. `pointercancel` or a second finger restores the link. A press without movement stays a click (node selection, linking-mode target); unlinked inputs keep the normal node drag. One gesture = one undo step.
- **Mouse pointers:** a new mouse `pointerdown` drops stale mouse entries from `_pointers` (lost `pointerup`) so they cannot fake a pinch.
- **Edges:** only the visible stroke is clickable (`.main-path { pointer-events: visibleStroke }` + 14px transparent `.hit-path`); portal lines (`svg.portal-output`) and the temp line are not clickable.
- **Nodes:** select (`nodeSelected` / `nodeUnselected`) + drag (`pos_x`/`pos_y` scaled by `1 / zoom`, `mouseMove` per frame, `nodeMoved` on release if moved).
- **Empty canvas:** pan (`translate`).
- **Two pointers:** pinch-zoom anchored at the finger midpoint plus simultaneous two-finger pan.
- **Wheel:** `Ctrl`/`Cmd` + wheel (and trackpad pinch, reported as ctrl+wheel) zooms smoothly at the cursor (`exp(-deltaY * 0.0015)`, `deltaMode` normalised); plain wheel / two-finger scroll **pans** (`Shift` + wheel pans horizontally).
- **Touch long-press (500ms, cancelled by >8px movement)** on a node *or an edge* dispatches a bubbling `contextmenu` `MouseEvent` (node menu / *Unlink Connection*). A capture-phase `contextmenu` listener makes whichever comes first win: the browser's native long-press menu cancels the timer, and a native event arriving within 1s after the synthetic one is suppressed.
- **Delete / Backspace** on a focused canvas with a selected edge calls `removeConnection()` and `preventDefault()`s; the document-level shortcut handler skips events that are already `defaultPrevented`.

---

## CodeMirror: `nodefable` mode & autocomplete

### Custom mode

`CodeMirror.defineMode('nodefable', ...)` wraps the built-in `markdown` mode with an `overlayMode` that tokenizes NodeFable syntax:

| Token | Match |
|---|---|
| `keyword` | `{if:}` / `{elseif:}` / `{else}` / `{endif}`, `{set:}`, `{redirect:}`, `{textfield:}`, `{textarea:}`, `{number:}`, `{checkbox:}`, `{dropdown:}`, `{radiogroup}`, `{endradiogroup}`, `{radiobutton:}`, `{wait:...}{endwait}`, `{endwait}`, `{dialogue:}`, `{enddialogue}`, `{img:}`, `{video:}`, `{audio:}`, `{notify:}`, `{action:}`, `{endaction}`, `{live:}`, `{endlive}`, `{while:}` / `{endwhile}`, `{do}`, `{break}`, `{continue}`, `{for:}` / `{endfor}`, `{unset:}`, `{include:}`, `{init}` / `{endinit}`, `{fn:}`, `{endfn}`, `{return:}`, `{call:}` |
| `builtin` | `{random:n,m}`, `notify(`, `game.newGame(` |
| `variable-2` | `{print:state.x}` / `{print state.x}`, bare `state.varname` / `temp.varname` / `setup.varname`, array access `state.myarray[0]` / `state.myarray[state.id]` and `.size` |
| `atom` | `true` / `false` |
| `number` | numeric literals |

### Autocomplete provider

`CodeMirror.registerHelper('hint', 'nodeFableHint', ...)`. Context detection (cursor-based, inspecting the line before the cursor):

- Inside `[...](...)`: suggests `node:` / `action:` prefixes; after `node:` suggests matching slugs from `slugToNodeId`; after `action:` suggests matching action IDs scanned across all nodes.
- After `state.` / `setup.`: suggests matching variable names from the state/setup stores (`variables` / `setupVariables`); after `temp.` only the prefix is offered (temp has no editor store — runtime-only); after `helper.`: suggests `random`, `either`, `clone`, `clamp`, `fn_exists`, `hasMacro`, `hasPassage`.
- After `{include:`: suggests matching passage slugs from `slugToNodeId`.
- A bare `state`/`temp`/`setup`/`helper` / `state.`/`temp.`/`setup.`/`helper.` token: suggests the scoped prefixes.
- General word completion: suggests the NodeFable keyword list (`if:`, `elseif:`, `else`, `endif`, `set:`, `redirect:`, `random:`, `textfield:`, `textarea:`, `number:`, `checkbox:`, `dropdown:`, `radiogroup`, `radiobutton:`, `endradiogroup`, `print:`, `wait:`, `endwait`, `dialogue:`, `enddialogue`, `img:`, `video:`, `audio:`, `notify:`, `action:`, `endaction`, `include:`, `live:`, `endlive`, `while:`, `endwhile`, `do`, `break`, `continue`, `for:`, `endfor`, `unset:`, `init`, `endinit`, `fn:`, `endfn`, `return:`, `call:`, `setup`, `helper`, `true`, `false`, `notify(`, `game.newGame()`).

`inputRead` triggers autocomplete automatically after typing `.` or `:`. `hintOptions.completeSingle = false`.

---

## Canvas Engine Event Wiring (`js/graph-engine.js`)

### `setupEditorEvents()`

Finds the `.drawflow` DOM element, then registers all `CanvasEngine` and DOM event listeners. If `.drawflow` is not found, logs an error and returns early (no events are wired). Because the engine only notifies for user intents (see *Event contract*), the `nodeRemoved` / `connectionCreated` / `connectionRemoved` handlers never run during loads, collapse/expand, group switching or undo/redo.

Then iterates `document.querySelectorAll('.drawflow-node')` to inject overlays (deferred) and collapse buttons into any nodes that already exist.

#### Engine events

| Event | Handler | Behaviour |
|---|---|---|
| `nodeSelected` | `injectOverlayToNode(nodeId, false)` + `openPassageEditor(nodeId)` | Immediately mounts `.node-overlay` (so touch taps display Edit / Delete / Link / Menu buttons without needing `mouseenter`; `.node-overlay` also shows when `.drawflow-node.selected` is active) and opens the passage editor for the clicked node (skipped while `linkingFromId !== null`). |
| `nodeUnselected` | `closePassageEditor()` | Hides the passage editor. |
| `nodeCreated` | `injectOverlayToNode(nodeId, true)` | Defers overlay injection until first hover or selection. |
| `nodeTapped` | Open Inspector drawer | On drawer layouts (`isDrawerLayout()`, ≤1024px) and outside linking mode, `openDrawer('sidebar')`. Dragging a node never opens it. |
| `beforeUserEdit` | `snapshotState()` | Undo snapshot right before an engine-handled user edit (drag-to-link drop, Delete on a selected edge). |
| `mouseMove` / `nodeMoved` / `nodeResized` | Live portal-line reposition | RAF-throttled `_repositionPortalOutputs()` while a node is dragged, when it is dropped, and when a node's rendered size changes. |
| `nodeRemoved` | Cleanup + choice cleanup | (User deletion only.) Strips every choice + `[text](node:slug)` link targeting the removed slug from all other nodes via `stripChoiceAndLink()`, deletes the node from `nodesData` / `slugToNodeId`, runs validation and `_refreshPortalOutputs()`, closes the editor if it showed the node. |
| `connectionCreated` | Choice creation | (User link only.) Portal-target case: maps the input port to a portal slug (the `+N more` bucket row is rejected with a toast), pushes a `{targetSlug, text, prerequisite, mutation}` choice and inserts the markdown link. Portal-source case: alert + silent removal using the event's real `output_class`. If the source already has a choice to the target slug (portal or normal case), the link is **toggled off** (`_unlinkExisting`: drop the new edge silently, `stripChoiceAndLink`, toast). Normal case otherwise pushes a choice and inserts `[Title](node:slug)` at the cursor or appends it. Runs validation and refreshes portal outputs. |
| `connectionRewired` | Retarget choice | (Input unplug + re-plug.) Resolves old/new slugs (`_slugForInputPort`: portal row slug or node slug). New target is the portal `+N more` row → the move is reverted with a toast. Source already links to the new slug → merge (`stripChoiceAndLink` for the old slug). Otherwise the existing choice's `targetSlug` is changed (text / prerequisite / mutation kept) and `[text](node:old)` links are rewritten to `node:new` (link text kept; a link is appended if none existed). Refreshes editor, validation, portal lines; toast "Link moved". |
| `connectionRemoved` | Choice cleanup | (User unlink only; the snapshot is taken by the caller / `beforeUserEdit`.) Resolves the target slug (portal row → `portalSlugIds[idx]`, otherwise the node's slug) and calls `stripChoiceAndLink()` — choice **and** markdown link are removed in both cases. Shows a "Link removed" toast, runs validation and refreshes portal outputs. |

#### DOM events on `.drawflow`

| Event | Behaviour |
|---|---|
| `click` | Intercepts `[data-overlay-action]` clicks first: `menu` stops propagation and dispatches a bubbling `contextmenu` `MouseEvent` on the node element (1-tap access to `#context-menu` for touch users); `edit` on mobile viewports (`window.innerWidth <= 1024`) opens `#sidebar.drawer-open` and shows `#drawer-backdrop` (while allowing `setupNodeOverlayDelegation` to run `editNode`). Other `.node-overlay` clicks are ignored. Closes passage editor if click is on empty canvas. Handles linking-mode target clicks (`handleLinkTargetClick`). |
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

### `ensureSidePanelNode()` / `ensureSetupNode()`

`ensureSidePanelNode` creates a node with slug `side_panel` (including `is_start: false`) if it does not already exist. `ensureSetupNode` (new, spec 33) creates a node with slug `setup` (`is_utility: true`, group `side_panel`) if it does not already exist. Both are called after init (app.js DOMContentLoaded start, a 100ms `setTimeout` each) and after every project load — so a fresh project always has the Setup node just like Side Panel. The setup node lives in the always-loaded `side_panel` group so it's never hidden behind a portal. Like `side_panel`, it is a **reserved system node**: the editor hides its Start/Utility/Fn toggles (it stays `is_utility: true`, never a start node), disables its group dropdown, blocks delete, skips its context menu, and the orphan-validation implicit-start fallback excludes `setup`. Group-switch unloads keep nodes by **group** (`side_panel`), so the setup node survives `moveToGroupFromPortal` alongside `side_panel` (see `docs/frontend.md`, "Groups").

### `injectOverlayToNode(nodeId, deferred)`

Finds the `.drawflow-node` DOM element by `[data-id="{nodeId}"]`. If no `.node-overlay` exists, either creates it immediately or (when `deferred` is true) attaches a `mouseenter` listener that creates it on first hover (and `nodeSelected` also calls `injectOverlayToNode(nodeId, false)` so touch taps inject immediately). `_createOverlay` builds the Edit ✎ / Delete ✖ / Link 🔗 / Menu ⋯ (`data-overlay-action="menu"`) button row — the Link button is omitted for portal nodes (outbound portal connections are read-only), while the Menu button is included for both normal and portal nodes.

### `updateStartBadgeOnCanvas(nodeId)`

Adds or removes a green "START" badge on the node's Drawflow element based on `nodesData[nodeId].is_start`.

### `toggleUtilityNode(checked)`

Called from the `#passage-is-utility` checkbox `onchange`. Sets `nodesData[selectedNodeId].is_utility = checked` (no exclusivity — multiple utility nodes allowed) and calls `updateUtilityBadgeOnCanvas(selectedNodeId)`.

### `updateUtilityBadgeOnCanvas(nodeId)`

Adds or removes a grey "utility" left border (`node-utility` class) on the node's Drawflow element based on `nodesData[nodeId].is_utility`. Called on selection (`openPassageEditor`), save (`updateCurrentNode` / `saveCurrentContent`), toggle, creation, import, and load.

### `editNode(nodeId)`

Calls `openPassageEditor(parseInt(nodeId))`. Wired to overlay's Edit button.

### `deleteNodeOverlay(nodeId)`

Portals are routed to `deleteGroupFromPortal()`. Reserved nodes (`side_panel`, `setup`) are refused. Otherwise prompts for confirmation, takes undo snapshot, calls `editor.removeNodeId(..., { notify: true })` (the `nodeRemoved` handler strips links to it), cleans up `nodesData`, `slugToNodeId` and group membership, closes the passage editor.

### `deleteCurrentNode()`

Same as `deleteNodeOverlay` but operates on `selectedNodeId`. Protected by confirmation. Wired to Delete/Backspace key.

---

## Linking Mode

### `startLinking(nodeId)`

Sets `linkingFromId = parseInt(nodeId)`, adds `is-linking` class to `<body>`. Wired to overlay's Link button.

### `cancelLinking()`

Clears `linkingFromId`, removes `is-linking` class.

### `handleLinkTargetClick(targetId, inputName)`

**Toggle:** re-linking two nodes that are already linked removes the link. Self-link cancels. A portal target needs a specific `input_N` row (otherwise alerts "Cannot link to a portal group"). Takes one undo snapshot, then: if the edge exists → `removeSingleConnection(..., { notify: true })` (the `connectionRemoved` handler strips choice + markdown); otherwise → `addConnection(..., { notify: true })`, where `connectionCreated` either creates the choice or, if the source already had a choice to that slug (e.g. a cross-group link shown only as a dashed portal line), toggles it off. Cancels linking mode.

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

Requires `currentProjectName`. Uploads a file via `api.uploadAsset(state.currentProjectName, file, '')`, inserts `assetSyntax(result.rel_path || file.name, file.name)` (`{img: assets/<path>, alt=<name>}`) at cursor via `insertAtCursor()`, and calls `refreshAssets()` (see `docs/guide.md`).

---

## Save Data

### `propagateSlugRename(oldSlug, newSlug, currentNodeId)`

Centralizes slug-rename propagation when a passage slug changes:
1. Updates `state.slugToNodeId` (deletes `oldSlug`, sets `newSlug -> currentNodeId`). Returns a no-op `(txt) => txt || ''` if `!oldSlug || oldSlug === newSlug`.
2. Builds a `rewriteText(txt)` helper that rewrites exact `[text](node:oldSlug)` markdown links and `{redirect: oldSlug}` / `{include: oldSlug}` directives to `newSlug` without touching partial-prefix slugs (e.g. `old_forest_2`).
3. Scans loaded `state.nodesData`: updates `choices[].targetSlug`, `on_enter.target_node_id`, `text` (via `rewriteText`), and `portalSlugIds` on portal nodes (both string entries and `{ slug_id, connections[] }` objects).
4. Scans `state.collapsedGroupsData`: updates cached node `id`, `choices[].targetSlug`, `choices[].target_node_id`, `on_enter.target_node_id`, and `text`.
5. Scans `state.groupsManifest.groups[].slug_ids`: updates both string entries and `{ slug_id, connections[] }` objects. Returns `rewriteText`.

### `saveCurrentContent(nodeId)`

Lightweight content sync: reads title, content, `is_utility`, `is_function`, and slug from DOM and writes to `nodesData[nodeId]`. Includes a duplicate-slug guard (`newSlug && newSlug !== nodeData.slug && state.slugToNodeId[newSlug] === undefined`): only when the new slug is non-empty, changed, and unused does it call `propagateSlugRename(nodeData.slug, newSlug, nodeId)`, update `nodeData.slug`, sync the editor value if `nodeData.text` was rewritten, and re-render choices/on-enter for the selected node. Used for auto-save on node switch, title blur, and slug blur.

### `updateCurrentNode()`

Takes undo snapshot. Reads title, slug, content from DOM (rejecting empty or duplicate slugs via `showIdError`). When the slug changed, calls `propagateSlugRename(oldSlug, newSlug, state.selectedNodeId)`, applies the returned `rewriteText` to `content` (syncing the editor if changed), and updates `nodeData.slug`. Syncs `is_start` from checkbox (enforces single-start — unchecks all others), `is_utility`, and `is_function`. Syncs group from dropdown and choice prerequisites/mutations from the DOM. Updates the Drawflow node label and badges. Re-renders choices, on-enter, and functions.

---

## Variable Management

### `showVariableForm()`, `hideVariableForm()`, `addVariable()`, `editVariable()`, `deleteVariable()`, `renderVariables()`

Full CRUD for global variables with type-specific parsing (int, float, bool, string, **array**, **dict**) and a **scope** selector (`#var-scope` → `state` or `setup`). `state.variables` holds the `state` scope, `state.setupVariables` the `setup` scope. `renderVariables()` lists both scopes together; each entry shows a colored **left-side border** on the item (`.var-item.scope-state` teal / `.scope-setup` gold) and the **fully-qualified name** (`state.myvar` / `setup.myvar`). Object (`dict`) values render as pretty JSON via `JSON.stringify`. Save payload and load restore split on scope (`variables` vs `setup` in the manifest).

- `editVariable(name, scope)` — called when clicking a variable in the list. Saves a backup (`editVariableBackup` with scope), deletes the variable, pre-fills the form (scope dropdown included; for `dict`, `#var-value` gets `JSON.stringify(v.value, null, 2)` with placeholder `JSON object e.g. {"name":"Sandra"}`), changes submit button to "Save Changes". If another edit was in progress, restores the prior backup first.
- `hideVariableForm()` — hides the form and clears fields. If called during an edit, restores the variable from backup (to its original scope) and refreshes the list.
- `addVariable()` — reads `#var-scope`, validates and parses values (`dict` → `JSON.parse`, rejects non-object/array/null; `array` → comma-separated elements), clears `editVariableBackup` (so `hideVariableForm` doesn't re-restore), stores the variable in the chosen scope, hides the form, re-renders.

---

## Asset Management

All asset and project network/transport calls go through `js/api.js` (routing via Tauri IPC when running inside Tauri or HTTP `fetch` otherwise). In Tauri mode: `invokeTauri` wraps rejected command errors (plain `detail` strings) in `Error` objects so callers can use `err.message`; uploads are sent as a raw binary IPC body (`Uint8Array`) with percent-encoded `x-nf-name` / `x-nf-filename` / `x-nf-folder` headers; `exportProjectZip` returns `{path}` of the written zip. Command reference: `docs/backend.md` → *Rust backend*.

### `refreshAssets()`

Async. Calls `api.listAssets(state.currentProjectName)` (returns `{ tree }`). Calls `renderAssetTree()` for left panel. If Asset Explorer tab is active, also calls `renderAssetExplorer()`. Hides `#asset-section` if no assets.

### `renderAssetTree(nodes, container, parentPath)`

Recursively renders tree view into `#asset-tree`. All thumbnails (`.asset-preview`, `.ae-thumb`) are emitted with `crossorigin="anonymous"` so `nfasset://` images display under `cargo tauri dev` too. Folders show a toggle (▶) and 📁 icon. Files show thumbnail, syntax string, and delete button. Folder rows have inline "new folder" and "upload" buttons. Editor preview thumbnails resolve via `resolveEditorAssetUrl(state.currentProjectName, path)` (Tauri mode: `convertFileSrc('<proj>/assets/<path>', 'nfasset')` → `nfasset://localhost/…` on Linux/macOS, `http://nfasset.localhost/…` on Windows/Android, falling back to `nfasset://localhost/<proj>/assets/<path>` with per-segment encoding; HTTP mode: `/api/assets/<proj>/<path>`). The per-file syntax string comes from `assetSyntax(path, node.name)`.

### `assetSyntax(relPath, name)`

Exported helper. Normalizes `relPath || name` via `cleanAssetRelPath()` and returns the copyable directive with a pure relative `assets/<path>` target: `{audio: assets/<path>}` for audio files (`AUDIO_EXTS`), `{video: assets/<path>}` for video files (`VIDEO_EXTS`), or `{img: assets/<path>, alt=<name>}` (alt = name minus extension, non-alphanumeric chars → `_`) for images/other files.

### `renderAssetTreeChildren(nodes, parentPath)`

Recursive helper that returns HTML string for child nodes (used inside expandable containers). Resolves preview thumbnails via `resolveEditorAssetUrl(state.currentProjectName, path)` and directive syntax via `assetSyntax(path, node.name)`.

### `getEntriesAtPath(tree, path)`

Walks the tree array following `path.split('/')` to find folder children. Returns `[]` on missing folder.

### `renderAssetExplorer(tree)`

Entry point for Asset Explorer tab rendering. Calls `renderBreadcrumb()` and `renderAEGrid()`.

### `renderBreadcrumb(path)`

Renders clickable breadcrumb segments from `aeCurrentPath`. Each segment navigates via `aeNavigate()`.

### `renderAEGrid(entries)`

Renders grid view in `#ae-file-grid`. Folders show 📁 icon. Image files show thumbnail resolved via `resolveEditorAssetUrl(state.currentProjectName, path)` (`nfasset://` in Tauri, `/api/assets/...` in HTTP mode); other files show 📄. Displays file size. Clicking a folder navigates into it. Selection state from `aeSelectedPaths`.

### `updateAEToolbar()`

Enables/disables Rename (only when exactly 1 selected), Delete/Copy/Cut (when ≥1 selected), Paste (when clipboard has items).

### `aeNavigate(path)`

Sets `aeCurrentPath`, clears selection, calls `refreshAssets()`.

### `aeNewFolder(targetPath)`

Prompts for name, calls `api.createFolder(state.currentProjectName, folderPath)`, refreshes.

### `aeUpload(targetPath)`

Opens file picker (multi-file), uploads each via `api.uploadAsset(state.currentProjectName, file, targetPath || '')`, refreshes.

### `aeDelete(singlePath)`

Iterates all paths in `aeSelectedPaths` (or the single path), calls `api.deleteAsset(state.currentProjectName, p)` for each. Shows combined toast with total deleted count. Clears selection.

### `aeRename()`

Operates on the single selected path (no-op if 0 or >1 selected). Prompts for new name, calls `api.renameAsset(state.currentProjectName, path, newName.trim())`, refreshes.

### `aeCopy()` / `aeCut()`

Store all selected paths as `aeClipboard = {action: "copy"|"cut", paths: [...]}`.

### `aePaste()`

Iterates all clipboard paths, copies or moves each to `aeCurrentPath` via `api.copyAsset()` / `api.moveAsset()`. Clears clipboard after cut. Shows combined toast.

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

Runs BFS from the start node across choice targets, `on_enter` targets, and text-based `{redirect:slug}` targets (parsed from all nodes' text). The reserved `{redirect: back}` target is **filtered out** of the edge set — it creates no reachable node and no false edge. If no `is_start` node exists, falls back to the first non-`side_panel` slug. Nodes not visited (excluding `side_panel` and utility nodes `is_utility: true`) get `node-orphan` class (dashed orange border + dimmed). The start-node fallback is unaffected by `is_utility`.

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

Async. Requires `currentProjectName`. **Auto-saves** via `saveProjectSilent()`, then `api.exportProjectZip(name)`: in the app (Tauri) the zip is written locally (default `~/Downloads/<Project>.zip` on desktop) and a toast shows the path; in legacy HTTP mode the browser downloads `/api/export/{name}`. Shows loader.

### `previewGame()`

Async. Requires `currentProjectName`. Auto-saves via `saveProjectSilent()`, then `api.buildPreviewHtml(name)` and shows the result in the **in-app overlay** (`openGamePreview`) — no new tab, because new tabs/windows are unavailable inside the Tauri desktop/Android webview. Shows loader.

### In-app viewer (`js/viewer-overlay.js`)

`#preview-overlay` is a fullscreen dialog (`z-index: 900`, safe-area aware top bar) with a title, **↻ Restart** and **✕ Back to Editor**, plus `<iframe id="preview-frame">`.

| Function | Behaviour |
|---|---|
| `openGamePreview(projectName, data)` | Title "Playing Preview: <name>". `data.url` (HTTP backend: `/api/preview-file/<name>`) → `iframe.src`; `data.html` (Tauri) → `iframe.srcdoc`. Sandbox `allow-scripts allow-modals allow-same-origin allow-forms` (same-origin kept so the runtime's localStorage saves work — same trust level as the old new-tab preview). Restart visible. |
| `openTutorial()` | Loads `tutorial.html` unsandboxed, no Restart. Used by the toolbar Tutorial button and the editor's "Need syntax help?" link (`data-action="openTutorial"`; `setupButtonDelegation` `preventDefault()`s `<a data-action>` clicks). |
| `restartViewer()` | Removes the runtime's autosave keys (`storyeditor_autosave`, `storyeditor_save`; manual slots 1-5 kept) and reloads the frame, so the preview starts at the start node. |
| `closeViewer()` | Hides the overlay, sets the frame to `about:blank` (stops game audio / timers / live regions), restores focus. |
| `setupViewerOverlay()` | Wires the buttons and a capture-phase `Escape` handler that closes the viewer when focus is in the editor document. |

While the viewer is open (`isViewerOpen()`), `setupKeyboardShortcuts()` ignores all editor shortcuts (Delete, Ctrl+Z/Y/S, …) so they cannot act on the hidden editor.

### `saveProjectSilent()`

Async. Syncs textarea content to `nodesData`. Serializes via `_buildSavePayload(currentProjectName)` and POSTs to `/api/save`. Throws on failure.

---

## Undo/Redo System

### Global state

`MAX_UNDO = 50`, `undoStack`, `redoStack`, `undoInProgress`.

### `_captureSnapshot()`

Deep-clones `nodesData`, copies `slugToNodeId`, captures group state (`loadedGroupIds` as an array, deep-cloned `collapsedGroupsData`, and deep-cloned `groupsManifest`), and reads all node positions (`_posX`, `_posY`) plus multi-port connections (`{ sourceId, targetId, outputClass, inputClass }` across every output port in `node.outputs`) from `state.editor.drawflow.drawflow['Home'].data`.

### `snapshotState()`

Skips while `undoInProgress` or `isLoading`. Pushes the snapshot to `undoStack`, caps at 50, clears `redoStack`.

### `captureCurrentState()`

Same as `snapshotState()` but returns the snapshot instead of pushing to a stack.

### `restoreState(snap)`

Closes the passage editor, tears the canvas down silently with `editor.clear()` (also removes portal lines) and resets `portalOutputSvg` / `portalNodeIds` / `nodesData` / `slugToNodeId`, restores `state.loadedGroupIds` (as a `Set`), `state.collapsedGroupsData`, and `state.groupsManifest` (set to `null` when the snapshot had none), and rebuilds all nodes with an `oldToNewId` mapping (writing straight into `state.nodesData`): portal entries (`data.isPortal`) are recreated via `createPortalNode()`, while normal nodes are recreated via `editor.addNode()`. Restores multi-port connections using `conn.outputClass || 'output_1'` and `conn.inputClass || 'input_1'`, remaps `slugToNodeId`, and attaches collapse buttons via `_setupNodeCollapseButton()`. In a RAF: refreshes connection paths, calls `_refreshPortalOutputs()`, runs validation, re-applies start/side-panel/utility/function node classes, and re-applies the search filter.

### `undo()` / `redo()`

Pop from respective stack, push current state to the other stack, call `restoreState()`. Show toast feedback.

**Snapshot trigger points:** `addNode()`, `deleteNodeOverlay()`, `deleteCurrentNode()`, `handleLinkTargetClick()`, `removeChoiceLink()`, context-menu *Unlink Connection*, the engine's `beforeUserEdit` (drag-to-link drop, Delete on a selected edge), `updateCurrentNode()`, `collapseGroup()`, `deleteGroupFromPortal()`. Programmatic engine calls never snapshot (they are silent), so one user action produces exactly one undo step.

---

## Keyboard Shortcuts

Registered in the global `keydown` handler:

| Key | Action |
|---|---|
| `Ctrl+S` | Save. If project named, silent-save + toast. If unnamed, open save modal. Skips when typing in an input. |
| `Ctrl+Z` | Undo (skipped when an input/textarea is focused so native undo applies) |
| `Ctrl+Shift+Z` / `Ctrl+Y` | Redo |
| `Delete` / `Backspace` | Delete the selected connection if one is selected, else the selected node (only when not in input; skipped if the canvas already handled the key — `e.defaultPrevented`) |
| `Escape` | Cancel linking → clear search → close modal (when `#modal-overlay` is shown, `style.display === 'flex'`) → clear canvas selection + deselect node |

Uses `e.code` for letter keys, `e.key` for non-letter keys. Checks `e.metaKey` for Mac compatibility.

---

## Node Search / Filter

### `filterNodes(query)`

Iterates all nodes. If query matches node title or slug (case-insensitive), adds `node-search-match` class (blue glow). Non-matching nodes get `node-search-mismatch` class (opacity 0.15, pointer-events: none). Empty query clears all classes. Returns match count.

### `setupSearch()`

Registered in `DOMContentLoaded`. Calls `setupSearchSuggestions()`, then attaches the `input` event with 150ms debounce (`filterNodes`). Escape key clears the search and blurs the input.

Re-applied after project load and after undo/restore.

### Search suggestions (`js/node-search.js`)

Typing in `#node-search` opens a dropdown (`ul#node-search-suggestions.search-suggestions`, `position: fixed` and appended to `<body>` because the header clips overflow on narrow screens) with up to 8 matching passages. Each row shows the title and slug id with the match highlighted (`<mark>`, all text HTML-escaped) and a badge for groups / collapsed passages.

| Function | Behaviour |
|---|---|
| `collectSearchEntries()` | Candidates from state: loaded passages (`kind: 'node'`), each portal's group (`'group'`, by label + id), and every slug inside a collapsed / unloaded group (`'collapsed'`, title from `collapsedGroupsData` when cached) which focuses that group's portal. |
| `rankSearchSuggestions(entries, query, limit = 8)` | Pure ranking on title **and** slug, case-insensitive: exact (0) > prefix (1) > word-start after space/`_`/`-`/`.`/`:`/`/` (2) > substring (3); non-loaded entries get +0.5 so loaded passages win ties; then shorter, then alphabetical. Adds `score` and `matchIn` (`'title'` / `'slug'`). Unit-tested in `tests/suites/node_search.test.js`. |
| `focusNodeOnCanvas(nodeId)` | Switches to the Graph tab, clears the search filter, `editor.focusNode(id, { minZoom: 0.75 })` (animated centring), `editor.selectNode(id)` (opens the passage / group editor) and flashes the node (`.node-focus-flash`). |
| `setupSearchSuggestions()` | ARIA combobox wiring (`role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`; options `role="option"`). Keys: ↓/↑ move, Enter picks (first by default), Escape closes. Mouse: hover highlights, `mousedown` picks (so the input's blur doesn't close the list first). Picking clears the query. Blur closes the list; the list repositions on resize. |

Engine support (`canvas-engine.js`): `centerOn(wx, wy, { zoom, animate, duration })` centres a world point (280ms easeOutCubic via RAF; instant under `prefers-reduced-motion`; cancelled by any pointerdown / wheel), `focusNode(id, { minZoom })`, and `selectNode(id)` (dispatches `nodeUnselected` for the previous node, then `nodeSelected`).

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

**`is_function` (Spec 37).** Each node also has `is_function: bool`, toggled by the `#passage-is-fn` checkbox via `toggleFnNode()` (no exclusivity; multiple function nodes allowed, hidden for `side_panel`). When checked, the passage editor swaps the Choices + On Enter panels for a **Functions (catalogue)** pane (`#fn-section`), which renders the `{fn:}` blocks parsed in the body (`renderFnList`); an **Insert Function Block** button (`insertFnBlock`) prepends `{fn: name, arg1, arg2}\n{return: }\n{endfn}\n` at the cursor via `insertAtCursor`. `updateFnBadgeOnCanvas()` toggles a purple `node-function` left border. The flag round-trips through save/load, group collapse/load mapping, import, and `ensureNodeData` defaults. Like `is_utility`, it exempts the node from dead-end/orphan validation **and** (unlike `is_utility`) excludes it from runtime navigation — the engine registers its `{fn:}` blocks at boot and never treats the node as reachable. See the function-nodes directive section below.

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

Portal nodes (`.node-portal`) represent unloaded groups on the canvas. They have dashed borders, dimmed appearance, and per-slug I/O circles labeled with the group's slug ids. At most `MAX_PORTAL_ROWS` (30) slug rows are shown; larger groups get one extra **bucket row** (`input_31` / `output_31`, labelled "… +N more (Load Group to view)") that all hidden slugs share (`_portalPortIndex(i, total)`), so their cross-group lines still render. User links onto the bucket row are rejected. Selecting a portal opens the group editor (right sidebar) showing group name/label fields and a list of nodes in the group.

`portalOutputSvg` holds synthetic SVG curves drawn from a portal's outputs (rendered/refreshed by `_renderPortalOutputs` / `_refreshPortalOutputs` / `_positionPortalOutputLine`). Two kinds of directed lines are drawn, one per slug row:

- **Inbound** — a loaded node whose `choices` target a slug in the portal's group: line from the loaded node's `output_1` to that slug's row input (directed node → portal). Skipped when a user-drawn engine edge already connects the same node and row.
- **Outbound** — the portal's own `portalSlugIds[i].connections` (from the manifest): lines from `output_{i+1}` to the resolved targets. A target resolves to a loaded passage node via `slugToNodeId`, or to another collapsed portal's row input (`_resolvePortalTarget`). Lines are de-duplicated per row. Intra-group targets are skipped. Outbound portal connections are **read-only** — the `connectionCreated` handler still blocks portal-source links.

All portals are refreshed (`_refreshPortalOutputs`) after connection changes and after expand/collapse/delete so lines re-point to whichever nodes/portals are currently on the canvas. Each line stores its endpoints on `svg._portalRefs` as `{from, to}` = `{nodeId, port, isOutput}` descriptors; the `mouseMove` / `nodeMoved` / `nodeResized` handlers call `_repositionPortalOutputs()`, which re-routes existing lines (no DOM churn). Routing is pure math through the engine (`getPortCoords` + `positionConnectionSvg`) in world coordinates — no `getBoundingClientRect()`. Lines live inside the transformed precanvas, so pan/zoom need no repositioning.

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
| `deleteGroupFromPortal(nodeId)` | Confirms, takes an undo snapshot, removes the portal and its lines, updates the manifest, clears cached collapsed data, closes the inspector if it showed the portal, refreshes portals + validation. Also used when a portal is deleted via the overlay ✕, `Delete` key or context menu |
| `collapseGroup(groupId)` | Caches the group's full node data, removes its nodes silently (cross-group choices/markdown are untouched), creates a portal stub at the centroid, refreshes all portals + validation |
| `_setupPortalActions(nodeId)` | Adds Load / Move / Delete buttons to a portal node |
| `_setupNodeCollapseButton(nodeId)` | Adds a collapse (⬆) button to loaded nodes that belong to a group |
| `_labelPortalIO(nodeId, slugIds)` | Labels portal I/O circles with slug ids, aligns content rows |
| `_renderPortalOutputs(portalNodeId)` | Draws inbound + outbound synthetic SVG connection lines for one portal |
| `_refreshPortalOutputs()` | Re-renders portal output lines for every portal with SVG entries |
| `_portalPortIndex(i, total)` | 0-based port row for slug `i` (slugs past `MAX_PORTAL_ROWS` map to the bucket row) |
| `_resolvePortalTarget(targetSlug, currentPortalId)` | Resolves an outbound target slug → `{nodeId, port, isOutput:false}` for a loaded passage node's `input_1` or another collapsed portal's row |
| `_drawPortalOutputLine(portalNodeId, from, to)` | Creates a synthetic `svg.connection.portal-output` between two port descriptors |
| `_positionPortalOutputLine(svg, from, to)` | Routes a portal line synchronously via `editor.getPortCoords` + `editor.positionConnectionSvg` |
| `_repositionPortalOutputs()` | Re-routes all existing portal lines from their stored `svg._portalRefs` (node drag / drop / resize) |
| `_removePortalLines(portalNodeId)` / `_closeEditorsFor(nodeId)` | Internal helpers: drop a portal's lines; close the inspector if it shows a removed node/portal |

### Context menu

`setupContextMenu()` shows `#context-menu` on right-click inside `#tab-graph`:

- **Portal node:** Load Group, Move to Group, Delete Group.
- **Normal node** (not `side_panel`): Collapse Group, Delete Node.
- **Connection** (right-click, or touch long-press on an edge): *Unlink Connection* → undo snapshot + `removeSingleConnection(..., { notify: true })`.

`hideContextMenu()` hides the menu; clicks outside or Escape close it. `contextMenuTargetId` stores the right-clicked node.

### Collapse / expand lifecycle

```
collapseGroup(groupId)
  ├─ snapshotState()
  ├─ nodes = _getGroupNodeIds(groupId)        ← derived from nodesData
  ├─ collect node data + positions (nodesData + drawflow pos)
  ├─ collapsedGroupsData[groupId] = nodeData
  ├─ editor.removeNodeId() for each node (silent → cross-group choices kept);
  │   clear nodesData/slugToNodeId/loadedGroupIds
  ├─ createPortalNode({id, label, node_count, slug_ids}, centerX, centerY)
  ├─ _refreshPortalOutputs()   ← new portal + all others redraw
  └─ validateDeadEnds(); validateOrphans()

loadGroupFromPortal(portalNodeId)
  ├─ nodes = collapsedGroupsData[groupId]     ← cache consumed BEFORE the
  │           (no project name needed)          currentProjectName fetch guard
  ├─ nodes ?? fetch /api/load?groups=groupId
  │   └─ node group := node.group ?? groupId   ← the requested group is
  │      authoritative; the backend no longer injects `group:"side_panel"`
  │      into nodes that omit it, so loading a story/chapter group keeps
  │      those nodes in their own group and the group dropdown stays correct
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
  ├─ createConnectionsBatched(connections)   ← RAF-chunked, silent addConnection, synchronous drawing
  ├─ isLoading = false
  ├─ loadedGroupIds.add(groupId)
  ├─ updateConnectionNodes + start/utility/function badges for all
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
  ─ addConnection is silent; run under isLoading=true so every edge is drawn synchronously
```

### Deferred overlay injection

`injectOverlayToNode(nodeId, deferred=true)` — when `deferred` is true, the overlay (Edit/Delete/Link/Menu buttons) is only injected on first mouseenter (or immediately on `nodeSelected` for touch taps), not at node creation time. Reduces DOM work during large project loads.

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
       ├─ snapshotState()                     ← skipped if the edge already exists
       └─ editor.addConnection(sourceId, targetId, ..., { notify: true })
            └─ fires connectionCreated
                 ├─ (portal target) map port → slug, push choice, insert link
                 ├─ (portal source) alert + remove connection
                 ├─ (choice already exists) keep edge only, no duplicate
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
  ├─ editor.clear() + portalOutputSvg = {}   ← silent, no undo snapshots
  ├─ nodesData = {}, slugToNodeId = {}, groupsManifest = manifest
  ├─ first pass: editor.addNode(...) side_panel nodes
  ├─ second pass: editor.addConnection(...) for side_panel choices
  ├─ loadedGroupIds.add('side_panel')
  ├─ createPortalNode(group) for every other group  ← portals on canvas
  ├─ _refreshPortalOutputs()
  ├─ isLoading = false
  ├─ updateStartBadgeOnCanvas() for all nodes
  ├─ requestAnimationFrame → validateDeadEnds(), validateOrphans(), re-apply search
  └─ ensureSidePanelNode() + ensureSetupNode() (no-op if already on canvas)
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

**Android / touch readiness (`template.html` + `template_styles.css`):**
- Viewport `viewport-fit=cover, interactive-widget=resizes-content` (soft keyboard resizes the layout), `color-scheme: dark` (native controls, pickers and scrollbars render dark), `theme-color`.
- `#app` uses `100dvh` (fallback `100vh`) so the bottom is not hidden behind mobile browser bars; `env(safe-area-inset-*)` padding on the mobile bar, drawer, story bottom, toasts and the side insets (notch / gesture bar / Android 15 edge-to-edge).
- `#main-panel` / drawer / save modal use `overscroll-behavior: contain` (no pull-to-refresh or scroll chaining); passage text breaks long words.
- All form controls (`.nf-textfield`, `.nf-textarea`, `.nf-number`, `.nf-dropdown`) share the dark field style.
- `@media (pointer: coarse)`: 44px+ touch targets (nav, mobile bar ≥48px wide, Save/Load, New Game, slot buttons, fields), 22px checkboxes/radios, 40px radio rows. `:hover` styles live in `@media (hover: hover)` so taps don't leave sticky hover colours.
- Save/Load slots wrap their buttons under the title on phones; landscape phones (`max-height: 500px`) get trimmed padding; long toasts and dialogue names wrap.
- `_assetCorsAttr()` returns ` crossorigin="anonymous"` when `window.NF_ASSET_CORS` is set (only in the app's in-app preview, injected by the Rust `build_preview_html`); used on `{img:}` / `{video:}`, and audio tracks set `crossOrigin` the same way. Needed because WebKit won't display `nfasset://` media on an `http://` dev-server page without CORS (see `docs/backend.md` → `nfasset` protocol). Exported games are unaffected.
- `_mediaSizeStyle(o)` sizes `{img:}` / `{video:}`: both `w`+`h` → `width` + `aspect-ratio` (scales proportionally), only `h` → `object-fit: contain`.

**Mobile HUD (≤640px):** `#side-panel` becomes a slide-over drawer toggled by the sticky `#mobile-bar` (`☰ Status`, back/forward, Save / Load) via `game.toggleMobilePanel()` / `game.closeMobilePanel()` with `#side-panel-backdrop`; `#mobile-menu-btn` keeps `aria-expanded` in sync. The drawer closes automatically when `render()` moves to a *different* passage and when Save / Load opens; in-place re-renders (HUD actions, form inputs) keep it open.

### Rendering pipeline

```
render(nodeId)
  ├─ resolve() → node text (choices/on_enter merged)
  ├─ if text contains {redirect:} → run processDirectives(), fire redirect (slug) or goBack() (reserved 'back'), re-enter render()
  └─ else
       ├─ _preprocessText(text)
│    ├─ processDirectives(text)   ← directives: {set:} {print:} {if:} {while:} {do} {break} {continue} {for:} {unset:} {init} {include:} {action:} {live:} {fn:} {return:} {call:}
│    └─ strip remaining {redirect:} directives
└─ renderContent(text)
     ├─ {random:} resolved
     ├─ HTML-escape (links/images/bold/italic/headings rendered)
     ├─ {table:}/{tr:}/{td:}/{bar:} tags → <table>/<tr>/<td>/<div class="nf-bar"> (newline hygiene: open consumes 1 preceding \n, close consumes 1 following \n)
     ├─ {wait:}/{dialogue:} blocks → animated containers ({wait:} gated on _freshEntry)
     ├─ {live:} placeholder tokens (\u0000nflive_<n>\u0000) → .nf-live container divs
     ├─ {print:} placeholder tokens (\u0000nfvar_<n>\u0000) → captured values
     ├─ choice links (prerequisites evaluated → class="disabled", indices into the merged list; dynamic slugs resolved from {print:} placeholders carry no index → click falls back to target_node_id match, see L18 in docs/syntax.md)
```

`{bar: expr, max=, w=, color=, class=}` evaluates `expr` via `new Function('state','setup','helper','temp', 'return ' + _norm(expr))` at render time; fill = `value/max × 100` clamped to 0–100%. `undefined`/`null` → 0% fill; a throwing/invalid expression renders the tag literally. The table/bar tags are unknown to the walker, so they pass through `_processDirectives` untouched (both normal and render-only mode) and only expand in `renderContent` — the same behavior class as `{img:}`/`{dialogue:}`.

### Directive walker

`processDirectives(text)` is a single recursive-descent pass that resolves directives **in textual order** (a behavior change from the old pipeline, where all `{if:}` blocks were resolved before any `{set:}` ran). Each pass over a loop body re-evaluates every directive against current `state` and `temp`.

Helpers (all on the runtime `Game`/engine object):

| Helper | Role |
|---|---|
| `processDirectives(text)` | Public entry point; dispatches on each directive. |
| `_processDirectives(text, inLoop)` | Recursive body handler; returns `{ text, signal }` where `signal` is `'break'`, `'continue'`, `'fnreturn'` (from `{return:}` in a function body), or `null`. Out-of-loop `{break}`/`{continue}` render as literal text. |
| `_selectIfBranch(condText)` | Evaluates one `{if:}`/`{elseif:}` condition; returns `{ result, remaining }` — the condition truthiness and the text after that tag. |
| `_parseIfBranches(condText, body, elseText, rest, inLoop)` | Splits the block into branches (`if`/`elseif`/`else`), picks the first truthy branch, and processes it. Depth-aware scan: adjacent tags (`{if:}{if:}…{endif}{endif}`) parse because the inner `{if:}`/`{endif}` handlers advance `j` past the tag and `continue` the scan immediately (no double-advance). |
| `_runWhile(condText, body, rest, inLoop)` | 0-or-more loop. Iterates: evaluate condition → process body → propagate `break`/`continue`. Stops after **1000 iterations** (`notify("Loop limit exceeded")`). |
| `_runDoWhile(condText, body, rest, inLoop)` | 1-or-more loop. Runs the body first, then checks the `{while: condition}` tag that closes it. Same 1000-iteration cap. |
| `_runFor(init, condition, update, body)` | C-style loop. Runs `init` once via the mutation pipeline (creating the variable), then iterates `condition` → body → `update`, propagating `break`/`continue` (`{continue}` still runs the update clause; `{break}` exits before it). Same 1000-iteration cap. |
| `_findWhileEnd(text)` | Returns `{ endIndex, endLength, body, found }` — the position of the matching `{endwhile}`, else `-1`/`false`. |
| `_findDoWhileEnd(text)` | Returns `{ endIndex, endLength, body, condition, found }` — the matching `{while:...}` that closes the do-block, else `-1`/`false`. |
| `_findForEnd(text)` | Returns `{ body, init, condition, update, end }` — the matching `{endfor}` (nesting-aware, counts `{for:}`/`{endfor}` depth, skips `{do}` blocks atomically), else `null` when the header has fewer than 3 semicolon-separated clauses or the block is unclosed. |
| `_findInitEnd(text)` | Returns `{ body, end }` — the matching `{endinit}` (nesting-aware, counts `{init}`/`{endinit}` depth), else `null`. |
| `_findSetEnd(text, i)` | Brace-aware `{set:}` scanner: returns `{ expr, end }` for the `{set:` starting at `i`, counting nested `{}` and honoring string quotes, so object literals (`{set: state.o = helper.clone({a:1})}`, `{set: setup.x = [{...}]}`, braces inside strings) parse. `null` if unclosed. Only dispatched when `rest.startsWith('{set:')`. |
| `_includeCount` / `_includeLimitNotified` | Per-render-pass state: how many passages have been spliced, and whether the one-time `Include limit exceeded.` toast already fired. |
| `_includedChoices` | Accumulator of the choices merged in by `{include:}` during the current `processDirectives` pass (reset at the top of every pass). |
| `_activeChoices` | The merged choice list `render()` / `renderSidePanel()` hand to `renderContent` and `navigateTo`. |
| `_actionBlocks` | Per-render capture of raw action-block bodies, in walker encounter order (reset at the top of `render()` and in `init()`). Each rendered block pushes its body and emits `data-action-block="<index>"`. |
| `_actionBlockLinks` | Per-render array of the anchor HTML for each rendered action block (same index as `_actionBlocks`). The walker pushes the link and emits a `\u0000nfaction_<idx>\u0000` placeholder token instead of raw HTML; `renderContent` restores the anchor **after** HTML-escaping so the tag survives. |
| `_renderOnly` | Instance flag (false). When true, `_processDirectives` consumes side-effect/block directives without executing or emitting (one `console.warn` per kind, tracked in `_renderOnlyWarned`): `{set:}` (skipped via brace-aware `_findSetEnd` so object literals inside `{set:}` do not truncate early)/`{unset:}`/`{include:}`/`{audio:}`/`{redirect:}`/`{break}`/`{continue}`, `{notify:}` (consumed silently without warning), `{init}`/`{live:}`/`{action:}`/`{wait:}` blocks (skipped to their end tags), loops (`{for:}`/`{while:}`/`{do}` via `_find*End`), form tags, and `{fn:}`/`{endfn}`/`{return:}`/`{call:}`. Everything else (text, `{print:}`, `{if:}` branches, `{random:}`, media, `[text](node:slug)` links) renders normally. Guarded with try/finally and threads through `{if:}` recursion like `_inInit`. |
| `_liveRegions` | Per-render array of `{ id, interval, body }` for each rendered live region, in walker order (reset at the top of `render()` and in `init()`). |
| `_liveTimers` | Array of `setInterval` ids from `refreshLiveRegions()`; cleared at the top of `render()` and in `newGame()`/`loadGame()`. |
| `renderLiveRegion(region)` | Refreshes one region's display: query `[data-live-region="<id>"]`, run the body through `_processDirectives` in **render-only mode**, then `renderContent` the result into the element's innerHTML. |
| `refreshLiveRegions()` | Called at the end of `render()` (after `runWaitSequences()`): renders each region's display and registers one `setInterval` per region at its clamped interval. |
| `tickRegion(region)` | The interval callback: no-op when `document.hidden`; otherwise walks the body **normally** (mutations fire), honors a `{redirect:}` in the output via `_checkRedirects` — the reserved `back` target calls `goBack()`, a slug calls `render(redirect)`, else calls `_reRender()` for the full cascade. |
| `_checkRedirects(text)` | Returns `'back' \| slug \| null` — the target of the first `{redirect:...}` in `text`. The literal target `back` is a **reserved pseudo-target** (checked before the node lookup, so it wins even if a node named `back` exists) and routes to history-back navigation via `goBack()`; a target matching a node slug returns that slug; anything else returns `null`. Honored at three sites: `render()` entry (auto-back on passage entry, no autosave), `applyActionBlock()` (auto-saves then goes back), and `tickRegion()` (goes back, no autosave). `back` is **reserved** — a passage slugged `back` cannot be a `{redirect:}` target. |
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
3. Checks `_checkRedirects(out.text)` — a `{redirect: slug}` in the body navigates via `render(redirect)` (after `autoSave()`); the reserved `{redirect: back}` calls `autoSave()` then `goBack()`; the walker never strips redirects, so the body's survives to be honored here.
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

Lifecycle wiring: `render()` calls `renderSidePanel()` then `this._audio.stopUndeclared()` then `runWaitSequences()` then `refreshLiveRegions()` — the single reconcile point where declared tracks keep playing and everything else stops. `newGame()` and `loadGame()` call `this._audio.stopAll()` before re-rendering (audio state is never saved). Side-panel `{audio:}` declarations run through `renderSidePanel()` → `processDirectives`, so HUD music is re-declared every render and a passage cannot stop it. Audio inside `{if:}` branches, loops, and `{include:}` splices works (walker-processed); like `{set:}`, it does **not** run inside `{wait:}`/`{dialogue:}` bodies (handled at `renderContent` time), and is **inert** in live-region render-only passes.

### `{init}` blocks

The walker dispatches on `{init}` (6 chars) / `{endinit}` (9 chars), exactly lowercase. `render()` sets `this._freshEntry = nodeId !== this.currentNodeId || this.currentNodeId == null` at the top of a render pass (before `processDirectives`), and the side panel shares that flag (a side-panel re-render with a new main passage is fresh).

When the walker meets `{init}` at the **top level** (`!inLoop && !this._inInit`) and `this._freshEntry` is true, it runs `_processDirectives(block.body, false)` and **discards the output** — body `{set:}` mutations apply, everything else executes but contributes nothing to the text. A `try/finally` resets `this._inInit` while the body runs, so nested `{init}` blocks are found and consumed-skipped (their mutations never run). Skipped cases (not fresh, inside a loop, nested) consume the block silently. An unmatched `{init}` (no `{endinit}`) renders literally. Multiple top-level `{init}` blocks run in textual order. `loadGame()` sets `this.currentNodeId = save.currentNodeId;` **before** `this.render(save.currentNodeId);` so a startup load isn't mis-detected as a fresh entry and doesn't re-apply saved setup.

Loop conditions are JS expressions evaluated against `state` and `temp` via `_evalBool` (so `state.items.size > 0` works for arrays).

### `{for:}` blocks

The walker dispatches on `{for:}` (6 chars) / `{endfor}` (8 chars), exactly lowercase. `_findForEnd(text)` parses the header (`^\{for:\s*([^}]+)\}`), splits it on `;` into `init` / `condition` / `update` (raw JS clauses; a header with fewer than 3 clauses renders literally), and finds the matching `{endfor}` while counting nested `{for:}`/`{endfor}` and skipping `{do}` blocks atomically via `_findDoWhileEnd`. `_runFor` executes `init` once through `_evalMutation` (creating the variable, like `for (var i = 0; …)`), then loops `condition` → body → `update` with the same 1000-iteration cap. `_findDoWhileEnd` itself forwards `{for:` to `_findForEnd` so a `{for:}` first in a `{do}` body is not mistaken for its closing `{while:}`.

### `{unset:}` blocks

`{unset: state.name}` → `delete this.state[name]`; `{unset: temp.name}` → `delete this.temp[name]`; `{unset: temp}` → `this.temp = {}`. Forms that match neither (`{unset: nonsense}`) render literally. Only the exact lowercase `{unset:}` spelling dispatches.

### Expression scopes: `state` / `setup` / `helper` / `temp`

All expression evaluation funnels through three helpers that bind four scopes into the `new Function` body: `state` (`this.state`), `setup` (`this.setup`), `helper` (`this.helper`), and `temp` (`this.temp`).

- **`_evalBool(expr)`** → `!!new Function('state','setup','helper','temp','call', 'try { return ' + _norm(expr) + '; } catch(e) { return false; }')(this.state, this.setup, this.helper, this.temp, callBinding)` — false on any throw.
- **`_evalMutation(expr, notify)`** → `new Function('state','setup','helper','notify','temp','call', _norm(expr))(...)` — catches and `console.warn('Mutation failed:')` on throw.
- **`_evalValue(expr)`** → `new Function('state','setup','helper','temp','call', 'return ' + _norm(expr))(...)` — `undefined` on throw. The `call` binding is `(...r) => this._callFunction(r[0], r.slice(1))`, so `call('name', e1, e2)` is usable in any expression scope (including `{bar:}`).
- The choice-prerequisite inline eval and the `{bar:}` eval were folded onto the same scopes (`_evalBool` for prerequisites; the bar eval is inline with the four scopes plus `call`).

`_norm` rewrites `((?:state|temp|setup)\.\w+)\.size\b` → `.length` (setup holds no Maps, so the rewrite is always safe). `helper` is **not** a `{print:}` display scope and `{unset:}` only accepts `state|temp`.

### `setup` immutable constants scope

`this.setup` is built once at boot inside `init(data)` **after** nodes are loaded and **before** the first render / start-node selection: seed from `data.setup` (the editor Variables panel's `setup` scope, persisted in the manifest), then run the reserved **`setup`** node's text through `_processDirectives` (its `{set: setup.x = ...}` directives add/replace), then deep-freeze via `_freezeSetup` — a recursive `Object.freeze` wrapped in a `Proxy` whose `set`/`deleteProperty`/`defineProperty`/`setPrototypeOf` traps throw `TypeError` (`_evalMutation`'s catch turns that into a `console.warn`). Nested writes into frozen arrays/objects silently no-op in sloppy-mode evals. `this._bootSetup` is true only during that boot pass, so `{audio:}` in the setup node is skipped (walker checks `this._bootSetup`). The setup node is excluded from start-node selection (`mainNodeIds` filter excludes `side_panel` and `setup`). `setup` is never serialized into saves. Boot-time resets added to `init()`: `_varValues`, `_includeCount`, `_includeLimitNotified`, `_includedChoices`.

### `helper` scope + prototype extensions

`_installHelpers()` runs at the top of `init(data)` (guarded by `this._helpersInstalled` so re-`init`s don't reinstall) and sets `this.helper = Object.freeze({ random, either, clone, clamp, fn_exists, hasMacro, hasPassage })` — `random(min,max)` inclusive integer (1 arg → `0..max`, 0 args → throws), `either(...values)` (flattened pick, `undefined` for none), `clone(value)` (deep, realm-agnostic via `Object.prototype.toString` tags; handles Array/Date/Map/RegExp/Set/plain objects, honors a `.clone()` method, throws on unsupported types), `clamp(x,lo,hi)` = `Math.max(lo, Math.min(hi,x))`, `fn_exists(name)` (case-insensitive lookup in `_functions`), `hasMacro(name)` (alias for `fn_exists(name)`), and `hasPassage(slug)` (`_game.nodes[String(slug)] !== undefined`). It then installs (only if absent) the SugarCube 2.37.3 `Array.prototype` extensions (`first`, `last`, `count`, `countWith`, `contains`*, `concatUnique`, `toUnique`, `toShuffled`, `random`, `randomMany`, `includesAll`, `includesAny`, `append`*, `prepend`*, `delete`, `deleteAll`, `deleteAt`, `deleteFirst`, `deleteLast`, `deleteWith`, `pluck`, `pluckMany`, `pushUnique`, `unshiftUnique`, `shuffle`; * = legacy-compat extras) and `String.prototype` extensions (`toUpperFirst`, `toLocaleUpperFirst`, `first`, `last`, `count`, `contains`*, `splice`, `splitOrEmpty`). All use `Math.random`; `helper` is engine-owned and read-only.

### `temp` scratch namespace

`this.temp` is a sibling of `this.state` on the engine object; it is **never serialized** (saves serialize only `state`). `render()` discards it at the start of every fresh render (`if (this._freshEntry) this.temp = {};`), so a new passage starts clean while re-renders of the same passage (action clicks / form events pass the current `nodeId`, so `_freshEntry` is false) keep `temp` — letting an `{init}` build a `temp.items` array that the display code re-reads. `loadGame()` and `loadFromSlot()` reset `this.temp = {}` after restoring `state`. The constructor seeds `temp: {}` and the boot pass resets it before building `setup`.

### `{print:}` placeholder mechanism

Instead of a `{print:}`-focused regex pass, the walker now **snapshots** the value of each `{print:}` into `this._varValues[]` and emits a placeholder token `\u0000nfvar_<n>\u0000`. Arrays are snapshotted to their joined string (`join(', ')`) and other values via `String(...)` at capture time, so a stored token is never a live reference into `state` — later mutations (e.g. `{set: state.arr[i] += 1}` inside a loop) cannot leak back into an earlier capture. `renderContent` substitutes these tokens back **after** HTML escaping, so interpolated values that contain HTML (e.g. a variable holding `<b>text</b>`) still render as HTML — matching the pre-refactor behavior. A loop body using `{print:}` captures the value from its own iteration (not the final loop state).

The walker `{print:}` capture regex (Spec 35) accepts `state|temp|setup` prefixes with a single bracket index **and** a trailing dot-field chain (e.g. `{print: state.clients[state.dayW].name}`):
```
/\{print:?\s*((?:state|temp|setup)\.\w+(?:\[[^\]]+\])?(?:\.[A-Za-z_][\w$]*)*)\}/
```
Resolution order for the captured value:
- array → `join(', ')`;
- non-null non-array object (a `dict`) → **emit the macro text unchanged** (never `[object Object]`);
- `undefined` — or an eval error / missing parent (e.g. `state.clients` unset) — → emit macro text unchanged;
- scalar → `String(val)` snapshot.

`.size` aliasing still applies only to `(state|temp|setup)\.\w+` roots via `_norm`; `.size` after a bracket index or on a plain object is unsupported and resolves `undefined` → macro text. `_evalValue` runs `_norm(m[1])` before evaluating, so an object-root field chain is evaluated as normal JS property access.

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

**Legacy removal.** The markdown image forms `![alt](url)` and `![alt](url){img:...}` are **no longer recognized**. `renderContent` protects them at the top of the pipeline with a placeholder token (`\u0000nflegacy_<n>\u0000`, restored right before `{print:}` substitution) so they render **literally** — visibly broken text the author must convert, not a mangled link or a bogus image. The old `<img>`/`{img:}` regexes were deleted. `_rewrite_asset_urls` (`backend/main.py`) now stops its asset-URL match at `,`/`}` (`([^)"\s,}]+)`) so `{img: url, w=64}` targets and adjacent directives rewrite correctly on export/preview.

### Tables & stat bars (`{table:}`/`{tr:}`/`{td:}`/`{bar:}`)

Six display-only tags + `{bar:}` expand in `renderContent` (inserted after the choice-link block, before bold). Each tag is its own regex — no nesting matcher. Newline hygiene: `\n?\{open...\}` consumes at most one preceding newline and `\{close\}\n?` at most one following, so inter-tag newlines never become `<br>` (this runs **before** the `\n`→`<br>` conversion). The table/tr/td tags are parsed by `_parseTableOptions(params, kind)` (`kind` gates which options are honored: `center`/`border`/`cellpadding`/`cellspacing` only on `table`; `valign`/`colspan`/`rowspan` only on `td`). `_parseBarOptions(params)` splits the expression off as everything before the first comma, then reads `max=`/`w=`/`color=`/`class=`; the expression is evaluated at render time via `_evalValue`-style `new Function` and the fill is `value/max × 100` clamped to 0–100%. These tags are **not** in the walker or render-only skip list, so they pass through `_processDirectives` untouched and stay live in live-region refreshes.

### Function nodes (`{fn:}` / `{return:}` / `{call:}`)

Function catalogues (Spec 37) give authors reusable named code with parameters and a return value. A **function node** is any node with `is_function: true`; its passage text holds one or more `{fn: name, p1, p2} … {endfn}` blocks (one node = many functions). Functions are defined **at boot** and resolved globally by name across **all** function nodes.

- **Registry.** `_functions: { name: { params: string[], body: string } }`, populated once in `init(data)` right after nodes are loaded and **before** the `setup` node runs (so boot-time directives in the setup node can call `{fn:}` helpers), and still before start-node selection. `_registerFnCatalogue(text)` scans each `is_function` node's text with the header regex `/\{fn:?\s*([A-Za-z_][\w$]*)((?:,\s*[A-Za-z_][\w$]*)*)\}/i`, captures the body up to the first `{endfn}`, and records `{ params, body }`. Duplicate names → `console.warn('Function redefined, last wins: ')` and overwrite. Catalogue-node slug is irrelevant; identity is the `{fn:}` header name.
- **Navigation**: the boot filter `mainNodeIds` now also excludes nodes with `is_function` (alongside `side_panel` and `setup`), so a function node is never a start node or reachable target. The editor's `validateDeadEnds`/`validateOrphans` treat `is_function` exactly like `is_utility`.
- **`_callFunction(name, args)`** — the single invocation path shared by `{call:}` and inline `call()`. Guard: if `_fnDepth >= 50` → `notify('Function recursion limit exceeded.')` and return `undefined`. Unknown name → `console.warn('Unknown function: ')` + `undefined`. Otherwise it increments `_fnDepth`, sets `_inFn = true`, **saves** the caller's `temp`/`_fnReturn`, replaces `this.temp` with a fresh `{}`, binds params as `temp.<p> = args[p]`, resets `_fnReturn`, and runs `_processDirectives(fn.body, false)` inside a `try`, capturing `ret = this._fnReturn` **before** the `finally` restores the caller's `temp`/`_fnReturn`/`_inFn`/`_fnDepth`. Returns `ret` (the value does **not** leak the caller's stale return).
- **`{return:}`** (a directive in a body): `_processDirectives` sets `this._fnReturn = _evalValue(expr)` and returns `{ text, signal: 'fnreturn' }`. Enclosing `{include:}`/`{if:}` already propagate `r.signal`; the loop runners (`_runWhile`/`_runDoWhile`/`_runFor`) additionally return early on `r.signal === 'fnreturn'`. Runs normally anywhere in an expression scope.
- **`{call: name, e1, e2}`** — directive form. `_splitArgs` (comma-separated at depth 0, quote/`{`/`(`/`[`-aware) splits the args; `name = parts[0]`, `args = parts.slice(1).map(_evalValue)`. `_callFunction` is invoked, and a defined scalar/array return is pushed through the `\u0000nfvar_<n>\u0000` pipeline (`Array.isArray` → `join(', ')`, else `String`); `undefined` and whole objects render nothing (mirrors `{print:}` suppression). Empty body `{call: name}` → `parts = ['name']`, `args = []`.
- **Inline `call(name, e1, …)`** — a `call` binding (`(...r) => this._callFunction(r[0], r.slice(1))`) is added to **every** `new Function` expression scope (`_evalBool`, `_evalMutation`, `_evalValue`, and the `{bar:}` inline eval). It returns the **raw** function value to the enclosing expression.
- **Body semantics**: `state` mutations persist (temporary `temp` is the function-local/parameter scope, restored after). Body text output is discarded — only `{return:}` surfaces. Choices collected by a nested `{include:}` inside a body are suppressed because the include choice guard checks `!this._inFn`.
- **`_renderOnly`**: `{fn:}`/`{endfn}`/`{return:}`/`{call:}` are consumed + one-time-warned (`fn`/`return`/`call`) in render-only passes, so a function body never leaks directives into a `live` tooltip.

Test coverage: `tests/suites/fn_nodes.test.js` (registration, `{call:}` interpolation, inline `call()`, shared-state + temp isolation, early-exit, undefined/unknown returns, recursion guard, nested calls, navigation exclusion).

### Wait blocks and re-renders

The wait regex in `renderContent` (`\{wait:(\d+)(?:,\s*fade:(\d+))?\}([\s\S]*?)\{endwait\}`) now branches on `this._freshEntry`:

- **Fresh entry** (new passage, or returning to one — the same rule as `{init}`): the existing animating markup (`<div class="wait-sequence" data-duration data-fade style="opacity:0">`) is emitted and `runWaitSequences()` animates it as before.
- **Same-passage re-render** (`commit:live` keystroke, action click, live-region tick): the content is emitted **already revealed** — no `.wait-sequence` divs, so `runWaitSequences()` finds none and no-ops. `render()` already clears `_waitTimeouts`/`_tailElements` at its start.

Result: reveals happen once per entry and re-renders preserve the revealed state. A wait that *appears* via a mutation-taken `{if:}` branch shows instantly (documented tradeoff); the side panel renders wait content final-state. A `{wait:}` inside `{init}` produces nothing (init bodies are mutation-only; the walker discards their text output). Not fixed here: `{video:}` re-creates on re-render (playback restarts), `{random:}` re-rolls per render.

### `{live:}` blocks (timed regions)

The walker dispatches on `{live:` (case-insensitive, `/\{live:\s*([^}]*)\}/i`) before the `{set:}` check. It captures the body **verbatim** into `_liveRegions` (`{ id, interval, body }`), clamps the interval to a 50 ms floor, emits a `\u0000nflive_<id>\u0000` placeholder token (restored by `renderContent` **after** HTML-escaping into `<div class="nf-live" data-live-region="<id>"></div>`, same placeholder pattern as `{action:}`), and skips to `{endlive}`. An unclosed `{live:` or a non-numeric interval (`{live: fast}`) renders literally; no nesting.

**Lifecycle:** `_liveRegions`/`_liveTimers` are initialized in `init()`; `render()` resets `_liveRegions` at its start, clears `_liveTimers` (beside the `_waitTimeouts` clear), and calls `this.refreshLiveRegions()` after `runWaitSequences()`. `newGame()` and `loadGame()` also clear `_liveTimers`. `renderSidePanel()` needs no special handling — `side_panel` text runs through the same walker + render refresh, so a HUD region ticks across passage navigation (its timer is re-registered each render).

**Semantics (mutate-per-tick + full cascade):** every `N` ms `tickRegion(region)` walks the body **normally** — its `{set:}`/`{unset:}`/`{audio:}` fire exactly once — then honors a `{redirect:}` in the output (via `_checkRedirects`) or calls `_reRender()` for the full cascade. During every *render*, the end-of-render `refreshLiveRegions()` display pass runs in **render-only mode** (`_renderOnly = true` with try/finally), so a render never re-runs a region's own mutations — a passage `{set:}` followed by a render updates the region's display without re-incrementing its counters. Ticks are skipped while `document.hidden`. Region bodies are display + mutation only: `{wait:}`, `{action:}`, nested `{live:}`, form inputs, and loops are inert (loops are also inert during ticks).

---

## Performance: `updateConnectionNodes` per-frame coalescer

`app.js` wraps `editor.updateConnectionNodes` so drags and bulk edits route edges at most once per node per frame:

```
updateConnectionNodes(nodeId)
  ├─ if isLoading → origUpdate(nodeId) immediately
  └─ else
       ├─ pendingNodeIds.add(id)
       └─ if no frame scheduled: RAF → for each pending id: origUpdate(id); clear set
```

Every requested node is updated (an earlier single-pending-id throttle dropped all but the last node, leaving most edges undrawn after undo/redo). **Bypassed during `isLoading`** so that during project/group load every `addConnection` call renders its SVG path synchronously.

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

Takes an undo snapshot, then (1) removes the edge to the loaded target node with `{ notify: true }`; else (2) removes a user-drawn edge to the portal row that holds the slug; else (3) — target in an unloaded/collapsed group, or link only present in markdown — calls `stripChoiceAndLink()` directly and refreshes validation + portal lines. (Previously, unlinking a cross-group choice did nothing.)

### `stripChoiceAndLink(sourceId, slug)` (`node-editor.js`)

Removes every choice of `sourceId` targeting `slug` and its `[text](node:slug)` markdown links (slug is regex-escaped), refreshing the open editor/choices if `sourceId` is selected.
