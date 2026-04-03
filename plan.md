# PopoutPlayer - Chrome Extension Plan

## Context

Build a Chrome extension from scratch that replicates Firefox's Picture-in-Picture feature: hover over any video, click an overlay icon, and it pops out into a separate floating window with full custom controls. Key requirements:
- **Unlimited simultaneous popup windows** (no per-tab or per-session limits)
- Controls: play/pause, scrub/seek bar, volume, skip forward/back (+/-10s)
- "Navigate back" button on each popup that returns to and scrolls to the source video on the original page
- Detect videos on any page including dynamically loaded and shadow DOM videos

## Architecture Decision

**`window.open()` + move video element** is the core strategy.

- Chrome's Document Picture-in-Picture API is limited to 1 window per tab (browser-enforced). Doesn't meet the "unlimited windows" requirement.
- `window.open('about:blank')` from a click handler creates a same-origin window. We can physically **move the `<video>` DOM element** into it via `adoptNode`, preserving MediaSource/MSE connections (same mechanism Document PiP uses internally). This gives unlimited windows and works with YouTube, Twitch, etc.
- Not always-on-top (only Document PiP gets that), but that's the tradeoff for unlimited windows.
- If popup is blocked: show a fallback message + offer native `requestPictureInPicture()` as a degraded fallback.

## File Structure

```
PopoutPlayer/
  manifest.json              # MV3 manifest
  background.js              # Service worker (minimal - extension icon handler)
  content/
    content.js               # Main orchestrator: detection, overlay, popout
    content.css              # Overlay icon styles (injected into shadow DOM)
  player/
    player.css               # Popup window player styles
  icons/
    icon16.png
    icon48.png
    icon128.png
```

Flat and minimal. No build tools, no frameworks - vanilla JS/CSS. All logic lives in `content.js` since the popup window is same-origin and controlled directly from the content script.

## Implementation Plan

### Phase 1: Skeleton (end-to-end popout working)

**1. `manifest.json`**
```json
{
  "manifest_version": 3,
  "name": "PopoutPlayer",
  "version": "1.0.0",
  "description": "Pop out any video into its own window",
  "permissions": ["activeTab"],
  "background": { "service_worker": "background.js" },
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["content/content.js"],
    "run_at": "document_idle",
    "all_frames": true
  }],
  "web_accessible_resources": [{
    "resources": ["player/player.css", "icons/*"],
    "matches": ["<all_urls>"]
  }],
  "icons": { "16": "icons/icon16.png", "48": "icons/icon48.png", "128": "icons/icon128.png" }
}
```

**2. `content/content.js` - Video Detection**
- `querySelectorAll('video')` on load
- `MutationObserver` watching `childList` + `subtree` for dynamically added videos
- Recursive shadow DOM traversal (walk all elements, check `.shadowRoot`)
- Filter out tiny videos (<150x100) and hidden videos
- `WeakSet` to track already-processed videos

**3. `content/content.js` - Overlay Icon**
- For each detected video, create a host element with **closed shadow DOM** (isolates our styles from page CSS)
- Icon positioned with `position: fixed` using `getBoundingClientRect()` (non-invasive, doesn't wrap the video element)
- Show on video `mouseenter`, hide on `mouseleave` (with grace period so mouse can reach the icon)
- `IntersectionObserver` to only track position when video is visible
- PiP icon SVG inlined in JS (no external fetch needed)

**4. `content/content.js` - Popout Flow**
```
Click handler (user gesture context):
  1. Record video's parentElement, nextElementSibling, computed styles, scroll position
  2. window.open('about:blank', '', 'popup,width=W,height=H') → popupWindow
  3. If blocked → show fallback banner, try video.requestPictureInPicture()
  4. Build player UI in popupWindow.document
  5. Load player.css via <link href="chrome.runtime.getURL('player/player.css')">
  6. popupWindow.document.body.appendChild(video) → moves video element
  7. Insert placeholder at original position
  8. Wire controls to the (now moved) video element
  9. Handle popupWindow 'beforeunload' → restore video to original position
```

### Phase 2: Full Player Controls

**5. Player UI (built programmatically in popup window)**

Layout:
```
+------------------------------------------+
|                                          |
|            <video> element               |
|          (object-fit: contain)           |
|                                          |
+--[=====progress/scrub bar============]--+
| [<<] [>||] [>>]  1:23 / 5:45     🔊---|  [Navigate Back] [x]
+------------------------------------------+
```

Controls (all operating directly on the video element in the popup):
- **Play/Pause**: `video.play()` / `video.pause()`, icon toggles, listens to `play`/`pause` events
- **Scrub bar**: `<input type="range">` with 1000 steps for fine granularity. Layered with buffered range indicator and progress bar. `input` event for preview, `change` event for seek.
- **Time display**: `formatTime(currentTime) / formatTime(duration)` updated on `timeupdate`
- **Volume**: Mute toggle button + `<input type="range">` slider. Listens to `volumechange`.
- **Skip fwd/back**: `video.currentTime += 10` / `-= 10`, clamped to [0, duration]
- **Navigate Back button**: `window.opener.postMessage({ type: 'popout-navigate-back', id }, '*')` → content script receives, scrolls placeholder into view with `scrollIntoView({ behavior: 'smooth', block: 'center' })`, focuses opener window
- **Close button**: triggers restore flow

**6. Keyboard shortcuts in popup window**
- Space/K: play/pause
- Arrow Left/Right: skip -/+10s
- Arrow Up/Down: volume +/-10%
- M: mute toggle

**7. Controls auto-hide**
- Controls overlay the bottom of the video (absolute positioned, gradient background)
- Hide after 3s of no mouse movement
- Show on mouse move or video pause
- CSS transitions for fade in/out

### Phase 3: Polish & Edge Cases

**8. Placeholder in original page**
- Black box matching original video dimensions (copies computed width/height/aspectRatio/borderRadius)
- "Playing in popout window" text + "Return video here" button
- Clicking return button sends message to popup to close and restore

**9. Video restore flow**
- On popup close (`beforeunload`): move video back before original placeholder, remove placeholder, restore original inline styles
- Guard: check `placeholder.isConnected` and `originalParent.isConnected` before restoring

**10. Navigate back feature**
- Each popup stores: opener window reference, a unique ID
- Content script listens for `message` events with type `popout-navigate-back`
- On receive: `placeholder.scrollIntoView({ behavior: 'smooth', block: 'center' })`
- Popup calls `window.opener.focus()` to bring the tab to front

**11. Edge cases**
- **Popup blocked**: Detect (`window.open` returns `null`), show banner on page, offer `video.requestPictureInPicture()` fallback
- **Page navigation while popup open**: `beforeunload` on opener → popup shows "Source page closed" state, video may stop but popup stays open
- **Video source change (quality switch, next episode)**: Video element handles this internally; listen for `emptied` event to reset scrub bar
- **Race condition**: Boolean guard `_transitioning` to prevent double-click creating two popups
- **Iframe videos**: `all_frames: true` means content script runs in same-origin iframes. Each frame's content script handles its own videos independently.
- **Cross-origin iframes**: Cannot access (YouTube embeds, Vimeo). Documented limitation for v1. The extension works when you're ON youtube.com directly, just not embedded players.

**12. `background.js` (minimal)**
- Listen for extension icon click → send message to active tab's content script to pop out the largest visible video
- Future: could add context menu "Pop out this video"

### Phase 4: Icons & Assets

**13. Extension icons** - Generate simple PNG icons (16x16, 48x48, 128x128) with a PiP-style design
**14. Overlay icon** - Inline SVG in content.js (PiP window icon)
**15. Control icons** - Inline SVGs for play, pause, skip fwd/back, volume states, close, navigate-back

## Key Files to Create
1. `manifest.json` - Extension manifest
2. `background.js` - Service worker
3. `content/content.js` - All content script logic (~400-500 lines)
4. `player/player.css` - Popup player styles (~150 lines)
5. `icons/` - PNG icons (generated)

## Verification
1. Load unpacked extension in `chrome://extensions`
2. Navigate to a page with a `<video>` element (e.g., any HTML5 video test page)
3. Hover over video → overlay icon appears in top-right corner
4. Click icon → video pops out into separate window with controls
5. Test all controls: play/pause, scrub, volume, skip, time display
6. Click "Navigate Back" → original tab comes to front, scrolls to placeholder
7. Close popup → video returns to original position on page
8. Test with multiple videos / multiple popups simultaneously
9. Test on YouTube (direct, not embedded) to verify MSE video moves correctly
10. Test keyboard shortcuts in popup window
