// frontend/editor/js/event-delegation.js
// Centralized DOM event listeners, keyboard shortcuts, modals, and save/load/export/import.
import { state, generateUniqueSlug } from './state.js';
import { escapeHtml, showToast, showLoader, hideLoader } from './ui-utils.js';
import { undo, redo } from './history.js';
import { runValidation, validateDeadEnds, validateOrphans } from './validation.js';
import { getEditorValue } from './codemirror-setup.js';
import {
    removeChoiceLink,
    editNode,
    addNode,
    deleteNodeOverlay,
    startLinking,
    updateCurrentNode,
    deleteCurrentNode,
    cancelLinking,
    closePassageEditor,
    updateStartBadgeOnCanvas,
    updateUtilityBadgeOnCanvas
} from './node-editor.js';
import {
    addGroup,
    loadGroupFromPortal,
    moveToGroupFromPortal,
    deleteGroupFromPortal,
    collapseGroup,
    createPortalNode,
    _refreshPortalOutputs
} from './group-manager.js';
import {
    editVariable,
    deleteVariable,
    showVariableForm,
    addVariable,
    hideVariableForm,
    renderVariables
} from './variables-manager.js';
import {
    refreshAssets,
    aeDelete,
    aeNewFolder,
    aeUpload,
    aeNavigate,
    updateAEToolbar,
    aeRename,
    aeCopy,
    aeCut,
    aePaste
} from './asset-explorer.js';
import { ensureSidePanelNode, ensureSetupNode } from './graph-engine.js';

let selectedLoadName = null;
let contextMenuTargetId = null;

export function setupTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            const tabId = btn.getAttribute('data-tab');
            document.getElementById('tab-' + tabId).classList.add('active');
            if (tabId === 'markdown' && state.cmEditor) {
                setTimeout(() => state.cmEditor.refresh(), 0);
            }
            if (tabId === 'asset-explorer') {
                refreshAssets();
            }
        });
    });
}

export function setupModalEvents() {
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

export function setupEditorDelegation() {
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
}

export function setupAssetDelegation() {
    // Tree view toggle + copy + delete
    document.getElementById('asset-tree').addEventListener('click', (e) => {
        const toggle = e.target.closest('.asset-tree-toggle');
        if (toggle) {
            e.stopPropagation();
            const folder = toggle.closest('.asset-tree-folder');
            if (folder) {
                const children = folder.querySelector('.asset-tree-children');
                if (children) {
                    children.classList.toggle('expanded');
                    toggle.classList.toggle('expanded');
                }
            }
            return;
        }
        const fileRow = e.target.closest('.asset-tree-file-row');
        if (fileRow && !e.target.closest('.asset-delete-btn')) {
            const text = fileRow.querySelector('.asset-syntax').textContent;
            navigator.clipboard.writeText(text).catch(() => {});
            fileRow.style.borderColor = 'var(--success-color)';
            setTimeout(() => { fileRow.style.borderColor = ''; }, 800);
            return;
        }
        const delBtn = e.target.closest('.asset-delete-btn');
        if (delBtn) {
            e.stopPropagation();
            const path = delBtn.dataset.path;
            if (path) aeDelete(path);
            return;
        }
        const newFolderBtn = e.target.closest('.ae-folder-newfolder');
        if (newFolderBtn) {
            e.stopPropagation();
            aeNewFolder(newFolderBtn.dataset.path);
            return;
        }
        const uploadBtn = e.target.closest('.ae-folder-upload');
        if (uploadBtn) {
            e.stopPropagation();
            aeUpload(uploadBtn.dataset.path);
            return;
        }
    });

    // Asset explorer grid delegation
    document.getElementById('ae-file-grid').addEventListener('click', (e) => {
        const item = e.target.closest('.ae-grid-item');
        if (!item) {
            state.aeSelectedPaths.clear();
            document.querySelectorAll('.ae-grid-item').forEach(el => el.classList.remove('selected'));
            updateAEToolbar();
            return;
        }
        const path = item.dataset.path;
        const type = item.dataset.type;
        const isMod = e.ctrlKey || e.metaKey;
        if (type === 'folder') {
            if (isMod) {
                item.classList.toggle('selected');
                if (item.classList.contains('selected')) {
                    state.aeSelectedPaths.add(path);
                } else {
                    state.aeSelectedPaths.delete(path);
                }
                updateAEToolbar();
            } else {
                aeNavigate(path);
            }
            return;
        }
        if (isMod) {
            item.classList.toggle('selected');
            if (item.classList.contains('selected')) {
                state.aeSelectedPaths.add(path);
            } else {
                state.aeSelectedPaths.delete(path);
            }
        } else {
            state.aeSelectedPaths.clear();
            document.querySelectorAll('.ae-grid-item').forEach(el => el.classList.remove('selected'));
            state.aeSelectedPaths.add(path);
            item.classList.add('selected');
        }
        updateAEToolbar();
    });

    // Breadcrumb navigation
    document.getElementById('ae-breadcrumb').addEventListener('click', (e) => {
        const crumb = e.target.closest('.ae-crumb');
        if (crumb) {
            const path = crumb.dataset.path;
            aeNavigate(path);
        }
    });
}

export function setupNodeOverlayDelegation() {
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

export function setupButtonDelegation() {
    document.body.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const action = btn.dataset.action;
        if (!action) return;

        switch (action) {
            case 'addNode': addNode(); break;
            case 'addGroup': addGroup(); break;
            case 'showSaveModal': showSaveModal(); break;
            case 'showLoadModal': showLoadModal(); break;
            case 'exportGame': exportGame(); break;
            case 'previewGame': previewGame(); break;
            case 'runValidation': runValidation(); break;
            case 'openTutorial': window.open('tutorial.html', '_blank'); break;
            case 'showVariableForm': showVariableForm(); break;
            case 'addVariable': addVariable(); break;
            case 'hideVariableForm': hideVariableForm(); break;
            case 'refreshAssets': refreshAssets(); break;
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

export function setupAEToolbar() {
    document.getElementById('ae-toolbar').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-ae-action]');
        if (!btn) return;
        if (btn.disabled) return;
        const action = btn.dataset.aeAction;
        switch (action) {
            case 'newFolder': aeNewFolder(state.aeCurrentPath); break;
            case 'upload': aeUpload(state.aeCurrentPath); break;
            case 'rename': aeRename(); break;
            case 'delete': aeDelete(); break;
            case 'copy': aeCopy(); break;
            case 'cut': aeCut(); break;
            case 'paste': aePaste(); break;
        }
    });
}

export function setupVariableDelegation() {
    document.getElementById('var-type').addEventListener('change', (e) => {
        const isArray = e.target.value === 'array';
        document.getElementById('var-elem-type-wrap').classList.toggle('is-hidden', !isArray);
        document.getElementById('var-value').placeholder =
            isArray ? 'Comma-separated values (e.g. 3, 1, 4)' : 'Initial value';
    });

    document.getElementById('var-list').addEventListener('click', (e) => {
        const item = e.target.closest('.var-item-content');
        if (item && !e.target.closest('.var-delete-btn')) {
            const varname = item.dataset.varname;
            const scope = item.dataset.scope;
            if (varname) editVariable(varname, scope);
            return;
        }
        const delBtn = e.target.closest('.var-delete-btn');
        if (delBtn) {
            const varname = delBtn.dataset.varname;
            const scope = delBtn.dataset.scope;
            if (varname) deleteVariable(varname, scope);
        }
    });
}

// ---------------------------------------------------------------------------
// Context menu (right-click)
// ---------------------------------------------------------------------------

export function setupContextMenu() {
    const graphEl = document.getElementById('tab-graph');
    const menuEl = document.getElementById('context-menu');
    if (!graphEl || !menuEl) return;

    // Show context menu on right-click in the graph area
    graphEl.addEventListener('contextmenu', (e) => {
        const nodeEl = e.target.closest('[data-id]');
        if (!nodeEl) return;
        e.preventDefault();
        e.stopPropagation();

        const nodeId = parseInt(nodeEl.dataset.id);
        contextMenuTargetId = nodeId;
        const data = state.nodesData[nodeId];
        if (!data) return;

        const isPortal = data.isPortal;
        const isNormalNode = !isPortal;

        // Build context menu items
        menuEl.innerHTML = '';
        if (isPortal) {
            menuEl.innerHTML = `
                <button class="ctx-item" data-ctx-action="loadGroup">📂 Load Group</button>
                <button class="ctx-item" data-ctx-action="moveToGroup">📌 Move to Group</button>
                <div class="ctx-separator"></div>
                <button class="ctx-item danger" data-ctx-action="deleteGroup">🗑 Delete Group</button>
            `;
        } else if (isNormalNode) {
            // Don't show context menu for side_panel
            if (data.slug === 'side_panel') return;
            menuEl.innerHTML = `
                <button class="ctx-item" data-ctx-action="collapseGroup">⬆ Collapse Group</button>
                <div class="ctx-separator"></div>
                <button class="ctx-item danger" data-ctx-action="deleteNode">🗑 Delete Node</button>
            `;
        }

        if (menuEl.innerHTML) {
            const rect = graphEl.getBoundingClientRect();
            menuEl.style.display = 'block';
            menuEl.style.left = Math.min(e.clientX, window.innerWidth - 180) + 'px';
            menuEl.style.top = Math.min(e.clientY, window.innerHeight - 120) + 'px';
        }
    });

    // Handle context menu clicks
    menuEl.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-ctx-action]');
        if (!btn) return;
        const action = btn.dataset.ctxAction;
        const nodeId = contextMenuTargetId;
        hideContextMenu();

        switch (action) {
            case 'loadGroup':
                loadGroupFromPortal(nodeId);
                break;
            case 'moveToGroup':
                moveToGroupFromPortal(nodeId);
                break;
            case 'deleteGroup':
                deleteGroupFromPortal(nodeId);
                break;
            case 'collapseGroup':
                const ctxData = state.nodesData[nodeId];
                if (ctxData && ctxData.group && ctxData.group !== 'side_panel') collapseGroup(ctxData.group);
                break;
            case 'deleteNode':
                deleteNodeOverlay(nodeId);
                break;
        }
    });

    // Close on any click outside
    document.addEventListener('click', (e) => {
        if (!menuEl.contains(e.target)) {
            hideContextMenu();
        }
    });

    // Close on Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') hideContextMenu();
    });
}

export function hideContextMenu() {
    const menu = document.getElementById('context-menu');
    if (menu) menu.style.display = 'none';
    contextMenuTargetId = null;
}

export function filterNodes(query) {
    const q = query.toLowerCase().trim();
    let matchCount = 0;
    for (const [nodeIdStr, data] of Object.entries(state.nodesData)) {
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

export function setupSearch() {
    const input = document.getElementById('node-search');
    if (!input) return;
    input.addEventListener('input', () => {
        clearTimeout(state.searchDebounceTimer);
        state.searchDebounceTimer = setTimeout(() => {
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

export function formatMtime(ts) {
    const d = new Date(ts * 1000);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
}

export async function fetchSaves() {
    const resp = await fetch('/api/saves');
    if (!resp.ok) throw new Error('Failed to fetch saves');
    const data = await resp.json();
    return data.saves || [];
}

export function renderSaveList(saves) {
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

export function renderLoadList(saves) {
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

export async function showSaveModal() {
    try {
        const saves = await fetchSaves();
        renderSaveList(saves);
        openModal('save');
    } catch (err) {
        alert('Failed to load save list: ' + err.message);
    }
}

export async function showLoadModal() {
    try {
        const saves = await fetchSaves();
        renderLoadList(saves);
        selectedLoadName = null;
        openModal('load');
    } catch (err) {
        alert('Failed to load save list: ' + err.message);
    }
}

export function _buildSavePayload(name) {
    const nodes = [];
    for (const [nodeIdStr, data] of Object.entries(state.nodesData)) {
        if (data.isPortal) continue;
        const nodeId = parseInt(nodeIdStr);
        const drawflowNode = state.editor.drawflow.drawflow['Home'].data[nodeId];
        if (!drawflowNode) continue;

        const choices = (data.choices || []).map(c => ({
            target_node_id: c.targetSlug,
            text: c.text || '',
            prerequisite: c.prerequisite || null,
            mutation: c.mutation || null
        }));

        nodes.push({
            id: data.slug,
            title: data.title || '',
            text: data.text || '',
            x: drawflowNode.pos_x,
            y: drawflowNode.pos_y,
            choices: choices,
            on_enter: data.on_enter || null,
            is_start: data.is_start || false,
            is_utility: data.is_utility || false,
            group: data.group || 'side_panel'
        });
    }

    const vars = {};
    for (const [vName, v] of Object.entries(state.variables)) {
        vars[vName] = v.value;
    }
    const setup = {};
    for (const [sName, v] of Object.entries(state.setupVariables)) {
        setup[sName] = v.value;
    }

    // Include collapsed group data
    for (const [groupId, cachedNodes] of Object.entries(state.collapsedGroupsData || {})) {
        for (const cn of cachedNodes) {
            nodes.push({
                id: cn.id,
                title: cn.title || '',
                text: cn.text || '',
                x: cn.x || 0,
                y: cn.y || 0,
                choices: (cn.choices || []).map(c => ({
                    target_node_id: c.targetSlug,
                    text: c.text || '',
                    prerequisite: c.prerequisite || null,
                    mutation: c.mutation || null
                })),
                on_enter: cn.on_enter || null,
                is_start: cn.is_start || false,
                is_utility: cn.is_utility || false,
                group: cn.group || groupId
            });
        }
    }

    // Include group metadata (labels, etc.)
    const groupsPayload = (state.groupsManifest && state.groupsManifest.groups) || [];

    return { name, variables: vars, setup, nodes: nodes, groups: groupsPayload };
}

export async function confirmSave() {
    if (state.selectedNodeId !== null && state.nodesData[state.selectedNodeId]) {
        state.nodesData[state.selectedNodeId].text = getEditorValue();
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
        state.currentProjectName = name;
        showToast('Project saved!');
        console.log('Project saved as "' + name + '"');
    } catch (err) {
        alert('Failed to save project: ' + err.message);
    } finally {
        hideLoader();
    }
}

export async function confirmLoad() {
    if (!selectedLoadName) { alert('Please select a project to load.'); return; }
    if (!confirm('Load "' + selectedLoadName + '"? All unsaved changes will be lost.')) return;

    const loadName = selectedLoadName;
    state.undoStack = [];
    state.redoStack = [];

    try {
        closeModal();
        showLoader('Loading project...');

        // Clear existing state
        const idsToRemove = Object.keys(state.nodesData);
        for (const idStr of idsToRemove) {
            state.editor.removeNodeId('node-' + idStr);
        }
        state.nodesData = {};
        state.slugToNodeId = {};
        state.variables = {};
        state.setupVariables = {};
        state.groupsManifest = null;
        state.portalNodeIds = {};
        state.loadedGroupIds = new Set();
        state.collapsedGroupsData = {};
        closePassageEditor();

        // Fetch manifest (lightweight)
        const manifestResp = await fetch('/api/load/manifest?name=' + encodeURIComponent(loadName));
        if (!manifestResp.ok) {
            const err = await manifestResp.json();
            throw new Error(err.detail || 'Failed to load project manifest');
        }
        const manifest = await manifestResp.json();
        state.groupsManifest = manifest;

        // Restore variables from manifest
        for (const [vName, value] of Object.entries(manifest.variables || {})) {
            const type = Array.isArray(value) ? 'array'
                : (value !== null && typeof value === 'object') ? 'dict'
                : typeof value === 'boolean' ? 'bool'
                : typeof value === 'number' ? (Number.isInteger(value) ? 'int' : 'float')
                : 'string';
            state.variables[vName] = { type, value };
        }

        // Restore setup constants from manifest
        for (const [sName, value] of Object.entries(manifest.setup || {})) {
            const type = Array.isArray(value) ? 'array'
                : (value !== null && typeof value === 'object') ? 'dict'
                : typeof value === 'boolean' ? 'bool'
                : typeof value === 'number' ? (Number.isInteger(value) ? 'int' : 'float')
                : 'string';
            state.setupVariables[sName] = { type, value };
        }

        // Load only side_panel group (full node data)
        const sidePanelResp = await fetch('/api/load?name=' + encodeURIComponent(loadName) + '&groups=side_panel');
        if (!sidePanelResp.ok) {
            const err = await sidePanelResp.json();
            throw new Error(err.detail || 'Failed to load side panel');
        }
        const sidePanelProject = await sidePanelResp.json();
        state.isLoading = true;

        // Create side_panel nodes
        const slugToDrawflowId = {};
        for (const node of sidePanelProject.nodes || []) {
            const nodeId = state.editor.addNode(
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
            state.nodesData[nodeId] = {
                title: node.title || '',
                text: node.text || '',
                choices: [],
                on_enter: node.on_enter || null,
                slug: node.id,
                is_start: node.is_start || false,
                is_utility: node.is_utility || false,
                group: node.group || 'side_panel'
            };
            state.slugToNodeId[node.id] = nodeId;
        }

        // Restore connections for side_panel nodes
        for (const node of sidePanelProject.nodes || []) {
            const sourceId = slugToDrawflowId[node.id];
            if (!sourceId) continue;
            for (const choice of node.choices || []) {
                const targetId = slugToDrawflowId[choice.target_node_id];
                if (!targetId) continue;
                state.editor.addConnection(sourceId, targetId, 'output_1', 'input_1');
                state.nodesData[sourceId].choices.push({
                    targetSlug: choice.target_node_id,
                    text: choice.text || '',
                    prerequisite: choice.prerequisite || '',
                    mutation: choice.mutation || ''
                });
            }
        }
        state.loadedGroupIds.add('side_panel');

        // Create portal nodes for every other group
        const otherGroups = (manifest.groups || []).filter(g => g.id !== 'side_panel');
        const portalStartX = 500;
        let portalY = 50;
        for (const group of otherGroups) {
            createPortalNode(group, portalStartX, portalY);
            portalY += 200;
        }
        // Render portal output lines for all created portals
        _refreshPortalOutputs();

        // Batch-refresh connections
        for (const idStr of Object.keys(state.nodesData)) {
            state.editor.updateConnectionNodes('node-' + idStr);
        }
        state.isLoading = false;

        state.currentProjectName = loadName;
        renderVariables();
        refreshAssets();
        ensureSidePanelNode();
        ensureSetupNode();
        for (const nodeIdStr of Object.keys(state.nodesData)) {
            updateStartBadgeOnCanvas(parseInt(nodeIdStr));
            updateUtilityBadgeOnCanvas(parseInt(nodeIdStr));
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
        console.log('Project "' + loadName + '" loaded with ' + otherGroups.length + ' portal groups');
    } catch (err) {
        state.isLoading = false;
        alert('Failed to load project: ' + err.message);
    } finally {
        hideLoader();
    }
}

export async function saveProjectSilent() {
    if (state.selectedNodeId !== null && state.nodesData[state.selectedNodeId]) {
        state.nodesData[state.selectedNodeId].text = getEditorValue();
    }
    const payload = _buildSavePayload(state.currentProjectName);
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

export async function exportGame() {
    if (!state.currentProjectName) {
        alert('Please save the project first before exporting.');
        return;
    }
    showLoader('Exporting...');
    try {
        await saveProjectSilent();
        window.location.href = '/api/export/' + encodeURIComponent(state.currentProjectName);
    } catch (err) {
        alert('Export failed: ' + err.message);
    } finally {
        hideLoader();
    }
}

export async function previewGame() {
    if (!state.currentProjectName) {
        alert('Please save the project first before previewing.');
        return;
    }
    showLoader('Generating preview...');
    try {
        await saveProjectSilent();
        const resp = await fetch('/api/preview/' + encodeURIComponent(state.currentProjectName));
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

// ── Modal helpers ─────────────────────────────────────────────────

export function closeModal() {
    document.getElementById('modal-overlay').style.display = 'none';
    document.getElementById('save-modal').style.display = 'none';
    document.getElementById('load-modal').style.display = 'none';
    document.getElementById('import-modal').style.display = 'none';
    selectedLoadName = null;
}

export function openModal(type) {
    document.getElementById('modal-overlay').style.display = 'flex';
    document.getElementById(type + '-modal').style.display = 'flex';
    if (type === 'save') {
        document.getElementById('save-name-input').value = '';
        document.getElementById('save-name-input').focus();
    }
}

export function showImportModal() {
    openModal('import');
    document.getElementById('import-textarea').value = '';
    const errorEl = document.getElementById('import-error');
    errorEl.style.display = 'none';
    errorEl.textContent = '';
    document.getElementById('import-textarea').classList.remove('has-error');
}

export function importNode() {
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
        const existingId = state.slugToNodeId['side_panel'];
        if (existingId !== undefined) {
            state.editor.removeNodeId('node-' + existingId);
            delete state.nodesData[existingId];
        }
        const x = typeof obj.x === 'number' ? obj.x : 20;
        const y = typeof obj.y === 'number' ? obj.y : 20;
        const nodeId = state.editor.addNode('story_node', 1, 1, x, y, 'story_node', {}, obj.title);
        state.nodesData[nodeId] = {
            title: obj.title,
            text: typeof obj.text === 'string' ? obj.text : '',
            slug: 'side_panel',
            choices: Array.isArray(obj.choices) ? obj.choices.map(c => ({
                text: c.text || '',
                targetSlug: c.targetSlug || c.target_node_id || ''
            })) : [],
            on_enter: (obj.on_enter && typeof obj.on_enter === 'object') ? obj.on_enter : null,
            is_start: false,
            is_utility: false,
            group: 'side_panel'
        };
        state.slugToNodeId['side_panel'] = nodeId;
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

    const nodeId = state.editor.addNode('story_node', 1, 1, x, y, 'story_node', {}, obj.title);

    const choices = Array.isArray(obj.choices) ? obj.choices.map(c => ({
        text: c.text || '',
        targetSlug: c.targetSlug || c.target_node_id || ''
    })) : [];

    const on_enter = (obj.on_enter && typeof obj.on_enter === 'object') ? obj.on_enter : null;
    const is_start = obj.is_start === true;
    const is_utility = obj.is_utility === true;

    state.nodesData[nodeId] = {
        title: obj.title,
        text: typeof obj.text === 'string' ? obj.text : '',
        slug: slug,
        choices: choices,
        on_enter: on_enter,
        is_start: is_start,
        is_utility: is_utility,
        group: obj.group || ''
    };
    state.slugToNodeId[slug] = nodeId;

    if (is_start) {
        for (const [nid, d] of Object.entries(state.nodesData)) {
            if (parseInt(nid) !== nodeId && d.is_start) {
                d.is_start = false;
            }
        }
        updateStartBadgeOnCanvas(nodeId);
    }
    updateUtilityBadgeOnCanvas(nodeId);

    closeModal();
    showToast('Imported node: ' + obj.title);
    runValidation();
}

// ── Keyboard shortcuts ────────────────────────────────────────────

export function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        const tag = e.target.tagName;
        const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable;
        const modKey = e.ctrlKey || e.metaKey;

        // Ctrl+Z — Undo (skip when editing text — let browser handle native undo)
        if (modKey && e.code === 'KeyZ' && !e.shiftKey) {
            if (isInput) return;
            e.preventDefault();
            undo();
            return;
        }

        // Ctrl+Shift+Z or Ctrl+Y — Redo (skip when editing text)
        if (modKey && (e.code === 'KeyY' || (e.code === 'KeyZ' && e.shiftKey))) {
            if (isInput) return;
            e.preventDefault();
            redo();
            return;
        }

        // Ctrl+S — Save
        if (modKey && e.code === 'KeyS' && !e.shiftKey) {
            e.preventDefault();
            if (state.selectedNodeId !== null && state.nodesData[state.selectedNodeId]) {
                state.nodesData[state.selectedNodeId].text = getEditorValue();
            }
            if (!state.currentProjectName) {
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
            if (state.linkingFromId !== null) {
                cancelLinking();
                return;
            }
            const searchInput = document.getElementById('node-search');
            if (searchInput && document.activeElement === searchInput) {
                searchInput.value = '';
                filterNodes('');
                searchInput.blur();
                return;
            }
            const modalOverlay = document.getElementById('modal-overlay');
            if (modalOverlay.style.display !== 'none') {
                closeModal();
                return;
            }
            if (state.selectedNodeId !== null) {
                state.editor.editor_selected = false;
                closePassageEditor();
                if (document.activeElement) document.activeElement.blur();
                return;
            }
            return;
        }
    });
}

// ── Aggregator ────────────────────────────────────────────────────

export function setupDelegation() {
    setupTabs();
    setupModalEvents();
    setupEditorDelegation();
    setupAssetDelegation();
    setupAEToolbar();
    setupVariableDelegation();
    setupNodeOverlayDelegation();
    setupButtonDelegation();
    setupSearch();
    setupContextMenu();
}
