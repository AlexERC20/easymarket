import { playFootballMotion } from "./football-motion.js?v=20260716-01";

const ASSEMBLE_END = 850;
const KICK_START = 1_150;
const KICK_AT = 1_480;
const EXPLODE_AT = 2_180;
const SCENE_DURATION = 3_150;
const INITIAL_YAW = -0.24;
const THREE_SOURCE = "/vendor/three/three.module.min.js?v=0.185.1";

let threePromise = null;
let activeScene = null;
let sceneRequestId = 0;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const lerp = (start, end, progress) => start + (end - start) * progress;
const easeOutCubic = (value) => 1 - (1 - value) ** 3;
const easeInOutCubic = (value) => (
  value < 0.5
    ? 4 * value * value * value
    : 1 - (-2 * value + 2) ** 3 / 2
);

function canUseWebGL() {
  try {
    const canvas = document.createElement("canvas");
    const context = (
      window.WebGL2RenderingContext && canvas.getContext("webgl2")
      || window.WebGLRenderingContext && (canvas.getContext("webgl") || canvas.getContext("experimental-webgl"))
    );
    context?.getExtension?.("WEBGL_lose_context")?.loseContext?.();
    return Boolean(context);
  } catch {
    return false;
  }
}

export function preloadFootball3DMotion() {
  if (!canUseWebGL()) {
    return Promise.resolve(null);
  }
  if (!threePromise) {
    threePromise = import(THREE_SOURCE).catch(() => {
      threePromise = null;
      return null;
    });
  }
  return threePromise;
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
    // The 3D scene remains visual outside Telegram.
  }
}

function createGlowTexture(THREE) {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.18, "rgba(214,255,220,0.96)");
  gradient.addColorStop(0.48, "rgba(82,255,184,0.34)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function createNumberTexture(THREE) {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }
  context.clearRect(0, 0, 128, 128);
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = "900 78px Arial";
  context.shadowColor = "rgba(123,255,104,0.9)";
  context.shadowBlur = 14;
  context.fillStyle = "#f8ffff";
  context.fillText("10", 64, 66);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createThreeScene(THREE, originElement, options = {}) {
  const overlay = document.createElement("div");
  overlay.className = "football-motion-scene football-motion-scene-3d";
  overlay.setAttribute("aria-hidden", "true");
  const canvas = document.createElement("canvas");
  canvas.className = "football-motion-canvas";
  overlay.appendChild(canvas);
  document.body.appendChild(overlay);

  const width = Math.max(1, window.innerWidth);
  const height = Math.max(1, window.innerHeight);
  const mobile = width <= 520;
  const lowMemory = Number(navigator.deviceMemory || 4) <= 3;
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: !lowMemory,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowMemory ? 1.1 : mobile ? 1.35 : 1.55));
  renderer.setSize(width, height, false);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.22;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x03070b, 0.045);
  const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 60);
  camera.position.set(0, 0.15, 8.5);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x07120e, 1.55));
  const keyLight = new THREE.DirectionalLight(0xe8faff, 3.15);
  keyLight.position.set(-3.5, 4.8, 5.2);
  scene.add(keyLight);
  const rimLight = new THREE.PointLight(0x35f6ff, 13, 10, 2);
  rimLight.position.set(2.6, 1.4, 2.7);
  scene.add(rimLight);
  const limeLight = new THREE.PointLight(0x7bff68, 8, 8, 2);
  limeLight.position.set(-2.2, -0.2, 2.2);
  scene.add(limeLight);

  const player = new THREE.Group();
  player.rotation.y = INITIAL_YAW;
  player.position.y = 0.12;
  scene.add(player);

  const playerMaterials = [];
  const geometryPool = [];
  const texturePool = [];

  function makeMaterial({ color, emissive, emissiveIntensity = 0.45, metalness = 0.25, roughness = 0.42 }) {
    const material = new THREE.MeshStandardMaterial({
      color,
      emissive,
      emissiveIntensity,
      metalness,
      roughness,
      transparent: true,
      opacity: 0,
    });
    playerMaterials.push(material);
    return material;
  }

  const jerseyMaterial = makeMaterial({ color: 0x163847, emissive: 0x0b6570, emissiveIntensity: 0.75, metalness: 0.55, roughness: 0.28 });
  const jerseyAccentMaterial = makeMaterial({ color: 0x85ff70, emissive: 0x42d65f, emissiveIntensity: 1.15, metalness: 0.32, roughness: 0.24 });
  const shortsMaterial = makeMaterial({ color: 0x09151e, emissive: 0x0b3040, emissiveIntensity: 0.52, metalness: 0.58, roughness: 0.3 });
  const skinMaterial = makeMaterial({ color: 0xc99f7a, emissive: 0x3d2019, emissiveIntensity: 0.22, metalness: 0.05, roughness: 0.54 });
  const sockMaterial = makeMaterial({ color: 0xdffcff, emissive: 0x38d7df, emissiveIntensity: 0.5, metalness: 0.22, roughness: 0.34 });
  const shoeMaterial = makeMaterial({ color: 0xf7ffff, emissive: 0x5affbb, emissiveIntensity: 0.75, metalness: 0.65, roughness: 0.2 });
  const hairMaterial = makeMaterial({ color: 0x101419, emissive: 0x050608, emissiveIntensity: 0.1, metalness: 0.15, roughness: 0.7 });

  const up = new THREE.Vector3(0, 1, 0);

  function addMesh(geometry, material, parent = player) {
    geometryPool.push(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    parent.add(mesh);
    return mesh;
  }

  function placeCapsule(mesh, start, end) {
    const direction = end.clone().sub(start);
    const distance = Math.max(0.001, direction.length());
    mesh.position.copy(start).add(end).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(up, direction.normalize());
    mesh.scale.set(1, distance / mesh.userData.baseDistance, 1);
  }

  function addCapsule(start, end, radius, material, parent = player) {
    const distance = start.distanceTo(end);
    const geometry = new THREE.CapsuleGeometry(radius, Math.max(0.035, distance - radius * 2), 5, 10);
    const mesh = addMesh(geometry, material, parent);
    mesh.userData.baseDistance = distance;
    placeCapsule(mesh, start, end);
    return mesh;
  }

  function addJoint(position, radius, material, parent = player) {
    const joint = addMesh(new THREE.SphereGeometry(radius, 14, 10), material, parent);
    joint.position.copy(position);
    return joint;
  }

  const torso = addMesh(new THREE.CylinderGeometry(0.41, 0.29, 1.02, 18, 4), jerseyMaterial);
  torso.position.set(-0.03, 0.63, 0);
  torso.scale.set(1, 1, 0.7);
  const chestBand = addMesh(new THREE.BoxGeometry(0.68, 0.055, 0.045), jerseyAccentMaterial);
  chestBand.position.set(-0.03, 0.78, 0.292);
  const pelvis = addMesh(new THREE.CapsuleGeometry(0.34, 0.14, 5, 14), shortsMaterial);
  pelvis.position.set(0.01, -0.07, 0);
  pelvis.scale.set(1.12, 1, 0.75);
  const neck = addCapsule(new THREE.Vector3(-0.04, 1.12, 0), new THREE.Vector3(-0.04, 1.3, 0), 0.13, skinMaterial);
  neck.scale.z = 0.9;
  const head = addMesh(new THREE.SphereGeometry(0.265, 20, 16), skinMaterial);
  head.position.set(-0.05, 1.52, 0.015);
  head.scale.set(0.94, 1.08, 0.92);
  const hair = addMesh(new THREE.SphereGeometry(0.27, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), hairMaterial);
  hair.position.set(-0.05, 1.59, 0.012);
  hair.scale.set(0.96, 0.8, 0.92);
  const nose = addMesh(new THREE.SphereGeometry(0.055, 10, 8), skinMaterial);
  nose.position.set(-0.04, 1.51, 0.272);
  nose.scale.set(0.75, 0.7, 1.05);
  const leftEar = addMesh(new THREE.SphereGeometry(0.058, 10, 8), skinMaterial);
  leftEar.position.set(-0.28, 1.53, 0.005);
  leftEar.scale.set(0.62, 1, 0.52);
  const rightEar = addMesh(new THREE.SphereGeometry(0.058, 10, 8), skinMaterial);
  rightEar.position.set(0.18, 1.53, 0.005);
  rightEar.scale.set(0.62, 1, 0.52);
  const leftEye = addMesh(new THREE.SphereGeometry(0.026, 8, 6), hairMaterial);
  leftEye.position.set(-0.13, 1.57, 0.23);
  const rightEye = addMesh(new THREE.SphereGeometry(0.026, 8, 6), hairMaterial);
  rightEye.position.set(0.025, 1.57, 0.23);
  const mouth = addMesh(new THREE.BoxGeometry(0.13, 0.018, 0.018), hairMaterial);
  mouth.position.set(-0.045, 1.41, 0.225);

  const numberTexture = createNumberTexture(THREE);
  if (numberTexture) {
    texturePool.push(numberTexture);
    const numberMaterial = new THREE.MeshBasicMaterial({
      map: numberTexture,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    playerMaterials.push(numberMaterial);
    const number = addMesh(new THREE.PlaneGeometry(0.36, 0.36), numberMaterial);
    number.position.set(-0.035, 0.66, 0.31);
  }

  const leftHip = new THREE.Vector3(-0.22, -0.12, 0);
  const leftKnee = new THREE.Vector3(-0.48, -0.82, 0.08);
  const leftAnkle = new THREE.Vector3(-0.53, -1.53, 0.03);
  addCapsule(leftHip, leftKnee, 0.205, shortsMaterial);
  addCapsule(leftKnee, leftAnkle, 0.158, sockMaterial);
  addCapsule(leftAnkle, new THREE.Vector3(-0.34, -1.59, 0.24), 0.105, shoeMaterial);
  addJoint(leftHip, 0.21, shortsMaterial);
  addJoint(leftKnee, 0.17, sockMaterial);
  addJoint(leftAnkle, 0.12, sockMaterial);

  const rightHip = new THREE.Vector3(0.23, -0.12, 0.02);
  const rightKneeStart = new THREE.Vector3(0.48, -0.77, 0.16);
  const rightFootStart = new THREE.Vector3(-0.02, -1.35, 0.24);
  const rightKneeEnd = new THREE.Vector3(0.58, -0.61, 0.08);
  const rightFootEnd = new THREE.Vector3(1.37, -0.83, 0.16);
  const rightUpperLeg = addCapsule(rightHip, rightKneeStart, 0.205, shortsMaterial);
  const rightLowerLeg = addCapsule(rightKneeStart, rightFootStart, 0.158, sockMaterial);
  const rightShoe = addCapsule(rightFootStart, new THREE.Vector3(0.16, -1.36, 0.41), 0.105, shoeMaterial);
  const rightHipJoint = addJoint(rightHip, 0.21, shortsMaterial);
  const rightKneeJoint = addJoint(rightKneeStart, 0.17, sockMaterial);
  const rightAnkleJoint = addJoint(rightFootStart, 0.12, sockMaterial);

  const leftShoulder = new THREE.Vector3(-0.4, 0.95, 0);
  const leftElbowStart = new THREE.Vector3(-0.76, 0.58, 0.12);
  const leftHandStart = new THREE.Vector3(-0.65, 0.17, 0.19);
  const leftElbowEnd = new THREE.Vector3(-0.83, 1.05, 0.12);
  const leftHandEnd = new THREE.Vector3(-1.05, 0.75, 0.2);
  const leftUpperArm = addCapsule(leftShoulder, leftElbowStart, 0.155, jerseyMaterial);
  const leftLowerArm = addCapsule(leftElbowStart, leftHandStart, 0.115, skinMaterial);
  addJoint(leftShoulder, 0.19, jerseyMaterial);
  const leftElbowJoint = addJoint(leftElbowStart, 0.13, skinMaterial);
  const leftHand = addMesh(new THREE.SphereGeometry(0.135, 12, 8), skinMaterial);
  leftHand.position.copy(leftHandStart);

  const rightShoulder = new THREE.Vector3(0.35, 0.95, 0);
  const rightElbowStart = new THREE.Vector3(0.73, 0.62, -0.08);
  const rightHandStart = new THREE.Vector3(0.92, 0.84, -0.04);
  const rightElbowEnd = new THREE.Vector3(0.67, 1.2, -0.04);
  const rightHandEnd = new THREE.Vector3(0.98, 1.02, 0.06);
  const rightUpperArm = addCapsule(rightShoulder, rightElbowStart, 0.155, jerseyMaterial);
  const rightLowerArm = addCapsule(rightElbowStart, rightHandStart, 0.115, skinMaterial);
  addJoint(rightShoulder, 0.19, jerseyMaterial);
  const rightElbowJoint = addJoint(rightElbowStart, 0.13, skinMaterial);
  const rightHand = addMesh(new THREE.SphereGeometry(0.135, 12, 8), skinMaterial);
  rightHand.position.copy(rightHandStart);

  const ballStart = new THREE.Vector3(1.57, -0.88, 0.18);
  const ballControl = new THREE.Vector3(2.25, 0.82, 1.45);
  const ballEnd = new THREE.Vector3(3.65, 1.3, 4.1);
  const ball = new THREE.Group();
  ball.position.copy(ballStart);
  scene.add(ball);
  const ballMaterial = new THREE.MeshStandardMaterial({
    color: 0xf8ffff,
    emissive: 0x65ffb7,
    emissiveIntensity: 0.38,
    metalness: 0.34,
    roughness: 0.24,
    transparent: true,
    opacity: 0,
  });
  const ballGeometry = new THREE.IcosahedronGeometry(0.29, 3);
  geometryPool.push(ballGeometry);
  const ballMesh = new THREE.Mesh(ballGeometry, ballMaterial);
  ball.add(ballMesh);
  const ballEdgeSource = new THREE.IcosahedronGeometry(0.295, 1);
  const ballEdgeGeometry = new THREE.EdgesGeometry(ballEdgeSource, 18);
  ballEdgeSource.dispose();
  geometryPool.push(ballEdgeGeometry);
  const ballEdgeMaterial = new THREE.LineBasicMaterial({
    color: 0xffd35c,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
  });
  const ballEdges = new THREE.LineSegments(ballEdgeGeometry, ballEdgeMaterial);
  ball.add(ballEdges);

  const ballLight = new THREE.PointLight(0x7bff68, 0, 5, 2);
  ball.add(ballLight);

  const field = new THREE.GridHelper(5.4, 12, 0x2bd88d, 0x164d46);
  field.position.set(0, -1.7, -0.25);
  field.material.transparent = true;
  field.material.opacity = 0;
  scene.add(field);

  const ringMaterial = new THREE.MeshBasicMaterial({
    color: 0x7bff68,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const ringGeometry = new THREE.RingGeometry(0.22, 0.255, 48);
  geometryPool.push(ringGeometry);
  const impactRing = new THREE.Mesh(ringGeometry, ringMaterial);
  impactRing.position.copy(ballStart);
  impactRing.lookAt(camera.position);
  scene.add(impactRing);

  function makeBolt(start, end, color) {
    const points = [];
    const direction = end.clone().sub(start);
    for (let index = 0; index <= 9; index += 1) {
      const progress = index / 9;
      const point = start.clone().addScaledVector(direction, progress);
      if (index > 0 && index < 9) {
        point.x += (Math.random() - 0.5) * 0.22;
        point.y += (Math.random() - 0.5) * 0.22;
        point.z += (Math.random() - 0.5) * 0.14;
      }
      points.push(point);
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    geometryPool.push(geometry);
    const material = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const line = new THREE.Line(geometry, material);
    scene.add(line);
    return { line, material };
  }

  const kickBolts = [
    makeBolt(ballStart, new THREE.Vector3(-1.25, 0.3, 0.4), 0x7bff68),
    makeBolt(ballStart, new THREE.Vector3(0.15, 1.75, 0.6), 0x35f6ff),
  ];
  const explosionBolts = [
    makeBolt(new THREE.Vector3(0, 0.25, 0), new THREE.Vector3(-1.6, -0.7, 0.8), 0x35f6ff),
    makeBolt(new THREE.Vector3(0, 0.25, 0), new THREE.Vector3(1.65, 0.85, 0.5), 0x7bff68),
  ];

  const particleTargets = [];
  const particleColors = [];
  const particleKinds = [];
  const ballOffsets = [];

  function addParticle(point, color, kind = 0, ballOffset = null) {
    const rotated = kind === 1 ? point.clone() : point.clone().applyAxisAngle(up, INITIAL_YAW);
    particleTargets.push(rotated);
    particleColors.push(new THREE.Color(color));
    particleKinds.push(kind);
    ballOffsets.push(ballOffset || new THREE.Vector3());
  }

  function sampleEllipsoid(center, radii, count, color) {
    for (let index = 0; index < count; index += 1) {
      const theta = Math.random() * Math.PI * 2;
      const cosPhi = Math.random() * 2 - 1;
      const sinPhi = Math.sqrt(1 - cosPhi * cosPhi);
      addParticle(new THREE.Vector3(
        center.x + radii.x * sinPhi * Math.cos(theta),
        center.y + radii.y * cosPhi,
        center.z + radii.z * sinPhi * Math.sin(theta),
      ), color);
    }
  }

  function sampleCapsule(start, end, radius, count, color) {
    const axis = end.clone().sub(start);
    const length = axis.length();
    const direction = axis.clone().normalize();
    const reference = Math.abs(direction.y) < 0.86 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const tangent = new THREE.Vector3().crossVectors(direction, reference).normalize();
    const bitangent = new THREE.Vector3().crossVectors(direction, tangent).normalize();
    for (let index = 0; index < count; index += 1) {
      const progress = Math.random();
      const angle = Math.random() * Math.PI * 2;
      const surfaceRadius = radius * (0.76 + Math.random() * 0.24);
      const point = start.clone().addScaledVector(direction, length * progress)
        .addScaledVector(tangent, Math.cos(angle) * surfaceRadius)
        .addScaledVector(bitangent, Math.sin(angle) * surfaceRadius);
      addParticle(point, color);
    }
  }

  sampleEllipsoid(new THREE.Vector3(-0.03, 0.63, 0), new THREE.Vector3(0.44, 0.62, 0.31), 92, 0x35f6ff);
  sampleEllipsoid(new THREE.Vector3(0.01, -0.04, 0), new THREE.Vector3(0.49, 0.27, 0.38), 42, 0x163847);
  sampleEllipsoid(new THREE.Vector3(-0.05, 1.52, 0.015), new THREE.Vector3(0.28, 0.31, 0.27), 50, 0xf8ffff);
  sampleCapsule(leftHip, leftKnee, 0.17, 31, 0x35f6ff);
  sampleCapsule(leftKnee, leftAnkle, 0.135, 30, 0x7bff68);
  sampleCapsule(rightHip, rightKneeStart, 0.17, 31, 0x35f6ff);
  sampleCapsule(rightKneeStart, rightFootStart, 0.135, 30, 0x7bff68);
  sampleCapsule(leftShoulder, leftElbowStart, 0.125, 25, 0x35f6ff);
  sampleCapsule(leftElbowStart, leftHandStart, 0.105, 24, 0x7bff68);
  sampleCapsule(rightShoulder, rightElbowStart, 0.125, 25, 0x35f6ff);
  sampleCapsule(rightElbowStart, rightHandStart, 0.105, 24, 0x7bff68);

  for (let index = 0; index < 64; index += 1) {
    const theta = Math.random() * Math.PI * 2;
    const cosPhi = Math.random() * 2 - 1;
    const sinPhi = Math.sqrt(1 - cosPhi * cosPhi);
    const offset = new THREE.Vector3(
      0.3 * sinPhi * Math.cos(theta),
      0.3 * cosPhi,
      0.3 * sinPhi * Math.sin(theta),
    );
    const point = ballStart.clone().add(offset);
    addParticle(point, index % 3 ? 0xf8ffff : 0xffd35c, 1, offset);
  }

  const maximumParticles = lowMemory ? 270 : mobile ? 390 : 470;
  const stride = Math.max(1, Math.ceil(particleTargets.length / maximumParticles));
  const targets = particleTargets.filter((_, index) => index % stride === 0);
  const colors = particleColors.filter((_, index) => index % stride === 0);
  const kinds = particleKinds.filter((_, index) => index % stride === 0);
  const filteredBallOffsets = ballOffsets.filter((_, index) => index % stride === 0);
  const count = targets.length;

  const originRect = originElement?.getBoundingClientRect?.();
  const originX = originRect?.width ? originRect.left + originRect.width / 2 : width / 2;
  const originY = originRect?.height ? originRect.top + originRect.height / 2 : 58;
  const visibleHeight = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
  const visibleWidth = visibleHeight * camera.aspect;
  const originWorld = new THREE.Vector3(
    (originX / width * 2 - 1) * visibleWidth / 2,
    -(originY / height * 2 - 1) * visibleHeight / 2,
    0,
  );

  const particlePositions = new Float32Array(count * 3);
  const particleColorBuffer = new Float32Array(count * 3);
  const startPositions = new Float32Array(count * 3);
  const targetPositions = new Float32Array(count * 3);
  const swirlVectors = new Float32Array(count * 3);
  const explosionVelocities = new Float32Array(count * 3);
  const delays = new Float32Array(count);
  const tempVector = new THREE.Vector3();

  for (let index = 0; index < count; index += 1) {
    const offset = index * 3;
    const angle = Math.random() * Math.PI * 2;
    const radius = 0.07 + Math.random() * 0.34;
    startPositions[offset] = originWorld.x + Math.cos(angle) * radius;
    startPositions[offset + 1] = originWorld.y + Math.sin(angle) * radius;
    startPositions[offset + 2] = (Math.random() - 0.5) * 0.42;
    particlePositions[offset] = startPositions[offset];
    particlePositions[offset + 1] = startPositions[offset + 1];
    particlePositions[offset + 2] = startPositions[offset + 2];
    targetPositions[offset] = targets[index].x;
    targetPositions[offset + 1] = targets[index].y + (kinds[index] === 1 ? 0 : 0.12);
    targetPositions[offset + 2] = targets[index].z;
    particleColorBuffer[offset] = colors[index].r;
    particleColorBuffer[offset + 1] = colors[index].g;
    particleColorBuffer[offset + 2] = colors[index].b;
    swirlVectors[offset] = (Math.random() - 0.5) * 1.3;
    swirlVectors[offset + 1] = (Math.random() - 0.5) * 1.3;
    swirlVectors[offset + 2] = (Math.random() - 0.5) * 0.9;
    const targetDirection = tempVector.copy(targets[index]).normalize();
    explosionVelocities[offset] = targetDirection.x * (1.2 + Math.random() * 2.7) + (Math.random() - 0.5) * 1.3;
    explosionVelocities[offset + 1] = targetDirection.y * (1.2 + Math.random() * 2.7) + Math.random() * 1.2;
    explosionVelocities[offset + 2] = targetDirection.z * (1.4 + Math.random() * 2.8) + (Math.random() - 0.5) * 1.5;
    delays[index] = Math.random() * 0.19;
  }

  const particleGeometry = new THREE.BufferGeometry();
  geometryPool.push(particleGeometry);
  particleGeometry.setAttribute("position", new THREE.BufferAttribute(particlePositions, 3));
  particleGeometry.setAttribute("color", new THREE.BufferAttribute(particleColorBuffer, 3));
  const glowTexture = createGlowTexture(THREE);
  if (glowTexture) {
    texturePool.push(glowTexture);
  }
  const particleMaterial = new THREE.PointsMaterial({
    size: lowMemory ? 0.075 : 0.065,
    map: glowTexture,
    vertexColors: true,
    transparent: true,
    opacity: 1,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const particleCloud = new THREE.Points(particleGeometry, particleMaterial);
  scene.add(particleCloud);

  const trailCount = 22;
  const trailPositions = new Float32Array(trailCount * 3);
  const trailGeometry = new THREE.BufferGeometry();
  geometryPool.push(trailGeometry);
  trailGeometry.setAttribute("position", new THREE.BufferAttribute(trailPositions, 3));
  const trailMaterial = new THREE.PointsMaterial({
    size: 0.11,
    map: glowTexture,
    color: 0x7bff68,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const trail = new THREE.Points(trailGeometry, trailMaterial);
  scene.add(trail);

  let frameId = 0;
  let destroyed = false;
  let disposed = false;
  let kickFired = false;
  let explosionFired = false;
  const startedAt = performance.now();
  const ballHistory = Array.from({ length: trailCount }, () => ballStart.clone());
  originElement?.classList.add("football-motion-trigger");

  function setOpacity(value) {
    for (const material of playerMaterials) {
      material.opacity = value;
    }
  }

  function updatePose(time) {
    const kick = easeInOutCubic(clamp((time - KICK_START) / (KICK_AT - KICK_START), 0, 1));
    const follow = easeOutCubic(clamp((time - KICK_AT) / 280, 0, 1));
    const rightKnee = rightKneeStart.clone().lerp(rightKneeEnd, kick);
    const rightFoot = rightFootStart.clone().lerp(rightFootEnd, kick)
      .add(new THREE.Vector3(0.16 * follow, 0.1 * follow, 0.02));
    placeCapsule(rightUpperLeg, rightHip, rightKnee);
    placeCapsule(rightLowerLeg, rightKnee, rightFoot);
    placeCapsule(rightShoe, rightFoot, rightFoot.clone().add(new THREE.Vector3(0.23, 0.01, 0.19)));
    rightHipJoint.position.copy(rightHip);
    rightKneeJoint.position.copy(rightKnee);
    rightAnkleJoint.position.copy(rightFoot);

    const leftElbow = leftElbowStart.clone().lerp(leftElbowEnd, kick);
    const leftHandPoint = leftHandStart.clone().lerp(leftHandEnd, kick);
    placeCapsule(leftUpperArm, leftShoulder, leftElbow);
    placeCapsule(leftLowerArm, leftElbow, leftHandPoint);
    leftElbowJoint.position.copy(leftElbow);
    leftHand.position.copy(leftHandPoint);

    const rightElbow = rightElbowStart.clone().lerp(rightElbowEnd, kick);
    const rightHandPoint = rightHandStart.clone().lerp(rightHandEnd, kick);
    placeCapsule(rightUpperArm, rightShoulder, rightElbow);
    placeCapsule(rightLowerArm, rightElbow, rightHandPoint);
    rightElbowJoint.position.copy(rightElbow);
    rightHand.position.copy(rightHandPoint);

    player.rotation.y = lerp(INITIAL_YAW, 0.08, kick);
    player.rotation.z = -0.09 * kick + 0.035 * follow;
    return kick;
  }

  function ballPosition(progress) {
    const inverse = 1 - progress;
    return new THREE.Vector3(
      inverse * inverse * ballStart.x + 2 * inverse * progress * ballControl.x + progress * progress * ballEnd.x,
      inverse * inverse * ballStart.y + 2 * inverse * progress * ballControl.y + progress * progress * ballEnd.y,
      inverse * inverse * ballStart.z + 2 * inverse * progress * ballControl.z + progress * progress * ballEnd.z,
    );
  }

  function updateParticles(time, ballFlight) {
    const positionAttribute = particleGeometry.getAttribute("position");
    const positions = positionAttribute.array;
    const assemblyTime = time / ASSEMBLE_END;
    const explosionTime = Math.max(0, time - EXPLODE_AT) / 1_000;
    const exploded = time >= EXPLODE_AT;
    const ballAngle = ballFlight * Math.PI * 6;

    for (let index = 0; index < count; index += 1) {
      const offset = index * 3;
      if (exploded && kinds[index] === 0) {
        positions[offset] = targetPositions[offset] + explosionVelocities[offset] * explosionTime;
        positions[offset + 1] = targetPositions[offset + 1] + explosionVelocities[offset + 1] * explosionTime - 1.3 * explosionTime * explosionTime;
        positions[offset + 2] = targetPositions[offset + 2] + explosionVelocities[offset + 2] * explosionTime;
        continue;
      }

      if (kinds[index] === 1 && time >= KICK_AT) {
        const ballPoint = ball.position;
        const original = filteredBallOffsets[index];
        const rotatedX = original.x * Math.cos(ballAngle) - original.y * Math.sin(ballAngle);
        const rotatedY = original.x * Math.sin(ballAngle) + original.y * Math.cos(ballAngle);
        positions[offset] = ballPoint.x + rotatedX;
        positions[offset + 1] = ballPoint.y + rotatedY;
        positions[offset + 2] = ballPoint.z + original.z;
        continue;
      }

      if (time < ASSEMBLE_END) {
        const progress = easeInOutCubic(clamp((assemblyTime - delays[index]) / Math.max(0.01, 1 - delays[index]), 0, 1));
        const arc = Math.sin(progress * Math.PI);
        positions[offset] = lerp(startPositions[offset], targetPositions[offset], progress) + swirlVectors[offset] * arc;
        positions[offset + 1] = lerp(startPositions[offset + 1], targetPositions[offset + 1], progress) + swirlVectors[offset + 1] * arc;
        positions[offset + 2] = lerp(startPositions[offset + 2], targetPositions[offset + 2], progress) + swirlVectors[offset + 2] * arc;
      } else {
        const shimmer = Math.sin(time * 0.006 + index * 0.71) * 0.012;
        positions[offset] = targetPositions[offset] + shimmer;
        positions[offset + 1] = targetPositions[offset + 1] + shimmer * 0.6;
        positions[offset + 2] = targetPositions[offset + 2] + shimmer * 0.8;
      }
    }
    positionAttribute.needsUpdate = true;
  }

  function updateTrail(ballFlight) {
    if (ballFlight <= 0) {
      trailMaterial.opacity = 0;
      return;
    }
    ballHistory.unshift(ball.position.clone());
    ballHistory.length = trailCount;
    for (let index = 0; index < trailCount; index += 1) {
      const point = ballHistory[index];
      trailPositions[index * 3] = point.x;
      trailPositions[index * 3 + 1] = point.y;
      trailPositions[index * 3 + 2] = point.z;
    }
    trailGeometry.getAttribute("position").needsUpdate = true;
    trailMaterial.opacity = Math.sin(Math.min(1, ballFlight) * Math.PI) * 0.66;
  }

  function updateBolts(time) {
    const kickPulse = Math.sin(clamp((time - KICK_AT) / 220, 0, 1) * Math.PI);
    const explosionPulse = Math.sin(clamp((time - EXPLODE_AT) / 240, 0, 1) * Math.PI);
    kickBolts.forEach(({ material }, index) => {
      material.opacity = time >= KICK_AT && time <= KICK_AT + 220 ? kickPulse * (index ? 0.75 : 1) : 0;
    });
    explosionBolts.forEach(({ material }, index) => {
      material.opacity = time >= EXPLODE_AT && time <= EXPLODE_AT + 240 ? explosionPulse * (index ? 0.72 : 0.92) : 0;
    });
  }

  function dispose() {
    if (disposed) {
      return;
    }
    disposed = true;
    scene.traverse((object) => {
      if (object.geometry && !geometryPool.includes(object.geometry)) {
        object.geometry.dispose?.();
      }
    });
    geometryPool.forEach((geometry) => geometry.dispose?.());
    playerMaterials.forEach((material) => material.dispose?.());
    ballMaterial.dispose();
    ballEdgeMaterial.dispose();
    ringMaterial.dispose();
    particleMaterial.dispose();
    trailMaterial.dispose();
    field.material.dispose?.();
    texturePool.forEach((texture) => texture.dispose?.());
    kickBolts.concat(explosionBolts).forEach(({ material }) => material.dispose());
    renderer.dispose();
    renderer.forceContextLoss?.();
  }

  function destroy(immediate = false) {
    if (destroyed) {
      return;
    }
    destroyed = true;
    window.cancelAnimationFrame(frameId);
    originElement?.classList.remove("football-motion-trigger");
    dispose();
    if (immediate) {
      overlay.remove();
    } else {
      overlay.classList.add("is-leaving");
      window.setTimeout(() => overlay.remove(), 180);
    }
    if (activeScene?.destroy === destroy) {
      activeScene = null;
    }
  }

  function frame(now) {
    if (destroyed) {
      return;
    }
    if (document.hidden) {
      destroy(true);
      return;
    }
    const time = now - startedAt;
    const assemble = easeOutCubic(clamp(time / ASSEMBLE_END, 0, 1));
    const kick = updatePose(time);
    const ballFlight = easeOutCubic(clamp((time - KICK_AT) / 570, 0, 1));
    const explosion = easeOutCubic(clamp((time - EXPLODE_AT) / 650, 0, 1));

    if (ballFlight > 0) {
      ball.position.copy(ballPosition(ballFlight));
      ball.rotation.x += 0.11;
      ball.rotation.y += 0.16;
      ball.rotation.z += 0.08;
    } else {
      ball.position.copy(ballStart);
    }

    const meshOpacity = time < EXPLODE_AT
      ? clamp((time - 690) / 260, 0, 1) * 0.96
      : (1 - explosion) * 0.96;
    setOpacity(meshOpacity);
    ballMaterial.opacity = time < EXPLODE_AT ? clamp((time - 710) / 240, 0, 1) : 1 - explosion;
    ballEdgeMaterial.opacity = ballMaterial.opacity * 0.92;
    ballLight.intensity = 4 + ballFlight * 24;
    field.material.opacity = assemble * (1 - explosion) * 0.18;
    particleMaterial.opacity = time < KICK_START
      ? 1
      : time < EXPLODE_AT
        ? lerp(1, 0.48, kick)
        : 1 - explosion;

    updateParticles(time, ballFlight);
    updateTrail(ballFlight);
    updateBolts(time);

    const ringAge = clamp((time - KICK_AT) / 520, 0, 1);
    impactRing.scale.setScalar(1 + easeOutCubic(ringAge) * 6.2);
    ringMaterial.opacity = time >= KICK_AT && time < KICK_AT + 520
      ? (1 - ringAge) * 0.88
      : 0;

    const pulse = time >= ASSEMBLE_END && time < KICK_START
      ? 1 + Math.sin((time - ASSEMBLE_END) * 0.018) * 0.025
      : 1;
    player.scale.setScalar(pulse * lerp(0.88, 1, assemble));
    playerMaterials.forEach((material, index) => {
      if ("emissiveIntensity" in material) {
        material.emissiveIntensity = (index === 1 ? 1.05 : 0.48) + Math.sin(time * 0.006 + index) * 0.12;
      }
    });

    let shakeX = 0;
    let shakeY = 0;
    if (time >= KICK_AT && time < KICK_AT + 190) {
      const decay = Math.exp(-(time - KICK_AT) / 70);
      shakeX = Math.sin((time - KICK_AT) * 0.13) * 0.08 * decay;
      shakeY = Math.cos((time - KICK_AT) * 0.16) * 0.05 * decay;
    }
    if (time >= EXPLODE_AT && time < EXPLODE_AT + 250) {
      const decay = Math.exp(-(time - EXPLODE_AT) / 90);
      shakeX += Math.sin((time - EXPLODE_AT) * 0.15) * 0.12 * decay;
      shakeY += Math.cos((time - EXPLODE_AT) * 0.17) * 0.08 * decay;
    }
    camera.position.x = Math.sin(time * 0.0018) * 0.08 + shakeX;
    camera.position.y = 0.15 + Math.cos(time * 0.0016) * 0.035 + shakeY;
    camera.position.z = 8.5 - kick * 0.35 + explosion * 0.18;
    camera.lookAt(0.24, 0.12, 0);

    renderer.render(scene, camera);

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

  overlay.classList.add("is-active");
  frameId = window.requestAnimationFrame(frame);
  return { destroy };
}

export async function playFootball3DMotion(originElement, options = {}) {
  const requestId = ++sceneRequestId;
  activeScene?.destroy?.(true);
  activeScene = null;
  originElement?.classList.remove("football-motion-trigger");
  void originElement?.offsetWidth;
  originElement?.classList.add("football-motion-trigger");

  const THREE = await preloadFootball3DMotion();
  if (requestId !== sceneRequestId) {
    return false;
  }
  if (!THREE) {
    originElement?.classList.remove("football-motion-trigger");
    return playFootballMotion(originElement, options);
  }

  try {
    activeScene = createThreeScene(THREE, originElement, options);
    return true;
  } catch {
    originElement?.classList.remove("football-motion-trigger");
    return playFootballMotion(originElement, options);
  }
}
