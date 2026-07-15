const ASSEMBLE_END = 720;
const KICK_START = 870;
const KICK_AT = 1_145;
const EXPLODE_AT = 1_610;
const SCENE_DURATION = 2_360;
const GLOW_SIZE = 48;
const BALL_CENTER = { x: 0.5, y: 0.32 };

const COLORS = [
  [123, 255, 104],
  [53, 246, 255],
  [248, 252, 255],
  [255, 205, 74],
];

let activeScene = null;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const lerp = (start, end, progress) => start + (end - start) * progress;
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

function addLine(targets, start, end, count, options = {}) {
  const total = Math.max(2, count);
  for (let index = 0; index < total; index += 1) {
    const progress = index / (total - 1);
    targets.push({
      nx: lerp(start.x, end.x, progress),
      ny: lerp(start.y, end.y, progress),
      kickNx: lerp(options.kickStart?.x ?? start.x, options.kickEnd?.x ?? end.x, progress),
      kickNy: lerp(options.kickStart?.y ?? start.y, options.kickEnd?.y ?? end.y, progress),
      group: options.group || "body",
      colorIndex: options.colorIndex ?? 1,
    });
  }
}

function addCircle(targets, center, radius, count, options = {}) {
  for (let index = 0; index < count; index += 1) {
    const angle = index / count * Math.PI * 2;
    const nx = center.x + Math.cos(angle) * radius;
    const ny = center.y + Math.sin(angle) * radius;
    targets.push({
      nx,
      ny,
      kickNx: nx,
      kickNy: ny,
      group: options.group || "body",
      colorIndex: options.colorIndex ?? 2,
    });
  }
}

function addFilledCircle(targets, center, radius, options = {}) {
  addCircle(targets, center, radius, 30, options);
  addCircle(targets, center, radius * 0.64, 20, options);
  addCircle(targets, center, radius * 0.28, 10, options);
  targets.push({
    nx: center.x,
    ny: center.y,
    kickNx: center.x,
    kickNy: center.y,
    group: options.group || "body",
    colorIndex: options.colorIndex ?? 2,
  });
}

function addTorso(targets) {
  const rows = 11;
  for (let row = 0; row < rows; row += 1) {
    const progress = row / (rows - 1);
    const y = lerp(-0.22, 0.1, progress);
    const centerX = lerp(-0.035, 0.02, progress);
    const halfWidth = lerp(0.145, 0.09, progress);
    const columns = 6;
    for (let column = 0; column < columns; column += 1) {
      const x = centerX - halfWidth + halfWidth * 2 * (column / (columns - 1));
      targets.push({
        nx: x,
        ny: y,
        kickNx: x,
        kickNy: y,
        group: "body",
        colorIndex: row % 3 === 0 ? 0 : 1,
      });
    }
  }
}

function buildFootballerTargets() {
  const targets = [];

  addFilledCircle(targets, { x: -0.055, y: -0.38 }, 0.095, { colorIndex: 2 });
  addLine(targets, { x: -0.06, y: -0.285 }, { x: -0.045, y: -0.22 }, 11, { colorIndex: 2 });
  addTorso(targets);

  addLine(targets, { x: -0.14, y: -0.17 }, { x: -0.31, y: -0.035 }, 24, { colorIndex: 1 });
  addLine(targets, { x: -0.31, y: -0.035 }, { x: -0.2, y: 0.065 }, 19, { colorIndex: 0 });
  addLine(targets, { x: 0.1, y: -0.17 }, { x: 0.28, y: -0.055 }, 24, { colorIndex: 1 });
  addLine(targets, { x: 0.28, y: -0.055 }, { x: 0.38, y: -0.14 }, 18, { colorIndex: 0 });

  addLine(targets, { x: -0.025, y: 0.08 }, { x: -0.16, y: 0.34 }, 28, { colorIndex: 1 });
  addLine(targets, { x: -0.16, y: 0.34 }, { x: -0.19, y: 0.59 }, 29, { colorIndex: 0 });
  addLine(targets, { x: -0.2, y: 0.59 }, { x: -0.07, y: 0.61 }, 17, { colorIndex: 2 });

  addLine(targets, { x: 0.045, y: 0.08 }, { x: 0.14, y: 0.28 }, 28, {
    group: "kick-leg",
    colorIndex: 1,
    kickStart: { x: 0.045, y: 0.08 },
    kickEnd: { x: 0.2, y: 0.22 },
  });
  addLine(targets, { x: 0.14, y: 0.28 }, { x: -0.025, y: 0.43 }, 30, {
    group: "kick-leg",
    colorIndex: 0,
    kickStart: { x: 0.2, y: 0.22 },
    kickEnd: { x: 0.405, y: 0.315 },
  });
  addLine(targets, { x: -0.035, y: 0.43 }, { x: 0.065, y: 0.45 }, 16, {
    group: "kick-leg",
    colorIndex: 2,
    kickStart: { x: 0.385, y: 0.315 },
    kickEnd: { x: 0.455, y: 0.325 },
  });

  addCircle(targets, BALL_CENTER, 0.087, 42, { group: "ball", colorIndex: 2 });
  addCircle(targets, BALL_CENTER, 0.043, 18, { group: "ball", colorIndex: 3 });
  for (let index = 0; index < 5; index += 1) {
    const angle = -Math.PI / 2 + index / 5 * Math.PI * 2;
    addLine(targets, BALL_CENTER, {
      x: BALL_CENTER.x + Math.cos(angle) * 0.078,
      y: BALL_CENTER.y + Math.sin(angle) * 0.078,
    }, 7, { group: "ball", colorIndex: index % 2 ? 3 : 2 });
  }

  return targets;
}

const FOOTBALLER_TARGETS = buildFootballerTargets();

function makeGlowSprite(rgb) {
  const sprite = document.createElement("canvas");
  sprite.width = GLOW_SIZE;
  sprite.height = GLOW_SIZE;
  const context = sprite.getContext("2d");
  if (!context) {
    return sprite;
  }
  const center = GLOW_SIZE / 2;
  const gradient = context.createRadialGradient(center, center, 0, center, center, center);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.18, `rgba(${rgb.join(",")},0.95)`);
  gradient.addColorStop(0.5, `rgba(${rgb.join(",")},0.28)`);
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

function makeBolt(start, end, seed = 0) {
  const points = [];
  const segments = 8;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy) || 1;
  const normalX = -dy / length;
  const normalY = dx / length;
  for (let index = 0; index <= segments; index += 1) {
    const progress = index / segments;
    const edge = index === 0 || index === segments;
    const wave = Math.sin(seed * 3.2 + index * 7.81) * 0.55 + Math.sin(seed + index * 2.37) * 0.45;
    const offset = edge ? 0 : wave * Math.min(16, length * 0.12);
    points.push({
      x: start.x + dx * progress + normalX * offset,
      y: start.y + dy * progress + normalY * offset,
    });
  }
  return points;
}

function buildSceneParticles(origin, center, figureSize, maxParticles) {
  const stride = Math.max(1, Math.ceil(FOOTBALLER_TARGETS.length / maxParticles));
  return FOOTBALLER_TARGETS
    .filter((_, index) => index % stride === 0)
    .slice(0, maxParticles)
    .map((target, index) => {
      const targetPoint = {
        x: center.x + target.nx * figureSize,
        y: center.y + target.ny * figureSize,
      };
      const kickPoint = {
        x: center.x + target.kickNx * figureSize,
        y: center.y + target.kickNy * figureSize,
      };
      const sourceAngle = Math.random() * Math.PI * 2;
      const sourceRadius = 7 + Math.random() * 34;
      const start = {
        x: origin.x + Math.cos(sourceAngle) * sourceRadius,
        y: origin.y + Math.sin(sourceAngle) * sourceRadius,
      };
      const dx = targetPoint.x - start.x;
      const dy = targetPoint.y - start.y;
      const distance = Math.hypot(dx, dy) || 1;
      const direction = index % 2 ? 1 : -1;
      const swirl = distance * (0.15 + Math.random() * 0.2) * direction;
      const control = {
        x: (start.x + targetPoint.x) / 2 - dy / distance * swirl,
        y: (start.y + targetPoint.y) / 2 + dx / distance * swirl,
      };
      const burstAngle = Math.atan2(kickPoint.y - center.y, kickPoint.x - center.x) + (Math.random() - 0.5) * 0.9;
      return {
        start,
        control,
        target: targetPoint,
        kickTarget: kickPoint,
        ballOffset: target.group === "ball"
          ? { x: (target.nx - BALL_CENTER.x) * figureSize, y: (target.ny - BALL_CENTER.y) * figureSize }
          : null,
        group: target.group,
        colorIndex: target.colorIndex,
        delay: Math.random() * 125,
        duration: 500 + Math.random() * 210,
        size: 0.85 + Math.random() * 0.85,
        phase: Math.random() * Math.PI * 2,
        burstAngle,
        burstSpeed: 180 + Math.random() * 360,
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
    // The scene remains visual outside Telegram.
  }
}

function createScene(originElement, options = {}) {
  const scene = document.createElement("div");
  scene.className = "football-motion-scene";
  scene.setAttribute("aria-hidden", "true");
  const canvas = document.createElement("canvas");
  canvas.className = "football-motion-canvas";
  scene.appendChild(canvas);
  document.body.appendChild(scene);

  const context = canvas.getContext("2d", { alpha: true });
  if (!context) {
    scene.remove();
    throw new Error("football_motion_no_context");
  }

  const width = Math.max(1, window.innerWidth);
  const height = Math.max(1, window.innerHeight);
  const dpr = Math.min(window.devicePixelRatio || 1, 1.55);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const originRect = originElement?.getBoundingClientRect?.();
  const origin = originRect?.width
    ? { x: originRect.left + originRect.width / 2, y: originRect.top + originRect.height / 2 }
    : { x: width / 2, y: 64 };
  const figureSize = clamp(Math.min(width * 0.58, height * 0.3), 158, 228);
  const center = {
    x: width / 2 - figureSize * 0.03,
    y: clamp(height * 0.4, figureSize * 0.62 + 52, height - figureSize * 0.72 - 76),
  };
  const simple = reducedMotion();
  const particles = buildSceneParticles(origin, center, figureSize, simple ? 120 : width <= 520 ? 340 : 440);
  const bodyParticles = particles.filter((particle) => particle.group !== "ball");
  const ballParticles = particles.filter((particle) => particle.group === "ball");
  const sprites = COLORS.map(makeGlowSprite);
  const ballStart = {
    x: center.x + BALL_CENTER.x * figureSize,
    y: center.y + BALL_CENTER.y * figureSize,
  };
  const ballControl = {
    x: Math.min(width * 0.78, ballStart.x + figureSize * 0.52),
    y: ballStart.y - figureSize * 0.62,
  };
  const ballEnd = {
    x: width + figureSize * 0.32,
    y: Math.max(48, center.y - figureSize * 0.2),
  };
  const bolts = [
    {
      start: KICK_AT,
      duration: 170,
      colorIndex: 0,
      points: makeBolt(ballStart, { x: center.x - figureSize * 0.43, y: center.y - figureSize * 0.22 }, 0.7),
    },
    {
      start: KICK_AT + 90,
      duration: 190,
      colorIndex: 1,
      points: makeBolt(ballStart, { x: center.x + figureSize * 0.12, y: center.y - figureSize * 0.58 }, 2.1),
    },
    {
      start: EXPLODE_AT,
      duration: 180,
      colorIndex: 2,
      points: makeBolt(center, { x: center.x + figureSize * 0.62, y: center.y + figureSize * 0.32 }, 3.8),
    },
  ];
  const maxDimension = Math.hypot(width, height);

  let frameId = 0;
  let destroyed = false;
  let kickFired = false;
  let explosionFired = false;
  let previousNow = performance.now();
  const startedAt = previousNow;

  originElement?.classList.add("football-motion-trigger");

  function drawSprite(particle, x, y, alpha = 1, scale = 1) {
    const size = particle.size * 8.2 * scale;
    context.globalAlpha = alpha;
    context.drawImage(sprites[particle.colorIndex], x - size / 2, y - size / 2, size, size);
  }

  function drawTrail(from, to, colorIndex, alpha, lineWidth) {
    context.globalAlpha = alpha;
    context.strokeStyle = `rgb(${COLORS[colorIndex].join(",")})`;
    context.lineWidth = lineWidth;
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
      const alpha = Math.min(1, raw * 4) * (0.56 + progress * 0.44);
      drawTrail(previous, point, particle.colorIndex, alpha * 0.42, particle.size * 1.2);
      drawSprite(particle, point.x, point.y, alpha, 1.06);
    }
  }

  function kickProgress(time) {
    return easeInOutCubic(clamp((time - KICK_START) / (KICK_AT - KICK_START), 0, 1));
  }

  function heldPoint(particle, time) {
    const kick = particle.group === "kick-leg" ? kickProgress(time) : 0;
    const pulseAge = Math.max(0, time - ASSEMBLE_END);
    const pulse = 1 + Math.sin(pulseAge * 0.022) * 0.025 * Math.exp(-pulseAge / 720);
    const x = lerp(particle.target.x, particle.kickTarget.x, kick);
    const y = lerp(particle.target.y, particle.kickTarget.y, kick);
    return {
      x: center.x + (x - center.x) * pulse,
      y: center.y + (y - center.y) * pulse,
    };
  }

  function drawBody(time) {
    for (const particle of bodyParticles) {
      const point = heldPoint(particle, time);
      const shimmer = Math.sin(time * 0.007 + particle.phase) * 0.65;
      drawSprite(particle, point.x + shimmer, point.y + shimmer * 0.35, 0.82 + shimmer * 0.12, 1.04);
    }
  }

  function ballPosition(time) {
    const raw = clamp((time - KICK_AT) / 540, 0, 1);
    return {
      progress: easeOutCubic(raw),
      point: quadraticPoint(ballStart, ballControl, ballEnd, easeOutCubic(raw)),
    };
  }

  function rotatePoint(point, angle) {
    return {
      x: point.x * Math.cos(angle) - point.y * Math.sin(angle),
      y: point.x * Math.sin(angle) + point.y * Math.cos(angle),
    };
  }

  function drawBall(time) {
    const flight = ballPosition(time);
    const angle = flight.progress * Math.PI * 5.5;
    const scale = 1 + Math.sin(flight.progress * Math.PI) * 0.16;

    if (flight.progress > 0 && !simple) {
      for (let trailIndex = 5; trailIndex >= 1; trailIndex -= 1) {
        const trailProgress = Math.max(0, flight.progress - trailIndex * 0.035);
        const trailPoint = quadraticPoint(ballStart, ballControl, ballEnd, trailProgress);
        context.globalAlpha = (1 - trailIndex / 6) * 0.2;
        context.fillStyle = trailIndex % 2 ? "rgba(123,255,104,0.7)" : "rgba(53,246,255,0.7)";
        context.beginPath();
        context.arc(trailPoint.x, trailPoint.y, Math.max(1, 5 - trailIndex * 0.55), 0, Math.PI * 2);
        context.fill();
      }
    }

    for (const particle of ballParticles) {
      const rotated = rotatePoint(particle.ballOffset, angle);
      drawSprite(
        particle,
        flight.point.x + rotated.x * scale,
        flight.point.y + rotated.y * scale,
        0.9,
        1.08,
      );
    }
  }

  function drawExplosion(time) {
    const elapsed = (time - EXPLODE_AT) / 1_000;
    const progress = clamp((time - EXPLODE_AT) / (SCENE_DURATION - EXPLODE_AT), 0, 1);
    const alpha = (1 - progress) ** 1.35;
    for (const particle of bodyParticles) {
      const source = heldPoint(particle, KICK_AT);
      const radialX = Math.cos(particle.burstAngle);
      const radialY = Math.sin(particle.burstAngle);
      const tangentX = -radialY;
      const tangentY = radialX;
      const velocityX = radialX * particle.burstSpeed + tangentX * particle.tangentSpeed;
      const velocityY = radialY * particle.burstSpeed + tangentY * particle.tangentSpeed - 45;
      const x = source.x + velocityX * elapsed;
      const y = source.y + velocityY * elapsed + 155 * elapsed * elapsed;
      drawTrail(
        { x: x - velocityX * 0.024, y: y - (velocityY + 290 * elapsed) * 0.024 },
        { x, y },
        particle.colorIndex,
        alpha * 0.52,
        particle.size * 1.2,
      );
      drawSprite(particle, x, y, alpha, 1.1);
    }
  }

  function drawRing(time, start, duration, centerPoint, from, to, colorIndex, alpha = 0.65) {
    const raw = (time - start) / duration;
    if (raw < 0 || raw >= 1) {
      return;
    }
    const progress = easeOutCubic(raw);
    context.globalAlpha = (1 - progress) * alpha;
    context.strokeStyle = `rgb(${COLORS[colorIndex].join(",")})`;
    context.lineWidth = 1.4 + (1 - progress) * 2.2;
    context.beginPath();
    context.arc(centerPoint.x, centerPoint.y, lerp(from, to, progress), 0, Math.PI * 2);
    context.stroke();
  }

  function drawFlash(time, start, duration, centerPoint, strength) {
    const raw = (time - start) / duration;
    if (raw < 0 || raw >= 1) {
      return;
    }
    const alpha = (1 - raw) ** 2 * strength;
    const radius = maxDimension * (0.08 + raw * 0.34);
    const gradient = context.createRadialGradient(centerPoint.x, centerPoint.y, 0, centerPoint.x, centerPoint.y, radius);
    gradient.addColorStop(0, `rgba(255,255,255,${alpha})`);
    gradient.addColorStop(0.2, `rgba(123,255,104,${alpha * 0.6})`);
    gradient.addColorStop(0.52, `rgba(53,246,255,${alpha * 0.24})`);
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    context.globalAlpha = 1;
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
  }

  function drawKickArc(time) {
    const raw = (time - KICK_START) / (KICK_AT - KICK_START + 120);
    if (raw < 0 || raw >= 1 || simple) {
      return;
    }
    const alpha = Math.sin(raw * Math.PI) * 0.72;
    context.globalAlpha = alpha;
    context.strokeStyle = "rgb(123,255,104)";
    context.lineWidth = 2.2;
    context.beginPath();
    context.arc(
      center.x + figureSize * 0.08,
      center.y + figureSize * 0.16,
      figureSize * 0.34,
      -0.15,
      1.22,
    );
    context.stroke();
  }

  function drawBolt(bolt, time) {
    const progress = (time - bolt.start) / bolt.duration;
    if (progress < 0 || progress >= 1 || simple) {
      return;
    }
    const alpha = Math.sin(progress * Math.PI) * 0.96;
    const color = COLORS[bolt.colorIndex];
    for (const [lineWidth, passAlpha, stroke] of [
      [7, 0.16, `rgb(${color.join(",")})`],
      [2.3, 0.76, `rgb(${color.join(",")})`],
      [0.8, 1, "rgb(255,255,255)"],
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

  function destroy() {
    if (destroyed) {
      return;
    }
    destroyed = true;
    window.cancelAnimationFrame(frameId);
    originElement?.classList.remove("football-motion-trigger");
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
    const frameGap = now - previousNow;
    previousNow = now;
    if (document.hidden || frameGap > 250) {
      destroy();
      return;
    }

    const time = now - startedAt;
    let shakeX = 0;
    let shakeY = 0;
    if (time >= EXPLODE_AT && time < EXPLODE_AT + 280 && !simple) {
      const decay = Math.exp(-(time - EXPLODE_AT) / 95);
      shakeX = Math.sin((time - EXPLODE_AT) * 0.13) * 4 * decay;
      shakeY = Math.cos((time - EXPLODE_AT) * 0.16) * 3 * decay;
    }

    context.setTransform(dpr, 0, 0, dpr, shakeX * dpr, shakeY * dpr);
    context.clearRect(-30, -30, width + 60, height + 60);
    context.globalCompositeOperation = "lighter";
    context.lineCap = "round";
    context.lineJoin = "round";

    if (time < ASSEMBLE_END) {
      drawAssembly(time);
    } else if (time < EXPLODE_AT) {
      drawBody(time);
      drawBall(time);
      drawKickArc(time);
    } else {
      drawExplosion(time);
    }

    drawRing(time, ASSEMBLE_END, 540, center, figureSize * 0.26, figureSize * 0.72, 1, 0.42);
    drawRing(time, KICK_AT, 460, ballStart, figureSize * 0.07, figureSize * 0.38, 0, 0.8);
    drawRing(time, KICK_AT + 55, 520, ballStart, figureSize * 0.04, figureSize * 0.5, 3, 0.48);
    drawRing(time, EXPLODE_AT, 680, center, figureSize * 0.2, maxDimension * 0.48, 1, 0.62);
    drawFlash(time, KICK_AT, 380, ballStart, 0.65);
    drawFlash(time, EXPLODE_AT, 480, center, 0.72);
    for (const bolt of bolts) {
      drawBolt(bolt, time);
    }
    context.globalAlpha = 1;

    if (!kickFired && time >= KICK_AT) {
      kickFired = true;
      haptic("heavy");
      options.onKick?.();
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

export function playFootballMotion(originElement, options = {}) {
  activeScene?.destroy?.();
  activeScene = null;
  originElement?.classList.remove("football-motion-trigger");
  void originElement?.offsetWidth;
  originElement?.classList.add("football-motion-trigger");

  try {
    activeScene = createScene(originElement, options);
    return true;
  } catch {
    originElement?.classList.remove("football-motion-trigger");
    return false;
  }
}
