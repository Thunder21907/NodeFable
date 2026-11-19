'use strict';
// tests/suites/canvas_engine.test.js
// Unit tests for CanvasEngine in frontend/editor/js/canvas-engine.js.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { section, test } = require('../harness.js');

const ROOT = path.join(__dirname, '..', '..');
const ENGINE_PATH = path.join(ROOT, 'frontend', 'editor', 'js', 'canvas-engine.js');

class MockClassList {
    constructor(el) {
        this._el = el;
    }
    _list() {
        return (this._el._attrs.class || '').split(/\s+/).filter(Boolean);
    }
    _save(arr) {
        this._el._attrs.class = arr.join(' ');
    }
    add(...tokens) {
        const set = new Set(this._list());
        for (const t of tokens) if (t) set.add(t);
        this._save(Array.from(set));
    }
    remove(...tokens) {
        const rm = new Set(tokens);
        this._save(this._list().filter((c) => !rm.has(c)));
    }
    toggle(token, force) {
        const has = this.contains(token);
        const shouldHave = force !== undefined ? !!force : !has;
        if (shouldHave) this.add(token);
        else this.remove(token);
        return shouldHave;
    }
    contains(token) {
        return this._list().includes(token);
    }
}

function matchesSimpleSelector(el, sel) {
    let rest = sel.trim();
    if (!rest) return false;

    const tagMatch = rest.match(/^([a-zA-Z0-9_-]+)/);
    if (tagMatch) {
        if (el.tagName.toLowerCase() !== tagMatch[1].toLowerCase()) return false;
        rest = rest.slice(tagMatch[0].length);
    }

    const idMatch = rest.match(/#([a-zA-Z0-9_-]+)/);
    if (idMatch) {
        if (el.id !== idMatch[1]) return false;
        rest = rest.replace(idMatch[0], '');
    }

    const classMatches = rest.match(/\.[a-zA-Z0-9_-]+/g) || [];
    for (const cm of classMatches) {
        if (!el.classList.contains(cm.slice(1))) return false;
    }
    return true;
}

function collectMatching(root, selector) {
    const parts = selector.split(',').map((s) => s.trim()).filter(Boolean);
    const out = [];
    function walk(node) {
        for (const child of node.children) {
            if (parts.some((p) => matchesSimpleSelector(child, p))) {
                out.push(child);
            }
            walk(child);
        }
    }
    walk(root);
    return out;
}

class MockElement {
    constructor(tagName, isSvg = false) {
        this.tagName = tagName;
        this._isSvg = isSvg;
        this._attrs = {};
        this.children = [];
        this.parentNode = null;
        this.style = {};
        this.tabIndex = -1;
        this.offsetWidth = 0;
        this.offsetHeight = 0;
        this.offsetTop = 0;
        this.classList = new MockClassList(this);
        this._html = '';
        this._listeners = {};

        if (isSvg) {
            const self = this;
            this._svgClassName = {
                get baseVal() {
                    return self._attrs.class || '';
                }
            };
        }
    }

    get id() {
        return this._attrs.id || '';
    }
    set id(v) {
        this._attrs.id = String(v);
    }

    get className() {
        if (this._isSvg) return this._svgClassName;
        return this._attrs.class || '';
    }
    set className(v) {
        if (!this._isSvg) {
            this._attrs.class = String(v);
        }
    }

    get innerHTML() {
        return this._html;
    }
    set innerHTML(v) {
        this._html = String(v);
        if (this._html === '') {
            for (const c of this.children) c.parentNode = null;
            this.children = [];
        }
    }

    get parentElement() {
        return this.parentNode;
    }

    setAttribute(k, v) {
        this._attrs[k] = String(v);
    }
    getAttribute(k) {
        return this._attrs[k] !== undefined ? this._attrs[k] : null;
    }
    removeAttribute(k) {
        delete this._attrs[k];
    }

    appendChild(child) {
        if (child.parentNode) child.parentNode.removeChild(child);
        child.parentNode = this;
        this.children.push(child);
        return child;
    }
    removeChild(child) {
        const idx = this.children.indexOf(child);
        if (idx !== -1) {
            this.children.splice(idx, 1);
            child.parentNode = null;
        }
        return child;
    }

    closest(sel) {
        const parts = sel.split(',').map((s) => s.trim()).filter(Boolean);
        let cur = this;
        while (cur) {
            if (parts.some((p) => matchesSimpleSelector(cur, p))) return cur;
            cur = cur.parentNode;
        }
        return null;
    }

    querySelectorAll(sel) {
        return collectMatching(this, sel);
    }
    querySelector(sel) {
        const r = collectMatching(this, sel);
        return r.length ? r[0] : null;
    }

    addEventListener(type, fn) {
        if (!this._listeners[type]) this._listeners[type] = [];
        this._listeners[type].push(fn);
    }
    dispatchEvent(event) {
        const list = this._listeners[event.type] || [];
        for (const fn of list) fn(event);
    }

    focus(opts) {
        this._focused = true;
        this._focusOpts = opts;
    }

    getBoundingClientRect() {
        throw new Error('Zero-reflow violation: getBoundingClientRect must not be called');
    }
}

function createHarness() {
    const container = new MockElement('div');
    const mockDocument = {
        createElement(tag) {
            return new MockElement(tag, false);
        },
        createElementNS(_ns, tag) {
            return new MockElement(tag, true);
        },
        getElementById(id) {
            return container.querySelector('#' + id);
        }
    };
    const winListeners = {};
    const mockWindow = {
        addEventListener(type, fn) {
            if (!winListeners[type]) winListeners[type] = [];
            winListeners[type].push(fn);
        },
        dispatchEvent(event) {
            const list = winListeners[event.type] || [];
            for (const fn of list) fn(event);
        }
    };
    const src = fs.readFileSync(ENGINE_PATH, 'utf8')
        .replace(/^\s*export\s+class\s+CanvasEngine/m, 'class CanvasEngine')
        + '\n;globalThis.CanvasEngine = CanvasEngine;';

    const ctx = vm.createContext({
        document: mockDocument,
        window: mockWindow,
        console,
        setTimeout,
        clearTimeout,
        Math,
        Number,
        String,
        Array,
        Object,
        Map,
        Set,
        parseInt,
        isNaN
    });
    vm.runInContext(src, ctx);

    const engine = new ctx.CanvasEngine(container);
    engine.start();
    return { engine, container, window: mockWindow, CanvasEngine: ctx.CanvasEngine };
}

section('CanvasEngine (frontend/editor/js/canvas-engine.js)');

test('1. addNode creates node data with pos_x, pos_y, inputs, outputs and dispatches nodeCreated', () => {
    const { engine, window: win, CanvasEngine } = createHarness();
    assert.strictEqual(win.Drawflow, CanvasEngine);

    const created = [];
    engine.on('nodeCreated', (id) => created.push(id));

    const id = engine.addNode('story_node', 1, 2, 120, 240, 'story_node', { custom: 1 }, '<b>Intro</b>');
    assert.strictEqual(id, 1);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(created)), [1]);

    const node = engine.drawflow.drawflow.Home.data[1];
    assert.ok(node, 'node stored in drawflow.drawflow.Home.data');
    assert.strictEqual(node.pos_x, 120);
    assert.strictEqual(node.pos_y, 240);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(Object.keys(node.inputs))), ['input_1']);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(Object.keys(node.outputs))), ['output_1', 'output_2']);

    const domEl = engine.precanvas.querySelector('#node-1');
    assert.ok(domEl, 'node DOM element created in precanvas');
    assert.strictEqual(domEl.style.left, '120px');
    assert.strictEqual(domEl.style.top, '240px');

    // Titles are rendered as text, never parsed as HTML (XSS hardening)
    const contentEl = domEl.querySelector('.drawflow_content_node');
    assert.strictEqual(contentEl.textContent, '<b>Intro</b>');
    assert.strictEqual(contentEl.innerHTML, '');
});

test('2. addConnection is silent by default, dispatches connectionCreated only with { notify: true }, and draws a cubic Bezier', () => {
    const { engine } = createHarness();
    const events = [];
    engine.on('connectionCreated', (d) => events.push(d));

    const n1 = engine.addNode('story_node', 1, 1, 100, 200, 'story_node', {}, 'A');
    const n2 = engine.addNode('story_node', 1, 1, 408, 300, 'story_node', {}, 'B');

    assert.strictEqual(engine.addConnection(n1, n2, 'output_1', 'input_1'), true);
    assert.strictEqual(events.length, 0, 'programmatic addConnection must be silent');
    engine.removeSingleConnection(n1, n2, 'output_1', 'input_1');
    assert.strictEqual(engine.addConnection(n1, n2, 'output_1', 'input_1', { notify: true }), true);
    assert.strictEqual(engine.addConnection(n1, n2, 'output_1', 'input_1', { notify: true }), false, 'duplicates are ignored');

    assert.strictEqual(events.length, 1);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(events[0])), {
        output_id: n1,
        input_id: n2,
        output_class: 'output_1',
        input_class: 'input_1'
    });

    const outConns = engine.drawflow.drawflow.Home.data[n1].outputs.output_1.connections;
    const inConns = engine.drawflow.drawflow.Home.data[n2].inputs.input_1.connections;
    assert.deepStrictEqual(JSON.parse(JSON.stringify(outConns)), [{ node: String(n2), output: 'input_1' }]);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(inConns)), [{ node: String(n1), input: 'output_1' }]);

    const svg = engine.precanvas.querySelector(`svg.connection.node_in_node-${n2}.node_out_node-${n1}.output_1.input_1`);
    assert.ok(svg, 'SVG connection element created in precanvas');
    assert.strictEqual(svg.style.left, '296px');
    assert.strictEqual(svg.style.top, '222px');
    assert.strictEqual(svg.style.width, '124px');
    assert.strictEqual(svg.style.height, '124px');

    const hitEl = svg.querySelector('.hit-path');
    const pathEl = svg.querySelector('.main-path');
    assert.ok(hitEl, 'SVG hit-path created');
    assert.ok(pathEl, 'SVG main-path created');

    const d = pathEl.getAttribute('d');
    assert.ok(d && /^M\s+[\d.-]+\s+[\d.-]+\s+C\s+/.test(d), 'Expected cubic Bezier M ... C ... path, got: ' + d);
    assert.strictEqual(d, 'M 12 12 C 42 12 82 112 112 112');
    assert.strictEqual(hitEl.getAttribute('d'), d);
});

test('3. moving a node and calling updateConnectionNodes updates SVG path mathematically without getBoundingClientRect', () => {
    const { engine } = createHarness();
    const n1 = engine.addNode('story_node', 1, 1, 100, 200, 'story_node', {}, 'A');
    const n2 = engine.addNode('story_node', 1, 1, 408, 300, 'story_node', {}, 'B');
    engine.addConnection(n1, n2, 'output_1', 'input_1');

    const svg = engine.precanvas.querySelector(`svg.connection.node_out_node-${n1}`);
    const pathEl = svg.querySelector('.main-path');
    const hitEl = svg.querySelector('.hit-path');
    assert.strictEqual(svg.style.left, '296px');
    assert.strictEqual(svg.style.top, '222px');
    assert.strictEqual(svg.style.width, '124px');
    assert.strictEqual(svg.style.height, '124px');
    const dBefore = pathEl.getAttribute('d');
    assert.strictEqual(dBefore, 'M 12 12 C 42 12 82 112 112 112');
    assert.strictEqual(hitEl.getAttribute('d'), dBefore);

    engine.drawflow.drawflow.Home.data[n2].pos_x = 608;
    engine.drawflow.drawflow.Home.data[n2].pos_y = 350;
    engine.updateConnectionNodes('node-' + n2);

    assert.strictEqual(svg.style.left, '296px');
    assert.strictEqual(svg.style.top, '222px');
    assert.strictEqual(svg.style.width, '324px');
    assert.strictEqual(svg.style.height, '174px');
    const dAfter = pathEl.getAttribute('d');
    assert.notStrictEqual(dAfter, dBefore);
    assert.strictEqual(dAfter, 'M 12 12 C 102 12 222 162 312 162');
    assert.strictEqual(hitEl.getAttribute('d'), dAfter);
});

test('4. removeSingleConnection and removeNodeId clean up silently by default and dispatch only with { notify: true }', () => {
    const { engine } = createHarness();
    const connRemoved = [];
    const nodeRemoved = [];
    engine.on('connectionRemoved', (d) => connRemoved.push(d));
    engine.on('nodeRemoved', (id) => nodeRemoved.push(id));

    const n1 = engine.addNode('story_node', 1, 1, 10, 10, 'story_node', {}, 'A');
    const n2 = engine.addNode('story_node', 1, 1, 200, 10, 'story_node', {}, 'B');
    const n3 = engine.addNode('story_node', 1, 1, 400, 10, 'story_node', {}, 'C');

    engine.addConnection(n1, n2, 'output_1', 'input_1');
    engine.addConnection(n2, n3, 'output_1', 'input_1');

    engine.removeSingleConnection(n1, n2, 'output_1', 'input_1');
    assert.strictEqual(connRemoved.length, 0, 'programmatic removal must be silent');
    engine.addConnection(n1, n2, 'output_1', 'input_1');
    engine.removeSingleConnection(n1, n2, 'output_1', 'input_1', { notify: true });
    assert.strictEqual(connRemoved.length, 1);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(connRemoved[0])), {
        output_id: n1,
        input_id: n2,
        output_class: 'output_1',
        input_class: 'input_1'
    });
    assert.strictEqual(engine.drawflow.drawflow.Home.data[n1].outputs.output_1.connections.length, 0);
    assert.strictEqual(engine.drawflow.drawflow.Home.data[n2].inputs.input_1.connections.length, 0);
    assert.strictEqual(engine.precanvas.querySelector(`svg.connection.node_out_node-${n1}`), null);

    engine.removeNodeId('node-' + n2, { notify: true });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(nodeRemoved)), [n2]);
    assert.strictEqual(connRemoved.length, 1, 'edges of a removed node are torn down silently');
    assert.strictEqual(engine.drawflow.drawflow.Home.data[n2], undefined);
    assert.strictEqual(engine.drawflow.drawflow.Home.data[n3].inputs.input_1.connections.length, 0);
    assert.strictEqual(engine.precanvas.querySelector('#node-' + n2), null);
    assert.strictEqual(engine.precanvas.querySelector(`svg.connection.node_out_node-${n2}`), null);

    engine.removeNodeId('node-' + n3);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(nodeRemoved)), [n2], 'silent removeNodeId does not dispatch');
    assert.strictEqual(engine.drawflow.drawflow.Home.data[n3], undefined);
});

test('5. zoom_in, zoom_out, and zoom_reset clamp zoom, update precanvas.style.transform, and dispatch zoom', () => {
    const { engine } = createHarness();
    const zoomEvents = [];
    engine.on('zoom', (z) => zoomEvents.push(z));

    engine.zoom_in();
    assert.strictEqual(engine.zoom, 1.05);
    assert.strictEqual(engine.precanvas.style.transform, 'translate(0px, 0px) scale(1.05)');

    for (let i = 0; i < 50; i++) engine.zoom_in();
    assert.strictEqual(engine.zoom, engine.zoom_max);
    assert.strictEqual(engine.precanvas.style.transform, 'translate(0px, 0px) scale(2)');

    for (let i = 0; i < 100; i++) engine.zoom_out();
    assert.strictEqual(engine.zoom, engine.zoom_min);
    assert.strictEqual(engine.precanvas.style.transform, 'translate(0px, 0px) scale(0.15)');

    engine.zoom_reset();
    assert.strictEqual(engine.zoom, 1);
    assert.strictEqual(engine.precanvas.style.transform, 'translate(0px, 0px) scale(1)');
    assert.strictEqual(zoomEvents[zoomEvents.length - 1], 1);
});

test('6. selecting .main-path or .hit-path selects .main-path without panning and removeConnection / Delete removes it', () => {
    const { engine, container, window: win } = createHarness();
    const selected = [];
    const unselected = [];
    const removed = [];
    engine.on('connectionSelected', (d) => selected.push(d));
    engine.on('connectionUnselected', (v) => unselected.push(v));
    engine.on('connectionRemoved', (d) => removed.push(d));
    const before = [];
    engine.on('beforeUserEdit', (d) => before.push(d.type));

    const n1 = engine.addNode('story_node', 1, 1, 10, 10, 'story_node', {}, 'A');
    const n2 = engine.addNode('story_node', 1, 1, 300, 10, 'story_node', {}, 'B');
    engine.addConnection(n1, n2, 'output_1', 'input_1');

    const pathEl = engine.precanvas.querySelector(`svg.connection.node_out_node-${n1}`).querySelector('.main-path');
    assert.ok(pathEl);

    container.dispatchEvent({
        type: 'pointerdown',
        pointerId: 1,
        pointerType: 'mouse',
        button: 0,
        clientX: 150,
        clientY: 30,
        target: pathEl
    });
    win.dispatchEvent({
        type: 'pointerup',
        pointerId: 1,
        pointerType: 'mouse',
        clientX: 150,
        clientY: 30,
        target: pathEl
    });

    assert.strictEqual(engine.connection_selected, pathEl);
    assert.strictEqual(pathEl.classList.contains('selected'), true);
    assert.strictEqual(engine.editor_selected, false);
    assert.strictEqual(container._focused, true);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(container._focusOpts)), { preventScroll: true });
    assert.strictEqual(selected.length, 1);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(selected[0])), {
        output_id: n1,
        input_id: n2,
        output_class: 'output_1',
        input_class: 'input_1'
    });

    let prevented = false;
    container.dispatchEvent({
        type: 'keydown',
        key: 'Delete',
        target: container,
        preventDefault() { prevented = true; }
    });

    assert.strictEqual(prevented, true);
    assert.strictEqual(engine.connection_selected, null);
    assert.strictEqual(unselected.length, 1);
    assert.strictEqual(removed.length, 1);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(removed[0])), {
        output_id: n1,
        input_id: n2,
        output_class: 'output_1',
        input_class: 'input_1'
    });
    assert.strictEqual(engine.precanvas.querySelector(`svg.connection.node_out_node-${n1}`), null);

    // Clicking .hit-path selects .main-path and removeConnection() removes it
    engine.addConnection(n1, n2, 'output_1', 'input_1');
    const svg2 = engine.precanvas.querySelector(`svg.connection.node_out_node-${n1}`);
    const hitEl2 = svg2.querySelector('.hit-path');
    const pathEl2 = svg2.querySelector('.main-path');
    assert.ok(hitEl2 && pathEl2);
    container._focused = false;
    container.dispatchEvent({
        type: 'pointerdown',
        pointerId: 2,
        pointerType: 'mouse',
        button: 0,
        clientX: 150,
        clientY: 30,
        target: hitEl2
    });
    win.dispatchEvent({
        type: 'pointerup',
        pointerId: 2,
        pointerType: 'mouse',
        clientX: 150,
        clientY: 30,
        target: hitEl2
    });
    assert.strictEqual(engine.connection_selected, pathEl2);
    assert.strictEqual(pathEl2.classList.contains('selected'), true);
    assert.strictEqual(hitEl2.classList.contains('selected'), false);
    assert.strictEqual(container._focused, true);
    assert.strictEqual(selected.length, 2);
    const ok = engine.removeConnection();
    assert.strictEqual(ok, true);
    assert.strictEqual(engine.connection_selected, null);
    assert.strictEqual(removed.length, 2);
    assert.strictEqual(engine.precanvas.querySelector(`svg.connection.node_out_node-${n1}`), null);

    // Clicking .hit-path followed by Delete key removes the connection
    engine.addConnection(n1, n2, 'output_1', 'input_1');
    const svg3 = engine.precanvas.querySelector(`svg.connection.node_out_node-${n1}`);
    const hitEl3 = svg3.querySelector('.hit-path');
    const pathEl3 = svg3.querySelector('.main-path');
    container.dispatchEvent({
        type: 'pointerdown',
        pointerId: 3,
        pointerType: 'mouse',
        button: 0,
        clientX: 150,
        clientY: 30,
        target: hitEl3
    });
    win.dispatchEvent({
        type: 'pointerup',
        pointerId: 3,
        pointerType: 'mouse',
        clientX: 150,
        clientY: 30,
        target: hitEl3
    });
    assert.strictEqual(engine.connection_selected, pathEl3);
    let prevented3 = false;
    container.dispatchEvent({
        type: 'keydown',
        key: 'Delete',
        target: container,
        preventDefault() { prevented3 = true; }
    });
    assert.strictEqual(prevented3, true);
    assert.strictEqual(engine.connection_selected, null);
    assert.strictEqual(removed.length, 3);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(before)), ['connectionRemove', 'connectionRemove', 'connectionRemove']);
    assert.strictEqual(engine.precanvas.querySelector(`svg.connection.node_out_node-${n1}`), null);
});

test('7. plain wheel pans; ctrl+wheel zooms anchored at the cursor', () => {
    const { engine, container } = createHarness();
    assert.strictEqual(engine.zoom, 1);

    let prevented = false;
    container.dispatchEvent({
        type: 'wheel', deltaX: 10, deltaY: 120, deltaMode: 0, ctrlKey: false, metaKey: false,
        clientX: 0, clientY: 0, preventDefault() { prevented = true; }
    });
    assert.strictEqual(prevented, true);
    assert.strictEqual(engine.zoom, 1, 'plain wheel must not zoom');
    assert.strictEqual(engine.canvas_x, -10);
    assert.strictEqual(engine.canvas_y, -120);

    // Ctrl+wheel: the world point under the cursor stays under the cursor.
    container.getBoundingClientRect = () => ({ left: 50, top: 20, width: 800, height: 600 });
    const cx = 250, cy = 220;
    const worldBefore = { x: (cx - 50 - engine.canvas_x) / engine.zoom, y: (cy - 20 - engine.canvas_y) / engine.zoom };
    container.dispatchEvent({
        type: 'wheel', deltaY: -100, deltaMode: 0, ctrlKey: true, clientX: cx, clientY: cy, preventDefault() {}
    });
    assert.ok(engine.zoom > 1, 'ctrl+wheel up zooms in');
    const worldAfter = { x: (cx - 50 - engine.canvas_x) / engine.zoom, y: (cy - 20 - engine.canvas_y) / engine.zoom };
    assert.ok(Math.abs(worldAfter.x - worldBefore.x) < 1e-6 && Math.abs(worldAfter.y - worldBefore.y) < 1e-6,
        'zoom anchored at cursor: ' + JSON.stringify({ worldBefore, worldAfter }));

    container.dispatchEvent({
        type: 'wheel', deltaY: 100, deltaMode: 0, ctrlKey: true, clientX: cx, clientY: cy, preventDefault() {}
    });
    assert.ok(Math.abs(engine.zoom - 1) < 0.01, 'ctrl+wheel down zooms back out, got ' + engine.zoom);
});

test('8. pointermove with buttons: 0 clears stuck editor_selected pan state and window pointerup ends pan', () => {
    const { engine, container, window: win } = createHarness();

    container.dispatchEvent({
        type: 'pointerdown',
        pointerId: 1,
        pointerType: 'mouse',
        button: 0,
        clientX: 100,
        clientY: 100,
        target: container
    });
    assert.strictEqual(engine.editor_selected, true);

    container.dispatchEvent({
        type: 'pointermove',
        pointerId: 1,
        pointerType: 'mouse',
        buttons: 0,
        clientX: 150,
        clientY: 150,
        target: container
    });
    assert.strictEqual(engine.editor_selected, false);
    assert.strictEqual(engine._panState, null);

    // Also verify window pointerup releases pan started on container
    container.dispatchEvent({
        type: 'pointerdown',
        pointerId: 2,
        pointerType: 'mouse',
        button: 0,
        clientX: 50,
        clientY: 50,
        target: container
    });
    assert.strictEqual(engine.editor_selected, true);

    win.dispatchEvent({
        type: 'pointerup',
        pointerId: 2,
        pointerType: 'mouse',
        clientX: 60,
        clientY: 60,
        target: win
    });
    assert.strictEqual(engine.editor_selected, false);
    assert.strictEqual(engine._panState, null);
});

test('9. backward row-wrap connection uses exact cubic Bezier extrema for SVG bounding box', () => {
    const { engine } = createHarness();
    const n1 = engine.addNode('story_node', 1, 1, 8000, 140, 'story_node', {}, 'EndOfRow');
    const n2 = engine.addNode('story_node', 1, 1, 100, 280, 'story_node', {}, 'StartOfNextRow');
    engine.addConnection(n1, n2, 'output_1', 'input_1');

    const svg = engine.precanvas.querySelector(`svg.connection.node_in_node-${n2}.node_out_node-${n1}.output_1.input_1`);
    assert.ok(svg, 'SVG connection element created');

    const width = parseFloat(svg.style.width);
    const height = parseFloat(svg.style.height);
    assert.ok(width > 8000 && width < 9500, `Expected tightly bounded width (< 9500px, not > 12000px from raw control points), got ${width}`);
    assert.strictEqual(svg.style.top, '162px');
    assert.strictEqual(height, 164);

    const d = svg.querySelector('.main-path').getAttribute('d');
    assert.ok(d && /^M\s+[\d.-]+\s+12\s+C\s+/.test(d), 'Expected valid cubic Bezier path, got: ' + d);
});

test('10. dragging a link: story body drop links input_1 and emits beforeUserEdit; portal body drop and portal-output drags are ignored', () => {
    const { engine, container, window: win } = createHarness();
    const created = [];
    const before = [];
    engine.on('connectionCreated', (d) => created.push(d));
    engine.on('beforeUserEdit', (d) => before.push(d.type));
    // One container-origin read per link gesture is allowed (not per frame).
    container.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 });

    const a = engine.addNode('story_node', 1, 1, 0, 0, 'story_node', {}, 'A');
    const b = engine.addNode('story_node', 1, 1, 400, 0, 'story_node', {}, 'B');
    const p = engine.addNode('portal_node', 2, 2, 800, 0, 'portal_node', {}, 'P');

    const out = (id) => engine.precanvas.querySelector('#node-' + id).querySelector('.output_1');
    const body = (id) => engine.precanvas.querySelector('#node-' + id).querySelector('.drawflow_content_node');
    const drag = (fromEl, toEl, pid) => {
        container.dispatchEvent({ type: 'pointerdown', pointerId: pid, pointerType: 'mouse', button: 0, clientX: 0, clientY: 0, target: fromEl });
        win.dispatchEvent({ type: 'pointerup', pointerId: pid, pointerType: 'mouse', clientX: 0, clientY: 0, target: toEl });
    };

    drag(out(a), body(b), 1);
    assert.strictEqual(created.length, 1);
    assert.strictEqual(created[0].input_class, 'input_1');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(before)), ['connectionCreate']);

    drag(out(a), body(p), 2);
    assert.strictEqual(created.length, 1, 'dropping on a portal body must not pick a slug row');

    const portalIn2 = engine.precanvas.querySelector('#node-' + p).querySelector('.input_2');
    drag(out(a), portalIn2, 3);
    assert.strictEqual(created.length, 2);
    assert.strictEqual(created[1].input_class, 'input_2');

    drag(out(p), body(b), 4);
    assert.strictEqual(created.length, 2, 'portal outputs are read-only');
    assert.strictEqual(engine.connection, false);
    assert.strictEqual(engine.precanvas.querySelectorAll('svg.temp-connection').length, 0);
});

test('10b. dragging a link onto an already-linked port toggles it off (beforeUserEdit + connectionRemoved)', () => {
    const { engine, container, window: win } = createHarness();
    container.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 });
    const removed = [];
    const before = [];
    engine.on('connectionRemoved', (d) => removed.push(d));
    engine.on('beforeUserEdit', (d) => before.push(d.type));

    const a = engine.addNode('story_node', 1, 1, 0, 0, 'story_node', {}, 'A');
    const b = engine.addNode('story_node', 1, 1, 400, 0, 'story_node', {}, 'B');
    engine.addConnection(a, b);
    const outA = engine.precanvas.querySelector('#node-' + a).querySelector('.output_1');
    const inB = engine.precanvas.querySelector('#node-' + b).querySelector('.input_1');
    container.dispatchEvent({ type: 'pointerdown', pointerId: 1, pointerType: 'mouse', button: 0, clientX: 0, clientY: 0, target: outA });
    win.dispatchEvent({ type: 'pointerup', pointerId: 1, pointerType: 'mouse', clientX: 0, clientY: 0, target: inB });

    assert.strictEqual(engine.hasConnection(a, b), false);
    assert.strictEqual(removed.length, 1);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(before)), ['connectionRemove']);
    assert.strictEqual(engine.precanvas.querySelectorAll('svg.connection').length, 0);
});

test('10c. unplugging a linked input: click keeps it, drag moves it (rewired), empty drop removes it, cancel/same-port restores it', () => {
    const { engine, container, window: win } = createHarness();
    container.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 });
    const ev = { before: [], removed: [], rewired: [], created: [] };
    engine.on('beforeUserEdit', (d) => ev.before.push(d.type));
    engine.on('connectionRemoved', (d) => ev.removed.push(d));
    engine.on('connectionRewired', (d) => ev.rewired.push(d));
    engine.on('connectionCreated', (d) => ev.created.push(d));

    const a = engine.addNode('story_node', 1, 1, 0, 0, 'story_node', {}, 'A');
    const b = engine.addNode('story_node', 1, 1, 400, 0, 'story_node', {}, 'B');
    const c = engine.addNode('story_node', 1, 1, 400, 300, 'story_node', {}, 'C');
    engine.addConnection(a, b);
    const inB = engine.precanvas.querySelector('#node-' + b).querySelector('.input_1');
    const inC = engine.precanvas.querySelector('#node-' + c).querySelector('.input_1');
    let pid = 0;
    const press = () => { pid++; container.dispatchEvent({ type: 'pointerdown', pointerId: pid, pointerType: 'mouse', button: 0, clientX: 100, clientY: 100, target: inB }); };
    const move = (x, y) => win.dispatchEvent({ type: 'pointermove', pointerId: pid, pointerType: 'mouse', buttons: 1, clientX: x, clientY: y, target: win });
    const up = (target, type = 'pointerup') => win.dispatchEvent({ type, pointerId: pid, pointerType: 'mouse', clientX: 300, clientY: 300, target });
    const nodeB = engine.drawflow.drawflow.Home.data[b];

    // (1) jitter below threshold → plain click: nothing detached, node not moved
    press(); move(103, 102); up(inB);
    assert.strictEqual(engine.hasConnection(a, b), true);
    assert.strictEqual(nodeB.pos_x, 400);
    assert.strictEqual(ev.before.length, 0);

    // (2) drag onto C's input → edge moves A→C, one beforeUserEdit, connectionRewired
    press(); move(200, 200);
    assert.strictEqual(engine.hasConnection(a, b), false, 'edge unplugged while dragging');
    assert.strictEqual(engine.connection, true);
    assert.strictEqual(nodeB.pos_x, 400, 'unplugging does not drag the node');
    up(inC);
    assert.strictEqual(engine.hasConnection(a, c), true);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(ev.before)), ['connectionDetach']);
    assert.strictEqual(ev.rewired.length, 1);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(ev.rewired[0])), {
        output_id: a, output_class: 'output_1',
        from: { input_id: b, input_class: 'input_1' },
        to: { input_id: c, input_class: 'input_1' }
    });
    assert.strictEqual(ev.created.length, 0, 'rewire is not reported as a new link');
    assert.strictEqual(engine.precanvas.querySelectorAll('svg.temp-connection').length, 0);

    // (3) unplug from C and drop back on C → restored, no events
    const prevBefore = ev.before.length;
    pid++; container.dispatchEvent({ type: 'pointerdown', pointerId: pid, pointerType: 'mouse', button: 0, clientX: 100, clientY: 100, target: inC });
    move(200, 200); up(inC);
    assert.strictEqual(engine.hasConnection(a, c), true);
    assert.strictEqual(ev.rewired.length, 1);
    assert.strictEqual(ev.removed.length, 0);
    assert.strictEqual(ev.before.length, prevBefore + 1);

    // (4) unplug and pointercancel → restored
    pid++; container.dispatchEvent({ type: 'pointerdown', pointerId: pid, pointerType: 'mouse', button: 0, clientX: 100, clientY: 100, target: inC });
    move(200, 200); up(container, 'pointercancel');
    assert.strictEqual(engine.hasConnection(a, c), true, 'cancel puts the link back');
    assert.strictEqual(ev.removed.length, 0);

    // (5) unplug and drop on empty canvas → removed (connectionRemoved for the old edge)
    pid++; container.dispatchEvent({ type: 'pointerdown', pointerId: pid, pointerType: 'mouse', button: 0, clientX: 100, clientY: 100, target: inC });
    move(200, 200); up(engine.precanvas);
    assert.strictEqual(engine.hasConnection(a, c), false);
    assert.strictEqual(ev.removed.length, 1);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(ev.removed[0])), { output_id: a, input_id: c, output_class: 'output_1', input_class: 'input_1' });

    // (6) an unlinked input does not arm unplug (normal node drag)
    pid++; container.dispatchEvent({ type: 'pointerdown', pointerId: pid, pointerType: 'mouse', button: 0, clientX: 100, clientY: 100, target: inC });
    move(150, 100); up(inC);
    assert.strictEqual(engine.drawflow.drawflow.Home.data[c].pos_x, 450, 'unlinked input drags the node as before');
});

test('11. node drag keeps following window pointermove after leaving the canvas', () => {
    const { engine, container, window: win } = createHarness();
    const n = engine.addNode('story_node', 1, 1, 10, 20, 'story_node', {}, 'N');
    const el = engine.precanvas.querySelector('#node-' + n);
    container.dispatchEvent({ type: 'pointerdown', pointerId: 1, pointerType: 'mouse', button: 0, clientX: 100, clientY: 100, target: el });
    win.dispatchEvent({ type: 'pointermove', pointerId: 1, pointerType: 'mouse', buttons: 1, clientX: 160, clientY: 130, target: win });
    assert.strictEqual(engine.drawflow.drawflow.Home.data[n].pos_x, 70);
    assert.strictEqual(engine.drawflow.drawflow.Home.data[n].pos_y, 50);
    win.dispatchEvent({ type: 'pointerup', pointerId: 1, pointerType: 'mouse', clientX: 160, clientY: 130, target: win });
    assert.strictEqual(engine.drag, false);
});

test('12. zoom buttons anchor at the canvas centre; removing a selected edge clears the selection', () => {
    const { engine, container } = createHarness();
    container.clientWidth = 800;
    container.clientHeight = 600;
    engine.zoom_in();
    assert.strictEqual(engine.zoom, 1.05);
    // World point at the centre (400,300) stays at the centre.
    assert.ok(Math.abs((400 - engine.canvas_x) / engine.zoom - 400) < 1e-6);
    assert.ok(Math.abs((300 - engine.canvas_y) / engine.zoom - 300) < 1e-6);

    const a = engine.addNode('story_node', 1, 1, 0, 0, 'story_node', {}, 'A');
    const b = engine.addNode('story_node', 1, 1, 300, 0, 'story_node', {}, 'B');
    engine.addConnection(a, b);
    const pathEl = engine.precanvas.querySelector('svg.connection').querySelector('.main-path');
    container.dispatchEvent({ type: 'pointerdown', pointerId: 9, pointerType: 'mouse', button: 0, clientX: 0, clientY: 0, target: pathEl });
    assert.strictEqual(engine.connection_selected, pathEl);
    engine.removeSingleConnection(a, b);
    assert.strictEqual(engine.connection_selected, null);
});

test('13. nodeTapped fires only for a press + release without movement', () => {
    const { engine, container, window: win } = createHarness();
    const taps = [];
    engine.on('nodeTapped', (id) => taps.push(id));
    const n = engine.addNode('story_node', 1, 1, 0, 0, 'story_node', {}, 'N');
    const el = engine.precanvas.querySelector('#node-' + n);
    const down = (id) => container.dispatchEvent({ type: 'pointerdown', pointerId: id, pointerType: 'mouse', button: 0, clientX: 10, clientY: 10, target: el });
    down(1);
    win.dispatchEvent({ type: 'pointerup', pointerId: 1, pointerType: 'mouse', clientX: 10, clientY: 10, target: el });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(taps)), [n]);
    down(2);
    win.dispatchEvent({ type: 'pointermove', pointerId: 2, pointerType: 'mouse', buttons: 1, clientX: 40, clientY: 10, target: win });
    win.dispatchEvent({ type: 'pointerup', pointerId: 2, pointerType: 'mouse', clientX: 40, clientY: 10, target: el });
    assert.strictEqual(taps.length, 1, 'a drag is not a tap');
    down(3);
    win.dispatchEvent({ type: 'pointercancel', pointerId: 3, pointerType: 'mouse', clientX: 10, clientY: 10, target: el });
    assert.strictEqual(taps.length, 1, 'a cancelled press is not a tap');
});

test('14. zoomToFit frames every node (never above maxZoom) and centres the bounds', () => {
    const { engine, container } = createHarness();
    container.clientWidth = 1000;
    container.clientHeight = 600;
    engine.addNode('story_node', 1, 1, 0, 0, 'story_node', {}, 'A');
    engine.addNode('story_node', 1, 1, 3000, 1000, 'story_node', {}, 'B');
    assert.strictEqual(engine.zoomToFit({ animate: false }), true);
    // bounds: x 0..3208, y 0..1068 → fit = min(920/3208, 520/1068) ≈ 0.287
    assert.ok(Math.abs(engine.zoom - 0.287) < 0.002, 'zoom ' + engine.zoom);
    const cx = (500 - engine.canvas_x) / engine.zoom;
    const cy = (300 - engine.canvas_y) / engine.zoom;
    assert.ok(Math.abs(cx - 1604) < 1 && Math.abs(cy - 534) < 1, 'centre ' + cx + ',' + cy);

    const { engine: e2, container: c2 } = createHarness();
    c2.clientWidth = 1000;
    c2.clientHeight = 600;
    e2.addNode('story_node', 1, 1, 100, 100, 'story_node', {}, 'Solo');
    e2.zoomToFit({ animate: false });
    assert.strictEqual(e2.zoom, 1, 'a small graph is not zoomed in past 1');
});
