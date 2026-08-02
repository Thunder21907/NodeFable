// frontend/editor/js/ui-utils.js
import { state } from './state.js';

export function showLoader(msg) {
    state.loaderCount++;
    if (state.loaderCount === 1) {
        const overlay = document.getElementById('loader-overlay');
        const text = document.getElementById('loader-text');
        if (text) text.textContent = msg || 'Loading...';
        if (overlay) overlay.style.display = 'flex';
    }
}

export function hideLoader() {
    state.loaderCount = Math.max(0, state.loaderCount - 1);
    if (state.loaderCount === 0) {
        const overlay = document.getElementById('loader-overlay');
        if (overlay) overlay.style.display = 'none';
    }
}

export function showToast(msg) {
    const existing = document.getElementById('toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.id = 'toast';
    toast.textContent = msg;
    document.body.appendChild(toast);
    clearTimeout(state.toastTimeout);
    state.toastTimeout = setTimeout(() => {
        toast.classList.add('hidden');
        setTimeout(() => toast.remove(), 300);
    }, 2000);
}

export function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function showIdError(msg) {
    const errorEl = document.getElementById('passage-id-error');
    errorEl.textContent = msg;
    errorEl.style.display = 'block';
    document.getElementById('passage-id').style.borderColor = 'var(--danger-color)';
}

export function hideIdError() {
    document.getElementById('passage-id-error').style.display = 'none';
    document.getElementById('passage-id').style.borderColor = '';
}

export function validateSlugOnBlur() {
    if (!state.selectedNodeId) return false;
    const newSlug = document.getElementById('passage-id').value.trim();
    const nodeData = state.nodesData[state.selectedNodeId];
    if (!nodeData) return false;

    if (!newSlug) {
        showIdError('Node ID cannot be empty');
        return false;
    }
    if (newSlug !== nodeData.slug && state.slugToNodeId[newSlug] !== undefined) {
        showIdError('Node ID "' + newSlug + '" is already in use');
        return false;
    } else {
        hideIdError();
        return true;
    }
}
