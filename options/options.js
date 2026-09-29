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
const rulesTableHead = document.getElementById('rules-table-head');
const rulesTableBody = document.getElementById('rules-table-body');
const rulesEmptyState = document.getElementById('rules-empty-state');
const ruleSearchInput = document.getElementById('rule-search-input');
const viewModeMatrixBtn = document.getElementById('view-mode-matrix');
const viewModeListBtn = document.getElementById('view-mode-list');

let currentViewMode = 'matrix'; // 'matrix' (Display Columns) or 'list' (Flat List)

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

/**
 * Formats a display fingerprint into a human-readable display label.
 * e.g., "dell_u2720q_2560x1440_primary" -> "Dell U2720q (Primary · 2560×1440)"
 */
function formatFingerprintName(fingerprint) {
  if (!fingerprint || typeof fingerprint !== 'string') return 'Display';
  const match = fingerprint.match(/^(.*?)_(\d+x\d+)_(primary|secondary)$/i);
  if (match) {
    const rawName = match[1].replace(/_/g, ' ');
    const name = rawName.charAt(0).toUpperCase() + rawName.slice(1);
    const res = match[2].replace('x', '×');
    const isPrimary = match[3].toLowerCase() === 'primary';
    const tag = isPrimary ? 'Primary' : '';
    const details = [tag, res].filter(Boolean).join(' · ');
    return details ? `${name} (${details})` : name;
  }
  return fingerprint.replace(/_/g, ' ');
}

function getDisplayFingerprint(display) {
  if (!display) return 'default_display';
  const name = (display.name || 'Display').trim();
  const width = display.bounds ? display.bounds.width : 0;
  const height = display.bounds ? display.bounds.height : 0;
  const primary = display.isPrimary ? 'primary' : 'secondary';
  return `${name}_${width}x${height}_${primary}`.toLowerCase().replace(/\s+/g, '_');
}

function getDisplayFriendlyName(displayKey) {
  // Check active displays first
  const active = state.displays.find(d => String(d.id) === String(displayKey) || getDisplayFingerprint(d) === displayKey);
  if (active) {
    const name = active.name ? active.name.trim() : 'Display';
    const res = active.bounds ? `${active.bounds.width}×${active.bounds.height}` : '';
    const tag = active.isPrimary ? 'Primary' : '';
    const details = [tag, res].filter(Boolean).join(' · ');
    return details ? `${name} (${details})` : name;
  }

  // Check stored metadata
  if (state.metadata && state.metadata[displayKey]) {
    const meta = state.metadata[displayKey];
    const name = meta.name ? meta.name.trim() : 'Display';
    const res = meta.bounds ? `${meta.bounds.width}×${meta.bounds.height}` : '';
    const tag = meta.isPrimary ? 'Primary' : '';
    const details = [tag, res].filter(Boolean).join(' · ');
    return details ? `${name} (${details})` : name;
  }

  // Check if any metadata entry has matching fingerprint
  if (state.metadata) {
    for (const meta of Object.values(state.metadata)) {
      if (getDisplayFingerprint(meta) === displayKey) {
        const name = meta.name ? meta.name.trim() : 'Display';
        const res = meta.bounds ? `${meta.bounds.width}×${meta.bounds.height}` : '';
        const tag = meta.isPrimary ? 'Primary' : '';
        const details = [tag, res].filter(Boolean).join(' · ');
        return details ? `${name} (${details})` : name;
      }
    }
  }

  // Fallback to formatted fingerprint if snake_case
  if (displayKey && displayKey.includes('_')) {
    return formatFingerprintName(displayKey);
  }

  return displayKey || 'Display';
}

/**
 * Builds a deduplicated, ordered list of all known displays
 * across active displays, stored metadata, and saved site rules.
 */
function getKnownDisplays() {
  const displaysMap = new Map(); // fingerprint -> displayObject

  // 1. Add active displays
  if (state.displays && state.displays.length > 0) {
    state.displays.forEach((d, idx) => {
      const fp = getDisplayFingerprint(d);
      const key = d.id || fp;
      const res = d.bounds ? `${d.bounds.width}×${d.bounds.height}` : '';
      displaysMap.set(fp, {
        id: d.id,
        key: key,
        fingerprint: fp,
        name: d.name ? d.name.trim() : `Display ${idx + 1}`,
        res: res,
        isPrimary: Boolean(d.isPrimary),
        isActive: true,
        aliases: new Set([String(d.id), key, fp].filter(Boolean))
      });
    });
  }

  // 2. Add displays from metadata if not already covered
  if (state.metadata) {
    Object.entries(state.metadata).forEach(([metaKey, meta]) => {
      const fp = getDisplayFingerprint(meta);
      const res = meta.bounds ? `${meta.bounds.width}×${meta.bounds.height}` : '';
      if (displaysMap.has(fp)) {
        displaysMap.get(fp).aliases.add(metaKey);
        if (meta.id) displaysMap.get(fp).aliases.add(String(meta.id));
      } else {
        displaysMap.set(fp, {
          id: meta.id || metaKey,
          key: metaKey,
          fingerprint: fp,
          name: meta.name ? meta.name.trim() : 'Display',
          res: res,
          isPrimary: Boolean(meta.isPrimary),
          isActive: false,
          aliases: new Set([metaKey, String(meta.id), fp].filter(Boolean))
        });
      }
    });
  }

  // 3. Inspect allSiteZooms for any additional display keys
  const siteZooms = state.allSiteZooms || {};
  Object.values(siteZooms).forEach((displayMap) => {
    Object.keys(displayMap).forEach((dispKey) => {
      let matched = false;
      for (const d of displaysMap.values()) {
        if (d.aliases.has(dispKey) || d.key === dispKey || String(d.id) === String(dispKey) || d.fingerprint === dispKey) {
          d.aliases.add(dispKey);
          matched = true;
          break;
        }
      }

      if (!matched) {
        const isFp = dispKey.includes('_');
        const friendly = isFp ? formatFingerprintName(dispKey) : `Display (${dispKey})`;
        displaysMap.set(dispKey, {
          id: dispKey,
          key: dispKey,
          fingerprint: dispKey,
          name: friendly,
          res: '',
          isPrimary: false,
          isActive: false,
          aliases: new Set([dispKey])
        });
      }
    });
  });

  // Sort: Primary first, then active displays, then alphabetically
  return Array.from(displaysMap.values()).sort((a, b) => {
    if (a.isPrimary && !b.isPrimary) return -1;
    if (!a.isPrimary && b.isPrimary) return 1;
    if (a.isActive && !b.isActive) return -1;
    if (!a.isActive && b.isActive) return 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Returns zoom factor and all matching alias keys for a display on a site.
 */
function getSiteZoomForDisplay(siteKey, display) {
  const displayMap = (state.allSiteZooms && state.allSiteZooms[siteKey]) || {};
  const matchedKeys = [];
  let foundFactor = null;

  for (const alias of display.aliases) {
    if (typeof displayMap[alias] === 'number') {
      matchedKeys.push(alias);
      if (foundFactor === null) {
        foundFactor = displayMap[alias];
      }
    }
  }

  if (foundFactor !== null) {
    return { factor: foundFactor, keys: matchedKeys };
  }
  return null;
}

/**
 * Automatically consolidates duplicate/rotated display keys in storage.
 */
async function deduplicateSiteZooms() {
  const siteZooms = state.allSiteZooms || {};
  const knownDisplays = getKnownDisplays();
  let hasChanges = false;

  for (const siteKey of Object.keys(siteZooms)) {
    const displayMap = siteZooms[siteKey];
    for (const display of knownDisplays) {
      const match = getSiteZoomForDisplay(siteKey, display);
      if (match && match.keys.length > 1) {
        hasChanges = true;
        const primaryKey = display.key;
        const targetFactor = match.factor;
        match.keys.forEach((k) => {
          if (k !== primaryKey) {
            delete displayMap[k];
          }
        });
        displayMap[primaryKey] = targetFactor;
      }
    }
  }

  if (hasChanges) {
    chrome.runtime.sendMessage({
      type: 'SET_ALL_SITE_ZOOMS',
      siteZooms: state.allSiteZooms
    }).catch(() => {});
  }
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

// View mode toggle listeners
if (viewModeMatrixBtn && viewModeListBtn) {
  viewModeMatrixBtn.addEventListener('click', () => {
    currentViewMode = 'matrix';
    viewModeMatrixBtn.classList.add('active');
    viewModeListBtn.classList.remove('active');
    renderRulesTable();
  });

  viewModeListBtn.addEventListener('click', () => {
    currentViewMode = 'list';
    viewModeListBtn.classList.add('active');
    viewModeMatrixBtn.classList.remove('active');
    renderRulesTable();
  });
}

// -------------------------------------------------------------
// Rules Table (Display Columns & Flat List views)
// -------------------------------------------------------------

function renderRulesTable() {
  const query = (ruleSearchInput.value || '').trim().toLowerCase();
  rulesTableHead.innerHTML = '';
  rulesTableBody.innerHTML = '';

  const siteZooms = state.allSiteZooms || {};
  let siteKeys = Object.keys(siteZooms).sort();

  if (query) {
    siteKeys = siteKeys.filter(k => k.toLowerCase().includes(query));
  }

  const knownDisplays = getKnownDisplays();

  // If no site rules at all (or all filtered out)
  if (siteKeys.length === 0) {
    rulesEmptyState.classList.remove('hidden');
    return;
  }
  rulesEmptyState.classList.add('hidden');

  if (currentViewMode === 'matrix') {
    renderMatrixView(siteKeys, knownDisplays);
  } else {
    renderListView(siteKeys, knownDisplays);
  }
}

/**
 * Display Columns (Matrix View): One row per site, each display gets its own column.
 * Completely eliminates duplicate domain rows!
 */
function renderMatrixView(siteKeys, knownDisplays) {
  const headerTr = document.createElement('tr');

  // Website Domain Column
  const thDomain = document.createElement('th');
  thDomain.textContent = 'Website Domain';
  thDomain.style.width = '240px';
  headerTr.appendChild(thDomain);

  // Each Display Column
  knownDisplays.forEach((disp) => {
    const thDisp = document.createElement('th');
    thDisp.className = 'display-col-th';

    const cell = document.createElement('div');
    cell.className = 'display-header-cell';

    const icon = document.createElement('span');
    icon.className = 'display-header-icon';
    icon.textContent = '🖥️';

    const info = document.createElement('div');
    info.className = 'display-header-info';

    const nameEl = document.createElement('div');
    nameEl.className = 'display-header-name';
    nameEl.textContent = disp.name;

    if (disp.isPrimary) {
      const pill = document.createElement('span');
      pill.className = 'display-primary-pill';
      pill.textContent = 'Primary';
      nameEl.appendChild(pill);
    } else if (!disp.isActive) {
      const pill = document.createElement('span');
      pill.className = 'display-inactive-pill';
      pill.textContent = 'Saved';
      nameEl.appendChild(pill);
    }

    const metaEl = document.createElement('div');
    metaEl.className = 'display-header-meta';
    const metaParts = [];
    if (disp.res) metaParts.push(disp.res);
    metaParts.push(disp.isActive ? 'Connected' : 'Offline');
    metaEl.textContent = metaParts.join(' · ');

    info.appendChild(nameEl);
    info.appendChild(metaEl);
    cell.appendChild(icon);
    cell.appendChild(info);
    thDisp.appendChild(cell);
    headerTr.appendChild(thDisp);
  });

  // Actions Column
  const thAction = document.createElement('th');
  thAction.className = 'text-right';
  thAction.textContent = 'Actions';
  thAction.style.width = '90px';
  headerTr.appendChild(thAction);

  rulesTableHead.appendChild(headerTr);

  // Table Body Rows (One row per siteKey - ZERO duplicates!)
  siteKeys.forEach((siteKey) => {
    const tr = document.createElement('tr');

    // Domain
    const tdDomain = document.createElement('td');
    tdDomain.className = 'domain-cell';
    tdDomain.textContent = siteKey;
    tr.appendChild(tdDomain);

    // Columns for each display
    knownDisplays.forEach((disp) => {
      const tdDisp = document.createElement('td');
      tdDisp.className = 'display-zoom-cell';

      const zoomData = getSiteZoomForDisplay(siteKey, disp);

      if (zoomData) {
        const percentStr = `${Math.round(zoomData.factor * 100)}%`;

        const pillGroup = document.createElement('div');
        pillGroup.className = 'zoom-pill-group';

        const badge = document.createElement('span');
        badge.className = 'zoom-badge';
        badge.textContent = percentStr;
        badge.title = 'Click to edit zoom level';

        // Inline edit on badge click
        badge.addEventListener('click', (e) => {
          e.stopPropagation();
          showInlineZoomPicker(pillGroup, siteKey, disp, zoomData.factor);
        });

        // Delete button for this display
        const removeBtn = document.createElement('button');
        removeBtn.className = 'btn-remove-rule';
        removeBtn.title = `Delete zoom rule on ${disp.name}`;
        removeBtn.innerHTML = `
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        `;

        removeBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const confirmed = confirm(`Delete zoom rule for "${siteKey}" on ${disp.name}?`);
          if (!confirmed) return;

          await new Promise(resolve => {
            chrome.runtime.sendMessage({
              type: 'DELETE_SITE_RULE',
              siteKey,
              displayKeys: zoomData.keys
            }, resolve);
          });

          zoomData.keys.forEach(k => delete state.allSiteZooms[siteKey][k]);
          if (Object.keys(state.allSiteZooms[siteKey]).length === 0) {
            delete state.allSiteZooms[siteKey];
          }
          renderRulesTable();
          showToast(`Rule deleted for ${siteKey} on ${disp.name}`);
        });

        pillGroup.appendChild(badge);
        pillGroup.appendChild(removeBtn);
        tdDisp.appendChild(pillGroup);
      } else {
        // No custom rule for this display
        const emptyBadge = document.createElement('span');
        emptyBadge.className = 'zoom-empty-badge';
        emptyBadge.textContent = '—';
        emptyBadge.title = 'No custom rule saved for this monitor';

        const addBtn = document.createElement('button');
        addBtn.className = 'btn-add-rule';
        addBtn.title = `Add zoom rule for ${siteKey} on ${disp.name}`;
        addBtn.textContent = '+';

        addBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          tdDisp.innerHTML = '';
          showInlineZoomPicker(tdDisp, siteKey, disp, 1.0);
        });

        tdDisp.appendChild(emptyBadge);
        tdDisp.appendChild(addBtn);
      }

      tr.appendChild(tdDisp);
    });

    // Row Actions: Delete entire site across all displays
    const tdAction = document.createElement('td');
    tdAction.className = 'text-right';

    const delAllBtn = document.createElement('button');
    delAllBtn.className = 'btn-icon';
    delAllBtn.title = `Delete all rules for "${siteKey}"`;
    delAllBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="3 6 5 6 21 6"></polyline>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
      </svg>
    `;

    delAllBtn.addEventListener('click', async () => {
      const confirmed = confirm(`Delete ALL zoom rules for "${siteKey}" across all displays?`);
      if (!confirmed) return;

      await new Promise(resolve => {
        chrome.runtime.sendMessage({
          type: 'DELETE_SITE_RULE',
          siteKey
        }, resolve);
      });

      delete state.allSiteZooms[siteKey];
      renderRulesTable();
      showToast(`All rules deleted for ${siteKey}`);
    });

    tdAction.appendChild(delAllBtn);
    tr.appendChild(tdAction);
    rulesTableBody.appendChild(tr);
  });
}

/**
 * Renders an inline zoom selector dropdown inside a cell.
 */
function showInlineZoomPicker(container, siteKey, disp, currentFactor) {
  const select = document.createElement('select');
  select.className = 'inline-zoom-select';

  const zoomOptions = [
    0.50, 0.67, 0.75, 0.80, 0.90, 1.00, 1.10, 1.25, 1.50, 1.75, 2.00, 2.50, 3.00
  ];

  zoomOptions.forEach(val => {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = `${Math.round(val * 100)}%`;
    if (Math.abs(val - currentFactor) < 0.01) {
      opt.selected = true;
    }
    select.appendChild(opt);
  });

  select.addEventListener('change', async () => {
    const newFactor = parseFloat(select.value);
    await new Promise(resolve => {
      chrome.runtime.sendMessage({
        type: 'SET_TAB_ZOOM',
        siteKey,
        displayKey: disp.key,
        zoomFactor: newFactor
      }, resolve);
    });

    if (!state.allSiteZooms[siteKey]) {
      state.allSiteZooms[siteKey] = {};
    }
    state.allSiteZooms[siteKey][disp.key] = newFactor;
    renderRulesTable();
    showToast(`Zoom for ${siteKey} on ${disp.name} set to ${Math.round(newFactor * 100)}%`);
  });

  select.addEventListener('blur', () => {
    renderRulesTable();
  });

  container.innerHTML = '';
  container.appendChild(select);
  select.focus();
}

/**
 * List View (Flat List): Shows each explicit rule as a row with rich display badges.
 */
function renderListView(siteKeys, knownDisplays) {
  const headerTr = document.createElement('tr');
  headerTr.innerHTML = `
    <th style="width: 240px;">Website Domain</th>
    <th>Monitor / Display</th>
    <th style="width: 130px;">Zoom Level</th>
    <th class="text-right" style="width: 90px;">Actions</th>
  `;
  rulesTableHead.appendChild(headerTr);

  siteKeys.forEach((siteKey) => {
    knownDisplays.forEach((disp) => {
      const zoomData = getSiteZoomForDisplay(siteKey, disp);
      if (!zoomData) return;

      const percentStr = `${Math.round(zoomData.factor * 100)}%`;
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
      badge.textContent = getDisplayFriendlyName(disp.key);
      tdDisplay.appendChild(badge);
      tr.appendChild(tdDisplay);

      // Zoom
      const tdZoom = document.createElement('td');
      const zoomBadge = document.createElement('span');
      zoomBadge.className = 'zoom-badge';
      zoomBadge.textContent = percentStr;
      tdZoom.appendChild(zoomBadge);
      tr.appendChild(tdZoom);

      // Delete action
      const tdAction = document.createElement('td');
      tdAction.className = 'text-right';

      const delBtn = document.createElement('button');
      delBtn.className = 'btn-icon';
      delBtn.title = `Delete zoom rule for ${siteKey} on ${disp.name}`;
      delBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
      `;

      delBtn.addEventListener('click', async () => {
        const confirmed = confirm(`Delete zoom rule for "${siteKey}" on ${disp.name}?`);
        if (!confirmed) return;

        await new Promise(resolve => {
          chrome.runtime.sendMessage({
            type: 'DELETE_SITE_RULE',
            siteKey,
            displayKeys: zoomData.keys
          }, resolve);
        });

        zoomData.keys.forEach(k => delete state.allSiteZooms[siteKey][k]);
        if (Object.keys(state.allSiteZooms[siteKey]).length === 0) {
          delete state.allSiteZooms[siteKey];
        }
        renderRulesTable();
        showToast(`Rule deleted for ${siteKey} on ${disp.name}`);
      });

      tdAction.appendChild(delBtn);
      tr.appendChild(tdAction);
      rulesTableBody.appendChild(tr);
    });
  });
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
      await deduplicateSiteZooms();
      renderRulesTable();
      renderMonitorsGrid();
      populateSettings();
    }
  } catch (err) {
    console.error('Failed to load configuration:', err);
  }
}

document.addEventListener('DOMContentLoaded', loadAllConfig);
