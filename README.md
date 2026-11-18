# Full-Screen Chat for Kick

A lightweight Chromium extension for Microsoft Edge and Google Chrome that keeps Kick.com chat visible while watching a stream in full-screen mode.

The extension moves Kick's existing chat element into a movable panel above the video. It does not create an iframe or a second chat connection.

## Features

- Uses the existing Kick chat session and moderation state.
- Displays chat above the full-screen video player.
- Moves and snaps the chat panel by dragging.
- Resizes from the bottom-left and bottom-right corners.
- Pins the chat to prevent dragging and resizing.
- Provides a compact settings menu directly inside full-screen mode.
- Supports a messages-only view.
- Adds a configurable text shadow for readability.
- Applies an adjustable background blur from `0` to `100`.
- Saves panel position and size locally.
- Restores all settings to their defaults from the extension popup.
- Does not run a background service or make network requests.

## Controls

| Action | Method |
|---|---|
| Toggle the chat panel | Press **Alt+K** |
| Move the panel | Hover over the panel and drag the grip |
| Move with the keyboard shortcut | Hold **Alt** and drag anywhere inside the chat |
| Resize the panel | Drag the bottom-left or bottom-right handle |
| Reset the panel position and size | Double-click the grip or a resize handle |
| Pin the chat | Click the pin button |
| Change full-screen settings | Click the settings button |
| Close the panel | Click the close button or press **Alt+K** |

The grip, pin, settings, close, and resize controls appear only while the mouse is over the chat panel.

When pinning is enabled:

- Dragging is disabled.
- Alt-dragging is disabled.
- Resizing handles are hidden.
- The pin button stays active until it is toggled off.

## Full-Screen Settings

The settings button in the full-screen chat toolbar opens a compact menu with:

- **Background blur** — `0` is fully transparent; `100` applies the strongest supported blur.
- **Messages only** — hides Kick's chat header, composer, notification banners, and promotional elements.
- **Text shadow** — improves readability over bright video scenes.

## Popup Settings

The extension popup contains:

- **Extension enabled**
- **Open automatically in fullscreen**
- **Messages only**
- **Text shadow**
- **Background blur**
- **Restore default settings**

Restore default settings resets all options and panel geometry, including:

- Extension enabled
- Automatic full-screen opening
- Messages-only mode
- Text shadow
- Background blur
- Pin state
- Panel position and size

Settings are stored with `chrome.storage.local`.

## Installation

### Microsoft Edge

1. Open `edge://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose this project folder.

### Google Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose this project folder.

After source changes, use the extension page's **Reload** button.

## How It Works

1. The content script detects a full-screen player element.
2. It locates Kick's existing chat element.
3. It moves that element into a DOM panel above the full-screen player.
4. Full-screen-only styles hide Kick's non-message chrome and make the chat backdrop transparent.
5. A fixed scrim and optional `backdrop-filter` remain behind the chat to improve readability.
6. The panel geometry is saved locally.
7. On leaving full-screen mode, the chat element and all temporary DOM changes are restored.

No chat is copied or recreated. The existing Kick connection remains active.

## Development

The extension has no build step or runtime dependencies. Load the source directory directly as an unpacked extension.

```text
manifest.json       Extension manifest
src/content.js      Full-screen panel, controls, dragging, resizing, and settings
src/content.css     Panel styling and full-screen behavior
src/popup.html      Popup markup
src/popup.css       Popup styling
src/popup.js        Popup settings and restore behavior
icons/              Extension icons
tools/gen-icons.mjs Icon generator
```

## Packaging

Package these directories and files:

- `manifest.json`
- `src/`
- `icons/`

Do not include `tools/`, `node_modules/`, or development-only files in the packaged extension.

## Privacy

The extension makes no network requests and uses no analytics or tracking. The only persisted data is the local chat panel and appearance settings stored on the user's device.

It does not access the Kick account, capture chat content, or transmit stream data.

## License

[MIT](LICENSE)
