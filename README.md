Graph Digitizer Pro - User Guide
Overview
Graph Digitizer Pro is a web-based tool built with Streamlit, HTML, CSS, and JavaScript for digitizing data from graph images. Users can upload a graph image, calibrate its axes (including logarithmic scales), add or adjust data points, trace curves, manage multiple data lines, and export data as JSON, CSV, or XLSX. This guide explains how to use the app effectively.
Requirements

Browser: Modern browser (Chrome, Firefox recommended).
Python: Python 3.8+ with Streamlit (pip install streamlit).
Files Needed:
app.py (main script)
styles.css (styling)
digitizer.js (JavaScript logic)


Internet: Required for loading SheetJS (via CDN) for XLSX export.

Installation

Clone or download the repository:
git clone https://github.com/your-repo/graph-digitizer-pro.git
cd graph-digitizer-pro


Install Streamlit:
pip install streamlit


Ensure app.py, styles.css, and digitizer.js are in the project directory.

Run the app:
streamlit run app.py

The app opens at http://localhost:8501.


Using the App
1. Upload a Graph Image

In the right-hand control panel, click Upload graph image and select a JPEG, PNG, or similar file.
The image loads on the canvas. Wait for the "Processing..." spinner to disappear.

2. Calibrate Axes

Start Calibration:
Click Set Axis Points under the "Calibration" section.
Click four points on the canvas in order: X1 (left X-axis), X2 (right X-axis), Y1 (bottom Y-axis), Y2 (top Y-axis).
The status bar shows instructions (e.g., "Click point for X1").


Enter Values:
After selecting all four points, input their real-world values in the fields (X1, X2, Y1, Y2) under "Calibration".
Check Orthogonal Axes to enforce perpendicular axes (optional).


Apply Calibration:
Click Calibrate to lock the axis scaling.
Toggle Log Scale (X) or Log Scale (Y) for logarithmic axes if needed.


Reset: Use Reset Axis Points to reselect points or Reset Calibration to clear all calibration.

3. Digitize Data Points

Add Points:
Click Add Point under "Point Actions".
Click on the canvas to place points on the current line.


Adjust Points:
Click Adjust Point, then drag a point to reposition it.


Delete Points:
Click Delete Point, then click a point to remove it.


Trace Curves:
Click Highlight Line (holographic button).
Hold left-click and drag to trace a curve.
Adjust Line Name, Points (n) (number of interpolated points), and Brush Width in the highlight controls.
Click Delete Highlight to remove traced points.


Clear/Sort:
Clear Points: Remove all points in the current line.
Sort Points (X): Sort points by X-coordinate.



4. Manage Data Lines

Create Line: Click New Line, enter a unique name in the modal, and confirm.
Rename Line: Click Rename Line, enter a new name, and confirm.
Switch Lines: Use the dropdown under "Line Management" to select a line.
Each line is independent, with its own points and color.

5. View and Navigation

Zoom: Use Zoom In/Zoom Out buttons or mouse wheel.
Pan: Click Toggle Pan, then drag the canvas.
Reset View: Click Reset View to center the image.
Magnifier: Adjust Magnifier Zoom (slider, 2x–10x) for precise point placement.
Grid: Click Toggle Grid to show/hide a grid (post-calibration).
Dark Mode: Click Toggle Dark Mode for better contrast.

6. Data Preview and Export

Preview: Expand the "Preview Data" section to view a table of all points (X, Y) for each line.
Export:
JSON: Click Export JSON to save the full app state (lines, axes, settings).
CSV: Click Export CSV for a text file with X, Y data per line.
XLSX: Click Export XLSX for an Excel file with one sheet per line.


Import: Click Import JSON to load a previously saved state.

7. Undo/Redo and Session

Undo/Redo: Click Undo (Ctrl+Z) or Redo (Ctrl+Y) to revert or reapply actions.
Clear Session: Click Clear Session to reset local storage (keeps current image).
Total Reset: Click Total Reset to clear all data, including calibration.

Tips

Precision: Use the magnifier (appears on click) for accurate point placement.
Log Scales: Ensure axis values are positive for log scales to avoid errors.
Status Bar: Check the bottom bar for coordinates and mode feedback.
Shortcuts: Use P (Add Point), H (Highlight Line), 0 (Reset View), +/- (Zoom).

Troubleshooting

File Errors: Ensure styles.css and digitizer.js are in the same directory as app.py. Check Streamlit logs if the app fails to load.
Image Issues: Use high-resolution images; low-quality images may affect accuracy.
Export Failures: Ensure your browser allows downloads. For XLSX, verify internet access for SheetJS CDN.
Calibration Errors: Avoid collinear axis points. Reset and retry if calibration fails.

For issues, check browser console logs (F12) or contact the developer.
