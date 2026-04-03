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
      // window.open() must run in a user-gesture stack. sendMessage alone runs later with no activation, so
      // Chromium opens a full browser window. Open a named minimal popup synchronously from the page (MAIN
      // world), then the content script grabs it via window[name] and attaches the player.
      var w = 800;
      var h = 450;
      var sw = typeof screen !== 'undefined' && screen.availWidth ? screen.availWidth : 1920;
      var sh = typeof screen !== 'undefined' && screen.availHeight ? screen.availHeight : 1080;
      var left = Math.max(0, Math.round((sw - w) / 2));
      var top = Math.max(0, Math.round((sh - h) / 2));
      var winName = 'pp_tb_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
      var featStr = [
        'popup=yes',
        'width=' + w,
        'height=' + h,
        'left=' + left,
        'top=' + top,
        'resizable=yes',
        'scrollbars=no',
        'toolbar=no',
        'menubar=no',
        'location=no',
        'status=no',
        'directories=no'
      ].join(',');
      if (!chrome.scripting || typeof chrome.scripting.executeScript !== 'function') {
        chrome.tabs.sendMessage(tab.id, { type: 'popout-largest-video' }).catch(function (err) {
          console.error('Failed to send message to content script:', err);
        });
        return;
      }
      chrome.scripting.executeScript(
        {
          target: { tabId: tab.id },
          world: 'MAIN',
          injectImmediately: true,
          func: function (name, feats) {
            window.open('about:blank', name, feats);
          },
          args: [winName, featStr]
        },
        function () {
          if (chrome.runtime.lastError) {
            chrome.tabs.sendMessage(tab.id, { type: 'popout-largest-video' }).catch(function (err) {
              console.error('Failed to send message to content script:', err);
            });
            return;
          }
          chrome.tabs
            .sendMessage(tab.id, { type: 'popout-largest-video', toolbarPopupName: winName })
            .catch(function (err) {
              console.error('Failed to send message to content script:', err);
            });
        }
      );
    });
  } catch (err) {
    console.error('PopoutPlayer: background startup error:', err);
  }

  // Navigate Back: focusing from a content script while a popout window has focus often fails to bring the
  // source window forward. The service worker can activate the tab and focus the window reliably.
  try {
    chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
      if (!message || message.type !== 'popout-focus-source-tab') {
        return false;
      }
      var tabId = message.tabId;
      if (tabId == null) {
        sendResponse({ ok: false });
        return false;
      }
      chrome.tabs.get(tabId, function (tab) {
        if (chrome.runtime.lastError || !tab) {
          sendResponse({ ok: false, error: chrome.runtime.lastError && chrome.runtime.lastError.message });
          return;
        }
        var windowId = message.windowId != null ? message.windowId : tab.windowId;
        chrome.tabs.update(tabId, { active: true }, function () {
          if (chrome.runtime.lastError) {
            sendResponse({ ok: false, error: chrome.runtime.lastError.message });
            return;
          }
          chrome.windows.update(windowId, { focused: true }, function () {
            sendResponse({ ok: !chrome.runtime.lastError });
          });
        });
      });
      return true;
    });
  } catch (e) {
    console.error('PopoutPlayer: focus-source-tab listener error:', e);
  }
})();
