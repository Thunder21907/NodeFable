// frontend/editor/js/variables-manager.js
import { state } from './state.js';
import { escapeHtml } from './ui-utils.js';
import { SVG_CLOSE } from './constants.js';

export function showVariableForm() {
    if (state.isEditingVariable) {
        hideVariableForm();
    }
    document.getElementById('var-form').style.display = 'block';
}

export function hideVariableForm() {
    if (state.isEditingVariable && state.editVariableBackup) {
        state.variables[state.editVariableBackup.name] = { type: state.editVariableBackup.type, value: state.editVariableBackup.value };
        renderVariables();
    }
    state.editVariableBackup = null;
    state.isEditingVariable = false;
    document.getElementById('var-form').style.display = 'none';
    document.getElementById('var-name').value = '';
    document.getElementById('var-value').value = '';
    document.getElementById('var-elem-type-wrap').classList.add('is-hidden');
    document.getElementById('var-elem-type').value = 'string';
    document.getElementById('var-value').placeholder = 'Initial value';
    document.getElementById('var-submit-btn').textContent = 'Add';
}

export function addVariable() {
    const name = document.getElementById('var-name').value.trim();
    const type = document.getElementById('var-type').value;
    const rawValue = document.getElementById('var-value').value.trim();

    if (!name) { alert("Variable name is required."); return; }
    if (name in state.variables) { alert("A variable with that name already exists."); return; }

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
        default:
            parsedValue = rawValue;
    }

    state.variables[name] = { type, value: parsedValue };
    state.editVariableBackup = null;
    hideVariableForm();
    renderVariables();
}

export function editVariable(name) {
    const v = state.variables[name];
    if (!v) return;
    if (state.isEditingVariable && state.editVariableBackup) {
        state.variables[state.editVariableBackup.name] = { type: state.editVariableBackup.type, value: state.editVariableBackup.value };
    }
    state.editVariableBackup = { name, type: v.type, value: v.value };
    delete state.variables[name];
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

export function deleteVariable(name) {
    delete state.variables[name];
    renderVariables();
}

export function renderVariables() {
    const container = document.getElementById('var-list');
    const names = Object.keys(state.variables);
    if (names.length === 0) {
        container.innerHTML = '<p class="text-muted-sm">No variables defined yet.</p>';
        return;
    }
    let html = '';
    names.forEach(name => {
        const v = state.variables[name];
        const display = Array.isArray(v.value) ? JSON.stringify(v.value) : String(v.value);
        html += `
            <div class="var-item">
                <div class="var-item-content" data-varname="${escapeHtml(name)}">
                    <span class="var-name">${escapeHtml(name)}</span>
                    <span class="var-type">${v.type}</span>
                    <div class="var-value">${escapeHtml(display)}</div>
                </div>
                <div class="var-actions">
                    <button class="var-delete-btn danger" data-varname="${escapeHtml(name)}">${SVG_CLOSE}</button>
                </div>
            </div>
        `;
    });
    container.innerHTML = html;
}
