// modules/utils.js
export function debounce(fn, wait){
    let t;
    return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args),wait); };
}
export function download(filename, text, mime){
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], {type:mime}));
    a.download = filename;
    a.click();
}
export function showModal(msg, withInput=false, cb=null){
    const modal = document.getElementById('modal');
    const content = document.getElementById('modal-content');
    content.innerHTML = `<p>${msg}</p>`;
    if (withInput){
        const inp = document.createElement('input');
        inp.type='text'; inp.id='modal-input'; inp.style.width='100%';
        content.appendChild(inp);
    }
    const btns = document.createElement('div');
    btns.style.display='flex'; btns.style.gap='10px'; btns.style.justifyContent='center';
    const ok = document.createElement('button');
    ok.textContent='OK';
    ok.onclick=()=>{ modal.style.display='none'; if(cb) cb(withInput?document.getElementById('modal-input').value:null); };
    const cancel = document.createElement('button');
    cancel.textContent='Cancel';
    cancel.onclick=()=>{ modal.style.display='none'; };
    btns.append(ok, cancel);
    content.appendChild(btns);
    modal.style.display='flex';
    if (withInput) document.getElementById('modal-input').focus();
}
export function showSpinner(on){
    document.getElementById('spinner').style.display = on?'block':'none';
}
