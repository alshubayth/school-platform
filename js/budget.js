import { sb, currentUserId, currentProfile, myBudgetAccess, backToTiles } from './core.js';

document.getElementById('back-to-tiles-13').addEventListener('click', backToTiles);

const STATUS_LABELS = { pending: 'بانتظار الاعتماد', confirmed: 'تم الصرف', rejected: 'مرفوض' };
const STATUS_BADGE = { pending: 'badge-gold', confirmed: 'badge-green', rejected: 'badge-danger' };
const DONUT_COLORS = ['#E8763A', '#1D8FA6', '#5B4B9A', '#1D3F73', '#2E8B4F', '#B3413A', '#93866F'];

let categoriesCache = [];
let barChartInstance = null;
let donutChartInstance = null;

function todayIso() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function fmtDate(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('ar-SA-u-ca-gregory', { day: 'numeric', month: 'numeric', year: 'numeric' });
}
function fmtAmount(n) {
  return Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' ر.س';
}
function accessLevel() {
  if (currentProfile.role === 'admin') return 'full';
  return myBudgetAccess; // 'full' | 'request_only' | null
}

export async function loadBudgetModule() {
  const isAdmin = currentProfile.role === 'admin';
  const level = accessLevel();
  const hasFull = level === 'full';
  const hasAny = level === 'full' || level === 'request_only';

  document.getElementById('budget-perms-section').classList.toggle('hidden', !isAdmin);
  document.getElementById('budget-dashboard-section').classList.toggle('hidden', !hasFull);
  document.getElementById('budget-expense-form-section').classList.toggle('hidden', !hasAny);
  document.getElementById('budget-expenses-title').textContent = hasFull ? 'طلبات وحركات الصرف' : 'طلباتي';

  document.getElementById('budget-exp-date').value = todayIso();
  document.getElementById('budget-rev-date') && (document.getElementById('budget-rev-date').value = todayIso());

  await loadCategories();

  if (isAdmin) await loadPermsSection();
  if (hasFull) await loadDashboard();
  if (hasAny) await loadExpensesList(hasFull);
}

/* ---------- بنود المصروفات ---------- */
async function loadCategories() {
  const { data } = await sb.from('budget_categories').select('id, name').order('name');
  categoriesCache = data || [];

  const expSelect = document.getElementById('budget-exp-category');
  expSelect.innerHTML = categoriesCache.map(c => `<option value="${c.id}">${c.name}</option>`).join('');

  const listEl = document.getElementById('budget-categories-list');
  if (listEl) {
    listEl.innerHTML = '';
    categoriesCache.forEach(c => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex; align-items:center; justify-content:space-between; padding:8px 0; border-bottom:1px solid #ECEAE1; font-size:13px;';
      row.innerHTML = `<span>${c.name}</span>`;
      listEl.appendChild(row);
    });
  }
}

document.getElementById('budget-category-submit').addEventListener('click', async () => {
  const input = document.getElementById('budget-category-name');
  const name = input.value.trim();
  if (!name) return;
  const { error } = await sb.from('budget_categories').insert({ name });
  if (!error) input.value = '';
  await loadCategories();
});

/* ---------- صلاحيات القسم (المدير فقط) ---------- */
async function loadPermsSection() {
  const [{ data: employees }, { data: perms, error: permsError }] = await Promise.all([
    sb.from('profiles').select('id, full_name').in('role', ['deputy', 'teacher']).order('full_name'),
    sb.from('budget_permissions').select('id, profile_id, level, profiles!budget_permissions_profile_id_fkey(full_name)'),
  ]);
  if (permsError) console.error('budget_permissions fetch error:', permsError);

  const grantedIds = new Set((perms || []).map(p => p.profile_id));
  const empSelect = document.getElementById('budget-perm-employee');
  const available = (employees || []).filter(e => !grantedIds.has(e.id));
  empSelect.innerHTML = available.length
    ? available.map(e => `<option value="${e.id}">${e.full_name}</option>`).join('')
    : '<option value="">لا يوجد موظفون متاحون</option>';

  const list = document.getElementById('budget-perms-list');
  list.innerHTML = '';
  if (!perms || perms.length === 0) {
    list.innerHTML = '<div class="placeholder" style="padding:16px;"><p>ما فيه صلاحيات ممنوحة بعد (غير المدير)</p></div>';
    return;
  }
  perms.forEach(p => {
    const row = document.createElement('div');
    row.className = 'emp-row';
    const name = p.profiles ? p.profiles.full_name : '-';
    const initials = (name || '؟').trim().split(' ').slice(0, 2).map(w => w.charAt(0)).join('');
    row.innerHTML = `
      <div class="avatar-circle" style="background:var(--purple-light); color:var(--purple);">${initials}</div>
      <div class="info"><div class="name">${name}</div>
      <div class="title">${p.level === 'full' ? 'صلاحية كاملة (إيرادات + مصروفات + اعتماد)' : 'إضافة طلبات صرف فقط'}</div></div>
      <button class="logout-icon" data-id="${p.id}" title="إلغاء الصلاحية" style="color:var(--danger);">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>
      </button>`;
    row.querySelector('button').addEventListener('click', async (e) => {
      await sb.from('budget_permissions').delete().eq('id', e.currentTarget.dataset.id);
      await loadPermsSection();
    });
    list.appendChild(row);
  });
}

document.getElementById('budget-perm-submit').addEventListener('click', async () => {
  const errEl = document.getElementById('budget-perm-error');
  errEl.style.display = 'none';
  const profileId = document.getElementById('budget-perm-employee').value;
  if (!profileId) { errEl.textContent = 'اختر موظف أولاً'; errEl.style.display = 'block'; return; }
  const level = document.getElementById('budget-perm-level').value;

  const { error } = await sb.from('budget_permissions').insert({ profile_id: profileId, level, granted_by: currentUserId });
  if (error) {
    errEl.textContent = error.message.includes('duplicate') ? 'هذا الموظف عنده صلاحية بالقسم بالفعل — احذفها من القائمة تحت لو تبي تغيّرها' : 'حدث خطأ: ' + error.message;
    errEl.style.display = 'block';
    await loadPermsSection(); // نحدّث القائمة عشان تنعكس الحالة الفعلية بقاعدة البيانات
    return;
  }
  await loadPermsSection();
});

/* ---------- إضافة إيراد ---------- */
document.getElementById('budget-rev-submit').addEventListener('click', async () => {
  const errEl = document.getElementById('budget-rev-error');
  errEl.style.display = 'none';
  const desc = document.getElementById('budget-rev-desc').value.trim();
  const amount = parseFloat(document.getElementById('budget-rev-amount').value);
  const date = document.getElementById('budget-rev-date').value || todayIso();
  const notes = document.getElementById('budget-rev-notes').value.trim();

  if (!desc) { errEl.textContent = 'اكتب وصف الإيراد'; errEl.style.display = 'block'; return; }
  if (!amount || amount <= 0) { errEl.textContent = 'أدخل مبلغ صحيح'; errEl.style.display = 'block'; return; }

  const { error } = await sb.from('budget_revenues').insert({
    description: desc, amount, revenue_date: date, notes: notes || null, created_by: currentUserId,
  });
  if (error) { errEl.textContent = 'تعذر الحفظ: ' + error.message; errEl.style.display = 'block'; return; }

  document.getElementById('budget-rev-desc').value = '';
  document.getElementById('budget-rev-amount').value = '';
  document.getElementById('budget-rev-notes').value = '';
  document.getElementById('budget-rev-date').value = todayIso();
  await loadDashboard();
  await loadExpensesList(true);
});

/* ---------- تقديم طلب صرف ---------- */
document.getElementById('budget-exp-submit').addEventListener('click', async () => {
  const errEl = document.getElementById('budget-exp-error');
  errEl.style.display = 'none';
  const categoryId = document.getElementById('budget-exp-category').value;
  const amount = parseFloat(document.getElementById('budget-exp-amount').value);
  const paidTo = document.getElementById('budget-exp-paidto').value.trim();
  const date = document.getElementById('budget-exp-date').value || todayIso();
  const purpose = document.getElementById('budget-exp-purpose').value.trim();

  if (!categoryId) { errEl.textContent = 'اختر بند المصروف'; errEl.style.display = 'block'; return; }
  if (!amount || amount <= 0) { errEl.textContent = 'أدخل مبلغ صحيح'; errEl.style.display = 'block'; return; }
  if (!paidTo) { errEl.textContent = 'اكتب الجهة/الشخص المصروف له'; errEl.style.display = 'block'; return; }
  if (!purpose) { errEl.textContent = 'اكتب الغرض من الصرف'; errEl.style.display = 'block'; return; }

  const { error } = await sb.from('budget_expenses').insert({
    category_id: categoryId, amount, paid_to: paidTo, purpose, expense_date: date,
    requested_by: currentUserId, status: 'pending',
  });
  if (error) { errEl.textContent = 'تعذر الحفظ: ' + error.message; errEl.style.display = 'block'; return; }

  document.getElementById('budget-exp-amount').value = '';
  document.getElementById('budget-exp-paidto').value = '';
  document.getElementById('budget-exp-purpose').value = '';
  document.getElementById('budget-exp-date').value = todayIso();
  await loadExpensesList(accessLevel() === 'full');
});

/* ---------- قائمة طلبات/حركات الصرف ---------- */
async function loadExpensesList(canManage) {
  const container = document.getElementById('budget-expenses-list');
  container.innerHTML = '<div class="placeholder" style="padding:20px;"><p>جارٍ التحميل...</p></div>';

  let query = sb.from('budget_expenses')
    .select('id, amount, paid_to, purpose, expense_date, status, requested_by, budget_categories(name), profiles!budget_expenses_requested_by_fkey(full_name)')
    .order('created_at', { ascending: false });
  if (!canManage) query = query.eq('requested_by', currentUserId);

  const { data } = await query;
  const rows = data || [];

  if (rows.length === 0) {
    container.innerHTML = '<div class="placeholder" style="padding:20px;"><p>ما فيه طلبات صرف بعد</p></div>';
    return;
  }

  container.innerHTML = '';
  rows.forEach(r => {
    const card = document.createElement('div');
    card.className = 'form-card';
    card.style.marginBottom = '10px';
    const catName = r.budget_categories ? r.budget_categories.name : '-';
    const reqName = r.profiles ? r.profiles.full_name : '-';
    card.innerHTML = `
      <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:10px; flex-wrap:wrap;">
        <div style="min-width:0;">
          <div style="font-weight:700; font-size:14px; margin-bottom:4px;">${catName} <span class="badge ${STATUS_BADGE[r.status]}">${STATUS_LABELS[r.status]}</span></div>
          <div style="font-size:12.5px; color:var(--slate);">صرف لـ: ${r.paid_to} — الغرض: ${r.purpose}</div>
          ${canManage ? `<div style="font-size:11.5px; color:var(--slate); margin-top:4px;">مقدّم الطلب: ${reqName} — ${fmtDate(r.expense_date)}</div>` : `<div style="font-size:11.5px; color:var(--slate); margin-top:4px;">${fmtDate(r.expense_date)}</div>`}
        </div>
        <div style="text-align:left; flex-shrink:0;">
          <div style="font-weight:800; font-family:'Tajawal'; font-size:16px; color:var(--danger);">${fmtAmount(r.amount)}</div>
        </div>
      </div>`;

    if (canManage && r.status === 'pending') {
      const actions = document.createElement('div');
      actions.style.cssText = 'display:flex; gap:8px; margin-top:12px;';
      actions.innerHTML = `
        <button class="btn-primary confirm-btn" style="width:auto; padding:8px 16px; background:var(--green);">تأكيد الصرف</button>
        <button class="btn-primary reject-btn" style="width:auto; padding:8px 16px; background:var(--danger);">رفض</button>`;
      actions.querySelector('.confirm-btn').addEventListener('click', () => updateExpenseStatus(r.id, 'confirmed'));
      actions.querySelector('.reject-btn').addEventListener('click', () => updateExpenseStatus(r.id, 'rejected'));
      card.appendChild(actions);
    }
    container.appendChild(card);
  });
}

async function updateExpenseStatus(id, status) {
  if (status === 'rejected' && !confirm('متأكد تبي ترفض طلب الصرف هذا؟')) return;
  await sb.from('budget_expenses').update({
    status, confirmed_by: currentUserId, confirmed_at: new Date().toISOString(),
  }).eq('id', id);
  await loadDashboard();
  await loadExpensesList(true);
}

/* ---------- لوحة الإحصائيات والرسوم البيانية ---------- */
function statCard(label, value, color, sub) {
  return `<div class="stat-card">
    <div class="label">${label}</div>
    <div class="value" style="color:${color || 'var(--ink)'};">${value}</div>
    ${sub ? `<div style="font-size:11px; color:${color || 'var(--slate)'}; margin-top:4px; font-weight:600;">${sub}</div>` : ''}
  </div>`;
}

async function loadDashboard() {
  const statsEl = document.getElementById('budget-stats');
  statsEl.innerHTML = '<div class="placeholder" style="padding:20px; grid-column:1/-1;"><p>جارٍ التحميل...</p></div>';

  const [{ data: revenues }, { data: expenses }] = await Promise.all([
    sb.from('budget_revenues').select('amount, revenue_date'),
    sb.from('budget_expenses').select('amount, expense_date, status, category_id, budget_categories(name)').eq('status', 'confirmed'),
  ]);

  const revList = revenues || [];
  const expList = expenses || [];

  const totalRevenue = revList.reduce((s, r) => s + Number(r.amount), 0);
  const totalExpense = expList.reduce((s, e) => s + Number(e.amount), 0);
  const balance = totalRevenue - totalExpense;

  const byCategory = new Map();
  expList.forEach(e => {
    const name = e.budget_categories ? e.budget_categories.name : 'غير مصنّف';
    byCategory.set(name, (byCategory.get(name) || 0) + Number(e.amount));
  });
  let topCategory = '-', topAmount = 0;
  byCategory.forEach((amt, name) => { if (amt > topAmount) { topAmount = amt; topCategory = name; } });
  const topPct = totalExpense ? Math.round(topAmount / totalExpense * 100) : 0;

  statsEl.innerHTML =
    statCard('إجمالي الإيرادات', fmtAmount(totalRevenue), 'var(--green)') +
    statCard('إجمالي المصروفات (المعتمدة)', fmtAmount(totalExpense), 'var(--danger)') +
    statCard('الرصيد الحالي', fmtAmount(balance), 'var(--meadow)') +
    statCard('أكبر بند صرف', topCategory, 'var(--ink)', topAmount ? `${fmtAmount(topAmount)} (${topPct}%)` : null);

  await loadCharts(revList, expList, byCategory);
}

let chartLibPromise = null;
function loadChartLib() {
  if (window.Chart) return Promise.resolve();
  if (chartLibPromise) return chartLibPromise;
  chartLibPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js';
    s.onload = resolve;
    s.onerror = () => { chartLibPromise = null; reject(new Error('تعذر تحميل مكتبة الرسوم البيانية')); };
    document.head.appendChild(s);
  });
  return chartLibPromise;
}

function monthLabel(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('ar-SA-u-ca-gregory', { month: 'short', year: '2-digit' });
}

async function loadCharts(revList, expList, byCategory) {
  try {
    await loadChartLib();
  } catch (e) {
    return; // ما فيه اتصال بالإنترنت أو فشل تحميل المكتبة - نتجاهل الرسوم ونكتفي بالبطاقات
  }

  const monthMap = new Map(); // key: 'YYYY-MM' -> {label, rev, exp}
  revList.forEach(r => {
    const key = r.revenue_date.slice(0, 7);
    if (!monthMap.has(key)) monthMap.set(key, { label: monthLabel(r.revenue_date), rev: 0, exp: 0 });
    monthMap.get(key).rev += Number(r.amount);
  });
  expList.forEach(e => {
    const key = e.expense_date.slice(0, 7);
    if (!monthMap.has(key)) monthMap.set(key, { label: monthLabel(e.expense_date), rev: 0, exp: 0 });
    monthMap.get(key).exp += Number(e.amount);
  });
  const monthKeys = Array.from(monthMap.keys()).sort();
  const monthLabels = monthKeys.map(k => monthMap.get(k).label);
  const monthRev = monthKeys.map(k => monthMap.get(k).rev);
  const monthExp = monthKeys.map(k => monthMap.get(k).exp);

  const barCtx = document.getElementById('budget-bar-chart');
  if (barChartInstance) barChartInstance.destroy();
  barChartInstance = new Chart(barCtx, {
    type: 'bar',
    data: {
      labels: monthLabels.length ? monthLabels : ['لا توجد بيانات'],
      datasets: [
        { label: 'إيرادات', data: monthRev.length ? monthRev : [0], backgroundColor: '#1D3F73', borderRadius: 6, maxBarThickness: 26 },
        { label: 'مصروفات', data: monthExp.length ? monthExp : [0], backgroundColor: '#B3413A', borderRadius: 6, maxBarThickness: 26 },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { position: 'bottom', labels: { font: { family: 'IBM Plex Sans Arabic' }, usePointStyle: true } } },
      scales: {
        x: { grid: { display: false }, ticks: { font: { family: 'IBM Plex Sans Arabic', size: 11 } } },
        y: { grid: { color: '#F1EFE7' }, ticks: { font: { family: 'IBM Plex Sans Arabic', size: 11 } } },
      },
    },
  });

  const catLabels = Array.from(byCategory.keys());
  const catData = Array.from(byCategory.values());
  const catColors = catLabels.map((_, i) => DONUT_COLORS[i % DONUT_COLORS.length]);

  const donutCtx = document.getElementById('budget-donut-chart');
  if (donutChartInstance) donutChartInstance.destroy();
  donutChartInstance = new Chart(donutCtx, {
    type: 'doughnut',
    data: { labels: catLabels.length ? catLabels : ['لا توجد مصروفات معتمدة بعد'], datasets: [{ data: catData.length ? catData : [1], backgroundColor: catData.length ? catColors : ['#E3E1D8'], borderWidth: 0 }] },
    options: { responsive: true, cutout: '68%', plugins: { legend: { display: false } } },
  });

  const legendWrap = document.getElementById('budget-donut-legend');
  legendWrap.innerHTML = '';
  const total = catData.reduce((a, b) => a + b, 0);
  catLabels.forEach((l, i) => {
    const pct = total ? Math.round(catData[i] / total * 100) : 0;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; align-items:center; gap:8px; font-size:12.5px; margin-top:6px;';
    row.innerHTML = `<span style="width:9px; height:9px; border-radius:50%; flex-shrink:0; background:${catColors[i]};"></span><span style="flex:1;">${l}</span><span style="color:var(--slate);">${pct}%</span>`;
    legendWrap.appendChild(row);
  });
}
