/**
 * MonitorZoom - Storage Manager
 * Handles data persistence, site normalization, and preference lookups.
 */

const DEFAULT_SETTINGS = {
  enabled: true,
  autoApplyOnMove: true,
  stepSize: 0.1, // 10% increment/decrement
  showBadge: true,
  onlyApplyOnDifference: true // Apply once per site navigation, only if ratio differs
};

const STORAGE_KEYS = {
  SITE_ZOOMS: 'mz_site_zooms',
  DISPLAY_DEFAULTS: 'mz_display_defaults',
  DISPLAY_METADATA: 'mz_display_metadata',
  SETTINGS: 'mz_settings'
};

/**
 * Normalizes a URL to a consistent site/domain key.
 * Returns null if the URL is invalid or internal (e.g. chrome://).
 * @param {string} urlString
 * @returns {string|null}
 */
function getSiteKeyFromUrl(urlString) {
  if (!urlString || typeof urlString !== 'string') return null;

  const trimmed = urlString.trim();

  // Guard against internal or unzoomable schemes
  if (
    trimmed.startsWith('chrome://') ||
    trimmed.startsWith('chrome-extension://') ||
    trimmed.startsWith('edge://') ||
    trimmed.startsWith('brave://') ||
    trimmed.startsWith('about:') ||
    trimmed.startsWith('view-source:') ||
    trimmed.startsWith('data:') ||
    trimmed.startsWith('javascript:')
  ) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      // Return host (includes port if non-standard, e.g. localhost:3000)
      return parsed.host.toLowerCase();
    }
    if (parsed.protocol === 'file:') {
      return 'local-files';
    }
  } catch (e) {
    // Malformed URL
    return null;
  }

  return null;
}

/**
 * Normalizes zoom factors to 2 decimal places to avoid floating point anomalies.
 * @param {number} factor
 * @returns {number}
 */
function normalizeZoomFactor(factor) {
  if (typeof factor !== 'number' || isNaN(factor) || factor <= 0) {
    return 1.0;
  }
  return Math.round(factor * 100) / 100;
}

/**
 * Generic helper to get data from chrome.storage.local.
 * @param {string|Array<string>} keys
 * @returns {Promise<Object>}
 */
async function storageGet(keys) {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    return new Promise((resolve) => {
      chrome.storage.local.get(keys, (res) => resolve(res || {}));
    });
  }
  return {};
}

/**
 * Generic helper to set data in chrome.storage.local.
 * @param {Object} items
 * @returns {Promise<void>}
 */
async function storageSet(items) {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    return new Promise((resolve) => {
      chrome.storage.local.set(items, () => resolve());
    });
  }
}

/**
 * Retrieves the stored zoom factor for a given site and display.
 * Falls back to display default if no site-specific zoom is recorded.
 *
 * @param {string} siteKey
 * @param {string} displayKey
 * @param {string} [displayFingerprint]
 * @returns {Promise<{zoomFactor: number, source: 'site'|'display_default'|'browser_default'}>}
 */
async function getEffectiveZoom(siteKey, displayKey, displayFingerprint) {
  const data = await storageGet([STORAGE_KEYS.SITE_ZOOMS, STORAGE_KEYS.DISPLAY_DEFAULTS]);
  const siteZooms = data[STORAGE_KEYS.SITE_ZOOMS] || {};
  const displayDefaults = data[STORAGE_KEYS.DISPLAY_DEFAULTS] || {};

  // 1. Check site-specific zoom for displayKey
  if (siteKey && siteZooms[siteKey]) {
    const siteDisplayMap = siteZooms[siteKey];
    if (typeof siteDisplayMap[displayKey] === 'number') {
      return { zoomFactor: siteDisplayMap[displayKey], source: 'site' };
    }
    // Fallback check: match by fingerprint if display ID rotated
    if (displayFingerprint && typeof siteDisplayMap[displayFingerprint] === 'number') {
      return { zoomFactor: siteDisplayMap[displayFingerprint], source: 'site' };
    }
  }

  // 2. Check display default zoom
  if (displayKey && typeof displayDefaults[displayKey] === 'number') {
    return { zoomFactor: displayDefaults[displayKey], source: 'display_default' };
  }
  if (displayFingerprint && typeof displayDefaults[displayFingerprint] === 'number') {
    return { zoomFactor: displayDefaults[displayFingerprint], source: 'display_default' };
  }

  // 3. Fallback to standard 100% (1.0)
  return { zoomFactor: 1.0, source: 'browser_default' };
}

/**
 * Saves a site zoom factor for a specific display.
 * @param {string} siteKey
 * @param {string} displayKey
 * @param {number} zoomFactor
 */
async function saveSiteZoom(siteKey, displayKey, zoomFactor) {
  if (!siteKey || !displayKey) return;
  const normalizedZoom = normalizeZoomFactor(zoomFactor);

  const data = await storageGet(STORAGE_KEYS.SITE_ZOOMS);
  const siteZooms = data[STORAGE_KEYS.SITE_ZOOMS] || {};

  if (!siteZooms[siteKey]) {
    siteZooms[siteKey] = {};
  }
  siteZooms[siteKey][displayKey] = normalizedZoom;

  await storageSet({ [STORAGE_KEYS.SITE_ZOOMS]: siteZooms });
}

/**
 * Removes a saved zoom entry.
 * If displayKey is omitted, removes the entire site rule.
 * @param {string} siteKey
 * @param {string} [displayKey]
 */
async function deleteSiteZoom(siteKey, displayKey) {
  if (!siteKey) return;
  const data = await storageGet(STORAGE_KEYS.SITE_ZOOMS);
  const siteZooms = data[STORAGE_KEYS.SITE_ZOOMS] || {};

  if (!siteZooms[siteKey]) return;

  if (displayKey) {
    delete siteZooms[siteKey][displayKey];
    // Clean up empty site object
    if (Object.keys(siteZooms[siteKey]).length === 0) {
      delete siteZooms[siteKey];
    }
  } else {
    delete siteZooms[siteKey];
  }

  await storageSet({ [STORAGE_KEYS.SITE_ZOOMS]: siteZooms });
}

/**
 * Gets all saved site zoom configurations.
 * @returns {Promise<Object>}
 */
async function getAllSiteZooms() {
  const data = await storageGet(STORAGE_KEYS.SITE_ZOOMS);
  return data[STORAGE_KEYS.SITE_ZOOMS] || {};
}

/**
 * Saves or updates default zoom factor for a display.
 * @param {string} displayKey
 * @param {number} zoomFactor
 */
async function saveDisplayDefault(displayKey, zoomFactor) {
  if (!displayKey) return;
  const normalizedZoom = normalizeZoomFactor(zoomFactor);
  const data = await storageGet(STORAGE_KEYS.DISPLAY_DEFAULTS);
  const displayDefaults = data[STORAGE_KEYS.DISPLAY_DEFAULTS] || {};

  displayDefaults[displayKey] = normalizedZoom;
  await storageSet({ [STORAGE_KEYS.DISPLAY_DEFAULTS]: displayDefaults });
}

/**
 * Deletes default zoom factor for a display.
 * @param {string} displayKey
 */
async function deleteDisplayDefault(displayKey) {
  if (!displayKey) return;
  const data = await storageGet(STORAGE_KEYS.DISPLAY_DEFAULTS);
  const displayDefaults = data[STORAGE_KEYS.DISPLAY_DEFAULTS] || {};

  delete displayDefaults[displayKey];
  await storageSet({ [STORAGE_KEYS.DISPLAY_DEFAULTS]: displayDefaults });
}

/**
 * Gets all display defaults.
 * @returns {Promise<Object>}
 */
async function getDisplayDefaults() {
  const data = await storageGet(STORAGE_KEYS.DISPLAY_DEFAULTS);
  return data[STORAGE_KEYS.DISPLAY_DEFAULTS] || {};
}

/**
 * Updates metadata for known displays (for UI display and fingerprint fallback).
 * @param {Array<chrome.system.display.DisplayUnitInfo>} displays
 */
async function recordDisplayMetadata(displays) {
  if (!displays || !displays.length) return;
  const data = await storageGet(STORAGE_KEYS.DISPLAY_METADATA);
  const metadata = data[STORAGE_KEYS.DISPLAY_METADATA] || {};

  for (const d of displays) {
    const key = d.id || 'display';
    metadata[key] = {
      id: d.id,
      name: d.name || 'Display',
      bounds: d.bounds ? { width: d.bounds.width, height: d.bounds.height } : { width: 0, height: 0 },
      isPrimary: Boolean(d.isPrimary),
      lastSeen: Date.now()
    };
  }

  await storageSet({ [STORAGE_KEYS.DISPLAY_METADATA]: metadata });
}

/**
 * Gets all stored display metadata.
 * @returns {Promise<Object>}
 */
async function getDisplayMetadata() {
  const data = await storageGet(STORAGE_KEYS.DISPLAY_METADATA);
  return data[STORAGE_KEYS.DISPLAY_METADATA] || {};
}

/**
 * Retrieves extension settings with defaults.
 * @returns {Promise<typeof DEFAULT_SETTINGS>}
 */
async function getSettings() {
  const data = await storageGet(STORAGE_KEYS.SETTINGS);
  return Object.assign({}, DEFAULT_SETTINGS, data[STORAGE_KEYS.SETTINGS] || {});
}

/**
 * Updates extension settings.
 * @param {Partial<typeof DEFAULT_SETTINGS>} newSettings
 */
async function saveSettings(newSettings) {
  const current = await getSettings();
  const updated = Object.assign({}, current, newSettings);
  await storageSet({ [STORAGE_KEYS.SETTINGS]: updated });
  return updated;
}

/**
 * Exports all extension data as JSON string for backup.
 * @returns {Promise<string>}
 */
async function exportConfiguration() {
  const all = await storageGet(null);
  return JSON.stringify({
    version: 1,
    exportDate: new Date().toISOString(),
    data: all
  }, null, 2);
}

/**
 * Imports configuration from JSON string.
 * @param {string} jsonStr
 * @returns {Promise<{success: boolean, message: string}>}
 */
async function importConfiguration(jsonStr) {
  try {
    const parsed = JSON.parse(jsonStr);
    const dataToRestore = parsed.data || parsed;
    if (typeof dataToRestore !== 'object' || dataToRestore === null) {
      throw new Error('Invalid backup format: data object missing');
    }
    await storageSet(dataToRestore);
    return { success: true, message: 'Configuration restored successfully.' };
  } catch (err) {
    return { success: false, message: `Import failed: ${err.message}` };
  }
}

/**
 * Clears all site zoom rules and resets configuration.
 */
async function clearAllData() {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    return new Promise((resolve) => {
      chrome.storage.local.clear(() => resolve());
    });
  }
}

// Support both ES Module and CommonJS for testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DEFAULT_SETTINGS,
    STORAGE_KEYS,
    getSiteKeyFromUrl,
    normalizeZoomFactor,
    getEffectiveZoom,
    saveSiteZoom,
    deleteSiteZoom,
    getAllSiteZooms,
    saveDisplayDefault,
    deleteDisplayDefault,
    getDisplayDefaults,
    recordDisplayMetadata,
    getDisplayMetadata,
    getSettings,
    saveSettings,
    exportConfiguration,
    importConfiguration,
    clearAllData
  };
}
