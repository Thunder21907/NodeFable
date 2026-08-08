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

function syntaxCheckEditorModule() {
    const code = fs.readFileSync(path.join(ROOT, 'frontend', 'editor', 'js', 'codemirror-setup.js'), 'utf8');
    const r = spawnSync(process.execPath, ['--input-type=module', '--check'], {
        input: code,
        encoding: 'utf8',
    });
    if (r.status !== 0) {
        console.error('SYNTAX ERROR in frontend/editor/js/codemirror-setup.js');
        console.error(r.stderr || r.stdout);
        process.exit(1);
    }
    console.log('node --check codemirror-setup.js: OK');
}

syntaxCheckEngine();
syntaxCheckEditorModule();

const suites = ['wait', 'live_region', 'audio', 'regression', 'back', 'tables', 'setup', 'helpers', 'objects', 'fn_nodes'];
for (const name of suites) {
    require('./suites/' + name + '.test.js');
}

const failed = summary();
process.exit(failed ? 1 : 0);
