# OpenClip

**Long video. Short clips.** A free, open-source clip maker that runs entirely in your browser. Bring in a long recording, choose the moments worth sharing, and export vertical 1080 × 1920 clips with word-by-word captions. Your video never leaves your device.

Inspired by [ClipLab for Mac](https://www.alexsssaint.com/apps/cliplab).

## Run it

It is plain static files with no build step and no dependencies.

```bash
# any static server works, e.g.
npx http-server . -p 8080
# then open http://localhost:8080
```

Serve it over http rather than opening the files from disk (not tested from `file://`). Use a desktop Chromium browser (Chrome, Edge, Brave, Opera): export relies on `MediaRecorder` and `canvas.captureStream`.

## What it does

- **Suggested highlights** – decodes the audio, builds a loudness curve and proposes the liveliest non-overlapping windows of the length you choose, with edges snapped to quiet moments.
- **Timeline** – zoomable loudness view with draggable trim handles (`I` / `O` set start and end at the playhead, `Space` plays).
- **Vertical framing** – *Fill* (crop with zoom and X/Y position) or *Fit + blur*. *Auto-follow* tracks motion across the clip to steer the crop.
- **Word-by-word captions** – 8 styles (Bold Pop, Karaoke, Minimal, Boxed, Neon, Marker, Outline, Typewriter) with size, position, words-per-page, case and accent controls.
- **Transcripts** – import `.srt` / `.vtt`, or transcribe on-device with Whisper via [transformers.js](https://github.com/huggingface/transformers.js) (the model is downloaded once from a CDN and cached). Double-click a word to correct it.
- **Polish** – hook card, overlay text, progress bar, music bed with volume mixing.
- **Export** – 1080 × 1920 at 30 fps with captions burned in (MP4 where the browser supports it, otherwise WebM) plus a matching `.srt`.
- **Autosave** – project edits are stored in `localStorage`, keyed to the video file.

## Limits

- Export runs in real time (a 30 s clip takes ~30 s).
- Local video files only; browsers cannot download from YouTube.
- Highlights come from audio energy, not meaning. Auto-follow tracks motion, not faces.
- Codec support depends on the browser; H.264 MP4 and WebM are safest.
- Music files are not saved with the project (browsers cannot persist file handles without re-picking).

## Layout

```
index.html        landing page
app.html          the editor
css/              base, landing and app styles
js/analyze.js     audio analysis, highlight detection, SRT/VTT parse + build
js/captions.js    caption styles, paging, canvas drawing
js/render.js      frame renderer shared by preview and export, auto-follow
js/timeline.js    zoomable timeline
js/transcribe.js  optional Whisper transcription
js/app.js         UI, playback, persistence, export
```

## License

Public domain under [the Unlicense](LICENSE).
