// frontend/editor/js/asset-explorer.js
import { state } from './state.js';
import { escapeHtml, showToast } from './ui-utils.js';
import { insertAtCursor } from './codemirror-setup.js';
import { SVG_CLOSE } from './constants.js';

const VIDEO_EXTS = ['mp4', 'webm', 'ogg', 'mov'];

function assetSyntax(url, name) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    if (VIDEO_EXTS.includes(ext)) return '{video: ' + url + '}';
    const alt = name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_]/g, '_');
    return '{img: ' + url + (alt ? ', alt=' + alt : '') + '}';
}

export async function refreshAssets() {
    const section = document.getElementById('asset-section');
    const treeContainer = document.getElementById('asset-tree');
    if (!state.currentProjectName) {
        section.classList.add('is-hidden');
        return;
    }
    try {
        const resp = await fetch('/api/assets/' + encodeURIComponent(state.currentProjectName));
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

export function renderAssetTree(nodes, container, parentPath) {
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
            const url = '/api/assets/' + encodeURIComponent(state.currentProjectName) + '/' + path;
            const alt = node.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_]/g, '_');
            const syntax = assetSyntax(url, node.name);
            html += '<div class="asset-tree-file-row" title="Click to copy: ' + escapeHtml(syntax) + '">';
            html += '  <img class="asset-preview" src="' + url + '" alt="' + escapeHtml(alt) + '" loading="lazy">';
            html += '  <span class="asset-syntax">' + escapeHtml(syntax) + '</span>';
            html += '  <button class="asset-delete-btn" data-path="' + escapeHtml(path) + '" title="Delete asset">' + SVG_CLOSE + '</button>';
            html += '</div>';
        }
    }
    container.innerHTML = html;
}

export function renderAssetTreeChildren(nodes, parentPath) {
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
            const url = '/api/assets/' + encodeURIComponent(state.currentProjectName) + '/' + path;
            const alt = node.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_]/g, '_');
            const syntax = assetSyntax(url, node.name);
            html += '<div class="asset-tree-file-row" title="Click to copy: ' + escapeHtml(syntax) + '">';
            html += '  <img class="asset-preview" src="' + url + '" alt="' + escapeHtml(alt) + '" loading="lazy">';
            html += '  <span class="asset-syntax">' + escapeHtml(syntax) + '</span>';
            html += '  <button class="asset-delete-btn" data-path="' + escapeHtml(path) + '" title="Delete asset">' + SVG_CLOSE + '</button>';
            html += '</div>';
        }
    }
    return html;
}

export function getEntriesAtPath(tree, path) {
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

export function renderAssetExplorer(tree) {
    const entries = getEntriesAtPath(tree, state.aeCurrentPath);
    renderBreadcrumb(state.aeCurrentPath);
    renderAEGrid(entries);
}

export function renderBreadcrumb(path) {
    const parts = path ? path.split('/') : [];
    let html = '<span class="ae-crumb" data-path="">root</span>';
    let cumulative = '';
    for (const part of parts) {
        cumulative = cumulative ? cumulative + '/' + part : part;
        html += '<span class="ae-crumb" data-path="' + escapeHtml(cumulative) + '">' + escapeHtml(part) + '</span>';
    }
    document.getElementById('ae-breadcrumb').innerHTML = html;
}

export function renderAEGrid(entries) {
    const grid = document.getElementById('ae-file-grid');
    if (entries.length === 0) {
        grid.innerHTML = '<div class="ae-empty">This folder is empty</div>';
        return;
    }
    let html = '';
    for (const entry of entries) {
        const path = state.aeCurrentPath ? state.aeCurrentPath + '/' + entry.name : entry.name;
        const selClass = state.aeSelectedPaths.has(path) ? ' selected' : '';
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

export function updateAEToolbar() {
    const count = state.aeSelectedPaths.size;
    document.querySelector('#ae-toolbar [data-ae-action="rename"]').disabled = count !== 1;
    document.querySelector('#ae-toolbar [data-ae-action="delete"]').disabled = count === 0;
    document.querySelector('#ae-toolbar [data-ae-action="copy"]').disabled = count === 0;
    document.querySelector('#ae-toolbar [data-ae-action="cut"]').disabled = count === 0;
    document.querySelector('#ae-toolbar [data-ae-action="paste"]').disabled = state.aeClipboard === null;
}

export function aeNavigate(path) {
    state.aeCurrentPath = path;
    state.aeSelectedPaths.clear();
    refreshAssets();
}

export async function aeNewFolder(targetPath) {
    const name = prompt('Folder name:');
    if (!name || !name.trim()) return;
    const folderPath = targetPath !== undefined ? (targetPath ? targetPath + '/' + name.trim() : name.trim()) : (state.aeCurrentPath ? state.aeCurrentPath + '/' + name.trim() : name.trim());
    try {
        const resp = await fetch('/api/assets/' + encodeURIComponent(state.currentProjectName) + '/folder', {
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

export async function aeUpload(targetPath) {
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
                const resp = await fetch('/api/assets/' + encodeURIComponent(state.currentProjectName) + '/upload', {
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

export async function aeDelete(singlePath) {
    const paths = singlePath ? [singlePath] : Array.from(state.aeSelectedPaths);
    if (paths.length === 0) return;
    const msg = paths.length === 1
        ? 'Delete "' + paths[0] + '" permanently?'
        : 'Delete ' + paths.length + ' selected item(s)?';
    if (!confirm(msg)) return;
    let totalDeleted = 0;
    let hadError = false;
    for (const p of paths) {
        try {
            const resp = await fetch('/api/assets/' + encodeURIComponent(state.currentProjectName) + '/' + encodeURIComponent(p), {
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
    state.aeSelectedPaths.clear();
    refreshAssets();
}

export async function aeRename() {
    if (state.aeSelectedPaths.size !== 1) return;
    const path = state.aeSelectedPaths.values().next().value;
    const oldName = path.split('/').pop();
    const newName = prompt('New name:', oldName);
    if (!newName || !newName.trim() || newName === oldName) return;
    try {
        const resp = await fetch('/api/assets/' + encodeURIComponent(state.currentProjectName) + '/rename', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: path, new_name: newName.trim() })
        });
        if (!resp.ok) {
            const err = await resp.json();
            throw new Error(err.detail || 'Rename failed');
        }
        showToast('Renamed');
        state.aeSelectedPaths.clear();
        refreshAssets();
    } catch (err) {
        alert('Failed to rename: ' + err.message);
    }
}

export function aeCopy() {
    if (state.aeSelectedPaths.size === 0) return;
    state.aeClipboard = { action: 'copy', paths: Array.from(state.aeSelectedPaths) };
    updateAEToolbar();
    showToast('Copied ' + state.aeClipboard.paths.length + ' item(s)');
}

export function aeCut() {
    if (state.aeSelectedPaths.size === 0) return;
    state.aeClipboard = { action: 'cut', paths: Array.from(state.aeSelectedPaths) };
    updateAEToolbar();
    showToast('Cut ' + state.aeClipboard.paths.length + ' item(s)');
}

export async function aePaste() {
    if (!state.aeClipboard) return;
    const results = { copied: 0, moved: 0, errors: 0 };
    for (const srcPath of state.aeClipboard.paths) {
        const srcName = srcPath.split('/').pop();
        const dstPath = state.aeCurrentPath ? state.aeCurrentPath + '/' + srcName : srcName;
        if (srcPath === dstPath) continue;
        try {
            if (state.aeClipboard.action === 'copy') {
                const resp = await fetch('/api/assets/' + encodeURIComponent(state.currentProjectName) + '/copy', {
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
                const resp = await fetch('/api/assets/' + encodeURIComponent(state.currentProjectName) + '/move', {
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
    const verb = state.aeClipboard.action === 'copy' ? 'Copied' : 'Moved';
    const count = state.aeClipboard.action === 'copy' ? results.copied : results.moved;
    showToast(verb + ' ' + count + ' item(s)' + (results.errors > 0 ? ' (' + results.errors + ' failed)' : ''));
    if (state.aeClipboard.action === 'cut') {
        state.aeClipboard = null;
    }
    state.aeSelectedPaths.clear();
    refreshAssets();
}

export function insertImage() {
    if (!state.currentProjectName) {
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
            const resp = await fetch('/api/assets/' + encodeURIComponent(state.currentProjectName) + '/upload', {
                method: 'POST',
                body: formData
            });
            if (!resp.ok) {
                const err = await resp.json();
                throw new Error(err.detail || 'Upload failed');
            }
            const result = await resp.json();
            const alt = file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_]/g, '_');
            const markdown = '{img: ' + result.url + (alt ? ', alt=' + alt : '') + '}';
            insertAtCursor(markdown);
            refreshAssets();
        } catch (err) {
            alert('Failed to upload image: ' + err.message);
        }
    };
    input.click();
}
