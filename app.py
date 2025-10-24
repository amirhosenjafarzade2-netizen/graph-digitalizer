# app.py
import streamlit as st

st.set_page_config(page_title="Graph Digitizer Pro", layout="wide")

# Load CSS
try:
    with open("styles.css", "r") as f:
        css = f.read()
except FileNotFoundError:
    st.error("Missing styles.css")
    st.stop()

# Load JS modules (we'll inline them in html_content)
# Note: Streamlit cannot load ES modules directly, so we inline all JS

js_modules = """
<!-- digitizer.js (main entry) -->
<script type="module">
import { state } from './digitizer.js';
import { initUI, bindButtons, updateButtonStates, updatePreview, updateLineSelect, setMode } 
    from './modules/ui.js';
import { initCanvas, draw, getCanvasCoords, flashCenter } 
    from './modules/canvas.js';
import { initCalibration, handleAxisClick, calibrate, resetCalibration, toggleLogX, toggleLogY } 
    from './modules/calibration.js';
import { initPoints, handlePointClick, startHighlight, moveHighlight, endHighlight, 
         deleteHighlight, clearCurrentLine, sortCurrentLine } 
    from './modules/points.js';
import { initIO, exportJson, exportCsv, exportXlsx, importJson } 
    from './modules/io.js';
import { initHistory, saveState, undo, redo } 
    from './modules/history.js';
import { loadSession, saveSession } from './modules/session.js';
import { initColorDetect, findLineCenter, hexToRgb, rgbToHex } 
    from './modules/color-detect.js';
import { debounce, showModal, showSpinner } from './modules/utils.js';

// Global state
window.state = {
    canvas: null, ctx: null,
    magnifier: null, magCtx: null,
    img: new Image(),
    zoom: 1, panX: 0, panY: 0,
    isPanning: false, startPan: {x:0,y:0},
    axisPoints: [], isCalibrated: false,
    scaleX:0, scaleY:0, offsetX:0, offsetY:0,
    lines: [{name:'Line 1', points:[], sorted:false, orderCounter:0}],
    currentLineIndex: 0,
    mode: 'none',
    selectedPointIndex: -1,
    showGrid: false,
    logX: false, logY: false,
    highlightPath: [], isHighlighting: false,
    isDraggingPoint: false,
    highlightWidth: 2,
    magnifierZoom: 2,
    autoCenter: false,
    bgColor: {r:255,g:255,b:255},
    lineColor: {r:0,g:0,b:0},
    colorTolerance: 30,
    searchRadius: 20,
    history: [], historyIndex: -1
};

// DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
    const s = window.state;
    s.canvas = document.getElementById('canvas');
    s.ctx = s.canvas.getContext('2d');
    s.magnifier = document.getElementById('magnifier');
    s.magCtx = s.magnifier.getContext('2d');

    loadSession();
    initUI();
    initCanvas();
    initCalibration();
    initPoints();
    initIO();
    initHistory();
    initColorDetect();
    bindButtons();
    draw();
});
</script>
"""

# Full HTML with embedded modules
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
      <div id="status-bar"></div>
    </div>
    <div id="controls">
      <h3>Graph Digitizer Pro</h3>
      <input type="file" id="image-upload" accept="image/*">
      <details open><summary>View</summary>
        <button id="zoom-in">Zoom In</button>
        <button id="zoom-out">Zoom Out</button>
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
          <p class="checkbox-container"><input type="checkbox" id="orthogonal-axes"> Orthogonal Axes</p>
          <p class="checkbox-container"><input type="checkbox" id="auto-center"> Auto-Center on Line Color</p>
          <div id="color-detection-controls" style="display:none; margin-top:8px;">
            <p>Background Color: <input type="color" id="bg-color" value="#ffffff"></p>
            <p>Line Color: <input type="color" id="line-color" value="#000000"></p>
            <p>Tolerance: <input type="number" id="color-tolerance" min="0" max="255" value="30"></p>
            <p>Search Radius: <input type="number" id="search-radius" min="5" max="50" value="20"></p>
          </div>
          <p>X1: <input type="number" id="x1-value" step="any"></p>
          <p>X2: <input type="number" id="x2-value" step="any"></p>
          <p>Y1: <input type="number" id="y1-value" step="any"></p>
          <p>Y2: <input type="number" id="y2-value" step="any"></p>
          <button id="calibrate">Calibrate</button>
        </div>
        <button id="reset-calibration">Reset Calibration</button>
        <button id="toggle-grid">Toggle Grid</button>
        <button id="toggle-log-x">Toggle Log (X)</button>
        <button id="toggle-log-y">Toggle Log (Y)</button>
      </details>

      <details open><summary>Point Actions</summary>
        <button id="add-point">Add Point</button>
        <button id="adjust-point">Adjust Point</button>
        <button id="delete-point">Delete Point</button>
        <button id="highlight-line" class="holographic">Highlight Line</button>
        <div id="highlight-controls" style="display:none;">
          <p>Line Name: <input type="text" id="highlight-line-name" placeholder="Enter name"></p>
          <p>Points (n): <input type="number" id="n-points" value="5" min="1"></p>
          <p>Brush Width: <input type="range" id="highlight-width" min="1" max="10" value="2"></p>
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

      <details><summary>Preview Data</summary>
        <table id="preview-table"></table>
      </details>

      <details open><summary>History</summary>
        <button id="undo">Undo</button>
        <button id="redo">Redo</button>
      </details>
    </div>
  </div>
  <div id="modal"><div id="modal-content"></div></div>
  <div id="spinner">Processing...</div>

  <!-- Inline all JS modules -->
  {js_modules}
  <script type="module" src="./modules/ui.js"></script>
  <script type="module" src="./modules/canvas.js"></script>
  <script type="module" src="./modules/calibration.js"></script>
  <script type="module" src="./modules/points.js"></script>
  <script type="module" src="./modules/io.js"></script>
  <script type="module" src="./modules/history.js"></script>
  <script type="module" src="./modules/session.js"></script>
  <script type="module" src="./modules/color-detect.js"></script>
  <script type="module" src="./modules/utils.js"></script>
</body>
</html>
"""

st.title("Graph Digitizer Pro - Streamlit Edition")
st.markdown("Upload a graph image, calibrate axes, digitize points, and export data.")
st.components.v1.html(html_content, height=900, scrolling=True)
