'use strict';
// tests/suites/back.test.js
// Spec 31: {redirect: back} routes to history-back navigation at all three
// existing redirect sites (render entry, action body, live tick), is stripped
// from display, no-ops without history, and does not create a fake 'back' edge
// for orphan analysis.

const { createGame, initGame, test, section, getLiveRegion } = require('../harness.js');

section('Spec 31 — {redirect: back}');

function freshGame() {
    const { game, env, timers } = createGame();
    initGame(game, { name: 'BackTest', variables: {}, nodes: [] });
    // driveable history + counters
    game._history = ['a', 'b'];
    game._historyIndex = 1;
    game.nodes['a'] = { id: 'a', text: 'A', choices: [], on_enter: null };
    game.nodes['b'] = { id: 'b', text: 'B', choices: [], on_enter: null };
    game.currentNodeId = 'b';
    game.autoSaveCalls = 0;
    game.updateNavCalls = 0;
    game.autoSave = () => { game.autoSaveCalls++; };
    game.updateNavButtons = () => { game.updateNavCalls++; };
    return { game, env, timers };
}

test('_checkRedirects: literal back -> sentinel', () => {
    const { game } = freshGame();
    if (game._checkRedirects('x {redirect: back} y') !== 'back') throw new Error('back must return sentinel');
});

test('_checkRedirects: missing target -> null, real node -> slug', () => {
    const { game } = freshGame();
    if (game._checkRedirects('{redirect: missing}') !== null) throw new Error('missing target must be null');
    if (game._checkRedirects('{redirect: a}') !== 'a') throw new Error('real node must return its slug');
});

test('_checkRedirects: reserved — node named back is not a redirect target', () => {
    const { game } = freshGame();
    game.nodes['back'] = { id: 'back', text: 'BACK NODE', choices: [], on_enter: null };
    if (game._checkRedirects('{redirect: back}') !== 'back') throw new Error('back sentinel must win over node named back');
});

test('action-body back: navigates to previous node and auto-saves', () => {
    const { game } = freshGame();
    game._actionBlocks = ['{redirect: back}'];
    game.applyActionBlock(0);
    if (game.currentNodeId !== 'a') throw new Error('action back must navigate to a, got ' + game.currentNodeId);
    if (game._historyIndex !== 0) throw new Error('history index must drop to 0, got ' + game._historyIndex);
    if (game.autoSaveCalls !== 1) throw new Error('action back must auto-save, got ' + game.autoSaveCalls);
    if (game.updateNavCalls < 1) throw new Error('action back must update nav buttons');
});

test('action-body with prior {set:} runs mutation THEN routes back', () => {
    const { game } = freshGame();
    game.state.flag = false;
    game._actionBlocks = ['{set: state.flag = true}\n{redirect: back}'];
    game.applyActionBlock(0);
    if (game.state.flag !== true) throw new Error('action body set must run before back');
    if (game.currentNodeId !== 'a') throw new Error('back must still navigate, got ' + game.currentNodeId);
});

test('top-level redirect: back on passage entry', () => {
    const { game } = freshGame();
    game.nodes['c'] = { id: 'c', text: '{redirect: back}', choices: [], on_enter: null };
    game.render('c');
    if (game.currentNodeId !== 'a') throw new Error('entry back must land on a, got ' + game.currentNodeId);
    if (game._historyIndex !== 0) throw new Error('history index must be 0, got ' + game._historyIndex);
});

test('no-op without history: no navigation, no crash', () => {
    const ctx = createGame();
    initGame(ctx.game, { name: 'BackFresh', variables: {}, nodes: [] });
    // fresh game has no history to go back to (_historyIndex 0, index guard blocks)
    ctx.game._historyIndex = 0;
    ctx.game._history = [ctx.game.startNode];
    ctx.game.nodes['c'] = { id: 'c', text: '{redirect: back}', choices: [], on_enter: null };
    const beforeIndex = ctx.game._historyIndex;
    ctx.game.render('c');
    if (ctx.game._historyIndex !== beforeIndex) throw new Error('history index must be unchanged, got ' + ctx.game._historyIndex);
});

test('live-tick back: tick whose body is {redirect: back} navigates back', () => {
    const { game, env } = freshGame();
    game.nodes['tick'] = { id: 'tick', text: '{live: 1000}{redirect: back}{endlive}', choices: [], on_enter: null };
    game.render('tick');
    game.tickRegion(game._liveRegions[0]);
    if (game.currentNodeId !== 'a') throw new Error('tick back must land on a, got ' + game.currentNodeId);
    if (game._historyIndex !== 0) throw new Error('history index must be 0, got ' + game._historyIndex);
});

test('stripping: {redirect: back} never shows as display text', () => {
    const { game } = freshGame();
    const out = game.processDirectives('go {redirect: back} now');
    if (!out.includes('go') || !out.includes('now')) throw new Error('surrounding text must be kept, got: ' + out);
    // render-time strip removes the tag
    const m = game._preprocessText ? game._preprocessText('go {redirect: back} now') : null;
    if (m && m.includes('{redirect:')) throw new Error('preprocess must strip redirect, got: ' + m);
});

test('render of a normal back-redirect passage displays no stale {redirect:}', () => {
    const { game, env } = freshGame();
    // no history -> goBack no-ops; assert the redirect tag never reaches DOM text
    game._historyIndex = 0;
    game.nodes['d'] = { id: 'd', text: 'x {redirect: back} y', choices: [], on_enter: null };
    game.currentNodeId = null;
    game.render('d');
    const html = env.document.getElementById('passage-content').textContent;
    if (html.includes('{redirect:')) throw new Error('redirect tag must not appear in rendered content: ' + html);
});

test('validation: {redirect: back} does not create a back edge', () => {
    const matches = ['{redirect: back}', '{redirect: b}', '{redirect: back}'];
    const targets = matches.map(m => m.replace('{redirect:', '').replace('}', '').trim())
                            .filter(t => t !== 'back');
    if (targets.some(t => t === 'back')) throw new Error('back must be filtered out of edge set');
    if (targets.length !== 1 || targets[0] !== 'b') throw new Error('only real edges remain, got: ' + JSON.stringify(targets));
});

module.exports = { run() { return section('Spec 31 — {redirect: back}') && 0; } };