// frontend/editor/js/viewer-overlay.js
// In-app fullscreen viewer (#preview-overlay + #preview-frame) used for the
// game preview and the tutorial, instead of opening a new browser tab — new
// tabs/windows are not available inside the Tauri desktop/Android webview.

const AUTOSAVE_KEYS = ['storyeditor_autosave', 'storyeditor_save'];
// The preview is the user's own story running on the editor's origin, so it
// keeps same-origin access (localStorage saves, assets). Same trust level as
// the old new-tab preview.
const PREVIEW_SANDBOX = 'allow-scripts allow-modals allow-same-origin allow-forms';

let current = null;          // { src, html, restartable, sandbox }
let returnFocusEl = null;

function els() {
    return {
        overlay: document.getElementById('preview-overlay'),
        frame: document.getElementById('preview-frame'),
        title: document.getElementById('preview-overlay-title'),
        restart: document.getElementById('preview-restart'),
        close: document.getElementById('preview-close')
    };
}

export function isViewerOpen() {
    const { overlay } = els();
    return !!overlay && !overlay.classList.contains('is-hidden');
}

function loadFrame(frame, opts) {
    // Sandbox flags apply on the next navigation, so set them first.
    if (opts.sandbox) frame.setAttribute('sandbox', opts.sandbox);
    else frame.removeAttribute('sandbox');
    if (opts.html !== undefined && opts.html !== null) {
        frame.removeAttribute('src');
        frame.srcdoc = opts.html;
    } else {
        frame.removeAttribute('srcdoc');
        frame.src = opts.src;
    }
}

// opts: { title, src | html, restartable, sandbox }
export function openViewer(opts) {
    const { overlay, frame, title, restart } = els();
    if (!overlay || !frame) return false;
    current = opts;
    if (!isViewerOpen()) returnFocusEl = document.activeElement;
    title.textContent = opts.title || '';
    frame.title = opts.title || 'Viewer';
    restart.classList.toggle('is-hidden', !opts.restartable);
    loadFrame(frame, opts);
    overlay.classList.remove('is-hidden');
    document.body.classList.add('viewer-open');
    frame.addEventListener('load', () => {
        try { frame.focus(); } catch (_) { /* ignore */ }
    }, { once: true });
    return true;
}

export function closeViewer() {
    const { overlay, frame } = els();
    if (!overlay || !isViewerOpen()) return;
    overlay.classList.add('is-hidden');
    document.body.classList.remove('viewer-open');
    // Unload the page so game audio, timers and live regions stop.
    frame.removeAttribute('srcdoc');
    frame.src = 'about:blank';
    current = null;
    if (returnFocusEl && typeof returnFocusEl.focus === 'function' && document.contains(returnFocusEl)) {
        returnFocusEl.focus();
    }
    returnFocusEl = null;
}

// Restart the preview from the start node: drop the autosave the runtime
// resumes from (manual save slots 1-5 are kept), then reload the page.
export function restartViewer() {
    const { frame } = els();
    if (!current || !frame) return;
    for (const k of AUTOSAVE_KEYS) {
        try { localStorage.removeItem(k); } catch (_) { /* storage unavailable */ }
    }
    loadFrame(frame, current);
}

export function openGamePreview(projectName, data) {
    if (!data || (!data.url && !data.html)) return false;
    return openViewer({
        title: 'Playing Preview: ' + projectName,
        src: data.url || null,
        html: data.url ? null : data.html,
        restartable: true,
        sandbox: PREVIEW_SANDBOX
    });
}

export function openTutorial() {
    return openViewer({ title: 'NodeFable Tutorial', src: 'tutorial.html', restartable: false });
}

export function setupViewerOverlay() {
    const { restart, close } = els();
    if (restart) restart.addEventListener('click', restartViewer);
    if (close) close.addEventListener('click', closeViewer);
    // Escape while focus is in the editor document (the frame keeps its own keys).
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isViewerOpen()) {
            e.preventDefault();
            e.stopImmediatePropagation();
            closeViewer();
        }
    }, true);
}
