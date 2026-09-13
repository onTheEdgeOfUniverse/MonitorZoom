/**
 * MonitorZoom - Popup Controller
 * Manages active tab state, monitor display, and interactive zoom manipulation.
 */

let currentContext = null;

// DOM Elements
const restrictedBanner = document.getElementById('restricted-banner');
const activeContent = document.getElementById('active-content');
const siteKeyDisplay = document.getElementById('site-key-display');
const monitorNameDisplay = document.getElementById('monitor-name-display');
const sourceBadge = document.getElementById('source-badge');
const zoomPercentage = document.getElementById('zoom-percentage');
const zoomDecBtn = document.getElementById('zoom-dec-btn');
const zoomIncBtn = document.getElementById('zoom-inc-btn');
const resetZoomBtn = document.getElementById('reset-zoom-btn');
const syncAllBtn = document.getElementById('sync-all-btn');
const monitorsList = document.getElementById('monitors-list');
const openOptionsBtn = document.getElementById('open-options-btn');
const footerDashboardLink = document.getElementById('footer-dashboard-link');
const presetPills = document.querySelectorAll('.preset-pill');

function formatPercent(factor) {
  return `${Math.round(factor * 100)}%`;
}

function getDisplayTitle(display, index) {
  if (!display) return 'Display';
  const name = display.name ? display.name.trim() : `Display ${index + 1}`;
  const width = display.bounds ? display.bounds.width : 0;
  const height = display.bounds ? display.bounds.height : 0;
  const res = width && height ? `${width}×${height}` : '';
  const primaryTag = display.isPrimary ? 'Primary' : '';
  const details = [primaryTag, res].filter(Boolean).join(' · ');
  return details ? `${name} (${details})` : name;
}

function updatePresetPills(currentFactor) {
  const rounded = Math.round(currentFactor * 100) / 100;
  presetPills.forEach((pill) => {
    const pillFactor = parseFloat(pill.getAttribute('data-factor'));
    if (Math.abs(pillFactor - rounded) < 0.01) {
      pill.classList.add('active');
    } else {
      pill.classList.remove('active');
    }
  });
}

function renderMonitorsList(context) {
  monitorsList.innerHTML = '';
  const displays = context.displays || [];
  const activeKey = context.activeDisplayKey;
  const siteRules = context.siteRules || {};
  const defaults = context.displayDefaults || {};

  displays.forEach((display, index) => {
    const key = display.id;
    const isCurrent = key === activeKey;
    const savedFactor = siteRules[key] || defaults[key] || 1.0;

    const item = document.createElement('div');
    item.className = `monitor-item ${isCurrent ? 'active' : ''}`;

    const left = document.createElement('div');
    left.className = 'monitor-item-left';

    const icon = document.createElement('span');
    icon.textContent = '🖥️';
    left.appendChild(icon);

    const name = document.createElement('span');
    name.className = 'monitor-item-name';
    name.textContent = getDisplayTitle(display, index);
    left.appendChild(name);

    if (isCurrent) {
      const tag = document.createElement('span');
      tag.className = 'current-tag';
      tag.textContent = 'Current';
      left.appendChild(tag);
    }

    const right = document.createElement('span');
    right.className = 'monitor-item-zoom';
    right.textContent = formatPercent(savedFactor);

    item.appendChild(left);
    item.appendChild(right);
    monitorsList.appendChild(item);
  });
}

function updateUI(context) {
  currentContext = context;

  if (context.isRestricted) {
    restrictedBanner.classList.remove('hidden');
    siteKeyDisplay.textContent = 'Browser System Tab';
    monitorNameDisplay.textContent = 'Restricted';
    zoomPercentage.textContent = '100%';
    zoomDecBtn.disabled = true;
    zoomIncBtn.disabled = true;
    resetZoomBtn.disabled = true;
    syncAllBtn.disabled = true;
    presetPills.forEach(p => p.disabled = true);
    return;
  }

  restrictedBanner.classList.add('hidden');
  zoomDecBtn.disabled = false;
  zoomIncBtn.disabled = false;
  resetZoomBtn.disabled = false;
  syncAllBtn.disabled = false;
  presetPills.forEach(p => p.disabled = false);

  // Site Key
  siteKeyDisplay.textContent = context.siteKey || 'Unknown Site';

  // Active Monitor
  if (context.activeDisplay) {
    monitorNameDisplay.textContent = getDisplayTitle(context.activeDisplay, 0);
  } else {
    monitorNameDisplay.textContent = 'Main Monitor';
  }

  // Zoom Value
  const factor = context.currentZoom || context.effectiveZoom || 1.0;
  zoomPercentage.textContent = formatPercent(factor);

  // Source Badge
  if (context.effectiveSource === 'site') {
    sourceBadge.textContent = 'Saved for Screen';
    sourceBadge.style.color = 'var(--accent-color)';
  } else if (context.effectiveSource === 'display_default') {
    sourceBadge.textContent = 'Monitor Default';
    sourceBadge.style.color = 'var(--text-secondary)';
  } else {
    sourceBadge.textContent = 'Default (100%)';
    sourceBadge.style.color = 'var(--text-secondary)';
  }

  // Presets & Monitors List
  updatePresetPills(factor);
  renderMonitorsList(context);
}

async function loadContext() {
  try {
    const res = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'GET_ACTIVE_CONTEXT' }, resolve);
    });

    if (res && !res.error) {
      updateUI(res);
    } else {
      console.error('Failed to get context:', res ? res.error : 'No response');
    }
  } catch (err) {
    console.error('Error contacting background:', err);
  }
}

async function applyNewZoom(targetFactor) {
  if (!currentContext || currentContext.isRestricted) return;

  const step = Math.round(targetFactor * 100) / 100;
  // Bound zoom between 25% and 500%
  const clamped = Math.min(5.0, Math.max(0.25, step));

  zoomPercentage.textContent = formatPercent(clamped);
  updatePresetPills(clamped);

  const res = await new Promise((resolve) => {
    chrome.runtime.sendMessage({
      type: 'SET_TAB_ZOOM',
      tabId: currentContext.tabId,
      siteKey: currentContext.siteKey,
      displayKey: currentContext.activeDisplayKey,
      zoomFactor: clamped
    }, resolve);
  });

  if (res && res.success) {
    currentContext.currentZoom = clamped;
    currentContext.effectiveSource = 'site';
    sourceBadge.textContent = 'Saved for Screen';
    sourceBadge.style.color = 'var(--accent-color)';

    if (currentContext.siteRules) {
      currentContext.siteRules[currentContext.activeDisplayKey] = clamped;
    }
    renderMonitorsList(currentContext);
  }
}

// -------------------------------------------------------------
// Button Event Listeners
// -------------------------------------------------------------

zoomDecBtn.addEventListener('click', () => {
  if (!currentContext) return;
  const current = currentContext.currentZoom || 1.0;
  const step = (currentContext.settings && currentContext.settings.stepSize) || 0.1;
  applyNewZoom(current - step);
});

zoomIncBtn.addEventListener('click', () => {
  if (!currentContext) return;
  const current = currentContext.currentZoom || 1.0;
  const step = (currentContext.settings && currentContext.settings.stepSize) || 0.1;
  applyNewZoom(current + step);
});

presetPills.forEach((pill) => {
  pill.addEventListener('click', () => {
    const factor = parseFloat(pill.getAttribute('data-factor'));
    applyNewZoom(factor);
  });
});

resetZoomBtn.addEventListener('click', async () => {
  if (!currentContext || currentContext.isRestricted) return;

  const res = await new Promise((resolve) => {
    chrome.runtime.sendMessage({
      type: 'RESET_TAB_ZOOM',
      tabId: currentContext.tabId,
      siteKey: currentContext.siteKey,
      displayKey: currentContext.activeDisplayKey
    }, resolve);
  });

  if (res && res.success) {
    await loadContext();
  }
});

syncAllBtn.addEventListener('click', async () => {
  if (!currentContext || currentContext.isRestricted) return;

  const currentFactor = currentContext.currentZoom || 1.0;
  const displays = currentContext.displays || [];

  for (const display of displays) {
    const key = display.id;
    await new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: 'SET_TAB_ZOOM',
        siteKey: currentContext.siteKey,
        displayKey: key,
        zoomFactor: currentFactor
      }, resolve);
    });
  }

  await loadContext();
});

function openDashboard(e) {
  if (e) e.preventDefault();
  chrome.runtime.openOptionsPage();
}

openOptionsBtn.addEventListener('click', openDashboard);
footerDashboardLink.addEventListener('click', openDashboard);

// Listen for background zoom broadcast (e.g. keyboard zoom)
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'ZOOM_UPDATED' && currentContext && message.tabId === currentContext.tabId) {
    currentContext.currentZoom = message.zoomFactor;
    zoomPercentage.textContent = formatPercent(message.zoomFactor);
    updatePresetPills(message.zoomFactor);
    sourceBadge.textContent = 'Saved for Screen';
    if (currentContext.siteRules) {
      currentContext.siteRules[message.displayKey] = message.zoomFactor;
    }
    renderMonitorsList(currentContext);
  }
});

// Initialize
document.addEventListener('DOMContentLoaded', loadContext);
