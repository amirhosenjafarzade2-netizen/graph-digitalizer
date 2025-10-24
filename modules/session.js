// modules/session.js
import { state } from '../digitizer.js';
import { updateLineSelect, updatePreview, updateButtonStates, updateAxisInstruction } from './ui.js';
import { draw } from './canvas.js';
import { rgbToHex } from './color-detect.js';

export function saveSession() {
    const data = {
        lines: state.lines,
        axisPoints: state.axisPoints,
        scaleX: state.scaleX, scaleY: state.scaleY,
        offsetX: state.offsetX, offsetY: state.offsetY,
        logX: state.logX, logY: state.logY,
        isCalibrated: state.isCalibrated,
        zoom: state.zoom, panX: state.panX, panY: state.panY,
        showGrid: state.showGrid,
        mode: state.mode,
        currentLineIndex: state.currentLineIndex,
        magnifierZoom: state.magnifierZoom,
        autoCenter: state.autoCenter,
        bgColor: state.bgColor,
        lineColor: state.lineColor,
        colorTolerance: state.colorTolerance,
        searchRadius: state.searchRadius
    };
    localStorage.setItem('digitizerState', JSON.stringify(data));
}

export function loadSession() {
    const raw = localStorage.getItem('digitizerState');
    if (!raw) return;

    try {
        const s = JSON.parse(raw);
        // apply defaults where missing
        state.lines = (s.lines||[]).map(l=>({
            name: l.name||'Line',
            points: (l.points||[]).map(p=>({...p})),
            sorted: !!l.sorted,
            orderCounter: l.orderCounter||0
        }));
        state.axisPoints = (s.axisPoints||[]).map(p=>({...p}));
        state.scaleX = s.scaleX||0; state.scaleY = s.scaleY||0;
        state.offsetX = s.offsetX||0; state.offsetY = s.offsetY||0;
        state.logX = s.logX||false; state.logY = s.logY||false;
        state.isCalibrated = !!s.isCalibrated;
        state.zoom = s.zoom||1; state.panX = s.panX||0; state.panY = s.panY||0;
        state.showGrid = !!s.showGrid;
        state.mode = s.mode||'none';
        state.currentLineIndex = s.currentLineIndex||0;
        state.magnifierZoom = s.magnifierZoom||2;
        state.autoCenter = !!s.autoCenter;
        state.bgColor = s.bgColor||{r:255,g:255,b:255};
        state.lineColor = s.lineColor||{r:0,g:0,b:0};
        state.colorTolerance = s.colorTolerance||30;
        state.searchRadius = s.searchRadius||20;

        // UI sync
        document.getElementById('auto-center').checked = state.autoCenter;
        document.getElementById('color-detection-controls').style.display = state.autoCenter?'block':'none';
        document.getElementById('bg-color').value = rgbToHex(state.bgColor);
        document.getElementById('line-color').value = rgbToHex(state.lineColor);
        document.getElementById('color-tolerance').value = state.colorTolerance;
        document.getElementById('search-radius').value = state.searchRadius;
        document.getElementById('magnifier-zoom').value = state.magnifierZoom;
        document.getElementById('toggle-log-x').classList.toggle('log-active', state.logX);
        document.getElementById('toggle-log-y').classList.toggle('log-active', state.logY);

        updateLineSelect();
        updatePreview();
        updateButtonStates();
        updateAxisInstruction();
        draw();
    } catch (e) {
        console.error('Failed to load session', e);
    }
}
