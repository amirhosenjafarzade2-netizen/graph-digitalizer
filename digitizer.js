// digitizer.js  (module entry point)
import { initUI, bindButtons, updateButtonStates, updatePreview, updateLineSelect }
    from './modules/ui.js';
import { initCanvas, draw, getCanvasCoords, flashCenter }
    from './modules/canvas.js';
import { initCalibration, handleAxisClick, calibrate, resetCalibration, toggleLogX, toggleLogY }
    from './modules/calibration.js';
import { initPoints, handlePointClick, startHighlight, moveHighlight, endHighlight,
         deleteHighlight, clearCurrentLine, sortCurrentLine, addPoint, adjustPoint, deletePoint }
    from './modules/points.js';
import { initIO, exportJson, exportCsv, exportXlsx }
    from './modules/io.js';
import { initHistory, saveState, undo, redo }
    from './modules/history.js';
import { loadSession, saveSession } from './modules/session.js';
import { initColorDetect, findLineCenter, hexToRgb, rgbToHex }
    from './modules/color-detect.js';
import { debounce } from './modules/utils.js';

// ---------------------------------------------------------------------
// Global state (shared across modules)
export const state = {
    canvas: null, ctx: null,
    magnifier: null, magCtx: null,
    img: new Image(),
    zoom: 1, panX: 0, panY: 0,
    isPanning: false, startPan: {x:0,y:0},
    axisPoints: [], isCalibrated: false,
    scaleX:0, scaleY:0, offsetX:0, offsetY:0,
    lines: [{name:'Line 1', points:[], sorted:false, orderCounter:0}],
    currentLineIndex: 0,
    mode: 'none',               // none, axes, add, adjust, delete, highlight
    selectedPointIndex: -1,
    showGrid: false,
    logX: false, logY: false,
    highlightPath: [], isHighlighting: false,
    isDraggingPoint: false,
    highlightWidth: 2,
    magnifierZoom: 2,
    // ---- color detection ------------------------------------------------
    autoCenter: false,
    bgColor: {r:255,g:255,b:255},
    lineColor: {r:0,g:0,b:0},
    colorTolerance: 30,
    searchRadius: 20,
    // --------------------------------------------------------------------
    history: [], historyIndex: -1
};

// ---------------------------------------------------------------------
// Initialise everything
document.addEventListener('DOMContentLoaded', () => {
    // DOM elements
    state.canvas = document.getElementById('canvas');
    state.ctx    = state.canvas.getContext('2d');
    state.magnifier = document.getElementById('magnifier');
    state.magCtx   = state.magnifier.getContext('2d');

    // Load saved session (if any)
    loadSession();

    // Initialise each module
    initUI();
    initCanvas();
    initCalibration();
    initPoints();
    initIO();
    initHistory();
    initColorDetect();

    // Bind UI buttons
    bindButtons();

    // First draw
    draw();
});
