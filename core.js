/**********************
 * GLOBAL STATE
 **********************/
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const magnifier = document.getElementById('magnifier');
const magCtx = magnifier.getContext('2d');
let img = new Image();
let zoom = 1, panX = 0, panY = 0, isPanning = false, startPan = { x: 0, y: 0 };
let axisPoints = [], isCalibrated = false, scaleX, scaleY, offsetX, offsetY;
let lines = [{ name: 'Line 1', points: [] }], currentLineIndex = 0;
let mode = 'none'; // 'axes', 'add', 'adjust', 'delete', 'highlight'
let selectedPointIndex = -1;
let history = [], historyIndex = -1;
let showGrid = false, logX = false, logY = false;
let highlightPath = [], isHighlighting = false;
let isDraggingPoint = false;
let highlightWidth = 2; // Default highlight brush width
let magnifierZoom = 2; // Default magnifier zoom
const lineColors = ['blue', 'green', 'red', 'purple', 'orange', 'brown', 'pink', 'gray'];
const axisLabels = ['X1', 'X2', 'Y1', 'Y2'];

// UI elements
const imageUpload = document.getElementById('image-upload');
const setAxesBtn = document.getElementById('set-axes');
const resetAxisPointsBtn = document.getElementById('reset-axis-points');
const axisInputs = document.getElementById('axis-inputs');
const orthogonalAxes = document.getElementById('orthogonal-axes');
const sharedOrigin = document.getElementById('shared-origin'); // New checkbox
const axisInstruction = document.getElementById('axis-instruction');
const calibrateBtn = document.getElementById('calibrate');
const resetCalibrationBtn = document.getElementById('reset-calibration');
const toggleGridBtn = document.getElementById('toggle-grid');
const toggleLogXBtn = document.getElementById('toggle-log-x');
const toggleLogYBtn = document.getElementById('toggle-log-y');
const addPointBtn = document.getElementById('add-point');
const adjustPointBtn = document.getElementById('adjust-point');
const deletePointBtn = document.getElementById('delete-point');
const highlightLineBtn = document.getElementById('highlight-line');
const highlightControls = document.getElementById('highlight-controls');
const highlightLineName = document.getElementById('highlight-line-name');
const nPointsInput = document.getElementById('n-points');
const deleteHighlightBtn = document.getElementById('delete-highlight');
const clearPointsBtn = document.getElementById('clear-points');
const sortPointsBtn = document.getElementById('sort-points');
const newLineBtn = document.getElementById('new-line');
const renameLineBtn = document.getElementById('rename-line');
const lineSelect = document.getElementById('line-select');
const importJsonBtn = document.getElementById('import-json');
const importJsonInput = document.getElementById('import-json-input');
const exportJsonBtn = document.getElementById('export-json');
const exportCsvBtn = document.getElementById('export-csv');
const exportXlsxBtn = document.getElementById('export-xlsx');
const clearSessionBtn = document.getElementById('clear-session');
const totalResetBtn = document.getElementById('total-reset');
const undoBtn = document.getElementById('undo');
const redoBtn = document.getElementById('redo');
const previewTable = document.getElementById('preview-table');
const statusBar = document.getElementById('status-bar');

/**********************
 * UTILITIES
 **********************/
function showModal(msg, withInput = false, callback = null) {
  const modal = document.getElementById('modal');
  const content = document.getElementById('modal-content');
  content.innerHTML = '';
  const p = document.createElement('p');
  p.textContent = msg;
  content.appendChild(p);
  if (withInput) {
    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'modal-input';
    input.style.width = '100%';
    content.appendChild(input);
  }
  const btnContainer = document.createElement('div');
  const okBtn = document.createElement('button');
  okBtn.textContent = 'OK';
  okBtn.onclick = () => {
    modal.style.display = 'none';
    if (callback) callback(withInput ? document.getElementById('modal-input').value : null);
  };
  btnContainer.appendChild(okBtn);
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.marginLeft = '10px';
  cancelBtn.onclick = () => { modal.style.display = 'none'; };
  btnContainer.appendChild(cancelBtn);
  content.appendChild(btnContainer);
  modal.style.display = 'flex';
  if (withInput) document.getElementById('modal-input').focus();
}

function showSpinner(on) { document.getElementById('spinner').style.display = on ? 'block' : 'none'; }

function saveSession() {
  localStorage.setItem('digitizerState', JSON.stringify({
    lines, axisPoints, scaleX, scaleY, offsetX, offsetY, logX, logY, isCalibrated,
    zoom, panX, panY, showGrid, mode, currentLineIndex, magnifierZoom
  }));
}

function loadSession() {
  const s = localStorage.getItem('digitizerState');
  if (s) {
    try {
      const state = JSON.parse(s);
      lines = state.lines || [{ name: 'Line 1', points: [] }];
      axisPoints = state.axisPoints || [];
      scaleX = state.scaleX;
      scaleY = state.scaleY;
      offsetX = state.offsetX;
      offsetY = state.offsetY;
      logX = state.logX || false;
      logY = state.logY || false;
      isCalibrated = state.isCalibrated || false;
      zoom = state.zoom || 1;
      panX = state.panX || 0;
      panY = state.panY || 0;
      showGrid = state.showGrid || false;
      mode = state.mode || 'none';
      currentLineIndex = state.currentLineIndex || 0;
      magnifierZoom = state.magnifierZoom || 2;
      updateLineSelect();
      updatePreview();
      updateButtonStates();
      toggleLogXBtn.classList.toggle('log-active', logX);
      toggleLogYBtn.classList.toggle('log-active', logY);
      document.getElementById('magnifier-zoom').value = magnifierZoom;
      if (isCalibrated) {
        addPointBtn.disabled = false;
        adjustPointBtn.disabled = false;
        deletePointBtn.disabled = false;
        highlightLineBtn.disabled = false;
        clearPointsBtn.disabled = false;
        sortPointsBtn.disabled = false;
        newLineBtn.disabled = false;
        renameLineBtn.disabled = false;
      }
      draw();
    } catch (e) {
      console.error('Failed to load session:', e);
      showModal('Failed to load session. Starting fresh.');
    }
  }
}

function saveState() {
  history = history.slice(0, historyIndex + 1);
  history.push({
    lines: JSON.parse(JSON.stringify(lines)),
    axisPoints: JSON.parse(JSON.stringify(axisPoints)),
    scaleX, scaleY, offsetX, offsetY,
    logX, logY, isCalibrated,
    zoom, panX, panY, showGrid, mode, currentLineIndex, magnifierZoom
  });
  historyIndex++;
  undoBtn.disabled = historyIndex <= 0;
  redoBtn.disabled = historyIndex >= history.length - 1;
  saveSession();
}

function download(filename, text, mimeType) {
  const a = document.createElement('a');
  a.href = `data:${mimeType};charset=utf-8,${encodeURIComponent(text)}`;
  a.download = filename;
  a.click();
}

function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

/**********************
 * IMAGE LOADING
 **********************/
function loadImage(dataUrl) {
  showSpinner(true);
  img.src = ''; // Clear previous image
  img.src = dataUrl;
  img.onload = () => {
    console.log('Image loaded successfully:', { width: img.width, height: img.height, src: dataUrl });
    zoom = 1;
    panX = 0;
    panY = 0;
    canvas.width = Math.min(img.width, window.innerWidth * 0.8);
    canvas.height = canvas.width * (img.height / img.width);
    if (canvas.width === 0 || canvas.height === 0) {
      showModal('Image dimensions are invalid. Please try another image.');
      console.error('Invalid image dimensions: width=', img.width, 'height=', img.height);
      showSpinner(false);
      return;
    }
    draw();
    setAxesBtn.disabled = false;
    resetAxisPointsBtn.disabled = false;
    saveState();
    saveSession();
    showSpinner(false);
    document.dispatchEvent(new Event('imageLoaded'));
  };
  img.onerror = () => {
    showModal('Failed to load image. Please try another image or check file integrity.');
    console.error('Image load failed: src=', dataUrl);
    showSpinner(false);
  };
}

/**********************
 * COORDINATE TRANSFORMATIONS
 **********************/
function imageToCanvasCoords(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const x = (clientX - rect.left - panX) / zoom;
  const y = (clientY - rect.top - panY) / zoom;
  return { x, y };
}

function canvasToDataCoords(x, y) {
  let dataX, dataY;
  try {
    dataX = logX ? Math.pow(10, (x - offsetX) / scaleX) : (x - offsetX) / scaleX;
    dataY = logY ? Math.pow(10, (y - offsetY) / scaleY) : (y - offsetY) / scaleY;
    if (isNaN(dataX) || isNaN(dataY) || !isFinite(dataX) || !isFinite(dataY)) {
      console.warn(`Invalid data coords: x=${x}, y=${y}, dataX=${dataX}, dataY=${dataY}`);
      return null;
    }
    return { dataX, dataY };
  } catch (e) {
    console.error('Error converting to data coords:', e);
    return null;
  }
}

/**********************
 * VIEW CONTROLS
 **********************/
document.getElementById('zoom-in').addEventListener('click', () => {
  zoom *= 1.2;
  draw();
  saveState();
});

document.getElementById('zoom-out').addEventListener('click', () => {
  zoom /= 1.2;
  draw();
  saveState();
});

document.getElementById('reset-view').addEventListener('click', () => {
  zoom = 1;
  panX = 0;
  panY = 0;
  draw();
  saveState();
});

document.getElementById('pan-mode').addEventListener('click', function () {
  isPanning = !isPanning;
  this.classList.toggle('active', isPanning);
  mode = isPanning ? 'pan' : 'none';
  updateButtonStates();
  draw();
});

document.getElementById('toggle-theme').addEventListener('click', () => {
  document.body.classList.toggle('dark');
  localStorage.setItem('theme', document.body.classList.contains('dark') ? 'dark' : 'light');
  draw();
});

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const delta = e.deltaY > 0 ? 1 / 1.1 : 1.1;
  zoom *= delta;
  draw();
  saveState();
});

canvas.addEventListener('mousedown', (e) => {
  if (isPanning && e.button === 0) {
    startPan = { x: e.clientX - panX, y: e.clientY - panY };
    canvas.style.cursor = 'grabbing';
  }
});

canvas.addEventListener('mousemove', (e) => {
  const { x, y } = imageToCanvasCoords(e.clientX, e.clientY);
  if (isPanning && e.buttons === 1) {
    panX = e.clientX - startPan.x;
    panY = e.clientY - startPan.y;
    draw();
  }
  // Magnifier logic
  if (img.src && img.complete && mode !== 'pan') {
    magnifier.style.display = 'block';
    const magSize = magnifier.width / magnifierZoom;
    const magX = x - magSize / 2;
    const magY = y - magSize / 2;
    magCtx.clearRect(0, 0, magnifier.width, magnifier.height);
    magCtx.drawImage(img, magX, magY, magSize, magSize, 0, 0, magnifier.width, magnifier.height);
    magCtx.beginPath();
    magCtx.moveTo(magnifier.width / 2 - 10, magnifier.height / 2);
    magCtx.lineTo(magnifier.width / 2 + 10, magnifier.height / 2);
    magCtx.moveTo(magnifier.width / 2, magnifier.height / 2 - 10);
    magCtx.lineTo(magnifier.width / 2, magnifier.height / 2 + 10);
    magCtx.strokeStyle = 'red';
    magCtx.stroke();
    const rect = canvas.getBoundingClientRect();
    magnifier.style.left = `${e.clientX - magnifier.width / 2}px`;
    magnifier.style.top = `${e.clientY - magnifier.height / 2}px`;
    const dataCoords = isCalibrated ? canvasToDataCoords(x, y) : null;
    statusBar.textContent = dataCoords
      ? `Canvas: (${x.toFixed(2)}, ${y.toFixed(2)}) Data: (${dataCoords.dataX.toFixed(2)}, ${dataCoords.dataY.toFixed(2)})`
      : `Canvas: (${x.toFixed(2)}, ${y.toFixed(2)})`;
  } else {
    magnifier.style.display = 'none';
    statusBar.textContent = '';
  }
});

canvas.addEventListener('mouseup', () => {
  if (isPanning) canvas.style.cursor = 'grab';
});

canvas.addEventListener('mouseleave', () => {
  magnifier.style.display = 'none';
  statusBar.textContent = '';
});

imageUpload.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (ev) => loadImage(ev.target.result);
    reader.readAsDataURL(file);
  }
});

/**********************
 * MAGNIFIER ZOOM
 **********************/
document.getElementById('magnifier-zoom').addEventListener('input', (e) => {
  magnifierZoom = parseFloat(e.target.value);
  saveSession();
  draw();
});

/**********************
 * CALIBRATION
 **********************/
setAxesBtn.addEventListener('click', () => {
  mode = 'axes';
  axisPoints = [];
  axisInputs.style.display = 'block';
  axisInstruction.textContent = `Click point for ${axisLabels[0]} on the chart.`;
  calibrateBtn.disabled = true;
  updateButtonStates();
  draw();
});

resetAxisPointsBtn.addEventListener('click', () => {
  axisPoints = [];
  axisInputs.style.display = 'none';
  axisInstruction.textContent = 'Click "Set Axis Points" then enter values.';
  mode = 'none';
  updateButtonStates();
  draw();
  saveState();
});

sharedOrigin.addEventListener('change', () => {
  if (axisPoints.length > 0) {
    axisPoints = [];
    axisInstruction.textContent = `Click point for ${axisLabels[0]} on the chart.`;
    draw();
    saveState();
  }
});

orthogonalAxes.addEventListener('change', () => {
  if (axisPoints.length > 2 && !sharedOrigin.checked) {
    axisPoints = axisPoints.slice(0, 2);
    axisInstruction.textContent = `Click point for ${axisLabels[2]} on the chart.`;
    draw();
    saveState();
  }
});

calibrateBtn.addEventListener('click', () => {
  const x1Val = parseFloat(document.getElementById('x1-value').value);
  const x2Val = parseFloat(document.getElementById('x2-value').value);
  const y1Val = parseFloat(document.getElementById('y1-value').value);
  const y2Val = parseFloat(document.getElementById('y2-value').value);
  if ([x1Val, x2Val, y1Val, y2Val].some(v => isNaN(v))) {
    showModal('Please enter valid numbers for all axis values.');
    return;
  }
  if (x1Val === x2Val || y1Val === y2Val) {
    showModal('Axis values must be distinct.');
    return;
  }
  const p1 = axisPoints[0], p2 = sharedOrigin.checked ? axisPoints[1] : axisPoints[1];
  const p3 = sharedOrigin.checked ? axisPoints[1] : axisPoints[2];
  const p4 = sharedOrigin.checked ? axisPoints[2] : axisPoints[3];
  scaleX = (x2Val - x1Val) / (p2.x - p1.x);
  offsetX = x1Val - scaleX * p1.x;
  scaleY = (y2Val - y1Val) / (p4.y - (sharedOrigin.checked ? p1.y : p3.y));
  offsetY = y1Val - scaleY * (sharedOrigin.checked ? p1.y : p3.y);
  if (!isFinite(scaleX) || !isFinite(scaleY) || !isFinite(offsetX) || !isFinite(offsetY)) {
    showModal('Calibration failed. Try different points or values.');
    return;
  }
  isCalibrated = true;
  axisInputs.style.display = 'none';
  axisInstruction.textContent = 'Calibration complete. Select a mode to digitize.';
  addPointBtn.disabled = false;
  adjustPointBtn.disabled = false;
  deletePointBtn.disabled = false;
  highlightLineBtn.disabled = false;
  clearPointsBtn.disabled = false;
  sortPointsBtn.disabled = false;
  newLineBtn.disabled = false;
  renameLineBtn.disabled = false;
  mode = 'none';
  updateButtonStates();
  draw();
  saveState();
  saveSession();
});

resetCalibrationBtn.addEventListener('click', () => {
  isCalibrated = false;
  axisPoints = [];
  scaleX = scaleY = offsetX = offsetY = null;
  axisInputs.style.display = 'none';
  axisInstruction.textContent = 'Click "Set Axis Points" then enter values.';
  addPointBtn.disabled = true;
  adjustPointBtn.disabled = true;
  deletePointBtn.disabled = true;
  highlightLineBtn.disabled = true;
  clearPointsBtn.disabled = true;
  sortPointsBtn.disabled = true;
  newLineBtn.disabled = true;
  renameLineBtn.disabled = true;
  mode = 'none';
  updateButtonStates();
  draw();
  saveState();
});

toggleGridBtn.addEventListener('click', () => {
  showGrid = !showGrid;
  toggleGridBtn.classList.toggle('active', showGrid);
  draw();
  saveState();
});

toggleLogXBtn.addEventListener('click', () => {
  logX = !logX;
  toggleLogXBtn.classList.toggle('log-active', logX);
  updatePreview();
  draw();
  saveState();
});

toggleLogYBtn.addEventListener('click', () => {
  logY = !logY;
  toggleLogYBtn.classList.toggle('log-active', logY);
  updatePreview();
  draw();
  saveState();
});

canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  const { x, y } = imageToCanvasCoords(e.clientX, e.clientY);
  if (mode === 'axes') {
    if (sharedOrigin.checked && axisPoints.length === 1) {
      axisPoints.push({ x, y });
      axisInstruction.textContent = `Click point for ${axisLabels[2]} on the chart.`;
    } else if (!sharedOrigin.checked && axisPoints.length < 4) {
      axisPoints.push({ x, y });
      axisInstruction.textContent = `Click point for ${axisLabels[axisPoints.length]} on the chart.`;
    } else if (sharedOrigin.checked && axisPoints.length < 3) {
      axisPoints.push({ x, y });
      axisInstruction.textContent = `Click point for ${axisLabels[axisPoints.length]} on the chart.`;
    }
    if (orthogonalAxes.checked && !sharedOrigin.checked && axisPoints.length === 3) {
      const p1 = axisPoints[0], p2 = axisPoints[1];
      const dx = p2.x - p1.x, dy = p2.y - p1.y;
      axisPoints.push({ x: p1.x - dy, y: p1.y + dx });
      axisInstruction.textContent = 'Enter axis values and click Calibrate.';
    }
    if (axisPoints.length === (sharedOrigin.checked ? 3 : 4)) {
      axisInstruction.textContent = 'Enter axis values and click Calibrate.';
    }
    calibrateBtn.disabled = axisPoints.length !== (sharedOrigin.checked ? 3 : 4);
    draw();
    saveState();
  }
});

/**********************
 * DRAWING
 **********************/
function drawGrid() {
  if (!showGrid || !isCalibrated) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
  ctx.lineWidth = 1 / zoom;
  const stepX = canvas.width / 10;
  const stepY = canvas.height / 10;
  for (let x = 0; x <= canvas.width; x += stepX) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  for (let y = 0; y <= canvas.height; y += stepY) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }
  ctx.restore();
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(panX, panY);
  ctx.scale(zoom, zoom);
  if (img.src && img.complete) {
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  }
  drawGrid();
  axisPoints.forEach((p, i) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5 / zoom, 0, 2 * Math.PI);
    ctx.fillStyle = i === 0 ? 'red' : i === 1 ? 'green' : i === 2 ? 'blue' : 'yellow';
    ctx.fill();
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 1 / zoom;
    ctx.stroke();
    ctx.font = `${12 / zoom}px Arial`;
    ctx.fillStyle = 'black';
    ctx.fillText(axisLabels[i], p.x + 5 / zoom, p.y - 5 / zoom);
  });
  lines.forEach((line, i) => {
    ctx.strokeStyle = lineColors[i % lineColors.length];
    ctx.fillStyle = lineColors[i % lineColors.length];
    ctx.lineWidth = 1 / zoom;
    line.points.forEach((p, j) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3 / zoom, 0, 2 * Math.PI);
      ctx.fill();
      if (i === currentLineIndex && j === selectedPointIndex) {
        ctx.strokeStyle = 'yellow';
        ctx.lineWidth = 2 / zoom;
        ctx.stroke();
      }
    });
    if (line.points.length > 1) {
      ctx.beginPath();
      ctx.moveTo(line.points[0].x, line.points[0].y);
      for (let j = 1; j < line.points.length; j++) {
        ctx.lineTo(line.points[j].x, line.points[j].y);
      }
      ctx.stroke();
    }
  });
  if (highlightPath.length > 0) {
    ctx.strokeStyle = 'cyan';
    ctx.lineWidth = highlightWidth / zoom;
    ctx.beginPath();
    ctx.moveTo(highlightPath[0].x, highlightPath[0].y);
    for (let i = 1; i < highlightPath.length; i++) {
      ctx.lineTo(highlightPath[i].x, highlightPath[i].y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/**********************
 * INITIALIZATION
 **********************/
window.addEventListener('resize', () => {
  if (img.src && img.complete && img.naturalWidth > 0) {
    canvas.width = Math.min(img.width, window.innerWidth * 0.8);
    canvas.height = canvas.width * (img.height / img.width);
    draw();
  }
});

if (localStorage.getItem('theme') === 'dark') {
  document.body.classList.add('dark');
}

window.addEventListener('load', () => {
  loadSession();
  draw();
});
