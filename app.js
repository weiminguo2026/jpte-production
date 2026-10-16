// ============================================================
// 工艺记录系统 v20261016 — 后整理部门（含 13 项增强）
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
let PAGE_SIZE = 20;
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
let selectedOrderIds = new Set();

let allBoms = [];
let filteredBoms = [];
let currentBomPage = 1;
const BOM_PAGE_SIZE = 20;

let allBomItemsCache = [];
let allBomParamsCache = [];
let currentBomIdForEdit = null;
let editingBomItemId = null;
let editingBomParamId = null;
let editingBomHeaderId = null;

let allLogsCache = [];
let allOOSParam = [];
let allOOSAux = [];

// ============ 工具 ============
function t(zh, en) { return currentLang === "zh" ? zh : en; }
function esc(s) { return String(s || "").replace(/"/g, "&quot;"); }
function fmtTime(iso) { return iso ? String(iso).slice(0,16).replace("T"," ") : ""; }
function todayStr() { return new Date().toISOString().slice(0,10); }

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
  ["dashboardPage","mainPage","orderDetailPage","bomPage","reportPage","oosPage","logsPage","sysLogsPage"].forEach(id => {
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
  ["dashboardPage","mainPage","orderDetailPage","bomPage","reportPage","oosPage","logsPage","sysLogsPage"].forEach(id => {
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
  const hideDone = document.getElementById("hideDone")?.checked || false;

  filteredOrders = allOrders.filter(o => {
    if (hideDone && (o.status === "done" || o.status === "cancelled")) return false;
    if (status && o.status !== status) return false;
    if (keyword) {
      const kw =
        (o.contract || "").toLowerCase().includes(keyword) ||
        (o.order_no || "").toLowerCase().includes(keyword) ||
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
    return `
      <tr style="${o.status === 'done' || o.status === 'cancelled' ? 'opacity:0.65;' : ''}">
        <td style="text-align:center;">
          <input type="checkbox" ${checked} onchange="toggleSelectOrder('${o.id}', this.checked)" />
        </td>
        <td>${seq}</td>
        <td>${o.contract || o.order_no || ""}</td>
        <td>${o.customer || ""}</td>
        <td>${o.sioc || ""}</td>
        <td>${o.pattern_no || ""}</td>
        <td>${o.color_name || ""}</td>
        <td>${o.warp_count || ""}</td>
        <td>${o.weft_count || ""}</td>
        <td>${o.weave || ""}</td>
        <td>${o.cw || ""}</td>
        <td>${o.fabric_weight || ""}</td>
        <td>${o.order_qty_y || 0}</td>
        <td>${o.actual_billet_qty_m || 0}</td>
        <td style="${statusStyle}">${statusLabel(o.status)}</td>
        <td>${o.order_date || ""}</td>
        <td>${o.delivery_date || ""}</td>
        <td>
          <button class="in"   onclick="openOrderDetail('${o.id}')">详情</button>
          <button class="copy" onclick="openCopyOrderModal('${o.id}')" data-role="operator">复制</button>
          <button class="edit" onclick="openEditOrderModal('${o.id}')" data-role="operator">编辑</button>
          <button class="del"  onclick="deleteOrder('${o.id}')" data-role="admin">删除</button>
        </td>
      </tr>`;
  }).join("") || `<tr><td colspan="18" style="text-align:center;color:#999;">暂无数据</td></tr>`;

  document.getElementById("orderPageInfo").textContent =
    `第 ${currentPage} / ${totalPages} 页  ·  共 ${total} 条`;

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
  const pageItems = filteredOrders.slice(
    (currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE
  );
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
  const pageItems = filteredOrders.slice(
    (currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE
  );
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

// ============ 订单弹窗 ============
function openAddOrderModal() {
  if (!canEdit()) { alert("无权限"); return; }
  editingOrderId = null;
  document.getElementById("orderModalTitle").textContent = "新增订单";
  [
    "o_contract","o_batch_no","o_customer","o_sioc","o_pattern_no","o_color_name",
    "o_fabric_number","o_order_date","o_delivery_date","o_warp_count","o_weft_count",
    "o_warp_density","o_weft_density","o_weave","o_cw","o_fabric_weight",
    "o_fabric_content","o_finishing_methods","o_order_qty_y","o_producing_qty_m",
    "o_actual_billet_qty_m","o_note"
  ].forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
  document.getElementById("o_status").value = "pending";
  document.getElementById("o_order_date").value = todayStr();
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
    o_contract: "contract", o_batch_no: "batch_no", o_customer: "customer",
    o_sioc: "sioc", o_pattern_no: "pattern_no", o_color_name: "color_name",
    o_fabric_number: "fabric_number", o_order_date: "order_date",
    o_delivery_date: "delivery_date", o_warp_count: "warp_count",
    o_weft_count: "weft_count", o_warp_density: "warp_density",
    o_weft_density: "weft_density", o_weave: "weave", o_cw: "cw",
    o_fabric_weight: "fabric_weight", o_fabric_content: "fabric_content",
    o_finishing_methods: "finishing_methods", o_order_qty_y: "order_qty_y",
    o_producing_qty_m: "producing_qty_m", o_actual_billet_qty_m: "actual_billet_qty_m",
    o_note: "note",
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

  // ⭐ 操作日志细化：记录每个字段的变更
  let error;
  if (editingOrderId) {
    const old = allOrders.find(x => x.id === editingOrderId);
    const changes = computeOrderChanges(old, payload);
    if (changes.length === 0) {
      document.getElementById("orderMsg").textContent = "没有改动";
      return;
    }
    const { data: u } = await supabaseClient.auth.getUser();
    payload.last_modified_by = u?.user?.email || "";
    payload.last_modified_at = new Date().toISOString();
    ({ error } = await supabaseClient.from(TB.orders).update(payload).eq("id", editingOrderId));
    if (!error) {
      await writeSysLog("edit_order",
        `编辑订单 ${payload.contract}\n变更:\n${changes.join("\n")}`,
        payload.contract);
    }
  } else {
    const { data: u } = await supabaseClient.auth.getUser();
    payload.operator = u?.user?.email || "";
    payload.last_modified_by = u?.user?.email || "";
    payload.last_modified_at = new Date().toISOString();
    ({ error } = await supabaseClient.from(TB.orders).insert(payload).select().single());
    if (!error) await writeSysLog("add_order", `新增订单 ${payload.contract}`, payload.contract);
  }
  if (error) { document.getElementById("orderMsg").textContent = "保存失败: " + error.message; return; }
  closeOrderModal();
  await loadOrders();
  if (!editingOrderId) goToOrders();
}

function computeOrderChanges(oldO, newO) {
  if (!oldO) return [];
  const fields = [
    ["contract","Contract"],["batch_no","缸号"],["customer","客户"],
    ["sioc","成品号"],["pattern_no","花型号"],["color_name","颜色"],
    ["fabric_number","Fabric No"],["order_date","Order Date"],["delivery_date","Delivery"],
    ["warp_count","Warp Count"],["weft_count","Weft Count"],
    ["warp_density","Warp Density"],["weft_density","Weft Density"],
    ["weave","Weave"],["cw","C/W"],["fabric_weight","Weight"],
    ["fabric_content","Content"],["finishing_methods","Finishing"],
    ["order_qty_y","Order Qty(Y)"],["producing_qty_m","Producing(M)"],
    ["actual_billet_qty_m","Billet(M)"],["status","状态"],["note","备注"],
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
  if (!canDelete()) { alert("无权限"); return; }
  const o = allOrders.find(x => x.id === id);
  if (!o) return;
  if (!confirm(`确定删除订单 ${o.contract}？（工序/参数/助剂一起删除）`)) return;
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
    `源订单：<b>${o.contract || ""}</b> · ${o.customer || ""} · ${o.sioc || ""}`;
  document.getElementById("copy_contract").value = (o.contract || "") + "-C";
  document.getElementById("copy_batch_no").value = "";
  document.getElementById("copy_order_date").value = todayStr();
  document.getElementById("copy_delivery_date").value = o.delivery_date || "";
  document.getElementById("copy_processes").checked = true;
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
  if (!src) { alert("源订单不存在"); return; }
  const newContract = document.getElementById("copy_contract").value.trim();
  const newBatch = document.getElementById("copy_batch_no").value.trim();
  const newOrderDate = document.getElementById("copy_order_date").value || null;
  const newDelivery = document.getElementById("copy_delivery_date").value || null;
  if (!newContract) { document.getElementById("copyOrderMsg").textContent = "新 Contract 必填"; return; }
  const copyActuals = document.getElementById("copy_actuals").checked;
  const copyProcesses = document.getElementById("copy_processes").checked;
  document.getElementById("copyOrderMsg").textContent = "复制中...";

  const newOrderId = await copyOrderInternal(src, newContract, newBatch, newOrderDate, newDelivery, copyProcesses, copyActuals);
  if (!newOrderId) { document.getElementById("copyOrderMsg").textContent = "复制失败"; return; }
  document.getElementById("copyOrderMsg").textContent = "✅ 复制完成";
  setTimeout(async () => {
    closeCopyOrderModal();
    await loadOrders();
    openOrderDetail(newOrderId);
  }, 800);
}

// ⭐ 复制核心（外部和批量都用它）
async function copyOrderInternal(src, newContract, newBatch, newOrderDate, newDelivery, copyProcesses, copyActuals) {
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
  newOrder.last_modified_by = u?.user?.email || "";
  newOrder.last_modified_at = new Date().toISOString();

  const { data: insOrder, error: e1 } = await supabaseClient.from(TB.orders).insert(newOrder).select().single();
  if (e1) { console.warn(e1); return null; }
  const newOrderId = insOrder.id;

  if (copyProcesses) {
    const srcProcs = await fetchAllRows(TB.processes, "seq", true, q => q.eq("order_id", src.id));
    if (srcProcs.length) {
      const srcProcIds = srcProcs.map(p => p.id);
      const srcParams = await fetchAllRows(TB.params, "seq", true, q => q.in("process_id", srcProcIds));
      const srcAux = await fetchAllRows(TB.aux, "created_at", true, q => q.in("process_id", srcProcIds));

      for (const sp of srcProcs) {
        const newProc = {
          order_id: newOrderId, seq: sp.seq,
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
            standard_value: x.standard_value || "",
            actual_value: copyActuals ? (x.actual_value || "") : "",
            is_out_of_spec: false, seq: x.seq || 1, note: x.note || "",
          })));
        }
        const pAux = srcAux.filter(x => x.process_id === sp.id);
        if (pAux.length) {
          await supabaseClient.from(TB.aux).insert(pAux.map(x => ({
            process_id: insProc.id, stage: x.stage || "A",
            bom_item_id: x.bom_item_id, aux_code: x.aux_code || "",
            aux_name: x.aux_name, standard_dose: x.standard_dose || 0,
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
  await writeSysLog("copy_order", `复制订单：${src.contract} → ${newContract}`, newContract);
  return newOrderId;
}

// ============ 批量复制 ============
function openBatchCopyModal() {
  if (!canEdit()) { alert("无权限"); return; }
  if (selectedOrderIds.size === 0) { alert("请先勾选至少 1 条订单"); return; }
  document.getElementById("batchCopyInfo").innerHTML =
    `已选：<b>${selectedOrderIds.size}</b> 条订单`;
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
  if (!srcOrders.length) { msg.textContent = "没有选中订单"; return; }

  msg.textContent = "开始复制...";
  let done = 0, failed = 0;
  for (const src of srcOrders) {
    for (let i = 0; i < count; i++) {
      const n = start + i;
      const newContract = prefix + String(n).padStart(3, "0");
      const newId = await copyOrderInternal(src, newContract, "", todayStr(), src.delivery_date || null, copyProcesses, false);
      if (newId) done++; else failed++;
      msg.textContent = `复制中... ${done + failed} / ${srcOrders.length * count}`;
    }
  }
  msg.textContent = `✅ 完成\n成功 ${done} 条\n失败 ${failed} 条`;
  await loadOrders();
  setTimeout(() => closeBatchCopyModal(), 1500);
}

// ============ 批量生成工序 ============
async function openBatchGenModal() {
  if (!canEdit()) { alert("无权限"); return; }
  // 找未生成工序的订单
  const ordersWithProc = new Set();
  try {
    const allProcs = await fetchAllRows(TB.processes, "created_at", false);
    allProcs.forEach(p => ordersWithProc.add(p.order_id));
  } catch (e) {}
  const emptyOrders = allOrders.filter(o => !ordersWithProc.has(o.id));
  document.getElementById("batchGenInfo").innerHTML =
    `未生成工序的订单：<b>${emptyOrders.length}</b> 条<br>
     （工序已生成过的订单会跳过）`;
  document.getElementById("batchGenMsg").textContent = "";
  document.getElementById("batchGenModal").style.display = "flex";
  window.__emptyOrders = emptyOrders;
}
function closeBatchGenModal() { document.getElementById("batchGenModal").style.display = "none"; }

async function doBatchGen() {
  const emptyOrders = window.__emptyOrders || [];
  const msg = document.getElementById("batchGenMsg");
  if (!emptyOrders.length) { msg.textContent = "没有需要生成的订单"; return; }

  const { data: tpls } = await supabaseClient
    .from(TB.templates).select("*").eq("dept", "后整理").eq("is_active", true)
    .order("seq", { ascending: true });
  if (!tpls || !tpls.length) { msg.textContent = "没有工序模板"; return; }

  msg.textContent = "开始...";
  let ok = 0, failed = 0;
  for (const order of emptyOrders) {
    try {
      const rows = tpls.map(t => ({
        order_id: order.id, seq: t.seq,
        process_name: t.process_name, machine: t.default_machine || "",
        standard_note: t.default_note || "", status: "pending",
        note: t.is_optional ? "[可选工序]" : "",
      }));
      const { data: inserted, error } = await supabaseClient.from(TB.processes).insert(rows).select();
      if (error) { failed++; continue; }

      // 带 BOM
      if (order.sioc) {
        const { data: bh } = await supabaseClient.from(TB.bomHeaders).select("id").eq("fg_code", order.sioc).maybeSingle();
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
      ok++;
      msg.textContent = `生成中... ${ok + failed} / ${emptyOrders.length}`;
    } catch (e) { failed++; }
  }
  await writeSysLog("batch_gen_processes", `批量生成工序：成功 ${ok}, 失败 ${failed}`, null);
  msg.textContent = `✅ 完成\n成功 ${ok} 条\n失败 ${failed} 条`;
  setTimeout(() => { closeBatchGenModal(); loadOrders(); }, 1500);
}

function batchGenSelected() {
  if (selectedOrderIds.size === 0) { alert("请先勾选订单"); return; }
  openBatchGenModal();
}

// ============ 批量删除选中 ============
async function batchDeleteSelected() {
  if (!canDelete()) { alert("无权限"); return; }
  if (selectedOrderIds.size === 0) { alert("请先勾选订单"); return; }
  if (!confirm(`确定删除选中的 ${selectedOrderIds.size} 条订单？（工序/参数/助剂一起删除）`)) return;
  const ids = [...selectedOrderIds];
  for (const id of ids) {
    await supabaseClient.from(TB.orders).delete().eq("id", id);
  }
  await writeSysLog("batch_delete_orders", `批量删除 ${ids.length} 条订单`, null);
  selectedOrderIds.clear();
  await loadOrders();
}

// ============ 订单详情（四层结构 + 打印 + 导出） ============
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
        const params = (paramsByProcStage[proc.id + "||" + st] || []).filter(p => p.param_name !== "(占位)");
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

      const doneBtn = proc.status === "done"
        ? `<button style="background:#16a34a;color:#fff;" disabled>✓ 已完成</button>`
        : `<button onclick="completeProcess('${proc.id}')" data-role="operator" style="background:#16a34a;">✓ 完成</button>`;

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
              ${doneBtn}
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

// ============ 工序完成（自动写 end_time） ============
async function completeProcess(processId) {
  if (!canEdit()) { alert("无权限"); return; }
  const { data: u } = await supabaseClient.auth.getUser();
  const now = new Date().toISOString();
  const { error } = await supabaseClient.from(TB.processes).update({
    status: "done",
    end_time: now,
    completed_by: u?.user?.email || "",
    completed_at: now,
  }).eq("id", processId);
  if (error) { alert("操作失败: " + error.message); return; }
  await writeSysLog("complete_process", `完成工序 ${processId}`, null);

  // 检查该订单是否全部完成
  const { data: procs } = await supabaseClient.from(TB.processes)
    .select("status").eq("order_id", currentOrderId);
  if (procs && procs.every(p => p.status === "done" || p.status === "skipped")) {
    await supabaseClient.from(TB.orders).update({ status: "done" }).eq("id", currentOrderId);
    alert("所有工序已完成，订单状态已改为「已完成」");
  }
  openOrderDetail(currentOrderId);
}

// ============ 打印工艺单 ============
async function printOrderCard(orderId) {
  const order = allOrders.find(o => o.id === orderId);
  if (!order) { alert("订单不存在"); return; }
  const processes = await fetchAllRows(TB.processes, "seq", true, q => q.eq("order_id", orderId));
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
  const billetM = Number(order.actual_billet_qty_m) || 0;

  const procsHtml = processes.map(proc => {
    const stages = [...new Set([
      ...params.filter(x=>x.process_id===proc.id && x.param_name!=="(占位)").map(x=>x.stage||"A"),
      ...aux.filter(x=>x.process_id===proc.id).map(x=>x.stage||"A")
    ])].sort();
    if (!stages.length) stages.push("A");

    const stagesHtml = stages.map(st => {
      const ps = (pBy[proc.id + "||" + st] || []).filter(x => x.param_name !== "(占位)");
      const as = aBy[proc.id + "||" + st] || [];
      const pTable = ps.length ? `
        <table class="sub-table">
          <thead><tr><th>参数</th><th>单位</th><th>标准值</th><th>实际值</th><th>状态</th></tr></thead>
          <tbody>${ps.map(p=>`<tr><td>${p.param_name}</td><td>${p.param_unit||""}</td><td>${p.standard_value||""}</td><td>${p.actual_value||""}</td><td>${p.is_out_of_spec?"⚠️":""}</td></tr>`).join("")}</tbody>
        </table>` : `<p class="empty">无参数</p>`;
      const aTable = as.length ? `
        <table class="sub-table">
          <thead><tr><th>助剂</th><th>编号</th><th>标准 g/100m</th><th>理论(kg)</th><th>实际(kg)</th><th>偏差%</th><th>状态</th></tr></thead>
          <tbody>${as.map(a=>{
            const th = theoryKg(a.standard_dose, billetM).toFixed(3);
            return `<tr><td>${a.aux_name}</td><td>${a.aux_code||""}</td><td>${Number(a.standard_dose||0).toFixed(3)}</td><td>${th}</td><td>${Number(a.actual_kg||0).toFixed(3)}</td><td>${Number(a.deviation_pct||0).toFixed(2)}</td><td>${a.is_out_of_spec?"⚠️":""}</td></tr>`;
          }).join("")}</tbody>
        </table>` : `<p class="empty">无助剂</p>`;
      return `<div class="stage"><div class="stage-title">阶段 ${st}</div>${pTable}${aTable}</div>`;
    }).join("");

    return `
      <div class="proc">
        <div class="proc-title">${proc.seq}. ${proc.process_name}
          <span class="proc-meta">${proc.machine||""} ${proc.operator||""} ${statusLabel(proc.status)}</span>
        </div>
        ${stagesHtml}
      </div>`;
  }).join("");

  const win = window.open("", "_blank");
  win.document.write(`
    <html><head><title>工艺单 ${order.contract||""}</title>
    <style>
      @page { size: A4; margin: 12mm; }
      body { font-family: "Microsoft YaHei", Arial, sans-serif; font-size: 11px; color: #111; }
      .card-header { text-align: center; border-bottom: 2px solid #1e3a8a; padding-bottom: 8px; margin-bottom: 10px; }
      .card-header h1 { font-size: 18px; margin: 0 0 4px; color: #1e3a8a; letter-spacing: 2px; }
      .card-header h2 { font-size: 14px; margin: 0; font-weight: normal; }
      .card-info { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-bottom: 10px; font-size: 10px; }
      .card-info .item { border: 1px solid #ddd; padding: 4px 6px; }
      .card-info .item b { color: #666; font-weight: normal; }
      .proc { border: 1px solid #ccc; padding: 6px 8px; margin-bottom: 8px; page-break-inside: avoid; }
      .proc-title { font-weight: bold; font-size: 12px; color: #1e3a8a; margin-bottom: 4px; }
      .proc-meta { font-weight: normal; font-size: 10px; color: #666; margin-left: 8px; }
      .stage { margin: 4px 0 6px 8px; padding-left: 8px; border-left: 2px solid #3b82f6; }
      .stage-title { font-weight: bold; font-size: 11px; color: #1e40af; margin-bottom: 3px; }
      .sub-table { width: 100%; border-collapse: collapse; font-size: 10px; margin-bottom: 4px; }
      .sub-table th, .sub-table td { border: 1px solid #ccc; padding: 2px 5px; text-align: left; }
      .sub-table th { background: #f0f4ff; font-weight: normal; }
      .empty { font-size: 10px; color: #999; margin: 2px 0 4px; }
      .footer { margin-top: 16px; display: flex; justify-content: space-between; font-size: 10px; color: #666; }
      .sign { border-top: 1px solid #999; width: 180px; padding-top: 4px; }
    </style></head>
    <body>
      <div class="card-header">
        <h1>JP TEXTILE ETHIOPIA PLC</h1>
        <h2>工艺单 / Process Card</h2>
      </div>
      <div class="card-info">
        <div class="item"><b>Contract:</b> ${order.contract||""}</div>
        <div class="item"><b>客户:</b> ${order.customer||""}</div>
        <div class="item"><b>成品号:</b> ${order.sioc||""}</div>
        <div class="item"><b>花型号:</b> ${order.pattern_no||""}</div>
        <div class="item"><b>颜色:</b> ${order.color_name||""}</div>
        <div class="item"><b>Warp:</b> ${order.warp_count||""}</div>
        <div class="item"><b>Weft:</b> ${order.weft_count||""}</div>
        <div class="item"><b>Weave:</b> ${order.weave||""}</div>
        <div class="item"><b>C/W:</b> ${order.cw||""}</div>
        <div class="item"><b>Weight:</b> ${order.fabric_weight||""}</div>
        <div class="item"><b>Order Qty(Y):</b> ${order.order_qty_y||0}</div>
        <div class="item"><b>Billet(M):</b> ${order.actual_billet_qty_m||0}</div>
        <div class="item"><b>Order Date:</b> ${order.order_date||""}</div>
        <div class="item"><b>Delivery:</b> ${order.delivery_date||""}</div>
        <div class="item"><b>状态:</b> ${statusLabel(order.status)}</div>
        <div class="item"><b>打印:</b> ${new Date().toLocaleString()}</div>
      </div>
      ${procsHtml}
      <div class="footer">
        <div class="sign">工艺员签字</div>
        <div class="sign">车间签字</div>
        <div class="sign">质检签字</div>
      </div>
    </body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 300);
}

// ============ 导出订单 CSV ============
async function exportOrderCSV(orderId) {
  const order = allOrders.find(o => o.id === orderId);
  if (!order) return;
  const processes = await fetchAllRows(TB.processes, "seq", true, q => q.eq("order_id", orderId));
  processes.sort((a,b) => (a.seq||0) - (b.seq||0));
  const procIds = processes.map(p => p.id);
  let params = [], aux = [];
  if (procIds.length) {
    params = await fetchAllRows(TB.params, "seq", true, q => q.in("process_id", procIds));
    aux = await fetchAllRows(TB.aux, "created_at", true, q => q.in("process_id", procIds));
  }

  const rows = [];
  rows.push(["=== 订单头 ===", "", "", "", "", "", ""]);
  rows.push(["Contract","客户","成品号","花型号","颜色","Order Qty(Y)","Billet(M)"]);
  rows.push([order.contract, order.customer, order.sioc, order.pattern_no, order.color_name, order.order_qty_y, order.actual_billet_qty_m]);
  rows.push([]);
  rows.push(["=== 工序 / 参数 / 助剂 ===", "", "", "", "", "", ""]);
  rows.push(["工序","阶段","类型","名称/编号","标准值","实际值","状态"]);
  processes.forEach(proc => {
    const stages = [...new Set([
      ...params.filter(x=>x.process_id===proc.id && x.param_name!=="(占位)").map(x=>x.stage||"A"),
      ...aux.filter(x=>x.process_id===proc.id).map(x=>x.stage||"A")
    ])].sort();
    if (!stages.length) stages.push("A");
    stages.forEach(st => {
      params.filter(x=>x.process_id===proc.id && (x.stage||"A")===st && x.param_name!=="(占位)").forEach(p => {
        rows.push([proc.process_name, st, "参数", `${p.param_name}(${p.param_unit||""})`, p.standard_value||"", p.actual_value||"", p.is_out_of_spec?"超标":"正常"]);
      });
      aux.filter(x=>x.process_id===proc.id && (x.stage||"A")===st).forEach(a => {
        rows.push([proc.process_name, st, "助剂", `${a.aux_name}(${a.aux_code||""})`, a.standard_dose||0, a.actual_kg||0, a.is_out_of_spec?"超标":"正常"]);
      });
    });
  });
  downloadCSV(rows, `order_${order.contract}_${todayStr()}.csv`);
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
    const { data: existing } = await supabaseClient.from(TB.processes)
      .select("id, seq").eq("order_id", currentOrderId)
      .gte("seq", seq).order("seq", { ascending: false });
    if (existing && existing.length) {
      for (const p of existing) {
        await supabaseClient.from(TB.processes).update({ seq: p.seq + 1 }).eq("id", p.id);
      }
    }
  }

  const payload = {
    order_id: currentOrderId, seq,
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
  if (error) { document.getElementById("processMsg").textContent = "保存失败: " + error.message; return; }
  await writeSysLog(editingProcessId ? "edit_process" : "add_process",
    `${editingProcessId?"编辑":"新增"}工序 ${name}`, null);
  closeProcessModal();
  openOrderDetail(currentOrderId);
}

async function deleteProcess(processId) {
  if (!canDelete()) { alert("无权限"); return; }
  if (!confirm("确定删除该工序？（参数、助剂一起删除）")) return;
  await supabaseClient.from(TB.processes).delete().eq("id", processId);
  await writeSysLog("delete_process", `删除工序 ${processId}`, null);
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

// ============ 阶段 ============
async function addStage(processId) {
  if (!canEdit()) { alert("无权限"); return; }
  const stageName = prompt("新阶段名称:", "");
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
    process_id: currentParamProcessId, stage: currentParamStage,
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
  await writeSysLog(editingParamId ? "edit_param" : "add_param",
    `${editingParamId?"编辑":"新增"}工艺参数 ${name} (阶段 ${currentParamStage})`, null);
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
    process_id: currentAuxProcessId, stage: currentAuxStage,
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
    const c = row.querySelector(".converted"); if (c) c.textContent = actualG.toFixed(2);
    const d = row.querySelector(".dev"); if (d) d.textContent = devPct.toFixed(2) + "%";
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
      <td>${b.is_active ? "启用" : "停用"}</td>
      <td>
        <button class="in" onclick="openBomDetail('${b.id}')">查看</button>
        <button class="edit" onclick="openEditBomHeaderModal('${b.id}')" data-role="admin">编辑</button>
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
  currentBomIdForEdit = bomId;
  const bom = allBoms.find(b => b.id === bomId);
  if (!bom) return;
  document.getElementById("bomDetailTitle").textContent = `BOM: ${bom.fg_code} ${bom.fg_name||""}`;

  const items = await fetchAllRows(TB.bomItems, "seq", true, q => q.eq("bom_id", bomId));
  const params = await fetchAllRows(TB.bomParams, "seq", true, q => q.eq("bom_id", bomId));
  allBomItemsCache = items;
  allBomParamsCache = params;

  const auxHtml = `
    <div style="font-weight:bold;margin:10px 0 6px;">助剂明细（${items.length}）</div>
    <table class="data-table" style="font-size:13px;">
      <thead><tr><th>#</th><th>工序</th><th>阶段</th><th>助剂编号</th><th>助剂名</th><th>标准 g/100m</th><th>单位</th><th>容差</th><th>操作</th></tr></thead>
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
          <td>${it.tolerance_pct || 10}%</td>
          <td>
            <button class="edit" onclick="openEditBomItemModal('${it.id}')" data-role="admin">编辑</button>
            <button class="del" onclick="deleteBomItem('${it.id}')" data-role="admin">删除</button>
          </td>
        </tr>
      `).join("") : `<tr><td colspan="9" style="text-align:center;color:#999;">暂无助剂</td></tr>`}
      </tbody>
    </table>`;

  const paramHtml = `
    <div style="font-weight:bold;margin:16px 0 6px;">参数明细（${params.length}）</div>
    <table class="data-table" style="font-size:13px;">
      <thead><tr><th>#</th><th>工序</th><th>阶段</th><th>参数名</th><th>单位</th><th>标准值</th><th>操作</th></tr></thead>
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
            <button class="edit" onclick="openEditBomParamModal('${p.id}')" data-role="admin">编辑</button>
            <button class="del" onclick="deleteBomParam('${p.id}')" data-role="admin">删除</button>
          </td>
        </tr>
      `).join("") : `<tr><td colspan="7" style="text-align:center;color:#999;">暂无参数</td></tr>`}
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
  if (!canDelete()) { alert("无权限"); return; }
  if (!confirm("确定删除该 BOM？（明细一起删除）")) return;
  await supabaseClient.from(TB.bomHeaders).delete().eq("id", bomId);
  await writeSysLog("delete_bom", `删除 BOM ${bomId}`, null);
  await loadBoms();
}

// BOM 头编辑
function openAddBomHeaderModal() {
  editingBomHeaderId = null;
  document.getElementById("bomHeaderModalTitle").textContent = "新增 BOM";
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
  document.getElementById("bomHeaderModalTitle").textContent = "编辑 BOM";
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
  if (!payload.fg_code) { document.getElementById("bomHeaderMsg").textContent = "成品号必填"; return; }
  let error;
  if (editingBomHeaderId) {
    ({ error } = await supabaseClient.from(TB.bomHeaders).update(payload).eq("id", editingBomHeaderId));
  } else {
    ({ error } = await supabaseClient.from(TB.bomHeaders).insert(payload));
  }
  if (error) { document.getElementById("bomHeaderMsg").textContent = "保存失败: " + error.message; return; }
  closeBomHeaderModal();
  await loadBoms();
}

// BOM 助剂编辑
function openAddBomItemModal() {
  if (!currentBomIdForEdit) return;
  editingBomItemId = null;
  document.getElementById("bomItemModalTitle").textContent = "新增 BOM 助剂";
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
  document.getElementById("bomItemModalTitle").textContent = "编辑 BOM 助剂";
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
  if (!payload.aux_name) { document.getElementById("bomItemMsg").textContent = "助剂名必填"; return; }
  let error;
  if (editingBomItemId) {
    ({ error } = await supabaseClient.from(TB.bomItems).update(payload).eq("id", editingBomItemId));
  } else {
    ({ error } = await supabaseClient.from(TB.bomItems).insert(payload));
  }
  if (error) { document.getElementById("bomItemMsg").textContent = "保存失败: " + error.message; return; }
  closeBomItemModal();
  await openBomDetail(currentBomIdForEdit);
}
async function deleteBomItem(itemId) {
  if (!canDelete()) { alert("无权限"); return; }
  if (!confirm("确定删除该助剂？")) return;
  await supabaseClient.from(TB.bomItems).delete().eq("id", itemId);
  await openBomDetail(currentBomIdForEdit);
}

// BOM 参数编辑
function openAddBomParamModal() {
  if (!currentBomIdForEdit) return;
  editingBomParamId = null;
  document.getElementById("bomParamModalTitle").textContent = "新增 BOM 参数";
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
  document.getElementById("bomParamModalTitle").textContent = "编辑 BOM 参数";
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
  if (!payload.param_name) { document.getElementById("bomParamMsg").textContent = "参数名必填"; return; }
  let error;
  if (editingBomParamId) {
    ({ error } = await supabaseClient.from(TB.bomParams).update(payload).eq("id", editingBomParamId));
  } else {
    ({ error } = await supabaseClient.from(TB.bomParams).insert(payload));
  }
  if (error) { document.getElementById("bomParamMsg").textContent = "保存失败: " + error.message; return; }
  closeBomParamModal();
  await openBomDetail(currentBomIdForEdit);
}
async function deleteBomParam(paramId) {
  if (!canDelete()) { alert("无权限"); return; }
  if (!confirm("确定删除该参数？")) return;
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
  const headers = ["sioc","process_name","stage","aux_code","aux_name","standard_dose","dose_unit","tolerance_pct"];
  const sample = [["FG-CV-00055","退浆","A","RM-AD-00002","209退浆用洗涤剂","192.036","g/100m","10"]];
  downloadCSV([headers, ...sample], "bom_items_template.csv");
}
function downloadBomParamsTemplate() {
  const headers = ["sioc","process_name","stage","param_name","param_unit","standard_value"];
  const sample = [["FG-CV-00055","退浆","A","温度","℃","98"]];
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
  if (!itemsFile && !paramsFile) { msg.textContent = "至少选一个 CSV"; return; }

  let itemsRows = [], paramsRows = [];
  if (itemsFile) itemsRows = parseCSV(await itemsFile.text());
  if (paramsFile) paramsRows = parseCSV(await paramsFile.text());

  const siocs = new Set();
  itemsRows.forEach(r => r.sioc && siocs.add(r.sioc));
  paramsRows.forEach(r => r.sioc && siocs.add(r.sioc));
  if (!siocs.size) { msg.textContent = "没有有效数据"; return; }

  msg.textContent = `导入 ${siocs.size} 个 BOM...`;
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
  msg.textContent = `✅ 完成\n新增 BOM: ${ok}\n失败: ${failed}`;
  await writeSysLog("bom_import", `BOM 导入: 新增 ${ok}, 失败 ${failed}`, null);
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
  // 参数超标
  const params = await fetchAllRows(TB.params, "created_at", false, q => q.eq("is_out_of_spec", true));
  const auxes = await fetchAllRows(TB.aux, "created_at", false, q => q.eq("is_out_of_spec", true));

  // 拉工序和订单信息
  const procIds = [...new Set([
    ...params.map(x => x.process_id),
    ...auxes.map(x => x.process_id),
  ])];
  let procs = [];
  if (procIds.length) {
    const { data } = await supabaseClient.from(TB.processes).select("*").in("id", procIds);
    procs = data || [];
  }
  const orderIds = [...new Set(procs.map(p => p.order_id))];
  let orders = [];
  if (orderIds.length) {
    const { data } = await supabaseClient.from(TB.orders).select("*").in("id", orderIds);
    orders = data || [];
  }
  const procMap = {}, orderMap = {};
  procs.forEach(p => procMap[p.id] = p);
  orders.forEach(o => orderMap[o.id] = o);

  // 渲染参数
  document.getElementById("oosParamCount").textContent = params.length;
  document.getElementById("oosParamBody").innerHTML = params.map((p, i) => {
    const proc = procMap[p.process_id] || {};
    const order = orderMap[proc.order_id] || {};
    return `
      <tr>
        <td>${i+1}</td>
        <td>${order.contract || ""}</td>
        <td>${order.customer || ""}</td>
        <td>${order.sioc || ""}</td>
        <td>${proc.process_name || ""}</td>
        <td>${p.stage || "A"}</td>
        <td>${p.param_name}</td>
        <td>${p.standard_value || ""}</td>
        <td style="color:#dc2626;font-weight:bold;">${p.actual_value || ""}</td>
        <td><button class="in" onclick="openOrderDetail('${proc.order_id}')">查看订单</button></td>
      </tr>`;
  }).join("") || `<tr><td colspan="10" style="text-align:center;color:#999;">无参数超标</td></tr>`;

  // 渲染助剂
  document.getElementById("oosAuxCount").textContent = auxes.length;
  document.getElementById("oosAuxBody").innerHTML = auxes.map((a, i) => {
    const proc = procMap[a.process_id] || {};
    const order = orderMap[proc.order_id] || {};
    return `
      <tr>
        <td>${i+1}</td>
        <td>${order.contract || ""}</td>
        <td>${order.customer || ""}</td>
        <td>${order.sioc || ""}</td>
        <td>${proc.process_name || ""}</td>
        <td>${a.stage || "A"}</td>
        <td>${a.aux_name}</td>
        <td>${Number(a.theory_kg||0).toFixed(3)}</td>
        <td style="color:#dc2626;font-weight:bold;">${Number(a.actual_kg||0).toFixed(3)}</td>
        <td>${Number(a.deviation_pct||0).toFixed(2)}%</td>
        <td><button class="in" onclick="openOrderDetail('${proc.order_id}')">查看订单</button></td>
      </tr>`;
  }).join("") || `<tr><td colspan="11" style="text-align:center;color:#999;">无助剂超标</td></tr>`;

  allOOSParam = params;
  allOOSAux = auxes;
}

function exportOOSCSV() {
  const rows = [["=== 参数超标 ==="]];
  rows.push(["Contract","客户","成品号","工序","阶段","参数名","标准值","实际值"]);
  allOOSParam.forEach(p => {
    rows.push([p.contract||"", p.customer||"", p.sioc||"", p.process_name||"", p.stage||"A", p.param_name, p.standard_value||"", p.actual_value||""]);
  });
  rows.push([]);
  rows.push(["=== 助剂超标 ==="]);
  rows.push(["Contract","客户","成品号","工序","阶段","助剂名","理论(kg)","实际(kg)","偏差%"]);
  allOOSAux.forEach(a => {
    rows.push([a.contract||"", a.customer||"", a.sioc||"", a.process_name||"", a.stage||"A", a.aux_name, a.theory_kg||0, a.actual_kg||0, a.deviation_pct||0]);
  });
  downloadCSV(rows, `oos_${todayStr()}.csv`);
}

// ============ 报表增强 ============
let currentRepTab = "order";
function switchRepTab(tab) {
  currentRepTab = tab;
  document.getElementById("repTabOrder").style.display = tab === "order" ? "" : "none";
  document.getElementById("repTabProc").style.display  = tab === "proc"  ? "" : "none";
  document.getElementById("repTabAux").style.display   = tab === "aux"   ? "" : "none";
  document.getElementById("repTabCust").style.display  = tab === "cust"  ? "" : "none";
  ["tabRepOrder","tabRepProc","tabRepAux","tabRepCust"].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.style.background = ""; el.style.color = ""; }
  });
  const cur = document.getElementById("tabRep" + tab.charAt(0).toUpperCase() + tab.slice(1));
  if (cur) { cur.style.background = "#2563eb"; cur.style.color = "#fff"; }
  loadReport();
}

async function showReport() {
  hideAll();
  document.getElementById("reportPage").style.display = "block";
  document.getElementById("userEmailReport").textContent = document.getElementById("userEmail2").textContent;
  const now = new Date();
  document.getElementById("reportMonth").value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
  switchRepTab("order");
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

  if (currentRepTab === "order") renderRepOrder(orders, processes, params, aux);
  else if (currentRepTab === "proc") renderRepProc(orders, processes, params);
  else if (currentRepTab === "aux") renderRepAux(aux);
  else if (currentRepTab === "cust") renderRepCust(orders, processes, params, aux);
}

function renderRepOrder(orders, processes, params, aux) {
  const procByOrder = {}, paramByProc = {}, auxByProc = {};
  processes.forEach(p => { (procByOrder[p.order_id] = procByOrder[p.order_id] || []).push(p); });
  params.forEach(pa => { (paramByProc[pa.process_id] = paramByProc[pa.process_id] || []).push(pa); });
  aux.forEach(a => { (auxByProc[a.process_id] = auxByProc[a.process_id] || []).push(a); });

  document.getElementById("reportBody").innerHTML = orders.map(o => {
    const procs = procByOrder[o.id] || [];
    const ps = procs.flatMap(p => paramByProc[p.id] || []);
    const as = procs.flatMap(p => auxByProc[p.id] || []);
    const oos = ps.filter(x => x.is_out_of_spec).length + as.filter(x => x.is_out_of_spec).length;
    return `<tr>
      <td>${o.contract}</td><td>${o.customer||""}</td><td>${o.sioc||""}</td><td>${o.color_name||""}</td>
      <td>${statusLabel(o.status)}</td><td>${procs.length}</td><td>${ps.length}</td><td>${as.length}</td>
      <td style="color:${oos>0?'#dc2626':'#333'};font-weight:${oos>0?'bold':'normal'};">${oos}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="9" style="text-align:center;color:#999;">本月无数据</td></tr>`;
}

function renderRepProc(orders, processes, params) {
  // 按工序名统计
  const stats = {};
  processes.forEach(p => {
    const k = p.process_name;
    if (!stats[k]) stats[k] = { orders: new Set(), paramCount: 0, oosCount: 0 };
    stats[k].orders.add(p.order_id);
  });
  const procMap = {};
  processes.forEach(p => procMap[p.id] = p);
  params.forEach(pa => {
    const proc = procMap[pa.process_id];
    if (!proc) return;
    const k = proc.process_name;
    stats[k].paramCount++;
    if (pa.is_out_of_spec) stats[k].oosCount++;
  });
  const rows = Object.entries(stats).sort((a,b) => a[0].localeCompare(b[0]));
  document.getElementById("repProcBody").innerHTML = rows.map(([name, s]) => {
    const rate = s.paramCount ? ((s.oosCount / s.paramCount) * 100).toFixed(2) : "0.00";
    return `<tr>
      <td>${name}</td>
      <td>${s.orders.size}</td>
      <td>${s.paramCount}</td>
      <td style="color:${s.oosCount>0?'#dc2626':'#333'};">${s.oosCount}</td>
      <td>${rate}%</td>
    </tr>`;
  }).join("") || `<tr><td colspan="5" style="text-align:center;color:#999;">本月无数据</td></tr>`;
}

function renderRepAux(aux) {
  const stats = {};
  aux.forEach(a => {
    const k = (a.aux_code || "") + "||" + a.aux_name;
    if (!stats[k]) stats[k] = { code: a.aux_code || "", name: a.aux_name, count: 0, stdSum: 0, theorySum: 0, actualSum: 0, oosCount: 0 };
    stats[k].count++;
    stats[k].stdSum += Number(a.standard_dose) || 0;
    stats[k].theorySum += Number(a.theory_kg) || 0;
    stats[k].actualSum += Number(a.actual_kg) || 0;
    if (a.is_out_of_spec) stats[k].oosCount++;
  });
  const rows = Object.values(stats).sort((a,b) => a.code.localeCompare(b.code));
  document.getElementById("repAuxBody").innerHTML = rows.map(s => `
    <tr>
      <td>${s.code}</td>
      <td>${s.name}</td>
      <td>${s.count}</td>
      <td>${s.stdSum.toFixed(2)}</td>
      <td>${s.theorySum.toFixed(3)}</td>
      <td>${s.actualSum.toFixed(3)}</td>
      <td style="color:${s.oosCount>0?'#dc2626':'#333'};">${s.oosCount}</td>
    </tr>
  `).join("") || `<tr><td colspan="7" style="text-align:center;color:#999;">本月无数据</td></tr>`;
}

function renderRepCust(orders, processes, params, aux) {
  const stats = {};
  const procByOrder = {}, paramByProc = {}, auxByProc = {};
  processes.forEach(p => { (procByOrder[p.order_id] = procByOrder[p.order_id] || []).push(p); });
  params.forEach(pa => { (paramByProc[pa.process_id] = paramByProc[pa.process_id] || []).push(pa); });
  aux.forEach(a => { (auxByProc[a.process_id] = auxByProc[a.process_id] || []).push(a); });

  orders.forEach(o => {
    const k = o.customer || "(无客户)";
    if (!stats[k]) stats[k] = { count: 0, done: 0, qty: 0, oos: 0 };
    stats[k].count++;
    if (o.status === "done") stats[k].done++;
    stats[k].qty += Number(o.order_qty_y) || 0;
    const procs = procByOrder[o.id] || [];
    const ps = procs.flatMap(p => paramByProc[p.id] || []);
    const as = procs.flatMap(p => auxByProc[p.id] || []);
    stats[k].oos += ps.filter(x => x.is_out_of_spec).length + as.filter(x => x.is_out_of_spec).length;
  });
  const rows = Object.entries(stats).sort((a,b) => b[1].count - a[1].count);
  document.getElementById("repCustBody").innerHTML = rows.map(([name, s]) => `
    <tr>
      <td>${name}</td><td>${s.count}</td><td>${s.done}</td>
      <td>${s.qty.toFixed(2)}</td>
      <td style="color:${s.oos>0?'#dc2626':'#333'};">${s.oos}</td>
    </tr>
  `).join("") || `<tr><td colspan="5" style="text-align:center;color:#999;">本月无数据</td></tr>`;
}

function exportReportCSV() {
  // 简单导出当前 tab 的表格
  const tabEl = document.getElementById("repTab" + currentRepTab.charAt(0).toUpperCase() + currentRepTab.slice(1));
  if (!tabEl) return;
  const tables = tabEl.querySelectorAll("table");
  if (!tables.length) return;
  const rows = [];
  tables.forEach(table => {
    table.querySelectorAll("tr").forEach(tr => {
      const cells = [];
      tr.querySelectorAll("th, td").forEach(c => cells.push(c.textContent.trim()));
      if (cells.length) rows.push(cells);
    });
  });
  downloadCSV(rows, `report_${currentRepTab}_${todayStr()}.csv`);
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
  `).join("") || `<tr><td colspan="6" style="text-align:center;color:#999;">暂无记录</td></tr>`;
}

function exportLogsCSV() {
  const rows = [["时间","操作人","动作","单号","详情"]];
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
  `).join("") || `<tr><td colspan="5" style="text-align:center;color:#999;">暂无日志</td></tr>`;
}

// ============ 备份 ============
async function backupAll() {
  if (currentUserRole !== "admin") { alert("仅管理员可备份"); return; }
  const stamp = todayStr();
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