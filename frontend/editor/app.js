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
let cmEditor = null;
let loaderCount = 0;
let toastTimeout = null;
let searchDebounceTimer = null;
const MAX_UNDO = 50;
let undoStack = [];
let redoStack = [];
let undoInProgress = false;

// Asset Explorer state
let aeCurrentPath = '';
let aeClipboard = null;
let aeSelectedPaths = new Set();

// Group management state
let groupsManifest = null;
let portalNodeIds = {};
let loadedGroupIds = new Set();
let groupNodeIds = {};
let editingPortalNodeId = null;
let collapsedGroupsData = {};
let portalOutputSvg = {};

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

// ── CodeMirror custom mode: NodeFable (markdown + overlay) ──────────

CodeMirror.defineMode('nodefable', function (config) {
    const markdown = CodeMirror.getMode(config, 'markdown');
    return CodeMirror.overlayMode(markdown, {
        token: function (stream) {
            // {if: ...} / {elseif: ...} / {else} / {endif}
            if (stream.match(/^\{(if|elseif|else|endif)\b[^}]*\}/i)) return 'keyword';
            // {set: ...}
            if (stream.match(/^\{set:[^}]*\}/i)) return 'keyword';
            // {redirect: ...}
            if (stream.match(/^\{redirect:[^}]*\}/i)) return 'keyword';
            // {random:...}
            if (stream.match(/^\{random:\d+(?:,\d+)?\}/i)) return 'builtin';
            // {var:state.var} / {var state.var}
            if (stream.match(/^\{var:?\s*state\.\w+\}/i)) return 'variable-2';
            // {textfield:...} / {checkbox:...} / {radiogroup} / {endradiogroup} / {radiobutton:...}
            if (stream.match(/^\{textfield:[^}]*\}/i)) return 'keyword';
            if (stream.match(/^\{checkbox:[^}]*\}/i)) return 'keyword';
            if (stream.match(/^\{radiogroup\}/i)) return 'keyword';
            if (stream.match(/^\{endradiogroup\}/i)) return 'keyword';
            if (stream.match(/^\{radiobutton:[^}]*\}/i)) return 'keyword';
            // {wait:...} / {endwait}
            if (stream.match(/^\{wait:\d+(?:,\s*fade:\d+)?\}[^}]*\{endwait\}/i)) return 'keyword';
            if (stream.match(/^\{endwait\}/i)) return 'keyword';
            // {dialogue:...} / {enddialogue}
            if (stream.match(/^\{dialogue:[^}]*\}/i)) return 'keyword';
            if (stream.match(/^\{enddialogue\}/i)) return 'keyword';
            // {img:...}
            if (stream.match(/^\{img:[^}]*\}/i)) return 'keyword';
            // state.varname
            if (stream.match(/state\.\w+/)) return 'variable-2';
            // notify( / game.newGame(
            if (stream.match(/\b(notify|game\.newGame)\s*\(/)) return 'builtin';
            // true / false
            if (stream.match(/\b(true|false)\b/)) return 'atom';
            // number
            if (stream.match(/\b\d+\.?\d*\b/)) return 'number';
            stream.next();
            return null;
        }
    }, true);
});

// ── CodeMirror autocomplete hint provider ──────────────────────────

CodeMirror.registerHelper('hint', 'nodeFableHint', function (cm) {
    const cursor = cm.getDoc().getCursor();
    const token = cm.getTokenAt(cursor);
    const line = cm.getLine(cursor.line);
    const lineBefore = line.slice(0, cursor.ch);
    const lineAfter = line.slice(cursor.ch);

    let list = [];
    let from = { line: cursor.line, ch: cursor.ch };
    let to = { line: cursor.line, ch: cursor.ch };

    // Detect context: inside [...](node:slug| or [...](action:id|
    const linkMatch = lineBefore.match(/\[[^\]]*\]\(((node:|action:)?([^)]*))$/);
    if (linkMatch && linkMatch[1]) {
        const full = linkMatch[1];
        const prefix = linkMatch[2] || '';
        const typed = linkMatch[3] || '';
        if (prefix === 'node:') {
            from.ch = cursor.ch - typed.length;
            for (const slug of Object.keys(slugToNodeId)) {
                if (slug.startsWith(typed)) {
                    list.push({ text: slug, displayText: slug });
                }
            }
            return { list, from, to };
        }
        if (prefix === 'action:') {
            from.ch = cursor.ch - typed.length;
            for (const nodeId in nodesData) {
                for (const action of (nodesData[nodeId].actions || [])) {
                    if (action.id && action.id.startsWith(typed)) {
                        list.push({ text: action.id, displayText: action.id });
                    }
                }
            }
            return { list, from, to };
        }
        if (!prefix) {
            from.ch = cursor.ch - full.length;
            list.push({ text: 'node:', displayText: 'node:' });
            list.push({ text: 'action:', displayText: 'action:' });
            return { list, from, to };
        }
    }

    // Detect context: state. inside {if ...} or assignment
    const varMatch = lineBefore.match(/(?:state\.)(\w*)$/);
    if (varMatch) {
        from.ch = cursor.ch - (varMatch[1] ? varMatch[1].length : 0);
        const prefix = varMatch[1] || '';
        // When already past "state.", suggest variable names
        for (const vName of Object.keys(variables)) {
            if (vName.startsWith(prefix)) {
                list.push({ text: vName, displayText: vName });
            }
        }
        return { list, from, to };
    }

    // Detect context: inside mutations - suggest state.
    if (lineBefore.match(/(?:^|\s)(state\.?)$/)) {
        const wordMatch = lineBefore.match(/(state\.?)$/);
        if (wordMatch) {
            from.ch = cursor.ch - wordMatch[1].length;
            list.push({ text: 'state.', displayText: 'state.' });
            return { list, from, to };
        }
    }

    // General word completion for keywords
    const wordMatch = lineBefore.match(/(\w*)$/);
    if (wordMatch) {
        const prefix = wordMatch[1];
        if (!prefix) return null;
        from.ch = cursor.ch - prefix.length;
        const keywords = ['if:', 'elseif:', 'else', 'endif', 'set:', 'redirect:', 'random:',
            'textfield:', 'checkbox:', 'radiogroup', 'radiobutton:',
            'var:', 'wait:', 'endwait', 'dialogue:', 'enddialogue', 'img:',
            'true', 'false', 'notify(', 'game.newGame()'];
        for (const kw of keywords) {
            if (kw.startsWith(prefix)) {
                list.push({ text: kw, displayText: kw });
            }
        }
        return { list, from, to };
    }

    return null;
});

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

    // Reposition portal output lines on zoom
    container.addEventListener('wheel', (e) => {
        if (e.ctrlKey || e.metaKey) {
            requestAnimationFrame(() => _refreshPortalOutputs());
        }
    });

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

    // Initialize CodeMirror editor
    cmEditor = CodeMirror(document.getElementById('passage-content-editor'), {
        mode: 'nodefable',
        theme: 'material-darker',
        lineNumbers: true,
        lineWrapping: true,
        matchBrackets: true,
        viewportMargin: Infinity,
        extraKeys: {
            "Enter": "newlineAndIndentContinueMarkdownList",
            "Ctrl-Space": "autocomplete"
        },
        hintOptions: {
            hint: CodeMirror.hint.nodeFableHint,
            completeSingle: false
        }
    });

    // Auto-save content on CM change (also syncs native textarea for toggle)
    cmEditor.on('change', () => {
        document.getElementById('passage-content-native').value = cmEditor.getValue();
        if (selectedNodeId === null) return;
        const data = nodesData[selectedNodeId];
        if (data) {
            data.text = cmEditor.getValue();
        }
    });

    // Trigger autocomplete on . and : characters
    cmEditor.on('inputRead', (cm, change) => {
        if (change.text && change.text.length === 1) {
            const ch = change.text[0];
            if (ch === '.' || ch === ':') {
                cm.showHint({ hint: CodeMirror.hint.nodeFableHint, completeSingle: false });
            }
        }
    });

    // Auto-save content on native textarea input (spellcheck mode)
    document.getElementById('passage-content-native').addEventListener('input', () => {
        if (selectedNodeId === null) return;
        const data = nodesData[selectedNodeId];
        if (data) data.text = document.getElementById('passage-content-native').value;
    });

    // Auto-save title on blur and update canvas node title
    document.getElementById('passage-title').addEventListener('blur', () => {
        if (selectedNodeId) {
            saveCurrentContent(selectedNodeId);
            const title = document.getElementById('passage-title').value;
            const nodeEl = document.getElementById('node-' + selectedNodeId);
            if (nodeEl) {
                const contentEl = nodeEl.querySelector('.drawflow_content_node');
                if (contentEl) contentEl.innerHTML = title;
            }
        }
    });

    // Auto-save node ID on blur if valid
    document.getElementById('passage-id').addEventListener('blur', () => {
        if (selectedNodeId && validateSlugOnBlur()) {
            saveCurrentContent(selectedNodeId);
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
            if (selectedNodeId !== null && nodesData[selectedNodeId]) {
                nodesData[selectedNodeId].text = getEditorValue();
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

    editor.on('nodeCreated', (nodeId) => {
        injectOverlayToNode(nodeId, true);
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
                setEditorValue(srcData.text);
                renderChoices(selectedNodeId);
            }
        }
        delete nodesData[nodeId];
        if (slug) delete slugToNodeId[slug];
        if (selectedNodeId === nodeId) closePassageEditor();
        validateDeadEnds();
        validateOrphans();
        _refreshPortalOutputs();
    });

    editor.on('connectionCreated', (data) => {
        if (isLoading) return;
        const sourceId = data.output_id;
        const targetId = data.input_id;
        const sourceData = nodesData[sourceId];
        const targetData = nodesData[targetId];

        // Handle portal as target (inbound connection — create choice targeting slug)
        if (targetData && targetData.isPortal) {
            const inputClass = data.input_class || 'input_1';
            const match = inputClass.match(/input_(\d+)/);
            if (!match) { editor.removeSingleConnection(sourceId, targetId, 'output_1', inputClass); return; }
            const idx = parseInt(match[1]) - 1;
            const portalSlugIds = targetData.portalSlugIds || [];
            if (idx >= portalSlugIds.length) { editor.removeSingleConnection(sourceId, targetId, 'output_1', inputClass); return; }
            const targetSlug = portalSlugIds[idx];
            ensureNodeData(sourceId);
            nodesData[sourceId].choices.push({
                targetSlug: targetSlug,
                text: '',
                prerequisite: '',
                mutation: ''
            });
            // Insert markdown link
            const linkMarkdown = `[${targetSlug}](node:${targetSlug})`;
            if (selectedNodeId === sourceId) {
                insertAtCursor(linkMarkdown);
                nodesData[sourceId].text = getEditorValue();
            } else {
                const sep = nodesData[sourceId].text ? '\n' : '';
                nodesData[sourceId].text += sep + linkMarkdown;
            }
            if (selectedNodeId === sourceId) renderChoices(sourceId);
            validateDeadEnds();
            validateOrphans();
            _refreshPortalOutputs();
            return;
        }

        // Handle portal as source (outbound — blocked, read-only)
        if (sourceData && sourceData.isPortal) {
            alert('Outbound connections from a portal are read-only. Load the group to edit connections.');
            editor.removeSingleConnection(sourceId, targetId, 'output_1', data.input_class || 'input_1');
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
        nodesData[sourceId].choices.push(choice);

        // Insert markdown link into passage content
        const targetTitle = getNodeTitle(targetId);
        const linkMarkdown = `[${targetTitle}](node:${targetSlug})`;
        if (selectedNodeId === sourceId) {
            insertAtCursor(linkMarkdown);
            nodesData[sourceId].text = getEditorValue();
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
        _refreshPortalOutputs();
    });

    editor.on('connectionRemoved', (data) => {
        snapshotState();
        const sourceId = data.output_id;
        const targetId = data.input_id;
        const targetData = nodesData[targetId];
        // Handle portal target removal: remove choice by slug
        if (targetData && targetData.isPortal) {
            const inputClass = data.input_class || 'input_1';
            const match = inputClass.match(/input_(\d+)/);
            if (match) {
                const idx = parseInt(match[1]) - 1;
                const portalSlugIds = targetData.portalSlugIds || [];
                if (idx < portalSlugIds.length) {
                    const slug = portalSlugIds[idx];
                    if (nodesData[sourceId] && nodesData[sourceId].choices) {
                        nodesData[sourceId].choices = nodesData[sourceId].choices.filter(c => c.targetSlug !== slug);
                    }
                    if (selectedNodeId === sourceId) renderChoices(sourceId);
                }
            }
            _refreshPortalOutputs();
            return;
        }
        const targetSlug = targetData ? getNodeSlug(targetId) : null;
        if (nodesData[sourceId] && nodesData[sourceId].choices) {
            nodesData[sourceId].choices = nodesData[sourceId].choices.filter(c => c.targetSlug !== targetSlug);
        }
        // Clean up markdown link from content
        if (nodesData[sourceId] && targetSlug) {
            const linkRegex = new RegExp(`\\[[^\\]]*\\]\\(node:${targetSlug}\\)`, 'g');
            nodesData[sourceId].text = (nodesData[sourceId].text || '').replace(linkRegex, '').replace(/\n{3,}/g, '\n\n').trim();
            if (selectedNodeId === sourceId) {
                setEditorValue(nodesData[sourceId].text);
            }
        }
        if (selectedNodeId === sourceId) {
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

function setupTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            const tabId = btn.getAttribute('data-tab');
            document.getElementById('tab-' + tabId).classList.add('active');
            if (tabId === 'markdown' && cmEditor) {
                setTimeout(() => cmEditor.refresh(), 0);
            }
            if (tabId === 'asset-explorer') {
                refreshAssets();
            }
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
        nodesData[nodeId] = { title: title, text: '', choices: [], slug: generateUniqueSlug(slugify(title)), is_start: false, group: 'side_panel' };
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
    if (nodesData[nodeId].group === undefined) {
        nodesData[nodeId].group = 'side_panel';
    }
}

function injectOverlayToNode(nodeId, deferred) {
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
        nodesData[nodeId] = { title: 'New Node', text: '', choices: [], slug: slug, is_start: false, group: '' };
        slugToNodeId[slug] = nodeId;
        _setupNodeCollapseButton(nodeId);
        console.log("Created new node:", nodeId, "slug:", slug);
        openPassageEditor(nodeId);
    } catch (err) {
        console.error("Failed to create node:", err);
    }
}

function addGroup() {
    // Create a unique group ID
    const baseId = 'chapter';
    let counter = 1;
    let groupId = baseId + '_' + counter;
    if (groupsManifest && groupsManifest.groups) {
        const existingIds = new Set(groupsManifest.groups.map(g => g.id));
        while (existingIds.has(groupId)) {
            counter++;
            groupId = baseId + '_' + counter;
        }
    }

    const label = 'Chapter ' + counter;

    // Add to manifest
    if (!groupsManifest) {
        groupsManifest = { name: currentProjectName || '', version: 2, variables: {}, groups: [], node_to_group: {} };
    }
    groupsManifest.groups = groupsManifest.groups || [];
    groupsManifest.node_to_group = groupsManifest.node_to_group || {};
    groupsManifest.groups.push({
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
    const nodeId = editor.addNode(
        'portal_node',
        ioCount,
        ioCount,
        posX,
        posY,
        'portal_node',
        {},
        label + ' (0 nodes)'
    );
    portalNodeIds[groupId] = nodeId;
    nodesData[nodeId] = {
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

function ensureSidePanelNode() {
    const existingId = slugToNodeId['side_panel'];
    if (existingId !== undefined) {
        const el = document.getElementById('node-' + existingId);
        if (el) el.classList.add('node-side-panel');
        return;
    }
    try {
        const nodeId = editor.addNode('story_node', 1, 1, 20, 20, 'story_node', {}, 'Side Panel');
        nodesData[nodeId] = { title: 'Side Panel', text: '', choices: [], slug: 'side_panel', is_start: false, group: 'side_panel' };
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

function handleLinkTargetClick(targetId, inputName) {
    if (linkingFromId === targetId) {
        cancelLinking();
        return;
    }
    const targetData = nodesData[targetId];
    if (targetData && targetData.isPortal) {
        if (inputName && inputName.startsWith('input_')) {
            // Allow connection to portal input — handled in connectionCreated
            snapshotState();
            editor.addConnection(linkingFromId, targetId, 'output_1', inputName);
            cancelLinking();
            return;
        }
        alert('Cannot link to a portal group. Load the group first, then create connections to individual nodes.');
        cancelLinking();
        return;
    }
    snapshotState();
    editor.addConnection(linkingFromId, targetId, 'output_1', inputName || 'input_1');
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
    editingPortalNodeId = null;
    document.getElementById('no-selection-msg').style.display = 'block';
    document.getElementById('passage-editor').style.display = 'none';
    document.getElementById('group-editor').style.display = 'none';
}

function openPassageEditor(nodeId, skipDirtyCheck) {
    if (!skipDirtyCheck && selectedNodeId !== null && selectedNodeId !== parseInt(nodeId)) {
        const currentData = nodesData[selectedNodeId];
        if (currentData && getEditorValue() !== currentData.text) {
            saveCurrentContent(selectedNodeId);
        }
    }

    const nid = parseInt(nodeId);
    ensureNodeData(nid);
    const data = nodesData[nid];
    if (!data) return;

    selectedNodeId = nid;
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
    if (data.slug === 'side_panel') {
        isStartCheckbox.style.display = 'none';
    } else {
        isStartCheckbox.style.display = 'flex';
        if (isStartCheckbox.checked !== !!data.is_start) {
            isStartCheckbox.checked = !!data.is_start;
        }
    }

    // Populate group dropdown
    populateGroupDropdown();

    renderChoices(nid);
    renderActions(nid);
    renderOnEnter(nid);
    updateStartBadgeOnCanvas(nid);
}

function openGroupEditor(nodeId) {
    const data = nodesData[nodeId];
    if (!data || !data.isPortal) return;

    editingPortalNodeId = nodeId;
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

function saveGroupEditor() {
    const nid = editingPortalNodeId;
    if (!nid) return;
    const data = nodesData[nid];
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
    nodesData[nid].title = effectiveLabel;

    // Update the node title on the canvas
    const nodeEl = document.querySelector(`[data-id="${nid}"] .drawflow-node .node-title`);
    if (nodeEl) {
        const count = groupNodeIds[oldGroupId] ? groupNodeIds[oldGroupId].length : 0;
        nodeEl.textContent = effectiveLabel + ' (' + count + ' nodes)';
    }

    // Update manifest
    if (groupsManifest && groupsManifest.groups) {
        let g = groupsManifest.groups.find(g => g.id === oldGroupId);
        if (g) {
            // Update label even if ID changed; entry stays keyed by old ID
            g.label = effectiveLabel;
        }
        // If ID changed, also update the entry id
        if (newGroupId !== oldGroupId) {
            g = groupsManifest.groups.find(g => g.id === oldGroupId);
            if (g) {
                g.id = newGroupId;
            }
            // Update portalNodeIds mapping
            delete portalNodeIds[oldGroupId];
            portalNodeIds[newGroupId] = nid;
            // Migrate collapsed group data cache key
            if (collapsedGroupsData[oldGroupId]) {
                collapsedGroupsData[newGroupId] = collapsedGroupsData[oldGroupId];
                delete collapsedGroupsData[oldGroupId];
            }
        }
    }

    document.getElementById('group-editor-id').value = newGroupId;

    // Re-render the node list in case group ID changed
    renderGroupNodeList(newGroupId);

    showToast('Group saved');
}

function renderGroupNodeList(groupId) {
    const container = document.getElementById('group-node-list');
    const nodesInGroup = [];
    for (const [nid, nd] of Object.entries(nodesData)) {
        if (!nd.isPortal && nd.group === groupId) {
            nodesInGroup.push({ id: nid, slug: nd.slug, title: nd.title });
        }
    }
    if (nodesInGroup.length === 0) {
        container.innerHTML = '<p class="text-muted-sm">No nodes in this group.</p>';
        return;
    }
    let html = '';
    for (const n of nodesInGroup) {
        html += '<div class="group-node-item">'
            + '<span class="gn-nid">#' + escapeHtml(n.id) + '</span>'
            + '<span>' + escapeHtml(n.title) + ' <span class="gn-id">(' + escapeHtml(n.slug) + ')</span></span>'
            + '</div>';
    }
    container.innerHTML = html;
}

function populateGroupDropdown() {
    const select = document.getElementById('passage-group');
    if (!select) return;
    const currentGroup = nodesData[selectedNodeId] ? nodesData[selectedNodeId].group || '' : '';

    // Build options from manifest
    let html = '<option value="">— Ungrouped —</option>';
    if (groupsManifest && groupsManifest.groups) {
        for (const g of groupsManifest.groups) {
            const label = g.label || g.id;
            const selected = g.id === currentGroup ? ' selected' : '';
            html += '<option value="' + escapeHtml(g.id) + '"' + selected + '>' + escapeHtml(label) + '</option>';
        }
    }
    select.innerHTML = html;
    select.value = currentGroup;
}

function changeNodeGroup(newGroup) {
    if (!selectedNodeId) return;
    const data = nodesData[selectedNodeId];
    if (!data || data.isPortal) return;
    data.group = newGroup || '';
    // Update the manifest node_to_group mapping
    if (groupsManifest && data.slug) {
        groupsManifest.node_to_group = groupsManifest.node_to_group || {};
        if (newGroup) {
            groupsManifest.node_to_group[data.slug] = newGroup;
        } else {
            delete groupsManifest.node_to_group[data.slug];
        }
    }
    showToast('Node assigned to group: ' + (newGroup || 'none'));
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

async function refreshAssets() {
    const section = document.getElementById('asset-section');
    const treeContainer = document.getElementById('asset-tree');
    if (!currentProjectName) {
        section.classList.add('is-hidden');
        return;
    }
    try {
        const resp = await fetch('/api/assets/' + encodeURIComponent(currentProjectName));
        if (!resp.ok) throw new Error('Failed to load assets');
        const data = await resp.json();
        const tree = data.tree || [];
        if (tree.length === 0) {
            section.classList.add('is-hidden');
        } else {
            section.classList.remove('is-hidden');
        }
        renderAssetTree(tree, treeContainer, '');
        const aeTab = document.getElementById('tab-asset-explorer');
        if (aeTab.classList.contains('active')) {
            renderAssetExplorer(tree);
        }
    } catch (e) {
        section.classList.add('is-hidden');
    }
}

function renderAssetTree(nodes, container, parentPath) {
    let html = '';
    for (const node of nodes) {
        const path = parentPath ? parentPath + '/' + node.name : node.name;
        if (node.type === 'folder') {
            html += '<div class="asset-tree-folder">';
            html += '  <div class="asset-tree-folder-row">';
            html += '    <span class="asset-tree-toggle">&#9654;</span>';
            html += '    <span class="asset-tree-folder-icon">&#128193;</span>';
            html += '    <span class="asset-tree-folder-name">' + escapeHtml(node.name) + '</span>';
            html += '    <span class="asset-tree-folder-actions">';
            html += '      <button class="ae-folder-newfolder" data-path="' + escapeHtml(path) + '" title="New folder">&#128193;</button>';
            html += '      <button class="ae-folder-upload" data-path="' + escapeHtml(path) + '" title="Upload here">&#11014;</button>';
            html += '    </span>';
            html += '  </div>';
            html += '  <div class="asset-tree-children">';
            html +=      renderAssetTreeChildren(node.children || [], path);
            html += '  </div>';
            html += '</div>';
        } else {
            const url = '/api/assets/' + encodeURIComponent(currentProjectName) + '/' + path;
            const alt = node.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_]/g, '_');
            const syntax = '![' + alt + '](' + url + ')';
            html += '<div class="asset-tree-file-row" title="Click to copy: ' + escapeHtml(syntax) + '">';
            html += '  <img class="asset-preview" src="' + url + '" alt="' + escapeHtml(alt) + '" loading="lazy">';
            html += '  <span class="asset-syntax">' + escapeHtml(syntax) + '</span>';
            html += '  <button class="asset-delete-btn" data-path="' + escapeHtml(path) + '" title="Delete asset">' + SVG_CLOSE + '</button>';
            html += '</div>';
        }
    }
    container.innerHTML = html;
}

function renderAssetTreeChildren(nodes, parentPath) {
    let html = '';
    for (const node of nodes) {
        const path = parentPath + '/' + node.name;
        if (node.type === 'folder') {
            html += '<div class="asset-tree-folder">';
            html += '  <div class="asset-tree-folder-row">';
            html += '    <span class="asset-tree-toggle">&#9654;</span>';
            html += '    <span class="asset-tree-folder-icon">&#128193;</span>';
            html += '    <span class="asset-tree-folder-name">' + escapeHtml(node.name) + '</span>';
            html += '    <span class="asset-tree-folder-actions">';
            html += '      <button class="ae-folder-newfolder" data-path="' + escapeHtml(path) + '" title="New folder">&#128193;</button>';
            html += '      <button class="ae-folder-upload" data-path="' + escapeHtml(path) + '" title="Upload here">&#11014;</button>';
            html += '    </span>';
            html += '  </div>';
            html += '  <div class="asset-tree-children">';
            html +=      renderAssetTreeChildren(node.children || [], path);
            html += '  </div>';
            html += '</div>';
        } else {
            const url = '/api/assets/' + encodeURIComponent(currentProjectName) + '/' + path;
            const alt = node.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_]/g, '_');
            const syntax = '![' + alt + '](' + url + ')';
            html += '<div class="asset-tree-file-row" title="Click to copy: ' + escapeHtml(syntax) + '">';
            html += '  <img class="asset-preview" src="' + url + '" alt="' + escapeHtml(alt) + '" loading="lazy">';
            html += '  <span class="asset-syntax">' + escapeHtml(syntax) + '</span>';
            html += '  <button class="asset-delete-btn" data-path="' + escapeHtml(path) + '" title="Delete asset">' + SVG_CLOSE + '</button>';
            html += '</div>';
        }
    }
    return html;
}

function getEntriesAtPath(tree, path) {
    if (!path) return tree;
    const parts = path.split('/');
    let current = tree;
    for (const part of parts) {
        const found = current.find(n => n.name === part && n.type === 'folder');
        if (!found) return [];
        current = found.children || [];
    }
    return current;
}

function renderAssetExplorer(tree) {
    const entries = getEntriesAtPath(tree, aeCurrentPath);
    renderBreadcrumb(aeCurrentPath);
    renderAEGrid(entries);
}

function renderBreadcrumb(path) {
    const parts = path ? path.split('/') : [];
    let html = '<span class="ae-crumb" data-path="">root</span>';
    let cumulative = '';
    for (const part of parts) {
        cumulative = cumulative ? cumulative + '/' + part : part;
        html += '<span class="ae-crumb" data-path="' + escapeHtml(cumulative) + '">' + escapeHtml(part) + '</span>';
    }
    document.getElementById('ae-breadcrumb').innerHTML = html;
}

function renderAEGrid(entries) {
    const grid = document.getElementById('ae-file-grid');
    if (entries.length === 0) {
        grid.innerHTML = '<div class="ae-empty">This folder is empty</div>';
        return;
    }
    let html = '';
    for (const entry of entries) {
        const path = aeCurrentPath ? aeCurrentPath + '/' + entry.name : entry.name;
        const selClass = aeSelectedPaths.has(path) ? ' selected' : '';
        if (entry.type === 'folder') {
            html += '<div class="ae-grid-item ae-folder-item' + selClass + '" data-path="' + escapeHtml(path) + '" data-type="folder">';
            html += '  <div class="ae-thumb">&#128193;</div>';
            html += '  <div class="ae-name">' + escapeHtml(entry.name) + '</div>';
            html += '</div>';
        } else {
            const ext = entry.name.split('.').pop().toLowerCase();
            const isImage = ['png','jpg','jpeg','gif','svg','webp','bmp'].includes(ext);
            html += '<div class="ae-grid-item ae-file-item' + selClass + '" data-path="' + escapeHtml(path) + '" data-type="file">';
            if (isImage) {
                html += '  <img class="ae-thumb" src="' + entry.url + '" alt="' + escapeHtml(entry.name) + '" loading="lazy">';
            } else {
                html += '  <div class="ae-thumb">&#128196;</div>';
            }
            html += '  <div class="ae-name">' + escapeHtml(entry.name) + '</div>';
            if (entry.file_size !== undefined) {
                const sizeStr = entry.file_size > 1048576
                    ? (entry.file_size / 1048576).toFixed(1) + ' MB'
                    : entry.file_size > 1024
                        ? (entry.file_size / 1024).toFixed(1) + ' KB'
                        : entry.file_size + ' B';
                html += '  <div class="ae-size">' + sizeStr + '</div>';
            }
            html += '</div>';
        }
    }
    grid.innerHTML = html;
    updateAEToolbar();
}

function updateAEToolbar() {
    const count = aeSelectedPaths.size;
    document.querySelector('#ae-toolbar [data-ae-action="rename"]').disabled = count !== 1;
    document.querySelector('#ae-toolbar [data-ae-action="delete"]').disabled = count === 0;
    document.querySelector('#ae-toolbar [data-ae-action="copy"]').disabled = count === 0;
    document.querySelector('#ae-toolbar [data-ae-action="cut"]').disabled = count === 0;
    document.querySelector('#ae-toolbar [data-ae-action="paste"]').disabled = aeClipboard === null;
}

function aeNavigate(path) {
    aeCurrentPath = path;
    aeSelectedPaths.clear();
    refreshAssets();
}

async function aeNewFolder(targetPath) {
    const name = prompt('Folder name:');
    if (!name || !name.trim()) return;
    const folderPath = targetPath !== undefined ? (targetPath ? targetPath + '/' + name.trim() : name.trim()) : (aeCurrentPath ? aeCurrentPath + '/' + name.trim() : name.trim());
    try {
        const resp = await fetch('/api/assets/' + encodeURIComponent(currentProjectName) + '/folder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: folderPath })
        });
        if (!resp.ok) {
            const err = await resp.json();
            throw new Error(err.detail || 'Failed to create folder');
        }
        showToast('Folder created');
        refreshAssets();
    } catch (err) {
        alert('Failed to create folder: ' + err.message);
    }
}

async function aeUpload(targetPath) {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.onchange = async () => {
        for (const file of input.files) {
            const formData = new FormData();
            formData.append('file', file);
            if (targetPath) {
                formData.append('folder', targetPath);
            }
            try {
                const resp = await fetch('/api/assets/' + encodeURIComponent(currentProjectName) + '/upload', {
                    method: 'POST',
                    body: formData
                });
                if (!resp.ok) {
                    const err = await resp.json();
                    throw new Error(err.detail || 'Upload failed');
                }
            } catch (err) {
                alert('Failed to upload ' + file.name + ': ' + err.message);
            }
        }
        refreshAssets();
    };
    input.click();
}

async function aeDelete(singlePath) {
    const paths = singlePath ? [singlePath] : Array.from(aeSelectedPaths);
    if (paths.length === 0) return;
    const msg = paths.length === 1
        ? 'Delete "' + paths[0] + '" permanently?'
        : 'Delete ' + paths.length + ' selected item(s)?';
    if (!confirm(msg)) return;
    let totalDeleted = 0;
    let hadError = false;
    for (const p of paths) {
        try {
            const resp = await fetch('/api/assets/' + encodeURIComponent(currentProjectName) + '/' + encodeURIComponent(p), {
                method: 'DELETE'
            });
            if (!resp.ok) {
                const err = await resp.json();
                console.warn('Delete failed for ' + p + ': ' + (err.detail || 'Unknown'));
                hadError = true;
                continue;
            }
            const result = await resp.json();
            totalDeleted += result.deleted_count || 1;
        } catch (err) {
            console.warn('Delete error for ' + p + ': ' + err.message);
            hadError = true;
        }
    }
    showToast('Deleted ' + totalDeleted + ' item(s)' + (hadError ? ' (some failed)' : ''));
    aeSelectedPaths.clear();
    refreshAssets();
}

async function aeRename() {
    if (aeSelectedPaths.size !== 1) return;
    const path = aeSelectedPaths.values().next().value;
    const oldName = path.split('/').pop();
    const newName = prompt('New name:', oldName);
    if (!newName || !newName.trim() || newName === oldName) return;
    try {
        const resp = await fetch('/api/assets/' + encodeURIComponent(currentProjectName) + '/rename', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: path, new_name: newName.trim() })
        });
        if (!resp.ok) {
            const err = await resp.json();
            throw new Error(err.detail || 'Rename failed');
        }
        showToast('Renamed');
        aeSelectedPaths.clear();
        refreshAssets();
    } catch (err) {
        alert('Failed to rename: ' + err.message);
    }
}

function aeCopy() {
    if (aeSelectedPaths.size === 0) return;
    aeClipboard = { action: 'copy', paths: Array.from(aeSelectedPaths) };
    updateAEToolbar();
    showToast('Copied ' + aeClipboard.paths.length + ' item(s)');
}

function aeCut() {
    if (aeSelectedPaths.size === 0) return;
    aeClipboard = { action: 'cut', paths: Array.from(aeSelectedPaths) };
    updateAEToolbar();
    showToast('Cut ' + aeClipboard.paths.length + ' item(s)');
}

async function aePaste() {
    if (!aeClipboard) return;
    const results = { copied: 0, moved: 0, errors: 0 };
    for (const srcPath of aeClipboard.paths) {
        const srcName = srcPath.split('/').pop();
        const dstPath = aeCurrentPath ? aeCurrentPath + '/' + srcName : srcName;
        if (srcPath === dstPath) continue;
        try {
            if (aeClipboard.action === 'copy') {
                const resp = await fetch('/api/assets/' + encodeURIComponent(currentProjectName) + '/copy', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ from_path: srcPath, to_path: dstPath })
                });
                if (!resp.ok) {
                    const err = await resp.json();
                    console.warn('Copy failed for ' + srcPath + ': ' + (err.detail || 'Unknown'));
                    results.errors++;
                    continue;
                }
                results.copied++;
            } else {
                const resp = await fetch('/api/assets/' + encodeURIComponent(currentProjectName) + '/move', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ from_path: srcPath, to_path: dstPath })
                });
                if (!resp.ok) {
                    const err = await resp.json();
                    console.warn('Move failed for ' + srcPath + ': ' + (err.detail || 'Unknown'));
                    results.errors++;
                    continue;
                }
                results.moved++;
            }
        } catch (err) {
            console.warn('Paste error for ' + srcPath + ': ' + err.message);
            results.errors++;
        }
    }
    const verb = aeClipboard.action === 'copy' ? 'Copied' : 'Moved';
    const count = aeClipboard.action === 'copy' ? results.copied : results.moved;
    showToast(verb + ' ' + count + ' item(s)' + (results.errors > 0 ? ' (' + results.errors + ' failed)' : ''));
    if (aeClipboard.action === 'cut') {
        aeClipboard = null;
    }
    aeSelectedPaths.clear();
    refreshAssets();
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
    if (isSpellcheckActive()) {
        const ta = document.getElementById('passage-content-native');
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        const text = ta.value;
        const selected = text.substring(start, end);
        ta.value = text.substring(0, start) + before + selected + after + text.substring(end);
        ta.focus();
        ta.selectionStart = ta.selectionEnd = selected ? start + before.length + selected.length + after.length : start + before.length;
    } else if (cmEditor) {
        const doc = cmEditor.getDoc();
        const sel = doc.listSelections()[0];
        if (!sel) return;
        const anchor = { line: sel.anchor.line, ch: sel.anchor.ch };
        const head = { line: sel.head.line, ch: sel.head.ch };
        const isReversed = (head.line < anchor.line) || (head.line === anchor.line && head.ch < anchor.ch);
        const from = isReversed ? head : anchor;
        const to = isReversed ? anchor : head;
        const selected = doc.getSelection();
        doc.replaceRange(before + selected + after, from, to, '+insertMarkdown');
        if (selected) {
            doc.setSelection(
                { line: from.line, ch: from.ch + before.length },
                { line: from.line, ch: from.ch + before.length + selected.length }
            );
        } else {
            doc.setCursor({ line: from.line, ch: from.ch + before.length });
        }
        cmEditor.focus();
    }
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
            const resp = await fetch('/api/assets/' + encodeURIComponent(currentProjectName) + '/upload', {
                method: 'POST',
                body: formData
            });
            if (!resp.ok) {
                const err = await resp.json();
                throw new Error(err.detail || 'Upload failed');
            }
            const result = await resp.json();
            const alt = file.name.replace(/\.[^.]+$/, '');
            const markdown = '![' + alt + '](' + result.url + ')';
            insertAtCursor(markdown);
            refreshAssets();
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

// ── Editor mode helpers ──────────────────────────────────────────

function isSpellcheckActive() {
    return !document.getElementById('passage-content-native').classList.contains('is-hidden');
}

function getEditorValue() {
    if (isSpellcheckActive()) {
        return document.getElementById('passage-content-native').value;
    }
    return cmEditor ? cmEditor.getValue() : '';
}

function setEditorValue(val) {
    document.getElementById('passage-content-native').value = val || '';
    if (cmEditor) cmEditor.setValue(val || '');
}

function insertAtCursor(text) {
    if (isSpellcheckActive()) {
        const ta = document.getElementById('passage-content-native');
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        ta.value = ta.value.substring(0, start) + text + ta.value.substring(end);
        ta.selectionStart = ta.selectionEnd = start + text.length;
        ta.focus();
    } else if (cmEditor) {
        const cursor = cmEditor.getDoc().getCursor();
        cmEditor.getDoc().replaceRange(text, cursor);
        const newPos = { line: cursor.line, ch: cursor.ch + text.length };
        cmEditor.getDoc().setCursor(newPos);
        cmEditor.focus();
    }
}

function toggleSpellcheck() {
    if (!cmEditor) return;
    const native = document.getElementById('passage-content-native');
    const cmContainer = document.getElementById('passage-content-editor');
    const btn = document.getElementById('spellcheck-toggle');
    const status = document.getElementById('spellcheck-status');
    if (isSpellcheckActive()) {
        cmEditor.setValue(native.value);
        native.classList.add('is-hidden');
        cmContainer.classList.remove('is-hidden');
        cmEditor.focus();
        status.textContent = 'OFF';
        btn.classList.add('off');
    } else {
        native.value = cmEditor.getValue();
        cmContainer.classList.add('is-hidden');
        native.classList.remove('is-hidden');
        native.focus();
        status.textContent = 'ON';
        btn.classList.remove('off');
    }
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
    const content = getEditorValue();
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
    if (!selectedNodeId) return false;
    const newSlug = document.getElementById('passage-id').value.trim();
    const nodeData = nodesData[selectedNodeId];
    if (!nodeData) return false;

    if (!newSlug) {
        showIdError('Node ID cannot be empty');
        return false;
    }
    if (newSlug !== nodeData.slug && slugToNodeId[newSlug] !== undefined) {
        showIdError('Node ID "' + newSlug + '" is already in use');
        return false;
    } else {
        hideIdError();
        return true;
    }
}

function updateCurrentNode() {
    if (!selectedNodeId) return;
    snapshotState();

    const title = document.getElementById('passage-title').value;
    const content = getEditorValue();
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
            is_start: false,
            group: 'side_panel'
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
        is_start: is_start,
        group: obj.group || ''
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
            aeSelectedPaths.clear();
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
                    aeSelectedPaths.add(path);
                } else {
                    aeSelectedPaths.delete(path);
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
                aeSelectedPaths.add(path);
            } else {
                aeSelectedPaths.delete(path);
            }
        } else {
            aeSelectedPaths.clear();
            document.querySelectorAll('.ae-grid-item').forEach(el => el.classList.remove('selected'));
            aeSelectedPaths.add(path);
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

function setupAEToolbar() {
    document.getElementById('ae-toolbar').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-ae-action]');
        if (!btn) return;
        if (btn.disabled) return;
        const action = btn.dataset.aeAction;
        switch (action) {
            case 'newFolder': aeNewFolder(aeCurrentPath); break;
            case 'upload': aeUpload(aeCurrentPath); break;
            case 'rename': aeRename(); break;
            case 'delete': aeDelete(); break;
            case 'copy': aeCopy(); break;
            case 'cut': aeCut(); break;
            case 'paste': aePaste(); break;
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

// ---------------------------------------------------------------------------
// Context menu (right-click)
// ---------------------------------------------------------------------------

let contextMenuTargetId = null;

function setupContextMenu() {
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
        const data = nodesData[nodeId];
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
                const ctxData = nodesData[nodeId];
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

function hideContextMenu() {
    const menu = document.getElementById('context-menu');
    if (menu) menu.style.display = 'none';
    contextMenuTargetId = null;
}

// ---------------------------------------------------------------------------
// Group actions
// ---------------------------------------------------------------------------

async function loadGroupFromPortal(portalNodeId) {
    const data = nodesData[portalNodeId];
    if (!data || !data.isPortal) return;
    const groupId = data.portalGroupId;

    if (loadedGroupIds.has(groupId)) {
        showToast('Group "' + (data.portalGroupLabel || groupId) + '" is already loaded');
        return;
    }

    if (!currentProjectName) return;

    try {
        let nodes;
        if (collapsedGroupsData[groupId]) {
            nodes = collapsedGroupsData[groupId];
            delete collapsedGroupsData[groupId];
        } else {
            const resp = await fetch('/api/load?name=' + encodeURIComponent(currentProjectName) + '&groups=' + encodeURIComponent(groupId));
            if (!resp.ok) throw new Error('Failed to load group');
            const project = await resp.json();
            nodes = project.nodes || [];
        }

        // Remove the portal node
        if (portalOutputSvg[portalNodeId]) {
            for (const el of portalOutputSvg[portalNodeId]) {
                if (el.parentNode) el.parentNode.removeChild(el);
            }
            delete portalOutputSvg[portalNodeId];
        }
        editor.removeNodeId('node-' + portalNodeId);
        delete nodesData[portalNodeId];
        delete portalNodeIds[groupId];

        // Refresh portal output lines for remaining portals
        for (const [pid] of Object.entries(portalOutputSvg)) {
            _renderPortalOutputs(parseInt(pid));
        }

        // Create real nodes for the group (chunked)
        const slugToDrawflowId = {};
        showLoader('Loading ' + nodes.length + ' nodes...');

        const batchSize = Math.min(50, Math.max(10, Math.floor(nodes.length / 10)));
        await createNodesBatched(nodes, (node, nodeId) => {
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
                is_start: node.is_start || false,
                group: node.group || groupId
            };
            slugToNodeId[node.id] = nodeId;
            groupNodeIds[groupId] = groupNodeIds[groupId] || [];
            groupNodeIds[groupId].push(nodeId);
            _setupNodeCollapseButton(nodeId);
        }, batchSize);

        // Collect connections (intra-group + cross-group via slugToNodeId)
        const connections = [];
        for (const node of nodes) {
            const sourceId = slugToDrawflowId[node.id];
            if (!sourceId) continue;
            for (const choice of node.choices || []) {
                const targetId = slugToDrawflowId[choice.target_node_id]
                              ?? slugToNodeId[choice.target_node_id];
                if (!targetId) continue;
                connections.push({
                    sourceId,
                    targetId,
                    targetSlug: choice.target_node_id,
                    text: choice.text || '',
                    prerequisite: choice.prerequisite || '',
                    mutation: choice.mutation || ''
                });
            }
        }

        // Cross-group connections: existing choices in other loaded nodes targeting slugs in this group
        const targetSlugsInGroup = new Set(nodes.map(n => n.id));
        for (const [srcNidStr, srcData] of Object.entries(nodesData)) {
            if (srcData.isPortal) continue;
            if (!editor.drawflow.drawflow['Home'].data[parseInt(srcNidStr)]) continue;
            for (const choice of srcData.choices || []) {
                if (targetSlugsInGroup.has(choice.targetSlug)) {
                    const targetId = slugToNodeId[choice.targetSlug];
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
        isLoading = true;
        await createConnectionsBatched(connections, (c) => {
            const existing = nodesData[c.sourceId] && nodesData[c.sourceId].choices.some(ch => ch.targetSlug === c.targetSlug);
            if (!existing) {
                nodesData[c.sourceId].choices.push({
                    targetSlug: c.targetSlug,
                    text: c.text,
                    prerequisite: c.prerequisite,
                    mutation: c.mutation
                });
            }
        });
        isLoading = false;

        loadedGroupIds.add(groupId);

        // Refresh connections for all nodes
        for (const idStr of Object.keys(nodesData)) {
            editor.updateConnectionNodes('node-' + idStr);
        }

        // Update start badges
        for (const nodeIdStr of Object.keys(nodesData)) {
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

async function moveToGroupFromPortal(portalNodeId) {
    const data = nodesData[portalNodeId];
    if (!data || !data.isPortal) return;
    const targetGroupId = data.portalGroupId;

    if (!currentProjectName) return;
    if (!confirm('Move to "' + (data.portalGroupLabel || targetGroupId) + '"? This will unload all other groups except side_panel.')) return;

    showLoader('Switching to group...');
    try {
        isLoading = true;

        // Remove all loaded non-side_panel nodes and portals except the target portal
        const idsToRemove = [];
        for (const [idStr, nd] of Object.entries(nodesData)) {
            if (nd.slug === 'side_panel') continue;
            if (nd.isPortal && nd.portalGroupId === targetGroupId) continue;
            idsToRemove.push(idStr);
        }
        for (const idStr of idsToRemove) {
            editor.removeNodeId('node-' + idStr);
            delete nodesData[idStr];
        }
        slugToNodeId = { side_panel: slugToNodeId['side_panel'] };
        loadedGroupIds = new Set();
        // portalNodeIds is cleared by loadGroupFromPortal for the target;
        // clear the rest now.
        for (const [gid, nid] of Object.entries(portalNodeIds)) {
            if (gid !== targetGroupId) delete portalNodeIds[gid];
        }
        groupNodeIds = {};

        // Load the target group
        await loadGroupFromPortal(portalNodeId);

        // Recreate portal stubs for all other unloaded groups
        const otherGroups = (groupsManifest && groupsManifest.groups || []).filter(
            g => g.id !== targetGroupId && g.id !== 'side_panel'
        );
        let px = 500, py = 50;
        for (const group of otherGroups) {
            if (!loadedGroupIds.has(group.id)) {
                createPortalNode(group, px, py);
                py += 200;
            }
        }
        isLoading = false;
    } catch (err) {
        isLoading = false;
        alert('Failed to switch groups: ' + err.message);
    } finally {
        hideLoader();
    }
}

async function deleteGroupFromPortal(portalNodeId) {
    const data = nodesData[portalNodeId];
    if (!data || !data.isPortal) return;
    const groupId = data.portalGroupId;
    const groupLabel = data.portalGroupLabel || groupId;

    if (!confirm('Delete group "' + groupLabel + '"? All nodes in this group will be removed from the project.')) return;

    // Remove the portal node from canvas
    editor.removeNodeId('node-' + portalNodeId);
    delete nodesData[portalNodeId];
    delete portalNodeIds[groupId];
    delete collapsedGroupsData[groupId];

    // Update manifest
    if (groupsManifest && groupsManifest.groups) {
        groupsManifest.groups = groupsManifest.groups.filter(g => g.id !== groupId);
        // Remove node_to_group entries for this group
        if (groupsManifest.node_to_group) {
            for (const [slug, gid] of Object.entries(groupsManifest.node_to_group)) {
                if (gid === groupId) delete groupsManifest.node_to_group[slug];
            }
        }
    }

    showToast('Group deleted: ' + groupLabel);
}

function collapseGroup(groupId) {
    if (groupId === 'side_panel') {
        showToast('Cannot collapse the Side Panel');
        return;
    }
    const nodes = groupNodeIds[groupId];
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
        const data = nodesData[nid];
        if (!data) continue;
        const drawflowNode = editor.drawflow.drawflow['Home'].data[nid];
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
    collapsedGroupsData[groupId] = nodeData;

    // Remove nodes from canvas
    for (const nid of nodes) {
        const slug = nodesData[nid]?.slug;
        editor.removeNodeId('node-' + nid);
        delete nodesData[nid];
        if (slug) delete slugToNodeId[slug];
    }
    delete groupNodeIds[groupId];
    loadedGroupIds.delete(groupId);

    // Create portal at geometric center
    const centerX = sumX / nodeData.length;
    const centerY = sumY / nodeData.length;
    const label = (groupsManifest?.groups?.find(g => g.id === groupId)?.label) || groupId;
    createPortalNode({ id: groupId, label, node_count: nodeData.length, slug_ids: nodeData.map(n => n.id) }, centerX, centerY);

    showToast('Collapsed group: ' + groupId);

    // Close editor if the selected node was in this group
    if (selectedNodeId !== null && nodesData[selectedNodeId] === undefined) {
        closePassageEditor();
    }
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
        if (data.isPortal) continue;
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
            is_start: data.is_start || false,
            group: data.group || 'side_panel'
        });
    }

    const vars = {};
    for (const [vName, v] of Object.entries(variables)) {
        vars[vName] = v.value;
    }

    // Include collapsed group data
    for (const [groupId, cachedNodes] of Object.entries(collapsedGroupsData || {})) {
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
                actions: (cn.actions || []).map(a => ({
                    id: a.id,
                    text: a.text || '',
                    pairs: (a.pairs || []).map(p => ({
                        condition: p.condition || null,
                        mutation: p.mutation
                    }))
                })),
                on_enter: cn.on_enter || null,
                is_start: cn.is_start || false,
                group: cn.group || groupId
            });
        }
    }

    // Include group metadata (labels, etc.)
    const groupsPayload = (groupsManifest && groupsManifest.groups) || [];

    return { name, variables: vars, nodes: nodes, groups: groupsPayload };
}

async function confirmSave() {
    if (selectedNodeId !== null && nodesData[selectedNodeId]) {
        nodesData[selectedNodeId].text = getEditorValue();
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
        closeModal();
        showLoader('Loading project...');

        // Clear existing state
        const idsToRemove = Object.keys(nodesData);
        for (const idStr of idsToRemove) {
            editor.removeNodeId('node-' + idStr);
        }
        nodesData = {};
        slugToNodeId = {};
        variables = {};
        groupsManifest = null;
        portalNodeIds = {};
        loadedGroupIds = new Set();
        groupNodeIds = {};
        collapsedGroupsData = {};
        closePassageEditor();

        // Fetch manifest (lightweight)
        const manifestResp = await fetch('/api/load/manifest?name=' + encodeURIComponent(loadName));
        if (!manifestResp.ok) {
            const err = await manifestResp.json();
            throw new Error(err.detail || 'Failed to load project manifest');
        }
        const manifest = await manifestResp.json();
        groupsManifest = manifest;

        // Restore variables from manifest
        for (const [vName, value] of Object.entries(manifest.variables || {})) {
            const type = typeof value === 'boolean' ? 'bool'
                : typeof value === 'number' ? (Number.isInteger(value) ? 'int' : 'float')
                : 'string';
            variables[vName] = { type, value };
        }

        // Load only side_panel group (full node data)
        const sidePanelResp = await fetch('/api/load?name=' + encodeURIComponent(loadName) + '&groups=side_panel');
        if (!sidePanelResp.ok) {
            const err = await sidePanelResp.json();
            throw new Error(err.detail || 'Failed to load side panel');
        }
        const sidePanelProject = await sidePanelResp.json();
        isLoading = true;

        // Create side_panel nodes
        const slugToDrawflowId = {};
        for (const node of sidePanelProject.nodes || []) {
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
                is_start: node.is_start || false,
                group: node.group || 'side_panel'
            };
            slugToNodeId[node.id] = nodeId;
        }

        // Restore connections for side_panel nodes
        for (const node of sidePanelProject.nodes || []) {
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
        loadedGroupIds.add('side_panel');

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
        for (const idStr of Object.keys(nodesData)) {
            editor.updateConnectionNodes('node-' + idStr);
        }
        isLoading = false;

        currentProjectName = loadName;
        renderVariables();
        refreshAssets();
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
        console.log('Project "' + loadName + '" loaded with ' + otherGroups.length + ' portal groups');
    } catch (err) {
        isLoading = false;
        alert('Failed to load project: ' + err.message);
    } finally {
        hideLoader();
    }
}

function createPortalNode(group, posX, posY) {
    try {
        const label = group.label || group.id;
        const count = group.node_count || 0;
        const slugIds = group.slug_ids || [];
        const ioCount = Math.max(1, slugIds.length);
        const nodeId = editor.addNode(
            'portal_node',
            ioCount,
            ioCount,
            posX || 300,
            posY || 100,
            'portal_node',
            {},
            label + ' (' + count + ' nodes)'
        );
        portalNodeIds[group.id] = nodeId;
        // Store the group data on the portal node
        nodesData[nodeId] = {
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

function _labelPortalIO(nodeId, slugIds) {
    const nodeEl = document.getElementById('node-' + nodeId);
    if (!nodeEl) return;
    for (let i = 0; i < slugIds.length; i++) {
        const slug = slugIds[i];
        const inputEl = nodeEl.querySelector('.input_' + (i + 1));
        if (inputEl) { inputEl.title = slug; inputEl.dataset.slug = slug; }
        const outputEl = nodeEl.querySelector('.output_' + (i + 1));
        if (outputEl) { outputEl.title = slug; outputEl.dataset.slug = slug; }
    }

    // Rewrite content node with slug labels aligned to I/O rows
    const data = nodesData[nodeId];
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
        slugEl.textContent = slugIds[i];
        contentEl.appendChild(slugEl);
    }
}

function _renderPortalOutputs(portalNodeId) {
    // Clean up existing portal output lines for this node
    if (portalOutputSvg[portalNodeId]) {
        for (const el of portalOutputSvg[portalNodeId]) {
            if (el.parentNode) el.parentNode.removeChild(el);
        }
    }
    portalOutputSvg[portalNodeId] = [];

    const data = nodesData[portalNodeId];
    if (!data || !data.isPortal) return;
    const slugIds = data.portalSlugIds || [];
    if (slugIds.length === 0) return;

    const portalEl = document.getElementById('node-' + portalNodeId);
    if (!portalEl) return;

    for (let i = 0; i < slugIds.length; i++) {
        const slug = slugIds[i];
        for (const [nidStr, nd] of Object.entries(nodesData)) {
            if (nd.isPortal) continue;
            // Only consider nodes that are on the canvas
            if (!editor.drawflow.drawflow['Home'].data[parseInt(nidStr)]) continue;
            const choices = nd.choices || [];
            const matchingChoice = choices.find(c => c.targetSlug === slug);
            if (!matchingChoice) continue;

            const sourceNid = parseInt(nidStr);
            const sourceEl = document.getElementById('node-' + sourceNid);
            const outputEl = portalEl.querySelector('.output_' + (i + 1));
            if (!sourceEl || !outputEl) continue;

            const precanvas = editor.precanvas;
            if (!precanvas) continue;

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
            portalOutputSvg[portalNodeId].push(svg);
            _positionPortalOutputLine(svg, outputEl, sourceEl);
            break;
        }
    }
}

function _refreshPortalOutputs() {
    for (const [pidStr] of Object.entries(portalOutputSvg)) {
        _renderPortalOutputs(parseInt(pidStr));
    }
}

function _positionPortalOutputLine(svg, outputEl, targetEl) {
    requestAnimationFrame(() => {
        const precanvas = editor.precanvas;
        if (!precanvas) return;
        const precanvasRect = precanvas.getBoundingClientRect();
        const outRect = outputEl.getBoundingClientRect();
        const tgtRect = targetEl.getBoundingClientRect();

        const x1 = outRect.left - precanvasRect.left + outRect.width / 2;
        const y1 = outRect.top - precanvasRect.top + outRect.height / 2;
        const x2 = tgtRect.left - precanvasRect.left + tgtRect.width / 2;
        const y2 = tgtRect.top - precanvasRect.top + tgtRect.height / 2;

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
    });
}

function _setupPortalActions(portalNodeId) {
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

function portalNodeHasGroupId(drawflowNodeId) {
    const data = nodesData[drawflowNodeId];
    return data && data.isPortal ? data.portalGroupId : null;
}

function _setupNodeCollapseButton(nodeId) {
    const nodeEl = document.getElementById('node-' + nodeId);
    if (!nodeEl) return;

    const data = nodesData[nodeId];
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

// ---------------------------------------------------------------------------
// Chunked rendering helper
// ---------------------------------------------------------------------------

function createNodesBatched(nodes, onNodeCreated, batchSize) {
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

function createConnectionsBatched(connections, onConnectionCreated, batchSize) {
    batchSize = batchSize || 100;
    let index = 0;
    const total = connections.length;
    return new Promise((resolve) => {
        function processBatch() {
            const end = Math.min(index + batchSize, total);
            for (let i = index; i < end; i++) {
                const c = connections[i];
                editor.addConnection(c.sourceId, c.targetId, 'output_1', 'input_1');
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
        nodesData[selectedNodeId].text = getEditorValue();
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
