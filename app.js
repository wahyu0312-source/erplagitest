/* =================================================
  App JS — TSH Unified (Dashboard + Forms + QR + Weather + Analytics + Invoice)
  Backend: Google Apps Script JSONP (API_BASE)
================================================= */

// ================== CONFIG ==================
const API_BASE = "https://script.google.com/macros/s/AKfycbyFPilRpjXxKVlM2Av2LunQJAIJszz9wNX0j1Ab1pbWkZeecIx_QNZwoKQR6XCNGYSLGA/exec";

// ================== DOM helpers ==================
const $  = (q, el=document)=> el.querySelector(q);
const $$ = (q, el=document)=> [...el.querySelectorAll(q)];
const qs = (o)=> Object.entries(o).map(([k,v])=>`${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
const fmt= (d)=> d? new Date(d).toLocaleString("ja-JP"):"";

// requestIdleCallback fallback (tanpa ||= di lingkungan lama)
if (typeof window.requestIdleCallback !== "function") {
  window.requestIdleCallback = (cb)=> setTimeout(cb, 0);
}

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
let ORDERS = [];
let SALES = [];
let PLANS = [];
let SHIPS = [];
let FINISHED = [];
let INVENTORY = [];
let INVOICES = [];
let MASTERS = { customers:[], drawings:[], item_names:[], part_nos:[], destinations:[], carriers:[], po_ids:[] };
let CHARTS = {};

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
  // topbar show/hide
  const top = $("#topBar"); if(top) top.classList.toggle("hidden", !u);

  const pages = ["authView","pageDash","pageSales","pagePlan","pageShip","pageFinished","pageInv","pageInvoice","pageAnalytics"];
  pages.forEach(p => $("#"+p) && $("#"+p).classList.add("hidden"));
  ['btnToDash','btnToSales','btnToPlan','btnToShip','btnToFinPage','btnToInvPage','btnToInvoice','btnToAnalytics','btnAddMember','weatherWrap']
    .forEach(id=> $("#"+id) && $("#"+id).classList.add("hidden"));

  if(!u){ $("#authView") && $("#authView").classList.remove("hidden"); return; }

  const allow = ROLE_MAP[u.role] || ROLE_MAP[u.department] || ROLE_MAP['admin'];
  if(allow && allow.nav){
    if(allow.pages.includes('pageDash'))      $("#btnToDash")     && $("#btnToDash").classList.remove("hidden");
    if(allow.pages.includes('pageSales'))     $("#btnToSales")    && $("#btnToSales").classList.remove("hidden");
    if(allow.pages.includes('pagePlan'))      $("#btnToPlan")     && $("#btnToPlan").classList.remove("hidden");
    if(allow.pages.includes('pageShip'))      $("#btnToShip")     && $("#btnToShip").classList.remove("hidden");
    if(allow.pages.includes('pageFinished'))  $("#btnToFinPage")  && $("#btnToFinPage").classList.remove("hidden");
    if(allow.pages.includes('pageInv'))       $("#btnToInvPage")  && $("#btnToInvPage").classList.remove("hidden");
    if(allow.pages.includes('pageInvoice'))   $("#btnToInvoice")  && $("#btnToInvoice").classList.remove("hidden");
    if(allow.pages.includes('pageAnalytics')) $("#btnToAnalytics")&& $("#btnToAnalytics").classList.remove("hidden");
    if(u.role === 'admin' && $("#btnAddMember")) $("#btnAddMember").classList.remove("hidden");
    $("#weatherWrap") && $("#weatherWrap").classList.remove("hidden");
    ensureWeather();
    loadMasters().catch(()=>{});
  }
  show("pageDash");
  refreshAll().catch(()=>{});

  // Warm up cache
  Promise.allSettled([
    cached("listOrders",{},30000),
    cached("listShip",{},30000),
    cached("listPlans",{},30000),
    cached("listFinished",{},30000),
    cached("listInventory",{},30000)
  ]).catch(()=>{});
}

// ================== Nav ==================
function show(id){
  ["authView","pageDash","pageSales","pagePlan","pageShip","pageFinished","pageInv","pageInvoice","pageAnalytics"]
    .forEach(p=> $("#"+p) && $("#"+p).classList.add("hidden"));
  $("#"+id) && $("#"+id).classList.remove("hidden");
}

function setOnClick(selector, handler){
  const el = $(selector);
  if(el) el.onclick = handler;
}
function addEvt(selector, evt, handler){
  const el = $(selector);
  if(el) el.addEventListener(evt, handler);
}

setOnClick("#btnToDash", ()=>{ show("pageDash"); refreshAll(); });
setOnClick("#btnToSales", ()=>{ show("pageSales"); loadSales(); });
setOnClick("#btnToPlan",  ()=>{ show("pagePlan");  loadPlans(); });
setOnClick("#btnToShip",  ()=>{ show("pageShip");  loadShips(); });
setOnClick("#btnToFinPage", ()=>{ show("pageFinished"); loadFinished(); });
setOnClick("#btnToInvPage",  ()=>{ show("pageInv"); loadInventory(); });
setOnClick("#btnToInvoice",  ()=>{ show("pageInvoice"); initInvoicePage(); });
setOnClick("#btnToAnalytics",()=>{ show("pageAnalytics"); initCharts(); });
setOnClick("#btnLogout", ()=>{ 
  try {
    $("#dlgScan") && $("#dlgScan").open && $("#dlgScan").close();
    $("#dlgOp") && $("#dlgOp").open && $("#dlgOp").close();
    $("#dlgAddUser") && $("#dlgAddUser").open && $("#dlgAddUser").close();
  } finally {
    apiCache.clear();
    ORDERS=[]; SALES=[]; PLANS=[]; SHIPS=[]; FINISHED=[]; INVENTORY=[]; INVOICES=[];
    MASTERS={customers:[],drawings:[],item_names:[],part_nos:[],destinations:[],carriers:[],po_ids:[]};
    Object.values(CHARTS).forEach(ch=> { try{ ch.destroy(); }catch{} }); CHARTS={};
    setUser(null);
  }
});

// ================== Login ==================
setOnClick("#btnLogin", loginSubmit);
addEvt("#inUser","keydown", e=>{ if(e.key==='Enter') loginSubmit(); });
addEvt("#inPass","keydown", e=>{ if(e.key==='Enter') loginSubmit(); });

async function loginSubmit(){
  const u = $("#inUser") && $("#inUser").value.trim();
  const p = $("#inPass") && $("#inPass").value.trim();
  if(!u || !p) return alert("ユーザー名 / パスワード を入力してください");
  try{
    const me = await jsonp("login", { username:u, password:p });
    setUser(me);
    $("#inUser") && ($("#inUser").value="");
    $("#inPass") && ($("#inPass").value="");
    $("#btnLogout") && $("#btnLogout").classList.remove("hidden");

    Promise.allSettled([
      cached("listOrders",{},8000),
      cached("listShip",{},8000),
      cached("listPlans",{},8000)
    ]).then(([o,s,p])=>{
      if(o.status==="fulfilled"){ ORDERS = o.value; renderOrders(); }
      if(s.status==="fulfilled"){ SHIPS  = s.value; }
      if(p.status==="fulfilled"){ PLANS  = p.value; }
    }).catch(()=>{});
  }catch(e){
    alert("ログイン失敗: " + (e && e.message ? e.message : e));
  }
}

// ================== DASHBOARD (Orders) ==================
async function loadOrders(){
  const tb = document.getElementById("tbOrders");
  if(tb) tb.innerHTML = `<tr><td colspan="9" class="muted">読み込み中…</td></tr>`;
  try{
    ORDERS = await cached("listOrders",{},15000);
  }catch(e){
    ORDERS = [];
    if(tb) tb.innerHTML = `<tr><td colspan="9" class="muted">データ取得に失敗しました (${e.message||e})</td></tr>`;
    return;
  }
  renderOrders();
  loadShipsMini().catch(()=>{});
}

function renderOrders(){
  const q = ($("#searchQ") && $("#searchQ").value || "").trim().toLowerCase();
  const rows = (ORDERS||[]).filter(r => !q || JSON.stringify(r).toLowerCase().includes(q));
  const tb = $("#tbOrders"); if(!tb) return;
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
      if(!rows.length){
        tb.innerHTML = `<tr><td colspan="9" class="muted">データがありません</td></tr>`;
        return;
      }
    }
  })();
}
addEvt("#searchQ","input", debounce(renderOrders, 250));
setOnClick("#btnExportOrders", ()=> exportTableCSV("#tbOrders","orders.csv"));
async function refreshAll(){ await loadOrders(); }

// ================== SALES ==================
async function loadSales(){
  const rows = ORDERS.length ? ORDERS : await cached("listOrders",{},15000);
  SALES = rows;
  renderGenericTable("#thSales", "#tbSales", rows, [
    "po_id","得意先","品名","品番","図番","status","current_process","ok_count","ng_count","updated_at","updated_by"
  ]);
  attachSearch("#salesSearch","#tbSales");
  setOnClick("#btnSalesExport", ()=> exportTableCSV("#tbSales","sales.csv"));
  setOnClick("#btnSalesPrint", ()=> window.print());
  setOnClick("#btnSalesCreate", ()=> openFormDialog("受注 作成", [
    {key:"po_id", label:"注番"},
    {key:"得意先", label:"得意先"},
    {key:"品名", label:"品名"},
    {key:"品番", label:"品番"},
    {key:"図番", label:"図番"},
  ], async ()=>{ alert("デモ: 作成ハンドラはバックエンド未実装"); }));
}

// ================== PLANS ==================
async function loadPlans(){
  try{ PLANS = await cached("listPlans",{},30000); }catch{ PLANS=[]; }
  renderGenericTable("#thPlan", "#tbPlan", PLANS, ["po_id","工程","開始予定","終了予定","担当","メモ","状態"]);
  attachSearch("#planSearch","#tbPlan");
  setOnClick("#btnPlanExport", ()=> exportTableCSV("#tbPlan","plans.csv"));
  setOnClick("#btnPlanPrint", ()=> window.print());
  setOnClick("#btnPlanCreate", ()=> openFormDialog("生産計画 作成", [
    {key:"po_id",label:"注番"},
    {key:"工程",label:"工程"},
    {key:"開始予定",label:"開始予定"},
    {key:"終了予定",label:"終了予定"},
    {key:"担当",label:"担当"},
    {key:"メモ",label:"メモ"}
  ], async ()=>{ alert("デモ: 作成ハンドラはバックエンド未実装"); }));
}

// ================== SHIPS ==================
async function loadShips(){
  try{ SHIPS = await cached("listShip",{},30000); }catch{ SHIPS=[]; }
  renderGenericTable("#thShip", "#tbShip", SHIPS, ["po_id","得意先","品名","品番","数量","送付先","出荷日","納入日","運送会社","備考","状態"]);
  attachSearch("#shipSearch","#tbShip");
  setOnClick("#btnShipExport", ()=> exportTableCSV("#tbShip","shipments.csv"));
  setOnClick("#btnShipPrint", ()=> window.print());
  setOnClick("#btnPlanCreate", ()=> openFormDialog("生産計画 作成", [
    {key:"po_id",label:"注番"},
    {key:"工程",label:"工程"},
    {key:"開始予定",label:"開始予定"},
    {key:"終了予定",label:"終了予定"},
    {key:"担当",label:"担当"},
    {key:"メモ",label:"メモ"}
  ], async (data)=>{
    if(!data.po_id) throw new Error("注番は必須です");
    await jsonp("savePlan", data);
    alert("保存しました");
    PLANS = await cached("listPlans",{},0);
    renderGenericTable("#thPlan", "#tbPlan", PLANS,
      ["po_id","工程","開始予定","終了予定","担当","メモ","状態"]);
  }));
}
async function loadShipsMini(){
  try{
    const ship = SHIPS.length ? SHIPS : await cached("listShip",{},30000);
    const today = new Date().toISOString().slice(0,10);
    const todayRows = ship.filter(r => String(r['出荷予定日']||r['出荷日']||'').startsWith(today));
    if($("#shipToday")) $("#shipToday").innerHTML = todayRows.length? `${todayRows.length} 件`: `<span class="muted s">—</span>`;
    if($("#shipPlan"))  $("#shipPlan").innerHTML  = ship.length? `${ship.length} 件`: `<span class="muted s">—</span>`;
  }catch(e){
    if($("#shipToday")) $("#shipToday").textContent = "—";
    if($("#shipPlan"))  $("#shipPlan").textContent  = "—";
  }
}

// ================== FINISHED ==================
async function loadFinished(){
  try{ FINISHED = await cached("listFinished",{},30000); }catch{ FINISHED=[]; }
  renderGenericTable("#thFin","#tbFin",FINISHED,["po_id","得意先","品名","品番","数量","完成日","検査","備考"]);
  attachSearch("#finSearch","#tbFin");
  setOnClick("#btnFinExport", ()=> exportTableCSV("#tbFin","finished.csv"));
  setOnClick("#btnFinPrint",  ()=> window.print());
}

// ================== INVENTORY ==================
async function loadInventory(){
  try{ INVENTORY = await cached("listInventory",{},30000); }catch{ INVENTORY=[]; }
  renderGenericTable("#thInv","#tbInv",INVENTORY,["品番","ロット","在庫数","場所","更新日"]);
  attachSearch("#invSearch","#tbInv");
  setOnClick("#btnInvExport", ()=> exportTableCSV("#tbInv","inventory.csv"));
  setOnClick("#btnInvPrint",  ()=> window.print());
}

// ================== GENERIC TABLE RENDERER ==================
function renderGenericTable(thSel, tbSel, rows, cols){
  const th = $(thSel), tb = $(tbSel);
  if(!th || !tb) return;
  th.innerHTML = "<tr>" + cols.map(c=>`<th>${c}</th>`).join("") + "</tr>";
  tb.innerHTML = "";
  const chunk = 200; let i = 0;
  (function paint(){
    const end = Math.min(i+chunk, rows.length);
    const frag = document.createDocumentFragment();
    for(; i<end; i++){
      const r = rows[i];
      const tr = document.createElement("tr");
      tr.innerHTML = cols.map(c=>`<td>${escapeHTML(r[c])}</td>`).join("");
      frag.appendChild(tr);
    }
    tb.appendChild(frag);
    if(i < rows.length) requestIdleCallback(paint);
  })();
}
function attachSearch(inputSel, tbSel){
  const input = $(inputSel), tb = $(tbSel);
  if(!input || !tb) return;
  input.oninput = debounce(()=>{
    const q = (input.value||"").toLowerCase().trim();
    $$("tr", tb).forEach(tr=>{
      const t = tr.textContent.toLowerCase();
      tr.style.display = (!q || t.includes(q)) ? "" : "none";
    });
  }, 200);
}

// ================== INVOICE ==================
async function initInvoicePage(){
  if(!(MASTERS.customers && MASTERS.customers.length)){ try{ await loadMasters(); }catch{} }
  const sel = $("#invoiceCustomer");
  if(sel) sel.innerHTML = `<option value="">(得意先を選択)</option>` + (MASTERS.customers||[]).map(c=>`<option>${c}</option>`).join("");

  try{ INVOICES = await cached("listInvoices",{},15000); }catch{ INVOICES=[]; }
  renderInvoicesList();
  setOnClick("#btnInvoiceReload", buildInvoiceCandidates);
  setOnClick("#btnInvoiceSave",   saveInvoice);
  setOnClick("#btnInvoicePdf",    ()=> alert("PDF出力は端末の印刷機能をご利用ください（またはバックエンド実装が必要）"));
  setOnClick("#btnInvoiceXlsx",   ()=> exportTableCSV("#tbInvoiceCandidates","invoice_candidates.csv"));
}
function renderInvoicesList(){
  const tb = $("#tbInvoiceList"); if(!tb) return;
  tb.innerHTML = "";
  INVOICES.forEach(r=>{
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${r.invoice_no||''}</td><td>${r['得意先']||''}</td><td>${r['発行日']||''}</td><td>${r['合計']||0}</td><td>${r['ファイル名']||''}</td><td>${r['作成者']||''}</td>`;
    tb.appendChild(tr);
  });
}
async function buildInvoiceCandidates(){
  const cust = $("#invoiceCustomer") && $("#invoiceCustomer").value;
  const date = $("#invoiceDate") && $("#invoiceDate").value;
  const tbCand = $("#tbInvoiceCandidates");
  const tbStat = $("#tbInvoiceStatus");
  if(!tbCand || !tbStat) return;
  tbCand.innerHTML = ""; tbStat.innerHTML = "";
  if(!SHIPS.length){ try{ SHIPS = await cached("listShip",{},30000); }catch{ SHIPS=[]; } }

  const rows = SHIPS.filter(r=>{
    const matchCust = !cust || String(r["得意先"]||r["納入先"]||"") === cust;
    const matchDate = !date || String(r["出荷日"]||r["出荷予定日"]||"").startsWith(date);
    return matchCust && matchDate;
  });
  rows.forEach(r=>{
    const tr = document.createElement("tr");
    const qty = Number(r["数量"]||0), price = Number(r["単価"]||0), total = (qty*price)||0;
    tr.innerHTML = `
      <td><input type="checkbox" class="cand-chk" data-po="${escapeHTML(r["po_id"]||'')}" data-name="${escapeHTML(r["品名"]||'')}" data-part="${escapeHTML(r["品番"]||'')}" data-qty="${qty}" data-price="${price}" data-date="${escapeHTML(r["出荷日"]||r["出荷予定日"]||'')}"></td>
      <td>${r["po_id"]||''}</td>
      <td>${r["品名"]||''}</td>
      <td>${r["品番"]||''}</td>
      <td>${qty}</td>
      <td>${price}</td>
      <td>${total}</td>
      <td>${r["出荷日"]||r["出荷予定日"]||''}</td>`;
    tbCand.appendChild(tr);
  });
  const allRows = SHIPS.filter(r=> !cust || (String(r["得意先"]||r["納入先"]||"") === cust));
  allRows.forEach(r=>{
    const tr = document.createElement("tr");
    const qty = Number(r["数量"]||0), price = Number(r["単価"]||0), total = (qty*price)||0;
    tr.innerHTML = `
      <td>${r["po_id"]||''}</td>
      <td>${r["品名"]||''}</td>
      <td>${r["品番"]||''}</td>
      <td>${qty}</td>
      <td>${price}</td>
      <td>${total}</td>
      <td>${r["出荷日"]||r["出荷予定日"]||''}</td>
      <td>${r["状態"]||''}</td>`;
    tbStat.appendChild(tr);
  });
}
async function saveInvoice(){
  const cust = $("#invoiceCustomer") && $("#invoiceCustomer").value;
  const date = ($("#invoiceDate") && $("#invoiceDate").value) || new Date().toISOString().slice(0,10);
  const chks = $$(".cand-chk:checked");
  if(!cust){ alert("得意先を選択してください"); return; }
  if(!chks.length){ alert("候補を選択してください"); return; }
  const items = [...chks].map(c=>({
    po_id: c.dataset.po, 商品名: c.dataset.name, 品番: c.dataset.part,
    数量: Number(c.dataset.qty||0), 単価:Number(c.dataset.price||0),
    金額: Number(c.dataset.qty||0) * Number(c.dataset.price||0),
    出荷日: c.dataset.date || ""
  }));
  const total = items.reduce((s,it)=> s + Number(it.金額||0), 0);
  try{
    const res = await jsonp("saveInvoice", {
      customer: cust, date, total, filename: `INV_${cust}_${date}.pdf`,
      user: JSON.stringify(CURRENT_USER||{}), items: JSON.stringify(items)
    });
    alert(`請求書を保存しました: ${res.invoice_no}`);
    INVOICES = await cached("listInvoices",{},0);
    renderInvoicesList();
  }catch(e){
    alert("請求書保存に失敗: " + (e && e.message ? e.message : e));
  }
}

// ================== ANALYTICS (Chart.js) ==================
function destroyChart(id){ if(CHARTS[id]){ try{ CHARTS[id].destroy(); }catch{}; delete CHARTS[id]; } }
async function initCharts(){
  if(!ORDERS.length){ await loadOrders(); }
  const byMonth = {};
  ORDERS.forEach(r=>{
    const d = (r.updated_at||"").slice(0,7) || "—";
    if(!byMonth[d]) byMonth[d] = { ok:0, ng:0 };
    byMonth[d].ok += Number(r.ok_count||0);
    byMonth[d].ng += Number(r.ng_count||0);
  });
  const labels = Object.keys(byMonth).sort();
  const ok = labels.map(m=> byMonth[m].ok);
  const ng = labels.map(m=> byMonth[m].ng);

  let canvas = $("#analyticsChart");
  if(!canvas){
    const sec = document.createElement("section");
    sec.innerHTML = `<div class="card"><h3 style="margin:0 0 10px">OK / NG 推移</h3><canvas id="analyticsChart" height="120"></canvas></div>`;
    $("#pageAnalytics").appendChild(sec);
    canvas = $("#analyticsChart");
  }

  destroyChart("main");
  CHARTS.main = new Chart(canvas.getContext("2d"), {
    type: "line",
    data: { labels, datasets:[
      { label:"OK", data: ok, tension:.3 },
      { label:"NG", data: ng, tension:.3 }
    ]},
    options:{
      responsive:true,
      plugins:{ legend:{ position:"bottom" } },
      interaction:{ mode:"index", intersect:false },
      scales:{ x:{ title:{display:true, text:"月"} }, y:{ beginAtZero:true } }
    }
  });
}

// ================== MASTERS ==================
async function loadMasters(){ try{ MASTERS = await cached("listMasters", {}, 60000); }catch{} }

// ================== QR / OP DIALOGS ==================
function openStationQrSheet(){ alert("工程QR シートを開きます（実環境のスプレッドシートURLにリンクしてください）"); }
let scanStream=null, scanRAF=null;
function openScanDialog(po){
  if($("#scanResult")) $("#scanResult").textContent = po ? `注番: ${po}` : "—";
  if($("#dlgScan")) $("#dlgScan").showModal();
}
setOnClick("#btnScanClose", ()=> { stopScan(); if($("#dlgScan")) $("#dlgScan").close(); });
setOnClick("#btnScanStart", async ()=>{
  try{
    stopScan();
    const video = $("#scanVideo"), canvas=$("#scanCanvas"), ctx=canvas.getContext("2d");
    scanStream = await navigator.mediaDevices.getUserMedia({video:{facingMode:"environment"}});
    video.srcObject = scanStream; await video.play();
    const loop = ()=>{
      if(!scanStream) return;
      const w = video.videoWidth, h = video.videoHeight;
      if(w && h){
        canvas.width = w; canvas.height = h;
        ctx.drawImage(video, 0, 0, w, h);
        const imgData = ctx.getImageData(0,0,w,h);
        const code = jsQR(imgData.data, w, h);
        if(code && code.data){
          $("#scanResult").textContent = "QR: " + code.data;
        }
      }
      scanRAF = requestAnimationFrame(loop);
    };
    loop();
  }catch(e){ alert("カメラ起動に失敗: " + (e && e.message ? e.message : e)); }
});
function stopScan(){
  try{ if(scanRAF) cancelAnimationFrame(scanRAF); }catch{}
  scanRAF=null;
  try{ scanStream && scanStream.getTracks && scanStream.getTracks().forEach(t=> t.stop()); }catch{}
  scanStream=null;
}
function openOpDialog(po){
  if($("#opPO")) $("#opPO").textContent = po || "—";
  if($("#opOK")) $("#opOK").value = 0;
  if($("#opNG")) $("#opNG").value = 0;
  if($("#opNote")) $("#opNote").value = "";
  const sel = $("#opProcess");
  if(sel) sel.innerHTML = ["切断","レザー加工","曲げ","外注加工/組立","検査","出荷準備","出荷済"].map(x=>`<option>${x}</option>`).join("");
  if($("#dlgOp")) $("#dlgOp").showModal();
}
setOnClick("#btnOpCancel", ()=> $("#dlgOp") && $("#dlgOp").close());
setOnClick("#btnOpSave", async ()=>{
  const payload = {
    po_id: $("#opPO") && $("#opPO").textContent || "",
    process: $("#opProcess") && $("#opProcess").value || "",
    ok: Number($("#opOK") && $("#opOK").value || 0),
    ng: Number($("#opNG") && $("#opNG").value || 0),
    note: $("#opNote") && $("#opNote").value || '',
    user: JSON.stringify(CURRENT_USER||{})
  };
  try{
    await jsonp("saveOp", payload);
    alert("保存しました");
    $("#dlgOp") && $("#dlgOp").close();
    await refreshAll();
  }catch(e){ alert("保存失敗: " + (e && e.message ? e.message : e)); }
});

// ================== ADMIN: ADD MEMBER ==================
function openAddUser(){
  if($("#dlgAddUser")) $("#dlgAddUser").showModal();
  setOnClick("#btnAddUserSave", async ()=>{
    const username = $("#auUser") && $("#auUser").value.trim();
    const password = $("#auPass") && $("#auPass").value.trim();
    const role     = $("#auRole") && $("#auRole").value;
    const department = $("#auDept") && $("#auDept").value.trim();
    const full_name  = $("#auName") && $("#auName").value.trim();
    if(!username || !password) return alert("Username dan Password wajib.");
    try{
      await jsonp("addMember", { data: JSON.stringify({ username, password, role, department, full_name }), user: JSON.stringify(CURRENT_USER||{}) });
      alert("Member berhasil ditambahkan");
      $("#dlgAddUser") && $("#dlgAddUser").close();
      $("#auUser") && ($("#auUser").value = "");
      $("#auPass") && ($("#auPass").value = "");
      $("#auDept") && ($("#auDept").value = "");
      $("#auName") && ($("#auName").value = "");
    }catch(e){ alert("Gagal menambahkan member: " + (e && e.message ? e.message : e)); }
  });
  setOnClick("#btnAddUserCancel", ()=> $("#dlgAddUser") && $("#dlgAddUser").close());
}
setOnClick("#btnAddMember", openAddUser);

// ================== WEATHER (dummy) ==================
async function ensureWeather(){
  if($("#wxTemp"))  $("#wxTemp").textContent = "20℃";
  if($("#wxWind"))  $("#wxWind").textContent = "6 m/s";
  if($("#wxPlace")) $("#wxPlace").textContent = "GMT+9";
}

// ================== FORM DIALOG (Generic) ==================
function openFormDialog(title, fields, onSave){
  if($("#dlgTitle")) $("#dlgTitle").textContent = title;
  const form = $("#formBody"); if(!form) return;
  form.innerHTML = fields.map(f=>`
    <div class="form-item">
      <label>${f.label}</label>
      <input id="f_${f.key}" value="${escapeHTML(f.value||'')}">
    </div>
  `).join("");
  setOnClick("#btnDlgSave", async ()=>{
    const data = {};
    fields.forEach(f=> data[f.key] = $("#f_"+f.key) && $("#f_"+f.key).value);
    try{ await onSave(data); $("#dlgForm") && $("#dlgForm").close(); }catch(e){ alert(e && e.message ? e.message : e); }
  });
  setOnClick("#btnDlgCancel", ()=> $("#dlgForm") && $("#dlgForm").close());
  $("#dlgForm") && $("#dlgForm").showModal();
}

// ================== UTILS ==================
function debounce(fn, wait=250){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), wait); }; }
function exportTableCSV(tbodySel, filename="export.csv"){
  const tb = $(tbodySel); if(!tb) return;
  const rows = [];
  const table = tb.closest("table");
  const ths = $$("thead th", table).map(th => wrapCSV(th.textContent.trim()));
  rows.push(ths.join(","));
  $$("tr", tb).forEach(tr=>{
    const cols = $$("td,th", tr).map(td => wrapCSV((td.textContent||'')));
    rows.push(cols.join(","));
  });
  const blob = new Blob([rows.join("\n")], {type:"text/csv;charset=utf-8;"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
function wrapCSV(s){ s = (s||"").replace(/\r?\n/g," ").replace(/"/g,'""'); return `"${s}"`; }
function escapeHTML(s){ return String(s??"").replace(/[&<>"']/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[m])); }

// ================== INIT ==================
document.addEventListener("DOMContentLoaded", ()=>{
  setUser(null);
  setOnClick("#btnStationQR", openStationQrSheet);
});
