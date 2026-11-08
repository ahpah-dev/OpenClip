// OpenClip — caption styles, paging and canvas drawing
(function () {
  const OC = (window.OC = window.OC || {});
  const { clamp } = OC;

  const SANS = '"Geist", "Segoe UI", system-ui, sans-serif';
  const COND = '"Anton", Impact, "Arial Black", sans-serif';
  const MONO = '"Geist Mono", Consolas, monospace';

  // hl: how the active word is emphasised
  OC.CAP_STYLES = [
    { id: 'pop', name: 'Bold Pop', note: 'default', font: COND, weight: 400, color: '#fff', stroke: '#000', strokeW: 0.17, hl: 'color', pop: true, upper: true, shadow: 'rgba(0,0,0,.45)' },
    { id: 'karaoke', name: 'Karaoke', note: 'fills in', font: SANS, weight: 800, color: '#fff', stroke: '#000', strokeW: 0.14, hl: 'progress', upper: true, shadow: 'rgba(0,0,0,.4)' },
    { id: 'minimal', name: 'Minimal', note: 'quiet', font: SANS, weight: 600, color: '#fff', hl: 'dim', upper: false, shadow: 'rgba(0,0,0,.7)', blur: 0.18 },
    { id: 'boxed', name: 'Boxed', note: 'plate', font: SANS, weight: 800, color: '#fff', hl: 'color', plate: 'rgba(0,0,0,.72)', upper: false },
    { id: 'neon', name: 'Neon', note: 'glow', font: SANS, weight: 800, color: '#fff', hl: 'color', glow: '#22d3ee', upper: true },
    { id: 'marker', name: 'Marker', note: 'highlighter', font: SANS, weight: 900, color: '#fff', stroke: '#000', strokeW: 0.14, hl: 'marker', upper: true },
    { id: 'outline', name: 'Outline', note: 'hollow', font: COND, weight: 400, color: '#fff', stroke: '#fff', strokeW: 0.045, hl: 'fill', upper: true },
    { id: 'type', name: 'Typewriter', note: 'types in', font: MONO, weight: 600, color: '#fff', hl: 'reveal', plate: 'rgba(0,0,0,.78)', upper: false },
  ];

  OC.styleById = (id) => OC.CAP_STYLES.find((s) => s.id === id) || OC.CAP_STYLES[0];

  // Group words that fall inside [start,end] into on-screen pages.
  OC.buildPages = function (words, start, end, perPage) {
    const ws = words.filter((w) => w.e > start && w.s < end);
    const pages = [];
    let cur = [];
    const flush = () => {
      if (cur.length) pages.push({ s: cur[0].s, e: cur[cur.length - 1].e, words: cur });
      cur = [];
    };
    for (const w of ws) {
      if (cur.length && w.s - cur[cur.length - 1].e > 0.7) flush();
      cur.push(w);
      if (cur.length >= perPage || /[.!?]$/.test(w.t)) flush();
    }
    flush();
    for (let i = 0; i < pages.length; i++) {
      const next = pages[i + 1];
      pages[i].e = Math.min(next ? next.s : Infinity, pages[i].e + 0.35);
    }
    return pages;
  };

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  OC.roundRect = roundRect;

  OC.drawCaptions = function (ctx, W, H, t, pages, cap) {
    const st = OC.styleById(cap.style);
    const page = pages.find((p) => t >= p.s && t < p.e);
    if (!page) return;
    const size = cap.size;
    const accent = cap.accent || '#ffd84d';

    ctx.save();
    ctx.font = st.weight + ' ' + size + 'px ' + st.font;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;

    const items = page.words.map((w) => {
      const text = cap.upper ? w.t.toUpperCase() : w.t;
      return { w, text, width: ctx.measureText(text).width };
    });
    const space = size * 0.3;
    const maxW = W * 0.86;
    const lines = [];
    let line = { items: [], w: 0 };
    for (const it of items) {
      const need = line.items.length ? line.w + space + it.width : it.width;
      if (need > maxW && line.items.length) {
        lines.push(line);
        line = { items: [], w: 0 };
      }
      line.w = line.items.length ? line.w + space + it.width : it.width;
      line.items.push(it);
    }
    lines.push(line);

    const lineH = size * 1.22;
    const blockH = lines.length * lineH;
    const top = cap.y * H - blockH / 2;

    // index of the word being spoken (last word that has started)
    let active = -1;
    page.words.forEach((w, i) => { if (t >= w.s) active = i; });

    ctx.globalAlpha = clamp((t - page.s) / 0.08, 0, 1);

    if (st.plate) {
      const pw = Math.max(...lines.map((l) => l.w)) + size * 0.7;
      const ph = blockH + size * 0.3;
      ctx.fillStyle = st.plate;
      roundRect(ctx, (W - pw) / 2, top - size * 0.15, pw, ph, size * 0.3);
      ctx.fill();
    }

    let idx = 0;
    lines.forEach((ln, li) => {
      let x = (W - ln.w) / 2;
      const y = top + (li + 0.5) * lineH;
      for (const it of ln.items) {
        const i = idx++;
        const isActive = i === active;
        const spoken = i <= active;
        let fill = st.color;
        let alpha = 1;
        let markerOn = false;

        switch (st.hl) {
          case 'color': if (isActive) fill = accent; break;
          case 'progress': if (spoken) fill = accent; break;
          case 'dim': alpha = isActive ? 1 : 0.55; break;
          case 'marker': if (isActive) { markerOn = true; fill = '#111'; } break;
          case 'fill': fill = isActive ? st.color : null; break;
          case 'reveal': if (!spoken) { x += it.width + space; continue; } break;
        }

        let scale = 1;
        if (st.pop && isActive) scale = 1 + 0.2 * Math.sin(clamp((t - it.w.s) / 0.14, 0, 1) * Math.PI) + 0.06;
        const cx = x + it.width / 2;

        ctx.save();
        if (scale !== 1) { ctx.translate(cx, y); ctx.scale(scale, scale); ctx.translate(-cx, -y); }

        if (markerOn) {
          ctx.fillStyle = accent;
          roundRect(ctx, x - size * 0.16, y - size * 0.58, it.width + size * 0.32, size * 1.16, size * 0.2);
          ctx.fill();
        }

        ctx.globalAlpha *= alpha;
        const outlineOnly = st.hl === 'fill';
        const strokeCol = markerOn ? null : st.stroke;
        if (strokeCol) {
          ctx.lineWidth = size * st.strokeW;
          ctx.strokeStyle = strokeCol;
          if (st.shadow && !outlineOnly) { ctx.shadowColor = st.shadow; ctx.shadowBlur = size * 0.12; ctx.shadowOffsetY = size * 0.05; }
          ctx.strokeText(it.text, x, y);
          ctx.shadowColor = 'transparent';
        }
        if (fill) {
          if (st.glow) {
            ctx.shadowColor = isActive ? accent : st.glow;
            ctx.shadowBlur = size * 0.55;
          } else if (st.shadow && !strokeCol) {
            ctx.shadowColor = st.shadow;
            ctx.shadowBlur = size * (st.blur || 0.1);
            ctx.shadowOffsetY = size * 0.04;
          }
          ctx.fillStyle = fill;
          ctx.fillText(it.text, x, y);
          if (st.glow) ctx.fillText(it.text, x, y);
        }
        ctx.restore();
        x += it.width + space;
      }
    });
    ctx.restore();
  };
})();
