// OpenClip — shared helpers
(function () {
  const OC = (window.OC = window.OC || {});

  OC.$ = (s, r = document) => r.querySelector(s);
  OC.$$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  OC.clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  OC.uid = () => Math.random().toString(36).slice(2, 9);

  // 83.4 -> "1:23.4"
  OC.fmt = function (t, d) {
    d = d === undefined ? 1 : d;
    if (!isFinite(t) || t < 0) t = 0;
    const k = Math.pow(10, d);
    t = Math.round(t * k) / k;
    const m = Math.floor(t / 60);
    const s = (t - m * 60).toFixed(d);
    return m + ':' + s.padStart(d ? 2 + d + 1 : 2, '0');
  };

  // "1:23.4" | "83.4" | "1:02:03" -> seconds (NaN if invalid)
  OC.parseTime = function (str) {
    const parts = String(str).trim().split(':').map(Number);
    if (!parts.length || parts.some((n) => !isFinite(n) || n < 0)) return NaN;
    return parts.reduce((acc, n) => acc * 60 + n, 0);
  };

  OC.toast = function (msg, kind) {
    const host = OC.$('#toasts');
    if (!host) return;
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.textContent = msg;
    host.appendChild(el);
    setTimeout(() => el.classList.add('out'), kind === 'error' ? 6000 : 3200);
    setTimeout(() => el.remove(), kind === 'error' ? 6400 : 3600);
  };

  OC.download = function (blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 15000);
  };

  OC.safeName = (s) => String(s || 'clip').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'clip';

  OC.debounce = function (fn, ms) {
    let id;
    return function () {
      const args = arguments;
      clearTimeout(id);
      id = setTimeout(() => fn.apply(null, args), ms);
    };
  };
})();
