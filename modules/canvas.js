// modules/canvas.js
import { state } from '../digitizer.js';
import { saveSession } from './session.js';
import { flashCenter } from './color-detect.js';

export function initCanvas() {
    const c = state.canvas;
    c.addEventListener('mousedown', e => {
        if (state.isPanning) {
            state.startPan = {x: e.clientX - state.panX, y: e.clientY - state.panY};
            return;
        }
        if (state.mode === 'axes') { handleAxisClick(e); return; }
        if (state.mode === 'add' || state.mode === 'adjust' || state.mode === 'delete') { handlePointClick(e); return; }
        if (state.mode === 'highlight') { startHighlight(e); return; }
    });
    c.addEventListener('mousemove', e => {
        if (state.isPanning && e.buttons===1) {
            state.panX = e.clientX - state.startPan.x;
            state.panY = e.clientY - state.startPan.y;
            draw();
        }
        if (state.mode === 'highlight' && state.isHighlighting) moveHighlight(e);
        showMagnifier(e);
    });
    c.addEventListener('mouseup',   () => { if (state.mode==='highlight') endHighlight(); });
    c.addEventListener('mouseout',  () => { state.magnifier.style.display='none'; });
    c.addEventListener('contextmenu', e=>e.preventDefault());

    // resize handling
    window.addEventListener('resize', debounce(() => {
        if (state.img.src) {
            const maxW = window.innerWidth * 0.75;
            state.canvas.width  = Math.min(state.img.naturalWidth, maxW);
            state.canvas.height = state.canvas.width * (state.img.naturalHeight / state.img.naturalWidth);
            draw();
        }
    }, 200));
}

export function draw() {
    const ctx = state.ctx;
    const w = state.canvas.width, h = state.canvas.height;
    ctx.clearRect(0,0,w,h);

    // background
    ctx.save();
    ctx.translate(state.panX, state.panY);
    ctx.scale(state.zoom, state.zoom);
    ctx.drawImage(state.img, 0, 0);
    ctx.restore();

    // grid
    if (state.showGrid && state.isCalibrated) drawGrid();

    // axis points
    state.axisPoints.forEach((p,i) => {
        drawPoint(p.x, p.y, 'red', 6);
        ctx.fillStyle = 'white';
        ctx.font = '12px sans-serif';
        ctx.fillText(['X1','X2','Y1','Y2'][i], p.x+8, p.y+4);
    });

    // data points & lines
    state.lines.forEach((line, idx) => {
        const color = ['blue','green','red','purple','orange','brown','pink','gray'][idx%8];
        line.points.forEach(p => drawPoint(p.x, p.y, color, 4));
        if (line.points.length>1) drawPolyline(line.points, color);
    });

    // highlight path
    if (state.highlightPath.length>1) drawPolyline(state.highlightPath, 'cyan', state.highlightWidth);
}

function drawGrid() {
    const ctx = state.ctx;
    ctx.save();
    ctx.translate(state.panX, state.panY);
    ctx.scale(state.zoom, state.zoom);
    ctx.strokeStyle = '#0004';
    ctx.lineWidth = 1/ state.zoom;

    const stepX = state.canvas.width / 10;
    const stepY = state.canvas.height / 10;
    for (let x=0; x<=state.canvas.width; x+=stepX) {
        ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,state.canvas.height); ctx.stroke();
    }
    for (let y=0; y<=state.canvas.height; y+=stepY) {
        ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(state.canvas.width,y); ctx.stroke();
    }
    ctx.restore();
}

function drawPoint(x, y, color, radius) {
    const ctx = state.ctx;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI*2);
    ctx.fill();
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 1;
    ctx.stroke();
}

function drawPolyline(points, color, width=1) {
    if (points.length<2) return;
    const ctx = state.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    points.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.stroke();
}

// ---------------------------------------------------------------------
// Magnifier
function showMagnifier(e) {
    const mag = state.magnifier;
    const rect = state.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    mag.style.left = `${mx + 15}px`;
    mag.style.top  = `${my + 15}px`;
    mag.style.display = 'block';

    const size = mag.width;
    const srcX = (mx - state.panX) / state.zoom - size/(2*state.magnifierZoom);
    const srcY = (my - state.panY) / state.zoom - size/(2*state.magnifierZoom);
    state.magCtx.clearRect(0,0,size,size);
    state.magCtx.drawImage(state.img,
        srcX, srcY, size/state.magnifierZoom, size/state.magnifierZoom,
        0, 0, size, size);
}

// ---------------------------------------------------------------------
// Helper: convert client → canvas (with zoom/pan)
export function getCanvasCoords(clientX, clientY) {
    const rect = state.canvas.getBoundingClientRect();
    const x = (clientX - rect.left - state.panX) / state.zoom;
    const y = (clientY - rect.top  - state.panY) / state.zoom;
    return {x, y};
}

// ---------------------------------------------------------------------
// Flash a small crosshair when auto-center snaps
export { flashCenter } from './color-detect.js';
