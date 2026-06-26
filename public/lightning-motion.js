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
  if (!target || reducedMotion()) {
    return;
  }

  for (let index = 0; index < count; index += 1) {
    const spark = document.createElement("span");
    const angle = (Math.PI * 2 * index) / count + Math.random() * 0.7;
    const distance = 18 + Math.random() * 24;
    spark.className = "lm-spark";
    spark.style.setProperty("--lm-x", `${x}px`);
    spark.style.setProperty("--lm-y", `${y}px`);
    spark.style.setProperty("--lm-dx", `${Math.cos(angle) * distance}px`);
    spark.style.setProperty("--lm-dy", `${Math.sin(angle) * distance}px`);
    target.appendChild(spark);
    window.setTimeout(() => spark.remove(), 760);
  }
}

export function triggerButtonLightning(button, event = null) {
  if (!button || button.disabled || reducedMotion()) {
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

  button.classList.add("lm-clickable");
  button.classList.remove("lm-lightning-tap");
  void button.offsetWidth;
  button.classList.add("lm-lightning-tap");

  const flash = document.createElement("span");
  flash.className = "lm-button-flash";
  flash.style.setProperty("--lm-x", `${x}px`);
  flash.style.setProperty("--lm-y", `${y}px`);
  button.appendChild(flash);
  appendSparks(button, x, y, 4);

  window.setTimeout(() => {
    button.classList.remove("lm-lightning-tap");
    flash.remove();
  }, 620);
}

export function triggerCardLightning(card) {
  if (!card || reducedMotion()) {
    return;
  }

  card.classList.add("lm-lightning-card");
  card.classList.remove("lm-card-active");
  void card.offsetWidth;
  card.classList.add("lm-card-active");
  window.setTimeout(() => card.classList.remove("lm-card-active"), 820);
}

export function showSuccessLightningBurst(label = "Success") {
  if (reducedMotion()) {
    return;
  }

  const now = Date.now();
  if (now - lastSuccessAt < 360) {
    return;
  }
  lastSuccessAt = now;

  const burst = document.createElement("div");
  burst.className = "lm-success-burst";
  burst.innerHTML = `
    ${boltSvg("lm-burst-bolt")}
    <strong>${String(label || "Success").replace(/[<>&]/g, "")}</strong>
  `;
  document.body.appendChild(burst);
  appendSparks(burst, 88, 78, 8);
  window.setTimeout(() => burst.remove(), 980);
}

export function triggerBalancePulse(element) {
  if (!element || reducedMotion()) {
    return;
  }

  element.classList.remove("lm-balance-pulse");
  void element.offsetWidth;
  element.classList.add("lm-balance-pulse");
  window.setTimeout(() => element.classList.remove("lm-balance-pulse"), 460);
}

export function showLightningLoader() {
  if (reducedMotion()) {
    return null;
  }

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
