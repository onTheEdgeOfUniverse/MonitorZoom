/**
 * MonitorZoom - Background Service Worker
 * Coordinates display detection, window movement, tab events, and storage.
 */

// Import dependent modules into service worker global scope
importScripts(
  './display-manager.js',
  './storage-manager.js',
  './zoom-manager.js'
);

// Map of windowId -> displayKey to track when a window moves between monitors
const windowLastKnownDisplay = new Map();

// Debounce timer map for window bounds changes
const windowBoundsTimers = new Map();

/**
 * Re-evaluates zoom for a window when its display location changes.
 * @param {number} windowId
 */
async function checkWindowDisplayChange(windowId) {
  try {
    const settings = await getSettings();
    if (!settings.enabled || !settings.autoApplyOnMove) return;

    const win = await new Promise((resolve) => {
      chrome.windows.get(windowId, { populate: true }, (w) => {
        if (chrome.runtime.lastError || !w) return resolve(null);
        resolve(w);
      });
    });

    if (!win) {
      windowLastKnownDisplay.delete(windowId);
      return;
    }

    const displays = await getAllDisplays();
    if (!displays || displays.length === 0) return;

    const currentDisplay = findDisplayForWindow(win, displays);
    if (!currentDisplay) return;

    const currentDisplayKey = getDisplayKey(currentDisplay);
    const lastDisplayKey = windowLastKnownDisplay.get(windowId);

    // Update tracked display
    windowLastKnownDisplay.set(windowId, currentDisplayKey);

    // If display changed (or first time tracking this window)
    if (lastDisplayKey && lastDisplayKey !== currentDisplayKey) {
      console.log(`[MonitorZoom] Window ${windowId} moved: ${lastDisplayKey} -> ${currentDisplayKey}`);

      // Find active tab in this window and immediately apply monitor zoom
      const activeTab = win.tabs && win.tabs.find(t => t.active);
      if (activeTab) {
        await applyMonitorZoomToTab(activeTab.id, windowId, { force: true });
      }
    }
  } catch (err) {
    console.error('[MonitorZoom] Error checking window display change:', err);
  }
}

// -------------------------------------------------------------
// Lifecycle & Event Listeners
// -------------------------------------------------------------

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[MonitorZoom] Extension installed/updated:', details.reason);
  const displays = await getAllDisplays();
  await recordDisplayMetadata(displays);
});

// Tab navigated or reloaded
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading' || changeInfo.url) {
    applyMonitorZoomToTab(tabId, tab.windowId);
  }
});

// Tab focused / switched
chrome.tabs.onActivated.addListener((activeInfo) => {
  applyMonitorZoomToTab(activeInfo.tabId, activeInfo.windowId);
});

// Window moved or resized (debounced)
chrome.windows.onBoundsChanged.addListener((window) => {
  const windowId = window.id;
  if (!windowId) return;

  if (windowBoundsTimers.has(windowId)) {
    clearTimeout(windowBoundsTimers.get(windowId));
  }

  const timer = setTimeout(() => {
    windowBoundsTimers.delete(windowId);
    checkWindowDisplayChange(windowId);
  }, 250);

  windowBoundsTimers.set(windowId, timer);
});

// Window closed cleanup
chrome.windows.onRemoved.addListener((windowId) => {
  windowLastKnownDisplay.delete(windowId);
  if (windowBoundsTimers.has(windowId)) {
    clearTimeout(windowBoundsTimers.get(windowId));
    windowBoundsTimers.delete(windowId);
  }
});

// User manual zoom changes (via keyboard, trackpad pinch, or browser zoom controls)
chrome.tabs.onZoomChange.addListener((zoomChangeInfo) => {
  handleTabZoomChanged(zoomChangeInfo);
});

// Monitors plugged/unplugged or system display arrangement changed
if (chrome.system && chrome.system.display && chrome.system.display.onDisplayChanged) {
  chrome.system.display.onDisplayChanged.addListener(async () => {
    console.log('[MonitorZoom] System displays changed');
    const displays = await getAllDisplays();
    await recordDisplayMetadata(displays);

    // Recheck all open normal windows
    chrome.windows.getAll({ windowTypes: ['normal'] }, (windows) => {
      if (windows) {
        windows.forEach(w => checkWindowDisplayChange(w.id));
      }
    });
  });
}

// -------------------------------------------------------------
// Message Handling for Popup & Options Page
// -------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message.type) {
        case 'GET_ACTIVE_CONTEXT': {
          // Get current active tab and window
          const [tab] = await new Promise(resolve => {
            chrome.tabs.query({ active: true, currentWindow: true }, resolve);
          });

          if (!tab) {
            return sendResponse({ error: 'No active tab found' });
          }

          const siteKey = getSiteKeyFromUrl(tab.url);
          const win = await new Promise(resolve => {
            chrome.windows.get(tab.windowId, resolve);
          });

          const displays = await getAllDisplays();
          await recordDisplayMetadata(displays);

          const activeDisplay = win ? findDisplayForWindow(win, displays) : null;
          const activeDisplayKey = activeDisplay ? getDisplayKey(activeDisplay) : null;
          const activeDisplayFingerprint = activeDisplay ? getDisplayFingerprint(activeDisplay) : null;

          const currentZoom = await new Promise(resolve => {
            chrome.tabs.getZoom(tab.id, resolve);
          });

          const allSiteZooms = await getAllSiteZooms();
          const displayDefaults = await getDisplayDefaults();
          const settings = await getSettings();

          const siteRules = (siteKey && allSiteZooms[siteKey]) ? allSiteZooms[siteKey] : {};
          const effective = await getEffectiveZoom(siteKey, activeDisplayKey, activeDisplayFingerprint);

          sendResponse({
            tabId: tab.id,
            windowId: tab.windowId,
            url: tab.url,
            siteKey,
            isRestricted: !siteKey,
            currentZoom: currentZoom || 1.0,
            effectiveZoom: effective.zoomFactor,
            effectiveSource: effective.source,
            activeDisplay,
            activeDisplayKey,
            displays,
            siteRules,
            displayDefaults,
            settings
          });
          break;
        }

        case 'SET_TAB_ZOOM': {
          const { tabId, siteKey, displayKey, zoomFactor } = message;
          const normalized = normalizeZoomFactor(zoomFactor);

          if (siteKey && displayKey) {
            await saveSiteZoom(siteKey, displayKey, normalized);
          }

          if (tabId) {
            // Suppress echo
            pendingProgrammaticZooms.set(tabId, normalized);
            await new Promise(resolve => {
              chrome.tabs.setZoomSettings(tabId, { scope: 'per-tab', mode: 'automatic' }, () => {
                chrome.tabs.setZoom(tabId, normalized, resolve);
              });
            });
            updateTabBadge(tabId, normalized);
          }

          sendResponse({ success: true, zoomFactor: normalized });
          break;
        }

        case 'RESET_TAB_ZOOM': {
          const { tabId, siteKey, displayKey } = message;
          if (siteKey && displayKey) {
            await deleteSiteZoom(siteKey, displayKey);
          }

          // Fallback to display default or 1.0
          const displays = await getAllDisplays();
          const targetDisplay = displays.find(d => getDisplayKey(d) === displayKey) || displays[0];
          const displayFingerprint = targetDisplay ? getDisplayFingerprint(targetDisplay) : null;

          const effective = await getEffectiveZoom(siteKey, displayKey, displayFingerprint);

          if (tabId) {
            pendingProgrammaticZooms.set(tabId, effective.zoomFactor);
            await new Promise(resolve => {
              chrome.tabs.setZoom(tabId, effective.zoomFactor, resolve);
            });
            updateTabBadge(tabId, effective.zoomFactor);
          }

          sendResponse({ success: true, newZoom: effective.zoomFactor });
          break;
        }

        case 'GET_ALL_CONFIG': {
          const [allSiteZooms, displayDefaults, metadata, settings, displays] = await Promise.all([
            getAllSiteZooms(),
            getDisplayDefaults(),
            getDisplayMetadata(),
            getSettings(),
            getAllDisplays()
          ]);

          sendResponse({
            allSiteZooms,
            displayDefaults,
            metadata,
            settings,
            displays
          });
          break;
        }

        case 'SAVE_DISPLAY_DEFAULT': {
          const { displayKey, zoomFactor } = message;
          await saveDisplayDefault(displayKey, zoomFactor);
          sendResponse({ success: true });
          break;
        }

        case 'DELETE_DISPLAY_DEFAULT': {
          const { displayKey } = message;
          await deleteDisplayDefault(displayKey);
          sendResponse({ success: true });
          break;
        }

        case 'DELETE_SITE_RULE': {
          const { siteKey, displayKey } = message;
          await deleteSiteZoom(siteKey, displayKey);
          sendResponse({ success: true });
          break;
        }

        case 'UPDATE_SETTINGS': {
          const updated = await saveSettings(message.settings);
          sendResponse({ success: true, settings: updated });
          break;
        }

        case 'EXPORT_BACKUP': {
          const jsonStr = await exportConfiguration();
          sendResponse({ success: true, data: jsonStr });
          break;
        }

        case 'IMPORT_BACKUP': {
          const result = await importConfiguration(message.jsonStr);
          sendResponse(result);
          break;
        }

        case 'CLEAR_ALL_DATA': {
          await clearAllData();
          sendResponse({ success: true });
          break;
        }

        default:
          sendResponse({ error: 'Unknown message type' });
      }
    } catch (err) {
      console.error('[MonitorZoom] Background message handler error:', err);
      sendResponse({ error: err.message });
    }
  })();

  // Return true to indicate asynchronous response to chrome.runtime.onMessage
  return true;
});
