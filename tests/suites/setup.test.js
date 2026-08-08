'use strict';
// tests/suites/setup.test.js
// Setup boot semantics — the reserved `setup` node runs before the first render
// and must be able to call {fn:} catalogue helpers (fn registration happens
// before the setup node boots), and the setup scope is frozen afterwards.

const { createGame, initGame, test, section } = require('../harness.js');

section('Setup boot semantics');

const NODES = [
    {
        id: 'fncat', title: 'fncat', is_function: true, is_start: false, choices: [],
        text: [
            '{fn: greet, name}',
            '{return: "hello " + temp.name}',
            '{endfn}',
            '{fn: seedDefaults}',
            '{set: setup.booted = 1}',
            '{endfn}',
        ].join('\n'),
    },
    {
        id: 'setup', title: 'setup', is_function: false, is_start: false, choices: [],
        text: '{call: seedDefaults}\n{set: setup.message = call("greet", "world")}',
    },
];

function fresh() {
    const { game } = createGame();
    game.init({
        name: 'SetupBoot', variables: { gold: 0 },
        setup: { gold: 100 },
        nodes: NODES.slice(),
    });
    return { game };
}

test('setup node runs at boot and can call fn catalogue helpers', () => {
    const { game } = fresh();
    if (game.setup.booted !== 1) throw new Error('call from setup node failed: ' + JSON.stringify(game.setup.booted));
    if (game.setup.message !== 'hello world') throw new Error('fn call inside setup returned: ' + game.setup.message);
});

test('setup scope seeded from data.setup then overridable by setup node', () => {
    const { game } = fresh();
    if (game.setup.gold !== 100) throw new Error('setup.gold seed lost: ' + game.setup.gold);
});