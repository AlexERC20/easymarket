// Depositor-only mandarin fish. It is intentionally isolated from the base
// aquarium artwork so the original fish can evolve independently.

export const PREMIUM_DOM_FISH_SVG = `
  <svg class="premium-fish-svg" viewBox="0 0 76 40" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    <defs>
      <linearGradient id="emPremiumBody" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#7dffca" />
        <stop offset="0.42" stop-color="#18c9c5" />
        <stop offset="0.72" stop-color="#5368e8" />
        <stop offset="1" stop-color="#a74ee8" />
      </linearGradient>
      <linearGradient id="emPremiumFin" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#31e9cf" stop-opacity=".78" />
        <stop offset=".5" stop-color="#735df2" stop-opacity=".7" />
        <stop offset="1" stop-color="#ff6d9c" stop-opacity=".18" />
      </linearGradient>
    </defs>
    <g class="premium-tail-root">
      <path d="M22 20 C13 11 5 7 1 9 C7 15 7 24 1 31 C8 32 15 28 22 21Z" fill="url(#emPremiumFin)" />
      <g class="premium-tail-tip">
        <path d="M14 20 C7 15 3 13 1 9 M14 20 C7 25 3 28 1 31" fill="none" stroke="#bca9ff" stroke-width="1" stroke-linecap="round" opacity=".72" />
      </g>
    </g>
    <path class="premium-dorsal" d="M28 12 C32 2 44 1 52 11 C43 8 36 9 28 12Z" fill="url(#emPremiumFin)" />
    <path d="M20 20 C23 9 34 6 49 8 C62 9 72 14 74 20 C71 27 61 32 47 32 C33 33 23 29 20 20Z" fill="url(#emPremiumBody)" />
    <path d="M24 22 C34 29 54 31 68 23 C63 32 48 36 34 31 C28 29 25 26 24 22Z" fill="#d5fff1" opacity=".36" />
    <path d="M25 17 C38 10 58 12 69 18" fill="none" stroke="#d7ff62" stroke-width="1.35" stroke-linecap="round" opacity=".78" />
    <path d="M29 24 C40 19 54 20 65 25" fill="none" stroke="#ff79b7" stroke-width="1.1" stroke-linecap="round" opacity=".62" />
    <g class="premium-scales" fill="none" stroke="#dbfff8" stroke-width=".7" opacity=".48">
      <path d="M33 15q3 3 6 0M39 14q3 3 6 0M45 14q3 3 6 0M51 15q3 3 6 0" />
      <path d="M34 21q3 3 6 0M40 20q3 3 6 0M46 20q3 3 6 0M52 21q3 3 6 0" />
      <path d="M36 27q3 3 6 0M42 26q3 3 6 0M48 26q3 3 6 0" />
    </g>
    <g class="premium-pectoral">
      <path d="M47 23 C43 32 51 36 57 27 C52 29 49 27 47 23Z" fill="url(#emPremiumFin)" />
    </g>
    <path d="M62 11 C66 13 70 16 72 20 C70 23 66 26 62 28" fill="none" stroke="#07141d" stroke-width="1" opacity=".28" />
    <circle cx="64.5" cy="16" r="2.7" fill="#f6fff9" />
    <circle cx="65.2" cy="16.1" r="1.45" fill="#07131b" />
    <circle cx="65.8" cy="15.4" r=".5" fill="#fff" />
    <path d="M73 21q2 1 0 2" fill="none" stroke="#07131b" stroke-width=".8" stroke-linecap="round" opacity=".72" />
  </svg>
`;

function traceBody(ctx, s, bend, midBend) {
  const h = s * 0.48;
  ctx.beginPath();
  ctx.moveTo(s * 1.12, 0);
  ctx.bezierCurveTo(s * 0.72, -h * 1.08, s * 0.02, midBend - h, -s * 0.72, bend - h * 0.34);
  ctx.quadraticCurveTo(-s * 0.91, bend, -s * 0.72, bend + h * 0.34);
  ctx.bezierCurveTo(s * 0.02, midBend + h, s * 0.72, h * 1.08, s * 1.12, 0);
  ctx.closePath();
}

export function drawPremiumFish(ctx, fish, simTime) {
  const s = fish.size;
  const speed = Math.hypot(fish.vx, fish.vy);
  const effort = Math.min(1, speed / Math.max(1, fish.speed * 2));
  const rootWave = Math.sin(fish.tailPhase) * s * (0.18 + effort * 0.24);
  const tipWave = Math.sin(fish.tailPhase - 0.72) * s * (0.38 + effort * 0.34);
  const bodyBend = Math.sin(fish.tailPhase - 1.1) * s * (0.06 + effort * 0.08);
  const midBend = bodyBend * 0.42;
  const facingRaw = fish.facing ?? fish.dir;
  const facing = Math.abs(facingRaw) < 0.1 ? (facingRaw < 0 ? -0.1 : 0.1) : facingRaw;
  const angle = Math.max(-0.24, Math.min(0.24, fish.vy * 0.016));
  const finBeat = Math.sin(simTime * 4.1 + fish.tailPhase * 0.23);

  ctx.save();
  ctx.translate(fish.x, fish.y);
  ctx.rotate(angle);
  ctx.scale(facing, 1);

  // Layered translucent tail: two delayed curves make the body feel flexible
  // without a skeletal simulation or extra canvas.
  ctx.globalAlpha = 0.72;
  ctx.fillStyle = "#715ff0";
  ctx.beginPath();
  ctx.moveTo(-s * 0.68, bodyBend);
  ctx.bezierCurveTo(-s * 1.15, rootWave - s * 0.25, -s * 1.75, tipWave - s * 0.62, -s * 2.02, tipWave - s * 0.82);
  ctx.quadraticCurveTo(-s * 1.72, tipWave, -s * 2.02, tipWave + s * 0.82);
  ctx.bezierCurveTo(-s * 1.75, tipWave + s * 0.62, -s * 1.15, rootWave + s * 0.25, -s * 0.68, bodyBend);
  ctx.fill();
  ctx.globalAlpha = 0.38;
  ctx.strokeStyle = "#d8c8ff";
  ctx.lineWidth = Math.max(0.65, s * 0.035);
  ctx.beginPath();
  ctx.moveTo(-s * 0.78, bodyBend);
  ctx.quadraticCurveTo(-s * 1.45, rootWave - s * 0.2, -s * 1.98, tipWave - s * 0.72);
  ctx.moveTo(-s * 0.78, bodyBend);
  ctx.quadraticCurveTo(-s * 1.45, rootWave + s * 0.2, -s * 1.98, tipWave + s * 0.72);
  ctx.stroke();

  // Dorsal and pectoral fins move on a slower phase than the tail.
  ctx.globalAlpha = 0.68;
  ctx.fillStyle = "#35d9ca";
  ctx.beginPath();
  ctx.moveTo(-s * 0.35, -s * 0.38);
  ctx.quadraticCurveTo(s * 0.02, -s * (0.92 + finBeat * 0.08), s * 0.48, -s * 0.36);
  ctx.closePath();
  ctx.fill();

  // Body is clipped once; the iridescent patches are plain fills, avoiding
  // shadowBlur and per-frame image filters on mobile.
  ctx.save();
  traceBody(ctx, s, bodyBend, midBend);
  ctx.clip();
  ctx.globalAlpha = 0.98;
  ctx.fillStyle = "#20cbbf";
  ctx.fillRect(-s, -s, s * 2.3, s * 2);
  ctx.globalAlpha = 0.66;
  ctx.fillStyle = "#7560ed";
  ctx.beginPath();
  ctx.ellipse(-s * 0.25, s * 0.12, s * 0.72, s * 0.5, -0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#b9f64b";
  ctx.beginPath();
  ctx.ellipse(s * 0.52, -s * 0.24, s * 0.62, s * 0.24, 0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ff68a6";
  ctx.beginPath();
  ctx.ellipse(s * 0.26, s * 0.32, s * 0.52, s * 0.18, -0.08, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.globalAlpha = 0.32;
  ctx.strokeStyle = "#e8fffb";
  ctx.lineWidth = Math.max(0.55, s * 0.032);
  for (let row = -1; row <= 1; row += 1) {
    for (let col = -2; col <= 2; col += 1) {
      const x = col * s * 0.27 + (row === 0 ? s * 0.08 : 0);
      const y = row * s * 0.22 + midBend * (0.6 - Math.abs(col) * 0.08);
      ctx.beginPath();
      ctx.arc(x, y, s * 0.12, 0.12 * Math.PI, 0.88 * Math.PI);
      ctx.stroke();
    }
  }

  ctx.globalAlpha = 0.58;
  ctx.fillStyle = "#58e8da";
  ctx.beginPath();
  ctx.moveTo(s * 0.18, s * 0.22);
  ctx.quadraticCurveTo(s * (0.04 - finBeat * 0.16), s * 0.95, s * 0.58, s * (0.48 + finBeat * 0.08));
  ctx.closePath();
  ctx.fill();

  // Gill, eye and mouth anchor the stylised colour in believable anatomy.
  ctx.globalAlpha = 0.28;
  ctx.strokeStyle = "#07141d";
  ctx.lineWidth = Math.max(0.7, s * 0.045);
  ctx.beginPath();
  ctx.arc(s * 0.52, 0, s * 0.37, -0.9, 0.9);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#f7fff9";
  ctx.beginPath();
  ctx.arc(s * 0.72, -s * 0.18, s * 0.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#06131b";
  ctx.beginPath();
  ctx.arc(s * 0.755, -s * 0.18, s * 0.078, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(s * 0.79, -s * 0.225, s * 0.027, 0, Math.PI * 2);
  ctx.fill();

  const mouth = fish.mouth || 0;
  ctx.globalAlpha = 0.45 + mouth * 0.45;
  ctx.strokeStyle = "#07131b";
  ctx.lineWidth = Math.max(0.65, s * 0.038);
  ctx.beginPath();
  ctx.arc(s * 1.07, s * 0.05, s * (0.1 + mouth * 0.04), -0.7, 0.7);
  ctx.stroke();
  ctx.restore();
}
