/* ================= تحميل مكتبات خارجية عند الحاجة فقط =================
 * بدل ما نحمّل xlsx و pdf.js بكل صفحة (حتى لو المستخدم ما بيستخدم الاستيراد/التصدير
 * أو رفع ملفات PDF)، نحمّلهم فقط أول مرة تنفتح فيها وظيفة تحتاجهم فعليًا.
 * الوعد يُخزَّن (cache) عشان لو انطلبت المكتبة أكثر من مرة ما تنزل أكثر من مرة.
 */

const loadedScripts = {};

function loadScript(src) {
  if (loadedScripts[src]) return loadedScripts[src];
  loadedScripts[src] = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('تعذر تحميل المكتبة، تأكد من الاتصال بالإنترنت وجرّب مرة ثانية.'));
    document.head.appendChild(s);
  });
  return loadedScripts[src];
}

export function loadXLSX() {
  if (window.XLSX) return Promise.resolve();
  return loadScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
}

export function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve();
  return loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js');
}
