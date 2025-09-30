/**********************
 * POINT ACTIONS
 **********************/
addPointBtn.addEventListener('click', () => {
  mode = 'add';
  updateButtonStates();
  draw();
});

adjustPointBtn.addEventListener('click', () => {
  mode = 'adjust';
  updateButtonStates();
  draw();
});

deletePointBtn.addEventListener('click', () => {
  mode = 'delete';
  updateButtonStates();
  draw();
});

highlightLineBtn.addEventListener('click', () => {
  mode = 'highlight';
  highlightPath = [];
  highlightControls.style.display = 'block';
  updateButtonStates();
  draw();
});

clearPointsBtn.addEventListener('click', () => {
  lines[currentLineIndex].points = [];
  highlightPath = [];
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

deleteHighlightBtn.addEventListener('click', () => {
  highlightPath = [];
  highlightControls.style.display = 'none';
  mode = 'none';
  updateButtonStates();
  draw();
  saveState();
});

const highlightWidthSlider = document.getElementById('highlight-width');
highlightWidthSlider.addEventListener('input', (e) => {
  highlightWidth = parseInt(e.target.value);
  draw();
});

canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  const { x, y } = imageToCanvasCoords(e.clientX, e.clientY);
  if (mode === 'add' && isCalibrated) {
    const coords = canvasToDataCoords(x, y);
    if (coords) {
      lines[currentLineIndex].points.push({ x, y, dataX: coords.dataX, dataY: coords.dataY });
      updatePreview();
      draw();
      saveState();
    }
  } else if (mode === 'adjust' && isCalibrated) {
    selectedPointIndex = findNearestPointIndex(x, y);
    if (selectedPointIndex !== -1) {
      isDraggingPoint = true;
    }
    draw();
  } else if (mode === 'delete' && isCalibrated) {
    const index = findNearestPointIndex(x, y);
    if (index !== -1) {
      lines[currentLineIndex].points.splice(index, 1);
      updatePreview();
      draw();
      saveState();
    }
  } else if (mode === 'highlight') {
    isHighlighting = true;
    highlightPath.push({ x, y });
    draw();
  }
});

canvas.addEventListener('mousemove', (e) => {
  const { x, y } = imageToCanvasCoords(e.clientX, e.clientY);
  if (mode === 'adjust' && isDraggingPoint && selectedPointIndex !== -1) {
    const coords = canvasToDataCoords(x, y);
    if (coords) {
      lines[currentLineIndex].points[selectedPointIndex] = { x, y, dataX: coords.dataX, dataY: coords.dataY };
      updatePreview();
      draw();
    }
  } else if (mode === 'highlight' && isHighlighting) {
    highlightPath.push({ x, y });
    draw();
  }
});

canvas.addEventListener('mouseup', () => {
  if (mode === 'adjust' && isDraggingPoint) {
    isDraggingPoint = false;
    selectedPointIndex = -1;
    updatePreview();
    draw();
    saveState();
  } else if (mode === 'highlight' && isHighlighting) {
    isHighlighting = false;
    const nPoints = parseInt(nPointsInput.value);
    if (nPoints < 1) {
      showModal('Number of points must be at least 1.');
      highlightPath = [];
      draw();
      return;
    }
    const lineName = highlightLineName.value || `Highlighted Line ${lines.length + 1}`;
    const interpolated = interpolatePoints(highlightPath, nPoints);
    const points = interpolated.map(p => {
      const coords = canvasToDataCoords(p.x, p.y);
      return coords ? { x: p.x, y: p.y, dataX: coords.dataX, dataY: coords.dataY } : null;
    }).filter(p => p !== null);
    if (points.length === 0) {
      showModal('No valid points generated. Try again.');
      highlightPath = [];
      draw();
      return;
    }
    lines.push({ name: lineName, points });
    currentLineIndex = lines.length - 1;
    highlightPath = [];
    highlightControls.style.display = 'none';
    mode = 'none';
    updateLineSelect();
    updatePreview();
    updateButtonStates();
    draw();
    saveState();
  }
});

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

function interpolatePoints(path, n) {
  if (path.length < 2) return path;
  const totalLength = path.reduce((acc, p, i) => {
    if (i === 0) return 0;
    const dx = p.x - path[i-1].x;
    const dy = p.y - path[i-1].y;
    return acc + Math.sqrt(dx*dx + dy*dy);
  }, 0);
  const segmentLength = totalLength / (n - 1);
  let result = [];
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
  updatePreview();
  draw();
  saveSession();
});
