'use strict';
// tests/suites/wait.test.js
// Part 1: wait sequences reveal once per entry; re-renders preserve the revealed state.

const { createGame, initGame, test, section, summary, waitSeqCount } = require('../harness.js');

section('Wait blocks and re-renders (Part 1)');

function freshGame() {
    const { game, env, timers } = createGame();
    initGame(game, { name: 'WaitTest', variables: {}, nodes: [] });
    return { game, env, timers };
}

let ctx;

ctx = freshGame();
ctx.game.nodes['w1'] = { id: 'w1', text: 'line\n{wait:1000,fade:300}revealed{endwait}\ntail', choices: [], on_enter: null };

test('fresh entry: wait emits .wait-sequence and schedules timers', () => {
    ctx.game.render('w1');
    const pc = ctx.env.document.getElementById('passage-content');
    const seqs = pc.querySelectorAll('.wait-sequence');
    assertWaitDivs(seqs);
    const intervals = ctx.timers._registry.intervals.size;
    const timeouts = ctx.timers._registry.timeouts.size;
    if (timeouts < 2) throw new Error('runWaitSequences should schedule timers, got ' + timeouts);
    void intervals;
});

test('same-passage re-render: no .wait-sequence, no timers, final state visible', () => {
    ctx.game.render('w1'); // re-render same node → _freshEntry false
    const pc = ctx.env.document.getElementById('passage-content');
    const seqs = pc.querySelectorAll('.wait-sequence');
    if (seqs.length !== 0) throw new Error('re-render must not emit wait divs, got ' + seqs.length);
    if (ctx.timers._registry.timeouts.size !== 0) throw new Error('re-render must not schedule wait timers');
    const text = pc.textContent;
    if (!text.includes('revealed')) throw new Error('wait content must stay visible, got: ' + text);
    if (!text.includes('tail')) throw new Error('tail content must be visible, got: ' + text);
});

test('wait block inside {init} renders nothing', () => {
    ctx.game.nodes['wi'] = { id: 'wi', text: '{init}{wait:1000}x{endwait}{endinit}after', choices: [], on_enter: null };
    ctx.game.render('wi');
    const pc = ctx.env.document.getElementById('passage-content');
    if (waitSeqCount(ctx.env.document) !== 0) throw new Error('wait in init must not render');
    if (!pc.textContent.includes('after')) throw new Error('post-init text must render');
});

test('commit:live textfield after a wait: typing re-render does not restart reveal', () => {
    ctx.game.nodes['tf'] = {
        id: 'tf',
        text: '{textfield: state.name, Your name, commit=live}\n{wait:1000}revealed{endwait}',
        choices: [], on_enter: null,
    };
    ctx.game.render('tf');
    const first = waitSeqCount(ctx.env.document);
    if (first !== 1) throw new Error('fresh render should animate the wait (1 div), got ' + first);
    ctx.game._reRender(); // simulate the commit:live re-render
    const after = waitSeqCount(ctx.env.document);
    if (after !== 0) throw new Error('re-render after typing must not emit wait divs, got ' + after);
    const pc = ctx.env.document.getElementById('passage-content');
    if (!pc.textContent.includes('revealed')) throw new Error('revealed content must stay visible');
});

test('mid-animation re-render jumps to completed visible state', () => {
    ctx.game.nodes['mid'] = { id: 'mid', text: 'a\n{wait:5000}fadein{endwait}\nz', choices: [], on_enter: null };
    ctx.game.render('mid');
    if (waitSeqCount(ctx.env.document) !== 1) throw new Error('fresh render must animate');
    ctx.game._reRender(); // "mid-animation"
    if (waitSeqCount(ctx.env.document) !== 0) throw new Error('must jump to completed state');
    const text = ctx.env.document.getElementById('passage-content').textContent;
    if (!text.includes('fadein') || !text.includes('z')) throw new Error('all content visible after jump: ' + text);
});

function assertWaitDivs(seqs) {
    if (seqs.length !== 1) throw new Error('expected 1 wait-sequence div, got ' + seqs.length);
    const d = seqs[0].dataset;
    if (d.duration !== '1000') throw new Error('data-duration expected 1000, got ' + d.duration);
    if (d.fade !== '300') throw new Error('data-fade expected 300, got ' + d.fade);
    if (!seqs[0].textContent.includes('revealed')) throw new Error('wait body content missing');
}

module.exports = { run() { return summary(); } };
