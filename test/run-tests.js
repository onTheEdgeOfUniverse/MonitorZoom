/**
 * MonitorZoom - Automated Test Suite
 * Tests display geometry math, site normalization, storage resolution, and echo cancellation.
 */

const assert = require('assert');
const {
  getDisplayFingerprint,
  getDisplayKey,
  getDisplayLabel,
  formatFingerprintName,
  findDisplayForWindow
} = require('../background/display-manager.js');

const {
  getSiteKeyFromUrl,
  normalizeZoomFactor,
  DEFAULT_SETTINGS
} = require('../background/storage-manager.js');

const {
  pendingProgrammaticZooms,
  isProgrammaticZoomChange
} = require('../background/zoom-manager.js');

let passedTests = 0;
let totalTests = 0;

async function test(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  \x1b[32m✔\x1b[0m ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  \x1b[31m✖\x1b[0m ${name}`);
    console.error(`    ${err.message}`);
  }
}


console.log('\n--- Running MonitorZoom Test Suite ---\n');

// -------------------------------------------------------------
// Test 1: URL & Site Normalization
// -------------------------------------------------------------
console.log('Testing URL Site Key Normalization:');

test('Extracts hostname from standard HTTPS URL', () => {
  assert.strictEqual(getSiteKeyFromUrl('https://github.com/features/actions'), 'github.com');
  assert.strictEqual(getSiteKeyFromUrl('https://WWW.GOOGLE.COM/search?q=test'), 'www.google.com');
});

test('Preserves port for localhost or development servers', () => {
  assert.strictEqual(getSiteKeyFromUrl('http://localhost:3000/dashboard'), 'localhost:3000');
  assert.strictEqual(getSiteKeyFromUrl('http://127.0.0.1:8080/'), '127.0.0.1:8080');
});

test('Normalizes file URLs to local-files', () => {
  assert.strictEqual(getSiteKeyFromUrl('file:///C:/Users/test/doc.html'), 'local-files');
});

test('Blocks restricted browser internal URLs', () => {
  assert.strictEqual(getSiteKeyFromUrl('chrome://extensions'), null);
  assert.strictEqual(getSiteKeyFromUrl('chrome-extension://abcdefg/popup.html'), null);
  assert.strictEqual(getSiteKeyFromUrl('edge://settings'), null);
  assert.strictEqual(getSiteKeyFromUrl('about:blank'), null);
  assert.strictEqual(getSiteKeyFromUrl('view-source:https://example.com'), null);
  assert.strictEqual(getSiteKeyFromUrl(''), null);
  assert.strictEqual(getSiteKeyFromUrl(null), null);
});

// -------------------------------------------------------------
// Test 2: Zoom Factor Normalization
// -------------------------------------------------------------
console.log('\nTesting Zoom Factor Normalization:');

test('Rounds zoom factor to 2 decimal places', () => {
  assert.strictEqual(normalizeZoomFactor(1.2500000001), 1.25);
  assert.strictEqual(normalizeZoomFactor(0.8999999999), 0.90);
  assert.strictEqual(normalizeZoomFactor(1.1), 1.10);
});

test('Handles invalid or non-numeric zoom values gracefully', () => {
  assert.strictEqual(normalizeZoomFactor(NaN), 1.0);
  assert.strictEqual(normalizeZoomFactor(-0.5), 1.0);
  assert.strictEqual(normalizeZoomFactor(null), 1.0);
});

// -------------------------------------------------------------
// Test 3: Display Detection & Geometry Math
// -------------------------------------------------------------
console.log('\nTesting Monitor Detection Algorithms:');

const mockDisplays = [
  {
    id: 'display-laptop',
    name: 'Built-in Display',
    isPrimary: true,
    bounds: { left: 0, top: 0, width: 1920, height: 1080 }
  },
  {
    id: 'display-external-4k',
    name: 'Dell 4K Monitor',
    isPrimary: false,
    bounds: { left: 1920, top: 0, width: 3840, height: 2160 }
  }
];

test('Matches window on primary display via center-point', () => {
  const winOnLaptop = { left: 100, top: 100, width: 1200, height: 800 };
  const detected = findDisplayForWindow(winOnLaptop, mockDisplays);
  assert.strictEqual(detected.id, 'display-laptop');
});

test('Matches window on secondary 4K display via center-point', () => {
  const winOn4K = { left: 2000, top: 200, width: 1800, height: 1200 };
  const detected = findDisplayForWindow(winOn4K, mockDisplays);
  assert.strictEqual(detected.id, 'display-external-4k');
});

test('Matches display using max intersection area when window spans monitors', () => {
  // Window spans across x=1920 boundary:
  // 300px width on laptop (1620 to 1920) vs 700px width on 4K (1920 to 2620)
  const spanningWin = { left: 1620, top: 100, width: 1000, height: 800 };
  const detected = findDisplayForWindow(spanningWin, mockDisplays);
  assert.strictEqual(detected.id, 'display-external-4k');
});

test('Handles negative display coordinates (secondary monitor to the left)', () => {
  const negativeLayout = [
    {
      id: 'disp-left',
      name: 'Left Monitor',
      isPrimary: false,
      bounds: { left: -1920, top: 0, width: 1920, height: 1080 }
    },
    {
      id: 'disp-main',
      name: 'Main Monitor',
      isPrimary: true,
      bounds: { left: 0, top: 0, width: 2560, height: 1440 }
    }
  ];

  const winOnLeft = { left: -1500, top: 100, width: 1000, height: 800 };
  const detected = findDisplayForWindow(winOnLeft, negativeLayout);
  assert.strictEqual(detected.id, 'disp-left');

  const winOnMain = { left: 200, top: 100, width: 1200, height: 800 };
  assert.strictEqual(findDisplayForWindow(winOnMain, negativeLayout).id, 'disp-main');
});

test('Falls back to primary display for minimized or missing window coordinates', () => {
  const minimizedWin = { left: undefined, top: undefined, width: undefined, height: undefined };
  const detected = findDisplayForWindow(minimizedWin, mockDisplays);
  assert.strictEqual(detected.id, 'display-laptop');
});

// -------------------------------------------------------------
// Test 4: Display Fingerprinting & Labels
// -------------------------------------------------------------
console.log('\nTesting Display Fingerprinting & Labels:');

test('Generates consistent display fingerprint and label', () => {
  const disp = {
    id: 'id-123',
    name: 'LG UltraFine',
    isPrimary: true,
    bounds: { width: 3840, height: 2160 }
  };

  const fingerprint = getDisplayFingerprint(disp);
  assert.strictEqual(fingerprint, 'lg_ultrafine_3840x2160_primary');

  const label = getDisplayLabel(disp);
  assert.strictEqual(label, 'LG UltraFine (Primary · 3840×2160)');
});

test('Formats display fingerprint into human-readable display label', () => {
  const formatted = formatFingerprintName('lg_ultrafine_3840x2160_primary');
  assert.strictEqual(formatted, 'Lg ultrafine (Primary · 3840×2160)');

  const secondary = formatFingerprintName('dell_4k_monitor_3840x2160_secondary');
  assert.strictEqual(secondary, 'Dell 4k monitor (3840×2160)');
});

// -------------------------------------------------------------
// Test 5: Echo Zoom Suppression
// -------------------------------------------------------------
console.log('\nTesting Echo Event Cancellation:');

test('Suppresses echo zoom events matching pending programmatic zoom', () => {
  const tabId = 42;
  pendingProgrammaticZooms.set(tabId, 1.25);

  // Echo event with 1.25 should be recognized as programmatic and suppressed
  const isEcho = isProgrammaticZoomChange(tabId, 1.25);
  assert.strictEqual(isEcho, true);
  assert.strictEqual(pendingProgrammaticZooms.has(tabId), false);

  // Subsequent event should be recognized as user-initiated
  const isUser = isProgrammaticZoomChange(tabId, 1.50);
  assert.strictEqual(isUser, false);
});

// -------------------------------------------------------------
// Test 6: Storage Manager with Mock Chrome Storage
// -------------------------------------------------------------
console.log('\nTesting Storage Manager CRUD & Fallback Hierarchy:');

// Setup mock chrome.storage.local
const mockStorage = {};
global.chrome = {
  storage: {
    local: {
      get: (keys, cb) => {
        if (!keys) return cb({ ...mockStorage });
        const res = {};
        const keyList = Array.isArray(keys) ? keys : [keys];
        keyList.forEach(k => {
          if (mockStorage[k] !== undefined) res[k] = JSON.parse(JSON.stringify(mockStorage[k]));
        });
        cb(res);
      },
      set: (items, cb) => {
        Object.assign(mockStorage, JSON.parse(JSON.stringify(items)));
        if (cb) cb();
      },
      clear: (cb) => {
        Object.keys(mockStorage).forEach(k => delete mockStorage[k]);
        if (cb) cb();
      }
    }
  }
};

const storageManager = require('../background/storage-manager.js');

(async () => {
  await test('Storage saves and retrieves site-specific zoom per display', async () => {
    await storageManager.saveSiteZoom('github.com', 'display-laptop', 1.10);
    await storageManager.saveSiteZoom('github.com', 'display-external-4k', 1.50);

    const laptopResult = await storageManager.getEffectiveZoom('github.com', 'display-laptop');
    assert.strictEqual(laptopResult.zoomFactor, 1.10);
    assert.strictEqual(laptopResult.source, 'site');

    const externalResult = await storageManager.getEffectiveZoom('github.com', 'display-external-4k');
    assert.strictEqual(externalResult.zoomFactor, 1.50);
    assert.strictEqual(externalResult.source, 'site');
  });

  await test('Storage falls back to display default when site has no rule for that display', async () => {
    await storageManager.saveDisplayDefault('display-external-4k', 1.25);

    const newSiteResult = await storageManager.getEffectiveZoom('stackoverflow.com', 'display-external-4k');
    assert.strictEqual(newSiteResult.zoomFactor, 1.25);
    assert.strictEqual(newSiteResult.source, 'display_default');
  });

  await test('Storage falls back to browser default (1.0) when neither site nor display default exists', async () => {
    const fallbackResult = await storageManager.getEffectiveZoom('randomsite.org', 'unknown-display');
    assert.strictEqual(fallbackResult.zoomFactor, 1.0);
    assert.strictEqual(fallbackResult.source, 'browser_default');
  });

  await test('Deleting site rule removes only specified display rule', async () => {
    await storageManager.deleteSiteZoom('github.com', 'display-laptop');

    const laptopAfterDelete = await storageManager.getEffectiveZoom('github.com', 'display-laptop');
    // No display default set for display-laptop, so falls back to 1.0
    assert.strictEqual(laptopAfterDelete.zoomFactor, 1.0);
    assert.strictEqual(laptopAfterDelete.source, 'browser_default');

    // But 4K rule still exists!
    const externalStillExists = await storageManager.getEffectiveZoom('github.com', 'display-external-4k');
    assert.strictEqual(externalStillExists.zoomFactor, 1.50);
  });

  await test('Deleting site rule with an array of alias keys removes all matching aliases', async () => {
    await storageManager.saveSiteZoom('gitlab.com', 'disp-alias-1', 1.25);
    await storageManager.saveSiteZoom('gitlab.com', 'disp-alias-2', 1.25);
    await storageManager.saveSiteZoom('gitlab.com', 'disp-other', 1.50);

    await storageManager.deleteSiteZoom('gitlab.com', ['disp-alias-1', 'disp-alias-2']);

    const all = await storageManager.getAllSiteZooms();
    assert.strictEqual(all['gitlab.com']['disp-alias-1'], undefined);
    assert.strictEqual(all['gitlab.com']['disp-alias-2'], undefined);
    assert.strictEqual(all['gitlab.com']['disp-other'], 1.50);
  });

  await test('Export and import configuration restores all data properly', async () => {
    const backupJson = await storageManager.exportConfiguration();
    assert.strictEqual(typeof backupJson, 'string');
    assert.strictEqual(backupJson.includes('github.com'), true);

    // Clear storage
    await storageManager.clearAllData();
    const emptyCheck = await storageManager.getAllSiteZooms();
    assert.deepStrictEqual(emptyCheck, {});

    // Restore
    const importResult = await storageManager.importConfiguration(backupJson);
    assert.strictEqual(importResult.success, true);

    const restoredZooms = await storageManager.getAllSiteZooms();
    assert.strictEqual(restoredZooms['github.com']['display-external-4k'], 1.50);
  });

  // -------------------------------------------------------------
  // Test 7: Apply Once Per Site Navigation & Difference-Only Logic
  // -------------------------------------------------------------
  console.log('\nTesting Apply Once Per Site Navigation & Difference-Only Logic:');

  // Setup tab/window/display state for testing applyMonitorZoomToTab
  const testWindowState = {
    id: 201,
    left: 100,
    top: 100,
    width: 1200,
    height: 800,
    focused: true
  };

  const testTabState = {
    id: 101,
    url: 'https://github.com/torvalds',
    windowId: 201,
    zoomFactor: 1.0,
    zoomSettings: null,
    active: true
  };

  let setZoomCallCount = 0;

  global.chrome.tabs = {
    get: (id, cb) => {
      if (id === testTabState.id) {
        cb({
          id: testTabState.id,
          url: testTabState.url,
          windowId: testTabState.windowId,
          active: testTabState.active !== false
        });
      } else {
        cb(null);
      }
    },
    getZoom: (id, cb) => {
      cb(testTabState.zoomFactor);
    },
    setZoom: (id, factor, cb) => {
      setZoomCallCount++;
      testTabState.zoomFactor = factor;
      if (cb) cb();
    },
    setZoomSettings: (id, settings, cb) => {
      testTabState.zoomSettings = settings;
      if (cb) cb();
    }
  };

  global.chrome.windows = {
    get: (id, cb) => {
      cb({ ...testWindowState });
    }
  };

  global.chrome.system = {
    display: {
      getInfo: (cb) => {
        cb([
          { id: 'display-laptop', name: 'Built-in Display', isPrimary: true, bounds: { left: 0, top: 0, width: 1920, height: 1080 } },
          { id: 'display-external-4k', name: 'Dell 4K Monitor', isPrimary: false, bounds: { left: 1920, top: 0, width: 3840, height: 2160 } }
        ]);
      }
    }
  };

  global.chrome.action = {
    setBadgeText: () => {},
    setBadgeBackgroundColor: () => {}
  };

  global.chrome.runtime = {
    lastError: null,
    sendMessage: () => Promise.resolve()
  };

  const zoomManager = require('../background/zoom-manager.js');

  await test('Initial site visit applies zoom when difference exists', async () => {
    // Configure github.com on display-laptop to 1.25
    await storageManager.saveSiteZoom('github.com', 'display-laptop', 1.25);

    zoomManager.resetAllTabSessions();
    setZoomCallCount = 0;
    testTabState.url = 'https://github.com/torvalds';
    testTabState.zoomFactor = 1.0; // Current is 1.0, target is 1.25

    const res = await zoomManager.applyMonitorZoomToTab(testTabState.id, testTabState.windowId);
    assert.strictEqual(res.applied, true);
    assert.strictEqual(testTabState.zoomFactor, 1.25);
    assert.strictEqual(setZoomCallCount, 1);

    const session = zoomManager.getTabSession(testTabState.id);
    assert.strictEqual(session.siteKey, 'github.com');
    assert.strictEqual(session.displayKey, 'display-laptop');
  });

  await test('Internal navigation inside same site does NOT reapply when zoom ratio has no difference', async () => {
    // User clicks internal link to https://github.com/torvalds/linux
    testTabState.url = 'https://github.com/torvalds/linux';
    // Current zoom is already 1.25
    assert.strictEqual(testTabState.zoomFactor, 1.25);

    const initialCallCount = setZoomCallCount;

    const res = await zoomManager.applyMonitorZoomToTab(testTabState.id, testTabState.windowId);

    // Should NOT reapply!
    assert.strictEqual(res.applied, false);
    assert.strictEqual(res.reason, 'same_site_no_difference');
    // setZoom was not called again
    assert.strictEqual(setZoomCallCount, initialCallCount);
  });

  await test('Internal navigation re-applies zoom if difference in zoom ratio occurs', async () => {
    // Simulate browser navigation resetting zoom back to 1.0
    testTabState.url = 'https://github.com/torvalds/linux/commits';
    testTabState.zoomFactor = 1.0; // Differing ratio!

    const prevCallCount = setZoomCallCount;

    const res = await zoomManager.applyMonitorZoomToTab(testTabState.id, testTabState.windowId);

    // Because ratio differed, change is applied!
    assert.strictEqual(res.applied, true);
    assert.strictEqual(testTabState.zoomFactor, 1.25);
    assert.strictEqual(setZoomCallCount, prevCallCount + 1);
  });

  await test('Navigating to a different site re-evaluates and applies new site zoom', async () => {
    // Configure stackoverflow.com on display-laptop to 0.90
    await storageManager.saveSiteZoom('stackoverflow.com', 'display-laptop', 0.90);

    testTabState.url = 'https://stackoverflow.com/questions/12345';
    // Current zoom is 1.25 from github
    testTabState.zoomFactor = 1.25;

    const res = await zoomManager.applyMonitorZoomToTab(testTabState.id, testTabState.windowId);
    assert.strictEqual(res.applied, true);
    assert.strictEqual(testTabState.zoomFactor, 0.90);

    const session = zoomManager.getTabSession(testTabState.id);
    assert.strictEqual(session.siteKey, 'stackoverflow.com');
  });

  await test('Window moved to different monitor triggers zoom update for that monitor', async () => {
    // Configure stackoverflow.com on 4K display to 1.50
    await storageManager.saveSiteZoom('stackoverflow.com', 'display-external-4k', 1.50);

    // Change window coordinates to 4K monitor (left: 2000)
    testWindowState.left = 2000;
    testWindowState.width = 1400;
    testWindowState.height = 900;

    const res = await zoomManager.applyMonitorZoomToTab(testTabState.id, testTabState.windowId);
    assert.strictEqual(res.applied, true);
    assert.strictEqual(testTabState.zoomFactor, 1.50);

    const session = zoomManager.getTabSession(testTabState.id);
    assert.strictEqual(session.displayKey, 'display-external-4k');
  });

  await test('Unmanaged site with no custom rule is left untouched on site load', async () => {
    // Window on display-laptop (which has NO display default set)
    testWindowState.left = 100;
    testWindowState.width = 1200;
    testWindowState.height = 800;

    // Navigate to a completely unmanaged site: wikipedia.org (no rule saved)
    testTabState.url = 'https://wikipedia.org/wiki/Main_Page';
    testTabState.zoomFactor = 1.10; // User's natural browser zoom

    const callCountBefore = setZoomCallCount;
    const res = await zoomManager.applyMonitorZoomToTab(testTabState.id, testTabState.windowId, { trigger: 'onloaded' });

    // Must NOT touch the tab or overwrite zoom!
    assert.strictEqual(res.applied, false);
    assert.strictEqual(res.reason, 'no_explicit_rule');
    assert.strictEqual(testTabState.zoomFactor, 1.10); // Untouched
    assert.strictEqual(setZoomCallCount, callCountBefore); // No setZoom calls
  });

  await test('Managed site on load does not call setZoom if current zoom matches target', async () => {
    // stackoverflow.com on display-laptop is 0.90
    testTabState.url = 'https://stackoverflow.com/questions';
    testTabState.zoomFactor = 0.90; // Already at target zoom

    const callCountBefore = setZoomCallCount;
    const res = await zoomManager.applyMonitorZoomToTab(testTabState.id, testTabState.windowId, { trigger: 'onloaded' });

    assert.strictEqual(res.applied, false);
    assert.strictEqual(res.reason, 'already_at_target_zoom');
    assert.strictEqual(setZoomCallCount, callCountBefore);
  });

  await test('Skipping onloaded trigger when applyOnSiteLoad is turned off', async () => {
    // Disable applyOnSiteLoad in settings
    await storageManager.saveSettings({ applyOnSiteLoad: false });

    testTabState.url = 'https://stackoverflow.com/tags';
    testTabState.zoomFactor = 1.0; // Differs from target 1.50

    const callCountBefore = setZoomCallCount;
    const res = await zoomManager.applyMonitorZoomToTab(testTabState.id, testTabState.windowId, { trigger: 'onloaded' });

    assert.strictEqual(res.applied, false);
    assert.strictEqual(res.reason, 'apply_on_load_disabled');
    assert.strictEqual(setZoomCallCount, callCountBefore);

    // Restore setting
    await storageManager.saveSettings({ applyOnSiteLoad: true });
  });

  // -------------------------------------------------------------
  // Test 8: Cross-Monitor Isolation & Passive Echo Discarding
  // -------------------------------------------------------------
  console.log('\nTesting Cross-Monitor Isolation & Passive Echo Discarding:');

  await test('Eagerly sets scope: per-tab on managed sites to isolate from Chrome native cross-tab sync', async () => {
    testTabState.url = 'https://github.com/torvalds';
    testTabState.zoomFactor = 1.25; // Matches target, so setZoom will not be called
    testTabState.zoomSettings = null;

    await zoomManager.applyMonitorZoomToTab(testTabState.id, testTabState.windowId);

    assert.deepStrictEqual(testTabState.zoomSettings, { scope: 'per-tab', mode: 'automatic' });
  });

  await test('Site with custom rule on monitor enforces baseline default (1.0) on unconfigured laptop display', async () => {
    // Configure special-site.com on 4K display to 1.50
    await storageManager.saveSiteZoom('special-site.com', 'display-external-4k', 1.50);

    // Place window on Laptop Display
    testWindowState.left = 100;
    testWindowState.top = 100;

    // Simulate tab currently at 1.50 because of Chrome per-origin cross-monitor leak
    testTabState.url = 'https://special-site.com/docs';
    testTabState.zoomFactor = 1.50;

    const res = await zoomManager.applyMonitorZoomToTab(testTabState.id, testTabState.windowId);

    // Should detect that special-site.com is managed and enforce 1.0 on laptop!
    assert.strictEqual(res.applied, true);
    assert.strictEqual(testTabState.zoomFactor, 1.0);
    assert.strictEqual(res.zoomFactor, 1.0);
  });

  await test('handleTabZoomChanged discards zoom changes if window is unfocused (passive Chrome cross-window echo)', async () => {
    // Save rule for laptop display as 1.10
    await storageManager.saveSiteZoom('focused-test.com', 'display-laptop', 1.10);

    testTabState.url = 'https://focused-test.com/home';
    testTabState.active = true;
    testWindowState.focused = false; // Background window!

    // Chrome fires onZoomChange with 1.50 (echo from focused external monitor)
    await zoomManager.handleTabZoomChanged({
      tabId: testTabState.id,
      oldZoomFactor: 1.10,
      newZoomFactor: 1.50
    });

    // Rule in storage must NOT be overwritten!
    const effective = await storageManager.getEffectiveZoom('focused-test.com', 'display-laptop');
    assert.strictEqual(effective.zoomFactor, 1.10);
  });

  await test('handleTabZoomChanged discards zoom changes if tab is not active', async () => {
    // Save rule for laptop display as 1.10
    await storageManager.saveSiteZoom('active-tab-test.com', 'display-laptop', 1.10);

    testTabState.url = 'https://active-tab-test.com/home';
    testTabState.active = false; // Background inactive tab!
    testWindowState.focused = true;

    // Chrome fires onZoomChange with 1.75
    await zoomManager.handleTabZoomChanged({
      tabId: testTabState.id,
      oldZoomFactor: 1.10,
      newZoomFactor: 1.75
    });

    // Rule in storage must NOT be overwritten!
    const effective = await storageManager.getEffectiveZoom('active-tab-test.com', 'display-laptop');
    assert.strictEqual(effective.zoomFactor, 1.10);
  });

  await test('handleTabZoomChanged persists user manual zoom when tab is active AND window is focused', async () => {
    testTabState.url = 'https://active-tab-test.com/home';
    testTabState.active = true;
    testWindowState.focused = true; // Active & focused!

    // User presses Ctrl + Plus to zoom to 1.25
    await zoomManager.handleTabZoomChanged({
      tabId: testTabState.id,
      oldZoomFactor: 1.10,
      newZoomFactor: 1.25
    });

    // Rule in storage SHOULD be updated to 1.25!
    const effective = await storageManager.getEffectiveZoom('active-tab-test.com', 'display-laptop');
    assert.strictEqual(effective.zoomFactor, 1.25);
  });

  await test('Switching focus between windows on different monitors applies monitor-specific zoom', async () => {
    // Configure multiscreen-site.com: 1.50 on 4K monitor, 1.10 on Laptop
    await storageManager.saveSiteZoom('multiscreen-site.com', 'display-external-4k', 1.50);
    await storageManager.saveSiteZoom('multiscreen-site.com', 'display-laptop', 1.10);

    // Window 1 on 4K monitor (left: 2000)
    testWindowState.left = 2000;
    testWindowState.width = 1400;
    testWindowState.height = 900;
    testTabState.url = 'https://multiscreen-site.com/app';
    testTabState.zoomFactor = 1.0;

    let res = await zoomManager.applyMonitorZoomToTab(testTabState.id, testTabState.windowId);
    assert.strictEqual(res.applied, true);
    assert.strictEqual(testTabState.zoomFactor, 1.50);

    // Now switch focus to Window 2 on Laptop (left: 100)
    testWindowState.left = 100;
    testWindowState.width = 1200;
    testWindowState.height = 800;

    // Simulate tab currently at 1.50 from previous monitor
    testTabState.zoomFactor = 1.50;

    res = await zoomManager.applyMonitorZoomToTab(testTabState.id, testTabState.windowId);
    assert.strictEqual(res.applied, true);
    assert.strictEqual(testTabState.zoomFactor, 1.10);
  });

  // -------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------
  console.log(`\nResults: ${passedTests}/${totalTests} tests passed.\n`);

  if (passedTests !== totalTests) {
    process.exit(1);
  } else {
    console.log('All tests passed successfully!\n');
  }
})();


