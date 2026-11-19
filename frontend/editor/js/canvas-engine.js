// frontend/editor/js/canvas-engine.js
// Zero-reflow, touch-and-mouse-capable replacement for Drawflow (v0.0.60).
//
// Event contract
// --------------
// Programmatic API calls (addConnection, removeSingleConnection, removeNodeId,
// clear) are SILENT by default: they do not dispatch `connectionCreated`,
// `connectionRemoved` or `nodeRemoved`. Pass `{ notify: true }` as the last
// argument when a call represents a user intent that the app must react to
// (e.g. linking mode, unlinking from the choices list, deleting a node).
// Interactions handled by the engine itself (dragging a link onto a port,
// deleting a selected connection) dispatch `beforeUserEdit` right before the
// mutation (so the app can snapshot undo state) and then notify.
//
// Render hooks that always fire: `nodeCreated`, `nodeResized`, `zoom`,
// `translate`, `mouseMove` (during node drag), `nodeMoved` (drag end),
// `nodeSelected`, `nodeUnselected`, `connectionSelected`, `connectionUnselected`.

const SVG_NS = 'http://www.w3.org/2000/svg';

// Fallback node sizes used until a node has been measured (e.g. while the
// graph tab is hidden). Story nodes: 180 content + 2*12 padding + 2*2 border;
// min-height 40 + 24 + 4. Portal nodes have min-width: 220px.
const DEFAULT_NODE_W = 208;
const DEFAULT_PORTAL_W = 248;
const DEFAULT_NODE_H = 68;
const PORTAL_ROW_TOP = 28;
const PORTAL_ROW_HEIGHT = 29;
const LONG_PRESS_MS = 500;

export class CanvasEngine {
    constructor(container) {
        this.container = container;
        this.precanvas = null;
        this.zoom = 1;
        this.zoom_max = 2.0;
        this.zoom_min = 0.15;
        this.zoom_value = 0.05;
        this.curvature = 0.3;
        this.canvas_x = 0;
        this.canvas_y = 0;
        this.editor_selected = false;
        this.drag = false;
        this.connection = false;
        this.node_selected = null;
        this.connection_selected = null;
        this.ele_selected = null;
        this.nodeIdCounter = 1;
        this.events = {};
        this.module = 'Home';
        this.drawflow = { drawflow: { Home: { data: {} } } };
        this._pointers = new Map();
        this._pinch = null;
        this._longPressTimer = null;
        this._lastPointerType = null;
        this._suppressNativeCtxUntil = 0;
        this._resizeObserver = null;

        this._dragState = null;
        this._panState = null;
        this._connState = null;
        this._pendingDetach = null;
        this._viewAnim = null;
    }

    on(event, callback) {
        if (typeof event !== 'string' || typeof callback !== 'function') return this;
        if (!this.events[event]) this.events[event] = [];
        this.events[event].push(callback);
        return this;
    }

    dispatch(event, details) {
        const listeners = this.events[event];
        if (!listeners) return;
        for (const cb of listeners) {
            cb(details);
        }
    }

    start() {
        if (this.container) {
            if (this.container.classList) this.container.classList.add('parent-drawflow');
            this.container.tabIndex = 0;
        }
        this.precanvas = document.createElement('div');
        if (this.precanvas.classList) this.precanvas.classList.add('drawflow');
        if (this.container) this.container.appendChild(this.precanvas);
        if (typeof ResizeObserver === 'function') {
            this._resizeObserver = new ResizeObserver((entries) => this._onNodesResized(entries));
        }
        this._bindEvents();
    }

    _nodeData(id) {
        return this.drawflow.drawflow.Home.data[id];
    }

    _parseNodeId(id) {
        return typeof id === 'string' ? parseInt(id.replace(/^node-/, ''), 10) : parseInt(id, 10);
    }

    // `title` is rendered as plain text (never parsed as HTML).
    addNode(name, numInputs, numOutputs, posX, posY, className, data, title) {
        const id = this.nodeIdCounter++;
        const px = Number(posX) || 0;
        const py = Number(posY) || 0;
        const nIn = Number(numInputs) || 0;
        const nOut = Number(numOutputs) || 0;

        const inputs = {};
        const outputs = {};

        const nodeEl = document.createElement('div');
        nodeEl.id = 'node-' + id;
        nodeEl.className = className ? 'drawflow-node ' + className : 'drawflow-node';
        nodeEl.setAttribute('data-id', String(id));
        nodeEl.style.top = py + 'px';
        nodeEl.style.left = px + 'px';

        const inputsDiv = document.createElement('div');
        inputsDiv.className = 'inputs';
        for (let i = 1; i <= nIn; i++) {
            const key = 'input_' + i;
            inputs[key] = { connections: [] };
            const inEl = document.createElement('div');
            inEl.className = 'input ' + key;
            inEl.setAttribute('data-input', key);
            inputsDiv.appendChild(inEl);
        }

        const contentEl = document.createElement('div');
        contentEl.className = 'drawflow_content_node';
        contentEl.textContent = title == null ? '' : String(title);

        const outputsDiv = document.createElement('div');
        outputsDiv.className = 'outputs';
        for (let i = 1; i <= nOut; i++) {
            const key = 'output_' + i;
            outputs[key] = { connections: [] };
            const outEl = document.createElement('div');
            outEl.className = 'output ' + key;
            outEl.setAttribute('data-output', key);
            outputsDiv.appendChild(outEl);
        }

        nodeEl.appendChild(inputsDiv);
        nodeEl.appendChild(contentEl);
        nodeEl.appendChild(outputsDiv);

        this.drawflow.drawflow.Home.data[id] = {
            id,
            name,
            data: data || {},
            class: className || '',
            title: title == null ? '' : String(title),
            typenode: false,
            inputs,
            outputs,
            pos_x: px,
            pos_y: py
        };

        if (this.precanvas) this.precanvas.appendChild(nodeEl);
        if (this._resizeObserver) this._resizeObserver.observe(nodeEl);
        this.dispatch('nodeCreated', id);
        return id;
    }

    // Re-measure nodes whose rendered size changed (title wrap, portal rows,
    // tab becoming visible) and re-route their edges. ResizeObserver callbacks
    // run after layout, so reading offset sizes here does not force a reflow.
    _onNodesResized(entries) {
        const changed = [];
        for (const entry of entries) {
            const el = entry.target;
            const id = parseInt(el.getAttribute('data-id'), 10);
            const node = this._nodeData(id);
            if (!node) continue;
            const w = el.offsetWidth;
            const h = el.offsetHeight;
            if (w <= 0 || h <= 0) continue;
            if (node._w === w && node._h === h) continue;
            node._w = w;
            node._h = h;
            changed.push(id);
            this.updateConnectionNodes('node-' + id);
        }
        if (changed.length) this.dispatch('nodeResized', changed);
    }

    createCurvature(start_pos_x, start_pos_y, end_pos_x, end_pos_y, curvature_value, type) {
        const c = curvature_value !== undefined ? curvature_value : this.curvature;
        const hx1 = start_pos_x + Math.abs(end_pos_x - start_pos_x) * c;
        const hx2 = end_pos_x - Math.abs(end_pos_x - start_pos_x) * c;
        return `M ${start_pos_x} ${start_pos_y} C ${hx1} ${start_pos_y} ${hx2} ${end_pos_y} ${end_pos_x} ${end_pos_y}`;
    }

    _isPortalNode(node, nodeEl) {
        return (node && node.class === 'portal_node')
            || !!(nodeEl && nodeEl.classList && nodeEl.classList.contains('node-portal'));
    }

    // Port centre in precanvas (world) coordinates, from node position + size.
    getPortCoords(nodeId, portClass, isOutput) {
        return this._getPortCoords(nodeId, portClass, isOutput);
    }

    _getPortCoords(nodeId, portClass, isOutput) {
        const node = this._nodeData(nodeId);
        if (!node) return { x: 0, y: 0 };

        let nodeEl = null;
        if (!node._w) {
            // One-time measurement (later updates come from ResizeObserver).
            nodeEl = this.precanvas ? this.precanvas.querySelector('#node-' + nodeId) : null;
            if (nodeEl && nodeEl.offsetWidth > 0) {
                node._w = nodeEl.offsetWidth;
                node._h = nodeEl.offsetHeight;
            }
        }
        const isPortal = this._isPortalNode(node, nodeEl);
        const w = node._w || (isPortal ? DEFAULT_PORTAL_W : DEFAULT_NODE_W);
        const h = node._h || DEFAULT_NODE_H;

        const m = String(portClass).match(/_(\d+)$/);
        const idx = m ? parseInt(m[1], 10) - 1 : 0;

        const offsetY = isPortal ? PORTAL_ROW_TOP + idx * PORTAL_ROW_HEIGHT : h / 2;

        return {
            x: isOutput ? node.pos_x + w : node.pos_x,
            y: node.pos_y + offsetY
        };
    }

    _createSvgElement(tag) {
        return (typeof document.createElementNS === 'function')
            ? document.createElementNS(SVG_NS, tag)
            : document.createElement(tag);
    }

    hasConnection(idOutput, idInput, outputClass = 'output_1', inputClass = 'input_1') {
        const srcNode = this._nodeData(parseInt(idOutput, 10));
        if (!srcNode || !srcNode.outputs[outputClass]) return false;
        const tgt = String(parseInt(idInput, 10));
        return srcNode.outputs[outputClass].connections.some((c) => c.node === tgt && c.output === inputClass);
    }

    // Returns true when a new connection was created.
    addConnection(idOutput, idInput, outputClass = 'output_1', inputClass = 'input_1', options = {}) {
        const srcId = parseInt(idOutput, 10);
        const tgtId = parseInt(idInput, 10);
        const srcNode = this._nodeData(srcId);
        const tgtNode = this._nodeData(tgtId);
        if (!srcNode || !tgtNode) return false;

        if (!srcNode.outputs[outputClass]) srcNode.outputs[outputClass] = { connections: [] };
        if (!tgtNode.inputs[inputClass]) tgtNode.inputs[inputClass] = { connections: [] };

        if (this.hasConnection(srcId, tgtId, outputClass, inputClass)) return false;

        srcNode.outputs[outputClass].connections.push({ node: String(tgtId), output: inputClass });
        tgtNode.inputs[inputClass].connections.push({ node: String(srcId), input: outputClass });

        const svg = this._createSvgElement('svg');
        const cls = `connection node_in_node-${tgtId} node_out_node-${srcId} ${outputClass} ${inputClass}`;
        svg.setAttribute('class', cls);
        svg.style.position = 'absolute';
        svg.style.left = '0px';
        svg.style.top = '0px';
        svg.style.overflow = 'visible';
        svg.style.pointerEvents = 'none';

        const hitPath = this._createSvgElement('path');
        hitPath.setAttribute('class', 'hit-path');
        hitPath.setAttribute('d', '');
        svg.appendChild(hitPath);

        const mainPath = this._createSvgElement('path');
        mainPath.setAttribute('class', 'main-path');
        mainPath.setAttribute('d', '');
        svg.appendChild(mainPath);

        if (this.precanvas) this.precanvas.appendChild(svg);
        this.updateConnectionNodes('node-' + srcId);
        if (options && options.notify) {
            this.dispatch('connectionCreated', {
                output_id: srcId,
                input_id: tgtId,
                output_class: outputClass,
                input_class: inputClass
            });
        }
        return true;
    }

    _parseConnectionSvg(svg) {
        const cls = (svg && svg.className && svg.className.baseVal)
            || (svg && typeof svg.getAttribute === 'function' && svg.getAttribute('class'))
            || (svg && typeof svg.className === 'string' ? svg.className : '')
            || '';
        const outMatch = cls.match(/node_out_node-(\d+)/);
        const inMatch = cls.match(/node_in_node-(\d+)/);
        const output_class = (cls.match(/\b(output_\d+)\b/) || [, 'output_1'])[1];
        const input_class = (cls.match(/\b(input_\d+)\b/) || [, 'input_1'])[1];
        return {
            output_id: outMatch ? parseInt(outMatch[1], 10) : null,
            input_id: inMatch ? parseInt(inMatch[1], 10) : null,
            output_class,
            input_class
        };
    }

    // Public: route any `<svg>` containing `.main-path` (and optional
    // `.hit-path`) between two world-space points. Used for portal lines too.
    positionConnectionSvg(svg, p1, p2) {
        this._positionConnectionSvg(svg, p1, p2);
    }

    _positionConnectionSvg(svg, p1, p2) {
        const c = this.curvature;
        const hx1 = p1.x + Math.abs(p2.x - p1.x) * c;
        const hx2 = p2.x - Math.abs(p2.x - p1.x) * c;
        const x0 = p1.x;
        const x1 = hx1;
        const x2 = hx2;
        const x3 = p2.x;
        const a = 3 * (-x0 + 3 * x1 - 3 * x2 + x3);
        const b = 6 * (x0 - 2 * x1 + x2);
        const k = 3 * (x1 - x0);
        const candidates = [x0, x3];
        const pushIfValid = (t) => {
            if (t > 0 && t < 1) {
                const mt = 1 - t;
                candidates.push(
                    mt * mt * mt * x0 +
                    3 * mt * mt * t * x1 +
                    3 * mt * t * t * x2 +
                    t * t * t * x3
                );
            }
        };
        if (Math.abs(a) < 1e-9) {
            if (Math.abs(b) > 1e-9) {
                pushIfValid(-k / b);
            }
        } else {
            const disc = b * b - 4 * a * k;
            if (disc >= 0) {
                const sqrtDisc = Math.sqrt(disc);
                pushIfValid((-b + sqrtDisc) / (2 * a));
                pushIfValid((-b - sqrtDisc) / (2 * a));
            }
        }
        const pad = 12;
        const minX = Math.min(...candidates) - pad;
        const minY = Math.min(p1.y, p2.y) - pad;
        const maxX = Math.max(...candidates) + pad;
        const maxY = Math.max(p1.y, p2.y) + pad;
        svg.style.left = minX + 'px';
        svg.style.top = minY + 'px';
        svg.style.width = Math.max(1, maxX - minX) + 'px';
        svg.style.height = Math.max(1, maxY - minY) + 'px';
        const d = this.createCurvature(p1.x - minX, p1.y - minY, p2.x - minX, p2.y - minY, c, 'openclose');
        const hit = svg.querySelector('.hit-path');
        const main = svg.querySelector('.main-path');
        if (hit) hit.setAttribute('d', d);
        if (main) main.setAttribute('d', d);
    }

    updateConnectionNodes(id) {
        const nodeId = this._parseNodeId(id);
        if (!this.precanvas || isNaN(nodeId)) return;

        const svgs = this.precanvas.querySelectorAll(
            'svg.connection.node_out_node-' + nodeId + ', svg.connection.node_in_node-' + nodeId
        );
        for (const svg of svgs) {
            const { output_id, input_id, output_class, input_class } = this._parseConnectionSvg(svg);
            if (output_id === null || input_id === null) continue;

            const p1 = this._getPortCoords(output_id, output_class, true);
            const p2 = this._getPortCoords(input_id, input_class, false);
            this._positionConnectionSvg(svg, p1, p2);
        }
    }

    removeSingleConnection(idOutput, idInput, outputClass = 'output_1', inputClass = 'input_1', options = {}) {
        const srcId = parseInt(idOutput, 10);
        const tgtId = parseInt(idInput, 10);
        const srcNode = this._nodeData(srcId);
        const tgtNode = this._nodeData(tgtId);

        let removed = false;
        if (srcNode && srcNode.outputs && srcNode.outputs[outputClass]) {
            const conns = srcNode.outputs[outputClass].connections;
            const idx = conns.findIndex((c) => c.node === String(tgtId) && c.output === inputClass);
            if (idx !== -1) {
                conns.splice(idx, 1);
                removed = true;
            }
        }
        if (tgtNode && tgtNode.inputs && tgtNode.inputs[inputClass]) {
            const conns = tgtNode.inputs[inputClass].connections;
            const idx = conns.findIndex((c) => c.node === String(srcId) && c.input === outputClass);
            if (idx !== -1) {
                conns.splice(idx, 1);
                removed = true;
            }
        }

        if (this.precanvas) {
            const svg = this.precanvas.querySelector(
                `svg.connection.node_in_node-${tgtId}.node_out_node-${srcId}.${outputClass}.${inputClass}`
            );
            if (svg) {
                // Never leave a selection pointing at a detached path.
                if (this.connection_selected && this.connection_selected.parentElement === svg) {
                    this._clearConnectionSelection();
                }
                if (svg.parentNode) svg.parentNode.removeChild(svg);
            }
        }

        if (removed && options && options.notify) {
            this.dispatch('connectionRemoved', {
                output_id: srcId,
                input_id: tgtId,
                output_class: outputClass,
                input_class: inputClass
            });
        }
        return removed;
    }

    // Silently removes every connection attached to a node.
    removeConnectionNodeId(id) {
        const nodeId = this._parseNodeId(id);
        if (isNaN(nodeId)) return;
        const node = this._nodeData(nodeId);
        if (!node) return;

        const toRemove = [];
        if (node.outputs) {
            for (const [outClass, outObj] of Object.entries(node.outputs)) {
                for (const c of (outObj && outObj.connections) || []) {
                    toRemove.push([nodeId, parseInt(c.node, 10), outClass, c.output || 'input_1']);
                }
            }
        }
        if (node.inputs) {
            for (const [inClass, inObj] of Object.entries(node.inputs)) {
                for (const c of (inObj && inObj.connections) || []) {
                    toRemove.push([parseInt(c.node, 10), nodeId, c.input || 'output_1', inClass]);
                }
            }
        }
        for (const [srcId, tgtId, outClass, inClass] of toRemove) {
            this.removeSingleConnection(srcId, tgtId, outClass, inClass);
        }
    }

    removeNodeId(id, options = {}) {
        const nodeId = this._parseNodeId(id);
        if (isNaN(nodeId) || !this._nodeData(nodeId)) return;

        this.removeConnectionNodeId(nodeId);

        const el = (this.precanvas && this.precanvas.querySelector('#node-' + nodeId))
            || (typeof document !== 'undefined' && document.getElementById ? document.getElementById('node-' + nodeId) : null);
        if (el) {
            if (this._resizeObserver) this._resizeObserver.unobserve(el);
            if (el.parentNode) el.parentNode.removeChild(el);
        }

        if (this.node_selected && this.node_selected.id === 'node-' + nodeId) {
            this.node_selected = null;
        }
        if (this._dragState && this._dragState.nodeId === nodeId) {
            this.drag = false;
            this._dragState = null;
        }
        delete this.drawflow.drawflow.Home.data[nodeId];
        if (options && options.notify) this.dispatch('nodeRemoved', nodeId);
    }

    _applyTransform() {
        if (this.precanvas) {
            this.precanvas.style.transform = 'translate(' + this.canvas_x + 'px, ' + this.canvas_y + 'px) scale(' + this.zoom + ')';
        }
    }

    _clampZoom(z) {
        const n = Number(Number(z).toFixed(3));
        return Math.max(this.zoom_min, Math.min(this.zoom_max, isNaN(n) ? 1 : n));
    }

    zoom_refresh() {
        this.zoom = this._clampZoom(this.zoom);
        this._applyTransform();
        this.dispatch('zoom', this.zoom);
    }

    _containerOrigin() {
        if (this.container && typeof this.container.getBoundingClientRect === 'function') {
            const r = this.container.getBoundingClientRect();
            return { left: r.left, top: r.top };
        }
        return { left: 0, top: 0 };
    }

    _containerCenter() {
        const w = this.container && Number(this.container.clientWidth);
        const h = this.container && Number(this.container.clientHeight);
        return { x: w > 0 ? w / 2 : 0, y: h > 0 ? h / 2 : 0 };
    }

    // Zoom keeping the container-local point (px, py) fixed on screen.
    // Without an anchor, zoom around the visible centre of the canvas.
    zoomTo(newZoom, px, py) {
        if (px === undefined || py === undefined) {
            const c = this._containerCenter();
            px = c.x;
            py = c.y;
        }
        const oldZoom = this.zoom || 1;
        const z = this._clampZoom(newZoom);
        const worldX = (px - this.canvas_x) / oldZoom;
        const worldY = (py - this.canvas_y) / oldZoom;
        this.zoom = z;
        this.canvas_x = px - worldX * z;
        this.canvas_y = py - worldY * z;
        this._applyTransform();
        this.dispatch('zoom', this.zoom);
    }

    zoom_in() {
        this.zoomTo(this.zoom + this.zoom_value);
    }

    zoom_out() {
        this.zoomTo(this.zoom - this.zoom_value);
    }

    zoom_reset() {
        this.zoomTo(1);
    }

    _cancelViewAnimation() {
        if (this._viewAnim) {
            if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this._viewAnim);
            this._viewAnim = null;
        }
    }

    // Move the viewport so world point (wx, wy) sits at the container centre.
    // options: { zoom, animate (default true), duration (ms, default 280) }.
    // Animation is skipped for prefers-reduced-motion and cancelled by any
    // user pan/zoom.
    centerOn(wx, wy, options = {}) {
        const w = this.container && Number(this.container.clientWidth);
        const h = this.container && Number(this.container.clientHeight);
        if (!(w > 0) || !(h > 0)) return false;
        this._cancelViewAnimation();
        const z1 = options.zoom !== undefined ? this._clampZoom(options.zoom) : this.zoom;
        const x1 = w / 2 - wx * z1;
        const y1 = h / 2 - wy * z1;
        const reduceMotion = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
            && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const animate = options.animate !== false && !reduceMotion && typeof requestAnimationFrame === 'function';
        const finish = () => {
            const zoomChanged = this.zoom !== z1;
            this.zoom = z1;
            this.canvas_x = x1;
            this.canvas_y = y1;
            this._applyTransform();
            if (zoomChanged) this.dispatch('zoom', this.zoom);
            this.dispatch('translate', { x: this.canvas_x, y: this.canvas_y });
        };
        if (!animate) { finish(); return true; }
        const x0 = this.canvas_x, y0 = this.canvas_y, z0 = this.zoom;
        const duration = options.duration || 280;
        let start = null;
        const step = (t) => {
            if (start === null) start = t;
            const k = Math.min(1, (t - start) / duration);
            const e = 1 - Math.pow(1 - k, 3); // easeOutCubic
            if (k >= 1) { this._viewAnim = null; finish(); return; }
            this.zoom = z0 + (z1 - z0) * e;
            this.canvas_x = x0 + (x1 - x0) * e;
            this.canvas_y = y0 + (y1 - y0) * e;
            this._applyTransform();
            this._viewAnim = requestAnimationFrame(step);
        };
        this._viewAnim = requestAnimationFrame(step);
        return true;
    }

    // Centre the viewport on a node. options.minZoom zooms in to at least
    // that level so the node is readable; other options go to centerOn().
    focusNode(id, options = {}) {
        const nodeId = this._parseNodeId(id);
        const node = this._nodeData(nodeId);
        if (!node) return false;
        const isPortal = this._isPortalNode(node, null);
        const w = node._w || (isPortal ? DEFAULT_PORTAL_W : DEFAULT_NODE_W);
        const h = node._h || DEFAULT_NODE_H;
        const zoom = options.minZoom !== undefined ? Math.max(this.zoom, options.minZoom) : options.zoom;
        return this.centerOn(node.pos_x + w / 2, node.pos_y + h / 2, Object.assign({}, options, { zoom }));
    }

    // Fit every node into the viewport (never zooming in past `maxZoom`,
    // default 1). Empty canvas → reset to the origin at the current zoom.
    zoomToFit(options = {}) {
        const pad = options.padding !== undefined ? options.padding : 40;
        const maxZoom = options.maxZoom !== undefined ? options.maxZoom : 1;
        const w = this.container && Number(this.container.clientWidth);
        const h = this.container && Number(this.container.clientHeight);
        if (!(w > 0) || !(h > 0)) return false;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const node of Object.values(this.drawflow.drawflow.Home.data)) {
            const isPortal = this._isPortalNode(node, null);
            const nw = node._w || (isPortal ? DEFAULT_PORTAL_W : DEFAULT_NODE_W);
            const nh = node._h || DEFAULT_NODE_H;
            minX = Math.min(minX, node.pos_x);
            minY = Math.min(minY, node.pos_y);
            maxX = Math.max(maxX, node.pos_x + nw);
            maxY = Math.max(maxY, node.pos_y + nh);
        }
        if (minX === Infinity) {
            return this.centerOn(w / 2 / this.zoom, h / 2 / this.zoom, options);
        }
        const bw = Math.max(1, maxX - minX);
        const bh = Math.max(1, maxY - minY);
        const fit = Math.min((w - 2 * pad) / bw, (h - 2 * pad) / bh);
        const zoom = this._clampZoom(Math.min(maxZoom, fit > 0 ? fit : this.zoom_min));
        return this.centerOn(minX + bw / 2, minY + bh / 2, Object.assign({}, options, { zoom }));
    }

    // Programmatically select a node as if the user clicked it
    // (dispatches nodeUnselected for the previous one, then nodeSelected).
    selectNode(id) {
        const nodeId = this._parseNodeId(id);
        const nodeEl = this.precanvas ? this.precanvas.querySelector('#node-' + nodeId) : null;
        if (!nodeEl || !this._nodeData(nodeId)) return false;
        this._clearConnectionSelection();
        if (this.node_selected && this.node_selected !== nodeEl) {
            this.node_selected.classList.remove('selected');
            this.dispatch('nodeUnselected', true);
        }
        this.node_selected = nodeEl;
        nodeEl.classList.add('selected');
        this.dispatch('nodeSelected', String(nodeId));
        return true;
    }

    panBy(dx, dy) {
        this.canvas_x += dx;
        this.canvas_y += dy;
        this._applyTransform();
        this.dispatch('translate', { x: this.canvas_x, y: this.canvas_y });
    }

    clear() {
        if (this._resizeObserver) this._resizeObserver.disconnect();
        this._clearLongPress();
        this._cancelTempConnection();
        this._pendingDetach = null;
        if (this.precanvas) this.precanvas.innerHTML = '';
        this.drawflow.drawflow.Home.data = {};
        this.node_selected = null;
        this.connection_selected = null;
        this.drag = false;
        this._dragState = null;
        this._panState = null;
        this.editor_selected = false;
    }

    _clearConnectionSelection() {
        if (this.connection_selected) {
            if (this.connection_selected.classList) {
                this.connection_selected.classList.remove('selected');
            }
            this.connection_selected = null;
            this.dispatch('connectionUnselected', true);
        }
    }

    // Silently drop node + connection selection (e.g. on Escape).
    clearSelection() {
        if (this.node_selected) {
            if (this.node_selected.classList) this.node_selected.classList.remove('selected');
            this.node_selected = null;
        }
        if (this.connection_selected) {
            if (this.connection_selected.classList) this.connection_selected.classList.remove('selected');
            this.connection_selected = null;
        }
    }

    // User intent: delete the currently selected connection.
    removeConnection() {
        if (!this.connection_selected) return false;
        const { output_id, input_id, output_class, input_class } = this._parseConnectionSvg(this.connection_selected.parentElement);
        this._clearConnectionSelection();
        if (output_id !== null && input_id !== null && this.hasConnection(output_id, input_id, output_class, input_class)) {
            this.dispatch('beforeUserEdit', { type: 'connectionRemove' });
            return this.removeSingleConnection(output_id, input_id, output_class, input_class, { notify: true });
        }
        return false;
    }

    _clearLongPress() {
        if (this._longPressTimer) {
            clearTimeout(this._longPressTimer);
            this._longPressTimer = null;
        }
    }

    _startLongPress(targetEl, clientX, clientY) {
        this._clearLongPress();
        this._longPressTimer = setTimeout(() => {
            this._longPressTimer = null;
            this.drag = false;
            this._dragState = null;
            // Swallow the browser's own long-press contextmenu that may follow.
            this._suppressNativeCtxUntil = Date.now() + 1000;
            const evt = new MouseEvent('contextmenu', {
                bubbles: true,
                cancelable: true,
                clientX,
                clientY
            });
            targetEl.dispatchEvent(evt);
        }, LONG_PRESS_MS);
    }

    // Start drawing a temporary link from (srcId, outClass) that follows the
    // pointer. `extra` is merged into _connState (e.g. `detachedFrom`).
    _beginTempConnection(srcId, outClass, extra) {
        const p1 = this._getPortCoords(srcId, outClass, true);
        const svg = this._createSvgElement('svg');
        svg.setAttribute('class', 'connection temp-connection');
        svg.style.position = 'absolute';
        svg.style.left = '0px';
        svg.style.top = '0px';
        svg.style.overflow = 'visible';
        svg.style.pointerEvents = 'none';
        const path = this._createSvgElement('path');
        path.setAttribute('class', 'main-path');
        path.setAttribute('d', '');
        path.style.pointerEvents = 'none';
        svg.appendChild(path);
        this._positionConnectionSvg(svg, p1, p1);
        if (this.precanvas) this.precanvas.appendChild(svg);

        this.connection = true;
        this._connState = Object.assign({
            srcId,
            outClass,
            p1,
            origin: this._containerOrigin(),
            svg,
            path
        }, extra || {});
    }

    _updateTempConnection(clientX, clientY) {
        if (!this._connState) return;
        const { origin, p1 } = this._connState;
        const endX = (clientX - origin.left - this.canvas_x) / this.zoom;
        const endY = (clientY - origin.top - this.canvas_y) / this.zoom;
        this._positionConnectionSvg(this._connState.svg, p1, { x: endX, y: endY });
    }

    // "Unplug" the most recent link on an input port: the edge is removed
    // silently (after `beforeUserEdit`, so undo sees the pre-move state) and
    // its source end keeps following the pointer as a temp connection.
    _startDetach(e) {
        const pd = this._pendingDetach;
        this._pendingDetach = null;
        if (!pd || !this.hasConnection(pd.srcId, pd.tgtId, pd.outClass, pd.inClass)) return false;
        this._clearLongPress();
        this.drag = false;
        this._dragState = null;
        this.dispatch('beforeUserEdit', { type: 'connectionDetach' });
        this.removeSingleConnection(pd.srcId, pd.tgtId, pd.outClass, pd.inClass);
        this._beginTempConnection(pd.srcId, pd.outClass, {
            detachedFrom: { input_id: pd.tgtId, input_class: pd.inClass }
        });
        this._updateTempConnection(e.clientX, e.clientY);
        return true;
    }

    // Abort an in-progress drag; an unplugged link is put back where it was.
    _abortTempConnection() {
        const cs = this._connState;
        if (cs && cs.detachedFrom) {
            this.addConnection(cs.srcId, cs.detachedFrom.input_id, cs.outClass, cs.detachedFrom.input_class);
        }
        this._cancelTempConnection();
    }

    _cancelTempConnection() {
        if (this._connState && this._connState.svg && this._connState.svg.parentNode) {
            this._connState.svg.parentNode.removeChild(this._connState.svg);
        }
        this.connection = false;
        this._connState = null;
    }

    _pinchMetrics() {
        const pts = Array.from(this._pointers.values());
        if (pts.length < 2) return null;
        return {
            dist: Math.hypot(pts[0].clientX - pts[1].clientX, pts[0].clientY - pts[1].clientY),
            midX: (pts[0].clientX + pts[1].clientX) / 2,
            midY: (pts[0].clientY + pts[1].clientY) / 2
        };
    }

    // Where a dragged link was released: { tgtId, inClass } (inClass null when
    // the drop does not name a port, e.g. a portal body or empty canvas).
    _resolveDropTarget(e) {
        const dropTarget = (typeof document.elementFromPoint === 'function'
            ? document.elementFromPoint(e.clientX, e.clientY)
            : null) || e.target;
        const normalizedTarget = (dropTarget && dropTarget.nodeType === 3) ? dropTarget.parentElement : dropTarget;
        const inputEl = normalizedTarget && normalizedTarget.closest ? normalizedTarget.closest('.input') : null;
        const targetNodeEl = normalizedTarget && normalizedTarget.closest ? normalizedTarget.closest('.drawflow-node') : null;
        const nodeEl = inputEl ? inputEl.closest('.drawflow-node') : targetNodeEl;
        const tgtId = nodeEl ? parseInt(nodeEl.getAttribute('data-id'), 10) : NaN;
        let inClass = null;
        if (!isNaN(tgtId)) {
            if (inputEl) {
                inClass = inputEl.getAttribute('data-input')
                    || (Array.from(inputEl.classList).find((c) => /^input_\d+$/.test(c)) || 'input_1');
            } else if (!this._isPortalNode(this._nodeData(tgtId), nodeEl)) {
                // Dropping on a story node's body links to its only input.
                // Portals need an explicit slug row, so a body drop is ignored.
                inClass = 'input_1';
            }
        }
        return { tgtId, inClass };
    }

    // Release of an unplugged link (undo snapshot was taken at detach time):
    //  - cancelled / dropped back on its old port -> restored silently
    //  - dropped on another port -> re-plugged there, `connectionRewired`
    //  - dropped on a port it already links to, or on nothing -> `connectionRemoved`
    _finishDetach(e, isCancel) {
        const cs = this._connState;
        const from = cs.detachedFrom;
        const oldEdge = {
            output_id: cs.srcId,
            input_id: from.input_id,
            output_class: cs.outClass,
            input_class: from.input_class
        };
        if (isCancel) {
            this._abortTempConnection();
            return;
        }
        const { tgtId, inClass } = this._resolveDropTarget(e);
        this._cancelTempConnection();
        const valid = !isNaN(tgtId) && tgtId !== cs.srcId && !!inClass && !!this._nodeData(tgtId);
        if (valid && tgtId === from.input_id && inClass === from.input_class) {
            this.addConnection(cs.srcId, tgtId, cs.outClass, inClass);
        } else if (valid && !this.hasConnection(cs.srcId, tgtId, cs.outClass, inClass)) {
            this.addConnection(cs.srcId, tgtId, cs.outClass, inClass);
            this.dispatch('connectionRewired', {
                output_id: cs.srcId,
                output_class: cs.outClass,
                from: { input_id: from.input_id, input_class: from.input_class },
                to: { input_id: tgtId, input_class: inClass }
            });
        } else {
            this.dispatch('connectionRemoved', oldEdge);
        }
    }

    _bindEvents() {
        if (!this.container || typeof this.container.addEventListener !== 'function') return;

        const handlePointerEnd = (e, isCancel) => {
            this._pointers.delete(e.pointerId);
            if (this._pointers.size < 2) this._pinch = null;
            this._clearLongPress();

            this._pendingDetach = null;

            if (this.connection && this._connState && this._connState.detachedFrom) {
                this._finishDetach(e, isCancel);
            } else if (this.connection && this._connState) {
                const connState = this._connState;
                if (!isCancel) {
                    const { tgtId, inClass } = this._resolveDropTarget(e);
                    if (!isNaN(tgtId) && tgtId !== connState.srcId) {
                        if (inClass && this.hasConnection(connState.srcId, tgtId, connState.outClass, inClass)) {
                            // Dragging onto an already-linked port toggles the link off.
                            this.dispatch('beforeUserEdit', { type: 'connectionRemove' });
                            this.removeSingleConnection(connState.srcId, tgtId, connState.outClass, inClass, { notify: true });
                        } else if (inClass) {
                            this.dispatch('beforeUserEdit', { type: 'connectionCreate' });
                            this.addConnection(connState.srcId, tgtId, connState.outClass, inClass, { notify: true });
                        }
                    }
                }
                this._cancelTempConnection();
            }

            if (this.drag && this._dragState) {
                if (this._dragState.moved) {
                    this.dispatch('nodeMoved', this._dragState.nodeId);
                } else if (!isCancel) {
                    // Pressed and released without moving (and no long-press).
                    this.dispatch('nodeTapped', this._dragState.nodeId);
                }
            }
            this.drag = false;
            this._dragState = null;
            this.editor_selected = false;
            this._panState = null;
        };

        this.container.addEventListener('pointerdown', (e) => {
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            this._lastPointerType = e.pointerType;
            this._cancelViewAnimation();

            const target = (e.target && e.target.nodeType === 3) ? e.target.parentElement : e.target;
            if (target && target.closest && target.closest('button, input, select, textarea, .node-overlay, .portal-actions, .node-collapse-btn, #canvas-zoom-controls')) {
                return;
            }

            // A mouse is a single pointer: drop stale entries whose pointerup was
            // lost (e.g. released outside the window) so they can't fake a pinch.
            if (e.pointerType === 'mouse') {
                for (const [id, p] of this._pointers) {
                    if (p.pointerType === 'mouse' && id !== e.pointerId) this._pointers.delete(id);
                }
            }
            this._pointers.set(e.pointerId, {
                clientX: e.clientX,
                clientY: e.clientY,
                pointerType: e.pointerType
            });

            if (this._pointers.size >= 2) {
                this._clearLongPress();
                this.drag = false;
                this._dragState = null;
                this.editor_selected = false;
                this._panState = null;
                this._pendingDetach = null;
                this._abortTempConnection();
                if (this._pointers.size === 2) {
                    const m = this._pinchMetrics();
                    this._pinch = m ? { origin: this._containerOrigin(), prev: m } : null;
                }
                return;
            }

            const outputEl = target && target.closest ? target.closest('.output') : null;
            const outputNodeEl = outputEl ? outputEl.closest('.drawflow-node') : null;
            const outputSrcId = outputNodeEl ? parseInt(outputNodeEl.getAttribute('data-id'), 10) : NaN;
            // Portal outputs are read-only (cross-group lines), so no link drag.
            if (outputEl && !isNaN(outputSrcId) && !this._isPortalNode(this._nodeData(outputSrcId), outputNodeEl)) {
                const srcId = outputSrcId;
                const outClass = outputEl.getAttribute('data-output')
                    || (Array.from(outputEl.classList).find((c) => /^output_\d+$/.test(c)) || 'output_1');
                this._beginTempConnection(srcId, outClass);
                return;
            }

            const hitEl = target && target.closest
                ? target.closest('.main-path, .hit-path')
                : (target && target.classList && (target.classList.contains('main-path') || target.classList.contains('hit-path')) ? target : null);
            const hitSvg = hitEl ? hitEl.parentElement : null;
            const isEngineEdge = !!(hitSvg && hitSvg.classList && !hitSvg.classList.contains('portal-output')
                && this._parseConnectionSvg(hitSvg).output_id !== null);
            if (hitEl && isEngineEdge) {
                const pathEl = hitSvg.querySelector('.main-path') || hitEl;
                if (this.node_selected) {
                    this.node_selected.classList.remove('selected');
                    this.node_selected = null;
                    this.dispatch('nodeUnselected', true);
                }
                if (this.connection_selected && this.connection_selected !== pathEl) {
                    this._clearConnectionSelection();
                }
                this.connection_selected = pathEl;
                if (pathEl.classList) pathEl.classList.add('selected');
                this.dispatch('connectionSelected', this._parseConnectionSvg(hitSvg));
                if (typeof this.container.focus === 'function') {
                    this.container.focus({ preventScroll: true });
                }
                if (e.pointerType === 'touch') {
                    // Long-press on an edge opens its context menu (Unlink).
                    this._startLongPress(pathEl, e.clientX, e.clientY);
                }
                return;
            }

            // Pressing a linked input arms "unplug": if the pointer then moves,
            // the most recent link on that port is detached and dragged.
            this._pendingDetach = null;
            const inputPortEl = target && target.closest ? target.closest('.input') : null;
            if (inputPortEl) {
                const inNodeEl = inputPortEl.closest('.drawflow-node');
                const inNodeId = inNodeEl ? parseInt(inNodeEl.getAttribute('data-id'), 10) : NaN;
                const inClass = inputPortEl.getAttribute('data-input')
                    || (Array.from(inputPortEl.classList).find((c) => /^input_\d+$/.test(c)) || 'input_1');
                const inNode = this._nodeData(inNodeId);
                const conns = inNode && inNode.inputs[inClass] ? inNode.inputs[inClass].connections : [];
                if (conns.length) {
                    const last = conns[conns.length - 1];
                    this._pendingDetach = {
                        tgtId: inNodeId,
                        inClass,
                        srcId: parseInt(last.node, 10),
                        outClass: last.input || 'output_1',
                        startX: e.clientX,
                        startY: e.clientY
                    };
                }
            }

            const nodeEl = target && target.closest ? target.closest('.drawflow-node') : null;
            if (nodeEl) {
                this._clearConnectionSelection();
                const nodeId = parseInt(nodeEl.getAttribute('data-id'), 10);
                if (this.node_selected && this.node_selected !== nodeEl) {
                    this.node_selected.classList.remove('selected');
                    this.dispatch('nodeUnselected', true);
                }
                this.node_selected = nodeEl;
                nodeEl.classList.add('selected');
                this.dispatch('nodeSelected', String(nodeId));

                const nodeData = this._nodeData(nodeId);
                this.drag = true;
                this._dragState = {
                    nodeId,
                    nodeEl,
                    startX: e.clientX,
                    startY: e.clientY,
                    startPosX: nodeData ? nodeData.pos_x : 0,
                    startPosY: nodeData ? nodeData.pos_y : 0,
                    moved: false
                };

                if (e.pointerType === 'touch') {
                    this._startLongPress(nodeEl, e.clientX, e.clientY);
                } else {
                    this._clearLongPress();
                }
                return;
            }

            // Empty canvas / precanvas / svg
            this._clearConnectionSelection();
            if (this.node_selected) {
                this.node_selected.classList.remove('selected');
                this.node_selected = null;
                this.dispatch('nodeUnselected', true);
            }
            this.editor_selected = true;
            this._panState = {
                startX: e.clientX,
                startY: e.clientY,
                startCanvasX: this.canvas_x,
                startCanvasY: this.canvas_y
            };
        });

        const handlePointerMove = (e) => {
            if (e.__nfHandled) return;
            e.__nfHandled = true;
            const active = this.editor_selected || this.drag || this.connection || this._pointers.size > 0;
            if (!active) return;

            if (e.pointerType === 'mouse' && e.buttons !== undefined && (e.buttons & 1) === 0 && (this.editor_selected || this.drag || this.connection)) {
                handlePointerEnd(e, true);
                return;
            }

            if (this._pointers.has(e.pointerId)) {
                this._pointers.set(e.pointerId, {
                    clientX: e.clientX,
                    clientY: e.clientY,
                    pointerType: e.pointerType
                });
            }

            if (this._pointers.size === 2) {
                this._clearLongPress();
                this.drag = false;
                const m = this._pinchMetrics();
                if (m && this._pinch && this._pinch.prev.dist > 0 && m.dist > 0) {
                    const { origin, prev } = this._pinch;
                    // Zoom anchored at the finger midpoint, then follow the midpoint (2-finger pan).
                    this.zoomTo(this.zoom * (m.dist / prev.dist), prev.midX - origin.left, prev.midY - origin.top);
                    this.panBy(m.midX - prev.midX, m.midY - prev.midY);
                }
                if (m && this._pinch) this._pinch.prev = m;
                return;
            }

            if (this._pendingDetach && this._pointers.has(e.pointerId)) {
                const pd = this._pendingDetach;
                // Small movements keep it a click (selection / linking-mode target).
                if (Math.hypot(e.clientX - pd.startX, e.clientY - pd.startY) <= 6) return;
                if (this._startDetach(e)) return;
            }

            if (this.connection && this._connState) {
                this._updateTempConnection(e.clientX, e.clientY);
                return;
            }

            if (this.drag && this._dragState) {
                const dx = e.clientX - this._dragState.startX;
                const dy = e.clientY - this._dragState.startY;
                if (this._longPressTimer) {
                    if (Math.hypot(dx, dy) <= 8) return; // finger jitter while waiting for long-press
                    this._clearLongPress();
                }
                const { nodeId, nodeEl, startPosX, startPosY } = this._dragState;
                const node = this._nodeData(nodeId);
                if (node) {
                    node.pos_x = startPosX + dx / this.zoom;
                    node.pos_y = startPosY + dy / this.zoom;
                    nodeEl.style.left = node.pos_x + 'px';
                    nodeEl.style.top = node.pos_y + 'px';
                    if (dx !== 0 || dy !== 0) this._dragState.moved = true;
                    this.updateConnectionNodes('node-' + nodeId);
                    this.dispatch('mouseMove', { x: e.clientX, y: e.clientY });
                }
                return;
            }

            if (this.editor_selected && this._panState) {
                if (this._longPressTimer) this._clearLongPress();
                this.canvas_x = this._panState.startCanvasX + (e.clientX - this._panState.startX);
                this.canvas_y = this._panState.startCanvasY + (e.clientY - this._panState.startY);
                this._applyTransform();
                this.dispatch('translate', { x: this.canvas_x, y: this.canvas_y });
            }
        };

        // Moves are tracked on the container and on window, so drags/pans keep
        // following the pointer after it leaves the canvas (no pointer capture,
        // which would retarget `click` away from nodes and break linking mode).
        this.container.addEventListener('pointermove', handlePointerMove);
        const releaseTarget = (typeof window !== 'undefined' && window.addEventListener) ? window : this.container;
        if (releaseTarget !== this.container) releaseTarget.addEventListener('pointermove', handlePointerMove);
        releaseTarget.addEventListener('pointerup', (e) => handlePointerEnd(e, false));
        releaseTarget.addEventListener('pointercancel', (e) => handlePointerEnd(e, true));

        // Ctrl/Cmd + wheel (and trackpad pinch, which browsers report as
        // ctrl+wheel) zooms at the cursor; plain wheel / two-finger scroll pans.
        this.container.addEventListener('wheel', (e) => {
            if (typeof e.preventDefault === 'function') e.preventDefault();
            this._cancelViewAnimation();
            const unit = e.deltaMode === 1 ? 16 : (e.deltaMode === 2 ? 800 : 1);
            const dy = (Number(e.deltaY) || 0) * unit;
            const dx = (Number(e.deltaX) || 0) * unit;
            if (e.ctrlKey || e.metaKey) {
                const origin = this._containerOrigin();
                const factor = Math.exp(-dy * 0.0015);
                this.zoomTo(this.zoom * factor, e.clientX - origin.left, e.clientY - origin.top);
            } else if (e.shiftKey && !dx) {
                this.panBy(-dy, 0);
            } else {
                this.panBy(-dx, -dy);
            }
        }, { passive: false });

        // Long-press: whichever contextmenu comes first (ours or the browser's
        // native touch long-press) wins; the other one is suppressed.
        this.container.addEventListener('contextmenu', (e) => {
            if (!e.isTrusted || this._lastPointerType !== 'touch') return;
            if (Date.now() < this._suppressNativeCtxUntil) {
                e.preventDefault();
                if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
                e.stopPropagation();
                return;
            }
            this._clearLongPress();
            this.drag = false;
            this._dragState = null;
        }, true);

        this.container.addEventListener('keydown', (e) => {
            if ((e.key === 'Delete' || e.key === 'Backspace') && this.connection_selected) {
                const target = e.target;
                const tag = target && target.tagName ? target.tagName.toUpperCase() : '';
                if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (target && target.isContentEditable)) {
                    return;
                }
                // Document-level shortcuts check `defaultPrevented` and skip.
                if (typeof e.preventDefault === 'function') e.preventDefault();
                this.removeConnection();
            }
        });
    }
}

if (typeof window !== 'undefined') window.Drawflow = CanvasEngine;
