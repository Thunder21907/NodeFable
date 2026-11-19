'use strict';
// tests/suites/api_assets.test.js
// Unit tests for frontend/editor/js/api.js and assetSyntax in frontend/editor/js/asset-explorer.js.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { section, test } = require('../harness.js');

const ROOT = path.join(__dirname, '..', '..');
const API_PATH = path.join(ROOT, 'frontend', 'editor', 'js', 'api.js');
const ASSET_EXPLORER_PATH = path.join(ROOT, 'frontend', 'editor', 'js', 'asset-explorer.js');

function extractExportedFunction(src, fnName) {
    const marker = 'export function ' + fnName + '(';
    const start = src.indexOf(marker);
    if (start === -1) throw new Error('Could not find ' + marker);
    const bodyStart = src.indexOf('{', start);
    let depth = 0;
    let inSingle = false;
    let inDouble = false;
    let inTemplate = false;
    let escaped = false;
    for (let i = bodyStart; i < src.length; i++) {
        const ch = src[i];
        if (escaped) { escaped = false; continue; }
        if (ch === '\\' && (inSingle || inDouble || inTemplate)) { escaped = true; continue; }
        if (inSingle) { if (ch === "'") inSingle = false; continue; }
        if (inDouble) { if (ch === '"') inDouble = false; continue; }
        if (inTemplate) { if (ch === '`') inTemplate = false; continue; }
        if (ch === "'") { inSingle = true; continue; }
        if (ch === '"') { inDouble = true; continue; }
        if (ch === '`') { inTemplate = true; continue; }
        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) {
                return src.slice(start + 'export '.length, i + 1);
            }
        }
    }
    throw new Error('Unterminated function ' + fnName);
}

function loadApiAndAssetHelpers(windowObj) {
    const apiSrc = fs.readFileSync(API_PATH, 'utf8')
        .replace(/^export\s+default\s+.*$/gm, '')
        .replace(/^export\s+(?=(?:async\s+)?function\b|const\b|let\b|var\b)/gm, '');
    const aeSrc = fs.readFileSync(ASSET_EXPLORER_PATH, 'utf8');
    const videoMatch = aeSrc.match(/const VIDEO_EXTS = \[[^\]]*\];/);
    const audioMatch = aeSrc.match(/const AUDIO_EXTS = \[[^\]]*\];/);
    if (!videoMatch || !audioMatch) {
        throw new Error('Could not find VIDEO_EXTS or AUDIO_EXTS in asset-explorer.js');
    }
    const assetSyntaxCode = extractExportedFunction(aeSrc, 'assetSyntax');

    const ctx = vm.createContext({
        window: windowObj,
        encodeURIComponent,
        Uint8Array,
        FormData: function FormData() {},
        fetch: () => { throw new Error('unexpected fetch'); },
    });
    vm.runInContext(
        apiSrc + '\n' + videoMatch[0] + '\n' + audioMatch[0] + '\n' + assetSyntaxCode,
        ctx
    );
    return ctx;
}

section('Frontend API Adapter & Asset Paths');

test('1. cleanAssetRelPath normalizes relative, assets/, and legacy /api/assets/<proj>/ paths', () => {
    const { cleanAssetRelPath } = loadApiAndAssetHelpers({});
    assert.strictEqual(cleanAssetRelPath('bg/forest.png'), 'bg/forest.png');
    assert.strictEqual(cleanAssetRelPath('assets/bg/forest.png'), 'bg/forest.png');
    assert.strictEqual(cleanAssetRelPath('/api/assets/MyGame/bg/forest.png'), 'bg/forest.png');
    assert.strictEqual(cleanAssetRelPath('/assets/bg/forest.png'), 'bg/forest.png');
    assert.strictEqual(cleanAssetRelPath(''), '');
    assert.strictEqual(cleanAssetRelPath(null), '');
});

test('2. assetSyntax emits relative assets/<cleanPath> for img, video, and audio across input formats', () => {
    const { assetSyntax } = loadApiAndAssetHelpers({});

    for (const input of ['bg/forest.png', 'assets/bg/forest.png', '/api/assets/MyGame/bg/forest.png']) {
        assert.strictEqual(assetSyntax(input, 'forest.png'), '{img: assets/bg/forest.png, alt=forest}');
    }
    for (const input of ['clips/intro.mp4', 'assets/clips/intro.mp4', '/api/assets/MyGame/clips/intro.mp4']) {
        assert.strictEqual(assetSyntax(input, 'intro.mp4'), '{video: assets/clips/intro.mp4}');
    }
    for (const input of ['bgm/theme.ogg', 'assets/bgm/theme.ogg', '/api/assets/MyGame/bgm/theme.ogg']) {
        assert.strictEqual(assetSyntax(input, 'theme.ogg'), '{audio: assets/bgm/theme.ogg}');
    }
});

test('3. resolveEditorAssetUrl returns HTTP URL in browser mode and nfasset:// URL in Tauri mode', () => {
    const httpEnv = loadApiAndAssetHelpers({});
    assert.strictEqual(httpEnv.isTauri(), false);
    assert.strictEqual(
        httpEnv.resolveEditorAssetUrl('My Game', 'bg/forest.png'),
        '/api/assets/My%20Game/bg/forest.png'
    );
    assert.strictEqual(
        httpEnv.resolveEditorAssetUrl('My Game', 'assets/bg/forest.png'),
        '/api/assets/My%20Game/bg/forest.png'
    );
    assert.strictEqual(httpEnv.resolveEditorAssetUrl('', 'bg/forest.png'), '');
    assert.strictEqual(httpEnv.resolveEditorAssetUrl('My Game', ''), '');

    const tauriEnv = loadApiAndAssetHelpers({
        __TAURI_INTERNALS__: { invoke: () => Promise.resolve(null) },
    });
    assert.strictEqual(tauriEnv.isTauri(), true);
    assert.strictEqual(
        tauriEnv.resolveEditorAssetUrl('My Game', 'bg/forest.png'),
        'nfasset://localhost/My%20Game/assets/bg/forest.png'
    );
    assert.strictEqual(
        tauriEnv.resolveEditorAssetUrl('My Game', '/api/assets/Other/bg/forest.png'),
        'nfasset://localhost/My%20Game/assets/bg/forest.png'
    );

    const noWindowEnv = loadApiAndAssetHelpers(undefined);
    assert.strictEqual(noWindowEnv.isTauri(), false);
    assert.strictEqual(
        noWindowEnv.resolveEditorAssetUrl('My Game', 'bg/forest.png'),
        '/api/assets/My%20Game/bg/forest.png'
    );
});

test('4. normalizeLegacyAssetUrls rewrites legacy /api/assets/<proj>/ URLs in-place while preserving relative and external URLs', () => {
    const { normalizeLegacyAssetUrls } = loadApiAndAssetHelpers({});

    const payload = {
        name: 'My Game',
        variables: {
            banner: '/api/assets/MyGame/bg/forest.png',
            introClip: '/api/assets/My%20Game/intro.mp4',
            alreadyRelative: 'assets/ui/panel.png',
            externalUrl: 'https://cdn.example.com/images/hero.png',
            count: 42,
            flag: true,
            empty: null,
        },
        nodes: [
            {
                id: 'start',
                text: 'Enter {img: /api/assets/MyGame/bg/forest.png, alt=forest}\n{video: /api/assets/My%20Game/intro.mp4}\n![ok](assets/ui/ok.png)\n![ext](https://example.org/pic.jpg)',
                choices: [
                    {
                        text: 'Look at ![thumb](/api/assets/MyGame/bg/forest.png)',
                        target_node_id: 'next',
                    },
                    {
                        text: 'Keep ![rel](assets/icons/arrow.png) and https://example.com/a.png',
                        target_node_id: 'end',
                    },
                ],
                on_enter: {
                    bgm: '/api/assets/My%20Game/intro.mp4',
                },
            },
        ],
    };

    const returned = normalizeLegacyAssetUrls(payload, 'My Game');
    assert.strictEqual(returned, payload);

    assert.strictEqual(payload.variables.banner, 'assets/bg/forest.png');
    assert.strictEqual(payload.variables.introClip, 'assets/intro.mp4');
    assert.strictEqual(payload.variables.alreadyRelative, 'assets/ui/panel.png');
    assert.strictEqual(payload.variables.externalUrl, 'https://cdn.example.com/images/hero.png');
    assert.strictEqual(payload.variables.count, 42);
    assert.strictEqual(payload.variables.flag, true);
    assert.strictEqual(payload.variables.empty, null);

    assert.strictEqual(
        payload.nodes[0].text,
        'Enter {img: assets/bg/forest.png, alt=forest}\n{video: assets/intro.mp4}\n![ok](assets/ui/ok.png)\n![ext](https://example.org/pic.jpg)'
    );
    assert.strictEqual(
        payload.nodes[0].choices[0].text,
        'Look at ![thumb](assets/bg/forest.png)'
    );
    assert.strictEqual(
        payload.nodes[0].choices[1].text,
        'Keep ![rel](assets/icons/arrow.png) and https://example.com/a.png'
    );
    assert.strictEqual(payload.nodes[0].on_enter.bgm, 'assets/intro.mp4');
});

test('5. Tauri mode uses convertFileSrc(…, "nfasset") when available (Windows/Android URL form)', () => {
    const calls = [];
    const env = loadApiAndAssetHelpers({
        __TAURI_INTERNALS__: {
            invoke: () => Promise.resolve(null),
            // Tauri's real implementation on Windows/Android:
            convertFileSrc: (p, proto) => { calls.push([p, proto]); return 'http://' + proto + '.localhost/' + encodeURIComponent(p); },
        },
    });
    assert.strictEqual(
        env.resolveEditorAssetUrl('My Game', 'assets/bg/dark forest.png'),
        'http://nfasset.localhost/My%20Game%2Fassets%2Fbg%2Fdark%20forest.png'
    );
    assert.deepStrictEqual(JSON.parse(JSON.stringify(calls)), [['My Game/assets/bg/dark forest.png', 'nfasset']]);
    // Fallback form encodes each path segment.
    const fallback = loadApiAndAssetHelpers({ __TAURI_INTERNALS__: { invoke: () => Promise.resolve(null) } });
    assert.strictEqual(fallback.resolveEditorAssetUrl('My Game', 'bg/dark forest.png'), 'nfasset://localhost/My%20Game/assets/bg/dark%20forest.png');
});
