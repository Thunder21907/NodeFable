// frontend/editor/js/group-manager.js
// Chapter/group organization, portal node instantiation, collapse/load/move/delete.
import { state } from './state.js';
import { escapeHtml, showToast, showLoader, hideLoader } from './ui-utils.js';
import { validateDeadEnds, validateOrphans } from './validation.js';
import { snapshotState } from './history.js';
import { updateStartBadgeOnCanvas, closePassageEditor } from './node-editor.js';

export function addGroup() {
    // Create a unique group ID
    const baseId = 'chapter';
    let counter = 1;
    let groupId = baseId + '_' + counter;
    if (state.groupsManifest && state.groupsManifest.groups) {
        const existingIds = new Set(state.groupsManifest.groups.map(g => g.id));
        while (existingIds.has(groupId)) {
            counter++;
            groupId = baseId + '_' + counter;
        }
    }

    const label = 'Chapter ' + counter;

    // Add to manifest
    if (!state.groupsManifest) {
        state.groupsManifest = { name: state.currentProjectName || '', version: 2, variables: {}, groups: [] };
    }
    state.groupsManifest.groups = state.groupsManifest.groups || [];
    state.groupsManifest.groups.push({
        id: groupId,
        label: label,
        node_count: 0,
        slug_ids: []
    });

    // Create portal node on canvas
    const posX = Math.floor(Math.random() * 400) + 300;
    const posY = Math.floor(Math.random() * 300) + 50;
    const slugIds = [];
    const ioCount = 1;
    const nodeId = state.editor.addNode(
        'portal_node',
        ioCount,
        ioCount,
        posX,
        posY,
        'portal_node',
        {},
        label + ' (0 nodes)'
    );
    state.portalNodeIds[groupId] = nodeId;
    state.nodesData[nodeId] = {
        title: label,
        text: '',
        choices: [],
        slug: 'portal_' + groupId,
        is_start: false,
        group: groupId,
        isPortal: true,
        portalGroupId: groupId,
        portalGroupLabel: label,
        portalNodeCount: 0,
        portalSlugIds: []
    };
    const el = document.getElementById('node-' + nodeId);
    if (el) {
        el.classList.add('node-portal');
        el.style.opacity = '0.7';
        el.style.borderStyle = 'dashed';
    }
    _labelPortalIO(nodeId, []);
    _setupPortalActions(nodeId);
    _renderPortalOutputs(nodeId);
}

export function openGroupEditor(nodeId) {
    const data = state.nodesData[nodeId];
    if (!data || !data.isPortal) return;

    state.editingPortalNodeId = nodeId;
    document.getElementById('group-editor').style.display = 'block';
    const groupId = data.portalGroupId || '';

    document.getElementById('group-editor-id').value = groupId;
    document.getElementById('group-editor-label').value = data.portalGroupLabel || groupId;

    // Wire blur handlers (remove previous, add fresh)
    const idInput = document.getElementById('group-editor-id');
    const labelInput = document.getElementById('group-editor-label');
    const saveBtn = document.getElementById('group-editor-save');

    idInput.onblur = null;
    labelInput.onblur = null;
    saveBtn.onclick = null;

    idInput.onblur = () => saveGroupEditor();
    labelInput.onblur = () => saveGroupEditor();
    saveBtn.onclick = () => saveGroupEditor();

    // Render the node list
    renderGroupNodeList(groupId);
}

export function saveGroupEditor() {
    const nid = state.editingPortalNodeId;
    if (!nid) return;
    const data = state.nodesData[nid];
    if (!data || !data.isPortal) return;

    const newGroupId = document.getElementById('group-editor-id').value.trim();
    const newLabel = document.getElementById('group-editor-label').value.trim();
    const oldGroupId = data.portalGroupId;

    if (!newGroupId) {
        alert('Group ID cannot be empty.');
        document.getElementById('group-editor-id').value = oldGroupId;
        return;
    }

    const effectiveLabel = newLabel || newGroupId;

    // Update portal node data
    data.portalGroupId = newGroupId;
    data.portalGroupLabel = effectiveLabel;
    state.nodesData[nid].title = effectiveLabel;

    // Update the node title on the canvas
    const nodeEl = document.querySelector(`[data-id="${nid}"] .drawflow-node .node-title`);
    if (nodeEl) {
        const count = _getGroupNodeIds(oldGroupId).length;
        nodeEl.textContent = effectiveLabel + ' (' + count + ' nodes)';
    }

    // Update manifest
    if (state.groupsManifest && state.groupsManifest.groups) {
        let g = state.groupsManifest.groups.find(g => g.id === oldGroupId);
        if (g) {
            // Update label even if ID changed; entry stays keyed by old ID
            g.label = effectiveLabel;
        }
        // If ID changed, also update the entry id
        if (newGroupId !== oldGroupId) {
            g = state.groupsManifest.groups.find(g => g.id === oldGroupId);
            if (g) {
                g.id = newGroupId;
            }
            // Update portalNodeIds mapping
            delete state.portalNodeIds[oldGroupId];
            state.portalNodeIds[newGroupId] = nid;
            // Migrate collapsed group data cache key
            if (state.collapsedGroupsData[oldGroupId]) {
                state.collapsedGroupsData[newGroupId] = state.collapsedGroupsData[oldGroupId];
                delete state.collapsedGroupsData[oldGroupId];
            }
        }
    }

    document.getElementById('group-editor-id').value = newGroupId;

    // Re-render the node list in case group ID changed
    renderGroupNodeList(newGroupId);

    showToast('Group saved');
}

export function renderGroupNodeList(groupId) {
    const container = document.getElementById('group-node-list');
    const nodesInGroup = [];

    const manifestGroup = state.groupsManifest && Array.isArray(state.groupsManifest.groups)
        ? state.groupsManifest.groups.find(g => g.id === groupId)
        : null;

    if (manifestGroup && Array.isArray(manifestGroup.slug_ids)) {
        const cache = state.collapsedGroupsData[groupId] || [];
        for (const entry of manifestGroup.slug_ids) {
            const slug = typeof entry === 'string' ? entry : (entry && entry.slug_id);
            if (!slug) continue;
            const nodeId = state.slugToNodeId[slug];
            if (nodeId !== undefined && state.nodesData[nodeId]) {
                nodesInGroup.push({ id: nodeId, slug, title: state.nodesData[nodeId].title });
            } else {
                const cached = cache.find(n => n.id === slug);
                nodesInGroup.push({ id: null, slug, title: (cached && cached.title) || slug });
            }
        }
    } else {
        // Fallback: group not in the manifest yet — scan loaded canvas nodes
        for (const [nid, nd] of Object.entries(state.nodesData)) {
            if (!nd.isPortal && nd.group === groupId) {
                nodesInGroup.push({ id: nid, slug: nd.slug, title: nd.title });
            }
        }
    }

    if (nodesInGroup.length === 0) {
        container.innerHTML = '<p class="text-muted-sm">No nodes in this group.</p>';
        return;
    }
    let html = '';
    for (const n of nodesInGroup) {
        const idPart = n.id !== null
            ? '<span class="gn-nid">#' + escapeHtml(String(n.id)) + '</span>'
            : '<span class="gn-nid">#&mdash;</span>';
        html += '<div class="group-node-item">'
            + idPart
            + '<span>' + escapeHtml(n.title) + ' <span class="gn-id">(' + escapeHtml(n.slug) + ')</span></span>'
            + '</div>';
    }
    container.innerHTML = html;
}

export function populateGroupDropdown() {
    const select = document.getElementById('passage-group');
    if (!select) return;
    const currentGroup = state.nodesData[state.selectedNodeId] ? state.nodesData[state.selectedNodeId].group || '' : '';

    // Build options from manifest
    let html = '<option value="">— Ungrouped —</option>';
    if (state.groupsManifest && state.groupsManifest.groups) {
        for (const g of state.groupsManifest.groups) {
            const label = g.label || g.id;
            const selected = g.id === currentGroup ? ' selected' : '';
            html += '<option value="' + escapeHtml(g.id) + '"' + selected + '>' + escapeHtml(label) + '</option>';
        }
    }
    select.innerHTML = html;
    select.value = currentGroup;
}

export async function changeNodeGroup(newGroup) {
    if (!state.selectedNodeId) return;
    const data = state.nodesData[state.selectedNodeId];
    if (!data || data.isPortal) return;
    const oldGroup = data.group || '';
    data.group = newGroup || '';
    showToast('Node assigned to group: ' + (newGroup || 'none'));
    _syncGroupMembership(data.slug, oldGroup, newGroup);

    // A group with nodes on canvas is "loaded" — it must not have a portal stub.
    if (newGroup && state.portalNodeIds[newGroup]) {
        const portalId = state.portalNodeIds[newGroup];
        if (state.collapsedGroupsData[newGroup] || state.currentProjectName) {
            await loadGroupFromPortal(portalId);
        } else {
            _removePortalNode(portalId);
        }
    }
}

function _syncGroupMembership(slug, oldGroup, newGroup) {
    if (!slug || !state.groupsManifest || !Array.isArray(state.groupsManifest.groups)) return;
    const groups = state.groupsManifest.groups;

    const matches = (entry) =>
        (typeof entry === 'string' ? entry : entry && entry.slug_id) === slug;

    const removeFrom = (gid) => {
        if (!gid) return;
        const g = groups.find(x => x.id === gid);
        if (g && Array.isArray(g.slug_ids)) {
            g.slug_ids = g.slug_ids.filter(entry => !matches(entry));
        }
    };

    const addTo = (gid) => {
        if (!gid) return;
        let g = groups.find(x => x.id === gid);
        if (!g) {
            g = { id: gid, label: gid.replace(/_/g, ' '), node_count: 0, slug_ids: [] };
            groups.push(g);
        }
        if (!Array.isArray(g.slug_ids)) g.slug_ids = [];
        if (!g.slug_ids.some(matches)) {
            g.slug_ids.push({ slug_id: slug, connections: [] });
        }
    };

    if (oldGroup && oldGroup !== newGroup) removeFrom(oldGroup);
    if (newGroup) addTo(newGroup);
}

export function removeNodeFromGroups(slug, group) {
    if (!slug) return;
    _syncGroupMembership(slug, group, null);
}

function _removePortalNode(portalNodeId) {
    const data = state.nodesData[portalNodeId];
    if (!data || !data.isPortal) return;
    const groupId = data.portalGroupId;

    if (state.portalOutputSvg[portalNodeId]) {
        for (const el of state.portalOutputSvg[portalNodeId]) {
            if (el.parentNode) el.parentNode.removeChild(el);
        }
        delete state.portalOutputSvg[portalNodeId];
    }
    state.editor.removeNodeId('node-' + portalNodeId);
    delete state.nodesData[portalNodeId];
    delete state.portalNodeIds[groupId];

    // Refresh portal output lines for remaining portals
    for (const [pid] of Object.entries(state.portalOutputSvg)) {
        _renderPortalOutputs(parseInt(pid));
    }
}

function _getGroupNodeIds(groupId) {
    const result = [];
    for (const nidStr of Object.keys(state.nodesData)) {
        const nd = state.nodesData[nidStr];
        if (!nd.isPortal && nd.group === groupId) result.push(parseInt(nidStr));
    }
    return result;
}
export async function loadGroupFromPortal(portalNodeId) {
    const data = state.nodesData[portalNodeId];
    if (!data || !data.isPortal) return;
    const groupId = data.portalGroupId;

    if (state.loadedGroupIds.has(groupId)) {
        showToast('Group "' + (data.portalGroupLabel || groupId) + '" is already loaded');
        return;
    }

    try {
        let nodes;
        if (state.collapsedGroupsData[groupId]) {
            nodes = state.collapsedGroupsData[groupId];
            delete state.collapsedGroupsData[groupId];
        } else {
            if (!state.currentProjectName) return;
            const resp = await fetch('/api/load?name=' + encodeURIComponent(state.currentProjectName) + '&groups=' + encodeURIComponent(groupId));
            if (!resp.ok) throw new Error('Failed to load group');
            const project = await resp.json();
            nodes = project.nodes || [];
        }

        // Remove the portal node (and refresh remaining portal output lines)
        _removePortalNode(portalNodeId);

        // Create real nodes for the group (chunked)
        const slugToDrawflowId = {};
        showLoader('Loading ' + nodes.length + ' nodes...');

        const batchSize = Math.min(50, Math.max(10, Math.floor(nodes.length / 10)));
        await createNodesBatched(nodes, (node, nodeId) => {
            slugToDrawflowId[node.id] = nodeId;
            state.nodesData[nodeId] = {
                title: node.title || '',
                text: node.text || '',
                choices: (node.choices || []).map(c => ({
                    // Cached (collapsedGroupsData) choices use `targetSlug`; fetched
                    // group files use `target_node_id`. Accept both.
                    targetSlug: c.target_node_id ?? c.targetSlug,
                    text: c.text || '',
                    prerequisite: c.prerequisite || '',
                    mutation: c.mutation || ''
                })),
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
                is_start: node.is_start || false,
                group: node.group || groupId
            };
            state.slugToNodeId[node.id] = nodeId;
            _setupNodeCollapseButton(nodeId);
        }, batchSize);

        // Collect connections (intra-group + cross-group via slugToNodeId)
        const connections = [];
        for (const node of nodes) {
            const sourceId = slugToDrawflowId[node.id];
            if (!sourceId) continue;
            for (const choice of node.choices || []) {
                const targetSlug = choice.target_node_id ?? choice.targetSlug;
                const targetId = slugToDrawflowId[targetSlug]
                              ?? state.slugToNodeId[targetSlug];
                if (!targetId) continue;
                connections.push({
                    sourceId,
                    targetId,
                    targetSlug,
                    text: choice.text || '',
                    prerequisite: choice.prerequisite || '',
                    mutation: choice.mutation || ''
                });
            }
        }

        // Cross-group connections: existing choices in other loaded nodes targeting slugs in this group
        const targetSlugsInGroup = new Set(nodes.map(n => n.id));
        for (const [srcNidStr, srcData] of Object.entries(state.nodesData)) {
            if (srcData.isPortal) continue;
            if (!state.editor.drawflow.drawflow['Home'].data[parseInt(srcNidStr)]) continue;
            for (const choice of srcData.choices || []) {
                if (targetSlugsInGroup.has(choice.targetSlug)) {
                    const targetId = state.slugToNodeId[choice.targetSlug];
                    if (targetId && !connections.some(c => c.sourceId === parseInt(srcNidStr) && c.targetId === targetId)) {
                        connections.push({
                            sourceId: parseInt(srcNidStr),
                            targetId,
                            targetSlug: choice.targetSlug,
                            text: choice.text || '',
                            prerequisite: choice.prerequisite || '',
                            mutation: choice.mutation || ''
                        });
                    }
                }
            }
        }

        // Draw connections in RAF batches (suppress connectionCreated handler)
        if (connections.length > 0) {
            const lt = document.getElementById('loader-text');
            if (lt) lt.textContent = 'Connecting nodes ' + connections.length + ' total...';
        }
        state.isLoading = true;
        await createConnectionsBatched(connections, (c) => {
            const existing = state.nodesData[c.sourceId] && state.nodesData[c.sourceId].choices.some(ch => ch.targetSlug === c.targetSlug);
            if (!existing) {
                state.nodesData[c.sourceId].choices.push({
                    targetSlug: c.targetSlug,
                    text: c.text,
                    prerequisite: c.prerequisite,
                    mutation: c.mutation
                });
            }
        });
        state.isLoading = false;

        state.loadedGroupIds.add(groupId);

        // Refresh connections for all nodes
        for (const idStr of Object.keys(state.nodesData)) {
            state.editor.updateConnectionNodes('node-' + idStr);
        }

        // Refresh portal output lines so remaining portals re-point to the real
        // nodes now on canvas, and new nodes' choices render on other portals.
        _refreshPortalOutputs();

        // Update start badges
        for (const nodeIdStr of Object.keys(state.nodesData)) {
            updateStartBadgeOnCanvas(parseInt(nodeIdStr));
        }

        // Validate
        requestAnimationFrame(() => {
            validateDeadEnds();
            validateOrphans();
        });

        showToast('Loaded group: ' + (data.portalGroupLabel || groupId));
    } catch (err) {
        alert('Failed to load group: ' + err.message);
    } finally {
        hideLoader();
    }
}

export async function moveToGroupFromPortal(portalNodeId) {
    const data = state.nodesData[portalNodeId];
    if (!data || !data.isPortal) return;
    const targetGroupId = data.portalGroupId;

    if (!state.currentProjectName) return;
    if (!confirm('Move to "' + (data.portalGroupLabel || targetGroupId) + '"? This will unload all other groups except side_panel.')) return;

    showLoader('Switching to group...');
    try {
        state.isLoading = true;

        // Remove all loaded non-side_panel nodes and portals except the target portal
        const idsToRemove = [];
        for (const [idStr, nd] of Object.entries(state.nodesData)) {
            if (nd.slug === 'side_panel') continue;
            if (nd.isPortal && nd.portalGroupId === targetGroupId) continue;
            idsToRemove.push(idStr);
        }
        for (const idStr of idsToRemove) {
            state.editor.removeNodeId('node-' + idStr);
            delete state.nodesData[idStr];
        }
        state.slugToNodeId = { side_panel: state.slugToNodeId['side_panel'] };
        state.loadedGroupIds = new Set();
        // portalNodeIds is cleared by loadGroupFromPortal for the target;
        // clear the rest now.
        for (const [gid, nid] of Object.entries(state.portalNodeIds)) {
            if (gid !== targetGroupId) delete state.portalNodeIds[gid];
        }

        // Load the target group
        await loadGroupFromPortal(portalNodeId);

        // Recreate portal stubs for all other unloaded groups
        const otherGroups = (state.groupsManifest && state.groupsManifest.groups || []).filter(
            g => g.id !== targetGroupId && g.id !== 'side_panel'
        );
        let px = 500, py = 50;
        for (const group of otherGroups) {
            if (!state.loadedGroupIds.has(group.id)) {
                createPortalNode(group, px, py);
                py += 200;
            }
        }
        // Redraw portal output lines once all portal stubs exist
        _refreshPortalOutputs();
        state.isLoading = false;
    } catch (err) {
        state.isLoading = false;
        alert('Failed to switch groups: ' + err.message);
    } finally {
        hideLoader();
    }
}

export async function deleteGroupFromPortal(portalNodeId) {
    const data = state.nodesData[portalNodeId];
    if (!data || !data.isPortal) return;
    const groupId = data.portalGroupId;
    const groupLabel = data.portalGroupLabel || groupId;

    if (!confirm('Delete group "' + groupLabel + '"? All nodes in this group will be removed from the project.')) return;

    // Remove the portal node from canvas
    state.editor.removeNodeId('node-' + portalNodeId);
    delete state.nodesData[portalNodeId];
    delete state.portalNodeIds[groupId];
    delete state.collapsedGroupsData[groupId];

    // Update manifest
    if (state.groupsManifest && state.groupsManifest.groups) {
        state.groupsManifest.groups = state.groupsManifest.groups.filter(g => g.id !== groupId);
    }

    // Redraw remaining portal output lines (they may have connected to this group)
    _refreshPortalOutputs();

    showToast('Group deleted: ' + groupLabel);
}

export function collapseGroup(groupId) {
    if (groupId === 'side_panel') {
        showToast('Cannot collapse the Side Panel');
        return;
    }
    const nodes = _getGroupNodeIds(groupId);
    if (!nodes || nodes.length === 0) {
        showToast('Group "' + groupId + '" has no nodes to collapse');
        return;
    }
    if (!confirm('Collapse group "' + groupId + '" into a portal stub?')) return;

    snapshotState();

    // Collect node data + positions before removal
    const nodeData = [];
    let sumX = 0, sumY = 0;
    for (const nid of nodes) {
        const data = state.nodesData[nid];
        if (!data) continue;
        const drawflowNode = state.editor.drawflow.drawflow['Home'].data[nid];
        if (!drawflowNode) continue;
        nodeData.push({
            id: data.slug,
            title: data.title,
            text: data.text,
            choices: (data.choices || []).map(c => ({
                targetSlug: c.targetSlug,
                text: c.text || '',
                prerequisite: c.prerequisite || '',
                mutation: c.mutation || ''
            })),
            actions: (data.actions || []).map(a => ({
                id: a.id,
                text: a.text || '',
                pairs: a.pairs || []
            })),
            on_enter: data.on_enter || null,
            is_start: data.is_start || false,
            group: data.group || groupId,
            x: drawflowNode.pos_x,
            y: drawflowNode.pos_y
        });
        sumX += drawflowNode.pos_x;
        sumY += drawflowNode.pos_y;
    }

    if (nodeData.length === 0) {
        showToast('No valid nodes found in group "' + groupId + '"');
        return;
    }

    // Cache collapsed data
    state.collapsedGroupsData[groupId] = nodeData;

    // Preserve cross-group choices that target this group's slugs while its
    // nodes are removed (nodeRemoved normally strips them). The slug set is
    // cleared once the portal stub is in place.
    for (const nid of nodes) {
        const slug = state.nodesData[nid]?.slug;
        if (slug) state.collapsingSlugs.add(slug);
    }

    // Remove nodes from canvas
    for (const nid of nodes) {
        const slug = state.nodesData[nid]?.slug;
        state.editor.removeNodeId('node-' + nid);
        delete state.nodesData[nid];
        if (slug) delete state.slugToNodeId[slug];
    }
    state.loadedGroupIds.delete(groupId);

    // Create portal at geometric center
    const centerX = sumX / nodeData.length;
    const centerY = sumY / nodeData.length;
    const label = (state.groupsManifest?.groups?.find(g => g.id === groupId)?.label) || groupId;
    createPortalNode({ id: groupId, label, node_count: nodeData.length, slug_ids: nodeData.map(n => ({slug_id: n.id, connections: (n.choices || []).map(c => c.targetSlug).filter(Boolean)})) }, centerX, centerY);

    state.collapsingSlugs.clear();

    // Redraw all portal output lines: the new portal's inbound/outbound lines
    // plus any other portals that connect to this group.
    _refreshPortalOutputs();

    showToast('Collapsed group: ' + groupId);

    // Close editor if the selected node was in this group
    if (state.selectedNodeId !== null && state.nodesData[state.selectedNodeId] === undefined) {
        closePassageEditor();
    }
}

export function _setupNodeCollapseButton(nodeId) {
    const nodeEl = document.getElementById('node-' + nodeId);
    if (!nodeEl) return;

    const data = state.nodesData[nodeId];
    if (!data || data.isPortal || !data.group || data.group === 'side_panel') return;

    // Remove existing collapse button if any (idempotent)
    const existing = nodeEl.querySelector('.node-collapse-btn');
    if (existing) existing.remove();

    const btn = document.createElement('button');
    btn.className = 'node-collapse-btn';
    btn.title = 'Collapse Group "' + data.group + '"';
    btn.textContent = '\u2B06';
    nodeEl.appendChild(btn);

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        collapseGroup(data.group);
    });
}

export function createPortalNode(group, posX, posY) {
    try {
        const label = group.label || group.id;
        const count = group.node_count || 0;
        const slugIds = group.slug_ids || [];
        const ioCount = Math.max(1, slugIds.length);
        const nodeId = state.editor.addNode(
            'portal_node',
            ioCount,
            ioCount,
            posX || 300,
            posY || 100,
            'portal_node',
            {},
            label + ' (' + count + ' nodes)'
        );
        state.portalNodeIds[group.id] = nodeId;
        // Store the group data on the portal node
        state.nodesData[nodeId] = {
            title: label,
            text: '',
            choices: [],
            slug: 'portal_' + group.id,
            is_start: false,
            group: group.id,
            isPortal: true,
            portalGroupId: group.id,
            portalGroupLabel: label,
            portalNodeCount: count,
            portalSlugIds: group.slug_ids || []
        };
        // Apply portal styling
        const el = document.getElementById('node-' + nodeId);
        if (el) {
            el.classList.add('node-portal');
            el.style.opacity = '0.7';
            el.style.borderStyle = 'dashed';
        }
        // Label I/O circles with slug names
        _labelPortalIO(nodeId, slugIds);
        _setupPortalActions(nodeId);
        _renderPortalOutputs(nodeId);
        console.log('Created portal node for group:', group.id, 'nodeId:', nodeId);
        return nodeId;
    } catch (err) {
        console.error('Failed to create portal node for group:', group.id, err);
        return null;
    }
}

export function _labelPortalIO(nodeId, slugIds) {
    const nodeEl = document.getElementById('node-' + nodeId);
    if (!nodeEl) return;
    for (let i = 0; i < slugIds.length; i++) {
        const slug = slugIds[i].slug_id;
        const inputEl = nodeEl.querySelector('.input_' + (i + 1));
        if (inputEl) { inputEl.title = slug; inputEl.dataset.slug = slug; }
        const outputEl = nodeEl.querySelector('.output_' + (i + 1));
        if (outputEl) { outputEl.title = slug; outputEl.dataset.slug = slug; }
    }

    // Rewrite content node with slug labels aligned to I/O rows
    const data = state.nodesData[nodeId];
    if (!data) return;

    // Override flex centering so content aligns with I/O circles at top
    nodeEl.style.alignItems = 'flex-start';

    const contentEl = nodeEl.querySelector('.drawflow_content_node');
    if (!contentEl) return;
    // Match I/O circle layout: height:20px + border:2px*2 + margin-bottom:5px = 29px
    const rowHeight = 29;
    const offset = 2; // matches .input { top: 2px }
    const totalHeight = (slugIds.length * rowHeight) + offset + 4;
    contentEl.style.position = 'relative';
    contentEl.style.padding = '0';
    contentEl.style.margin = '0';
    contentEl.style.height = totalHeight + 'px';
    contentEl.style.overflow = 'visible';
    contentEl.innerHTML = '';
    for (let i = 0; i < slugIds.length; i++) {
        const slugEl = document.createElement('div');
        slugEl.className = 'p-row p-slug';
        slugEl.style.top = (offset + i * rowHeight) + 'px';
        slugEl.textContent = slugIds[i].slug_id;
        contentEl.appendChild(slugEl);
    }
}

export function _renderPortalOutputs(portalNodeId) {
    // Clean up existing portal output lines for this node
    if (state.portalOutputSvg[portalNodeId]) {
        for (const el of state.portalOutputSvg[portalNodeId]) {
            if (el.parentNode) el.parentNode.removeChild(el);
        }
    }
    state.portalOutputSvg[portalNodeId] = [];

    const data = state.nodesData[portalNodeId];
    if (!data || !data.isPortal) return;
    const slugIds = data.portalSlugIds || [];
    if (slugIds.length === 0) return;

    const portalEl = document.getElementById('node-' + portalNodeId);
    if (!portalEl) return;

    const ownSlugs = new Set(slugIds.map(s => (typeof s === 'string' ? s : s.slug_id)));

    for (let i = 0; i < slugIds.length; i++) {
        const entry = slugIds[i];
        const slug = typeof entry === 'string' ? entry : entry.slug_id;
        const connections = typeof entry === 'string' ? [] : (entry.connections || []);
        const outputEl = portalEl.querySelector('.output_' + (i + 1));
        if (!outputEl) continue;

        // Inbound: loaded nodes that have a choice targeting this slug.
        // Drawn directed: from the loaded node's output_1 to the portal's
        // input circle for this slug row.
        const portalInputEl = portalEl.querySelector('.input_' + (i + 1));
        const seenSources = new Set();
        for (const [nidStr, nd] of Object.entries(state.nodesData)) {
            if (nd.isPortal) continue;
            // Only consider nodes that are on the canvas
            if (!state.editor.drawflow.drawflow['Home'].data[parseInt(nidStr)]) continue;
            const choices = nd.choices || [];
            if (!choices.some(c => c.targetSlug === slug)) continue;

            const sourceNid = parseInt(nidStr);
            if (seenSources.has(sourceNid)) continue;
            seenSources.add(sourceNid);
            const sourceEl = document.getElementById('node-' + sourceNid);
            if (!sourceEl || !portalInputEl) continue;
            const sourceOutputEl = sourceEl.querySelector('.output_1');
            if (!sourceOutputEl) continue;
            _drawPortalOutputLine(portalNodeId, sourceOutputEl, portalInputEl);
        }

        // Outbound: connections from this slug to other slugs (from the manifest)
        const seenTargets = new Set();
        for (const targetSlug of connections) {
            if (!targetSlug || ownSlugs.has(targetSlug)) continue; // intra-group → internal
            if (seenTargets.has(targetSlug)) continue;
            seenTargets.add(targetSlug);
            const targetEl = _resolvePortalTargetEl(targetSlug, portalNodeId);
            if (!targetEl) continue;
            _drawPortalOutputLine(portalNodeId, outputEl, targetEl);
        }
    }
}

function _resolvePortalTargetEl(targetSlug, currentPortalId) {
    // Priority 1: loaded passage node on the canvas → its input circle
    const loadedId = state.slugToNodeId[targetSlug];
    if (loadedId !== undefined) {
        const el = document.getElementById('node-' + loadedId);
        if (el && state.editor.drawflow.drawflow['Home'].data[loadedId]) {
            const inputEl = el.querySelector('.input_1');
            if (inputEl) return inputEl;
            return el;
        }
    }
    // Priority 2: another collapsed portal that contains this slug → its input circle
    for (const [gid, pid] of Object.entries(state.portalNodeIds)) {
        if (parseInt(pid) === currentPortalId) continue;
        const pData = state.nodesData[pid];
        if (!pData || !pData.portalSlugIds) continue;
        const idx = pData.portalSlugIds.findIndex(s => (typeof s === 'string' ? s : s.slug_id) === targetSlug);
        if (idx === -1) continue;
        const portalEl = document.getElementById('node-' + pid);
        if (!portalEl) continue;
        const inputEl = portalEl.querySelector('.input_' + (idx + 1));
        if (inputEl) return inputEl;
    }
    return null;
}

function _drawPortalOutputLine(portalNodeId, outputEl, targetEl) {
    const precanvas = state.editor.precanvas;
    if (!precanvas) return;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('connection', 'portal-output');
    svg.style.position = 'absolute';
    svg.style.overflow = 'visible';
    svg.style.pointerEvents = 'none';
    svg.style.zIndex = '0';

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.classList.add('main-path');
    svg.appendChild(path);

    precanvas.appendChild(svg);
    state.portalOutputSvg[portalNodeId].push(svg);
    svg._portalRefs = { outputEl, targetEl };
    _positionPortalOutputLine(svg, outputEl, targetEl);
}

export function _refreshPortalOutputs() {
    for (const [pidStr] of Object.entries(state.portalOutputSvg)) {
        _renderPortalOutputs(parseInt(pidStr));
    }
}

function _positionPortalOutputLineSync(svg, outputEl, targetEl) {
    const precanvas = state.editor.precanvas;
    if (!precanvas) return;
    // Mirror Drawflow's updateConnectionNodes math: convert screen-space
    // offsets back into the precanvas's untransformed coordinate space.
    const zoom = state.editor.zoom || 1;
    const scaleX = (precanvas.clientWidth / (precanvas.clientWidth * zoom)) || 0;
    const scaleY = (precanvas.clientHeight / (precanvas.clientHeight * zoom)) || 0;
    const precanvasRect = precanvas.getBoundingClientRect();
    const outRect = outputEl.getBoundingClientRect();
    const tgtRect = targetEl.getBoundingClientRect();

    const x1 = (outRect.left - precanvasRect.left + outRect.width / 2) * scaleX;
    const y1 = (outRect.top - precanvasRect.top + outRect.height / 2) * scaleY;
    const x2 = (tgtRect.left - precanvasRect.left + tgtRect.width / 2) * scaleX;
    const y2 = (tgtRect.top - precanvasRect.top + tgtRect.height / 2) * scaleY;

    const minX = Math.min(x1, x2);
    const minY = Math.min(y1, y2);
    const w = Math.max(Math.abs(x2 - x1), 1);
    const h = Math.max(Math.abs(y2 - y1), 1);

    svg.style.left = minX + 'px';
    svg.style.top = minY + 'px';
    svg.style.width = w + 'px';
    svg.style.height = h + 'px';

    const path = svg.querySelector('.main-path');
    if (!path) return;
    const relX1 = x1 - minX;
    const relY1 = y1 - minY;
    const relX2 = x2 - minX;
    const relY2 = y2 - minY;
    const cx = relX1 + (relX2 - relX1) * 0.5;
    path.setAttribute('d', `M${relX1},${relY1} C${cx},${relY1} ${cx},${relY2} ${relX2},${relY2}`);
}

export function _positionPortalOutputLine(svg, outputEl, targetEl) {
    requestAnimationFrame(() => _positionPortalOutputLineSync(svg, outputEl, targetEl));
}

export function _repositionPortalOutputs() {
    for (const [pidStr, lines] of Object.entries(state.portalOutputSvg)) {
        if (!Array.isArray(lines)) continue;
        for (const svg of lines) {
            if (!svg || !svg._portalRefs) continue;
            _positionPortalOutputLineSync(svg, svg._portalRefs.outputEl, svg._portalRefs.targetEl);
        }
    }
}

export function _setupPortalActions(portalNodeId) {
    const nodeEl = document.getElementById('node-' + portalNodeId);
    if (!nodeEl) return;

    // Remove the default Drawflow delete button
    const oldDelete = nodeEl.querySelector('.drawflow-delete');
    if (oldDelete) oldDelete.remove();

    // Remove existing portal-actions if any (idempotent)
    const existing = nodeEl.querySelector('.portal-actions');
    if (existing) existing.remove();

    const actions = document.createElement('div');
    actions.classList.add('portal-actions');
    actions.innerHTML = `
        <button class="portal-action-btn" title="Load Group" data-portal-action="load">&#11015;</button>
        <button class="portal-action-btn" title="Move to Group" data-portal-action="move">&#10145;</button>
        <button class="portal-action-btn danger" title="Delete Group" data-portal-action="delete">&#10005;</button>
    `;
    nodeEl.appendChild(actions);

    actions.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-portal-action]');
        if (!btn) return;
        e.stopPropagation();

        switch (btn.dataset.portalAction) {
            case 'load':
                loadGroupFromPortal(portalNodeId);
                break;
            case 'move':
                moveToGroupFromPortal(portalNodeId);
                break;
            case 'delete':
                deleteGroupFromPortal(portalNodeId);
                break;
        }
    });
}

export function portalNodeHasGroupId(drawflowNodeId) {
    const data = state.nodesData[drawflowNodeId];
    return data && data.isPortal ? data.portalGroupId : null;
}

// ── Chunked rendering helpers ─────────────────────────────────────

export function createNodesBatched(nodes, onNodeCreated, batchSize) {
    batchSize = batchSize || 50;
    const slugToDrawflowId = {};
    let index = 0;
    let totalCreated = 0;
    const total = nodes.length;

    return new Promise((resolve) => {
        function processBatch() {
            const end = Math.min(index + batchSize, total);
            const batch = nodes.slice(index, end);

            for (const node of batch) {
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
                if (onNodeCreated) onNodeCreated(node, nodeId);
                totalCreated++;
            }

            index = end;

            if (index < total) {
                requestAnimationFrame(processBatch);
                return;
            }
            resolve(slugToDrawflowId);
        }

        if (total === 0) {
            resolve(slugToDrawflowId);
            return;
        }

        requestAnimationFrame(processBatch);
    });
}

export function createConnectionsBatched(connections, onConnectionCreated, batchSize) {
    batchSize = batchSize || 100;
    let index = 0;
    const total = connections.length;
    return new Promise((resolve) => {
        function processBatch() {
            const end = Math.min(index + batchSize, total);
            for (let i = index; i < end; i++) {
                const c = connections[i];
                state.editor.addConnection(c.sourceId, c.targetId, 'output_1', 'input_1');
                if (onConnectionCreated) onConnectionCreated(c);
            }
            index = end;
            if (index < total) {
                const lt = document.getElementById('loader-text');
                if (lt) lt.textContent = 'Connecting nodes ' + index + '/' + total + '...';
                requestAnimationFrame(processBatch);
            } else {
                resolve();
            }
        }
        if (total === 0) { resolve(); return; }
        requestAnimationFrame(processBatch);
    });
}
