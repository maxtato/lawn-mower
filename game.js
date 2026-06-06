"use strict";

// ============================================================
//  Mow & Go — tondeuse en vue de dessus
//  Fond : image d'un vrai jardin (assets/garden.png).
//  La tonte révèle une pelouse vert clair derrière la tondeuse.
// ============================================================

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

// Résolution interne (mise à jour à la taille native de l'image)
let W = 1456, H = 1088;
canvas.width = W;
canvas.height = H;

// --- Image de fond ---
const bg = new Image();
let bgReady = false;

// --- Calques hors-écran ---
const maskCanvas = document.createElement("canvas");   // pelouse vert clair (zones tondables)
const maskCtx = maskCanvas.getContext("2d");
const revealCanvas = document.createElement("canvas"); // traînée révélée (disques)
const revealCtx = revealCanvas.getContext("2d");
const mowCanvas = document.createElement("canvas");     // composite mask ∩ reveal (par frame)
const mowCtx = mowCanvas.getContext("2d");

// --- Tonte / couverture ---
const CELL = 10;          // finesse de la grille de couverture
let CW = 0, CH = 0;
let cov;                  // 0 = à tondre, 1 = tondu, 2 = non tondable
let mowableTotal = 0, mowedCount = 0;
let DECK = 32;            // demi-largeur de coupe (px), recalculée selon la résolution

// --- Géométrie du jardin (obstacles & zones), en pixels ---
let bounds = { x0: 0, y0: 0, x1: W, y1: H }; // intérieur de la clôture
let solids = [];   // bloquent le déplacement (+ dégâts si choc rapide)
let paved = [];    // carrossables, non tondables (allée, terrasse)
let flowers = [];  // massifs : non tondables + malus si on roule dessus

// --- État global ---
let mower, keys, state;
let score = 0, flowersDestroyed = 0, flowerCd = 0;
let startTime = 0, elapsed = 0, damageCooldown = 0;
let prevX = 0, prevY = 0;

// HUD
const el = {
  mowed: document.getElementById("mowed"),
  score: document.getElementById("score"),
  flowers: document.getElementById("flowers"),
  health: document.getElementById("health-fill"),
  time: document.getElementById("time"),
  overlay: document.getElementById("overlay"),
  overlayTitle: document.getElementById("overlay-title"),
  overlayText: document.getElementById("overlay-text"),
  overlayBtn: document.getElementById("overlay-btn")
};

// ------------------------------------------------------------
//  Géométrie : repérage des obstacles (en fractions de l'image,
//  donc indépendant de la résolution).
// ------------------------------------------------------------
function buildGeometry() {
  const R = (x0, y0, x1, y1) => ({ k: "r", x: x0 * W, y: y0 * H, w: (x1 - x0) * W, h: (y1 - y0) * H });
  const C = (cx, cy, r) => ({ k: "c", cx: cx * W, cy: cy * H, r: r * W });

  bounds = { x0: 0.030 * W, y0: 0.035 * H, x1: 0.970 * W, y1: 0.965 * H };

  // Obstacles solides
  solids = [
    R(0.555, 0.020, 0.975, 0.400), // maison (murs + toit)
    R(0.815, 0.375, 0.975, 0.470), // garage
    C(0.115, 0.135, 0.085),        // grand arbre haut-gauche
    C(0.115, 0.585, 0.095),        // grand arbre milieu-gauche
    C(0.090, 0.840, 0.050),        // arbre bas-gauche
    C(0.735, 0.630, 0.045),        // arbuste pelouse droite
    R(0.150, 0.720, 0.275, 0.900), // bac en bois (composteur)
    C(0.335, 0.440, 0.040),        // rochers centre 1
    C(0.430, 0.585, 0.040),        // rochers centre 2
    C(0.490, 0.225, 0.045)         // table de la terrasse
  ];

  // Zones pavées (carrossables, rien à tondre)
  paved = [
    R(0.400, 0.145, 0.560, 0.335), // terrasse
    R(0.800, 0.455, 0.955, 0.965), // allée
    R(0.620, 0.440, 0.790, 0.500)  // pas japonais devant la porte
  ];

  // Massifs de fleurs (à éviter)
  flowers = [
    R(0.270, 0.025, 0.560, 0.155), // massif le long de la clôture haute
    R(0.030, 0.300, 0.170, 0.700), // plate-bande gauche
    R(0.150, 0.660, 0.320, 0.930), // massif autour du bac (bas-gauche)
    R(0.555, 0.335, 0.800, 0.470), // massif devant la maison
    R(0.575, 0.650, 0.730, 0.920), // massif bas-centre
    R(0.380, 0.295, 0.470, 0.380)  // buissons à gauche de la terrasse
  ];

  DECK = Math.round(0.022 * W);
}

// --- Tests géométriques ---
function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function circleRect(cx, cy, r, s) {
  const nx = clamp(cx, s.x, s.x + s.w), ny = clamp(cy, s.y, s.y + s.h);
  const dx = cx - nx, dy = cy - ny;
  return dx * dx + dy * dy <= r * r;
}
function circleCircle(cx, cy, r, s) {
  const dx = cx - s.cx, dy = cy - s.cy, rr = r + s.r;
  return dx * dx + dy * dy <= rr * rr;
}
function pointIn(x, y, s) {
  return s.k === "r"
    ? (x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h)
    : ((x - s.cx) ** 2 + (y - s.cy) ** 2 <= s.r * s.r);
}
function inAny(x, y, list) { for (const s of list) if (pointIn(x, y, s)) return true; return false; }

function hitsSolid(cx, cy, r) {
  if (cx - r < bounds.x0 || cx + r > bounds.x1 || cy - r < bounds.y0 || cy + r > bounds.y1) return true;
  for (const s of solids) {
    if (s.k === "r" ? circleRect(cx, cy, r, s) : circleCircle(cx, cy, r, s)) return true;
  }
  return false;
}
function isMowable(x, y) {
  if (x < bounds.x0 || x > bounds.x1 || y < bounds.y0 || y > bounds.y1) return false;
  if (inAny(x, y, solids) || inAny(x, y, paved) || inAny(x, y, flowers)) return false;
  return true;
}
function inFlower(x, y) { return inAny(x, y, flowers); }

// ------------------------------------------------------------
//  Couverture (grille fine de la pelouse à tondre)
// ------------------------------------------------------------
function buildCoverage() {
  CW = Math.ceil(W / CELL);
  CH = Math.ceil(H / CELL);
  cov = new Uint8Array(CW * CH);
  mowableTotal = 0;
  for (let r = 0; r < CH; r++) {
    for (let c = 0; c < CW; c++) {
      const x = (c + 0.5) * CELL, y = (r + 0.5) * CELL;
      if (isMowable(x, y)) { cov[r * CW + c] = 0; mowableTotal++; }
      else cov[r * CW + c] = 2;
    }
  }
}

// ------------------------------------------------------------
//  Masque de pelouse tondue (vert clair) : uniquement sur l'herbe
// ------------------------------------------------------------
function buildMask() {
  maskCanvas.width = W; maskCanvas.height = H;
  revealCanvas.width = W; revealCanvas.height = H;
  mowCanvas.width = W; mowCanvas.height = H;

  maskCtx.clearRect(0, 0, W, H);
  maskCtx.fillStyle = "#aee36a"; // vert clair « fraîchement tondu »
  maskCtx.fillRect(bounds.x0, bounds.y0, bounds.x1 - bounds.x0, bounds.y1 - bounds.y0);

  // On retire les zones non tondables du masque
  maskCtx.globalCompositeOperation = "destination-out";
  for (const s of [...solids, ...paved, ...flowers]) fillShape(maskCtx, s);
  maskCtx.globalCompositeOperation = "source-over";
}

function fillShape(c, s) {
  c.beginPath();
  if (s.k === "r") c.rect(s.x, s.y, s.w, s.h);
  else c.arc(s.cx, s.cy, s.r, 0, Math.PI * 2);
  c.fill();
}

// ------------------------------------------------------------
//  (Re)construction complète à une résolution donnée
// ------------------------------------------------------------
function buildAll() {
  canvas.width = W;
  canvas.height = H;
  buildGeometry();
  buildCoverage();
  buildMask();
}

function makeMower() {
  return {
    x: 0.32 * W, y: 0.30 * H,
    angle: 0, speed: 0,
    maxSpeed: 0.22 * W,
    accel: 0.85 * W,
    friction: 0.75 * W,
    radius: 0.016 * W,
    health: 100
  };
}

// ------------------------------------------------------------
//  Réinitialisation d'une partie
// ------------------------------------------------------------
function reset() {
  mower = makeMower();
  keys = {};
  score = 0;
  mowedCount = 0;
  flowersDestroyed = 0;
  flowerCd = 0;
  damageCooldown = 0;
  elapsed = 0;
  startTime = performance.now();
  state = "playing";

  revealCtx.clearRect(0, 0, W, H);
  prevX = mower.x;
  prevY = mower.y;
  stampAt(mower.x, mower.y);

  hideOverlay();
}

// Peint un coup de tondeuse (disque révélé) + met à jour la couverture.
function stampAt(x, y) {
  revealCtx.fillStyle = "#fff";
  revealCtx.beginPath();
  revealCtx.arc(x, y, DECK, 0, Math.PI * 2);
  revealCtx.fill();

  const minc = Math.max(0, Math.floor((x - DECK) / CELL));
  const maxc = Math.min(CW - 1, Math.floor((x + DECK) / CELL));
  const minr = Math.max(0, Math.floor((y - DECK) / CELL));
  const maxr = Math.min(CH - 1, Math.floor((y + DECK) / CELL));
  const R2 = DECK * DECK;
  for (let r = minr; r <= maxr; r++) {
    for (let c = minc; c <= maxc; c++) {
      const idx = r * CW + c;
      if (cov[idx] !== 0) continue;
      const dx = (c + 0.5) * CELL - x;
      const dy = (r + 0.5) * CELL - y;
      if (dx * dx + dy * dy <= R2) { cov[idx] = 1; mowedCount++; score += 1; }
    }
  }
}

function stampTrail(x0, y0, x1, y1) {
  const d = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(1, Math.ceil(d / (DECK * 0.5)));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    stampAt(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
  }
}

// ------------------------------------------------------------
//  Entrées clavier
// ------------------------------------------------------------
document.addEventListener("keydown", (e) => {
  keys[e.key.toLowerCase()] = true;
  if (e.key.toLowerCase() === "r") reset();
  if (["arrowup", "arrowdown", "arrowleft", "arrowright"].includes(e.key.toLowerCase()))
    e.preventDefault();
});
document.addEventListener("keyup", (e) => { keys[e.key.toLowerCase()] = false; });

el.overlayBtn.addEventListener("click", reset);

// ------------------------------------------------------------
//  Joystick virtuel DYNAMIQUE (apparaît sous le doigt) + Turbo
// ------------------------------------------------------------
const stageEl = document.getElementById("stage");
const joyEl = document.getElementById("joystick");
const knobEl = document.getElementById("joy-knob");
const boostBtn = document.getElementById("boost-btn");
const fsBtn = document.getElementById("fs-btn");
const hudEl = document.getElementById("hud");
const ctrlEl = document.getElementById("controls");

const joy = { active: false, id: null, baseX: 0, baseY: 0, dx: 0, dy: 0, mag: 0, maxR: 55 };
let boostHeld = false;

const isTouch = ("ontouchstart" in window) || navigator.maxTouchPoints > 0;
if (isTouch) document.body.classList.add("touch");

function joyStart(clientX, clientY, id) {
  joy.baseX = clientX; joy.baseY = clientY; joy.id = id; joy.active = true;
  const r = stageEl.getBoundingClientRect();
  joyEl.style.left = (clientX - r.left) + "px";
  joyEl.style.top = (clientY - r.top) + "px";
  joyEl.classList.add("visible");
  joyMove(clientX, clientY);
}
function joyMove(clientX, clientY) {
  if (!joy.active) return;
  let dx = clientX - joy.baseX, dy = clientY - joy.baseY;
  const dist = Math.hypot(dx, dy);
  if (dist > joy.maxR) { dx = (dx / dist) * joy.maxR; dy = (dy / dist) * joy.maxR; }
  joy.dx = dx; joy.dy = dy; joy.mag = Math.min(1, dist / joy.maxR);
  knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
}
function joyEnd() {
  joy.active = false; joy.id = null; joy.dx = joy.dy = joy.mag = 0;
  knobEl.style.transform = "translate(0px, 0px)";
  joyEl.classList.remove("visible");
}

stageEl.addEventListener("touchstart", (e) => {
  if (joy.active) return;
  const t = e.changedTouches[0];
  e.preventDefault();
  joyStart(t.clientX, t.clientY, t.identifier);
}, { passive: false });
window.addEventListener("touchmove", (e) => {
  if (!joy.active) return;
  for (const t of e.changedTouches) {
    if (t.identifier === joy.id) { e.preventDefault(); joyMove(t.clientX, t.clientY); break; }
  }
}, { passive: false });
window.addEventListener("touchend", (e) => {
  for (const t of e.changedTouches) if (t.identifier === joy.id) { joyEnd(); break; }
});
window.addEventListener("touchcancel", joyEnd);

stageEl.addEventListener("mousedown", (e) => {
  if (e.target === boostBtn) return;
  e.preventDefault();
  joyStart(e.clientX, e.clientY, "mouse");
});
window.addEventListener("mousemove", (e) => { if (joy.active && joy.id === "mouse") joyMove(e.clientX, e.clientY); });
window.addEventListener("mouseup", () => { if (joy.id === "mouse") joyEnd(); });

function boostOn(e) { e.preventDefault(); e.stopPropagation(); boostHeld = true; boostBtn.classList.add("active"); }
function boostOff(e) { if (e) e.stopPropagation(); boostHeld = false; boostBtn.classList.remove("active"); }
boostBtn.addEventListener("touchstart", boostOn, { passive: false });
boostBtn.addEventListener("touchend", boostOff);
boostBtn.addEventListener("touchcancel", boostOff);
boostBtn.addEventListener("mousedown", boostOn);
window.addEventListener("mouseup", boostOff);

// --- Plein écran + mise à l'échelle du canvas ---
function fitCanvas() {
  const fs = document.fullscreenElement === wrapper;
  if (!document.body.classList.contains("touch") && !fs) {
    canvas.style.width = ""; canvas.style.height = ""; return;
  }
  const availW = window.innerWidth;
  const availH = window.innerHeight - hudEl.offsetHeight - ctrlEl.offsetHeight;
  const scale = Math.min(availW / canvas.width, availH / canvas.height);
  canvas.style.width = Math.floor(canvas.width * scale) + "px";
  canvas.style.height = Math.floor(canvas.height * scale) + "px";
}

const wrapper = document.getElementById("game-wrapper");
if (!(wrapper.requestFullscreen)) fsBtn.style.display = "none";
fsBtn.addEventListener("click", () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else if (wrapper.requestFullscreen) wrapper.requestFullscreen().catch(() => {});
});
document.addEventListener("fullscreenchange", () => setTimeout(fitCanvas, 60));
window.addEventListener("resize", fitCanvas);
window.addEventListener("orientationchange", () => setTimeout(fitCanvas, 200));

// ------------------------------------------------------------
//  Direction d'entrée
// ------------------------------------------------------------
function dirFromKeys() {
  let dx = 0, dy = 0;
  if (keys["arrowup"] || keys["z"] || keys["w"]) dy -= 1;
  if (keys["arrowdown"] || keys["s"]) dy += 1;
  if (keys["arrowleft"] || keys["q"] || keys["a"]) dx -= 1;
  if (keys["arrowright"] || keys["d"]) dx += 1;
  return { dx, dy };
}
function getInputVector() {
  if (joy.active && joy.mag > 0.08) {
    const len = Math.hypot(joy.dx, joy.dy) || 1;
    return { dx: joy.dx / len, dy: joy.dy / len, mag: joy.mag, active: true };
  }
  const { dx, dy } = dirFromKeys();
  if (dx !== 0 || dy !== 0) {
    const len = Math.hypot(dx, dy);
    return { dx: dx / len, dy: dy / len, mag: 1, active: true };
  }
  return { dx: 0, dy: 0, mag: 0, active: false };
}

function collides(px, py, radius) { return hitsSolid(px, py, radius); }

// ------------------------------------------------------------
//  Mise à jour
// ------------------------------------------------------------
function update(dt) {
  if (state !== "playing") return;
  elapsed = (performance.now() - startTime) / 1000;

  const inp = getInputVector();
  const boosting = boostHeld || !!keys["shift"];
  const effMax = mower.maxSpeed * (boosting ? 1.7 : 1);

  if (inp.active) {
    mower.angle = Math.atan2(inp.dy, inp.dx);
    const target = effMax * inp.mag;
    if (mower.speed < target) mower.speed = Math.min(target, mower.speed + mower.accel * dt);
    else mower.speed = Math.max(target, mower.speed - mower.friction * dt);
  } else {
    mower.speed = Math.max(0, mower.speed - mower.friction * dt);
  }

  const vx = Math.cos(mower.angle) * mower.speed;
  const vy = Math.sin(mower.angle) * mower.speed;
  let hitWall = false;

  if (!collides(mower.x + vx * dt, mower.y, mower.radius)) mower.x += vx * dt; else hitWall = true;
  if (!collides(mower.x, mower.y + vy * dt, mower.radius)) mower.y += vy * dt; else hitWall = true;

  // Dégâts (tondeuse robuste : peu de dégâts, seuls les chocs rapides comptent)
  if (damageCooldown > 0) damageCooldown -= dt;
  if (hitWall && mower.speed > 0.11 * W && damageCooldown <= 0) {
    const dmg = Math.round(3 + (mower.speed / mower.maxSpeed) * 6);
    mower.health = Math.max(0, mower.health - dmg);
    score = Math.max(0, score - 5);
    damageCooldown = 0.6;
    mower.speed *= 0.2;
    if (mower.health <= 0) endGame(false);
  }

  // Tonte : traînée entre l'ancienne et la nouvelle position
  if (mower.x !== prevX || mower.y !== prevY) {
    stampTrail(prevX, prevY, mower.x, mower.y);
    prevX = mower.x; prevY = mower.y;
  }

  // Massif de fleurs abîmé
  if (flowerCd > 0) flowerCd -= dt;
  if (inFlower(mower.x, mower.y) && flowerCd <= 0) {
    flowersDestroyed++;
    score = Math.max(0, score - 30);
    flowerCd = 0.5;
  }

  if (mowableTotal > 0 && mowedCount >= mowableTotal * 0.97) endGame(true);
}

// ------------------------------------------------------------
//  Rendu
// ------------------------------------------------------------
function draw() {
  // 1) fond : image du jardin (ou repli)
  if (bgReady) ctx.drawImage(bg, 0, 0, W, H);
  else drawFallback();

  // 2) pelouse tondue = masque (herbe) ∩ traînée révélée
  mowCtx.clearRect(0, 0, W, H);
  mowCtx.globalCompositeOperation = "source-over";
  mowCtx.drawImage(maskCanvas, 0, 0);
  mowCtx.globalCompositeOperation = "destination-in";
  mowCtx.drawImage(revealCanvas, 0, 0);
  mowCtx.globalCompositeOperation = "source-over";

  ctx.save();
  ctx.globalAlpha = 0.6; // laisse transparaître la texture du gazon
  ctx.drawImage(mowCanvas, 0, 0);
  ctx.restore();

  // 3) tondeuse
  drawMower();
}

// Repli quand l'image n'est pas (encore) chargée : pelouse + obstacles repérés.
function drawFallback() {
  ctx.fillStyle = "#3f7a2a";
  ctx.fillRect(0, 0, W, H);
  // clôture
  ctx.strokeStyle = "#8a5a32";
  ctx.lineWidth = Math.max(4, 0.01 * W);
  ctx.strokeRect(bounds.x0, bounds.y0, bounds.x1 - bounds.x0, bounds.y1 - bounds.y0);
  // zones
  for (const s of paved) { ctx.fillStyle = "#b9b3a7"; fillShape(ctx, s); }
  for (const s of flowers) { ctx.fillStyle = "rgba(210,90,150,0.45)"; fillShape(ctx, s); }
  for (const s of solids) { ctx.fillStyle = "#6b4a2a"; fillShape(ctx, s); }
}

function drawMower() {
  const S = W / 800; // échelle selon la résolution
  ctx.save();
  ctx.translate(mower.x, mower.y);
  ctx.rotate(mower.angle);
  ctx.scale(S, S);

  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.ellipse(2, 3, 18, 14, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = damageCooldown > 0 ? "#ff7b5e" : "#d83a2f";
  roundRect(-16, -12, 30, 24, 6); ctx.fill();

  ctx.fillStyle = "#b32a22";
  roundRect(4, -10, 12, 20, 4); ctx.fill();

  ctx.strokeStyle = "#dddddd";
  ctx.lineWidth = 2;
  const t = performance.now() / 60;
  ctx.beginPath();
  ctx.moveTo(10 + Math.cos(t) * 6, Math.sin(t) * 6);
  ctx.lineTo(10 - Math.cos(t) * 6, -Math.sin(t) * 6);
  ctx.stroke();

  ctx.fillStyle = "#222";
  roundRect(-14, -7, 8, 14, 3); ctx.fill();

  ctx.restore();
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ------------------------------------------------------------
//  HUD
// ------------------------------------------------------------
function coveragePct() {
  return mowableTotal ? Math.min(100, Math.round((mowedCount / mowableTotal) * 100)) : 0;
}
function updateHUD() {
  el.mowed.textContent = coveragePct() + "%";
  el.score.textContent = score;
  el.flowers.textContent = flowersDestroyed + " 🌸";
  el.health.style.width = mower.health + "%";
  el.health.style.background =
    mower.health > 50 ? "linear-gradient(90deg,#4f9b2f,#7ec850)" :
    mower.health > 25 ? "linear-gradient(90deg,#d98e1f,#f5c542)" :
    "linear-gradient(90deg,#a01f1f,#e0533d)";
  el.time.textContent = elapsed.toFixed(1) + "s";
}

// ------------------------------------------------------------
//  Fin de partie
// ------------------------------------------------------------
function endGame(won) {
  state = won ? "won" : "lost";
  let stars = "";
  if (won) {
    let s = 1;
    if (flowersDestroyed === 0) s++;
    if (elapsed < 60) s++;
    stars = "⭐".repeat(s) + "☆".repeat(3 - s);
  }
  showOverlay(
    won ? "Pelouse tondue ! 🌿" : "Tondeuse HS 💥",
    won
      ? `${stars}\nScore : ${score}\nTemps : ${elapsed.toFixed(1)}s\nFleurs abîmées : ${flowersDestroyed}`
      : `Tu as percuté trop d'obstacles.\nTonte : ${coveragePct()}%\nScore : ${score}`,
    won ? "Rejouer" : "Réessayer"
  );
}

function showOverlay(title, text, btn) {
  el.overlayTitle.textContent = title;
  el.overlayText.textContent = text;
  el.overlayBtn.textContent = btn;
  el.overlay.classList.remove("hidden");
}
function hideOverlay() { el.overlay.classList.add("hidden"); }

// ------------------------------------------------------------
//  Boucle principale
// ------------------------------------------------------------
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  update(dt);
  draw();
  updateHUD();
  requestAnimationFrame(loop);
}

// ------------------------------------------------------------
//  Démarrage
// ------------------------------------------------------------
buildAll();
mower = makeMower();
keys = {};
state = "menu";

bg.onload = () => {
  bgReady = true;
  W = bg.naturalWidth; H = bg.naturalHeight;
  buildAll();
  mower = makeMower();
  if (state === "playing") reset();
  fitCanvas();
};
bg.onerror = () => { bgReady = false; };
bg.src = "assets/garden.png";

showOverlay(
  "🚜 Mow & Go",
  "Tonds toute la pelouse du jardin 🏡\nLa tonte révèle une herbe vert clair.\nÉvite les massifs 🌸, la maison, les arbres et l'allée.\n\n" +
  (isTouch ? "Pose ton pouce pour conduire · ⚡ Turbo" : "Déplacement : flèches ou ZQSD · Maj = turbo"),
  "Jouer"
);
fitCanvas();
requestAnimationFrame(loop);
