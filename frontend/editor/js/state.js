// frontend/editor/js/state.js
// Centralized application state store + slug/node-data helpers.

export const state = {
    editor: null,
    selectedNodeId: null,
    linkingFromId: null,
    nodesData: {},
    slugToNodeId: {},
    variables: {},
    isEditingVariable: false,
    editVariableBackup: null,
    isLoading: false,
    currentProjectName: null,
    cmEditor: null,
    loaderCount: 0,
    toastTimeout: null,
    searchDebounceTimer: null,
    undoStack: [],
    redoStack: [],
    undoInProgress: false,

    // Asset Explorer state
    aeCurrentPath: '',
    aeClipboard: null,
    aeSelectedPaths: new Set(),

    // Group management state
    groupsManifest: null,
    portalNodeIds: {},
    loadedGroupIds: new Set(),
    editingPortalNodeId: null,
    collapsedGroupsData: {},
    portalOutputSvg: {},
    collapsingSlugs: new Set()
};

export function slugify(text) {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'unnamed';
}

export function generateUniqueSlug(baseSlug) {
    let slug = baseSlug;
    let counter = 1;
    while (state.slugToNodeId[slug] !== undefined) {
        counter++;
        slug = baseSlug + '_' + counter;
    }
    return slug;
}

export function getNodeSlug(nodeId) {
    return state.nodesData[nodeId] ? state.nodesData[nodeId].slug : null;
}

export function getNodeIdBySlug(slug) {
    return state.slugToNodeId[slug] || null;
}

export function getNodeTitleBySlug(slug) {
    const nodeId = state.slugToNodeId[slug];
    if (nodeId && state.nodesData[nodeId] && state.nodesData[nodeId].title) {
        return state.nodesData[nodeId].title;
    }
    return slug;
}

export function ensureNodeData(nodeId) {
    if (!state.nodesData[nodeId]) {
        const title = 'Node ' + nodeId;
        state.nodesData[nodeId] = { title: title, text: '', choices: [], slug: generateUniqueSlug(slugify(title)), is_start: false, group: 'side_panel' };
        state.slugToNodeId[state.nodesData[nodeId].slug] = nodeId;
    }
    if (!state.nodesData[nodeId].choices) {
        state.nodesData[nodeId].choices = [];
    }
    if (!state.nodesData[nodeId].actions) {
        state.nodesData[nodeId].actions = [];
    }
    if (state.nodesData[nodeId].on_enter === undefined) {
        state.nodesData[nodeId].on_enter = null;
    }
    if (!state.nodesData[nodeId].slug) {
        state.nodesData[nodeId].slug = generateUniqueSlug(slugify(state.nodesData[nodeId].title || 'Node ' + nodeId));
        state.slugToNodeId[state.nodesData[nodeId].slug] = nodeId;
    }
    if (state.nodesData[nodeId].is_start === undefined) {
        state.nodesData[nodeId].is_start = false;
    }
    if (state.nodesData[nodeId].group === undefined) {
        state.nodesData[nodeId].group = 'side_panel';
    }
}
