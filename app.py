import streamlit as st

st.set_page_config(page_title="Graph Digitizer Pro", layout="wide")

# Load CSS and JS modules from files
try:
    with open("styles.css", "r") as f:
        css = f.read()
    with open("digitizer-core.js", "r") as f:
        core_js = f.read()
    with open("digitizer-tools.js", "r") as f:
        tools_js = f.read()
except FileNotFoundError as e:
    st.error(f"Error: Missing file {e.filename}. Ensure styles.css, digitizer-core.js, and digitizer-tools.js are in the same directory as app.py.")
    st.stop()

# HTML content embedding CSS and both JS modules
# FIX #14: body uses height:100vh which resolves to the iframe viewport (820px).
#           The controls panel has overflow-y:auto so it scrolls within that height.
#           We set scrolling=False on the Streamlit component because internal
#           scrolling is handled by #controls itself — the outer iframe scroll
#           would fight with it and cause double-scrollbars.
html_content = f"""
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Graph Digitizer Pro</title>
  <style>{css}</style>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
</head>
<body>
  <div id="container">
    <div id="canvas-container">
      <canvas id="canvas"></canvas>
      <canvas id="magnifier" width="120" height="120"></canvas>
      <div id="status-bar"></div>
    </div>
    <div id="controls" aria-label="Controls Panel">
      <h3>Graph Digitizer Pro</h3>
      <input type="file" id="image-upload" accept="image/*" title="Upload graph image">

      <details open>
        <summary>View</summary>
        <button id="zoom-in" title="Zoom In (+)">Zoom In</button>
        <button id="zoom-out" title="Zoom Out (-)">Zoom Out</button>
        <button id="reset-view" title="Reset View (0)">Reset View</button>
        <button id="pan-mode" title="Toggle Pan Mode">Toggle Pan</button>
        <button id="toggle-theme" title="Toggle Dark/Light Mode">Toggle Dark Mode</button>
        <p>Magnifier Zoom:
          <input type="range" id="magnifier-zoom" min="1" max="10" step="0.5" value="2">
        </p>
      </details>

      <details open>
        <summary>✨ Image Enhancements</summary>
        <p class="slider-row">
          <label>Brightness: <span id="brightness-val">100%</span></label>
          <input type="range" id="brightness-slider" min="10" max="300" value="100" title="Adjust image brightness">
        </p>
        <p class="slider-row">
          <label>Contrast: <span id="contrast-val">100%</span></label>
          <input type="range" id="contrast-slider" min="10" max="400" value="100" title="Adjust image contrast">
        </p>
        <p class="checkbox-container">
          <input type="checkbox" id="grid-filter-toggle" title="Suppress background grid lines using blend filter">
          <label for="grid-filter-toggle">Grid Filter (suppress grids)</label>
        </p>
        <p class="checkbox-container">
          <input type="checkbox" id="snap-toggle" title="Snap placed points to nearest dark pixel within a small radius">
          <label for="snap-toggle">🧲 Snap to Dark Pixel (Magnet)</label>
        </p>
      </details>

      <details open>
        <summary>Calibration</summary>
        <p id="axis-instruction">Click "Set Axis Points" then enter values.</p>
        <button id="set-axes" title="Start axis calibration">Set Axis Points</button>
        <button id="reset-axis-points" title="Reset axis points">Reset Axis Points</button>
        <div id="axis-inputs">
          <p class="checkbox-container">
            <input type="checkbox" id="shared-origin">
            <label for="shared-origin">Shared Origin (X1/Y1)</label>
          </p>
          <p class="checkbox-container">
            <input type="checkbox" id="orthogonal-axes">
            <label for="orthogonal-axes">Orthogonal Axes</label>
          </p>
          <!-- FIX #1: proper <label for> elements so updateAxisLabels() works -->
          <p><label for="x1-value">X1:</label> <input type="number" id="x1-value" step="any"></p>
          <p><label for="x2-value">X2:</label> <input type="number" id="x2-value" step="any"></p>
          <p><label for="y1-value">Y1:</label> <input type="number" id="y1-value" step="any"></p>
          <p><label for="y2-value">Y2:</label> <input type="number" id="y2-value" step="any"></p>
          <button id="calibrate" disabled>Calibrate</button>
        </div>
        <button id="reset-calibration">Reset Calibration</button>
        <button id="toggle-grid">Toggle Grid</button>
        <button id="toggle-log-x">Toggle Log Scale (X)</button>
        <button id="toggle-log-y">Toggle Log Scale (Y)</button>
      </details>

      <details open>
        <summary>Point Actions</summary>
        <button id="add-point" disabled>Add Point</button>
        <button id="adjust-point" disabled>Adjust Point</button>
        <button id="delete-point" disabled>Delete Point</button>
        <button id="highlight-line" class="holographic" disabled>Highlight Line</button>
        <div id="highlight-controls">
          <p>Line Name: <input type="text" id="highlight-line-name" placeholder="Enter line name"></p>
          <p>Points (n): <input type="number" id="n-points" value="20" min="2"></p>
          <p>Brush Width: <input type="range" id="highlight-width" min="1" max="20" value="3"></p>
          <p class="checkbox-container">
            <input type="checkbox" id="auto-trace-toggle" checked>
            <label for="auto-trace-toggle">🎯 Auto-Trace (color snap)</label>
          </p>
          <button id="delete-highlight">Delete Highlight</button>
        </div>
        <button id="clear-points" disabled>Clear Points</button>
        <button id="sort-points" disabled>Sort Points (X)</button>
      </details>

      <details open>
        <summary>Line Management</summary>
        <button id="new-line" disabled>New Line</button>
        <button id="rename-line" disabled>Rename Line</button>
        <select id="line-select"></select>
      </details>

      <details open>
        <summary>Data</summary>
        <input type="file" id="import-json-input" accept=".json" style="display: none;">
        <button id="import-json">Import JSON</button>
        <button id="export-json">Export JSON</button>
        <button id="export-csv">Export CSV</button>
        <button id="export-xlsx">Export XLSX</button>
        <button id="export-image">Export Image</button>
        <button id="clear-session">Clear Session</button>
      </details>

      <details>
        <summary>Preview Data</summary>
        <div style="max-height:200px;overflow-y:auto;">
          <table id="preview-table"></table>
        </div>
      </details>

      <details open>
        <summary>History</summary>
        <button id="undo" disabled>Undo</button>
        <button id="redo" disabled>Redo</button>
      </details>

      <details open>
        <summary>Points (current line)</summary>
        <div id="point-list"></div>
      </details>
    </div>
  </div>
  <div id="modal"><div id="modal-content"></div></div>
  <div id="spinner">Processing…</div>
  <!-- Core must load first: state, drawing, calibration, session -->
  <script>{core_js}</script>
  <!-- Tools: interactions, auto-trace, snap, export -->
  <script>{tools_js}</script>
</body>
</html>
"""

# Streamlit UI
st.title("Graph Digitizer Pro - Streamlit Edition")
st.markdown(
    "Upload a graph image using the control panel on the right, then digitize points by clicking on the canvas. "
    "Calibrate axes, add points, and export data as JSON, CSV, or XLSX."
)

# FIX #14: scrolling=False — the inner #controls div already has overflow-y:auto,
# so it handles its own scrolling within the 820 px iframe height.
# Enabling outer scrolling would produce a double-scrollbar conflict.
st.components.v1.html(html_content, height=820, scrolling=False)
