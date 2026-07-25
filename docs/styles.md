# CSS Architecture

## `styles.css`

`frontend/editor/styles.css` is a 0-byte placeholder. **All styles are inlined** in a `<style>` block inside `frontend/editor/index.html:12–443`.

---

## CSS Custom Properties (`:root`)

Defined at `index.html:13-25`:

| Variable | Value | Purpose |
|---|---|---|
| `--sidebar-width` | `380px` | Right inspector sidebar width |
| `--var-panel-width` | `260px` | Left variable panel width |
| `--header-height` | `50px` | Top toolbar height |
| `--bg-color` | `#1e1e1e` | Main canvas background |
| `--panel-color` | `#2d2d2d` | Sidebar/panel background |
| `--border-color` | `#444` | Borders and dividers |
| `--text-color` | `#eee` | Default text |
| `--accent-color` | `#3498db` | Primary accent (blue) |
| `--success-color` | `#27ae60` | Green (save, preview, confirm) |
| `--danger-color` | `#e74c3c` | Red (delete) |
| `--choice-bg` | `#353535` | Choice-card and var-item background |

---

## Grid Layout System (`#app`)

`index.html:37-42` — three-column + header row:

```
grid-template-columns: var(--var-panel-width) 1fr var(--sidebar-width)
grid-template-rows:    var(--header-height) 1fr
```

| Area | Grid Placement |
|---|---|
| `header` | `1 / span 3` (full-width top bar) |
| `#var-panel` | Column 1 (left) |
| `#editor-panel` | Column 2 (center) |
| `#sidebar` | Column 3 (right) |

---

## Tab System

`index.html:62-92` — two-tab layout (Graph / Markdown).

- `.tab-bar` — flex row, `#111` background.
- `.tab-btn` — transparent button, `#888` idle, `#fff` + `var(--accent-color)` bottom border when `.active`.
- `.tab-content` — `display: none` by default; `.active` sets `display: flex` with `flex-direction: column`.

---

## Drawflow Canvas (Graph Tab)

`index.html:94-111`:

- `#tab-graph` — `contain: layout style paint` (performance isolation).
- `#tab-graph::before` — grid dot background via `radial-gradient(#333 1px, transparent 1px)` with `background-attachment: fixed`. Pseudo-element covers entire tab, pointer-events disabled.
- `#tab-graph .drawflow` — `transform-origin: 0 0` (performance — avoids sub-pixel repositioning on zoom/pan). Z-index 1 to sit above the grid.
- `.drawflow .df_canvas` — forced `background-color: transparent !important` (so the pseudo-element grid shows through).

---

## Node Overlay Buttons

`index.html:332-351`:

- `.node-overlay` — absolutely positioned above the node (`top: -35px`, `left: 50%`, `translateX(-50%)`).
- Hidden by default (`display: none`), shown on `.drawflow-node:hover .node-overlay`.
- Small pill buttons (`0.7rem`, 45px min-width).

---

## Linking Mode

`index.html:353-362`:

- `body.is-linking` — cursor becomes `copy`.
- `.drawflow-node` inside gets a dashed orange (`#f39c12`) outline and `crosshair` cursor.
- Node overlays are hidden (`!important`) during linking.

---

## Passage Editor (Sidebar Inspector)

`index.html:259-329`:

- **Choice cards** (`.choice-card`): dark background (`var(--choice-bg)`), bordered, padded.
  - `.choice-link-text`: left blue accent border, muted text, shows rendered link.
  - `.choice-target`: green label for the target node slug.
- **Action cards** similar but with `.action-link-text` — green left border, monospace font, text-overflow ellipsis.
- **Pair cards** (`.pair-card`): `#1e1e1e` background, compact padding, used for on-enter redirects.

---

## Variable Panel

`index.html:182-258`:

- `.var-list` — simple flex column.
- `.var-item` — choice-bg card with `space-between` layout.
  - `.var-name` (bold), `.var-type` (gray `0.75rem`), `.var-value` (teal `#4ec9b0`).
- `.var-form` — collapsible form in a card, `.form-row` uses flex with equal children.

---

## Asset Section

`index.html:204-245`:

- `.asset-section` — top-border separated, below variable list.
- `.asset-item` — compact card (`.choice-bg`), hover highlights border with accent color.
  - `.asset-preview` — 28×28 thumbnail, `object-fit: cover`.
  - `.asset-syntax` — monospace, teal `#4ec9b0`.

---

## Markdown Toolbar

`index.html:366-384`:

- `.md-toolbar` — flex row with `4px` gap.
- `.md-btn` — dark button (`#3d3d3d`), hover brightens to `#555`/`#fff`.

---

## Modal Overlay & Save/Load Lists

`index.html:387-442`:

- `.modal-overlay` — fixed fullscreen, semi-transparent black (`rgba(0,0,0,0.6)`), centered flex.
- `.modal` — dark panel card, `400–500px` wide, `70vh` max-height, flex column.
- `.save-list` — scrollable bordered list.
- `.save-item` — flex row, hover highlights, `.selected` gets accent-color background.
  - `.mtime` — gray timestamp.
- `.modal-empty` — centered placeholder text.

---

## Responsive Considerations

None. The layout is fixed at three columns with pixel-defined sidebar widths. No media queries or fluid sizing.

---

## Button Color Scheme

- **Default**: `var(--accent-color)` (`#3498db`, blue).
- **`.success`**: `var(--success-color)` (`#27ae60`, green) — used for Save, Preview, Load confirm.
- **`.danger`**: `var(--danger-color)` (`#e74c3c`, red) — used for Delete Node.
- All buttons: `opacity: 0.9` on hover.

---

## Dark Theme

The entire UI is dark-themed with no light-mode alternative:

| Element | Color |
|---|---|
| Page background (`--bg-color`) | `#1e1e1e` |
| Panels (`--panel-color`) | `#2d2d2d` |
| Header | `#111` |
| Borders (`--border-color`) | `#444` |
| Inputs / textareas | `#3d3d3d` background, white text |
| Drawflow grid dots | `#333` on `#1e1e1e` |
| Choice/pair cards | `#353535` / `#1e1e1e` |
| Variable values, asset syntax | `#4ec9b0` (teal) |
