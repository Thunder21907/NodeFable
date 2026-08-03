// frontend/editor/js/graph-engine.js
// Drawflow graph engine event handlers, node overlay injection, side panel.
import { state, getNodeSlug, ensureNodeData } from './state.js';
import { SVG_LINK, SVG_EDIT, SVG_CLOSE } from './constants.js';
import { snapshotState } from './history.js';
import { validateDeadEnds, validateOrphans } from './validation.js';
import { setEditorValue, insertAtCursor, getEditorValue } from './codemirror-setup.js';
import { openPassageEditor, closePassageEditor, renderChoices, handleLinkTargetClick, cancelLinking, getNodeTitle } from './node-editor.js';
import { _refreshPortalOutputs, _repositionPortalOutputs, _setupNodeCollapseButton } from './group-manager.js';

export function setupEditorEvents() {
    const canvasElement = document.querySelector('.drawflow');
    if (!canvasElement) {
        console.error("Canvas element not found!");
        return;
    }

    // Exit pan mode when clicking on a node (capture phase fires before Drawflow's handler)
    canvasElement.addEventListener('mousedown', (e) => {
        if (e.target.closest('.drawflow-node')) {
            state.editor.editor_selected = false;
        }
    }, true);

    // Listen for Drawflow's native node selection event (fires on mousedown)
    state.editor.on('nodeSelected', (nodeId) => {
        if (state.linkingFromId !== null) return;
        openPassageEditor(nodeId);
    });

    state.editor.on('nodeUnselected', () => {
        closePassageEditor();
    });

    // Also listen for clicks on the canvas for linking mode
    canvasElement.addEventListener('click', (e) => {
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

    // Live-reposition portal lines while nodes/portals are dragged.
    // Drawflow only dispatches `nodeMoved` on drag end, so hook the container's
    // mousemove (registered after Drawflow's own handler, so the node position
    // is already updated) and gate on Drawflow's internal `drag` flag.
    let portalReposPending = null;
    const schedulePortalRepos = () => {
        if (portalReposPending) return;
        portalReposPending = requestAnimationFrame(() => {
            portalReposPending = null;
            _repositionPortalOutputs();
        });
    };
    state.editor.container.addEventListener('mousemove', () => {
        if (state.editor.drag) schedulePortalRepos();
    });
    state.editor.on('nodeMoved', schedulePortalRepos);

    state.editor.on('nodeRemoved', (nodeId) => {
        const slug = getNodeSlug(nodeId);
        // During a group collapse the group's nodes are removed to be replaced
        // by a portal stub. Cross-group choices that target those slugs must be
        // preserved so they still render on the portal and survive save/expand.
        const preserve = slug && state.collapsingSlugs && state.collapsingSlugs.has(slug);
        if (!preserve) {
            for (const [srcIdStr, srcData] of Object.entries(state.nodesData)) {
                if (!srcData.choices) continue;
                srcData.choices = srcData.choices.filter(c => {
                    if (c.targetSlug === slug) {
                        const linkRegex = new RegExp(`\\[[^\\]]*\\]\\(node:${slug}\\)`, 'g');
                        srcData.text = (srcData.text || '').replace(linkRegex, '').replace(/\n{3,}/g, '\n\n').trim();
                        return false;
                    }
                    return true;
                });
                if (parseInt(srcIdStr) === state.selectedNodeId) {
                    setEditorValue(srcData.text);
                    renderChoices(state.selectedNodeId);
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
        if (state.isLoading) return;
        const sourceId = data.output_id;
        const targetId = data.input_id;
        const sourceData = state.nodesData[sourceId];
        const targetData = state.nodesData[targetId];

        // Handle portal as target (inbound connection — create choice targeting slug)
        if (targetData && targetData.isPortal) {
            const inputClass = data.input_class || 'input_1';
            const match = inputClass.match(/input_(\d+)/);
            if (!match) { state.editor.removeSingleConnection(sourceId, targetId, 'output_1', inputClass); return; }
            const idx = parseInt(match[1]) - 1;
            const portalSlugIds = targetData.portalSlugIds || [];
            if (idx >= portalSlugIds.length) { state.editor.removeSingleConnection(sourceId, targetId, 'output_1', inputClass); return; }
            const targetSlug = portalSlugIds[idx].slug_id;
            ensureNodeData(sourceId);
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
            state.editor.removeSingleConnection(sourceId, targetId, 'output_1', data.input_class || 'input_1');
            return;
        }

        ensureNodeData(sourceId);
        ensureNodeData(targetId);
        const targetSlug = getNodeSlug(targetId);
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

    state.editor.on('connectionRemoved', (data) => {
        snapshotState();
        const sourceId = data.output_id;
        const targetId = data.input_id;
        const targetData = state.nodesData[targetId];
        const targetSlug = targetData ? getNodeSlug(targetId) : null;
        // During a group collapse the removed node's connections are torn down so
        // the group can become a portal. Preserve cross-group choices + markdown
        // so the portal's inbound lines still render and nothing is lost on save.
        const preserve = !!(targetSlug && state.collapsingSlugs && state.collapsingSlugs.has(targetSlug));
        // Handle portal target removal: remove choice by slug
        if (targetData && targetData.isPortal) {
            if (!preserve) {
                const inputClass = data.input_class || 'input_1';
                const match = inputClass.match(/input_(\d+)/);
                if (match) {
                    const idx = parseInt(match[1]) - 1;
                    const portalSlugIds = targetData.portalSlugIds || [];
                    if (idx < portalSlugIds.length) {
                        const slug = portalSlugIds[idx].slug_id;
                        if (state.nodesData[sourceId] && state.nodesData[sourceId].choices) {
                            state.nodesData[sourceId].choices = state.nodesData[sourceId].choices.filter(c => c.targetSlug !== slug);
                        }
                        if (state.selectedNodeId === sourceId) renderChoices(sourceId);
                    }
                }
            }
            _refreshPortalOutputs();
            return;
        }
        if (!preserve) {
            if (state.nodesData[sourceId] && state.nodesData[sourceId].choices) {
                state.nodesData[sourceId].choices = state.nodesData[sourceId].choices.filter(c => c.targetSlug !== targetSlug);
            }
            // Clean up markdown link from content
            if (state.nodesData[sourceId] && targetSlug) {
                const linkRegex = new RegExp(`\\[[^\\]]*\\]\\(node:${targetSlug}\\)`, 'g');
                state.nodesData[sourceId].text = (state.nodesData[sourceId].text || '').replace(linkRegex, '').replace(/\n{3,}/g, '\n\n').trim();
                if (state.selectedNodeId === sourceId) {
                    setEditorValue(state.nodesData[sourceId].text);
                }
            }
        }
        if (state.selectedNodeId === sourceId) {
            renderChoices(sourceId);
        }
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
