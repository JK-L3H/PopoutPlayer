// PopoutPlayer Content Script
// Handles video detection, overlay icons, and popout orchestration

(function() {
  'use strict';

  // State management
  const processedVideos = new WeakSet();
  const videoOverlays = new WeakMap();
  const activePopouts = new Map(); // videoId -> { popup, restoreInfo }
  let nextVideoId = 0;

  // SVG Icons
  const ICONS = {
    pip: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
      <path d="M19 7h-8v6h8V7zm2-4H3c-1.1 0-2 .9-2 2v14c0 1.1.9 1.98 2 1.98h18c1.1 0 2-.88 2-1.98V5c0-1.1-.9-2-2-2zm0 16.01H3V4.98h18v14.03z"/>
    </svg>`,
    play: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
      <path d="M8 5v14l11-7z"/>
    </svg>`,
    pause: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
      <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
    </svg>`,
    skipBack: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
      <path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z"/>
    </svg>`,
    skipForward: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
      <path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z"/>
    </svg>`,
    volumeUp: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
    </svg>`,
    volumeMute: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
      <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
    </svg>`,
    close: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
      <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
    </svg>`,
    back: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
      <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
    </svg>`
  };

  // If fetch(player.css) fails — enough to show video + controls (not blocked by page CSP)
  const POPOUT_PLAYER_CSS_FALLBACK =
    '*{margin:0;padding:0;box-sizing:border-box}html,body{width:100%;height:100%;overflow:hidden;background:#000;font-family:system-ui,sans-serif}' +
    '.player-container{display:flex;flex-direction:column;width:100%;height:100%;min-height:0;position:relative;background:#000;justify-content:flex-start;align-items:stretch}' +
    '.video-wrapper{flex:1 1 auto;min-height:0;width:100%;position:relative;display:flex;align-items:center;justify-content:center;background:#000;overflow:hidden}' +
    '.video-wrapper video{display:block;width:100%;height:100%;object-fit:contain;object-position:center center}' +
    '.popout-close-float{position:absolute;top:10px;right:10px;z-index:25;width:40px;height:40px;border:none;border-radius:8px;background:rgba(0,0,0,.55);cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;opacity:0;pointer-events:none}' +
    '.player-container:hover .popout-close-float{opacity:1;pointer-events:auto}' +
    '.controls{position:absolute;bottom:0;left:0;right:0;padding:20px 16px 12px;z-index:10;background:linear-gradient(to top,rgba(0,0,0,.9),transparent);transition:opacity .15s ease-out}' +
    '.controls.hidden{opacity:0;transform:translateY(100%);pointer-events:none;transition:none}' +
    '.bottom-controls{display:flex;justify-content:space-between;align-items:center;gap:16px}' +
    '.left-controls,.right-controls{display:flex;align-items:center;gap:8px;flex-wrap:wrap}' +
    '.control-btn{background:none;border:none;color:#fff;cursor:pointer;padding:8px}' +
    '.time-display{color:#fff;font-size:13px}' +
    '.progress-container{position:relative;height:6px;background:rgba(255,255,255,.2);border-radius:3px;margin-bottom:12px}' +
    '.buffered,.progress{position:absolute;left:0;top:0;height:100%;border-radius:3px}' +
    '.buffered{background:rgba(255,255,255,.4)}.progress{background:#2196F3}' +
    '.scrubber{width:100%}.volume-slider{width:80px}';

  // Utility: Format time as MM:SS or HH:MM:SS
  function formatTime(seconds) {
    if (!isFinite(seconds)) return '0:00';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }

  function isExtensionContextInvalidated(err) {
    return (
      err &&
      (err.message === 'Extension context invalidated.' || err.message === 'Extension context invalidated')
    );
  }

  // After extension reload/update, old content scripts lose access to chrome.runtime
  function safeGetExtensionUrl(path) {
    try {
      if (typeof chrome === 'undefined' || !chrome.runtime || typeof chrome.runtime.getURL !== 'function') {
        return null;
      }
      return chrome.runtime.getURL(path);
    } catch (e) {
      return null;
    }
  }

  function getVideoIntrinsicDimensions(video) {
    let vw = video.videoWidth;
    let vh = video.videoHeight;
    const rect = video.getBoundingClientRect();
    if (vw <= 0 || vh <= 0) {
      if (rect.width > 0 && rect.height > 0) {
        vw = rect.width;
        vh = rect.height;
      } else {
        vw = 16;
        vh = 9;
      }
    }
    return { vw: vw, vh: vh, rect: rect };
  }

  // Initial window size from in-page video box × intrinsic aspect ratio. No clamp to screen or “100%” —
  // the user can resize freely afterward; the player fills the window via CSS.
  function computePopoutWindowSizeFromDims(vw, vh, rect) {
    const minW = 400;
    const ar = vw / vh;
    const hintW = rect && rect.width > 0 ? rect.width : 640;
    const w = Math.max(minW, hintW);
    const h = w / ar;
    return {
      width: Math.round(w),
      height: Math.round(Math.max(220, h))
    };
  }

  function computePopoutWindowSize(video) {
    const d = getVideoIntrinsicDimensions(video);
    return computePopoutWindowSizeFromDims(d.vw, d.vh, d.rect);
  }

  // Keep requested size within the work area so Document PiP / popups are less likely to fail on huge rects.
  function clampPopoutWindowSize(size) {
    if (typeof screen === 'undefined' || !screen.availWidth || !screen.availHeight) {
      return size;
    }
    const margin = 64;
    const maxW = Math.max(400, screen.availWidth - margin);
    const maxH = Math.max(220, screen.availHeight - margin);
    return {
      width: Math.min(Math.max(400, size.width), maxW),
      height: Math.min(Math.max(220, size.height), maxH)
    };
  }

  // In cross-origin iframes the API may only exist on the top window; access can throw.
  function resolveDocumentPictureInPictureApi() {
    try {
      if (window.documentPictureInPicture && typeof window.documentPictureInPicture.requestWindow === 'function') {
        return window.documentPictureInPicture;
      }
    } catch (e) {
      /* ignore */
    }
    try {
      if (
        window.top &&
        window.top !== window &&
        window.top.documentPictureInPicture &&
        typeof window.top.documentPictureInPicture.requestWindow === 'function'
      ) {
        return window.top.documentPictureInPicture;
      }
    } catch (e) {
      /* cross-origin top */
    }
    return null;
  }

  // Utility: Check if video is visible and large enough
  function isVideoEligible(video) {
    const rect = video.getBoundingClientRect();
    const style = window.getComputedStyle(video);

    // Filter out tiny videos and hidden videos
    if (rect.width < 150 || rect.height < 100) return false;
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    // YouTube and others use position:fixed for the main player — offsetParent is often null then
    const pos = style.position;
    if (pos !== 'fixed' && pos !== 'sticky' && video.offsetParent === null) return false;

    return true;
  }

  // On YouTube, only the #movie_player / .video-stream element carries the real MSE stream
  function narrowVideoCandidatesForSite(videos) {
    const h = location.hostname;
    if (h === 'www.youtube.com' || h === 'youtube.com' || h === 'm.youtube.com') {
      const inMoviePlayer = videos.filter(function (v) {
        return v.closest('#movie_player') || v.classList.contains('video-stream');
      });
      if (inMoviePlayer.length) {
        return inMoviePlayer;
      }
    }
    return videos;
  }

  function isYoutubeHost() {
    const h = location.hostname;
    return (
      h === 'www.youtube.com' ||
      h === 'youtube.com' ||
      h === 'm.youtube.com' ||
      h === 'music.youtube.com'
    );
  }

  // Focus the source tab (not only its window) and restore the scroll position from when the popout opened,
  // then ensure the placeholder/video is visible. Prefer tab id captured at popout time — getCurrent() from
  // the popout UI can resolve the wrong tab when multiple windows are open.
  function focusSourceTabAndScrollToVideo(videoId) {
    const ent = activePopouts.get(videoId);
    const restoreInfo = ent && ent.restoreInfo;

    function restoreSavedScroll() {
      if (!restoreInfo) {
        return;
      }
      const x = restoreInfo.scrollX;
      const y = restoreInfo.scrollY;
      if (typeof x === 'number' && typeof y === 'number' && isFinite(x) && isFinite(y)) {
        try {
          window.scrollTo({ left: x, top: y, behavior: 'auto' });
        } catch (e) {
          try {
            window.scrollTo(x, y);
          } catch (e2) {
            /* ignore */
          }
        }
      }
    }

    function scrollTargetIntoView() {
      restoreSavedScroll();
      const ph = document.querySelector(`[data-video-id="${videoId}"]`);
      const ent2 = activePopouts.get(videoId);
      let el = ph;
      if (!el && ent2 && ent2.video && ent2.video.isConnected) {
        el =
          ent2.video.closest('#movie_player') ||
          ent2.video.closest('.html5-video-container') ||
          ent2.video;
      }
      try {
        if (el && typeof el.scrollIntoView === 'function') {
          // Nearest keeps the restored page scroll when the target is already visible; still scrolls if needed.
          el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
        }
      } catch (e) {
        /* ignore */
      }
    }

    function focusTabById(tabId, windowId) {
      function runScrollAfterFocus() {
        window.setTimeout(scrollTargetIntoView, 120);
      }

      function directFocusFromContentScript() {
        if (typeof chrome === 'undefined' || !chrome.tabs || typeof chrome.tabs.update !== 'function') {
          scrollTargetIntoView();
          return;
        }
        try {
          if (windowId != null && chrome.windows && typeof chrome.windows.update === 'function') {
            chrome.windows.update(windowId, { focused: true });
          }
        } catch (e) {
          /* ignore */
        }
        try {
          chrome.tabs.update(tabId, { active: true }, function () {
            if (chrome.runtime && chrome.runtime.lastError) {
              scrollTargetIntoView();
              return;
            }
            runScrollAfterFocus();
          });
        } catch (e) {
          scrollTargetIntoView();
        }
      }

      if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
        try {
          chrome.runtime.sendMessage(
            { type: 'popout-focus-source-tab', tabId: tabId, windowId: windowId },
            function (response) {
              if (chrome.runtime && chrome.runtime.lastError) {
                directFocusFromContentScript();
                return;
              }
              if (response && response.ok) {
                runScrollAfterFocus();
              } else {
                directFocusFromContentScript();
              }
            }
          );
        } catch (e) {
          directFocusFromContentScript();
        }
        return;
      }

      directFocusFromContentScript();
    }

    if (typeof chrome !== 'undefined' && chrome.tabs && ent && ent.sourceTabId != null) {
      focusTabById(ent.sourceTabId, ent.sourceWindowId != null ? ent.sourceWindowId : null);
      return;
    }

    if (typeof chrome === 'undefined' || !chrome.tabs || typeof chrome.tabs.getCurrent !== 'function') {
      scrollTargetIntoView();
      return;
    }

    try {
      chrome.tabs.getCurrent(function (tab) {
        if (chrome.runtime && chrome.runtime.lastError) {
          scrollTargetIntoView();
          return;
        }
        if (tab && tab.id != null) {
          focusTabById(tab.id, tab.windowId != null ? tab.windowId : null);
        } else {
          scrollTargetIntoView();
        }
      });
    } catch (e) {
      scrollTargetIntoView();
    }
  }

  // Moving <video> across documents breaks MSE/DASH (Rumble, YouTube, etc.). captureStream() keeps the
  // decoder in-page and mirrors frames/audio into a separate <video> in the popout.
  function tryCaptureStreamFromVideo(video) {
    if (typeof video.captureStream !== 'function') {
      return null;
    }
    try {
      const stream = video.captureStream();
      if (!stream || stream.getVideoTracks().length === 0) {
        if (stream) {
          stream.getTracks().forEach(function (t) {
            t.stop();
          });
        }
        return null;
      }
      return stream;
    } catch (e) {
      console.warn('PopoutPlayer: captureStream failed', e);
      return null;
    }
  }

  // Tab output must be nearly silent while the popout plays the mirror, or users hear echo. Do not use volume 0
  // (often black video from captureStream) or element mute (can drop audio from the captured stream).
  const STREAM_SOURCE_TAB_VOLUME_CAP = 0.001;

  function applyStreamSourceTabDuck(video) {
    const cap = STREAM_SOURCE_TAB_VOLUME_CAP;
    try {
      const v = video.volume;
      if (v <= 0.001) {
        video.volume = cap;
      } else {
        video.volume = Math.min(v, cap);
      }
    } catch (e) {
      /* ignore */
    }
  }

  // Non-YouTube: PiP optional; may fall back to custom window. YouTube: never fall back to custom from here —
  // moving <video> breaks MSE; only Shift+click → openCustomPopoutWindow.
  function tryNativePictureInPictureFirst(video) {
    const yt = isYoutubeHost();

    function youtubePipOnly(message) {
      video._transitioning = false;
      showPopoutHint(
        message ||
          'Picture-in-Picture did not start. Moving the video to another window breaks YouTube playback. Shift+click the pop-out icon if you still want to try the custom window.'
      );
    }

    if (yt) {
      try {
        video.disablePictureInPicture = false;
      } catch (e) {
        /* ignore */
      }
    }

    if (document.pictureInPictureElement === video) {
      document.exitPictureInPicture()
        .then(function () {
          video._transitioning = false;
        })
        .catch(function () {
          video._transitioning = false;
        });
      return;
    }
    if (!document.pictureInPictureEnabled) {
      if (yt) {
        youtubePipOnly(
          'Picture-in-Picture is off in Chrome or blocked for this site. Check chrome://settings/content/pictureInPicture. Shift+click the pop-out icon to try the custom window (often broken on YouTube).'
        );
        return;
      }
      openCustomPopoutWindow(video);
      return;
    }
    if (video.disablePictureInPicture) {
      if (yt) {
        youtubePipOnly(
          'This player has Picture-in-Picture disabled. Shift+click the pop-out icon to try the custom window (may show a black screen).'
        );
        return;
      }
      openCustomPopoutWindow(video);
      return;
    }
    const p = video.requestPictureInPicture();
    if (!p || typeof p.then !== 'function') {
      if (yt) {
        youtubePipOnly(
          'Could not start Picture-in-Picture. Shift+click the pop-out icon to try the custom window (may break playback).'
        );
        return;
      }
      openCustomPopoutWindow(video);
      return;
    }
    p.then(function () {
      video._transitioning = false;
    }).catch(function (err) {
      if (err && err.name === 'NotAllowedError') {
        video._transitioning = false;
        const msg = yt
          ? 'On YouTube, click the pop-out icon on the video (not the toolbar). The browser only allows Picture-in-Picture after a direct click on the player.'
          : 'Picture-in-Picture was blocked. Click the pop-out icon on the video itself (not the extension toolbar).';
        showPopoutHint(msg);
        return;
      }
      if (yt) {
        console.warn('PopoutPlayer: PiP failed on YouTube', err);
        youtubePipOnly(
          'Picture-in-Picture could not start' +
            (err && err.name ? ' (' + err.name + ').' : '.') +
            ' Shift+click the pop-out icon to try the custom window (often broken on YouTube).'
        );
        return;
      }
      console.warn('PopoutPlayer: PiP failed, using custom window', err);
      openCustomPopoutWindow(video);
    });
  }

  // Prefer the real player over hidden buffer/ads videos (e.g. YouTube)
  function scoreVideoForPopout(video) {
    const rect = video.getBoundingClientRect();
    const area = Math.max(0, rect.width) * Math.max(0, rect.height);
    let score = area;
    // Heavily prefer an element that is actually decoding (avoids empty decoy <video>s)
    if (video.videoWidth > 0 && video.videoHeight > 0) score += 1e16;
    if (!video.paused) score += 1e14;
    if (video.currentTime > 0) score += 1e13;
    if (video.readyState >= 2) score += 1e12;
    return score;
  }

  function pickBestVideo(videos) {
    if (!videos.length) return null;
    const narrowed = narrowVideoCandidatesForSite(videos);
    return narrowed.reduce(function (best, v) {
      return scoreVideoForPopout(v) > scoreVideoForPopout(best) ? v : best;
    });
  }

  // about:blank may not have head/body immediately; toolbar path is async (no user gesture)
  function ensurePopupDocStructure(doc) {
    if (!doc || !doc.documentElement) {
      return;
    }
    const html = doc.documentElement;
    if (!doc.head) {
      html.insertBefore(doc.createElement('head'), html.firstChild || null);
    }
    if (!doc.body) {
      html.appendChild(doc.createElement('body'));
    }
  }

  function runWhenPopupReady(popup, fn) {
    let attempts = 0;
    const maxAttempts = 80;
    function tick() {
      if (popup.closed) {
        return;
      }
      try {
        const doc = popup.document;
        if (doc && doc.documentElement) {
          ensurePopupDocStructure(doc);
          if (doc.body && doc.head) {
            try {
              fn();
            } catch (e) {
              console.error('PopoutPlayer: popup build failed', e);
            }
            return;
          }
        }
      } catch (e) {
        console.warn('PopoutPlayer: popup.document access', e);
      }
      if (attempts++ >= maxAttempts) {
        console.error('PopoutPlayer: popup document never became ready');
        try {
          const doc = popup.document;
          if (doc && doc.documentElement) {
            ensurePopupDocStructure(doc);
            fn();
          }
        } catch (e) {
          console.error('PopoutPlayer: fallback popup build failed', e);
        }
        return;
      }
      setTimeout(tick, 10);
    }
    setTimeout(tick, 0);
  }

  // Paint before async work so the window is not stuck white (CSP cannot block inline styles we set here)
  function primePopupPaint(popup) {
    function paint() {
      try {
        if (popup.closed) return;
        const doc = popup.document;
        if (!doc || !doc.documentElement) return;
        ensurePopupDocStructure(doc);
        doc.documentElement.style.cssText = 'height:100%;margin:0;padding:0;background:#000;';
        if (doc.body) {
          doc.body.style.cssText = 'margin:0;padding:0;min-height:100%;background:#000;';
        }
      } catch (e) {
        /* ignore */
      }
    }
    paint();
    setTimeout(paint, 0);
    setTimeout(paint, 30);
  }

  // Video detection: find all videos including in shadow DOM
  function findAllVideos(root = document) {
    const videos = [];

    // Direct query
    videos.push(...root.querySelectorAll('video'));

    // Traverse shadow DOM
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_ELEMENT,
      null,
      false
    );

    let node;
    while (node = walker.nextNode()) {
      if (node.shadowRoot) {
        videos.push(...findAllVideos(node.shadowRoot));
      }
    }

    return videos;
  }

  // Process a video: create overlay if not already processed
  function processVideo(video) {
    if (processedVideos.has(video)) return;
    if (!isVideoEligible(video)) return;

    processedVideos.add(video);
    createOverlay(video);
  }

  // Create overlay icon for a video
  function createOverlay(video) {
    // Create shadow host
    const host = document.createElement('div');
    host.style.cssText = 'position: fixed; z-index: 2147483647; pointer-events: none;';

    // Attach closed shadow DOM for style isolation
    const shadow = host.attachShadow({ mode: 'closed' });

    // Inject styles
    const style = document.createElement('style');
    style.textContent = `
      :host {
        all: initial;
        position: fixed;
        z-index: 2147483647;
        pointer-events: none;
      }
      .popout-overlay-button {
        all: initial;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 40px;
        height: 40px;
        background: rgba(28, 28, 28, 0.95);
        border: none;
        border-radius: 8px;
        cursor: pointer;
        pointer-events: auto;
        transition: all 0.2s ease;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
      }
      .popout-overlay-button:hover {
        background: rgba(45, 45, 45, 0.98);
        transform: scale(1.1);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
      }
      .popout-overlay-button:active {
        transform: scale(0.95);
      }
      .popout-overlay-button svg {
        width: 24px;
        height: 24px;
        fill: white;
        pointer-events: none;
      }
      .popout-overlay-button.hidden {
        opacity: 0;
        pointer-events: none;
      }
    `;
    shadow.appendChild(style);

    // Create button
    const button = document.createElement('button');
    button.className = 'popout-overlay-button hidden';
    button.innerHTML = ICONS.pip;
    button.title = isYoutubeHost()
      ? 'Pop out (custom window). Shift+click: Chrome Picture-in-Picture instead (one at a time).'
      : 'Pop out (unlimited custom windows). Shift+click: Chrome Picture-in-Picture instead.';
    shadow.appendChild(button);

    // Position tracker
    let hideTimeout;
    let isVisible = false;

    function updatePosition() {
      const rect = video.getBoundingClientRect();
      host.style.left = `${rect.right - 50}px`;
      host.style.top = `${rect.top + 10}px`;
    }

    function show() {
      clearTimeout(hideTimeout);
      if (!isVisible) {
        button.classList.remove('hidden');
        isVisible = true;
      }
      updatePosition();
    }

    function hide() {
      hideTimeout = setTimeout(() => {
        button.classList.add('hidden');
        isVisible = false;
      }, 300);
    }

    // Intersection observer to track visibility
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting && isVisible) {
          hide();
        }
      });
    }, { threshold: 0.1 });
    observer.observe(video);

    // Mouse events
    video.addEventListener('mouseenter', show);
    video.addEventListener('mouseleave', hide);
    button.addEventListener('mouseenter', () => clearTimeout(hideTimeout));
    button.addEventListener('mouseleave', hide);

    // YouTube: same as other sites — custom popout by default; Shift = native PiP.
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      popoutVideo(video, e);
    });

    // Append to page
    document.body.appendChild(host);

    // Store reference
    videoOverlays.set(video, { host, observer, show, hide });
  }

  function popoutVideo(video, ev, preOpenedPopup) {
    if (video._transitioning) return;
    video._transitioning = true;
    const shift = ev && ev.shiftKey === true;

    if (shift) {
      tryNativePictureInPictureFirst(video);
    } else {
      openCustomPopoutWindow(video, preOpenedPopup ? { preOpenedPopup: preOpenedPopup } : undefined);
    }
  }

  // `window.open` must run during the same user activation as the click. If it runs later (e.g. in a promise
  // .catch after Document PiP fails), Chromium opens a normal window with full browser chrome — the “old”
  // title bar / tab strip. Document Picture-in-Picture (Chrome 116+) opens a minimal window; when we use both,
  // we open a reserved popup synchronously first, then close it if Doc PiP succeeds.
  function openFallbackAuxiliaryWindow(size, uniqueWinName) {
    const popFeatures = [
      'popup=yes',
      'width=' + size.width,
      'height=' + size.height,
      'left=' + Math.max(0, Math.round((screen.availWidth - size.width) / 2)),
      'top=' + Math.max(0, Math.round((screen.availHeight - size.height) / 2)),
      'resizable=yes',
      'scrollbars=no',
      'toolbar=no',
      'menubar=no',
      'location=no',
      'status=no',
      'directories=no'
    ].join(',');
    return window.open('about:blank', uniqueWinName, popFeatures);
  }

  function openCustomPopoutWindow(video, options) {
    options = options || {};
    const preOpenedPopup = options.preOpenedPopup;
    try {
      const videoId = nextVideoId++;

      const size = clampPopoutWindowSize(computePopoutWindowSize(video));

      const uniqueWinName =
        'pp_' + videoId + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 12);

      // Record restore information
      const restoreInfo = {
        parent: video.parentElement,
        nextSibling: video.nextElementSibling,
        style: video.getAttribute('style') || '',
        scrollY: window.scrollY,
        scrollX: window.scrollX,
        // Captured before any async ducking so stream-mode restore and mirror volume math stay correct.
        prePopoutAudioSnapshot: { volume: video.volume, muted: video.muted }
      };

      // Many players pause the <video> when the tab blurs / goes hidden after window.open(). Snapshot intent
      // and re-assert play() after the popout is ready (with retries for async site handlers).
      const wasPlayingBeforePopout = !video.paused;

      function startFetchAndBuild(popup) {
        if (!popup || popup.closed || typeof popup.closed === 'undefined') {
          showPopupBlockedBanner(video);
          video._transitioning = false;
          return;
        }

        activePopouts.set(videoId, {
          popup,
          video,
          restoreInfo,
          built: false,
          // Document PiP may omit popup.opener; keep tab window for Navigate Back.
          openerWindow: window
        });
        try {
          if (typeof chrome !== 'undefined' && chrome.tabs && typeof chrome.tabs.getCurrent === 'function') {
            chrome.tabs.getCurrent(function (tab) {
              if (chrome.runtime && chrome.runtime.lastError) {
                return;
              }
              const cur = activePopouts.get(videoId);
              if (!cur || !tab || tab.id == null) {
                return;
              }
              cur.sourceTabId = tab.id;
              if (tab.windowId != null) {
                cur.sourceWindowId = tab.windowId;
              }
            });
          }
        } catch (e) {
          /* ignore */
        }
        attachPlaybackHoldForPopout(videoId, video, popup, wasPlayingBeforePopout);
        installPopoutCloseWatcher(videoId);

        primePopupPaint(popup);
        // Duck the in-page player as soon as we know captureStream works, so tab audio does not play at full level
        // during CSS fetch / inject (otherwise it doubles with the popout mirror and sounds like echo).
        const probeStream = tryCaptureStreamFromVideo(video);
        if (probeStream) {
          applyStreamSourceTabDuck(video);
          try {
            probeStream.getTracks().forEach(function (t) {
              t.stop();
            });
          } catch (e) {
            /* ignore */
          }
        }
        const cssUrl = safeGetExtensionUrl('player/player.css');
        if (!cssUrl) {
          cleanupAbortedPopout(videoId, video);
          try {
            popup.close();
          } catch (e) {
            /* ignore */
          }
          showPopoutHint('PopoutPlayer was reloaded or updated. Refresh this page (F5), then try again.');
          return;
        }
        fetch(cssUrl)
          .then(function (response) {
            if (!response.ok) {
              throw new Error('HTTP ' + response.status);
            }
            return response.text();
          })
          .then(function (cssText) {
            if (popup.closed) {
              cleanupAbortedPopout(videoId, video);
              return;
            }
            runWhenPopupReady(popup, function () {
              try {
                finishPopoutBuild(popup, video, videoId, restoreInfo, cssText, wasPlayingBeforePopout);
              } catch (error) {
                console.error('PopoutPlayer: Failed to create popout', error);
                cleanupAbortedPopout(videoId, video);
                try {
                  popup.close();
                } catch (e) {
                  /* ignore */
                }
              }
            });
          })
          .catch(function (err) {
            console.warn('PopoutPlayer: using fallback CSS', err);
            if (popup.closed) {
              cleanupAbortedPopout(videoId, video);
              return;
            }
            runWhenPopupReady(popup, function () {
              try {
                finishPopoutBuild(popup, video, videoId, restoreInfo, POPOUT_PLAYER_CSS_FALLBACK, wasPlayingBeforePopout);
              } catch (error) {
                console.error('PopoutPlayer: Failed to create popout', error);
                cleanupAbortedPopout(videoId, video);
                try {
                  popup.close();
                } catch (e) {
                  /* ignore */
                }
              }
            });
          });
      }

      // Toolbar path: background opened a named minimal popup via scripting.executeScript (MAIN) while the
      // extension icon click still counts as user activation — skip Doc PiP and use that window only.
      if (preOpenedPopup && !preOpenedPopup.closed) {
        try {
          if (typeof preOpenedPopup.resizeTo === 'function') {
            preOpenedPopup.resizeTo(size.width, size.height);
          }
        } catch (e) {
          /* ignore */
        }
        startFetchAndBuild(preOpenedPopup);
        return;
      }

      const docPipApi = resolveDocumentPictureInPictureApi();
      const canUseDocPip = docPipApi && typeof docPipApi.requestWindow === 'function';

      if (canUseDocPip) {
        const reservedFallback = openFallbackAuxiliaryWindow(size, uniqueWinName);
        docPipApi
          .requestWindow({
            width: size.width,
            height: size.height,
            disallowReturnToOpener: true
          })
          .then(function (pipWindow) {
            if (reservedFallback && !reservedFallback.closed) {
              try {
                reservedFallback.close();
              } catch (e) {
                /* ignore */
              }
            }
            startFetchAndBuild(pipWindow);
          })
          .catch(function (err) {
            console.warn('PopoutPlayer: Document PiP window unavailable, using reserved popup', err);
            startFetchAndBuild(reservedFallback);
          });
      } else {
        startFetchAndBuild(openFallbackAuxiliaryWindow(size, uniqueWinName));
      }
    } catch (error) {
      if (isExtensionContextInvalidated(error)) {
        video._transitioning = false;
        showPopoutHint('PopoutPlayer was reloaded or updated. Refresh this page (F5), then try again.');
        return;
      }
      console.error('PopoutPlayer: Failed to create popout', error);
      video._transitioning = false;
    }
  }

  function clearPopoutCloseWatcher(ent) {
    if (ent && ent.closePollId) {
      try {
        window.clearInterval(ent.closePollId);
      } catch (e) {
        /* ignore */
      }
      ent.closePollId = 0;
    }
  }

  function installPopoutCloseWatcher(videoId) {
    const ent = activePopouts.get(videoId);
    if (!ent || !ent.popup) {
      return;
    }
    clearPopoutCloseWatcher(ent);
    let pollId = 0;
    pollId = window.setInterval(function () {
      const cur = activePopouts.get(videoId);
      if (!cur) {
        window.clearInterval(pollId);
        return;
      }
      try {
        if (cur.popup.closed) {
          window.clearInterval(pollId);
          cur.closePollId = 0;
          restoreVideo(videoId);
        }
      } catch (e) {
        window.clearInterval(pollId);
        cur.closePollId = 0;
        restoreVideo(videoId);
      }
    }, 250);
    ent.closePollId = pollId;
  }

  function cleanupAbortedPopout(videoId, video) {
    const ent = activePopouts.get(videoId);
    clearPopoutCloseWatcher(ent);
    if (ent && typeof ent.releasePlaybackHold === 'function') {
      ent.releasePlaybackHold();
    }
    activePopouts.delete(videoId);
    if (video) {
      try {
        video._transitioning = false;
      } catch (e) {
        /* ignore */
      }
    }
  }

  function resumePlaybackAfterPopout(video, shouldResume) {
    if (!shouldResume) {
      return;
    }
    function tryPlay() {
      try {
        if (video.paused) {
          const p = video.play();
          if (p && typeof p.catch === 'function') {
            p.catch(function () {});
          }
        }
      } catch (e) {
        /* ignore */
      }
    }
    tryPlay();
    window.setTimeout(tryPlay, 0);
    window.setTimeout(tryPlay, 50);
    window.setTimeout(tryPlay, 150);
    window.setTimeout(tryPlay, 400);
  }

  // Sites often pause the <video> after the tab blurs (async, after our first play() calls). Re-assert playback
  // while keepPlayingIntent is true; cleared when the user hits pause in our popout or the window closes.
  function attachPlaybackHoldForPopout(videoId, video, popup, wasPlayingBeforePopout) {
    const info = activePopouts.get(videoId);
    if (!info) {
      return;
    }
    if (typeof info.releasePlaybackHold === 'function') {
      info.releasePlaybackHold();
    }
    info.keepPlayingIntent = !!wasPlayingBeforePopout;

    function tryResumeOnce() {
      if (!info.keepPlayingIntent) {
        return;
      }
      if (popup.closed || !activePopouts.has(videoId)) {
        return;
      }
      try {
        if (video.paused) {
          const p = video.play();
          if (p && typeof p.catch === 'function') {
            p.catch(function () {});
          }
        }
      } catch (e) {
        /* ignore */
      }
    }

    function onSourcePause() {
      if (!info.keepPlayingIntent) {
        return;
      }
      window.setTimeout(tryResumeOnce, 0);
      window.setTimeout(tryResumeOnce, 30);
      window.setTimeout(tryResumeOnce, 100);
      window.setTimeout(tryResumeOnce, 250);
    }

    function onVisibilityChange() {
      if (!info.keepPlayingIntent || !document.hidden) {
        return;
      }
      window.setTimeout(tryResumeOnce, 0);
      window.setTimeout(tryResumeOnce, 80);
    }

    video.addEventListener('pause', onSourcePause);
    document.addEventListener('visibilitychange', onVisibilityChange);

    let holdIntervalId = 0;
    if (wasPlayingBeforePopout) {
      let ticks = 0;
      holdIntervalId = window.setInterval(function () {
        if (!activePopouts.has(videoId) || popup.closed) {
          window.clearInterval(holdIntervalId);
          holdIntervalId = 0;
          return;
        }
        if (!info.keepPlayingIntent) {
          window.clearInterval(holdIntervalId);
          holdIntervalId = 0;
          return;
        }
        if (video.paused) {
          tryResumeOnce();
        }
        if (++ticks > 300) {
          window.clearInterval(holdIntervalId);
          holdIntervalId = 0;
        }
      }, 100);
    }

    info.releasePlaybackHold = function () {
      video.removeEventListener('pause', onSourcePause);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (holdIntervalId) {
        window.clearInterval(holdIntervalId);
        holdIntervalId = 0;
      }
    };

    resumePlaybackAfterPopout(video, wasPlayingBeforePopout);
  }

  function finishPopoutBuild(popup, video, videoId, restoreInfo, cssText, wasPlayingBeforePopout) {
    function runBuild(stream) {
      const snap = restoreInfo.prePopoutAudioSnapshot;
      const savedVolume =
        snap && typeof snap.volume === 'number' && isFinite(snap.volume) ? snap.volume : video.volume;
      const savedMuted = snap && typeof snap.muted === 'boolean' ? snap.muted : video.muted;
      if (stream) {
        applyStreamSourceTabDuck(video);
      }
      const prePopoutAudio = { volume: savedVolume, muted: savedMuted };
      let ui;
      try {
        ui = buildPlayerUI(popup, video, videoId, restoreInfo, cssText, stream, prePopoutAudio);
      } catch (buildErr) {
        if (stream) {
          try {
            video.volume = savedVolume;
            video.muted = savedMuted;
          } catch (e) {
            /* ignore */
          }
          try {
            stream.getTracks().forEach(function (t) {
              t.stop();
            });
          } catch (e2) {
            /* ignore */
          }
        }
        throw buildErr;
      }
      const ent = activePopouts.get(videoId);
      if (ent) {
        Object.assign(ent, {
          mode: stream ? 'stream' : 'moved',
          stream: stream || null,
          displayVideo: ui.displayVideo,
          savedVolume: savedVolume,
          savedMuted: savedMuted,
          // What to restore on the in-page <video> when closing (kept in sync while popout is open).
          integratedVolume: savedVolume,
          integratedMuted: savedMuted,
          built: true
        });
      } else {
        activePopouts.set(videoId, {
          popup,
          restoreInfo,
          video,
          mode: stream ? 'stream' : 'moved',
          stream: stream || null,
          displayVideo: ui.displayVideo,
          savedVolume: savedVolume,
          savedMuted: savedMuted,
          integratedVolume: savedVolume,
          integratedMuted: savedMuted,
          built: true,
          openerWindow: window
        });
        attachPlaybackHoldForPopout(videoId, video, popup, wasPlayingBeforePopout);
      }
      createPlaceholder(video, restoreInfo, videoId, !!stream);
    }

    let stream = tryCaptureStreamFromVideo(video);
    if (stream) {
      runBuild(stream);
      return;
    }
    if (video.paused) {
      const p = video.play();
      if (p && typeof p.then === 'function') {
        p.then(function () {
          runBuild(tryCaptureStreamFromVideo(video) || null);
        }).catch(function () {
          runBuild(null);
        });
        return;
      }
    }
    runBuild(null);
  }

  // Build player UI in popup window (cssText from fetch — not <link>, so page CSP cannot block it)
  // prePopoutAudio: volume/muted on the in-page player *before* any ducking (stream mode) — keeps popout level matched.
  function buildPlayerUI(popup, video, videoId, restoreInfo, cssText, stream, prePopoutAudio) {
    if (!prePopoutAudio) {
      prePopoutAudio = { volume: video.volume, muted: video.muted };
    }
    const doc = popup.document;
    ensurePopupDocStructure(doc);

    // Set up document
    doc.title = 'PopoutPlayer';

    const style = doc.createElement('style');
    style.setAttribute('type', 'text/css');
    style.setAttribute('data-popout-player', '1');
    style.textContent = cssText;
    doc.head.appendChild(style);

    doc.documentElement.style.cssText = 'height:100%;margin:0;padding:0;background:#000;';
    doc.body.style.cssText = 'margin:0;padding:0;min-height:100%;background:#000;overflow:hidden;';

    // Create container
    const container = doc.createElement('div');
    container.className = 'player-container';

    // Video wrapper
    const videoWrapper = doc.createElement('div');
    videoWrapper.className = 'video-wrapper';

    let displayVideo = null;
    if (stream) {
      displayVideo = doc.createElement('video');
      displayVideo.setAttribute('playsinline', '');
      displayVideo.playsInline = true;
      displayVideo.autoplay = true;
      displayVideo.style.cssText =
        'display:block;width:100%;height:100%;object-fit:contain;object-position:center center;pointer-events:auto';
      displayVideo.srcObject = stream;
      videoWrapper.appendChild(displayVideo);
      // Source is ducked (video.volume = small cap). Stream audio scales with that; compensate on displayVideo so
      // perceived loudness matches prePopoutAudio (same as built-in player before popout).
      function applyMirrorOutputVolume() {
        const duck = video.volume;
        const target = prePopoutAudio.volume;
        const wasMuted = prePopoutAudio.muted;
        try {
          if (wasMuted) {
            displayVideo.muted = true;
            displayVideo.volume = Math.min(1, Math.max(0, target));
          } else {
            displayVideo.muted = false;
            displayVideo.volume = Math.min(1, target / Math.max(duck, 1e-6));
          }
        } catch (e) {
          /* ignore */
        }
      }
      // New auxiliary windows often fail unmuted play() (autoplay policy). Start muted, then unmute after playback begins.
      function removeFirstPointerKick() {
        try {
          popup.document.removeEventListener('pointerdown', onFirstPointer, true);
        } catch (e) {
          /* ignore */
        }
      }
      function onFirstPointer() {
        try {
          displayVideo.muted = true;
          displayVideo
            .play()
            .then(function () {
              applyMirrorOutputVolume();
              removeFirstPointerKick();
            })
            .catch(function () {});
        } catch (e) {
          /* ignore */
        }
      }
      function kickDisplayVideo() {
        displayVideo.muted = true;
        const playP = displayVideo.play();
        if (playP && typeof playP.then === 'function') {
          playP
            .then(function () {
              applyMirrorOutputVolume();
              removeFirstPointerKick();
            })
            .catch(function (err) {
              console.warn('PopoutPlayer: popout mirror play failed', err);
            });
        }
      }
      kickDisplayVideo();
      // If autoplay was blocked, first click anywhere in the popout starts the mirror.
      popup.document.addEventListener('pointerdown', onFirstPointer, true);
      videoWrapper.style.position = 'relative';
      videoWrapper.style.zIndex = '0';
    } else {
      // Move <video> into the popup (appendChild across documents adopts automatically)
      videoWrapper.appendChild(video);
      video.style.setProperty('pointer-events', 'auto', 'important');
      video.removeAttribute('inert');
      video.setAttribute('playsinline', '');
      videoWrapper.style.position = 'relative';
      videoWrapper.style.zIndex = '0';
    }

    // Close lives here (top-right, hover) — not in the bottom bar.
    const closeFloatBtn = doc.createElement('button');
    closeFloatBtn.type = 'button';
    closeFloatBtn.className = 'popout-close-float';
    closeFloatBtn.setAttribute('aria-label', 'Close and restore video');
    closeFloatBtn.innerHTML = ICONS.close;
    closeFloatBtn.title = 'Close and restore video';
    videoWrapper.appendChild(closeFloatBtn);

    // Controls container
    const controls = doc.createElement('div');
    controls.className = 'controls';
    controls.style.zIndex = '2147483647';

    // Progress bar container
    const progressContainer = doc.createElement('div');
    progressContainer.className = 'progress-container';

    const buffered = doc.createElement('div');
    buffered.className = 'buffered';
    progressContainer.appendChild(buffered);

    const progress = doc.createElement('div');
    progress.className = 'progress';
    progressContainer.appendChild(progress);

    const scrubber = doc.createElement('input');
    scrubber.type = 'range';
    scrubber.className = 'scrubber';
    scrubber.min = '0';
    scrubber.max = '1000';
    scrubber.value = '0';
    progressContainer.appendChild(scrubber);

    controls.appendChild(progressContainer);

    // Bottom controls
    const bottomControls = doc.createElement('div');
    bottomControls.className = 'bottom-controls';

    // Left controls
    const leftControls = doc.createElement('div');
    leftControls.className = 'left-controls';

    const skipBackBtn = doc.createElement('button');
    skipBackBtn.className = 'control-btn';
    skipBackBtn.innerHTML = ICONS.skipBack;
    skipBackBtn.title = 'Skip back 10s';
    leftControls.appendChild(skipBackBtn);

    const playPauseBtn = doc.createElement('button');
    playPauseBtn.className = 'control-btn play-pause';
    playPauseBtn.innerHTML = video.paused ? ICONS.play : ICONS.pause;
    playPauseBtn.title = 'Play/Pause (Space)';
    leftControls.appendChild(playPauseBtn);

    const skipForwardBtn = doc.createElement('button');
    skipForwardBtn.className = 'control-btn';
    skipForwardBtn.innerHTML = ICONS.skipForward;
    skipForwardBtn.title = 'Skip forward 10s';
    leftControls.appendChild(skipForwardBtn);

    const timeDisplay = doc.createElement('span');
    timeDisplay.className = 'time-display';
    timeDisplay.textContent = '0:00 / 0:00';
    leftControls.appendChild(timeDisplay);

    bottomControls.appendChild(leftControls);

    // Right controls
    const rightControls = doc.createElement('div');
    rightControls.className = 'right-controls';

    const volumeBtn = doc.createElement('button');
    volumeBtn.className = 'control-btn';
    volumeBtn.innerHTML =
      prePopoutAudio.muted || prePopoutAudio.volume === 0 ? ICONS.volumeMute : ICONS.volumeUp;
    volumeBtn.title = 'Mute (M)';
    rightControls.appendChild(volumeBtn);

    const volumeSlider = doc.createElement('input');
    volumeSlider.type = 'range';
    volumeSlider.className = 'volume-slider';
    volumeSlider.min = '0';
    volumeSlider.max = '100';
    volumeSlider.value = String(Math.round(prePopoutAudio.volume * 100));
    rightControls.appendChild(volumeSlider);

    const navigateBackBtn = doc.createElement('button');
    navigateBackBtn.className = 'control-btn navigate-back';
    navigateBackBtn.innerHTML = ICONS.back;
    navigateBackBtn.title = 'Navigate back to source';
    navigateBackBtn.textContent = 'Navigate Back';
    rightControls.appendChild(navigateBackBtn);

    bottomControls.appendChild(rightControls);
    controls.appendChild(bottomControls);
    videoWrapper.appendChild(controls);
    container.appendChild(videoWrapper);

    doc.body.appendChild(container);

    // Wire up controls (source `video` stays in the page when stream mirroring)
    wireUpControls(popup, video, videoId, {
      playPauseBtn,
      skipBackBtn,
      skipForwardBtn,
      scrubber,
      progress,
      buffered,
      timeDisplay,
      volumeBtn,
      volumeSlider,
      navigateBackBtn,
      closeBtn: closeFloatBtn,
      controls,
      videoWrapper,
      playerContainer: container
    }, {
      displayVideo: displayVideo,
      duckLevel: stream ? video.volume : null,
      prePopoutAudio: prePopoutAudio
    });

    return { displayVideo: displayVideo, videoWrapper: videoWrapper };
  }

  // Wire up player controls
  function wireUpControls(popup, video, videoId, elements, opts) {
    opts = opts || {};
    const displayVideo = opts.displayVideo;
    const duckLevel = opts.duckLevel;
    const prePopoutAudio = opts.prePopoutAudio || { volume: video.volume, muted: video.muted };
    const volumeTarget = displayVideo || video;
    let logicalVolume = prePopoutAudio.volume;
    const uiVideo = displayVideo || video;
    const doc = popup.document;
    let isScrubbing = false;

    function persistIntegratedAudioState() {
      const ent = activePopouts.get(videoId);
      if (!ent) {
        return;
      }
      try {
        if (duckLevel != null) {
          ent.integratedVolume = logicalVolume;
          ent.integratedMuted = !!volumeTarget.muted;
        } else {
          ent.integratedVolume = video.volume;
          ent.integratedMuted = !!video.muted;
        }
      } catch (e) {
        /* ignore */
      }
    }

    // captureStream mirror: UI time comes from the source, but the popout <video> must be playing or frames freeze.
    let mirrorSyncIntervalId = 0;
    if (displayVideo) {
      function syncMirrorPlayback() {
        if (!displayVideo.srcObject) {
          return;
        }
        if (video.paused) {
          displayVideo.pause();
          return;
        }
        if (displayVideo.paused) {
          try {
            displayVideo.muted = false;
          } catch (e) {
            /* ignore */
          }
          const p = displayVideo.play();
          if (p && typeof p.catch === 'function') {
            p.catch(function () {});
          }
        }
      }
      video.addEventListener('play', syncMirrorPlayback);
      video.addEventListener('playing', syncMirrorPlayback);
      video.addEventListener('pause', syncMirrorPlayback);
      video.addEventListener('seeked', syncMirrorPlayback);
      video.addEventListener('ratechange', syncMirrorPlayback);
      syncMirrorPlayback();
      mirrorSyncIntervalId = window.setInterval(syncMirrorPlayback, 80);
      function clearMirrorSync() {
        if (!mirrorSyncIntervalId) {
          return;
        }
        window.clearInterval(mirrorSyncIntervalId);
        mirrorSyncIntervalId = 0;
      }
      popup.addEventListener('pagehide', clearMirrorSync, { once: true });
      popup.addEventListener('beforeunload', clearMirrorSync, { once: true });
    }

    function durationLabel() {
      const d = video.duration;
      if (isFinite(d) && d > 0) {
        return formatTime(d);
      }
      if (video.seekable && video.seekable.length > 0) {
        try {
          const end = video.seekable.end(video.seekable.length - 1);
          if (isFinite(end) && end > 0) {
            return formatTime(end);
          }
        } catch (e) {
          /* ignore */
        }
      }
      return '--:--';
    }

    function refreshTimeUi() {
      const cur = formatTime(video.currentTime || 0);
      elements.timeDisplay.textContent = `${cur} / ${durationLabel()}`;
      if (isScrubbing) {
        return;
      }
      const d = video.duration;
      if (isFinite(d) && d > 0) {
        const percent = (video.currentTime / d) * 1000;
        elements.scrubber.value = String(Math.min(1000, Math.max(0, percent)));
        elements.progress.style.width = `${percent / 10}%`;
      }
    }

    function togglePlayback() {
      const pop = activePopouts.get(videoId);
      if (video.paused) {
        if (pop) {
          pop.keepPlayingIntent = true;
        }
        const p = video.play();
        if (p && typeof p.catch === 'function') {
          p.catch(function () {
            /* autoplay / decode */
          });
        }
      } else {
        if (pop) {
          pop.keepPlayingIntent = false;
        }
        video.pause();
      }
    }

    // pointerdown reaches the video sooner than click; helps user-activation in the popout window
    elements.playPauseBtn.addEventListener(
      'pointerdown',
      function (e) {
        e.preventDefault();
        e.stopPropagation();
        togglePlayback();
      },
      true
    );

    uiVideo.addEventListener('click', function (e) {
      e.preventDefault();
      togglePlayback();
    });

    video.addEventListener('play', () => {
      elements.playPauseBtn.innerHTML = ICONS.pause;
    });

    video.addEventListener('pause', () => {
      elements.playPauseBtn.innerHTML = ICONS.play;
    });

    // Skip back/forward
    elements.skipBackBtn.addEventListener('click', () => {
      video.currentTime = Math.max(0, video.currentTime - 10);
    });

    elements.skipForwardBtn.addEventListener('click', () => {
      let cap = 0;
      if (isFinite(video.duration) && video.duration > 0) {
        cap = video.duration;
      } else if (video.seekable && video.seekable.length > 0) {
        try {
          cap = video.seekable.end(video.seekable.length - 1);
        } catch (e) {
          /* ignore */
        }
      }
      video.currentTime = Math.min(cap || 0, video.currentTime + 10);
    });

    // Scrubber
    elements.scrubber.addEventListener('input', () => {
      isScrubbing = true;
      const d = video.duration;
      if (!isFinite(d) || d <= 0) {
        return;
      }
      const time = (elements.scrubber.value / 1000) * d;
      elements.progress.style.width = `${elements.scrubber.value / 10}%`;
      elements.timeDisplay.textContent = `${formatTime(time)} / ${formatTime(d)}`;
    });

    elements.scrubber.addEventListener('change', () => {
      const d = video.duration;
      if (isFinite(d) && d > 0) {
        const time = (elements.scrubber.value / 1000) * d;
        video.currentTime = time;
      }
      isScrubbing = false;
      refreshTimeUi();
    });

    // Time update
    video.addEventListener('timeupdate', refreshTimeUi);

    video.addEventListener('loadedmetadata', refreshTimeUi);
    video.addEventListener('durationchange', refreshTimeUi);

    // Buffered update
    video.addEventListener('progress', () => {
      refreshTimeUi();
      const d = video.duration;
      if (video.buffered.length > 0 && isFinite(d) && d > 0) {
        const bufferedEnd = video.buffered.end(video.buffered.length - 1);
        const percent = (bufferedEnd / d) * 100;
        elements.buffered.style.width = `${percent}%`;
      }
    });

    // Volume: stream mirror uses displayVideo gain; logical 0–1 matches the in-page slider before popout.
    function applyStreamMirrorVolume() {
      if (duckLevel == null) {
        return;
      }
      if (volumeTarget.muted) {
        return;
      }
      try {
        volumeTarget.volume = Math.min(1, logicalVolume / Math.max(duckLevel, 1e-6));
      } catch (e) {
        /* ignore */
      }
    }

    function refreshVolumeUi() {
      const silent =
        volumeTarget.muted ||
        (duckLevel != null ? logicalVolume < 0.001 : volumeTarget.volume < 0.001);
      elements.volumeBtn.innerHTML = silent ? ICONS.volumeMute : ICONS.volumeUp;
      if (!volumeTarget.muted) {
        if (duckLevel != null) {
          elements.volumeSlider.value = String(Math.round(logicalVolume * 100));
        } else {
          elements.volumeSlider.value = String(Math.round(volumeTarget.volume * 100));
        }
      }
    }

    elements.volumeBtn.addEventListener('click', () => {
      if (duckLevel != null) {
        volumeTarget.muted = !volumeTarget.muted;
        if (!volumeTarget.muted) {
          applyStreamMirrorVolume();
        }
      } else {
        video.muted = !video.muted;
      }
      refreshVolumeUi();
      persistIntegratedAudioState();
    });

    elements.volumeSlider.addEventListener('input', () => {
      logicalVolume = elements.volumeSlider.value / 100;
      if (duckLevel != null) {
        volumeTarget.muted = false;
        applyStreamMirrorVolume();
      } else {
        video.volume = logicalVolume;
        video.muted = false;
      }
      refreshVolumeUi();
      persistIntegratedAudioState();
    });

    volumeTarget.addEventListener('volumechange', function () {
      refreshVolumeUi();
      persistIntegratedAudioState();
    });

    // Navigate back: activate the source tab (not only its window) and scroll to the video / placeholder.
    elements.navigateBackBtn.addEventListener('click', () => {
      focusSourceTabAndScrollToVideo(videoId);
    });

    // Close
    elements.closeBtn.addEventListener('click', () => {
      popup.close();
    });

    // Fullscreen hides the OS/browser window frame when the browser allows it. Document PiP windows often reject
    // this (security); classic `window.open` popups usually allow it — use F or double-click the video area.
    function togglePopoutFullscreen() {
      const doc = popup.document;
      const root = doc.documentElement;
      const fsEl = doc.fullscreenElement || doc.webkitFullscreenElement;
      try {
        if (fsEl) {
          if (doc.exitFullscreen) {
            doc.exitFullscreen();
          } else if (doc.webkitExitFullscreen) {
            doc.webkitExitFullscreen();
          }
        } else {
          const req = root.requestFullscreen || root.webkitRequestFullscreen;
          if (req) {
            req.call(root, { navigationUI: 'hide' });
          }
        }
      } catch (err) {
        /* PiP or policy may block fullscreen */
      }
    }

    elements.videoWrapper.addEventListener(
      'dblclick',
      function (e) {
        if (e.target.closest('button') || e.target.closest('input')) {
          return;
        }
        e.preventDefault();
        togglePopoutFullscreen();
      },
      true
    );

    // Keyboard shortcuts (click the popout once so it has focus for keys)
    function onKeydown(e) {
      if (e.target.tagName === 'INPUT') return;

      switch (e.key) {
        case 'Escape': {
          e.preventDefault();
          const doc = popup.document;
          if (doc.fullscreenElement || doc.webkitFullscreenElement) {
            if (doc.exitFullscreen) {
              doc.exitFullscreen();
            } else if (doc.webkitExitFullscreen) {
              doc.webkitExitFullscreen();
            }
          } else {
            popup.close();
          }
          break;
        }
        case 'f':
        case 'F':
          e.preventDefault();
          togglePopoutFullscreen();
          break;
        case ' ':
        case 'k':
        case 'K':
          e.preventDefault();
          togglePlayback();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          video.currentTime = Math.max(0, video.currentTime - 10);
          break;
        case 'ArrowRight':
          e.preventDefault();
          {
            const cap =
              isFinite(video.duration) && video.duration > 0
                ? video.duration
                : video.seekable.length > 0
                  ? video.seekable.end(video.seekable.length - 1)
                  : 0;
            video.currentTime = Math.min(cap || 0, video.currentTime + 10);
          }
          break;
        case 'ArrowUp':
          e.preventDefault();
          if (duckLevel != null) {
            logicalVolume = Math.min(1, logicalVolume + 0.1);
            volumeTarget.muted = false;
            applyStreamMirrorVolume();
          } else {
            video.volume = Math.min(1, video.volume + 0.1);
            video.muted = false;
          }
          refreshVolumeUi();
          persistIntegratedAudioState();
          break;
        case 'ArrowDown':
          e.preventDefault();
          if (duckLevel != null) {
            logicalVolume = Math.max(0, logicalVolume - 0.1);
            applyStreamMirrorVolume();
          } else {
            video.volume = Math.max(0, video.volume - 0.1);
          }
          refreshVolumeUi();
          persistIntegratedAudioState();
          break;
        case 'm':
        case 'M':
          e.preventDefault();
          if (duckLevel != null) {
            volumeTarget.muted = !volumeTarget.muted;
            if (!volumeTarget.muted) {
              applyStreamMirrorVolume();
            }
          } else {
            video.muted = !video.muted;
          }
          refreshVolumeUi();
          persistIntegratedAudioState();
          break;
      }
    }

    popup.addEventListener('keydown', onKeydown);

    // Controls only while hovering the player; hide immediately on mouseleave (no timer).
    // Touch / coarse pointer: leave controls visible (no hover).
    const playerRoot = elements.playerContainer || elements.videoWrapper;
    function showControlsForHover() {
      elements.controls.classList.remove('hidden');
    }
    function hideControlsForHover() {
      elements.controls.classList.add('hidden');
    }
    let useHoverOnlyControls = false;
    try {
      useHoverOnlyControls = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    } catch (e) {
      useHoverOnlyControls = false;
    }
    if (useHoverOnlyControls) {
      elements.controls.classList.add('hidden');
      playerRoot.addEventListener('mouseenter', showControlsForHover);
      playerRoot.addEventListener('mouseleave', hideControlsForHover);
    }

    refreshTimeUi();
    refreshVolumeUi();

    // Do not call popup.focus() — let the window behave like a normal one (no forced raise)

    // Document PiP often skips beforeunload; pagehide + opener-side poll (installPopoutCloseWatcher) cover close.
    function onPopoutWindowGoingAway() {
      restoreVideo(videoId);
    }
    popup.addEventListener('pagehide', onPopoutWindowGoingAway);
    popup.addEventListener('beforeunload', onPopoutWindowGoingAway);

    // Clean up transitioning flag
    video._transitioning = false;

    persistIntegratedAudioState();
  }

  // Stream mode: cover the whole player chrome (e.g. YouTube #movie_player), not just <video> — the <video> box
  // can be shorter than the visible frame, which left a strip of playing video above the overlay.
  function getPlaceholderCoverRect(video) {
    const pad = 8;
    let el = null;
    if (isYoutubeHost()) {
      el = video.closest('#movie_player');
    }
    if (!el) {
      el = video.closest('.html5-video-container');
    }
    if (!el) {
      el = video.closest('[class*="ytp-player"]');
    }
    if (!el) {
      el = video;
    }
    let r = el.getBoundingClientRect();
    if (r.width < 20 || r.height < 20) {
      r = video.getBoundingClientRect();
    }
    return {
      left: r.left - pad,
      top: r.top - pad,
      width: r.width + pad * 2,
      height: r.height + pad * 2
    };
  }

  function applyPlaceholderRect(placeholder, rect) {
    placeholder.style.left = rect.left + 'px';
    placeholder.style.top = rect.top + 'px';
    placeholder.style.width = rect.width + 'px';
    placeholder.style.height = rect.height + 'px';
  }

  function setupStreamPlaceholderPositionSync(placeholder, video) {
    let raf = 0;
    function scheduleSync() {
      if (raf) {
        return;
      }
      raf = requestAnimationFrame(function () {
        raf = 0;
        if (!placeholder.isConnected || !video.isConnected) {
          return;
        }
        applyPlaceholderRect(placeholder, getPlaceholderCoverRect(video));
      });
    }
    window.addEventListener('scroll', scheduleSync, true);
    window.addEventListener('resize', scheduleSync);
    const coverEl = video.closest('#movie_player') || video;
    let ro = null;
    if (typeof ResizeObserver !== 'undefined' && coverEl) {
      ro = new ResizeObserver(scheduleSync);
      try {
        ro.observe(coverEl);
      } catch (e) {
        /* ignore */
      }
    }
    placeholder._ppCleanup = function () {
      window.removeEventListener('scroll', scheduleSync, true);
      window.removeEventListener('resize', scheduleSync);
      if (ro) {
        try {
          ro.disconnect();
        } catch (e2) {
          /* ignore */
        }
      }
    };
    scheduleSync();
  }

  // Create placeholder in original position (stream mode: fixed overlay — source video stays in the DOM)
  function createPlaceholder(video, restoreInfo, videoId, streamMode) {
    const placeholder = document.createElement('div');
    placeholder.className = 'popout-placeholder';
    placeholder.dataset.videoId = String(videoId);

    const rect = streamMode ? getPlaceholderCoverRect(video) : video.getBoundingClientRect();
    if (streamMode) {
      placeholder.style.cssText = `
        position: fixed;
        left: ${rect.left}px;
        top: ${rect.top}px;
        width: ${rect.width}px;
        height: ${rect.height}px;
        background: #000;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        color: white;
        font-family: system-ui, -apple-system, sans-serif;
        border-radius: 8px;
        gap: 12px;
        z-index: 2147483647;
        box-sizing: border-box;
        pointer-events: auto;
        isolation: isolate;
      `;
      setupStreamPlaceholderPositionSync(placeholder, video);
    } else {
      placeholder.style.cssText = `
        width: ${rect.width}px;
        height: ${rect.height}px;
        background: #000;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        color: white;
        font-family: system-ui, -apple-system, sans-serif;
        border-radius: inherit;
        gap: 12px;
      `;
    }

    const message = document.createElement('div');
    message.textContent = 'Playing in popout window';
    message.style.cssText = 'font-size: 16px;';
    placeholder.appendChild(message);

    const returnBtn = document.createElement('button');
    returnBtn.textContent = 'Return video here';
    returnBtn.style.cssText = `
      padding: 8px 16px;
      background: rgba(255, 255, 255, 0.2);
      border: 1px solid rgba(255, 255, 255, 0.4);
      color: white;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
    `;
    returnBtn.addEventListener('mouseenter', () => {
      returnBtn.style.background = 'rgba(255, 255, 255, 0.3)';
    });
    returnBtn.addEventListener('mouseleave', () => {
      returnBtn.style.background = 'rgba(255, 255, 255, 0.2)';
    });
    returnBtn.addEventListener('click', () => {
      const popoutInfo = activePopouts.get(videoId);
      if (popoutInfo && popoutInfo.popup && !popoutInfo.popup.closed) {
        popoutInfo.popup.close();
      }
    });
    placeholder.appendChild(returnBtn);

    if (streamMode) {
      document.body.appendChild(placeholder);
    } else if (restoreInfo.nextSibling) {
      restoreInfo.parent.insertBefore(placeholder, restoreInfo.nextSibling);
    } else {
      restoreInfo.parent.appendChild(placeholder);
    }
  }

  function cleanupStreamMirror(popoutInfo) {
    if (popoutInfo.displayVideo) {
      try {
        popoutInfo.displayVideo.pause();
        popoutInfo.displayVideo.srcObject = null;
      } catch (e) {
        /* ignore */
      }
    }
    if (popoutInfo.stream) {
      try {
        popoutInfo.stream.getTracks().forEach(function (t) {
          t.stop();
        });
      } catch (e2) {
        /* ignore */
      }
    }
  }

  // Restore video to original position
  function restoreVideo(videoId) {
    const popoutInfo = activePopouts.get(videoId);
    if (!popoutInfo) return;

    clearPopoutCloseWatcher(popoutInfo);

    if (typeof popoutInfo.releasePlaybackHold === 'function') {
      popoutInfo.releasePlaybackHold();
    }

    const { video, restoreInfo } = popoutInfo;
    const mode = popoutInfo.mode || 'moved';

    let shouldResume = !video.paused;
    if (popoutInfo.keepPlayingIntent === false) {
      shouldResume = false;
    } else if (popoutInfo.keepPlayingIntent === true) {
      shouldResume = true;
    }

    const placeholder = document.querySelector(`[data-video-id="${videoId}"]`);

    if (mode === 'stream') {
      cleanupStreamMirror(popoutInfo);
      if (placeholder && placeholder.isConnected) {
        if (typeof placeholder._ppCleanup === 'function') {
          placeholder._ppCleanup();
        }
        placeholder.remove();
      }
      try {
        const iv = popoutInfo.integratedVolume;
        const im = popoutInfo.integratedMuted;
        if (typeof iv === 'number' && isFinite(iv)) {
          video.volume = Math.min(1, Math.max(0, iv));
        } else {
          video.volume = popoutInfo.savedVolume;
        }
        video.muted = typeof im === 'boolean' ? im : popoutInfo.savedMuted;
      } catch (e) {
        /* ignore */
      }
      if (restoreInfo.style) {
        video.setAttribute('style', restoreInfo.style);
      } else {
        video.removeAttribute('style');
      }
      video._transitioning = false;
      activePopouts.delete(videoId);
      resumePlaybackAfterPopout(video, shouldResume);
      return;
    }

    if (!restoreInfo.parent.isConnected) {
      console.warn('PopoutPlayer: Original parent no longer exists');
      activePopouts.delete(videoId);
      return;
    }

    // Levels from popout session (persisted on every control change) — re-apply after DOM move.
    let liveVolume = 1;
    let liveMuted = false;
    try {
      liveVolume = video.volume;
      liveMuted = video.muted;
    } catch (e) {
      /* ignore */
    }
    const outVol =
      typeof popoutInfo.integratedVolume === 'number' && isFinite(popoutInfo.integratedVolume)
        ? Math.min(1, Math.max(0, popoutInfo.integratedVolume))
        : liveVolume;
    const outMuted =
      typeof popoutInfo.integratedMuted === 'boolean' ? popoutInfo.integratedMuted : liveMuted;

    if (placeholder && placeholder.isConnected) {
      restoreInfo.parent.insertBefore(video, placeholder);
      placeholder.remove();
    } else if (restoreInfo.nextSibling && restoreInfo.nextSibling.isConnected) {
      restoreInfo.parent.insertBefore(video, restoreInfo.nextSibling);
    } else {
      restoreInfo.parent.appendChild(video);
    }

    if (restoreInfo.style) {
      video.setAttribute('style', restoreInfo.style);
    } else {
      video.removeAttribute('style');
    }

    try {
      video.volume = outVol;
      video.muted = outMuted;
    } catch (e) {
      /* ignore */
    }

    video._transitioning = false;
    activePopouts.delete(videoId);
    resumePlaybackAfterPopout(video, shouldResume);
  }

  function showPopoutHint(text) {
    const banner = document.createElement('div');
    banner.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      max-width: 520px;
      background: #1565c0;
      color: white;
      padding: 14px 20px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      z-index: 2147483647;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 14px;
      line-height: 1.4;
      display: flex;
      gap: 12px;
      align-items: flex-start;
    `;
    const message = document.createElement('span');
    message.textContent = text;
    banner.appendChild(message);
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '×';
    closeBtn.setAttribute('aria-label', 'Dismiss');
    closeBtn.style.cssText = `
      flex-shrink: 0;
      background: none;
      border: none;
      color: white;
      font-size: 22px;
      cursor: pointer;
      line-height: 1;
      padding: 0 4px;
    `;
    closeBtn.addEventListener('click', function () {
      banner.remove();
    });
    banner.appendChild(closeBtn);
    document.body.appendChild(banner);
    setTimeout(function () {
      banner.remove();
    }, 14000);
  }

  // Show popup blocked banner
  function showPopupBlockedBanner(video) {
    const banner = document.createElement('div');
    banner.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: #d32f2f;
      color: white;
      padding: 16px 24px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      z-index: 2147483647;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 14px;
      display: flex;
      gap: 16px;
      align-items: center;
    `;

    const message = document.createElement('span');
    message.textContent = 'Popup blocked! Please allow popups for this site.';
    banner.appendChild(message);

    const fallbackBtn = document.createElement('button');
    fallbackBtn.textContent = 'Try native PiP';
    fallbackBtn.style.cssText = `
      padding: 6px 12px;
      background: rgba(255, 255, 255, 0.2);
      border: 1px solid rgba(255, 255, 255, 0.4);
      color: white;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
    `;
    fallbackBtn.addEventListener('click', async () => {
      try {
        if (document.pictureInPictureEnabled && !video.disablePictureInPicture) {
          await video.requestPictureInPicture();
          banner.remove();
        }
      } catch (error) {
        console.error('PiP fallback failed:', error);
      }
    });
    banner.appendChild(fallbackBtn);

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '×';
    closeBtn.style.cssText = `
      background: none;
      border: none;
      color: white;
      font-size: 24px;
      cursor: pointer;
      padding: 0;
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
    `;
    closeBtn.addEventListener('click', () => banner.remove());
    banner.appendChild(closeBtn);

    document.body.appendChild(banner);

    setTimeout(() => banner.remove(), 10000);
  }

  // Legacy: same-tab postMessage path (Navigate Back now calls focusSourceTabAndScrollToVideo directly).
  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'popout-navigate-back' && event.data.videoId != null) {
      focusSourceTabAndScrollToVideo(event.data.videoId);
    }
  });

  // Handle messages from background script (toolbar). Only the top frame: with all_frames, every iframe
  // would otherwise handle the same message → duplicate PiP / popout races.
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type !== 'popout-largest-video') {
      return;
    }
    if (window.self !== window.top) {
      return;
    }

    const videos = findAllVideos();
    const eligibleVideos = videos.filter(isVideoEligible);

    if (eligibleVideos.length === 0) {
      console.log('PopoutPlayer: No eligible videos found');
      return;
    }

    const best = pickBestVideo(eligibleVideos);
    if (best) {
      let preOpened = null;
      if (message.toolbarPopupName) {
        try {
          preOpened = window[message.toolbarPopupName];
          if (!preOpened || preOpened.closed) {
            preOpened = window.frames[message.toolbarPopupName];
          }
        } catch (e) {
          preOpened = null;
        }
        if (preOpened && preOpened.closed) {
          preOpened = null;
        }
      }
      popoutVideo(best, null, preOpened);
    }
  });

  // Initial detection
  function initialize() {
    const videos = findAllVideos();
    videos.forEach(processVideo);

    // Watch for new videos
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.tagName === 'VIDEO') {
              processVideo(node);
            } else {
              const videos = findAllVideos(node);
              videos.forEach(processVideo);
            }
          }
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
  } else {
    initialize();
  }

})();
