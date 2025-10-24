// modules/calibration.js
import { state } from '../digitizer.js';
import { getCanvasCoords, draw, flashCenter } from './canvas.js';
import { findLineCenter } from './color-detect.js';
import { saveState, saveSession } from './session.js';
import { updateAxisInstruction, updateButtonStates } from './ui.js';
import { showModal } from './utils.js';

export function initCalibration() {
    // nothing special – UI already bound in ui.js
}

export function handleAxisClick(e) {
    const {x: clientX, y: clientY} = e;
    const {x, y} = getCanvasCoords(clientX, clientY);
    const snapped = state.autoCenter ? findLineCenter(x, y) : {x, y};
    state.axisPoints.push(snapped);
    flashCenter(snapped.x * state.zoom + state.panX,
                snapped.y * state.zoom + state.panY);
    updateAxisInstruction();
    draw();
    saveSession();
}

export function calibrate() {
    const shared = document.getElementById('shared-origin').checked;
    const needed = shared ? 3 : 4;
    if (state.axisPoints.length < needed) { showModal('Not enough axis points.'); return; }

    const x1v = parseFloat(document.getElementById('x1-value').value);
    const x2v = parseFloat(document.getElementById('x2-value').value);
    const y1v = parseFloat(document.getElementById('y1-value').value);
    const y2v = parseFloat(document.getElementById('y2-value').value);
    if ([x1v,x2v,y1v,y2v].some(v=>isNaN(v))) { showModal('Invalid axis values.'); return; }

    const p = state.axisPoints;
    const px1 = p[0].x, py1 = p[0].y;
    const px2 = shared ? p[1].x : p[1].x;
    const py2 = shared ? p[2].y : p[3].y;

    // simple linear scaling
    state.scaleX  = (x2v - x1v) / (px2 - px1);
    state.offsetX = x1v - state.scaleX * px1;
    state.scaleY  = (y2v - y1v) / (py2 - py1);
    state.offsetY = y1v - state.scaleY * py1;

    state.isCalibrated = true;
    state.ui.axisInputs.style.display = 'none';
    updateAxisInstruction();
    updateButtonStates();
    draw();
    saveState();
    saveSession();
}

export function resetCalibration() {
    if (!confirm('Reset calibration and all data?')) return;
    state.axisPoints = [];
    state.isCalibrated = false;
    state.scaleX = state.scaleY = state.offsetX = state.offsetY = 0;
    state.lines.forEach(l=>l.points=[]);
    state.ui.axisInputs.style.display = 'none';
    updateAxisInstruction();
    updateButtonStates();
    draw();
    saveState();
    saveSession();
}

export function toggleLogX() {
    state.logX = !state.logX;
    document.getElementById('toggle-log-x').classList.toggle('log-active', state.logX);
    draw();
    saveSession();
}
export function toggleLogY() {
    state.logY = !state.logY;
    document.getElementById('toggle-log-y').classList.toggle('log-active', state.logY);
    draw();
    saveSession();
}
