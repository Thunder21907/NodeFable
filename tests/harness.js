'use strict';
// tests/harness.js
// Shared harness for driving the template.html runtime in a Node vm with mocked
// browser APIs. Supports the DOM parsing needed by wait sequences, live regions,
// forms, and audio.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const TEMPLATE_PATH = path.join(__dirname, '..', 'frontend', 'editor', 'template.html');

function extractEngineScript(templatePath) {
    const html = fs.readFileSync(templatePath, 'utf8');
    const m = html.match(/<script>\n?([\s\S]*?)\n?<\/script>/);
    if (!m) throw new Error('No inline <script> found in ' + templatePath);
    return m[1];
}

// ── Minimal DOM (elements + a tiny HTML parser + selector engine) ──

const VOID_TAGS = new Set(['br', 'img', 'input', 'hr', 'meta', 'link', 'source', 'wbr', 'area', 'base', 'col', 'embed', 'param', 'track']);

class FakeElement {
    constructor(tag, attrs) {
        this.tagName = tag;
        this._attrs = attrs || {};
        this.children = [];
        this._textNodes = [];
        this.parent = null;
        this.style = {};
        this.value = '';
        this.disabled = false;
        this.checked = false;
        this.dataset = {};
        for (const k in this._attrs) {
            if (k.startsWith('data-')) this.dataset[k.slice(5)] = this._attrs[k];
        }
        this.classList = {
            _el: this,
            add() {},
            remove() {},
            toggle() {},
            contains(c) { return (this._el._attrs.class || '').split(/\s+/).includes(c); },
        };
    }
    getAttribute(k) { return this._attrs[k] !== undefined ? this._attrs[k] : null; }
    setAttribute(k, v) { this._attrs[k] = String(v); if (k.startsWith('data-')) this.dataset[k.slice(5)] = String(v); }
    addEventListener() {}
    removeEventListener() {}
    focus() {}
    appendChild(child) {
        child.parent = this;
        this.children.push(child);
        return child;
    }
    querySelectorAll(sel) { return collectAll(this, sel); }
    querySelector(sel) { const r = collectAll(this, sel); return r.length ? r[0] : null; }
    closest(sel) {
        let n = this;
        while (n) {
            if (matches(n, sel)) return n;
            n = n.parent;
        }
        return null;
    }
    get nextElementSibling() {
        if (!this.parent) return null;
        const idx = this.parent.children.indexOf(this);
        return idx >= 0 && idx < this.parent.children.length - 1 ? this.parent.children[idx + 1] : null;
    }
    get textContent() {
        let out = this._textNodes.join('');
        for (const c of this.children) out += c.textContent;
        return out;
    }
    set textContent(v) {
        this._textNodes = [String(v)];
        this.children = [];
        this._html = String(v);
    }
}

Object.defineProperty(FakeElement.prototype, 'innerHTML', {
    get() { return this._html !== undefined ? this._html : ''; },
    set(v) {
        this._html = String(v);
        const parsed = parseHTML(this._html);
        this.children = parsed.children;
        this._textNodes = parsed._textNodes;
        for (const c of this.children) c.parent = this;
    },
});

function parseAttrs(str) {
    const attrs = {};
    const re = /([\w:-]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    let m;
    while ((m = re.exec(str))) {
        attrs[m[1]] = m[3] !== undefined ? m[3] : (m[4] !== undefined ? m[4] : (m[5] !== undefined ? m[5] : ''));
    }
    return attrs;
}

function parseHTML(html) {
    const root = { children: [], _textNodes: [] };
    const stack = [root];
    let textBuf = '';
    const flushText = () => {
        if (textBuf) { stack[stack.length - 1]._textNodes.push(textBuf); textBuf = ''; }
    };
    const re = /<(\/?)([\w-]+)((?:\s+[\w:-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>|([^<]+)/g;
    let m;
    while ((m = re.exec(html))) {
        if (m[5] !== undefined) { textBuf += m[5]; continue; }
        const closing = m[1] === '/';
        const tag = m[2].toLowerCase();
        const attrs = parseAttrs(m[3]);
        const selfClosing = m[4] === '/' || VOID_TAGS.has(tag);
        flushText();
        if (closing) {
            if (stack.length > 1) stack.pop();
            continue;
        }
        if (selfClosing) {
            const el = new FakeElement(tag, attrs);
            stack[stack.length - 1].children.push(el);
            el.parent = stack[stack.length - 1];
            continue;
        }
        const el = new FakeElement(tag, attrs);
        stack[stack.length - 1].children.push(el);
        el.parent = stack[stack.length - 1];
        stack.push(el);
    }
    flushText();
    return root;
}

function matches(el, sel) {
    sel = sel.trim();
    if (sel.startsWith('.')) {
        return (el._attrs.class || '').split(/\s+/).includes(sel.slice(1));
    }
    const attrRe = /^\[([\w:-]+)(?:=["']?(.*?)["']?\])$/;
    const am = sel.match(attrRe);
    if (am) {
        const key = am[1];
        const expected = am[2] !== undefined ? am[2] : '';
        const actual = el._attrs[key] !== undefined ? el._attrs[key] : '';
        return String(actual) === String(expected);
    }
    return el.tagName === sel.toLowerCase();
}

function collectAll(el, sel, out) {
    out = out || [];
    for (const c of el.children) {
        if (matches(c, sel)) out.push(c);
        collectAll(c, sel, out);
    }
    return out;
}

// ── Mock browser environment ──

class FakeAudio {
    constructor(url) {
        this.url = url;
        this.volume = 1;
        this.loop = false;
        this.paused = true;
        this.ended = false;
        this.currentTime = 0;
        this.preload = '';
        this.playCount = 0;
        this._nfState = 'stopped';
    }
    play() { this.paused = false; this.ended = false; this.playCount++; return Promise.resolve(); }
    pause() { this.paused = true; }
}

function makeTimers() {
    const registry = { timeouts: new Map(), intervals: new Map(), next: 1 };
    const api = {
        setTimeout(fn, ms) { const id = registry.next++; registry.timeouts.set(id, { fn, ms }); return id; },
        clearTimeout(id) { registry.timeouts.delete(id); },
        setInterval(fn, ms) { const id = registry.next++; registry.intervals.set(id, { fn, ms }); return id; },
        clearInterval(id) { registry.intervals.delete(id); },
    };
    api._registry = registry;
    return api;
}

function makeDocument() {
    const els = {};
    return {
        _els: els,
        title: '',
        hidden: false,
        activeElement: null,
        getElementById(id) {
            if (!els[id]) els[id] = new FakeElement('div', { id });
            return els[id];
        },
        createElement(tag) { return new FakeElement(tag, {}); },
        querySelector(sel) {
            for (const k in els) {
                const r = collectAll(els[k], sel);
                if (r.length) return r[0];
            }
            return null;
        },
        querySelectorAll(sel) {
            const out = [];
            for (const k in els) out.push(...collectAll(els[k], sel));
            return out;
        },
        addEventListener() {},
    };
}

function makeEnv(opts) {
    opts = opts || {};
    const timers = makeTimers();
    const localStorage = {
        store: {},
        getItem(k) { return this.store[k] !== undefined ? this.store[k] : null; },
        setItem(k, v) { this.store[k] = String(v); },
        removeItem(k) { delete this.store[k]; },
    };
    const document = makeDocument();
    const ctx = {
        console,
        document,
        localStorage,
        performance: { now: () => 0 },
        requestAnimationFrame: () => {},
        Promise,
        Math, JSON, Object, Array, String, Number, RegExp, Date, Error,
        parseInt, parseFloat, isNaN, isFinite,
        setTimeout: timers.setTimeout,
        clearTimeout: timers.clearTimeout,
        setInterval: timers.setInterval,
        clearInterval: timers.clearInterval,
    };
    if (opts.noAudio !== true) {
        ctx.Audio = FakeAudio;
    }
    ctx.window = {
        Audio: opts.noAudio === true ? undefined : FakeAudio,
        location: { reload() {} },
    };
    ctx.location = { reload() {} };
    const env = vm.createContext(ctx);
    env.__timers = timers;
    env.__document = document;
    env.__localStorage = localStorage;
    return env;
}

// ── Game loading ──

function createGame(opts) {
    opts = opts || {};
    const env = makeEnv(opts);
    const script = opts.script || extractEngineScript(opts.templatePath || TEMPLATE_PATH);
    vm.runInContext(script + '\n; this.__game = game;', env, { filename: 'template.js' });
    const game = env.__game;
    // stub UI hooks so init() is pure and render() is fully driveable
    game.updateNavButtons = () => {};
    game.notify = () => {};
    game.autoSave = () => {};
    return { game, env, timers: env.__timers };
}

function initGame(game, data) {
    game.init(data || { name: 'TestGame', variables: {}, nodes: [] });
}

// ── Test runner ──

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        passed++;
        console.log('  PASS ' + name);
    } catch (e) {
        failed++;
        console.log('  FAIL ' + name + '\n       ' + (e && e.stack ? String(e.stack).split('\n').slice(0, 3).join('\n       ') : e));
    }
}

function section(title) {
    console.log('\n== ' + title + ' ==');
}

function summary() {
    console.log('\n' + passed + ' passed, ' + failed + ' failed');
    return failed;
}

// helpers for suites
function waitSeqCount(document) {
    return document.getElementById('passage-content').querySelectorAll('.wait-sequence').length;
}

function getLiveRegion(document, id) {
    return document.querySelector('[data-live-region="' + id + '"]');
}

module.exports = {
    extractEngineScript,
    FakeElement,
    FakeAudio,
    makeEnv,
    createGame,
    initGame,
    test,
    section,
    summary,
    waitSeqCount,
    getLiveRegion,
    TEMPLATE_PATH,
};
