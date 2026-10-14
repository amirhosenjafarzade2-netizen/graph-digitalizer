/* Graph Digitizer Pro — Table / Number Extractor (OCR)
 *
 * Uses Tesseract.js to find numeric values (and simple tables) on the graph image.
 * Review-first: detected values are listed so the user can name / filter them
 * before adding them as datasets.
 *
 * Public surface (same spirit as the curve detector):
 *   window.refreshTableOcrState()
 *   window.resetTableOcr()
 *
 * Requires: digitizer-core.js (hasImage, getPixelData, isCalibrated,
 *           canvasToDataCoords, showSpinner, saveState, updateLineSelect,
 *           updatePreview, updateButtonStates, draw, lines, …)
 */

(() => {
  const $ = id => document.getElementById(id);
  const detectBtn = $('te-detect');
  if (!detectBtn) return;               // HTML panel not present yet

  const status     = $('te-status');
  const resultsBox = $('te-results');
  const addBtn     = $('te-add-results');
  const clearBtn   = $('te-clear-preview');
  const previewToggle = $('te-preview');
  const langSelect = $('te-lang');
  const minConf    = $('te-min-conf');
  const detNumbers = $('te-detect-numbers');
  const detWords   = $('te-detect-words');
  const detGrid    = $('te-detect-grid');
  const exportBtn  = $('te-export-xlsx');
  const manualToggle = $('te-manual-grid');
  const manualUndo   = $('te-manual-undo');
  const manualClear  = $('te-manual-clear');

  let worker = null;                    // reusable Tesseract worker
  let manualDots = [];                 // [{x,y}] image coords; every 2 dots = 1 line
  let manualHover = null;              // live cursor position while a dot is pending
  let lastTable = [];                  // rows of cell strings/numbers for Excel
  let lastTokens = [];                 // every accepted OCR token
  let detectedItems = [];               // [{name, color, points, text, conf, bbox}]
  let previewCanvas = null;
  let previewDims   = null;

  const palette = ['#ff2d95','#00a8ff','#a0c900','#ff8c00','#a78bfa','#00a878','#ff4e4e','#8a5a2b','#00b9b0','#d14dff'];

  const setStatus = msg => { if (status) status.textContent = msg; };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  /* ------------------------------------------------------------------ */
  /*  Tesseract loading & worker management                             */
  /* ------------------------------------------------------------------ */
  const TESS_CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@7/dist/tesseract.min.js';

  function loadTesseract() {
    return new Promise((resolve, reject) => {
      if (window.Tesseract) return resolve(window.Tesseract);
      const s = document.createElement('script');
      s.src = TESS_CDN;
      s.onload  = () => resolve(window.Tesseract);
      s.onerror = () => reject(new Error('Failed to load Tesseract.js from CDN'));
      document.head.appendChild(s);
    });
  }

  let workerLang = null;
  async function getWorker(lang = 'eng') {
    if (worker && workerLang === lang) return worker;
    if (worker) await terminateWorker();
    const T = await loadTesseract();
    setStatus('Loading OCR engine (first time may take a few seconds)…');
    worker = await T.createWorker(lang, 1, {
      logger: m => {
        if (m.status === 'recognizing text') {
          setStatus(`OCR progress: ${Math.round((m.progress || 0) * 100)}%`);
        }
      }
    });
    workerLang = lang;
    return worker;
  }

  async function terminateWorker() {
    if (worker) {
      await worker.terminate();
      worker = null;
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Ready / state helpers                                             */
  /* ------------------------------------------------------------------ */
  function ready() {
    detectBtn.disabled = !(typeof hasImage === 'function' && hasImage());
  }
  window.refreshTableOcrState = ready;

  document.addEventListener('imageLoaded', () => {
    clearDetection();
    manualDots = []; manualHover = null;
    if (manualToggle) manualToggle.checked = false;
    if (manualUndo) manualUndo.disabled = true;
    if (manualClear) manualClear.disabled = true;
    setStatus('Image loaded. Calibrate axes (optional) then detect numbers / tables.');
    ready();
  });
  document.addEventListener('calibrationComplete', ready);

  /* ------------------------------------------------------------------ */
  /*  Number / table parsing helpers                                    */
  /* ------------------------------------------------------------------ */
  /** Strict number parser: returns NaN unless the whole token is a number. */
  function parseNumber(str) {
    if (!str) return NaN;
    let s = String(str).trim().replace(/[\u2212\u2013\u2014]/g, '-').replace(/\s+/g, '');
    s = s.replace(/%$/, '');
    if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');   // 1,234.5
    else s = s.replace(',', '.');                                            // 1,5 -> 1.5
    if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) return NaN;
    const n = parseFloat(s);
    return isFinite(n) ? n : NaN;
  }

  /** Tesseract v5+ nests words in blocks > paragraphs > lines; v4 had data.words. */
  function extractWords(data) {
    if (Array.isArray(data.words) && data.words.length) return data.words;
    const out = [];
    (data.blocks || []).forEach(b =>
      (b.paragraphs || []).forEach(p =>
        (p.lines || []).forEach(l =>
          (l.words || []).forEach(w => out.push(w)))));
    return out;
  }

  const median = arr => {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };

  /** Group tokens into rows by vertical centre. */
  function groupIntoRows(words, yTol) {
    if (!words.length) return [];
    const sorted = [...words].sort((a, b) => a.y - b.y || a.bbox.x0 - b.bbox.x0);
    const rows = [];
    let current = [sorted[0]], rowY = sorted[0].y;
    for (let i = 1; i < sorted.length; i++) {
      const w = sorted[i];
      if (Math.abs(w.y - rowY) <= yTol) {
        current.push(w);
        rowY = current.reduce((s, t) => s + t.y, 0) / current.length;
      } else {
        rows.push(current.sort((a, b) => a.bbox.x0 - b.bbox.x0));
        current = [w]; rowY = w.y;
      }
    }
    rows.push(current.sort((a, b) => a.bbox.x0 - b.bbox.x0));
    return rows;
  }

  /** Column bands from horizontal projection of all tokens. */
  function findColumns(rows, gapTol) {
    const spans = rows.flat().map(t => [t.bbox.x0, t.bbox.x1]).sort((a, b) => a[0] - b[0]);
    const cols = [];
    spans.forEach(([a, b]) => {
      const last = cols[cols.length - 1];
      if (last && a <= last[1] + gapTol) last[1] = Math.max(last[1], b);
      else cols.push([a, b]);
    });
    return cols;
  }

  /** Build a rectangular grid: grid[r][c] = {text,value,x,y,conf} | null */
  function buildGrid(tokens) {
    const mh = median(tokens.map(t => t.bbox.y1 - t.bbox.y0)) || 12;
    const rows = groupIntoRows(tokens, mh * 0.6);
    const cols = findColumns(rows, mh * 0.9);
    const grid = rows.map(row => {
      const cells = cols.map(() => []);
      row.forEach(t => {
        let ci = cols.findIndex(c => t.x >= c[0] && t.x <= c[1]);
        if (ci < 0) ci = 0;
        cells[ci].push(t);
      });
      return cells.map(list => {
        if (!list.length) return null;
        const text = list.map(t => t.text).join(' ');
        const n = list.length === 1 ? list[0].value : parseNumber(text);
        return {
          text, value: n,
          x: list.reduce((s, t) => s + t.x, 0) / list.length,
          y: list.reduce((s, t) => s + t.y, 0) / list.length,
          conf: list.reduce((s, t) => s + t.conf, 0) / list.length
        };
      });
    });
    return grid;
  }

  /* ------------------------------------------------------------------ */
  /*  Core detection                                                    */
  /* ------------------------------------------------------------------ */
  async function runOCR() {
    if (!hasImage()) { setStatus('Upload a graph image first.'); return; }

    const wantNum   = detNumbers ? detNumbers.checked : true;
    const wantWords = detWords   ? detWords.checked   : true;
    const wantGrid  = detGrid    ? detGrid.checked    : true;
    if (!wantNum && !wantWords) { setStatus('Tick “Detect numbers” and/or “Detect words / labels”.'); return; }

    const imageData = getPixelData();
    const w = imageData.width, h = imageData.height;

    // Upscale small images – Tesseract is far more accurate on larger glyphs
    const scale = Math.max(1, Math.min(3, Math.round(2000 / Math.max(w, h))));
    const src = document.createElement('canvas');
    src.width = w; src.height = h;
    src.getContext('2d').putImageData(imageData, 0, 0);
    let tmp = src;
    if (scale > 1) {
      tmp = document.createElement('canvas');
      tmp.width = w * scale; tmp.height = h * scale;
      const tc = tmp.getContext('2d');
      tc.imageSmoothingEnabled = true; tc.imageSmoothingQuality = 'high';
      tc.drawImage(src, 0, 0, tmp.width, tmp.height);
    }

    const lang = (langSelect && langSelect.value) || 'eng';
    const confThreshold = Number(minConf?.value) || 45;

    showSpinner(true);
    detectBtn.disabled = true;
    setStatus('Running OCR…');

    try {
      const wkr = await getWorker(lang);
      const { data } = await wkr.recognize(tmp, {}, { text: true, blocks: true });

      const tokens = [];
      extractWords(data).forEach(wd => {
        const text = (wd.text || '').trim();
        if (!text || wd.confidence < confThreshold) return;
        const value = parseNumber(text);
        const isNum = isFinite(value);
        if (isNum ? !wantNum : !wantWords) return;
        const b = wd.bbox || {};
        const bbox = { x0: b.x0 / scale, y0: b.y0 / scale, x1: b.x1 / scale, y1: b.y1 / scale };
        tokens.push({
          text, value, conf: wd.confidence, bbox,
          x: (bbox.x0 + bbox.x1) / 2, y: (bbox.y0 + bbox.y1) / 2
        });
      });
      lastTokens = tokens;
      previewDims = { w, h };
      buildResults();
    } catch (err) {
      console.error('OCR failed', err);
      setStatus(`OCR failed: ${err.message || err}`);
      clearDetection();
    } finally {
      showSpinner(false);
      ready();
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Manual grid (user-drawn cell lines)                               */
  /* ------------------------------------------------------------------ */
  /** Each consecutive pair of dots becomes one horizontal or vertical line. */
  function manualSegments() {
    const segs = [];
    for (let i = 0; i + 1 < manualDots.length; i += 2) {
      const p = manualDots[i], q = manualDots[i + 1];
      if (Math.abs(q.x - p.x) >= Math.abs(q.y - p.y)) {
        segs.push({ o: 'h', pos: (p.y + q.y) / 2, a: Math.min(p.x, q.x), b: Math.max(p.x, q.x) });
      } else {
        segs.push({ o: 'v', pos: (p.x + q.x) / 2, a: Math.min(p.y, q.y), b: Math.max(p.y, q.y) });
      }
    }
    return segs;
  }

  function clusterValues(vals, tol) {
    const sorted = [...new Set(vals)].sort((a, b) => a - b);
    const centers = [];
    sorted.forEach(v => {
      const last = centers[centers.length - 1];
      if (last && v - last.max <= tol) { last.max = v; last.vals.push(v); }
      else centers.push({ max: v, vals: [v] });
    });
    return centers.map(c => c.vals);
  }

  /** Assign every token to the cell enclosed by the nearest lines around it. */
  function buildManualGrid(tokens) {
    const segs = manualSegments();
    const H = segs.filter(s => s.o === 'h'), V = segs.filter(s => s.o === 'v');
    const mh = median(tokens.map(t => t.bbox.y1 - t.bbox.y0)) || 12;
    const pad = Math.max(8, mh * 0.8);              // forgive lines that stop slightly short
    const cells = new Map();

    tokens.forEach(t => {
      let top = null, bot = null, left = null, right = null;
      H.forEach((s, i) => {
        if (t.x < s.a - pad || t.x > s.b + pad) return;
        if (s.pos <= t.y && (!top || s.pos > top.pos)) top = { pos: s.pos, i };
        if (s.pos >  t.y && (!bot || s.pos < bot.pos)) bot = { pos: s.pos, i };
      });
      V.forEach((s, i) => {
        if (t.y < s.a - pad || t.y > s.b + pad) return;
        if (s.pos <= t.x && (!left  || s.pos > left.pos))  left  = { pos: s.pos, i };
        if (s.pos >  t.x && (!right || s.pos < right.pos)) right = { pos: s.pos, i };
      });
      // A token belongs to the table only if it is enclosed vertically or horizontally
      if (!((top && bot) || (left && right))) return;
      const key = [top, bot, left, right].map(v => (v ? v.i : '-')).join('|');
      let c = cells.get(key);
      if (!c) { c = { top, left, tokens: [] }; cells.set(key, c); }
      c.tokens.push(t);
    });

    const list = [...cells.values()].map(c => {
      const ys = c.tokens.map(t => t.bbox.y0), xs = c.tokens.map(t => t.bbox.x0);
      return { ...c, rowKey: c.top ? c.top.pos : Math.min(...ys), colKey: c.left ? c.left.pos : Math.min(...xs) };
    });
    if (!list.length) return null;

    const rowGroups = clusterValues(list.map(c => c.rowKey), Math.max(6, mh * 0.6));
    const colGroups = clusterValues(list.map(c => c.colKey), Math.max(6, mh * 0.6));
    const idx = (groups, v) => groups.findIndex(g => g.includes(v));

    const grid = rowGroups.map(() => colGroups.map(() => null));
    list.forEach(c => {
      const r = idx(rowGroups, c.rowKey), k = idx(colGroups, c.colKey);
      const lines = groupIntoRows(c.tokens, mh * 0.6);
      const text = lines.map(l => l.map(t => t.text).join(' ')).join(' ');
      const val = c.tokens.length === 1 ? c.tokens[0].value : parseNumber(text);
      const cell = {
        text, value: val,
        x: c.tokens.reduce((s, t) => s + t.x, 0) / c.tokens.length,
        y: c.tokens.reduce((s, t) => s + t.y, 0) / c.tokens.length,
        conf: c.tokens.reduce((s, t) => s + t.conf, 0) / c.tokens.length
      };
      const old = grid[r][k];
      if (old) {            // two cells landed on one slot – merge their text
        old.text += ' ' + cell.text;
        old.value = parseNumber(old.text);
      } else grid[r][k] = cell;
    });
    return grid;
  }

  /** Rebuild datasets / Excel table from the tokens already detected. */
  function buildResults() {
  const tokens = lastTokens;
  const wantGrid  = detGrid ? detGrid.checked : true;
  lastTable = [];
  detectedItems = [];

  const cal = () => (typeof isCalibrated !== 'undefined' && isCalibrated);
  let grid = null;
  const usingManual = manualSegments().length > 0;
  if (usingManual) {
    grid = buildManualGrid(tokens);
  } else if (wantGrid && tokens.length >= 4) {
    grid = buildGrid(tokens);
    if (grid.length < 2 || (grid[0] || []).length < 2) grid = null;
  }
  if (usingManual && !grid) setStatus('Manual grid: no text fell inside the lines you drew. Draw lines so that each row is bounded top & bottom.');

  if (grid) {
    const nCols = grid[0].length;
    // Header row = first row if it has any non-numeric cell
    const hasHeader = grid[0].some(c => c && !isFinite(c.value));
    const header = hasHeader ? grid[0].map((c, i) => (c ? c.text : `Column ${i + 1}`)) : null;
    const body = hasHeader ? grid.slice(1) : grid;

    // Excel table (numbers stay numeric)
    if (header) lastTable.push(header);
    body.forEach(r => lastTable.push(r.map(c => !c ? '' : (isFinite(c.value) ? c.value : c.text))));

    const numCols = [];
    for (let c = 0; c < nCols; c++) {
      const cells = body.map(r => r[c]).filter(x => x && isFinite(x.value));
      if (cells.length >= Math.max(1, body.length / 2)) numCols.push(c);
    }
    const xCol = numCols.length >= 2 ? numCols[0] : -1;
    numCols.forEach((c, k) => {
      if (c === xCol) return;
      const pts = [];
      body.forEach((r, ri) => {
        const cell = r[c];
        if (!cell || !isFinite(cell.value)) return;
        const xc = xCol >= 0 ? r[xCol] : null;
        pts.push({
          x: cell.x, y: cell.y,
          dataX: xc && isFinite(xc.value) ? xc.value : ri + 1,
          dataY: cell.value,
          literal: true,                       // keep the table value, don't re-project pixels
          order: pts.length + 1, raw: cell.text, conf: cell.conf
        });
      });
      if (!pts.length) return;
      detectedItems.push({
        name: header ? header[c] : `OCR Column ${c + 1}`,
        color: palette[k % palette.length], points: pts,
        meta: `${pts.length} cells`, groups: []
      });
    });
  }

  if (!detectedItems.length) {
    // Flat list of numbers → one scatter-style dataset
    const nums = tokens.filter(t => isFinite(t.value));
    const pts = nums.map((c, i) => {
      const dc = cal() ? canvasToDataCoords(c.x, c.y) : null;
      return {
        x: c.x, y: c.y,
        dataX: dc ? dc.dataX : c.x,
        dataY: dc ? dc.dataY : c.value,
        literal: !dc, order: i + 1, raw: c.text, conf: c.conf
      };
    });
    if (pts.length) detectedItems.push({
      name: 'OCR Numbers', color: palette[0], points: pts,
      meta: `${pts.length} values`, groups: []
    });
  }

  if (!lastTable.length && tokens.length) {
    // No grid: still give Excel one row per text line
    groupIntoRows(tokens, (median(tokens.map(t => t.bbox.y1 - t.bbox.y0)) || 12) * 0.6)
      .forEach(r => lastTable.push(r.map(t => (isFinite(t.value) ? t.value : t.text))));
  }

  renderResults();
  renderPreview();
  updateExportState();

  if (!tokens.length) {
    setStatus('No text found above the confidence threshold. Lower “Min confidence” or enable more detection types.');
  } else {
    setStatus(`Found ${tokens.length} token(s)${grid ? ` in a ${grid.length}×${grid[0].length} ${usingManual ? 'manual ' : ''}grid` : ''}; ${detectedItems.length} dataset(s). Use “Export OCR to Excel” or “Add Named Datasets”.`);
  }
  }

  /* ------------------------------------------------------------------ */
  /*  Excel export (OCR only)                                           */
  /* ------------------------------------------------------------------ */
  function updateExportState() {
    if (exportBtn) exportBtn.disabled = !(lastTable.length || lastTokens.length);
  }

  function exportOcrXlsx() {
    if (typeof XLSX === 'undefined') { setStatus('Excel library (SheetJS) not loaded.'); return; }
    if (!lastTable.length && !lastTokens.length) { setStatus('Nothing to export – run detection first.'); return; }
    try {
      const wb = XLSX.utils.book_new();
      if (lastTable.length) {
        const ws = XLSX.utils.aoa_to_sheet(lastTable);
        const widths = [];
        lastTable.forEach(r => r.forEach((v, i) => {
          widths[i] = Math.max(widths[i] || 6, String(v).length + 2);
        }));
        ws['!cols'] = widths.map(wch => ({ wch: Math.min(wch, 50) }));
        XLSX.utils.book_append_sheet(wb, ws, 'OCR Table');
      }
      if (lastTokens.length) {
        const rows = [['Text', 'Number', 'Confidence %', 'Pixel X', 'Pixel Y']];
        lastTokens.forEach(t => rows.push([
          t.text, isFinite(t.value) ? t.value : '',
          Math.round(t.conf), Math.round(t.x), Math.round(t.y)
        ]));
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'OCR Tokens');
      }
      XLSX.writeFile(wb, 'ocr-export.xlsx');
      setStatus('Exported ocr-export.xlsx');
    } catch (err) {
      console.error(err);
      setStatus(`Excel export failed: ${err.message || err}`);
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Preview overlay (same pattern as curve detector)                  */
  /* ------------------------------------------------------------------ */
  function drawManualGrid(c) {
    const z = Math.max(zoom, 0.0001);
    const segs = manualSegments();
    c.lineWidth = 2 / z;
    c.strokeStyle = '#00e5ff';
    c.setLineDash([]);
    segs.forEach(s => {
      c.beginPath();
      if (s.o === 'h') { c.moveTo(s.a, s.pos); c.lineTo(s.b, s.pos); }
      else             { c.moveTo(s.pos, s.a); c.lineTo(s.pos, s.b); }
      c.stroke();
    });
    // pending dot + live H/V preview
    if (manualDots.length % 2 === 1 && manualHover) {
      const p = manualDots[manualDots.length - 1], q = manualHover;
      c.setLineDash([6 / z, 4 / z]);
      c.strokeStyle = '#ffb300';
      c.beginPath();
      if (Math.abs(q.x - p.x) >= Math.abs(q.y - p.y)) { c.moveTo(p.x, p.y); c.lineTo(q.x, p.y); }
      else                                              { c.moveTo(p.x, p.y); c.lineTo(p.x, q.y); }
      c.stroke();
      c.setLineDash([]);
    }
    manualDots.forEach((d, i) => {
      c.fillStyle = (i === manualDots.length - 1 && manualDots.length % 2 === 1) ? '#ffb300' : '#ff2d95';
      c.beginPath(); c.arc(d.x, d.y, 4 / z, 0, Math.PI * 2); c.fill();
    });
  }

  function refreshOverlay() {
    let overlay = document.getElementById('te-overlay');
    if (!previewCanvas && !manualDots.length) {
      if (overlay) overlay.getContext('2d').clearRect(0, 0, overlay.width, overlay.height);
      return;
    }
    if (!overlay) {
      overlay = document.createElement('canvas');
      overlay.id = 'te-overlay';
      Object.assign(overlay.style, {
        position: 'absolute', inset: '0', width: '100%', height: '100%',
        pointerEvents: 'none', zIndex: '3', opacity: '1'
      });
      canvasContainer.appendChild(overlay);
    }
    if (overlay.width  !== canvas.width)  overlay.width  = canvas.width;
    if (overlay.height !== canvas.height) overlay.height = canvas.height;
    const ctx2 = overlay.getContext('2d');
    ctx2.setTransform(1, 0, 0, 1, 0, 0);
    ctx2.clearRect(0, 0, overlay.width, overlay.height);
    ctx2.imageSmoothingEnabled = false;
    ctx2.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * panX, dpr * panY);
    if (previewCanvas) ctx2.drawImage(previewCanvas, 0, 0);
    drawManualGrid(ctx2);
  }
  window.refreshTableOcrOverlay = refreshOverlay;

  function dropPreview() {
    previewCanvas = null;
    refreshOverlay();
  }

  function renderPreview() {
    if (!previewToggle || !previewToggle.checked || !detectedItems.length || !previewDims) {
      dropPreview();
      return;
    }
    const { w, h } = previewDims;
    previewCanvas = previewCanvas || document.createElement('canvas');
    previewCanvas.width = w;
    previewCanvas.height = h;
    const c = previewCanvas.getContext('2d');
    c.clearRect(0, 0, w, h);

    detectedItems.forEach(item => {
      c.fillStyle = item.color;
      c.strokeStyle = item.color;
      c.lineWidth = 1.5;
      item.points.forEach(p => {
        c.beginPath();
        c.arc(p.x, p.y, 4, 0, Math.PI * 2);
        c.fill();
        // tiny label
        c.font = '10px monospace';
        c.fillText(p.raw || '', p.x + 6, p.y - 4);
      });
    });
    refreshOverlay();
  }

  /* ------------------------------------------------------------------ */
  /*  Results UI                                                        */
  /* ------------------------------------------------------------------ */
  function renderResults() {
    resultsBox.innerHTML = '';
    if (!detectedItems.length) {
      addBtn.disabled = true;
      return;
    }
    detectedItems.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'cd-result-row';

      const swatch = document.createElement('input');
      swatch.type = 'color';
      swatch.className = 'cd-result-color';
      swatch.value = item.color;
      swatch.title = 'Dataset color';

      const name = document.createElement('input');
      name.type = 'text';
      name.className = 'cd-result-name';
      name.value = item.name;
      name.placeholder = `Dataset ${index + 1}`;
      name.style.borderLeft = `4px solid ${item.color}`;

      const meta = document.createElement('span');
      meta.className = 'cd-result-meta';
      meta.textContent = `${item.points.length} pts`;
      meta.title = item.meta || '';

      swatch.addEventListener('input', () => {
        item.color = swatch.value;
        name.style.borderLeft = `4px solid ${item.color}`;
        renderPreview();
      });
      name.addEventListener('input', () => { item.name = name.value; });

      row.append(swatch, name, meta);
      resultsBox.appendChild(row);
    });
    addBtn.disabled = false;
  }

  function clearDetection() {
    detectedItems = [];
    lastTable = []; lastTokens = [];
    updateExportState();
    previewDims = null;
    dropPreview();
    renderResults();
  }

  /* ------------------------------------------------------------------ */
  /*  Add to project                                                    */
  /* ------------------------------------------------------------------ */
  function addToProject() {
    if (!detectedItems.length) return;
    const existingNames = new Set(lines.map(l => l.name));
    const additions = [];

    detectedItems.forEach((r, index) => {
      // Re-project through current calibration (in case user recalibrated)
      const pts = [];
      r.points.forEach(p => {
        const dc = (!p.literal && typeof isCalibrated !== 'undefined' && isCalibrated)
          ? canvasToDataCoords(p.x, p.y)
          : null;
        pts.push({
          x: p.x, y: p.y,
          dataX: dc ? dc.dataX : p.dataX,
          dataY: dc ? dc.dataY : p.dataY,
          order: pts.length + 1
        });
      });
      if (!pts.length) return;

      const base = (r.name || '').trim() || `OCR Dataset ${index + 1}`;
      let name = base, suffix = 2;
      while (existingNames.has(name)) name = `${base} (${suffix++})`;
      existingNames.add(name);

      additions.push({
        name,
        color: r.color,
        points: pts,
        sorted: false,
        orderCounter: pts.length
      });
    });

    if (!additions.length) {
      setStatus('No valid datasets to add.');
      return;
    }

    lines.push(...additions);
    currentLineIndex = lines.length - 1;
    saveState();
    updateLineSelect();
    updatePreview();
    updateButtonStates();
    draw();

    const n = additions.length;
    clearDetection();
    setStatus(`Added ${n} OCR dataset(s). Switch active dataset from Line Management.`);
  }

  /* ------------------------------------------------------------------ */
  /*  Public reset                                                      */
  /* ------------------------------------------------------------------ */
  window.resetTableOcr = function () {
    clearDetection();
    manualDots = []; manualHover = null;
    if (manualToggle) manualToggle.checked = false;
    refreshOverlay();
    if (langSelect) langSelect.value = 'eng';
    if (minConf) { minConf.value = '45'; if ($('te-min-conf-val')) $('te-min-conf-val').textContent = '45'; }
    if (detNumbers) detNumbers.checked = true;
    if (detWords) detWords.checked = true;
    if (detGrid) detGrid.checked = true;
    if (previewToggle) previewToggle.checked = true;
    setStatus('Upload an image to extract numbers / tables with OCR.');
    ready();
    terminateWorker();          // free memory
  };

  /* ------------------------------------------------------------------ */
  /*  Event wiring                                                      */
  /* ------------------------------------------------------------------ */
  detectBtn.addEventListener('click', runOCR);
  addBtn.addEventListener('click', addToProject);
  if (exportBtn) exportBtn.addEventListener('click', exportOcrXlsx);
  if (clearBtn) clearBtn.addEventListener('click', () => {
    if (previewToggle) previewToggle.checked = false;
    dropPreview();
    setStatus('OCR preview hidden.');
  });
  if (previewToggle) previewToggle.addEventListener('change', renderPreview);

  if (minConf) {
    minConf.addEventListener('input', () => {
      if ($('te-min-conf-val')) $('te-min-conf-val').textContent = minConf.value;
    });
  }

  /* Manual grid mode: dots are captured before the core tools see the click */
  function manualActive() { return !!(manualToggle && manualToggle.checked); }

  canvas.addEventListener('mousedown', e => {
    if (!manualActive() || e.button !== 0 || !hasImage()) return;
    if (typeof isPanning !== 'undefined' && isPanning) return;     // let panning work
    e.stopImmediatePropagation();
    e.preventDefault();
    const { x, y } = imageToCanvasCoords(e.clientX, e.clientY);
    manualDots.push({ x, y });
    manualHover = null;
    updateManualStatus();
    refreshOverlay();
  }, true);

  canvas.addEventListener('mousemove', e => {
    if (!manualActive() || manualDots.length % 2 === 0 || !hasImage()) return;
    manualHover = imageToCanvasCoords(e.clientX, e.clientY);
    refreshOverlay();
  });

  function updateManualStatus() {
    const n = manualSegments().length, pending = manualDots.length % 2 === 1;
    setStatus(`Manual grid: ${n} line(s) drawn${pending ? ' + 1 dot waiting for its partner' : ''}. Click two dots per line (the line snaps horizontal/vertical). Untick “Manual grid mode” when done.`);
    if (manualUndo) manualUndo.disabled = !manualDots.length;
    if (manualClear) manualClear.disabled = !manualDots.length;
  }

  function clearManual() {
    manualDots = []; manualHover = null;
    updateManualStatus();
    refreshOverlay();
  }

  if (manualToggle) manualToggle.addEventListener('change', () => {
    if (manualActive()) {
      if (typeof mode !== 'undefined' && mode !== 'none' && typeof toggleMode === 'function') toggleMode(mode);   // switch core tool off
      canvas.style.cursor = 'crosshair';
      updateManualStatus();
      return;
    }
    manualHover = null;
    if (manualDots.length % 2 === 1) manualDots.pop();               // drop the unpaired dot
    refreshOverlay();
    if (!manualDots.length) { setStatus('No manual lines drawn.'); return; }
    if (lastTokens.length) buildResults();                           // re-assign existing OCR text to cells
    else if (hasImage()) runOCR();                                   // otherwise OCR first, then assign
  });
  if (manualUndo)  manualUndo.addEventListener('click', () => { manualDots.pop(); manualHover = null; updateManualStatus(); refreshOverlay(); if (!manualActive() && lastTokens.length) buildResults(); });
  if (manualClear) manualClear.addEventListener('click', () => { clearManual(); if (!manualActive() && lastTokens.length) buildResults(); });
  if (manualUndo) manualUndo.disabled = true;
  if (manualClear) manualClear.disabled = true;

  // Initial state
  ready();
  setStatus('Upload an image and (optionally) calibrate axes to extract numbers / tables.');
})();