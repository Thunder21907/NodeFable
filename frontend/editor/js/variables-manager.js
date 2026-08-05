// frontend/editor/js/variables-manager.js
import { state } from './state.js';
import { escapeHtml } from './ui-utils.js';
import { SVG_CLOSE } from './constants.js';

function getStore(scope) {
    return scope === 'setup' ? state.setupVariables : state.variables;
}

function getScopeOf(name) {
    if (name in state.setupVariables) return 'setup';
    return 'state';
}

export function showVariableForm() {
    if (state.isEditingVariable) {
        hideVariableForm();
    }
    document.getElementById('var-form').style.display = 'block';
}

export function hideVariableForm() {
    if (state.isEditingVariable && state.editVariableBackup) {
        const store = getStore(state.editVariableBackup.scope);
        store[state.editVariableBackup.name] = { type: state.editVariableBackup.type, value: state.editVariableBackup.value };
        renderVariables();
    }
    state.editVariableBackup = null;
    state.isEditingVariable = false;
    document.getElementById('var-form').style.display = 'none';
    document.getElementById('var-scope').value = 'state';
    document.getElementById('var-name').value = '';
    document.getElementById('var-value').value = '';
    document.getElementById('var-elem-type-wrap').classList.add('is-hidden');
    document.getElementById('var-elem-type').value = 'string';
    document.getElementById('var-value').placeholder = 'Initial value';
    document.getElementById('var-submit-btn').textContent = 'Add';
}

export function addVariable() {
    const scope = document.getElementById('var-scope').value;
    const name = document.getElementById('var-name').value.trim();
    const type = document.getElementById('var-type').value;
    const rawValue = document.getElementById('var-value').value.trim();
    const store = getStore(scope);

    if (!name) { alert("Variable name is required."); return; }
    if (name in store) { alert("A variable with that name already exists in this scope."); return; }

    let parsedValue;
    switch (type) {
        case 'int':
            parsedValue = parseInt(rawValue, 10);
            if (isNaN(parsedValue)) { alert("Please enter a valid integer."); return; }
            break;
        case 'float':
            parsedValue = parseFloat(rawValue);
            if (isNaN(parsedValue)) { alert("Please enter a valid float."); return; }
            break;
        case 'bool':
            parsedValue = rawValue.toLowerCase() === 'true' || rawValue === '1';
            break;
        case 'array': {
            const elemType = document.getElementById('var-elem-type').value;
            parsedValue = [];
            if (rawValue !== '') {
                for (const s of rawValue.split(',')) {
                    const t = s.trim();
                    switch (elemType) {
                        case 'int': {
                            const n = parseInt(t, 10);
                            if (isNaN(n)) { alert('Array values must be valid integers, comma-separated.'); return; }
                            parsedValue.push(n);
                            break;
                        }
                        case 'float': {
                            const n = parseFloat(t);
                            if (isNaN(n)) { alert('Array values must be valid floats, comma-separated.'); return; }
                            parsedValue.push(n);
                            break;
                        }
                        case 'bool':
                            parsedValue.push(t.toLowerCase() === 'true' || t === '1');
                            break;
                        default:
                            parsedValue.push(t);
                    }
                }
            }
            break;
        }
        case 'dict': {
            try {
                parsedValue = JSON.parse(rawValue);
            } catch (e) {
                alert('Dict value must be valid JSON (e.g. {"name":"Sandra","progress":0}).');
                return;
            }
            if (!parsedValue || typeof parsedValue !== 'object' || Array.isArray(parsedValue)) {
                alert('Dict value must be a JSON object, not an array or null.');
                return;
            }
            break;
        }
        default:
            parsedValue = rawValue;
    }

    store[name] = { type, value: parsedValue };
    state.editVariableBackup = null;
    hideVariableForm();
    renderVariables();
}

export function editVariable(name, scope) {
    scope = scope || getScopeOf(name);
    const store = getStore(scope);
    const v = store[name];
    if (!v) return;
    if (state.isEditingVariable && state.editVariableBackup) {
        const backupStore = getStore(state.editVariableBackup.scope);
        backupStore[state.editVariableBackup.name] = { type: state.editVariableBackup.type, value: state.editVariableBackup.value };
    }
    state.editVariableBackup = { scope, name, type: v.type, value: v.value };
    delete store[name];
    document.getElementById('var-scope').value = scope;
    document.getElementById('var-name').value = name;
    document.getElementById('var-type').value = v.type;
    if (v.type === 'array') {
        const first = Array.isArray(v.value) && v.value.length ? v.value[0] : null;
        const elemType = typeof first === 'number' ? (Number.isInteger(first) ? 'int' : 'float')
            : typeof first === 'boolean' ? 'bool' : 'string';
        document.getElementById('var-elem-type').value = elemType;
        document.getElementById('var-elem-type-wrap').classList.remove('is-hidden');
        document.getElementById('var-value').value = Array.isArray(v.value) ? v.value.join(', ') : '';
        document.getElementById('var-value').placeholder = 'Comma-separated values (e.g. 3, 1, 4)';
    } else if (v.type === 'dict') {
        document.getElementById('var-elem-type-wrap').classList.add('is-hidden');
        document.getElementById('var-value').value = JSON.stringify(v.value, null, 2);
        document.getElementById('var-value').placeholder = 'JSON object e.g. {"name":"Sandra"}';
    } else {
        document.getElementById('var-elem-type-wrap').classList.add('is-hidden');
        document.getElementById('var-value').value = String(v.value);
        document.getElementById('var-value').placeholder = 'Initial value';
    }
    document.getElementById('var-submit-btn').textContent = 'Save Changes';
    document.getElementById('var-form').style.display = 'block';
    state.isEditingVariable = true;
    renderVariables();
}

export function deleteVariable(name, scope) {
    scope = scope || getScopeOf(name);
    delete getStore(scope)[name];
    renderVariables();
}

export function renderVariables() {
    const container = document.getElementById('var-list');
    const entries = [
        ...Object.keys(state.variables).map(name => ({ scope: 'state', name, v: state.variables[name] })),
        ...Object.keys(state.setupVariables).map(name => ({ scope: 'setup', name, v: state.setupVariables[name] }))
    ];
    if (entries.length === 0) {
        container.innerHTML = '<p class="text-muted-sm">No variables defined yet.</p>';
        return;
    }
    let html = '';
    entries.forEach(({ scope, name, v }) => {
        const display = (Array.isArray(v.value) || (v.value !== null && typeof v.value === 'object')) ? JSON.stringify(v.value) : String(v.value);
        const fullName = scope + '.' + name;
        html += `
            <div class="var-item scope-${scope}" data-scope="${scope}">
                <div class="var-item-content" data-varname="${escapeHtml(name)}" data-scope="${scope}">
                    <span class="var-name">${escapeHtml(fullName)}</span>
                    <span class="var-type">${v.type}</span>
                    <div class="var-value">${escapeHtml(display)}</div>
                </div>
                <div class="var-actions">
                    <button class="var-delete-btn danger" data-varname="${escapeHtml(name)}" data-scope="${scope}">${SVG_CLOSE}</button>
                </div>
            </div>
        `;
    });
    container.innerHTML = html;
}
