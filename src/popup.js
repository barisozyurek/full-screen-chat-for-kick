'use strict';

const STORE_KEY = 'fscfk.settings';
const MAX_BLUR = 100;
const MAX_CORNER_RADIUS = 24;

const DEFAULTS = {
  enabled: true,
  autoOpen: true,
  shadow: true,
  blur: 14,
  cornerRadius: 0,
  pinned: false,
  panel: null,
};

const el = {
  enabled: document.getElementById('enabled'),
  autoOpen: document.getElementById('autoOpen'),
  shadow: document.getElementById('shadow'),
  blur: document.getElementById('blur'),
  blurOut: document.getElementById('blurOut'),
  radius: document.getElementById('radius'),
  radiusOut: document.getElementById('radiusOut'),
  masterSub: document.getElementById('masterSub'),
  version: document.getElementById('version'),
  reset: document.getElementById('reset'),
};

let state = { ...DEFAULTS };
let resetTimer = 0;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

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

  const blur = Number(next.blur);
  next.blur = Number.isFinite(blur) ? clamp(Math.round(blur), 0, MAX_BLUR) : DEFAULTS.blur;

  const radius = Number(next.cornerRadius);
  next.cornerRadius = Number.isFinite(radius)
    ? clamp(Math.round(radius), 0, MAX_CORNER_RADIUS)
    : DEFAULTS.cornerRadius;

  next.panel = next.panel && typeof next.panel === 'object' ? next.panel : null;
  return next;
}

function paintRange(input, ratio) {
  input.style.setProperty('--fill', `${clamp(ratio, 0, 1) * 100}%`);
}

function renderVersion() {
  try {
    el.version.textContent = chrome.runtime.getManifest().version || '';
  } catch {
    el.version.textContent = '';
  }
}

function render() {
  el.enabled.checked = state.enabled;
  el.autoOpen.checked = state.autoOpen;
  el.shadow.checked = state.shadow;

  el.blur.value = String(state.blur);
  el.blurOut.textContent = String(state.blur);
  paintRange(el.blur, state.blur / MAX_BLUR);

  el.radius.value = String(state.cornerRadius);
  el.radiusOut.textContent = String(state.cornerRadius);
  paintRange(el.radius, state.cornerRadius / MAX_CORNER_RADIUS);

  el.masterSub.textContent = state.enabled
    ? 'Runs automatically in fullscreen'
    : 'Extension disabled';

  document.body.classList.toggle('is-off', !state.enabled);
}

async function read() {
  const stored = await chrome.storage.local.get(STORE_KEY);
  return normalize(stored?.[STORE_KEY]);
}

async function patch(partial) {
  const current = await read();
  state = normalize({ ...current, ...partial });
  await chrome.storage.local.set({ [STORE_KEY]: state });
  render();
  return state;
}

async function notifyActiveTab(message) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id !== undefined) {
      await chrome.tabs.sendMessage(tab.id, message);
    }
  } catch {
    /* The active tab is not Kick or has no content script. */
  }
}

function bind() {
  el.enabled.addEventListener('change', () => {
    patch({ enabled: el.enabled.checked });
  });

  el.autoOpen.addEventListener('change', () => {
    patch({ autoOpen: el.autoOpen.checked });
  });

  el.shadow.addEventListener('change', () => {
    patch({ shadow: el.shadow.checked });
  });

  el.blur.addEventListener('input', () => {
    const value = Number(el.blur.value);
    el.blurOut.textContent = String(value);
    paintRange(el.blur, value / MAX_BLUR);
  });

  el.blur.addEventListener('change', () => {
    patch({ blur: Number(el.blur.value) });
  });

  el.radius.addEventListener('input', () => {
    const value = Number(el.radius.value);
    el.radiusOut.textContent = String(value);
    paintRange(el.radius, value / MAX_CORNER_RADIUS);
  });

  el.radius.addEventListener('change', () => {
    patch({ cornerRadius: Number(el.radius.value) });
  });

  el.reset.addEventListener('click', async () => {
    await patch({ ...DEFAULTS, panel: null });
    await notifyActiveTab({ type: 'fscfk:reset-geometry' });

    el.reset.textContent = 'Defaults restored';
    el.reset.classList.add('is-done');
    window.clearTimeout(resetTimer);
    resetTimer = window.setTimeout(() => {
      el.reset.textContent = 'Restore defaults';
      el.reset.classList.remove('is-done');
    }, 1400);
  });
}

async function init() {
  try {
    state = await read();
  } catch {
    state = { ...DEFAULTS };
  }
  renderVersion();
  render();
  bind();
}

init();
