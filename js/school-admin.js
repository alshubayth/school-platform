import { sb, tiles } from './core.js';

/* ===== إدارة المدارس والخدمات - خاص بحساب "المالك" (owner) بس =====
 * المرحلة الأولى من دعم تعدد المدارس: إضافة مدرسة جديدة، وتفعيل/تعطيل أي خدمة (تبويب) لكل
 * مدرسة على حدة عن طريق جدول school_modules. هذا التبويب ما يتحكم ببيانات المدارس (طلاب،
 * اختبارات...) - بس بالتنقل بينها وبقائمة الخدمات الظاهرة لها. */

// كل مفتاح خدمة ممكن تفعيله/تعطيله لمدرسة = نفس "key" بقائمة tiles، ما عدا تبويب إدارة المدارس نفسه
const TOGGLABLE_MODULES = tiles.filter(t => t.key !== 'schools-admin');

function esc(s) { const d = document.createElement('div'); d.textContent = String(s ?? ''); return d.innerHTML; }

export async function loadSchoolAdminModule() {
  document.getElementById('sa-add-error').style.display = 'none';
  document.getElementById('sa-add-school-btn').onclick = addSchool;
  await renderSchoolsList();
}

async function addSchool() {
  const errEl = document.getElementById('sa-add-error');
  errEl.style.display = 'none';
  const name = document.getElementById('sa-new-name').value.trim();
  let slug = document.getElementById('sa-new-slug').value.trim();
  if (!name) { errEl.textContent = 'اكتب اسم المدرسة'; errEl.style.display = 'block'; return; }
  if (!slug) slug = name.replace(/[^a-zA-Z0-9؀-ۿ]+/g, '-').toLowerCase();

  const { error } = await sb.from('schools').insert({ name, slug });
  if (error) { errEl.textContent = 'تعذر إضافة المدرسة: ' + error.message; errEl.style.display = 'block'; return; }

  document.getElementById('sa-new-name').value = '';
  document.getElementById('sa-new-slug').value = '';
  await renderSchoolsList();
}

async function renderSchoolsList() {
  const wrap = document.getElementById('sa-schools-list');
  wrap.innerHTML = '<p style="color:var(--slate); font-size:13px;">جارٍ التحميل...</p>';

  const [{ data: schools, error: schoolsErr }, { data: allModules, error: modulesErr }] = await Promise.all([
    sb.from('schools').select('id, name, slug').order('name'),
    sb.from('school_modules').select('school_id, module_key, enabled'),
  ]);

  if (schoolsErr) { wrap.innerHTML = `<div class="error-msg">تعذر تحميل المدارس: ${esc(schoolsErr.message)}</div>`; return; }
  if (!schools || !schools.length) { wrap.innerHTML = '<p style="color:var(--slate); font-size:13px;">ما فيه أي مدرسة مضافة بعد - أضف وحدة من النموذج أعلاه.</p>'; return; }

  const modulesBySchool = new Map();
  (allModules || []).forEach(m => {
    if (!modulesBySchool.has(m.school_id)) modulesBySchool.set(m.school_id, new Map());
    modulesBySchool.get(m.school_id).set(m.module_key, m.enabled);
  });

  wrap.innerHTML = schools.map(s => {
    const enabledMap = modulesBySchool.get(s.id) || new Map();
    return `
    <div class="form-card" style="margin-bottom:14px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
        <h4 style="margin:0;">${esc(s.name)}</h4>
        <span style="font-size:11.5px; color:var(--slate);">${esc(s.slug || '')}</span>
      </div>
      <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(200px,1fr)); gap:8px;">
        ${TOGGLABLE_MODULES.map(t => `
          <label style="font-size:12.5px; display:flex; align-items:center; gap:6px; font-weight:400;">
            <input type="checkbox" class="sa-module-cb" data-school="${s.id}" data-module="${t.key}" style="width:auto; margin:0;"${enabledMap.get(t.key) ? ' checked' : ''} />
            ${esc(t.title)}
          </label>`).join('')}
      </div>
      <div class="error-msg sa-school-error" data-school="${s.id}" style="margin-top:8px; display:none;"></div>
    </div>`;
  }).join('');

  wrap.querySelectorAll('.sa-module-cb').forEach(cb => {
    cb.addEventListener('change', () => toggleModule(cb.dataset.school, cb.dataset.module, cb.checked, cb));
  });
}

async function toggleModule(schoolId, moduleKey, enabled, cbEl) {
  const errEl = document.querySelector(`.sa-school-error[data-school="${schoolId}"]`);
  if (errEl) { errEl.style.display = 'none'; }
  const { error } = await sb.from('school_modules')
    .upsert({ school_id: schoolId, module_key: moduleKey, enabled }, { onConflict: 'school_id,module_key' });
  if (error) {
    cbEl.checked = !enabled; // نرجّع الصندوق لحالته الأصلية لو فشل الحفظ
    if (errEl) { errEl.textContent = 'تعذر الحفظ: ' + error.message; errEl.style.display = 'block'; }
  }
}
