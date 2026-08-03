// frontend/editor/js/node-editor.js
// Passage editor panel, node CRUD, linking, choices/on_enter editors.
import { state, ensureNodeData, getNodeTitleBySlug, getNodeSlug, generateUniqueSlug, getNodeIdBySlug } from './state.js';
import { snapshotState } from './history.js';
import { escapeHtml, escapeRegex, showIdError, hideIdError } from './ui-utils.js';
import { getEditorValue, setEditorValue } from './codemirror-setup.js';
import { openGroupEditor, populateGroupDropdown, _setupNodeCollapseButton, removeNodeFromGroups } from './group-manager.js';

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
    if (data.slug === 'side_panel') {
        isStartCheckbox.style.display = 'none';
        if (isUtilityCheckbox) isUtilityCheckbox.style.display = 'none';
    } else {
        isStartCheckbox.style.display = 'flex';
        if (isUtilityCheckbox) isUtilityCheckbox.style.display = 'flex';
        if (isStartCheckbox.checked !== !!data.is_start) {
            isStartCheckbox.checked = !!data.is_start;
        }
        if (isUtilityCheckbox && isUtilityCheckbox.checked !== !!data.is_utility) {
            isUtilityCheckbox.checked = !!data.is_utility;
        }
    }

    // Populate group dropdown
    populateGroupDropdown();

    renderChoices(nid);
    renderOnEnter(nid);
    updateStartBadgeOnCanvas(nid);
    updateUtilityBadgeOnCanvas(nid);
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
    const slugInput = document.getElementById('passage-id');
    if (slugInput) {
        const newSlug = slugInput.value.trim();
        if (newSlug && newSlug !== nodeData.slug) {
            delete state.slugToNodeId[nodeData.slug];
            state.slugToNodeId[newSlug] = nodeId;
            nodeData.slug = newSlug;
        }
    }
}

export function updateCurrentNode() {
    if (!state.selectedNodeId) return;
    snapshotState();

    const title = document.getElementById('passage-title').value;
    const content = getEditorValue();
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

        delete state.slugToNodeId[oldSlug];
        state.slugToNodeId[newSlug] = state.selectedNodeId;

        for (const [nid, ndata] of Object.entries(state.nodesData)) {
            if (ndata.choices) {
                ndata.choices.forEach(choice => {
                    if (choice.targetSlug === oldSlug) {
                        choice.targetSlug = newSlug;
                    }
                });
            }
        }

        for (const [nid, ndata] of Object.entries(state.nodesData)) {
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
        for (const [nid, nd] of Object.entries(state.nodesData)) {
            if (parseInt(nid) !== state.selectedNodeId && nd.is_start) {
                nd.is_start = false;
                updateStartBadgeOnCanvas(parseInt(nid));
            }
        }
    }
    const isUtilityCheckbox = document.getElementById('passage-is-utility');
    if (isUtilityCheckbox) nodeData.is_utility = isUtilityCheckbox.checked;
    updateStartBadgeOnCanvas(state.selectedNodeId);
    updateUtilityBadgeOnCanvas(state.selectedNodeId);

    // Sync group from dropdown
    const groupSelect = document.getElementById('passage-group');
    if (groupSelect) {
        nodeData.group = groupSelect.value || '';
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
        if (contentEl) contentEl.innerHTML = title;
    }

    renderChoices(state.selectedNodeId);
    renderOnEnter(state.selectedNodeId);
}

export function addNode() {
    snapshotState();
    try {
        const posX = Math.floor(Math.random() * 400) + 50;
        const posY = Math.floor(Math.random() * 300) + 50;
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
        state.nodesData[nodeId] = { title: 'New Node', text: '', choices: [], slug: slug, is_start: false, is_utility: false, group: '' };
        state.slugToNodeId[slug] = nodeId;
        _setupNodeCollapseButton(nodeId);
        console.log("Created new node:", nodeId, "slug:", slug);
        openPassageEditor(nodeId);
    } catch (err) {
        console.error("Failed to create node:", err);
    }
}

export function deleteCurrentNode() {
    if (!state.selectedNodeId) return;
    if (confirm("Are you sure you want to delete this node?")) {
        snapshotState();
        const slug = getNodeSlug(state.selectedNodeId);
        const group = state.nodesData[state.selectedNodeId] ? state.nodesData[state.selectedNodeId].group || '' : '';
        state.editor.removeNodeId("node-" + state.selectedNodeId);
        delete state.nodesData[state.selectedNodeId];
        if (slug) delete state.slugToNodeId[slug];
        removeNodeFromGroups(slug, group);
        closePassageEditor();
    }
}

export function deleteNodeOverlay(nodeId) {
    if (confirm("Are you sure you want to delete this node?")) {
        snapshotState();
        const slug = getNodeSlug(nodeId);
        const group = state.nodesData[nodeId] ? state.nodesData[nodeId].group || '' : '';
        state.editor.removeNodeId("node-" + nodeId);
        delete state.nodesData[nodeId];
        if (slug) delete state.slugToNodeId[slug];
        removeNodeFromGroups(slug, group);
        closePassageEditor();
    }
}

export function editNode(nodeId) {
    openPassageEditor(parseInt(nodeId));
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

export function handleLinkTargetClick(targetId, inputName) {
    if (state.linkingFromId === targetId) {
        cancelLinking();
        return;
    }
    const targetData = state.nodesData[targetId];
    if (targetData && targetData.isPortal) {
        if (inputName && inputName.startsWith('input_')) {
            // Allow connection to portal input — handled in connectionCreated
            snapshotState();
            state.editor.addConnection(state.linkingFromId, targetId, 'output_1', inputName);
            cancelLinking();
            return;
        }
        alert('Cannot link to a portal group. Load the group first, then create connections to individual nodes.');
        cancelLinking();
        return;
    }
    snapshotState();
    state.editor.addConnection(state.linkingFromId, targetId, 'output_1', inputName || 'input_1');
    console.log(`Linked Node ${state.linkingFromId} -> Node ${targetId}`);
    cancelLinking();
}

export function toggleStartNode(checked) {
    if (!state.selectedNodeId) return;
    const nodeData = state.nodesData[state.selectedNodeId];
    if (!nodeData) return;
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
    state.nodesData[state.selectedNodeId].is_utility = checked;
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

export function removeChoiceLink(sourceId, targetSlug) {
    const targetId = getNodeIdBySlug(targetSlug);
    if (targetId === null) return;
    state.editor.removeSingleConnection(sourceId, targetId, 'output_1', 'input_1');
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
