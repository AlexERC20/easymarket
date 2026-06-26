const BUTTON_SELECTOR = [
  ".amount-button",
  ".outcome-button",
  ".sell-button",
  ".trade-confirm",
  ".task-button",
  ".icon-button",
  ".ghost-button",
  ".clan-link-button",
  ".world-cup-actions button",
  ".bet-add-grid button",
  ".bet-side-toggle button",
  ".market-chat-form button",
  ".wallet-mode-toggle button",
  ".wallet-currency-toggle button",
  ".leaderboard-currency-toggle button",
  ".currency-switch button",
  ".market-panel-tabs button",
  ".orderbook-side-toggle button",
  ".withdraw-network-toggle button",
  ".referral-nudge button",
].join(",");

const CARD_SELECTOR = [
  ".market-card",
  ".world-cup-row",
  ".leaderboard-row",
  ".clan-row",
  ".user-clan-card",
  ".clan-detail-card",
].join(",");

const TAB_GROUP_SELECTOR = [
  ".task-tabs",
  ".currency-switch",
  ".wallet-mode-toggle",
  ".wallet-currency-toggle",
  ".leaderboard-currency-toggle",
  ".market-panel-tabs",
  ".orderbook-side-toggle",
  ".bet-side-toggle",
  ".withdraw-network-toggle",
].join(",");

let motionInitialized = false;
let lastSuccessAt = 0;
let lastScreenLightningAt = 0;

function reducedMotion() {
  return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
}

function boltSvg(className = "lm-loader-bolt") {
  return `
    <svg class="${className}" viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="lmBoltGradient" x1="12" y1="8" x2="52" y2="56" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#fff7a8" />
          <stop offset="0.42" stop-color="#b7ff4d" />
          <stop offset="1" stop-color="#35f6ff" />
        </linearGradient>
      </defs>
      <path d="M36.8 3 13.6 35.6h16L24.8 61l25.6-35.8H34.2L36.8 3Z" />
    </svg>
  `;
}

function ensureLoader() {
  let loader = document.getElementById("lightningLoader");
  if (loader) {
    return loader;
  }

  loader = document.createElement("div");
  loader.id = "lightningLoader";
  loader.className = "lm-loader";
  loader.innerHTML = `
    <div class="lm-loader-card">
      ${boltSvg("lm-loader-bolt")}
      <strong>EASYMARKET</strong>
    </div>
  `;
  document.body.appendChild(loader);
  return loader;
}

function ensureEnergyBackground() {
  if (document.querySelector(".lm-energy-bg") || reducedMotion()) {
    return;
  }

  const bg = document.createElement("div");
  bg.className = "lm-energy-bg";
  bg.setAttribute("aria-hidden", "true");
  bg.innerHTML = "<span></span><span></span><span></span><span></span><span></span><span></span>";
  document.body.prepend(bg);
}

function appendSparks(target, x, y, count = 5) {
  if (!target) {
    return;
  }

  const safeCount = reducedMotion() ? Math.min(2, count) : count;
  for (let index = 0; index < safeCount; index += 1) {
    const spark = document.createElement("span");
    const angle = (Math.PI * 2 * index) / count + Math.random() * 0.7;
    const distance = 18 + Math.random() * 24;
    spark.className = "lm-spark";
    spark.style.setProperty("--lm-x", `${x}px`);
    spark.style.setProperty("--lm-y", `${y}px`);
    spark.style.setProperty("--lm-dx", `${Math.cos(angle) * distance}px`);
    spark.style.setProperty("--lm-dy", `${Math.sin(angle) * distance}px`);
    target.appendChild(spark);
    window.setTimeout(() => spark.remove(), 1100);
  }
}

function normalizeTier(value = 1) {
  const tier = Number(value || 1);
  if (!Number.isFinite(tier)) return 1;
  return Math.max(1, Math.min(4, Math.round(tier)));
}

export function triggerButtonLightning(button, event = null, options = {}) {
  if (!button || button.disabled) {
    return;
  }

  const now = Date.now();
  if (now - Number(button.dataset.lmLastTapAt || 0) < 120) {
    return;
  }
  button.dataset.lmLastTapAt = String(now);

  const rect = button.getBoundingClientRect();
  const x = event?.clientX ? event.clientX - rect.left : rect.width / 2;
  const y = event?.clientY ? event.clientY - rect.top : rect.height / 2;
  const tier = normalizeTier(options.tier ?? button.dataset.motionTier ?? button.dataset.lmTier ?? 1);
  const sparkCounts = [0, 5, 9, 15, 24];
  const durations = [0, 760, 980, 1220, 1500];

  button.classList.add("lm-clickable");
  button.classList.remove("lm-tier-1", "lm-tier-2", "lm-tier-3", "lm-tier-4");
  button.classList.add(`lm-tier-${tier}`);
  button.classList.remove("lm-lightning-tap");
  void button.offsetWidth;
  button.classList.add("lm-lightning-tap");

  const flash = document.createElement("span");
  flash.className = `lm-button-flash tier-${tier}`;
  flash.style.setProperty("--lm-x", `${x}px`);
  flash.style.setProperty("--lm-y", `${y}px`);
  button.appendChild(flash);
  appendSparks(button, x, y, sparkCounts[tier]);

  window.setTimeout(() => {
    button.classList.remove("lm-lightning-tap");
    button.classList.remove("lm-tier-1", "lm-tier-2", "lm-tier-3", "lm-tier-4");
    flash.remove();
  }, durations[tier]);
}

export function triggerCardLightning(card) {
  if (!card) {
    return;
  }

  card.classList.add("lm-lightning-card");
  card.classList.remove("lm-card-active");
  void card.offsetWidth;
  card.classList.add("lm-card-active");
  window.setTimeout(() => card.classList.remove("lm-card-active"), 820);
}

export function showSuccessLightningBurst(label = "Success", options = {}) {
  const now = Date.now();
  if (now - lastSuccessAt < 260) {
    return;
  }
  lastSuccessAt = now;

  const tier = normalizeTier(options.tier ?? 2);
  const variant = options.variant ? String(options.variant).replace(/[^a-z0-9_-]/gi, "") : "success";
  const durations = [0, 1500, 1900, 2400, 3200];
  const sparkCounts = [0, 8, 12, 16, 24];
  const burst = document.createElement("div");
  burst.className = `lm-success-burst tier-${tier} ${variant}`;
  burst.innerHTML = `
    ${boltSvg("lm-burst-bolt")}
    <strong>${String(label || "Success").replace(/[<>&]/g, "")}</strong>
  `;
  document.body.appendChild(burst);
  appendSparks(burst, 110, 92, sparkCounts[tier]);
  window.setTimeout(() => burst.remove(), durations[tier]);
}

export function triggerScreenLightning(kind = "task") {
  const now = Date.now();
  if (now - lastScreenLightningAt < 420) {
    return;
  }
  lastScreenLightningAt = now;

  const overlay = document.createElement("div");
  overlay.className = `lm-screen-lightning ${String(kind || "task").replace(/[^a-z0-9_-]/gi, "")}`;
  overlay.innerHTML = `
    <span></span>
    <span></span>
    <span></span>
  `;
  document.body.appendChild(overlay);
  window.setTimeout(() => overlay.remove(), 1800);
}

export function triggerPaperPlaneBurst(target = null) {
  const rect = target?.getBoundingClientRect?.();
  const startX = rect ? rect.left + rect.width / 2 : window.innerWidth * 0.82;
  const startY = rect ? rect.top + rect.height / 2 : window.innerHeight * 0.74;
  const plane = document.createElement("div");
  plane.className = "lm-paper-plane";
  plane.style.setProperty("--lm-plane-x", `${startX}px`);
  plane.style.setProperty("--lm-plane-y", `${startY}px`);
  plane.innerHTML = `
    <svg viewBox="0 0 42 42" aria-hidden="true">
      <path d="M35.6 5.8 5.9 18.1c-1.9.8-1.8 3.5.2 4.1l8.4 2.5 3.1 9.5c.6 1.8 3 2.1 4 .5L37.9 8.9c1.1-1.8-.4-4-2.3-3.1Z" />
      <path d="m15 24.4 13.7-10.2-9.9 13.8" />
    </svg>
  `;
  document.body.appendChild(plane);
  appendSparks(plane, 22, 20, 5);
  window.setTimeout(() => plane.remove(), 1500);
}

export function triggerBalancePulse(element) {
  if (!element) {
    return;
  }

  element.classList.remove("lm-balance-pulse");
  void element.offsetWidth;
  element.classList.add("lm-balance-pulse");
  window.setTimeout(() => element.classList.remove("lm-balance-pulse"), 460);
}

export function showLightningLoader() {
  const loader = ensureLoader();
  loader.classList.remove("hidden");
  return loader;
}

export function hideLightningLoader() {
  const loader = document.getElementById("lightningLoader");
  if (!loader) {
    return;
  }

  loader.classList.add("hidden");
  window.setTimeout(() => loader.remove(), 320);
}

export function refreshLightningTargets(root = document) {
  root.querySelectorAll?.(CARD_SELECTOR).forEach((card) => {
    card.classList.add("lm-lightning-card");
  });

  root.querySelectorAll?.(TAB_GROUP_SELECTOR).forEach((group) => {
    group.classList.add("lm-tab-group");
  });
}

function bindGlobalTriggers() {
  document.addEventListener("pointerdown", (event) => {
    const button = event.target.closest(BUTTON_SELECTOR);
    if (button) {
      triggerButtonLightning(button, event);
    }

    const card = event.target.closest(CARD_SELECTOR);
    if (card) {
      triggerCardLightning(card);
    }
  }, { passive: true });
}

function observeDynamicTargets() {
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          refreshLightningTargets(node);
        }
      });
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

export function initLightningMotion() {
  if (motionInitialized) {
    return;
  }
  motionInitialized = true;

  ensureEnergyBackground();
  showLightningLoader();
  refreshLightningTargets(document);
  bindGlobalTriggers();
  observeDynamicTargets();
}
