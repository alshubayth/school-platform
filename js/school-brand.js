import { sb, currentSchoolId, schoolBrand, setSchoolBrandFromRow, PLATFORM_NAME } from './core.js';

/* ===== هوية المدرسة: الاسم والشعارات =====
 * تنحفظ بعمود schools.branding عن طريق الدالة set_school_branding (sql/branding.sql)،
 * والشعارات تنحفظ كصور مصغّرة داخلها (بدون الحاجة لمخزن ملفات). */
let draft = null;
let bound = false;
const RC_LOGO = new URL('logo-rc.png', window.location.href).href;
const $ = id => document.getElementById(id);

export function initBrandPane() {
  draft = {
    name: schoolBrand.name || '',
    short: (schoolBrand.raw && schoolBrand.raw.short_name) || '',
    principal: schoolBrand.principal || '',
    school_logo: schoolBrand.logo || null,
    authority: schoolBrand.authority || 'none',
    authority_name: (schoolBrand.raw && schoolBrand.raw.authority_name) || '',
    authority_logo: (schoolBrand.raw && schoolBrand.raw.authority_logo) || null,
  };
  $('br-name').value = draft.name;
  $('br-short').value = draft.short;
  $('br-principal').value = draft.principal;
  $('br-auth-name').value = draft.authority_name;
  $('br-error').style.display = 'none';
  $('br-saved').classList.add('hidden');
  if (!bound) bind();
  render();
}

function bind() {
  bound = true;
  $('br-name').addEventListener('input', e => { draft.name = e.target.value; render(); });
  $('br-short').addEventListener('input', e => { draft.short = e.target.value; render(); });
  $('br-principal').addEventListener('input', e => { draft.principal = e.target.value; render(); });
  $('br-auth-name').addEventListener('input', e => { draft.authority_name = e.target.value; render(); });
  $('br-authority').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { draft.authority = b.dataset.a; render(); }));
  $('br-school-logo-file').addEventListener('change', e => pickImage(e, url => { draft.school_logo = url; render(); }));
  $('br-auth-logo-file').addEventListener('change', e => pickImage(e, url => { draft.authority_logo = url; render(); }));
  $('br-school-logo-remove').addEventListener('click', () => { draft.school_logo = null; render(); });
  $('br-auth-logo-remove').addEventListener('click', () => { draft.authority_logo = null; render(); });
  $('br-save').addEventListener('click', save);
}

// تصغير الصورة (أطول ضلع 360 بكسل) قبل حفظها
function pickImage(e, done) {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const err = $('br-error');
  err.style.display = 'none';
  if (file.size > 5 * 1024 * 1024) { err.textContent = 'حجم الصورة كبير، اختر صورة أقل من 5 ميجا'; err.style.display = 'block'; return; }
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const max = 360;
      const k = Math.min(1, max / Math.max(img.naturalWidth || max, img.naturalHeight || max));
      const w = Math.max(1, Math.round((img.naturalWidth || max) * k)), h = Math.max(1, Math.round((img.naturalHeight || max) * k));
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      done(c.toDataURL('image/png'));
    };
    img.onerror = () => { err.textContent = 'تعذر قراءة الصورة، جرّب ملف PNG أو JPG'; err.style.display = 'block'; };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

function logoBox(el, src, emptyText) {
  el.innerHTML = src ? `<img src="${src}" alt="" />` : `<span>${emptyText}</span>`;
  el.classList.toggle('is-empty', !src);
}

function render() {
  $('br-saved').classList.add('hidden');
  $('br-authority').querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.a === draft.authority));
  $('br-custom').classList.toggle('hidden', draft.authority !== 'custom');
  logoBox($('br-school-logo-box'), draft.school_logo, 'بدون شعار');
  logoBox($('br-auth-logo-box'), draft.authority_logo, 'بدون شعار');
  $('br-school-logo-remove').classList.toggle('hidden', !draft.school_logo);
  $('br-auth-logo-remove').classList.toggle('hidden', !draft.authority_logo);
  // المعاينة
  const shortName = draft.short.trim() || draft.name.trim() || PLATFORM_NAME;
  $('br-prev-nav-logo').src = draft.school_logo || 'logo.png';
  $('br-prev-nav-name').textContent = shortName;
  const docLogo = draft.authority === 'rc' ? RC_LOGO : draft.authority === 'custom' ? draft.authority_logo : null;
  const headLogo = docLogo || draft.school_logo;
  $('br-prev-doc-logo').innerHTML = headLogo ? `<img src="${headLogo}" alt="" />` : '';
  $('br-prev-doc-name').textContent = draft.name.trim() || shortName;
}

async function save() {
  const err = $('br-error');
  err.style.display = 'none';
  $('br-saved').classList.add('hidden');
  const name = draft.name.trim();
  if (!name) { err.textContent = 'اكتب اسم المدرسة الرسمي'; err.style.display = 'block'; return; }
  if (draft.authority === 'custom' && !draft.authority_name.trim() && !draft.authority_logo) { err.textContent = 'اكتب اسم الجهة أو ارفع شعارها، أو اختر "بدون"'; err.style.display = 'block'; return; }
  if (!currentSchoolId) { err.textContent = 'ما فيه مدرسة محددة لهذا الحساب'; err.style.display = 'block'; return; }
  const branding = { authority: draft.authority };
  if (draft.short.trim()) branding.short_name = draft.short.trim();
  if (draft.principal.trim()) branding.principal_name = draft.principal.trim();
  if (draft.school_logo) branding.school_logo = draft.school_logo;
  if (draft.authority === 'custom') {
    if (draft.authority_name.trim()) branding.authority_name = draft.authority_name.trim();
    if (draft.authority_logo) branding.authority_logo = draft.authority_logo;
  }
  const btn = $('br-save');
  btn.disabled = true; btn.textContent = 'جارٍ الحفظ...';
  const { error } = await sb.rpc('set_school_branding', { p_school: currentSchoolId, p_name: name, p_branding: branding });
  btn.disabled = false; btn.textContent = 'حفظ الهوية';
  if (error) {
    const missing = /set_school_branding|function|schema cache/i.test(error.message || '');
    err.textContent = missing ? 'ميزة الهوية تحتاج تشغيل ملف sql/branding.sql بقاعدة البيانات أولًا' : 'تعذر الحفظ: ' + error.message;
    err.style.display = 'block';
    return;
  }
  setSchoolBrandFromRow({ id: currentSchoolId, slug: schoolBrand.slug, name, branding });
  $('br-saved').classList.remove('hidden');
}

