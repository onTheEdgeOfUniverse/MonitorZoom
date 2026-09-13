/**
 * MonitorZoom - Options Page & Management Dashboard
 */

let state = {
  allSiteZooms: {},
  displayDefaults: {},
  metadata: {},
  settings: {},
  displays: []
};

// DOM Elements
const navItems = document.querySelectorAll('.nav-item');
const tabContents = document.querySelectorAll('.tab-content');
const toastEl = document.getElementById('toast');

// Rules Tab
const rulesTableBody = document.getElementById('rules-table-body');
const rulesEmptyState = document.getElementById('rules-empty-state');
const ruleSearchInput = document.getElementById('rule-search-input');

// Monitors Tab
const monitorsCardsGrid = document.getElementById('monitors-cards-grid');

// Settings Tab
const settingEnabled = document.getElementById('setting-enabled');
const settingAutoApply = document.getElementById('setting-auto-apply');
const settingBadge = document.getElementById('setting-badge');
const settingApplyOnLoad = document.getElementById('setting-apply-on-load');
const settingOnlyDiff = document.getElementById('setting-only-diff');
const settingStepSize = document.getElementById('setting-step-size');

// Backup Tab
const exportBtn = document.getElementById('export-btn');
const importFileInput = document.getElementById('import-file-input');
const importBtn = document.getElementById('import-btn');
const clearAllBtn = document.getElementById('clear-all-btn');

function showToast(message, duration = 3000) {
  toastEl.textContent = message;
  toastEl.classList.remove('hidden');
  toastEl.style.opacity = '1';

  setTimeout(() => {
    toastEl.style.opacity = '0';
    setTimeout(() => toastEl.classList.add('hidden'), 300);
  }, duration);
}

function getDisplayFriendlyName(displayKey) {
  // Check active displays first
  const active = state.displays.find(d => d.id === displayKey);
  if (active) {
    const name = active.name || 'Display';
    const res = active.bounds ? `${active.bounds.width}×${active.bounds.height}` : '';
    const tag = active.isPrimary ? 'Primary' : '';
    const details = [tag, res].filter(Boolean).join(' · ');
    return details ? `${name} (${details})` : name;
  }

  // Check stored metadata
  if (state.metadata && state.metadata[displayKey]) {
    const meta = state.metadata[displayKey];
    const name = meta.name || 'Display';
    const res = meta.bounds ? `${meta.bounds.width}×${meta.bounds.height}` : '';
    const tag = meta.isPrimary ? 'Primary' : '';
    const details = [tag, res].filter(Boolean).join(' · ');
    return details ? `${name} (${details})` : name;
  }

  return displayKey;
}

// -------------------------------------------------------------
// Tab Switching
// -------------------------------------------------------------

navItems.forEach((btn) => {
  btn.addEventListener('click', () => {
    const targetTabId = btn.getAttribute('data-tab');

    navItems.forEach(b => b.classList.remove('active'));
    tabContents.forEach(c => c.classList.remove('active'));

    btn.classList.add('active');
    const targetContent = document.getElementById(targetTabId);
    if (targetContent) {
      targetContent.classList.add('active');
    }
  });
});

// -------------------------------------------------------------
// Rules Table
// -------------------------------------------------------------

function renderRulesTable() {
  const query = (ruleSearchInput.value || '').trim().toLowerCase();
  rulesTableBody.innerHTML = '';

  const siteZooms = state.allSiteZooms || {};
  const siteKeys = Object.keys(siteZooms).sort();
  let rowCount = 0;

  siteKeys.forEach((siteKey) => {
    if (query && !siteKey.toLowerCase().includes(query)) return;

    const displayMap = siteZooms[siteKey];
    Object.keys(displayMap).forEach((displayKey) => {
      rowCount++;
      const zoomFactor = displayMap[displayKey];
      const percentStr = `${Math.round(zoomFactor * 100)}%`;

      const tr = document.createElement('tr');

      // Domain
      const tdDomain = document.createElement('td');
      tdDomain.className = 'domain-cell';
      tdDomain.textContent = siteKey;
      tr.appendChild(tdDomain);

      // Display
      const tdDisplay = document.createElement('td');
      const badge = document.createElement('span');
      badge.className = 'display-badge';
      badge.textContent = getDisplayFriendlyName(displayKey);
      tdDisplay.appendChild(badge);
      tr.appendChild(tdDisplay);

      // Zoom
      const tdZoom = document.createElement('td');
      const zoomBadge = document.createElement('span');
      zoomBadge.className = 'zoom-badge';
      zoomBadge.textContent = percentStr;
      tdZoom.appendChild(zoomBadge);
      tr.appendChild(tdZoom);

      // Action: Delete
      const tdAction = document.createElement('td');
      tdAction.className = 'text-right';

      const delBtn = document.createElement('button');
      delBtn.className = 'btn-icon';
      delBtn.title = 'Delete this rule';
      delBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
      `;

      delBtn.addEventListener('click', async () => {
        const confirmed = confirm(`Delete zoom rule for "${siteKey}" on this monitor?`);
        if (!confirmed) return;

        await new Promise(resolve => {
          chrome.runtime.sendMessage({
            type: 'DELETE_SITE_RULE',
            siteKey,
            displayKey
          }, resolve);
        });

        delete state.allSiteZooms[siteKey][displayKey];
        if (Object.keys(state.allSiteZooms[siteKey]).length === 0) {
          delete state.allSiteZooms[siteKey];
        }
        renderRulesTable();
        showToast(`Rule deleted for ${siteKey}`);
      });

      tdAction.appendChild(delBtn);
      tr.appendChild(tdAction);

      rulesTableBody.appendChild(tr);
    });
  });

  if (rowCount === 0) {
    rulesEmptyState.classList.remove('hidden');
  } else {
    rulesEmptyState.classList.add('hidden');
  }
}

ruleSearchInput.addEventListener('input', renderRulesTable);

// -------------------------------------------------------------
// Monitor Defaults Tab
// -------------------------------------------------------------

function renderMonitorsGrid() {
  monitorsCardsGrid.innerHTML = '';

  const displayList = state.displays.length > 0 ? state.displays : Object.values(state.metadata || {});
  const defaults = state.displayDefaults || {};

  if (!displayList || displayList.length === 0) {
    monitorsCardsGrid.innerHTML = '<div class="empty-state">No displays currently detected.</div>';
    return;
  }

  displayList.forEach((display, index) => {
    const key = display.id;
    const currentDefault = defaults[key] || 1.0;
    const card = document.createElement('div');
    card.className = 'monitor-card';

    const header = document.createElement('div');
    header.className = 'monitor-card-header';

    const info = document.createElement('div');
    const title = document.createElement('h3');
    title.className = 'monitor-card-title';
    title.textContent = display.name || `Display ${index + 1}`;

    const subtitle = document.createElement('div');
    subtitle.className = 'monitor-card-subtitle';
    const res = display.bounds ? `${display.bounds.width}×${display.bounds.height}` : '';
    const primary = display.isPrimary ? 'Primary Display' : 'Secondary Display';
    subtitle.textContent = [primary, res].filter(Boolean).join(' · ');

    info.appendChild(title);
    info.appendChild(subtitle);
    header.appendChild(info);
    card.appendChild(header);

    // Input row
    const inputRow = document.createElement('div');
    inputRow.className = 'monitor-input-row';

    const label = document.createElement('span');
    label.style.fontSize = '14px';
    label.style.fontWeight = '500';
    label.textContent = 'Baseline Default Zoom:';

    const select = document.createElement('select');
    select.className = 'select-input';

    const options = [
      { val: 0.80, label: '80%' },
      { val: 0.90, label: '90%' },
      { val: 1.00, label: '100% (Default)' },
      { val: 1.10, label: '110%' },
      { val: 1.25, label: '125%' },
      { val: 1.50, label: '150%' },
      { val: 1.75, label: '175%' },
      { val: 2.00, label: '200%' }
    ];

    options.forEach(opt => {
      const optionEl = document.createElement('option');
      optionEl.value = opt.val;
      optionEl.textContent = opt.label;
      if (Math.abs(opt.val - currentDefault) < 0.01) {
        optionEl.selected = true;
      }
      select.appendChild(optionEl);
    });

    select.addEventListener('change', async () => {
      const newFactor = parseFloat(select.value);
      await new Promise(resolve => {
        chrome.runtime.sendMessage({
          type: 'SAVE_DISPLAY_DEFAULT',
          displayKey: key,
          zoomFactor: newFactor
        }, resolve);
      });
      state.displayDefaults[key] = newFactor;
      showToast(`Default zoom for ${display.name || 'display'} set to ${Math.round(newFactor * 100)}%`);
    });

    inputRow.appendChild(label);
    inputRow.appendChild(select);
    card.appendChild(inputRow);

    monitorsCardsGrid.appendChild(card);
  });
}

// -------------------------------------------------------------
// Settings Tab
// -------------------------------------------------------------

function populateSettings() {
  const s = state.settings || {};
  settingEnabled.checked = s.enabled !== false;
  settingAutoApply.checked = s.autoApplyOnMove !== false;
  settingBadge.checked = s.showBadge !== false;
  settingApplyOnLoad.checked = s.applyOnSiteLoad !== false;
  settingOnlyDiff.checked = s.onlyApplyOnDifference !== false;
  settingStepSize.value = (s.stepSize || 0.10).toFixed(2);
}

async function handleSettingChange() {
  const newSettings = {
    enabled: settingEnabled.checked,
    autoApplyOnMove: settingAutoApply.checked,
    showBadge: settingBadge.checked,
    applyOnSiteLoad: settingApplyOnLoad.checked,
    onlyApplyOnDifference: settingOnlyDiff.checked,
    stepSize: parseFloat(settingStepSize.value)
  };

  await new Promise(resolve => {
    chrome.runtime.sendMessage({
      type: 'UPDATE_SETTINGS',
      settings: newSettings
    }, resolve);
  });

  state.settings = newSettings;
  showToast('Settings saved');
}

settingEnabled.addEventListener('change', handleSettingChange);
settingAutoApply.addEventListener('change', handleSettingChange);
settingBadge.addEventListener('change', handleSettingChange);
settingApplyOnLoad.addEventListener('change', handleSettingChange);
settingOnlyDiff.addEventListener('change', handleSettingChange);
settingStepSize.addEventListener('change', handleSettingChange);

// -------------------------------------------------------------
// Backup & Restore
// -------------------------------------------------------------

exportBtn.addEventListener('click', async () => {
  const res = await new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'EXPORT_BACKUP' }, resolve);
  });

  if (res && res.success) {
    const blob = new Blob([res.data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `monitorzoom-backup-${date}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Backup file exported');
  }
});

importBtn.addEventListener('click', () => {
  const file = importFileInput.files[0];
  if (!file) {
    alert('Please select a JSON backup file first.');
    return;
  }

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const content = e.target.result;
      const res = await new Promise(resolve => {
        chrome.runtime.sendMessage({
          type: 'IMPORT_BACKUP',
          jsonStr: content
        }, resolve);
      });

      if (res && res.success) {
        showToast('Backup restored successfully!');
        await loadAllConfig();
      } else {
        alert(res ? res.message : 'Import failed');
      }
    } catch (err) {
      alert(`Failed to parse file: ${err.message}`);
    }
  };
  reader.readAsText(file);
});

clearAllBtn.addEventListener('click', async () => {
  const confirmed = confirm(
    'Are you sure you want to delete ALL saved site rules and preferences? This cannot be undone.'
  );
  if (!confirmed) return;

  await new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'CLEAR_ALL_DATA' }, resolve);
  });

  showToast('All data has been cleared.');
  await loadAllConfig();
});

// -------------------------------------------------------------
// Initialization
// -------------------------------------------------------------

async function loadAllConfig() {
  try {
    const res = await new Promise(resolve => {
      chrome.runtime.sendMessage({ type: 'GET_ALL_CONFIG' }, resolve);
    });

    if (res) {
      state = Object.assign(state, res);
      renderRulesTable();
      renderMonitorsGrid();
      populateSettings();
    }
  } catch (err) {
    console.error('Failed to load configuration:', err);
  }
}

document.addEventListener('DOMContentLoaded', loadAllConfig);
