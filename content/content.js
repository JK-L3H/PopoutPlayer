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
    '.player-container{display:flex;flex-direction:column;width:100%;height:100%;min-height:0;position:relative;background:#000}' +
    '.video-wrapper{flex:1 1 auto;min-height:0;display:flex;align-items:center;justify-content:center;background:#000}' +
    '.video-wrapper video{width:100%;height:100%;object-fit:cover;object-position:center}' +
    '.controls{position:absolute;bottom:0;left:0;right:0;padding:20px 16px 12px;z-index:10;background:linear-gradient(to top,rgba(0,0,0,.9),transparent)}' +
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

  // Outer popup size: match media aspect ratio when known (reduces mismatch with object-fit: cover)
  function computePopoutWindowSize(video) {
    const rect = video.getBoundingClientRect();
    const CONTROLS_AND_CHROME = 96;
    const minW = 400;
    const maxW = typeof screen !== 'undefined' ? Math.min(1920, screen.availWidth - 48) : 1280;
    const maxH = typeof screen !== 'undefined' ? Math.min(1200, screen.availHeight - 80) : 900;
    const vw = video.videoWidth;
    const vh = video.videoHeight;

    if (vw > 0 && vh > 0) {
      const ar = vw / vh;
      let w = Math.min(maxW, Math.max(minW, rect.width > 0 ? Math.min(rect.width, 1280) : 960));
      let videoH = w / ar;
      let totalH = videoH + CONTROLS_AND_CHROME;
      if (totalH > maxH) {
        totalH = maxH;
        videoH = Math.max(240, totalH - CONTROLS_AND_CHROME);
        w = Math.max(minW, videoH * ar);
      }
      if (w > maxW) {
        w = maxW;
        videoH = w / ar;
        totalH = videoH + CONTROLS_AND_CHROME;
      }
      return {
        width: Math.round(w),
        height: Math.round(Math.min(maxH, Math.max(320, totalH)))
      };
    }

    const width = Math.max(640, Math.min(rect.width || 800, 1280));
    const height = Math.max(360, Math.min(rect.height + 60, 800));
    return { width: Math.round(width), height: Math.round(height) };
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
      ? 'YouTube: Chrome Picture-in-Picture (one at a time; moving the video here breaks playback). Shift+click: try custom window anyway (often black). Other sites: unlimited custom windows.'
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

    // YouTube: default Chrome PiP (custom window = black). Other sites: unlimited custom windows. Shift inverts.
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

  // youtube.com: moving <video> into about:blank breaks MSE (black screen). Default = Chrome PiP there. Other sites = unlimited custom windows.
  function popoutVideo(video, ev) {
    if (video._transitioning) return;
    video._transitioning = true;
    const shift = ev && ev.shiftKey === true;

    if (isYoutubeHost()) {
      if (shift) {
        openCustomPopoutWindow(video);
      } else {
        // requestPictureInPicture() requires a recent user gesture on the page. Toolbar → sendMessage is async,
        // so the gesture is gone — PiP always fails from the extension icon alone.
        if (!ev) {
          video._transitioning = false;
          showPopoutHint(
            'On YouTube, click the pop-out icon that appears on the video (not the extension toolbar). Chrome only allows Picture-in-Picture after a direct click on the page.'
          );
          return;
        }
        tryNativePictureInPictureFirst(video);
      }
      return;
    }

    if (shift) {
      tryNativePictureInPictureFirst(video);
    } else {
      openCustomPopoutWindow(video);
    }
  }

  function openCustomPopoutWindow(video) {
    let popup = null;
    try {
      const videoId = nextVideoId++;

      // Record restore information
      const restoreInfo = {
        parent: video.parentElement,
        nextSibling: video.nextElementSibling,
        style: video.getAttribute('style') || '',
        scrollY: window.scrollY,
        scrollX: window.scrollX
      };

      const size = computePopoutWindowSize(video);

      // Window names are browser-global: reusing e.g. popout-player-0 replaces an older popout. Always use a unique name.
      const uniqueWinName =
        'pp_' + videoId + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 12);

      // Normal auxiliary window (no `popup` feature — stacks like any other window, not a minimal always-raised chrome)
      popup = window.open(
        'about:blank',
        uniqueWinName,
        `width=${size.width},height=${size.height},resizable=yes,scrollbars=no`
      );

      // Check if popup was blocked
      if (!popup || popup.closed || typeof popup.closed === 'undefined') {
        showPopupBlockedBanner(video);
        video._transitioning = false;
        return;
      }

      // CSP on sites like YouTube blocks <link href="chrome-extension://..."> in child about:blank.
      // Fetch CSS in the extension context, then inject as <style> text (allowed).
      primePopupPaint(popup);
      const cssUrl = safeGetExtensionUrl('player/player.css');
      if (!cssUrl) {
        video._transitioning = false;
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
            video._transitioning = false;
            return;
          }
          runWhenPopupReady(popup, function () {
            try {
              buildPlayerUI(popup, video, videoId, restoreInfo, cssText);
              activePopouts.set(videoId, { popup, restoreInfo, video });
              createPlaceholder(video, restoreInfo, videoId);
            } catch (error) {
              console.error('PopoutPlayer: Failed to create popout', error);
              video._transitioning = false;
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
            video._transitioning = false;
            return;
          }
          runWhenPopupReady(popup, function () {
            try {
              buildPlayerUI(popup, video, videoId, restoreInfo, POPOUT_PLAYER_CSS_FALLBACK);
              activePopouts.set(videoId, { popup, restoreInfo, video });
              createPlaceholder(video, restoreInfo, videoId);
            } catch (error) {
              console.error('PopoutPlayer: Failed to create popout', error);
              video._transitioning = false;
              try {
                popup.close();
              } catch (e) {
                /* ignore */
              }
            }
          });
        });

    } catch (error) {
      if (isExtensionContextInvalidated(error)) {
        video._transitioning = false;
        try {
          if (popup && !popup.closed) {
            popup.close();
          }
        } catch (e) {
          /* ignore */
        }
        showPopoutHint('PopoutPlayer was reloaded or updated. Refresh this page (F5), then try again.');
        return;
      }
      console.error('PopoutPlayer: Failed to create popout', error);
      video._transitioning = false;
    }
  }

  // Build player UI in popup window (cssText from fetch — not <link>, so page CSP cannot block it)
  function buildPlayerUI(popup, video, videoId, restoreInfo, cssText) {
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

    // Move <video> into the popup (appendChild across documents adopts automatically)
    videoWrapper.appendChild(video);
    // YouTube often sets pointer-events:none on the player; controls must receive clicks
    video.style.setProperty('pointer-events', 'auto', 'important');
    video.removeAttribute('inert');
    video.setAttribute('playsinline', '');
    videoWrapper.style.position = 'relative';
    videoWrapper.style.zIndex = '0';

    container.appendChild(videoWrapper);

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
    volumeBtn.innerHTML = video.muted || video.volume === 0 ? ICONS.volumeMute : ICONS.volumeUp;
    volumeBtn.title = 'Mute (M)';
    rightControls.appendChild(volumeBtn);

    const volumeSlider = doc.createElement('input');
    volumeSlider.type = 'range';
    volumeSlider.className = 'volume-slider';
    volumeSlider.min = '0';
    volumeSlider.max = '100';
    volumeSlider.value = String(video.volume * 100);
    rightControls.appendChild(volumeSlider);

    const navigateBackBtn = doc.createElement('button');
    navigateBackBtn.className = 'control-btn navigate-back';
    navigateBackBtn.innerHTML = ICONS.back;
    navigateBackBtn.title = 'Navigate back to source';
    navigateBackBtn.textContent = 'Navigate Back';
    rightControls.appendChild(navigateBackBtn);

    const closeBtn = doc.createElement('button');
    closeBtn.className = 'control-btn close';
    closeBtn.innerHTML = ICONS.close;
    closeBtn.title = 'Close and restore video';
    rightControls.appendChild(closeBtn);

    bottomControls.appendChild(rightControls);
    controls.appendChild(bottomControls);
    container.appendChild(controls);

    doc.body.appendChild(container);

    // Wire up controls
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
      closeBtn,
      controls,
      videoWrapper
    });
  }

  // Wire up player controls
  function wireUpControls(popup, video, videoId, elements) {
    const doc = popup.document;
    let hideControlsTimeout;
    let isScrubbing = false;

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
      if (video.paused) {
        const p = video.play();
        if (p && typeof p.catch === 'function') {
          p.catch(function () {
            /* autoplay / decode */
          });
        }
      } else {
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

    video.addEventListener('click', function (e) {
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

    // Volume
    elements.volumeBtn.addEventListener('click', () => {
      video.muted = !video.muted;
    });

    elements.volumeSlider.addEventListener('input', () => {
      video.volume = elements.volumeSlider.value / 100;
      video.muted = false;
    });

    video.addEventListener('volumechange', () => {
      elements.volumeBtn.innerHTML = video.muted || video.volume === 0 ? ICONS.volumeMute : ICONS.volumeUp;
      if (!video.muted) {
        elements.volumeSlider.value = String(video.volume * 100);
      }
    });

    // Navigate back (must use popup.opener — content script window.opener is not the tab opener)
    elements.navigateBackBtn.addEventListener('click', () => {
      const openerWin = popup.opener;
      if (openerWin && !openerWin.closed) {
        openerWin.postMessage({
          type: 'popout-navigate-back',
          videoId: videoId
        }, '*');
        openerWin.focus();
      }
    });

    // Close
    elements.closeBtn.addEventListener('click', () => {
      popup.close();
    });

    // Keyboard shortcuts (click the popout once so it has focus for keys)
    function onKeydown(e) {
      if (e.target.tagName === 'INPUT') return;

      switch (e.key) {
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
          video.volume = Math.min(1, video.volume + 0.1);
          video.muted = false;
          break;
        case 'ArrowDown':
          e.preventDefault();
          video.volume = Math.max(0, video.volume - 0.1);
          break;
        case 'm':
        case 'M':
          e.preventDefault();
          video.muted = !video.muted;
          break;
      }
    }

    popup.addEventListener('keydown', onKeydown);

    // Auto-hide controls
    function showControls() {
      elements.controls.classList.remove('hidden');
      clearTimeout(hideControlsTimeout);
      hideControlsTimeout = setTimeout(() => {
        if (!video.paused) {
          elements.controls.classList.add('hidden');
        }
      }, 3000);
    }

    elements.videoWrapper.addEventListener('mousemove', showControls);
    elements.videoWrapper.addEventListener('mouseenter', showControls);
    video.addEventListener('pause', showControls);
    video.addEventListener('play', () => {
      hideControlsTimeout = setTimeout(() => {
        elements.controls.classList.add('hidden');
      }, 3000);
    });

    // Initial show
    showControls();

    refreshTimeUi();

    // Do not call popup.focus() — let the window behave like a normal one (no forced raise)

    // Handle popup close - restore video
    popup.addEventListener('beforeunload', () => {
      restoreVideo(videoId);
    });

    // Clean up transitioning flag
    video._transitioning = false;
  }

  // Create placeholder in original position
  function createPlaceholder(video, restoreInfo, videoId) {
    const placeholder = document.createElement('div');
    placeholder.className = 'popout-placeholder';
    placeholder.dataset.videoId = String(videoId);

    // Match video dimensions
    const rect = video.getBoundingClientRect();
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

    // Insert at original position
    if (restoreInfo.nextSibling) {
      restoreInfo.parent.insertBefore(placeholder, restoreInfo.nextSibling);
    } else {
      restoreInfo.parent.appendChild(placeholder);
    }
  }

  // Restore video to original position
  function restoreVideo(videoId) {
    const popoutInfo = activePopouts.get(videoId);
    if (!popoutInfo) return;

    const { video, restoreInfo } = popoutInfo;

    // Find placeholder
    const placeholder = document.querySelector(`[data-video-id="${videoId}"]`);

    // Check if restore location still exists
    if (!restoreInfo.parent.isConnected) {
      console.warn('PopoutPlayer: Original parent no longer exists');
      activePopouts.delete(videoId);
      return;
    }

    // Move video back
    if (placeholder && placeholder.isConnected) {
      restoreInfo.parent.insertBefore(video, placeholder);
      placeholder.remove();
    } else if (restoreInfo.nextSibling && restoreInfo.nextSibling.isConnected) {
      restoreInfo.parent.insertBefore(video, restoreInfo.nextSibling);
    } else {
      restoreInfo.parent.appendChild(video);
    }

    // Restore original styles
    if (restoreInfo.style) {
      video.setAttribute('style', restoreInfo.style);
    } else {
      video.removeAttribute('style');
    }

    // Clean up
    video._transitioning = false;
    activePopouts.delete(videoId);
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

  // Handle navigate back messages
  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'popout-navigate-back') {
      const videoId = event.data.videoId;
      const placeholder = document.querySelector(`[data-video-id="${videoId}"]`);
      if (placeholder) {
        placeholder.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
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
      popoutVideo(best);
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
