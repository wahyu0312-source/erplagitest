/* ===========================
   Teisei ERP Frontend (app.js)
   ===========================
   - Backend: Google Apps Script (code.gs) yang kamu pasang.
   - Pastikan sudah DEPLOY sebagai Web App (akses: Anyone).
   - Ganti API_BASE di bawah dengan URL Web App kamu.
*/

// ====== KONFIGURASI ======
const API_BASE = 'https://script.google.com/macros/s/AKfycbyFPilRpjXxKVlM2Av2LunQJAIJszz9wNX0j1Ab1pbWkZeecIx_QNZwoKQR6XCNGYSLGA/exec'; // contoh: https://script.google.com/macros/s/AKfycbx.../exec
const REQ_TIMEOUT = 20000; // ms

// ====== HELPERS DOM / UI ======
const $  = (q,el=document)=>el.querySelector(q);
const $$ = (q,el=document)=>[...el.querySelectorAll(q)];
const sleep = (ms)=> new Promise(r=>setTimeout(r,ms));
function el(tag, attrs={}, ...children){
  const x = document.createElement(tag);
  Object.entries(attrs||{}).forEach(([k,v])=>{
    if(k==='class') x.className=v;
    else if(k==='style') Object.assign(x.style, v);
    else if(k.startsWith('on') && typeof v==='function') x.addEventListener(k.slice(2), v);
    else x.setAttribute(k,v);
  });
  children.flat().forEach(c=>{
    if(c==null) return;
    x.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
  });
  return x;
}
const fmtNum  = (n)=> new Intl.NumberFormat('ja-JP').format(Number(n||0));
const fmtYMD  = (d)=> {
  if(!d) return '';
  const dt = (d instanceof Date) ? d : new Date(d);
  if(isNaN(dt)) return '';
  return dt.toISOString().slice(0,10);
};
const download = (filename, blob)=> {
  const url = URL.createObjectURL(blob);
  const a = el('a',{href:url,download:filename});
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
};
function toast(msg, ok=true){
  const t = el('div',{class:'card',style:{
    position:'fixed',right:'16px',bottom:'16px',zIndex:9999,
    background: ok?'var(--panel)':'#6b1d1d', color:'var(--ink)'
  }}, msg);
  document.body.appendChild(t);
  setTimeout(()=>t.remove(),1800);
}
function show(id){
  ["authView","pageDash","pageSales","pagePlan","pageShip","pageFinished","pageInv","pageInvoice","pageAnalytics"].forEach(p=>$("#"+p)?.classList.add("hidden"));
  $("#"+id)?.classList.remove("hidden");
}
function markActive(btnId){
  $$(".nav .item").forEach(x=>x.classList.remove("active"));
  $("#"+btnId)?.classList.add("active");
}

// ====== STATE ======
const State = {
  user: null,
  masters: null,
  charts: {},
  cache: {
    orders: null, sales: null, plans: null, ship: null, finished: null, inventory: null,
    invoices: null, invoiceCand: null
  }
};

// ====== API CORE ======
async function api(action, payload={}){
  const ctrl = new AbortController();
  const t = setTimeout(()=>ctrl.abort(), REQ_TIMEOUT);
  try{
    const res = await fetch(API_BASE, {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ action, ...payload }),
      signal: ctrl.signal
    });
    const json = await res.json();
    if(!json.ok) throw new Error(json.error || 'API error');
    return json.data;
  } finally { clearTimeout(t); }
}

// ====== THEME INIT (sinkron tombol di HTML) ======
(function initTheme(){
  const sysDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const saved = localStorage.getItem("theme") || (sysDark ? "dark":"dark");
  document.documentElement.setAttribute("data-theme", saved);
  const btn=$("#btnTheme");
  const sync=()=>{ if(btn) btn.innerHTML=(document.documentElement.getAttribute("data-theme")==="dark" ? '<i class="fa-solid fa-sun"></i> Light':'<i class="fa-solid fa-moon"></i> Dark'); };
  if(btn) btn.onclick=()=>{ const t=document.documentElement.getAttribute("data-theme")==="dark"?"light":"dark"; document.documentElement.setAttribute("data-theme",t); localStorage.setItem("theme",t); sync(); };
  sync();
})();

// ====== AUTH ======
function syncAdminUI(){
  const admin = State.user && (State.user.role==='admin' || String(State.user.role).includes('admin'));
  $("#btnAddMember")?.classList.toggle('hidden', !admin);
  $("#userInfo").textContent = State.user ? (State.user.username || '') : '—';
}
async function login(username, password){
  const data = await api('login',{username, password});
  State.user = data;
  localStorage.setItem('erp_user', JSON.stringify(State.user));
  syncAdminUI();
  return data;
}
async function quickStart(){
  // coba load user dari cache
  const u = localStorage.getItem('erp_user');
  if(u){
    try{ State.user = JSON.parse(u); }catch(_){}
  }
  if(State.user){
    syncAdminUI();
    markActive("btnToDash"); show("pageDash");
    // preload paralel utk cepat
    refreshAll();
  }else{
    markActive(""); show("authView");
  }
}
window.addEventListener('DOMContentLoaded', quickStart);

async function loginSubmit(){
  const user = $("#inUser").value.trim();
  const pass = $("#inPass").value;
  if(!user || !pass) return toast('Username/Password kosong', false);
  $("#btnLogin").disabled = true;
  try{
    await login(user, pass);
    toast('Login sukses');
    markActive("btnToDash"); show("pageDash");
    refreshAll();
  }catch(err){
    toast(err.message||String(err), false);
  }finally{
    $("#btnLogin").disabled = false;
  }
}
window.loginSubmit = loginSubmit;
$("#btnLogin")?.addEventListener("click", loginSubmit);
$("#btnLogout")?.addEventListener("click", ()=>{
  localStorage.removeItem('erp_user');
  State.user=null; syncAdminUI();
  markActive(""); show("authView");
});

// ====== LIST MASTERS (cache) ======
async function loadMasters(){
  if(State.masters) return State.masters;
  try{
    const m = await api('listMasters');
    State.masters = m;
    localStorage.setItem('erp_masters', JSON.stringify(m));
    return m;
  }catch(_){
    const c = localStorage.getItem('erp_masters');
    if(c){ try{ State.masters = JSON.parse(c); return State.masters; }catch(__){} }
    return null;
  }
}

// ====== GENERIC TABLE RENDER ======
function renderHeader(theadEl, header){
  theadEl.innerHTML = '';
  const tr = el('tr');
  header.forEach(h=> tr.appendChild(el('th',{}, String(h))));
  theadEl.appendChild(tr);
}
function renderRows(tbodyEl, rows){
  tbodyEl.innerHTML = '';
  rows.forEach(r=>{
    const tr = el('tr');
    r.forEach(v=> tr.appendChild(el('td',{}, (v==null?'':String(v)))));
    tbodyEl.appendChild(tr);
  });
}

// ====== DASHBOARD ======
async function loadOrders(){
  $("#tbOrders").innerHTML = '<tr><td colspan="9">Loading…</td></tr>';
  const data = await api('listOrders');
  State.cache.orders = data;
  const q = ($("#searchQ").value||'').toLowerCase().trim();
  const filtered = (q ? data.filter(o=>
    Object.values(o).some(v=> String(v||'').toLowerCase().includes(q))
  ) : data);

  const tbody = $("#tbOrders");
  tbody.innerHTML='';
  filtered.forEach(o=>{
    const row = el('tr',{},
      el('td',{}, el('div',{}, el('div',{}, o.po_id||''), el('div',{class:'s muted'}, o['得意先']||''))),
      el('td',{}, o['品名']||''),
      el('td',{}, o['品番']||''),
      el('td',{}, o['図番']||''),
      el('td',{}, o.status||''),
      el('td',{}, o.current_process||''),
      el('td',{}, o.updated_at?fmtYMD(o.updated_at):''),
      el('td',{}, o.updated_by||''),
      el('td',{}, el('button',{class:'btn s',onclick:()=>openOpDialog(o.po_id)},'工程入力'))
    );
    tbody.appendChild(row);
  });

  drawDashChart(data);
}
function drawDashChart(data){
  const ctx = $("#chartDash");
  if(!ctx) return;
  const byProc = {};
  (data||[]).forEach(o=>{
    const k = o.current_process || '—';
    byProc[k] = (byProc[k]||0)+1;
  });
  const labels = Object.keys(byProc);
  const values = labels.map(k=>byProc[k]);
  if(State.charts.dash) State.charts.dash.destroy();
  State.charts.dash = new Chart(ctx, {
    type:'bar',
    data:{ labels, datasets:[{label:'件数', data: values}] },
    options:{
      plugins:{ legend:{display:false}, datalabels:{anchor:'end',align:'top',formatter:Math.round} },
      scales:{ y:{ beginAtZero:true } }
    },
    plugins: [ChartDataLabels]
  });
}
$("#searchQ")?.addEventListener('input', ()=> loadOrders());

// ====== SALES ======
async function loadSales(){
  $("#thSales").innerHTML=''; $("#tbSales").innerHTML='<tr><td>Loading…</td></tr>';
  const {header, rows} = await api('listSales');
  State.cache.sales = {header, rows};
  renderHeader($("#thSales"), header);
  renderRows($("#tbSales"), rows);
}
$("#btnSalesExport")?.addEventListener('click', async()=>{
  const data = State.cache.sales || await api('listSales');
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([data.header, ...(data.rows||[])]);
  XLSX.utils.book_append_sheet(wb, ws, 'Sales');
  const buf = XLSX.write(wb, {type:'array', bookType:'xlsx'});
  download('sales.xlsx', new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
});

// ====== PLANS ======
async function loadPlans(){
  $("#thPlan").innerHTML=''; $("#tbPlan").innerHTML='<tr><td>Loading…</td></tr>';
  const {header, rows} = await api('listPlans');
  State.cache.plans = {header, rows};
  renderHeader($("#thPlan"), header);
  renderRows($("#tbPlan"), rows);
}
$("#btnPlanExport")?.addEventListener('click', async()=>{
  const data = State.cache.plans || await api('listPlans');
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([data.header, ...(data.rows||[])]);
  XLSX.utils.book_append_sheet(wb, ws, 'Plans');
  const buf = XLSX.write(wb, {type:'array', bookType:'xlsx'});
  download('plans.xlsx', new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
});

// ====== SHIP ======
async function loadShips(){
  $("#thShip").innerHTML=''; $("#tbShip").innerHTML='<tr><td>Loading…</td></tr>';
  const {header, rows} = await api('listShip');
  State.cache.ship = {header, rows};
  renderHeader($("#thShip"), header);
  renderRows($("#tbShip"), rows);
}
$("#btnShipExport")?.addEventListener('click', async()=>{
  const data = State.cache.ship || await api('listShip');
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([data.header, ...(data.rows||[])]);
  XLSX.utils.book_append_sheet(wb, ws, 'Ship');
  const buf = XLSX.write(wb, {type:'array', bookType:'xlsx'});
  download('shipments.xlsx', new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
});

// ====== FINISHED ======
async function loadFinished(){
  $("#thFin").innerHTML=''; $("#tbFin").innerHTML='<tr><td>Loading…</td></tr>';
  const {header, rows} = await api('listFinished');
  State.cache.finished = {header, rows};
  renderHeader($("#thFin"), header);
  renderRows($("#tbFin"), rows);
}

// ====== INVENTORY ======
async function loadInventory(){
  $("#thInv").innerHTML=''; $("#tbInv").innerHTML='<tr><td>Loading…</td></tr>';
  const {header, rows} = await api('listInventory');
  State.cache.inventory = {header, rows};
  renderHeader($("#thInv"), header);
  renderRows($("#tbInv"), rows);
}
$("#btnInvExport")?.addEventListener('click', async()=>{
  const data = State.cache.inventory || await api('listInventory');
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([data.header, ...(data.rows||[])]);
  XLSX.utils.book_append_sheet(wb, ws, 'Inventory');
  const buf = XLSX.write(wb, {type:'array', bookType:'xlsx'});
  download('inventory.xlsx', new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
});

// ====== OPERATION MANUAL / QR ======
function openOpDialog(po){
  $("#opPO").textContent = po;
  $("#opOK").value = 0; $("#opNG").value = 0; $("#opNote").value='';
  const sel = $("#opProcess");
  sel.innerHTML='';
  ['準備','切断','曲げ','レザー加工','外注加工/組立','検査済','出荷済'].forEach(p=> sel.appendChild(el('option',{value:p},p)));
  $("#dlgOp").showModal();
}
$("#btnOpCancel")?.addEventListener('click', ()=> $("#dlgOp").close());
$("#btnOpSave")?.addEventListener('click', async()=>{
  const data = {
    po_id: $("#opPO").textContent,
    process: $("#opProcess").value,
    ok_count: Number($("#opOK").value||0),
    ng_count: Number($("#opNG").value||0),
    note: $("#opNote").value||'',
    status: ''
  };
  try{
    await api('saveOp', {data, user: State.user});
    toast('保存しました');
    $("#dlgOp").close();
    loadOrders();
  }catch(err){ toast(err.message||String(err), false); }
});

// ====== QR Scan ======
let mediaStream=null, scanLoopOn=false;
async function startScan(){
  $("#dlgScan").showModal();
  try{
    mediaStream = await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}});
    const video = $("#scanVideo"); const canvas=$("#scanCanvas"); const ctx=canvas.getContext('2d');
    video.srcObject = mediaStream; await video.play();
    scanLoopOn = true;
    (async function loop(){
      if(!scanLoopOn) return;
      if(video.readyState===video.HAVE_ENOUGH_DATA){
        canvas.width = video.videoWidth; canvas.height=video.videoHeight;
        ctx.drawImage(video,0,0,canvas.width,canvas.height);
        const img = ctx.getImageData(0,0,canvas.width,canvas.height);
        const code = jsQR(img.data, canvas.width, canvas.height);
        if(code && code.data){
          $("#scanResult").textContent = code.data;
          const parts = String(code.data).split('|'); // contoh: PO123|検査済|OK:5|NG:0|note
          const po = parts[0]; const process = parts[1]||'';
          let ok=0, ng=0, note='';
          parts.slice(2).forEach(p=>{
            if(/^OK:/i.test(p)) ok = Number(p.split(':')[1]||0);
            else if(/^NG:/i.test(p)) ng = Number(p.split(':')[1]||0);
            else note += (note?' ':'')+p;
          });
          await api('saveOp',{data:{po_id:po, process, ok_count:ok, ng_count:ng, note}, user:State.user});
          toast(`スキャン保存: ${po}`);
          loadOrders();
          scanLoopOn=false; closeScan();
          return;
        }
      }
      await sleep(120);
      loop();
    })();
  }catch(err){ toast(err.message||String(err), false); }
}
function closeScan(){
  $("#dlgScan").close();
  scanLoopOn=false;
  if(mediaStream){ mediaStream.getTracks().forEach(t=>t.stop()); mediaStream=null; }
}
$("#btnStationQR")?.addEventListener('click', startScan);
$("#btnScanStart")?.addEventListener('click', startScan);
$("#btnScanClose")?.addEventListener('click', closeScan);

// ====== INVOICE ======
async function initInvoicePage(){
  // dropdown customer
  const m = await loadMasters();
  const sel = $("#invoiceCustomer"); if(!sel) return;
  const cur = sel.value;
  sel.innerHTML='<option value="">(得意先を選択)</option>';
  (m?.customers||[]).forEach(c=> sel.appendChild(el('option',{value:c, selected: c===cur}, c)));
  $("#invoiceDate").value = fmtYMD(new Date());
  await reloadInvoiceTables();
}
async function reloadInvoiceTables(){
  const cust = $("#invoiceCustomer").value || '';
  if(!cust) { $("#tbInvoiceCandidates").innerHTML=''; $("#tbInvoiceStatus").innerHTML=''; return; }
  const {pending, all} = await api('invoiceCandidates',{customer:cust});
  State.cache.invoiceCand = {pending, all};
  // candidates
  const tbody1 = $("#tbInvoiceCandidates"); tbody1.innerHTML='';
  (pending||[]).forEach(r=>{
    const ck = el('input',{type:'checkbox', 'data-po':r.po_id, 'data-ship':r.ship_id, 'data-qty':r.数量, 'data-unit':r.単価});
    const tr = el('tr',{},
      el('td',{}, ck),
      el('td',{}, r.po_id||''),
      el('td',{}, r.商品名||''),
      el('td',{}, r.品番||''),
      el('td',{}, fmtNum(r.数量)),
      el('td',{}, fmtNum(r.単価)),
      el('td',{}, fmtNum(r.金額)),
      el('td',{}, r.出荷日||'')
    );
    tbody1.appendChild(tr);
  });
  // status all
  const tbody2 = $("#tbInvoiceStatus"); tbody2.innerHTML='';
  (all||[]).forEach(r=>{
    const chip = el('span',{class:'chip '+(String(r.請求書状態).includes('済')?'ok':'')}, r.請求書状態||'');
    const tr = el('tr',{},
      el('td',{}, r.po_id||''),
      el('td',{}, r.商品名||''),
      el('td',{}, r.品番||''),
      el('td',{}, fmtNum(r.数量)),
      el('td',{}, fmtNum(r.単価)),
      el('td',{}, fmtNum(r.金額)),
      el('td',{}, r.出荷日||''),
      el('td',{}, chip)
    );
    tbody2.appendChild(tr);
  });
  await listInvoices();
}
async function listInvoices(){
  const list = await api('listInvoices');
  State.cache.invoices = list;
  const tb = $("#tbInvoiceList"); tb.innerHTML='';
  (list||[]).forEach(x=>{
    const tr = el('tr',{},
      el('td',{}, x.invoice_id||''),
      el('td',{}, x.customer||''),
      el('td',{}, fmtYMD(x.issue_date)),
      el('td',{}, fmtNum(x.total)),
      el('td',{}, x.filename||''),
      el('td',{}, x.created_by||'')
    );
    tb.appendChild(tr);
  });
}
$("#invoiceCustomer")?.addEventListener('change', reloadInvoiceTables);
$("#btnInvoiceReload")?.addEventListener('click', reloadInvoiceTables);
$("#btnInvoiceSave")?.addEventListener('click', async()=>{
  const cust = $("#invoiceCustomer").value;
  if(!cust) return toast('得意先を選択してください', false);
  const issue_date = $("#invoiceDate").value || fmtYMD(new Date());
  const items = [...$("#tbInvoiceCandidates input[type=checkbox]:checked")].map(ck=>{
    const po_id = ck.getAttribute('data-po');
    const ship_id = ck.getAttribute('data-ship');
    const 数量 = Number(ck.getAttribute('data-qty')||0);
    const 単価 = Number(ck.getAttribute('data-unit')||0);
    return { po_id, ship_id, 数量, 単価 };
  });
  if(!items.length) return toast('明細が空です', false);
  try{
    const res = await api('createInvoice',{data:{customer:cust, issue_date, items}, user:State.user});
    toast('請求書を作成しました');
    reloadInvoiceTables();
  }catch(err){ toast(err.message||String(err), false); }
});

// ====== ADMIN: ADD MEMBER ======
$("#btnAddMemberSave")?.addEventListener('click', async()=>{
  const f = $("#formAddMember");
  const data = Object.fromEntries(new FormData(f).entries());
  if(!data.username || !data.password) return toast('username/password wajib', false);
  try{
    await api('addMember',{data, user: State.user});
    toast('User ditambahkan');
    $("#dlgAddMember").close(); f.reset();
  }catch(err){ toast(err.message||String(err), false); }
});

// ====== REFRESH ALL ======
async function refreshAll(){
  try{
    await Promise.all([
      loadMasters(),
      loadOrders(),
      // prefetch lain tapi tidak menghalangi UI
      (async()=>{ try{ await loadSales(); }catch(_){} })(),
      (async()=>{ try{ await loadPlans(); }catch(_){} })(),
      (async()=>{ try{ await loadShips(); }catch(_){} })(),
      (async()=>{ try{ await loadFinished(); }catch(_){} })(),
      (async()=>{ try{ await loadInventory(); }catch(_){} })(),
      (async()=>{ try{ await listInvoices(); }catch(_){} })(),
    ]);
  }catch(err){ console.error(err); }
}
window.refreshAll = refreshAll;
window.loadSales = loadSales;
window.loadPlans = loadPlans;
window.loadShips = loadShips;
window.loadFinished = loadFinished;
window.loadInventory = loadInventory;
window.initInvoicePage = initInvoicePage;
window.initCharts = ()=> drawDashChart(State.cache.orders||[]);
