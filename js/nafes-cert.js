/* =========================================================================
 * شهادة نافس (النموذج ب: تقرير أداء رسمي) — مشتركة بين المنصة وصفحة أولياء الأمور
 * certFromData(c, meta): c = بيانات الشهادة المحفوظة (المواد والمهارات والاجتياز)،
 * meta = { name, grade, section, nid, org, logo, date, title }
 * الألوان حسب المنطقة: أقل من ٥٠٪ أحمر، من ٥٠٪ إلى حد الاجتياز برتقالي، الاجتياز فأعلى أخضر.
 * ========================================================================= */
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = v => (v == null || !Number.isFinite(+v) ? '—' : String(Math.round(+v * 100) / 100));
const LV = { 4: ['متقدم', 'l4'], 3: ['متمكن', 'l3'], 2: ['أساسي', 'l2'], 1: ['دون الأساسي', 'l1'] };
const zone = (p, pass) => (p == null ? 'z1' : p >= pass ? 'z3' : p >= 50 ? 'z2' : 'z1');
const needTxt = n => (n === 1 ? 'درجة واحدة' : n === 2 ? 'درجتان' : `${n} درجات`);
const lvTag = k => (LV[k] ? `<span class="nc-lv ${LV[k][1]}">${LV[k][0]}</span>` : '');

// شريط الإتقان: خلفيته مناطق ملونة خفيفة، والتعبئة بلون منطقة الطالب، وعلامة حد الاجتياز
function bar(p, pass, big = false) {
  const v = Math.max(0, Math.min(100, +p || 0));
  return `<div class="nc-bar${big ? ' big' : ''}" style="--pass:${pass}%"><i class="${zone(p, pass)}" style="width:${v}%"></i><em title="حد الاجتياز ${pass}%"></em></div>`;
}

export function certAnalysisLines(c) {
  const fails = c.subjects.filter(x => !x.pass);
  return [
    fails.length ? `<b>لم يجتز الطالب في:</b> ${fails.map(x => `${esc(x.s)} (ينقصه ${needTxt(x.need)} للاجتياز)`).join('، ')}.` : `<b>اجتاز الطالب جميع المواد</b> بتحقيقه ${c.passPct}% فأكثر في كل مادة.`,
    `<b>نقاط القوة:</b> ${c.strong.length ? c.strong.map(x => `${esc(x.k)} (${esc(x.s)})`).join('، ') : 'لا توجد مهارة بلغ فيها الطالب 80% بعد'}.`,
    `<b>يحتاج إلى الدعم في:</b> ${c.weak.length ? c.weak.map(x => `${esc(x.k)} (${esc(x.s)})`).join('، ') : 'لا توجد مهارة دون 50%'}.`,
  ];
}

export function certFromData(c, m = {}) {
  const pass = c.passPct || 75;
  const passed = c.subjects.filter(x => x.pass).length;
  return `<article class="nc">
    <header class="nc-band">${m.logo ? `<img src="${esc(m.logo)}" alt="">` : ''}<div class="nc-ttl"><h2>${esc(m.title || 'تقرير أداء الطالب · اختبار نافس التجريبي')}</h2><span>${esc(m.org || '')}${m.date ? ' · ' + esc(m.date) : ''}</span></div><div class="nc-st ${c.passed ? 'yes' : 'no'}">${c.passed ? '✓ مجتاز' : 'غير مجتاز'}</div></header>
    <div class="nc-body">
      <div class="nc-info"><div><small>اسم الطالب</small><b>${esc(m.name || '')}</b></div><div><small>الصف</small><b>${esc(m.grade || '')}</b></div><div><small>الفصل</small><b>${esc(m.section || '')}</b></div>${m.nid ? `<div><small>رقم الهوية</small><b>${esc(m.nid)}</b></div>` : ''}</div>
      <div class="nc-kp">
        <div><small>الدرجة الكلية</small><b>${fmt(c.total)} <small>من ${fmt(c.max)}</small></b></div>
        <div><small>النسبة</small><b class="t-${zone(c.pct, pass)}">${fmt(c.pct)}%</b></div>
        <div><small>المستوى العام</small><b class="t-${zone(c.pct, pass)} sm">${LV[c.lv] ? LV[c.lv][0] : '—'}</b></div>
        <div><small>المواد المجتازة</small><b>${passed} <small>من ${c.subjects.length}</small></b></div>
      </div>
      ${c.subjects.map(s => `<section class="nc-sj">
        <h3><span class="nc-sjn">${esc(s.s)}</span><span class="nc-sjs">${fmt(s.got)} من ${fmt(s.w)} <small>(<bdi>${fmt(s.pct)}%</bdi>)</small></span><em class="${s.pass ? 'ok' : 'no'}">${s.pass ? '✓ اجتاز' : `✕ لم يجتز${s.need ? ` · ينقصه ${needTxt(s.need)}` : ''}`}</em></h3>
        <div class="nc-sjbar">${bar(s.pct, pass, true)}</div>
        <table><tbody>${s.skills.map(k => `<tr><td class="nc-k">${esc(k.k)}</td><td class="nc-b">${bar(k.pct, pass)}</td><td class="nc-p t-${zone(k.pct, pass)}">${Math.round(+k.pct || 0)}%</td><td class="nc-l">${lvTag(k.lv)}</td></tr>`).join('')}</tbody></table>
      </section>`).join('')}
      <div class="nc-leg"><span><i class="z1"></i>دون 50%</span><span><i class="z2"></i>من 50% إلى أقل من ${pass}%</span><span><i class="z3"></i>${pass}% فأكثر (منطقة الاجتياز)</span><span><em></em>حد الاجتياز</span></div>
      <section class="nc-an"><h3>التحليل</h3><ol>${certAnalysisLines(c).map(x => `<li>${x}</li>`).join('')}</ol></section>
      ${m.signatures === false ? '' : '<div class="nc-sig"><div>معلم المادة<i></i></div><div>وكيل الشؤون التعليمية<i></i></div><div>مدير المدرسة<i></i></div></div>'}
    </div>
  </article>`;
}

export const CERT_CSS = `
.nc{ --r:#D64545; --o:#E8890C; --g:#2F9E44; --ink:#14233A; --mut:#667085; --ln:#D5DCE6; background:#fff; color:var(--ink); border:1px solid var(--ln); border-radius:14px; overflow:hidden; font-family:'IBM Plex Sans Arabic',Tahoma,sans-serif; text-align:right; }
.nc h2,.nc h3,.nc b{ font-family:'Tajawal','IBM Plex Sans Arabic',sans-serif; }
.nc-band{ background:#0F2447; color:#fff; padding:18px 24px; display:flex; align-items:center; gap:14px; }
.nc-band img{ height:52px; background:#fff; border-radius:10px; padding:4px; }
.nc-ttl{ flex:1; min-width:0; } .nc-ttl h2{ margin:0; font-size:19px; font-weight:900; line-height:1.4; } .nc-ttl span{ color:#B9C8E2; font-size:12.5px; }
.nc-st{ flex-shrink:0; font-family:'Tajawal',sans-serif; font-weight:900; font-size:15px; padding:7px 16px; border-radius:9px; }
.nc-st.yes{ background:#EBFBEE; color:#1B7A35; } .nc-st.no{ background:#FFF0F0; color:#C02E2E; }
.nc-body{ padding:18px 24px 20px; }
.nc-info{ display:grid; grid-template-columns:2fr 1fr 1fr; border:1px solid var(--ln); border-radius:9px; overflow:hidden; margin-bottom:14px; }
.nc-info:has(> div:nth-child(4)){ grid-template-columns:2fr 1.1fr .6fr 1.1fr; }
.nc-info div{ padding:8px 14px; border-inline-start:1px solid var(--ln); } .nc-info div:first-child{ border-inline-start:0; }
.nc-info small,.nc-kp small{ display:block; color:var(--mut); font-size:11px; } .nc-info b{ font-size:14px; }
.nc-kp{ display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin-bottom:16px; }
.nc-kp > div{ border:1px solid var(--ln); border-radius:9px; padding:9px 10px; text-align:center; }
.nc-kp b{ font-size:22px; font-weight:900; } .nc-kp b small{ display:inline; font-size:12px; font-weight:700; } .nc-kp b.sm{ font-size:16px; }
.t-z1{ color:var(--r) !important; } .t-z2{ color:var(--o) !important; } .t-z3{ color:var(--g) !important; }
.nc-sj{ border:1px solid var(--ln); border-radius:9px; margin-bottom:11px; overflow:hidden; break-inside:avoid; }
.nc-sj h3{ margin:0; background:#F3F5F9; padding:8px 14px; font-size:15px; display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
.nc-sjn{ font-weight:900; } .nc-sjs{ font-weight:800; font-size:13.5px; } .nc-sjs small{ color:var(--mut); font-weight:600; }
.nc-sj h3 em{ font-style:normal; margin-inline-start:auto; font-size:13px; font-weight:900; } em.ok{ color:var(--g); } em.no{ color:var(--r); }
.nc-sjbar{ padding:8px 14px 4px; background:#F3F5F9; border-bottom:1px solid var(--ln); }
.nc-sj table{ width:100%; border-collapse:collapse; margin:0; }
.nc-sj td{ padding:6px 14px; font-size:13px; border-bottom:1px solid #EEF1F5; background:none; vertical-align:middle; } .nc-sj tr:last-child td{ border-bottom:0; }
.nc-k{ font-weight:600; width:38%; } .nc-b{ width:36%; } .nc-p{ font-weight:900; text-align:center; width:56px; white-space:nowrap; } .nc-l{ text-align:left; white-space:nowrap; }
.nc-bar{ position:relative; height:9px; border-radius:5px; background:linear-gradient(to left, rgba(214,69,69,.16) 0 50%, rgba(232,137,12,.18) 50% var(--pass), rgba(47,158,68,.18) var(--pass) 100%); }
.nc-bar.big{ height:12px; }
.nc-bar i{ position:absolute; inset-block:0; inset-inline-start:0; border-radius:5px; }
.nc-bar i.z1{ background:var(--r); } .nc-bar i.z2{ background:var(--o); } .nc-bar i.z3{ background:var(--g); }
.nc-bar em{ position:absolute; top:-3px; bottom:-3px; inset-inline-start:var(--pass); width:2px; margin-inline-start:-1px; background:#0F2447; border-radius:1px; }
.nc-lv{ display:inline-block; font-size:11.5px; font-weight:700; padding:1px 8px; border-radius:5px; border:1px solid; }
.nc-lv.l1{ color:#C02E2E; border-color:#F3B4B4; background:#FFF5F5; } .nc-lv.l2{ color:#B4620A; border-color:#F5CFA0; background:#FFF8EE; } .nc-lv.l3{ color:#2B8A3E; border-color:#A9DDB5; background:#F0FBF2; } .nc-lv.l4{ color:#fff; border-color:#1B7A35; background:#1B7A35; }
.nc-leg{ display:flex; flex-wrap:wrap; gap:6px 16px; font-size:11.5px; color:var(--mut); margin:4px 0 12px; }
.nc-leg i{ display:inline-block; width:14px; height:8px; border-radius:3px; margin-inline-end:5px; vertical-align:0; } .nc-leg i.z1{ background:var(--r); } .nc-leg i.z2{ background:var(--o); } .nc-leg i.z3{ background:var(--g); }
.nc-leg em{ display:inline-block; width:2px; height:12px; background:#0F2447; margin-inline-end:5px; vertical-align:-2px; }
.nc-an{ border:1px solid var(--ln); border-radius:9px; padding:10px 16px; } .nc-an h3{ margin:0 0 4px; font-size:15px; } .nc-an ol{ margin:0; padding-inline-start:20px; font-size:13px; line-height:2; }
.nc-sig{ display:grid; grid-template-columns:repeat(3,1fr); gap:18px; margin-top:22px; text-align:center; font-size:12.5px; color:#344054; } .nc-sig i{ display:block; border-bottom:1px dotted #475467; height:28px; }
@media (max-width:600px){
  .nc-band{ padding:14px 14px; flex-wrap:wrap; } .nc-ttl h2{ font-size:16px; } .nc-body{ padding:14px 12px; }
  .nc-info,.nc-info:has(> div:nth-child(4)){ grid-template-columns:1fr 1fr; } .nc-info div{ border-inline-start:0; border-top:1px solid var(--ln); } .nc-info div:nth-child(-n+2){ border-top:0; } .nc-info div:first-child{ grid-column:1/-1; } .nc-info div:nth-child(2){ border-top:1px solid var(--ln); }
  .nc-kp{ grid-template-columns:1fr 1fr; } .nc-kp b{ font-size:19px; }
  .nc-sj td{ padding:6px 8px; } .nc-k{ width:auto; } .nc-b{ width:30%; } .nc-l{ display:none; }
  .nc-sig{ display:none; }
}
@media print{ .nc{ border:0; border-radius:0; } .nc *{ -webkit-print-color-adjust:exact; print-color-adjust:exact; } .nc-sig{ display:grid !important; } }
`;
