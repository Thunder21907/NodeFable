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

// ── Responsive drawers (≤1024px) ─────────────────────────────────
// #var-panel (left) and #sidebar (right) slide in as drawers with a shared
// #drawer-backdrop. Only one drawer is open at a time.

export const DRAWER_BREAKPOINT = 1024;

export function isDrawerLayout() {
    return typeof window !== 'undefined' && window.innerWidth <= DRAWER_BREAKPOINT;
}

export function closeDrawers() {
    const varPanel = document.getElementById('var-panel');
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('drawer-backdrop');
    if (varPanel) varPanel.classList.remove('drawer-open');
    if (sidebar) sidebar.classList.remove('drawer-open');
    if (backdrop) backdrop.classList.add('is-hidden');
}

// id: 'var-panel' | 'sidebar'
export function openDrawer(id) {
    const el = document.getElementById(id);
    if (!el) return;
    closeDrawers();
    el.classList.add('drawer-open');
    const backdrop = document.getElementById('drawer-backdrop');
    if (backdrop) backdrop.classList.remove('is-hidden');
}

export function toggleDrawer(id) {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.classList.contains('drawer-open')) closeDrawers();
    else openDrawer(id);
}
