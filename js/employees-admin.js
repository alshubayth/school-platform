import { sb, SUPABASE_URL, currentUserId, roleLabels, gradeLabels,
         isAdminOrDeputy, toLoginEmail, STAFF_ID_DOMAIN, setupCollapsible } from './core.js';

/* ================= بوابة الموظفين ================= */
export async function loadPortalModule() {
  document.getElementById('portal-add-form').classList.toggle('hidden', !isAdminOrDeputy());
  document.getElementById('portal-bulk-form').classList.toggle('hidden', !isAdminOrDeputy());
  await refreshPortalList();
}

setupCollapsible('portal-bulk-toggle', 'portal-bulk-body', 'portal-bulk-chevron');

/* ---------- تنزيل نموذج إكسل لإنشاء حسابات متعددة ---------- */
document.getElementById('portal-download-template').addEventListener('click', () => {
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
            await sb.from('employees').insert({ full_name, job_title: roleLabels[role], profile_id: result.id });
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

  const { error } = await sb.from('employees').insert({ full_name: name, job_title: title });
  if (error) { errEl.textContent = 'حدث خطأ: ' + error.message; errEl.style.display = 'block'; return; }

  document.getElementById('portal-name').value = '';
  document.getElementById('portal-title').value = '';
  await refreshPortalList();
});

async function refreshPortalList() {
  const { data: emps } = await sb.from('employees').select('id, full_name, job_title, profile_id, profiles(full_name, role, login_email)');
  const list = document.getElementById('portal-list');
  list.innerHTML = '';

  if (!emps || emps.length === 0) {
    list.innerHTML = '<div class="placeholder" style="padding:30px;"><p>لا يوجد موظفون بعد</p></div>';
    return;
  }

  emps.forEach(emp => {
    const row = document.createElement('div');
    row.className = 'emp-row';
    row.style.flexWrap = 'wrap';

    const linked = !!emp.profile_id;
    const loginEmail = linked && emp.profiles ? emp.profiles.login_email : null;
    const loginDisplay = loginEmail
      ? (loginEmail.endsWith(STAFF_ID_DOMAIN) ? loginEmail.replace(STAFF_ID_DOMAIN, '') + ' (رقم وظيفي)' : loginEmail)
      : null;
    const statusHtml = linked
      ? `<span style="font-size:12px; background:var(--meadow-light); color:var(--meadow); padding:3px 10px; border-radius:20px;">مرتبط بحساب · ${roleLabels[emp.profiles ? emp.profiles.role : ''] || ''}${loginDisplay ? ' · ' + loginDisplay : ''}</span>`
      : `<span style="font-size:12px; background:#F1EFE8; color:var(--slate); padding:3px 10px; border-radius:20px;">بدون حساب دخول (للتقييم فقط)</span>`;

    let linkFormHtml = '';
    if (!linked && isAdminOrDeputy()) {
      linkFormHtml = `
        <div style="display:flex; gap:8px; margin-top:10px; width:100%;">
          <input type="text" class="link-id-input" placeholder="الصق ID حساب الدخول هنا" style="flex:1; padding:9px 12px; border:1.5px solid #E4E2D9; border-radius:8px; font-size:13px;" />
          <button class="link-btn" style="padding:8px 16px; background:var(--meadow); color:#fff; font-size:13px; white-space:nowrap;">ربط بحساب</button>
        </div>`;
    }

    let actionsHtml = '';
    if (isAdminOrDeputy()) {
      actionsHtml = `<div style="display:flex; gap:8px; margin-top:10px; width:100%;">`;
      if (linked) {
        actionsHtml += `<button class="reset-pw-btn" style="padding:8px 14px; background:var(--sand); color:var(--ink); font-size:13px; border:1px solid #E4E2D9;">إعادة تعيين كلمة المرور</button>`;
      }
      actionsHtml += `<button class="delete-emp-btn" style="padding:8px 14px; background:var(--danger-light); color:var(--danger); font-size:13px; margin-right:auto;">حذف الموظف</button></div>`;
    }

    row.innerHTML = `
      <div>
        <div class="name">${emp.full_name}</div>
        <div class="title">${emp.job_title || ''}</div>
      </div>
      ${statusHtml}
      ${linkFormHtml}
      ${actionsHtml}`;

    if (!linked && isAdminOrDeputy()) {
      row.querySelector('.link-btn').addEventListener('click', async () => {
        const idInput = row.querySelector('.link-id-input');
        const profileId = idInput.value.trim();
        if (!profileId) return;
        const { error } = await sb.from('employees').update({ profile_id: profileId }).eq('id', emp.id);
        if (error) { alert('تعذر الربط: ' + error.message); return; }
        await refreshPortalList();
      });
    }

    if (isAdminOrDeputy()) {
      const deleteBtn = row.querySelector('.delete-emp-btn');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', async () => {
          if (!confirm(`متأكد تبي تحذف "${emp.full_name}" من قائمة الموظفين؟ هذا يحذف سجل التقييم فقط، ولا يحذف حساب الدخول لو موجود.`)) return;
          const { error } = await sb.from('employees').delete().eq('id', emp.id);
          if (error) { alert('تعذر الحذف: ' + error.message); return; }
          await refreshPortalList();
        });
      }

      const resetBtn = row.querySelector('.reset-pw-btn');
      if (resetBtn) {
        resetBtn.addEventListener('click', async () => {
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
      }
    }
    list.appendChild(row);
  });
}


/* ================= إنشاء حساب دخول جديد (Edge Function) ================= */
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
      await sb.from('employees').insert({
        full_name: name,
        job_title: roleLabels[role],
        profile_id: result.id,
      });
    }

    if (role === 'teacher') await loadPermsModule();
  } catch (e) {
    errEl.textContent = 'تعذر الاتصال بالخادم: ' + e.message;
    errEl.style.display = 'block';
  } finally {
    btn.textContent = 'إنشاء الحساب';
  }
});

export async function loadPermsModule() {
  const [{ data: teachers }, { data: subjects }] = await Promise.all([
    sb.from('profiles').select('id, full_name').eq('role', 'teacher'),
    sb.from('subjects').select('id, name').order('name'),
  ]);

  const teacherSelect = document.getElementById('perm-teacher');
  teacherSelect.innerHTML = '';
  (teachers || []).forEach(t => { const o=document.createElement('option'); o.value=t.id; o.textContent=t.full_name; teacherSelect.appendChild(o); });
  if (!teachers || teachers.length === 0) {
    teacherSelect.innerHTML = '<option value="">لا يوجد معلمون مضافون بعد</option>';
  }

  const subjectSelect = document.getElementById('perm-subject');
  subjectSelect.innerHTML = '';
  (subjects || []).forEach(s => { const o=document.createElement('option'); o.value=s.id; o.textContent=s.name; subjectSelect.appendChild(o); });

  await refreshPermsList();
}

document.getElementById('perm-submit').addEventListener('click', async () => {
  const errEl = document.getElementById('perm-error');
  const teacherId = document.getElementById('perm-teacher').value;
  if (!teacherId) { errEl.textContent = 'لا يوجد معلم لتحديده. أضف حساب معلم أولاً من Supabase.'; errEl.style.display = 'block'; return; }
  errEl.style.display = 'none';

  const { error } = await sb.from('teacher_subjects').insert({
    teacher_id: teacherId,
    subject_id: document.getElementById('perm-subject').value,
    grade_level: document.getElementById('perm-grade').value,
  });

  if (error) {
    errEl.textContent = error.message.includes('duplicate') ? 'هذا التخصيص موجود مسبقًا' : 'حدث خطأ: ' + error.message;
    errEl.style.display = 'block';
    return;
  }
  await refreshPermsList();
});

async function refreshPermsList() {
  const { data: assignments } = await sb.from('teacher_subjects')
    .select('id, grade_level, profiles(full_name), subjects(name)');

  const list = document.getElementById('perms-list');
  list.innerHTML = '';
  if (!assignments || assignments.length === 0) {
    list.innerHTML = '<div class="placeholder" style="padding:30px;"><p>لا توجد تخصيصات بعد</p></div>';
    return;
  }
  assignments.forEach(a => {
    const row = document.createElement('div');
    row.className = 'emp-row';
    row.innerHTML = `
      <div><div class="name">${a.profiles ? a.profiles.full_name : '-'}</div>
      <div class="title">${a.subjects ? a.subjects.name : '-'} · ${gradeLabels[a.grade_level]}</div></div>
      <button class="logout-icon" data-id="${a.id}" title="حذف" style="color:var(--danger);">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>
      </button>`;
    row.querySelector('button').addEventListener('click', async (e) => {
      await sb.from('teacher_subjects').delete().eq('id', e.currentTarget.dataset.id);
      await refreshPermsList();
    });
    list.appendChild(row);
  });
}
