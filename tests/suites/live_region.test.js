'use strict';
// tests/suites/live_region.test.js
// Part 2: {live: N}...{endlive} timed regions, render-only refresh, tick cascade.

const { createGame, initGame, test, section, summary, getLiveRegion } = require('../harness.js');

section('Live regions (Part 2)');

function freshGame() {
    const { game, env, timers } = createGame();
    initGame(game, { name: 'LiveTest', variables: { bomb: 5, hp: 1, maxhp: 5 }, nodes: [] });
    return { game, env, timers };
}

let ctx;

test('walker: numeric {live:} emits placeholder token and stores region', () => {
    ctx = freshGame();
    const out = ctx.game.processDirectives('pre {live: 1000}{var: state.bomb}{endlive} post');
    if (!out.includes('\u0000nflive_0\u0000')) throw new Error('expected nflive placeholder token, got: ' + JSON.stringify(out));
    const html = ctx.game.renderContent(out, []);
    if (!html.includes('nf-live') || !html.includes('data-live-region="0"')) throw new Error('renderContent must emit nf-live div, got: ' + html);
    if (ctx.game._liveRegions.length !== 1) throw new Error('region must be stored');
    const r = ctx.game._liveRegions[0];
    if (r.interval !== 1000) throw new Error('interval 1000, got ' + r.interval);
    if (!r.body.includes('{var: state.bomb}')) throw new Error('body must be stored verbatim');
});

test('interval clamped to 50ms floor', () => {
    ctx.game.processDirectives('{live: 10}x{endlive}');
    const r = ctx.game._liveRegions[ctx.game._liveRegions.length - 1];
    if (r.interval !== 50) throw new Error('interval must clamp to 50, got ' + r.interval);
});

test('unclosed {live: renders literally', () => {
    ctx = freshGame();
    const out = ctx.game.processDirectives('text {live: 500 body no end');
    if (!out.includes('{live:')) throw new Error('unclosed must stay literal: ' + out);
});

test('non-numeric {live: fast} renders literally', () => {
    ctx = freshGame();
    const out = ctx.game.processDirectives('a {live: fast}xyz{endlive} b');
    if (!out.includes('{live: fast}') || !out.includes('{endlive}')) throw new Error('non-numeric must stay literal: ' + out);
});

test('case-insensitive {LIVE:} tag', () => {
    ctx = freshGame();
    ctx.game.processDirectives('{LIVE: 500}x{ENDLIVE}');
    if (ctx.game._liveRegions.length !== 1) throw new Error('case-insensitive live must register');
});

test('render() fills region display from body without executing its set', () => {
    ctx = freshGame();
    ctx.game.nodes['r1'] = {
        id: 'r1',
        text: '{live: 1000}{set: state.bomb += 1}[{var: state.bomb}]{endlive}',
        choices: [], on_enter: null,
    };
    ctx.game.render('r1');
    // end-of-render refresh is display-only: region set must NOT run
    if (ctx.game.state.bomb !== 5) throw new Error('region body set must not run at render, got bomb=' + ctx.game.state.bomb);
    const el = getLiveRegion(ctx.env.document, 0);
    if (!el) throw new Error('live region element must exist');
    if (!el.textContent.includes('5')) throw new Error('region display should show current bomb, got: ' + el.textContent);
});

test('passage set + render updates region display without re-incrementing', () => {
    ctx.game.nodes['r1'].text = '{live: 1000}{set: state.bomb += 1}[{var: state.bomb}]{endlive}';
    ctx.game.state.bomb = 7;
    ctx.game.render('r1');
    if (ctx.game.state.bomb !== 7) throw new Error('passage render must not run region set');
    const el = getLiveRegion(ctx.env.document, 0);
    if (!el.textContent.includes('7')) throw new Error('region should display 7, got: ' + el.textContent);
});

test('tickRegion executes body set exactly once and cascades re-render', () => {
    ctx = freshGame();
    ctx.game.nodes['tick'] = {
        id: 'tick',
        text: '{live: 200}{set: state.bomb -= 1}count {var: state.bomb}{endlive}',
        choices: [], on_enter: null,
    };
    ctx.game.render('tick');
    const before = ctx.game.state.bomb; // 5
    let renderCalls = 0;
    const origRender = ctx.game.render.bind(ctx.game);
    ctx.game.render = (nodeId) => { renderCalls++; return origRender(nodeId); };
    ctx.game.tickRegion(ctx.game._liveRegions[0]);
    if (ctx.game.state.bomb !== before - 1) throw new Error('tick must run set exactly once, got ' + ctx.game.state.bomb);
    if (renderCalls !== 1) throw new Error('tick must trigger one re-render, got ' + renderCalls);
    ctx.game.render = origRender;
});

test('region display updates after tick re-render', () => {
    const el = getLiveRegion(ctx.env.document, 0);
    if (!el.textContent.includes(String(ctx.game.state.bomb))) {
        throw new Error('region display must reflect mutated state, got: ' + el.textContent);
    }
});

test('{redirect:} in region body navigates on first tick', () => {
    ctx = freshGame();
    ctx.game.nodes['bomb'] = { id: 'bomb', text: 'tick me {live: 1000}{if: state.bomb <= 0}{redirect: boom}{endif}{endlive}', choices: [], on_enter: null };
    ctx.game.nodes['boom'] = { id: 'boom', text: 'BOOM', choices: [], on_enter: null };
    ctx.game.state.bomb = 0;
    ctx.game.render('bomb');
    ctx.game.tickRegion(ctx.game._liveRegions[0]);
    if (ctx.game.currentNodeId !== 'boom') throw new Error('tick redirect must navigate, got ' + ctx.game.currentNodeId);
    if (!ctx.env.document.getElementById('passage-content').textContent.includes('BOOM')) {
        throw new Error('redirected passage must render');
    }
});

test('tick skipped when document.hidden', () => {
    ctx = freshGame();
    ctx.game.nodes['h'] = { id: 'h', text: '{live: 100}{set: state.bomb += 1}{endlive}', choices: [], on_enter: null };
    ctx.game.render('h');
    const before = ctx.game.state.bomb;
    ctx.env.document.hidden = true;
    ctx.game.tickRegion(ctx.game._liveRegions[0]);
    ctx.env.document.hidden = false;
    if (ctx.game.state.bomb !== before) throw new Error('hidden tick must not run set');
});

test('render() registers one interval per region', () => {
    ctx = freshGame();
    ctx.game.nodes['iv'] = { id: 'iv', text: '{live: 300}a{endlive}\n{live: 700}b{endlive}', choices: [], on_enter: null };
    ctx.game.render('iv');
    const intervals = ctx.timers._registry.intervals;
    if (intervals.size !== 2) throw new Error('expected 2 intervals, got ' + intervals.size);
    const ms = [...intervals.values()].map(i => i.ms).sort((a, b) => a - b);
    if (ms[0] !== 300 || ms[1] !== 700) throw new Error('interval periods wrong: ' + ms);
});

test('navigation clears live timers', () => {
    ctx = freshGame();
    ctx.game.nodes['a1'] = { id: 'a1', text: '{live: 300}a{endlive}', choices: [], on_enter: null };
    ctx.game.nodes['a2'] = { id: 'a2', text: 'plain', choices: [], on_enter: null };
    ctx.game.render('a1');
    if (ctx.timers._registry.intervals.size !== 1) throw new Error('region must register an interval');
    ctx.game.render('a2'); // navigate away → render() clears intervals, no new ones
    if (ctx.timers._registry.intervals.size !== 0) throw new Error('navigation must clear live timers');
});

test('newGame() clears live timers', () => {
    ctx = freshGame();
    ctx.game.nodes['ng'] = { id: 'ng', text: '{live: 300}a{endlive}', choices: [], on_enter: null };
    ctx.game.render('ng');
    if (ctx.timers._registry.intervals.size !== 1) throw new Error('precondition: interval registered');
    ctx.game.newGame();
    if (ctx.timers._registry.intervals.size !== 0) throw new Error('newGame must clear live timers');
});

test('region in side_panel persists and re-renders across passage navigation', () => {
    ctx = freshGame();
    ctx.game.nodes['side_panel'] = {
        id: 'side_panel',
        text: 'HP {var: state.hp}/{var: state.maxhp} {live: 500}{set: state.hp = Math.min(state.hp + 1, state.maxhp)}HP {var: state.hp}{endlive}',
        choices: [], on_enter: null,
    };
    ctx.game.nodes['p1'] = { id: 'p1', text: 'room one', choices: [], on_enter: null };
    ctx.game.nodes['p2'] = { id: 'p2', text: 'room two', choices: [], on_enter: null };
    ctx.game.sidePanelNodeId = 'side_panel';
    ctx.game.render('p1');
    const sp = ctx.env.document.getElementById('side-panel-content');
    if (!sp.textContent.includes('HP 1/5')) throw new Error('side panel must show hp, got: ' + sp.textContent);
    ctx.game.render('p2');
    if (ctx.timers._registry.intervals.size !== 1) throw new Error('side panel region must re-register across navigation');
    const sp2 = ctx.env.document.getElementById('side-panel-content');
    if (!sp2.textContent.includes('HP 1/5')) throw new Error('side panel must persist across navigation: ' + sp2.textContent);
});

test('render-only mode consumes inert directives with one warn each', () => {
    ctx = freshGame();
    const warns = [];
    const origWarn = console.warn;
    console.warn = (msg) => warns.push(String(msg));
    ctx.game._renderOnlyWarned.clear();
    ctx.game._renderOnly = true;
    let out;
    try {
        out = ctx.game._processDirectives(
            '{set: state.bomb = 99}{audio: /x.mp3}{include: none}txt{redirect: nowhere}{wait:500}f{endwait}{action: A}{endaction}{textfield: state.name}{for: state.i = 0; state.i < 2; state.i += 1}{set: state.i = 9}{endfor}VIS',
            false
        ).text;
    } finally {
        ctx.game._renderOnly = false;
    }
    console.warn = origWarn;
    if (ctx.game.state.bomb === 99) throw new Error('render-only must not execute set');
    if (warns.length < 8) throw new Error('expected warnings per kind, got ' + warns.length + ': ' + warns.join('|'));
    if (!out.includes('VIS')) throw new Error('render-only must keep text');
    if (!out.includes('txt')) throw new Error('render-only must keep passage text');
});

module.exports = { run() { return summary(); } };
