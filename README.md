# Full-Screen Chat for Kick

A lightweight Manifest V3 extension that keeps Kick's live chat visible above the video while watching in full-screen mode.

Instead of duplicating the chat in an iframe or opening a second connection, the extension relocates Kick's existing chat element into a floating overlay. The original DOM, attributes, and layout are restored when full-screen mode ends, so the active chat session and account state are preserved.

## Browser Support

The extension targets **Chromium 110 or newer** and uses the Manifest V3 extension API.

| Browser | Support |
|---|---|
| Google Chrome | Supported (version 110+) |
| Microsoft Edge | Supported (version 110+) |
| Brave, Opera, Vivaldi, and other Chromium-based browsers | Generally supported when Chrome-style extensions and Manifest V3 are available |
| Firefox, Safari | Not supported — different extension APIs |

Availability in Chromium-based browsers other than Chrome and Edge depends on that browser's extension policy and version. The manifest declares `"manifest_version": 3` and `"minimum_chrome_version": "110"`.

The content script is scoped to `https://kick.com/*` and `https://*.kick.com/*`.

## Features

- Reuses the existing Kick chat connection, identity, and moderation state.
- Places the chat directly over the full-screen video player.
- Hides Kick's chat header, composer, notification banners, and promotional elements while the overlay is active.
- Keeps the viewer at the latest message automatically; shows a compact **jump-to-latest** control when scrolling back through history.
- Suppresses reply-thread and user-profile pop-ups that would otherwise open outside the full-screen player.
- Supports dragging, edge snapping, and resizing from either bottom corner; the resize grips follow the selected corner rounding.
- Provides a compact in-panel settings menu and a separate browser-action popup.
- Includes adjustable background blur, corner rounding, and an optional text shadow for readability over bright scenes.
- Saves panel geometry and preferences locally, and restores them on the next session.
- Requires no background service, build step, or network requests.

## Installation

### Load as an unpacked extension

1. Open the extensions page in your browser:
   - Chrome and Chromium: `chrome://extensions`
   - Microsoft Edge: `edge://extensions`
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose the root folder of this repository — the folder that contains `manifest.json`.

After changing source files, return to the extensions page and select **Reload** on the extension card.

## Usage

Enter full-screen mode on a Kick stream. If **Open automatically in fullscreen** is enabled, the chat overlay appears without any additional action.

| Action | Method |
|---|---|
| Show or hide the overlay | Press **Alt+K** |
| Move the panel | Hover over it and drag the grip in the top-left corner |
| Move without the grip | Hold **Alt** and drag anywhere in the chat |
| Resize the panel | Drag the bottom-left or bottom-right handle |
| Reset position and size | Double-click the grip or a resize handle |
| Pin the panel | Select the pin button |
| Return to the newest message | Select the down-arrow button at the bottom center |
| Close the overlay | Select the close button or press **Alt+K** |

The grip, pin, settings, close, and resize handles appear only while the pointer is over the panel. While pinned, dragging, Alt-dragging, and resizing are disabled until the panel is unpinned.

When the viewer scrolls away from the newest message, automatic following pauses so older messages can be read. Selecting the down-arrow button returns to the live end of the chat and resumes automatic following.

## Settings

### In-full-screen menu

Opened with the settings button in the panel's top-left toolbar:

- **Background blur** — `0` disables the effect; `100` applies the strongest supported blur to the stream behind the chat.
- **Corner rounding** — `0` keeps square corners; higher values round the panel and both resize grips together.
- **Text shadow** — improves message contrast over bright video.

### Browser-action popup

Opened from the extension icon in the browser toolbar:

- **Extension enabled** — turns all overlay behavior on or off.
- **Open automatically in fullscreen** — controls whether the overlay appears as soon as full-screen mode starts.
- **Text shadow**, **Background blur**, and **Corner rounding** — mirror the in-panel controls.
- **Restore default settings** — resets preferences, panel geometry, and pin state.

All preferences are stored with `chrome.storage.local`.

## How It Works

1. The content script watches for a full-screen player element on Kick.
2. It locates Kick's existing chat root node.
3. That node is moved into a transparent, fixed-position panel above the player.
4. Full-screen-only styles hide non-message chrome and remove chat backgrounds.
5. A scrim and optional `backdrop-filter` keep messages readable over the stream.
6. Layout observers resynchronize the message list after full-screen transitions, resizes, and React re-renders.
7. On exit, the chat node and any modified attributes are restored to their original state.

No second chat client, iframe, or network connection is created.

## Project Structure

```text
manifest.json       Extension manifest and permissions
src/content.js      Overlay lifecycle, controls, message view, and settings
src/content.css     Full-screen overlay styles
src/popup.html      Browser-action popup markup
src/popup.css       Popup styles
src/popup.js        Popup state and restore behavior
icons/              Extension icons
tools/gen-icons.mjs Optional icon generator
```

## Development

There is no build step or runtime dependency. Load the repository root directly as an unpacked extension and reload it from the browser's extensions page after edits.

Icons can be regenerated with:

```bash
npm run icons
```

## Packaging

Include only the files required at runtime:

- `manifest.json`
- `src/`
- `icons/`

Exclude `tools/`, development files, and repository metadata from release archives.

## Privacy and Permissions

The only requested permission is `storage`, used to save local preferences and panel geometry. The extension has no background service, performs no analytics or tracking, and makes no network requests. It does not read or transmit account data, chat history, or stream information.

## License

[MIT](LICENSE)
