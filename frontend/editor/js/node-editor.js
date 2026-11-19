// frontend/editor/js/node-editor.js
// Passage editor panel, node CRUD, linking, choices/on_enter editors.
import { state, ensureNodeData, getNodeTitleBySlug, getNodeSlug, generateUniqueSlug, getNodeIdBySlug } from './state.js';
import { snapshotState } from './history.js';
import { escapeHtml, escapeRegex, showIdError, hideIdError, showToast } from './ui-utils.js';
import { getEditorValue, setEditorValue, insertAtCursor } from './codemirror-setup.js';
import { openGroupEditor, populateGroupDropdown, _setupNodeCollapseButton, removeNodeFromGroups, collapseGroup, deleteGroupFromPortal, _refreshPortalOutputs } from './group-manager.js';
import { validateDeadEnds, validateOrphans } from './validation.js';

// Remove every choice from `sourceId` that targets `slug`, plus the matching
// `[text](node:slug)` markdown links, and refresh the open editor if needed.
export function stripChoiceAndLink(sourceId, slug) {
    const src = state.nodesData[sourceId];
    if (!src || !slug) return;
    if (src.choices) src.choices = src.choices.filter(c => c.targetSlug !== slug);
    const linkRegex = new RegExp(`\\[[^\\]]*\\]\\(node:${escapeRegex(slug)}\\)`, 'g');
    src.text = (src.text || '').replace(linkRegex, '').replace(/\n{3,}/g, '\n\n').trim();
    if (state.selectedNodeId === sourceId) {
        setEditorValue(src.text);
        renderChoices(sourceId);
    }
}

export function closePassageEditor() {
    state.selectedNodeId = null;
    state.editingPortalNodeId = null;
    document.getElementById('no-selection-msg').style.display = 'block';
    document.getElementById('passage-editor').style.display = 'none';
    document.getElementById('group-editor').style.display = 'none';
}

export function openPassageEditor(nodeId, skipDirtyCheck) {
    if (!skipDirtyCheck && state.selectedNodeId !== null && state.selectedNodeId !== parseInt(nodeId)) {
        const currentData = state.nodesData[state.selectedNodeId];
        if (currentData && getEditorValue() !== currentData.text) {
            saveCurrentContent(state.selectedNodeId);
        }
    }

    const nid = parseInt(nodeId);
    ensureNodeData(nid);
    const data = state.nodesData[nid];
    if (!data) return;

    state.selectedNodeId = nid;
    document.getElementById('no-selection-msg').style.display = 'none';

    // If it's a portal node, open the group editor instead
    if (data.isPortal) {
        document.getElementById('passage-editor').style.display = 'none';
        openGroupEditor(nid);
        return;
    }

    document.getElementById('group-editor').style.display = 'none';
    document.getElementById('passage-editor').style.display = 'block';

    document.getElementById('passage-title').value = data.title || '';
    setEditorValue(data.text || '');
    document.getElementById('passage-id').value = data.slug || '';
    document.getElementById('passage-id-error').style.display = 'none';

    const isStartCheckbox = document.getElementById('passage-is-start');
    const isUtilityCheckbox = document.getElementById('passage-is-utility');
    const isFnCheckbox = document.getElementById('passage-is-fn');
    if (data.slug === 'side_panel' || data.slug === 'setup') {
        isStartCheckbox.style.display = 'none';
        if (isUtilityCheckbox) isUtilityCheckbox.style.display = 'none';
        if (isFnCheckbox) isFnCheckbox.style.display = 'none';
        // The setup node, like side_panel, is a reserved system node: it can
        // never be the start node and is always content-only (is_utility).
        if (data.slug === 'setup') {
            data.is_start = false;
            data.is_utility = true;
            if (isUtilityCheckbox) isUtilityCheckbox.checked = true;
        }
    } else {
        isStartCheckbox.style.display = 'flex';
        if (isUtilityCheckbox) isUtilityCheckbox.style.display = 'flex';
        if (isFnCheckbox) isFnCheckbox.style.display = 'flex';
        if (isStartCheckbox.checked !== !!data.is_start) {
            isStartCheckbox.checked = !!data.is_start;
        }
        if (isUtilityCheckbox && isUtilityCheckbox.checked !== !!data.is_utility) {
            isUtilityCheckbox.checked = !!data.is_utility;
        }
    }

    // Populate group dropdown
    populateGroupDropdown();

    const collapseGroupBtn = document.getElementById('passage-collapse-group-btn');
    if (collapseGroupBtn) {
        if (data.group && data.group !== 'side_panel') {
            collapseGroupBtn.classList.remove('is-hidden');
            collapseGroupBtn.onclick = () => collapseGroup(data.group);
        } else {
            collapseGroupBtn.classList.add('is-hidden');
            collapseGroupBtn.onclick = null;
        }
    }

    if (isFnCheckbox) isFnCheckbox.checked = !!data.is_function;

    renderChoices(nid);
    renderOnEnter(nid);
    renderFnList(nid);
    updateStartBadgeOnCanvas(nid);
    updateUtilityBadgeOnCanvas(nid);
    updateFnBadgeOnCanvas(nid);
    syncFnSectionVisibility();
}

export function propagateSlugRename(oldSlug, newSlug, currentNodeId) {
    if (oldSlug) delete state.slugToNodeId[oldSlug];
    state.slugToNodeId[newSlug] = currentNodeId;
    if (!oldSlug || oldSlug === newSlug) return (txt) => txt || '';

    const mdLinkRe = new RegExp('(\\[[^\\]]*\\]\\(node:)' + escapeRegex(oldSlug) + '(\\))', 'g');
    const dirRe = new RegExp('(\\{(?:redirect|include):\\s*)' + escapeRegex(oldSlug) + '(\\s*\\})', 'gi');
    const rewriteText = (txt) => (txt || '').replace(mdLinkRe, '$1' + newSlug + '$2').replace(dirRe, '$1' + newSlug + '$2');

    for (const [nid, ndata] of Object.entries(state.nodesData)) {
        if (ndata.choices) {
            ndata.choices.forEach(choice => {
                if (choice.targetSlug === oldSlug) {
                    choice.targetSlug = newSlug;
                }
            });
        }
        if (ndata.on_enter && ndata.on_enter.target_node_id === oldSlug) {
            ndata.on_enter.target_node_id = newSlug;
        }
        if (typeof ndata.text === 'string' && ndata.text) {
            ndata.text = rewriteText(ndata.text);
        }
        if (ndata.isPortal && Array.isArray(ndata.portalSlugIds)) {
            ndata.portalSlugIds = ndata.portalSlugIds.map(entry => {
                if (typeof entry === 'string') return entry === oldSlug ? newSlug : entry;
                return {
                    ...entry,
                    slug_id: entry.slug_id === oldSlug ? newSlug : entry.slug_id,
                    connections: Array.isArray(entry.connections)
                        ? entry.connections.map(c => c === oldSlug ? newSlug : c)
                        : []
                };
            });
        }
    }

    for (const [gid, cachedNodes] of Object.entries(state.collapsedGroupsData || {})) {
        if (Array.isArray(cachedNodes)) {
            for (const cn of cachedNodes) {
                if (cn.id === oldSlug) cn.id = newSlug;
                if (Array.isArray(cn.choices)) {
                    for (const c of cn.choices) {
                        if (c.targetSlug === oldSlug) c.targetSlug = newSlug;
                        if (c.target_node_id === oldSlug) c.target_node_id = newSlug;
                    }
                }
                if (cn.on_enter && cn.on_enter.target_node_id === oldSlug) {
                    cn.on_enter.target_node_id = newSlug;
                }
                if (typeof cn.text === 'string' && cn.text) {
                    cn.text = rewriteText(cn.text);
                }
            }
        }
    }

    if (state.groupsManifest && Array.isArray(state.groupsManifest.groups)) {
        for (const g of state.groupsManifest.groups) {
            if (Array.isArray(g.slug_ids)) {
                g.slug_ids = g.slug_ids.map(entry => typeof entry === 'string'
                    ? (entry === oldSlug ? newSlug : entry)
                    : {
                        ...entry,
                        slug_id: entry.slug_id === oldSlug ? newSlug : entry.slug_id,
                        connections: Array.isArray(entry.connections)
                            ? entry.connections.map(c => c === oldSlug ? newSlug : c)
                            : []
                    }
                );
            }
        }
    }

    return rewriteText;
}

export function saveCurrentContent(nodeId) {
    const title = document.getElementById('passage-title').value;
    const content = getEditorValue();
    const nodeData = state.nodesData[nodeId];
    if (!nodeData) return;
    nodeData.title = title;
    nodeData.text = content;
    const isUtilityCheckbox = document.getElementById('passage-is-utility');
    if (isUtilityCheckbox) nodeData.is_utility = isUtilityCheckbox.checked;
    const isFnCheckbox = document.getElementById('passage-is-fn');
    if (isFnCheckbox) nodeData.is_function = isFnCheckbox.checked;
    const slugInput = document.getElementById('passage-id');
    if (slugInput) {
        const newSlug = slugInput.value.trim();
        if (newSlug && newSlug !== nodeData.slug && state.slugToNodeId[newSlug] === undefined) {
            propagateSlugRename(nodeData.slug, newSlug, nodeId);
            nodeData.slug = newSlug;
            if (nodeData.text !== content) {
                setEditorValue(nodeData.text);
            }
            if (state.selectedNodeId === nodeId) {
                renderChoices(nodeId);
                renderOnEnter(nodeId);
            }
        }
    }
}

export function updateCurrentNode() {
    if (!state.selectedNodeId) return;
    snapshotState();

    const title = document.getElementById('passage-title').value;
    let content = getEditorValue();
    const newSlug = document.getElementById('passage-id').value.trim();

    ensureNodeData(state.selectedNodeId);
    const nodeData = state.nodesData[state.selectedNodeId];

    if (!newSlug) {
        showIdError('Node ID cannot be empty');
        return;
    }
    if (newSlug !== nodeData.slug && state.slugToNodeId[newSlug] !== undefined) {
        showIdError('Node ID "' + newSlug + '" is already in use');
        return;
    }

    hideIdError();

    if (newSlug !== nodeData.slug) {
        const oldSlug = nodeData.slug;
        const rewriteText = propagateSlugRename(oldSlug, newSlug, state.selectedNodeId);
        const rewrittenContent = rewriteText(content);
        if (rewrittenContent !== content) {
            content = rewrittenContent;
            setEditorValue(content);
        }
        nodeData.slug = newSlug;
    }

    nodeData.title = title;
    nodeData.text = content;

    nodeData.is_start = document.getElementById('passage-is-start').checked;
    if (nodeData.is_start) {
        for (const [nid, nd] of Object.entries(state.nodesData)) {
            if (parseInt(nid) !== state.selectedNodeId && nd.is_start) {
                nd.is_start = false;
                updateStartBadgeOnCanvas(parseInt(nid));
            }
        }
    }
    const isUtilityCheckbox = document.getElementById('passage-is-utility');
    if (isUtilityCheckbox) nodeData.is_utility = isUtilityCheckbox.checked;
    const isFnCheckbox = document.getElementById('passage-is-fn');
    if (isFnCheckbox) nodeData.is_function = isFnCheckbox.checked;
    updateStartBadgeOnCanvas(state.selectedNodeId);
    updateUtilityBadgeOnCanvas(state.selectedNodeId);
    updateFnBadgeOnCanvas(state.selectedNodeId);
    syncFnSectionVisibility();

    // Sync group from dropdown
    const groupSelect = document.getElementById('passage-group');
    if (groupSelect) {
        nodeData.group = groupSelect.value || '';
        _setupNodeCollapseButton(state.selectedNodeId);
    }

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

    const nodeEl = document.getElementById('node-' + state.selectedNodeId);
    if (nodeEl) {
        const contentEl = nodeEl.querySelector('.drawflow_content_node');
        if (contentEl) contentEl.textContent = title;
    }

    renderChoices(state.selectedNodeId);
    renderOnEnter(state.selectedNodeId);
}

export function addNode() {
    snapshotState();
    try {
        const idx = Object.keys(state.nodesData).length;
        const posX = 40 + (idx % 3) * 220;
        const posY = 120 + Math.floor((idx % 12) / 3) * 100;
        const nodeId = state.editor.addNode(
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
        state.nodesData[nodeId] = { title: 'New Node', text: '', choices: [], slug: slug, is_start: false, is_utility: false, is_function: false, group: '' };
        state.slugToNodeId[slug] = nodeId;
        _setupNodeCollapseButton(nodeId);
        console.log("Created new node:", nodeId, "slug:", slug);
        openPassageEditor(nodeId);
    } catch (err) {
        console.error("Failed to create node:", err);
    }
}

export function deleteCurrentNode() {
    if (state.selectedNodeId === null || state.selectedNodeId === undefined) return;
    const data = state.nodesData[state.selectedNodeId];
    if (data && data.isPortal) {
        deleteGroupFromPortal(state.selectedNodeId);
        return;
    }
    if (data && (data.slug === 'side_panel' || data.slug === 'setup')) {
        showToast((data.slug === 'setup' ? 'Setup' : 'Side Panel') + ' is a reserved node and cannot be deleted');
        return;
    }
    if (confirm("Are you sure you want to delete this node?")) {
        snapshotState();
        const slug = getNodeSlug(state.selectedNodeId);
        const group = state.nodesData[state.selectedNodeId] ? state.nodesData[state.selectedNodeId].group || '' : '';
        state.editor.removeNodeId("node-" + state.selectedNodeId, { notify: true });
        delete state.nodesData[state.selectedNodeId];
        if (slug) delete state.slugToNodeId[slug];
        removeNodeFromGroups(slug, group);
        closePassageEditor();
    }
}

export function deleteNodeOverlay(nodeId) {
    const data = state.nodesData[nodeId];
    if (data && data.isPortal) {
        deleteGroupFromPortal(nodeId);
        return;
    }
    if (data && (data.slug === 'side_panel' || data.slug === 'setup')) {
        showToast((data.slug === 'setup' ? 'Setup' : 'Side Panel') + ' is a reserved node and cannot be deleted');
        return;
    }
    if (confirm("Are you sure you want to delete this node?")) {
        snapshotState();
        const slug = getNodeSlug(nodeId);
        const group = state.nodesData[nodeId] ? state.nodesData[nodeId].group || '' : '';
        state.editor.removeNodeId("node-" + nodeId, { notify: true });
        delete state.nodesData[nodeId];
        if (slug) delete state.slugToNodeId[slug];
        removeNodeFromGroups(slug, group);
        closePassageEditor();
    }
}

export function editNode(nodeId) {
    openPassageEditor(parseInt(nodeId));
    const mdTab = document.querySelector('.tab-btn[data-tab="markdown"]');
    if (mdTab) mdTab.click();
    setTimeout(() => {
        const cmContainer = document.getElementById('passage-content-editor');
        if (state.cmEditor && cmContainer && !cmContainer.classList.contains('is-hidden')) {
            state.cmEditor.refresh();
            state.cmEditor.focus();
        } else {
            const nativeEl = document.getElementById('passage-content-native');
            if (nativeEl) nativeEl.focus();
        }
    }, 0);
}

export function startLinking(nodeId) {
    state.linkingFromId = parseInt(nodeId);
    document.body.classList.add('is-linking');
    console.log(`Entering linking mode from node: ${state.linkingFromId}`);
}

export function cancelLinking() {
    state.linkingFromId = null;
    document.body.classList.remove('is-linking');
    console.log("Linking mode cancelled.");
}

// Link `linkingFromId` → target. Re-linking two nodes that are already linked
// removes the link instead (toggle).
export function handleLinkTargetClick(targetId, inputName) {
    const sourceId = state.linkingFromId;
    if (sourceId === targetId) {
        cancelLinking();
        return;
    }
    const targetData = state.nodesData[targetId];
    let inClass = inputName || 'input_1';
    if (targetData && targetData.isPortal) {
        if (!inputName || !inputName.startsWith('input_')) {
            alert('Cannot link to a portal group. Load the group first, then create connections to individual nodes.');
            cancelLinking();
            return;
        }
        inClass = inputName;
    }
    snapshotState();
    if (state.editor.hasConnection(sourceId, targetId, 'output_1', inClass)) {
        // Existing edge → unlink (connectionRemoved strips choice + markdown).
        state.editor.removeSingleConnection(sourceId, targetId, 'output_1', inClass, { notify: true });
    } else {
        // New edge; if the choice already existed (e.g. cross-group link shown
        // as a portal line) the connectionCreated handler toggles it off.
        state.editor.addConnection(sourceId, targetId, 'output_1', inClass, { notify: true });
    }
    cancelLinking();
}

export function toggleStartNode(checked) {
    if (!state.selectedNodeId) return;
    const nodeData = state.nodesData[state.selectedNodeId];
    if (!nodeData) return;
    if (nodeData.slug === 'side_panel' || nodeData.slug === 'setup') return;
    nodeData.is_start = checked;
    if (checked) {
        for (const [nid, nd] of Object.entries(state.nodesData)) {
            if (parseInt(nid) !== state.selectedNodeId && nd.is_start) {
                nd.is_start = false;
                updateStartBadgeOnCanvas(parseInt(nid));
            }
        }
    }
    updateStartBadgeOnCanvas(state.selectedNodeId);
}

export function toggleUtilityNode(checked) {
    if (state.selectedNodeId == null) return;
    const nodeData = state.nodesData[state.selectedNodeId];
    if (!nodeData) return;
    if (nodeData.slug === 'side_panel' || nodeData.slug === 'setup') return;
    nodeData.is_utility = checked;
    updateUtilityBadgeOnCanvas(state.selectedNodeId);
}

export function updateStartBadgeOnCanvas(nodeId) {
    const nodeEl = document.getElementById('node-' + nodeId);
    if (!nodeEl) return;
    nodeEl.classList.toggle('node-start', !!(state.nodesData[nodeId] && state.nodesData[nodeId].is_start));
}

export function updateUtilityBadgeOnCanvas(nodeId) {
    const nodeEl = document.getElementById('node-' + nodeId);
    if (!nodeEl) return;
    nodeEl.classList.toggle('node-utility', !!(state.nodesData[nodeId] && state.nodesData[nodeId].is_utility));
}

export function updateFnBadgeOnCanvas(nodeId) {
    const nodeEl = document.getElementById('node-' + nodeId);
    if (!nodeEl) return;
    nodeEl.classList.toggle('node-function', !!(state.nodesData[nodeId] && state.nodesData[nodeId].is_function));
}

export function syncFnSectionVisibility() {
    const data = state.nodesData[state.selectedNodeId];
    const isFn = !!(data && data.is_function);
    const fnSection = document.getElementById('fn-section');
    const choicesH3 = document.getElementById('choices-h3');
    const choicesList = document.getElementById('choices-list');
    const onenterSection = document.getElementById('onenter-section');
    if (fnSection) fnSection.classList.toggle('is-hidden', !isFn);
    if (choicesH3) choicesH3.style.display = isFn ? 'none' : '';
    if (choicesList) choicesList.style.display = isFn ? 'none' : '';
    if (onenterSection) onenterSection.style.display = isFn ? 'none' : '';
}

export function toggleFnNode(checked) {
    if (state.selectedNodeId == null) return;
    state.nodesData[state.selectedNodeId].is_function = checked;
    updateFnBadgeOnCanvas(state.selectedNodeId);
    syncFnSectionVisibility();
}

function parseFnCatalogue(text) {
    const out = [];
    const headerRe = /\{fn:?\s*([A-Za-z_][\w$]*)((?:,\s*[A-Za-z_][\w$]*)*)\}/ig;
    let m;
    while ((m = headerRe.exec(text || '')) !== null) {
        const params = m[2] ? m[2].trim().split(/\s*,\s*/).filter(Boolean) : [];
        out.push({ name: m[1], params });
    }
    return out;
}

export function renderFnList(nodeId) {
    const container = document.getElementById('fn-list');
    const data = state.nodesData[nodeId];
    const fns = data ? parseFnCatalogue(data.text || '') : [];
    if (fns.length === 0) {
        container.innerHTML = '<p class="text-muted-sm">No {fn:} blocks found. Use the button or write `{fn: name, p1} … {endfn}` in the body.</p>';
        return;
    }
    container.innerHTML = fns.map(fn =>
        '<div class="choice-card" data-node-id="' + nodeId + '"><div class="choice-header"><span class="choice-target">→ ' +
        escapeHtml(fn.name) + '</span></div><div class="choice-link-text"><em>' +
        escapeHtml(fn.params.length ? '(params) ' + fn.params.join(', ') : '(no params)') +
        '</em></div></div>'
    ).join('');
}

export function insertFnBlock() {
    insertAtCursor('{fn: name, arg1, arg2}\n{return: }\n{endfn}\n');
    if (state.selectedNodeId != null) renderFnList(state.selectedNodeId);
}

export function renderChoices(nodeId) {
    const container = document.getElementById('choices-list');
    const data = state.nodesData[nodeId];
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
                    <span class="choice-target">→ ${escapeHtml(targetTitle)}</span>
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

export function removeChoiceLink(sourceId, targetSlug) {
    snapshotState();
    // 1) Edge to a loaded story node
    const targetId = getNodeIdBySlug(targetSlug);
    if (targetId !== null && targetId !== undefined
        && state.editor.removeSingleConnection(sourceId, targetId, 'output_1', 'input_1', { notify: true })) {
        return;
    }
    // 2) User-drawn edge to a portal slug row
    for (const pid of Object.values(state.portalNodeIds || {})) {
        const pData = state.nodesData[pid];
        if (!pData || !pData.portalSlugIds) continue;
        const idx = pData.portalSlugIds.findIndex(e => (typeof e === 'string' ? e : e.slug_id) === targetSlug);
        if (idx !== -1 && state.editor.removeSingleConnection(sourceId, pid, 'output_1', 'input_' + (idx + 1), { notify: true })) {
            return;
        }
    }
    // 3) No canvas edge (target in an unloaded/collapsed group, or link only in markdown)
    stripChoiceAndLink(sourceId, targetSlug);
    validateDeadEnds();
    validateOrphans();
    _refreshPortalOutputs();
}

export function renderOnEnter(nodeId) {
    const container = document.getElementById('onenter-section');
    const data = state.nodesData[nodeId];
    if (!data) return;

    const onEnter = data.on_enter;
    const isEnabled = !!onEnter;
    const hasTarget = isEnabled && !!onEnter.target_node_id;

    const allSlugs = Object.values(state.slugToNodeId).map(id => state.nodesData[id]?.slug).filter(Boolean);

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
                    return '<option value="' + escapeHtml(slug) + '" ' + (hasTarget && onEnter.target_node_id === slug ? 'selected' : '') + '>' + escapeHtml(title) + ' (' + escapeHtml(slug) + ')</option>';
                }).join('')}
            </select>
            <label for="onenter-condition">Condition (optional JS expression)</label>
            <input type="text" id="onenter-condition" value="${escapeHtml(isEnabled && onEnter.condition ? onEnter.condition : '')}" placeholder="e.g. state.rent_overdue == true" oninput="updateOnEnterField(${nodeId})" onchange="updateOnEnterField(${nodeId})">
            <label for="onenter-mutation">Mutation (optional JS statement)</label>
            <input type="text" id="onenter-mutation" value="${escapeHtml(isEnabled && onEnter.mutation ? onEnter.mutation : '')}" placeholder="e.g. state.triggered = true" oninput="updateOnEnterField(${nodeId})" onchange="updateOnEnterField(${nodeId})">
        </div>
    `;
}

export function toggleOnEnter(nodeId, enabled) {
    if (!state.nodesData[nodeId]) return;
    if (enabled) {
        state.nodesData[nodeId].on_enter = { target_node_id: '', condition: '', mutation: '' };
    } else {
        state.nodesData[nodeId].on_enter = null;
    }
    renderOnEnter(nodeId);
}

export function updateOnEnterField(nodeId) {
    if (!state.nodesData[nodeId] || !state.nodesData[nodeId].on_enter) return;
    const container = document.getElementById('onenter-section');
    state.nodesData[nodeId].on_enter.target_node_id = container.querySelector('#onenter-target').value;
    state.nodesData[nodeId].on_enter.condition = container.querySelector('#onenter-condition').value || null;
    state.nodesData[nodeId].on_enter.mutation = container.querySelector('#onenter-mutation').value || null;
}

export function getNodeTitle(nodeId) {
    if (state.nodesData[nodeId] && state.nodesData[nodeId].title) {
        return state.nodesData[nodeId].title;
    }
    return 'Node ' + nodeId;
}

export function getLinkTextFromContent(content, targetSlug) {
    const regex = new RegExp('\\[([^\\]]*)\\]\\(node:' + escapeRegex(targetSlug) + '\\)');
    const match = content.match(regex);
    return match ? match[1] : '';
}
