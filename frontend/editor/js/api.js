// frontend/editor/js/api.js
// Unified transport adapter for NodeFable editor: routes calls through
// window.__TAURI_INTERNALS__.invoke when running inside Tauri, or HTTP fetch
// against the FastAPI backend otherwise.

const LEGACY_ASSET_RE = /\/api\/assets\/[^/]+\/([^)"\s,}]+)/g;

export function isTauri() {
    return Boolean(
        typeof window !== 'undefined' &&
        window.__TAURI_INTERNALS__ &&
        typeof window.__TAURI_INTERNALS__.invoke === 'function'
    );
}

export function invokeTauri(cmd, args = {}) {
    return window.__TAURI_INTERNALS__.invoke(cmd, args);
}

export function cleanAssetRelPath(relPath) {
    if (!relPath) return '';
    return String(relPath)
        .replace(/\\/g, '/')
        .replace(/^\/+api\/assets\/[^/]+\/+/, '')
        .replace(/^api\/assets\/[^/]+\/+/, '')
        .replace(/^\/+/, '')
        .replace(/^assets\/+/, '')
        .replace(/^\/+/, '');
}

export function resolveEditorAssetUrl(projectName, relPath) {
    const clean = cleanAssetRelPath(relPath);
    if (!projectName || !clean) return '';
    if (isTauri()) {
        return 'nfasset://localhost/' + encodeURIComponent(projectName) + '/assets/' + clean;
    }
    return '/api/assets/' + encodeURIComponent(projectName) + '/' + clean;
}

export function normalizeLegacyAssetUrls(obj, projectName) {
    if (typeof obj === 'string') {
        return obj.replace(LEGACY_ASSET_RE, 'assets/$1');
    }
    if (Array.isArray(obj)) {
        for (let i = 0; i < obj.length; i++) {
            obj[i] = normalizeLegacyAssetUrls(obj[i], projectName);
        }
        return obj;
    }
    if (obj && typeof obj === 'object') {
        for (const key of Object.keys(obj)) {
            obj[key] = normalizeLegacyAssetUrls(obj[key], projectName);
        }
        return obj;
    }
    return obj;
}

async function _readErrorDetail(resp, fallback) {
    try {
        const err = await resp.json();
        if (err && err.detail) return err.detail;
    } catch {}
    return fallback;
}

export async function listSaves() {
    if (isTauri()) {
        const res = await invokeTauri('list_saves');
        if (Array.isArray(res)) return res;
        return (res && res.saves) || res || [];
    }
    const resp = await fetch('/api/saves');
    if (!resp.ok) {
        throw new Error(await _readErrorDetail(resp, 'Failed to list saves'));
    }
    const data = await resp.json();
    return data.saves || [];
}

export async function loadManifest(name) {
    if (isTauri()) {
        const m = await invokeTauri('load_manifest', { name });
        return normalizeLegacyAssetUrls(m, name);
    }
    const resp = await fetch('/api/load/manifest?name=' + encodeURIComponent(name));
    if (!resp.ok) {
        throw new Error(await _readErrorDetail(resp, 'Failed to load project manifest'));
    }
    return normalizeLegacyAssetUrls(await resp.json(), name);
}

export async function loadProject(name, groups) {
    if (isTauri()) {
        const groupList = Array.isArray(groups)
            ? groups
            : (groups ? String(groups).split(',').map(s => s.trim()).filter(Boolean) : null);
        const p = await invokeTauri('load_project', { name, groups: groupList });
        return normalizeLegacyAssetUrls(p, name);
    }
    const groupStr = Array.isArray(groups) ? groups.join(',') : (groups || '');
    const url = '/api/load?name=' + encodeURIComponent(name) +
        (groupStr ? '&groups=' + encodeURIComponent(groupStr) : '');
    const resp = await fetch(url);
    if (!resp.ok) {
        throw new Error(await _readErrorDetail(resp, 'Failed to load project'));
    }
    return normalizeLegacyAssetUrls(await resp.json(), name);
}

export async function saveProject(payload) {
    normalizeLegacyAssetUrls(payload, payload && payload.name);
    if (isTauri()) {
        return await invokeTauri('save_project', { req: payload });
    }
    const resp = await fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    if (!resp.ok) {
        throw new Error(await _readErrorDetail(resp, 'Save failed'));
    }
    return await resp.json();
}

export async function listAssets(name) {
    if (isTauri()) {
        const res = await invokeTauri('list_assets', { name });
        return Array.isArray(res) ? { tree: res } : res;
    }
    const resp = await fetch('/api/assets/' + encodeURIComponent(name));
    if (!resp.ok) {
        throw new Error(await _readErrorDetail(resp, 'Failed to load assets'));
    }
    return await resp.json();
}

export async function uploadAsset(name, file, folder = '') {
    const cleanFolder = (folder || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    const relPath = cleanFolder ? cleanFolder + '/' + file.name : file.name;
    if (isTauri()) {
        const buf = await file.arrayBuffer();
        const res = await invokeTauri('upload_asset', {
            name,
            filename: file.name,
            folder: cleanFolder,
            bytes: Array.from(new Uint8Array(buf)),
        });
        const finalRelPath = (res && res.rel_path) || relPath;
        return {
            status: 'ok',
            filename: file.name,
            rel_path: finalRelPath,
            url: 'assets/' + finalRelPath,
        };
    }
    const formData = new FormData();
    formData.append('file', file);
    if (cleanFolder) {
        formData.append('folder', cleanFolder);
    }
    const resp = await fetch('/api/assets/' + encodeURIComponent(name) + '/upload', {
        method: 'POST',
        body: formData,
    });
    if (!resp.ok) {
        throw new Error(await _readErrorDetail(resp, 'Upload failed'));
    }
    const res = await resp.json();
    return { ...res, rel_path: cleanAssetRelPath(res.url || relPath) };
}

export async function createFolder(name, path) {
    if (isTauri()) {
        return await invokeTauri('create_folder', { name, path });
    }
    const resp = await fetch('/api/assets/' + encodeURIComponent(name) + '/folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
    });
    if (!resp.ok) {
        throw new Error(await _readErrorDetail(resp, 'Failed to create folder'));
    }
    return await resp.json();
}

export async function renameAsset(name, path, newName) {
    if (isTauri()) {
        return await invokeTauri('rename_asset', { name, path, newName });
    }
    const resp = await fetch('/api/assets/' + encodeURIComponent(name) + '/rename', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, new_name: newName }),
    });
    if (!resp.ok) {
        throw new Error(await _readErrorDetail(resp, 'Rename failed'));
    }
    return await resp.json();
}

export async function moveAsset(name, fromPath, toPath) {
    if (isTauri()) {
        return await invokeTauri('move_asset', { name, fromPath, toPath });
    }
    const resp = await fetch('/api/assets/' + encodeURIComponent(name) + '/move', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from_path: fromPath, to_path: toPath }),
    });
    if (!resp.ok) {
        throw new Error(await _readErrorDetail(resp, 'Move failed'));
    }
    return await resp.json();
}

export async function copyAsset(name, fromPath, toPath) {
    if (isTauri()) {
        return await invokeTauri('copy_asset', { name, fromPath, toPath });
    }
    const resp = await fetch('/api/assets/' + encodeURIComponent(name) + '/copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from_path: fromPath, to_path: toPath }),
    });
    if (!resp.ok) {
        throw new Error(await _readErrorDetail(resp, 'Copy failed'));
    }
    return await resp.json();
}

export async function deleteAsset(name, filepath) {
    if (isTauri()) {
        return await invokeTauri('delete_asset', { name, filepath });
    }
    const resp = await fetch('/api/assets/' + encodeURIComponent(name) + '/' + encodeURIComponent(filepath), {
        method: 'DELETE',
    });
    if (!resp.ok) {
        throw new Error(await _readErrorDetail(resp, 'Delete failed'));
    }
    return await resp.json();
}

export async function buildPreviewHtml(name) {
    if (isTauri()) {
        const res = await invokeTauri('build_preview_html', { name });
        return typeof res === 'string' ? { html: res, url: null } : res;
    }
    const resp = await fetch('/api/preview/' + encodeURIComponent(name));
    if (!resp.ok) {
        throw new Error(await _readErrorDetail(resp, 'Preview failed'));
    }
    return await resp.json();
}

export async function exportProjectZip(name) {
    if (isTauri()) {
        return await invokeTauri('export_project_zip', { name });
    }
    window.location.href = '/api/export/' + encodeURIComponent(name);
}

export const api = {
    isTauri,
    invokeTauri,
    cleanAssetRelPath,
    resolveEditorAssetUrl,
    normalizeLegacyAssetUrls,
    listSaves,
    loadManifest,
    loadProject,
    saveProject,
    listAssets,
    uploadAsset,
    createFolder,
    renameAsset,
    moveAsset,
    copyAsset,
    deleteAsset,
    buildPreviewHtml,
    exportProjectZip,
};

export default api;
