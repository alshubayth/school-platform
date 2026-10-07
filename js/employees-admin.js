import { sb, SUPABASE_URL, currentUserId, roleLabels, gradeLabels,
         isAdminOrDeputy, toLoginEmail, STAFF_ID_DOMAIN, setupCollapsible,
         currentSchoolId, readScopedBySchool, writeWithSchool } from './core.js';
import { loadXLSX } from './lib-loader.js';

/* ================= بوابة الموظفين ================= */
export async function loadPortalModule() {
  document.getElementById('pt-actions').classList.toggle('hidden', !isAdminOrDeputy());
  document.getElementById('portal-add-form').classList.add('hidden');
  document.getElementById('portal-bulk-form').classList.add('hidden');
  await refreshPortalList();
}

function togglePanel(id, btnId, openLabel, closedLabel) {
  const el = document.getElementById(id);
  const open = el.classList.toggle('hidden') === false;
  document.getElementById(btnId).textContent = open ? openLabel : closedLabel;
  if (open) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
document.getElementById('pt-add-toggle').addEventListener('click', () => togglePanel('portal-add-form', 'pt-add-toggle', 'إلغاء', '+ موظف'));
document.getElementById('pt-bulk-toggle').addEventListener('click', () => togglePanel('portal-bulk-form', 'pt-bulk-toggle', 'إخفاء الاستيراد', 'استيراد حسابات من إكسل'));
let ptFilter = 'all';
let ptSearch = '';
let ptEmps = [];
let ptProfiles = [];
document.querySelectorAll('#pt-filter button').forEach(b => b.addEventListener('click', () => { ptFilter = b.dataset.f; renderPortalRows(); }));
document.getElementById('pt-search').addEventListener('input', (e) => { ptSearch = e.target.value.trim(); renderPortalRows(); });
document.addEventListener('click', (e) => { if (!e.target.closest('.row-menu')) document.querySelectorAll('#portal-list .row-menu-pop').forEach(p => p.classList.add('hidden')); });

/* ---------- تنزيل نموذج إكسل لإنشاء حسابات متعددة ---------- */
document.getElementById('portal-download-template').addEventListener('click', async () => {
  await loadXLSX();
  const headers = ['الاسم الكامل', 'البريد الإلكتروني أو الرقم الوظيفي', 'كلمة المرور', 'الدور'];
  const example = ['محمد سالم العتيبي', '10234 (أو mohammed.example@school.com)', 'Passw0rd123', 'معلم'];
  const note = ['الدور: اكتب بالضبط أحد هذه الخيارات → معلم / وكيل / مدير (افتراضيًا معلم لو تُرك فاضي). العمود الثاني يقبل رقم وظيفي بدون @ أو إيميل حقيقي.', '', '', ''];
  const ws = XLSX.utils.aoa_to_sheet([headers, example, note]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'الموظفون');
  XLSX.writeFile(wb, 'نموذج_إنشاء_حسابات_الموظفين.xlsx');
});

/* ---------- رفع ملف إكسل لإنشاء حسابات متعددة ---------- */
document.getElementById('portal-excel-upload').addEventListener('click', async () => {
  const fileInput = document.getElementById('portal-excel-file');
  const errEl = document.getElementById('portal-excel-error');
  const successEl = document.getElementById('portal-excel-success');
  errEl.style.display = 'none';
  successEl.style.display = 'none';

  if (!fileInput.files || fileInput.files.length === 0) {
    errEl.textContent = 'اختر ملف إكسل أولاً';
    errEl.style.display = 'block';
    return;
  }

  await loadXLSX();
  const roleTextMap = { 'معلم': 'teacher', 'وكيل': 'deputy', 'مدير': 'admin' };
  const uploadBtn = document.getElementById('portal-excel-upload');
  const file = fileInput.files[0];
  const reader = new FileReader();

  reader.onload = async (e) => {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

      const { data: sessionData } = await sb.auth.getSession();
      const accessToken = sessionData.session.access_token;

      let created = 0;
      const failedRows = [];

      for (const row of rows) {
        const full_name = (row['الاسم الكامل'] || '').toString().trim();
        const email = (row['البريد الإلكتروني أو الرقم الوظيفي'] || row['البريد الإلكتروني'] || '').toString().trim();
        const password = (row['كلمة المرور'] || '').toString().trim();
        const roleText = (row['الدور'] || 'معلم').toString().trim();
        if (!full_name || !email) continue; // صف فارغ أو صف ملاحظات

        if (!password || password.length < 6) {
          failedRows.push(`"${full_name}" — كلمة المرور ناقصة أو أقل من 6 أحرف`);
          continue;
        }
        const role = roleTextMap[roleText] || 'teacher';

        uploadBtn.textContent = `جارٍ الإنشاء... (${created + failedRows.length + 1}/${rows.length})`;

        try {
          const res = await fetch(`${SUPABASE_URL}/functions/v1/create-user`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
            body: JSON.stringify({ email: toLoginEmail(email), password, full_name, role }),
          });
          const result = await res.json();
          if (!res.ok) { failedRows.push(`"${full_name}" — ${result.error || 'خطأ غير معروف'}`); continue; }

          if (['admin', 'deputy', 'teacher'].includes(role)) {
            await writeWithSchool(extra => sb.from('employees').insert({ full_name, job_title: roleLabels[role], profile_id: result.id, ...extra }));
          }
          created++;
        } catch (err) {
          failedRows.push(`"${full_name}" — تعذر الاتصال: ${err.message}`);
        }
      }

      uploadBtn.textContent = 'رفع الملف وإنشاء الحسابات';

      if (created > 0) {
        successEl.textContent = `تم إنشاء ${created} حساب بنجاح.`;
        successEl.style.display = 'block';
      }
      if (failedRows.length > 0) {
        errEl.innerHTML = 'صفوف لم تُنشأ:<br>' + failedRows.join('<br>');
        errEl.style.display = 'block';
      }
      fileInput.value = '';
      await refreshPortalList();
    } catch (err) {
      uploadBtn.textContent = 'رفع الملف وإنشاء الحسابات';
      errEl.textContent = 'تعذر قراءة الملف: ' + err.message;
      errEl.style.display = 'block';
    }
  };
  reader.readAsArrayBuffer(file);
});

document.getElementById('portal-submit').addEventListener('click', async () => {
  const name = document.getElementById('portal-name').value.trim();
  const title = document.getElementById('portal-title').value.trim();
  const errEl = document.getElementById('portal-error');
  if (!name) { errEl.textContent = 'اكتب اسم الموظف على الأقل'; errEl.style.display = 'block'; return; }
  errEl.style.display = 'none';

  const { error } = await writeWithSchool(extra => sb.from('employees').insert({ full_name: name, job_title: title, ...extra }));
  if (error) { errEl.textContent = 'حدث خطأ: ' + error.message; errEl.style.display = 'block'; return; }

  document.getElementById('portal-name').value = '';
  document.getElementById('portal-title').value = '';
  await refreshPortalList();
});

async function refreshPortalList() {
  const [{ data: emps }, { data: profs }] = await Promise.all([
    readScopedBySchool(scoped => {
      let q = sb.from('employees').select('id, full_name, job_title, profile_id, profiles(full_name, role, login_email)');
      if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
      return q;
    }),
    isAdminOrDeputy() ? readScopedBySchool(scoped => {
      let q = sb.from('profiles').select('id, full_name, role');
      if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
      return q.order('full_name');
    }) : Promise.resolve({ data: [] }),
  ]);
  ptEmps = (emps || []).sort((x, y) => String(x.full_name || '').localeCompare(String(y.full_name || ''), 'ar'));
  ptProfiles = profs || [];
  document.getElementById('portal-add-form').classList.add('hidden');
  document.getElementById('pt-add-toggle').textContent = '+ موظف';
  renderPortalRows();
}

function escP(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function renderPortalRows() {
  const list = document.getElementById('portal-list');
  const admin = isAdminOrDeputy();
  const counts = { all: ptEmps.length, linked: ptEmps.filter(e => e.profile_id).length };
  counts.unlinked = counts.all - counts.linked;
  document.querySelectorAll('#pt-filter button').forEach(b => b.classList.toggle('active', b.dataset.f === ptFilter));
  document.querySelectorAll('#pt-filter .tr-cnt').forEach(el => { el.textContent = counts[el.dataset.c] || ''; });
  const q = ptSearch.replace(/\s+/g, ' ');
  let rows = ptEmps.filter(e => !q || `${e.full_name} ${e.job_title || ''}`.includes(q));
  if (ptFilter === 'linked') rows = rows.filter(e => e.profile_id);
  if (ptFilter === 'unlinked') rows = rows.filter(e => !e.profile_id);
  if (!ptEmps.length) { list.innerHTML = '<div class="ex-empty"><b>لا يوجد موظفون بعد</b><span>اضغط «+ موظف» أو استورد الحسابات من ملف إكسل.</span></div>'; return; }
  if (!rows.length) { list.innerHTML = '<div class="ex-empty"><b>ما فيه نتائج</b></div>'; return; }
  const linkedIds = new Set(ptEmps.map(e => e.profile_id).filter(Boolean));
  const freeProfiles = ptProfiles.filter(p => !linkedIds.has(p.id) && p.role !== 'owner' && p.role !== 'parent');

  list.innerHTML = rows.map(emp => {
    const linked = !!emp.profile_id;
    const loginEmail = linked && emp.profiles ? emp.profiles.login_email : null;
    const loginDisplay = loginEmail ? (loginEmail.endsWith(STAFF_ID_DOMAIN) ? loginEmail.replace(STAFF_ID_DOMAIN, '') : loginEmail) : null;
    const initials = (emp.full_name || '؟').trim().split(' ').slice(0, 2).map(w => w.charAt(0)).join(' ');
    const role = linked && emp.profiles ? roleLabels[emp.profiles.role] || '' : '';
    return `<div class="pt-row ${linked ? '' : 'is-unlinked'}" data-id="${emp.id}">
      <span class="cvt-av">${escP(initials)}</span>
      <span class="pt-main"><b>${escP(emp.full_name)}</b><span>${escP(emp.job_title || '')}</span></span>
      ${linked ? `<span class="pt-acc"><span class="cv-st pub">${escP(role || 'له حساب')}</span>${loginDisplay ? `<span class="pt-login" dir="ltr">${escP(loginDisplay)}</span>` : ''}</span>` : '<span class="cv-st draft">بدون حساب · للتقييم فقط</span>'}
      ${admin ? `<div class="row-menu">
        <button type="button" class="row-menu-btn" aria-label="خيارات">⋯</button>
        <div class="row-menu-pop hidden">
          ${linked ? '<button type="button" class="pt-reset">إعادة تعيين كلمة المرور</button>' : '<button type="button" class="pt-link">ربط بحساب دخول…</button>'}
          <button type="button" class="pt-del danger">حذف من قائمة الموظفين</button>
        </div>
      </div>` : ''}
      <div class="pt-linkbox hidden">
        <select class="pt-link-sel"><option value="">اختر حساب الدخول…</option>${freeProfiles.map(p => `<option value="${p.id}">${escP(p.full_name)} · ${escP(roleLabels[p.role] || p.role)}</option>`).join('')}</select>
        <button type="button" class="btn-primary pt-link-save" style="width:auto; padding:9px 16px;">ربط</button>
        <button type="button" class="btn-secondary pt-link-cancel" style="width:auto; padding:9px 14px;">إلغاء</button>
      </div>
    </div>`;
  }).join('');

  list.querySelectorAll('.pt-row').forEach(row => {
    const emp = ptEmps.find(e => String(e.id) === row.dataset.id);
    const mb = row.querySelector('.row-menu-btn');
    if (mb) mb.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const pop = mb.nextElementSibling; const willOpen = pop.classList.contains('hidden');
      list.querySelectorAll('.row-menu-pop').forEach(p => p.classList.add('hidden'));
      if (willOpen) pop.classList.remove('hidden');
    });
    const linkBtn = row.querySelector('.pt-link');
    if (linkBtn) linkBtn.addEventListener('click', () => {
      row.querySelector('.row-menu-pop').classList.add('hidden');
      const box = row.querySelector('.pt-linkbox'); box.classList.remove('hidden');
      const sel = row.querySelector('.pt-link-sel');
      const guess = freeProfiles.find(p => String(p.full_name || '').trim() === String(emp.full_name || '').trim());
      if (guess) sel.value = guess.id;
      sel.focus();
    });
    row.querySelector('.pt-link-cancel').addEventListener('click', () => row.querySelector('.pt-linkbox').classList.add('hidden'));
    row.querySelector('.pt-link-save').addEventListener('click', async () => {
      const profileId = row.querySelector('.pt-link-sel').value;
      if (!profileId) return;
      const { error } = await sb.from('employees').update({ profile_id: profileId }).eq('id', emp.id);
      if (error) { alert('تعذر الربط: ' + error.message); return; }
      await refreshPortalList();
    });
    const delBtn = row.querySelector('.pt-del');
    if (delBtn) delBtn.addEventListener('click', async () => {
      if (!confirm(`متأكد تبي تحذف "${emp.full_name}" من قائمة الموظفين؟ هذا يحذف سجل التقييم فقط، ولا يحذف حساب الدخول لو موجود.`)) return;
      const { error } = await sb.from('employees').delete().eq('id', emp.id);
      if (error) { alert('تعذر الحذف: ' + error.message); return; }
      await refreshPortalList();
    });
    const resetBtn = row.querySelector('.pt-reset');
    if (resetBtn) resetBtn.addEventListener('click', async () => {
      row.querySelector('.row-menu-pop').classList.add('hidden');
      const newPassword = prompt(`كلمة مرور جديدة لـ "${emp.full_name}" (6 أحرف على الأقل):`);
      if (!newPassword) return;
      if (newPassword.length < 6) { alert('كلمة المرور لازم تكون 6 أحرف أو أكثر'); return; }
      try {
        const { data: sessionData } = await sb.auth.getSession();
        const accessToken = sessionData.session.access_token;
        const res = await fetch(`${SUPABASE_URL}/functions/v1/create-user`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
          body: JSON.stringify({ action: 'reset_password', user_id: emp.profile_id, new_password: newPassword }),
        });
        const result = await res.json();
        if (!res.ok) { alert('حدث خطأ: ' + (result.error || 'غير معروف')); return; }
        alert('تم تحديث كلمة المرور بنجاح');
      } catch (e) {
        alert('تعذر الاتصال بالخادم: ' + e.message);
      }
    });
  });
}

/* ================= إدارة الصلاحيات ================= */
document.getElementById('newuser-submit').addEventListener('click', async () => {
  const name = document.getElementById('newuser-name').value.trim();
  const email = document.getElementById('newuser-email').value.trim();
  const password = document.getElementById('newuser-password').value.trim();
  const role = document.getElementById('newuser-role').value;
  const errEl = document.getElementById('newuser-error');
  const successEl = document.getElementById('newuser-success');
  errEl.style.display = 'none';
  successEl.style.display = 'none';

  if (!name || !email || !password) {
    errEl.textContent = 'كل الحقول مطلوبة';
    errEl.style.display = 'block';
    return;
  }
  if (password.length < 6) {
    errEl.textContent = 'كلمة المرور لازم تكون 6 أحرف أو أكثر';
    errEl.style.display = 'block';
    return;
  }

  const btn = document.getElementById('newuser-submit');
  btn.textContent = 'جارٍ الإنشاء...';

  try {
    const { data: sessionData } = await sb.auth.getSession();
    const accessToken = sessionData.session.access_token;

    const res = await fetch(`${SUPABASE_URL}/functions/v1/create-user`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ email: toLoginEmail(email), password, full_name: name, role }),
    });
    const result = await res.json();

    if (!res.ok) {
      errEl.textContent = 'حدث خطأ: ' + (result.error || 'غير معروف');
      errEl.style.display = 'block';
      return;
    }

    successEl.textContent = `تم إنشاء حساب "${name}" بنجاح بدور ${roleLabels[role]}`;
    successEl.style.display = 'block';
    document.getElementById('newuser-name').value = '';
    document.getElementById('newuser-email').value = '';
    document.getElementById('newuser-password').value = '';

    // إضافة الموظف تلقائيًا لجدول الموظفين (بوابة الموظفين) لو دوره من أدوار طاقم العمل
    if (['admin', 'deputy', 'teacher'].includes(role)) {
      await writeWithSchool(extra => sb.from('employees').insert({
        full_name: name,
        job_title: roleLabels[role],
        profile_id: result.id,
        ...extra,
      }));
    }

    if (role === 'teacher') await loadPermsModule();
  } catch (e) {
    errEl.textContent = 'تعذر الاتصال بالخادم: ' + e.message;
    errEl.style.display = 'block';
  } finally {
    btn.textContent = 'إنشاء الحساب';
  }
});

let pmTeachers = [];
let pmAssignments = [];
let pmSearch = '';
export async function loadPermsModule() {
  const [{ data: teachers }, { data: subjects }] = await Promise.all([
    readScopedBySchool(scoped => {
      let q = sb.from('profiles').select('id, full_name').eq('role', 'teacher');
      if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
      return q.order('full_name');
    }),
    sb.from('subjects').select('id, name').order('name'),
  ]);
  pmTeachers = teachers || [];

  const teacherSelect = document.getElementById('perm-teacher');
  teacherSelect.innerHTML = '';
  pmTeachers.forEach(t => { const o=document.createElement('option'); o.value=t.id; o.textContent=t.full_name; teacherSelect.appendChild(o); });
  if (!pmTeachers.length) teacherSelect.innerHTML = '<option value="">لا يوجد معلمون مضافون بعد</option>';

  const subjectSelect = document.getElementById('perm-subject');
  subjectSelect.innerHTML = '';
  (subjects || []).forEach(s => { const o=document.createElement('option'); o.value=s.id; o.textContent=s.name; subjectSelect.appendChild(o); });

  await refreshPermsList();
}
document.querySelectorAll('#pm-tabs button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('#pm-tabs button').forEach(x => x.classList.toggle('active', x === b));
  document.querySelectorAll('#perms-module .pm-pane').forEach(p => p.classList.toggle('hidden', p.dataset.pane !== b.dataset.p));
}));
document.getElementById('pm-sync-btn').addEventListener('click', async () => {
  const body = document.getElementById('pm-sync-body');
  if (!body.classList.contains('hidden')) { body.classList.add('hidden'); return; }
  body.classList.remove('hidden');
  const { openSubjectSync } = await import('./subject-sync.js');
  openSubjectSync(body, { onApplied: refreshPermsList });
});
document.getElementById('pm-search').addEventListener('input', (e) => { pmSearch = e.target.value.trim(); renderPermsList(); });

document.getElementById('perm-submit').addEventListener('click', async () => {
  const errEl = document.getElementById('perm-error');
  const teacherId = document.getElementById('perm-teacher').value;
  if (!teacherId) { errEl.textContent = 'لا يوجد معلم لتحديده. أضف حساب معلم أولاً من Supabase.'; errEl.style.display = 'block'; return; }
  errEl.style.display = 'none';

  const { error } = await writeWithSchool(extra => sb.from('teacher_subjects').insert({
    teacher_id: teacherId,
    subject_id: document.getElementById('perm-subject').value,
    grade_level: document.getElementById('perm-grade').value,
    ...extra,
  }));

  if (error) {
    errEl.textContent = error.message.includes('duplicate') ? 'هذا التخصيص موجود مسبقًا' : 'حدث خطأ: ' + error.message;
    errEl.style.display = 'block';
    return;
  }
  await refreshPermsList();
});

async function refreshPermsList() {
  const { data: assignments } = await readScopedBySchool(scoped => {
    let q = sb.from('teacher_subjects').select('id, teacher_id, grade_level, profiles(full_name), subjects(name)');
    if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
    return q;
  });
  pmAssignments = assignments || [];
  renderPermsList();
}

function renderPermsList() {
  const list = document.getElementById('perms-list');
  const GR = ['first_intermediate', 'second_intermediate', 'third_intermediate'];
  const byT = new Map();
  pmTeachers.forEach(t => byT.set(t.id, { id: t.id, name: t.full_name, items: [] }));
  pmAssignments.forEach(a => {
    if (!byT.has(a.teacher_id)) byT.set(a.teacher_id, { id: a.teacher_id, name: a.profiles ? a.profiles.full_name : '-', items: [] });
    byT.get(a.teacher_id).items.push(a);
  });
  const all = [...byT.values()];
  const withNone = all.filter(t => !t.items.length).length;
  document.getElementById('pm-stats').innerHTML = `
    <span class="ds"><b>${pmAssignments.length}</b> تخصص</span>
    <span class="ds ds-all"><b>${all.length - withNone}</b> معلم له تخصص</span>
    <span class="ds ${withNone ? 'ds-late' : 'ds-present'}"><b>${withNone}</b> بدون تخصص</span>`;
  const q = pmSearch;
  let rows = all.filter(t => !q || t.name.includes(q) || t.items.some(a => (a.subjects ? a.subjects.name : '').includes(q)));
  rows.sort((x, y) => (x.items.length === 0) - (y.items.length === 0) || String(x.name).localeCompare(String(y.name), 'ar'));
  if (!rows.length) { list.innerHTML = `<div class="ex-empty"><b>${all.length ? 'ما فيه نتائج' : 'لا توجد تخصيصات بعد'}</b></div>`; return; }
  list.innerHTML = rows.map(t => {
    const items = [...t.items].sort((a, b) => GR.indexOf(a.grade_level) - GR.indexOf(b.grade_level) || String(a.subjects ? a.subjects.name : '').localeCompare(String(b.subjects ? b.subjects.name : ''), 'ar'));
    const initials = String(t.name || '؟').trim().split(' ').slice(0, 2).map(w => w.charAt(0)).join(' ');
    return `<div class="pm-teacher ${items.length ? '' : 'is-empty'}">
      <span class="cvt-av">${escP(initials)}</span>
      <div class="pm-main"><b>${escP(t.name)}</b>
        <div class="pm-chips">${items.length ? items.map(a => `<span class="pm-chip">${escP(a.subjects ? a.subjects.name : '-')} · ${escP((gradeLabels[a.grade_level] || '').replace(' متوسط', ''))}<button type="button" data-del="${a.id}" aria-label="حذف التخصص">✕</button></span>`).join('') : '<span class="pm-none">بدون تخصص</span>'}</div>
      </div>
      <button type="button" class="pm-plus" data-t="${t.id}" title="إضافة تخصص لهذا المعلم" aria-label="إضافة تخصص">+</button>
    </div>`;
  }).join('');
  list.querySelectorAll('button[data-del]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('حذف هذا التخصص؟ المعلم ما يقدر يدخّل خطة هذي المادة بعدها.')) return;
    await sb.from('teacher_subjects').delete().eq('id', b.dataset.del);
    await refreshPermsList();
  }));
  list.querySelectorAll('.pm-plus').forEach(b => b.addEventListener('click', () => {
    const sel = document.getElementById('perm-teacher');
    if ([...sel.options].some(o => o.value === b.dataset.t)) sel.value = b.dataset.t;
    document.querySelector('#perms-module .pm-add').scrollIntoView({ block: 'center', behavior: 'smooth' });
    document.getElementById('perm-subject').focus();
  }));
}
