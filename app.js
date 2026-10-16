// ============================================================
// 工艺记录系统 v1 — 后整理部门
// ============================================================

// ============ 配置 ============
const SUPABASE_URL = "https://wedahjwkrpwopmemakoe.supabase.co";
const SUPABASE_KEY = "sb_publishable_MWXCDePb7IM6IP6Nog60-g_gZHW5qzb";
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const TB = {
  orders:      "craft_orders",
  processes:   "craft_processes",
  params:      "craft_process_params",
  aux:         "craft_order_aux_usage",
  templates:   "craft_process_templates",
  bomHeaders:  "craft_bom_headers",
  bomItems:    "craft_bom_items",
  bomParams:   "craft_bom_params",
  logs:        "craft_logs",
};

// ============ 全局 ============
let currentLang = "en";
let currentUserRole = "viewer";
let allOrders = [];
let filteredOrders = [];
let currentPage = 1;
const PAGE_SIZE = 20;
let editingOrderId = null;
let currentOrderId = null;
let editingProcessId = null;
let currentParamProcessId = null;
let currentParamStage = "A";
let editingParamId = null;
let currentAuxProcessId = null;
let currentAuxStage = "A";
let editingAuxId = null;
let copySourceOrderId = null;

let allBoms = [];
let filteredBoms = [];
let currentBomPage = 1;
const BOM_PAGE_SIZE = 20;

// ============ 工具 ============
function t(zh, en) { return currentLang === "zh" ? zh : en; }
function esc(s) { return String(s || "").replace(/"/g, "&quot;"); }
function fmtTime(iso) { return iso ? String(iso).slice(0,16).replace("T"," ") : ""; }

async function fetchAllRows(table, orderCol = "created_at", ascending = false, filterFn = null) {
  const CHUNK = 1000;
  let all = [];
  let from = 0;
  while (true) {
    let q = supabaseClient.from(table).select("*")
      .order(orderCol, { ascending }).range(from, from + CHUNK - 1);
    if (filterFn) q = filterFn(q);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < CHUNK) break;
    from += CHUNK;
  }
  return all;
}

function downloadCSV(rows, filename) {
  const csv = "\uFEFF" + rows.map(r =>
    r.map(v => `"${String(v ?? "").replace(/"/g,'""')}"`).join(",")
  ).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

function theoryKg(standardDose, billetM) {
  return (Number(standardDose) || 0) * billetM / 100 / 1000;
}

function convertToGPer100m(actualValue, actualUnit, billetM) {
  const v = Number(actualValue) || 0;
  if (!billetM) return 0;
  if (actualUnit === "kg") return (v * 100 * 1000) / billetM;
  return v;
}

function statusLabel(s) {
  return ({pending:"待处理", in_progress:"进行中", done:"已完成", cancelled:"已取消", skipped:"跳过"})[s] || s;
}

// ============ 语言 ============
function toggleLang() {
  currentLang = currentLang === "zh" ? "en" : "zh";
  document.querySelectorAll("[data-zh]").forEach(el => {
    el.textContent = el.getAttribute("data-" + currentLang);
  });
}
function initLang() {
  document.querySelectorAll("[data-zh]").forEach(el => {
    el.textContent = el.getAttribute("data-" + currentLang);
  });
}

// ============ 权限 ============
async function loadUserRole() {
  try {
    const { data: u } = await supabaseClient.auth.getUser();
    if (!u?.user) return;
    const { data, error } = await supabaseClient
      .from("user_roles").select("role").eq("user_id", u.user.id).maybeSingle();
    if (error) { currentUserRole = "viewer"; return; }
    currentUserRole = data?.role || "viewer";
    applyRoleUI();
  } catch (e) { currentUserRole = "viewer"; }
}
function canEdit()   { return currentUserRole === "admin" || currentUserRole === "operator"; }
function canDelete() { return currentUserRole === "admin"; }
function applyRoleUI() {
  document.querySelectorAll("[data-role]").forEach(el => {
    const need = el.getAttribute("data-role");
    let show = false;
    if (need === "admin") show = (currentUserRole === "admin");
    else if (need === "operator") show = (currentUserRole === "admin" || currentUserRole === "operator");
    else if (need === "viewer") show = true;
    el.style.display = show ? "" : "none";
  });
}

// ============ 登录 ============
async function login() {
  const btn = document.getElementById("loginBtn");
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  const msg = document.getElementById("loginMsg");
  msg.textContent = "";
  if (btn) { btn.disabled = true; btn.textContent = "登录中..."; }
  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) { msg.textContent = "登录失败: " + error.message; return; }
    const remember = document.getElementById("rememberMe")?.checked;
    if (remember) localStorage.setItem("remember_email", data.user.email);
    else localStorage.removeItem("remember_email");
    await loadUserRole();
    document.getElementById("loginPage").style.display = "none";
    document.getElementById("userEmail").textContent = data.user.email;
    document.getElementById("userEmail2").textContent = data.user.email;
    await loadOrders();
    goToDashboard();
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "登录"; }
  }
}
async function logout() {
  await supabaseClient.auth.signOut();
  document.getElementById("loginPage").style.display = "flex";
  ["dashboardPage","mainPage","orderDetailPage","bomPage","reportPage","logsPage","sysLogsPage"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  });
}

// ============ 系统日志 ============
async function writeSysLog(action, detail, refNo) {
  try {
    const { data: u } = await supabaseClient.auth.getUser();
    await supabaseClient.from(TB.logs).insert({
      user_email: u?.user?.email || "unknown",
      action, detail, ref_no: refNo || null,
    });
  } catch (e) { console.warn(e); }
}

// ============ 页面切换 ============
function hideAll() {
  ["dashboardPage","mainPage","orderDetailPage","bomPage","reportPage","logsPage","sysLogsPage"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  });
}
function goToDashboard() {
  hideAll();
  document.getElementById("dashboardPage").style.display = "block";
  loadDashboard();
  applyRoleUI();
}
function goToOrders() {
  hideAll();
  document.getElementById("mainPage").style.display = "block";
  document.getElementById("userEmail").textContent = document.getElementById("userEmail2").textContent;
  renderOrders();
  applyRoleUI();
}

// ============ 仪表盘 ============
async function loadDashboard() {
  document.getElementById("dashOrders").textContent = allOrders.length;
  document.getElementById("dashPending").textContent = allOrders.filter(o => o.status === "pending").length;
  document.getElementById("dashInProgress").textContent = allOrders.filter(o => o.status === "in_progress").length;
  document.getElementById("dashDone").textContent = allOrders.filter(o => o.status === "done").length;

  try {
    const params = await fetchAllRows(TB.params, "created_at", false, q => q.eq("is_out_of_spec", true));
    document.getElementById("dashParamOOS").textContent = params.length;
  } catch (e) { document.getElementById("dashParamOOS").textContent = "—"; }
  try {
    const aux = await fetchAllRows(TB.aux, "created_at", false, q => q.eq("is_out_of_spec", true));
    document.getElementById("dashAuxOOS").textContent = aux.length;
  } catch (e) { document.getElementById("dashAuxOOS").textContent = "—"; }
}

// ============ 订单 ============
async function loadOrders() {
  try {
    allOrders = await fetchAllRows(TB.orders, "created_at", false);
  } catch (err) { alert("加载失败: " + err.message); return; }
  filteredOrders = allOrders;
  currentPage = 1;
  renderOrders();
}

function renderOrders() {
  const keyword = (document.getElementById("searchInput")?.value || "").trim().toLowerCase();
  const status = document.getElementById("statusFilter")?.value || "";
  filteredOrders = allOrders.filter(o => {
    if (status && o.status !== status) return false;
    if (keyword) {
      const kw = (o.contract||"").toLowerCase().includes(keyword)
              || (o.customer||"").toLowerCase().includes(keyword)
              || (o.sioc||"").toLowerCase().includes(keyword)
              || (o.pattern_no||"").toLowerCase().includes(keyword)
              || (o.color_name||"").toLowerCase().includes(keyword);
      if (!kw) return false;
    }
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageItems = filteredOrders.slice(start, start + PAGE_SIZE);

  document.getElementById("orderBody").innerHTML = pageItems.map((o, idx) => {
    const seq = start + idx + 1;
    return `
      <tr>
        <td>${seq}</td>
        <td>${o.contract || o.order_no || ""}</td>
        <td>${o.customer || ""}</td>
        <td>${o.sioc || ""}</td>
        <td>${o.pattern_no || ""}</td>
        <td>${o.color_name || ""}</td>
        <td>${o.order_qty_y || 0}</td>
        <td>${statusLabel(o.status)}</td>
        <td>${o.order_date || ""}</td>
        <td>${o.delivery_date || ""}</td>
        <td>
          <button class="in"   onclick="openOrderDetail('${o.id}')">详情</button>
          <button class="copy" onclick="openCopyOrderModal('${o.id}')" data-role="operator">复制</button>
          <button class="edit" onclick="openEditOrderModal('${o.id}')" data-role="operator">编辑</button>
          <button class="del"  onclick="deleteOrder('${o.id}')" data-role="admin">删除</button>
        </td>
      </tr>`;
  }).join("") || `<tr><td colspan="11" style="text-align:center;color:#999;">暂无数据</td></tr>`;

  document.getElementById("orderPageInfo").textContent =
    `${currentPage} / ${totalPages}  (${filteredOrders.length})`;
  document.getElementById("statOrders").textContent = filteredOrders.length;
}

function prevOrderPage() { if (currentPage > 1) { currentPage--; renderOrders(); } }
function nextOrderPage() {
  const tp = Math.ceil(filteredOrders.length / PAGE_SIZE);
  if (currentPage < tp) { currentPage++; renderOrders(); }
}

// ============ 订单弹窗 ============
function openAddOrderModal() {
  if (!canEdit()) { alert("无权限"); return; }
  editingOrderId = null;
  document.getElementById("orderModalTitle").textContent = "新增订单";
  ["o_contract","o_batch_no","o_customer","o_sioc","o_pattern_no","o_color_name",
   "o_fabric_number","o_order_date","o_delivery_date","o_warp_count","o_weft_count",
   "o_warp_density","o_weft_density","o_weave","o_cw","o_fabric_weight","o_fabric_content",
   "o_finishing_methods","o_order_qty_y","o_producing_qty_m","o_actual_billet_qty_m","o_note"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  document.getElementById("o_status").value = "pending";
  document.getElementById("orderMsg").textContent = "";
  document.getElementById("orderModal").style.display = "flex";
}

function openEditOrderModal(id) {
  if (!canEdit()) { alert("无权限"); return; }
  const o = allOrders.find(x => x.id === id);
  if (!o) return;
  editingOrderId = id;
  document.getElementById("orderModalTitle").textContent = "编辑订单";
  const map = {
    o_contract:"contract", o_batch_no:"batch_no", o_customer:"customer",
    o_sioc:"sioc", o_pattern_no:"pattern_no", o_color_name:"color_name",
    o_fabric_number:"fabric_number", o_order_date:"order_date",
    o_delivery_date:"delivery_date", o_warp_count:"warp_count",
    o_weft_count:"weft_count", o_warp_density:"warp_density",
    o_weft_density:"weft_density", o_weave:"weave", o_cw:"cw",
    o_fabric_weight:"fabric_weight", o_fabric_content:"fabric_content",
    o_finishing_methods:"finishing_methods", o_order_qty_y:"order_qty_y",
    o_producing_qty_m:"producing_qty_m", o_actual_billet_qty_m:"actual_billet_qty_m",
    o_note:"note",
  };
  Object.entries(map).forEach(([elId, key]) => {
    const el = document.getElementById(elId);
    if (el) el.value = o[key] ?? "";
  });
  document.getElementById("o_status").value = o.status || "pending";
  document.getElementById("orderMsg").textContent = "";
  document.getElementById("orderModal").style.display = "flex";
}
function closeOrderModal() { document.getElementById("orderModal").style.display = "none"; }

async function saveOrder() {
  if (!canEdit()) { alert("无权限"); return; }
  const g = id => (document.getElementById(id)?.value || "").trim();
  const payload = {
    contract: g("o_contract"),
    order_no: g("o_contract"),
    batch_no: g("o_batch_no"),
    customer: g("o_customer"),
    sioc: g("o_sioc"),
    pattern_no: g("o_pattern_no"),
    color_name: g("o_color_name"),
    fabric_number: g("o_fabric_number"),
    order_date: g("o_order_date") || null,
    delivery_date: g("o_delivery_date") || null,
    warp_count: g("o_warp_count"),
    weft_count: g("o_weft_count"),
    warp_density: g("o_warp_density"),
    weft_density: g("o_weft_density"),
    weave: g("o_weave"),
    cw: g("o_cw"),
    fabric_weight: g("o_fabric_weight"),
    fabric_content: g("o_fabric_content"),
    finishing_methods: g("o_finishing_methods"),
    order_qty_y: Number(g("o_order_qty_y")) || 0,
    producing_qty_m: Number(g("o_producing_qty_m")) || 0,
    actual_billet_qty_m: Number(g("o_actual_billet_qty_m")) || 0,
    note: g("o_note"),
    status: g("o_status") || "pending",
  };
  if (!payload.contract) { document.getElementById("orderMsg").textContent = "Contract 必填"; return; }

  let error;
  if (editingOrderId) {
    ({ error } = await supabaseClient.from(TB.orders).update(payload).eq("id", editingOrderId));
    if (!error) await writeSysLog("edit_order", `编辑订单 ${payload.contract}`, payload.contract);
  } else {
    const { data: u } = await supabaseClient.auth.getUser();
    payload.operator = u?.user?.email || "";
    ({ error } = await supabaseClient.from(TB.orders).insert(payload).select().single());
    if (!error) await writeSysLog("add_order", `新增订单 ${payload.contract}`, payload.contract);
  }
  if (error) { document.getElementById("orderMsg").textContent = "保存失败: " + error.message; return; }
  closeOrderModal();
  await loadOrders();
  if (!editingOrderId) goToOrders();
}

async function deleteOrder(id) {
  if (!canDelete()) { alert("无权限"); return; }
  const o = allOrders.find(x => x.id === id);
  if (!o) return;
  if (!confirm(`确定删除订单 ${o.contract || o.order_no}？（工序/参数/助剂一起删除）`)) return;
  const { error } = await supabaseClient.from(TB.orders).delete().eq("id", id);
  if (error) { alert("删除失败: " + error.message); return; }
  await writeSysLog("delete_order", `删除订单 ${o.contract}`, o.contract);
  await loadOrders();
}

// ============ 复制订单 ============
function openCopyOrderModal(orderId) {
  if (!canEdit()) { alert("无权限"); return; }
  const o = allOrders.find(x => x.id === orderId);
  if (!o) return;
  copySourceOrderId = orderId;
  document.getElementById("copyOrderSource").innerHTML =
    `源订单：<b>${o.contract || o.order_no || ""}</b> · ${o.customer || ""} · ${o.sioc || ""}`;
  document.getElementById("copy_contract").value = (o.contract || o.order_no || "") + "-C";
  document.getElementById("copy_batch_no").value = "";
  document.getElementById("copy_order_date").value = new Date().toISOString().slice(0,10);
  document.getElementById("copy_delivery_date").value = o.delivery_date || "";
  document.getElementById("copy_processes").checked = true;
  document.getElementById("copy_actuals").checked = false;
  document.getElementById("copy_aux_times").checked = false;
  document.getElementById("copyOrderMsg").textContent = "";
  document.getElementById("copyOrderModal").style.display = "flex";
}
function closeCopyOrderModal() {
  copySourceOrderId = null;
  document.getElementById("copyOrderModal").style.display = "none";
}

async function doCopyOrder() {
  if (!canEdit()) { alert("无权限"); return; }
  const src = allOrders.find(x => x.id === copySourceOrderId);
  if (!src) { alert("源订单不存在"); return; }
  const msg = document.getElementById("copyOrderMsg");
  msg.textContent = "复制中...";

  const newContract = document.getElementById("copy_contract").value.trim();
  const newBatch = document.getElementById("copy_batch_no").value.trim();
  const newOrderDate = document.getElementById("copy_order_date").value || null;
  const newDelivery = document.getElementById("copy_delivery_date").value || null;
  if (!newContract) { msg.textContent = "新 Contract 必填"; return; }

  const copyProcesses = document.getElementById("copy_processes").checked;
  const copyActuals = document.getElementById("copy_actuals").checked;
  const copyAuxTimes = document.getElementById("copy_aux_times").checked;

  const { data: u } = await supabaseClient.auth.getUser();
  const newOrder = { ...src };
  delete newOrder.id; delete newOrder.created_at; delete newOrder.updated_at;
  newOrder.contract = newContract;
  newOrder.order_no = newContract;
  newOrder.batch_no = newBatch;
  newOrder.order_date = newOrderDate;
  newOrder.delivery_date = newDelivery;
  newOrder.status = "pending";
  newOrder.operator = u?.user?.email || "";

  const { data: insOrder, error: e1 } = await supabaseClient.from(TB.orders).insert(newOrder).select().single();
  if (e1) { msg.textContent = "创建订单失败: " + e1.message; return; }
  const newOrderId = insOrder.id;

  if (copyProcesses) {
    const srcProcs = await fetchAllRows(TB.processes, "seq", true, q => q.eq("order_id", src.id));
    if (srcProcs.length) {
      const srcProcIds = srcProcs.map(p => p.id);
      const srcParams = await fetchAllRows(TB.params, "seq", true, q => q.in("process_id", srcProcIds));
      const srcAux = await fetchAllRows(TB.aux, "created_at", true, q => q.in("process_id", srcProcIds));

      for (const sp of srcProcs) {
        const newProc = {
          order_id: newOrderId,
          seq: sp.seq,
          process_name: sp.process_name,
          machine: sp.machine,
          standard_note: sp.standard_note,
          status: "pending",
          operator: "",
          start_time: copyAuxTimes ? sp.start_time : null,
          end_time: copyAuxTimes ? sp.end_time : null,
          result: "",
          note: sp.note,
        };
        const { data: insProc, error: e2 } = await supabaseClient.from(TB.processes).insert(newProc).select().single();
        if (e2) { console.warn(e2); continue; }

        const pParams = srcParams.filter(x => x.process_id === sp.id);
        if (pParams.length) {
          const newParams = pParams.map(x => ({
            process_id: insProc.id,
            stage: x.stage || "A",
            param_name: x.param_name,
            param_unit: x.param_unit || "",
            standard_value: x.standard_value || "",
            actual_value: copyActuals ? (x.actual_value || "") : "",
            is_out_of_spec: false,
            seq: x.seq || 1,
            note: x.note || "",
          }));
          await supabaseClient.from(TB.params).insert(newParams);
        }

        const pAux = srcAux.filter(x => x.process_id === sp.id);
        if (pAux.length) {
          const newAux = pAux.map(x => ({
            process_id: insProc.id,
            stage: x.stage || "A",
            bom_item_id: x.bom_item_id,
            aux_code: x.aux_code || "",
            aux_name: x.aux_name,
            standard_dose: x.standard_dose || 0,
            dose_unit: x.dose_unit || "g/100m",
            tolerance_pct: x.tolerance_pct ?? 10,
            actual_value: copyActuals ? (x.actual_value || 0) : 0,
            actual_unit: x.actual_unit || "kg",
            actual_dose: copyActuals ? (x.actual_dose || 0) : 0,
            actual_kg: copyActuals ? (x.actual_kg || 0) : 0,
            theory_dose: x.theory_dose || 0,
            theory_kg: x.theory_kg || 0,
            deviation_pct: copyActuals ? (x.deviation_pct || 0) : 0,
            is_out_of_spec: copyActuals ? !!x.is_out_of_spec : false,
            alert_ack: false,
            note: x.note || "",
          }));
          await supabaseClient.from(TB.aux).insert(newAux);
        }
      }
    }
  }

  await writeSysLog("copy_order", `复制订单：${src.contract} → ${newContract}`, newContract);
  msg.textContent = "✅ 复制完成";
  setTimeout(async () => {
    closeCopyOrderModal();
    await loadOrders();
    openOrderDetail(newOrderId);
  }, 800);
}

// ============ 订单详情（四层结构） ============
async function openOrderDetail(orderId) {
  currentOrderId = orderId;
  hideAll();
  document.getElementById("orderDetailPage").style.display = "block";
  document.getElementById("userEmailDetail").textContent = document.getElementById("userEmail2").textContent;

  const order = allOrders.find(x => x.id === orderId);
  if (!order) { alert("订单不存在"); return; }

  document.getElementById("detailTitle").textContent =
    `${order.contract || order.order_no} | ${order.customer || ""} | ${order.sioc || ""} | ${order.color_name || ""}`;

  let processes = [];
  try {
    processes = await fetchAllRows(TB.processes, "seq", true, q => q.eq("order_id", orderId));
    processes.sort((a,b) => (a.seq||0) - (b.seq||0));
  } catch (e) { alert("加载工序失败: " + e.message); return; }

  const procIds = processes.map(p => p.id);

  let allParams = [], usages = [];
  if (procIds.length) {
    allParams = await fetchAllRows(TB.params, "seq", true, q => q.in("process_id", procIds));
    usages = await fetchAllRows(TB.aux, "created_at", true, q => q.in("process_id", procIds));
  }

  const paramsByProcStage = {};
  allParams.forEach(p => {
    const k = p.process_id + "||" + (p.stage || "A");
    if (!paramsByProcStage[k]) paramsByProcStage[k] = [];
    paramsByProcStage[k].push(p);
  });

  const auxByProcStage = {};
  usages.forEach(u => {
    const k = u.process_id + "||" + (u.stage || "A");
    if (!auxByProcStage[k]) auxByProcStage[k] = [];
    auxByProcStage[k].push(u);
  });

  const stagesByProc = {};
  processes.forEach(p => {
    const s = new Set();
    allParams.filter(x => x.process_id === p.id && x.param_name !== "(占位)").forEach(x => s.add(x.stage || "A"));
    usages.filter(x => x.process_id === p.id).forEach(x => s.add(x.stage || "A"));
    stagesByProc[p.id] = [...s].sort();
    if (!stagesByProc[p.id].length) stagesByProc[p.id] = ["A"];
  });

  const oosCount = allParams.filter(x => x.is_out_of_spec).length
                 + usages.filter(x => x.is_out_of_spec).length;
  document.getElementById("detailProcCount").textContent = processes.length;
  document.getElementById("detailOOS").textContent = oosCount;

  const billetM = Number(order.actual_billet_qty_m) || 0;

  document.getElementById("detailBody").innerHTML =
    `<div style="margin-bottom:10px;text-align:right;">
       <button onclick="generateProcessesFromTemplate('${orderId}')" data-role="operator"
         style="padding:8px 14px;background:#2563eb;color:#fff;border:none;border-radius:8px;cursor:pointer;">
         📋 从模板生成工序
       </button>
       <button onclick="openAddProcessModal(null)" data-role="operator"
         style="padding:8px 14px;background:#16a34a;color:#fff;border:none;border-radius:8px;cursor:pointer;margin-left:6px;">
         + 手工加工序
       </button>
       <button onclick="goToOrders()"
         style="padding:8px 14px;background:#e5e7eb;color:#333;border:none;border-radius:8px;cursor:pointer;margin-left:6px;">
         返回清单
       </button>
     </div>` +
    processes.map(proc => {
      const stages = stagesByProc[proc.id];

      const stageHtml = stages.map(st => {
        const params = (paramsByProcStage[proc.id + "||" + st] || [])
          .filter(p => p.param_name !== "(占位)");
        const aux = auxByProcStage[proc.id + "||" + st] || [];

        const paramsHtml = `
          <table class="data-table" style="font-size:13px;margin-bottom:6px;">
            <thead>
              <tr><th>参数名</th><th>单位</th><th>标准值</th><th>实际值</th><th>状态</th><th>备注</th><th>操作</th></tr>
            </thead>
            <tbody>
            ${params.length ? params.map(pa => `
              <tr data-param-id="${pa.id}" style="${pa.is_out_of_spec ? 'background:#fee2e2;' : ''}">
                <td>${pa.param_name}</td>
                <td>${pa.param_unit || ""}</td>
                <td>${pa.standard_value || ""}</td>
                <td><input type="text" value="${esc(pa.actual_value) || ""}"
                  onchange="updateProcessParam('${pa.id}', this.value)"
                  style="width:90px;padding:4px;border:1px solid #ddd;border-radius:4px;" /></td>
                <td style="${pa.is_out_of_spec ? 'color:#dc2626;font-weight:bold;' : ''}">
                  ${pa.is_out_of_spec ? "⚠️ 超标" : "正常"}
                </td>
                <td>${esc(pa.note)}</td>
                <td>
                  <button onclick="editProcessParam('${pa.id}')" data-role="operator">编辑</button>
                  <button onclick="deleteProcessParam('${pa.id}')" data-role="admin">删除</button>
                </td>
              </tr>
            `).join("") : `<tr><td colspan="7" style="text-align:center;color:#999;font-size:12px;">暂未录入参数</td></tr>`}
            </tbody>
          </table>`;

        const auxHtml = `
          <table class="data-table" style="font-size:13px;">
            <thead>
              <tr><th>助剂编号</th><th>助剂名称</th><th>标准 g/100m</th><th>理论(kg)</th>
                  <th>实际用量</th><th>单位</th><th>实际 g/100m</th><th>偏差%</th><th>状态</th><th>操作</th></tr>
            </thead>
            <tbody>
            ${aux.length ? aux.map(r => {
              const theory = theoryKg(r.standard_dose, billetM);
              return `
                <tr data-usage-id="${r.id}" style="${r.is_out_of_spec ? 'background:#fee2e2;' : ''}">
                  <td>${r.aux_code || ""}</td>
                  <td>${r.aux_name}</td>
                  <td>${Number(r.standard_dose||0).toFixed(3)}</td>
                  <td>${theory.toFixed(3)}</td>
                  <td><input type="number" step="0.001" value="${r.actual_value || 0}"
                    data-usage-input="${r.id}"
                    onchange="updateActualDose('${r.id}', this.value, document.getElementById('unit-${r.id}').value)"
                    style="width:90px;padding:4px;border:1px solid #ddd;border-radius:4px;" /></td>
                  <td>
                    <select id="unit-${r.id}"
                      onchange="updateActualDose('${r.id}', document.querySelector('[data-usage-input=${r.id}]').value, this.value)"
                      style="padding:4px;border:1px solid #ddd;border-radius:4px;">
                      <option value="kg" ${r.actual_unit==='kg'?'selected':''}>kg</option>
                      <option value="g/100m" ${r.actual_unit==='g/100m'?'selected':''}>g/100m</option>
                    </select>
                  </td>
                  <td class="converted">${Number(r.actual_dose||0).toFixed(2)}</td>
                  <td class="dev">${Number(r.deviation_pct||0).toFixed(2)}%</td>
                  <td class="status" style="${r.is_out_of_spec ? 'color:#dc2626;font-weight:bold;' : ''}">
                    ${r.is_out_of_spec ? '⚠️ 超标' : '正常'}
                  </td>
                  <td>
                    <button onclick="editAuxUsage('${r.id}')" data-role="operator">编辑</button>
                    <button onclick="deleteAuxUsage('${r.id}')" data-role="admin">删除</button>
                  </td>
                </tr>`;
            }).join("") : `<tr><td colspan="10" style="text-align:center;color:#999;font-size:12px;">暂无助剂</td></tr>`}
            </tbody>
          </table>`;

        return `
          <div class="stage-block" style="margin:10px 0 14px 12px;padding:10px 12px;background:#f9fafb;border-left:4px solid #3b82f6;border-radius:6px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
              <div style="font-weight:bold;color:#1e3a8a;">🧪 阶段 ${st}</div>
              <div>
                <button onclick="renameStage('${proc.id}','${st}')" data-role="operator"
                  style="padding:2px 8px;font-size:12px;margin-right:4px;">✎ 重命名</button>
                <button onclick="deleteStage('${proc.id}','${st}')" data-role="admin"
                  style="padding:2px 8px;font-size:12px;">删除阶段</button>
              </div>
            </div>

            <div style="font-size:12px;color:#0369a1;font-weight:bold;margin:6px 0 4px;">
              📊 工艺参数
              <button onclick="openAddParamModal('${proc.id}','${st}')" data-role="operator"
                style="margin-left:6px;padding:2px 8px;font-size:12px;">+ 参数</button>
            </div>
            ${paramsHtml}

            <div style="font-size:12px;color:#166534;font-weight:bold;margin:10px 0 4px;">
              🧪 助剂投料
              <button onclick="openAddAuxModal('${proc.id}','${st}')" data-role="operator"
                style="margin-left:6px;padding:2px 8px;font-size:12px;">+ 助剂</button>
            </div>
            ${auxHtml}
          </div>`;
      }).join("");

      return `
        <div class="dash-section" style="margin-bottom:16px;">
          <div class="dash-section-head">
            <h2>
              工序 ${proc.seq}. ${proc.process_name}
              <span style="font-size:13px;color:#666;font-weight:normal;">
                | ${proc.machine || "—"} | ${proc.operator || "—"} | ${statusLabel(proc.status)}
              </span>
            </h2>
            <div>
              <button onclick="moveProcessUp('${proc.id}')" data-role="operator">↑</button>
              <button onclick="moveProcessDown('${proc.id}')" data-role="operator">↓</button>
              <button onclick="openAddProcessModal(${proc.seq})" data-role="operator">+ 插入</button>
              <button onclick="skipProcess('${proc.id}')" data-role="operator">跳过</button>
              <button onclick="openEditProcessModal('${proc.id}')" data-role="operator">编辑</button>
              <button onclick="deleteProcess('${proc.id}')" data-role="admin">删除</button>
            </div>
          </div>
          <div style="font-size:12px;color:#666;margin-bottom:8px;">
            要求: ${proc.standard_note || "—"} | 
            开始: ${fmtTime(proc.start_time) || "—"} | 
            结束: ${fmtTime(proc.end_time) || "—"} | 
            结果: ${proc.result || "—"}
          </div>
          ${stageHtml}
          <button onclick="addStage('${proc.id}')" data-role="operator"
            style="margin-top:8px;padding:6px 12px;background:#eef2ff;color:#1e40af;border:1px solid #c7d2fe;border-radius:6px;cursor:pointer;">
            + 新阶段
          </button>
        </div>`;
    }).join("");
}

// ============ 从模板生成工序 ============
async function generateProcessesFromTemplate(orderId) {
  if (!canEdit()) { alert("无权限"); return; }
  const order = allOrders.find(o => o.id === orderId);
  if (!order) return;

  const { data: exist } = await supabaseClient.from(TB.processes).select("id").eq("order_id", orderId).limit(1);
  if (exist && exist.length > 0) {
    if (!confirm("该订单已有工序，是否替换？")) return;
    await supabaseClient.from(TB.processes).delete().eq("order_id", orderId);
  }

  const dept = order.dept || "后整理";
  const { data: tpls, error: te } = await supabaseClient
    .from(TB.templates).select("*").eq("dept", dept).eq("is_active", true)
    .order("seq", { ascending: true });
  if (te || !tpls?.length) { alert("无工序模板"); return; }

  const rows = tpls.map(t => ({
    order_id: orderId, seq: t.seq, process_name: t.process_name,
    machine: t.default_machine || "", standard_note: t.default_note || "",
    status: "pending", note: t.is_optional ? "[可选工序]" : "",
  }));
  const { data: inserted, error } = await supabaseClient.from(TB.processes).insert(rows).select();
  if (error) { alert("生成工序失败: " + error.message); return; }

  const sioc = order.sioc;
  if (sioc) {
    const { data: bomHeader } = await supabaseClient
      .from(TB.bomHeaders).select("id").eq("fg_code", sioc).maybeSingle();
    if (bomHeader) {
      const bomParams = await fetchAllRows(TB.bomParams, "seq", true, q => q.eq("bom_id", bomHeader.id));
      const bomItems = await fetchAllRows(TB.bomItems, "seq", true, q => q.eq("bom_id", bomHeader.id));

      for (const proc of inserted) {
        const pParams = bomParams.filter(x => x.process_name === proc.process_name);
        const pItems = bomItems.filter(x => x.process_name === proc.process_name);

        if (pParams.length) {
          await supabaseClient.from(TB.params).insert(pParams.map(x => ({
            process_id: proc.id, stage: x.stage || "A",
            param_name: x.param_name, param_unit: x.param_unit || "",
            standard_value: x.standard_value || "", actual_value: "",
            seq: x.seq || 1,
          })));
        }
        if (pItems.length) {
          await supabaseClient.from(TB.aux).insert(pItems.map(x => ({
            process_id: proc.id, stage: x.stage || "A",
            bom_item_id: x.id, aux_code: x.aux_code || "", aux_name: x.aux_name,
            standard_dose: x.standard_dose || 0, dose_unit: x.dose_unit || "g/100m",
            tolerance_pct: x.tolerance_pct ?? 10,
            actual_value: 0, actual_unit: "kg",
            actual_dose: 0, actual_kg: 0, theory_dose: 0, theory_kg: 0,
            deviation_pct: 0, is_out_of_spec: false,
          })));
        }
      }
    }
  }
  await writeSysLog("gen_processes", `订单 ${order.contract} 生成 ${rows.length} 道工序`, order.contract);
  openOrderDetail(orderId);
}

// ============ 工序操作 ============
function openAddProcessModal(afterSeq) {
  if (!canEdit()) { alert("无权限"); return; }
  editingProcessId = null;
  document.getElementById("processModalTitle").textContent = afterSeq != null ? "插入工序" : "新增工序";
  document.getElementById("p_process_name").value = "";
  document.getElementById("p_seq").value = afterSeq != null ? Math.ceil(afterSeq + 1) : 1;
  document.getElementById("p_machine").value = "";
  document.getElementById("p_operator").value = "";
  document.getElementById("p_start_time").value = "";
  document.getElementById("p_end_time").value = "";
  document.getElementById("p_status").value = "pending";
  document.getElementById("p_standard_note").value = "";
  document.getElementById("p_result").value = "";
  document.getElementById("p_note").value = "";
  document.getElementById("processMsg").textContent = "";
  document.getElementById("processModal").style.display = "flex";
}

async function openEditProcessModal(processId) {
  if (!canEdit()) { alert("无权限"); return; }
  const { data, error } = await supabaseClient.from(TB.processes).select("*").eq("id", processId).single();
  if (error) { alert("加载失败: " + error.message); return; }
  editingProcessId = processId;
  document.getElementById("processModalTitle").textContent = "编辑工序";
  document.getElementById("p_process_name").value = data.process_name;
  document.getElementById("p_seq").value = data.seq;
  document.getElementById("p_machine").value = data.machine || "";
  document.getElementById("p_operator").value = data.operator || "";
  document.getElementById("p_start_time").value = data.start_time ? String(data.start_time).slice(0,16) : "";
  document.getElementById("p_end_time").value = data.end_time ? String(data.end_time).slice(0,16) : "";
  document.getElementById("p_status").value = data.status;
  document.getElementById("p_standard_note").value = data.standard_note || "";
  document.getElementById("p_result").value = data.result || "";
  document.getElementById("p_note").value = data.note || "";
  document.getElementById("processMsg").textContent = "";
  document.getElementById("processModal").style.display = "flex";
}

function closeProcessModal() { document.getElementById("processModal").style.display = "none"; }

async function saveProcess() {
  if (!canEdit()) { alert("无权限"); return; }
  const g = id => (document.getElementById(id)?.value || "").trim();
  const seq = Number(g("p_seq")) || 1;
  const name = g("p_process_name");
  if (!name) { document.getElementById("processMsg").textContent = "工序名必填"; return; }

  if (!editingProcessId) {
    const { data: existing } = await supabaseClient
      .from(TB.processes).select("id, seq").eq("order_id", currentOrderId)
      .gte("seq", seq).order("seq", { ascending: false });
    if (existing && existing.length) {
      for (const p of existing) {
        await supabaseClient.from(TB.processes).update({ seq: p.seq + 1 }).eq("id", p.id);
      }
    }
  }

  const payload = {
    order_id: currentOrderId,
    seq,
    process_name: name,
    machine: g("p_machine"),
    operator: g("p_operator"),
    start_time: g("p_start_time") || null,
    end_time: g("p_end_time") || null,
    status: g("p_status") || "pending",
    standard_note: g("p_standard_note"),
    result: g("p_result"),
    note: g("p_note"),
  };

  let error;
  if (editingProcessId) {
    ({ error } = await supabaseClient.from(TB.processes).update(payload).eq("id", editingProcessId));
  } else {
    ({ error } = await supabaseClient.from(TB.processes).insert(payload));
  }
  if (error) { document.getElementById("processMsg").textContent = "保存失败: " + error.message; return; }
  closeProcessModal();
  openOrderDetail(currentOrderId);
}

async function deleteProcess(processId) {
  if (!canDelete()) { alert("无权限"); return; }
  if (!confirm("确定删除该工序？（参数、助剂一起删除）")) return;
  await supabaseClient.from(TB.processes).delete().eq("id", processId);
  openOrderDetail(currentOrderId);
}

async function skipProcess(processId) {
  if (!canEdit()) { alert("无权限"); return; }
  await supabaseClient.from(TB.processes).update({ status: "skipped" }).eq("id", processId);
  openOrderDetail(currentOrderId);
}

async function moveProcessUp(processId) {
  if (!canEdit()) { alert("无权限"); return; }
  const { data: proc } = await supabaseClient.from(TB.processes).select("id, seq, order_id").eq("id", processId).single();
  if (!proc) return;
  const { data: prev } = await supabaseClient.from(TB.processes)
    .select("id, seq").eq("order_id", proc.order_id).lt("seq", proc.seq)
    .order("seq", { ascending: false }).limit(1).maybeSingle();
  if (!prev) return;
  await supabaseClient.from(TB.processes).update({ seq: prev.seq }).eq("id", proc.id);
  await supabaseClient.from(TB.processes).update({ seq: proc.seq }).eq("id", prev.id);
  openOrderDetail(proc.order_id);
}

async function moveProcessDown(processId) {
  if (!canEdit()) { alert("无权限"); return; }
  const { data: proc } = await supabaseClient.from(TB.processes).select("id, seq, order_id").eq("id", processId).single();
  if (!proc) return;
  const { data: next } = await supabaseClient.from(TB.processes)
    .select("id, seq").eq("order_id", proc.order_id).gt("seq", proc.seq)
    .order("seq", { ascending: true }).limit(1).maybeSingle();
  if (!next) return;
  await supabaseClient.from(TB.processes).update({ seq: next.seq }).eq("id", proc.id);
  await supabaseClient.from(TB.processes).update({ seq: proc.seq }).eq("id", next.id);
  openOrderDetail(proc.order_id);
}

// ============ 阶段操作 ============
async function addStage(processId) {
  if (!canEdit()) { alert("无权限"); return; }
  const stageName = prompt("新阶段名称（如 B / C / 后段）:", "");
  if (!stageName) return;
  await supabaseClient.from(TB.params).insert({
    process_id: processId, stage: stageName,
    param_name: "(占位)", param_unit: "", standard_value: "",
    actual_value: "", seq: 0,
  });
  openOrderDetail(currentOrderId);
}

async function renameStage(processId, oldStage) {
  if (!canEdit()) { alert("无权限"); return; }
  const nv = prompt("新阶段名:", oldStage);
  if (!nv || nv === oldStage) return;
  await supabaseClient.from(TB.params).update({ stage: nv }).eq("process_id", processId).eq("stage", oldStage);
  await supabaseClient.from(TB.aux).update({ stage: nv }).eq("process_id", processId).eq("stage", oldStage);
  openOrderDetail(currentOrderId);
}

async function deleteStage(processId, stage) {
  if (!canDelete()) { alert("无权限"); return; }
  if (!confirm(`确定删除阶段 ${stage} 及其所有参数、助剂？`)) return;
  await supabaseClient.from(TB.params).delete().eq("process_id", processId).eq("stage", stage);
  await supabaseClient.from(TB.aux).delete().eq("process_id", processId).eq("stage", stage);
  openOrderDetail(currentOrderId);
}

// ============ 参数 ============
function openAddParamModal(processId, stage) {
  if (!canEdit()) { alert("无权限"); return; }
  currentParamProcessId = processId;
  currentParamStage = stage || "A";
  editingParamId = null;
  document.getElementById("paramModalTitle").textContent = "新增工艺参数";
  document.getElementById("paramStageLabel").textContent = `归属阶段：${currentParamStage}`;
  document.getElementById("pa_param_name").value = "温度";
  document.getElementById("pa_param_unit").value = "";
  document.getElementById("pa_standard_value").value = "";
  document.getElementById("pa_actual_value").value = "";
  document.getElementById("pa_is_out_of_spec").checked = false;
  document.getElementById("pa_note").value = "";
  document.getElementById("paramMsg").textContent = "";
  document.getElementById("paramModal").style.display = "flex";
}

async function editProcessParam(paramId) {
  if (!canEdit()) { alert("无权限"); return; }
  const { data, error } = await supabaseClient.from(TB.params).select("*").eq("id", paramId).single();
  if (error) { alert("加载失败: " + error.message); return; }
  editingParamId = paramId;
  currentParamProcessId = data.process_id;
  currentParamStage = data.stage || "A";
  document.getElementById("paramModalTitle").textContent = "编辑工艺参数";
  document.getElementById("paramStageLabel").textContent = `归属阶段：${currentParamStage}`;
  document.getElementById("pa_param_name").value = data.param_name;
  document.getElementById("pa_param_unit").value = data.param_unit || "";
  document.getElementById("pa_standard_value").value = data.standard_value || "";
  document.getElementById("pa_actual_value").value = data.actual_value || "";
  document.getElementById("pa_is_out_of_spec").checked = !!data.is_out_of_spec;
  document.getElementById("pa_note").value = data.note || "";
  document.getElementById("paramModal").style.display = "flex";
}

function closeParamModal() { document.getElementById("paramModal").style.display = "none"; }

async function saveProcessParam() {
  if (!canEdit()) { alert("无权限"); return; }
  const name = document.getElementById("pa_param_name").value.trim();
  const unit = document.getElementById("pa_param_unit").value.trim();
  const std = document.getElementById("pa_standard_value").value.trim();
  const act = document.getElementById("pa_actual_value").value.trim();
  const oos = document.getElementById("pa_is_out_of_spec").checked;
  const note = document.getElementById("pa_note").value.trim();
  if (!name) { document.getElementById("paramMsg").textContent = "参数名必填"; return; }

  const payload = {
    process_id: currentParamProcessId,
    stage: currentParamStage,
    param_name: name, param_unit: unit,
    standard_value: std, actual_value: act,
    is_out_of_spec: oos, note: note,
  };

  let error;
  if (editingParamId) {
    ({ error } = await supabaseClient.from(TB.params).update(payload).eq("id", editingParamId));
  } else {
    const { data: last } = await supabaseClient.from(TB.params).select("seq")
      .eq("process_id", currentParamProcessId).eq("stage", currentParamStage)
      .order("seq", { ascending: false }).limit(1).maybeSingle();
    payload.seq = (last?.seq || 0) + 1;
    ({ error } = await supabaseClient.from(TB.params).insert(payload));
  }
  if (error) { document.getElementById("paramMsg").textContent = "保存失败: " + error.message; return; }
  await writeSysLog(editingParamId ? "edit_param" : "add_param", `${editingParamId?"编辑":"新增"}工艺参数 ${name}`, null);
  closeParamModal();
  openOrderDetail(currentOrderId);
}

async function deleteProcessParam(paramId) {
  if (!canDelete()) { alert("无权限"); return; }
  if (!confirm("确定删除该工艺参数？")) return;
  await supabaseClient.from(TB.params).delete().eq("id", paramId);
  openOrderDetail(currentOrderId);
}

async function updateProcessParam(paramId, newVal) {
  const { data } = await supabaseClient.from(TB.params)
    .select("standard_value, param_name").eq("id", paramId).single();
  const std = String(data?.standard_value || "").trim();
  const act = String(newVal || "").trim();

  let isOOS = false;
  const stdNum = parseFloat(std), actNum = parseFloat(act);
  if (!isNaN(stdNum) && !isNaN(actNum) && stdNum !== 0) {
    const devPct = Math.abs((actNum - stdNum) / stdNum) * 100;
    isOOS = devPct > 10;
  }

  const { error } = await supabaseClient.from(TB.params).update({
    actual_value: act, is_out_of_spec: isOOS,
  }).eq("id", paramId);
  if (error) { alert("更新失败: " + error.message); return; }
  if (isOOS) await writeSysLog("param_oos", `工艺参数超标: ${data.param_name} 标准 ${std} 实际 ${act}`, null);

  const row = document.querySelector(`[data-param-id="${paramId}"]`);
  if (row) {
    row.style.background = isOOS ? "#fee2e2" : "";
    const st = row.querySelector("td:nth-child(5)");
    if (st) {
      st.textContent = isOOS ? "⚠️ 超标" : "正常";
      st.style.color = isOOS ? "#dc2626" : "";
      st.style.fontWeight = isOOS ? "bold" : "";
    }
  }
}

// ============ 助剂 ============
function openAddAuxModal(processId, stage) {
  if (!canEdit()) { alert("无权限"); return; }
  currentAuxProcessId = processId;
  currentAuxStage = stage || "A";
  editingAuxId = null;
  document.getElementById("auxModalTitle").textContent = "新增助剂投料";
  document.getElementById("auxStageLabel").textContent = `归属阶段：${currentAuxStage}`;
  document.getElementById("ax_code").value = "";
  document.getElementById("ax_name").value = "";
  document.getElementById("ax_standard_dose").value = "";
  document.getElementById("ax_dose_unit").value = "g/100m";
  document.getElementById("ax_tolerance_pct").value = "10";
  document.getElementById("ax_note").value = "";
  document.getElementById("auxMsg").textContent = "";
  document.getElementById("auxModal").style.display = "flex";
}

async function editAuxUsage(auxId) {
  if (!canEdit()) { alert("无权限"); return; }
  const { data, error } = await supabaseClient.from(TB.aux).select("*").eq("id", auxId).single();
  if (error) { alert("加载失败: " + error.message); return; }
  editingAuxId = auxId;
  currentAuxProcessId = data.process_id;
  currentAuxStage = data.stage || "A";
  document.getElementById("auxModalTitle").textContent = "编辑助剂投料";
  document.getElementById("auxStageLabel").textContent = `归属阶段：${currentAuxStage}`;
  document.getElementById("ax_code").value = data.aux_code || "";
  document.getElementById("ax_name").value = data.aux_name || "";
  document.getElementById("ax_standard_dose").value = data.standard_dose || 0;
  document.getElementById("ax_dose_unit").value = data.dose_unit || "g/100m";
  document.getElementById("ax_tolerance_pct").value = data.tolerance_pct ?? 10;
  document.getElementById("ax_note").value = data.note || "";
  document.getElementById("auxModal").style.display = "flex";
}

function closeAuxModal() { document.getElementById("auxModal").style.display = "none"; }

async function saveAuxUsage() {
  if (!canEdit()) { alert("无权限"); return; }
  const code = document.getElementById("ax_code").value.trim();
  const name = document.getElementById("ax_name").value.trim();
  const std = Number(document.getElementById("ax_standard_dose").value) || 0;
  const unit = document.getElementById("ax_dose_unit").value.trim() || "g/100m";
  const tol = Number(document.getElementById("ax_tolerance_pct").value) || 10;
  const note = document.getElementById("ax_note").value.trim();
  if (!name) { document.getElementById("auxMsg").textContent = "助剂名必填"; return; }

  const payload = {
    process_id: currentAuxProcessId,
    stage: currentAuxStage,
    aux_code: code, aux_name: name,
    standard_dose: std, dose_unit: unit, tolerance_pct: tol,
    note: note,
  };

  let error;
  if (editingAuxId) {
    ({ error } = await supabaseClient.from(TB.aux).update(payload).eq("id", editingAuxId));
  } else {
    payload.actual_value = 0; payload.actual_unit = "kg";
    payload.actual_dose = 0; payload.actual_kg = 0;
    payload.theory_dose = 0; payload.theory_kg = 0;
    payload.deviation_pct = 0; payload.is_out_of_spec = false;
    ({ error } = await supabaseClient.from(TB.aux).insert(payload));
  }
  if (error) { document.getElementById("auxMsg").textContent = "保存失败: " + error.message; return; }
  closeAuxModal();
  openOrderDetail(currentOrderId);
}

async function deleteAuxUsage(auxId) {
  if (!canDelete()) { alert("无权限"); return; }
  if (!confirm("确定删除该助剂？")) return;
  await supabaseClient.from(TB.aux).delete().eq("id", auxId);
  openOrderDetail(currentOrderId);
}

async function updateActualDose(usageId, actualValue, actualUnit) {
  const { data: usage } = await supabaseClient.from(TB.aux)
    .select("standard_dose, tolerance_pct, process_id").eq("id", usageId).single();
  if (!usage) return;
  const std = Number(usage.standard_dose) || 0;
  const tol = Number(usage.tolerance_pct) || 10;

  const { data: proc } = await supabaseClient.from(TB.processes)
    .select("order_id").eq("id", usage.process_id).single();
  const order = allOrders.find(o => o.id === proc?.order_id);
  const billetM = Number(order?.actual_billet_qty_m) || 0;

  const theoryG = theoryKg(std, billetM) * 1000;
  const theoryKgVal = theoryKg(std, billetM);
  const actualG = convertToGPer100m(actualValue, actualUnit, billetM);
  const actualKgVal = actualUnit === "kg"
    ? (Number(actualValue) || 0)
    : (Number(actualValue) || 0) * billetM / 100 / 1000;

  let devPct = 0, isOOS = false;
  if (theoryKgVal > 0) {
    devPct = ((actualKgVal - theoryKgVal) / theoryKgVal) * 100;
    isOOS = Math.abs(devPct) > tol;
  }

  const { error } = await supabaseClient.from(TB.aux).update({
    actual_value: Number(actualValue) || 0,
    actual_unit: actualUnit,
    actual_dose: actualG,
    actual_kg: actualKgVal,
    theory_dose: theoryG,
    theory_kg: theoryKgVal,
    deviation_pct: devPct,
    is_out_of_spec: isOOS,
  }).eq("id", usageId);
  if (error) { alert("更新失败: " + error.message); return; }

  if (isOOS) {
    await writeSysLog("aux_oos",
      `助剂超标: 理论 ${theoryKgVal.toFixed(3)}kg, 实际 ${actualKgVal.toFixed(3)}kg, 偏差 ${devPct.toFixed(2)}%, 容差 ±${tol}%`,
      order?.contract);
  }

  const row = document.querySelector(`[data-usage-id="${usageId}"]`);
  if (row) {
    row.style.background = isOOS ? "#fee2e2" : "";
    const c = row.querySelector(".converted");
    if (c) c.textContent = actualG.toFixed(2);
    const d = row.querySelector(".dev");
    if (d) d.textContent = devPct.toFixed(2) + "%";
    const st = row.querySelector(".status");
    if (st) {
      st.textContent = isOOS ? "⚠️ 超标" : "正常";
      st.style.color = isOOS ? "#dc2626" : "";
      st.style.fontWeight = isOOS ? "bold" : "";
    }
  }
}

// ============ BOM 管理 ============
async function showBomPage() {
  hideAll();
  document.getElementById("bomPage").style.display = "block";
  document.getElementById("userEmailBom").textContent = document.getElementById("userEmail2").textContent;
  await loadBoms();
}

async function loadBoms() {
  try {
    allBoms = await fetchAllRows(TB.bomHeaders, "fg_code", true);
    allBoms.sort((a,b) => (a.fg_code||"").localeCompare(b.fg_code||""));
  } catch (e) { alert("加载 BOM 失败: " + e.message); return; }
  filteredBoms = allBoms;
  currentBomPage = 1;
  renderBoms();
}

function renderBoms() {
  const total = filteredBoms.length;
  const totalPages = Math.max(1, Math.ceil(total / BOM_PAGE_SIZE));
  if (currentBomPage > totalPages) currentBomPage = totalPages;
  const start = (currentBomPage - 1) * BOM_PAGE_SIZE;
  const pageItems = filteredBoms.slice(start, start + BOM_PAGE_SIZE);

  document.getElementById("bomBody").innerHTML = pageItems.map((b, idx) => `
    <tr>
      <td>${start+idx+1}</td>
      <td>${b.fg_code}</td>
      <td>${b.fg_name || ""}</td>
      <td>${b.category || ""}</td>
      <td>${b.is_active ? "启用" : "停用"}</td>
      <td>
        <button class="in" onclick="openBomDetail('${b.id}')">查看</button>
        <button class="del" onclick="deleteBom('${b.id}')" data-role="admin">删除</button>
      </td>
    </tr>
  `).join("") || `<tr><td colspan="6" style="text-align:center;color:#999;">暂无 BOM</td></tr>`;

  document.getElementById("bomPageInfo").textContent = `${currentBomPage} / ${totalPages}  (${total})`;
}

function bomPrevPage() { if (currentBomPage > 1) { currentBomPage--; renderBoms(); } }
function bomNextPage() {
  const tp = Math.ceil(filteredBoms.length / BOM_PAGE_SIZE);
  if (currentBomPage < tp) { currentBomPage++; renderBoms(); }
}

async function openBomDetail(bomId) {
  const bom = allBoms.find(b => b.id === bomId);
  if (!bom) return;
  document.getElementById("bomDetailTitle").textContent = `BOM: ${bom.fg_code} ${bom.fg_name||""}`;

  const items = await fetchAllRows(TB.bomItems, "seq", true, q => q.eq("bom_id", bomId));
  const params = await fetchAllRows(TB.bomParams, "seq", true, q => q.eq("bom_id", bomId));

  // 助剂表
  const auxHtml = `
    <div style="font-weight:bold;margin:10px 0 6px;">助剂明细</div>
    <table class="data-table" style="font-size:13px;">
      <thead><tr><th>#</th><th>工序</th><th>阶段</th><th>助剂编号</th><th>助剂名</th><th>标准 g/100m</th><th>单位</th></tr></thead>
      <tbody>
      ${items.length ? items.map((it, i) => `
        <tr>
          <td>${i+1}</td>
          <td>${it.process_name}</td>
          <td>${it.stage || "A"}</td>
          <td>${it.aux_code || ""}</td>
          <td>${it.aux_name}</td>
          <td>${Number(it.standard_dose||0).toFixed(3)}</td>
          <td>${it.dose_unit || ""}</td>
        </tr>
      `).join("") : `<tr><td colspan="7" style="text-align:center;color:#999;">暂无助剂</td></tr>`}
      </tbody>
    </table>`;

  // 参数表
  const paramHtml = `
    <div style="font-weight:bold;margin:16px 0 6px;">参数明细</div>
    <table class="data-table" style="font-size:13px;">
      <thead><tr><th>#</th><th>工序</th><th>阶段</th><th>参数名</th><th>单位</th><th>标准值</th></tr></thead>
      <tbody>
      ${params.length ? params.map((p, i) => `
        <tr>
          <td>${i+1}</td>
          <td>${p.process_name}</td>
          <td>${p.stage || "A"}</td>
          <td>${p.param_name}</td>
          <td>${p.param_unit || ""}</td>
          <td>${p.standard_value || ""}</td>
        </tr>
      `).join("") : `<tr><td colspan="6" style="text-align:center;color:#999;">暂无参数</td></tr>`}
      </tbody>
    </table>`;

  document.getElementById("bomDetailBody").innerHTML = auxHtml + paramHtml;
  document.getElementById("bomDetailModal").style.display = "flex";
}
function closeBomDetailModal() { document.getElementById("bomDetailModal").style.display = "none"; }

async function deleteBom(bomId) {
  if (!canDelete()) { alert("无权限"); return; }
  if (!confirm("确定删除该 BOM？（明细一起删除）")) return;
  await supabaseClient.from(TB.bomHeaders).delete().eq("id", bomId);
  await loadBoms();
}

// ============ BOM 导入 ============
function openBomImportModal() {
  document.getElementById("bomItemsFile").value = "";
  document.getElementById("bomParamsFile").value = "";
  document.getElementById("bomImportMsg").textContent = "";
  document.getElementById("bomImportModal").style.display = "flex";
}
function closeBomImportModal() { document.getElementById("bomImportModal").style.display = "none"; }

function downloadBomItemsTemplate() {
  const headers = ["sioc","process_name","stage","aux_code","aux_name","standard_dose","dose_unit","tolerance_pct"];
  const sample = [
    ["FG-CV-00055","退浆","A","RM-AD-00002","209退浆用洗涤剂","192.036","g/100m","10"],
    ["FG-CV-00055","退浆","B","RM-AD-00034","退浆酶","522.622","g/100m","10"],
    ["FG-CV-00055","定型1","A","RM-AD-00005","NKC催化剂","30.018","g/100m","10"],
    ["FG-CV-00055","定型2","A","RM-AD-00028","平滑柔软剂","295.225","g/100m","10"],
  ];
  downloadCSV([headers, ...sample], "bom_items_template.csv");
}

function downloadBomParamsTemplate() {
  const headers = ["sioc","process_name","stage","param_name","param_unit","standard_value"];
  const sample = [
    ["FG-CV-00055","退浆","A","温度","℃","98"],
    ["FG-CV-00055","退浆","A","时间","min","45"],
    ["FG-CV-00055","退浆","A","pH值","-","5.5"],
    ["FG-CV-00055","定型1","A","车速","m/min","60"],
    ["FG-CV-00055","定型1","A","温度","℃","180"],
    ["FG-CV-00055","定型1","A","门幅","cm","150"],
    ["FG-CV-00055","定型2","A","车速","m/min","70"],
    ["FG-CV-00055","定型2","A","温度","℃","170"],
  ];
  downloadCSV([headers, ...sample], "bom_params_template.csv");
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g,""));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].match(/("([^"]|"")*"|[^,]*)(,|$)/g)
      .map(c => c.replace(/,$/,"").replace(/^"|"$/g,"").replace(/""/g,'"'));
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = cols[idx] ?? ""; });
    rows.push(obj);
  }
  return rows;
}

async function doBomImport() {
  const itemsFile = document.getElementById("bomItemsFile").files[0];
  const paramsFile = document.getElementById("bomParamsFile").files[0];
  const msg = document.getElementById("bomImportMsg");

  if (!itemsFile && !paramsFile) { msg.textContent = "至少选择一个 CSV"; return; }

  let itemsRows = [];
  let paramsRows = [];
  if (itemsFile) itemsRows = parseCSV(await itemsFile.text());
  if (paramsFile) paramsRows = parseCSV(await paramsFile.text());

  // 收集所有涉及的 sioc
  const siocs = new Set();
  itemsRows.forEach(r => r.sioc && siocs.add(r.sioc));
  paramsRows.forEach(r => r.sioc && siocs.add(r.sioc));
  if (!siocs.size) { msg.textContent = "没有有效数据"; return; }

  msg.textContent = `导入 ${siocs.size} 个 BOM...`;

  let ok = 0, failed = 0;
  for (const sioc of siocs) {
    // upsert BOM header
    let bomId;
    const { data: exist } = await supabaseClient.from(TB.bomHeaders)
      .select("id").eq("fg_code", sioc).maybeSingle();
    if (exist) {
      bomId = exist.id;
      // 删掉旧的明细
      await supabaseClient.from(TB.bomItems).delete().eq("bom_id", bomId);
      await supabaseClient.from(TB.bomParams).delete().eq("bom_id", bomId);
    } else {
      const { data: ins, error } = await supabaseClient.from(TB.bomHeaders)
        .insert({ fg_code: sioc }).select().single();
      if (error) { failed++; continue; }
      bomId = ins.id;
      ok++;
    }

    // 助剂
    const its = itemsRows.filter(r => r.sioc === sioc);
    if (its.length) {
      const payload = its.map((r, i) => ({
        bom_id: bomId,
        seq: i + 1,
        process_name: r.process_name || "",
        stage: r.stage || "A",
        aux_code: r.aux_code || "",
        aux_name: r.aux_name || "",
        standard_dose: Number(r.standard_dose) || 0,
        dose_unit: r.dose_unit || "g/100m",
        tolerance_pct: Number(r.tolerance_pct) || 10,
      }));
      const CHUNK = 500;
      for (let i = 0; i < payload.length; i += CHUNK) {
        const { error: e } = await supabaseClient.from(TB.bomItems).insert(payload.slice(i, i+CHUNK));
        if (e) { failed++; break; }
      }
    }

    // 参数
    const prs = paramsRows.filter(r => r.sioc === sioc);
    if (prs.length) {
      const payload = prs.map((r, i) => ({
        bom_id: bomId,
        process_name: r.process_name || "",
        stage: r.stage || "A",
        param_name: r.param_name || "",
        param_unit: r.param_unit || "",
        standard_value: r.standard_value || "",
        seq: i + 1,
      }));
      const { error: e } = await supabaseClient.from(TB.bomParams).insert(payload);
      if (e) { failed++; }
    }
  }
  msg.textContent = `✅ 完成\n新增 BOM: ${ok}\n失败: ${failed}`;
  await writeSysLog("bom_import", `BOM 导入: 新增 ${ok}, 失败 ${failed}`, null);
  setTimeout(() => { closeBomImportModal(); loadBoms(); }, 1500);
}

// ============ 报表 / 操作记录 / 系统日志 ============
async function showReport() {
  hideAll();
  document.getElementById("reportPage").style.display = "block";
  document.getElementById("userEmailReport").textContent = document.getElementById("userEmail2").textContent;
  const now = new Date();
  document.getElementById("reportMonth").value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
  loadReport();
}

async function loadReport() {
  const month = document.getElementById("reportMonth").value;
  if (!month) return;
  const [y, m] = month.split("-").map(Number);
  const first = `${month}-01`;
  const last = new Date(y, m, 0).toISOString().slice(0,10);

  const orders = allOrders.filter(o => o.order_date && o.order_date >= first && o.order_date <= last);
  const orderIds = orders.map(o => o.id);

  let processes = [], params = [], aux = [];
  if (orderIds.length) {
    processes = await fetchAllRows(TB.processes, "seq", true, q => q.in("order_id", orderIds));
    const pids = processes.map(p => p.id);
    if (pids.length) {
      params = await fetchAllRows(TB.params, "seq", true, q => q.in("process_id", pids));
      aux = await fetchAllRows(TB.aux, "created_at", true, q => q.in("process_id", pids));
    }
  }

  const procByOrder = {}, paramByProc = {}, auxByProc = {};
  processes.forEach(p => { if (!procByOrder[p.order_id]) procByOrder[p.order_id] = []; procByOrder[p.order_id].push(p); });
  params.forEach(pa => { if (!paramByProc[pa.process_id]) paramByProc[pa.process_id] = []; paramByProc[pa.process_id].push(pa); });
  aux.forEach(a => { if (!auxByProc[a.process_id]) auxByProc[a.process_id] = []; auxByProc[a.process_id].push(a); });

  let totalOOS = 0;
  document.getElementById("reportBody").innerHTML = orders.map(o => {
    const procs = procByOrder[o.id] || [];
    const ps = procs.flatMap(p => paramByProc[p.id] || []);
    const as = procs.flatMap(p => auxByProc[p.id] || []);
    const oos = ps.filter(x => x.is_out_of_spec).length + as.filter(x => x.is_out_of_spec).length;
    totalOOS += oos;
    return `
      <tr>
        <td>${o.contract}</td>
        <td>${o.customer || ""}</td>
        <td>${o.sioc || ""}</td>
        <td>${o.color_name || ""}</td>
        <td>${statusLabel(o.status)}</td>
        <td>${procs.length}</td>
        <td>${ps.length}</td>
        <td>${as.length}</td>
        <td style="color:${oos>0?'#dc2626':'#333'};font-weight:${oos>0?'bold':'normal'};">${oos}</td>
      </tr>`;
  }).join("") || `<tr><td colspan="9" style="text-align:center;color:#999;">本月无数据</td></tr>`;

  document.getElementById("repOrders").textContent = orders.length;
  document.getElementById("repDone").textContent = orders.filter(o => o.status === "done").length;
  document.getElementById("repOOS").textContent = totalOOS;
}

async function showLogs() {
  hideAll();
  document.getElementById("logsPage").style.display = "block";
  document.getElementById("userEmailLogs").textContent = document.getElementById("userEmail2").textContent;
  const data = await fetchAllRows(TB.logs, "created_at", false);
  document.getElementById("logBody").innerHTML = (data || []).map((l, idx) => `
    <tr>
      <td>${idx+1}</td>
      <td>${fmtTime(l.created_at)}</td>
      <td>${l.user_email || ""}</td>
      <td>${l.action}</td>
      <td>${l.ref_no || ""}</td>
      <td>${esc(l.detail)}</td>
    </tr>`).join("") || `<tr><td colspan="6" style="text-align:center;color:#999;">暂无记录</td></tr>`;
}

async function showSysLogs() {
  hideAll();
  document.getElementById("sysLogsPage").style.display = "block";
  document.getElementById("userEmailSysLogs").textContent = document.getElementById("userEmail2").textContent;
  const data = await fetchAllRows(TB.logs, "created_at", false);
  document.getElementById("sysLogBody").innerHTML = (data || []).map((l, idx) => `
    <tr>
      <td>${idx+1}</td>
      <td>${fmtTime(l.created_at)}</td>
      <td>${l.user_email || ""}</td>
      <td>${l.action}</td>
      <td>${esc(l.detail)}</td>
    </tr>`).join("") || `<tr><td colspan="5" style="text-align:center;color:#999;">暂无日志</td></tr>`;
}

// ============ 备份 ============
async function backupAll() {
  if (currentUserRole !== "admin") { alert("仅管理员可备份"); return; }
  const stamp = new Date().toISOString().slice(0,10);
  try {
    const orders = await fetchAllRows(TB.orders, "created_at", false);
    const processes = await fetchAllRows(TB.processes, "created_at", false);
    const params = await fetchAllRows(TB.params, "created_at", false);
    const aux = await fetchAllRows(TB.aux, "created_at", false);
    const dump = (rows, filename) => {
      if (!rows.length) { downloadCSV([["(empty)"]], filename); return; }
      const headers = Object.keys(rows[0]);
      downloadCSV([headers, ...rows.map(r => headers.map(h => r[h]))], filename);
    };
    dump(orders, `craft_orders_${stamp}.csv`);
    dump(processes, `craft_processes_${stamp}.csv`);
    dump(params, `craft_params_${stamp}.csv`);
    dump(aux, `craft_aux_${stamp}.csv`);
    alert("备份完成");
  } catch (e) { alert("备份失败: " + e.message); }
}

// ============ 修改密码 ============
function openPwdModal() {
  document.getElementById("pwd_new").value = "";
  document.getElementById("pwd_confirm").value = "";
  document.getElementById("pwdMsg").textContent = "";
  document.getElementById("pwdModal").style.display = "flex";
}
function closePwdModal() { document.getElementById("pwdModal").style.display = "none"; }
async function savePassword() {
  const np = document.getElementById("pwd_new").value;
  const cp = document.getElementById("pwd_confirm").value;
  const msg = document.getElementById("pwdMsg");
  if (!np || np.length < 6) { msg.textContent = "密码至少 6 位"; return; }
  if (np !== cp) { msg.textContent = "两次不一致"; return; }
  const { error } = await supabaseClient.auth.updateUser({ password: np });
  if (error) { msg.textContent = "修改失败: " + error.message; return; }
  alert("密码修改成功");
  closePwdModal();
}

// ============ 启动 ============
(async function init() {
  initLang();
  const remembered = localStorage.getItem("remember_email");
  const { data } = await supabaseClient.auth.getSession();
  if (data.session && remembered) {
    await loadUserRole();
    document.getElementById("loginPage").style.display = "none";
    document.getElementById("dashboardPage").style.display = "block";
    document.getElementById("userEmail2").textContent = data.session.user.email;
    document.getElementById("userEmail").textContent = data.session.user.email;
    await loadOrders();
    goToDashboard();
    return;
  }
  document.getElementById("loginPage").style.display = "flex";
  if (remembered) {
    document.getElementById("email").value = remembered;
    document.getElementById("rememberMe").checked = true;
  }
})();