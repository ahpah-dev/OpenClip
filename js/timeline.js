// OpenClip — zoomable timeline with loudness curve, clip regions and trim handles
(function () {
  const OC = (window.OC = window.OC || {});
  const { clamp } = OC;
  const cv = document.getElementById('timeline');
  const g = cv.getContext('2d');
  const view = { s: 0, e: 1 };
  let dpr = 1, drag = null;
  let cb = { select() {}, change() {}, seek() {} };

  const tl = (OC.timeline = {
    view,
    init(callbacks) { cb = callbacks; },
    whole() { view.s = 0; view.e = OC.state.duration || 1; },
    focus(clip) {
      const d = OC.state.duration;
      if (!clip) return tl.whole();
      const len = clip.end - clip.start;
      const span = Math.min(d, Math.max(len * 3, 12));
      let s = clip.start - (span - len) / 2;
      s = clamp(s, 0, Math.max(0, d - span));
      view.s = s; view.e = s + span;
    },
    draw() {
      const S = OC.state;
      const w = cv.clientWidth, h = cv.clientHeight;
      if (!w || !h) return;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
        dpr = window.devicePixelRatio || 1;
        cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const span = view.e - view.s;
      const X = (t) => ((t - view.s) / span) * w;
      const rulerH = 18;

      // follow the playhead while playing
      const t = OC.video.currentTime;
      if (!OC.video.paused && !drag && (t > view.e || t < view.s)) {
        const sh = clamp(t - span * 0.1, 0, Math.max(0, S.duration - span));
        view.s = sh; view.e = sh + span;
      }

      // ruler
      const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
      const step = steps.find((x) => (x / span) * w >= 70) || 3600;
      g.font = '10px "Geist Mono", monospace';
      g.textBaseline = 'middle';
      g.fillStyle = '#5f5f68';
      g.strokeStyle = '#ffffff12';
      g.lineWidth = 1;
      for (let tt = Math.ceil(view.s / step) * step; tt < view.e; tt += step) {
        const x = Math.round(X(tt)) + 0.5;
        g.beginPath(); g.moveTo(x, rulerH - 4); g.lineTo(x, h); g.stroke();
        g.fillText(OC.fmt(tt, 0), x + 4, 9);
      }

      // loudness
      const act = S.clips.find((c) => c.id === S.activeId);
      const top = rulerH + 4, bh = h - top - 6, mid = top + bh / 2;
      const en = S.energy;
      for (let px = 0; px < w; px++) {
        const tt = view.s + (px / w) * span;
        let e = 0.04;
        if (en) {
          const i0 = Math.floor(tt / S.binSize), i1 = Math.max(i0, Math.floor((view.s + ((px + 1) / w) * span) / S.binSize));
          let m = 0;
          for (let i = i0; i <= i1 && i < en.length; i++) if (en[i] > m) m = en[i];
          e = Math.max(0.03, m);
        }
        const inAct = act && tt >= act.start && tt <= act.end;
        g.fillStyle = inAct ? '#9ec1ff' : '#3a3a42';
        const bar = e * bh;
        g.fillRect(px, mid - bar / 2, 1, bar);
      }

      // clip regions
      for (const c of S.clips) {
        if (c.end < view.s || c.start > view.e) continue;
        const x1 = X(c.start), x2 = X(c.end);
        const on = c.id === S.activeId;
        g.fillStyle = on ? 'rgba(158,193,255,.14)' : 'rgba(255,255,255,.05)';
        g.fillRect(x1, rulerH, x2 - x1, h - rulerH);
        g.strokeStyle = on ? '#9ec1ff' : '#ffffff30';
        g.lineWidth = on ? 1.5 : 1;
        g.strokeRect(x1 + 0.5, rulerH + 0.5, x2 - x1 - 1, h - rulerH - 1);
        g.fillStyle = on ? '#9ec1ff' : '#97979f';
        g.font = '10px "Geist Mono", monospace';
        g.textBaseline = 'alphabetic';
        if (x2 - x1 > 50) g.fillText(c.name, Math.max(x1, 0) + 6, rulerH + 12);
        if (on) {
          g.fillStyle = '#9ec1ff';
          for (const hx of [x1, x2]) {
            OC.roundRect(g, hx - 4, mid - 16, 8, 32, 3);
            g.fill();
          }
        }
      }

      // playhead
      const px = X(t);
      if (px >= 0 && px <= w) {
        g.fillStyle = '#fff';
        g.fillRect(px - 1, 0, 2, h);
        g.beginPath(); g.moveTo(px - 5, 0); g.lineTo(px + 5, 0); g.lineTo(px, 7); g.closePath(); g.fill();
      }
    },
  });

  function timeAt(ev) {
    const r = cv.getBoundingClientRect();
    return clamp(view.s + ((ev.clientX - r.left) / r.width) * (view.e - view.s), 0, OC.state.duration);
  }

  cv.addEventListener('pointerdown', (ev) => {
    const S = OC.state;
    if (!S.loaded) return;
    cv.setPointerCapture(ev.pointerId);
    const r = cv.getBoundingClientRect();
    const span = view.e - view.s;
    const X = (t) => ((t - view.s) / span) * r.width + r.left;
    const act = S.clips.find((c) => c.id === S.activeId);
    if (act) {
      if (Math.abs(ev.clientX - X(act.start)) < 8) { drag = { kind: 'start', clip: act }; return; }
      if (Math.abs(ev.clientX - X(act.end)) < 8) { drag = { kind: 'end', clip: act }; return; }
    }
    const t = timeAt(ev);
    const hit = S.clips.find((c) => t >= c.start && t <= c.end);
    if (hit && hit.id !== S.activeId) { cb.select(hit.id, { focus: false }); }
    drag = { kind: 'scrub' };
    cb.seek(t);
  });

  cv.addEventListener('pointermove', (ev) => {
    const S = OC.state;
    if (!S.loaded) return;
    if (!drag) {
      const r = cv.getBoundingClientRect();
      const span = view.e - view.s;
      const act = S.clips.find((c) => c.id === S.activeId);
      const near = act && [act.start, act.end].some((t) => Math.abs(ev.clientX - (((t - view.s) / span) * r.width + r.left)) < 8);
      cv.style.cursor = near ? 'ew-resize' : 'pointer';
      return;
    }
    const t = timeAt(ev);
    if (drag.kind === 'scrub') return cb.seek(t);
    const c = drag.clip;
    if (drag.kind === 'start') c.start = clamp(t, 0, c.end - 1);
    else c.end = clamp(t, c.start + 1, OC.state.duration);
    c.track = null;
    cb.change(c);
    cb.seek(drag.kind === 'start' ? c.start : c.end);
  });

  const end = () => { drag = null; };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);

  cv.addEventListener('wheel', (ev) => {
    if (!OC.state.loaded) return;
    ev.preventDefault();
    const d = OC.state.duration;
    const span = view.e - view.s;
    if (ev.shiftKey || Math.abs(ev.deltaX) > Math.abs(ev.deltaY)) {
      const dx = (ev.deltaX || ev.deltaY) / cv.clientWidth * span;
      const s = clamp(view.s + dx, 0, Math.max(0, d - span));
      view.s = s; view.e = s + span;
      return;
    }
    const at = timeAt(ev);
    const k = Math.exp(ev.deltaY * 0.0015);
    const ns = clamp(span * k, Math.min(2, d), d);
    const frac = (at - view.s) / span;
    let s = at - frac * ns;
    s = clamp(s, 0, Math.max(0, d - ns));
    view.s = s; view.e = s + ns;
  }, { passive: false });
})();
