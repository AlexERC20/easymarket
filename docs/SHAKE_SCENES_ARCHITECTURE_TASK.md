# Task: extract a pluggable "shake scene" architecture from the aquarium

## Goal

Today `public/aquarium.js` is the only shake-triggered scene (shake → food falls →
fish swim in). We want several interchangeable shake scenes — the aquarium now, a
basketball scene and a golf scene later — selected at runtime per user (alternate
daily, unlock for depositors, unlock via tasks). This task is ONLY the
architecture refactor. Scene selection flags and the new scenes themselves come
later; do not build them.

## What to build

1. **`public/shake-scenes.js`** — a small registry + orchestrator (vanilla ES
   module, no frameworks, like the rest of `public/`):
   - `registerScene(scene)`, `setActiveScene(key)`, `getActiveSceneKey()`.
   - Derive the scene interface from what `aquarium.js` actually does today —
     do not invent speculative hooks. Expected shape (adapt as the code
     dictates): `key`, `summon()` (shake happened), `update(dt)`, `draw(ctx)`,
     `windDown()`, `isAlive()`, `setEnabled(bool)`, `onTilt(tilt)`,
     `onEntitlements(mePayload)`, plus the DOM-fallback contract for iOS.
   - The orchestrator owns the shared infrastructure that is scene-agnostic:
     canvas acquisition + DPR sizing, the frame loop with the existing ~30fps
     cap, sensor wiring (Telegram Accelerometer / DeviceOrientation — iOS
     Telegram blocks the W3C events, keep that path exactly as is), shake
     detection, and starting/stopping the loop when the active scene reports
     alive/idle.
   - Only ONE scene is active at a time. Nothing may animate at idle — keep the
     current wind-down behaviour.

2. **Refactor `public/aquarium.js` into the first scene** implementing that
   interface. Fish/food/bubbles/premium-fish logic stays inside aquarium.js;
   `premium-fish.js` stays as is. **Zero behaviour change**: shake feeding,
   tilt drift, golden fish, premium (depositor) fish, eat/food sounds, DOM
   fallback on iOS, wind-down — all identical to before.

3. **Keep `app.js` integration stable.** `app.js` imports: `initAquarium`,
   `isAquariumEnabled`, `primeAquarium`, `setAquariumEnabled`,
   `setAquariumGoldenFish`, `setAquariumPremiumFish`,
   `setAquariumRuntimeAllowed`, `setAquariumShakeFeeder`. Either re-export
   working equivalents or update the call sites — whichever gives the smaller,
   clearer diff. The default active scene is `"aquarium"` so current users see
   no difference.

4. **Prove pluggability** with a trivial second scene registered behind a dev
   hook (e.g. a `window.__setShakeScene("...")` console helper or similar) —
   something visually obvious but minimal (a few drifting glow orbs is enough).
   No UI, no server flag yet.

## Hard constraints

- Performance rules already in the codebase are non-negotiable: ~30fps cap, no
  `shadowBlur`/per-frame `ctx.filter`, glows via prerendered sprites, DOM path
  animates only `transform`/`opacity` with CSS keyframes.
- Don't touch chart rendering, `lightning-motion.*`, wallet/sheet code, or
  server code (scene flags in the `me` payload are a later task).
- Bump `?v=` cache-busting versions along the whole import chain you touch
  (`index.html` → `app.js` → `aquarium.js` / `shake-scenes.js` →
  `premium-fish.js`).
- Match the repo's style: vanilla JS, mixed RU/EN comments, no build step.

## Acceptance

- Aquarium behaves exactly as before on desktop and mobile paths (shake feed,
  tilt, premium fish joining mid-session via `setAquariumPremiumFish`, sounds).
- `node --check` passes for every touched module (copy to `.mjs` to check).
- Switching to the demo scene via the dev hook works and switching back
  restores the aquarium without a reload.
- Diff stays focused: no drive-by refactors outside the scene extraction.

## Context for later (do not implement now)

The next scene will be a basketball tribute scene (balls drop from the chart
candles, a neon-silhouette player shoots arcing three-pointers into a hoop
anchored at the current price level). It will be a separate module implementing
this same interface — design the interface so such a scene needs no changes to
the orchestrator.
