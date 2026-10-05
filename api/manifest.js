// ملف التطبيق (manifest) حسب المدرسة: اسم التطبيق تحت الأيقونة = اسم المدرسة المختصر
// /api/manifest?app=staff|parent&school=slug
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://sovfrlvcvcyjcyauurpl.supabase.co';
const ANON_KEY = 'sb_publishable_jWUr3tDZL-Bg_Qjr-iH5bg_xSEipTmA'; // نفس المفتاح العام المستخدم بالصفحات

async function schoolBySlug(slug) {
  if (!slug || !/^[a-z0-9-]{1,60}$/i.test(slug)) return null;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/schools?slug=eq.${encodeURIComponent(slug)}&select=name,slug,branding`, { headers: { apikey: ANON_KEY } });
    if (!r.ok) return null;
    const rows = await r.json();
    return rows && rows[0] ? rows[0] : null;
  } catch (e) { return null; }
}

module.exports = async (req, res) => {
  const q = req.query || {};
  const isParent = q.app === 'parent';
  const sc = await schoolBySlug(String(q.school || ''));
  const short = sc ? ((sc.branding && sc.branding.short_name) || sc.name) : '';
  const slugQs = sc ? '?school=' + encodeURIComponent(sc.slug) : '';
  const icon = isParent ? 'icon-parent' : 'icon';
  const manifest = {
    id: isParent ? '/parent.html' + slugQs : '/index.html' + slugQs,
    name: short ? (isParent ? `خطة الأسبوع - ${short}` : short) : (isParent ? 'خطة الأسبوع' : 'مُدار'),
    short_name: short || (isParent ? 'خطة الأسبوع' : 'مُدار'),
    description: isParent ? 'متابعة الخطة الأسبوعية والجدول الدراسي لولي الأمر' : 'منصة المعلمين والإدارة لخدمات المدرسة',
    start_url: isParent ? '/parent.html' + slugQs : '/index.html',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    background_color: '#0F2447',
    theme_color: '#0F2447',
    dir: 'rtl',
    lang: 'ar',
    icons: [
      { src: `/${icon}-192.png?v=3`, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: `/${icon}-512.png?v=3`, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: `/${icon}-512.png?v=3`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
  res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
  res.status(200).send(JSON.stringify(manifest));
};
