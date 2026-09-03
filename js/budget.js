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
  const { data } = await sb.from('budget_categories').select('id, name').order('name');
  categoriesCache = data || [];

  const expSelect = document.getElementById('budget-exp-category');
  expSelect.innerHTML = '<option value="">بدون بند (اختياري)</option>' +
    categoriesCache.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');

  const listEl = document.getElementById('budget-categories-list');
  if (listEl) {
    listEl.innerHTML = '';
    categoriesCache.forEach(c => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex; align-items:center; justify-content:space-between; padding:8px 0; border-bottom:1px solid #ECEAE1; font-size:13px;';
      row.innerHTML = `<span>${esc(c.name)}</span>
        <button type="button" class="cat-delete-btn" data-id="${c.id}" title="حذف البند" style="border:none; background:none; color:var(--danger); cursor:pointer; font-size:14px; padding:2px 6px;">✕</button>`;
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

/* ---------- مجال الصرف / جهة الصرف: إظهار حقل "أخرى" عند الحاجة ---------- */
document.getElementById('budget-exp-area').addEventListener('change', (e) => {
  document.getElementById('budget-exp-area-other').style.display = e.target.value === 'أخرى' ? 'block' : 'none';
});
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
  document.getElementById('budget-exp-area').value = '';
  document.getElementById('budget-exp-area-other').value = '';
  document.getElementById('budget-exp-area-other').style.display = 'none';
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

  const area = document.getElementById('budget-exp-area').value;
  const areaOther = document.getElementById('budget-exp-area-other').value.trim();
  const categoryId = document.getElementById('budget-exp-category').value || null;
  const beneficiary = document.getElementById('budget-exp-beneficiary').value;
  const source = document.getElementById('budget-exp-source').value;
  const sourceOther = document.getElementById('budget-exp-source-other').value.trim();
  const semester = document.getElementById('budget-exp-semester').value;
  const date = document.getElementById('budget-exp-date').value || todayIso();
  const items = collectExpenseItems();

  if (!area) { errEl.textContent = 'اختر مجال الصرف'; errEl.style.display = 'block'; return; }
  if (area === 'أخرى' && !areaOther) { errEl.textContent = 'اكتب مجال الصرف'; errEl.style.display = 'block'; return; }
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
    spending_area: area,
    spending_area_other: area === 'أخرى' ? areaOther : null,
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
    .select(`id, statement_number, spending_area, spending_area_other, beneficiary_name, funding_source, funding_source_other,
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
    const areaLabel = r.spending_area === 'أخرى' ? (r.spending_area_other || 'أخرى') : r.spending_area;
    const catName = r.budget_categories ? r.budget_categories.name : null;
    const reqName = r.requester ? r.requester.full_name : '-';

    const card = document.createElement('div');
    card.className = 'form-card';
    card.style.marginBottom = '10px';
    card.innerHTML = `
      <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:10px; flex-wrap:wrap;">
        <div style="min-width:0;">
          <div style="font-weight:700; font-size:14px; margin-bottom:4px;">
            بيان رقم ${r.statement_number} — ${esc(areaLabel)}
            <span class="badge ${STATUS_BADGE[r.status]}">${STATUS_LABELS[r.status]}</span>
          </div>
          <div style="font-size:12.5px; color:var(--slate);">
            يُصرف لـ: ${esc(r.beneficiary_name)} — جهة الصرف: ${esc(r.funding_source === 'أخرى' ? (r.funding_source_other || 'أخرى') : r.funding_source)}
            ${catName ? ` — البند: ${esc(catName)}` : ''}
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
const VOUCHER_LOGO_DATA_URI = 'data:image/png;base64,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';
const VOUCHER_ORG_NAME = 'مدرسة المروج';
const VOUCHER_ORG_SUB = '';
const VOUCHER_MANAGER_TITLE = 'مدير المدرسة';
const VOUCHER_MANAGER_NAME = 'منيف بن محمد النفيعي';

function printVoucher(r, items, total) {
  const areaLabel = r.spending_area === 'أخرى' ? (r.spending_area_other || 'أخرى') : r.spending_area;
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
      <tr><td class="label">مجال الصرف</td><td>${esc(areaLabel)}</td><td class="label">التاريخ</td><td>${fmtDate(r.request_date)}</td></tr>
      <tr><td class="label">يُصرف لـ</td><td>${esc(r.beneficiary_name)}</td><td class="label">جهة الصرف</td><td>${esc(sourceLabel)}</td></tr>
      <tr><td class="label">الفصل الدراسي</td><td colspan="3">${esc(r.semester || '-')}</td></tr>
    </table>

    <table class="items">
      <thead><tr><th style="width:32px;">م</th><th>رقم الفاتورة</th><th>تاريخ الفاتورة</th><th>مصدرها</th><th>البيان</th><th>المبلغ</th></tr></thead>
      <tbody>${itemsRows}</tbody>
      <tfoot><tr><td colspan="5">الإجمالي</td><td class="amt">${fmtAmount(total)}</td></tr></tfoot>
    </table>

    <div class="sign">
      <div>اعتماد المدير<div class="box"><div class="name">${esc(VOUCHER_MANAGER_TITLE)}<br>${esc(VOUCHER_MANAGER_NAME)}</div><div class="line">التوقيع</div></div></div>
      <div>استلام المبلغ (الموظف المصروف له)<div class="box"><div class="name">${esc(r.beneficiary_name)}</div><div class="line">التوقيع</div></div></div>
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

  const [{ data: revenues }, { data: requests }] = await Promise.all([
    sb.from('budget_revenues').select('amount, revenue_date, semester'),
    sb.from('budget_expense_requests')
      .select('request_date, status, semester, budget_categories(name), budget_expense_items(amount)')
      .eq('status', 'confirmed'),
  ]);

  let revList = revenues || [];
  let reqList = requests || [];
  if (semesterFilter) {
    revList = revList.filter(r => r.semester === semesterFilter);
    reqList = reqList.filter(r => r.semester === semesterFilter);
  }

  // نبني قائمة "مصروفات" مسطّحة (كل فاتورة كسطر) من طلبات الصرف المعتمدة فقط
  const expList = [];
  reqList.forEach(r => {
    const catName = r.budget_categories ? r.budget_categories.name : 'غير مصنّف';
    (r.budget_expense_items || []).forEach(it => {
      expList.push({ amount: Number(it.amount || 0), expense_date: r.request_date, category_name: catName });
    });
  });

  const totalRevenue = revList.reduce((s, r) => s + Number(r.amount), 0);
  const totalExpense = expList.reduce((s, e) => s + e.amount, 0);
  const balance = totalRevenue - totalExpense;

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
    row.innerHTML = `<span style="width:9px; height:9px; border-radius:50%; flex-shrink:0; background:${catColors[i]};"></span><span style="flex:1;">${esc(l)}</span><span style="color:var(--slate);">${pct}%</span>`;
    legendWrap.appendChild(row);
  });
}
