// ==UserScript==
// @name         GTH Quick Bar Call/Help
// @namespace    zulu.torn.quickbar.hybridstable
// @version      1.0.1
// @description  Profile anchored quick bar + attack floating quick bar with detached global settings panel
// @match        https://www.torn.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @connect      api.torn.com
// @connect      www.lol-manager.com
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  const APP_ID = 'zqb-hybrid';
  const HOLD_MS = 2000;
  const SCRIPT_VERSION = '1.0.0';
  const PREDICTION_VALIDITY_DAYS = 5;

  const FAIL = 0;
  const SUCCESS = 1;
  const TOO_WEAK = 2;
  const TOO_STRONG = 3;
  const MODEL_ERROR = 4;
  const HOF = 5;
  const FFATTACKS = 6;

  const StorageKey = {
    PrimaryAPIKey: 'tdup.battleStatsPredictor.PrimaryAPIKey',
    IsPrimaryAPIKeyValid: 'tdup.battleStatsPredictor.IsPrimaryAPIKeyValid',
    PlayerId: 'tdup.battleStatsPredictor.PlayerId',
    BSPPrediction: 'tdup.battleStatsPredictor.cache.prediction.',
    ChatHoldEnabled: 'zqb.chat.hold.enabled.v1',
    LockAttackPosition: 'zqb.attack.lock.v1',
    AttackPos: 'zqb.attack.position.v1'
  };

  const state = {
    lastHref: location.href,
    armedText: '',
    armedType: '',
    pendingPrediction: new Map(),
    chatHoldMap: new WeakMap(),
    drag: {
      active: false,
      startX: 0,
      startY: 0,
      baseX: 0,
      baseY: 0
    },
    openSettingsFor: null
  };

  function gmRequest(opts) {
    const fn =
      (typeof GM_xmlhttpRequest === 'function' && GM_xmlhttpRequest) ||
      (typeof GM !== 'undefined' && GM && typeof GM.xmlHttpRequest === 'function' && GM.xmlHttpRequest.bind(GM));

    if (!fn) throw new Error('GM xmlHttpRequest not available');
    return fn(opts);
  }

  function q(v) {
    return String(v || '').replace(/\s+/g, ' ').trim();
  }

  function jsonParse(v) {
    try {
      return JSON.parse(v);
    } catch {
      return null;
    }
  }

  function getStorage(key) {
    return localStorage.getItem(key);
  }

  function setStorage(key, value) {
    try {
      localStorage.setItem(key, String(value));
    } catch {}
  }

  function getBool(key, def = false) {
    const v = getStorage(key);
    if (v === 'true') return true;
    if (v === 'false') return false;
    return def;
  }

  function setBool(key, value) {
    setStorage(key, value ? 'true' : 'false');
  }

  function getObj(key, fallback) {
    const raw = getStorage(key);
    const obj = raw ? jsonParse(raw) : null;
    return obj && typeof obj === 'object' ? obj : fallback;
  }

  function setObj(key, value) {
    setStorage(key, JSON.stringify(value));
  }

  function isProfilePage() {
    const href = location.href;
    return /profiles\.php/i.test(href) || /pda\.php\?sid=profile/i.test(href);
  }

  function isAttackPage() {
    return /sid=attack/i.test(location.href);
  }

  function getPageType() {
    if (isProfilePage()) return 'profile';
    if (isAttackPage()) return 'attack';
    return null;
  }

  function getTargetId() {
    try {
      const u = new URL(location.href);
      return (
        u.searchParams.get('XID') ||
        u.searchParams.get('user2ID') ||
        ''
      ).trim();
    } catch {
      return '';
    }
  }

  function getProfileName() {
    const title = q(document.title);
    const m = title.match(/^(.+?)'s Profile/i);
    if (m?.[1]) return m[1].trim();

    const h = document.querySelector('h4, h3, h2');
    if (h) {
      const txt = q(h.textContent).replace(/'s Profile/i, '').trim();
      if (txt) return txt;
    }

    return '';
  }

  function findProfileAnchor() {
    return document.querySelector('.content-title')
      || document.querySelector('#sidebar')
      || document.querySelector('#mainContainer h4')
      || document.querySelector('h4')
      || document.querySelector('h3');
  }

  function findAttackAnchor() {
    const arr = Array.from(document.querySelectorAll('h4,div,span'));
    return arr.find(el => q(el.textContent) === 'Attacking') || null;
  }

  function getStatusEl() {
    return document.querySelector('#' + APP_ID + ' .zqb-status');
  }

  function setStatus(text, good = true) {
    const el = getStatusEl();
    if (!el) return;
    el.textContent = text || '';
    el.style.color = good ? '#9fe0aa' : '#ff9b9b';
  }

  function clearStatusSoon() {
    setTimeout(() => {
      const el = getStatusEl();
      if (!el) return;
      if (el.textContent === 'Armed C' || el.textContent === 'Armed H' || el.textContent === 'Pasted' || el.textContent === 'Saved') {
        el.textContent = '';
        renderArmedState();
      }
    }, 1200);
  }

  function renderArmedState() {
    const buttons = document.querySelectorAll('#' + APP_ID + ' .zqb-btn');
    buttons.forEach(b => b.classList.remove('zqb-armed'));

    if (state.armedType) {
      const active = document.querySelector(`#${APP_ID} .zqb-btn[data-type="${state.armedType}"]`);
      if (active) active.classList.add('zqb-armed');
    }

    const status = getStatusEl();
    if (status && !status.textContent) {
      status.textContent = state.armedText ? ('Armed ' + state.armedType) : 'Ready';
    }
  }

  function formatBattleStats(number) {
    const n = Number(number);
    if (!isFinite(n)) return '';
    const localized = n.toLocaleString('en-US');
    const parts = localized.split(',');
    if (parts.length < 1) return '';
    let out = parts[0];
    if (n < 1000) return String(Math.round(n));
    if (parseInt(out, 10) < 10 && parts[1] && parseInt(parts[1][0], 10) !== 0) {
      out += '.' + parts[1][0];
    }
    switch (parts.length) {
      case 2: out += 'k'; break;
      case 3: out += 'm'; break;
      case 4: out += 'b'; break;
      case 5: out += 't'; break;
      case 6: out += 'q'; break;
    }
    return out;
  }

  function getPredictionFromCache(playerId) {
    const raw = getStorage(StorageKey.BSPPrediction + playerId);
    if (!raw || raw === '[object Object]') return undefined;
    return jsonParse(raw);
  }

  function setPredictionInCache(playerId, prediction) {
    if (!prediction) return;
    if (prediction.Result === FAIL || prediction.Result === MODEL_ERROR) return;
    setStorage(StorageKey.BSPPrediction + playerId, JSON.stringify(prediction));
  }

  function isPredictionValid(prediction) {
    if (!prediction) return false;
    let predictionDate = prediction.PredictionDate ? new Date(prediction.PredictionDate) : null;
    if (prediction.DateFetched) predictionDate = new Date(prediction.DateFetched);
    if (!predictionDate || isNaN(predictionDate.getTime())) return false;

    const expirationDate = new Date();
    expirationDate.setDate(expirationDate.getDate() - PREDICTION_VALIDITY_DAYS);
    return predictionDate >= expirationDate;
  }

  function getPredictionTBS(prediction) {
    if (!prediction) return '';
    if (prediction.Result === FAIL || prediction.Result === MODEL_ERROR) return '';

    if (
      prediction.Result === TOO_WEAK ||
      prediction.Result === TOO_STRONG ||
      prediction.Result === HOF ||
      prediction.Result === FFATTACKS ||
      prediction.Result === SUCCESS
    ) {
      const tbsNum = parseInt(String(prediction.TBS || '').replace(/,/g, ''), 10);
      if (isFinite(tbsNum) && tbsNum > 0) return formatBattleStats(tbsNum);
    }

    return '';
  }

  function getBSPServer() {
    return 'http://www.lol-manager.com/api';
  }

  function canQueryAnyAPI() {
    return document.visibilityState === 'visible' && document.hasFocus();
  }

  function verifyPrimaryAPIKey() {
    return new Promise((resolve) => {
      if (!canQueryAnyAPI()) return resolve({ ok: false, reason: 'Page not focused' });

      const key = q(getStorage(StorageKey.PrimaryAPIKey));
      if (!key) return resolve({ ok: false, reason: 'Missing API key' });

      const url =
        'https://api.torn.com/v2/user/personalstats,profile?key=' +
        encodeURIComponent(key) +
        '&cat=all&comment=BSPAuth';

      gmRequest({
        method: 'GET',
        url,
        onload: (r) => {
          const j = jsonParse(r.responseText);
          if (!j) return resolve({ ok: false, reason: "Couldn't check (unexpected response)" });
          if (j.error && j.error.code > 0) return resolve({ ok: false, reason: j.error.error });
          if (j.status !== undefined && !j.status) return resolve({ ok: false, reason: 'unknown issue' });

          if (
            !j.personalstats ||
            !j.personalstats.attacking ||
            !j.personalstats.attacking.attacks ||
            j.personalstats.attacking.attacks.won === undefined
          ) {
            return resolve({ ok: false, reason: 'Key missing required permissions' });
          }

          setStorage(StorageKey.PlayerId, j.player_id);
          setBool(StorageKey.IsPrimaryAPIKeyValid, true);
          resolve({ ok: true, reason: 'API key verified' });
        },
        onabort: () => resolve({ ok: false, reason: "Couldn't check (aborted)" }),
        onerror: () => resolve({ ok: false, reason: "Couldn't check (error)" }),
        ontimeout: () => resolve({ ok: false, reason: "Couldn't check (timeout)" })
      });
    });
  }

  async function ensureValidatedKey() {
    const key = q(getStorage(StorageKey.PrimaryAPIKey));
    if (!key) return { ok: false, reason: 'Missing key' };

    const valid = getBool(StorageKey.IsPrimaryAPIKeyValid, false);
    if (valid) return { ok: true, reason: 'Already valid' };

    return await verifyPrimaryAPIKey();
  }

  function fetchScoreAndTBS(targetId) {
    return new Promise((resolve) => {
      if (!canQueryAnyAPI()) return resolve(undefined);

      const key = q(getStorage(StorageKey.PrimaryAPIKey));
      if (!key) return resolve(undefined);

      const url = `${getBSPServer()}/battlestats/${encodeURIComponent(key)}/${encodeURIComponent(targetId)}/${SCRIPT_VERSION}`;

      gmRequest({
        method: 'GET',
        url,
        headers: { 'Content-Type': 'application/json' },
        onload: (response) => {
          try {
            resolve(JSON.parse(response.responseText));
          } catch {
            resolve(undefined);
          }
        },
        onerror: () => resolve(undefined),
        onabort: () => resolve(undefined),
        ontimeout: () => resolve(undefined)
      });
    });
  }

  async function getPredictionForPlayer(targetId) {
    if (!targetId) return undefined;

    const cached = getPredictionFromCache(targetId);
    if (cached && isPredictionValid(cached)) return cached;

    if (state.pendingPrediction.has(targetId)) {
      return state.pendingPrediction.get(targetId);
    }

    const p = (async () => {
      const fresh = await fetchScoreAndTBS(targetId);
      if (fresh) {
        fresh.DateFetched = new Date();
        setPredictionInCache(targetId, fresh);
      }
      return fresh;
    })();

    state.pendingPrediction.set(targetId, p);

    try {
      return await p;
    } finally {
      state.pendingPrediction.delete(targetId);
    }
  }

  async function prepareC() {
    const name = getProfileName();
    if (!name) {
      state.armedText = '';
      state.armedType = '';
      setStatus('No name', false);
      renderArmedState();
      return;
    }

    state.armedText = '! ' + name + ' in 5';
    state.armedType = 'C';
    closeGlobalSettings();
    setStatus('Armed C', true);
    renderArmedState();
    clearStatusSoon();
  }

  async function prepareH() {
    const id = getTargetId();
    if (!id) {
      state.armedText = '';
      state.armedType = '';
      setStatus('No target', false);
      renderArmedState();
      return;
    }

    const key = q(getStorage(StorageKey.PrimaryAPIKey));
    if (!key) {
      state.armedText = '! Set BSP API key';
      state.armedType = 'H';
      setStatus('Missing key', false);
      renderArmedState();
      return;
    }

    closeGlobalSettings();
    setStatus('Checking key...', true);
    const validation = await ensureValidatedKey();
    if (!validation.ok) {
      state.armedText = '! Validate BSP API key';
      state.armedType = 'H';
      setStatus(validation.reason || 'Validation failed', false);
      renderArmedState();
      return;
    }

    setStatus('Fetching...', true);

    const prediction = await getPredictionForPlayer(id);
    const bsp = getPredictionTBS(prediction);

    let msg = '! Help me https://www.torn.com/page.php?sid=attack&user2ID=' + id;
    if (bsp) msg += ' BSP:' + bsp;

    state.armedText = msg;
    state.armedType = 'H';
    setStatus('Armed H', true);
    renderArmedState();
    clearStatusSoon();
  }

  async function copyText(text) {
    if (!text) return false;

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {}

    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', 'readonly');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.top = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, ta.value.length);

    let ok = false;
    try { ok = document.execCommand('copy'); } catch {}
    ta.remove();
    return !!ok;
  }

  function dispatchInputEvents(el) {
    try {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: ' ' }));
    } catch {}
  }

  function insertIntoElement(el, text) {
    if (!el || !text) return false;

    try { el.focus({ preventScroll: true }); } catch {}

    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      try {
        const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value')?.set;
        if (setter) setter.call(el, text);
        else el.value = text;
        dispatchInputEvents(el);
        return true;
      } catch {}
    }

    if (el.isContentEditable) {
      try {
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);

        const ok = document.execCommand('insertText', false, text);
        if (!ok) el.textContent = text;
        dispatchInputEvents(el);
        return true;
      } catch {
        try {
          el.textContent = text;
          dispatchInputEvents(el);
          return true;
        } catch {}
      }
    }

    return false;
  }

  async function insertArmedIntoChat(targetEl) {
    if (!state.armedText) {
      setStatus('No message', false);
      return false;
    }

    const inserted = insertIntoElement(targetEl, state.armedText);
    const copied = await copyText(state.armedText);

    if (inserted) setStatus('Pasted', true);
    else setStatus(copied ? 'Copied only' : 'Paste failed', copied);

    state.armedText = '';
    state.armedType = '';
    renderArmedState();
    clearStatusSoon();

    return inserted;
  }

  function isWritableChatElement(el) {
    if (!el || !(el instanceof Element)) return false;

    if (el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && el.type === 'text')) {
      if (el.disabled || el.readOnly) return false;
      return true;
    }

    if (el.isContentEditable) return true;
    return false;
  }

  function attachHoldToChatElement(el) {
    if (!isWritableChatElement(el)) return;
    if (state.chatHoldMap.has(el)) return;

    const data = { timer: null, active: false, moved: false };

    const clear = () => {
      if (data.timer) {
        clearTimeout(data.timer);
        data.timer = null;
      }
      data.active = false;
      data.moved = false;
    };

    const start = () => {
      if (!state.armedText) return;
      data.active = true;
      data.moved = false;
      data.timer = setTimeout(async () => {
        if (!data.moved && data.active) await insertArmedIntoChat(el);
      }, HOLD_MS);
    };

    const move = () => {
      data.moved = true;
      if (data.timer) {
        clearTimeout(data.timer);
        data.timer = null;
      }
    };

    const end = () => clear();

    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: true });
    el.addEventListener('touchend', end, { passive: true });
    el.addEventListener('touchcancel', end, { passive: true });

    el.addEventListener('mousedown', start);
    el.addEventListener('mousemove', move);
    el.addEventListener('mouseup', end);
    el.addEventListener('mouseleave', end);

    state.chatHoldMap.set(el, true);
  }

  function scanAndAttachChatHold() {
    if (!getBool(StorageKey.ChatHoldEnabled, true)) return;

    const candidates = [
      ...Array.from(document.querySelectorAll('textarea')),
      ...Array.from(document.querySelectorAll('input[type="text"]')),
      ...Array.from(document.querySelectorAll('[contenteditable="true"]'))
    ];

    for (const el of candidates) {
      attachHoldToChatElement(el);
    }
  }

  function getAttackRoot() {
    return document.getElementById(APP_ID + '-attack-root');
  }

  function getAttackPos() {
    return getObj(StorageKey.AttackPos, { x: 16, y: 150 });
  }

  function setAttackPos(x, y) {
    setObj(StorageKey.AttackPos, { x, y });
  }

  function clampAttackRoot(root, x, y) {
    const rect = root.getBoundingClientRect();
    const maxX = Math.max(4, window.innerWidth - rect.width - 4);
    const maxY = Math.max(4, window.innerHeight - rect.height - 4);
    return {
      x: Math.min(Math.max(4, x), maxX),
      y: Math.min(Math.max(4, y), maxY)
    };
  }

  function applyAttackPosition() {
    const root = getAttackRoot();
    if (!root) return;

    const p = getAttackPos();
    const clamped = clampAttackRoot(root, p.x, p.y);

    root.style.position = 'fixed';
    root.style.left = Math.round(clamped.x) + 'px';
    root.style.top = Math.round(clamped.y) + 'px';

    setAttackPos(clamped.x, clamped.y);
  }

  function captureAttackPosition() {
    const root = getAttackRoot();
    if (!root) return;
    const rect = root.getBoundingClientRect();
    setAttackPos(rect.left, rect.top);
  }

  function enableAttackDrag(handle) {
    const start = (clientX, clientY) => {
      if (getBool(StorageKey.LockAttackPosition, false)) return;
      const root = getAttackRoot();
      if (!root) return;

      captureAttackPosition();
      const p = getAttackPos();

      state.drag.active = true;
      state.drag.startX = clientX;
      state.drag.startY = clientY;
      state.drag.baseX = p.x;
      state.drag.baseY = p.y;
    };

    const move = (clientX, clientY) => {
      if (!state.drag.active) return;
      if (getBool(StorageKey.LockAttackPosition, false)) return;

      const dx = clientX - state.drag.startX;
      const dy = clientY - state.drag.startY;

      setAttackPos(state.drag.baseX + dx, state.drag.baseY + dy);
      applyAttackPosition();
    };

    const end = () => {
      if (!state.drag.active) return;
      state.drag.active = false;
      captureAttackPosition();
    };

    handle.addEventListener('touchstart', (e) => {
      if (getBool(StorageKey.LockAttackPosition, false)) return;
      const t = e.touches[0];
      if (!t) return;
      start(t.clientX, t.clientY);
    }, { passive: true });

    handle.addEventListener('touchmove', (e) => {
      if (getBool(StorageKey.LockAttackPosition, false)) return;
      const t = e.touches[0];
      if (!t) return;
      move(t.clientX, t.clientY);
    }, { passive: true });

    handle.addEventListener('touchend', end, { passive: true });
    handle.addEventListener('touchcancel', end, { passive: true });

    handle.addEventListener('mousedown', (e) => {
      if (getBool(StorageKey.LockAttackPosition, false)) return;
      start(e.clientX, e.clientY);
    });

    window.addEventListener('mousemove', (e) => {
      move(e.clientX, e.clientY);
    });

    window.addEventListener('mouseup', end);
  }

  function getGlobalPanel() {
    return document.getElementById(APP_ID + '-global-panel');
  }

  function closeGlobalSettings() {
    const panel = getGlobalPanel();
    if (panel) panel.remove();
    state.openSettingsFor = null;
  }

  function openGlobalSettings(root, pageType) {
    closeGlobalSettings();
    state.openSettingsFor = root;

    const panel = document.createElement('div');
    panel.id = APP_ID + '-global-panel';
    panel.className = 'zqb-global-panel';
    panel.innerHTML = `
      <div class="zqb-field">
        <label>Primary API key</label>
        <input type="password" class="zqb-api" value="${escapeHtml(q(getStorage(StorageKey.PrimaryAPIKey)))}">
      </div>
      <div class="zqb-field">
        <label><input type="checkbox" class="zqb-holdchat" ${getBool(StorageKey.ChatHoldEnabled, true) ? 'checked' : ''}> long press on chat = paste</label>
      </div>
      ${pageType === 'attack' ? `<div class="zqb-field">
        <label><input type="checkbox" class="zqb-lockattack" ${getBool(StorageKey.LockAttackPosition, false) ? 'checked' : ''}> lock position</label>
      </div>` : ''}
      <button type="button" class="zqb-save">Save</button>
      <div class="zqb-hint">Use the same API key already used by BSP.</div>
    `;

    panel.addEventListener('click', (e) => e.stopPropagation());
    panel.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });

    document.body.appendChild(panel);

    const btn = root.querySelector('.zqb-btn[data-type="SETTINGS"]');
    const btnRect = btn.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const gap = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = btnRect.right + gap;
    let top = btnRect.top;

    if (left + panelRect.width > vw - 4) {
      left = btnRect.left - panelRect.width - gap;
    }
    if (left < 4) {
      left = Math.max(4, Math.min(btnRect.left, vw - panelRect.width - 4));
      top = btnRect.bottom + gap;
    }
    if (top + panelRect.height > vh - 4) {
      top = Math.max(4, vh - panelRect.height - 4);
    }

    panel.style.left = Math.round(left) + 'px';
    panel.style.top = Math.round(top) + 'px';

    const saveBtn = panel.querySelector('.zqb-save');
    if (saveBtn) {
      saveBtn.onclick = () => {
        const api = panel.querySelector('.zqb-api');
        const holdChat = panel.querySelector('.zqb-holdchat');
        const lockAttack = panel.querySelector('.zqb-lockattack');

        const oldKey = q(getStorage(StorageKey.PrimaryAPIKey));
        const newKey = q(api?.value);

        if (newKey !== oldKey) {
          setStorage(StorageKey.PrimaryAPIKey, newKey);
          setBool(StorageKey.IsPrimaryAPIKeyValid, false);
        } else {
          setStorage(StorageKey.PrimaryAPIKey, newKey);
        }

        setBool(StorageKey.ChatHoldEnabled, !!holdChat?.checked);
        if (lockAttack) setBool(StorageKey.LockAttackPosition, !!lockAttack?.checked);

        applyAttackPosition();
        setStatus('Saved', true);
        clearStatusSoon();
        scanAndAttachChatHold();
        closeGlobalSettings();
      };
    }
  }

  function bindButton(btn, type, root, pageType) {
    if (type === 'SETTINGS') {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const panel = getGlobalPanel();
        if (panel && state.openSettingsFor === root) {
          closeGlobalSettings();
        } else {
          openGlobalSettings(root, pageType);
        }
      });
      return;
    }

    btn.addEventListener('click', async () => {
      closeGlobalSettings();
      if (type === 'C') await prepareC();
      if (type === 'H') await prepareH();
    });
  }

  function injectCSS() {
    if (document.getElementById(APP_ID + '-css')) return;

    const s = document.createElement('style');
    s.id = APP_ID + '-css';
    s.textContent = `
#${APP_ID},
#${APP_ID}-attack-root{
font-family:Arial,sans-serif;
z-index:999999;
}
#${APP_ID} .zqb-box{
display:inline-block;
background:rgba(7,10,14,.86);
border:1px solid rgba(255,255,255,.06);
border-radius:6px;
padding:3px;
box-shadow:0 6px 16px rgba(0,0,0,.22);
backdrop-filter:blur(4px);
}
#${APP_ID} .zqb-dragbar{
display:flex;
gap:4px;
padding:0;
touch-action:none;
}
#${APP_ID} .zqb-btn{
width:16px;
height:22px;
border-radius:2px;
display:flex;
align-items:center;
justify-content:center;
font-size:11px;
font-weight:900;
color:#fff;
border:1px solid rgba(255,255,255,.10);
padding:0;
line-height:1;
box-shadow:none;
margin:0;
}
#${APP_ID} .zqb-armed{
outline:1px solid rgba(255,255,255,.22);
}
#${APP_ID} .zqb-c{background:#e09100;color:#111;}
#${APP_ID} .zqb-h{background:#c41724;}
#${APP_ID} .zqb-s{background:#4a5563;}
#${APP_ID} .zqb-status{
margin-top:2px;
font-size:8px;
color:#9fe0aa;
min-height:9px;
}
.zqb-global-panel{
position:fixed;
z-index:2147483647;
width:180px;
padding:6px;
background:#0d0f14f2;
border:1px solid rgba(255,255,255,.08);
border-radius:6px;
font-size:10px;
color:#dce3ea;
box-shadow:0 8px 20px rgba(0,0,0,.35);
font-family:Arial,sans-serif;
}
.zqb-global-panel .zqb-field{
margin-bottom:5px;
}
.zqb-global-panel .zqb-field label{
display:block;
margin-bottom:2px;
font-size:10px;
}
.zqb-global-panel .zqb-field input[type="password"]{
width:100%;
box-sizing:border-box;
background:#05070c;
color:#fff;
border:1px solid rgba(255,255,255,.08);
border-radius:4px;
padding:5px;
font-size:10px;
}
.zqb-global-panel .zqb-field input[type="checkbox"]{
margin-right:5px;
}
.zqb-global-panel .zqb-save{
display:block;
width:100%;
margin-top:4px;
border:0;
border-radius:4px;
padding:6px;
font-size:10px;
font-weight:700;
text-align:center;
background:#2563eb;
color:#fff;
}
.zqb-global-panel .zqb-hint{
margin-top:5px;
font-size:9px;
line-height:1.3;
color:#b8c1cb;
}
`;
    (document.head || document.documentElement).appendChild(s);
  }

  function createButton(txt, cls, type, root, pageType) {
    const b = document.createElement('button');
    b.className = 'zqb-btn ' + cls;
    b.dataset.type = type;
    b.textContent = txt;
    bindButton(b, type, root, pageType);
    return b;
  }

  function buildInnerUI(pageType) {
    const root = document.createElement('div');
    root.id = APP_ID;

    const box = document.createElement('div');
    box.className = 'zqb-box';

    const dragbar = document.createElement('div');
    dragbar.className = 'zqb-dragbar';

    if (pageType === 'profile') {
      dragbar.appendChild(createButton('C', 'zqb-c', 'C', root, pageType));
    }

    dragbar.appendChild(createButton('H', 'zqb-h', 'H', root, pageType));
    dragbar.appendChild(createButton('•', 'zqb-s', 'SETTINGS', root, pageType));

    const status = document.createElement('div');
    status.className = 'zqb-status';
    status.textContent = 'Ready';

    box.appendChild(dragbar);
    box.appendChild(status);
    root.appendChild(box);

    root.addEventListener('click', (e) => e.stopPropagation());
    root.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });

    return root;
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (m) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[m]));
  }

  function mountProfile() {
    if (document.getElementById(APP_ID + '-profile-wrap')) return;
    const anchor = findProfileAnchor();
    if (!anchor) return;

    const wrap = document.createElement('div');
    wrap.id = APP_ID + '-profile-wrap';
    wrap.style.position = 'relative';
    wrap.style.margin = '6px 0';

    const ui = buildInnerUI('profile');
    wrap.appendChild(ui);

    if (anchor.classList && anchor.classList.contains('content-title')) {
      anchor.appendChild(wrap);
    } else {
      anchor.insertAdjacentElement('afterend', wrap);
    }
  }

  function mountAttack() {
    if (document.getElementById(APP_ID + '-attack-root')) return;
    const anchor = findAttackAnchor();
    if (!anchor) return;

    const root = document.createElement('div');
    root.id = APP_ID + '-attack-root';
    root.style.position = 'fixed';
    root.style.zIndex = '999999';

    const ui = buildInnerUI('attack');
    root.appendChild(ui);
    document.body.appendChild(root);

    if (!getStorage(StorageKey.AttackPos)) {
      const rect = anchor.getBoundingClientRect();
      setAttackPos(rect.left, rect.bottom + 4);
    }
    applyAttackPosition();

    const dragbar = root.querySelector('.zqb-dragbar');
    if (dragbar) enableAttackDrag(dragbar);
  }

  function unmountAll() {
    document.getElementById(APP_ID + '-profile-wrap')?.remove();
    document.getElementById(APP_ID + '-attack-root')?.remove();
    closeGlobalSettings();
  }

  function mount() {
    injectCSS();
    const page = getPageType();
    if (!page) {
      unmountAll();
      return;
    }

    if (page === 'profile') {
      document.getElementById(APP_ID + '-attack-root')?.remove();
      mountProfile();
    }

    if (page === 'attack') {
      document.getElementById(APP_ID + '-profile-wrap')?.remove();
      mountAttack();
    }

    renderArmedState();
    scanAndAttachChatHold();
  }

  function wireGlobalClose() {
    document.addEventListener('click', () => closeGlobalSettings());
    document.addEventListener('touchstart', () => closeGlobalSettings(), { passive: true });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeGlobalSettings();
    });
    window.addEventListener('resize', () => closeGlobalSettings());
  }

  function loop() {
    setInterval(() => {
      if (location.href !== state.lastHref) {
        state.lastHref = location.href;
        unmountAll();
      }

      mount();
      applyAttackPosition();
      scanAndAttachChatHold();
    }, 300);
  }

  wireGlobalClose();
  loop();
})();
