'use strict';
// tests/suites/tables.test.js
// Spec 32: {table:}/{tr:}/{td:}/{bar:} display-only tags rendered in
// renderContent(), passed through untouched by the walker, live in live regions.

const { createGame, initGame, test, section } = require('../harness.js');

section('Spec 32 — tables & stat bars');

function freshGame() {
    const { game, env, timers } = createGame();
    initGame(game, { name: 'TablesTest', variables: { hp: 70 }, nodes: [] });
    return { game, env, timers };
}

test('emission: table/tr/td tags expand to HTML', () => {
    const g = freshGame().game;
    const html = g.renderContent('{table:}{tr:}{td:}A{endtd}{td:}B{endtd}{endtr}{endtable}', []);
    if (!html.includes('<table class="nf-table">')) throw new Error('missing table open: ' + html);
    if (!html.includes('</table>')) throw new Error('missing table close');
    if (!html.includes('<tr>') || !html.includes('</tr>')) throw new Error('missing tr');
    if (!html.includes('<td class="nf-cell">A</td>')) throw new Error('missing cell A: ' + html);
    if (!html.includes('<td class="nf-cell">B</td>')) throw new Error('missing cell B: ' + html);
});

test('newline hygiene: inter-tag newlines are consumed, no <br> inside region', () => {
    const g = freshGame().game;
    const src = '{table:}\n{tr:}\n{td:}Name{endtd}\n{td:}Val{endtd}\n{endtr}\n{endtable}';
    const html = g.renderContent(src, []);
    const inner = html.slice(html.indexOf('<table'), html.indexOf('</table>'));
    if (inner.includes('<br')) throw new Error('stray <br> inside table region: ' + inner);
    if (!inner.includes('</td><td class="nf-cell">')) throw new Error('adjacent cells must join without <br>: ' + inner);
});

test('params: table + td options map to classes, style, colspan', () => {
    const g = freshGame().game;
    const html = g.renderContent('{table: w=600, center, border=1, cellpadding=4, cellspacing=2}{tr:}{td: w=152, align=center, valign=top, colspan=2}X{endtd}{endtr}{endtable}', []);
    const tblStart = html.indexOf('<table');
    const tbl = html.slice(tblStart, html.indexOf('>', tblStart) + 1);
    if (!tbl.includes('class="nf-table nf-center nf-bordered"')) throw new Error('table classes wrong: ' + tbl);
    if (!tbl.includes('width:600px')) throw new Error('table width missing');
    if (!tbl.includes('border-spacing:2px')) throw new Error('cellspacing missing');
    if (!tbl.includes('--nf-pad:4px')) throw new Error('cellpadding missing');
    const tdStart = html.indexOf('<td');
    const td = html.slice(tdStart, html.indexOf('>', tdStart) + 1);
    if (!td.includes('class="nf-cell"')) throw new Error('td class wrong: ' + td);
    if (!td.includes('width:152px')) throw new Error('td width missing');
    if (!td.includes('text-align:center')) throw new Error('td align missing');
    if (!td.includes('vertical-align:top')) throw new Error('td valign missing');
    if (!td.includes('colspan="2"')) throw new Error('td colspan missing');
});

test('tr align + class params', () => {
    const g = freshGame().game;
    const html = g.renderContent('{table:}{tr: align=center, class=wide}{td:}x{endtd}{endtr}{endtable}', []);
    const tr = html.slice(html.indexOf('<tr'), html.indexOf('/td>') - 1).split('>')[0] + '>';
    if (!tr.includes('style="text-align:center"')) throw new Error('tr align missing: ' + tr);
    if (!tr.includes('class="wide"')) throw new Error('tr class missing: ' + tr);
});

test('balance / literal degradation', () => {
    const g = freshGame().game;
    const unclosed = g.renderContent('{td:}unclosed', []);
    if (!unclosed.includes('<td class="nf-cell">unclosed')) throw new Error('unclosed td must still emit, got: ' + unclosed);
    const lone = g.renderContent('{endtd}', []);
    if (!lone.includes('</td>')) throw new Error('lone endtd must emit </td>');
    const emptyBar = g.renderContent('{bar:}', []);
    if (!emptyBar.includes('{bar:}')) throw new Error('empty {bar:} must stay literal, got: ' + emptyBar);
});

test('bar fill: value/max * 100, clamped, undefined -> 0%, invalid -> literal', () => {
    const g = freshGame().game;
    g.state.hp = 70;
    let html = g.renderContent('{bar: state.hp}', []);
    if (!html.includes('nf-bar-fill" style="width:70%')) throw new Error('70% expected: ' + html);

    html = g.renderContent('{bar: state.hp, max=200}', []);
    if (!html.includes('nf-bar-fill" style="width:35%')) throw new Error('35% expected: ' + html);

    html = g.renderContent('{bar: state.x}', []);
    if (!html.includes('nf-bar-fill" style="width:0%')) throw new Error('undefined -> 0%: ' + html);

    const clamp = g.renderContent('{bar: 150, max=100}', []);
    if (!clamp.includes('width:100%')) throw new Error('clamp to 100: ' + clamp);

    const invalid = g.renderContent('{bar: 1+}', []);
    if (!invalid.includes('{bar: 1+}')) throw new Error('invalid expr must stay literal: ' + invalid);
});

test('bar options: color, w, class', () => {
    const g = freshGame().game;
    g.state.hp = 50;
    const html = g.renderContent('{bar: state.hp, color=#ff0000, w=198, class=custom}', []);
    if (!html.includes('background:#ff0000')) throw new Error('color missing');
    if (!html.includes('class="nf-bar custom"')) throw new Error('bar class wrong: ' + html);
    if (!html.includes('style="width:198px"')) throw new Error('outer width missing: ' + html);
});

test('markup in cells renders: {print:}, bold, link, img', () => {
    const g = freshGame().game;
    g.state.name = 'Alice';
    const text = g.processDirectives('{table:}{tr:}{td:}{print: state.name} **hi** [go](node:next){endtd}{endtr}{endtable}');
    const html = g.renderContent(text, [{ target_node_id: 'next', text: 'go' }]);
    if (!html.includes('Alice')) throw new Error('var not resolved in cell');
    if (!html.includes('<strong>hi</strong>')) throw new Error('bold not resolved in cell');
    if (!html.includes('<a href="#" data-node="next"')) throw new Error('link not resolved in cell');
});

test('live / re-render: bar fill updates with current state', () => {
    const { game: g, env } = freshGame();
    g.state.hp = 20;
    g.nodes['hp'] = { id: 'hp', text: 'HP {bar: state.hp, max=100, w=198}', choices: [], on_enter: null };
    g.render('hp');
    let html = env.document.getElementById('passage-content').innerHTML;
    if (!html.includes('width:20%')) throw new Error('initial bar must be 20%: ' + html);
    g.state.hp = 90;
    g.render('hp');
    html = env.document.getElementById('passage-content').innerHTML;
    if (!html.includes('width:90%')) throw new Error('re-render bar must be 90%: ' + html);
});

test('walker pass-through: table/bar survive _processDirectives (normal + render-only)', () => {
    const g = freshGame().game;
    const src = '{table:}{tr:}{td:}x{endtd}{endtr}{endtable} {bar: state.hp, max=100}';
    const normal = g._processDirectives(src, false).text;
    if (normal !== src) throw new Error('walker must not alter table/bar, got: ' + normal);
    const warns = [];
    const origWarn = console.warn;
    console.warn = (msg) => warns.push(String(msg));
    g._renderOnlyWarned.clear();
    g._renderOnly = true;
    let ro;
    try { ro = g._processDirectives(src, false).text; }
    finally { g._renderOnly = false; }
    console.warn = origWarn;
    if (ro !== src) throw new Error('render-only must pass table/bar through, got: ' + ro);
    const tableWarns = warns.filter(w => /table|bar/i.test(w));
    if (tableWarns.length !== 0) throw new Error('table/bar must produce no render-only warn, got: ' + tableWarns.join('|'));
});

module.exports = { run() { return section('Spec 32 — tables & stat bars') && 0; } };