/**
 * Full-Screen Chat for Kick
 * ------------------------------------------------------------------
 * Places the chat directly over the stream in fullscreen.
 * The chat itself is not cloned: Kick's existing chat node is moved into the
 * fullscreen element, so no second connection, iframe or extra network
 * traffic is created.
 *
 * The chat header, composer, notification strips and promos are hidden; only
 * the message stream remains. The backdrop is the blurred stream itself, with
 * one control for its blur strength.
 *
 * The drag grip and close button appear on hover; holding Alt also drags from
 * anywhere in the chat. Resizing is available from the bottom-left and
 * bottom-right corners.
 */
(() => {
  'use strict';

  if (window.__fscfkInjected) return;
  window.__fscfkInjected = true;

  const STORE_KEY = 'fscfk.settings';
  const DEFAULTS = Object.freeze({
    enabled: true,
    autoOpen: true,
    shadow: true,
    blur: 14,
    cornerRadius: 0,
    pinned: false,
    panel: null,
  });

  const MAX_BLUR = 100;
  const MAX_BLUR_PX = 30;
  const MAX_CORNER_RADIUS = 24;
  const JUMP_GUARD_MS = 900;

  const MIN_W = 280;
  const MIN_H = 220;
  const MAX_W = 720;
  const MAX_H = 760;
  const SNAP = 22;

  const CHAT_SELECTORS = [
    '#channel-chatroom',
    '#chatroom',
    '[data-testid="chatroom"]',
    'aside[class*="chat" i]',
    'div[class*="chatroom" i]',
    'section[class*="chat" i]',
  ];

  const SVG_NS = 'http://www.w3.org/2000/svg';

  // 24x24 viewBox, painted with currentColor.
  const ICONS = {
    chat: {
      stroke: [
        'M20.5 11.6a8.4 8.4 0 0 1-9 8.4 9.2 9.2 0 0 1-3.7-.8L3.5 20l1.3-3.9a8.4 8.4 0 0 1 8-12.1 8.4 8.4 0 0 1 7.7 7.6z',
      ],
    },
    grip: {
      fill: [{ c: [9, 6] }, { c: [15, 6] }, { c: [9, 12] }, { c: [15, 12] }, { c: [9, 18] }, { c: [15, 18] }],
    },
    close: { stroke: ['M6 6l12 12', 'M18 6L6 18'] },
    down: { stroke: ['M12 4v15', 'M6 13l6 6 6-6'] },
    pin: {
      stroke: ['M8 4h8', 'M9 4v6l-3 3h12l-3-3V4', 'M12 13v7'],
    },
    settings: {
      stroke: [
        'M12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10',
        'M12 3v4',
        'M12 17v4',
        'M3 12h4',
        'M17 12h4',
        'M5.64 5.64l2.83 2.83',
        'M15.53 15.53l2.83 2.83',
        'M18.36 5.64l-2.83 2.83',
        'M8.47 15.53l-2.83 2.83',
      ],
    },
  };

  let settings = { ...DEFAULTS };
  let ready = false;

  let fsEl = null;
  let panel = null;
  let chatHost = null;
  let chat = null;
  let chatParent = null;
  let chatNext = null;
  let pill = null;
  let sizeBadge = null;

  let active = false;
  let visible = false;
  let geom = null;
  let mountedAt = 0;

  let activateToken = 0;
  let dataChatOriginals = new Map();
  let dataChatObserver = null;
  let dataChatWatchdog = 0;
  let chatObserver = null;
  let selfDataChatWrite = false;

  let hiddenChrome = [];
  let rafId = 0;
  let saveTimer = 0;

  let uiTimer = 0;
  let uiHideTimer = 0;
  let settingsResetTimer = 0;
  let lastPointerAt = 0;

  let isDragging = false;
  let suppressClickUntil = 0;

  // ---------------------------------------------------------------- utils

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

  const i18n = (key) => {
    try {
      return chrome.i18n.getMessage(key) || key;
    } catch {
      return key;
    }
  };

  function isElementVisible(node) {
    if (!node || !node.isConnected || !node.getClientRects().length) return false;
    const style = getComputedStyle(node);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function make(tag, className, props) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (props) Object.assign(node, props);
    return node;
  }

  function makeIcon(name, size = 16) {
    const def = ICONS[name];
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');

    if (def.stroke) {
      svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke', 'currentColor');
      svg.setAttribute('stroke-width', '2');
      svg.setAttribute('stroke-linecap', 'round');
      svg.setAttribute('stroke-linejoin', 'round');
      for (const d of def.stroke) {
        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', d);
        svg.appendChild(path);
      }
      return svg;
    }

    svg.setAttribute('fill', 'currentColor');
    for (const shape of def.fill) {
      if (typeof shape === 'string') {
        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', shape);
        svg.appendChild(path);
      } else if (shape.c) {
        const circle = document.createElementNS(SVG_NS, 'circle');
        circle.setAttribute('cx', String(shape.c[0]));
        circle.setAttribute('cy', String(shape.c[1]));
        circle.setAttribute('r', '1.6');
        svg.appendChild(circle);
      }
    }
    return svg;
  }

  const getFsEl = () =>
    document.fullscreenElement || document.webkitFullscreenElement || null;

  // ------------------------------------------------------------- settings

  function normalize(raw) {
    const input = raw || {};
    const next = {
      enabled: input.enabled ?? DEFAULTS.enabled,
      autoOpen: input.autoOpen ?? DEFAULTS.autoOpen,
      shadow: input.shadow ?? DEFAULTS.shadow,
      blur: input.blur ?? DEFAULTS.blur,
      cornerRadius: input.cornerRadius ?? DEFAULTS.cornerRadius,
      pinned: input.pinned ?? DEFAULTS.pinned,
      panel: input.panel ?? DEFAULTS.panel,
    };
    next.enabled = next.enabled !== false;
    next.autoOpen = next.autoOpen !== false;
    next.shadow = next.shadow !== false;
    next.pinned = next.pinned === true;
    next.blur = clamp(Math.round(Number(next.blur ?? DEFAULTS.blur) || 0), 0, MAX_BLUR);
    next.cornerRadius = clamp(
      Math.round(Number(next.cornerRadius ?? DEFAULTS.cornerRadius) || 0),
      0,
      MAX_CORNER_RADIUS
    );

    const p = next.panel;
    if (
      !p ||
      typeof p !== 'object' ||
      ![p.x, p.y, p.w, p.h].every((n) => Number.isFinite(n))
    ) {
      next.panel = null;
    }
    return next;
  }

  function persist() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = 0;
    }
    saveTimer = window.setTimeout(flushPersist, 250);
  }

  function flushPersist() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = 0;
    }
    try {
      const payload = { ...DEFAULTS, ...settings };
      chrome.storage.local.set({ [STORE_KEY]: payload }).catch(() => {});
    } catch {
      /* extension context invalidated */
    }
  }

  // ---------------------------------------------------------- chat lookup

  function findChatByInput() {
    const inputs = document.querySelectorAll(
      'textarea, [contenteditable="true"], input[type="text"]'
    );
    for (const input of inputs) {
      const hint = `${input.getAttribute('placeholder') || ''} ${
        input.getAttribute('aria-label') || ''
      }`.toLowerCase();
      if (!/chat|message|mesaj/.test(hint)) continue;
      let node = input;
      for (let i = 0; i < 10 && node && node.parentElement; i += 1) {
        node = node.parentElement;
        if (panel && panel.contains(node)) break;
        const rect = node.getBoundingClientRect();
        if (
          rect.height > 200 &&
          rect.width > 200 &&
          rect.width < window.innerWidth * 0.65
        ) {
          return node;
        }
      }
    }
    return null;
  }

  function findChat() {
    for (const selector of CHAT_SELECTORS) {
      let found = null;
      try {
        found = document.querySelector(selector);
      } catch {
        continue;
      }
      if (found && !panel?.contains(found)) return found;
    }
    return findChatByInput();
  }

  function isPlayerFullscreen(el) {
    if (!el || el.nodeType !== 1) return false;
    // A DOM layer cannot be drawn over <video> fullscreen; leave it alone.
    if (el.tagName === 'VIDEO') return false;
    if (el.querySelector('video')) return true;
    return (
      el.id === 'injected-channel-player' ||
      el.matches('[data-testid="player"], .video-player')
    );
  }

  function waitForChat(tries) {
    return new Promise((resolve) => {
      let attempt = 0;
      const tick = () => {
        const found = findChat();
        if (found) return resolve(found);
        attempt += 1;
        if (attempt >= tries) return resolve(null);
        window.setTimeout(tick, 160);
      };
      tick();
    });
  }

  // ------------------------------------------------------------ fullscreen

  function onFullscreenChange() {
    if (!ready) return;
    const el = getFsEl();

    if (active) teardownPanel();
    unmountPill();
    fsEl = null;

    if (!el) return;
    if (!isPlayerFullscreen(el)) return;

    fsEl = el;
    if (!settings.enabled) return;

    showPill();
    if (settings.autoOpen) activate();
  }

  async function activate() {
    if (!settings.enabled || active) return;
    const el = getFsEl();
    if (!el || !isPlayerFullscreen(el)) return;
    fsEl = el;

    const token = ++activateToken;
    let chatEl = await waitForChat(5);
    if (token !== activateToken || !fsEl || fsEl !== getFsEl()) return;

    if (!chatEl) {
      showPill();
      return;
    }

    // Entering/leaving fullscreen makes Kick re-render its layout. Waiting one
    // more beat and re-reading the chat avoids mounting a node that React has
    // just replaced (a detached copy keeps its last messages but never updates).
    await new Promise((resolve) => window.setTimeout(resolve, 140));
    if (token !== activateToken || !fsEl || fsEl !== getFsEl()) return;
    const settled = findChat();
    if (settled && settled.isConnected) chatEl = settled;

    mountPanel(chatEl);
  }

  // ------------------------------------------------------------ panel mount

  function mountPanel(chatEl) {
    if (active || !fsEl) return;
    if (!chatEl || !chatEl.isConnected || (panel && panel.contains(chatEl))) {
      showPill();
      return;
    }

    chat = chatEl;
    chatParent = chat.parentNode;
    chatNext = chat.nextSibling;

    snapshotDataChat();
    buildPanel();
    chatHost.appendChild(chat);
    fsEl.appendChild(panel);

    active = true;
    visible = true;
    mountedAt = Date.now();

    geom = computeGeometry();
    applyGeometryNow();
    applyAppearance();
    syncSettingsMenu();
    startMessageViewSync();
    bindPanel();
    observeDataChat();
    observeChat();
    hidePill();
    showUi(true);
  }

  function teardownPanel(options = {}) {
    activateToken += 1;

    if (chatObserver) {
      chatObserver.disconnect();
      chatObserver = null;
    }
    stopDataChatWatch();

    clearMessageView();
    stopMessageViewSync();

    // Put the chat back exactly where it came from. When Kick has already
    // replaced the chat node, restoring the old one would duplicate it.
    if (!options.discardChat && chat && chatParent && chatParent.isConnected) {
      if (chatNext && chatNext.parentNode === chatParent) {
        chatParent.insertBefore(chat, chatNext);
      } else {
        chatParent.appendChild(chat);
      }
    }

    restoreDataChat();

    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    if (uiTimer) {
      clearTimeout(uiTimer);
      uiTimer = 0;
    }
    if (uiHideTimer) {
      clearTimeout(uiHideTimer);
      uiHideTimer = 0;
    }
    if (settingsResetTimer) {
      clearTimeout(settingsResetTimer);
      settingsResetTimer = 0;
    }
    flushPersist();

    if (panel) {
      panel.remove();
      panel = null;
    }

    chatHost = null;
    sizeBadge = null;
    chat = null;
    chatParent = null;
    chatNext = null;
    geom = null;
    active = false;
    visible = false;
    isDragging = false;
    suppressClickUntil = 0;
  }

  function deactivate() {
    teardownPanel();
    unmountPill();
    fsEl = null;
  }

  function handleChatLost() {
    if (!active) return;
    const wasVisible = visible;
    teardownPanel({ discardChat: true });
    const el = getFsEl();
    if (!el || !isPlayerFullscreen(el)) {
      unmountPill();
      return;
    }
    fsEl = el;
    showPill();
    if (wasVisible) activate();
  }

  function buildPanel() {
    panel = make('div', 'fscfk-panel');
    panel.id = 'fscfk-panel';

    const scrim = make('div', 'fscfk-scrim');
    chatHost = make('div', 'fscfk-chat-host');

    const tools = make('div', 'fscfk-tools');

    const grab = make('button', 'fscfk-grab', { type: 'button' });
    grab.title = i18n('dragToMove');
    grab.setAttribute('aria-label', i18n('moveChat'));
    grab.appendChild(makeIcon('grip', 14));

    const pin = make('button', 'fscfk-pin', { type: 'button' });
    pin.title = i18n('pinChat');
    pin.setAttribute('aria-label', i18n('pinChat'));
    pin.setAttribute('aria-pressed', 'false');
    pin.appendChild(makeIcon('pin', 14));

    const settingsButton = make('button', 'fscfk-settings-button', { type: 'button' });
    settingsButton.title = i18n('chatSettings');
    settingsButton.setAttribute('aria-label', i18n('chatSettings'));
    settingsButton.appendChild(makeIcon('settings', 14));

    const close = make('button', 'fscfk-close', { type: 'button' });
    close.title = i18n('closeShortcut');
    close.setAttribute('aria-label', i18n('closeChat'));
    close.appendChild(makeIcon('close', 12));

    const settingsMenu = make('div', 'fscfk-settings-menu');
    settingsMenu.hidden = true;
    settingsMenu.innerHTML = `
      <label class="fscfk-setting">
        <span>${i18n('backgroundBlur')}</span>
        <output data-fscfk-blur-output>14</output>
        <input data-fscfk-blur type="range" min="0" max="100" step="1" value="14">
      </label>
      <label class="fscfk-setting">
        <span>${i18n('cornerRounding')}</span>
        <output data-fscfk-radius-output>0</output>
        <input data-fscfk-radius type="range" min="0" max="24" step="1" value="0">
      </label>
      <label class="fscfk-setting fscfk-setting-toggle">
        <span>${i18n('textShadow')}</span>
        <input data-fscfk-shadow type="checkbox">
      </label>
      <button class="fscfk-setting-reset" type="button">${i18n('restoreDefaults')}</button>
    `;

    tools.append(grab, pin, settingsButton, close, settingsMenu);

    const resizeHandles = [
      ['nw', 'resizeNw'],
      ['n', 'resizeN'],
      ['ne', 'resizeNe'],
      ['e', 'resizeE'],
      ['se', 'resizeSe'],
      ['s', 'resizeS'],
      ['sw', 'resizeSw'],
      ['w', 'resizeW'],
    ].map(([dir, key]) => {
      const handle = make('button', `fscfk-resize fscfk-resize-${dir}`, { type: 'button' });
      const label = i18n(key);
      handle.dataset.dir = dir;
      handle.tabIndex = -1;
      handle.title = label;
      handle.setAttribute('aria-label', label);
      return handle;
    });

    const jumpToLatest = make('button', 'fscfk-jump-latest', { type: 'button' });
    jumpToLatest.hidden = true;
    jumpToLatest.setAttribute('aria-label', i18n('jumpLatest'));
    jumpToLatest.appendChild(makeIcon('down', 16));

    sizeBadge = make('div', 'fscfk-size-badge');
    sizeBadge.hidden = true;
    sizeBadge.setAttribute('aria-hidden', 'true');

    panel.append(scrim, chatHost, tools, jumpToLatest, sizeBadge, ...resizeHandles);
  }

  function bindPanel() {
    const grab = panel.querySelector('.fscfk-grab');
    const pin = panel.querySelector('.fscfk-pin');
    const settingsButton = panel.querySelector('.fscfk-settings-button');
    const settingsMenu = panel.querySelector('.fscfk-settings-menu');
    const close = panel.querySelector('.fscfk-close');

    grab.addEventListener('pointerdown', (event) => beginDrag(event, grab));
    grab.addEventListener('dblclick', (event) => {
      event.preventDefault();
      event.stopPropagation();
      resetGeometry();
    });

    pin.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      settingsMenu.hidden = true;
      settings.pinned = !settings.pinned;
      applyPinState();
      persist();
      showUi(false);
    });

    settingsButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      settingsMenu.hidden = !settingsMenu.hidden;
      syncSettingsMenu();
      showUi(false);
    });
    settingsMenu.addEventListener('click', (event) => event.stopPropagation());
    panel.querySelector('[data-fscfk-blur]').addEventListener('input', (event) => {
      settings.blur = Number(event.target.value);
      panel.querySelector('[data-fscfk-blur-output]').textContent = String(settings.blur);
      applyAppearance();
      persist();
    });
    panel.querySelector('[data-fscfk-radius]').addEventListener('input', (event) => {
      settings.cornerRadius = Number(event.target.value);
      panel.querySelector('[data-fscfk-radius-output]').textContent = String(settings.cornerRadius);
      applyAppearance();
      persist();
    });
    panel.querySelector('[data-fscfk-shadow]').addEventListener('change', (event) => {
      settings.shadow = event.target.checked;
      applyAppearance();
      persist();
    });

    const resetSettings = panel.querySelector('.fscfk-setting-reset');
    resetSettings.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      settings = normalize({ ...DEFAULTS, panel: settings.panel });
      applyAppearance();
      syncSettingsMenu();
      persist();

      resetSettings.textContent = i18n('defaultsRestored');
      resetSettings.classList.add('is-done');
      window.clearTimeout(settingsResetTimer);
      settingsResetTimer = window.setTimeout(() => {
        resetSettings.textContent = i18n('restoreDefaults');
        resetSettings.classList.remove('is-done');
        settingsResetTimer = 0;
      }, 1400);
    });

    close.addEventListener('click', (event) => {
      event.stopPropagation();
      closePanel();
    });
    close.addEventListener('dblclick', (event) => event.stopPropagation());

    const jumpLatest = panel.querySelector('.fscfk-jump-latest');
    if (jumpLatest) {
      jumpLatest.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        jumpToLatestMessages();
      });
      jumpLatest.addEventListener('dblclick', (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
    }

    for (const handle of panel.querySelectorAll('.fscfk-resize')) {
      handle.addEventListener('pointerdown', onResizeStart);
      handle.addEventListener('dblclick', (event) => {
        event.preventDefault();
        event.stopPropagation();
        resetGeometry();
      });
    }
    panel.addEventListener('pointerdown', onPanelAltDrag);
    panel.addEventListener('pointermove', onPanelPointerMove, { passive: true });
    panel.addEventListener('pointerleave', () => {
      if (!isDragging) hideUiSoon();
    });
    panel.addEventListener('focusin', () => showUi(false));
    panel.addEventListener('focusout', () => hideUiSoon());

    // Do not let Kick's fullscreen "double-click to exit" affect the chat.
    panel.addEventListener('dblclick', (event) => event.stopPropagation());

    // Do not treat an Alt-drag as a click on the message behind it.
    panel.addEventListener(
      'click',
      (event) => {
        if (performance.now() < suppressClickUntil) {
          event.preventDefault();
          event.stopPropagation();
        }
      },
      true
    );

    // Kick's reply-line and username controls open side panels or identity
    // dialogs outside the fullscreen player. They are not useful in this
    // overlay and can leave stale, inaccessible UI behind. Capture these
    // actions before React sees them, but leave normal message text and
    // scrolling/copy behaviour untouched.
    chatHost.addEventListener(
      'click',
      (event) => {
        if (!(event.target instanceof Element)) return;

        const usernameButton = event.target.closest(
          '#chatroom-messages button[style*="color:"], '
          + '#chatroom-messages [data-testid="channel-username"], '
          + '#chatroom-messages [data-prevent-expand="true"]'
        );
        if (usernameButton) {
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }

        const replyButton = event.target.closest(
          '#chatroom-messages button[aria-label*="reply" i], '
          + '#chatroom-messages button[title*="reply" i], '
          + '#chatroom-messages [data-testid*="reply" i], '
          + '#chatroom-messages [aria-label*="reply" i], '
          + '#chatroom-messages [title*="reply" i], '
          + '#chatroom-messages button.truncate.text-left'
        );
        if (replyButton) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      },
      true
    );
  }

  // --------------------------------------------- appearance / message view

  function applyAppearance() {
    if (!panel) return;
    panel.classList.toggle('fscfk-shadow', settings.shadow);

    const handleInset = Number((4 + Math.min(settings.cornerRadius * 0.4, 8)).toFixed(1));
    const handleRadius = Math.min(settings.cornerRadius, 8);
    panel.style.setProperty('--fscfk-radius', `${settings.cornerRadius}px`);
    panel.style.setProperty('--fscfk-handle-inset', `${handleInset}px`);
    panel.style.setProperty('--fscfk-handle-radius', `${handleRadius}px`);

    panel.classList.toggle('fscfk-blur', settings.blur > 0);
    if (settings.blur > 0) {
      const ratio = settings.blur / MAX_BLUR;
      const blurPx = Number((ratio * MAX_BLUR_PX).toFixed(2));
      const saturation = Number((1 + ratio * 0.08).toFixed(3));
      const tint = Number((ratio * 0.25).toFixed(3));
      panel.style.setProperty('--fscfk-blur', `${blurPx}px`);
      panel.style.setProperty('--fscfk-saturate', String(saturation));
      panel.style.setProperty('backdrop-filter', `blur(${blurPx}px) saturate(${saturation})`);
      panel.style.setProperty('-webkit-backdrop-filter', `blur(${blurPx}px) saturate(${saturation})`);
      panel.style.setProperty('--fscfk-tint', String(tint));
    } else {
      panel.style.removeProperty('--fscfk-blur');
      panel.style.removeProperty('--fscfk-saturate');
      panel.style.removeProperty('backdrop-filter');
      panel.style.removeProperty('-webkit-backdrop-filter');
      panel.style.setProperty('--fscfk-tint', '0');
      const scrim = panel.querySelector('.fscfk-scrim');
      if (scrim) scrim.style.removeProperty('backdrop-filter');
    }
  }

  function applyPinState() {
    if (!panel) return;
    panel.classList.toggle('fscfk-pinned', settings.pinned);
    const pin = panel.querySelector('.fscfk-pin');
    if (!pin) return;
    pin.setAttribute('aria-pressed', String(settings.pinned));
    pin.title = settings.pinned ? i18n('unpinChat') : i18n('pinChat');
    pin.setAttribute('aria-label', settings.pinned ? i18n('unpinChat') : i18n('pinChat'));
  }

  function syncSettingsMenu() {
    if (!panel) return;
    const blur = panel.querySelector('[data-fscfk-blur]');
    const blurOutput = panel.querySelector('[data-fscfk-blur-output]');
    const radius = panel.querySelector('[data-fscfk-radius]');
    const radiusOutput = panel.querySelector('[data-fscfk-radius-output]');
    const shadow = panel.querySelector('[data-fscfk-shadow]');
    if (blur) blur.value = String(settings.blur);
    if (blurOutput) blurOutput.textContent = String(settings.blur);
    if (radius) radius.value = String(settings.cornerRadius);
    if (radiusOutput) radiusOutput.textContent = String(settings.cornerRadius);
    if (shadow) shadow.checked = settings.shadow;
    applyPinState();
  }

  function clearMessageView() {
    for (const node of hiddenChrome) node.classList.remove('fscfk-chrome-hidden');
    hiddenChrome = [];
  }

  function hideNode(node) {
    if (!node || node.nodeType !== 1) return;
    if (node.classList.contains('fscfk-chrome-hidden')) return;
    node.classList.add('fscfk-chrome-hidden');
    hiddenChrome.push(node);
  }

  // Is this the scrollable message area? Stay conservative so a wrong node
  // is never mistaken for the message area and the whole chat is not hidden.
  function isMessageScroller(node) {
    if (!node || !isElementVisible(node)) return false;
    if (node.id === 'chatroom-messages') return true;
    if (node.getAttribute('data-testid') === 'chatroom-messages') return true;
    if (/chatroom-messages/i.test(String(node.className))) return true;
    const style = getComputedStyle(node);
    if (!/(auto|scroll)/.test(style.overflowY)) return false;
    // A very short panel (or a quiet chat that has not started scrolling yet)
    // must still be recognised, otherwise the header/composer are never hidden
    // and the message area is squeezed down to zero height.
    if (node.clientHeight < 24 || node.clientWidth < 100) return false;
    return node.scrollHeight > node.clientHeight + 4;
  }

  function findMessageScroller(root) {
    if (!root) return null;

    // Kick's own id is authoritative; no size heuristics are needed. Asking for
    // a minimum height used to fail at the smallest panel sizes, which kept the
    // header and composer visible and left no room for messages.
    const known = root.querySelector(
      '#chatroom-messages, [data-testid="chatroom-messages"]'
    );
    if (known && isElementVisible(known)) return known;

    let best = null;
    let bestScore = 0;

    for (const node of root.querySelectorAll('div, section, ul, main')) {
      if (!isMessageScroller(node)) continue;
      const score = node.clientHeight;
      if (score > bestScore) {
        best = node;
        bestScore = score;
      }
    }
    return best;
  }

  // Hides every chat part outside the message area (header, notification
  // strip, promo, composer) up to the chat root. It never touches the chain
  // that contains the message area.
  function hideChromeOutside(scroller) {
    let node = scroller;
    while (node && node !== chat) {
      const parent = node.parentElement;
      if (!parent) break;
      for (const child of Array.from(parent.children)) {
        if (child === node || child.contains(node)) continue;
        hideNode(child);
      }
      node = parent;
    }
  }

  // Pinned message / notification strips that stick to the top inside the
  // message stream. Only touches thin sticky layers at the top.
  function hidePinnedBanners(scroller) {
    const top = scroller.getBoundingClientRect().top;
    const roots = [scroller, ...scroller.children];

    for (const root of roots) {
      for (const node of root.children) {
        if (node.closest('.fscfk-chrome-hidden')) continue;
        if (getComputedStyle(node).position !== 'sticky') continue;
        const rect = node.getBoundingClientRect();
        if (rect.height > 0 && rect.height <= 260 && rect.top <= top + 8) hideNode(node);
      }
    }

    for (const node of scroller.querySelectorAll(
      '[class*="pinned" i], [data-testid*="pinned" i], [aria-label*="sabitl" i]'
    )) {
      if (node.closest('.fscfk-chrome-hidden')) continue;
      hideNode(node);
    }
  }

  function applyMessageView() {
    clearMessageView();
    if (!active || !chat) return null;

    const scroller = findMessageScroller(chat);
    if (!scroller) return null;

    hideChromeOutside(scroller);
    hidePinnedBanners(scroller);
    return scroller;
  }

  // ------------------------------------------------- message view lifecycle

  let messageViewObserver = null;
  let messageViewTimer = 0;
  let messageViewInitTimers = [];
  let messageViewScroller = null;
  let markedScroller = null;
  let scrollerScrollHandler = null;
  let scrollerAtBottom = true;
  let jumpingToLatest = false;
  let jumpGuardUntil = 0;
  let jumpFrame = 0;

  function stopJumpGuard() {
    if (jumpFrame) {
      cancelAnimationFrame(jumpFrame);
      jumpFrame = 0;
    }
    jumpingToLatest = false;
    jumpGuardUntil = 0;
  }

  function pinScrollerToBottom(node) {
    if (!node || !node.isConnected) return false;
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
    if (distance > 2) node.scrollTop = node.scrollHeight;
    return distance <= 2;
  }

  function setMessageViewScroller(node) {
    const next = node && node.isConnected ? node : null;
    if (markedScroller === next) return;

    if (jumpingToLatest) stopJumpGuard();

    if (markedScroller) {
      markedScroller.classList.remove('fscfk-scroller');
      if (scrollerScrollHandler) {
        markedScroller.removeEventListener('scroll', scrollerScrollHandler);
      }
    }

    markedScroller = next;
    scrollerScrollHandler = null;
    if (!markedScroller) return;

    // Keep the virtualised message list flexible at any panel height.
    markedScroller.classList.add('fscfk-scroller');
    scrollerScrollHandler = () => {
      if (!markedScroller) return;
      if (jumpingToLatest) {
        scrollerAtBottom = true;
        updateJumpLatestButton();
        return;
      }
      scrollerAtBottom =
        markedScroller.scrollHeight - markedScroller.scrollTop - markedScroller.clientHeight <
        48;
      updateJumpLatestButton();
    };
    markedScroller.addEventListener('scroll', scrollerScrollHandler, { passive: true });
    scrollerAtBottom =
      markedScroller.scrollHeight - markedScroller.scrollTop - markedScroller.clientHeight < 48;
  }

  function updateJumpLatestButton() {
    if (!panel) return;
    const button = panel.querySelector('.fscfk-jump-latest');
    if (!button) return;
    const shouldShow = !!markedScroller && !scrollerAtBottom && !jumpingToLatest;
    button.hidden = !shouldShow;
  }

  function jumpToLatestMessages() {
    const node = markedScroller;
    if (!node || !node.isConnected) return;

    jumpingToLatest = true;
    jumpGuardUntil = performance.now() + JUMP_GUARD_MS;
    scrollerAtBottom = true;
    updateJumpLatestButton();
    pinScrollerToBottom(node);

    if (jumpFrame) cancelAnimationFrame(jumpFrame);
    const guard = () => {
      jumpFrame = 0;
      if (!active || !jumpingToLatest) return;
      const current = markedScroller;
      if (!current || !current.isConnected) {
        stopJumpGuard();
        return;
      }
      pinScrollerToBottom(current);
      scrollerAtBottom = true;
      updateJumpLatestButton();
      if (performance.now() < jumpGuardUntil) {
        jumpFrame = window.requestAnimationFrame(guard);
      } else {
        stopJumpGuard();
        updateJumpLatestButton();
      }
    };
    jumpFrame = window.requestAnimationFrame(guard);
  }

  function keepScrollerAtBottom() {
    const node = markedScroller;
    if (!node || !node.isConnected) return;
    if (jumpingToLatest) {
      pinScrollerToBottom(node);
      scrollerAtBottom = true;
      updateJumpLatestButton();
      return;
    }
    if (!scrollerAtBottom) return;
    pinScrollerToBottom(node);
  }

  function refreshChatLayout() {
    if (!active) return;
    scheduleMessageViewSync(60);
    window.requestAnimationFrame(() => {
      if (active) keepScrollerAtBottom();
    });
  }

  function syncMessageView() {
    if (!active || !chat) return;
    messageViewScroller = applyMessageView();
    setMessageViewScroller(messageViewScroller);
    if (messageViewScroller) keepScrollerAtBottom();
    updateJumpLatestButton();
  }

  function scheduleMessageViewSync(delay = 160) {
    if (messageViewTimer) return;
    messageViewTimer = window.setTimeout(() => {
      messageViewTimer = 0;
      syncMessageView();
    }, delay);
  }

  function startMessageViewSync() {
    stopMessageViewSync();
    // The layout may not have settled right after the chat is moved into the
    // panel; retry a few times if measurements come back as zero.
    syncMessageView();
    messageViewInitTimers = [80, 220, 480, 1000].map((delay) =>
      window.setTimeout(() => {
        if (active) syncMessageView();
      }, delay)
    );
    if (!chat) return;

    messageViewObserver = new MutationObserver((records) => {
      if (!active) return;
      if (!messageViewScroller || !messageViewScroller.isConnected) {
        scheduleMessageViewSync(120);
        return;
      }
      for (const record of records) {
        if (messageViewScroller.contains(record.target)) continue;
        scheduleMessageViewSync();
        return;
      }

      window.requestAnimationFrame(() => {
        if (!active) return;
        keepScrollerAtBottom();
        updateJumpLatestButton();
      });
    });
    messageViewObserver.observe(chat, { childList: true, subtree: true });
  }

  function stopMessageViewSync() {
    if (messageViewObserver) {
      messageViewObserver.disconnect();
      messageViewObserver = null;
    }
    if (messageViewTimer) {
      window.clearTimeout(messageViewTimer);
      messageViewTimer = 0;
    }
    for (const timer of messageViewInitTimers) window.clearTimeout(timer);
    messageViewInitTimers = [];
    stopJumpGuard();
    messageViewScroller = null;
    setMessageViewScroller(null);
  }

  // -------------------------------------------------------------- geometry

  function viewportSize() {
    return { w: Math.max(0, window.innerWidth), h: Math.max(0, window.innerHeight) };
  }

  function fitWidth(width, vw) {
    const max = Math.max(0, Math.min(MAX_W, vw));
    const min = Math.min(MIN_W, max);
    return Math.round(clamp(width, min, max));
  }

  function fitHeight(height, vh) {
    const max = Math.max(0, vh);
    const min = Math.min(MIN_H, max);
    return Math.round(clamp(height, min, max));
  }

  function fitPosition(x, y, w, h, vw, vh) {
    return {
      x: Math.round(clamp(x, 0, Math.max(0, vw - w))),
      y: Math.round(clamp(y, 0, Math.max(0, vh - h))),
    };
  }

  function resizeFrom(dir, start, dx, dy, vw, vh) {
    const next = { ...start };
    const right = Math.min(start.x + start.w, vw);
    const bottom = Math.min(start.y + start.h, vh);

    // Drag the left/top edge: the opposite edge stays anchored.
    const dragLeft = () => {
      const minWidth = Math.min(MIN_W, right);
      next.x = Math.round(clamp(start.x + dx, 0, Math.max(0, right - minWidth)));
      next.w = Math.max(minWidth, right - next.x);
    };
    const dragTop = () => {
      const minHeight = Math.min(MIN_H, bottom);
      next.y = Math.round(clamp(start.y + dy, 0, Math.max(0, bottom - minHeight)));
      next.h = Math.max(minHeight, bottom - next.y);
    };

    // Drag the right/bottom edge: the left/top edge stays anchored.
    const dragRight = () => {
      const maxWidth = Math.max(0, vw - start.x);
      next.w = Math.round(clamp(start.w + dx, Math.min(MIN_W, maxWidth), maxWidth));
    };
    const dragBottom = () => {
      const maxHeight = Math.max(0, vh - start.y);
      next.h = Math.round(clamp(start.h + dy, Math.min(MIN_H, maxHeight), maxHeight));
    };

    switch (dir) {
      case 'n':
        dragTop();
        break;
      case 's':
        dragBottom();
        break;
      case 'w':
        dragLeft();
        break;
      case 'e':
        dragRight();
        break;
      case 'ne':
        dragRight();
        dragTop();
        break;
      case 'nw':
        dragLeft();
        dragTop();
        break;
      case 'se':
        dragRight();
        dragBottom();
        break;
      case 'sw':
        dragLeft();
        dragBottom();
        break;
      default:
        dragRight();
        dragBottom();
    }

    return { ...fitPosition(next.x, next.y, next.w, next.h, vw, vh), w: next.w, h: next.h };
  }

  function computeGeometry() {
    const { w: vw, h: vh } = viewportSize();
    const saved = settings.panel;

    let w = saved ? saved.w : 360;
    let h = saved ? saved.h * vh : Math.min(vh * 0.82, MAX_H);

    w = fitWidth(w, vw);
    h = fitHeight(h, vh);

    const x = saved ? saved.x * vw : vw - w - 20;
    const y = saved ? saved.y * vh : (vh - h) / 2;

    return { ...fitPosition(x, y, w, h, vw, vh), w, h };
  }

  function applyGeometryNow() {
    if (!panel || !geom) return;
    panel.style.left = `${geom.x}px`;
    panel.style.top = `${geom.y}px`;
    panel.style.width = `${geom.w}px`;
    panel.style.height = `${geom.h}px`;
  }

  function scheduleGeometry() {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      applyGeometryNow();
    });
  }

  function saveGeometry() {
    if (!geom) return;
    const vw = window.innerWidth || 1;
    const vh = window.innerHeight || 1;
    settings.panel = {
      x: Number((geom.x / vw).toFixed(5)),
      y: Number((geom.y / vh).toFixed(5)),
      w: Math.round(geom.w),
      h: Number((geom.h / vh).toFixed(5)),
    };
    persist();
  }

  function resetGeometry() {
    settings.panel = null;
    persist();
    geom = computeGeometry();
    applyGeometryNow();
    refreshChatLayout();
  }

  function markDragging(value) {
    isDragging = value;
    if (!panel) return;
    panel.classList.toggle('fscfk-dragging', value);
    panel.style.willChange = value ? 'left, top, width, height' : '';
    if (value) showUi(false);
    else hideUiSoon();
  }

  // ---------------------------------------------------------- hover controls

  function showUi(autoHide) {
    if (!panel) return;
    // A delayed hide from an earlier hover must never win over an explicit
    // show (e.g. a long resize started while the controls were auto-hiding).
    if (uiHideTimer) {
      clearTimeout(uiHideTimer);
      uiHideTimer = 0;
    }
    if (uiTimer) {
      clearTimeout(uiTimer);
      uiTimer = 0;
    }
    panel.classList.add('fscfk-show-ui');
    if (autoHide) {
      uiTimer = window.setTimeout(() => {
        uiTimer = 0;
        if (!isDragging) panel?.classList.remove('fscfk-show-ui');
      }, 1800);
    }
  }

  function hideUiSoon() {
    if (isDragging) return;
    if (uiTimer) {
      clearTimeout(uiTimer);
      uiTimer = 0;
    }
    if (uiHideTimer) clearTimeout(uiHideTimer);
    uiHideTimer = window.setTimeout(() => {
      uiHideTimer = 0;
      if (!isDragging) panel?.classList.remove('fscfk-show-ui');
    }, 500);
  }

  function setSizeBadge(visible) {
    if (!sizeBadge) return;
    if (visible && geom) {
      sizeBadge.textContent = `${geom.w} × ${geom.h}`;
      sizeBadge.hidden = false;
    } else {
      sizeBadge.hidden = true;
    }
  }

  function onPanelPointerMove() {
    if (isDragging) return;
    const now = performance.now();
    if (now - lastPointerAt < 150) return;
    lastPointerAt = now;
    showUi(true);
  }

  // ------------------------------------------------------------------ drag

  function onPanelAltDrag(event) {
    if (settings.pinned || !event.altKey || event.button !== 0) return;
    if (
      event.target.closest(
        '.fscfk-tools, input, textarea, select, a, button, [contenteditable="true"]'
      )
    ) {
      return;
    }
    beginDrag(event, panel);
  }

  function beginDrag(event, surface) {
    if (settings.pinned || !panel || !geom || event.button !== 0) return;

    event.preventDefault();
    event.stopPropagation();

    const start = { ...geom };
    const startX = event.clientX;
    const startY = event.clientY;
    let moved = false;

    try {
      surface.setPointerCapture(event.pointerId);
    } catch {
      /* noop */
    }
    markDragging(true);

    const onMove = (moveEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 3) return;
      moved = true;
      const { w: vw, h: vh } = viewportSize();
      const next = fitPosition(start.x + dx, start.y + dy, geom.w, geom.h, vw, vh);
      geom.x = next.x;
      geom.y = next.y;
      scheduleGeometry();
    };

    const onEnd = () => {
      surface.removeEventListener('pointermove', onMove);
      surface.removeEventListener('pointerup', onEnd);
      surface.removeEventListener('pointercancel', onEnd);
      markDragging(false);
      if (!moved) return;

      // Swallow the click that follows right after a drag (so a user card or
      // link is not opened by accident).
      suppressClickUntil = performance.now() + 250;

      // Soft snap to all four edges, including exact flush placement.
      const { w: vw, h: vh } = viewportSize();
      if (geom.x <= SNAP) {
        geom.x = 0;
      } else if (geom.x + geom.w >= vw - SNAP) {
        geom.x = Math.max(0, vw - geom.w);
      }
      if (geom.y <= SNAP) {
        geom.y = 0;
      } else if (geom.y + geom.h >= vh - SNAP) {
        geom.y = Math.max(0, vh - geom.h);
      }
      const fitted = fitPosition(geom.x, geom.y, geom.w, geom.h, vw, vh);
      geom.x = fitted.x;
      geom.y = fitted.y;
      applyGeometryNow();
      saveGeometry();
      refreshChatLayout();
    };

    surface.addEventListener('pointermove', onMove);
    surface.addEventListener('pointerup', onEnd);
    surface.addEventListener('pointercancel', onEnd);
  }

  function onResizeStart(event) {
    if (settings.pinned || event.button !== 0 || !panel || !geom) return;

    event.preventDefault();
    event.stopPropagation();

    const handle = event.currentTarget;
    const dir = handle.dataset.dir || 'se';
    const start = { ...geom };
    const startX = event.clientX;
    const startY = event.clientY;

    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      /* noop */
    }
    markDragging(true);
    setSizeBadge(true);

    const onMove = (moveEvent) => {
      const { w: vw, h: vh } = viewportSize();
      const next = resizeFrom(
        dir,
        start,
        moveEvent.clientX - startX,
        moveEvent.clientY - startY,
        vw,
        vh
      );
      geom.x = next.x;
      geom.y = next.y;
      geom.w = next.w;
      geom.h = next.h;
      scheduleGeometry();
      setSizeBadge(true);
    };

    const onEnd = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onEnd);
      handle.removeEventListener('pointercancel', onEnd);
      setSizeBadge(false);
      markDragging(false);
      applyGeometryNow();
      saveGeometry();
      refreshChatLayout();
    };

    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onEnd);
    handle.addEventListener('pointercancel', onEnd);
  }

  // ----------------------------------------------------------- open / close

  function closePanel() {
    if (!active || !panel) return;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    applyGeometryNow();
    panel.hidden = true;
    visible = false;
    showPill();
  }

  function openPanel() {
    if (!active) {
      activate();
      return;
    }
    if (!chat || !chat.isConnected) {
      teardownPanel({ discardChat: true });
      const el = getFsEl();
      if (!el || !isPlayerFullscreen(el)) {
        unmountPill();
        return;
      }
      fsEl = el;
      activate();
      return;
    }
    assertDataChat();
    panel.hidden = false;
    visible = true;
    geom = computeGeometry();
    applyGeometryNow();
    applyAppearance();
    startMessageViewSync();
    refreshChatLayout();
    hidePill();
    showUi(true);
  }

  // ------------------------------------------------------------------- pill

  function createPill() {
    const button = make('button', 'fscfk-pill', { type: 'button' });
    button.id = 'fscfk-pill';
    button.setAttribute('aria-label', i18n('openPanel'));
    button.appendChild(makeIcon('chat', 17));

    const label = make('span', 'fscfk-pill-label');
    label.textContent = i18n('pillLabel');
    button.appendChild(label);

    button.addEventListener('click', (event) => {
      event.stopPropagation();
      if (active) openPanel();
      else activate();
    });
    button.addEventListener('dblclick', (event) => event.stopPropagation());
    return button;
  }

  function showPill() {
    if (!settings.enabled || !fsEl) return;
    if (!pill) pill = createPill();
    if (!pill.isConnected) fsEl.appendChild(pill);
    pill.hidden = false;
  }

  function hidePill() {
    if (pill) pill.hidden = true;
  }

  function unmountPill() {
    if (pill) {
      pill.remove();
      pill = null;
    }
  }

  // -------------------------------------------------------------- data-chat

  // Kick drives chat visibility from data-chat on the page root. When it is
  // "false" the chat root gets `group-data-[chat=false]/main:opacity-0` and
  // `lg:w-0`; the moved chat then looks empty even though messages keep
  // arriving. React re-writes the attribute during fullscreen transitions, so
  // pin it to "true" for as long as the overlay owns the chat.
  function assertDataChat() {
    let changed = false;
    for (const node of document.querySelectorAll('[data-chat]')) {
      if (!dataChatOriginals.has(node)) {
        dataChatOriginals.set(node, node.getAttribute('data-chat'));
      }
      if (node.getAttribute('data-chat') !== 'true') {
        node.setAttribute('data-chat', 'true');
        changed = true;
      }
    }
    if (changed) {
      selfDataChatWrite = true;
      window.setTimeout(() => {
        selfDataChatWrite = false;
      }, 0);
    }
    return changed;
  }

  function snapshotDataChat() {
    dataChatOriginals = new Map();
    assertDataChat();
  }

  function restoreDataChat() {
    for (const [node, value] of dataChatOriginals) {
      if (!node.isConnected) continue;
      if (value === null) node.removeAttribute('data-chat');
      else node.setAttribute('data-chat', value);
    }
    dataChatOriginals.clear();
  }

  function observeDataChat() {
    stopDataChatWatch();
    dataChatObserver = new MutationObserver(() => {
      if (!active || selfDataChatWrite) return;
      if (Date.now() - mountedAt < 400) return;
      assertDataChat();
    });
    dataChatObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-chat'],
      subtree: true,
    });
    // React can also mount a fresh layout with data-chat already false, which
    // produces no attribute mutation. A cheap watchdog re-asserts it.
    dataChatWatchdog = window.setInterval(() => {
      if (active) assertDataChat();
    }, 1000);
  }

  function stopDataChatWatch() {
    if (dataChatObserver) {
      dataChatObserver.disconnect();
      dataChatObserver = null;
    }
    if (dataChatWatchdog) {
      window.clearInterval(dataChatWatchdog);
      dataChatWatchdog = 0;
    }
  }

  // ------------------------------------------------------------ chat watch

  function observeChat() {
    if (!chatHost) return;
    chatObserver = new MutationObserver(() => {
      if (!active || !chat) return;
      if (!chat.isConnected || chat.parentNode !== chatHost) handleChatLost();
    });
    chatObserver.observe(chatHost, { childList: true });
  }

  // --------------------------------------------------------------- hotkey

  function onKeyDown(event) {
    if (!settings.enabled || !ready) return;
    if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.code !== 'KeyK' && String(event.key).toLowerCase() !== 'k') return;

    const el = getFsEl();
    if (!el || !isPlayerFullscreen(el)) return;

    event.preventDefault();
    event.stopPropagation();

    if (active) {
      if (visible) closePanel();
      else openPanel();
    } else {
      activate();
    }
  }

  // -------------------------------------------------------------- lifecycle

  function onWindowResize() {
    if (!active || !geom) return;
    const { w: vw, h: vh } = viewportSize();
    geom.w = fitWidth(geom.w, vw);
    geom.h = fitHeight(geom.h, vh);
    const fitted = fitPosition(geom.x, geom.y, geom.w, geom.h, vw, vh);
    geom.x = fitted.x;
    geom.y = fitted.y;
    applyGeometryNow();
    refreshChatLayout();
  }

  function onStorageChanged(changes, area) {
    if (area !== 'local' || !changes[STORE_KEY]) return;

    const previous = settings;
    settings = normalize(changes[STORE_KEY].newValue);

    if (!settings.enabled) {
      deactivate();
      return;
    }

    if (!previous.enabled) {
      onFullscreenChange();
      return;
    }

    if (active) {
      if (
        previous.blur !== settings.blur ||
        previous.shadow !== settings.shadow ||
        previous.cornerRadius !== settings.cornerRadius
      ) {
        applyAppearance();
      }
      if (
        previous.blur !== settings.blur ||
        previous.shadow !== settings.shadow ||
        previous.cornerRadius !== settings.cornerRadius ||
        previous.pinned !== settings.pinned
      ) {
        syncSettingsMenu();
      }
    }
  }

  function onMessage(message) {
    if (!message || typeof message !== 'object') return undefined;
    if (message.type === 'fscfk:reset-geometry') {
      settings.panel = null;
      if (active) {
        geom = computeGeometry();
        applyGeometryNow();
      }
    }
    return undefined;
  }

  function onNavigate() {
    if (active) deactivate();
  }

  async function init() {
    try {
      const stored = await chrome.storage.local.get(STORE_KEY);
      settings = normalize(stored?.[STORE_KEY]);
    } catch {
      settings = { ...DEFAULTS };
    }
    ready = true;

    document.addEventListener('fullscreenchange', onFullscreenChange, true);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange, true);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', onWindowResize, { passive: true });
    window.addEventListener('popstate', onNavigate);

    try {
      chrome.storage.onChanged.addListener(onStorageChanged);
      chrome.runtime.onMessage.addListener(onMessage);
    } catch {
      /* extension context invalidated */
    }

    if (getFsEl()) onFullscreenChange();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
