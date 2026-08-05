'use strict';
// tests/suites/audio.test.js
// {audio:} directive spec (feature 28) — regression suite.

const { createGame, initGame, test, section, summary } = require('../harness.js');

section('Audio directives (feature 28)');

function freshGame(withAudio) {
    const { game, env } = createGame(withAudio === false ? { noAudio: true } : {});
    initGame(game, { name: 'AudioTest', variables: {}, nodes: [] });
    return { game, env };
}

let ctx;

test('walker emits no output for {audio:}', () => {
    ctx = freshGame();
    const r = ctx.game.processDirectives('hello {audio: /snd/a.mp3} world');
    if (r !== 'hello  world') throw new Error('got: ' + r);
});

test('play declaration lands url in active and starts track', () => {
    ctx.game.processDirectives('{audio: /snd/b.mp3}');
    if (!ctx.game._audio.active.has('/snd/b.mp3')) throw new Error('url should be in active');
    const track = ctx.game._audio.tracks['/snd/b.mp3'];
    if (!track) throw new Error('track should be cached');
    if (track.playCount !== 1) throw new Error('play() should be called once, got ' + track.playCount);
});

test('re-declaring a playing track is a no-op (no restart)', () => {
    const before = ctx.game._audio.tracks['/snd/b.mp3'].playCount;
    ctx.game.processDirectives('{audio: /snd/b.mp3}');
    if (ctx.game._audio.tracks['/snd/b.mp3'].playCount !== before) throw new Error('play() must not be called again');
});

test('sfx channel selected via option', () => {
    ctx.game.processDirectives('{audio: /snd/sfx.ogg, sfx}');
    if (ctx.game._audio.tracks['/snd/sfx.ogg']._nfChannel !== 'sfx') throw new Error('sfx channel');
});

test('loop flag set on track', () => {
    ctx.game.processDirectives('{audio: /snd/loop.mp3, loop}');
    if (!ctx.game._audio.tracks['/snd/loop.mp3'].loop) throw new Error('loop should be true');
});

test('loop=false disables loop', () => {
    ctx.game.processDirectives('{audio: /snd/noloop.mp3, loop=false}');
    if (ctx.game._audio.tracks['/snd/noloop.mp3'].loop !== false) throw new Error('loop should be false');
});

test('volume option applied (scaled by master)', () => {
    ctx.game._audio.musicVolume = 1;
    ctx.game.processDirectives('{audio: /snd/vol.mp3, volume=0.4}');
    if (Math.abs(ctx.game._audio.tracks['/snd/vol.mp3'].volume - 0.4) > 1e-9) throw new Error('volume');
});

test('spaced volume = 0.5 works', () => {
    ctx.game.processDirectives('{audio: /snd/vol2.mp3, volume = 0.5}');
    if (Math.abs(ctx.game._audio.tracks['/snd/vol2.mp3'].volume - 0.5) > 1e-9) throw new Error('spaced volume');
});

test('volume clamped to 0..1', () => {
    ctx.game.processDirectives('{audio: /snd/vol3.mp3, volume=99}');
    if (ctx.game._audio.tracks['/snd/vol3.mp3'].volume > 1 + 1e-9) throw new Error('clamp');
});

test('sfx channel uses sfx master volume', () => {
    ctx.game._audio.sfxVolume = 0.5;
    ctx.game.processDirectives('{audio: /snd/sfx2.ogg, sfx, volume=0.8}');
    if (Math.abs(ctx.game._audio.tracks['/snd/sfx2.ogg'].volume - 0.4) > 1e-9) throw new Error('sfx master');
});

test('{audio: url, stop} pauses and resets to 0, not in active', () => {
    ctx.game.processDirectives('{audio: /snd/b.mp3}');
    ctx.game._audio.active.clear();
    const t = ctx.game._audio.tracks['/snd/b.mp3'];
    t.currentTime = 12;
    ctx.game.processDirectives('{audio: /snd/b.mp3, stop}');
    if (!t.paused) throw new Error('track should be paused');
    if (t.currentTime !== 0) throw new Error('track should reset to 0');
    if (ctx.game._audio.active.has('/snd/b.mp3')) throw new Error('stop must not declare track');
});

test('{audio: url, pause} pauses keeping position', () => {
    ctx.game.processDirectives('{audio: /snd/p.mp3}');
    const t = ctx.game._audio.tracks['/snd/p.mp3'];
    t.currentTime = 7;
    ctx.game.processDirectives('{audio: /snd/p.mp3, pause}');
    if (!t.paused) throw new Error('pause');
    if (t.currentTime !== 7) throw new Error('pause must preserve currentTime');
});

test('{audio: url, restart} resets to 0 and plays', () => {
    ctx.game.processDirectives('{audio: /snd/r.mp3}');
    const t = ctx.game._audio.tracks['/snd/r.mp3'];
    t.currentTime = 20;
    t.pause();
    const before = t.playCount;
    ctx.game.processDirectives('{audio: /snd/r.mp3, restart}');
    if (t.currentTime !== 0) throw new Error('restart must reset to 0');
    if (t.playCount !== before + 1) throw new Error('restart must play');
    if (t.paused) throw new Error('restart must unpause');
});

test('stopUndeclared stops cached tracks not declared this render', () => {
    ctx.game.processDirectives('{audio: /snd/keep.mp3}');
    ctx.game.processDirectives('{audio: /snd/drop.mp3}');
    const drop = ctx.game._audio.tracks['/snd/drop.mp3'];
    ctx.game._audio.active.clear();
    ctx.game.processDirectives('{audio: /snd/keep.mp3}');
    ctx.game._audio.stopUndeclared();
    if (!drop.paused) throw new Error('undeclared track must stop');
    if (drop.currentTime !== 0) throw new Error('undeclared track must reset');
    if (ctx.game._audio.tracks['/snd/keep.mp3'].paused) throw new Error('declared track must keep playing');
});

test('audio inside taken {if:} branch is processed; untaken is not', () => {
    ctx.game._audio.active.clear();
    ctx.game.processDirectives('{if: true}{audio: /snd/iftaken.mp3}{endif}');
    if (!ctx.game._audio.active.has('/snd/iftaken.mp3')) throw new Error('taken branch must play');
    ctx.game._audio.active.clear();
    ctx.game.processDirectives('{if: false}{audio: /snd/ifskip.mp3}{endif}');
    if (ctx.game._audio.active.has('/snd/ifskip.mp3')) throw new Error('untaken branch must not play');
    if (ctx.game._audio.tracks['/snd/ifskip.mp3']) throw new Error('untaken branch must not create a track');
});

test('unclosed {audio: renders literally', () => {
    const r = ctx.game.processDirectives('text {audio: /snd/unclosed.mp3');
    if (!r.includes('{audio: /snd/unclosed.mp3')) throw new Error('unclosed tag should stay literal: ' + r);
});

test('case-insensitive directive tag', () => {
    ctx.game.processDirectives('{AUDIO: /snd/case.mp3}');
    if (!ctx.game._audio.tracks['/snd/case.mp3']) throw new Error('case-insensitive');
});

test('setMasterVolume adjusts cached tracks on that channel', () => {
    ctx.game._audio.musicVolume = 1;
    ctx.game.processDirectives('{audio: /snd/mv.mp3, volume=0.5}');
    const t = ctx.game._audio.tracks['/snd/mv.mp3'];
    ctx.game._audio.setMasterVolume('music', 0.5);
    if (Math.abs(t.volume - 0.25) > 1e-9) throw new Error('master volume adjust');
    ctx.game._audio.musicVolume = 1;
});

test('stopAll clears registry and stops tracks', () => {
    ctx.game.processDirectives('{audio: /snd/all.mp3}');
    ctx.game._audio.stopAll();
    if (Object.keys(ctx.game._audio.tracks).length !== 0) throw new Error('registry must be empty');
    if (ctx.game._audio.active.size !== 0) throw new Error('active must be empty');
});

test('loadGame() calls stopAll (registry cleared)', () => {
    ctx.game.processDirectives('{audio: /snd/save.mp3}');
    if (!ctx.game._audio.tracks['/snd/save.mp3']) throw new Error('precondition');
    ctx.env.localStorage.setItem('storyeditor_autosave', JSON.stringify({
        projectName: 'AudioTest', state: {}, currentNodeId: 'x', _history: ['x'], _historyIndex: 0
    }));
    ctx.game.loadGame();
    if (Object.keys(ctx.game._audio.tracks).length !== 0) throw new Error('loadGame must stopAll');
    ctx.env.localStorage.store = {};
});

test('newGame() clears registry via stopAll', () => {
    const g2 = freshGame().game;
    g2.processDirectives('{audio: /snd/ng.mp3}');
    if (!g2._audio.tracks['/snd/ng.mp3']) throw new Error('precondition');
    g2.newGame();
    if (Object.keys(g2._audio.tracks).length !== 0) throw new Error('newGame must stopAll');
});

test('window.Audio absent: all calls no-op without throwing', () => {
    const g3 = freshGame(false).game;
    let ok = true;
    try {
        g3.processDirectives('{audio: /snd/x.mp3, loop, volume=0.4, fade=100}');
        g3._audio.stopUndeclared();
        g3._audio.stopAll();
        g3._audio.pauseTrack('/snd/x.mp3');
        g3._audio.stopTrack('/snd/x.mp3');
        g3._audio.restartTrack('/snd/x.mp3');
        g3._audio.setMasterVolume('music', 0.5);
    } catch (e) { ok = false; }
    if (!ok) throw new Error('must not throw without Audio');
    if (Object.keys(g3._audio.tracks).length !== 0) throw new Error('no tracks without Audio');
});

test('fade>0 still starts playback (play() called)', () => {
    ctx.game.processDirectives('{audio: /snd/fade.mp3, fade=800}');
    const t = ctx.game._audio.tracks['/snd/fade.mp3'];
    if (t.playCount !== 1) throw new Error('fade track must call play()');
    if (t._nfState !== 'playing') throw new Error('fade track state');
});

test('multiple audio directives in one render all declared', () => {
    ctx.game._audio.active.clear();
    ctx.game.processDirectives('{audio: /snd/m1.mp3}\n{audio: /snd/m2.mp3, sfx}');
    if (!ctx.game._audio.active.has('/snd/m1.mp3')) throw new Error('m1');
    if (!ctx.game._audio.active.has('/snd/m2.mp3')) throw new Error('m2');
});

test('explicit music channel option accepted', () => {
    ctx.game._audio.active.clear();
    ctx.game.processDirectives('{audio: /snd/mus.mp3, music}');
    if (ctx.game._audio.tracks['/snd/mus.mp3']._nfChannel !== 'music') throw new Error('music channel');
    if (!ctx.game._audio.active.has('/snd/mus.mp3')) throw new Error('music declared');
});

test('unknown option keys are ignored', () => {
    ctx.game.processDirectives('{audio: /snd/unk.mp3, bogus=1, wat}');
    if (!ctx.game._audio.tracks['/snd/unk.mp3']) throw new Error('track still created');
});

test('{audio:} inside {include:} splice is processed', () => {
    ctx.game.nodes['music_node'] = { id: 'music_node', text: '{audio: /snd/inc.mp3, loop}', choices: [], on_enter: null };
    ctx.game._audio.active.clear();
    const out = ctx.game.processDirectives('pre {include: music_node} post');
    if (!ctx.game._audio.active.has('/snd/inc.mp3')) throw new Error('include splice must declare track');
    if (out.includes('{audio:')) throw new Error('splice must not emit directive text');
});

test('{audio:} inside a loop is processed per render (idempotent)', () => {
    ctx.game._audio.active.clear();
    const out = ctx.game.processDirectives('{for: state.i = 0; state.i < 3; state.i += 1}{audio: /snd/loop.mp3}{endfor}');
    if (!ctx.game._audio.active.has('/snd/loop.mp3')) throw new Error('loop must declare track');
    if (ctx.game._audio.tracks['/snd/loop.mp3'].playCount !== 1) throw new Error('loop should not restart the track');
    if (out.includes('{audio:')) throw new Error('no directive text in output');
});

test('init() resets _audio registry to defaults', () => {
    const g4 = freshGame().game;
    g4.processDirectives('{audio: /snd/reset.mp3}');
    g4._audio.musicVolume = 0.2;
    g4.init({ name: 'AudioTest', variables: {}, nodes: [] });
    if (Object.keys(g4._audio.tracks).length !== 0) throw new Error('registry must be empty after init');
    if (g4._audio.musicVolume !== 1) throw new Error('master volume must reset');
    if (g4._audio.active.size !== 0) throw new Error('active must reset');
});

test('stopUndeclared resets active to a fresh set', () => {
    ctx.game._audio.active.clear();
    ctx.game.processDirectives('{audio: /snd/fresh.mp3}');
    ctx.game._audio.stopUndeclared();
    if (typeof ctx.game._audio.active.add !== 'function') throw new Error('active must be a usable Set');
    if (ctx.game._audio.active.size !== 0) throw new Error('active must be empty after stopUndeclared');
});

module.exports = { run() { return summary(); } };
