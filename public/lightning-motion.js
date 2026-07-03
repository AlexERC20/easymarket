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
  ".top-more-item",
  ".quick-bet-toggle",
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

function isTelegramIosWebApp() {
  const platform = String(window.Telegram?.WebApp?.platform || "").toLowerCase();
  return platform === "ios" || /iPhone|iPad|iPod/i.test(navigator.userAgent || "");
}

function reducedMotion() {
  const reduced = Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
  // Telegram's iOS WebView can report reduced motion and silently suppress the
  // short game feedback we rely on: rewards, round sweep, win burst. Keep those
  // transactional effects alive on iPhone while the CSS still tones down heavy
  // ambient loops.
  return reduced && !isTelegramIosWebApp();
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

  if (normalizedKind === "tap-strong") {
    playSweep({ duration: 0.16, start: 150, peak: 740, end: 210, volume: 0.1 });
    playSweep({ delay: 0.05, duration: 0.22, start: 320, peak: 1080, end: 180, volume: 0.075 });
    return;
  }

  playSweep({ duration: 0.15, start: 135, peak: 610, end: 190, volume: 0.09 });
}

let lastAquariumEatAt = 0;

// Soft sprinkle as fish food drops onto the water. Gated by the sound toggle
// (getAudioContext returns null when sound is off).
export function playAquariumFood() {
  const ctx = getAudioContext();
  if (!ctx) {
    return;
  }
  [920, 1180, 1480].forEach((freq, index) => {
    const startAt = ctx.currentTime + index * 0.04;
    const duration = 0.08;
    const gain = connectEnvelope(ctx, ctx.destination, startAt, duration, 0.05);
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, startAt);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.68, startAt + duration);
    osc.connect(gain);
    osc.start(startAt);
    safeStop(osc, startAt + duration + 0.04);
  });
}

// Soft "blub" gulp when a fish bites a crumb. Throttled so a feeding frenzy
// doesn't machine-gun the sound.
export function playAquariumEat() {
  const now = Date.now();
  if (now - lastAquariumEatAt < 110) {
    return;
  }
  lastAquariumEatAt = now;
  const ctx = getAudioContext();
  if (!ctx) {
    return;
  }
  const startAt = ctx.currentTime;
  const duration = 0.11;
  const gain = connectEnvelope(ctx, ctx.destination, startAt, duration, 0.06);
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(210, startAt);
  osc.frequency.exponentialRampToValueAtTime(85, startAt + duration);
  osc.connect(gain);
  osc.start(startAt);
  safeStop(osc, startAt + duration + 0.04);
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

function appendSparks(target, x, y, count = 5, tier = 1) {
  if (!target) {
    return;
  }

  const safeCount = reducedMotion() ? Math.min(2, count) : count;
  const safeTier = Math.max(1, Math.min(4, Number(tier) || 1));
  for (let index = 0; index < safeCount; index += 1) {
    const spark = document.createElement("span");
    const angle = (Math.PI * 2 * index) / count + Math.random() * 0.7;
    const distance = 18 + Math.random() * (20 + safeTier * 8);
    spark.className = `lm-spark tier-${safeTier}`;
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

function getStakeTier(button) {
  const tier = Number(button?.dataset?.stakeTier || 0);
  if (Number.isFinite(tier) && tier > 0) {
    return Math.max(1, Math.min(4, Math.round(tier)));
  }
  return 1;
}

function hasStakeTier(button) {
  return Number(button?.dataset?.stakeTier || 0) > 0;
}

// Per-tier lightning escalation. Higher stake -> more bolts, longer reach,
// thicker strokes, longer life. Tier 4 also fires a radial shockwave.
const BOLT_SPEC = {
  1: { count: 1, segs: 5, reach: 0.62, width: 1.6, dur: 560, branches: 0 },
  2: { count: 2, segs: 6, reach: 0.78, width: 1.8, dur: 660, branches: 0 },
  3: { count: 3, segs: 7, reach: 0.96, width: 2.1, dur: 780, branches: 1 },
  4: { count: 5, segs: 8, reach: 1.12, width: 2.4, dur: 940, branches: 2 },
};

const SVG_NS = "http://www.w3.org/2000/svg";

// Jagged polyline from (sx, sy) heading along `angle`, jittered perpendicular
// to the travel direction so it reads like a crackling bolt rather than a line.
function buildBoltPath(sx, sy, angle, length, segments, jitter) {
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);
  const perpX = -dirY;
  const perpY = dirX;
  const step = length / segments;
  let d = `M ${sx.toFixed(1)} ${sy.toFixed(1)}`;
  for (let i = 1; i <= segments; i += 1) {
    const along = step * i;
    // Taper the jitter toward the tip so the strike converges to a point.
    const taper = 1 - (i - 1) / (segments + 1);
    const offset = (Math.random() - 0.5) * jitter * taper;
    const px = sx + dirX * along + perpX * offset;
    const py = sy + dirY * along + perpY * offset;
    d += ` L ${px.toFixed(1)} ${py.toFixed(1)}`;
  }
  return d;
}

function makeBoltPath(d, delayMs) {
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", d);
  path.setAttribute("pathLength", "1");
  if (delayMs) {
    path.style.animationDelay = `${delayMs}ms`;
  }
  return path;
}

// Draws tier-scaled lightning bolts radiating from the tap point, masked to the
// button so they never leak square glow outside the rounded shape.
function appendLightningBolts(button, x, y, tier, rect) {
  const spec = BOLT_SPEC[tier] || BOLT_SPEC[1];
  const reduced = reducedMotion();
  const count = reduced ? 1 : spec.count;
  const width = Math.max(8, rect.width);
  const height = Math.max(8, rect.height);
  const reach = Math.max(width, height) * spec.reach;
  const jitter = Math.min(width, height) * 0.34;

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${width.toFixed(1)} ${height.toFixed(1)}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("lm-bolt-layer", `tier-${tier}`);
  svg.style.setProperty("--lm-bolt-width", String(spec.width));
  svg.style.setProperty("--lm-bolt-dur", `${spec.dur}ms`);

  for (let i = 0; i < count; i += 1) {
    const baseAngle =
      (Math.PI * 2 * i) / count - Math.PI / 2 + (Math.random() - 0.5) * 0.7;
    const length = reach * (0.72 + Math.random() * 0.5);
    const d = buildBoltPath(x, y, baseAngle, length, spec.segs, jitter);
    svg.appendChild(makeBoltPath(d, i * 28));

    if (!reduced && spec.branches > 0 && Math.random() > 0.35) {
      const forkAlong = length * (0.42 + Math.random() * 0.28);
      const fx = x + Math.cos(baseAngle) * forkAlong;
      const fy = y + Math.sin(baseAngle) * forkAlong;
      const forkAngle = baseAngle + (Math.random() > 0.5 ? 1 : -1) * (0.5 + Math.random() * 0.4);
      const forkD = buildBoltPath(fx, fy, forkAngle, length * 0.5, spec.segs - 2, jitter * 0.7);
      const forkPath = makeBoltPath(forkD, i * 28 + 36);
      forkPath.classList.add("lm-bolt-branch");
      svg.appendChild(forkPath);
    }
  }

  button.appendChild(svg);
  window.setTimeout(() => svg.remove(), spec.dur + count * 28 + 160);
  return svg;
}

// A single circular shockwave centered on the button. Circular + fixed + short
// lived, so it gives the top-stake "wow" without any square shadow on buttons.
function emitStakeShockwave(button, rect) {
  if (reducedMotion()) {
    return;
  }
  const ring = document.createElement("div");
  ring.className = "lm-stake-shockwave";
  ring.setAttribute("aria-hidden", "true");
  ring.style.left = `${rect.left + rect.width / 2}px`;
  ring.style.top = `${rect.top + rect.height / 2}px`;
  document.body.appendChild(ring);
  window.setTimeout(() => ring.remove(), 760);
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
  const tier = getStakeTier(button);
  const stakeButton = hasStakeTier(button);
  flash.className = `lm-button-flash tier-${tier}`;
  flash.style.setProperty("--lm-x", `${x}px`);
  flash.style.setProperty("--lm-y", `${y}px`);
  button.appendChild(flash);
  appendSparks(button, x, y, 5 + tier * 3, tier);

  // Real jagged bolts only on stake buttons, so the rest of the app stays calm.
  if (stakeButton) {
    appendLightningBolts(button, x, y, tier, rect);
    if (tier >= 4) {
      emitStakeShockwave(button, rect);
    }
  }

  playMotionSound(stakeButton && tier >= 3 ? "tap-strong" : "tap");

  window.setTimeout(() => {
    button.classList.remove("lm-lightning-tap");
    flash.remove();
  }, tier >= 4 ? 1280 : 940);
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

export function showSuccessLightningBurst(label = "Success", options = {}) {
  const now = Date.now();
  if (now - lastSuccessAt < 260) {
    return;
  }
  lastSuccessAt = now;

  const tier = Math.max(1, Math.min(4, Number(options.tier || 1)));
  const epic = Boolean(options.epic || tier >= 4);
  const burst = document.createElement("div");
  burst.className = `lm-success-burst tier-${tier}${epic ? " epic" : ""}`;
  burst.innerHTML = `
    ${boltSvg("lm-burst-bolt")}
    <strong>${String(label || "Success").replace(/[<>&]/g, "")}</strong>
  `;
  document.body.appendChild(burst);
  appendSparks(burst, 110, 92, epic ? 24 : 10 + tier * 3, tier);
  playMotionSound(epic ? "win" : "success");
  window.setTimeout(() => burst.remove(), epic ? 2600 : 1900);
}

// Directional money-flow burst for wallet actions.
// direction "in"  -> streaks converge to center (deposit credited).
// direction "out" -> streaks shoot outward (withdrawal sent).
export function showWalletFlowBurst(direction = "in", label = "") {
  const isOut = direction === "out";
  // Respect reduced motion: skip the directional sweep entirely. The action is
  // still confirmed via toast/haptic (and, for deposits, the reduced success burst).
  if (reducedMotion()) {
    playMotionSound(isOut ? "success" : "win");
    return;
  }

  const wrap = document.createElement("div");
  wrap.className = `lm-wallet-flow ${isOut ? "is-out" : "is-in"}`;
  wrap.setAttribute("aria-hidden", "true");

  const count = 11;
  const parts = [];
  for (let index = 0; index < count; index += 1) {
    const angle = (360 / count) * index + (isOut ? 0 : 16);
    const delay = Math.round(Math.random() * 120);
    parts.push(
      `<span class="lm-wallet-streak" style="--lm-ang:${angle}deg;animation-delay:${delay}ms"></span>`
    );
  }
  const safeLabel = String(label || "").replace(/[<>&]/g, "");
  wrap.innerHTML = `<span class="lm-wallet-core"></span>${parts.join("")}${
    safeLabel ? `<strong>${safeLabel}</strong>` : ""
  }`;
  document.body.appendChild(wrap);
  playMotionSound(isOut ? "success" : "win");
  window.setTimeout(() => wrap.remove(), isOut ? 1500 : 1700);
}

// --- Hybrid thematic effects -----------------------------------------------
// A domain-specific motion vocabulary so events read differently: coins for a
// win, a colored arrow for a bet direction, a gold pop for a reward claim, an
// orange candle sweep for a new round. Lightning is kept only for epic wins.

// Win celebration: a shower of gold coins + confetti. Epic wins also get a
// single lightning accent (the reserved "big moment" signifier).
export function showWinCelebration(options = {}) {
  const tier = Math.max(1, Math.min(4, Number(options.tier || 1)));
  const epic = Boolean(options.epic || tier >= 4);
  playMotionSound(epic ? "win" : "success");
  if (reducedMotion()) {
    return;
  }

  const layer = document.createElement("div");
  layer.className = `lm-win-cele${epic ? " epic" : ""}`;
  layer.setAttribute("aria-hidden", "true");

  const coinCount = epic ? 22 : 9 + tier * 3;
  const confettiCount = epic ? 26 : 11 + tier * 3;
  const confColors = ["var(--yes)", "#f7b955", "#35f6ff", "#ffd65c"];
  const pieces = [];
  for (let i = 0; i < coinCount; i += 1) {
    const left = Math.round(Math.random() * 100);
    const delay = Math.round(Math.random() * 420);
    const dur = 900 + Math.round(Math.random() * 700);
    const drift = Math.round((Math.random() - 0.5) * 70);
    const spin = Math.round(180 + Math.random() * 540) * (Math.random() > 0.5 ? 1 : -1);
    pieces.push(
      `<span class="lm-coin" style="left:${left}%;--lm-drift:${drift}px;--lm-spin:${spin}deg;animation-delay:${delay}ms;animation-duration:${dur}ms"></span>`
    );
  }
  for (let i = 0; i < confettiCount; i += 1) {
    const left = Math.round(Math.random() * 100);
    const delay = Math.round(Math.random() * 480);
    const dur = 1000 + Math.round(Math.random() * 800);
    const drift = Math.round((Math.random() - 0.5) * 130);
    const spin = Math.round(240 + Math.random() * 720) * (Math.random() > 0.5 ? 1 : -1);
    const color = confColors[i % confColors.length];
    pieces.push(
      `<span class="lm-confetti" style="left:${left}%;--lm-drift:${drift}px;--lm-spin:${spin}deg;background:${color};animation-delay:${delay}ms;animation-duration:${dur}ms"></span>`
    );
  }
  layer.innerHTML = `${epic ? boltSvg("lm-win-bolt") : ""}${pieces.join("")}`;
  document.body.appendChild(layer);
  // Removal must outlast the slowest piece: confetti dur(<=1800) + delay(<=480).
  window.setTimeout(() => layer.remove(), epic ? 2900 : 2400);
}

// Bet placement: a directional cue by side. YES/UP -> green rise, NO/DOWN -> red fall.
export function showDirectionalSurge(side = "YES", originRect = null) {
  const up = side === "YES" || side === "UP" || side === "up";
  playMotionSound("success");
  if (reducedMotion()) {
    return;
  }

  const layer = document.createElement("div");
  layer.className = `lm-dir-surge ${up ? "is-up" : "is-down"}`;
  layer.setAttribute("aria-hidden", "true");
  // Guard on width (not just a finite left): a hidden/collapsed element returns
  // an all-zero rect, and we want the centered default in that case.
  if (originRect && originRect.width) {
    layer.style.left = `${originRect.left + originRect.width / 2}px`;
    layer.style.top = `${originRect.top + originRect.height / 2}px`;
    layer.classList.add("has-origin");
  }

  const count = 7;
  const streaks = [];
  for (let i = 0; i < count; i += 1) {
    const offset = Math.round((i - (count - 1) / 2) * 15);
    const delay = Math.round(Math.random() * 90);
    const len = 58 + Math.round(Math.random() * 44);
    streaks.push(
      `<span class="lm-surge-streak" style="--lm-off:${offset}px;--lm-len:${len}px;animation-delay:${delay}ms"></span>`
    );
  }
  layer.innerHTML = `<span class="lm-surge-arrow"></span>${streaks.join("")}`;
  document.body.appendChild(layer);
  window.setTimeout(() => layer.remove(), 900);
}

// Reward claim: a bright gold burst — expanding rings + a spray of gold coins +
// gold sparks (the coin flying to the balance is handled by the caller).
export function showRewardPop(originEl = null) {
  playMotionSound("success");
  if (reducedMotion()) {
    return;
  }
  const rect = originEl?.getBoundingClientRect?.();
  const cx = rect && rect.width ? rect.left + rect.width / 2 : window.innerWidth / 2;
  const cy = rect && rect.width ? rect.top + rect.height / 2 : window.innerHeight * 0.4;

  const pop = document.createElement("div");
  pop.className = "lm-reward-pop";
  pop.setAttribute("aria-hidden", "true");
  pop.style.left = `${cx}px`;
  pop.style.top = `${cy}px`;

  const coinCount = 10;
  const coins = [];
  for (let i = 0; i < coinCount; i += 1) {
    const angle = (Math.PI * 2 * i) / coinCount + 0.35;
    const dist = 42 + (i % 3) * 13;
    coins.push(
      `<span class="lm-reward-coin" style="--dx:${(Math.cos(angle) * dist).toFixed(1)}px;--dy:${(Math.sin(angle) * dist).toFixed(1)}px;animation-delay:${(i % 4) * 26}ms"></span>`
    );
  }
  pop.innerHTML = `<span class="lm-reward-ring"></span><span class="lm-reward-ring lm-reward-ring-2"></span>${coins.join("")}`;
  document.body.appendChild(pop);
  appendSparks(pop, 0, 0, 12, 3);
  window.setTimeout(() => pop.remove(), 1150);
}

// New round: an orange candle-flip + horizontal sweep, replacing the bolt burst.
export function showRoundSweep(label = "NEXT ROUND") {
  playMotionSound("success");
  if (reducedMotion()) {
    return;
  }
  const wrap = document.createElement("div");
  wrap.className = "lm-round-sweep";
  wrap.setAttribute("aria-hidden", "true");
  const safeLabel = String(label || "").replace(/[<>&]/g, "");
  wrap.innerHTML = `
    <span class="lm-round-band"></span>
    <span class="lm-round-candle"></span>
    <strong>${safeLabel}</strong>
  `;
  document.body.appendChild(wrap);
  window.setTimeout(() => wrap.remove(), 1400);
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
