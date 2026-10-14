/* Graph Digitizer Pro — unified curve / scatter detector.
 * Uses pixel segmentation and connected components. It is intentionally review-first:
 * detected datasets can be named and assigned colors before being added to the project.
 *
 * COLOR CONSISTENCY: the on-graph preview is rendered FROM the result rows
 * (name bar + color swatch), at full opacity. Changing a swatch repaints the
 * preview instantly, and the colour you see is the colour the dataset will have
 * after "Add Named Datasets".
 */
(() => {
  const $ = id => document.getElementById(id);
  const detectBtn = $('cd-detect');
  if (!detectBtn) return;

  const status = $('cd-status');
  const previewToggle = $('cd-preview');
  const modeSelect = $('cd-mode');
  const colorFilter = $('cd-filter-color');
  const colorInput = $('cd-color');
  const toleranceInput = $('cd-tol');
  const resultsBox = $('cd-results');
  const addBtn = $('cd-add-results');
  const runSlider = $('cd-run');
  const sensSlider = $('cd-sensitivity');

  let previewCanvas = null;
  let previewDims = null;     // {w,h} of the image the current results were detected on
  let detectedResults = [];   // [{name,color,points,meta,groups:[Int array of pixel indices]}]

  const palette = ['#ff2d95','#00a8ff','#a0c900','#ff8c00','#a78bfa','#00a878','#ff4e4e','#8a5a2b','#00b9b0','#d14dff'];
  const setStatus = message => { status.textContent = message; };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const hexRgb = hex => {
    const n = parseInt(String(hex).replace('#',''), 16);
    return {r:(n>>16)&255,g:(n>>8)&255,b:n&255};
  };

  /** Exact opposite (RGB inverse) of a colour, so overlays/dots stand out from the line they mark.
   *  Only for near-gray lines, whose inverse would be almost the same gray, it falls back to black or white. */
  function oppositeColor(hex) {
    const {r,g,b}=hexRgb(hex);
    const ir=255-r,ig=255-g,ib=255-b;
    if(Math.hypot(ir-r,ig-g,ib-b)<110){
      const lum=0.2126*r+0.7152*g+0.0722*b;
      return lum>127?'#000000':'#ffffff';
    }
    return rgbToHex(ir,ig,ib);
  }

  function ready() {
    detectBtn.disabled = !(typeof hasImage === 'function' && hasImage());
  }
  window.refreshCurveDetectorState = ready;

  /* ---------- small UI wiring ---------- */
  const minWSlider = $('cd-minw');
  minWSlider.addEventListener('input', () => $('cd-minw-val').textContent = minWSlider.value);
  const splitDist = $('cd-split-dist');
  splitDist.addEventListener('input', () => $('cd-split-val').textContent = splitDist.value);
  runSlider.addEventListener('input', () => $('cd-run-val').textContent = `${runSlider.value}%`);
  sensSlider.addEventListener('input', () => $('cd-sensitivity-val').textContent = ({1:'High',2:'Medium',3:'Low'})[sensSlider.value]);
  toleranceInput.addEventListener('input', () => $('cd-tol-val').textContent = toleranceInput.value);
  colorInput.addEventListener('input', () => { $('cd-color-chip').style.background = colorInput.value; });
  function syncColorControls() {
    toleranceInput.disabled = !colorFilter.checked;
    colorInput.disabled = !colorFilter.checked;
  }
  colorFilter.addEventListener('change', syncColorControls);
  window.refreshCurveDetectorColorState = syncColorControls;
  syncColorControls();

  modeSelect.addEventListener('change', () => {
    $('cd-points-label').textContent = modeSelect.value === 'scatter' ? 'Maximum marker points:' : 'Points per curve / dataset:';
    setStatus(modeSelect.value === 'scatter' ? 'Scatter mode: each detected marker becomes a point in one dataset.' : 'Curve mode: connected components are proposed as separate datasets.');
  });

  // The eyedropper button toggles: click again to cancel.
  const pickColorBtn = $('cd-pick-color');
  if (pickColorBtn) pickColorBtn.addEventListener('click', () => {
    if (!hasImage()) { setStatus('Upload a graph image first.'); return; }
    if (typeof window.setPickingDetectorColor !== 'function') return;
    if (pickingDetectorColor) {
      window.setPickingDetectorColor(false);
      setStatus('Color picking cancelled.');
    } else {
      window.setPickingDetectorColor(true);
      setStatus('Color picker active: click the desired color on the graph. Press Esc to cancel.');
    }
  });

  // A new image or a (re)calibration makes old detections meaningless.
  document.addEventListener('imageLoaded', () => { clearDetection(); setStatus('Image loaded. Calibrate the axes, then detect.'); ready(); });
  document.addEventListener('calibrationComplete', ready);

  /* ---------- detection ---------- */
  function plotBounds(w, h) {
    const limit = $('cd-limit-bounds');
    if (limit && !limit.checked) return null;
    const pts = Array.isArray(axisPoints) ? axisPoints : [];
    if (pts.length < 3) return null;            // 3 points when "Shared Origin" is used, otherwise 4
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    return {
      minX: clamp(Math.floor(Math.min(...xs)), 0, w - 1), maxX: clamp(Math.ceil(Math.max(...xs)), 0, w - 1),
      minY: clamp(Math.floor(Math.min(...ys)), 0, h - 1), maxY: clamp(Math.ceil(Math.max(...ys)), 0, h - 1)
    };
  }

  function buildMask(imageData) {
    const {data,width:w,height:h} = imageData;
    const mask = new Uint8Array(w*h);
    const sensitivity = Number(sensSlider.value);
    const lumLimit = sensitivity === 1 ? 190 : sensitivity === 2 ? 155 : 120;
    const satLimit = sensitivity === 1 ? 22 : sensitivity === 2 ? 34 : 48;
    const useColor = colorFilter.checked;
    const target = hexRgb(colorInput.value);
    const tolerance = Number(toleranceInput.value);
    for (let p=0,i=0; p<w*h; p++,i+=4) {
      const r=data[i],g=data[i+1],b=data[i+2],a=data[i+3];
      if (a < 40) continue;
      if (useColor) {
        if (Math.hypot(r-target.r,g-target.g,b-target.b) <= tolerance) mask[p]=1;
      } else {
        const lum=0.2126*r+0.7152*g+0.0722*b;
        const sat=Math.max(r,g,b)-Math.min(r,g,b);
        if (sat >= satLimit || lum <= lumLimit) mask[p]=1;
      }
    }
    const bounds=plotBounds(w,h);
    if (bounds) {
      for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
        if (x<bounds.minX || x>bounds.maxX || y<bounds.minY || y>bounds.maxY) mask[y*w+x]=0;
      }
    }
    if ($('cd-suppress-lines').checked) suppressLongStrokes(mask,w,h,Number(runSlider.value)/100);
    return mask;
  }

  function suppressLongStrokes(mask,w,h,fraction) {
    const remove = new Uint8Array(mask.length);
    const minH = Math.max(24,Math.floor(w*fraction));
    const minV = Math.max(24,Math.floor(h*fraction));
    for (let y=0;y<h;y++) {
      let x=0;
      while(x<w) {
        if (!mask[y*w+x]) {x++;continue;}
        const start=x; while(x<w && mask[y*w+x]) x++;
        if (x-start>=minH) for(let xx=start;xx<x;xx++) remove[y*w+xx]=1;
      }
    }
    for (let x=0;x<w;x++) {
      let y=0;
      while(y<h) {
        if (!mask[y*w+x]) {y++;continue;}
        const start=y; while(y<h && mask[y*w+x]) y++;
        if (y-start>=minV) for(let yy=start;yy<y;yy++) remove[yy*w+x]=1;
      }
    }
    for(let i=0;i<mask.length;i++) if(remove[i]) mask[i]=0;
  }

  /** Square dilation (used only to BRIDGE small gaps where another line crosses; never added to the pixels). */
  function dilate(mask,w,h,r) {
    const tmp=new Uint8Array(mask.length),out=new Uint8Array(mask.length);
    for(let y=0;y<h;y++){const row=y*w;for(let x=0;x<w;x++){
      if(!mask[row+x])continue;
      const a=Math.max(0,x-r),b=Math.min(w-1,x+r);for(let xx=a;xx<=b;xx++)tmp[row+xx]=1;
    }}
    for(let y=0;y<h;y++){for(let x=0;x<w;x++){
      if(!tmp[y*w+x])continue;
      const a=Math.max(0,y-r),b=Math.min(h-1,y+r);for(let yy=a;yy<=b;yy++)out[yy*w+x]=1;
    }}
    return out;
  }

  /** Group mask pixels by dominant colour. Returns [{color:'#rrggbb', mask:Uint8Array}] */
  function colorClusters(imageData,mask,sepDist,minSize) {
    const {data}=imageData,buckets=new Map();
    let total=0;
    for(let p=0;p<mask.length;p++){
      if(!mask[p])continue;
      const i=p*4,r=data[i],g=data[i+1],b=data[i+2],key=((r>>4)<<8)|((g>>4)<<4)|(b>>4);
      let o=buckets.get(key);if(!o){o={n:0,r:0,g:0,b:0};buckets.set(key,o);}
      o.n++;o.r+=r;o.g+=g;o.b+=b;total++;
    }
    const list=[...buckets.values()].map(o=>({n:o.n,r:o.r/o.n,g:o.g/o.n,b:o.b/o.n})).sort((a,b)=>b.n-a.n);
    const dist=(a,b)=>Math.hypot(a.r-b.r,a.g-b.g,a.b-b.b);
    const minCount=Math.max(minSize,total*0.003);
    const centers=[];
    for(const b of list){
      if(b.n<minCount)break;
      if(centers.length<16&&centers.every(c=>dist(c,b)>sepDist))centers.push({r:b.r,g:b.g,b:b.b});
    }
    if(!centers.length&&list.length)centers.push(list[0]);
    const masks=centers.map(()=>new Uint8Array(mask.length));
    for(let p=0;p<mask.length;p++){
      if(!mask[p])continue;
      const i=p*4,px={r:data[i],g:data[i+1],b:data[i+2]};
      let best=0,bd=Infinity;
      for(let k=0;k<centers.length;k++){const d=dist(centers[k],px);if(d<bd){bd=d;best=k;}}
      masks[best][p]=1;
    }
    return centers.map((c,k)=>({color:rgbToHex(c.r,c.g,c.b),mask:masks[k]}));
  }

  function components(mask,w,h,minSize,connect) {
    connect=connect||mask;
    const seen=new Uint8Array(mask.length),found=[];
    const queue=new Int32Array(mask.length);
    const neighbors=[-w-1,-w,-w+1,-1,1,w-1,w,w+1];
    for(let seed=0;seed<mask.length;seed++) {
      if(!mask[seed]||seen[seed]) continue;
      let head=0,tail=0;queue[tail++]=seed;seen[seed]=1;
      let minX=w,minY=h,maxX=0,maxY=0,sumX=0,sumY=0;
      const pixels=[];
      while(head<tail) {
        const idx=queue[head++],x=idx%w,y=(idx/w)|0;
        if(mask[idx]){
          pixels.push(idx);sumX+=x;sumY+=y;
          if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;
        }
        for(const d of neighbors) {
          const ni=idx+d;
          if(ni<0||ni>=mask.length||seen[ni]||!connect[ni])continue;
          const nx=ni%w;if(Math.abs(nx-x)>1)continue;
          seen[ni]=1;queue[tail++]=ni;
        }
      }
      if(!pixels.length)continue;
      const bw=maxX-minX+1,bh=maxY-minY+1;
      if(pixels.length<minSize)continue;
      if((bw>0.72*w&&bh<Math.max(5,h*0.025))||(bh>0.72*h&&bw<Math.max(5,w*0.025)))continue;
      found.push({pixels,minX,minY,maxX,maxY,width:bw,height:bh,cx:sumX/pixels.length,cy:sumY/pixels.length,size:pixels.length});
    }
    return found.sort((a,b)=>a.minX-b.minX||a.minY-b.minY);
  }

  function pointsFromComponent(comp,w,n) {
    const bins=new Map();
    const span=Math.max(1,comp.maxX-comp.minX+1);
    const binCount=Math.min(Math.max(2,n),span);
    for(const idx of comp.pixels) {
      const x=idx%w,y=(idx/w)|0;
      const bin=Math.min(binCount-1,Math.floor((x-comp.minX)/span*binCount));
      if(!bins.has(bin))bins.set(bin,[]);
      bins.get(bin).push({x,y});
    }
    const raw=[];
    for(const arr of bins.values()) {
      arr.sort((a,b)=>a.y-b.y);
      const med=arr[Math.floor(arr.length/2)];
      raw.push({x:arr.reduce((s,p)=>s+p.x,0)/arr.length+0.5,y:med.y+0.5});   // +0.5 = pixel centre
    }
    raw.sort((a,b)=>a.x-b.x);
    if(raw.length<=n)return raw;
    return Array.from({length:n},(_,i)=>raw[Math.round(i*(raw.length-1)/(n-1))]);
  }

  function scatterPoints(comps,n) {
    const pts=comps.map(c=>({x:c.cx+0.5,y:c.cy+0.5})).sort((a,b)=>a.x-b.x||a.y-b.y);
    if(pts.length<=n)return pts;
    return Array.from({length:n},(_,i)=>pts[Math.round(i*(pts.length-1)/(n-1))]);
  }

  /* ---------- preview (always rendered from detectedResults => colours always match) ---------- */
  function refreshOverlay() {
    let overlay=document.getElementById('cd-overlay');
    if(!previewCanvas){
      if(overlay)overlay.getContext('2d').clearRect(0,0,overlay.width,overlay.height);
      return;
    }
    if(!overlay){
      overlay=document.createElement('canvas');overlay.id='cd-overlay';
      Object.assign(overlay.style,{position:'absolute',inset:'0',width:'100%',height:'100%',pointerEvents:'none',zIndex:'3',opacity:'1'});
      canvasContainer.appendChild(overlay);
    }
    if(overlay.width!==canvas.width)overlay.width=canvas.width;
    if(overlay.height!==canvas.height)overlay.height=canvas.height;
    const ctx2=overlay.getContext('2d');
    ctx2.setTransform(1,0,0,1,0,0);ctx2.clearRect(0,0,overlay.width,overlay.height);
    ctx2.imageSmoothingEnabled=false;                       // keep exact colours / crisp pixels
    ctx2.setTransform(dpr*zoom,0,0,dpr*zoom,dpr*panX,dpr*panY);
    ctx2.drawImage(previewCanvas,0,0);
  }
  window.refreshCurveDetectorOverlay=refreshOverlay;

  function dropPreview() { previewCanvas=null; refreshOverlay(); }

  function renderPreview() {
    if(!previewToggle.checked||!detectedResults.length||!previewDims){dropPreview();return;}
    const {w,h}=previewDims;
    previewCanvas=previewCanvas||document.createElement('canvas');
    previewCanvas.width=w;previewCanvas.height=h;
    const c=previewCanvas.getContext('2d');
    const out=c.createImageData(w,h),d=out.data;
    for(const res of detectedResults){
      const {r,g,b}=hexRgb(res.color);
      for(const group of res.groups) for(const idx of group){
        const o=idx*4;d[o]=r;d[o+1]=g;d[o+2]=b;d[o+3]=255;
      }
    }
    c.putImageData(out,0,0);
    refreshOverlay();
  }
  let previewQueued=false;
  function schedulePreview() {                 // coalesce rapid colour-picker 'input' events
    if(previewQueued)return;previewQueued=true;
    requestAnimationFrame(()=>{previewQueued=false;renderPreview();});
  }
  previewToggle.addEventListener('change',renderPreview);

  $('cd-clear-preview').addEventListener('click',()=>{
    previewToggle.checked=false;dropPreview();
    setStatus('Detector preview hidden. Tick “Preview detected components” to show it again.');
  });

  function clearDetection() {
    detectedResults=[];previewDims=null;
    dropPreview();renderResults();
  }

  window.resetCurveDetector = function() {
    clearDetection();
    modeSelect.value = 'curves';
    $('cd-suppress-lines').checked = true;
    if($('cd-limit-bounds'))$('cd-limit-bounds').checked = true;
    $('cd-split-colors').checked = true;
    $('cd-ignore-gray').checked = true;
    minWSlider.value = '15'; $('cd-minw-val').textContent = '15';
    splitDist.value = '60'; $('cd-split-val').textContent = '60';
    runSlider.value = '18'; $('cd-run-val').textContent = '18%';
    sensSlider.value = '2'; $('cd-sensitivity-val').textContent = 'Medium';
    colorFilter.checked = false;
    colorInput.value = '#ff0000'; $('cd-color-chip').style.background = '#ff0000';
    toleranceInput.value = '55'; $('cd-tol-val').textContent = '55';
    syncColorControls();
    $('cd-min-size').value = '35'; $('cd-points').value = '100';
    previewToggle.checked = true;
    $('cd-points-label').textContent = 'Points per curve / dataset:';
    setStatus('Upload an image and calibrate axes to detect curves.');
    ready();
  };

  /* ---------- result rows ---------- */
  function renderResults() {
    resultsBox.innerHTML='';
    if(!detectedResults.length){addBtn.disabled=true;return;}
    detectedResults.forEach((item,index)=>{
      const row=document.createElement('div');row.className='cd-result-row';
      const swatch=document.createElement('input');swatch.type='color';swatch.className='cd-result-color';swatch.value=item.color;swatch.title='Dataset color (also repaints the preview on the graph)';swatch.setAttribute('aria-label',`Color for ${item.name}`);
      const name=document.createElement('input');name.type='text';name.className='cd-result-name';name.value=item.name;name.placeholder=`Dataset ${index+1}`;name.title=item.meta||'';name.setAttribute('aria-label',`Dataset ${index+1} name`);
      const meta=document.createElement('span');meta.className='cd-result-meta';meta.textContent=`${item.points.length} pts`;meta.title=item.meta||'';
      name.style.borderLeft=`4px solid ${item.color}`;
      swatch.addEventListener('input',()=>{
        item.color=swatch.value;
        name.style.borderLeft=`4px solid ${item.color}`;
        schedulePreview();                                  // <- keeps the graph in sync with the swatch
      });
      name.addEventListener('input',()=>{item.name=name.value;swatch.setAttribute('aria-label',`Color for ${item.name||`Dataset ${index+1}`}`);});
      row.append(swatch,name,meta);resultsBox.appendChild(row);
    });
    addBtn.disabled=false;
  }

  /* ---------- detect ---------- */
  detectBtn.addEventListener('click',()=>{
    if(!hasImage()){setStatus('Upload a graph image first.');return;}
    if(!isCalibrated){setStatus('Calibrate the axes before detecting data.');return;}
    // Use the SAME pixels the user sees and the eyedropper samples (brightness / contrast / grid filter applied).
    const imageData=getPixelData();
    setStatus('Scanning image and separating components…');showSpinner(true);detectBtn.disabled=true;
    setTimeout(()=>{
      try {
        const mode=modeSelect.value;
        const w=imageData.width,h=imageData.height;
        const mask=buildMask(imageData);
        const minSize=Math.max(1,Number($('cd-min-size').value)||35);
        const split=mode==='curves'&&$('cd-split-colors').checked&&!colorFilter.checked;
        const pb=plotBounds(w,h);
        const plotW=pb?pb.maxX-pb.minX+1:w;
        const minCurveW=Math.max(8,plotW*Number(minWSlider.value)/100);
        let comps;
        if(split){
          // 1) group pixels by colour  2) find connected pieces per colour (bridging small crossing gaps)
          //    3) drop gray/grid colours, short fragments, and "fringe" copies of an already-kept line
          comps=[];
          const ignoreGray=$('cd-ignore-gray').checked;
          const claimed=new Uint8Array(w*h);            // pixels (+2px halo) belonging to lines already kept
          colorClusters(imageData,mask,Number(splitDist.value),minSize).forEach(cl=>{   // most-populated colour first
            const {r,g,b}=hexRgb(cl.color);
            const sat=Math.max(r,g,b)-Math.min(r,g,b),lum=0.2126*r+0.7152*g+0.0722*b;
            if(ignoreGray&&sat<30&&lum>110)return;
            components(cl.mask,w,h,minSize,dilate(cl.mask,w,h,3))
              .filter(c=>c.width>=minCurveW&&c.height>=2)
              .sort((a,b)=>b.size-a.size)
              .forEach(c=>{
                let overlap=0;
                for(const idx of c.pixels)if(claimed[idx])overlap++;
                if(overlap>0.5*c.pixels.length)return;  // anti-aliasing fringe of a line we already have
                const halo=new Uint8Array(w*h);
                for(const idx of c.pixels)halo[idx]=1;
                const grown=dilate(halo,w,h,2);
                for(let i=0;i<grown.length;i++)if(grown[i])claimed[i]=1;
                c.color=oppositeColor(cl.color);comps.push(c);
              });
          });
          comps.sort((a,b)=>a.minX-b.minX||a.minY-b.minY);
        } else {
          comps=components(mask,w,h,minSize);
        }
        if(mode==='curves') comps=comps.filter(c=>c.width>=minCurveW&&c.height>=2);
        if(mode==='scatter') comps=comps.filter(c=>c.width>=2&&c.height>=2);
        if(!comps.length){
          clearDetection();
          setStatus('Nothing detected. Try changing sensitivity, color tolerance, minimum size, or line suppression.');
          return;
        }
        const n=clamp(Number($('cd-points').value)||100,2,5000);
        const candidates=[];
        let truncated=false;
        if(mode==='scatter') {
          const coords=scatterPoints(comps,n);
          truncated=comps.length>n;
          candidates.push({name:'Scatter Markers',color:palette[0],coords,groups:comps.map(c=>c.pixels),meta:`${comps.length} marker components`});
        } else {
          comps.forEach(comp=>{
            const coords=pointsFromComponent(comp,w,n);
            if(coords.length<2)return;
            const k=candidates.length;                      // colour/name index follows the visible rows, no gaps
            candidates.push({name:`Detected Line ${k+1}`,color:comp.color||palette[k%palette.length],coords,groups:[comp.pixels],meta:`${comp.size} pixels`});
          });
        }
        detectedResults=candidates.map(set=>{
          const pts=[];
          set.coords.forEach(p=>{const dc=canvasToDataCoords(p.x,p.y);if(dc)pts.push({x:p.x,y:p.y,dataX:dc.dataX,dataY:dc.dataY,order:pts.length+1});});
          return {name:set.name,color:set.color,points:pts,meta:set.meta,groups:set.groups};
        }).filter(r=>r.points.length>=(mode==='scatter'?1:2));
        previewDims={w,h};
        renderResults();
        renderPreview();
        if(!detectedResults.length){setStatus('Pixels were found, but no valid calibrated points could be created. Check axis calibration.');return;}
        setStatus(`Found ${detectedResults.length} candidate dataset(s)${split?' (separated by color)':''}. Each swatch is the opposite of its line’s own color, and the preview on the graph uses the same colors — rename each dataset and adjust its color if you like, then click “Add Named Datasets”.`+(truncated?` Note: ${comps.length} markers were found but only ${n} are kept; raise “Maximum marker points” to keep all.`:''));
      } catch(err) {
        console.error('Detection failed',err);setStatus(`Detection failed: ${err.message||err}`);
      } finally {showSpinner(false);ready();}
    },30);
  });

  /* ---------- add to project ---------- */
  addBtn.addEventListener('click',()=>{
    if(!detectedResults.length)return;
    if(!isCalibrated){setStatus('Axes are no longer calibrated. Re-calibrate, then add the datasets.');return;}
    const existingNames=new Set(lines.map(l=>l.name));
    const additions=[];
    detectedResults.forEach((r,index)=>{
      // Recompute data values now, so a re-calibration after detection cannot leave stale numbers.
      const pts=[];
      r.points.forEach(p=>{const dc=canvasToDataCoords(p.x,p.y);if(dc)pts.push({x:p.x,y:p.y,dataX:dc.dataX,dataY:dc.dataY,order:pts.length+1});});
      if(!pts.length)return;
      const base=(r.name||'').trim()||`Detected Dataset ${index+1}`;
      let name=base,suffix=2;while(existingNames.has(name))name=`${base} (${suffix++})`;
      existingNames.add(name);
      additions.push({name,color:r.color,points:pts,sorted:false,orderCounter:pts.length});
    });
    if(!additions.length){setStatus('No valid datasets to add.');return;}
    lines.push(...additions);currentLineIndex=lines.length-1;
    saveState();                                           // snapshot AFTER the change so Undo removes the datasets
    updateLineSelect();updatePreview();updateButtonStates();draw();
    const n=additions.length;
    clearDetection();                                      // datasets now draw themselves in their own colors
    setStatus(`Added ${n} dataset(s) with their chosen colors. Change the active dataset from Line Management.`);
  });

  ready();
})();
