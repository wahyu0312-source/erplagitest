/* =================================================
  TSH ERP Frontend — Optimized
  Backend: Google Apps Script JSONP
================================================= */

/* ================== CONFIG ================== */
// Ganti ke URL Web App Apps Script Anda
const API_BASE = "https://script.google.com/macros/s/AKfycbyFPilRpjXxKVlM2Av2LunQJAIJszz9wNX0j1Ab1pbWkZeecIx_QNZwoKQR6XCNGYSLGA/exec";

/* ================== DOM HELPERS ================== */
const $  = (q, el=document)=> el.querySelector(q);
const $$ = (q, el=document)=> [...el.querySelectorAll(q)];
const qs = (o)=> Object.entries(o).map(([k,v])=>`${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
const fmt= (d)=> d? new Date(d).toLocaleString("ja-JP"):"";
const sleep = (ms)=> new Promise(r=>setTimeout(r,ms));
window.requestIdleCallback ||= (cb)=> setTimeout(cb, 0);

/* ================== JSONP & CACHE ================== */
function jsonp(action, params={}){
  return new Promise((resolve,reject)=>{
    const cb = "cb_" + Math.random().toString(36).slice(2);
    params = { ...params, action, callback: cb };
    const s = document.createElement("script");
    s.src = `${API_BASE}?${qs(params)}`;
    let timeout = setTimeout(()=>{ cleanup(); reject(new Error("API timeout")); }, 12000);
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

/* ================== STATE ================== */
let CURRENT_USER = null;
let ORDERS = [];
let MASTERS = { customers:[], drawings:[], item_names:[], part_nos:[], destinations:[], carriers:[], po_ids:[] };

const ROLE_MAP = {
  'admin': { pages:['pageDash','pageSales','pagePlan','pageShip','pageFinished','pageInv','pageInvoice','pageAnalytics'], nav:true },
  '営業': { pages:['pageSales','pageDash','pageFinished','pageInv','pageInvoice','pageAnalytics'], nav:true },
  '生産管理': { pages:['pagePlan','pageShip','pageDash','pageFinished','pageInv','pageInvoice','pageAnalytics'], nav:true },
  '生産管理部': { pages:['pagePlan','pageShip','pageDash','pageFinished','pageInv','pageInvoice','pageAnalytics'], nav:true },
  '製造': { pages:['pageDash','pageFinished','pageInv','pageAnalytics'], nav:true },
  '検査': { pages:['pageDash','pageFinished','pageInv','pageAnalytics'], nav:true }
};

/* ================== ROLE & NAV ================== */
function setUser(u){
  CURRENT_USER = u || null;
  document.body.classList.toggle("auth", !u);
  $("#userInfo").textContent = u ? `${u.role||''} / ${u.department||''}` : "";
  // Reset vis
  const buttons = ['btnToDash','btnToSales','btnToPlan','btnToShip','btnToFinPage','btnToInvPage','btnToInvoice','btnToAnalytics'];
  buttons.forEach(id=> $("#"+id)?.classList.add("hidden"));
  $("#btnLogout")?.classList.toggle("hidden", !u);
  $("#weatherWrap")?.classList.toggle("hidden", !u);
  $("#btnAddMember")?.classList.add("hidden");

  // Hide semua pages
  $$("section[id^='page']").forEach(el=> el.classList.add("hidden"));
  $("#authView")?.classList.toggle("hidden", !!u);

  if(!u){ return; }

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
    if(u.role === 'admin') $("#btnAddMember")?.classList.remove("hidden");
  }
  requestIdleCallback(()=> { ensureWeather(); loadMasters().catch(()=>{}); });

  // First paint: tampilkan Dash lalu load
  show("pageDash");
  refreshAll().catch(()=>{});
}
function show(id){
  $$("section[id^='page']").forEach(el=> el.classList.add("hidden"));
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

/* ================== AUTH ================== */
$("#btnLogin").onclick = loginSubmit;
$("#inUser")?.addEventListener("keydown", e=>{ if(e.key==='Enter') loginSubmit(); });
$("#inPass")?.addEventListener("keydown", e=>{ if(e.key==='Enter') loginSubmit(); });

async function loginSubmit(){
  const u = $("#inUser").value.trim();
  const p = $("#inPass").value.trim();
  if(!u || !p) return alert("ユーザー名 / パスワード を入力してください");
  try{
    const me = await jsonp("login", { username:u, password:p });
    setUser(me);
    // Bersihkan field login
    $("#inUser").value=""; $("#inPass").value="";
  }catch(e){
    alert("ログイン失敗: " + (e?.message || e));
  }
}

$("#btnLogout").onclick = async ()=>{
  try {
    // Tutup dialog/stream kalau ada
    $("#dlgScan")?.open && $("#dlgScan").close();
    $("#dlgOp")?.open && $("#dlgOp").close();
    $("#dlgAddUser")?.open && $("#dlgAddUser").close();
  } finally {
    apiCache.clear();
    ORDERS = [];
    MASTERS = {customers:[], drawings:[], item_names:[], part_nos:[], destinations:[], carriers:[], po_ids:[]};
    setUser(null);
  }
};

/* ================== DASHBOARD (Orders) ================== */
async function loadOrders(){
  try{
    ORDERS = await cached("listOrders",{},15000);
  }catch(e){
    ORDERS = [];
  }
  renderOrders();
  loadShipsMini().catch(()=>{});
}
function renderOrders(){
  const q = ($("#searchQ")?.value||"").trim().toLowerCase();
  const rows = (ORDERS||[]).filter(r => !q || JSON.stringify(r).toLowerCase().includes(q));
  const tb = $("#tbOrders");
  if(!tb) return;
  tb.innerHTML = "";
  const chunk = 140; let i = 0;
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
        <td class="center">${statusToBadge(r.status)}</td>
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
            <button class="btn ghost btn-stqr" title="工程QR"><i class="fa-solid fa-qrcode"></i> 工程QR</button>
            <button class="btn ghost btn-scan" data-po="${r.po_id}" title="スキャン"><i class="fa-solid fa-camera"></i> スキャン</button>
            <button class="btn ghost btn-op" data-po="${r.po_id}" title="手入力"><i class="fa-solid fa-keyboard"></i> 手入力</button>
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

/* ================== HELPERS BADGE/CHIP ================== */
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

/* ================== SHIP MINI ================== */
async function loadShipsMini(){
  try{
    const ship = await cached("listShip",{},30000);
    const today = new Date().toISOString().slice(0,10);
    const todayRows = ship.filter(r => String(r['出荷予定日']||'').startsWith(today));
    $("#shipToday").textContent = todayRows.length? `${todayRows.length} 件`: "—";
    $("#shipPlan").textContent  = ship.length? `${ship.length} 件`: "—";
  }catch(e){
    $("#shipToday").textContent = "—";
    $("#shipPlan").textContent  = "—";
  }
}

/* ================== SALES / PLAN / SHIP / FIN / INV (placeholder minimal agar lengkap) ================== */
async function loadSales(){ /* gunakan data sheet jika diperlukan */ }
async function loadPlans(){ /* ... */ }
async function loadShips(){ /* ... (tabel penuh) */ }
async function loadFinished(){ /* ... */ }
async function loadInventory(){ /* ... */ }

/* ================== INVOICE (minimal) ================== */
function initInvoicePage(){
  // contoh minimal: muat masters customer -> <select>
  const sel = $("#invoiceCustomer");
  sel.innerHTML = `<option value="">(得意先を選択)</option>` + (MASTERS.customers||[]).map(c=>`<option>${c}</option>`).join("");
}

/* ================== WEATHER (dummy local) ================== */
async function ensureWeather(){
  try{
    $("#wxTemp").textContent = "20℃";
    $("#wxWind").textContent = "6 m/s";
    $("#wxPlace").textContent = "GMT+9";
  }catch{}
}

/* ================== QR / OP DIALOGS ================== */
function openStationQrSheet(){
  alert("工程QR シートを開きます（実環境のスプレッドシートURLにリンクしてください）");
}
function openScanDialog(po){
  $("#scanResult").textContent = po ? `注番: ${po}` : "—";
  $("#dlgScan").showModal();
}
$("#btnScanClose").onclick = ()=> $("#dlgScan").close();
$("#btnScanStart").onclick = ()=> alert("カメラ起動は端末権限が必要です（jsQR使用）。");

function openOpDialog(po){
  $("#opPO").textContent = po || "—";
  $("#opOK").value = 0; $("#opNG").value = 0; $("#opNote").value = "";
  const sel = $("#opProcess");
  sel.innerHTML = ["切断","レザー加工","曲げ","外注加工/組立","検査","出荷準備","出荷済"].map(x=>`<option>${x}</option>`).join("");
  $("#dlgOp").showModal();
}
$("#btnOpCancel").onclick = ()=> $("#dlgOp").close();
$("#btnOpSave").onclick = async ()=>{
  const payload = {
    po_id: $("#opPO").textContent,
    process: $("#opProcess").value,
    ok: Number($("#opOK").value||0),
    ng: Number($("#opNG").value||0),
    note: $("#opNote").value||'',
    user: JSON.stringify(CURRENT_USER||{})
  };
  try{
    await jsonp("saveOp", payload);
    alert("保存しました");
    $("#dlgOp").close();
    await refreshAll();
  }catch(e){
    alert("保存失敗: " + (e?.message||e));
  }
};

/* ================== ADMIN: ADD MEMBER ================== */
const openAddUser = ()=>{
  $("#dlgAddUser").showModal();
  $("#btnAddUserSave").onclick = async ()=>{
    const username = $("#auUser").value.trim();
    const password = $("#auPass").value.trim();
    const role     = $("#auRole").value;
    const department = $("#auDept").value.trim();
    const full_name  = $("#auName").value.trim();
    if(!username || !password) return alert("Username dan Password wajib.");
    try{
      await jsonp("addMember", { data: JSON.stringify({ username, password, role, department, full_name }), user: JSON.stringify(CURRENT_USER||{}) });
      alert("Member berhasil ditambahkan");
      $("#dlgAddUser").close();
      $("#auUser").value = $("#auPass").value = $("#auDept").value = $("#auName").value = "";
    }catch(e){
      alert("Gagal menambahkan member: " + (e?.message||e));
    }
  };
  $("#btnAddUserCancel").onclick = ()=> $("#dlgAddUser").close();
};
$("#btnAddMember")?.addEventListener("click", openAddUser);

/* ================== UTILS ================== */
function debounce(fn, wait=250){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), wait); }; }
function exportTableCSV(tbodySel, filename="export.csv"){
  const tb = $(tbodySel);
  if(!tb) return;
  const rows = [];
  const table = tb.closest("table");
  const ths = $$("thead th", table).map(th => th.textContent.trim());
  rows.push(ths.join(","));
  $$("tr", tb).forEach(tr=>{
    const cols = $$("td,th", tr).map(td => `"${(td.textContent||'').replace(/"/g,'""')}"`);
    rows.push(cols.join(","));
  });
  const blob = new Blob([rows.join("\n")], {type:"text/csv;charset=utf-8;"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ================== INIT ================== */
document.addEventListener("DOMContentLoaded", ()=>{
  // Mulai dari mode auth (login only)
  setUser(null);

  // Sistem dropdown: 工程QR
  $("#btnStationQR")?.addEventListener("click", openStationQrSheet);
});
