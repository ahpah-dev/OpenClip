// OpenClip — audio analysis, highlight detection, transcript parsing
(function () {
  const OC = (window.OC = window.OC || {});
  const { clamp } = OC;

  // Decode the audio track at a low sample rate and compute a normalised loudness curve.
  OC.analyzeAudio = async function (file) {
    const buf = await file.arrayBuffer();
    const ctx = new OfflineAudioContext(1, 1, 8000);
    const audio = await ctx.decodeAudioData(buf);
    const binSize = 0.25;
    const per = Math.max(1, Math.round(audio.sampleRate * binSize));
    const n = Math.ceil(audio.length / per);
    const chans = [];
    for (let c = 0; c < audio.numberOfChannels; c++) chans.push(audio.getChannelData(c));
    const rms = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = i * per, b = Math.min(audio.length, a + per);
      let sum = 0;
      for (const ch of chans) for (let j = a; j < b; j++) sum += ch[j] * ch[j];
      rms[i] = Math.sqrt(sum / Math.max(1, (b - a) * chans.length));
    }
    const sorted = Float32Array.from(rms).sort();
    const p95 = sorted[Math.floor(sorted.length * 0.95)] || 1e-6;
    const energy = new Float32Array(n);
    for (let i = 0; i < n; i++) energy[i] = Math.pow(clamp(rms[i] / p95, 0, 1), 0.8);
    return { energy, binSize, duration: audio.duration };
  };

  // Pick the liveliest non-overlapping windows of `len` seconds.
  OC.detectHighlights = function (energy, binSize, duration, opts) {
    const len = opts.len, count = opts.count;
    const n = energy ? energy.length : 0;
    if (duration <= len * 1.15) {
      return [{ start: 0, end: duration, score: 100 }];
    }
    if (!n) {
      // no audio analysis available: space clips evenly
      const k = Math.max(1, Math.min(count, Math.floor(duration / len)));
      const gap = (duration - k * len) / (k + 1);
      return Array.from({ length: k }, (_, i) => ({ start: gap * (i + 1) + len * i, end: gap * (i + 1) + len * (i + 1), score: 50 }));
    }
    const w = Math.round(len / binSize);
    const P1 = new Float64Array(n + 1), P2 = new Float64Array(n + 1), P3 = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) {
      P1[i + 1] = P1[i] + energy[i];
      P2[i + 1] = P2[i] + energy[i] * energy[i];
      P3[i + 1] = P3[i] + (energy[i] < 0.12 ? 1 : 0);
    }
    const cands = [];
    for (let i = 0; i + w <= n; i += 4) {
      const mean = (P1[i + w] - P1[i]) / w;
      const v = (P2[i + w] - P2[i]) / w - mean * mean;
      const sd = Math.sqrt(Math.max(0, v));
      const silent = (P3[i + w] - P3[i]) / w;
      cands.push({ i, sc: mean + 0.9 * sd - 0.6 * silent });
    }
    cands.sort((a, b) => b.sc - a.sc);
    const picks = [];
    for (const c of cands) {
      if (picks.length >= count) break;
      if (picks.some((p) => Math.abs(p.i - c.i) < w * 0.95)) continue;
      picks.push(c);
    }
    const best = picks[0] ? Math.max(picks[0].sc, 1e-6) : 1;
    // Snap edges to the quietest nearby moment so cuts land between phrases.
    const snap = function (t) {
      const centre = Math.round(t / binSize), r = Math.round(1.5 / binSize);
      let bi = clamp(centre, 0, n - 1), bv = Infinity;
      for (let k = Math.max(0, centre - r); k <= Math.min(n - 1, centre + r); k++) {
        const v = (energy[k - 1] || energy[k]) * 0.25 + energy[k] * 0.5 + (energy[k + 1] || energy[k]) * 0.25;
        if (v < bv) { bv = v; bi = k; }
      }
      return bi * binSize;
    };
    return picks
      .map((p) => {
        let s = snap(p.i * binSize), e = snap((p.i + w) * binSize);
        if (e - s < 5) { s = p.i * binSize; e = s + len; }
        return { start: clamp(s, 0, duration), end: clamp(e, 0, duration), score: Math.max(1, Math.round((100 * p.sc) / best)) };
      })
      .sort((a, b) => a.start - b.start);
  };

  // Decode to 16 kHz mono for speech recognition.
  OC.decodeMono16k = async function (file) {
    const buf = await file.arrayBuffer();
    const ctx = new OfflineAudioContext(1, 1, 16000);
    const audio = await ctx.decodeAudioData(buf);
    const out = new Float32Array(audio.length);
    const nch = audio.numberOfChannels;
    for (let c = 0; c < nch; c++) {
      const d = audio.getChannelData(c);
      for (let i = 0; i < out.length; i++) out[i] += d[i] / nch;
    }
    return out;
  };

  // SRT / VTT -> word list [{s,e,t}] (word times spread across each cue by length).
  OC.parseSubtitles = function (text) {
    const lines = text.replace(/\r/g, '').split('\n');
    const timeRe = /((?:\d+:)?\d+:\d+[.,]\d+)\s*-->\s*((?:\d+:)?\d+:\d+[.,]\d+)/;
    const toSec = (s) => OC.parseTime(s.replace(',', '.'));
    const words = [];
    for (let i = 0; i < lines.length; i++) {
      const m = timeRe.exec(lines[i]);
      if (!m) continue;
      const s = toSec(m[1]), e = toSec(m[2]);
      const buf = [];
      i++;
      while (i < lines.length && lines[i].trim() !== '') buf.push(lines[i++]);
      const toks = buf.join(' ').replace(/<[^>]+>/g, '').replace(/\{[^}]+\}/g, '').split(/\s+/).filter(Boolean);
      if (!toks.length || !isFinite(s) || !isFinite(e) || e <= s) continue;
      const total = toks.reduce((a, t) => a + t.length + 1, 0);
      let cur = s;
      for (const t of toks) {
        const d = ((t.length + 1) / total) * (e - s);
        words.push({ s: cur, e: cur + d, t });
        cur += d;
      }
    }
    return words;
  };

  // Build SRT for a clip (times relative to clip start).
  OC.buildSRT = function (clip, pages) {
    const ts = (t) => {
      t = Math.max(0, t);
      const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60);
      const ms = Math.round((t - Math.floor(t)) * 1000);
      const p = (n, l) => String(n).padStart(l, '0');
      return p(h, 2) + ':' + p(m, 2) + ':' + p(s, 2) + ',' + p(Math.min(ms, 999), 3);
    };
    return pages
      .map((p, i) => {
        const s = Math.max(p.s, clip.start) - clip.start, e = Math.min(p.e, clip.end) - clip.start;
        return (i + 1) + '\n' + ts(s) + ' --> ' + ts(e) + '\n' + p.words.map((w) => w.t).join(' ') + '\n';
      })
      .join('\n');
  };
})();
