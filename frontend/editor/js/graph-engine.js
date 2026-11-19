// frontend/editor/js/graph-engine.js
// CanvasEngine event handlers, node overlay injection, side panel.
//
// The engine only dispatches connectionCreated / connectionRemoved / nodeRemoved
// for user intents (see canvas-engine.js), so these handlers never run during
// project loads, group collapse/expand or undo/redo.
import { state, getNodeSlug, ensureNodeData } from './state.js';
import { SVG_LINK, SVG_EDIT, SVG_CLOSE, MAX_PORTAL_ROWS } from './constants.js';
import { snapshotState } from './history.js';
import { validateDeadEnds, validateOrphans } from './validation.js';
import { setEditorValue, insertAtCursor, getEditorValue } from './codemirror-setup.js';
import { openPassageEditor, closePassageEditor, renderChoices, handleLinkTargetClick, cancelLinking, getNodeTitle, stripChoiceAndLink } from './node-editor.js';
import { _refreshPortalOutputs, _repositionPortalOutputs, _setupNodeCollapseButton } from './group-manager.js';
import { showToast, escapeRegex, isDrawerLayout, openDrawer } from './ui-utils.js';

// Toggle-off for a link that already existed as a choice (e.g. a cross-group
// link drawn as a portal line): drop the edge that was just created, then the
// choice and its markdown link. The undo snapshot was taken by the caller.
function _unlinkExisting(sourceId, targetId, data, targetSlug) {
    state.editor.removeSingleConnection(sourceId, targetId, data.output_class || 'output_1', data.input_class || 'input_1');
    stripChoiceAndLink(sourceId, targetSlug);
    validateDeadEnds();
    validateOrphans();
    _refreshPortalOutputs();
    showToast('Link removed');
}

// Slug a node input port stands for: a portal slug row, or the node's slug.
// Returns null for the portal "+N more" bucket row (not a single slug).
function _slugForInputPort(nodeId, inputClass) {
    const data = state.nodesData[nodeId];
    if (!data) return null;
    if (!data.isPortal) return getNodeSlug(nodeId);
    const m = String(inputClass || 'input_1').match(/input_(\d+)/);
    const idx = m ? parseInt(m[1]) - 1 : -1;
    const slugs = data.portalSlugIds || [];
    if (idx < 0 || idx >= slugs.length) return null;
    if (slugs.length > MAX_PORTAL_ROWS && idx >= MAX_PORTAL_ROWS) return null;
    const entry = slugs[idx];
    return typeof entry === 'string' ? entry : entry.slug_id;
}

export function setupEditorEvents() {
    const canvasElement = document.querySelector('.drawflow');
    if (!canvasElement) {
        console.error("Canvas element not found!");
        return;
    }

    // User-intent mutations performed by the engine itself (drag-to-link,
    // Delete on a selected edge) announce themselves first so undo can
    // capture the pre-change state.
    state.editor.on('beforeUserEdit', () => snapshotState());

    // Listen for node selection event (fires on mousedown/touchstart)
    state.editor.on('nodeSelected', (nodeId) => {
        if (state.linkingFromId !== null) return;
        injectOverlayToNode(nodeId, false);
        openPassageEditor(nodeId);
    });

    // On drawer layouts (≤1024px) a tap on a node opens the Inspector drawer.
    // `nodeTapped` only fires for a press + release without movement, so
    // dragging a node never covers the canvas. Linking-mode taps are targets.
    state.editor.on('nodeTapped', () => {
        if (state.linkingFromId !== null || !isDrawerLayout()) return;
        openDrawer('sidebar');
    });

    state.editor.on('nodeUnselected', () => {
        closePassageEditor();
    });

    // Also listen for clicks on the canvas for overlay menu/edit and linking mode
    canvasElement.addEventListener('click', (e) => {
        const overlayBtn = e.target.closest('[data-overlay-action]');
        if (overlayBtn) {
            const action = overlayBtn.dataset.overlayAction;
            const nodeEl = overlayBtn.closest('[data-id]');
            if (action === 'menu' && nodeEl) {
                e.stopPropagation();
                nodeEl.dispatchEvent(new MouseEvent('contextmenu', {
                    bubbles: true,
                    cancelable: true,
                    clientX: e.clientX,
                    clientY: e.clientY
                }));
                return;
            }
            if (action === 'edit' && isDrawerLayout()) openDrawer('sidebar');
            return;
        }
        if (e.target.closest('.node-overlay')) return;

        const nodeElement = e.target.closest('.drawflow-node');
        if (!nodeElement) {
            closePassageEditor();
            return;
        }

        const nodeId = parseInt(nodeElement.getAttribute('data-id'));
        if (isNaN(nodeId)) return;

        if (state.linkingFromId !== null) {
            const inputEl = e.target.closest('.input');
            const inputName = inputEl ? Array.from(inputEl.classList).find(c => c.startsWith('input_')) || 'input_1' : null;
            handleLinkTargetClick(nodeId, inputName);
            return;
        }
    });

    canvasElement.addEventListener('dblclick', (e) => {
        const nodeElement = e.target.closest('.drawflow-node');
        if (!nodeElement) return;
        const nodeId = parseInt(nodeElement.getAttribute('data-id'));
        if (isNaN(nodeId)) return;
        openPassageEditor(nodeId);
        document.querySelector('.tab-btn[data-tab="markdown"]').click();
    });

    state.editor.on('nodeCreated', (nodeId) => {
        injectOverlayToNode(nodeId, true);
    });

    // Live-reposition portal lines while nodes/portals are dragged or resized.
    let portalReposPending = null;
    const schedulePortalRepos = () => {
        if (portalReposPending) return;
        portalReposPending = requestAnimationFrame(() => {
            portalReposPending = null;
            _repositionPortalOutputs();
        });
    };
    state.editor.on('mouseMove', schedulePortalRepos);
    state.editor.on('nodeMoved', schedulePortalRepos);
    state.editor.on('nodeResized', schedulePortalRepos);

    state.editor.on('nodeRemoved', (nodeId) => {
        // User deleted a node: drop every choice/link that pointed at it.
        const slug = getNodeSlug(nodeId);
        if (slug) {
            for (const [srcIdStr, srcData] of Object.entries(state.nodesData)) {
                if (parseInt(srcIdStr) === nodeId) continue;
                if (srcData.choices && srcData.choices.some(c => c.targetSlug === slug)) {
                    stripChoiceAndLink(parseInt(srcIdStr), slug);
                }
            }
        }
        delete state.nodesData[nodeId];
        if (slug) delete state.slugToNodeId[slug];
        if (state.selectedNodeId === nodeId) closePassageEditor();
        validateDeadEnds();
        validateOrphans();
        _refreshPortalOutputs();
    });

    state.editor.on('connectionCreated', (data) => {
        const sourceId = data.output_id;
        const targetId = data.input_id;
        const sourceData = state.nodesData[sourceId];
        const targetData = state.nodesData[targetId];

        // Handle portal as target (inbound connection — create choice targeting slug)
        if (targetData && targetData.isPortal) {
            const inputClass = data.input_class || 'input_1';
            const match = inputClass.match(/input_(\d+)/);
            if (!match) { state.editor.removeSingleConnection(sourceId, targetId, data.output_class || 'output_1', inputClass); return; }
            const idx = parseInt(match[1]) - 1;
            const portalSlugIds = targetData.portalSlugIds || [];
            // Rows past MAX_PORTAL_ROWS are folded into one "+N more" bucket row,
            // which does not identify a single slug.
            const isBucket = portalSlugIds.length > MAX_PORTAL_ROWS && idx >= MAX_PORTAL_ROWS;
            if (idx >= portalSlugIds.length || isBucket) {
                state.editor.removeSingleConnection(sourceId, targetId, data.output_class || 'output_1', inputClass);
                if (isBucket) showToast('Load the group to link to one of its hidden passages');
                return;
            }
            const entry = portalSlugIds[idx];
            const targetSlug = typeof entry === 'string' ? entry : entry.slug_id;
            ensureNodeData(sourceId);
            if (state.nodesData[sourceId].choices.some(c => c.targetSlug === targetSlug)) {
                // Re-linking an existing link toggles it off.
                _unlinkExisting(sourceId, targetId, data, targetSlug);
                return;
            }
            state.nodesData[sourceId].choices.push({
                targetSlug: targetSlug,
                text: '',
                prerequisite: '',
                mutation: ''
            });
            // Insert markdown link
            const linkMarkdown = `[${targetSlug}](node:${targetSlug})`;
            if (state.selectedNodeId === sourceId) {
                insertAtCursor(linkMarkdown);
                state.nodesData[sourceId].text = getEditorValue();
            } else {
                const sep = state.nodesData[sourceId].text ? '\n' : '';
                state.nodesData[sourceId].text += sep + linkMarkdown;
            }
            if (state.selectedNodeId === sourceId) renderChoices(sourceId);
            validateDeadEnds();
            validateOrphans();
            _refreshPortalOutputs();
            return;
        }

        // Handle portal as source (outbound — blocked, read-only)
        if (sourceData && sourceData.isPortal) {
            alert('Outbound connections from a portal are read-only. Load the group to edit connections.');
            state.editor.removeSingleConnection(sourceId, targetId, data.output_class || 'output_1', data.input_class || 'input_1');
            return;
        }

        ensureNodeData(sourceId);
        ensureNodeData(targetId);
        const targetSlug = getNodeSlug(targetId);
        if (state.nodesData[sourceId].choices.some(c => c.targetSlug === targetSlug)) {
            // Re-linking an existing link toggles it off.
            _unlinkExisting(sourceId, targetId, data, targetSlug);
            return;
        }
        const choice = {
            targetSlug: targetSlug,
            text: '',
            prerequisite: '',
            mutation: '',
            connectionId: data.connection_id
        };
        state.nodesData[sourceId].choices.push(choice);

        // Insert markdown link into passage content
        const targetTitle = getNodeTitle(targetId);
        const linkMarkdown = `[${targetTitle}](node:${targetSlug})`;
        if (state.selectedNodeId === sourceId) {
            insertAtCursor(linkMarkdown);
            state.nodesData[sourceId].text = getEditorValue();
        } else {
            const sep = state.nodesData[sourceId].text ? '\n' : '';
            state.nodesData[sourceId].text += sep + linkMarkdown;
        }

        console.log(`Choice added: Node ${sourceId}('${getNodeSlug(sourceId)}') -> Node ${targetId}('${targetSlug}')`);
        if (state.selectedNodeId === sourceId) {
            renderChoices(sourceId);
        }
        validateDeadEnds();
        validateOrphans();
        _refreshPortalOutputs();
    });

    // A link was unplugged from one input and plugged into another: retarget
    // the existing choice and its markdown link (keeping text, prerequisite
    // and mutation) instead of deleting and recreating it.
    state.editor.on('connectionRewired', (d) => {
        const sourceId = d.output_id;
        const src = state.nodesData[sourceId];
        const oldSlug = _slugForInputPort(d.from.input_id, d.from.input_class);
        const newSlug = _slugForInputPort(d.to.input_id, d.to.input_class);
        if (!src || !newSlug) {
            // Not a single passage (e.g. a portal's "+N more" row): put it back.
            state.editor.removeSingleConnection(sourceId, d.to.input_id, d.output_class, d.to.input_class);
            state.editor.addConnection(sourceId, d.from.input_id, d.output_class, d.from.input_class);
            showToast('Load the group to link to one of its hidden passages');
            return;
        }
        src.choices = src.choices || [];
        if (oldSlug && src.choices.some(c => c.targetSlug === newSlug)) {
            // Already linked to the new target: the moved link merges into it.
            stripChoiceAndLink(sourceId, oldSlug);
        } else {
            const choice = oldSlug ? src.choices.find(c => c.targetSlug === oldSlug) : null;
            if (choice) {
                choice.targetSlug = newSlug;
            } else {
                src.choices.push({ targetSlug: newSlug, text: '', prerequisite: '', mutation: '' });
            }
            const text = src.text || '';
            const oldLink = oldSlug
                ? new RegExp(`(\\[[^\\]]*\\]\\(node:)${escapeRegex(oldSlug)}(\\))`, 'g')
                : null;
            if (oldLink && oldLink.test(text)) {
                src.text = text.replace(oldLink, `$1${newSlug}$2`);
            } else {
                const targetData = state.nodesData[d.to.input_id];
                const label = targetData && !targetData.isPortal ? getNodeTitle(d.to.input_id) : newSlug;
                src.text = text + (text ? '\n' : '') + `[${label}](node:${newSlug})`;
            }
            if (state.selectedNodeId === sourceId) {
                setEditorValue(src.text);
                renderChoices(sourceId);
            }
        }
        validateDeadEnds();
        validateOrphans();
        _refreshPortalOutputs();
        showToast('Link moved');
    });

    state.editor.on('connectionRemoved', (data) => {
        // User unlinked an edge (undo snapshot was taken by the caller or via
        // `beforeUserEdit`): remove the choice and its markdown link.
        const sourceId = data.output_id;
        const targetId = data.input_id;
        const targetData = state.nodesData[targetId];
        let targetSlug = null;
        if (targetData && targetData.isPortal) {
            const match = (data.input_class || 'input_1').match(/input_(\d+)/);
            const idx = match ? parseInt(match[1]) - 1 : -1;
            const entry = (targetData.portalSlugIds || [])[idx];
            targetSlug = entry ? (typeof entry === 'string' ? entry : entry.slug_id) : null;
        } else if (targetData) {
            targetSlug = getNodeSlug(targetId);
        }
        if (targetSlug) stripChoiceAndLink(sourceId, targetSlug);
        if (state.selectedNodeId === sourceId) renderChoices(sourceId);
        showToast('Link removed');
        validateDeadEnds();
        validateOrphans();
        _refreshPortalOutputs();
    });

    document.querySelectorAll('.drawflow-node').forEach(node => {
        const nodeId = parseInt(node.getAttribute('data-id'));
        injectOverlayToNode(nodeId, true);
        _setupNodeCollapseButton(nodeId);
    });
}

export function injectOverlayToNode(nodeId, deferred) {
    const nodeElement = document.querySelector(`[data-id="${nodeId}"]`);
    if (!nodeElement || nodeElement.querySelector('.node-overlay')) return;

    if (deferred) {
        // Deferred overlay: add on first hover or selection
        const addOverlay = () => {
            if (nodeElement.querySelector('.node-overlay')) return;
            _createOverlay(nodeElement, nodeId);
            nodeElement.removeEventListener('mouseenter', addOverlay);
        };
        nodeElement.addEventListener('mouseenter', addOverlay);
    } else {
        _createOverlay(nodeElement, nodeId);
    }
}

function _createOverlay(nodeElement, nodeId) {
    const overlay = document.createElement('div');
    overlay.classList.add('node-overlay');
    const isPortal = !!(state.nodesData[nodeId] && state.nodesData[nodeId].isPortal);
    overlay.innerHTML = `
        <button data-overlay-action="edit" title="Edit">${SVG_EDIT}</button>
        <button data-overlay-action="delete" class="danger" title="Delete">${SVG_CLOSE}</button>
        ${isPortal ? '' : `<button data-overlay-action="link" class="success" title="Link">${SVG_LINK}</button>`}
        <button data-overlay-action="menu" title="More actions" aria-label="More actions">&#8943;</button>
    `;
    nodeElement.appendChild(overlay);
}

export function ensureSidePanelNode() {
    const existingId = state.slugToNodeId['side_panel'];
    if (existingId !== undefined) {
        const el = document.getElementById('node-' + existingId);
        if (el) el.classList.add('node-side-panel');
        return;
    }
    try {
        const nodeId = state.editor.addNode('story_node', 1, 1, 20, 20, 'story_node', {}, 'Side Panel');
        state.nodesData[nodeId] = { title: 'Side Panel', text: '', choices: [], slug: 'side_panel', is_start: false, is_utility: false, group: 'side_panel' };
        state.slugToNodeId['side_panel'] = nodeId;
        const el = document.getElementById('node-' + nodeId);
        if (el) el.classList.add('node-side-panel');
        console.log('Auto-created Side Panel node:', nodeId);
    } catch (err) {
        console.error('Failed to create Side Panel node:', err);
    }
}

export function ensureSetupNode() {
    if (state.slugToNodeId['setup'] !== undefined) return;
    try {
        const nodeId = state.editor.addNode('story_node', 1, 1, 360, 20, 'story_node', {}, 'Setup');
        state.nodesData[nodeId] = { title: 'Setup', text: '', choices: [], slug: 'setup', is_start: false, is_utility: true, group: 'side_panel' };
        state.slugToNodeId['setup'] = nodeId;
        console.log('Auto-created Setup node:', nodeId);
    } catch (err) {
        console.error('Failed to create Setup node:', err);
    }
}
