<div align="center">

<img src="icons/icon128.png" alt="Full-Screen Chat for Kick logo" width="96" height="96" />

# Full-Screen Chat for Kick

[![Get it from Microsoft Edge Add-ons](https://img.shields.io/badge/Microsoft_Edge_Add--ons-Get_it-0078D4?style=for-the-badge&logo=microsoftedge&logoColor=white)](https://microsoftedge.microsoft.com/addons/detail/bkabelicpipecdnjgfnahehninhkhgbk)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg?style=for-the-badge)](LICENSE)
[![Chromium 110+](https://img.shields.io/badge/Chromium-110%2B-0078D4.svg?style=for-the-badge)](manifest.json)

True full-screen Kick video with the site chat on top — for streams that don't already include a chat overlay.

</div>

---

## Overview

On Kick, entering true full-screen hides the site's chat panel. Leaving Kick's chat open keeps the player in theater mode instead, so the video does not fill the screen. When the streamer hasn't added a chat overlay to the broadcast itself, there is no built-in way to get both a full-screen player and the live chat.

Full-Screen Chat for Kick fills that gap by moving Kick's **existing** chat element into a transparent panel above the full-screen player. Your sign-in, moderation state and chat connection stay untouched, and the original page layout is restored when full-screen mode ends.

## Install

**Microsoft Edge (recommended):** install from [Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/bkabelicpipecdnjgfnahehninhkhgbk) to receive updates automatically.

### Unpacked install (development)

1. Open `edge://extensions` (or `chrome://extensions`).
2. Enable **Developer mode**.
3. Select **Load unpacked** and choose the repository root — the folder containing `manifest.json`.

After editing source files, return to the extensions page and select **Reload** on the extension card.

## Use

Enter full-screen mode on a Kick stream or replay. If auto-open is enabled, the overlay appears immediately.

| Action | How |
|---|---|
| Show / hide the overlay | **Alt+K** |
| Move the panel | Hover over it and drag the grip at the top center |
| Move without the grip | Hold **Alt** and drag anywhere in the chat |
| Resize the panel | Drag any edge or corner handle |
| Reset position and size | Double-click the grip or a resize handle |
| Pin / unpin | Select the pin button |
| Return to the newest message | Select the down-arrow button at the bottom center |
| Close the overlay | Select the close button or press **Alt+K** |

Controls appear while the pointer is over the panel or a control has keyboard focus. While pinned, moving and resizing are disabled until the panel is unpinned. Scrolling back through history pauses auto-follow; the down-arrow button returns to the live end and resumes it.

## Features

- Gives you a true full-screen player with chat still visible, without a chat source baked into the stream.
- Reuses Kick's chat connection, identity and moderation state — no iframe, second client or network request.
- Drag, resize from all edges and corners, snap to screen edges, or pin in place.
- Auto-follows the newest message, with a compact jump-to-latest control.
- In-panel menu and toolbar popup for blur, corner rounding and text shadow.
- Hides Kick's chat header, composer and banners while the overlay is active.
- Saves panel geometry and preferences locally with `chrome.storage.local`.

## Settings

**In the panel** — gear button in the top toolbar:

- **Background blur** — `0` disables the effect; `100` applies the strongest blur.
- **Corner rounding** — `0` keeps square corners; higher values round the panel and resize grips together.
- **Text shadow** — improves readability over bright video.
- **Restore defaults** — resets preferences but keeps panel size and position.

**Toolbar popup** — extension icon:

- Enable or disable the extension, and control auto-open in fullscreen.
- The same three appearance controls.
- **Restore default settings** — also resets panel geometry and pin state.

## Browser support

The extension targets **Chromium 110 or newer** and uses Manifest V3. The content script is scoped to `https://kick.com/*` and `https://*.kick.com/*`.

| Browser | Support |
|---|---|
| Microsoft Edge | Supported (110+) |
| Google Chrome | Supported (110+) |
| Brave, Opera, Vivaldi and other Chromium browsers | Generally supported when Chrome-style extensions and MV3 are available |
| Firefox, Safari | Not supported — different extension APIs |

## How it works

1. Watches for a full-screen player element on Kick.
2. Moves the existing chat root into a fixed, transparent overlay and applies full-screen-only styles.
3. Layout observers keep the message list in sync through resizes and React re-renders.
4. On exit, restores the chat node and every modified attribute.

## Privacy

The only permission is `storage`, used for local preferences and panel geometry. There is no background service, analytics or network request. Chat messages are displayed but never copied, stored or transmitted. See [PRIVACY-POLICY.md](PRIVACY-POLICY.md).

## Development

No build step and no runtime dependencies. Load the repository root directly as an unpacked extension and reload from the browser's extensions page after edits.

| Path | Purpose |
|---|---|
| `manifest.json` | Manifest, permissions and content-script scope |
| `src/content.js` | Overlay lifecycle, controls, resize and settings |
| `src/content.css` | Full-screen overlay styles |
| `src/popup.html`, `popup.css`, `popup.js` | Toolbar popup |
| `icons/` | Extension icons |

Release archives include only `manifest.json`, `src/` and `icons/`.

## License

[MIT](LICENSE)
