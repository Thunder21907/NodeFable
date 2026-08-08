'use strict';
// tests/suites/fn_nodes.test.js
// Spec 37: Function Nodes — {fn:} catalogues, {return:}, {call:} / inline
// call() expression, isolated temp scope, shared state, recursion guard.

const { createGame, initGame, test, section } = require('../harness.js');

section('Spec 37 — function nodes ({fn:} / {return:})');

function freshGame(data) {
    const ctx = createGame();
    const base = { name: 'FnTest', variables: {}, nodes: [] };
    initGame(ctx.game, Object.assign(base, data || {}));
    ctx.game.notify = () => {};
    return ctx;
}

const CATALOGUE = [
    { id: 'fncat', title: 'FnCat', text: [
        '{fn: double, x}',
        '{return: temp.x * 2}',
        '{endfn}',
        '{fn: addrep, amt}',
        '{set: state.reputation = state.reputation + temp.amt}',
        '{endfn}',
        '{fn: greet, name, style}',
        '{return: "[" + temp.style + "] " + temp.name}',
        '{endfn}',
        '{fn: add, a, b}',
        '{return: temp.a + temp.b}',
        '{endfn}',
    ].join('\n'), choices: [], is_function: true }
];

test('global name-index across catalogue nodes', () => {
    const { game } = freshGame({ nodes: CATALOGUE.slice() });
    if (!game._functions['double']) throw new Error('double not registered');
    if (!game._functions['addrep']) throw new Error('addrep not registered');
    if (!game._functions['greet']) throw new Error('greet not registered');
    if (game._functions['double'].params.join() !== 'x') throw new Error('params wrong: ' + game._functions['double'].params.join());
});

test('{call: } interpolates return', () => {
    const { game } = freshGame({ nodes: CATALOGUE.slice() });
    const n = game.renderContent(game.processDirectives('{call: double, 21}'), []);
    if (n !== '<p>42</p>') throw new Error('expected <p>42</p>, got: ' + n);
});

test('{call: greet} with string arg built from state', () => {
    const { game } = freshGame({ nodes: CATALOGUE.slice(), variables: { playerName: 'Rex' } });
    const n = game.renderContent(game.processDirectives('{call: greet, state.playerName, "Stern"}'), []);
    if (n !== '<p>[Stern] Rex</p>') throw new Error('got: ' + n);
});

test('inline call() inside {print:} and {if:}', () => {
    const { game } = freshGame({ nodes: CATALOGUE.slice(), variables: { x: 6 } });
    const out = game.renderContent(game.processDirectives('{print: call("double", state.x)}'), []);
    if (out !== '<p>12</p>') throw new Error('print call failed: ' + out);
    game.processDirectives('{set: state.y = call("add", 10, 5)}');
    if (game.state.y !== 15) throw new Error('set call failed: ' + game.state.y);
    if (game.processDirectives('{if: call("double", 10) > 5}big{endif}') !== 'big') throw new Error('if call failed');
});

test('function mutates shared state, temp isolated', () => {
    const { game } = freshGame({ nodes: [
        { id: 'fncat', title: 'fn', text: '{fn: bump, v}\n{set: state.c = state.c + temp.v}\n{endfn}', choices: [], is_function: true }
    ]});
    game.processDirectives('{set: state.c = 0}');
    game.processDirectives('{call: bump, 5}');
    game.processDirectives('{call: bump, 3}');
    if (game.state.c !== 8) throw new Error('state.c expected 8, got ' + game.state.c);
    if (JSON.stringify(game.temp) !== '{}') throw new Error('caller temp must be untouched: ' + JSON.stringify(game.temp));
});

test('{return:} early-exit discards body text', () => {
    const { game } = freshGame({ nodes: [
        { id: 'fncat', title: 'fn', text: '{fn: go, v}\nJUNK {return: temp.v * 2} MOREJUNK\n{endfn}', choices: [], is_function: true }
    ]});
    const out = game.renderContent(game.processDirectives('{call: go, 4}'), []);
    if (out !== '<p>8</p>') throw new Error('body text leaked: ' + out);
});

test('undefined return renders nothing for {call:}', () => {
    const { game } = freshGame({ nodes: [
        { id: 'fncat', title: 'fn', text: '{fn: voidfn}\njunk\n{endfn}', choices: [], is_function: true }
    ]});
    const out = game.renderContent(game.processDirectives('A{call: voidfn}B'), []);
    if (out !== '<p>AB</p>') throw new Error('undefined return must render nothing: ' + out);
});

test('unknown function renders nothing with a warn', () => {
    const { game } = freshGame();
    const out = game.renderContent(game.processDirectives('{call: missingFn}'), []);
    if (out !== '<p></p>') throw new Error('unknown fn should render nothing, got: ' + out);
});

test('recursion guard notifies and terminates', () => {
    const { game } = freshGame({ nodes: [
        { id: 'fncat', title: 'fn', text: '{fn: looper}\n{call: looper}\n{endfn}', choices: [], is_function: true }
    ]});
    game.notify = (msg) => { if (msg && msg.indexOf('recursion') > -1) game._recursionNotified = true; };
    const out = game.processDirectives('{call: looper}');
    if (!game._recursionNotified) throw new Error('recursion notification not fired');
});

test('nested calls (call inside call)', () => {
    const { game } = freshGame({ nodes: CATALOGUE.slice() });
    // add: a + b; double twice.
    const out = game.renderContent(game.processDirectives('{call: double, call("double", 5)}'), []);
    if (out !== '<p>20</p>') throw new Error('nested call failed: ' + out);
});

test('function node excluded from navigation (not in main node list)', () => {
    // startNode must not be the function node when it is the only non-utility node.
    const ctx = createGame();
    initGame(ctx.game, { name: 'X', variables: {}, nodes: [
        { id: 'fncat', title: 'fn', text: '{fn: a}\n{endfn}', choices: [], is_function: true },
        { id: 'real', title: 'real', text: 'hi', choices: [] }
    ]});
    if (ctx.game.startNode !== 'real') throw new Error('startNode should be real, got: ' + ctx.game.startNode);
});

module.exports = { run() { return section('Spec 37 — function nodes ({fn:} / {return:})') && 0; } };