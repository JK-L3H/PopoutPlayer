// PopoutPlayer Background Service Worker — toolbar icon → pop out largest video.
// v1.0.2 — read chrome.action / browserAction in small steps (never chain .onClicked on unknown).

(function () {
  'use strict';

  function getToolbarOnClicked(chromeApi) {
    if (!chromeApi) {
      return null;
    }

    try {
      var action = chromeApi.action;
      if (action == null) {
        return null;
      }
      var onAct = action.onClicked;
      if (onAct == null) {
        return null;
      }
      return onAct;
    } catch (e) {
      /* ignore */
    }

    try {
      var browserAction = chromeApi.browserAction;
      if (browserAction == null) {
        return null;
      }
      var onBrowser = browserAction.onClicked;
      if (onBrowser == null) {
        return null;
      }
      return onBrowser;
    } catch (e) {
      /* ignore */
    }

    return null;
  }

  try {
    if (typeof chrome === 'undefined') {
      console.error('PopoutPlayer: chrome is undefined (not running as an extension background context).');
      return;
    }

    var onToolbarClick = getToolbarOnClicked(chrome);
    if (!onToolbarClick) {
      console.error(
        'PopoutPlayer: no toolbar onClicked API. Confirm manifest.json includes "action": { ... } and reload the extension.'
      );
      return;
    }

    onToolbarClick.addListener(function (tab) {
      if (!tab || tab.id == null) {
        return;
      }
      chrome.tabs.sendMessage(tab.id, { type: 'popout-largest-video' }).catch(function (err) {
        console.error('Failed to send message to content script:', err);
      });
    });
  } catch (err) {
    console.error('PopoutPlayer: background startup error:', err);
  }
})();
