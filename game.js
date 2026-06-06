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

// Types de tuiles (l'herbe est un fond continu ; seuls les éléments
// spéciaux sont stockés dans la grille)
const T = {
  GRASS: 0,    // pelouse (fond)
  FLOWER: 1,   // massif de fleurs (à éviter)
  TREE: 2,     // arbre (obstacle solide)
  ROCK: 3,     // rocher (obstacle solide)
  CRUSHED: 4,  // fleur écrasée
  HOUSE: 5,    // maison (obstacle solide)
  GARAGE: 6,   // garage (obstacle solide)
  PAVED: 7,    // allée / terrasse pavée (carrossable, non tondable)
  FENCE: 8     // clôture (obstacle solide, bordure)
};

const SOLID = new Set([T.TREE, T.ROCK, T.HOUSE, T.GARAGE, T.FENCE]);
// Surfaces non tondables (en plus des obstacles) : fleurs et zones pavées
const UNMOWABLE = new Set([T.FLOWER, T.CRUSHED, T.PAVED]);

// --- Tonte : traînée peinte + grille de couverture ---
const CELL = 8;                              // finesse de la grille de couverture
const CW = Math.ceil(canvas.width / CELL);   // colonnes
const CH = Math.ceil(canvas.height / CELL);  // lignes
const DECK = 18;                             // demi-largeur de coupe (px)

let cov;                 // Uint8Array : 0 = à tondre, 1 = tondu, 2 = non tondable
let mowableTotal = 0;    // nb de cellules tondables
let mowedCount = 0;      // nb de cellules déjà tondues
let prevX = 0, prevY = 0; // position précédente (pour relier la traînée)

// Décor du jardin (rectangles en pixels, pour un rendu net sans seams)
let houseRect = null;
let garageRect = null;
let pavedRects = [];

// Calque hors-écran : la pelouse tondue (la traînée)
const mowCanvas = document.createElement("canvas");
mowCanvas.width = canvas.width;
mowCanvas.height = canvas.height;
const mowCtx = mowCanvas.getContext("2d");

// Calque hors-écran : le fond de pelouse (rendu une seule fois)
const fieldCanvas = document.createElement("canvas");
fieldCanvas.width = canvas.width;
fieldCanvas.height = canvas.height;
const fieldCtx = fieldCanvas.getContext("2d");

// --- État global ---
let grid = [];
let mower, keys, state;
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
// Remplit un rectangle de tuiles (coordonnées col/row incluses).
function fillTiles(c0, r0, c1, r1, type) {
  for (let r = r0; r <= r1; r++)
    for (let c = c0; c <= c1; c++)
      if (r >= 0 && c >= 0 && r < ROWS && c < COLS) grid[r][c] = type;
}

// Rectangle en pixels à partir de coordonnées de tuiles (incluses).
function rectPx(c0, r0, c1, r1) {
  return { x: c0 * TILE, y: r0 * TILE, w: (c1 - c0 + 1) * TILE, h: (r1 - r0 + 1) * TILE };
}

// Compose un jardin de pavillon typique : maison + garage, allée pavée,
// terrasse, clôture tout autour, massifs de fleurs, arbres — et de la
// pelouse à tondre tout autour.
function buildLevel() {
  grid = [];
  for (let r = 0; r < ROWS; r++) {
    const row = [];
    for (let c = 0; c < COLS; c++) row.push(T.GRASS);
    grid.push(row);
  }
  pavedRects = [];

  // Clôture sur tout le pourtour
  for (let c = 0; c < COLS; c++) { grid[0][c] = T.FENCE; grid[ROWS - 1][c] = T.FENCE; }
  for (let r = 0; r < ROWS; r++) { grid[r][0] = T.FENCE; grid[r][COLS - 1] = T.FENCE; }

  // Maison (haut-droite) et garage accolé en dessous
  fillTiles(14, 1, 18, 5, T.HOUSE);
  houseRect = rectPx(14, 1, 18, 5);
  fillTiles(14, 6, 16, 8, T.GARAGE);
  garageRect = rectPx(14, 6, 16, 8);

  // Allée pavée : du garage jusqu'au portail en bas
  fillTiles(14, 9, 16, 13, T.PAVED);
  pavedRects.push(rectPx(14, 9, 16, 13));

  // Terrasse pavée à gauche de la maison
  fillTiles(10, 1, 13, 3, T.PAVED);
  pavedRects.push(rectPx(10, 1, 13, 3));

  // Massifs de fleurs (bordures fleuries)
  fillTiles(6, 1, 8, 1, T.FLOWER);   // bande le long de la clôture haute
  fillTiles(1, 5, 1, 9, T.FLOWER);   // plate-bande le long de la clôture gauche
  fillTiles(2, 13, 4, 13, T.FLOWER); // massif en bas à gauche

  // Arbres isolés dans la pelouse
  for (const [r, c] of [[6, 6], [10, 9], [3, 4], [11, 11]]) grid[r][c] = T.TREE;

  // Rocaille
  for (const [r, c] of [[8, 11], [5, 8]]) grid[r][c] = T.ROCK;

  buildCoverage();
  buildField();
}

// Construit la grille de couverture : une cellule est « tondable »
// si son centre n'est ni sur un obstacle ni sur un massif de fleurs.
function buildCoverage() {
  cov = new Uint8Array(CW * CH);
  mowableTotal = 0;
  for (let r = 0; r < CH; r++) {
    for (let c = 0; c < CW; c++) {
      const x = (c + 0.5) * CELL;
      const y = (r + 0.5) * CELL;
      const tc = Math.floor(x / TILE);
      const tr = Math.floor(y / TILE);
      const tile = (tr >= 0 && tc >= 0 && tr < ROWS && tc < COLS) ? grid[tr][tc] : T.FENCE;
      if (SOLID.has(tile) || UNMOWABLE.has(tile)) {
        cov[r * CW + c] = 2; // non tondable (obstacle, fleurs ou pavé)
      } else {
        cov[r * CW + c] = 0; // pelouse à tondre
        mowableTotal++;
      }
    }
  }
}

// Pré-rendu du fond de pelouse (herbe haute, texture de brins).
function buildField() {
  const W = fieldCanvas.width, H = fieldCanvas.height;
  fieldCtx.fillStyle = "#3f7a2a";
  fieldCtx.fillRect(0, 0, W, H);
  fieldCtx.strokeStyle = "rgba(22,60,16,0.5)";
  fieldCtx.lineWidth = 1;
  // brins d'herbe dispersés (déterministe pour rester stable)
  let seed = 1234;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let i = 0; i < 1600; i++) {
    const x = rnd() * W, y = rnd() * H;
    fieldCtx.beginPath();
    fieldCtx.moveTo(x, y);
    fieldCtx.lineTo(x - 2, y - 7);
    fieldCtx.stroke();
  }
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
    radius: 13,
    health: 100
  };
  keys = {};
  score = 0;
  mowedCount = 0;
  flowersDestroyed = 0;
  damageCooldown = 0;
  elapsed = 0;
  startTime = performance.now();
  state = "playing";

  // Efface la traînée précédente et tond le point de départ
  mowCtx.clearRect(0, 0, mowCanvas.width, mowCanvas.height);
  prevX = mower.x;
  prevY = mower.y;
  stampAt(mower.x, mower.y);

  hideOverlay();
}

// Peint un coup de tondeuse (disque) sur le calque + met à jour la couverture.
function stampAt(x, y) {
  // traînée visible
  mowCtx.fillStyle = "#8fd166";
  mowCtx.beginPath();
  mowCtx.arc(x, y, DECK, 0, Math.PI * 2);
  mowCtx.fill();

  // couverture (cellules dont le centre tombe dans le disque)
  const minc = Math.max(0, Math.floor((x - DECK) / CELL));
  const maxc = Math.min(CW - 1, Math.floor((x + DECK) / CELL));
  const minr = Math.max(0, Math.floor((y - DECK) / CELL));
  const maxr = Math.min(CH - 1, Math.floor((y + DECK) / CELL));
  const R2 = DECK * DECK;
  for (let r = minr; r <= maxr; r++) {
    for (let c = minc; c <= maxc; c++) {
      const idx = r * CW + c;
      if (cov[idx] !== 0) continue; // déjà tondu ou non tondable
      const dx = (c + 0.5) * CELL - x;
      const dy = (r + 0.5) * CELL - y;
      if (dx * dx + dy * dy <= R2) {
        cov[idx] = 1;
        mowedCount++;
        score += 1;
      }
    }
  }
}

// Relie deux positions par une suite de disques (traînée continue).
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

const joy = {
  active: false,
  id: null,      // identifiant du toucher suivi
  baseX: 0,      // point d'apparition (centre)
  baseY: 0,
  dx: 0,
  dy: 0,
  mag: 0,        // 0..1 (vitesse analogique)
  maxR: 55       // amplitude max du knob en px
};
let boostHeld = false; // turbo via bouton tactile

const isTouch = ("ontouchstart" in window) || navigator.maxTouchPoints > 0;
if (isTouch) document.body.classList.add("touch");

// --- Joystick : apparition au point de contact ---
function joyStart(clientX, clientY, id) {
  joy.baseX = clientX;
  joy.baseY = clientY;
  joy.id = id;
  joy.active = true;
  const r = stageEl.getBoundingClientRect();
  joyEl.style.left = (clientX - r.left) + "px";
  joyEl.style.top = (clientY - r.top) + "px";
  joyEl.classList.add("visible");
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
  joyEl.classList.remove("visible");
}

// Le joystick peut naître n'importe où sur l'aire de jeu (un seul doigt suivi)
stageEl.addEventListener("touchstart", (e) => {
  if (joy.active) return;                 // déjà un doigt sur le manche
  const t = e.changedTouches[0];
  e.preventDefault();
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

// Souris : test du joystick sur ordinateur
stageEl.addEventListener("mousedown", (e) => {
  if (e.target === boostBtn) return;
  e.preventDefault();
  joyStart(e.clientX, e.clientY, "mouse");
});
window.addEventListener("mousemove", (e) => {
  if (joy.active && joy.id === "mouse") joyMove(e.clientX, e.clientY);
});
window.addEventListener("mouseup", () => { if (joy.id === "mouse") joyEnd(); });

// --- Bouton turbo (capte ses propres touches, sans déclencher le joystick) ---
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
    canvas.style.width = "";
    canvas.style.height = "";
    return;
  }
  const availW = window.innerWidth;
  const availH = window.innerHeight - hudEl.offsetHeight - ctrlEl.offsetHeight;
  const scale = Math.min(availW / canvas.width, availH / canvas.height);
  canvas.style.width = Math.floor(canvas.width * scale) + "px";
  canvas.style.height = Math.floor(canvas.height * scale) + "px";
}

const wrapper = document.getElementById("game-wrapper");
if (!(wrapper.requestFullscreen)) {
  fsBtn.style.display = "none"; // API non dispo (ex. Safari iPhone) → masqué
}
fsBtn.addEventListener("click", () => {
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else if (wrapper.requestFullscreen) {
    wrapper.requestFullscreen().catch(() => {});
  }
});
document.addEventListener("fullscreenchange", () => setTimeout(fitCanvas, 60));
window.addEventListener("resize", fitCanvas);
window.addEventListener("orientationchange", () => setTimeout(fitCanvas, 200));

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
  const boosting = boostHeld || !!keys["shift"];
  const effMax = mower.maxSpeed * (boosting ? 1.7 : 1); // turbo

  if (inp.active) {
    mower.angle = Math.atan2(inp.dy, inp.dx);
    const target = effMax * inp.mag; // vitesse proportionnelle au joystick
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

  // Dégâts si on percute un obstacle avec de la vitesse.
  // Tondeuse robuste : seuls les chocs assez rapides comptent, et ils
  // font peu de dégâts (longue durée de vie).
  if (damageCooldown > 0) damageCooldown -= dt;
  if (hitWall && mower.speed > 85 && damageCooldown <= 0) {
    const dmg = Math.round(3 + (mower.speed / mower.maxSpeed) * 6); // ~3 à 9
    mower.health = Math.max(0, mower.health - dmg);
    score = Math.max(0, score - 5);
    damageCooldown = 0.6;
    mower.speed *= 0.2; // rebond / arrêt brutal
    if (mower.health <= 0) endGame(false);
  }

  // Tonte : peint la traînée entre l'ancienne et la nouvelle position
  if (mower.x !== prevX || mower.y !== prevY) {
    stampTrail(prevX, prevY, mower.x, mower.y);
    prevX = mower.x;
    prevY = mower.y;
  }

  // Massif de fleurs écrasé si la tondeuse passe dessus
  const tc = Math.floor(mower.x / TILE);
  const tr = Math.floor(mower.y / TILE);
  if (tr >= 0 && tc >= 0 && tr < ROWS && tc < COLS && grid[tr][tc] === T.FLOWER) {
    grid[tr][tc] = T.CRUSHED;
    flowersDestroyed++;
    score = Math.max(0, score - 30);
  }

  // Victoire quand le jardin est (quasi) entièrement recouvert
  if (mowableTotal > 0 && mowedCount >= mowableTotal * 0.985) endGame(true);
}

// ------------------------------------------------------------
//  Rendu
// ------------------------------------------------------------
function draw() {
  // 1) fond de pelouse  2) traînée tondue par-dessus
  ctx.drawImage(fieldCanvas, 0, 0);
  ctx.drawImage(mowCanvas, 0, 0);

  // 3) surfaces pavées (cachent la traînée : pas d'herbe sur l'allée)
  for (const p of pavedRects) drawPaved(p);

  // 4) bâtiments + clôture
  if (houseRect) drawHouse(houseRect);
  if (garageRect) drawGarage(garageRect);
  drawFence();

  // 5) fleurs, arbres, rochers (par-dessus la pelouse, sans fond carré)
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const tile = grid[r][c];
      if (tile === T.FLOWER || tile === T.CRUSHED || tile === T.TREE || tile === T.ROCK) {
        drawTile(tile, c * TILE, r * TILE);
      }
    }
  }

  // 6) tondeuse
  drawMower();
}

// ---- Décor du jardin ----
function drawPaved(p) {
  ctx.fillStyle = "#b9b3a7";
  ctx.fillRect(p.x, p.y, p.w, p.h);
  // joints de dalles
  ctx.strokeStyle = "rgba(120,115,105,0.6)";
  ctx.lineWidth = 1;
  for (let x = p.x; x <= p.x + p.w; x += 20) {
    ctx.beginPath(); ctx.moveTo(x, p.y); ctx.lineTo(x, p.y + p.h); ctx.stroke();
  }
  for (let y = p.y; y <= p.y + p.h; y += 20) {
    ctx.beginPath(); ctx.moveTo(p.x, y); ctx.lineTo(p.x + p.w, y); ctx.stroke();
  }
}

function drawHouse(h) {
  // murs
  ctx.fillStyle = "#e8d9b5";
  ctx.fillRect(h.x, h.y, h.w, h.h);
  ctx.strokeStyle = "#b8a888";
  ctx.lineWidth = 2;
  ctx.strokeRect(h.x + 1, h.y + 1, h.w - 2, h.h - 2);
  // toit (bande sur le haut)
  const roofH = Math.min(34, h.h * 0.32);
  ctx.fillStyle = "#9c3b2e";
  ctx.fillRect(h.x - 4, h.y - 4, h.w + 8, roofH);
  ctx.fillStyle = "#7e2e23";
  ctx.fillRect(h.x - 4, h.y - 4, h.w + 8, 6);
  // porte
  ctx.fillStyle = "#6b4a2a";
  const dw = 22, dh = 36;
  ctx.fillRect(h.x + h.w / 2 - dw / 2, h.y + h.h - dh, dw, dh);
  ctx.fillStyle = "#d9b94e";
  ctx.beginPath();
  ctx.arc(h.x + h.w / 2 + dw / 2 - 5, h.y + h.h - dh / 2, 2, 0, Math.PI * 2);
  ctx.fill();
  // fenêtres
  ctx.fillStyle = "#8fd0e6";
  const wy = h.y + roofH + 10;
  for (const wx of [h.x + 16, h.x + h.w - 16 - 24]) {
    ctx.fillRect(wx, wy, 24, 22);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.strokeRect(wx, wy, 24, 22);
    ctx.beginPath();
    ctx.moveTo(wx + 12, wy); ctx.lineTo(wx + 12, wy + 22);
    ctx.moveTo(wx, wy + 11); ctx.lineTo(wx + 24, wy + 11);
    ctx.stroke();
  }
}

function drawGarage(g) {
  ctx.fillStyle = "#d8cdb6";
  ctx.fillRect(g.x, g.y, g.w, g.h);
  // toit plat foncé
  ctx.fillStyle = "#8a4034";
  ctx.fillRect(g.x - 3, g.y - 3, g.w + 6, 10);
  // porte de garage avec rainures
  ctx.fillStyle = "#9aa0a6";
  const px = g.x + 8, py = g.y + 16, pw = g.w - 16, ph = g.h - 24;
  ctx.fillRect(px, py, pw, ph);
  ctx.strokeStyle = "#7d838a";
  ctx.lineWidth = 1;
  for (let y = py + 8; y < py + ph; y += 9) {
    ctx.beginPath(); ctx.moveTo(px, y); ctx.lineTo(px + pw, y); ctx.stroke();
  }
  ctx.strokeStyle = "#7d838a";
  ctx.lineWidth = 2;
  ctx.strokeRect(px, py, pw, ph);
}

function drawFence() {
  const W = canvas.width, H = canvas.height;
  const m = TILE / 2; // axe des rails (centre des tuiles de bordure)
  ctx.strokeStyle = "#8a5a32";
  ctx.lineWidth = 5;
  ctx.strokeRect(m, m, W - 2 * m, H - 2 * m);
  // poteaux tous les TILE
  ctx.fillStyle = "#6e4626";
  for (let x = m; x <= W - m; x += TILE) {
    ctx.fillRect(x - 3, m - 6, 6, 12);
    ctx.fillRect(x - 3, H - m - 6, 6, 12);
  }
  for (let y = m; y <= H - m; y += TILE) {
    ctx.fillRect(m - 3, y - 6, 6, 12);
    ctx.fillRect(W - m - 3, y - 6, 6, 12);
  }
}

function drawTile(type, x, y) {
  switch (type) {
    case T.FLOWER:
      drawFlower(x + TILE / 2, y + TILE / 2);
      break;
    case T.CRUSHED:
      ctx.fillStyle = "#6b4a2a";
      ctx.beginPath();
      ctx.arc(x + TILE / 2, y + TILE / 2, 9, 0, Math.PI * 2);
      ctx.fill();
      break;
    case T.TREE:
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
buildLevel();
mower = { x: 1.5 * TILE, y: 1.5 * TILE, angle: 0, speed: 0,
  maxSpeed: 165, accel: 600, friction: 500, radius: 13, health: 100 };
keys = {};
state = "menu";
showOverlay(
  "🚜 Mow & Go",
  "Tonds toute la pelouse autour de la maison 🏠\nÉvite les massifs de fleurs 🌸\nNe percute pas la maison, le garage ni les arbres 🌳.\nL'allée pavée se traverse librement.\n\n" +
  (isTouch ? "Pose ton pouce pour conduire · ⚡ Turbo" : "Déplacement : flèches ou ZQSD · Maj = turbo"),
  "Jouer"
);
fitCanvas();
requestAnimationFrame(loop);
