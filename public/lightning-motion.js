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
let audioContext = null;
let soundEnabled = false;
let lastSoundAt = 0;
let lastSoundKind = "";

try {
  soundEnabled = window.localStorage?.getItem("easymarket_motion_sound") === "1";
} catch {
  soundEnabled = false;
}

function reducedMotion() {
  return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
}

function getAudioContext() {
  if (!soundEnabled) {
    return null;
  }

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    return null;
  }

  if (!audioContext) {
    audioContext = new AudioContextClass();
  }

  if (audioContext.state === "suspended") {
    void audioContext.resume();
  }

  return audioContext;
}

function safeStop(node, time) {
  try {
    node.stop(time);
  } catch {
    // One-shot WebAudio nodes can only be stopped once.
  }
}

function connectEnvelope(ctx, destination, startAt, duration, volume) {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), startAt + Math.min(0.035, duration * 0.22));
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  gain.connect(destination);
  return gain;
}

function playSweep({ delay = 0, duration = 0.18, start = 130, peak = 650, end = 190, volume = 0.13 } = {}) {
  const ctx = getAudioContext();
  if (!ctx) {
    return;
  }

  const startAt = ctx.currentTime + delay;
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.Q.setValueAtTime(0.9, startAt);
  filter.frequency.setValueAtTime(Math.max(80, start * 2.5), startAt);
  filter.frequency.exponentialRampToValueAtTime(Math.max(120, peak * 1.7), startAt + duration * 0.52);
  filter.frequency.exponentialRampToValueAtTime(Math.max(90, end * 2.2), startAt + duration);

  const gain = connectEnvelope(ctx, ctx.destination, startAt, duration, volume);
  filter.connect(gain);

  [0, -7, 12].forEach((detune, index) => {
    const osc = ctx.createOscillator();
    osc.type = index === 1 ? "triangle" : "sawtooth";
    osc.detune.setValueAtTime(detune, startAt);
    osc.frequency.setValueAtTime(start, startAt);
    osc.frequency.exponentialRampToValueAtTime(peak, startAt + duration * 0.42);
    osc.frequency.exponentialRampToValueAtTime(end, startAt + duration);
    osc.connect(filter);
    osc.start(startAt);
    safeStop(osc, startAt + duration + 0.04);
  });
}

function playHum({ delay = 0, duration = 0.42, volume = 0.035 } = {}) {
  const ctx = getAudioContext();
  if (!ctx) {
    return;
  }

  const startAt = ctx.currentTime + delay;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(260, startAt);
  filter.frequency.exponentialRampToValueAtTime(520, startAt + duration * 0.48);
  filter.frequency.exponentialRampToValueAtTime(180, startAt + duration);

  const gain = connectEnvelope(ctx, ctx.destination, startAt, duration, volume);
  filter.connect(gain);

  [54, 108].forEach((frequency, index) => {
    const osc = ctx.createOscillator();
    osc.type = index === 0 ? "sine" : "triangle";
    osc.frequency.setValueAtTime(frequency, startAt);
    osc.connect(filter);
    osc.start(startAt);
    safeStop(osc, startAt + duration + 0.04);
  });
}

export function isMotionSoundEnabled() {
  return soundEnabled;
}

export async function setMotionSoundEnabled(enabled) {
  soundEnabled = Boolean(enabled);
  try {
    window.localStorage?.setItem("easymarket_motion_sound", soundEnabled ? "1" : "0");
  } catch {
    // Storage can be unavailable in hardened webviews.
  }

  if (soundEnabled) {
    const ctx = getAudioContext();
    if (ctx?.state === "suspended") {
      await ctx.resume().catch(() => undefined);
    }
    playMotionSound("toggle");
  }

  return soundEnabled;
}

export function playMotionSound(kind = "tap") {
  if (!soundEnabled || reducedMotion()) {
    return;
  }

  const now = Date.now();
  const normalizedKind = kind === "selection" || kind === "light" || kind === "medium" ? "tap" : kind;
  const minGap = normalizedKind === "win" ? 1200 : normalizedKind === "success" ? 280 : 150;
  if (lastSoundKind === normalizedKind && now - lastSoundAt < minGap) {
    return;
  }
  lastSoundKind = normalizedKind;
  lastSoundAt = now;

  if (normalizedKind === "win") {
    playHum({ duration: 1.55, volume: 0.045 });
    playSweep({ delay: 0.02, duration: 0.52, start: 95, peak: 820, end: 150, volume: 0.16 });
    playSweep({ delay: 0.36, duration: 0.58, start: 180, peak: 980, end: 120, volume: 0.15 });
    playSweep({ delay: 0.82, duration: 0.72, start: 120, peak: 1120, end: 210, volume: 0.13 });
    return;
  }

  if (normalizedKind === "success" || normalizedKind === "toggle") {
    playHum({ duration: 0.52, volume: 0.034 });
    playSweep({ duration: 0.24, start: 120, peak: 760, end: 210, volume: 0.12 });
    playSweep({ delay: 0.18, duration: 0.26, start: 210, peak: 900, end: 160, volume: 0.09 });
    return;
  }

  if (normalizedKind === "warning" || normalizedKind === "error") {
    playSweep({ duration: 0.2, start: 190, peak: 360, end: 95, volume: normalizedKind === "error" ? 0.13 : 0.1 });
    return;
  }

  playSweep({ duration: 0.15, start: 135, peak: 610, end: 190, volume: 0.09 });
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

function syncMotionRadius(element, fallback = "14px") {
  if (!element || !window.getComputedStyle) {
    return;
  }

  const styles = window.getComputedStyle(element);
  const radius = styles.borderRadius && styles.borderRadius !== "0px" ? styles.borderRadius : fallback;
  element.style.setProperty("--lm-radius", radius);
}

export function triggerButtonLightning(button, event = null) {
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

  button.classList.add("lm-clickable");
  syncMotionRadius(button, "12px");
  button.classList.remove("lm-lightning-tap");
  void button.offsetWidth;
  button.classList.add("lm-lightning-tap");

  const flash = document.createElement("span");
  flash.className = "lm-button-flash";
  flash.style.setProperty("--lm-x", `${x}px`);
  flash.style.setProperty("--lm-y", `${y}px`);
  button.appendChild(flash);
  appendSparks(button, x, y, 6);
  playMotionSound("tap");

  window.setTimeout(() => {
    button.classList.remove("lm-lightning-tap");
    flash.remove();
  }, 940);
}

export function triggerCardLightning(card) {
  if (!card) {
    return;
  }

  syncMotionRadius(card, "18px");
  card.classList.add("lm-lightning-card");
  card.classList.remove("lm-card-active");
  void card.offsetWidth;
  card.classList.add("lm-card-active");
  window.setTimeout(() => card.classList.remove("lm-card-active"), 820);
}

export function showSuccessLightningBurst(label = "Success") {
  const now = Date.now();
  if (now - lastSuccessAt < 260) {
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
  appendSparks(burst, 110, 92, 12);
  playMotionSound("success");
  window.setTimeout(() => burst.remove(), 1900);
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
    syncMotionRadius(card, "18px");
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
