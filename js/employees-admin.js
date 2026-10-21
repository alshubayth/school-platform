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
  const note = ['الدور: اكتب أحد هذه الخيارات بدقة → معلم / وكيل / مدير (افتراضيًا معلم إذا تُرك فارغًا). يقبل العمود الثاني رقمًا وظيفيًا بدون @ أو بريدًا إلكترونيًا حقيقيًا.', '', '', ''];
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
    errEl.textContent = 'اختر ملف إكسل أولًا';
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
  if (!rows.length) { list.innerHTML = '<div class="ex-empty"><b>لا توجد نتائج</b></div>'; return; }
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
      if (!confirm(`هل أنت متأكد من حذف "${emp.full_name}" من قائمة الموظفين؟ يحذف هذا سجل التقييم فقط، ولا يحذف حساب الدخول إن وُجد.`)) return;
      const { error } = await sb.from('employees').delete().eq('id', emp.id);
      if (error) { alert('تعذر الحذف: ' + error.message); return; }
      // موظف منقول: نشيل تخصصاته عشان ما يطلع بالخطة الأسبوعية ومتابعاتها
      if (emp.profile_id && confirm(`تحذف تخصصات "${emp.full_name}" أيضًا؟ (إذا انتقل من المدرسة)`)) {
        await sb.from('teacher_subjects').delete().eq('teacher_id', emp.profile_id);
      }
      await refreshPortalList();
    });
    const resetBtn = row.querySelector('.pt-reset');
    if (resetBtn) resetBtn.addEventListener('click', async () => {
      row.querySelector('.row-menu-pop').classList.add('hidden');
      const newPassword = prompt(`كلمة مرور جديدة لـ "${emp.full_name}" (6 أحرف على الأقل):`);
      if (!newPassword) return;
      if (newPassword.length < 6) { alert('يجب أن تتكون كلمة المرور من 6 أحرف أو أكثر'); return; }
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
    errEl.textContent = 'يجب أن تتكون كلمة المرور من 6 أحرف أو أكثر';
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
let pmSchedule = [];   // حصص الجدول الدراسي (للفصول المسندة لكل معلم)
const pmNorm = v => String(v || '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').split(/\s+/).filter(w => w && !['بن', 'ابن', 'بنت'].includes(w)).map(w => w.replace(/^ال(?=..)/, '')).join(' ');
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
  if (!teacherId) { errEl.textContent = 'لا يوجد معلم لتحديده. أضف حساب معلم أولًا من Supabase.'; errEl.style.display = 'block'; return; }
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
  try { const { loadSchedule } = await import('./subject-sync.js'); pmSchedule = ((await loadSchedule()).data) || []; } catch (e) { pmSchedule = []; }
  renderPermsList();
}

// الفصول المسندة للمعلم من الجدول: بحسابه (teacher_id) أو باسمه
function classesOf(t) {
  const n = pmNorm(t.name);
  const fl = w => { const a = w.split(' '); return a[0] + '|' + a[a.length - 1]; };
  const same = name => { const m = pmNorm(name); return m === n || (m.split(' ').length >= 2 && fl(m) === fl(n)); };
  const rows = pmSchedule.filter(r => r.teacher_id ? r.teacher_id === t.id : same(r.teacher_name));
  const m = new Map();
  rows.forEach(r => { const k = r.grade_level + '|' + (r.class_section || 0); if (!m.has(k)) m.set(k, { grade: r.grade_level, section: r.class_section || 0, n: 0, subjects: new Set() }); const c = m.get(k); c.n++; if (r.subject_name) c.subjects.add(r.subject_name); });
  const GR = ['first_intermediate', 'second_intermediate', 'third_intermediate'];
  return [...m.values()].sort((a, b) => GR.indexOf(a.grade) - GR.indexOf(b.grade) || a.section - b.section);
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
  if (!rows.length) { list.innerHTML = `<div class="ex-empty"><b>${all.length ? 'لا توجد نتائج' : 'لا توجد تخصيصات بعد'}</b></div>`; return; }
  list.innerHTML = rows.map(t => {
    const items = [...t.items].sort((a, b) => GR.indexOf(a.grade_level) - GR.indexOf(b.grade_level) || String(a.subjects ? a.subjects.name : '').localeCompare(String(b.subjects ? b.subjects.name : ''), 'ar'));
    const initials = String(t.name || '؟').trim().split(' ').slice(0, 2).map(w => w.charAt(0)).join(' ');
    return `<div class="pm-teacher ${items.length ? '' : 'is-empty'}">
      <span class="cvt-av">${escP(initials)}</span>
      <div class="pm-main"><b>${escP(t.name)}</b>
        <div class="pm-line"><span class="pm-lbl">التخصص</span><div class="pm-chips">${items.length ? items.map(a => `<span class="pm-chip">${escP(a.subjects ? a.subjects.name : '-')} · ${escP((gradeLabels[a.grade_level] || '').replace(' متوسط', ''))}<button type="button" data-del="${a.id}" aria-label="حذف التخصص">✕</button></span>`).join('') : '<span class="pm-none">بدون تخصص</span>'}</div></div>
        ${(() => { const cl = classesOf(t); return pmSchedule.length ? `<div class="pm-line"><span class="pm-lbl">الفصول المسندة</span><div class="pm-chips">${cl.length ? cl.map(c => `<span class="pm-cls" title="${escP([...c.subjects].join('، '))} · ${c.n} حصة">${escP((gradeLabels[c.grade] || '').replace(' متوسط', ''))}/${escP(c.section)}</span>`).join('') + `<span class="pm-cnt">${cl.reduce((s, c) => s + c.n, 0)} حصة</span>` : '<span class="pm-none muted">ليست له حصص في الجدول</span>'}</div></div>` : ''; })()}
      </div>
      <button type="button" class="pm-plus" data-t="${t.id}" title="إضافة تخصص لهذا المعلم" aria-label="إضافة تخصص">+</button>
    </div>`;
  }).join('');
  list.querySelectorAll('button[data-del]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('حذف هذا التخصص؟ لن يتمكن المعلم بعدها من إدخال خطة هذه المادة.')) return;
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


/* ---------- متابعة دخول الموظفين: آخر دخول لكل موظف، وتذكير من لم يدخل عبر واتساب ---------- */
const LG_GROUPS = [
  ['week', 'دخلوا خلال 7 أيام'],
  ['old', 'آخر دخول قبل أكثر من أسبوع'],
  ['never', 'لم يدخلوا المنصة أبدًا'],
];
let lgRows = [], lgFilter = 'all', lgQ = '';
const lgGroup = r => (!r.last_sign_in_at ? 'never' : (Date.now() - new Date(r.last_sign_in_at)) / 864e5 <= 7 ? 'week' : 'old');
function lgAgo(ts) {
  if (!ts) return 'لم يدخل';
  const d = new Date(ts), days = Math.floor((Date.now() - d) / 864e5);
  const time = d.toLocaleTimeString('ar-SA-u-nu-latn', { hour: 'numeric', minute: '2-digit' });
  if (days < 1 && new Date().toDateString() === d.toDateString()) return `اليوم ${time}`;
  if (days < 2) return `أمس ${time}`;
  if (days <= 10) return `قبل ${days} ${days <= 10 ? 'أيام' : 'يومًا'}`;
  return d.toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'long' });
}
function lgWaLink(r) {
  let ph = String(r.phone || '').replace(/[^\d]/g, '');
  if (ph.startsWith('00')) ph = ph.slice(2);
  if (ph.startsWith('05')) ph = '966' + ph.slice(1);
  else if (ph.startsWith('5') && ph.length === 9) ph = '966' + ph;
  const first = String(r.full_name || '').split(/\s+/)[0] || '';
  const msg = r.last_sign_in_at
    ? `السلام عليكم أستاذ ${first}،\nنذكّركم بمتابعة منصة مُدار للاطلاع على مهامكم وجدولكم وتقارير اختباراتكم:\n${location.origin}`
    : `السلام عليكم أستاذ ${first}،\nحسابكم في منصة مُدار جاهز، نأمل الدخول للاطلاع على جدولكم ومهامكم وتقارير اختباراتكم:\n${location.origin}\nاسم المستخدم: رقمكم الوظيفي.`;
  // بلا رقم جوال: واتساب يفتح لاختيار جهة الاتصال
  return `https://wa.me/${ph || ''}?text=${encodeURIComponent(msg)}`;
}
async function openLoginTracker() {
  const back = document.createElement('div');
  back.className = 'er-abs-back';
  back.innerHTML = `<div class="er-abs lg-modal" role="dialog" aria-modal="true" aria-label="متابعة دخول الموظفين">
    <div class="er-abs-h"><div><b>متابعة دخول الموظفين</b><span id="lg-sub">جارٍ التحميل...</span></div><button type="button" class="er-abs-x" aria-label="إغلاق">✕</button></div>
    <div class="er-abs-body"><div id="lg-body"><div class="tx-loading"><span></span><span></span><span></span></div></div></div>
  </div>`;
  document.body.appendChild(back);
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  back.querySelector('.er-abs-x').onclick = close;
  back.addEventListener('click', e => { if (e.target === back) close(); });
  const { data, error } = await sb.rpc('staff_last_login', { p_school: currentSchoolId || null });
  if (error) { back.querySelector('#lg-body').innerHTML = `<p class="sp-none">تعذر التحميل: ${escP(error.message)}</p>`; return; }
  lgRows = (data || []).filter(r => r.full_name);
  lgFilter = 'all'; lgQ = '';
  renderLoginTracker(back);
}
function renderLoginTracker(back) {
  const cnt = { week: 0, old: 0, never: 0 };
  lgRows.forEach(r => cnt[lgGroup(r)]++);
  back.querySelector('#lg-sub').textContent = `${lgRows.length} موظفًا · ${cnt.week} دخلوا هذا الأسبوع · ${cnt.never} لم يدخلوا أبدًا`;
  const q = lgQ.trim();
  const list = lgRows.filter(r => (lgFilter === 'all' || lgGroup(r) === lgFilter) && (!q || r.full_name.includes(q)))
    .sort((a, b) => (b.last_sign_in_at || '').localeCompare(a.last_sign_in_at || '') || a.full_name.localeCompare(b.full_name, 'ar'));
  const groups = LG_GROUPS.map(([k, t]) => [k, t, list.filter(r => lgGroup(r) === k)]).filter(([, , l]) => l.length);
  const body = back.querySelector('#lg-body');
  body.innerHTML = `
    <div class="lg-tiles">
      <button type="button" data-f="all" class="${lgFilter === 'all' ? 'on' : ''}"><b>${lgRows.length}</b><span>الكل</span></button>
      <button type="button" data-f="week" class="ok${lgFilter === 'week' ? ' on' : ''}"><b>${cnt.week}</b><span>خلال 7 أيام</span></button>
      <button type="button" data-f="old" class="warn${lgFilter === 'old' ? ' on' : ''}"><b>${cnt.old}</b><span>أكثر من أسبوع</span></button>
      <button type="button" data-f="never" class="bad${lgFilter === 'never' ? ' on' : ''}"><b>${cnt.never}</b><span>لم يدخلوا أبدًا</span></button>
    </div>
    <div class="lg-tools"><input type="search" id="lg-q" placeholder="ابحث باسم الموظف" value="${escP(lgQ)}" />
      ${lgFilter !== 'week' && list.some(r => lgGroup(r) !== 'week') ? '<a class="lg-wa lg-group" id="lg-group" target="_blank" rel="noopener">رسالة للمجموعة</a><button type="button" class="btn-secondary" id="lg-copy">نسخ الأسماء</button>' : ''}</div>
    ${groups.map(([k, t, l]) => `<h5 class="lg-gh ${k}">${t} <small>${l.length}</small></h5>
      <ul class="lg-list">${l.map(r => { const wa = lgWaLink(r); return `<li>
        <span class="lg-dot ${k}"></span>
        <span class="lg-name"><b>${escP(r.full_name)}</b><small>${escP(roleLabels[r.role] || r.role)}</small></span>
        <span class="lg-when">${lgAgo(r.last_sign_in_at)}</span>
        ${k === 'week' ? '' : `<a class="lg-wa" href="${wa}" target="_blank" rel="noopener" title="إرسال تذكير عبر واتساب">تذكير واتساب</a>`}
      </li>`; }).join('')}</ul>`).join('') || '<p class="sp-none">لا يوجد موظف مطابق</p>'}`;
  body.querySelectorAll('.lg-tiles button').forEach(b => b.onclick = () => { lgFilter = b.dataset.f; renderLoginTracker(back); });
  const qi = body.querySelector('#lg-q');
  qi.oninput = () => { lgQ = qi.value; const pos = qi.selectionStart; renderLoginTracker(back); const n = back.querySelector('#lg-q'); n.focus(); n.setSelectionRange(pos, pos); };
  const grp = body.querySelector('#lg-group');
  if (grp) {
    const names = list.filter(r => lgGroup(r) !== 'week').map((r, i) => `${i + 1}. ${r.full_name}`).join('\n');
    grp.href = `https://wa.me/?text=${encodeURIComponent(`السلام عليكم ورحمة الله،\nنأمل من الزملاء التالية أسماؤهم الدخول إلى منصة مُدار للاطلاع على جداولهم ومهامهم وتقارير اختباراتهم:\n${names}\n\nرابط المنصة: ${location.origin}\nاسم المستخدم: الرقم الوظيفي.`)}`;
  }
  const cp = body.querySelector('#lg-copy');
  if (cp) cp.onclick = async () => {
    const txt = list.filter(r => lgGroup(r) !== 'week').map((r, i) => `${i + 1}. ${r.full_name} (${lgAgo(r.last_sign_in_at)})`).join('\n');
    try { await navigator.clipboard.writeText(txt); cp.textContent = 'تم النسخ ✓'; } catch { cp.textContent = 'تعذر النسخ'; }
  };
}
const lgBtn = document.getElementById('pt-login-btn');
if (lgBtn) lgBtn.addEventListener('click', openLoginTracker);
