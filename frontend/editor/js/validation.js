// frontend/editor/js/validation.js
import { state } from './state.js';

export function validateDeadEnds() {
    for (const [nodeIdStr, data] of Object.entries(state.nodesData)) {
        const nodeEl = document.getElementById('node-' + nodeIdStr);
        if (!nodeEl) continue;
        if (data.slug === 'side_panel' || data.is_utility) {
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

export function validateOrphans() {
    let startSlug = null;
    for (const [id, data] of Object.entries(state.nodesData)) {
        if (data.is_start) { startSlug = data.slug; break; }
    }
    if (!startSlug) {
        for (const [id, data] of Object.entries(state.nodesData)) {
            if (data.slug !== 'side_panel') { startSlug = data.slug; break; }
        }
    }
    if (!startSlug) return;

    const visited = new Set();
    const queue = [startSlug];

    // Build text-based redirect edges: sourceSlug → [targetSlug, ...]
    const redirectEdges = {};
    for (const [, data] of Object.entries(state.nodesData)) {
        if (data.text) {
            const matches = data.text.match(/\{redirect:([^}]+)\}/g);
            if (matches) {
                const targets = matches.map(m => m.replace('{redirect:', '').replace('}', '').trim())
                                        .filter(t => t !== 'back');
                redirectEdges[data.slug] = [...new Set(targets)];
            }
        }
    }

    while (queue.length > 0) {
        const current = queue.shift();
        if (visited.has(current)) continue;
        visited.add(current);
        const nodeId = state.slugToNodeId[current];
        if (!nodeId || !state.nodesData[nodeId]) continue;
        const data = state.nodesData[nodeId];
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

    for (const [nodeIdStr, data] of Object.entries(state.nodesData)) {
        const nodeEl = document.getElementById('node-' + nodeIdStr);
        if (!nodeEl) continue;
        if (data.slug === 'side_panel' || data.is_utility) {
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

export function runValidation() {
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
