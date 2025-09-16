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
}

function getCanvasCoords(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left - panX) / zoom,
    y: (e.clientY - rect.top - panY) / zoom
  };
}

function toRealX(px) {
  if (logX) {
    return Math.exp((px - offsetX) / scaleX);
  }
  return (px - offsetX) / scaleX;
}

function toRealY(py) {
  if (logY) {
    return Math.exp((py - offsetY) / scaleY);
  }
  return (py - offsetY) / scaleY;
}

function toPixelX(rx) {
  if (logX) {
    return offsetX + scaleX * Math.log(rx);
  }
  return offsetX + scaleX * rx;
}

function toPixelY(ry) {
  if (logY) {
    return offsetY + scaleY * Math.log(ry);
  }
  return offsetY + scaleY * ry;
}

function draw() {
  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.translate(panX, panY);
  ctx.scale(zoom, zoom);
  ctx.drawImage(img, 0, 0, canvas.width / zoom, canvas.height / zoom);
  // Draw axis points
  axisPoints.forEach((pt, i) => {
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 5 / zoom, 0, 2 * Math.PI);
    ctx.fillStyle = 'red';
    ctx.fill();
    ctx.font = '12px Arial';
    ctx.fillText(axisLabels[i], pt.x + 5, pt.y - 5);
  });
  // Draw grid if shown
  if (showGrid && isCalibrated) {
    ctx.strokeStyle = 'rgba(0,0,0,0.2)';
    ctx.lineWidth = 1 / zoom;
    // Horizontal lines
    for (let y = Math.floor(toRealY(img.height)); y <= Math.ceil(toRealY(0)); y += (toRealY(0) - toRealY(img.height)) / 10) {
      ctx.beginPath();
      ctx.moveTo(0, toPixelY(y));
      ctx.lineTo(img.width, toPixelY(y));
      ctx.stroke();
    }
    // Vertical lines
    for (let x = Math.floor(toRealX(0)); x <= Math.ceil(toRealX(img.width)); x += (toRealX(img.width) - toRealX(0)) / 10) {
      ctx.beginPath();
      ctx.moveTo(toPixelX(x), 0);
      ctx.lineTo(toPixelX(x), img.height);
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
    });
  });
  // Draw highlight path if highlighting
  if (isHighlighting) {
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
  localStorage.setItem('imgSrc', img.src);
}

function loadSession() {
  const savedState = localStorage.getItem('digitizerState');
  if (savedState) {
    const state = JSON.parse(savedState);
    lines = state.lines;
    axisPoints = state.axisPoints;
    scaleX = state.scaleX;
    scaleY = state.scaleY;
    offsetX = state.offsetX;
    offsetY = state.offsetY;
    logX = state.logX;
    logY = state.logY;
    isCalibrated = state.isCalibrated;
    zoom = state.zoom;
    panX = state.panX;
    panY = state.panY;
    showGrid = state.showGrid;
    mode = state.mode;
    currentLineIndex = state.currentLineIndex;
    magnifierZoom = state.magnifierZoom;
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
    if (savedImg) {
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

// Image upload
imageUpload.addEventListener('change', e => {
  const file = e.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = ev => {
      img.src = ev.target.result;
      img.onload = () => {
        canvas.width = Math.min(img.width, window.innerWidth * 0.8);
        canvas.height = canvas.width * (img.height / img.width);
        draw();
        saveSession();
      };
    };
    reader.readAsDataURL(file);
  }
});

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
});

// Reset axis points
resetAxisPointsBtn.addEventListener('click', () => {
  axisPoints = [];
  mode = 'none';
  axisInstruction.textContent = 'Click "Set Axis Points" then enter values.';
  axisInputs.style.display = 'none';
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
  if (logX && (x1 <= 0 || x2 <= 0)) {
    showModal('Log scale values must be positive.');
    return;
  }
  if (logY && (y1 <= 0 || y2 <= 0)) {
    showModal('Log scale values must be positive.');
    return;
  }
  if (orthogonalAxes.checked) {
    // Force orthogonal
    const dx = axisPoints[1].x - axisPoints[0].x;
    const dy = axisPoints[1].y - axisPoints[0].y;
    axisPoints[2].x = axisPoints[0].x - dy;
    axisPoints[2].y = axisPoints[0].y + dx;
    axisPoints[3].x = axisPoints[1].x - dy;
    axisPoints[3].y = axisPoints[1].y + dx;
  }
  const px1 = axisPoints[0].x, px2 = axisPoints[1].x;
  const py1 = axisPoints[2].y, py2 = axisPoints[3].y; // Y inverted?
  offsetX = px1;
  offsetY = py1;
  scaleX = (px2 - px1) / (x2 - x1);
  scaleY = (py2 - py1) / (y2 - y1);
  if (logX) {
    scaleX = (px2 - px1) / (Math.log(x2) - Math.log(x1));
  }
  if (logY) {
    scaleY = (py2 - py1) / (Math.log(y2) - Math.log(y1));
  }
  isCalibrated = true;
  mode = 'none';
  axisInstruction.textContent = 'Calibration complete. Select a mode to digitize.';
  axisInputs.style.display = 'none';
  addPointBtn.disabled = false;
  adjustPointBtn.disabled = false;
  deletePointBtn.disabled = false;
  highlightLineBtn.disabled = false;
  clearPointsBtn.disabled = false;
  sortPointsBtn.disabled = false;
  newLineBtn.disabled = false;
  renameLineBtn.disabled = false;
  draw();
  saveState();
});

// Reset calibration
resetCalibrationBtn.addEventListener('click', () => {
  isCalibrated = false;
  logX = false;
  logY = false;
  axisPoints = [];
  lines.forEach(line => line.points = []);
  mode = 'none';
  axisInstruction.textContent = 'Click "Set Axis Points" then enter values.';
  toggleLogXBtn.classList.remove('log-active');
  toggleLogYBtn.classList.remove('log-active');
  addPointBtn.disabled = true;
  adjustPointBtn.disabled = true;
  deletePointBtn.disabled = true;
  highlightLineBtn.disabled = true;
  clearPointsBtn.disabled = true;
  sortPointsBtn.disabled = true;
  newLineBtn.disabled = true;
  renameLineBtn.disabled = true;
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
  updateButtonStates();
  saveState();
});

// Toggle log Y
toggleLogYBtn.addEventListener('click', () => {
  logY = !logY;
  updateButtonStates();
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
importJsonBtn.addEventListener('click', () => {
  importJsonInput.click();
});
importJsonInput.addEventListener('change', e => {
  const file = e.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = ev => {
      const state = JSON.parse(ev.target.result);
      lines = state.lines;
      axisPoints = state.axisPoints;
      scaleX = state.scaleX;
      scaleY = state.scaleY;
      offsetX = state.offsetX;
      offsetY = state.offsetY;
      logX = state.logX;
      logY = state.logY;
      isCalibrated = state.isCalibrated;
      zoom = state.zoom;
      panX = state.panX;
      panY = state.panY;
      showGrid = state.showGrid;
      mode = state.mode;
      currentLineIndex = state.currentLineIndex;
      magnifierZoom = state.magnifierZoom;
      toggleLogXBtn.classList.toggle('log-active', logX);
      toggleLogYBtn.classList.toggle('log-active', logY);
      document.getElementById('magnifier-zoom').value = magnifierZoom;
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
      }
      draw();
      saveState();
    };
    reader.readAsText(file);
  }
});

// Export JSON
exportJsonBtn.addEventListener('click', () => {
  const state = history[historyIndex];
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
      csv += `${line.name},${pt.x},${pt.y}\n`;
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
  logX = false;
  logY = false;
  zoom = 1;
  panX = 0;
  panY = 0;
  showGrid = false;
  mode = 'none';
  highlightPath = [];
  isHighlighting = false;
  isDraggingPoint = false;
  magnifierZoom = 2;
  history = [];
  historyIndex = -1;
  updateLineSelect();
  updatePreview();
  updateButtonStates();
  axisInstruction.textContent = 'Click "Set Axis Points" then enter values.';
  axisInputs.style.display = 'none';
  calibrateBtn.disabled = true;
  addPointBtn.disabled = true;
  adjustPointBtn.disabled = true;
  deletePointBtn.disabled = true;
  highlightLineBtn.disabled = true;
  clearPointsBtn.disabled = true;
  sortPointsBtn.disabled = true;
  newLineBtn.disabled = true;
  renameLineBtn.disabled = true;
  draw();
  saveState();
});

// Undo
undoBtn.addEventListener('click', () => {
  if (historyIndex > 0) {
    historyIndex--;
    const state = history[historyIndex];
    lines = state.lines;
    axisPoints = state.axisPoints;
    scaleX = state.scaleX;
    scaleY = state.scaleY;
    offsetX = state.offsetX;
    offsetY = state.offsetY;
    logX = state.logX;
    logY = state.logY;
    isCalibrated = state.isCalibrated;
    zoom = state.zoom;
    panX = state.panX;
    panY = state.panY;
    showGrid = state.showGrid;
    mode = state.mode;
    currentLineIndex = state.currentLineIndex;
    magnifierZoom = state.magnifierZoom;
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
    }
    draw();
    undoBtn.disabled = historyIndex <= 0;
    redoBtn.disabled = false;
  }
});

// Redo
redoBtn.addEventListener('click', () => {
  if (historyIndex < history.length - 1) {
    historyIndex++;
    const state = history[historyIndex];
    lines = state.lines;
    axisPoints = state.axisPoints;
    scaleX = state.scaleX;
    scaleY = state.scaleY;
    offsetX = state.offsetX;
    offsetY = state.offsetY;
    logX = state.logX;
    logY = state.logY;
    isCalibrated = state.isCalibrated;
    zoom = state.zoom;
    panX = state.panX;
    panY = state.panY;
    showGrid = state.showGrid;
    mode = state.mode;
    currentLineIndex = state.currentLineIndex;
    magnifierZoom = state.magnifierZoom;
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
    }
    draw();
    redoBtn.disabled = historyIndex >= history.length - 1;
    undoBtn.disabled = false;
  }
});

// Canvas events
canvas.addEventListener('mousedown', e => {
  const coords = getCanvasCoords(e);
  if (isPanning) {
    startPan = { x: e.clientX - panX, y: e.clientY - panY };
    return;
  }
  if (mode === 'axes' && axisPoints.length < 4) {
    axisPoints.push(coords);
    axisInstruction.textContent = `Click point for ${axisLabels[axisPoints.length]} on the chart.`;
    axisInputs.style.display = axisPoints.length === 4 ? 'block' : 'none';
    calibrateBtn.disabled = axisPoints.length !== 4;
    draw();
    saveState();
  } else if (mode === 'add' && isCalibrated) {
    lines[currentLineIndex].points.push({ px: coords.x, py: coords.y, x: toRealX(coords.x), y: toRealY(coords.y) });
    updatePreview();
    draw();
    saveState();
  } else if (mode === 'adjust' && isCalibrated) {
    const line = lines[currentLineIndex];
    selectedPointIndex = line.points.findIndex(pt => Math.hypot(pt.px - coords.x, pt.py - coords.y) < 5 / zoom);
    if (selectedPointIndex !== -1) {
      isDraggingPoint = true;
    }
  } else if (mode === 'delete' && isCalibrated) {
    const line = lines[currentLineIndex];
    const index = line.points.findIndex(pt => Math.hypot(pt.px - coords.x, pt.py - coords.y) < 5 / zoom);
    if (index !== -1) {
      line.points.splice(index, 1);
      updatePreview();
      draw();
      saveState();
    }
  } else if (mode === 'highlight' && isCalibrated) {
    isHighlighting = true;
    highlightPath = [coords];
    draw();
  }
});

canvas.addEventListener('mousemove', e => {
  const coords = getCanvasCoords(e);
  statusBar.textContent = `X: ${toRealX(coords.x).toFixed(2)}, Y: ${toRealY(coords.y).toFixed(2)}`;
  if (isPanning && e.buttons === 1) {
    panX = e.clientX - startPan.x;
    panY = e.clientY - startPan.y;
    draw();
  } else if (isDraggingPoint && e.buttons === 1) {
    const line = lines[currentLineIndex];
    line.points[selectedPointIndex] = { px: coords.x, py: coords.y, x: toRealX(coords.x), y: toRealY(coords.y) };
    updatePreview();
    draw();
  } else if (isHighlighting && e.buttons === 1) {
    highlightPath.push(coords);
    draw();
  }
  // Magnifier
  magCtx.clearRect(0, 0, magnifier.width, magnifier.height);
  const magX = e.clientX - magnifier.width / 2;
  const magY = e.clientY - magnifier.height / 2;
  magnifier.style.left = `${magX}px`;
  magnifier.style.top = `${magY}px`;
  magnifier.style.display = 'block';
  const magZoom = magnifierZoom * zoom;
  magCtx.drawImage(img,
    (coords.x - magnifier.width / (2 * magZoom)) * zoom + panX,
    (coords.y - magnifier.height / (2 * magZoom)) * zoom + panY,
    magnifier.width / magZoom, magnifier.height / magZoom,
    0, 0, magnifier.width, magnifier.height);
});

canvas.addEventListener('mouseup', e => {
  if (isPanning) {
    isPanning = false;
    saveState();
  } else if (isDraggingPoint) {
    isDraggingPoint = false;
    selectedPointIndex = -1;
    saveState();
  } else if (isHighlighting) {
    isHighlighting = false;
    if (highlightPath.length > 1) {
      const lineName = highlightLineName.value || `Line ${lines.length + 1}`;
      if (!lines.some(l => l.name === lineName)) {
        const newPoints = [];
        for (let i = 0; i < highlightPath.length - 1; i++) {
          const start = highlightPath[i];
          const end = highlightPath[i + 1];
          const dx = (end.x - start.x) / (parseInt(nPointsInput.value) - 1);
          const dy = (end.y - start.y) / (parseInt(nPointsInput.value) - 1);
          for (let j = 0; j < parseInt(nPointsInput.value); j++) {
            newPoints.push({
              px: start.x + dx * j,
              py: start.y + dy * j,
              x: toRealX(start.x + dx * j),
              y: toRealY(start.y + dy * j)
            });
          }
        }
        lines.push({ name: lineName, points: newPoints });
        currentLineIndex = lines.length - 1;
        updateLineSelect();
        updatePreview();
      }
    }
    highlightPath = [];
    draw();
    saveState();
  }
});

canvas.addEventListener('mouseleave', () => {
  magnifier.style.display = 'none';
  statusBar.textContent = '';
});

document.addEventListener('keydown', e => {
  if (e.key === 'p' && isCalibrated) {
    mode = mode === 'add' ? 'none' : 'add';
    updateButtonStates();
  } else if (e.key === 'h' && isCalibrated) {
    mode = mode === 'highlight' ? 'none' : 'highlight';
    highlightControls.style.display = mode === 'highlight' ? 'block' : 'none';
    updateButtonStates();
  } else if (e.ctrlKey && e.key === 'z') {
    undoBtn.click();
  } else if (e.ctrlKey && e.key === 'y') {
    redoBtn.click();
  }
});

// Load image from base64
document.addEventListener('DOMContentLoaded', () => {
  if (base64Image) {
    img.src = `data:image/png;base64,${base64Image}`;
    img.onload = () => {
      canvas.width = Math.min(img.width, window.innerWidth * 0.8);
      canvas.height = canvas.width * (img.height / img.width);
      draw();
    };
  }
  loadSession();
  // Apply saved theme
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'dark') document.body.classList.add('dark');
});

// Highlight width slider
const highlightWidthSlider = document.getElementById('highlight-width');
highlightWidthSlider.addEventListener('input', e => {
  highlightWidth = parseInt(e.target.value);
  draw();
});
