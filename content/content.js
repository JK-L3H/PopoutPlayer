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

  // Utility: Check if video is visible and large enough
  function isVideoEligible(video) {
    const rect = video.getBoundingClientRect();
    const style = window.getComputedStyle(video);

    // Filter out tiny videos and hidden videos
    if (rect.width < 150 || rect.height < 100) return false;
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (video.offsetParent === null) return false;

    return true;
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
    button.title = 'Pop out video';
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

    // Click handler
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      popoutVideo(video);
    });

    // Append to page
    document.body.appendChild(host);

    // Store reference
    videoOverlays.set(video, { host, observer, show, hide });
  }

  // Main popout function
  function popoutVideo(video) {
    // Prevent double-click
    if (video._transitioning) return;
    video._transitioning = true;

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

      // Calculate popup size
      const rect = video.getBoundingClientRect();
      const width = Math.max(640, Math.min(rect.width, 1280));
      const height = Math.max(360, Math.min(rect.height + 60, 800)); // +60 for controls

      // Open popup window
      const popup = window.open(
        'about:blank',
        `popout-player-${videoId}`,
        `popup,width=${width},height=${height},resizable=yes`
      );

      // Check if popup was blocked
      if (!popup || popup.closed || typeof popup.closed === 'undefined') {
        showPopupBlockedBanner(video);
        video._transitioning = false;
        return;
      }

      // Build player UI in popup
      buildPlayerUI(popup, video, videoId, restoreInfo);

      // Store active popout
      activePopouts.set(videoId, { popup, restoreInfo, video });

      // Create placeholder in original position
      createPlaceholder(video, restoreInfo, videoId);

    } catch (error) {
      console.error('PopoutPlayer: Failed to create popout', error);
      video._transitioning = false;
    }
  }

  // Build player UI in popup window
  function buildPlayerUI(popup, video, videoId, restoreInfo) {
    const doc = popup.document;

    // Set up document
    doc.title = 'PopoutPlayer';

    // Load styles
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('player/player.css');
    doc.head.appendChild(link);

    // Create container
    const container = doc.createElement('div');
    container.className = 'player-container';

    // Video wrapper
    const videoWrapper = doc.createElement('div');
    videoWrapper.className = 'video-wrapper';

    // Move video element into popup
    videoWrapper.appendChild(video);
    container.appendChild(videoWrapper);

    // Controls container
    const controls = doc.createElement('div');
    controls.className = 'controls';

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

    // Play/Pause
    elements.playPauseBtn.addEventListener('click', () => {
      if (video.paused) {
        video.play();
      } else {
        video.pause();
      }
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
      video.currentTime = Math.min(video.duration || 0, video.currentTime + 10);
    });

    // Scrubber
    elements.scrubber.addEventListener('input', () => {
      isScrubbing = true;
      const time = (elements.scrubber.value / 1000) * video.duration;
      elements.progress.style.width = `${elements.scrubber.value / 10}%`;
      elements.timeDisplay.textContent = `${formatTime(time)} / ${formatTime(video.duration)}`;
    });

    elements.scrubber.addEventListener('change', () => {
      const time = (elements.scrubber.value / 1000) * video.duration;
      video.currentTime = time;
      isScrubbing = false;
    });

    // Time update
    video.addEventListener('timeupdate', () => {
      if (!isScrubbing && video.duration) {
        const percent = (video.currentTime / video.duration) * 1000;
        elements.scrubber.value = String(percent);
        elements.progress.style.width = `${percent / 10}%`;
        elements.timeDisplay.textContent = `${formatTime(video.currentTime)} / ${formatTime(video.duration)}`;
      }
    });

    // Buffered update
    video.addEventListener('progress', () => {
      if (video.buffered.length > 0 && video.duration) {
        const bufferedEnd = video.buffered.end(video.buffered.length - 1);
        const percent = (bufferedEnd / video.duration) * 100;
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

    // Navigate back
    elements.navigateBackBtn.addEventListener('click', () => {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage({
          type: 'popout-navigate-back',
          videoId: videoId
        }, '*');
        window.opener.focus();
      }
    });

    // Close
    elements.closeBtn.addEventListener('click', () => {
      popup.close();
    });

    // Keyboard shortcuts
    doc.addEventListener('keydown', (e) => {
      // Prevent if typing in an input
      if (e.target.tagName === 'INPUT') return;

      switch (e.key) {
        case ' ':
        case 'k':
        case 'K':
          e.preventDefault();
          if (video.paused) video.play();
          else video.pause();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          video.currentTime = Math.max(0, video.currentTime - 10);
          break;
        case 'ArrowRight':
          e.preventDefault();
          video.currentTime = Math.min(video.duration || 0, video.currentTime + 10);
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
    });

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

  // Handle messages from background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'popout-largest-video') {
      const videos = findAllVideos();
      const eligibleVideos = videos.filter(isVideoEligible);

      if (eligibleVideos.length === 0) {
        console.log('PopoutPlayer: No eligible videos found');
        return;
      }

      // Find largest video by area
      const largest = eligibleVideos.reduce((prev, curr) => {
        const prevRect = prev.getBoundingClientRect();
        const currRect = curr.getBoundingClientRect();
        const prevArea = prevRect.width * prevRect.height;
        const currArea = currRect.width * currRect.height;
        return currArea > prevArea ? curr : prev;
      });

      popoutVideo(largest);
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
