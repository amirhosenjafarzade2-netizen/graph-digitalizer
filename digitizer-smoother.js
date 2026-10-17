/**********************
 * DIGITIZER SMOOTHER
 * "Auto Smooth" for hand-drawn / auto-traced lines (Highlight mode panel).
 *
 * Pipeline (all in IMAGE-PIXEL space, so log / date axes never change how
 * strong the smoothing looks):
 *   1. optional outlier removal (stray misclicks)
 *   2. resample by arc length to an even spacing
 *   3. optional corner detection -> path is split and each piece smoothed alone
 *   4. smooth x(s) and y(s) separately: Gaussian | Savitzky-Golay | Smoothing spline
 *   5. soft-limit how far any point may move from the original path
 *   6. resample to the requested number of points (corners are kept)
 *
 * Depends on: digitizer-core.js, digitizer-tools.js (loaded first)
 * Exposes:    window.DigitizerSmoother.smoothPath(points, params)  (pure, testable)
 *             window.refreshSmootherOverlay / refreshSmootherState / resetSmoother
 **********************/
(() => {
  'use strict';

  /* =====================================================================
   * PURE ALGORITHM
   * ===================================================================== */

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function median(arr) {
    if (!arr.length) return 0;
    const s = Array.from(arr).sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  function dedupe(pts) {
    const out = [];
    for (const p of pts) {
      const q = out[out.length - 1];
      if (!q || Math.hypot(p.x - q.x, p.y - q.y) > 1e-6) out.push({ x: p.x, y: p.y });
    }
    return out;
  }

  function arcLengths(pts) {
    const s = new Float64Array(pts.length);
    for (let i = 1; i < pts.length; i++) s[i] = s[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    return s;
  }

  /** Points of the polyline `pts` (cumulative length `s`) at ascending arc positions `targets`. */
  function resampleAt(pts, s, targets) {
    const out = [];
    let j = 0;
    for (const t of targets) {
      while (j < pts.length - 2 && s[j + 1] < t) j++;
      const seg = s[j + 1] - s[j];
      const u = seg > 0 ? clamp((t - s[j]) / seg, 0, 1) : 0;
      out.push({ x: pts[j].x + u * (pts[j + 1].x - pts[j].x), y: pts[j].y + u * (pts[j + 1].y - pts[j].y) });
    }
    return out;
  }

  /** True when the path goes out to b and comes straight back (turn > ~120°) – a stray click, not a real peak. */
  function isReversal(a, b, c) {
    const ux = b.x - a.x, uy = b.y - a.y, vx = c.x - b.x, vy = c.y - b.y;
    const lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
    if (!lu || !lv) return false;
    return (ux * vx + uy * vy) / (lu * lv) < -0.5;
  }

  /** Replace isolated outliers (stray misclicks) by the midpoint of their neighbours. */
  function despike(pts) {
    const n = pts.length;
    if (n < 5) return pts;
    const d = new Float64Array(n);
    for (let i = 1; i < n - 1; i++) {
      d[i] = Math.hypot(pts[i].x - (pts[i - 1].x + pts[i + 1].x) / 2, pts[i].y - (pts[i - 1].y + pts[i + 1].y) / 2);
    }
    const inner = Array.from(d.slice(1, n - 1));
    const med = median(inner);
    const mad = median(inner.map(v => Math.abs(v - med)));
    const thr = med + 5 * 1.4826 * mad + 3;
    const out = pts.map(p => ({ x: p.x, y: p.y }));
    for (let i = 1; i < n - 1; i++) {
      if (d[i] > thr && d[i] >= d[i - 1] && d[i] >= d[i + 1] && isReversal(pts[i - 1], pts[i], pts[i + 1])) {
        out[i] = { x: (pts[i - 1].x + pts[i + 1].x) / 2, y: (pts[i - 1].y + pts[i + 1].y) / 2 };
      }
    }
    return out;
  }

  /** Indices of sharp corners on an evenly resampled path. */
  function findCorners(R0, step, angleDeg, winPx) {
    const n = R0.length;
    const k = Math.max(2, Math.round(winPx / step));
    // light pre-smoothing: pen jitter must not look like a corner
    const sg = Math.max(1, (winPx * 0.5) / step);
    const sx = gaussian(R0.map(q => q.x), sg, false, false);
    const sy = gaussian(R0.map(q => q.y), sg, false, false);
    const R = sx.map((x, i) => ({ x, y: sy[i] }));
    const ang = new Float64Array(n);
    for (let i = k; i < n - k; i++) {
      const ax = R[i].x - R[i - k].x, ay = R[i].y - R[i - k].y;
      const bx = R[i + k].x - R[i].x, by = R[i + k].y - R[i].y;
      const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
      if (!la || !lb) continue;
      ang[i] = Math.acos(clamp((ax * bx + ay * by) / (la * lb), -1, 1)) * 180 / Math.PI;
    }
    const corners = [];
    for (let i = k; i < n - k; i++) {
      if (ang[i] < angleDeg) continue;
      let isMax = true;
      for (let j = i - k; j <= i + k && isMax; j++) {
        if (j === i) continue;
        if (j < i ? ang[j] >= ang[i] : ang[j] > ang[i]) isMax = false;
      }
      if (isMax) corners.push(i);
    }
    return corners;
  }

  /* ---------- 1-D smoothers on evenly spaced samples ---------- */

  /** Value at (possibly out-of-range) index i. odd = point reflection (keeps the end fixed), else mirror. */
  function sample(v, i, oddL, oddR) {
    const n = v.length;
    if (i < 0) {
      const j = Math.min(n - 1, -i);
      return oddL ? 2 * v[0] - v[j] : v[j];
    }
    if (i > n - 1) {
      const j = Math.max(0, 2 * (n - 1) - i);
      return oddR ? 2 * v[n - 1] - v[j] : v[j];
    }
    return v[i];
  }

  function gaussian(v, sigma, oddL, oddR) {
    const n = v.length;
    if (sigma < 0.3 || n < 3) return Array.from(v);
    const r = Math.ceil(3 * sigma);
    const w = new Float64Array(2 * r + 1);
    let sum = 0;
    for (let k = -r; k <= r; k++) { w[k + r] = Math.exp(-(k * k) / (2 * sigma * sigma)); sum += w[k + r]; }
    for (let k = 0; k < w.length; k++) w[k] /= sum;
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
      let a = 0;
      for (let k = -r; k <= r; k++) a += w[k + r] * sample(v, i + k, oddL, oddR);
      out[i] = a;
    }
    return out;
  }

  /** Savitzky-Golay convolution coefficients (centre point), half-window h, polynomial order p. */
  const _sgCache = new Map();
  function sgCoeffs(h, order) {
    const key = h + ':' + order;
    if (_sgCache.has(key)) return _sgCache.get(key);
    const P = order + 1, m = 2 * h + 1;
    const M = Array.from({ length: P }, () => new Float64Array(P + 1));
    for (let a = 0; a < P; a++) {
      for (let b = 0; b < P; b++) {
        let s = 0;
        for (let j = -h; j <= h; j++) s += Math.pow(j / h, a + b);
        M[a][b] = s;
      }
      M[a][P] = a === 0 ? 1 : 0;   // solve (AᵀA) c = e0
    }
    for (let c = 0; c < P; c++) {   // Gauss-Jordan with partial pivoting
      let piv = c;
      for (let r = c + 1; r < P; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      [M[c], M[piv]] = [M[piv], M[c]];
      const d = M[c][c];
      for (let k = c; k <= P; k++) M[c][k] /= d;
      for (let r = 0; r < P; r++) {
        if (r === c) continue;
        const f = M[r][c];
        for (let k = c; k <= P; k++) M[r][k] -= f * M[c][k];
      }
    }
    const coef = new Float64Array(m);
    for (let j = -h; j <= h; j++) {
      let s = 0;
      for (let a = 0; a < P; a++) s += M[a][P] * Math.pow(j / h, a);
      coef[j + h] = s;
    }
    _sgCache.set(key, coef);
    return coef;
  }

  function savgol(v, sigma, oddL, oddR) {
    const n = v.length;
    let h = Math.round(2 * sigma);                 // window ≈ 4σ + 1 samples
    h = Math.min(h, Math.floor((n - 1) / 2));
    if (h < 2) return Array.from(v);
    const c = sgCoeffs(h, 3);                      // cubic: keeps peaks and curvature
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
      let a = 0;
      for (let k = -h; k <= h; k++) a += c[k + h] * sample(v, i + k, oddL, oddR);
      out[i] = a;
    }
    return out;
  }

  /** Whittaker-Eilers (2nd-order) smoothing spline: min Σw(y-z)² + λΣ(Δ²z)²  — pentadiagonal LDLᵀ solve. */
  function whittaker(v, sigma, pinL, pinR) {
    const n = v.length;
    if (n < 4 || sigma < 0.3) return Array.from(v);
    const lambda = Math.pow(sigma, 4) / 1.92;      // matches the Gaussian half-power point
    const a = new Float64Array(n), b = new Float64Array(n), c = new Float64Array(n);
    for (let r = 0; r < n - 2; r++) {
      a[r] += 1; a[r + 1] += 4; a[r + 2] += 1;
      b[r] += -2; b[r + 1] += -2;
      c[r] += 1;
    }
    for (let i = 0; i < n; i++) { a[i] *= lambda; b[i] *= lambda; c[i] *= lambda; }
    const w = new Float64Array(n).fill(1);
    const pinW = Math.max(1e6, 1e4 * lambda);   // must dominate lambda, otherwise the end "jumps"
    if (pinL) w[0] = pinW;
    if (pinR) w[n - 1] = pinW;
    for (let i = 0; i < n; i++) a[i] += w[i];

    const D = new Float64Array(n), l1 = new Float64Array(n), l2 = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      D[i] = a[i] - (i >= 1 ? l1[i - 1] * l1[i - 1] * D[i - 1] : 0) - (i >= 2 ? l2[i - 2] * l2[i - 2] * D[i - 2] : 0);
      if (i < n - 1) l1[i] = (b[i] - (i >= 1 ? l2[i - 1] * D[i - 1] * l1[i - 1] : 0)) / D[i];
      if (i < n - 2) l2[i] = c[i] / D[i];
    }
    const z = new Float64Array(n);
    for (let i = 0; i < n; i++) z[i] = w[i] * v[i] - (i >= 1 ? l1[i - 1] * z[i - 1] : 0) - (i >= 2 ? l2[i - 2] * z[i - 2] : 0);
    const x = new Array(n);
    for (let i = n - 1; i >= 0; i--) x[i] = z[i] / D[i] - (i < n - 1 ? l1[i] * x[i + 1] : 0) - (i < n - 2 ? l2[i] * x[i + 2] : 0);
    return x;
  }

  function smooth1D(v, method, sigma, pinL, pinR) {
    let out;
    if (method === 'savgol') out = savgol(v, sigma, pinL, pinR);
    else if (method === 'spline') out = whittaker(v, sigma, pinL, pinR);
    else out = gaussian(v, sigma, pinL, pinR);
    if (pinL) out[0] = v[0];
    if (pinR) out[out.length - 1] = v[v.length - 1];
    return out;
  }

  /* ---------- geometry helpers ---------- */

  function nearestOnPolyline(px, py, ref) {
    let best = Infinity, qx = ref[0].x, qy = ref[0].y;
    for (let i = 0; i < ref.length - 1; i++) {
      const ax = ref[i].x, ay = ref[i].y, dx = ref[i + 1].x - ax, dy = ref[i + 1].y - ay;
      const l2 = dx * dx + dy * dy;
      const t = l2 > 0 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0;
      const cx = ax + t * dx, cy = ay + t * dy;
      const d = (px - cx) * (px - cx) + (py - cy) * (py - cy);
      if (d < best) { best = d; qx = cx; qy = cy; }
    }
    return { qx, qy, d: Math.sqrt(best) };
  }

  /**
   * Smooth an ordered path.
   * @param {{x:number,y:number}[]} raw   points in drawing order (image px)
   * @param {object} p  { method:'gaussian'|'savgol'|'spline', sigma:px, keepEnds:bool,
   *                      corners:bool, cornerAngle:deg, maxDev:px (0=off), despike:bool, n:outputPoints }
   * @returns {{points, maxShift, meanShift, corners}|null}
   */
  function smoothPath(raw, p) {
    let pts = dedupe(raw);
    if (pts.length < 3) return null;
    if (p.despike) pts = despike(pts);
    const ref = pts;

    const s = arcLengths(pts), L = s[s.length - 1];
    if (!(L > 0)) return null;

    // 2. even resampling (~1-2 px spacing)
    const h = clamp(L / 200, 0.5, 2);
    const N = Math.max(8, Math.ceil(L / h) + 1);
    const step = L / (N - 1);
    const targets = Array.from({ length: N }, (_, i) => i * step);
    const R = resampleAt(pts, s, targets);
    const sigmaS = (isFinite(p.sigma) ? Math.max(0, p.sigma) : 0) / step;

    // 3. corners split the path
    const corners = p.corners ? findCorners(R, step, p.cornerAngle, clamp(p.sigma, 4, 14)) : [];
    const breaks = [0, ...corners, N - 1];

    // 4. smooth every piece independently; piece boundaries at corners are always pinned
    const X = new Array(N), Y = new Array(N);
    for (let b = 0; b < breaks.length - 1; b++) {
      const i0 = breaks[b], i1 = breaks[b + 1];
      const xs = [], ys = [];
      for (let i = i0; i <= i1; i++) { xs.push(R[i].x); ys.push(R[i].y); }
      const pinL = b === 0 ? !!p.keepEnds : true;
      const pinR = b === breaks.length - 2 ? !!p.keepEnds : true;
      let sx = xs, sy = ys;
      if (xs.length >= 3) { sx = smooth1D(xs, p.method, sigmaS, pinL, pinR); sy = smooth1D(ys, p.method, sigmaS, pinL, pinR); }
      for (let i = i0; i <= i1; i++) { X[i] = sx[i - i0]; Y[i] = sy[i - i0]; }
    }
    let S = X.map((x, i) => ({ x, y: Y[i] }));

    // 5. soft deviation limit:  d' = D·tanh(d/D)   (identity for small moves, never exceeds D)
    if (p.maxDev > 0) {
      const D = p.maxDev;
      S = S.map(q => {
        const near = nearestOnPolyline(q.x, q.y, ref);
        if (near.d < 1e-9) return q;
        const f = D * Math.tanh(near.d / D) / near.d;
        return { x: near.qx + (q.x - near.qx) * f, y: near.qy + (q.y - near.qy) * f };
      });
    }

    // 6. output resampling (corner vertices are kept as points)
    const s2 = arcLengths(S), L2 = s2[s2.length - 1];
    const n = clamp(Math.round(p.n || raw.length), 2, 5000);
    const out = Array.from({ length: n }, (_, i) => (i * L2) / (n - 1));
    corners.forEach(ci => {
      const j = Math.round((s2[ci] / L2) * (n - 1));
      if (j >= 1 && j <= n - 2) out[j] = s2[ci];
    });
    out.sort((a, b) => a - b);
    const points = resampleAt(S, s2, out);
    if (p.keepEnds) { points[0] = { x: pts[0].x, y: pts[0].y }; points[n - 1] = { x: pts[pts.length - 1].x, y: pts[pts.length - 1].y }; }

    // measures for the UI: how far did the result move from the original path?
    let maxShift = 0, sum = 0;
    points.forEach(q => { const d = nearestOnPolyline(q.x, q.y, ref).d; if (d > maxShift) maxShift = d; sum += d; });
    return { points, maxShift, meanShift: sum / points.length, corners: corners.length };
  }

  const api = { smoothPath, despike, findCorners, gaussian, savgol, whittaker };
  if (typeof window !== 'undefined') window.DigitizerSmoother = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document === 'undefined') return;

  /* =====================================================================
   * UI  (panel lives at the bottom of the Highlight Line controls)
   * ===================================================================== */
  const $ = id => document.getElementById(id);
  const toggleBtn = $('smooth-toggle');
  if (!toggleBtn) return;

  const panel      = $('smooth-panel');
  const methodSel  = $('smooth-method');
  const strength   = $('smooth-strength');
  const keepEnds   = $('smooth-keep-ends');
  const cornersChk = $('smooth-corners');
  const cornerRow  = $('smooth-corner-row');
  const cornerAng  = $('smooth-corner-angle');
  const devSlider  = $('smooth-maxdev');
  const despikeChk = $('smooth-despike');
  const keepCount  = $('smooth-keep-count');
  const nInput     = $('smooth-n');
  const applyBtn   = $('smooth-apply');
  const cancelBtn  = $('smooth-cancel');
  const info       = $('smooth-info');
  const STORE_KEY  = 'digitizerSmoothSettings';

  let active = false;
  let cache = null;   // { key, result }

  /* ---------- settings ---------- */
  function readParams() {
    const line = lines[currentLineIndex];
    return {
      method: methodSel.value,
      sigma: parseFloat(strength.value) || 0,
      keepEnds: keepEnds.checked,
      corners: cornersChk.checked,
      cornerAngle: parseFloat(cornerAng.value) || 45,
      maxDev: parseFloat(devSlider.value) || 0,
      despike: despikeChk.checked,
      n: keepCount.checked ? (line ? line.points.length : 2) : Math.max(2, parseInt(nInput.value) || 2)
    };
  }

  function saveSettings() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        method: methodSel.value, strength: strength.value, keepEnds: keepEnds.checked,
        corners: cornersChk.checked, cornerAngle: cornerAng.value, maxDev: devSlider.value,
        despike: despikeChk.checked, keepCount: keepCount.checked, n: nInput.value
      }));
    } catch (e) { /* storage unavailable – settings just won't persist */ }
  }

  function loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (!s) return;
      if (s.method) methodSel.value = s.method;
      if (s.strength) strength.value = s.strength;
      if (typeof s.keepEnds === 'boolean') keepEnds.checked = s.keepEnds;
      if (typeof s.corners === 'boolean') cornersChk.checked = s.corners;
      if (s.cornerAngle) cornerAng.value = s.cornerAngle;
      if (s.maxDev !== undefined) devSlider.value = s.maxDev;
      if (typeof s.despike === 'boolean') despikeChk.checked = s.despike;
      if (typeof s.keepCount === 'boolean') keepCount.checked = s.keepCount;
      if (s.n) nInput.value = s.n;
    } catch (e) { /* ignore corrupt settings */ }
  }

  function syncLabels() {
    $('smooth-strength-val').textContent = `${strength.value} px`;
    $('smooth-corner-angle-val').textContent = `${cornerAng.value}°`;
    $('smooth-maxdev-val').textContent = parseFloat(devSlider.value) === 0 ? 'Off' : `${devSlider.value} px`;
    cornerRow.style.display = cornersChk.checked ? 'block' : 'none';
    nInput.disabled = keepCount.checked;
    if (keepCount.checked) { const l = lines[currentLineIndex]; if (l) nInput.value = l.points.length; }
  }

  /* ---------- preview computation (cached) ---------- */
  function linePath(line) {
    return [...line.points].sort((a, b) => a.order - b.order).map(q => ({ x: q.x, y: q.y }));
  }

  function compute() {
    const line = lines[currentLineIndex];
    if (!line || line.points.length < 3) return null;
    let sig = 0;
    line.points.forEach(q => { sig += q.x * 7.13 + q.y * 13.37 + q.order; });
    const params = readParams();
    const key = `${currentLineIndex}|${line.points.length}|${sig.toFixed(3)}|${JSON.stringify(params)}`;
    if (cache && cache.key === key) return cache.result;
    let result = null;
    try { result = smoothPath(linePath(line), params); } catch (e) { console.error('Smoother failed:', e); }
    cache = { key, result };
    if (result) {
      info.textContent = `Preview: ${result.points.length} pts · max shift ${result.maxShift.toFixed(1)} px · avg ${result.meanShift.toFixed(1)} px` +
        (result.corners ? ` · ${result.corners} corner${result.corners > 1 ? 's' : ''} kept` : '');
    } else {
      info.textContent = 'Not enough distinct points to smooth.';
    }
    return result;
  }

  /* ---------- state / visibility ---------- */
  function setActive(on) {
    active = !!on;
    cache = null;
    window.refreshSmootherState();
    draw();
  }

  window.refreshSmootherState = function () {
    const line = lines[currentLineIndex];
    const ok = !!line && line.points.length >= 3;
    if ((!ok || mode !== 'highlight') && active) { active = false; cache = null; }
    toggleBtn.disabled = !ok;
    toggleBtn.classList.toggle('active', active);
    panel.style.display = active ? 'block' : 'none';
    applyBtn.disabled = !(active && ok);
    syncLabels();
  };

  window.resetSmoother = function () {
    active = false; cache = null;
    window.refreshSmootherState();
  };

  /* ---------- overlay: ghost of the original + smoothed preview ---------- */
  window.refreshSmootherOverlay = function () {
    if (!active || mode !== 'highlight') return;
    const line = lines[currentLineIndex];
    if (!line || line.points.length < 3) return;
    const res = compute();
    if (!res) return;
    const z = zoom;
    const orig = linePath(line);

    const trace = pts => {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    };

    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';

    // original (faint, dashed)
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 3 / z; trace(orig);
    ctx.setLineDash([6 / z, 4 / z]);
    ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 1.4 / z; trace(orig);

    // smoothed result
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 4.4 / z; trace(res.points);
    ctx.strokeStyle = '#00e5ff'; ctx.lineWidth = 2.2 / z; trace(res.points);

    res.points.forEach(q => {
      ctx.beginPath(); ctx.arc(q.x, q.y, 3 / z, 0, 2 * Math.PI);
      ctx.fillStyle = '#00e5ff'; ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1 / z; ctx.stroke();
    });
    ctx.restore();
  };

  /* ---------- apply / cancel ---------- */
  function apply() {
    const line = lines[currentLineIndex];
    const res = compute();
    if (!line || !res) { showModal('Nothing to smooth.'); return; }

    const newPts = [];
    let order = 0;
    res.points.forEach(q => {
      const dc = canvasToDataCoords(q.x, q.y);
      if (dc) newPts.push({ x: q.x, y: q.y, dataX: dc.dataX, dataY: dc.dataY, order: ++order });
    });
    if (newPts.length < 2) { showModal('Smoothing produced no valid points (check the axis calibration).'); return; }

    const before = line.points.length;
    line.points = newPts;
    line.orderCounter = order;
    selectedPointIndex = -1;
    active = false; cache = null;
    updatePreview(); updateButtonStates(); draw(); saveState();   // saveState => Undo works
    statusBar.textContent = `Smoothed "${line.name}": ${before} → ${newPts.length} pts (max shift ${res.maxShift.toFixed(1)} px). Ctrl+Z to undo.`;
  }

  /* ---------- wiring ---------- */
  loadSettings();
  syncLabels();

  toggleBtn.addEventListener('click', () => {
    const line = lines[currentLineIndex];
    if (!line || line.points.length < 3) { showModal('Trace a line first (at least 3 points).'); return; }
    setActive(!active);
  });
  applyBtn.addEventListener('click', apply);
  cancelBtn.addEventListener('click', () => setActive(false));

  const onChange = () => { syncLabels(); saveSettings(); if (active) draw(); };
  [methodSel, strength, keepEnds, cornersChk, cornerAng, devSlider, despikeChk, keepCount, nInput].forEach(el => {
    el.addEventListener('input', onChange);
    el.addEventListener('change', onChange);
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && active && !pickingSnapColor && !pickingDetectorColor) setActive(false);
  });

  document.addEventListener('imageLoaded', () => window.resetSmoother());
  window.refreshSmootherState();
})();
