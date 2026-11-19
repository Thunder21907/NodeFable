'use strict';
// tests/suites/node_search.test.js
// Unit tests for the search-suggestion ranking in frontend/editor/js/node-search.js.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { section, test } = require('../harness.js');

const SRC = path.join(__dirname, '..', '..', 'frontend', 'editor', 'js', 'node-search.js');

function loadRanker() {
    // Module top level only declares functions/consts (no DOM/state access),
    // so it can be evaluated after dropping imports and `export`.
    const src = fs.readFileSync(SRC, 'utf8')
        .replace(/^import .*$/gm, '')
        .replace(/^export /gm, '')
        + '\n;globalThis.rankSearchSuggestions = rankSearchSuggestions;';
    const ctx = vm.createContext({});
    vm.runInContext(src, ctx);
    return ctx.rankSearchSuggestions;
}

const plain = (v) => JSON.parse(JSON.stringify(v));

section('Node search suggestions (rankSearchSuggestions)');

const rank = loadRanker();
const entries = [
    { key: 'slug:dark_forest', title: 'The Dark Forest', slug: 'dark_forest', kind: 'node', focusId: 1 },
    { key: 'slug:forest', title: 'Forest', slug: 'forest', kind: 'node', focusId: 2 },
    { key: 'slug:rainforest', title: 'Rainforest Edge', slug: 'rainforest', kind: 'node', focusId: 3 },
    { key: 'slug:cave', title: 'A cave', slug: 'cave', kind: 'node', focusId: 4 },
    { key: 'slug:forest_gate', title: '', slug: 'forest_gate', kind: 'collapsed', group: 'Chapter 2', focusId: 9 },
    { key: 'group:chapter_2', title: 'Chapter 2', slug: 'chapter_2', kind: 'group', focusId: 9 }
];

test('1. empty / whitespace query returns nothing', () => {
    assert.deepStrictEqual(plain(rank(entries, '')), []);
    assert.deepStrictEqual(plain(rank(entries, '   ')), []);
});

test('2. ranks exact > prefix > word-start > substring, case-insensitive', () => {
    const keys = rank(entries, 'FOREST').map(e => e.key);
    assert.deepStrictEqual(plain(keys), ['slug:forest', 'slug:forest_gate', 'slug:dark_forest', 'slug:rainforest']);
});

test('3. matches by slug id as well as title, and reports where it matched', () => {
    const r = rank(entries, 'dark_f');
    assert.strictEqual(r.length, 1);
    assert.strictEqual(r[0].key, 'slug:dark_forest');
    assert.strictEqual(r[0].matchIn, 'slug');
    assert.strictEqual(rank(entries, 'edge')[0].matchIn, 'title');
    assert.strictEqual(rank(entries, 'cave')[0].matchIn, 'slug', 'exact slug beats word-start title');
});

test('4. loaded passages win ties over collapsed-group entries; groups are searchable', () => {
    const tie = [
        { key: 'a', title: 'Gate', slug: 'gate_a', kind: 'collapsed', focusId: 1 },
        { key: 'b', title: 'Gate', slug: 'gate_b', kind: 'node', focusId: 2 }
    ];
    assert.deepStrictEqual(plain(rank(tie, 'gate').map(e => e.key)), ['b', 'a']);
    assert.strictEqual(rank(entries, 'chapter')[0].key, 'group:chapter_2');
});

test('5. respects the result limit and ignores non-matches', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ key: 'k' + i, title: 'Room ' + i, slug: 'room_' + i, kind: 'node', focusId: i }));
    assert.strictEqual(rank(many, 'room').length, 8);
    assert.strictEqual(rank(many, 'room', 3).length, 3);
    assert.strictEqual(rank(many, 'zzz').length, 0);
});
