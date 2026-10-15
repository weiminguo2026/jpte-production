// ============ 配置 ============
const SUPABASE_URL = 'https://hxgrpamlyujltvghhftf.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_fYDSZNCcFJEQwSKha9W5_w_x65TrlIj';
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const TB = {
  orders:     "craft_orders",
  processes:  "craft_processes",
  parameters: "craft_parameters",
  logs:       "craft_logs",
};

// ============ 全局 ============
let currentLang = "en";
let currentUserRole = "viewer";
let allOrders = [];
let filteredOrders = [];
let currentPage = 1;
const PAGE_SIZE = 20;
let editingOrderId = null;
let currentOrderId = null;       // 当前详情页订单 id
let currentProcessId = null;     // 当前参数弹窗归属工序 id
let editingProcessId = null;
let editingParamId = null;

// ============ 工具 ============
function t(zh, en) { return currentLang === "zh" ? zh : en; }

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

function esc(s) { return String(s || "").replace(/"/g, "&quot;"); }

function fmtTime(iso) {
  if (!iso) return "";
  return String(iso).slice(0,16).replace("T"," ");
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
  if (document.getElementById("mainPage")?.style.display !== "none") renderOrders();
  if (document.getElementById("orderDetailPage")?.style.display !== "none" && currentOrderId) openOrderDetail(currentOrderId);
}

function initLang() {
  document.querySelectorAll("[data-zh]").forEach(el => {
    el.textContent = el.getAttribute("data-" + currentLang);
  });
  document.querySelectorAll("option[data-zh]").forEach(el => {
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
function showMain(email) {
  document.getElementById("loginPage").style.display = "none";
  document.getElementById("dashboardPage").style.display = "block";
  document.getElementById("userEmail2").textContent = email;
}
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
    showMain(data.user.email);
    await loadOrders();
    goToDashboard();
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "登录"; }
  }
}
async function logout() {
  await supabaseClient.auth.signOut();
  document.getElementById("loginPage").style.display = "flex";
  ["dashboardPage","mainPage","orderDetailPage","reportPage","logsPage","sysLogsPage"].forEach(id => {
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
  ["dashboardPage","mainPage","orderDetailPage","reportPage","logsPage","sysLogsPage"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  });
}
function goToDashboard() {
  hideAll();
  document.getElementById("dashboardPage").style.display = "block";
  document.getElementById("userEmail2").textContent = document.getElementById("userEmail").textContent || document.getElementById("userEmail2").textContent;
  loadDashboard();
  applyRoleUI();
}
function goToOrders() {
  hideAll();
  document.getElementById("mainPage").style.display = "block";
  document.getElementById("userEmail").textContent = document.getElementById("userEmail2").textContent || document.getElementById("userEmail").textContent;
  renderOrders();
  applyRoleUI();
}
function showReport() {
  hideAll();
  document.getElementById("reportPage").style.display = "block";
  document.getElementById("userEmailReport").textContent = document.getElementById("userEmail2").textContent;
  const now = new Date();
  document.getElementById("reportMonth").value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
  loadReport();
}
function showLogs() {
  hideAll();
  document.getElementById("logsPage").style.display = "block";
  document.getElementById("userEmailLogs").textContent = document.getElementById("userEmail2").textContent;
  loadLogs();
}
function showSysLogs() {
  hideAll();
  document.getElementById("sysLogsPage").style.display = "block";
  document.getElementById("userEmailSysLogs").textContent = document.getElementById("userEmail2").textContent;
  loadSysLogs();
}

// ============ 订单 ============
async function loadOrders() {
  try {
    allOrders = await fetchAllRows(TB.orders, "created_at", false);
  } catch (err) {
    alert("加载失败: " + err.message);
    return;
  }
  filteredOrders = allOrders;
  currentPage = 1;
  renderOrders();
}

function renderOrders() {
  const keyword = document.getElementById("searchInput").value.trim().toLowerCase();
  const status = document.getElementById("statusFilter").value;
  filteredOrders = allOrders.filter(o => {
    if (status && o.status !== status) return false;
    if (keyword) {
      const kw = (o.order_no||"").toLowerCase().includes(keyword)
              || (o.batch_no||"").toLowerCase().includes(keyword)
              || (o.customer||"").toLowerCase().includes(keyword)
              || (o.product_name||"").toLowerCase().includes(keyword);
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
      <td>${o.order_no}</td>
      <td>${o.batch_no || ""}</td>
      <td>${o.customer || ""}</td>
      <td>${o.product_name || ""}</td>
      <td>${o.product_spec || ""}</td>
      <td>${o.quantity || 0} ${o.unit || ""}</td>
      <td>${statusLabel(o.status)}</td>
      <td>${o.start_date || ""}</td>
      <td>${o.end_date || ""}</td>
      <td class="cell-ellipsis" title="${esc(o.note)}">${o.note || ""}</td>
      <td>
        <button class="in" onclick="openOrderDetail('${o.id}')">详情</button>
        <button class="edit" onclick="openEditOrderModal('${o.id}')" data-role="operator">编辑</button>
        <button class="del" onclick="deleteOrder('${o.id}')" data-role="admin">删除</button>
      </td>
    </tr>`;
  }).join("") || `<tr><td colspan="12" style="text-align:center;color:#999;">暂无数据</td></tr>`;

  document.getElementById("orderPageInfo").textContent =
    `${currentPage} / ${totalPages}  (${filteredOrders.length})`;

  const totalQty = filteredOrders.reduce((s,o)=>s+(Number(o.quantity)||0),0);
  document.getElementById("statOrders").textContent = filteredOrders.length;
  document.getElementById("statQty").textContent = totalQty.toFixed(2);
}

function statusLabel(s) {
  return ({pending:"待处理", in_progress:"进行中", done:"已完成", cancelled:"已取消"})[s] || s;
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
  ["o_order_no","o_batch_no","o_customer","o_product_name","o_product_spec",
   "o_quantity","o_unit","o_start_date","o_end_date","o_note"].forEach(id => {
    document.getElementById(id).value = "";
  });
  document.getElementById("o_unit").value = "KG";
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
  document.getElementById("o_order_no").value = o.order_no || "";
  document.getElementById("o_batch_no").value = o.batch_no || "";
  document.getElementById("o_customer").value = o.customer || "";
  document.getElementById("o_product_name").value = o.product_name || "";
  document.getElementById("o_product_spec").value = o.product_spec || "";
  document.getElementById("o_quantity").value = o.quantity || 0;
  document.getElementById("o_unit").value = o.unit || "KG";
  document.getElementById("o_status").value = o.status || "pending";
  document.getElementById("o_start_date").value = o.start_date || "";
  document.getElementById("o_end_date").value = o.end_date || "";
  document.getElementById("o_note").value = o.note || "";
  document.getElementById("orderMsg").textContent = "";
  document.getElementById("orderModal").style.display = "flex";
}
function closeOrderModal() { document.getElementById("orderModal").style.display = "none"; }

async function saveOrder() {
  const g = id => document.getElementById(id).value.trim();
  const payload = {
    order_no: g("o_order_no"),
    batch_no: g("o_batch_no"),
    customer: g("o_customer"),
    product_name: g("o_product_name"),
    product_spec: g("o_product_spec"),
    quantity: Number(g("o_quantity")) || 0,
    unit: g("o_unit") || "KG",
    status: g("o_status") || "pending",
    start_date: g("o_start_date") || null,
    end_date: g("o_end_date") || null,
    note: g("o_note"),
  };
  if (!payload.order_no) { document.getElementById("orderMsg").textContent = "订单号必填"; return; }

  let error;
  if (editingOrderId) {
    ({ error } = await supabaseClient.from(TB.orders).update(payload).eq("id", editingOrderId));
    if (!error) await writeSysLog("edit_order", `编辑订单 ${payload.order_no}`, payload.order_no);
  } else {
    const { data: u } = await supabaseClient.auth.getUser();
    payload.operator = u?.user?.email || "";
    ({ error } = await supabaseClient.from(TB.orders).insert(payload).select().single());
    if (!error) await writeSysLog("add_order", `新增订单 ${payload.order_no}`, payload.order_no);
  }
  if (error) {
    document.getElementById("orderMsg").textContent = "保存失败: " + error.message;
    return;
  }
  closeOrderModal();
  await loadOrders();
}

async function deleteOrder(id) {
  if (!canDelete()) { alert("无权限"); return; }
  const o = allOrders.find(x => x.id === id);
  if (!o) return;
  if (!confirm(`确定删除订单 ${o.order_no}？\n（其下所有工序和参数一起删除）`)) return;
  const { error } = await supabaseClient.from(TB.orders).delete().eq("id", id);
  if (error) { alert("删除失败: " + error.message); return; }
  await writeSysLog("delete_order", `删除订单 ${o.order_no}`, o.order_no);
  await loadOrders();
}

// ============ 订单详情 ============
async function openOrderDetail(orderId) {
  currentOrderId = orderId;
  hideAll();
  document.getElementById("orderDetailPage").style.display = "block";
  document.getElementById("userEmailDetail").textContent = document.getElementById("userEmail2").textContent;

  const order = allOrders.find(x => x.id === orderId);
  if (!order) { alert("订单不存在"); return; }

  document.getElementById("detailTitle").textContent =
    `${order.order_no}  |  ${order.customer || ""}  |  ${order.product_name || ""}  |  ${statusLabel(order.status)}`;

  let processes = [];
  try {
    processes = await fetchAllRows(TB.processes, "seq", true, q => q.eq("order_id", orderId));
  } catch (e) {
    document.getElementById("detailBody").innerHTML = `<p class="msg">加载工序失败: ${e.message}</p>`;
    return;
  }

  const processIds = processes.map(p => p.id);
  let parameters = [];
  if (processIds.length) {
    try {
      parameters = await fetchAllRows(TB.parameters, "created_at", true,
        q => q.in("process_id", processIds));
    } catch (e) {
      console.warn("加载参数失败:", e);
    }
  }

  const paramsByProcess = {};
  parameters.forEach(p => {
    if (!paramsByProcess[p.process_id]) paramsByProcess[p.process_id] = [];
    paramsByProcess[p.process_id].push(p);
  });

  const oosCount = parameters.filter(p => p.is_out_of_spec).length;
  document.getElementById("detailProcCount").textContent = processes.length;
  document.getElementById("detailOOS").textContent = oosCount;

  document.getElementById("detailBody").innerHTML = processes.map((proc, idx) => {
    const params = paramsByProcess[proc.id] || [];
    const rows = params.map(pa => `
      <tr>
        <td>${pa.param_name}</td>
        <td>${pa.param_unit || ""}</td>
        <td>${pa.standard_value || ""}</td>
        <td>${pa.actual_value || ""}</td>
        <td>${pa.is_out_of_spec ? "⚠️ 超标" : "正常"}</td>
        <td class="cell-ellipsis" title="${esc(pa.note)}">${pa.note || ""}</td>
        <td>
          <button class="edit" onclick="openEditParamModal('${pa.id}')" data-role="operator">编辑</button>
          <button class="del" onclick="deleteParam('${pa.id}')" data-role="operator">删除</button>
        </td>
      </tr>`).join("") || `<tr><td colspan="7" style="text-align:center;color:#999;">暂无参数</td></tr>`;

    return `
    <div class="dash-section" style="margin-bottom:14px;">
      <div class="dash-section-head">
        <h2>工序 ${proc.seq}. ${proc.process_name}
          <span style="font-size:13px;color:#666;font-weight:normal;">
            | ${proc.machine || "—"} | ${proc.operator || "—"} | ${statusLabel(proc.status)}
          </span>
        </h2>
        <div>
          <button class="in" onclick="openAddParamModal('${proc.id}')" data-role="operator">+ 参数</button>
          <button class="edit" onclick="openEditProcessModal('${proc.id}')" data-role="operator">编辑</button>
          <button class="del" onclick="deleteProcess('${proc.id}')" data-role="operator">删除</button>
        </div>
      </div>
      <div style="font-size:12px;color:#666;margin-bottom:8px;">
        标准要求: ${proc.standard_note || "—"} | 
        开始: ${fmtTime(proc.start_time) || "—"} | 
        结束: ${fmtTime(proc.end_time) || "—"} | 
        结果: ${proc.result || "—"} | 
        备注: ${proc.note || "—"}
      </div>
      <table>
        <thead>
          <tr>
            <th>参数名</th><th>单位</th><th>标准值</th><th>实际值</th><th>是否超标</th><th>备注</th><th>操作</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }).join("") || `<p style="text-align:center;color:#999;">暂无工序，点右上角"+ 工序"添加</p>`;

  // 在末尾加"添加工序"按钮
  document.getElementById("detailBody").insertAdjacentHTML("afterbegin",
    `<div style="margin-bottom:10px;text-align:right;">
       <button onclick="openAddProcessModal()" data-role="operator" style="padding:8px 14px;background:#2563eb;color:#fff;border:none;border-radius:8px;cursor:pointer;">+ 工序</button>
       <button onclick="goToOrders()" style="padding:8px 14px;background:#e5e7eb;color:#333;border:none;border-radius:8px;cursor:pointer;margin-left:6px;">返回清单</button>
     </div>`);
}

// ============ 工序弹窗 ============
function openAddProcessModal() {
  if (!canEdit()) { alert("无权限"); return; }
  editingProcessId = null;
  document.getElementById("processModalTitle").textContent = "新增工序";
  document.getElementById("p_seq").value = 1;
  document.getElementById("p_process_name").value = "前处理";
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
  document.getElementById("p_seq").value = data.seq;
  document.getElementById("p_process_name").value = data.process_name;
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
  const g = id => document.getElementById(id).value.trim();
  const payload = {
    order_id: currentOrderId,
    seq: Number(g("p_seq")) || 1,
    process_name: g("p_process_name"),
    machine: g("p_machine"),
    operator: g("p_operator"),
    start_time: g("p_start_time") || null,
    end_time: g("p_end_time") || null,
    status: g("p_status") || "pending",
    standard_note: g("p_standard_note"),
    result: g("p_result"),
    note: g("p_note"),
  };
  if (!payload.process_name) { document.getElementById("processMsg").textContent = "工序名必填"; return; }

  let error;
  if (editingProcessId) {
    ({ error } = await supabaseClient.from(TB.processes).update(payload).eq("id", editingProcessId));
  } else {
    ({ error } = await supabaseClient.from(TB.processes).insert(payload));
  }
  if (error) { document.getElementById("processMsg").textContent = "保存失败: " + error.message; return; }
  await writeSysLog(editingProcessId ? "edit_process" : "add_process",
    `${editingProcessId ? "编辑" : "新增"}工序 ${payload.process_name}`, null);
  closeProcessModal();
  openOrderDetail(currentOrderId);
}

async function deleteProcess(id) {
  if (!canEdit()) { alert("无权限"); return; }
  if (!confirm("确定删除该工序？（其下所有参数一起删除）")) return;
  const { error } = await supabaseClient.from(TB.processes).delete().eq("id", id);
  if (error) { alert("删除失败: " + error.message); return; }
  await writeSysLog("delete_process", "删除工序", null);
  openOrderDetail(currentOrderId);
}

// ============ 参数弹窗 ============
function openAddParamModal(processId) {
  if (!canEdit()) { alert("无权限"); return; }
  currentProcessId = processId;
  editingParamId = null;
  document.getElementById("paramModalTitle").textContent = "新增参数";
  document.getElementById("pa_param_name").value = "温度";
  document.getElementById("pa_param_unit").value = "";
  document.getElementById("pa_standard_value").value = "";
  document.getElementById("pa_actual_value").value = "";
  document.getElementById("pa_is_out_of_spec").checked = false;
  document.getElementById("pa_note").value = "";
  document.getElementById("paramMsg").textContent = "";
  document.getElementById("paramModal").style.display = "flex";
}

async function openEditParamModal(paramId) {
  if (!canEdit()) { alert("无权限"); return; }
  const { data, error } = await supabaseClient.from(TB.parameters).select("*").eq("id", paramId).single();
  if (error) { alert("加载失败: " + error.message); return; }
  editingParamId = paramId;
  currentProcessId = data.process_id;
  document.getElementById("paramModalTitle").textContent = "编辑参数";
  document.getElementById("pa_param_name").value = data.param_name;
  document.getElementById("pa_param_unit").value = data.param_unit || "";
  document.getElementById("pa_standard_value").value = data.standard_value || "";
  document.getElementById("pa_actual_value").value = data.actual_value || "";
  document.getElementById("pa_is_out_of_spec").checked = !!data.is_out_of_spec;
  document.getElementById("pa_note").value = data.note || "";
  document.getElementById("paramMsg").textContent = "";
  document.getElementById("paramModal").style.display = "flex";
}
function closeParamModal() { document.getElementById("paramModal").style.display = "none"; }

async function saveParam() {
  const g = id => document.getElementById(id).value.trim();
  const payload = {
    process_id: currentProcessId,
    param_name: g("pa_param_name"),
    param_unit: g("pa_param_unit"),
    standard_value: g("pa_standard_value"),
    actual_value: g("pa_actual_value"),
    is_out_of_spec: document.getElementById("pa_is_out_of_spec").checked,
    note: g("pa_note"),
  };
  if (!payload.param_name) { document.getElementById("paramMsg").textContent = "参数名必填"; return; }

  let error;
  if (editingParamId) {
    ({ error } = await supabaseClient.from(TB.parameters).update(payload).eq("id", editingParamId));
  } else {
    ({ error } = await supabaseClient.from(TB.parameters).insert(payload));
  }
  if (error) { document.getElementById("paramMsg").textContent = "保存失败: " + error.message; return; }
  await writeSysLog(editingParamId ? "edit_param" : "add_param",
    `${editingParamId ? "编辑" : "新增"}参数 ${payload.param_name}`, null);
  closeParamModal();
  openOrderDetail(currentOrderId);
}

async function deleteParam(id) {
  if (!canEdit()) { alert("无权限"); return; }
  if (!confirm("确定删除该参数？")) return;
  const { error } = await supabaseClient.from(TB.parameters).delete().eq("id", id);
  if (error) { alert("删除失败: " + error.message); return; }
  await writeSysLog("delete_param", "删除参数", null);
  openOrderDetail(currentOrderId);
}

// ============ 仪表盘 ============
async function loadDashboard() {
  const total = allOrders.length;
  document.getElementById("dashOrders").textContent = total;
  document.getElementById("dashPending").textContent = allOrders.filter(o => o.status === "pending").length;
  document.getElementById("dashInProgress").textContent = allOrders.filter(o => o.status === "in_progress").length;
  document.getElementById("dashDone").textContent = allOrders.filter(o => o.status === "done").length;

  try {
    const params = await fetchAllRows(TB.parameters, "created_at", false, q => q.eq("is_out_of_spec", true));
    document.getElementById("dashOOS").textContent = params.length;
  } catch (e) { document.getElementById("dashOOS").textContent = "—"; }
}

// ============ 报表 ============
async function loadReport() {
  const month = document.getElementById("reportMonth").value;
  if (!month) return;
  const [y, m] = month.split("-").map(Number);
  const first = `${month}-01`;
  const last = new Date(y, m, 0).toISOString().slice(0,10);

  const orders = allOrders.filter(o => o.start_date && o.start_date >= first && o.start_date <= last);

  const orderIds = orders.map(o => o.id);
  let processes = [], parameters = [];
  if (orderIds.length) {
    processes = await fetchAllRows(TB.processes, "seq", true, q => q.in("order_id", orderIds));
    const pids = processes.map(p => p.id);
    if (pids.length) parameters = await fetchAllRows(TB.parameters, "created_at", true, q => q.in("process_id", pids));
  }

  const procByOrder = {}, paramByProc = {};
  processes.forEach(p => { if (!procByOrder[p.order_id]) procByOrder[p.order_id] = []; procByOrder[p.order_id].push(p); });
  parameters.forEach(pa => { if (!paramByProc[pa.process_id]) paramByProc[pa.process_id] = []; paramByProc[pa.process_id].push(pa); });

  document.getElementById("reportBody").innerHTML = orders.map(o => {
    const procs = procByOrder[o.id] || [];
    const params = procs.flatMap(p => paramByProc[p.id] || []);
    const oos = params.filter(pa => pa.is_out_of_spec).length;
    return `
      <tr>
        <td>${o.order_no}</td>
        <td>${o.batch_no || ""}</td>
        <td>${o.customer || ""}</td>
        <td>${o.product_name || ""}</td>
        <td>${statusLabel(o.status)}</td>
        <td>${procs.length}</td>
        <td>${params.length}</td>
        <td style="color:${oos>0?'#dc2626':'#333'};font-weight:${oos>0?'bold':'normal'};">${oos}</td>
      </tr>`;
  }).join("") || `<tr><td colspan="8" style="text-align:center;color:#999;">本月无数据</td></tr>`;

  document.getElementById("repOrders").textContent = orders.length;
  document.getElementById("repDone").textContent = orders.filter(o => o.status === "done").length;
  document.getElementById("repOOS").textContent = parameters.filter(pa => pa.is_out_of_spec).length;
}

// ============ 操作记录 ============
async function loadLogs() {
  const data = await fetchAllRows(TB.logs, "created_at", false);
  document.getElementById("logBody").innerHTML = (data || []).map((l, idx) => `
    <tr>
      <td>${idx+1}</td>
      <td>${fmtTime(l.created_at)}</td>
      <td>${l.user_email || ""}</td>
      <td>${l.action}</td>
      <td>${l.ref_no || ""}</td>
      <td class="cell-ellipsis" title="${esc(l.detail)}">${l.detail || ""}</td>
    </tr>
  `).join("") || `<tr><td colspan="6" style="text-align:center;color:#999;">暂无记录</td></tr>`;
}

// ============ 系统日志 ============
async function loadSysLogs() {
  const data = await fetchAllRows(TB.logs, "created_at", false);
  document.getElementById("sysLogBody").innerHTML = (data || []).map((l, idx) => `
    <tr>
      <td>${idx+1}</td>
      <td>${fmtTime(l.created_at)}</td>
      <td>${l.user_email || ""}</td>
      <td>${l.action}</td>
      <td class="cell-ellipsis" title="${esc(l.detail)}">${l.detail || ""}</td>
    </tr>
  `).join("") || `<tr><td colspan="5" style="text-align:center;color:#999;">暂无日志</td></tr>`;
}

// ============ 备份 ============
async function backupAll() {
  if (currentUserRole !== "admin") { alert("仅管理员可备份"); return; }
  const stamp = new Date().toISOString().slice(0,10);
  try {
    const orders = await fetchAllRows(TB.orders, "created_at", false);
    const processes = await fetchAllRows(TB.processes, "created_at", false);
    const parameters = await fetchAllRows(TB.parameters, "created_at", false);
    const dump = (rows, filename) => {
      if (!rows.length) { downloadCSV([["(empty)"]], filename); return; }
      const headers = Object.keys(rows[0]);
      downloadCSV([headers, ...rows.map(r => headers.map(h => r[h]))], filename);
    };
    dump(orders, `craft_orders_backup_${stamp}.csv`);
    dump(processes, `craft_processes_backup_${stamp}.csv`);
    dump(parameters, `craft_parameters_backup_${stamp}.csv`);
    await writeSysLog("backup_all", `备份 订单${orders.length} / 工序${processes.length} / 参数${parameters.length}`, null);
    alert("备份完成");
  } catch (e) { alert("备份失败: " + e.message); }
}

// ============ 导出 ============
function openExportModal() {
  const headers = ["order_no","batch_no","customer","product_name","product_spec","quantity","unit","status","start_date","end_date","note"];
  const rows = filteredOrders.map(o => headers.map(h => o[h] ?? ""));
  downloadCSV([headers, ...rows], `craft_orders_${new Date().toISOString().slice(0,10)}.csv`);
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