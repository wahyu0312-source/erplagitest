/* ========= CONFIG ========= */
const DEFAULT_API_BASE = "https://script.google.com/macros/s/AKfycbyFPilRpjXxKVlM2Av2LunQJAIJszz9wNX0j1Ab1pbWkZeecIx_QNZwoKQR6XCNGYSLGA/exec"; // ex: https://script.google.com/macros/s/AKfycb.../exec

/* ---- allow override via URL param ?api= ---- */
const urlApi = new URLSearchParams(location.search).get("api");
const API_BASE = urlApi ? decodeURIComponent(urlApi) : DEFAULT_API_BASE;

/* ========= UTIL ========= */
const $  = (q, el=document)=> el.querySelector(q);
const $$ = (q, el=document)=> [...el.querySelectorAll(q)];
const qs = (o)=> Object.entries(o).map(([k,v])=> `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
const fmtDate = (v)=> v? new Date(v).toLocaleDateString("ja-JP") : "";
const fmtTime = (v)=> v? new Date(v).toLocaleString("ja-JP") : "";
const numJP   = (n)=> Number(n||0).toLocaleString("ja-JP");
const idle    = window.requestIdleCallback || ((fn)=> setTimeout(fn,0));
const sleep   = (ms)=> new Promise(r=> setTimeout(r,ms));
function debounce(fn, ms){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; }
function setBusy(scope,on){
  scope.classList.toggle("is-busy", !!on);
  scope.querySelectorAll("button,input,select").forEach(x=> x.disabled=!!on);
}

/* ========= HEALTH CHECK ========= */
(function checkApi(){
  const warn = $("#apiWarn");
  if(!API_BASE || !/script\.google\.com\/macros\/s\//.test(API_BASE) || !/\/exec(\?|$)/.test(API_BASE)){
    warn.classList.remove("hidden");
    warn.innerHTML = `<b>API belum diset</b>. Masukkan URL WebApp GAS <code>/exec</code> ke <code>DEFAULT_API_BASE</code> 
    atau tambahkan <code>?api=URL_EXEC</code> di alamat browser.`;
  }else{
    warn.classList.add("hidden");
  }
})();

/* ========= JSONP + CACHE ========= */
function jsonp(action, params={}){
  return new Promise((resolve, reject)=>{
    if(!API_BASE){ return reject(new Error("API BASE URL is empty")); }
    const cb = "cb_" + Math.random().toString(36).slice(2);
    params = { ...params, action, callback: cb };
    const s = document.createElement("script");
    const url = API_BASE + (API_BASE.includes("?")?"&":"?") + qs(params);
    const timer = setTimeout(()=>{ cleanup(); reject(new Error("API timeout / wrong endpoint")); }, 12000);
    function cleanup(){ try{ delete window[cb]; s.remove(); }catch{} clearTimeout(timer); }
    window[cb] = (resp)=>{ cleanup(); if(resp && resp.ok){ resolve(resp.data); } else { reject(new Error(resp?.error||"API error")); } };
    s.onerror = ()=>{ cleanup(); reject(new Error("JSONP network error / CORS / wrong URL")); };
    s.src = url; document.body.appendChild(s);
  });
}
const _cache = new Map();
async function cached(action, params, ttl){
  const key = action+"::"+JSON.stringify(params||{});
  const now = Date.now();
  const hit = _cache.get(key);
  if(hit && (now-hit.t)<ttl) return hit.v;
  const v = await jsonp(action, params);
  _cache.set(key,{v,t:now});
  return v;
}
function bust(prefix){ [..._cache.keys()].forEach(k=> k.startsWith(prefix) && _cache.delete(k)); }

/* ========= SESSION / NAV ========= */
let CURRENT_USER=null;
function setUser(u){
  CURRENT_USER=u||null;
  $("#topBar").classList.toggle("hidden", !u);
  ["authView","pageDash","pageSales","pagePlan","pageShip","pageFinished","pageInv","pageInvoice","pageAnalytics"]
    .forEach(id=> $("#"+id)?.classList.add("hidden"));
  ["btnToDash","btnToSales","btnToPlan","btnToShip","btnToFinPage","btnToInvPage","btnToInvoice","btnToAnalytics"]
    .forEach(id=> $("#"+id)?.classList.add("hidden"));
  if(!u){ $("#authView").classList.remove("hidden"); return; }
  $("#userInfo").textContent = `${u.full_name||u.username} / ${u.role||u.department||"-"}`;
  ["btnToDash","btnToSales","btnToPlan","btnToShip","btnToFinPage","btnToInvPage","btnToInvoice","btnToAnalytics"]
    .forEach(id=> $("#"+id)?.classList.remove("hidden"));
  show("pageDash"); refreshDashboard();
}
function show(id){
  ["authView","pageDash","pageSales","pagePlan","pageShip","pageFinished","pageInv","pageInvoice","pageAnalytics"]
    .forEach(s=> $("#"+s)?.classList.add("hidden"));
  $("#"+id)?.classList.remove("hidden");
}

/* ========= LOGIN ========= */
$("#btnLogin")?.addEventListener("click", loginSubmit);
$("#inUser")?.addEventListener("keydown", e=> e.key==="Enter" && loginSubmit());
$("#inPass")?.addEventListener("keydown", e=> e.key==="Enter" && loginSubmit());
$("#btnLogout")?.addEventListener("click", ()=> setUser(null));

async function loginSubmit(){
  const username = $("#inUser").value.trim();
  const password = $("#inPass").value.trim();
  if(!username || !password) return alert("ユーザー名・パスワードを入力してください");
  try{
    await Promise.race([jsonp("ping"), sleep(120)]);
    const me = await jsonp("login",{ username, password });
    setUser(me);
    idle(()=> cached("listMasters",{},300000).catch(()=>{}));
    idle(()=> cached("listOrders",{},30000).catch(()=>{}));
  }catch(err){ alert("ログイン失敗: " + err.message); }
}

/* ========= UI HELPERS ========= */
const normalizeProc = (s)=> String(s||"").trim().replace("レーサ加工","レザー加工").replace("外作加工","外注加工/組立");
const chip=(txt,tone="#f1f5f9",icon="fa-regular fa-square")=>`<span class="chip" style="background:${tone}"><i class="${icon}"></i>${txt||"—"}</span>`;
const procChip=(p)=>{p=normalizeProc(p); if(/レザー/.test(p))return chip(p,"#fef3c7","fa-solid fa-bolt");
  if(/曲げ/.test(p))return chip(p,"#e0f2fe","fa-solid fa-wave-square");
  if(/外注|加工/.test(p))return chip(p,"#e2e8f0","fa-solid fa-industry");
  if(/組立/.test(p))return chip(p,"#e9d5ff","fa-solid fa-screwdriver-wrench");
  if(/検査中/.test(p))return chip(p,"#fde68a","fa-regular fa-clipboard");
  if(/検査済/.test(p))return chip(p,"#dcfce7","fa-regular fa-square-check");
  if(/出荷/.test(p))return chip(p,"#cffafe","fa-solid fa-truck"); return chip(p); };
const statusChip=(s)=>{ if(/出荷済/.test(s||""))return chip(s,"#dcfce7","fa-solid fa-truck");
  if(/進行|WIP|作業中/.test(s||""))return chip(s,"#e0f2fe","fa-regular fa-clock");
  if(/停止|中断/.test(s||""))return chip(s,"#fee2e2","fa-solid fa-triangle-exclamation");
  if(/完了|検査済/.test(s||""))return chip(s,"#dcfce7","fa-regular fa-circle-check"); return chip(s||""); };

/* ========= DASHBOARD ========= */
let ORDERS=[]; const tbOrders=$("#tbOrders");
function showSkeleton(container, rows=8, cols=9){
  container.innerHTML="";
  const frag=document.createDocumentFragment();
  for(let i=0;i<rows;i++){ const tr=document.createElement("tr");
    for(let j=0;j<cols;j++){ const td=document.createElement("td"); td.innerHTML=`<div class="skl"></div>`; tr.appendChild(td); }
    frag.appendChild(tr);
  } container.appendChild(frag);
}
async function refreshDashboard(){
  setBusy($("#pageDash"),true); showSkeleton(tbOrders,8,9);
  try{
    ORDERS = await cached("listOrders",{},30000);
    renderOrders(); drawDashChart(ORDERS);
  }catch(err){ alert("読み込み失敗: "+err.message); }
  finally{ setBusy($("#pageDash"),false); }
}
$("#searchQ")?.addEventListener("input", debounce(renderOrders,250));
function renderOrders(){
  const q = ($("#searchQ")?.value||"").toLowerCase();
  const rows = ORDERS.filter(r=> !q || JSON.stringify(r).toLowerCase().includes(q));
  tbOrders.innerHTML="";
  const frag=document.createDocumentFragment();
  rows.forEach(r=>{
    const tr=document.createElement("tr");
    tr.innerHTML=`
      <td><div class="s muted">注番</div><div><b>${r.po_id||""}</b></div><div class="s muted">${r["得意先"]||"—"}</div></td>
      <td>${r["品名"]||"—"}</td><td>${r["品番"]||"—"}</td><td>${r["図番"]||"—"}</td>
      <td>${statusChip(r.status)}</td>
      <td><div class="wrap">${procChip(r.current_process)}<span class="chip" style="background:#e2fbe2">OK: ${numJP(r.ok_count||0)}</span><span class="chip" style="background:#fee2e2">NG: ${numJP(r.ng_count||0)}</span></div></td>
      <td>${fmtTime(r.updated_at)}</td><td>${r.updated_by||"—"}</td>
      <td><div class="wrap">
        <button class="btn s ghost" data-act="qr" data-po="${r.po_id}"><i class="fa-solid fa-qrcode"></i> 工程QR</button>
        <button class="btn s ghost" data-act="scan" data-po="${r.po_id}"><i class="fa-solid fa-camera"></i> スキャン</button>
        <button class="btn s" data-act="op" data-po="${r.po_id}"><i class="fa-regular fa-keyboard"></i> 手入力</button>
        <button class="btn s ghost" data-act="his" data-po="${r.po_id}"><i class="fa-regular fa-clock"></i> 履歴</button>
      </div></td>`;
    frag.appendChild(tr);
  });
  tbOrders.appendChild(frag);
}
$("#btnExportOrders")?.addEventListener("click", ()=>{
  const head=["注番","得意先","品名","品番","図番","状態","工程","OK","NG","更新","更新者"];
  const rows=ORDERS.map(r=>[r.po_id||"",r["得意先"]||"",r["品名"]||"",r["品番"]||"",r["図番"]||"",r.status||"",r.current_process||"",r.ok_count||0,r.ng_count||0,fmtTime(r.updated_at),r.updated_by||""]);
  exportXlsx("DashboardOrders", head, rows);
});
async function showHistory(po){
  try{
    const h = await jsonp("history",{ po_id: po });
    if(!h?.length) return alert("履歴なし");
    alert(h.map(x=> `${fmtTime(x.timestamp)}｜${x.updated_by||""}｜${x.new_process||""}｜OK:${x.ok_count||0} NG:${x.ng_count||0}｜${x.note||""}`).join("\n"));
  }catch(err){ alert("履歴取得失敗: "+err.message); }
}
tbOrders?.addEventListener("click",(e)=>{
  const b=e.target.closest("button"); if(!b) return;
  const po=b.dataset.po; if(b.dataset.act==="op") openOpDialog(po);
  if(b.dataset.act==="his") showHistory(po);
  if(b.dataset.act==="scan") openScanDialog(po);
  if(b.dataset.act==="qr") openStationQrSheet(po);
});

/* ========= OP DIALOG ========= */
const PROC_LIST=["準備","レザー加工","曲げ加工","外注加工/組立","組立","検査工程","検査中","検査済","出荷準備","出荷済"];
$("#btnOpCancel")?.addEventListener("click",()=> $("#dlgOp").close());
function openOpDialog(po){
  $("#opPO").textContent=po;
  $("#opProcess").innerHTML = PROC_LIST.map(x=>`<option>${x}</option>`).join("");
  $("#opOK").value=0; $("#opNG").value=0; $("#opNote").value="";
  $("#dlgOp").showModal();
}
$("#btnOpSave")?.addEventListener("click", async ()=>{
  try{
    const po=$("#opPO").textContent.trim();
    const data={ po_id:po, process:$("#opProcess").value, ok_count:Number($("#opOK").value||0), ng_count:Number($("#opNG").value||0), status:"", note:$("#opNote").value||"" };
    await jsonp("saveOp",{ data: JSON.stringify(data), user: JSON.stringify(CURRENT_USER||{}) });
    $("#dlgOp").close(); bust("listOrders"); refreshDashboard();
  }catch(err){ alert("保存失敗: "+err.message); }
});

/* ========= GENERIC SHEET LOADERS ========= */
function buildTable(th, tb, data){
  th.innerHTML = `<tr>${data.header.map(h=>`<th>${h}</th>`).join("")}</tr>`;
  tb.innerHTML = data.rows.map(r=> `<tr>${r.map(v=> `<td>${(v instanceof Date)?fmtDate(v): (v??"")}</td>`).join("")}</tr>`).join("");
}
function filterTable(qEl, bodyEl){
  const q=(qEl.value||"").toLowerCase();
  [...bodyEl.children].forEach(tr=> tr.style.display = tr.textContent.toLowerCase().includes(q) ? "" : "none");
}
function exportSheet(name, head, rows){ exportXlsx(name, head, rows); }

async function loadSales(){ setBusy($("#pageSales"),true); showSkeleton($("#tbSales"),8,8);
  try{ const s=await cached("listSales",{},30000); buildTable($("#thSales"),$("#tbSales"),s);
    $("#salesSearch").oninput=()=> filterTable($("#salesSearch"), $("#tbSales"));
    $("#btnSalesExport").onclick=()=> exportSheet("SalesOrders",s.header,s.rows);
  }finally{ setBusy($("#pageSales"),false); } }
async function loadPlans(){ setBusy($("#pagePlan"),true); showSkeleton($("#tbPlan"),8,8);
  try{ const s=await cached("listPlans",{},30000); buildTable($("#thPlan"),$("#tbPlan"),s);
    $("#planSearch").oninput=()=> filterTable($("#planSearch"), $("#tbPlan"));
    $("#btnPlanExport").onclick=()=> exportSheet("ProductionOrders",s.header,s.rows);
  }finally{ setBusy($("#pagePlan"),false); } }
async function loadShips(){ setBusy($("#pageShip"),true); showSkeleton($("#tbShip"),8,8);
  try{ const s=await cached("listShip",{},30000); buildTable($("#thShip"),$("#tbShip"),s);
    $("#shipSearch").oninput=()=> filterTable($("#shipSearch"), $("#tbShip"));
    $("#btnShipExport").onclick=()=> exportSheet("Shipments",s.header,s.rows);
  }finally{ setBusy($("#pageShip"),false); } }
async function loadFinished(){ setBusy($("#pageFinished"),true); showSkeleton($("#tbFin"),8,8);
  try{ const s=await cached("listFinished",{},30000); buildTable($("#thFin"),$("#tbFin"),s);
    $("#finSearch").oninput=()=> filterTable($("#finSearch"), $("#tbFin"));
    $("#btnFinExport").onclick=()=> exportSheet("FinishedGoods",s.header,s.rows);
  }finally{ setBusy($("#pageFinished"),false); } }
async function loadInventory(){ setBusy($("#pageInv"),true); showSkeleton($("#tbInv"),8,8);
  try{ const s=await cached("listInventory",{},30000); buildTable($("#thInv"),$("#tbInv"),s);
    $("#invSearch").oninput=()=> filterTable($("#invSearch"), $("#tbInv"));
    $("#btnInvExport").onclick=()=> exportSheet("Inventory",s.header,s.rows);
  }finally{ setBusy($("#pageInv"),false); } }

/* ========= INVOICE ========= */
async function initInvoicePage(){
  setBusy($("#pageInvoice"),true);
  try{
    const m = await cached("listMasters",{},300000);
    const sel=$("#invoiceCustomer");
    sel.innerHTML = `<option value="">(得意先を選択)</option>` + (m.customers||[]).map(c=>`<option>${c}</option>`).join("");
    sel.onchange = reloadInvoiceCandidates;
    $("#invoiceDate").value = new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10);
    $("#btnInvoiceReload").onclick = async ()=>{ await reloadInvoiceCandidates(); await reloadInvoiceList(); };
    $("#btnInvoiceSave").onclick   = saveInvoice;
    $("#btnInvoiceXlsx").onclick   = exportInvoiceExcel;
    $("#btnInvoicePdf").onclick    = printInvoiceHTML;
    await reloadInvoiceCandidates(); await reloadInvoiceList();
  }catch(err){ alert("請求書画面の初期化に失敗: "+err.message); }
  finally{ setBusy($("#pageInvoice"),false); }
}
async function reloadInvoiceCandidates(){
  const cust=$("#invoiceCustomer").value||""; const tbC=$("#tbInvoiceCandidates"); const tbS=$("#tbInvoiceStatus");
  tbC.innerHTML=""; tbS.innerHTML="";
  if(!cust) return;
  const data = await jsonp("invoiceCandidates",{ customer: cust });
  const money=(n)=> Number(n||0).toLocaleString("ja-JP");
  (data.pending||[]).forEach(r=>{
    const tr=document.createElement("tr");
    tr.innerHTML=`<td><input type="checkbox" class="pick" data-sid="${r.ship_id||''}" data-po="${r.po_id||''}" data-qty="${r.数量||0}" data-unit="${r.単価||0}" data-price="${r.金額||0}" data-item="${r.商品名||''}" data-part="${r.品番||''}" data-ship="${r.出荷日||''}"></td>
    <td>${r.po_id||''}</td><td>${r.商品名||''}</td><td>${r.品番||''}</td><td>${r.数量||0}</td><td>${money(r.単価||0)}</td><td>${money(r.金額||0)}</td><td>${r.出荷日||''}</td>`;
    tbC.appendChild(tr);
  });
  (data.all||[]).forEach(r=>{
    const tr=document.createElement("tr");
    tr.innerHTML=`<td>${r.po_id||''}</td><td>${r.商品名||''}</td><td>${r.品番||''}</td><td>${r.数量||0}</td><td>${money(r.単価||0)}</td><td>${money(r.金額||0)}</td><td>${r.出荷日||''}</td><td>${/済/.test(r.請求書状態||'')?'<span class="chip" style="background:#dcfce7">請求書済</span>':'<span class="chip" style="background:#fee2e2">請求書（未）</span>'}</td>`;
    tbS.appendChild(tr);
  });
}
async function reloadInvoiceList(){
  const list = await cached("listInvoices",{},60000);
  const tb=$("#tbInvoiceList"); tb.innerHTML="";
  (list||[]).forEach(o=>{
    const tr=document.createElement("tr");
    tr.innerHTML=`<td>${o.invoice_id||''}</td><td>${o.customer||''}</td><td>${fmtDate(o.issue_date)||''}</td><td>${numJP(o.total||0)}</td><td>${o.filename||''}</td><td>${o.created_by||''}</td>`;
    tb.appendChild(tr);
  });
}
async function saveInvoice(){
  const cust=$("#invoiceCustomer").value||""; if(!cust) return alert("得意先を選択してください");
  const issue_date=$("#invoiceDate").value || new Date().toISOString().slice(0,10);
  const items=[...$("#tbInvoiceCandidates").querySelectorAll("input.pick:checked")].map(ch=>({
    ship_id: ch.dataset.sid||'', po_id: ch.dataset.po||'',
    数量: Number(ch.dataset.qty||0)||0, 単価:Number(ch.dataset.unit||0)||0, 金額:Number(ch.dataset.price||0)||0,
    商品名: ch.dataset.item||'', 品番: ch.dataset.part||'', 出荷日: ch.dataset.ship||''
  }));
  if(!items.length) return alert("明細を選択してください");
  try{
    await jsonp("createInvoice",{ data: JSON.stringify({ customer:cust, issue_date, items }), user: JSON.stringify(CURRENT_USER||{}) });
    alert("請求書を作成しました"); bust("listInvoices"); await reloadInvoiceCandidates(); await reloadInvoiceList();
  }catch(err){ alert("作成失敗: "+err.message); }
}
function exportInvoiceExcel(){
  const rows=[...$("#tbInvoiceCandidates tr")].filter(tr=> tr.querySelector(".pick:checked")).map(tr=> [...tr.children].slice(1).map(td=> td.textContent));
  if(!rows.length) return alert("エクスポート対象がありません");
  const header=["注番","商品名","品番","数量","単価","金額","出荷日"]; exportXlsx("請求書明細", header, rows);
}
function printInvoiceHTML(){
  const cust=$("#invoiceCustomer").value||"—"; const date=$("#invoiceDate").value||new Date().toISOString().slice(0,10);
  const rows=[...$("#tbInvoiceCandidates tr")].filter(tr=> tr.querySelector(".pick:checked")).map(tr=> [...tr.children].slice(1).map(td=> td.textContent));
  if(!rows.length) return alert("印刷対象がありません");
  const total=rows.reduce((s,r)=> s + (Number((r[5]||"").replace(/,/g,"")) || (Number(r[3]||0)*Number(r[4]||0))), 0);
  const html=`<html><head><meta charset="utf-8"><title>請求書</title>
  <style>body{font-family:"Noto Sans JP",system-ui,Arial;padding:20px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #ddd;padding:6px}th{background:#f6f7fb}.r{text-align:right}</style>
  </head><body><h2>請求書</h2><div>得意先: <b>${cust}</b></div><div>発行日: ${fmtDate(date)}</div>
  <table><tr><th>注番</th><th>商品名</th><th>品番</th><th>数量</th><th>単価</th><th>金額</th><th>出荷日</th></tr>
  ${rows.map(r=> `<tr>${r.map((c,i)=> `<td class="${i>=3?'r':''}">${c||''}</td>`).join('')}</tr>`).join('')}
  <tr><td colspan="5" class="r"><b>合計</b></td><td class="r"><b>${numJP(total)}</b></td><td></td></tr></table>
  <script>window.print()</script></body></html>`;
  const w=window.open("about:blank"); w.document.write(html); w.document.close();
}

/* ========= QR SCAN ========= */
const dlgScan=$("#dlgScan"), video=$("#scanVideo"), canvas=$("#scanCanvas"); let stream=null, timer=null;
function openScanDialog(){ dlgScan.showModal(); }
$("#btnScanStart").onclick= startScan; $("#btnScanClose").onclick= stopScan;
async function startScan(){
  try{ stream=await navigator.mediaDevices.getUserMedia({ video:{ facingMode:"environment" }});
    video.srcObject=stream; await video.play(); timer=setInterval(captureAndDecode,250);
  }catch(err){ alert("カメラ不可: "+err.message); }
}
function stopScan(){
  if(timer) clearInterval(timer), timer=null; if(stream){ stream.getTracks().forEach(t=> t.stop()); stream=null; }
  $("#scanResult").textContent="—"; dlgScan.close();
}
function captureAndDecode(){
  const w=video.videoWidth,h=video.videoHeight; if(!w||!h) return;
  canvas.width=w; canvas.height=h; const ctx=canvas.getContext("2d"); ctx.drawImage(video,0,0,w,h);
  const img=ctx.getImageData(0,0,w,h); const code=jsQR(img.data,w,h);
  if(code && code.data){ $("#scanResult").textContent=code.data; const m=/PO[:：]\s*([A-Za-z0-9\-_/]+)/.exec(code.data)||/([A-Za-z0-9]{4,})/.exec(code.data);
    if(m){ stopScan(); openOpDialog(m[1]); } }
}

/* ========= CHARTS ========= */
let dashChart=null;
function drawDashChart(rows){
  const map={}; rows.forEach(r=>{ const s=r.status||"—"; map[s]=(map[s]||0)+1; });
  const labels=Object.keys(map), data=Object.values(map);
  const ctx=$("#chartDash"); if(!ctx) return;
  if(dashChart) dashChart.destroy();
  dashChart=new Chart(ctx,{ type:"bar", data:{ labels, datasets:[{label:"件数", data}]}, options:{ plugins:{legend:{display:false}}, scales:{y:{beginAtZero:true}} }});
}

/* ========= XLSX ========= */
function exportXlsx(name, head, rows){
  const ws=XLSX.utils.aoa_to_sheet([head, ...rows]);
  const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  XLSX.writeFile(wb, `${name}_${new Date().toISOString().slice(0,10)}.xlsx`);
}

/* ========= BOOT ========= */
document.addEventListener("DOMContentLoaded", ()=> { setUser(null); });
