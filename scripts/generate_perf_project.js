'use strict';

const fs = require('fs');
const path = require('path');

const PROJECT_NAME = '__perf_1000_nodes__';
const NODE_COUNT = 1000;
// Fixed seed so every run produces the same graph (comparable benchmarks).
// Override with PERF_SEED=<int> to try a different layout.
const SEED = Number.parseInt(process.env.PERF_SEED || '1337', 10) >>> 0;

// mulberry32: tiny deterministic PRNG returning floats in [0, 1).
function makeRng(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const random = makeRng(SEED);
const GRID_COLS = 32;

// Same data folder the app uses: $NODEFABLE_DATA_DIR, else
// $XDG_DATA_HOME/nodefable/data (~/.local/share/nodefable/data).
const os = require('os');
const DATA_ROOT = process.env.NODEFABLE_DATA_DIR
    || path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'nodefable', 'data');
const OUTPUT_DIR = path.join(DATA_ROOT, PROJECT_NAME);
const GROUPS_DIR = path.join(OUTPUT_DIR, 'groups');

function formatNodeId(index) {
    return 'n' + String(index).padStart(3, '0');
}

function buildSidePanelGroup() {
    const slugIds = [
        { slug_id: 'side_panel', connections: [] },
        { slug_id: 'setup', connections: [] }
    ];

    const nodes = [
        {
            id: 'side_panel',
            title: 'Side Panel',
            text: '',
            x: 20,
            y: 20,
            choices: [],
            on_enter: null,
            is_start: false,
            is_utility: false,
            is_function: false,
            group: 'side_panel'
        },
        {
            id: 'setup',
            title: 'Setup',
            text: '',
            x: 360,
            y: 20,
            choices: [],
            on_enter: null,
            is_start: false,
            is_utility: true,
            is_function: false,
            group: 'side_panel'
        }
    ];

    const groupData = {
        group_id: 'side_panel',
        label: 'Side Panel',
        node_count: nodes.length,
        slug_ids: slugIds,
        nodes
    };

    const summary = {
        id: 'side_panel',
        label: 'Side Panel',
        node_count: nodes.length,
        slug_ids: slugIds
    };

    return { groupData, summary };
}

function buildGridGroup() {
    const slugIds = [];
    const nodes = [];

    // Pass 1: generate all 1000 nodes in the 32-column grid
    for (let i = 0; i < NODE_COUNT; i++) {
        const id = formatNodeId(i);

        slugIds.push({ slug_id: id, connections: [] });

        nodes.push({
            id,
            title: 'Passage ' + i,
            text: 'Passage ' + i,
            x: 100 + (i % GRID_COLS) * 260,
            y: 140 + Math.floor(i / GRID_COLS) * 140,
            choices: [],
            on_enter: null,
            is_start: i === 0,
            is_utility: false,
            is_function: false,
            group: 'grid_1000'
        });
    }

    // Pass 2: connect each node to a random target node (excluding self)
    for (let i = 0; i < nodes.length; i++) {
        let targetIdx = Math.floor(random() * (NODE_COUNT - 1));
        if (targetIdx >= i) {
            targetIdx += 1;
        }
        const targetId = nodes[targetIdx].id;

        nodes[i].choices.push({
            target_node_id: targetId,
            text: 'Next',
            prerequisite: null,
            mutation: null
        });
        nodes[i].text += `\n\n[Next](node:${targetId})`;
        slugIds[i].connections.push(targetId);
    }

    const groupData = {
        group_id: 'grid_1000',
        label: 'Grid 1000',
        node_count: nodes.length,
        slug_ids: slugIds,
        nodes
    };

    const summary = {
        id: 'grid_1000',
        label: 'Grid 1000',
        node_count: nodes.length,
        slug_ids: slugIds
    };

    return { groupData, summary };
}

function main() {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.mkdirSync(GROUPS_DIR, { recursive: true });

    const sidePanel = buildSidePanelGroup();
    const grid = buildGridGroup();

    const manifest = {
        name: PROJECT_NAME,
        version: 2,
        variables: {},
        setup: {},
        groups: [sidePanel.summary, grid.summary]
    };

    fs.writeFileSync(
        path.join(GROUPS_DIR, 'side_panel.json'),
        JSON.stringify(sidePanel.groupData, null, 2) + '\n',
        'utf8'
    );
    fs.writeFileSync(
        path.join(GROUPS_DIR, 'grid_1000.json'),
        JSON.stringify(grid.groupData, null, 2) + '\n',
        'utf8'
    );
    fs.writeFileSync(
        path.join(OUTPUT_DIR, 'manifest.json'),
        JSON.stringify(manifest, null, 2) + '\n',
        'utf8'
    );

    const totalNodes = sidePanel.groupData.node_count + grid.groupData.node_count;
    const totalConnections = NODE_COUNT;
    console.log(
        `Generated ${PROJECT_NAME} at ${OUTPUT_DIR} (${totalNodes} nodes: ${grid.groupData.node_count} grid + ${sidePanel.groupData.node_count} side_panel/setup, ${totalConnections} random connections, seed ${SEED})`
    );
}

main();
