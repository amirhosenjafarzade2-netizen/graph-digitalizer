// modules/io.js
import { state } from '../digitizer.js';
import { download, showModal } from './utils.js';
import XLSX from 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/xlsx.full.min.js';

export function initIO() {}

export function exportJson() {
    const data = {
        lines: state.lines,
        axisPoints: state.axisPoints,
        scaleX: state.scaleX, scaleY: state.scaleY,
        offsetX: state.offsetX, offsetY: state.offsetY,
        logX: state.logX, logY: state.logY,
        isCalibrated: state.isCalibrated,
        zoom: state.zoom, panX: state.panX, panY: state.panY,
        showGrid: state.showGrid,
        mode: state.mode,
        currentLineIndex: state.currentLineIndex,
        magnifierZoom: state.magnifierZoom,
        // color detection
        autoCenter: state.autoCenter,
        bgColor: state.bgColor,
        lineColor: state.lineColor,
        colorTolerance: state.colorTolerance,
        searchRadius: state.searchRadius
    };
    download('graph.json', JSON.stringify(data), 'application/json');
}

export function exportCsv() {
    let csv = '';
    state.lines.forEach(line => {
        csv += `"${line.name}"\nX,Y\n`;
        const pts = line.sorted ? [...line.points].sort((a,b)=>a.dataX-b.dataX)
                                : [...line.points].sort((a,b)=>a.order-b.order);
        pts.forEach(p => {
            const x = isFinite(p.dataX) ? p.dataX.toFixed(15) : 'NaN';
            const y = isFinite(p.dataY) ? p.dataY.toFixed(15) : 'NaN';
            csv += `${x},${y}\n`;
        });
        csv += '\n';
    });
    download('graph.csv', csv, 'text/csv');
}

export function exportXlsx() {
    const wb = XLSX.utils.book_new();
    const all = [];
    state.lines.forEach((line, i) => {
        if (!line.points.length) return;
        all.push([line.name]);
        const pts = line.sorted ? [...line.points].sort((a,b)=>a.dataX-b.dataX)
                                : [...line.points].sort((a,b)=>a.order-b.order);
        pts.forEach(p => all.push([p.dataX, p.dataY]));
        if (i < state.lines.length-1) all.push([]);
    });
    if (!all.length) { showModal('No data to export.'); return; }
    const ws = XLSX.utils.aoa_to_sheet(all);
    XLSX.utils.book_append_sheet(wb, ws, 'All_Lines');
    XLSX.writeFile(wb, 'graph.xlsx');
}

// ---------------------------------------------------------------------
// Import JSON (used by UI)
export function importJson(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
        try {
            const data = JSON.parse(e.target.result);
            // basic validation
            if (!Array.isArray(data.lines)) throw new Error('Invalid format');
            Object.assign(state, {
                lines: data.lines.map(l=>({
                    name: l.name || 'Line',
                    points: (l.points||[]).map(p=>({...p})),
                    sorted: !!l.sorted,
                    orderCounter: l.orderCounter||0
                })),
                axisPoints: (data.axisPoints||[]).map(p=>({...p})),
                scaleX: data.scaleX||0, scaleY: data.scaleY||0,
                offsetX: data.offsetX||0, offsetY: data.offsetY||0,
                logX: data.logX||false, logY: data.logY||false,
                isCalibrated: !!data.isCalibrated,
                zoom: data.zoom||1, panX: data.panX||0, panY: data.panY||0,
                showGrid: !!data.showGrid,
                mode: data.mode||'none',
                currentLineIndex: data.currentLineIndex||0,
                magnifierZoom: data.magnifierZoom||2,
                autoCenter: !!data.autoCenter,
                bgColor: data.bgColor||{r:255,g:255,b:255},
                lineColor: data.lineColor||{r:0,g:0,b:0},
                colorTolerance: data.colorTolerance||30,
                searchRadius: data.searchRadius||20
            });
            // UI sync
            document.getElementById('auto-center').checked = state.autoCenter;
            document.getElementById('color-detection-controls').style.display = state.autoCenter?'block':'none';
            document.getElementById('bg-color').value = rgbToHex(state.bgColor);
            document.getElementById('line-color').value = rgbToHex(state.lineColor);
            document.getElementById('color-tolerance').value = state.colorTolerance;
            document.getElementById('search-radius').value = state.searchRadius;
            document.getElementById('magnifier-zoom').value = state.magnifierZoom;
            document.getElementById('toggle-log-x').classList.toggle('log-active', state.logX);
            document.getElementById('toggle-log-y').classList.toggle('log-active', state.logY);
            // rebuild UI
            const ui = state.ui;
            ui.lineSelect.innerHTML = '';
            state.lines.forEach((l,i)=>{ const o=document.createElement('option'); o.value=i; o.textContent=l.name; if(i===state.currentLineIndex)o.selected=true; ui.lineSelect.appendChild(o); });
            updateButtonStates();
            updatePreview();
            draw();
            saveSession();
            showModal('JSON imported.');
        } catch (err) { showModal('Invalid JSON file.'); console.error(err); }
    };
    reader.readAsText(file);
}
