// ==UserScript==
// @name         GTH-HUD — Railway Alerts (Single Line + Slide Down)
// @namespace    zulu-lab.gth-hud
// @version      2.0.0
// @description  Single-line top bar. Alert appears next to GTH-HUD, lasts 6s, then slides down and disappears. Dropdown shows last 10.
// @author       zulu-lab
// @match        https://www.torn.com/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @connect      torn-xanax-sniper-production.up.railway.app
// @downloadURL  https://raw.githubusercontent.com/zulu-lab/GTH_HUD/main/dist/gth-hud.user.js
// @updateURL    https://raw.githubusercontent.com/zulu-lab/GTH_HUD/main/dist/gth-hud.user.js
// ==/UserScript==

(() => {
  "use strict";

  const RAILWAY_BASE = "https://torn-xanax-sniper-production.up.railway.app";
  const ENDPOINT = "/hud/recent";
  const LS_KEY = "gth_hud_singleline_v1";

  const POLL_MS = 1000;
  const LIVE_MS = 6000;           // durata max avviso
  const ANIM_MS = 240;            // animazione morbida
  const MAX_HISTORY = 10;

  const st = Object.assign({ token: "" }, safeParse(localStorage.getItem(LS_KEY)));
  const history = [];
  const seen = new Map();

  let pollTimer = null;
  let hideTimer = null;
  let currentSig = null;

  function safeParse(s) { try { return JSON.parse(s || "{}"); } catch { return {}; } }
  function save() { localStorage.setItem(LS_KEY, JSON.stringify(st)); }

  function fmtMoney(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return "—";
    return "$" + Math.round(x).toLocaleString();
  }
  function fmtTime(ts) {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return "";
    return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}:${String(d.getSeconds()).padStart(2,"0")}`;
  }
  function openNewTab(url) {
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function ensureUI() {
    if (document.getElementById("gth_newsbar")) return;

    const bar = document.createElement("div");
    bar.id = "gth_newsbar";
    bar.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0;
      z-index: 9999999;
      background: rgba(0,0,0,.92);
      color: #fff;
      font: 13px/1.25 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;
      border-bottom: 1px solid rgba(255,255,255,.12);
      padding: 6px 10px;
    `;

    bar.innerHTML = `
      <div style="display:flex; align-items:center; gap:10px;">
        <div style="font-weight:900; letter-spacing:.2px; white-space:nowrap;">GTH-HUD</div>

        <!-- ALERT INLINE (single line) -->
        <div id="gth_alert_slot" style="flex:1; min-width:0; display:flex; align-items:center;">
          <div id="gth_alert" style="
            display:none;
            align-items:center;
            gap:10px;
            min-width:0;
            padding: 4px 8px;
            border: 1px solid rgba(255,255,255,.12);
            border-radius: 999px;
            background: rgba(255,255,255,.05);
            white-space:nowrap;
            overflow:hidden;
            text-overflow:ellipsis;
            transform: translateY(0px);
            opacity: 1;
            transition: transform ${ANIM_MS}ms ease, opacity ${ANIM_MS}ms ease;
          ">
            <span id="gth_badge" style="font-weight:900; flex:0 0 auto;">DEAL</span>
            <span id="gth_text" style="min-width:0; overflow:hidden; text-overflow:ellipsis;"></span>
            <a id="gth_btn_market" href="#" style="
              flex:0 0 auto;
              color:#fff; text-decoration:none;
              border:1px solid rgba(255,255,255,.18);
              border-radius:999px;
              padding:3px 10px;
              font-weight:900;
            ">Market</a>
            <a id="gth_btn_attack" href="#" style="
              display:none;
              flex:0 0 auto;
              color:#fff; text-decoration:none;
              border:1px solid rgba(255,255,255,.18);
              border-radius:999px;
              padding:3px 10px;
              font-weight:900;
            ">Attack</a>
          </div>
        </div>

        <div id="gth_status" style="opacity:.85; white-space:nowrap;">BOOT</div>

        <button id="gth_btn_dd" style="
          background: transparent; color:#fff; border:1px solid rgba(255,255,255,.18);
          border-radius: 999px; padding: 6px 10px; cursor:pointer; font-weight:900;
          white-space:nowrap;
        ">⏷ <span id="gth_hist_count">0</span></button>

        <button id="gth_btn_cfg" title="Config" style="
          background: transparent; color:#fff; border:1px solid rgba(255,255,255,.18);
          border-radius: 999px; padding: 6px 10px; cursor:pointer; font-weight:900;
        ">⚙</button>
      </div>

      <div id="gth_dropdown" style="
        display:none;
        margin-top: 8px;
        background: rgba(0,0,0,.96);
        border: 1px solid rgba(255,255,255,.12);
        border-radius: 12px;
        padding: 10px;
        max-width: 1100px;
      ">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <div style="font-weight:900;">Ultimi 10 eventi</div>
          <button id="gth_btn_close" style="
            background: transparent; color:#fff; border:1px solid rgba(255,255,255,.18);
            border-radius: 999px; padding: 6px 10px; cursor:pointer; font-weight:900;
          ">Chiudi</button>
        </div>
        <div id="gth_hist_list" style="display:flex; flex-direction:column; gap:8px;"></div>
      </div>
    `;

    document.documentElement.appendChild(bar);

    // spacer per non coprire UI Torn
    const pad = document.createElement("div");
    pad.id = "gth_newsbar_pad";
    pad.style.cssText = "height: 50px;";
    document.body.prepend(pad);

    // dropdown
    const dd = document.getElementById("gth_dropdown");
    document.getElementById("gth_btn_dd").onclick = () => {
      dd.style.display = dd.style.display === "none" ? "block" : "none";
      renderHistory();
    };
    document.getElementById("gth_btn_close").onclick = () => { dd.style.display = "none"; };

    // config
    document.getElementById("gth_btn_cfg").onclick = () => {
      const token = prompt("Inserisci HUD_TOKEN (Railway):", st.token || "");
      if (token != null) {
        st.token = token.trim();
        save();
        restartPolling();
      }
    };

    // buttons open new tab
    document.getElementById("gth_btn_market").onclick = (ev) => {
      ev.preventDefault();
      const url = ev.currentTarget.getAttribute("data-url");
      if (url) openNewTab(url);
    };
    document.getElementById("gth_btn_attack").onclick = (ev) => {
      ev.preventDefault();
      const url = ev.currentTarget.getAttribute("data-url");
      if (url) openNewTab(url);
    };
  }

  function setStatus(t) {
    const el = document.getElementById("gth_status");
    if (el) el.textContent = t;
  }

  function renderHistory() {
    const list = document.getElementById("gth_hist_list");
    if (!list) return;
    list.innerHTML = "";

    if (!history.length) {
      const d = document.createElement("div");
      d.style.opacity = ".7";
      d.textContent = "Nessun evento ancora.";
      list.appendChild(d);
      return;
    }

    for (const p of history.slice(0, MAX_HISTORY)) {
      const row = document.createElement("div");
      row.style.cssText = `
        display:flex; align-items:center; gap:10px;
        padding: 8px 10px;
        border: 1px solid rgba(255,255,255,.10);
        border-radius: 12px;
        background: rgba(255,255,255,.04);
        overflow:hidden;
      `;

      const left = document.createElement("div");
      left.style.cssText = "white-space:nowrap; font-weight:900;";
      left.textContent = (p.kind === "bigtx" ? "BIG TX" : "DEAL");

      const mid = document.createElement("div");
      mid.style.cssText = "flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;";
      mid.textContent =
        `${fmtTime(p.ts)} • ${p.emoji || ""} ${p.itemName || ("Item " + p.itemId)} • ${fmtMoney(p.price)} x${p.amount} ` +
        `(Tot ${fmtMoney(p.total)}) • ${p.market}:${p.event}`;

      const btns = document.createElement("div");
      btns.style.cssText = "display:flex; gap:8px; align-items:center;";

      const mkBtn = (label, url) => {
        const a = document.createElement("a");
        a.href = url || "#";
        a.textContent = label;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.style.cssText = `
          color:#fff; text-decoration:none;
          border:1px solid rgba(255,255,255,.18);
          border-radius:999px; padding:4px 10px; font-weight:900;
        `;
        a.onclick = (ev) => { ev.preventDefault(); if (url) openNewTab(url); };
        return a;
      };

      btns.appendChild(mkBtn("Market", p.marketUrl));
      if (p.attackUrl) btns.appendChild(mkBtn("Attack", p.attackUrl));

      row.appendChild(left);
      row.appendChild(mid);
      row.appendChild(btns);
      list.appendChild(row);
    }
  }

  function pushHistory(payload) {
    history.unshift(payload);
    while (history.length > MAX_HISTORY) history.pop();
    const hc = document.getElementById("gth_hist_count");
    if (hc) hc.textContent = String(history.length);
  }

  function showAlert(payload) {
    // single-line: sostituisce sempre l’avviso corrente (niente code visive)
    const slot = document.getElementById("gth_alert");
    const badge = document.getElementById("gth_badge");
    const text = document.getElementById("gth_text");
    const btnM = document.getElementById("gth_btn_market");
    const btnA = document.getElementById("gth_btn_attack");

    if (!slot || !badge || !text || !btnM || !btnA) return;

    // reset anim (evita “scatti” quando rimpiazzi)
    slot.style.transition = "none";
    slot.style.transform = "translateY(0px)";
    slot.style.opacity = "1";
    slot.style.display = "inline-flex";
    // force reflow
    void slot.offsetHeight;
    slot.style.transition = `transform ${ANIM_MS}ms ease, opacity ${ANIM_MS}ms ease`;

    badge.textContent = (payload.kind === "bigtx" ? "BIG TX" : "DEAL");
    text.textContent =
      `${payload.emoji || ""} ${payload.itemName || ("Item " + payload.itemId)} • ` +
      `${fmtMoney(payload.price)} x${payload.amount} (Tot ${fmtMoney(payload.total)})`;

    btnM.setAttribute("data-url", payload.marketUrl || "");
    btnA.setAttribute("data-url", payload.attackUrl || "");

    if (payload.attackUrl) btnA.style.display = "inline-block";
    else btnA.style.display = "none";

    // timer hide (restarting)
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      // slide down + fade
      slot.style.transform = "translateY(10px)";
      slot.style.opacity = "0";
      // dopo animazione: nascondi
      setTimeout(() => {
        slot.style.display = "none";
      }, ANIM_MS + 30);
    }, LIVE_MS);
  }

  function gmGetJSON(url) {
    return new Promise((resolve) => {
      GM_xmlhttpRequest({
        method: "GET",
        url,
        timeout: 15000,
        onload: (resp) => {
          try {
            const j = JSON.parse(resp.responseText || "{}");
            resolve({ ok: resp.status >= 200 && resp.status < 300, status: resp.status, json: j });
          } catch (e) {
            resolve({ ok: false, status: resp.status || 0, json: null, error: String(e) });
          }
        },
        onerror: (err) => resolve({ ok: false, status: 0, json: null, error: String(err) }),
        ontimeout: () => resolve({ ok: false, status: 0, json: null, error: "timeout" })
      });
    });
  }

  function shouldAccept(payload) {
    if (!payload || !payload.kind || !payload.ts) return false;

    const sig = `${payload.kind}:${payload.market}:${payload.event}:${payload.itemId}:${payload.price}:${payload.amount}`;
    const now = Date.now();
    const last = seen.get(sig);
    if (last && (now - last) < 30000) return false;
    seen.set(sig, now);

    if (seen.size > 5000) for (const [k, v] of seen) if (now - v > 60000) seen.delete(k);
    return true;
  }

  async function pollOnce() {
    if (!st.token) { setStatus("NO TOKEN"); return; }

    const url = `${RAILWAY_BASE}${ENDPOINT}?token=${encodeURIComponent(st.token)}`;
    const res = await gmGetJSON(url);

    if (!res.ok) {
      if (res.status === 401) setStatus("401 TOKEN?");
      else if (res.status === 0) setStatus("HTTP0 CONNECT?");
      else setStatus(`ERR ${res.status}`);
      return;
    }

    const buffer = Array.isArray(res.json?.buffer) ? res.json.buffer : [];
    setStatus(`OK buf:${buffer.length}`);

    // aggiungi nuovi eventi (dal più vecchio al più nuovo) -> se ne arrivano tanti insieme
    // la barra MOSTRA SOLO L’ULTIMO (single line), ma lo storico li prende tutti.
    let newestToShow = null;

    for (const p of buffer.slice().reverse()) {
      if (shouldAccept(p)) {
        pushHistory(p);
        newestToShow = p;
      }
    }

    // mostra solo l'ultimo arrivato in questo ciclo
    if (newestToShow) {
      const sig = `${newestToShow.kind}:${newestToShow.ts}:${newestToShow.itemId}:${newestToShow.price}:${newestToShow.amount}`;
      if (sig !== currentSig) {
        currentSig = sig;
        showAlert(newestToShow);
      }
    }
  }

  function restartPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => pollOnce(), POLL_MS);
    pollOnce();
  }

  function init() {
    ensureUI();
    restartPolling();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
