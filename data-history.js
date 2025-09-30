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
      const dataX = isNaN(p.dataX) || !isFinite(p.dataX) ? 'NaN' : p.dataX.toFixed(15);
      const dataY = isNaN(p.dataY) || !isFinite(p.dataY) ? 'NaN' : p.dataY.toFixed(15);
      row.innerHTML = `<td>${dataX}</td><td>${dataY}</td>`;
      previewTable.appendChild(row);
    });
  });
}

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
        magnifierZoom = state.magnifierZoom || 2;
        history = [];
        historyIndex = -1;
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
  download('graph.json', JSON.stringify({ lines, axisPoints, scaleX, scaleY, offsetX, offsetY, logX, logY, isCalibrated, zoom, panX, panY, showGrid, mode, currentLineIndex, magnifierZoom }), 'application/json');
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
  try {
    const workbook = XLSX.utils.book_new();
    lines.forEach(line => {
      if (line.points.length === 0) return; // Skip empty lines
      const sortedPoints = [...line.points].sort((a, b) => a.dataX - b.dataX);
      const data = sortedPoints.map(p => {
        const dataX = isNaN(p.dataX) || !isFinite(p.dataX) ? 'NaN' : Number(p.dataX.toFixed(15));
        const dataY = isNaN(p.dataY) || !isFinite(p.dataY) ? 'NaN' : Number(p.dataY.toFixed(15));
        return [dataX, dataY];
      });
      data.unshift(['X', 'Y']); // Header
      const worksheet = XLSX.utils.aoa_to_sheet(data);
      const safeName = line.name.substring(0, 31).replace(/[\\[\]*/?:]/g, '_'); // Sanitize sheet name
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

clearSessionBtn.addEventListener('click', () => {
  localStorage.removeItem('digitizerState');
  showModal('Session cleared.');
});

totalResetBtn.addEventListener('click', () => {
  lines = [{ name: 'Line 1', points: [] }];
  currentLineIndex = 0;
  axisPoints = [];
  isCalibrated = false;
  scaleX = scaleY = offsetX = offsetY = null;
  zoom = 1;
  panX = 0;
  panY = 0;
  showGrid = false;
  logX = false;
  logY = false;
  mode = 'none';
  history = [];
  historyIndex = -1;
  magnifierZoom = 2;
  highlightPath = [];
  updateLineSelect();
  updatePreview();
  updateButtonStates();
  toggleLogXBtn.classList.toggle('log-active', logX);
  toggleLogYBtn.classList.toggle('log-active', logY);
  document.getElementById('magnifier-zoom').value = magnifierZoom;
  addPointBtn.disabled = true;
  adjustPointBtn.disabled = true;
  deletePointBtn.disabled = true;
  highlightLineBtn.disabled = true;
  clearPointsBtn.disabled = true;
  sortPointsBtn.disabled = true;
  newLineBtn.disabled = true;
  renameLineBtn.disabled = true;
  axisInputs.style.display = 'none';
  axisInstruction.textContent = 'Click "Set Axis Points" then enter values.';
  draw();
  saveState();
  saveSession();
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
    magnifierZoom = state.magnifierZoom;
    toggleLogXBtn.classList.toggle('log-active', logX);
    toggleLogYBtn.classList.toggle('log-active', logY);
    document.getElementById('magnifier-zoom').value = magnifierZoom;
    updateLineSelect();
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
    axisInstruction.textContent = isCalibrated ? 'Calibration complete. Select a mode to digitize.' : axisPoints.length < (sharedOrigin.checked ? 3 : 4) ? `Click point for ${axisLabels[axisPoints.length]} on the chart.` : 'Enter axis values and click Calibrate.';
    calibrateBtn.disabled = axisPoints.length !== (sharedOrigin.checked ? 3 : 4);
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
    magnifierZoom = state.magnifierZoom;
    toggleLogXBtn.classList.toggle('log-active', logX);
    toggleLogYBtn.classList.toggle('log-active', logY);
    document.getElementById('magnifier-zoom').value = magnifierZoom;
    updateLineSelect();
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
    axisInstruction.textContent = isCalibrated ? 'Calibration complete. Select a mode to digitize.' : axisPoints.length < (sharedOrigin.checked ? 3 : 4) ? `Click point for ${axisLabels[axisPoints.length]} on the chart.` : 'Enter axis values and click Calibrate.';
    calibrateBtn.disabled = axisPoints.length !== (sharedOrigin.checked ? 3 : 4);
    draw();
    saveSession();
  }
  undoBtn.disabled = historyIndex <= 0;
  redoBtn.disabled = historyIndex >= history.length - 1;
});
