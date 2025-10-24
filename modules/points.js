// modules/points.js
import { state } from '../digitizer.js';
import { getCanvasCoords, draw, flashCenter } from './canvas.js';
import { findLineCenter } from './color-detect.js';
import { saveState, saveSession } from './session.js';
import { updatePreview, updateButtonStates } from './ui.js';
import { showModal } from './utils.js';

export function initPoints() {}

export function handlePointClick(e) {
    const {x: cx, y: cy} = getCanvasCoords(e.clientX, e.clientY);
    const snapped = state.autoCenter ? findLineCenter(cx, cy) : {x:cx, y:cy};

    const line = state.lines[state.currentLineIndex];
    const order = ++line.orderCounter;

    if (state.mode === 'add') {
        const p = {x: snapped.x, y: snapped.y, order};
        convertToData(p);
        line.points.push(p);
        flashCenter(snapped.x * state.zoom + state.panX,
                    snapped.y * state.zoom + state.panY);
    }
    else if (state.mode === 'adjust') {
        const idx = nearestPointIndex(snapped.x, snapped.y);
        if (idx >= 0) {
            line.points[idx].x = snapped.x;
            line.points[idx].y = snapped.y;
            convertToData(line.points[idx]);
        }
    }
    else if (state.mode === 'delete') {
        const idx = nearestPointIndex(snapped.x, snapped.y);
        if (idx >= 0) line.points.splice(idx,1);
    }

    updatePreview();
    draw();
    saveState();
    saveSession();
}

// ---------------------------------------------------------------------
// Highlight line (free-hand tracing)
let lastHighlight = null;
export function startHighlight(e) {
    state.isHighlighting = true;
    state.highlightPath = [];
    moveHighlight(e);
}
export function moveHighlight(e) {
    if (!state.isHighlighting) return;
    const {x, y} = getCanvasCoords(e.clientX, e.clientY);
    const snapped = state.autoCenter ? findLineCenter(x, y) : {x, y};
    if (lastHighlight && distance(lastHighlight, snapped) < 3) return;
    state.highlightPath.push(snapped);
    lastHighlight = snapped;
    draw();
}
export function endHighlight() {
    if (!state.isHighlighting) return;
    state.isHighlighting = false;
    interpolateHighlight();
    lastHighlight = null;
}
function interpolateHighlight() {
    const n = parseInt(state.ui.nPointsInput.value) || 5;
    if (state.highlightPath.length < 2) return;
    const line = state.lines[state.currentLineIndex];
    const segs = state.highlightPath.length - 1;
    for (let i = 0; i < segs; i++) {
        const a = state.highlightPath[i];
        const b = state.highlightPath[i+1];
        for (let j = 0; j <= n; j++) {
            const t = j / n;
            const p = {x: a.x + t*(b.x-a.x), y: a.y + t*(b.y-a.y), order: ++line.orderCounter};
            convertToData(p);
            line.points.push(p);
        }
    }
    state.highlightPath = [];
    updatePreview();
    draw();
    saveState();
    saveSession();
}
export function deleteHighlight() {
    state.highlightPath = [];
    draw();
}

// ---------------------------------------------------------------------
export function clearCurrentLine() {
    if (!confirm('Clear all points in current line?')) return;
    state.lines[state.currentLineIndex].points = [];
    state.lines[state.currentLineIndex].orderCounter = 0;
    updatePreview();
    draw();
    saveState();
    saveSession();
}
export function sortCurrentLine() {
    const line = state.lines[state.currentLineIndex];
    line.sorted = !line.sorted;
    state.ui.sortPointsBtn.classList.toggle('sort-active', line.sorted);
    updatePreview();
    draw();
    saveSession();
}

// ---------------------------------------------------------------------
// Helpers
function nearestPointIndex(px, py, threshold = 15) {
    const line = state.lines[state.currentLineIndex];
    let best = -1, bestDist = Infinity;
    line.points.forEach((p,i) => {
        const d = distance(p, {x:px, y:py});
        if (d < threshold && d < bestDist) { bestDist = d; best = i; }
    });
    return best;
}
function distance(a,b){ return Math.hypot(a.x-b.x, a.y-b.y); }

function convertToData(p) {
    // linear (log handled in export)
    p.dataX = state.scaleX * p.x + state.offsetX;
    p.dataY = state.scaleY * p.y + state.offsetY;
}
