// modules/history.js
import { state } from '../digitizer.js';
import { draw } from './canvas.js';
import { updatePreview, updateLineSelect, updateButtonStates, updateAxisInstruction } from './ui.js';
import { saveSession } from './session.js';

export function initHistory() {
    state.history = [];
    state.historyIndex = -1;
}

export function saveState() {
    // prune future
    state.history = state.history.slice(0, state.historyIndex+1);
    const snapshot = {
        lines: JSON.parse(JSON.stringify(state.lines)),
        axisPoints: JSON.parse(JSON.stringify(state.axisPoints)),
        scaleX: state.scaleX, scaleY: state.scaleY,
        offsetX: state.offsetX, offsetY: state.offsetY,
        logX: state.logX, logY: state.logY,
        isCalibrated: state.isCalibrated,
        zoom: state.zoom, panX: state.panX, panY: state.panY,
        showGrid: state.showGrid,
        mode: state.mode,
        currentLineIndex: state.currentLineIndex,
        magnifierZoom: state.magnifierZoom,
        highlightPath: JSON.parse(JSON.stringify(state.highlightPath)),
        isHighlighting: state.isHighlighting,
        // color detection
        autoCenter: state.autoCenter,
        bgColor: {...state.bgColor},
        lineColor: {...state.lineColor},
        colorTolerance: state.colorTolerance,
        searchRadius: state.searchRadius
    };
    state.history.push(snapshot);
    state.historyIndex++;
    state.ui.undoBtn.disabled = state.historyIndex <= 0;
    state.ui.redoBtn.disabled = state.historyIndex >= state.history.length-1;
    saveSession();
}

export function undo() {
    if (state.historyIndex <= 0) return;
    state.historyIndex--;
    restore(state.history[state.historyIndex]);
}
export function redo() {
    if (state.historyIndex >= state.history.length-1) return;
    state.historyIndex++;
    restore(state.history[state.historyIndex]);
}

function restore(s) {
    Object.assign(state, {
        lines: JSON.parse(JSON.stringify(s.lines)),
        axisPoints: JSON.parse(JSON.stringify(s.axisPoints)),
        scaleX: s.scaleX, scaleY: s.scaleY,
        offsetX: s.offsetX, offsetY: s.offsetY,
        logX: s.logX, logY: s.logY,
        isCalibrated: s.isCalibrated,
        zoom: s.zoom, panX: s.panX, panY: s.panY,
        showGrid: s.showGrid,
        mode: s.mode,
        currentLineIndex: s.currentLineIndex,
        magnifierZoom: s.magnifierZoom,
        highlightPath: JSON.parse(JSON.stringify(s.highlightPath)),
        isHighlighting: s.isHighlighting,
        autoCenter: s.autoCenter,
        bgColor: {...s.bgColor},
        lineColor: {...s.lineColor},
        colorTolerance: s.colorTolerance,
        searchRadius: s.searchRadius
    });
    // UI sync
    document.getElementById('toggle-log-x').classList.toggle('log-active', state.logX);
    document.getElementById('toggle-log-y').classList.toggle('log-active', state.logY);
    document.getElementById('magnifier-zoom').value = state.magnifierZoom;
    document.getElementById('auto-center').checked = state.autoCenter;
    document.getElementById('color-detection-controls').style.display = state.autoCenter?'block':'none';
    document.getElementById('bg-color').value = rgbToHex(state.bgColor);
    document.getElementById('line-color').value = rgbToHex(state.lineColor);
    document.getElementById('color-tolerance').value = state.colorTolerance;
    document.getElementById('search-radius').value = state.searchRadius;

    updateLineSelect();
    updatePreview();
    updateButtonStates();
    updateAxisInstruction();
    draw();
    saveSession();
}
