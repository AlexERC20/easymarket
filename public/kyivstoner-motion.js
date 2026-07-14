const LOGO_SOURCE = "/assets/kyivstoner-mask-logo.jpg";
const MASK_SIZE = 192;
const IMPACT_AT = 720;
const EXPLODE_AT = 1_280;
const SCENE_DURATION = 2_080;
const GLOW_SIZE = 48;

const COLORS = [
  [183, 255, 77],
  [53, 246, 255],
  [165, 108, 255],
  [255, 255, 255],
];

let logoDataPromise = null;
let activeScene = null;
let sceneRequestId = 0;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const easeOutCubic = (value) => 1 - (1 - value) ** 3;
const easeInOutCubic = (value) => (
  value < 0.5
    ? 4 * value * value * value
    : 1 - (-2 * value + 2) ** 3 / 2
);

function telegramWebApp() {
  return Boolean(window.Telegram?.WebApp);
}

function reducedMotion() {
  return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) && !telegramWebApp();
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("kyivstoner_logo_unavailable"));
    image.src = source;
  });
}

function buildLogoData(image) {
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = MASK_SIZE;
  sourceCanvas.height = MASK_SIZE;
  const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
  if (!sourceContext) {
    throw new Error("kyivstoner_motion_no_source_context");
  }
  sourceContext.drawImage(image, 0, 0, MASK_SIZE, MASK_SIZE);
  const sourcePixels = sourceContext.getImageData(0, 0, MASK_SIZE, MASK_SIZE);

  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = MASK_SIZE;
  maskCanvas.height = MASK_SIZE;
  const maskContext = maskCanvas.getContext("2d");
  if (!maskContext) {
    throw new Error("kyivstoner_motion_no_mask_context");
  }
  const maskPixels = maskContext.createImageData(MASK_SIZE, MASK_SIZE);
  const targets = [];
  const sampleStep = 4;

  for (let y = 0; y < MASK_SIZE; y += 1) {
    for (let x = 0; x < MASK_SIZE; x += 1) {
      const index = (y * MASK_SIZE + x) * 4;
      const red = sourcePixels.data[index];
      const green = sourcePixels.data[index + 1];
      const blue = sourcePixels.data[index + 2];
      const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
      const alpha = clamp(Math.round((luminance - 36) * 2.35), 0, 255);
      maskPixels.data[index] = 255;
      maskPixels.data[index + 1] = 255;
      maskPixels.data[index + 2] = 255;
      maskPixels.data[index + 3] = alpha;

      if (x % sampleStep === 0 && y % sampleStep === 0 && alpha > 110) {
        targets.push({
          nx: x / MASK_SIZE - 0.5,
          ny: y / MASK_SIZE - 0.5,
          alpha: alpha / 255,
        });
      }
    }
  }

  maskContext.putImageData(maskPixels, 0, 0);
  return { maskCanvas, targets };
}

function getLogoData() {
  if (!logoDataPromise) {
    logoDataPromise = loadImage(LOGO_SOURCE).then(buildLogoData).catch((error) => {
      logoDataPromise = null;
      throw error;
    });
  }
  return logoDataPromise;
}

export function preloadKyivstonerMotion() {
  return getLogoData().catch(() => null);
}

function makeGlowSprite(rgb) {
  const sprite = document.createElement("canvas");
  sprite.width = GLOW_SIZE;
  sprite.height = GLOW_SIZE;
  const context = sprite.getContext("2d");
  const center = GLOW_SIZE / 2;
  const gradient = context.createRadialGradient(center, center, 0, center, center, center);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.18, `rgba(${rgb.join(",")},0.94)`);
  gradient.addColorStop(0.48, `rgba(${rgb.join(",")},0.3)`);
  gradient.addColorStop(1, `rgba(${rgb.join(",")},0)`);
  context.fillStyle = gradient;
  context.fillRect(0, 0, GLOW_SIZE, GLOW_SIZE);
  return sprite;
}

function quadraticPoint(start, control, end, progress) {
  const inverse = 1 - progress;
  return {
    x: inverse * inverse * start.x + 2 * inverse * progress * control.x + progress * progress * end.x,
    y: inverse * inverse * start.y + 2 * inverse * progress * control.y + progress * progress * end.y,
  };
}

function makeBolt(startX, startY, endX, endY, seed = 0) {
  const points = [];
  const segments = 8;
  const dx = endX - startX;
  const dy = endY - startY;
  const length = Math.hypot(dx, dy) || 1;
  const normalX = -dy / length;
  const normalY = dx / length;
  for (let index = 0; index <= segments; index += 1) {
    const progress = index / segments;
    const edge = index === 0 || index === segments;
    const wave = Math.sin(seed * 3.7 + index * 8.31) * 0.5 + Math.sin(seed + index * 2.13) * 0.5;
    const offset = edge ? 0 : wave * Math.min(18, length * 0.12);
    points.push({
      x: startX + dx * progress + normalX * offset,
      y: startY + dy * progress + normalY * offset,
    });
  }
  return points;
}

function buildSceneParticles(targets, origin, center, logoSize, maxParticles) {
  const stride = Math.max(1, Math.ceil(targets.length / maxParticles));
  return targets
    .filter((_, index) => index % stride === 0)
    .slice(0, maxParticles)
    .map((target, index) => {
      const targetX = center.x + target.nx * logoSize;
      const targetY = center.y + target.ny * logoSize;
      const sourceAngle = Math.random() * Math.PI * 2;
      const sourceRadius = 6 + Math.random() * 36;
      const start = {
        x: origin.x + Math.cos(sourceAngle) * sourceRadius,
        y: origin.y + Math.sin(sourceAngle) * sourceRadius,
      };
      const dx = targetX - start.x;
      const dy = targetY - start.y;
      const distance = Math.hypot(dx, dy) || 1;
      const swirl = distance * (0.16 + Math.random() * 0.22) * (index % 2 ? 1 : -1);
      const control = {
        x: (start.x + targetX) / 2 - (dy / distance) * swirl,
        y: (start.y + targetY) / 2 + (dx / distance) * swirl,
      };
      const normalizedY = target.ny + 0.5;
      const colorIndex = normalizedY < 0.34 ? 0 : normalizedY < 0.7 ? 1 : 2;
      const burstAngle = Math.atan2(targetY - center.y, targetX - center.x) + (Math.random() - 0.5) * 0.75;
      return {
        start,
        control,
        target: { x: targetX, y: targetY },
        delay: Math.random() * 120,
        duration: 500 + Math.random() * 210,
        size: 0.75 + target.alpha * 0.85 + Math.random() * 0.35,
        colorIndex: Math.random() < 0.1 ? 3 : colorIndex,
        phase: Math.random() * Math.PI * 2,
        burstAngle,
        burstSpeed: 170 + Math.random() * 330,
        tangentSpeed: (Math.random() - 0.5) * 150,
      };
    });
}

function haptic(kind) {
  try {
    const feedback = window.Telegram?.WebApp?.HapticFeedback;
    if (kind === "success") {
      feedback?.notificationOccurred?.("success");
    } else {
      feedback?.impactOccurred?.(kind);
    }
  } catch {
    // Motion remains visual on clients without Telegram haptics.
  }
}

function createScene(logoData, originElement, options = {}) {
  const scene = document.createElement("div");
  scene.className = "kyivstoner-motion-scene";
  scene.setAttribute("aria-hidden", "true");
  const canvas = document.createElement("canvas");
  canvas.className = "kyivstoner-motion-canvas";
  scene.appendChild(canvas);
  document.body.appendChild(scene);

  const context = canvas.getContext("2d", { alpha: true });
  if (!context) {
    scene.remove();
    throw new Error("kyivstoner_motion_no_context");
  }

  const width = Math.max(1, window.innerWidth);
  const height = Math.max(1, window.innerHeight);
  const dpr = Math.min(window.devicePixelRatio || 1, 1.6);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const originRect = originElement?.getBoundingClientRect?.();
  const origin = originRect?.width
    ? { x: originRect.left + originRect.width / 2, y: originRect.top + originRect.height / 2 }
    : { x: width / 2, y: 64 };
  const logoSize = clamp(Math.min(width * 0.54, height * 0.32), 150, 218);
  const center = {
    x: width / 2,
    y: clamp(height * 0.39, logoSize * 0.72 + 46, height - logoSize * 0.72 - 80),
  };
  const simple = reducedMotion();
  const mobile = width <= 520;
  const particles = buildSceneParticles(
    logoData.targets,
    origin,
    center,
    logoSize,
    simple ? 120 : mobile ? 360 : 500,
  );
  const sprites = COLORS.map(makeGlowSprite);
  const maxDimension = Math.hypot(width, height);
  const bolts = [
    { start: 760, duration: 150, color: 1, points: makeBolt(center.x - logoSize * 0.88, center.y - logoSize * 0.38, center.x + logoSize * 0.32, center.y + logoSize * 0.04, 0.3) },
    { start: 875, duration: 180, color: 0, points: makeBolt(center.x + logoSize * 0.82, center.y - logoSize * 0.5, center.x - logoSize * 0.1, center.y + logoSize * 0.34, 1.7) },
    { start: 1_025, duration: 170, color: 2, points: makeBolt(center.x - logoSize * 0.76, center.y + logoSize * 0.46, center.x + logoSize * 0.46, center.y - logoSize * 0.2, 2.8) },
    { start: 1_205, duration: 150, color: 3, points: makeBolt(center.x + logoSize * 0.7, center.y + logoSize * 0.36, center.x - logoSize * 0.36, center.y - logoSize * 0.34, 4.1) },
  ];

  let frameId = 0;
  let destroyed = false;
  let impactFired = false;
  let explosionFired = false;
  let previousNow = performance.now();
  const startedAt = previousNow;

  originElement?.classList.add("kyivstoner-motion-trigger");

  function drawSprite(sprite, x, y, size, alpha) {
    context.globalAlpha = alpha;
    context.drawImage(sprite, x - size / 2, y - size / 2, size, size);
  }

  function drawParticleTrail(from, to, color, alpha, widthValue) {
    context.globalAlpha = alpha;
    context.strokeStyle = `rgb(${color.join(",")})`;
    context.lineWidth = widthValue;
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
  }

  function drawAssembly(time) {
    for (const particle of particles) {
      const raw = clamp((time - particle.delay) / particle.duration, 0, 1);
      if (raw <= 0) {
        continue;
      }
      const progress = easeInOutCubic(raw);
      const previousProgress = easeInOutCubic(Math.max(0, raw - 0.055));
      const point = quadraticPoint(particle.start, particle.control, particle.target, progress);
      const previous = quadraticPoint(particle.start, particle.control, particle.target, previousProgress);
      const alpha = Math.min(1, raw * 4) * (0.55 + progress * 0.45);
      const color = COLORS[particle.colorIndex];
      drawParticleTrail(previous, point, color, alpha * 0.42, particle.size * 1.2);
      drawSprite(sprites[particle.colorIndex], point.x, point.y, particle.size * 8.5, alpha);
    }
  }

  function pulseScale(time) {
    const elapsed = Math.max(0, time - IMPACT_AT);
    return 1 + Math.sin(elapsed * 0.025) * 0.055 * Math.exp(-elapsed / 760);
  }

  function drawHeldLogo(time) {
    const scale = pulseScale(time);
    const heat = Math.exp(-(time - IMPACT_AT) / 650);
    for (const particle of particles) {
      const dx = particle.target.x - center.x;
      const dy = particle.target.y - center.y;
      const shimmer = Math.sin(time * 0.007 + particle.phase) * 0.75;
      const x = center.x + dx * scale + shimmer;
      const y = center.y + dy * scale + Math.cos(time * 0.006 + particle.phase) * 0.55;
      const alpha = clamp(0.72 + heat * 0.3 + shimmer * 0.08, 0.4, 1);
      drawSprite(sprites[particle.colorIndex], x, y, particle.size * (7.5 + heat * 2), alpha);
    }

    context.save();
    context.globalCompositeOperation = "screen";
    context.globalAlpha = 0.08 + heat * 0.16;
    const maskSize = logoSize * scale;
    context.drawImage(logoData.maskCanvas, center.x - maskSize / 2, center.y - maskSize / 2, maskSize, maskSize);
    context.restore();
  }

  function drawExplosion(time) {
    const elapsed = (time - EXPLODE_AT) / 1_000;
    const progress = clamp((time - EXPLODE_AT) / (SCENE_DURATION - EXPLODE_AT), 0, 1);
    const alpha = (1 - progress) ** 1.4;
    for (const particle of particles) {
      const radialX = Math.cos(particle.burstAngle);
      const radialY = Math.sin(particle.burstAngle);
      const tangentX = -radialY;
      const tangentY = radialX;
      const velocityX = radialX * particle.burstSpeed + tangentX * particle.tangentSpeed;
      const velocityY = radialY * particle.burstSpeed + tangentY * particle.tangentSpeed - 55;
      const x = particle.target.x + velocityX * elapsed;
      const y = particle.target.y + velocityY * elapsed + 150 * elapsed * elapsed;
      const previous = { x: x - velocityX * 0.025, y: y - (velocityY + 280 * elapsed) * 0.025 };
      const color = COLORS[particle.colorIndex];
      drawParticleTrail(previous, { x, y }, color, alpha * 0.55, particle.size * 1.25);
      drawSprite(sprites[particle.colorIndex], x, y, particle.size * 9, alpha);
    }
  }

  function drawBolt(bolt, time) {
    const progress = (time - bolt.start) / bolt.duration;
    if (progress < 0 || progress >= 1 || simple) {
      return;
    }
    const alpha = Math.sin(progress * Math.PI) * 0.95;
    const color = COLORS[bolt.color];
    for (const [lineWidth, passAlpha, stroke] of [
      [7, 0.18, `rgb(${color.join(",")})`],
      [2.4, 0.75, `rgb(${color.join(",")})`],
      [0.9, 1, "rgb(255,255,255)"],
    ]) {
      context.globalAlpha = alpha * passAlpha;
      context.strokeStyle = stroke;
      context.lineWidth = lineWidth;
      context.beginPath();
      bolt.points.forEach((point, index) => {
        if (index === 0) {
          context.moveTo(point.x, point.y);
        } else {
          context.lineTo(point.x, point.y);
        }
      });
      context.stroke();
    }
  }

  function drawRing(time, start, duration, color, from, to, alpha = 0.55) {
    const raw = (time - start) / duration;
    if (raw < 0 || raw >= 1) {
      return;
    }
    const progress = easeOutCubic(raw);
    context.globalAlpha = (1 - progress) * alpha;
    context.strokeStyle = `rgb(${color.join(",")})`;
    context.lineWidth = 1.5 + (1 - progress) * 1.5;
    context.beginPath();
    context.arc(center.x, center.y, from + (to - from) * progress, 0, Math.PI * 2);
    context.stroke();
  }

  function drawFlash(time, start, duration, strength) {
    const raw = (time - start) / duration;
    if (raw < 0 || raw >= 1) {
      return;
    }
    const alpha = (1 - raw) ** 2 * strength;
    const radius = maxDimension * (0.16 + raw * 0.42);
    const gradient = context.createRadialGradient(center.x, center.y, 0, center.x, center.y, radius);
    gradient.addColorStop(0, `rgba(255,255,255,${alpha})`);
    gradient.addColorStop(0.18, `rgba(53,246,255,${alpha * 0.54})`);
    gradient.addColorStop(0.48, `rgba(165,108,255,${alpha * 0.22})`);
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    context.globalAlpha = 1;
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
  }

  function destroy() {
    if (destroyed) {
      return;
    }
    destroyed = true;
    window.cancelAnimationFrame(frameId);
    originElement?.classList.remove("kyivstoner-motion-trigger");
    scene.classList.add("is-leaving");
    window.setTimeout(() => scene.remove(), 180);
    if (activeScene?.destroy === destroy) {
      activeScene = null;
    }
  }

  function frame(now) {
    if (destroyed) {
      return;
    }
    const time = now - startedAt;
    const frameGap = now - previousNow;
    previousNow = now;

    if (document.hidden || frameGap > 250) {
      destroy();
      return;
    }

    let shakeX = 0;
    let shakeY = 0;
    if (time >= EXPLODE_AT && time < EXPLODE_AT + 280 && !simple) {
      const decay = Math.exp(-(time - EXPLODE_AT) / 90);
      shakeX = Math.sin((time - EXPLODE_AT) * 0.12) * 4 * decay;
      shakeY = Math.cos((time - EXPLODE_AT) * 0.15) * 3 * decay;
    }

    context.setTransform(dpr, 0, 0, dpr, shakeX * dpr, shakeY * dpr);
    context.clearRect(-30, -30, width + 60, height + 60);
    context.globalCompositeOperation = "lighter";
    context.lineCap = "round";
    context.lineJoin = "round";

    if (time < IMPACT_AT) {
      drawAssembly(time);
    } else if (time < EXPLODE_AT) {
      drawHeldLogo(time);
    } else {
      drawExplosion(time);
    }

    for (const bolt of bolts) {
      drawBolt(bolt, time);
    }
    drawRing(time, IMPACT_AT, 540, COLORS[1], logoSize * 0.34, logoSize * 1.08);
    drawRing(time, IMPACT_AT + 80, 650, COLORS[0], logoSize * 0.3, logoSize * 1.32, 0.38);
    drawRing(time, EXPLODE_AT, 650, COLORS[2], logoSize * 0.28, maxDimension * 0.48, 0.65);
    drawRing(time, EXPLODE_AT + 70, 720, COLORS[1], logoSize * 0.2, maxDimension * 0.58, 0.45);
    drawFlash(time, IMPACT_AT, 360, 0.48);
    drawFlash(time, EXPLODE_AT, 480, 0.72);
    context.globalAlpha = 1;

    if (!impactFired && time >= IMPACT_AT) {
      impactFired = true;
      haptic("heavy");
      options.onImpact?.();
    }
    if (!explosionFired && time >= EXPLODE_AT) {
      explosionFired = true;
      haptic("success");
      options.onExplosion?.();
    }
    if (time >= SCENE_DURATION) {
      destroy();
      return;
    }
    frameId = window.requestAnimationFrame(frame);
  }

  scene.classList.add("is-active");
  frameId = window.requestAnimationFrame(frame);
  return { destroy };
}

export async function playKyivstonerMotion(originElement, options = {}) {
  const requestId = ++sceneRequestId;
  activeScene?.destroy?.();
  activeScene = null;
  originElement?.classList.remove("kyivstoner-motion-trigger");
  void originElement?.offsetWidth;
  originElement?.classList.add("kyivstoner-motion-trigger");

  try {
    const logoData = await getLogoData();
    if (requestId !== sceneRequestId) {
      return false;
    }
    activeScene = createScene(logoData, originElement, options);
    return true;
  } catch {
    originElement?.classList.remove("kyivstoner-motion-trigger");
    return false;
  }
}
