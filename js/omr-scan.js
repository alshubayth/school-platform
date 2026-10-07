/* =========================================================================
 * التصحيح بكاميرا الجوال (مساند للسكانر / Remark)
 *
 * المعلم (أو الإدارة) يختار مفتاح الاختبار المحفوظ، ويصوّر أوراق الطلاب: المنصة تلقى علامات الزوايا
 * وتقرأ الباركود (رقم الهوية) والفقاعات، ويراجع النتيجة ويحفظها. كل ورقة تنحفظ بجدول exam_scans،
 * والتقرير (exam_reports) ينبني منها بنفس صيغة تقارير Remark عشان كل التحليلات تشتغل.
 * المعلم يشوف تقاريره هو بس (RLS)، والإدارة تشوف الكل ومن صحح.
 * ========================================================================= */
import { sb, currentUserId, currentProfile, currentSchoolId, readScopedBySchool, writeWithSchool, gradeLabels } from './core.js';
import { fetchSavedKeys, sheetGeometry, PAGE, itemKinds, TF_LETTERS } from './answer-sheet.js';
import { grayFromImageData, findMarkInRegion, locateSheet, readSheet, rectifyToCanvas } from './omr.js';
import { computeExamStats, gradeWithModels, rawFromIdx } from './exam-reports.js';

const AR = ['أ', 'ب', 'ج', 'د', 'هـ', 'و'];
const EN = ['A', 'B', 'C', 'D', 'E', 'F'];
const KEY_ID = '0000000000';
const MODEL_A = 'أ', MODEL_B = 'ب';
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = id => document.getElementById(id);
const normAr = s => String(s || '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, ' ').trim();

const S = {
  keys: [], key: null, geo: null, report: null, scans: new Map(), students: [], byId: new Map(),
  queue: [], cam: null, opts: {}, busy: false,
};

/* ---------- تحميل ---------- */
export async function openOmrPanel(opts = {}) {
  S.opts = opts;
  const root = $('omr-root');
  root.innerHTML = '<div class="placeholder" style="padding:20px;"><p>جارٍ التحميل...</p></div>';
  const [keysRes] = await Promise.all([fetchSavedKeys(), loadStudents()]);
  if (keysRes.error) { root.innerHTML = `<div class="omr-err">${esc(keysRes.error)}</div>`; return; }
  S.keys = keysRes.data.filter(k => k.questions > 0 || k.essay_total > 0);
  renderPanel();
  const want = opts.keyId || (S.key && S.key.id);
  if (want && S.keys.some(k => k.id === want)) { $('omr-key').value = want; await selectKey(want); }
}

async function loadStudents() {
  if (S.students.length) return;
  const { data } = await readScopedBySchool(scoped => {
    let q = sb.from('students').select('full_name, national_id, grade_level, class_section');
    if (scoped && currentSchoolId) q = q.eq('school_id', currentSchoolId);
    return q;
  });
  S.students = (data || []).filter(s => s.national_id);
  S.byId = new Map(S.students.map(s => [String(s.national_id).trim(), s]));
}

function keyOpts(k) {
  const m = k.models && k.models.mode ? k.models : null;
  return { size: k.size || 'A4', questions: k.questions, choices: k.choices, lang: k.lang || 'ar', essayTotal: k.essay_total || 0, modelsOn: !!m, modelBubble: !!(m && m.assign === 'bubble'), tf: k.tf_count || 0, tfFirst: k.tf_first !== false };
}

/* ---------- لوحة اختيار الاختبار والأوراق المصححة ---------- */
function renderPanel() {
  const root = $('omr-root');
  if (!S.keys.length) {
    root.innerHTML = `<div class="ex-empty"><b>ما فيه مفاتيح إجابة محفوظة</b><span>التصحيح بالجوال يحتاج مفتاح الاختبار محفوظ من «ورقة الإجابة والمفتاح»${currentProfile && currentProfile.role === 'teacher' ? ' - اطلبه من الإدارة' : ''}.</span></div>`;
    return;
  }
  root.innerHTML = `
    <div class="form-card omr-card">
      <div class="omr-head">
        <span class="omr-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="12" r="3.2"/></svg></span>
        <div><b>التصحيح بكاميرا الجوال</b><span>خيار مساند للسكانر: صوّر ورقة الطالب والمنصة تقرأ الباركود والإجابات وتطلع التقرير</span></div>
      </div>
      <label class="omr-lbl" for="omr-key">الاختبار (المفتاح المحفوظ)</label>
      <select id="omr-key"><option value="">اختر الاختبار...</option>${S.keys.map(k => `<option value="${k.id}">${esc(k.title)}${k.subject ? ' — ' + esc(k.subject) : ''} (${k.questions} سؤال${k.essay_total ? ' + مقالي' : ''})</option>`).join('')}</select>
      <div id="omr-key-info" class="omr-key-info"></div>
      <div class="omr-actions hidden" id="omr-actions">
        <button type="button" class="btn-primary" id="omr-start">📷 ابدأ التصحيح بالكاميرا</button>
        <label class="btn-secondary omr-file-btn">📸 صورة بكاميرا الجوال<input type="file" id="omr-shot" accept="image/*" capture="environment" hidden></label>
        <label class="btn-secondary omr-file-btn">🖼 صور من الجهاز<input type="file" id="omr-files" accept="image/*" multiple hidden></label>
      </div>
      <div class="omr-tips">
        <b>«ابدأ التصحيح»</b> أسرع (يلتقط تلقائيًا ورقة ورا ورقة)، و<b>«صورة بكاميرا الجوال»</b> أدق لأنها بدقة الكاميرا الكاملة - استخدمها لو الباركود ما انقرأ.<br>
        <b>للحصول على قراءة دقيقة:</b> صوّر الورقة كاملة بحيث تظهر <b>المربعات السوداء الأربع</b> بالزوايا، على سطح مستوٍ وبإضاءة جيدة بدون ظل على الورقة.
        ورقة A4 بالعرض (طالبين) تقدر تصوّرها كاملة قبل القص وتنقرأ الورقتين مع بعض.
      </div>
    </div>
    <div id="omr-scans"></div>`;
  $('omr-key').addEventListener('change', e => selectKey(e.target.value));
  $('omr-start').addEventListener('click', openCamera);
  $('omr-files').addEventListener('change', e => { const f = [...e.target.files]; e.target.value = ''; processFiles(f); });
  $('omr-shot').addEventListener('change', e => { const f = [...e.target.files]; e.target.value = ''; processFiles(f); });
}

async function selectKey(id) {
  S.key = S.keys.find(k => k.id === id) || null;
  S.report = null; S.scans = new Map();
  $('omr-actions').classList.toggle('hidden', !S.key);
  const info = $('omr-key-info');
  if (!S.key) { info.innerHTML = ''; $('omr-scans').innerHTML = ''; return; }
  const k = S.key, o = keyOpts(k);
  try { S.geo = sheetGeometry(o); } catch (e) { info.innerHTML = `<span class="omr-err">${esc(e.message)}</span>`; $('omr-actions').classList.add('hidden'); return; }
  const missing = (k.answers || []).slice(0, k.questions).filter(v => v == null).length + Math.max(0, k.questions - (k.answers || []).length);
  info.innerHTML = [
    `<i>${PAGE[o.size] ? esc(PAGE[o.size].label) : esc(o.size)}</i>`, `<i>${k.questions} سؤال × ${k.choices} خيارات</i>`,
    k.essay_total ? `<i>مقالي من ${k.essay_total}</i>` : '', o.modelsOn ? `<i>نموذجين (${o.modelBubble ? 'الطالب يظلّل نموذجه' : 'موزّعة من المنصة'})</i>` : '',
    (() => {
      const sc = k.sections && typeof k.sections === 'object' && !Array.isArray(k.sections) ? k.sections : null;
      if (sc && sc.grades === null) return '<i>جميع المراحل</i>';
      const gs = sc && Array.isArray(sc.grades) ? sc.grades : (k.grade_level ? [k.grade_level] : []);
      const cl = sc && Array.isArray(sc.classes) ? sc.classes : (Array.isArray(k.sections) ? k.sections : null);
      return gs.length ? `<i>${gs.map(g => esc(gradeLabels[g] || g)).join('، ')}${cl && cl.length ? ' · فصل ' + esc(cl.join('، ')) : ''}</i>` : '';
    })(),
    missing ? `<b class="omr-warn">المفتاح ناقص ${missing} إجابة</b>` : '',
  ].filter(Boolean).join('');
  await loadScans();
}

async function loadScans() {
  const box = $('omr-scans');
  box.innerHTML = '';
  const { data: reps, error } = await sb.from('exam_reports').select('id, title, students_count, created_at')
    .eq('key_id', S.key.id).eq('created_by', currentUserId).eq('source', 'camera').order('created_at', { ascending: true }).limit(1);
  if (error) {
    box.innerHTML = `<div class="omr-err">${/source|key_id|exam_scans|schema cache|does not exist/i.test(error.message || '') ? 'التصحيح بالجوال يحتاج تشغيل ملف sql/omr_camera.sql بقاعدة البيانات أولًا' : esc(error.message)}</div>`;
    $('omr-actions').classList.add('hidden');
    return;
  }
  S.report = reps && reps[0] ? reps[0] : null;
  if (S.report) {
    const { data, error: e2 } = await sb.from('exam_scans').select('*').eq('report_id', S.report.id).order('scanned_at', { ascending: false });
    if (e2) { box.innerHTML = `<div class="omr-err">${esc(e2.message)}</div>`; return; }
    (data || []).forEach(s => S.scans.set(s.national_id, s));
  }
  renderScans();
}

function totalOf(k) { return (k.questions || 0) + (k.essay_total || 0); }
function scoreText(s) {
  const k = S.key;
  const mc = s.score != null ? s.score : 0;
  return k.essay_total ? `${fmt(mc + (Number(s.essay) || 0))} / ${totalOf(k)}` : `${fmt(mc)} / ${k.questions}`;
}
const fmt = n => (Math.round(n * 10) / 10).toString();

function renderScans() {
  const box = $('omr-scans');
  if (!S.key) { box.innerHTML = ''; return; }
  const list = [...S.scans.values()].sort((a, b) => String(b.scanned_at).localeCompare(String(a.scanned_at)));
  const bySec = {};
  list.forEach(s => { const k = (gradeLabels[s.grade_level] || s.grade_level || '') + ' ' + (s.class_section || ''); bySec[k] = (bySec[k] || 0) + 1; });
  box.innerHTML = `
    <div class="form-card omr-card">
      <div class="omr-scans-head">
        <h4>الأوراق المصححة <span class="omr-count">${list.length}</span></h4>
        ${S.report ? `<button type="button" class="btn-secondary" id="omr-open-report">فتح التقرير</button>` : ''}
      </div>
      ${list.length ? `<div class="omr-secs">${Object.entries(bySec).map(([k, n]) => `<i>${esc(k.trim() || 'بدون فصل')}: ${n}</i>`).join('')}</div>` : ''}
      ${list.length ? `<div class="omr-list">${list.map(s => `
        <div class="omr-row" data-id="${esc(s.national_id)}" role="button" tabindex="0">
          <span class="omr-row-main"><b>${esc(s.student_name || s.national_id)}</b><small>${esc((gradeLabels[s.grade_level] || s.grade_level || '').replace(' متوسط', ''))} ${esc(s.class_section || '')}${s.model ? ` · نموذج ${esc(s.model)}` : ''}${s.flags && s.flags.edited ? ' · عُدّلت يدويًا' : ''}</small></span>
          <span class="omr-score">${scoreText(s)}</span>
          <button type="button" class="omr-del" data-id="${esc(s.national_id)}" aria-label="حذف الورقة" title="حذف">✕</button>
        </div>`).join('')}</div>` : '<p class="omr-empty">ما صححت أي ورقة لهذا الاختبار بعد.</p>'}
    </div>`;
  if ($('omr-open-report')) $('omr-open-report').addEventListener('click', () => S.opts.openReport && S.opts.openReport(S.report.id));
  box.querySelectorAll('.omr-row').forEach(r => r.addEventListener('click', e => {
    if (e.target.closest('.omr-del')) return;
    const s = S.scans.get(r.dataset.id);
    if (s) openReview([fromSaved(s)]);
  }));
  box.querySelectorAll('.omr-del').forEach(b => b.addEventListener('click', async e => {
    e.stopPropagation();
    const s = S.scans.get(b.dataset.id);
    if (!s || !confirm(`حذف ورقة ${s.student_name || s.national_id}؟`)) return;
    const { error } = await sb.from('exam_scans').delete().eq('id', s.id);
    if (error) { alert('تعذر الحذف: ' + error.message); return; }
    S.scans.delete(b.dataset.id);
    await rebuildReport();
    renderScans();
  }));
}

/* ---------- الكاميرا ---------- */
async function openCamera() {
  if (!S.key) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { alert('المتصفح ما يدعم الكاميرا هنا - استخدم «صور من الجهاز»'); return; }
  const ov = document.createElement('div');
  ov.className = 'omr-cam';
  ov.innerHTML = `
    <video playsinline muted autoplay></video>
    <canvas class="omr-cam-ov"></canvas>
    <div class="omr-cam-top">
      <button type="button" class="omr-cam-x" aria-label="إغلاق">✕</button>
      <div class="omr-cam-title"><b>${esc(S.key.title)}</b><span id="omr-cam-cnt">${S.scans.size} ورقة</span></div>
      <button type="button" class="omr-cam-torch hidden" aria-label="الفلاش">⚡</button>
    </div>
    <div class="omr-cam-msg">جارٍ تشغيل الكاميرا...</div>
    <div class="omr-cam-bottom">
      <label class="omr-auto"><input type="checkbox" checked> التقاط تلقائي</label>
      <button type="button" class="omr-shutter" aria-label="التقاط"></button>
      <span class="omr-auto" style="visibility:hidden">.</span>
    </div>`;
  document.body.appendChild(ov);
  document.body.classList.add('omr-noscroll');
  const video = ov.querySelector('video');
  const msg = ov.querySelector('.omr-cam-msg');
  const cam = { ov, video, msg, stream: null, timer: null, hist: [], lastShot: 0, auto: true, wake: null, paused: false };
  S.cam = cam;
  ov.querySelector('.omr-cam-x').addEventListener('click', closeCamera);
  ov.querySelector('.omr-auto input').addEventListener('change', e => { cam.auto = e.target.checked; });
  ov.querySelector('.omr-shutter').addEventListener('click', () => capture(true));
  try {
    cam.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } } });
  } catch (e) {
    try { cam.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'environment' } }); }
    catch (e2) { msg.textContent = 'ما قدرنا نفتح الكاميرا - اسمح للمتصفح باستخدامها، أو استخدم «صور من الجهاز»'; return; }
  }
  video.srcObject = cam.stream;
  await video.play().catch(() => {});
  const track = cam.stream.getVideoTracks()[0];
  try {
    const caps = track.getCapabilities ? track.getCapabilities() : {};
    if (caps.torch) {
      const tb = ov.querySelector('.omr-cam-torch'); tb.classList.remove('hidden');
      let on = false;
      tb.addEventListener('click', async () => { on = !on; tb.classList.toggle('on', on); try { await track.applyConstraints({ advanced: [{ torch: on }] }); } catch (e) {} });
    }
    if (caps.focusMode && caps.focusMode.includes('continuous')) track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
  } catch (e) {}
  try { if (navigator.wakeLock) cam.wake = await navigator.wakeLock.request('screen'); } catch (e) {}
  msg.textContent = 'قرّب الجوال لين تدخل مربعات الورقة السوداء داخل المربعات';
  cam.timer = setInterval(detectTick, 220);
}

function closeCamera() {
  const cam = S.cam;
  if (!cam) return;
  clearInterval(cam.timer);
  if (cam.stream) cam.stream.getTracks().forEach(t => t.stop());
  if (cam.wake) cam.wake.release().catch(() => {});
  cam.ov.remove();
  document.body.classList.remove('omr-noscroll');
  S.cam = null;
}

// كشف سريع (صورة صغيرة) لرسم الزوايا والالتقاط التلقائي لما تثبت الورقة
const smallCanvas = document.createElement('canvas');
/* إطار موجّه: ٤ مربعات ثابتة على الشاشة بمكان زوايا الورقة. المعلم يقرّب الجوال لين تدخل المربعات
 * السوداء اللي بالورقة داخلها، وأول ما تتطابق الأربع يلتقط تلقائيًا. */
function guideRect() {
  const cam = S.cam;
  const r = cam.video.getBoundingClientRect();
  const m = S.geo.marks;   // TL TR BL BR (مم)
  const aspect = (m[2][1] - m[0][1]) / (m[1][0] - m[0][0]);
  let gw = r.width * 0.84, gh = gw * aspect;
  const maxH = r.height * 0.68;
  if (gh > maxH) { gh = maxH; gw = gh / aspect; }
  const cx = r.width / 2, cy = r.height * 0.47;
  const box = Math.max(54, gw * 0.17);
  const pts = [[cx - gw / 2, cy - gh / 2], [cx + gw / 2, cy - gh / 2], [cx - gw / 2, cy + gh / 2], [cx + gw / 2, cy + gh / 2]];
  // شاشة ← إحداثيات الفيديو (الفيديو معروض بـ object-fit: cover)
  const vw = cam.video.videoWidth, vh = cam.video.videoHeight;
  const sc = Math.max(r.width / vw, r.height / vh);
  const ox = (r.width - vw * sc) / 2, oy = (r.height - vh * sc) / 2;
  return { r, pts, box, gw, toVid: ([x, y]) => [(x - ox) / sc, (y - oy) / sc], toScr: ([x, y]) => [ox + x * sc, oy + y * sc], sc };
}

function detectTick() {
  const cam = S.cam;
  if (!cam || cam.paused || S.busy || !cam.video.videoWidth) return;
  const v = cam.video;
  const G = guideRect();
  const scale = Math.min(1, 960 / Math.max(v.videoWidth, v.videoHeight));
  const w = Math.round(v.videoWidth * scale), h = Math.round(v.videoHeight * scale);
  smallCanvas.width = w; smallCanvas.height = h;
  const ctx = smallCanvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(v, 0, 0, w, h);
  const g = grayFromImageData(ctx.getImageData(0, 0, w, h));
  // حجم العلامة المتوقع لو الورقة مطابقة للإطار (بكسلات الصورة المصغرة)
  const mmToPx = (G.gw / G.sc) * scale / (S.geo.marks[1][0] - S.geo.marks[0][0]);
  const markPx = S.geo.mark * mmToPx;
  const half = (G.box / 2) / G.sc * scale;   // نصف المربع الموجّه بإحداثيات الصورة المصغرة
  const hits = G.pts.map(p => {
    const [vx, vy] = G.toVid(p);
    return findMarkInRegion(g, vx * scale, vy * scale, half, markPx);
  });
  // المربعات الأربع لازم تكون متقاربة بالحجم (مو نقطة صغيرة بالغلط)
  const found = hits.filter(Boolean);
  let ok = found.length === 4;
  if (ok) { const a = found.map(c => c.area); ok = Math.max(...a) < Math.min(...a) * 4; }
  drawGuide(G, hits.map(c => (c ? G.toScr([c.x / scale, c.y / scale]) : null)));
  if (!ok) {
    cam.match = 0;
    cam.msg.textContent = found.length >= 2 ? `طابق المربعات الأربع (${found.length} من 4)` : 'قرّب الجوال لين تدخل مربعات الورقة السوداء داخل المربعات';
    return;
  }
  cam.match = (cam.match || 0) + 1;
  cam.quad = hits.map(c => [c.x / scale, c.y / scale]);   // بإحداثيات الفيديو الكاملة
  cam.msg.textContent = 'ممتاز ✓ لا تتحرك...';
  if (cam.auto && cam.match >= 2 && Date.now() - cam.lastShot > 1200) { cam.match = 0; capture(false); }
}

function drawGuide(G, hits) {
  const cam = S.cam;
  const c = cam.ov.querySelector('.omr-cam-ov');
  c.width = G.r.width; c.height = G.r.height;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  const all = hits.every(Boolean);
  // إطار الورقة الخفيف
  const [tl, tr, bl, br] = G.pts;
  ctx.strokeStyle = all ? 'rgba(47,210,122,0.9)' : 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 2; ctx.setLineDash([8, 8]);
  ctx.strokeRect(tl[0], tl[1], tr[0] - tl[0], bl[1] - tl[1]);
  ctx.setLineDash([]);
  G.pts.forEach(([x, y], i) => {
    const on = !!hits[i];
    ctx.lineWidth = 4;
    ctx.strokeStyle = on ? '#2FD27A' : '#FFFFFF';
    ctx.fillStyle = on ? 'rgba(47,210,122,0.28)' : 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x - G.box / 2, y - G.box / 2, G.box, G.box, 10); else ctx.rect(x - G.box / 2, y - G.box / 2, G.box, G.box);
    ctx.fill(); ctx.stroke();
    if (on) { const [hx, hy] = hits[i]; ctx.fillStyle = '#2FD27A'; ctx.beginPath(); ctx.arc(hx, hy, 6, 0, Math.PI * 2); ctx.fill(); }
  });
  void br;
}

async function capture(manual) {
  const cam = S.cam;
  if (!cam || S.busy || !cam.video.videoWidth) return;
  S.busy = true;
  cam.lastShot = Date.now();
  cam.msg.textContent = 'جارٍ قراءة الورقة...';
  const v = cam.video;
  const c = document.createElement('canvas');
  c.width = v.videoWidth; c.height = v.videoHeight;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(v, 0, 0);
  await new Promise(r => setTimeout(r, 30));
  const results = processCanvas(c, manual ? null : cam.quad);
  S.busy = false;
  if (!results.ok) {
    cam.hist = [];
    cam.msg.textContent = results.msg;
    if (manual) flash(cam.ov, 'bad');
    return;
  }
  if (navigator.vibrate) navigator.vibrate(60);
  flash(cam.ov, 'ok');
  cam.msg.textContent = 'راجع النتيجة واحفظها';
  cam.paused = true;
  openReview(results.items, () => { if (S.cam) { S.cam.paused = false; S.cam.match = 0; S.cam.lastShot = Date.now(); S.cam.msg.textContent = 'الورقة التالية...'; const cnt = $('omr-cam-cnt'); if (cnt) cnt.textContent = S.scans.size + ' ورقة'; } });
}

function flash(el, kind) {
  el.classList.remove('flash-ok', 'flash-bad');
  void el.offsetWidth;
  el.classList.add(kind === 'ok' ? 'flash-ok' : 'flash-bad');
}

/* ---------- صور من الجهاز ---------- */
async function processFiles(files) {
  if (!files.length || !S.key) return;
  const items = [], fails = [];
  const st = $('omr-key-info');
  for (let i = 0; i < files.length; i++) {
    st.dataset.prev = st.dataset.prev || st.innerHTML;
    st.innerHTML = `<i>جارٍ قراءة الصورة ${i + 1} من ${files.length}...</i>`;
    await new Promise(r => setTimeout(r, 20));
    try {
      const bm = await createImageBitmap(files[i]);
      const k = Math.min(1, 4200 / Math.max(bm.width, bm.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bm.width * k); c.height = Math.round(bm.height * k);
      c.getContext('2d', { willReadFrequently: true }).drawImage(bm, 0, 0, c.width, c.height);
      const r = processCanvas(c);
      if (r.ok) items.push(...r.items); else fails.push(files[i].name + ': ' + r.msg);
    } catch (e) { fails.push(files[i].name + ': تعذر فتح الصورة'); }
  }
  st.innerHTML = st.dataset.prev || ''; delete st.dataset.prev;
  if (fails.length) alert(`ما انقرأت ${fails.length} صورة:\n` + fails.slice(0, 8).join('\n'));
  if (items.length) openReview(items);
}

/* ---------- قراءة صورة ← نتائج (ورقة أو ورقتين) ---------- */
function processCanvas(canvas, quad = null) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const g = grayFromImageData(ctx.getImageData(0, 0, canvas.width, canvas.height));
  const loc = locateSheet(g, S.geo, keyOpts(S.key).size, quad ? { quad } : {});
  if (!loc.ok) {
    return { ok: false, msg: loc.reason === 'marks' || loc.reason === 'shape' ? 'ما لقيت المربعات الأربع - صوّر الورقة كاملة' : 'الصورة مو واضحة أو الورقة مو لهذا الاختبار' };
  }
  const items = [];
  for (const ox of loc.layout.sheets) {
    const r = readSheet(g, S.geo, loc, ox);
    if (r.contrast < 8) continue;
    if (r.barcode === KEY_ID) continue;   // ورقة النموذج نفسها
    const thumb = document.createElement('canvas');
    rectifyToCanvas(g, loc.H, ox, S.geo.w, S.geo.h, 2.4, thumb);
    items.push(fromRead(r, thumb, ox));
  }
  if (!items.length) return { ok: false, msg: 'هذي ورقة النموذج أو الورقة مو واضحة' };
  return { ok: true, items };
}

function fromRead(r, thumb, ox) {
  const k = S.key, o = keyOpts(k);
  const id = r.barcode ? String(r.barcode).trim() : '';
  const st = id ? S.byId.get(id) : null;
  let model = null;
  if (o.modelsOn) {
    if (o.modelBubble && r.model && r.model.idx >= 0) model = r.model.idx === 0 ? MODEL_A : MODEL_B;
    else if (st && k.model_map && k.model_map[id]) model = k.model_map[id];
  }
  return {
    student: st ? { ...st, national_id: id } : null, barcode: id || null,
    answers: r.answers.slice(), auto: r.answers.slice(), unsure: r.unsure.slice(),
    essay: r.essay ? r.essay.value : null, essayUnsure: r.essay ? r.essay.unsure : false,
    model, modelUnsure: o.modelsOn && (!model || (r.model && r.model.unsure)),
    thumb, offsets: r.offsets, modelRead: r.model, essayRead: r.essay,
  };
}

function fromSaved(s) {
  return {
    student: { full_name: s.student_name, national_id: s.national_id, grade_level: s.grade_level, class_section: s.class_section },
    barcode: s.national_id, answers: (s.answers || []).slice(), auto: (s.answers || []).slice(), unsure: (s.flags && s.flags.unsure) || [],
    essay: s.essay, model: s.model, saved: s, thumb: null,
  };
}

/* ---------- الدرجة ---------- */
function keyFor(model) {
  const k = S.key;
  if (model === MODEL_B && k.models && Array.isArray(k.models.answers_b)) return k.models.answers_b;
  return k.answers || [];
}
function scoreOf(answers, model) {
  const key = keyFor(model);
  let s = 0;
  answers.forEach((a, i) => { if (a != null && a >= 0 && key[i] === a) s++; });
  return s;
}

/* ---------- مراجعة النتيجة ---------- */
function openReview(items, onDone) {
  const queue = items.slice();
  const next = () => {
    const it = queue.shift();
    if (!it) { if (onDone) onDone(); return; }
    reviewOne(it, next, queue.length);
  };
  next();
}

function reviewOne(it, next, remaining) {
  const k = S.key, o = keyOpts(k);
  const mcqLetters = (o.lang === 'en' ? EN : AR).slice(0, k.choices);
  const kinds = itemKinds(o);
  const lettersOf = q => (kinds[q] === 'tf' ? TF_LETTERS[o.lang === 'en' ? 'en' : 'ar'] : mcqLetters);
  const wrap = document.createElement('div');
  wrap.className = 'omr-rev-wrap';
  wrap.innerHTML = `<div class="omr-rev" role="dialog" aria-label="مراجعة الورقة">
    <div class="omr-rev-head">
      <div class="omr-rev-st"></div>
      <button type="button" class="omr-rev-x" aria-label="إغلاق">✕</button>
    </div>
    <div class="omr-rev-body">
      <div class="omr-rev-score"></div>
      <div class="omr-rev-model ${o.modelsOn ? '' : 'hidden'}"><span>النموذج:</span>
        <button type="button" data-m="${MODEL_A}">أ</button><button type="button" data-m="${MODEL_B}">ب</button></div>
      <div class="omr-rev-essay ${k.essay_total ? '' : 'hidden'}"><label>درجة المقالي <input type="number" min="0" max="${k.essay_total}" step="0.5" inputmode="decimal"> / ${k.essay_total}</label></div>
      <div class="omr-legend"><i class="ok"></i>صحيحة <i class="no"></i>خاطئة <i class="bl"></i>فاضية/متعددة <i class="un"></i>راجعها</div>
      <div class="omr-grid"></div>
      ${it.thumb ? '<details class="omr-photo"><summary>صورة الورقة</summary><div class="omr-photo-box"></div></details>' : ''}
    </div>
    <div class="omr-rev-foot">
      <button type="button" class="btn-primary omr-save">✓ حفظ${remaining ? ' والتالي' : ''}</button>
      <button type="button" class="text-action-btn omr-skip">${it.saved ? 'إلغاء' : 'تجاهل الورقة'}</button>
    </div>
  </div>`;
  (S.cam ? S.cam.ov : document.body).appendChild(wrap);
  const $w = sel => wrap.querySelector(sel);
  const close = () => { wrap.remove(); next(); };
  $w('.omr-rev-x').addEventListener('click', close);
  $w('.omr-skip').addEventListener('click', close);

  // الطالب
  const renderStudent = () => {
    const st = it.student;
    const dup = st && !it.saved && S.scans.get(String(st.national_id));
    $w('.omr-rev-st').innerHTML = st
      ? `<b>${esc(st.full_name || ('رقم الهوية ' + st.national_id))}</b><span>${esc(gradeLabels[st.grade_level] || st.grade_level || '')} ${esc(st.class_section || '')}${it.barcode && !it.saved ? ' · من الباركود ✓' : ''}</span>
         ${it.saved ? '' : '<button type="button" class="ope-link omr-change-st">تغيير</button>'}
         ${dup ? `<div class="omr-dup">سبق تصحيح ورقته (${scoreText(dup)}) - الحفظ يستبدلها</div>` : ''}`
      : `<b class="omr-warn">${it.barcode ? `رقم الهوية ${esc(it.barcode)} مو موجود بقائمة طلابك` : 'ما انقرأ الباركود'} - اختر الطالب:</b>
         ${it.barcode && /^\d{6,}$/.test(it.barcode) ? `<button type="button" class="ope-link omr-use-id">أو احفظها برقم الهوية فقط</button>` : ''}${pickerHtml()}`;
    if (!st) bindPicker();
    const ui = $w('.omr-use-id');
    if (ui) ui.addEventListener('click', () => { it.student = { full_name: '', national_id: it.barcode, grade_level: k.grade_level || null, class_section: null }; renderStudent(); renderAll(); });
    const ch = $w('.omr-change-st');
    if (ch) ch.addEventListener('click', () => { it.student = null; renderStudent(); });
  };
  const pickerHtml = () => {
    const grades = [...new Set(S.students.map(s => s.grade_level))].filter(Boolean);
    const g0 = k.grade_level && grades.includes(k.grade_level) ? k.grade_level : '';
    return `<div class="omr-pick">
      <div class="omr-pick-row">
        <select class="omr-pick-g"><option value="">كل الصفوف</option>${grades.map(g => `<option value="${esc(g)}"${g === g0 ? ' selected' : ''}>${esc(gradeLabels[g] || g)}</option>`).join('')}</select>
        <select class="omr-pick-s"><option value="">كل الفصول</option></select>
      </div>
      <input type="search" class="omr-pick-q" placeholder="ابحث بالاسم أو رقم الهوية">
      <div class="omr-pick-list"></div>
    </div>`;
  };
  const bindPicker = () => {
    const gs = $w('.omr-pick-g'), ss = $w('.omr-pick-s'), qi = $w('.omr-pick-q'), list = $w('.omr-pick-list');
    const fillSecs = () => {
      const secs = [...new Set(S.students.filter(s => !gs.value || s.grade_level === gs.value).map(s => s.class_section).filter(v => v != null))].sort((a, b) => a - b);
      ss.innerHTML = '<option value="">كل الفصول</option>' + secs.map(n => `<option value="${n}">${n}</option>`).join('');
    };
    const draw = () => {
      const q = normAr(qi.value);
      const rows = S.students.filter(s => (!gs.value || s.grade_level === gs.value) && (!ss.value || String(s.class_section) === ss.value)
        && (!q || normAr(s.full_name).includes(q) || String(s.national_id).includes(q)))
        .sort((a, b) => String(a.full_name).localeCompare(String(b.full_name), 'ar')).slice(0, 60);
      list.innerHTML = rows.map(s => `<button type="button" data-id="${esc(s.national_id)}"><b>${esc(s.full_name)}</b><small>${esc((gradeLabels[s.grade_level] || '').replace(' متوسط', ''))} ${esc(s.class_section || '')}${S.scans.has(String(s.national_id).trim()) ? ' · مصحح ✓' : ''}</small></button>`).join('')
        || '<span class="omr-empty">ما فيه نتائج</span>';
      list.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
        const s = S.byId.get(b.dataset.id);
        it.student = { ...s, national_id: String(s.national_id).trim() };
        if (o.modelsOn && !o.modelBubble && k.model_map && k.model_map[it.student.national_id]) { it.model = k.model_map[it.student.national_id]; it.modelUnsure = false; }
        renderStudent(); renderAll();
      }));
    };
    gs.addEventListener('change', () => { fillSecs(); draw(); });
    ss.addEventListener('change', draw);
    qi.addEventListener('input', draw);
    fillSecs();
    const kc = k.sections && Array.isArray(k.sections.classes) ? k.sections.classes : (Array.isArray(k.sections) ? k.sections : null);
    if (kc && kc.length === 1 && gs.value === k.grade_level) ss.value = String(kc[0]);
    draw();
  };

  // الإجابات
  const renderGrid = () => {
    const key = keyFor(it.model);
    $w('.omr-grid').innerHTML = it.answers.map((a, i) => {
      const ok = a != null && a >= 0 && key[i] === a;
      const cls = a === -1 || a === -2 || a == null ? 'bl' : ok ? 'ok' : 'no';
      const txt = a === -1 || a == null ? '—' : a === -2 ? 'متعدد' : lettersOf(i)[a] || '?';
      return `<button type="button" class="omr-q ${cls}${it.unsure[i] ? ' un' : ''}${it.auto[i] !== a ? ' ed' : ''}" data-q="${i}"><small>${i + 1}</small><b>${txt}</b></button>`;
    }).join('');
    wrap.querySelectorAll('.omr-q').forEach(b => b.addEventListener('click', () => pickAnswer(+b.dataset.q, b)));
  };
  const pickAnswer = (q, btn) => {
    wrap.querySelectorAll('.omr-qpick').forEach(x => x.remove());
    const pop = document.createElement('div');
    pop.className = 'omr-qpick';
    pop.innerHTML = `<b>سؤال ${q + 1}</b>` + lettersOf(q).map((l, i) => `<button type="button" data-v="${i}"${it.answers[q] === i ? ' class="on"' : ''}>${l}</button>`).join('') +
      `<button type="button" data-v="-1"${it.answers[q] === -1 ? ' class="on"' : ''}>فاضي</button><button type="button" data-v="-2"${it.answers[q] === -2 ? ' class="on"' : ''}>متعدد</button>`;
    btn.after(pop);
    pop.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { it.answers[q] = +b.dataset.v; it.unsure[q] = false; pop.remove(); renderAll(); }));
  };
  const renderScore = () => {
    const mc = scoreOf(it.answers, it.model);
    const un = it.unsure.filter(Boolean).length + (it.essayUnsure ? 1 : 0) + (it.modelUnsure ? 1 : 0);
    const essay = Number(it.essay) || 0;
    $w('.omr-rev-score').innerHTML = `<span class="omr-big">${fmt(mc + (k.essay_total ? essay : 0))}<small> / ${k.essay_total ? totalOf(k) : k.questions}</small></span>
      <span class="omr-sub">${k.essay_total ? `اختيار من متعدد ${mc} / ${k.questions} · مقالي ${it.essay == null ? '؟' : fmt(essay)} / ${k.essay_total}` : `${it.answers.filter(a => a === -1).length} فاضية · ${it.answers.filter(a => a === -2).length} متعددة`}</span>
      ${un ? `<span class="omr-unsure">⚠ ${un} ${un === 1 ? 'خانة' : 'خانات'} تحتاج مراجعة (مظللة بالأصفر)</span>` : ''}`;
  };
  const renderModel = () => {
    wrap.querySelectorAll('.omr-rev-model button').forEach(b => b.classList.toggle('on', b.dataset.m === it.model));
    $w('.omr-rev-model').classList.toggle('un', !!it.modelUnsure);
  };
  const renderAll = () => { renderGrid(); renderScore(); renderModel(); };
  wrap.querySelectorAll('.omr-rev-model button').forEach(b => b.addEventListener('click', () => { it.model = b.dataset.m; it.modelUnsure = false; renderAll(); }));
  const ei = $w('.omr-rev-essay input');
  if (ei) {
    if (it.essay != null) ei.value = it.essay;
    $w('.omr-rev-essay').classList.toggle('un', !!it.essayUnsure);
    ei.addEventListener('input', () => { it.essay = ei.value === '' ? null : Math.max(0, Math.min(k.essay_total, Number(ei.value))); it.essayUnsure = false; $w('.omr-rev-essay').classList.remove('un'); renderScore(); });
  }
  if (it.thumb) {
    drawThumbMarks(it);
    it.thumb.className = 'omr-thumb';
    $w('.omr-photo-box').appendChild(it.thumb);
  }
  renderStudent(); renderAll();

  $w('.omr-save').addEventListener('click', async () => {
    if (!it.student) { alert('اختر الطالب أولًا'); return; }
    if (o.modelsOn && !it.model) { alert('حدد نموذج الطالب'); return; }
    if (k.essay_total && it.essay == null && !confirm('ما حددت درجة المقالي - تحفظ بدونها (صفر)؟')) return;
    const btn = $w('.omr-save');
    btn.disabled = true; btn.textContent = 'جارٍ الحفظ...';
    const err = await saveScan(it);
    if (err) { btn.disabled = false; btn.textContent = '✓ حفظ'; alert('تعذر الحفظ: ' + err); return; }
    renderScans();
    close();
  });
}

// علامات على صورة الورقة المصححة: دائرة خضراء = الإجابة الصحيحة، حمراء = اختيار خاطئ، صفراء = راجعها
function drawThumbMarks(it) {
  const c = it.thumb, ctx = c.getContext('2d'), s = 2.4, key = keyFor(it.model), geo = S.geo;
  const r = geo.bubble / 2 * s + 1.5;
  ctx.lineWidth = 2.2;
  geo.items.forEach((row, q) => {
    const [dx, dy] = it.offsets ? it.offsets[q] : [0, 0];
    const a = it.auto[q], kc = key[q];
    const circle = (i, col) => { ctx.strokeStyle = col; ctx.beginPath(); ctx.arc((row[i][0] + dx) * s, (row[i][1] + dy) * s, r, 0, Math.PI * 2); ctx.stroke(); };
    if (kc != null && row[kc]) circle(kc, '#18A957');
    if (a >= 0 && a !== kc) circle(a, '#E0413A');
    if (it.unsure[q]) { ctx.strokeStyle = '#F2B705'; ctx.strokeRect((row[0][0] + dx) * s - r - 3, (row[0][1] + dy) * s - r - 3, (row[row.length - 1][0] - row[0][0]) * s + 2 * r + 6, 2 * r + 6); }
  });
}

/* ---------- الحفظ وبناء التقرير ---------- */
async function saveScan(it) {
  const k = S.key;
  const st = it.student;
  const id = String(st.national_id).trim();
  const row = {
    key_id: k.id, national_id: id, student_name: st.full_name || null, grade_level: st.grade_level || null,
    class_section: st.class_section != null ? String(st.class_section) : null, model: it.model || null,
    answers: it.answers, essay: k.essay_total ? (it.essay == null ? 0 : it.essay) : null, score: scoreOf(it.answers, it.model),
    flags: { unsure: it.unsure, edited: it.answers.some((a, i) => a !== it.auto[i]) || (it.saved && it.saved.flags && it.saved.flags.edited) || false },
    scanned_by: currentUserId, scanned_at: new Date().toISOString(),
  };
  // أول ورقة: ننشئ التقرير
  if (!S.report) {
    const all = new Map(S.scans); all.set(id, row);
    const payload = reportPayload([...all.values()]);
    const { data, error } = await writeWithSchool(extra => sb.from('exam_reports').insert({ ...payload, created_by: currentUserId, source: 'camera', key_id: k.id, ...extra }).select('id, title, students_count, created_at').single());
    if (error) return error.message;
    S.report = data;
  }
  const { data: saved, error } = await writeWithSchool(extra => sb.from('exam_scans').upsert({ ...row, report_id: S.report.id, ...extra }, { onConflict: 'report_id,national_id' }).select('*').single());
  if (error) return error.message;
  if (it.saved && it.saved.national_id !== id) S.scans.delete(it.saved.national_id);
  S.scans.set(id, saved);
  const e2 = await rebuildReport();
  return e2;
}

function reportPayload(scans) {
  const k = S.key, o = keyOpts(k);
  const reversed = o.lang !== 'en';
  const n = k.questions;
  const kinds = itemKinds(o);
  const choiceCounts = kinds.map(t => (t === 'tf' ? 2 : k.choices));
  const itemTypes = kinds.map(t => (t === 'tf' || k.choices === 2 ? 'tf' : 'mcq'));
  const toRawQ = (a, i) => (a == null || a === -1 ? -2 : a === -2 ? -3 : reversed ? choiceCounts[i] - a : a + 1);
  const students = scans.map(s => ({
    id: s.national_id, name: s.student_name || '', grade: gradeLabels[s.grade_level] || s.grade_level || '', section: s.class_section || '',
    subject: k.subject || '', modelRaw: null, answers: (s.answers || []).slice(0, n).map(toRawQ), essay: s.essay, model: s.model || undefined,
  }));
  const grades = [...new Set(students.map(s => s.grade).filter(Boolean))];
  const base = {
    title: k.title, subject_name: k.subject || null, grade_level: grades.length === 1 ? grades[0] : (gradeLabels[k.grade_level] || null),
    item_count: n, students_count: students.length,
  };
  if (!students.length || !n) return { ...base, key_raw: [], stats: null, raw_data: { students, choiceCounts, itemTypes, reversedOrder: reversed, source: 'camera', keyId: k.id } };
  if (o.modelsOn) {
    const g = gradeWithModels({
      parsed: { itemCount: n, choiceCounts, itemTypes, students },
      keyA: rawFromIdx(k.answers, choiceCounts, reversed), keyB: rawFromIdx(k.models.answers_b, choiceCounts, reversed),
      mode: k.models.mode, orderB: k.models.order_b, reversedOrder: reversed, keyId: k.id,
      modelOf: st => st.model || MODEL_A,
    });
    g.raw_data.source = 'camera';
    return { ...base, key_raw: g.key_raw, stats: g.stats, raw_data: g.raw_data };
  }
  const keyRaw = rawFromIdx(k.answers, choiceCounts, reversed);
  const stats = computeExamStats({ itemCount: n, keyRaw, choiceCounts, students, reversedOrder: reversed, itemTypes });
  return { ...base, key_raw: keyRaw, stats, raw_data: { students, choiceCounts, itemTypes, reversedOrder: reversed, source: 'camera', keyId: k.id } };
}

async function rebuildReport() {
  if (!S.report) return null;
  if (!S.scans.size) {   // انحذفت كل الأوراق: نحذف التقرير
    const { error } = await sb.from('exam_reports').delete().eq('id', S.report.id);
    if (!error) S.report = null;
    return error ? error.message : null;
  }
  const payload = reportPayload([...S.scans.values()]);
  const { error } = await sb.from('exam_reports').update(payload).eq('id', S.report.id);
  return error ? error.message : null;
}
