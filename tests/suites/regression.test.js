'use strict';
// tests/suites/regression.test.js
// Core engine regression — walker, renderContent, control flow, includes, actions.

const { createGame, initGame, test, section, summary } = require('../harness.js');

section('Core engine regression');

function freshGame() {
    const { game, env } = createGame();
    initGame(game, { name: 'Regression', variables: { gold: 10 }, nodes: [] });
    return { game, env };
}

const ctx = freshGame();
const g = ctx.game;

test('var interpolation (walker + renderContent two-pass)', () => {
    const out = g.renderContent(g.processDirectives('gold={var: state.gold}'), []);
    if (out !== '<p>gold=10</p>') throw new Error('got: ' + out);
});

test('set + if/else', () => {
    const out = g.processDirectives('{set: state.gold += 5}{if: state.gold > 12}rich{else}poor{endif}');
    if (out !== 'rich') throw new Error('got: ' + out);
    if (g.state.gold !== 15) throw new Error('gold should be 15');
});

test('if false branch', () => {
    const out = g.processDirectives('{if: state.gold < 0}neg{elseif: state.gold > 100}big{else}mid{endif}');
    if (out !== 'mid') throw new Error('got: ' + out);
});

test('unset removes var', () => {
    g.state.tmp = 1;
    const out = g.processDirectives('{unset: state.tmp}');
    if (out !== '') throw new Error('unset should emit nothing');
    if ('tmp' in g.state) throw new Error('tmp must be removed');
});

test('while loop sums', () => {
    const out = g.renderContent(g.processDirectives('{set: state.i = 0}{set: state.sum = 0}{while: state.i < 4}{set: state.sum += state.i}{set: state.i += 1}{endwhile}sum={var: state.sum}'), []);
    if (out !== '<p>sum=6</p>') throw new Error('got: ' + out);
});

test('include splice pulls node text', () => {
    g.nodes['util'] = { id: 'util', text: 'INCLUDED', choices: [], on_enter: null };
    const out = g.processDirectives('pre{include: util}post');
    if (out !== 'preINCLUDEDpost') throw new Error('got: ' + out);
});

test('action block emits placeholder link', () => {
    const out = g.processDirectives('{action: Click me} {set: state.gold = 0}{endaction}');
    if (!out.includes('nfaction_')) throw new Error('action should leave a placeholder, got: ' + JSON.stringify(out));
    if (g._actionBlocks.length !== 1) throw new Error('one action block');
});

test('random directive (renderContent pass)', () => {
    const out = g.renderContent('{random:5}', []);
    if (!/^<p>[0-5]<\/p>$/.test(out)) throw new Error('got: ' + out);
});

test('redirect survives walker for render() to handle', () => {
    const r = g.processDirectives('txt {redirect: other} end');
    if (r !== 'txt {redirect: other} end') throw new Error('got: ' + r);
    const stripped = g.processDirectives('txt {redirect: other} end').replace(/\{redirect:([^}]+)\}/g, '');
    if (stripped !== 'txt  end') throw new Error('got: ' + stripped);
});

test('include limit guards', () => {
    const r = g.processDirectives('{include: util}{include: util}{include: util}');
    if (r !== 'INCLUDEDINCLUDEDINCLUDED') throw new Error('got: ' + r);
});

test('renderContent produces HTML (smoke)', () => {
    const html = g.renderContent(g.processDirectives('hello {var: state.gold}'), []);
    if (html !== '<p>hello 15</p>') throw new Error('got: ' + html);
});

module.exports = { run() { return summary(); } };
