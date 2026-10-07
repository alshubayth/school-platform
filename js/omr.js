/* =========================================================================
 * قراءة ورقة الإجابة من صورة (كاميرا الجوال) - بدون مكتبات خارجية
 *
 * ١) نلقى علامات الزوايا الأربع (مربعات سوداء) بصورة مصغّرة
 * ٢) تحويل منظوري (homography) من مليمترات الورقة ← بكسلات الصورة
 * ٣) نتأكد من اتجاه الورقة (مقلوبة/مدوّرة) بمطابقة إطارات الفقاعات
 * ٤) ضبط محلي لكل مجموعة فقاعات (الورقة ممكن تكون منحنية شوي)
 * ٥) نقيس سواد كل فقاعة نسبةً لبياض الورق حولها ونصنّف: مظلّلة / فاضية / أكثر من وحدة
 * ٦) نقرأ باركود Code 128 (رقم الهوية) من مكانه المعروف بالورقة
 * المواقع كلها من sheetGeometry في answer-sheet.js (نفس معادلات الطباعة).
 * ========================================================================= */

/* ---------- صورة رمادية ---------- */
export function grayFromImageData(img) {
  const { width: w, height: h, data } = img;
  const d = new Uint8ClampedArray(w * h);
  for (let i = 0, j = 0; i < d.length; i++, j += 4) d[i] = (data[j] * 77 + data[j + 1] * 150 + data[j + 2] * 29) >> 8;
  return { w, h, d };
}

// تصغير بمتوسط المربعات (عامل صحيح)
export function shrinkGray(g, maxDim) {
  const k = Math.max(1, Math.floor(Math.max(g.w, g.h) / maxDim));
  if (k === 1) return { ...g, k: 1 };
  const w = Math.floor(g.w / k), h = Math.floor(g.h / k);
  const d = new Uint8ClampedArray(w * h);
  const kk = k * k;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let yy = 0; yy < k; yy++) {
        let o = (y * k + yy) * g.w + x * k;
        for (let xx = 0; xx < k; xx++) s += g.d[o++];
      }
      d[y * w + x] = s / kk;
    }
  }
  return { w, h, d, k };
}

/* ---------- علامات الزوايا ---------- */
export function findMarkCandidates(g) {
  const { w, h, d } = g;
  const W1 = w + 1;
  const integ = new Float64Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) { row += d[y * w + x]; integ[(y + 1) * W1 + x + 1] = integ[y * W1 + x + 1] + row; }
  }
  const minDim = Math.min(w, h);
  const r = Math.max(8, Math.round(minDim / 14));
  const mean = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      mean[y * w + x] = (integ[y1 * W1 + x1] - integ[y0 * W1 + x1] - integ[y1 * W1 + x0] + integ[y0 * W1 + x0]) / ((x1 - x0) * (y1 - y0));
    }
  }
  const out = [];
  // عتبتين: العادية، وأشد (لو العلامة لاصقة بخلفية غامقة برّا الورقة)
  for (const ratio of [0.5, 0.33]) {
    const bin = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) bin[i] = d[i] < mean[i] * ratio && d[i] < 160 ? 1 : 0;
    // فتح مورفولوجي: يشيل الخطوط الرفيعة (مثل إطار الباركود اللاصق بالعلامة) ويبقي المربعات
    open2(bin, w, h, Math.max(1, Math.round(minDim / 350)));
    components(bin, w, h, minDim).forEach(c => {
      if (!out.some(o => Math.hypot(o.x - c.x, o.y - c.y) < Math.max(o.side, c.side) * 0.7)) out.push(c);
    });
  }
  return out;
}

function morph(src, w, h, rad, erode) {
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
  const want = erode ? 1 : 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = erode ? 1 : 0;
    for (let k = -rad; k <= rad; k++) { const xx = x + k; const p = xx < 0 || xx >= w ? 1 - want : src[y * w + xx]; if (erode ? !p : p) { v = 1 - v; break; } }
    tmp[y * w + x] = v;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = erode ? 1 : 0;
    for (let k = -rad; k <= rad; k++) { const yy = y + k; const p = yy < 0 || yy >= h ? 1 - want : tmp[yy * w + x]; if (erode ? !p : p) { v = 1 - v; break; } }
    out[y * w + x] = v;
  }
  return out;
}
function open2(bin, w, h, rad) {
  const o = morph(morph(bin, w, h, rad, true), w, h, rad, false);
  bin.set(o);
}

const ANGLES = Array.from({ length: 18 }, (_, i) => (i * 5 * Math.PI) / 180);
function components(bin, w, h, minDim) {
  const minSide = minDim * 0.008, maxSide = minDim * 0.075;
  const minA = minSide * minSide, maxA = maxSide * maxSide;
  const stack = new Int32Array(w * h);
  const pix = new Int32Array(Math.ceil(maxA * 1.5) + 8);
  const out = [];
  for (let start = 0; start < w * h; start++) {
    if (bin[start] !== 1) continue;
    let sp = 0, n = 0, big = false;
    stack[sp++] = start; bin[start] = 2;
    while (sp > 0) {
      const p = stack[--sp];
      const x = p % w;
      if (n < pix.length) pix[n] = p; else big = true;
      n++;
      if (x > 0 && bin[p - 1] === 1) { bin[p - 1] = 2; stack[sp++] = p - 1; }
      if (x < w - 1 && bin[p + 1] === 1) { bin[p + 1] = 2; stack[sp++] = p + 1; }
      if (p >= w && bin[p - w] === 1) { bin[p - w] = 2; stack[sp++] = p - w; }
      if (p + w < w * h && bin[p + w] === 1) { bin[p + w] = 2; stack[sp++] = p + w; }
    }
    if (big || n < minA || n > maxA) continue;
    let sx = 0, sy = 0;
    for (let i = 0; i < n; i++) { const p = pix[i]; sx += p % w; sy += (p - (p % w)) / w; }
    const cx = sx / n, cy = sy / n;
    let cxx = 0, cyy = 0, cxy = 0;
    for (let i = 0; i < n; i++) { const p = pix[i], x = p % w - cx, y = (p - (p % w)) / w - cy; cxx += x * x; cyy += y * y; cxy += x * y; }
    cxx /= n; cyy /= n; cxy /= n;
    const tr = cxx + cyy, det = cxx * cyy - cxy * cxy;
    const disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
    const l1 = tr / 2 + disc, l2 = tr / 2 - disc;
    if (l2 <= 0 || l1 / l2 > 2.6) continue;
    const solid = n / (12 * Math.sqrt(det) + 1e-9);   // شكل مصمت (مو حرف أو خط)
    if (solid < 0.78 || solid > 1.25) continue;
    // مربّع: مساحته تملأ أصغر مستطيل محيط (بأي زاوية)، أما الدائرة المظللة فتملأ π/4 بس
    let minRect = Infinity;
    for (const a of ANGLES) {
      const ca = Math.cos(a), sa = Math.sin(a);
      let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
      for (let i = 0; i < n; i++) {
        const p = pix[i], x = p % w - cx, y = (p - (p % w)) / w - cy;
        const u = x * ca + y * sa, v = -x * sa + y * ca;
        if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v;
      }
      minRect = Math.min(minRect, (u1 - u0 + 1) * (v1 - v0 + 1));
    }
    const rect = n / minRect;
    if (rect < 0.84) continue;
    out.push({ x: cx + 0.5, y: cy + 0.5, area: n, side: Math.sqrt(n), rect });
  }
  return out;
}

/* ---------- تحويل منظوري ---------- */
function solve(A, b) {
  const n = b.length;
  for (let i = 0; i < n; i++) {
    let mx = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[mx][i])) mx = r;
    [A[i], A[mx]] = [A[mx], A[i]]; [b[i], b[mx]] = [b[mx], b[i]];
    if (Math.abs(A[i][i]) < 1e-12) return null;
    for (let r = i + 1; r < n; r++) {
      const f = A[r][i] / A[i][i];
      for (let c = i; c < n; c++) A[r][c] -= f * A[i][c];
      b[r] -= f * b[i];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let c = i + 1; c < n; c++) s -= A[i][c] * x[c];
    x[i] = s / A[i][i];
  }
  return x;
}
// H يحوّل src ← dst (أربع نقاط)
export function homography(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const s = solve(A, b);
  return s ? [...s, 1] : null;
}
export function applyH(H, x, y) {
  const z = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / z, (H[3] * x + H[4] * y + H[5]) / z];
}

function sample(g, x, y) {
  if (x < 0 || y < 0 || x >= g.w - 1 || y >= g.h - 1) return 255;
  const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = y0 * g.w + x0;
  const a = g.d[i], b = g.d[i + 1], c = g.d[i + g.w], d = g.d[i + g.w + 1];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

/* ---------- تحديد الورقة: أي ٤ علامات + أي اتجاه ----------
 * layouts: [{ name, marks: [[x,y] TL,TR,BL,BR بالمليمتر], sheets: [ox...] }]
 * نجرب كل اتجاه (٠، ٩٠، ١٨٠، ٢٧٠) ونختار اللي إطارات فقاعاته أوضح. */
const ROT = [[0, 1, 2, 3], [2, 0, 3, 1], [3, 2, 1, 0], [1, 3, 0, 2]]; // ترتيب علامات الصورة لكل دوران

function quadFromExtremes(c) {
  if (c.length < 4) return null;
  const by = f => c.reduce((a, b) => (f(b) > f(a) ? b : a));
  const tl = by(p => -(p.x + p.y)), br = by(p => p.x + p.y), tr = by(p => p.x - p.y), bl = by(p => p.y - p.x);
  if (new Set([tl, tr, bl, br]).size < 4) return null;
  return [tl, tr, bl, br];
}
function quadOk(q, imgW, imgH) {
  const areas = q.map(p => p.area);
  if (Math.max(...areas) > Math.min(...areas) * 4.5) return false;
  const [tl, tr, bl, br] = q;
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  // محدّب: TL→TR→BR→BL
  const poly = [tl, tr, br, bl];
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const s = Math.sign(cross(poly[i], poly[(i + 1) % 4], poly[(i + 2) % 4]));
    if (!s || (sign && s !== sign)) return false;
    sign = s;
  }
  const area = Math.abs(cross(tl, tr, br) + cross(tl, br, bl)) / 2;
  return area > imgW * imgH * 0.12;
}
function quadAspect(q) {
  const [tl, tr, bl, br] = q;
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  return ((d(tl, bl) + d(tr, br)) / 2) / ((d(tl, tr) + d(bl, br)) / 2);
}
function hull(pts) {
  const p = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cr = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.slice().reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
export function candidateQuads(cands, imgW, imgH) {
  const quads = [];
  const seen = new Set();
  const add = q => { const k = q.map(p => cands.indexOf(p)).join(','); if (!seen.has(k)) { seen.add(k); quads.push(q); } };
  const ext = quadFromExtremes(cands);
  if (ext && quadOk(ext, imgW, imgH)) add(ext);
  if (cands.length >= 4) {
    // العلامات بزوايا الورقة، فتكون على الغلاف الخارجي للنقاط (أو الطبقة اللي بعده لو فيه أشياء برّا الورقة)
    let rest = cands.slice(), pool = [];
    for (let layer = 0; layer < 3 && rest.length; layer++) {
      const hl = hull(rest);
      pool = pool.concat(hl);
      rest = rest.filter(c => !hl.includes(c));
    }
    pool = pool.sort((a, b) => b.area - a.area).slice(0, 26);
    const combos = [];
    for (let a = 0; a < pool.length; a++) for (let b = a + 1; b < pool.length; b++) for (let c = b + 1; c < pool.length; c++) for (let d = c + 1; d < pool.length; d++) {
      const q = quadFromExtremes([pool[a], pool[b], pool[c], pool[d]]);
      if (!q || !quadOk(q, imgW, imgH)) continue;
      const [tl, tr, bl, br] = q;
      const area = Math.abs((tr.x - tl.x) * (bl.y - tl.y) - (tr.y - tl.y) * (bl.x - tl.x)) + Math.abs((br.x - tr.x) * (bl.y - tr.y) - (br.y - tr.y) * (bl.x - tr.x));
      // حجم العلامة يتناسب مع طول الضلعين حولها (المنظور يكبّر القريب ويصغّر البعيد بنفس النسبة)
      const D = (u, v) => Math.hypot(u.x - v.x, u.y - v.y);
      const rel = [tl.side / Math.sqrt(D(tl, tr) * D(tl, bl)), tr.side / Math.sqrt(D(tr, tl) * D(tr, br)), bl.side / Math.sqrt(D(bl, tl) * D(bl, br)), br.side / Math.sqrt(D(br, tr) * D(br, bl))];
      const pen = Math.max(...rel) / Math.min(...rel);
      if (pen > 2.1) continue;
      combos.push({ q, area });
    }
    combos.sort((x, y) => y.area - x.area).slice(0, 20).forEach(cmb => add(cmb.q));
  }
  return quads;
}

// وضوح إطارات الفقاعات عند المواقع المتوقعة (للتأكد من الاتجاه والمحاذاة)
function ringContrast(g, H, pts, rad, dx = 0, dy = 0) {
  let ring = 0, out = 0, n = 0;
  const N = 12;
  for (const [x, y] of pts) {
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      const [rx, ry] = applyH(H, x + dx + ca * rad, y + dy + sa * rad);
      const [ox, oy] = applyH(H, x + dx + ca * (rad + 0.75), y + dy + sa * (rad + 0.75));
      const [ix, iy] = applyH(H, x + dx + ca * (rad - 0.75), y + dy + sa * (rad - 0.75));
      ring += sample(g, rx, ry); out += (sample(g, ox, oy) + sample(g, ix, iy)) / 2; n++;
    }
  }
  return n ? (out - ring) / n : 0;
}

/* ---------- قراءة الورقة ----------
 * gFull: الصورة الرمادية كاملة الدقة. geo: من sheetGeometry. layout: من layoutsFor.
 * يرجّع لكل ورقة طالب بالصورة: { answers: [idx | -1 فاضي | -2 متعدد], dark, flags, model, essay, barcode } */
export function layoutsFor(geo, pageSize) {
  const single = { name: 'sheet', marks: geo.marks, sheets: [0] };
  if (pageSize !== 'A4L2') return [single];
  // صفحة A4 بالعرض فيها ورقتين ما انقصّت: العلامات الخارجية للنصفين
  const m = geo.marks;
  return [single, { name: 'pair', marks: [m[0], [m[1][0] + geo.w, m[1][1]], m[2], [m[3][0] + geo.w, m[3][1]]], sheets: [geo.w, 0] }];
}

export function locateSheet(gFull, geo, pageSize, opts = {}) {
  const small = shrinkGray(gFull, opts.detectDim || 900);
  const cands = findMarkCandidates(small);
  const quads = candidateQuads(cands, small.w, small.h);
  if (!quads.length) return { ok: false, reason: 'marks', cands: cands.length, candPts: cands.map(c => [c.x * small.k, c.y * small.k]) };
  const layouts = layoutsFor(geo, pageSize);
  // عيّنة من الفقاعات مقسومة كتل (كل كتلة تاخذ إزاحتها الخاصة - الورقة ممكن تكون منحنية)
  const probeBlocks = [];
  for (let i = 0; i < geo.items.length; i += 8) probeBlocks.push(geo.items.slice(i, i + 8).filter((_, k) => k % 2 === 0).map(r => r[0]).concat(geo.items.slice(i, i + 8).filter((_, k) => k % 2 === 1).map(r => r[r.length - 1])));
  if (geo.essay) probeBlocks.push(geo.essay[0].pts.filter((_, k) => k % 2 === 0));
  const blockScore = (H, ox) => {
    let tot = 0;
    for (const bl of probeBlocks) {
      const pts = bl.map(([x, y]) => [x + ox, y]);
      let b = -1e9;
      for (let dy = -2.4; dy <= 2.401; dy += 0.8) for (let dx = -2.4; dx <= 2.401; dx += 0.8) b = Math.max(b, ringContrast(gFull, H, pts, geo.bubble / 2, dx, dy));
      tot += b;
    }
    return tot / Math.max(1, probeBlocks.length);
  };
  let best = null;
  for (const q of quads) {
    if (best && best.score > 35) break;   // أول اختيار (الزوايا الخارجية) واضح - ما يحتاج نجرب غيره
    const asp = quadAspect(q);
    for (const lay of layouts) {
      const [tl, tr, bl] = lay.marks;
      const layAsp = (bl[1] - tl[1]) / (tr[0] - tl[0]);
      for (let r = 0; r < 4; r++) {
        const imgAsp = r % 2 ? 1 / asp : asp;
        if (Math.abs(Math.log(imgAsp / layAsp)) > 0.4) continue;
        const order = ROT[r].map(i => q[i]);
        const dst = order.map(p => [p.x * small.k, p.y * small.k]);
        const H = homography(lay.marks, dst);
        if (!H) continue;
        // حجم كل علامة بالصورة لازم يطابق حجمها المتوقع من التحويل
        const half = geo.mark / 2;
        const sizeOk = order.every((p, i) => {
          const [mx, my] = lay.marks[i];
          const c = [[-half, -half], [half, -half], [half, half], [-half, half]].map(([a, b]) => applyH(H, mx + a, my + b));
          let ar = 0;
          for (let k = 0; k < 4; k++) { const [x1, y1] = c[k], [x2, y2] = c[(k + 1) % 4]; ar += x1 * y2 - x2 * y1; }
          const ratio = Math.sqrt(p.area * small.k * small.k / Math.abs(ar / 2));
          return ratio > 0.72 && ratio < 1.35;
        });
        if (!sizeOk) continue;
        let score = 0;
        lay.sheets.forEach(ox => { score += blockScore(H, ox); });
        score /= lay.sheets.length;
        if (!best || score > best.score) best = { score, H, layout: lay, quad: dst, rot: r };
      }
    }
  }
  if (!best || best.score < 18) return { ok: false, reason: best ? 'unclear' : 'shape', score: best ? best.score : 0, candPts: cands.map(c => [c.x * small.k, c.y * small.k]) };
  return { ok: true, ...best };
}

function percentile(arr, p) {
  const s = arr.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))];
}

// ضبط محلي: أفضل إزاحة (مم) لمجموعة فقاعات تخلّي إطاراتها أوضح
function refineOffset(g, H, pts, rad) {
  let best = { dx: 0, dy: 0, s: -1e9 };
  const sub = pts.length > 24 ? pts.filter((_, i) => i % Math.ceil(pts.length / 24) === 0) : pts;
  for (let dy = -2; dy <= 2.001; dy += 0.4) for (let dx = -2; dx <= 2.001; dx += 0.4) {
    const s = ringContrast(g, H, sub, rad, dx, dy);
    if (s > best.s) best = { dx, dy, s };
  }
  const c = best;
  for (let dy = c.dy - 0.3; dy <= c.dy + 0.301; dy += 0.15) for (let dx = c.dx - 0.3; dx <= c.dx + 0.301; dx += 0.15) {
    const s = ringContrast(g, H, sub, rad, dx, dy);
    if (s > best.s) best = { dx, dy, s };
  }
  return best;
}

// سواد فقاعة: ١ - (متوسط داخلها ÷ بياض الورق حولها)
function bubbleDark(g, H, x, y, b) {
  const rIn = b * 0.36, step = b * 0.09;
  let s = 0, n = 0;
  for (let yy = -rIn; yy <= rIn + 1e-9; yy += step) for (let xx = -rIn; xx <= rIn + 1e-9; xx += step) {
    if (xx * xx + yy * yy > rIn * rIn) continue;
    const [u, v] = applyH(H, x + xx, y + yy);
    s += sample(g, u, v); n++;
  }
  const outs = [];
  const rOut = b / 2 + 0.75;
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    const [u, v] = applyH(H, x + Math.cos(a) * rOut, y + Math.sin(a) * rOut);
    outs.push(sample(g, u, v));
  }
  const white = Math.max(60, percentile(outs, 0.8));
  const d = Math.max(0, Math.min(1, 1 - (s / n) / white));
  // ظل حاد يقطع الفقاعة: بياض الحلقة حولها متفاوت - القراءة غير مضمونة
  bubbleDark.spread = (white - percentile(outs, 0.25)) / white;
  return d;
}

// تصنيف: نحسب مستوى الفاضي (الوسيط) ومستوى المظلل من الورقة نفسها
function classify(groups, choicesOf) {
  const all = groups.flat();
  const base = percentile(all, 0.5);
  const maxes = groups.map(g => Math.max(...g));
  const filledLvl = Math.max(base + 0.25, percentile(maxes, 0.8));
  const T = base + Math.max(0.16, (filledLvl - base) * 0.42);
  return groups.map((d, qi) => {
    const order = d.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]);
    const [m1, i1] = order[0], m2 = order[1] ? order[1][0] : 0;
    let ans, unsure = false;
    if (m1 < T) { ans = -1; unsure = m1 > T - 0.08; }
    else if (m2 >= T && m2 > m1 * 0.62) { ans = -2; unsure = m2 < T + 0.08; }
    else { ans = i1; unsure = m1 < T + 0.07 || m2 > T - 0.06; }
    return { ans, unsure, choices: choicesOf ? choicesOf(qi) : d.length };
  }).map((r, i) => ({ ...r, dark: groups[i] }));
}

export function readSheet(gFull, geo, loc, ox = 0) {
  const H = loc.H;
  const b = geo.bubble;
  const shift = ([x, y]) => [x + ox, y];
  // مجموعات للضبط المحلي: كل عمود أسئلة مقسوم لكتل ≤ ١٠ أسطر
  const items = geo.items.map(row => row.map(shift));
  const blocks = [];
  let cur = null;
  items.forEach((row, qi) => {
    const colKey = Math.round(row[0][0]);
    if (!cur || cur.col !== colKey || cur.qs.length >= 10) { cur = { col: colKey, qs: [] }; blocks.push(cur); }
    cur.qs.push(qi);
  });
  const off = new Array(items.length);
  let contrastSum = 0;
  blocks.forEach(bl => {
    const r = refineOffset(gFull, H, bl.qs.flatMap(q => items[q]), b / 2);
    contrastSum += r.s;
    bl.qs.forEach(q => { off[q] = r; });
  });
  const spread = [];
  const dark = items.map((row, qi) => { let sp = 0; const d = row.map(([x, y]) => { const v = bubbleDark(gFull, H, x + off[qi].dx, y + off[qi].dy, b); sp = Math.max(sp, bubbleDark.spread); return v; }); spread.push(sp); return d; });
  const cls = items.length ? classify(dark) : [];
  cls.forEach((c, i) => { if (spread[i] > 0.25) c.unsure = true; });
  const res = {
    answers: cls.map(c => c.ans), unsure: cls.map(c => c.unsure), dark,
    contrast: blocks.length ? contrastSum / blocks.length : 0,
    offsets: off.map(o => [o.dx, o.dy]),
    model: null, essay: null, barcode: null,
  };
  const allEmpty = dark.flat();
  const base = allEmpty.length ? percentile(allEmpty, 0.5) : 0.1;
  const pickOne = (pts) => {
    const r = refineOffset(gFull, H, pts, b / 2);
    const d = pts.map(([x, y]) => bubbleDark(gFull, H, x + r.dx, y + r.dy, b));
    const order = d.map((v, i) => [v, i]).sort((p, q) => q[0] - p[0]);
    const T = base + 0.22;
    if (order[0][0] < T) return { idx: -1, dark: d, offset: [r.dx, r.dy] };
    if (order[1] && order[1][0] >= T && order[1][0] > order[0][0] * 0.62) return { idx: -2, dark: d, offset: [r.dx, r.dy] };
    return { idx: order[0][1], dark: d, offset: [r.dx, r.dy], unsure: order[0][0] < T + 0.08 };
  };
  if (geo.model) {
    const m = pickOne(geo.model.map(shift));
    res.model = { idx: m.idx, unsure: !!m.unsure, dark: m.dark, offset: m.offset };
  }
  if (geo.essay) {
    const rows = geo.essay.map(r => ({ values: r.values, ...pickOne(r.pts.map(shift)) }));
    const ok = rows.every(r => r.idx >= 0);
    res.essay = { value: ok ? rows.reduce((s, r) => s + r.values[r.idx], 0) : null, rows: rows.map(r => ({ idx: r.idx, dark: r.dark, unsure: !!r.unsure, offset: r.offset })), unsure: rows.some(r => r.unsure || r.idx < 0) };
  }
  res.barcode = readBarcode(gFull, H, geo, ox);
  return res;
}

/* ---------- باركود Code 128 ---------- */
const C128 = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232',
].map(s => [...s].map(Number));
const STOP = [2, 3, 3, 1, 1, 1, 2];

function matchSymbol(runs) {
  // مسافات حافة-لحافة (تتحمّل انتشار الحبر) + العروض نفسها بوزن أقل
  const tot = runs.reduce((a, b) => a + b, 0);
  const u = runs.map(r => (r * 11) / tot);
  const e = [u[0] + u[1], u[1] + u[2], u[2] + u[3], u[3] + u[4]];
  let best = -1, bestErr = 1e9;
  for (let v = 0; v < C128.length; v++) {
    const p = C128[v];
    const pe = [p[0] + p[1], p[1] + p[2], p[2] + p[3], p[3] + p[4]];
    let err = 0;
    for (let i = 0; i < 4; i++) err += (e[i] - pe[i]) ** 2;
    for (let i = 0; i < 6; i++) err += 0.25 * (u[i] - p[i]) ** 2;
    if (err < bestErr) { bestErr = err; best = v; }
  }
  return bestErr < 1.6 ? best : -1;
}

export function decodeRuns(runs) {
  // runs: عروض متناوبة تبدأ بخط أسود
  for (let s = 0; s + 6 <= Math.min(runs.length, 12); s += 2) {
    const start = matchSymbol(runs.slice(s, s + 6));
    if (start < 103 || start > 105) continue;
    const vals = [start];
    let i = s + 6, okStop = false;
    while (i + 6 <= runs.length) {
      if (i + 7 <= runs.length) {
        const seg = runs.slice(i, i + 7), tot = seg.reduce((a, b) => a + b, 0);
        const err = seg.reduce((a, r, k) => a + ((r * 13) / tot - STOP[k]) ** 2, 0);
        if (err < 1.2 && vals.length >= 3) { okStop = true; break; }
      }
      const v = matchSymbol(runs.slice(i, i + 6));
      if (v < 0) break;
      vals.push(v); i += 6;
    }
    if (!okStop || vals.length < 3) continue;
    const chk = vals.pop();
    let sum = vals[0];
    for (let k = 1; k < vals.length; k++) sum += vals[k] * k;
    if (sum % 103 !== chk) continue;
    let set = vals[0] === 105 ? 'C' : vals[0] === 104 ? 'B' : 'A', txt = '';
    for (const v of vals.slice(1)) {
      if (v === 99) { set = 'C'; continue; }
      if (v === 100) { set = 'B'; continue; }
      if (v === 101) { set = 'A'; continue; }
      if (v > 102) continue;
      if (set === 'C') txt += String(v).padStart(2, '0');
      else if (set === 'B') txt += String.fromCharCode(v + 32);
      else txt += String.fromCharCode(v < 64 ? v + 32 : v - 64);
    }
    return txt;
  }
  return null;
}

// خط مسح: قيم ← عروض الخطوط والفراغات (بحواف بين البكسلات)
export function profileToRuns(vals) {
  const lo = percentile(vals, 0.05), hi = percentile(vals, 0.95);
  if (hi - lo < 40) return null;
  const t = (lo + hi) / 2;
  const edges = [];
  let dark = vals[0] < t;
  for (let i = 1; i < vals.length; i++) {
    const dk = vals[i] < t;
    if (dk !== dark) { edges.push({ x: i - 1 + (vals[i - 1] - t) / (vals[i - 1] - vals[i]), dark: dk }); dark = dk; }
  }
  const firstBar = edges.findIndex(e => e.dark);
  if (firstBar < 0) return null;
  const runs = [];
  for (let i = firstBar; i + 1 < edges.length; i++) runs.push(edges[i + 1].x - edges[i].x);
  return runs;
}

export function readBarcode(g, H, geo, ox = 0) {
  const box = geo.barcode;
  const votes = new Map();
  const step = 0.04;
  for (let f = 0.22; f <= 0.66; f += 0.04) {
    const y = box.y + box.h * f;
    const vals = [];
    for (let x = box.x + 0.5; x <= box.x + box.w - 0.5; x += step) {
      const [u, v] = applyH(H, x + ox, y);
      vals.push(sample(g, u, v));
    }
    const runs = profileToRuns(vals);
    if (!runs) continue;
    const txt = decodeRuns(runs);
    if (txt) votes.set(txt, (votes.get(txt) || 0) + 1);
  }
  let best = null, bn = 0;
  votes.forEach((n, t) => { if (n > bn) { bn = n; best = t; } });
  return best;
}

/* ---------- صورة مصححة للعرض (من مليمترات الورقة) ---------- */
export function rectifyToCanvas(gFull, H, ox, wMm, hMm, pxPerMm, canvas) {
  const W = Math.round(wMm * pxPerMm), Hh = Math.round(hMm * pxPerMm);
  canvas.width = W; canvas.height = Hh;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(W, Hh);
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
    const [u, v] = applyH(H, ox + x / pxPerMm, y / pxPerMm);
    const val = sample(gFull, u, v);
    const j = (y * W + x) * 4;
    img.data[j] = img.data[j + 1] = img.data[j + 2] = val; img.data[j + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return ctx;
}
