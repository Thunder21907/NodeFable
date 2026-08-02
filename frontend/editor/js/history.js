// frontend/editor/js/history.js
import { state } from './state.js';
import { showToast } from './ui-utils.js';
import { validateDeadEnds, validateOrphans } from './validation.js';
import { MAX_UNDO } from './constants.js';
import { closePassageEditor } from './node-editor.js';
import { filterNodes } from './event-delegation.js';

export function _captureSnapshot() {
    const snap = {
        nodesData: JSON.parse(JSON.stringify(state.nodesData)),
        slugToNodeId: { ...state.slugToNodeId },
        connections: []
    };
    const dfData = state.editor && state.editor.drawflow && state.editor.drawflow.drawflow && state.editor.drawflow.drawflow['Home'] ? state.editor.drawflow.drawflow['Home'].data : null;
    if (dfData) {
        for (const nodeIdStr in dfData) {
            const node = dfData[nodeIdStr];
            if (node) {
                snap.nodesData[nodeIdStr] = snap.nodesData[nodeIdStr] || {};
                snap.nodesData[nodeIdStr]._posX = node.pos_x;
                snap.nodesData[nodeIdStr]._posY = node.pos_y;
            }
            if (node && node.outputs && node.outputs['output_1']) {
                for (const conn of node.outputs['output_1'].connections) {
                    snap.connections.push({ sourceId: parseInt(nodeIdStr), targetId: conn.node });
                }
            }
        }
    }
    return snap;
}

export function snapshotState() {
    if (state.undoInProgress || state.isLoading) return;
    const snap = _captureSnapshot();
    state.undoStack.push(snap);
    if (state.undoStack.length > MAX_UNDO) {
        state.undoStack.shift();
    }
    state.redoStack = [];
}

export function captureCurrentState() {
    return _captureSnapshot();
}

export function restoreState(snap) {
    state.undoInProgress = true;
    closePassageEditor();
    for (const idStr of Object.keys(state.nodesData)) {
        const el = document.getElementById('node-' + idStr);
        if (el) state.editor.removeNodeId('node-' + idStr);
    }
    const oldToNewId = {};
    const newNodesData = {};
    for (const oldIdStr in snap.nodesData) {
        const data = snap.nodesData[oldIdStr];
        const posX = data._posX || (Math.floor(Math.random() * 400) + 50);
        const posY = data._posY || (Math.floor(Math.random() * 300) + 50);
        const title = data.title || 'Untitled';
        const newId = state.editor.addNode('story_node', 1, 1, posX, posY, 'story_node', {}, title);
        oldToNewId[oldIdStr] = newId;
        const { _posX, _posY, ...cleanData } = data;
        newNodesData[newId] = cleanData;
    }
    for (const conn of snap.connections) {
        const newSource = oldToNewId[conn.sourceId];
        const newTarget = oldToNewId[conn.targetId];
        if (newSource !== undefined && newTarget !== undefined) {
            state.editor.addConnection(newSource, newTarget, 'output_1', 'input_1');
        }
    }
    state.nodesData = newNodesData;
    state.slugToNodeId = {};
    for (const [slug, oldId] of Object.entries(snap.slugToNodeId)) {
        state.slugToNodeId[slug] = oldToNewId[oldId] !== undefined ? oldToNewId[oldId] : oldId;
    }
    state.undoInProgress = false;
    requestAnimationFrame(() => {
        // Refresh connection paths after layout settles
        for (const idStr of Object.keys(state.nodesData)) {
            state.editor.updateConnectionNodes('node-' + idStr);
        }
        validateDeadEnds();
        validateOrphans();
        for (const [idStr, data] of Object.entries(state.nodesData)) {
            const el = document.getElementById('node-' + idStr);
            if (!el) continue;
            el.classList.toggle('node-start', !!data.is_start);
            el.classList.toggle('node-side-panel', data.slug === 'side_panel');
        }
        const searchInput = document.getElementById('node-search');
        if (searchInput && searchInput.value) {
            filterNodes(searchInput.value);
        }
    });
}

export function undo() {
    if (state.undoStack.length === 0) {
        showToast('Nothing to undo');
        return;
    }
    const currentSnap = captureCurrentState();
    state.redoStack.push(currentSnap);
    const snap = state.undoStack.pop();
    restoreState(snap);
    showToast('Undo');
}

export function redo() {
    if (state.redoStack.length === 0) {
        showToast('Nothing to redo');
        return;
    }
    const currentSnap = captureCurrentState();
    state.undoStack.push(currentSnap);
    const snap = state.redoStack.pop();
    restoreState(snap);
    showToast('Redo');
}
