// OpenClip — editor application
(function () {
  const OC = (window.OC = window.OC || {});
  const { $, $$, clamp, fmt } = OC;

  const video = (OC.video = $('#srcVideo'));
  const music = $('#music');
  const canvas = $('#preview');
  const ctx = canvas.getContext('2d');

  const S = (OC.state = {
    loaded: false, file: null, name: '', duration: 0, energy: null, binSize: 0.25,
    words: [], wordsRev: 0, clips: [], activeId: null,
    cap: { on: true, style: 'pop', size: 78, y: 0.7, perPage: 3, upper: true, accent: '#ffd84d' },
    overlay: { text: '', pos: 'top' }, progress: true, origVol: 1, musicVol: 0.25, musicName: '',
    guides: false, exporting: false,
  });

  const activeClip = () => S.clips.find((c) => c.id === S.activeId) || null;

  OC.pagesFor = function (clip) {
    const key = S.wordsRev + '|' + clip.start + '|' + clip.end + '|' + S.cap.perPage;
    if (clip._pk !== key) { clip._pg = OC.buildPages(S.words, clip.start, clip.end, S.cap.perPage); clip._pk = key; }
    return clip._pg;
  };

  OC.seek = function (t) {
    return new Promise((res) => {
      if (Math.abs(video.currentTime - t) < 0.001) return res();
      const done = () => { video.removeEventListener('seeked', done); res(); };
      video.addEventListener('seeked', done);
      video.currentTime = t;
      setTimeout(done, 2500);
    });
  };

  /* ---------- fonts ---------- */
  const fontsReady = Promise.all([
    '64px Anton', '800 64px Geist', '600 64px Geist', '900 64px Geist', '600 64px "Geist Mono"',
  ].map((f) => document.fonts.load(f).catch(() => {}))).then(() => buildTiles());

  /* ---------- overlay helpers ---------- */
  let cancelFlag = false;
  function busy(title, text, p, cancellable) {
    $('#busy').hidden = false;
    $('#busyTitle').textContent = title;
    $('#busyText').textContent = text || '';
    const wrap = $('#busyBarWrap');
    wrap.hidden = p == null;
    $('#busyBar').style.width = (clamp(p || 0, 0, 1) * 100) + '%';
    $('#busyCancel').hidden = !cancellable;
  }
  const unbusy = () => { $('#busy').hidden = true; };
  $('#busyCancel').addEventListener('click', () => { cancelFlag = true; });

  /* ---------- audio graph ---------- */
  let A = null;
  function ensureAudio() {
    if (A) return A;
    const AC = window.AudioContext || window.webkitAudioContext;
    const ac = new AC();
    const vsrc = ac.createMediaElementSource(video);
    const msrc = ac.createMediaElementSource(music);
    const vGain = ac.createGain(), mGain = ac.createGain(), monitor = ac.createGain();
    const dest = ac.createMediaStreamDestination();
    vsrc.connect(vGain); msrc.connect(mGain);
    vGain.connect(dest); mGain.connect(dest);
    vGain.connect(monitor); mGain.connect(monitor);
    monitor.connect(ac.destination);
    A = { ac, vGain, mGain, monitor, dest };
    applyVolumes();
    return A;
  }
  function applyVolumes() {
    if (!A) return;
    A.vGain.gain.value = S.origVol;
    A.mGain.gain.value = S.musicVol;
  }

  /* ---------- persistence ---------- */
  let projKey = null;
  const save = OC.debounce(function () {
    if (!projKey) return;
    try {
      const data = {
        clips: S.clips.map((c) => { const o = Object.assign({}, c); delete o._pk; delete o._pg; return o; }),
        words: S.words, cap: S.cap, overlay: S.overlay, progress: S.progress,
        origVol: S.origVol, musicVol: S.musicVol, activeId: S.activeId,
      };
      localStorage.setItem(projKey, JSON.stringify(data));
    } catch (e) { /* storage full or unavailable */ }
  }, 500);
  const touch = () => save();

  /* ---------- loading ---------- */
  async function loadFile(file) {
    if (!file) return;
    if (!(file.type.startsWith('video/') || /\.(mp4|mov|webm|mkv|m4v)$/i.test(file.name))) {
      return OC.toast('That does not look like a video file.', 'error');
    }
    if (S.exporting) return;
    pause();
    if (video.src) URL.revokeObjectURL(video.src);
    busy('Opening video…', file.name);
    video.src = URL.createObjectURL(file);
    const ok = await new Promise((res) => {
      const t = setTimeout(() => res(false), 15000);
      video.onloadedmetadata = () => { clearTimeout(t); res(true); };
      video.onerror = () => { clearTimeout(t); res(false); };
    });
    video.onerror = null;
    if (!ok || !video.videoWidth) {
      unbusy();
      video.removeAttribute('src');
      return OC.toast("This browser can't read that video's picture. Try an H.264 MP4 or a WebM.", 'error');
    }
    Object.assign(S, {
      loaded: true, file, name: file.name, duration: video.duration, energy: null,
      words: [], wordsRev: 0, clips: [], activeId: null,
    });
    projKey = 'openclip:v1:' + file.name + '|' + file.size + '|' + file.lastModified;
    $('#projName').textContent = file.name + '  ·  ' + video.videoWidth + '×' + video.videoHeight + '  ·  ' + fmt(S.duration, 0);
    $('#empty').hidden = true;
    $('#editor').hidden = false;
    $('#btnExportTop').disabled = false;
    ensureAudio();

    // audio analysis (loudness curve)
    busy('Listening to the audio…', 'Finding the lively moments', null);
    try {
      const r = await OC.analyzeAudio(file);
      S.energy = r.energy; S.binSize = r.binSize;
    } catch (e) {
      console.warn('Audio analysis failed', e);
      OC.toast('Could not analyse the audio, so highlight suggestions are unavailable. Manual clips still work.', 'error');
    }

    // restore saved project, or suggest highlights
    let restored = false;
    try {
      const raw = localStorage.getItem(projKey);
      if (raw) {
        const d = JSON.parse(raw);
        S.clips = d.clips || [];
        S.words = d.words || [];
        Object.assign(S.cap, d.cap || {});
        Object.assign(S.overlay, d.overlay || {});
        if (d.progress !== undefined) S.progress = d.progress;
        if (d.origVol !== undefined) S.origVol = d.origVol;
        if (d.musicVol !== undefined) S.musicVol = d.musicVol;
        S.activeId = S.clips.some((c) => c.id === d.activeId) ? d.activeId : (S.clips[0] && S.clips[0].id);
        restored = S.clips.length > 0;
      }
    } catch (e) { /* ignore corrupt data */ }
    if (!restored) { detect(); }
    S.wordsRev++;
    unbusy();
    syncAll();
    OC.timeline.whole();
    if (S.activeId) selectClip(S.activeId, { focus: true });
    else video.currentTime = 0;
    if (restored) OC.toast('Restored your saved project.');
  }
  OC.loadFile = loadFile;

  /* ---------- clips ---------- */
  function makeClip(start, end, score, name) {
    return {
      id: OC.uid(), name: name, start: start, end: end, score: score, include: true, auto: score != null,
      mode: 'fill', zoom: 1, x: 0.5, y: 0.5, track: null,
      hook: { on: false, text: '', dur: 2.5 },
    };
  }

  function detect() {
    const len = +$('#detLen').value, count = +$('#detCount').value;
    const found = OC.detectHighlights(S.energy, S.binSize, S.duration, { len, count });
    const manual = S.clips.filter((c) => !c.auto);
    const n = found.length;
    const auto = found.map((f, i) => makeClip(f.start, f.end, f.score, n > 1 || S.clips.length ? 'Highlight ' + (i + 1) : 'Full video'));
    S.clips = auto.concat(manual).sort((a, b) => a.start - b.start);
    S.activeId = S.clips[0] ? S.clips[0].id : null;
  }

  function selectClip(id, opts) {
    opts = opts || {};
    S.activeId = id;
    const c = activeClip();
    if (c) {
      if (opts.focus !== false) OC.timeline.focus(c);
      if (opts.seek !== false) { pause(); video.currentTime = c.start; }
    }
    renderClips();
    syncInspector();
    renderTranscript();
    touch();
  }

  function renderClips() {
    const list = $('#clipList');
    list.innerHTML = '';
    if (!S.clips.length) {
      list.innerHTML = '<div class="empty-note">No clips yet. Suggest highlights, or add a clip at the playhead.</div>';
    }
    for (const c of S.clips) {
      const el = document.createElement('div');
      el.className = 'clip' + (c.id === S.activeId ? ' on' : '');
      el.dataset.id = c.id;
      el.innerHTML =
        '<div class="top"><input type="checkbox" title="Include when exporting all"><span class="nm"></span>' +
        (c.score != null ? '<span class="sc">' + c.score + '</span>' : '') + '</div>' +
        '<p class="meta"></p><canvas width="260" height="44"></canvas>';
      el.querySelector('.nm').textContent = c.name;
      const chk = el.querySelector('input');
      chk.checked = c.include;
      chk.addEventListener('click', (e) => e.stopPropagation());
      chk.addEventListener('change', () => { c.include = chk.checked; updateCount(); touch(); });
      el.addEventListener('click', () => selectClip(c.id, { focus: true }));
      list.appendChild(el);
      drawSpark(el.querySelector('canvas'), c);
    }
    refreshClipMeta();
    updateCount();
  }
  function refreshClipMeta() {
    for (const c of S.clips) {
      const el = $('.clip[data-id="' + c.id + '"]');
      if (!el) continue;
      el.querySelector('.meta').textContent = fmt(c.start) + ' – ' + fmt(c.end) + ' · ' + fmt(c.end - c.start, 1);
      el.querySelector('.nm').textContent = c.name;
    }
  }
  function updateCount() {
    const n = S.clips.filter((c) => c.include).length;
    $('#clipCount').textContent = S.clips.length ? n + ' of ' + S.clips.length + ' included' : '';
  }
  function drawSpark(cv, c) {
    const g = cv.getContext('2d');
    g.clearRect(0, 0, cv.width, cv.height);
    if (!S.energy) return;
    const n = 65, dur = c.end - c.start;
    g.fillStyle = '#9ec1ff';
    for (let i = 0; i < n; i++) {
      const t0 = c.start + (i / n) * dur, t1 = c.start + ((i + 1) / n) * dur;
      let m = 0.03;
      for (let k = Math.floor(t0 / S.binSize); k <= Math.floor(t1 / S.binSize); k++) m = Math.max(m, S.energy[k] || 0);
      const h = Math.max(2, m * cv.height);
      g.globalAlpha = 0.85;
      g.fillRect(i * 4, (cv.height - h) / 2, 3, h);
    }
  }

  /* ---------- inspector ---------- */
  const refreshers = [];
  function bindRange(id, vId, get, set, f, clipOnly) {
    const el = $('#' + id), lab = vId ? $('#' + vId) : null;
    el.addEventListener('input', () => {
      const v = parseFloat(el.value);
      if (clipOnly && !activeClip()) return;
      set(v);
      if (lab) lab.textContent = f(v);
      touch();
    });
    refreshers.push(() => {
      const c = activeClip();
      el.disabled = !!clipOnly && !c;
      if (clipOnly && !c) return;
      const v = get(c);
      el.value = v;
      if (lab) lab.textContent = f(v);
    });
  }
  function bindCheck(id, get, set, clipOnly) {
    const el = $('#' + id);
    el.addEventListener('change', () => { if (clipOnly && !activeClip()) return; set(el.checked); touch(); });
    refreshers.push(() => { const c = activeClip(); el.disabled = !!clipOnly && !c; if (!(clipOnly && !c)) el.checked = !!get(c); });
  }
  function bindText(id, get, set, clipOnly) {
    const el = $('#' + id);
    el.addEventListener('input', () => { if (clipOnly && !activeClip()) return; set(el.value); touch(); });
    refreshers.push(() => { const c = activeClip(); el.disabled = !!clipOnly && !c; if (!(clipOnly && !c)) el.value = get(c); });
  }

  // clip tab
  bindText('clipName', (c) => c.name, (v) => { activeClip().name = v; refreshClipMeta(); }, true);
  bindCheck('hookOn', (c) => c.hook.on, (v) => { activeClip().hook.on = v; }, true);
  bindText('hookText', (c) => c.hook.text, (v) => { activeClip().hook.text = v; }, true);
  bindRange('hookDur', 'hookDurV', (c) => c.hook.dur, (v) => { activeClip().hook.dur = v; }, (v) => v + ' s', true);
  for (const [id, key] of [['clipStart', 'start'], ['clipEnd', 'end']]) {
    const el = $('#' + id);
    el.addEventListener('change', () => {
      const c = activeClip(); if (!c) return;
      const t = OC.parseTime(el.value);
      if (!isFinite(t)) return syncInspector();
      if (key === 'start') c.start = clamp(t, 0, c.end - 1); else c.end = clamp(t, c.start + 1, S.duration);
      c.track = null;
      afterClipTimeChange(c);
    });
    refreshers.push(() => { const c = activeClip(); el.disabled = !c; if (c) el.value = fmt(c[key]); });
  }
  refreshers.push(() => {
    const c = activeClip();
    $('#clipLen').textContent = c ? 'Length ' + fmt(c.end - c.start) + (c.end - c.start > 180 ? ' · long for a short clip' : '') : 'Select or create a clip.';
    $('#btnSetIn').disabled = $('#btnSetOut').disabled = $('#btnDelClip').disabled = !c;
  });
  function afterClipTimeChange(c) {
    c._pk = null;
    refreshClipMeta();
    const el = $('.clip[data-id="' + c.id + '"] canvas');
    if (el) drawSpark(el, c);
    syncInspector();
    touch();
  }
  function setIn() {
    const c = activeClip(); if (!c) return;
    c.start = clamp(video.currentTime, 0, c.end - 1); c.track = null; afterClipTimeChange(c);
  }
  function setOut() {
    const c = activeClip(); if (!c) return;
    c.end = clamp(video.currentTime, c.start + 1, S.duration); c.track = null; afterClipTimeChange(c);
  }
  $('#btnSetIn').addEventListener('click', setIn);
  $('#btnSetOut').addEventListener('click', setOut);
  $('#btnDelClip').addEventListener('click', () => {
    const c = activeClip(); if (!c) return;
    const i = S.clips.indexOf(c);
    S.clips.splice(i, 1);
    const next = S.clips[Math.min(i, S.clips.length - 1)];
    S.activeId = next ? next.id : null;
    renderClips(); syncInspector(); renderTranscript(); touch();
  });

  // frame tab
  $$('#modeSeg button').forEach((b) => b.addEventListener('click', () => {
    const c = activeClip(); if (!c) return;
    c.mode = b.dataset.mode; syncInspector(); touch();
  }));
  refreshers.push(() => {
    const c = activeClip();
    $$('#modeSeg button').forEach((b) => { b.classList.toggle('on', !!c && b.dataset.mode === c.mode); b.disabled = !c; });
    const fit = !!c && c.mode === 'fit';
    $('#zoom').disabled = fit || !c;
    $('#posY').disabled = fit || !c;
    $('#posX').disabled = fit || !c || !!c.track;
    $('#btnFollow').disabled = fit || !c;
    $('#btnClearFollow').disabled = !c || !c.track;
    $('#followNote').textContent = c && c.track ? 'Auto-follow is active for this clip. Clear it to set the position by hand.' : 'Follows movement across the shot. For a steady talking head, set the horizontal position by hand.';
  });
  const pct = (v) => Math.round(v * 100) + '%';
  bindRange('zoom', 'zoomV', (c) => c.zoom, (v) => { activeClip().zoom = v; }, (v) => v.toFixed(2) + '×', true);
  bindRange('posX', 'xV', (c) => c.x, (v) => { activeClip().x = v; }, pct, true);
  bindRange('posY', 'yV', (c) => c.y, (v) => { activeClip().y = v; }, pct, true);
  $('#btnClearFollow').addEventListener('click', () => { const c = activeClip(); if (c) { c.track = null; syncInspector(); touch(); } });
  $('#btnFollow').addEventListener('click', async () => {
    const c = activeClip(); if (!c) return;
    pause();
    cancelFlag = false;
    busy('Tracking motion…', c.name, 0, true);
    const track = await OC.autoFollow(c, (p) => busy('Tracking motion…', c.name, p, true), () => cancelFlag);
    unbusy();
    await OC.seek(c.start);
    if (track) { c.track = track; OC.toast('Auto-follow applied.'); } else OC.toast('Tracking cancelled.');
    syncInspector(); touch();
  });

  // caption tab
  bindCheck('capOn', () => S.cap.on, (v) => { S.cap.on = v; });
  bindRange('capSize', 'capSizeV', () => S.cap.size, (v) => { S.cap.size = v; buildTiles(); }, (v) => Math.round(v) + ' px');
  bindRange('capY', 'capYV', () => S.cap.y, (v) => { S.cap.y = v; }, pct);
  bindRange('capPer', 'capPerV', () => S.cap.perPage, (v) => { S.cap.perPage = v; renderTranscript(); }, (v) => String(v));
  bindCheck('capUpper', () => S.cap.upper, (v) => { S.cap.upper = v; buildTiles(); });
  const accentEl = $('#capAccent');
  accentEl.addEventListener('input', () => { S.cap.accent = accentEl.value; buildTiles(); touch(); });
  refreshers.push(() => { accentEl.value = S.cap.accent; });

  function buildTiles() {
    const grid = $('#styleGrid');
    if (!grid.children.length) {
      for (const st of OC.CAP_STYLES) {
        const b = document.createElement('button');
        b.className = 'style-btn';
        b.dataset.id = st.id;
        b.innerHTML = '<canvas width="320" height="112"></canvas><span>' + st.name + '<small>' + st.note + '</small></span>';
        b.addEventListener('click', () => {
          S.cap.style = st.id; S.cap.upper = st.upper;
          $('#capUpper').checked = st.upper;
          buildTiles(); touch();
        });
        grid.appendChild(b);
      }
    }
    const demo = [{ s: 0, e: 0.5, t: 'Open' }, { s: 0.5, e: 1, t: 'clip' }, { s: 1, e: 2, t: 'fast' }];
    const pages = [{ s: 0, e: 10, words: demo }];
    for (const b of $$('.style-btn', grid)) {
      b.classList.toggle('on', b.dataset.id === S.cap.style);
      const cv = $('canvas', b), g = cv.getContext('2d');
      const k = cv.width / 1080;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, cv.width, cv.height);
      g.scale(k, k);
      const own = OC.styleById(b.dataset.id);
      const cap = Object.assign({}, S.cap, { style: own.id, size: 92, y: 0.5, upper: own.id === S.cap.style ? S.cap.upper : own.upper });
      OC.drawCaptions(g, 1080, cv.height / k, 0.7, pages, cap);
    }
  }

  // media tab
  bindText('ovText', () => S.overlay.text, (v) => { S.overlay.text = v; });
  $$('#ovPos button').forEach((b) => b.addEventListener('click', () => { S.overlay.pos = b.dataset.pos; syncAll(); touch(); }));
  refreshers.push(() => $$('#ovPos button').forEach((b) => b.classList.toggle('on', b.dataset.pos === S.overlay.pos)));
  bindCheck('progressOn', () => S.progress, (v) => { S.progress = v; });
  bindRange('origVol', 'origV', () => S.origVol, (v) => { S.origVol = v; applyVolumes(); }, pct);
  bindRange('musicVol', 'musicV', () => S.musicVol, (v) => { S.musicVol = v; applyVolumes(); }, pct);
  $('#btnMusic').addEventListener('click', () => $('#musicInput').click());
  $('#musicInput').addEventListener('change', (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    if (music.src) URL.revokeObjectURL(music.src);
    music.src = URL.createObjectURL(f);
    S.musicName = f.name;
    ensureAudio();
    refreshMusicUI();
    if (!video.paused) startMusic();
  });
  $('#btnMusicClear').addEventListener('click', () => {
    music.pause(); URL.revokeObjectURL(music.src); music.removeAttribute('src'); music.load();
    S.musicName = ''; refreshMusicUI();
  });
  function refreshMusicUI() {
    $('#musicName').textContent = S.musicName || 'None. The track is only for this session and is not saved with the project.';
    $('#btnMusicClear').hidden = !S.musicName;
  }
  refreshers.push(refreshMusicUI);

  function startMusic() {
    if (!S.musicName) return;
    const c = activeClip();
    const rel = Math.max(0, video.currentTime - (c ? c.start : 0));
    try {
      if (music.duration) music.currentTime = rel % music.duration;
      music.play().catch(() => {});
    } catch (e) { /* ignore */ }
  }

  function syncInspector() { refreshers.forEach((fn) => fn()); }
  function syncAll() { renderClips(); syncInspector(); renderTranscript(); buildTiles(); }

  /* ---------- tabs ---------- */
  $$('.tabs').forEach((tabs) => {
    tabs.addEventListener('click', (e) => {
      const b = e.target.closest('.tab'); if (!b) return;
      const side = tabs.closest('aside');
      $$('.tab', tabs).forEach((t) => t.classList.toggle('on', t === b));
      $$('.pane', side).forEach((p) => p.classList.toggle('on', p.dataset.pane === b.dataset.tab));
      if (b.dataset.tab === 'transcript') renderTranscript();
    });
  });
  function openTab(side, name) {
    const b = $('.tabs[data-tabs="' + side + '"] .tab[data-tab="' + name + '"]');
    if (b) b.click();
  }

  /* ---------- transcript ---------- */
  const tr = { words: [], spans: [], now: -1 };
  function renderTranscript() {
    const el = $('#transcript');
    el.innerHTML = '';
    tr.now = -1;
    const c = activeClip();
    const list = c ? S.words.filter((w) => w.e > c.start && w.s < c.end) : S.words.slice(0, 600);
    tr.words = list;
    tr.spans = [];
    if (!list.length) {
      el.innerHTML = '<div class="empty-note">No words for ' + (c ? 'this clip' : 'this video') + ' yet.<br>Transcribe on your device, or import a .srt / .vtt file.</div>';
      return;
    }
    const frag = document.createDocumentFragment();
    list.forEach((w, i) => {
      const s = document.createElement('span');
      s.className = 'w'; s.dataset.i = i; s.textContent = w.t;
      tr.spans.push(s);
      frag.appendChild(s);
      frag.appendChild(document.createTextNode(' '));
    });
    el.appendChild(frag);
  }
  $('#transcript').addEventListener('click', (e) => {
    const s = e.target.closest('.w'); if (!s || s.isContentEditable) return;
    const w = tr.words[+s.dataset.i];
    if (w) { pause(); video.currentTime = w.s; }
  });
  $('#transcript').addEventListener('dblclick', (e) => {
    const s = e.target.closest('.w'); if (!s) return;
    s.contentEditable = 'true'; s.focus();
    const r = document.createRange(); r.selectNodeContents(s);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  });
  $('#transcript').addEventListener('focusout', (e) => {
    const s = e.target.closest('.w'); if (!s || !s.isContentEditable) return;
    s.contentEditable = 'false';
    const w = tr.words[+s.dataset.i];
    const txt = s.textContent.trim().replace(/\s+/g, ' ');
    if (w && txt && txt !== w.t) { w.t = txt; S.wordsRev++; touch(); }
    s.textContent = w ? w.t : txt;
  });
  $('#transcript').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });

  function updateNowWord(t) {
    const ws = tr.words;
    if (!ws.length) return;
    let lo = 0, hi = ws.length - 1, idx = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (ws[m].s <= t) { idx = m; lo = m + 1; } else hi = m - 1; }
    if (idx >= 0 && t > ws[idx].e + 0.6) idx = -1;
    if (idx === tr.now) return;
    if (tr.now >= 0 && tr.spans[tr.now]) tr.spans[tr.now].classList.remove('now');
    tr.now = idx;
    const s = tr.spans[idx];
    if (s) { s.classList.add('now'); if (!video.paused) s.scrollIntoView({ block: 'nearest' }); }
  }

  $('#btnSub').addEventListener('click', () => $('#subInput').click());
  $('#subInput').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    const words = OC.parseSubtitles(await f.text());
    if (!words.length) return OC.toast('No subtitle cues found in that file.', 'error');
    S.words = words; S.wordsRev++;
    renderTranscript(); touch();
    OC.toast('Imported ' + words.length + ' words.');
  });
  $('#btnClearTr').addEventListener('click', () => { S.words = []; S.wordsRev++; renderTranscript(); touch(); });

  let asrBusy = false;
  function setAsr(text, p) {
    $('#asrStatus').hidden = false;
    $('#asrText').textContent = text;
    const bar = $('#asrStatus .bar');
    bar.classList.toggle('indet', p == null);
    $('#asrBar').style.width = p == null ? '' : Math.round(p * 100) + '%';
  }
  async function runAsr(scope) {
    if (asrBusy) return;
    const c = activeClip();
    if (scope === 'clip' && !c) return OC.toast('Select a clip first.');
    const a = scope === 'clip' ? c.start : 0, b = scope === 'clip' ? c.end : S.duration;
    asrBusy = true;
    $('#btnAsrClip').disabled = $('#btnAsrAll').disabled = true;
    try {
      setAsr('Decoding audio…', null);
      const pcm = await OC.decodeMono16k(S.file);
      const sub = pcm.slice(Math.floor(a * 16000), Math.min(pcm.length, Math.ceil(b * 16000)));
      const words = await OC.transcribe(sub, $('#asrModel').value, setAsr);
      words.forEach((w) => { w.s += a; w.e += a; });
      S.words = S.words.filter((w) => w.e <= a || w.s >= b).concat(words).sort((x, y) => x.s - y.s);
      S.wordsRev++;
      renderTranscript(); touch();
      OC.toast(words.length ? 'Transcribed ' + words.length + ' words.' : 'No speech found in that range.');
    } catch (err) {
      console.error(err);
      OC.toast('Transcription failed: ' + (err && err.message ? err.message : err) + '. It needs a connection to download the model the first time.', 'error');
    } finally {
      asrBusy = false;
      $('#asrStatus').hidden = true;
      $('#btnAsrClip').disabled = $('#btnAsrAll').disabled = false;
    }
  }
  $('#btnAsrClip').addEventListener('click', () => runAsr('clip'));
  $('#btnAsrAll').addEventListener('click', () => runAsr('all'));

  /* ---------- playback ---------- */
  function pause() { video.pause(); }
  async function play() {
    if (!S.loaded || S.exporting) return;
    const a = ensureAudio();
    if (a.ac.state === 'suspended') await a.ac.resume();
    const c = activeClip();
    const s = c ? c.start : 0, e = c ? c.end : S.duration;
    if (video.currentTime < s || video.currentTime >= e - 0.05) video.currentTime = s;
    try { await video.play(); } catch (err) { /* interrupted */ }
  }
  const togglePlay = () => (video.paused ? play() : pause());
  $('#btnPlay').addEventListener('click', togglePlay);
  video.addEventListener('play', () => { $('#btnPlay').textContent = 'Pause'; startMusic(); });
  video.addEventListener('pause', () => { $('#btnPlay').textContent = 'Play'; music.pause(); });
  video.addEventListener('seeked', () => { if (!video.paused) startMusic(); });
  video.addEventListener('ended', () => {
    if (S.exporting) return;
    const c = activeClip();
    video.currentTime = c ? c.start : 0;
  });

  let scrubbing = false;
  const scrub = $('#scrub');
  scrub.addEventListener('pointerdown', () => { scrubbing = true; });
  window.addEventListener('pointerup', () => { scrubbing = false; });
  scrub.addEventListener('input', () => {
    const c = activeClip();
    const s = c ? c.start : 0, e = c ? c.end : S.duration;
    video.currentTime = s + (scrub.value / 1000) * (e - s);
  });
  $('#chkGuides').addEventListener('change', (e) => { S.guides = e.target.checked; });

  /* ---------- frame loop ---------- */
  let lastUI = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    if (!S.exporting) tick(now); // while exporting, a worker timer drives rendering (see startTicker)
  }

  // requestAnimationFrame stops in background tabs; a worker timer keeps export frames coming.
  function startTicker() {
    try {
      const src = 'setInterval(function(){postMessage(0)},' + Math.round(1000 / 30) + ')';
      const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      w.onmessage = () => tick(performance.now());
      return w;
    } catch (e) {
      const id = setInterval(() => tick(performance.now()), 33);
      return { terminate: () => clearInterval(id) };
    }
  }

  function tick(now) {
    if (!S.loaded) return;
    const c = activeClip();
    const t = video.currentTime;
    if (!video.paused && !S.exporting && c && t >= c.end - 0.02) video.currentTime = c.start;
    if (S.exporting && S.exportClip) {
      const ec = S.exportClip;
      busy('Exporting ' + S.exportLabel, 'Keep this tab visible · ' + fmt(Math.max(0, t - ec.start)) + ' / ' + fmt(ec.end - ec.start), (t - ec.start) / (ec.end - ec.start), true);
      if (t >= ec.end - 0.03 || video.ended || cancelFlag) { if (S.onExportEnd) S.onExportEnd(); }
    }
    OC.renderFrame(ctx, t, { clip: c, guides: S.guides && !S.exporting });
    if (now - lastUI > 60) {
      lastUI = now;
      const s = c ? c.start : 0, e = c ? c.end : S.duration;
      if (!scrubbing) scrub.value = clamp(((t - s) / Math.max(0.01, e - s)) * 1000, 0, 1000);
      $('#timeLbl').textContent = fmt(Math.max(0, t - s)) + ' / ' + fmt(e - s);
      updateNowWord(t);
    }
    OC.timeline.draw();
  }
  requestAnimationFrame(frame);

  OC.timeline.init({
    select: (id, o) => selectClip(id, Object.assign({ seek: false }, o)),
    change: (c) => afterClipTimeChange(c),
    seek: (t) => { video.currentTime = t; },
  });
  $('#tlWhole').addEventListener('click', () => OC.timeline.whole());
  $('#tlClip').addEventListener('click', () => OC.timeline.focus(activeClip()));

  /* ---------- top bar, detect, new clip ---------- */
  $('#btnDetect').addEventListener('click', () => {
    if (!S.loaded) return;
    detect(); renderClips(); syncInspector(); renderTranscript();
    if (S.activeId) selectClip(S.activeId, { focus: true }); else OC.timeline.whole();
    if (!S.energy) OC.toast('No audio analysis available, so clips were spaced evenly.');
  });
  $('#btnNewClip').addEventListener('click', () => {
    if (!S.loaded) return;
    const s = clamp(video.currentTime, 0, Math.max(0, S.duration - 1));
    const e = Math.min(S.duration, s + 30);
    const c = makeClip(s, e, null, 'Clip ' + (S.clips.length + 1));
    S.clips.push(c); S.clips.sort((a, b) => a.start - b.start);
    selectClip(c.id, { focus: true });
  });
  $('#btnOpen').addEventListener('click', () => $('#fileInput').click());
  $('#btnChoose').addEventListener('click', () => $('#fileInput').click());
  $('#fileInput').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; loadFile(f); });
  $('#btnExportTop').addEventListener('click', () => { openTab('right', 'post'); exportActive(); });

  // drag & drop anywhere
  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach((ev) => window.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => window.addEventListener(ev, (e) => { e.preventDefault(); if (ev === 'drop' || e.target === document.documentElement) drop.classList.remove('over'); }));
  window.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) loadFile(f); });

  /* ---------- keyboard ---------- */
  window.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' && e.target.type !== 'range' && e.target.type !== 'checkbox') return;
    if (tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
    if (!S.loaded) return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'i' || e.key === 'I') setIn();
    else if (e.key === 'o' || e.key === 'O') setOut();
  });

  /* ---------- export ---------- */
  const MIMES = [
    'video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4',
    'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm',
  ];
  function pickMime() {
    if (!window.MediaRecorder) return null;
    const type = MIMES.find((m) => MediaRecorder.isTypeSupported(m));
    return type ? { type, ext: type.startsWith('video/mp4') ? 'mp4' : 'webm' } : null;
  }
  const mimeInfo = pickMime();
  $('#fmtNote').textContent = mimeInfo ? 'Your browser will save .' + mimeInfo.ext + ' files' : 'This browser cannot record video, so export is unavailable. Try Chrome or Edge.';

  async function exportClip(clip, label) {
    if (!mimeInfo) { OC.toast('This browser cannot record video. Try Chrome or Edge.', 'error'); return false; }
    const a = ensureAudio();
    await a.ac.resume();
    pause();
    S.exporting = true; S.exportClip = clip; S.exportLabel = label;
    cancelFlag = false;
    a.monitor.gain.value = 0;
    const prev = S.activeId;
    S.activeId = clip.id;
    busy('Exporting ' + label, 'Preparing…', 0, true);
    await OC.seek(clip.start);
    await new Promise((r) => setTimeout(r, 150));

    const stream = canvas.captureStream(30);
    a.dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
    const rec = new MediaRecorder(stream, { mimeType: mimeInfo.type, videoBitsPerSecond: 10000000, audioBitsPerSecond: 192000 });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const stopped = new Promise((res) => { rec.onstop = res; });
    const finished = new Promise((res) => { S.onExportEnd = () => { S.onExportEnd = null; res(); }; });

    const ticker = startTicker();
    rec.start(500);
    try { await video.play(); } catch (e) { /* ignore */ }
    await finished;
    ticker.terminate();
    video.pause();
    await new Promise((r) => setTimeout(r, 200));
    rec.stop();
    await stopped;

    S.exporting = false; S.exportClip = null; S.onExportEnd = null;
    a.monitor.gain.value = 1;
    S.activeId = prev;
    const canceled = cancelFlag;
    unbusy();
    if (canceled) return false;
    const base = OC.safeName(clip.name) + '-' + OC.safeName(S.name.replace(/\.[^.]+$/, ''));
    OC.download(new Blob(chunks, { type: mimeInfo.type }), base + '.' + mimeInfo.ext);
    if ($('#saveSrt').checked && S.words.length) {
      const srt = OC.buildSRT(clip, OC.pagesFor(clip));
      if (srt.trim()) OC.download(new Blob([srt], { type: 'text/plain' }), base + '.srt');
    }
    return true;
  }
  async function exportActive() {
    const c = activeClip();
    if (!c) return OC.toast('Select a clip first.');
    if (S.exporting) return;
    const ok = await exportClip(c, c.name);
    if (ok) OC.toast('Exported ' + c.name + '.');
    selectClip(c.id, { focus: false });
  }
  async function exportAll() {
    const list = S.clips.filter((c) => c.include);
    if (!list.length) return OC.toast('No clips are included.');
    if (S.exporting) return;
    const keep = S.activeId;
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      const ok = await exportClip(list[i], list[i].name + ' (' + (i + 1) + '/' + list.length + ')');
      if (!ok) break;
      n++;
    }
    OC.toast('Exported ' + n + ' of ' + list.length + ' clips.');
    selectClip(keep, { focus: false });
  }
  $('#btnExport').addEventListener('click', exportActive);
  $('#btnExportAll').addEventListener('click', exportAll);
  $('#btnSrtOnly').addEventListener('click', () => {
    const c = activeClip();
    if (!c) return OC.toast('Select a clip first.');
    const srt = OC.buildSRT(c, OC.pagesFor(c));
    if (!srt.trim()) return OC.toast('This clip has no transcript yet.', 'error');
    OC.download(new Blob([srt], { type: 'text/plain' }), OC.safeName(c.name) + '.srt');
  });

  /* ---------- boot ---------- */
  syncInspector();
  buildTiles();
  fontsReady.then(() => syncInspector());
})();
