"use strict";

// ============================================================
//  Mow & Go — prototype de tondeuse en vue de dessus
//  HTML5 Canvas + JavaScript pur, sans dépendance.
// ============================================================

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

// --- Grille ---
const TILE = 40;
const COLS = canvas.width / TILE;  // 20
const ROWS = canvas.height / TILE; // 15

// Types de tuiles
const T = {
  TALL: 0,   // herbe haute (à tondre)
  CUT: 1,    // herbe tondue
  FLOWER: 2, // massif de fleurs (à éviter)
  TREE: 3,   // arbre (obstacle solide)
  ROCK: 4,   // rocher (obstacle solide)
  CRUSHED: 5 // fleur écrasée
};

const SOLID = new Set([T.TREE, T.ROCK]);

// --- État global ---
let grid = [];
let mower, keys, state;
let totalGrass = 0;
let mowedGrass = 0;
let score = 0;
let flowersDestroyed = 0;
let startTime = 0;
let elapsed = 0;
let damageCooldown = 0;

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
//  Génération du niveau
// ------------------------------------------------------------
function buildLevel() {
  grid = [];
  totalGrass = 0;
  for (let r = 0; r < ROWS; r++) {
    const row = [];
    for (let c = 0; c < COLS; c++) {
      row.push(T.TALL);
    }
    grid.push(row);
  }

  // Bordure d'arbres tout autour du jardin
  for (let c = 0; c < COLS; c++) {
    grid[0][c] = T.TREE;
    grid[ROWS - 1][c] = T.TREE;
  }
  for (let r = 0; r < ROWS; r++) {
    grid[r][0] = T.TREE;
    grid[r][COLS - 1] = T.TREE;
  }

  // Quelques rochers
  const rocks = [[4, 6], [9, 13], [11, 4], [3, 15], [7, 9]];
  for (const [r, c] of rocks) grid[r][c] = T.ROCK;

  // Quelques arbres isolés
  const trees = [[5, 11], [10, 7], [2, 9], [12, 16]];
  for (const [r, c] of trees) grid[r][c] = T.TREE;

  // Massifs de fleurs (petits blocs)
  const beds = [[3, 3], [3, 4], [4, 3], [8, 16], [8, 17], [12, 11], [12, 12], [6, 4]];
  for (const [r, c] of beds) grid[r][c] = T.FLOWER;

  // Compte l'herbe haute à tondre
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      if (grid[r][c] === T.TALL) totalGrass++;
}

// ------------------------------------------------------------
//  Réinitialisation
// ------------------------------------------------------------
function reset() {
  buildLevel();
  mower = {
    x: 1.5 * TILE,
    y: 1.5 * TILE,
    angle: 0,        // radians, direction visée
    speed: 0,        // vitesse courante (px/s)
    maxSpeed: 165,
    accel: 600,
    friction: 500,
    radius: 14,
    health: 100
  };
  keys = {};
  mowedGrass = 0;
  score = 0;
  flowersDestroyed = 0;
  damageCooldown = 0;
  elapsed = 0;
  startTime = performance.now();
  state = "playing";
  hideOverlay();
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
//  Joystick virtuel tactile (mobile / iPhone)
// ------------------------------------------------------------
const joyEl = document.getElementById("joystick");
const knobEl = document.getElementById("joy-knob");
const joy = {
  active: false,
  id: null,      // identifiant du toucher suivi
  baseX: 0,
  baseY: 0,
  dx: 0,
  dy: 0,
  mag: 0,        // 0..1 (vitesse analogique)
  maxR: 50       // amplitude max du knob en px
};

// Affiche le joystick si l'appareil est tactile
const isTouch = ("ontouchstart" in window) || navigator.maxTouchPoints > 0;
if (isTouch) {
  document.body.classList.add("touch");
  joyEl.classList.add("visible");
}

function joyStart(clientX, clientY, id) {
  const rect = joyEl.getBoundingClientRect();
  joy.baseX = rect.left + rect.width / 2;
  joy.baseY = rect.top + rect.height / 2;
  joy.id = id;
  joy.active = true;
  joyMove(clientX, clientY);
}

function joyMove(clientX, clientY) {
  if (!joy.active) return;
  let dx = clientX - joy.baseX;
  let dy = clientY - joy.baseY;
  const dist = Math.hypot(dx, dy);
  if (dist > joy.maxR) { dx = (dx / dist) * joy.maxR; dy = (dy / dist) * joy.maxR; }
  joy.dx = dx;
  joy.dy = dy;
  joy.mag = Math.min(1, dist / joy.maxR);
  knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
}

function joyEnd() {
  joy.active = false;
  joy.id = null;
  joy.dx = joy.dy = joy.mag = 0;
  knobEl.style.transform = "translate(0px, 0px)";
}

// Touch events (mobile)
joyEl.addEventListener("touchstart", (e) => {
  e.preventDefault();
  const t = e.changedTouches[0];
  joyStart(t.clientX, t.clientY, t.identifier);
}, { passive: false });

window.addEventListener("touchmove", (e) => {
  if (!joy.active) return;
  for (const t of e.changedTouches) {
    if (t.identifier === joy.id) {
      e.preventDefault();
      joyMove(t.clientX, t.clientY);
      break;
    }
  }
}, { passive: false });

window.addEventListener("touchend", (e) => {
  for (const t of e.changedTouches) {
    if (t.identifier === joy.id) { joyEnd(); break; }
  }
});
window.addEventListener("touchcancel", joyEnd);

// Mouse events (test sur ordinateur)
joyEl.addEventListener("mousedown", (e) => {
  e.preventDefault();
  joyStart(e.clientX, e.clientY, "mouse");
});
window.addEventListener("mousemove", (e) => {
  if (joy.active && joy.id === "mouse") joyMove(e.clientX, e.clientY);
});
window.addEventListener("mouseup", () => { if (joy.id === "mouse") joyEnd(); });

function dirFromKeys() {
  let dx = 0, dy = 0;
  if (keys["arrowup"] || keys["z"] || keys["w"]) dy -= 1;
  if (keys["arrowdown"] || keys["s"]) dy += 1;
  if (keys["arrowleft"] || keys["q"] || keys["a"]) dx -= 1;
  if (keys["arrowright"] || keys["d"]) dx += 1;
  return { dx, dy };
}

// Vecteur d'entrée unifié : joystick (analogique, 360°) prioritaire, sinon clavier.
// Renvoie une direction normalisée + une magnitude 0..1 (vitesse).
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

// ------------------------------------------------------------
//  Collision : la case (px) est-elle solide ?
// ------------------------------------------------------------
function isSolidAt(px, py) {
  const c = Math.floor(px / TILE);
  const r = Math.floor(py / TILE);
  if (r < 0 || c < 0 || r >= ROWS || c >= COLS) return true;
  return SOLID.has(grid[r][c]);
}

// Teste la position du centre de la tondeuse (cercle approximé par 4 points)
function collides(px, py, radius) {
  return (
    isSolidAt(px - radius, py) ||
    isSolidAt(px + radius, py) ||
    isSolidAt(px, py - radius) ||
    isSolidAt(px, py + radius)
  );
}

// ------------------------------------------------------------
//  Mise à jour
// ------------------------------------------------------------
function update(dt) {
  if (state !== "playing") return;

  elapsed = (performance.now() - startTime) / 1000;

  const inp = getInputVector();

  if (inp.active) {
    mower.angle = Math.atan2(inp.dy, inp.dx);
    const target = mower.maxSpeed * inp.mag; // vitesse proportionnelle au joystick
    if (mower.speed < target) {
      mower.speed = Math.min(target, mower.speed + mower.accel * dt);
    } else {
      mower.speed = Math.max(target, mower.speed - mower.friction * dt);
    }
  } else {
    mower.speed = Math.max(0, mower.speed - mower.friction * dt);
  }

  const vx = Math.cos(mower.angle) * mower.speed;
  const vy = Math.sin(mower.angle) * mower.speed;

  let nx = mower.x + vx * dt;
  let ny = mower.y + vy * dt;
  let hitWall = false;

  // Déplacement par axe pour glisser le long des murs
  if (!collides(nx, mower.y, mower.radius)) {
    mower.x = nx;
  } else {
    hitWall = true;
  }
  if (!collides(mower.x, ny, mower.radius)) {
    mower.y = ny;
  } else {
    hitWall = true;
  }

  // Dégâts si on percute un obstacle avec de la vitesse
  if (damageCooldown > 0) damageCooldown -= dt;
  if (hitWall && mower.speed > 60 && damageCooldown <= 0) {
    const dmg = Math.round(6 + (mower.speed / mower.maxSpeed) * 14);
    mower.health = Math.max(0, mower.health - dmg);
    score = Math.max(0, score - 5);
    damageCooldown = 0.4;
    mower.speed *= 0.2; // rebond / arrêt brutal
    if (mower.health <= 0) endGame(false);
  }

  // Interaction avec la tuile sous la tondeuse
  const tc = Math.floor(mower.x / TILE);
  const tr = Math.floor(mower.y / TILE);
  if (tr >= 0 && tc >= 0 && tr < ROWS && tc < COLS) {
    const tile = grid[tr][tc];
    if (tile === T.TALL) {
      grid[tr][tc] = T.CUT;
      mowedGrass++;
      score += 10;
      if (mowedGrass >= totalGrass) endGame(true);
    } else if (tile === T.FLOWER) {
      grid[tr][tc] = T.CRUSHED;
      flowersDestroyed++;
      score = Math.max(0, score - 30);
    }
  }
}

// ------------------------------------------------------------
//  Rendu
// ------------------------------------------------------------
function draw() {
  // Tuiles
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const x = c * TILE, y = r * TILE;
      drawTile(grid[r][c], x, y, r, c);
    }
  }
  drawMower();
}

function drawTile(type, x, y, r, c) {
  // checker subtil pour lisibilité
  const alt = (r + c) % 2 === 0;
  switch (type) {
    case T.TALL:
      ctx.fillStyle = alt ? "#3f7a2a" : "#458a2f";
      ctx.fillRect(x, y, TILE, TILE);
      // brins d'herbe
      ctx.strokeStyle = "rgba(20,60,15,0.5)";
      ctx.lineWidth = 1;
      for (let i = 0; i < 3; i++) {
        const gx = x + 8 + i * 11 + ((r * 7 + c * 13) % 5);
        ctx.beginPath();
        ctx.moveTo(gx, y + TILE - 6);
        ctx.lineTo(gx - 2, y + TILE - 16);
        ctx.stroke();
      }
      break;
    case T.CUT:
      ctx.fillStyle = alt ? "#7bbf4f" : "#84c957";
      ctx.fillRect(x, y, TILE, TILE);
      // lignes de tonte
      ctx.strokeStyle = "rgba(255,255,255,0.10)";
      ctx.beginPath();
      ctx.moveTo(x, y + TILE / 2);
      ctx.lineTo(x + TILE, y + TILE / 2);
      ctx.stroke();
      break;
    case T.FLOWER:
      ctx.fillStyle = "#5a8a3c";
      ctx.fillRect(x, y, TILE, TILE);
      drawFlower(x + TILE / 2, y + TILE / 2);
      break;
    case T.CRUSHED:
      ctx.fillStyle = "#5a8a3c";
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = "#6b4a2a";
      ctx.beginPath();
      ctx.arc(x + TILE / 2, y + TILE / 2, 9, 0, Math.PI * 2);
      ctx.fill();
      break;
    case T.TREE:
      ctx.fillStyle = "#5a8a3c";
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = "#2f6d22";
      ctx.beginPath();
      ctx.arc(x + TILE / 2, y + TILE / 2, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#1f4d17";
      ctx.beginPath();
      ctx.arc(x + TILE / 2 - 6, y + TILE / 2 - 5, 9, 0, Math.PI * 2);
      ctx.fill();
      break;
    case T.ROCK:
      ctx.fillStyle = "#5a8a3c";
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = "#8a8f96";
      ctx.beginPath();
      ctx.moveTo(x + 8, y + TILE - 8);
      ctx.lineTo(x + 12, y + 12);
      ctx.lineTo(x + TILE - 10, y + 10);
      ctx.lineTo(x + TILE - 6, y + TILE - 6);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#a9aeb4";
      ctx.beginPath();
      ctx.moveTo(x + 12, y + 12);
      ctx.lineTo(x + TILE - 10, y + 10);
      ctx.lineTo(x + TILE / 2, y + TILE / 2);
      ctx.closePath();
      ctx.fill();
      break;
  }
}

function drawFlower(cx, cy) {
  const petals = 6;
  ctx.fillStyle = "#e85d9e";
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * 7, cy + Math.sin(a) * 7, 4.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#ffd23f";
  ctx.beginPath();
  ctx.arc(cx, cy, 5, 0, Math.PI * 2);
  ctx.fill();
}

function drawMower() {
  ctx.save();
  ctx.translate(mower.x, mower.y);
  ctx.rotate(mower.angle);

  // ombre
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.ellipse(2, 3, 17, 13, 0, 0, Math.PI * 2);
  ctx.fill();

  // corps
  ctx.fillStyle = damageCooldown > 0 ? "#ff7b5e" : "#d83a2f";
  roundRect(-16, -12, 30, 24, 6);
  ctx.fill();

  // capot avant
  ctx.fillStyle = "#b32a22";
  roundRect(4, -10, 12, 20, 4);
  ctx.fill();

  // lame qui tourne (avant)
  ctx.strokeStyle = "#dddddd";
  ctx.lineWidth = 2;
  const t = performance.now() / 60;
  ctx.beginPath();
  ctx.moveTo(10 + Math.cos(t) * 6, Math.sin(t) * 6);
  ctx.lineTo(10 - Math.cos(t) * 6, -Math.sin(t) * 6);
  ctx.stroke();

  // siège / guidon
  ctx.fillStyle = "#222";
  roundRect(-14, -7, 8, 14, 3);
  ctx.fill();

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
function updateHUD() {
  const pct = totalGrass ? Math.round((mowedGrass / totalGrass) * 100) : 0;
  el.mowed.textContent = pct + "%";
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
    // notation : temps + fleurs sauvées + santé
    let s = 1;
    if (flowersDestroyed === 0) s++;
    if (elapsed < 35) s++;
    stars = "⭐".repeat(s) + "☆".repeat(3 - s);
  }
  showOverlay(
    won ? "Jardin tondu ! 🌿" : "Tondeuse HS 💥",
    won
      ? `${stars}\nScore : ${score}\nTemps : ${elapsed.toFixed(1)}s\nFleurs détruites : ${flowersDestroyed}`
      : `Tu as percuté trop d'obstacles.\nTonte : ${Math.round((mowedGrass / totalGrass) * 100)}%\nScore : ${score}`,
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
buildLevel();
mower = { x: 1.5 * TILE, y: 1.5 * TILE, angle: 0, speed: 0,
  maxSpeed: 165, accel: 600, friction: 500, radius: 14, health: 100 };
keys = {};
state = "menu";
showOverlay(
  "🚜 Mow & Go",
  "Tonds tout le gazon !\nÉvite les massifs de fleurs 🌸\nNe percute pas les arbres 🌳 ni les rochers 🪨.\n\nDéplacement : flèches ou ZQSD",
  "Jouer"
);
requestAnimationFrame(loop);
