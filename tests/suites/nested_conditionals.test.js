'use strict';
// tests/suites/nested_conditionals.test.js
// Nested {if:}/{elseif:}/{else}/{endif} blocks — depth tracking across adjacent
// tags and branch selection inside nested bodies.

const { createGame, initGame, test, section } = require('../harness.js');

section('Nested conditionals');

function fresh() {
    const { game } = createGame();
    initGame(game, { name: 'NestedCond', variables: { a: 5, b: 3, c: 7 }, nodes: [] });
    return game;
}

test('nested true/true (adjacent ifs)', () => {
    const g = fresh();
    const out = g.processDirectives('{if: state.a > 1}{if: state.b > 1}Q{endif}{endif}');
    if (out !== 'Q') throw new Error('got: ' + out);
});

test('nested true/false leaves only outer text', () => {
    const g = fresh();
    const out = g.processDirectives('{if: state.a > 1}P{if: state.b > 100}Q{endif}R{endif}');
    if (out !== 'PR') throw new Error('got: ' + out);
});

test('triple nesting all true / middle false', () => {
    const g = fresh();
    const tt = g.processDirectives('{if: state.a > 1}{if: state.b > 1}{if: state.c > 1}deep{endif}{endif}{endif}');
    if (tt !== 'deep') throw new Error('triple true got: ' + tt);
    const mf = g.processDirectives('{if: state.a > 1}A{if: state.b > 100}B{if: state.c > 1}C{endif}D{endif}E{endif}');
    if (mf !== 'AE') throw new Error('middle false got: ' + mf);
});

test('nested else inside inner block', () => {
    const g = fresh();
    const out = g.processDirectives('{if: state.a > 1}P{if: state.b > 100}Q{else}Qe{endif}R{endif}');
    if (out !== 'PQeR') throw new Error('got: ' + out);
});

test('outer else + nested inner', () => {
    const g = fresh();
    const out = g.processDirectives('{if: state.a > 100}X{if: state.b > 1}Y{endif}Z{else}W{endif}');
    if (out !== 'W') throw new Error('got: ' + out);
});

test('nested elseif chain inside an outer if', () => {
    const g = fresh();
    const out = g.processDirectives('{if: state.a > 100}X{elseif: state.a > 1}Y{if: state.b > 1}Z{endif}W{endif}');
    if (out !== 'YZW') throw new Error('got: ' + out);
});

test('nested conditional with mutation inside inner branch', () => {
    const g = fresh();
    const out = g.processDirectives('{if: state.a > 1}A{if: state.b > 1}{set: state.c += 5}{endif}{endif}');
    if (out !== 'A') throw new Error('got: ' + out);
    if (g.state.c !== 12) throw new Error('c should be 12, got ' + g.state.c);
});

test('empty no-text nested conditional', () => {
    const g = fresh();
    const out = g.processDirectives('{if: state.a > 1}{if: state.b > 1}{if: state.c > 5}X{endif}{endif}{endif}');
    if (out !== 'X') throw new Error('got: ' + out);
});