// PopoutPlayer Background Service Worker
// Minimal - handles extension icon clicks

chrome.action.onClicked.addListener(async (tab) => {
  try {
    // Send message to content script to pop out the largest visible video
    await chrome.tabs.sendMessage(tab.id, {
      type: 'popout-largest-video'
    });
  } catch (error) {
    console.error('Failed to send message to content script:', error);
  }
});
