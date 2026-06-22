/**********************
 * DIGITIZER TOOLS
 * Handles: mouse interactions, auto-trace, snap-to-line,
 *          point actions, line management, import/export
 *
 * Depends on: digitizer-core.js (must be loaded first)
 *
 * FIXES:
 *  7.  snapToDark called twice — removed redundant second snap after autoTrace
 *  8.  Status bar shows un-snapped coords in axis+orthogonal mode — compute
 *      display coords after snapping is applied
 *  9.  Double-modal on clear session — callback approach, no nested showModal
 *  10. importJsonInput not reset — value cleared after each import
 *  11. highlightLineName not cleared after highlight committed
 *  12. interpolatePoints division-by-zero when n<2 — hard guard added
 **********************/

/**********************
 * SNAP-TO-DARK-PIXEL (MAGNET)
 **********************/
const SNAP_RADIUS_CANVAS = 18;

function snapToDark(cx, cy, forceSnap = false) {
  if (!rawImageData || (!snapToLine && !forceSnap)) return { x: cx, y: cy };
  const pixData = getPixelData();
  const { ix, iy } = canvasToImageCoords(cx, cy);
  const iw = pixData.width;
  const ih = pixData.height;
  const r  = Math.max(4, Math.round(SNAP_RADIUS_CANVAS * (iw / canvas.width)));

  let minLuma = 255;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const px = Math.round(ix) + dx;
      const py = Math.round(iy) + dy;
      if (px < 0 || py < 0 || px >= iw || py >= ih) continue;
      const idx  = (py * iw + px) * 4;
      const luma = 0.299 * pixData.data[idx] + 0.587 * pixData.data[idx+1] + 0.114 * pixData.data[idx+2];
      if (luma < minLuma) minLuma = luma;
    }
  }

  if (minLuma > 230) return { x: cx, y: cy };

  let darkX = 0, darkY = 0, darkCount = 0;
  const threshold = minLuma + 30;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const px = Math.round(ix) + dx;
      const py = Math.round(iy) + dy;
      if (px < 0 || py < 0 || px >= iw || py >= ih) continue;
      const idx  = (py * iw + px) * 4;
      const luma = 0.299 * pixData.data[idx] + 0.587 * pixData.data[idx+1] + 0.114 * pixData.data[idx+2];
      if (luma <= threshold) { darkX += px; darkY += py; darkCount++; }
    }
  }

  if (darkCount === 0) return { x: cx, y: cy };

  return {
    x: (darkX / darkCount) * (canvas.width  / iw),
    y: (darkY / darkCount) * (canvas.height / ih)
  };
}

/**********************
 * AUTO-TRACE ENGINE
 **********************/

function detectLineColor(pathPoints) {
  if (!rawImageData || pathPoints.length < 2) return null;
  const pixData = getPixelData();
  const iw   = pixData.width;
  const ih   = pixData.height;
  const step = Math.max(1, Math.floor(pathPoints.length / 300));
  const buckets = {};

  for (let i = 0; i < pathPoints.length; i += step) {
    const { ix, iy } = canvasToImageCoords(pathPoints[i].x, pathPoints[i].y);
    const px = Math.round(Math.max(0, Math.min(ix, iw - 1)));
    const py = Math.round(Math.max(0, Math.min(iy, ih - 1)));
    const idx = (py * iw + px) * 4;
    const r = pixData.data[idx];
    const g = pixData.data[idx + 1];
    const b = pixData.data[idx + 2];
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    if (luma > 220) continue;
    const key = `${r >> 5},${g >> 5},${b >> 5}`;
    if (!buckets[key]) buckets[key] = { rSum: 0, gSum: 0, bSum: 0, count: 0, lumaSum: 0 };
    buckets[key].rSum += r; buckets[key].gSum += g; buckets[key].bSum += b;
    buckets[key].lumaSum += luma; buckets[key].count++;
  }

  const candidates = Object.values(buckets).sort((a, b) => b.count - a.count);
  if (!candidates.length) return null;

  const best = candidates[0];
  return {
    r: Math.round(best.rSum / best.count),
    g: Math.round(best.gSum / best.count),
    b: Math.round(best.bSum / best.count),
    luma: best.lumaSum / best.count
  };
}

function refinePerp(cx, cy, tx, ty, targetColor, bandPx) {
  if (!rawImageData || !targetColor) return { x: cx, y: cy };
  const pixData = getPixelData();
  const iw  = pixData.width;
  const ih  = pixData.height;
  const { ix, iy } = canvasToImageCoords(cx, cy);

  const len = Math.hypot(tx, ty) || 1;
  const px_dir = -ty / len;
  const py_dir =  tx / len;

  const imgBand = Math.max(3, Math.round(bandPx * (iw / canvas.width)));
  const tol = 55;

  let sumX = 0, sumY = 0, count = 0;

  for (let s = -imgBand; s <= imgBand; s++) {
    const sx = Math.round(ix + px_dir * s);
    const sy = Math.round(iy + py_dir * s);
    if (sx < 0 || sy < 0 || sx >= iw || sy >= ih) continue;
    const idx = (sy * iw + sx) * 4;
    const dr  = pixData.data[idx]     - targetColor.r;
    const dg  = pixData.data[idx + 1] - targetColor.g;
    const db  = pixData.data[idx + 2] - targetColor.b;
    const dist = Math.sqrt(dr*dr + dg*dg + db*db);
    if (dist < tol) { sumX += sx; sumY += sy; count++; }
  }

  if (count === 0) return { x: cx, y: cy };
  return {
    x: (sumX / count) * (canvas.width  / iw),
    y: (sumY / count) * (canvas.height / ih)
  };
}

/**
 * FIX #7: autoTrace no longer applies a second snapToDark internally.
 * The single snap pass (forceSnap=true) here is the canonical one.
 * The caller (mouseup handler) must NOT snap again afterwards.
 */
function autoTrace(pathPoints, n) {
  showSpinner(true);
  const lineColor = detectLineColor(pathPoints);
  const spaced    = interpolatePoints(pathPoints, n);
  const BAND_CANVAS = 18;

  const refined = spaced.map((p, i) => {
    const prev = spaced[Math.max(0, i - 1)];
    const next = spaced[Math.min(spaced.length - 1, i + 1)];
    const tx   = next.x - prev.x;
    const ty   = next.y - prev.y;

    let pt = lineColor
      ? refinePerp(p.x, p.y, tx, ty, lineColor, BAND_CANVAS)
      : { x: p.x, y: p.y };

    // Single snap pass — forceSnap so it always runs regardless of toggle
    pt = snapToDark(pt.x, pt.y, true);
    return pt;
  });

  showSpinner(false);
  return { refined, lineColor };
}

/**********************
 * POINT INTERPOLATION
 **********************/

/**
 * FIX #12: Guard n < 2 to prevent division by zero (segLen = total / (n-1)).
 */
function interpolatePoints(points, n) {
  if (n < 2) n = 2; // safety clamp
  if (points.length < 2) return points.slice(0, n);
  const result = [];
  const totalLength = points.reduce((sum, p, i) => {
    if (i === 0) return 0;
    return sum + Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y);
  }, 0);
  if (totalLength === 0) return [points[0]];

  const segLen = totalLength / (n - 1);
  let   accLen = 0;
  result.push(points[0]);

  for (let i = 1; i < points.length && result.length < n; i++) {
    const dx  = points[i].x - points[i - 1].x;
    const dy  = points[i].y - points[i - 1].y;
    const seg = Math.hypot(dx, dy);
    accLen += seg;
    while (result.length < n && accLen >= segLen * result.length) {
      const t = (segLen * result.length - (accLen - seg)) / seg;
      result.push({ x: points[i - 1].x + t * dx, y: points[i - 1].y + t * dy });
    }
  }
  return result.slice(0, n);
}

/**********************
 * CANVAS MOUSE EVENTS
 **********************/
canvas.addEventListener('mousedown', e => {
  if (isPanning && e.buttons === 1) {
    isPanDragging = true;
    startPan.x = e.clientX - panX;
    startPan.y = e.clientY - panY;
    return;
  }

  let { x, y } = imageToCanvasCoords(e.clientX, e.clientY);

  // Apply orthogonal snapping for axis mode
  if (mode === 'axes' && orthogonalAxes.checked && axisPoints.length > 0) {
    if (sharedOrigin.checked) {
      if (axisPoints.length === 1) y = axisPoints[0].y;
      else if (axisPoints.length === 2) x = axisPoints[0].x;
    } else {
      if (axisPoints.length === 1) y = axisPoints[0].y;
      else if (axisPoints.length === 3) x = axisPoints[2].x;
    }
  }

  if (e.button === 0 && mode === 'axes') {
    if (sharedOrigin.checked && axisPoints.length === 0) {
      axisPoints.push({ x, y, label: 'Origin (X1/Y1)' });
      axisInstruction.textContent = 'Click point for X2 on the chart.';
    } else if (sharedOrigin.checked && axisPoints.length === 1) {
      axisPoints.push({ x, y, label: 'X2' });
      axisInstruction.textContent = 'Click point for Y2 on the chart.';
    } else if (sharedOrigin.checked && axisPoints.length === 2) {
      axisPoints.push({ x, y, label: 'Y2' });
      axisInstruction.textContent = 'Enter axis values and click Calibrate.';
      calibrateBtn.disabled = false;
    } else if (!sharedOrigin.checked && axisPoints.length < 4) {
      axisPoints.push({ x, y, label: axisLabels[axisPoints.length] });
      if (axisPoints.length < 4) {
        axisInstruction.textContent = `Click point for ${axisLabels[axisPoints.length]} on the chart.`;
      } else {
        axisInstruction.textContent = 'Enter axis values and click Calibrate.';
        calibrateBtn.disabled = false;
      }
    }
    axisInputs.style.display = 'block';
    updateAxisLabels();
    calibrateBtn.disabled = axisPoints.length !== (sharedOrigin.checked ? 3 : 4);
    draw(); saveState(); saveSession();

  } else if (e.button === 0 && mode === 'add' && isCalibrated) {
    const snapped   = snapToDark(x, y, false);
    const dataCoords= canvasToDataCoords(snapped.x, snapped.y);
    if (!dataCoords) return;
    const line = lines[currentLineIndex];
    line.points.push({ x: snapped.x, y: snapped.y, dataX: dataCoords.dataX, dataY: dataCoords.dataY, order: ++line.orderCounter });
    updatePreview(); draw(); saveState(); saveSession();

  } else if (e.button === 0 && mode === 'delete' && isCalibrated) {
    const index = findNearestPointIndex(x, y);
    if (index !== -1) {
      lines[currentLineIndex].points.splice(index, 1);
      updatePreview(); draw(); saveState(); saveSession();
    }

  } else if (e.button === 0 && mode === 'adjust' && isCalibrated) {
    selectedPointIndex = findNearestPointIndex(x, y);
    if (selectedPointIndex !== -1) isDraggingPoint = true;

  } else if (e.button === 0 && mode === 'highlight' && isCalibrated && !isHighlighting) {
    isHighlighting = true;
    highlightPath  = [{ x, y }];
    draw();
  }
});

canvas.addEventListener('mousemove', e => {
  let { x, y } = imageToCanvasCoords(e.clientX, e.clientY);

  // FIX #8: Apply orthogonal snap BEFORE computing display coordinates so
  // the status bar always reflects the snapped position in axis mode.
  if (mode === 'axes' && orthogonalAxes.checked && axisPoints.length > 0) {
    if (sharedOrigin.checked) {
      if (axisPoints.length === 1) y = axisPoints[0].y;
      else if (axisPoints.length === 2) x = axisPoints[0].x;
    } else {
      if (axisPoints.length === 1) y = axisPoints[0].y;
      else if (axisPoints.length === 3) x = axisPoints[2].x;
    }
  }

  let dataCoords = isCalibrated ? canvasToDataCoords(x, y) : null;
  if (dataCoords) {
    statusBar.textContent = `Mode: ${mode} | Canvas: (${x.toFixed(1)}, ${y.toFixed(1)}) | Data: (${dataCoords.dataX.toFixed(4)}, ${dataCoords.dataY.toFixed(4)})`;
  } else {
    statusBar.textContent = `Mode: ${mode} | Canvas: (${x.toFixed(1)}, ${y.toFixed(1)})`;
  }

  if (['axes', 'add', 'adjust', 'delete', 'highlight'].includes(mode)) {
    drawMagnifier(e.clientX, e.clientY);
  }

  if (isDraggingPoint && mode === 'adjust') {
    const snapped    = snapToDark(x, y, false);
    const dc         = canvasToDataCoords(snapped.x, snapped.y);
    if (!dc) return;
    lines[currentLineIndex].points[selectedPointIndex] = {
      x: snapped.x, y: snapped.y, dataX: dc.dataX, dataY: dc.dataY,
      order: lines[currentLineIndex].points[selectedPointIndex].order
    };
    updatePreview(); draw();
  }

  if (isHighlighting && mode === 'highlight') {
    const last = highlightPath[highlightPath.length - 1];
    if (!last || Math.hypot(x - last.x, y - last.y) > 5 / zoom) {
      highlightPath.push({ x, y });
      draw();
    }
  }
});

canvas.addEventListener('mouseup', e => {
  if (e.button === 0 && mode === 'adjust' && isDraggingPoint) {
    isDraggingPoint    = false;
    selectedPointIndex = -1;
    saveState(); saveSession();

  } else if (e.button === 0 && mode === 'highlight' && isHighlighting) {
    isHighlighting = false;
    if (highlightPath.length < 2) {
      showModal('Highlight path is too short.');
      highlightPath = []; draw(); return;
    }

    // FIX #12: Validate n >= 2 before using
    let n = parseInt(nPointsInput.value);
    if (isNaN(n) || n < 2) {
      showModal('Number of points (n) must be at least 2.');
      highlightPath = []; draw(); return;
    }

    const useAutoTrace = autoTraceCheckbox && autoTraceCheckbox.checked;

    let lineName = (highlightLineName.value.trim()) || `Highlighted Line ${lines.length + 1}`;
    let suffix = 1;
    const baseName = lineName;
    while (lines.some(l => l.name === lineName)) { lineName = `${baseName} (${suffix++})`; }

    const newLine = { name: lineName, points: [], sorted: false, orderCounter: 0 };
    lines.push(newLine);
    currentLineIndex = lines.length - 1;

    let candidates;
    if (useAutoTrace && rawImageData) {
      // FIX #7: autoTrace already applies forceSnap internally.
      // Do NOT call snapToDark again on the returned points.
      const { refined, lineColor } = autoTrace(highlightPath, n);
      candidates = refined;
      const colorDesc = lineColor ? `RGB(${lineColor.r},${lineColor.g},${lineColor.b})` : 'unknown';
      statusBar.textContent = `Auto-trace: ${candidates.length} pts — detected line color ${colorDesc}`;

      candidates.forEach(p => {
        const dc = canvasToDataCoords(p.x, p.y);
        if (dc) newLine.points.push({ x: p.x, y: p.y, dataX: dc.dataX, dataY: dc.dataY, order: ++newLine.orderCounter });
      });
    } else {
      // Non-auto-trace path: interpolate then apply snap toggle normally
      candidates = interpolatePoints(highlightPath, n);
      candidates.forEach(p => {
        const snapped = snapToDark(p.x, p.y, false); // respects snapToLine toggle
        const dc = canvasToDataCoords(snapped.x, snapped.y);
        if (dc) newLine.points.push({ x: snapped.x, y: snapped.y, dataX: dc.dataX, dataY: dc.dataY, order: ++newLine.orderCounter });
      });
    }

    highlightPath = [];
    // FIX #11: Clear the line name input so the next highlight starts fresh
    highlightLineName.value = '';
    updateLineSelect(); updatePreview(); draw(); saveState(); saveSession();
  }
});

/**********************
 * IMAGE UPLOAD
 **********************/
imageUpload.addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) { showModal('No file selected.'); return; }
  const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/bmp', 'image/webp'];
  if (!validTypes.includes(file.type)) {
    showModal('Invalid file type. Please upload PNG, JPEG, GIF, BMP or WebP.');
    return;
  }
  const reader = new FileReader();
  reader.onload  = ev => loadImage(ev.target.result);
  reader.onerror = ()  => showModal('Error reading file.');
  reader.readAsDataURL(file);
});

/**********************
 * POINT ACTIONS
 **********************/
addPointBtn.addEventListener('click', () => {
  mode = 'add';
  highlightControls.style.display = 'none';
  updateButtonStates();
});

adjustPointBtn.addEventListener('click', () => {
  mode = 'adjust';
  highlightControls.style.display = 'none';
  updateButtonStates();
});

deletePointBtn.addEventListener('click', () => {
  mode = 'delete';
  highlightControls.style.display = 'none';
  updateButtonStates();
});

highlightLineBtn.addEventListener('click', () => {
  mode = 'highlight';
  highlightControls.style.display = 'block';
  axisInputs.style.display        = 'none';
  updateButtonStates();
});

deleteHighlightBtn.addEventListener('click', () => {
  highlightPath = [];
  draw(); saveState(); saveSession();
});

clearPointsBtn.addEventListener('click', () => {
  lines[currentLineIndex].points       = [];
  lines[currentLineIndex].orderCounter = 0;
  lines[currentLineIndex].sorted       = false;
  sortPointsBtn.classList.remove('sort-active');
  updatePreview(); draw(); saveState(); saveSession();
});

sortPointsBtn.addEventListener('click', () => {
  const line = lines[currentLineIndex];
  line.sorted = !line.sorted;
  sortPointsBtn.classList.toggle('sort-active', line.sorted);
  updatePreview(); draw(); saveState(); saveSession();
});

/**********************
 * LINE MANAGEMENT
 **********************/
newLineBtn.addEventListener('click', () => {
  showModal('Enter new line name:', true, name => {
    if (!name) { showModal('Line name cannot be empty'); return; }
    if (lines.some(l => l.name === name)) { showModal('Line name must be unique'); return; }
    lines.push({ name, points: [], sorted: false, orderCounter: 0 });
    currentLineIndex = lines.length - 1;
    updateLineSelect(); updatePreview(); draw(); saveState(); saveSession();
  });
});

renameLineBtn.addEventListener('click', () => {
  showModal('Enter new name:', true, name => {
    if (!name) { showModal('Line name cannot be empty'); return; }
    if (lines.some((l, i) => i !== currentLineIndex && l.name === name)) {
      showModal('Line name must be unique'); return;
    }
    lines[currentLineIndex].name = name;
    updateLineSelect(); updatePreview(); saveState(); saveSession();
  });
});

lineSelect.addEventListener('change', () => {
  currentLineIndex = parseInt(lineSelect.value);
  sortPointsBtn.classList.toggle('sort-active', lines[currentLineIndex].sorted);
  updatePreview(); draw(); saveSession();
});

/**********************
 * CLEAR / TOTAL RESET
 **********************/
function performFullReset() {
  img.src = '';
  rawImageData = null;
  processedImageData = null;
  canvas.width = canvas.height = 0;
  axisPoints   = [];
  isCalibrated = false;
  scaleX = scaleY = offsetX = offsetY = undefined;
  logX = logY = false;
  lines         = [{ name: 'Line 1', points: [], sorted: false, orderCounter: 0 }];
  currentLineIndex = 0;
  highlightPath    = [];
  isHighlighting   = false;
  mode             = 'none';
  history          = []; historyIndex = -1;
  showGrid         = false;
  magnifierZoom    = 2;
  brightnessVal    = 100; contrastVal = 100;
  snapToLine       = false; gridFilterOn = false;
  toggleLogXBtn.classList.remove('log-active');
  toggleLogYBtn.classList.remove('log-active');
  axisInputs.style.display       = 'none';
  highlightControls.style.display= 'none';
  axisInstruction.textContent    = 'Click "Set Axis Points" then enter values.';
  brightnessSlider.value = 100; contrastSlider.value = 100;
  document.getElementById('brightness-val').textContent = '100%';
  document.getElementById('contrast-val').textContent   = '100%';
  snapToggle.checked = false; gridFilterToggle.checked = false;
  highlightLineName.value = '';
  _applyCalibrationButtonState();
  undoBtn.disabled = redoBtn.disabled = true;
  sortPointsBtn.classList.remove('sort-active');
  updateLineSelect(); updatePreview(); updateButtonStates();
  localStorage.removeItem('digitizerState');
  draw();
}

/**
 * FIX #9: Avoid double-modal — confirmation modal calls performFullReset
 * directly in its OK callback and does not call showModal again.
 * A brief status bar update confirms the action without a second modal.
 */
clearSessionBtn.addEventListener('click', () => {
  showModal('Clear all calibration and data? This cannot be undone.', false, () => {
    performFullReset();
    statusBar.textContent = 'Session cleared.';
  });
});

/**********************
 * EXPORT IMAGE
 **********************/
if (exportImageBtn) {
  exportImageBtn.addEventListener('click', () => {
    if (!img.src || !img.complete) { showModal('No image loaded.'); return; }
    const a   = document.createElement('a');
    a.href    = canvas.toDataURL('image/png');
    a.download= 'digitized_graph.png';
    a.click();
  });
}

/**********************
 * DATA IMPORT / EXPORT
 **********************/
importJsonBtn.addEventListener('click', () => importJsonInput.click());

importJsonInput.addEventListener('change', e => {
  showSpinner(true);
  const file = e.target.files[0];
  // FIX #10: Reset value immediately so the same file can be re-imported
  e.target.value = '';
  if (!file) { showModal('No file selected.'); showSpinner(false); return; }
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const state = JSON.parse(ev.target.result);
      lines    = state.lines    || [{ name: 'Line 1', points: [], sorted: false, orderCounter: 0 }];
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
      mode            = state.mode        || 'none';
      currentLineIndex= state.currentLineIndex || 0;
      magnifierZoom   = state.magnifierZoom    || 2;
      history = []; historyIndex = -1;
      updateLineSelect(); updatePreview(); updateButtonStates();
      toggleLogXBtn.classList.toggle('log-active', logX);
      toggleLogYBtn.classList.toggle('log-active', logY);
      document.getElementById('magnifier-zoom').value = magnifierZoom;
      highlightControls.style.display = mode === 'highlight' ? 'block' : 'none';
      axisInputs.style.display = isCalibrated ? 'none' : (mode === 'axes' && axisPoints.length > 0) ? 'block' : 'none';
      _applyCalibrationButtonState();
      sortPointsBtn.classList.toggle('sort-active', lines[currentLineIndex].sorted);
      draw(); saveState(); saveSession();
      showSpinner(false);
      showModal('JSON imported successfully.');
    } catch (err) {
      showModal('Invalid JSON file.'); console.error(err); showSpinner(false);
    }
  };
  reader.readAsText(file);
});

exportJsonBtn.addEventListener('click', () => {
  download('graph.json', JSON.stringify({
    lines, axisPoints, scaleX, scaleY, offsetX, offsetY,
    logX, logY, isCalibrated, zoom, panX, panY,
    showGrid, mode, currentLineIndex, magnifierZoom
  }), 'application/json');
});

exportCsvBtn.addEventListener('click', () => {
  let csv = '';
  lines.forEach(line => {
    csv += `"${line.name}"\nX,Y\n`;
    const pts = line.sorted
      ? [...line.points].sort((a, b) => a.dataX - b.dataX)
      : [...line.points].sort((a, b) => a.order  - b.order);
    pts.forEach(p => {
      csv += `${isNaN(p.dataX)||!isFinite(p.dataX)?'NaN':p.dataX.toFixed(15)},${isNaN(p.dataY)||!isFinite(p.dataY)?'NaN':p.dataY.toFixed(15)}\n`;
    });
    csv += '\n';
  });
  download('graph.csv', csv, 'text/csv');
});

exportXlsxBtn.addEventListener('click', () => {
  try {
    const wb  = XLSX.utils.book_new();
    const all = [];
    lines.forEach((line, idx) => {
      if (!line.points.length) return;
      all.push([line.name]);
      all.push(['X', 'Y']);
      const pts = line.sorted
        ? [...line.points].sort((a, b) => a.dataX - b.dataX)
        : [...line.points].sort((a, b) => a.order  - b.order);
      pts.forEach(p => {
        all.push([
          isNaN(p.dataX)||!isFinite(p.dataX)?'NaN':Number(p.dataX.toFixed(15)),
          isNaN(p.dataY)||!isFinite(p.dataY)?'NaN':Number(p.dataY.toFixed(15))
        ]);
      });
      if (idx < lines.length - 1) all.push([]);
    });
    if (!all.length) { showModal('No data to export.'); return; }
    const ws = XLSX.utils.aoa_to_sheet(all);
    XLSX.utils.book_append_sheet(wb, ws, 'All_Lines');
    XLSX.writeFile(wb, 'graph.xlsx');
  } catch (e) {
    showModal('Failed to export XLSX.'); console.error(e);
  }
});
