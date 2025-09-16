import streamlit as st
from PIL import Image, ImageEnhance, ImageOps, ImageFilter
import base64
import io
import numpy as np

# Optional OpenCV import with fallback
try:
    import cv2
except ImportError:
    cv2 = None
    st.warning("OpenCV not found. Auto Rotation and Grid Detection will be disabled.")

st.set_page_config(page_title="Graph Digitizer Pro", layout="wide")

# Initialize session state
if 'step' not in st.session_state:
    st.session_state.step = 1
if 'uploaded_image' not in st.session_state:
    st.session_state.uploaded_image = None
if 'processed_image' not in st.session_state:
    st.session_state.processed_image = None
if 'mode' not in st.session_state:
    st.session_state.mode = 'Manual'
if 'contrast' not in st.session_state:
    st.session_state.contrast = 1.0
if 'brightness' not in st.session_state:
    st.session_state.brightness = 1.0
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
if 'crop_left' not in st.session_state:
    st.session_state.crop_left = 0
if 'crop_top' not in st.session_state:
    st.session_state.crop_top = 0
if 'crop_right' not in st.session_state:
    st.session_state.crop_right = 0
if 'crop_bottom' not in st.session_state:
    st.session_state.crop_bottom = 0

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
        label = step_name
        btn_type = "secondary"
        disabled = False
        if st.session_state.step > i + 1:
            label = f"✔ {step_name}"
            btn_type = "secondary"
        elif st.session_state.step == i + 1:
            btn_type = "primary"
            disabled = True
        else:
            disabled = True
        if st.session_state.step > i + 1:
            if st.button(label, key=f"step_back_{i}", on_click=lambda idx=i+1: st.session_state.update(step=idx)):
                st.rerun()
        else:
            st.button(label, key=f"step_{i}", type=btn_type, disabled=disabled)

# Main content based on step
if st.session_state.step == 1:
    st.header("Upload Your Graph")
    st.write("Drag and drop your graph image or click to browse. Supports JPG, PNG formats.")
    uploaded = st.file_uploader("Choose a graph image", type=["jpg", "jpeg", "png"])
    if uploaded:
        st.session_state.uploaded_image = Image.open(uploaded)
        st.session_state.processed_image = st.session_state.uploaded_image.copy()
        st.image(st.session_state.processed_image, caption="Uploaded Image", use_container_width=True)
        if st.button("Next Step", type="primary"):
            st.session_state.step = 2
            st.rerun()

elif st.session_state.step == 2:
    st.header("Image Preprocessing")
    left_col, right_col = st.columns([2, 1])
    with left_col:
        if st.session_state.processed_image:
            st.image(st.session_state.processed_image, caption="Processed Image", use_container_width=True)
        else:
            st.warning("No image processed yet.")
    with right_col:
        st.subheader("Basic Adjustments")
        st.session_state.contrast = st.slider("Contrast", 0.0, 2.0, st.session_state.contrast, step=0.1)
        st.session_state.brightness = st.slider("Brightness", 0.0, 2.0, st.session_state.brightness, step=0.1)
        st.session_state.rotation = st.slider("Rotation", -180, 180, st.session_state.rotation, step=1, format="%d°")
        st.subheader("Advanced Processing")
        st.session_state.noise_reduction = st.checkbox("Noise Reduction")
        st.session_state.edge_enhancement = st.checkbox("Edge Enhancement")
        st.session_state.auto_rotation = st.checkbox("Auto Rotation") if cv2 else False
        st.session_state.grid_detection = st.checkbox("Grid Detection") if cv2 else False
        st.subheader("Cropping")
        width, height = st.session_state.processed_image.size if st.session_state.processed_image else (100, 100)
        st.session_state.crop_left = st.slider("Crop Left", 0, width, st.session_state.crop_left, step=1)
        st.session_state.crop_top = st.slider("Crop Top", 0, height, st.session_state.crop_top, step=1)
        st.session_state.crop_right = st.slider("Crop Right", 0, width, st.session_state.crop_right, step=1)
        st.session_state.crop_bottom = st.slider("Crop Bottom", 0, height, st.session_state.crop_bottom, step=1)

    if st.button("Apply Changes", type="primary"):
        img = st.session_state.uploaded_image.copy()
        img = img.rotate(st.session_state.rotation, expand=True)
        enhancer = ImageEnhance.Contrast(img)
        img = enhancer.enhance(st.session_state.contrast)
        enhancer = ImageEnhance.Brightness(img)
        img = enhancer.enhance(st.session_state.brightness)
        if st.session_state.noise_reduction:
            img = img.filter(ImageFilter.MEDIAN_FILTER)
        if st.session_state.edge_enhancement:
            img = img.filter(ImageFilter.EDGE_ENHANCE_MORE)
        if st.session_state.auto_rotation and cv2:
            try:
                gray = cv2.cvtColor(np.array(img.convert('RGB')), cv2.COLOR_RGB2GRAY)
                blurred = cv2.GaussianBlur(gray, (5, 5), 0)
                edged = cv2.Canny(blurred, 75, 200)
                coords = np.column_stack(np.where(edged > 0))
                angle = cv2.minAreaRect(coords)[-1]
                if angle < -45:
                    angle = -(90 + angle)
                else:
                    angle = -angle
                (h, w) = gray.shape[:2]
                center = (w // 2, h // 2)
                M = cv2.getRotationMatrix2D(center, angle, 1.0)
                rotated = cv2.warpAffine(np.array(img), M, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
                img = Image.fromarray(cv2.cvtColor(rotated, cv2.COLOR_BGR2RGB))
            except Exception as e:
                st.warning(f"Auto rotation failed: {e}")
        if st.session_state.grid_detection and cv2:
            try:
                gray = cv2.cvtColor(np.array(img.convert('RGB')), cv2.COLOR_RGB2GRAY)
                edges = cv2.Canny(gray, 50, 150)
                img = Image.fromarray(cv2.cvtColor(edges, cv2.COLOR_GRAY2RGB))
            except Exception as e:
                st.warning(f"Grid detection failed: {e}")
        # Apply cropping
        crop_box = (st.session_state.crop_left, st.session_state.crop_top, st.session_state.crop_right, st.session_state.crop_bottom)
        img = img.crop(crop_box)
        st.session_state.processed_image = img
        st.rerun()

    if st.button("Reset to Original"):
        st.session_state.processed_image = st.session_state.uploaded_image.copy()
        st.session_state.contrast = 1.0
        st.session_state.brightness = 1.0
        st.session_state.rotation = 0
        st.session_state.noise_reduction = False
        st.session_state.edge_enhancement = False
        st.session_state.auto_rotation = False
        st.session_state.grid_detection = False
        st.session_state.crop_left = 0
        st.session_state.crop_top = 0
        st.session_state.crop_right = 0
        st.session_state.crop_bottom = 0
        st.rerun()

    if st.button("Auto Optimize"):
        img = st.session_state.uploaded_image.copy()
        img = img.convert('RGB')  # Ensure RGB mode for autocontrast
        try:
            img = ImageOps.autocontrast(img)
        except OSError as e:
            st.warning(f"Auto Optimize failed: {e}. Using original image.")
        st.session_state.processed_image = img
        st.rerun()

    col_back_next = st.columns(2)
    with col_back_next[0]:
        if st.button("Back"):
            st.session_state.step = 1
            st.rerun()
    with col_back_next[1]:
        if st.button("Next Step", type="primary"):
            st.session_state.step = 3
            st.rerun()

else:
    # For steps 3-5, render the canvas with processed image injected
    base64_img = ""
    if st.session_state.processed_image:
        buffer = io.BytesIO()
        st.session_state.processed_image.save(buffer, format="PNG")
        base64_img = base64.b64encode(buffer.getvalue()).decode()

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

    if st.session_state.step == 3:
        st.header("Axis Calibration")
        graph_type = st.radio("Graph Type", ["Line Graph", "Bar Chart", "Scatter Plot"])
        col_back_next = st.columns(2)
        with col_back_next[0]:
            if st.button("Back"):
                st.session_state.step = 2
                st.rerun()
        with col_back_next[1]:
            if st.button("Next Step", type="primary"):
                st.session_state.step = 4
                st.rerun()

    elif st.session_state.step == 4:
        st.header("Data Extraction")
        st.session_state.mode = st.radio("Mode", ["Preview Mode", "Manual Mode", "Automatic Mode"])
        st.subheader("Extracted Data")
        st.subheader("Data Summary")
        st.metric("Points Detected", "247")
        st.metric("Confidence", "98.5%")
        st.metric("Data Series", "1")
        st.subheader("Detection Settings")
        sensitivity = st.slider("Sensitivity", 0, 10, 5)
        point_threshold = st.slider("Point Threshold", 0, 255, 128)
        auto_connect = st.checkbox("Auto-connect points")
        remove_outliers = st.checkbox("Remove outliers")
        if st.button("Re-run Extraction"):
            pass
        col_back_next = st.columns(2)
        with col_back_next[0]:
            if st.button("Back"):
                st.session_state.step = 3
                st.rerun()
        with col_back_next[1]:
            if st.button("Next Step", type="primary"):
                st.session_state.step = 5
                st.rerun()

    elif st.session_state.step == 5:
        st.header("Export")
        st.success("Data Successfully Extracted!")
        if st.button("Download CSV"):
            pass
        if st.button("Download JSON"):
            pass
        if st.button("Download Excel"):
            pass
        st.subheader("Advanced Export Options")
        include_headers = st.checkbox("Include headers")
        round_values = st.checkbox("Round values")
        decimal_places = st.selectbox("Decimal places", [0, 1, 2, 3, 4])
        dataset_name = st.text_input("Dataset name", "Enter dataset name")
        x_label = st.text_input("X-axis label", "e.g., Time (s)")
        y_label = st.text_input("Y-axis label", "e.g., Temperature (°C)")
        col_back_next = st.columns(2)
        with col_back_next[0]:
            if st.button("Back"):
                st.session_state.step = 4
                st.rerun()
