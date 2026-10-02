import * as THREE from '../node_modules/three/build/three.module.js';

// --- Config ---
const ATLAS_COLS = 6;
const ATLAS_ROWS = 6;

const ANIM_CONFIG = {
  sleeping:  { row: 0, frames: 6, fps: 3,  loop: true  },
  waking:    { row: 1, frames: 6, fps: 2,  loop: false, loops: 1 },
  typing:    { row: 2, frames: 6, fps: 8,  loop: false },
  alarmed:   { row: 3, frames: 6, fps: 8,  loop: false },
  celebrate: { row: 4, frames: 6, fps: 8,  loop: false },
  annoyed:   { row: 5, frames: 6, fps: 8,  loop: false },
};

// --- Scene setup ---
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({
  canvas,
  alpha: true,
  antialias: false,
});
renderer.setSize(200, 200);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setClearColor(0x000000, 0);

const scene = new THREE.Scene();

const camera = new THREE.OrthographicCamera(-100, 100, 100, -100, 0.1, 10);
camera.position.z = 1;

// --- Background ---
const bgTex = new THREE.TextureLoader().load('peon-asset://bg.png');
const bgMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(180, 180),
  new THREE.MeshBasicMaterial({ map: bgTex, color: 0x888888 })
);
bgMesh.position.z = -0.5;
scene.add(bgMesh);

// --- Sprite mesh ---
const loader = new THREE.TextureLoader();
const atlas = loader.load('peon-asset://sprite-atlas.png', () => {
  atlas.magFilter = THREE.NearestFilter;
  atlas.minFilter = THREE.NearestFilter;
  atlas.generateMipmaps = false;
  atlas.needsUpdate = true;
});

// Square sprite — fills most of the 200×200 window
let geometry = new THREE.PlaneGeometry(180, 180);
const material = new THREE.MeshBasicMaterial({
  map: atlas,
  transparent: true,
  alphaTest: 0.01,
});
const sprite = new THREE.Mesh(geometry, material);
scene.add(sprite);
sprite.position.y = 0;

// --- Flash overlay ---
async function loadShader(url) {
  const r = await fetch(url);
  return r.text();
}

let flashMesh = null;
let flashIntensity = 0;
const flashColor = new THREE.Color(1, 1, 0);
let flashDecay = 2.0;

async function setupFlash() {
  const vert = await loadShader('./shaders/flash.vert');
  const frag = await loadShader('./shaders/flash.frag');

  const flashMat = new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    uniforms: {
      flashColor: { value: flashColor },
      flashIntensity: { value: 0.0 },
    },
    transparent: true,
    depthTest: false,
  });

  const flashGeo = new THREE.PlaneGeometry(200, 200);
  flashMesh = new THREE.Mesh(flashGeo, flashMat);
  flashMesh.position.z = 0.5;
  scene.add(flashMesh);
}

setupFlash();

// --- Border overlay ---
const borderTex = loader.load('peon-asset://borders.png', () => {
  borderTex.magFilter = THREE.NearestFilter;
  borderTex.minFilter = THREE.NearestFilter;
  borderTex.needsUpdate = true;
});
const borderMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(200, 200),
  new THREE.MeshBasicMaterial({ map: borderTex, transparent: true, depthTest: false })
);
borderMesh.position.z = 0.4;
scene.add(borderMesh);

// --- Tint: a translucent colour filter so several pets of one species can be told apart ---
const tintMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(200, 200),
  new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthTest: false })
);
tintMesh.position.z = 0.35;
scene.add(tintMesh);

let petLook = null;
window.peonBridge.onPetLook((look) => {
  petLook = look;
  tintMesh.material.color.setRGB(look.tintRgb[0] / 255, look.tintRgb[1] / 255, look.tintRgb[2] / 255);
  tintMesh.material.opacity = look.tintAlpha;
  // The dungeon backdrop is dimmed to sit behind baked art; environment plates should be full colour.
  bgMesh.material.color.set(look.layout === 'cutout' ? 0xffffff : 0x888888);
  setupExtras(look.extras || []);
});

// --- Session dots (glowing orbs) ---
const MAX_DOTS = 10;
const DOT_SIZE = 12;
const DOT_GAP  = 6;
const DOT_Y    = 88;

const DOT_VERT = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const DOT_FRAG = `
  uniform vec3  dotColor;
  uniform float pulse;   // 0..1 animated for active, 0 for idle
  uniform float visible; // 0 or 1
  varying vec2 vUv;
  void main() {
    if (visible < 0.5) discard;
    vec2  c    = vUv - 0.5;
    float dist = length(c);
    // Soft core
    float core = 1.0 - smoothstep(0.20, 0.32, dist);
    // Outer glow ring — only for active
    float glow = (1.0 - smoothstep(0.32, 0.50, dist)) * pulse * 0.6;
    float alpha = core + glow;
    if (alpha < 0.01) discard;
    vec3 col = dotColor + dotColor * pulse * 0.5;
    gl_FragColor = vec4(col, alpha);
  }
`;

const dotMeshes = [];
const dotStates = [];  // { active: bool }

for (let i = 0; i < MAX_DOTS; i++) {
  const mat = new THREE.ShaderMaterial({
    vertexShader:   DOT_VERT,
    fragmentShader: DOT_FRAG,
    uniforms: {
      dotColor: { value: new THREE.Color(0x666666) },
      pulse:    { value: 0.0 },
      visible:  { value: 0.0 },
    },
    transparent: true,
    depthTest: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(DOT_SIZE, DOT_SIZE), mat);
  mesh.position.z = 0.6;
  scene.add(mesh);
  dotMeshes.push(mesh);
  dotStates.push({ active: false });
}

function updateDots(sessions) {
  const count = Math.min(sessions.length, MAX_DOTS);
  const totalWidth = count * DOT_SIZE + Math.max(0, count - 1) * DOT_GAP;
  const startX = -totalWidth / 2 + DOT_SIZE / 2;

  for (let i = 0; i < MAX_DOTS; i++) {
    const mesh = dotMeshes[i];
    const u    = mesh.material.uniforms;
    if (i < count) {
      const { hot, warm } = sessions[i];
      dotStates[i].active = hot;
      mesh.position.x = startX + i * (DOT_SIZE + DOT_GAP);
      mesh.position.y = DOT_Y;
      // hot = bright green pulsing, warm = dim green static, else grey
      u.dotColor.value.set(hot ? 0x44ff44 : warm ? 0x1a4d1a : 0x333333);
      u.visible.value = 1.0;
    } else {
      dotStates[i].active = false;
      u.visible.value = 0.0;
    }
  }
}

function triggerFlash(r, g, b, intensity = 0.6, decay = 3.0) {
  if (!flashMesh) return;
  flashColor.setRGB(r, g, b);
  flashMesh.material.uniforms.flashColor.value = flashColor;
  flashIntensity = intensity;
  flashDecay = decay;
}

// --- Particle burst ---
const PARTICLE_COUNT = 30;
const particlePositions = new Float32Array(PARTICLE_COUNT * 3);
const particleColors = new Float32Array(PARTICLE_COUNT * 3);
const particleVelocities = new Array(PARTICLE_COUNT);

const particleGeo = new THREE.BufferGeometry();
particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
particleGeo.setAttribute('color', new THREE.BufferAttribute(particleColors, 3));

const particleMat = new THREE.PointsMaterial({
  size: 6,
  vertexColors: true,
  transparent: true,
  opacity: 1.0,
  depthTest: false,
  sizeAttenuation: false,
});

const particles = new THREE.Points(particleGeo, particleMat);
particles.visible = false;
particles.position.z = 0.8;
scene.add(particles);

let particleLifetime = 0;
const PARTICLE_DURATION = 1.2;

function burstParticles() {
  particleLifetime = PARTICLE_DURATION;
  particles.visible = true;
  particleMat.opacity = 1.0;

  const goldColors = [
    [1.0, 0.85, 0.0],
    [1.0, 1.0,  0.4],
    [0.9, 0.6,  0.1],
  ];

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    particlePositions[i * 3]     = (Math.random() - 0.5) * 40;
    particlePositions[i * 3 + 1] = -40 + (Math.random() - 0.5) * 20;
    particlePositions[i * 3 + 2] = 0;

    const angle = (Math.random() * Math.PI) - Math.PI / 2;
    const speed = 40 + Math.random() * 80;
    particleVelocities[i] = {
      x: Math.cos(angle) * speed,
      vy: Math.abs(Math.sin(angle)) * speed + 20,
      gravity: -60 - Math.random() * 40,
    };

    const c = goldColors[Math.floor(Math.random() * goldColors.length)];
    particleColors[i * 3]     = c[0];
    particleColors[i * 3 + 1] = c[1];
    particleColors[i * 3 + 2] = c[2];
  }

  particleGeo.attributes.position.needsUpdate = true;
  particleGeo.attributes.color.needsUpdate = true;
}

// --- Screen shake ---
let shakeIntensity = 0;
const SHAKE_DECAY = 8.0;

function triggerShake(intensity = 12) {
  shakeIntensity = intensity;
}

// --- ANIM_FLASH map ---
const ANIM_FLASH = {
  waking:    () => triggerFlash(0.4, 0.8, 1.0, 0.3, 2.0),
  alarmed:   () => triggerFlash(1.0, 0.1, 0.1, 0.5, 2.5),
  celebrate: () => triggerFlash(1.0, 0.8, 0.0, 0.5, 2.0),
  annoyed:   () => triggerFlash(0.8, 0.4, 0.0, 0.3, 2.0),
};

// --- Animation state machine ---
let currentAnim = 'idle';
let currentFrame = 0;
let frameTimer = 0;
let pendingIdle = false;
let remainingLoops = 0;  // extra replays for non-sleeping anims
const REACTION_LOOPS = 3;  // play reaction animations 3x before sleeping
let idleTimer = null;
const IDLE_TIMEOUT_MS = 30000;

function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!isSubAgent && !anySessionActive) playAnim('sleeping');
  }, IDLE_TIMEOUT_MS);
}

// --- Extra animations (e.g. the beardie's head bob) live on a second sheet: peon-asset://extras.png ---
let extrasTex = null;
let extrasRows = 1;
let extraTriggers = {};   // event name (or 'flourish') → ['x:<name>', …]
let flourishTimer = null;

function setFrame(animName, frame) {
  const { row, extra } = ANIM_CONFIG[animName];
  const rows = extra ? extrasRows : ATLAS_ROWS;
  // UV coords: u left→right, v bottom=0/top=1 (Three.js convention)
  const u0 = frame / ATLAS_COLS;
  const u1 = (frame + 1) / ATLAS_COLS;
  const v0 = (rows - 1 - row) / rows;  // bottom of this row
  const v1 = (rows - row) / rows;       // top of this row
  // PlaneGeometry vertex UV order: [0]=TL, [1]=TR, [2]=BL, [3]=BR
  const uv = geometry.attributes.uv;
  uv.setXY(0, u0, v1); // TL
  uv.setXY(1, u1, v1); // TR
  uv.setXY(2, u0, v0); // BL
  uv.setXY(3, u1, v0); // BR
  uv.needsUpdate = true;
}

function playAnim(animName) {
  pendingIdle = false;
  if (!ANIM_CONFIG[animName]) return;
  currentAnim = animName;
  const cfg = ANIM_CONFIG[animName];
  material.map = cfg.extra ? extrasTex : atlas;
  if (!cfg.extra) window.peonBridge.reportAnim(animName);   // extras are desktop-only: the Pixoo keeps its state
  if (cfg.extra) console.info('[extra] play', animName);
  currentFrame = 0;
  frameTimer = 0;
  const loops = ANIM_CONFIG[animName].loops ?? REACTION_LOOPS;
  remainingLoops = (animName !== 'sleeping') ? loops - 1 : 0;
  setFrame(animName, 0);
  if (ANIM_FLASH[animName]) {
    ANIM_FLASH[animName]();
  }
  if (animName !== 'sleeping') {
    resetIdleTimer();
  }
}

playAnim('sleeping');

// --- Tooltip ---
const tooltip = document.getElementById('tooltip');
let currentSessions = [];

function hitTestDots(px, py) {
  const count = Math.min(currentSessions.length, MAX_DOTS);
  if (count === 0) return -1;
  const totalWidth = count * DOT_SIZE + Math.max(0, count - 1) * DOT_GAP;
  const startThreeX = -totalWidth / 2 + DOT_SIZE / 2;
  const dotCanvasY = 100 - DOT_Y;  // Three.js DOT_Y=88 → canvas pixel y=12
  const HIT_R = DOT_SIZE;           // slightly wider than visual for easier hover
  for (let i = 0; i < count; i++) {
    const dotCanvasX = startThreeX + i * (DOT_SIZE + DOT_GAP) + 100;
    const dx = px - dotCanvasX;
    const dy = py - dotCanvasY;
    if (dx * dx + dy * dy < HIT_R * HIT_R) return i;
  }
  return -1;
}

// --- Drag handling ---
let dragging = false;
let downX = 0;
let downY = 0;
const CLICK_SLOP_PX = 4;  // pointer travel below this counts as a click, not a drag

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;  // left-click only
  dragging = true;
  downX = e.screenX;
  downY = e.screenY;
  tooltip.style.display = 'none';
  canvas.setPointerCapture(e.pointerId);
  window.peonBridge.startDrag();
});

canvas.addEventListener('pointerup', (e) => {
  if (e.button !== 0 || !dragging) return;
  dragging = false;
  window.peonBridge.stopDrag();
  // A click without movement opens the control panel
  if (Math.hypot(e.screenX - downX, e.screenY - downY) < CLICK_SLOP_PX) {
    window.peonBridge.openDashboard();
  }
});

canvas.addEventListener('lostpointercapture', () => {
  if (!dragging) return;
  dragging = false;
  window.peonBridge.stopDrag();
});

canvas.addEventListener('pointercancel', () => {
  if (!dragging) return;
  dragging = false;
  window.peonBridge.stopDrag();
});

function handleMouseMove(e) {
  if (dragging) return;  // suppress tooltip during drag
  const px = e.offsetX;
  const py = e.offsetY;
  const idx = hitTestDots(px, py);
  let html;
  if (idx >= 0) {
    const s = currentSessions[idx];
    const status = s.hot ? '<span style="color:#44ff44">active</span>'
                         : s.warm ? '<span style="color:#1aaa1a">idle</span>'
                         : '<span style="color:#555">cold</span>';
    const label = s.cwd ? s.cwd.split('/').filter(Boolean).pop() : ('\u2026' + s.id.slice(-8));
    const agentTag = s.agent === 'codex' ? ' (codex)' : '';
    const petTag = s.pet ? `${s.pet.name} \u00b7 ` : '';
    html = `${petTag}${label}${agentTag} &bull; ${status}`;
  } else {
    const active = currentSessions.filter(s => s.hot).length;
    const total  = currentSessions.length;
    if (total === 0) {
      html = petLook ? `${petLook.name} (${petLook.speciesDisplay})` : 'Peon Pet';
    } else {
      const names = currentSessions
        .map(s => s.cwd ? (s.pet ? s.pet.name + ' \u00b7 ' : '') + s.cwd.split('/').filter(Boolean).pop() + (s.agent === 'codex' ? ' (codex)' : '') : null)
        .filter(Boolean);
      html = names.length ? names.join('<br>') : `${active}/${total} sessions`;
    }
  }
  tooltip.innerHTML = html;
  tooltip.style.display = 'block';
  // Position tooltip: prefer to the right/below cursor, clamped inside window
  const tw = tooltip.offsetWidth;
  const th = tooltip.offsetHeight;
  tooltip.style.left = Math.min(px + 6, 200 - tw - 2) + 'px';
  tooltip.style.top  = Math.min(py + 6, 200 - th - 2) + 'px';
}

function handleMouseLeave() {
  if (!dragging) tooltip.style.display = 'none';
}

canvas.addEventListener('mousemove', handleMouseMove);
canvas.addEventListener('mouseleave', handleMouseLeave);

// Right-click the pet to open the dashboard
canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  window.peonBridge.openDashboard();
});

// --- Master sound toggle ---
const soundBtn = document.getElementById('sound-btn');
soundBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
soundBtn.addEventListener('click', () => window.peonBridge.toggleSound());
window.peonBridge.onSoundState(({ muted }) => {
  soundBtn.classList.toggle('muted', muted);
  const label = muted ? 'Sounds muted — click to unmute' : 'Mute sounds';
  soundBtn.title = label;
  soundBtn.setAttribute('aria-label', label);
});

// --- Sub-agent config ---
let isSubAgent = false;

window.peonBridge.onConfig(({ size, subAgent }) => {
  if (subAgent) isSubAgent = true;
  // Resize HTML body to match window
  document.documentElement.style.width = `${size}px`;
  document.documentElement.style.height = `${size}px`;
  document.body.style.width = `${size}px`;
  document.body.style.height = `${size}px`;

  // Resize renderer
  renderer.setSize(size, size);

  // Update camera bounds
  const half = size / 2;
  camera.left = -half;
  camera.right = half;
  camera.top = half;
  camera.bottom = -half;
  camera.updateProjectionMatrix();

  // Resize meshes to fit smaller window
  const inner = size * 0.9;
  bgMesh.geometry.dispose();
  bgMesh.geometry = new THREE.PlaneGeometry(inner, inner);
  geometry.dispose();
  geometry = new THREE.PlaneGeometry(inner, inner);
  sprite.geometry = geometry;
  borderMesh.geometry.dispose();
  borderMesh.geometry = new THREE.PlaneGeometry(size, size);
  tintMesh.geometry.dispose();
  tintMesh.geometry = new THREE.PlaneGeometry(size, size);

  // Re-apply current frame UVs to the new geometry
  setFrame(currentAnim, currentFrame);

  // Remove dots from scene and release WebGL resources
  for (const mesh of dotMeshes) {
    scene.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
  }

  // Sub-agents have no controls
  soundBtn.style.display = 'none';

  // Disable tooltip
  tooltip.style.display = 'none';
  canvas.removeEventListener('mousemove', handleMouseMove);
  canvas.removeEventListener('mouseleave', handleMouseLeave);
});

// --- IPC events ---
let anySessionActive = false;

// Play an extra bound to this trigger, but only while the pet is busy typing (never over a reaction).
function maybePlayExtra(trigger) {
  const names = extraTriggers[trigger];
  if (!names || !names.length || isSubAgent || !extrasTex || currentAnim !== 'typing') return false;
  playAnim(names[Math.floor(Math.random() * names.length)]);
  return true;
}

function scheduleFlourish() {
  clearTimeout(flourishTimer);
  if (!(extraTriggers.flourish || []).length || isSubAgent) return;
  flourishTimer = setTimeout(() => { maybePlayExtra('flourish'); scheduleFlourish(); }, 40000 + Math.random() * 50000);
}

function setupExtras(list) {
  for (const k of Object.keys(ANIM_CONFIG)) if (k.startsWith('x:')) delete ANIM_CONFIG[k];
  extraTriggers = {};
  extrasTex = null;
  clearTimeout(flourishTimer);
  if (!list.length || isSubAgent) return;
  loader.load(`peon-asset://extras.png?v=${Date.now()}`, (tex) => {
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    extrasRows = Math.max(1, Math.round(tex.image.height / (tex.image.width / ATLAS_COLS)));
    extrasTex = tex;
    for (const e of list) {
      if (e.row >= extrasRows) continue;   // listed in settings but the sheet has no such row
      ANIM_CONFIG[`x:${e.name}`] = { row: e.row, frames: 6, fps: e.fps, loop: false, loops: e.loops, extra: true };
      for (const t of e.triggers) (extraTriggers[t] = extraTriggers[t] || []).push(`x:${e.name}`);
    }
    scheduleFlourish();
  }, undefined, () => { /* no extras sheet: carry on without */ });
}

window.peonBridge.onEvent(({ anim, event }) => {
  if (maybePlayExtra(event)) return;
  if (!anim) return;   // events with no standard animation (e.g. SubagentStart) only matter to extras
  // Sub-agents only respond to the initial waking event
  if (isSubAgent && anim !== 'waking') return;
  // Don't wake if already active — only wake from sleep
  if (anim === 'waking' && currentAnim !== 'sleeping') return;
  playAnim(anim);
});

window.peonBridge.onSessionUpdate(({ sessions }) => {
  currentSessions = sessions;
  updateDots(sessions);
  const wasActive = anySessionActive;
  anySessionActive = sessions.some(s => s.hot);
  // If a session just became hot and orc is sleeping, wake him to typing
  if (anySessionActive && !wasActive && currentAnim === 'sleeping') {
    playAnim('typing');
  }
});

// --- Render loop ---
let lastTime = 0;
function animate(time) {
  requestAnimationFrame(animate);
  const delta = Math.min((time - lastTime) / 1000, 0.1);
  lastTime = time;

  // Animate dot pulse
  for (let i = 0; i < MAX_DOTS; i++) {
    if (dotStates[i].active) {
      dotMeshes[i].material.uniforms.pulse.value = (Math.sin(time * 0.003 + i) + 1) / 2;
    } else {
      dotMeshes[i].material.uniforms.pulse.value = 0.0;
    }
  }

  // Decay flash
  if (flashMesh && flashIntensity > 0) {
    flashIntensity = Math.max(0, flashIntensity - delta * flashDecay);
    flashMesh.material.uniforms.flashIntensity.value = flashIntensity;
  }

  // Update particles
  if (particleLifetime > 0) {
    particleLifetime -= delta;
    particleMat.opacity = Math.max(0, particleLifetime / PARTICLE_DURATION);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const v = particleVelocities[i];
      if (!v) continue;
      particlePositions[i * 3]     += v.x * delta;
      particlePositions[i * 3 + 1] += v.vy * delta;
      v.vy += v.gravity * delta;
    }
    particleGeo.attributes.position.needsUpdate = true;

    if (particleLifetime <= 0) {
      particles.visible = false;
    }
  }

  // Advance animation frame
  const cfg = ANIM_CONFIG[currentAnim];
  frameTimer += delta;
  if (frameTimer >= 1 / cfg.fps) {
    frameTimer = 0;
    currentFrame++;
    if (currentFrame >= cfg.frames) {
      if (cfg.loop) {
        currentFrame = 0;
      } else {
        if (remainingLoops > 0) {
          remainingLoops--;
          currentFrame = 0;
        } else {
          currentFrame = cfg.frames - 1;
          if (!pendingIdle) {
            pendingIdle = true;
            setTimeout(() => {
              pendingIdle = false;
              // Sub-agents always stay typing while alive
              if (isSubAgent || anySessionActive) {
                playAnim('typing');
              } else {
                playAnim('sleeping');
              }
            }, 300);
          }
        }
      }
    }
    setFrame(currentAnim, currentFrame);
  }

  // Screen shake
  if (shakeIntensity > 0) {
    shakeIntensity = Math.max(0, shakeIntensity - SHAKE_DECAY * delta);
    sprite.position.x = (Math.random() - 0.5) * shakeIntensity;
    sprite.position.y = (Math.random() - 0.5) * shakeIntensity;
  } else {
    sprite.position.x = 0;
    sprite.position.y = 0;
  }

  renderer.render(scene, camera);
}
requestAnimationFrame(animate);
