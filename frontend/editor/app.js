// frontend/editor/app.js

let editor;
let selectedNodeId = null;
let linkingFromId = null;
let nodesData = {};
let slugToNodeId = {};
let variables = {};
let isEditingVariable = false;
let editVariableBackup = null;
let isLoading = false;
let currentProjectName = null;
let loaderCount = 0;
let toastTimeout = null;
let searchDebounceTimer = null;
const MAX_UNDO = 50;
let undoStack = [];
let redoStack = [];
let undoInProgress = false;

// SVG icon markup constants (use currentColor for CSS inheritance)
const SVG_LINK = '<svg viewBox="0 0 16 16" fill="currentColor" width="1em" height="1em"><path d="M7.05025 1.53553C8.03344 0.552348 9.36692 0 10.7574 0C13.6528 0 16 2.34721 16 5.24264C16 6.63308 15.4477 7.96656 14.4645 8.94975L12.4142 11L11 9.58579L13.0503 7.53553C13.6584 6.92742 14 6.10264 14 5.24264C14 3.45178 12.5482 2 10.7574 2C9.89736 2 9.07258 2.34163 8.46447 2.94975L6.41421 5L5 3.58579L7.05025 1.53553Z"/><path d="M7.53553 13.0503L9.58579 11L11 12.4142L8.94975 14.4645C7.96656 15.4477 6.63308 16 5.24264 16C2.34721 16 0 13.6528 0 10.7574C0 9.36693 0.552347 8.03344 1.53553 7.05025L3.58579 5L5 6.41421L2.94975 8.46447C2.34163 9.07258 2 9.89736 2 10.7574C2 12.5482 3.45178 14 5.24264 14C6.10264 14 6.92742 13.6584 7.53553 13.0503Z"/><path d="M5.70711 11.7071L11.7071 5.70711L10.2929 4.29289L4.29289 10.2929L5.70711 11.7071Z"/></svg>';
const SVG_EDIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="1em" height="1em"><path d="M18.3785 8.44975L8.9636 17.8648C8.6844 18.144 8.3288 18.3343 7.94161 18.4117L4.99988 19.0001L5.58823 16.0583C5.66566 15.6711 5.85597 15.3155 6.13517 15.0363L15.5501 5.62132M18.3785 8.44975L19.7927 7.03553C20.1832 6.64501 20.1832 6.01184 19.7927 5.62132L18.3785 4.20711C17.988 3.81658 17.3548 3.81658 16.9643 4.20711L15.5501 5.62132M18.3785 8.44975L15.5501 5.62132"/></svg>';
const SVG_CLOSE = '<svg viewBox="0 0 8 8" fill="currentColor" width="1em" height="1em"><polygon points="5.6,3.5 8,5.6 6.4,7 4,4.9 1.6,7 0,5.6 2.4,3.5 0,1.4 1.6,0 4,2.1 6.4,0 8,1.4"/></svg>';

function showLoader(msg) {
    loaderCount++;
    if (loaderCount === 1) {
        const overlay = document.getElementById('loader-overlay');
        const text = document.getElementById('loader-text');
        if (text) text.textContent = msg || 'Loading...';
        if (overlay) overlay.style.display = 'flex';
    }
}

function hideLoader() {
    loaderCount = Math.max(0, loaderCount - 1);
    if (loaderCount === 0) {
        const overlay = document.getElementById('loader-overlay');
        if (overlay) overlay.style.display = 'none';
    }
}

function showToast(msg) {
    const existing = document.getElementById('toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.id = 'toast';
    toast.textContent = msg;
    document.body.appendChild(toast);
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
        toast.classList.add('hidden');
        setTimeout(() => toast.remove(), 300);
    }, 2000);
}

function _captureSnapshot() {
    const snap = {
        nodesData: JSON.parse(JSON.stringify(nodesData)),
        slugToNodeId: { ...slugToNodeId },
        connections: []
    };
    const dfData = editor && editor.drawflow && editor.drawflow.drawflow && editor.drawflow.drawflow['Home'] ? editor.drawflow.drawflow['Home'].data : null;
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

function snapshotState() {
    if (undoInProgress || isLoading) return;
    const snap = _captureSnapshot();
    undoStack.push(snap);
    if (undoStack.length > MAX_UNDO) {
        undoStack.shift();
    }
    redoStack = [];
}

function captureCurrentState() {
    return _captureSnapshot();
}

function restoreState(snap) {
    undoInProgress = true;
    closePassageEditor();
    for (const idStr of Object.keys(nodesData)) {
        const el = document.getElementById('node-' + idStr);
        if (el) editor.removeNodeId('node-' + idStr);
    }
    const oldToNewId = {};
    const newNodesData = {};
    for (const oldIdStr in snap.nodesData) {
        const data = snap.nodesData[oldIdStr];
        const posX = data._posX || (Math.floor(Math.random() * 400) + 50);
        const posY = data._posY || (Math.floor(Math.random() * 300) + 50);
        const title = data.title || 'Untitled';
        const newId = editor.addNode('story_node', 1, 1, posX, posY, 'story_node', {}, title);
        oldToNewId[oldIdStr] = newId;
        const { _posX, _posY, ...cleanData } = data;
        newNodesData[newId] = cleanData;
    }
    for (const conn of snap.connections) {
        const newSource = oldToNewId[conn.sourceId];
        const newTarget = oldToNewId[conn.targetId];
        if (newSource !== undefined && newTarget !== undefined) {
            editor.addConnection(newSource, newTarget, 'output_1', 'input_1');
        }
    }
    nodesData = newNodesData;
    slugToNodeId = {};
    for (const [slug, oldId] of Object.entries(snap.slugToNodeId)) {
        slugToNodeId[slug] = oldToNewId[oldId] !== undefined ? oldToNewId[oldId] : oldId;
    }
    undoInProgress = false;
    if (typeof validateDeadEnds === 'function') {
        requestAnimationFrame(() => {
            // Refresh connection paths after layout settles
            for (const idStr of Object.keys(nodesData)) {
                editor.updateConnectionNodes('node-' + idStr);
            }
            validateDeadEnds();
            if (typeof validateOrphans === 'function') validateOrphans();
            for (const [idStr, data] of Object.entries(nodesData)) {
                const el = document.getElementById('node-' + idStr);
                if (!el) continue;
                el.classList.toggle('node-start', !!data.is_start);
                el.classList.toggle('node-side-panel', data.slug === 'side_panel');
            }
            const searchInput = document.getElementById('node-search');
            if (searchInput && searchInput.value && typeof filterNodes === 'function') {
                filterNodes(searchInput.value);
            }
        });
    }
}

function undo() {
    if (undoStack.length === 0) {
        showToast('Nothing to undo');
        return;
    }
    const currentSnap = captureCurrentState();
    redoStack.push(currentSnap);
    const snap = undoStack.pop();
    restoreState(snap);
    showToast('Undo');
}

function redo() {
    if (redoStack.length === 0) {
        showToast('Nothing to redo');
        return;
    }
    const currentSnap = captureCurrentState();
    undoStack.push(currentSnap);
    const snap = redoStack.pop();
    restoreState(snap);
    showToast('Redo');
}

document.addEventListener('DOMContentLoaded', () => {
    console.log("NodeFable Canvas Initialized");
    const container = document.getElementById('tab-graph');

    editor = new Drawflow(container);
    editor.start();

    // Throttle updateConnectionNodes: last-call-wins per frame
    const origUpdate = editor.updateConnectionNodes.bind(editor);
    let updatePending = null;
    editor.updateConnectionNodes = function (nodeId) {
        if (isLoading) {
            origUpdate(nodeId);
            return;
        }
        if (updatePending) cancelAnimationFrame(updatePending);
        updatePending = requestAnimationFrame(() => {
            updatePending = null;
            origUpdate(nodeId);
        });
    };

    editor.zoom_max = 2.0;
    editor.zoom_min = 0.15;
    editor.zoom_value = 0.05;
    editor.curvature = 0.3;

    console.log("Drawflow engine ready.");
    setupEditorEvents();

    // Fix: Drawflow panning fails when clicking on container gap
    // (classList[0] is "tab-content", not "drawflow"/"parent-drawflow")
    container.addEventListener('mousedown', (e) => {
        if (e.button === 0 && !editor.editor_selected && e.target === container) {
            editor.editor_selected = true;
        }
    });

    setupTabs();
    setupModalEvents();
    setupEditorDelegation();
    setupAssetDelegation();
    setupVariableDelegation();
    setupNodeOverlayDelegation();
    setupButtonDelegation();
    setupSearch();

    // Auto-save content on textarea blur
    document.getElementById('passage-content').addEventListener('blur', () => {
        if (selectedNodeId === null) return;
        const ta = document.getElementById('passage-content');
        const data = nodesData[selectedNodeId];
        if (data && ta.value !== data.text) {
            data.text = ta.value;
        }
    });

    document.addEventListener('keydown', (e) => {
        const tag = e.target.tagName;
        const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable;
        const modKey = e.ctrlKey || e.metaKey;

        // Ctrl+Z — Undo (skip when editing text — let browser handle native undo)
        if (modKey && e.code === 'KeyZ' && !e.shiftKey) {
            if (isInput) return;
            e.preventDefault();
            if (typeof undo === 'function') undo();
            return;
        }

        // Ctrl+Shift+Z or Ctrl+Y — Redo (skip when editing text)
        if (modKey && (e.code === 'KeyY' || (e.code === 'KeyZ' && e.shiftKey))) {
            if (isInput) return;
            e.preventDefault();
            if (typeof redo === 'function') redo();
            return;
        }

        // Ctrl+S — Save
        if (modKey && e.code === 'KeyS' && !e.shiftKey) {
            e.preventDefault();
            if (selectedNodeId !== null) {
                const ta = document.getElementById('passage-content');
                if (ta && nodesData[selectedNodeId]) nodesData[selectedNodeId].text = ta.value;
            }
            if (!currentProjectName) {
                showSaveModal();
            } else {
                saveProjectSilent().then(() => {
                    showToast('Saved!');
                }).catch(err => {
                    alert('Save failed: ' + err.message);
                });
            }
            return;
        }

        // Delete / Backspace — Delete selected node (only when not in input)
        if ((e.key === 'Delete' || e.key === 'Backspace') && !isInput) {
            if (e.key === 'Backspace') e.preventDefault();
            deleteCurrentNode();
            return;
        }

        // Escape — Cancel linking, close modals, deselect, clear search
        if (e.key === 'Escape') {
            if (linkingFromId !== null) {
                cancelLinking();
                return;
            }
            const searchInput = document.getElementById('node-search');
            if (searchInput && document.activeElement === searchInput) {
                searchInput.value = '';
                if (typeof filterNodes === 'function') filterNodes('');
                searchInput.blur();
                return;
            }
            const modalOverlay = document.getElementById('modal-overlay');
            if (modalOverlay.style.display !== 'none') {
                closeModal();
                return;
            }
            if (selectedNodeId !== null) {
                editor.editor_selected = false;
                closePassageEditor();
                if (document.activeElement) document.activeElement.blur();
                return;
            }
            return;
        }
    });

    setTimeout(ensureSidePanelNode, 100);
});

function setupEditorEvents() {
    const canvasElement = document.querySelector('.drawflow');
    if (!canvasElement) {
        console.error("Canvas element not found!");
        return;
    }

    // Exit pan mode when clicking on a node (capture phase fires before Drawflow's handler)
    canvasElement.addEventListener('mousedown', (e) => {
        if (e.target.closest('.drawflow-node')) {
            editor.editor_selected = false;
        }
    }, true);

    // Listen for Drawflow's native node selection event (fires on mousedown)
    editor.on('nodeSelected', (nodeId) => {
        if (linkingFromId !== null) return;
        openPassageEditor(nodeId);
    });

    editor.on('nodeUnselected', () => {
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

        if (linkingFromId !== null) {
            handleLinkTargetClick(nodeId);
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

    editor.on('nodeCreated', (nodeId) => {
        injectOverlayToNode(nodeId);
    });

    editor.on('nodeRemoved', (nodeId) => {
        const slug = getNodeSlug(nodeId);
        for (const [srcIdStr, srcData] of Object.entries(nodesData)) {
            if (!srcData.choices) continue;
            srcData.choices = srcData.choices.filter(c => {
                if (c.targetSlug === slug) {
                    const linkRegex = new RegExp(`\\[[^\\]]*\\]\\(node:${slug}\\)`, 'g');
                    srcData.text = (srcData.text || '').replace(linkRegex, '').replace(/\n{3,}/g, '\n\n').trim();
                    return false;
                }
                return true;
            });
            if (parseInt(srcIdStr) === selectedNodeId) {
                document.getElementById('passage-content').value = srcData.text;
                renderChoices(selectedNodeId);
            }
        }
        delete nodesData[nodeId];
        if (slug) delete slugToNodeId[slug];
        if (selectedNodeId === nodeId) closePassageEditor();
        validateDeadEnds();
        validateOrphans();
    });

    editor.on('connectionCreated', (data) => {
        if (isLoading) return;
        const sourceId = data.output_id;
        const targetId = data.input_id;
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
        nodesData[sourceId].choices.push(choice);

        // Insert markdown link into passage content
        const targetTitle = getNodeTitle(targetId);
        const linkMarkdown = `[${targetTitle}](node:${targetSlug})`;
        if (selectedNodeId === sourceId) {
            const ta = document.getElementById('passage-content');
            const start = ta.selectionStart;
            const end = ta.selectionEnd;
            ta.value = ta.value.substring(0, start) + linkMarkdown + ta.value.substring(end);
            ta.focus();
            ta.selectionStart = ta.selectionEnd = start + linkMarkdown.length;
            nodesData[sourceId].text = ta.value;
        } else {
            const sep = nodesData[sourceId].text ? '\n' : '';
            nodesData[sourceId].text += sep + linkMarkdown;
        }

        console.log(`Choice added: Node ${sourceId}('${getNodeSlug(sourceId)}') -> Node ${targetId}('${targetSlug}')`);
        if (selectedNodeId === sourceId) {
            renderChoices(sourceId);
        }
        validateDeadEnds();
        validateOrphans();
    });

    editor.on('connectionRemoved', (data) => {
        snapshotState();
        const sourceId = data.output_id;
        const targetId = data.input_id;
        const targetSlug = nodesData[targetId] ? getNodeSlug(targetId) : null;
        if (nodesData[sourceId] && nodesData[sourceId].choices) {
            nodesData[sourceId].choices = nodesData[sourceId].choices.filter(c => c.targetSlug !== targetSlug);
        }
        // Clean up markdown link from content
        if (nodesData[sourceId] && targetSlug) {
            const linkRegex = new RegExp(`\\[[^\\]]*\\]\\(node:${targetSlug}\\)`, 'g');
            nodesData[sourceId].text = (nodesData[sourceId].text || '').replace(linkRegex, '').replace(/\n{3,}/g, '\n\n').trim();
            if (selectedNodeId === sourceId) {
                document.getElementById('passage-content').value = nodesData[sourceId].text;
            }
        }
        if (selectedNodeId === sourceId) {
            renderChoices(sourceId);
        }
        validateDeadEnds();
        validateOrphans();
    });

    document.querySelectorAll('.drawflow-node').forEach(node => {
        const nodeId = parseInt(node.getAttribute('data-id'));
        injectOverlayToNode(nodeId);
    });
}

function setupTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            const tabId = btn.getAttribute('data-tab');
            document.getElementById('tab-' + tabId).classList.add('active');
        });
    });
}

function slugify(text) {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'unnamed';
}

function generateUniqueSlug(baseSlug) {
    let slug = baseSlug;
    let counter = 1;
    while (slugToNodeId[slug] !== undefined) {
        counter++;
        slug = baseSlug + '_' + counter;
    }
    return slug;
}

function getNodeSlug(nodeId) {
    return nodesData[nodeId] ? nodesData[nodeId].slug : null;
}

function getNodeIdBySlug(slug) {
    return slugToNodeId[slug] || null;
}

function getNodeTitleBySlug(slug) {
    const nodeId = slugToNodeId[slug];
    if (nodeId && nodesData[nodeId] && nodesData[nodeId].title) {
        return nodesData[nodeId].title;
    }
    return slug;
}

function ensureNodeData(nodeId) {
    if (!nodesData[nodeId]) {
        const title = 'Node ' + nodeId;
        nodesData[nodeId] = { title: title, text: '', choices: [], slug: generateUniqueSlug(slugify(title)), is_start: false };
        slugToNodeId[nodesData[nodeId].slug] = nodeId;
    }
    if (!nodesData[nodeId].choices) {
        nodesData[nodeId].choices = [];
    }
    if (!nodesData[nodeId].actions) {
        nodesData[nodeId].actions = [];
    }
    if (nodesData[nodeId].on_enter === undefined) {
        nodesData[nodeId].on_enter = null;
    }
    if (!nodesData[nodeId].slug) {
        nodesData[nodeId].slug = generateUniqueSlug(slugify(nodesData[nodeId].title || 'Node ' + nodeId));
        slugToNodeId[nodesData[nodeId].slug] = nodeId;
    }
    if (nodesData[nodeId].is_start === undefined) {
        nodesData[nodeId].is_start = false;
    }
}

function injectOverlayToNode(nodeId) {
    const nodeElement = document.querySelector(`[data-id="${nodeId}"]`);
    if (!nodeElement || nodeElement.querySelector('.node-overlay')) return;

    const overlay = document.createElement('div');
    overlay.classList.add('node-overlay');
    overlay.innerHTML = `
        <button data-overlay-action="edit" title="Edit">${SVG_EDIT}</button>
        <button data-overlay-action="delete" class="danger" title="Delete">${SVG_CLOSE}</button>
        <button data-overlay-action="link" class="success" title="Link">${SVG_LINK}</button>
    `;
    nodeElement.appendChild(overlay);
}

function addNode() {
    snapshotState();
    try {
        const posX = Math.floor(Math.random() * 400) + 50;
        const posY = Math.floor(Math.random() * 300) + 50;
        const nodeId = editor.addNode(
            'story_node',
            1,
            1,
            posX,
            posY,
            'story_node',
            {},
            'New Node'
        );
        const slug = generateUniqueSlug('new_node');
        nodesData[nodeId] = { title: 'New Node', text: '', choices: [], slug: slug, is_start: false };
        slugToNodeId[slug] = nodeId;
        console.log("Created new node:", nodeId, "slug:", slug);
        openPassageEditor(nodeId);
    } catch (err) {
        console.error("Failed to create node:", err);
    }
}

function ensureSidePanelNode() {
    const existingId = slugToNodeId['side_panel'];
    if (existingId !== undefined) {
        const el = document.getElementById('node-' + existingId);
        if (el) el.classList.add('node-side-panel');
        return;
    }
    try {
        const nodeId = editor.addNode('story_node', 1, 1, 20, 20, 'story_node', {}, 'Side Panel');
        nodesData[nodeId] = { title: 'Side Panel', text: '', choices: [], slug: 'side_panel', is_start: false };
        slugToNodeId['side_panel'] = nodeId;
        const el = document.getElementById('node-' + nodeId);
        if (el) el.classList.add('node-side-panel');
        console.log('Auto-created Side Panel node:', nodeId);
    } catch (err) {
        console.error('Failed to create Side Panel node:', err);
    }
}

function validateDeadEnds() {
    for (const [nodeIdStr, data] of Object.entries(nodesData)) {
        const nodeEl = document.getElementById('node-' + nodeIdStr);
        if (!nodeEl) continue;
        if (data.slug === 'side_panel') {
            nodeEl.classList.remove('node-dead-end');
            continue;
        }
        const hasChoices = data.choices && data.choices.length > 0;
        const hasOnEnter = data.on_enter && data.on_enter.target_node_id;
        const hasTextRedirect = data.text && /\{redirect:([^}]+)\}/.test(data.text);
        if (!hasChoices && !hasOnEnter && !hasTextRedirect) {
            nodeEl.classList.add('node-dead-end');
        } else {
            nodeEl.classList.remove('node-dead-end');
        }
    }
}

function validateOrphans() {
    let startSlug = null;
    for (const [id, data] of Object.entries(nodesData)) {
        if (data.is_start) { startSlug = data.slug; break; }
    }
    if (!startSlug) {
        for (const [id, data] of Object.entries(nodesData)) {
            if (data.slug !== 'side_panel') { startSlug = data.slug; break; }
        }
    }
    if (!startSlug) return;

    const visited = new Set();
    const queue = [startSlug];

    // Build text-based redirect edges: sourceSlug → [targetSlug, ...]
    const redirectEdges = {};
    for (const [, data] of Object.entries(nodesData)) {
        if (data.text) {
            const matches = data.text.match(/\{redirect:([^}]+)\}/g);
            if (matches) {
                const targets = matches.map(m => m.replace('{redirect:', '').replace('}', '').trim());
                redirectEdges[data.slug] = [...new Set(targets)];
            }
        }
    }

    while (queue.length > 0) {
        const current = queue.shift();
        if (visited.has(current)) continue;
        visited.add(current);
        const nodeId = slugToNodeId[current];
        if (!nodeId || !nodesData[nodeId]) continue;
        const data = nodesData[nodeId];
        for (const choice of (data.choices || [])) {
            if (choice.targetSlug && !visited.has(choice.targetSlug)) {
                queue.push(choice.targetSlug);
            }
        }
        if (data.on_enter && data.on_enter.target_node_id && !visited.has(data.on_enter.target_node_id)) {
            queue.push(data.on_enter.target_node_id);
        }
        for (const target of (redirectEdges[data.slug] || [])) {
            if (!visited.has(target)) {
                queue.push(target);
            }
        }
    }

    for (const [nodeIdStr, data] of Object.entries(nodesData)) {
        const nodeEl = document.getElementById('node-' + nodeIdStr);
        if (!nodeEl) continue;
        if (data.slug === 'side_panel') {
            nodeEl.classList.remove('node-orphan');
            continue;
        }
        if (visited.has(data.slug)) {
            nodeEl.classList.remove('node-orphan');
        } else {
            nodeEl.classList.add('node-orphan');
        }
    }
}

function runValidation() {
    validateDeadEnds();
    validateOrphans();
    const deadEndEls = document.querySelectorAll('.node-dead-end');
    const orphanEls = document.querySelectorAll('.node-orphan');
    let msg = 'Validation complete.';
    const issues = [];
    if (deadEndEls.length > 0) issues.push(deadEndEls.length + ' dead-end node(s) — player can get stuck');
    if (orphanEls.length > 0) issues.push(orphanEls.length + ' orphaned node(s) — unreachable content');
    if (issues.length === 0) {
        msg = '✅ No issues found!';
    } else {
        msg = '⚠️ ' + issues.join('\n');
    }
    alert(msg);
}

function updateStartBadgeOnCanvas(nodeId) {
    const nodeEl = document.getElementById('node-' + nodeId);
    if (!nodeEl) return;
    nodeEl.classList.toggle('node-start', !!(nodesData[nodeId] && nodesData[nodeId].is_start));
}

function handleLinkTargetClick(targetId) {
    if (linkingFromId === targetId) {
        cancelLinking();
        return;
    }
    snapshotState();
    editor.addConnection(linkingFromId, targetId, 'output_1', 'input_1');
    console.log(`Linked Node ${linkingFromId} -> Node ${targetId}`);
    cancelLinking();
}

function cancelLinking() {
    linkingFromId = null;
    document.body.classList.remove('is-linking');
    console.log("Linking mode cancelled.");
}

function startLinking(nodeId) {
    linkingFromId = parseInt(nodeId);
    document.body.classList.add('is-linking');
    console.log(`Entering linking mode from node: ${linkingFromId}`);
};

function editNode(nodeId) {
    openPassageEditor(parseInt(nodeId));
}

function deleteNodeOverlay(nodeId) {
    if (confirm("Are you sure you want to delete this node?")) {
        snapshotState();
        const slug = getNodeSlug(nodeId);
        editor.removeNodeId("node-" + nodeId);
        delete nodesData[nodeId];
        if (slug) delete slugToNodeId[slug];
        closePassageEditor();
    }
}

function closePassageEditor() {
    selectedNodeId = null;
    document.getElementById('no-selection-msg').style.display = 'block';
    document.getElementById('passage-editor').style.display = 'none';
}

function openPassageEditor(nodeId, skipDirtyCheck) {
    if (!skipDirtyCheck && selectedNodeId !== null && selectedNodeId !== parseInt(nodeId)) {
        const currentTextarea = document.getElementById('passage-content');
        const currentData = nodesData[selectedNodeId];
        if (currentData && currentTextarea.value !== currentData.text) {
            saveCurrentContent(selectedNodeId);
        }
    }

    selectedNodeId = parseInt(nodeId);
    ensureNodeData(nodeId);

    if (!nodesData[nodeId]) return;

    document.getElementById('no-selection-msg').style.display = 'none';
    document.getElementById('passage-editor').style.display = 'block';

    const data = nodesData[nodeId];
    document.getElementById('passage-title').value = data.title || '';
    document.getElementById('passage-content').value = data.text || '';
    document.getElementById('passage-id').value = data.slug || '';
    document.getElementById('passage-id-error').style.display = 'none';

    const isStartCheckbox = document.getElementById('passage-is-start');
    if (data.slug === 'side_panel') {
        isStartCheckbox.style.display = 'none';
    } else {
        isStartCheckbox.style.display = 'flex';
        if (isStartCheckbox.checked !== !!data.is_start) {
            isStartCheckbox.checked = !!data.is_start;
        }
    }

    renderChoices(nodeId);
    renderActions(nodeId);
    renderOnEnter(nodeId);
    updateStartBadgeOnCanvas(nodeId);
}

function renderChoices(nodeId) {
    const container = document.getElementById('choices-list');
    const data = nodesData[nodeId];
    if (!data || !data.choices || data.choices.length === 0) {
        container.innerHTML = '<p id="no-choices-msg" class="text-muted-sm">Use the Link button [Link] on a node to connect passages.</p>';
        return;
    }

    let html = '';
    data.choices.forEach((choice, index) => {
        const targetTitle = getNodeTitleBySlug(choice.targetSlug);
        const linkText = getLinkTextFromContent(data.text || '', choice.targetSlug);
        html += `
            <div class="choice-card" data-node-id="${nodeId}" data-choice-index="${index}">
                <div class="choice-header">
                    <span class="choice-target">→ ${targetTitle}</span>
                    <button data-action="remove-choice" data-target-slug="${escapeHtml(choice.targetSlug)}" class="danger" title="Remove connection">Remove</button>
                </div>
                <div class="choice-link-text">Link text: <em>${escapeHtml(linkText || '(edit in passage content)')}</em></div>

                <label for="choice-prereq-${index}">Prerequisite (JS expression)</label>
                <input type="text" id="choice-prereq-${index}" value="${escapeHtml(choice.prerequisite || '')}" placeholder="e.g. state.has_key == true">

                <label for="choice-mutation-${index}">Mutation (JS statement)</label>
                <input type="text" id="choice-mutation-${index}" value="${escapeHtml(choice.mutation || '')}" placeholder="e.g. state.health -= 10">
            </div>
        `;
    });
    container.innerHTML = html;
}

function renderActions(nodeId) {
    const container = document.getElementById('actions-list');
    const data = nodesData[nodeId];
    if (!data || !data.actions || data.actions.length === 0) {
        container.innerHTML = '<p class="text-muted-sm">No actions defined.</p>';
        return;
    }
    let html = '';
    data.actions.forEach((action, aIndex) => {
        const syntax = '[' + (action.text || 'action-text') + '](' + (action.id ? 'action:' + action.id : 'action:id') + ')';

        const pairsHtml = (action.pairs || []).map((pair, pIndex) => `
            <div class="pair-card" data-pair-index="${pIndex}">
                <div class="pair-header">
                    <label>Condition (optional)</label>
                    <button data-action="remove-pair" class="danger" style="padding:2px 8px;font-size:0.75rem;">X</button>
                </div>
                <input type="text" class="pair-condition" value="${escapeHtml(pair.condition || '')}" placeholder="e.g. state.has_key == false">
                <label>Mutation</label>
                <input type="text" class="pair-mutation" value="${escapeHtml(pair.mutation)}" placeholder="e.g. state.has_key = true">
            </div>
        `).join('');

        html += `
            <div class="choice-card" data-node-id="${nodeId}" data-action-index="${aIndex}">
                <div class="action-link-text">${escapeHtml(syntax)}</div>
                <div class="choice-header">
                    <input type="text" class="action-text-input" value="${escapeHtml(action.text)}" placeholder="Action link text...">
                    <button data-action="update-action" class="success" style="font-size:0.8rem;padding:4px 10px;">Update</button>
                    <button data-action="delete-action" class="danger" style="font-size:0.8rem;padding:4px 10px;" title="Remove action">Remove</button>
                </div>
                <div class="action-pairs" style="margin-top:6px;">
                    ${pairsHtml}
                </div>
                <button data-action="add-pair" style="font-size:0.85rem;margin-top:4px;">+ Add pair</button>
            </div>
        `;
    });
    container.innerHTML = html;
}

function deleteAction(nodeId, index) {
    if (!nodesData[nodeId] || !nodesData[nodeId].actions) return;
    nodesData[nodeId].actions.splice(index, 1);
    renderActions(nodeId);
};

function addPair(nodeId, aIndex) {
    const action = nodesData[nodeId]?.actions?.[aIndex];
    if (!action) return;
    if (!action.pairs) action.pairs = [];
    action.pairs.push({ condition: '', mutation: '' });
    renderActions(nodeId);
};

function removePair(nodeId, aIndex, pIndex) {
    const action = nodesData[nodeId]?.actions?.[aIndex];
    if (!action || !action.pairs) return;
    action.pairs.splice(pIndex, 1);
    renderActions(nodeId);
};

function updateAction(nodeId, aIndex) {
    const action = nodesData[nodeId]?.actions?.[aIndex];
    if (!action) return;

    const card = document.querySelector('#actions-list .choice-card[data-action-index="' + aIndex + '"]');
    if (!card) return;

    action.text = card.querySelector('.action-text-input').value || '';

    const pairEls = card.querySelectorAll('.pair-card');
    const newPairs = [];
    pairEls.forEach(el => {
        const condition = el.querySelector('.pair-condition').value.trim();
        const mutation = el.querySelector('.pair-mutation').value.trim();
        if (mutation) {
            newPairs.push(condition ? { condition, mutation } : { mutation });
        }
    });
    action.pairs = newPairs.length > 0 ? newPairs : [{ mutation: '' }];

    renderActions(nodeId);
};

function renderOnEnter(nodeId) {
    const container = document.getElementById('onenter-section');
    const data = nodesData[nodeId];
    if (!data) return;

    const onEnter = data.on_enter;
    const isEnabled = !!onEnter;
    const hasTarget = isEnabled && !!onEnter.target_node_id;

    const allSlugs = Object.values(slugToNodeId).map(id => nodesData[id]?.slug).filter(Boolean);

    container.innerHTML = `
        <label class="label-checkbox">
            <input type="checkbox" id="onenter-enabled" ${isEnabled ? 'checked' : ''} onchange="toggleOnEnter(${nodeId}, this.checked)">
            Enable auto-redirect when entering this node
        </label>
        <div id="onenter-fields" class="${isEnabled ? '' : 'is-hidden'}">
            <label for="onenter-target">Redirect to Node</label>
            <select id="onenter-target" onchange="updateOnEnterField(${nodeId})">
                <option value="">— Select node —</option>
                ${allSlugs.map(slug => {
                    const title = getNodeTitleBySlug(slug);
                    return '<option value="' + slug + '" ' + (hasTarget && onEnter.target_node_id === slug ? 'selected' : '') + '>' + title + ' (' + slug + ')</option>';
                }).join('')}
            </select>
            <label for="onenter-condition">Condition (optional JS expression)</label>
            <input type="text" id="onenter-condition" value="${escapeHtml(isEnabled && onEnter.condition ? onEnter.condition : '')}" placeholder="e.g. state.rent_overdue == true" onchange="updateOnEnterField(${nodeId})">
            <label for="onenter-mutation">Mutation (optional JS statement)</label>
            <input type="text" id="onenter-mutation" value="${escapeHtml(isEnabled && onEnter.mutation ? onEnter.mutation : '')}" placeholder="e.g. state.triggered = true" onchange="updateOnEnterField(${nodeId})">
        </div>
    `;
}

window.toggleOnEnter = function(nodeId, enabled) {
    if (!nodesData[nodeId]) return;
    if (enabled) {
        nodesData[nodeId].on_enter = { target_node_id: '', condition: '', mutation: '' };
    } else {
        nodesData[nodeId].on_enter = null;
    }
    renderOnEnter(nodeId);
};

window.updateOnEnterField = function(nodeId) {
    if (!nodesData[nodeId] || !nodesData[nodeId].on_enter) return;
    const container = document.getElementById('onenter-section');
    nodesData[nodeId].on_enter.target_node_id = container.querySelector('#onenter-target').value;
    nodesData[nodeId].on_enter.condition = container.querySelector('#onenter-condition').value || null;
    nodesData[nodeId].on_enter.mutation = container.querySelector('#onenter-mutation').value || null;
};

async function loadAssetList() {
    const section = document.getElementById('asset-section');
    const container = document.getElementById('asset-list');
    if (!currentProjectName) {
        section.style.display = 'none';
        return;
    }
    try {
        const resp = await fetch('/api/assets/' + encodeURIComponent(currentProjectName));
        if (!resp.ok) throw new Error('Failed to load assets');
        const data = await resp.json();
        const assets = data.assets || [];
        if (assets.length === 0) {
            section.style.display = 'none';
            return;
        }
        section.style.display = 'block';
        let html = '';
        assets.forEach(fname => {
            const url = '/api/assets/' + encodeURIComponent(currentProjectName) + '/' + encodeURIComponent(fname);
            const alt = fname.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_]/g, '_');
            const syntax = '![' + alt + '](' + url + ')';
            html += '<div class="asset-item" title="Click to copy: ' + escapeHtml(syntax) + '">';
            html += '  <img class="asset-preview" src="' + url + '" alt="' + escapeHtml(alt) + '" loading="lazy">';
            html += '  <span class="asset-syntax">' + escapeHtml(syntax) + '</span>';
            html += '  <button class="asset-delete-btn" data-fname="' + escapeHtml(fname) + '" title="Delete asset">' + SVG_CLOSE + '</button>';
            html += '</div>';
        });
        container.innerHTML = html;
    } catch (e) {
        section.style.display = 'none';
    }
}

async function deleteAsset(filename) {
    if (!currentProjectName) return;
    if (!confirm('Delete "' + filename + '" permanently?')) return;
    try {
        const resp = await fetch(
            '/api/assets/' + encodeURIComponent(currentProjectName) + '/' + encodeURIComponent(filename),
            { method: 'DELETE' }
        );
        if (!resp.ok) {
            const err = await resp.json();
            throw new Error(err.detail || 'Delete failed');
        }
        showToast('Deleted: ' + filename);
    } catch (err) {
        alert('Failed to delete asset: ' + err.message);
    } finally {
        await loadAssetList();
    }
}

// --- Variable Management ---

function showVariableForm() {
    if (isEditingVariable) {
        hideVariableForm();
    }
    document.getElementById('var-form').style.display = 'block';
}

function hideVariableForm() {
    if (isEditingVariable && editVariableBackup) {
        variables[editVariableBackup.name] = { type: editVariableBackup.type, value: editVariableBackup.value };
        renderVariables();
    }
    editVariableBackup = null;
    isEditingVariable = false;
    document.getElementById('var-form').style.display = 'none';
    document.getElementById('var-name').value = '';
    document.getElementById('var-value').value = '';
    document.getElementById('var-submit-btn').textContent = 'Add';
}

function addVariable() {
    const name = document.getElementById('var-name').value.trim();
    const type = document.getElementById('var-type').value;
    const rawValue = document.getElementById('var-value').value.trim();

    if (!name) { alert("Variable name is required."); return; }
    if (name in variables) { alert("A variable with that name already exists."); return; }

    let parsedValue;
    switch (type) {
        case 'int':
            parsedValue = parseInt(rawValue, 10);
            if (isNaN(parsedValue)) { alert("Please enter a valid integer."); return; }
            break;
        case 'float':
            parsedValue = parseFloat(rawValue);
            if (isNaN(parsedValue)) { alert("Please enter a valid float."); return; }
            break;
        case 'bool':
            parsedValue = rawValue.toLowerCase() === 'true' || rawValue === '1';
            break;
        default:
            parsedValue = rawValue;
    }

    variables[name] = { type, value: parsedValue };
    editVariableBackup = null;
    hideVariableForm();
    renderVariables();
}

function editVariable(name) {
    const v = variables[name];
    if (!v) return;
    if (isEditingVariable && editVariableBackup) {
        variables[editVariableBackup.name] = { type: editVariableBackup.type, value: editVariableBackup.value };
    }
    editVariableBackup = { name, type: v.type, value: v.value };
    delete variables[name];
    document.getElementById('var-name').value = name;
    document.getElementById('var-type').value = v.type;
    document.getElementById('var-value').value = String(v.value);
    document.getElementById('var-submit-btn').textContent = 'Save Changes';
    document.getElementById('var-form').style.display = 'block';
    isEditingVariable = true;
    renderVariables();
}

function deleteVariable(name) {
    delete variables[name];
    renderVariables();
}

function renderVariables() {
    const container = document.getElementById('var-list');
    const names = Object.keys(variables);
    if (names.length === 0) {
        container.innerHTML = '<p class="text-muted-sm">No variables defined yet.</p>';
        return;
    }
    let html = '';
    names.forEach(name => {
        const v = variables[name];
        html += `
            <div class="var-item">
                <div class="var-item-content" data-varname="${escapeHtml(name)}">
                    <span class="var-name">${escapeHtml(name)}</span>
                    <span class="var-type">${v.type}</span>
                    <div class="var-value">${escapeHtml(String(v.value))}</div>
                </div>
                <div class="var-actions">
                    <button class="var-delete-btn danger" data-varname="${escapeHtml(name)}">${SVG_CLOSE}</button>
                </div>
            </div>
        `;
    });
    container.innerHTML = html;
}

function insertMarkdown(before, after) {
    const ta = document.getElementById('passage-content');
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const text = ta.value;
    const selected = text.substring(start, end);
    ta.value = text.substring(0, start) + before + selected + after + text.substring(end);
    ta.focus();
    ta.selectionStart = ta.selectionEnd = selected ? start + before.length + selected.length + after.length : start + before.length;
}

function insertImage() {
    if (!currentProjectName) {
        alert('Please save the project first before adding images.');
        return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
        const file = input.files[0];
        if (!file) return;
        const formData = new FormData();
        formData.append('file', file);
        try {
            const resp = await fetch('/api/assets/' + encodeURIComponent(currentProjectName), {
                method: 'POST',
                body: formData
            });
            if (!resp.ok) {
                const err = await resp.json();
                throw new Error(err.detail || 'Upload failed');
            }
            const result = await resp.json();
            const ta = document.getElementById('passage-content');
            const start = ta.selectionStart;
            const text = ta.value;
            const alt = file.name.replace(/\.[^.]+$/, '');
            const markdown = '![' + alt + '](' + result.url + ')';
            ta.value = text.substring(0, start) + markdown + text.substring(ta.selectionEnd);
            ta.focus();
            ta.selectionStart = ta.selectionEnd = start + markdown.length;
            loadAssetList();
        } catch (err) {
            alert('Failed to upload image: ' + err.message);
        }
    };
    input.click();
}

function insertAction() {
    if (!selectedNodeId) { alert('Open a passage first.'); return; }
    ensureNodeData(selectedNodeId);
    if (!nodesData[selectedNodeId].actions) nodesData[selectedNodeId].actions = [];

    const actions = nodesData[selectedNodeId].actions;
    const allIds = new Set();
    for (const nodeId in nodesData) {
        for (const a of (nodesData[nodeId].actions || [])) {
            if (a.id) allIds.add(a.id);
        }
    }
    let idCounter = 0;
    while (allIds.has('a' + idCounter)) idCounter++;
    const id = 'a' + idCounter;
    actions.push({ id, text: '', pairs: [{ condition: '', mutation: '' }] });

    renderActions(selectedNodeId);
}

function deduplicateActionIds() {
    const seen = {};
    for (const nodeId in nodesData) {
        for (const action of (nodesData[nodeId].actions || [])) {
            if (!action.id) {
                action.id = 'a' + Object.keys(seen).length;
            }
            if (seen[action.id] !== undefined) {
                const oldId = action.id;
                let counter = 0;
                while (seen['a' + counter] !== undefined) counter++;
                action.id = 'a' + counter;
                console.log('Renamed duplicate action "' + oldId + '" in node ' + nodeId + ' to "' + action.id + '"');
            }
            seen[action.id] = true;
        }
    }
}

function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function getLinkTextFromContent(content, targetSlug) {
    const regex = new RegExp('\\[([^\\]]*)\\]\\(node:' + escapeRegex(targetSlug) + '\\)');
    const match = content.match(regex);
    return match ? match[1] : '';
}

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function saveCurrentContent(nodeId) {
    const title = document.getElementById('passage-title').value;
    const content = document.getElementById('passage-content').value;
    const nodeData = nodesData[nodeId];
    if (!nodeData) return;
    nodeData.title = title;
    nodeData.text = content;
    const slugInput = document.getElementById('passage-id');
    if (slugInput) {
        const newSlug = slugInput.value.trim();
        if (newSlug && newSlug !== nodeData.slug) {
            delete slugToNodeId[nodeData.slug];
            slugToNodeId[newSlug] = nodeId;
            nodeData.slug = newSlug;
        }
    }
}

function getNodeTitle(nodeId) {
    if (nodesData[nodeId] && nodesData[nodeId].title) {
        return nodesData[nodeId].title;
    }
    return 'Node ' + nodeId;
}

function removeChoiceLink(sourceId, targetSlug) {
    const targetId = getNodeIdBySlug(targetSlug);
    if (targetId === null) return;
    editor.removeSingleConnection(sourceId, targetId, 'output_1', 'input_1');
};

function showIdError(msg) {
    const errorEl = document.getElementById('passage-id-error');
    errorEl.textContent = msg;
    errorEl.style.display = 'block';
    document.getElementById('passage-id').style.borderColor = 'var(--danger-color)';
}

function hideIdError() {
    document.getElementById('passage-id-error').style.display = 'none';
    document.getElementById('passage-id').style.borderColor = '';
}

function validateSlugOnBlur() {
    if (!selectedNodeId) return;
    const newSlug = document.getElementById('passage-id').value.trim();
    const nodeData = nodesData[selectedNodeId];
    if (!nodeData) return;

    if (!newSlug) {
        showIdError('Node ID cannot be empty');
        return;
    }
    if (newSlug !== nodeData.slug && slugToNodeId[newSlug] !== undefined) {
        showIdError('Node ID "' + newSlug + '" is already in use');
    } else {
        hideIdError();
    }
}

function updateCurrentNode() {
    if (!selectedNodeId) return;
    snapshotState();

    const title = document.getElementById('passage-title').value;
    const content = document.getElementById('passage-content').value;
    const newSlug = document.getElementById('passage-id').value.trim();

    ensureNodeData(selectedNodeId);
    const nodeData = nodesData[selectedNodeId];

    if (!newSlug) {
        showIdError('Node ID cannot be empty');
        return;
    }
    if (newSlug !== nodeData.slug && slugToNodeId[newSlug] !== undefined) {
        showIdError('Node ID "' + newSlug + '" is already in use');
        return;
    }

    hideIdError();

    if (newSlug !== nodeData.slug) {
        const oldSlug = nodeData.slug;

        delete slugToNodeId[oldSlug];
        slugToNodeId[newSlug] = selectedNodeId;

        for (const [nid, ndata] of Object.entries(nodesData)) {
            if (ndata.choices) {
                ndata.choices.forEach(choice => {
                    if (choice.targetSlug === oldSlug) {
                        choice.targetSlug = newSlug;
                    }
                });
            }
        }

        for (const [nid, ndata] of Object.entries(nodesData)) {
            if (ndata.on_enter && ndata.on_enter.target_node_id === oldSlug) {
                ndata.on_enter.target_node_id = newSlug;
            }
        }

        nodeData.slug = newSlug;
    }

    nodeData.title = title;
    nodeData.text = content;

    nodeData.is_start = document.getElementById('passage-is-start').checked;
    if (nodeData.is_start) {
        for (const [nid, nd] of Object.entries(nodesData)) {
            if (parseInt(nid) !== selectedNodeId && nd.is_start) {
                nd.is_start = false;
                updateStartBadgeOnCanvas(parseInt(nid));
            }
        }
    }
    updateStartBadgeOnCanvas(selectedNodeId);

    const linkRegex = /\[([^\]]*)\]\(node:([^)]+)\)/g;
    const linksInContent = {};
    let match;
    while ((match = linkRegex.exec(content)) !== null) {
        linksInContent[match[2]] = match[1];
    }

    const choiceCards = document.querySelectorAll('#choices-list .choice-card');
    choiceCards.forEach((card, index) => {
        const prereqInput = document.getElementById('choice-prereq-' + index);
        const mutationInput = document.getElementById('choice-mutation-' + index);
        if (nodeData.choices[index]) {
            const choice = nodeData.choices[index];
            choice.text = linksInContent[choice.targetSlug] || '';
            choice.prerequisite = prereqInput ? prereqInput.value : '';
            choice.mutation = mutationInput ? mutationInput.value : '';
        }
    });

    const actionCards = document.querySelectorAll('#actions-list .choice-card');
    actionCards.forEach((card, aIndex) => {
        if (!nodeData.actions[aIndex]) return;
        const action = nodeData.actions[aIndex];
        action.text = card.querySelector('.action-text-input').value || '';

        const pairEls = card.querySelectorAll('.pair-card');
        const newPairs = [];
        pairEls.forEach(el => {
            const condition = el.querySelector('.pair-condition').value.trim();
            const mutation = el.querySelector('.pair-mutation').value.trim();
            if (mutation) {
                newPairs.push(condition ? { condition, mutation } : { mutation });
            }
        });
        action.pairs = newPairs.length > 0 ? newPairs : [{ mutation: '' }];
    });

    const nodeEl = document.getElementById('node-' + selectedNodeId);
    if (nodeEl) {
        const contentEl = nodeEl.querySelector('.drawflow_content_node');
        if (contentEl) contentEl.innerHTML = title;
    }

    renderChoices(selectedNodeId);
    renderOnEnter(selectedNodeId);
}

function toggleStartNode(checked) {
    if (!selectedNodeId) return;
    const nodeData = nodesData[selectedNodeId];
    if (!nodeData) return;
    nodeData.is_start = checked;
    if (checked) {
        for (const [nid, nd] of Object.entries(nodesData)) {
            if (parseInt(nid) !== selectedNodeId && nd.is_start) {
                nd.is_start = false;
                updateStartBadgeOnCanvas(parseInt(nid));
            }
        }
    }
    updateStartBadgeOnCanvas(selectedNodeId);
}

function deleteCurrentNode() {
    if (!selectedNodeId) return;
    if (confirm("Are you sure you want to delete this node?")) {
        snapshotState();
        const slug = getNodeSlug(selectedNodeId);
        editor.removeNodeId("node-" + selectedNodeId);
        delete nodesData[selectedNodeId];
        if (slug) delete slugToNodeId[slug];
        closePassageEditor();
    }
}

// --- Modal ---

let selectedLoadName = null;

function closeModal() {
    document.getElementById('modal-overlay').style.display = 'none';
    document.getElementById('save-modal').style.display = 'none';
    document.getElementById('load-modal').style.display = 'none';
    document.getElementById('import-modal').style.display = 'none';
    selectedLoadName = null;
}

function openModal(type) {
    document.getElementById('modal-overlay').style.display = 'flex';
    document.getElementById(type + '-modal').style.display = 'flex';
    if (type === 'save') {
        document.getElementById('save-name-input').value = '';
        document.getElementById('save-name-input').focus();
    }
}

function showImportModal() {
    openModal('import');
    document.getElementById('import-textarea').value = '';
    const errorEl = document.getElementById('import-error');
    errorEl.style.display = 'none';
    errorEl.textContent = '';
    document.getElementById('import-textarea').classList.remove('has-error');
}

function importNode() {
    const raw = document.getElementById('import-textarea').value.trim();
    const errorEl = document.getElementById('import-error');
    const textarea = document.getElementById('import-textarea');

    if (!raw) {
        errorEl.textContent = 'Paste a node JSON object first.';
        errorEl.style.display = 'block';
        textarea.classList.add('has-error');
        return;
    }

    let obj;
    try { obj = JSON.parse(raw); } catch (e) {
        errorEl.textContent = 'Invalid JSON: ' + e.message;
        errorEl.style.display = 'block';
        textarea.classList.add('has-error');
        return;
    }

    if (typeof obj !== 'object' || Array.isArray(obj) || obj === null) {
        errorEl.textContent = 'Input must be a JSON object (not an array or primitive).';
        errorEl.style.display = 'block';
        textarea.classList.add('has-error');
        return;
    }

    if (typeof obj.id !== 'string' || !obj.id.trim()) {
        errorEl.textContent = 'Node must have a valid "id" field (non-empty string).';
        errorEl.style.display = 'block';
        textarea.classList.add('has-error');
        return;
    }

    if (typeof obj.title !== 'string' || !obj.title.trim()) {
        errorEl.textContent = 'Node must have a valid "title" field (non-empty string).';
        errorEl.style.display = 'block';
        textarea.classList.add('has-error');
        return;
    }

    errorEl.style.display = 'none';
    textarea.classList.remove('has-error');

    const id = obj.id.trim();

    if (id === 'side_panel') {
        const existingId = slugToNodeId['side_panel'];
        if (existingId !== undefined) {
            editor.removeNodeId('node-' + existingId);
            delete nodesData[existingId];
        }
        const x = typeof obj.x === 'number' ? obj.x : 20;
        const y = typeof obj.y === 'number' ? obj.y : 20;
        const nodeId = editor.addNode('story_node', 1, 1, x, y, 'story_node', {}, obj.title);
        nodesData[nodeId] = {
            title: obj.title,
            text: typeof obj.text === 'string' ? obj.text : '',
            slug: 'side_panel',
            choices: Array.isArray(obj.choices) ? obj.choices.map(c => ({
                text: c.text || '',
                targetSlug: c.targetSlug || c.target_node_id || ''
            })) : [],
            actions: Array.isArray(obj.actions) ? obj.actions.map(a => {
                if (typeof a === 'string') return a;
                return {
                    text: a.text || a.prompt || '',
                    id: a.id || '',
                    pairs: (Array.isArray(a.pairs) ? a.pairs : []).map(p => ({
                        condition: p.condition || p.label || '',
                        mutation: p.mutation || ''
                    }))
                };
            }) : [],
            on_enter: (obj.on_enter && typeof obj.on_enter === 'object') ? obj.on_enter : null,
            is_start: false
        };
        slugToNodeId['side_panel'] = nodeId;
        const el = document.getElementById('node-' + nodeId);
        if (el) el.classList.add('node-side-panel');
        closeModal();
        showToast('Imported side panel node');
        runValidation();
        return;
    }

    const slug = generateUniqueSlug(id);
    const x = typeof obj.x === 'number' ? obj.x : 0;
    const y = typeof obj.y === 'number' ? obj.y : 0;

    const nodeId = editor.addNode('story_node', 1, 1, x, y, 'story_node', {}, obj.title);

    const choices = Array.isArray(obj.choices) ? obj.choices.map(c => ({
        text: c.text || '',
        targetSlug: c.targetSlug || c.target_node_id || ''
    })) : [];

    const actions = Array.isArray(obj.actions) ? obj.actions.map(a => {
        if (typeof a === 'string') return a;
        return {
            text: a.text || a.prompt || '',
            id: a.id || '',
            pairs: (Array.isArray(a.pairs) ? a.pairs : []).map(p => ({
                condition: p.condition || p.label || '',
                mutation: p.mutation || ''
            }))
        };
    }) : [];

    const on_enter = (obj.on_enter && typeof obj.on_enter === 'object') ? obj.on_enter : null;
    const is_start = obj.is_start === true;

    nodesData[nodeId] = {
        title: obj.title,
        text: typeof obj.text === 'string' ? obj.text : '',
        slug: slug,
        choices: choices,
        actions: actions,
        on_enter: on_enter,
        is_start: is_start
    };
    slugToNodeId[slug] = nodeId;

    if (is_start) {
        for (const [nid, d] of Object.entries(nodesData)) {
            if (parseInt(nid) !== nodeId && d.is_start) {
                d.is_start = false;
            }
        }
        updateStartBadgeOnCanvas(nodeId);
    }

    closeModal();
    showToast('Imported node: ' + obj.title);
    runValidation();
}

function setupEditorDelegation() {
    document.getElementById('choices-list').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action="remove-choice"]');
        if (!btn) return;
        const card = btn.closest('.choice-card');
        if (!card) return;
        const nodeId = parseInt(card.dataset.nodeId);
        const targetSlug = btn.dataset.targetSlug;
        if (!isNaN(nodeId) && targetSlug) {
            removeChoiceLink(nodeId, targetSlug);
        }
    });

    document.getElementById('actions-list').addEventListener('click', (e) => {
        const card = e.target.closest('.choice-card');
        if (!card) return;
        const nodeId = parseInt(card.dataset.nodeId);
        const aIndex = parseInt(card.dataset.actionIndex);
        if (isNaN(nodeId) || isNaN(aIndex)) return;

        const action = e.target.closest('[data-action]');
        if (!action) return;

        switch (action.dataset.action) {
            case 'update-action':
                updateAction(nodeId, aIndex);
                break;
            case 'delete-action':
                deleteAction(nodeId, aIndex);
                break;
            case 'add-pair':
                addPair(nodeId, aIndex);
                break;
            case 'remove-pair': {
                const pairCard = action.closest('.pair-card');
                if (!pairCard) return;
                const pIndex = parseInt(pairCard.dataset.pairIndex);
                if (!isNaN(pIndex)) {
                    removePair(nodeId, aIndex, pIndex);
                }
                break;
            }
        }
    });
}

function setupModalEvents() {
    document.getElementById('save-list').addEventListener('click', (e) => {
        const item = e.target.closest('.save-item');
        if (!item) return;
        const name = item.dataset.name;
        if (!name) return;
        document.querySelectorAll('#save-list .save-item').forEach(el => el.classList.remove('selected'));
        item.classList.add('selected');
        document.getElementById('save-name-input').value = name;
    });
    document.getElementById('load-list').addEventListener('click', (e) => {
        const item = e.target.closest('.save-item');
        if (!item) return;
        const name = item.dataset.name;
        if (!name) return;
        document.querySelectorAll('#load-list .save-item').forEach(el => el.classList.remove('selected'));
        item.classList.add('selected');
        selectedLoadName = name;
    });
}

function setupAssetDelegation() {
    document.getElementById('asset-list').addEventListener('click', (e) => {
        const assetItem = e.target.closest('.asset-item');
        if (assetItem && !e.target.closest('.asset-delete-btn')) {
            const text = assetItem.querySelector('.asset-syntax').textContent;
            navigator.clipboard.writeText(text).catch(() => {});
            assetItem.style.borderColor = 'var(--success-color)';
            setTimeout(() => { assetItem.style.borderColor = ''; }, 800);
            return;
        }
        const delBtn = e.target.closest('.asset-delete-btn');
        if (delBtn) {
            e.stopPropagation();
            const fname = delBtn.dataset.fname;
            if (fname) deleteAsset(fname);
        }
    });
}

function setupNodeOverlayDelegation() {
    document.getElementById('tab-graph').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-overlay-action]');
        if (!btn) return;
        e.stopPropagation();

        const nodeElement = btn.closest('[data-id]');
        if (!nodeElement) return;
        const nodeId = parseInt(nodeElement.dataset.id);
        if (isNaN(nodeId)) return;

        switch (btn.dataset.overlayAction) {
            case 'edit':
                editNode(nodeId);
                break;
            case 'delete':
                deleteNodeOverlay(nodeId);
                break;
            case 'link':
                startLinking(nodeId);
                break;
        }
    });
}

function setupButtonDelegation() {
    document.body.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const action = btn.dataset.action;
        if (!action) return;

        switch (action) {
            case 'addNode': addNode(); break;
            case 'showSaveModal': showSaveModal(); break;
            case 'showLoadModal': showLoadModal(); break;
            case 'exportGame': exportGame(); break;
            case 'previewGame': previewGame(); break;
            case 'runValidation': runValidation(); break;
            case 'openTutorial': window.open('tutorial.html', '_blank'); break;
            case 'showVariableForm': showVariableForm(); break;
            case 'addVariable': addVariable(); break;
            case 'hideVariableForm': hideVariableForm(); break;
            case 'loadAssetList': loadAssetList(); break;
            case 'insertAction': insertAction(); break;
            case 'updateCurrentNode': updateCurrentNode(); break;
            case 'deleteCurrentNode': deleteCurrentNode(); break;
            case 'confirmSave': confirmSave(); break;
            case 'confirmLoad': confirmLoad(); break;
            case 'importNode': showImportModal(); break;
            case 'confirmImport': importNode(); break;
            case 'closeModal': closeModal(); break;
        }
    });
}

function setupVariableDelegation() {
    document.getElementById('var-list').addEventListener('click', (e) => {
        const item = e.target.closest('.var-item-content');
        if (item && !e.target.closest('.var-delete-btn')) {
            const varname = item.dataset.varname;
            if (varname) editVariable(varname);
            return;
        }
        const delBtn = e.target.closest('.var-delete-btn');
        if (delBtn) {
            const varname = delBtn.dataset.varname;
            if (varname) deleteVariable(varname);
        }
    });
}

function filterNodes(query) {
    const q = query.toLowerCase().trim();
    let matchCount = 0;
    for (const [nodeIdStr, data] of Object.entries(nodesData)) {
        const nodeEl = document.getElementById('node-' + nodeIdStr);
        if (!nodeEl) continue;
        if (!q) {
            nodeEl.style.display = '';
            nodeEl.classList.remove('node-search-match', 'node-search-mismatch');
            matchCount++;
            continue;
        }
        const title = (data.title || '').toLowerCase();
        const slug = (data.slug || '').toLowerCase();
        const matches = title.includes(q) || slug.includes(q);
        if (matches) {
            nodeEl.style.display = '';
            nodeEl.classList.add('node-search-match');
            nodeEl.classList.remove('node-search-mismatch');
            matchCount++;
        } else {
            nodeEl.style.display = '';
            nodeEl.classList.add('node-search-mismatch');
            nodeEl.classList.remove('node-search-match');
        }
    }
    return matchCount;
}

function setupSearch() {
    const input = document.getElementById('node-search');
    if (!input) return;
    input.addEventListener('input', () => {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => {
            filterNodes(input.value);
        }, 150);
    });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            input.value = '';
            filterNodes('');
            input.blur();
            e.stopPropagation();
        }
    });
}

function formatMtime(ts) {
    const d = new Date(ts * 1000);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
}

async function fetchSaves() {
    const resp = await fetch('/api/saves');
    if (!resp.ok) throw new Error('Failed to fetch saves');
    const data = await resp.json();
    return data.saves || [];
}

function renderSaveList(saves) {
    const el = document.getElementById('save-list');
    if (saves.length === 0) {
        el.innerHTML = '<div class="modal-empty">No saved projects yet.</div>';
        return;
    }
    el.innerHTML = saves.map(s =>
        `<div class="save-item" data-name="${escapeHtml(s.name)}">
            <span>${escapeHtml(s.name)}</span>
            <span class="mtime">${formatMtime(s.mtime)}</span>
        </div>`
    ).join('');
}

function renderLoadList(saves) {
    const el = document.getElementById('load-list');
    if (saves.length === 0) {
        el.innerHTML = '<div class="modal-empty">No saved projects found.</div>';
        return;
    }
    el.innerHTML = saves.map(s =>
        `<div class="save-item" data-name="${escapeHtml(s.name)}">
            <span>${escapeHtml(s.name)}</span>
            <span class="mtime">${formatMtime(s.mtime)}</span>
        </div>`
    ).join('');
}

async function showSaveModal() {
    try {
        const saves = await fetchSaves();
        renderSaveList(saves);
        openModal('save');
    } catch (err) {
        alert('Failed to load save list: ' + err.message);
    }
}

async function showLoadModal() {
    try {
        const saves = await fetchSaves();
        renderLoadList(saves);
        selectedLoadName = null;
        openModal('load');
    } catch (err) {
        alert('Failed to load save list: ' + err.message);
    }
}

function _buildSavePayload(name) {
    const nodes = [];
    for (const [nodeIdStr, data] of Object.entries(nodesData)) {
        const nodeId = parseInt(nodeIdStr);
        const drawflowNode = editor.drawflow.drawflow['Home'].data[nodeId];
        if (!drawflowNode) continue;

        const choices = (data.choices || []).map(c => ({
            target_node_id: c.targetSlug,
            text: c.text || '',
            prerequisite: c.prerequisite || null,
            mutation: c.mutation || null
        }));
        const actions = (data.actions || []).map(a => ({
            id: a.id,
            text: a.text || '',
            pairs: (a.pairs || []).map(p => ({
                condition: p.condition || null,
                mutation: p.mutation
            }))
        }));

        nodes.push({
            id: data.slug,
            title: data.title || '',
            text: data.text || '',
            x: drawflowNode.pos_x,
            y: drawflowNode.pos_y,
            choices: choices,
            actions: actions,
            on_enter: data.on_enter || null,
            is_start: data.is_start || false
        });
    }

    const vars = {};
    for (const [vName, v] of Object.entries(variables)) {
        vars[vName] = v.value;
    }

    return { name, variables: vars, nodes: nodes };
}

async function confirmSave() {
    if (selectedNodeId !== null && nodesData[selectedNodeId]) {
        nodesData[selectedNodeId].text = document.getElementById('passage-content').value;
    }
    const nameInput = document.getElementById('save-name-input');
    const name = nameInput.value.trim();
    if (!name) { alert('Please enter a project name.'); return; }

    showLoader('Saving...');
    try {
        const payload = _buildSavePayload(name);
        const response = await fetch('/api/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.detail || 'Save failed');
        }
        closeModal();
        currentProjectName = name;
        showToast('Project saved!');
        console.log('Project saved as "' + name + '"');
    } catch (err) {
        alert('Failed to save project: ' + err.message);
    } finally {
        hideLoader();
    }
}

async function confirmLoad() {
    if (!selectedLoadName) { alert('Please select a project to load.'); return; }
    if (!confirm('Load "' + selectedLoadName + '"? All unsaved changes will be lost.')) return;

    const loadName = selectedLoadName;
    undoStack = [];
    redoStack = [];

    try {
        const response = await fetch('/api/load?name=' + encodeURIComponent(loadName));
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.detail || 'Load failed');
        }
        const project = await response.json();
        closeModal();

        isLoading = true;

        // Clear existing Drawflow nodes
        const idsToRemove = Object.keys(nodesData);
        for (const idStr of idsToRemove) {
            editor.removeNodeId('node-' + idStr);
        }
        nodesData = {};
        slugToNodeId = {};
        variables = {};
        closePassageEditor();

        // Restore variables
        for (const [vName, value] of Object.entries(project.variables || {})) {
            const type = typeof value === 'boolean' ? 'bool'
                : typeof value === 'number' ? (Number.isInteger(value) ? 'int' : 'float')
                : 'string';
            variables[vName] = { type, value };
        }

        // First pass: create nodes (skip connectionCreated side effects)
        const slugToDrawflowId = {};
        for (const node of project.nodes || []) {
            const nodeId = editor.addNode(
                'story_node',
                1,
                1,
                node.x || 0,
                node.y || 0,
                'story_node',
                {},
                node.title || 'Untitled'
            );
            slugToDrawflowId[node.id] = nodeId;
            nodesData[nodeId] = {
                title: node.title || '',
                text: node.text || '',
                choices: [],
                actions: (node.actions || []).map(a => ({
                    id: a.id,
                    text: a.text || '',
                    pairs: (a.pairs || []).map(p => ({
                        condition: p.condition || '',
                        mutation: p.mutation || ''
                    }))
                })),
                on_enter: node.on_enter || null,
                slug: node.id,
                is_start: node.is_start || false
            };
            slugToNodeId[node.id] = nodeId;
        }

        // Second pass: restore connections and choices
        for (const node of project.nodes || []) {
            const sourceId = slugToDrawflowId[node.id];
            if (!sourceId) continue;

            for (const choice of node.choices || []) {
                const targetId = slugToDrawflowId[choice.target_node_id];
                if (!targetId) continue;

                editor.addConnection(sourceId, targetId, 'output_1', 'input_1');

                nodesData[sourceId].choices.push({
                    targetSlug: choice.target_node_id,
                    text: choice.text || '',
                    prerequisite: choice.prerequisite || '',
                    mutation: choice.mutation || ''
                });
            }
        }

        // Batch-refresh all connection paths (layout is now resolved)
        for (const idStr of Object.keys(nodesData)) {
            editor.updateConnectionNodes('node-' + idStr);
        }
        deduplicateActionIds();
        isLoading = false;
        renderVariables();
        currentProjectName = loadName;
        loadAssetList();
        ensureSidePanelNode();
        for (const nodeIdStr of Object.keys(nodesData)) {
            updateStartBadgeOnCanvas(parseInt(nodeIdStr));
        }
        requestAnimationFrame(() => {
            validateDeadEnds();
            validateOrphans();
            const searchInput = document.getElementById('node-search');
            if (searchInput && searchInput.value) {
                filterNodes(searchInput.value);
            }
        });
        showToast('Loaded: ' + loadName);
        console.log('Project "' + loadName + '" loaded');
    } catch (err) {
        isLoading = false;
        alert('Failed to load project: ' + err.message);
    } finally {
        hideLoader();
    }
}

async function exportGame() {
    if (!currentProjectName) {
        alert('Please save the project first before exporting.');
        return;
    }
    showLoader('Exporting...');
    try {
        await saveProjectSilent();
        window.location.href = '/api/export/' + encodeURIComponent(currentProjectName);
    } catch (err) {
        alert('Export failed: ' + err.message);
    } finally {
        hideLoader();
    }
}

async function previewGame() {
    if (!currentProjectName) {
        alert('Please save the project first before previewing.');
        return;
    }
    showLoader('Generating preview...');
    try {
        await saveProjectSilent();
        const resp = await fetch('/api/preview/' + encodeURIComponent(currentProjectName));
        if (!resp.ok) {
            const err = await resp.json();
            throw new Error(err.detail || 'Preview failed');
        }
        const data = await resp.json();
        window.open(data.url, '_blank');
    } catch (err) {
        alert('Preview failed: ' + err.message);
    } finally {
        hideLoader();
    }
}

async function saveProjectSilent() {
    if (selectedNodeId !== null && nodesData[selectedNodeId]) {
        nodesData[selectedNodeId].text = document.getElementById('passage-content').value;
    }
    const payload = _buildSavePayload(currentProjectName);
    const response = await fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail || 'Save failed');
    }
}
