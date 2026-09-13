/**
 * MonitorZoom - Automated Test Suite
 * Tests display geometry math, site normalization, storage resolution, and echo cancellation.
 */

const assert = require('assert');
const {
  getDisplayFingerprint,
  getDisplayKey,
  getDisplayLabel,
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
  // Summary
  // -------------------------------------------------------------
  console.log(`\nResults: ${passedTests}/${totalTests} tests passed.\n`);

  if (passedTests !== totalTests) {
    process.exit(1);
  } else {
    console.log('All tests passed successfully!\n');
  }
})();

