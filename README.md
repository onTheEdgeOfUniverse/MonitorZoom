# MonitorZoom 🖥️🔍

> **A smart Google Chrome extension that remembers and automatically applies custom zoom levels per website, tailored to the specific monitor/display being used.**

---

## 🌟 The Problem
Google Chrome natively saves zoom levels **globally per domain** across all windows and displays.
If you have a multi-monitor setup (for instance, an external 4K or 1440p monitor connected to a 1080p laptop), a zoom factor that looks comfortable on your high-resolution screen (e.g. 125% or 150%) becomes uncomfortably large on your laptop screen (where 100% or 90% is ideal). Moving between monitors constantly forces you to adjust the zoom back and forth.

## 💡 The Solution
**MonitorZoom** bridges this gap:
1. **Monitor-Aware Zoom Persistence**: Detects which monitor the active browser window is on using Chrome's Display and Window APIs.
2. **Per-Tab Zoom Scope**: Uses Chrome's `per-tab` zoom isolation so tabs on different screens can have different zoom factors without conflicting.
3. **Auto-Switching on Window Drag**: Automatically recalculates and applies the target monitor's zoom when you move a window from one screen to another.
4. **Smart Navigation Optimization**: Applies zoom only once per site session on a tab, completely bypassing redundant re-applications during internal site navigations unless the zoom ratio actually differs.
5. **Monitor Defaults**: Set a baseline default zoom for each monitor (e.g., 125% for 4K external display, 100% for built-in laptop screen).
6. **Modern Minimalist Popup & Dashboard**: Quick stepper buttons, preset pills (`75%`, `90%`, `100%`, `125%`, `150%`, `200%`), multi-monitor comparison cards, and full rule management.

---

## 🚀 How to Install & Load in Google Chrome

1. Open Google Chrome.
2. Navigate to `chrome://extensions` in the address bar.
3. Enable **Developer mode** using the toggle in the top right corner.
4. Click the **Load unpacked** button in the top left.
5. Select the `MonitorZoom` folder:
   ```
   C:\Users\Sai Krishna\Desktop\Tech Projects\MonitorZoom
   ```
6. The **MonitorZoom** extension icon will appear in your Chrome toolbar. Pin it for quick access!

---

## 🛠️ Features & Usage

### 1. Popup Action
Click the MonitorZoom toolbar icon on any website:
- **Active Website & Monitor**: Shows the current domain and the identified display (e.g., *Built-in Display (Primary · 1920×1080)*).
- **Zoom Controls**: Step up/down by 10% (customizable in settings) or click instant preset pills (`75%`, `90%`, `100%`, `110%`, `125%`, `150%`, `175%`, `200%`).
- **All Connected Monitors**: View the saved zoom level for this site on each of your connected screens.
- **Sync to All**: One click to replicate the active zoom level to all connected monitors.

### 2. Options & Management Dashboard
Right-click the extension icon and choose **Options** (or click the gear icon in the popup):
- **Saved Site Rules**: Searchable table of all sites with custom zoom settings per monitor; easily delete or inspect entries.
- **Monitor Defaults**: Set a default zoom factor for each monitor to automatically scale new websites you haven't visited before.
- **General Settings**:
  - Toggle extension on/off.
  - Toggle auto-switch when dragging windows between monitors.
  - Configure toolbar badge text.
  - Customize step increment (5%, 10%, 15%, 25%).
- **Backup & Restore**: Export all your settings and rules to JSON, or restore from a previous backup.

---

## 🧪 Automated Testing
MonitorZoom includes an automated test suite verifying monitor geometry algorithms, coordinate intersections, site key parsing, storage fallbacks, and event echo cancellation.

To run the tests:
```bash
node test/run-tests.js
```

---

## 📁 Architecture

```
MonitorZoom/
├── manifest.json              # Manifest V3 configuration & permissions
├── background/
│   ├── background.js          # Service worker lifecycle & event dispatcher
│   ├── display-manager.js     # Monitor geometry, bounding box & fingerprinting
│   ├── storage-manager.js     # Schema, CRUD operations & fallback hierarchy
│   └── zoom-manager.js        # Tab zoom execution, per-tab scope & echo suppression
├── popup/
│   ├── popup.html             # Sleek toolbar popup UI
│   ├── popup.css              # Dark & light theme responsive styles
│   └── popup.js               # Reactive popup controller & messaging
├── options/
│   ├── options.html           # Full settings & rule management dashboard
│   ├── options.css            # Dashboard styling & table design
│   └── options.js             # Rule editor, defaults editor, JSON import/export
├── icons/                     # Extension icons (16, 32, 48, 128 px)
└── test/
    └── run-tests.js           # Automated test suite
```
