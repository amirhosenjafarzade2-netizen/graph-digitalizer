/**********************
 * ENHANCED GRAPH DIGITIZER
 * Improvements:
 * - Better code organization with classes
 * - Improved error handling and validation
 * - Performance optimizations
 * - Enhanced user feedback
 * - Better state management
 * - Accessibility improvements
 **********************/

/**********************
 * STATE MANAGEMENT CLASS
 **********************/
class DigitizerState {
  constructor() {
    this.img = new Image();
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.isPanning = false;
    this.startPan = { x: 0, y: 0 };
    
    this.axisPoints = [];
    this.isCalibrated = false;
    this.scaleX = null;
    this.scaleY = null;
    this.offsetX = null;
    this.offsetY = null;
    
    this.lines = [{ name: 'Line 1', points: [], sorted: false, orderCounter: 0 }];
    this.currentLineIndex = 0;
    this.mode = 'none';
    this.selectedPointIndex = -1;
    
    this.history = [];
    this.historyIndex = -1;
    this.maxHistorySize = 50;
    
    this.showGrid = false;
    this.logX = false;
    this.logY = false;
    
    this.highlightPath = [];
    this.isHighlighting = false;
    this.isDraggingPoint = false;
    this.highlightWidth = 2;
    this.magnifierZoom = 2;
    
    this.lineColors = ['#2563eb', '#16a34a', '#dc2626', '#9333ea', '#ea580c', '#854d0e', '#ec4899', '#6b7280'];
    this.axisLabels = ['X1', 'X2', 'Y1', 'Y2'];
  }

  saveToLocalStorage() {
    try {
      const state = {
        lines: this.lines,
        axisPoints: this.axisPoints,
        scaleX: this.scaleX,
        scaleY: this.scaleY,
        offsetX: this.offsetX,
        offsetY: this.offsetY,
        logX: this.logX,
        logY: this.logY,
        isCalibrated: this.isCalibrated,
        zoom: this.zoom,
        panX: this.panX,
        panY: this.panY,
        showGrid: this.showGrid,
        mode: this.mode,
        currentLineIndex: this.currentLineIndex,
        magnifierZoom: this.magnifierZoom,
        highlightWidth: this.highlightWidth
      };
      localStorage.setItem('digitizerState', JSON.stringify(state));
    } catch (e) {
      console.error('Failed to save to localStorage:', e);
    }
  }

  loadFromLocalStorage() {
    try {
      const stored = localStorage.getItem('digitizerState');
      if (!stored) return false;
      
      const state = JSON.parse(stored);
      
      // Validate and restore state
      this.lines = this.validateLines(state.lines);
      this.axisPoints = Array.isArray(state.axisPoints) ? state.axisPoints : [];
      this.scaleX = state.scaleX;
      this.scaleY = state.scaleY;
      this.offsetX = state.offsetX;
      this.offsetY = state.offsetY;
      this.logX = Boolean(state.logX);
      this.logY = Boolean(state.logY);
      this.isCalibrated = Boolean(state.isCalibrated);
      this.zoom = Number(state.zoom) || 1;
      this.panX = Number(state.panX) || 0;
      this.panY = Number(state.panY) || 0;
      this.showGrid = Boolean(state.showGrid);
      this.mode = state.mode || 'none';
      this.currentLineIndex = Number(state.currentLineIndex) || 0;
      this.magnifierZoom = Number(state.magnifierZoom) || 2;
      this.highlightWidth = Number(state.highlightWidth) || 2;
      
      return true;
    } catch (e) {
      console.error('Failed to load from localStorage:', e);
      return false;
    }
  }

  validateLines(lines) {
    if (!Array.isArray(lines) || lines.length === 0) {
      return [{ name: 'Line 1', points: [], sorted: false, orderCounter: 0 }];
    }
    
    return lines.map(line => {
      const validatedLine = {
        name: String(line.name || 'Unnamed Line'),
        points: Array.isArray(line.points) ? line.points : [],
        sorted: Boolean(line.sorted),
        orderCounter: Number(line.orderCounter) || 0
      };
      
      // Ensure all points have order numbers
      if (validatedLine.points.length > 0 && typeof validatedLine.points[0].order === 'undefined') {
        let maxOrder = 0;
        validatedLine.points = validatedLine.points.map(p => {
          if (typeof p.order === 'undefined') {
            p.order = ++maxOrder;
          } else {
            maxOrder = Math.max(maxOrder, p.order);
          }
          return p;
        });
        validatedLine.orderCounter = maxOrder + 1;
      }
      
      return validatedLine;
    });
  }

  addToHistory() {
    // Limit history size
    if (this.history.length >= this.maxHistorySize) {
      this.history.shift();
      this.historyIndex--;
    }
    
    // Remove any history after current index
    this.history = this.history.slice(0, this.historyIndex + 1);
    
    // Create deep copy of current state
    const snapshot = {
      lines: JSON.parse(JSON.stringify(this.lines)),
      axisPoints: JSON.parse(JSON.stringify(this.axisPoints)),
      scaleX: this.scaleX,
      scaleY: this.scaleY,
      offsetX: this.offsetX,
      offsetY: this.offsetY,
      logX: this.logX,
      logY: this.logY,
      isCalibrated: this.isCalibrated,
      zoom: this.zoom,
      panX: this.panX,
      panY: this.panY,
      showGrid: this.showGrid,
      mode: this.mode,
      currentLineIndex: this.currentLineIndex,
      magnifierZoom: this.magnifierZoom,
      highlightPath: JSON.parse(JSON.stringify(this.highlightPath)),
      isHighlighting: this.isHighlighting
    };
    
    this.history.push(snapshot);
    this.historyIndex++;
  }

  undo() {
    if (this.historyIndex <= 0) return false;
    
    this.historyIndex--;
    this.restoreFromHistory(this.history[this.historyIndex]);
    return true;
  }

  redo() {
    if (this.historyIndex >= this.history.length - 1) return false;
    
    this.historyIndex++;
    this.restoreFromHistory(this.history[this.historyIndex]);
    return true;
  }

  restoreFromHistory(snapshot) {
    this.lines = JSON.parse(JSON.stringify(snapshot.lines));
    this.axisPoints = JSON.parse(JSON.stringify(snapshot.axisPoints));
    this.scaleX = snapshot.scaleX;
    this.scaleY = snapshot.scaleY;
    this.offsetX = snapshot.offsetX;
    this.offsetY = snapshot.offsetY;
    this.logX = snapshot.logX;
    this.logY = snapshot.logY;
    this.isCalibrated = snapshot.isCalibrated;
    this.zoom = snapshot.zoom;
    this.panX = snapshot.panX;
    this.panY = snapshot.panY;
    this.showGrid = snapshot.showGrid;
    this.mode = snapshot.mode;
    this.currentLineIndex = snapshot.currentLineIndex;
    this.magnifierZoom = snapshot.magnifierZoom;
    this.highlightPath = JSON.parse(JSON.stringify(snapshot.highlightPath || []));
    this.isHighlighting = snapshot.isHighlighting || false;
  }

  canUndo() {
    return this.historyIndex > 0;
  }

  canRedo() {
    return this.historyIndex < this.history.length - 1;
  }

  reset() {
    this.img.src = '';
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.axisPoints = [];
    this.isCalibrated = false;
    this.scaleX = null;
    this.scaleY = null;
    this.offsetX = null;
    this.offsetY = null;
    this.lines = [{ name: 'Line 1', points: [], sorted: false, orderCounter: 0 }];
    this.currentLineIndex = 0;
    this.mode = 'none';
    this.history = [];
    this.historyIndex = -1;
    this.showGrid = false;
    this.logX = false;
    this.logY = false;
    this.highlightPath = [];
    this.isHighlighting = false;
    this.magnifierZoom = 2;
    this.highlightWidth = 2;
    localStorage.removeItem('digitizerState');
  }
}

/**********************
 * COORDINATE TRANSFORMER CLASS
 **********************/
class CoordinateTransformer {
  constructor(state) {
    this.state = state;
  }

  imageToCanvas(clientX, clientY, canvas) {
    const rect = canvas.getBoundingClientRect();
    const x = (clientX - rect.left - this.state.panX) / this.state.zoom;
    const y = (clientY - rect.top - this.state.panY) / this.state.zoom;
    return { x, y };
  }

  canvasToData(x, y) {
    if (!this.state.isCalibrated) {
      return { dataX: x, dataY: y };
    }

    try {
      let dataX, dataY;
      
      if (this.state.logX) {
        dataX = Math.pow(10, (x - this.state.offsetX) / this.state.scaleX);
      } else {
        dataX = (x - this.state.offsetX) / this.state.scaleX;
      }
      
      if (this.state.logY) {
        dataY = Math.pow(10, (y - this.state.offsetY) / this.state.scaleY);
      } else {
        dataY = (y - this.state.offsetY) / this.state.scaleY;
      }
      
      // Validate results
      if (!isFinite(dataX) || !isFinite(dataY)) {
        console.warn('Invalid data coordinates:', { x, y, dataX, dataY });
        return null;
      }
      
      return { dataX, dataY };
    } catch (e) {
      console.error('Error converting to data coords:', e);
      return null;
    }
  }

  dataToCanvas(dataX, dataY) {
    if (!this.state.isCalibrated) {
      return { x: dataX, y: dataY };
    }

    try {
      let x, y;
      
      if (this.state.logX) {
        x = Math.log10(dataX) * this.state.scaleX + this.state.offsetX;
      } else {
        x = dataX * this.state.scaleX + this.state.offsetX;
      }
      
      if (this.state.logY) {
        y = Math.log10(dataY) * this.state.scaleY + this.state.offsetY;
      } else {
        y = dataY * this.state.scaleY + this.state.offsetY;
      }
      
      if (!isFinite(x) || !isFinite(y)) {
        console.warn('Invalid canvas coordinates:', { dataX, dataY, x, y });
        return null;
      }
      
      return { x, y };
    } catch (e) {
      console.error('Error converting to canvas coords:', e);
      return null;
    }
  }

  snapToGrid(x, y, gridDivisions = 10) {
    if (!this.state.isCalibrated || !this.state.showGrid) {
      return { x, y };
    }

    const dataCoords = this.canvasToData(x, y);
    if (!dataCoords) return { x, y };

    const axisPoints = this.state.axisPoints;
    const sharedOrigin = document.getElementById('shared-origin').checked;

    // Calculate axis ranges
    const x1Val = parseFloat(document.getElementById('x1-value').value);
    const x2Val = parseFloat(document.getElementById('x2-value').value);
    const y1Val = parseFloat(document.getElementById('y1-value').value);
    const y2Val = parseFloat(document.getElementById('y2-value').value);

    const xStep = (x2Val - x1Val) / gridDivisions;
    const yStep = (y2Val - y1Val) / gridDivisions;

    // Snap to grid
    const snappedDataX = Math.round(dataCoords.dataX / xStep) * xStep;
    const snappedDataY = Math.round(dataCoords.dataY / yStep) * yStep;

    const snappedCanvas = this.dataToCanvas(snappedDataX, snappedDataY);
    return snappedCanvas || { x, y };
  }
}

/**********************
 * RENDERER CLASS
 **********************/
class Renderer {
  constructor(canvas, magnifier, state, transformer) {
    this.canvas = canvas;
    this.magnifier = magnifier;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.magCtx = magnifier.getContext('2d', { alpha: false });
    this.state = state;
    this.transformer = transformer;
    this.drawPending = false;
    this.magnifierPending = false;
  }

  requestDraw() {
    if (this.drawPending) return;
    this.drawPending = true;
    requestAnimationFrame(() => {
      this.draw();
      this.drawPending = false;
    });
  }

  draw() {
    const { ctx, canvas, state } = this;
    const { img, zoom, panX, panY, showGrid, isCalibrated, axisPoints, lines, currentLineIndex, selectedPointIndex, highlightPath, highlightWidth } = state;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    ctx.save();
    ctx.translate(panX, panY);
    ctx.scale(zoom, zoom);

    // Draw image or placeholder
    if (img.src && img.complete && img.naturalWidth > 0) {
      try {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      } catch (e) {
        console.error('Error drawing image:', e);
        this.drawPlaceholder('Error loading image');
      }
    } else {
      this.drawPlaceholder(img.src ? 'Loading image...' : 'No image loaded');
    }

    // Draw grid
    if (isCalibrated && showGrid) {
      this.drawGrid();
    }

    // Draw axis points
    this.drawAxisPoints();

    // Draw line points
    this.drawLinePoints();

    // Draw highlight path
    if (highlightPath.length > 1) {
      this.drawHighlightPath();
    }

    ctx.restore();
  }

  drawPlaceholder(text) {
    const { ctx, canvas } = this;
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#9ca3af';
    ctx.font = '16px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  }

  drawGrid() {
    const { ctx, canvas, state } = this;
    const { axisPoints, zoom, logX, logY, scaleX, scaleY, offsetX, offsetY } = state;
    const sharedOrigin = document.getElementById('shared-origin').checked;

    ctx.strokeStyle = 'rgba(0, 0, 0, 0.15)';
    ctx.lineWidth = 1 / zoom;
    ctx.setLineDash([2 / zoom, 2 / zoom]);

    try {
      // Calculate data ranges
      const x1Val = parseFloat(document.getElementById('x1-value').value);
      const x2Val = parseFloat(document.getElementById('x2-value').value);
      const y1Val = parseFloat(document.getElementById('y1-value').value);
      const y2Val = parseFloat(document.getElementById('y2-value').value);

      const xStep = (x2Val - x1Val) / 10;
      const yStep = (y2Val - y1Val) / 10;

      // Draw vertical grid lines
      for (let i = 0; i <= 10; i++) {
        const dataX = x1Val + i * xStep;
        const canvasCoords = this.transformer.dataToCanvas(dataX, y1Val);
        if (canvasCoords) {
          ctx.beginPath();
          ctx.moveTo(canvasCoords.x, 0);
          ctx.lineTo(canvasCoords.x, canvas.height);
          ctx.stroke();
        }
      }

      // Draw horizontal grid lines
      for (let i = 0; i <= 10; i++) {
        const dataY = y1Val + i * yStep;
        const canvasCoords = this.transformer.dataToCanvas(x1Val, dataY);
        if (canvasCoords) {
          ctx.beginPath();
          ctx.moveTo(0, canvasCoords.y);
          ctx.lineTo(canvas.width, canvasCoords.y);
          ctx.stroke();
        }
      }
    } catch (e) {
      console.error('Error drawing grid:', e);
    }

    ctx.setLineDash([]);
  }

  drawAxisPoints() {
    const { ctx, state } = this;
    const { axisPoints, zoom } = state;

    ctx.fillStyle = '#dc2626';
    ctx.font = `${12 / zoom}px system-ui, -apple-system, sans-serif`;

    axisPoints.forEach((p, i) => {
      // Draw point
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5 / zoom, 0, 2 * Math.PI);
      ctx.fill();

      // Draw label
      ctx.fillStyle = '#ffffff';
      ctx.fillText(p.label || state.axisLabels[i], p.x + 8 / zoom, p.y - 8 / zoom);
      ctx.fillStyle = '#dc2626';
    });
  }

  drawLinePoints() {
    const { ctx, state } = this;
    const { lines, currentLineIndex, selectedPointIndex, zoom, lineColors } = state;

    lines.forEach((line, lineIdx) => {
      const color = lineColors[lineIdx % lineColors.length];
      ctx.fillStyle = color;

      line.points.forEach((p, i) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4 / zoom, 0, 2 * Math.PI);
        
        // Highlight selected point
        if (lineIdx === currentLineIndex && i === selectedPointIndex) {
          ctx.strokeStyle = '#fbbf24';
          ctx.lineWidth = 3 / zoom;
          ctx.stroke();
        }
        
        ctx.fill();
      });
    });
  }

  drawHighlightPath() {
    const { ctx, state } = this;
    const { highlightPath, highlightWidth, zoom } = state;

    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = highlightWidth / zoom;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    ctx.moveTo(highlightPath[0].x, highlightPath[0].y);
    
    for (let i = 1; i < highlightPath.length; i++) {
      ctx.lineTo(highlightPath[i].x, highlightPath[i].y);
    }
    
    ctx.stroke();
  }

  requestDrawMagnifier(clientX, clientY) {
    if (this.magnifierPending) return;
    this.magnifierPending = true;
    requestAnimationFrame(() => {
      this.drawMagnifier(clientX, clientY);
      this.magnifierPending = false;
    });
  }

  drawMagnifier(clientX, clientY) {
    const { magnifier, magCtx, canvas, state } = this;
    const { img, zoom, mode, isPanning, magnifierZoom, axisPoints, lines, currentLineIndex, selectedPointIndex, lineColors } = state;

    // Hide magnifier if not applicable
    if (!img.src || !img.complete || img.naturalWidth === 0 || mode === 'none' || isPanning) {
      magnifier.style.display = 'none';
      return;
    }

    // Get mouse position relative to canvas
    const rect = canvas.getBoundingClientRect();
    const mouseX = clientX - rect.left;
    const mouseY = clientY - rect.top;

    // Position magnifier near mouse
    const magX = Math.max(0, Math.min(mouseX + 20, rect.width - magnifier.width));
    const magY = Math.max(0, Math.min(mouseY + 20, rect.height - magnifier.height));
    
    magnifier.style.left = `${magX}px`;
    magnifier.style.top = `${magY}px`;
    magnifier.style.display = 'block';

    // Convert mouse position to image coordinates
    const canvasCoords = this.transformer.imageToCanvas(clientX, clientY, canvas);
    const imgX = canvasCoords.x * (img.width / canvas.width);
    const imgY = canvasCoords.y * (img.height / canvas.height);

    // Calculate source rectangle in image
    const srcWidth = magnifier.width / magnifierZoom;
    const srcHeight = magnifier.height / magnifierZoom;
    const srcX = Math.max(0, Math.min(imgX - srcWidth / 2, img.width - srcWidth));
    const srcY = Math.max(0, Math.min(imgY - srcHeight / 2, img.height - srcHeight));

    // Draw zoomed image
    magCtx.clearRect(0, 0, magnifier.width, magnifier.height);
    
    try {
      magCtx.drawImage(
        img,
        srcX, srcY, srcWidth, srcHeight,
        0, 0, magnifier.width, magnifier.height
      );
    } catch (e) {
      console.error('Error drawing magnifier:', e);
      magnifier.style.display = 'none';
      return;
    }

    // Draw axis points in magnifier
    this.drawMagnifierPoints(axisPoints, srcX, srcY, srcWidth, srcHeight, '#dc2626', true);

    // Draw line points in magnifier
    lines.forEach((line, lineIdx) => {
      const color = lineColors[lineIdx % lineColors.length];
      this.drawMagnifierPoints(
        line.points,
        srcX, srcY, srcWidth, srcHeight,
        color,
        false,
        lineIdx === currentLineIndex ? selectedPointIndex : -1
      );
    });

    // Draw crosshair at center
    this.drawMagnifierCrosshair();
  }

  drawMagnifierPoints(points, srcX, srcY, srcWidth, srcHeight, color, isAxis = false, highlightIndex = -1) {
    const { magCtx, magnifier, canvas, state } = this;
    const { img, magnifierZoom } = state;

    magCtx.fillStyle = color;

    points.forEach((p, i) => {
      // Convert point from canvas coords to image coords
      const imgPx = p.x * (img.width / canvas.width);
      const imgPy = p.y * (img.height / canvas.height);

      // Convert to magnifier coords
      const magPx = (imgPx - srcX) * magnifierZoom;
      const magPy = (imgPy - srcY) * magnifierZoom;

      // Check if point is visible in magnifier
      if (magPx >= 0 && magPx <= magnifier.width && magPy >= 0 && magPy <= magnifier.height) {
        magCtx.beginPath();
        magCtx.arc(magPx, magPy, isAxis ? 5 : 4, 0, 2 * Math.PI);
        
        // Highlight selected point
        if (i === highlightIndex) {
          magCtx.strokeStyle = '#fbbf24';
          magCtx.lineWidth = 2;
          magCtx.stroke();
        }
        
        magCtx.fill();
      }
    });
  }

  drawMagnifierCrosshair() {
    const { magCtx, magnifier } = this;
    const centerX = magnifier.width / 2;
    const centerY = magnifier.height / 2;
    const size = 10;

    magCtx.strokeStyle = '#ef4444';
    magCtx.lineWidth = 2;

    magCtx.beginPath();
    magCtx.moveTo(centerX - size, centerY);
    magCtx.lineTo(centerX + size, centerY);
    magCtx.moveTo(centerX, centerY - size);
    magCtx.lineTo(centerX, centerY + size);
    magCtx.stroke();
  }

  resizeCanvas(width, height) {
    this.canvas.width = width;
    this.canvas.height = height;
    this.requestDraw();
  }
}

/**********************
 * UI CONTROLLER CLASS
 **********************/
class UIController {
  constructor(state, renderer) {
    this.state = state;
    this.renderer = renderer;
    this.elements = this.collectElements();
    this.setupEventListeners();
  }

  collectElements() {
    return {
      // Canvas
      canvas: document.getElementById('canvas'),
      magnifier: document.getElementById('magnifier'),
      statusBar: document.getElementById('status-bar'),
      
      // Upload
      imageUpload: document.getElementById('image-upload'),
      
      // Calibration
      setAxesBtn: document.getElementById('set-axes'),
      resetAxisPointsBtn: document.getElementById('reset-axis-points'),
      axisInputs: document.getElementById('axis-inputs'),
      orthogonalAxes: document.getElementById('orthogonal-axes'),
      sharedOrigin: document.getElementById('shared-origin'),
      axisInstruction: document.getElementById('axis-instruction'),
      calibrateBtn: document.getElementById('calibrate'),
      resetCalibrationBtn: document.getElementById('reset-calibration'),
      
      // View controls
      toggleGridBtn: document.getElementById('toggle-grid'),
      toggleLogXBtn: document.getElementById('toggle-log-x'),
      toggleLogYBtn: document.getElementById('toggle-log-y'),
      
      // Point controls
      addPointBtn: document.getElementById('add-point'),
      adjustPointBtn: document.getElementById('adjust-point'),
      deletePointBtn: document.getElementById('delete-point'),
      highlightLineBtn: document.getElementById('highlight-line'),
      clearPointsBtn: document.getElementById('clear-points'),
      sortPointsBtn: document.getElementById('sort-points'),
      
      // Highlight controls
      highlightControls: document.getElementById('highlight-controls'),
      highlightLineName: document.getElementById('highlight-line-name'),
      nPointsInput: document.getElementById('n-points'),
      deleteHighlightBtn: document.getElementById('delete-highlight'),
      highlightWidth: document.getElementById('highlight-width'),
      
      // Line management
      newLineBtn: document.getElementById('new-line'),
      renameLineBtn: document.getElementById('rename-line'),
      lineSelect: document.getElementById('line-select'),
      
      // Import/Export
      importJsonBtn: document.getElementById('import-json'),
      importJsonInput: document.getElementById('import-json-input'),
      exportJsonBtn: document.getElementById('export-json'),
      exportCsvBtn: document.getElementById('export-csv'),
      exportXlsxBtn: document.getElementById('export-xlsx'),
      
      // Session
      clearSessionBtn: document.getElementById('clear-session'),
      undoBtn: document.getElementById('undo'),
      redoBtn: document.getElementById('redo'),
      
      // Preview
      previewTable: document.getElementById('preview-table'),
      
      // Zoom/Pan
      zoomInBtn: document.getElementById('zoom-in'),
      zoomOutBtn: document.getElementById('zoom-out'),
      resetViewBtn: document.getElementById('reset-view'),
      panModeBtn: document.getElementById('pan-mode'),
      
      // Magnifier
      magnifierZoomInput: document.getElementById('magnifier-zoom'),
      
      // Modal
      modal: document.getElementById('modal'),
      modalContent: document.getElementById('modal-content'),
      
      // Spinner
      spinner: document.getElementById('spinner')
    };
  }

  setupEventListeners() {
    // Image upload
    this.elements.imageUpload.addEventListener('change', (e) => this.handleImageUpload(e));
    
    // Calibration
    this.elements.setAxesBtn.addEventListener('click', () => this.startAxisCalibration());
    this.elements.resetAxisPointsBtn.addEventListener('click', () => this.resetAxisPoints());
    this.elements.calibrateBtn.addEventListener('click', () => this.calibrate());
    this.elements.sharedOrigin.addEventListener('change', () => this.handleSharedOriginChange());
    
    // View controls
    this.elements.toggleGridBtn.addEventListener('click', () => this.toggleGrid());
    this.elements.toggleLogXBtn.addEventListener('click', () => this.toggleLogX());
    this.elements.toggleLogYBtn.addEventListener('click', () => this.toggleLogY());
    
    // Point controls
    this.elements.addPointBtn.addEventListener('click', () => this.setMode('add'));
    this.elements.adjustPointBtn.addEventListener('click', () => this.setMode('adjust'));
    this.elements.deletePointBtn.addEventListener('click', () => this.setMode('delete'));
    this.elements.highlightLineBtn.addEventListener('click', () => this.setMode('highlight'));
    this.elements.clearPointsBtn.addEventListener('click', () => this.clearCurrentLinePoints());
    this.elements.sortPointsBtn.addEventListener('click', () => this.toggleSort());
    this.elements.deleteHighlightBtn.addEventListener('click', () => this.clearHighlightPath());
    
    // Line management
    this.elements.newLineBtn.addEventListener('click', () => this.createNewLine());
    this.elements.renameLineBtn.addEventListener('click', () => this.renameLine());
    this.elements.lineSelect.addEventListener('change', (e) => this.switchLine(parseInt(e.target.value)));
    
    // Import/Export
    this.elements.importJsonBtn.addEventListener('click', () => this.elements.importJsonInput.click());
    this.elements.importJsonInput.addEventListener('change', (e) => this.handleImportJson(e));
    this.elements.exportJsonBtn.addEventListener('click', () => this.exportJson());
    this.elements.exportCsvBtn.addEventListener('click', () => this.exportCsv());
    this.elements.exportXlsxBtn.addEventListener('click', () => this.exportXlsx());
    
    // Session
    this.elements.clearSessionBtn.addEventListener('click', () => this.clearSession());
    this.elements.undoBtn.addEventListener('click', () => this.undo());
    this.elements.redoBtn.addEventListener('click', () => this.redo());
    
    // Zoom/Pan
    this.elements.zoomInBtn.addEventListener('click', () => this.zoom(1.2));
    this.elements.zoomOutBtn.addEventListener('click', () => this.zoom(1 / 1.2));
    this.elements.resetViewBtn.addEventListener('click', () => this.resetView());
    this.elements.panModeBtn.addEventListener('click', () => this.togglePanMode());
    
    // Magnifier
    this.elements.magnifierZoomInput.addEventListener('input', (e) => {
      this.state.magnifierZoom = parseFloat(e.target.value);
      this.state.saveToLocalStorage();
    });
    
    // Highlight width
    this.elements.highlightWidth.addEventListener('input', (e) => {
      this.state.highlightWidth = parseFloat(e.target.value);
      this.state.saveToLocalStorage();
    });
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => this.handleKeyboard(e));
    
    // Window resize
    window.addEventListener('resize', () => this.handleResize());
  }

  handleImageUpload(e) {
    const file = e.target.files[0];
    if (!file) {
      this.showModal('No file selected. Please choose an image.');
      return;
    }
    
    const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/bmp', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      this.showModal('Invalid file type. Please upload a PNG, JPEG, GIF, BMP, or WebP image.');
      return;
    }
    
    this.showSpinner(true);
    
    const reader = new FileReader();
    reader.onload = (ev) => {
      this.loadImage(ev.target.result);
    };
    reader.onerror = () => {
      this.showModal('Error reading file. Please try another image.');
      this.showSpinner(false);
    };
    reader.readAsDataURL(file);
  }

  loadImage(dataUrl) {
    const { img } = this.state;
    
    img.src = '';
    img.src = dataUrl;
    
    img.onload = () => {
      if (img.naturalWidth <= 0 || img.naturalHeight <= 0) {
        this.showModal('Image has invalid dimensions. Please try another image.');
        this.showSpinner(false);
        return;
      }
      
      // Reset view
      this.state.zoom = 1;
      this.state.panX = 0;
      this.state.panY = 0;
      
      // Resize canvas to fit image
      const maxWidth = window.innerWidth * 0.8;
      const maxHeight = window.innerHeight * 0.7;
      
      let canvasWidth = img.naturalWidth;
      let canvasHeight = img.naturalHeight;
      
      if (canvasWidth > maxWidth) {
        canvasHeight = (maxWidth / canvasWidth) * canvasHeight;
        canvasWidth = maxWidth;
      }
      
      if (canvasHeight > maxHeight) {
        canvasWidth = (maxHeight / canvasHeight) * canvasWidth;
        canvasHeight = maxHeight;
      }
      
      this.renderer.resizeCanvas(canvasWidth, canvasHeight);
      
      // Enable controls
      this.elements.setAxesBtn.disabled = false;
      this.elements.resetAxisPointsBtn.disabled = false;
      
      this.state.addToHistory();
      this.state.saveToLocalStorage();
      this.showSpinner(false);
    };
    
    img.onerror = () => {
      this.showModal('Failed to load image. Please check file format or try another image.');
      this.showSpinner(false);
    };
  }

  startAxisCalibration() {
    this.state.axisPoints = [];
    this.state.mode = 'axes';
    this.elements.axisInputs.style.display = 'block';
    this.elements.highlightControls.style.display = 'none';
    this.updateAxisInstruction();
    this.updateButtonStates();
    this.elements.calibrateBtn.disabled = true;
    this.renderer.requestDraw();
  }

  resetAxisPoints() {
    this.state.axisPoints = [];
    this.state.mode = 'axes';
    this.elements.axisInputs.style.display = 'block';
    this.elements.highlightControls.style.display = 'none';
    this.updateAxisInstruction();
    this.elements.calibrateBtn.disabled = true;
    this.renderer.requestDraw();
    this.state.addToHistory();
    this.state.saveToLocalStorage();
  }

  handleSharedOriginChange() {
    this.updateAxisLabels();
    if (this.state.mode === 'axes') {
      this.state.axisPoints = [];
      this.updateAxisInstruction();
      this.elements.calibrateBtn.disabled = true;
      this.renderer.requestDraw();
      this.state.addToHistory();
      this.state.saveToLocalStorage();
    }
  }

  updateAxisInstruction() {
    const sharedOrigin = this.elements.sharedOrigin.checked;
    const pointCount = this.state.axisPoints.length;
    const requiredPoints = sharedOrigin ? 3 : 4;
    
    if (this.state.isCalibrated) {
      this.elements.axisInstruction.textContent = 'Calibration complete. Select a mode to digitize.';
    } else if (pointCount < requiredPoints) {
      if (sharedOrigin && pointCount === 0) {
        this.elements.axisInstruction.textContent = 'Click point for Shared Origin (X1/Y1) on the chart.';
      } else {
        this.elements.axisInstruction.textContent = `Click point for ${this.state.axisLabels[pointCount]} on the chart.`;
      }
    } else {
      this.elements.axisInstruction.textContent = 'Enter axis values and click Calibrate.';
    }
  }

  updateAxisLabels() {
    const x1Label = document.querySelector('label[for="x1-value"]');
    const y1Label = document.querySelector('label[for="y1-value"]');
    
    if (this.elements.sharedOrigin.checked) {
      if (x1Label) x1Label.textContent = 'Origin X:';
      if (y1Label) y1Label.textContent = 'Origin Y:';
    } else {
      if (x1Label) x1Label.textContent = 'X1:';
      if (y1Label) y1Label.textContent = 'Y1:';
    }
  }

  calibrate() {
    const x1Val = parseFloat(document.getElementById('x1-value').value);
    const x2Val = parseFloat(document.getElementById('x2-value').value);
    const y1Val = parseFloat(document.getElementById('y1-value').value);
    const y2Val = parseFloat(document.getElementById('y2-value').value);

    // Validation
    if (isNaN(x1Val) || isNaN(x2Val) || isNaN(y1Val) || isNaN(y2Val)) {
      this.showModal('Please enter valid numeric axis values.');
      return;
    }

    if (x1Val === x2Val) {
      this.showModal('X1 and X2 must be different values.');
      return;
    }

    if (y1Val === y2Val) {
      this.showModal('Y1 and Y2 must be different values.');
      return;
    }

    if (this.state.logX && (x1Val <= 0 || x2Val <= 0)) {
      this.showModal('Logarithmic X-axis requires positive values for X1 and X2.');
      return;
    }

    if (this.state.logY && (y1Val <= 0 || y2Val <= 0)) {
      this.showModal('Logarithmic Y-axis requires positive values for Y1 and Y2.');
      return;
    }

    const sharedOrigin = this.elements.sharedOrigin.checked;
    const requiredPoints = sharedOrigin ? 3 : 4;

    if (this.state.axisPoints.length !== requiredPoints) {
      this.showModal(`Please set ${requiredPoints} axis points first.`);
      return;
    }

    // Get pixel coordinates
    let x1Pix, x2Pix, y1Pix, y2Pix;
    if (sharedOrigin) {
      x1Pix = this.state.axisPoints[0].x;
      x2Pix = this.state.axisPoints[1].x;
      y1Pix = this.state.axisPoints[0].y;
      y2Pix = this.state.axisPoints[2].y;
    } else {
      x1Pix = this.state.axisPoints[0].x;
      x2Pix = this.state.axisPoints[1].x;
      y1Pix = this.state.axisPoints[2].y;
      y2Pix = this.state.axisPoints[3].y;
    }

    // Validate pixel coordinates
    if (Math.abs(x2Pix - x1Pix) < 1) {
      this.showModal('X-axis points must be further apart.');
      return;
    }

    if (Math.abs(y2Pix - y1Pix) < 1) {
      this.showModal('Y-axis points must be further apart.');
      return;
    }

    // Calculate scales
    const deltaPixX = x2Pix - x1Pix;
    const deltaPixY = y2Pix - y1Pix;
    
    const deltaValX = this.state.logX 
      ? Math.log10(x2Val) - Math.log10(x1Val)
      : x2Val - x1Val;
    
    const deltaValY = this.state.logY
      ? Math.log10(y2Val) - Math.log10(y1Val)
      : y2Val - y1Val;

    this.state.scaleX = deltaPixX / deltaValX;
    this.state.scaleY = deltaPixY / deltaValY;
    
    this.state.offsetX = this.state.logX
      ? x1Pix - Math.log10(x1Val) * this.state.scaleX
      : x1Pix - x1Val * this.state.scaleX;
    
    this.state.offsetY = this.state.logY
      ? y1Pix - Math.log10(y1Val) * this.state.scaleY
      : y1Pix - y1Val * this.state.scaleY;

    // Final validation
    if (!isFinite(this.state.scaleX) || !isFinite(this.state.scaleY) ||
        !isFinite(this.state.offsetX) || !isFinite(this.state.offsetY)) {
      this.showModal('Calibration failed: Invalid scale factors. Please check your axis points and values.');
      return;
    }

    // Success
    this.state.isCalibrated = true;
    this.state.mode = 'add';
    
    // Update UI
    this.elements.axisInputs.style.display = 'none';
    this.elements.highlightControls.style.display = 'none';
    this.updateAxisInstruction();
    
    // Enable digitization controls
    this.elements.addPointBtn.disabled = false;
    this.elements.adjustPointBtn.disabled = false;
    this.elements.deletePointBtn.disabled = false;
    this.elements.highlightLineBtn.disabled = false;
    this.elements.clearPointsBtn.disabled = false;
    this.elements.sortPointsBtn.disabled = false;
    this.elements.newLineBtn.disabled = false;
    this.elements.renameLineBtn.disabled = false;
    
    this.updateButtonStates();
    this.recalculateAllPoints();
    this.updatePreview();
    this.renderer.requestDraw();
    this.state.addToHistory();
    this.state.saveToLocalStorage();
    
    this.showModal('Calibration successful! You can now digitize points.', false);
  }

  recalculateAllPoints() {
    const transformer = new CoordinateTransformer(this.state);
    
    this.state.lines.forEach(line => {
      line.points.forEach(point => {
        const dataCoords = transformer.canvasToData(point.x, point.y);
        if (dataCoords) {
          point.dataX = dataCoords.dataX;
          point.dataY = dataCoords.dataY;
        }
      });
    });
  }

  toggleGrid() {
    this.state.showGrid = !this.state.showGrid;
    this.elements.toggleGridBtn.classList.toggle('active', this.state.showGrid);
    this.renderer.requestDraw();
    this.state.addToHistory();
    this.state.saveToLocalStorage();
  }

  toggleLogX() {
    this.state.logX = !this.state.logX;
    this.elements.toggleLogXBtn.classList.toggle('log-active', this.state.logX);
    
    if (this.state.isCalibrated) {
      this.recalculateScalesAndPoints();
    }
    
    this.renderer.requestDraw();
    this.updatePreview();
    this.state.addToHistory();
    this.state.saveToLocalStorage();
  }

  toggleLogY() {
    this.state.logY = !this.state.logY;
    this.elements.toggleLogYBtn.classList.toggle('log-active', this.state.logY);
    
    if (this.state.isCalibrated) {
      this.recalculateScalesAndPoints();
    }
    
    this.renderer.requestDraw();
    this.updatePreview();
    this.state.addToHistory();
    this.state.saveToLocalStorage();
  }

  recalculateScalesAndPoints() {
    const x1Val = parseFloat(document.getElementById('x1-value').value);
    const x2Val = parseFloat(document.getElementById('x2-value').value);
    const y1Val = parseFloat(document.getElementById('y1-value').value);
    const y2Val = parseFloat(document.getElementById('y2-value').value);

    if (this.state.logX && (x1Val <= 0 || x2Val <= 0)) {
      this.showModal('Logarithmic X-axis requires positive values.');
      this.state.logX = !this.state.logX;
      this.elements.toggleLogXBtn.classList.toggle('log-active', this.state.logX);
      return;
    }

    if (this.state.logY && (y1Val <= 0 || y2Val <= 0)) {
      this.showModal('Logarithmic Y-axis requires positive values.');
      this.state.logY = !this.state.logY;
      this.elements.toggleLogYBtn.classList.toggle('log-active', this.state.logY);
      return;
    }

    const sharedOrigin = this.elements.sharedOrigin.checked;
    const x1Pix = this.state.axisPoints[0].x;
    const x2Pix = this.state.axisPoints[1].x;
    const y1Pix = sharedOrigin ? this.state.axisPoints[0].y : this.state.axisPoints[2].y;
    const y2Pix = sharedOrigin ? this.state.axisPoints[2].y : this.state.axisPoints[3].y;

    const deltaPixX = x2Pix - x1Pix;
    const deltaPixY = y2Pix - y1Pix;
    
    const deltaValX = this.state.logX 
      ? Math.log10(x2Val) - Math.log10(x1Val)
      : x2Val - x1Val;
    
    const deltaValY = this.state.logY
      ? Math.log10(y2Val) - Math.log10(y1Val)
      : y2Val - y1Val;

    this.state.scaleX = deltaPixX / deltaValX;
    this.state.scaleY = deltaPixY / deltaValY;
    
    this.state.offsetX = this.state.logX
      ? x1Pix - Math.log10(x1Val) * this.state.scaleX
      : x1Pix - x1Val * this.state.scaleX;
    
    this.state.offsetY = this.state.logY
      ? y1Pix - Math.log10(y1Val) * this.state.scaleY
      : y1Pix - y1Val * this.state.scaleY;

    this.recalculateAllPoints();
  }

  setMode(newMode) {
    this.state.mode = newMode;
    
    if (newMode === 'highlight') {
      this.elements.highlightControls.style.display = 'block';
      this.elements.axisInputs.style.display = 'none';
    } else {
      this.elements.highlightControls.style.display = 'none';
      if (newMode !== 'axes') {
        this.elements.axisInputs.style.display = 'none';
      }
    }
    
    this.updateButtonStates();
  }

  clearCurrentLinePoints() {
    const line = this.state.lines[this.state.currentLineIndex];
    line.points = [];
    line.orderCounter = 0;
    line.sorted = false;
    
    this.elements.sortPointsBtn.classList.remove('sort-active');
    this.updatePreview();
    this.renderer.requestDraw();
    this.state.addToHistory();
    this.state.saveToLocalStorage();
  }

  toggleSort() {
    const line = this.state.lines[this.state.currentLineIndex];
    line.sorted = !line.sorted;
    
    this.elements.sortPointsBtn.classList.toggle('sort-active', line.sorted);
    this.updatePreview();
    this.state.addToHistory();
    this.state.saveToLocalStorage();
  }

  clearHighlightPath() {
    this.state.highlightPath = [];
    this.renderer.requestDraw();
    this.state.addToHistory();
    this.state.saveToLocalStorage();
  }

  createNewLine() {
    this.showModal('Enter new line name:', true, (name) => {
      if (!name || name.trim() === '') {
        this.showModal('Line name cannot be empty.');
        return;
      }
      
      if (this.state.lines.some(line => line.name === name)) {
        this.showModal('Line name must be unique.');
        return;
      }
      
      this.state.lines.push({ 
        name: name.trim(), 
        points: [], 
        sorted: false, 
        orderCounter: 0 
      });
      
      this.state.currentLineIndex = this.state.lines.length - 1;
      this.updateLineSelect();
      this.updatePreview();
      this.renderer.requestDraw();
      this.state.addToHistory();
      this.state.saveToLocalStorage();
    });
  }

  renameLine() {
    const currentName = this.state.lines[this.state.currentLineIndex].name;
    
    this.showModal(`Rename "${currentName}" to:`, true, (name) => {
      if (!name || name.trim() === '') {
        this.showModal('Line name cannot be empty.');
        return;
      }
      
      if (this.state.lines.some((line, i) => i !== this.state.currentLineIndex && line.name === name)) {
        this.showModal('Line name must be unique.');
        return;
      }
      
      this.state.lines[this.state.currentLineIndex].name = name.trim();
      this.updateLineSelect();
      this.updatePreview();
      this.state.addToHistory();
      this.state.saveToLocalStorage();
    });
  }

  switchLine(index) {
    this.state.currentLineIndex = index;
    const line = this.state.lines[index];
    this.elements.sortPointsBtn.classList.toggle('sort-active', line.sorted);
    this.updatePreview();
    this.renderer.requestDraw();
    this.state.saveToLocalStorage();
  }

  updateLineSelect() {
    this.elements.lineSelect.innerHTML = '';
    
    this.state.lines.forEach((line, i) => {
      const option = document.createElement('option');
      option.value = i;
      option.textContent = `${line.name} (${line.points.length})`;
      this.elements.lineSelect.appendChild(option);
    });
    
    this.elements.lineSelect.value = this.state.currentLineIndex;
  }

  updatePreview() {
    this.elements.previewTable.innerHTML = '';
    
    if (this.state.lines.every(line => line.points.length === 0)) {
      this.elements.previewTable.innerHTML = '<tr><td colspan="3" style="text-align:center;color:#9ca3af;">No data points yet</td></tr>';
      return;
    }

    this.state.lines.forEach((line, lineIdx) => {
      if (line.points.length === 0) return;

      // Line header
      const headerRow = document.createElement('tr');
      headerRow.innerHTML = `<td colspan="3" style="background:#1f2937;font-weight:bold;padding:8px;">${line.name}</td>`;
      this.elements.previewTable.appendChild(headerRow);

      // Column headers
      const colHeaderRow = document.createElement('tr');
      colHeaderRow.innerHTML = '<td style="font-weight:bold;">#</td><td style="font-weight:bold;">X</td><td style="font-weight:bold;">Y</td>';
      this.elements.previewTable.appendChild(colHeaderRow);

      // Sort points if needed
      const points = line.sorted 
        ? [...line.points].sort((a, b) => a.dataX - b.dataX)
        : [...line.points].sort((a, b) => a.order - b.order);

      // Data rows (show first 10, indicate if more)
      const displayPoints = points.slice(0, 10);
      displayPoints.forEach((p, i) => {
        const row = document.createElement('tr');
        const dataX = isFinite(p.dataX) ? p.dataX.toFixed(6) : 'NaN';
        const dataY = isFinite(p.dataY) ? p.dataY.toFixed(6) : 'NaN';
        row.innerHTML = `<td>${i + 1}</td><td>${dataX}</td><td>${dataY}</td>`;
        this.elements.previewTable.appendChild(row);
      });

      if (points.length > 10) {
        const moreRow = document.createElement('tr');
        moreRow.innerHTML = `<td colspan="3" style="text-align:center;color:#9ca3af;font-style:italic;">... and ${points.length - 10} more points</td>`;
        this.elements.previewTable.appendChild(moreRow);
      }

      // Spacer
      const spacerRow = document.createElement('tr');
      spacerRow.innerHTML = '<td colspan="3" style="height:10px;"></td>';
      this.elements.previewTable.appendChild(spacerRow);
    });
  }

  handleImportJson(e) {
    const file = e.target.files[0];
    if (!file) return;

    this.showSpinner(true);

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const imported = JSON.parse(ev.target.result);
        
        // Restore state
        this.state.lines = this.state.validateLines(imported.lines);
        this.state.axisPoints = Array.isArray(imported.axisPoints) ? imported.axisPoints : [];
        this.state.scaleX = imported.scaleX;
        this.state.scaleY = imported.scaleY;
        this.state.offsetX = imported.offsetX;
        this.state.offsetY = imported.offsetY;
        this.state.logX = Boolean(imported.logX);
        this.state.logY = Boolean(imported.logY);
        this.state.isCalibrated = Boolean(imported.isCalibrated);
        this.state.zoom = Number(imported.zoom) || 1;
        this.state.panX = Number(imported.panX) || 0;
        this.state.panY = Number(imported.panY) || 0;
        this.state.showGrid = Boolean(imported.showGrid);
        this.state.mode = imported.mode || 'none';
        this.state.currentLineIndex = Number(imported.currentLineIndex) || 0;
        this.state.magnifierZoom = Number(imported.magnifierZoom) || 2;
        this.state.highlightWidth = Number(imported.highlightWidth) || 2;

        // Reset history
        this.state.history = [];
        this.state.historyIndex = -1;

        // Update UI
        this.updateLineSelect();
        this.updatePreview();
        this.updateButtonStates();
        this.elements.toggleLogXBtn.classList.toggle('log-active', this.state.logX);
        this.elements.toggleLogYBtn.classList.toggle('log-active', this.state.logY);
        this.elements.magnifierZoomInput.value = this.state.magnifierZoom;
        this.elements.highlightWidth.value = this.state.highlightWidth;
        
        if (this.state.isCalibrated) {
          this.elements.addPointBtn.disabled = false;
          this.elements.adjustPointBtn.disabled = false;
          this.elements.deletePointBtn.disabled = false;
          this.elements.highlightLineBtn.disabled = false;
          this.elements.clearPointsBtn.disabled = false;
          this.elements.sortPointsBtn.disabled = false;
          this.elements.newLineBtn.disabled = false;
          this.elements.renameLineBtn.disabled = false;
        }

        this.renderer.requestDraw();
        this.state.addToHistory();
        this.state.saveToLocalStorage();
        this.showSpinner(false);
        this.showModal('Data imported successfully!');
      } catch (err) {
        console.error('Import error:', err);
        this.showModal('Failed to import JSON. Please check the file format.');
        this.showSpinner(false);
      }
    };
    
    reader.onerror = () => {
      this.showModal('Failed to read file.');
      this.showSpinner(false);
    };
    
    reader.readAsText(file);
  }

  exportJson() {
    const data = {
      lines: this.state.lines,
      axisPoints: this.state.axisPoints,
      scaleX: this.state.scaleX,
      scaleY: this.state.scaleY,
      offsetX: this.state.offsetX,
      offsetY: this.state.offsetY,
      logX: this.state.logX,
      logY: this.state.logY,
      isCalibrated: this.state.isCalibrated,
      zoom: this.state.zoom,
      panX: this.state.panX,
      panY: this.state.panY,
      showGrid: this.state.showGrid,
      mode: this.state.mode,
      currentLineIndex: this.state.currentLineIndex,
      magnifierZoom: this.state.magnifierZoom,
      highlightWidth: this.state.highlightWidth
    };

    this.download('digitizer-data.json', JSON.stringify(data, null, 2), 'application/json');
  }

  exportCsv() {
    let csv = '';
    
    this.state.lines.forEach(line => {
      if (line.points.length === 0) return;
      
      csv += `"${line.name}"\n`;
      csv += 'X,Y\n';
      
      const points = line.sorted
        ? [...line.points].sort((a, b) => a.dataX - b.dataX)
        : [...line.points].sort((a, b) => a.order - b.order);
      
      points.forEach(p => {
        const dataX = isFinite(p.dataX) ? p.dataX : 'NaN';
        const dataY = isFinite(p.dataY) ? p.dataY : 'NaN';
        csv += `${dataX},${dataY}\n`;
      });
      
      csv += '\n';
    });

    this.download('digitizer-data.csv', csv, 'text/csv');
  }

  exportXlsx() {
    if (typeof XLSX === 'undefined') {
      this.showModal('XLSX library not loaded. Please refresh the page.');
      return;
    }

    try {
      const workbook = XLSX.utils.book_new();
      const allData = [];

      this.state.lines.forEach((line, index) => {
        if (line.points.length === 0) return;

        allData.push([line.name]);
        allData.push(['X', 'Y']);

        const points = line.sorted
          ? [...line.points].sort((a, b) => a.dataX - b.dataX)
          : [...line.points].sort((a, b) => a.order - b.order);

        points.forEach(p => {
          const dataX = isFinite(p.dataX) ? Number(p.dataX.toFixed(15)) : 'NaN';
          const dataY = isFinite(p.dataY) ? Number(p.dataY.toFixed(15)) : 'NaN';
          allData.push([dataX, dataY]);
        });

        if (index < this.state.lines.length - 1) {
          allData.push([]);
        }
      });

      if (allData.length === 0) {
        this.showModal('No data to export.');
        return;
      }

      const worksheet = XLSX.utils.aoa_to_sheet(allData);
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Digitized Data');
      XLSX.writeFile(workbook, 'digitizer-data.xlsx');
    } catch (err) {
      console.error('XLSX export error:', err);
      this.showModal('Failed to export XLSX file.');
    }
  }

  clearSession() {
    this.showModal('Clear all data and start fresh?', false, () => {
      this.state.reset();
      
      // Reset UI
      this.elements.axisInputs.style.display = 'none';
      this.elements.highlightControls.style.display = 'none';
      this.elements.toggleLogXBtn.classList.remove('log-active');
      this.elements.toggleLogYBtn.classList.remove('log-active');
      this.elements.sortPointsBtn.classList.remove('sort-active');
      
      this.updateAxisInstruction();
      this.elements.addPointBtn.disabled = true;
      this.elements.adjustPointBtn.disabled = true;
      this.elements.deletePointBtn.disabled = true;
      this.elements.highlightLineBtn.disabled = true;
      this.elements.clearPointsBtn.disabled = true;
      this.elements.sortPointsBtn.disabled = true;
      this.elements.newLineBtn.disabled = true;
      this.elements.renameLineBtn.disabled = true;
      this.elements.undoBtn.disabled = true;
      this.elements.redoBtn.disabled = true;
      
      this.updateLineSelect();
      this.updatePreview();
      this.updateButtonStates();
      this.renderer.requestDraw();
      
      this.showModal('Session cleared successfully.');
    });
  }

  undo() {
    if (this.state.undo()) {
      this.syncUIWithState();
      this.renderer.requestDraw();
      this.state.saveToLocalStorage();
    }
    this.updateHistoryButtons();
  }

  redo() {
    if (this.state.redo()) {
      this.syncUIWithState();
      this.renderer.requestDraw();
      this.state.saveToLocalStorage();
    }
    this.updateHistoryButtons();
  }

  syncUIWithState() {
    this.updateLineSelect();
    this.updatePreview();
    this.updateButtonStates();
    this.elements.toggleLogXBtn.classList.toggle('log-active', this.state.logX);
    this.elements.toggleLogYBtn.classList.toggle('log-active', this.state.logY);
    this.elements.magnifierZoomInput.value = this.state.magnifierZoom;
    this.elements.highlightWidth.value = this.state.highlightWidth;
    this.elements.highlightControls.style.display = this.state.mode === 'highlight' ? 'block' : 'none';
    this.elements.sortPointsBtn.classList.toggle('sort-active', this.state.lines[this.state.currentLineIndex].sorted);
    
    if (this.state.isCalibrated) {
      this.elements.axisInputs.style.display = 'none';
    } else if (this.state.mode === 'axes' && this.state.axisPoints.length > 0) {
      this.elements.axisInputs.style.display = 'block';
    }
    
    this.updateAxisInstruction();
  }

  updateHistoryButtons() {
    this.elements.undoBtn.disabled = !this.state.canUndo();
    this.elements.redoBtn.disabled = !this.state.canRedo();
  }

  zoom(factor) {
    this.state.zoom *= factor;
    this.state.zoom = Math.max(0.1, Math.min(10, this.state.zoom)); // Clamp between 0.1x and 10x
    this.renderer.requestDraw();
    this.state.saveToLocalStorage();
  }

  resetView() {
    this.state.zoom = 1;
    this.state.panX = 0;
    this.state.panY = 0;
    this.renderer.requestDraw();
    this.state.saveToLocalStorage();
  }

  togglePanMode() {
    this.state.isPanning = !this.state.isPanning;
    this.elements.canvas.style.cursor = this.state.isPanning ? 'move' : 'default';
    this.elements.panModeBtn.classList.toggle('active', this.state.isPanning);
    this.state.saveToLocalStorage();
  }

  updateButtonStates() {
    this.elements.addPointBtn.classList.toggle('active', this.state.mode === 'add');
    this.elements.adjustPointBtn.classList.toggle('active', this.state.mode === 'adjust');
    this.elements.deletePointBtn.classList.toggle('active', this.state.mode === 'delete');
    this.elements.highlightLineBtn.classList.toggle('active', this.state.mode === 'highlight');
    
    const cursor = this.state.isPanning ? 'move' 
      : (this.state.mode === 'highlight' || this.state.mode === 'axes') ? 'crosshair' 
      : 'default';
    
    this.elements.canvas.style.cursor = cursor;
    
    this.updateStatusBar();
  }

  updateStatusBar(x = null, y = null) {
    let text = `Mode: ${this.state.mode}`;
    
    if (x !== null && y !== null) {
      const transformer = new CoordinateTransformer(this.state);
      const dataCoords = transformer.canvasToData(x, y);
      
      if (dataCoords) {
        text += ` | Canvas: (${x.toFixed(2)}, ${y.toFixed(2)}) | Data: (${dataCoords.dataX.toFixed(4)}, ${dataCoords.dataY.toFixed(4)})`;
      } else {
        text += ` | Canvas: (${x.toFixed(2)}, ${y.toFixed(2)})`;
      }
    }
    
    if (this.state.isCalibrated) {
      const currentLine = this.state.lines[this.state.currentLineIndex];
      text += ` | Points: ${currentLine.points.length}`;
    }
    
    this.elements.statusBar.textContent = text;
  }

  handleKeyboard(e) {
    // Undo/Redo
    if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      this.undo();
    }
    if ((e.ctrlKey && e.key === 'y') || (e.ctrlKey && e.shiftKey && e.key === 'z')) {
      e.preventDefault();
      this.redo();
    }
    
    // Zoom
    if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      this.zoom(1.2);
    }
    if (e.key === '-' || e.key === '_') {
      e.preventDefault();
      this.zoom(1 / 1.2);
    }
    if (e.key === '0') {
      e.preventDefault();
      this.resetView();
    }
    
    // Mode shortcuts (only if calibrated)
    if (this.state.isCalibrated) {
      if (e.key === 'a' && !e.ctrlKey) {
        this.setMode('add');
      }
      if (e.key === 'h' && !e.ctrlKey) {
        this.setMode('highlight');
      }
      if (e.key === 'd' && !e.ctrlKey) {
        this.setMode('delete');
      }
      if (e.key === 'm' && !e.ctrlKey) {
        this.setMode('adjust');
      }
    }
    
    // Escape to cancel current mode
    if (e.key === 'Escape') {
      if (this.state.mode === 'highlight') {
        this.clearHighlightPath();
      }
      this.setMode('none');
    }
  }

  handleResize() {
    if (!this.state.img.src || !this.state.img.complete || this.state.img.naturalWidth <= 0) {
      return;
    }

    const maxWidth = window.innerWidth * 0.8;
    const maxHeight = window.innerHeight * 0.7;
    
    let canvasWidth = this.state.img.naturalWidth;
    let canvasHeight = this.state.img.naturalHeight;
    
    if (canvasWidth > maxWidth) {
      canvasHeight = (maxWidth / canvasWidth) * canvasHeight;
      canvasWidth = maxWidth;
    }
    
    if (canvasHeight > maxHeight) {
      canvasWidth = (maxHeight / canvasHeight) * canvasWidth;
      canvasHeight = maxHeight;
    }
    
    this.renderer.resizeCanvas(canvasWidth, canvasHeight);
  }

  showModal(message, withInput = false, callback = null) {
    const modal = this.elements.modal;
    const content = this.elements.modalContent;
    
    content.innerHTML = '';
    
    const p = document.createElement('p');
    p.textContent = message;
    p.style.marginBottom = '20px';
    content.appendChild(p);
    
    if (withInput) {
      const input = document.createElement('input');
      input.type = 'text';
      input.id = 'modal-input';
      input.style.width = '100%';
      input.style.padding = '8px';
      input.style.marginBottom = '20px';
      input.style.fontSize = '14px';
      input.style.border = '1px solid #4b5563';
      input.style.borderRadius = '4px';
      input.style.backgroundColor = '#374151';
      input.style.color = '#fff';
      content.appendChild(input);
    }
    
    const btnContainer = document.createElement('div');
    btnContainer.style.display = 'flex';
    btnContainer.style.justifyContent = 'center';
    btnContainer.style.gap = '10px';
    
    const okBtn = document.createElement('button');
    okBtn.textContent = 'OK';
    okBtn.style.padding = '8px 24px';
    okBtn.style.backgroundColor = '#2563eb';
    okBtn.style.color = '#fff';
    okBtn.style.border = 'none';
    okBtn.style.borderRadius = '4px';
    okBtn.style.cursor = 'pointer';
    okBtn.style.fontSize = '14px';
    
    okBtn.onclick = () => {
      modal.style.display = 'none';
      if (callback) {
        const value = withInput ? document.getElementById('modal-input').value : null;
        callback(value);
      }
    };
    
    btnContainer.appendChild(okBtn);
    
    if (callback) {
      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = 'Cancel';
      cancelBtn.style.padding = '8px 24px';
      cancelBtn.style.backgroundColor = '#4b5563';
      cancelBtn.style.color = '#fff';
      cancelBtn.style.border = 'none';
      cancelBtn.style.borderRadius = '4px';
      cancelBtn.style.cursor = 'pointer';
      cancelBtn.style.fontSize = '14px';
      
      cancelBtn.onclick = () => {
        modal.style.display = 'none';
      };
      
      btnContainer.appendChild(cancelBtn);
    }
    
    content.appendChild(btnContainer);
    modal.style.display = 'flex';
    
    if (withInput) {
      document.getElementById('modal-input').focus();
    }
  }

  showSpinner(show) {
    this.elements.spinner.style.display = show ? 'block' : 'none';
  }

  download(filename, text, mimeType) {
    const blob = new Blob([text], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

/**********************
 * INTERACTION HANDLER CLASS
 **********************/
class InteractionHandler {
  constructor(canvas, state, renderer, transformer, uiController) {
    this.canvas = canvas;
    this.state = state;
    this.renderer = renderer;
    this.transformer = transformer;
    this.uiController = uiController;
    this.setupEventListeners();
  }

  setupEventListeners() {
    this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
    this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
    this.canvas.addEventListener('mouseup', (e) => this.handleMouseUp(e));
    this.canvas.addEventListener('mouseleave', (e) => this.handleMouseLeave(e));
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  handleMouseDown(e) {
    if (this.state.isPanning && e.button === 0) {
      this.state.startPan.x = e.clientX - this.state.panX;
      this.state.startPan.y = e.clientY - this.state.panY;
      return;
    }

    if (e.button !== 0) return;

    const coords = this.transformer.imageToCanvas(e.clientX, e.clientY, this.canvas);
    let { x, y } = coords;

    switch (this.state.mode) {
      case 'axes':
        this.handleAxisClick(x, y);
        break;
      case 'add':
        this.handleAddPoint(x, y);
        break;
      case 'delete':
        this.handleDeletePoint(x, y);
        break;
      case 'adjust':
        this.handleAdjustStart(x, y);
        break;
      case 'highlight':
        this.handleHighlightStart(x, y);
        break;
    }
  }

  handleMouseMove(e) {
    if (this.state.isPanning && e.buttons === 1) {
      this.state.panX = e.clientX - this.state.startPan.x;
      this.state.panY = e.clientY - this.state.startPan.y;
      this.renderer.requestDraw();
      return;
    }

    const coords = this.transformer.imageToCanvas(e.clientX, e.clientY, this.canvas);
    let { x, y } = coords;

    // Constrain to orthogonal axes if needed
    if (this.state.mode === 'axes' && document.getElementById('orthogonal-axes').checked) {
      const axisPoints = this.state.axisPoints;
      const sharedOrigin = document.getElementById('shared-origin').checked;
      
      if (sharedOrigin) {
        if (axisPoints.length === 1) y = axisPoints[0].y;
        else if (axisPoints.length === 2) x = axisPoints[0].x;
      } else {
        if (axisPoints.length === 1) y = axisPoints[0].y;
        else if (axisPoints.length === 2) x = axisPoints[0].x;
        else if (axisPoints.length === 3) x = axisPoints[2].x;
      }
    }

    // Snap to grid if enabled
    if (this.state.isCalibrated && this.state.showGrid && 
        (this.state.mode === 'add' || this.state.mode === 'adjust')) {
      const snapped = this.transformer.snapToGrid(x, y);
      x = snapped.x;
      y = snapped.y;
    }

    // Update status bar
    this.uiController.updateStatusBar(x, y);

    // Show magnifier
    if (['axes', 'add', 'adjust', 'delete', 'highlight'].includes(this.state.mode)) {
      this.renderer.requestDrawMagnifier(e.clientX, e.clientY);
    }

    // Handle dragging
    if (this.state.isDraggingPoint && this.state.mode === 'adjust') {
      this.handleAdjustDrag(x, y);
    }

    // Handle highlighting
    if (this.state.isHighlighting && this.state.mode === 'highlight') {
      this.handleHighlightDrag(x, y);
    }
  }

  handleMouseUp(e) {
    if (e.button !== 0) return;

    if (this.state.isDraggingPoint && this.state.mode === 'adjust') {
      this.state.isDraggingPoint = false;
      this.state.selectedPointIndex = -1;
      this.state.addToHistory();
      this.state.saveToLocalStorage();
    }

    if (this.state.isHighlighting && this.state.mode === 'highlight') {
      this.handleHighlightEnd();
    }
  }

  handleMouseLeave() {
    this.uiController.elements.magnifier.style.display = 'none';
    this.uiController.updateStatusBar();
  }

  handleAxisClick(x, y) {
    const sharedOrigin = document.getElementById('shared-origin').checked;
    const requiredPoints = sharedOrigin ? 3 : 4;

    if (this.state.axisPoints.length >= requiredPoints) return;

    const label = sharedOrigin && this.state.axisPoints.length === 0
      ? 'Origin (X1/Y1)'
      : this.state.axisLabels[this.state.axisPoints.length];

    this.state.axisPoints.push({ x, y, label });

    this.uiController.elements.axisInputs.style.display = 'block';
    this.uiController.updateAxisInstruction();
    this.uiController.elements.calibrateBtn.disabled = this.state.axisPoints.length !== requiredPoints;

    this.renderer.requestDraw();
    this.state.addToHistory();
    this.state.saveToLocalStorage();
  }

  handleAddPoint(x, y) {
    if (!this.state.isCalibrated) return;

    const dataCoords = this.transformer.canvasToData(x, y);
    if (!dataCoords) {
      this.uiController.showModal('Cannot add point: Invalid coordinates.');
      return;
    }

    const line = this.state.lines[this.state.currentLineIndex];
    line.points.push({
      x,
      y,
      dataX: dataCoords.dataX,
      dataY: dataCoords.dataY,
      order: ++line.orderCounter
    });

    this.uiController.updatePreview();
    this.renderer.requestDraw();
    this.state.addToHistory();
    this.state.saveToLocalStorage();
  }

  handleDeletePoint(x, y) {
    if (!this.state.isCalibrated) return;

    const index = this.findNearestPointIndex(x, y);
    if (index !== -1) {
      this.state.lines[this.state.currentLineIndex].points.splice(index, 1);
      this.uiController.updatePreview();
      this.renderer.requestDraw();
      this.state.addToHistory();
      this.state.saveToLocalStorage();
    }
  }

  handleAdjustStart(x, y) {
    if (!this.state.isCalibrated) return;

    const index = this.findNearestPointIndex(x, y);
    if (index !== -1) {
      this.state.selectedPointIndex = index;
      this.state.isDraggingPoint = true;
    }
  }

  handleAdjustDrag(x, y) {
    const dataCoords = this.transformer.canvasToData(x, y);
    if (!dataCoords) return;

    const point = this.state.lines[this.state.currentLineIndex].points[this.state.selectedPointIndex];
    point.x = x;
    point.y = y;
    point.dataX = dataCoords.dataX;
    point.dataY = dataCoords.dataY;

    this.uiController.updatePreview();
    this.renderer.requestDraw();
  }

  handleHighlightStart(x, y) {
    if (!this.state.isCalibrated) return;

    this.state.isHighlighting = true;
    this.state.highlightPath = [{ x, y }];
    this.renderer.requestDraw();
  }

  handleHighlightDrag(x, y) {
    const last = this.state.highlightPath[this.state.highlightPath.length - 1];
    const distance = Math.hypot(x - last.x, y - last.y);

    if (distance > 3 / this.state.zoom) {
      this.state.highlightPath.push({ x, y });
      this.renderer.requestDraw();
    }
  }

  handleHighlightEnd() {
    this.state.isHighlighting = false;

    if (this.state.highlightPath.length < 10) {
      this.uiController.showModal('Highlight path is too short. Please draw a longer line.');
      this.state.highlightPath = [];
      this.renderer.requestDraw();
      return;
    }

    const nPoints = parseInt(this.uiController.elements.nPointsInput.value);
    if (isNaN(nPoints) || nPoints <= 0 || nPoints > 1000) {
      this.uiController.showModal('Please enter a valid number of points (1-1000).');
      this.state.highlightPath = [];
      this.renderer.requestDraw();
      return;
    }

    let lineName = this.uiController.elements.highlightLineName.value.trim() || 
                   `Highlighted Line ${this.state.lines.length + 1}`;

    // Ensure unique name
    if (this.state.lines.some(line => line.name === lineName)) {
      let suffix = 1;
      while (this.state.lines.some(line => line.name === `${lineName} (${suffix})`)) {
        suffix++;
      }
      lineName = `${lineName} (${suffix})`;
    }

    // Create new line
    const newLine = {
      name: lineName,
      points: [],
      sorted: false,
      orderCounter: 0
    };

    // Interpolate points along path
    const spacedPoints = this.interpolatePathPoints(this.state.highlightPath, nPoints);

    spacedPoints.forEach(p => {
      const dataCoords = this.transformer.canvasToData(p.x, p.y);
      if (dataCoords) {
        newLine.points.push({
          x: p.x,
          y: p.y,
          dataX: dataCoords.dataX,
          dataY: dataCoords.dataY,
          order: ++newLine.orderCounter
        });
      }
    });

    this.state.lines.push(newLine);
    this.state.currentLineIndex = this.state.lines.length - 1;
    this.state.highlightPath = [];

    this.uiController.updateLineSelect();
    this.uiController.updatePreview();
    this.renderer.requestDraw();
    this.state.addToHistory();
    this.state.saveToLocalStorage();
  }

  findNearestPointIndex(x, y) {
    const line = this.state.lines[this.state.currentLineIndex];
    const threshold = 10 / this.state.zoom;

    let minDist = Infinity;
    let closestIndex = -1;

    line.points.forEach((p, i) => {
      const dist = Math.hypot(p.x - x, p.y - y);
      if (dist < minDist && dist < threshold) {
        minDist = dist;
        closestIndex = i;
      }
    });

    return closestIndex;
  }

  interpolatePathPoints(path, n) {
    if (path.length < 2) return path;

    // Calculate total path length
    let totalLength = 0;
    for (let i = 1; i < path.length; i++) {
      const dx = path[i].x - path[i - 1].x;
      const dy = path[i].y - path[i - 1].y;
      totalLength += Math.sqrt(dx * dx + dy * dy);
    }

    if (totalLength === 0) return [path[0]];

    const segmentLength = totalLength / (n - 1);
    const result = [path[0]];

    let accumulatedLength = 0;
    for (let i = 1; i < path.length && result.length < n; i++) {
      const dx = path[i].x - path[i - 1].x;
      const dy = path[i].y - path[i - 1].y;
      const segment = Math.sqrt(dx * dx + dy * dy);

      accumulatedLength += segment;

      while (result.length < n && accumulatedLength >= segmentLength * result.length) {
        const t = (segmentLength * result.length - (accumulatedLength - segment)) / segment;
        result.push({
          x: path[i - 1].x + t * dx,
          y: path[i - 1].y + t * dy
        });
      }
    }

    return result.slice(0, n);
  }
}

/**********************
 * INITIALIZATION
 **********************/
document.addEventListener('DOMContentLoaded', () => {
  // Initialize state
  const state = new DigitizerState();

  // Initialize components
  const canvas = document.getElementById('canvas');
  const magnifier = document.getElementById('magnifier');
  const transformer = new CoordinateTransformer(state);
  const renderer = new Renderer(canvas, magnifier, state, transformer);
  const uiController = new UIController(state, renderer);
  const interactionHandler = new InteractionHandler(canvas, state, renderer, transformer, uiController);

  // Load saved session
  const loaded = state.loadFromLocalStorage();
  if (loaded) {
    uiController.syncUIWithState();
    renderer.requestDraw();
  }

  // Apply theme
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'dark') {
    document.body.classList.add('dark');
  }

  // Theme toggle
  document.getElementById('toggle-theme').addEventListener('click', () => {
    document.body.classList.toggle('dark');
    localStorage.setItem('theme', document.body.classList.contains('dark') ? 'dark' : 'light');
  });

  // Initial draw
  renderer.requestDraw();

  console.log('Enhanced Graph Digitizer initialized successfully');
});
