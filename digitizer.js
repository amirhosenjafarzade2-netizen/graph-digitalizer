/**********************
 * GLOBAL STATE
 **********************/
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const magnifier = document.getElementById('magnifier');
const magCtx = magnifier.getContext('2d');
let img = new Image();
let zoom = initialState.zoom;
let panX = initialState.panX;
let panY = initialState.panY;
let isPanning = false;
let startPan = { x: 0, y: 0 };
let axisPoints = initialState.axisPoints;
let isCalibrated = initialState.isCalibrated;
let scaleX = initialState.scaleX;
let scaleY = initialState.scaleY;
let offsetX = initialState.offsetX;
let offsetY = initialState.offsetY;
let lines = initialState.lines;
let currentLineIndex = initialState.currentLineIndex;
let mode = initialState.mode;
let selectedPointIndex = -1;
let history = initialState.history;
let historyIndex = initialState.historyIndex;
let showGrid = initialState.showGrid;
let logX = initialState.logX;
let logY = initialState.logY;
let highlightPath = [];
let isHighlighting = false;
let isDraggingPoint = false;
let highlightWidth = 2;
let magnifierZoom = initialState.magnifierZoom;
const lineColors = ['blue', 'green', 'red', 'purple', 'orange', 'brown', 'pink', 'gray'];
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
const exportXlsxBtn = document.getElementById('export-xlsx');
const clearSessionBtn = document.getElementById('clear-session');
const totalResetBtn = document.getElementById('total-reset');
const undoBtn = document.getElementById('undo');
const redoBtn = document.getElementById('redo');
const previewTable = document.getElementById('preview-table');
const statusBar = document.getElementById('status-bar');
const hiddenInput = document.createElement('input');
hiddenInput.type = 'hidden';
hiddenInput.id = 'state-update';
document.body.appendChild(hiddenInput);

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
  updateStreamlitState();
}

function updateStreamlitState() {
  const state = {
    lines, axisPoints, scaleX, scaleY, offsetX, offsetY,
    logX, logY, isCalibrated, zoom, panX, panY,
    showGrid, mode, currentLineIndex, magnifierZoom,
    history, historyIndex
  };
  hiddenInput.value = JSON.stringify(state);
  hiddenInput.dispatchEvent(new Event('change'));
}

function isfinite(value) {
  return Number.isFinite(value) && !isNaN(value);
}

function checkCollinearPoints(points) {
  if (points.length < 4) return false;
  const [x1, x2, y1, y2] = points;
  // Check if X1, X2 are collinear (same y) or Y1, Y2 are collinear (same x)
  const xAxisCollinear = Math.abs(x1.y - x2.y) < 0.001;
  const yAxisCollinear = Math.abs(y1.x - y2.x) < 0.001;
  return xAxisCollinear || yAxisCollinear;
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
function downsampleImage(img, maxDimension = 800) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  let width = img.width;
  let height = img.height;
  if (width > maxDimension || height > maxDimension) {
    const ratio = Math.min(maxDimension / width, maxDimension / height);
    width = Math.round(width * ratio);
    height = Math.round(height * ratio);
  }
  canvas.width = width;
  canvas.height = height;
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL();
}

function loadImage(dataUrl) {
  showSpinner(true);
  img.src = '';
  img.src = dataUrl;
  img.onload = () => {
    console.log('Image loaded:', { width: img.width, height: img.height });
    const downsampledUrl = downsampleImage(img);
    img.src = downsampledUrl;
    img.onload = () => {
      canvas.width = Math.min(img.width, window.innerWidth * 0.8);
      canvas.height = canvas.width * (img.height / img.width);
      if (canvas.width === 0 || canvas.height === 0) {
        showModal('Image dimensions are invalid. Please try another image.');
        console.error('Invalid image dimensions');
        showSpinner(false);
        return;
      }
      zoom = 1;
      panX = 0;
      panY = 0;
      draw();
      setAxesBtn.disabled = false;
      resetAxisPointsBtn.disabled = false;
      saveState();
      showSpinner(false);
    };
    img.onerror = () => {
      showModal('Failed to load downsampled image.');
      console.error('Downsampled image load failed');
      showSpinner(false);
    };
  };
  img.onerror = () => {
    showModal('Failed to load image. Please try another image.');
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
    if (logX && x <= offsetX) {
      showModal('X-coordinate out of range for logarithmic scale.');
      return null;
    }
    if (logY && y <= offsetY) {
      showModal('Y-coordinate out of range for logarithmic scale.');
      return null;
    }
    dataX = logX ? Math.pow(10, (x - offsetX) / scaleX) : (x - offsetX) / scaleX;
    dataY = logY ? Math.pow(10, (y - offsetY) / scaleY) : (y - offsetY) / scaleY;
    if (!isfinite(dataX) || !isfinite(dataY)) {
      showModal('Invalid coordinates calculated. Check axis calibration.');
      return null;
    }
    return { dataX, dataY };
  } catch (e) {
    console.error('Error converting to data coords:', e);
    return null;
  }
}

/**********************
 * DRAWING
 **********************/
let drawRequested = false;
function draw() {
  if (drawRequested) return;
  drawRequested = true;
  requestAnimationFrame(() => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(panX, panY);
    ctx.scale(zoom, zoom);
    ctx.drawImage(img, 0, 0, canvas.width / zoom, canvas.height / zoom);

    if (showGrid && isCalibrated) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.lineWidth = 1 / zoom;
      const stepX = canvas.width / zoom / 10;
      const stepY = canvas.height / zoom / 10;
      for (let x = 0; x < canvas.width / zoom; x += stepX) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height / zoom);
        ctx.stroke();
      }
      for (let y = 0; y < canvas.height / zoom; y += stepY) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width / zoom, y);
        ctx.stroke();
      }
    }

    axisPoints.forEach((p, i) => {
      ctx.fillStyle = i < 2 ? 'red' : 'green';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5 / zoom, 0, 2 * Math.PI);
      ctx.fill();
      ctx.fillStyle = 'white';
      ctx.font = `${12 / zoom}px Arial`;
      ctx.fillText(axisLabels[i], p.x + 10 / zoom, p.y);
    });

    lines.forEach((line, i) => {
      ctx.strokeStyle = lineColors[i % lineColors.length];
      ctx.fillStyle = lineColors[i % lineColors.length];
      ctx.lineWidth = 2 / zoom;
      ctx.beginPath();
      line.points.forEach((p, j) => {
        if (j === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
      line.points.forEach((p, j) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3 / zoom, 0, 2 * Math.PI);
        ctx.fill();
      });
    });

    if (highlightPath.length > 0) {
      ctx.strokeStyle = 'yellow';
      ctx.lineWidth = highlightWidth / zoom;
      ctx.beginPath();
      highlightPath.forEach((p, i) => {
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
    }

    ctx.restore();
    drawRequested = false;
  });
}

/**********************
 * UI UPDATES
 **********************/
function updateLineSelect() {
  lineSelect.innerHTML = '';
  lines.forEach((line, i) => {
    const option = document.createElement('option');
    option.value = i;
    option.textContent = line.name;
    lineSelect.appendChild(option);
  });
  lineSelect.value = currentLineIndex;
}

function updatePreview() {
  previewTable.innerHTML = '';
  if (lines.every(line => line.points.length === 0)) {
    previewTable.innerHTML = '<tr><td>No data</td></tr>';
    return;
  }
  lines.forEach(line => {
    if (line.points.length === 0) return;
    const nameRow = document.createElement('tr');
    nameRow.innerHTML = `<td colspan="2"><strong>${line.name}</strong></td>`;
    previewTable.appendChild(nameRow);
    const headerRow = document.createElement('tr');
    headerRow.innerHTML = '<td>X</td><td>Y</td>';
    previewTable.appendChild(headerRow);
    line.points.forEach(p => {
      const row = document.createElement('tr');
      const dataX = isfinite(p.dataX) ? p.dataX.toFixed(15) : 'NaN';
      const dataY = isfinite(p.dataY) ? p.dataY.toFixed(15) : 'NaN';
      row.innerHTML = `<td>${dataX}</td><td>${dataY}</td>`;
      previewTable.appendChild(row);
    });
  });
}

function findNearestPointIndex(x, y) {
  let minDist = Infinity, closestIndex = -1;
  lines[currentLineIndex].points.forEach((p, i) => {
    const dist = Math.hypot(p.x - x, p.y - y);
    if (dist < minDist && dist < 10 / zoom) {
      minDist = dist;
      closestIndex = i;
    }
  });
  return closestIndex;
}

function updateButtonStates() {
  setAxesBtn.classList.toggle('active', mode === 'axes');
  addPointBtn.classList.toggle('active', mode === 'add');
  adjustPointBtn.classList.toggle('active', mode === 'adjust');
  deletePointBtn.classList.toggle('active', mode === 'delete');
  highlightLineBtn.classList.toggle('active', mode === 'highlight');
  toggleLogXBtn.classList.toggle('log-active', logX);
  toggleLogYBtn.classList.toggle('log-active', logY);
  calibrateBtn.disabled = axisPoints.length !== 4;
  addPointBtn.disabled = !isCalibrated;
  adjustPointBtn.disabled = !isCalibrated;
  deletePointBtn.disabled = !isCalibrated;
  highlightLineBtn.disabled = !isCalibrated;
  clearPointsBtn.disabled = !isCalibrated;
  sortPointsBtn.disabled = !isCalibrated;
  newLineBtn.disabled = !isCalibrated;
  renameLineBtn.disabled = !isCalibrated;
}

/**********************
 * CATMULL-ROM SPLINE
 **********************/
function getCatmullRomPoint(t, p0, p1, p2, p3, tension = 0.5) {
  const t2 = t * t;
  const t3 = t2 * t;
  const v0 = (p2.x - p0.x) * tension;
  const v1 = (p3.x - p1.x) * tension;
  const x = (2 * p1.x - 2 * p0.x + v0 + v1) * t3 + (-3 * p1.x + 3 * p0.x - 2 * v0 - v1) * t2 + v0 * t + p0.x;
  const v0y = (p2.y - p0.y) * tension;
  const v1y = (p3.y - p1.y) * tension;
  const y = (2 * p1.y - 2 * p0.y + v0y + v1y) * t3 + (-3 * p1.y + 3 * p0.y - 2 * v0y - v1y) * t2 + v0y * t + p0.y;
  return { x, y };
}

function interpolatePoints(path, n) {
  if (path.length < 2) return path;
  const result = [];
  const totalLength = path.reduce((sum, p, i) => {
    if (i === 0) return 0;
    const dx = p.x - path[i-1].x;
    const dy = p.y - path[i-1].y;
    return sum + Math.sqrt(dx*dx + dy*dy);
  }, 0);
  if (totalLength === 0) return [path[0]];
  const segmentLength = totalLength / (n - 1);
  let accumulatedLength = 0;
  result.push(path[0]);
  for (let i = 1; i < path.length; i++) {
    const dx = path[i].x - path[i-1].x;
    const dy = path[i].y - path[i-1].y;
    const segment = Math.sqrt(dx*dx + dy*dy);
    accumulatedLength += segment;
    while (result.length < n && accumulatedLength >= segmentLength * result.length) {
      const t = (segmentLength * result.length - (accumulatedLength - segment)) / segment;
      result.push({
        x: path[i-1].x + t * dx,
        y: path[i-1].y + t * dy
      });
    }
  }
  return result.slice(0, n);
}

/**********************
 * EVENT LISTENERS
 **********************/
canvas.addEventListener('mousedown', e => {
  const { x, y } = imageToCanvasCoords(e.clientX, e.clientY);
  if (mode === 'axes') {
    axisPoints.push({ x, y });
    axisInstruction.textContent = axisPoints.length < 4 ? `Click point for ${axisLabels[axisPoints.length]} on the chart.` : 'Enter axis values and click Calibrate.';
    axisInputs.style.display = axisPoints.length > 0 ? 'block' : 'none';
    if (axisPoints.length === 4 && checkCollinearPoints(axisPoints)) {
      showModal('Axis points are collinear. Please select distinct points.');
      axisPoints = [];
      axisInstruction.textContent = 'Click point for X1 on the chart.';
      axisInputs.style.display = 'none';
    }
    draw();
    saveState();
  } else if (mode === 'add' && isCalibrated) {
    const coords = canvasToDataCoords(x, y);
    if (coords) {
      lines[currentLineIndex].points.push({ x, y, dataX: coords.dataX, dataY: coords.dataY });
      updatePreview();
      draw();
      saveState();
    }
  } else if (mode === 'adjust' && isCalibrated) {
    selectedPointIndex = findNearestPointIndex(x, y);
    if (selectedPointIndex >= 0) isDraggingPoint = true;
  } else if (mode === 'delete' && isCalibrated) {
    const index = findNearestPointIndex(x, y);
    if (index >= 0) {
      lines[currentLineIndex].points.splice(index, 1);
      updatePreview();
      draw();
      saveState();
    }
  } else if (mode === 'highlight' && isCalibrated) {
    highlightPath = [{ x, y }];
    isHighlighting = true;
    draw();
  } else if (mode === 'pan') {
    isPanning = true;
    startPan = { x: e.clientX, y: e.clientY };
  }
});

canvas.addEventListener('mousemove', e => {
  const { x, y } = imageToCanvasCoords(e.clientX, e.clientY);
  const coords = canvasToDataCoords(x, y);
  statusBar.textContent = coords ? `X: ${coords.dataX.toFixed(2)}, Y: ${coords.dataY.toFixed(2)}` : 'No coordinates';
  
  if (isDraggingPoint && selectedPointIndex >= 0) {
    lines[currentLineIndex].points[selectedPointIndex].x = x;
    lines[currentLineIndex].points[selectedPointIndex].y = y;
    const newCoords = canvasToDataCoords(x, y);
    if (newCoords) {
      lines[currentLineIndex].points[selectedPointIndex].dataX = newCoords.dataX;
      lines[currentLineIndex].points[selectedPointIndex].dataY = newCoords.dataY;
    }
    updatePreview();
    draw();
  } else if (isHighlighting) {
    highlightPath.push({ x, y });
    draw();
  } else if (isPanning) {
    panX += e.clientX - startPan.x;
    panY += e.clientY - startPan.y;
    startPan = { x: e.clientX, y: e.clientY };
    draw();
    saveState();
  }

  if (mode !== 'pan' && isCalibrated) {
    magnifier.style.display = 'block';
    magnifier.style.left = `${e.clientX + 10}px`;
    magnifier.style.top = `${e.clientY + 10}px`;
    magCtx.clearRect(0, 0, magnifier.width, magnifier.height);
    magCtx.drawImage(
      canvas,
      e.clientX - rect.left - 50 / magnifierZoom,
      e.clientY - rect.top - 50 / magnifierZoom,
      100 / magnifierZoom,
      100 / magnifierZoom,
      0, 0, 100, 100
    );
  } else {
    magnifier.style.display = 'none';
  }
});

canvas.addEventListener('mouseup', () => {
  if (isDraggingPoint) {
    isDraggingPoint = false;
    selectedPointIndex = -1;
    saveState();
  }
  if (isHighlighting) {
    isHighlighting = false;
    const n = parseInt(nPointsInput.value) || 5;
    const interpolated = interpolatePoints(highlightPath, n);
    const name = highlightLineName.value || `Line ${lines.length + 1}`;
    lines.push({
      name,
      points: interpolated.map(p => {
        const coords = canvasToDataCoords(p.x, p.y);
        return coords ? { x: p.x, y: p.y, dataX: coords.dataX, dataY: coords.dataY } : null;
      }).filter(p => p)
    });
    currentLineIndex = lines.length - 1;
    highlightPath = [];
    updateLineSelect();
    updatePreview();
    draw();
    saveState();
  }
  if (isPanning) {
    isPanning = false;
  }
});

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const delta = e.deltaY < 0 ? 1.1 : 0.9;
  zoom *= delta;
  zoom = Math.max(0.1, Math.min(zoom, 10));
  draw();
  saveState();
});

/**********************
 * BUTTON LISTENERS
 **********************/
zoomInBtn.addEventListener('click', () => {
  zoom *= 1.1;
  zoom = Math.min(zoom, 10);
  draw();
  saveState();
});

zoomOutBtn.addEventListener('click', () => {
  zoom *= 0.9;
  zoom = Math.max(zoom, 0.1);
  draw();
  saveState();
});

resetViewBtn.addEventListener('click', () => {
  zoom = 1;
  panX = 0;
  panY = 0;
  draw();
  saveState();
});

panModeBtn.addEventListener('click', () => {
  mode = mode === 'pan' ? 'none' : 'pan';
  updateButtonStates();
  draw();
});

toggleThemeBtn.addEventListener('click', () => {
  document.body.classList.toggle('dark');
});

setAxesBtn.addEventListener('click', () => {
  mode = mode === 'axes' ? 'none' : 'axes';
  axisPoints = [];
  axisInstruction.textContent = 'Click point for X1 on the chart.';
  axisInputs.style.display = 'none';
  updateButtonStates();
  draw();
  saveState();
});

resetAxisPointsBtn.addEventListener('click', () => {
  axisPoints = [];
  axisInstruction.textContent = 'Click point for X1 on the chart.';
  axisInputs.style.display = 'none';
  updateButtonStates();
  draw();
  saveState();
});

calibrateBtn.addEventListener('click', () => {
  const x1Val = parseFloat(document.getElementById('x1-value').value);
  const x2Val = parseFloat(document.getElementById('x2-value').value);
  const y1Val = parseFloat(document.getElementById('y1-value').value);
  const y2Val = parseFloat(document.getElementById('y2-value').value);
  if (!isfinite(x1Val) || !isfinite(x2Val) || !isfinite(y1Val) || !isfinite(y2Val)) {
    showModal('All axis values must be valid numbers.');
    return;
  }
  if (logX && (x1Val <= 0 || x2Val <= 0)) {
    showModal('X-axis values must be positive for logarithmic scale.');
    return;
  }
  if (logY && (y1Val <= 0 || y2Val <= 0)) {
    showModal('Y-axis values must be positive for logarithmic scale.');
    return;
  }
  if (x1Val === x2Val || y1Val === y2Val) {
    showModal('Axis values must be distinct.');
    return;
  }
  scaleX = (x2Val - x1Val) / (axisPoints[1].x - axisPoints[0].x);
  scaleY = (y2Val - y1Val) / (axisPoints[3].y - axisPoints[2].y);
  offsetX = axisPoints[0].x - x1Val / scaleX;
  offsetY = axisPoints[2].y - y1Val / scaleY;
  if (orthogonalAxes.checked) {
    const dx = axisPoints[1].x - axisPoints[0].x;
    const dy = axisPoints[1].y - axisPoints[0].y;
    axisPoints[3].x = axisPoints[2].x - dy * (y2Val - y1Val) / (x2Val - x1Val);
    axisPoints[3].y = axisPoints[2].y + dx * (y2Val - y1Val) / (x2Val - x1Val);
  }
  isCalibrated = true;
  axisInputs.style.display = 'none';
  axisInstruction.textContent = 'Calibration complete. Select a mode to digitize.';
  updateButtonStates();
  draw();
  saveState();
});

resetCalibrationBtn.addEventListener('click', () => {
  isCalibrated = false;
  axisPoints = [];
  scaleX = null;
  scaleY = null;
  offsetX = null;
  offsetY = null;
  axisInstruction.textContent = 'Click point for X1 on the chart.';
  axisInputs.style.display = 'none';
  updateButtonStates();
  draw();
  saveState();
});

toggleGridBtn.addEventListener('click', () => {
  showGrid = !showGrid;
  draw();
  saveState();
});

toggleLogXBtn.addEventListener('click', () => {
  if (isCalibrated && axisPoints.length === 4) {
    const x1Val = parseFloat(document.getElementById('x1-value').value);
    const x2Val = parseFloat(document.getElementById('x2-value').value);
    if (x1Val <= 0 || x2Val <= 0) {
      showModal('X-axis values must be positive for logarithmic scale.');
      return;
    }
  }
  logX = !logX;
  updateButtonStates();
  draw();
  saveState();
});

toggleLogYBtn.addEventListener('click', () => {
  if (isCalibrated && axisPoints.length === 4) {
    const y1Val = parseFloat(document.getElementById('y1-value').value);
    const y2Val = parseFloat(document.getElementById('y2-value').value);
    if (y1Val <= 0 || y2Val <= 0) {
      showModal('Y-axis values must be positive for logarithmic scale.');
      return;
    }
  }
  logY = !logY;
  updateButtonStates();
  draw();
  saveState();
});

addPointBtn.addEventListener('click', () => {
  mode = mode === 'add' ? 'none' : 'add';
  updateButtonStates();
  draw();
});

adjustPointBtn.addEventListener('click', () => {
  mode = mode === 'adjust' ? 'none' : 'adjust';
  updateButtonStates();
  draw();
});

deletePointBtn.addEventListener('click', () => {
  mode = mode === 'delete' ? 'none' : 'delete';
  updateButtonStates();
  draw();
});

highlightLineBtn.addEventListener('click', () => {
  mode = mode === 'highlight' ? 'none' : 'highlight';
  highlightControls.style.display = mode === 'highlight' ? 'block' : 'none';
  updateButtonStates();
  draw();
});

deleteHighlightBtn.addEventListener('click', () => {
  highlightPath = [];
  draw();
  saveState();
});

clearPointsBtn.addEventListener('click', () => {
  lines[currentLineIndex].points = [];
  updatePreview();
  draw();
  saveState();
});

sortPointsBtn.addEventListener('click', () => {
  lines[currentLineIndex].points.sort((a, b) => a.dataX - b.dataX);
  updatePreview();
  draw();
  saveState();
});

newLineBtn.addEventListener('click', () => {
  showModal('Enter new line name:', true, name => {
    if (!name) {
      showModal('Line name cannot be empty.');
      return;
    }
    if (lines.some(line => line.name === name)) {
      showModal('Line name must be unique.');
      return;
    }
    lines.push({ name, points: [] });
    currentLineIndex = lines.length - 1;
    updateLineSelect();
    updatePreview();
    draw();
    saveState();
  });
});

renameLineBtn.addEventListener('click', () => {
  showModal('Enter new name:', true, name => {
    if (!name) {
      showModal('Line name cannot be empty.');
      return;
    }
    if (lines.some((line, i) => i !== currentLineIndex && line.name === name)) {
      showModal('Line name must be unique.');
      return;
    }
    lines[currentLineIndex].name = name;
    updateLineSelect();
    updatePreview();
    draw();
    saveState();
  });
});

lineSelect.addEventListener('change', () => {
  currentLineIndex = parseInt(lineSelect.value);
  updatePreview();
  draw();
  saveState();
});

exportXlsxBtn.addEventListener('click', () => {
  try {
    const workbook = XLSX.utils.book_new();
    lines.forEach(line => {
      if (line.points.length === 0) return;
      const data = line.points.map(p => {
        const dataX = isfinite(p.dataX) ? Number(p.dataX.toFixed(15)) : 'NaN';
        const dataY = isfinite(p.dataY) ? Number(p.dataY.toFixed(15)) : 'NaN';
        return [dataX, dataY];
      });
      data.unshift(['X', 'Y']);
      const worksheet = XLSX.utils.aoa_to_sheet(data);
      const safeName = line.name.substring(0, 31).replace(/[\\[\]*/?:]/g, '_');
      XLSX.utils.book_append_sheet(workbook, worksheet, safeName);
    });
    if (workbook.SheetNames.length === 0) {
      showModal('No data to export.');
      return;
    }
    XLSX.writeFile(workbook, 'graph.xlsx');
  } catch (e) {
    showModal('Failed to export XLSX. Please try again.');
    console.error('XLSX export error:', e);
  }
});

totalResetBtn.addEventListener('click', () => {
  lines = [{ name: 'Line 1', points: [] }];
  axisPoints = [];
  isCalibrated = false;
  scaleX = null;
  scaleY = null;
  offsetX = null;
  offsetY = null;
  logX = false;
  logY = false;
  zoom = 1;
  panX = 0;
  panY = 0;
  showGrid = false;
  mode = 'none';
  currentLineIndex = 0;
  magnifierZoom = 2;
  history = [];
  historyIndex = -1;
  updateLineSelect();
  updatePreview();
  updateButtonStates();
  axisInstruction.textContent = 'Click point for X1 on the chart.';
  axisInputs.style.display = 'none';
  draw();
  saveState();
});

undoBtn.addEventListener('click', () => {
  if (historyIndex > 0) {
    historyIndex--;
    const state = history[historyIndex];
    lines = JSON.parse(JSON.stringify(state.lines));
    axisPoints = JSON.parse(JSON.stringify(state.axisPoints));
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
    updateLineSelect();
    updatePreview();
    updateButtonStates();
    axisInstruction.textContent = isCalibrated ? 'Calibration complete. Select a mode to digitize.' : axisPoints.length < 4 ? `Click point for ${axisLabels[axisPoints.length]} on the chart.` : 'Enter axis values and click Calibrate.';
    axisInputs.style.display = isCalibrated ? 'none' : axisPoints.length > 0 ? 'block' : 'none';
    draw();
    saveState();
  }
});

redoBtn.addEventListener('click', () => {
  if (historyIndex < history.length - 1) {
    historyIndex++;
    const state = history[historyIndex];
    lines = JSON.parse(JSON.stringify(state.lines));
    axisPoints = JSON.parse(JSON.stringify(state.axisPoints));
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
    updateLineSelect();
    updatePreview();
    updateButtonStates();
    axisInstruction.textContent = isCalibrated ? 'Calibration complete. Select a mode to digitize.' : axisPoints.length < 4 ? `Click point for ${axisLabels[axisPoints.length]} on the chart.` : 'Enter axis values and click Calibrate.';
    axisInputs.style.display = isCalibrated ? 'none' : axisPoints.length > 0 ? 'block' : 'none';
    draw();
    saveState();
  }
});

/**********************
 * MAGNIFIER ZOOM
 **********************/
document.getElementById('magnifier-zoom').addEventListener('input', (e) => {
  magnifierZoom = parseFloat(e.target.value);
  draw();
  saveState();
});

document.getElementById('highlight-width').addEventListener('input', (e) => {
  highlightWidth = parseInt(e.target.value);
  draw();
});

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

if (initialState.image_data) {
  loadImage(initialState.image_data);
}
updateLineSelect();
updatePreview();
updateButtonStates();
draw();
