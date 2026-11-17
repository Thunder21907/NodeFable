'use strict';
// tests/run.js
// Full test suite runner. Extracts the inline engine <script> from
// frontend/editor/template.html, syntax-checks it (and the CodeMirror module),
// then executes every suite under tests/suites/ in a Node vm with mocked browser
// APIs. Exits non-zero on any failure.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const { extractEngineScript, summary, TEMPLATE_PATH } = require('./harness.js');

const ROOT = path.join(__dirname, '..');

function syntaxCheckEngine() {
    const engine = extractEngineScript(TEMPLATE_PATH);
    const tmp = path.join(os.tmpdir(), 'nodefable_engine_check_' + process.pid + '.js');
    fs.writeFileSync(tmp, engine);
    try {
        execFileSync(process.execPath, ['--check', tmp], { stdio: 'inherit' });
        console.log('node --check template engine: OK');
    } catch (e) {
        console.error('SYNTAX ERROR in frontend/editor/template.html engine script');
        process.exit(1);
    } finally {
        try { fs.unlinkSync(tmp); } catch {}
    }
}

function checkModuleSyntax(relPath) {
    const code = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
    const r = spawnSync(process.execPath, ['--input-type=module', '--check'], {
        input: code,
        encoding: 'utf8',
    });
    if (r.status !== 0) {
        console.error('SYNTAX ERROR in ' + relPath);
        console.error(r.stderr || r.stdout);
        process.exit(1);
    }
}

function syntaxCheckEditorModule() {
    checkModuleSyntax('frontend/editor/js/codemirror-setup.js');
    console.log('node --check codemirror-setup.js: OK');

    const jsDir = path.join(ROOT, 'frontend', 'editor', 'js');
    const jsFiles = fs.readdirSync(jsDir)
        .filter((f) => f.endsWith('.js') && !f.startsWith('backup_') && f !== 'codemirror-setup.js')
        .sort()
        .map((f) => 'frontend/editor/js/' + f);

    const otherModules = ['frontend/editor/app.js', ...jsFiles];
    for (const relPath of otherModules) {
        checkModuleSyntax(relPath);
    }
    console.log(`node --check editor modules (${otherModules.length + 1} files): OK`);
}

syntaxCheckEngine();
syntaxCheckEditorModule();

const suites = ['wait', 'live_region', 'audio', 'regression', 'back', 'tables', 'setup', 'helpers', 'objects', 'fn_nodes', 'nested_conditionals', 'radios', 'editor_slug', 'api_assets'];
for (const name of suites) {
    require('./suites/' + name + '.test.js');
}

const failed = summary();
process.exit(failed ? 1 : 0);
