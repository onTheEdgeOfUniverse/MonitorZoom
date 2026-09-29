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

// Tab navigated or reloaded (runs on complete or url change, avoiding duplicate runs during loading)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' || changeInfo.url) {
    applyMonitorZoomToTab(tabId, tab.windowId, { trigger: 'onloaded' });
  }
});

// Tab focused / switched
chrome.tabs.onActivated.addListener((activeInfo) => {
  applyMonitorZoomToTab(activeInfo.tabId, activeInfo.windowId);
});

// Window focus switched (e.g. clicking between monitor and laptop windows)
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (typeof chrome === 'undefined' || !chrome.windows) return;
  if (!windowId || windowId === -1 || (chrome.windows.WINDOW_ID_NONE && windowId === chrome.windows.WINDOW_ID_NONE)) {
    return;
  }

  try {
    const [activeTab] = await new Promise((resolve) => {
      chrome.tabs.query({ active: true, windowId }, (tabs) => {
        if (chrome.runtime && chrome.runtime.lastError) return resolve([]);
        resolve(tabs || []);
      });
    });

    if (activeTab && activeTab.id) {
      await applyMonitorZoomToTab(activeTab.id, windowId);
    }
  } catch (err) {
    console.error('[MonitorZoom] Error in onFocusChanged:', err);
  }
});

// Tab attached to a different window (e.g. dragged between windows or monitors)
chrome.tabs.onAttached.addListener((tabId, attachInfo) => {
  if (attachInfo && attachInfo.newWindowId) {
    applyMonitorZoomToTab(tabId, attachInfo.newWindowId, { force: true });
  }
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

// Tab closed cleanup
chrome.tabs.onRemoved.addListener((tabId) => {
  pendingProgrammaticZooms.delete(tabId);
  clearTabSession(tabId);
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
            // Update session tracking
            tabSiteSessions.set(tabId, {
              siteKey,
              displayKey,
              lastAppliedZoom: normalized
            });

            // Suppress echo
            pendingProgrammaticZooms.set(tabId, normalized);
            await new Promise(resolve => {
              chrome.tabs.setZoomSettings(tabId, { scope: 'per-tab', mode: 'automatic' }, () => {
                chrome.tabs.setZoom(tabId, normalized, resolve);
              });
            });
            updateTabBadge(tabId, normalized);
          } else if (siteKey && displayKey) {
            // Updated from Options page: find any open tabs of this site on this display and apply
            try {
              const displays = await getAllDisplays();
              const windows = await new Promise(resolve => chrome.windows.getAll({ populate: true }, resolve));
              for (const win of windows || []) {
                const winDisplay = findDisplayForWindow(win, displays);
                if (winDisplay && (getDisplayKey(winDisplay) === displayKey || getDisplayFingerprint(winDisplay) === displayKey)) {
                  for (const t of win.tabs || []) {
                    if (t.url && getSiteKeyFromUrl(t.url) === siteKey) {
                      await applyMonitorZoomToTab(t.id, win.id, { force: true });
                    }
                  }
                }
              }
            } catch (err) {
              // Ignore background sync errors
            }
          }

          sendResponse({ success: true, zoomFactor: normalized });
          break;
        }

        case 'RESET_TAB_ZOOM': {
          const { tabId, siteKey, displayKey } = message;
          if (siteKey && displayKey) {
            await deleteSiteZoom(siteKey, displayKey);
          }

          if (tabId) {
            clearTabSession(tabId);
          }

          // Fallback to display default or 1.0
          const displays = await getAllDisplays();
          const targetDisplay = displays.find(d => getDisplayKey(d) === displayKey) || displays[0];
          const displayFingerprint = targetDisplay ? getDisplayFingerprint(targetDisplay) : null;

          const effective = await getEffectiveZoom(siteKey, displayKey, displayFingerprint);

          if (tabId) {
            tabSiteSessions.set(tabId, {
              siteKey,
              displayKey,
              lastAppliedZoom: effective.zoomFactor
            });

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
          const { siteKey, displayKey, displayKeys } = message;
          await deleteSiteZoom(siteKey, displayKeys || displayKey);
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

        case 'SET_ALL_SITE_ZOOMS': {
          await storageSet({ [STORAGE_KEYS.SITE_ZOOMS]: message.siteZooms });
          sendResponse({ success: true });
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
