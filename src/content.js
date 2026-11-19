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
    obsMode: true,
    shadow: true,
    blur: 14,
    pinned: false,
    panel: null,
  });

  const MAX_BLUR = 100;
  const MAX_BLUR_PX = 30;

  const MIN_W = 280;
  const MIN_H = 220;
  const EDGE = 8;
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
  let lastPointerAt = 0;

  let isDragging = false;
  let suppressClickUntil = 0;

  // ---------------------------------------------------------------- utils

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

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
    const next = { ...DEFAULTS, ...(raw || {}) };
    next.enabled = next.enabled !== false;
    next.autoOpen = next.autoOpen !== false;
    next.obsMode = next.obsMode !== false;
    next.shadow = next.shadow !== false;
    next.pinned = next.pinned === true;
    next.blur = clamp(Math.round(Number(next.blur ?? DEFAULTS.blur) || 0), 0, MAX_BLUR);
    delete next.transparency;

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
    if (settings.autoOpen) activate(false);
  }

  async function activate(userInitiated) {
    if (!settings.enabled || active) return;
    const el = getFsEl();
    if (!el || !isPlayerFullscreen(el)) return;
    fsEl = el;

    const token = ++activateToken;
    let chatEl = await waitForChat(5);
    if (token !== activateToken || !fsEl || fsEl !== getFsEl()) return;

    if (!chatEl) {
      if (userInitiated) {
        showToast('Chat not found. Keep the chat open and try again.');
      }
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
    startObsSync();
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

    clearObsMode();
    stopObsSync();

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
    flushPersist();

    if (panel) {
      panel.remove();
      panel = null;
    }

    chatHost = null;
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
    if (wasVisible) activate(false);
  }

  function buildPanel() {
    panel = make('div', 'fscfk-panel');
    panel.id = 'fscfk-panel';

    const scrim = make('div', 'fscfk-scrim');
    chatHost = make('div', 'fscfk-chat-host');

    const tools = make('div', 'fscfk-tools');

    const grab = make('button', 'fscfk-grab', { type: 'button' });
    grab.title = 'Drag to move (or hold Alt and drag from the chat)';
    grab.setAttribute('aria-label', 'Move chat');
    grab.appendChild(makeIcon('grip', 14));

    const pin = make('button', 'fscfk-pin', { type: 'button' });
    pin.title = 'Pin chat in place';
    pin.setAttribute('aria-label', 'Pin chat in place');
    pin.setAttribute('aria-pressed', 'false');
    pin.appendChild(makeIcon('pin', 14));

    const settingsButton = make('button', 'fscfk-settings-button', { type: 'button' });
    settingsButton.title = 'Chat settings';
    settingsButton.setAttribute('aria-label', 'Chat settings');
    settingsButton.appendChild(makeIcon('settings', 14));

    const close = make('button', 'fscfk-close', { type: 'button' });
    close.title = 'Close (Alt+K)';
    close.setAttribute('aria-label', 'Close chat');
    close.appendChild(makeIcon('close', 12));

    const settingsMenu = make('div', 'fscfk-settings-menu');
    settingsMenu.hidden = true;
    settingsMenu.innerHTML = `
      <label class="fscfk-setting">
        <span>Background blur</span>
        <output data-fscfk-blur-output>14</output>
        <input data-fscfk-blur type="range" min="0" max="100" step="1" value="14">
      </label>
      <label class="fscfk-setting fscfk-setting-toggle">
        <span>Messages only</span>
        <input data-fscfk-obs type="checkbox">
      </label>
      <label class="fscfk-setting fscfk-setting-toggle">
        <span>Text shadow</span>
        <input data-fscfk-shadow type="checkbox">
      </label>
    `;

    tools.append(grab, pin, settingsButton, close, settingsMenu);

    const resizeSw = make('div', 'fscfk-resize fscfk-resize-sw');
    resizeSw.dataset.dir = 'sw';
    resizeSw.title = 'Resize (bottom-left corner)';

    const resizeSe = make('div', 'fscfk-resize fscfk-resize-se');
    resizeSe.dataset.dir = 'se';
    resizeSe.title = 'Resize (bottom-right corner)';

    panel.append(scrim, chatHost, tools, resizeSw, resizeSe);
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
    panel.querySelector('[data-fscfk-obs]').addEventListener('change', (event) => {
      settings.obsMode = event.target.checked;
      if (settings.obsMode) startObsSync();
      else {
        stopObsSync();
        clearObsMode();
      }
      persist();
    });
    panel.querySelector('[data-fscfk-shadow]').addEventListener('change', (event) => {
      settings.shadow = event.target.checked;
      applyAppearance();
      persist();
    });

    close.addEventListener('click', (event) => {
      event.stopPropagation();
      closePanel();
    });
    close.addEventListener('dblclick', (event) => event.stopPropagation());

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
  }

  // ------------------------------------------------------- appearance / obs

  function applyAppearance() {
    if (!panel) return;
    panel.classList.toggle('fscfk-shadow', settings.shadow);
    panel.classList.toggle('fscfk-blur', settings.blur > 0);
    if (settings.blur > 0) {
      const blurPx = Math.round((settings.blur / MAX_BLUR) * MAX_BLUR_PX);
      panel.style.setProperty('--fscfk-blur', `${blurPx}px`);
      panel.style.setProperty('backdrop-filter', `blur(${blurPx}px) saturate(1.08)`);
      panel.style.setProperty('-webkit-backdrop-filter', `blur(${blurPx}px) saturate(1.08)`);
      panel.style.setProperty('--fscfk-tint', '0.25');
    } else {
      panel.style.removeProperty('--fscfk-blur');
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
    pin.title = settings.pinned ? 'Unpin chat' : 'Pin chat in place';
    pin.setAttribute('aria-label', settings.pinned ? 'Unpin chat' : 'Pin chat in place');
  }

  function syncSettingsMenu() {
    if (!panel) return;
    const blur = panel.querySelector('[data-fscfk-blur]');
    const blurOutput = panel.querySelector('[data-fscfk-blur-output]');
    const obs = panel.querySelector('[data-fscfk-obs]');
    const shadow = panel.querySelector('[data-fscfk-shadow]');
    if (blur) blur.value = String(settings.blur);
    if (blurOutput) blurOutput.textContent = String(settings.blur);
    if (obs) obs.checked = settings.obsMode;
    if (shadow) shadow.checked = settings.shadow;
    applyPinState();
  }

  function clearObsMode() {
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

  function applyObsMode() {
    clearObsMode();
    if (!settings.obsMode || !active || !chat) return null;

    const scroller = findMessageScroller(chat);
    if (!scroller) return null;

    hideChromeOutside(scroller);
    hidePinnedBanners(scroller);
    return scroller;
  }

  // --------------------------------------------------------- obs lifecycle

  let obsObserver = null;
  let obsTimer = 0;
  let obsScroller = null;
  let markedScroller = null;
  let scrollerScrollHandler = null;
  let scrollerAtBottom = true;

  function setObsScroller(node) {
    const next = node && node.isConnected ? node : null;
    if (markedScroller === next) return;

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
      scrollerAtBottom =
        markedScroller.scrollHeight - markedScroller.scrollTop - markedScroller.clientHeight <
        48;
    };
    markedScroller.addEventListener('scroll', scrollerScrollHandler, { passive: true });
    scrollerAtBottom =
      markedScroller.scrollHeight - markedScroller.scrollTop - markedScroller.clientHeight < 48;
  }

  function keepScrollerAtBottom() {
    const node = markedScroller;
    if (!node || !node.isConnected || !scrollerAtBottom) return;
    if (node.scrollTop + node.clientHeight < node.scrollHeight - 2) {
      node.scrollTop = node.scrollHeight;
    }
  }

  function refreshChatLayout() {
    if (!active) return;
    scheduleObsSync(60);
    window.requestAnimationFrame(() => {
      if (active) keepScrollerAtBottom();
    });
  }

  function syncObsMode() {
    if (!active || !chat) return;
    if (!settings.obsMode) {
      clearObsMode();
      setObsScroller(null);
      return;
    }
    obsScroller = applyObsMode();
    setObsScroller(obsScroller);
    if (obsScroller) keepScrollerAtBottom();
  }

  function scheduleObsSync(delay = 160) {
    if (obsTimer) return;
    obsTimer = window.setTimeout(() => {
      obsTimer = 0;
      syncObsMode();
    }, delay);
  }

  function startObsSync() {
    stopObsSync();
    // The layout may not have settled right after the chat is moved into the
    // panel; retry a few times if measurements come back as zero.
    syncObsMode();
    for (const delay of [80, 220, 480, 1000]) {
      window.setTimeout(() => {
        if (active) syncObsMode();
      }, delay);
    }
    if (!chat) return;

    obsObserver = new MutationObserver((records) => {
      if (!active) return;
      if (!obsScroller || !obsScroller.isConnected) {
        scheduleObsSync(120);
        return;
      }
      for (const record of records) {
        if (obsScroller.contains(record.target)) continue;
        scheduleObsSync();
        return;
      }
    });
    obsObserver.observe(chat, { childList: true, subtree: true });
  }

  function stopObsSync() {
    if (obsObserver) {
      obsObserver.disconnect();
      obsObserver = null;
    }
    if (obsTimer) {
      window.clearTimeout(obsTimer);
      obsTimer = 0;
    }
    obsScroller = null;
    setObsScroller(null);
  }

  // -------------------------------------------------------------- geometry

  function computeGeometry() {
    const vw = Math.max(320, window.innerWidth);
    const vh = Math.max(240, window.innerHeight);
    const saved = settings.panel;

    let w = saved ? saved.w : 360;
    let h = saved ? saved.h * vh : Math.min(vh * 0.82, 760);

    w = clamp(w, MIN_W, Math.max(MIN_W, Math.min(720, vw - EDGE * 2)));
    h = clamp(h, MIN_H, Math.max(MIN_H, vh - EDGE * 2));

    let x = saved ? saved.x * vw : vw - w - 20;
    let y = saved ? saved.y * vh : (vh - h) / 2;

    x = clamp(x, EDGE, Math.max(EDGE, vw - w - EDGE));
    y = clamp(y, EDGE, Math.max(EDGE, vh - h - EDGE));

    return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
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
    if (uiHideTimer) {
      clearTimeout(uiHideTimer);
      uiHideTimer = 0;
    }
    panel.classList.add('fscfk-show-ui');
    if (autoHide) {
      if (uiTimer) clearTimeout(uiTimer);
      uiTimer = window.setTimeout(() => {
        uiTimer = 0;
        panel?.classList.remove('fscfk-show-ui');
      }, 1800);
    }
  }

  function hideUiSoon() {
    if (uiTimer) {
      clearTimeout(uiTimer);
      uiTimer = 0;
    }
    if (uiHideTimer) clearTimeout(uiHideTimer);
    uiHideTimer = window.setTimeout(() => {
      uiHideTimer = 0;
      panel?.classList.remove('fscfk-show-ui');
    }, 500);
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
      geom.x = clamp(start.x + dx, EDGE, Math.max(EDGE, window.innerWidth - geom.w - EDGE));
      geom.y = clamp(start.y + dy, EDGE, Math.max(EDGE, window.innerHeight - geom.h - EDGE));
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

      // Soft snap to the edges.
      if (geom.x <= SNAP) {
        geom.x = EDGE;
      } else if (geom.x + geom.w >= window.innerWidth - SNAP) {
        geom.x = window.innerWidth - geom.w - EDGE;
      }
      geom.y = clamp(geom.y, EDGE, Math.max(EDGE, window.innerHeight - geom.h - EDGE));
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
    const dir = handle.dataset.dir === 'se' ? 'se' : 'sw';
    const start = { ...geom };
    const startX = event.clientX;
    const startY = event.clientY;

    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      /* noop */
    }
    markDragging(true);

    const onMove = (moveEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      const right = start.x + start.w;

      if (dir === 'se') {
        const maxW = Math.max(MIN_W, window.innerWidth - start.x - EDGE);
        geom.w = Math.round(clamp(start.w + dx, MIN_W, maxW));
      } else {
        const maxW = Math.max(MIN_W, right - EDGE);
        const width = clamp(start.w - dx, MIN_W, maxW);
        geom.w = Math.round(width);
        geom.x = Math.round(right - width);
      }

      geom.h = Math.round(
        clamp(start.h + dy, MIN_H, Math.max(MIN_H, window.innerHeight - start.y - EDGE))
      );
      scheduleGeometry();
    };

    const onEnd = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onEnd);
      handle.removeEventListener('pointercancel', onEnd);
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
      activate(true);
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
      activate(true);
      return;
    }
    assertDataChat();
    panel.hidden = false;
    visible = true;
    geom = computeGeometry();
    applyGeometryNow();
    applyAppearance();
    startObsSync();
    refreshChatLayout();
    hidePill();
    showUi(true);
  }

  // ------------------------------------------------------------------- pill

  function createPill() {
    const button = make('button', 'fscfk-pill', { type: 'button' });
    button.id = 'fscfk-pill';
    button.setAttribute('aria-label', 'Open chat panel');
    button.appendChild(makeIcon('chat', 17));

    const label = make('span', 'fscfk-pill-label');
    label.textContent = 'Chat';
    button.appendChild(label);

    button.addEventListener('click', (event) => {
      event.stopPropagation();
      if (active) openPanel();
      else activate(true);
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
      activate(true);
    }
  }

  // ---------------------------------------------------------------- toast

  function showToast(message) {
    if (!fsEl) return;
    const existing = fsEl.querySelector('.fscfk-toast');
    if (existing) existing.remove();

    const node = make('div', 'fscfk-toast');
    node.textContent = message;
    fsEl.appendChild(node);
    window.setTimeout(() => node.remove(), 3400);
  }

  // -------------------------------------------------------------- lifecycle

  function onWindowResize() {
    if (!active || !geom) return;
    geom.w = Math.min(geom.w, window.innerWidth - EDGE * 2);
    geom.h = Math.min(geom.h, window.innerHeight - EDGE * 2);
    geom.x = clamp(geom.x, EDGE, Math.max(EDGE, window.innerWidth - geom.w - EDGE));
    geom.y = clamp(geom.y, EDGE, Math.max(EDGE, window.innerHeight - geom.h - EDGE));
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
      if (previous.obsMode !== settings.obsMode) {
        if (settings.obsMode) startObsSync();
        else {
          stopObsSync();
          clearObsMode();
        }
      }
      if (previous.blur !== settings.blur) {
        applyAppearance();
      }
      if (previous.shadow !== settings.shadow) {
        applyAppearance();
      }
      if (
        previous.shadow !== settings.shadow ||
        previous.obsMode !== settings.obsMode ||
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
