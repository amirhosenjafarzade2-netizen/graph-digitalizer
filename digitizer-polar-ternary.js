/**********************
 * DIGITIZER POLAR + TERNARY
 * Adds two extra coordinate systems next to the normal X/Y calibration:
 *
 *   POLAR    centre + a reference point of known radius/angle
 *            (+ a 2nd known angle so the direction CW/CCW is detected)
 *            -> every point is stored as  dataX = angle,  dataY = radius
 *
 *   TERNARY  click the three corners of the triangle
 *            -> every point is stored as  dataX = component 1,  dataY = component 2
 *               (component 3 is computed from the pixel position on display / export)
 *
 * Depends on: digitizer-core.js and digitizer-tools.js (load this file after them).
 * UI:        Polar / Ternary buttons (#toggle-polar, #toggle-ternary) and the
 *            #cs-panel block inside "Calibrate axes" in index.html.
 *
 * HOW IT PLUGS IN (no other file needs editing)
 *  - canvasToDataCoords()    -> wrapped: polar/ternary maths when active
 *  - drawOverlays()          -> wrapped: draws centre/ring/triangle/grid helpers
 *  - updatePreview() / updatePointList() -> wrapped: right columns for each system
 *  - saveState() / _restoreState()       -> wrapped: undo/redo remembers the system
 *  - download('graph.json') -> wrapped: JSON export carries the coordinate system
 *  - CSV / XLSX export buttons -> intercepted (capture phase) when a system is on
 *  - mousedown on the canvas while calibrating -> intercepted (3 clicks, own labels)
 **********************/
(function () {
  'use strict';

  const $ = id => document.getElementById(id);

  /* ------------------------------------------------------------------ *
   *  0. Safety: do nothing if the markup / core functions are missing
   * ------------------------------------------------------------------ */
  const polarBtn = $('toggle-polar');
  const ternaryBtn = $('toggle-ternary');
  const panel = $('cs-panel');
  if (!polarBtn || !ternaryBtn || !panel) {
    console.warn('[polar/ternary] Markup not found in index.html - module disabled.');
    return;
  }
  const REQUIRED = ['canvasToDataCoords', 'drawOverlays', 'updatePreview', 'updatePointList',
    'updateButtonStates', 'saveState', '_restoreState', 'performFullReset', 'download', 'warnIfLegacy'];
  const missingFns = REQUIRED.filter(n => typeof window[n] !== 'function');
  if (missingFns.length) {
    console.warn('[polar/ternary] Core functions missing (' + missingFns.join(', ') + ') - module disabled.');
    return;
  }

  const TAU = Math.PI * 2;
  const wrapPi = v => v - TAU * Math.round(v / TAU);          // -> [-PI, PI]
  const LS_KEY = 'digitizerCoordSystem';
  const ACCENT = '#22d3ee';

  /* ------------------------------------------------------------------ *
   *  1. Styles (self-contained, theme aware through the page variables)
   * ------------------------------------------------------------------ */
  const style = document.createElement('style');
  style.id = 'cs-style';
  style.textContent = `
    #cs-panel{margin:8px 12px 6px;padding:10px 12px 12px;border:1px solid var(--line,#ccd);border-left:4px solid ${ACCENT};border-radius:10px;background:var(--panel-2,#f6f8fc)}
    #cs-panel .cs-title{margin:0 0 6px;font-size:12px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:${ACCENT}}
    #cs-panel .cs-row{display:flex;align-items:center;gap:8px;margin:7px 0}
    #cs-panel .cs-row>label{flex:0 0 46%;font-size:12px;line-height:1.25}
    #controls #cs-panel .cs-row input:not([type=checkbox]),#controls #cs-panel .cs-row select{flex:1 1 0;min-width:0;width:auto!important}
    #cs-panel .cs-names{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin:6px 0}
    #controls #cs-panel .cs-names input{width:100%!important;text-align:center;font-weight:700}
    #cs-panel .cs-matrix{display:grid;grid-template-columns:minmax(0,1.3fr) repeat(3,minmax(0,1fr));gap:5px;align-items:center;margin:6px 0 4px;font-size:11px}
    #cs-panel .cs-matrix .cs-h{font-weight:800;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #cs-panel .cs-matrix .cs-r{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #controls #cs-panel .cs-matrix input{width:100%!important;min-height:30px!important;padding:5px 4px!important;text-align:center}
    #cs-panel .cs-actions{display:grid;grid-template-columns:1fr;gap:6px;margin-top:10px}
    #cs-panel #cs-status{margin:8px 0 0}
    #cs-panel #cs-status.ok{color:var(--good,#16a34a)!important}
    #cs-panel .tool-hint{margin:6px 0}
    #cs-panel [disabled]{opacity:.5}
  `;
  document.head.appendChild(style);

  /* ------------------------------------------------------------------ *
   *  2. State
   * ------------------------------------------------------------------ */
  const CS = {
    type: 'cartesian',            // 'cartesian' | 'polar' | 'ternary'
    polar: { calc: null },        // filled by Calibrate
    ternary: { calc: null }
  };

  const el = {
    r1: $('polar-r1'), th1: $('polar-th1'), th2: $('polar-th2'), r0: $('polar-r0'),
    dir: $('polar-dir'), unit: $('polar-unit'), range: $('polar-range'),
    polarCal: $('polar-calibrate'),
    th1Label: $('polar-th1-label'), th2Label: $('polar-th2-label'), th2Row: $('polar-th2-row'),
    polarBox: $('cs-polar'), ternaryBox: $('cs-ternary'),
    names: [$('ternary-name-a'), $('ternary-name-b'), $('ternary-name-c')],
    total: $('ternary-total'), custom: $('ternary-custom'), matrixBox: $('ternary-matrix'),
    ternaryCal: $('ternary-calibrate'),
    instruction: $('cs-instruction'), status: $('cs-status'), undo: $('cs-undo-point')
  };
  const matrixInput = (j, i) => $(`tv-${j}-${i}`);
  let lastUnit = el.unit.value;

  /* ------------------------------------------------------------------ *
   *  3. Maths
   * ------------------------------------------------------------------ */
  function polarToData(x, y) {
    const c = CS.polar.calc;
    if (!c) return null;
    const dx = x - c.ox, dy = -(y - c.oy);                      // y up (maths orientation)
    const dist = Math.hypot(dx, dy);
    const a = Math.atan2(dy, dx);
    let th = c.th1 + c.s * wrapPi(a - c.a1);                    // radians
    th = c.range === '180' ? wrapPi(th) : ((th % TAU) + TAU) % TAU;
    const r = c.r0 + dist / c.k;
    if (!isFinite(th) || !isFinite(r)) return null;
    return { dataX: th / c.toRad, dataY: r };
  }

  function ternaryComp(x, y) {
    const c = CS.ternary.calc;
    if (!c) return [NaN, NaN, NaN];
    const [A, B, C] = c.P;
    const wA = ((B.y - C.y) * (x - C.x) + (C.x - B.x) * (y - C.y)) / c.det;
    const wB = ((C.y - A.y) * (x - C.x) + (A.x - C.x) * (y - C.y)) / c.det;
    const w = [wA, wB, 1 - wA - wB];
    return [0, 1, 2].map(i => w[0] * c.V[0][i] + w[1] * c.V[1][i] + w[2] * c.V[2][i]);
  }

  function ternaryToData(x, y) {
    if (!CS.ternary.calc) return null;
    const c = ternaryComp(x, y);
    return c.every(isFinite) ? { dataX: c[0], dataY: c[1] } : null;
  }

  /* ------------------------------------------------------------------ *
   *  4. Helpers for labels / columns / rows
   * ------------------------------------------------------------------ */
  const num = input => parseFloat(input.value);
  const fmt = (v, d) => (v === undefined || v === null || !isFinite(v)) ? 'NaN' : v.toFixed(d);

  function ternaryNames() {
    if (CS.ternary.calc && CS.ternary.calc.names) return CS.ternary.calc.names;
    return el.names.map((n, i) => (n.value || '').trim() || 'ABC'[i]);
  }
  const polarUnit = () => CS.polar.calc ? CS.polar.calc.unit : el.unit.value;
  const polarHasXY = () => CS.polar.calc ? CS.polar.calc.r0 === 0 : num(el.r0) === 0;

  function columns() {
    if (CS.type === 'polar') {
      const cols = [`Angle (${polarUnit() === 'deg' ? 'deg' : 'rad'})`, 'Radius'];
      if (polarHasXY()) cols.push('X', 'Y');
      return cols;
    }
    return ternaryNames();
  }

  /** Raw numbers for one stored point. */
  function rowNumbers(p) {
    if (CS.type === 'polar') {
      const th = p.dataX, r = p.dataY, out = [th, r];
      if (polarHasXY()) {
        const t = th * (polarUnit() === 'deg' ? Math.PI / 180 : 1);
        out.push(r * Math.cos(t), r * Math.sin(t));
      }
      return out;
    }
    return ternaryComp(p.x, p.y);
  }
  const rowText = (p, d) => rowNumbers(p).map(v => fmt(v, d));

  function sortedPoints(line) {
    return line.sorted
      ? [...line.points].sort((a, b) => a.dataX - b.dataX)
      : [...line.points].sort((a, b) => a.order - b.order);
  }

  function pointLabel(i) {
    if (CS.type === 'polar') return ['Center', 'R ref', 'θ₂ ref'][i] || ('P' + (i + 1));
    const n = ternaryNames()[i];
    return el.custom.checked ? `${n} corner` : `${n} 100%`;
  }
  function relabelAxisPoints() {
    if (CS.type === 'cartesian') return;
    axisPoints.forEach((p, i) => { p.label = pointLabel(i); });
  }

  function neededPoints() {
    if (CS.type === 'ternary') return 3;
    return el.dir.value === 'auto' ? 3 : 2;
  }

  /* ------------------------------------------------------------------ *
   *  5. Matrix helpers (ternary custom corners)
   * ------------------------------------------------------------------ */
  function readMatrix() {
    return [0, 1, 2].map(j => [0, 1, 2].map(i => num(matrixInput(j, i))));
  }
  function writeMatrix(V) {
    [0, 1, 2].forEach(j => [0, 1, 2].forEach(i => { matrixInput(j, i).value = V && V[j] && V[j][i] !== undefined ? V[j][i] : ''; }));
  }
  function identityMatrix(total) {
    return [0, 1, 2].map(j => [0, 1, 2].map(i => (i === j ? total : 0)));
  }
  function syncMatrixHeaders() {
    const n = ternaryNames();
    [0, 1, 2].forEach(i => {
      const h = $('tv-h-' + i); if (h) { h.textContent = n[i]; h.title = n[i]; }
      const r = $('tv-r-' + i); if (r) { r.textContent = `Corner ${i + 1}`; r.title = `Corner ${i + 1} (${n[i]} = 100 %)`; }
    });
  }

  /* ------------------------------------------------------------------ *
   *  6. Snapshots (persistence, undo/redo, JSON)
   * ------------------------------------------------------------------ */
  const clone = o => (o === undefined || o === null) ? null : JSON.parse(JSON.stringify(o));

  /** Small snapshot for undo/redo (settings typed in the panel are NOT rewound). */
  function lite() {
    return { type: CS.type, polarCalc: clone(CS.polar.calc), ternaryCalc: clone(CS.ternary.calc) };
  }
  function applyLite(s) {
    CS.type = s && ['polar', 'ternary'].includes(s.type) ? s.type : 'cartesian';
    CS.polar.calc = s ? clone(s.polarCalc) : null;
    CS.ternary.calc = s ? clone(s.ternaryCalc) : null;
  }

  /** Full snapshot (localStorage + JSON export). */
  function snapshot() {
    return {
      type: CS.type,
      polar: {
        r1: el.r1.value, th1: el.th1.value, th2: el.th2.value, r0: el.r0.value,
        dir: el.dir.value, unit: el.unit.value, range: el.range.value, calc: clone(CS.polar.calc)
      },
      ternary: {
        names: el.names.map(n => n.value), total: el.total.value, custom: el.custom.checked,
        V: readMatrix(), calc: clone(CS.ternary.calc)
      }
    };
  }
  function applySnapshot(s) {
    if (!s || typeof s !== 'object') { applyLite(null); return; }
    CS.type = ['polar', 'ternary'].includes(s.type) ? s.type : 'cartesian';
    const p = s.polar || {}, t = s.ternary || {};
    CS.polar.calc = clone(p.calc);
    CS.ternary.calc = clone(t.calc);
    const set = (input, v) => { if (v !== undefined && v !== null) input.value = v; };
    set(el.r1, p.r1); set(el.th1, p.th1); set(el.th2, p.th2); set(el.r0, p.r0);
    set(el.dir, p.dir); set(el.unit, p.unit); set(el.range, p.range);
    lastUnit = el.unit.value;
    if (Array.isArray(t.names)) el.names.forEach((n, i) => { n.value = t.names[i] ?? n.value; });
    set(el.total, t.total);
    el.custom.checked = !!t.custom;
    if (t.V) writeMatrix(t.V);
    if (!isCalibrated) { CS.polar.calc = null; CS.ternary.calc = null; }
  }
  function saveCS() { try { localStorage.setItem(LS_KEY, JSON.stringify(snapshot())); } catch (e) { /* ignore */ } }

  /* ------------------------------------------------------------------ *
   *  7. UI sync
   * ------------------------------------------------------------------ */
  const axisBlockedBtns = [toggleLogXBtn, toggleLogYBtn, toggleDateXBtn, toggleDateYBtn];

  function instructionText() {
    const t = CS.type;
    if (!hasImage()) return 'Upload a graph image first, then press “Set axis points”.';
    const calc = CS[t].calc;
    if (isCalibrated && calc && mode !== 'axes') {
      return 'Calibration complete ✓ Pick a tool to digitize. Changed a value above? Press Calibrate again. “Set axis points” starts over.';
    }
    if (mode !== 'axes') return 'Press “Set axis points”, then click the chart points described here.';
    const n = axisPoints.length, need = neededPoints();
    if (n >= need) return 'All points placed. Check the values below, then press Calibrate.';
    if (t === 'polar') {
      if (n === 0) return `Step 1/${need} — click the CENTER of the polar plot.`;
      if (n === 1) return `Step 2/${need} — click a point whose radius and angle you know (e.g. where a labelled angle meets a labelled ring), then enter its Radius R and Angle θ₁ below.`;
      return `Step 3/${need} — click a point on a DIFFERENT known angle (not 0° or 180° away from the first) and enter its angle θ₂. This tells the tool whether angles run clockwise or counter-clockwise.`;
    }
    const nm = ternaryNames()[n];
    return el.custom.checked
      ? `Step ${n + 1}/3 — click corner ${n + 1} of the triangle (the one for ${nm}), then enter its composition in the table below.`
      : `Step ${n + 1}/3 — click the triangle corner where ${nm} = 100 %.`;
  }

  function statusText() {
    const t = CS.type, c = CS[t].calc;
    if (!(isCalibrated && c)) return { text: `${axisPoints.length}/${neededPoints()} points placed`, ok: false };
    if (t === 'polar') {
      return { ok: true, text: `✓ Polar calibrated · angles run ${c.s > 0 ? 'counter-clockwise' : 'clockwise'} · ${c.unit === 'deg' ? 'degrees' : 'radians'} · ${c.range === '180' ? '−180…180' : '0…360'}` };
    }
    return { ok: true, text: `✓ Ternary calibrated · ${c.names.join(' / ')} · ${c.custom ? 'custom corner values' : 'sum = ' + c.total}` };
  }

  function refreshUI() {
    const t = CS.type, on = t !== 'cartesian';
    polarBtn.classList.toggle('active', t === 'polar');
    ternaryBtn.classList.toggle('active', t === 'ternary');
    panel.style.display = on ? 'block' : 'none';
    el.polarBox.style.display = t === 'polar' ? 'block' : 'none';
    el.ternaryBox.style.display = t === 'ternary' ? 'block' : 'none';

    // The normal X/Y value inputs are replaced by this panel while a system is on.
    if (on && axisInputs.style.display !== 'none') axisInputs.style.display = 'none';
    axisInstruction.style.display = on ? 'none' : '';
    axisBlockedBtns.forEach(b => { if (b) b.disabled = on; });
    if (!on) return;

    const deg = el.unit.value === 'deg';
    el.th1Label.textContent = `Angle at ref point (θ₁, ${deg ? '°' : 'rad'}):`;
    el.th2Label.textContent = `Angle of 3rd point (θ₂, ${deg ? '°' : 'rad'}):`;
    el.th2Row.style.display = el.dir.value === 'auto' ? 'flex' : 'none';
    el.total.disabled = el.custom.checked;
    el.matrixBox.style.display = el.custom.checked ? 'block' : 'none';
    syncMatrixHeaders();

    const ready = hasImage() && axisPoints.length >= neededPoints();
    el.polarCal.disabled = !ready;
    el.ternaryCal.disabled = !ready;
    el.undo.disabled = !(mode === 'axes' && axisPoints.length > 0);

    el.instruction.textContent = instructionText();
    const st = statusText();
    el.status.textContent = st.text;
    el.status.classList.toggle('ok', st.ok);
  }

  function pokeModules() {
    ['refreshCurveDetectorState', 'refreshTableOcrState'].forEach(n => {
      if (typeof window[n] === 'function') { try { window[n](); } catch (e) { /* ignore */ } }
    });
  }

  /* ------------------------------------------------------------------ *
   *  8. Switching the coordinate system
   * ------------------------------------------------------------------ */
  function applySystem(next) {
    CS.type = next;
    CS.polar.calc = null; CS.ternary.calc = null;
    isCalibrated = false;
    scaleX = scaleY = offsetX = offsetY = undefined;
    affine = null;
    axisPoints = [];
    selectedPointIndex = -1;
    highlightPath = []; isHighlighting = false;
    lines.forEach(l => l.points.forEach(p => { p.dataX = NaN; p.dataY = NaN; }));
    if (next === 'cartesian') {
      mode = 'none';
      axisInputs.style.display = 'none';
      axisInstruction.textContent = 'Click "Set Axis Points" then enter values.';
    } else {
      mode = hasImage() ? 'axes' : 'none';
    }
    _applyCalibrationButtonState();
    syncModePanels();
    updateButtonStates();
    updatePreview();
    pokeModules();
    draw();
    saveState();
  }

  function requestSystem(type) {
    const next = CS.type === type ? 'cartesian' : type;
    if (next !== 'cartesian' && (logX || logY || dateX || dateY)) {
      showModal('Turn off Log / Date axes first - they can\'t be combined with Polar or Ternary graphs.');
      return;
    }
    const hasWork = isCalibrated || axisPoints.length > 0 || lines.some(l => l.points.length > 0);
    if (!hasWork) { applySystem(next); return; }
    const label = { cartesian: 'normal X/Y', polar: 'Polar', ternary: 'Ternary' }[next];
    showModal(`Switch to ${label} axes? The current calibration is cleared. Your points stay where they are and get new values when you calibrate again.`,
      false, () => applySystem(next));
  }

  polarBtn.addEventListener('click', () => requestSystem('polar'));
  ternaryBtn.addEventListener('click', () => requestSystem('ternary'));

  /* ------------------------------------------------------------------ *
   *  9. Calibration
   * ------------------------------------------------------------------ */
  function finishCalibration() {
    isCalibrated = true;
    scaleX = scaleY = 1; offsetX = offsetY = 0;          // neutral values so core checks stay happy
    affine = null;                                        // polar/ternary never use the skewed-XY fit
    _applyCalibrationButtonState();
    mode = 'add';
    axisInputs.style.display = 'none';
    syncModePanels();
    updateButtonStates();
    lines.forEach(line => line.points.forEach(p => {
      const dc = canvasToDataCoords(p.x, p.y);
      if (dc) { p.dataX = dc.dataX; p.dataY = dc.dataY; }
    }));
    saveState(); draw(); updatePreview();
    document.dispatchEvent(new Event('calibrationComplete'));
    pokeModules();
    refreshUI();
  }

  function calibratePolar() {
    const need = neededPoints();
    if (axisPoints.length < need) { showModal(`Please click ${need} points on the chart first.`); return; }
    const r1 = num(el.r1), th1 = num(el.th1), r0 = num(el.r0);
    if (!isFinite(r1)) { showModal('Enter the radius R of the reference point.'); return; }
    if (!isFinite(th1)) { showModal('Enter the angle θ₁ of the reference point.'); return; }
    if (!isFinite(r0)) { showModal('Radius at the centre (r₀) must be a number (usually 0).'); return; }
    if (r1 === r0) { showModal('The reference radius must differ from the radius at the centre.'); return; }

    const unit = el.unit.value, toRad = unit === 'deg' ? Math.PI / 180 : 1;
    const O = axisPoints[0], P1 = axisPoints[1];
    const d1 = Math.hypot(P1.x - O.x, P1.y - O.y);
    if (d1 < 3) { showModal('The reference point is too close to the centre. Click one further out.'); return; }
    const a1 = Math.atan2(-(P1.y - O.y), P1.x - O.x);

    let s = 1;
    if (el.dir.value === 'ccw') s = 1;
    else if (el.dir.value === 'cw') s = -1;
    else {
      const th2 = num(el.th2);
      if (!isFinite(th2)) { showModal('Enter the angle θ₂ of the third point.'); return; }
      const P2 = axisPoints[2];
      if (Math.hypot(P2.x - O.x, P2.y - O.y) < 3) { showModal('The third point is too close to the centre.'); return; }
      const a2 = Math.atan2(-(P2.y - O.y), P2.x - O.x);
      const d = wrapPi(a2 - a1), dth = wrapPi((th2 - th1) * toRad);
      if (Math.abs(Math.sin(d)) < 0.1) {
        showModal('The third point lies on the same line through the centre as the reference point, so the direction can\'t be told. Click a point at a clearly different angle (e.g. 90° away), or choose the direction manually.');
        return;
      }
      const ep = Math.abs(wrapPi(d - dth)), em = Math.abs(wrapPi(-d - dth));
      s = ep <= em ? 1 : -1;
      if (Math.min(ep, em) > 0.35) {
        showModal('The angles you typed don\'t match where you clicked (off by more than ~20°). Check θ₁, θ₂, the angle unit, or the clicked points.');
        return;
      }
    }

    CS.polar.calc = {
      ox: O.x, oy: O.y, d1, a1, s, th1: th1 * toRad, r1, r0,
      k: d1 / (r1 - r0), unit, toRad, range: el.range.value
    };
    finishCalibration();
  }

  function calibrateTernary() {
    if (axisPoints.length < 3) { showModal('Please click the three corners of the triangle first.'); return; }
    const [A, B, C] = axisPoints;
    const det = (B.y - C.y) * (A.x - C.x) + (C.x - B.x) * (A.y - C.y);
    if (Math.abs(det) < 50) { showModal('The three corners are almost in a straight line. Re-click the triangle corners.'); return; }
    const names = ternaryNames().map((n, i) => n || 'ABC'[i]);
    let V, total = num(el.total);
    const custom = el.custom.checked;
    if (custom) {
      V = readMatrix();
      if (V.some(row => row.some(v => !isFinite(v)))) { showModal('Fill in all nine corner values (or untick the custom-corner option).'); return; }
    } else {
      if (!isFinite(total) || total <= 0) { showModal('The sum of the components must be a positive number (e.g. 100 or 1).'); return; }
      V = identityMatrix(total);
    }
    CS.ternary.calc = {
      P: [A, B, C].map(p => ({ x: p.x, y: p.y })), det, V, names, total: custom ? null : total, custom
    };
    relabelAxisPoints();
    finishCalibration();
  }

  el.polarCal.addEventListener('click', calibratePolar);
  el.ternaryCal.addEventListener('click', calibrateTernary);

  el.undo.addEventListener('click', () => {
    if (mode === 'axes' && axisPoints.length) { axisPoints.pop(); draw(); saveState(); refreshUI(); }
  });

  // Reset calibration (core handler runs first, then this one)
  resetCalibrationBtn.addEventListener('click', () => {
    CS.polar.calc = null; CS.ternary.calc = null;
    refreshUI(); updatePreview(); saveCS();
  });

  /* ------------------------------------------------------------------ *
   * 10. Collecting the calibration clicks (replaces the 4-point X/Y flow)
   * ------------------------------------------------------------------ */
  canvasContainer.addEventListener('mousedown', e => {
    if (e.target !== canvas) return;
    if (CS.type === 'cartesian' || mode !== 'axes') return;
    if (e.button !== 0 || isPanning || pickingSnapColor || pickingDetectorColor) return;   // let pan / eyedropper work
    e.stopPropagation();
    e.preventDefault();
    if (axisPoints.length >= neededPoints()) { refreshUI(); return; }
    const { x, y } = imageToCanvasCoords(e.clientX, e.clientY);
    axisPoints.push({ x, y, label: pointLabel(axisPoints.length) });
    draw(); saveState(); refreshUI();
  }, true);

  // Keep the original X/Y inputs hidden whatever core decides.
  new MutationObserver(() => {
    if (CS.type !== 'cartesian' && axisInputs.style.display !== 'none') axisInputs.style.display = 'none';
  }).observe(axisInputs, { attributes: true, attributeFilter: ['style'] });

  // "Set axis points" / "Reset points" were handled by core already; just refresh our text.
  setAxesBtn.addEventListener('click', refreshUI);
  resetAxisPointsBtn.addEventListener('click', refreshUI);

  /* ------------------------------------------------------------------ *
   * 11. Inputs in the panel
   * ------------------------------------------------------------------ */
  function onPanelInput() { relabelAxisPoints(); refreshUI(); draw(); saveCS(); }
  [el.r1, el.th1, el.th2, el.r0, el.dir, el.range, el.total, ...el.names].forEach(i => {
    i.addEventListener('input', onPanelInput);
    i.addEventListener('change', onPanelInput);
  });
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) matrixInput(j, i).addEventListener('input', onPanelInput);

  el.unit.addEventListener('change', () => {
    const toRad = el.unit.value === 'rad' && lastUnit === 'deg';
    const toDeg = el.unit.value === 'deg' && lastUnit === 'rad';
    if (toRad || toDeg) {
      [el.th1, el.th2].forEach(inp => {
        const v = num(inp);
        if (isFinite(v)) inp.value = String(+(toRad ? v * Math.PI / 180 : v * 180 / Math.PI).toFixed(6));
      });
    }
    lastUnit = el.unit.value;
    onPanelInput();
  });

  el.custom.addEventListener('change', () => {
    if (el.custom.checked && readMatrix().every(r => r.every(v => !isFinite(v)))) {
      writeMatrix(identityMatrix(isFinite(num(el.total)) && num(el.total) > 0 ? num(el.total) : 100));
    }
    onPanelInput();
  });

  /* ------------------------------------------------------------------ *
   * 12. Wrapping core functions
   * ------------------------------------------------------------------ */
  const _canvasToDataCoords = window.canvasToDataCoords;
  window.canvasToDataCoords = function (x, y) {
    if (CS.type === 'polar') return polarToData(x, y);
    if (CS.type === 'ternary') return ternaryToData(x, y);
    return _canvasToDataCoords(x, y);
  };

  const _updatePointList = window.updatePointList;
  window.updatePointList = function () {
    if (CS.type === 'cartesian') return _updatePointList();
    if (!pointList) return;
    pointList.innerHTML = '';
    const line = lines[currentLineIndex];
    if (!line) return;
    sortedPoints(line).forEach((p, i) => {
      const div = document.createElement('div');
      div.className = 'point-item';
      div.textContent = `#${i + 1}: (${rowText(p, 4).join(', ')})`;
      pointList.appendChild(div);
    });
  };

  const _updatePreview = window.updatePreview;
  window.updatePreview = function () {
    if (CS.type === 'cartesian') return _updatePreview();
    previewTable.innerHTML = '';
    if (lines.every(l => l.points.length === 0)) {
      previewTable.innerHTML = '<tr><td>No data</td></tr>';
    } else {
      const cols = columns();
      lines.forEach(line => {
        if (!line.points.length) return;
        const nameRow = document.createElement('tr');
        nameRow.innerHTML = `<td colspan="${cols.length}"><strong>${escapeHtml(line.name)}</strong></td>`;
        previewTable.appendChild(nameRow);
        const hdr = document.createElement('tr');
        hdr.innerHTML = cols.map(c => `<td>${escapeHtml(c)}</td>`).join('');
        previewTable.appendChild(hdr);
        line.points.forEach(p => {
          const row = document.createElement('tr');
          row.innerHTML = rowText(p, 6).map(v => `<td>${v}</td>`).join('');
          previewTable.appendChild(row);
        });
      });
    }
    window.updatePointList();
  };

  const _updateButtonStates = window.updateButtonStates;
  window.updateButtonStates = function () { _updateButtonStates(); refreshUI(); };

  const _saveState = window.saveState;
  window.saveState = function () {
    _saveState();
    try { if (history[historyIndex]) history[historyIndex].cs = lite(); } catch (e) { /* ignore */ }
    saveCS();
  };

  const _restoreState = window._restoreState;
  window._restoreState = function (state) {
    _restoreState(state);
    applyLite(state && state.cs);
    relabelAxisPoints();
    refreshUI(); updatePreview(); draw();
  };

  const _performFullReset = window.performFullReset;
  window.performFullReset = function () {
    _performFullReset();
    resetCoordSystem();
  };

  const _download = window.download;
  window.download = function (filename, text, mimeType) {
    if (filename === 'graph.json') {
      try {
        const o = JSON.parse(text);
        o.coordSystem = snapshot();
        if (CS.type === 'ternary' && CS.ternary.calc) {
          (o.lines || []).forEach(l => (l.points || []).forEach(p => { p.dataZ = ternaryComp(p.x, p.y)[2]; }));
        }
        text = JSON.stringify(o);
      } catch (e) { /* export the original text */ }
    }
    return _download(filename, text, mimeType);
  };

  // JSON import: core restores lines/axis; we restore the coordinate system afterwards.
  let importing = false, importTimer = null;
  document.addEventListener('change', e => {
    if (e.target === importJsonInput) {
      importing = true;
      clearTimeout(importTimer);
      importTimer = setTimeout(() => { importing = false; }, 6000);
    }
  }, true);

  const _warnIfLegacy = window.warnIfLegacy;
  window.warnIfLegacy = function (state) {
    _warnIfLegacy(state);
    if (!importing) return;
    importing = false; clearTimeout(importTimer);
    applySnapshot(state && state.coordSystem);
    relabelAxisPoints();
    refreshUI(); updatePreview(); draw(); saveState();
  };

  /* ---- overlays: calibration helpers + optional grid ---- */
  const _drawOverlays = window.drawOverlays;
  window.drawOverlays = function (c, z, W, H) {
    if (CS.type === 'cartesian') return _drawOverlays(c, z, W, H);
    const grid = showGrid;
    c.save();
    try {
      if (CS.type === 'polar') drawPolar(c, z, grid); else drawTernary(c, z, grid);
    } finally { c.restore(); }
    showGrid = false;                      // suppress the X/Y grid of the core
    try { _drawOverlays(c, z, W, H); } finally { showGrid = grid; }
  };

  function haloText(c, z, text, x, y) {
    c.lineWidth = 3 / z; c.strokeStyle = 'rgba(0,0,0,0.65)'; c.setLineDash([]);
    c.strokeText(text, x, y);
    c.fillStyle = ACCENT; c.fillText(text, x, y);
  }

  function drawPolar(c, z, grid) {
    const pts = axisPoints, calc = CS.polar.calc;
    c.lineCap = 'round'; c.font = `${11 / z}px Arial`;

    if (grid && calc) {
      c.setLineDash([]); c.lineWidth = 1 / z; c.strokeStyle = 'rgba(34,211,238,0.55)';
      for (let j = 1; j <= 4; j++) {
        const rad = calc.d1 * j / 4;
        c.beginPath(); c.arc(calc.ox, calc.oy, rad, 0, TAU); c.stroke();
        const rv = calc.r0 + (calc.r1 - calc.r0) * j / 4;
        haloText(c, z, String(+rv.toPrecision(4)), calc.ox + 3 / z, calc.oy - rad - 2 / z);
      }
      for (let deg = 0; deg < 360; deg += 30) {
        const a = calc.a1 + calc.s * (deg * Math.PI / 180 - calc.th1);
        const ex = calc.ox + calc.d1 * Math.cos(a), ey = calc.oy - calc.d1 * Math.sin(a);
        c.beginPath(); c.moveTo(calc.ox, calc.oy); c.lineTo(ex, ey); c.stroke();
        const lx = calc.ox + calc.d1 * 1.07 * Math.cos(a), ly = calc.oy - calc.d1 * 1.07 * Math.sin(a);
        const label = calc.unit === 'deg' ? `${deg}°` : String(+(deg * Math.PI / 180).toFixed(2));
        c.textAlign = 'center'; c.textBaseline = 'middle';
        haloText(c, z, label, lx, ly);
      }
      c.textAlign = 'start'; c.textBaseline = 'alphabetic';
    }

    if (pts.length) {
      c.strokeStyle = ACCENT; c.lineWidth = 1.5 / z; c.setLineDash([6 / z, 4 / z]);
      const O = pts[0];
      c.beginPath();
      c.moveTo(O.x - 9 / z, O.y); c.lineTo(O.x + 9 / z, O.y);
      c.moveTo(O.x, O.y - 9 / z); c.lineTo(O.x, O.y + 9 / z);
      c.stroke();
      if (pts.length >= 2) {
        const d = Math.hypot(pts[1].x - O.x, pts[1].y - O.y);
        c.beginPath(); c.arc(O.x, O.y, d, 0, TAU); c.stroke();
        c.beginPath(); c.moveTo(O.x, O.y); c.lineTo(pts[1].x, pts[1].y); c.stroke();
      }
      if (pts.length >= 3) {
        c.beginPath(); c.moveTo(O.x, O.y); c.lineTo(pts[2].x, pts[2].y); c.stroke();
      }
    }
  }

  function drawTernary(c, z, grid) {
    const pts = axisPoints;
    if (!pts.length) return;
    c.lineCap = 'round';
    c.strokeStyle = ACCENT; c.lineWidth = 1.5 / z; c.setLineDash([6 / z, 4 / z]);
    c.beginPath();
    c.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) c.lineTo(pts[i].x, pts[i].y);
    if (pts.length === 3) c.closePath();
    c.stroke();

    if (grid && pts.length === 3) {
      c.setLineDash([]); c.lineWidth = 1 / z; c.strokeStyle = 'rgba(34,211,238,0.5)';
      const P = w => ({
        x: w[0] * pts[0].x + w[1] * pts[1].x + w[2] * pts[2].x,
        y: w[0] * pts[0].y + w[1] * pts[1].y + w[2] * pts[2].y
      });
      for (let i = 1; i < 10; i++) {
        const t = i / 10;
        for (let k = 0; k < 3; k++) {
          const a = [0, 0, 0], b = [0, 0, 0];
          a[k] = t; b[k] = t;
          a[(k + 1) % 3] = 1 - t; b[(k + 2) % 3] = 1 - t;
          const pa = P(a), pb = P(b);
          c.beginPath(); c.moveTo(pa.x, pa.y); c.lineTo(pb.x, pb.y); c.stroke();
        }
      }
    }
  }

  /* ---- live read-out in the status bar ---- */
  canvas.addEventListener('mousemove', e => {
    if (CS.type === 'cartesian' || !isCalibrated || isPanDragging || pickingSnapColor || pickingDetectorColor) return;
    const { x, y } = imageToCanvasCoords(e.clientX, e.clientY);
    let txt;
    if (CS.type === 'polar') {
      const d = polarToData(x, y);
      if (!d) return;
      txt = `θ ${fmt(d.dataX, 2)}${polarUnit() === 'deg' ? '°' : ' rad'}, r ${fmt(d.dataY, 4)}`;
    } else {
      const c = ternaryComp(x, y);
      if (!c.every(isFinite)) return;
      txt = ternaryNames().map((n, i) => `${n} ${fmt(c[i], 2)}`).join(' · ');
    }
    statusBar.textContent = `Mode: ${isPanning ? 'pan' : mode} | Image px: (${x.toFixed(1)}, ${y.toFixed(1)}) | ${txt}`;
  });

  /* ------------------------------------------------------------------ *
   * 13. CSV / XLSX export for the active system
   * ------------------------------------------------------------------ */
  const csvCell = s => /[",\n]/.test(s) ? `"${String(s).replace(/"/g, '""')}"` : String(s);

  function exportCsv() {
    const cols = columns().map(csvCell).join(',');
    let csv = '';
    lines.forEach(line => {
      csv += `"${String(line.name).replace(/"/g, '""')}"\n${cols}\n`;
      sortedPoints(line).forEach(p => { csv += rowText(p, 15).join(',') + '\n'; });
      csv += '\n';
    });
    download('graph.csv', csv, 'text/csv');
  }

  function exportXlsx() {
    try {
      const cols = columns(), rows = [];
      lines.forEach(line => {
        if (!line.points.length) return;
        if (rows.length) rows.push([]);
        rows.push([line.name]);
        rows.push(cols);
        sortedPoints(line).forEach(p => {
          rows.push(rowNumbers(p).map(v => (isFinite(v) ? Number(v.toFixed(15)) : 'NaN')));
        });
      });
      if (!rows.length) { showModal('No data to export.'); return; }
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'All_Lines');
      XLSX.writeFile(wb, 'graph.xlsx');
    } catch (err) {
      showModal('Failed to export XLSX.'); console.error(err);
    }
  }

  document.addEventListener('click', e => {
    if (CS.type === 'cartesian') return;
    const b = e.target.closest && e.target.closest('#export-csv, #export-xlsx');
    if (!b) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    if (b.id === 'export-csv') exportCsv(); else exportXlsx();
  }, true);

  /* ------------------------------------------------------------------ *
   * 14. Reset + startup
   * ------------------------------------------------------------------ */
  function resetCoordSystem() {
    CS.type = 'cartesian'; CS.polar.calc = null; CS.ternary.calc = null;
    el.r1.value = ''; el.th1.value = '0'; el.th2.value = '90'; el.r0.value = '0';
    el.dir.value = 'auto'; el.unit.value = 'deg'; el.range.value = '360'; lastUnit = 'deg';
    el.names.forEach((n, i) => { n.value = 'ABC'[i]; });
    el.total.value = '100'; el.custom.checked = false; writeMatrix(identityMatrix(100));
    try { localStorage.removeItem(LS_KEY); } catch (e) { /* ignore */ }
    refreshUI();
  }

  function loadCS() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (e) { s = null; }
    if (!s) return;
    applySnapshot(s);                                      // drops calibration if core restored an un-calibrated session
    relabelAxisPoints();
  }

  writeMatrix(identityMatrix(100));

  document.addEventListener('DOMContentLoaded', () => {       // runs after core's own loadSession
    loadCS();
    refreshUI();
    if (CS.type !== 'cartesian') { updatePreview(); draw(); }
  });

  // Small public API (handy for debugging / other modules)
  window.getCoordSystem = () => snapshot();
  window.resetCoordSystem = resetCoordSystem;
  window.coordSystemType = () => CS.type;

  refreshUI();
})();
