/* =========================================================
  ERP Frontend – Single File (Figma-like, Light by default)
  Works with Google Apps Script backend (code.gs you posted)
  Features:
   - Fast login (JSONP, warm ping) + role-aware nav
   - Dashboard list + inline actions (history, QR, manual op)
   - Sales / Plans / Ship / Finished / Inventory (read)
   - Invoice (candidates, create, list)
   - QR scan (jsQR), Chart.js, XLSX export
   - Tiny cache for snappy navigation
========================================================= */

/* ========== 0) KONFIG ========== */
const API_BASE = "https://script.google.com/macros/s/AKfycbyFPilRpjXxKVlM2Av2LunQJAIJszz9wNX0j1Ab1pbWkZeecIx_QNZwoKQR6XCNGYSLGA/exec"; // <<< ganti ini
const CACHE_TTL = { orders:30_000, sheet:30_000, masters:300_000, invoices:60_000 };

/* ========== 1) HELPER DOM / UTIL ========== */
const $  = (q, el=document)=> el.querySelector(q);
const $$ = (q, el=document)=> [...el.querySelectorAll(q)];
const qs = (o)=> Object.entries(o).map(([k,v])=>`${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
const fmtDate = (v)=> v ? new Date(v).toLocaleDateString("ja-JP") : "";
const fmtTime = (v)=> v ? new Date(v).toLocaleString("ja-JP") : "";
const numJP   = (n)=> Number(n||0).toLocaleString("ja-JP");
const idle    = window.requestIdleCallback || ((fn)=> setTimeout(fn,0));
const sleep   = (ms)=> new Promise(r=>setTimeout(r,ms));

function debounce(fn, ms){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; }
function toast(s){ console.log(s); /* plug-in to your toast lib if needed */ }
function setBusy(el, on){
  el.classList.toggle("is-busy", !!on);
  el.querySelectorAll("button, input, select").forEach(x=> x.disabled = !!on);
}

/* ========== 2) JSONP & CACHE KECIL ========== */
function jsonp(action, params={}){
  return new Promise((resolve, reject)=>{
    const cb = "cb_" + Math.random().toString(36).slice(2);
    params = { ...params, action, callback: cb };
    const s = document.createElement("script");
    let url = API_BASE + (API_BASE.includes("?") ? "&" : "?") + qs(params);
    let timer = setTimeout(()=>{ cleanup(); reject(new Error("API timeout")); }, 12000);
    function cleanup(){ try{ delete window[cb]; s.remove(); }catch{} clearTimeout(timer); }
    window[cb] = (resp)=>{ cleanup(); if(resp && resp.ok) resolve(resp.data); else reject(new Error(resp?.error||"API error")); };
    s.onerror = ()=>{ cleanup(); reject(new Error("JSONP error")); };
    s.src = url; document.body.appendChild(s);
  });
}
const _cache = new Map();
async function cached(action, params={}, ttl=30_000){
  const key = action + "::" + JSON.stringify(params||{});
  const hit = _cache.get(key);
  const now = Date.now();
  if(hit && (now - hit.t) < ttl) return hit.v;
  const v = await jsonp(action, params);
  _cache.set(key, {v, t:now});
  return v;
}
function bust(pattern){
  [..._cache.keys()].forEach(k=>{ if(k.startsWith(pattern)) _cache.delete(k); });
}

/* ========== 3) SESSION & NAV (tanpa sidebar saat login) ========== */
let CURRENT_USER = null;

function setUser(u){
  CURRENT_USER = u || null;
  // Top bar show/hide
  $("#topBar")?.classList.toggle("hidden", !u);
  // Halaman
  ["authView","pageDash","pageSales","pagePlan","pageShip","pageFinished","pageInv","pageInvoice","pageAnalytics"]
    .forEach(id=> $("#"+id)?.classList.add("hidden"));

  // Nav visibility
  const NAV_BTNS = ["btnToDash","btnToSales","btnToPlan","btnToShip","btnToFinPage","btnToInvPage","btnToInvoice","btnToAnalytics","ddSetting","weatherWrap"];
  NAV_BTNS.forEach(id=> $("#"+id)?.classList.add("hidden"));

  if(!u){ $("#authView").classList.remove("hidden"); return; }

  $("#userInfo").textContent = `${u.full_name||u.username||"-"} / ${u.role||u.department||"-"}`;
  // Izinkan semua menu (kalau mau granular tinggal mapping role -> pages)
  ["btnToDash","btnToSales","btnToPlan","btnToShip","btnToFinPage","btnToInvPage","btnToInvoice","btnToAnalytics","ddSetting","weatherWrap"]
    .forEach(id=> $("#"+id)?.classList.remove("hidden"));

  show("pageDash"); refreshDashboard();
}

function show(id){
  ["authView","pageDash","pageSales","pagePlan","pageShip","pageFinished","pageInv","pageInvoice","pageAnalytics"]
    .forEach(x=> $("#"+x)?.classList.add("hidden"));
  $("#"+id)?.classList.remove("hidden");
}

/* ========== 4) LOGIN CEPAT (warm ping) ========== */
$("#btnLogin")?.addEventListener("click", loginSubmit);
$("#inUser")?.addEventListener("keydown", e=>{ if(e.key==="Enter") loginSubmit(); });
$("#inPass")?.addEventListener("keydown", e=>{ if(e.key==="Enter") loginSubmit(); });
$("#btnLogout")?.addEventListener("click", ()=> setUser(null));

async function loginSubmit(){
  const username = $("#inUser").value.trim();
  const password = $("#inPass").value.trim();
  if(!username || !password) return alert("ユーザー名・パスワードを入力してください");
  try{
    // warmup
    await Promise.race([jsonp("ping"), sleep(120)]);
    const me = await jsonp("login", { username, password });
    setUser(me);
    // Prefetch biar lincah
    idle(()=> cached("listMasters", {}, CACHE_TTL.masters).catch(()=>{}));
    idle(()=> cached("listOrders", {}, CACHE_TTL.orders).catch(()=>{}));
  }catch(err){
    alert("ログイン失敗: " + err.message);
  }
}

/* ========== 5) NAVIGASI ========== */
$("#btnToDash").onclick = ()=>{ show("pageDash"); refreshDashboard(); };
$("#btnToSales").onclick= ()=>{ show("pageSales"); loadSales(); };
$("#btnToPlan").onclick = ()=>{ show("pagePlan"); loadPlans(); };
$("#btnToShip").onclick = ()=>{ show("pageShip"); loadShips(); };
$("#btnToFinPage").onclick=()=>{ show("pageFinished"); loadFinished(); };
$("#btnToInvPage").onclick =()=>{ show("pageInv"); loadInventory(); };
$("#btnToInvoice").onclick =()=>{ show("pageInvoice"); initInvoicePage(); };
$("#btnToAnalytics").onclick=()=>{ show("pageAnalytics"); initAnalytics(); };

/* ========== 6) BADGE / CHIP UI ========== */
function chip(txt, tone="#f1f5f9", icon="fa-regular fa-square"){
  return `<span class="chip" style="background:${tone}"><i class="${icon}"></i>${txt||"—"}</span>`;
}
const normalizeProc = (s)=> String(s||"").trim()
  .replace("レーサ加工","レザー加工")
  .replace("外作加工","外注加工/組立");

function procChip(p){
  p = normalizeProc(p);
  if(/レザー/.test(p)) return chip(p,"#fef3c7","fa-solid fa-bolt");
  if(/曲げ/.test(p))   return chip(p,"#e0f2fe","fa-solid fa-wave-square");
  if(/外注|加工/.test(p)) return chip(p,"#e2e8f0","fa-solid fa-industry");
  if(/組立/.test(p))   return chip(p,"#e9d5ff","fa-solid fa-screwdriver-wrench");
  if(/検査中/.test(p)) return chip(p,"#fde68a","fa-regular fa-clipboard");
  if(/検査済/.test(p)) return chip(p,"#dcfce7","fa-regular fa-square-check");
  if(/出荷/.test(p))   return chip(p,"#cffafe","fa-solid fa-truck");
  return chip(p);
}
function statusChip(s){
  if(/出荷済/.test(s)) return chip(s,"#dcfce7","fa-solid fa-truck");
  if(/進行|WIP|作業中/.test(s)) return chip(s,"#e0f2fe","fa-regular fa-clock");
  if(/停止|中断/.test(s)) return chip(s,"#fee2e2","fa-solid fa-triangle-exclamation");
  if(/完了|検査済/.test(s)) return chip(s,"#dcfce7","fa-regular fa-circle-check");
  return chip(s);
}

/* ========== 7) DASHBOARD (Orders + tindakan) ========== */
let ORDERS = [];
const tbOrders = $("#tbOrders");

async function refreshDashboard(){
  setBusy($("#pageDash"), true);
  try{
    ORDERS = await cached("listOrders", {}, CACHE_TTL.orders);
    renderOrders();
    drawDashChart(ORDERS);
  }catch(err){ alert("読み込み失敗: " + err.message); }
  finally{ setBusy($("#pageDash"), false); }
}
$("#searchQ")?.addEventListener("input", debounce(renderOrders,250));

function renderOrders(){
  if(!tbOrders) return;
  const q = ($("#searchQ")?.value||"").toLowerCase();
  const rows = ORDERS.filter(r=> !q || JSON.stringify(r).toLowerCase().includes(q));
  tbOrders.innerHTML = "";
  const frag = document.createDocumentFragment();
  rows.forEach(r=>{
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>
        <div class="s muted">注番</div>
        <div><b>${r.po_id||""}</b></div>
        <div class="s muted">${r["得意先"]||"—"}</div>
      </td>
      <td>${r["品名"]||"—"}</td>
      <td>${r["品番"]||"—"}</td>
      <td>${r["図番"]||"—"}</td>
      <td>${statusChip(r.status||"")}</td>
      <td>
        <div class="wrap">
          ${procChip(r.current_process||"")}
          <span class="chip" style="background:#e2fbe2">OK: ${numJP(r.ok_count||0)}</span>
          <span class="chip" style="background:#fee2e2">NG: ${numJP(r.ng_count||0)}</span>
        </div>
      </td>
      <td>${fmtTime(r.updated_at)}</td>
      <td>${r.updated_by||"—"}</td>
      <td>
        <div class="wrap">
          <button class="btn s ghost" data-act="qr"   data-po="${r.po_id}"><i class="fa-solid fa-qrcode"></i> 工程QR</button>
          <button class="btn s ghost" data-act="scan" data-po="${r.po_id}"><i class="fa-solid fa-camera"></i> スキャン</button>
          <button class="btn s"       data-act="op"   data-po="${r.po_id}"><i class="fa-regular fa-keyboard"></i> 手入力</button>
          <button class="btn s ghost" data-act="his"  data-po="${r.po_id}"><i class="fa-regular fa-clock"></i> 履歴</button>
        </div>
      </td>`;
    frag.appendChild(tr);
  });
  tbOrders.appendChild(frag);

  tbOrders.onclick = (e)=>{
    const b = e.target.closest("button"); if(!b) return;
    const po = b.dataset.po;
    if(b.dataset.act==="op")  openOpDialog(po);
    if(b.dataset.act==="his") showHistory(po);
    if(b.dataset.act==="scan")openScanDialog(po);
    if(b.dataset.act==="qr")  openStationQrSheet(po);
  };
}

$("#btnExportOrders")?.addEventListener("click", ()=>{
  const head = ["注番","得意先","品名","品番","図番","状態","工程","OK","NG","更新","更新者"];
  const rows = ORDERS.map(r=>[
    r.po_id||"", r["得意先"]||"", r["品名"]||"", r["品番"]||"", r["図番"]||"",
    r.status||"", r.current_process||"", r.ok_count||0, r.ng_count||0,
    fmtTime(r.updated_at), r.updated_by||""
  ]);
  exportXlsx("DashboardOrders", head, rows);
});

/* ==== History ==== */
async function showHistory(po){
  try{
    const h = await jsonp("history",{ po_id: po });
    if(!h || !h.length) return alert("履歴なし");
    const msg = h.map(x=> `${fmtTime(x.timestamp)}｜${x.updated_by||""}｜${x.new_process||""}｜OK:${x.ok_count||0} NG:${x.ng_count||0}｜${x.note||""}`).join("\n");
    alert(msg);
  }catch(err){ alert("履歴取得失敗: "+err.message); }
}

/* ==== Operasi – dialog ==== */
const dlgOp = $("#dlgOp");
$("#btnOpCancel")?.addEventListener("click", ()=> dlgOp.close());
const PROC_LIST = ["準備","レザー加工","曲げ加工","外注加工/組立","組立","検査工程","検査中","検査済","出荷準備","出荷済"];

function openOpDialog(po){
  $("#opPO").textContent = po;
  $("#opProcess").innerHTML = PROC_LIST.map(x=>`<option>${x}</option>`).join("");
  $("#opOK").value = 0; $("#opNG").value = 0; $("#opNote").value = "";
  dlgOp.showModal();
}
$("#btnOpSave")?.addEventListener("click", async ()=>{
  try{
    const po = $("#opPO").textContent.trim();
    const data = {
      po_id: po,
      process: $("#opProcess").value,
      ok_count: Number($("#opOK").value||0),
      ng_count: Number($("#opNG").value||0),
      status: "",
      note: $("#opNote").value||""
    };
    await jsonp("saveOp", { data: JSON.stringify(data), user: JSON.stringify(CURRENT_USER||{}) });
    dlgOp.close();
    bust("listOrders"); refreshDashboard();
  }catch(err){ alert("保存失敗: "+err.message); }
});

/* ========== 8) SALES / PLANS / SHIP / FIN / INV (read + export) ========== */
function buildTable(headEl, bodyEl, data){
  headEl.innerHTML = `<tr>${data.header.map(h=>`<th>${h}</th>`).join("")}</tr>`;
  bodyEl.innerHTML = data.rows.map(r=> `<tr>${r.map(v=>`<td>${(v instanceof Date)?fmtDate(v): (v??"")}</td>`).join("")}</tr>`).join("");
}
function filterTable(qEl, bodyEl){
  const q = (qEl.value||"").toLowerCase();
  [...bodyEl.children].forEach(tr=>{
    const show = tr.textContent.toLowerCase().includes(q);
    tr.style.display = show ? "" : "none";
  });
}
function exportSheet(name, head, rows){ exportXlsx(name, head, rows); }

async function loadSales(){
  setBusy($("#pageSales"), true);
  try{
    const s = await cached("listSales", {}, CACHE_TTL.sheet);
    buildTable($("#thSales"), $("#tbSales"), s);
    $("#salesSearch").oninput = ()=> filterTable($("#salesSearch"), $("#tbSales"));
    $("#btnSalesExport").onclick = ()=> exportSheet("SalesOrders", s.header, s.rows);
  }finally{ setBusy($("#pageSales"), false); }
}
async function loadPlans(){
  setBusy($("#pagePlan"), true);
  try{
    const s = await cached("listPlans", {}, CACHE_TTL.sheet);
    buildTable($("#thPlan"), $("#tbPlan"), s);
    $("#planSearch").oninput = ()=> filterTable($("#planSearch"), $("#tbPlan"));
    $("#btnPlanExport").onclick = ()=> exportSheet("ProductionOrders", s.header, s.rows);
  }finally{ setBusy($("#pagePlan"), false); }
}
async function loadShips(){
  setBusy($("#pageShip"), true);
  try{
    const s = await cached("listShip", {}, CACHE_TTL.sheet);
    buildTable($("#thShip"), $("#tbShip"), s);
    $("#shipSearch").oninput = ()=> filterTable($("#shipSearch"), $("#tbShip"));
    $("#btnShipExport").onclick = ()=> exportSheet("Shipments", s.header, s.rows);
  }finally{ setBusy($("#pageShip"), false); }
}
async function loadFinished(){
  setBusy($("#pageFinished"), true);
  try{
    const s = await cached("listFinished", {}, CACHE_TTL.sheet);
    buildTable($("#thFin"), $("#tbFin"), s);
    $("#finSearch").oninput = ()=> filterTable($("#finSearch"), $("#tbFin"));
    $("#btnFinExport").onclick = ()=> exportSheet("FinishedGoods", s.header, s.rows);
  }finally{ setBusy($("#pageFinished"), false); }
}
async function loadInventory(){
  setBusy($("#pageInv"), true);
  try{
    const s = await cached("listInventory", {}, CACHE_TTL.sheet);
    buildTable($("#thInv"), $("#tbInv"), s);
    $("#invSearch").oninput = ()=> filterTable($("#invSearch"), $("#tbInv"));
    $("#btnInvExport").onclick = ()=> exportSheet("Inventory", s.header, s.rows);
  }finally{ setBusy($("#pageInv"), false); }
}

/* ========== 9) INVOICE (candidates + create + list) ========== */
async function initInvoicePage(){
  setBusy($("#pageInvoice"), true);
  try{
    // masters
    let m = await cached("listMasters", {}, CACHE_TTL.masters);
    const sel = $("#invoiceCustomer");
    sel.innerHTML = `<option value="">(得意先を選択)</option>` + (m.customers||[]).map(c=> `<option>${c}</option>`).join("");
    sel.onchange = reloadInvoiceCandidates;

    // default date today
    $("#invoiceDate").value = new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10);

    $("#btnInvoiceReload").onclick = async ()=>{ await reloadInvoiceCandidates(); await reloadInvoiceList(); };
    $("#btnInvoiceSave").onclick   = saveInvoice;
    $("#btnInvoiceXlsx").onclick   = exportInvoiceExcel;
    $("#btnInvoicePdf").onclick    = printInvoiceHTML;

    await reloadInvoiceCandidates();
    await reloadInvoiceList();
  }catch(err){ alert("請求書画面の初期化に失敗: "+err.message); }
  finally{ setBusy($("#pageInvoice"), false); }
}
async function reloadInvoiceCandidates(){
  const cust = $("#invoiceCustomer").value||"";
  const tbC = $("#tbInvoiceCandidates"); const tbS = $("#tbInvoiceStatus");
  tbC.innerHTML = ""; tbS.innerHTML = "";
  if(!cust) return;

  // gunakan endpoint invoiceCandidates untuk lebih akurat
  const data = await jsonp("invoiceCandidates", { customer: cust });
  const money = (n)=> Number(n||0).toLocaleString('ja-JP');

  (data.pending||[]).forEach(r=>{
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input type="checkbox" class="pick" data-sid="${r.ship_id||''}" data-po="${r.po_id||''}" data-qty="${r.数量||0}" data-unit="${r.単価||0}" data-price="${r.金額||0}" data-item="${r.商品名||''}" data-part="${r.品番||''}" data-ship="${r.出荷日||''}"></td>
      <td>${r.po_id||''}</td><td>${r.商品名||''}</td><td>${r.品番||''}</td>
      <td>${r.数量||0}</td><td>${money(r.単価||0)}</td><td>${money(r.金額||0)}</td><td>${r.出荷日||''}</td>`;
    tbC.appendChild(tr);
  });

  (data.all||[]).forEach(r=>{
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.po_id||''}</td><td>${r.商品名||''}</td><td>${r.品番||''}</td>
      <td>${r.数量||0}</td><td>${money(r.単価||0)}</td><td>${money(r.金額||0)}</td>
      <td>${r.出荷日||''}</td><td>${/済/.test(r.請求書状態||'')? '<span class="chip" style="background:#dcfce7">請求書済</span>':'<span class="chip" style="background:#fee2e2">請求書（未）</span>'}</td>`;
    tbS.appendChild(tr);
  });
}
async function reloadInvoiceList(){
  const list = await cached("listInvoices", {}, CACHE_TTL.invoices);
  const tb = $("#tbInvoiceList"); tb.innerHTML = "";
  (list||[]).forEach(o=>{
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${o.invoice_id||''}</td><td>${o.customer||''}</td><td>${fmtDate(o.issue_date)||''}</td><td>${numJP(o.total||0)}</td><td>${o.filename||''}</td><td>${o.created_by||''}</td>`;
    tb.appendChild(tr);
  });
}
async function saveInvoice(){
  const cust = $("#invoiceCustomer").value||"";
  if(!cust) return alert("得意先を選択してください");
  const issue_date = $("#invoiceDate").value || new Date().toISOString().slice(0,10);
  const items = [...$("#tbInvoiceCandidates").querySelectorAll("input.pick:checked")].map(ch=>{
    return {
      ship_id: ch.dataset.sid||'',
      po_id:   ch.dataset.po||'',
      数量:    Number(ch.dataset.qty||0)||0,
      単価:    Number(ch.dataset.unit||0)||0,
      金額:    Number(ch.dataset.price||0)||0,
      商品名:  ch.dataset.item||'',
      品番:    ch.dataset.part||'',
      出荷日:  ch.dataset.ship||''
    };
  });
  if(!items.length) return alert("明細を選択してください");
  try{
    await jsonp("createInvoice", { data: JSON.stringify({ customer: cust, issue_date, items }), user: JSON.stringify(CURRENT_USER||{}) });
    alert("請求書を作成しました");
    bust("listInvoices"); await reloadInvoiceCandidates(); await reloadInvoiceList();
  }catch(err){ alert("作成失敗: " + err.message); }
}
function exportInvoiceExcel(){
  const rows = [...$("#tbInvoiceCandidates tr")].filter(tr=> tr.querySelector(".pick:checked"))
               .map(tr=> [...tr.children].slice(1).map(td=> td.textContent));
  if(!rows.length) return alert("エクスポート対象がありません");
  const header = ["注番","商品名","品番","数量","単価","金額","出荷日"];
  exportXlsx("請求書明細", header, rows);
}
function printInvoiceHTML(){
  const cust = $("#invoiceCustomer").value || "—";
  const date = $("#invoiceDate").value || new Date().toISOString().slice(0,10);
  const rows = [...$("#tbInvoiceCandidates tr")].filter(tr=> tr.querySelector(".pick:checked"))
               .map(tr=> [...tr.children].slice(1).map(td=> td.textContent));
  if(!rows.length) return alert("印刷対象がありません");
  const total = rows.reduce((s, r)=> s + (Number((r[5]||"").replace(/,/g,""))|| (Number((r[3]||"").replace(/,/g,""))*Number((r[4]||"").replace(/,/g,""))||0)), 0);
  const html = `
  <html><head><meta charset="utf-8"><title>請求書</title>
  <style>
    body{font-family:"Noto Sans JP",system-ui,Roboto,Arial;padding:20px}
    h1{margin:0 0 10px}
    table{width:100%;border-collapse:collapse;font-size:12px;margin-top:8px}
    th,td{border:1px solid #ddd;padding:6px 8px;text-align:left}
    th{background:#f6f7fb}
    .right{text-align:right}
  </style></head>
  <body>
    <h1>請求書</h1>
    <div>得意先: <b>${cust}</b></div>
    <div>発行日: ${fmtDate(date)}</div>
    <table>
      <tr><th>注番</th><th>商品名</th><th>品番</th><th>数量</th><th>単価</th><th>金額</th><th>出荷日</th></tr>
      ${rows.map(r=> `<tr>${r.map((c,i)=> `<td class="${i>=3?'right':''}">${c||''}</td>`).join('')}</tr>`).join('')}
      <tr><td colspan="5" class="right"><b>合計</b></td><td class="right"><b>${numJP(total)}</b></td><td></td></tr>
    </table>
    <script>window.print()</script>
  </body></html>`;
  const w = window.open("about:blank"); w.document.write(html); w.document.close();
}

/* ========== 10) QR SCAN (jsQR) ========== */
const dlgScan = $("#dlgScan"), video=$("#scanVideo"), canvas=$("#scanCanvas");
let stream=null, timer=null;
$("#btnStationQR").onclick = ()=> dlgScan.showModal();
$("#btnScanClose").onclick  = ()=> stopScan();
$("#btnScanStart").onclick  = ()=> startScan();

async function startScan(){
  try{
    stream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:"environment" } });
    video.srcObject = stream; await video.play();
    timer = setInterval(captureAndDecode, 250);
  }catch(err){ alert("カメラにアクセスできません: "+err.message); }
}
function stopScan(){
  if(timer) clearInterval(timer), timer=null;
  if(stream){ stream.getTracks().forEach(t=>t.stop()); stream=null; }
  $("#scanResult").textContent = "—";
  dlgScan.close();
}
function captureAndDecode(){
  const w = video.videoWidth, h = video.videoHeight;
  if(!w || !h) return;
  canvas.width=w; canvas.height=h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(video,0,0,w,h);
  const img = ctx.getImageData(0,0,w,h);
  const code = jsQR(img.data, w, h);
  if(code && code.data){
    $("#scanResult").textContent = code.data;
    const m = /PO[:：]\s*([A-Za-z0-9\-_/]+)/.exec(code.data) || /([A-Za-z0-9]{4,})/.exec(code.data);
    if(m){ stopScan(); openOpDialog(m[1]); }
  }
}

/* ========== 11) CHARTS (Chart.js) ========== */
let dashChart=null;
function drawDashChart(rows){
  const by = {};
  rows.forEach(r=>{ const s=r.status||"—"; by[s]=(by[s]||0)+1; });
  const labels = Object.keys(by), data = Object.values(by);
  const ctx = $("#chartDash"); if(!ctx) return;
  if(dashChart) dashChart.destroy();
  dashChart = new Chart(ctx, {
    type:"bar",
    data:{ labels, datasets:[{ label:"件数", data }] },
    options:{
      plugins:{ legend:{display:false}, datalabels:{anchor:"end",align:"top",formatter:v=>v} },
      scales:{ y:{ beginAtZero:true } }
    }
  });
}
function initAnalytics(){
  // placeholder: kamu bisa tambah graf lain / KPI mini di sini
  show("pageAnalytics");
}

/* ========== 12) XLSX EXPORT ========== */
function exportXlsx(name, head, rows){
  const ws = XLSX.utils.aoa_to_sheet([head, ...rows]);
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  XLSX.writeFile(wb, `${name}_${new Date().toISOString().slice(0,10)}.xlsx`);
}

/* ========== 13) BOOT ========== */
document.addEventListener("DOMContentLoaded", ()=>{
  setUser(null); // start in login mode (nav hidden, light default)
});
