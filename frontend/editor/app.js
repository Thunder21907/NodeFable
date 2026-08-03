// frontend/editor/app.js — ES module entrypoint
// Initializes Drawflow + CodeMirror and binds window-level handlers required
// by inline HTML attributes (onclick/onchange/onblur).

import { state } from './js/state.js';
import './js/codemirror-setup.js';
import { validateSlugOnBlur } from './js/ui-utils.js';
import { undo, redo } from './js/history.js';
import { toggleSpellcheck, insertMarkdown } from './js/codemirror-setup.js';
import { insertImage } from './js/asset-explorer.js';
import {
    toggleStartNode,
    toggleOnEnter,
    updateOnEnterField,
    saveCurrentContent
} from './js/node-editor.js';
import { changeNodeGroup, _repositionPortalOutputs } from './js/group-manager.js';
import { setupDelegation, setupKeyboardShortcuts } from './js/event-delegation.js';
import { ensureSidePanelNode, setupEditorEvents } from './js/graph-engine.js';

// Expose functions required by inline HTML event attributes (onclick, onchange, onblur).
window.toggleOnEnter = toggleOnEnter;
window.updateOnEnterField = updateOnEnterField;
window.toggleSpellcheck = toggleSpellcheck;
window.validateSlugOnBlur = validateSlugOnBlur;
window.toggleStartNode = toggleStartNode;
window.changeNodeGroup = changeNodeGroup;
window.insertMarkdown = insertMarkdown;
window.insertImage = insertImage;
window.undo = undo;
window.redo = redo;

document.addEventListener('DOMContentLoaded', () => {
    console.log("NodeFable Canvas Initialized");
    const container = document.getElementById('tab-graph');

    state.editor = new Drawflow(container);
    state.editor.start();

    // Throttle updateConnectionNodes: last-call-wins per frame
    const origUpdate = state.editor.updateConnectionNodes.bind(state.editor);
    let updatePending = null;
    state.editor.updateConnectionNodes = function (nodeId) {
        if (state.isLoading) {
            origUpdate(nodeId);
            return;
        }
        if (updatePending) cancelAnimationFrame(updatePending);
        updatePending = requestAnimationFrame(() => {
            updatePending = null;
            origUpdate(nodeId);
        });
    };

    state.editor.zoom_max = 2.0;
    state.editor.zoom_min = 0.15;
    state.editor.zoom_value = 0.05;
    state.editor.curvature = 0.3;

    console.log("Drawflow engine ready.");
    setupEditorEvents();

    // Fix: Drawflow panning fails when clicking on container gap
    // (classList[0] is "tab-content", not "drawflow"/"parent-drawflow")
    container.addEventListener('mousedown', (e) => {
        if (e.button === 0 && !state.editor.editor_selected && e.target === container) {
            state.editor.editor_selected = true;
        }
    });

    // Reposition portal output lines on zoom
    container.addEventListener('wheel', (e) => {
        if (e.ctrlKey || e.metaKey) {
            requestAnimationFrame(() => _repositionPortalOutputs());
        }
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
                if (contentEl) contentEl.innerHTML = title;
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
});
