/* ============================================================
  TSH ERP Frontend — FULL (CORS-JSONP SAFE, NO OPTIONAL CHAINING)
  - Semua request ke Apps Script via JSONP (callback=) → lolos CORS
  - Tanpa optional chaining (?.), semua pakai guard aman
  - Semua fitur: Login/Logout, Dashboard, 受注, 生産計画, 出荷予定,
    完成品一覧, 在庫, 請求書, 分析(Chart.js), QR Scan, Admin Add Member
============================================================ */

/* ================== CONFIG ================== */
const API_BASE = "https://script.google.com/macros/s/AKfycbyFPilRpjXxKVlM2Av2LunQJAIJszz9wNX0j1Ab1pbWkZeecIx_QNZwoKQR6XCNGYSLGA/exec";

/* ================== DOM HELPERS ================== */
function $(q, el){ return (el||document).querySelector(q); }
function $$(q, el){ return Array.prototype.slice.call((el||document).querySelectorAll(q)); }
function qs(o){
  var pairs=[], k;
  for(k in o){ if(Object.prototype.hasOwnProperty.call(o,k)){
    pairs.push(encodeURIComponent(k)+"="+encodeURIComponent(o[k]));
  }}
  return pairs.join("&");
}
function fmt(d){ return d? new Date(d).toLocaleString("ja-JP"):""; }
function sleep(ms){ return new Promise(function(r){ setTimeout(r,ms); }); }

/* Polyfill aman */
if (typeof window.requestIdleCallback !== "function") {
  window.requestIdleCallback = function(cb){ return setTimeout(cb, 0); };
}

/* Helper aman set event tanpa optional chaining */
function setOnClick(selector, handler){
  var el = $(selector);
  if(el) el.onclick = handler;
}
function addEvt(selector, evt, handler){
  var el = $(selector);
  if(el) el.addEventListener(evt, handler);
}

/* ================== JSONP & CACHE ================== */
function jsonp(action, params){
  params = params || {};
  return new Promise(function(resolve,reject){
    var cb = "cb_" + Math.random().toString(36).slice(2);
    var clean = function(){
      try{ delete window[cb]; }catch(_){}
      try{ s.parentNode && s.parentNode.removeChild(s); }catch(_){}
      clearTimeout(to);
    };
    params = Object.assign({}, params, { action: action, callback: cb });
    var s = document.createElement("script");
    s.src = API_BASE + "?" + qs(params);
    var to = setTimeout(function(){ clean(); reject(new Error("API timeout")); }, 10000);
    window[cb] = function(resp){
      clean();
      if(resp && resp.ok){ resolve(resp.data); }
      else { reject(new Error((resp && resp.error) ? resp.error : "API error")); }
    };
    s.onerror = function(){ clean(); reject(new Error("JSONP load error")); };
    document.body.appendChild(s);
  });
}

var apiCache = new Map();
async function cached(action, params, ttlMs){
  params = params || {};
  ttlMs = (typeof ttlMs==="number")? ttlMs : 15000;
  var key = action + ":" + JSON.stringify(params);
  var hit = apiCache.get(key);
  var now = Date.now();
  if(hit && now - hit.t < ttlMs) return hit.v;
  var v = await jsonp(action, params);
  apiCache.set(key, {v:v, t:now});
  return v;
}

/* ================== STATE ================== */
var CURRENT_USER = null;
var ORDERS = [];
var SALES = [];
var PLANS = [];
var SHIPS = [];
var FINISHED = [];
var INVENTORY = [];
var INVOICES = [];
var MASTERS = { customers:[], drawings:[], item_names:[], part_nos:[], destinations:[], carriers:[], po_ids:[] };
var CHARTS = {};

var ROLE_MAP = {
  'admin': { pages:['pageDash','pageSales','pagePlan','pageShip','pageFinished','pageInv','pageInvoice','pageAnalytics'], nav:true },
  '営業': { pages:['pageSales','pageDash','pageFinished','pageInv','pageInvoice','pageAnalytics'], nav:true },
  '生産管理': { pages:['pagePlan','pageShip','pageDash','pageFinished','pageInv','pageInvoice','pageAnalytics'], nav:true },
  '生産管理部': { pages:['pagePlan','pageShip','pageDash','pageFinished','pageInv','pageInvoice','pageAnalytics'], nav:true },
  '製造': { pages:['pageDash','pageFinished','pageInv','pageAnalytics'], nav:true },
  '検査': { pages:['pageDash','pageFinished','pageInv','pageAnalytics'], nav:true }
};

/* ================== ROLE & NAV ================== */
function safeText(el, text){
  if(el) el.textContent = text;
}
function setUser(u){
  CURRENT_USER = u || null;
  if(document && document.body){
    document.body.classList.toggle("auth", !u);
  }
  safeText($("#userInfo"), u ? ((u.role||'') + " / " + (u.department||'')) : "");

  // Reset vis menu
  var buttons = ['btnToDash','btnToSales','btnToPlan','btnToShip','btnToFinPage','btnToInvPage','btnToInvoice','btnToAnalytics'];
  buttons.forEach(function(id){
    var b = $("#"+id); if(b) b.classList.add("hidden");
  });
  var bl = $("#btnLogout"); if(bl) bl.classList.toggle("hidden", !u);
  var ww = $("#weatherWrap"); if(ww) ww.classList.toggle("hidden", !u);
  var bam = $("#btnAddMember"); if(bam) bam.classList.add("hidden");

  // Hide semua pages
  $$("section[id^='page']").forEach(function(el){ el.classList.add("hidden"); });
  var av = $("#authView"); if(av) av.classList.toggle("hidden", !!u);

  if(!u){ return; }

  var allow = ROLE_MAP[u.role] || ROLE_MAP[u.department] || ROLE_MAP['admin'];
  if(allow && allow.nav){
    if(allow.pages.indexOf('pageDash')>=0) $("#btnToDash").classList.remove("hidden");
    if(allow.pages.indexOf('pageSales')>=0) $("#btnToSales").classList.remove("hidden");
    if(allow.pages.indexOf('pagePlan')>=0)  $("#btnToPlan").classList.remove("hidden");
    if(allow.pages.indexOf('pageShip')>=0)  $("#btnToShip").classList.remove("hidden");
    if(allow.pages.indexOf('pageFinished')>=0) $("#btnToFinPage").classList.remove("hidden");
    if(allow.pages.indexOf('pageInv')>=0) $("#btnToInvPage").classList.remove("hidden");
    if(allow.pages.indexOf('pageInvoice')>=0) $("#btnToInvoice").classList.remove("hidden");
    if(allow.pages.indexOf('pageAnalytics')>=0) $("#btnToAnalytics").classList.remove("hidden");
    if(u.role === 'admin' && $("#btnAddMember")) $("#btnAddMember").classList.remove("hidden");
  }
  requestIdleCallback(function(){ ensureWeather(); loadMasters()["catch"](function(){}); });

  show("pageDash");
  refreshAll()["catch"](function(){});
}

function show(id){
  $$("section[id^='page']").forEach(function(el){ el.classList.add("hidden"); });
  var sec = $("#"+id); if(sec) sec.classList.remove("hidden");
}
setOnClick("#btnToDash", function(){ show("pageDash"); refreshAll(); });
setOnClick("#btnToSales", function(){ show("pageSales"); loadSales(); });
setOnClick("#btnToPlan",  function(){ show("pagePlan");  loadPlans(); });
setOnClick("#btnToShip",  function(){ show("pageShip");  loadShips(); });
setOnClick("#btnToFinPage", function(){ show("pageFinished"); loadFinished(); });
setOnClick("#btnToInvPage",  function(){ show("pageInv"); loadInventory(); });
setOnClick("#btnToInvoice",  function(){ show("pageInvoice"); initInvoicePage(); });
setOnClick("#btnToAnalytics",function(){ show("pageAnalytics"); initCharts(); });

/* ================== AUTH ================== */
setOnClick("#btnLogin", loginSubmit);
addEvt("#inUser","keydown", function(e){ if(e.key==='Enter') loginSubmit(); });
addEvt("#inPass","keydown", function(e){ if(e.key==='Enter') loginSubmit(); });

async function loginSubmit(){
  var uEl = $("#inUser"), pEl=$("#inPass");
  var u = uEl? uEl.value.trim() : "";
  var p = pEl? pEl.value.trim() : "";
  if(!u || !p) { alert("ユーザー名 / パスワード を入力してください"); return; }
  try{
    var me = await jsonp("login", { username:u, password:p });
    setUser(me);
    if(uEl) uEl.value="";
    if(pEl) pEl.value="";
    var lo = $("#btnLogout"); if(lo) lo.classList.remove("hidden");
    // prefetch
    Promise.allSettled([
      cached("listOrders",{},8000),
      cached("listShip",{},8000),
      cached("listPlans",{},8000)
    ]).then(function(r){
      var o=r[0], s=r[1], pl=r[2];
      if(o && o.status==="fulfilled"){ ORDERS = o.value; renderOrders(); }
      if(s && s.status==="fulfilled"){ SHIPS  = s.value; }
      if(pl && pl.status==="fulfilled"){ PLANS  = pl.value; }
    });
  }catch(e){
    alert("ログイン失敗: " + (e && e.message ? e.message : e));
  }
}

setOnClick("#btnLogout", async function(){
  try {
    var dlg1=$("#dlgScan"), dlg2=$("#dlgOp"), dlg3=$("#dlgAddUser");
    if(dlg1 && dlg1.open) dlg1.close();
    if(dlg2 && dlg2.open) dlg2.close();
    if(dlg3 && dlg3.open) dlg3.close();
  } finally {
    apiCache.clear();
    ORDERS = []; SALES=[]; PLANS=[]; SHIPS=[]; FINISHED=[]; INVENTORY=[]; INVOICES=[];
    MASTERS = {customers:[], drawings:[], item_names:[], part_nos:[], destinations:[], carriers:[], po_ids:[]};
    Object.keys(CHARTS).forEach(function(k){ try{ CHARTS[k].destroy(); }catch(_){ } delete CHARTS[k]; });
    setUser(null);
  }
});

/* ================== DASHBOARD (Orders) ================== */
async function loadOrders(){
  var tb = document.getElementById("tbOrders");
  if(tb) tb.innerHTML = '<tr><td colspan="9" class="muted">読み込み中…</td></tr>';
  try{
    ORDERS = await cached("listOrders",{},15000);
  }catch(e){
    ORDERS = [];
    if(tb) tb.innerHTML = '<tr><td colspan="9" class="muted">データ取得に失敗しました ('+( (e && e.message) ? e.message : e )+')</td></tr>';
    return;
  }
  renderOrders();
  loadShipsMini()["catch"](function(){});
}

function renderOrders(){
  var qEl = $("#searchQ");
  var q = (qEl && qEl.value ? qEl.value : "").trim().toLowerCase();
  var rows = (ORDERS||[]).filter(function(r){
    return !q || JSON.stringify(r).toLowerCase().indexOf(q)>=0;
  });
  var tb = $("#tbOrders"); if(!tb) return;
  tb.innerHTML = "";
  var chunk = 120; var i = 0;
  (function paint(){
    var end = Math.min(i+chunk, rows.length);
    var frag = document.createDocumentFragment();
    for(; i<end; i++){
      var r = rows[i];
      var tr = document.createElement("tr");
      var ok = (r.ok_count != null ? r.ok_count : 0);
      var ng = (r.ng_count != null ? r.ng_count : 0);
      tr.innerHTML = [
        '<td>',
          '<div class="s muted">注番</div>',
          '<div><b>', (r.po_id||""), '</b></div>',
          '<div class="muted s">', (r["得意先"]||"—"), '</div>',
        '</td>',
        '<td>', (r["品名"]||"—"), '</td>',
        '<td>', (r["品番"]||"—"), '</td>',
        '<td>', (r["図番"]||"—"), '</td>',
        '<td class="center">', statusToBadge(r.status), '</td>',
        '<td class="center">',
          '<div class="cell-stack">',
            procToChip(r.current_process),
            '<div class="row">',
              '<span class="chip" style="background:#e2fbe2">OK:', ok, '</span>',
              '<span class="chip" style="background:#ffe4e6">NG:', ng, '</span>',
            '</div>',
          '</div>',
        '</td>',
        '<td class="center">', fmt(r.updated_at), '</td>',
        '<td class="center">', (r.updated_by||"—"), '</td>',
        '<td class="center">',
          '<div class="row">',
            '<button class="btn ghost btn-stqr" title="工程QR"><i class="fa-solid fa-qrcode"></i> 工程QR</button>',
            '<button class="btn ghost btn-scan" data-po="', (r.po_id||""), '" title="スキャン"><i class="fa-solid fa-camera"></i> スキャン</button>',
            '<button class="btn ghost btn-op" data-po="', (r.po_id||""), '" title="手入力"><i class="fa-solid fa-keyboard"></i> 手入力</button>',
          '</div>',
        '</td>'
      ].join("");
      frag.appendChild(tr);
    }
    tb.appendChild(frag);
    if(i < rows.length) { requestIdleCallback(paint); }
    if(i>=rows.length){
      $$(".btn-stqr",tb).forEach(function(b){ b.onclick = openStationQrSheet; });
      $$(".btn-scan",tb).forEach(function(b){ b.onclick=function(e){ var t=e.currentTarget; openScanDialog(t && t.dataset ? t.dataset.po : ""); }; });
      $$(".btn-op",tb).forEach(function(b){ b.onclick=function(e){ var t=e.currentTarget; openOpDialog(t && t.dataset ? t.dataset.po : ""); }; });
      if(!rows.length){
        tb.innerHTML = '<tr><td colspan="9" class="muted">データがありません</td></tr>';
        return;
      }
    }
  })();
}
addEvt("#searchQ","input", debounce(renderOrders, 250));
setOnClick("#btnExportOrders", function(){ exportTableCSV("#tbOrders","orders.csv"); });
async function refreshAll(){ await loadOrders(); }

/* ================== HELPERS BADGE/CHIP ================== */
function normalizeProc(s){
  s = String(s||"").trim()
    .replace("レーサ加工","レザー加工")
    .replace("外作加工","外注加工/組立");
  return s || "未設定";
}
function procToChip(p){
  p = normalizeProc(p);
  if(/レザー加工|レーザー/.test(p)) return '<span class="chip" style="background:#fef3c7"><i class="fa-solid fa-bolt"></i>'+p+'</span>';
  if(/曲げ/.test(p)) return '<span class="chip" style="background:#e0f2fe"><i class="fa-solid fa-wave-square"></i>'+p+'</span>';
  if(/外注加工|加工/.test(p)) return '<span class="chip" style="background:#e2e8f0"><i class="fa-solid fa-compass-drafting"></i>'+p+'</span>';
  if(/組立/.test(p)) return '<span class="chip" style="background:#e9d5ff"><i class="fa-solid fa-screwdriver-wrench"></i>'+p+'</span>';
  if(/検査/.test(p)) return '<span class="chip" style="background:#dcfce7"><i class="fa-regular fa-square-check"></i>'+p+'</span>';
  return '<span class="chip"><i class="fa-regular fa-square"></i>'+ (p||'—') +'</span>';
}
function statusToBadge(s){
  s = String(s||"");
  if(/組立中/.test(s)) return '<span class="chip"><i class="fa-solid fa-screwdriver-wrench"></i>'+s+'</span>';
  if(/組立済/.test(s)) return '<span class="chip"><i class="fa-regular fa-circle-check"></i>'+s+'</span>';
  if(/検査中/.test(s)) return '<span class="chip"><i class="fa-regular fa-clipboard"></i>'+s+'</span>';
  if(/検査済/.test(s)) return '<span class="chip"><i class="fa-regular fa-circle-check"></i>'+s+'</span>';
  if(/出荷準備/.test(s)) return '<span class="chip"><i class="fa-solid fa-box-open"></i>'+s+'</span>';
  if(/出荷済/.test(s)) return '<span class="chip"><i class="fa-solid fa-truck"></i>'+s+'</span>';
  return '<span class="chip"><i class="fa-regular fa-clock"></i>'+ (s||"—") +'</span>';
}

/* ================== SALES ================== */
async function loadSales(){
  var rows;
  try{
    rows = ORDERS.length ? ORDERS : await cached("listOrders",{},15000);
  }catch(_){ rows = []; }
  SALES = rows;
  renderGenericTable("#thSales", "#tbSales", rows, [
    "po_id","得意先","品名","品番","図番","status","current_process","ok_count","ng_count","updated_at","updated_by"
  ]);
  attachSearch("#salesSearch","#tbSales");
  setOnClick("#btnSalesExport", function(){ exportTableCSV("#tbSales","sales.csv"); });
  setOnClick("#btnSalesPrint", function(){ window.print(); });
  setOnClick("#btnSalesCreate", function(){ openFormDialog("受注 作成", [
    {key:"po_id", label:"注番"},
    {key:"得意先", label:"得意先"},
    {key:"品名", label:"品名"},
    {key:"品番", label:"品番"},
    {key:"図番", label:"図番"}
  ], async function(){ alert("デモ: 作成ハンドラはバックエンド未実装"); }); });
}

/* ================== PLANS ================== */
async function loadPlans(){
  try{ PLANS = await cached("listPlans",{},30000); }catch(_){ PLANS=[]; }
  renderGenericTable("#thPlan", "#tbPlan", PLANS, ["po_id","工程","開始予定","終了予定","担当","メモ","状態"]);
  attachSearch("#planSearch","#tbPlan");
  setOnClick("#btnPlanExport", function(){ exportTableCSV("#tbPlan","plans.csv"); });
  setOnClick("#btnPlanPrint", function(){ window.print(); });
  setOnClick("#btnPlanCreate", function(){ openFormDialog("生産計画 作成", [
    {key:"po_id",label:"注番"},
    {key:"工程",label:"工程"},
    {key:"開始予定",label:"開始予定"},
    {key:"終了予定",label:"終了予定"},
    {key:"担当",label:"担当"},
    {key:"メモ",label:"メモ"}
  ], async function(){ alert("デモ: 作成ハンドラはバックエンド未実装"); }); });
}

/* ================== SHIPS ================== */
async function loadShips(){
  try{ SHIPS = await cached("listShip",{},30000); }catch(_){ SHIPS=[]; }
  renderGenericTable("#thShip", "#tbShip", SHIPS,
    ["po_id","得意先","品名","品番","数量","送付先","出荷日","納入日","運送会社","備考","状態"]);
  attachSearch("#shipSearch","#tbShip");
  setOnClick("#btnShipExport", function(){ exportTableCSV("#tbShip","shipments.csv"); });
  setOnClick("#btnShipPrint", function(){ window.print(); });
  // demo membuat plan dari Ship
  setOnClick("#btnPlanCreate", function(){ openFormDialog("生産計画 作成", [
    {key:"po_id",label:"注番"},
    {key:"工程",label:"工程"},
    {key:"開始予定",label:"開始予定"},
    {key:"終了予定",label:"終了予定"},
    {key:"担当",label:"担当"},
    {key:"メモ",label:"メモ"}
  ], async function(data){
    if(!data.po_id) throw new Error("注番は必須です");
    await jsonp("savePlan", data);
    alert("保存しました");
    PLANS = await cached("listPlans",{},0);
    renderGenericTable("#thPlan", "#tbPlan", PLANS,
      ["po_id","工程","開始予定","終了予定","担当","メモ","状態"]);
  }); });
}
async function loadShipsMini(){
  try{
    var ship = SHIPS.length ? SHIPS : await cached("listShip",{},30000);
    var today = new Date().toISOString().slice(0,10);
    var todayRows = ship.filter(function(r){
      var s = String(r['出荷予定日']||r['出荷日']||'');
      return s.indexOf(today)===0;
    });
    var st=$("#shipToday"), sp=$("#shipPlan");
    if(st) st.textContent = todayRows.length? (todayRows.length+" 件"): "—";
    if(sp) sp.textContent  = ship.length? (ship.length+" 件"): "—";
  }catch(_){
    var st2=$("#shipToday"), sp2=$("#shipPlan");
    if(st2) st2.textContent = "—";
    if(sp2) sp2.textContent = "—";
  }
}

/* ================== FINISHED ================== */
async function loadFinished(){
  try{ FINISHED = await cached("listFinished",{},30000); }catch(_){ FINISHED=[]; }
  renderGenericTable("#thFin","#tbFin",FINISHED,["po_id","得意先","品名","品番","数量","完成日","検査","備考"]);
  attachSearch("#finSearch","#tbFin");
  setOnClick("#btnFinExport", function(){ exportTableCSV("#tbFin","finished.csv"); });
  setOnClick("#btnFinPrint", function(){ window.print(); });
}

/* ================== INVENTORY ================== */
async function loadInventory(){
  try{ INVENTORY = await cached("listInventory",{},30000); }catch(_){ INVENTORY=[]; }
  renderGenericTable("#thInv","#tbInv",INVENTORY,["品番","ロット","在庫数","場所","更新日"]);
  attachSearch("#invSearch","#tbInv");
  setOnClick("#btnInvExport", function(){ exportTableCSV("#tbInv","inventory.csv"); });
  setOnClick("#btnInvPrint", function(){ window.print(); });
}

/* ================== GENERIC TABLE RENDERER ================== */
function renderGenericTable(thSel, tbSel, rows, cols){
  var th = $(thSel), tb = $(tbSel);
  if(!th || !tb) return;
  th.innerHTML = "<tr>" + cols.map(function(c){ return "<th>"+c+"</th>"; }).join("") + "</tr>";
  tb.innerHTML = "";
  var chunk = 200; var i = 0;
  (function paint(){
    var end = Math.min(i+chunk, rows.length);
    var frag = document.createDocumentFragment();
    for(; i<end; i++){
      var r = rows[i];
      var tr = document.createElement("tr");
      tr.innerHTML = cols.map(function(c){
        return "<td>"+escapeHTML(r[c])+"</td>";
      }).join("");
      frag.appendChild(tr);
    }
    tb.appendChild(frag);
    if(i < rows.length) requestIdleCallback(paint);
  })();
}
function attachSearch(inputSel, tbSel){
  var input = $(inputSel), tb = $(tbSel);
  if(!input || !tb) return;
  input.oninput = debounce(function(){
    var q = (input.value||"").toLowerCase().trim();
    $$("tr", tb).forEach(function(tr){
      var t = (tr.textContent||"").toLowerCase();
      tr.style.display = (!q || t.indexOf(q)>=0) ? "" : "none";
    });
  }, 200);
}

/* ================== INVOICE ================== */
async function initInvoicePage(){
  if(!(MASTERS && MASTERS.customers && MASTERS.customers.length)){
    try{ await loadMasters(); }catch(_){}
  }
  var sel = $("#invoiceCustomer");
  if(sel){
    var opt = '<option value="">(得意先を選択)</option>' +
      ( (MASTERS.customers||[]).map(function(c){ return '<option>'+c+'</option>'; }).join("") );
    sel.innerHTML = opt;
  }
  try{ INVOICES = await cached("listInvoices",{},15000); }catch(_){ INVOICES=[]; }
  renderInvoicesList();
  setOnClick("#btnInvoiceReload", buildInvoiceCandidates);
  setOnClick("#btnInvoiceSave",   saveInvoice);
  setOnClick("#btnInvoicePdf",    function(){ alert("PDF出力は端末の印刷機能をご利用ください（またはバックエンド実装が必要）"); });
  setOnClick("#btnInvoiceXlsx",   function(){ exportTableCSV("#tbInvoiceCandidates","invoice_candidates.csv"); });
}
function renderInvoicesList(){
  var tb = $("#tbInvoiceList"); if(!tb) return;
  tb.innerHTML = "";
  (INVOICES||[]).forEach(function(r){
    var tr = document.createElement("tr");
    tr.innerHTML =
      "<td>"+(r.invoice_no||'')+"</td>"+
      "<td>"+(r['得意先']||'')+"</td>"+
      "<td>"+(r['発行日']||'')+"</td>"+
      "<td>"+(r['合計']||0)+"</td>"+
      "<td>"+(r['ファイル名']||'')+"</td>"+
      "<td>"+(r['作成者']||'')+"</td>";
    tb.appendChild(tr);
  });
}
async function buildInvoiceCandidates(){
  var custEl=$("#invoiceCustomer"), dateEl=$("#invoiceDate");
  var cust = custEl ? custEl.value : "";
  var date = dateEl ? dateEl.value : "";
  var tbCand = $("#tbInvoiceCandidates");
  var tbStat = $("#tbInvoiceStatus");
  if(!tbCand || !tbStat) return;
  tbCand.innerHTML = ""; tbStat.innerHTML = "";
  if(!SHIPS.length){ try{ SHIPS = await cached("listShip",{},30000); }catch(_){ SHIPS=[]; } }

  var rows = SHIPS.filter(function(r){
    var matchCust = !cust || String(r["得意先"]||r["納入先"]||"") === cust;
    var dt = String(r["出荷日"]||r["出荷予定日"]||"");
    var matchDate = !date || dt.indexOf(date)===0;
    return matchCust && matchDate;
  });
  rows.forEach(function(r){
    var tr = document.createElement("tr");
    var qty = Number(r["数量"]||0), price = Number(r["単価"]||0), total = (qty*price)||0;
    tr.innerHTML =
      '<td><input type="checkbox" class="cand-chk" '+
        'data-po="'+escapeHTML(r["po_id"]||'')+'" '+
        'data-name="'+escapeHTML(r["品名"]||'')+'" '+
        'data-part="'+escapeHTML(r["品番"]||'')+'" '+
        'data-qty="'+qty+'" data-price="'+price+'" '+
        'data-date="'+escapeHTML(r["出荷日"]||r["出荷予定日"]||'')+'"></td>'+
      '<td>'+ (r["po_id"]||'') +'</td>'+
      '<td>'+ (r["品名"]||'') +'</td>'+
      '<td>'+ (r["品番"]||'') +'</td>'+
      '<td>'+ qty +'</td>'+
      '<td>'+ price +'</td>'+
      '<td>'+ total +'</td>'+
      '<td>'+ (r["出荷日"]||r["出荷予定日"]||'') +'</td>';
    tbCand.appendChild(tr);
  });
  var allRows = SHIPS.filter(function(r){ return !cust || String(r["得意先"]||r["納入先"]||"") === cust; });
  allRows.forEach(function(r){
    var tr = document.createElement("tr");
    var qty = Number(r["数量"]||0), price = Number(r["単価"]||0), total = (qty*price)||0;
    tr.innerHTML =
      '<td>'+ (r["po_id"]||'') +'</td>'+
      '<td>'+ (r["品名"]||'') +'</td>'+
      '<td>'+ (r["品番"]||'') +'</td>'+
      '<td>'+ qty +'</td>'+
      '<td>'+ price +'</td>'+
      '<td>'+ total +'</td>'+
      '<td>'+ (r["出荷日"]||r["出荷予定日"]||'') +'</td>'+
      '<td>'+ (r["状態"]||'') +'</td>';
    tbStat.appendChild(tr);
  });
}
async function saveInvoice(){
  var custEl=$("#invoiceCustomer"), dateEl=$("#invoiceDate");
  var cust = custEl ? custEl.value : "";
  var date = dateEl ? dateEl.value : new Date().toISOString().slice(0,10);
  var chks = $$(".cand-chk:checked");
  if(!cust){ alert("得意先を選択してください"); return; }
  if(!chks.length){ alert("候補を選択してください"); return; }
  var items = Array.prototype.map.call(chks, function(c){
    return {
      po_id: c.dataset.po, 商品名: c.dataset.name, 品番: c.dataset.part,
      数量: Number(c.dataset.qty||0), 単価:Number(c.dataset.price||0),
      金額: (Number(c.dataset.qty||0) * Number(c.dataset.price||0)),
      出荷日: c.dataset.date || ""
    };
  });
  var total = items.reduce(function(s,it){ return s + Number(it.金額||0); }, 0);
  try{
    var res = await jsonp("saveInvoice", {
      customer: cust, date: date, total: total, filename: ("INV_"+cust+"_"+date+".pdf"),
      user: JSON.stringify(CURRENT_USER||{}), items: JSON.stringify(items)
    });
    alert("請求書を保存しました: " + res.invoice_no);
    INVOICES = await cached("listInvoices",{},0);
    renderInvoicesList();
  }catch(e){
    alert("請求書保存に失敗: " + (e && e.message ? e.message : e));
  }
}

/* ================== ANALYTICS (Chart.js) ================== */
function destroyChart(id){ if(CHARTS[id]){ try{ CHARTS[id].destroy(); }catch(_){ } delete CHARTS[id]; } }
async function initCharts(){
  if(!ORDERS.length){ await loadOrders(); }
  var byMonth = {};
  ORDERS.forEach(function(r){
    var d = (r.updated_at||"").slice(0,7) || "—";
    if(!byMonth[d]) byMonth[d] = { ok:0, ng:0 };
    byMonth[d].ok += Number(r.ok_count||0);
    byMonth[d].ng += Number(r.ng_count||0);
  });
  var labels = Object.keys(byMonth).sort();
  var ok = labels.map(function(m){ return byMonth[m].ok; });
  var ng = labels.map(function(m){ return byMonth[m].ng; });

  var canvas = $("#analyticsChart");
  if(!canvas){
    var sec = document.createElement("section");
    sec.innerHTML = '<div class="card"><h3 style="margin:0 0 10px">OK / NG 推移</h3><canvas id="analyticsChart" height="120"></canvas></div>';
    var host=$("#pageAnalytics"); if(host) host.appendChild(sec);
    canvas = $("#analyticsChart");
  }

  destroyChart("main");
  if(window.Chart && canvas && canvas.getContext){
    CHARTS.main = new Chart(canvas.getContext("2d"), {
      type: "line",
      data: { labels:labels, datasets:[
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
}

/* ================== MASTERS ================== */
async function loadMasters(){
  try{ MASTERS = await cached("listMasters", {}, 60000); }catch(_){}
}

/* ================== QR / OP DIALOGS ================== */
function openStationQrSheet(){ alert("工程QR シートを開きます（実環境のスプレッドシートURLにリンクしてください）"); }
var scanStream=null, scanRAF=null;
function openScanDialog(po){
  var sr = $("#scanResult");
  if(sr) sr.textContent = po ? ("注番: " + po) : "—";
  var d=$("#dlgScan"); if(d) d.showModal();
}
setOnClick("#btnScanClose", function(){ stopScan(); var d=$("#dlgScan"); if(d) d.close(); });
setOnClick("#btnScanStart", async function(){
  try{
    stopScan();
    var video = $("#scanVideo"), canvas=$("#scanCanvas");
    if(!video || !canvas) return;
    var ctx=canvas.getContext("2d");
    scanStream = await navigator.mediaDevices.getUserMedia({video:{facingMode:"environment"}});
    video.srcObject = scanStream; await video.play();
    var loop = function(){
      if(!scanStream) return;
      var w = video.videoWidth, h = video.videoHeight;
      if(w && h){
        canvas.width = w; canvas.height = h;
        ctx.drawImage(video, 0, 0, w, h);
        var imgData = ctx.getImageData(0,0,w,h);
        var code = jsQR(imgData.data, w, h);
        if(code && code.data){
          var sr = $("#scanResult"); if(sr) sr.textContent = "QR: " + code.data;
        }
      }
      scanRAF = requestAnimationFrame(loop);
    };
    loop();
  }catch(e){ alert("カメラ起動に失敗: " + (e && e.message ? e.message : e)); }
});
function stopScan(){
  try{ if(scanRAF) cancelAnimationFrame(scanRAF); }catch(_){}
  scanRAF=null;
  try{
    if(scanStream && scanStream.getTracks){
      scanStream.getTracks().forEach(function(t){ try{ t.stop(); }catch(_){} });
    }
  }catch(_){}
  scanStream=null;
}
function openOpDialog(po){
  var poEl=$("#opPO"), okEl=$("#opOK"), ngEl=$("#opNG"), noteEl=$("#opNote"), sel=$("#opProcess"), dlg=$("#dlgOp");
  if(poEl) poEl.textContent = po || "—";
  if(okEl) okEl.value = 0;
  if(ngEl) ngEl.value = 0;
  if(noteEl) noteEl.value = "";
  if(sel) sel.innerHTML = ["切断","レザー加工","曲げ","外注加工/組立","検査","出荷準備","出荷済"].map(function(x){ return "<option>"+x+"</option>"; }).join("");
  if(dlg) dlg.showModal();
}
setOnClick("#btnOpCancel", function(){ var d=$("#dlgOp"); if(d) d.close(); });
setOnClick("#btnOpSave", async function(){
  var payload = {
    po_id: ( $("#opPO") ? $("#opPO").textContent : "" ),
    process: ( $("#opProcess") ? $("#opProcess").value : "" ),
    ok: Number( $("#opOK") ? $("#opOK").value : 0),
    ng: Number( $("#opNG") ? $("#opNG").value : 0),
    note: ( $("#opNote") ? $("#opNote").value : '' ),
    user: JSON.stringify(CURRENT_USER||{})
  };
  try{
    await jsonp("saveOp", payload);
    alert("保存しました");
    var d=$("#dlgOp"); if(d) d.close();
    await refreshAll();
  }catch(e){ alert("保存失敗: " + (e && e.message ? e.message : e)); }
});

/* ================== ADMIN: ADD MEMBER ================== */
function openAddUser(){
  var d=$("#dlgAddUser"); if(d) d.showModal();
  setOnClick("#btnAddUserSave", async function(){
    var username = $("#auUser") ? $("#auUser").value.trim() : "";
    var password = $("#auPass") ? $("#auPass").value.trim() : "";
    var role     = $("#auRole") ? $("#auRole").value : "";
    var department = $("#auDept") ? $("#auDept").value.trim() : "";
    var full_name  = $("#auName") ? $("#auName").value.trim() : "";
    if(!username || !password) { alert("Username dan Password wajib."); return; }
    try{
      await jsonp("addMember", { data: JSON.stringify({ username:username, password:password, role:role, department:department, full_name:full_name }), user: JSON.stringify(CURRENT_USER||{}) });
      alert("Member berhasil ditambahkan");
      var d=$("#dlgAddUser"); if(d) d.close();
      if($("#auUser")) $("#auUser").value = "";
      if($("#auPass")) $("#auPass").value = "";
      if($("#auDept")) $("#auDept").value = "";
      if($("#auName")) $("#auName").value = "";
    }catch(e){ alert("Gagal menambahkan member: " + (e && e.message ? e.message : e)); }
  });
  setOnClick("#btnAddUserCancel", function(){ var d=$("#dlgAddUser"); if(d) d.close(); });
}
setOnClick("#btnAddMember", openAddUser);

/* ================== WEATHER (dummy) ================== */
async function ensureWeather(){
  var a=$("#wxTemp"), b=$("#wxWind"), c=$("#wxPlace");
  if(a) a.textContent = "20℃";
  if(b) b.textContent = "6 m/s";
  if(c) c.textContent = "GMT+9";
}

/* ================== FORM DIALOG (Generic) ================== */
function openFormDialog(title, fields, onSave){
  var ttl=$("#dlgTitle"); if(ttl) ttl.textContent = title;
  var form = $("#formBody"); if(!form) return;
  form.innerHTML = fields.map(function(f){
    return [
      '<div class="form-item">',
        '<label>', f.label ,'</label>',
        '<input id="f_', f.key ,'" value="', escapeHTML(f.value||''), '">',
      '</div>'
    ].join("");
  }).join("");
  setOnClick("#btnDlgSave", async function(){
    var data = {};
    fields.forEach(function(f){
      var el = $("#f_"+f.key); data[f.key] = el ? el.value : "";
    });
    try{
      await onSave(data);
      var d=$("#dlgForm"); if(d) d.close();
    }catch(e){ alert(e && e.message ? e.message : e); }
  });
  setOnClick("#btnDlgCancel", function(){ var d=$("#dlgForm"); if(d) d.close(); });
  var dlg=$("#dlgForm"); if(dlg) dlg.showModal();
}

/* ================== UTILS ================== */
function debounce(fn, wait){
  wait = typeof wait==="number" ? wait : 250;
  var t=null;
  return function(){ var a=arguments; clearTimeout(t); t=setTimeout(function(){ fn.apply(null,a); }, wait); };
}
function exportTableCSV(tbodySel, filename){
  filename = filename || "export.csv";
  var tb = $(tbodySel); if(!tb) return;
  var rows = [];
  var table = tb.closest("table");
  var ths = $$("thead th", table).map(function(th){ return wrapCSV((th.textContent||"").trim()); });
  rows.push(ths.join(","));
  $$("tr", tb).forEach(function(tr){
    var cols = $$(".//td|th".replace("//",""), tr); // kompat
    cols = $$("td,th", tr).map(function(td){ return wrapCSV((td.textContent||'')); });
    rows.push(cols.join(","));
  });
  var blob = new Blob([rows.join("\n")], {type:"text/csv;charset=utf-8;"});
  var a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
function wrapCSV(s){
  s = String(s||"").replace(/\r?\n/g," ").replace(/"/g,'""');
  return '"'+s+'"';
}
function escapeHTML(s){
  s = (s==null? "": String(s));
  return s.replace(/[&<>"']/g, function(m){ return ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" })[m]; });
}

/* ================== INIT ================== */
document.addEventListener("DOMContentLoaded", function(){
  setUser(null);
  setOnClick("#btnStationQR", openStationQrSheet);
});
