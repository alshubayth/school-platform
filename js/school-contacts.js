import { sb, currentUserId, backToTiles, currentSchoolId, readScopedBySchool, writeWithSchool } from './core.js';

/* ===== بيانات التواصل: كل مدرسة تدخل بيانات التواصل الخاصة فيها (بدل ما تكون بيانات مدرسة
 * واحدة مكتوبة يدويًا وثابتة بصفحة ولي الأمر لكل المدارس). كل بطاقة فيها مجموعة (الإدارة/
 * التوجيه الطلابي/...)، مسمى، اسم اختياري، رقم، ووسيلة تواصل: اتصال فقط / واتساب فقط /
 * اتصال وواتساب. ===== */

const TYPE_LABELS = { call: 'اتصال فقط', whatsapp: 'واتساب فقط', both: 'اتصال وواتساب' };
let selectedType = 'call';
let editingId = null;
let contactsCache = [];

function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }

export async function loadSchoolContactsModule() {
  renderTypeGrid();
  resetForm();
  await refreshContactsList();
}

/* ---------- منتقي وسيلة التواصل ---------- */
function renderTypeGrid() {
  const grid = document.getElementById('sc-type-grid');
  grid.querySelectorAll('.sc-type-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.type === selectedType);
    btn.onclick = () => {
      selectedType = btn.dataset.type;
      renderTypeGrid();
    };
  });
}

function resetForm() {
  editingId = null;
  document.getElementById('sc-form-title').textContent = 'إضافة بيانات تواصل جديدة';
  document.getElementById('sc-group').value = '';
  document.getElementById('sc-role').value = '';
  document.getElementById('sc-name').value = '';
  document.getElementById('sc-sub').value = '';
  document.getElementById('sc-phone').value = '';
  document.getElementById('sc-note').value = '';
  selectedType = 'call';
  renderTypeGrid();
  document.getElementById('sc-add-btn').textContent = '+ إضافة';
  document.getElementById('sc-cancel-edit-btn').classList.add('hidden');
  document.getElementById('sc-error').style.display = 'none';
}

function fillGroupSuggestions() {
  const dl = document.getElementById('sc-group-options');
  const groups = [...new Set(contactsCache.map(c => c.group_name))];
  dl.innerHTML = groups.map(g => `<option value="${esc(g)}"></option>`).join('');
}

/* ---------- إضافة / تعديل ---------- */
document.getElementById('sc-add-btn').addEventListener('click', async () => {
  const errEl = document.getElementById('sc-error');
  errEl.style.display = 'none';

  const group_name = document.getElementById('sc-group').value.trim();
  const role_title = document.getElementById('sc-role').value.trim();
  const person_name = document.getElementById('sc-name').value.trim();
  const sub_label = document.getElementById('sc-sub').value.trim();
  const phone = document.getElementById('sc-phone').value.trim();
  const restriction_note = document.getElementById('sc-note').value.trim();

  if (!group_name) { errEl.textContent = 'اكتب اسم المجموعة (مثال: الإدارة)'; errEl.style.display = 'block'; return; }
  if (!role_title) { errEl.textContent = 'اكتب المسمى أو الصفة'; errEl.style.display = 'block'; return; }
  if (!phone) { errEl.textContent = 'اكتب رقم الجوال أو الهاتف'; errEl.style.display = 'block'; return; }

  const row = {
    group_name, role_title,
    person_name: person_name || null,
    sub_label: sub_label || null,
    phone,
    contact_type: selectedType,
    restriction_note: restriction_note || null,
  };

  let error;
  if (editingId) {
    ({ error } = await sb.from('school_contacts').update(row).eq('id', editingId));
  } else {
    ({ error } = await writeWithSchool(extra => sb.from('school_contacts').insert({
      ...row, ...extra, sort_order: contactsCache.length, created_by: currentUserId,
    })));
  }

  if (error) {
    errEl.textContent = 'حدث خطأ: ' + error.message;
    errEl.style.display = 'block';
    return;
  }

  resetForm();
  await refreshContactsList();
});

document.getElementById('sc-cancel-edit-btn').addEventListener('click', resetForm);

/* ---------- القائمة (مجمّعة حسب المجموعة) ---------- */
async function refreshContactsList() {
  const list = document.getElementById('sc-contacts-list');
  list.innerHTML = '<div class="placeholder" style="padding:20px;"><p>جارٍ التحميل...</p></div>';

  const { data, error } = await readScopedBySchool(scoped => {
    let q = sb.from('school_contacts').select('*').order('group_name', { ascending: true }).order('sort_order', { ascending: true });
    if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
    return q;
  });

  if (error) {
    console.error('school_contacts fetch error:', error);
    list.innerHTML = `<div class="placeholder" style="padding:20px;"><p>تعذّر تحميل بيانات التواصل${error.message ? ': ' + esc(error.message) : ''}</p></div>`;
    return;
  }

  contactsCache = data || [];
  fillGroupSuggestions();

  list.innerHTML = '';
  if (contactsCache.length === 0) {
    list.innerHTML = '<div class="placeholder" style="padding:20px;"><p>ما فيه بيانات تواصل مضافة بعد - أضف أول بطاقة من الأعلى</p></div>';
    return;
  }

  let lastGroup = null;
  contactsCache.forEach(c => {
    if (c.group_name !== lastGroup) {
      lastGroup = c.group_name;
      const label = document.createElement('div');
      label.className = 'sc-group-label';
      label.textContent = c.group_name;
      list.appendChild(label);
    }
    list.appendChild(buildContactTile(c));
  });
}

function buildContactTile(c) {
  const avatarLetter = (c.person_name || c.role_title || '؟').trim().charAt(0);
  const tile = document.createElement('div');
  tile.className = 'sc-tile';
  tile.innerHTML = `
    <div class="avatar">${esc(avatarLetter)}</div>
    <div class="info">
      <p class="role">${esc(c.role_title)}</p>
      ${c.person_name ? `<p class="name">${esc(c.person_name)}</p>` : ''}
      ${c.sub_label ? `<p class="sub">${esc(c.sub_label)}</p>` : ''}
      <div class="meta-row">
        <span class="badge badge-green">${TYPE_LABELS[c.contact_type] || TYPE_LABELS.both}</span>
        <span class="phone-chip">${esc(c.phone)}</span>
      </div>
      ${c.restriction_note ? `<p class="sub" style="margin-top:4px;">${esc(c.restriction_note)}</p>` : ''}
    </div>
    <div class="foot">
      <button class="sc-edit-btn" title="تعديل">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
      </button>
      <button class="sc-delete-btn" title="حذف">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>
      </button>
    </div>`;

  tile.querySelector('.sc-edit-btn').addEventListener('click', () => {
    editingId = c.id;
    document.getElementById('sc-form-title').textContent = 'تعديل بيانات التواصل';
    document.getElementById('sc-group').value = c.group_name;
    document.getElementById('sc-role').value = c.role_title;
    document.getElementById('sc-name').value = c.person_name || '';
    document.getElementById('sc-sub').value = c.sub_label || '';
    document.getElementById('sc-phone').value = c.phone;
    document.getElementById('sc-note').value = c.restriction_note || '';
    selectedType = c.contact_type;
    renderTypeGrid();
    document.getElementById('sc-add-btn').textContent = 'حفظ التعديل';
    document.getElementById('sc-cancel-edit-btn').classList.remove('hidden');
    document.getElementById('sc-error').style.display = 'none';
    document.getElementById('school-contacts-module').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  tile.querySelector('.sc-delete-btn').addEventListener('click', async () => {
    if (!confirm('حذف بطاقة التواصل هذي؟')) return;
    await sb.from('school_contacts').delete().eq('id', c.id);
    if (editingId === c.id) resetForm();
    await refreshContactsList();
  });

  return tile;
}

document.getElementById('back-to-tiles-21').addEventListener('click', backToTiles);
