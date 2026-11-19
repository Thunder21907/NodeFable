// frontend/editor/js/node-search.js
// Header search suggestions: as you type in #node-search, a dropdown lists the
// best-matching passages (by title and slug id). Picking one switches to the
// graph, centres the canvas on it and selects it. Passages inside collapsed /
// unloaded groups are listed too and focus their group's portal.
import { state } from './state.js';
import { escapeHtml, showToast } from './ui-utils.js';
import { filterNodes } from './event-delegation.js';

const MAX_SUGGESTIONS = 8;

// ── Ranking (pure: no DOM, no state) ──────────────────────────────

// Score one candidate string against the lower-cased query.
// Lower is better; Infinity = no match.
function _scoreText(text, q) {
    const t = (text || '').toLowerCase();
    if (!t || !q) return Infinity;
    if (t === q) return 0;
    if (t.startsWith(q)) return 1;
    const idx = t.indexOf(q);
    if (idx === -1) return Infinity;
    // Match at a word start ("dark forest" / "dark_forest" for "for").
    if (/[\s_\-.:/]/.test(t[idx - 1])) return 2;
    return 3;
}

// entries: [{ key, title, slug, kind, group?, focusId }]
// Returns up to `limit` entries sorted best-first, each with `score` and
// `matchIn` ('title' | 'slug'). Title matches win ties over slug matches.
export function rankSearchSuggestions(entries, query, limit = MAX_SUGGESTIONS) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return [];
    const scored = [];
    for (const entry of entries) {
        const ts = _scoreText(entry.title, q);
        const ss = _scoreText(entry.slug, q);
        const best = Math.min(ts, ss);
        if (best === Infinity) continue;
        scored.push({
            ...entry,
            score: best + (entry.kind === 'node' ? 0 : 0.5),   // loaded passages first on ties
            matchIn: ts <= ss ? 'title' : 'slug'
        });
    }
    scored.sort((a, b) =>
        a.score - b.score
        || (a.title || a.slug || '').length - (b.title || b.slug || '').length
        || (a.title || a.slug || '').localeCompare(b.title || b.slug || ''));
    return scored.slice(0, limit);
}

// ── Candidate collection (reads state) ────────────────────────────

export function collectSearchEntries() {
    const entries = [];
    const seen = new Set();
    for (const [idStr, data] of Object.entries(state.nodesData)) {
        const id = parseInt(idStr, 10);
        if (data.isPortal) {
            const label = data.portalGroupLabel || data.portalGroupId;
            entries.push({ key: 'group:' + data.portalGroupId, title: label, slug: data.portalGroupId, kind: 'group', focusId: id });
            // Passages inside the collapsed / unloaded group → focus the portal.
            const cached = state.collapsedGroupsData[data.portalGroupId] || [];
            const titles = new Map(cached.map(n => [n.id, n.title]));
            (data.portalSlugIds || []).forEach((entry) => {
                const slug = typeof entry === 'string' ? entry : entry.slug_id;
                if (!slug || seen.has(slug)) return;
                seen.add(slug);
                entries.push({ key: 'slug:' + slug, title: titles.get(slug) || '', slug, kind: 'collapsed', group: label, focusId: id });
            });
            continue;
        }
        if (!data.slug || seen.has(data.slug)) continue;
        seen.add(data.slug);
        entries.push({ key: 'slug:' + data.slug, title: data.title || '', slug: data.slug, kind: 'node', focusId: id });
    }
    return entries;
}

// ── Focus ─────────────────────────────────────────────────────────

// Switch to the graph tab, centre the canvas on `nodeId`, select it and
// briefly flash it.
export function focusNodeOnCanvas(nodeId) {
    const nodeEl = document.getElementById('node-' + nodeId);
    if (!nodeEl || !state.editor) return false;
    const graphTabBtn = document.querySelector('.tab-btn[data-tab="graph"]');
    if (graphTabBtn && !graphTabBtn.classList.contains('active')) graphTabBtn.click();
    // Dimmed (search-mismatch) nodes ignore pointer events; clear the filter.
    filterNodes('');
    state.editor.focusNode(nodeId, { minZoom: 0.75 });
    state.editor.selectNode(nodeId);
    nodeEl.classList.remove('node-focus-flash');
    void nodeEl.offsetWidth; // restart the animation
    nodeEl.classList.add('node-focus-flash');
    setTimeout(() => nodeEl.classList.remove('node-focus-flash'), 1300);
    return true;
}

// ── Dropdown UI ───────────────────────────────────────────────────

function _highlight(text, query) {
    const t = String(text || '');
    const q = String(query || '').trim();
    const idx = q ? t.toLowerCase().indexOf(q.toLowerCase()) : -1;
    if (idx === -1) return escapeHtml(t);
    return escapeHtml(t.slice(0, idx))
        + '<mark>' + escapeHtml(t.slice(idx, idx + q.length)) + '</mark>'
        + escapeHtml(t.slice(idx + q.length));
}

export function setupSearchSuggestions() {
    const input = document.getElementById('node-search');
    if (!input) return;

    const list = document.createElement('ul');
    list.id = 'node-search-suggestions';
    list.className = 'search-suggestions is-hidden';
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', 'Matching passages');
    // Fixed-position and attached to <body>: the header clips overflow on
    // narrow viewports, so the list cannot live inside it.
    document.body.appendChild(list);

    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-controls', list.id);
    input.setAttribute('aria-expanded', 'false');

    let items = [];
    let active = -1;

    const close = () => {
        list.classList.add('is-hidden');
        input.setAttribute('aria-expanded', 'false');
        input.removeAttribute('aria-activedescendant');
        items = [];
        active = -1;
    };

    const position = () => {
        const r = input.getBoundingClientRect();
        list.style.left = r.left + 'px';
        list.style.top = (r.bottom + 4) + 'px';
        list.style.width = Math.max(r.width, 260) + 'px';
    };

    const setActive = (i) => {
        active = i;
        Array.from(list.children).forEach((li, idx) => {
            const on = idx === i;
            li.classList.toggle('active', on);
            li.setAttribute('aria-selected', on ? 'true' : 'false');
            if (on) {
                input.setAttribute('aria-activedescendant', li.id);
                if (typeof li.scrollIntoView === 'function') li.scrollIntoView({ block: 'nearest' });
            }
        });
    };

    const render = () => {
        const q = input.value;
        items = rankSearchSuggestions(collectSearchEntries(), q);
        if (!q.trim()) { close(); return; }
        if (items.length === 0) {
            list.innerHTML = '<li class="search-suggestion-empty" role="option" aria-disabled="true">No matching passages</li>';
        } else {
            list.innerHTML = items.map((it, i) => {
                const title = it.title || it.slug;
                const badge = it.kind === 'group'
                    ? '<span class="ss-badge">group</span>'
                    : it.kind === 'collapsed'
                        ? '<span class="ss-badge">in ' + escapeHtml(it.group || '') + '</span>'
                        : '';
                return '<li id="ss-opt-' + i + '" role="option" aria-selected="false" class="search-suggestion" data-index="' + i + '">'
                    + '<span class="ss-title">' + _highlight(title, q) + '</span>'
                    + '<span class="ss-meta"><code class="ss-slug">' + _highlight(it.slug, q) + '</code>' + badge + '</span>'
                    + '</li>';
            }).join('');
        }
        position();
        list.classList.remove('is-hidden');
        input.setAttribute('aria-expanded', 'true');
        setActive(items.length ? 0 : -1);
    };

    const choose = (i) => {
        const it = items[i];
        if (!it) return;
        close();
        input.value = '';
        clearTimeout(state.searchDebounceTimer);
        input.blur();
        if (!focusNodeOnCanvas(it.focusId)) {
            showToast('Passage is not on the canvas');
            return;
        }
        if (it.kind === 'collapsed') {
            showToast('"' + it.slug + '" is in collapsed group "' + it.group + '" — load the group to edit it');
        }
    };

    input.addEventListener('input', render);
    input.addEventListener('focus', () => { if (input.value.trim()) render(); });
    input.addEventListener('blur', close);
    input.addEventListener('keydown', (e) => {
        const open = !list.classList.contains('is-hidden') && items.length > 0;
        if (e.key === 'ArrowDown' && open) {
            e.preventDefault();
            setActive((active + 1) % items.length);
        } else if (e.key === 'ArrowUp' && open) {
            e.preventDefault();
            setActive((active - 1 + items.length) % items.length);
        } else if (e.key === 'Enter' && open) {
            e.preventDefault();
            choose(active >= 0 ? active : 0);
        } else if (e.key === 'Escape') {
            close();
        }
    });
    // mousedown (not click) so the input's blur doesn't close the list first.
    list.addEventListener('mousedown', (e) => {
        const li = e.target.closest('.search-suggestion');
        if (!li) return;
        e.preventDefault();
        choose(parseInt(li.dataset.index, 10));
    });
    list.addEventListener('mousemove', (e) => {
        const li = e.target.closest('.search-suggestion');
        if (li) {
            const i = parseInt(li.dataset.index, 10);
            if (i !== active) setActive(i);
        }
    });
    window.addEventListener('resize', () => { if (!list.classList.contains('is-hidden')) position(); });
}
