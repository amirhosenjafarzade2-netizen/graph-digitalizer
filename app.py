import streamlit as st
from PIL import Image, ImageEnhance, ImageOps, ImageFilter
import base64
import io

st.set_page_config(page_title="Graph Digitizer Pro", layout="wide")

# Initialize session state
if 'step' not in st.session_state:
    st.session_state.step = 1
if 'uploaded_image' not in st.session_state:
    st.session_state.uploaded_image = None
if 'processed_image' not in st.session_state:
    st.session_state.processed_image = None
if 'mode' not in st.session_state:
    st.session_state.mode = 'Manual'  # 'Manual' or 'Automatic'
if 'contrast' not in st.session_state:
    st.session_state.contrast = 100
if 'brightness' not in st.session_state:
    st.session_state.brightness = 100
if 'rotation' not in st.session_state:
    st.session_state.rotation = 0
if 'noise_reduction' not in st.session_state:
    st.session_state.noise_reduction = False
if 'edge_enhancement' not in st.session_state:
    st.session_state.edge_enhancement = False
if 'auto_rotation' not in st.session_state:
    st.session_state.auto_rotation = False
if 'grid_detection' not in st.session_state:
    st.session_state.grid_detection = False

# Load CSS and JS from files
try:
    with open("styles.css", "r") as f:
        css = f.read()
    with open("digitizer.js", "r") as f:
        js = f.read()
except FileNotFoundError as e:
    st.error(f"Error: Missing file {e.filename}. Ensure styles.css and digitizer.js are in the same directory as app.py.")
    st.stop()

# Progress bar with steps
steps = ["Upload Image", "Preprocessing", "Calibration", "Extract Data", "Export"]
col_steps = st.columns(len(steps))
for i, step_name in enumerate(steps):
    with col_steps[i]:
        if st.session_state.step == i + 1:
            st.button(step_name, type="primary", disabled=True)
        elif st.session_state.step > i + 1:
            st.button(step_name, on_click=lambda idx=i+1: st.session_state.update(step=idx))
        else:
            st.button(step_name, disabled=True)

# Main content based on step
if st.session_state.step == 1:
    st.header("Upload Your Graph")
    st.write("Drag and drop your graph image or click to browse. Supports JPG, PNG, PDF formats.")
    uploaded = st.file_uploader("Choose a graph image", type=["jpg", "jpeg", "png"])  # Add PDF support if needed
    if uploaded:
        st.session_state.uploaded_image = uploaded.read()
        st.session_state.processed_image = st.session_state.uploaded_image
        st.image(st.session_state.uploaded_image, caption="Uploaded Image")
        if st.button("Next Step", type="primary"):
            st.session_state.step = 2

elif st.session_state.step == 2:
    st.header("Image Preprocessing")
    left_col, right_col = st.columns([2, 1])
    with left_col:
        st.image(st.session_state.processed_image, caption="Processed Image")
    with right_col:
        st.subheader("Basic Adjustments")
        st.session_state.contrast = st.slider("Contrast", 0, 200, st.session_state.contrast)
        st.session_state.brightness = st.slider("Brightness", 0, 200, st.session_state.brightness)
        st.session_state.rotation = st.slider("Rotation", -180, 180, st.session_state.rotation, format="%d°")
        st.subheader("Advanced Processing")
        st.session_state.noise_reduction = st.checkbox("Noise Reduction")
        st.session_state.edge_enhancement = st.checkbox("Edge Enhancement")
        st.session_state.auto_rotation = st.checkbox("Auto Rotation")
        st.session_state.grid_detection = st.checkbox("Grid Detection")

    if st.button("Apply Changes", type="primary"):
        img = Image.open(io.BytesIO(st.session_state.uploaded_image))
        # Apply rotation
        img = img.rotate(st.session_state.rotation)
        # Contrast
        enhancer = ImageEnhance.Contrast(img)
        img = enhancer.enhance(st.session_state.contrast / 100.0)
        # Brightness
        enhancer = ImageEnhance.Brightness(img)
        img = enhancer.enhance(st.session_state.brightness / 100.0)
        # Noise reduction
        if st.session_state.noise_reduction:
            img = img.filter(ImageFilter.MEDIAN)
        # Edge enhancement
        if st.session_state.edge_enhancement:
            img = img.filter(ImageFilter.EDGE_ENHANCE)
        # Auto rotation: Placeholder, could use OpenCV for skew detection if installed
        # Grid detection: Placeholder
        buffer = io.BytesIO()
        img.save(buffer, format="PNG")
        st.session_state.processed_image = buffer.getvalue()
        st.rerun()

    if st.button("Reset to Original"):
        st.session_state.processed_image = st.session_state.uploaded_image
        st.session_state.contrast = 100
        st.session_state.brightness = 100
        st.session_state.rotation = 0
        st.session_state.noise_reduction = False
        st.session_state.edge_enhancement = False
        st.session_state.auto_rotation = False
        st.session_state.grid_detection = False
        st.rerun()

    if st.button("Auto Optimize"):
        # Placeholder for auto optimization logic
        pass

    col_back_next = st.columns(2)
    with col_back_next[0]:
        if st.button("Back"):
            st.session_state.step = 1
    with col_back_next[1]:
        if st.button("Next Step", type="primary"):
            st.session_state.step = 3

else:
    # For steps 3-5, render the canvas with processed image injected
    if st.session_state.processed_image:
        base64_img = base64.b64encode(st.session_state.processed_image).decode()
    else:
        base64_img = ""

    # HTML content with modifications: remove image-upload, inject base64, add currentStep
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
      <h3>Graph Digitizer Pro</h3>
      <!-- Removed image-upload input, image loaded via JS -->
      <details id="view-details" open>
        <summary>View</summary>
        <button id="zoom-in" title="Zoom In (+)">Zoom In</button>
        <button id="zoom-out" title="Zoom Out (-)">Zoom Out</button>
        <button id="reset-view" title="Reset View (0)">Reset View</button>
        <button id="pan-mode" title="Pan Mode">Toggle Pan</button>
        <button id="toggle-theme" title="Toggle Theme">Toggle Dark Mode</button>
        <p>Magnifier Zoom: <input type="range" id="magnifier-zoom" min="2" max="10" value="2" title="Adjust magnifier zoom level"></p>
      </details>
      <details id="calibration-details" open>
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
      <details id="point-actions-details" open>
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
      <details id="line-management-details" open>
        <summary>Line Management</summary>
        <button id="new-line" title="Create new line">New Line</button>
        <button id="rename-line" title="Rename current line">Rename Line</button>
        <select id="line-select" title="Select active line"></select>
      </details>
      <details id="data-details" open>
        <summary>Data</summary>
        <input type="file" id="import-json-input" accept=".json" style="display: none;">
        <button id="import-json" title="Import JSON data">Import JSON</button>
        <button id="export-json" title="Export JSON data">Export JSON</button>
        <button id="export-csv" title="Export CSV data">Export CSV</button>
        <button id="export-xlsx" title="Export XLSX data">Export XLSX</button>
        <button id="clear-session" title="Clear saved session">Clear Session</button>
        <button id="total-reset" title="Reset all calibration and data">Total Reset</button>
      </details>
      <details id="preview-details">
        <summary>Preview Data</summary>
        <table id="preview-table"></table>
      </details>
      <details id="history-details" open>
        <summary>History</summary>
        <button id="undo" title="Undo (Ctrl+Z)">Undo</button>
        <button id="redo" title="Redo (Ctrl+Y)">Redo</button>
      </details>
    </div>
  </div>
  <div id="modal"><div id="modal-content"></div></div>
  <div id="spinner">Processing...</div>
  <script>
    const currentStep = {st.session_state.step};
    const base64Image = "{base64_img}";
    {js}
  </script>
</body>
</html>
    """

    st.components.v1.html(html_content, height=800, scrolling=True)

    # Additional Streamlit controls for steps 3-5
    if st.session_state.step == 3:
        st.header("Axis Calibration")
        # Graph type selection as in picture
        graph_type = st.radio("Graph Type", ["Line Graph", "Bar Chart", "Scatter Plot"])
        # Other calibration info can be handled in JS
        col_back_next = st.columns(2)
        with col_back_next[0]:
            if st.button("Back"):
                st.session_state.step = 2
        with col_back_next[1]:
            if st.button("Next Step", type="primary"):
                st.session_state.step = 4

    elif st.session_state.step == 4:
        st.header("Data Extraction")
        st.session_state.mode = st.radio("Mode", ["Preview Mode", "Manual Mode", "Automatic Mode"])
        # Extracted data table (placeholder, sync with JS if possible)
        st.subheader("Extracted Data")
        # Could use st.dataframe, but for now assume JS handles preview
        st.subheader("Data Summary")
        # Placeholder metrics
        st.metric("Points Detected", "247")
        st.metric("Confidence", "98.5%")
        st.metric("Data Series", "1")
        st.subheader("Detection Settings")
        sensitivity = st.slider("Sensitivity", 0, 10, 5)
        point_threshold = st.slider("Point Threshold", 0, 255, 128)
        auto_connect = st.checkbox("Auto-connect points")
        remove_outliers = st.checkbox("Remove outliers")
        if st.button("Re-run Extraction"):
            # Placeholder for auto extraction logic
            pass
        col_back_next = st.columns(2)
        with col_back_next[0]:
            if st.button("Back"):
                st.session_state.step = 3
        with col_back_next[1]:
            if st.button("Next Step", type="primary"):
                st.session_state.step = 5

    elif st.session_state.step == 5:
        st.header("Export")
        st.success("Data Successfully Extracted!")
        # Download buttons (sync with JS exports if needed)
        if st.button("Download CSV"):
            # Placeholder
            pass
        if st.button("Download JSON"):
            pass
        if st.button("Download Excel"):
            pass
        st.subheader("Advanced Export Options")
        include_headers = st.checkbox("Include headers")
        round_values = st.checkbox("Round values")
        decimal_places = st.selectbox("Decimal places", [0, 1, 2, 3, 4])
        # Metadata
        dataset_name = st.text_input("Dataset name", "Enter dataset name")
        x_label = st.text_input("X-axis label", "e.g., Time (s)")
        y_label = st.text_input("Y-axis label", "e.g., Temperature (°C)")
        col_back_next = st.columns(2)
        with col_back_next[0]:
            if st.button("Back"):
                st.session_state.step = 4
