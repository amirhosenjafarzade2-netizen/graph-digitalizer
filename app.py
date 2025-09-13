import streamlit as st
import base64

st.set_page_config(page_title="Graph Digitizer Pro", layout="wide")

# Load CSS and JS from files (or inline for simplicity)
with open("styles.css", "r") as f:
    css = f.read()
with open("digitizer.js", "r") as f:
    js = f.read()

# HTML content embedding CSS and JS
html_content = f"""
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Graph Digitizer Pro</title>
  <style>{css}</style>
</head>
<body>
  <div id="container">
    <div id="canvas-container">
      <canvas id="canvas"></canvas>
      <canvas id="magnifier" width="100" height="100"></canvas>
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
        <button id="pan-mode" title="Pan Mode">Toggle Pan</button>
        <button id="toggle-theme" title="Toggle Theme">Toggle Dark Mode</button>
      </details>
      <details open>
        <summary>Calibration</summary>
        <p id="axis-instruction">Click "Set Axis Points" then enter values.</p>
        <button id="set-axes" title="Start axis calibration">Set Axis Points</button>
        <button id="reset-axis-points" title="Reset axis points">Reset Axis Points</button>
        <div id="axis-inputs">
          <p><input type="checkbox" id="orthogonal-axes" title="Force X2 and Y2 to be orthogonal to X1 and Y1"> Orthogonal Axes</p>
          <p>X1: <input type="number" id="x1-value" step="any" title="Real-world X1 value"></p>
          <p>X2: <input type="number" id="x2-value" step="any" title="Real-world X2 value"></p>
          <p>Y1: <input type="number" id="y1-value" step="any" title="Real-world Y1 value"></p>
          <p>Y2: <input type="number" id="y2-value" step="any" title="Real-world Y2 value"></p>
          <button id="calibrate" title="Apply calibration">Calibrate</button>
        </div>
        <button id="reset-calibration" title="Clear calibration">Reset Calibration</button>
        <button id="toggle-grid" title="Show/hide grid">Toggle Grid</button>
        <button id="toggle-log-x" title="Toggle X-axis log scale">Toggle Log Scale (X)</button>
        <button id="toggle-log-y" title="Toggle Y-axis log scale">Toggle Log Scale (Y)</button>
      </details>
      <details open>
        <summary>Point Actions</summary>
        <button id="add-point" title="Click to add points (P)">Add Point</button>
        <button id="adjust-point" title="Click and drag to reposition a point">Adjust Point</button>
        <button id="delete-point" title="Click to delete a point">Delete Point</button>
        <button id="highlight-line" class="holographic" title="Hold left click to trace a curve (H)">Highlight Line</button>
        <div id="highlight-controls">
          <p>Line Name: <input type="text" id="highlight-line-name" placeholder="Enter line name" title="Name for highlighted line"></p>
          <p>Points (n): <input type="number" id="n-points" value="5" min="1" title="Number of points to interpolate"></p>
          <button id="delete-highlight" title="Delete highlighted points">Delete Highlight</button>
        </div>
        <button id="clear-points" title="Clear all points in current line">Clear Points</button>
        <button id="sort-points" title="Sort points by X">Sort Points (X)</button>
      </details>
      <details open>
        <summary>Line Management</summary>
        <button id="new-line" title="Create new line">New Line</button>
        <button id="rename-line" title="Rename current line">Rename Line</button>
        <select id="line-select" title="Select active line"></select>
      </details>
      <details open>
        <summary>Data</summary>
        <input type="file" id="import-json-input" accept=".json" style="display: none;">
        <button id="import-json" title="Import JSON data">Import JSON</button>
        <button id="export-json" title="Export JSON data">Export JSON</button>
        <button id="export-csv" title="Export CSV data">Export CSV</button>
        <button id="export-image" title="Export canvas image">Export Image</button>
        <button id="clear-session" title="Clear saved session">Clear Session</button>
        <button id="total-reset" title="Reset all calibration and data">Total Reset</button>
      </details>
      <details>
        <summary>Preview Data</summary>
        <table id="preview-table"></table>
      </details>
      <details open>
        <summary>History</summary>
        <button id="undo" title="Undo (Ctrl+Z)">Undo</button>
        <button id="redo" title="Redo (Ctrl+Y)">Redo</button>
      </details>
      <details open>
        <summary>Points</summary>
        <div id="point-list"></div>
      </details>
    </div>
  </div>
  <div id="modal"><div id="modal-content"></div></div>
  <div id="spinner">Processing...</div>
  <script>{js}</script>
</body>
</html>
"""

# Streamlit UI
st.title("Graph Digitizer Pro - Streamlit Edition")
st.markdown("Upload a graph image and digitize points by clicking on the canvas. Calibrate axes, add points, and export data as JSON or CSV.")

# Optional image uploader
uploaded_image = st.file_uploader("Upload graph image (optional, overrides HTML upload)", type=["png", "jpg", "jpeg", "gif", "bmp"])
if uploaded_image:
    data_url = f"data:image/{uploaded_image.type.split('/')[-1]};base64,{base64.b64encode(uploaded_image.read()).decode()}"
    # Inject image into JS by adding a script to set img.src
    html_content = html_content.replace(
        '<script>',
        f'<script>document.addEventListener("DOMContentLoaded", () => {{ document.getElementById("canvas").getContext("2d").img = new Image(); document.getElementById("canvas").getContext("2d").img.src = "{data_url}"; }});'
    )

# Render HTML/JS app
st.components.v1.html(html_content, height=
