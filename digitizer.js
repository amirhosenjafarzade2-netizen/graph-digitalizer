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
const lineColors = ['#0000FF', '#00FF00', '#FF0000', '#800080', '#FFA500', '#A52A2A', '#FFC0CB', '#808080'];
const axisLabels = ['X1', 'X2', 'Y1', 'Y2'];

// UI elements
const setAxesBtn = document.getElementById('set-axes');
const resetAxisPointsBtn = document.getElementById('reset-axis-points');
const axisInputs = document.getElementById('axis-inputs');
const orthogonalAxes = document.getElementById('orthogonal-axes');
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
    if (callback) callback(document.getElementById('modal-input')?.value || null);
  };
  btnContainer.appendChild(okBtn);
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.marginLeft = '10px';
  cancelBtn.onclick = () => { modal.style.display = 'none'; };
  btnContainer.appendChild(cancelBtn);
  content.appendChild(btnContainer);
  modal.style.display = 'flex';
}

function getCanvasCoords(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left - panX) / zoom,
    y: (e.clientY - rect.top - panY) / zoom
  };
}

function toRealX(px) {
  if (logX && px >= 0) return Math.exp((px - offsetX) / scaleX);
  return (px - offsetX) / scaleX;
}

function toRealY(py) {
  if (logY && py >= 0) return Math.exp((py - offsetY) / scaleY);
  return (py - offsetY) / scaleY;
}

function toPixelX(rx) {
  if (logX && rx > 0) return offsetX + scaleX * Math.log(rx);
  return offsetX + scaleX * rx;
}

function toPixelY(ry) {
  if (logY && ry > 0) return offsetY + scaleY * Math.log(ry);
  return offsetY + scaleY * ry;
}

function draw() {
  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.translate(panX, panY);
  ctx.scale(zoom, zoom);
  if (img.width && img.height) {
    ctx.drawImage(img, 0, 0, canvas.width / zoom, canvas.height / zoom);
  }
  // Draw axis points
  axisPoints.forEach((pt, i) => {
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 5 / zoom, 0, 2 * Math.PI);
    ctx.fillStyle = 'red';
    ctx.fill();
    ctx.fillStyle = 'black';
    ctx.font = `${12 / zoom}px Arial`;
    ctx.fillText(axisLabels[i], pt.x + 5 / zoom, pt.y - 5 / zoom);
  });
  // Draw grid if shown
  if (showGrid && isCalibrated && img.width && img.height) {
    ctx.strokeStyle = 'rgba(0,0,0,0.2)';
    ctx.lineWidth = 1 / zoom;
    const minX = toRealX(0), maxX = toRealX(img.width);
    const minY = toRealY(img.height), maxY = toRealY(0);
    for (let x = Math.floor(minX); x <= Math.ceil(maxX); x += (maxX - minX) / 10) {
      ctx.beginPath();
      ctx.moveTo(toPixelX(x), 0);
      ctx.lineTo(toPixelX(x), img.height);
      ctx.stroke();
    }
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y += (maxY - minY) / 10) {
      ctx.beginPath();
      ctx.moveTo(0, toPixelY(y));
      ctx.lineTo(img.width, toPixelY(y));
      ctx.stroke();
    }
  }
  // Draw points
  lines.forEach((line, lineIdx) => {
    line.points.forEach((pt, idx) => {
      ctx.beginPath();
      ctx.arc(pt.px, pt.py, 3 / zoom, 0, 2 * Math.PI);
      ctx.fillStyle = lineIdx === currentLineIndex ? 'yellow' : lineColors[lineIdx % lineColors.length];
      ctx.fill();
      if (lineIdx === currentLineIndex) {
        ctx.fillStyle = 'black';
        ctx.fillText(`${pt.x.toFixed(2)},${pt.y.toFixed(2)}`, pt.px + 5 / zoom, pt.py - 5 / zoom);
      }
    });
  });
  // Draw highlight path if highlighting
  if (isHighlighting && highlightPath.length) {
    ctx.strokeStyle = 'yellow';
    ctx.lineWidth = highlightWidth / zoom;
    ctx.beginPath();
    highlightPath.forEach((pt, i) => {
      if (i === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    });
    ctx.stroke();
  }
  ctx.restore();
  // Update magnifier
  if (magnifier.style.display === 'block') {
    const rect = canvas.getBoundingClientRect();
    const mouseX = (lastMouseX - rect.left - panX) / zoom;
    const mouseY = (lastMouseY - rect.top - panY) / zoom;
    magCtx.clearRect(0, 0, magnifier.width, magnifier.height);
    const magZoom = magnifierZoom * zoom;
    magCtx.drawImage(img,
      (mouseX - magnifier.width / (2 * magZoom)) * zoom + panX,
      (mouseY - magnifier.height / (2 * magZoom)) * zoom + panY,
      magnifier.width / magZoom, magnifier.height / magZoom,
      0, 0, magnifier.width, magnifier.height);
  }
}

function updatePreview() {
  previewTable.innerHTML = '';
  const thead = document.createElement('thead');
  const tr = document.createElement('tr');
  ['Line', 'X', 'Y'].forEach(text => {
    const th = document.createElement('th');
    th.textContent = text;
    tr.appendChild(th);
  });
  thead.appendChild(tr);
  previewTable.appendChild(thead);
  const tbody = document.createElement('tbody');
  lines.forEach(line => {
    line.points.forEach(pt => {
      const row = document.createElement('tr');
      [line.name, pt.x.toFixed(2), pt.y.toFixed(2)].forEach(text => {
        const td = document.createElement('td');
        td.textContent = text;
        row.appendChild(td);
      });
      tbody.appendChild(row);
    });
  });
  previewTable.appendChild(tbody);
}

function updateButtonStates() {
  [addPointBtn, adjustPointBtn, deletePointBtn, highlightLineBtn].forEach(btn => btn.classList.remove('active'));
  if (mode === 'add') addPointBtn.classList.add('active');
  if (mode === 'adjust') adjustPointBtn.classList.add('active');
  if (mode === 'delete') deletePointBtn.classList.add('active');
  if (mode === 'highlight') highlightLineBtn.classList.add('active');
  toggleGridBtn.classList.toggle('active', showGrid);
  toggleLogXBtn.classList.toggle('log-active', logX);
  toggleLogYBtn.classList.toggle('log-active', logY);
}

function updateLineSelect() {
  lineSelect.innerHTML = '';
  lines.forEach((line, idx) => {
    const option = document.createElement('option');
    option.value = idx;
    option.textContent = line.name;
    lineSelect.appendChild(option);
  });
  lineSelect.value = currentLineIndex;
}

function saveState() {
  if (historyIndex < history.length - 1) history = history.slice(0, historyIndex + 1);
  history.push({
    lines: JSON.parse(JSON.stringify(lines)),
    axisPoints: JSON.parse(JSON.stringify(axisPoints)),
    scaleX, scaleY, offsetX, offsetY, logX, logY, isCalibrated,
    zoom, panX, panY, showGrid, mode, currentLineIndex, magnifierZoom
  });
  historyIndex = history.length - 1;
  undoBtn.disabled = historyIndex <= 0;
  redoBtn.disabled = historyIndex >= history.length - 1;
  saveSession();
}

function saveSession() {
  const state = history[historyIndex];
  localStorage.setItem('digitizerState', JSON.stringify(state));
  if (img.src) localStorage.setItem('imgSrc', img.src);
}

function loadSession() {
  const savedState = localStorage.getItem('digitizerState');
  if (savedState) {
    const state = JSON.parse(savedState);
    lines = state.lines || [{ name: 'Line 1', points: [] }];
    axisPoints = state.axisPoints || [];
    scaleX = state.scaleX || 1;
    scaleY = state.scaleY || 1;
    offsetX = state.offsetX || 0;
    offsetY = state.offsetY || 0;
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
    document.getElementById('magnifier-zoom').value = magnifierZoom;
    toggleLogXBtn.classList.toggle('log-active', logX);
    toggleLogYBtn.classList.toggle('log-active', logY);
    updateLineSelect();
    updatePreview();
    updateButtonStates();
    axisInputs.style.display = isCalibrated ? 'none' : axisPoints.length > 0 ? 'block' : 'none';
    axisInstruction.textContent = isCalibrated ? 'Calibration complete. Select a mode to digitize.' : axisPoints.length < 4 ? `Click point for ${axisLabels[axisPoints.length]} on the chart.` : 'Enter axis values and click Calibrate.';
    calibrateBtn.disabled = axisPoints.length !== 4;
    if (isCalibrated) {
      addPointBtn.disabled = false;
      adjustPointBtn.disabled = false;
      deletePointBtn.disabled = false;
      highlightLineBtn.disabled = false;
      clearPointsBtn.disabled = false;
      sortPointsBtn.disabled = false;
      newLineBtn.disabled = false;
      renameLineBtn.disabled = false;
    } else {
      addPointBtn.disabled = true;
      adjustPointBtn.disabled = true;
      deletePointBtn.disabled = true;
      highlightLineBtn.disabled = true;
      clearPointsBtn.disabled = true;
      sortPointsBtn.disabled = true;
      newLineBtn.disabled = true;
      renameLineBtn.disabled = true;
    }
    const savedImg = localStorage.getItem('imgSrc');
    if (savedImg && savedImg !== 'undefined') {
      img.src = savedImg;
      img.onload = draw;
    }
    history = [state];
    historyIndex = 0;
    undoBtn.disabled = true;
    redoBtn.disabled = true;
  }
}

/**********************
 * EVENT LISTENERS
 **********************/

// Zoom in
document.getElementById('zoom-in').addEventListener('click', () => {
  zoom *= 1.2;
  draw();
  saveState();
});

// Zoom out
document.getElementById('zoom-out').addEventListener('click', () => {
  zoom /= 1.2;
  draw();
  saveState();
});

// Reset view
document.getElementById('reset-view').addEventListener('click', () => {
  zoom = 1;
  panX = 0;
  panY = 0;
  draw();
  saveState();
});

// Toggle pan
document.getElementById('pan-mode').addEventListener('click', () => {
  isPanning = !isPanning;
  canvas.style.cursor = isPanning ? 'grab' : 'crosshair';
});

// Toggle theme
document.getElementById('toggle-theme').addEventListener('click', () => {
  document.body.classList.toggle('dark');
  localStorage.setItem('theme', document.body.classList.contains('dark') ? 'dark' : 'light');
});

// Magnifier zoom slider
document.getElementById('magnifier-zoom').addEventListener('input', e => {
  magnifierZoom = parseInt(e.target.value);
  saveState();
});

// Set axes
setAxesBtn.addEventListener('click', () => {
  mode = 'axes';
  axisPoints = [];
  axisInstruction.textContent = `Click point for ${axisLabels[0]} on the chart.`;
  axisInputs.style.display = 'none';
  calibrateBtn.disabled = true;
  canvas.style.cursor = 'crosshair';
  saveState();
});

// Reset axis points
resetAxisPointsBtn.addEventListener('click', () => {
  axisPoints = [];
  mode = 'none';
  axisInstruction.textContent = 'Click "Set Axis Points" then enter values.';
  axisInputs.style.display = 'none';
  calibrateBtn.disabled = true;
  draw();
  saveState();
});

// Calibrate
calibrateBtn.addEventListener('click', () => {
  let x1 = parseFloat(document.getElementById('x1-value').value);
  let x2 = parseFloat(document.getElementById('x2-value').value);
  let y1 = parseFloat(document.getElementById('y1-value').value);
  let y2 = parseFloat(document.getElementById('y2-value').value);
  if (isNaN(x1) || isNaN(x2) || isNaN(y1) || isNaN(y2)) {
    showModal('Please enter valid axis values.');
    return;
  }
  if ((logX && (x1 <= 0 || x2 <= 0)) || (logY && (y1 <= 0 || y2 <= 0))) {
    showModal('Log scale values must be positive.');
    return;
  }
  if (orthogonalAxes.checked) {
    const dx = axisPoints[1].x - axisPoints[0].x;
    const dy = axisPoints[1].y - axisPoints[0].y;
    axisPoints[2] = { x: axisPoints[0].x - dy, y: axisPoints[0].y + dx };
    axisPoints[3] = { x: axisPoints[1].x - dy, y: axisPoints[1].y + dx };
  }
  offsetX = axisPoints[0].x;
  offsetY = axisPoints[0].y;
  scaleX = (axisPoints[1].x - axisPoints[0].x) / (x2 - x1);
  scaleY = (axisPoints[3].y - axisPoints[2].y) / (y2 - y1);
  if (logX) scaleX = (axisPoints[1].x - axisPoints[0].x) / (Math.log(x2) - Math.log(x1));
  if (logY) scaleY = (axisPoints[3].y - axisPoints[2].y) / (Math.log(y2) - Math.log(y1));
  isCalibrated = true;
  mode = 'none';
  axisInstruction.textContent = 'Calibration complete. Select a mode to digitize.';
  axisInputs.style.display = 'none';
  [addPointBtn, adjustPointBtn, deletePointBtn, highlightLineBtn, clearPointsBtn, sortPointsBtn, newLineBtn, renameLineBtn].forEach(btn => btn.disabled = false);
  draw();
  saveState();
});

// Reset calibration
resetCalibrationBtn.addEventListener('click', () => {
  isCalibrated = false;
  logX = logY = false;
  axisPoints = [];
  lines.forEach(line => line.points = []);
  mode = 'none';
  axisInstruction.textContent = 'Click "Set Axis Points" then enter values.';
  [toggleLogXBtn, toggleLogYBtn].forEach(btn => btn.classList.remove('log-active'));
  [addPointBtn, adjustPointBtn, deletePointBtn, highlightLineBtn, clearPointsBtn, sortPointsBtn, newLineBtn, renameLineBtn].forEach(btn => btn.disabled = true);
  updatePreview();
  updateButtonStates();
  draw();
  saveState();
});

// Toggle grid
toggleGridBtn.addEventListener('click', () => {
  showGrid = !showGrid;
  updateButtonStates();
  draw();
  saveState();
});

// Toggle log X
toggleLogXBtn.addEventListener('click', () => {
  logX = !logX;
  if (logX && axisPoints.length === 4) {
    const x1 = parseFloat(document.getElementById('x1-value').value);
    const x2 = parseFloat(document.getElementById('x2-value').value);
    if (x1 <= 0 || x2 <= 0) {
      logX = false;
      showModal('Log scale requires positive values.');
      return;
    }
  }
  updateButtonStates();
  draw();
  saveState();
});

// Toggle log Y
toggleLogYBtn.addEventListener('click', () => {
  logY = !logY;
  if (logY && axisPoints.length === 4) {
    const y1 = parseFloat(document.getElementById('y1-value').value);
    const y2 = parseFloat(document.getElementById('y2-value').value);
    if (y1 <= 0 || y2 <= 0) {
      logY = false;
      showModal('Log scale requires positive values.');
      return;
    }
  }
  updateButtonStates();
  draw();
  saveState();
});

// Add point mode
addPointBtn.addEventListener('click', () => {
  mode = mode === 'add' ? 'none' : 'add';
  updateButtonStates();
});

// Adjust point mode
adjustPointBtn.addEventListener('click', () => {
  mode = mode === 'adjust' ? 'none' : 'adjust';
  updateButtonStates();
});

// Delete point mode
deletePointBtn.addEventListener('click', () => {
  mode = mode === 'delete' ? 'none' : 'delete';
  updateButtonStates();
});

// Highlight line mode
highlightLineBtn.addEventListener('click', () => {
  mode = mode === 'highlight' ? 'none' : 'highlight';
  highlightControls.style.display = mode === 'highlight' ? 'block' : 'none';
  updateButtonStates();
});

// Delete highlight
deleteHighlightBtn.addEventListener('click', () => {
  highlightPath = [];
  draw();
  saveState();
});

// Clear points
clearPointsBtn.addEventListener('click', () => {
  lines[currentLineIndex].points = [];
  updatePreview();
  draw();
  saveState();
});

// Sort points
sortPointsBtn.addEventListener('click', () => {
  lines[currentLineIndex].points.sort((a, b) => a.x - b.x);
  updatePreview();
  draw();
  saveState();
});

// New line
newLineBtn.addEventListener('click', () => {
  showModal('Enter line name:', true, name => {
    if (name && !lines.some(l => l.name === name)) {
      lines.push({ name, points: [] });
      currentLineIndex = lines.length - 1;
      updateLineSelect();
      saveState();
    } else {
      showModal('Name already exists or invalid.');
    }
  });
});

// Rename line
renameLineBtn.addEventListener('click', () => {
  showModal('Enter new name:', true, name => {
    if (name && !lines.some(l => l.name === name)) {
      lines[currentLineIndex].name = name;
      updateLineSelect();
      updatePreview();
      saveState();
    } else {
      showModal('Name already exists or invalid.');
    }
  });
});

// Line select
lineSelect.addEventListener('change', e => {
  currentLineIndex = parseInt(e.target.value);
  draw();
  saveState();
});

// Import JSON
importJsonBtn.addEventListener('click', () => importJsonInput.click());
importJsonInput.addEventListener('change', e => {
  const file = e.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const state = JSON.parse(ev.target.result);
        lines = state.lines || [{ name: 'Line 1', points: [] }];
        axisPoints = state.axisPoints || [];
        scaleX = state.scaleX || 1;
        scaleY = state.scaleY || 1;
        offsetX = state.offsetX || 0;
        offsetY = state.offsetY || 0;
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
        toggleLogXBtn.classList.toggle('log-active', logX);
        toggleLogYBtn.classList.toggle('log-active', logY);
        document.getElementById('magnifier-zoom').value = magnifierZoom;
        updateLineSelect();
        updatePreview();
        updateButtonStates();
        axisInputs.style.display = isCalibrated ? 'none' : axisPoints.length > 0 ? 'block' : 'none';
        axisInstruction.textContent = isCalibrated ? 'Calibration complete. Select a mode to digitize.' : axisPoints.length < 4 ? `Click point for ${axisLabels[axisPoints.length]} on the chart.` : 'Enter axis values and click Calibrate.';
        calibrateBtn.disabled = axisPoints.length !== 4;
        [addPointBtn, adjustPointBtn, deletePointBtn, highlightLineBtn, clearPointsBtn, sortPointsBtn, newLineBtn, renameLineBtn].forEach(btn => btn.disabled = !isCalibrated);
        draw();
        saveState();
      } catch (e) {
        showModal('Invalid JSON file.');
      }
    };
    reader.readAsText(file);
  }
});

// Export JSON
exportJsonBtn.addEventListener('click', () => {
  const state = history[historyIndex] || {};
  const blob = new Blob([JSON.stringify(state)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'digitizer.json';
  a.click();
  URL.revokeObjectURL(url);
});

// Export CSV
exportCsvBtn.addEventListener('click', () => {
  let csv = 'Line,X,Y\n';
  lines.forEach(line => {
    line.points.forEach(pt => {
      csv += `${line.name},${pt.x.toFixed(2)},${pt.y.toFixed(2)}\n`;
    });
  });
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'data.csv';
  a.click();
  URL.revokeObjectURL(url);
});

// Export XLSX
exportXlsxBtn.addEventListener('click', () => {
  const wb = XLSX.utils.book_new();
  lines.forEach(line => {
    const ws_data = [['X', 'Y']];
    line.points.forEach(pt => ws_data.push([pt.x, pt.y]));
    const ws = XLSX.utils.aoa_to_sheet(ws_data);
    XLSX.utils.book_append_sheet(wb, ws, line.name);
  });
  XLSX.writeFile(wb, 'data.xlsx');
});

// Clear session
clearSessionBtn.addEventListener('click', () => {
  localStorage.clear();
  location.reload();
});

// Total reset
totalResetBtn.addEventListener('click', () => {
  lines = [{ name: 'Line 1', points: [] }];
  currentLineIndex = 0;
  axisPoints = [];
  isCalibrated = false;
  logX = logY = false;
  zoom = 1;
  panX = panY = 0;
  showGrid = false;
  mode = 'none';
  highlightPath = [];
  isHighlighting = false;
  isDraggingPoint = false;
  magnifierZoom = 2;
  history = [];
  historyIndex = -1;
  updateLineSelect();
