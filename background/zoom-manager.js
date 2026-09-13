/**
 * MonitorZoom - Zoom Manager
 * Controls tab zoom manipulation, per-tab scope enforcement,
 * programmatic feedback loop suppression, and per-site navigation session tracking.
 */

// Node.js CommonJS environment support for automated testing
if (typeof module !== 'undefined' && module.exports) {
  try {
    const displayMgr = require('./display-manager.js');
    const storageMgr = require('./storage-manager.js');
    Object.assign(globalThis, displayMgr, storageMgr);
  } catch (e) {
    // Service worker environment ignores require
  }
}

// Track programmatic zoom operations to ignore echo onZoomChange events
// Map: tabId -> expectedZoomFactor
const pendingProgrammaticZooms = new Map();

// Track active site session per tab:
// Map: tabId -> { siteKey: string, displayKey: string, lastAppliedZoom: number }
const tabSiteSessions = new Map();

/**
 * Returns the active site session for a tab.
 * @param {number} tabId
 * @returns {{ siteKey: string, displayKey: string, lastAppliedZoom: number } | null}
 */
function getTabSession(tabId) {
  return tabSiteSessions.get(tabId) || null;
}

/**
 * Clears the active site session for a tab (e.g. when tab closes or navigates to restricted URL).
 * @param {number} tabId
 */
function clearTabSession(tabId) {
  tabSiteSessions.delete(tabId);
}

/**
 * Resets all tab sessions (useful for tests or setting changes).
 */
function resetAllTabSessions() {
  tabSiteSessions.clear();
}

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
 * Optimizes internal navigations so changes on a site apply once,
 * and only re-triggers if there is an actual difference in the zoom ratio.
 *
 * @param {number} tabId
 * @param {number} [windowId]
 * @param {Object} [options]
 * @param {boolean} [options.force] Apply even if zoom matches current
 * @returns {Promise<{applied: boolean, reason?: string, zoomFactor?: number}>}
 */
async function applyMonitorZoomToTab(tabId, windowId, options = {}) {
  if (typeof chrome === 'undefined' || !chrome.tabs) return { applied: false };

  try {
    const settings = await getSettings();
    if (!settings.enabled) return { applied: false, reason: 'disabled' };

    // 1. Get tab information
    const tab = await new Promise((resolve) => {
      chrome.tabs.get(tabId, (t) => {
        if ((chrome.runtime && chrome.runtime.lastError) || !t) return resolve(null);
        resolve(t);
      });
    });

    if (!tab || !tab.url) return { applied: false, reason: 'no_tab' };

    const siteKey = getSiteKeyFromUrl(tab.url);
    if (!siteKey) {
      // Restricted internal or system URL, clear badge and session
      clearTabSession(tabId);
      updateTabBadge(tabId, 1.0);
      return { applied: false, reason: 'restricted_url' };
    }

    const winId = windowId || tab.windowId;

    // 2. Get window coordinates
    const win = await new Promise((resolve) => {
      chrome.windows.get(winId, (w) => {
        if ((chrome.runtime && chrome.runtime.lastError) || !w) return resolve(null);
        resolve(w);
      });
    });

    if (!win) return { applied: false, reason: 'no_window' };

    // 3. Get displays and match window
    const displays = await getAllDisplays();
    if (!displays || displays.length === 0) return { applied: false, reason: 'no_displays' };

    // Update display metadata cache
    await recordDisplayMetadata(displays);

    const activeDisplay = findDisplayForWindow(win, displays);
    if (!activeDisplay) return { applied: false, reason: 'no_active_display' };

    const displayKey = getDisplayKey(activeDisplay);
    const displayFingerprint = getDisplayFingerprint(activeDisplay);

    // 4. Look up effective zoom factor for this site on this monitor
    const effective = await getEffectiveZoom(siteKey, displayKey, displayFingerprint);
    const zoomFactor = effective.zoomFactor;

    // 5. Query current tab zoom
    const currentZoom = await new Promise((resolve) => {
      chrome.tabs.getZoom(tabId, (factor) => resolve(factor || 1.0));
    });

    // Check if there is an actual difference in the zoom ratio
    const hasDifference = Math.abs(currentZoom - zoomFactor) >= 0.01;

    // BUG FIX: Do NOT apply zoom on site load for unmanaged sites!
    // If the site has no saved rule and the display has no default rule, leave the tab untouched.
    if (!effective.hasExplicitRule && !options.force) {
      if (settings.showBadge) {
        updateTabBadge(tabId, currentZoom);
      }
      return { applied: false, reason: 'no_explicit_rule', zoomFactor: currentZoom };
    }

    // If applyOnSiteLoad is explicitly turned off in settings, skip onloaded trigger
    if (options.trigger === 'onloaded' && settings.applyOnSiteLoad === false && !options.force) {
      if (settings.showBadge) {
        updateTabBadge(tabId, currentZoom);
      }
      return { applied: false, reason: 'apply_on_load_disabled', zoomFactor: currentZoom };
    }

    // 6. Check existing session for this tab
    const session = tabSiteSessions.get(tabId);
    const isSameSiteAndDisplay = Boolean(
      session &&
      session.siteKey === siteKey &&
      session.displayKey === displayKey
    );

    // FEATURE: Changes on a site apply only once for all internal navigation,
    // and are applied if there is a difference in the zoom ratio.
    const onlyApplyOnDiff = settings.onlyApplyOnDifference !== false;

    if (onlyApplyOnDiff && isSameSiteAndDisplay && !hasDifference && !options.force) {
      // Already applied for this site on this monitor, and no difference in zoom ratio
      if (settings.showBadge) {
        updateTabBadge(tabId, zoomFactor);
      }
      return { applied: false, reason: 'same_site_no_difference', zoomFactor };
    }

    // If current zoom already matches target and not forced, record session and do not re-apply
    if (!hasDifference && !options.force) {
      tabSiteSessions.set(tabId, {
        siteKey,
        displayKey,
        lastAppliedZoom: zoomFactor
      });
      if (settings.showBadge) {
        updateTabBadge(tabId, zoomFactor);
      }
      return { applied: false, reason: 'already_at_target_zoom', zoomFactor };
    }

    // 7. Apply zoom if difference exists or forced
    if (hasDifference || options.force) {
      // Mark as pending to suppress echo event in onZoomChange
      pendingProgrammaticZooms.set(tabId, zoomFactor);

      await new Promise((resolve) => {
        chrome.tabs.setZoomSettings(tabId, { scope: 'per-tab', mode: 'automatic' }, () => {
          chrome.tabs.setZoom(tabId, zoomFactor, () => {
            if (chrome.runtime && chrome.runtime.lastError) {
              pendingProgrammaticZooms.delete(tabId);
            }
            resolve();
          });
        });
      });
    }

    // 8. Record the active session for this tab
    tabSiteSessions.set(tabId, {
      siteKey,
      displayKey,
      lastAppliedZoom: zoomFactor
    });

    // 9. Update extension action badge
    if (settings.showBadge) {
      updateTabBadge(tabId, zoomFactor);
    }

    return { applied: hasDifference || Boolean(options.force), zoomFactor };
  } catch (err) {
    console.error(`[MonitorZoom] Error applying zoom to tab ${tabId}:`, err);
    return { applied: false, error: err.message };
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
        if ((chrome.runtime && chrome.runtime.lastError) || !t) return resolve(null);
        resolve(t);
      });
    });

    if (!tab || !tab.url) return;

    const siteKey = getSiteKeyFromUrl(tab.url);
    if (!siteKey) return;

    const win = await new Promise((resolve) => {
      chrome.windows.get(tab.windowId, (w) => {
        if ((chrome.runtime && chrome.runtime.lastError) || !w) return resolve(null);
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

    // Update active tab session
    tabSiteSessions.set(tabId, {
      siteKey,
      displayKey,
      lastAppliedZoom: newZoomFactor
    });

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
    tabSiteSessions,
    getTabSession,
    clearTabSession,
    resetAllTabSessions,
    isProgrammaticZoomChange,
    updateTabBadge,
    applyMonitorZoomToTab,
    handleTabZoomChanged
  };
}
