// frontend/editor/js/history.js
import { state } from './state.js';
import { showToast } from './ui-utils.js';
import { validateDeadEnds, validateOrphans } from './validation.js';
import { MAX_UNDO } from './constants.js';
import { closePassageEditor } from './node-editor.js';
import { filterNodes } from './event-delegation.js';
import { createPortalNode, _refreshPortalOutputs, _setupNodeCollapseButton } from './group-manager.js';

export function _captureSnapshot() {
    const snap = {
        nodesData: JSON.parse(JSON.stringify(state.nodesData)),
        slugToNodeId: { ...state.slugToNodeId },
        connections: [],
        loadedGroupIds: Array.from(state.loadedGroupIds || []),
        collapsedGroupsData: JSON.parse(JSON.stringify(state.collapsedGroupsData || {})),
        groupsManifest: state.groupsManifest ? JSON.parse(JSON.stringify(state.groupsManifest)) : null
    };
    const dfData = state.editor && state.editor.drawflow && state.editor.drawflow.drawflow && state.editor.drawflow.drawflow['Home'] ? state.editor.drawflow.drawflow['Home'].data : null;
    if (dfData) {
        for (const nodeIdStr in dfData) {
            const node = dfData[nodeIdStr];
            if (node) {
                snap.nodesData[nodeIdStr] = snap.nodesData[nodeIdStr] || {};
                snap.nodesData[nodeIdStr]._posX = node.pos_x;
                snap.nodesData[nodeIdStr]._posY = node.pos_y;
                for (const [outClass, outObj] of Object.entries(node.outputs || {})) {
                    for (const conn of (outObj && outObj.connections) || []) {
                        snap.connections.push({
                            sourceId: parseInt(nodeIdStr, 10),
                            targetId: parseInt(conn.node, 10),
                            outputClass: outClass,
                            inputClass: conn.output || 'input_1'
                        });
                    }
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

    // Silent teardown: the engine's programmatic API dispatches no
    // connectionRemoved/nodeRemoved, so no handler mutates passage data here.
    state.editor.clear();
    state.portalOutputSvg = {};
    state.portalNodeIds = {};
    state.nodesData = {};
    state.slugToNodeId = {};

    state.loadedGroupIds = new Set(snap.loadedGroupIds || ['side_panel']);
    state.collapsedGroupsData = JSON.parse(JSON.stringify(snap.collapsedGroupsData || {}));
    state.groupsManifest = snap.groupsManifest ? JSON.parse(JSON.stringify(snap.groupsManifest)) : null;

    const oldToNewId = {};
    for (const oldIdStr in snap.nodesData) {
        const data = snap.nodesData[oldIdStr];
        const posX = data._posX !== undefined ? data._posX : (Math.floor(Math.random() * 400) + 50);
        const posY = data._posY !== undefined ? data._posY : (Math.floor(Math.random() * 300) + 50);
        const { _posX, _posY, ...cleanData } = data;
        if (data.isPortal) {
            const newId = createPortalNode(
                {
                    id: data.portalGroupId,
                    label: data.portalGroupLabel,
                    node_count: data.portalNodeCount,
                    slug_ids: data.portalSlugIds || []
                },
                posX,
                posY
            );
            // createPortalNode registers state.nodesData[newId] itself.
            oldToNewId[oldIdStr] = newId;
        } else {
            const newId = state.editor.addNode('story_node', 1, 1, posX, posY, 'story_node', {}, data.title || 'Untitled');
            oldToNewId[oldIdStr] = newId;
            state.nodesData[newId] = cleanData;
        }
    }
    for (const conn of snap.connections) {
        const newSource = oldToNewId[conn.sourceId];
        const newTarget = oldToNewId[conn.targetId];
        if (newSource !== undefined && newTarget !== undefined && newSource !== null && newTarget !== null) {
            state.editor.addConnection(newSource, newTarget, conn.outputClass || 'output_1', conn.inputClass || 'input_1');
        }
    }
    for (const [slug, oldId] of Object.entries(snap.slugToNodeId || {})) {
        const newId = oldToNewId[oldId];
        if (newId !== undefined && newId !== null) state.slugToNodeId[slug] = newId;
    }
    for (const [idStr, data] of Object.entries(state.nodesData)) {
        if (!data.isPortal) {
            _setupNodeCollapseButton(parseInt(idStr, 10));
        }
    }
    state.undoInProgress = false;
    requestAnimationFrame(() => {
        // Refresh connection paths after layout settles
        for (const idStr of Object.keys(state.nodesData)) {
            state.editor.updateConnectionNodes('node-' + idStr);
        }
        _refreshPortalOutputs();
        validateDeadEnds();
        validateOrphans();
        for (const [idStr, data] of Object.entries(state.nodesData)) {
            const el = document.getElementById('node-' + idStr);
            if (!el) continue;
            el.classList.toggle('node-start', !!data.is_start);
            el.classList.toggle('node-side-panel', data.slug === 'side_panel');
            el.classList.toggle('node-utility', !!data.is_utility);
            el.classList.toggle('node-function', !!data.is_function);
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
