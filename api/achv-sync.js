// ملفات الإنجاز: يسحب إكسل «قارئ ملفات الإنجاز» من رابط المشاركة في ون درايف ويحفظ نتيجته للمدرسة
// POST /api/achv-sync  { school }  مع Authorization: Bearer <جلسة المستخدم>
// الصلاحيات تتحقق بقاعدة البيانات نفسها (RLS): ما يقرأ الرابط ولا يحفظ إلا المدير/الوكيل لنفس المدرسة
const XLSX = require('xlsx');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://sovfrlvcvcyjcyauurpl.supabase.co';
const ANON_KEY = 'sb_publishable_jWUr3tDZL-Bg_Qjr-iH5bg_xSEipTmA';
const MAX_BYTES = 15 * 1024 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const clean = v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
const toNum = v => { const t = String(v == null ? '' : v).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).trim(); if (!t) return null; const n = Number(t); return Number.isFinite(n) ? n : null; };
// تاريخ إكسل (رقم تسلسلي بتوقيت الجهاز) ← نص محلي بدون منطقة زمنية: 2026-10-01T10:30
const excelDate = v => { if (typeof v !== 'number' || !(v > 20000 && v < 80000)) return null; return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 16); };

// رابط تنزيل مباشر من رابط المشاركة (روابط «أي شخص لديه الرابط» فقط)
function downloadUrl(raw) {
  let u;
  try { u = new URL(String(raw).trim()); } catch (e) { return null; }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase();
  if (!(host.endsWith('.sharepoint.com') || host === '1drv.ms' || host === 'onedrive.live.com')) return null;
  u.searchParams.set('download', '1');
  return u.toString();
}

// روابط مشاركة SharePoint تمر بعدة تحويلات وتحط كوكي دخول ضيف بالطريق - نتبعها يدويًا ونحمل الكوكيز
async function fetchWithCookies(startUrl, deps) {
  const jar = new Map();
  let url = startUrl;
  for (let i = 0; i < 10; i++) {
    const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36', Accept: '*/*' };
    if (jar.size) headers.Cookie = [...jar].map(([k, v]) => k + '=' + v).join('; ');
    const resp = await deps.fetch(url, { redirect: 'manual', headers });
    const sc = resp.headers.getSetCookie ? resp.headers.getSetCookie() : String(resp.headers.get('set-cookie') || '').split(/,(?=\s*[^ ;=]+=)/).filter(Boolean);
    for (const c of sc) { const m = /^([^=;\s]+)=([^;]*)/.exec(c); if (m) jar.set(m[1], m[2]); }
    const loc = resp.headers.get('location');
    if (resp.status >= 300 && resp.status < 400 && loc) {
      const next = new URL(loc, url);
      if (next.protocol !== 'https:') throw new Error('redirect');
      url = next.toString();
      continue;
    }
    const u = new URL(url);
    return { resp, finalUrl: u.hostname + u.pathname };
  }
  throw new Error('too many redirects');
}

// أسماء أعمدة إنجليزية بديلة (كود Power Query بدون حروف عربية)
const HEADER_ALIAS = { spec: 'التخصص', teacher: 'المعلم', term: 'الفصل', itemno: 'رقم البند', item: 'البند', files: 'عدد الملفات', modified: 'آخر تعديل' };
function findHeader(rows, must) {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const cells = (rows[i] || []).map(v => { const t = clean(v); return HEADER_ALIAS[t.toLowerCase()] || t; });
    if (must.every(m => cells.includes(m))) return { index: i, col: name => cells.indexOf(name) };
  }
  return null;
}

function parseWorkbook(buf) {
  const wb = XLSX.read(buf, { type: 'buffer' });
  let data = null, rules = [];
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null });
    if (!data) {
      const h = findHeader(rows, ['المعلم', 'البند', 'عدد الملفات']);
      if (h) {
        const c = { spec: h.col('التخصص'), teacher: h.col('المعلم'), term: h.col('الفصل'), no: h.col('رقم البند'), item: h.col('البند'), files: h.col('عدد الملفات'), mod: h.col('آخر تعديل') };
        data = [];
        for (const r of rows.slice(h.index + 1)) {
          const teacher = clean(r[c.teacher]), item = clean(r[c.item]);
          if (!teacher || !item) continue;
          const m = c.mod >= 0 ? r[c.mod] : null;
          data.push({
            spec: c.spec >= 0 ? clean(r[c.spec]) : '',
            term: c.term >= 0 ? clean(r[c.term]) : '',
            teacher, item,
            no: c.no >= 0 ? toNum(r[c.no]) : null,
            files: toNum(r[c.files]) || 0,
            modified: excelDate(m),
          });
          if (data.length >= 8000) break;
        }
        continue;
      }
    }
    if (!rules.length) {
      const h = findHeader(rows, ['البند', 'إلزامي']);
      if (h) {
        const c = { no: h.col('رقم البند'), name: h.col('البند'), req: h.col('إلزامي'), min: h.col('الحد الأدنى للملفات'), note: h.col('ملاحظة') };
        for (const r of rows.slice(h.index + 1)) {
          const name = clean(r[c.name]), req = clean(r[c.req]);
          if (!name || !req) continue;
          rules.push({
            no: c.no >= 0 ? toNum(r[c.no]) : null,
            name,
            required: /^(نعم|yes|y|1|true)$/i.test(req),
            min: Math.max(1, (c.min >= 0 ? toNum(r[c.min]) : 1) || 1),
            note: c.note >= 0 ? clean(r[c.note]) : '',
          });
          if (rules.length >= 100) break;
        }
      }
    }
  }
  return { data, rules };
}

async function handle(body, token, deps) {
  const school = String((body && body.school) || '');
  if (!UUID_RE.test(school)) return [400, { error: 'school' }];
  if (!token) return [401, { error: 'auth' }];
  const h = { apikey: ANON_KEY, Authorization: 'Bearer ' + token };

  const sr = await deps.fetch(`${SUPABASE_URL}/rest/v1/achv_sources?school_id=eq.${school}&select=xlsx_url`, { headers: h });
  if (sr.status === 401) return [401, { error: 'auth' }];
  if (!sr.ok) return [500, { error: 'db', status: sr.status }];
  const src = (await sr.json())[0];
  if (!src) return [404, { error: 'no_source' }];   // ما فيه رابط، أو المستخدم مو مدير/وكيل لهذي المدرسة
  const url = downloadUrl(src.xlsx_url);
  if (!url) return [400, { error: 'bad_url' }];

  let got;
  try { got = await fetchWithCookies(url, deps); }
  catch (e) { return [502, { error: 'download', detail: String(e.message || e) }]; }
  const { resp, finalUrl } = got;
  if (!resp.ok) return [502, { error: 'download', status: resp.status, at: finalUrl }];
  const buf = Buffer.from(await resp.arrayBuffer());
  if (buf.length > MAX_BYTES) return [413, { error: 'too_big' }];
  // ملف إكسل = zip يبدأ بـ PK ؛ غيره غالبًا صفحة تسجيل دخول أو صفحة عرض
  if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
    const txt = buf.slice(0, 4000).toString('utf8');
    const title = (txt.match(/<title[^>]*>([^<]{0,120})/i) || [])[1] || '';
    return [422, { error: 'not_public', at: finalUrl, type: resp.headers.get('content-type') || '', title: title.trim() }];
  }

  let parsed;
  try { parsed = parseWorkbook(buf); } catch (e) { return [422, { error: 'parse' }]; }
  if (!parsed.data) return [422, { error: 'no_table' }];

  const fetched_at = new Date().toISOString();
  const wr = await deps.fetch(`${SUPABASE_URL}/rest/v1/achv_snapshots?on_conflict=school_id`, {
    method: 'POST',
    headers: { ...h, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ school_id: school, rows: parsed.data, rules: parsed.rules, fetched_at }),
  });
  if (!wr.ok) return [wr.status === 401 || wr.status === 403 ? 403 : 500, { error: 'save', status: wr.status }];

  return [200, {
    ok: true, fetched_at, rows: parsed.data.length, rules: parsed.rules.length,
    teachers: new Set(parsed.data.map(r => r.teacher)).size,
  }];
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const auth = String(req.headers.authorization || '');
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    const [status, out] = await handle(body, token, { fetch });
    res.setHeader('Cache-Control', 'no-store');
    res.status(status).json(out);
  } catch (e) {
    res.status(500).json({ error: 'server' });
  }
};
module.exports.handle = handle;
module.exports.parseWorkbook = parseWorkbook;
module.exports.downloadUrl = downloadUrl;
