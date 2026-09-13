/**
 * MonitorZoom - Zoom Manager
 * Controls tab zoom manipulation, per-tab scope enforcement,
 * and programmatic feedback loop suppression.
 */

// Track programmatic zoom operations to ignore echo onZoomChange events
// Map: tabId -> expectedZoomFactor
const pendingProgrammaticZooms = new Map();

/**
 * Checks if an echo zoom change event is from our own programmatic call.
 * @param {number} tabId
 * @param {number} newZoomFactor
 * @returns {boolean} True if suppressed (was programmatic), False if user-initiated
 */
function isProgrammaticZoomChange(tabId, newZoomFactor) {
  if (pendingProgrammaticZooms.has(tabId)) {
    const expected = pendingProgrammaticZooms.get(tabId);
    if (Math.abs(expected - newZoomFactor) < 0.01) {
      pendingProgrammaticZooms.delete(tabId);
      return true;
    }
  }
  return false;
}

/**
 * Updates the extension badge text and background color on the active tab.
 * @param {number} tabId
 * @param {number} zoomFactor
 */
function updateTabBadge(tabId, zoomFactor) {
  if (typeof chrome === 'undefined' || !chrome.action) return;

  const percent = Math.round(zoomFactor * 100);
  // Unobtrusive: clear badge when at 100%
  const badgeText = percent === 100 ? '' : `${percent}`;

  try {
    chrome.action.setBadgeText({ tabId, text: badgeText });
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#18181b' });
  } catch (err) {
    // Ignore errors for discarded or closing tabs
  }
}

/**
 * Applies the appropriate monitor-specific zoom factor to a tab.
 *
 * @param {number} tabId
 * @param {number} [windowId]
 * @param {Object} [options]
 * @param {boolean} [options.force] Apply even if zoom matches current
 */
async function applyMonitorZoomToTab(tabId, windowId, options = {}) {
  if (typeof chrome === 'undefined' || !chrome.tabs) return;

  try {
    const settings = await getSettings();
    if (!settings.enabled) return;

    // 1. Get tab information
    const tab = await new Promise((resolve, reject) => {
      chrome.tabs.get(tabId, (t) => {
        if (chrome.runtime.lastError || !t) return resolve(null);
        resolve(t);
      });
    });

    if (!tab || !tab.url) return;

    const siteKey = getSiteKeyFromUrl(tab.url);
    if (!siteKey) {
      // Restricted internal or system URL, clear badge and exit safely
      updateTabBadge(tabId, 1.0);
      return;
    }

    const winId = windowId || tab.windowId;

    // 2. Get window coordinates
    const win = await new Promise((resolve) => {
      chrome.windows.get(winId, (w) => {
        if (chrome.runtime.lastError || !w) return resolve(null);
        resolve(w);
      });
    });

    if (!win) return;

    // 3. Get displays and match window
    const displays = await getAllDisplays();
    if (!displays || displays.length === 0) return;

    // Update display metadata cache
    await recordDisplayMetadata(displays);

    const activeDisplay = findDisplayForWindow(win, displays);
    if (!activeDisplay) return;

    const displayKey = getDisplayKey(activeDisplay);
    const displayFingerprint = getDisplayFingerprint(activeDisplay);

    // 4. Look up effective zoom factor
    const { zoomFactor } = await getEffectiveZoom(siteKey, displayKey, displayFingerprint);

    // 5. Ensure tab zoom scope is 'per-tab' with 'automatic' mode
    await new Promise((resolve) => {
      chrome.tabs.setZoomSettings(tabId, { scope: 'per-tab', mode: 'automatic' }, () => {
        resolve();
      });
    });

    // 6. Check current zoom factor
    const currentZoom = await new Promise((resolve) => {
      chrome.tabs.getZoom(tabId, (factor) => resolve(factor || 1.0));
    });

    if (options.force || Math.abs(currentZoom - zoomFactor) >= 0.01) {
      // Mark as pending to suppress echo event in onZoomChange
      pendingProgrammaticZooms.set(tabId, zoomFactor);

      await new Promise((resolve) => {
        chrome.tabs.setZoom(tabId, zoomFactor, () => {
          if (chrome.runtime.lastError) {
            pendingProgrammaticZooms.delete(tabId);
          }
          resolve();
        });
      });
    }

    // 7. Update extension action badge
    if (settings.showBadge) {
      updateTabBadge(tabId, zoomFactor);
    }
  } catch (err) {
    console.error(`[MonitorZoom] Error applying zoom to tab ${tabId}:`, err);
  }
}

/**
 * Handles user-initiated zoom changes (e.g. via Ctrl + Plus/Minus or Chrome menu).
 * Persists the user's zoom choice for this site and active monitor.
 *
 * @param {Object} zoomChangeInfo { tabId, oldZoomFactor, newZoomFactor, zoomSettings }
 */
async function handleTabZoomChanged(zoomChangeInfo) {
  const { tabId, newZoomFactor } = zoomChangeInfo;

  // If this was an automated zoom change initiated by MonitorZoom, ignore it
  if (isProgrammaticZoomChange(tabId, newZoomFactor)) {
    return;
  }

  const settings = await getSettings();
  if (!settings.enabled) return;

  try {
    const tab = await new Promise((resolve) => {
      chrome.tabs.get(tabId, (t) => {
        if (chrome.runtime.lastError || !t) return resolve(null);
        resolve(t);
      });
    });

    if (!tab || !tab.url) return;

    const siteKey = getSiteKeyFromUrl(tab.url);
    if (!siteKey) return;

    const win = await new Promise((resolve) => {
      chrome.windows.get(tab.windowId, (w) => {
        if (chrome.runtime.lastError || !w) return resolve(null);
        resolve(w);
      });
    });

    if (!win) return;

    const displays = await getAllDisplays();
    const activeDisplay = findDisplayForWindow(win, displays);
    if (!activeDisplay) return;

    const displayKey = getDisplayKey(activeDisplay);

    // Save the user's new preferred zoom ratio for this site on this monitor
    await saveSiteZoom(siteKey, displayKey, newZoomFactor);

    if (settings.showBadge) {
      updateTabBadge(tabId, newZoomFactor);
    }

    // Broadcast update to popup if open
    chrome.runtime.sendMessage({
      type: 'ZOOM_UPDATED',
      siteKey,
      displayKey,
      zoomFactor: newZoomFactor,
      tabId
    }).catch(() => {
      // No listeners open (e.g. popup is closed), safely ignore
    });
  } catch (err) {
    console.error('[MonitorZoom] Error saving user zoom change:', err);
  }
}

// Support both ES Module and CommonJS for testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    pendingProgrammaticZooms,
    isProgrammaticZoomChange,
    updateTabBadge,
    applyMonitorZoomToTab,
    handleTabZoomChanged
  };
}
