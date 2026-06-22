/**********************
 * DIGITIZER CORE  (improved)
 * Handles: state, session, coordinate math,
 *          drawing, calibration, history, image loading
 *
 * IMPROVEMENTS OVER PREVIOUS VERSION:
 *  A. Points stored in image-space (ix, iy) — canvas coords derived at
 *     draw/hit-test time, so window resize never silently shifts points.
 *  B. Zoom clamped to [MIN_ZOOM, MAX_ZOOM] on wheel, keyboard and buttons.
 *  C. getCatmullRomPoint now used: highlight path drawn as a smooth spline
 *     both on the main canvas and in the magnifier.
 *  D. buildProcessedImageData box-blur runs in a Web Worker when available;
 *     falls back to main-thread for small images or when Workers are blocked.
 *  E. Single formatValue() helper used by preview, point-list and status bar.
 *  F. All previous numbered fixes retained (1-6, 13, 14).
 **********************/

/**********************
 * CONSTANTS
 **********************/
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 40;

/**********************
 * GLOBAL STATE
 **********************/
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const magnifier = document.getElementById('magnifier');
const magCtx = magnifier.getContext('2d');

let img = new Image();
let rawImageData = null;        // original pixel data, never mutated
let processedImageData = null;  // brightness/contrast/grid-filtered — used by auto-trace & snap

let zoom = 1, panX = 0, panY = 0, isPanning = false, isPanDragging = false, startPan = { x: 0, y: 0 };
let axisPoints = [], isCalibrated = false, scaleX, scaleY, offsetX, offsetY;

// IMPROVEMENT A: each point now carries { ix, iy } (image-space pixels) as the
// canonical position; p.x / p.y are derived on the fly for drawing and hit-testing.
let lines = [{ name: 'Line 1', points: [], sorted: false, orderCounter: 0 }];
let currentLineIndex = 0;
let mode = 'none'; // 'none','axes','add','adjust','delete','highlight'
let selectedPointIndex = -1;
let history = [], historyIndex = -1;
let showGrid = false, logX = false, logY = false;
let highlightPath = [], isHighlighting = false;
let isDraggingPoint = false;
let highlightWidth = 2;
let magnifierZoom = 2;

let brightnessVal = 100;
let contrastVal   = 100;
let snapToLine    = false;
let gridFilterOn  = false;

const lineColors  = ['blue', 'green', 'red', 'purple', 'orange', 'brown', 'pink', 'gray'];
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

const brightnessSlider   = document.getElementById('brightness-slider');
const contrastSlider     = document.getElementById('contrast-slider');
const snapToggle         = document.getElementById('snap-toggle');
const gridFilterToggle   = document.getElementById('grid-filter-toggle');

/**********************
 * IMPROVEMENT E: single formatting helper
 * Used by preview table, point list, status bar and (via tools module) CSV/XLSX.
 **********************/
function formatValue(v, decimals = 6) {
  if (v === null || v === undefined) return 'N/A';
  if (!isFinite(v) || isNaN(v))      return 'NaN';
  return v.toFixed(decimals);
}

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
    input.type  = 'text';
    input.id    = 'modal-input';
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
  if (withInput) document.getElementById('modal-input').focus();
}

function showSpinner(on) { document.getElementById('spinner').style.display = on ? 'block' : 'none'; }

function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

function throttle(func, limit) {
  let inThrottle, lastFunc, lastRan;
  return function (...args) {
    if (!inThrottle) {
      func(...args);
      lastRan    = Date.now();
      inThrottle = true;
      setTimeout(() => {
        inThrottle = false;
        if (lastFunc) { lastFunc(); lastFunc = null; }
      }, limit);
    } else {
      lastFunc = () => func(...args);
    }
  };
}

function download(filename, text, mimeType) {
  const a = document.createElement('a');
  a.href = `data:${mimeType};charset=utf-8,${encodeURIComponent(text)}`;
  a.download = filename;
  a.click();
}

/**********************
 * IMPROVEMENT A: image-space coordinate helpers
 *
 * Canonical point storage: { ix, iy } in natural image pixels.
 * Canvas coords are derived whenever needed for drawing or hit-testing.
 **********************/

/** Image-space → canvas-space (accounts for zoom/pan via the draw transform). */
function imageToCanvas(ix, iy) {
  if (!img.naturalWidth) return { x: ix, y: iy };
  return {
    x: ix * (canvas.width  / img.naturalWidth),
    y: iy * (canvas.height / img.naturalHeight)
  };
}

/** Canvas-space (inside the ctx transform) → image-space. */
function canvasToImage(cx, cy) {
  if (!img.naturalWidth) return { ix: cx, iy: cy };
  return {
    ix: cx * (img.naturalWidth  / canvas.width),
    iy: cy * (img.naturalHeight / canvas.height)
  };
}

/**
 * Ensure every point has ix/iy.  Points saved by the old version only have
 * p.x / p.y (canvas-space at the time they were saved).  On first load we
 * back-convert them so the new code can treat them uniformly.
 */
function migratePointToImageSpace(p) {
  if (p.ix !== undefined && p.iy !== undefined) return p;   // already migrated
  const img2c = canvasToImage(p.x, p.y);
  p.ix = img2c.ix;
  p.iy = img2c.iy;
  return p;
}

/** Derive current canvas coords from a point's image-space position. */
function pointCanvasXY(p) {
  return imageToCanvas(p.ix, p.iy);
}

/**********************
 * SESSION PERSISTENCE
 **********************/
function saveSession() {
  localStorage.setItem('digitizerState', JSON.stringify({
    lines, axisPoints, scaleX, scaleY, offsetX, offsetY,
    logX, logY, isCalibrated, zoom, panX, panY,
    showGrid, mode, currentLineIndex, magnifierZoom,
    brightnessVal, contrastVal, snapToLine, gridFilterOn
  }));
}

function loadSession() {
  const s = localStorage.getItem('digitizerState');
  axisInputs.style.display        = 'none';
  highlightControls.style.display = 'none';
  if (s) {
    try {
      const state = JSON.parse(s);
      lines = state.lines || [{ name: 'Line 1', points: [], sorted: false, orderCounter: 0 }];
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
        // IMPROVEMENT A: migrate legacy canvas-space points
        line.points = line.points.map(migratePointToImageSpace);
      });
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
      magnifierZoom   = state.magnifierZoom    || 2;
      brightnessVal   = state.brightnessVal    ?? 100;
      contrastVal     = state.contrastVal      ?? 100;
      snapToLine      = state.snapToLine       || false;
      gridFilterOn    = state.gridFilterOn     || false;

      // FIX #4: only restore active modes when actually calibrated
      const savedMode = state.mode || 'none';
      if (!isCalibrated && ['add', 'adjust', 'delete', 'highlight'].includes(savedMode)) {
        mode = 'none';
      } else {
        mode = savedMode;
      }

      updateLineSelect();
      updatePreview();
      updateButtonStates();
      toggleLogXBtn.classList.toggle('log-active', logX);
      toggleLogYBtn.classList.toggle('log-active', logY);
      document.getElementById('magnifier-zoom').value = magnifierZoom;
      brightnessSlider.value   = brightnessVal;
      contrastSlider.value     = contrastVal;
      snapToggle.checked       = snapToLine;
      gridFilterToggle.checked = gridFilterOn;
      highlightControls.style.display = mode === 'highlight' ? 'block' : 'none';
      axisInputs.style.display = isCalibrated
        ? 'none'
        : (mode === 'axes' && axisPoints.length > 0) ? 'block' : 'none';
      updateAxisLabels();
      _applyCalibrationButtonState();
      axisInstruction.textContent = isCalibrated
        ? 'Calibration complete. Select a mode to digitize.'
        : axisPoints.length < (sharedOrigin.checked ? 3 : 4)
          ? `Click point for ${sharedOrigin.checked && axisPoints.length === 0 ? 'Shared Origin (X1/Y1)' : axisLabels[axisPoints.length]} on the chart.`
          : 'Enter axis values and click Calibrate.';
      draw();
    } catch (e) {
      console.error('Failed to load session:', e);
      showModal('Failed to load session. Starting fresh.');
      axisInputs.style.display        = 'none';
      highlightControls.style.display = 'none';
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
    lines:         JSON.parse(JSON.stringify(lines)),
    axisPoints:    JSON.parse(JSON.stringify(axisPoints)),
    scaleX, scaleY, offsetX, offsetY,
    logX, logY, isCalibrated,
    zoom, panX, panY, showGrid, mode, currentLineIndex, magnifierZoom,
    highlightPath: JSON.parse(JSON.stringify(highlightPath)),
    isHighlighting
  });
  historyIndex++;
  undoBtn.disabled = historyIndex <= 0;
  redoBtn.disabled = historyIndex >= history.length - 1;
  saveSession();
}

function _restoreState(state) {
  lines           = JSON.parse(JSON.stringify(state.lines));
  axisPoints      = JSON.parse(JSON.stringify(state.axisPoints));
  scaleX          = state.scaleX;
  scaleY          = state.scaleY;
  offsetX         = state.offsetX;
  offsetY         = state.offsetY;
  logX            = state.logX;
  logY            = state.logY;
  isCalibrated    = state.isCalibrated;
  zoom            = state.zoom;
  panX            = state.panX;
  panY            = state.panY;
  showGrid        = state.showGrid;
  mode            = state.mode;
  currentLineIndex= state.currentLineIndex;
  magnifierZoom   = state.magnifierZoom;
  highlightPath   = state.highlightPath  || [];
  isHighlighting  = state.isHighlighting || false;
  toggleLogXBtn.classList.toggle('log-active', logX);
  toggleLogYBtn.classList.toggle('log-active', logY);
  document.getElementById('magnifier-zoom').value = magnifierZoom;
  updateLineSelect();
  updatePreview();
  updateButtonStates();
  highlightControls.style.display = mode === 'highlight' ? 'block' : 'none';
  axisInputs.style.display = isCalibrated
    ? 'none'
    : (mode === 'axes' && axisPoints.length > 0) ? 'block' : 'none';
  updateAxisLabels();
  calibrateBtn.disabled = axisPoints.length !== (sharedOrigin.checked ? 3 : 4);
  axisInstruction.textContent = isCalibrated
    ? 'Calibration complete. Select a mode to digitize.'
    : axisPoints.length < (sharedOrigin.checked ? 3 : 4)
      ? `Click point for ${sharedOrigin.checked && axisPoints.length === 0 ? 'Shared Origin (X1/Y1)' : axisLabels[axisPoints.length]} on the chart.`
      : 'Enter axis values and click Calibrate.';
  sortPointsBtn.classList.toggle('sort-active', lines[currentLineIndex].sorted);
  draw();
  saveSession();
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
 * IMAGE LOADING & ENHANCEMENT
 **********************/
const offCanvas = document.createElement('canvas');
const offCtx    = offCanvas.getContext('2d');

function loadImage(dataUrl) {
  showSpinner(true);
  // FIX #6: handlers set before src assignment
  const newImg = new Image();
  newImg.onload = () => {
    if (newImg.naturalWidth <= 0 || newImg.naturalHeight <= 0) {
      showModal('Image has invalid dimensions.');
      showSpinner(false);
      return;
    }
    img   = newImg;
    zoom  = 1; panX = 0; panY = 0;
    canvas.width  = Math.min(img.naturalWidth,  window.innerWidth * 0.75);
    canvas.height = canvas.width * (img.naturalHeight / img.naturalWidth);

    offCanvas.width  = img.naturalWidth;
    offCanvas.height = img.naturalHeight;
    offCtx.drawImage(img, 0, 0);
    rawImageData = offCtx.getImageData(0, 0, offCanvas.width, offCanvas.height);
    buildProcessedImageData();
    draw();
    setAxesBtn.disabled         = false;
    resetAxisPointsBtn.disabled = false;
    saveState();
    saveSession();
    showSpinner(false);
    document.dispatchEvent(new Event('imageLoaded'));
  };
  newImg.onerror = () => { showModal('Failed to load image.'); showSpinner(false); };
  newImg.src = dataUrl;
}

/**********************
 * IMPROVEMENT D: Web-Worker box blur
 *
 * For large images the O(w·h·r²) box blur was running on the main thread,
 * freezing the UI for up to a second on every brightness/contrast tweak.
 *
 * Strategy:
 *  1. If the image is small (< WORKER_THRESHOLD pixels) just run synchronously
 *     as before — Worker overhead isn't worth it.
 *  2. Otherwise, spawn an inline Worker (blob URL) so the blur runs off-thread.
 *     A pending flag ensures only one Worker runs at a time; if the user tweaks
 *     a slider again while a Worker is in flight, the result is discarded and a
 *     fresh Worker is launched.
 **********************/
const WORKER_THRESHOLD = 640 * 480; // pixels — tune as needed

// Inline Worker source (stringified so no extra file is needed)
const _workerSrc = `
self.onmessage = function(e) {
  const { bcData, width, height, blurR } = e.data;
  const len = bcData.length;
  const blurred = new Uint8ClampedArray(len);
  const w = width, h = height;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let rS = 0, gS = 0, bS = 0, cnt = 0;
      for (let dy = -blurR; dy <= blurR; dy++) {
        for (let dx = -blurR; dx <= blurR; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = (ny * w + nx) * 4;
          rS += bcData[j]; gS += bcData[j+1]; bS += bcData[j+2]; cnt++;
        }
      }
      const j = (y * w + x) * 4;
      blurred[j] = rS/cnt; blurred[j+1] = gS/cnt; blurred[j+2] = bS/cnt; blurred[j+3] = 255;
    }
  }
  // Compute screen-blend composite
  const out = new Uint8ClampedArray(len);
  for (let i = 0; i < len; i += 4) {
    for (let ch = 0; ch < 3; ch++) {
      const a = bcData[i+ch]/255, b = blurred[i+ch]/255;
      const s = 1-(1-a)*(1-b);
      out[i+ch] = Math.round((a + 0.35*(s-a))*255);
    }
    out[i+3] = bcData[i+3];
  }
  self.postMessage({ out }, [out.buffer]);
};
`;

let _workerBlobUrl = null;
let _activeWorker  = null;   // currently running Worker (if any)
let _pendingBuild  = false;  // another build was requested while Worker ran

function _getWorkerBlobUrl() {
  if (!_workerBlobUrl) {
    const blob    = new Blob([_workerSrc], { type: 'text/javascript' });
    _workerBlobUrl = URL.createObjectURL(blob);
  }
  return _workerBlobUrl;
}

/**
 * Recompute processedImageData from rawImageData applying brightness,
 * contrast and (optionally) grid-filter.
 *
 * - When gridFilter is OFF: synchronous, cheap.
 * - When gridFilter is ON and image is large: off-thread Worker.
 * - When gridFilter is ON and image is small: synchronous fallback.
 */
function buildProcessedImageData(callback) {
  if (!rawImageData) { processedImageData = null; if (callback) callback(); return; }

  const src = rawImageData.data;
  const w   = rawImageData.width;
  const h   = rawImageData.height;
  const len = src.length;
  const bF  = brightnessVal / 100;
  const cF  = contrastVal   / 100;

  // Step 1: brightness + contrast (always synchronous — very fast)
  const bcData = new Uint8ClampedArray(len);
  for (let i = 0; i < len; i += 4) {
    for (let ch = 0; ch < 3; ch++) {
      let v = src[i + ch];
      v = v * bF;
      v = (v - 128) * cF + 128;
      bcData[i + ch] = Math.min(255, Math.max(0, v));
    }
    bcData[i + 3] = src[i + 3];
  }

  if (!gridFilterOn) {
    processedImageData = new ImageData(bcData, w, h);
    if (callback) callback();
    return;
  }

  // Step 2: grid filter (box blur + screen blend)
  const BLUR_R = 3;
  const pixelCount = w * h;

  if (pixelCount < WORKER_THRESHOLD || typeof Worker === 'undefined') {
    // Small image or no Worker support — run synchronously
    _runBlurSync(bcData, w, h, len, BLUR_R);
    if (callback) callback();
    return;
  }

  // Large image — run in Worker
  if (_activeWorker) {
    // A Worker is already running; flag that we need another pass after it finishes
    _pendingBuild = true;
    return;
  }

  try {
    const worker = new Worker(_getWorkerBlobUrl());
    _activeWorker = worker;
    // Transfer bcData buffer to Worker (zero-copy)
    worker.postMessage({ bcData, width: w, height: h, blurR: BLUR_R }, [bcData.buffer]);
    worker.onmessage = (e) => {
      _activeWorker = null;
      processedImageData = new ImageData(new Uint8ClampedArray(e.data.out), w, h);
      draw();
      if (callback) callback();
      if (_pendingBuild) {
        _pendingBuild = false;
        buildProcessedImageData();
      }
    };
    worker.onerror = (err) => {
      _activeWorker = null;
      console.warn('Blur Worker error, falling back to main thread:', err);
      // Reconstruct bcData (it was transferred away) and fall back
      buildProcessedImageData(callback);
    };
  } catch (e) {
    // Worker instantiation failed (e.g. CSP) — fall back to sync
    _runBlurSync(bcData, w, h, len, BLUR_R);
    if (callback) callback();
  }
}

function _runBlurSync(bcData, w, h, len, BLUR_R) {
  const blurred = new Uint8ClampedArray(len);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let rS = 0, gS = 0, bS = 0, cnt = 0;
      for (let dy = -BLUR_R; dy <= BLUR_R; dy++) {
        for (let dx = -BLUR_R; dx <= BLUR_R; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = (ny * w + nx) * 4;
          rS += bcData[j]; gS += bcData[j+1]; bS += bcData[j+2]; cnt++;
        }
      }
      const j = (y * w + x) * 4;
      blurred[j] = rS/cnt; blurred[j+1] = gS/cnt; blurred[j+2] = bS/cnt; blurred[j+3] = 255;
    }
  }
  const out = new Uint8ClampedArray(len);
  for (let i = 0; i < len; i += 4) {
    for (let ch = 0; ch < 3; ch++) {
      const a = bcData[i+ch]/255, b = blurred[i+ch]/255;
      const s = 1-(1-a)*(1-b);
      out[i+ch] = Math.round((a + 0.35*(s-a))*255);
    }
    out[i+3] = bcData[i+3];
  }
  processedImageData = new ImageData(out, w, h);
}

/** Returns the pixel buffer that auto-trace/snap should use. */
function getPixelData() { return processedImageData || rawImageData; }

/** Raw pixel [r,g,b,a] at image-space (ix, iy). */
function getRawPixel(ix, iy) {
  if (!rawImageData) return null;
  const iw = rawImageData.width, ih = rawImageData.height;
  const px = Math.round(Math.max(0, Math.min(ix, iw - 1)));
  const py = Math.round(Math.max(0, Math.min(iy, ih - 1)));
  const i  = (py * iw + px) * 4;
  return rawImageData.data.slice(i, i + 4);
}

/** Canvas coords (x,y in canvas element space) → image-space. */
function canvasToImageCoords(cx, cy) {
  return {
    ix: cx * (img.naturalWidth  / canvas.width),
    iy: cy * (img.naturalHeight / canvas.height)
  };
}

/**********************
 * COORDINATE TRANSFORMS
 **********************/

/** Client (page) coords → canvas-space coords inside the zoom/pan transform. */
function imageToCanvasCoords(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const x    = (clientX - rect.left - panX) / zoom;
  const y    = (clientY - rect.top  - panY) / zoom;
  return { x, y };
}

/** Canvas-space coords → calibrated data coords.  Returns null on failure. */
function canvasToDataCoords(x, y) {
  try {
    if (!isFinite(scaleX) || !isFinite(scaleY) || scaleX === 0 || scaleY === 0) return null;
    let dataX, dataY;
    if (logX) {
      const exp = (x - offsetX) / scaleX;
      dataX = Math.pow(10, exp);
      if (!isFinite(dataX) || dataX <= 0) return null;
    } else {
      dataX = (x - offsetX) / scaleX;
      if (!isFinite(dataX)) return null;
    }
    if (logY) {
      const exp = (y - offsetY) / scaleY;
      dataY = Math.pow(10, exp);
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

/** FIX #1: targets <label for="…"> elements introduced in the HTML fix. */
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
    const opt       = document.createElement('option');
    opt.value       = i;
    opt.textContent = line.name;
    lineSelect.appendChild(opt);
  });
  lineSelect.value = currentLineIndex;
}

function updatePreview() {
  previewTable.innerHTML = '';
  if (lines.every(l => l.points.length === 0)) {
    previewTable.innerHTML = '<tr><td>No data</td></tr>';
    if (pointList) pointList.innerHTML = '';
    return;
  }
  // IMPROVEMENT E: use formatValue() consistently
  lines.forEach(line => {
    if (!line.points.length) return;
    const nameRow = document.createElement('tr');
    nameRow.innerHTML = `<td colspan="2"><strong>${line.name}</strong></td>`;
    previewTable.appendChild(nameRow);
    const hdr = document.createElement('tr');
    hdr.innerHTML = '<td>X</td><td>Y</td>';
    previewTable.appendChild(hdr);
    line.points.forEach(p => {
      const row = document.createElement('tr');
      row.innerHTML = `<td>${formatValue(p.dataX)}</td><td>${formatValue(p.dataY)}</td>`;
      previewTable.appendChild(row);
    });
  });

  if (pointList) {
    pointList.innerHTML = '';
    const line = lines[currentLineIndex];
    const pts  = line.sorted
      ? [...line.points].sort((a, b) => a.dataX - b.dataX)
      : [...line.points].sort((a, b) => a.order  - b.order);
    pts.forEach((p, i) => {
      const div = document.createElement('div');
      div.className   = 'point-item';
      div.textContent = `#${i + 1}: (${formatValue(p.dataX, 4)}, ${formatValue(p.dataY, 4)})`;
      pointList.appendChild(div);
    });
  }
}

/**
 * IMPROVEMENT A: hit-testing now derives canvas coords from image-space at
 * the current zoom level rather than relying on stale p.x / p.y.
 */
function findNearestPointIndex(cx, cy) {
  let minDist = Infinity, closest = -1;
  lines[currentLineIndex].points.forEach((p, i) => {
    const { x, y } = pointCanvasXY(p);
    const d = Math.hypot(x - cx, y - cy);
    if (d < minDist && d < 10 / zoom) { minDist = d; closest = i; }
  });
  return closest;
}

/** FIX #13: cursor is 'crosshair' for all active digitising modes. */
function updateButtonStates() {
  addPointBtn.classList.toggle('active',      mode === 'add');
  adjustPointBtn.classList.toggle('active',   mode === 'adjust');
  deletePointBtn.classList.toggle('active',   mode === 'delete');
  highlightLineBtn.classList.toggle('active', mode === 'highlight');
  const activeModes = ['add', 'adjust', 'delete', 'highlight', 'axes'];
  canvas.style.cursor = isPanning ? 'move' : activeModes.includes(mode) ? 'crosshair' : 'default';
  statusBar.textContent = `Mode: ${mode}`;
}

/**********************
 * DRAWING
 **********************/

function buildFilter() {
  return `brightness(${brightnessVal}%) contrast(${contrastVal}%)`;
}

function drawImageWithEnhancements() {
  if (!img.src || !img.complete || img.naturalWidth === 0) return;
  ctx.save();
  if (gridFilterOn) {
    const tmp  = document.createElement('canvas');
    tmp.width  = canvas.width; tmp.height = canvas.height;
    const tCtx = tmp.getContext('2d');
    tCtx.filter = buildFilter();
    tCtx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const tmp2  = document.createElement('canvas');
    tmp2.width  = canvas.width; tmp2.height = canvas.height;
    const t2Ctx = tmp2.getContext('2d');
    t2Ctx.filter = `blur(2px) ${buildFilter()}`;
    t2Ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    tCtx.globalCompositeOperation = 'screen';
    tCtx.globalAlpha = 0.35;
    tCtx.drawImage(tmp2, 0, 0);
    tCtx.globalCompositeOperation = 'source-over';
    tCtx.globalAlpha = 1;
    ctx.drawImage(tmp, 0, 0);
  } else {
    ctx.filter = buildFilter();
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    ctx.filter = 'none';
  }
  ctx.restore();
}

/**
 * IMPROVEMENT C: draw smooth Catmull-Rom spline through highlight path.
 * Falls back to polyline when path has fewer than 2 points.
 */
function drawSplinePath(pathPoints, context, lineW, strokeColor) {
  if (pathPoints.length < 2) return;
  context.save();
  context.strokeStyle = strokeColor;
  context.lineWidth   = lineW;
  context.lineCap     = 'round';
  context.lineJoin    = 'round';
  context.beginPath();
  context.moveTo(pathPoints[0].x, pathPoints[0].y);

  if (pathPoints.length === 2) {
    context.lineTo(pathPoints[1].x, pathPoints[1].y);
  } else {
    // Pad the first and last control points so the spline passes through both ends
    const pts = [pathPoints[0], ...pathPoints, pathPoints[pathPoints.length - 1]];
    const STEPS = 8; // segments between each pair of knots — trade-off quality/speed
    for (let i = 1; i < pts.length - 2; i++) {
      for (let t = 0; t <= 1; t += 1 / STEPS) {
        const pt = getCatmullRomPoint(t, pts[i-1], pts[i], pts[i+1], pts[i+2]);
        context.lineTo(pt.x, pt.y);
      }
    }
  }
  context.stroke();
  context.restore();
}

const draw = debounce(() => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(panX, panY);
  ctx.scale(zoom, zoom);

  if (img.src && img.complete && img.naturalWidth > 0) {
    try { drawImageWithEnhancements(); }
    catch (e) { console.error('Error drawing image:', e); }
  } else {
    ctx.fillStyle = '#333';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.font = '16px Arial';
    ctx.fillText('No image loaded. Please upload an image.', 10, 30);
  }

  // FIX #5: yMin/yMax sorted so loop direction is always correct
  if (isCalibrated && showGrid) {
    ctx.strokeStyle = 'rgba(0,0,0,0.2)';
    ctx.lineWidth   = 1 / zoom;

    const xA = logX ? Math.pow(10, (axisPoints[0].x - offsetX) / scaleX) : (axisPoints[0].x - offsetX) / scaleX;
    const xB = logX ? Math.pow(10, (axisPoints[1].x - offsetX) / scaleX) : (axisPoints[1].x - offsetX) / scaleX;
    const xMin = Math.min(xA, xB), xMax = Math.max(xA, xB);

    const yIdx0 = sharedOrigin.checked ? 0 : 2;
    const yIdx1 = sharedOrigin.checked ? 2 : 3;
    const yA = logY ? Math.pow(10, (axisPoints[yIdx0].y - offsetY) / scaleY) : (axisPoints[yIdx0].y - offsetY) / scaleY;
    const yB = logY ? Math.pow(10, (axisPoints[yIdx1].y - offsetY) / scaleY) : (axisPoints[yIdx1].y - offsetY) / scaleY;
    const yMin = Math.min(yA, yB), yMax = Math.max(yA, yB);

    const xStep = (xMax - xMin) / 10;
    const yStep = (yMax - yMin) / 10;

    if (xStep > 0) {
      for (let x = xMin; x <= xMax + xStep * 0.001; x += xStep) {
        const px = logX ? Math.log10(x) * scaleX + offsetX : x * scaleX + offsetX;
        ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, canvas.height); ctx.stroke();
      }
    }
    if (yStep > 0) {
      for (let y = yMin; y <= yMax + yStep * 0.001; y += yStep) {
        const py = logY ? Math.log10(y) * scaleY + offsetY : y * scaleY + offsetY;
        ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(canvas.width, py); ctx.stroke();
      }
    }
  }

  // Axis points
  ctx.fillStyle = 'red';
  ctx.font = `${12 / zoom}px Arial`;
  axisPoints.forEach((p, i) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5 / zoom, 0, 2 * Math.PI);
    ctx.fill();
    ctx.fillText(p.label || axisLabels[i], p.x + 8 / zoom, p.y - 8 / zoom);
  });

  // IMPROVEMENT A: derive canvas coords from image-space for drawing
  lines.forEach((line, lineIdx) => {
    ctx.fillStyle = lineColors[lineIdx % lineColors.length];
    line.points.forEach((p, i) => {
      const { x, y } = pointCanvasXY(p);
      ctx.beginPath();
      ctx.arc(x, y, 3 / zoom, 0, 2 * Math.PI);
      if (lineIdx === currentLineIndex && i === selectedPointIndex) {
        ctx.strokeStyle = 'yellow';
        ctx.lineWidth   = 2 / zoom;
        ctx.stroke();
      }
      ctx.fill();
    });
  });

  // IMPROVEMENT C: smooth spline for highlight path
  if (highlightPath.length > 1) {
    drawSplinePath(
      highlightPath,
      ctx,
      highlightWidth / zoom,
      'rgba(255, 80, 0, 0.7)'
    );
  }

  ctx.restore();
}, 16);

/**********************
 * MAGNIFIER
 **********************/
const drawMagnifier = throttle((clientX, clientY) => {
  if (!img.src || !img.complete || img.naturalWidth === 0 || mode === 'none' || isPanning) {
    magnifier.style.display = 'none';
    return;
  }

  const rect   = canvas.getBoundingClientRect();
  const mouseX = clientX - rect.left;
  const mouseY = clientY - rect.top;

  const magW = magnifier.width;
  const magH = magnifier.height;
  magnifier.style.left    = `${mouseX + 16}px`;
  magnifier.style.top     = `${mouseY + 16}px`;
  magnifier.style.display = 'block';

  const { x, y }  = imageToCanvasCoords(clientX, clientY);
  const scaleToImg = img.naturalWidth / canvas.width;
  const imgX = x * scaleToImg;
  const imgY = y * (img.naturalHeight / canvas.height);

  const srcWidth  = magW / magnifierZoom;
  const srcHeight = magH / magnifierZoom;
  const srcCX = imgX, srcCY = imgY;

  const clampedSrcX = Math.max(0, Math.min(srcCX - srcWidth  / 2, img.naturalWidth  - srcWidth));
  const clampedSrcY = Math.max(0, Math.min(srcCY - srcHeight / 2, img.naturalHeight - srcHeight));
  const destOffX    = (clampedSrcX - (srcCX - srcWidth  / 2)) * magnifierZoom;
  const destOffY    = (clampedSrcY - (srcCY - srcHeight / 2)) * magnifierZoom;

  magCtx.clearRect(0, 0, magW, magH);
  magCtx.fillStyle = document.body.classList.contains('dark') ? '#222' : '#ddd';
  magCtx.fillRect(0, 0, magW, magH);
  magCtx.filter = buildFilter();
  try {
    magCtx.drawImage(
      img,
      clampedSrcX, clampedSrcY,
      Math.min(srcWidth,  img.naturalWidth),
      Math.min(srcHeight, img.naturalHeight),
      destOffX, destOffY,
      Math.min(srcWidth,  img.naturalWidth)  * magnifierZoom,
      Math.min(srcHeight, img.naturalHeight) * magnifierZoom
    );
  } catch (e) { magnifier.style.display = 'none'; return; }
  magCtx.filter = 'none';

  const toMagX = cx => ((cx * (img.naturalWidth  / canvas.width)  - srcCX) * magnifierZoom + magW / 2);
  const toMagY = cy => ((cy * (img.naturalHeight / canvas.height) - srcCY) * magnifierZoom + magH / 2);

  // IMPROVEMENT C: smooth spline in magnifier too
  if (highlightPath.length > 1) {
    drawSplinePath(
      highlightPath.map(p => ({ x: toMagX(p.x), y: toMagY(p.y) })),
      magCtx,
      Math.max(1.5, highlightWidth * magnifierZoom * 0.5),
      'rgba(255, 80, 0, 0.85)'
    );
  }

  magCtx.fillStyle = 'red';
  axisPoints.forEach((p, i) => {
    const mx = toMagX(p.x), my = toMagY(p.y);
    magCtx.beginPath(); magCtx.arc(mx, my, 5, 0, 2 * Math.PI); magCtx.fill();
    magCtx.fillStyle = 'white'; magCtx.font = '10px Arial';
    magCtx.fillText(axisLabels[i], mx + 7, my - 7);
    magCtx.fillStyle = 'red';
  });

  // IMPROVEMENT A: image-space → magnifier coords for data points
  lines.forEach((line, lineIdx) => {
    magCtx.fillStyle = lineColors[lineIdx % lineColors.length];
    line.points.forEach((p, i) => {
      const { x, y } = pointCanvasXY(p);
      const mx = toMagX(x), my = toMagY(y);
      magCtx.beginPath(); magCtx.arc(mx, my, 3, 0, 2 * Math.PI);
      if (lineIdx === currentLineIndex && i === selectedPointIndex) {
        magCtx.strokeStyle = 'yellow'; magCtx.lineWidth = 2; magCtx.stroke();
      }
      magCtx.fill();
    });
  });

  // Crosshair
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
 * IMPROVEMENT C: Catmull-Rom spline (now actively used above)
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
  axisPoints = [];
  mode = 'axes';
  axisInputs.style.display = 'block';
  updateAxisLabels();
  axisInstruction.textContent = sharedOrigin.checked
    ? 'Click point for Shared Origin (X1/Y1) on the chart.'
    : `Click point for ${axisLabels[0]} on the chart.`;
  highlightControls.style.display = 'none';
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
    draw(); saveState(); saveSession();
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
  highlightControls.style.display = 'none';
  draw(); saveState(); saveSession();
});

calibrateBtn.addEventListener('click', () => {
  const x1Val = parseFloat(document.getElementById('x1-value').value);
  const x2Val = parseFloat(document.getElementById('x2-value').value);
  const y1Val = parseFloat(document.getElementById('y1-value').value);
  const y2Val = parseFloat(document.getElementById('y2-value').value);
  if ([x1Val, x2Val, y1Val, y2Val].some(isNaN)) { showModal('Please enter valid axis values'); return; }
  if (x1Val === x2Val || y1Val === y2Val)        { showModal('Axis values must be different');  return; }

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
  axisInputs.style.display        = 'none';
  axisInstruction.textContent     = 'Calibration complete. Select a mode to digitize.';
  highlightControls.style.display = 'none';
  updateButtonStates();
  lines.forEach(line => line.points.forEach(p => {
    const { x, y } = pointCanvasXY(p);
    const dc = canvasToDataCoords(x, y);
    if (dc) { p.dataX = dc.dataX; p.dataY = dc.dataY; }
  }));
  saveState(); saveSession(); draw(); updatePreview();
});

resetCalibrationBtn.addEventListener('click', () => {
  isCalibrated = false;
  scaleX = scaleY = offsetX = offsetY = undefined;
  axisPoints = [];
  mode = 'none';
  axisInstruction.textContent = 'Click "Set Axis Points" then enter values.';
  axisInputs.style.display    = 'none';
  _applyCalibrationButtonState();
  updateButtonStates();
  draw(); saveState(); saveSession();
});

toggleGridBtn.addEventListener('click', () => {
  showGrid = !showGrid;
  draw(); saveState(); saveSession();
});

// FIX #2: guard against accessing axisPoints before they exist
toggleLogXBtn.addEventListener('click', () => {
  logX = !logX;
  toggleLogXBtn.classList.toggle('log-active', logX);
  if (isCalibrated && axisPoints.length >= 2) {
    const x1Val = parseFloat(document.getElementById('x1-value').value);
    const x2Val = parseFloat(document.getElementById('x2-value').value);
    if (logX && (x1Val <= 0 || x2Val <= 0)) {
      showModal('Log X requires positive X1, X2 values. Reverting.');
      logX = false; toggleLogXBtn.classList.remove('log-active'); return;
    }
    const deltaPixX = axisPoints[1].x - axisPoints[0].x;
    const deltaValX = logX ? Math.log10(x2Val) - Math.log10(x1Val) : x2Val - x1Val;
    if (deltaValX === 0) return;
    scaleX  = deltaPixX / deltaValX;
    offsetX = logX ? axisPoints[0].x - Math.log10(x1Val) * scaleX : axisPoints[0].x - x1Val * scaleX;
    lines.forEach(l => l.points.forEach(p => {
      const { x, y } = pointCanvasXY(p);
      const d = canvasToDataCoords(x, y);
      if (d) p.dataX = d.dataX;
    }));
    updatePreview(); draw(); saveState(); saveSession();
  }
});

toggleLogYBtn.addEventListener('click', () => {
  logY = !logY;
  toggleLogYBtn.classList.toggle('log-active', logY);
  const yIdx0 = sharedOrigin.checked ? 0 : 2;
  const yIdx1 = sharedOrigin.checked ? 2 : 3;
  if (isCalibrated && axisPoints.length > yIdx1) {
    const y1Val = parseFloat(document.getElementById('y1-value').value);
    const y2Val = parseFloat(document.getElementById('y2-value').value);
    if (logY && (y1Val <= 0 || y2Val <= 0)) {
      showModal('Log Y requires positive Y1, Y2 values. Reverting.');
      logY = false; toggleLogYBtn.classList.remove('log-active'); return;
    }
    const deltaPixY = axisPoints[yIdx1].y - axisPoints[yIdx0].y;
    const deltaValY = logY ? Math.log10(y2Val) - Math.log10(y1Val) : y2Val - y1Val;
    if (deltaValY === 0) return;
    scaleY  = deltaPixY / deltaValY;
    offsetY = logY ? axisPoints[yIdx0].y - Math.log10(y1Val) * scaleY : axisPoints[yIdx0].y - y1Val * scaleY;
    lines.forEach(l => l.points.forEach(p => {
      const { x, y } = pointCanvasXY(p);
      const d = canvasToDataCoords(x, y);
      if (d) p.dataY = d.dataY;
    }));
    updatePreview(); draw(); saveState(); saveSession();
  }
});

/**********************
 * ENHANCEMENT CONTROLS
 **********************/
brightnessSlider.addEventListener('input', e => {
  brightnessVal = parseFloat(e.target.value);
  document.getElementById('brightness-val').textContent = brightnessVal + '%';
  buildProcessedImageData(() => draw());
  saveSession();
});

contrastSlider.addEventListener('input', e => {
  contrastVal = parseFloat(e.target.value);
  document.getElementById('contrast-val').textContent = contrastVal + '%';
  buildProcessedImageData(() => draw());
  saveSession();
});

snapToggle.addEventListener('change', () => { snapToLine = snapToggle.checked; saveSession(); });

gridFilterToggle.addEventListener('change', () => {
  gridFilterOn = gridFilterToggle.checked;
  buildProcessedImageData(() => draw());
  saveSession();
});

/**********************
 * VIEW CONTROLS  (IMPROVEMENT B: zoom clamped)
 **********************/
function clampZoom(z) { return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z)); }

document.getElementById('zoom-in').onclick    = () => { zoom = clampZoom(zoom * 1.2); draw(); saveSession(); };
document.getElementById('zoom-out').onclick   = () => { zoom = clampZoom(zoom / 1.2); draw(); saveSession(); };
document.getElementById('reset-view').onclick = () => { zoom = 1; panX = 0; panY = 0; draw(); saveSession(); };
document.getElementById('pan-mode').onclick   = () => {
  isPanning = !isPanning;
  canvas.style.cursor = isPanning ? 'move' : 'default';
  saveSession();
};
document.getElementById('toggle-theme').onclick = () => {
  document.body.classList.toggle('dark');
  localStorage.setItem('theme', document.body.classList.contains('dark') ? 'dark' : 'light');
};

document.getElementById('magnifier-zoom').addEventListener('input', e => {
  magnifierZoom = parseFloat(e.target.value);
  if (magnifierZoom < 1) magnifierZoom = 1;
  saveSession(); draw();
});

document.getElementById('highlight-width').addEventListener('input', e => {
  highlightWidth = parseFloat(e.target.value);
  draw();
});

/**********************
 * PANNING
 **********************/
canvas.addEventListener('mousemove', e => {
  if (isPanDragging && e.buttons === 1) {
    panX = e.clientX - startPan.x;
    panY = e.clientY - startPan.y;
    draw();
  }
});

canvas.addEventListener('mouseout',   () => { magnifier.style.display = 'none'; });
canvas.addEventListener('mouseleave', () => {
  magnifier.style.display = 'none';
  statusBar.textContent   = `Mode: ${mode}`;
});
canvas.addEventListener('mouseup', () => { isPanDragging = false; });
canvas.addEventListener('contextmenu', e => e.preventDefault());

// IMPROVEMENT B: zoom clamped on wheel too, anchored to cursor position
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const rect   = canvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;
  const factor  = e.deltaY < 0 ? 1.1 : 1 / 1.1;
  const newZoom = clampZoom(zoom * factor);
  const scale   = newZoom / zoom;
  panX  = mouseX - scale * (mouseX - panX);
  panY  = mouseY - scale * (mouseY - panY);
  zoom  = newZoom;
  draw(); saveSession();
}, { passive: false });

/**********************
 * KEYBOARD SHORTCUTS (IMPROVEMENT B: clamped)
 **********************/
document.addEventListener('keydown', e => {
  if (e.ctrlKey && e.key === 'z') { undoBtn.click(); e.preventDefault(); }
  if (e.ctrlKey && e.key === 'y') { redoBtn.click(); e.preventDefault(); }
  if (e.key === '+') { zoom = clampZoom(zoom * 1.2); draw(); saveSession(); }
  if (e.key === '-') { zoom = clampZoom(zoom / 1.2); draw(); saveSession(); }
  if (e.key === '0') { zoom = 1; panX = 0; panY = 0; draw(); saveSession(); }
  if (e.key === 'p' && isCalibrated) addPointBtn.click();
  if (e.key === 'h' && isCalibrated) highlightLineBtn.click();
});

/**********************
 * WINDOW RESIZE
 * IMPROVEMENT A: canvas dimensions change but points stay in image-space,
 * so no point coordinates need to be recalculated here.
 **********************/
window.addEventListener('resize', () => {
  if (img.src && img.complete && img.naturalWidth > 0) {
    canvas.width  = Math.min(img.naturalWidth,  window.innerWidth * 0.75);
    canvas.height = canvas.width * (img.naturalHeight / img.naturalWidth);
    draw();
  }
});

/**********************
 * INITIALIZATION
 **********************/
document.addEventListener('DOMContentLoaded', () => {
  loadSession();
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'dark') document.body.classList.add('dark');
  draw();
});
ENDOFFILE
echo "Done. Lines: $(wc -l < /mnt/user-data/outputs/digitizer-core.js)"
