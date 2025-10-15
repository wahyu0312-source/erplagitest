/* =================================================
  App JS — Dashboard + Forms + QR + Weather + Analytics + Invoice + Admin
  Backend: Google Apps Script JSONP (API_BASE)
================================================= */

// ================== CONFIG ==================
const API_BASE = "https://script.google.com/macros/s/AKfycbxf74M8L8PhbzSRR_b-A-3MQ7hqrDBzrJe-X_YXsoLIaC-zxkAiBMEt1H4ANZxUM1Q/exec";

// ================== DOM helpers ==================
const $ = (q, el=document)=> el.querySelector(q);
const $$ = (q, el=document)=> [...el.querySelectorAll(q)];
const qs = (o)=> Object.entries(o).map(([k,v])=>`${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
const fmt = (d)=> d? new Date(d).toLocaleString("ja-JP"):"";

// requestIdleCallback fallback
window.requestIdleCallback ||= (cb)=> setTimeout(cb, 0);

// ================== THEME (Dark/Light) ==================
(function initTheme(){
  const saved = localStorage.getItem("theme") || "light";
  document.documentElement.setAttribute("data-theme", saved);
  const btn = $("#btnTheme");
  const sync = ()=> { const t = document.documentElement.getAttribute("data-theme"); btn.innerHTML = (t==="dark"?`<i class="fa-solid fa-sun"></i> Light`:`<i class="fa-solid fa-moon"></i> Dark`); };
  sync();
  btn.onclick = ()=>{
    const t = document.documentElement.getAttribute("data-theme")==="dark" ? "light":"dark";
    document.documentElement.setAttribute("data-theme", t);
    localStorage.setItem("theme", t);
    sync();
  };
})();

// ================== JSONP & cache ==================
function jsonp(action, params={}){
  return new Promise((resolve,reject)=>{
    const cb = "cb_" + Math.random().toString(36).slice(2);
    params = { ...params, action, callback: cb };
    const s = document.createElement("script");
    s.src = `${API_BASE}?${qs(params)}`;
    let timeout = setTimeout(()=>{ cleanup(); reject(new Error("API timeout")); }, 8000);
    function cleanup(){ try{ delete window[cb]; s.remove(); }catch{} clearTimeout(timeout); }
    window[cb] = (resp)=>{ cleanup(); if(resp && resp.ok) resolve(resp.data); else reject(new Error((resp && resp.error) || "API error")); };
    s.onerror = ()=>{ cleanup(); reject(new Error("JSONP load error")); };
    document.body.appendChild(s);
  });
}
const apiCache = new Map();
async function cached(action, params={}, ttlMs=15000){
  const key = action + ":" + JSON.stringify(params||{});
  const hit = apiCache.get(key);
  const now = Date.now();
  if(hit && now-hit.t < ttlMs) return hit.v;
  const v = await jsonp(action, params);
  apiCache.set(key, {v, t: now});
  return v;
}

// ================== Badges / chips ==================
const normalizeProc = (s)=> String(s||"").trim()
  .replace("レーサ加工","レザー加工")
  .replace("外作加工","外注加工/組立") || "未設定";

const procToChip = (p)=>{
  p = normalizeProc(p);
  if(/レザー加工|レーザー/.test(p)) return `<span class="chip" style="background:#fef3c7"><i class="fa-solid fa-bolt"></i>${p}</span>`;
  if(/曲げ/.test(p)) return `<span class="chip" style="background:#e0f2fe"><i class="fa-solid fa-wave-square"></i>${p}</span>`;
  if(/外注加工|加工/.test(p)) return `<span class="chip" style="background:#e2e8f0"><i class="fa-solid fa-compass-drafting"></i>${p}</span>`;
  if(/組立/.test(p)) return `<span class="chip" style="background:#e9d5ff"><i class="fa-solid fa-screwdriver-wrench"></i>${p}</span>`;
  if(/検査/.test(p)) return `<span class="chip" style="background:#dcfce7"><i class="fa-regular fa-square-check"></i>${p}</span>`;
  return `<span class="chip"><i class="fa-regular fa-square"></i>${p||'—'}</span>`;
};
const statusToBadge = (s)=>{
  s = String(s||"");
  if(/組立中/.test(s)) return `<span class="chip"><i class="fa-solid fa-screwdriver-wrench"></i>${s}</span>`;
  if(/組立済/.test(s)) return `<span class="chip"><i class="fa-regular fa-circle-check"></i>${s}</span>`;
  if(/検査中/.test(s)) return `<span class="chip"><i class="fa-regular fa-clipboard"></i>${s}</span>`;
  if(/検査済/.test(s)) return `<span class="chip"><i class="fa-regular fa-circle-check"></i>${s}</span>`;
  if(/出荷準備/.test(s)) return `<span class="chip"><i class="fa-solid fa-box-open"></i>${s}</span>`;
  if(/出荷済/.test(s)) return `<span class="chip"><i class="fa-solid fa-truck"></i>${s}</span>`;
  return `<span class="chip"><i class="fa-regular fa-clock"></i>${s||"—"}</span>`;
};

// ================== Auth & Role ==================
let CURRENT_USER = null;
const ROLE_MAP = {
  'admin': { pages:['pageDash','pageSales','pagePlan','pageShip','pageFinished','pageInv','pageInvoice','pageAnalytics'], nav:true },
  '営業': { pages:['pageSales','pageDash','pageFinished','pageInv','pageInvoice','pageAnalytics'], nav:true },
  '生産管理': { pages:['pagePlan','pageShip','pageDash','pageFinished','pageInv','pageInvoice','pageAnalytics'], nav:true },
  '生産管理部': { pages:['pagePlan','pageShip','pageDash','pageFinished','pageInv','pageInvoice','pageAnalytics'], nav:true },
  '製造': { pages:['pageDash','pageFinished','pageInv','pageAnalytics'], nav:true },
  '検査': { pages:['pageDash','pageFinished','pageInv','pageAnalytics'], nav:true }
};

function setUser(u){
  CURRENT_USER = u || null;
  $("#userInfo").textContent = u ? `${u.role||''} / ${u.department||''}` : "";
  $("#topBar").classList.toggle("hidden", !u);

  const pages = ["authView","pageDash","pageSales","pagePlan","pageShip","pageFinished","pageInv","pageInvoice","pageAnalytics"];
  pages.forEach(p => $("#"+p)?.classList.add("hidden"));
  ['btnToDash','btnToSales','btnToPlan','btnToShip','btnToFinPage','btnToInvPage','btnToInvoice','btnToAnalytics','ddSetting','weatherWrap','btnAddMember']
    .forEach(id=> $("#"+id)?.classList.add("hidden"));

  if(!u){ $("#authView")?.classList.remove("hidden"); return; }

  // Prefetch data di background segera setelah login (mempercepat render pertama dashboard)
  Promise.allSettled([
    cached("listOrders",{},30000),
    cached("listShip",{},30000),
    cached("listPlans",{},30000),
    cached("listFinished",{},30000),
    cached("listInventory",{},30000)
  ]).catch(()=>{});

  const allow = ROLE_MAP[u.role] || ROLE_MAP[u.department] || ROLE_MAP['admin'];
  if(allow?.nav){
    if(allow.pages.includes('pageDash')) $("#btnToDash").classList.remove("hidden");
    if(allow.pages.includes('pageSales')) $("#btnToSales").classList.remove("hidden");
    if(allow.pages.includes('pagePlan')) $("#btnToPlan").classList.remove("hidden");
    if(allow.pages.includes('pageShip')) $("#btnToShip").classList.remove("hidden");
    if(allow.pages.includes('pageFinished')) $("#btnToFinPage").classList.remove("hidden");
    if(allow.pages.includes('pageInv')) $("#btnToInvPage").classList.remove("hidden");
    if(allow.pages.includes('pageInvoice')) $("#btnToInvoice").classList.remove("hidden");
    if(allow.pages.includes('pageAnalytics')) $("#btnToAnalytics").classList.remove("hidden");
    $("#ddSetting").classList.remove("hidden");
    $("#weatherWrap").classList.remove("hidden");
    ensureWeather();
    loadMasters();
  }
  if(u.role === 'admin'){ $("#btnAddMember").classList.remove("hidden"); }

  show("pageDash");
  refreshAll();
}

// ================== Nav ==================
function show(id){
  ["authView","pageDash","pageSales","pagePlan","pageShip","pageFinished","pageInv","pageInvoice","pageAnalytics"]
    .forEach(p=> $("#"+p)?.classList.add("hidden"));
  $("#"+id)?.classList.remove("hidden");
}
$("#btnToDash").onclick = ()=>{ show("pageDash"); refreshAll(); };
$("#btnToSales").onclick = ()=>{ show("pageSales"); loadSales(); };
$("#btnToPlan").onclick = ()=>{ show("pagePlan"); loadPlans(); };
$("#btnToShip").onclick = ()=>{ show("pageShip"); loadShips(); };
$("#btnToFinPage").onclick = ()=>{ show("pageFinished"); loadFinished(); };
$("#btnToInvPage").onclick = ()=>{ show("pageInv"); loadInventory(); };
$("#btnToInvoice").onclick = ()=>{ show("pageInvoice"); initInvoicePage(); };
$("#btnToAnalytics").onclick = ()=>{ show("pageAnalytics"); initCharts(); };
$("#btnLogout").onclick = ()=> setUser(null);

// ================== Login (dipercepat) ==================
$("#btnLogin").onclick = loginSubmit;
$("#inUser")?.addEventListener("keydown", e=>{ if(e.key==='Enter') loginSubmit(); });
$("#inPass")?.addEventListener("keydown", e=>{ if(e.key==='Enter') loginSubmit(); });

async function loginSubmit(){
  const u = $("#inUser").value.trim();
  const p = $("#inPass").value.trim();
  if(!u || !p) return alert("ユーザー名 / パスワード を入力してください");
  try{
    // ping & login paralel untuk percepat respons
    await Promise.allSettled([jsonp('ping')]);
    const me = await jsonp("login", { username:u, password:p });
    setUser(me);
    // simpan hint username
    localStorage.setItem("last_user", u);
  }catch(e){
    alert("ログイン失敗: " + (e?.message || e));
  }
}

// Prefill username kalau pernah login
document.addEventListener("DOMContentLoaded", ()=>{
  const last = localStorage.getItem("last_user"); if(last) $("#inUser").value = last;
});

// ================== Dashboard (Orders mini) ==================
let ORDERS = [];
async function loadOrders(){
  ORDERS = await cached("listOrders");
  renderOrders();
  loadShipsMini();
}
function renderOrders(){
  const q = ($("#searchQ")?.value||"").trim().toLowerCase();
  const rows = ORDERS.filter(r => !q || JSON.stringify(r).toLowerCase().includes(q));
  const tb = $("#tbOrders");
  if(!tb) return;
  tb.innerHTML = "";
  const chunk = 120; let i = 0;
  (function paint(){
    const end = Math.min(i+chunk, rows.length);
    const frag = document.createDocumentFragment();
    for(; i<end; i++){
      const r = rows[i];
      const tr = document.createElement("tr");
      const ok = (r.ok_count ?? 0);
      const ng = (r.ng_count ?? 0);
      tr.innerHTML = `
        <td>
          <div class="s muted">注番</div>
          <div><b>${r.po_id||""}</b></div>
          <div class="muted s">${r["得意先"]||"—"}</div>
        </td>
        <td>${r["品名"]||"—"}</td>
        <td>${r["品番"]||"—"}</td>
        <td>${r["図番"]||"—"}</td>
        <td class="center"><div>${statusToBadge(r.status)}</div></td>
        <td class="center">
          <div class="cell-stack">
            ${procToChip(r.current_process)}
            <div class="row">
              <span class="chip" style="background:#e2fbe2">OK:${ok}</span>
              <span class="chip" style="background:#ffe4e6">NG:${ng}</span>
            </div>
          </div>
        </td>
        <td class="center">${fmt(r.updated_at)}</td>
        <td class="center">${r.updated_by||"—"}</td>
        <td class="center">
          <div class="row">
            <button class="btn icon ghost btn-stqr" title="工程QR"><i class="fa-solid fa-qrcode"></i><span>工程QR</span></button>
            <button class="btn icon ghost btn-scan" data-po="${r.po_id}" title="スキャン"><i class="fa-solid fa-camera"></i><span>スキャン</span></button>
            <button class="btn icon ghost btn-op" data-po="${r.po_id}" title="手入力"><i class="fa-solid fa-keyboard"></i><span>手入力</span></button>
          </div>
        </td>`;
      frag.appendChild(tr);
    }
    tb.appendChild(frag);
    if(i < rows.length) requestIdleCallback(paint);

    if(i>=rows.length){
      $$(".btn-stqr",tb).forEach(b=> b.onclick = openStationQrSheet);
      $$(".btn-scan",tb).forEach(b=> b.onclick=(e)=> openScanDialog(e.currentTarget.dataset.po));
      $$(".btn-op",tb).forEach(b=> b.onclick=(e)=> openOpDialog(e.currentTarget.dataset.po));
    }
  })();
}
$("#searchQ")?.addEventListener("input", debounce(renderOrders, 250));
async function refreshAll(){ await loadOrders(); }
$("#btnExportOrders")?.addEventListener('click', ()=> exportTableCSV("#tbOrders","orders.csv"));

// ================== 手入力（工程） ==================
const PROCESS_OPTIONS = [ "準備","レザー加工","曲げ加工","外注加工/組立","組立","検査工程","検査中","検査済","出荷（組立済）","出荷準備","出荷済" ];
function openOpDialog(po, defaults = {}){
  $("#opPO").textContent = po;
  const sel = $("#opProcess");
  sel.innerHTML = PROCESS_OPTIONS.map(o=>`<option value="${o}">${o}</option>`).join('');
  $("#opProcess").value = defaults.process || PROCESS_OPTIONS[0];
  $("#opOK").value = (defaults.ok_count ?? defaults.ok ?? "") === 0 ? 0 : (defaults.ok_count ?? defaults.ok ?? "");
  $("#opNG").value = (defaults.ng_count ?? defaults.ng ?? "") === 0 ? 0 : (defaults.ng_count ?? defaults.ng ?? "");
  $("#opNote").value = defaults.note || "";
  $("#dlgOp").showModal();
  $("#btnOpSave").onclick = async ()=>{
    const okStr = $("#opOK").value, ngStr = $("#opNG").value, proc = $("#opProcess").value;
    if(!proc) return alert("工程を選択してください");
    if(okStr === "") return alert("OK 数を入力してください（0 以上）");
    if(ngStr === "") return alert("NG 数を入力してください（0 以上）");
    const ok = Number(okStr), ng = Number(ngStr);
    if(Number.isNaN(ok) || ok < 0) return alert("OK 数は 0 以上の数値で入力してください");
    if(Number.isNaN(ng) || ng < 0) return alert("NG 数は 0 以上の数値で入力してください");
    try{
      await jsonp("saveOp", { data: JSON.stringify({ po_id: po, process: proc, ok_count: ok, ng_count: ng, note: $("#opNote").value }), user: JSON.stringify(CURRENT_USER||{}) });
      $("#dlgOp").close();
      if($("#dlgScan").open){ stopScan(); $("#dlgScan").close(); }
      await refreshAll();
    }catch(e){ alert("保存失敗: " + e.message); }
  };
}
$("#btnOpCancel")?.addEventListener('click', ()=> $("#dlgOp").close());

// ================== Masters ==================
let MASTERS = { customers:[], drawings:[], item_names:[], part_nos:[], destinations:[], carriers:[], po_ids:[] };
async function loadMasters(){ try{ MASTERS = await cached("listMasters", {}, 60000); }catch{} }

// ================== SALES ==================
const SALES_FIELDS = [
  {name:'po_id', label:'注番', req:true},
  {name:'得意先', label:'得意先', type:'select', options:()=>MASTERS.customers, free:true},
  {name:'図番', label:'図番', type:'select', options:()=>MASTERS.drawings, free:true},
  {name:'品名', label:'品名', type:'select', options:()=>MASTERS.item_names,free:true},
  {name:'品番', label:'品番', type:'select', options:()=>MASTERS.part_nos, free:true},
  {name:'受注日', label:'受注日', type:'date'},
  {name:'製造番号', label:'製造番号'},
  {name:'qty', label:'数量'},
  {name:'納期', label:'納期', type:'date'},
  {name:'備考', label:'備考'}
];
const SALES_VIEW = [
  {label:'受注日', keys:['受注日']},
  {label:'得意先', keys:['得意先','customer']},
  {label:'品名', keys:['品名','item_name']},
  {label:'品番', keys:['品番','part_no','item_code']},
  {label:'図番', keys:['図番','drawing_no']},
  {label:'製番号', keys:['製番号','製造番号']},
  {label:'数量', keys:['数量','qty']},
  {label:'希望納期', keys:['希望納期','納期','due']},
  {label:'備考', keys:['備考','note']}
];
async function loadSales(){ const dat = await cached("listSales"); renderSalesSlim(dat); }
function renderSalesSlim(dat){
  const th = $("#thSales"), tb = $("#tbSales"), search = $("#salesSearch");
  const header = dat.header || [];
  const idx = Object.fromEntries(header.map((h,i)=>[String(h).trim(), i]));
  const keyPO = (idx['po_id']!=null ? 'po_id' : (idx['注番']!=null ? '注番' : header[0]));
  const pick = (row, keys)=> { for(const k of keys){ const i = idx[k]; if(i!=null && row[i]!=null && row[i]!=='') return row[i]; } return ''; };
  th.innerHTML = `<tr>${SALES_VIEW.map(c=>`<th>${c.label}</th>`).join('')}<th>操作</th></tr>`;
  const render = ()=>{
    const q = (search?.value||'').toLowerCase();
    tb.innerHTML = '';
    const rows = dat.rows.filter(r => !q || JSON.stringify(r).toLowerCase().includes(q));
    let i=0; const chunk=150;
    (function paint(){
      const end=Math.min(i+chunk, rows.length);
      const frag=document.createDocumentFragment();
      for(;i<end;i++){
        const r = rows[i]; const po = String(r[idx[keyPO]]||'');
        const tds = SALES_VIEW.map(col=>{
          let v = pick(r, col.keys);
          if(v && (col.label==='受注日' || col.label==='希望納期')){
            const d = (v instanceof Date) ? v : new Date(v); if(!isNaN(d)) v = d.toLocaleDateString('ja-JP');
          }
          return `<td>${v ?? ''}</td>`;
        }).join('');
        const tr=document.createElement('tr');
        tr.innerHTML = `${tds}<td class="center"><div class="row">
            <button class="btn ghost btn-edit" data-po="${po}"><i class="fa-regular fa-pen-to-square"></i> 編集</button>
            <button class="btn ghost btn-del" data-po="${po}"><i class="fa-regular fa-trash-can"></i> 削除</button>
          </div></td>`;
        frag.appendChild(tr);
      }
      tb.appendChild(frag);
      if(i<rows.length) requestIdleCallback(paint);
      if(i>=rows.length){
        $$(".btn-edit", tb).forEach(b=> b.onclick = (e)=> editSales(e.currentTarget.dataset.po, dat));
        $$(".btn-del", tb).forEach(b=> b.onclick = (e)=> deleteSales(e.currentTarget.dataset.po));
      }
    })();
  };
  if(search && !search._bind){ search._bind = true; search.oninput = debounce(render, 250); }
  render();
}
function rowToObject(dat, po_id){
  const header = dat.header || [];
  const idx = Object.fromEntries(header.map((h,i)=>[String(h).trim(), i]));
  const keyPO = (idx['po_id']!=null ? 'po_id' : (idx['注番']!=null ? '注番' : header[0]));
  const row = (dat.rows||[]).find(r => String(r[idx[keyPO]])===String(po_id));
  if(!row) return null;
  const obj = {}; header.forEach((h,i)=> obj[String(h).trim()] = row[i]); obj.po_id = obj.po_id || obj['注番'] || po_id; return obj;
}
function editSales(po_id, dat){
  const obj = rowToObject(dat, po_id); if(!obj) return alert('データが見つかりません');
  const initial = {
    po_id: obj.po_id, '得意先': obj['得意先'] || obj.customer || '', '図番': obj['図番'] || obj.drawing_no || '',
    '品名': obj['品名'] || obj.item_name || '', '品番': obj['品番'] || obj.part_no || obj.item_code || '',
    '受注日': obj['受注日'] || '', '製造番号': obj['製造番号'] || obj['製番号'] || '',
    'qty': obj['数量'] || obj.qty || '', '納期': obj['希望納期'] || obj['納期'] || obj.due || '', '備考': obj['備考'] || obj.note || ''
  };
  openForm("受注 編集", SALES_FIELDS, "saveSales", async ()=>{ await loadSales(); }, initial);
}
async function deleteSales(po_id){
  if(!confirm(`注番 ${po_id} を削除しますか？`)) return;
  try{ await jsonp('deleteSales', { po_id }); await loadSales(); }catch(e){ alert('削除失敗: ' + (e?.message || e)); }
}
$("#btnSalesCreate")?.addEventListener('click', ()=> openForm("受注作成", SALES_FIELDS, "saveSales"));
$("#btnSalesExport")?.addEventListener('click', ()=> exportTableCSV("#tbSales","sales.csv"));
$("#btnSalesImport")?.addEventListener('click', ()=> importCSVtoSheet("bulkImportSales", ()=> loadSales()));
$("#btnSalesPrint")?.addEventListener('click', ()=> window.print());
$("#btnSalesTpl")?.addEventListener('click', ()=>{
  const headers = ['po_id','得意先','図番','品名','品番','受注日','製造番号','qty','納期','備考'];
  const csv = headers.map(h=>`${h}`).join(',') + '\n';
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'}); const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'sales_template.csv'; a.click();
});

// ================== PLAN ==================
const PLAN_FIELDS = [
  {name:'po_id', label:'注番', type:'select', options:()=>MASTERS.po_ids, free:true, req:true},
  {name:'得意先', label:'得意先', type:'select', options:()=>MASTERS.customers, free:true},
  {name:'図番', label:'図番', type:'select', options:()=>MASTERS.drawings, free:true},
  {name:'品名', label:'品名', type:'select', options:()=>MASTERS.item_names,free:true},
  {name:'品番', label:'品番', type:'select', options:()=>MASTERS.part_nos, free:true},
  {name:'製造番号', label:'製造番号'},
  {name:'qty', label:'数量'},
  {name:'due_date', label:'納期希望', type:'date'},
  {name:'start_date', label:'開始希望', type:'date'},
  {name:'note', label:'備考'}
];
const PLAN_VIEW = [
  {label:'注番', keys:['po_id','注番']},
  {label:'得意先', keys:['得意先','customer']},
  {label:'品番', keys:['品番','part_no']},
  {label:'製造番号', keys:['製造番号','製番号']},
  {label:'品名', keys:['品名','item_name']},
  {label:'図番', keys:['図番','drawing_no']},
  {label:'数量', keys:['qty','数量']},
  {label:'納期希望', keys:['納期希望','due_date','完了予定','due']},
  {label:'開始希望', keys:['開始希望','start_date','開始日']},
  {label:'備考', keys:['備考','note']}
];
function rowToObjectPlan(dat, po_id){
  const header = dat.header || []; const idx = Object.fromEntries(header.map((h,i)=>[String(h).trim(), i]));
  const keyPO = (idx['po_id']!=null ? 'po_id' : (idx['注番']!=null ? '注番' : header[0]));
  const row = (dat.rows||[]).find(r => String(r[idx[keyPO]])===String(po_id)); if(!row) return null;
  const obj = {}; header.forEach((h,i)=> obj[String(h).trim()] = row[i]); obj.po_id = obj.po_id || obj['注番'] || po_id; return obj;
}
function renderPlansSlim(dat){
  const th = $("#thPlan"), tb = $("#tbPlan"), search = $("#planSearch");
  const header = dat.header || []; const idx = Object.fromEntries(header.map((h,i)=>[String(h).trim(), i]));
  const pick = (row, keys)=>{ for(const k of keys){ const i=idx[k]; if(i!=null && row[i]!=null && row[i]!=='') return row[i]; } return ''; };
  th.innerHTML = `<tr>${PLAN_VIEW.map(c=>`<th>${c.label}</th>`).join('')}<th>操作</th></tr>`;
  const render = ()=>{
    const q = (search?.value||'').toLowerCase(); tb.innerHTML = '';
    const rows = dat.rows.filter(r => !q || JSON.stringify(r).toLowerCase().includes(q));
    let i=0; const chunk=150;
    (function paint(){
      const end=Math.min(i+chunk, rows.length); const frag=document.createDocumentFragment();
      for(;i<end;i++){
        const r = rows[i]; const po = String(pick(r, ['po_id','注番'])||'');
        const tds = PLAN_VIEW.map(col=>{
          let v = pick(r, col.keys);
          if(v && /希望/.test(col.label)){ const d=(v instanceof Date)?v:new Date(v); if(!isNaN(d)) v = d.toLocaleDateString('ja-JP'); }
          return `<td>${v ?? ''}</td>`;
        }).join('');
        const tr=document.createElement('tr');
        tr.innerHTML = `${tds}<td class="center"><div class="row"><button class="btn ghost btn-edit-plan" data-po="${po}"><i class="fa-regular fa-pen-to-square"></i> 編集</button></div></td>`;
        frag.appendChild(tr);
      }
      tb.appendChild(frag);
      if(i<rows.length) requestIdleCallback(paint);
      if(i>=rows.length){ $$(".btn-edit-plan", tb).forEach(b=> b.onclick = (e)=> editPlan(e.currentTarget.dataset.po, dat)); }
    })();
  };
  if(search && !search._bind){ search._bind = true; search.oninput = debounce(render, 250); }
  render();
}
function editPlan(po_id, dat){
  const obj = rowToObjectPlan(dat, po_id); if(!obj) return alert('データが見つかりません');
  const initial = {
    po_id: obj.po_id || obj['注番'] || '',
    '得意先': obj['得意先'] || obj.customer || '',
    '図番': obj['図番'] || obj.drawing_no || '',
    '品名': obj['品名'] || obj.item_name || '',
    '品番': obj['品番'] || obj.part_no || '',
    '製造番号': obj['製造番号'] || obj['製番号'] || '',
    'qty': obj['数量'] || obj['qty'] || '',
    'due_date': obj['納期希望'] || obj['完了予定'] || obj['due_date'] || obj['due'] || '',
    'start_date': obj['開始希望'] || obj['開始日'] || obj['start_date'] || '',
    'note': obj['備考'] || obj['note'] || ''
  };
  openForm("生産計画 編集", PLAN_FIELDS, "savePlan", async ()=>{ await loadPlans(); await loadOrders(); }, initial);
}
async function loadPlans(){ const dat = await cached("listPlans"); renderPlansSlim(dat); }
$("#btnPlanCreate")?.addEventListener('click', ()=> openForm("生産計画 作成", PLAN_FIELDS, "savePlan", ()=> { loadPlans(); loadOrders(); }));
$("#btnPlanExport")?.addEventListener('click', ()=> exportTableCSV("#tbPlan","plans.csv"));
$("#btnPlanImport")?.addEventListener('click', ()=> importCSVtoSheet("bulkImportPlans", ()=> { loadPlans(); loadOrders(); }));
$("#btnPlanPrint")?.addEventListener('click', ()=> window.print());
$("#btnPlanTpl")?.addEventListener('click', ()=>{
  const headers = ['注番','得意先','品番','製造番号','品名','図番','数量','納期希望','開始希望','備考'];
  const csv = headers.map(h=>`${h}`).join(',') + '\n';
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'}); const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'production_plans_template.csv'; a.click();
});

// ================== SHIP ==================
const SHIP_FIELDS = [
  {name:'po_id', label:'注番', type:'select', options:()=>MASTERS.po_ids, free:true, req:true},
  {name:'得意先', label:'得意先', type:'select', options:()=>MASTERS.customers, free:true},
  {name:'図番', label:'図番', type:'select', options:()=>MASTERS.drawings, free:true},
  {name:'品名', label:'品名', type:'select', options:()=>MASTERS.item_names, free:true},
  {name:'品番', label:'品番', type:'select', options:()=>MASTERS.part_nos, free:true},
  {name:'製造番号', label:'製造番号'},
  {name:'qty', label:'数量'},
  {name:'destination', label:'送り先', type:'select', options:()=>MASTERS.destinations, free:true},
  {name:'scheduled_date', label:'出荷日', type:'date'},
  {name:'delivery_date', label:'納入日', type:'date'},
  {name:'carrier', label:'運送会社', type:'select', options:()=>MASTERS.carriers, free:true},
  {name:'note', label:'備考'}
];
const SHIP_VIEW = [
  {label:'注番', keys:['po_id','注番']},
  {label:'得意先', keys:['得意先','customer']},
  {label:'品名', keys:['品名','item_name']},
  {label:'品番', keys:['品番','part_no']},
  {label:'図番', keys:['図番','drawing_no']},
  {label:'製番号', keys:['製造番号','製番号']},
  {label:'数量', keys:['qty','数量']},
  {label:'送り先', keys:['destination','送り先']},
  {label:'出荷日', keys:['scheduled_date','出荷日']},
  {label:'納入日', keys:['delivery_date','納入日']},
  {label:'運送会社', keys:['carrier','運送会社']},
  {label:'備考', keys:['note','備考']}
];
const SHIP_UI = { selectedCustomer:'', selectedDate:'', groupByDate:true };

async function loadShips(){
  const dat = await cached("listShip");
  ensureShipControls(dat);
  renderShipSlim(dat);
}
function ensureShipControls(dat){
  if($("#shipCtrlBar")) return;
  const tableWrap = $("#thShip")?.closest("div") || $("#pageShip");
  const bar = document.createElement("div");
  bar.id = "shipCtrlBar"; bar.className = "row wrap"; bar.style.margin = "8px 0 12px";
  const selCust = document.createElement("select");
  selCust.id = "shipCustSel";
  selCust.innerHTML = `<option value="">(すべての得意先)</option>` + (MASTERS.customers||[]).map(c=>`<option value="${c}">${c}</option>`).join('');
  const inDate = document.createElement("input"); inDate.type = "date"; inDate.id = "shipDateSel";
  const ckWrap = document.createElement("label"); ckWrap.style.display="inline-flex"; ckWrap.style.alignItems="center"; ckWrap.style.gap="6px";
  ckWrap.innerHTML = `<input id="shipGroupChk" type="checkbox" checked> 日付でグループ化`;
  const btnPrintCust = document.createElement("button"); btnPrintCust.className = "btn ghost"; btnPrintCust.textContent = "得意先で印刷";
  const btnPrintCustDate = document.createElement("button"); btnPrintCustDate.className = "btn ghost"; btnPrintCustDate.textContent = "得意先＋日付で印刷";
  function makeLabel(txt, el){ const w=document.createElement("div"); w.className="row s"; w.innerHTML=`<div class="muted s" style="min-width:60px">${txt}</div>`; w.append(el); return w; }
  bar.append(makeLabel("得意先", selCust), makeLabel("日付", inDate), ckWrap, btnPrintCust, btnPrintCustDate);
  tableWrap.parentNode.insertBefore(bar, tableWrap);
  selCust.onchange = ()=>{ SHIP_UI.selectedCustomer = selCust.value; renderShipSlim(dat); };
  inDate.onchange = ()=>{ SHIP_UI.selectedDate = inDate.value; renderShipSlim(dat); };
  $("#shipGroupChk").onchange = (e)=>{ SHIP_UI.groupByDate = e.target.checked; renderShipSlim(dat); };
  btnPrintCust.onclick = async ()=>{ if(!SHIP_UI.selectedCustomer){ alert("得意先を選択してください"); return; } await printShipByCustomer(SHIP_UI.selectedCustomer); };
  btnPrintCustDate.onclick = async ()=>{ if(!SHIP_UI.selectedCustomer || !SHIP_UI.selectedDate){ alert("得意先と日付を選択してください"); return; } await printShipByCustomer(SHIP_UI.selectedCustomer, SHIP_UI.selectedDate); };
}
function renderShipSlim(dat){
  const th = $("#thShip"), tb = $("#tbShip"), search = $("#shipSearch");
  const header = dat.header || [];
  const idx = Object.fromEntries(header.map((h,i)=>[String(h).trim(), i]));
  const keySID = (idx['ship_id']!=null ? 'ship_id' : null);
  const keyPO = (idx['po_id']!=null ? 'po_id' : (idx['注番']!=null ? '注番' : header[0]));
  const pick = (row, keys)=>{ for(const k of keys){ const i=idx[k]; if(i!=null && row[i]!=null && row[i]!=='') return row[i]; } return ''; };
  const dstr = (v)=>{ const d=(v instanceof Date)?v:new Date(v); return isNaN(d)?'':new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10); };
  th.innerHTML = `<tr>${SHIP_VIEW.map(c=>`<th>${c.label}</th>`).join('')}<th>操作</th></tr>`;
  const q = (search?.value||'').toLowerCase(); let rows = dat.rows.filter(r => !q || JSON.stringify(r).toLowerCase().includes(q));
  if(SHIP_UI.selectedCustomer){ rows = rows.filter(r => String(r[idx['得意先']]||r[idx['customer']]||'') === SHIP_UI.selectedCustomer); }
  if(SHIP_UI.selectedDate){ rows = rows.filter(r => { const d = r[idx['scheduled_date']] ?? r[idx['出荷日']]; return d && dstr(d) === SHIP_UI.selectedDate; }); }
  tb.innerHTML = '';
  const renderRow = (r)=>{
    const shipId = keySID? r[idx[keySID]] : ''; const po = String(r[idx[keyPO]]||'');
    const tds = SHIP_VIEW.map(col=>{
      let v = pick(r, col.keys); if(v && /出荷日|納入日/.test(col.label)){ const d=(v instanceof Date)?v:new Date(v); if(!isNaN(d)) v = d.toLocaleDateString('ja-JP'); }
      return `<td>${v ?? ''}</td>`;
    }).join('');
    const tr=document.createElement('tr');
    tr.innerHTML = `${tds}<td class="center"><div class="row">
      <button class="btn ghost btn-edit-ship" data-po="${po}" data-sid="${shipId}"><i class="fa-regular fa-pen-to-square"></i> 編集</button>
      <button class="btn ghost btn-del-ship" data-po="${po}" data-sid="${shipId}"><i class="fa-regular fa-trash-can"></i> 削除</button>
    </div></td>`;
    return tr;
  };
  if(SHIP_UI.groupByDate){
    const groups = {}; const keyDate = (r)=> dstr(r[idx['scheduled_date']] ?? r[idx['出荷日']] ?? '');
    rows.forEach(r=>{ const k = keyDate(r) || '(日付未設定)'; (groups[k]??=[]).push(r); });
    Object.keys(groups).sort().forEach(dateKey=>{
      const arr = groups[dateKey]; const total = arr.reduce((s,r)=> s + Number(r[idx['qty']]||r[idx['数量']]||0), 0);
      const trH = document.createElement('tr');
      trH.innerHTML = `<td colspan="${SHIP_VIEW.length+1}" style="background:#f6f7fb;font-weight:600">${dateKey}（合計: ${total}）</td>`;
      tb.appendChild(trH);
      const frag = document.createDocumentFragment(); arr.forEach(r=> frag.appendChild(renderRow(r))); tb.appendChild(frag);
    });
  }else{
    const frag = document.createDocumentFragment(); rows.forEach(r=> frag.appendChild(renderRow(r))); tb.appendChild(frag);
  }
  $$(".btn-edit-ship", tb).forEach(b=> b.onclick = (e)=> editShip(e.currentTarget.dataset.po, e.currentTarget.dataset.sid, dat));
  $$(".btn-del-ship", tb).forEach(b=> b.onclick = (e)=> deleteShip(e.currentTarget.dataset.po, e.currentTarget.dataset.sid));
  if(search && !search._bind){ search._bind = true; search.oninput = debounce(()=> renderShipSlim(dat), 250); }
}
function editShip(po_id, ship_id, dat){
  const header = dat.header||[]; const idx = Object.fromEntries(header.map((h,i)=>[String(h).trim(), i]));
  const keyPO = (idx['po_id']!=null) ? 'po_id' : (idx['注番']!=null ? '注番' : null);
  const row = (dat.rows||[]).find(r => (ship_id && idx['ship_id']!=null && String(r[idx['ship_id']]) === String(ship_id)) || (keyPO && String(r[idx[keyPO]]) === String(po_id)) );
  if(!row) return alert('データが見つかりません');
  const initial = {
    ship_id: row[idx['ship_id']]||'', po_id: row[idx['po_id']]||row[idx['注番']]||'',
    '得意先': row[idx['得意先']]||row[idx['customer']]||'', '図番': row[idx['図番']]||row[idx['drawing_no']]||'',
    '品名': row[idx['品名']]||row[idx['item_name']]||'', '品番': row[idx['品番']]||row[idx['part_no']]||'',
    '製造番号': row[idx['製造番号']]||row[idx['製番号']]||'', 'qty': row[idx['qty']]||row[idx['数量']]||'',
    'destination': row[idx['destination']]||row[idx['送り先']]||'', 'scheduled_date': row[idx['scheduled_date']]||row[idx['出荷日']]||'',
    'delivery_date': row[idx['delivery_date']]||row[idx['納入日']]||'', 'carrier': row[idx['carrier']]||row[idx['運送会社']]||'', 'note': row[idx['note']]||row[idx['備考']]||''
  };
  openForm("出荷予定 編集", SHIP_FIELDS, "saveShip", async ()=>{ await loadShips(); }, initial, { extraHidden: { ship_id: initial.ship_id } } );
}
async function deleteShip(po_id, ship_id){
  if(!confirm(`出荷予定を削除しますか？\n注番:${po_id}${ship_id? ' / ID:'+ship_id:''}`)) return;
  try{ await jsonp('deleteShip', { po_id, ship_id }); await loadShips(); }catch(e){ alert('削除失敗: ' + (e?.message || e)); }
}
$("#btnShipCreate")?.addEventListener('click', ()=> openForm("出荷予定 作成", SHIP_FIELDS, "saveShip", ()=> { loadShips(); loadShipsMini(); }));
$("#btnShipExport")?.addEventListener('click', ()=> exportTableCSV("#tbShip","shipments.csv"));
$("#btnShipImport")?.addEventListener('click', ()=> importCSVtoSheet("bulkImportShip", ()=> { loadShips(); loadShipsMini(); }));
$("#btnShipPrint")?.addEventListener('click', ()=> window.print());
$("#btnShipTpl")?.addEventListener('click', ()=>{
  const headers = ['po_id','得意先','図番','品名','品番','製造番号','qty','destination','scheduled_date','delivery_date','carrier','note'];
  const csv = headers.map(h=>`${h}`).join(',') + '\n';
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'}); const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'shipments_template.csv'; a.click();
});

// ミニ: dashboard list today + future
async function loadShipsMini(){
  const dat = await cached("listShip", {}, 30000).catch(()=>null);
  if(!dat) return;
  const rows = dat.rows || []; const head = dat.header || []; const idx = Object.fromEntries(head.map((h,i)=>[h,i]));
  const today = new Date(); const ymd = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const isToday = (s)=>{ const t = new Date(s); return t.getFullYear()===ymd.getFullYear() && t.getMonth()===ymd.getMonth() && t.getDate()===ymd.getDate(); };
  const statusCol = idx.status ?? idx['状態']; const dateCol = idx.scheduled_date ?? idx['出荷日'] ?? idx['納期']; const poCol = idx.po_id ?? idx['注番'];
  const todayList = [], futureList = [];
  rows.forEach(r=>{
    const st = String(r[statusCol]||''); const dt = r[dateCol];
    if(!dt || /出荷済/.test(st)) return;
    const entry = { po: r[poCol], date: dt, status: st, dest: r[idx.destination]||'' , qty: r[idx.qty]||'' };
    if(isToday(dt)) todayList.push(entry); else if(new Date(dt) > ymd) futureList.push(entry);
  });
  const renderSide = (arr, el)=>{ if(!el) return; el.innerHTML = arr.slice(0,50).map(e=>`
    <div style="padding:.35rem .5rem;border-bottom:1px dashed #eee">
      <div><b>${e.po||''}</b> <span class="muted s">${e.dest||''}</span></div>
      <div class="row-between s"><span>${new Date(e.date).toLocaleDateString('ja-JP')}</span><span>${e.qty||''}</span></div>
    </div>`).join('') || `<div class="muted s">なし</div>`;
  };
  renderSide(todayList, $("#shipToday"));
  renderSide(futureList, $("#shipPlan"));
}

// ================== FINISHED ==================
const FIN_VIEW = [
  {label:'注番', keys:['po_id','注番']},
  {label:'得意先', keys:['得意先','customer']},
  {label:'品名', keys:['品名','item_name']},
  {label:'品番', keys:['品番','part_no']},
  {label:'図番', keys:['図番','drawing_no']},
  {label:'製番号', keys:['製造番号','製番号']},
  {label:'完了数', keys:['完了数']},
  {label:'状態', keys:['状態','status']},
  {label:'完了日', keys:['completed_at']},
  {label:'更新者', keys:['updated_by']},
];
async function loadFinished(){
  const dat = await cached("listFinished", {}, 5000);
  const th = $("#thFin"), tb = $("#tbFin"), search = $("#finSearch");
  const head = dat.header||[]; const idx = Object.fromEntries(head.map((h,i)=>[String(h).trim(), i]));
  const pick = (row, keys)=>{ for(const k of keys){ const i=idx[k]; if(i!=null && row[i]!=null && row[i]!=='') return row[i]; } return ''; };
  th.innerHTML = `<tr>${FIN_VIEW.map(c=>`<th>${c.label}</th>`).join('')}</tr>`;
  const render = ()=>{
    const q = (search?.value||'').toLowerCase(); tb.innerHTML = '';
    const rows = dat.rows.filter(r => !q || JSON.stringify(r).toLowerCase().includes(q));
    let i=0; const chunk=150;
    (function paint(){
      const end=Math.min(i+chunk, rows.length); const frag=document.createDocumentFragment();
      for(;i<end;i++){
        const r = rows[i];
        const tds = FIN_VIEW.map(col=>{
          let v = pick(r, col.keys);
          if(col.label==='完了日' && v){ const d=(v instanceof Date)?v:new Date(v); if(!isNaN(d)) v = d.toLocaleString('ja-JP'); }
          return `<td>${v??''}</td>`;
        }).join('');
        const tr=document.createElement('tr'); tr.innerHTML = tds; frag.appendChild(tr);
      }
      tb.appendChild(frag);
      if(i<rows.length) requestIdleCallback(paint);
    })();
  };
  if(search && !search._bind){ search._bind = true; search.oninput = debounce(render, 250); }
  render();
}
$("#btnFinExport")?.addEventListener('click', ()=> exportTableCSV("#tbFin","finished_goods.csv"));
$("#btnFinPrint")?.addEventListener('click', ()=> window.print());

// ================== INVENTORY ==================
const INV_UI = { cust:'', item:'' };
async function loadInventory(){
  const dat = await cached("listInventory", {}, 5000)
    .catch(()=>({header:['得意先','図番','機種','品名','在庫数','最終更新'], rows:[]}));
  ensureInvControls(dat); renderInventory(dat);
}
function ensureInvControls(dat){
  if($("#invCtrlBar")) return;
  const wrap = $("#thInv")?.closest(".card") || $("#pageInv");
  const bar = document.createElement("div"); bar.id = "invCtrlBar"; bar.className = "row wrap"; bar.style.margin = "8px 0 12px";
  const h = dat.header||[]; const idx = Object.fromEntries(h.map((x,i)=>[x,i]));
  const colCust = idx['得意先']; const colModel= (idx['機種']!=null ? idx['機種'] : idx['品名']);
  const setOpts = (values)=> [...new Set(values.filter(Boolean))].sort();
  const selCust = document.createElement("select");
  selCust.innerHTML = `<option value="">(すべての得意先)</option>` + setOpts(dat.rows.map(r=> r[colCust]||'')).map(v=>`<option value="${v}">${v}</option>`).join('');
  const selItem = document.createElement("select");
  selItem.innerHTML = `<option value="">(すべての機種/品名)</option>` + setOpts(dat.rows.map(r=> r[colModel]||r[idx['品名']]||'')).map(v=>`<option value="${v}">${v}</option>`).join('');
  function makeLabel(txt, el){ const w=document.createElement("div"); w.className="row s"; w.innerHTML=`<div class="muted s" style="min-width:72px">${txt}</div>`; w.append(el); return w; }
  bar.append(makeLabel("得意先", selCust), makeLabel("機種/品名", selItem)); wrap.insertBefore(bar, wrap.querySelector(".table-wrap"));
  selCust.onchange = ()=>{ INV_UI.cust = selCust.value; renderInventory(dat); };
  selItem.onchange = ()=>{ INV_UI.item = selItem.value; renderInventory(dat); };
}
function renderInventory(dat){
  const th = $("#thInv"), tb = $("#tbInv"), search = $("#invSearch");
  th.innerHTML = `<tr>${dat.header.map(h=>`<th>${h}</th>`).join('')}</tr>`;
  const h = dat.header||[]; const idx = Object.fromEntries(h.map((x,i)=>[x,i]));
  const colCust = idx['得意先']; const colModel= (idx['機種']!=null ? idx['機種'] : idx['品名']);
  const q = (search?.value||'').toLowerCase();
  const rows = dat.rows.filter(r=>{
    if(INV_UI.cust && String(r[colCust]||'') !== INV_UI.cust) return false;
    if(INV_UI.item){ const itemVal = String(r[colModel]||r[idx['品名']]||''); if(itemVal !== INV_UI.item) return false; }
    return !q || JSON.stringify(r).toLowerCase().includes(q);
  });
  tb.innerHTML = ''; let i=0; const chunk=150;
  (function paint(){
    const end=Math.min(i+chunk, rows.length); const frag=document.createDocumentFragment();
    for(;i<end;i++){ const tr=document.createElement('tr'); tr.innerHTML = rows[i].map(c=>`<td>${c??''}</td>`).join(''); frag.appendChild(tr); }
    tb.appendChild(frag);
    if(i<rows.length) requestIdleCallback(paint);
  })();
}
$("#btnInvExport")?.addEventListener('click', ()=> exportTableCSV("#tbInv","inventory.csv"));
$("#btnInvPrint")?.addEventListener('click', ()=> window.print());

// ================== Generic Form dialog ==================
let CURRENT_API = null;
function openForm(title, fields, api, after, initial={}, opts={}){
  CURRENT_API = api; $("#dlgTitle").textContent = title;
  const f = $("#formBody"); f.innerHTML = "";
  const extras = opts?.extraHidden || {};
  Object.entries(extras).forEach(([k,v])=>{ const hid = document.createElement("input"); hid.type="hidden"; hid.name=k; hid.value=v??''; f.appendChild(hid); });
  fields.forEach(x=>{
    const wrap = document.createElement("div"); wrap.className = "form-item";
    const label = `<div class="muted s">${x.label}${x.req? ' <span style="color:#c00">*</span>':''}</div>`;
    let input = ''; let opts = (typeof x.options === 'function') ? x.options() : (x.options||[]); const val = (initial[x.name] ?? '');
    const id = `in_${x.name}_${Math.random().toString(36).slice(2)}`;
    if(x.type==='select' && x.free){
      input = `<input name="${x.name}" list="dl-${id}" placeholder="${x.label}" value="${val??''}"><datalist id="dl-${id}">${opts.map(o=>`<option value="${o}">`).join('')}</datalist>`;
    }else if(x.type==='select'){
      input = `<select name="${x.name}">${opts.map(o=>`<option value="${o}">${o}</option>`).join('')}</select>`;
      setTimeout(()=>{ const sel=f.querySelector(`[name="${x.name}"]`); if(sel) sel.value = String(val??''); },0);
    }else if(x.type==='date'){
      const v = val ? new Date(val) : ''; const iso = (v && !isNaN(v)) ? new Date(v.getTime()-v.getTimezoneOffset()*60000).toISOString().slice(0,10) : '';
      input = `<input name="${x.name}" type="date" value="${iso}">`;
    }else{
      input = `<input name="${x.name}" placeholder="${x.label}" value="${val??''}">`;
    }
    wrap.innerHTML = label + input; f.appendChild(wrap);
  });
  $("#dlgForm").showModal();
  $("#btnDlgSave").onclick = async ()=>{
    const data = {}; [...f.querySelectorAll("[name]")].forEach(inp=>{
      let v = inp.value; if(inp.type==='date' && v) v = new Date(v).toISOString().slice(0,10); data[inp.name] = v;
    });
    try{
      await jsonp(CURRENT_API, { data: JSON.stringify(data), user: JSON.stringify(CURRENT_USER||{}) });
      $("#dlgForm").close(); if(after) await after(); if(api==="savePlan") await loadOrders();
    }catch(e){ alert("保存失敗: " + e.message); }
  };
}
$("#btnDlgCancel")?.addEventListener('click', ()=> $("#dlgForm").close());

// ================== CSV Export / Import ==================
function exportTableCSV(tbodySel, filename){
  const rows = $$(tbodySel+" tr").map(tr=> [...tr.children].map(td=> td.textContent));
  const csv = rows.map(r => r.map(v=>{ const s = (v??'').toString().replace(/"/g,'""'); return `"${s}"`; }).join(',')).join('\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'}); const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
}
function importCSVtoSheet(api, after){
  const input = document.createElement('input'); input.type='file'; input.accept='.csv,.xlsx';
  input.onchange = async ()=>{
    const file = input.files[0]; if(!file) return;
    const buf = await file.arrayBuffer(); const wb = XLSX.read(buf); const ws = wb.Sheets[wb.SheetNames[0]];
    const arr = XLSX.utils.sheet_to_json(ws, {header:1, blankrows:false, defval:''});
    const looksHeader = arr.length && arr[0].some(c=> typeof c==='string' && /[A-Za-zぁ-んァ-ヴ一-龯]/.test(c));
    const rows = looksHeader ? arr.slice(1) : arr;
    await jsonp(api, { rows: JSON.stringify(rows) }); if(after) after();
  };
  input.click();
}

// ================== 工程QR（Station, universal） ==================
const STATION_PROCESSES = [ "レザー加工","曲げ加工","外注加工/組立","組立", "検査工程","検査中","検査済","出荷準備","出荷（組立済）","出荷済" ];
const QR_ACCEPT_PATTERNS = [
  /^STN\|(.+)$/i, /^PROC[:|](.+)$/i, /^工程[:|](.+)$/
];
function qrUrl(payload, size=512){ return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(payload)}`; }
function openStationQrSheet(){
  const tiles = STATION_PROCESSES.map(p=>{
    const payload = `STN|${p}`;
    return `<div class="tile" style="border:1px solid #e5e7eb;border-radius:14px;padding:12px;background:#fff">
      <img src="${qrUrl(payload)}" alt="QR ${p}" loading="eager" style="width:100%;height:auto;border-radius:8px">
      <div class="lbl" style="margin-top:8px"><b>${p}</b></div>
      <div class="s muted">${payload}</div>
    </div>`;
  }).join("");
  const html = `
    <html><head><meta charset="utf-8"><title>工程QR（Station, universal）</title>
    <style>:root{--gap:16px;--tile:236px;--border:#e5e7eb}
    *{box-sizing:border-box}body{font-family:system-ui,Segoe UI,Roboto,Helvetica,Arial;margin:16px;background:#fafafa;color:#111827}
    .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(var(--tile),1fr));gap:var(--gap)}
    @media print{.grid{gap:10px}.tile{page-break-inside:avoid}}
    </style></head><body>
    <div style="position:sticky;top:0;background:#fff;padding:8px 0;margin-bottom:8px;z-index:2">
      <h1 style="font-size:18px;margin:0 0 12px;">工程QR（Station, universal）</h1>
      <button onclick="window.print()">印刷</button>
    </div>
    <div class="grid">${tiles}</div></body></html>`;
  const w = window.open('about:blank'); w.document.write(html); w.document.close();
}
$("#btnStationQR")?.addEventListener("click", openStationQrSheet);

// --- QR Scan ---
let scanStream=null, scanRAF=null;
function parseProcessFromStationQR(text){ for(const rx of QR_ACCEPT_PATTERNS){ const m = text.match(rx); if(m) return normalizeProc(m[1]); } return null; }
function stopScan(){ if(scanRAF) cancelAnimationFrame(scanRAF); if(scanStream) scanStream.getTracks().forEach(t=> t.stop()); scanRAF=null; scanStream=null; }
function openScanDialog(po){
  $("#scanResult").textContent = `PO: ${po}`; $("#dlgScan").showModal();
  $("#btnScanStart").onclick = async ()=>{
    const video = $("#scanVideo"), canvas=$("#scanCanvas");
    try{
      scanStream = await navigator.mediaDevices.getUserMedia({video:{facingMode:"environment"}}); video.srcObject = scanStream; await video.play();
      const ctx = canvas.getContext("2d");
      const tick = async ()=>{
        canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        ctx.drawImage(video, 0,0, canvas.width, canvas.height);
        const img = ctx.getImageData(0,0, canvas.width, canvas.height);
        const code = jsQR(img.data, img.width, img.height);
        if(code){
          stopScan();
          const raw = String(code.data||'').trim();
          const stProc = parseProcessFromStationQR(raw);
          if(stProc){ $("#scanResult").textContent = `工程QR: ${stProc}`; quickQuantityPrompt(po, stProc); return; }
          const parts = raw.split('|');
          if(parts.length>=2){
            const cPO = (parts[0]||'').trim(); const proc = normalizeProc(parts[1]||'');
            const okv = Number(parts[2]||''); const ngv = Number(parts[3]||''); const note = parts[4]||''; const po_id = cPO || po;
            if(Number.isFinite(okv) || Number.isFinite(ngv)){
              try{
                await jsonp("saveOp", { data: JSON.stringify({ po_id, process: proc, ok_count: (Number.isFinite(okv)?okv:0), ng_count: (Number.isFinite(ngv)?ngv:0), note }), user: JSON.stringify(CURRENT_USER||{}) });
                $("#scanResult").textContent = `保存: ${po_id} / ${proc} / OK=${okv||0} / NG=${ngv||0}`; setTimeout(()=>{ $("#dlgScan").close(); refreshAll(); }, 700);
              }catch(e){ alert("保存失敗: " + e.message); }
              return;
            }
            quickQuantityPrompt(po_id, proc, note); return;
          }
          alert("未対応のQR形式です。'STN|工程' または 'PO|工程|OK|NG|備考' を使用してください。"); return;
        }
        scanRAF = requestAnimationFrame(tick);
      }; tick();
    }catch(e){ alert("Camera error: "+e.message); }
  };
}
$("#btnScanClose")?.addEventListener('click', ()=>{ stopScan(); $("#dlgScan").close(); });
function quickQuantityPrompt(po, process, note=''){
  const html = `<dialog id="dlgQuick" class="dlg">
    <h3>${po} / ${process}</h3>
    <div class="row"><label>OK <input id="qOK" type="number" min="0" value="0" style="width:120px"></label>
    <label>NG <input id="qNG" type="number" min="0" value="0" style="width:120px"></label></div>
    <div class="row" style="margin-top:8px">
      <button class="btn primary" id="qSave">保存</button>
      <button class="btn" id="qCancel">キャンセル</button>
    </div></dialog>`;
  const wrap = document.createElement("div"); wrap.innerHTML = html; document.body.appendChild(wrap);
  const dlg = wrap.querySelector("#dlgQuick"); dlg.showModal();
  wrap.querySelector("#qCancel").onclick = ()=>{ dlg.close(); wrap.remove(); };
  wrap.querySelector("#qSave").onclick = async ()=>{ const ok = Number(wrap.querySelector("#qOK").value||0); const ng = Number(wrap.querySelector("#qNG").value||0);
    try{ await jsonp("saveOp", { data: JSON.stringify({ po_id: po, process, ok_count: ok, ng_count: ng, note }), user: JSON.stringify(CURRENT_USER||{}) });
      dlg.close(); wrap.remove(); refreshAll(); }catch(e){ alert("保存失敗: " + e.message); } };
}

// ================== Weather (Open-Meteo) ==================
async function ensureWeather(){
  try{
    const cacheKey = 'wx_cache_v1'; const cachedWX = JSON.parse(localStorage.getItem(cacheKey)||'null'); const now = Date.now();
    if(cachedWX && (now - cachedWX.t) < 30*60*1000){ renderWeather(cachedWX.v); return; }
    let lat=35.6762, lon=139.6503;
    if(navigator.geolocation){
      await new Promise(res=> navigator.geolocation.getCurrentPosition(
        pos=>{ lat=pos.coords.latitude; lon=pos.coords.longitude; res(); },
        ()=> res(), {maximumAge: 600000, timeout: 2000}
      ));
    }
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,wind_speed_10m&hourly=temperature_2m&timezone=auto`;
    const v = await fetch(url).then(r=>r.json());
    localStorage.setItem(cacheKey, JSON.stringify({v,t:now})); renderWeather(v);
  }catch(_){ /* ignore */ }
}
function renderWeather(v){
  if(!v?.current) return;
  $("#wxTemp").textContent = Math.round(v.current.temperature_2m) + "°C";
  $("#wxWind").textContent = Math.round(v.current.wind_speed_10m) + " m/s";
  $("#wxPlace").textContent = v.timezone_abbreviation || "";
}

// ================== ANALYTICS (Chart.js, sumber: listShip) ==================
let dailyChart, monthlyChart, custChart, custMonChart;
const stateChart = {
  range:'ytd', metric:'qty', labels:true,
  custType:'barH', custTop:10,
  custMonTop:6, custMonOrient:'v', custMonMode:'month', custMonType:'stacked',
  custMonPick:null, dailyOrient:'v', monthlyOrient:'v'
};
function metricLabel(){ return stateChart.metric==='count' ? '件数' : '数量'; }
function metricValue(row, idx){ return stateChart.metric==='count' ? 1 : (+String(row[idx.qty]||row[idx['数量']]||0) || 0); }
function normalizeCustomerName(name){ const s=String(name||''); if(s.includes('マザック')) return 'マザック'; if(s.includes('オークマ')) return 'オークマ'; return s; }
function parseJPDate(s){ const d=new Date(s); return isNaN(d)?null:d; }
function fmtDate(d){ const z=n=>String(n).padStart(2,'0'); return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}`; }
function fmtMonth(d){ const z=n=>String(n).padStart(2,'0'); return `${d.getFullYear()}-${z(d.getMonth()+1)}`; }
function fmtYear(d){ return String(d.getFullYear()); }

async function initCharts(){
  const dat = await cached("listShip", {}, 10000).catch(()=>null);
  if(!dat){ alert("出荷データがありません"); return; }
  const header = dat.header||[]; const idx = Object.fromEntries(header.map((h,i)=>[String(h).trim(), i]));
  const col = { date: idx['scheduled_date'] ?? idx['出荷日'], cust: idx['得意先'] ?? idx['customer'], qty: idx['qty'] ?? idx['数量'] };
  let rows = (dat.rows||[]).filter(r => r[col.date]!=null);
  // filter berdasarkan range
  rows = applyRangeChart(rows, col);
  const ag = buildAggChart(rows, col);
  Chart.register(ChartDataLabels);

  // Daily
  const dMax=Math.max(0,...ag.dailyValues);
  const dailyType = stateChart.dailyOrient==='h'?'bar':'line';
  const dailyHorizontal = stateChart.dailyOrient==='h';
  upsertChart($("#dailyShip"), {
    type: dailyType,
    data:{ labels:ag.dailyLabels, datasets:[{ label:metricLabel(), data:ag.dailyValues, tension:.25, fill:!dailyHorizontal, pointRadius:3 }] },
    options: makeCommonOptions({horizontal: dailyHorizontal, maxVal:dMax})
  }, 'dailyChart');

  // Monthly YTD
  const mMax = Math.max(0, ...ag.ytdMonthlyValues);
  const monHorizontal = stateChart.monthlyOrient === 'h';
  upsertChart($("#monthlyQty"), {
    type: 'bar',
    data: { labels: ag.ytdMonthlyLabels, datasets: [{ label: metricLabel(), data: ag.ytdMonthlyValues }] },
    options: Object.assign(makeCommonOptions({ horizontal: monHorizontal, maxVal: mMax }), monHorizontal ? { indexAxis: 'y' } : {})
  }, 'monthlyChart');

  // Customers Top
  const cMax=Math.max(0,...ag.custValues); let custConfig;
  if(stateChart.custType==='pie'){
    custConfig = { type:'pie', data:{ labels:ag.custLabels, datasets:[{ label:metricLabel(), data:ag.custValues }] },
      options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{position:'right'},
        datalabels:{ display: stateChart.labels, formatter:(v,ctx)=>{ const sum=ctx.chart.data.datasets[0].data.reduce((a,b)=>a+b,0)||1; const p=Math.round(v/sum*100); return `${v} (${p}%)`; } } } } };
  }else if(stateChart.custType==='pareto'){
    const total = ag.custValues.reduce((a,b)=>a+b,0)||1;
    const cum = []; ag.custValues.reduce((acc,v,i)=> (cum[i]=Math.round((acc+v)/total*100), acc+v),0);
    custConfig = { type:'bar',
      data:{ labels:ag.custLabels, datasets:[{ label:metricLabel(), data:ag.custValues, yAxisID:'y' }, { label:'累積(%)', data:cum, type:'line', yAxisID:'y1', tension:.25, pointRadius:3 }] },
      options:{ responsive:true, maintainAspectRatio:false, layout:{padding:{right:30}},
        plugins:{ legend:{display:true}, datalabels:{ display: stateChart.labels, anchor:'end', align:'top', formatter:(v,ctx)=> ctx.dataset.type==='line'? v+'%': v } },
        scales:{ x:{grid:{color:'#eef2ff'}}, y:{grid:{color:'#f1f5f9'}, beginAtZero:true}, y1:{position:'right', beginAtZero:true, max:100, grid:{drawOnChartArea:false}} } } };
  }else{
    const horiz = stateChart.custType==='barH';
    custConfig = { type:'bar', data:{ labels:ag.custLabels, datasets:[{ label:metricLabel(), data:ag.custValues }] },
      options: Object.assign(makeCommonOptions({horizontal:horiz, maxVal:cMax}), horiz?{indexAxis:'y'}:{}) };
  }
  upsertChart($("#custQty"), custConfig, 'custChart');

  // Customer monthly stacked (YTD)
  const labels = ag.months; const datasets = ag.custMonthDatasets; const horiz = stateChart.custMonOrient==='h';
  upsertChart($("#custMonthly"), {
    type:'bar',
    data:{ labels, datasets },
    options:Object.assign({
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{position:'bottom'}, datalabels:{ display:false } },
      scales: horiz
        ? { x:{ stacked:true, grid:{color:'#eef2ff'}}, y:{ stacked:true, grid:{color:'#f1f5f9'} } }
        : { x:{ stacked:true, grid:{color:'#eef2ff'}}, y:{ stacked:true, grid:{color:'#f1f5f9'}, ticks:{precision:0}} }
    }, horiz?{indexAxis:'y'}:{})
  }, 'custMonChart');

  // Controls (ringkas)
  $("#dailyOrient").onclick = ()=>{ stateChart.dailyOrient = (stateChart.dailyOrient==='v'?'h':'v'); initCharts(); };
  $("#monthlyOrient").onclick = ()=>{ stateChart.monthlyOrient = (stateChart.monthlyOrient==='v'?'h':'v'); initCharts(); };
  $("#custTypeBar").onclick = ()=>{ stateChart.custType='bar'; initCharts(); };
  $("#custTypeBarH").onclick = ()=>{ stateChart.custType='barH'; initCharts(); };
  $("#custTypePie").onclick = ()=>{ stateChart.custType='pie'; initCharts(); };
  $("#custTypePareto").onclick = ()=>{ stateChart.custType='pareto'; initCharts(); };
  $("#custTop").onclick = ()=>{ stateChart.custTop = (stateChart.custTop===10)?20:10; initCharts(); };

  $("#metricToggle")?.addEventListener('click', (e)=>{
    const btn = e.target.closest('[data-metric]'); if(!btn) return;
    stateChart.metric = btn.getAttribute('data-metric'); $("#metricBadge").textContent = '表示: '+(stateChart.metric==='count'?'件数':'数量');
    initCharts();
  });
  $("#dailyExport").onclick = ()=> exportChartsExcelCurrent(rows, col);
  $("#monthlyExport").onclick = ()=> exportChartsExcelCurrent(rows, col);
  $("#custMonExport").onclick = ()=> exportChartsExcelCurrent(rows, col);
  $("#custExport").onclick = ()=> exportChartsExcelCurrent(rows, col);
}
function applyRangeChart(rows, idx){
  const now = new Date();
  if(stateChart.range === '14d'){ const dt = new Date(now); dt.setDate(dt.getDate() - 13); dt.setHours(0,0,0,0); return rows.filter(r=>{ const d=parseJPDate(r[idx.date]); return d && d>=dt; }); }
  if(stateChart.range === '30d'){ const dt = new Date(now); dt.setDate(dt.getDate() - 29); dt.setHours(0,0,0,0); return rows.filter(r=>{ const d=parseJPDate(r[idx.date]); return d && d>=dt; }); }
  if(stateChart.range === 'ytd'){ const dt = new Date(now.getFullYear(),0,1); return rows.filter(r=>{ const d=parseJPDate(r[idx.date]); return d && d>=dt; }); }
  return rows;
}
function buildAggChart(rows, idx){
  const mapDaily={}, mapMonthly={}, mapYearly={}, mapCust={}, mapCustMonth={};
  rows.forEach(r=>{
    const d=parseJPDate(r[idx.date]); if(!d) return;
    const v = metricValue(r, idx); const kDay = fmtDate(d); const kMon = fmtMonth(d); const kYear= fmtYear(d);
    const cust = normalizeCustomerName(r[idx.cust]) || '—';
    mapDaily[kDay]=(mapDaily[kDay]||0)+v; mapMonthly[kMon]=(mapMonthly[kMon]||0)+v; mapYearly[kYear]=(mapYearly[kYear]||0)+v;
    mapCust[cust]=(mapCust[cust]||0)+v;
    (mapCustMonth[kMon]||(mapCustMonth[kMon]={}))[cust]=(mapCustMonth[kMon][cust]||0)+v;
  });
  const dailyLabels=Object.keys(mapDaily).sort(); const dailyValues=dailyLabels.map(k=>mapDaily[k]);
  const monthlyLabels=Object.keys(mapMonthly).sort(); const monthlyValues=monthlyLabels.map(k=>mapMonthly[k]);
  const yearlyLabels=Object.keys(mapYearly).sort(); const yearlyValues=yearlyLabels.map(k=>mapYearly[k]);
  const custEntries=Object.entries(mapCust).sort((a,b)=>b[1]-a[1]).slice(0,stateChart.custTop);
  const custLabels=custEntries.map(x=>x[0]); const custValues=custEntries.map(x=>x[1]);
  // YTD 12 months
  const currentYear = new Date().getFullYear(); const ytdMonthlyLabels = []; const ytdMonthlyValues = [];
  for(let i=0;i<12;i++){ ytdMonthlyLabels.push(`${i+1}月`); const mk = `${currentYear}-${String(i+1).padStart(2,'0')}`; ytdMonthlyValues.push(mapMonthly[mk]||0); }
  // Stacked by customer (Top N)
  const topLabels = Object.entries(mapCust).sort((a,b)=>b[1]-a[1]).slice(0, stateChart.custMonTop).map(x=>x[0]);
  const months = monthlyLabels;
  const custMonthDatasets = topLabels.map(cn=>({ label: cn, data: months.map(m=> (mapCustMonth[m]?.[cn]) || 0 ) }));
  return { dailyLabels,dailyValues, monthlyLabels,monthlyValues, yearlyLabels,yearlyValues, custLabels,custValues, months, custMonthDatasets, ytdMonthlyLabels,ytdMonthlyValues };
}
function makeCommonOptions({horizontal=false, maxVal=null}={}){
  const headroom = maxVal? Math.ceil(maxVal*1.15) : undefined;
  const scales = horizontal
    ? { x:{ grid:{color:'#eef2ff'}, suggestedMax: headroom }, y:{ grid:{color:'#f1f5f9'} } }
    : { x:{ grid:{color:'#eef2ff'} }, y:{ grid:{color:'#f1f5f9'}, suggestedMax: headroom, ticks:{precision:0}} };
  return {
    responsive:true, maintainAspectRatio:false, layout:{padding:{right:30, top:10}},
    plugins:{
      legend:{display:false},
      datalabels:{ display: stateChart.labels, clip:false, clamp:true, anchor: horizontal?'end':'end', align:  horizontal?'end':'top', offset: 4, formatter:(v)=> (v==null||isNaN(v))?'':String(Math.round(v)), font:{weight:'700'}, padding:4 },
      tooltip:{mode:'index',intersect:false, callbacks:{ label:(ctx)=> metricLabel()+': '+(ctx.parsed?.y ?? ctx.raw) }},
    }, scales
  };
}
function upsertChart(canvas, cfg, name){
  if(!canvas) return;
  if(window[name]){ window[name].data=cfg.data; window[name].options=cfg.options; window[name].update(); }
  else{ window[name]=new Chart(canvas, cfg); }
}
function exportChartsExcelCurrent(rows, col){
  const ag = buildAggChart(rows, col);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['日付', metricLabel()], ...ag.dailyLabels.map((d,i)=>[d, ag.dailyValues[i]])]), 'Daily');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['月', metricLabel()], ...ag.ytdMonthlyLabels.map((m,i)=>[m, ag.ytdMonthlyValues[i]])]), 'MonthlyYTD');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['年', metricLabel()], ...ag.yearlyLabels.map((y,i)=>[y, ag.yearlyValues[i]])]), 'Yearly');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['顧客', metricLabel()], ...ag.custLabels.map((c,i)=>[c, ag.custValues[i]])]), 'CustomersTop');
  const headerM=['月', ...ag.custMonthDatasets.map(d=>d.label)];
  const rowsM=ag.months.map((m,i)=> [m, ...ag.custMonthDatasets.map(ds=> ds.data[i]) ]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headerM, ...rowsM]), 'CustMonthly');
  XLSX.writeFile(wb, 'charts_export.xlsx');
}

// ================== 請求書（Invoice） ==================
// Catatan: asumsi endpoint berikut tersedia di Apps Script:
// - listShip (sumber data item)
// - listInvoice (daftar invoice tersimpan) [opsional]
// - saveInvoice (simpan invoice baru) {customer, date, items:[{po_id, item_name, part_no, qty, price, amount, ship_date}]}
let INVOICE_CACHE = { items: [], listed: [] };

async function initInvoicePage(){
  // isi dropdown customer
  const sel = $("#invoiceCustomer"); if(sel && !sel._filled){
    if(!MASTERS.customers?.length) await loadMasters();
    sel.innerHTML = `<option value="">(得意先を選択)</option>` + (MASTERS.customers||[]).map(c=>`<option value="${c}">${c}</option>`).join('');
    sel._filled = true;
  }
  $("#invoiceDate").value ||= new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10);
  await reloadInvoiceCandidates();
  $("#btnInvoiceReload").onclick = reloadInvoiceCandidates;
  $("#btnInvoiceSave").onclick = saveInvoice;
  $("#btnInvoiceXlsx").onclick = exportInvoiceExcel;
  $("#btnInvoicePdf").onclick = printInvoiceHTML;
}
async function reloadInvoiceCandidates(){
  const cust = $("#invoiceCustomer").value; if(!cust){ $("#tbInvoiceCandidates").innerHTML=''; $("#tbInvoiceStatus").innerHTML=''; return; }
  const dat = await cached("listShip", {}, 5000);
  const head = dat.header||[]; const idx = Object.fromEntries(head.map((h,i)=>[String(h).trim(), i]));
  const col = {
    po: idx['po_id'] ?? idx['注番'], cust: idx['得意先'] ?? idx['customer'], item: idx['品名'] ?? idx['item_name'],
    part: idx['品番'] ?? idx['part_no'], qty: idx['qty'] ?? idx['数量'], price: idx['単価'] ?? null, amount: idx['金額'] ?? null,
    ship: idx['scheduled_date'] ?? idx['出荷日'], status: idx['状態'] ?? idx['status']
  };
  const rows = (dat.rows||[]).filter(r => String(r[col.cust]||'')===cust);
  // Simple status (請求書済 / 未)
  const tbC=$("#tbInvoiceCandidates"), tbS=$("#tbInvoiceStatus"); tbC.innerHTML=''; tbS.innerHTML='';
  const fragC=document.createDocumentFragment(), fragS=document.createDocumentFragment();

  rows.forEach(r=>{
    const qty = Number(r[col.qty]||0) || 0;
    const price = Number(r[col.price]||0) || 0;
    const amount = (col.amount!=null) ? Number(r[col.amount]||0) : (qty*price);
    const done = /請求書済/.test(String(r[col.status]||''));
    const tr = document.createElement('tr');
    const money = (n)=> (isFinite(n)? n.toLocaleString('ja-JP'): '');
    if(!done){
      tr.innerHTML = `
        <td><input type="checkbox" class="invPick" data-po="${r[col.po]||''}" data-item="${r[col.item]||''}" data-part="${r[col.part]||''}" data-qty="${qty}" data-price="${price}" data-ship="${r[col.ship]||''}"></td>
        <td>${r[col.po]||''}</td><td>${r[col.item]||''}</td><td>${r[col.part]||''}</td>
        <td>${qty}</td><td>${money(price)}</td><td>${money(amount)}</td><td>${r[col.ship]? new Date(r[col.ship]).toLocaleDateString('ja-JP'):''}</td>`;
      fragC.appendChild(tr);
    }
    const badge = done ? `<span class="chip" style="background:#dcfce7">請求書済</span>` : `<span class="chip" style="background:#fee2e2">請求書（未）</span>`;
    const tr2 = document.createElement('tr');
    tr2.innerHTML = `
      <td>${r[col.po]||''}</td><td>${r[col.item]||''}</td><td>${r[col.part]||''}</td>
      <td>${qty}</td><td>${money(price)}</td><td>${money(amount)}</td>
      <td>${r[col.ship]? new Date(r[col.ship]).toLocaleDateString('ja-JP'):''}</td><td>${badge}</td>`;
    fragS.appendChild(tr2);
  });
  tbC.appendChild(fragC); tbS.appendChild(fragS);
}
async function saveInvoice(){
  const cust = $("#invoiceCustomer").value; if(!cust) return alert("得意先を選択してください");
  const date = $("#invoiceDate").value || new Date().toISOString().slice(0,10);
  const picks = $$(".invPick:checked").map(el=>({
    po_id: el.dataset.po, item_name: el.dataset.item, part_no: el.dataset.part,
    qty: Number(el.dataset.qty||0)||0, price: Number(el.dataset.price||0)||0, ship_date: el.dataset.ship||''
  })).filter(x=>x.qty>0);
  if(!picks.length) return alert("項目を選択してください");
  if(!confirm(`請求書を作成しますか？\n得意先:${cust}\n件数:${picks.length}`)) return;
  try{
    await jsonp('saveInvoice', { data: JSON.stringify({ customer: cust, date, items: picks }), user: JSON.stringify(CURRENT_USER||{}) });
    alert("保存しました");
    await reloadInvoiceCandidates();
  }catch(e){ alert("保存失敗: " + e.message); }
}
function exportInvoiceExcel(){
  const cust = $("#invoiceCustomer").value || '未選択';
  const date = $("#invoiceDate").value || new Date().toISOString().slice(0,10);
  const rows = [...$("#tbInvoiceCandidates").querySelectorAll("tr")].filter(tr=> tr.querySelector(".invPick:checked")).map(tr=> [...tr.children].slice(1).map(td=> td.textContent));
  if(!rows.length) return alert("エクスポート対象がありません");
  const headers = ['注番','商品名','品番','数量','単価','金額','出荷日'];
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, '請求書');
  const fname = `請求書_${cust}_${date.replaceAll('-','')}.xlsx`; XLSX.writeFile(wb, fname);
}
function printInvoiceHTML(){
  const cust = $("#invoiceCustomer").value || '—';
  const date = $("#invoiceDate").value || new Date().toISOString().slice(0,10);
  const rows = [...$("#tbInvoiceCandidates").querySelectorAll("tr")].filter(tr=> tr.querySelector(".invPick:checked")).map(tr=> [...tr.children].slice(1).map(td=> td.textContent));
  if(!rows.length) return alert("印刷対象がありません");
  const total = rows.reduce((s,r)=> s + (Number(String(r[4]).replace(/,/g,'')) * Number(String(r[3]).replace(/,/g,'')) || Number(String(r[5]).replace(/,/g,''))||0), 0);
  const html = `
    <html><head><meta charset="utf-8"><title>請求書</title>
    <style>body{font-family:"Noto Sans JP",system-ui,Roboto,Arial;padding:24px;}
    h1{margin:0 0 6px;} table{width:100%;border-collapse:collapse;font-size:12px;margin-top:8px}
    th,td{border:1px solid #ddd;padding:6px 8px;text-align:left} th{background:#f6f7fb} .right{text-align:right}</style>
    </head><body>
    <h1>請求書</h1>
    <div>得意先: <b>${cust}</b></div>
    <div>発行日: ${new Date(date).toLocaleDateString('ja-JP')}</div>
    <table><tr><th>注番</th><th>商品名</th><th>品番</th><th>数量</th><th>単価</th><th>金額</th><th>出荷日</th></tr>
      ${rows.map(r=> `<tr>${r.map((c,i)=> `<td class="${i>=3?'right':''}">${c||''}</td>`).join('')}</tr>`).join('')}
      <tr><td colspan="5" class="right"><b>合計</b></td><td class="right"><b>${Number(total||0).toLocaleString('ja-JP')}</b></td><td></td></tr>
    </table>
    <script>window.print();</script></body></html>`;
  const w = window.open('about:blank'); w.document.write(html); w.document.close();
}

// ================== Utils ==================
function debounce(fn, wait){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), wait); }; }

// ================== Print ship (by customer) ==================
async function printShipByCustomer(cust, ymd){
  const dat = await cached("listShip", {}, 5000);
  const head = dat.header||[]; const idx = Object.fromEntries(head.map((h,i)=>[String(h).trim(), i]));
  const rowsAll = (dat.rows||[]).filter(r => String(r[idx['得意先']]||r[idx['customer']]||'') === cust);
  const dkey = (v)=>{ const d=(v instanceof Date)?v:new Date(v); return isNaN(d)?'(日付未設定)':new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10); };
  const rows = ymd ? rowsAll.filter(r => dkey(r[idx['scheduled_date']]||r[idx['出荷日']]) === ymd) : rowsAll;
  const groups = {}; rows.forEach(r=>{ const k = dkey(r[idx['scheduled_date']]||r[idx['出荷日']]); (groups[k] ??= []).push(r); });
  const mapDate = (v)=>{ const d=(v instanceof Date)?v:new Date(v); return isNaN(d)?'':d.toLocaleDateString('ja-JP'); };
  const html = `<html><head><meta charset="utf-8"><title>出荷予定 - ${cust}${ymd? ' '+ymd:''}</title>
    <style>body{font-family:system-ui,Roboto,Arial;padding:24px;}h1{font-size:20px;margin:0 0 6px;}
    h2{font-size:14px;margin:16px 0 8px;}table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:8px;}
    th,td{border:1px solid #ddd;padding:6px 8px;text-align:left;}th{background:#f6f7fb;} .right{text-align:right}</style></head>
    <body><h1>出荷予定（${cust}${ymd? ' / '+ymd:''}）</h1>
    ${Object.keys(groups).sort().map(k=>{
      const arr = groups[k]; const total = arr.reduce((s,r)=> s + Number(r[idx['qty']]||r[idx['数量']]||0), 0);
      return `<h2>${k}　合計: ${total}</h2><table>
        <tr>${['注番','品名','品番','図番','製造番号','数量','送り先','出荷日','納入日','運送会社','備考'].map(h=>`<th>${h}</th>`).join('')}</tr>
        ${arr.map(r=> `<tr>
          <td>${r[idx['po_id']]||r[idx['注番']]||''}</td>
          <td>${r[idx['品名']]||r[idx['item_name']]||''}</td>
          <td>${r[idx['品番']]||r[idx['part_no']]||''}</td>
          <td>${r[idx['図番']]||r[idx['drawing_no']]||''}</td>
          <td>${r[idx['製造番号']]||r[idx['製番号']]||''}</td>
          <td class="right">${r[idx['qty']]||r[idx['数量']]||''}</td>
          <td>${r[idx['destination']]||r[idx['送り先']]||''}</td>
          <td>${mapDate(r[idx['scheduled_date']]||r[idx['出荷日']]||'')}</td>
          <td>${mapDate(r[idx['delivery_date']]||r[idx['納入日']]||'')}</td>
          <td>${r[idx['carrier']]||r[idx['運送会社']]||''}</td>
          <td>${r[idx['note']]||r[idx['備考']]||''}</td>
        </tr>`).join('')}
      </table>`; }).join('')}
    <script>window.print();</script></body></html>`;
  const w = window.open('about:blank'); w.document.write(html); w.document.close();
}


// ================== ADMIN: Add Member Baru ==================
$("#btnAddMember")?.addEventListener("click", ()=>{
  if(CURRENT_USER?.role!=='admin'){ alert("Hanya admin."); return; }
  $("#dlgAddMember").showModal();
});
$("#btnAddMemberCancel")?.addEventListener("click", ()=> $("#dlgAddMember").close());
$("#btnAddMemberSave")?.addEventListener("click", async ()=>{
  try{
    const f = $("#formAddMember");
    const payload = {
      username: f.username.value.trim(),
      password: f.password.value, // pastikan backend menyimpan hashed!
      role: f.role.value,
      department: f.department.value.trim()
    };
    if(!payload.username || !payload.password) return alert("Lengkapi username & password.");
    await jsonp("addMember", { data: JSON.stringify(payload), user: JSON.stringify(CURRENT_USER||{}) });
    $("#dlgAddMember").close();
    alert("Member berhasil ditambahkan.");
  }catch(e){ alert("Gagal menambah member: " + (e?.message||e)); }
});

// ================== Utils kecil ==================
function debounce(fn, wait){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), wait); }; }

// ================== Init ==================
document.addEventListener("DOMContentLoaded", ()=> {
  setUser(null); // show login
});
