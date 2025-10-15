/* =================================================
  App JS — Fast Login + Skeleton + CRUD lengkap
  Backend: Google Apps Script JSONP (API_BASE)
================================================= */

/* ====== CONFIG ====== */
const API_BASE = "https://script.google.com/macros/s/AKfycbyFPilRpjXxKVlM2Av2LunQJAIJszz9wNX0j1Ab1pbWkZeecIx_QNZwoKQR6XCNGYSLGA/exec"; // /exec tanpa query

/* ====== Helpers ====== */
const $  = (q, el=document)=> el.querySelector(q);
const $$ = (q, el=document)=> [...el.querySelectorAll(q)];
const qs = (o)=> Object.entries(o).map(([k,v])=>`${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
function debounce(fn,ms){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); }; }
window.requestIdleCallback ||= (cb)=> setTimeout(cb,0);

/* ====== Theme (Light default) ====== */
const THEME_KEY="erp_theme";
function applyTheme(mode){
  const root=document.documentElement, dark=(mode==='dark');
  document.body.dataset.theme = dark?'dark':'light';
  const set=(k,v)=> root.style.setProperty(k,v);
  if(dark){
    set('--bg','#0f172a'); set('--panel','#111827'); set('--ink','#e5e7eb');
    set('--muted','#94a3b8'); set('--border','#1f2937'); set('--ring','#1d4ed8');
    set('--btn','#22c55e'); set('--brand','#22c55e');
  }else{
    set('--bg','#f6f7fb'); set('--panel','#fff'); set('--ink','#0f172a');
    set('--muted','#64748b'); set('--border','#e5e7eb'); set('--ring','#c7d2fe');
    set('--btn','#109293'); set('--brand','#0ea5a6');
  }
  localStorage.setItem(THEME_KEY, mode);
}
function initTheme(){
  applyTheme(localStorage.getItem(THEME_KEY)||'light');
  $("#btnTheme")?.addEventListener("click",()=>{
    const cur=localStorage.getItem(THEME_KEY)||'light';
    applyTheme(cur==='light'?'dark':'light');
  });
}

/* ====== JSONP + cache ====== */
function jsonp(action, params={}, timeoutMs=8000){
  return new Promise((resolve,reject)=>{
    const cb="cb_"+Math.random().toString(36).slice(2);
    params={...params, action, callback:cb};
    const s=document.createElement("script");
    s.src=`${API_BASE}?${qs(params)}`;
    let done=false;
    const timer=setTimeout(()=>{ if(done) return; done=true; cleanup(); reject(new Error("API timeout")); },timeoutMs);
    function cleanup(){ try{ delete window[cb]; s.remove(); }catch{} clearTimeout(timer); }
    window[cb]=(resp)=>{ if(done) return; done=true; cleanup(); if(resp&&resp.ok) resolve(resp.data); else reject(new Error(resp?.error||"API error")); };
    s.onerror=()=>{ if(done) return; done=true; cleanup(); reject(new Error("JSONP error")); };
    document.body.appendChild(s);
  });
}
const cache=new Map();
async function cached(action,params={},ttl=15000){
  const k=action+":"+JSON.stringify(params||{});
  const t=Date.now(), hit=cache.get(k);
  if(hit && (t-hit.t)<ttl) return hit.v;
  const v=await jsonp(action,params); cache.set(k,{v,t}); return v;
}

/* ====== Skeleton ====== */
(function injectSkeletonCSS(){
  if($("#skl-css")) return;
  const st=document.createElement("style"); st.id="skl-css";
  st.textContent=`
  :root{--skl:#e5e7eb;--skl-hi:#f3f4f6}
  [data-theme="dark"]{--skl:#1f2937;--skl-hi:#111827}
  .skl-line{height:14px;border-radius:999px;background:linear-gradient(90deg,var(--skl) 0%,var(--skl-hi) 40%,var(--skl) 80%);background-size:200% 100%;animation:skl 1.2s linear infinite}
  @keyframes skl{0%{background-position:200% 0}100%{background-position:-200% 0}}
  `;
  document.head.appendChild(st);
})();
function skeletonRows(tbody, cols, rows=8){
  tbody.innerHTML="";
  for(let i=0;i<rows;i++){
    const tr=document.createElement("tr");
    tr.innerHTML=Array.from({length:cols}).map(()=>`<td><div class="skl-line"></div></td>`).join("");
    tbody.appendChild(tr);
  }
}

/* ====== Session / Role ====== */
let CURRENT_USER=null;
const ROLE_MAP={
  admin:{pages:['pageDash','pageSales','pagePlan','pageShip','pageFinished','pageInv','pageInvoice','pageAnalytics'],nav:true},
  '営業':{pages:['pageSales','pageDash','pageFinished','pageInv','pageInvoice','pageAnalytics'],nav:true},
  '生産管理':{pages:['pagePlan','pageShip','pageDash','pageFinished','pageInv','pageInvoice','pageAnalytics'],nav:true},
  '生産管理部':{pages:['pagePlan','pageShip','pageDash','pageFinished','pageInv','pageInvoice','pageAnalytics'],nav:true},
  '製造':{pages:['pageDash','pageFinished','pageInv','pageAnalytics'],nav:true},
  '検査':{pages:['pageDash','pageFinished','pageInv','pageAnalytics'],nav:true},
};
function show(id){
  ["authView","pageDash","pageSales","pagePlan","pageShip","pageFinished","pageInv","pageInvoice","pageAnalytics"]
    .forEach(p=> $("#"+p)?.classList.add("hidden"));
  $("#"+id)?.classList.remove("hidden");
}
function setUser(u){
  CURRENT_USER=u||null;
  $("#topBar").classList.toggle("hidden",!u);
  $("#userInfo").textContent=u?`${u.full_name||u.username}／${u.role||u.department||''}`:'';
  ['btnToDash','btnToSales','btnToPlan','btnToShip','btnToFinPage','btnToInvPage','btnToInvoice','btnToAnalytics','ddSetting','weatherWrap']
    .forEach(id=> $("#"+id)?.classList.add("hidden"));
  if(!u){ show("authView"); return; }
  const allow=ROLE_MAP[u.role]||ROLE_MAP[u.department]||ROLE_MAP.admin;
  allow.pages.includes('pageDash')&&$("#btnToDash").classList.remove("hidden");
  allow.pages.includes('pageSales')&&$("#btnToSales").classList.remove("hidden");
  allow.pages.includes('pagePlan') &&$("#btnToPlan").classList.remove("hidden");
  allow.pages.includes('pageShip') &&$("#btnToShip").classList.remove("hidden");
  allow.pages.includes('pageFinished')&&$("#btnToFinPage").classList.remove("hidden");
  allow.pages.includes('pageInv')&&$("#btnToInvPage").classList.remove("hidden");
  allow.pages.includes('pageInvoice')&&$("#btnToInvoice").classList.remove("hidden");
  allow.pages.includes('pageAnalytics')&&$("#btnToAnalytics").classList.remove("hidden");
  $("#ddSetting").classList.remove("hidden");
  $("#weatherWrap").classList.remove("hidden");
  ensureWeather();
  Promise.allSettled([
    cached("listOrders",{},12000),
    cached("listSales",{},12000),
    cached("listPlans",{},12000),
    cached("listShip",{},12000),
    cached("listFinished",{},12000),
    cached("listInventory",{},12000),
  ]);
  show("pageDash"); refreshDashboard();
}

/* ====== Login ====== */
$("#btnLogin")?.addEventListener("click",doLogin);
$("#inUser")?.addEventListener("keydown",e=> e.key==="Enter"&&doLogin());
$("#inPass")?.addEventListener("keydown",e=> e.key==="Enter"&&doLogin());
$("#btnLogout")?.addEventListener("click",()=> setUser(null));
async function doLogin(){
  const u=$("#inUser").value.trim(), p=$("#inPass").value.trim();
  if(!u||!p) return alert("ユーザー名／パスワードを入力してください。");
  $("#authView .card").style.opacity=.6;
  try{
    await Promise.race([jsonp("ping",{},3000), new Promise(r=>setTimeout(r,150))]);
    const me=await jsonp("login",{username:u,password:p},6000);
    setUser(me);
  }catch(e){ alert("ログイン失敗: "+e.message); }
  finally{ $("#authView .card").style.opacity=1; }
}

/* ====== Weather (kecil, cache 30m) ====== */
async function ensureWeather(){
  try{
    const key='wx_cache_v1', now=Date.now();
    const hit=JSON.parse(localStorage.getItem(key)||'null');
    if(hit && (now-hit.t)<30*60*1000){ renderWeather(hit.v); return; }
    let lat=35.6762, lon=139.6503;
    if(navigator.geolocation){
      await new Promise(res=> navigator.geolocation.getCurrentPosition(
        pos=>{ lat=pos.coords.latitude; lon=pos.coords.longitude; res(); },
        ()=>res(), {maximumAge:600000,timeout:1500}
      ));
    }
    const v=await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,wind_speed_10m&timezone=auto`).then(r=>r.json());
    localStorage.setItem(key,JSON.stringify({v,t:now})); renderWeather(v);
  }catch(_){}
}
function renderWeather(v){ if(!v?.current) return;
  $("#wxTemp").textContent=Math.round(v.current.temperature_2m)+"°C";
  $("#wxWind").textContent=Math.round(v.current.wind_speed_10m)+" m/s";
  $("#wxPlace").textContent=v.timezone_abbreviation||"";
}

/* ====== Dashboard ====== */
let ORDERS=[];
const normalizeProc=(s)=> String(s||"").trim().replace("レーサ加工","レザー加工").replace("外作加工","外注加工/組立");
function chip(h){ return `<span class="chip">${h}</span>`; }
function stBadge(s){ s=String(s||"");
  if(/出荷済/.test(s)) return chip('<i class="fa-solid fa-truck"></i>出荷済');
  if(/検査済/.test(s)) return chip('<i class="fa-regular fa-circle-check"></i>検査済');
  if(/検査中/.test(s)) return chip('<i class="fa-regular fa-clipboard"></i>検査中');
  return chip('<i class="fa-regular fa-clock"></i>'+(s||'—'));
}
function pcBadge(p){ p=normalizeProc(p);
  if(/レザー/.test(p)) return chip('<i class="fa-solid fa-bolt"></i>レザー');
  if(/曲げ/.test(p)) return chip('<i class="fa-solid fa-wave-square"></i>曲げ');
  if(/組立/.test(p)) return chip('<i class="fa-solid fa-screwdriver-wrench"></i>組立');
  if(/検査/.test(p)) return chip('<i class="fa-regular fa-square-check"></i>検査');
  return chip(p||'—');
}
function fmtTime(d){ return d? new Date(d).toLocaleString("ja-JP"):""; }
async function refreshDashboard(){
  const tb=$("#tbOrders"); skeletonRows(tb,9,8);
  try{ ORDERS=await cached("listOrders",{},8000); renderOrders(); }catch(_){ tb.innerHTML=""; }
}
$("#searchQ")?.addEventListener("input",debounce(renderOrders,250));
function renderOrders(){
  const tb=$("#tbOrders"); if(!tb) return;
  const q=($("#searchQ")?.value||"").toLowerCase();
  const rows=ORDERS.filter(r=> !q || JSON.stringify(r).toLowerCase().includes(q));
  tb.innerHTML="";
  const frag=document.createDocumentFragment();
  rows.forEach(r=>{
    const tr=document.createElement("tr");
    tr.innerHTML=`
      <td><div class="s muted">注番</div><div><b>${r.po_id||""}</b></div><div class="s muted">${r["得意先"]||"—"}</div></td>
      <td>${r["品名"]||"—"}</td>
      <td>${r["品番"]||"—"}</td>
      <td>${r["図番"]||"—"}</td>
      <td class="center">${stBadge(r.status)}</td>
      <td class="center">
        <div class="row">${pcBadge(r.current_process)}
          <span class="chip" style="background:#e2fbe2">OK:${r.ok_count||0}</span>
          <span class="chip" style="background:#ffe4e6">NG:${r.ng_count||0}</span>
        </div>
      </td>
      <td class="center">${fmtTime(r.updated_at)}</td>
      <td class="center">${r.updated_by||"—"}</td>
      <td class="center">
        <button class="btn s" data-po="${r.po_id}" data-act="op"><i class="fa-regular fa-keyboard"></i> 手入力</button>
      </td>`;
    frag.appendChild(tr);
  });
  tb.appendChild(frag);
  tb.onclick=(e)=>{
    const b=e.target.closest("button"); if(!b) return;
    if(b.dataset.act==='op') openOpDialog(b.dataset.po);
  };
}

/* ====== Generic table builder ====== */
function buildTable(th, tb, data){
  th.innerHTML=`<tr>${data.header.map(h=>`<th>${h}</th>`).join("")}</tr>`;
  tb.innerHTML=data.rows.map(r=> `<tr>${r.map(v=>`<td>${v instanceof Date ? v.toLocaleString("ja-JP") : (v??"")}</td>`).join("")}</tr>`).join("");
}
function filterTable(qEl, bodyEl){
  const q=(qEl.value||"").toLowerCase();
  [...bodyEl.children].forEach(tr=> tr.style.display = tr.textContent.toLowerCase().includes(q) ? "" : "none");
}

/* ====== CRUD — SALES ====== */
async function loadSales(){ const tb=$("#tbSales"); skeletonRows(tb,8,8);
  const s=await cached("listSales",{},12000); buildTable($("#thSales"),tb,s);
  $("#salesSearch").oninput=()=> filterTable($("#salesSearch"), tb);
  $("#btnSalesExport").onclick=()=> exportXlsx("SalesOrders",s.header,s.rows);
  // contoh save (Add/Edit) → bentuk json sesuai header
  $("#btnSalesAdd")?.addEventListener("click", async ()=>{
    const po=prompt("po_id / 注番?"); if(!po) return;
    const data={ po_id:po, customer:prompt("得意先?")||"", item_name:prompt("品名?")||"", part_no:prompt("品番?")||"", drawing_no:prompt("図番?")||"" };
    await jsonp("saveSales",{ data:JSON.stringify(data), user:JSON.stringify(CURRENT_USER||{})}); await loadSales();
  });
  $("#btnSalesDelete")?.addEventListener("click", async ()=>{
    const po=prompt("Hapus PO (po_id) ?"); if(!po) return;
    await jsonp("deleteSales",{ po_id:po }); await loadSales();
  });
}

/* ====== CRUD — PLAN ====== */
async function loadPlans(){ const tb=$("#tbPlan"); skeletonRows(tb,8,8);
  const s=await cached("listPlans",{},12000); buildTable($("#thPlan"),tb,s);
  $("#planSearch").oninput=()=> filterTable($("#planSearch"), tb);
  $("#btnPlanExport").onclick=()=> exportXlsx("ProductionOrders",s.header,s.rows);
  $("#btnPlanAdd")?.addEventListener("click", async ()=>{
    const po=prompt("po_id?"); if(!po) return;
    const data={ po_id:po, customer:prompt("得意先?")||"", item_name:prompt("品名?")||"", current_process:"準備", status:"進行" };
    await jsonp("savePlan",{ data:JSON.stringify(data), user:JSON.stringify(CURRENT_USER||{})}); await loadPlans(); refreshDashboard();
  });
}

/* ====== CRUD — SHIP ====== */
async function loadShips(){ const tb=$("#tbShip"); skeletonRows(tb,8,8);
  const s=await cached("listShip",{},12000); buildTable($("#thShip"),tb,s);
  $("#shipSearch").oninput=()=> filterTable($("#shipSearch"), tb);
  $("#btnShipExport").onclick=()=> exportXlsx("Shipments",s.header,s.rows);
  $("#btnShipAdd")?.addEventListener("click", async ()=>{
    const po=prompt("po_id?"); if(!po) return;
    const data={ po_id:po, destination:prompt("送り先?")||"", qty:Number(prompt("数量?")||0)||0, 単価:Number(prompt("単価?")||0)||0, status:"予定" };
    await jsonp("saveShip",{ data:JSON.stringify(data), user:JSON.stringify(CURRENT_USER||{})}); await loadShips();
  });
  $("#btnShipDelete")?.addEventListener("click", async ()=>{
    const po=prompt("po_id? (hapus entry yang belum 出荷済)"); if(!po) return;
    await jsonp("deleteShip",{ po_id:po }); await loadShips();
  });
}

/* ====== FINISHED & INVENTORY (read + export) ====== */
async function loadFinished(){ const tb=$("#tbFin"); skeletonRows(tb,8,8);
  const s=await cached("listFinished",{},12000); buildTable($("#thFin"),tb,s);
  $("#finSearch").oninput=()=> filterTable($("#finSearch"), tb);
  $("#btnFinExport").onclick=()=> exportXlsx("FinishedGoods",s.header,s.rows);
}
async function loadInventory(){ const tb=$("#tbInv"); skeletonRows(tb,8,8);
  const s=await cached("listInventory",{},12000); buildTable($("#thInv"),tb,s);
  $("#invSearch").oninput=()=> filterTable($("#invSearch"), tb);
  $("#btnInvExport").onclick=()=> exportXlsx("Inventory",s.header,s.rows);
}

/* ====== INVOICE ====== */
async function initInvoicePage(){
  const sel=$("#invoiceCustomer");
  const m=await cached("listMasters",{},60000);
  sel.innerHTML=`<option value="">(得意先を選択)</option>`+(m.customers||[]).map(c=>`<option>${c}</option>`).join("");
  $("#invoiceDate").value=new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10);
  $("#btnInvoiceReload").onclick=async()=>{ await reloadInvoiceCandidates(); await reloadInvoiceList(); };
  $("#btnInvoiceSave").onclick=saveInvoice; $("#btnInvoiceXlsx").onclick=exportInvoiceExcel; $("#btnInvoicePdf").onclick=printInvoiceHTML;
  await reloadInvoiceCandidates(); await reloadInvoiceList();
}
async function reloadInvoiceCandidates(){
  const cust=$("#invoiceCustomer").value||""; const tbC=$("#tbInvoiceCandidates"), tbS=$("#tbInvoiceStatus");
  tbC.innerHTML=""; tbS.innerHTML="";
  if(!cust) return;
  const data=await jsonp("invoiceCandidates",{customer:cust});
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
  const list=await cached("listInvoices",{},15000);
  const tb=$("#tbInvoiceList"); tb.innerHTML="";
  (list||[]).forEach(o=>{
    const tr=document.createElement("tr");
    tr.innerHTML=`<td>${o.invoice_id||''}</td><td>${o.customer||''}</td><td>${(o.issue_date? new Date(o.issue_date).toLocaleDateString("ja-JP"):"")}</td><td>${Number(o.total||0).toLocaleString("ja-JP")}</td><td>${o.filename||''}</td><td>${o.created_by||''}</td>`;
    tb.appendChild(tr);
  });
}
async function saveInvoice(){
  const cust=$("#invoiceCustomer").value||""; if(!cust) return alert("得意先を選択してください");
  const issue_date=$("#invoiceDate").value || new Date().toISOString().slice(0,10);
  const items=[...$("#tbInvoiceCandidates").querySelectorAll("input.pick:checked")].map(ch=>({
    ship_id:ch.dataset.sid||'', po_id:ch.dataset.po||'', 数量:Number(ch.dataset.qty||0)||0, 単価:Number(ch.dataset.unit||0)||0, 金額:Number(ch.dataset.price||0)||0,
    商品名:ch.dataset.item||'', 品番:ch.dataset.part||'', 出荷日:ch.dataset.ship||''
  }));
  if(!items.length) return alert("明細を選択してください");
  await jsonp("createInvoice",{ data:JSON.stringify({customer:cust, issue_date, items}), user:JSON.stringify(CURRENT_USER||{}) });
  alert("請求書を作成しました"); await reloadInvoiceCandidates(); await reloadInvoiceList();
}
function exportInvoiceExcel(){
  const rows=[...$("#tbInvoiceCandidates tr")].filter(tr=> tr.querySelector(".pick:checked")).map(tr=> [...tr.children].slice(1).map(td=> td.textContent));
  if(!rows.length) return alert("エクスポート対象がありません");
  exportXlsx("請求書明細",["注番","商品名","品番","数量","単価","金額","出荷日"],rows);
}
function printInvoiceHTML(){
  const cust=$("#invoiceCustomer").value||"—", date=$("#invoiceDate").value||new Date().toISOString().slice(0,10);
  const rows=[...$("#tbInvoiceCandidates tr")].filter(tr=> tr.querySelector(".pick:checked")).map(tr=> [...tr.children].slice(1).map(td=> td.textContent));
  if(!rows.length) return alert("印刷対象がありません");
  const total=rows.reduce((s,r)=> s+(Number((r[5]||"").replace(/,/g,"")) || (Number(r[3]||0)*Number(r[4]||0))),0);
  const html=`<html><head><meta charset="utf-8"><title>請求書</title>
  <style>body{font-family:"Noto Sans JP",system-ui,Arial;padding:20px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #ddd;padding:6px}th{background:#f6f7fb}.r{text-align:right}</style>
  </head><body><h2>請求書</h2><div>得意先: <b>${cust}</b></div><div>発行日: ${new Date(date).toLocaleDateString("ja-JP")}</div>
  <table><tr><th>注番</th><th>商品名</th><th>品番</th><th>数量</th><th>単価</th><th>金額</th><th>出荷日</th></tr>
  ${rows.map(r=> `<tr>${r.map((c,i)=> `<td class="${i>=3?'r':''}">${c||''}</td>`).join('')}</tr>`).join('')}
  <tr><td colspan="5" class="r"><b>合計</b></td><td class="r"><b>${total.toLocaleString("ja-JP")}</b></td><td></td></tr></table>
  <script>window.print()</script></body></html>`;
  const w=window.open("about:blank"); w.document.write(html); w.document.close();
}

/* ====== Dialog Operasi ====== */
const PROCESS_OPTIONS=[ "準備","レザー加工","曲げ加工","外注加工/組立","組立","検査工程","検査中","検査済","出荷（組立済）","出荷準備","出荷済" ];
function openOpDialog(po,defaults={}){
  $("#opPO").textContent=po;
  const sel=$("#opProcess");
  sel.innerHTML=PROCESS_OPTIONS.map(o=>`<option>${o}</option>`).join("");
  $("#opProcess").value=defaults.process||PROCESS_OPTIONS[0];
  $("#opOK").value=defaults.ok_count??defaults.ok??0;
  $("#opNG").value=defaults.ng_count??defaults.ng??0;
  $("#opNote").value=defaults.note||"";
  $("#dlgOp").showModal();
  $("#btnOpSave").onclick=async()=>{
    const ok=Number($("#opOK").value||0), ng=Number($("#opNG").value||0), proc=$("#opProcess").value;
    if(ok<0||ng<0) return alert("OK/NG は 0 以上で");
    await jsonp("saveOp",{ data:JSON.stringify({ po_id:po, process:proc, ok_count:ok, ng_count:ng, note:$("#opNote").value }), user:JSON.stringify(CURRENT_USER||{}) });
    $("#dlgOp").close(); await refreshDashboard();
  };
}
$("#btnOpCancel")?.addEventListener("click",()=> $("#dlgOp").close());

/* ====== Add Member (Admin) ====== */
$("#btnAddUser")?.addEventListener("click",()=>{
  if(!CURRENT_USER || CURRENT_USER.role!=='admin') return alert("Hanya admin");
  $("#uUsername").value=""; $("#uPassword").value=""; $("#uFull").value="";
  $("#uDept").value=""; $("#uRole").value="member"; $("#uActive").value="TRUE";
  $("#dlgAddUser").showModal();
});
$("#btnUserCancel")?.addEventListener("click",()=> $("#dlgAddUser").close());
$("#btnUserSave")?.addEventListener("click", async ()=>{
  const row={ username:$("#uUsername").value.trim(), password:$("#uPassword").value, full_name:$("#uFull").value.trim(),
    department:$("#uDept").value.trim(), role:$("#uRole").value.trim()||'member', is_active:$("#uActive").value||'TRUE'
  };
  if(!row.username||!row.password) return alert("Username/Password wajib diisi");
  await jsonp("saveUser",{ data:JSON.stringify(row), user:JSON.stringify(CURRENT_USER||{}) },9000);
  alert("User ditambahkan"); $("#dlgAddUser").close();
});

/* ====== XLSX ====== */
function exportXlsx(name, head, rows){
  const ws=XLSX.utils.aoa_to_sheet([head,...rows]); const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,"Sheet1");
  XLSX.writeFile(wb, `${name}_${new Date().toISOString().slice(0,10)}.xlsx`);
}

/* ====== NAV ====== */
$("#btnToDash")?.addEventListener("click",()=>{ show("pageDash"); refreshDashboard(); });
$("#btnToSales")?.addEventListener("click",()=>{ show("pageSales"); loadSales(); });
$("#btnToPlan") ?.addEventListener("click",()=>{ show("pagePlan");  loadPlans(); });
$("#btnToShip") ?.addEventListener("click",()=>{ show("pageShip");  loadShips(); });
$("#btnToFinPage")?.addEventListener("click",()=>{ show("pageFinished"); loadFinished(); });
$("#btnToInvPage")?.addEventListener("click",()=>{ show("pageInv"); loadInventory(); });
$("#btnToInvoice")?.addEventListener("click",()=>{ show("pageInvoice"); initInvoicePage(); });
$("#btnToAnalytics")?.addEventListener("click",()=>{ show("pageAnalytics"); });

/* ====== Boot ====== */
document.addEventListener("DOMContentLoaded",()=>{ initTheme(); setUser(null); });
