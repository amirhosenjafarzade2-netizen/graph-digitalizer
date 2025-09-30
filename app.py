import streamlit as st

st.set_page_config(page_title="Graph Digitizer Pro", layout="wide")

# Load CSS and JS from files
try:
    with open("styles.css", "r") as f:
        css = f.read()
    with open("digitizer.js", "r") as f:
        js = f.read()
except FileNotFoundError as e:
    st.error(f"Error: Missing file {e.filename}. Ensure styles.css and digitizer.js are in the same directory as app.py.")
    st.stop()

# HTML content as a separate string for clarity
html_template = """
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Graph Digitizer Pro</title>
  <style>{css}</style>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" integrity="sha512-9usAa10IRO0HhonpyAIVpjrylPvoDwiPUiKdWk5t3PyolY1cOd4DSE0Ga+ri4AuTroPR5aQvXU9xC6qOPnzFeg==" crossorigin="anonymous">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
</head>
<body>
  <div id="container">
    <div id="canvas-container" role="region" aria-label="Graph Canvas">
      <button id="toggle-sidebar" class="sidebar-toggle" aria-label="Toggle controls panel" title="Toggle Controls">
        <i class="fas fa-bars"></i>
      </button>
      <canvas id="canvas" aria-label="Graph digitizing canvas"></canvas>
      <canvas id="magnifier" width="100" height="100" aria-hidden="true"></canvas>
      <div id="status-bar" aria-live="polite">Mode: None</div>
    </div>
    <div id="controls" role="complementary" aria-label="Controls Panel">
      <h3>Graph Digitizer Pro</h3>
      <input type="file" id="image-upload" accept="image/*" title="Upload graph image" aria-label="Upload graph image">
      
      <details open>
        <summary>View</summary>
        <div class="button-group">
          <button id="zoom-in" title="Zoom In (Ctrl +)" aria-label="Zoom In">
            <i class="fas fa-search-plus"></i> Zoom In
          </button>
          <button id="zoom-out" title="Zoom Out (Ctrl -)" aria-label="Zoom Out">
            <i class="fas fa-search-minus"></i> Zoom Out
          </button>
          <button id="reset-view" title="Reset View (0)" aria-label="Reset View">
            <i class="fas fa-sync"></i> Reset
          </button>
        </div>
        <button id="pan-mode" title="Toggle Pan Mode (Space)" aria-label="Toggle Pan Mode">
          <i class="fas fa-hand-paper"></i> Toggle Pan
        </button>
        <button id="toggle-theme" title="Toggle Dark/Light Mode" aria-label="Toggle Theme">
          <i class="fas fa-moon"></i> Toggle Theme
        </button>
        <label for="magnifier-zoom">Magnifier Zoom:</label>
        <input type="range" id="magnifier-zoom" min="2" max="10" value="2" title="Adjust magnifier zoom level" aria-label="Magnifier zoom level">
      </details>
      
      <details open>
        <summary>Calibration</summary>
        <p id="axis-instruction" aria-live="assertive">Click "Set Axis Points" then select points on the chart.</p>
        <div class="button-group">
          <button id="set-axes" title="Start axis calibration" aria-label="Set Axis Points">
            <i class="fas fa-ruler"></i> Set Axis
          </button>
          <button id="reset-axis-points" title="Reset axis points" aria-label="Reset Axis Points">
            <i class="fas fa-undo"></i> Reset Axis
          </button>
        </div>
        <div id="axis-inputs">
          <label class="checkbox-container">
            <input type="checkbox" id="shared-origin" title="Use same point for X1 and Y1" aria-label="Shared Origin for X1 and Y1">
            Shared Origin (X1/Y1)
          </label>
          <label class="checkbox-container">
            <input type="checkbox" id="orthogonal-axes" title="Force X2 and Y2 to be orthogonal to X1 and Y1" aria-label="Orthogonal Axes">
            Orthogonal Axes
          </label>
          <label for="x1-value">X1:</label>
          <input type="number" id="x1-value" step="0.01" placeholder="X1 value" title="Real-world X1 value" aria-label="X1 value">
          <label for="x2-value">X2:</label>
          <input type="number" id="x2-value" step="0.01" placeholder="X2 value" title="Real-world X2 value" aria-label="X2 value">
          <label for="y1-value">Y1:</label>
          <input type="number" id="y1-value" step="0.01" placeholder="Y1 value" title="Real-world Y1 value" aria-label="Y1 value">
          <label for="y2-value">Y2:</label>
          <input type="number" id="y2-value" step="0.01" placeholder="Y2 value" title="Real-world Y2 value" aria-label="Y2 value">
          <button id="calibrate" title="Apply calibration" aria-label="Apply Calibration">
            <i class="fas fa-check"></i> Calibrate
          </button>
        </div>
        <button id="reset-calibration" title="Clear calibration" aria-label="Reset Calibration">
          <i class="fas fa-times"></i> Reset Calibration
        </button>
        <button id="toggle-grid" title="Show/hide grid" aria-label="Toggle Grid">
          <i class="fas fa-th"></i> Toggle Grid
        </button>
        <button id="toggle-log-x" title="Toggle X-axis log scale" aria-label="Toggle X Log Scale">
          <i class="fas fa-superscript"></i> Log Scale (X)
        </button>
        <button id="toggle-log-y" title="Toggle Y-axis log scale" aria-label="Toggle Y Log Scale">
          <i class="fas fa-superscript"></i> Log Scale (Y)
        </button>
      </details>
      
      <details>
        <summary>Point Actions</summary>
        <div class="button-group">
          <button id="add-point" title="Add points (P)" aria-label="Add Point">
            <i class="fas fa-plus"></i> Add Point
          </button>
          <button id="adjust-point" title="Reposition a point" aria-label="Adjust Point">
            <i class="fas fa-arrows-alt"></i> Adjust Point
          </button>
          <button id="delete-point" title="Delete a point" aria-label="Delete Point">
            <i class="fas fa-trash"></i> Delete Point
          </button>
        </div>
        <button id="highlight-line" class="holographic" title="Trace a curve (H)" aria-label="Highlight Line">
          <i class="fas fa-pen"></i> Highlight Line
        </button>
        <div id="highlight-controls">
          <label for="highlight-line-name">Line Name:</label>
          <input type="text" id="highlight-line-name" placeholder="Enter line name" title="Name for highlighted line" aria-label="Highlighted line name">
          <label for="n-points">Points (n):</label>
          <input type="number" id="n-points" value="5" min="1" title="Number of points to interpolate" aria-label="Number of points to interpolate">
          <label for="highlight-width">Brush Width:</label>
          <input type="range" id="highlight-width" min="1" max="10" value="2" title="Adjust highlight brush width" aria-label="Highlight brush width">
          <button id="delete-highlight" title="Delete highlighted points" aria-label="Delete Highlighted Points">
            <i class="fas fa-eraser"></i> Delete Highlight
          </button>
        </div>
        <button id="clear-points" title="Clear all points in current line" aria-label="Clear Points">
          <i class="fas fa-trash-alt"></i> Clear Points
        </button>
        <button id="sort-points" title="Sort points by X" aria-label="Sort Points by X">
          <i class="fas fa-sort-numeric-up"></i> Sort Points (X)
        </button>
      </details>
      
      <details>
        <summary>Line Management</summary>
        <div class="button-group">
          <button id="new-line" title="Create new line" aria-label="Create New Line">
            <i class="fas fa-plus-circle"></i> New Line
          </button>
          <button id="rename-line" title="Rename current line" aria-label="Rename Current Line">
            <i class="fas fa-edit"></i> Rename Line
          </button>
        </div>
        <label for="line-select">Active Line:</label>
        <select id="line-select" title="Select active line" aria-label="Select active line"></select>
      </details>
      
      <details>
        <summary>Data</summary>
        <input type="file" id="import-json-input" accept=".json" style="display: none;" aria-label="Import JSON file">
        <div class="button-group">
          <button id="import-json" title="Import JSON data" aria-label="Import JSON Data">
            <i class="fas fa-file-import"></i> Import JSON
          </button>
          <button id="export-json" title="Export JSON data" aria-label="Export JSON Data">
            <i class="fas fa-file-export"></i> Export JSON
          </button>
          <button id="export-csv" title="Export CSV data" aria-label="Export CSV Data">
            <i class="fas fa-file-csv"></i> Export CSV
          </button>
          <button id="export-xlsx" title="Export XLSX data" aria-label="Export XLSX Data">
            <i class="fas fa-file-excel"></i> Export XLSX
          </button>
        </div>
        <button id="clear-session" title="Clear all calibration and data" aria-label="Clear Session">
          <i class="fas fa-trash-restore"></i> Clear Session
        </button>
      </details>
      
      <details>
        <summary>Preview Data</summary>
        <table id="preview-table" aria-label="Preview of digitized data"></table>
      </details>
      
      <details>
        <summary>History</summary>
        <div class="button-group">
          <button id="undo" title="Undo (Ctrl+Z)" aria-label="Undo Action">
            <i class="fas fa-undo"></i> Undo
          </button>
          <button id="redo" title="Redo (Ctrl+Y)" aria-label="Redo Action">
            <i class="fas fa-redo"></i> Redo
          </button>
        </div>
      </details>
    </div>
  </div>
  <div id="modal" role="dialog" aria-labelledby="modal-content">
    <div id="modal-content"></div>
  </div>
  <div id="spinner" aria-live="assertive">Processing...</div>
  <script>{js}</script>
</body>
</html>
"""

# Format the HTML content with CSS and JS
try:
    html_content = html_template.format(css=css, js=js)
except Exception as e:
    st.error(f"Error formatting HTML content: {str(e)}")
    st.stop()

# Streamlit UI
st.title("Graph Digitizer Pro - Streamlit Edition")
st.markdown("Upload a graph image, calibrate axes, digitize points by clicking on the canvas, and export data as JSON, CSV, or XLSX. Use the sidebar toggle on smaller screens for easier navigation.")
st.components.v1.html(html_content, height=900, scrolling=True)
