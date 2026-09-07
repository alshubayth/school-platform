import { sb, currentUserId, currentProfile, myBudgetAccess, backToTiles } from './core.js';

document.getElementById('back-to-tiles-13').addEventListener('click', backToTiles);

const STATUS_LABELS = { pending: 'بانتظار الاعتماد', confirmed: 'تم الصرف', rejected: 'مرفوض' };
const STATUS_BADGE = { pending: 'badge-gold', confirmed: 'badge-green', rejected: 'badge-danger' };
const DONUT_COLORS = ['#E8763A', '#1D8FA6', '#5B4B9A', '#1D3F73', '#2E8B4F', '#B3413A', '#93866F'];
const SEMESTERS = ['الفصل الدراسي الأول', 'الفصل الدراسي الثاني'];
const BENEFICIARY_ROLES = ['admin', 'deputy', 'teacher'];

let categoriesCache = [];
let barChartInstance = null;
let donutChartInstance = null;

function todayIso() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function fmtDate(iso) {
  if (!iso) return '-';
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
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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

  resetExpenseForm();

  await loadCategories();
  if (hasAny) await loadBeneficiaries();

  if (isAdmin) await loadPermsSection();
  if (hasFull) await loadShareSection();
  if (hasFull) await loadDashboard();
  if (hasAny) await loadExpensesList(hasFull);
}

document.getElementById('budget-semester-filter').addEventListener('change', () => {
  if (accessLevel() === 'full') loadDashboard();
});

/* ---------- قائمة الموظفين لحقل "يُصرف لـ" ---------- */
async function loadBeneficiaries() {
  const sel = document.getElementById('budget-exp-beneficiary');
  if (!sel) return;
  const { data } = await sb.from('profiles').select('id, full_name').in('role', BENEFICIARY_ROLES).order('full_name');
  const employees = data || [];
  sel.innerHTML = '<option value="">يُصرف لـ (اختر الموظف)...</option>' +
    employees.map(e => `<option value="${esc(e.full_name)}">${esc(e.full_name)}</option>`).join('');
}

/* ---------- بنود المصروفات (الاختيارية - للتصنيف/الرسم البياني) ---------- */
async function loadCategories() {
  const { data } = await sb.from('budget_categories').select('id, name, cap_percentage').order('name');
  categoriesCache = data || [];

  const expSelect = document.getElementById('budget-exp-category');
  expSelect.innerHTML = '<option value="">اختر البند...</option>' +
    categoriesCache.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');

  const listEl = document.getElementById('budget-categories-list');
  if (listEl) {
    listEl.innerHTML = '';
    categoriesCache.forEach(c => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:8px; padding:8px 0; border-bottom:1px solid #ECEAE1; font-size:13px;';
      row.innerHTML = `<span style="flex:1;">${esc(c.name)}</span>
        <span style="display:flex; align-items:center; gap:4px; color:var(--slate);">
          <input type="number" class="cat-cap-input" data-id="${c.id}" min="0" max="100" step="0.5" value="${c.cap_percentage != null ? c.cap_percentage : ''}" placeholder="بلا سقف" style="width:78px; margin:0; padding:5px 6px; font-size:12px;" title="سقف الصرف (% من إجمالي الإيراد)" />
          <span style="font-size:11px;">%</span>
        </span>
        <button type="button" class="cat-delete-btn" data-id="${c.id}" title="حذف البند" style="border:none; background:none; color:var(--danger); cursor:pointer; font-size:14px; padding:2px 6px;">✕</button>`;
      row.querySelector('.cat-cap-input').addEventListener('change', async (e) => {
        const raw = e.currentTarget.value.trim();
        const val = raw === '' ? null : Math.max(0, Math.min(100, parseFloat(raw)));
        const { error } = await sb.from('budget_categories').update({ cap_percentage: val }).eq('id', c.id);
        if (error) {
          alert('تعذر حفظ السقف: ' + error.message);
          return;
        }
        await loadCategories();
        if (accessLevel() === 'full') await loadDashboard();
      });
      row.querySelector('.cat-delete-btn').addEventListener('click', async () => {
        if (!confirm(`متأكد تبي تحذف بند "${c.name}"؟ الطلبات السابقة المرتبطة به بتصير بدون بند.`)) return;
        const { error } = await sb.from('budget_categories').delete().eq('id', c.id);
        if (error) {
          alert('تعذر حذف البند: ' + error.message);
          return;
        }
        await loadCategories();
        if (accessLevel() === 'full') await loadDashboard();
      });
      listEl.appendChild(row);
    });
  }
}

document.getElementById('budget-category-submit').addEventListener('click', async () => {
  const input = document.getElementById('budget-category-name');
  const capInput = document.getElementById('budget-category-cap');
  const name = input.value.trim();
  if (!name) return;
  const capRaw = capInput ? capInput.value.trim() : '';
  const cap_percentage = capRaw === '' ? null : Math.max(0, Math.min(100, parseFloat(capRaw)));
  const { error } = await sb.from('budget_categories').insert({ name, cap_percentage });
  if (!error) {
    input.value = '';
    if (capInput) capInput.value = '';
  }
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
    ? available.map(e => `<option value="${e.id}">${esc(e.full_name)}</option>`).join('')
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
      <div class="avatar-circle" style="background:var(--purple-light); color:var(--purple);">${esc(initials)}</div>
      <div class="info"><div class="name">${esc(name)}</div>
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
  const semester = document.getElementById('budget-rev-semester').value;
  const notes = document.getElementById('budget-rev-notes').value.trim();

  if (!desc) { errEl.textContent = 'اكتب وصف الإيراد'; errEl.style.display = 'block'; return; }
  if (!amount || amount <= 0) { errEl.textContent = 'أدخل مبلغ صحيح'; errEl.style.display = 'block'; return; }
  if (!semester) { errEl.textContent = 'اختر الفصل الدراسي'; errEl.style.display = 'block'; return; }

  const { error } = await sb.from('budget_revenues').insert({
    description: desc, amount, revenue_date: date, semester, notes: notes || null, created_by: currentUserId,
  });
  if (error) { errEl.textContent = 'تعذر الحفظ: ' + error.message; errEl.style.display = 'block'; return; }

  document.getElementById('budget-rev-desc').value = '';
  document.getElementById('budget-rev-amount').value = '';
  document.getElementById('budget-rev-notes').value = '';
  document.getElementById('budget-rev-date').value = todayIso();
  document.getElementById('budget-rev-semester').value = '';
  await loadDashboard();
  await loadExpensesList(true);
});

/* ---------- جهة الصرف: إظهار حقل "أخرى" عند الحاجة ---------- */
document.getElementById('budget-exp-source').addEventListener('change', (e) => {
  document.getElementById('budget-exp-source-other').style.display = e.target.value === 'أخرى' ? 'block' : 'none';
});

/* ---------- سطور الفواتير (فاتورة أو أكثر لكل طلب صرف) ---------- */
function addExpenseItemRow() {
  const wrap = document.getElementById('budget-exp-items');
  const row = document.createElement('div');
  row.className = 'budget-item-row';
  row.style.cssText = 'display:flex; flex-wrap:wrap; gap:8px; align-items:center; background:var(--white); border:1px solid #ECEAE1; border-radius:10px; padding:10px; margin-bottom:8px;';
  row.innerHTML = `
    <input type="text" class="item-invoice-number" placeholder="رقم الفاتورة" style="flex:1 1 110px; min-width:100px;" />
    <input type="date" class="item-invoice-date" style="flex:1 1 130px; min-width:120px;" />
    <input type="text" class="item-source" placeholder="مصدرها" style="flex:1 1 120px; min-width:110px;" />
    <input type="text" class="item-description" placeholder="البيان" style="flex:2 1 160px; min-width:140px;" />
    <input type="number" class="item-amount" placeholder="المبلغ" style="flex:1 1 100px; min-width:90px;" />
    <button type="button" class="item-remove" title="حذف الفاتورة" style="flex:0 0 auto; width:30px; height:30px; border-radius:50%; border:none; background:var(--danger-light); color:var(--danger); font-size:14px; cursor:pointer;">✕</button>
  `;
  row.querySelector('.item-amount').addEventListener('input', recalcExpenseTotal);
  row.querySelector('.item-remove').addEventListener('click', () => {
    row.remove();
    recalcExpenseTotal();
  });
  wrap.appendChild(row);
}

function recalcExpenseTotal() {
  const rows = document.querySelectorAll('#budget-exp-items .budget-item-row');
  let total = 0;
  rows.forEach(r => { total += parseFloat(r.querySelector('.item-amount').value) || 0; });
  document.getElementById('budget-exp-total').textContent = fmtAmount(total);
}

function collectExpenseItems() {
  const rows = document.querySelectorAll('#budget-exp-items .budget-item-row');
  const items = [];
  rows.forEach((r, i) => {
    const amount = parseFloat(r.querySelector('.item-amount').value);
    const description = r.querySelector('.item-description').value.trim();
    if (!amount && !description) return; // صف فارغ بالكامل - تجاهله
    items.push({
      invoice_number: r.querySelector('.item-invoice-number').value.trim() || null,
      invoice_date: r.querySelector('.item-invoice-date').value || null,
      source: r.querySelector('.item-source').value.trim() || null,
      description,
      amount,
      sort_order: i,
    });
  });
  return items;
}

function resetExpenseForm() {
  document.getElementById('budget-exp-category').value = '';
  document.getElementById('budget-exp-source').value = '';
  document.getElementById('budget-exp-source-other').value = '';
  document.getElementById('budget-exp-source-other').style.display = 'none';
  document.getElementById('budget-exp-beneficiary').value = '';
  document.getElementById('budget-exp-semester').value = '';
  document.getElementById('budget-exp-date').value = todayIso();
  document.getElementById('budget-exp-items').innerHTML = '';
  addExpenseItemRow();
  recalcExpenseTotal();
}

document.getElementById('budget-exp-add-item').addEventListener('click', addExpenseItemRow);

/* ---------- تقديم طلب صرف (بيان صرف) ---------- */
document.getElementById('budget-exp-submit').addEventListener('click', async () => {
  const errEl = document.getElementById('budget-exp-error');
  errEl.style.display = 'none';

  const categoryId = document.getElementById('budget-exp-category').value || null;
  const beneficiary = document.getElementById('budget-exp-beneficiary').value;
  const source = document.getElementById('budget-exp-source').value;
  const sourceOther = document.getElementById('budget-exp-source-other').value.trim();
  const semester = document.getElementById('budget-exp-semester').value;
  const date = document.getElementById('budget-exp-date').value || todayIso();
  const items = collectExpenseItems();

  if (!categoryId) { errEl.textContent = 'اختر البند'; errEl.style.display = 'block'; return; }
  if (!beneficiary) { errEl.textContent = 'اختر الموظف (يُصرف لـ)'; errEl.style.display = 'block'; return; }
  if (!source) { errEl.textContent = 'اختر جهة الصرف'; errEl.style.display = 'block'; return; }
  if (source === 'أخرى' && !sourceOther) { errEl.textContent = 'اكتب جهة الصرف'; errEl.style.display = 'block'; return; }
  if (!semester) { errEl.textContent = 'اختر الفصل الدراسي'; errEl.style.display = 'block'; return; }
  if (items.length === 0) { errEl.textContent = 'أضف فاتورة واحدة على الأقل'; errEl.style.display = 'block'; return; }
  for (const it of items) {
    if (!it.description) { errEl.textContent = 'اكتب البيان لكل فاتورة'; errEl.style.display = 'block'; return; }
    if (!it.amount || it.amount <= 0) { errEl.textContent = 'أدخل مبلغ صحيح لكل فاتورة'; errEl.style.display = 'block'; return; }
  }

  const { data: inserted, error } = await sb.from('budget_expense_requests').insert({
    category_id: categoryId,
    beneficiary_name: beneficiary,
    funding_source: source,
    funding_source_other: source === 'أخرى' ? sourceOther : null,
    semester: semester || null,
    request_date: date,
    requested_by: currentUserId,
    status: 'pending',
  }).select().single();

  if (error) { errEl.textContent = 'تعذر الحفظ: ' + error.message; errEl.style.display = 'block'; return; }

  const requestId = inserted.id;
  const { error: itemsError } = await sb.from('budget_expense_items').insert(
    items.map(it => ({ ...it, request_id: requestId }))
  );
  if (itemsError) { errEl.textContent = 'تعذر حفظ الفواتير: ' + itemsError.message; errEl.style.display = 'block'; return; }

  resetExpenseForm();
  await loadExpensesList(accessLevel() === 'full');
});

/* ---------- قائمة طلبات/حركات الصرف ---------- */
async function loadExpensesList(canManage) {
  const container = document.getElementById('budget-expenses-list');
  container.innerHTML = '<div class="placeholder" style="padding:20px;"><p>جارٍ التحميل...</p></div>';

  let query = sb.from('budget_expense_requests')
    .select(`id, statement_number, beneficiary_name, funding_source, funding_source_other,
      semester, request_date, status, requested_by, confirmed_by, confirmed_at,
      budget_categories(name),
      requester:profiles!budget_expense_requests_requested_by_fkey(full_name),
      confirmer:profiles!budget_expense_requests_confirmed_by_fkey(full_name),
      budget_expense_items(id, invoice_number, invoice_date, source, description, amount, sort_order)`)
    .order('created_at', { ascending: false });
  if (!canManage) query = query.eq('requested_by', currentUserId);

  const { data, error } = await query;
  if (error) console.error('budget_expense_requests fetch error:', error);
  const rows = data || [];

  if (rows.length === 0) {
    container.innerHTML = '<div class="placeholder" style="padding:20px;"><p>ما فيه طلبات صرف بعد</p></div>';
    return;
  }

  container.innerHTML = '';
  rows.forEach(r => {
    const items = (r.budget_expense_items || []).slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    const total = items.reduce((s, it) => s + Number(it.amount || 0), 0);
    const catName = r.budget_categories ? r.budget_categories.name : 'بدون بند';
    const reqName = r.requester ? r.requester.full_name : '-';

    const card = document.createElement('div');
    card.className = 'form-card';
    card.style.marginBottom = '10px';
    card.innerHTML = `
      <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:10px; flex-wrap:wrap;">
        <div style="min-width:0;">
          <div style="font-weight:700; font-size:14px; margin-bottom:4px;">
            بيان رقم ${r.statement_number} — ${esc(catName)}
            <span class="badge ${STATUS_BADGE[r.status]}">${STATUS_LABELS[r.status]}</span>
          </div>
          <div style="font-size:12.5px; color:var(--slate);">
            يُصرف لـ: ${esc(r.beneficiary_name)} — جهة الصرف: ${esc(r.funding_source === 'أخرى' ? (r.funding_source_other || 'أخرى') : r.funding_source)}
          </div>
          <div style="font-size:11.5px; color:var(--slate); margin-top:4px;">
            ${canManage ? `مقدّم الطلب: ${esc(reqName)} — ` : ''}${fmtDate(r.request_date)} — ${items.length} فاتورة/فواتير${r.semester ? ` — ${esc(r.semester)}` : ''}
          </div>
        </div>
        <div style="text-align:left; flex-shrink:0;">
          <div style="font-weight:800; font-family:'Tajawal'; font-size:16px; color:var(--danger);">${fmtAmount(total)}</div>
        </div>
      </div>`;

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex; gap:8px; margin-top:12px; flex-wrap:wrap;';
    const printBtn = document.createElement('button');
    printBtn.className = 'btn-primary';
    printBtn.style.cssText = 'width:auto; padding:8px 16px; background:var(--meadow);';
    printBtn.textContent = 'طباعة السند';
    printBtn.addEventListener('click', () => printVoucher(r, items, total));
    actions.appendChild(printBtn);

    if (canManage && r.status === 'pending') {
      const confirmBtn = document.createElement('button');
      confirmBtn.className = 'btn-primary';
      confirmBtn.style.cssText = 'width:auto; padding:8px 16px; background:var(--green);';
      confirmBtn.textContent = 'تأكيد الصرف';
      confirmBtn.addEventListener('click', () => updateExpenseStatus(r.id, 'confirmed'));
      const rejectBtn = document.createElement('button');
      rejectBtn.className = 'btn-primary';
      rejectBtn.style.cssText = 'width:auto; padding:8px 16px; background:var(--danger);';
      rejectBtn.textContent = 'رفض';
      rejectBtn.addEventListener('click', () => updateExpenseStatus(r.id, 'rejected'));
      actions.appendChild(confirmBtn);
      actions.appendChild(rejectBtn);
    }
    if (canManage) {
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'btn-primary';
      deleteBtn.style.cssText = 'width:auto; padding:8px 16px; background:#fff; color:var(--danger); border:1px solid var(--danger);';
      deleteBtn.textContent = 'حذف';
      deleteBtn.addEventListener('click', async () => {
        if (!confirm(`متأكد تبي تحذف بيان الصرف رقم ${r.statement_number}؟ هذا الإجراء لا يمكن التراجع عنه.`)) return;
        const { error } = await sb.from('budget_expense_requests').delete().eq('id', r.id);
        if (error) { alert('تعذر الحذف: ' + error.message); return; }
        await loadDashboard();
        await loadExpensesList(true);
      });
      actions.appendChild(deleteBtn);
    }
    card.appendChild(actions);
    container.appendChild(card);
  });
}

async function updateExpenseStatus(id, status) {
  if (status === 'rejected' && !confirm('متأكد تبي ترفض طلب الصرف هذا؟')) return;
  await sb.from('budget_expense_requests').update({
    status, confirmed_by: currentUserId, confirmed_at: new Date().toISOString(),
  }).eq('id', id);
  await loadDashboard();
  await loadExpensesList(true);
}

/* ---------- طباعة السند (بيان الصرف) ---------- */
// شعار الهيئة الملكية للجبيل وينبع (مثبّت كـ Base64 عشان يظهر بالسند المطبوع بدون أي اتصال إنترنت)
export const VOUCHER_LOGO_DATA_URI = new URL('logo.png', window.location.href).href;
const VOUCHER_ORG_NAME = 'مدرسة المروج';
const VOUCHER_ORG_SUB = '';
const VOUCHER_MANAGER_NAME = 'منيف بن محمد النفيعي';

function printVoucher(r, items, total) {
  const catName = r.budget_categories ? r.budget_categories.name : 'بدون بند';
  const sourceLabel = r.funding_source === 'أخرى' ? (r.funding_source_other || 'أخرى') : r.funding_source;

  const itemsRows = items.map((it, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${esc(it.invoice_number || '-')}</td>
      <td>${it.invoice_date ? fmtDate(it.invoice_date) : '-'}</td>
      <td>${esc(it.source || '-')}</td>
      <td class="desc">${esc(it.description)}</td>
      <td class="amt">${fmtAmount(it.amount)}</td>
    </tr>`).join('');

  const logoHtml = VOUCHER_LOGO_DATA_URI
    ? `<img src="${VOUCHER_LOGO_DATA_URI}" alt="شعار الهيئة الملكية للجبيل وينبع" />`
    : `<div class="logo-placeholder">الشعار</div>`;

  const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<title>سند صرف رقم ${r.statement_number}</title>
<style>
  * { box-sizing: border-box; }
  @page { size: A4; margin: 12mm; }
  body { font-family: 'Tahoma', 'Arial', sans-serif; padding: 10mm; margin: 0; color:#16233A; }
  .doc { width: 100%; max-width: 186mm; margin: 0 auto; border: 2px solid #16233A; border-radius: 6px; padding: 10mm 12mm; }

  .header { display:flex; align-items:center; justify-content:space-between; border-bottom: 2px solid #16233A; padding-bottom: 14px; margin-bottom: 18px; gap:10px; }
  .header .logo-side { width: 46mm; flex-shrink:0; display:flex; align-items:center; justify-content:flex-start; }
  .header .logo-side img { max-width: 44mm; max-height: 13mm; }
  .header .logo-side .logo-placeholder { width:40mm; height:13mm; border:1px dashed #999; border-radius:6px; display:flex; align-items:center; justify-content:center; font-size:10px; color:#999; }
  .header .titles { flex: 1; text-align:center; }
  .header .titles h1 { font-size: 19px; margin: 0 0 3px; color:#B3413A; }
  .header .titles .org { font-size: 13px; color:#444; margin: 0; }
  .header .titles .org-sub { font-size: 11px; color:#777; margin: 2px 0 0; }
  .header .num-side { width: 110px; flex-shrink:0; text-align:center; font-size: 12px; }
  .header .num-side .num-box { border:1px solid #16233A; border-radius:6px; padding:6px 10px; display:inline-block; text-align:center; }
  .header .num-side .num-box b { font-size: 16px; display:block; text-align:center; }

  table.meta { width:100%; border-collapse:collapse; margin-bottom:18px; }
  table.meta td { border:1px solid #ccc; padding:8px 10px; font-size:13px; }
  table.meta td.label { background:#f3f3f0; font-weight:bold; width:130px; }

  table.items { width:100%; border-collapse:collapse; margin-bottom: 6px; }
  table.items th, table.items td { border:1px solid #999; padding:7px 8px; font-size:12.5px; text-align:center; }
  table.items th { background:#16233A; color:#fff; font-weight:600; }
  table.items td.desc { text-align:right; }
  table.items td.amt { text-align:left; font-weight:600; }
  table.items tbody tr:nth-child(even) { background:#f7f7f2; }
  table.items tfoot td { font-weight:800; background:#eef1f6; font-size:13.5px; }

  .sign { display:flex; justify-content:space-between; margin-top:40px; gap:14px; }
  .sign > div { flex:1; text-align:center; font-size:12.5px; }
  .sign .box { margin-top:8px; border:1px solid #999; border-radius:6px; height:74px; display:flex; flex-direction:column; justify-content:space-between; padding:8px 10px; }
  .sign .box .name { color:#16233A; font-weight:700; font-size:13px; line-height:1.4; }
  .sign .box .line { border-top:1px dashed #aaa; padding-top:4px; font-size:10px; color:#999; }

  .footer-note { margin-top:22px; font-size:10.5px; color:#999; text-align:center; }

  @media print { body { padding: 0; } .doc { max-width: 100%; border-width: 1.5px; } }
</style>
</head>
<body>
  <div class="doc">
    <div class="header">
      <div class="logo-side">${logoHtml}</div>
      <div class="titles">
        <h1>سند صرف</h1>
        <p class="org">${esc(VOUCHER_ORG_NAME)}</p>
        ${VOUCHER_ORG_SUB ? `<p class="org-sub">${esc(VOUCHER_ORG_SUB)}</p>` : ''}
      </div>
      <div class="num-side">
        <div class="num-box">رقم البيان<b>${r.statement_number}</b></div>
      </div>
    </div>

    <table class="meta">
      <tr><td class="label">البند</td><td>${esc(catName)}</td><td class="label">التاريخ</td><td>${fmtDate(r.request_date)}</td></tr>
      <tr><td class="label">يُصرف لـ</td><td>${esc(r.beneficiary_name)}</td><td class="label">جهة الصرف</td><td>${esc(sourceLabel)}</td></tr>
      <tr><td class="label">الفصل الدراسي</td><td colspan="3">${esc(r.semester || '-')}</td></tr>
    </table>

    <table class="items">
      <thead><tr><th style="width:32px;">م</th><th>رقم الفاتورة</th><th>تاريخ الفاتورة</th><th>مصدرها</th><th>البيان</th><th>المبلغ</th></tr></thead>
      <tbody>${itemsRows}</tbody>
      <tfoot><tr><td colspan="5">الإجمالي</td><td class="amt">${fmtAmount(total)}</td></tr></tfoot>
    </table>

    <div class="sign">
      <div>اعتماد المدير<div class="box"><div class="name">${esc(VOUCHER_MANAGER_NAME)}</div><div class="line">التوقيع</div></div></div>
      <div>استلام المبلغ<div class="box"><div class="name">${esc(r.beneficiary_name)}</div><div class="line">التوقيع</div></div></div>
    </div>

    <div class="footer-note">تمت الطباعة من نظام إدارة المدرسة — ${fmtDate(todayIso())}</div>
  </div>
</body>
</html>`;

  const win = window.open('', '_blank');
  if (!win) { alert('يرجى السماح بفتح نافذة منبثقة للطباعة'); return; }
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 300);
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

  const semesterFilter = document.getElementById('budget-semester-filter') ? document.getElementById('budget-semester-filter').value : '';

  const [{ data: revenues }, { data: requests }, { data: closures }] = await Promise.all([
    sb.from('budget_revenues').select('amount, revenue_date, semester'),
    sb.from('budget_expense_requests')
      .select('request_date, status, semester, category_id, budget_categories(name), budget_expense_items(amount)')
      .eq('status', 'confirmed'),
    sb.from('budget_semester_closures').select('semester, admin_share_amount, carryover_amount'),
  ]);

  let revList = revenues || [];
  let reqList = requests || [];
  let closureList = closures || [];
  if (semesterFilter) {
    revList = revList.filter(r => r.semester === semesterFilter);
    reqList = reqList.filter(r => r.semester === semesterFilter);
    closureList = closureList.filter(c => c.semester === semesterFilter);
  }

  // نبني قائمة "مصروفات" مسطّحة (كل فاتورة كسطر) من طلبات الصرف المعتمدة فقط
  const expList = [];
  reqList.forEach(r => {
    const catName = r.budget_categories ? r.budget_categories.name : 'غير مصنّف';
    (r.budget_expense_items || []).forEach(it => {
      expList.push({ amount: Number(it.amount || 0), expense_date: r.request_date, category_name: catName, category_id: r.category_id });
    });
  });

  const totalRevenue = revList.reduce((s, r) => s + Number(r.amount), 0);
  const totalExpense = expList.reduce((s, e) => s + e.amount, 0);
  const totalAdminShare = closureList.reduce((s, c) => s + Number(c.admin_share_amount || 0), 0);
  const totalCarryover = closureList.reduce((s, c) => s + Number(c.carryover_amount || 0), 0);
  const balance = totalRevenue - totalExpense - totalAdminShare - totalCarryover;

  const byCategory = new Map();
  expList.forEach(e => {
    byCategory.set(e.category_name, (byCategory.get(e.category_name) || 0) + e.amount);
  });
  let topCategory = '-', topAmount = 0;
  byCategory.forEach((amt, name) => { if (amt > topAmount) { topAmount = amt; topCategory = name; } });
  const topPct = totalExpense ? Math.round(topAmount / totalExpense * 100) : 0;

  statsEl.innerHTML =
    statCard('إجمالي الإيرادات', fmtAmount(totalRevenue), 'var(--green)') +
    statCard('إجمالي المصروفات (المعتمدة)', fmtAmount(totalExpense), 'var(--danger)') +
    statCard('الرصيد الحالي', fmtAmount(balance), 'var(--meadow)') +
    statCard('أكبر بند صرف', topCategory, 'var(--ink)', topAmount ? `${fmtAmount(topAmount)} (${topPct}%)` : null) +
    statCard('نصيب الإدارة (مخصوم)', fmtAmount(totalAdminShare), 'var(--purple)') +
    statCard('المدوَّر (محتجز)', fmtAmount(totalCarryover), 'var(--teal)');

  renderCategoryCaps(totalRevenue, expList);

  await loadCharts(revList, expList, byCategory);
}

/* ---------- نصيب الإدارة + المدوَّر (تُحسب آخر كل فصل دراسي) ---------- */
async function loadShareSection() {
  const wrap = document.getElementById('budget-share-section');
  if (!wrap) return;

  const [{ data: settingsRows }, { data: closures }] = await Promise.all([
    sb.from('budget_share_settings').select('admin_share_percentage, carryover_percentage').eq('id', 1).single(),
    sb.from('budget_semester_closures').select('*').order('closed_at', { ascending: false }),
  ]);
  const settings = settingsRows || { admin_share_percentage: 10, carryover_percentage: 0 };
  const closureList = closures || [];

  const adminInput = document.getElementById('budget-share-admin-pct');
  const carryInput = document.getElementById('budget-share-carry-pct');
  if (adminInput) adminInput.value = settings.admin_share_percentage;
  if (carryInput) carryInput.value = settings.carryover_percentage;

  const semSelect = document.getElementById('budget-share-close-semester');
  if (semSelect && !semSelect.dataset.filled) {
    semSelect.innerHTML = '<option value="">اختر الفصل...</option>' + SEMESTERS.map(s => `<option value="${s}">${s}</option>`).join('');
    semSelect.dataset.filled = '1';
  }

  const listEl = document.getElementById('budget-share-closures-list');
  if (listEl) {
    if (closureList.length === 0) {
      listEl.innerHTML = '<p style="font-size:12px; color:var(--slate); margin:8px 0 0;">ما فيه فصل مُقفل بعد</p>';
    } else {
      listEl.innerHTML = closureList.map(c => `
        <div style="display:flex; justify-content:space-between; align-items:center; font-size:12.5px; padding:8px 0; border-bottom:1px solid #ECEAE1;">
          <span style="font-weight:600;">${esc(c.semester)}</span>
          <span style="color:var(--slate);">الإيراد: ${fmtAmount(c.total_revenue)} — الإدارة: ${fmtAmount(c.admin_share_amount)} (${c.admin_share_percentage}%) — المدوَّر: ${fmtAmount(c.carryover_amount)} (${c.carryover_percentage}%)</span>
        </div>`).join('');
    }
  }
}

document.getElementById('budget-share-settings-save') && document.getElementById('budget-share-settings-save').addEventListener('click', async () => {
  const errEl = document.getElementById('budget-share-error');
  errEl.style.display = 'none';
  const admin_share_percentage = parseFloat(document.getElementById('budget-share-admin-pct').value);
  const carryover_percentage = parseFloat(document.getElementById('budget-share-carry-pct').value);
  if (isNaN(admin_share_percentage) || isNaN(carryover_percentage)) {
    errEl.textContent = 'أدخل نسبتين صحيحتين';
    errEl.style.display = 'block';
    return;
  }
  const { error } = await sb.from('budget_share_settings').update({ admin_share_percentage, carryover_percentage, updated_by: currentUserId }).eq('id', 1);
  if (error) {
    errEl.textContent = 'تعذر الحفظ: ' + error.message;
    errEl.style.display = 'block';
    return;
  }
  await loadShareSection();
});

document.getElementById('budget-share-close-submit') && document.getElementById('budget-share-close-submit').addEventListener('click', async () => {
  const errEl = document.getElementById('budget-share-error');
  errEl.style.display = 'none';
  const semester = document.getElementById('budget-share-close-semester').value;
  if (!semester) {
    errEl.textContent = 'اختر الفصل الدراسي المراد إقفاله أولاً';
    errEl.style.display = 'block';
    return;
  }

  const [{ data: settingsRows }, { data: revenues }, { data: existing }] = await Promise.all([
    sb.from('budget_share_settings').select('admin_share_percentage, carryover_percentage').eq('id', 1).single(),
    sb.from('budget_revenues').select('amount, semester').eq('semester', semester),
    sb.from('budget_semester_closures').select('id').eq('semester', semester).single(),
  ]);
  const settings = settingsRows || { admin_share_percentage: 10, carryover_percentage: 0 };
  const totalRevenue = (revenues || []).reduce((s, r) => s + Number(r.amount), 0);
  const adminAmount = totalRevenue * (Number(settings.admin_share_percentage) / 100);
  const carryAmount = totalRevenue * (Number(settings.carryover_percentage) / 100);

  const msg = `سيتم تسجيل نهاية "${semester}":\n` +
    `إجمالي الإيراد: ${fmtAmount(totalRevenue)}\n` +
    `نصيب الإدارة (${settings.admin_share_percentage}%): ${fmtAmount(adminAmount)}\n` +
    `المدوَّر (${settings.carryover_percentage}%): ${fmtAmount(carryAmount)}\n` +
    (existing && existing.id ? '\nتنبيه: هذا الفصل مُقفل من قبل — بيتم استبدال القيم السابقة.' : '') +
    '\nهل تؤكد؟';
  if (!confirm(msg)) return;

  const payload = {
    semester, total_revenue: totalRevenue,
    admin_share_percentage: settings.admin_share_percentage, admin_share_amount: adminAmount,
    carryover_percentage: settings.carryover_percentage, carryover_amount: carryAmount,
    closed_by: currentUserId, closed_at: new Date().toISOString(),
  };

  let error;
  if (existing && existing.id) {
    ({ error } = await sb.from('budget_semester_closures').update(payload).eq('id', existing.id));
  } else {
    ({ error } = await sb.from('budget_semester_closures').insert(payload));
  }
  if (error) {
    errEl.textContent = 'تعذر تسجيل الإقفال: ' + error.message;
    errEl.style.display = 'block';
    return;
  }
  await loadShareSection();
  await loadDashboard();
});

/* ---------- مؤشرات سقف الصرف لكل بند (% من إجمالي الإيراد) ---------- */
function renderCategoryCaps(totalRevenue, expList) {
  const wrap = document.getElementById('budget-category-caps');
  if (!wrap) return;

  const spentByCategory = new Map();
  expList.forEach(e => {
    if (e.category_id == null) return;
    spentByCategory.set(e.category_id, (spentByCategory.get(e.category_id) || 0) + e.amount);
  });

  const capped = categoriesCache.filter(c => c.cap_percentage != null && c.cap_percentage !== '');
  if (capped.length === 0) {
    wrap.innerHTML = '';
    wrap.classList.add('hidden');
    return;
  }
  wrap.classList.remove('hidden');

  const rows = capped.map(c => {
    const cap = totalRevenue * (Number(c.cap_percentage) / 100);
    const spent = spentByCategory.get(c.id) || 0;
    const pct = cap > 0 ? (spent / cap) * 100 : (spent > 0 ? 100 : 0);
    const clampedPct = Math.max(0, Math.min(100, pct));
    let color = 'var(--green)', bg = 'var(--green-light)';
    if (pct > 80) { color = 'var(--danger)'; bg = 'var(--danger-light)'; }
    else if (pct > 50) { color = '#B8860B'; bg = '#FBF3D9'; }

    return `<div style="margin-bottom:12px;">
      <div style="display:flex; justify-content:space-between; font-size:12.5px; margin-bottom:4px;">
        <span style="font-weight:600;">${esc(c.name)}</span>
        <span style="color:${color}; font-weight:700;">${fmtAmount(spent)} / ${fmtAmount(cap)} (${Math.round(pct)}%)</span>
      </div>
      <div style="height:9px; border-radius:6px; background:${bg}; overflow:hidden;">
        <div style="height:100%; width:${clampedPct}%; background:${color}; border-radius:6px;"></div>
      </div>
    </div>`;
  }).join('');

  wrap.innerHTML = `<h4 style="margin-bottom:10px;">نسب الصرف حسب سقف كل بند</h4>${rows}`;
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
    monthMap.get(key).exp += e.amount;
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
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { font: { family: 'IBM Plex Sans Arabic', size: 10 }, usePointStyle: true, boxWidth: 8 } } },
      scales: {
        x: { grid: { display: false }, ticks: { font: { family: 'IBM Plex Sans Arabic', size: 9 } } },
        y: { grid: { color: '#F1EFE7' }, ticks: { font: { family: 'IBM Plex Sans Arabic', size: 9 } } },
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
    options: { responsive: true, maintainAspectRatio: false, cutout: '68%', plugins: { legend: { display: false } } },
  });

  const legendWrap = document.getElementById('budget-donut-legend');
  legendWrap.innerHTML = '';
  const total = catData.reduce((a, b) => a + b, 0);
  catLabels.forEach((l, i) => {
    const pct = total ? Math.round(catData[i] / total * 100) : 0;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; align-items:center; gap:8px; font-size:12.5px; margin-top:6px;';
    row.innerHTML = `<span style="width:9px; height:9px; border-radius:50%; flex-shrink:0; background:${catColors[i]};"></span><span style="flex:1;">${esc(l)}</span><span style="color:var(--slate);">${pct}%</span>`;
    legendWrap.appendChild(row);
  });
}
