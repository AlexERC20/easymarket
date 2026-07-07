// Welcome motion: сотни светящихся частиц вихрем слетаются со всего экрана и
// собирают молнию EasyMarket, вспышка с ударной волной «фиксирует» логотип,
// после чего молния дышит с микро-разрядами, а при входе в приложение частицы
// разлетаются взрывом. Рисуем на canvas предрендеренными спрайтами свечения
// (без shadowBlur), чтобы держать 60fps в мобильном WebView Telegram.

const BOLT_PATH = "M36.8 3 13.6 35.6h16L24.8 61l25.6-35.8H34.2L36.8 3Z";
const BOLT_BOX = 64;
const WORDMARK = "EASYMARKET";
const TAGLINE = "прогнозируй · выигрывай";

const FLASH_AT = 1560;
const EXIT_DURATION = 680;
const SPRITE_STEPS = 6;

const GRADIENT_STOPS = [
  { at: 0, rgb: [255, 247, 168] },
  { at: 0.45, rgb: [183, 255, 77] },
  { at: 1, rgb: [53, 246, 255] },
];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

function gradientColor(t) {
  const at = clamp(t, 0, 1);
  let lower = GRADIENT_STOPS[0];
  let upper = GRADIENT_STOPS[GRADIENT_STOPS.length - 1];
  for (let i = 0; i < GRADIENT_STOPS.length - 1; i += 1) {
    if (at >= GRADIENT_STOPS[i].at && at <= GRADIENT_STOPS[i + 1].at) {
      lower = GRADIENT_STOPS[i];
      upper = GRADIENT_STOPS[i + 1];
      break;
    }
  }
  const span = upper.at - lower.at || 1;
  const k = (at - lower.at) / span;
  return [
    Math.round(lower.rgb[0] + (upper.rgb[0] - lower.rgb[0]) * k),
    Math.round(lower.rgb[1] + (upper.rgb[1] - lower.rgb[1]) * k),
    Math.round(lower.rgb[2] + (upper.rgb[2] - lower.rgb[2]) * k),
  ];
}

function makeGlowSprite(rgb) {
  const size = 64;
  const sprite = document.createElement("canvas");
  sprite.width = size;
  sprite.height = size;
  const ctx = sprite.getContext("2d");
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255, 255, 255, 0.95)");
  gradient.addColorStop(0.22, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.85)`);
  gradient.addColorStop(0.55, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.22)`);
  gradient.addColorStop(1, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return sprite;
}

function sampleBoltTargets(boltHeight) {
  const scale = boltHeight / BOLT_BOX;
  const size = Math.ceil(BOLT_BOX * scale);
  const off = document.createElement("canvas");
  off.width = size;
  off.height = size;
  const ctx = off.getContext("2d", { willReadFrequently: true });
  ctx.scale(scale, scale);
  ctx.fillStyle = "#fff";
  ctx.fill(new Path2D(BOLT_PATH));
  const data = ctx.getImageData(0, 0, size, size).data;
  const step = Math.max(3, Math.round(boltHeight / 40));
  const points = [];
  for (let y = 0; y < size; y += step) {
    for (let x = 0; x < size; x += step) {
      if (data[(y * size + x) * 4 + 3] > 120) {
        points.push({
          x: x - size / 2 + (Math.random() - 0.5) * step * 0.7,
          y: y - size / 2 + (Math.random() - 0.5) * step * 0.7,
          ny: y / size,
        });
      }
    }
  }
  return points;
}

function haptic(style) {
  try {
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.(style);
  } catch {
    // платформа без хаптики
  }
}

function buildBrand() {
  const root = document.createElement("div");
  root.className = "lm-welcome-brand";
  root.setAttribute("aria-hidden", "true");

  const word = document.createElement("div");
  word.className = "lm-welcome-word";
  [...WORDMARK].forEach((char, index) => {
    const letter = document.createElement("span");
    letter.textContent = char;
    letter.style.setProperty("--i", String(index));
    word.appendChild(letter);
  });

  const tag = document.createElement("div");
  tag.className = "lm-welcome-tag";
  tag.textContent = TAGLINE;

  const progress = document.createElement("div");
  progress.className = "lm-welcome-progress";
  progress.appendChild(document.createElement("i"));

  root.append(word, tag, progress);
  return root;
}

export function createWelcomeMotion(host) {
  const canvas = document.createElement("canvas");
  canvas.className = "lm-welcome-canvas";
  canvas.setAttribute("aria-hidden", "true");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("welcome_motion_no_context");
  }

  const brand = buildBrand();
  host.append(canvas, brand);
  host.classList.add("lm-welcome");

  const sprites = [];
  for (let i = 0; i < SPRITE_STEPS; i += 1) {
    sprites.push(makeGlowSprite(gradientColor(i / (SPRITE_STEPS - 1))));
  }
  const sparkSprite = makeGlowSprite([255, 244, 190]);

  let width = 0;
  let height = 0;
  let dpr = 1;
  let maxDim = 0;
  let boltCx = 0;
  let boltCy = 0;
  let boltHeight = 0;

  let particles = [];
  const ambient = [];
  const sparks = [];
  const rings = [];
  const arcs = [];

  let flashFired = false;
  let flashT = -1;
  let shakeT = -1;
  let exitT = -1;
  let nextArcAt = Infinity;
  let nextDripAt = Infinity;
  let destroyed = false;
  let raf = 0;
  let resizeTimer = 0;

  const t0 = performance.now();
  let lastNow = t0;

  function layoutBrand() {
    brand.style.top = `${Math.round(boltCy + boltHeight / 2 + 30)}px`;
  }

  function measure() {
    const rect = host.getBoundingClientRect();
    width = Math.max(1, Math.round(rect.width || window.innerWidth));
    height = Math.max(1, Math.round(rect.height || window.innerHeight));
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    maxDim = Math.hypot(width, height);
  }

  function buildScene() {
    measure();
    boltCx = width / 2;
    boltCy = Math.round(height * 0.44);
    boltHeight = Math.round(clamp(Math.min(width * 0.52, height * 0.34), 148, 232));
    layoutBrand();

    particles = sampleBoltTargets(boltHeight).map((pt) => {
      const tx = boltCx + pt.x;
      const ty = boltCy + pt.y;
      const angle = Math.random() * Math.PI * 2;
      const radius = maxDim * (0.34 + Math.random() * 0.3);
      const sx = boltCx + Math.cos(angle) * radius;
      const sy = boltCy + Math.sin(angle) * radius;
      const dx = tx - sx;
      const dy = ty - sy;
      const dist = Math.hypot(dx, dy) || 1;
      const swirl = dist * (0.2 + Math.random() * 0.32);
      const trailStyle = `rgb(${gradientColor(pt.ny).join(",")})`;
      return {
        trailStyle,
        tx,
        ty,
        sx,
        sy,
        c1x: (sx + tx) / 2 - (dy / dist) * swirl,
        c1y: (sy + ty) / 2 + (dx / dist) * swirl,
        x: sx,
        y: sy,
        px: sx,
        py: sy,
        vx: 0,
        vy: 0,
        delay: pt.ny * 240 + Math.random() * 190,
        dur: 760 + Math.random() * 360,
        size: 0.85 + Math.random() * 0.95,
        sprite: sprites[Math.round(pt.ny * (SPRITE_STEPS - 1))],
        seed: Math.random() * Math.PI * 2,
        wob: 0.75 + Math.random() * 0.5,
      };
    });

    ambient.length = 0;
    for (let i = 0; i < 26; i += 1) {
      ambient.push({
        x: Math.random() * width,
        y: Math.random() * height,
        drift: 3 + Math.random() * 9,
        seed: Math.random() * Math.PI * 2,
        size: 0.6 + Math.random() * 1.1,
        sprite: sprites[Math.floor(Math.random() * SPRITE_STEPS)],
      });
    }
  }

  function shiftScene() {
    const prevCx = boltCx;
    const prevCy = boltCy;
    measure();
    boltCx = width / 2;
    boltCy = Math.round(height * 0.44);
    const dx = boltCx - prevCx;
    const dy = boltCy - prevCy;
    layoutBrand();
    if (!dx && !dy) {
      return;
    }
    for (const p of particles) {
      p.tx += dx;
      p.ty += dy;
      p.sx += dx;
      p.sy += dy;
      p.c1x += dx;
      p.c1y += dy;
      p.x += dx;
      p.y += dy;
      p.px += dx;
      p.py += dy;
    }
  }

  function drawSprite(sprite, x, y, size, alpha) {
    ctx.globalAlpha = alpha;
    ctx.drawImage(sprite, x - size / 2, y - size / 2, size, size);
  }

  function drawCore(x, y, alpha, size = 1.4) {
    ctx.globalAlpha = alpha;
    ctx.fillRect(x - size / 2, y - size / 2, size, size);
  }

  function spawnRing(t, delay, rgb, lineWidth, dur) {
    rings.push({ start: t + delay, dur, rgb, lineWidth, from: boltHeight * 0.28, to: maxDim * 0.52 });
  }

  function spawnBurstSparks(count, speedMin, speedMax) {
    for (let i = 0; i < count; i += 1) {
      const origin = particles[Math.floor(Math.random() * particles.length)];
      if (!origin) {
        return;
      }
      const dx = origin.tx - boltCx;
      const dy = origin.ty - boltCy;
      const dist = Math.hypot(dx, dy) || 1;
      const jitter = (Math.random() - 0.5) * 1.1;
      const angle = Math.atan2(dy, dx) + jitter;
      const speed = speedMin + Math.random() * (speedMax - speedMin);
      sparks.push({
        x: origin.tx,
        y: origin.ty,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 40,
        life: 0,
        ttl: 0.48 + Math.random() * 0.42,
        size: 0.7 + Math.random() * 0.8,
      });
    }
  }

  function spawnArc(t) {
    if (particles.length < 2) {
      return;
    }
    const a = particles[Math.floor(Math.random() * particles.length)];
    let b = particles[Math.floor(Math.random() * particles.length)];
    for (let tries = 0; tries < 6; tries += 1) {
      if (Math.hypot(b.tx - a.tx, b.ty - a.ty) > boltHeight * 0.35) {
        break;
      }
      b = particles[Math.floor(Math.random() * particles.length)];
    }
    const points = [];
    const segments = 7;
    for (let i = 0; i <= segments; i += 1) {
      const k = i / segments;
      const nx = a.tx + (b.tx - a.tx) * k;
      const ny = a.ty + (b.ty - a.ty) * k;
      const off = i === 0 || i === segments ? 0 : (Math.random() - 0.5) * boltHeight * 0.12;
      points.push([nx + off, ny + off * 0.4]);
    }
    arcs.push({ points, start: t, dur: 150 });
  }

  function fireFlash(t) {
    flashFired = true;
    flashT = t;
    shakeT = t;
    nextArcAt = t + 900;
    nextDripAt = t + 500;
    spawnRing(t, 0, [183, 255, 77], 2.6, 620);
    spawnRing(t, 90, [53, 246, 255], 1.6, 720);
    spawnBurstSparks(44, 90, 340);
    host.classList.add("lm-welcome-brand-in");
    haptic("heavy");
  }

  function drawConverge(t) {
    for (const p of particles) {
      const local = (t - p.delay) / p.dur;
      if (local <= 0) {
        const driftX = p.sx + Math.sin(p.seed + t * 0.0011) * 6;
        const driftY = p.sy + Math.cos(p.seed * 1.6 + t * 0.0009) * 6;
        p.x = driftX;
        p.y = driftY;
        p.px = driftX;
        p.py = driftY;
        drawSprite(p.sprite, driftX, driftY, p.size * 5, 0.3);
        continue;
      }
      const u = easeInOutCubic(Math.min(1, local));
      const omu = 1 - u;
      const x = omu * omu * p.sx + 2 * omu * u * p.c1x + u * u * p.tx;
      const y = omu * omu * p.sy + 2 * omu * u * p.c1y + u * u * p.ty;
      const alpha = Math.min(1, local * 5) * (0.55 + 0.45 * u);

      ctx.globalAlpha = alpha * 0.4;
      ctx.strokeStyle = p.trailStyle;
      ctx.lineWidth = p.size * 1.4;
      ctx.beginPath();
      ctx.moveTo(p.px, p.py);
      ctx.lineTo(x, y);
      ctx.stroke();

      drawSprite(p.sprite, x, y, p.size * 7, alpha * 0.9);
      ctx.fillStyle = "#fff";
      drawCore(x, y, alpha * 0.85);

      p.px = x;
      p.py = y;
      p.x = x;
      p.y = y;
    }
  }

  function drawIdle(t) {
    const heat = Math.exp(-(t - flashT) / 640);
    for (const p of particles) {
      const x = p.tx + Math.sin(t * 0.0016 * p.wob + p.seed) * 0.8;
      const y = p.ty + Math.cos(t * 0.0013 * p.wob + p.seed * 1.7) * 0.8;
      const wave = 0.62 + 0.38 * Math.sin(t * 0.0032 - ((p.ty - boltCy) / boltHeight) * 5.2 + p.seed * 0.2);
      const alpha = wave * (0.7 + heat * 0.35);
      drawSprite(p.sprite, x, y, p.size * (6.4 + heat * 1.6), Math.min(1, alpha));
      ctx.fillStyle = "#fff";
      drawCore(x, y, Math.min(1, alpha * 0.8));
      p.x = x;
      p.y = y;
      p.px = x;
      p.py = y;
    }

    for (const dust of ambient) {
      const x = dust.x + Math.sin(dust.seed + t * 0.0004) * dust.drift;
      const y = dust.y + Math.cos(dust.seed * 1.4 + t * 0.0003) * dust.drift;
      const twinkle = 0.06 + 0.06 * Math.sin(dust.seed * 3 + t * 0.002);
      drawSprite(dust.sprite, x, y, dust.size * 6, twinkle);
    }

    if (t >= nextArcAt) {
      spawnArc(t);
      nextArcAt = t + 950 + Math.random() * 900;
    }
    if (t >= nextDripAt) {
      spawnBurstSparks(1, 16, 48);
      nextDripAt = t + 620 + Math.random() * 620;
    }
  }

  function startExit() {
    if (exitT >= 0 || destroyed) {
      return;
    }
    const t = performance.now() - t0;
    exitT = t;
    for (const p of particles) {
      const dx = p.x - boltCx;
      const dy = p.y - boltCy;
      const dist = Math.hypot(dx, dy) || 1;
      const speed = 150 + Math.random() * 260;
      const tangent = (Math.random() - 0.5) * 160;
      p.vx = (dx / dist) * speed - (dy / dist) * tangent;
      p.vy = (dy / dist) * speed + (dx / dist) * tangent - 40;
    }
    spawnRing(t, 0, [53, 246, 255], 1.8, 560);
    spawnBurstSparks(18, 120, 320);
    host.classList.remove("lm-welcome-brand-in");
    host.classList.add("lm-welcome-out");
    haptic("light");
  }

  function drawExit(t, dt) {
    const k = clamp((t - exitT) / EXIT_DURATION, 0, 1);
    const fade = (1 - k) ** 1.4;
    for (const p of particles) {
      p.px = p.x;
      p.py = p.y;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 220 * dt;

      ctx.globalAlpha = fade * 0.35;
      ctx.strokeStyle = p.trailStyle;
      ctx.lineWidth = p.size * 1.4;
      ctx.beginPath();
      ctx.moveTo(p.px, p.py);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();

      drawSprite(p.sprite, p.x, p.y, p.size * 6.5, fade * 0.9);
    }
  }

  function drawSparks(dt) {
    ctx.fillStyle = "#fff";
    for (let i = sparks.length - 1; i >= 0; i -= 1) {
      const spark = sparks[i];
      spark.life += dt;
      if (spark.life >= spark.ttl) {
        sparks.splice(i, 1);
        continue;
      }
      spark.x += spark.vx * dt;
      spark.y += spark.vy * dt;
      spark.vy += 190 * dt;
      const alpha = (1 - spark.life / spark.ttl) * 0.85;
      drawSprite(sparkSprite, spark.x, spark.y, spark.size * 6, alpha);
      drawCore(spark.x, spark.y, alpha, 1.1);
    }
  }

  function drawRings(t) {
    for (let i = rings.length - 1; i >= 0; i -= 1) {
      const ring = rings[i];
      const k = (t - ring.start) / ring.dur;
      if (k >= 1) {
        rings.splice(i, 1);
        continue;
      }
      if (k < 0) {
        continue;
      }
      const eased = easeOutCubic(k);
      ctx.globalAlpha = (1 - eased) * 0.55;
      ctx.strokeStyle = `rgb(${ring.rgb.join(",")})`;
      ctx.lineWidth = ring.lineWidth;
      ctx.beginPath();
      ctx.arc(boltCx, boltCy, ring.from + (ring.to - ring.from) * eased, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function drawArcs(t) {
    for (let i = arcs.length - 1; i >= 0; i -= 1) {
      const arc = arcs[i];
      const k = (t - arc.start) / arc.dur;
      if (k >= 1) {
        arcs.splice(i, 1);
        continue;
      }
      const alpha = (1 - k) * 0.9;
      for (const [pass, lineWidth, passAlpha] of [[0, 3.5, 0.28], [1, 1.3, 1]]) {
        ctx.globalAlpha = alpha * passAlpha;
        ctx.strokeStyle = pass === 0 ? "rgb(53, 246, 255)" : "rgb(240, 255, 250)";
        ctx.lineWidth = lineWidth;
        ctx.beginPath();
        arc.points.forEach(([x, y], index) => {
          if (index === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        });
        ctx.stroke();
      }
    }
  }

  function drawFlash(t) {
    if (flashT < 0) {
      return;
    }
    const k = (t - flashT) / 380;
    if (k < 0 || k >= 1) {
      return;
    }
    const alpha = (1 - k) ** 2 * 0.45;
    const gradient = ctx.createRadialGradient(boltCx, boltCy, 0, boltCx, boltCy, maxDim * 0.55);
    gradient.addColorStop(0, `rgba(240, 255, 235, ${alpha})`);
    gradient.addColorStop(0.3, `rgba(170, 240, 200, ${alpha * 0.35})`);
    gradient.addColorStop(1, "rgba(53, 246, 255, 0)");
    ctx.globalAlpha = 1;
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }

  function frame(now) {
    if (destroyed) {
      return;
    }
    const t = now - t0;
    const dt = Math.min(0.05, (now - lastNow) / 1000);
    lastNow = now;

    let shakeX = 0;
    let shakeY = 0;
    if (shakeT >= 0 && t - shakeT < 320) {
      const decay = Math.exp(-(t - shakeT) / 110);
      shakeX = Math.sin((t - shakeT) * 0.11) * 4 * decay;
      shakeY = Math.cos((t - shakeT) * 0.14) * 3 * decay;
    }

    ctx.setTransform(dpr, 0, 0, dpr, shakeX * dpr, shakeY * dpr);
    ctx.clearRect(-24, -24, width + 48, height + 48);
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";

    if (exitT >= 0) {
      drawExit(t, dt);
    } else if (t < FLASH_AT) {
      drawConverge(t);
    } else {
      if (!flashFired) {
        fireFlash(t);
      }
      drawIdle(t);
    }

    drawSparks(dt);
    drawRings(t);
    drawArcs(t);
    drawFlash(t);
    ctx.globalAlpha = 1;

    if (exitT >= 0 && t - exitT > EXIT_DURATION + 80 && !sparks.length) {
      destroyed = true;
      window.removeEventListener("resize", onResize);
      return;
    }
    raf = window.requestAnimationFrame(frame);
  }

  function onResize() {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (!destroyed) {
        shiftScene();
      }
    }, 140);
  }

  function destroy() {
    if (destroyed) {
      return;
    }
    destroyed = true;
    window.cancelAnimationFrame(raf);
    window.clearTimeout(resizeTimer);
    window.removeEventListener("resize", onResize);
  }

  buildScene();
  window.addEventListener("resize", onResize);
  host.classList.add("lm-welcome-live");
  raf = window.requestAnimationFrame(frame);

  return { startExit, destroy };
}
