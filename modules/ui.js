// modules/ui.js
import { state } from '../digitizer.js';
import { draw, getCanvasCoords } from './canvas.js';
import { toggleLogX, toggleLogY } from './calibration.js';
import { undo, redo } from './history.js';
import { exportJson, exportCsv, exportXlsx, importJson } from './io.js';
import { saveSession } from './session.js';
import { showModal, showSpinner, debounce } from './utils.js';

export function initUI() {
    state.ui = {
        imageUpload: document.getElementById('image-upload'),
        setAxesBtn: document.getElementById('set-axes'),
        resetAxisPointsBtn: document.getElementById('reset-axis-points'),
        axisInputs: document.getElementById('axis-inputs'),
        axisInstruction: document.getElementById('axis-instruction'),
        calibrateBtn: document.getElementById('calibrate'),
        resetCalibrationBtn: document.getElementById('reset-calibration'),
        toggleGridBtn: document.getElementById('toggle-grid'),
        toggleLogXBtn: document.getElementById('toggle-log-x'),
        toggleLogYBtn: document.getElementById('toggle-log-y'),
        addPointBtn: document.getElementById('add-point'),
        adjustPointBtn: document.getElementById('adjust-point'),
        deletePointBtn: document.getElementById('delete-point'),
        highlightLineBtn: document.getElementById('highlight-line'),
        highlightControls: document.getElementById('highlight-controls'),
        nPointsInput: document.getElementById('n-points'),
        deleteHighlightBtn: document.getElementById('delete-highlight'),
        clearPointsBtn: document.getElementById('clear-points'),
        sortPointsBtn: document.getElementById('sort-points'),
        newLineBtn: document.getElementById('new-line'),
        renameBtn: document.getElementById('rename-line'),
        lineSelect: document.getElementById('line-select'),
        importJsonBtn: document.getElementById('import-json'),
        importJsonInput: document.getElementById('import-json-input'),
        exportJsonBtn: document.getElementById('export-json'),
        exportCsvBtn: document.getElementById('export-csv'),
        exportXlsxBtn: document.getElementById('export-xlsx'),
        clearSessionBtn: document.getElementById('clear-session'),
        undoBtn: document.getElementById('undo'),
        redoBtn: document.getElementById('redo'),
        previewTable: document.getElementById('preview-table'),
        statusBar: document.getElementById('status-bar'),
        magnifierZoom: document.getElementById('magnifier-zoom'),
        // color detection
        autoCenterChk: document.getElementById('auto-center'),
        colorDetectCtrls: document.getElementById('color-detection-controls'),
        bgColorInput: document.getElementById('bg-color'),
        lineColorInput: document.getElementById('line-color'),
        toleranceInput: document.getElementById('color-tolerance'),
        radiusInput: document.getElementById('search-radius')
    };
}

export function bindButtons() {
    const u = state.ui;

    // ---- View -------------------------------------------------------
    document.getElementById('zoom-in').onclick = () => { state.zoom *= 1.2; draw(); saveSession(); };
    document.getElementById('zoom-out').onclick = () => { state.zoom /= 1.2; draw(); saveSession(); };
    document.getElementById('reset-view').onclick = () => { state.zoom = 1; state.panX = 0; state.panY = 0; draw(); saveSession(); };
    document.getElementById('pan-mode').onclick = () => { state.isPanning = !state.isPanning; };
    document.getElementById('toggle-theme').onclick = () => document.body.classList.toggle('dark');

    u.magnifierZoom.addEventListener('input', e => {
        state.magnifierZoom = parseFloat(e.target.value);
        saveSession();
        draw();
    });

    // ---- Image Upload (FIXED!) --------------------------------------
    u.imageUpload.onchange = e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => loadImage(ev.target.result);
        reader.readAsDataURL(file);
    };

    // ---- Calibration ------------------------------------------------
    u.setAxesBtn.onclick = () => setMode('axes');
    u.resetAxisPointsBtn.onclick = () => {
        state.axisPoints = [];
        updateAxisInstruction();
        draw();
        saveSession();
    };
    u.calibrateBtn.onclick = () => import('./calibration.js').then(mod => mod.calibrate());
    u.resetCalibrationBtn.onclick = () => import('./calibration.js').then(mod => mod.resetCalibration());
    u.toggleGridBtn.onclick = () => { state.showGrid = !state.showGrid; draw(); saveSession(); };
    u.toggleLogXBtn.onclick = toggleLogX;
    u.toggleLogYBtn.onclick = toggleLogY;

    // ---- Point actions ----------------------------------------------
    u.addPointBtn.onclick = () => setMode('add');
    u.adjustPointBtn.onclick = () => setMode('adjust');
    u.deletePointBtn.onclick = () => setMode('delete');
    u.highlightLineBtn.onclick = () => setMode('highlight');
    u.deleteHighlightBtn.onclick = () => import('./points.js').then(mod => mod.deleteHighlight());
    u.clearPointsBtn.onclick = () => import('./points.js').then(mod => mod.clearCurrentLine());
    u.sortPointsBtn.onclick = () => import('./points.js').then(mod => mod.sortCurrentLine());

    // ---- Line management --------------------------------------------
    u.newLineBtn.onclick = () => {
        const name = prompt('New line name:', `Line ${state.lines.length + 1}`);
        if (name) {
            state.lines.push({ name, points: [], sorted: false, orderCounter: 0 });
            state.currentLineIndex = state.lines.length - 1;
            updateLineSelect();
            updatePreview();
            draw();
            saveSession();
        }
    };
    u.renameBtn.onclick = () => {
        const line = state.lines[state.currentLineIndex];
        const name = prompt('Rename line:', line.name);
        if (name) {
            line.name = name;
            updateLineSelect();
            updatePreview();
            draw();
            saveSession();
        }
    };
    u.lineSelect.onchange = () => {
        state.currentLineIndex = u.lineSelect.selectedIndex;
        updatePreview();
        u.sortPointsBtn.classList.toggle('sort-active', state.lines[state.currentLineIndex].sorted);
        draw();
        saveSession();
    };

    // ---- Data -------------------------------------------------------
    u.importJsonBtn.onclick = () => u.importJsonInput.click();
    u.importJsonInput.onchange = e => importJson(e.target.files[0]);
    u.exportJsonBtn.onclick = exportJson;
    u.exportCsvBtn.onclick = exportCsv;
    u.exportXlsxBtn.onclick = exportXlsx;
    u.clearSessionBtn.onclick = () => {
        if (confirm('Clear everything (including saved session)?')) {
            localStorage.removeItem('digitizerState');
            location.reload();
        }
    };

    // ---- History ----------------------------------------------------
    u.undoBtn.onclick = undo;
    u.redoBtn.onclick = redo;

    // ---- Color detection --------------------------------------------
    u.autoCenterChk.onchange = () => {
        state.autoCenter = u.autoCenterChk.checked;
        u.colorDetectCtrls.style.display = state.autoCenter ? 'block' : 'none';
        saveSession();
    };
    u.bgColorInput.oninput = () => {
        state.bgColor = hexToRgb(u.bgColorInput.value);
        saveSession();
    };
    u.lineColorInput.oninput = () => {
        state.lineColor = hexToRgb(u.lineColorInput.value);
        saveSession();
    };
    u.toleranceInput.oninput = () => {
        state.colorTolerance = parseInt(u.toleranceInput.value);
        saveSession();
    };
    u.radiusInput.oninput = () => {
        state.searchRadius = parseInt(u.radiusInput.value);
        saveSession();
    };
}

export function setMode(newMode) {
    state.mode = newMode;
    updateButtonStates();
    state.ui.highlightControls.style.display = (newMode === 'highlight') ? 'block' : 'none';
    state.ui.axisInputs.style.display = (newMode === 'axes' && state.axisPoints.length > 0 && !state.isCalibrated) ? 'block' : 'none';
    updateAxisInstruction();
    draw();
    saveSession();
}

export function updateButtonStates() {
    const u = state.ui;
    const calibrated = state.isCalibrated;

    u.addPointBtn.classList.toggle('active', state.mode === 'add');
    u.adjustPointBtn.classList.toggle('active', state.mode === 'adjust');
    u.deletePointBtn.classList.toggle('active', state.mode === 'delete');
    u.highlightLineBtn.classList.toggle('active', state.mode === 'highlight');

    u.addPointBtn.disabled = !calibrated;
    u.adjustPointBtn.disabled = !calibrated;
    u.deletePointBtn.disabled = !calibrated;
    u.highlightLineBtn.disabled = !calibrated;
    u.clearPointsBtn.disabled = !calibrated;
    u.sortPointsBtn.disabled = !calibrated;
    u.newLineBtn.disabled = !calibrated;
    u.renameBtn.disabled = !calibrated;
}

export function updateLineSelect() {
    const sel = state.ui.lineSelect;
    sel.innerHTML = '';
    state.lines.forEach((l, i) => {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = l.name;
        if (i === state.currentLineIndex) opt.selected = true;
        sel.appendChild(opt);
    });
}

export function updatePreview() {
    const tbl = state.ui.previewTable;
    tbl.innerHTML = '';
    const line = state.lines[state.currentLineIndex];
    if (!line.points.length) {
        tbl.innerHTML = '<tr><td colspan="2">No points</td></tr>';
        return;
    }

    const sorted = line960.sorted
        ? [...line.points].sort((a, b) => a.dataX - b.dataX)
        : [...line.points].sort((a, b) => a.order - b.order);

    const header = tbl.insertRow();
    header.innerHTML = '<th>X</thРУ<th>Y</th>';

    sorted.forEach(p => {
        const row = tbl.insertRow();
        row.innerHTML = `<td>${p.dataX?.toFixed(6) ?? ''}</td><td>${p.dataY?.toFixed(6) ?? ''}</td>`;
    });
}

export function updateAxisInstruction() {
    const instr = state.ui.axisInstruction;
    if (state.isCalibrated) {
        instr.textContent = 'Calibration complete. Select a mode to digitize.';
        return;
    }
    const needed = document.getElementById('shared-origin').checked ? 3 : 4;
    if (state.axisPoints.length < needed) {
        const labels = document.getElementById('shared-origin').checked && state.axisPoints.length === 0
            ? ['Shared Origin (X1/Y1)']
            : ['X1', 'X2', 'Y1', 'Y2'];
        instr.textContent = `Click point for ${labels[state.axisPoints.length]} on the chart.`;
    } else {
        instr.textContent = 'Enter axis values and click Calibrate.';
    }
}

// ---------------------------------------------------------------------
// Image loading (FIXED!)
export function loadImage(dataUrl) {
    showSpinner(true);
    state.img.src = dataUrl;
    state.img.onload = () => {
        const maxW = window.innerWidth * 0.75;
        const ratio = state.img.naturalHeight / state.img.naturalWidth;
        state.canvas.width = Math.min(state.img.naturalWidth, maxW);
        state.canvas.height = state.canvas.width * ratio;

        state.zoom = 1;
        state.panX = 0;
        state.panY = 0;
        draw();
        state.ui.setAxesBtn.disabled = false;
        state.ui.resetAxisPointsBtn.disabled = false;
        saveSession();
        showSpinner(false);
    };
    state.img.onerror = () => {
        showModal('Failed to load image.');
        showSpinner(false);
    };
}

// ---------------------------------------------------------------------
// Color helpers (used in session & UI)
export function hexToRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : null;
}

export function rgbToHex(c) {
    return '#' + [c.r, c.g, c.b].map(v => v.toString(16).padStart(2, '0')).join('');
}
