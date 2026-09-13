/**
 * MonitorZoom - Display Manager
 * Manages monitor detection, coordinate mapping, and display identification.
 */

/**
 * Calculates a unique, stable fingerprint for a display.
 * Used for fallback matching if display IDs fluctuate across reboots.
 * @param {chrome.system.display.DisplayUnitInfo} display
 * @returns {string}
 */
function getDisplayFingerprint(display) {
  const name = (display.name || 'Display').trim();
  const width = display.bounds ? display.bounds.width : 0;
  const height = display.bounds ? display.bounds.height : 0;
  const primary = display.isPrimary ? 'primary' : 'secondary';
  return `${name}_${width}x${height}_${primary}`.toLowerCase().replace(/\s+/g, '_');
}

/**
 * Generates the primary key used to index display zoom settings.
 * Prefers display.id, with fallback to fingerprint.
 * @param {chrome.system.display.DisplayUnitInfo} display
 * @returns {string}
 */
function getDisplayKey(display) {
  if (!display) return 'default_display';
  return display.id || getDisplayFingerprint(display);
}

/**
 * Generates a human-friendly display label for UI representation.
 * e.g., "Display 1 (Primary · 2560×1440)"
 * @param {chrome.system.display.DisplayUnitInfo} display
 * @param {number} [index]
 * @returns {string}
 */
function getDisplayLabel(display, index) {
  if (!display) return 'Unknown Display';
  const name = display.name ? display.name.trim() : (index !== undefined ? `Display ${index + 1}` : 'Display');
  const width = display.bounds ? display.bounds.width : 0;
  const height = display.bounds ? display.bounds.height : 0;
  const res = width && height ? `${width}×${height}` : '';
  const primaryTag = display.isPrimary ? 'Primary' : '';
  
  const details = [primaryTag, res].filter(Boolean).join(' · ');
  return details ? `${name} (${details})` : name;
}

/**
 * Determines which display a given window belongs to using center-point
 * and bounding-box intersection area algorithms.
 *
 * @param {chrome.windows.Window|{left: number, top: number, width: number, height: number}} window
 * @param {Array<chrome.system.display.DisplayUnitInfo>} displays
 * @returns {chrome.system.display.DisplayUnitInfo|null}
 */
function findDisplayForWindow(window, displays) {
  if (!displays || displays.length === 0) return null;
  if (displays.length === 1) return displays[0];

  // If window bounds are missing (e.g. minimized window), fallback to primary display
  if (!window || typeof window.left !== 'number' || typeof window.top !== 'number' ||
      typeof window.width !== 'number' || typeof window.height !== 'number') {
    return displays.find(d => d.isPrimary) || displays[0];
  }

  const winLeft = window.left;
  const winTop = window.top;
  const winWidth = Math.max(1, window.width);
  const winHeight = Math.max(1, window.height);
  const winRight = winLeft + winWidth;
  const winBottom = winTop + winHeight;

  // 1. Primary Strategy: Check if the window center falls within a display's bounds
  const centerX = winLeft + winWidth / 2;
  const centerY = winTop + winHeight / 2;

  for (const display of displays) {
    if (!display.bounds) continue;
    const { left, top, width, height } = display.bounds;
    if (centerX >= left && centerX < left + width &&
        centerY >= top && centerY < top + height) {
      return display;
    }
  }

  // 2. Secondary Strategy: Calculate intersection area between window and each display
  let bestDisplay = null;
  let maxArea = -1;

  for (const display of displays) {
    if (!display.bounds) continue;
    const { left, top, width, height } = display.bounds;
    const dispRight = left + width;
    const dispBottom = top + height;

    const overlapX = Math.max(0, Math.min(winRight, dispRight) - Math.max(winLeft, left));
    const overlapY = Math.max(0, Math.min(winBottom, dispBottom) - Math.max(winTop, top));
    const area = overlapX * overlapY;

    if (area > maxArea) {
      maxArea = area;
      bestDisplay = display;
    }
  }

  if (bestDisplay && maxArea > 0) {
    return bestDisplay;
  }

  // 3. Fallback: Return primary display or first available display
  return displays.find(d => d.isPrimary) || displays[0];
}

/**
 * Retrieves all displays from chrome.system.display API safely.
 * @returns {Promise<Array<chrome.system.display.DisplayUnitInfo>>}
 */
async function getAllDisplays() {
  if (typeof chrome !== 'undefined' && chrome.system && chrome.system.display && chrome.system.display.getInfo) {
    return new Promise((resolve) => {
      chrome.system.display.getInfo((displays) => {
        resolve(displays || []);
      });
    });
  }
  return [];
}

// Support both ES Module and CommonJS for testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getDisplayFingerprint,
    getDisplayKey,
    getDisplayLabel,
    findDisplayForWindow,
    getAllDisplays
  };
}
