/**********************
 * DIGITIZER TOOLS
 * Handles: mouse interactions, snap (dark OR chosen colour), auto-trace,
 *          point actions, line management, import/export
 *
 * Depends on: digitizer-core.js (must be loaded first)
 *
 * CHANGES IN THIS VERSION
 *  - Everything works in image-pixel space (no window-size dependency).
 *  - Snap can target dark pixels (default) or a user-chosen colour,
 *    with tolerance and an on-image eyedropper (see core: snap-* controls).
 *  - Snap / auto-trace search radius is defined in SCREEN pixels, so it stays
 *    sensible at any zoom level.
 *  - Mode buttons are real toggles: click an active mode again to switch it off.
 *  - Pan also works with the middle mouse button at any time.
 *  - Mouse-up is tracked on the window, so releasing outside the canvas
 *    can no longer leave a drag or a highlight "stuck".
 **********************/

/**********************
 * SNAP (MAGNET)
 **********************/
const SNAP_RADIUS_SCREEN = 18;   // px on screen
const BAND_SCREEN        = 18;   // auto-trace perpendicular search band, px on screen

/** Convert a screen-pixel distance into image pixels at the current zoom. */
function screenToImgPx(px, min = 3, max = 40) {
  return Math.min(max, Math.max(min, Math.round(px / zoom)));
}

/**
 * Main entry point used by add / adjust / highlight / auto-trace.
 * Respects the magnet toggle unless forceSnap is true.
 * Target = darkest pixels, or pixels close to the chosen colour.
 */
function snapToDark(cx, cy, forceSnap = false) {
  if (!rawImageData || (!snapToLine && !forceSnap)) return { x: cx, y: cy };
  return snapColorMode === 'custom'
    ? snapToColor(cx, cy, hexToRgb(snapColor), snapTolerance)
    : snapToDarkest(cx, cy);
}

function snapToDarkest(cx, cy) {
  const pixData = getPixelData();
  const iw = pixData.width, ih = pixData.height, d = pixData.data;
  const ix = Math.floor(cx), iy = Math.floor(cy);
  const r  = screenToImgPx(SNAP_RADIUS_SCREEN);

  let minLuma = 255;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const px = ix + dx, py = iy + dy;
      if (px < 0 || py < 0 || px >= iw || py >= ih) continue;
      const i = (py * iw + px) * 4;
      const luma = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      if (luma < minLuma) minLuma = luma;
    }
  }
  if (minLuma > 230) return { x: cx, y: cy };

  let sx = 0, sy = 0, n = 0;
  const threshold = minLuma + 30;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const px = ix + dx, py = iy + dy;
      if (px < 0 || py < 0 || px >= iw || py >= ih) continue;
      const i = (py * iw + px) * 4;
      const luma = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      if (luma <= threshold) { sx += px; sy += py; n++; }
    }
  }
  if (n === 0) return { x: cx, y: cy };
  return { x: sx / n + 0.5, y: sy / n + 0.5 };
}

/**
 * Snap to the centroid of pixels whose colour is close to `target`.
 * If nothing within `tol` (RGB distance) exists in the radius, the point stays put.
 */
function snapToColor(cx, cy, target, tol) {
  const pixData = getPixelData();
  const iw = pixData.width, ih = pixData.height, d = pixData.data;
  const ix = Math.floor(cx), iy = Math.floor(cy);
  const r  = screenToImgPx(SNAP_RADIUS_SCREEN);

  const dist2 = i => {
    const dr = d[i] - target.r, dg = d[i + 1] - target.g, db = d[i + 2] - target.b;
    return dr * dr + dg * dg + db * db;
  };

  let best = Infinity;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const px = ix + dx, py = iy + dy;
      if (px < 0 || py < 0 || px >= iw || py >= ih) continue;
      const i = (py * iw + px) * 4;
      if (d[i + 3] < 10) continue;
      const v = dist2(i);
      if (v < best) best = v;
    }
  }
  if (!isFinite(best) || Math.sqrt(best) > tol) return { x: cx, y: cy };

  // Average everything that is about as good as the best match (and within tol)
  const limit = Math.min(tol, Math.sqrt(best) + 25);
  const limit2 = limit * limit;
  let sx = 0, sy = 0, n = 0;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const px = ix + dx, py = iy + dy;
      if (px < 0 || py < 0 || px >= iw || py >= ih) continue;
      const i = (py * iw + px) * 4;
      if (d[i + 3] < 10) continue;
      if (dist2(i) <= limit2) { sx += px; sy += py; n++; }
    }
  }
  if (n === 0) return { x: cx, y: cy };
  return { x: sx / n + 0.5, y: sy / n + 0.5 };
}

/**********************
 * AUTO-TRACE ENGINE
 **********************/
function detectLineColor(pathPoints) {
  if (!rawImageData || pathPoints.length < 2) return null;
  const pixData = getPixelData();
  const iw = pixData.width, ih = pixData.height;
  const step = Math.max(1, Math.floor(pathPoints.length / 300));
  const buckets = {};

  for (let i = 0; i < pathPoints.length; i += step) {
    const px = Math.floor(Math.max(0, Math.min(pathPoints[i].x, iw - 1)));
    const py = Math.floor(Math.max(0, Math.min(pathPoints[i].y, ih - 1)));
    const idx = (py * iw + px) * 4;
    const r = pixData.data[idx], g = pixData.data[idx + 1], b = pixData.data[idx + 2];
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

function refinePerp(cx, cy, tx, ty, targetColor, band) {
  if (!rawImageData || !targetColor) return { x: cx, y: cy };
  const pixData = getPixelData();
  const iw = pixData.width, ih = pixData.height;

  const len = Math.hypot(tx, ty) || 1;
  const pxDir = -ty / len, pyDir = tx / len;
  const tol = 55;
  let sumX = 0, sumY = 0, count = 0;

  for (let s = -band; s <= band; s++) {
    const sx = Math.floor(cx + pxDir * s);
    const sy = Math.floor(cy + pyDir * s);
    if (sx < 0 || sy < 0 || sx >= iw || sy >= ih) continue;
    const idx = (sy * iw + sx) * 4;
    const dr = pixData.data[idx]     - targetColor.r;
    const dg = pixData.data[idx + 1] - targetColor.g;
    const db = pixData.data[idx + 2] - targetColor.b;
    if (Math.sqrt(dr * dr + dg * dg + db * db) < tol) { sumX += sx; sumY += sy; count++; }
  }
  if (count === 0) return { x: cx, y: cy };
  return { x: sumX / count + 0.5, y: sumY / count + 0.5 };
}

/**
 * Single refinement pass: colour-detect along the path, refine perpendicular,
 * then one snap pass (forceSnap) using the current snap target.
 */
function autoTrace(pathPoints, n) {
  showSpinner(true);
  const lineColor = detectLineColor(pathPoints);
  const spaced    = interpolatePoints(pathPoints, n);
  const band      = screenToImgPx(BAND_SCREEN);

  const refined = spaced.map((p, i) => {
    const prev = spaced[Math.max(0, i - 1)];
    const next = spaced[Math.min(spaced.length - 1, i + 1)];
    let pt = lineColor
      ? refinePerp(p.x, p.y, next.x - prev.x, next.y - prev.y, lineColor, band)
      : { x: p.x, y: p.y };
    return snapToDark(pt.x, pt.y, true);
  });

  showSpinner(false);
  return { refined, lineColor };
}

/**********************
 * POINT INTERPOLATION
 **********************/
function interpolatePoints(points, n) {
  if (n < 2) n = 2;
  if (points.length < 2) return points.slice(0, n);
  const result = [];
  const totalLength = points.reduce((sum, p, i) => {
    if (i === 0) return 0;
    return sum + Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y);
  }, 0);
  if (totalLength === 0) return [points[0]];

  const segLen = totalLength / (n - 1);
  let accLen = 0;
  result.push(points[0]);

  for (let i = 1; i < points.length && result.length < n; i++) {
    const dx  = points[i].x - points[i - 1].x;
    const dy  = points[i].y - points[i - 1].y;
    const seg = Math.hypot(dx, dy);
    if (seg === 0) continue;
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
function applyOrthogonal(x, y) {
  if (mode === 'axes' && orthogonalAxes.checked && axisPoints.length > 0) {
    if (sharedOrigin.checked) {
      if (axisPoints.length === 1) y = axisPoints[0].y;
      else if (axisPoints.length === 2) x = axisPoints[0].x;
    } else {
      if (axisPoints.length === 1) y = axisPoints[0].y;
      else if (axisPoints.length === 3) x = axisPoints[2].x;
    }
  }
  return { x, y };
}

canvas.addEventListener('mousedown', e => {
  // Pan: pan-mode + left button, or middle button any time
  if ((isPanning && e.button === 0) || e.button === 1) {
    e.preventDefault();
    isPanDragging = true;
    startPan.x = e.clientX - panX;
    startPan.y = e.clientY - panY;
    magnifier.style.display = 'none';
    updateButtonStates();
    return;
  }

  let { x, y } = imageToCanvasCoords(e.clientX, e.clientY);

  // Eyedropper for the curve/scatter detector target color.
  if (pickingDetectorColor && e.button === 0 && rawImageData) {
    const pd = getPixelData();
    const px = Math.floor(Math.max(0, Math.min(x, pd.width - 1)));
    const py = Math.floor(Math.max(0, Math.min(y, pd.height - 1)));
    const i = (py * pd.width + px) * 4;
    const hex = rgbToHex(pd.data[i], pd.data[i + 1], pd.data[i + 2]);
    const input = document.getElementById('cd-color');
    const chip = document.getElementById('cd-color-chip');
    const filter = document.getElementById('cd-filter-color');
    if (input) input.value = hex;
    if (chip) chip.style.background = hex;
    if (filter) filter.checked = true;
    if (typeof window.refreshCurveDetectorColorState === 'function') window.refreshCurveDetectorColorState();
    setPickingDetectorColor(false);
    statusBar.textContent = `Detector target color set to ${hex.toUpperCase()}`;
    saveSession();
    return;
  }

  // Eyedropper for the snap colour
  if (pickingSnapColor && e.button === 0 && rawImageData) {
    const pd = getPixelData();
    const px = Math.floor(Math.max(0, Math.min(x, pd.width  - 1)));
    const py = Math.floor(Math.max(0, Math.min(y, pd.height - 1)));
    const i  = (py * pd.width + px) * 4;
    snapColor     = rgbToHex(pd.data[i], pd.data[i + 1], pd.data[i + 2]);
    snapColorMode = 'custom';
    snapToLine    = true;
    setPickingSnapColor(false);
    statusBar.textContent = `Snap colour set to ${snapColor.toUpperCase()}`;
    saveSession();
    return;
  }

  ({ x, y } = applyOrthogonal(x, y));

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
    } else if (!sharedOrigin.checked && axisPoints.length < 4) {
      axisPoints.push({ x, y, label: axisLabels[axisPoints.length] });
      axisInstruction.textContent = axisPoints.length < 4
        ? `Click point for ${axisLabels[axisPoints.length]} on the chart.`
        : 'Enter axis values and click Calibrate.';
    }
    axisInputs.style.display = 'block';
    updateAxisLabels();
    calibrateBtn.disabled = axisPoints.length !== (sharedOrigin.checked ? 3 : 4);
    draw(); saveState();

  } else if (e.button === 0 && mode === 'add' && isCalibrated) {
    const snapped    = snapToDark(x, y, false);
    const dataCoords = canvasToDataCoords(snapped.x, snapped.y);
    if (!dataCoords) return;
    const line = lines[currentLineIndex];
    line.points.push({ x: snapped.x, y: snapped.y, dataX: dataCoords.dataX, dataY: dataCoords.dataY, order: ++line.orderCounter });
    updatePreview(); draw(); saveState();

  } else if (e.button === 0 && mode === 'delete' && isCalibrated) {
    const index = findNearestPointIndex(x, y);
    if (index !== -1) {
      lines[currentLineIndex].points.splice(index, 1);
      updatePreview(); draw(); saveState();
    }

  } else if (e.button === 0 && mode === 'adjust' && isCalibrated) {
    selectedPointIndex = findNearestPointIndex(x, y);
    if (selectedPointIndex !== -1) isDraggingPoint = true;
    draw();

  } else if (e.button === 0 && mode === 'highlight' && isCalibrated && !isHighlighting) {
    isHighlighting = true;
    highlightPath  = [{ x, y }];
    draw();
  }
});

canvas.addEventListener('mousemove', e => {
  if (isPanDragging) return;   // core handles panning

  let { x, y } = imageToCanvasCoords(e.clientX, e.clientY);
  ({ x, y } = applyOrthogonal(x, y));

  const dataCoords = isCalibrated ? canvasToDataCoords(x, y) : null;
  const modeLabel  = isPanning ? 'pan' : mode;
  statusBar.textContent = dataCoords
    ? `Mode: ${modeLabel} | Image px: (${x.toFixed(1)}, ${y.toFixed(1)}) | Data: (${dataCoords.dataX.toFixed(4)}, ${dataCoords.dataY.toFixed(4)})`
    : `Mode: ${modeLabel} | Image px: (${x.toFixed(1)}, ${y.toFixed(1)})`;

  if (pickingSnapColor || pickingDetectorColor) updateColorPreview(e.clientX, e.clientY, x, y);

  if (pickingSnapColor || pickingDetectorColor || ['axes', 'add', 'adjust', 'delete', 'highlight'].includes(mode)) {
    drawMagnifier(e.clientX, e.clientY);
  }

  if (isDraggingPoint && mode === 'adjust' && selectedPointIndex !== -1) {
    const snapped = snapToDark(x, y, false);
    const dc      = canvasToDataCoords(snapped.x, snapped.y);
    if (!dc) return;
    const old = lines[currentLineIndex].points[selectedPointIndex];
    lines[currentLineIndex].points[selectedPointIndex] = {
      x: snapped.x, y: snapped.y, dataX: dc.dataX, dataY: dc.dataY, order: old.order
    };
    updatePreview(); draw();
  }

  if (isHighlighting && mode === 'highlight') {
    const last = highlightPath[highlightPath.length - 1];
    if (!last || Math.hypot(x - last.x, y - last.y) > 3 / zoom) {
      highlightPath.push({ x, y });
      draw();
    }
  }
});

// Window-level mouseup: releasing outside the canvas can't leave things stuck.
window.addEventListener('mouseup', e => {
  if (e.button !== 0) return;

  if (mode === 'adjust' && isDraggingPoint) {
    isDraggingPoint    = false;
    selectedPointIndex = -1;
    draw(); saveState();

  } else if (mode === 'highlight' && isHighlighting) {
    isHighlighting = false;
    if (highlightPath.length < 2) {
      showModal('Highlight path is too short.');
      highlightPath = []; draw(); return;
    }

    const n = parseInt(nPointsInput.value);
    if (isNaN(n) || n < 2) {
      showModal('Number of points (n) must be at least 2.');
      highlightPath = []; draw(); return;
    }

    const useAutoTrace = autoTraceCheckbox && autoTraceCheckbox.checked;

    let lineName = highlightLineName.value.trim() || `Highlighted Line ${lines.length + 1}`;
    let suffix = 1;
    const baseName = lineName;
    while (lines.some(l => l.name === lineName)) { lineName = `${baseName} (${suffix++})`; }

    const newLine = { name: lineName, points: [], sorted: false, orderCounter: 0 };
    lines.push(newLine);
    currentLineIndex = lines.length - 1;

    if (useAutoTrace && rawImageData) {
      const { refined, lineColor } = autoTrace(highlightPath, n);
      const colorDesc = lineColor ? `RGB(${lineColor.r},${lineColor.g},${lineColor.b})` : 'unknown';
      statusBar.textContent = `Auto-trace: ${refined.length} pts — detected line color ${colorDesc}`;
      refined.forEach(p => {
        const dc = canvasToDataCoords(p.x, p.y);
        if (dc) newLine.points.push({ x: p.x, y: p.y, dataX: dc.dataX, dataY: dc.dataY, order: ++newLine.orderCounter });
      });
    } else {
      interpolatePoints(highlightPath, n).forEach(p => {
        const snapped = snapToDark(p.x, p.y, false); // respects magnet toggle
        const dc = canvasToDataCoords(snapped.x, snapped.y);
        if (dc) newLine.points.push({ x: snapped.x, y: snapped.y, dataX: dc.dataX, dataY: dc.dataY, order: ++newLine.orderCounter });
      });
    }

    highlightPath = [];
    highlightLineName.value = '';
    updateLineSelect(); updatePreview(); updateButtonStates(); draw(); saveState();
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
 * POINT ACTIONS  (mode buttons are toggles)
 **********************/
function toggleMode(m) {
  mode = (mode === m) ? 'none' : m;       // click again = switch off
  setPickingSnapColor(false);
  if (mode !== 'highlight') { isHighlighting = false; }
  syncModePanels();
  if (mode === 'highlight') axisInputs.style.display = 'none';
  if (mode === 'none') magnifier.style.display = 'none';
  updateButtonStates();
  if (typeof refreshToolPreview === 'function') refreshToolPreview();
  saveSession();
}

addPointBtn.addEventListener('click',      () => toggleMode('add'));
adjustPointBtn.addEventListener('click',   () => toggleMode('adjust'));
deletePointBtn.addEventListener('click',   () => toggleMode('delete'));
highlightLineBtn.addEventListener('click', () => toggleMode('highlight'));

deleteHighlightBtn.addEventListener('click', () => {
  highlightPath = [];
  isHighlighting = false;
  draw();
});

clearPointsBtn.addEventListener('click', () => {
  lines[currentLineIndex].points       = [];
  lines[currentLineIndex].orderCounter = 0;
  lines[currentLineIndex].sorted       = false;
  updatePreview(); updateButtonStates(); draw(); saveState();
});

sortPointsBtn.addEventListener('click', () => {
  const line = lines[currentLineIndex];
  line.sorted = !line.sorted;
  updatePreview(); updateButtonStates(); draw(); saveState();
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
    updateLineSelect(); updatePreview(); updateButtonStates(); draw(); saveState();
  });
});

renameLineBtn.addEventListener('click', () => {
  showModal('Enter new name:', true, name => {
    if (!name) { showModal('Line name cannot be empty'); return; }
    if (lines.some((l, i) => i !== currentLineIndex && l.name === name)) {
      showModal('Line name must be unique'); return;
    }
    lines[currentLineIndex].name = name;
    updateLineSelect(); updatePreview(); saveState();
  });
});

lineSelect.addEventListener('change', () => {
  currentLineIndex = parseInt(lineSelect.value);
  updatePreview(); updateButtonStates(); draw(); saveSession();
});

/**********************
 * CLEAR / TOTAL RESET
 **********************/
function performFullReset() {
  img = new Image();
  rawImageData = null;
  processedImageData = null;
  enhancedCanvas.width = enhancedCanvas.height = 1;
  axisPoints   = [];
  isCalibrated = false;
  scaleX = scaleY = offsetX = offsetY = undefined;
  logX = logY = false;
  lines         = [{ name: 'Line 1', points: [], sorted: false, orderCounter: 0 }];
  currentLineIndex = 0;
  highlightPath    = [];
  isHighlighting   = false;
  selectedPointIndex = -1;
  mode             = 'none';
  history          = []; historyIndex = -1;
  showGrid         = false;
  magnifierZoom    = 2;
  brightnessVal    = 100; contrastVal = 100;
  snapToLine       = false; gridFilterOn = false;
  snapColorMode    = 'dark'; snapColor = '#ff0000'; snapTolerance = 60; pickingSnapColor = false; pickingDetectorColor = false; hideColorTip();
  isPanning        = false; isPanDragging = false;
  zoom = 1; panX = 0; panY = 0;
  axisInputs.style.display        = 'none';
  setAxesBtn.disabled = true;
  resetAxisPointsBtn.disabled = true;
  document.getElementById('x1-value').value = '';
  document.getElementById('x2-value').value = '';
  document.getElementById('y1-value').value = '';
  document.getElementById('y2-value').value = '';
  syncModePanels();
  magnifier.style.display         = 'none';
  axisInstruction.textContent     = 'Click "Set Axis Points" then enter values.';
  brightnessSlider.value = 100; contrastSlider.value = 100;
  document.getElementById('brightness-val').textContent = '100%';
  document.getElementById('contrast-val').textContent   = '100%';
  document.getElementById('magnifier-zoom').value = 2;
  gridFilterToggle.checked = false;
  snapToggle.checked = false;
  snapModeSelect.value = 'dark';
  snapColorInput.value = '#ff0000';
  snapTolSlider.value = '60';
  document.getElementById('snap-tol-val').textContent = '60';
  document.getElementById('shared-origin').checked = false;
  document.getElementById('orthogonal-axes').checked = false;
  highlightLineName.value = '';
  syncSnapUI();
  _applyCalibrationButtonState();
  undoBtn.disabled = redoBtn.disabled = true;
  if (pointList) pointList.innerHTML = '';   // explicit: sidebar list must be empty
  updateLineSelect(); updatePreview(); updatePointList(); updateButtonStates();
  if (typeof saveSession.cancel === 'function') saveSession.cancel();
  localStorage.removeItem('digitizerState');
  const upload = document.getElementById('image-upload');
  if (upload) upload.value = '';
  if (typeof window.resetCurveDetector === 'function') window.resetCurveDetector();
  setPickingDetectorColor(false);
  render();
  if (typeof window.refreshCurveDetectorState === 'function') window.refreshCurveDetectorState();
}

clearSessionBtn.addEventListener('click', () => {
  showModal('Clear all calibration and data? This cannot be undone.', false, () => {
    performFullReset();
    statusBar.textContent = 'Session cleared.';
  });
});

/**********************
 * EXPORT IMAGE  (full-resolution image + points, independent of the view)
 **********************/
if (exportImageBtn) {
  exportImageBtn.addEventListener('click', () => {
    if (!hasImage()) { showModal('No image loaded.'); return; }
    const out = document.createElement('canvas');
    out.width = imgW(); out.height = imgH();
    const c = out.getContext('2d');
    c.drawImage(enhancedCanvas, 0, 0);
    const z = Math.min(1, 1200 / Math.max(out.width, out.height)); // marker size scales with image size
    drawOverlays(c, z, out.width, out.height);
    const a = document.createElement('a');
    a.href = out.toDataURL('image/png');
    a.download = 'digitized_graph.png';
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
  e.target.value = '';   // allow re-importing the same file
  if (!file) { showModal('No file selected.'); showSpinner(false); return; }
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const state = JSON.parse(ev.target.result);
      lines = state.lines || [{ name: 'Line 1', points: [], sorted: false, orderCounter: 0 }];
      normalizeLines();
      axisPoints       = state.axisPoints   || [];
      scaleX           = state.scaleX;
      scaleY           = state.scaleY;
      offsetX          = state.offsetX;
      offsetY          = state.offsetY;
      logX             = state.logX         || false;
      logY             = state.logY         || false;
      isCalibrated     = state.isCalibrated || false;
      showGrid         = state.showGrid     || false;
      mode             = state.mode         || 'none';
      currentLineIndex = Math.min(state.currentLineIndex || 0, lines.length - 1);
      magnifierZoom    = state.magnifierZoom || 2;
      setAxisValues(state.axisValues);
      selectedPointIndex = -1;
      if (!isCalibrated && ['add', 'adjust', 'delete', 'highlight'].includes(mode)) mode = 'none';
      // View (zoom/pan) is intentionally NOT imported – keep the current fitted view.
      history = []; historyIndex = -1;
      updateLineSelect(); updatePreview();
      document.getElementById('magnifier-zoom').value = magnifierZoom;
      syncModePanels();
      axisInputs.style.display = isCalibrated ? 'none' : (mode === 'axes' && axisPoints.length > 0) ? 'block' : 'none';
      axisInstruction.textContent = isCalibrated
        ? 'Calibration complete. Select a mode to digitize.'
        : 'Click "Set Axis Points" then enter values.';
      _applyCalibrationButtonState();
      updateButtonStates();
      draw(); saveState();
      showSpinner(false);
      showModal('JSON imported successfully.');
      warnIfLegacy(state);
    } catch (err) {
      showModal('Invalid JSON file.'); console.error(err); showSpinner(false);
    }
  };
  reader.readAsText(file);
});

exportJsonBtn.addEventListener('click', () => {
  download('graph.json', JSON.stringify({
    coordSpace: COORD_SPACE,
    lines, axisPoints, scaleX, scaleY, offsetX, offsetY,
    logX, logY, isCalibrated,
    showGrid, mode, currentLineIndex, magnifierZoom,
    axisValues: getAxisValues()
  }), 'application/json');
});

exportCsvBtn.addEventListener('click', () => {
  let csv = '';
  lines.forEach(line => {
    csv += `"${String(line.name).replace(/"/g, '""')}"\nX,Y\n`;
    const pts = line.sorted
      ? [...line.points].sort((a, b) => a.dataX - b.dataX)
      : [...line.points].sort((a, b) => a.order - b.order);
    pts.forEach(p => {
      csv += `${isNaN(p.dataX) || !isFinite(p.dataX) ? 'NaN' : p.dataX.toFixed(15)},${isNaN(p.dataY) || !isFinite(p.dataY) ? 'NaN' : p.dataY.toFixed(15)}\n`;
    });
    csv += '\n';
  });
  download('graph.csv', csv, 'text/csv');
});

exportXlsxBtn.addEventListener('click', () => {
  try {
    const wb  = XLSX.utils.book_new();
    const all = [];
    lines.forEach(line => {
      if (!line.points.length) return;
      if (all.length) all.push([]);          // blank row only BETWEEN datasets
      all.push([line.name]);
      all.push(['X', 'Y']);
      const pts = line.sorted
        ? [...line.points].sort((a, b) => a.dataX - b.dataX)
        : [...line.points].sort((a, b) => a.order - b.order);
      pts.forEach(p => {
        all.push([
          isNaN(p.dataX) || !isFinite(p.dataX) ? 'NaN' : Number(p.dataX.toFixed(15)),
          isNaN(p.dataY) || !isFinite(p.dataY) ? 'NaN' : Number(p.dataY.toFixed(15))
        ]);
      });
    });
    if (!all.length) { showModal('No data to export.'); return; }
    const ws = XLSX.utils.aoa_to_sheet(all);
    XLSX.utils.book_append_sheet(wb, ws, 'All_Lines');
    XLSX.writeFile(wb, 'graph.xlsx');
  } catch (e) {
    showModal('Failed to export XLSX.'); console.error(e);
  }
});
