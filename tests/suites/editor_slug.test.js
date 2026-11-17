'use strict';
// tests/suites/editor_slug.test.js
// Unit tests for propagateSlugRename in frontend/editor/js/node-editor.js.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { section, test } = require('../harness.js');

const ROOT = path.join(__dirname, '..', '..');
const UI_UTILS_PATH = path.join(ROOT, 'frontend', 'editor', 'js', 'ui-utils.js');
const NODE_EDITOR_PATH = path.join(ROOT, 'frontend', 'editor', 'js', 'node-editor.js');

function extractExportedFunction(src, fnName) {
    const marker = 'export function ' + fnName + '(';
    const start = src.indexOf(marker);
    if (start === -1) throw new Error('Could not find ' + marker);
    const bodyStart = src.indexOf('{', start);
    let depth = 0;
    let inSingle = false;
    let inDouble = false;
    let inTemplate = false;
    let escaped = false;
    for (let i = bodyStart; i < src.length; i++) {
        const ch = src[i];
        if (escaped) { escaped = false; continue; }
        if (ch === '\\' && (inSingle || inDouble || inTemplate)) { escaped = true; continue; }
        if (inSingle) { if (ch === "'") inSingle = false; continue; }
        if (inDouble) { if (ch === '"') inDouble = false; continue; }
        if (inTemplate) { if (ch === '`') inTemplate = false; continue; }
        if (ch === "'") { inSingle = true; continue; }
        if (ch === '"') { inDouble = true; continue; }
        if (ch === '`') { inTemplate = true; continue; }
        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) {
                return src.slice(start + 'export '.length, i + 1);
            }
        }
    }
    throw new Error('Unterminated function ' + fnName);
}

function loadPropagateSlugRename(initialState) {
    const uiUtilsSrc = fs.readFileSync(UI_UTILS_PATH, 'utf8');
    const nodeEditorSrc = fs.readFileSync(NODE_EDITOR_PATH, 'utf8');
    const escapeRegexCode = extractExportedFunction(uiUtilsSrc, 'escapeRegex');
    const propagateCode = extractExportedFunction(nodeEditorSrc, 'propagateSlugRename');

    const ctx = vm.createContext({ state: initialState });
    vm.runInContext(escapeRegexCode + '\n' + propagateCode, ctx);
    return ctx.propagateSlugRename;
}

function makeFixtureState() {
    return {
        slugToNodeId: {
            start: 1,
            old_forest: 2,
            old_forest_2: 3,
            portal_1: 4,
        },
        nodesData: {
            1: {
                slug: 'start',
                text: 'Head out: [Go north](node:old_forest) or [Other](node:old_forest_2).\n{redirect: old_forest}\n{include: old_forest}\n{redirect: old_forest_2}',
                choices: [
                    { text: 'Go north', targetSlug: 'old_forest' },
                    { text: 'Other', targetSlug: 'old_forest_2' },
                ],
                on_enter: { target_node_id: 'old_forest' },
            },
            2: {
                slug: 'old_forest',
                text: 'You are in the woods. {include: old_forest}',
                choices: [],
                on_enter: { target_node_id: 'old_forest_2' },
            },
            4: {
                slug: 'portal_1',
                isPortal: true,
                portalSlugIds: [
                    'old_forest',
                    { slug_id: 'old_forest', connections: ['start', 'old_forest', 'old_forest_2'] },
                    { slug_id: 'camp', connections: ['old_forest'] },
                ],
            },
        },
        collapsedGroupsData: {
            grp_a: [
                {
                    id: 'old_forest',
                    text: 'Cached [Go north](node:old_forest) {redirect: old_forest} {include: old_forest} [Other](node:old_forest_2)',
                    choices: [
                        { text: 'Loop', targetSlug: 'old_forest', target_node_id: 'old_forest' },
                        { text: 'Stay', targetSlug: 'old_forest_2', target_node_id: 'old_forest_2' },
                    ],
                    on_enter: { target_node_id: 'old_forest' },
                },
                {
                    id: 'old_forest_2',
                    text: 'Sibling [Back](node:old_forest)',
                    choices: [{ text: 'Back', targetSlug: 'old_forest', target_node_id: 'old_forest' }],
                    on_enter: { target_node_id: 'old_forest_2' },
                },
            ],
        },
        groupsManifest: {
            groups: [
                {
                    id: 'grp_a',
                    slug_ids: [
                        'old_forest',
                        { slug_id: 'old_forest', connections: ['old_forest', 'old_forest_2'] },
                        { slug_id: 'camp', connections: ['old_forest'] },
                    ],
                },
            ],
        },
    };
}

section('Editor Slug Propagation (propagateSlugRename)');

test('1. updates state.slugToNodeId (removes old_forest, maps deep_woods -> 2)', () => {
    const state = makeFixtureState();
    const propagateSlugRename = loadPropagateSlugRename(state);
    propagateSlugRename('old_forest', 'deep_woods', 2);

    assert.strictEqual('old_forest' in state.slugToNodeId, false);
    assert.strictEqual(state.slugToNodeId.deep_woods, 2);
    assert.strictEqual(state.slugToNodeId.old_forest_2, 3);
    assert.strictEqual(state.slugToNodeId.start, 1);
});

test('2. rewrites markdown links, {redirect:}, and {include:} in nodesData while preserving old_forest_2', () => {
    const state = makeFixtureState();
    const propagateSlugRename = loadPropagateSlugRename(state);
    const rewriteText = propagateSlugRename('old_forest', 'deep_woods', 2);

    assert.strictEqual(
        state.nodesData[1].text,
        'Head out: [Go north](node:deep_woods) or [Other](node:old_forest_2).\n{redirect: deep_woods}\n{include: deep_woods}\n{redirect: old_forest_2}'
    );
    assert.strictEqual(
        state.nodesData[2].text,
        'You are in the woods. {include: deep_woods}'
    );
    assert.strictEqual(
        rewriteText('[Go north](node:old_forest) and [Other](node:old_forest_2)'),
        '[Go north](node:deep_woods) and [Other](node:old_forest_2)'
    );
});

test('3. updates choices[].targetSlug and on_enter.target_node_id in state.nodesData', () => {
    const state = makeFixtureState();
    const propagateSlugRename = loadPropagateSlugRename(state);
    propagateSlugRename('old_forest', 'deep_woods', 2);

    assert.deepStrictEqual(state.nodesData[1].choices, [
        { text: 'Go north', targetSlug: 'deep_woods' },
        { text: 'Other', targetSlug: 'old_forest_2' },
    ]);
    assert.strictEqual(state.nodesData[1].on_enter.target_node_id, 'deep_woods');
    assert.strictEqual(state.nodesData[2].on_enter.target_node_id, 'old_forest_2');
});

test('4. updates portalSlugIds on portal nodes in state.nodesData', () => {
    const state = makeFixtureState();
    const propagateSlugRename = loadPropagateSlugRename(state);
    propagateSlugRename('old_forest', 'deep_woods', 2);

    assert.deepStrictEqual(JSON.parse(JSON.stringify(state.nodesData[4].portalSlugIds)), [
        'deep_woods',
        { slug_id: 'deep_woods', connections: ['start', 'deep_woods', 'old_forest_2'] },
        { slug_id: 'camp', connections: ['deep_woods'] },
    ]);
});

test('5. updates id, choices[].targetSlug, choices[].target_node_id, on_enter.target_node_id, and text in state.collapsedGroupsData', () => {
    const state = makeFixtureState();
    const propagateSlugRename = loadPropagateSlugRename(state);
    propagateSlugRename('old_forest', 'deep_woods', 2);

    const [renamed, sibling] = state.collapsedGroupsData.grp_a;
    assert.strictEqual(renamed.id, 'deep_woods');
    assert.strictEqual(
        renamed.text,
        'Cached [Go north](node:deep_woods) {redirect: deep_woods} {include: deep_woods} [Other](node:old_forest_2)'
    );
    assert.deepStrictEqual(renamed.choices, [
        { text: 'Loop', targetSlug: 'deep_woods', target_node_id: 'deep_woods' },
        { text: 'Stay', targetSlug: 'old_forest_2', target_node_id: 'old_forest_2' },
    ]);
    assert.strictEqual(renamed.on_enter.target_node_id, 'deep_woods');

    assert.strictEqual(sibling.id, 'old_forest_2');
    assert.strictEqual(sibling.text, 'Sibling [Back](node:deep_woods)');
    assert.deepStrictEqual(sibling.choices, [
        { text: 'Back', targetSlug: 'deep_woods', target_node_id: 'deep_woods' },
    ]);
    assert.strictEqual(sibling.on_enter.target_node_id, 'old_forest_2');
});

test('6. updates slug_id and connections[] inside state.groupsManifest.groups[].slug_ids', () => {
    const state = makeFixtureState();
    const propagateSlugRename = loadPropagateSlugRename(state);
    propagateSlugRename('old_forest', 'deep_woods', 2);

    assert.deepStrictEqual(JSON.parse(JSON.stringify(state.groupsManifest.groups[0].slug_ids)), [
        'deep_woods',
        { slug_id: 'deep_woods', connections: ['deep_woods', 'old_forest_2'] },
        { slug_id: 'camp', connections: ['deep_woods'] },
    ]);
});
