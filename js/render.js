// OpenClip — frame renderer (preview and export share this)
(function () {
  const OC = (window.OC = window.OC || {});
  const { clamp } = OC;
  const W = 1080, H = 1920;
  OC.W = W; OC.H = H;

  const bg = document.createElement('canvas');
  bg.width = 54; bg.height = 96;
  const bgx = bg.getContext('2d');

  // Horizontal crop centre (0..1) at time t, honouring auto-follow tracking.
  OC.trackX = function (clip, t) {
    const tr = clip && clip.track;
    if (!tr || !tr.length) return clip ? clip.x : 0.5;
    if (t <= tr[0].t) return tr[0].x;
    if (t >= tr[tr.length - 1].t) return tr[tr.length - 1].x;
    let lo = 0, hi = tr.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (tr[mid].t <= t) lo = mid; else hi = mid;
    }
    const a = tr[lo], b = tr[hi];
    return a.x + ((b.x - a.x) * (t - a.t)) / (b.t - a.t);
  };

  function wrapLines(ctx, text, maxW) {
    const words = text.split(/\s+/).filter(Boolean);
    const lines = [];
    let cur = '';
    for (const w of words) {
      const test = cur ? cur + ' ' + w : w;
      if (ctx.measureText(test).width > maxW && cur) { lines.push(cur); cur = w; } else cur = test;
    }
    if (cur) lines.push(cur);
    return lines;
  }

  function drawHook(ctx, clip, t) {
    const h = clip.hook;
    if (!h || !h.on || !h.text.trim()) return;
    const rel = t - clip.start;
    if (rel < 0 || rel > h.dur) return;
    const a = clamp(Math.min(rel / 0.25, (h.dur - rel) / 0.25), 0, 1);
    const size = 58;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.font = '800 ' + size + 'px "Geist", "Segoe UI", sans-serif';
    const lines = wrapLines(ctx, h.text.trim(), W * 0.72);
    const lh = size * 1.18;
    const pw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 64;
    const ph = lines.length * lh + 44;
    const y0 = H * 0.13 - (1 - a) * 18;
    ctx.shadowColor = 'rgba(0,0,0,.35)';
    ctx.shadowBlur = 30;
    ctx.shadowOffsetY = 8;
    ctx.fillStyle = '#fff';
    OC.roundRect(ctx, (W - pw) / 2, y0, pw, ph, 28);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = '#0b0b0d';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    lines.forEach((l, i) => ctx.fillText(l, W / 2, y0 + 22 + (i + 0.5) * lh));
    ctx.restore();
  }

  OC.renderFrame = function (ctx, t, o) {
    const S = OC.state, v = OC.video, clip = o.clip;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    const vw = v.videoWidth, vh = v.videoHeight;
    if (!vw || !vh || v.readyState < 2) return;

    const mode = clip ? clip.mode : 'fill';
    if (mode === 'fit') {
      // blurred cover backdrop (cheap: downscale then upscale) + fitted video
      const k = Math.max(bg.width / vw, bg.height / vh);
      bgx.drawImage(v, (bg.width - vw * k) / 2, (bg.height - vh * k) / 2, vw * k, vh * k);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bg, 0, 0, W, H);
      ctx.fillStyle = 'rgba(0,0,0,.5)';
      ctx.fillRect(0, 0, W, H);
      const fh = (W * vh) / vw;
      ctx.drawImage(v, 0, (H - fh) / 2, W, fh);
    } else {
      const zoom = clip ? clip.zoom : 1;
      let cropH = vh / zoom, cropW = (cropH * 9) / 16;
      if (cropW > vw) { cropW = vw; cropH = (cropW * 16) / 9; }
      const cx = OC.trackX(clip, t) * vw;
      const sx = clamp(cx - cropW / 2, 0, vw - cropW);
      const sy = (vh - cropH) * (clip ? clip.y : 0.5);
      ctx.drawImage(v, sx, sy, cropW, cropH, 0, 0, W, H);
    }

    if (clip) drawHook(ctx, clip, t);

    if (S.cap.on && clip) {
      OC.drawCaptions(ctx, W, H, t, OC.pagesFor(clip), S.cap);
    }

    if (S.overlay.text.trim()) {
      ctx.save();
      ctx.font = '600 38px "Geist", "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(0,0,0,.7)';
      ctx.shadowBlur = 14;
      ctx.fillStyle = 'rgba(255,255,255,.92)';
      ctx.fillText(S.overlay.text.trim(), W / 2, S.overlay.pos === 'top' ? H * 0.055 : H * 0.93);
      ctx.restore();
    }

    if (S.progress && clip) {
      const p = clamp((t - clip.start) / Math.max(0.1, clip.end - clip.start), 0, 1);
      ctx.fillStyle = 'rgba(255,255,255,.22)';
      ctx.fillRect(0, H - 12, W, 12);
      ctx.fillStyle = S.cap.accent || '#fff';
      ctx.fillRect(0, H - 12, W * p, 12);
    }

    if (o.guides) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,.55)';
      ctx.setLineDash([14, 12]);
      ctx.lineWidth = 3;
      ctx.strokeRect(60, 140, W - 120 - 130, H - 140 - 420);
      ctx.fillStyle = 'rgba(255,255,255,.7)';
      ctx.font = '500 26px "Geist Mono", monospace';
      ctx.fillText('safe area', 76, 176);
      ctx.restore();
    }
  };

  // Detect motion centroid across a clip so the crop can follow activity.
  OC.autoFollow = async function (clip, onProgress, shouldCancel) {
    const v = OC.video;
    const vw = v.videoWidth, vh = v.videoHeight;
    const cw = 96, ch = Math.max(8, Math.round((96 * vh) / vw));
    const c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    const x = c.getContext('2d', { willReadFrequently: true });
    const step = 0.25;
    const raw = [];
    let prev = null, last = 0.5;
    const total = Math.max(1, Math.floor((clip.end - clip.start) / step));
    for (let i = 0; i <= total; i++) {
      if (shouldCancel && shouldCancel()) return null;
      const t = Math.min(clip.end, clip.start + i * step);
      await OC.seek(t);
      x.drawImage(v, 0, 0, cw, ch);
      const d = x.getImageData(0, 0, cw, ch).data;
      const g = new Float32Array(cw * ch);
      for (let p = 0; p < g.length; p++) g[p] = d[p * 4] * 0.3 + d[p * 4 + 1] * 0.59 + d[p * 4 + 2] * 0.11;
      let cx = last;
      if (prev) {
        let sum = 0, acc = 0;
        for (let yy = 0; yy < ch; yy++) {
          for (let xx = 0; xx < cw; xx++) {
            const diff = Math.abs(g[yy * cw + xx] - prev[yy * cw + xx]);
            if (diff > 18) { sum += diff; acc += diff * xx; }
          }
        }
        if (sum > 600) cx = acc / sum / (cw - 1);
      }
      raw.push({ t, x: cx });
      last = cx;
      prev = g;
      if (onProgress) onProgress(i / total);
    }
    // median filter then exponential smoothing for a calm camera
    const med = raw.map((p, i) => {
      const win = raw.slice(Math.max(0, i - 2), i + 3).map((q) => q.x).sort((a, b) => a - b);
      return { t: p.t, x: win[win.length >> 1] };
    });
    let s = med[0].x;
    return med.map((p) => { s += (p.x - s) * 0.25; return { t: p.t, x: s }; });
  };
})();
