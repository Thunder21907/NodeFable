'use strict';
// tests/suites/radios.test.js
// {radiobutton:} radio rendering: every option wrapped in a clickable
// <label class="nf-radio-option">, 3rd-argument label syntax, native
// auto-check, white-space/markup hygiene, and auto-grouping of free-standing
// radiobutton lines.

const { createGame, initGame, test, section } = require('../harness.js');

section('Radios — label-wrapped options');

function freshGame() {
    const { game, env, timers } = createGame();
    initGame(game, { name: 'RadioTest', variables: { class: 'mage' }, nodes: [] });
    return { game, env, timers };
}

test('3rd-arg label syntax renders input + label inside one <label class=nf-radio-option>', () => {
    const g = freshGame().game;
    const src = '{radiogroup}\n{radiobutton: state.class, warrior, Warrior}\n{radiobutton: state.class, mage, Mage}\n{endradiogroup}';
    const out = g.renderContent(src, []);
    if (!out.includes('<span class="nf-radiogroup">')) throw new Error('missing group span: ' + out);
    if (out.split('<label class="nf-radio-option">').length - 1 !== 2) throw new Error('expected 2 options, got: ' + out);
    if (!out.includes('>Warrior</span></label>')) throw new Error('Warrior label missing: ' + out);
    if (!out.includes('>Mage</span></label>')) throw new Error('Mage label missing: ' + out);
    if (!out.includes('name="nf-rg-0"')) throw new Error('grouped name missing: ' + out);
    if (!out.includes('data-target-var="class"')) throw new Error('target var missing: ' + out);
    if (out.includes('<br')) throw new Error('stray <br> inside group: ' + out);
});

test('label may contain commas (joined back into a single label)', () => {
    const g = freshGame().game;
    const src = '{radiogroup}\n{radiobutton: state.name, bob, Bob the, Builder}\n{endradiogroup}';
    const out = g.renderContent(src, []);
    if (!out.includes('>Bob the, Builder</span>')) throw new Error('comma label must survive, got: ' + out);
});

test('radio checked derives from current state (native auto-check)', () => {
    const g = freshGame().game;
    g.state.class = 'mage';
    const src = '{radiogroup}\n{radiobutton: state.class, warrior, Warrior}\n{radiobutton: state.class, mage, Mage}\n{radiobutton: state.class, rogue, Rogue}\n{endradiogroup}';
    const out = g.renderContent(src, []);
    const mage = out.indexOf('value="mage"');
    if (mage === -1) throw new Error('mage option missing');
    if (!out.slice(mage, out.indexOf('>', mage)).includes('checked')) throw new Error('mage must be checked, got: ' + out.slice(mage, mage + 120));
    const warrior = out.indexOf('value="warrior"');
    if (out.slice(warrior, out.indexOf('>', warrior)).includes('checked')) throw new Error('warrior must not be checked, got: ' + out.slice(warrior, warrior + 120));
});

test('legacy autocheck 3rd arg is allowed and falls back to trailing label text', () => {
    const g = freshGame().game;
    const src = '{radiogroup}\n{radiobutton: state.FemLock, 0, autocheck} Let your actions decide.\n{radiobutton: state.FemLock, 1, autocheck} Lock it in now.\n{endradiogroup}';
    const out = g.renderContent(src, []);
    if (!out.includes('>Let your actions decide.</span>')) throw new Error('trailing label 1 missing: ' + out);
    if (!out.includes('>Lock it in now.</span>')) throw new Error('trailing label 2 missing: ' + out);
    if (out.includes('autocheck')) throw new Error('autocheck must be consumed, got: ' + out);
    if (out.split('<label class="nf-radio-option">').length - 1 !== 2) throw new Error('expected 2 options');
});

test('2-arg radios fall back to trailing label text (author shorthand)', () => {
    const g = freshGame().game;
    const src = '{radiogroup}\n{radiobutton: state.class, warrior} Warrior\n{radiobutton: state.class, mage} Mage\n{endradiogroup}';
    const out = g.renderContent(src, []);
    if (!out.includes('>Warrior</span></label>')) throw new Error('Warrior fallback missing: ' + out);
    if (!out.includes('>Mage</span></label>')) throw new Error('Mage fallback missing: ' + out);
});

test('newline hygiene: inter-option whitespace produces no stray <br> inside the group', () => {
    const g = freshGame().game;
    const src = '{radiogroup}\n\n{radiobutton: state.class, warrior, Warrior}\n\n{radiobutton: state.class, mage, Mage}\n\n{endradiogroup}';
    const out = g.renderContent(src, []);
    const span = out.slice(out.indexOf('<span class="nf-radiogroup">'), out.lastIndexOf('</span>'));
    if (span.includes('<br')) throw new Error('stray <br> inside group: ' + span);
    if (span.split('<label class="nf-radio-option">').length - 1 !== 2) throw new Error('expected 2 options: ' + span);
});

test('free-standing radiobutton lines auto-group into ONE radiogroup by state var', () => {
    const g = freshGame().game;
    const src = '{radiobutton: state.Hair, Blonde, Blonde}\n{radiobutton: state.Hair, Brunette, Brown}';
    const out = g.renderContent(src, []);
    if (out.split('<span class="nf-radiogroup">').length - 1 !== 1) throw new Error('expected one group, got: ' + out);
    if (out.split('<label class="nf-radio-option">').length - 1 !== 2) throw new Error('expected 2 options: ' + out);
    if (!out.includes('>Blonde</span></label>')) throw new Error('Blonde label missing: ' + out);
    if (!out.includes('>Brown</span></label>')) throw new Error('Brown label missing: ' + out);
});

test('different state vars split into distinct groups (distinct names)', () => {
    const g = freshGame().game;
    const src = '{radiobutton: state.Hair, Blonde, Blonde}\n{radiobutton: state.Hair, Brunette, Brown}\n\n{radiobutton: state.boob_size, a, A-Cup}\n{radiobutton: state.boob_size, b, B-Cup}';
    const out = g.renderContent(src, []);
    if (out.split('<span class="nf-radiogroup">').length - 1 !== 2) throw new Error('expected 2 groups: ' + out);
    if (!out.includes('name="nf-rg-0"') || !out.includes('name="nf-rg-1"')) throw new Error('distinct names missing: ' + out);
});

test('surrounding paragraph text stays outside the auto-grouped radios', () => {
    const g = freshGame().game;
    const src = 'Hair color (only affects avatar):\n{radiobutton: state.Hair, Blonde, Blonde}\n{radiobutton: state.Hair, Brunette, Brown}';
    const out = g.renderContent(src, []);
    const openIdx = out.indexOf('<span class="nf-radiogroup">');
    if (openIdx === -1) throw new Error('no group span');
    if (!out.slice(0, openIdx).includes('Hair color (only affects avatar):')) throw new Error('heading text lost: ' + out);
});

test('explicit {radiogroup} blocks are not double-wrapped by auto-grouping', () => {
    const g = freshGame().game;
    const src = '{radiogroup}\n{radiobutton: state.class, warrior, Warrior}\n{radiobutton: state.class, mage, Mage}\n{endradiogroup}';
    const out = g.renderContent(src, []);
    if (out.split('<span class="nf-radiogroup">').length - 1 !== 1) throw new Error('explicit block must stay single group: ' + out);
    if (out.includes('nf-radiogroup"><span class="nf-radiogroup">')) throw new Error('nested group detected: ' + out);
});

test('walker: normal mode passes radios through, render-only drops forms', () => {
    const g = freshGame().game;
    const src = '{radiogroup}\n{radiobutton: state.class, warrior, Warrior}\n{endradiogroup}';
    const normal = g._processDirectives(src, false).text;
    if (normal !== src) throw new Error('walker must not alter radios, got: ' + normal);
    const warns = [];
    const origWarn = console.warn;
    console.warn = (msg) => warns.push(String(msg));
    g._renderOnlyWarned.clear();
    g._renderOnly = true;
    let ro;
    try { ro = g._processDirectives(src, false).text; }
    finally { g._renderOnly = false; }
    console.warn = origWarn;
    if (/\{radiobutton:|\{radiogroup\}|\{endradiogroup\}/.test(ro)) throw new Error('render-only must drop forms, got: ' + ro);
    if (warns.length === 0) throw new Error('render-only should warn about dropped forms');
});

module.exports = { run() { return section('Radios — label-wrapped options') && 0; } };