'use strict';
// tests/suites/objects.test.js
// Spec 35: object-state variables (dict) — bracket-assignment/delete via {set:},
// bracket-chained {print:} rendering (state.clients[dayW].name), whole-object
// suppression, and legacy array/.size behavior.

const { createGame, initGame, test, section } = require('../harness.js');

section('Spec 35 — object-state variables & bracket-chained {print:}');

function freshGame(data) {
    const ctx = createGame();
    const base = { name: 'ObjectsTest', variables: {}, nodes: [] };
    initGame(ctx.game, Object.assign(base, data || {}));
    ctx.game.notify = () => {};
    return ctx;
}

function renderVar(game, src) {
    return game.renderContent(game.processDirectives(src), []);
}

test('{set:} bracket assignment + bracket-chained {print:} renders a field', () => {
    const { game } = freshGame();
    game.processDirectives('{set: state.clients = {}}');
    game.processDirectives('{set: state.clients[1] = {name:"Sandra", progress:0}}');
    const out = renderVar(game, '{print: state.clients[1].name}');
    if (out !== '<p>Sandra</p>') throw new Error('expected Sandra, got: ' + out);
    if (game.state.clients[1].progress !== 0) throw new Error('progress field lost');
});

test('bracket index from a state variable (state.dayW)', () => {
    const { game } = freshGame();
    game.processDirectives('{set: state.dayW = 2}');
    game.processDirectives('{set: state.clients = {}}');
    game.processDirectives('{set: state.clients[state.dayW] = {name:"Miriam", gender:2, progress:3}}');
    const out = renderVar(game, '{print: state.clients[state.dayW].name}');
    if (out !== '<p>Miriam</p>') throw new Error('expected Miriam, got: ' + out);
    if (game._evalBool('state.clients[state.dayW] !== undefined') !== true) throw new Error('has check must be true');
});

test('wrapped assignment seeds-or-keeps an entry', () => {
    const { game } = freshGame();
    game.processDirectives('{set: state.clients = {}}');
    game.processDirectives('{set: state.clients[1] = state.clients[1] || {name:"Sandra", progress:0}}');
    game.processDirectives('{set: state.clients[1].progress += 1}');
    if (game.state.clients[1].progress !== 1) throw new Error('progress mutate failed: ' + game.state.clients[1].progress);
});

test('{set: delete state.clients[1]} removes the entry', () => {
    const { game } = freshGame();
    game.processDirectives('{set: state.clients = {}}');
    game.processDirectives('{set: state.clients[1] = {name:"Sandra", progress:0}}');
    game.processDirectives('{set: delete state.clients[1]}');
    if (game._evalBool('state.clients[1] !== undefined') !== false) throw new Error('entry must be gone');
    const out = renderVar(game, '{print: state.clients[1].name}');
    if (!out.includes('{print: state.clients[1].name}')) throw new Error('deleted field must render macro text, got: ' + out);
});

test('whole-object {print:} renders macro text, never [object Object]', () => {
    const { game } = freshGame();
    game.processDirectives('{set: state.clients = {}}');
    game.processDirectives('{set: state.clients[1] = {name:"Sandra", progress:0}}');
    const out = renderVar(game, '{print: state.clients[1]}');
    if (out.includes('[object Object]')) throw new Error('must not render [object Object]: ' + out);
    if (!out.includes('{print: state.clients[1]}')) throw new Error('must keep macro text: ' + out);
});

test('missing parent / missing field renders macro text', () => {
    const { game } = freshGame();
    const noParent = renderVar(game, '{print: state.clients[1].name}');
    if (!noParent.includes('{print: state.clients[1].name}')) throw new Error('missing parent must render macro text: ' + noParent);
    game.processDirectives('{set: state.clients = {}}');
    game.processDirectives('{set: state.clients[1] = {name:"Sandra"}}');
    const noField = renderVar(game, '{print: state.clients[1].gender}');
    if (!noField.includes('{print: state.clients[1].gender}')) throw new Error('missing field must render macro text: ' + noField);
});

test('array {print:} still joins with ", "', () => {
    const { game } = freshGame();
    game.processDirectives('{set: state.list = [1,2,3]}');
    const out = renderVar(game, '{print: state.list}');
    if (out !== '<p>1, 2, 3</p>') throw new Error('expected 1, 2, 3, got: ' + out);
});

test('legacy .size on an array root still resolves', () => {
    const { game } = freshGame();
    game.processDirectives('{set: state.list = [1,2,3]}');
    const out = renderVar(game, '{print: state.list.size}');
    if (out !== '<p>3</p>') throw new Error('expected 3, got: ' + out);
});

test('seeded dict from project variables is accessible and object-typed', () => {
    const { game } = freshGame({
        variables: {
            clients: { 1: { name: 'Sandra', progress: 0 }, 2: { name: 'Miriam', progress: 3 } }
        }
    });
    if (typeof game.state.clients !== 'object' || game.state.clients === null || Array.isArray(game.state.clients)) {
        throw new Error('clients must be a plain object');
    }
    const out = renderVar(game, '{print: state.clients[2].name}');
    if (out !== '<p>Miriam</p>') throw new Error('seeded dict field failed: ' + out);
    const whole = renderVar(game, '{print: state.clients[2]}');
    if (!whole.includes('{print: state.clients[2]}')) throw new Error('seeded whole-object must render macro text: ' + whole);
});

module.exports = { run() { return section('Spec 35 — object-state variables & bracket-chained {print:}') && 0; } };
