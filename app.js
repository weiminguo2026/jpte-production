// ============================================================
// 工艺记录系统 v20261016 — 后整理部门
// 中英双语 + 22列清单 + 助剂英文名 + 1位小数 + 按钮布局
// ============================================================

// ============ 配置 ============
const SUPABASE_URL = 'https://hxgrpamlyujltvghhftf.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_fYDSZNCcFJEQwSKha9W5_w_x65TrlIj';
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 工艺记录系统 v20261016-B — 合同 + 生产批次
// 全量中英双语 + 22列清单 + 助剂英文名 + 1位小数 + 打印A4横向 + 参数3列


const TB = {
  orders:      "craft_orders",
  batches:     "craft_production_batches",
  processes:   "craft_processes",
  params:      "craft_process_params",
  aux:         "craft_order_aux_usage",
  templates:   "craft_process_templates",
  bomHeaders:  "craft_bom_headers",
  bomItems:    "craft_bom_items",
  bomParams:   "craft_bom_params",
  logs:        "craft_logs",
};

let currentLang = "zh";
let currentUserRole = "viewer";
let allOrders = [];
let filteredOrders = [];
let currentPage = 1;
let PAGE_SIZE = 20;
let editingOrderId = null;
let currentOrderId = null;
let currentBatchId = null;
let allBatches = [];           // 当前合同下的批次缓存
let editingBatchId = null;
let editingProcessId = null;
let currentParamProcessId = null;
let currentParamStage = "A";
let editingParamId = null;
let currentAuxProcessId = null;
let currentAuxStage = "A";
let editingAuxId = null;
let copySourceOrderId = null;
let selectedOrderIds = new Set();

let allBoms = [], filteredBoms = [];
let currentBomPage = 1;
const BOM_PAGE_SIZE = 20;

let allBomItemsCache = [], allBomParamsCache = [];
let currentBomIdForEdit = null;
let editingBomItemId = null;
let editingBomParamId = null;
let editingBomHeaderId = null;

let allLogsCache = [];
let allOOSParam = [], allOOSAux = [];

// ============ 工具 ============
function t(zh, en) { return currentLang === "zh" ? zh : en; }
function esc(s) { return String(s || "").replace(/"/g, "&quot;"); }
function fmtTime(iso) { return iso ? String(iso).slice(0,16).replace("T"," ") : ""; }
function todayStr() { return new Date().toISOString().slice(0,10); }
function n1(v) { return (Number(v) || 0).toFixed(1); }

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
  if (s === "pending")     return t("待处理", "Pending");
  if (s === "in_progress") return t("进行中", "In Progress");
  if (s === "done")        return t("已完成", "Done");
  if (s === "cancelled")   return t("已取消", "Cancelled");
  if (s === "skipped")     return t("跳过", "Skipped");
  return s;
}
function scrollToTop() {
  const el = document.querySelector(".table-wrap");
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ============ 语言 ============
function toggleLang() {
  currentLang = currentLang === "zh" ? "en" : "zh";
  document.querySelectorAll("[data-zh]").forEach(el => {
    el.textContent = el.getAttribute("data-" + currentLang);
  });
  document.querySelectorAll("option[data-zh]").forEach(el => {
    el.textContent = el.getAttribute("data-" + currentLang);
  });
  document.querySelectorAll("[data-ph-zh]").forEach(el => {
    el.placeholder = el.getAttribute("data-ph-" + currentLang);
  });

  const dash = document.getElementById("dashboardPage");
  const main = document.getElementById("mainPage");
  const detail = document.getElementById("orderDetailPage");
  const batchD = document.getElementById("batchDetailPage");
  const bom = document.getElementById("bomPage");
  const report = document.getElementById("reportPage");
  const oos = document.getElementById("oosPage");
  const logs = document.getElementById("logsPage");
  const syslogs = document.getElementById("sysLogsPage");

  if (dash && dash.style.display !== "none") loadDashboard();
  if (main && main.style.display !== "none") renderOrders();
  if (detail && detail.style.display !== "none" && currentOrderId) openOrderDetail(currentOrderId);
  if (batchD && batchD.style.display !== "none" && currentBatchId) openBatchDetail(currentBatchId);
  if (bom && bom.style.display !== "none") renderBoms();
  if (report && report.style.display !== "none") loadReport();
  if (oos && oos.style.display !== "none") loadOOS();
  if (logs && logs.style.display !== "none") filterLogs();
  if (syslogs && syslogs.style.display !== "none") showSysLogs();
}

function initLang() {
  document.querySelectorAll("[data-zh]").forEach(el => {
    el.textContent = el.getAttribute("data-" + currentLang);
  });
  document.querySelectorAll("[data-ph-zh]").forEach(el => {
    el.placeholder = el.getAttribute("data-ph-" + currentLang);
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
  if (btn) { btn.disabled = true; btn.textContent = t("登录中...","Signing in..."); }
  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) { msg.textContent = t("登录失败: ","Login failed: ") + error.message; return; }
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
    if (btn) { btn.disabled = false; btn.textContent = t("登录","Login"); }
  }
}
async function logout() {
  await supabaseClient.auth.signOut();
  document.getElementById("loginPage").style.display = "flex";
  ["dashboardPage","mainPage","orderDetailPage","batchDetailPage","bomPage","reportPage","oosPage","logsPage","sysLogsPage"].forEach(id => {
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
  ["dashboardPage","mainPage","orderDetailPage","batchDetailPage","bomPage","reportPage","oosPage","logsPage","sysLogsPage"].forEach(id => {
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
function openOrderDetailFromBatch() {
  if (currentOrderId) openOrderDetail(currentOrderId);
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

// ============ 合同清单 ============
async function loadOrders() {
  try {
    allOrders = await fetchAllRows(TB.orders, "created_at", false);
  } catch (err) { alert(t("加载失败: ","Load failed: ") + err.message); return; }
  filteredOrders = allOrders;
  currentPage = 1;
  renderOrders();
}

// 缓存合同 → 已生产米数
let orderProducedCache = {};

async function refreshOrderProducedCache() {
  try {
    const batches = await fetchAllRows(TB.batches, "created_at", false);
    orderProducedCache = {};
    batches.forEach(b => {
      const k = b.order_id;
      orderProducedCache[k] = (orderProducedCache[k] || 0) + (Number(b.batch_billet_m) || 0);
    });
  } catch (e) { console.warn(e); }
}

function renderOrders() {
  const keyword = (document.getElementById("searchInput")?.value || "").trim().toLowerCase();
  const status = document.getElementById("statusFilter")?.value || "";
  const hideDone = document.getElementById("hideDone")?.checked || false;

  filteredOrders = allOrders.filter(o => {
    if (hideDone && (o.status === "done" || o.status === "cancelled")) return false;
    if (status && o.status !== status) return false;
    if (keyword) {
      const kw =
        (o.contract || "").toLowerCase().includes(keyword) ||
        (o.customer || "").toLowerCase().includes(keyword) ||
        (o.sioc || "").toLowerCase().includes(keyword) ||
        (o.pattern_no || "").toLowerCase().includes(keyword) ||
        (o.color_name || "").toLowerCase().includes(keyword) ||
        (o.fabric_number || "").toLowerCase().includes(keyword);
      if (!kw) return false;
    }
    return true;
  });

  const total = filteredOrders.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageItems = filteredOrders.slice(start, start + PAGE_SIZE);

  document.getElementById("orderBody").innerHTML = pageItems.map((o, idx) => {
    const seq = start + idx + 1;
    let statusStyle = "";
    if (o.status === "done") statusStyle = "color:#16a34a;font-weight:bold;";
    else if (o.status === "cancelled") statusStyle = "color:#9ca3af;text-decoration:line-through;";
    else if (o.status === "in_progress") statusStyle = "color:#dc2626;font-weight:bold;";
    const checked = selectedOrderIds.has(o.id) ? "checked" : "";

    const produced = orderProducedCache[o.id] || 0;
    const target = Number(o.actual_billet_qty_m) || 0;
    const pct = target > 0 ? Math.min(100, Math.round(produced / target * 100)) : 0;
    const pctColor = pct >= 100 ? "#16a34a" : (pct > 0 ? "#2563eb" : "#9ca3af");

    return `
      <tr style="${o.status === 'done' || o.status === 'cancelled' ? 'opacity:0.65;' : ''}">
        <td style="text-align:center;">
          <input type="checkbox" ${checked} onchange="toggleSelectOrder('${o.id}', this.checked)" />
        </td>
        <td>${seq}</td>
        <td>${o.contract || o.order_no || ""}</td>
        <td>${o.delivery_date || ""}</td>
        <td>${o.customer || ""}</td>
        <td>${o.sioc || ""}</td>
        <td>${o.pattern_no || ""}</td>
        <td>${o.color_name || ""}</td>
        <td>${o.fabric_number || ""}</td>
        <td>${o.order_qty_y || 0}</td>
        <td>${o.actual_billet_qty_m || 0}</td>
        <td>${o.billet_width || 0}</td>
        <td>${o.warp_count || ""}</td>
        <td>${o.weft_count || ""}</td>
        <td>${o.warp_density || ""}</td>
        <td>${o.weft_density || ""}</td>
        <td>${o.weave || ""}</td>
        <td>${o.cw || ""}</td>
        <td>${o.fabric_weight || ""}</td>
        <td class="cell-ellipsis" title="${esc(o.fabric_content)}">${o.fabric_content || ""}</td>
        <td class="cell-ellipsis" title="${esc(o.finishing_methods)}">${o.finishing_methods || ""}</td>
        <td>${produced.toFixed(1)}</td>
        <td style="color:${pctColor};font-weight:bold;">${pct}%</td>
        <td class="cell-ellipsis" title="${esc(o.note)}">${o.note || ""}</td>
        <td style="${statusStyle}">${statusLabel(o.status)}</td>
        <td>
          <button class="in"   onclick="openOrderDetail('${o.id}')">${t("详情","Detail")}</button>
          <button class="copy" onclick="openCopyOrderModal('${o.id}')" data-role="operator">${t("复制","Copy")}</button>
          <button class="edit" onclick="openEditOrderModal('${o.id}')" data-role="operator">${t("编辑","Edit")}</button>
          <button class="del"  onclick="deleteOrder('${o.id}')" data-role="admin">${t("删除","Del")}</button>
        </td>
      </tr>`;
  }).join("") || `<tr><td colspan="26" style="text-align:center;color:#999;">${t("暂无数据","No data")}</td></tr>`;

  document.getElementById("orderPageInfo").textContent =
    `${t("第","Page")} ${currentPage} / ${totalPages} ${t("页","")}  ·  ${t("共","Total")} ${total} ${t("条","")}`;
  const btnFirst = document.getElementById("btnFirst");
  const btnLast = document.getElementById("btnLast");
  if (btnFirst) btnFirst.disabled = (currentPage <= 1);
  if (btnLast) btnLast.disabled = (currentPage >= totalPages);
  document.getElementById("statOrders").textContent = total;
  const gotoEl = document.getElementById("orderGotoPage");
  if (gotoEl) gotoEl.max = totalPages;
  const hc = document.getElementById("orderHeaderCheckbox");
  if (hc) {
    const checkedCount = pageItems.filter(o => selectedOrderIds.has(o.id)).length;
    hc.checked = (checkedCount === pageItems.length && pageItems.length > 0);
    hc.indeterminate = (checkedCount > 0 && checkedCount < pageItems.length);
  }
  updateSelectedOrderCount();
}

function toggleAllOrders(checked) {
  const pageItems = filteredOrders.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  pageItems.forEach(o => {
    if (checked) selectedOrderIds.add(o.id);
    else selectedOrderIds.delete(o.id);
  });
  renderOrders();
}
function toggleSelectOrder(id, checked) {
  if (checked) selectedOrderIds.add(id);
  else selectedOrderIds.delete(id);
  updateSelectedOrderCount();
  const pageItems = filteredOrders.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const hc = document.getElementById("orderHeaderCheckbox");
  if (hc) {
    const checkedCount = pageItems.filter(o => selectedOrderIds.has(o.id)).length;
    hc.checked = (checkedCount === pageItems.length && pageItems.length > 0);
    hc.indeterminate = (checkedCount > 0 && checkedCount < pageItems.length);
  }
}
function updateSelectedOrderCount() {
  const el = document.getElementById("selectedOrderCount");
  if (el) el.textContent = selectedOrderIds.size;
}
function prevOrderPage() { if (currentPage > 1) { currentPage--; renderOrders(); scrollToTop(); } }
function nextOrderPage() {
  const tp = Math.ceil(filteredOrders.length / PAGE_SIZE) || 1;
  if (currentPage < tp) { currentPage++; renderOrders(); scrollToTop(); }
}
function goFirstPage() { if (currentPage !== 1) { currentPage = 1; renderOrders(); scrollToTop(); } }
function goLastPage() {
  const tp = Math.ceil(filteredOrders.length / PAGE_SIZE) || 1;
  if (currentPage !== tp) { currentPage = tp; renderOrders(); scrollToTop(); }
}
function gotoOrderPage() {
  const input = document.getElementById("orderGotoPage");
  const tp = Math.ceil(filteredOrders.length / PAGE_SIZE) || 1;
  let n = parseInt(input.value);
  if (!n || n < 1) n = 1;
  if (n > tp) n = tp;
  currentPage = n;
  renderOrders();
  input.value = "";
  scrollToTop();
}
function changePageSize() {
  PAGE_SIZE = Number(document.getElementById("pageSizeSelect").value) || 20;
  currentPage = 1;
  renderOrders();
}

// ============ 合同弹窗 ============
function openAddOrderModal() {
  if (!canEdit()) { alert(t("无权限","No permission")); return; }
  editingOrderId = null;
  document.getElementById("orderModalTitle").textContent = t("新增合同","Add Contract");
  [
    "o_contract","o_customer","o_sioc","o_pattern_no","o_color_name","o_fabric_number",
    "o_order_date","o_delivery_date","o_warp_count","o_weft_count",
    "o_warp_density","o_weft_density","o_weave","o_cw","o_fabric_weight",
    "o_fabric_content","o_finishing_methods","o_order_qty_y","o_producing_qty_m",
    "o_actual_billet_qty_m","o_billet_width","o_note"
  ].forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
  document.getElementById("o_status").value = "pending";
  document.getElementById("o_order_date").value = todayStr();
  document.getElementById("orderMsg").textContent = "";
  document.getElementById("orderModal").style.display = "flex";
}

function openEditOrderModal(id) {
  if (!canEdit()) { alert(t("无权限","No permission")); return; }
  const o = allOrders.find(x => x.id === id);
  if (!o) return;
  editingOrderId = id;
  document.getElementById("orderModalTitle").textContent = t("编辑合同","Edit Contract");
  const map = {
    o_contract: "contract", o_customer: "customer",
    o_sioc: "sioc", o_pattern_no: "pattern_no", o_color_name: "color_name",
    o_fabric_number: "fabric_number", o_order_date: "order_date",
    o_delivery_date: "delivery_date", o_warp_count: "warp_count",
    o_weft_count: "weft_count", o_warp_density: "warp_density",
    o_weft_density: "weft_density", o_weave: "weave", o_cw: "cw",
    o_fabric_weight: "fabric_weight", o_fabric_content: "fabric_content",
    o_finishing_methods: "finishing_methods", o_order_qty_y: "order_qty_y",
    o_producing_qty_m: "producing_qty_m", o_actual_billet_qty_m: "actual_billet_qty_m",
    o_billet_width: "billet_width", o_note: "note",
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
  if (!canEdit()) { alert(t("无权限","No permission")); return; }
  const g = id => (document.getElementById(id)?.value || "").trim();
  const payload = {
    contract: g("o_contract"),
    order_no: g("o_contract"),
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
    billet_width: Number(g("o_billet_width")) || 0,
    note: g("o_note"),
    status: g("o_status") || "pending",
  };
  if (!payload.contract) { document.getElementById("orderMsg").textContent = t("合同号必填","Contract required"); return; }

  let error;
  if (editingOrderId) {
    const old = allOrders.find(x => x.id === editingOrderId);
    const changes = computeOrderChanges(old, payload);
    if (changes.length === 0) {
      document.getElementById("orderMsg").textContent = t("没有改动","No changes");
      return;
    }
    const { data: u } = await supabaseClient.auth.getUser();
    payload.last_modified_by = u?.user?.email || "";
    payload.last_modified_at = new Date().toISOString();
    ({ error } = await supabaseClient.from(TB.orders).update(payload).eq("id", editingOrderId));
    if (!error) {
      await writeSysLog("edit_order",
        t(`编辑合同 ${payload.contract}\n变更:\n${changes.join("\n")}`,
          `Edit contract ${payload.contract}\nChanges:\n${changes.join("\n")}`),
        payload.contract);
    }
  } else {
    const { data: u } = await supabaseClient.auth.getUser();
    payload.operator = u?.user?.email || "";
    payload.last_modified_by = u?.user?.email || "";
    payload.last_modified_at = new Date().toISOString();
    ({ error } = await supabaseClient.from(TB.orders).insert(payload).select().single());
    if (!error) await writeSysLog("add_order", t(`新增合同 ${payload.contract}`,`Add contract ${payload.contract}`), payload.contract);
  }
  if (error) { document.getElementById("orderMsg").textContent = t("保存失败: ","Save failed: ") + error.message; return; }
  closeOrderModal();
  await refreshOrderProducedCache();
  await loadOrders();
  if (!editingOrderId) goToOrders();
}

function computeOrderChanges(oldO, newO) {
  if (!oldO) return [];
  const fields = [
    ["contract", t("合同号","Contract")],
    ["customer", t("客户","Customer")],
    ["sioc", t("成品号","SIOC")],
    ["pattern_no", t("花型号","Pattern")],
    ["color_name", t("颜色","Color")],
    ["fabric_number", t("厂编号","Fabric No")],
    ["order_date", t("下单日期","Order Date")],
    ["delivery_date", t("交货日期","Delivery")],
    ["warp_count", t("经纱","Warp")],
    ["weft_count", t("纬纱","Weft")],
    ["warp_density", t("经密","Warp Density")],
    ["weft_density", t("纬密","Weft Density")],
    ["weave", t("组织","Weave")],
    ["cw", t("门幅","C/W")],
    ["fabric_weight", t("克重","Weight")],
    ["fabric_content", t("成分","Content")],
    ["finishing_methods", t("整理方式","Finishing")],
    ["order_qty_y", t("订单数(码)","Order Qty(Y)")],
    ["producing_qty_m", t("生产数量(米)","Producing(M)")],
    ["actual_billet_qty_m", t("坯布米数","Billet(M)")],
    ["billet_width", t("坯布门幅","Billet Width")],
    ["status", t("状态","Status")],
    ["note", t("备注","Note")],
  ];
  const changes = [];
  fields.forEach(([k, label]) => {
    const ov = oldO[k] ?? "";
    const nv = newO[k] ?? "";
    if (String(ov) !== String(nv)) {
      changes.push(`${label}: ${ov} → ${nv}`);
    }
  });
  return changes;
}

async function deleteOrder(id) {
  if (!canDelete()) { alert(t("无权限","No permission")); return; }
  const o = allOrders.find(x => x.id === id);
  if (!o) return;
  if (!confirm(t(`确定删除合同 ${o.contract}？（生产批次/工序/参数/助剂一起删除）`,
                 `Delete contract ${o.contract}? (all batches/processes/params/aux too)`))) return;
  const { error } = await supabaseClient.from(TB.orders).delete().eq("id", id);
  if (error) { alert(t("删除失败: ","Delete failed: ") + error.message); return; }
  await writeSysLog("delete_order", t(`删除合同 ${o.contract}`,`Delete contract ${o.contract}`), o.contract);
  await refreshOrderProducedCache();
  await loadOrders();
}

// ============ 复制合同 ============
function openCopyOrderModal(orderId) {
  if (!canEdit()) { alert(t("无权限","No permission")); return; }
  const o = allOrders.find(x => x.id === orderId);
  if (!o) return;
  copySourceOrderId = orderId;
  document.getElementById("copyOrderSource").innerHTML =
    t(`源合同：<b>${o.contract || ""}</b> · ${o.customer || ""} · ${o.sioc || ""}`,
      `Source: <b>${o.contract || ""}</b> · ${o.customer || ""} · ${o.sioc || ""}`);
  document.getElementById("copy_contract").value = (o.contract || "") + "-C";
  document.getElementById("copy_order_date").value = todayStr();
  document.getElementById("copy_delivery_date").value = o.delivery_date || "";
  document.getElementById("copy_batches").checked = true;
  document.getElementById("copy_actuals").checked = false;
  document.getElementById("copyOrderMsg").textContent = "";
  document.getElementById("copyOrderModal").style.display = "flex";
}
function closeCopyOrderModal() {
  copySourceOrderId = null;
  document.getElementById("copyOrderModal").style.display = "none";
}

async function doCopyOrder() {
  const src = allOrders.find(x => x.id === copySourceOrderId);
  if (!src) { alert(t("源合同不存在","Source not found")); return; }
  const newContract = document.getElementById("copy_contract").value.trim();
  const newOrderDate = document.getElementById("copy_order_date").value || null;
  const newDelivery = document.getElementById("copy_delivery_date").value || null;
  if (!newContract) { document.getElementById("copyOrderMsg").textContent = t("新合同号必填","New contract required"); return; }
  const copyActuals = document.getElementById("copy_actuals").checked;
  const copyBatches = document.getElementById("copy_batches").checked;
  document.getElementById("copyOrderMsg").textContent = t("复制中...","Copying...");

  const newOrderId = await copyOrderInternal(src, newContract, newOrderDate, newDelivery, copyBatches, copyActuals);
  if (!newOrderId) { document.getElementById("copyOrderMsg").textContent = t("复制失败","Copy failed"); return; }
  document.getElementById("copyOrderMsg").textContent = t("✅ 复制完成","✅ Done");
  setTimeout(async () => {
    closeCopyOrderModal();
    await refreshOrderProducedCache();
    await loadOrders();
    openOrderDetail(newOrderId);
  }, 800);
}

async function copyOrderInternal(src, newContract, newOrderDate, newDelivery, copyBatches, copyActuals) {
  const { data: u } = await supabaseClient.auth.getUser();
  const newOrder = { ...src };
  delete newOrder.id; delete newOrder.created_at; delete newOrder.updated_at;
  newOrder.contract = newContract;
  newOrder.order_no = newContract;
  newOrder.order_date = newOrderDate;
  newOrder.delivery_date = newDelivery;
  newOrder.status = "pending";
  newOrder.operator = u?.user?.email || "";
  newOrder.last_modified_by = u?.user?.email || "";
  newOrder.last_modified_at = new Date().toISOString();

  const { data: insOrder, error: e1 } = await supabaseClient.from(TB.orders).insert(newOrder).select().single();
  if (e1) { console.warn(e1); return null; }
  const newOrderId = insOrder.id;

  if (copyBatches) {
    const srcBatches = await fetchAllRows(TB.batches, "batch_no", true, q => q.eq("order_id", src.id));
    for (const sb of srcBatches) {
      const newBatch = {
        order_id: newOrderId,
        batch_no: sb.batch_no,
        batch_billet_m: sb.batch_billet_m || 0,
        batch_billet_width: sb.batch_billet_width || 0,
        status: "pending",
        start_date: null, end_date: null,
        operator: "", note: sb.note || "",
      };
      const { data: insBatch, error: e2 } = await supabaseClient.from(TB.batches).insert(newBatch).select().single();
      if (e2) continue;

      const srcProcs = await fetchAllRows(TB.processes, "seq", true, q => q.eq("batch_id", sb.id));
      if (srcProcs.length) {
        const srcProcIds = srcProcs.map(p => p.id);
        const srcParams = await fetchAllRows(TB.params, "seq", true, q => q.in("process_id", srcProcIds));
        const srcAux = await fetchAllRows(TB.aux, "created_at", true, q => q.in("process_id", srcProcIds));

        for (const sp of srcProcs) {
          const newProc = {
            order_id: newOrderId, batch_id: insBatch.id, seq: sp.seq,
            process_name: sp.process_name, machine: sp.machine,
            standard_note: sp.standard_note, status: "pending",
            operator: "", start_time: null, end_time: null,
            result: "", note: sp.note,
          };
          const { data: insProc, error: e3 } = await supabaseClient.from(TB.processes).insert(newProc).select().single();
          if (e3) continue;

          const pParams = srcParams.filter(x => x.process_id === sp.id);
          if (pParams.length) {
            await supabaseClient.from(TB.params).insert(pParams.map(x => ({
              process_id: insProc.id, stage: x.stage || "A",
              param_name: x.param_name, param_unit: x.param_unit || "",
              standard_value: x.standard_value || "",
              actual_value: copyActuals ? (x.actual_value || "") : "",
              exec_date: copyActuals ? x.exec_date : null,
              shift: copyActuals ? (x.shift || "") : "",
              operator: copyActuals ? (x.operator || "") : "",
              is_out_of_spec: false, seq: x.seq || 1, note: x.note || "",
            })));
          }
          const pAux = srcAux.filter(x => x.process_id === sp.id);
          if (pAux.length) {
            await supabaseClient.from(TB.aux).insert(pAux.map(x => ({
              process_id: insProc.id, stage: x.stage || "A",
              bom_item_id: x.bom_item_id, aux_code: x.aux_code || "",
              aux_name: x.aux_name, aux_name_en: x.aux_name_en || "",
              standard_dose: x.standard_dose || 0,
              dose_unit: x.dose_unit || "g/100m", tolerance_pct: x.tolerance_pct ?? 10,
              actual_value: copyActuals ? (x.actual_value || 0) : 0,
              actual_unit: x.actual_unit || "kg",
              actual_dose: copyActuals ? (x.actual_dose || 0) : 0,
              actual_kg: copyActuals ? (x.actual_kg || 0) : 0,
              theory_dose: x.theory_dose || 0, theory_kg: x.theory_kg || 0,
              deviation_pct: copyActuals ? (x.deviation_pct || 0) : 0,
              is_out_of_spec: copyActuals ? !!x.is_out_of_spec : false,
              alert_ack: false, note: x.note || "",
            })));
          }
        }
      }
    }
  }
  await writeSysLog("copy_order", t(`复制合同：${src.contract} → ${newContract}`, `Copy contract: ${src.contract} → ${newContract}`), newContract);
  return newOrderId;
}

// ============ 批量复制 ============
function openBatchCopyModal() {
  if (!canEdit()) { alert(t("无权限","No permission")); return; }
  if (selectedOrderIds.size === 0) { alert(t("请先勾选至少 1 条合同","Please select at least 1 contract")); return; }
  document.getElementById("batchCopyInfo").innerHTML =
    t(`已选：<b>${selectedOrderIds.size}</b> 条合同`,
      `Selected: <b>${selectedOrderIds.size}</b> contracts`);
  document.getElementById("bc_prefix").value = "COPY-";
  document.getElementById("bc_start").value = "1";
  document.getElementById("bc_count").value = "1";
  document.getElementById("bc_copy_processes").checked = true;
  document.getElementById("batchCopyMsg").textContent = "";
  document.getElementById("batchCopyModal").style.display = "flex";
}
function closeBatchCopyModal() { document.getElementById("batchCopyModal").style.display = "none"; }

async function doBatchCopy() {
  const prefix = document.getElementById("bc_prefix").value.trim();
  const start = Number(document.getElementById("bc_start").value) || 1;
  const count = Number(document.getElementById("bc_count").value) || 1;
  const copyProcesses = document.getElementById("bc_copy_processes").checked;
  const msg = document.getElementById("batchCopyMsg");

  const srcOrders = allOrders.filter(o => selectedOrderIds.has(o.id));
  if (!srcOrders.length) { msg.textContent = t("没有选中合同","No contracts selected"); return; }

  msg.textContent = t("开始复制...","Copying...");
  let done = 0, failed = 0;
  for (const src of srcOrders) {
    for (let i = 0; i < count; i++) {
      const n = start + i;
      const newContract = prefix + String(n).padStart(3, "0");
      const newId = await copyOrderInternal(src, newContract, todayStr(), src.delivery_date || null, copyProcesses, false);
      if (newId) done++; else failed++;
      msg.textContent = t(`复制中... ${done + failed} / ${srcOrders.length * count}`,
                          `Copying... ${done + failed} / ${srcOrders.length * count}`);
    }
  }
  msg.textContent = t(`✅ 完成\n成功 ${done} 条\n失败 ${failed} 条`,
                      `✅ Done\nSuccess ${done}\nFailed ${failed}`);
  await refreshOrderProducedCache();
  await loadOrders();
  setTimeout(() => closeBatchCopyModal(), 1500);
}

// ============ 批量生成工序 ============
async function openBatchGenModal() {
  if (!canEdit()) { alert(t("无权限","No permission")); return; }
  // 找"批次下没有工序"的
  const batchesWithProc = new Set();
  try {
    const allProcs = await fetchAllRows(TB.processes, "created_at", false);
    allProcs.forEach(p => { if (p.batch_id) batchesWithProc.add(p.batch_id); });
  } catch (e) {}
  const allB = await fetchAllRows(TB.batches, "created_at", false);
  const emptyBatches = allB.filter(b => !batchesWithProc.has(b.id));
  document.getElementById("batchGenInfo").innerHTML =
    t(`未生成工序的批次：<b>${emptyBatches.length}</b> 条<br>（已生成过的批次会跳过）`,
      `Batches without processes: <b>${emptyBatches.length}</b><br>(Already generated will be skipped)`);
  document.getElementById("batchGenMsg").textContent = "";
  document.getElementById("batchGenModal").style.display = "flex";
  window.__emptyBatches = emptyBatches;
}
function closeBatchGenModal() { document.getElementById("batchGenModal").style.display = "none"; }

async function doBatchGen() {
  const emptyBatches = window.__emptyBatches || [];
  const msg = document.getElementById("batchGenMsg");
  if (!emptyBatches.length) { msg.textContent = t("没有需要生成的批次","No batches to generate"); return; }

  const { data: tpls } = await supabaseClient
    .from(TB.templates).select("*").eq("dept", "后整理").eq("is_active", true)
    .order("seq", { ascending: true });
  if (!tpls || !tpls.length) { msg.textContent = t("没有工序模板","No process templates"); return; }

  // 预取所有 BOM 头
  const { data: allBomHeaders } = await supabaseClient.from(TB.bomHeaders).select("id, fg_code");
  const bomMap = {};
  (allBomHeaders || []).forEach(b => { bomMap[b.fg_code] = b.id; });

  msg.textContent = t("开始...","Starting...");
  let ok = 0, failed = 0;
  for (const batch of emptyBatches) {
    try {
      // 找合同
      const order = allOrders.find(o => o.id === batch.order_id);
      if (!order) { failed++; continue; }

      const rows = tpls.map(t2 => ({
        order_id: order.id,
        batch_id: batch.id,
        seq: t2.seq,
        process_name: t2.process_name,
        machine: t2.default_machine || "",
        standard_note: t2.default_note || "",
        status: "pending",
        note: t2.is_optional ? "[可选工序]" : "",
      }));
      const { data: inserted, error } = await supabaseClient.from(TB.processes).insert(rows).select();
      if (error) { failed++; continue; }

      if (order.sioc && bomMap[order.sioc]) {
        const bhId = bomMap[order.sioc];
        const bp = await fetchAllRows(TB.bomParams, "seq", true, q => q.eq("bom_id", bhId));
        const bi = await fetchAllRows(TB.bomItems, "seq", true, q => q.eq("bom_id", bhId));
        for (const proc of inserted) {
          const pp = bp.filter(x => x.process_name === proc.process_name);
          const pi = bi.filter(x => x.process_name === proc.process_name);
          if (pp.length) {
            await supabaseClient.from(TB.params).insert(pp.map(x => ({
              process_id: proc.id, stage: x.stage || "A",
              param_name: x.param_name, param_unit: x.param_unit || "",
              standard_value: x.standard_value || "", actual_value: "",
              seq: x.seq || 1,
            })));
          }
          if (pi.length) {
            await supabaseClient.from(TB.aux).insert(pi.map(x => ({
              process_id: proc.id, stage: x.stage || "A",
              bom_item_id: x.id, aux_code: x.aux_code || "",
              aux_name: x.aux_name, aux_name_en: x.aux_name_en || "",
              standard_dose: x.standard_dose || 0, dose_unit: x.dose_unit || "g/100m",
              tolerance_pct: x.tolerance_pct ?? 10,
              actual_value: 0, actual_unit: "kg",
              actual_dose: 0, actual_kg: 0, theory_dose: 0, theory_kg: 0,
              deviation_pct: 0, is_out_of_spec: false,
            })));
          }
        }
      }
      ok++;
      msg.textContent = t(`生成中... ${ok + failed} / ${emptyBatches.length}`,
                          `Generating... ${ok + failed} / ${emptyBatches.length}`);
    } catch (e) { failed++; }
  }
  await writeSysLog("batch_gen_processes", t(`批量生成工序：成功 ${ok}, 失败 ${failed}`, `Batch gen: OK ${ok}, Failed ${failed}`), null);
  msg.textContent = t(`✅ 完成\n成功 ${ok} 条\n失败 ${failed} 条`,
                      `✅ Done\nSuccess ${ok}\nFailed ${failed}`);
  setTimeout(() => { closeBatchGenModal(); loadOrders(); }, 1500);
}
function batchGenSelected() {
  if (selectedOrderIds.size === 0) { alert(t("请先勾选合同","Please select contracts")); return; }
  openBatchGenModal();
}

// ============ 批量删除 ============
async function batchDeleteSelected() {
  if (!canDelete()) { alert(t("无权限","No permission")); return; }
  if (selectedOrderIds.size === 0) { alert(t("请先勾选合同","Please select contracts")); return; }
  if (!confirm(t(`确定删除选中的 ${selectedOrderIds.size} 条合同？`,
                 `Delete ${selectedOrderIds.size} selected contracts?`))) return;
  const ids = [...selectedOrderIds];
  for (const id of ids) {
    await supabaseClient.from(TB.orders).delete().eq("id", id);
  }
  await writeSysLog("batch_delete_orders", t(`批量删除 ${ids.length} 条合同`, `Batch delete ${ids.length} contracts`), null);
  selectedOrderIds.clear();
  await refreshOrderProducedCache();
  await loadOrders();
}
// ============ 合同详情页（批次列表） ============
async function openOrderDetail(orderId) {
  currentOrderId = orderId;
  hideAll();
  document.getElementById("orderDetailPage").style.display = "block";
  document.getElementById("userEmailDetail").textContent = document.getElementById("userEmail2").textContent;

  const order = allOrders.find(x => x.id === orderId);
  if (!order) { alert(t("合同不存在","Contract not found")); return; }

  // ⭐ 标题只显示"合同详情"，不再显示 合同号|客户|成品号|颜色
  document.getElementById("detailTitle").textContent = t("合同详情","Contract Detail");

  // 拉该合同下所有批次
  let batches = [];
  try {
    batches = await fetchAllRows(TB.batches, "batch_no", true, q => q.eq("order_id", orderId));
    batches.sort((a,b) => (a.batch_no||"").localeCompare(b.batch_no||""));
  } catch (e) { alert(t("加载批次失败: ","Load batches failed: ") + e.message); return; }
  allBatches = batches;

  const totalTarget = Number(order.actual_billet_qty_m) || 0;
  const totalProduced = batches.reduce((s,b) => s + (Number(b.batch_billet_m) || 0), 0);
  const pct = totalTarget > 0 ? Math.min(100, Math.round(totalProduced / totalTarget * 100)) : 0;

  document.getElementById("detailBatchCount").textContent = batches.length;
  document.getElementById("detailProduced").textContent = totalProduced.toFixed(1);
  document.getElementById("detailProgress").textContent = pct + "%";

  document.getElementById("contractInfoBar").innerHTML = `
    <div><b>${t("合同号","Contract")}:</b> ${order.contract||""}　
    <b>${t("客户","Customer")}:</b> ${order.customer||""}　
    <b>${t("成品号","SIOC")}:</b> ${order.sioc||""}　
    <b>${t("花型号","Pattern")}:</b> ${order.pattern_no||""}</div>
    <div><b>${t("颜色","Color")}:</b> ${order.color_name||""}　
    <b>${t("厂编号","Fabric No")}:</b> <span style="font-weight:bold;color:#dc2626;">${order.fabric_number||""}</span>　
    <b>${t("订单数(码)","Order Qty(Y)")}:</b> ${order.order_qty_y||0}　
    <b>${t("坯布米数","Billet(M)")}:</b> ${order.actual_billet_qty_m||0}　
    <b>${t("坯布门幅","Billet Width")}:</b> ${order.billet_width||0} cm</div>
    <div><b>${t("整理方式","Finishing")}:</b> ${order.finishing_methods||"—"}</div>
    <div><b>${t("合同进度","Progress")}:</b> <span style="color:${pct>=100?'#16a34a':'#2563eb'};font-weight:bold;">${totalProduced.toFixed(1)} / ${totalTarget} M (${pct}%)</span></div>
  `;

  if (!batches.length) {
    document.getElementById("detailBody").innerHTML =
      `<div style="text-align:center;color:#999;padding:40px 0;">${t("暂无生产批次，点右上角 + 新增生产批次","No batches. Click + Add Batch top right.")}</div>`;
    return;
  }

  const batchIds = batches.map(b => b.id);
  let allProcs = [];
  try {
    allProcs = await fetchAllRows(TB.processes, "seq", true, q => q.in("batch_id", batchIds));
  } catch (e) {}
  const procIds = allProcs.map(p => p.id);
  let allParams = [], allAux = [];
  if (procIds.length) {
    try {
      allParams = await fetchAllRows(TB.params, "seq", true, q => q.in("process_id", procIds));
      allAux = await fetchAllRows(TB.aux, "created_at", true, q => q.in("process_id", procIds));
    } catch (e) {}
  }

  const procByBatch = {}, paramByProc = {}, auxByProc = {};
  allProcs.forEach(p => { if (!procByBatch[p.batch_id]) procByBatch[p.batch_id] = []; procByBatch[p.batch_id].push(p); });
  allParams.forEach(pa => { if (!paramByProc[pa.process_id]) paramByProc[pa.process_id] = []; paramByProc[pa.process_id].push(pa); });
  allAux.forEach(a => { if (!auxByProc[a.process_id]) auxByProc[a.process_id] = []; auxByProc[a.process_id].push(a); });

  document.getElementById("detailBody").innerHTML = batches.map((b, idx) => {
    const procs = procByBatch[b.id] || [];
    const ps = procs.flatMap(p => paramByProc[p.id] || []);
    const as = procs.flatMap(p => auxByProc[p.id] || []);
    const oos = ps.filter(x => x.is_out_of_spec).length + as.filter(x => x.is_out_of_spec).length;

    let statusStyle = "";
    if (b.status === "done") statusStyle = "color:#16a34a;font-weight:bold;";
    else if (b.status === "cancelled") statusStyle = "color:#9ca3af;text-decoration:line-through;";
    else if (b.status === "in_progress") statusStyle = "color:#dc2626;font-weight:bold;";

    return `
      <div class="dash-section" style="margin-bottom:14px;">
        <div class="dash-section-head">
          <h2>
            ${t("生产批次","Batch")} ${b.batch_no}
            <span style="font-size:13px;color:#666;font-weight:normal;">
              | ${b.batch_billet_m || 0} M | ${b.batch_billet_width || 0} cm | ${statusLabel(b.status)}
            </span>
          </h2>
          <div>
            <button onclick="openBatchDetail('${b.id}')" data-role="operator" class="mini-btn" style="background:#2563eb;color:#fff;">${t("查看工艺","View Process")}</button>
            <button onclick="openEditBatchModal('${b.id}')" data-role="operator" class="mini-btn">${t("编辑","Edit")}</button>
            <button onclick="deleteBatch('${b.id}')" data-role="admin" class="mini-btn" style="background:#dc2626;color:#fff;">${t("删除","Del")}</button>
          </div>
        </div>
        <div style="font-size:13px;color:#666;margin-top:4px;">
          ${t("开始","Start")}: ${b.start_date || "—"} | 
          ${t("结束","End")}: ${b.end_date || "—"} | 
          ${t("操作员","Operator")}: ${b.operator || "—"} | 
          ${t("备注","Note")}: ${b.note || "—"}
        </div>
        <div style="font-size:13px;margin-top:6px;">
          ${t("工序数","Processes")}: <b>${procs.length}</b> | 
          ${t("参数数","Params")}: <b>${ps.length}</b> | 
          ${t("助剂数","Aux")}: <b>${as.length}</b> | 
          ${t("超标","OOS")}: <b style="color:${oos>0?'#dc2626':'#333'};">${oos}</b>
        </div>
      </div>`;
  }).join("");
}

// ============ 新增/编辑批次 ============
async function openAddBatchModal() {
  if (!canEdit()) { alert(t("无权限","No permission")); return; }
  if (!currentOrderId) return;
  editingBatchId = null;

  // 计算下一个批次号
  const exist = allBatches.map(b => b.batch_no).filter(Boolean);
  let nextNo = "01";
  if (exist.length) {
    const nums = exist.map(x => parseInt(x, 10)).filter(n => !isNaN(n));
    const maxN = nums.length ? Math.max(...nums) : 0;
    nextNo = String(maxN + 1).padStart(2, "0");
  }

  const order = allOrders.find(o => o.id === currentOrderId);
  document.getElementById("batchModalTitle").textContent = t("新增生产批次","Add Batch");
  document.getElementById("batchOrderLabel").innerHTML =
    t(`归属合同：<b>${order?.contract || ""}</b>`,
      `Contract: <b>${order?.contract || ""}</b>`);
  document.getElementById("b_batch_no").value = nextNo;
  document.getElementById("b_status").value = "pending";
  document.getElementById("b_billet_m").value = "";
  document.getElementById("b_billet_width").value = "";
  document.getElementById("b_start_date").value = todayStr();
  document.getElementById("b_end_date").value = "";
  document.getElementById("b_operator").value = "";
  document.getElementById("b_note").value = "";
  document.getElementById("batchMsg").textContent = "";
  document.getElementById("batchModal").style.display = "flex";
}

function openEditBatchModal(batchId) {
  if (!canEdit()) { alert(t("无权限","No permission")); return; }
  const b = allBatches.find(x => x.id === batchId);
  if (!b) return;
  editingBatchId = batchId;
  document.getElementById("batchModalTitle").textContent = t("编辑生产批次","Edit Batch");
  document.getElementById("batchOrderLabel").innerHTML = "";
  document.getElementById("b_batch_no").value = b.batch_no || "";
  document.getElementById("b_status").value = b.status || "pending";
  document.getElementById("b_billet_m").value = b.batch_billet_m || 0;
  document.getElementById("b_billet_width").value = b.batch_billet_width || 0;
  document.getElementById("b_start_date").value = b.start_date || "";
  document.getElementById("b_end_date").value = b.end_date || "";
  document.getElementById("b_operator").value = b.operator || "";
  document.getElementById("b_note").value = b.note || "";
  document.getElementById("batchMsg").textContent = "";
  document.getElementById("batchModal").style.display = "flex";
}
function closeBatchModal() { document.getElementById("batchModal").style.display = "none"; }

async function saveBatch() {
  if (!canEdit()) { alert(t("无权限","No permission")); return; }
  const g = id => (document.getElementById(id)?.value || "").trim();
  const payload = {
    order_id: currentOrderId,
    batch_no: g("b_batch_no"),
    batch_billet_m: Number(g("b_billet_m")) || 0,
    batch_billet_width: Number(g("b_billet_width")) || 0,
    status: g("b_status") || "pending",
    start_date: g("b_start_date") || null,
    end_date: g("b_end_date") || null,
    operator: g("b_operator"),
    note: g("b_note"),
  };
  if (!payload.batch_no) { document.getElementById("batchMsg").textContent = t("批次号必填","Batch No required"); return; }

  let error;
  if (editingBatchId) {
    ({ error } = await supabaseClient.from(TB.batches).update(payload).eq("id", editingBatchId));
    if (!error) await writeSysLog("edit_batch", t(`编辑批次 ${payload.batch_no}`, `Edit batch ${payload.batch_no}`), null);
  } else {
    ({ error } = await supabaseClient.from(TB.batches).insert(payload));
    if (!error) await writeSysLog("add_batch", t(`新增批次 ${payload.batch_no}`, `Add batch ${payload.batch_no}`), null);
  }
  if (error) { document.getElementById("batchMsg").textContent = t("保存失败: ","Save failed: ") + error.message; return; }
  closeBatchModal();
  await refreshOrderProducedCache();
  openOrderDetail(currentOrderId);
}

async function deleteBatch(batchId) {
  if (!canDelete()) { alert(t("无权限","No permission")); return; }
  const b = allBatches.find(x => x.id === batchId);
  if (!b) return;
  if (!confirm(t(`确定删除批次 ${b.batch_no}？（工序/参数/助剂一起删除）`,
                 `Delete batch ${b.batch_no}? (processes/params/aux too)`))) return;
  await supabaseClient.from(TB.batches).delete().eq("id", batchId);
  await writeSysLog("delete_batch", t(`删除批次 ${b.batch_no}`, `Delete batch ${b.batch_no}`), null);
  await refreshOrderProducedCache();
  openOrderDetail(currentOrderId);
}

// ============ 复制单个批次 ============
async function copyBatch(batchId) {
  if (!canEdit()) { alert(t("无权限","No permission")); return; }
  const b = allBatches.find(x => x.id === batchId);
  if (!b) return;
  if (!confirm(t(`确定复制批次 ${b.batch_no}？会复制工序/参数/助剂到新批次。`,
                 `Copy batch ${b.batch_no}? (processes/params/aux too)`))) return;

  // 计算新批次号
  const exist = allBatches.map(x => x.batch_no).filter(Boolean);
  const nums = exist.map(x => parseInt(x, 10)).filter(n => !isNaN(n));
  const maxN = nums.length ? Math.max(...nums) : 0;
  const newNo = String(maxN + 1).padStart(2, "0");

  const newBatch = {
    order_id: currentOrderId,
    batch_no: newNo,
    batch_billet_m: b.batch_billet_m || 0,
    batch_billet_width: b.batch_billet_width || 0,
    status: "pending",
    start_date: todayStr(),
    end_date: null,
    operator: "",
    note: `Copy from ${b.batch_no}`,
  };
  const { data: insBatch, error: e1 } = await supabaseClient.from(TB.batches).insert(newBatch).select().single();
  if (e1) { alert(t("复制批次失败: ","Copy batch failed: ") + e1.message); return; }

  const srcProcs = await fetchAllRows(TB.processes, "seq", true, q => q.eq("batch_id", b.id));
  if (srcProcs.length) {
    const srcProcIds = srcProcs.map(p => p.id);
    const srcParams = await fetchAllRows(TB.params, "seq", true, q => q.in("process_id", srcProcIds));
    const srcAux = await fetchAllRows(TB.aux, "created_at", true, q => q.in("process_id", srcProcIds));

    for (const sp of srcProcs) {
      const newProc = {
        order_id: currentOrderId, batch_id: insBatch.id, seq: sp.seq,
        process_name: sp.process_name, machine: sp.machine,
        standard_note: sp.standard_note, status: "pending",
        operator: "", start_time: null, end_time: null,
        result: "", note: sp.note,
      };
      const { data: insProc, error: e2 } = await supabaseClient.from(TB.processes).insert(newProc).select().single();
      if (e2) continue;

      const pParams = srcParams.filter(x => x.process_id === sp.id);
      if (pParams.length) {
        await supabaseClient.from(TB.params).insert(pParams.map(x => ({
          process_id: insProc.id, stage: x.stage || "A",
          param_name: x.param_name, param_unit: x.param_unit || "",
          standard_value: x.standard_value || "", actual_value: "",
          exec_date: null, shift: "", operator: "",
          is_out_of_spec: false, seq: x.seq || 1, note: x.note || "",
        })));
      }
      const pAux = srcAux.filter(x => x.process_id === sp.id);
      if (pAux.length) {
        await supabaseClient.from(TB.aux).insert(pAux.map(x => ({
          process_id: insProc.id, stage: x.stage || "A",
          bom_item_id: x.bom_item_id, aux_code: x.aux_code || "",
          aux_name: x.aux_name, aux_name_en: x.aux_name_en || "",
          standard_dose: x.standard_dose || 0,
          dose_unit: x.dose_unit || "g/100m", tolerance_pct: x.tolerance_pct ?? 10,
          actual_value: 0, actual_unit: "kg",
          actual_dose: 0, actual_kg: 0, theory_dose: 0, theory_kg: 0,
          deviation_pct: 0, is_out_of_spec: false,
          alert_ack: false, note: x.note || "",
        })));
      }
    }
  }
  await writeSysLog("copy_batch", t(`复制批次 ${b.batch_no} → ${newNo}`, `Copy batch ${b.batch_no} → ${newNo}`), null);
  await refreshOrderProducedCache();
  openOrderDetail(currentOrderId);
}

// ============ 批次详情页（工序/参数/助剂） ============
async function openBatchDetail(batchId) {
  currentBatchId = batchId;
  hideAll();
  document.getElementById("batchDetailPage").style.display = "block";
  document.getElementById("userEmailBatch").textContent = document.getElementById("userEmail2").textContent;

  const { data: batch } = await supabaseClient.from(TB.batches).select("*").eq("id", batchId).single();
  if (!batch) { alert(t("批次不存在","Batch not found")); return; }
  currentOrderId = batch.order_id;

  const order = allOrders.find(o => o.id === batch.order_id);

  // ⭐ 标题只显示"批次 XX"
  document.getElementById("batchDetailTitle").textContent =
    t(`批次 ${batch.batch_no}`, `Batch ${batch.batch_no}`);

  // ⭐ 合同信息条（所有批次累计进度）
  const { data: allBatchesData } = await supabaseClient.from(TB.batches).select("batch_billet_m").eq("order_id", batch.order_id);
  const totalProducedAll = (allBatchesData || []).reduce((s,b) => s + (Number(b.batch_billet_m) || 0), 0);
  const target = Number(order?.actual_billet_qty_m) || 0;
  const pct = target > 0 ? Math.min(100, Math.round(totalProducedAll / target * 100)) : 0;

  document.getElementById("batchInfoBar").innerHTML = `
    <div><b>${t("合同号","Contract")}:</b> ${order?.contract||""}　
      <b>${t("客户","Customer")}:</b> ${order?.customer||""}　
      <b>${t("成品号","SIOC")}:</b> ${order?.sioc||""}　
      <b>${t("花型号","Pattern")}:</b> ${order?.pattern_no||""}</div>
    <div><b>${t("颜色","Color")}:</b> ${order?.color_name||""}　
      <b>${t("厂编号","Fabric No")}:</b> <span style="font-weight:bold;color:#dc2626;">${order?.fabric_number||""}</span>　
      <b>${t("订单数(码)","Order Qty(Y)")}:</b> ${order?.order_qty_y||0}　
      <b>${t("坯布米数","Billet(M)")}:</b> ${batch.batch_billet_m||0}　
      <b>${t("坯布门幅","Billet Width")}:</b> ${batch.batch_billet_width||0} cm</div>
    <div><b>${t("整理方式","Finishing")}:</b> ${order?.finishing_methods||"—"}</div>
    <div><b>${t("合同进度","Progress")}:</b> <span style="color:${pct>=100?'#16a34a':'#2563eb'};font-weight:bold;">${totalProducedAll.toFixed(1)} / ${target} M (${pct}%)</span></div>
  `;

  // 拉工序 + 参数 + 助剂
  let processes = [];
  try {
    processes = await fetchAllRows(TB.processes, "seq", true, q => q.eq("batch_id", batchId));
    processes.sort((a,b) => (a.seq||0) - (b.seq||0));
  } catch (e) { alert(t("加载工序失败: ","Load processes failed: ") + e.message); return; }

  const procIds = processes.map(p => p.id);
  let allParams = [], usages = [];
  if (procIds.length) {
    allParams = await fetchAllRows(TB.params, "seq", true, q => q.in("process_id", procIds));
    usages = await fetchAllRows(TB.aux, "created_at", true, q => q.in("process_id", procIds));
  }

  const paramsByProcStage = {}, auxByProcStage = {};
  allParams.forEach(p => {
    const k = p.process_id + "||" + (p.stage || "A");
    (paramsByProcStage[k] = paramsByProcStage[k] || []).push(p);
  });
  usages.forEach(u => {
    const k = u.process_id + "||" + (u.stage || "A");
    (auxByProcStage[k] = auxByProcStage[k] || []).push(u);
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

  const billetM = Number(batch.batch_billet_m) || 0;

  // ⭐ 工序标题格式：工序 X. 工序名 | 设备 | 操作人 | 状态
  document.getElementById("batchDetailBody").innerHTML = processes.map(proc => {
    const stages = stagesByProc[proc.id];

    const stageHtml = stages.map(st => {
      const params = (paramsByProcStage[proc.id + "||" + st] || []).filter(p => p.param_name !== "(占位)");
      const aux = auxByProcStage[proc.id + "||" + st] || [];

      // ⭐ 参数 + 助剂合并成一张表（方案 C）
      const mergedRows = [];

      params.forEach(pa => {
        mergedRows.push({
          type: "param",
          typeLabel: t("参数","Param"),
          rowKey: "param-" + pa.id,
          name: pa.param_name,
          unit: pa.param_unit || "",
          std: pa.standard_value || "",
          actual: pa.actual_value || "",
          exec_date: pa.exec_date || "",
          shift: pa.shift || "",
          operator: pa.operator || "",
          oos: pa.is_out_of_spec,
          raw: pa,
        });
      });

      aux.forEach(a => {
        const theory = theoryKg(a.standard_dose, billetM);
        mergedRows.push({
          type: "aux",
          typeLabel: t("助剂","Aux"),
          rowKey: "aux-" + a.id,
          name: a.aux_name,
          name_en: a.aux_name_en || "",
          unit: a.dose_unit || "",
          std: n1(a.standard_dose) + " (理论 " + n1(theory) + "kg)",
          actual: n1(a.actual_value),
          exec_date: "",
          shift: "",
          operator: "",
          oos: a.is_out_of_spec,
          raw: a,
        });
      });

      const rowsHtml = mergedRows.map(r => {
        const rowStyle = r.oos ? "background:#fee2e2;" : "";
        const statusTxt = r.oos ? t("⚠️ 超标","⚠️ OOS") : t("正常","OK");
        const statusStyle = r.oos ? "color:#dc2626;font-weight:bold;" : "";

        // 操作列
        const actionsHtml = r.type === "param"
          ? `<button onclick="editProcessParam('${r.raw.id}')" data-role="operator">${t("编辑","Edit")}</button>
             <button onclick="deleteProcessParam('${r.raw.id}')" data-role="admin">${t("删除","Del")}</button>`
          : `<button onclick="editAuxUsage('${r.raw.id}')" data-role="operator">${t("编辑","Edit")}</button>
             <button onclick="deleteAuxUsage('${r.raw.id}')" data-role="admin">${t("删除","Del")}</button>`;

        // 实际值列（参数是文本 input；助剂是 number input + 单位下拉）
        let actualHtml = "";
        if (r.type === "param") {
          actualHtml = `<input type="text" value="${esc(r.raw.actual_value)||""}"
            onchange="updateProcessParam('${r.raw.id}', this.value)"
            style="width:80px;padding:3px;border:1px solid #ddd;border-radius:4px;" />`;
        } else {
          actualHtml = `<input type="number" step="0.1" value="${n1(r.raw.actual_value)}"
            data-usage-input="${r.raw.id}"
            onchange="updateActualDose('${r.raw.id}', this.value, document.getElementById('unit-${r.raw.id}').value)"
            style="width:80px;padding:3px;border:1px solid #ddd;border-radius:4px;" />
            <select id="unit-${r.raw.id}"
              onchange="updateActualDose('${r.raw.id}', document.querySelector('[data-usage-input=${r.raw.id}]').value, this.value)"
              style="padding:3px;border:1px solid #ddd;border-radius:4px;margin-left:4px;">
              <option value="kg" ${r.raw.actual_unit==='kg'?'selected':''}>kg</option>
              <option value="g/100m" ${r.raw.actual_unit==='g/100m'?'selected':''}>g/100m</option>
            </select>`;
        }

        // 日期 / 班次 / 操作员（只有参数行可编辑，助剂行空白）
        let dateHtml = "", shiftHtml = "", opHtml = "";
        if (r.type === "param") {
          dateHtml = `<input type="date" value="${r.raw.exec_date||""}"
            onchange="updateParamField('${r.raw.id}', 'exec_date', this.value)"
            style="width:120px;padding:3px;border:1px solid #ddd;border-radius:4px;" />`;
          shiftHtml = `<select onchange="updateParamField('${r.raw.id}', 'shift', this.value)"
            style="padding:3px;border:1px solid #ddd;border-radius:4px;">
            <option value="" ${!r.raw.shift?'selected':''}>-</option>
            <option value="A" ${r.raw.shift==='A'?'selected':''}>A</option>
            <option value="B" ${r.raw.shift==='B'?'selected':''}>B</option>
            <option value="C" ${r.raw.shift==='C'?'selected':''}>C</option>
          </select>`;
          opHtml = `<input type="text" value="${esc(r.raw.operator)||""}"
            onchange="updateParamField('${r.raw.id}', 'operator', this.value)"
            style="width:70px;padding:3px;border:1px solid #ddd;border-radius:4px;" />`;
        }

        return `
          <tr data-usage-id="${r.type === 'aux' ? r.raw.id : ''}" data-param-id="${r.type === 'param' ? r.raw.id : ''}" style="${rowStyle}">
            <td><b>${r.typeLabel}</b></td>
            <td>
              <div>${r.name}</div>
              ${r.name_en ? `<div style="font-size:11px;color:#888;">${r.name_en}</div>` : ""}
            </td>
            <td>${r.unit}</td>
            <td>${r.std}</td>
            <td>${actualHtml}</td>
            <td>${dateHtml}</td>
            <td>${shiftHtml}</td>
            <td>${opHtml}</td>
            <td class="merged-status" style="${statusStyle}">${statusTxt}</td>
            <td>${r.raw.note || ""}</td>
            <td>${actionsHtml}</td>
          </tr>`;
      }).join("") || `<tr><td colspan="11" style="text-align:center;color:#999;">${t("暂无数据","No data")}</td></tr>`;

      return `
        <div class="stage-block" style="margin:10px 0 14px 12px;padding:10px 12px;background:#f9fafb;border-left:4px solid #3b82f6;border-radius:6px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <div style="font-weight:bold;color:#1e3a8a;">🧪 ${t("阶段","Stage")} ${st}</div>
            <div>
              <button onclick="renameStage('${proc.id}','${st}')" data-role="operator" style="padding:2px 8px;font-size:12px;margin-right:4px;">✎ ${t("重命名","Rename")}</button>
              <button onclick="deleteStage('${proc.id}','${st}')" data-role="admin" style="padding:2px 8px;font-size:12px;">${t("删除阶段","Delete Stage")}</button>
            </div>
          </div>
          <div style="font-size:12px;margin:6px 0 4px;">
            <button onclick="openAddParamModal('${proc.id}','${st}')" data-role="operator" style="padding:3px 10px;font-size:12px;background:#eef2ff;color:#1e40af;border:1px solid #c7d2fe;border-radius:4px;cursor:pointer;margin-right:6px;">+ ${t("参数","Param")}</button>
            <button onclick="openAddAuxModal('${proc.id}','${st}')" data-role="operator" style="padding:3px 10px;font-size:12px;background:#eef2ff;color:#1e40af;border:1px solid #c7d2fe;border-radius:4px;cursor:pointer;">+ ${t("助剂","Aux")}</button>
          </div>
          <table class="data-table" style="font-size:13px;">
            <thead>
              <tr>
                <th style="width:6%;">${t("类型","Type")}</th>
                <th style="width:20%;">${t("名称","Name")}</th>
                <th style="width:7%;">${t("单位","Unit")}</th>
                <th style="width:14%;">${t("标准","Standard")}</th>
                <th style="width:14%;">${t("实际","Actual")}</th>
                <th style="width:10%;">${t("日期","Date")}</th>
                <th style="width:6%;">${t("班次","Shift")}</th>
                <th style="width:8%;">${t("操作员","Operator")}</th>
                <th style="width:8%;">${t("状态","Status")}</th>
                <th style="width:10%;">${t("备注","Note")}</th>
                <th style="width:8%;">${t("操作","Actions")}</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>`;
    }).join("");

    const doneBtn = proc.status === "done"
      ? `<button style="background:#16a34a;color:#fff;" disabled>✓ ${t("已完成","Done")}</button>`
      : `<button onclick="completeProcess('${proc.id}')" data-role="operator" style="background:#16a34a;">✓ ${t("完成","Done")}</button>`;

    // ⭐ 工序标题：工序 2. 退浆 Desizing | 设备 | 操作人 | 状态
    return `
      <div class="dash-section" style="margin-bottom:16px;">
        <div class="dash-section-head">
          <h2>
            ${t("工序","Process")} ${proc.seq}. ${proc.process_name}
            <span style="font-size:13px;color:#666;font-weight:normal;">
              | ${proc.machine || "—"} | ${proc.operator || "—"} | ${statusLabel(proc.status)}
            </span>
          </h2>
          <div>
            ${doneBtn}
            <button onclick="moveProcessUp('${proc.id}')" data-role="operator">↑</button>
            <button onclick="moveProcessDown('${proc.id}')" data-role="operator">↓</button>
            <button onclick="openAddProcessModal(${proc.seq})" data-role="operator">+ ${t("插入","Insert")}</button>
            <button onclick="skipProcess('${proc.id}')" data-role="operator">${t("跳过","Skip")}</button>
            <button onclick="openEditProcessModal('${proc.id}')" data-role="operator">${t("编辑","Edit")}</button>
            <button onclick="deleteProcess('${proc.id}')" data-role="admin">${t("删除","Del")}</button>
          </div>
        </div>
        <div style="font-size:12px;color:#666;margin-bottom:8px;">
          ${t("要求","Standard")}: ${proc.standard_note || "—"} | 
          ${t("开始","Start")}: ${fmtTime(proc.start_time) || "—"} | 
          ${t("结束","End")}: ${fmtTime(proc.end_time) || "—"} | 
          ${t("结果","Result")}: ${proc.result || "—"}
        </div>
        ${stageHtml}
        <button onclick="addStage('${proc.id}')" data-role="operator"
          style="margin-top:8px;padding:6px 12px;background:#eef2ff;color:#1e40af;border:1px solid #c7d2fe;border-radius:6px;cursor:pointer;">
          + ${t("新阶段","New Stage")}
        </button>
      </div>`;
  }).join("");
}
// ============ 更新参数的其他字段（日期/班次/操作员） ============
async function updateParamField(paramId, field, value) {
  const allowed = ["exec_date", "shift", "operator"];
  if (!allowed.includes(field)) return;
  const { error } = await supabaseClient.from(TB.params).update({ [field]: value }).eq("id", paramId);
  if (error) { alert(t("更新失败: ","Update failed: ") + error.message); return; }
}

// ============ 工序完成 ============
async function completeProcess(processId) {
  if (!canEdit()) { alert(t("无权限","No permission")); return; }
  const { data: u } = await supabaseClient.auth.getUser();
  const now = new Date().toISOString();
  const { error } = await supabaseClient.from(TB.processes).update({
    status: "done", end_time: now,
    completed_by: u?.user?.email || "",
    completed_at: now,
  }).eq("id", processId);
  if (error) { alert(t("操作失败: ","Failed: ") + error.message); return; }
  await writeSysLog("complete_process", t(`完成工序 ${processId}`,`Complete process ${processId}`), null);

  // 批次下所有工序完成 → 批次变 done → 检查合同所有批次
  const { data: procs } = await supabaseClient.from(TB.processes)
    .select("status").eq("batch_id", currentBatchId);
  if (procs && procs.every(p => p.status === "done" || p.status === "skipped")) {
    await supabaseClient.from(TB.batches).update({ status: "done" }).eq("id", currentBatchId);
    alert(t("本批次所有工序已完成，批次状态已改为「已完成」","Batch done, all processes completed"));
  }
  openBatchDetail(currentBatchId);
}

// ============ 工序 CRUD（用 currentBatchId） ============
function openAddProcessModal(afterSeq) {
  if (!canEdit()) { alert(t("无权限","No permission")); return; }
  editingProcessId = null;
  document.getElementById("processModalTitle").textContent = afterSeq != null ? t("插入工序","Insert Process") : t("新增工序","Add Process");
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
  if (!canEdit()) { alert(t("无权限","No permission")); return; }
  const { data, error } = await supabaseClient.from(TB.processes).select("*").eq("id", processId).single();
  if (error) { alert(t("加载失败: ","Load failed: ") + error.message); return; }
  editingProcessId = processId;
  document.getElementById("processModalTitle").textContent = t("编辑工序","Edit Process");
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
  if (!canEdit()) { alert(t("无权限","No permission")); return; }
  const g = id => (document.getElementById(id)?.value || "").trim();
  const seq = Number(g("p_seq")) || 1;
  const name = g("p_process_name");
  if (!name) { document.getElementById("processMsg").textContent = t("工序名必填","Process name required"); return; }

  if (!editingProcessId) {
    const { data: existing } = await supabaseClient.from(TB.processes)
      .select("id, seq").eq("batch_id", currentBatchId)
      .gte("seq", seq).order("seq", { ascending: false });
    if (existing && existing.length) {
      for (const p of existing) {
        await supabaseClient.from(TB.processes).update({ seq: p.seq + 1 }).eq("id", p.id);
      }
    }
  }

  const payload = {
    order_id: currentOrderId,
    batch_id: currentBatchId,
    seq,
    process_name: name, machine: g("p_machine"),
    operator: g("p_operator"),
    start_time: g("p_start_time") || null,
    end_time: g("p_end_time") || null,
    status: g("p_status") || "pending",
    standard_note: g("p_standard_note"),
    result: g("p_result"), note: g("p_note"),
  };

  let error;
  if (editingProcessId) {
    ({ error } = await supabaseClient.from(TB.processes).update(payload).eq("id", editingProcessId));
  } else {
    ({ error } = await supabaseClient.from(TB.processes).insert(payload));
  }
  if (error) { document.getElementById("processMsg").textContent = t("保存失败: ","Save failed: ") + error.message; return; }
  await writeSysLog(editingProcessId ? "edit_process" : "add_process",
    t(`${editingProcessId?"编辑":"新增"}工序 ${name}`, `${editingProcessId?"Edit":"Add"} process ${name}`), null);
  closeProcessModal();
  openBatchDetail(currentBatchId);
}

async function deleteProcess(processId) {
  if (!canDelete()) { alert(t("无权限","No permission")); return; }
  if (!confirm(t("确定删除该工序？（参数、助剂一起删除）","Delete this process? (params/aux too)"))) return;
  await supabaseClient.from(TB.processes).delete().eq("id", processId);
  await writeSysLog("delete_process", t(`删除工序 ${processId}`,`Delete process ${processId}`), null);
  openBatchDetail(currentBatchId);
}

async function skipProcess(processId) {
  if (!canEdit()) { alert(t("无权限","No permission")); return; }
  await supabaseClient.from(TB.processes).update({ status: "skipped" }).eq("id", processId);
  openBatchDetail(currentBatchId);
}

async function moveProcessUp(processId) {
  if (!canEdit()) { alert(t("无权限","No permission")); return; }
  const { data: proc } = await supabaseClient.from(TB.processes).select("id, seq, batch_id").eq("id", processId).single();
  if (!proc) return;
  const { data: prev } = await supabaseClient.from(TB.processes)
    .select("id, seq").eq("batch_id", proc.batch_id).lt("seq", proc.seq)
    .order("seq", { ascending: false }).limit(1).maybeSingle();
  if (!prev) return;
  await supabaseClient.from(TB.processes).update({ seq: prev.seq }).eq("id", proc.id);
  await supabaseClient.from(TB.processes).update({ seq: proc.seq }).eq("id", prev.id);
  openBatchDetail(proc.batch_id);
}

async function moveProcessDown(processId) {
  if (!canEdit()) { alert(t("无权限","No permission")); return; }
  const { data: proc } = await supabaseClient.from(TB.processes).select("id, seq, batch_id").eq("id", processId).single();
  if (!proc) return;
  const { data: next } = await supabaseClient.from(TB.processes)
    .select("id, seq").eq("batch_id", proc.batch_id).gt("seq", proc.seq)
    .order("seq", { ascending: true }).limit(1).maybeSingle();
  if (!next) return;
  await supabaseClient.from(TB.processes).update({ seq: next.seq }).eq("id", proc.id);
  await supabaseClient.from(TB.processes).update({ seq: proc.seq }).eq("id", next.id);
  openBatchDetail(proc.batch_id);
}

// ============ 阶段 ============
async function addStage(processId) {
  if (!canEdit()) { alert(t("无权限","No permission")); return; }
  const stageName = prompt(t("新阶段名称:","New stage name:"), "");
  if (!stageName) return;
  await supabaseClient.from(TB.params).insert({
    process_id: processId, stage: stageName,
    param_name: "(占位)", param_unit: "", standard_value: "",
    actual_value: "", seq: 0,
  });
  openBatchDetail(currentBatchId);
}
async function renameStage(processId, oldStage) {
  if (!canEdit()) { alert(t("无权限","No permission")); return; }
  const nv = prompt(t("新阶段名:","New stage name:"), oldStage);
  if (!nv || nv === oldStage) return;
  await supabaseClient.from(TB.params).update({ stage: nv }).eq("process_id", processId).eq("stage", oldStage);
  await supabaseClient.from(TB.aux).update({ stage: nv }).eq("process_id", processId).eq("stage", oldStage);
  openBatchDetail(currentBatchId);
}
async function deleteStage(processId, stage) {
  if (!canDelete()) { alert(t("无权限","No permission")); return; }
  if (!confirm(t(`确定删除阶段 ${stage} 及其所有参数、助剂？`, `Delete stage ${stage} with all params/aux?`))) return;
  await supabaseClient.from(TB.params).delete().eq("process_id", processId).eq("stage", stage);
  await supabaseClient.from(TB.aux).delete().eq("process_id", processId).eq("stage", stage);
  openBatchDetail(currentBatchId);
}

// ============ 参数 ============
function openAddParamModal(processId, stage) {
  if (!canEdit()) { alert(t("无权限","No permission")); return; }
  currentParamProcessId = processId;
  currentParamStage = stage || "A";
  editingParamId = null;
  document.getElementById("paramModalTitle").textContent = t("新增工艺参数","Add Parameter");
  document.getElementById("paramStageLabel").textContent = t(`归属阶段：${currentParamStage}`, `Stage: ${currentParamStage}`);
  document.getElementById("pa_param_name").value = "";
  document.getElementById("pa_param_unit").value = "";
  document.getElementById("pa_standard_value").value = "";
  document.getElementById("pa_actual_value").value = "";
  document.getElementById("pa_exec_date").value = todayStr();
  document.getElementById("pa_shift").value = "";
  document.getElementById("pa_operator").value = "";
  document.getElementById("pa_is_out_of_spec").checked = false;
  document.getElementById("pa_note").value = "";
  document.getElementById("paramMsg").textContent = "";
  document.getElementById("paramModal").style.display = "flex";
}
async function editProcessParam(paramId) {
  if (!canEdit()) { alert(t("无权限","No permission")); return; }
  const { data, error } = await supabaseClient.from(TB.params).select("*").eq("id", paramId).single();
  if (error) { alert(t("加载失败: ","Load failed: ") + error.message); return; }
  editingParamId = paramId;
  currentParamProcessId = data.process_id;
  currentParamStage = data.stage || "A";
  document.getElementById("paramModalTitle").textContent = t("编辑工艺参数","Edit Parameter");
  document.getElementById("paramStageLabel").textContent = t(`归属阶段：${currentParamStage}`, `Stage: ${currentParamStage}`);
  document.getElementById("pa_param_name").value = data.param_name;
  document.getElementById("pa_param_unit").value = data.param_unit || "";
  document.getElementById("pa_standard_value").value = data.standard_value || "";
  document.getElementById("pa_actual_value").value = data.actual_value || "";
  document.getElementById("pa_exec_date").value = data.exec_date || "";
  document.getElementById("pa_shift").value = data.shift || "";
  document.getElementById("pa_operator").value = data.operator || "";
  document.getElementById("pa_is_out_of_spec").checked = !!data.is_out_of_spec;
  document.getElementById("pa_note").value = data.note || "";
  document.getElementById("paramModal").style.display = "flex";
}
function closeParamModal() { document.getElementById("paramModal").style.display = "none"; }

async function saveProcessParam() {
  if (!canEdit()) { alert(t("无权限","No permission")); return; }
  const name = document.getElementById("pa_param_name").value.trim();
  const unit = document.getElementById("pa_param_unit").value.trim();
  const std = document.getElementById("pa_standard_value").value.trim();
  const act = document.getElementById("pa_actual_value").value.trim();
  const execDate = document.getElementById("pa_exec_date").value || null;
  const shift = document.getElementById("pa_shift").value || "";
  const op = document.getElementById("pa_operator").value.trim();
  const oos = document.getElementById("pa_is_out_of_spec").checked;
  const note = document.getElementById("pa_note").value.trim();
  if (!name) { document.getElementById("paramMsg").textContent = t("参数名必填","Param name required"); return; }

  const payload = {
    process_id: currentParamProcessId, stage: currentParamStage,
    param_name: name, param_unit: unit,
    standard_value: std, actual_value: act,
    exec_date: execDate, shift, operator: op,
    is_out_of_spec: oos, note,
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
  if (error) { document.getElementById("paramMsg").textContent = t("保存失败: ","Save failed: ") + error.message; return; }
  await writeSysLog(editingParamId ? "edit_param" : "add_param",
    t(`${editingParamId?"编辑":"新增"}工艺参数 ${name}`, `${editingParamId?"Edit":"Add"} param ${name}`), null);
  closeParamModal();
  openBatchDetail(currentBatchId);
}
async function deleteProcessParam(paramId) {
  if (!canDelete()) { alert(t("无权限","No permission")); return; }
  if (!confirm(t("确定删除该工艺参数？","Delete this param?"))) return;
  await supabaseClient.from(TB.params).delete().eq("id", paramId);
  openBatchDetail(currentBatchId);
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
  if (error) { alert(t("更新失败: ","Update failed: ") + error.message); return; }
  if (isOOS) await writeSysLog("param_oos",
    t(`工艺参数超标: ${data.param_name} 标准 ${std} 实际 ${act}`,
      `Param OOS: ${data.param_name} std ${std} act ${act}`), null);

  const row = document.querySelector(`[data-param-id="${paramId}"]`);
  if (row) {
    row.style.background = isOOS ? "#fee2e2" : "";
    // 第 8 列是状态
    const st = row.querySelector("td:nth-child(8)");
    if (st) {
      st.textContent = isOOS ? t("⚠️ 超标","⚠️ OOS") : t("正常","OK");
      st.style.color = isOOS ? "#dc2626" : "";
      st.style.fontWeight = isOOS ? "bold" : "";
    }
  }
}

// ============ 助剂 ============
function openAddAuxModal(processId, stage) {
  if (!canEdit()) { alert(t("无权限","No permission")); return; }
  currentAuxProcessId = processId;
  currentAuxStage = stage || "A";
  editingAuxId = null;
  document.getElementById("auxModalTitle").textContent = t("新增助剂投料","Add Auxiliary");
  document.getElementById("auxStageLabel").textContent = t(`归属阶段：${currentAuxStage}`, `Stage: ${currentAuxStage}`);
  document.getElementById("ax_code").value = "";
  document.getElementById("ax_name").value = "";
  document.getElementById("ax_name_en").value = "";
  document.getElementById("ax_standard_dose").value = "";
  document.getElementById("ax_dose_unit").value = "g/100m";
  document.getElementById("ax_tolerance_pct").value = "10";
  document.getElementById("ax_note").value = "";
  document.getElementById("auxMsg").textContent = "";
  document.getElementById("auxModal").style.display = "flex";
}
async function editAuxUsage(auxId) {
  if (!canEdit()) { alert(t("无权限","No permission")); return; }
  const { data, error } = await supabaseClient.from(TB.aux).select("*").eq("id", auxId).single();
  if (error) { alert(t("加载失败: ","Load failed: ") + error.message); return; }
  editingAuxId = auxId;
  currentAuxProcessId = data.process_id;
  currentAuxStage = data.stage || "A";
  document.getElementById("auxModalTitle").textContent = t("编辑助剂投料","Edit Auxiliary");
  document.getElementById("auxStageLabel").textContent = t(`归属阶段：${currentAuxStage}`, `Stage: ${currentAuxStage}`);
  document.getElementById("ax_code").value = data.aux_code || "";
  document.getElementById("ax_name").value = data.aux_name || "";
  document.getElementById("ax_name_en").value = data.aux_name_en || "";
  document.getElementById("ax_standard_dose").value = data.standard_dose || 0;
  document.getElementById("ax_dose_unit").value = data.dose_unit || "g/100m";
  document.getElementById("ax_tolerance_pct").value = data.tolerance_pct ?? 10;
  document.getElementById("ax_note").value = data.note || "";
  document.getElementById("auxModal").style.display = "flex";
}
function closeAuxModal() { document.getElementById("auxModal").style.display = "none"; }

async function saveAuxUsage() {
  if (!canEdit()) { alert(t("无权限","No permission")); return; }
  const code = document.getElementById("ax_code").value.trim();
  const name = document.getElementById("ax_name").value.trim();
  const nameEn = document.getElementById("ax_name_en").value.trim();
  const std = Number(document.getElementById("ax_standard_dose").value) || 0;
  const unit = document.getElementById("ax_dose_unit").value.trim() || "g/100m";
  const tol = Number(document.getElementById("ax_tolerance_pct").value) || 10;
  const note = document.getElementById("ax_note").value.trim();
  if (!name) { document.getElementById("auxMsg").textContent = t("助剂名必填","Aux name required"); return; }

  const payload = {
    process_id: currentAuxProcessId, stage: currentAuxStage,
    aux_code: code, aux_name: name, aux_name_en: nameEn,
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
  if (error) { document.getElementById("auxMsg").textContent = t("保存失败: ","Save failed: ") + error.message; return; }
  closeAuxModal();
  openBatchDetail(currentBatchId);
}
async function deleteAuxUsage(auxId) {
  if (!canDelete()) { alert(t("无权限","No permission")); return; }
  if (!confirm(t("确定删除该助剂？","Delete this aux?"))) return;
  await supabaseClient.from(TB.aux).delete().eq("id", auxId);
  openBatchDetail(currentBatchId);
}
async function updateActualDose(usageId, actualValue, actualUnit) {
  const { data: usage } = await supabaseClient.from(TB.aux)
    .select("standard_dose, tolerance_pct, process_id").eq("id", usageId).single();
  if (!usage) return;
  const std = Number(usage.standard_dose) || 0;
  const tol = Number(usage.tolerance_pct) || 10;

  // 拿批次的坯布米数
  const { data: proc } = await supabaseClient.from(TB.processes)
    .select("batch_id").eq("id", usage.process_id).single();
  const { data: batch } = await supabaseClient.from(TB.batches)
    .select("batch_billet_m").eq("id", proc?.batch_id).single();
  const billetM = Number(batch?.batch_billet_m) || 0;

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
  if (error) { alert(t("更新失败: ","Update failed: ") + error.message); return; }
  if (isOOS) {
    await writeSysLog("aux_oos",
      t(`助剂超标: 理论 ${n1(theoryKgVal)}kg, 实际 ${n1(actualKgVal)}kg, 偏差 ${n1(devPct)}%`,
        `Aux OOS: theory ${n1(theoryKgVal)}kg, actual ${n1(actualKgVal)}kg, dev ${n1(devPct)}%`), null);
  }

  const row = document.querySelector(`[data-usage-id="${usageId}"]`);
  if (row) {
    row.style.background = isOOS ? "#fee2e2" : "";
    const c = row.querySelector(".converted"); if (c) c.textContent = n1(actualG);
    const d = row.querySelector(".dev"); if (d) d.textContent = n1(devPct) + "%";
    const st = row.querySelector(".status");
    if (st) {
      st.textContent = isOOS ? t("⚠️ 超标","⚠️ OOS") : t("正常","OK");
      st.style.color = isOOS ? "#dc2626" : "";
      st.style.fontWeight = isOOS ? "bold" : "";
    }
  }
}

// ============ 从模板生成工序（针对当前批次） ============
async function generateProcessesFromTemplate(batchId) {
  if (!canEdit()) { alert(t("无权限","No permission")); return; }
  const { data: batch } = await supabaseClient.from(TB.batches).select("*").eq("id", batchId).single();
  if (!batch) return;
  const order = allOrders.find(o => o.id === batch.order_id);
  if (!order) return;

  const { data: exist } = await supabaseClient.from(TB.processes).select("id").eq("batch_id", batchId).limit(1);
  if (exist && exist.length > 0) {
    if (!confirm(t("该批次已有工序，是否替换？","Batch has processes, replace?"))) return;
    await supabaseClient.from(TB.processes).delete().eq("batch_id", batchId);
  }

  const dept = order.dept || "后整理";
  const { data: tpls, error: te } = await supabaseClient
    .from(TB.templates).select("*").eq("dept", dept).eq("is_active", true)
    .order("seq", { ascending: true });
  if (te || !tpls?.length) { alert(t("无工序模板","No process templates")); return; }

  const rows = tpls.map(t2 => ({
    order_id: order.id,
    batch_id: batchId,
    seq: t2.seq,
    process_name: t2.process_name,
    machine: t2.default_machine || "",
    standard_note: t2.default_note || "",
    status: "pending",
    note: t2.is_optional ? "[可选工序]" : "",
  }));
  const { data: inserted, error } = await supabaseClient.from(TB.processes).insert(rows).select();
  if (error) { alert(t("生成工序失败: ","Gen failed: ") + error.message); return; }

  const sioc = order.sioc;
  if (sioc) {
    const { data: bh } = await supabaseClient.from(TB.bomHeaders).select("id").eq("fg_code", sioc).maybeSingle();
    if (bh) {
      const bp = await fetchAllRows(TB.bomParams, "seq", true, q => q.eq("bom_id", bh.id));
      const bi = await fetchAllRows(TB.bomItems, "seq", true, q => q.eq("bom_id", bh.id));
      for (const proc of inserted) {
        const pp = bp.filter(x => x.process_name === proc.process_name);
        const pi = bi.filter(x => x.process_name === proc.process_name);
        if (pp.length) {
          await supabaseClient.from(TB.params).insert(pp.map(x => ({
            process_id: proc.id, stage: x.stage || "A",
            param_name: x.param_name, param_unit: x.param_unit || "",
            standard_value: x.standard_value || "", actual_value: "",
            seq: x.seq || 1,
          })));
        }
        if (pi.length) {
          await supabaseClient.from(TB.aux).insert(pi.map(x => ({
            process_id: proc.id, stage: x.stage || "A",
            bom_item_id: x.id, aux_code: x.aux_code || "",
            aux_name: x.aux_name, aux_name_en: x.aux_name_en || "",
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
  await writeSysLog("gen_processes", t(`批次 ${batch.batch_no} 生成 ${rows.length} 道工序`, `Batch ${batch.batch_no}: ${rows.length} processes`), order.contract);
  openBatchDetail(batchId);
}

// ============ 打印批次工艺单（A4 横向 + 参数助剂合并） ============
async function printBatchCard(batchId) {
  const { data: batch } = await supabaseClient.from(TB.batches).select("*").eq("id", batchId).single();
  if (!batch) { alert(t("批次不存在","Batch not found")); return; }
  const order = allOrders.find(o => o.id === batch.order_id);
  if (!order) return;

  const processes = await fetchAllRows(TB.processes, "seq", true, q => q.eq("batch_id", batchId));
  processes.sort((a,b) => (a.seq||0) - (b.seq||0));
  const procIds = processes.map(p => p.id);
  let params = [], aux = [];
  if (procIds.length) {
    params = await fetchAllRows(TB.params, "seq", true, q => q.in("process_id", procIds));
    aux = await fetchAllRows(TB.aux, "created_at", true, q => q.in("process_id", procIds));
  }
  const pBy = {}, aBy = {};
  params.forEach(p => { const k = p.process_id + "||" + (p.stage||"A"); (pBy[k]=pBy[k]||[]).push(p); });
  aux.forEach(a => { const k = a.process_id + "||" + (a.stage||"A"); (aBy[k]=aBy[k]||[]).push(a); });
  const billetM = Number(batch.batch_billet_m) || 0;

  const procsHtml = processes.map(proc => {
    const stages = [...new Set([
      ...params.filter(x=>x.process_id===proc.id && x.param_name!=="(占位)").map(x=>x.stage||"A"),
      ...aux.filter(x=>x.process_id===proc.id).map(x=>x.stage||"A")
    ])].sort();
    if (!stages.length) stages.push("A");

    const stagesHtml = stages.map(st => {
      const ps = (pBy[proc.id + "||" + st] || []).filter(x => x.param_name !== "(占位)");
      const as = aBy[proc.id + "||" + st] || [];

      // 参数 + 助剂合并成一张表
      const rows = [];
      ps.forEach(p => rows.push({
        type: t("参数","Param"),
        name: p.param_name,
        unit: p.param_unit || "",
        std: p.standard_value || "",
        act: p.actual_value || "",
        date: p.exec_date || "",
        shift: p.shift || "",
        op: p.operator || "",
        oos: p.is_out_of_spec,
      }));
      as.forEach(a => {
        const th = n1(theoryKg(a.standard_dose, billetM));
        rows.push({
          type: t("助剂","Aux"),
          name: a.aux_name + (a.aux_name_en ? " / " + a.aux_name_en : ""),
          unit: a.dose_unit || "",
          std: n1(a.standard_dose) + ` (${th}kg)`,
          act: n1(a.actual_kg) + "kg",
          date: "",
          shift: "",
          op: "",
          oos: a.is_out_of_spec,
        });
      });

      const rowsHtml = rows.length ? rows.map(r => `
        <tr>
          <td>${r.type}</td>
          <td>${r.name}</td>
          <td>${r.unit}</td>
          <td>${r.std}</td>
          <td>${r.act}</td>
          <td>${r.date}</td>
          <td>${r.shift}</td>
          <td>${r.op}</td>
          <td>${r.oos ? "⚠️" : ""}</td>
        </tr>`).join("") : `<tr><td colspan="9" style="text-align:center;color:#999;">${t("无","—")}</td></tr>`;

      return `
        <div class="stage">
          <div class="stage-title">${t("阶段","Stage")} ${st}</div>
          <table class="sub-table">
            <thead>
              <tr>
                <th style="width:8%;">${t("类型","Type")}</th>
                <th style="width:25%;">${t("名称","Name")}</th>
                <th style="width:8%;">${t("单位","Unit")}</th>
                <th style="width:12%;">${t("标准","Std")}</th>
                <th style="width:12%;">${t("实际","Actual")}</th>
                <th style="width:10%;">${t("日期","Date")}</th>
                <th style="width:6%;">${t("班","Shift")}</th>
                <th style="width:12%;">${t("操作员","Operator")}</th>
                <th style="width:7%;">${t("状态","St")}</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>`;
    }).join("");

    return `
      <div class="proc">
        <div class="proc-title">${proc.seq}. ${proc.process_name}
          <span class="proc-meta">${proc.machine||""} ${proc.operator||""} ${statusLabel(proc.status)}</span>
        </div>
        ${stagesHtml}
      </div>`;
  }).join("");

  const isZh = currentLang === "zh";
  const title = isZh ? "工艺单" : "Process Card";
  const L = {
    fabricNo: isZh ? "厂编号" : "Fabric No",
    contract: isZh ? "合同号" : "Contract",
    batch: isZh ? "批次" : "Batch",
    customer: isZh ? "客户" : "Customer",
    sioc: isZh ? "成品号" : "SIOC",
    pattern: isZh ? "花型号" : "Pattern",
    color: isZh ? "颜色" : "Color",
    orderQty: isZh ? "订单数(码)" : "Order Qty(Y)",
    billet: isZh ? "坯布米数" : "Billet(M)",
    billetW: isZh ? "坯布门幅" : "Billet Width",
    finishing: isZh ? "整理方式" : "Finishing",
    printed: isZh ? "打印" : "Printed",
    sign1: isZh ? "工艺员签字" : "Technician",
    sign2: isZh ? "车间签字" : "Workshop",
    sign3: isZh ? "质检签字" : "QC",
  };

  const win = window.open("", "_blank");
  win.document.write(`
    <html><head><title>${title} ${order.contract||""} / ${batch.batch_no||""}</title>
    <style>
      @page { size: A4 landscape; margin: 8mm; }
      body { font-family: "Microsoft YaHei", Arial, sans-serif; font-size: 10px; color: #111; }
      .card-header { border-bottom: 2px solid #1e3a8a; padding-bottom: 6px; margin-bottom: 8px; }
      .card-header .brand { text-align:center; font-size: 14px; font-weight: bold; color: #1e3a8a; letter-spacing: 2px; }
      .card-header .title { text-align:center; font-size: 12px; color: #333; }
      .fabric-no-bar { background: #fef3c7; border: 1px solid #f59e0b; padding: 6px 12px; margin: 6px 0; text-align: center; font-size: 16px; font-weight: bold; color: #92400e; letter-spacing: 2px; border-radius: 6px; }
      .card-info { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; margin-bottom: 8px; font-size: 10px; }
      .card-info .item { border: 1px solid #ddd; padding: 3px 6px; }
      .card-info .item b { color: #666; font-weight: normal; }
      .proc { border: 1px solid #ccc; padding: 4px 6px; margin-bottom: 6px; page-break-inside: avoid; }
      .proc-title { font-weight: bold; font-size: 11px; color: #1e3a8a; margin-bottom: 3px; }
      .proc-meta { font-weight: normal; font-size: 9px; color: #666; margin-left: 6px; }
      .stage { margin: 2px 0 4px 6px; padding-left: 6px; border-left: 2px solid #3b82f6; }
      .stage-title { font-weight: bold; font-size: 10px; color: #1e40af; margin-bottom: 2px; }
      .sub-table { width: 100%; border-collapse: collapse; font-size: 9px; }
      .sub-table th, .sub-table td { border: 1px solid #ccc; padding: 1px 4px; text-align: left; }
      .sub-table th { background: #f0f4ff; font-weight: normal; }
      .footer { margin-top: 10px; display: flex; justify-content: space-between; font-size: 10px; color: #666; }
      .sign { border-top: 1px solid #999; width: 200px; padding-top: 4px; }
    </style></head>
    <body>
      <div class="card-header">
        <div class="brand">JP TEXTILE ETHIOPIA PLC</div>
        <div class="title">${title} / ${L.contract} ${order.contract||""} / ${L.batch} ${batch.batch_no||""}</div>
      </div>

      <div class="fabric-no-bar">${L.fabricNo}: ${order.fabric_number || "—"}</div>

      <div class="card-info">
        <div class="item"><b>${L.contract}:</b> ${order.contract||""}</div>
        <div class="item"><b>${L.batch}:</b> ${batch.batch_no||""}</div>
        <div class="item"><b>${L.customer}:</b> ${order.customer||""}</div>
        <div class="item"><b>${L.sioc}:</b> ${order.sioc||""}</div>
        <div class="item"><b>${L.pattern}:</b> ${order.pattern_no||""}</div>
        <div class="item"><b>${L.color}:</b> ${order.color_name||""}</div>
        <div class="item"><b>${L.orderQty}:</b> ${order.order_qty_y||0}</div>
        <div class="item"><b>${L.billet}:</b> ${billetM}</div>
        <div class="item"><b>${L.billetW}:</b> ${batch.batch_billet_width||0} cm</div>
        <div class="item" style="grid-column:span 3;"><b>${L.finishing}:</b> ${order.finishing_methods||"—"}</div>
        <div class="item"><b>${L.printed}:</b> ${new Date().toLocaleString()}</div>
      </div>

      ${procsHtml}

      <div class="footer">
        <div class="sign">${L.sign1}</div>
        <div class="sign">${L.sign2}</div>
        <div class="sign">${L.sign3}</div>
      </div>
    </body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 300);
}

// 合同汇总打印
async function printContractSummary(orderId) {
  const order = allOrders.find(o => o.id === orderId);
  if (!order) return;
  const batches = await fetchAllRows(TB.batches, "batch_no", true, q => q.eq("order_id", orderId));
  batches.sort((a,b) => (a.batch_no||"").localeCompare(b.batch_no||""));
  const totalProduced = batches.reduce((s,b) => s + (Number(b.batch_billet_m)||0), 0);
  const target = Number(order.actual_billet_qty_m) || 0;
  const pct = target > 0 ? Math.min(100, Math.round(totalProduced/target*100)) : 0;

  const win = window.open("", "_blank");
  win.document.write(`
    <html><head><title>${t("合同汇总","Contract Summary")} ${order.contract||""}</title>
    <style>
      @page { size: A4 landscape; margin: 10mm; }
      body { font-family: "Microsoft YaHei", Arial, sans-serif; font-size: 11px; }
      .brand { text-align:center; font-size: 14px; font-weight: bold; color:#1e3a8a; letter-spacing:2px; }
      h1 { text-align:center; font-size: 13px; margin: 4px 0 10px; }
      .fabric-no-bar { background: #fef3c7; border: 1px solid #f59e0b; padding: 6px 12px; margin: 6px 0; text-align: center; font-size: 16px; font-weight: bold; color: #92400e; letter-spacing: 2px; border-radius: 6px; }
      table { width: 100%; border-collapse: collapse; font-size: 11px; }
      th, td { border: 1px solid #ccc; padding: 4px 8px; text-align: left; }
      th { background: #f0f4ff; font-weight: normal; }
    </style></head>
    <body>
      <div class="brand">JP TEXTILE ETHIOPIA PLC</div>
      <h1>${t("合同汇总","Contract Summary")} / ${order.contract||""}</h1>
      <div class="fabric-no-bar">${t("厂编号","Fabric No")}: ${order.fabric_number || "—"}</div>
      <table style="margin-bottom:10px;">
        <tr><th>${t("客户","Customer")}</th><td>${order.customer||""}</td>
            <th>${t("成品号","SIOC")}</th><td>${order.sioc||""}</td>
            <th>${t("花型号","Pattern")}</th><td>${order.pattern_no||""}</td>
            <th>${t("颜色","Color")}</th><td>${order.color_name||""}</td></tr>
        <tr><th>${t("订单数(码)","Order Qty(Y)")}</th><td>${order.order_qty_y||0}</td>
            <th>${t("坯布米数","Billet(M)")}</th><td>${order.actual_billet_qty_m||0}</td>
            <th>${t("坯布门幅","Billet Width")}</th><td>${order.billet_width||0} cm</td>
            <th>${t("已生产","Produced")}</th><td>${totalProduced.toFixed(1)} M (${pct}%)</td></tr>
      </table>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>${t("批次","Batch")}</th>
            <th>${t("坯布米数","Billet M")}</th>
            <th>${t("坯布门幅","Billet Width")}</th>
            <th>${t("状态","Status")}</th>
            <th>${t("开始","Start")}</th>
            <th>${t("结束","End")}</th>
            <th>${t("操作员","Operator")}</th>
            <th>${t("备注","Note")}</th>
          </tr>
        </thead>
        <tbody>
        ${batches.map((b,i) => `<tr>
          <td>${i+1}</td><td>${b.batch_no}</td>
          <td>${b.batch_billet_m||0}</td>
          <td>${b.batch_billet_width||0} cm</td>
          <td>${statusLabel(b.status)}</td>
          <td>${b.start_date||""}</td>
          <td>${b.end_date||""}</td>
          <td>${b.operator||""}</td>
          <td>${b.note||""}</td>
        </tr>`).join("") || `<tr><td colspan="9" style="text-align:center;color:#999;">${t("无批次","No batches")}</td></tr>`}
        </tbody>
      </table>
    </body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 300);
}

// ============ 导出批次 CSV ============
async function exportBatchCSV(batchId) {
  const { data: batch } = await supabaseClient.from(TB.batches).select("*").eq("id", batchId).single();
  if (!batch) return;
  const order = allOrders.find(o => o.id === batch.order_id);
  const processes = await fetchAllRows(TB.processes, "seq", true, q => q.eq("batch_id", batchId));
  processes.sort((a,b) => (a.seq||0)-(b.seq||0));
  const procIds = processes.map(p => p.id);
  let params = [], aux = [];
  if (procIds.length) {
    params = await fetchAllRows(TB.params, "seq", true, q => q.in("process_id", procIds));
    aux = await fetchAllRows(TB.aux, "created_at", true, q => q.in("process_id", procIds));
  }

  const rows = [];
  rows.push([t("=== 合同 / 批次 ===", "=== Contract / Batch ===")]);
  rows.push([t("合同号","Contract"), t("批次","Batch"), t("客户","Customer"), t("成品号","SIOC"), t("厂编号","Fabric No"), t("坯布米数","Billet(M)"), t("坯布门幅","Billet Width")]);
  rows.push([order?.contract, batch.batch_no, order?.customer, order?.sioc, order?.fabric_number, batch.batch_billet_m, batch.batch_billet_width]);
  rows.push([]);
  rows.push([t("=== 工序 / 参数 / 助剂 ===", "=== Process / Param / Aux ===")]);
  rows.push([t("工序","Process"), t("阶段","Stage"), t("类型","Type"), t("名称","Name"), t("单位","Unit"), t("标准","Std"), t("实际","Actual"), t("日期","Date"), t("班","Shift"), t("操作员","Operator"), t("状态","Status")]);
  processes.forEach(proc => {
    const stages = [...new Set([
      ...params.filter(x=>x.process_id===proc.id && x.param_name!=="(占位)").map(x=>x.stage||"A"),
      ...aux.filter(x=>x.process_id===proc.id).map(x=>x.stage||"A")
    ])].sort();
    if (!stages.length) stages.push("A");
    stages.forEach(st => {
      params.filter(x=>x.process_id===proc.id && (x.stage||"A")===st && x.param_name!=="(占位)").forEach(p => {
        rows.push([proc.process_name, st, t("参数","Param"), p.param_name, p.param_unit||"", p.standard_value||"", p.actual_value||"", p.exec_date||"", p.shift||"", p.operator||"", p.is_out_of_spec?t("超标","OOS"):t("正常","OK")]);
      });
      aux.filter(x=>x.process_id===proc.id && (x.stage||"A")===st).forEach(a => {
        rows.push([proc.process_name, st, t("助剂","Aux"), `${a.aux_name}${a.aux_name_en?" / "+a.aux_name_en:""}(${a.aux_code||""})`, a.dose_unit||"", n1(a.standard_dose), n1(a.actual_kg)+"kg", "", "", "", a.is_out_of_spec?t("超标","OOS"):t("正常","OK")]);
      });
    });
  });
  downloadCSV(rows, `batch_${order?.contract}_${batch.batch_no}_${todayStr()}.csv`);
}

// 导出合同 CSV
async function exportContractCSV(orderId) {
  const order = allOrders.find(o => o.id === orderId);
  if (!order) return;
  const batches = await fetchAllRows(TB.batches, "batch_no", true, q => q.eq("order_id", orderId));
  batches.sort((a,b) => (a.batch_no||"").localeCompare(b.batch_no||""));
  const rows = [];
  rows.push([t("=== 合同头 ===","=== Contract ===")]);
  rows.push([t("合同号","Contract"), t("客户","Customer"), t("成品号","SIOC"), t("花型号","Pattern"), t("颜色","Color"), t("厂编号","Fabric No"), t("订单数(码)","Order Qty(Y)"), t("坯布米数","Billet(M)"), t("坯布门幅","Billet Width")]);
  rows.push([order.contract, order.customer, order.sioc, order.pattern_no, order.color_name, order.fabric_number, order.order_qty_y, order.actual_billet_qty_m, order.billet_width]);
  rows.push([]);
  rows.push([t("=== 生产批次 ===","=== Batches ===")]);
  rows.push([t("批次","Batch"), t("坯布米数","Billet M"), t("坯布门幅","Billet Width"), t("状态","Status"), t("开始","Start"), t("结束","End"), t("操作员","Operator"), t("备注","Note")]);
  batches.forEach(b => {
    rows.push([b.batch_no, b.batch_billet_m, b.batch_billet_width, statusLabel(b.status), b.start_date, b.end_date, b.operator, b.note]);
  });
  downloadCSV(rows, `contract_${order.contract}_${todayStr()}.csv`);
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
  } catch (e) { alert(t("加载 BOM 失败: ","Load BOM failed: ") + e.message); return; }
  filteredBoms = allBoms;
  currentBomPage = 1;
  renderBoms();
}
function renderBoms() {
  const kw = (document.getElementById("bomSearchInput")?.value || "").trim().toLowerCase();
  filteredBoms = allBoms.filter(b => {
    if (!kw) return true;
    return (b.fg_code||"").toLowerCase().includes(kw) || (b.fg_name||"").toLowerCase().includes(kw);
  });
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
      <td>${b.is_active ? t("启用","Active") : t("停用","Inactive")}</td>
      <td>
        <button class="in" onclick="openBomDetail('${b.id}')">${t("查看","View")}</button>
        <button class="edit" onclick="openEditBomHeaderModal('${b.id}')" data-role="admin">${t("编辑","Edit")}</button>
        <button class="del" onclick="deleteBom('${b.id}')" data-role="admin">${t("删除","Del")}</button>
      </td>
    </tr>
  `).join("") || `<tr><td colspan="6" style="text-align:center;color:#999;">${t("暂无 BOM","No BOM")}</td></tr>`;
  document.getElementById("bomPageInfo").textContent = `${currentBomPage} / ${totalPages}  (${total})`;
}
function bomPrevPage() { if (currentBomPage > 1) { currentBomPage--; renderBoms(); } }
function bomNextPage() {
  const tp = Math.ceil(filteredBoms.length / BOM_PAGE_SIZE);
  if (currentBomPage < tp) { currentBomPage++; renderBoms(); }
}

async function openBomDetail(bomId) {
  currentBomIdForEdit = bomId;
  const bom = allBoms.find(b => b.id === bomId);
  if (!bom) return;
  document.getElementById("bomDetailTitle").textContent = `BOM: ${bom.fg_code} ${bom.fg_name||""}`;

  const items = await fetchAllRows(TB.bomItems, "seq", true, q => q.eq("bom_id", bomId));
  const params = await fetchAllRows(TB.bomParams, "seq", true, q => q.eq("bom_id", bomId));
  allBomItemsCache = items;
  allBomParamsCache = params;

  const auxHtml = `
    <div style="font-weight:bold;margin:10px 0 6px;">${t("助剂明细","Aux Details")}（${items.length}）</div>
    <table class="data-table" style="font-size:13px;">
      <thead><tr>
        <th>#</th>
        <th>${t("工序","Process")}</th>
        <th>${t("阶段","Stage")}</th>
        <th>${t("助剂编号","Code")}</th>
        <th>${t("助剂名 / English","Name / English")}</th>
        <th>${t("标准 g/100m","Std g/100m")}</th>
        <th>${t("单位","Unit")}</th>
        <th>${t("容差","Tol")}</th>
        <th>${t("操作","Actions")}</th>
      </tr></thead>
      <tbody>
      ${items.length ? items.map((it, i) => `
        <tr>
          <td>${i+1}</td>
          <td>${it.process_name}</td>
          <td>${it.stage || "A"}</td>
          <td>${it.aux_code || ""}</td>
          <td>
            <div>${it.aux_name}</div>
            ${it.aux_name_en ? `<div style="font-size:11px;color:#888;">${it.aux_name_en}</div>` : ""}
          </td>
          <td>${n1(it.standard_dose)}</td>
          <td>${it.dose_unit || ""}</td>
          <td>${it.tolerance_pct || 10}%</td>
          <td>
            <button class="edit" onclick="openEditBomItemModal('${it.id}')" data-role="admin">${t("编辑","Edit")}</button>
            <button class="del" onclick="deleteBomItem('${it.id}')" data-role="admin">${t("删除","Del")}</button>
          </td>
        </tr>
      `).join("") : `<tr><td colspan="9" style="text-align:center;color:#999;">${t("暂无助剂","No auxiliaries")}</td></tr>`}
      </tbody>
    </table>`;

  const paramHtml = `
    <div style="font-weight:bold;margin:16px 0 6px;">${t("参数明细","Param Details")}（${params.length}）</div>
    <table class="data-table" style="font-size:13px;">
      <thead><tr>
        <th>#</th>
        <th>${t("工序","Process")}</th>
        <th>${t("阶段","Stage")}</th>
        <th>${t("参数名","Param")}</th>
        <th>${t("单位","Unit")}</th>
        <th>${t("标准值","Standard")}</th>
        <th>${t("操作","Actions")}</th>
      </tr></thead>
      <tbody>
      ${params.length ? params.map((p, i) => `
        <tr>
          <td>${i+1}</td>
          <td>${p.process_name}</td>
          <td>${p.stage || "A"}</td>
          <td>${p.param_name}</td>
          <td>${p.param_unit || ""}</td>
          <td>${p.standard_value || ""}</td>
          <td>
            <button class="edit" onclick="openEditBomParamModal('${p.id}')" data-role="admin">${t("编辑","Edit")}</button>
            <button class="del" onclick="deleteBomParam('${p.id}')" data-role="admin">${t("删除","Del")}</button>
          </td>
        </tr>
      `).join("") : `<tr><td colspan="7" style="text-align:center;color:#999;">${t("暂无参数","No params")}</td></tr>`}
      </tbody>
    </table>`;

  document.getElementById("bomDetailBody").innerHTML = auxHtml + paramHtml;
  document.getElementById("bomDetailModal").style.display = "flex";
}
function closeBomDetailModal() {
  document.getElementById("bomDetailModal").style.display = "none";
  currentBomIdForEdit = null;
}

async function deleteBom(bomId) {
  if (!canDelete()) { alert(t("无权限","No permission")); return; }
  if (!confirm(t("确定删除该 BOM？（明细一起删除）","Delete BOM with all details?"))) return;
  await supabaseClient.from(TB.bomHeaders).delete().eq("id", bomId);
  await writeSysLog("delete_bom", t(`删除 BOM ${bomId}`,`Delete BOM ${bomId}`), null);
  await loadBoms();
}

function openAddBomHeaderModal() {
  editingBomHeaderId = null;
  document.getElementById("bomHeaderModalTitle").textContent = t("新增 BOM","Add BOM");
  document.getElementById("bh_fg_code").value = "";
  document.getElementById("bh_fg_name").value = "";
  document.getElementById("bh_category").value = "";
  document.getElementById("bh_note").value = "";
  document.getElementById("bomHeaderMsg").textContent = "";
  document.getElementById("bomHeaderModal").style.display = "flex";
}
function openEditBomHeaderModal(bomId) {
  const b = allBoms.find(x => x.id === bomId);
  if (!b) return;
  editingBomHeaderId = bomId;
  document.getElementById("bomHeaderModalTitle").textContent = t("编辑 BOM","Edit BOM");
  document.getElementById("bh_fg_code").value = b.fg_code || "";
  document.getElementById("bh_fg_name").value = b.fg_name || "";
  document.getElementById("bh_category").value = b.category || "";
  document.getElementById("bh_note").value = b.note || "";
  document.getElementById("bomHeaderMsg").textContent = "";
  document.getElementById("bomHeaderModal").style.display = "flex";
}
function closeBomHeaderModal() { document.getElementById("bomHeaderModal").style.display = "none"; }
async function saveBomHeader() {
  const payload = {
    fg_code: document.getElementById("bh_fg_code").value.trim(),
    fg_name: document.getElementById("bh_fg_name").value.trim(),
    category: document.getElementById("bh_category").value.trim(),
    note: document.getElementById("bh_note").value.trim(),
  };
  if (!payload.fg_code) { document.getElementById("bomHeaderMsg").textContent = t("成品号必填","FG code required"); return; }
  let error;
  if (editingBomHeaderId) {
    ({ error } = await supabaseClient.from(TB.bomHeaders).update(payload).eq("id", editingBomHeaderId));
  } else {
    ({ error } = await supabaseClient.from(TB.bomHeaders).insert(payload));
  }
  if (error) { document.getElementById("bomHeaderMsg").textContent = t("保存失败: ","Save failed: ") + error.message; return; }
  closeBomHeaderModal();
  await loadBoms();
}

function openAddBomItemModal() {
  if (!currentBomIdForEdit) return;
  editingBomItemId = null;
  document.getElementById("bomItemModalTitle").textContent = t("新增 BOM 助剂","Add BOM Aux");
  document.getElementById("bi_process_name").value = "";
  document.getElementById("bi_stage").value = "A";
  document.getElementById("bi_aux_code").value = "";
  document.getElementById("bi_aux_name").value = "";
  document.getElementById("bi_aux_name_en").value = "";
  document.getElementById("bi_standard_dose").value = "";
  document.getElementById("bi_dose_unit").value = "g/100m";
  document.getElementById("bi_tolerance_pct").value = "10";
  document.getElementById("bi_note").value = "";
  document.getElementById("bomItemMsg").textContent = "";
  document.getElementById("bomItemModal").style.display = "flex";
}
function openEditBomItemModal(itemId) {
  const it = allBomItemsCache.find(x => x.id === itemId);
  if (!it) return;
  editingBomItemId = itemId;
  document.getElementById("bomItemModalTitle").textContent = t("编辑 BOM 助剂","Edit BOM Aux");
  document.getElementById("bi_process_name").value = it.process_name || "";
  document.getElementById("bi_stage").value = it.stage || "A";
  document.getElementById("bi_aux_code").value = it.aux_code || "";
  document.getElementById("bi_aux_name").value = it.aux_name || "";
  document.getElementById("bi_aux_name_en").value = it.aux_name_en || "";
  document.getElementById("bi_standard_dose").value = it.standard_dose || 0;
  document.getElementById("bi_dose_unit").value = it.dose_unit || "g/100m";
  document.getElementById("bi_tolerance_pct").value = it.tolerance_pct ?? 10;
  document.getElementById("bi_note").value = it.note || "";
  document.getElementById("bomItemMsg").textContent = "";
  document.getElementById("bomItemModal").style.display = "flex";
}
function closeBomItemModal() { document.getElementById("bomItemModal").style.display = "none"; }
async function saveBomItem() {
  const payload = {
    bom_id: currentBomIdForEdit,
    process_name: document.getElementById("bi_process_name").value.trim(),
    stage: document.getElementById("bi_stage").value.trim() || "A",
    aux_code: document.getElementById("bi_aux_code").value.trim(),
    aux_name: document.getElementById("bi_aux_name").value.trim(),
    aux_name_en: document.getElementById("bi_aux_name_en").value.trim(),
    standard_dose: Number(document.getElementById("bi_standard_dose").value) || 0,
    dose_unit: document.getElementById("bi_dose_unit").value.trim() || "g/100m",
    tolerance_pct: Number(document.getElementById("bi_tolerance_pct").value) || 10,
    note: document.getElementById("bi_note").value.trim(),
  };
  if (!payload.aux_name) { document.getElementById("bomItemMsg").textContent = t("助剂名必填","Aux name required"); return; }
  let error;
  if (editingBomItemId) {
    ({ error } = await supabaseClient.from(TB.bomItems).update(payload).eq("id", editingBomItemId));
  } else {
    ({ error } = await supabaseClient.from(TB.bomItems).insert(payload));
  }
  if (error) { document.getElementById("bomItemMsg").textContent = t("保存失败: ","Save failed: ") + error.message; return; }
  closeBomItemModal();
  await openBomDetail(currentBomIdForEdit);
}
async function deleteBomItem(itemId) {
  if (!canDelete()) { alert(t("无权限","No permission")); return; }
  if (!confirm(t("确定删除该助剂？","Delete this aux?"))) return;
  await supabaseClient.from(TB.bomItems).delete().eq("id", itemId);
  await openBomDetail(currentBomIdForEdit);
}

function openAddBomParamModal() {
  if (!currentBomIdForEdit) return;
  editingBomParamId = null;
  document.getElementById("bomParamModalTitle").textContent = t("新增 BOM 参数","Add BOM Param");
  document.getElementById("bp_process_name").value = "";
  document.getElementById("bp_stage").value = "A";
  document.getElementById("bp_param_name").value = "";
  document.getElementById("bp_param_unit").value = "";
  document.getElementById("bp_standard_value").value = "";
  document.getElementById("bomParamMsg").textContent = "";
  document.getElementById("bomParamModal").style.display = "flex";
}
function openEditBomParamModal(paramId) {
  const p = allBomParamsCache.find(x => x.id === paramId);
  if (!p) return;
  editingBomParamId = paramId;
  document.getElementById("bomParamModalTitle").textContent = t("编辑 BOM 参数","Edit BOM Param");
  document.getElementById("bp_process_name").value = p.process_name || "";
  document.getElementById("bp_stage").value = p.stage || "A";
  document.getElementById("bp_param_name").value = p.param_name || "";
  document.getElementById("bp_param_unit").value = p.param_unit || "";
  document.getElementById("bp_standard_value").value = p.standard_value || "";
  document.getElementById("bomParamMsg").textContent = "";
  document.getElementById("bomParamModal").style.display = "flex";
}
function closeBomParamModal() { document.getElementById("bomParamModal").style.display = "none"; }
async function saveBomParam() {
  const payload = {
    bom_id: currentBomIdForEdit,
    process_name: document.getElementById("bp_process_name").value.trim(),
    stage: document.getElementById("bp_stage").value.trim() || "A",
    param_name: document.getElementById("bp_param_name").value.trim(),
    param_unit: document.getElementById("bp_param_unit").value.trim(),
    standard_value: document.getElementById("bp_standard_value").value.trim(),
  };
  if (!payload.param_name) { document.getElementById("bomParamMsg").textContent = t("参数名必填","Param name required"); return; }
  let error;
  if (editingBomParamId) {
    ({ error } = await supabaseClient.from(TB.bomParams).update(payload).eq("id", editingBomParamId));
  } else {
    ({ error } = await supabaseClient.from(TB.bomParams).insert(payload));
  }
  if (error) { document.getElementById("bomParamMsg").textContent = t("保存失败: ","Save failed: ") + error.message; return; }
  closeBomParamModal();
  await openBomDetail(currentBomIdForEdit);
}
async function deleteBomParam(paramId) {
  if (!canDelete()) { alert(t("无权限","No permission")); return; }
  if (!confirm(t("确定删除该参数？","Delete this param?"))) return;
  await supabaseClient.from(TB.bomParams).delete().eq("id", paramId);
  await openBomDetail(currentBomIdForEdit);
}

// ============ BOM CSV 导入 ============
function openBomImportModal() {
  document.getElementById("bomItemsFile").value = "";
  document.getElementById("bomParamsFile").value = "";
  document.getElementById("bomImportMsg").textContent = "";
  document.getElementById("bomImportModal").style.display = "flex";
}
function closeBomImportModal() { document.getElementById("bomImportModal").style.display = "none"; }

function downloadBomItemsTemplate() {
  const headers = ["sioc","process_name","stage","aux_code","aux_name","aux_name_en","standard_dose","dose_unit","tolerance_pct"];
  const sample = [["FG-CV-00055","退浆 Desizing","A","RM-AD-00002","209退浆用洗涤剂","Desizing with high consistency detergent","192.0","g/100m","10"]];
  downloadCSV([headers, ...sample], "bom_items_template.csv");
}
function downloadBomParamsTemplate() {
  const headers = ["sioc","process_name","stage","param_name","param_unit","standard_value"];
  const sample = [["FG-CV-00055","退浆 Desizing","A","温度 Temp","℃","98"]];
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
  if (!itemsFile && !paramsFile) { msg.textContent = t("至少选一个 CSV","Select at least one CSV"); return; }

  let itemsRows = [], paramsRows = [];
  if (itemsFile) itemsRows = parseCSV(await itemsFile.text());
  if (paramsFile) paramsRows = parseCSV(await paramsFile.text());

  const siocs = new Set();
  itemsRows.forEach(r => r.sioc && siocs.add(r.sioc));
  paramsRows.forEach(r => r.sioc && siocs.add(r.sioc));
  if (!siocs.size) { msg.textContent = t("没有有效数据","No valid data"); return; }

  msg.textContent = t(`导入 ${siocs.size} 个 BOM...`, `Importing ${siocs.size} BOM...`);
  let ok = 0, failed = 0;
  for (const sioc of siocs) {
    let bomId;
    const { data: exist } = await supabaseClient.from(TB.bomHeaders).select("id").eq("fg_code", sioc).maybeSingle();
    if (exist) {
      bomId = exist.id;
      await supabaseClient.from(TB.bomItems).delete().eq("bom_id", bomId);
      await supabaseClient.from(TB.bomParams).delete().eq("bom_id", bomId);
    } else {
      const { data: ins, error } = await supabaseClient.from(TB.bomHeaders).insert({ fg_code: sioc }).select().single();
      if (error) { failed++; continue; }
      bomId = ins.id;
      ok++;
    }

    const its = itemsRows.filter(r => r.sioc === sioc);
    if (its.length) {
      const payload = its.map((r, i) => ({
        bom_id: bomId, seq: i + 1,
        process_name: r.process_name || "", stage: r.stage || "A",
        aux_code: r.aux_code || "", aux_name: r.aux_name || "",
        aux_name_en: r.aux_name_en || "",
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

    const prs = paramsRows.filter(r => r.sioc === sioc);
    if (prs.length) {
      const payload = prs.map((r, i) => ({
        bom_id: bomId, process_name: r.process_name || "",
        stage: r.stage || "A", param_name: r.param_name || "",
        param_unit: r.param_unit || "", standard_value: r.standard_value || "",
        seq: i + 1,
      }));
      const { error: e } = await supabaseClient.from(TB.bomParams).insert(payload);
      if (e) failed++;
    }
  }
  msg.textContent = t(`✅ 完成\n新增 BOM: ${ok}\n失败: ${failed}`, `✅ Done\nAdded BOM: ${ok}\nFailed: ${failed}`);
  await writeSysLog("bom_import", t(`BOM 导入: 新增 ${ok}, 失败 ${failed}`, `BOM import: OK ${ok}, Failed ${failed}`), null);
  setTimeout(() => { closeBomImportModal(); loadBoms(); }, 1500);
}

// ============ 超标汇总页 ============
async function showOOSPage() {
  hideAll();
  document.getElementById("oosPage").style.display = "block";
  document.getElementById("userEmailOOS").textContent = document.getElementById("userEmail2").textContent;
  await loadOOS();
}
async function loadOOS() {
  const params = await fetchAllRows(TB.params, "created_at", false, q => q.eq("is_out_of_spec", true));
  const auxes = await fetchAllRows(TB.aux, "created_at", false, q => q.eq("is_out_of_spec", true));

  const procIds = [...new Set([...params.map(x => x.process_id), ...auxes.map(x => x.process_id)])];
  let procs = [];
  if (procIds.length) {
    const { data } = await supabaseClient.from(TB.processes).select("*").in("id", procIds);
    procs = data || [];
  }
  // 拿批次
  const batchIds = [...new Set(procs.map(p => p.batch_id).filter(Boolean))];
  let batches = [];
  if (batchIds.length) {
    const { data } = await supabaseClient.from(TB.batches).select("*").in("id", batchIds);
    batches = data || [];
  }
  const orderIds = [...new Set(batches.map(b => b.order_id))];
  let orders = [];
  if (orderIds.length) {
    const { data } = await supabaseClient.from(TB.orders).select("*").in("id", orderIds);
    orders = data || [];
  }
  const procMap = {}, batchMap = {}, orderMap = {};
  procs.forEach(p => procMap[p.id] = p);
  batches.forEach(b => batchMap[b.id] = b);
  orders.forEach(o => orderMap[o.id] = o);

  document.getElementById("oosParamCount").textContent = params.length;
  document.getElementById("oosParamBody").innerHTML = params.map((p, i) => {
    const proc = procMap[p.process_id] || {};
    const batch = batchMap[proc.batch_id] || {};
    const order = orderMap[batch.order_id] || {};
    return `
      <tr>
        <td>${i+1}</td>
        <td>${order.contract || ""}</td>
        <td>${batch.batch_no || ""}</td>
        <td>${order.customer || ""}</td>
        <td>${order.fabric_number || ""}</td>
        <td>${proc.process_name || ""}</td>
        <td>${p.stage || "A"}</td>
        <td>${p.param_name}</td>
        <td>${p.standard_value || ""}</td>
        <td style="color:#dc2626;font-weight:bold;">${p.actual_value || ""}</td>
        <td><button class="in" onclick="openBatchDetail('${proc.batch_id}')">${t("查看批次","View")}</button></td>
      </tr>`;
  }).join("") || `<tr><td colspan="11" style="text-align:center;color:#999;">${t("无参数超标","No param OOS")}</td></tr>`;

  document.getElementById("oosAuxCount").textContent = auxes.length;
  document.getElementById("oosAuxBody").innerHTML = auxes.map((a, i) => {
    const proc = procMap[a.process_id] || {};
    const batch = batchMap[proc.batch_id] || {};
    const order = orderMap[batch.order_id] || {};
    return `
      <tr>
        <td>${i+1}</td>
        <td>${order.contract || ""}</td>
        <td>${batch.batch_no || ""}</td>
        <td>${order.customer || ""}</td>
        <td>${order.fabric_number || ""}</td>
        <td>${proc.process_name || ""}</td>
        <td>${a.stage || "A"}</td>
        <td>${a.aux_name}</td>
        <td>${n1(a.theory_kg)}</td>
        <td style="color:#dc2626;font-weight:bold;">${n1(a.actual_kg)}</td>
        <td>${n1(a.deviation_pct)}%</td>
        <td><button class="in" onclick="openBatchDetail('${proc.batch_id}')">${t("查看批次","View")}</button></td>
      </tr>`;
  }).join("") || `<tr><td colspan="12" style="text-align:center;color:#999;">${t("无助剂超标","No aux OOS")}</td></tr>`;

  allOOSParam = params;
  allOOSAux = auxes;
}
function exportOOSCSV() {
  const rows = [[t("=== 参数超标 ===","=== Param OOS ===")]];
  rows.push([t("合同号","Contract"), t("批次","Batch"), t("客户","Customer"), t("厂编号","Fabric No"), t("工序","Process"), t("阶段","Stage"), t("参数名","Param"), t("标准值","Standard"), t("实际值","Actual")]);
  allOOSParam.forEach(p => rows.push([p.contract||"", p.batch_no||"", p.customer||"", p.fabric_number||"", p.process_name||"", p.stage||"A", p.param_name, p.standard_value||"", p.actual_value||""]));
  rows.push([]);
  rows.push([t("=== 助剂超标 ===","=== Aux OOS ===")]);
  rows.push([t("合同号","Contract"), t("批次","Batch"), t("客户","Customer"), t("厂编号","Fabric No"), t("工序","Process"), t("阶段","Stage"), t("助剂名","Aux"), t("理论(kg)","Theory(kg)"), t("实际(kg)","Actual(kg)"), t("偏差%","Dev%")]);
  allOOSAux.forEach(a => rows.push([a.contract||"", a.batch_no||"", a.customer||"", a.fabric_number||"", a.process_name||"", a.stage||"A", a.aux_name, a.theory_kg||0, a.actual_kg||0, a.deviation_pct||0]));
  downloadCSV(rows, `oos_${todayStr()}.csv`);
}

// ============ 报表：按工序 ============
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

  // 找该月下单的所有合同
  const orders = allOrders.filter(o => o.order_date && o.order_date >= first && o.order_date <= last);
  const orderIds = orders.map(o => o.id);

  let batches = [], processes = [], params = [], aux = [];
  if (orderIds.length) {
    batches = await fetchAllRows(TB.batches, "created_at", true, q => q.in("order_id", orderIds));
    const batchIds = batches.map(b => b.id);
    if (batchIds.length) {
      processes = await fetchAllRows(TB.processes, "seq", true, q => q.in("batch_id", batchIds));
      const pids = processes.map(p => p.id);
      if (pids.length) {
        params = await fetchAllRows(TB.params, "seq", true, q => q.in("process_id", pids));
        aux = await fetchAllRows(TB.aux, "created_at", true, q => q.in("process_id", pids));
      }
    }
  }

  renderRepProc(orders, batches, processes, params, aux);
}

function renderRepProc(orders, batches, processes, params, aux) {
  const stats = {};
  const procMap = {};
  processes.forEach(p => {
    procMap[p.id] = p;
    const k = p.process_name;
    if (!stats[k]) stats[k] = { contracts: new Set(), batches: new Set(), paramCount: 0, paramOOS: 0, auxCount: 0, auxOOS: 0 };
    stats[k].batches.add(p.batch_id);
  });
  // 反向找 order_id
  const batchToOrder = {};
  batches.forEach(b => batchToOrder[b.id] = b.order_id);
  processes.forEach(p => {
    const k = p.process_name;
    const oid = batchToOrder[p.batch_id];
    if (oid) stats[k].contracts.add(oid);
  });
  params.forEach(pa => {
    const proc = procMap[pa.process_id];
    if (!proc) return;
    const k = proc.process_name;
    stats[k].paramCount++;
    if (pa.is_out_of_spec) stats[k].paramOOS++;
  });
  aux.forEach(a => {
    const proc = procMap[a.process_id];
    if (!proc) return;
    const k = proc.process_name;
    stats[k].auxCount++;
    if (a.is_out_of_spec) stats[k].auxOOS++;
  });

  const rows = Object.entries(stats).sort((a,b) => a[0].localeCompare(b[0]));
  document.getElementById("repProcBody").innerHTML = rows.map(([name, s]) => {
    const pRate = s.paramCount ? ((s.paramOOS / s.paramCount) * 100).toFixed(1) : "0.0";
    const aRate = s.auxCount ? ((s.auxOOS / s.auxCount) * 100).toFixed(1) : "0.0";
    return `<tr>
      <td>${name}</td>
      <td>${s.contracts.size}</td>
      <td>${s.batches.size}</td>
      <td>${s.paramCount}</td>
      <td style="color:${s.paramOOS>0?'#dc2626':'#333'};">${s.paramOOS}</td>
      <td>${pRate}%</td>
      <td>${s.auxCount}</td>
      <td style="color:${s.auxOOS>0?'#dc2626':'#333'};">${s.auxOOS}</td>
      <td>${aRate}%</td>
    </tr>`;
  }).join("") || `<tr><td colspan="9" style="text-align:center;color:#999;">${t("本月无数据","No data this month")}</td></tr>`;
}

function exportReportCSV() {
  const tabEl = document.getElementById("repProcBody");
  if (!tabEl) return;
  const table = tabEl.closest("table");
  const rows = [];
  table.querySelectorAll("tr").forEach(tr => {
    const cells = [];
    tr.querySelectorAll("th, td").forEach(c => cells.push(c.textContent.trim()));
    if (cells.length) rows.push(cells);
  });
  downloadCSV(rows, `report_by_process_${todayStr()}.csv`);
}

// ============ 操作记录 ============
async function showLogs() {
  hideAll();
  document.getElementById("logsPage").style.display = "block";
  document.getElementById("userEmailLogs").textContent = document.getElementById("userEmail2").textContent;
  allLogsCache = await fetchAllRows(TB.logs, "created_at", false);
  filterLogs();
}
function filterLogs() {
  const kw = (document.getElementById("logSearch")?.value || "").trim().toLowerCase();
  const action = document.getElementById("logAction")?.value || "";
  let rows = allLogsCache;
  if (action) rows = rows.filter(l => l.action === action);
  if (kw) rows = rows.filter(l =>
    (l.detail||"").toLowerCase().includes(kw) ||
    (l.user_email||"").toLowerCase().includes(kw) ||
    (l.ref_no||"").toLowerCase().includes(kw)
  );
  document.getElementById("logBody").innerHTML = rows.slice(0, 500).map((l, i) => `
    <tr>
      <td>${i+1}</td>
      <td>${fmtTime(l.created_at)}</td>
      <td>${l.user_email || ""}</td>
      <td>${l.action}</td>
      <td>${l.ref_no || ""}</td>
      <td style="white-space:pre-wrap;">${esc(l.detail)}</td>
    </tr>
  `).join("") || `<tr><td colspan="6" style="text-align:center;color:#999;">${t("暂无记录","No records")}</td></tr>`;
}
function exportLogsCSV() {
  const rows = [[t("时间","Time"), t("操作人","Operator"), t("动作","Action"), t("单号","Ref No"), t("详情","Detail")]];
  allLogsCache.forEach(l => rows.push([fmtTime(l.created_at), l.user_email||"", l.action, l.ref_no||"", l.detail||""]));
  downloadCSV(rows, `logs_${todayStr()}.csv`);
}

async function showSysLogs() {
  hideAll();
  document.getElementById("sysLogsPage").style.display = "block";
  document.getElementById("userEmailSysLogs").textContent = document.getElementById("userEmail2").textContent;
  const data = await fetchAllRows(TB.logs, "created_at", false);
  document.getElementById("sysLogBody").innerHTML = (data || []).slice(0, 500).map((l, i) => `
    <tr>
      <td>${i+1}</td>
      <td>${fmtTime(l.created_at)}</td>
      <td>${l.user_email || ""}</td>
      <td>${l.action}</td>
      <td style="white-space:pre-wrap;">${esc(l.detail)}</td>
    </tr>
  `).join("") || `<tr><td colspan="5" style="text-align:center;color:#999;">${t("暂无日志","No logs")}</td></tr>`;
}

// ============ 备份 ============
async function backupAll() {
  if (currentUserRole !== "admin") { alert(t("仅管理员可备份","Admin only")); return; }
  const stamp = todayStr();
  try {
    const orders = await fetchAllRows(TB.orders, "created_at", false);
    const batches = await fetchAllRows(TB.batches, "created_at", false);
    const processes = await fetchAllRows(TB.processes, "created_at", false);
    const params = await fetchAllRows(TB.params, "created_at", false);
    const aux = await fetchAllRows(TB.aux, "created_at", false);
    const dump = (rows, filename) => {
      if (!rows.length) { downloadCSV([["(empty)"]], filename); return; }
      const headers = Object.keys(rows[0]);
      downloadCSV([headers, ...rows.map(r => headers.map(h => r[h]))], filename);
    };
    dump(orders, `craft_orders_${stamp}.csv`);
    dump(batches, `craft_batches_${stamp}.csv`);
    dump(processes, `craft_processes_${stamp}.csv`);
    dump(params, `craft_params_${stamp}.csv`);
    dump(aux, `craft_aux_${stamp}.csv`);
    alert(t("备份完成","Backup done"));
  } catch (e) { alert(t("备份失败: ","Backup failed: ") + e.message); }
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
  if (!np || np.length < 6) { msg.textContent = t("密码至少 6 位","Min 6 chars"); return; }
  if (np !== cp) { msg.textContent = t("两次不一致","Passwords mismatch"); return; }
  const { error } = await supabaseClient.auth.updateUser({ password: np });
  if (error) { msg.textContent = t("修改失败: ","Failed: ") + error.message; return; }
  alert(t("密码修改成功","Password updated"));
  closePwdModal();
}

// ============================================================
// 合并投料 (Merge Materials)
// ============================================================

let mergeSearchResults = [];   // 搜索结果（含 order、batch、process）
let mergeSelected = new Set(); // 已选批次 id
let mergeCurrentRows = [];     // 主弹窗里的助剂行

// ---------- 打开选择面板 ----------
async function openMergePanel() {
  if (!canEdit()) { alert(t("无权限","No permission")); return; }
  mergeSelected.clear();
  document.getElementById("mergeSearchKeyword").value = "";
  document.getElementById("mergeSearchFabrics").value = "";
  document.getElementById("mergeSearchFrom").value = "";
  document.getElementById("mergeSearchTo").value = "";
  document.getElementById("mergePanelModal").style.display = "flex";
  await renderMergeSearch();
}

function closeMergePanel() {
  document.getElementById("mergePanelModal").style.display = "none";
}

// ---------- 搜索渲染 ----------
async function renderMergeSearch() {
  const kw = (document.getElementById("mergeSearchKeyword").value || "").trim().toLowerCase();
  const fabricsRaw = (document.getElementById("mergeSearchFabrics").value || "").trim();
  const fabrics = fabricsRaw ? fabricsRaw.split(/[,，\s]+/).map(x => x.trim().toLowerCase()).filter(Boolean) : [];
  const from = document.getElementById("mergeSearchFrom").value;
  const to = document.getElementById("mergeSearchTo").value;

  // 拉所有批次（带合同头）
  let batches = [];
  try { batches = await fetchAllRows(TB.batches, "created_at", false); } catch (e) {}

  // 拉所有合同
  const orderMap = {};
  allOrders.forEach(o => orderMap[o.id] = o);

  // 组合结果
  const results = [];
  for (const b of batches) {
    const o = orderMap[b.order_id];
    if (!o) continue;

    // 筛选
    if (kw) {
      const hay = [
        (o.contract||""), (o.customer||""), (o.sioc||""), (o.pattern_no||""), (o.color_name||""),
      ].join(" ").toLowerCase();
      if (!hay.includes(kw)) continue;
    }
    if (fabrics.length) {
      const fn = (o.fabric_number || "").toLowerCase();
      if (!fabrics.some(f => fn.includes(f))) continue;
    }
    if (from && o.order_date && o.order_date < from) continue;
    if (to && o.order_date && o.order_date > to) continue;

    // 批次数（米数必须 > 0）
    results.push({
      order: o,
      batch: b,
      hasBillet: Number(b.batch_billet_m) > 0,
    });
  }

  mergeSearchResults = results;

  // 渲染
  document.getElementById("mergePanelBody").innerHTML = results.map(r => {
    const checked = mergeSelected.has(r.batch.id) ? "checked" : "";
    const disabled = r.hasBillet ? "" : "disabled";
    const warn = r.hasBillet ? "" : `<span style="color:#dc2626;font-size:11px;margin-left:6px;">${t("米数为 0","M=0")}</span>`;
    return `
      <tr>
        <td style="text-align:center;">
          <input type="checkbox" ${checked} ${disabled} onchange="toggleMergeSelected('${r.batch.id}', this.checked)" />
        </td>
        <td>${r.order.contract || ""}</td>
        <td>${r.batch.batch_no || ""}</td>
        <td>${r.order.fabric_number || ""}</td>
        <td>${r.order.customer || ""}</td>
        <td>${r.batch.batch_billet_m || 0}${warn}</td>
        <td>${statusLabel(r.batch.status)}</td>
      </tr>
    `;
  }).join("") || `<tr><td colspan="7" style="text-align:center;color:#999;">${t("无匹配结果","No results")}</td></tr>`;

  updateMergeSelectedInfo();
}

function toggleMergeSelected(batchId, checked) {
  if (checked) mergeSelected.add(batchId);
  else mergeSelected.delete(batchId);
  updateMergeSelectedInfo();
}

function toggleAllMergeSearch(checked) {
  mergeSearchResults.forEach(r => {
    if (!r.hasBillet) return; // 米数 0 的不能选
    if (checked) mergeSelected.add(r.batch.id);
    else mergeSelected.delete(r.batch.id);
  });
  renderMergeSearch();
}

function updateMergeSelectedInfo() {
  const arr = [...mergeSelected];
  const selectedRows = mergeSearchResults.filter(r => arr.includes(r.batch.id));
  const totalM = selectedRows.reduce((s,r) => s + (Number(r.batch.batch_billet_m) || 0), 0);
  document.getElementById("mergeSelectedInfo").innerHTML =
    t(`已选 <b>${selectedRows.length}</b> 条 · 累计 <b>${totalM.toFixed(1)}</b> M`,
      `Selected <b>${selectedRows.length}</b> · Total <b>${totalM.toFixed(1)}</b> M`);
}

// ---------- 下一步 → 主弹窗 ----------
async function goToMergeMain() {
  const arr = [...mergeSelected];
  if (!arr.length) { alert(t("请至少勾选 1 个批次","Select at least 1 batch")); return; }

  // 取选中的批次详情
  const selectedBatches = mergeSearchResults
    .filter(r => arr.includes(r.batch.id))
    .map(r => ({ ...r }));

  // 校验米数
  for (const r of selectedBatches) {
    if (!r.hasBillet) {
      alert(t(`批次 ${r.batch.batch_no} 坯布米数为 0，请先补上`,
              `Batch ${r.batch.batch_no} billet M is 0, please fill first`));
      return;
    }
  }

  window.__mergeBatches = selectedBatches;
  window.__mergeTotalM = selectedBatches.reduce((s,r) => s + (Number(r.batch.batch_billet_m) || 0), 0);

  // 渲染已选批次表
  document.getElementById("mergeShareBody").innerHTML = selectedBatches.map(r => {
    const m = Number(r.batch.batch_billet_m) || 0;
    const pct = (m / window.__mergeTotalM * 100).toFixed(2);
    return `
      <tr>
        <td>${r.order.contract || ""}</td>
        <td>${r.batch.batch_no || ""}</td>
        <td>${r.order.fabric_number || ""}</td>
        <td>${m}</td>
        <td><b>${pct}%</b></td>
      </tr>`;
  }).join("");

  // 初始化助剂行
  mergeCurrentRows = [];
  document.getElementById("mergeMaterialBody").innerHTML = "";
  addMergeMaterialRow();

  // 默认值
  document.getElementById("merge_date").value = todayStr();
  document.getElementById("merge_shift").value = "A";
  document.getElementById("merge_operator").value = "";
  document.getElementById("mergePreview").innerHTML = "";
  document.getElementById("mergeMainMsg").textContent = "";

  closeMergePanel();
  document.getElementById("mergeMainModal").style.display = "flex";
}

function closeMergeMain() {
  document.getElementById("mergeMainModal").style.display = "none";
}

// ---------- 助剂行：增删 ----------
function addMergeMaterialRow() {
  const idx = mergeCurrentRows.length;
  mergeCurrentRows.push({ process_name: "", stage: "A", aux_name: "", actual_kg: 0 });
  const tr = document.createElement("tr");
  tr.setAttribute("data-row", idx);
  tr.innerHTML = `
    <td><input type="text" placeholder="如 退浆 Desizing" style="width:100%;padding:5px;border:1px solid #ddd;border-radius:4px;" oninput="onMergeRowChange(${idx}, 'process_name', this.value)" /></td>
    <td><input type="text" value="A" style="width:100%;padding:5px;border:1px solid #ddd;border-radius:4px;" oninput="onMergeRowChange(${idx}, 'stage', this.value)" /></td>
    <td><input type="text" placeholder="如 209退浆用洗涤剂" style="width:100%;padding:5px;border:1px solid #ddd;border-radius:4px;" oninput="onMergeRowChange(${idx}, 'aux_name', this.value)" /></td>
    <td><input type="number" step="0.01" value="" style="width:100%;padding:5px;border:1px solid #ddd;border-radius:4px;" oninput="onMergeRowChange(${idx}, 'actual_kg', Number(this.value)||0)" /></td>
    <td><button type="button" onclick="removeMergeRow(${idx})" style="padding:4px 10px;background:#ef4444;color:#fff;border:none;border-radius:4px;cursor:pointer;" data-zh="删除" data-en="Del">删除</button></td>
  `;
  document.getElementById("mergeMaterialBody").appendChild(tr);
}

function removeMergeRow(idx) {
  if (mergeCurrentRows.length <= 1) { alert(t("至少保留一行","At least 1 row")); return; }
  mergeCurrentRows.splice(idx, 1);
  // 重渲染（简单做法：清空重画）
  document.getElementById("mergeMaterialBody").innerHTML = "";
  const rows = [...mergeCurrentRows];
  mergeCurrentRows = [];
  rows.forEach(r => {
    addMergeMaterialRow();
    const newIdx = mergeCurrentRows.length - 1;
    mergeCurrentRows[newIdx].process_name = r.process_name;
    mergeCurrentRows[newIdx].stage = r.stage;
    mergeCurrentRows[newIdx].aux_name = r.aux_name;
    mergeCurrentRows[newIdx].actual_kg = r.actual_kg;
    const tr = document.querySelector(`[data-row="${newIdx}"]`);
    if (tr) {
      tr.children[0].querySelector("input").value = r.process_name;
      tr.children[1].querySelector("input").value = r.stage;
      tr.children[2].querySelector("input").value = r.aux_name;
      tr.children[3].querySelector("input").value = r.actual_kg || "";
    }
  });
  renderMergePreview();
}

function onMergeRowChange(idx, field, value) {
  if (!mergeCurrentRows[idx]) return;
  mergeCurrentRows[idx][field] = value;
  renderMergePreview();
}

// ---------- 分摊预览 ----------
function renderMergePreview() {
  const batches = window.__mergeBatches || [];
  const totalM = window.__mergeTotalM || 0;
  if (!batches.length || !totalM) { document.getElementById("mergePreview").innerHTML = ""; return; }

  let html = "";
  for (const r of batches) {
    const m = Number(r.batch.batch_billet_m) || 0;
    const share = m / totalM;
    html += `<div style="font-weight:bold;margin-top:6px;">${r.order.contract} / ${r.batch.batch_no} (厂编号 ${r.order.fabric_number||"—"})</div>`;
    for (const row of mergeCurrentRows) {
      if (!row.aux_name || !row.actual_kg) continue;
      const splitKg = row.actual_kg * share;
      html += `<div style="margin-left:12px;">${row.aux_name}: <b>${splitKg.toFixed(2)}</b> KG (占比 ${(share*100).toFixed(2)}%)</div>`;
    }
  }
  document.getElementById("mergePreview").innerHTML = html || `<div style="color:#999;">${t("填写助剂和实际称重后显示分摊","Fill materials to see pro-rate")}</div>`;
}

// ---------- 保存 ----------
async function saveMergeMaterials() {
  if (!canEdit()) { alert(t("无权限","No permission")); return; }
  const batches = window.__mergeBatches || [];
  const totalM = window.__mergeTotalM || 0;
  if (!batches.length || !totalM) { alert(t("无批次","No batches")); return; }

  // 校验助剂行
  const rows = mergeCurrentRows.filter(r => r.aux_name && r.actual_kg > 0);
  if (!rows.length) { alert(t("至少填一行有效的助剂和实际称重","Fill at least 1 material row")); return; }

  const date = document.getElementById("merge_date").value || todayStr();
  const shift = document.getElementById("merge_shift").value || "A";
  const op = document.getElementById("merge_operator").value.trim();
  const msg = document.getElementById("mergeMainMsg");

  // 生成 merge_group 编号
  const today = new Date();
  const dateCompact = today.getFullYear() + String(today.getMonth()+1).padStart(2,"0") + String(today.getDate()).padStart(2,"0");
  // 查一下当天已有多少 merge_group
  const { data: existMerge } = await supabaseClient.from(TB.aux)
    .select("merge_group").like("merge_group", `MRG-${dateCompact}-%`);
  const existSet = new Set((existMerge || []).map(x => x.merge_group));
  let seq = 1;
  while (existSet.has(`MRG-${dateCompact}-${String(seq).padStart(3,"0")}`)) seq++;
  const mergeGroup = `MRG-${dateCompact}-${String(seq).padStart(3,"0")}`;

  msg.textContent = t(`保存中... 批次 ${batches.length} × 助剂 ${rows.length}`,
                      `Saving... ${batches.length} batches × ${rows.length} materials`);

  // 对每个批次 × 每种助剂，找到"该批次的对应工序"
  // 但工序名需要匹配：可能在批次里有多个同名工序，取第一个
  // 主逻辑：
  //  1. 先拉每个批次的所有工序（含 id、process_name）
  //  2. 再拉这些工序下的所有助剂（含 id、aux_name、stage、actual_kg）
  //  3. 对每条「合并助剂行」+ 每个批次：
  //     a) 找该批次的匹配工序（按 process_name）
  //     b) 在该工序+stage 下找同名 aux_name 的助剂行（优先 actual_kg=0）
  //     c) 找到 → update actual_kg
  //     d) 找不到 → 从 BOM 拿 standard_dose / dose_unit / tolerance_pct → insert 新记录
  //  4. 每条都写 merge_group / 算超标

  // 预拉数据
  const batchIds = batches.map(r => r.batch.id);
  let allProcs = [];
  try {
    allProcs = await fetchAllRows(TB.processes, "seq", true, q => q.in("batch_id", batchIds));
  } catch (e) { msg.textContent = t("加载工序失败: ","Load processes failed: ") + e.message; return; }

  const procIds = allProcs.map(p => p.id);
  let allAux = [];
  if (procIds.length) {
    try {
      allAux = await fetchAllRows(TB.aux, "created_at", true, q => q.in("process_id", procIds));
    } catch (e) { msg.textContent = t("加载助剂失败: ","Load aux failed: ") + e.message; return; }
  }

  // BOM 缓存：{ sioc: { items: [...] } }
  const bomCache = {};
  const siocs = [...new Set(batches.map(r => r.order.sioc).filter(Boolean))];
  for (const sioc of siocs) {
    const { data: bh } = await supabaseClient.from(TB.bomHeaders).select("id").eq("fg_code", sioc).maybeSingle();
    if (bh) {
      const items = await fetchAllRows(TB.bomItems, "seq", true, q => q.eq("bom_id", bh.id));
      bomCache[sioc] = items;
    } else {
      bomCache[sioc] = [];
    }
  }

  let ok = 0, failed = 0, inserted = 0, updated = 0;

  for (const r of batches) {
    const batch = r.batch;
    const order = r.order;
    const m = Number(batch.batch_billet_m) || 0;
    const share = m / totalM;

    for (const row of rows) {
      const splitKg = row.actual_kg * share;

      // 1. 找该批次的匹配工序
      const proc = allProcs.find(p => p.batch_id === batch.id && p.process_name === row.process_name);
      if (!proc) {
        // 该批次没有这个工序 → 跳过，写日志
        failed++;
        console.warn(`批次 ${batch.batch_no} 缺少工序 ${row.process_name}`);
        continue;
      }

      // 2. 在该工序 + stage 下找同名 aux_name（优先 actual_kg = 0）
      const candidates = allAux.filter(a =>
        a.process_id === proc.id &&
        (a.stage || "A") === (row.stage || "A") &&
        a.aux_name === row.aux_name
      );
      let targetAux = candidates.find(a => !Number(a.actual_kg)) || candidates[0];

      // 3. 计算理论用量 (按该批米数)
      const theoryKgVal = theoryKg(0, m); // 稍后从 standard_dose 重算

      if (targetAux) {
        // 已有 → 更新
        const std = Number(targetAux.standard_dose) || 0;
        const tol = Number(targetAux.tolerance_pct) || 10;
        const theory = theoryKg(std, m);
        let devPct = 0, isOOS = false;
        if (theory > 0) {
          devPct = ((splitKg - theory) / theory) * 100;
          isOOS = Math.abs(devPct) > tol;
        }
        const { error } = await supabaseClient.from(TB.aux).update({
          actual_value: splitKg,
          actual_unit: "kg",
          actual_kg: splitKg,
          actual_dose: convertToGPer100m(splitKg, "kg", m),
          theory_kg: theory,
          theory_dose: theory * 1000,
          deviation_pct: devPct,
          is_out_of_spec: isOOS,
          merge_group: mergeGroup,
          note: (targetAux.note ? targetAux.note + " | " : "") + `[合并投料 ${mergeGroup} 共 ${row.actual_kg}kg × ${(share*100).toFixed(2)}%]`,
        }).eq("id", targetAux.id);
        if (error) failed++;
        else updated++;
      } else {
        // 4. 找不到 → 从 BOM 拿标准值
        const bomItems = bomCache[order.sioc] || [];
        const bomItem = bomItems.find(x =>
          x.process_name === row.process_name &&
          (x.stage || "A") === (row.stage || "A") &&
          x.aux_name === row.aux_name
        );

        const std = bomItem ? Number(bomItem.standard_dose) || 0 : 0;
        const doseUnit = bomItem?.dose_unit || "g/100m";
        const tol = bomItem ? Number(bomItem.tolerance_pct) || 10 : 10;
        const auxCode = bomItem?.aux_code || "";
        const auxNameEn = bomItem?.aux_name_en || "";

        const theory = theoryKg(std, m);
        let devPct = 0, isOOS = false;
        if (theory > 0) {
          devPct = ((splitKg - theory) / theory) * 100;
          isOOS = Math.abs(devPct) > tol;
        }

        const { error } = await supabaseClient.from(TB.aux).insert({
          process_id: proc.id,
          stage: row.stage || "A",
          bom_item_id: bomItem?.id || null,
          aux_code: auxCode,
          aux_name: row.aux_name,
          aux_name_en: auxNameEn,
          standard_dose: std,
          dose_unit: doseUnit,
          tolerance_pct: tol,
          actual_value: splitKg,
          actual_unit: "kg",
          actual_kg: splitKg,
          actual_dose: convertToGPer100m(splitKg, "kg", m),
          theory_kg: theory,
          theory_dose: theory * 1000,
          deviation_pct: devPct,
          is_out_of_spec: isOOS,
          merge_group: mergeGroup,
          note: `[合并投料新建 ${mergeGroup} 共 ${row.actual_kg}kg × ${(share*100).toFixed(2)}%]`,
        });
        if (error) failed++;
        else inserted++;
      }
      ok++;
    }
  }

  await writeSysLog("merge_materials",
    t(`合并投料 ${mergeGroup}: ${batches.length} 批次 × ${rows.length} 助剂，更新 ${updated} 新建 ${inserted}，失败 ${failed}`,
      `Merge ${mergeGroup}: ${batches.length} batches × ${rows.length} materials, updated ${updated}, inserted ${inserted}, failed ${failed}`),
    mergeGroup);

  msg.textContent = t(`✅ 完成\n单号: ${mergeGroup}\n更新 ${updated} 条，新建 ${inserted} 条，失败 ${failed} 条`,
                      `✅ Done\nGroup: ${mergeGroup}\nUpdated ${updated}, Inserted ${inserted}, Failed ${failed}`);

  setTimeout(() => {
    closeMergeMain();
    // 刷新当前页面
    if (document.getElementById("mainPage").style.display !== "none") {
      refreshOrderProducedCache().then(renderOrders);
    }
  }, 2000);
}

// ---------- 打印合并投料单 ----------
function printMergeCard() {
  const batches = window.__mergeBatches || [];
  const totalM = window.__mergeTotalM || 0;
  const rows = mergeCurrentRows.filter(r => r.aux_name && r.actual_kg > 0);
  if (!batches.length || !rows.length) { alert(t("没有可打印的内容","Nothing to print")); return; }

  const date = document.getElementById("merge_date").value || "";
  const shift = document.getElementById("merge_shift").value || "";
  const op = document.getElementById("merge_operator").value || "";

  const batchesHtml = batches.map(r => {
    const m = Number(r.batch.batch_billet_m) || 0;
    return `<tr>
      <td>${r.order.contract||""}</td>
      <td>${r.batch.batch_no||""}</td>
      <td>${r.order.fabric_number||""}</td>
      <td style="text-align:right;">${m}</td>
      <td style="text-align:right;">${(m/totalM*100).toFixed(2)}%</td>
    </tr>`;
  }).join("");

  const matHtml = rows.map(r => `<tr>
    <td>${r.aux_name}</td>
    <td>${r.process_name}</td>
    <td>${r.stage||"A"}</td>
    <td style="text-align:right;">${r.actual_kg}</td>
  </tr>`).join("");

  // 分摊明细
  const splitHeader = `<tr><th>${t("合同号","Contract")}</th><th>${t("厂编号","Fabric No")}</th>${rows.map(r => `<th>${r.aux_name} (kg)</th>`).join("")}</tr>`;
  const splitRows = batches.map(b => {
    const m = Number(b.batch.batch_billet_m) || 0;
    const share = m / totalM;
    return `<tr>
      <td>${b.order.contract||""}</td>
      <td>${b.order.fabric_number||""}</td>
      ${rows.map(r => `<td style="text-align:right;">${(r.actual_kg * share).toFixed(2)}</td>`).join("")}
    </tr>`;
  }).join("");

  const win = window.open("", "_blank");
  win.document.write(`
    <html><head><title>${t("合并投料单","Merge Material Card")}</title>
    <style>
      @page { size: A4 landscape; margin: 10mm; }
      body { font-family: "Microsoft YaHei", Arial, sans-serif; font-size: 11px; }
      .brand { text-align:center; font-size: 16px; font-weight: bold; color:#1e3a8a; letter-spacing:2px; }
      h1 { text-align:center; font-size: 14px; margin: 4px 0 12px; }
      table { width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 10px; }
      th, td { border: 1px solid #999; padding: 4px 8px; text-align: left; }
      th { background: #f0f4ff; font-weight: bold; }
      .info-bar { display: flex; gap: 24px; font-size: 12px; margin-bottom: 10px; }
      .info-bar b { color: #1e3a8a; }
      .footer { margin-top: 16px; display: flex; justify-content: space-between; font-size: 11px; color: #666; }
      .sign { border-top: 1px solid #999; width: 220px; padding-top: 4px; }
      .sec-title { font-weight: bold; font-size: 12px; color: #1e3a8a; margin: 8px 0 4px; }
    </style></head>
    <body>
      <div class="brand">JP TEXTILE ETHIOPIA PLC</div>
      <h1>${t("合并投料单 / Merge Material Card","Merge Material Card")}</h1>

      <div class="info-bar">
        <span><b>${t("日期","Date")}:</b> ${date}</span>
        <span><b>${t("班次","Shift")}:</b> ${shift}</span>
        <span><b>${t("操作员","Operator")}:</b> ${op}</span>
        <span><b>${t("打印","Printed")}:</b> ${new Date().toLocaleString()}</span>
      </div>

      <div class="sec-title">${t("一起投料的批次","Batches in this run")}</div>
      <table>
        <thead>
          <tr>
            <th>${t("合同号","Contract")}</th>
            <th>${t("批次","Batch")}</th>
            <th>${t("厂编号","Fabric No")}</th>
            <th style="text-align:right;">${t("米数","Meters")}</th>
            <th style="text-align:right;">${t("占比","Share")}</th>
          </tr>
        </thead>
        <tbody>${batchesHtml}</tbody>
      </table>

      <div class="sec-title">${t("投料助剂","Materials")}</div>
      <table>
        <thead>
          <tr>
            <th>${t("助剂名","Auxiliary")}</th>
            <th>${t("工序","Process")}</th>
            <th>${t("阶段","Stage")}</th>
            <th style="text-align:right;">${t("实际称重(kg)","Actual (kg)")}</th>
          </tr>
        </thead>
        <tbody>${matHtml}</tbody>
      </table>

      <div class="sec-title">${t("分摊明细","Pro-rated Detail")}</div>
      <table>
        <thead>${splitHeader}</thead>
        <tbody>${splitRows}</tbody>
      </table>

      <div class="footer">
        <div class="sign">${t("工艺员签字","Technician")}</div>
        <div class="sign">${t("车间签字","Workshop")}</div>
        <div class="sign">${t("质检签字","QC")}</div>
      </div>
    </body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 300);
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
    await refreshOrderProducedCache();
    renderOrders();
    goToDashboard();
    return;
  }
  document.getElementById("loginPage").style.display = "flex";
  if (remembered) {
    document.getElementById("email").value = remembered;
    document.getElementById("rememberMe").checked = true;
  }
})();