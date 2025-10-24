# app.py
import streamlit as st

st.set_page_config(page_title="Graph Digitizer Pro", layout="wide")

# --- Load CSS ---
try:
    with open("styles.css", "r") as f:
        css = f.read()
except FileNotFoundError:
    st.error("Missing styles.css")
    st.stop()

# --- FULL HTML + INLINE JS ---
html_content = f"""
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Graph Digitizer Pro</title>
  <style>{css}</style>
  <script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"></script>
</head>
<body>
  <div id="container">
    <div id="canvas-container">
      <canvas id="canvas"></canvas>
      <canvas id="magnifier" width="100" height="100"></canvas>
      <div id="status-bar">Ready</div>
    </div>
    <div id="controls">
      <h3>Graph Digitizer Pro</h3>
      <input type="file" id="image-upload" accept="image/*">

      <details open><summary>View</summary>
        <button id="zoom-in">Zoom In</button>
        <button id=" bzoom-out">Zoom Out</button>
        <button id="reset-view">Reset View</button>
        <button id="pan-mode">Toggle Pan</button>
        <button id="toggle-theme">Toggle Dark Mode</button>
        <p>Magnifier Zoom: <input type="range" id="magnifier-zoom" min="2" max="10" value="2"></p>
      </details>

      <details open><summary>Calibration</summary>
        <p id="axis-instruction">Click "Set Axis Points" then enter values.</p>
        <button id="set-axes">Set Axis Points</button>
        <button id="reset-axis-points">Reset Axis Points</button>
        <div id="axis-inputs" style="display:none;">
          <p class="checkbox-container"><input type="checkbox" id="shared-origin"> Shared Origin (X1/Y1)</p>
          <p class="checkbox-container"><input type="checkbox" id="auto-center"> Auto-Center on Line Color</p>
          <div id="color-detection-controls" style="display:none; margin-top:8px;">
            <p>Background: <input type="color" id="bg-color" value="#ffffff"></p>
            <p>Line: <input type="color" id="line-color" value="#000000"></p>
            <p>Tolerance: <input type="number" id="color-tolerance" min="0" max="255" value="30"></p>
            <p>Radius: <input type="number" id="search-radius" min="5" max="50" value="20"></p>
          </div>
          <p>X1: <input type="number" id="x1-value" step="any"></p>
          <p>X2: <input type="number" id="x2-value" step="any"></p>
          <p>Y1: <input type="number" id="y1-value" step="any"></p>
          <p>Y2: <input type="number" id="y2-value" step="any"></p>
          <button id="calibrate">Calibrate</button>
        </div>
        <button id="reset-calibration">Reset Calibration</button>
        <button id="toggle-grid">Toggle Grid</button>
        <button id="toggle-log-x">Toggle Log (X)</button>
        <button id="toggle-log-y">Toggle Log (Y)</button>
      </details>

      <details open><summary>Point Actions</summary>
        <button id="add-point">Add Point</button>
        <button id="adjust-point">Adjust Point</button>
        <button id="delete-point">Delete Point</button>
        <button id="highlight-line" class="holographic">Highlight Line</button>
        <div id="highlight-controls" style="display:none;">
          <p>Points (n): <input type="number" id="n-points" value="5" min="1"></p>
          <button id="delete-highlight">Delete Highlight</button>
        </div>
        <button id="clear-points">Clear Points</button>
        <button id="sort-points">Sort Points (X)</button>
      </details>

      <details open><summary>Line Management</summary>
        <button id="new-line">New Line</button>
        <button id="rename-line">Rename Line</button>
        <select id="line-select"></select>
      </details>

      <details open><summary>Data</summary>
        <input type="file" id="import-json-input" accept=".json" style="display:none;">
        <button id="import-json">Import JSON</button>
        <button id="export-json">Export JSON</button>
        <button id="export-csv">Export CSV</button>
        <button id="export-xlsx">Export XLSX</button>
        <button id="clear-session">Clear Session</button>
      </details>

      <details><summary>Preview</summary>
        <table id="preview-table"><tr><td colspan="2">No data</td></tr></table>
      </details>

      <details open><summary>History</summary>
        <button id="undo">Undo</button>
        <button id="redo">Redo</button>
      </details>
    </div>
  </div>

  <div id="modal"><div id="modal-content"></div></div>
  <div id="spinner">Loading...</div>

  <!-- FULLY INLINED JAVASCRIPT -->
  <script type="module">
    // === GLOBAL STATE ===
    const state = {
      canvas: null, ctx: null,
      magnifier: null, magCtx: null,
      img: new Image(),
      zoom: 1, panX: 0, panY: 0,
      isPanning: false, startPan: {x:0, y:0},
      axisPoints: [], isCalibrated: false,
      scaleX:0, scaleY:0, offsetX:0, offsetY:0,
      lines: [{name:'Line 1', points:[], sorted:false, orderCounter:0}],
      currentLineIndex: 0,
      mode: 'none',
      showGrid: false,
      logX: false, logY: false,
      highlightPath: [], isHighlighting: false,
      magnifierZoom: 2,
      autoCenter: false,
      bgColor: {r:255,g:255,b:255},
      lineColor: {r:0,g:0,b:0},
      colorTolerance: 30,
      searchRadius: 20,
      history: [], historyIndex: -1
    };

    // === DOM REFERENCES ===
    const $ = (id) => document.getElementById(id);
    const ui = {
      canvas: $('canvas'), ctx: $('canvas').getContext('2d'),
      magnifier: $('magnifier'), magCtx: $('magnifier').getContext('2d'),
      imageUpload: $('image-upload'),
      setAxesBtn: $('set-axes'),
      resetAxisPointsBtn: $('reset-axis-points'),
      axisInputs: $('axis-inputs'),
      axisInstruction: $('axis-instruction'),
      calibrateBtn: $('calibrate'),
      resetCalibrationBtn: $('reset-calibration'),
      toggleGridBtn: $('toggle-grid'),
      toggleLogXBtn: $('toggle-log-x'),
      toggleLogYBtn: $('toggle-log-y'),
      addPointBtn: $('add-point'),
      adjustPointBtn: $('adjust-point'),
      deletePointBtn: $('delete-point'),
      highlightLineBtn: $('highlight-line'),
      highlightControls: $('highlight-controls'),
      nPointsInput: $('n-points'),
      deleteHighlightBtn: $('delete-highlight'),
      clearPointsBtn: $('clear-points'),
      sortPointsBtn: $('sort-points'),
      newLineBtn: $('new-line'),
      renameLineBtn: $('rename-line'),
      lineSelect: $('line-select'),
      importJsonBtn: $('import-json'),
      importJsonInput: $('import-json-input'),
      exportJsonBtn: $('export-json'),
      exportCsvBtn: $('export-csv'),
      exportXlsxBtn: $('export-xlsx'),
      clearSessionBtn: $('clear-session'),
      undoBtn: $('undo'),
      redoBtn: $('redo'),
      previewTable: $('preview-table'),
      statusBar: $('status-bar'),
      magnifierZoom: $('magnifier-zoom'),
      autoCenterChk: $('auto-center'),
      colorDetectCtrls: $('color-detection-controls'),
      bgColorInput: $('bg-color'),
      lineColorInput: $('line-color'),
      toleranceInput: $('color-tolerance'),
      radiusInput: $('search-radius')
    };

    // === UTILS ===
    const showModal = (msg) => {
      $('modal-content').innerHTML = `<p>${msg}</p><button onclick="this.closest('#modal').style.display='none'">OK</button>`;
      $('modal').style.display = 'flex';
    };
    const showSpinner = (on) => $('spinner').style.display = on ? 'block' : 'none';
    const debounce = (fn, wait) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), wait); }; };

    // === IMAGE LOAD ===
    ui.imageUpload.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        showSpinner(true);
        state.img.src = ev.target.result;
        state.img.onload = () => {
          const maxW = window.innerWidth * 0.75;
          const ratio = state.img.naturalHeight / state.img.naturalWidth;
          ui.canvas.width = Math.min(state.img.naturalWidth, maxW);
          ui.canvas.height = ui.canvas.width * ratio;
          state.zoom = 1; state.panX = 0; state.panY = 0;
          draw();
          ui.setAxesBtn.disabled = false;
          ui.resetAxisPointsBtn.disabled = false;
          saveSession();
          showSpinner(false);
        };
      };
      reader.readAsDataURL(file);
    };

    // === DRAW ===
    const draw = () => {
      const {ctx, canvas} = ui;
      ctx.clearRect(0,0,canvas.width,canvas.height);
      ctx.save();
      ctx.translate(state.panX, state.panY);
      ctx.scale(state.zoom, state.zoom);
      ctx.drawImage(state.img, 0, 0);
      ctx.restore();

      if (state.showGrid && state.isCalibrated) drawGrid();
      state.axisPoints.forEach((p,i) => drawPoint(p.x, p.y, 'red', 6));
      state.lines.forEach((line, i) => {
        const color = ['blue','green','red','purple','orange'][i%5];
        line.points.forEach(p => drawPoint(p.x, p.y, color, 4));
        if (line.points.length > 1) drawLine(line.points, color);
      });
      if (state.highlightPath.length > 1) drawLine(state.highlightPath, 'cyan', 2);
    };

    const drawPoint = (x,y,col,r) => {
      ui.ctx.fillStyle = col;
      ui.ctx.beginPath();
      ui.ctx.arc(x,y,r,0,Math.PI*2);
      ui.ctx.fill();
      ui.ctx.strokeStyle = 'white';
      ui.ctx.lineWidth = 1;
      ui.ctx.stroke();
    };

    const drawLine = (pts, col, w=1) => {
      if (pts.length < 2) return;
      ui.ctx.strokeStyle = col;
      ui.ctx.lineWidth = w;
      ui.ctx.beginPath();
      ui.ctx.moveTo(pts[0].x, pts[0].y);
      pts.forEach(p => ui.ctx.lineTo(p.x, p.y));
      ui.ctx.stroke();
    };

    const drawGrid = () => {
      ui.ctx.save();
      ui.ctx.translate(state.panX, state.panY);
      ui.ctx.scale(state.zoom, state.zoom);
      ui.ctx.strokeStyle = '#0004';
      ui.ctx.lineWidth = 1/state.zoom;
      for (let x=0; x<=ui.canvas.width; x+=ui.canvas.width/10) {
        ui.ctx.beginPath(); ui.ctx.moveTo(x,0); ui.ctx.lineTo(x,ui.canvas.height); ui.ctx.stroke();
      }
      for (let y=0; y<=ui.canvas.height; y+=ui.canvas.height/10) {
        ui.ctx.beginPath(); ui.ctx.moveTo(0,y); ui.ctx.lineTo(ui.canvas.width,y); ui.ctx.stroke();
      }
      ui.ctx.restore();
    };

    // === CANVAS COORDS ===
    const getCanvasCoords = (clientX, clientY) => {
      const rect = ui.canvas.getBoundingClientRect();
      return {
        x: (clientX - rect.left - state.panX) / state.zoom,
        y: (clientY - rect.top - state.panY) / state.zoom
      };
    };

    // === MAGNIFIER ===
    const showMagnifier = (e) => {
      const rect = ui.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      ui.magnifier.style.left = `${mx + 15}px`;
      ui.magnifier.style.top = `${my + 15}px`;
      ui.magnifier.style.display = 'block';
      const size = 100;
      const srcX = (mx - state.panX)/state.zoom - size/(2*state.magnifierZoom);
      const srcY = (my - state.panY)/state.zoom - size/(2*state.magnifierZoom);
      ui.magCtx.clearRect(0,0,size,size);
      ui.magCtx.drawImage(state.img, srcX, srcY, size/state.magnifierZoom, size/state.magnifierZoom, 0, 0, size, size);
    };

    // === CALIBRATION ===
    const calibrate = () => {
      const shared = $('shared-origin').checked;
      const needed = shared ? 3 : 4;
      if (state.axisPoints.length < needed) return showModal('Not enough points.');
      const x1 = parseFloat($('x1-value').value), x2 = parseFloat($('x2-value').value);
      const y1 = parseFloat($('y1-value').value), y2 = parseFloat($('y2-value').value);
      if ([x1,x2,y1,y2].some(v=>isNaN(v))) return showModal('Invalid values.');
      const p = state.axisPoints;
      state.scaleX = (x2 - x1) / (p[1].x - p[0].x);
      state.offsetX = x1 - state.scaleX * p[0].x;
      state.scaleY = (y2 - y1) / (p[shared ? 2 : 3].y - p[0].y);
      state.offsetY = y1 - state.scaleY * p[0].y;
      state.isCalibrated = true;
      ui.axisInputs.style.display = 'none';
      updateAxisInstruction();
      updateButtonStates();
      draw();
      saveState();
    };

    // === POINT HANDLING ===
    ui.canvas.addEventListener('mousedown', e => {
      if (state.isPanning) { state.startPan = {x: e.clientX - state.panX, y: e.clientY - state.panY}; return; }
      const {x,y} = getCanvasCoords(e.clientX, e.clientY);
      if (state.mode === 'axes') { state.axisPoints.push({x,y}); updateAxisInstruction(); draw(); saveSession(); return; }
      if (!state.isCalibrated) return;
      const line = state.lines[state.currentLineIndex];
      if (state.mode === 'add') {
        const p = {x, y, order: ++line.orderCounter};
        p.dataX = state.scaleX * x + state.offsetX;
        p.dataY = state.scaleY * y + state.offsetY;
        line.points.push(p);
      }
      updatePreview();
      draw();
      saveState();
    });

    // === BIND BUTTONS ===
    $('zoom-in').onclick = () => { state.zoom *= 1.2; draw(); saveSession(); };
    $('zoom-out').onclick = () => { state.zoom /= 1.2; draw(); saveSession(); };
    $('reset-view').onclick = () => { state.zoom = 1; state.panX = 0; state.panY = 0; draw(); saveSession(); };
    $('pan-mode').onclick = () => { state.isPanning = !state.isPanning; };
    $('toggle-theme').onclick = () => document.body.classList.toggle('dark');
    ui.magnifierZoom.oninput = (e) => { state.magnifierZoom = +e.target.value; draw(); saveSession(); };

    $('set-axes').onclick = () => setMode('axes');
    $('reset-axis-points').onclick = () => { state.axisPoints = []; updateAxisInstruction(); draw(); saveSession(); };
    $('calibrate').onclick = calibrate;
    $('reset-calibration').onclick = () => {
      if (!confirm('Reset calibration?')) return;
      state.axisPoints = []; state.isCalibrated = false;
      state.lines.forEach(l => l.points = []);
      updateAxisInstruction();
      updateButtonStates();
      draw();
      saveState();
    };
    $('toggle-grid').onclick = () => { state.showGrid = !state.showGrid; draw(); saveSession(); };
    $('toggle-log-x').onclick = () => { state.logX = !state.logX; $('toggle-log-x').classList.toggle('log-active', state.logX); draw(); saveSession(); };
    $('toggle-log-y').onclick = () => { state.logY = !state.logY; $('toggle-log-y').classList.toggle('log-active', state.logY); draw(); saveSession(); };

    $('add-point').onclick = () => setMode('add');
    $('adjust-point').onclick = () => setMode('adjust');
    $('delete-point').onclick = () => setMode('delete');
    $('highlight-line').onclick = () => setMode('highlight');
    $('clear-points').onclick = () => { state.lines[state.currentLineIndex].points = []; updatePreview(); draw(); saveState(); };
    $('sort-points').onclick = () => {
      const line = state.lines[state.currentLineIndex];
      line.sorted = !line.sorted;
      $('sort-points').classList.toggle('sort-active', line.sorted);
      updatePreview();
      draw();
      saveSession();
    };

    $('new-line').onclick = () => {
      const name = prompt('Line name:', `Line ${state.lines.length+1}`);
      if (name) {
        state.lines.push({name, points:[], sorted:false, orderCounter:0});
        state.currentLineIndex = state.lines.length-1;
        updateLineSelect();
        updatePreview();
        draw();
        saveSession();
      }
    };
    $('rename-line').onclick = () => {
      const line = state.lines[state.currentLineIndex];
      const name = prompt('Rename:', line.name);
      if (name) { line.name = name; updateLineSelect(); updatePreview(); draw(); saveSession(); }
    };
    $('line-select').onchange = () => {
      state.currentLineIndex = $('line-select').selectedIndex;
      updatePreview();
      $('sort-points').classList.toggle('sort-active', state.lines[state.currentLineIndex].sorted);
      draw();
      saveSession();
    };

    $('export-json').onclick = () => {
      const data = { lines: state.lines, axisPoints: state.axisPoints, scaleX: state.scaleX, scaleY: state.scaleY, offsetX: state.offsetX, offsetY: state.offsetY, isCalibrated: state.isCalibrated };
      const blob = new Blob([JSON.stringify(data)], {type: 'application/json'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'graph.json'; a.click();
    };

    $('clear-session').onclick = () => {
      if (confirm('Clear all?')) {
        localStorage.removeItem('digitizerState');
        location.reload();
      }
    };

    $('undo').onclick = undo;
    $('redo').onclick = redo;

    // === MODES ===
    const setMode = (mode) => {
      state.mode = mode;
      updateButtonStates();
      ui.highlightControls.style.display = mode === 'highlight' ? 'block' : 'none';
      ui.axisInputs.style.display = (mode === 'axes' && state.axisPoints.length > 0 && !state.isCalibrated) ? 'block' : 'none';
      updateAxisInstruction();
      draw();
      saveSession();
    };

    const updateButtonStates = () => {
      const cal = state.isCalibrated;
      $('add-point').classList.toggle('active', state.mode === 'add');
      $('add-point').disabled = !cal;
      $('adjust-point').disabled = !cal;
      $('delete-point').disabled = !cal;
      $('highlight-line').disabled = !cal;
    };

    const updateLineSelect = () => {
      const sel = $('line-select');
      sel.innerHTML = '';
      state.lines.forEach((l,i) => {
        const opt = new Option(l.name, i);
        if (i === state.currentLineIndex) opt.selected = true;
        sel.add(opt);
      });
    };

    const updatePreview = () => {
      const line = state.lines[state.currentLineIndex];
      const tbl = $('preview-table');
      tbl.innerHTML = '';
      if (!line.points.length) { tbl.innerHTML = '<tr><td colspan="2">No points</td></tr>'; return; }
      const sorted = line.sorted ? [...line.points].sort((a,b)=>a.dataX-b.dataX) : [...line.points].sort((a,b)=>a.order-b.order);
      tbl.innerHTML = '<tr><th>X</th><th>Y</th></tr>' + sorted.map(p => `<tr><td>${p.dataX.toFixed(6)}</td><td>${p.dataY.toFixed(6)}</td></tr>`).join('');
    };

    const updateAxisInstruction = () => {
      if (state.isCalibrated) {
        $('axis-instruction').textContent = 'Calibrated. Click Add Point.';
      } else {
        const needed = $('shared-origin').checked ? 3 : 4;
        $('axis-instruction').textContent = state.axisPoints.length < needed
          ? `Click point ${state.axisPoints.length + 1} on axis.`
          : 'Enter values and click Calibrate.';
      }
    };

    // === HISTORY ===
    const saveState = () => {
      state.history = state.history.slice(0, state.historyIndex + 1);
      state.history.push(JSON.parse(JSON.stringify({lines: state.lines, axisPoints: state.axisPoints, scaleX: state.scaleX, scaleY: state.scaleY, offsetX: state.offsetX, offsetY: state.offsetY, isCalibrated: state.isCalibrated})));
      state.historyIndex++;
    };
    const undo = () => { if (state.historyIndex > 0) { state.historyIndex--; restore(state.history[state.historyIndex]); } };
    const redo = () => { if (state.historyIndex < state.history.length-1) { state.historyIndex++; restore(state.history[state.historyIndex]); } };
    const restore = (s) => {
      Object.assign(state, s);
      updateLineSelect();
      updatePreview();
      updateButtonStates();
      updateAxisInstruction();
      draw();
    };

    // === SESSION ===
    const saveSession = () => localStorage.setItem('digitizerState', JSON.stringify(state));
    const loadSession = () => {
      const raw = localStorage.getItem('digitizerState');
      if (raw) {
        try {
          const s = JSON.parse(raw);
          Object.assign(state, s);
          if (state.img.src) state.img.onload = draw;
          updateLineSelect();
          updatePreview();
          updateButtonStates();
          updateAxisInstruction();
          draw();
        } catch(e) { console.error(e); }
      }
    };
    loadSession();

    // === INIT ===
    ui.canvas.addEventListener('mousemove', e => {
      if (state.isPanning && e.buttons === 1) {
        state.panX = e.clientX - state.startPan.x;
        state.panY = e.clientY - state.startPan.y;
        draw();
      }
      showMagnifier(e);
    });
    ui.canvas.addEventListener('mouseout', () => ui.magnifier.style.display = 'none');
    window.addEventListener('resize', debounce(() => { if (state.img.src) { const ratio = state.img.naturalHeight / state.img.naturalWidth; ui.canvas.width = Math.min(state.img.naturalWidth, window.innerWidth*0.75); ui.canvas.height = ui.canvas.width * ratio; draw(); } }, 200));

    updateLineSelect();
    updatePreview();
    updateButtonStates();
    updateAxisInstruction();
  </script>
</body>
</html>
"""

st.title("Graph Digitizer Pro")
st.components.v1.html(html_content, height=800, scrolling=True)
