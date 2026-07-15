// «Вау» по нажатию кнопки футбола: кинематографичная бисиклета.
//
// Режиссура (2.6 секунды): стадион зажигает прожекторы → неоновый силуэт
// врывается в кадр, мяч подброшен → удар через себя в замедлении, стоп-кадр
// почти вверх ногами → мяч летит ПРЯМО В КАМЕРУ с кометным следом → вспышка,
// сетка ворот рябит на весь экран, «ГОЛ!», конфетти — и под гаснущим оверлеем
// уже открыт футбольный шит (onReveal дергается в момент гола).
//
// Технология сознательно та же, что у премиум-сцен: canvas 2D, силуэт с
// неоновым ядром, никаких Three.js и тяжёлых зависимостей. Слоу-мо зашито
// в кейфреймы (плотность ключей), а не в масштаб времени — предсказуемо
// на любом fps.

import { playMotionSound } from "./lightning-motion.js?v=20260707-01";

const DURATION = 2_650;
const TOUCH_AT = 760; // подброс мяча
const STRIKE_AT = 1_300; // контакт бисиклеты
const IMPACT_AT = 1_780; // мяч «в камере», гол
const FAILSAFE_MS = 4_200;

const INK = "#0a1322";
const CORE_LIME = "rgba(183, 255, 77, 0.9)";
const CORE_CYAN = "rgba(53, 246, 255, 0.85)";
const GOLD = "#ffd36b";
const CONFETTI_COLORS = ["#b7ff4d", "#35f6ff", "#ffd36b", "#a56cff", "#f8fcff"];

let activeScene = null;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const easeInCubic = (t) => t ** 3;
const easeInOut = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
const easeOutBack = (t) => 1 + 2.4 * (t - 1) ** 3 + 1.4 * (t - 1) ** 2;
const rand = (a, b) => a + Math.random() * (b - a);

function reducedMotion() {
  return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches)
    && !window.Telegram?.WebApp;
}

function haptic(kind) {
  try {
    const fb = window.Telegram?.WebApp?.HapticFeedback;
    if (kind === "success") {
      fb?.notificationOccurred?.("success");
    } else {
      fb?.impactOccurred?.(kind);
    }
  } catch {
    // вне Telegram сцена остаётся чисто визуальной
  }
}

// ---------------------------------------------------------------------------
// Скелет: те же конвенции, что у баскетбольного рига (0 = вниз, + = вперёд,
// колени всегда отрицательные). Поза + корень {x, y, rot} на кейфрейм.

function joints(pose, s) {
  const torso = s * 0.31;
  const upper = s * 0.155;
  const fore = s * 0.15;
  const thigh = s * 0.22;
  const shin = s * 0.2;

  const hip = { x: 0, y: 0 };
  const lean = pose.lean;
  const neck = { x: Math.sin(lean) * torso, y: -Math.cos(lean) * torso };
  const head = { x: neck.x + Math.sin(lean) * s * 0.09, y: neck.y - Math.cos(lean) * s * 0.115 };
  const limb = (root, a1, l1, a2, l2) => {
    const mid = { x: root.x + Math.sin(a1) * l1, y: root.y + Math.cos(a1) * l1 };
    const tip = { x: mid.x + Math.sin(a1 + a2) * l2, y: mid.y + Math.cos(a1 + a2) * l2 };
    return { mid, tip };
  };
  return {
    hip,
    neck,
    head,
    headR: s * 0.085,
    armF: limb(neck, pose.shF, upper, pose.elF, fore),
    armB: limb(neck, pose.shB, upper, pose.elB, fore),
    legF: limb(hip, pose.hipF, thigh, pose.kneeF, shin),
    legB: limb(hip, pose.hipB, thigh, pose.kneeB, shin),
  };
}

// Ключевые позы бисиклеты. rot задаётся на кейфрейме корня.
const P = {
  runA: { lean: 0.24, shF: -0.9, elF: 1.1, shB: 0.7, elB: 1.1, hipF: 0.75, kneeF: -0.3, hipB: -0.7, kneeB: -1.1 },
  runB: { lean: 0.24, shF: 0.7, elF: 1.1, shB: -0.9, elB: 1.1, hipF: -0.7, kneeF: -1.1, hipB: 0.75, kneeB: -0.3 },
  plant: { lean: 0.12, shF: -0.5, elF: 0.7, shB: 0.6, elB: 0.7, hipF: 0.35, kneeF: -0.5, hipB: -0.4, kneeB: -0.4 },
  coil: { lean: -0.1, shF: -1.2, elF: 0.8, shB: 0.9, elB: 0.8, hipF: 0.5, kneeF: -1.15, hipB: -0.2, kneeB: -0.9 },
  scissor: { lean: -0.3, shF: -1.6, elF: 0.6, shB: 1.3, elB: 0.6, hipF: 1.25, kneeF: -0.35, hipB: -0.5, kneeB: -0.9 },
  strike: { lean: -0.42, shF: -1.9, elF: 0.5, shB: 1.6, elB: 0.55, hipF: -0.9, kneeF: -0.25, hipB: 1.35, kneeB: -0.15 },
  tuck: { lean: -0.2, shF: -1.1, elF: 0.8, shB: 1, elB: 0.8, hipF: 0.4, kneeF: -1.2, hipB: 0.7, kneeB: -1.25 },
  land: { lean: 0.18, shF: -0.7, elF: 0.7, shB: 0.9, elB: 0.7, hipF: 0.45, kneeF: -1.05, hipB: -0.35, kneeB: -0.7 },
  rise: { lean: -0.04, shF: -2.9, elF: -0.1, shB: 0.5, elB: 0.5, hipF: 0.06, kneeF: -0.16, hipB: -0.06, kneeB: -0.1 },
};

// Кейфреймы: t в мс, root в долях экрана, rot в радианах (минус = через себя
// назад). Слоу-мо у страйка сделано плотностью ключей: между 1150 и 1350
// вращение почти замирает.
const TIMELINE = [
  { t: 60, x: -0.14, y: 0.845, rot: 0, pose: "runA", ease: easeInOut },
  { t: 260, x: 0.02, y: 0.845, rot: 0, pose: "runB", ease: easeInOut },
  { t: 450, x: 0.16, y: 0.845, rot: 0, pose: "runA", ease: easeInOut },
  { t: 640, x: 0.28, y: 0.85, rot: 0, pose: "plant", ease: easeOutCubic },
  { t: 900, x: 0.33, y: 0.86, rot: 0, pose: "coil", ease: easeInOut },
  { t: 1_150, x: 0.36, y: 0.62, rot: -1.45, pose: "scissor", ease: easeOutCubic },
  { t: 1_300, x: 0.375, y: 0.555, rot: -1.95, pose: "strike", ease: easeOutCubic },
  { t: 1_430, x: 0.39, y: 0.56, rot: -2.6, pose: "tuck", ease: easeInOut },
  { t: 1_680, x: 0.42, y: 0.845, rot: -6.28, pose: "land", ease: easeInCubic },
  { t: 2_050, x: 0.42, y: 0.83, rot: -6.28, pose: "rise", ease: easeOutBack },
  { t: 2_600, x: 0.42, y: 0.83, rot: -6.28, pose: "rise", ease: easeInOut },
];

function sampleTimeline(t) {
  if (t <= TIMELINE[0].t) {
    return { ...TIMELINE[0], pose: { ...P[TIMELINE[0].pose] } };
  }
  const last = TIMELINE[TIMELINE.length - 1];
  if (t >= last.t) {
    return { ...last, pose: { ...P[last.pose] } };
  }
  let i = 0;
  while (TIMELINE[i + 1].t < t) {
    i += 1;
  }
  const a = TIMELINE[i];
  const b = TIMELINE[i + 1];
  const k = (b.ease || easeInOut)((t - a.t) / (b.t - a.t));
  const pa = P[a.pose];
  const pb = P[b.pose];
  const pose = {};
  for (const key of Object.keys(pa)) {
    pose[key] = lerp(pa[key], pb[key], k);
  }
  return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), rot: lerp(a.rot, b.rot, k), pose };
}

// Мировая точка из локальной с учётом поворота корня.
function toWorld(p, root, cos, sin) {
  return {
    x: root.x + p.x * cos - p.y * sin,
    y: root.y + p.x * sin + p.y * cos,
  };
}

// ---------------------------------------------------------------------------

export function playFootballWow(options = {}) {
  const onReveal = typeof options.onReveal === "function" ? options.onReveal : () => {};

  if (reducedMotion() || activeScene) {
    onReveal();
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.setAttribute("aria-hidden", "true");
    overlay.style.cssText = "position:fixed;inset:0;z-index:220;pointer-events:none;opacity:1;transition:opacity 360ms ease;";
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;";
    overlay.appendChild(canvas);
    document.body.appendChild(overlay);

    const W = Math.max(1, window.innerWidth);
    const H = Math.max(1, window.innerHeight);
    const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      overlay.remove();
      onReveal();
      resolve(false);
      return;
    }

    const S = Math.min(W, H);
    const ph = clamp(S * 0.36, 130, 300); // рост героя — крупный, кинематографичный
    const floorY = H * 0.86;

    // Предрасчёт статики сцены
    const bokeh = Array.from({ length: 44 }, () => ({
      x: rand(0, W),
      y: rand(0, H * 0.5),
      r: rand(1, 3.2),
      phase: rand(0, Math.PI * 2),
      speed: rand(1.2, 2.6),
    }));
    const netGapX = Math.max(38, W / 9);
    const netGapY = Math.max(38, H / 14);

    const footTrail = [];
    const ballTrail = [];
    let confetti = null;
    let revealed = false;
    let done = false;
    let rafId = 0;
    let firedTouch = false;
    let firedStrike = false;
    let firedImpact = false;

    const scene = { overlay };
    activeScene = scene;

    const finish = () => {
      if (done) {
        return;
      }
      done = true;
      cancelAnimationFrame(rafId);
      window.clearTimeout(failsafeId);
      document.removeEventListener("visibilitychange", onHidden);
      overlay.remove();
      if (activeScene === scene) {
        activeScene = null;
      }
      if (!revealed) {
        revealed = true;
        onReveal();
      }
      resolve(true);
    };

    const onHidden = () => {
      if (document.hidden) {
        finish();
      }
    };
    document.addEventListener("visibilitychange", onHidden);
    const failsafeId = window.setTimeout(finish, FAILSAFE_MS);

    const start = performance.now();

    const drawStage = (t) => {
      // затемнение с виньеткой
      const dim = 0.9 * easeOutCubic(clamp(t / 320, 0, 1)) * (t > 2_200 ? 1 - (t - 2_200) / 450 : 1);
      const vg = ctx.createRadialGradient(W / 2, H * 0.55, S * 0.2, W / 2, H * 0.55, S * 0.95);
      vg.addColorStop(0, `rgba(4, 8, 14, ${0.78 * dim})`);
      vg.addColorStop(1, `rgba(2, 4, 8, ${0.97 * dim})`);
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);

      const stageIn = easeOutCubic(clamp((t - 100) / 420, 0, 1));
      if (stageIn <= 0.01) {
        return;
      }

      // прожекторы: два конуса, чуть дышат
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (const side of [0, 1]) {
        const ox = side ? W * 1.04 : -W * 0.04;
        const sway = Math.sin(t * 0.0011 + side * 2.1) * W * 0.05;
        const tx = W * (side ? 0.34 : 0.66) + sway;
        const grad = ctx.createLinearGradient(ox, -H * 0.05, tx, floorY);
        grad.addColorStop(0, `rgba(190, 235, 255, ${0.22 * stageIn})`);
        grad.addColorStop(1, "rgba(190, 235, 255, 0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(ox, -H * 0.05);
        ctx.lineTo(tx - S * 0.2, floorY);
        ctx.lineTo(tx + S * 0.2, floorY);
        ctx.closePath();
        ctx.fill();
      }
      // трибуны-боке
      for (const b of bokeh) {
        const tw = 0.5 + 0.5 * Math.sin(t * 0.001 * b.speed + b.phase);
        ctx.globalAlpha = 0.22 * tw * stageIn;
        ctx.fillStyle = "#cfe8ff";
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      ctx.globalAlpha = 1;

      // газон: перспективные линии
      ctx.save();
      ctx.globalAlpha = 0.5 * stageIn;
      ctx.strokeStyle = "rgba(123, 255, 104, 0.3)";
      ctx.lineWidth = 1.2;
      for (let i = 0; i < 4; i += 1) {
        const y = lerp(H * 0.72, H * 0.99, i / 3);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.ellipse(W * 0.5, H * 0.93, S * 0.3, S * 0.05, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    };

    const drawPlayer = (t) => {
      if (t > 2_350) {
        return;
      }
      const frame = sampleTimeline(t);
      const root = { x: frame.x * W, y: frame.y * H };
      const cos = Math.cos(frame.rot);
      const sin = Math.sin(frame.rot);
      const j = joints(frame.pose, ph);
      const w = (p) => toWorld(p, root, cos, sin);
      const hip = w(j.hip);
      const neck = w(j.neck);
      const head = w(j.head);
      const armF = { mid: w(j.armF.mid), tip: w(j.armF.tip) };
      const armB = { mid: w(j.armB.mid), tip: w(j.armB.tip) };
      const legF = { mid: w(j.legF.mid), tip: w(j.legF.tip) };
      const legB = { mid: w(j.legB.mid), tip: w(j.legB.tip) };

      // след бьющей ноги в полёте
      if (t > 950 && t < 1_430) {
        footTrail.push({ x: legB.tip.x, y: legB.tip.y, born: t });
        if (footTrail.length > 16) {
          footTrail.shift();
        }
      }
      if (footTrail.length > 1) {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.lineCap = "round";
        for (let i = 1; i < footTrail.length; i += 1) {
          const k = i / footTrail.length;
          const age = t - footTrail[i].born;
          ctx.globalAlpha = clamp(k * 0.5 - age * 0.001, 0, 1);
          ctx.strokeStyle = i % 2 ? CORE_LIME : CORE_CYAN;
          ctx.lineWidth = ph * 0.05 * k;
          ctx.beginPath();
          ctx.moveTo(footTrail[i - 1].x, footTrail[i - 1].y);
          ctx.lineTo(footTrail[i].x, footTrail[i].y);
          ctx.stroke();
        }
        ctx.restore();
        ctx.globalAlpha = 1;
      }

      // росчерки скорости на входе
      if (t < 700) {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        for (let i = 0; i < 3; i += 1) {
          const y = root.y - ph * (0.25 + i * 0.24);
          const grad = ctx.createLinearGradient(root.x - ph * 1.8, y, root.x - ph * 0.2, y);
          grad.addColorStop(0, "rgba(53, 246, 255, 0)");
          grad.addColorStop(1, `rgba(183, 255, 77, ${0.5 * (1 - t / 700)})`);
          ctx.strokeStyle = grad;
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(root.x - ph * 1.8, y);
          ctx.lineTo(root.x - ph * 0.2, y);
          ctx.stroke();
        }
        ctx.restore();
      }

      // ореол за героем: на тёмном стадионе чёрное тело без него тонет
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const halo = ctx.createRadialGradient(hip.x, hip.y, 0, hip.x, hip.y, ph * 1.05);
      halo.addColorStop(0, "rgba(53, 246, 255, 0.16)");
      halo.addColorStop(0.5, "rgba(183, 255, 77, 0.07)");
      halo.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(hip.x, hip.y, ph * 1.05, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      const limbW = ph * 0.1;
      const stroke = (a, b2, c, wdt, color) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = wdt;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b2.x, b2.y);
        ctx.lineTo(c.x, c.y);
        ctx.stroke();
      };
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      // дальние конечности
      stroke(neck, armB.mid, armB.tip, limbW, INK);
      stroke(hip, legB.mid, legB.tip, limbW * 1.15, INK);
      stroke(neck, armB.mid, armB.tip, limbW * 0.45, "rgba(53, 246, 255, 0.55)");
      stroke(hip, legB.mid, legB.tip, limbW * 0.48, "rgba(53, 246, 255, 0.6)");
      // торс + голова
      ctx.strokeStyle = INK;
      ctx.lineWidth = ph * 0.17;
      ctx.beginPath();
      ctx.moveTo(hip.x, hip.y);
      ctx.lineTo(neck.x, neck.y);
      ctx.stroke();
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.arc(head.x, head.y, j.headR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(183, 255, 77, 0.8)";
      ctx.lineWidth = limbW * 0.5;
      ctx.beginPath();
      ctx.moveTo(hip.x, hip.y);
      ctx.lineTo(neck.x, neck.y);
      ctx.stroke();
      ctx.strokeStyle = CORE_CYAN;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(head.x, head.y, j.headR, 0, Math.PI * 2);
      ctx.stroke();
      // ближние конечности
      stroke(hip, legF.mid, legF.tip, limbW * 1.15, INK);
      stroke(neck, armF.mid, armF.tip, limbW, INK);
      stroke(hip, legF.mid, legF.tip, limbW * 0.48, CORE_LIME);
      stroke(neck, armF.mid, armF.tip, limbW * 0.45, CORE_LIME);

      return { strikeFoot: legB.tip };
    };

    // Позиция мяча по таймлайну
    const ballAt = (t) => {
      const r0 = S * 0.036;
      if (t < 280) {
        return null;
      }
      if (t < 640) {
        // падение с отскоком
        const k = (t - 280) / 360;
        const x = W * 0.55;
        const bounce = Math.abs(Math.sin(k * Math.PI * 1.5)) * (1 - k);
        const y = lerp(-r0 * 2, floorY - r0, easeInCubic(clamp(k * 1.4, 0, 1))) - bounce * H * 0.08;
        return { x, y: Math.min(y, floorY - r0), r: r0, rot: t * 0.004 };
      }
      if (t < TOUCH_AT) {
        return { x: W * 0.55, y: floorY - r0, r: r0, rot: t * 0.001 };
      }
      if (t < STRIKE_AT) {
        // подброс: дуга к точке удара (встреча с бьющей ногой)
        const k = (t - TOUCH_AT) / (STRIKE_AT - TOUCH_AT);
        const x = lerp(W * 0.55, W * 0.39, easeOutCubic(k));
        const y = lerp(floorY - r0, H * 0.46, easeOutCubic(k)) - Math.sin(k * Math.PI) * H * 0.1;
        return { x, y, r: r0, rot: t * 0.006 };
      }
      if (t < IMPACT_AT) {
        // в камеру
        const k = easeInCubic((t - STRIKE_AT) / (IMPACT_AT - STRIKE_AT));
        const x = lerp(W * 0.39, W * 0.5, easeOutCubic(k));
        const y = H * 0.46;
        return { x, y, r: r0 * lerp(1, 14, k), rot: t * 0.012, flying: true, k };
      }
      return null;
    };

    const drawBall = (t) => {
      const b = ballAt(t);
      if (!b) {
        return;
      }
      if (b.flying) {
        ballTrail.push({ x: b.x, y: b.y, r: b.r });
        if (ballTrail.length > 12) {
          ballTrail.shift();
        }
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        // кометный след
        for (let i = 0; i < ballTrail.length - 1; i += 1) {
          const k = (i + 1) / ballTrail.length;
          const p = ballTrail[i];
          ctx.globalAlpha = k * 0.3;
          ctx.fillStyle = i % 2 ? "rgba(183, 255, 77, 0.9)" : "rgba(53, 246, 255, 0.9)";
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r * (0.4 + k * 0.4), 0, Math.PI * 2);
          ctx.fill();
        }
        // радиальные линии скорости
        const sk = b.k;
        ctx.globalAlpha = 0.16 + sk * 0.3;
        ctx.strokeStyle = "rgba(200, 245, 255, 0.8)";
        ctx.lineWidth = 1.4;
        for (let i = 0; i < 12; i += 1) {
          const a = (i / 12) * Math.PI * 2 + 0.4;
          const inner = b.r * 1.3 + S * 0.04;
          const outer = inner + S * (0.06 + sk * 0.3);
          ctx.beginPath();
          ctx.moveTo(b.x + Math.cos(a) * inner, b.y + Math.sin(a) * inner);
          ctx.lineTo(b.x + Math.cos(a) * outer, b.y + Math.sin(a) * outer);
          ctx.stroke();
        }
        ctx.restore();
        ctx.globalAlpha = 1;
      }

      // сам мяч: белый с тёмными пятнами, вращается
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.rot);
      ctx.fillStyle = "#f4f8fc";
      ctx.beginPath();
      ctx.arc(0, 0, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#111a26";
      ctx.beginPath();
      ctx.arc(0, 0, b.r * 0.34, 0, Math.PI * 2);
      ctx.fill();
      for (let i = 0; i < 5; i += 1) {
        const a = (i / 5) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * b.r * 0.78, Math.sin(a) * b.r * 0.78, b.r * 0.22, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = "rgba(10, 18, 30, 0.35)";
      ctx.lineWidth = Math.max(1, b.r * 0.05);
      ctx.beginPath();
      ctx.arc(0, 0, b.r * 0.99, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // свечение под мячом на земле
      if (!b.flying && b.y > floorY - b.r * 1.5) {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = "rgba(183, 255, 77, 0.8)";
        ctx.beginPath();
        ctx.ellipse(b.x, floorY, b.r * 1.6, b.r * 0.4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        ctx.globalAlpha = 1;
      }
    };

    const drawStrikeFlash = (t) => {
      // вспышка в точке контакта
      if (t < STRIKE_AT || t > STRIKE_AT + 240) {
        return;
      }
      const k = (t - STRIKE_AT) / 240;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = (1 - k) * 0.9;
      const r = S * (0.03 + k * 0.16);
      const g = ctx.createRadialGradient(W * 0.39, H * 0.46, 0, W * 0.39, H * 0.46, r);
      g.addColorStop(0, "rgba(255, 255, 255, 0.95)");
      g.addColorStop(0.4, "rgba(183, 255, 77, 0.6)");
      g.addColorStop(1, "rgba(53, 246, 255, 0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(W * 0.39, H * 0.46, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.globalAlpha = 1;
    };

    const drawImpact = (t) => {
      if (t < IMPACT_AT) {
        return;
      }
      const k = (t - IMPACT_AT) / (DURATION - IMPACT_AT);

      // вспышка на весь экран
      if (t < IMPACT_AT + 200) {
        const fk = 1 - (t - IMPACT_AT) / 200;
        ctx.fillStyle = `rgba(220, 255, 220, ${0.55 * fk})`;
        ctx.fillRect(0, 0, W, H);
      }

      // сетка ворот рябит от центра
      const wave = Math.max(0, 1 - k * 1.15);
      if (wave > 0.02) {
        ctx.save();
        ctx.strokeStyle = `rgba(220, 250, 255, ${0.3 * wave})`;
        ctx.lineWidth = 1.1;
        const cx = W / 2;
        const cy = H * 0.46;
        const phase = (t - IMPACT_AT) * 0.02;
        for (let gx = 0; gx <= W + netGapX; gx += netGapX) {
          ctx.beginPath();
          for (let y = 0; y <= H; y += 26) {
            const d = Math.hypot(gx - cx, y - cy);
            const disp = Math.sin(d / 46 - phase) * 16 * wave * Math.exp(-d / (S * 0.85));
            const x = gx + disp;
            if (y === 0) {
              ctx.moveTo(x, y);
            } else {
              ctx.lineTo(x, y);
            }
          }
          ctx.stroke();
        }
        for (let gy = 0; gy <= H + netGapY; gy += netGapY) {
          ctx.beginPath();
          for (let x = 0; x <= W; x += 26) {
            const d = Math.hypot(x - cx, gy - cy);
            const disp = Math.sin(d / 46 - phase) * 16 * wave * Math.exp(-d / (S * 0.85));
            const y = gy + disp;
            if (x === 0) {
              ctx.moveTo(x, y);
            } else {
              ctx.lineTo(x, y);
            }
          }
          ctx.stroke();
        }
        ctx.restore();
      }

      // расходящиеся кольца
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (const [delay, color] of [[0, CORE_LIME], [120, CORE_CYAN]]) {
        const rk = clamp((t - IMPACT_AT - delay) / 700, 0, 1);
        if (rk > 0 && rk < 1) {
          ctx.globalAlpha = (1 - rk) * 0.55;
          ctx.strokeStyle = color;
          ctx.lineWidth = 2.4;
          ctx.beginPath();
          ctx.arc(W / 2, H * 0.46, easeOutCubic(rk) * S * 0.75, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.restore();
      ctx.globalAlpha = 1;

      // конфетти
      if (!confetti) {
        confetti = Array.from({ length: 70 }, () => ({
          x: W / 2 + rand(-S * 0.08, S * 0.08),
          y: H * 0.46 + rand(-S * 0.05, S * 0.05),
          vx: rand(-1, 1) * S * 0.9,
          vy: rand(-1.4, -0.2) * S * 0.8,
          w: rand(5, 10),
          h: rand(8, 16),
          rot: rand(0, Math.PI * 2),
          vr: rand(-7, 7),
          color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
        }));
      }
      const dt = 1 / 60;
      ctx.save();
      for (const c of confetti) {
        c.vy += S * 1.9 * dt;
        c.vx *= 0.985;
        c.x += c.vx * dt;
        c.y += c.vy * dt;
        c.rot += c.vr * dt;
        ctx.globalAlpha = clamp(1.4 - k * 1.6, 0, 1);
        ctx.fillStyle = c.color;
        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.rotate(c.rot);
        ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h * (0.4 + 0.6 * Math.abs(Math.sin(c.rot * 2))));
        ctx.restore();
      }
      ctx.restore();
      ctx.globalAlpha = 1;

      // ГОЛ!
      const inK = easeOutBack(clamp((t - IMPACT_AT - 60) / 300, 0, 1));
      const outK = clamp((t - (DURATION - 420)) / 420, 0, 1);
      if (inK > 0.01 && outK < 1) {
        const size = Math.round(clamp(W * 0.23, 76, 190) * inK);
        ctx.save();
        ctx.translate(W / 2, H * 0.44);
        ctx.rotate(-0.05);
        ctx.globalAlpha = 1 - outK;
        ctx.font = `900 ${size}px Inter, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = "rgba(183, 255, 77, 0.85)";
        ctx.fillText("ГОЛ!", 0, 4);
        ctx.fillStyle = "rgba(53, 246, 255, 0.35)";
        ctx.fillText("ГОЛ!", 3, -2);
        ctx.restore();
        ctx.fillStyle = "#f8fcff";
        ctx.strokeStyle = GOLD;
        ctx.lineWidth = Math.max(2, size * 0.035);
        ctx.fillText("ГОЛ!", 0, 0);
        ctx.strokeText("ГОЛ!", 0, 0);
        ctx.restore();
        ctx.globalAlpha = 1;
      }
    };

    const frame = (now) => {
      const t = now - start;
      if (t >= DURATION) {
        finish();
        return;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      // тряска камеры после гола
      if (t > IMPACT_AT && t < IMPACT_AT + 340) {
        const sk = 1 - (t - IMPACT_AT) / 340;
        ctx.translate(rand(-7, 7) * sk, rand(-7, 7) * sk);
      }

      drawStage(t);
      drawPlayer(t);
      drawStrikeFlash(t);
      drawBall(t);
      drawImpact(t);

      // события по таймлайну
      if (!firedTouch && t >= TOUCH_AT) {
        firedTouch = true;
        haptic("light");
        playMotionSound("tap");
      }
      if (!firedStrike && t >= STRIKE_AT) {
        firedStrike = true;
        haptic("medium");
        playMotionSound("tap-strong");
      }
      if (!firedImpact && t >= IMPACT_AT) {
        firedImpact = true;
        haptic("success");
        playMotionSound("success");
        if (!revealed) {
          revealed = true;
          onReveal();
        }
      }
      // плавное растворение оверлея под конец — шит уже открыт под ним
      if (t > DURATION - 400) {
        overlay.style.opacity = "0";
      }

      rafId = requestAnimationFrame(frame);
    };

    rafId = requestAnimationFrame(frame);
  });
}
