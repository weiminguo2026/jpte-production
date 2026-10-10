// ============================================================
// JPTE 生产进度跟踪系统 — app.js
// Supabase: hxgrpamlyujltvghhftf
// ============================================================

const SUPABASE_URL = 'https://hxgrpamlyujltvghhftf.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_fYDSZNCcFJEQwSKha9W5_w_x65TrlIj';  // ← 去 Supabase 项目 Settings → API 复制
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUserEmail = '';
let currentUserRole = '';
let currentOrderId = null;
let currentTab = 'plan';
let allOrders = [];
let currentBaseDataCategory = 'fg_code';

const PROGRESS_TABLES = {
  plan: 'plan_progress',
  craft: 'craft_progress',
  dyeing: 'dyeing_progress',
  warping: 'warping_progress',
  sizing: 'sizing_progress',
  drawing: 'drawing_progress',
  weaving: 'weaving_progress',
  grey: 'grey_progress',
  finishing: 'finishing_progress',
  finished: 'finished_progress'
};

const TAB_LABELS = {
  plan: '计划', craft: '工艺', dyeing: '染色', warping: '整经',
  sizing: '浆纱', drawing: '穿综', weaving: '织造', grey: '坯布',
  finishing: '后整理', finished: '成品'
};

// ============================================================
// 登录 / 登出
// ============================================================
async function login() {
  const btn = document.getElementById('loginBtn');
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const errBox = document.getElementById('loginError');
  errBox.textContent = '';

  if (!email || !password) { errBox.textContent = '请输入邮箱和密码'; return; }

  if (btn) {
    btn.disabled = true;
    btn.dataset.originalText = btn.textContent;
    btn.textContent = '登录中...';
  }

  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) { errBox.textContent = error.message; return; }

    if (btn) btn.textContent = '加载权限...';
    currentUserEmail = data.user.email;
    await loadUserRole();

    if (btn) btn.textContent = '加载数据...';
    showMain(currentUserEmail);
    await loadOrders();
    goToDashboard();
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = btn.dataset.originalText || '登录';
    }
  }
}

async function loadUserRole() {
  const { data } = await supabaseClient
    .from('user_roles')
    .select('role')
    .eq('user_id', (await supabaseClient.auth.getUser()).data.user.id)
    .maybeSingle();
  currentUserRole = data?.role || 'viewer';
  document.getElementById('userRole').textContent = currentUserRole;
  // admin 才能看基础数据
  document.getElementById('navBaseData').style.display = currentUserRole === 'admin' ? '' : 'none';
  // planner 才能新建订单
  document.getElementById('btnNewOrder').style.display =
    (currentUserRole === 'admin' || currentUserRole === 'planner') ? '' : 'none';
}

function showMain(email) {
  document.getElementById('loginPage').style.display = 'none';
  document.getElementById('mainPage').style.display = '';
  document.getElementById('userEmail').textContent = email;
}

async function logout() {
  await supabaseClient.auth.signOut();
  location.reload();
}

// ============================================================
// 页面切换
// ============================================================
function hideAllPages() {
  ['dashboardPage', 'ordersPage', 'orderDetailPage', 'logsPage', 'baseDataPage']
    .forEach(id => document.getElementById(id).style.display = 'none');
}

function goToDashboard() {
  hideAllPages();
  document.getElementById('dashboardPage').style.display = '';
  renderDashboard();
}

function goToOrders() {
  hideAllPages();
  document.getElementById('ordersPage').style.display = '';
  renderOrders();
}

function goToLogs() {
  hideAllPages();
  document.getElementById('logsPage').style.display = '';
  loadLogs();
}

function goToBaseData() {
  hideAllPages();
  document.getElementById('baseDataPage').style.display = '';
  renderBaseData();
}

// ============================================================
// 公式区
// ============================================================
function roundUp(n) { return Math.ceil(n); }

function getOverShortCoef(cn, orderQtyY) {
  cn = String(cn); orderQtyY = Number(orderQtyY) || 0;
  if (cn === '2' && orderQtyY >= 10000) return 0.02;
  if (cn === '1' && orderQtyY >= 10000) return 0.01;
  if (cn === '2' && orderQtyY > 2000 && orderQtyY < 10000) return 0.03;
  if (cn === '1' && orderQtyY > 2000 && orderQtyY < 10000) return 0.02;
  if (cn === '2' && orderQtyY <= 2000) return 0.06;
  if (cn === '1' && orderQtyY <= 2000) return 0.04;
  return 0;
}

function computePlanQtyM(orderQtyY, cn, ck) {
  const coef = getOverShortCoef(cn, orderQtyY);
  return roundUp(orderQtyY * 0.9144 * (coef + (Number(ck) || 0) + 1));
}

function computeTheoryYarn100m(totalWarp, warpCount, craftReed, weftDensity, weftCount) {
  if (!totalWarp || !warpCount || !craftReed || !weftDensity || !weftCount) return null;
  const a = totalWarp * 1.1 * 1.01 * 1.03 * 583 / warpCount / 10000;
  const b = (craftReed / 2.54 + 4) * weftDensity * 1.01 * 1.02 * 583 / weftCount / 10000;
  return a + b;
}

function getAddon(cm, co) {
  cm = String(cm); co = String(co);
  if (cm === '1' && co === '1') return 0.03;
  if (cm === '1' && co === '2') return 0.06;
  if (cm === '2' && co === '1') return -0.02;
  if (cm === '2' && co === '2') return 0.01;
  if (cm === '3') return 0.02;
  return 0;
}

function computeProgress(cumulative, target) {
  if (!target) return null;
  return cumulative / target;
}

function computeDelayDays(planDate, actualDate) {
  if (!planDate || !actualDate) return null;
  return Math.round((new Date(actualDate) - new Date(planDate)) / 86400000);
}

function computeProductionCycle(orderDate, actualFinishDate) {
  if (!orderDate || !actualFinishDate) return null;
  return Math.round((new Date(actualFinishDate) - new Date(orderDate)) / 86400000);
}

function computeDispatchCycle(orderDate, deliveryDate) {
  if (!orderDate || !deliveryDate) return null;
  return Math.round((new Date(deliveryDate) - new Date(orderDate)) / 86400000);
}

// ============================================================
// 拆分：按交期把批次产量拆到各合同
// ============================================================
async function allocateToOrders(batchId, cumulativeQty) {
  const { data: orders } = await supabaseClient
    .from('orders')
    .select('id, contract_no, seq_no, delivery_date, order_qty_y, plan_qty_m')
    .eq('batch_id', batchId)
    .order('delivery_date', { ascending: true });

  let remaining = cumulativeQty;
  const allocation = [];

  for (const order of orders || []) {
    const target = Number(order.plan_qty_m) || 0;
    if (target <= 0) {
      allocation.push({ ...order, target: 0, allocated: 0, progress_pct: 0 });
      continue;
    }
    const allocated = Math.min(remaining, target);
    allocation.push({ ...order, target, allocated, progress_pct: allocated / target });
    remaining -= allocated;
    if (remaining <= 0) break;
  }
  return allocation;
}

// ============================================================
// 批次状态自动算
// ============================================================
async function computeBatchStatus(batchId) {
  const tables = Object.values(PROGRESS_TABLES);
  const statuses = [];

  for (const t of tables) {
    const { data } = await supabaseClient
      .from(t).select('*').eq('batch_id', batchId).maybeSingle();

    if (!data) { statuses.push('pending'); continue; }
    if (t === 'plan_progress' || t === 'craft_progress') {
      statuses.push('completed');
    } else if (Number(data.progress_pct) >= 1) {
      statuses.push('completed');
    } else {
      statuses.push('in_progress');
    }
  }

  let status = 'pending';
  if (statuses.every(s => s === 'completed')) status = 'completed';
  else if (statuses.some(s => s === 'in_progress' || s === 'completed')) status = 'in_progress';

  await supabaseClient.from('production_batches')
    .update({ batch_status: status, updated_at: new Date() })
    .eq('id', batchId);

  return status;
}

// ============================================================
// 订单列表
// ============================================================
async function loadOrders() {
  const { data, error } = await supabaseClient
    .from('orders')
    .select('*, production_batches(fabric_no, batch_status)')
    .order('delivery_date', { ascending: true });

  if (error) { console.error(error); return; }
  allOrders = data || [];
}

function renderOrders() {
  const fPO = document.getElementById('filterPO').value.trim().toLowerCase();
  const fContract = document.getElementById('filterContract').value.trim().toLowerCase();
  const fCustomer = document.getElementById('filterCustomer').value.trim().toLowerCase();
  const fSales = document.getElementById('filterSales').value.trim().toLowerCase();
  const fStatus = document.getElementById('filterStatus').value;

  const filtered = allOrders.filter(o => {
    if (fPO && !(o.po_no || '').toLowerCase().includes(fPO)) return false;
    if (fContract && !(o.contract_no || '').toLowerCase().includes(fContract)) return false;
    if (fCustomer && !(o.customer || '').toLowerCase().includes(fCustomer)) return false;
    if (fSales && !(o.sales || '').toLowerCase().includes(fSales)) return false;
    if (fStatus && o.status !== fStatus) return false;
    return true;
  });

  const tbody = document.getElementById('ordersBody');
  tbody.innerHTML = filtered.map(o => {
    const dispatchCycle = computeDispatchCycle(o.order_date, o.delivery_date);
    const productionCycle = computeProductionCycle(o.order_date, o.actual_finish_date);
    return `
      <tr>
        <td>${o.po_no || ''}</td>
        <td>${o.contract_no || ''}</td>
        <td>${o.seq_no || ''}</td>
        <td>${o.customer || ''}</td>
        <td>${o.order_date || ''}</td>
        <td>${o.delivery_date || ''}</td>
        <td>${dispatchCycle ?? '—'}</td>
        <td>${o.sales || ''}</td>
        <td>${o.order_qty_y ?? ''}</td>
        <td>${o.plan_qty_m ?? ''}</td>
        <td>${o.status || ''}</td>
        <td>${productionCycle ?? '—'}</td>
        <td><button onclick="openOrderDetail('${o.batch_id}')">查看</button></td>
      </tr>
    `;
  }).join('');
}

// ============================================================
// 订单详情（10 Tab）
// ============================================================
async function openOrderDetail(batchId) {
  hideAllPages();
  document.getElementById('orderDetailPage').style.display = '';

  // 查批次 + 订单
  const { data: batch } = await supabaseClient
    .from('production_batches').select('*').eq('id', batchId).single();
  const { data: orders } = await supabaseClient
    .from('orders').select('*').eq('batch_id', batchId)
    .order('delivery_date', { ascending: true });

  const firstOrder = orders?.[0] || {};
  const orderDate = firstOrder.order_date;
  const deliveryDate = firstOrder.delivery_date;

  // 查 finished_progress 的 actual_date 作为实际完成日
  const { data: fp } = await supabaseClient
    .from('finished_progress').select('actual_date').eq('batch_id', batchId).maybeSingle();

  const productionCycle = computeProductionCycle(orderDate, fp?.actual_date);
  const dispatchCycle = computeDispatchCycle(orderDate, deliveryDate);

  document.getElementById('orderHeader').innerHTML = `
    <h3>厂编号：${batch?.fabric_no || ''}</h3>
    <div>批次状态：${batch?.batch_status || ''}</div>
    <div class="order-meta">
      <div><label>下单日期</label><span>${orderDate || '—'}</span></div>
      <div><label>合同交期</label><span>${deliveryDate || '—'}</span></div>
      <div><label>排单周期</label><span>${dispatchCycle ?? '—'} 天</span></div>
      <div><label>实际完成</label><span>${fp?.actual_date || '—'}</span></div>
      <div><label>生产周期</label><span>${productionCycle ?? '—'} 天</span></div>
      <div><label>业务员</label><span>${firstOrder.sales || '—'}</span></div>
    </div>
    <div class="merged-orders">
      <label>合并合同：</label>
      ${(orders || []).map(o => `<span class="order-tag">${o.contract_no} / 交期 ${o.delivery_date} / 计划 ${o.plan_qty_m || '—'}M</span>`).join('')}
    </div>
  `;

  currentOrderId = batchId;
  switchTab('plan');
}

async function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('#orderDetailPage .tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });

  const table = PROGRESS_TABLES[tab];
  const { data } = await supabaseClient
    .from(table).select('*').eq('batch_id', currentOrderId).maybeSingle();

  const { data: orders } = await supabaseClient
    .from('orders').select('id, contract_no, seq_no, delivery_date, order_qty_y, plan_qty_m')
    .eq('batch_id', currentOrderId)
    .order('delivery_date', { ascending: true });

  // 渲染表单
  const isReadOnly = !canEditTab(tab);
  document.getElementById('tabContent').innerHTML = renderTabForm(tab, data, isReadOnly);

  // 渲染拆分明细
  if (data && tab !== 'plan' && tab !== 'craft' && tab !== 'finished') {
    const cumulative = Number(data.cumulative_qty_m) || 0;
    const alloc = await allocateToOrders(currentOrderId, cumulative);
    document.getElementById('tabContent').innerHTML += renderAllocation(alloc);
  } else if (data && tab === 'finished') {
    const cumulative = Number(data.entry_qty_y) || 0;
    const alloc = await allocateToOrders(currentOrderId, cumulative);
    document.getElementById('tabContent').innerHTML += renderAllocation(alloc, 'Y');
  }
}

function canEditTab(tab) {
  if (currentUserRole === 'admin') return true;
  const map = {
    plan: 'planner', craft: 'planner',
    dyeing: 'dyeing', warping: 'warping', sizing: 'sizing',
    drawing: 'drawing', weaving: 'weaving', grey: 'grey',
    finishing: 'finishing', finished: 'finished'
  };
  return currentUserRole === map[tab];
}

function renderTabForm(tab, data, isReadOnly) {
  const d = data || {};
  const dis = isReadOnly ? 'disabled' : '';
  const fields = getTabFields(tab);
  let html = `<h3>${TAB_LABELS[tab]}进度</h3>`;
  html += `<div class="form-grid">`;
  for (const f of fields) {
    const v = d[f.key] ?? '';
    html += `
      <div class="form-item">
        <label>${f.label}</label>
        <input type="${f.type || 'text'}" id="fld_${f.key}" value="${v}" ${dis} />
      </div>
    `;
  }
  html += `</div>`;
  if (!isReadOnly) {
    html += `<button onclick="saveProgress('${tab}')">保存</button>`;
  }
  return html;
}

function getTabFields(tab) {
  const common = [
    { key: 'plan_date', label: '计划完成日期', type: 'date' },
    { key: 'actual_date', label: '实际完成日期', type: 'date' },
  ];
  const map = {
    plan: [
      ...common,
      { key: 'plan_qty_m', label: '计划生产数量(M)', type: 'number' },
      { key: 'actual_qty_m', label: '实际投坯数量(M)', type: 'number' },
      { key: 'remark', label: '备注' }
    ],
    craft: [
      ...common,
      { key: 'total_warp', label: '总经根数', type: 'number' },
      { key: 'reed', label: '钢筘' },
      { key: 'craft_reed', label: '工艺筘幅', type: 'number' },
      { key: 'theory_yarn_100m', label: '理论百米用纱量', type: 'number' },
      { key: 'chenwen_yarn_100m', label: '陈文百米用纱', type: 'number' },
      { key: 'sioc_yarn_100m', label: 'SIOC百米用纱', type: 'number' },
      { key: 'actual_yarn_100m', label: '实际百米用纱量', type: 'number' },
      { key: 'dye_qty_kg', label: '染色投染量(KG)', type: 'number' },
      { key: 'gsm_by_theory', label: '按理论折算克重', type: 'number' },
      { key: 'gsm_by_dyeing', label: '按染色折算克重', type: 'number' },
      { key: 'actual_gsm', label: '实际面料克重', type: 'number' },
      { key: 'patch_yarn', label: '补纱' },
      { key: 'remark', label: '备注' }
    ],
    dyeing: [
      ...common,
      { key: 'warp_kg', label: '经纱用纱量(KG)', type: 'number' },
      { key: 'weft_kg', label: '纬纱用纱量(KG)', type: 'number' },
      { key: 'dye_qty_kg', label: '染色数量(KG)', type: 'number' },
      { key: 'supplier', label: '供应商' },
      { key: 'yarn_lot_warp', label: '经纱批号' },
      { key: 'yarn_lot_weft', label: '纬纱批号' },
      { key: 'rec_dye_plan_date', label: '染色投染单日期', type: 'date' },
      { key: 'remark', label: '备注' }
    ],
    warping: [
      ...common,
      { key: 'craft_length_m', label: '工艺长度(M)', type: 'number' },
      { key: 'beam_count', label: '经轴数', type: 'number' },
      { key: 'cumulative_qty_m', label: '累计完成(M)', type: 'number' },
      { key: 'remark', label: '备注' }
    ],
    sizing: [
      ...common,
      { key: 'craft_length_m', label: '工艺长度(M)', type: 'number' },
      { key: 'beam_count', label: '浆轴数', type: 'number' },
      { key: 'cumulative_qty_m', label: '累计完成(M)', type: 'number' },
      { key: 'remark', label: '备注' }
    ],
    drawing: [
      ...common,
      { key: 'beam_count', label: '经轴数', type: 'number' },
      { key: 'cumulative_qty_m', label: '累计完成(M)', type: 'number' },
      { key: 'remark', label: '备注' }
    ],
    weaving: [
      ...common,
      { key: 'daily_output_m', label: '每日产量(M)', type: 'number' },
      { key: 'cumulative_qty_m', label: '累计完成(M)', type: 'number' },
      { key: 'beam_count', label: '轴数', type: 'number' },
      { key: 'days', label: '计划天数', type: 'number' },
      { key: 'remark', label: '备注' }
    ],
    grey: [
      ...common,
      { key: 'cumulative_qty_m', label: '累计完成(M)', type: 'number' },
      { key: 'remark', label: '备注' }
    ],
    finishing: [
      ...common,
      { key: 'cumulative_qty_m', label: '累计完成(M)', type: 'number' },
      { key: 'remark', label: '备注' }
    ],
    finished: [
      ...common,
      { key: 'entry_qty_y', label: '入库合计(Y)', type: 'number' },
      { key: 'ship_qty_y', label: '出运数量(Y)', type: 'number' },
      { key: 'stock_a', label: 'A级品库存(Y)', type: 'number' },
      { key: 'stock_b', label: 'B级品库存(Y)', type: 'number' },
      { key: 'stock_c', label: 'C级品库存(Y)', type: 'number' },
      { key: 'remark', label: '备注' }
    ]
  };
  return map[tab] || [];
}

function renderAllocation(alloc, unit = 'M') {
  if (!alloc || !alloc.length) return '';
  return `
    <div class="allocation">
      <h4>按交期拆分到合同</h4>
      <table>
        <thead><tr><th>合同号</th><th>序号</th><th>交期</th><th>计划(${unit})</th><th>已分配(${unit})</th><th>进度</th></tr></thead>
        <tbody>
          ${alloc.map(a => `
            <tr>
              <td>${a.contract_no}</td>
              <td>${a.seq_no || ''}</td>
              <td>${a.delivery_date || ''}</td>
              <td>${a.target ?? ''}</td>
              <td>${a.allocated ?? ''}</td>
              <td>${a.progress_pct != null ? (a.progress_pct * 100).toFixed(1) + '%' : ''}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

async function saveProgress(tab) {
  const table = PROGRESS_TABLES[tab];
  const fields = getTabFields(tab);
  const payload = { batch_id: currentOrderId, operator: currentUserEmail, updated_at: new Date() };

  for (const f of fields) {
    const el = document.getElementById('fld_' + f.key);
    if (!el) continue;
    let v = el.value;
    if (f.type === 'number') v = v === '' ? null : Number(v);
    if (v === '') v = null;
    payload[f.key] = v;
  }

  // 自动算
  if (tab === 'dyeing') {
    const planKg = Number(payload.dye_qty_kg) || 0;
    // 这里 planKg 应该是计划部给的，实际按 dye_qty_kg 作为累计
    // 简化：shortage_kg = 0
  }
  if (['warping', 'sizing', 'drawing', 'weaving', 'grey', 'finishing'].includes(tab)) {
    const cum = Number(payload.cumulative_qty_m) || 0;
    const { data: orders } = await supabaseClient
      .from('orders').select('plan_qty_m').eq('batch_id', currentOrderId);
    const totalPlan = (orders || []).reduce((s, o) => s + (Number(o.plan_qty_m) || 0), 0);
    payload.progress_pct = totalPlan ? cum / totalPlan : 0;
    payload.shortage_m = totalPlan - cum;
  }
  if (tab === 'finished') {
    const cum = Number(payload.entry_qty_y) || 0;
    const { data: orders } = await supabaseClient
      .from('orders').select('order_qty_y').eq('batch_id', currentOrderId);
    const totalOrder = (orders || []).reduce((s, o) => s + (Number(o.order_qty_y) || 0), 0);
    payload.progress_pct = totalOrder ? cum / totalOrder : 0;
    payload.qty_not_in_storage_y = totalOrder - cum;
  }

  const { data: existing } = await supabaseClient
    .from(table).select('id').eq('batch_id', currentOrderId).maybeSingle();

  let error;
  if (existing) {
    ({ error } = await supabaseClient.from(table).update(payload).eq('id', existing.id));
  } else {
    ({ error } = await supabaseClient.from(table).insert(payload));
  }

  if (error) { alert('保存失败：' + error.message); return; }

  // 写 change_log
  await supabaseClient.from('change_log').insert({
    table_name: table,
    record_id: existing?.id || null,
    batch_id: currentOrderId,
    action: existing ? 'edit' : 'add',
    changes: payload,
    operator: currentUserEmail
  });

  await computeBatchStatus(currentOrderId);
  alert('保存成功');
  switchTab(tab);
}

// ============================================================
// 新建订单
// ============================================================
async function openNewOrder() {
  const fabricNo = prompt('厂编号（唯一）');
  if (!fabricNo) return;
  const contractNo = prompt('合同号');
  if (!contractNo) return;
  const seqNo = prompt('序号') || '1';
  const poNo = prompt('PO#') || null;
  const customer = prompt('客户') || null;
  const orderDate = prompt('下单日期 YYYY-MM-DD') || null;
  const deliveryDate = prompt('合同交期 YYYY-MM-DD') || null;
  const orderQtyY = Number(prompt('合同数量(Y)')) || 0;
  const cn = prompt('溢短装代码 CN（1 或 2）') || '1';
  const ck = Number(prompt('后整理缩率 CK（如 0.05）')) || 0;
  const cm = prompt('消耗代码 CM（1/2/3）') || '1';
  const co = prompt('客户代码 CO（1/2/3）') || '1';
  const sales = prompt('业务员') || null;

  // 建批次
  const { data: batch, error: e1 } = await supabaseClient
    .from('production_batches')
    .insert({ fabric_no: fabricNo, batch_status: 'pending' })
    .select().single();
  if (e1) { alert('建批次失败：' + e1.message); return; }

  // 算 plan_qty_m
  const planQtyM = computePlanQtyM(orderQtyY, cn, ck);

  // 建订单
  const { error: e2 } = await supabaseClient.from('orders').insert({
    batch_id: batch.id,
    contract_no: contractNo,
    seq_no: seqNo,
    po_no: poNo,
    customer,
    order_date: orderDate,
    delivery_date: deliveryDate,
    order_qty_y: orderQtyY,
    plan_qty_m: planQtyM,
    cn, ck, cm, co, sales,
    status: 'pending',
    created_by: currentUserEmail
  });
  if (e2) { alert('建订单失败：' + e2.message); return; }

  await loadOrders();
  renderOrders();
  alert('新建成功');
}

// ============================================================
// 修改历史
// ============================================================
async function loadLogs() {
  const { data } = await supabaseClient
    .from('change_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);

  const html = (data || []).map(l => {
    const color = l.action === 'edit' ? '#fef9c3' : (l.action === 'delete' ? '#fee2e2' : '');
    return `
      <div class="log-row" style="background:${color}">
        <span>${l.created_at}</span>
        <span>${l.table_name}</span>
        <span>${l.action}</span>
        <span>${l.operator || ''}</span>
        <pre>${JSON.stringify(l.changes, null, 2)}</pre>
      </div>
    `;
  }).join('');
  document.getElementById('logsContent').innerHTML = html;
}

// ============================================================
// 基础数据维护
// ============================================================
function switchBaseDataTab(cat) {
  currentBaseDataCategory = cat;
  document.querySelectorAll('#baseDataTabs .tab').forEach(t => {
    t.classList.toggle('active', t.dataset.cat === cat);
  });
  renderBaseData();
}

async function renderBaseData() {
  const showInactive = document.getElementById('showInactive')?.checked || false;
  let query = supabaseClient
    .from('base_data').select('*')
    .eq('category', currentBaseDataCategory)
    .order('key1', { ascending: true });
  if (!showInactive) query = query.eq('is_active', true);

  const { data } = await query;
  const tbody = document.getElementById('baseDataBody');
  tbody.innerHTML = (data || []).map(row => `
    <tr style="${row.is_active ? '' : 'opacity:0.5;'}">
      <td>${row.key1 || ''}</td>
      <td>${row.key2 || ''}</td>
      <td>${row.value ?? ''}</td>
      <td>${row.note || ''}</td>
      <td>${row.is_active ? '✅' : '⛔'}</td>
      <td>
        <button onclick="editBaseData('${row.id}')">编辑</button>
        <button onclick="toggleBaseData('${row.id}', ${!row.is_active})">${row.is_active ? '停用' : '启用'}</button>
      </td>
    </tr>
  `).join('');
}

async function editBaseData(id) {
  const { data: row } = await supabaseClient.from('base_data').select('*').eq('id', id).single();
  const newValue = prompt(`修改 Value（当前：${row.value}）`, row.value);
  if (newValue === null) return;
  const newNote = prompt(`修改备注（当前：${row.note || ''}）`, row.note || '');
  if (newNote === null) return;
  const { error } = await supabaseClient.from('base_data').update({
    value: Number(newValue), note: newNote, updated_at: new Date(), updated_by: currentUserEmail
  }).eq('id', id);
  if (error) { alert('修改失败：' + error.message); return; }
  renderBaseData();
}

async function toggleBaseData(id, isActive) {
  const { error } = await supabaseClient.from('base_data').update({
    is_active: isActive, updated_at: new Date(), updated_by: currentUserEmail
  }).eq('id', id);
  if (error) { alert('操作失败：' + error.message); return; }
  renderBaseData();
}

async function openNewBaseData() {
  const key1 = prompt('Key1');
  if (!key1) return;
  const key2 = prompt('Key2（可空）') || null;
  const value = prompt('Value');
  if (value === null) return;
  const note = prompt('备注（可空）') || null;
  const { error } = await supabaseClient.from('base_data').insert({
    category: currentBaseDataCategory, key1, key2,
    value: Number(value), note, is_active: true,
    created_by: currentUserEmail, updated_by: currentUserEmail
  });
  if (error) { alert('新增失败：' + error.message); return; }
  renderBaseData();
}

// ============================================================
// 启动
// ============================================================
(async () => {
  const { data } = await supabaseClient.auth.getUser();
  if (data?.user) {
    currentUserEmail = data.user.email;
    await loadUserRole();
    showMain(currentUserEmail);
    await loadOrders();
    goToDashboard();
  }
})();