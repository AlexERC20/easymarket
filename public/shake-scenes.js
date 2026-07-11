// Shared runtime for shake-triggered scenes above the live chart.
//
// A scene owns its objects and visuals. This module owns the one canvas, DPR
// sizing, sensor sources and the single ~30fps scheduler used by every scene.
// The deliberately small contract mirrors the aquarium's two existing paths:
// canvas scenes implement update/draw, while iOS-compatible scenes can expose
// updateDom and choose the DOM render mode.

const FRAME_MS = 33;
const SHAKE_JERK = 26;
const DEFAULT_SCENE_KEY = "aquarium";

const scenes = new Map();
let activeSceneKey = DEFAULT_SCENE_KEY;
let scenesEnabled = false;
let runtimeAllowed = false;
let initialized = false;

let canvas = null;
let ctx = null;
let surface = null;
let rafId = 0;
let lastTs = 0;
let lastFrameAt = 0;
let domFallbackId = 0;
let retryId = 0;

let tilt = 0;
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

// Telegram Mini App sensor API (Bot API 8.0+). iOS Telegram blocks the W3C
// motion events, so this native path must remain the primary sensor source.
let tgAccelStarted = false;
let tgOrientStarted = false;
let tgSensorListeners = false;

function isTelegramMiniApp() {
  return Boolean(window.Telegram?.WebApp);
}

function reducedMotion() {
  const reduced = Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
  return reduced && !isTelegramMiniApp();
}

export function getShakeScenePlatform() {
  const tgPlatform = String(window.Telegram?.WebApp?.platform || "").toLowerCase();
  const ua = String(window.navigator?.userAgent || "").toLowerCase();
  const isIosUa = /iphone|ipad|ipod/.test(ua)
    || (/macintosh|mac os/.test(ua) && (window.navigator?.maxTouchPoints || 0) > 1);
  if (tgPlatform.includes("ios") || isIosUa) {
    return "ios";
  }
  if (tgPlatform.includes("android") || /android/.test(ua)) {
    return "android";
  }
  if (tgPlatform.includes("tdesktop") || tgPlatform.includes("mac") || /macintosh|mac os/.test(ua)) {
    return "desktop";
  }
  return "web";
}

function activeScene() {
  return scenes.get(activeSceneKey) || null;
}

function renderMode(scene = activeScene()) {
  const mode = scene?.renderMode?.(getShakeScenePlatform());
  return mode === "dom" ? "dom" : "canvas";
}

function sceneIsAlive(scene = activeScene()) {
  return Boolean(scene?.isAlive?.(renderMode(scene)));
}

function canRunScene(scene = activeScene()) {
  if (!scene || !scenesEnabled || !runtimeAllowed) {
    return false;
  }
  if (scene.isEnabled?.() === false || scene.isRuntimeAllowed?.() === false) {
    return false;
  }
  if (document.hidden && !isTelegramMiniApp()) {
    return false;
  }
  // Preserve the aquarium compatibility rule: DOM keeps running in Telegram
  // WebViews even when they report reduced motion; canvas respects the setting.
  return renderMode(scene) === "dom" || !reducedMotion();
}

function notifySurface(scene = activeScene()) {
  if (surface) {
    scene?.onSurface?.(surface);
  }
}

export function measureShakeSceneCanvas() {
  if (!canvas || !canvas.isConnected) {
    const el = document.getElementById("aquariumCanvas");
    if (el instanceof HTMLCanvasElement) {
      canvas = el;
      ctx = canvas.getContext("2d");
      surface = null;
    }
  }
  if (!canvas || !ctx) {
    return null;
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
    return null;
  }

  const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  const pixelWidth = Math.round(width * dpr);
  const pixelHeight = Math.round(height * dpr);
  const changed = !surface
    || surface.width !== width
    || surface.height !== height
    || surface.dpr !== dpr
    || canvas.width !== pixelWidth
    || canvas.height !== pixelHeight;
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  surface = { canvas, ctx, width, height, dpr };
  if (changed) {
    notifySurface();
  }
  return surface;
}

export function getShakeSceneSurface() {
  return surface;
}

export function clearShakeSceneCanvas() {
  const measured = surface || measureShakeSceneCanvas();
  if (!measured) {
    return;
  }
  measured.ctx.setTransform(1, 0, 0, 1, 0, 0);
  measured.ctx.clearRect(0, 0, measured.canvas.width, measured.canvas.height);
}

function clearRetry() {
  if (retryId) {
    window.clearTimeout(retryId);
    retryId = 0;
  }
}

function scheduleRetry(delay = 300, retries = 8) {
  if (retryId || retries < 0) {
    return;
  }
  retryId = window.setTimeout(() => {
    retryId = 0;
    primeActiveScene(retries);
  }, delay);
}

export function stopActiveSceneLoop() {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
  if (domFallbackId) {
    window.clearInterval(domFallbackId);
    domFallbackId = 0;
  }
  lastTs = 0;
  lastFrameAt = 0;
}

function updateSharedTilt(dt, scene) {
  tilt += (tiltTarget - tilt) * Math.min(1, dt * 4);
  tiltImpulse *= Math.max(0, 1 - dt * 2.1);
  scene.onTilt?.(tilt, tiltImpulse);
}

function stepActiveScene(ts, force = false) {
  const scene = activeScene();
  if (!canRunScene(scene) || !sceneIsAlive(scene)) {
    return false;
  }

  const mode = renderMode(scene);
  let measured = surface;
  if (mode === "canvas") {
    measured = measureShakeSceneCanvas();
    if (!measured) {
      return null;
    }
  }

  if (!force && lastTs && ts - lastTs < FRAME_MS) {
    return true;
  }
  const dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 0.033;
  lastTs = ts;
  lastFrameAt = Date.now();
  updateSharedTilt(dt, scene);

  if (mode === "dom") {
    if (scene.updateDom?.(dt, ts) === false) {
      return null;
    }
  } else {
    scene.update?.(dt, ts, measured);
    clearShakeSceneCanvas();
    if (sceneIsAlive(scene)) {
      scene.draw?.(measured.ctx, measured, ts);
    }
  }
  return sceneIsAlive(scene);
}

function frame(ts) {
  rafId = 0;
  const alive = stepActiveScene(ts);
  if (alive === null) {
    lastTs = 0;
    scheduleRetry(300, 8);
    return;
  }
  if (alive) {
    rafId = requestAnimationFrame(frame);
  } else {
    stopActiveSceneLoop();
  }
}

// Страховочный степпер нужен DOM-сценам всегда, а canvas-сценам — в iOS
// Telegram, где WKWebView может душить rAF при видимом WebApp.
function needsFrameBackstop(scene = activeScene()) {
  return renderMode(scene) === "dom"
    || (getShakeScenePlatform() === "ios" && isTelegramMiniApp());
}

function ensureDomFallback() {
  if (domFallbackId || !needsFrameBackstop()) {
    return;
  }
  domFallbackId = window.setInterval(() => {
    const scene = activeScene();
    if (!canRunScene(scene) || !needsFrameBackstop(scene) || !sceneIsAlive(scene)) {
      stopActiveSceneLoop();
      return;
    }
    const now = Date.now();
    // iOS Telegram can starve rAF while the WebApp is still visible. Step only
    // when the normal scheduler has not advanced recently, as before.
    if (!lastFrameAt || now - lastFrameAt > 180) {
      const alive = stepActiveScene(performance.now(), true);
      if (alive === null) {
        lastTs = 0;
      } else if (!alive) {
        stopActiveSceneLoop();
      }
    }
  }, 120);
}

export function wakeActiveScene() {
  const scene = activeScene();
  if (!canRunScene(scene) || !sceneIsAlive(scene)) {
    return false;
  }
  clearRetry();
  if (!rafId) {
    lastTs = 0;
    rafId = requestAnimationFrame(frame);
  }
  ensureDomFallback();
  return true;
}

export function primeActiveScene(retries = 10) {
  const scene = activeScene();
  if (!canRunScene(scene)) {
    return false;
  }
  const mode = renderMode(scene);
  const measured = mode === "canvas" ? measureShakeSceneCanvas() : null;
  if (mode === "canvas" && !measured) {
    scheduleRetry(180, retries - 1);
    return false;
  }
  const ready = scene.prime?.({ mode, surface: measured }) !== false;
  if (!ready) {
    scheduleRetry(180, retries - 1);
    return false;
  }
  if (sceneIsAlive(scene)) {
    wakeActiveScene();
  }
  return true;
}

function ingestOrientationGamma(gammaDeg) {
  if (Number.isFinite(gammaDeg)) {
    tiltTarget = Math.max(-1, Math.min(1, gammaDeg / 34));
  }
}

function triggerActiveScene(strength = 1) {
  const scene = activeScene();
  if (!canRunScene(scene)) {
    return false;
  }
  scene.summon?.(strength);
  if (sceneIsAlive(scene)) {
    wakeActiveScene();
  }
  return true;
}

function ingestAccel(x, y, z) {
  if (!Number.isFinite(x)) {
    return;
  }
  const delta = lastMotionX === null ? 0 : x - lastMotionX;
  lastMotionX = x;
  tiltImpulse = Math.max(-2.4, Math.min(2.4, tiltImpulse + delta * 0.12));

  if (Number.isFinite(y) && Number.isFinite(z) && lastAccX !== null) {
    const jerk = Math.abs(x - lastAccX) + Math.abs(y - lastAccY) + Math.abs(z - lastAccZ);
    if (jerk > SHAKE_JERK) {
      triggerActiveScene(Math.min(3, jerk / SHAKE_JERK));
    }
  }
  lastAccX = x;
  lastAccY = y;
  lastAccZ = z;
}

function tiltHandler(event) {
  if (!tgOrientStarted) {
    ingestOrientationGamma(Number(event.gamma));
  }
}

function motionHandler(event) {
  if (tgAccelStarted) {
    return;
  }
  const acceleration = event.accelerationIncludingGravity || event.acceleration || {};
  ingestAccel(Number(acceleration.x), Number(acceleration.y), Number(acceleration.z));
}

function startTelegramSensors() {
  const tg = window.Telegram?.WebApp;
  if (!tg) {
    return false;
  }
  if (!tgSensorListeners && typeof tg.onEvent === "function") {
    tg.onEvent("accelerometerChanged", () => {
      const acceleration = tg.Accelerometer || {};
      ingestAccel(Number(acceleration.x), Number(acceleration.y), Number(acceleration.z));
    });
    tg.onEvent("deviceOrientationChanged", () => {
      const orientation = tg.DeviceOrientation || {};
      ingestOrientationGamma(Number(orientation.gamma) * (180 / Math.PI));
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
      // optional Telegram API
    }
    tgAccelStarted = false;
  }
  if (tgOrientStarted) {
    try {
      tg.DeviceOrientation?.stop?.();
    } catch {
      // optional Telegram API
    }
    tgOrientStarted = false;
  }
}

export function requestShakeSensorAccess() {
  startTelegramSensors();

  const addOrientation = () => {
    if (!tiltListening) {
      tiltListening = true;
      window.addEventListener("deviceorientation", tiltHandler, { passive: true });
    }
  };
  const addMotion = () => {
    if (!motionListening && typeof window.DeviceMotionEvent !== "undefined") {
      motionListening = true;
      window.addEventListener("devicemotion", motionHandler, { passive: true });
    }
  };

  // Telegram native sensors win when available. Running both sources makes
  // gamma values fight each other on Android and was the source of oscillation.
  if (!tgOrientStarted && typeof window.DeviceOrientationEvent !== "undefined") {
    const request = window.DeviceOrientationEvent?.requestPermission;
    if (typeof request === "function") {
      if (!tiltPermissionAsked) {
        tiltPermissionAsked = true;
        request.call(window.DeviceOrientationEvent)
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

  if (!tgAccelStarted && typeof window.DeviceMotionEvent !== "undefined") {
    const request = window.DeviceMotionEvent?.requestPermission;
    if (typeof request === "function") {
      if (!motionPermissionAsked) {
        motionPermissionAsked = true;
        request.call(window.DeviceMotionEvent)
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
}

export function registerScene(scene) {
  const key = String(scene?.key || "").trim();
  if (!key) {
    throw new TypeError("Shake scene requires a key");
  }
  if (scenes.has(key)) {
    throw new Error(`Shake scene already registered: ${key}`);
  }
  scenes.set(key, scene);
  scene.connect?.({
    clearCanvas: clearShakeSceneCanvas,
    getPlatform: getShakeScenePlatform,
    getSurface: getShakeSceneSurface,
    measureCanvas: measureShakeSceneCanvas,
    prime: primeActiveScene,
    stop: stopActiveSceneLoop,
    wake: wakeActiveScene,
  });
  scene.setEnabled?.(scenesEnabled);
  scene.setRuntimeAllowed?.(runtimeAllowed);
  if (key === activeSceneKey) {
    notifySurface(scene);
  }
  return scene;
}

export function setActiveScene(key) {
  const nextKey = String(key || "").trim();
  if (!scenes.has(nextKey)) {
    return false;
  }
  if (nextKey === activeSceneKey) {
    primeActiveScene(4);
    return true;
  }

  clearRetry();
  stopActiveSceneLoop();
  activeScene()?.windDown?.();
  clearShakeSceneCanvas();
  activeSceneKey = nextKey;
  const next = activeScene();
  next.setEnabled?.(scenesEnabled);
  next.setRuntimeAllowed?.(runtimeAllowed);
  next.onTilt?.(tilt, tiltImpulse);
  notifySurface(next);
  primeActiveScene(8);
  return true;
}

export function getActiveSceneKey() {
  return activeSceneKey;
}

export function setShakeScenesEnabled(next, requestSensors = true) {
  scenesEnabled = Boolean(next);
  scenes.forEach((scene) => scene.setEnabled?.(scenesEnabled));
  if (!scenesEnabled) {
    clearRetry();
    stopActiveSceneLoop();
    activeScene()?.windDown?.();
    clearShakeSceneCanvas();
    stopTelegramSensors();
  } else {
    if (requestSensors) {
      requestShakeSensorAccess();
    }
    primeActiveScene(10);
  }
  return scenesEnabled;
}

export function setShakeScenesRuntimeAllowed(next) {
  runtimeAllowed = Boolean(next);
  scenes.forEach((scene) => scene.setRuntimeAllowed?.(runtimeAllowed));
  if (!runtimeAllowed) {
    clearRetry();
    stopActiveSceneLoop();
    activeScene()?.windDown?.();
    clearShakeSceneCanvas();
    stopTelegramSensors();
  } else if (scenesEnabled) {
    // Native Telegram sensors can safely resume without a user gesture. W3C
    // permission prompts remain tied to pointer/touch events, as before.
    startTelegramSensors();
    primeActiveScene(10);
  }
  return runtimeAllowed;
}

export function initShakeScenes() {
  if (initialized) {
    return;
  }
  initialized = true;
  measureShakeSceneCanvas();

  const resume = (retries = 10) => {
    if (scenesEnabled && runtimeAllowed) {
      measureShakeSceneCanvas();
      primeActiveScene(retries);
    }
  };
  const unlockSensors = () => {
    if (scenesEnabled && runtimeAllowed) {
      requestShakeSensorAccess();
    }
  };

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && !isTelegramMiniApp()) {
      stopActiveSceneLoop();
    } else {
      resume(12);
    }
  });
  window.addEventListener("pageshow", () => resume(12));
  window.addEventListener("focus", () => resume(8));
  window.addEventListener("pointerdown", unlockSensors, { passive: true });
  window.addEventListener("touchstart", unlockSensors, { passive: true });
  window.addEventListener("resize", () => resume(4));
  window.Telegram?.WebApp?.onEvent?.("viewportChanged", () => resume(10));

  const motionQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  motionQuery?.addEventListener?.("change", (event) => {
    if (event.matches && !isTelegramMiniApp() && renderMode() === "canvas") {
      stopActiveSceneLoop();
      clearShakeSceneCanvas();
    } else {
      resume(6);
    }
  });
  primeActiveScene(18);
}

// Minimal proof that the runtime is scene-agnostic. It exists only behind the
// console hook and creates no UI, network request or idle animation.
function createGlowSprite() {
  const sprite = document.createElement("canvas");
  sprite.width = 64;
  sprite.height = 64;
  const spriteCtx = sprite.getContext("2d");
  if (!spriteCtx) {
    return null;
  }
  const gradient = spriteCtx.createRadialGradient(32, 32, 2, 32, 32, 31);
  gradient.addColorStop(0, "rgba(103, 232, 249, 0.95)");
  gradient.addColorStop(0.24, "rgba(103, 232, 249, 0.55)");
  gradient.addColorStop(1, "rgba(103, 232, 249, 0)");
  spriteCtx.fillStyle = gradient;
  spriteCtx.fillRect(0, 0, 64, 64);
  return sprite;
}

const demoScene = {
  key: "glow-orbs",
  enabled: true,
  runtimeAllowed: false,
  runtime: null,
  surface: null,
  sprite: null,
  orbs: [],
  tilt: 0,
  connect(runtime) {
    this.runtime = runtime;
  },
  renderMode() {
    return "canvas";
  },
  setEnabled(next) {
    this.enabled = Boolean(next);
  },
  isEnabled() {
    return this.enabled;
  },
  setRuntimeAllowed(next) {
    this.runtimeAllowed = Boolean(next);
  },
  isRuntimeAllowed() {
    return this.runtimeAllowed;
  },
  onSurface(nextSurface) {
    this.surface = nextSurface;
  },
  onTilt(nextTilt) {
    this.tilt = nextTilt;
  },
  summon(strength = 1) {
    const measured = this.runtime?.measureCanvas?.();
    if (!measured) {
      return;
    }
    this.surface = measured;
    this.sprite ||= createGlowSprite();
    for (let index = 0; index < 7; index += 1) {
      this.orbs.push({
        x: measured.width * (0.18 + Math.random() * 0.64),
        y: measured.height * (0.28 + Math.random() * 0.46),
        vx: (Math.random() - 0.5) * (24 + strength * 8),
        vy: -10 - Math.random() * 18,
        age: 0,
        life: 1.8 + Math.random() * 1.2,
        size: 18 + Math.random() * 18,
      });
    }
    this.runtime?.wake?.();
  },
  prime({ surface: nextSurface } = {}) {
    if (nextSurface) {
      this.surface = nextSurface;
    }
    return true;
  },
  update(dt) {
    const width = this.surface?.width || 0;
    const height = this.surface?.height || 0;
    this.orbs.forEach((orb) => {
      orb.age += dt;
      orb.vx += this.tilt * 11 * dt;
      orb.x += orb.vx * dt;
      orb.y += orb.vy * dt;
      if (orb.x < -orb.size) orb.x = width + orb.size;
      if (orb.x > width + orb.size) orb.x = -orb.size;
      if (orb.y < -orb.size) orb.y = height + orb.size;
    });
    this.orbs = this.orbs.filter((orb) => orb.age < orb.life);
  },
  draw(drawCtx, measured) {
    if (!this.sprite) {
      return;
    }
    drawCtx.setTransform(measured.dpr, 0, 0, measured.dpr, 0, 0);
    this.orbs.forEach((orb) => {
      const alpha = Math.max(0, Math.min(1, (orb.life - orb.age) / 0.55));
      drawCtx.globalAlpha = alpha;
      drawCtx.drawImage(this.sprite, orb.x - orb.size, orb.y - orb.size, orb.size * 2, orb.size * 2);
    });
    drawCtx.globalAlpha = 1;
  },
  isAlive() {
    return this.orbs.length > 0;
  },
  windDown() {
    this.orbs = [];
  },
};

registerScene(demoScene);

if (typeof window !== "undefined") {
  window.__setShakeScene = (key) => (setActiveScene(key) ? getActiveSceneKey() : false);
  window.__getShakeScene = () => getActiveSceneKey();
  window.__shakeActiveScene = (strength = 1) => triggerActiveScene(Number(strength) || 1);
}
