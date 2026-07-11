// Shake-сцена «Легенда 24» — трибьют величайшему №24.
//
// Мячи осыпаются со свечей графика, с левого края выбегает неоновый силуэт
// и кладёт красивые трёхочковые в кольцо у правого края. Коронка — turnaround
// fadeaway: пауза спиной к кольцу (на спине вспыхивает «24»), разворот,
// зависание в slow-mo и золотисто-фиолетовый след мяча — цвета, которые
// фанаты считают мгновенно.
//
// Canvas-режим на всех платформах: сцена живёт короткими бурстами сразу после
// встряски, когда rAF в iOS Telegram ещё жив; страховочный степпер оркестратора
// добивает кадры, если WKWebView начинает душить rAF. Перф-правила аквариума
// соблюдены: ~30fps, без shadowBlur и per-frame фильтров, свечение — только
// предрендеренными спрайтами, частицы жёстко капнуты.

import { registerScene } from "./shake-scenes.js?v=20260712-01";
import { playMotionSound } from "./lightning-motion.js?v=20260707-01";

const INK = "#0a1322"; // тело силуэта
const CORE = "#b7ff4d"; // энергетическое ядро (лайм)
const CORE_2 = "#35f6ff"; // циан
const GOLD = "#ffd36b";
const VIOLET = "#a56cff";
const BALL_BASE = "#ff9d3f";
const BALL_SEAM = "#8a3d0f";

const MAX_BALLS = 6;
const MAX_PARTICLES = 90;
const GRAVITY = 2.05; // ×height/сек² — одна гравитация на мячи и брызги

let enabled = true;
let runtimeAllowed = false;
let runtime = null;
let surface = null;
let tilt = 0;

let phase = "idle"; // idle | enter | play | celebrate | exit
let balls = [];
let particles = [];
let popups = [];
let streaks = []; // световые росчерки за игроком на входе
let floorFlashes = []; // блики пола в точках отскока мяча
let combo = 0; // свищи подряд — живёт всю сессию
let flashTint = 0; // полноэкранная вспышка на комбо 24
let slowmoLeft = 0; // реального времени осталось в slow-mo
let timeScale = 1;
let shotsSinceSignature = 0;
let pendingSummonStrength = 0;

let ballGlowSprite = null;

// ---------------------------------------------------------------------------
// Спрайты свечения (рисуются один раз)

function makeGlow(rgb, coreAlpha = 0.5) {
  const size = 96;
  const sprite = document.createElement("canvas");
  sprite.width = size;
  sprite.height = size;
  const g = sprite.getContext("2d");
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, `rgba(${rgb},${coreAlpha})`);
  grad.addColorStop(0.55, `rgba(${rgb},${coreAlpha * 0.28})`);
  grad.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return sprite;
}

function ensureSprites() {
  ballGlowSprite ||= makeGlow("255, 157, 63", 0.42);
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const easeInCubic = (t) => t ** 3;
const easeInOut = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
const easeOutBack = (t) => 1 + 2.3 * (t - 1) ** 3 + 1.3 * (t - 1) ** 2;

// ---------------------------------------------------------------------------
// Геометрия сцены

function metrics() {
  const width = surface?.width || 0;
  const height = surface?.height || 0;
  const ph = Math.max(50, Math.min(88, height * 0.24)); // рост игрока
  return {
    width,
    height,
    ph,
    floorY: height * 0.93,
    playerX: width * 0.17,
    hoopX: width * 0.865,
    rimY: height * 0.42,
    rimR: ph * 0.17,
    ballR: Math.max(4.5, ph * 0.085),
  };
}

// ---------------------------------------------------------------------------
// Игрок: скелет из поз, интерполяция и FK
//
// Углы: 0 — сегмент направлен вниз, положительные — вперёд (к кольцу).
// Поза — плоский набор чисел, интерполируется покомпонентно.

// Конвенция: 0 = сегмент вниз, положительное = вперёд (к кольцу), «верх» = ±π.
// Броски живут на ПОЛОЖИТЕЛЬНОЙ стороне (вверх-вперёд, 2.7..3.0) — на
// отрицательной рука уходит вверх-назад, и силуэт «бросает задом наперёд».
// Колени всегда отрицательные: голень складывается назад, а не как у птицы.
const POSES = {
  stand: { crouch: 0.06, lean: 0.04, shF: 0.18, elF: 0.4, shB: -0.14, elB: 0.35, hipF: 0.04, kneeF: -0.1, hipB: -0.05, kneeB: -0.08, run: 0 },
  run: { crouch: 0.16, lean: 0.22, shF: 0, elF: 1.15, shB: 0, elB: 1.15, hipF: 0, kneeF: -0.3, hipB: 0, kneeB: -0.3, run: 1 },
  dribble: { crouch: 0.3, lean: 0.24, shF: 0.7, elF: 0.6, shB: -0.35, elB: 0.45, hipF: 0.22, kneeF: -0.5, hipB: -0.28, kneeB: -0.3, run: 0 },
  gather: { crouch: 0.46, lean: 0.18, shF: 0.5, elF: 0.9, shB: 0.3, elB: 1, hipF: 0.28, kneeF: -0.75, hipB: -0.3, kneeB: -0.45, run: 0 },
  // Сет-поинт: мяч над лбом, предплечье сложено назад над головой.
  rise: { crouch: 0.1, lean: 0.02, shF: 2.9, elF: 0.7, shB: 2.3, elB: 0.55, hipF: 0.55, kneeF: -1.05, hipB: -0.15, kneeB: -0.5, run: 0 },
  // Выпуск: рука выстреливает вверх-вперёд к кольцу, ведущая ладонь падает.
  release: { crouch: 0.02, lean: 0.04, shF: 2.75, elF: 0.1, shB: -0.5, elB: 0.4, hipF: 0.3, kneeF: -0.55, hipB: -0.2, kneeB: -0.35, run: 0 },
  // Follow-through: кисть щёлкает вперёд-вниз, рука остаётся вытянутой.
  followThrough: { crouch: 0.05, lean: 0.05, shF: 2.68, elF: -0.28, shB: -0.45, elB: 0.4, hipF: 0.25, kneeF: -0.45, hipB: -0.22, kneeB: -0.3, run: 0 },
  fadeRise: { crouch: 0.08, lean: -0.3, shF: 2.95, elF: 0.75, shB: 2.2, elB: 0.6, hipF: 0.7, kneeF: -0.9, hipB: 0.1, kneeB: -0.65, run: 0 },
  fadeRelease: { crouch: 0.02, lean: -0.34, shF: 2.8, elF: 0.08, shB: -0.4, elB: 0.45, hipF: 0.55, kneeF: -0.6, hipB: 0.05, kneeB: -0.5, run: 0 },
  fadeFollow: { crouch: 0.04, lean: -0.32, shF: 2.72, elF: -0.25, shB: -0.5, elB: 0.4, hipF: 0.5, kneeF: -0.5, hipB: 0.02, kneeB: -0.45, run: 0 },
  backHold: { crouch: 0.24, lean: 0.1, shF: 0.5, elF: 0.95, shB: 0.4, elB: 1.05, hipF: 0.12, kneeF: -0.3, hipB: -0.12, kneeB: -0.22, run: 0 },
  land: { crouch: 0.36, lean: 0.12, shF: 0.5, elF: 0.5, shB: -0.4, elB: 0.45, hipF: 0.3, kneeF: -0.7, hipB: -0.3, kneeB: -0.5, run: 0 },
  celebrate: { crouch: 0.03, lean: -0.06, shF: 3, elF: -0.08, shB: -0.35, elB: 0.4, hipF: 0.08, kneeF: -0.18, hipB: -0.08, kneeB: -0.12, run: 0 },
  // Защитник: стойка, контест с вытянутой рукой и поникший уход.
  defense: { crouch: 0.42, lean: 0.18, shF: -1.05, elF: 0.5, shB: 1.15, elB: 0.4, hipF: 0.4, kneeF: -0.85, hipB: -0.42, kneeB: -0.6, run: 0 },
  contest: { crouch: 0.06, lean: -0.04, shF: 3.05, elF: 0.06, shB: 0.5, elB: 0.4, hipF: 0.45, kneeF: -0.8, hipB: -0.15, kneeB: -0.45, run: 0 },
  dejected: { crouch: 0.22, lean: 0.34, shF: 0.25, elF: 0.2, shB: -0.2, elB: 0.2, hipF: 0.05, kneeF: -0.2, hipB: -0.06, kneeB: -0.15, run: 0 },
};

function lerpPose(a, b, t) {
  const out = {};
  for (const k of Object.keys(a)) {
    out[k] = a[k] + (b[k] - a[k]) * t;
  }
  return out;
}

function makeActor() {
  return {
    active: false,
    x: 0,
    facing: 1, // визуальный (скользит), 1 = лицом к кольцу
    facingTarget: 1,
    airY: 0,
    airX: 0,
    sway: 0, // покачивание корпуса на дриблинге
    pose: { ...POSES.stand },
    from: { ...POSES.stand },
    to: { ...POSES.stand },
    t: 0,
    dur: 0.001,
    ease: easeInOut,
    queue: [], // очередь действий {to, dur, ease, onStart, onDone}
    onDone: null,
    runPhase: Math.random() * Math.PI * 2,
    jump: null,
  };
}

// Звезда: неоново-лаймовое ядро, номер 24, мяч.
const player = Object.assign(makeActor(), {
  heldBall: null,
  wants24: false, // замах коронки: просим «24» на спину
  show24: 0, // альфа номера на спине
  celebrating24: 0,
});

// Защитник: розовое ядро, выбегает на коронку и получает бросок через себя.
const defender = Object.assign(makeActor(), {
  mode: null, // enter | guard | jump | sad | exit
});

const PLAYER_STYLE = {
  coreLimb: "rgba(183, 255, 77, 0.85)",
  coreBack: "rgba(53, 246, 255, 0.34)",
  coreTorso: "rgba(183, 255, 77, 0.75)",
  head: "rgba(53, 246, 255, 0.8)",
  glowRgb: "53, 246, 255",
};

const DEFENDER_STYLE = {
  coreLimb: "rgba(255, 92, 138, 0.8)",
  coreBack: "rgba(255, 92, 138, 0.3)",
  coreTorso: "rgba(255, 92, 138, 0.7)",
  head: "rgba(255, 130, 165, 0.8)",
  glowRgb: "255, 92, 138",
};

function actorAct(actor, actions) {
  actor.queue.push(...actions);
}

function playerAct(actions) {
  actorAct(player, actions);
}

function stepActor(actor, dt) {
  if (!actor.active) {
    return;
  }
  // В беге цикл шагов крутится заметно быстрее, чем «дыхание» на месте.
  actor.runPhase += dt * (9 + (actor.pose?.run || 0) * 5);
  actor.facing += (actor.facingTarget - actor.facing) * Math.min(1, dt * 7);
  actor.t += dt;
  if (actor.t >= actor.dur) {
    const done = actor.queue.length === 0;
    if (!done) {
      const next = actor.queue.shift();
      actor.from = { ...actor.pose };
      actor.to = { ...POSES[next.to] };
      actor.dur = Math.max(0.05, next.dur);
      actor.ease = next.ease || easeInOut;
      actor.t = 0;
      actor.onDone = next.onDone || null;
      next.onStart?.();
    } else if (actor.onDone) {
      const cb = actor.onDone;
      actor.onDone = null;
      cb();
    }
  } else {
    const k = actor.ease(Math.min(1, actor.t / actor.dur));
    actor.pose = lerpPose(actor.from, actor.to, k);
  }
  if (actor.onDone && actor.t >= actor.dur) {
    const cb = actor.onDone;
    actor.onDone = null;
    cb();
  }
}

// FK: joints в локальных координатах актёра (x вперёд, y вниз, ноги на 0).
function joints(actor, m) {
  const p = actor.pose;
  const s = m.ph;
  const legL = s * 0.41;
  const torso = s * 0.31;
  const upper = s * 0.155;
  const fore = s * 0.15;
  const thigh = s * 0.215;
  const shin = s * 0.2;

  // «Дыхание» на месте: едва заметный вертикальный ход корпуса, гаснет в беге
  // и прыжке — силуэт никогда не стоит замороженным.
  const breathe = Math.sin(actor.runPhase * 0.6) * s * 0.012 * (1 - p.run) * (actor.jump ? 0 : 1);
  // Подскок бегового шага: тело выше всего в «полёте» (ноги в ножницах).
  const stride = Math.sin(actor.runPhase);
  const runBounce = p.run * Math.abs(stride) * s * 0.045;
  const hipY = -legL * (1 - p.crouch * 0.34) - actor.airY + breathe - runBounce;
  const hip = { x: actor.airX + actor.sway, y: hipY };
  const lean = p.lean + actor.sway * 0.01;
  const neck = { x: hip.x + Math.sin(lean) * torso, y: hip.y - Math.cos(lean) * torso };
  const head = { x: neck.x + Math.sin(lean) * s * 0.09, y: neck.y - Math.cos(lean) * s * 0.115 };

  const limb = (root, a1, l1, a2, l2) => {
    const mid = { x: root.x + Math.sin(a1) * l1, y: root.y + Math.cos(a1) * l1 };
    const tip = { x: mid.x + Math.sin(a1 + a2) * l2, y: mid.y + Math.cos(a1 + a2) * l2 };
    return { mid, tip };
  };

  // Беговой цикл: нога проходит через вертикаль вперёд-назад, колено
  // складывается НАЗАД (пятка вверх у задней ноги), руки — в противофазе
  // ногам. Иначе силуэт «бежит задом наперёд».
  const mix = (a, b) => a + (b - a) * p.run;
  const legFAng = mix(p.hipF, stride * 0.8);
  const legBAng = mix(p.hipB, -stride * 0.8);
  const kneeFAng = mix(p.kneeF, -(0.15 + Math.max(0, -stride) * 1.2));
  const kneeBAng = mix(p.kneeB, -(0.15 + Math.max(0, stride) * 1.2));
  const armFAng = mix(p.shF, -stride * 0.7 - 0.12);
  const armBAng = mix(p.shB, stride * 0.7 - 0.12);
  const elFAng = mix(p.elF, 1.15);
  const elBAng = mix(p.elB, 1.15);

  const armF = limb(neck, armFAng, upper, elFAng, fore);
  const armB = limb(neck, armBAng, upper, elBAng, fore);
  const legF = limb(hip, legFAng, thigh, kneeFAng, shin);
  const legB = limb(hip, legBAng, thigh, kneeBAng, shin);

  return { hip, neck, head, armF, armB, legF, legB, headR: s * 0.085 };
}

function handWorld(m) {
  const j = joints(player, m);
  return {
    x: player.x + j.armF.tip.x * player.facing,
    y: m.floorY + j.armF.tip.y,
  };
}

// ---------------------------------------------------------------------------
// Кольцо

const hoop = { visible: 0, netWave: 0, netPhase: 0, flash: 0, ring: 0, ringGold: false };

function netAnchors(m) {
  // 5 нитей: точки на ободе → нижнее кольцо поуже
  const anchors = [];
  for (let i = 0; i < 5; i += 1) {
    const k = i / 4 - 0.5; // -0.5..0.5
    anchors.push({
      top: { x: m.hoopX + k * 2 * m.rimR * 0.92, y: m.rimY + Math.abs(k) * m.rimR * 0.1 },
      bot: { x: m.hoopX + k * 2 * m.rimR * 0.52, y: m.rimY + m.rimR * 1.55 },
    });
  }
  return anchors;
}

// ---------------------------------------------------------------------------
// Мячи

function spawnBalls(count, m) {
  for (let i = 0; i < count && balls.length < MAX_BALLS; i += 1) {
    balls.push({
      x: rand(m.width * 0.08, m.width * 0.6),
      y: -m.ballR * 2 - i * m.height * 0.12,
      vx: rand(-8, 8),
      vy: rand(0, 20),
      r: m.ballR,
      rot: rand(0, Math.PI * 2),
      state: "falling", // falling | queue | held | flight | drop
      bounces: 0,
      squash: 0,
      trail: [],
      signature: false,
      rattle: false,
      flightT: 0,
      flightDur: 0,
    });
  }
}

// Решаем параболу так, чтобы мяч гарантированно пришёл в цель.
function launchBall(ball, fromX, fromY, targetX, targetY, m, forcedT = 0) {
  const dist = Math.abs(targetX - fromX);
  const T = forcedT || 0.72 + (dist / Math.max(1, m.width)) * 0.55;
  const g = GRAVITY * m.height;
  ball.x = fromX;
  ball.y = fromY;
  ball.vx = (targetX - fromX) / T;
  ball.vy = (targetY - fromY - 0.5 * g * T * T) / T;
  ball.state = "flight";
  ball.flightT = 0;
  ball.flightDur = T;
  ball.targetX = targetX;
  ball.targetY = targetY;
  ball.trail = [];
}

function swish(ball, m) {
  hoop.netWave = ball.rattle ? 0.7 : 1;
  hoop.flash = 1;
  hoop.ring = 1;
  hoop.ringGold = ball.signature;
  combo += 1;
  shotsSinceSignature += 1;
  const gold = ball.signature;
  const sparkA = gold ? "255, 211, 107" : "183, 255, 77";
  const sparkB = gold ? "165, 108, 255" : "53, 246, 255";
  const count = gold ? 26 : 16;
  for (let i = 0; i < count && particles.length < MAX_PARTICLES; i += 1) {
    const a = rand(-Math.PI, 0) + Math.PI / 2; // веером вниз-в стороны
    const sp = rand(30, gold ? 150 : 110);
    particles.push({
      x: m.hoopX + rand(-m.rimR * 0.5, m.rimR * 0.5),
      y: m.rimY + m.rimR * rand(0.4, 1.4),
      vx: Math.sin(a) * sp,
      vy: Math.cos(a) * sp * 0.5 - rand(10, 60),
      age: 0,
      life: rand(0.5, gold ? 1.1 : 0.85),
      size: rand(1.2, gold ? 3.2 : 2.4),
      rgb: Math.random() > 0.5 ? sparkA : sparkB,
    });
  }
  popups.push({
    text: "+3",
    x: m.hoopX,
    y: m.rimY - m.rimR * 2.2,
    age: 0,
    life: 1.05,
    size: m.ph * 0.3,
    color: gold ? GOLD : CORE,
  });
  if (combo >= 2) {
    popups.push({
      text: `×${combo}`,
      x: m.hoopX + m.rimR * 2.2,
      y: m.rimY - m.rimR * 0.6,
      age: 0,
      life: 0.9,
      size: m.ph * 0.17,
      color: CORE_2,
    });
  }
  if (combo === 8 || combo === 24) {
    // Пасхалка для знающих: оба номера легенды.
    popups.push({
      text: String(combo),
      x: m.width * 0.5,
      y: m.height * 0.3,
      age: 0,
      life: 1.5,
      size: m.ph * (combo === 24 ? 0.85 : 0.6),
      color: combo === 24 ? GOLD : VIOLET,
    });
    flashTint = combo === 24 ? 1 : 0.5;
    playMotionSound("win");
  } else {
    playMotionSound(gold ? "tap-strong" : "success");
  }
  try {
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.(gold ? "medium" : "light");
  } catch {
    // хаптика опциональна
  }
}

// ---------------------------------------------------------------------------
// Режиссура

function startShow(m) {
  phase = "enter";
  player.active = true;
  player.x = -m.ph;
  player.facingTarget = 1;
  player.facing = 1;
  player.airY = 0;
  player.airX = 0;
  player.pose = { ...POSES.run };
  player.from = { ...POSES.run };
  player.to = { ...POSES.run };
  player.queue = [];
  player.onDone = null;
  player.jump = null;
  player.wants24 = false;
  player.sway = 0;
  player.t = 0;
  player.dur = 0.001;
  hoop.netPhase = 0;
  for (let i = 0; i < 3; i += 1) {
    streaks.push({ y: m.floorY - m.ph * (0.25 + i * 0.22), age: 0, life: 0.55 + i * 0.1 });
  }
}

function nextShot(m) {
  const ball = balls.find((b) => b.state === "queue");
  if (!ball) {
    if (balls.some((b) => b.state === "falling" || b.state === "flight" || b.state === "drop")) {
      // мячи ещё в полёте/падают — подождём в стойке
      playerAct([{ to: "stand", dur: 0.3 }]);
      window.setTimeout(() => phase === "play" && nextShot(m), 420);
      return;
    }
    finishShow(m);
    return;
  }
  ball.state = "held";
  player.heldBall = ball;
  const remaining = balls.filter((b) => b.state === "queue").length;
  const signature = remaining === 0 || shotsSinceSignature >= 3;
  ball.signature = signature;
  ball.rattle = !signature && Math.random() < 0.18;
  if (signature) {
    shotsSinceSignature = 0;
    signatureShot(ball, m);
  } else {
    regularShot(ball, m);
  }
}

function releaseHeld(ball, m, slow) {
  if (player.heldBall !== ball) {
    return; // сцену свернули, пока таймер ждал
  }
  const hand = handWorld(m);
  const target = ball.rattle
    ? { x: m.hoopX - m.rimR * 0.72, y: m.rimY - m.rimR * 0.2 }
    : { x: m.hoopX, y: m.rimY };
  launchBall(ball, hand.x, hand.y - ball.r * 0.6, target.x, target.y, m);
  player.heldBall = null;
  playMotionSound("tap-strong");
  if (slow) {
    slowmoLeft = 0.5;
  }
}

function regularShot(ball, m) {
  playerAct([
    // Кроссовер: три удара с переносом мяча с руки на руку и покачиванием.
    { to: "dribble", dur: 0.22, onStart: () => { ball.dribble = { t: 0, n: 3, cross: true }; } },
    { to: "dribble", dur: 0.72 },
    { to: "gather", dur: 0.2 },
    { to: "rise", dur: 0.16, ease: easeOutCubic, onStart: () => { player.jump = { t: 0, dur: 0.66, h: m.ph * 0.5, drift: 0 }; } },
    {
      to: "release",
      dur: 0.14,
      ease: easeOutCubic,
      onStart: () => {
        window.setTimeout(() => releaseHeld(ball, m, false), 80);
      },
    },
    // Рука держит follow-through, пока мяч летит — читается как класс.
    { to: "followThrough", dur: 0.3 },
    { to: "land", dur: 0.3, ease: easeOutBack },
    { to: "stand", dur: 0.24, onDone: () => phase === "play" && nextShot(m) },
  ]);
}

function signatureShot(ball, m) {
  // Turnaround fadeaway через защитника: соперник выбегает в стойку, звезда
  // показывает спину с «24», разворот, отклонение назад — бросок через
  // вытянутую руку в slow-mo.
  playerAct([
    {
      to: "dribble",
      dur: 0.22,
      onStart: () => {
        ball.dribble = { t: 0, n: 2, cross: true };
        summonDefender(m);
      },
    },
    { to: "dribble", dur: 0.5 },
    {
      to: "backHold",
      dur: 0.3,
      onStart: () => {
        player.facingTarget = -1;
        player.wants24 = true;
      },
    },
    { to: "backHold", dur: 0.38 }, // пауза: спина с «24», защитник в стойке
    {
      to: "fadeRise",
      dur: 0.24,
      ease: easeOutCubic,
      onStart: () => {
        player.facingTarget = 1;
        player.wants24 = false;
        player.jump = { t: 0, dur: 0.94, h: m.ph * 0.62, drift: -m.ph * 0.34 };
        defenderContest(m);
      },
    },
    {
      to: "fadeRelease",
      dur: 0.22,
      ease: easeOutCubic,
      onStart: () => {
        window.setTimeout(() => releaseHeld(ball, m, true), 140);
      },
    },
    // Зависание с вытянутой рукой над защитником — момент для скриншота.
    { to: "fadeFollow", dur: 0.34 },
    { to: "land", dur: 0.34, ease: easeOutBack, onStart: () => { player.celebrating24 = 1; } },
    { to: "stand", dur: 0.26, onDone: () => phase === "play" && nextShot(m) },
  ]);
}

// ---------------------------------------------------------------------------
// Защитник

function summonDefender(m) {
  if (defender.active) {
    return;
  }
  defender.active = true;
  defender.mode = "enter";
  defender.x = m.width + m.ph;
  defender.facing = -1; // лицом к звезде
  defender.facingTarget = -1;
  defender.airY = 0;
  defender.airX = 0;
  defender.sway = 0;
  defender.jump = null;
  defender.queue = [];
  defender.onDone = null;
  defender.pose = { ...POSES.run };
  defender.from = { ...POSES.run };
  defender.to = { ...POSES.run };
  defender.t = 0;
  defender.dur = 0.001;
}

function defenderContest(m) {
  if (!defender.active) {
    return;
  }
  defender.mode = "jump";
  defender.jump = { t: 0, dur: 0.8, h: m.ph * 0.52, drift: -m.ph * 0.1 };
  actorAct(defender, [
    { to: "contest", dur: 0.2, ease: easeOutCubic },
    { to: "contest", dur: 0.42 },
    { to: "land", dur: 0.3, ease: easeInCubic },
    // Поник: бросили через него. Пауза — и грустный уход.
    { to: "dejected", dur: 0.36, onDone: () => { defender.mode = "sad"; } },
  ]);
}

function finishShow(m) {
  phase = "celebrate";
  playerAct([
    { to: "celebrate", dur: 0.3, ease: easeOutBack },
    { to: "celebrate", dur: 0.7 },
    {
      to: "run",
      dur: 0.2,
      onStart: () => {
        phase = "exit";
        player.facingTarget = -1;
      },
    },
  ]);
}

// ---------------------------------------------------------------------------
// Update

function stepJump(actor, dt) {
  if (!actor.jump) {
    return;
  }
  const j = actor.jump;
  j.t += dt;
  const k = Math.min(1, j.t / j.dur);
  actor.airY = Math.sin(k * Math.PI) * j.h;
  actor.airX = Math.sin(k * Math.PI) * (j.drift || 0);
  if (k >= 1) {
    actor.jump = null;
    actor.airY = 0;
    actor.airX = 0;
  }
}

// Движение защитника между фазами (позы гоняет общий stepActor).
function stepDefender(dt, rdt, m) {
  if (!defender.active) {
    return;
  }
  const guardX = player.x + m.ph * 1.05;
  if (defender.mode === "enter") {
    defender.x += (guardX - defender.x) * Math.min(1, dt * 5);
    defender.pose = lerpPose(defender.pose, POSES.run, Math.min(1, dt * 8));
    if (defender.x - guardX < m.ph * 0.06) {
      defender.x = guardX;
      defender.mode = "guard";
      actorAct(defender, [{ to: "defense", dur: 0.24, ease: easeOutCubic }]);
    }
  } else if (defender.mode === "guard") {
    // Живая стойка: лёгкие приставные покачивания.
    defender.sway = Math.sin(defender.runPhase * 0.9) * m.ph * 0.03;
  } else if (defender.mode === "sad") {
    defender.sway = 0;
    defender.sadUntil ||= Date.now() + 700;
    if (Date.now() > defender.sadUntil) {
      defender.mode = "exit";
      defender.sadUntil = 0;
      defender.facingTarget = 1; // уходит направо, откуда пришёл
      actorAct(defender, [{ to: "run", dur: 0.3 }]);
    }
  } else if (defender.mode === "exit") {
    defender.x += dt * m.width * 0.42;
    if (defender.x > m.width + m.ph * 1.3) {
      defender.active = false;
      defender.mode = null;
    }
  }
}

function updateScene(rdt) {
  const m = metrics();
  if (!m.width || !m.height) {
    return;
  }

  // Slow-mo: тайм-скейл плавно едет к цели, таймер — по реальному времени.
  slowmoLeft = Math.max(0, slowmoLeft - rdt);
  const targetScale = slowmoLeft > 0 ? 0.32 : 1;
  timeScale += (targetScale - timeScale) * Math.min(1, rdt * 9);
  const dt = rdt * timeScale;

  flashTint = Math.max(0, flashTint - rdt * 1.6);
  hoop.netWave = Math.max(0, hoop.netWave - rdt * 1.7);
  hoop.netPhase += rdt * 11;
  hoop.flash = Math.max(0, hoop.flash - rdt * 2.4);
  hoop.ring = Math.max(0, hoop.ring - rdt * 2.6);

  // Кольцо появляется/сворачивается
  const hoopTarget = phase === "idle" || phase === "exit" ? 0 : 1;
  hoop.visible += (hoopTarget - hoop.visible) * Math.min(1, rdt * (hoopTarget ? 5 : 3));

  if (pendingSummonStrength > 0 && phase !== "exit") {
    spawnBalls(2 + Math.round(pendingSummonStrength), m);
    pendingSummonStrength = 0;
    if (phase === "idle") {
      startShow(m);
    }
  }

  stepActor(player, dt);
  stepJump(player, dt);
  stepActor(defender, dt);
  stepJump(defender, dt);
  stepDefender(dt, rdt, m);
  // «24» на спине: хотим показать (замах коронки) И спина уже к камере.
  const backVisible = player.facing < -0.3;
  player.show24 += (((player.wants24 && backVisible) ? 1 : 0) - player.show24) * Math.min(1, rdt * 7);
  player.celebrating24 = Math.max(0, player.celebrating24 - rdt * 0.55);

  // Вход/выход игрока
  if (phase === "enter") {
    const t = Math.min(1, (player.x + m.ph) / (m.playerX + m.ph));
    player.x += (m.playerX - player.x) * Math.min(1, dt * 4.2);
    if (m.playerX - player.x < 2) {
      player.x = m.playerX;
      phase = "play";
      playerAct([{ to: "stand", dur: 0.22, onDone: () => nextShot(m) }]);
    } else if (t > 0.05) {
      player.pose = lerpPose(player.pose, POSES.run, 0.4);
    }
  } else if (phase === "exit") {
    player.x -= dt * m.width * 0.55;
    player.pose = lerpPose(player.pose, POSES.run, Math.min(1, dt * 8));
    if (player.x < -m.ph * 1.4) {
      player.active = false;
      phase = "idle";
    }
  }

  // Дриблинг мяча в руке. Кроссовер: мяч ходит с руки на руку, корпус
  // качается в противофазе — живой ритм вместо метронома.
  const held = player.heldBall;
  if (held) {
    const hand = handWorld(m);
    if (held.dribble) {
      held.dribble.t += dt * 3.6;
      const cycle = held.dribble.t % 1;
      const bounceIdx = Math.floor(held.dribble.t);
      const down = Math.sin(cycle * Math.PI);
      const prevY = held.y;
      const side = held.dribble.cross ? (bounceIdx % 2 ? -1 : 1) : 1;
      const crossShift = held.dribble.cross ? side * m.ph * 0.16 * down : 0;
      held.y = hand.y + (m.floorY - held.r - hand.y) * down;
      held.x = hand.x + (player.facing > 0 ? 2 : -2) + crossShift;
      player.sway = held.dribble.cross ? -side * m.ph * 0.05 * down : 0;
      if (down > 0.97 && prevY < held.y) {
        playMotionSound("tap");
        floorFlashes.push({ x: held.x, age: 0 });
      }
      if (held.dribble.t >= held.dribble.n) {
        held.dribble = null;
        player.sway = 0;
      }
    } else {
      held.x += (hand.x - held.x) * Math.min(1, dt * 18);
      held.y += (hand.y - held.y) * Math.min(1, dt * 18);
    }
    held.rot += dt * 6;
  } else {
    player.sway *= Math.max(0, 1 - dt * 8);
  }

  // Физика мячей
  const g = GRAVITY * m.height;
  for (const ball of balls) {
    ball.squash = Math.max(0, ball.squash - rdt * 6);
    if (ball.state === "falling") {
      ball.vy += g * dt;
      ball.vx += tilt * 14 * dt;
      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;
      ball.rot += ball.vx * dt * 0.08;
      if (ball.y >= m.floorY - ball.r) {
        ball.y = m.floorY - ball.r;
        ball.bounces += 1;
        ball.squash = 1;
        ball.vy = -Math.abs(ball.vy) * 0.46;
        ball.vx *= 0.8;
        playMotionSound("tap");
        floorFlashes.push({ x: ball.x, age: 0 });
        if (ball.bounces >= 2 || Math.abs(ball.vy) < m.height * 0.04) {
          ball.state = "queue";
          ball.vy = 0;
        }
      }
    } else if (ball.state === "queue") {
      // катимся в очередь к игроку
      const idx = balls.filter((b) => b.state === "queue").indexOf(ball);
      const targetX = m.playerX + m.ph * (0.5 + idx * 0.22);
      ball.x += (targetX - ball.x) * Math.min(1, dt * 3.2);
      ball.y = m.floorY - ball.r;
      ball.rot += (targetX - ball.x) * dt * 0.3;
    } else if (ball.state === "flight") {
      ball.flightT += dt;
      ball.vy += g * dt;
      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;
      ball.rot -= dt * 9; // backspin
      // две точки за кадр (с серединой шага) — след сплошной, не пунктир
      const last = ball.trail[ball.trail.length - 1];
      if (last) {
        ball.trail.push({ x: (last.x + ball.x) / 2, y: (last.y + ball.y) / 2, age: 0 });
      }
      ball.trail.push({ x: ball.x, y: ball.y, age: 0 });
      while (ball.trail.length > 26) {
        ball.trail.shift();
      }
      const atTarget = ball.flightT >= ball.flightDur;
      if (atTarget && ball.rattle) {
        // стук о дужку и короткая дуга в центр
        ball.rattle = false;
        playMotionSound("tap");
        launchBall(ball, ball.x, ball.y, m.hoopX + m.rimR * 0.1, m.rimY, m, 0.42);
      } else if (atTarget) {
        ball.state = "drop";
        ball.vx *= 0.16;
        ball.vy = Math.max(ball.vy * 0.3, m.height * 0.16);
        swish(ball, m);
      }
    } else if (ball.state === "drop") {
      ball.y += ball.vy * dt;
      ball.x += ball.vx * dt;
      for (const t of ball.trail) {
        t.age += rdt;
      }
      if (ball.y > m.rimY + m.rimR * 2.6) {
        ball.dead = true;
      }
    }
    for (const t of ball.trail) {
      t.age += rdt * 0.9;
    }
  }
  balls = balls.filter((b) => !b.dead);

  // Частицы, попапы, росчерки
  for (const p of particles) {
    p.age += rdt;
    p.vy += g * 0.35 * rdt;
    p.x += p.vx * rdt;
    p.y += p.vy * rdt;
  }
  particles = particles.filter((p) => p.age < p.life);
  for (const p of popups) {
    p.age += rdt;
    p.y -= rdt * m.height * 0.055;
  }
  popups = popups.filter((p) => p.age < p.life);
  for (const s of streaks) {
    s.age += rdt;
  }
  streaks = streaks.filter((s) => s.age < s.life);
  for (const f of floorFlashes) {
    f.age += rdt;
  }
  floorFlashes = floorFlashes.filter((f) => f.age < 0.35);
}

// ---------------------------------------------------------------------------
// Draw

function drawBall(ctx, ball) {
  const r = ball.r;
  ctx.save();
  ctx.translate(ball.x, ball.y);
  if (ball.squash > 0) {
    const k = 1 + ball.squash * 0.22;
    ctx.translate(0, r * ball.squash * 0.2);
    ctx.scale(k, 1 / k);
  }
  ctx.rotate(ball.rot);
  ctx.fillStyle = BALL_BASE;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255, 224, 168, 0.5)";
  ctx.beginPath();
  ctx.arc(-r * 0.3, -r * 0.32, r * 0.42, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = BALL_SEAM;
  ctx.lineWidth = Math.max(0.8, r * 0.14);
  ctx.beginPath();
  ctx.moveTo(-r, 0);
  ctx.lineTo(r, 0);
  ctx.moveTo(0, -r);
  ctx.lineTo(0, r);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(-r * 1.35, 0, r * 1.05, -0.62, 0.62);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(r * 1.35, 0, r * 1.05, Math.PI - 0.62, Math.PI + 0.62);
  ctx.stroke();
  ctx.restore();
}

function strokeLimb(ctx, ax, ay, bx, by, cx, cy, w) {
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.lineTo(cx, cy);
  ctx.stroke();
}

const actorGlowSprites = new Map();
function actorGlow(rgb) {
  if (!actorGlowSprites.has(rgb)) {
    actorGlowSprites.set(rgb, makeGlow(rgb, 0.26));
  }
  return actorGlowSprites.get(rgb);
}

function drawActor(ctx, m, actor, style) {
  if (!actor.active) {
    return;
  }
  const j = joints(actor, m);
  const f = actor.facing;
  const isStar = actor === player;
  ctx.save();
  ctx.translate(actor.x, m.floorY);
  ctx.scale(f < 0 ? Math.min(-0.12, f) : Math.max(0.12, f), 1);

  // ореол
  ctx.globalAlpha = isStar ? 0.5 : 0.36;
  const gr = m.ph * 0.9;
  ctx.drawImage(actorGlow(style.glowRgb), j.hip.x - gr, j.hip.y - gr * 0.8, gr * 2, gr * 2);
  ctx.globalAlpha = 1;

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const limbW = m.ph * 0.1;

  // дальние конечности — темнее
  ctx.strokeStyle = INK;
  strokeLimb(ctx, j.neck.x, j.neck.y, j.armB.mid.x, j.armB.mid.y, j.armB.tip.x, j.armB.tip.y, limbW);
  strokeLimb(ctx, j.hip.x, j.hip.y, j.legB.mid.x, j.legB.mid.y, j.legB.tip.x, j.legB.tip.y, limbW * 1.15);
  ctx.strokeStyle = style.coreBack;
  strokeLimb(ctx, j.neck.x, j.neck.y, j.armB.mid.x, j.armB.mid.y, j.armB.tip.x, j.armB.tip.y, limbW * 0.28);
  strokeLimb(ctx, j.hip.x, j.hip.y, j.legB.mid.x, j.legB.mid.y, j.legB.tip.x, j.legB.tip.y, limbW * 0.3);

  // торс + голова
  ctx.strokeStyle = INK;
  ctx.lineWidth = m.ph * 0.17;
  ctx.beginPath();
  ctx.moveTo(j.hip.x, j.hip.y);
  ctx.lineTo(j.neck.x, j.neck.y);
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(j.head.x, j.head.y, j.headR, 0, Math.PI * 2);
  ctx.fill();
  // энергетическое ядро
  ctx.strokeStyle = style.coreTorso;
  ctx.lineWidth = limbW * 0.32;
  ctx.beginPath();
  ctx.moveTo(j.hip.x, j.hip.y);
  ctx.lineTo(j.neck.x, j.neck.y);
  ctx.stroke();
  ctx.strokeStyle = style.head;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(j.head.x, j.head.y, j.headR, 0, Math.PI * 2);
  ctx.stroke();

  // номер 24 на спине (виден, когда звезда спиной к кольцу)
  if (isStar && player.show24 > 0.02) {
    ctx.save();
    ctx.scale(-1, 1); // текст не должен зеркалиться
    ctx.globalAlpha = player.show24;
    ctx.fillStyle = GOLD;
    ctx.font = `900 ${Math.round(m.ph * 0.17)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    const bx = -(j.hip.x + j.neck.x) / 2;
    ctx.fillText("24", bx, (j.hip.y + j.neck.y) / 2 + m.ph * 0.02);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // ближние конечности — с ярким ядром
  ctx.strokeStyle = INK;
  strokeLimb(ctx, j.hip.x, j.hip.y, j.legF.mid.x, j.legF.mid.y, j.legF.tip.x, j.legF.tip.y, limbW * 1.15);
  strokeLimb(ctx, j.neck.x, j.neck.y, j.armF.mid.x, j.armF.mid.y, j.armF.tip.x, j.armF.tip.y, limbW);
  ctx.strokeStyle = style.coreLimb;
  strokeLimb(ctx, j.hip.x, j.hip.y, j.legF.mid.x, j.legF.mid.y, j.legF.tip.x, j.legF.tip.y, limbW * 0.3);
  strokeLimb(ctx, j.neck.x, j.neck.y, j.armF.mid.x, j.armF.mid.y, j.armF.tip.x, j.armF.tip.y, limbW * 0.28);

  // «24» на груди после коронки — золотой отсвет на праздновании
  if (isStar && player.celebrating24 > 0.05 && phase !== "exit") {
    ctx.globalAlpha = Math.min(1, player.celebrating24);
    ctx.fillStyle = GOLD;
    ctx.font = `900 ${Math.round(m.ph * 0.14)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText("24", (j.hip.x + j.neck.x) / 2, (j.hip.y + j.neck.y) / 2 + m.ph * 0.02);
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

function drawHoop(ctx, m, front) {
  if (hoop.visible < 0.02) {
    return;
  }
  const k = easeOutBack(Math.min(1, hoop.visible));
  ctx.save();
  ctx.translate(m.hoopX, m.rimY);
  ctx.scale(k, k);
  ctx.translate(-m.hoopX, -m.rimY);
  ctx.globalAlpha = Math.min(1, hoop.visible * 1.4);

  if (!front) {
    // стойка
    ctx.strokeStyle = "rgba(53, 246, 255, 0.4)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(m.hoopX + m.rimR * 1.5, m.rimY - m.rimR * 1.1);
    ctx.lineTo(m.hoopX + m.rimR * 1.5, m.floorY);
    ctx.stroke();
    // щит
    const bw = m.ph * 0.34;
    const bh = m.ph * 0.42;
    const bx = m.hoopX + m.rimR * 1.18;
    const by = m.rimY - bh * 0.78;
    ctx.fillStyle = "rgba(53, 246, 255, 0.07)";
    ctx.strokeStyle = "rgba(53, 246, 255, 0.55)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(bx, by, bw * 0.24, bh, 3);
    } else {
      ctx.rect(bx, by, bw * 0.24, bh);
    }
    ctx.fill();
    ctx.stroke();
    // сетка (задние нити)
    const anchors = netAnchors(m);
    ctx.strokeStyle = "rgba(213, 255, 244, 0.5)";
    ctx.lineWidth = 1.1;
    for (const a of anchors) {
      const wob = Math.sin(hoop.netPhase + a.top.x) * hoop.netWave * m.rimR * 0.5;
      ctx.beginPath();
      ctx.moveTo(a.top.x, a.top.y);
      ctx.quadraticCurveTo(
        (a.top.x + a.bot.x) / 2 + wob,
        (a.top.y + a.bot.y) / 2,
        a.bot.x + wob * 0.6,
        a.bot.y,
      );
      ctx.stroke();
    }
    // заднее полукольцо обода
    ctx.strokeStyle = hoop.flash > 0 ? GOLD : "rgba(255, 211, 107, 0.6)";
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.ellipse(m.hoopX, m.rimY, m.rimR, m.rimR * 0.32, 0, Math.PI, Math.PI * 2);
    ctx.stroke();
  } else {
    // переднее полукольцо и пара передних нитей — рисуются ПОВЕРХ мяча,
    // чтобы он «проходил сквозь сетку»
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 2.6;
    ctx.globalAlpha = Math.min(1, hoop.visible * (0.85 + hoop.flash * 0.15));
    ctx.beginPath();
    ctx.ellipse(m.hoopX, m.rimY, m.rimR, m.rimR * 0.32, 0, 0, Math.PI);
    ctx.stroke();
    const anchors = netAnchors(m);
    ctx.strokeStyle = "rgba(213, 255, 244, 0.66)";
    ctx.lineWidth = 1.1;
    for (const a of [anchors[1], anchors[3]]) {
      const wob = Math.sin(hoop.netPhase + a.top.x * 2) * hoop.netWave * m.rimR * 0.55;
      ctx.beginPath();
      ctx.moveTo(a.top.x, a.top.y + m.rimR * 0.18);
      ctx.quadraticCurveTo(
        (a.top.x + a.bot.x) / 2 + wob,
        (a.top.y + a.bot.y) / 2 + m.rimR * 0.1,
        a.bot.x + wob * 0.6,
        a.bot.y,
      );
      ctx.stroke();
    }
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawScene(ctx, measured) {
  const m = metrics();
  if (!m.width || !m.height) {
    return;
  }
  ensureSprites();
  ctx.setTransform(measured.dpr, 0, 0, measured.dpr, 0, 0);

  // пол
  if (hoop.visible > 0.03 || balls.length) {
    const grad = ctx.createLinearGradient(0, 0, m.width, 0);
    grad.addColorStop(0, "rgba(53, 246, 255, 0)");
    grad.addColorStop(0.35, "rgba(53, 246, 255, 0.22)");
    grad.addColorStop(0.8, "rgba(183, 255, 77, 0.2)");
    grad.addColorStop(1, "rgba(183, 255, 77, 0)");
    ctx.strokeStyle = grad;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(0, m.floorY);
    ctx.lineTo(m.width, m.floorY);
    ctx.stroke();
  }

  // росчерки входа
  if (streaks.length) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const s of streaks) {
      const k = s.age / s.life;
      ctx.globalAlpha = (1 - k) * 0.5;
      const sg = ctx.createLinearGradient(player.x - m.ph * 2.2, 0, player.x, 0);
      sg.addColorStop(0, "rgba(53, 246, 255, 0)");
      sg.addColorStop(1, "rgba(183, 255, 77, 0.8)");
      ctx.strokeStyle = sg;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(player.x - m.ph * (2.2 - k), s.y);
      ctx.lineTo(player.x - m.ph * 0.2, s.y);
      ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  drawHoop(ctx, m, false);

  // мячи на земле/в руке + свечение
  for (const ball of balls) {
    if (ball.state === "flight" || ball.state === "drop") {
      continue;
    }
    ctx.globalAlpha = 0.55;
    const gr = ball.r * 3.2;
    ctx.drawImage(ballGlowSprite, ball.x - gr, ball.y - gr, gr * 2, gr * 2);
    ctx.globalAlpha = 1;
    drawBall(ctx, ball);
  }

  // Блики пола в точках отскока
  if (floorFlashes.length) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const f of floorFlashes) {
      const k = 1 - f.age / 0.35;
      ctx.globalAlpha = k * 0.5;
      const fr = m.ph * 0.3 * (1 + (1 - k) * 0.8);
      ctx.drawImage(ballGlowSprite, f.x - fr, m.floorY - fr * 0.28, fr * 2, fr * 0.56);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // Защитник позади звезды: бросают именно через него.
  drawActor(ctx, m, defender, DEFENDER_STYLE);
  drawActor(ctx, m, player, PLAYER_STYLE);

  // летящие мячи: след → мяч
  for (const ball of balls) {
    if (ball.state !== "flight" && ball.state !== "drop") {
      continue;
    }
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const n = ball.trail.length;
    for (let i = 0; i < n; i += 1) {
      const t = ball.trail[i];
      const k = (i + 1) / n; // 1 = свежий
      const alpha = Math.max(0, k * 0.42 - t.age * 0.5);
      if (alpha <= 0.01) {
        continue;
      }
      ctx.globalAlpha = alpha;
      ctx.fillStyle = ball.signature
        ? (i % 2 ? "rgba(255, 211, 107, 0.9)" : "rgba(165, 108, 255, 0.9)")
        : (i % 2 ? "rgba(183, 255, 77, 0.9)" : "rgba(53, 246, 255, 0.9)");
      ctx.beginPath();
      ctx.arc(t.x, t.y, ball.r * (0.25 + k * 0.6), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = 0.6;
    const gr = ball.r * 3.4;
    ctx.drawImage(ballGlowSprite, ball.x - gr, ball.y - gr, gr * 2, gr * 2);
    ctx.globalAlpha = 1;
    const dropFade = ball.state === "drop"
      ? Math.max(0, 1 - (ball.y - m.rimY) / (m.rimR * 2.4))
      : 1;
    ctx.globalAlpha = dropFade;
    drawBall(ctx, ball);
    ctx.globalAlpha = 1;
  }

  drawHoop(ctx, m, true);

  // расходящееся кольцо-импульс на свище
  if (hoop.ring > 0.02) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const k = 1 - hoop.ring;
    ctx.globalAlpha = hoop.ring * 0.55;
    ctx.strokeStyle = hoop.ringGold ? GOLD : CORE_2;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.ellipse(m.hoopX, m.rimY, m.rimR * (1 + k * 2.1), m.rimR * 0.32 * (1 + k * 2.1), 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // искры
  if (particles.length) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const p of particles) {
      const k = 1 - p.age / p.life;
      ctx.globalAlpha = k * 0.9;
      ctx.fillStyle = `rgba(${p.rgb}, 1)`;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - p.size * 1.6);
      ctx.lineTo(p.x + p.size * 0.7, p.y);
      ctx.lineTo(p.x, p.y + p.size * 1.6);
      ctx.lineTo(p.x - p.size * 0.7, p.y);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // попапы
  for (const p of popups) {
    const k = p.age / p.life;
    const inK = easeOutBack(Math.min(1, p.age / 0.18));
    ctx.globalAlpha = Math.min(1, (1 - k) * 1.6);
    ctx.font = `900 ${Math.round(p.size * inK)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = p.color;
    ctx.globalAlpha = Math.min(1, (1 - k) * 0.5);
    ctx.fillText(p.text, p.x, p.y + 1.5);
    ctx.restore();
    ctx.fillStyle = p.color;
    ctx.fillText(p.text, p.x, p.y);
  }
  ctx.globalAlpha = 1;

  // вспышка на комбо-легенде
  if (flashTint > 0.01) {
    const fg = ctx.createLinearGradient(0, 0, 0, m.height);
    fg.addColorStop(0, `rgba(165, 108, 255, ${flashTint * 0.12})`);
    fg.addColorStop(1, `rgba(255, 211, 107, ${flashTint * 0.12})`);
    ctx.fillStyle = fg;
    ctx.fillRect(0, 0, m.width, m.height);
  }
}

// ---------------------------------------------------------------------------
// Сцена

const basketballScene = {
  key: "basketball",
  renderMode() {
    return "canvas";
  },
  connect(nextRuntime) {
    runtime = nextRuntime;
  },
  setEnabled(next) {
    enabled = Boolean(next);
  },
  isEnabled() {
    return enabled;
  },
  setRuntimeAllowed(next) {
    runtimeAllowed = Boolean(next);
  },
  isRuntimeAllowed() {
    return runtimeAllowed;
  },
  onSurface(nextSurface) {
    surface = nextSurface;
  },
  onTilt(nextTilt) {
    tilt = nextTilt;
  },
  summon(strength = 1) {
    const measured = runtime?.measureCanvas?.();
    if (!measured) {
      return;
    }
    surface = measured;
    ensureSprites();
    pendingSummonStrength = Math.max(pendingSummonStrength, Math.min(3, strength));
    runtime?.wake?.();
  },
  prime({ surface: nextSurface } = {}) {
    if (nextSurface) {
      surface = nextSurface;
    }
    return true;
  },
  update(dt) {
    updateScene(dt);
  },
  draw(drawCtx, measured) {
    drawScene(drawCtx, measured);
  },
  isAlive() {
    return phase !== "idle"
      || balls.length > 0
      || particles.length > 0
      || popups.length > 0
      || floorFlashes.length > 0
      || defender.active
      || pendingSummonStrength > 0
      || hoop.visible > 0.02;
  },
  windDown() {
    balls = [];
    particles = [];
    popups = [];
    streaks = [];
    floorFlashes = [];
    player.active = false;
    player.heldBall = null;
    player.queue = [];
    player.onDone = null;
    player.jump = null;
    player.wants24 = false;
    player.show24 = 0;
    player.sway = 0;
    defender.active = false;
    defender.mode = null;
    defender.queue = [];
    defender.onDone = null;
    defender.jump = null;
    defender.sadUntil = 0;
    phase = "idle";
    hoop.visible = 0;
    hoop.ring = 0;
    slowmoLeft = 0;
    timeScale = 1;
    pendingSummonStrength = 0;
  },
};

registerScene(basketballScene);

export function isBasketballSceneRegistered() {
  return true;
}
