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
const exportImageBtn = document.getElementById('export-image');
const clearSessionBtn = document.getElementById('clear-session');
const totalResetBtn = document.getElementById('total-reset');
const undoBtn = document.getElementById('undo');
const redoBtn = document.getElementById('redo');
const pointList = document.getElementById('point-list');
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
    zoom, panX, panY, showGrid, mode, currentLineIndex
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
      updateLineSelect();
      updatePointList();
      updatePreview();
      updateButtonStates();
      toggleLogXBtn.classList.toggle('log-active', logX);
      toggleLogYBtn.classList.toggle('log-active', logY);
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
    zoom, panX, panY, showGrid, mode, currentLineIndex
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
    // Trigger redraw to ensure canvas updates
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

function updatePointList() {
  pointList.innerHTML = '';
  if (lines[currentLineIndex].points.length === 0) {
    pointList.textContent = 'No points';
    return;
  }
  lines[currentLineIndex].points.forEach((p, i) => {
    const div = document.createElement('div');
    div.className = 'point-item';
    const dataX = isNaN(p.dataX) || !isFinite(p.dataX) ? 'NaN' : p.dataX.toFixed(6);
    const dataY = isNaN(p.dataY) || !isFinite(p.dataY) ? 'NaN' : p.dataY.toFixed(6);
    div.textContent = `Point ${i + 1}: (${dataX}, ${dataY})`;
    const selectBtn = document.createElement('button');
    selectBtn.textContent = 'Select';
    selectBtn.onclick = () => {
      selectedPointIndex = i;
      draw();
    };
    div.appendChild(selectBtn);
    pointList.appendChild(div);
  });
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
      const dataX = isNaN(p.dataX) || !isFinite(p.dataX) ? 'NaN' : p.dataX.toFixed(6);
      const dataY = isNaN(p.dataY) || !isFinite(p.dataY) ? 'NaN' : p.dataY.toFixed(6);
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

/**********************
 * DRAWING LOOP
 **********************/
const draw = debounce(() => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(panX, panY);
  ctx.scale(zoom, zoom);

  // Draw image only if loaded
  if (img.src && img.complete && img.naturalWidth > 0) {
    try {
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    } catch (e) {
      console.error('Failed to draw image:', e);
      showModal('Error drawing image on canvas. Please try another image or browser.');
    }
  } else {
    ctx.fillStyle = '#333';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.font = '16px Arial';
    ctx.fillText(img.src ? 'Loading image...' : 'No image loaded. Please upload an image.', 10, 20);
  }

  // Draw grid
  if (isCalibrated && showGrid) {
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.lineWidth = 1 / zoom;
    const xMin = logX ? Math.pow(10, (axisPoints[0].x - offsetX) / scaleX) : (axisPoints[0].x - offsetX) / scaleX;
    const xMax = logX ? Math.pow(10, (axisPoints[1].x - offsetX) / scaleX) : (axisPoints[1].x - offsetX) / scaleX;
    const yMin = logY ? Math.pow(10, (axisPoints[2].y - offsetY) / scaleY) : (axisPoints[2].y - offsetY) / scaleY;
    const yMax = logY ? Math.pow(10, (axisPoints[3].y - offsetY) / scaleY) : (axisPoints[3].y - offsetY) / scaleY;
    const xStep = (xMax - xMin) / 10;
    const yStep = (yMax - yMin) / 10;
    for (let x = xMin; x <= xMax; x += xStep) {
      const px = logX ? Math.log10(x) * scaleX + offsetX : x * scaleX + offsetX;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, canvas.height);
      ctx.stroke();
    }
    for (let y = yMin; y <= yMax; y += yStep) {
      const py = logY ? Math.log10(y) * scaleY + offsetY : y * scaleY + offsetY;
      ctx.beginPath();
      ctx.moveTo(0, py);
      ctx.lineTo(canvas.width, py);
      ctx.stroke();
    }
  }

  // Draw axis points
  ctx.fillStyle = 'red';
  ctx.font = `${12 / zoom}px Arial`;
  axisPoints.forEach((p, i) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5 / zoom, 0, 2 * Math.PI);
    ctx.fill();
    ctx.fillText(axisLabels[i], p.x + 8 / zoom, p.y - 8 / zoom);
  });

  // Draw points
  lines.forEach((line, lineIdx) => {
    ctx.fillStyle = lineColors[lineIdx % lineColors.length];
    line.points.forEach((p, i) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3 / zoom, 0, 2 * Math.PI);
      if (lineIdx === currentLineIndex && i === selectedPointIndex) {
        ctx.strokeStyle = 'yellow';
        ctx.lineWidth = 2 / zoom;
        ctx.stroke();
      }
      ctx.fill();
    });
  });

  // Draw highlight path with smoothing
  if (highlightPath.length > 1) {
    ctx.strokeStyle = 'yellow';
    ctx.lineWidth = highlightWidth / zoom;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(highlightPath[0].x, highlightPath[0].y);
    for (let i = 1; i < highlightPath.length - 2; i++) {
      const xc = (highlightPath[i].x + highlightPath[i + 1].x) / 2;
      const yc = (highlightPath[i].y + highlightPath[i + 1].y) / 2;
      ctx.quadraticCurveTo(highlightPath[i].x, highlightPath[i].y, xc, yc);
    }
    if (highlightPath.length > 2) {
      ctx.quadraticCurveTo(highlightPath[highlightPath.length - 2].x, highlightPath[highlightPath.length - 2].y, highlightPath[highlightPath.length - 1].x, highlightPath[highlightPath.length - 1].y);
    } else if (highlightPath.length === 2) {
      ctx.lineTo(highlightPath[1].x, highlightPath[1].y);
    }
    ctx.stroke();
  }

  ctx.restore();
}, 16);

// Listen for imageLoaded event to trigger redraw
document.addEventListener('imageLoaded', () => {
  console.log('imageLoaded event triggered');
  draw();
});

/**********************
 * EVENT HANDLERS
 **********************/
canvas.addEventListener('mousemove', e => {
  let { x, y } = imageToCanvasCoords(e.clientX, e.clientY);
  let dataCoords = isCalibrated ? canvasToDataCoords(x, y) : null;
  let dataX = dataCoords ? dataCoords.dataX : x;
  let dataY = dataCoords ? dataCoords.dataY : y;
  statusBar.textContent = `Mode: ${mode} | Canvas Coords: (${x.toFixed(2)}, ${y.toFixed(2)}) | Data Coords: (${dataX.toFixed(2)}, ${dataY.toFixed(2)})`;

  if (mode === 'axes' && orthogonalAxes.checked) {
    if (axisPoints.length === 1) { // Snapping X2 to X1's y-coordinate
      y = axisPoints[0].y;
    } else if (axisPoints.length === 3) { // Snapping Y2 to Y1's x-coordinate
      x = axisPoints[2].x;
    }
  }

  if (mode === 'axes' || mode === 'highlight' || mode === 'add' || mode === 'adjust' || mode === 'delete') {
    magnifier.style.display = 'block';
    magnifier.style.left = `${e.clientX + 10}px`;
    magnifier.style.top = `${e.clientY + 10}px`;
    magCtx.clearRect(0, 0, magnifier.width, magnifier.height);
    magCtx.drawImage(
      canvas,
      x - 25,
      y - 25,
      50,
      50,
      0, 0, 100, 100
    );
    magCtx.beginPath();
    magCtx.moveTo(50, 0);
    magCtx.lineTo(50, 100);
    magCtx.moveTo(0, 50);
    magCtx.lineTo(100, 50);
    magCtx.strokeStyle = 'red';
    magCtx.stroke();
  }

  if (isDraggingPoint && mode === 'adjust') {
    let dataCoords = canvasToDataCoords(x, y);
    if (!dataCoords) return;
    const { dataX, dataY } = dataCoords;
    lines[currentLineIndex].points[selectedPointIndex] = { x, y, dataX, dataY };
    console.log(`Adjusting point ${selectedPointIndex}: x=${x.toFixed(2)}, y=${y.toFixed(2)}, dataX=${dataX.toFixed(15)}, dataY=${dataY.toFixed(15)}`);
    updatePointList();
    updatePreview();
    draw();
  }

  if (isHighlighting && mode === 'highlight') {
    highlightPath.push({ x, y });
    draw();
  }
});

canvas.addEventListener('mouseleave', () => {
  magnifier.style.display = 'none';
  statusBar.textContent = `Mode: ${mode}`;
});

imageUpload.addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) {
    showModal('No file selected. Please choose an image.');
    console.error('No file selected for image upload');
    return;
  }

  const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/bmp'];
  if (!validTypes.includes(file.type)) {
    showModal('Invalid file type. Please upload a PNG, JPEG, GIF, or BMP image.');
    console.error('Invalid file type:', file.type);
    return;
  }

  const reader = new FileReader();
  reader.onload = ev => {
    console.log('HTML input image read:', file.name);
    loadImage(ev.target.result);
  };
  reader.onerror = () => {
    showModal('Error reading file. Please try another image.');
    console.error('FileReader error for file:', file.name);
    showSpinner(false);
  };
  reader.readAsDataURL(file);
});

document.getElementById('zoom-in').onclick = () => { zoom *= 1.2; draw(); saveSession(); };
document.getElementById('zoom-out').onclick = () => { zoom /= 1.2; draw(); saveSession(); };
document.getElementById('reset-view').onclick = () => { zoom = 1; panX = 0; panY = 0; draw(); saveSession(); };
document.getElementById('pan-mode').onclick = () => {
  isPanning = !isPanning;
  canvas.style.cursor = isPanning ? 'move' : mode === 'highlight' ? 'crosshair' : 'default';
  saveSession();
};

canvas.addEventListener('mousedown', e => {
  if (isPanning && e.buttons === 1) {
    startPan.x = e.clientX - panX;
    startPan.y = e.clientY - panY;
    return;
  }

  if (e.button === 0 && mode === 'axes' && axisPoints.length < 4) {
    let { x, y } = imageToCanvasCoords(e.clientX, e.clientY);
    if (orthogonalAxes.checked) {
      if (axisPoints.length === 1) { // Snap X2 to X1's y
        y = axisPoints[0].y;
      } else if (axisPoints.length === 3) { // Snap Y2 to Y1's x
        x = axisPoints[2].x;
      }
    }
    axisPoints.push({ x, y });
    axisInstruction.textContent = axisPoints.length < 4
      ? `Click point for ${axisLabels[axisPoints.length]} on the chart.`
      : 'Enter axis values and click Calibrate.';
    calibrateBtn.disabled = axisPoints.length !== 4;
    draw();
    saveState();
    saveSession();
  } else if (e.button === 0 && mode === 'add' && isCalibrated) {
    const { x, y } = imageToCanvasCoords(e.clientX, e.clientY);
    let dataCoords = canvasToDataCoords(x, y);
    if (!dataCoords) {
      showModal('Invalid point coordinates. Try again.');
      return;
    }
    const { dataX, dataY } = dataCoords;
    console.log(`Adding point: x=${x.toFixed(2)}, y=${y.toFixed(2)}, dataX=${dataX.toFixed(15)}, dataY=${dataY.toFixed(15)}`);
    lines[currentLineIndex].points.push({ x, y, dataX, dataY });
    updatePointList();
    updatePreview();
    draw();
    saveState();
    saveSession();
  } else if (e.button === 0 && mode === 'delete' && isCalibrated) {
    const { x, y } = imageToCanvasCoords(e.clientX, e.clientY);
    const index = findNearestPointIndex(x, y);
    if (index !== -1) {
      lines[currentLineIndex].points.splice(index, 1);
      updatePointList();
      updatePreview();
      draw();
      saveState();
      saveSession();
    }
  } else if (e.button === 0 && mode === 'adjust' && isCalibrated) {
    const { x, y } = imageToCanvasCoords(e.clientX, e.clientY);
    selectedPointIndex = findNearestPointIndex(x, y);
    if (selectedPointIndex !== -1) {
      isDraggingPoint = true;
    }
  } else if (e.button === 0 && mode === 'highlight' && isCalibrated && !isHighlighting) {
    const { x, y } = imageToCanvasCoords(e.clientX, e.clientY);
    isHighlighting = true;
    highlightPath = [{ x, y }];
    draw();
  }
});

canvas.addEventListener('mouseup', e => {
  if (e.button === 0 && mode === 'adjust' && isDraggingPoint) {
    isDraggingPoint = false;
    selectedPointIndex = -1;
    saveState();
    saveSession();
  } else if (e.button === 0 && mode === 'highlight' && isHighlighting) {
    isHighlighting = false;
    if (highlightPath.length < 2) {
      showModal('Highlight path is too short to save.');
      highlightPath = [];
      draw();
      return;
    }
    const n = parseInt(nPointsInput.value);
    if (n <= 0) {
      showModal('Number of points (n) must be greater than 0');
      highlightPath = [];
      draw();
      return;
    }
    let lineName = highlightLineName.value.trim() || `Highlighted Line ${lines.length + 1}`;
    if (lines.some(line => line.name === lineName)) {
      let suffix = 1;
      while (lines.some(line => line.name === `${lineName} (${suffix})`)) {
        suffix++;
      }
      lineName = `${lineName} (${suffix})`;
    }
    lines.push({ name: lineName, points: [] });
    currentLineIndex = lines.length - 1;
    const spacedPoints = interpolatePoints(highlightPath, n);
    spacedPoints.forEach(p => {
      let dataCoords = canvasToDataCoords(p.x, p.y);
      if (!dataCoords) return;
      const { dataX, dataY } = dataCoords;
      console.log(`Adding highlight point: x=${p.x.toFixed(2)}, y=${p.y.toFixed(2)}, dataX=${dataX.toFixed(15)}, dataY=${dataY.toFixed(15)}`);
      lines[currentLineIndex].points.push({ x: p.x, y: p.y, dataX, dataY });
    });
    highlightPath = [];
    updateLineSelect();
    updatePointList();
    updatePreview();
    draw();
    saveState();
    saveSession();
  }
});

document.getElementById('toggle-theme').onclick = () => {
  document.body.classList.toggle('dark');
  localStorage.setItem('theme', document.body.classList.contains('dark') ? 'dark' : 'light');
};

/**********************
 * KEYBOARD SHORTCUTS
 **********************/
document.addEventListener('keydown', e => {
  if (e.ctrlKey && e.key === 'z') { undoBtn.click(); e.preventDefault(); }
  if (e.ctrlKey && e.key === 'y') { redoBtn.click(); e.preventDefault(); }
  if (e.key === '+') { zoom *= 1.2; draw(); saveSession(); }
  if (e.key === '-') { zoom /= 1.2; draw(); saveSession(); }
  if (e.key === '0') { zoom = 1; panX = 0; panY = 0; draw(); saveSession(); }
  if (e.key === 'p' && isCalibrated) { addPointBtn.click(); }
  if (e.key === 'h' && isCalibrated) { highlightLineBtn.click(); }
});

/**********************
 * CALIBRATION
 **********************/
setAxesBtn.addEventListener('click', () => {
  axisPoints = [];
  mode = 'axes';
  axisInputs.style.display = 'block';
  axisInstruction.textContent = `Click point for ${axisLabels[axisPoints.length]} on the chart.`;
  updateButtonStates();
  draw();
});

resetAxisPointsBtn.addEventListener('click', () => {
  axisPoints = [];
  mode = 'axes';
  axisInputs.style.display = 'block';
  axisInstruction.textContent = `Click point for ${axisLabels[axisPoints.length]} on the chart.`;
  calibrateBtn.disabled = true;
  draw();
  saveState();
  saveSession();
});

resetCalibrationBtn.addEventListener('click', () => {
  axisPoints = [];
  isCalibrated = false;
  logX = false;
  logY = false;
  toggleLogXBtn.classList.remove('log-active');
  toggleLogYBtn.classList.remove('log-active');
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
  draw();
  saveState();
  saveSession();
});

calibrateBtn.addEventListener('click', () => {
  const x1Val = parseFloat(document.getElementById('x1-value').value);
  const x2Val = parseFloat(document.getElementById('x2-value').value);
  const y1Val = parseFloat(document.getElementById('y1-value').value);
  const y2Val = parseFloat(document.getElementById('y2-value').value);

  if (isNaN(x1Val) || isNaN(x2Val) || isNaN(y1Val) || isNaN(y2Val)) {
    showModal('Please enter valid axis values');
    return;
  }
  if (x1Val === x2Val || y1Val === y2Val) {
    showModal('Axis values must be different');
    return;
  }
  if (axisPoints.length !== 4) {
    showModal('Please set all four axis points (X1, X2, Y1, Y2)');
    return;
  }
  if (Math.abs(axisPoints[1].x - axisPoints[0].x) < 1e-6 || Math.abs(axisPoints[3].y - axisPoints[2].y) < 1e-6) {
    showModal('Axis points must have distinct x/y coordinates (too close)');
    return;
  }
  if (logX && (x1Val <= 0 || x2Val <= 0)) {
    showModal('Logarithmic X-axis requires positive values for X1 and X2');
    return;
  }
  if (logY && (y1Val <= 0 || y2Val <= 0)) {
    showModal('Logarithmic Y-axis requires positive values for Y1 and Y2');
    return;
  }

  // Fixed scale and offset calculations
  const x1Pix = axisPoints[0].x, x2Pix = axisPoints[1].x;
  const y1Pix = axisPoints[2].y, y2Pix = axisPoints[3].y;
  const deltaPixX = x2Pix - x1Pix;
  const deltaPixY = y2Pix - y1Pix;
  const deltaValX = logX ? Math.log10(x2Val) - Math.log10(x1Val) : x2Val - x1Val;
  const deltaValY = logY ? Math.log10(y2Val) - Math.log10(y1Val) : y2Val - y1Val;

  // Fixed: scale = deltaPix / deltaVal, offset = pix1 - val1 * scale
  scaleX = deltaPixX / deltaValX;
  scaleY = deltaPixY / deltaValY;
  offsetX = logX ? x1Pix - Math.log10(x1Val) * scaleX : x1Pix - x1Val * scaleX;
  offsetY = logY ? y1Pix - Math.log10(y1Val) * scaleY : y1Pix - y1Val * scaleY;

  // Enhanced validation
  if (!isFinite(scaleX) || !isFinite(scaleY) || Math.abs(deltaPixX) < 1e-6 || Math.abs(deltaPixY) < 1e-6 || Math.abs(deltaValX) < 1e-6 || Math.abs(deltaValY) < 1e-6) {
    showModal('Calibration failed: Axes too close or invalid values. Adjust points/values.');
    console.error('Invalid calibration:', { scaleX, scaleY, offsetX, offsetY });
    return;
  }

  console.log('Calibration:', {
    x1Val, x2Val, y1Val, y2Val,
    x1Pix, x2Pix, y1Pix, y2Pix,
    scaleX, offsetX, scaleY, offsetY,
    logX, logY
  });

  isCalibrated = true;
  addPointBtn.disabled = false;
  adjustPointBtn.disabled = false;
  deletePointBtn.disabled = false;
  highlightLineBtn.disabled = false;
  clearPointsBtn.disabled = false;
  sortPointsBtn.disabled = false;
  newLineBtn.disabled = false;
  renameLineBtn.disabled = false;
  mode = 'add';
  axisInputs.style.display = 'none';
  axisInstruction.textContent = 'Calibration complete. Select a mode to digitize.';
  updateButtonStates();
  saveState();
  saveSession();
  draw();
  updatePreview();

  // Update existing points with new calibration
  lines.forEach(line => {
    line.points.forEach(p => {
      let dataCoords = canvasToDataCoords(p.x, p.y);
      if (dataCoords) {
        p.dataX = dataCoords.dataX;
        p.dataY = dataCoords.dataY;
        console.log(`Recalculated point: x=${p.x.toFixed(2)}, y=${p.y.toFixed(2)}, dataX=${p.dataX.toFixed(15)}, dataY=${p.dataY.toFixed(15)}`);
      }
    });
  });
  updatePointList();
  updatePreview();
});

toggleGridBtn.addEventListener('click', () => {
  showGrid = !showGrid;
  draw();
  saveState();
  saveSession();
});

toggleLogXBtn.addEventListener('click', () => {
  if (logX && (parseFloat(document.getElementById('x1-value').value) <= 0 || parseFloat(document.getElementById('x2-value').value) <= 0)) {
    showModal('Logarithmic X-axis requires positive values for X1 and X2');
    return;
  }
  logX = !logX;
  toggleLogXBtn.classList.toggle('log-active', logX);
  if (isCalibrated) {
    const x1Val = parseFloat(document.getElementById('x1-value').value);
    const x2Val = parseFloat(document.getElementById('x2-value').value);
    const deltaPixX = axisPoints[1].x - axisPoints[0].x;
    const deltaValX = logX ? Math.log10(x2Val) - Math.log10(x1Val) : x2Val - x1Val;
    scaleX = deltaPixX / deltaValX;
    offsetX = logX ? axisPoints[0].x - Math.log10(x1Val) * scaleX : axisPoints[0].x - x1Val * scaleX;
    if (!isFinite(scaleX) || Math.abs(deltaPixX) < 1e-6 || Math.abs(deltaValX) < 1e-6) {
      showModal('Invalid X-axis scale after toggling log mode.');
      console.error('Invalid scaleX:', scaleX);
      logX = !logX;
      toggleLogXBtn.classList.toggle('log-active', logX);
      return;
    }
    lines.forEach(line => {
      line.points.forEach(p => {
        let dataCoords = canvasToDataCoords(p.x, p.y);
        if (dataCoords) {
          p.dataX = dataCoords.dataX;
          console.log(`Updated X: x=${p.x.toFixed(2)}, dataX=${p.dataX.toFixed(15)}`);
        }
      });
    });
    updatePointList();
    updatePreview();
    draw();
    saveState();
    saveSession();
  }
});

toggleLogYBtn.addEventListener('click', () => {
  if (logY && (parseFloat(document.getElementById('y1-value').value) <= 0 || parseFloat(document.getElementById('y2-value').value) <= 0)) {
    showModal('Logarithmic Y-axis requires positive values for Y1 and Y2');
    return;
  }
  logY = !logY;
  toggleLogYBtn.classList.toggle('log-active', logY);
  if (isCalibrated) {
    const y1Val = parseFloat(document.getElementById('y1-value').value);
    const y2Val = parseFloat(document.getElementById('y2-value').value);
    const deltaPixY = axisPoints[3].y - axisPoints[2].y;
    const deltaValY = logY ? Math.log10(y2Val) - Math.log10(y1Val) : y2Val - y1Val;
    scaleY = deltaPixY / deltaValY;
    offsetY = logY ? axisPoints[2].y - Math.log10(y1Val) * scaleY : axisPoints[2].y - y1Val * scaleY;
    if (!isFinite(scaleY) || Math.abs(deltaPixY) < 1e-6 || Math.abs(deltaValY) < 1e-6) {
      showModal('Invalid Y-axis scale after toggling log mode.');
      console.error('Invalid scaleY:', scaleY);
      logY = !logY;
      toggleLogYBtn.classList.toggle('log-active', logY);
      return;
    }
    lines.forEach(line => {
      line.points.forEach(p => {
        let dataCoords = canvasToDataCoords(p.x, p.y);
        if (dataCoords) {
          p.dataY = dataCoords.dataY;
          console.log(`Updated Y: y=${p.y.toFixed(2)}, dataY=${p.dataY.toFixed(15)}`);
        }
      });
    });
    updatePointList();
    updatePreview();
    draw();
    saveState();
    saveSession();
  }
});

/**********************
 * TOTAL RESET
 **********************/
totalResetBtn.addEventListener('click', () => {
  showModal('Are you sure you want to reset all calibration and data?', false, () => {
    axisPoints = [];
    isCalibrated = false;
    scaleX = undefined;
    scaleY = undefined;
    offsetX = undefined;
    offsetY = undefined;
    logX = false;
    logY = false;
    lines = [{ name: 'Line 1', points: [] }];
    currentLineIndex = 0;
    highlightPath = [];
    isHighlighting = false;
    mode = 'none';
    history = [];
    historyIndex = -1;
    showGrid = false;
    toggleLogXBtn.classList.remove('log-active');
    toggleLogYBtn.classList.remove('log-active');
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
    undoBtn.disabled = true;
    redoBtn.disabled = true;
    highlightControls.style.display = 'none';
    updateLineSelect();
    updatePointList();
    updatePreview();
    updateButtonStates();
    localStorage.removeItem('digitizerState');
    draw();
    showModal('All calibration and data have been reset.');
  });
});

/**********************
 * POINT ACTIONS
 **********************/
addPointBtn.addEventListener('click', () => { mode = 'add'; updateButtonStates(); });
adjustPointBtn.addEventListener('click', () => { mode = 'adjust'; updateButtonStates(); });
deletePointBtn.addEventListener('click', () => { mode = 'delete'; updateButtonStates(); });
highlightLineBtn.addEventListener('click', () => {
  mode = 'highlight';
  highlightControls.style.display = 'block';
  updateButtonStates();
});
deleteHighlightBtn.addEventListener('click', () => {
  highlightPath = [];
  draw();
  saveState();
  saveSession();
});

clearPointsBtn.addEventListener('click', () => {
  lines[currentLineIndex].points = [];
  updatePointList();
  updatePreview();
  draw();
  saveState();
  saveSession();
});

sortPointsBtn.addEventListener('click', () => {
  lines[currentLineIndex].points.sort((a, b) => a.dataX - b.dataX);
  updatePointList();
  updatePreview();
  draw();
  saveState();
  saveSession();
});

function updateButtonStates() {
  addPointBtn.classList.toggle('active', mode === 'add');
  adjustPointBtn.classList.toggle('active', mode === 'adjust');
  deletePointBtn.classList.toggle('active', mode === 'delete');
  highlightLineBtn.classList.toggle('active', mode === 'highlight');
  canvas.style.cursor = isPanning ? 'move' : (mode === 'highlight' || mode === 'axes') ? 'crosshair' : 'default';
  statusBar.textContent = `Mode: ${mode}`;
}

/**********************
 * POINT PROCESSING
 **********************/
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
 * LINE MANAGEMENT
 **********************/
newLineBtn.addEventListener('click', () => {
  showModal('Enter new line name:', true, name => {
    if (!name) {
      showModal('Line name cannot be empty');
      return;
    }
    if (lines.some(line => line.name === name)) {
      showModal('Line name must be unique');
      return;
    }
    lines.push({ name, points: [] });
    currentLineIndex = lines.length - 1;
    updateLineSelect();
    updatePointList();
    updatePreview();
    draw();
    saveState();
    saveSession();
  });
});

renameLineBtn.addEventListener('click', () => {
  showModal('Enter new name:', true, name => {
    if (!name) {
      showModal('Line name cannot be empty');
      return;
    }
    if (lines.some((line, i) => i !== currentLineIndex && line.name === name)) {
      showModal('Line name must be unique');
      return;
    }
    lines[currentLineIndex].name = name;
    updateLineSelect();
    updatePreview();
    saveState();
    saveSession();
  });
});

lineSelect.addEventListener('change', () => {
  currentLineIndex = parseInt(lineSelect.value);
  updatePointList();
  updatePreview();
  draw();
  saveSession();
});

/**********************
 * DATA IMPORT/EXPORT
 **********************/
importJsonBtn.addEventListener('click', () => {
  importJsonInput.click();
});

importJsonInput.addEventListener('change', e => {
  showSpinner(true);
  const file = e.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const state = JSON.parse(ev.target.result);
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
        history = [];
        historyIndex = -1;
        updateLineSelect();
        updatePointList();
        updatePreview();
        updateButtonStates();
        toggleLogXBtn.classList.toggle('log-active', logX);
        toggleLogYBtn.classList.toggle('log-active', logY);
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
        saveSession();
        showSpinner(false);
        showModal('JSON data imported successfully.');
      } catch (e) {
        showModal('Invalid JSON file. Please try again.');
        console.error('JSON import error:', e);
        showSpinner(false);
      }
    };
    reader.readAsText(file);
  } else {
    showModal('No file selected.');
    showSpinner(false);
  }
});

exportJsonBtn.addEventListener('click', () => {
  download('graph.json', JSON.stringify({ lines, axisPoints, scaleX, scaleY, offsetX, offsetY, logX, logY, isCalibrated, zoom, panX, panY, showGrid, mode, currentLineIndex }), 'application/json');
});

exportCsvBtn.addEventListener('click', () => {
  let csv = '';
  lines.forEach(line => {
    csv += `"${line.name}",\n`;
    csv += 'X,Y\n';
    line.points.forEach(p => {
      const dataX = isNaN(p.dataX) || !isFinite(p.dataX) ? 'NaN' : p.dataX.toFixed(15);
      const dataY = isNaN(p.dataY) || !isFinite(p.dataY) ? 'NaN' : p.dataY.toFixed(15);
      csv += `${dataX},${dataY}\n`;
    });
    csv += '\n';
  });
  download('graph.csv', csv, 'text/csv');
});

exportXlsxBtn.addEventListener('click', () => {
  const workbook = XLSX.utils.book_new();
  lines.forEach(line => {
    const data = line.points.map(p => {
      const dataX = isNaN(p.dataX) || !isFinite(p.dataX) ? 'NaN' : p.dataX;
      const dataY = isNaN(p.dataY) || !isFinite(p.dataY) ? 'NaN' : p.dataY;
      return [dataX, dataY];
    });
    data.unshift(['X', 'Y']); // Header
    const worksheet = XLSX.utils.aoa_to_sheet(data);
    XLSX.utils.book_append_sheet(workbook, worksheet, line.name.substring(0, 31));
  });
  XLSX.writeFile(workbook, 'graph.xlsx');
});

exportImageBtn.addEventListener('click', () => {
  download('graph.png', canvas.toDataURL('image/png'), 'image/png');
});

clearSessionBtn.addEventListener('click', () => {
  localStorage.removeItem('digitizerState');
  showModal('Session cleared. Reload to reset.');
});

/**********************
 * HISTORY
 **********************/
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
    toggleLogXBtn.classList.toggle('log-active', logX);
    toggleLogYBtn.classList.toggle('log-active', logY);
    updateLineSelect();
    updatePointList();
    updatePreview();
    updateButtonStates();
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
    axisInputs.style.display = isCalibrated ? 'none' : axisPoints.length > 0 ? 'block' : 'none';
    axisInstruction.textContent = isCalibrated ? 'Calibration complete. Select a mode to digitize.' : axisPoints.length < 4 ? `Click point for ${axisLabels[axisPoints.length]} on the chart.` : 'Enter axis values and click Calibrate.';
    calibrateBtn.disabled = axisPoints.length !== 4;
    draw();
    saveSession();
  }
  undoBtn.disabled = historyIndex <= 0;
  redoBtn.disabled = historyIndex >= history.length - 1;
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
    toggleLogXBtn.classList.toggle('log-active', logX);
    toggleLogYBtn.classList.toggle('log-active', logY);
    updateLineSelect();
    updatePointList();
    updatePreview();
    updateButtonStates();
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
    axisInputs.style.display = isCalibrated ? 'none' : axisPoints.length > 0 ? 'block' : 'none';
    axisInstruction.textContent = isCalibrated ? 'Calibration complete. Select a mode to digitize.' : axisPoints.length < 4 ? `Click point for ${axisLabels[axisPoints.length]} on the chart.` : 'Enter axis values and click Calibrate.';
    calibrateBtn.disabled = axisPoints.length !== 4;
    draw();
    saveSession();
  }
  undoBtn.disabled = historyIndex <= 0;
  redoBtn.disabled = historyIndex >= history.length - 1;
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

if (localStorage.getItem('theme') === 'dark') {
  document.body.classList.add('dark');
}

loadSession();
draw();

const highlightWidthSlider = document.getElementById('highlight-width');
highlightWidthSlider.addEventListener('input', (e) => {
  highlightWidth = parseInt(e.target.value);
  draw();
});
