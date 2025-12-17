// ==UserScript==
// @name         GTH-HUD – Torn Market & Combat Alerts
// @namespace    zulu.gth.hud
// @version      1.3
// @description  Barra HUD in Torn che mostra DEAL/BIG TX/COMBAT dagli eventi Railway (/hud/recent).
// @match        https://www.torn.com/*
// @run-at       document-end
// @grant        GM_xmlhttpRequest
// @connect      torn-xanax-sniper-production.up.railway.app
// ==/UserScript==

(function () {
  "use strict";

  // ========= CONFIG =========
  const LS_KEY = "gth_hud_cfg_v2";

  // Cambia solo se sposti il server
  const DEFAULT_BASE = "https://torn-xanax-sniper-production.up.railway.app";

  const POLL_MS = 3500;                 // intervallo polling /hud/recent
  const TOP_VIS_MS = 7000;              // 7 secondi visibilità ultimo avviso (prima 6)
  const MAX_LOCAL_AGE_MS = 10 * 60 * 1000; // 10 minuti: oltre vengono nascosti lato HUD

  // ========= STATE =========
  let cfg = loadCfg();
  let polling = false;

  let events = [];          // array eventi "freschi" (max 10 dal server, ripuliti localmente)
  let latest = null;        // ultimo evento mostrato in top bar
  let latestId = null;      // firma per capire se c'è un evento nuovo
  let latestShowUntil = 0;  // timestamp (ms) fino a cui tenerlo visibile

  let ui = null;            // riferimenti DOM

  // ========= CFG =========
  function loadCfg() {
    try {
      const raw = localStorage.getItem(LS_KEY) || "{}";
      const o = JSON.parse(raw);
      return {
        base: typeof o.base === "string" && o.base ? o.base : DEFAULT_BASE,
        token: typeof o.token === "string" ? o.token : "",
        enabled: !!o.enabled
      };
    } catch {
      return { base: DEFAULT_BASE, token: "", enabled: false };
    }
  }

  function saveCfg() {
    localStorage.setItem(LS_KEY, JSON.stringify(cfg));
  }

  // ========= UTIL =========
  function fmtTime(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function fmtMoney(n) {
    if (!Number.isFinite(n)) return "$0";
    return "$" + n.toLocaleString();
  }

  function eventSignature(e) {
    if (!e) return "";
    // basta cambiare qualcosa di questi per considerarlo "nuovo"
    return `${e.kind || "?"}|${e.market || "?"}|${e.event || "?"}|${e.itemId || 0}|${e.ts || 0}`;
  }

  // ========= RENDER =========
  function ensureUI() {
    if (ui) return;

    const bar = document.createElement("div");
    bar.id = "gth_hud_bar";
    bar.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 999999;
      height: 28px;
      background: rgba(0,0,0,0.86);
      color: #f5f5f5;
      font: 12px/28px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;
      display: flex;
      align-items: center;
      padding: 0 10px;
      box-sizing: border-box;
      pointer-events: auto;
    `;

    const title = document.createElement("div");
    title.textContent = "GTH-HUD";
    title.style.cssText = `
      font-weight: 900;
      margin-right: 8px;
      white-space: nowrap;
    `;
    bar.appendChild(title);

    const msg = document.createElement("div");
    msg.id = "gth_hud_msg";
    msg.textContent = "—";
    msg.style.cssText = `
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      opacity: 0.95;
    `;
    bar.appendChild(msg);

    const btnLog = document.createElement("button");
    btnLog.textContent = "Log";
    btnLog.style.cssText = `
      margin-left: 6px;
      padding: 3px 8px;
      border-radius: 999px;
      border: 0;
      font-size: 11px;
      font-weight: 700;
      cursor: pointer;
      background: #2a2a2a;
      color: #f5f5f5;
    `;
    bar.appendChild(btnLog);

    const btnCfg = document.createElement("button");
    btnCfg.textContent = "⚙︎";
    btnCfg.style.cssText = `
      margin-left: 4px;
      padding: 2px 6px;
      border-radius: 999px;
      border: 0;
      font-size: 11px;
      cursor: pointer;
      background: #2a2a2a;
      color: #f5f5f5;
    `;
    bar.appendChild(btnCfg);

    const panel = document.createElement("div");
    panel.id = "gth_hud_panel";
    panel.style.cssText = `
      position: fixed;
      top: 28px;
      left: 0;
      right: 0;
      max-height: 260px;
      background: rgba(0,0,0,0.92);
      color: #f5f5f5;
      font: 12px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;
      box-shadow: 0 6px 20px rgba(0,0,0,0.6);
      padding: 8px 10px;
      box-sizing: border-box;
      overflow-y: auto;
      display: none;
      z-index: 999998;
    `;

    const panelTitle = document.createElement("div");
    panelTitle.textContent = "Ultimi 10 eventi";
    panelTitle.style.cssText = "font-weight: 800; margin-bottom: 6px;";
    panel.appendChild(panelTitle);

    const list = document.createElement("div");
    list.id = "gth_hud_list";
    panel.appendChild(list);

    document.body.appendChild(bar);
    document.body.appendChild(panel);

    btnLog.addEventListener("click", () => {
      panel.style.display = panel.style.display === "none" ? "block" : "none";
    });

    btnCfg.addEventListener("click", () => {
      showConfigDialog();
    });

    ui = { bar, msg, panel, list };
  }

  function showConfigDialog() {
    const token = prompt("HUD token (HUD_TOKEN sul server):", cfg.token || "");
    if (token == null) return;
    cfg.token = token.trim();
    const base = prompt("Base URL server HUD:", cfg.base || DEFAULT_BASE);
    if (base == null) return;
    cfg.base = (base.trim() || DEFAULT_BASE).replace(/\/+$/, "");
    const en = confirm("Abilitare GTH-HUD? (OK = ON, Annulla = OFF)");
    cfg.enabled = !!en;
    saveCfg();
    if (cfg.enabled) startPolling();
  }

  function formatTopLine(e) {
    if (!e) return "—";

    const t = fmtTime(e.ts);
    const kind = e.kind || "deal";
    const market = e.market || "";

    if (kind === "combat" || market === "combat") {
      const c = e.combat || {};
      const label =
        (e.event === "intercept" ? "INTERCEPT"
          : e.event === "retal" ? "RETAL"
            : "ATTACK");
      const attacker = c.attackerName || "???";
      const target = c.targetName || "???";
      return `${label} · ${t} · ${attacker} → ${target}`;
    }

    const name = e.itemName || `Item ${e.itemId || "?"}`;
    const price = fmtMoney(e.price || 0);
    const qty = Number.isFinite(e.amount) ? e.amount : 0;
    const tot = Number.isFinite(e.total) ? e.total : (e.price || 0) * qty;

    if (kind === "bigtx") {
      return `BIG TX · ${t} · ${name} · ${price} x${qty} (Tot ${fmtMoney(tot)})`;
    }

    return `DEAL · ${t} · ${name} · ${price} x${qty} (Tot ${fmtMoney(tot)})`;
  }

  function formatListLine(e) {
    if (!e) return "";

    const t = fmtTime(e.ts);
    const kind = e.kind || "deal";
    const market = e.market || "";

    if (kind === "combat" || market === "combat") {
      const c = e.combat || {};
      const label =
        (e.event === "intercept" ? "INTERCEPT"
          : e.event === "retal" ? "RETAL"
            : "ATTACK");
      const attacker = c.attackerName || "???";
      const target = c.targetName || "???";
      const result = c.result ? ` · ${c.result}` : "";
      return `[${t}] ${label}: ${attacker} → ${target}${result}`;
    }

    const name = e.itemName || `Item ${e.itemId || "?"}`;
    const price = fmtMoney(e.price || 0);
    const qty = Number.isFinite(e.amount) ? e.amount : 0;
    const tot = Number.isFinite(e.total) ? e.total : (e.price || 0) * qty;
    const label = kind === "bigtx" ? "BIG TX" : "DEAL";

    return `[${t}] ${label}: ${name} · ${price} x${qty} (Tot ${fmtMoney(tot)})`;
  }

  function render() {
    ensureUI();
    const now = Date.now();

    // Top bar
    if (latest && now <= latestShowUntil) {
      ui.msg.textContent = formatTopLine(latest);
    } else {
      ui.msg.textContent = "—";
    }

    // Lista ultimi 10
    ui.list.innerHTML = "";
    if (!events.length) {
      const empty = document.createElement("div");
      empty.textContent = "Nessun evento recente.";
      empty.style.opacity = "0.8";
      ui.list.appendChild(empty);
      return;
    }

    for (const e of events) {
      const row = document.createElement("div");
      row.style.cssText = `
        padding: 6px 4px;
        border-bottom: 1px solid rgba(255,255,255,0.06);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
      `;

      const text = document.createElement("div");
      text.textContent = formatListLine(e);
      text.style.cssText = `
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      `;
      row.appendChild(text);

      // Bottoni azione
      const btnWrap = document.createElement("div");
      btnWrap.style.cssText = "display:flex; gap:4px;";

      if (e.kind === "combat" || e.market === "combat") {
        const c = e.combat || {};
        const enemyId =
          e.sellerId ||
          c.enemyId ||
          c.attackerId ||
          c.targetId ||
          null;

        if (enemyId) {
          const bAtk = document.createElement("button");
          bAtk.textContent = "Attack";
          bAtk.style.cssText = btnStyle();
          bAtk.addEventListener("click", () => {
            window.open(
              `https://www.torn.com/loader.php?sid=attack&user2ID=${enemyId}`,
              "_blank"
            );
          });
          btnWrap.appendChild(bAtk);
        }

        if (c.attackLogUrl) {
          const bLog = document.createElement("button");
          bLog.textContent = "Log";
          bLog.style.cssText = btnStyle();
          bLog.addEventListener("click", () => {
            window.open(c.attackLogUrl, "_blank");
          });
          btnWrap.appendChild(bLog);
        }
      } else {
        if (e.marketUrl) {
          const bMkt = document.createElement("button");
          bMkt.textContent = "Market";
          bMkt.style.cssText = btnStyle();
          bMkt.addEventListener("click", () => {
            window.open(e.marketUrl, "_blank");
          });
          btnWrap.appendChild(bMkt);
        }
        if (e.sellerId) {
          const bAtk = document.createElement("button");
          bAtk.textContent = "Attack";
          bAtk.style.cssText = btnStyle();
          bAtk.addEventListener("click", () => {
            window.open(
              `https://www.torn.com/loader.php?sid=attack&user2ID=${e.sellerId}`,
              "_blank"
            );
          });
          btnWrap.appendChild(bAtk);
        }
      }

      if (btnWrap.childElementCount) row.appendChild(btnWrap);
      ui.list.appendChild(row);
    }
  }

  function btnStyle() {
    return `
      padding: 3px 8px;
      border-radius: 999px;
      border: 0;
      font-size: 11px;
      font-weight: 700;
      cursor: pointer;
      background: #3a3a3a;
      color: #f5f5f5;
      white-space: nowrap;
    `;
  }

  // ========= POLLING =========
  function startPolling() {
    if (polling) return;
    polling = true;

    ensureUI();
    render();
    loop();
  }

  function loop() {
    if (!polling) return;
    if (!cfg.enabled || !cfg.token || !cfg.base) {
      setTimeout(loop, POLL_MS);
      return;
    }

    const url = `${cfg.base.replace(/\/+$/, "")}/hud/recent?token=${encodeURIComponent(
      cfg.token
    )}`;

    GM_xmlhttpRequest({
      method: "GET",
      url,
      timeout: 12000,
      onload: (resp) => {
        try {
          const status = resp.status || 0;
          if (status < 200 || status >= 300) throw new Error("HTTP " + status);
          const data = JSON.parse(resp.responseText || "{}");
          if (!data || data.ok === false) throw new Error("bad payload");

          const now = Date.now();
          const buf = Array.isArray(data.buffer) ? data.buffer : [];

          // pulizia: teniamo solo eventi <= 10 minuti
          const fresh = buf.filter((e) => {
            const ts = Number(e.ts) || 0;
            return ts > 0 && now - ts <= MAX_LOCAL_AGE_MS;
          });

          // ordina dal più recente
          fresh.sort((a, b) => (b.ts || 0) - (a.ts || 0));
          events = fresh;

          const first = events[0] || null;
          const sig = eventSignature(first);
          if (first && sig && sig !== latestId) {
            latest = first;
            latestId = sig;
            latestShowUntil = Date.now() + TOP_VIS_MS;
          }

          render();
        } catch (e) {
          // fall silent, ma continuiamo il loop
          console.warn("[GTH-HUD] poll error:", e.message || e);
        } finally {
          setTimeout(loop, POLL_MS);
        }
      },
      onerror: () => {
        setTimeout(loop, POLL_MS * 2);
      },
      ontimeout: () => {
        setTimeout(loop, POLL_MS * 2);
      }
    });
  }

  // ========= INIT =========
  function init() {
    ensureUI();

    // primo setup se manca token
    if (!cfg.token) {
      // non forzo il prompt; l'utente può aprire il menu config
      console.log("[GTH-HUD] nessun token configurato, clicca ⚙︎ per impostarlo.");
    }

    if (cfg.enabled) {
      startPolling();
    } else {
      // lascia la barra spenta ma disponibile
      render();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
