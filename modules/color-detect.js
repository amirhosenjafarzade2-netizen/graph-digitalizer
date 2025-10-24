// modules/color-detect.js
import { state } from '../digitizer.js';
import { draw } from './canvas.js';

export function initColorDetect() {
    // UI already bound in ui.js
}

/**
 * Find the centre of the nearest line-pixel cluster.
 * Returns canvas coordinates (already scaled by zoom/pan).
 */
export function findLineCenter(canvasX, canvasY) {
    if (!state.autoCenter || !state.img.src) return {x: canvasX, y: canvasY};

    const r = state.searchRadius;
    const temp = document.createElement('canvas');
    temp.width = r*2; temp.height = r*2;
    const tctx = temp.getContext('2d');

    const sx = canvasX - r, sy = canvasY - r;
    const sw = r*2, sh = r*2;

    try { tctx.drawImage(state.img, sx, sy, sw, sh, 0, 0, sw, sh); }
    catch (e) { console.warn('Cross-origin image – skipping color detect'); return {x:canvasX, y:canvasY}; }

    const imgData = tctx.getImageData(0,0,sw,sh).data;
    let sumX=0, sumY=0, cnt=0;

    for (let i=0; i<imgData.length; i+=4) {
        const col = {r:imgData[i], g:imgData[i+1], b:imgData[i+2]};
        const lineDist = colorDistance(col, state.lineColor);
        const bgDist   = colorDistance(col, state.bgColor);
        if (lineDist <= state.colorTolerance && bgDist > state.colorTolerance*1.5) {
            const px = (i/4) % sw;
            const py = Math.floor((i/4)/sw);
            sumX += px; sumY += py; cnt++;
        }
    }
    if (cnt > 5) {
        const cx = sumX/cnt, cy = sumY/cnt;
        return {x: sx + cx, y: sy + cy};
    }
    return {x: canvasX, y: canvasY};
}

function colorDistance(a,b){
    return Math.sqrt((a.r-b.r)**2 + (a.g-b.g)**2 + (a.b-b.b)**2);
}

// ---------------------------------------------------------------------
// Flash a red crosshair when a point snaps
export function flashCenter(screenX, screenY) {
    const ctx = state.ctx;
    ctx.save();
    ctx.strokeStyle = 'red';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(screenX-12, screenY); ctx.lineTo(screenX+12, screenY);
    ctx.moveTo(screenX, screenY-12); ctx.lineTo(screenX, screenY+12);
    ctx.stroke();
    ctx.restore();
    setTimeout(draw, 400);
}

// ---------------------------------------------------------------------
// Color conversion helpers (used by UI & session)
export function hexToRgb(hex){
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return m ? {r:parseInt(m[1],16), g:parseInt(m[2],16), b:parseInt(m[3],16)} : null;
}
export function rgbToHex(c){
    return '#' + [c.r,c.g,c.b].map(v=>v.toString(16).padStart(2,'0')).join('');
}
