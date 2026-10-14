/**********************
 * DIGITIZER CORE
 * Handles: state, session, coordinate math, drawing, calibration,
 *          history, image loading, view (zoom/pan/fit)
 *
 * MAJOR CHANGES IN THIS VERSION
 *  A. COORDINATE SPACE = IMAGE PIXELS. Points are stored in image-pixel
 *     coordinates, so they never drift when the window is resized.
 *  B. The <canvas> now fills the whole canvas area (no more unused grey
 *     space). The image is fitted/centred inside it and can be zoomed/panned.
 *  C. draw() is coalesced with requestAnimationFrame (it used to be a
 *     debounce, which delayed every frame until the mouse stopped = laggy pan).
 *  D. Brightness/contrast/grid-filter are rendered ONCE into an off-screen
 *     canvas (enhancedCanvas) and re-used for every frame and the magnifier.
 *  E. Grid filter blur is now a fast separable box blur (O(n) instead of O(n*r^2)).
 *  F. Session saving is debounced (localStorage no longer written per frame).
 *  G. Unified "in effect" button style (grey + white text) for every toggle.
 *  H. Snap target can be a user-chosen colour (see digitizer-tools.js).
 **********************/

/**********************
 * GLOBAL STATE
 **********************/
const canvas          = document.getElementById('canvas');
const ctx             = canvas.getContext('2d');
const canvasContainer = document.getElementById('canvas-container');
const magnifier       = document.getElementById('magnifier');
const magCtx          = magnifier.getContext('2d');

let img = new Image();
let rawImageData = null;        // original pixel data, never mutated
let processedImageData = null;  // brightness/contrast/grid-filtered pixels (used by snap & auto-trace)

// Off-screen canvases
const offCanvas      = document.createElement('canvas');   // raw pixel sampling
const offCtx         = offCanvas.getContext('2d', { willReadFrequently: true });
const enhancedCanvas = document.createElement('canvas');   // what is actually shown
const enhancedCtx    = enhancedCanvas.getContext('2d');

// View state. zoom/pan are in CSS pixels; world space == image pixels.
let zoom = 1, panX = 0, panY = 0;
let viewW = 0, viewH = 0, dpr = 1;
const MIN_ZOOM = 0.02, MAX_ZOOM = 60;

let isPanning = false, isPanDragging = false, startPan = { x: 0, y: 0 };
let axisPoints = [], isCalibrated = false, scaleX, scaleY, offsetX, offsetY;
let lines = [{ name: 'Line 1', points: [], sorted: false, orderCounter: 0 }], currentLineIndex = 0;
let mode = 'none'; // 'none','axes','add','adjust','delete','highlight'
let selectedPointIndex = -1;
let history = [], historyIndex = -1;
let showGrid = false, logX = false, logY = false;
let highlightPath = [], isHighlighting = false;
let isDraggingPoint = false;
let highlightWidth = 2;
let magnifierZoom = 2;

// Enhancement state
let brightnessVal = 100;
let contrastVal   = 100;
let snapToLine    = false;   // magnet on/off
let gridFilterOn  = false;

// Snap target settings
let snapColorMode  = 'dark';     // 'dark' | 'custom'
let snapColor      = '#ff0000';  // used when snapColorMode === 'custom'
let snapTolerance  = 60;         // RGB distance for custom colour
let pickingSnapColor = false;    // snap-color eyedropper active
let pickingDetectorColor = false; // detector eyedropper active

const COORD_SPACE = 'image';     // marker saved with sessions / exports

const lineColors = ['blue', 'green', 'red', 'purple', 'orange', 'brown', 'pink', 'gray'];
const axisLabels  = ['X1', 'X2', 'Y1', 'Y2'];

/**********************
 * UI ELEMENT REFS
 **********************/
const imageUpload        = document.getElementById('image-upload');
const setAxesBtn         = document.getElementById('set-axes');
const resetAxisPointsBtn = document.getElementById('reset-axis-points');
const axisInputs         = document.getElementById('axis-inputs');
const orthogonalAxes     = document.getElementById('orthogonal-axes');
const sharedOrigin       = document.getElementById('shared-origin');
const axisInstruction    = document.getElementById('axis-instruction');
const calibrateBtn       = document.getElementById('calibrate');
const resetCalibrationBtn= document.getElementById('reset-calibration');
const toggleGridBtn      = document.getElementById('toggle-grid');
const toggleLogXBtn      = document.getElementById('toggle-log-x');
const toggleLogYBtn      = document.getElementById('toggle-log-y');
const panModeBtn         = document.getElementById('pan-mode');
const toggleThemeBtn     = document.getElementById('toggle-theme');
const addPointBtn        = document.getElementById('add-point');
const adjustPointBtn     = document.getElementById('adjust-point');
const deletePointBtn     = document.getElementById('delete-point');
const highlightLineBtn   = document.getElementById('highlight-line');
const highlightControls  = document.getElementById('highlight-controls');
const highlightLineName  = document.getElementById('highlight-line-name');
const nPointsInput       = document.getElementById('n-points');
const autoTraceCheckbox  = document.getElementById('auto-trace-toggle');
const deleteHighlightBtn = document.getElementById('delete-highlight');
const clearPointsBtn     = document.getElementById('clear-points');
const sortPointsBtn      = document.getElementById('sort-points');
const newLineBtn         = document.getElementById('new-line');
const renameLineBtn      = document.getElementById('rename-line');
const lineSelect         = document.getElementById('line-select');
const importJsonBtn      = document.getElementById('import-json');
const importJsonInput    = document.getElementById('import-json-input');
const exportJsonBtn      = document.getElementById('export-json');
const exportCsvBtn       = document.getElementById('export-csv');
const exportXlsxBtn      = document.getElementById('export-xlsx');
const exportImageBtn     = document.getElementById('export-image');
const clearSessionBtn    = document.getElementById('clear-session');
const undoBtn            = document.getElementById('undo');
const redoBtn            = document.getElementById('redo');
const previewTable       = document.getElementById('preview-table');
const statusBar          = document.getElementById('status-bar');
const pointList          = document.getElementById('point-list');

// Enhancement UI refs
const brightnessSlider   = document.getElementById('brightness-slider');
const contrastSlider     = document.getElementById('contrast-slider');
const snapToggle         = document.getElementById('snap-toggle');
const gridFilterToggle   = document.getElementById('grid-filter-toggle');
const snapModeSelect     = document.getElementById('snap-mode');
const snapColorInput     = document.getElementById('snap-color');
const snapPickBtn        = document.getElementById('snap-pick');
const snapTolSlider      = document.getElementById('snap-tol');
const snapCustomOptions  = document.getElementById('snap-custom-options');
const snapLive           = document.getElementById('snap-live');
const snapLiveHex        = document.getElementById('snap-live-hex');
const colorTip           = document.getElementById('color-tip');
const pickBanner         = document.getElementById('pick-banner');

/**********************
 * UTILITIES
 **********************/
function showModal(msg, withInput = false, callback = null) {
  const modal   = document.getElementById('modal');
  const content = document.getElementById('modal-content');
  content.innerHTML = '';
  const p = document.createElement('p');
  p.textContent = msg;
  content.appendChild(p);
  if (withInput) {
    const input = document.createElement('input');
    input.type = 'text';
    input.id   = 'modal-input';
    input.style.width = '100%';
    content.appendChild(input);
  }
  const btnContainer = document.createElement('div');
  btnContainer.style.cssText = 'display:flex;justify-content:center;gap:10px;';
  const okBtn = document.createElement('button');
  okBtn.textContent = 'OK';
  okBtn.style.padding = '8px 20px';
  okBtn.onclick = () => {
    modal.style.display = 'none';
    if (callback) callback(withInput ? document.getElementById('modal-input').value : null);
  };
  btnContainer.appendChild(okBtn);
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.padding = '8px 20px';
  cancelBtn.onclick = () => { modal.style.display = 'none'; };
  btnContainer.appendChild(cancelBtn);
  content.appendChild(btnContainer);
  modal.style.display = 'flex';
  if (withInput) {
    const inp = document.getElementById('modal-input');
    inp.focus();
    inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') okBtn.click(); });
  }
}

function showSpinner(on) { document.getElementById('spinner').style.display = on ? 'block' : 'none'; }

function debounce(func, wait) {
  let timeout;
  const debounced = function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
  debounced.cancel = () => { clearTimeout(timeout); timeout = null; };
  return debounced;
}

function throttle(func, limit) {
  let inThrottle, lastFunc;
  return function (...args) {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => {
        inThrottle = false;
        if (lastFunc) { const f = lastFunc; lastFunc = null; f(); }
      }, limit);
    } else {
      lastFunc = () => func(...args);
    }
  };
}

function download(filename, text, mimeType) {
  // Blob URL (data: URLs can fail on large exports)
  const blob = new Blob([text], { type: `${mimeType};charset=utf-8` });
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Axis values typed in the calibration panel (kept in session/export so log-toggle works after reload). */
function getAxisValues() {
  return ['x1-value', 'x2-value', 'y1-value', 'y2-value'].map(id => document.getElementById(id).value);
}
function setAxisValues(vals) {
  if (!Array.isArray(vals)) return;
  ['x1-value', 'x2-value', 'y1-value', 'y2-value'].forEach((id, i) => {
    document.getElementById(id).value = vals[i] ?? '';
  });
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return { r: 255, g: 0, b: 0 };
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Show only the option panel that belongs to the current mode. */
function syncModePanels() {
  if (highlightControls) highlightControls.style.display = mode === 'highlight' ? 'block' : 'none';
  // Auto-Extract and Detect Markers panels were removed in the unified detector.
}

function hasImage() { return !!rawImageData; }
function imgW() { return rawImageData ? rawImageData.width  : 0; }
function imgH() { return rawImageData ? rawImageData.height : 0; }

/**********************
 * SESSION PERSISTENCE
 **********************/
function _saveSessionNow() {
  try {
    localStorage.setItem('digitizerState', JSON.stringify({
      coordSpace: COORD_SPACE,
      lines, axisPoints, scaleX, scaleY, offsetX, offsetY,
      logX, logY, isCalibrated, zoom, panX, panY,
      showGrid, mode, currentLineIndex, magnifierZoom,
      brightnessVal, contrastVal, snapToLine, gridFilterOn,
      snapColorMode, snapColor, snapTolerance,
      axisValues: getAxisValues()
    }));
  } catch (e) { console.warn('Could not save session:', e); }
}
// Debounced so wheel-zoom / dragging never hammers localStorage.
const saveSession = debounce(_saveSessionNow, 300);
window.addEventListener('beforeunload', _saveSessionNow);

function normalizeLines() {
  lines.forEach(line => {
    if (typeof line.sorted === 'undefined') line.sorted = false;
    if (typeof line.orderCounter === 'undefined') {
      let max = 0;
      line.points = line.points.map(p => {
        if (typeof p.order === 'undefined') p.order = ++max;
        else max = Math.max(max, p.order);
        return p;
      });
      line.orderCounter = max;
    }
  });
}

function warnIfLegacy(state) {
  if (state.coordSpace !== COORD_SPACE && (state.lines || []).some(l => l.points && l.points.length)) {
    showModal('This session was saved by an older version that stored positions relative to the window size. ' +
              'Data values are intact, but points may appear offset on the image. Re-calibrate / re-digitize if needed.');
  }
}

function syncSnapUI() {
  snapToggle.checked       = snapToLine;
  snapModeSelect.value     = snapColorMode;
  snapColorInput.value     = snapColor;
  snapTolSlider.value      = snapTolerance;
  document.getElementById('snap-tol-val').textContent = snapTolerance;
  snapCustomOptions.style.display = snapColorMode === 'custom' ? 'block' : 'none';
  snapPickBtn.classList.toggle('active', pickingSnapColor);
  snapPickBtn.textContent = pickingSnapColor ? '✖ Stop detecting (Esc)' : '🧪 Detect color';
  pickBanner.style.display = (pickingSnapColor || pickingDetectorColor) ? 'block' : 'none';
  pickBanner.innerHTML = pickingDetectorColor
    ? '🧪 Detector color picking ON — hover over the graph, <b>click</b> to sample, <b>Esc</b> to cancel'
    : '🧪 Color detection ON — hover over the graph, <b>click</b> to use the color, <b>Esc</b> to cancel';
}

/** Hide the eyedropper tooltip and reset the live preview text. */
function hideColorTip() {
  colorTip.style.display = 'none';
  snapLive.style.background = '';
  snapLiveHex.textContent = 'Hover over the graph while detecting…';
}

/** Turn the eyedropper on/off. */
function setPickingSnapColor(on) {
  pickingSnapColor = !!on;
  if (pickingSnapColor) { pickingDetectorColor = false; isPanning = false; isPanDragging = false; }
  if (!pickingSnapColor) hideColorTip();
  syncSnapUI();
  updateButtonStates();
}

/** Enable the shared graph eyedropper for the curve/scatter detector. */
function setPickingDetectorColor(on) {
  pickingDetectorColor = !!on;
  if (pickingDetectorColor) { pickingSnapColor = false; isPanning = false; isPanDragging = false; }
  hideColorTip();
  syncSnapUI();
  updateButtonStates();
  const help = document.getElementById('cd-pick-help');
  if (help) help.textContent = pickingDetectorColor
    ? 'Now click a pixel on the graph. Press Esc to cancel.'
    : 'Choose a target color with the color square or sample one directly from the graph.';
}
window.setPickingDetectorColor = setPickingDetectorColor;

/**
 * Live colour detection: sample the pixel under the pointer and show it in the
 * floating tooltip and the side panel. (cx, cy) = world/image coords.
 */
function updateColorPreview(clientX, clientY, cx, cy, tipOnly = false) {
  const pd = getPixelData();
  if (!pd) return;
  if (cx < 0 || cy < 0 || cx >= pd.width || cy >= pd.height) { colorTip.style.display = 'none'; return; }
  const i   = (Math.floor(cy) * pd.width + Math.floor(cx)) * 4;
  const hex = rgbToHex(pd.data[i], pd.data[i + 1], pd.data[i + 2]);
  if (!tipOnly) {
    snapLive.style.background = hex;
    snapLiveHex.textContent   = `${hex.toUpperCase()}  rgb(${pd.data[i]}, ${pd.data[i + 1]}, ${pd.data[i + 2]})`;
  }
  colorTip.querySelector('.swatch').style.background = hex;
  colorTip.querySelector('.tip-text').textContent = hex.toUpperCase();
  const rect = canvas.getBoundingClientRect();
  const mx = clientX - rect.left, my = clientY - rect.top;
  colorTip.style.display = 'flex';
  colorTip.style.left = Math.min(viewW - 110, Math.max(0, mx + 18)) + 'px';
  colorTip.style.top  = Math.max(0, my - 36) + 'px';
}

function loadSession() {
  const s = localStorage.getItem('digitizerState');
  axisInputs.style.display        = 'none';
  syncModePanels();
  if (s) {
    try {
      const state = JSON.parse(s);
      lines = state.lines || [{ name: 'Line 1', points: [], sorted: false, orderCounter: 0 }];
      normalizeLines();
      axisPoints      = state.axisPoints  || [];
      scaleX          = state.scaleX;
      scaleY          = state.scaleY;
      offsetX         = state.offsetX;
      offsetY         = state.offsetY;
      logX            = state.logX        || false;
      logY            = state.logY        || false;
      isCalibrated    = state.isCalibrated|| false;
      zoom            = state.zoom        || 1;
      panX            = state.panX        || 0;
      panY            = state.panY        || 0;
      showGrid        = state.showGrid    || false;
      currentLineIndex= state.currentLineIndex || 0;
      magnifierZoom   = state.magnifierZoom   || 2;
      brightnessVal   = state.brightnessVal   ?? 100;
      contrastVal     = state.contrastVal     ?? 100;
      snapToLine      = state.snapToLine      || false;
      gridFilterOn    = state.gridFilterOn    || false;
      snapColorMode   = state.snapColorMode   || 'dark';
      snapColor       = state.snapColor       || '#ff0000';
      snapTolerance   = state.snapTolerance   ?? 60;
      setAxisValues(state.axisValues);

      const savedMode = state.mode || 'none';
      const validModes = ['none', 'axes', 'add', 'adjust', 'delete', 'highlight'];
      mode = validModes.includes(savedMode) ? savedMode : 'none';
      if (!isCalibrated && ['add', 'adjust', 'delete', 'highlight'].includes(mode)) mode = 'none';

      updateLineSelect();
      updatePreview();
      updateButtonStates();
      document.getElementById('magnifier-zoom').value = magnifierZoom;
      brightnessSlider.value = brightnessVal;
      contrastSlider.value   = contrastVal;
      document.getElementById('brightness-val').textContent = brightnessVal + '%';
      document.getElementById('contrast-val').textContent   = contrastVal + '%';
      gridFilterToggle.checked = gridFilterOn;
      syncSnapUI();
      syncModePanels();
      axisInputs.style.display = isCalibrated ? 'none' : (mode === 'axes' && axisPoints.length > 0) ? 'block' : 'none';
      updateAxisLabels();
      _applyCalibrationButtonState();
      axisInstruction.textContent = isCalibrated
        ? 'Calibration complete. Select a mode to digitize.'
        : axisPoints.length < (sharedOrigin.checked ? 3 : 4)
          ? `Click point for ${sharedOrigin.checked && axisPoints.length === 0 ? 'Shared Origin (X1/Y1)' : axisLabels[axisPoints.length]} on the chart.`
          : 'Enter axis values and click Calibrate.';
      draw();
      warnIfLegacy(state);
    } catch (e) {
      console.error('Failed to load session:', e);
      showModal('Failed to load session. Starting fresh.');
      axisInputs.style.display        = 'none';
      syncModePanels();
    }
  }
}

function _applyCalibrationButtonState() {
  const en = isCalibrated;
  addPointBtn.disabled      = !en;
  adjustPointBtn.disabled   = !en;
  deletePointBtn.disabled   = !en;
  highlightLineBtn.disabled = !en;
  clearPointsBtn.disabled   = !en;
  sortPointsBtn.disabled    = !en;
  newLineBtn.disabled       = !en;
  renameLineBtn.disabled    = !en;
}

/**********************
 * HISTORY
 **********************/
function saveState() {
  history = history.slice(0, historyIndex + 1);
  history.push({
    lines:          JSON.parse(JSON.stringify(lines)),
    axisPoints:     JSON.parse(JSON.stringify(axisPoints)),
    scaleX, scaleY, offsetX, offsetY,
    logX, logY, isCalibrated,
    zoom, panX, panY, showGrid, mode, currentLineIndex, magnifierZoom,
    highlightPath:  JSON.parse(JSON.stringify(highlightPath)),
    isHighlighting
  });
  if (history.length > 200) { history.shift(); historyIndex--; }
  historyIndex++;
  undoBtn.disabled = historyIndex <= 0;
  redoBtn.disabled = historyIndex >= history.length - 1;
  saveSession();
}

function _restoreState(state) {
  lines          = JSON.parse(JSON.stringify(state.lines));
  axisPoints     = JSON.parse(JSON.stringify(state.axisPoints));
  scaleX         = state.scaleX;
  scaleY         = state.scaleY;
  offsetX        = state.offsetX;
  offsetY        = state.offsetY;
  logX           = state.logX;
  logY           = state.logY;
  isCalibrated   = state.isCalibrated;
  // NOTE: zoom/pan are deliberately NOT restored by undo/redo – undo should
  // change data, not yank the view around.
  showGrid       = state.showGrid;
  mode           = state.mode;
  currentLineIndex = state.currentLineIndex;
  magnifierZoom  = state.magnifierZoom;
  highlightPath  = state.highlightPath  || [];
  isHighlighting = state.isHighlighting || false;
  selectedPointIndex = -1;
  document.getElementById('magnifier-zoom').value = magnifierZoom;
  updateLineSelect();
  updatePreview();
  _applyCalibrationButtonState();
  updateButtonStates();
  syncModePanels();
  axisInputs.style.display = isCalibrated ? 'none' : (mode === 'axes' && axisPoints.length > 0) ? 'block' : 'none';
  updateAxisLabels();
  calibrateBtn.disabled = axisPoints.length !== (sharedOrigin.checked ? 3 : 4);
  axisInstruction.textContent = isCalibrated
    ? 'Calibration complete. Select a mode to digitize.'
    : axisPoints.length < (sharedOrigin.checked ? 3 : 4)
      ? `Click point for ${sharedOrigin.checked && axisPoints.length === 0 ? 'Shared Origin (X1/Y1)' : axisLabels[axisPoints.length]} on the chart.`
      : 'Enter axis values and click Calibrate.';
  draw();
  saveSession();
  if (typeof refreshToolPreview === 'function') refreshToolPreview();
}

undoBtn.addEventListener('click', () => {
  if (historyIndex > 0) { historyIndex--; _restoreState(history[historyIndex]); }
  undoBtn.disabled = historyIndex <= 0;
  redoBtn.disabled = historyIndex >= history.length - 1;
});

redoBtn.addEventListener('click', () => {
  if (historyIndex < history.length - 1) { historyIndex++; _restoreState(history[historyIndex]); }
  undoBtn.disabled = historyIndex <= 0;
  redoBtn.disabled = historyIndex >= history.length - 1;
});

/**********************
 * VIEW: sizing, fit, zoom
 **********************/
function resizeCanvas(forceFit = false) {
  const nw = Math.max(1, Math.floor(canvasContainer.clientWidth));
  const nh = Math.max(1, Math.floor(canvasContainer.clientHeight));
  dpr = window.devicePixelRatio || 1;

  // Keep the image centre stable while the window is resized.
  if (!forceFit && viewW && hasImage()) {
    panX += (nw - viewW) / 2;
    panY += (nh - viewH) / 2;
  }
  viewW = nw; viewH = nh;
  canvas.style.width  = nw + 'px';
  canvas.style.height = nh + 'px';
  canvas.width  = Math.round(nw * dpr);
  canvas.height = Math.round(nh * dpr);
  if (forceFit) fitView();
  render(); // synchronous – assigning canvas.width cleared it
}

function fitView() {
  if (!hasImage() || !viewW) { zoom = 1; panX = 0; panY = 0; return; }
  const margin = 0.98;
  zoom = Math.min(viewW / imgW(), viewH / imgH()) * margin;
  panX = (viewW - imgW() * zoom) / 2;
  panY = (viewH - imgH() * zoom) / 2;
}

function zoomAt(factor, cx = viewW / 2, cy = viewH / 2) {
  const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor));
  const ratio = newZoom / zoom;
  panX = cx - (cx - panX) * ratio;
  panY = cy - (cy - panY) * ratio;
  zoom = newZoom;
  draw(); saveSession();
}

if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(() => resizeCanvas(false)).observe(canvasContainer);
} else {
  window.addEventListener('resize', () => resizeCanvas(false));
}

/**********************
 * IMAGE LOADING & ENHANCEMENT
 **********************/
function loadImage(dataUrl) {
  showSpinner(true);
  const newImg = new Image();
  newImg.onload = () => {
    if (newImg.naturalWidth <= 0 || newImg.naturalHeight <= 0) {
      showModal('Image has invalid dimensions.');
      showSpinner(false);
      return;
    }
    img = newImg;
    offCanvas.width  = img.naturalWidth;
    offCanvas.height = img.naturalHeight;
    offCtx.drawImage(img, 0, 0);
    rawImageData = offCtx.getImageData(0, 0, offCanvas.width, offCanvas.height);
    buildProcessedImageData();
    resizeCanvas(true);   // fits the image to the full canvas area
    setAxesBtn.disabled         = false;
    resetAxisPointsBtn.disabled = false;
    saveState();
    _saveSessionNow();
    showSpinner(false);
    document.dispatchEvent(new Event('imageLoaded'));
    if (typeof window.refreshCurveDetectorState === 'function') window.refreshCurveDetectorState();
  };
  newImg.onerror = () => {
    showModal('Failed to load image.');
    showSpinner(false);
  };
  newImg.src = dataUrl;
}

/** Fast separable box blur on RGB (alpha forced to 255). */
function boxBlurRGB(src, w, h, r) {
  const tmp = new Uint8ClampedArray(src.length);
  const out = new Uint8ClampedArray(src.length);
  // horizontal
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let ch = 0; ch < 3; ch++) {
      let sum = 0;
      for (let x = 0, e = Math.min(r, w - 1); x <= e; x++) sum += src[row + x * 4 + ch];
      for (let x = 0; x < w; x++) {
        const lo = Math.max(0, x - r), hi = Math.min(w - 1, x + r);
        tmp[row + x * 4 + ch] = sum / (hi - lo + 1);
        if (x + r + 1 < w) sum += src[row + (x + r + 1) * 4 + ch];
        if (x - r >= 0)    sum -= src[row + (x - r) * 4 + ch];
      }
    }
  }
  // vertical
  const stride = w * 4;
  for (let x = 0; x < w; x++) {
    for (let ch = 0; ch < 3; ch++) {
      const col = x * 4 + ch;
      let sum = 0;
      for (let y = 0, e = Math.min(r, h - 1); y <= e; y++) sum += tmp[y * stride + col];
      for (let y = 0; y < h; y++) {
        const lo = Math.max(0, y - r), hi = Math.min(h - 1, y + r);
        out[y * stride + col] = sum / (hi - lo + 1);
        if (y + r + 1 < h) sum += tmp[(y + r + 1) * stride + col];
        if (y - r >= 0)    sum -= tmp[(y - r) * stride + col];
      }
    }
  }
  for (let i = 3; i < out.length; i += 4) out[i] = 255;
  return out;
}

/**
 * Recompute processedImageData (brightness, contrast, grid filter) AND the
 * enhancedCanvas that is displayed. What you see is exactly what snap and
 * auto-trace sample.
 */
function buildProcessedImageData() {
  if (!rawImageData) { processedImageData = null; return; }
  const src = rawImageData.data, w = rawImageData.width, h = rawImageData.height, len = src.length;
  const bF = brightnessVal / 100, cF = contrastVal / 100;
  const bcData = new Uint8ClampedArray(len);
  for (let i = 0; i < len; i += 4) {
    for (let ch = 0; ch < 3; ch++) {
      let v = src[i + ch] * bF;
      v = (v - 128) * cF + 128;
      bcData[i + ch] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
    bcData[i + 3] = src[i + 3];
  }

  if (gridFilterOn) {
    const blurred = boxBlurRGB(bcData, w, h, 3);
    const out = new Uint8ClampedArray(len);
    for (let i = 0; i < len; i += 4) {
      for (let ch = 0; ch < 3; ch++) {
        const a = bcData[i + ch] / 255, b = blurred[i + ch] / 255;
        const s = 1 - (1 - a) * (1 - b);
        out[i + ch] = Math.round((a + 0.35 * (s - a)) * 255);
      }
      out[i + 3] = bcData[i + 3];
    }
    processedImageData = new ImageData(out, w, h);
  } else {
    processedImageData = new ImageData(bcData, w, h);
  }

  enhancedCanvas.width  = w;
  enhancedCanvas.height = h;
  enhancedCtx.putImageData(processedImageData, 0, 0);
}

let _enhanceQueued = false;
function scheduleEnhance() {
  if (_enhanceQueued) return;
  _enhanceQueued = true;
  requestAnimationFrame(() => {
    _enhanceQueued = false;
    buildProcessedImageData();
    render();
    if (typeof refreshToolPreview === 'function') refreshToolPreview();
  });
}

function getPixelData() { return processedImageData || rawImageData; }

function getRawPixel(ix, iy) {
  if (!rawImageData) return null;
  const px = Math.floor(Math.max(0, Math.min(ix, rawImageData.width  - 1)));
  const py = Math.floor(Math.max(0, Math.min(iy, rawImageData.height - 1)));
  const i  = (py * rawImageData.width + px) * 4;
  return rawImageData.data.slice(i, i + 4);
}

/** World coords == image pixel coords now, so this is the identity. */
function canvasToImageCoords(cx, cy) { return { ix: cx, iy: cy }; }

/**********************
 * COORDINATE TRANSFORMS
 **********************/
/** Screen (client) → world (image-pixel) coordinates. */
function imageToCanvasCoords(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (clientX - rect.left - panX) / zoom,
    y: (clientY - rect.top  - panY) / zoom
  };
}

function canvasToDataCoords(x, y) {
  try {
    if (!isFinite(scaleX) || !isFinite(scaleY) || scaleX === 0 || scaleY === 0) return null;
    let dataX, dataY;
    if (logX) {
      dataX = Math.pow(10, (x - offsetX) / scaleX);
      if (!isFinite(dataX) || dataX <= 0) return null;
    } else {
      dataX = (x - offsetX) / scaleX;
      if (!isFinite(dataX)) return null;
    }
    if (logY) {
      dataY = Math.pow(10, (y - offsetY) / scaleY);
      if (!isFinite(dataY) || dataY <= 0) return null;
    } else {
      dataY = (y - offsetY) / scaleY;
      if (!isFinite(dataY)) return null;
    }
    return { dataX, dataY };
  } catch (e) {
    return null;
  }
}

/**********************
 * UI UPDATES
 **********************/
function updateAxisLabels() {
  const x1Label = document.querySelector('label[for="x1-value"]');
  const y1Label = document.querySelector('label[for="y1-value"]');
  if (sharedOrigin.checked) {
    if (x1Label) x1Label.textContent = 'Shared Origin X1:';
    if (y1Label) y1Label.textContent = 'Shared Origin Y1:';
  } else {
    if (x1Label) x1Label.textContent = 'X1:';
    if (y1Label) y1Label.textContent = 'Y1:';
  }
}

function updateLineSelect() {
  lineSelect.innerHTML = '';
  lines.forEach((line, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = '● ' + line.name;
    opt.style.color = line.color || lineColors[i % lineColors.length];
    lineSelect.appendChild(opt);
  });
  lineSelect.value = currentLineIndex;
}

function updatePreview() {
  // Preview table
  previewTable.innerHTML = '';
  if (lines.every(l => l.points.length === 0)) {
    previewTable.innerHTML = '<tr><td>No data</td></tr>';
  } else {
    lines.forEach(line => {
      if (!line.points.length) return;
      const nameRow = document.createElement('tr');
      nameRow.innerHTML = `<td colspan="2"><strong>${escapeHtml(line.name)}</strong></td>`;
      previewTable.appendChild(nameRow);
      const hdr = document.createElement('tr');
      hdr.innerHTML = '<td>X</td><td>Y</td>';
      previewTable.appendChild(hdr);
      line.points.forEach(p => {
        const row = document.createElement('tr');
        const dX  = isNaN(p.dataX) || !isFinite(p.dataX) ? 'NaN' : p.dataX.toFixed(6);
        const dY  = isNaN(p.dataY) || !isFinite(p.dataY) ? 'NaN' : p.dataY.toFixed(6);
        row.innerHTML = `<td>${dX}</td><td>${dY}</td>`;
        previewTable.appendChild(row);
      });
    });
  }

  updatePointList();
}

/** Sidebar "Points (current line)" list. Always rebuilt from scratch. */
function updatePointList() {
  if (pointList) {
    pointList.innerHTML = '';
    const line = lines[currentLineIndex];
    if (!line) return;
    const pts = line.sorted
      ? [...line.points].sort((a, b) => a.dataX - b.dataX)
      : [...line.points].sort((a, b) => a.order - b.order);
    pts.forEach((p, i) => {
      const div = document.createElement('div');
      div.className = 'point-item';
      div.textContent = `#${i + 1}: (${isNaN(p.dataX) ? 'NaN' : p.dataX.toFixed(4)}, ${isNaN(p.dataY) ? 'NaN' : p.dataY.toFixed(4)})`;
      pointList.appendChild(div);
    });
  }
}

function findNearestPointIndex(x, y) {
  let minDist = Infinity, closest = -1;
  lines[currentLineIndex].points.forEach((p, i) => {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < minDist && d < 10 / zoom) { minDist = d; closest = i; }
  });
  return closest;
}

/**
 * Single place that decides which buttons look "in effect" (grey + white text).
 * Every toggle in the app funnels through here.
 */
function updateButtonStates() {
  const on = (el, flag) => el && el.classList.toggle('active', !!flag);
  on(setAxesBtn,       mode === 'axes');
  on(addPointBtn,      mode === 'add');
  on(adjustPointBtn,   mode === 'adjust');
  on(deletePointBtn,   mode === 'delete');
  on(highlightLineBtn, mode === 'highlight');
  on(panModeBtn,       isPanning);
  on(toggleGridBtn,    showGrid);
  on(toggleLogXBtn,    logX);
  on(toggleLogYBtn,    logY);
  on(toggleThemeBtn,   document.body.classList.contains('dark'));
  on(sortPointsBtn,    lines[currentLineIndex] && lines[currentLineIndex].sorted);
  on(snapPickBtn,      pickingSnapColor);
  on(document.getElementById('cd-pick-color'), pickingDetectorColor);

  const activeModes = ['add', 'adjust', 'delete', 'highlight', 'axes'];
  if (isPanning)               canvas.style.cursor = isPanDragging ? 'grabbing' : 'grab';
  else if (pickingSnapColor || pickingDetectorColor) canvas.style.cursor = 'crosshair';
  else                         canvas.style.cursor = activeModes.includes(mode) ? 'crosshair' : 'default';
  statusBar.textContent = `Mode: ${isPanning ? 'pan' : mode}`;
}

/**********************
 * DRAWING
 **********************/

/** Draws grid, axis points, data points and highlight path. z = current zoom. */
function drawOverlays(c, z, W, H) {
  c.save();

  // Grid overlay
  const needPts = sharedOrigin.checked ? 3 : 4;
  if (isCalibrated && showGrid && axisPoints.length >= needPts) {
    c.strokeStyle = 'rgba(0,0,0,0.25)';
    c.lineWidth = 1 / z;

    const toX = px => logX ? Math.pow(10, (px - offsetX) / scaleX) : (px - offsetX) / scaleX;
    const toY = py => logY ? Math.pow(10, (py - offsetY) / scaleY) : (py - offsetY) / scaleY;
    const xA = toX(axisPoints[0].x), xB = toX(axisPoints[1].x);
    const xMin = Math.min(xA, xB), xMax = Math.max(xA, xB);
    const yIdx0 = sharedOrigin.checked ? 0 : 2;
    const yIdx1 = sharedOrigin.checked ? 2 : 3;
    const yA = toY(axisPoints[yIdx0].y), yB = toY(axisPoints[yIdx1].y);
    const yMin = Math.min(yA, yB), yMax = Math.max(yA, yB);
    const xStep = (xMax - xMin) / 10, yStep = (yMax - yMin) / 10;

    if (xStep > 0 && isFinite(xStep)) {
      for (let i = 0; i <= 10; i++) {
        const x = xMin + i * xStep;
        const px = logX ? Math.log10(x) * scaleX + offsetX : x * scaleX + offsetX;
        c.beginPath(); c.moveTo(px, 0); c.lineTo(px, H); c.stroke();
      }
    }
    if (yStep > 0 && isFinite(yStep)) {
      for (let i = 0; i <= 10; i++) {
        const y = yMin + i * yStep;
        const py = logY ? Math.log10(y) * scaleY + offsetY : y * scaleY + offsetY;
        c.beginPath(); c.moveTo(0, py); c.lineTo(W, py); c.stroke();
      }
    }
  }

  // Axis points
  c.fillStyle = 'red';
  c.font = `${12 / z}px Arial`;
  axisPoints.forEach((p, i) => {
    c.beginPath();
    c.arc(p.x, p.y, 5 / z, 0, 2 * Math.PI);
    c.fill();
    c.fillText(p.label || axisLabels[i], p.x + 8 / z, p.y - 8 / z);
  });

  // Data points
  lines.forEach((line, lineIdx) => {
    const col = line.color || lineColors[lineIdx % lineColors.length];
    line.points.forEach((p, i) => {
      // White halo -> coloured disc -> dark rim: stays visible even on a line of the SAME colour
      c.beginPath(); c.arc(p.x, p.y, 5 / z, 0, 2 * Math.PI);
      c.fillStyle = '#fff'; c.fill();
      c.beginPath(); c.arc(p.x, p.y, 3.4 / z, 0, 2 * Math.PI);
      c.fillStyle = col; c.fill();
      c.strokeStyle = 'rgba(0,0,0,0.7)'; c.lineWidth = 1 / z; c.stroke();
      if (lineIdx === currentLineIndex && i === selectedPointIndex) {
        c.beginPath(); c.arc(p.x, p.y, 5 / z, 0, 2 * Math.PI);
        c.strokeStyle = 'yellow'; c.lineWidth = 2 / z; c.stroke();
      }
    });
  });

  // Highlight path
  if (highlightPath.length > 1) {
    c.strokeStyle = 'rgba(255, 80, 0, 0.7)';
    c.lineWidth   = highlightWidth / z;
    c.lineCap     = 'round';
    c.lineJoin    = 'round';
    c.beginPath();
    c.moveTo(highlightPath[0].x, highlightPath[0].y);
    for (let i = 1; i < highlightPath.length; i++) c.lineTo(highlightPath[i].x, highlightPath[i].y);
    c.stroke();
  }

  c.restore();
}

function render() {
  if (!viewW) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!hasImage()) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#ccc';
    ctx.font = '16px Arial';
    ctx.fillText('No image loaded. Please upload an image.', 20, 36);
    return;
  }

  ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * panX, dpr * panY);
  ctx.imageSmoothingEnabled = zoom < 2;   // crisp pixels when zoomed in
  ctx.drawImage(enhancedCanvas, 0, 0);
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1 / zoom;
  ctx.strokeRect(0, 0, imgW(), imgH());
  drawOverlays(ctx, zoom, imgW(), imgH());
  if (typeof window.refreshCurveDetectorOverlay === 'function') window.refreshCurveDetectorOverlay();
}

// Coalesce any number of draw() calls into one render per animation frame.
let _drawQueued = false;
function draw() {
  if (_drawQueued) return;
  _drawQueued = true;
  requestAnimationFrame(() => { _drawQueued = false; render(); });
}

/**********************
 * MAGNIFIER
 **********************/
const drawMagnifier = throttle((clientX, clientY) => {
  if (!hasImage() || (mode === 'none' && !pickingSnapColor && !pickingDetectorColor) || isPanning || isPanDragging) {
    magnifier.style.display = 'none';
    return;
  }
  const rect   = canvas.getBoundingClientRect();
  const mouseX = clientX - rect.left;
  const mouseY = clientY - rect.top;
  const magW = magnifier.width, magH = magnifier.height;

  // Keep the magnifier inside the canvas area
  let left = mouseX + 16, top = mouseY + 16;
  if (left + magW + 4 > viewW) left = mouseX - 16 - magW;
  if (top  + magH + 4 > viewH) top  = mouseY - 16 - magH;
  magnifier.style.left    = `${Math.max(0, left)}px`;
  magnifier.style.top     = `${Math.max(0, top)}px`;
  magnifier.style.display = 'block';

  const { x, y } = imageToCanvasCoords(clientX, clientY); // image px
  const mz = magnifierZoom;
  const sw = magW / mz, sh = magH / mz;
  const sx0 = x - sw / 2, sy0 = y - sh / 2;

  magCtx.setTransform(1, 0, 0, 1, 0, 0);
  magCtx.clearRect(0, 0, magW, magH);
  magCtx.fillStyle = document.body.classList.contains('dark') ? '#222' : '#ddd';
  magCtx.fillRect(0, 0, magW, magH);
  magCtx.imageSmoothingEnabled = mz < 3;

  const ix0 = Math.max(0, sx0), iy0 = Math.max(0, sy0);
  const ix1 = Math.min(imgW(), sx0 + sw), iy1 = Math.min(imgH(), sy0 + sh);
  if (ix1 > ix0 && iy1 > iy0) {
    magCtx.drawImage(enhancedCanvas,
      ix0, iy0, ix1 - ix0, iy1 - iy0,
      (ix0 - sx0) * mz, (iy0 - sy0) * mz, (ix1 - ix0) * mz, (iy1 - iy0) * mz);
  }

  const toMagX = wx => (wx - x) * mz + magW / 2;
  const toMagY = wy => (wy - y) * mz + magH / 2;

  if (highlightPath.length > 1) {
    magCtx.strokeStyle = 'rgba(255, 80, 0, 0.85)';
    magCtx.lineWidth   = Math.max(1.5, highlightWidth * mz * 0.5);
    magCtx.lineCap = 'round'; magCtx.lineJoin = 'round';
    magCtx.beginPath();
    magCtx.moveTo(toMagX(highlightPath[0].x), toMagY(highlightPath[0].y));
    for (let i = 1; i < highlightPath.length; i++) magCtx.lineTo(toMagX(highlightPath[i].x), toMagY(highlightPath[i].y));
    magCtx.stroke();
  }

  axisPoints.forEach((p, i) => {
    const mx = toMagX(p.x), my = toMagY(p.y);
    magCtx.fillStyle = 'red';
    magCtx.beginPath(); magCtx.arc(mx, my, 5, 0, 2 * Math.PI); magCtx.fill();
    magCtx.fillStyle = 'white'; magCtx.font = '10px Arial';
    magCtx.fillText(p.label || axisLabels[i], mx + 7, my - 7);
  });

  lines.forEach((line, lineIdx) => {
    const col = line.color || lineColors[lineIdx % lineColors.length];
    line.points.forEach((p, i) => {
      const mx = toMagX(p.x), my = toMagY(p.y);
      magCtx.beginPath(); magCtx.arc(mx, my, 5, 0, 2 * Math.PI);
      magCtx.fillStyle = '#fff'; magCtx.fill();
      magCtx.beginPath(); magCtx.arc(mx, my, 3.4, 0, 2 * Math.PI);
      magCtx.fillStyle = col; magCtx.fill();
      magCtx.strokeStyle = 'rgba(0,0,0,0.7)'; magCtx.lineWidth = 1; magCtx.stroke();
      if (lineIdx === currentLineIndex && i === selectedPointIndex) {
        magCtx.beginPath(); magCtx.arc(mx, my, 5, 0, 2 * Math.PI);
        magCtx.strokeStyle = 'yellow'; magCtx.lineWidth = 2; magCtx.stroke();
      }
    });
  });

  const cx = magW / 2, cy = magH / 2;
  magCtx.strokeStyle = 'rgba(255,0,0,0.85)'; magCtx.lineWidth = 1.5;
  magCtx.beginPath();
  magCtx.moveTo(cx - 12, cy); magCtx.lineTo(cx + 12, cy);
  magCtx.moveTo(cx, cy - 12); magCtx.lineTo(cx, cy + 12);
  magCtx.stroke();
  magCtx.fillStyle = 'red';
  magCtx.beginPath(); magCtx.arc(cx, cy, 2, 0, 2 * Math.PI); magCtx.fill();
}, 16);

/**********************
 * CATMULL-ROM SPLINE
 **********************/
function getCatmullRomPoint(t, p0, p1, p2, p3, tension = 0.5) {
  const t2 = t * t, t3 = t2 * t;
  const f1 = -tension * t3 + 2 * tension * t2 - tension * t;
  const f2 = (2 - tension) * t3 + (tension - 3) * t2 + 1;
  const f3 = (tension - 2) * t3 + (3 - 2 * tension) * t2 + tension * t;
  const f4 = tension * t3 - tension * t2;
  return {
    x: f1 * p0.x + f2 * p1.x + f3 * p2.x + f4 * p3.x,
    y: f1 * p0.y + f2 * p1.y + f3 * p2.y + f4 * p3.y
  };
}

/**********************
 * CALIBRATION
 **********************/
setAxesBtn.addEventListener('click', () => {
  // Click again while active = cancel axis-setting mode
  if (mode === 'axes') {
    mode = 'none';
    axisInputs.style.display = 'none';
    axisInstruction.textContent = isCalibrated
      ? 'Calibration complete. Select a mode to digitize.'
      : 'Click "Set Axis Points" then enter values.';
    updateButtonStates();
    return;
  }
  setPickingSnapColor(false);
  axisPoints = [];
  mode = 'axes';
  axisInputs.style.display = 'block';
  updateAxisLabels();
  axisInstruction.textContent = sharedOrigin.checked
    ? 'Click point for Shared Origin (X1/Y1) on the chart.'
    : `Click point for ${axisLabels[0]} on the chart.`;
  syncModePanels();
  updateButtonStates();
  calibrateBtn.disabled = true;
  draw();
});

sharedOrigin.addEventListener('change', () => {
  updateAxisLabels();
  if (mode === 'axes') {
    axisPoints = [];
    axisInstruction.textContent = sharedOrigin.checked
      ? 'Click point for Shared Origin (X1/Y1) on the chart.'
      : `Click point for ${axisLabels[0]} on the chart.`;
    calibrateBtn.disabled = true;
    draw(); saveState();
  }
});

resetAxisPointsBtn.addEventListener('click', () => {
  axisPoints = [];
  mode = 'axes';
  axisInputs.style.display = 'block';
  updateAxisLabels();
  axisInstruction.textContent = sharedOrigin.checked
    ? 'Click point for Shared Origin (X1/Y1) on the chart.'
    : `Click point for ${axisLabels[0]} on the chart.`;
  calibrateBtn.disabled = true;
  syncModePanels();
  updateButtonStates();
  draw(); saveState();
});

calibrateBtn.addEventListener('click', () => {
  const x1Val = parseFloat(document.getElementById('x1-value').value);
  const x2Val = parseFloat(document.getElementById('x2-value').value);
  const y1Val = parseFloat(document.getElementById('y1-value').value);
  const y2Val = parseFloat(document.getElementById('y2-value').value);
  if ([x1Val, x2Val, y1Val, y2Val].some(isNaN)) { showModal('Please enter valid axis values'); return; }
  if (x1Val === x2Val || y1Val === y2Val) { showModal('Axis values must be different'); return; }

  const expected = sharedOrigin.checked ? 3 : 4;
  if (axisPoints.length !== expected) { showModal(`Please set ${expected} axis points first`); return; }

  let x1Pix, x2Pix, y1Pix, y2Pix;
  if (sharedOrigin.checked) {
    x1Pix = axisPoints[0].x; x2Pix = axisPoints[1].x;
    y1Pix = axisPoints[0].y; y2Pix = axisPoints[2].y;
  } else {
    x1Pix = axisPoints[0].x; x2Pix = axisPoints[1].x;
    y1Pix = axisPoints[2].y; y2Pix = axisPoints[3].y;
  }

  if (Math.abs(x2Pix - x1Pix) < 1e-10) { showModal('X-axis points must have distinct x-coordinates'); return; }
  if (Math.abs(y2Pix - y1Pix) < 1e-10) { showModal('Y-axis points must have distinct y-coordinates'); return; }
  if (logX && (x1Val <= 0 || x2Val <= 0)) { showModal('Log X requires positive X1, X2'); return; }
  if (logY && (y1Val <= 0 || y2Val <= 0)) { showModal('Log Y requires positive Y1, Y2'); return; }

  const deltaPixX = x2Pix - x1Pix, deltaPixY = y2Pix - y1Pix;
  const deltaValX = logX ? Math.log10(x2Val) - Math.log10(x1Val) : x2Val - x1Val;
  const deltaValY = logY ? Math.log10(y2Val) - Math.log10(y1Val) : y2Val - y1Val;

  scaleX  = deltaPixX / deltaValX;
  scaleY  = deltaPixY / deltaValY;
  offsetX = logX ? x1Pix - Math.log10(x1Val) * scaleX : x1Pix - x1Val * scaleX;
  offsetY = logY ? y1Pix - Math.log10(y1Val) * scaleY : y1Pix - y1Val * scaleY;

  if (!isFinite(scaleX) || !isFinite(scaleY)) { showModal('Calibration failed: invalid values.'); return; }

  isCalibrated = true;
  _applyCalibrationButtonState();
  mode = 'add';
  axisInputs.style.display    = 'none';
  axisInstruction.textContent = 'Calibration complete. Select a mode to digitize.';
  syncModePanels();
  updateButtonStates();
  lines.forEach(line => line.points.forEach(p => {
    const dc = canvasToDataCoords(p.x, p.y);
    if (dc) { p.dataX = dc.dataX; p.dataY = dc.dataY; }
  }));
  saveState(); draw(); updatePreview();
  document.dispatchEvent(new Event('calibrationComplete'));
  if (typeof window.refreshCurveDetectorState === 'function') window.refreshCurveDetectorState();
});

resetCalibrationBtn.addEventListener('click', () => {
  isCalibrated = false;
  scaleX = scaleY = offsetX = offsetY = undefined;
  axisPoints = [];
  mode = 'none';
  if (typeof window.refreshCurveDetectorState === 'function') window.refreshCurveDetectorState();
  axisInstruction.textContent = 'Click "Set Axis Points" then enter values.';
  axisInputs.style.display    = 'none';
  syncModePanels();
  _applyCalibrationButtonState();
  updateButtonStates();
  draw(); saveState();
});

toggleGridBtn.addEventListener('click', () => {
  showGrid = !showGrid;
  updateButtonStates();
  draw(); saveState();
});

toggleLogXBtn.addEventListener('click', () => {
  logX = !logX;
  if (isCalibrated && axisPoints.length >= 2) {
    const x1Val = parseFloat(document.getElementById('x1-value').value);
    const x2Val = parseFloat(document.getElementById('x2-value').value);
    if (logX && (x1Val <= 0 || x2Val <= 0 || isNaN(x1Val) || isNaN(x2Val))) {
      showModal('Log X requires positive X1, X2 values. Reverting.');
      logX = false;
      updateButtonStates();
      return;
    }
    const deltaPixX = axisPoints[1].x - axisPoints[0].x;
    const deltaValX = logX ? Math.log10(x2Val) - Math.log10(x1Val) : x2Val - x1Val;
    if (deltaValX === 0 || !isFinite(deltaValX)) { logX = !logX; updateButtonStates(); return; }
    scaleX  = deltaPixX / deltaValX;
    offsetX = logX ? axisPoints[0].x - Math.log10(x1Val) * scaleX : axisPoints[0].x - x1Val * scaleX;
    lines.forEach(l => l.points.forEach(p => { const d = canvasToDataCoords(p.x, p.y); if (d) p.dataX = d.dataX; }));
    updatePreview(); draw(); saveState();
  }
  updateButtonStates();
});

toggleLogYBtn.addEventListener('click', () => {
  logY = !logY;
  const yIdx0 = sharedOrigin.checked ? 0 : 2;
  const yIdx1 = sharedOrigin.checked ? 2 : 3;
  if (isCalibrated && axisPoints.length > yIdx1) {
    const y1Val = parseFloat(document.getElementById('y1-value').value);
    const y2Val = parseFloat(document.getElementById('y2-value').value);
    if (logY && (y1Val <= 0 || y2Val <= 0 || isNaN(y1Val) || isNaN(y2Val))) {
      showModal('Log Y requires positive Y1, Y2 values. Reverting.');
      logY = false;
      updateButtonStates();
      return;
    }
    const deltaPixY = axisPoints[yIdx1].y - axisPoints[yIdx0].y;
    const deltaValY = logY ? Math.log10(y2Val) - Math.log10(y1Val) : y2Val - y1Val;
    if (deltaValY === 0 || !isFinite(deltaValY)) { logY = !logY; updateButtonStates(); return; }
    scaleY  = deltaPixY / deltaValY;
    offsetY = logY ? axisPoints[yIdx0].y - Math.log10(y1Val) * scaleY : axisPoints[yIdx0].y - y1Val * scaleY;
    lines.forEach(l => l.points.forEach(p => { const d = canvasToDataCoords(p.x, p.y); if (d) p.dataY = d.dataY; }));
    updatePreview(); draw(); saveState();
  }
  updateButtonStates();
});

/**********************
 * ENHANCEMENT CONTROLS
 **********************/
brightnessSlider.addEventListener('input', e => {
  brightnessVal = parseFloat(e.target.value);
  document.getElementById('brightness-val').textContent = brightnessVal + '%';
  scheduleEnhance(); saveSession();
});

contrastSlider.addEventListener('input', e => {
  contrastVal = parseFloat(e.target.value);
  document.getElementById('contrast-val').textContent = contrastVal + '%';
  scheduleEnhance(); saveSession();
});

gridFilterToggle.addEventListener('change', () => {
  gridFilterOn = gridFilterToggle.checked;
  scheduleEnhance(); saveSession();
});

/* ---- Snap settings ---- */
function enableSnap() {
  snapToLine = true;
  snapToggle.checked = true;
}

snapToggle.addEventListener('change', () => {
  snapToLine = snapToggle.checked;
  saveSession();
});

snapModeSelect.addEventListener('change', () => {
  snapColorMode = snapModeSelect.value;
  if (snapColorMode === 'custom') enableSnap();
  setPickingSnapColor(false);
  saveSession();
});

snapColorInput.addEventListener('input', () => {
  snapColor = snapColorInput.value;
  enableSnap();
  saveSession();
});

snapTolSlider.addEventListener('input', () => {
  snapTolerance = parseInt(snapTolSlider.value, 10);
  document.getElementById('snap-tol-val').textContent = snapTolerance;
  saveSession();
});

snapPickBtn.addEventListener('click', () => {
  if (!hasImage()) { showModal('Load an image first.'); return; }
  setPickingSnapColor(!pickingSnapColor);
  statusBar.textContent = pickingSnapColor ? 'Color detection: hover over the graph, click to use the color (Esc to cancel).' : `Mode: ${mode}`;
});

/**********************
 * VIEW CONTROLS
 **********************/
document.getElementById('zoom-in').onclick    = () => zoomAt(1.25);
document.getElementById('zoom-out').onclick   = () => zoomAt(1 / 1.25);
document.getElementById('reset-view').onclick = () => { fitView(); draw(); saveSession(); };

panModeBtn.onclick = () => {
  isPanning = !isPanning;
  if (isPanning) magnifier.style.display = 'none';
  updateButtonStates();
};

toggleThemeBtn.onclick = () => {
  document.body.classList.toggle('dark');
  localStorage.setItem('theme', document.body.classList.contains('dark') ? 'dark' : 'light');
  updateButtonStates();
};

document.getElementById('magnifier-zoom').addEventListener('input', e => {
  magnifierZoom = Math.max(1, parseFloat(e.target.value));
  saveSession();
});

document.getElementById('highlight-width').addEventListener('input', e => {
  highlightWidth = parseFloat(e.target.value);
  draw();
});

/**********************
 * PANNING (window-level so dragging outside the canvas keeps working)
 **********************/
window.addEventListener('mousemove', e => {
  if (!isPanDragging) return;
  panX = e.clientX - startPan.x;
  panY = e.clientY - startPan.y;
  draw();
});

window.addEventListener('mouseup', () => {
  if (isPanDragging) {
    isPanDragging = false;
    updateButtonStates();
    saveSession();
  }
});

canvas.addEventListener('mouseleave', () => {
  magnifier.style.display = 'none';
  colorTip.style.display = 'none';
  statusBar.textContent   = `Mode: ${isPanning ? 'pan' : mode}`;
});
canvas.addEventListener('contextmenu', e => e.preventDefault());

// Scroll-wheel zoom anchored to cursor
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - rect.left, e.clientY - rect.top);
}, { passive: false });

/**********************
 * KEYBOARD SHORTCUTS
 **********************/
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && (pickingSnapColor || pickingDetectorColor)) {
    if (pickingDetectorColor) setPickingDetectorColor(false);
    else setPickingSnapColor(false);
    statusBar.textContent = `Mode: ${mode}`;
    return;
  }
  const t = e.target;
  const typing = t && (t.tagName === 'INPUT' && !['checkbox', 'range', 'color'].includes(t.type) || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
  if (typing) return;   // never hijack keys while typing in a field

  if (e.ctrlKey && e.key === 'z') { undoBtn.click(); e.preventDefault(); return; }
  if (e.ctrlKey && e.key === 'y') { redoBtn.click(); e.preventDefault(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === '+' || e.key === '=') zoomAt(1.25);
  if (e.key === '-') zoomAt(1 / 1.25);
  if (e.key === '0') { fitView(); draw(); saveSession(); }
  if (e.key === 'p' && isCalibrated) addPointBtn.click();
  if (e.key === 'h' && isCalibrated) highlightLineBtn.click();
});

/**********************
 * INITIALIZATION
 **********************/
document.addEventListener('DOMContentLoaded', () => {
  if (localStorage.getItem('theme') === 'dark') document.body.classList.add('dark');
  resizeCanvas(false);
  loadSession();
  syncSnapUI();
  updateButtonStates();
  draw();
});
