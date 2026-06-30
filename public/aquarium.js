// Ambient "aquarium" layer drawn on a dedicated overlay canvas above the chart.
//
// When a market round ends, the avatar dots on the chart are spilled into this
// layer as slowly sinking food crumbs. A few small fish wander in the bottom
// ~25% of the chart and lazily hunt the crumbs. The layer is fully decoupled
// from the chart's own render loop and from market data, so the crumbs keep
// falling onto the next round's fresh screen where the fish are already living.

import { playAquariumFood, playAquariumEat } from "./lightning-motion.js?v=20260630-12";

// Realistic little fish drawn as inline SVG (iOS DOM path). Faces +x; colours
// come from CSS custom properties set per .fish-N class.
const DOM_FISH_SVG = `
  <svg class="fish-svg" viewBox="0 0 46 26" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    <g class="tail"><path d="M16 13 L2 5 Q7 13 2 21 Z" /></g>
    <path class="fin fin-d" d="M21 7 Q26 0 32 8 Z" />
    <path class="fin fin-p" d="M25 16 Q27 22 31 17 Z" />
    <ellipse class="body" cx="26" cy="13" rx="14" ry="7.5" />
    <ellipse class="belly" cx="27" cy="16.4" rx="11" ry="3.2" />
    <circle class="eye-w" cx="35" cy="11" r="2.4" />
    <circle class="eye-p" cx="35.8" cy="11" r="1.2" />
    <circle class="eye-h" cx="36.3" cy="10.4" r="0.5" />
  </svg>
`;

const STORAGE_KEY = "easymarket_aquarium";
const USER_CHOICE_KEY = "easymarket_aquarium_choice_v2";
const MAX_FOOD = 80;
const FISH_MIN = 4;
const FISH_MAX = 5;
const FOOD_ARM_MS = 1500; // brief settle before the hungry fish start hunting
const EAT_MS = 3280; // a bite is gradual, never instant
const FRAME_MS = 33; // ~30fps simulation cap to stay light on the phone
const SHAKE_JERK = 26; // summed |Δacceleration| that counts as a deliberate shake
const SHAKE_FEED_COOLDOWN_MS = 1400; // min gap between shake-triggered food spills

const FISH_PALETTES = [
  { body: "#ffb347", belly: "#ffe2a8", fin: "#ff8a3c" }, // goldfish
  { body: "#46d4ff", belly: "#bff2ff", fin: "#2aa7ff" }, // tropical cyan
  { body: "#b07bff", belly: "#e7d6ff", fin: "#8a5cff" }, // violet
  { body: "#5be5a0", belly: "#c9ffe6", fin: "#2fc985" }, // mint
  { body: "#ff7aa8", belly: "#ffd6e4", fin: "#ff4f86" }, // coral
];

let canvas = null;
let ctx = null;
let enabled = false;
let runtimeAllowed = false;
let initialized = false;

let cssW = 0;
let cssH = 0;
let dpr = 1;

let fish = [];
let food = [];
let bubbles = [];
let pendingFoodAvatars = [];

let rafId = 0;
let lastTs = 0;

let tilt = 0; // smoothed -1..1, from device orientation
let tiltTarget = 0;
let tiltImpulse = 0;
let tiltListening = false;
let tiltPermissionAsked = false;
let motionListening = false;
let motionPermissionAsked = false;
let lastMotionX = null;
let lastAccX = null;
let lastAccY = null;
let lastAccZ = null;
let lastShakeFeedAt = 0;
let lastScatterAt = 0;
let feedProvider = null;
// Telegram Mini App sensor API (Bot API 8.0+). iOS Telegram blocks the W3C
// devicemotion/deviceorientation events, so we drive tilt/shake from these.
let tgAccelStarted = false;
let tgOrientStarted = false;
let tgSensorListeners = false;

const foodImages = new Map();

// app.js registers a provider that returns the current chart avatars so a shake
// can feed the fish on demand, before the round even ends.
export function setAquariumShakeFeeder(fn) {
  feedProvider = typeof fn === "function" ? fn : null;
}

let waterGrad = null;
let waterGradH = 0;
let domLayer = null;
let domFish = [];
let domFood = [];
let domRafId = 0;
let domLastTs = 0;
let domIntervalId = 0;
let domLastFrameAt = 0;

function readEnabledFlag() {
  try {
    const raw = window.localStorage?.getItem(STORAGE_KEY);
    const hasNewChoice = window.localStorage?.getItem(USER_CHOICE_KEY) === "1";
    if (isTelegramMiniApp() && raw === "0" && !hasNewChoice) {
      return true;
    }
    return raw === null || raw === undefined ? true : raw === "1";
  } catch {
    return true;
  }
}

function reducedMotion() {
  return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
}

function isTelegramMiniApp() {
  return Boolean(window.Telegram?.WebApp);
}

function aquariumHaptic(style = "light") {
  try {
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.(style);
  } catch {
    // ignore on platforms without haptics
  }
}

function canAnimateAquarium() {
  // Telegram on iOS runs inside WKWebView. Some builds can report the document
  // as hidden while the Mini App is visibly active, which killed the fish loop.
  return enabled && runtimeAllowed && !reducedMotion() && (!document.hidden || isTelegramMiniApp());
}

function canAnimateDomAquarium() {
  // DOM fallback is the compatibility path for iOS Telegram WebView. Do not
  // gate it on prefers-reduced-motion: on some iPhones Telegram reports reduce
  // by default, which prevented fish from being created at all.
  return enabled && runtimeAllowed && shouldUseDomAquarium() && (!document.hidden || isTelegramMiniApp());
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

export function isAquariumEnabled() {
  return enabled;
}

export function setAquariumEnabled(next) {
  enabled = Boolean(next);
  try {
    window.localStorage?.setItem(STORAGE_KEY, enabled ? "1" : "0");
    window.localStorage?.setItem(USER_CHOICE_KEY, "1");
  } catch {
    // storage can be unavailable in hardened webviews
  }

  if (enabled) {
    requestTiltAccess();
    primeAquarium();
  } else {
    stopLoop();
    stopDomLoop();
    stopTelegramSensors();
    fish = [];
    food = [];
    bubbles = [];
    pendingFoodAvatars = [];
    foodImages.clear();
    clearDomAquarium();
    clearCanvas();
  }
  return enabled;
}

function clearAquariumRuntime() {
  stopLoop();
  stopDomLoop();
  stopTelegramSensors();
  fish = [];
  food = [];
  bubbles = [];
  pendingFoodAvatars = [];
  foodImages.clear();
  clearDomAquarium();
  clearCanvas();
}

export function setAquariumRuntimeAllowed(next) {
  const allowed = Boolean(next);
  if (runtimeAllowed === allowed) {
    return runtimeAllowed;
  }
  runtimeAllowed = allowed;
  if (!runtimeAllowed) {
    clearAquariumRuntime();
  } else if (enabled) {
    primeAquarium(10);
  }
  return runtimeAllowed;
}

function shouldUseDomAquarium() {
  if (!isTelegramMiniApp()) {
    return false;
  }
  const platform = String(window.Telegram?.WebApp?.platform || "").toLowerCase();
  const ua = String(window.navigator?.userAgent || "").toLowerCase();
  return platform.includes("ios")
    || platform.includes("mac")
    || platform.includes("tdesktop")
    || /iphone|ipad|ipod|macintosh|mac os/.test(ua);
}

function ensureDomLayer() {
  if (!shouldUseDomAquarium()) {
    return null;
  }
  if (domLayer?.isConnected) {
    return domLayer;
  }
  const host = document.querySelector(".chart-frame");
  if (!host) {
    return null;
  }
  domLayer = document.createElement("div");
  domLayer.className = "aquarium-dom-layer";
  domLayer.setAttribute("aria-hidden", "true");
  host.appendChild(domLayer);
  domFish = [];
  domFood = [];
  return domLayer;
}

function measureDomLayer() {
  const layer = ensureDomLayer();
  if (!layer) {
    return null;
  }
  const rect = layer.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) {
    return null;
  }
  return { layer, width: rect.width, height: rect.height };
}

function primeDomAquarium() {
  if (!enabled) {
    return false;
  }
  const measured = measureDomLayer();
  if (!measured) {
    return false;
  }
  const { layer, width, height } = measured;
  if (domFish.length && layer.querySelector(".aquarium-dom-fish")) {
    startDomLoop();
    return true;
  }
  layer.querySelectorAll(".aquarium-dom-fish").forEach((node) => node.remove());
  const fishCount = 5;
  const palettes = ["gold", "cyan", "violet", "mint", "coral"];
  for (let i = 0; i < fishCount; i += 1) {
    const el = document.createElement("span");
    const scale = 0.76 + i * 0.07;
    el.className = `aquarium-dom-fish fish-${i + 1} ${palettes[i] || "gold"}`;
    el.innerHTML = DOM_FISH_SVG;
    layer.appendChild(el);
    domFish.push({
      el,
      x: rand(width * 0.1, width * 0.9),
      y: rand(height * 0.18, height * 0.9),
      vx: rand(-1, 1) * 14 || 8,
      vy: rand(-5, 5),
      scale,
      speed: rand(13, 25),
      dir: Math.random() > 0.5 ? 1 : -1,
      target: null,
      satietyUntil: 0,
      wanderUntil: 0,
      wanderVx: rand(-1, 1),
      wanderVy: rand(-0.45, 0.45),
    });
  }
  startDomLoop();
  return true;
}

function clearDomAquarium() {
  stopDomLoop();
  domFish = [];
  domFood = [];
  domLastTs = 0;
  domLastFrameAt = 0;
  if (domLayer) {
    domLayer.remove();
    domLayer = null;
  }
}

function appendDomFood(avatars) {
  if (!enabled || !Array.isArray(avatars) || !avatars.length) {
    return;
  }
  const layer = ensureDomLayer();
  if (!layer) {
    return;
  }
  primeDomAquarium();
  avatars.slice(-36).forEach((avatar, index) => {
    const measured = measureDomLayer();
    if (!measured) {
      return;
    }
    const crumb = document.createElement("span");
    const side = avatar.side === "NO" ? "NO" : "YES";
    const baseX = Math.max(7, Math.min(93, Number(avatar.xFrac || 0.5) * 100)) / 100 * measured.width;
    const baseY = Math.max(9, Math.min(66, Number(avatar.yFrac || 0.45) * 100)) / 100 * measured.height;
    const x = Math.max(8, Math.min(measured.width - 8, baseX + rand(-18, 18)));
    const y = Math.max(8, Math.min(measured.height - 8, baseY + rand(-12, 10)));
    const url = String(avatar.url || "").trim();
    crumb.className = `aquarium-dom-food ${side === "NO" ? "no" : "yes"} ${url ? "avatar" : ""}`;
    if (url) {
      crumb.style.backgroundImage = `url("${url.replace(/"/g, "%22")}")`;
      crumb.style.backgroundSize = "cover";
      crumb.style.backgroundPosition = "center";
    }
    layer.appendChild(crumb);
    domFood.push({
      el: crumb,
      x,
      y,
      vx: rand(-34, 34),
      vy: rand(-12, 24),
      r: rand(url ? 4.2 : 3.2, url ? 6.2 : 4.8),
      restY: rand(measured.height * 0.34, measured.height * 0.95),
      settled: false,
      bornAt: Date.now() + Math.min(900, index * 24),
      wobble: Math.random() * Math.PI * 2,
      eat: 0,
      claimedBy: null,
      side,
    });
  });
  while (domFood.length > 72) {
    domFood.shift()?.el?.remove();
  }
  startDomLoop();
}

function domBandTop(height) {
  return height * 0.14;
}

function domBandBottom(height) {
  return height * 0.975;
}

function nearestDomFoodFor(fishItem) {
  const now = Date.now();
  let best = null;
  let bestDist = 240 * 240;
  for (const crumb of domFood) {
    if (crumb.eat > 0 || now < crumb.bornAt + FOOD_ARM_MS) {
      continue;
    }
    if (crumb.claimedBy && crumb.claimedBy !== fishItem) {
      continue;
    }
    const dx = crumb.x - fishItem.x;
    const dy = crumb.y - fishItem.y;
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      best = crumb;
    }
  }
  return best;
}

function updateDomFood(dt, width, height) {
  // A *weak* steady current from holding the phone tilted, so crumbs don't all
  // stream off in one direction. Per-crumb jitter + drag + wall bounce make each
  // crumb drift independently and chaotically.
  const current = tilt * 18;
  const now = Date.now();
  for (const crumb of domFood) {
    if (now < crumb.bornAt) {
      continue;
    }
    if (crumb.eat > 0) {
      crumb.eat += dt / (EAT_MS / 1000);
      // Gulp: ease the crumb toward the mouth that is eating it.
      if (Number.isFinite(crumb.biteX)) {
        crumb.x += (crumb.biteX - crumb.x) * Math.min(1, dt * 5);
        crumb.y += (crumb.biteY - crumb.y) * Math.min(1, dt * 5);
      }
      continue;
    }
    if (!crumb.settled) {
      crumb.vy += 24 * dt; // slow sink
      crumb.vy = Math.min(crumb.vy, 36);
      crumb.vx += (current + (Math.random() - 0.5) * 40) * dt;
      crumb.vx *= 0.92;
      crumb.x += crumb.vx * dt;
      crumb.y += crumb.vy * dt;
      if (crumb.y >= crumb.restY && Math.abs(crumb.vy) < 14) {
        crumb.vy = 0;
        crumb.settled = true;
      }
    } else {
      // Floating: weak current + independent brownian jitter + gentle buoyancy,
      // heavily damped so it drifts slowly like a crumb suspended in water.
      crumb.vx += (current + (Math.random() - 0.5) * 26) * dt;
      crumb.vy += ((crumb.restY - crumb.y) * 0.9 + (Math.random() - 0.5) * 22) * dt;
      crumb.vx *= 0.9;
      crumb.vy *= 0.9;
      crumb.x += crumb.vx * dt;
      crumb.y += crumb.vy * dt;
    }
    // Bounce off the walls (don't stick), so a shake disperses crumbs around.
    if (crumb.x < 6) {
      crumb.x = 6;
      crumb.vx = Math.abs(crumb.vx) * 0.6;
    } else if (crumb.x > width - 6) {
      crumb.x = width - 6;
      crumb.vx = -Math.abs(crumb.vx) * 0.6;
    }
    if (crumb.y < 6) {
      crumb.y = 6;
      crumb.vy = Math.abs(crumb.vy) * 0.5;
    } else if (crumb.y > height - 4) {
      crumb.y = height - 4;
      crumb.vy = -Math.abs(crumb.vy) * 0.5;
    }
  }
  domFood = domFood.filter((crumb) => {
    const keep = crumb.eat < 1;
    if (!keep) {
      crumb.el?.remove();
    }
    return keep;
  });
}

function updateDomFish(dt, width, height) {
  const now = Date.now();
  const top = domBandTop(height);
  const bottom = domBandBottom(height);
  for (const f of domFish) {
    if (f.target && (f.target.eat > 0 || !domFood.includes(f.target))) {
      if (f.target?.claimedBy === f) {
        f.target.claimedBy = null;
      }
      f.target = null;
    }
    if (!f.target && now > f.satietyUntil) {
      const prey = nearestDomFoodFor(f);
      if (prey) {
        prey.claimedBy = f;
        f.target = prey;
      }
    }

    let ax = 0;
    let ay = 0;
    if (f.target) {
      const dx = f.target.x - f.x;
      const dy = f.target.y - f.y;
      const dist = Math.hypot(dx, dy) || 1;
      // Hungry, eager dash toward the crumb.
      ax = (dx / dist) * f.speed * 2.6;
      ay = (dy / dist) * f.speed * 2.6;
      if (dist < 12 + f.target.r) {
        f.target.biteX = f.x; // crumb gets gulped toward the mouth
        f.target.biteY = f.y;
        f.target.eat = Math.max(f.target.eat, 0.0001);
        f.target.claimedBy = null;
        f.target = null;
        f.satietyUntil = now + rand(450, 1500);
        playAquariumEat();
      }
    } else {
      // Smoothly drifting heading gives natural curved cruising, not jerky turns.
      if (f.heading === undefined) {
        f.heading = Math.atan2(f.vy, f.vx || f.dir || 1);
      }
      f.heading += (Math.random() - 0.5) * 1.6 * dt;
      if (now > f.wanderUntil) {
        f.wanderUntil = now + rand(1500, 3400);
        f.heading += (Math.random() - 0.5) * 1.1; // occasional sharper turn
      }
      const cruise = f.speed * 0.82;
      ax = Math.cos(f.heading) * cruise + tilt * 12;
      ay = Math.sin(f.heading) * cruise * 0.55;
    }

    // Gentle separation so the school does not collapse into one blob.
    for (const other of domFish) {
      if (other === f) {
        continue;
      }
      const sx = f.x - other.x;
      const sy = f.y - other.y;
      const d2 = sx * sx + sy * sy;
      if (d2 > 0.01 && d2 < 34 * 34) {
        const d = Math.sqrt(d2);
        ax += (sx / d) * f.speed * 0.9;
        ay += (sy / d) * f.speed * 0.9;
      }
    }

    const startled = now < (f.startleUntil || 0);
    f.vx += ax * dt;
    f.vy += ay * dt;
    const sp = Math.hypot(f.vx, f.vy);
    const maxSp = f.speed * (startled ? 3 : f.target ? 2.7 : 1.25);
    if (sp > maxSp) {
      f.vx = (f.vx / sp) * maxSp;
      f.vy = (f.vy / sp) * maxSp;
    }
    f.vx *= startled ? 0.99 : 0.96;
    f.vy *= startled ? 0.985 : 0.94;
    f.x += f.vx * dt;
    f.y += f.vy * dt;

    const margin = 16;
    if (f.x < margin) {
      f.x = margin;
      f.vx = Math.abs(f.vx);
    } else if (f.x > width - margin) {
      f.x = width - margin;
      f.vx = -Math.abs(f.vx);
    }
    if (f.y < top) {
      f.y = top;
      f.vy = Math.abs(f.vy) * 0.6;
    } else if (f.y > bottom) {
      f.y = bottom;
      f.vy = -Math.abs(f.vy) * 0.6;
    }
    if (Math.abs(f.vx) > 1.4) {
      f.dir = f.vx >= 0 ? 1 : -1;
    }
  }
}

function renderDomAquarium() {
  const tNow = Date.now();
  for (const f of domFish) {
    if (f.bobPhase === undefined) {
      f.bobPhase = Math.random() * Math.PI * 2;
      f.bobRate = rand(1.6, 2.6);
    }
    const sp = Math.hypot(f.vx, f.vy);
    const bob = Math.sin((tNow / 1000) * f.bobRate + f.bobPhase) * 1.4;
    const angle = Math.max(-0.2, Math.min(0.2, f.vy * 0.018));
    f.el.style.transform = `translate3d(${f.x.toFixed(1)}px, ${(f.y + bob).toFixed(1)}px, 0) translate(-50%, -50%) scaleX(${f.dir}) scale(${f.scale}) rotate(${angle.toFixed(3)}rad)`;
    // Tail beats faster as the fish speeds up / darts.
    const tailMs = Math.max(250, 720 - sp * 9);
    f.el.style.setProperty("--tail-ms", `${tailMs.toFixed(0)}ms`);
  }
  const now = Date.now();
  for (const crumb of domFood) {
    const bornAlpha = now < crumb.bornAt ? 0 : 1;
    const shrink = crumb.eat > 0 ? Math.max(0, 1 - crumb.eat) : 1;
    crumb.el.style.opacity = String(Math.min(1, bornAlpha * (0.9 + shrink * 0.1)));
    crumb.el.style.width = `${(crumb.r * 2 * shrink).toFixed(1)}px`;
    crumb.el.style.height = `${(crumb.r * 2 * shrink).toFixed(1)}px`;
    crumb.el.style.transform = `translate3d(${(crumb.x - crumb.r).toFixed(1)}px, ${(crumb.y - crumb.r).toFixed(1)}px, 0) scale(${Math.max(0.2, shrink).toFixed(3)})`;
  }
}

function stepDomAquarium(ts) {
  const measured = measureDomLayer();
  if (!measured) {
    return false;
  }
  if (domLastTs && ts - domLastTs < FRAME_MS) {
    return true;
  }
  const dt = domLastTs ? Math.min(0.05, (ts - domLastTs) / 1000) : 0.033;
  domLastTs = ts;
  domLastFrameAt = Date.now();
  tilt += (tiltTarget - tilt) * Math.min(1, dt * 4);
  tiltImpulse *= Math.max(0, 1 - dt * 2.1);
  updateDomFood(dt, measured.width, measured.height);
  updateDomFish(dt, measured.width, measured.height);
  renderDomAquarium();
  return true;
}

function domFrame(ts) {
  domRafId = 0;
  if (!canAnimateDomAquarium()) {
    return;
  }
  if (!stepDomAquarium(ts)) {
    window.setTimeout(() => startDomLoop(), 300);
    return;
  }
  if (enabled && (domFish.length || domFood.length)) {
    domRafId = requestAnimationFrame(domFrame);
  }
}

function startDomLoop() {
  if (!canAnimateDomAquarium()) {
    return;
  }
  if (!domRafId) {
    domLastTs = 0;
    domRafId = requestAnimationFrame(domFrame);
  }
  if (!domIntervalId) {
    domIntervalId = window.setInterval(() => {
      if (!canAnimateDomAquarium()) {
        return;
      }
      const now = Date.now();
      // iOS Telegram can pause or starve rAF while a WebApp remains visible.
      // Step manually only when rAF has not advanced recently.
      if (!domLastFrameAt || now - domLastFrameAt > 180) {
        if (!stepDomAquarium(performance.now())) {
          domLastTs = 0;
        }
      }
    }, 120);
  }
}

function stopDomLoop() {
  if (domRafId) {
    cancelAnimationFrame(domRafId);
    domRafId = 0;
  }
  if (domIntervalId) {
    window.clearInterval(domIntervalId);
    domIntervalId = 0;
  }
}

function getFoodImage(url) {
  if (!url) {
    return null;
  }
  const cached = foodImages.get(url);
  if (cached) {
    return cached.ok ? cached.img : null;
  }
  // Bounded cache: drop the oldest entry once it grows large (Maps keep
  // insertion order), so a long session with many distinct bettors can't leak.
  if (foodImages.size > 80) {
    const oldest = foodImages.keys().next().value;
    if (oldest !== undefined) {
      foodImages.delete(oldest);
    }
  }
  const img = new Image();
  const entry = { img, ok: false };
  foodImages.set(url, entry);
  img.decoding = "async";
  img.onload = () => {
    entry.ok = true;
  };
  img.onerror = () => {
    entry.ok = false;
    entry.failed = true;
  };
  img.src = url;
  return null;
}

function measure() {
  // Re-acquire the canvas if it was ever detached (defensive: the chart area
  // is static markup, but this keeps the layer alive through any DOM rebuild).
  if (!canvas || !canvas.isConnected) {
    const el = document.getElementById("aquariumCanvas");
    if (el instanceof HTMLCanvasElement) {
      canvas = el;
      ctx = canvas.getContext("2d");
      waterGrad = null;
    }
  }
  if (!canvas || !ctx) {
    return false;
  }
  const rect = canvas.getBoundingClientRect();
  let width = rect.width;
  let height = rect.height;

  if (width < 2 || height < 2) {
    const host = canvas.closest?.(".chart-frame") || canvas.parentElement;
    const hostRect = host?.getBoundingClientRect?.();
    width = hostRect?.width || canvas.offsetWidth || width;
    height = hostRect?.height || canvas.offsetHeight || height;
  }

  if (width < 2 || height < 2) {
    return false;
  }
  dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  cssW = width;
  cssH = height;
  const pw = Math.round(cssW * dpr);
  const ph = Math.round(cssH * dpr);
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw;
    canvas.height = ph;
  }
  return true;
}

function bandTop() {
  return cssH * 0.16;
}

function bandBottom() {
  return cssH * 0.985;
}

function ensureFish() {
  if (!measure()) {
    // Defer until the canvas has a real size.
    return false;
  }
  if (fish.length) {
    return true;
  }
  const count = Math.round(rand(FISH_MIN, FISH_MAX));
  for (let i = 0; i < count; i += 1) {
    const palette = FISH_PALETTES[Math.floor(Math.random() * FISH_PALETTES.length)];
    const size = rand(11, 16);
    fish.push({
      x: rand(cssW * 0.2, cssW * 0.8),
      y: rand(bandTop() + size, bandBottom() - size),
      vx: rand(-1, 1) * 14 || 10,
      vy: rand(-4, 4),
      size,
      palette,
      speed: rand(16, 26),
      tailPhase: Math.random() * Math.PI * 2,
      dir: Math.random() > 0.5 ? 1 : -1,
      target: null,
      satietyUntil: 0,
      wanderUntil: 0,
      wanderVx: rand(-1, 1),
      wanderVy: rand(-0.4, 0.4),
    });
  }
  if (!bubbles.length) {
    for (let i = 0; i < 4; i += 1) {
      bubbles.push(resetBubble({}, true));
    }
  }
  return fish.length > 0;
}

export function primeAquarium(retries = 10) {
  primeDomAquarium();
  if (!canAnimateAquarium()) {
    return false;
  }
  if (ensureFish()) {
    flushPendingFood();
    startLoop();
    return true;
  }
  if (retries > 0) {
    window.setTimeout(() => {
      primeAquarium(retries - 1);
    }, 180);
  }
  return false;
}

function resetBubble(b, seed) {
  b.x = rand(cssW * 0.1, cssW * 0.9);
  b.y = seed ? rand(bandTop(), bandBottom()) : bandBottom();
  b.r = rand(0.8, 2.1);
  b.speed = rand(6, 14);
  b.drift = rand(-0.4, 0.4);
  b.alpha = rand(0.05, 0.16);
  return b;
}

function appendFood(avatars) {
  if (!Array.isArray(avatars) || !avatars.length) {
    return;
  }
  // Keep the most recent crumbs if a round had a huge crowd.
  const picked = avatars.slice(-MAX_FOOD);
  const now = Date.now();
  for (const a of picked) {
    const x = Math.max(6, Math.min(cssW - 6, Number(a.xFrac) * cssW));
    const y = Math.max(2, Math.min(cssH - 6, Number(a.yFrac) * cssH));
    food.push({
      x,
      y,
      vx: rand(-28, 28),
      vy: rand(-10, 24),
      r: rand(a.url ? 4.4 : 3.4, a.url ? 6.2 : 5),
      restY: rand(cssH * 0.34, bandBottom() - 3),
      settled: false,
      bornAt: now,
      wobble: Math.random() * Math.PI * 2,
      eat: 0,
      claimedBy: null,
      url: String(a.url || ""),
      color: a.color || "#8aa",
      initial: String(a.initial || "?"),
      side: a.side === "YES" ? "YES" : "NO",
    });
  }
  while (food.length > MAX_FOOD) {
    food.shift();
  }
}

function queuePendingFood(avatars) {
  pendingFoodAvatars.push(...avatars);
  if (pendingFoodAvatars.length > MAX_FOOD) {
    pendingFoodAvatars = pendingFoodAvatars.slice(-MAX_FOOD);
  }
}

function flushPendingFood() {
  if (!pendingFoodAvatars.length || !measure()) {
    return false;
  }
  const queued = pendingFoodAvatars;
  pendingFoodAvatars = [];
  appendFood(queued);
  return true;
}

// Convert a snapshot of on-chart avatars into falling food crumbs.
// avatars: [{ xFrac, yFrac, url, color, initial, side }]
export function spillAquariumFood(avatars) {
  if (!enabled || !Array.isArray(avatars) || !avatars.length) {
    return;
  }
  playAquariumFood(); // soft sprinkle as the crumbs hit the water
  appendDomFood(avatars);
  if (!measure()) {
    queuePendingFood(avatars);
    primeAquarium(16);
    return;
  }
  ensureFish();
  appendFood(avatars);
  if (enabled) {
    startLoop();
  }
}

// Tilt drift, fed from W3C deviceorientation (degrees) or Telegram (converted).
function ingestOrientationGamma(gammaDeg) {
  if (!Number.isFinite(gammaDeg)) {
    return;
  }
  tiltTarget = Math.max(-1, Math.min(1, gammaDeg / 34));
}

// Shake detection + impulse, fed from W3C devicemotion or Telegram accelerometer.
function ingestAccel(x, y, z) {
  if (!Number.isFinite(x)) {
    return;
  }
  const delta = lastMotionX === null ? 0 : x - lastMotionX;
  lastMotionX = x;
  tiltImpulse = Math.max(-2.4, Math.min(2.4, tiltImpulse + delta * 0.12));

  // Shake = a sharp jerk across the axes -> feed the fish and scatter the crumbs.
  if (Number.isFinite(y) && Number.isFinite(z) && lastAccX !== null) {
    const jerk = Math.abs(x - lastAccX) + Math.abs(y - lastAccY) + Math.abs(z - lastAccZ);
    if (jerk > SHAKE_JERK) {
      onShake(Math.min(3, jerk / SHAKE_JERK));
    }
  }
  lastAccX = x;
  lastAccY = y;
  lastAccZ = z;
}

function tiltHandler(event) {
  ingestOrientationGamma(Number(event.gamma)); // degrees
}

function motionHandler(event) {
  const a = event.accelerationIncludingGravity || event.acceleration || {};
  ingestAccel(Number(a.x), Number(a.y), Number(a.z));
}

// Telegram Mini App native sensors — the only path that works in iOS Telegram.
function startTelegramSensors() {
  const tg = window.Telegram?.WebApp;
  if (!tg) {
    return false;
  }
  if (!tgSensorListeners && typeof tg.onEvent === "function") {
    tg.onEvent("accelerometerChanged", () => {
      const a = tg.Accelerometer || {};
      ingestAccel(Number(a.x), Number(a.y), Number(a.z));
    });
    tg.onEvent("deviceOrientationChanged", () => {
      const o = tg.DeviceOrientation || {};
      // Telegram reports gamma in radians; our tilt math expects degrees.
      ingestOrientationGamma(Number(o.gamma) * (180 / Math.PI));
    });
    tgSensorListeners = true;
  }
  let started = false;
  if (typeof tg.Accelerometer?.start === "function" && !tgAccelStarted) {
    tgAccelStarted = true;
    try {
      tg.Accelerometer.start({ refresh_rate: 50 });
      started = true;
    } catch {
      tgAccelStarted = false;
    }
  }
  if (typeof tg.DeviceOrientation?.start === "function" && !tgOrientStarted) {
    tgOrientStarted = true;
    try {
      tg.DeviceOrientation.start({ refresh_rate: 60 });
      started = true;
    } catch {
      tgOrientStarted = false;
    }
  }
  return started;
}

function stopTelegramSensors() {
  const tg = window.Telegram?.WebApp;
  if (!tg) {
    return;
  }
  if (tgAccelStarted) {
    try {
      tg.Accelerometer?.stop?.();
    } catch {
      // ignore
    }
    tgAccelStarted = false;
  }
  if (tgOrientStarted) {
    try {
      tg.DeviceOrientation?.stop?.();
    } catch {
      // ignore
    }
    tgOrientStarted = false;
  }
}

function onShake(strength = 1) {
  if (!enabled || !runtimeAllowed) {
    return;
  }
  const now = Date.now();
  // Kick the crumbs / spook the fish, but throttle so a sustained shake (the
  // sensor fires many times a second) doesn't re-fling everything every frame.
  if (now - lastScatterAt > 220) {
    lastScatterAt = now;
    scatterFood(strength);
    startleFish(strength);
  }
  // ...and only drop a fresh handful of food on a longer cooldown.
  if (now - lastShakeFeedAt < SHAKE_FEED_COOLDOWN_MS) {
    return;
  }
  lastShakeFeedAt = now;
  const avatars = feedProvider ? feedProvider() : null;
  if (Array.isArray(avatars) && avatars.length) {
    aquariumHaptic("medium"); // buzz as the food drops in
    spillAquariumFood(avatars);
  }
}

function scatterFood(strength = 1) {
  // SET (not accumulate) bounded velocities, in a RANDOM direction per crumb, so
  // a shake bursts them apart every which way instead of all in one direction.
  const spread = 70 + strength * 45;
  const kick = (crumb) => {
    crumb.settled = false;
    const angle = Math.random() * Math.PI * 2;
    const mag = spread * (0.5 + Math.random() * 0.6);
    crumb.vx = Math.cos(angle) * mag;
    crumb.vy = Math.sin(angle) * mag - 18; // slight upward bias, then re-sinks
  };
  for (const crumb of food) {
    if (crumb.eat > 0) {
      continue;
    }
    kick(crumb);
    crumb.restY = rand(cssH * 0.34, bandBottom() - 3);
  }
  for (const crumb of domFood) {
    if (crumb.eat > 0) {
      continue;
    }
    kick(crumb);
  }
}

function startleFish(strength = 1) {
  const burst = 1 + strength * 0.8;
  for (const f of fish) {
    f.startleUntil = Date.now() + 520 + strength * 220;
    f.vx += (f.vx >= 0 ? 1 : -1) * f.speed * burst + (Math.random() - 0.5) * 30;
    f.vy += (Math.random() - 0.5) * f.speed * burst;
    f.target = null;
  }
  for (const f of domFish) {
    f.startleUntil = Date.now() + 520 + strength * 220;
    f.vx += (f.vx >= 0 ? 1 : -1) * f.speed * burst + (Math.random() - 0.5) * 30;
    f.vy += (Math.random() - 0.5) * f.speed * burst;
    f.target = null;
  }
}

function requestTiltAccess() {
  // Telegram's native sensors are the only ones that work inside iOS Telegram.
  startTelegramSensors();

  const addOrientation = () => {
    if (tiltListening) {
      return;
    }
    tiltListening = true;
    window.addEventListener("deviceorientation", tiltHandler, { passive: true });
  };
  const addMotion = () => {
    if (motionListening || typeof window.DeviceMotionEvent === "undefined") {
      return;
    }
    motionListening = true;
    window.addEventListener("devicemotion", motionHandler, { passive: true });
  };

  if (typeof window.DeviceOrientationEvent !== "undefined") {
    const req = window.DeviceOrientationEvent?.requestPermission;
    if (typeof req === "function") {
      if (!tiltPermissionAsked) {
        tiltPermissionAsked = true;
        // iOS 13+: needs a user gesture; setAquariumEnabled is called from a tap.
        req.call(window.DeviceOrientationEvent)
          .then((state) => {
            if (state === "granted") {
              addOrientation();
            }
          })
          .catch(() => undefined);
      }
    } else {
      addOrientation();
    }
  }

  const motionReq = window.DeviceMotionEvent?.requestPermission;
  if (typeof motionReq === "function") {
    if (!motionPermissionAsked) {
      motionPermissionAsked = true;
      motionReq.call(window.DeviceMotionEvent)
        .then((state) => {
          if (state === "granted") {
            addMotion();
          }
        })
        .catch(() => undefined);
    }
  } else {
    addMotion();
  }
}

function updateFood(dt) {
  // Weak steady current (tilt) + per-crumb jitter + drag + wall bounce, so crumbs
  // drift slowly and chaotically instead of streaming together in one direction.
  const current = tilt * 18;
  const bottom = bandBottom();
  for (const f of food) {
    if (f.eat > 0) {
      f.eat += dt / (EAT_MS / 1000);
      if (Number.isFinite(f.biteX)) {
        f.x += (f.biteX - f.x) * Math.min(1, dt * 5);
        f.y += (f.biteY - f.y) * Math.min(1, dt * 5);
      }
      continue;
    }
    if (!f.settled) {
      f.vy += 24 * dt; // slow sink
      f.vy = Math.min(f.vy, 36);
      f.vx += (current + (Math.random() - 0.5) * 40) * dt;
      f.vx *= 0.92;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      if (f.y >= f.restY && Math.abs(f.vy) < 14) {
        f.vy = 0;
        f.settled = true;
      }
    } else {
      f.vx += (current + (Math.random() - 0.5) * 26) * dt;
      f.vy += ((f.restY - f.y) * 0.9 + (Math.random() - 0.5) * 22) * dt;
      f.vx *= 0.9;
      f.vy *= 0.9;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
    }
    if (f.x < 5) {
      f.x = 5;
      f.vx = Math.abs(f.vx) * 0.6;
    } else if (f.x > cssW - 5) {
      f.x = cssW - 5;
      f.vx = -Math.abs(f.vx) * 0.6;
    }
    if (f.y < bandTop()) {
      f.y = bandTop();
      f.vy = Math.abs(f.vy) * 0.5;
    } else if (f.y > bottom) {
      f.y = bottom;
      f.vy = -Math.abs(f.vy) * 0.5;
    }
  }
  // Remove fully eaten crumbs.
  food = food.filter((f) => f.eat < 1);
}

function nearestFoodFor(f) {
  const now = Date.now();
  let best = null;
  let bestDist = 240 * 240; // perception radius squared
  for (const crumb of food) {
    if (crumb.eat > 0) {
      continue;
    }
    if (now - crumb.bornAt < FOOD_ARM_MS) {
      continue; // let fresh crumbs settle first
    }
    if (crumb.claimedBy && crumb.claimedBy !== f) {
      continue;
    }
    const dx = crumb.x - f.x;
    const dy = crumb.y - f.y;
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      best = crumb;
    }
  }
  return best;
}

function updateFish(dt) {
  const now = Date.now();
  const top = bandTop();
  const bottom = bandBottom();
  for (const f of fish) {
    // Drop a stale/eaten target.
    if (f.target && (f.target.eat > 0 || !food.includes(f.target))) {
      if (f.target?.claimedBy === f) {
        f.target.claimedBy = null;
      }
      f.target = null;
    }
    // Hunt only when not recently fed.
    if (!f.target && now > f.satietyUntil) {
      const prey = nearestFoodFor(f);
      if (prey) {
        prey.claimedBy = f;
        f.target = prey;
      }
    }

    let ax = 0;
    let ay = 0;
    if (f.target) {
      const dx = f.target.x - f.x;
      const dy = f.target.y - f.y;
      const dist = Math.hypot(dx, dy) || 1;
      // Hungry, eager dash toward the crumb.
      ax = (dx / dist) * f.speed * 2.6;
      ay = (dy / dist) * f.speed * 2.6;
      if (dist < f.size * 0.9 + f.target.r) {
        f.target.biteX = f.x; // crumb gets gulped toward the mouth
        f.target.biteY = f.y;
        f.target.eat = Math.max(f.target.eat, 0.0001); // begin the bite
        f.target.claimedBy = null;
        f.target = null;
        f.satietyUntil = now + rand(450, 1500); // brief pause, then hunt again
        playAquariumEat();
      }
    } else {
      // Smoothly drifting heading -> natural curved cruising instead of jerks.
      if (f.heading === undefined) {
        f.heading = Math.atan2(f.vy, f.vx || f.dir || 1);
      }
      f.heading += (Math.random() - 0.5) * 1.6 * dt;
      if (now > f.wanderUntil) {
        f.wanderUntil = now + rand(1500, 3400);
        f.heading += (Math.random() - 0.5) * 1.1;
      }
      const cruise = f.speed * 0.74;
      ax = Math.cos(f.heading) * cruise + tilt * 10;
      ay = Math.sin(f.heading) * cruise * 0.55;
    }

    // Gentle separation between schoolmates.
    for (const other of fish) {
      if (other === f) {
        continue;
      }
      const sx = f.x - other.x;
      const sy = f.y - other.y;
      const d2 = sx * sx + sy * sy;
      const near = (f.size + other.size) * 1.4;
      if (d2 > 0.01 && d2 < near * near) {
        const d = Math.sqrt(d2);
        ax += (sx / d) * f.speed * 0.9;
        ay += (sy / d) * f.speed * 0.9;
      }
    }

    const startled = now < (f.startleUntil || 0);
    f.vx += ax * dt;
    f.vy += ay * dt;
    // Speed clamp.
    const sp = Math.hypot(f.vx, f.vy);
    const maxSp = f.speed * (startled ? 3 : f.target ? 2.7 : 1.25);
    if (sp > maxSp) {
      f.vx = (f.vx / sp) * maxSp;
      f.vy = (f.vy / sp) * maxSp;
    }
    f.vx *= startled ? 0.99 : 0.96;
    f.vy *= startled ? 0.985 : 0.94;

    f.x += f.vx * dt;
    f.y += f.vy * dt;

    // Keep fish inside the aquarium band; bounce softly off walls.
    if (f.x < f.size) {
      f.x = f.size;
      f.vx = Math.abs(f.vx);
    } else if (f.x > cssW - f.size) {
      f.x = cssW - f.size;
      f.vx = -Math.abs(f.vx);
    }
    if (f.y < top + f.size * 0.5) {
      f.y = top + f.size * 0.5;
      f.vy = Math.abs(f.vy) * 0.6;
    } else if (f.y > bottom - f.size * 0.5) {
      f.y = bottom - f.size * 0.5;
      f.vy = -Math.abs(f.vy) * 0.6;
    }

    if (Math.abs(f.vx) > 1.5) {
      f.dir = f.vx >= 0 ? 1 : -1;
    }
    f.tailPhase += dt * (5 + Math.min(12, sp * 0.25));
  }
}

function updateBubbles(dt) {
  for (const b of bubbles) {
    b.y -= b.speed * dt;
    b.x += b.drift;
    if (b.y < bandTop() - 4) {
      resetBubble(b, false);
    }
  }
}

function drawWater() {
  const top = bandTop();
  if (!waterGrad || waterGradH !== cssH) {
    waterGrad = ctx.createLinearGradient(0, top, 0, cssH);
    waterGrad.addColorStop(0, "rgba(53,246,255,0)");
    waterGrad.addColorStop(0.55, "rgba(45,167,255,0.05)");
    waterGrad.addColorStop(1, "rgba(45,120,200,0.12)");
    waterGradH = cssH;
  }
  ctx.fillStyle = waterGrad;
  ctx.fillRect(0, top, cssW, cssH - top);

  // faint floor line
  ctx.strokeStyle = "rgba(120,200,255,0.10)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, bandBottom());
  ctx.lineTo(cssW, bandBottom());
  ctx.stroke();

  for (const b of bubbles) {
    ctx.beginPath();
    ctx.fillStyle = `rgba(180,230,255,${b.alpha})`;
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawFood() {
  for (const f of food) {
    const shrink = f.eat > 0 ? Math.max(0, 1 - f.eat) : 1;
    const r = f.r * shrink;
    if (r < 0.4) {
      continue;
    }
    ctx.save();
    ctx.shadowColor = f.side === "YES" ? "rgba(25,195,125,0.5)" : "rgba(239,70,111,0.5)";
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    const image = getFoodImage(f.url);
    if (image) {
      ctx.drawImage(image, f.x - r, f.y - r, r * 2, r * 2);
    } else {
      const g = ctx.createRadialGradient(f.x - r * 0.3, f.y - r * 0.4, 0, f.x, f.y, r * 1.4);
      g.addColorStop(0, "rgba(255,255,255,0.85)");
      g.addColorStop(0.35, f.color);
      g.addColorStop(1, "rgba(14,20,32,0.95)");
      ctx.fillStyle = g;
      ctx.fillRect(f.x - r, f.y - r, r * 2, r * 2);
      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `${Math.max(5, r * 1.1)}px Inter, system-ui, sans-serif`;
      ctx.fillText(f.initial, f.x, f.y + r * 0.04);
    }
    ctx.restore();
    if (f.eat > 0) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - f.eat) * 0.6;
      ctx.strokeStyle = "rgba(255,255,255,0.7)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(f.x, f.y, r + 2 + f.eat * 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }
}

function drawFish(f) {
  const s = f.size;
  const wag = Math.sin(f.tailPhase) * s * 0.45;
  const tiltAngle = Math.max(-0.34, Math.min(0.34, f.vy * 0.02));
  ctx.save();
  ctx.translate(f.x, f.y);
  ctx.rotate(tiltAngle);
  ctx.scale(f.dir, 1);

  // forked, curved tail that sweeps as it swims
  ctx.beginPath();
  ctx.moveTo(-s * 0.72, 0);
  ctx.quadraticCurveTo(-s * 1.22, -s * 0.16 + wag * 0.6, -s * 1.55, -s * 0.55 + wag);
  ctx.quadraticCurveTo(-s * 1.16, wag * 0.5, -s * 1.55, s * 0.55 + wag);
  ctx.quadraticCurveTo(-s * 1.22, s * 0.16 + wag * 0.6, -s * 0.72, 0);
  ctx.closePath();
  ctx.fillStyle = f.palette.fin;
  ctx.globalAlpha = 0.9;
  ctx.fill();

  // dorsal fin
  ctx.beginPath();
  ctx.moveTo(-s * 0.12, -s * 0.44);
  ctx.quadraticCurveTo(s * 0.14, -s * 0.96, s * 0.44, -s * 0.34);
  ctx.closePath();
  ctx.fillStyle = f.palette.fin;
  ctx.globalAlpha = 0.82;
  ctx.fill();

  // pectoral fin (small belly fin, gives a sense of paddling)
  ctx.beginPath();
  ctx.moveTo(s * 0.2, s * 0.18);
  ctx.quadraticCurveTo(0, s * 0.72, s * 0.44, s * 0.42);
  ctx.closePath();
  ctx.fillStyle = f.palette.fin;
  ctx.globalAlpha = 0.55;
  ctx.fill();

  // body (gradient is constant in local space, so build it once per fish)
  ctx.globalAlpha = 0.96;
  if (!f.bodyGrad) {
    f.bodyGrad = ctx.createLinearGradient(0, -s * 0.5, 0, s * 0.5);
    f.bodyGrad.addColorStop(0, f.palette.body);
    f.bodyGrad.addColorStop(1, f.palette.belly);
  }
  ctx.fillStyle = f.bodyGrad;
  ctx.beginPath();
  ctx.ellipse(0, 0, s, s * 0.54, 0, 0, Math.PI * 2);
  ctx.fill();

  // gill arc
  ctx.globalAlpha = 0.22;
  ctx.strokeStyle = "rgba(10,16,24,0.85)";
  ctx.lineWidth = Math.max(0.6, s * 0.05);
  ctx.beginPath();
  ctx.arc(s * 0.18, 0, s * 0.5, -0.85, 0.85);
  ctx.stroke();

  // eye with catch-light
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(s * 0.52, -s * 0.12, s * 0.18, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#0b1018";
  ctx.beginPath();
  ctx.arc(s * 0.56, -s * 0.12, s * 0.095, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.beginPath();
  ctx.arc(s * 0.6, -s * 0.17, s * 0.035, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function clearCanvas() {
  if (ctx && canvas) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

function frame(ts) {
  rafId = 0;
  if (!canAnimateAquarium()) {
    // Leave nothing frozen on screen if motion just got turned off mid-session.
    if (reducedMotion()) {
      clearCanvas();
    }
    return;
  }
  if (!measure()) {
    // Canvas not laid out yet: retry on a slow timer instead of busy-spinning rAF.
    lastTs = 0;
    window.setTimeout(() => {
      if (canAnimateAquarium()) {
        startLoop();
      }
    }, 300);
    return;
  }

  // Spawn the fish as soon as the canvas is actually measurable, regardless of
  // whether it was sized at init (loader/auth/layout can delay the first size).
  if (!fish.length) {
    ensureFish();
  }
  flushPendingFood();

  // Cap the simulation to ~30fps. Ambient fish do not need 60fps, and halving
  // the canvas work keeps the phone cool next to the chart's own render loop.
  if (lastTs && ts - lastTs < FRAME_MS) {
    rafId = requestAnimationFrame(frame);
    return;
  }
  const dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 0.033;
  lastTs = ts;

  tilt += (tiltTarget - tilt) * Math.min(1, dt * 4);
  tiltImpulse *= Math.max(0, 1 - dt * 2.1);

  updateFood(dt);
  updateFish(dt);
  updateBubbles(dt);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  if (food.length || fish.length) {
    drawWater();
    drawFood();
    for (const f of fish) {
      drawFish(f);
    }
  }

  // Keep swimming while enabled; fish are the always-on ambience.
  if (enabled && (fish.length || food.length)) {
    rafId = requestAnimationFrame(frame);
  }
}

function startLoop() {
  if (rafId || !canAnimateAquarium()) {
    return;
  }
  lastTs = 0;
  rafId = requestAnimationFrame(frame);
}

function stopLoop() {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
}

export function initAquarium() {
  if (initialized) {
    return;
  }
  canvas = document.getElementById("aquariumCanvas");
  if (!(canvas instanceof HTMLCanvasElement)) {
    return;
  }
  ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }
  initialized = true;
  enabled = readEnabledFlag();

  const resume = (retries = 10) => {
    if (enabled) {
      measure();
      primeAquarium(retries);
    }
  };
  const unlockTilt = () => {
    if (enabled) {
      requestTiltAccess();
    }
  };

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && !isTelegramMiniApp()) {
      stopLoop();
    } else if (enabled) {
      resume(12);
    }
  });
  window.addEventListener("pageshow", () => resume(12));
  window.addEventListener("focus", () => resume(8));
  window.addEventListener("pointerdown", unlockTilt, { passive: true });
  window.addEventListener("touchstart", unlockTilt, { passive: true });
  window.addEventListener("resize", () => {
    if (enabled) {
      measure();
      primeAquarium(4);
    }
  });
  window.Telegram?.WebApp?.onEvent?.("viewportChanged", () => resume(10));
  const motionQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  motionQuery?.addEventListener?.("change", (event) => {
    if (event.matches) {
      stopLoop();
      clearCanvas();
    } else if (enabled) {
      primeAquarium();
    }
  });

  if (enabled) {
    primeAquarium(18);
  }
}
