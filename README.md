# PopoutPlayer - Chrome Extension

A Chrome extension that replicates Firefox's Picture-in-Picture feature with unlimited simultaneous popout windows.

## Features

✨ **Unlimited Popout Windows** - Pop out as many videos as you want, no limits!
🎮 **Full Controls** - Play/pause, scrubbing, volume, skip forward/back (±10s)
🔙 **Navigate Back** - Return to the source video with one click
🎯 **Smart Detection** - Automatically detects videos on any page, including dynamically loaded content
⌨️ **Keyboard Shortcuts** - Space, arrow keys, and more
🎨 **Auto-hide Controls** - Clean viewing experience with controls that fade away
🌐 **Works Everywhere** - Compatible with YouTube, Twitch, and any HTML5 video

## Installation

1. **Clone or download this repository**

2. **Open Chrome and navigate to** `chrome://extensions/`

3. **Enable "Developer mode"** (toggle in the top-right corner)

4. **Click "Load unpacked"** and select the `PopoutPlayer` folder

5. **The extension is now installed!** You'll see the PopoutPlayer icon in your toolbar

## Usage

### Method 1: Hover & Click
1. Navigate to any webpage with a video
2. Hover over the video
3. Click the PopoutPlayer icon that appears in the top-right corner of the video
4. The video pops out into a separate window with full controls

### Method 2: Extension Icon
1. Navigate to any webpage with videos
2. Click the PopoutPlayer extension icon in your Chrome toolbar
3. The largest visible video will pop out automatically

### Controls

**Player Controls:**
- **Play/Pause** - Click the play button or press `Space` / `K`
- **Skip Back** - Click the back button or press `←` (left arrow) to skip back 10 seconds
- **Skip Forward** - Click the forward button or press `→` (right arrow) to skip forward 10 seconds
- **Volume** - Click the volume icon to mute/unmute, or use the slider. Press `M` to toggle mute
- **Volume Up/Down** - Press `↑` / `↓` (up/down arrows) to adjust volume
- **Scrubbing** - Drag the progress bar or click anywhere on it to seek
- **Navigate Back** - Click to return to and scroll to the source video on the original page
- **Close** - Click the X button to close the popout and return the video to its original position

**Auto-hide Controls:**
- Controls automatically fade out after 3 seconds of inactivity during playback
- Move your mouse to show them again
- Controls stay visible when the video is paused

## How It Works

PopoutPlayer uses `window.open()` to create same-origin popup windows and physically moves the `<video>` DOM element into them using `adoptNode()`. This preserves MediaSource/MSE connections (crucial for YouTube, Twitch, etc.) and allows for unlimited simultaneous popouts.

**Key Technical Details:**
- ✅ Works with complex video players (YouTube, Twitch, Netflix UI)
- ✅ Preserves video state and playback
- ✅ No per-tab or per-session limits
- ✅ Detects videos in shadow DOM
- ✅ Handles dynamically loaded videos
- ⚠️ Not always-on-top (that requires Document Picture-in-Picture API, which is limited to 1 window per tab)
- ⚠️ Popup blockers must be disabled for this site
- ⚠️ Doesn't work with cross-origin iframe embeds (e.g., YouTube embeds on other sites - but works fine on youtube.com directly)

## Edge Cases & Limitations

### Popup Blocked
If your browser blocks the popup, you'll see a banner offering to try the native Picture-in-Picture API as a fallback. To fix this:
1. Allow popups for the site
2. Check your browser's popup blocker settings

### Cross-Origin Iframes
Videos embedded in cross-origin iframes (e.g., YouTube video embedded on another site) cannot be accessed due to browser security restrictions. The extension works when you're directly on the video platform (e.g., youtube.com).

### Page Navigation
If you navigate away from the source page while a popout is open, the video will continue playing in the popout window, but the "Navigate Back" feature won't work.

## File Structure

```
PopoutPlayer/
├── manifest.json           # Extension manifest (MV3)
├── background.js           # Service worker for extension icon clicks
├── content/
│   ├── content.js          # Main logic: detection, overlay, popout
│   └── content.css         # Overlay icon styles
├── player/
│   └── player.css          # Popup window player styles
├── icons/
│   ├── icon16.png          # 16x16 extension icon
│   ├── icon48.png          # 48x48 extension icon
│   ├── icon128.png         # 128x128 extension icon
│   ├── icon16.svg          # Source SVG
│   ├── icon48.svg          # Source SVG
│   └── icon128.svg         # Source SVG
├── generate-icons.js       # Icon generator script
└── README.md               # This file
```

## Development

### Improving Icons
The current icons are minimal placeholders. To create better icons:

1. Edit the SVG files in the `icons/` folder
2. Convert them to PNG using:
   - **ImageMagick**: `convert icon.svg icon.png`
   - **Inkscape**: `inkscape icon.svg --export-png=icon.png`
   - **Online converter**: cloudconvert.com

Or update `manifest.json` to use SVG icons directly (Chrome supports SVG for extension icons).

### Debugging

1. Open Chrome DevTools on any page
2. Check the Console for PopoutPlayer logs
3. For popup window debugging:
   - Right-click on the popup window
   - Select "Inspect" to open DevTools for that window

### Testing

Test on various sites:
- **YouTube**: youtube.com/watch?v=...
- **Twitch**: twitch.tv/...
- **HTML5 video test pages**: w3schools.com/html/html5_video.asp
- **Multiple videos**: Test with pages that have multiple videos

Test edge cases:
- Multiple simultaneous popouts
- Closing/restoring videos
- Navigate Back feature
- Popup blocker scenarios
- Keyboard shortcuts
- Auto-hide controls

## Browser Compatibility

- ✅ **Chrome/Chromium** - Fully supported (MV3)
- ✅ **Edge** - Should work (Chromium-based)
- ✅ **Brave** - Should work (Chromium-based)
- ❌ **Firefox** - Not compatible (uses different extension API, and Firefox already has native PiP)
- ❌ **Safari** - Not compatible (different extension system)

## License

This is a personal project created for educational purposes. Feel free to modify and use as you see fit.

## Troubleshooting

**Issue: Overlay icon doesn't appear**
- Check if the video is large enough (minimum 150x100 pixels)
- Ensure the video is visible on the page
- Try refreshing the page

**Issue: Popup opens but video doesn't show**
- Check browser console for errors
- Ensure popups are allowed for the site
- Try a different video or site

**Issue: Controls don't work**
- Check if the video supports the action (some videos may not support seeking)
- Try clicking directly on the control button
- Check browser console for errors

**Issue: "Navigate Back" doesn't work**
- Ensure the source page is still open
- Make sure you haven't navigated away from the original page
- The placeholder should still be visible on the source page

## Future Enhancements

Potential improvements:
- [ ] Context menu "Pop out this video" option
- [ ] Settings page for customization
- [ ] Playback speed control
- [ ] Remember window positions and sizes
- [ ] Subtitle/caption support
- [ ] Picture-in-Picture fallback mode
- [ ] Better cross-origin iframe handling (if possible)

---

**Enjoy unlimited video popouts!** 🎬
