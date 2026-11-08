// OpenClip — optional on-device transcription (Whisper via transformers.js, loaded on demand)
(function () {
  const OC = (window.OC = window.OC || {});
  const CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3';
  const cache = {};

  async function getPipeline(model, onStatus) {
    if (cache[model]) return cache[model];
    onStatus('Loading speech engine…', null);
    const tf = await import(CDN);
    try { tf.env.backends.onnx.wasm.proxy = true; } catch (e) { /* optional */ }
    const p = await tf.pipeline('automatic-speech-recognition', model, {
      progress_callback: (d) => {
        if (d && d.status === 'progress' && typeof d.progress === 'number') {
          onStatus('Downloading model… ' + Math.round(d.progress) + '%', d.progress / 100);
        }
      },
    });
    cache[model] = p;
    return p;
  }

  // Returns words [{s,e,t}] with times in seconds relative to the supplied audio.
  OC.transcribe = async function (audio, model, onStatus) {
    const asr = await getPipeline(model, onStatus);
    onStatus('Transcribing… this can take a few minutes', null);
    const opts = { chunk_length_s: 30, stride_length_s: 5 };
    let out;
    try {
      out = await asr(audio, Object.assign({ return_timestamps: 'word' }, opts));
    } catch (err) {
      console.warn('Word timestamps unavailable, falling back to segments', err);
      out = await asr(audio, Object.assign({ return_timestamps: true }, opts));
    }
    const words = [];
    for (const c of out.chunks || []) {
      const ts = c.timestamp || [0, null];
      const s = ts[0] || 0;
      const e = ts[1] == null ? s + 0.4 : ts[1];
      const toks = c.text.trim().split(/\s+/).filter(Boolean);
      if (!toks.length) continue;
      // word-level chunks have 1 token; segment-level chunks are spread by length
      const total = toks.reduce((a, t) => a + t.length + 1, 0);
      let cur = s;
      for (const t of toks) {
        const d = ((t.length + 1) / total) * Math.max(0.1, e - s);
        words.push({ s: cur, e: cur + d, t });
        cur += d;
      }
    }
    return words;
  };
})();
