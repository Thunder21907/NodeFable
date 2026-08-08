'use strict';
// tests/suites/helpers.test.js
// Spec 34: frozen `helper` scope (random/either/clone/clamp), the Array/String
// prototype extensions, and the brace-aware {set:} scanner (_findSetEnd).

const { createGame, initGame, test, section } = require('../harness.js');

section('Spec 34 — helper + prototypes + brace-aware set');

function freshGame(data) {
    const ctx = createGame();
    const base = { name: 'HelperTest', variables: {}, nodes: [] };
    initGame(ctx.game, Object.assign(base, data || {}));
    ctx.game.notify = () => {};
    return ctx;
}

test('scope wiring: helper in {if:}, {set:} RHS, {print:}-adjacent', () => {
    const { game } = freshGame();
    if (game.processDirectives('{if: helper.random(1, 1000) > 0}yes{endif}') !== 'yes') throw new Error('helper in condition failed');
    game.processDirectives('{set: state.c = helper.clamp(50, 0, 10)}');
    if (game.state.c !== 10) throw new Error('clamp via set failed: ' + game.state.c);
    game.processDirectives('{set: state.d = helper.random(5, 5)}');
    if (game.state.d !== 5) throw new Error('random via set failed: ' + game.state.d);
});

test('helper.random: inclusive bounds + 1-arg form + 0-arg throws', () => {
    const { game } = freshGame();
    for (let i = 0; i < 50; i++) {
        const r = game.helper.random(3, 7);
        if (r < 3 || r > 7 || !Number.isInteger(r)) throw new Error('random(3,7) out of bounds: ' + r);
    }
    for (let i = 0; i < 50; i++) {
        const r = game.helper.random(5);
        if (r < 0 || r > 5 || !Number.isInteger(r)) throw new Error('random(5) out of bounds: ' + r);
    }
    let threw = false;
    try { game.helper.random(); } catch (e) { threw = e && e.name === 'TypeError'; }
    if (!threw) throw new Error('random() must throw');
});

test('helper.either: returns one of args; 0-arg -> undefined; array flattens', () => {
    const { game } = freshGame();
    const seen = new Set();
    for (let i = 0; i < 40; i++) seen.add(game.helper.either('a', 'b', 'c'));
    if (!seen.has('a') || !seen.has('b') || !seen.has('c')) throw new Error('either must pick from args');
    if (game.helper.either() !== undefined) throw new Error('either() must be undefined');
    const flat = game.helper.either(['x', 'y']);
    if (flat !== 'x' && flat !== 'y') throw new Error('either must flatten array arg, got ' + flat);
});

test('helper.clone: deep clone of nested arrays/objects; distinct identity', () => {
    const { game } = freshGame();
    const src = { a: [1, 2], b: { c: true }, d: 'x' };
    const c = game.helper.clone(src);
    if (JSON.stringify(c) !== JSON.stringify(src)) throw new Error('clone content mismatch');
    if (c === src) throw new Error('clone must be a distinct object');
    if (c.a === src.a || c.b === src.b) throw new Error('clone must deep-copy nested values');
    if (game.helper.clone(null) !== null) throw new Error('clone(null) must be null');
    if (game.helper.clone(7) !== 7) throw new Error('clone(7) must be 7');
});

test('helper.clone: Date/Map/Set/RegExp survive', () => {
    const { game } = freshGame();
    const d = new Date(12345);
    const cd = game.helper.clone(d);
    if (Object.prototype.toString.call(cd) !== '[object Date]' || cd.getTime() !== 12345) throw new Error('Date clone failed');
    const m = new Map([['k', { v: 1 }]]);
    const cm = game.helper.clone(m);
    if (Object.prototype.toString.call(cm) !== '[object Map]' || JSON.stringify(cm.get('k')) !== '{"v":1}') throw new Error('Map clone failed');
    const s = new Set([1, 2]);
    const cs = game.helper.clone(s);
    if (Object.prototype.toString.call(cs) !== '[object Set]' || cs.size !== 2) throw new Error('Set clone failed');
    const r = new RegExp('ab', 'g');
    const cr = game.helper.clone(r);
    if (Object.prototype.toString.call(cr) !== '[object RegExp]' || cr.source !== 'ab') throw new Error('RegExp clone failed');
});

test('helper.clamp: lower/upper/inside', () => {
    const { game } = freshGame();
    if (game.helper.clamp(-5, 0, 10) !== 0) throw new Error('clamp lower');
    if (game.helper.clamp(50, 0, 10) !== 10) throw new Error('clamp upper');
    if (game.helper.clamp(5, 0, 10) !== 5) throw new Error('clamp inside');
});

test('Array methods: first/last/count/countWith/contains', () => {
    const { game } = freshGame();
    const a = [1, 2, 2, 3];
    if (a.first() !== 1) throw new Error('first');
    if (a.last() !== 3) throw new Error('last');
    if (a.count(2) !== 2) throw new Error('count');
    if (a.countWith(x => x % 2 === 0) !== 2) throw new Error('countWith');
    if (!a.contains(2)) throw new Error('contains');
    if ([].first() !== undefined) throw new Error('empty first must be undefined');
    if ([].last() !== undefined) throw new Error('empty last must be undefined');
});

test('Array methods: delete/deleteAll/deleteAt/deleteFirst/deleteLast/deleteWith', () => {
    const { game } = freshGame();
    const a = [1, 2, 2, 3, 4, 5];
    const removed = a.deleteAll(2, 5);
    if (JSON.stringify(removed) !== '[2,2,5]') throw new Error('deleteAll removed wrong: ' + JSON.stringify(removed));
    if (JSON.stringify(a) !== '[1,3,4]') throw new Error('deleteAll result wrong: ' + JSON.stringify(a));
    const b = [1, 2, 3];
    b.deleteAt(1);
    if (JSON.stringify(b) !== '[1,3]') throw new Error('deleteAt');
    const c = [1, 2, 1];
    c.deleteFirst(1);
    if (JSON.stringify(c) !== '[2,1]') throw new Error('deleteFirst');
    const d = [1, 2, 1];
    d.deleteLast(1);
    if (JSON.stringify(d) !== '[1,2]') throw new Error('deleteLast');
    const e = [1, 2, 3, 4];
    const er = e.deleteWith(x => x > 2);
    if (JSON.stringify(er) !== '[3,4]' || JSON.stringify(e) !== '[1,2]') throw new Error('deleteWith');
});

test('Array methods: shuffle/toShuffled/random/randomMany/pluck/pluckMany', () => {
    const { game } = freshGame();
    const a = [1, 2, 3, 4, 5];
    const sh = a.shuffle();
    if (sh !== a) throw new Error('shuffle must return this');
    if (a.slice().sort().join() !== '1,2,3,4,5') throw new Error('shuffle must be a permutation');
    const ts = [1, 2, 3].toShuffled();
    if (ts.slice().sort().join() !== '1,2,3') throw new Error('toShuffled must be a permutation');
    if (!a.includes(a.random())) throw new Error('random element must be from array');
    const rm = a.randomMany(3);
    if (rm.length !== 3 || new Set(rm).size !== 3) throw new Error('randomMany distinct');
    const b = [1, 2, 3, 4];
    const p = b.pluck();
    if (![1, 2, 3, 4].includes(p) || b.length !== 3) throw new Error('pluck mutates');
    const c = [1, 2, 3, 4];
    const pm = c.pluckMany(2);
    if (pm.length !== 2 || c.length !== 2) throw new Error('pluckMany');
});

test('Array methods: concatUnique/toUnique/includesAll/includesAny/pushUnique/unshiftUnique/append/prepend', () => {
    const { game } = freshGame();
    const cu = [1, 2].concatUnique([2, 3], [3, 4]);
    if (JSON.stringify(cu) !== '[1,2,3,4]') throw new Error('concatUnique');
    if (JSON.stringify([1, 1, 2].toUnique()) !== '[1,2]') throw new Error('toUnique');
    if (![1, 2, 3].includesAll(1, 3)) throw new Error('includesAll');
    if (![1, 2, 3].includesAny(9, 2)) throw new Error('includesAny');
    const a = [];
    if (a.pushUnique(1, 1, 2) !== 2 || JSON.stringify(a) !== '[1,2]') throw new Error('pushUnique');
    const b = [1];
    if (b.unshiftUnique(2, 2) !== 2 || JSON.stringify(b) !== '[2,1]') throw new Error('unshiftUnique');
    const c = [1];
    if (c.append(2, [3]) !== c || JSON.stringify(c) !== '[1,2,3]') throw new Error('append');
    const d = [1, 2];
    if (d.prepend([0]) !== d || JSON.stringify(d) !== '[0,1,2]') throw new Error('prepend');
});

test('String methods: toUpperFirst/first/last/count/contains/splice/splitOrEmpty', () => {
    const { game } = freshGame();
    if ('hello'.toUpperFirst() !== 'Hello') throw new Error('toUpperFirst');
    if ('hello'.first() !== 'h') throw new Error('str first');
    if ('hello'.last() !== 'o') throw new Error('str last');
    if ('ababa'.count('ab') !== 2) throw new Error('str count');
    if (!'hello'.contains('ell')) throw new Error('str contains');
    if ('abcdef'.splice(2, 2, 'XY') !== 'abXYef') throw new Error('str splice');
    const so = 'x,y'.splitOrEmpty(',');
    if (JSON.stringify(so) !== '["x","y"]') throw new Error('splitOrEmpty non-empty');
    if (JSON.stringify(''.splitOrEmpty(',')) !== '[]') throw new Error('splitOrEmpty empty must be []');
});

test('brace-aware {set:}: helper.clone({...}) object literals parse', () => {
    const { game } = freshGame();
    game.processDirectives('{set: state.obj = helper.clone({ a: 1, b: [2, 3] })}');
    if (JSON.stringify(game.state.obj) !== '{"a":1,"b":[2,3]}') throw new Error('object literal set failed: ' + JSON.stringify(game.state.obj));
    game.processDirectives('{set: state.arr = [{ n: "Skirt", p: 80 }]}');
    if (game.state.arr[0].n !== 'Skirt' || game.state.arr[0].p !== 80) throw new Error('array-of-objects set failed');
    game.processDirectives('{set: state.s = "a}b"}');
    if (game.state.s !== 'a}b') throw new Error('brace inside string must survive: ' + game.state.s);
});

test('brace-aware {set:}: setup-node object catalogs parse during boot', () => {
    const { game } = freshGame({
        nodes: [{ id: 'setup', title: 'Setup', text: '{set: setup.clothes = [{ name: "Skirt", price: 80 }]}', choices: [], is_utility: true }]
    });
    if (game.setup.clothes[0].name !== 'Skirt' || game.setup.clothes[0].price !== 80) {
        throw new Error('setup object catalog failed: ' + JSON.stringify(game.setup.clothes));
    }
});

test('read-only helper: reassignment silently no-ops (sloppy eval)', () => {
    const { game } = freshGame();
    game._evalMutation('helper.random = "x"');
    if (typeof game.helper.random !== 'function') throw new Error('helper must remain read-only');
});

test('print: helpers are an expression scope', () => {
    const { game } = freshGame();
    const out = game.renderContent(game.processDirectives('{print: helper.random(1, 2)}'), []);
    if (!/^<p>[12]<\/p>$/.test(out)) throw new Error('helper must evaluate in print, got: ' + out);
});

module.exports = { run() { return section('Spec 34 — helper + prototypes + brace-aware set') && 0; } };
