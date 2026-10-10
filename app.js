// ============================================================
// JPTE 生产进度跟踪系统 — app.js
// Supabase: hxgrpamlyujltvghhftf
// ============================================================

const SUPABASE_URL = 'https://hxgrpamlyujltvghhftf.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_fYDSZNCcFJEQwSKha9W5_w_x65TrlIj';
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUserEmail = '';
let currentUserRole = '';
let currentBatchId = null;
let currentOrderIds = [];
let currentTab = 'plan';
let allOrders = [];
let currentBaseDataCategory = 'fg_code';

// 排序状态
let sortKey = 'delivery_date';
let sortDir = 'asc';

// 基础数据缓存
let baseDataCache = {
  daily_output: {},
  customer_code: {},
  weave_code: {},
  sioc_addon: {}
};

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

const PROGRESS_ORDER = ['plan','craft','dyeing','warping','sizing','drawing','weaving','grey','finishing','finished'];

// plan / craft 无 progress_pct，有记录即 100%
const PCT_FIELD = {
  plan: null, craft: null,
  dyeing: 'progress_pct', warping: 'progress_pct', sizing: 'progress_pct',
  drawing: 'progress_pct', weaving: 'progress_pct', grey: 'progress_pct',
  finishing: 'progress_pct', finished: 'progress_pct'
};

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

// 每日产量 VLOOKUP（按纬密）
function getDailyOutput(weftDensity) {
  const v = baseDataCache.daily_output[String(weftDensity)];
  return v != null ? v : null;
}

// 织造天数
function computeWeavingDays(planQtyM, dailyOutput, efficiency) {
  if (!planQtyM || !dailyOutput || !efficiency) return null;
  return Math.ceil(planQtyM / 1.08 / dailyOutput / efficiency);
}

// SIOC 代号
function getSiocSymbol(fgCode) {
  return baseDataCache.sioc_addon[String(fgCode)] || '';
}

// 客户代号
function getCustomerCode(customer) {
  const v = baseDataCache.customer_code[String(customer)];
  return v != null ? v : '';
}

// 组织代码（织法）
function getOrgCode(weave) {
  const v = baseDataCache.weave_code[String(weave)];
  return v != null ? v : '';
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

function fmtDate(d) {
  if (!d) return '';
  return String(d).slice(0, 10);
}

// ============================================================
// 基础数据加载
// ============================================================
async function loadBaseDataCache() {
  const cats = ['daily_output', 'customer_code', 'weave_code', 'sioc_addon'];
  for (const cat of cats) {
    const { data } = await supabaseClient
      .from('base_data').select('key1, value')
      .eq('category', cat).eq('is_active', true);
    baseDataCache[cat] = {};
    (data || []).forEach(r => {
      baseDataCache[cat][String(r.key1)] = Number(r.value);
    });
  }
}

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
    await loadBaseDataCache();
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
  const { data: u } = await supabaseClient.auth.getUser();
  const { data } = await supabaseClient
    .from('user_roles').select('role').eq('user_id', u.user.id).maybeSingle();
  currentUserRole = data?.role || 'viewer';
  document.getElementById('userRole').textContent = currentUserRole;
  document.getElementById('navBaseData').style.display =
    currentUserRole === 'admin' ? '' : 'none';
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
    .forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
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
// 订单列表 — 数据加载
// ============================================================
async function loadOrders() {
  const { data: orders, error } = await supabaseClient
    .from('orders')
    .select('*, production_batches(fabric_no, batch_status)')
    .order('delivery_date', { ascending: true });
  if (error) { console.error(error); return; }
  allOrders = orders || [];

  window._progressMap = {};
  window._fpMap = {};
  if (!allOrders.length) return;

  const batchIds = [...new Set(allOrders.map(o => o.batch_id))];

  for (const [key, table] of Object.entries(PROGRESS_TABLES)) {
    const hasPct = PCT_FIELD[key];
    const sel = hasPct
      ? 'batch_id, plan_date, actual_date, progress_pct'
      : 'batch_id, plan_date, actual_date';
    const { data } = await supabaseClient.from(table).select(sel).in('batch_id', batchIds);
    (data || []).forEach(row => {
      if (!progressMap[row.batch_id]) progressMap[row.batch_id] = {};
      progressMap[row.batch_id][key] = {
        pct: hasPct ? (Number(row.progress_pct) || 0) : 1,
        plan_date: row.plan_date,
        actual_date: row.actual_date
      };
    });
  }
  window._progressMap = progressMap;

  const { data: fps } = await supabaseClient
    .from('finished_progress').select('batch_id, actual_date').in('batch_id', batchIds);
  (fps || []).forEach(fp => { window._fpMap[fp.batch_id] = fp.actual_date; });
}

// ============================================================
// 订单列表 — 排序
// ============================================================
function onSortClick(key) {
  if (sortKey === key) {
    sortDir = sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    sortKey = key;
    sortDir = 'asc';
  }
  renderOrders();
}

function getSortValue(o, key) {
  const p = (window._progressMap || {})[o.batch_id] || {};
  switch (key) {
    case '_dispatch': return computeDispatchCycle(o.order_date, o.delivery_date) ?? -1;
    case '_prod':     return computeProductionCycle(o.order_date, (window._fpMap || {})[o.batch_id]) ?? -1;
    case '_p_plan':     return p.plan?.pct ?? 0;
    case '_p_craft':    return p.craft?.pct ?? 0;
    case '_p_dyeing':   return p.dyeing?.pct ?? 0;
    case '_p_warping':  return p.warping?.pct ?? 0;
    case '_p_sizing':   return p.sizing?.pct ?? 0;
    case '_p_drawing':  return p.drawing?.pct ?? 0;
    case '_p_weaving':  return p.weaving?.pct ?? 0;
    case '_p_grey':     return p.grey?.pct ?? 0;
    case '_p_finishing':return p.finishing?.pct ?? 0;
    case '_p_finished': return p.finished?.pct ?? 0;
    default: {
      const v = o[key];
      return v == null ? '' : v;
    }
  }
}

// ============================================================
// 订单列表 — 渲染
// ============================================================
function renderOrders() {
  const fPO = document.getElementById('filterPO').value.trim().toLowerCase();
  const fContract = document.getElementById('filterContract').value.trim().toLowerCase();
  const fCustomer = document.getElementById('filterCustomer').value.trim().toLowerCase();
  const fSales = document.getElementById('filterSales').value.trim().toLowerCase();
  const fStatus = document.getElementById('filterStatus').value;

  let filtered = allOrders.filter(o => {
    if (fPO && !(o.po_no || '').toLowerCase().includes(fPO)) return false;
    if (fContract && !(o.contract_no || '').toLowerCase().includes(fContract)) return false;
    if (fCustomer && !(o.customer || '').toLowerCase().includes(fCustomer)) return false;
    if (fSales && !(o.sales || '').toLowerCase().includes(fSales)) return false;
    if (fStatus && o.status !== fStatus) return false;
    return true;
  });

  filtered = [...filtered].sort((a, b) => {
    const va = getSortValue(a, sortKey);
    const vb = getSortValue(b, sortKey);
    let cmp = 0;
    if (typeof va === 'number' && typeof vb === 'number') cmp = va - vb;
    else cmp = String(va).localeCompare(String(vb), 'zh');
    return sortDir === 'asc' ? cmp : -cmp;
  });

  document.querySelectorAll('#ordersTable thead th.sortable').forEach(th => {
    const ind = th.querySelector('.sort-ind');
    if (!ind) return;
    if (th.dataset.key === sortKey) {
      ind.textContent = sortDir === 'asc' ? ' ▲' : ' ▼';
      th.classList.add('sorted');
    } else {
      ind.textContent = '';
      th.classList.remove('sorted');
    }
  });

  const progressMap = window._progressMap || {};

  document.getElementById('ordersBody').innerHTML = filtered.map(o => {
    const dispatchCycle = computeDispatchCycle(o.order_date, o.delivery_date);
    const actualFinish = (window._fpMap || {})[o.batch_id];
    const productionCycle = computeProductionCycle(o.order_date, actualFinish);
    const p = progressMap[o.batch_id] || {};

    const progressCells = PROGRESS_ORDER.map(key => {
      const item = p[key] || {};
      return `<td class="stage-cell">${renderStageCell(item)}</td>`;
    }).join('');

    // 溢短装 / SIOC代号 / 客户代号 / 组织代码
    const overshort = o.overshort_transfer != null ? o.overshort_transfer : '';
    const siocSym = o.sioc_symbol || getSiocSymbol(o.sioc_fabric_no);
    const custCode = o.customer_code || getCustomerCode(o.customer);
    const orgCode = o.org_code || getOrgCode(o.weave);

    return `
      <tr>
        <td class="freeze-col col-po">${o.po_no || ''}</td>
        <td class="freeze-col col-contract">${o.contract_no || ''}</td>
        <td class="freeze-col col-seq">${o.seq_no || ''}</td>
        <td>${o.customer || ''}</td>
        <td>${fmtDate(o.order_date)}</td>
        <td>${fmtDate(o.delivery_date)}</td>
        <td>${dispatchCycle ?? '—'}</td>
        <td>${o.sales || ''}</td>
        <td>${o.order_qty_y ?? ''}</td>
        <td>${o.plan_qty_m ?? ''}</td>
        ${progressCells}
        <td>${o.status || ''}</td>
        <td>${productionCycle ?? '—'}</td>
        <td>${overshort}</td>
        <td>${siocSym}</td>
        <td>${custCode}</td>
        <td>${orgCode}</td>
        <td><button onclick="openOrderDetail('${o.batch_id}')">查看</button></td>
      </tr>
    `;
  }).join('');
}

function renderStageCell(item) {
  const pct = item.pct ?? 0;
  const planDate = item.plan_date;
  const actualDate = item.actual_date;

  let delayHtml = '';
  if (planDate && actualDate) {
    const d = Math.round((new Date(actualDate) - new Date(planDate)) / 86400000);
    if (d > 0) delayHtml = `<div class="delay delay-late">延误 +${d}天</div>`;
    else if (d < 0) delayHtml = `<div class="delay delay-early">提前 ${-d}天</div>`;
    else delayHtml = `<div class="delay delay-ontime">准时</div>`;
  } else if (planDate && !actualDate) {
    const today = new Date(); today.setHours(0,0,0,0);
    const pd = new Date(planDate);
    if (pd < today) {
      const d = Math.round((today - pd) / 86400000);
      delayHtml = `<div class="delay delay-late">逾期 ${d}天</div>`;
    }
  }

  const w = Math.round(pct * 100);
  let barCls = 'pct-none', numTxt = '—';
  if (pct >= 1) { barCls = 'pct-done'; numTxt = '100%'; }
  else if (pct > 0) { barCls = 'pct-ing'; numTxt = w + '%'; }

  return `
    <div class="stage-plan">${planDate ? '计划 ' + fmtDate(planDate).slice(5) : ''}</div>
    <div class="stage-actual">${actualDate ? '实际 ' + fmtDate(actualDate).slice(5) : ''}</div>
    ${delayHtml}
    <div class="stage-bar">
      <span class="pct-bar ${barCls}"><span class="pct-fill" style="width:${w}%"></span></span>
      <span class="pct-num">${numTxt}</span>
    </div>
  `;
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

  // 工艺参数
  const yarnWarp = prompt('经纱支数（如 45）') || null;
  const yarnWeft = prompt('纬纱支数（如 12）') || null;
  const warpDensity = Number(prompt('经密（如 120）')) || null;
  const weftDensity = Number(prompt('纬密（如 48）')) || null;
  const weave = prompt('织法（如 PLAIN）') || null;
  const effectiveWidth = Number(prompt('有效门幅（如 56）')) || null;
  const gsm = Number(prompt('克重（如 166）')) || null;
  const composition = prompt('成分') || null;
  const finishMethod = prompt('整理方法') || null;
  const siocFabricNo = prompt('SIOC 面料编号') || null;
  const patternNo = prompt('花型号') || null;
  const color = prompt('颜色') || null;

  const { data: batch, error: e1 } = await supabaseClient
    .from('production_batches')
    .insert({ fabric_no: fabricNo, batch_status: 'pending' })
    .select().single();
  if (e1) { alert('建批次失败：' + e1.message); return; }

  const planQtyM = computePlanQtyM(orderQtyY, cn, ck);

  // 自动算代号
  const siocSymbol = getSiocSymbol(siocFabricNo);
  const customerCode = getCustomerCode(customer);
  const orgCode = getOrgCode(weave);

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
    yarn_warp: yarnWarp,
    yarn_weft: yarnWeft,
    warp_density: warpDensity,
    weft_density: weftDensity,
    weave,
    effective_width: effectiveWidth,
    gsm,
    composition,
    finish_method: finishMethod,
    sioc_fabric_no: siocFabricNo,
    pattern_no: patternNo,
    color,
    sioc_symbol: siocSymbol,
    customer_code: customerCode,
    org_code: orgCode,
    status: 'pending',
    created_by: currentUserEmail
  });
  if (e2) { alert('建订单失败：' + e2.message); return; }

  await loadOrders();
  renderOrders();
  alert('新建成功');
}

// ============================================================
// 订单详情
// ============================================================
async function openOrderDetail(batchId) {
  hideAllPages();
  document.getElementById('orderDetailPage').style.display = '';
  currentBatchId = batchId;

  const { data: batch } = await supabaseClient
    .from('production_batches').select('*').eq('id', batchId).single();
  const { data: orders } = await supabaseClient
    .from('orders').select('*').eq('batch_id', batchId)
    .order('delivery_date', { ascending: true });
  currentOrderIds = (orders || []).map(o => o.id);

  const firstOrder = orders?.[0] || {};
  const { data: fp } = await supabaseClient
    .from('finished_progress').select('actual_date').eq('batch_id', batchId).maybeSingle();

  const productionCycle = computeProductionCycle(firstOrder.order_date, fp?.actual_date);
  const dispatchCycle = computeDispatchCycle(firstOrder.order_date, firstOrder.delivery_date);

  document.getElementById('orderHeader').innerHTML = `
    <h3>厂编号：${batch?.fabric_no || ''}</h3>
    <div>批次状态：${batch?.batch_status || ''}</div>
    <div class="order-meta">
      <div><label>下单日期</label><span>${fmtDate(firstOrder.order_date) || '—'}</span></div>
      <div><label>合同交期</label><span>${fmtDate(firstOrder.delivery_date) || '—'}</span></div>
      <div><label>排单周期</label><span>${dispatchCycle ?? '—'} 天</span></div>
      <div><label>实际完成</label><span>${fmtDate(fp?.actual_date) || '—'}</span></div>
      <div><label>生产周期</label><span>${productionCycle ?? '—'} 天</span></div>
      <div><label>业务员</label><span>${firstOrder.sales || '—'}</span></div>
      <div><label>SIOC代号</label><span>${firstOrder.sioc_symbol || getSiocSymbol(firstOrder.sioc_fabric_no) || '—'}</span></div>
      <div><label>客户代号</label><span>${firstOrder.customer_code || getCustomerCode(firstOrder.customer) || '—'}</span></div>
      <div><label>组织代码</label><span>${firstOrder.org_code || getOrgCode(firstOrder.weave) || '—'}</span></div>
    </div>
    <div class="merged-orders">
      <label>合并合同：</label>
      ${(orders || []).map(o => `<span class="order-tag">${o.contract_no} / 交期 ${fmtDate(o.delivery_date)} / 计划 ${o.plan_qty_m || '—'}M</span>`).join('')}
    </div>
  `;

  switchTab('plan');
}

async function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('#orderDetailPage .tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });

  const table = PROGRESS_TABLES[tab];
  const { data } = await supabaseClient
    .from(table).select('*').eq('batch_id', currentBatchId).maybeSingle();

  const isReadOnly = !canEditTab(tab);
  let html = renderTabForm(tab, data, isReadOnly);

  if (data) {
    if (tab === 'finished') {
      const cum = Number(data.entry_qty_y) || 0;
      const alloc = await allocateToOrders(currentBatchId, cum, 'order_qty_y');
      html += renderAllocation(alloc, 'Y');
    } else if (tab !== 'plan' && tab !== 'craft') {
      const cum = Number(data.cumulative_qty_m) || 0;
      const alloc = await allocateToOrders(currentBatchId, cum, 'plan_qty_m');
      html += renderAllocation(alloc, 'M');
    }
  }

  document.getElementById('tabContent').innerHTML = html;
  // 自动填充公式字段
  await autoFillComputedFields(tab, data);
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

// ============================================================
// 10 Tab 表单字段
// ============================================================
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
      { key: 'feeding_ratio', label: '投产比率', type: 'number', readonly: true },
      { key: 'remark', label: '备注' }
    ],
    craft: [
      ...common,
      { key: 'total_warp', label: '总经根数', type: 'number' },
      { key: 'reed', label: '钢筘' },
      { key: 'craft_reed', label: '工艺筘幅', type: 'number' },
      { key: 'theory_yarn_100m', label: '理论百米用纱量', type: 'number', readonly: true },
      { key: 'chenwen_yarn_100m', label: '陈文百米用纱', type: 'number' },
      { key: 'sioc_yarn_100m', label: 'SIOC百米用纱', type: 'number' },
      { key: 'actual_yarn_100m', label: '实际百米用纱量', type: 'number' },
      { key: 'feeding_ratio_2', label: '投料比例%', type: 'number', readonly: true },
      { key: 'theory_yarn_qty', label: '理论用纱量(KG)', type: 'number', readonly: true },
      { key: 'dye_qty_kg', label: '染色投染量(KG)', type: 'number' },
      { key: 'feeding_ratio_3', label: '投料比例%', type: 'number', readonly: true },
      { key: 'gsm_by_theory', label: '按理论折算克重', type: 'number', readonly: true },
      { key: 'gsm_by_dyeing', label: '按染色折算克重', type: 'number', readonly: true },
      { key: 'actual_gsm', label: '实际面料克重', type: 'number' },
      { key: 'patch_yarn', label: '补纱' },
      { key: 'remark', label: '备注' }
    ],
    dyeing: [
      ...common,
      { key: 'warp_plan_kg', label: '经纱计划数量(KG)', type: 'number' },
      { key: 'weft_plan_kg', label: '纬纱计划数量(KG)', type: 'number' },
      { key: 'supplier', label: '供应商' },
      { key: 'supplier2', label: '供应商2' },
      { key: 'yarn_lot_warp', label: '经纱批号' },
      { key: 'yarn_lot_weft', label: '纬纱批号' },
      { key: 'cumulative_kg', label: '累计完成(KG)', type: 'number' },
      { key: 'shortage_kg', label: '染色欠量(KG)', type: 'number', readonly: true },
      { key: 'progress_pct', label: '完成进度', type: 'number', readonly: true },
      { key: 'remark', label: '备注' }
    ],
    warping: [
      ...common,
      { key: 'craft_length_m', label: '工艺经长', type: 'number' },
      { key: 'cumulative_qty_m', label: '累计完成(米)', type: 'number' },
      { key: 'beam_count', label: '整经轴数', type: 'number' },
      { key: 'shortage_m', label: '整经欠量(米)', type: 'number', readonly: true },
      { key: 'progress_pct', label: '完成进度', type: 'number', readonly: true },
      { key: 'remark', label: '备注' }
    ],
    sizing: [
      ...common,
      { key: 'craft_length_m', label: '工艺浆长', type: 'number' },
      { key: 'cumulative_qty_m', label: '累计完成(米)', type: 'number' },
      { key: 'plan_beam_count', label: '计划轴数', type: 'number' },
      { key: 'actual_beam_count', label: '浆轴数', type: 'number' },
      { key: 'shortage_m', label: '浆纱欠量(米)', type: 'number', readonly: true },
      { key: 'progress_pct', label: '完成进度', type: 'number', readonly: true },
      { key: 'remark', label: '备注' }
    ],
    drawing: [
      ...common,
      { key: 'actual_beam_count', label: '实际轴数', type: 'number' },
      { key: 'cumulative_qty_m', label: '累计完成(米)', type: 'number' },
      { key: 'shortage_m', label: '穿综欠量(米)', type: 'number', readonly: true },
      { key: 'progress_pct', label: '完成进度', type: 'number', readonly: true },
      { key: 'remark', label: '备注' }
    ],
    weaving: [
      ...common,
      { key: 'daily_output_m', label: '每日产量(米)', type: 'number', readonly: true },
      { key: 'plan_beam_count', label: '计划轴数', type: 'number' },
      { key: 'weaving_days', label: '织造天数', type: 'number', readonly: true },
      { key: 'cumulative_qty_m', label: '累计完成(米)', type: 'number' },
      { key: 'shortage_m', label: '织机欠量(米)', type: 'number', readonly: true },
      { key: 'progress_pct', label: '完成进度', type: 'number', readonly: true },
      { key: 'remark', label: '备注' }
    ],
    grey: [
      ...common,
      { key: 'cumulative_qty_m', label: '累计完成(米)', type: 'number' },
      { key: 'shortage_m', label: '坯布欠量(米)', type: 'number', readonly: true },
      { key: 'progress_pct', label: '完成进度', type: 'number', readonly: true },
      { key: 'remark', label: '备注' }
    ],
    finishing: [
      ...common,
      { key: 'cumulative_qty_m', label: '累计完成(米)', type: 'number' },
      { key: 'shortage_m', label: '后整理欠量(米)', type: 'number', readonly: true },
      { key: 'progress_pct', label: '完成进度', type: 'number', readonly: true },
      { key: 'remark', label: '备注' }
    ],
    finished: [
      ...common,
      { key: 'entry_qty_y', label: '入库合计(Y)', type: 'number' },
      { key: 'total_shortage_y', label: '总入库欠量(Y)', type: 'number', readonly: true },
      { key: 'progress_pct', label: '完成进度', type: 'number', readonly: true },
      { key: 'ship_qty_y', label: '出运数量(Y)', type: 'number' },
      { key: 'stock_a', label: 'A级品库存(Y)', type: 'number' },
      { key: 'stock_b', label: 'B级品库存(Y)', type: 'number' },
      { key: 'stock_c', label: 'C级品库存(Y)', type: 'number' },
      { key: 'finishing_loss', label: '后整理损耗', type: 'number' },
      { key: 'remark', label: '备注' }
    ]
  };
  return map[tab] || [];
}

function renderTabForm(tab, data, isReadOnly) {
  const d = data || {};
  const fields = getTabFields(tab);
  let html = `<h3>${TAB_LABELS[tab]}进度</h3>`;
  html += `<div class="form-grid">`;
  for (const f of fields) {
    const v = d[f.key] ?? '';
    const dis = (isReadOnly || f.readonly) ? 'disabled' : '';
    html += `
      <div class="form-item">
        <label>${f.label}</label>
        <input type="${f.type || 'text'}" id="fld_${f.key}" value="${v}" ${dis} oninput="onFieldChange('${tab}')" />
      </div>
    `;
  }
  html += `</div>`;
  if (!isReadOnly) {
    html += `<button onclick="saveProgress('${tab}')">保存</button>`;
  } else {
    html += `<div class="readonly-tip">只读（无权限）</div>`;
  }
  return html;
}

// ============================================================
// 自动填充公式字段
// ============================================================
async function autoFillComputedFields(tab, data) {
  const order = await getFirstOrder();
  const totalPlanM = await getBatchTotalPlanM();
  const totalOrderY = await getBatchTotalOrderY();

  // 计划
  if (tab === 'plan') {
    const plan = Number(document.getElementById('fld_plan_qty_m')?.value) || 0;
    const actual = Number(document.getElementById('fld_actual_qty_m')?.value) || 0;
    const el = document.getElementById('fld_feeding_ratio');
    if (el) el.value = plan ? (actual / plan).toFixed(4) : '';
  }

  // 工艺
  if (tab === 'craft') {
    const totalWarp = Number(document.getElementById('fld_total_warp')?.value) || 0;
    const craftReed = Number(document.getElementById('fld_craft_reed')?.value) || 0;
    const warpCount = parseFloat(order?.yarn_warp) || 0;
    const weftCount = parseFloat(order?.yarn_weft) || 0;
    const weftDensity = parseFloat(order?.weft_density) || 0;
    const theory = computeTheoryYarn100m(totalWarp, warpCount, craftReed, weftDensity, weftCount);
    const elT = document.getElementById('fld_theory_yarn_100m');
    if (elT && theory) elT.value = theory.toFixed(4);

    const elQ = document.getElementById('fld_theory_yarn_qty');
    if (elQ && theory && totalPlanM) elQ.value = (theory * totalPlanM / 100).toFixed(2);

    // 投料比例 2 = 理论用纱量 / 实际投坯
    const elR2 = document.getElementById('fld_feeding_ratio_2');
    if (elR2 && theory) {
      const actual = Number(document.getElementById('fld_actual_yarn_100m')?.value) || 0;
      if (actual) elR2.value = ((theory / actual) * 100).toFixed(2);
    }
    // 投料比例 3 = 染色投染量 / 理论用纱量
    const elR3 = document.getElementById('fld_feeding_ratio_3');
    const dyeQty = Number(document.getElementById('fld_dye_qty_kg')?.value) || 0;
    const theoryQty = Number(document.getElementById('fld_theory_yarn_qty')?.value) || 0;
    if (elR3 && dyeQty && theoryQty) elR3.value = ((dyeQty / theoryQty) * 100).toFixed(2);

    // 按理论折算克重 = 理论用纱量 / 计划数量 * 1000
    const elG1 = document.getElementById('fld_gsm_by_theory');
    if (elG1 && theoryQty && totalPlanM) elG1.value = ((theoryQty / totalPlanM) * 1000).toFixed(2);

    // 按染色折算克重 = 染色投染量 / 计划数量 * 1000
    const elG2 = document.getElementById('fld_gsm_by_dyeing');
    if (elG2 && dyeQty && totalPlanM) elG2.value = ((dyeQty / totalPlanM) * 1000).toFixed(2);
  }

  // 染色
  if (tab === 'dyeing') {
    const warpKg = Number(document.getElementById('fld_warp_plan_kg')?.value) || 0;
    const weftKg = Number(document.getElementById('fld_weft_plan_kg')?.value) || 0;
    const cumKg = Number(document.getElementById('fld_cumulative_kg')?.value) || 0;
    const total = warpKg + weftKg;
    const elS = document.getElementById('fld_shortage_kg');
    const elP = document.getElementById('fld_progress_pct');
    if (elS) elS.value = total ? (total - cumKg).toFixed(2) : '';
    if (elP) elP.value = total ? (cumKg / total).toFixed(4) : '';
  }

  // 整经 / 浆纱 / 穿综 / 织造 / 坯布 / 后整理
  if (['warping','sizing','drawing','weaving','grey','finishing'].includes(tab)) {
    const cum = Number(document.getElementById('fld_cumulative_qty_m')?.value) || 0;
    const elS = document.getElementById('fld_shortage_m');
    const elP = document.getElementById('fld_progress_pct');
    if (elS) elS.value = totalPlanM ? (totalPlanM - cum).toFixed(2) : '';
    if (elP) elP.value = totalPlanM ? (cum / totalPlanM).toFixed(4) : '';
  }

  // 织造：每日产量、织造天数
  if (tab === 'weaving') {
    const weftDensity = order?.weft_density;
    const daily = getDailyOutput(weftDensity);
    const elD = document.getElementById('fld_daily_output_m');
    if (elD && daily) elD.value = daily;

    const planBeams = Number(document.getElementById('fld_plan_beam_count')?.value) || 0;
    const elDays = document.getElementById('fld_weaving_days');
    if (elDays && daily && planBeams) {
      // 织造天数 = ROUNDUP(计划数量 / 每日产量 / 轴数 / 效率, 0)
      const days = computeWeavingDays(totalPlanM, daily, 0.804);
      if (days) elDays.value = days;
    }
  }

  // 成品
  if (tab === 'finished') {
    const cum = Number(document.getElementById('fld_entry_qty_y')?.value) || 0;
    const elS = document.getElementById('fld_total_shortage_y');
    const elP = document.getElementById('fld_progress_pct');
    if (elS) elS.value = totalOrderY ? (totalOrderY - cum).toFixed(2) : '';
    if (elP) elP.value = totalOrderY ? (cum / totalOrderY).toFixed(4) : '';
  }
}

// 输入时实时算
async function onFieldChange(tab) {
  await autoFillComputedFields(tab, null);
}

async function getBatchTotalPlanM() {
  const { data } = await supabaseClient
    .from('orders').select('plan_qty_m').eq('batch_id', currentBatchId);
  return (data || []).reduce((s, o) => s + (Number(o.plan_qty_m) || 0), 0);
}

async function getBatchTotalOrderY() {
  const { data } = await supabaseClient
    .from('orders').select('order_qty_y').eq('batch_id', currentBatchId);
  return (data || []).reduce((s, o) => s + (Number(o.order_qty_y) || 0), 0);
}

async function getFirstOrder() {
  const { data } = await supabaseClient
    .from('orders').select('*').eq('batch_id', currentBatchId)
    .order('delivery_date', { ascending: true }).limit(1).maybeSingle();
  return data;
}

// ============================================================
// 保存进度
// ============================================================
async function saveProgress(tab) {
  const table = PROGRESS_TABLES[tab];
  const fields = getTabFields(tab);
  const payload = { batch_id: currentBatchId, operator: currentUserEmail, updated_at: new Date() };

  for (const f of fields) {
    const el = document.getElementById('fld_' + f.key);
    if (!el) continue;
    let v = el.value;
    if (f.type === 'number') v = v === '' ? null : Number(v);
    if (v === '') v = null;
    payload[f.key] = v;
  }

  if (tab === 'dyeing') {
    const total = (Number(payload.warp_plan_kg) || 0) + (Number(payload.weft_plan_kg) || 0);
    const cumKg = Number(payload.cumulative_kg) || 0;
    payload.shortage_kg = total ? (total - cumKg) : null;
    payload.progress_pct = total ? (cumKg / total) : 0;
  }
  if (['warping','sizing','drawing','weaving','grey','finishing'].includes(tab)) {
    const cum = Number(payload.cumulative_qty_m) || 0;
    const total = await getBatchTotalPlanM();
    payload.progress_pct = total ? (cum / total) : 0;
    payload.shortage_m = total ? (total - cum) : null;
  }
  if (tab === 'finished') {
    const cum = Number(payload.entry_qty_y) || 0;
    const total = await getBatchTotalOrderY();
    payload.progress_pct = total ? (cum / total) : 0;
    payload.total_shortage_y = total ? (total - cum) : null;
  }
  if (tab === 'plan') {
    const plan = Number(payload.plan_qty_m) || 0;
    const actual = Number(payload.actual_qty_m) || 0;
    payload.feeding_ratio = plan ? (actual / plan) : 0;
  }
  if (tab === 'craft') {
    const order = await getFirstOrder();
    const warpCount = parseFloat(order?.yarn_warp) || 0;
    const weftCount = parseFloat(order?.yarn_weft) || 0;
    const weftDensity = parseFloat(order?.weft_density) || 0;
    if (!payload.theory_yarn_100m) {
      const t = computeTheoryYarn100m(
        Number(payload.total_warp) || 0, warpCount,
        Number(payload.craft_reed) || 0, weftDensity, weftCount
      );
      if (t) payload.theory_yarn_100m = t;
    }
    const planM = await getBatchTotalPlanM();
    if (payload.theory_yarn_100m && planM) {
      payload.theory_yarn_qty = payload.theory_yarn_100m * planM / 100;
    }
    // 投料比例 2/3
    if (payload.theory_yarn_100m && payload.actual_yarn_100m) {
      payload.feeding_ratio_2 = (payload.theory_yarn_100m / payload.actual_yarn_100m) * 100;
    }
    if (payload.dye_qty_kg && payload.theory_yarn_qty) {
      payload.feeding_ratio_3 = (payload.dye_qty_kg / payload.theory_yarn_qty) * 100;
    }
    if (payload.theory_yarn_qty && planM) {
      payload.gsm_by_theory = (payload.theory_yarn_qty / planM) * 1000;
    }
    if (payload.dye_qty_kg && planM) {
      payload.gsm_by_dyeing = (payload.dye_qty_kg / planM) * 1000;
    }
  }
  if (tab === 'weaving') {
    const order = await getFirstOrder();
    const daily = getDailyOutput(order?.weft_density);
    if (daily) payload.daily_output_m = daily;
    if (daily) payload.weaving_days = computeWeavingDays(await getBatchTotalPlanM(), daily, 0.804);
  }

  const { data: existing } = await supabaseClient
    .from(table).select('*').eq('batch_id', currentBatchId).maybeSingle();

  let error;
  if (existing) {
    ({ error } = await supabaseClient.from(table).update(payload).eq('id', existing.id));
  } else {
    ({ error } = await supabaseClient.from(table).insert(payload));
  }
  if (error) { alert('保存失败：' + error.message); return; }

  const changes = [];
  for (const k of Object.keys(payload)) {
    if (k === 'batch_id' || k === 'operator' || k === 'updated_at') continue;
    const oldV = existing ? existing[k] : null;
    const newV = payload[k];
    if (String(oldV ?? '') !== String(newV ?? '')) {
      changes.push({ field: k, old: oldV, new: newV });
    }
  }

  await supabaseClient.from('change_log').insert({
    table_name: table,
    record_id: existing?.id || null,
    batch_id: currentBatchId,
    action: existing ? 'edit' : 'add',
    changes: changes,
    operator: currentUserEmail
  });

  await computeBatchStatus(currentBatchId);
  alert('保存成功');
  await loadOrders();
  switchTab(tab);
}

// ============================================================
// 拆分
// ============================================================
async function allocateToOrders(batchId, cumulativeQty, targetField = 'plan_qty_m') {
  const { data: orders } = await supabaseClient
    .from('orders')
    .select('id, contract_no, seq_no, delivery_date, order_qty_y, plan_qty_m')
    .eq('batch_id', batchId)
    .order('delivery_date', { ascending: true });

  let remaining = cumulativeQty;
  const allocation = [];
  for (const order of orders || []) {
    const target = Number(order[targetField]) || 0;
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
              <td>${fmtDate(a.delivery_date)}</td>
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
// 修改历史
// ============================================================
async function loadLogs() {
  const { data } = await supabaseClient
    .from('change_log').select('*')
    .order('created_at', { ascending: false }).limit(200);

  document.getElementById('logsContent').innerHTML = (data || []).map(l => {
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

  document.getElementById('baseDataBody').innerHTML = (data || []).map(row => `
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
  await loadBaseDataCache();
  renderBaseData();
}

async function toggleBaseData(id, isActive) {
  const { error } = await supabaseClient.from('base_data').update({
    is_active: isActive, updated_at: new Date(), updated_by: currentUserEmail  }).eq('id', id);
  if (error) { alert('操作失败：' + error.message); return; }
  await loadBaseDataCache();
  renderBaseData();
}

async function openNewBaseData() {
  const key1 = prompt('Key1'); if (!key1) return;
  const key2 = prompt('Key2（可空）') || null;
  const value = prompt('Value'); if (value === null) return;
  const note = prompt('备注（可空）') || null;
  const { error } = await supabaseClient.from('base_data').insert({
    category: currentBaseDataCategory, key1, key2,
    value: Number(value), note, is_active: true,
    created_by: currentUserEmail, updated_by: currentUserEmail
  });
  if (error) { alert('新增失败：' + error.message); return; }
  await loadBaseDataCache();
  renderBaseData();
}

// ============================================================
// 看板
// ============================================================
function renderDashboard() {
  const total = allOrders.length;
  const pending = allOrders.filter(o => o.status === 'pending').length;
  const inProgress = allOrders.filter(o => o.status === 'in_progress').length;
  const completed = allOrders.filter(o => o.status === 'completed').length;

  document.getElementById('dashboardCards').innerHTML = `
    <div class="card"><div class="num">${total}</div><div class="lbl">总订单数</div></div>
    <div class="card"><div class="num">${pending}</div><div class="lbl">待处理</div></div>
    <div class="card"><div class="num">${inProgress}</div><div class="lbl">进行中</div></div>
    <div class="card"><div class="num">${completed}</div><div class="lbl">已完成</div></div>
  `;
}

// ============================================================
// 绑定排序点击事件
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('#ordersTable thead th.sortable').forEach(th => {
    th.addEventListener('click', () => onSortClick(th.dataset.key));
    th.style.cursor = 'pointer';
  });
});

// ============================================================
// 启动
// ============================================================
(async () => {
  const { data } = await supabaseClient.auth.getUser();
  if (data?.user) {
    currentUserEmail = data.user.email;
    await loadUserRole();
    await loadBaseDataCache();
    showMain(currentUserEmail);
    await loadOrders();
    goToDashboard();
  }
})();