# NodeFable — Frontend HTML/CSS Reference

> **File**: `frontend/editor/index.html` (574 lines)
> **Styles**: `frontend/editor/styles.css` is **empty (0 bytes)** — all styles are inlined in the `<style>` block within `index.html` (lines 12–443).
> **JS**: `frontend/editor/app.js` (loaded at line 572) contains all application logic.

---

## 1. HTML Page Structure

### 1.1 `<head>` (lines 3–11)

| Element | Purpose |
|---------|---------|
| `<meta charset="UTF-8">` | Character encoding |
| `<meta name="viewport" ...>` | Mobile viewport |
| `<title>NodeFable - Node Canvas</title>` | Page title |
| Drawflow CDN script (line 8) | `drawflow.min.js` v0.0.60 |
| Drawflow CDN stylesheet (line 9) | `drawflow.min.css` v0.0.60 |
| Google Fonts (line 11) | Inter (weights 400, 600) via `fonts.googleapis.com` |

### 1.2 `<body>` Layout

```
+-------------------------------------------------------------------+
|                             header                                |  ← grid row 1, col 1-3
+------------------+---------------------------+--------------------+
|    #var-panel    |      #editor-panel        |     #sidebar       |  ← grid row 2
|  (variables +    |  (tab-bar + tab-content)  |  (passage editor)  |
|   assets)        |                           |                    |
+------------------+---------------------------+--------------------+
   col 1 (260px)         col 2 (1fr)              col 3 (380px)
```

---

## 2. Grid Layout (`#app`, lines 37–42)

```css
#app {
    display: grid;
    grid-template-columns: var(--var-panel-width) 1fr var(--sidebar-width);
    grid-template-rows: var(--header-height) 1fr;
    height: 100vh;
}
```

### 2.1 Header (lines 44–52)

- `grid-column: 1 / span 3` — spans all 3 columns
- Contains `.logo` ("NodeFable Canvas") and `.toolbar` with action buttons (lines 450–457):

| Button | Handler | Style |
|--------|---------|-------|
| + Add Node | `addNode()` | default |
| Save Project | `showSaveModal()` | `.success` (green) |
| Load Project | `showLoadModal()` | default |
| Export Game | `exportGame()` | default |
| Preview Game | `previewGame()` | `.success` (green) |
| Tutorial | `window.open('tutorial.html')` | `background:#555` (gray) |

### 2.2 Editor Panel (`#editor-panel`, lines 491–501)

- `grid-column: 2`; layout: `flex`, `flex-direction: column`
- Contains the **tab bar** and two **tab content** panes.

### 2.3 Sidebar (`#sidebar`, lines 503–549)

- `grid-column: 3`; fixed width `--sidebar-width: 380px`
- Scrollable (`overflow-y: auto`)
- Contains the **Passage Editor** (`#inspector-panel`)

### 2.4 Variable Panel (`#var-panel`, lines 460–489)

- `grid-column: 1`; fixed width `--var-panel-width: 260px`
- Contains variable list and asset management section

---

## 3. Tab System (lines 62–122, 492–500)

### 3.1 Tab Bar (lines 62–82, 492–495)

- `.tab-bar` — dark background, bottom border
- Two `.tab-btn` elements with `data-tab` attributes: `"graph"` and `"markdown"`
- Active tab: class `.active` — white text + accent-color bottom border
- Hover: `color: #ccc`

### 3.2 Tab Contents (lines 84–122)

- `.tab-content` — `display: none` by default
- `.tab-content.active` — `display: flex; flex-direction: column`

**`#tab-graph`** (lines 94–111):
- The Drawflow canvas container
- Has `contain: layout style paint` (performance hack)
- `::before` pseudo-element draws a dot-grid background (radial-gradient, 20px spacing, `background-attachment: fixed`)
- `.drawflow` inside has `transform-origin: 0 0` (performance hack)

**`#tab-markdown`** (lines 113–122):
- Padding 20px
- Contains `<textarea id="passage-content">` (flex: 1, no resize)
- Hint text about `{variable_name}` syntax

---

## 4. Passage Editor UI (lines 504–547)

Located in `#sidebar > #inspector-panel`. Shown/hidden based on node selection.

### 4.1 Fields

| Element | ID | Description |
|---------|----|-------------|
| Title (line 510) | `passage-title` | Text input for passage title |
| Slug (line 513) | `passage-id` | Auto-generated from title; validated on blur via `validateSlugOnBlur()` |
| Error display (line 514) | `passage-id-error` | Hidden `<p>` for slug validation errors |

### 4.2 Markdown Toolbar (lines 516–525)

Class `.md-toolbar`, 8 buttons:

| Button | Markdown Wrapper | Handler | Tooltip |
|--------|------------------|---------|---------|
| **B** (bold) | `**` / `**` | `insertMarkdown('**','**')` | Bold |
| *I* (italic) | `*` / `*` | `insertMarkdown('*','*')` | Italic |
| H (heading) | `\n## ` / `` | `insertMarkdown('\n## ','')` | Heading |
| 🔗 (link) | `[` / `](url)` | `insertMarkdown('[','](url)')` | Link |
| 🖼 (image) | N/A | `insertImage()` | Image |
| • (bullet) | `\n- ` / `` | `insertMarkdown('\n- ','')` | Bullet List |
| 1. (numbered) | `\n1. ` / `` | `insertMarkdown('\n1. ','')` | Numbered List |
| ⚡ (action) | N/A | `insertAction()` | Action (variable mutation) |

### 4.3 Choices (lines 527–530)

- `#choices-list` — container for `.choice-card` elements
- `#no-choices-msg` placeholder when empty

### 4.4 Actions (lines 532–536)

- `#actions-list` — container for action cards
- Default: "No actions defined." placeholder text
- "+ Add Action" button calls `insertAction()`

### 4.5 On Enter (lines 538–541)

- `#onenter-section` — placeholder for redirect configuration
- Default: "No on-enter redirect configured."

### 4.6 Save/Delete Buttons (lines 543–546)

| Button | Handler | Class |
|--------|---------|-------|
| Save Passage | `updateCurrentNode()` | default |
| Delete Node | `deleteCurrentNode()` | `.danger` (red) |

---

## 5. Variable Management Panel (lines 460–479, plus `#var-list`)

### 5.1 Add Variable Button (line 462)

- Calls `showVariableForm()` to reveal the form

### 5.2 Variable Form (lines 464–477)

- `#var-form` — `.var-form` class, hidden by default (`display:none`)
- Fields:
  - `#var-name` — text input (placeholder: "Variable name (e.g. player_health)")
  - `#var-type` — select with options: int, float, String, bool
  - `#var-value` — text input (placeholder: "Initial value")
- Buttons:
  - "Add" / "Save Changes" → `addVariable()` (label changes when editing)
  - "Cancel" → `hideVariableForm()` (restores the variable if editing)

### 5.3 Variable List (line 479)

- `#var-list` — rendered dynamically with `.var-item` elements
- Each item shows: `.var-item-content` (clickable — name, type, value) and `.var-actions` (delete button)
- Clicking `.var-item-content` → `editVariable(name)` — removes the variable, pre-fills the form, changes button to "Save Changes"
- Clicking the delete button → `deleteVariable(name)` — immediate removal without form

---

## 6. Asset Management Section (lines 481–488)

- `#asset-section` — hidden by default (`display:none`)
- Header with title "Assets" and ↻ refresh button (`loadAssetList()`)
- Hint text: "Click to copy markdown syntax"
- `#asset-list` — populated with `.asset-item` elements
- Each `.asset-item` contains:
  - `.asset-preview` — 28×28 image thumbnail (`object-fit: cover`)
  - `.asset-syntax` — monospace syntax text for copying

---

## 7. Modal System (lines 552–570)

### 7.1 Modal Overlay (line 552)

- `#modal-overlay` — `.modal-overlay` class, fixed position, semitransparent black background (`rgba(0,0,0,0.6)`)

### 7.2 Save Modal (lines 553–561)

- `#save-modal` — `.modal` class
- Input: `#save-name-input` (project name)
- Save list: `#save-list` — populated with `.save-item` elements
- Actions: "Save" (`.success`, `confirmSave()`) and "Cancel" (`closeModal()`)

### 7.3 Load Modal (lines 562–569)

- `#load-modal` — `.modal` class
- Load list: `#load-list` — populated with `.save-item` elements
- Actions: "Load" (`.success`, `confirmLoad()`) and "Cancel" (`closeModal()`)

---

## 8. CSS Custom Properties (`:root` variables, lines 13–25)

| Variable | Value | Purpose |
|----------|-------|---------|
| `--sidebar-width` | `380px` | Right sidebar (passage editor) width |
| `--var-panel-width` | `260px` | Left panel (variables/assets) width |
| `--header-height` | `50px` | Top header bar height |
| `--bg-color` | `#1e1e1e` | Main page background (dark) |
| `--panel-color` | `#2d2d2d` | Panel/sidebar background |
| `--border-color` | `#444` | Borders throughout UI |
| `--text-color` | `#eee` | Default text color |
| `--accent-color` | `#3498db` | Blue accent (buttons, active tabs) |
| `--success-color` | `#27ae60` | Green for save/preview buttons |
| `--danger-color` | `#e74c3c` | Red for delete/danger buttons |
| `--choice-bg` | `#353535` | Choice/action card background |

---

## 9. CSS Details by Section

### 9.1 Base Styles (lines 27–35)

- `body, html`: reset margins/padding, full height, Inter font, no overflow
- Background and text use `--bg-color` / `--text-color`

### 9.2 Typography (lines 166–167)

- `h2`: 1.1rem, no top margin
- `h3`: 0.95rem, `#ccc` color, with top/bottom margins

### 9.3 Form Elements (lines 169–180)

- `label`: uppercase, 0.8rem, `#aaa`, `letter-spacing: 0.5px`
- `input`, `textarea`, `select`: full width, `#3d3d3d` background, `--border-color` border, 8px padding, white text, `box-sizing: border-box`

### 9.4 Buttons (lines 148–162)

- Default: `--accent-color` background, white text, 8px/16px padding, 4px radius, 600 weight
- `.success`: `--success-color` background
- `.danger`: `--danger-color` background
- Hover: `opacity: 0.9`

### 9.5 Choice Cards (lines 259–296)

- `.choice-card`: `--choice-bg`, border, 12px padding, 10px margin-bottom
- Nested `input` and `label` with reduced sizes
- `.choice-target`: success-color, 600 weight — shows linked node name
- `.choice-header`: flex row with delete button
- `.choice-link-text`: left-accent-bordered block showing parsed link text with `<em>` for linked node
- `.action-link-text`: similar but green-left-bordered, monospace, with `text-overflow: ellipsis`

### 9.6 Pair Cards (lines 310–329)

- `.pair-card`: darker (`#1e1e1e`), for action key-value pairs
- `.pair-header`: flex row, header-style label

### 9.7 Node Overlay (lines 331–351)

- `.node-overlay`: absolute positioned above nodes (top: -35px), hidden by default
- Visible on `.drawflow-node:hover` (line 349–351)
- Contains small buttons (2px/6px padding, 0.7rem, 45px min-width)

### 9.8 Linking Mode (lines 353–362)

- `body.is-linking`: `cursor: copy`
- `.drawflow-node` in linking mode: `outline: 2px dashed #f39c12`, `cursor: crosshair`
- Node overlays hidden in linking mode

### 9.9 Drawflow Canvas (line 364)

- `.drawflow .df_canvas`: transparent background (override for dark theme)

### 9.10 Markdown Toolbar (lines 366–384)

- `.md-toolbar`: flex row, 4px gap
- `.md-btn`: `#3d3d3d` background, `#ccc` text, rounded, hover becomes lighter

### 9.11 Modal Styles (lines 386–442)

- `.modal-overlay`: fixed fullscreen, `rgba(0,0,0,0.6)`, centered flex
- `.modal`: `--panel-color` background, 8px radius, 24px padding, 400–500px width, 70vh max-height, flex column
- `.save-list`: scrollable, bordered, 100–300px height
- `.save-item`: flex row with `space-between`, hover highlight, `.selected` gets accent background
- `.mtime`: lighter timestamp text
- `.modal-actions`: flex row, `justify-content: flex-end`
- `.modal-empty`: centered gray placeholder text

### 9.12 Variable Items (lines 182–203)

- `.var-list`: 8px top margin
- `.var-item`: flex row, `--choice-bg`, 6px margin-bottom
- `.var-name`: 600 weight
- `.var-type`: `#888`, 0.75rem
- `.var-value`: `#4ec9b0` (teal/green)
- `.var-actions`: flex row, tiny buttons (2px/8px padding, 0.7rem)

### 9.13 Asset Items (lines 204–245)

- `.asset-section`: top border separator, 16px padding
- `.asset-header`: flex row with title + refresh button
- `.asset-item`: flex row, clickable, border highlight on hover
- `.asset-preview`: 28×28 thumbnail
- `.asset-syntax`: `#4ec9b0` teal, `Courier New` monospace

---

## 10. Performance Hacks

| Hack | Location | Lines | Purpose |
|------|----------|-------|---------|
| `transform-origin: 0 0` | `#tab-graph .drawflow` | 108 | Avoids sub-pixel rendering issues during zoom/pan |
| `contain: layout style paint` | `#tab-graph` | 96 | Limits browser layout/style/paint recalc to the graph container only |
| Grid `::before` with `background-attachment: fixed` | `#tab-graph::before` | 98–106 | Dot-grid background repaints independently of scroll, reducing paint cost |

---

## 11. Inline JavaScript / Global `onclick` Handlers

All button handlers are global functions defined in `app.js`, referenced via HTML `onclick` attributes:

| Attribute | Handler | Location |
|-----------|---------|----------|
| `onclick="addNode()"` | Add Node button | Line 451 |
| `onclick="showSaveModal()"` | Save Project | Line 452 |
| `onclick="showLoadModal()"` | Load Project | Line 453 |
| `onclick="exportGame()"` | Export Game | Line 454 |
| `onclick="previewGame()"` | Preview Game | Line 455 |
| `onclick="window.open('tutorial.html', '_blank')"` | Tutorial | Line 456 |
| `onclick="showVariableForm()"` | + Add Variable | Line 462 |
| `onclick="addVariable()"` | Variable form Add | Line 474 |
| `onclick="hideVariableForm()"` | Variable form Cancel | Line 475 |
| `onclick="loadAssetList()"` | Refresh assets | Line 484 |
| `onclick="validateSlugOnBlur()"` | Slug input blur | Line 513 |
| `onclick="insertMarkdown('**','**')"` | Bold button | Line 517 |
| `onclick="insertMarkdown('*','*')"` | Italic button | Line 518 |
| `onclick="insertMarkdown('\n## ','')"` | Heading button | Line 519 |
| `onclick="insertMarkdown('[','](url)')"` | Link button | Line 520 |
| `onclick="insertImage()"` | Image button | Line 521 |
| `onclick="insertMarkdown('\n- ','')"` | Bullet List | Line 522 |
| `onclick="insertMarkdown('\n1. ','')"` | Numbered List | Line 523 |
| `onclick="insertAction()"` | Action button / + Add Action | Lines 524, 536 |
| `onclick="updateCurrentNode()"` | Save Passage | Line 544 |
| `onclick="deleteCurrentNode()"` | Delete Node | Line 545 |
| `onclick="confirmSave()"` | Save modal confirm | Line 558 |
| `onclick="closeModal()"` | Save/Load cancel | Lines 559, 568 |
| `onclick="confirmLoad()"` | Load modal confirm | Line 567 |

---

## 12. Line Number Reference for Key Sections

| Section | Lines |
|---------|-------|
| `<head>` (meta, CDN, fonts) | 3–11 |
| `:root` CSS custom properties | 13–25 |
| `#app` grid layout | 37–42 |
| Header | 44–52, 448–458 |
| `#editor-panel` (main area) | 54–60, 491–501 |
| Tab bar | 62–82, 492–495 |
| Tab content (graph + markdown) | 84–122 |
| Graph tab (drawflow canvas + performance hacks) | 94–111 |
| Markdown tab | 113–122 |
| `#sidebar` (passage editor) | 124–131, 503–549 |
| `#var-panel` (variables + assets) | 133–141, 460–489 |
| Buttons (base styles) | 148–162 |
| Form elements (input, textarea, select) | 169–180 |
| Variable list items (`.var-item`) | 182–203 |
| Asset items (`.asset-item`) | 204–245 |
| Variable form (`.var-form`) | 247–257 |
| Choice cards | 259–296 |
| Action link text | 297–309 |
| Pair cards | 310–329 |
| Node overlay buttons | 331–351 |
| Linking mode (`body.is-linking`) | 353–362 |
| Markdown toolbar | 366–384 |
| Modal system (overlay, save, load) | 386–442, 552–570 |
| Save/load list items | 409–430 |
| Passage editor fields | 504–547 |
| Inline script tag (app.js) | 572 |
