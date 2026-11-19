// frontend/editor/app.js — ES module entrypoint
// Initializes CanvasEngine + CodeMirror and binds window-level handlers required
// by inline HTML attributes (onclick/onchange/onblur).

import { state } from './js/state.js';
import { CanvasEngine } from './js/canvas-engine.js';
import './js/codemirror-setup.js';
import { validateSlugOnBlur, toggleDrawer, closeDrawers } from './js/ui-utils.js';
import { undo, redo } from './js/history.js';
import { toggleSpellcheck, insertMarkdown } from './js/codemirror-setup.js';
import { insertImage } from './js/asset-explorer.js';
import {
    toggleStartNode,
    toggleUtilityNode,
    toggleFnNode,
    insertFnBlock,
    toggleOnEnter,
    updateOnEnterField,
    saveCurrentContent
} from './js/node-editor.js';
import { changeNodeGroup } from './js/group-manager.js';
import { setupDelegation, setupKeyboardShortcuts } from './js/event-delegation.js';
import { ensureSidePanelNode, ensureSetupNode, setupEditorEvents } from './js/graph-engine.js';

// Expose functions required by inline HTML event attributes (onclick, onchange, onblur).
window.toggleOnEnter = toggleOnEnter;
window.updateOnEnterField = updateOnEnterField;
window.toggleSpellcheck = toggleSpellcheck;
window.validateSlugOnBlur = validateSlugOnBlur;
window.toggleStartNode = toggleStartNode;
window.toggleUtilityNode = toggleUtilityNode;
window.toggleFnNode = toggleFnNode;
window.insertFnBlock = insertFnBlock;
window.changeNodeGroup = changeNodeGroup;
window.insertMarkdown = insertMarkdown;
window.insertImage = insertImage;
window.undo = undo;
window.redo = redo;

document.addEventListener('DOMContentLoaded', () => {
    console.log("NodeFable Canvas Initialized");
    const container = document.getElementById('tab-graph');

    state.editor = new CanvasEngine(container);
    state.editor.start();

    // Coalesce updateConnectionNodes per frame. Every node requested during a
    // frame is updated once in the next frame (a single shared pending id would
    // drop all but the last node, e.g. when undo re-adds many connections).
    const origUpdate = state.editor.updateConnectionNodes.bind(state.editor);
    const pendingNodeIds = new Set();
    let updateFrame = null;
    state.editor.updateConnectionNodes = function (nodeId) {
        if (state.isLoading) {
            origUpdate(nodeId);
            return;
        }
        pendingNodeIds.add(String(nodeId).replace(/^node-/, ''));
        if (updateFrame !== null) return;
        updateFrame = requestAnimationFrame(() => {
            updateFrame = null;
            const ids = Array.from(pendingNodeIds);
            pendingNodeIds.clear();
            for (const id of ids) origUpdate('node-' + id);
        });
    };

    state.editor.zoom_max = 2.0;
    state.editor.zoom_min = 0.15;
    state.editor.zoom_value = 0.05;
    state.editor.curvature = 0.3;

    console.log("Canvas engine ready.");
    setupEditorEvents();

    // Floating on-screen canvas zoom controls
    const zoomControls = document.getElementById('canvas-zoom-controls');
    if (zoomControls) {
        zoomControls.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-canvas-zoom]');
            if (!btn) return;
            const action = btn.dataset.canvasZoom;
            if (action === 'in') state.editor.zoom_in();
            else if (action === 'out') state.editor.zoom_out();
            else if (action === 'reset') state.editor.zoom_reset();
            else if (action === 'fit') state.editor.zoomToFit();
        });
    }

    // Responsive side drawers (vars & inspector) for <=1024px viewports
    const bind = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
    bind('toggle-vars-drawer', () => toggleDrawer('var-panel'));
    bind('toggle-inspector-drawer', () => toggleDrawer('sidebar'));
    bind('drawer-backdrop', closeDrawers);
    bind('close-vars-drawer', closeDrawers);
    bind('close-inspector-drawer', closeDrawers);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeDrawers();
    });

    setupDelegation();
    setupKeyboardShortcuts();

    // Initialize CodeMirror editor
    state.cmEditor = CodeMirror(document.getElementById('passage-content-editor'), {
        mode: 'nodefable',
        theme: 'material-darker',
        lineNumbers: true,
        lineWrapping: true,
        matchBrackets: true,
        viewportMargin: Infinity,
        extraKeys: {
            "Enter": "newlineAndIndentContinueMarkdownList",
            "Ctrl-Space": "autocomplete"
        },
        hintOptions: {
            hint: CodeMirror.hint.nodeFableHint,
            completeSingle: false
        }
    });

    // Auto-save content on CM change (also syncs native textarea for toggle)
    state.cmEditor.on('change', () => {
        document.getElementById('passage-content-native').value = state.cmEditor.getValue();
        if (state.selectedNodeId === null) return;
        const data = state.nodesData[state.selectedNodeId];
        if (data) {
            data.text = state.cmEditor.getValue();
        }
    });

    // Trigger autocomplete on . and : characters
    state.cmEditor.on('inputRead', (cm, change) => {
        if (change.text && change.text.length === 1) {
            const ch = change.text[0];
            if (ch === '.' || ch === ':') {
                cm.showHint({ hint: CodeMirror.hint.nodeFableHint, completeSingle: false });
            }
        }
    });

    // Auto-save content on native textarea input (spellcheck mode)
    document.getElementById('passage-content-native').addEventListener('input', () => {
        if (state.selectedNodeId === null) return;
        const data = state.nodesData[state.selectedNodeId];
        if (data) data.text = document.getElementById('passage-content-native').value;
    });

    // Auto-save title on blur and update canvas node title
    document.getElementById('passage-title').addEventListener('blur', () => {
        if (state.selectedNodeId) {
            saveCurrentContent(state.selectedNodeId);
            const title = document.getElementById('passage-title').value;
            const nodeEl = document.getElementById('node-' + state.selectedNodeId);
            if (nodeEl) {
                const contentEl = nodeEl.querySelector('.drawflow_content_node');
                if (contentEl) contentEl.textContent = title;
            }
        }
    });

    // Auto-save node ID on blur if valid
    document.getElementById('passage-id').addEventListener('blur', () => {
        if (state.selectedNodeId && validateSlugOnBlur()) {
            saveCurrentContent(state.selectedNodeId);
        }
    });

    setTimeout(ensureSidePanelNode, 100);
    setTimeout(ensureSetupNode, 100);
});
