import streamlit as st
import base64
import json
import math

st.set_page_config(page_title="Graph Digitizer Pro", layout="wide")

# Initialize session state
if 'digitizer_state' not in st.session_state:
    st.session_state.digitizer_state = {
        'lines': [{'name': 'Line 1', 'points': []}],
        'axisPoints': [],
        'scaleX': None,
        'scaleY': None,
        'offsetX': None,
        'offsetY': None,
        'logX': False,
        'logY': False,
        'isCalibrated': False,
        'zoom': 1,
        'panX': 0,
        'panY': 0,
        'showGrid': False,
        'mode': 'none',
        'currentLineIndex': 0,
        'magnifierZoom': 2,
        'history': [],
        'historyIndex': -1,
        'image_data': None
    }

# Load CSS
try:
    with open("styles.css", "r") as f:
        css = f.read()
except FileNotFoundError:
    st.error("Error: Missing styles.css. Ensure it is in the same directory as app.py.")
    st.stop()

# Load JS
try:
    with open("digitizer.js", "r") as f:
        js = f.read()
except FileNotFoundError:
    st.error("Error: Missing digitizer.js. Ensure it is in the same directory as app.py.")
    st.stop()

# Streamlit UI
st.title("Graph Digitizer Pro")
st.markdown("Upload a graph image, calibrate axes, digitize points, and export data as JSON or CSV.")

# File uploader
uploaded_file = st.file_uploader("Upload Graph Image", type=["jpg", "jpeg", "png"], key="image-upload")
if uploaded_file:
    try:
        image_bytes = uploaded_file.read()
        image_base64 = base64.b64encode(image_bytes).decode('utf-8')
        st.session_state.digitizer_state['image_data'] = f"data:image/{uploaded_file.type.split('/')[-1]};base64,{image_base64}"
        st.success("Image uploaded successfully!")
    except Exception as e:
        st.error(f"Failed to process image: {str(e)}. Please try a different image.")
        st.session_state.digitizer_state['image_data'] = None

# HTML content embedding CSS and JS
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
      <canvas id="magnifier" width="100" height="100"></canvas>
      <div id="status-bar"></div>
    </div>
    <div id="controls" aria-label="Controls Panel">
      <h3>Controls</h3>
      <details open>
        <summary>View</summary>
        <button id="zoom-in" title="Zoom In (+)">Zoom In</button>
        <button id="zoom-out" title="Zoom Out (-)">Zoom Out</button>
        <button id="reset-view" title="Reset View (0)">Reset View</button>
        <button id="pan-mode" title="Pan Mode">Toggle Pan</button>
        <button id="toggle-theme" title="Toggle Theme">Toggle Dark Mode</button>
        <p>Magnifier Zoom: <input type="range" id="magnifier-zoom" min="2" max="10" value="2" title="Adjust magnifier zoom level"></p>
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
          <p>Brush Width: <input type="range" id="highlight-width" min="1" max="10" value="2" title="Adjust highlight brush width"></p>
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
      <details>
        <summary>Preview Data</summary>
        <table id="preview-table"></table>
      </details>
      <details open>
        <summary>History</summary>
        <button id="undo" title="Undo (Ctrl+Z)">Undo</button>
        <button id="redo" title="Redo (Ctrl+Y)">Redo</button>
      </details>
    </div>
  </div>
  <div id="modal"><div id="modal-content"></div></div>
  <div id="spinner">Processing...</div>
  <script>
    // Pass session state to JavaScript
    const initialState = {json.dumps(st.session_state.digitizer_state)};
    {js}
  </script>
</body>
</html>
"""

# Export and session management buttons
col1, col2, col3 = st.columns(3)
with col1:
    if st.button("Export JSON"):
        st.download_button(
            label="Download JSON",
            data=json.dumps(st.session_state.digitizer_state),
            file_name="graph.json",
            mime="application/json"
        )
with col2:
    if st.button("Export CSV"):
        csv = ''
        for line in st.session_state.digitizer_state['lines']:
            csv += f'"{line["name"]}",\n'
            csv += 'X,Y\n'
            for p in line['points']:
                dataX = 'NaN' if not isinstance(p.get('dataX'), (int, float)) or not math.isfinite(p['dataX']) else round(p['dataX'], 15)
                dataY = 'NaN' if not isinstance(p.get('dataY'), (int, float)) or not math.isfinite(p['dataY']) else round(p['dataY'], 15)
                csv += f'{dataX},{dataY}\n'
            csv += '\n'
        st.download_button(
            label="Download CSV",
            data=csv,
            file_name="graph.csv",
            mime="text/csv"
        )
with col3:
    if st.button("Clear Session"):
        st.session_state.digitizer_state = {
            'lines': [{'name': 'Line 1', 'points': []}],
            'axisPoints': [],
            'scaleX': None,
            'scaleY': None,
            'offsetX': None,
            'offsetY': None,
            'logX': False,
            'logY': False,
            'isCalibrated': False,
            'zoom': 1,
            'panX': 0,
            'panY': 0,
            'showGrid': False,
            'mode': 'none',
            'currentLineIndex': 0,
            'magnifierZoom': 2,
            'history': [],
            'historyIndex': -1,
            'image_data': st.session_state.digitizer_state['image_data']
        }
        st.rerun()

# Render HTML/JS app
st.components.v1.html(html_content, height=800, scrolling=True)
