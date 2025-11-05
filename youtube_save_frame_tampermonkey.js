// ==UserScript==
// @name         YouTube Save Frame — JPG 98% (hotkey only)
// @namespace    steven.saveframe
// @version      1.4.4
// @description  Save the current YouTube frame as a JPEG at 95% quality via hotkey (no UI/button)
// @match        https://www.youtube.com/*
// @match        https://m.youtube.com/*
// @grant        GM_download
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  // ======= CONFIG =======
  const CFG = {
    format: 'jpeg',     // output format: 'jpeg'
    _quality: 0.98,     // <-- 98% JPEG quality
    scale: 1,           // 1 = native; 1.5–2.0 only if you intend to downscale externally
    hotkey: 's',        // press Ctrl+Shift+S by default
    hotkeyCtrl: true,
    hotkeyShift: true,
    hotkeyAlt: false,
    autoPause: false,   // pause before capture
    showToast: true     // show a brief "Saved" toast
  };

  // Toast styling (kept; no button UI is injected)
  GM_addStyle(`
    .ytp-saveframe-toast {
      position: absolute; bottom: 56px; left: 50%; transform: translateX(-50%);
      background: rgba(28,28,28,.92); color: #fff; padding: 8px 12px; border-radius: 4px;
      font: 12px/1.4 Roboto, Arial, sans-serif; z-index: 999999; pointer-events: none; opacity: 0; transition: opacity .15s;
      max-width: 80vw; text-overflow: ellipsis; white-space: nowrap; overflow: hidden;
    }
    .ytp-saveframe-toast.show { opacity: 1; }
  `);

  // ---------- Helpers ----------
  const SELECTORS = {
    videos: [
      'video.html5-main-video',
      'ytd-player video',
      'ytd-reel-video-renderer video',
      '#shorts-container video',
      'video'
    ],
    players: [
      '.html5-video-player',
      '#movie_player',
      'ytd-player',
      'ytd-reel-video-renderer',
      '#shorts-container',
      'body'
    ],
    titles: [
      'h1.ytd-watch-metadata yt-formatted-string',
      'h1.title',
      'h1.ytd-reel-player-overlay-renderer',
      'meta[itemprop="name"]',
      'title'
    ]
  };

  const getBestVideo = () => {
    const list = SELECTORS.videos.flatMap(s => Array.from(document.querySelectorAll(s)));
    let best = null, score = -1;
    for (const v of list) {
      const r = v.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && v.offsetParent !== null) {
        const sc = r.width * r.height;
        if (sc > score) { score = sc; best = v; }
      }
    }
    return best || document.querySelector('video');
  };

  const getPlayerFor = (el) => {
    if (!el) return document.querySelector(SELECTORS.players[0]) || document.body;
    let n = el;
    while (n && n !== document.documentElement) {
      if (SELECTORS.players.some(sel => n.matches?.(sel))) return n;
      n = n.parentElement || n.getRootNode?.().host || null;
    }
    return document.querySelector(SELECTORS.players[0]) || document.body;
  };

  const sanitizeFilename = (s) => (s || 'YouTube')
    .replace(/[\\/:*?"<>|\u0000-\u001F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);

  const tsp = (t) => {
    const hh = Math.floor(t / 3600);
    const mm = Math.floor((t % 3600) / 60);
    const ss = Math.floor(t % 60);
    const ms = Math.round((t % 1) * 1000);
    return {
      hh: String(hh).padStart(2, '0'),
      mm: String(mm).padStart(2, '0'),
      ss: String(ss).padStart(2, '0'),
      ms: String(ms).padStart(3, '0')
    };
  };

  const notify = (msg, player, ms = 1600) => {
    if (!CFG.showToast || !player) return;
    let toast = player.querySelector('.ytp-saveframe-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'ytp-saveframe-toast';
      player.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), ms);
  };

  const waitNextPresentedFrame = (video) =>
    new Promise((resolve) => {
      if (video?.requestVideoFrameCallback) {
        let done = false;
        video.requestVideoFrameCallback(() => { if (!done) { done = true; resolve(); } });
        setTimeout(() => { if (!done) { done = true; resolve(); } }, 80);
      } else {
        requestAnimationFrame(() => resolve());
      }
    });

  // Prefer OffscreenCanvas.convertToBlob for encoding if available
  async function canvasToJpegBlob(canvas, quality) {
    if ('OffscreenCanvas' in window && canvas.transferControlToOffscreen) {
      try {
        const off = canvas.transferControlToOffscreen();
        const blob = await off.convertToBlob({ type: 'image/jpeg', quality });
        return blob;
      } catch {}
    }
    if (canvas.convertToBlob) {
      try { return await canvas.convertToBlob({ type: 'image/jpeg', quality }); } catch {}
    }
    return await new Promise((resolve, reject) => {
      try { canvas.toBlob(b => b ? resolve(b) : reject(new Error('Canvas toBlob returned null.')), 'image/jpeg', quality); }
      catch (e) { reject(e); }
    });
  }

  // ---------- Capture ----------
  async function captureAndSave() {
    const video = getBestVideo();
    if (!video) throw new Error('Video element not found');
    const player = getPlayerFor(video);

    if (CFG.autoPause && !video.paused) video.pause();

    if (!video.videoWidth || !video.videoHeight || video.readyState < 2) {
      throw new Error('Video not ready. Play briefly, then pause at your frame.');
    }

    // Align with the currently presented frame
    await waitNextPresentedFrame(video);

    const targetW = Math.max(1, Math.round(video.videoWidth * CFG.scale));
    const targetH = Math.max(1, Math.round(video.videoHeight * CFG.scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;

    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    try {
      ctx.drawImage(video, 0, 0, targetW, targetH);
    } catch (e) {
      throw new Error('This video is protected or cross-origin; capture is blocked by the browser.');
    }

    const blob = await canvasToJpegBlob(canvas, CFG._quality);

    // Title for filename
    let titleText = '';
    for (const sel of SELECTORS.titles) {
      const el = document.querySelector(sel);
      if (el?.textContent) { titleText = el.textContent.trim(); break; }
      if (el?.getAttribute?.('content')) { titleText = el.getAttribute('content'); break; }
    }
    if (!titleText) titleText = document.title.replace(/ - YouTube$/, '');
    const title = sanitizeFilename(titleText);

    const { hh, mm, ss, ms } = tsp(video.currentTime);
    const filename = `${title} - ${hh}-${mm}-${ss}.${ms}.jpg`;

    const url = URL.createObjectURL(blob);
    try {
      if (typeof GM_download === 'function') {
        await new Promise((resolve, reject) => {
          GM_download({ url, name: filename, saveAs: false, onload: resolve, onerror: reject, ontimeout: reject });
        });
      } else {
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); a.remove();
      }
      notify(`Saved: ${filename}`, player);
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }
  }

  // ---------- Hotkey only (no UI/button injection) ----------
  window.addEventListener('keydown', (e) => {
    const isInput = /^(INPUT|TEXTAREA|SELECT)$/i.test(e.target.tagName) || e.target.isContentEditable;
    if (isInput) return;
    const keyMatch = e.key?.toLowerCase() === CFG.hotkey.toLowerCase();
    const modsOK = (!!CFG.hotkeyCtrl === e.ctrlKey) && (!!CFG.hotkeyShift === e.shiftKey) && (!!CFG.hotkeyAlt === e.altKey);
    if (keyMatch && modsOK) {
      e.preventDefault();
      captureAndSave().catch(err => {
        const player = getPlayerFor(getBestVideo());
        notify(`Save failed: ${err?.message || err}`, player);
      });
    }
  }, true);
})();