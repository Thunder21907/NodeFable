// frontend/editor/js/codemirror-setup.js
// CodeMirror custom mode (NodeFable), autocomplete hint provider, and editor bridge utilities.
import { state } from './state.js';

CodeMirror.defineMode('nodefable', function (config) {
    const markdown = CodeMirror.getMode(config, 'markdown');
    return CodeMirror.overlayMode(markdown, {
        token: function (stream) {
            // {if: ...} / {elseif: ...} / {else} / {endif} / {while:} / {endwhile} / {do} / {break} / {continue} / {init} / {endinit} / {for:} / {endfor} / {unset:}
            if (stream.match(/^\{(if|elseif|else|endif|while|endwhile|do|break|continue|init|endinit|for|endfor|unset)\b[^}]*\}/i)) return 'keyword';
            // {set: ...}
            if (stream.match(/^\{set:[^}]*\}/i)) return 'keyword';
            // {redirect: ...}
            if (stream.match(/^\{redirect:[^}]*\}/i)) return 'keyword';
            // {random:...}
            if (stream.match(/^\{random:\d+(?:,\d+)?\}/i)) return 'builtin';
            // {var:state.var} / {var state.var} / array access: state.myarray[0] / state.myarray[state.id]
            if (stream.match(/^\{var:?\s*((?:state|temp)\.\w+(?:\[[^\]]+\])?(?:\.size)?)\}/i)) return 'variable-2';
            // {textfield:...} / {checkbox:...} / {radiogroup} / {endradiogroup} / {radiobutton:...}
            if (stream.match(/^\{textfield:[^}]*\}/i)) return 'keyword';
            if (stream.match(/^\{checkbox:[^}]*\}/i)) return 'keyword';
            if (stream.match(/^\{radiogroup\}/i)) return 'keyword';
            if (stream.match(/^\{endradiogroup\}/i)) return 'keyword';
            if (stream.match(/^\{radiobutton:[^}]*\}/i)) return 'keyword';
            // {textarea:...} / {number:...} / {dropdown:...}
            if (stream.match(/^\{textarea:[^}]*\}/i)) return 'keyword';
            if (stream.match(/^\{number:[^}]*\}/i)) return 'keyword';
            if (stream.match(/^\{dropdown:[^}]*\}/i)) return 'keyword';
            // {include:...}
            if (stream.match(/^\{include:[^}]*\}/i)) return 'keyword';
            // {wait:...} / {endwait}
            if (stream.match(/^\{wait:\d+(?:,\s*fade:\d+)?\}[^}]*\{endwait\}/i)) return 'keyword';
            if (stream.match(/^\{endwait\}/i)) return 'keyword';
            // {dialogue:...} / {enddialogue}
            if (stream.match(/^\{dialogue:[^}]*\}/i)) return 'keyword';
            if (stream.match(/^\{enddialogue\}/i)) return 'keyword';
            // {img:...}
            if (stream.match(/^\{img:[^}]*\}/i)) return 'keyword';
            // {video:...}
            if (stream.match(/^\{video:[^}]*\}/i)) return 'keyword';
            // state.varname / temp.varname / array access: state.myarray[0] / state.myarray[state.id]
            if (stream.match(/(?:state|temp)\.\w+(?:\[[^\]]+\])?/)) return 'variable-2';
            // notify( / game.newGame(
            if (stream.match(/\b(notify|game\.newGame)\s*\(/)) return 'builtin';
            // true / false
            if (stream.match(/\b(true|false)\b/)) return 'atom';
            // number
            if (stream.match(/\b\d+\.?\d*\b/)) return 'number';
            stream.next();
            return null;
        }
    }, true);
});

CodeMirror.registerHelper('hint', 'nodeFableHint', function (cm) {
    const cursor = cm.getDoc().getCursor();
    const token = cm.getTokenAt(cursor);
    const line = cm.getLine(cursor.line);
    const lineBefore = line.slice(0, cursor.ch);
    const lineAfter = line.slice(cursor.ch);

    let list = [];
    let from = { line: cursor.line, ch: cursor.ch };
    let to = { line: cursor.line, ch: cursor.ch };

    // Detect context: inside [...](node:slug| or [...](action:id|
    const linkMatch = lineBefore.match(/\[[^\]]*\]\(((node:|action:)?([^)]*))$/);
    if (linkMatch && linkMatch[1]) {
        const full = linkMatch[1];
        const prefix = linkMatch[2] || '';
        const typed = linkMatch[3] || '';
        if (prefix === 'node:') {
            from.ch = cursor.ch - typed.length;
            for (const slug of Object.keys(state.slugToNodeId)) {
                if (slug.startsWith(typed)) {
                    list.push({ text: slug, displayText: slug });
                }
            }
            return { list, from, to };
        }
        if (prefix === 'action:') {
            from.ch = cursor.ch - typed.length;
            for (const nodeId in state.nodesData) {
                for (const action of (state.nodesData[nodeId].actions || [])) {
                    if (action.id && action.id.startsWith(typed)) {
                        list.push({ text: action.id, displayText: action.id });
                    }
                }
            }
            return { list, from, to };
        }
        if (!prefix) {
            from.ch = cursor.ch - full.length;
            list.push({ text: 'node:', displayText: 'node:' });
            list.push({ text: 'action:', displayText: 'action:' });
            return { list, from, to };
        }
    }

    // Detect context: state. inside {if ...} or assignment
    const varMatch = lineBefore.match(/(?:state\.)(\w*)$/);
    if (varMatch) {
        from.ch = cursor.ch - (varMatch[1] ? varMatch[1].length : 0);
        const prefix = varMatch[1] || '';
        // When already past "state.", suggest variable names
        for (const vName of Object.keys(state.variables)) {
            if (vName.startsWith(prefix)) {
                list.push({ text: vName, displayText: vName });
            }
        }
        return { list, from, to };
    }

    // Detect context: {include: <slug-prefix> - suggest node slugs
    const includeMatch = lineBefore.match(/\{include:\s*([\w-]*)$/i);
    if (includeMatch) {
        from.ch = cursor.ch - includeMatch[1].length;
        for (const slug of Object.keys(state.slugToNodeId)) {
            if (slug.startsWith(includeMatch[1])) list.push({ text: slug, displayText: slug });
        }
        return { list, from, to };
    }

    // Detect context: inside mutations - suggest state. / temp.
    if (lineBefore.match(/(?:^|\s)(state|temp)\.?$/)) {
        const wordMatch = lineBefore.match(/(state|temp)\.?$/);
        if (wordMatch) {
            from.ch = cursor.ch - wordMatch[1].length;
            list.push({ text: 'state.', displayText: 'state.' });
            list.push({ text: 'temp.', displayText: 'temp.' });
            return { list, from, to };
        }
    }

    // General word completion for keywords
    const wordMatch = lineBefore.match(/(\w*)$/);
    if (wordMatch) {
        const prefix = wordMatch[1];
        if (!prefix) return null;
        from.ch = cursor.ch - prefix.length;
        const keywords = ['if:', 'elseif:', 'else', 'endif', 'while:', 'endwhile', 'do', 'break', 'continue', 'init', 'endinit', 'for:', 'endfor', 'unset:',
            'set:', 'redirect:', 'random:',
            'textfield:', 'textarea:', 'number:', 'checkbox:', 'dropdown:', 'radiogroup', 'radiobutton:', 'endradiogroup',
            'var:', 'wait:', 'endwait', 'dialogue:', 'enddialogue', 'img:', 'video:',
            'include:',
            'true', 'false', 'notify(', 'game.newGame()'];
        for (const kw of keywords) {
            if (kw.startsWith(prefix)) {
                list.push({ text: kw, displayText: kw });
            }
        }
        return { list, from, to };
    }

    return null;
});

// ── Editor mode helpers ──────────────────────────────────────────

export function isSpellcheckActive() {
    return !document.getElementById('passage-content-native').classList.contains('is-hidden');
}

export function getEditorValue() {
    if (isSpellcheckActive()) {
        return document.getElementById('passage-content-native').value;
    }
    return state.cmEditor ? state.cmEditor.getValue() : '';
}

export function setEditorValue(val) {
    document.getElementById('passage-content-native').value = val || '';
    if (state.cmEditor) state.cmEditor.setValue(val || '');
}

export function insertAtCursor(text) {
    if (isSpellcheckActive()) {
        const ta = document.getElementById('passage-content-native');
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        ta.value = ta.value.substring(0, start) + text + ta.value.substring(end);
        ta.selectionStart = ta.selectionEnd = start + text.length;
        ta.focus();
    } else if (state.cmEditor) {
        const cursor = state.cmEditor.getDoc().getCursor();
        state.cmEditor.getDoc().replaceRange(text, cursor);
        const newPos = { line: cursor.line, ch: cursor.ch + text.length };
        state.cmEditor.getDoc().setCursor(newPos);
        state.cmEditor.focus();
    }
}

export function insertMarkdown(before, after) {
    if (isSpellcheckActive()) {
        const ta = document.getElementById('passage-content-native');
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        const text = ta.value;
        const selected = text.substring(start, end);
        ta.value = text.substring(0, start) + before + selected + after + text.substring(end);
        ta.focus();
        ta.selectionStart = ta.selectionEnd = selected ? start + before.length + selected.length + after.length : start + before.length;
    } else if (state.cmEditor) {
        const doc = state.cmEditor.getDoc();
        const sel = doc.listSelections()[0];
        if (!sel) return;
        const anchor = { line: sel.anchor.line, ch: sel.anchor.ch };
        const head = { line: sel.head.line, ch: sel.head.ch };
        const isReversed = (head.line < anchor.line) || (head.line === anchor.line && head.ch < anchor.ch);
        const from = isReversed ? head : anchor;
        const to = isReversed ? anchor : head;
        const selected = doc.getSelection();
        doc.replaceRange(before + selected + after, from, to, '+insertMarkdown');
        if (selected) {
            doc.setSelection(
                { line: from.line, ch: from.ch + before.length },
                { line: from.line, ch: from.ch + before.length + selected.length }
            );
        } else {
            doc.setCursor({ line: from.line, ch: from.ch + before.length });
        }
        state.cmEditor.focus();
    }
}

export function toggleSpellcheck() {
    if (!state.cmEditor) return;
    const native = document.getElementById('passage-content-native');
    const cmContainer = document.getElementById('passage-content-editor');
    const btn = document.getElementById('spellcheck-toggle');
    const status = document.getElementById('spellcheck-status');
    if (isSpellcheckActive()) {
        state.cmEditor.setValue(native.value);
        native.classList.add('is-hidden');
        cmContainer.classList.remove('is-hidden');
        state.cmEditor.focus();
        status.textContent = 'OFF';
        btn.classList.add('off');
    } else {
        native.value = state.cmEditor.getValue();
        cmContainer.classList.add('is-hidden');
        native.classList.remove('is-hidden');
        native.focus();
        status.textContent = 'ON';
        btn.classList.remove('off');
    }
}
