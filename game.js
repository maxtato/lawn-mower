"use strict";

// ============================================================
//  Mow & Go — tondeuse en vue de dessus, jardin défilant
//  Le monde est plus grand que l'écran : la caméra suit la
//  tondeuse (zoom + défilement). Décor dessiné, varié.
// ============================================================

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
canvas.width = 960;
canvas.height = 720;

// --- Monde & caméra ---
const WORLD_W = 1800, WORLD_H = 1350;
const ZOOM = 2.0;                 // zoom : on ne voit qu'un bout du jardin
const viewW = canvas.width / ZOOM;
const viewH = canvas.height / ZOOM;
const cam = { x: 0, y: 0 };

// --- Calques hors-écran (taille du monde) ---
function makeLayer() {
  const c = document.createElement("canvas");
  c.width = WORLD_W; c.height = WORLD_H;
  return c;
}
const grassCanvas = makeLayer();  // pelouse non tondue (statique)
const grassCtx = grassCanvas.getContext("2d");
const decorCanvas = makeLayer();  // décor (arbres, fleurs, maison…) statique
const decorCtx = decorCanvas.getContext("2d");
const mowCanvas = makeLayer();    // traînée tondue (vert clair)
const mowCtx = mowCanvas.getContext("2d");

// --- Tonte / couverture ---
const CELL = 10;
const CW = Math.ceil(WORLD_W / CELL);
const CH = Math.ceil(WORLD_H / CELL);
let cov;                          // 0 = à tondre, 1 = tondu, 2 = non tondable
let mowableTotal = 0, mowedCount = 0;
const DECK = 30;                  // demi-largeur de coupe (monde) — un peu plus large que la tondeuse
let mowPattern = null;            // texture « herbe tondue » (vert clair + brins)

// --- Géométrie ---
const bounds = { x0: 44, y0: 44, x1: WORLD_W - 44, y1: WORLD_H - 44 };
let solids = [];   // bloquent + dégâts
let noMow = [];    // non tondable (tout ce qui n'est pas pelouse)
let beds = [];     // massifs / potager : non tondable + malus

// --- État ---
let mower, keys, state;
let score = 0, flowersDestroyed = 0, flowerCd = 0;
let startTime = 0, elapsed = 0, damageCooldown = 0;
let prevX = 0, prevY = 0;

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
//  Générateur pseudo-aléatoire déterministe (décor stable)
// ------------------------------------------------------------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------
//  Formes (collision + couverture)
// ------------------------------------------------------------
function R(x, y, w, h) { return { k: "r", x, y, w, h }; }
function C(cx, cy, r) { return { k: "c", cx, cy, r }; }
function E(cx, cy, rx, ry) { return { k: "e", cx, cy, rx, ry }; }
function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

function pointIn(x, y, s) {
  if (s.k === "r") return x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h;
  if (s.k === "c") return (x - s.cx) ** 2 + (y - s.cy) ** 2 <= s.r * s.r;
  return ((x - s.cx) / s.rx) ** 2 + ((y - s.cy) / s.ry) ** 2 <= 1;
}
function inAny(x, y, list) { for (const s of list) if (pointIn(x, y, s)) return true; return false; }

function collideShape(cx, cy, r, s) {
  if (s.k === "r") {
    const nx = clamp(cx, s.x, s.x + s.w), ny = clamp(cy, s.y, s.y + s.h);
    return (cx - nx) ** 2 + (cy - ny) ** 2 <= r * r;
  }
  if (s.k === "c") return (cx - s.cx) ** 2 + (cy - s.cy) ** 2 <= (r + s.r) ** 2;
  return ((cx - s.cx) / (s.rx + r)) ** 2 + ((cy - s.cy) / (s.ry + r)) ** 2 <= 1;
}
function hitsSolid(cx, cy, r) {
  if (cx - r < bounds.x0 || cx + r > bounds.x1 || cy - r < bounds.y0 || cy + r > bounds.y1) return true;
  for (const s of solids) if (collideShape(cx, cy, r, s)) return true;
  return false;
}
function isMowable(x, y) {
  if (x < bounds.x0 || x > bounds.x1 || y < bounds.y0 || y > bounds.y1) return false;
  return !inAny(x, y, noMow);
}
function inBed(x, y) { return inAny(x, y, beds); }

// ============================================================
//  Construction du jardin
// ============================================================
function buildWorld() {
  solids = []; noMow = []; beds = [];
  buildGrass();
  buildMowPattern();
  decorCtx.clearRect(0, 0, WORLD_W, WORLD_H);
  buildDecor();
  buildCoverage();
}

// Texture de pelouse tondue : vert clair avec de petits brins, pour garder
// du détail sur la partie tondue.
function buildMowPattern() {
  const t = document.createElement("canvas");
  t.width = 48; t.height = 48;
  const p = t.getContext("2d");
  p.fillStyle = "#a6e066"; p.fillRect(0, 0, 48, 48);
  // fines bandes de tonte
  p.fillStyle = "rgba(255,255,255,0.06)"; p.fillRect(0, 0, 48, 24);
  p.fillStyle = "rgba(40,110,30,0.05)"; p.fillRect(0, 24, 48, 24);
  // petits brins d'herbe
  const rnd = mulberry32(321);
  for (let i = 0; i < 70; i++) {
    const x = rnd() * 48, y = rnd() * 48;
    p.strokeStyle = rnd() > 0.5 ? "rgba(70,140,45,0.40)" : "rgba(190,235,130,0.55)";
    p.lineWidth = 1;
    p.beginPath(); p.moveTo(x, y); p.lineTo(x - 1.5, y - 4); p.stroke();
  }
  mowPattern = mowCtx.createPattern(t, "repeat");
}

// --- Pelouse non tondue (texture) ---
function buildGrass() {
  const g = grassCtx;
  // dégradé léger
  g.fillStyle = "#3c7a28";
  g.fillRect(0, 0, WORLD_W, WORLD_H);
  const rnd = mulberry32(99);
  // taches plus claires / plus foncées
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * WORLD_W, y = rnd() * WORLD_H, r = 6 + rnd() * 16;
    g.fillStyle = rnd() > 0.5 ? "rgba(80,150,50,0.10)" : "rgba(20,55,15,0.10)";
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  // brins
  g.strokeStyle = "rgba(20,55,14,0.5)";
  g.lineWidth = 1.4;
  for (let i = 0; i < 5200; i++) {
    const x = rnd() * WORLD_W, y = rnd() * WORLD_H;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x - 2, y - 9); g.stroke();
  }
  // petites fleurs sauvages & trèfles dans l'herbe haute (couverts une fois tondu)
  for (let i = 0; i < 240; i++) {
    const x = rnd() * WORLD_W, y = rnd() * WORLD_H, t = rnd();
    if (t > 0.6) {            // pâquerette
      g.fillStyle = "#f4f4ec";
      for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2; g.beginPath(); g.arc(x + Math.cos(a) * 2.4, y + Math.sin(a) * 2.4, 1.4, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = "#f1c232"; g.beginPath(); g.arc(x, y, 1.4, 0, Math.PI * 2); g.fill();
    } else if (t > 0.35) {    // pissenlit
      g.fillStyle = "#f1c232"; g.beginPath(); g.arc(x, y, 2.2, 0, Math.PI * 2); g.fill();
    } else {                  // touffe de trèfle
      g.fillStyle = "rgba(60,140,45,0.55)";
      for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI * 2; g.beginPath(); g.arc(x + Math.cos(a) * 2, y + Math.sin(a) * 2, 1.8, 0, Math.PI * 2); g.fill(); }
    }
  }
}

// --- Décor : enregistre les formes ET les dessine ---
function addSolid(s) { solids.push(s); noMow.push(s); }
function addPaved(s) { noMow.push(s); }            // carrossable, non tondable
function addBed(s) { noMow.push(s); beds.push(s); } // massif : non tondable + malus
function addCanopy(s) { noMow.push(s); }            // sous les arbres : non tondable

function buildDecor() {
  const g = decorCtx;

  // ----- Zones pavées -----
  const terrace = R(820, 130, 320, 280);
  const drive = R(1545, 560, 195, WORLD_H - 44 - 560);
  const path = R(1190, 430, 130, 110);
  for (const p of [terrace, drive, path]) { addPaved(p); drawPaved(g, p); }

  // ----- Maison + garage (toits vus de dessus) -----
  const house = R(1180, 70, 575, 360);
  const garage = R(1520, 430, 235, 150);
  addSolid(house); addSolid(garage);
  drawRoof(g, garage, "#9a6b40", "#b07f4f", "#7c5430", false);
  drawRoof(g, house, "#b14534", "#cb5a45", "#8f3527", true);

  // pas japonais entre la terrasse et la pelouse
  for (const [sx, sy] of [[990, 430], [1015, 478], [1042, 526], [1070, 572], [1100, 616]]) {
    addPaved(C(sx, sy, 20)); drawStone(g, sx, sy, 20);
  }

  // haie séparant la pelouse de l'allée
  const hedge = R(1470, 640, 44, 600);
  addSolid(hedge); drawHedge(g, hedge);

  // ----- Mare -----
  const pond = E(560, 1010, 195, 130);
  addSolid(pond);
  drawPond(g, pond);

  // ----- Potager -----
  const veg = R(120, 1060, 270, 230);
  addBed(veg);
  drawVeggie(g, veg);

  // ----- Massifs de fleurs (variés) -----
  const flowerBeds = [
    R(520, 60, 620, 92),     // bande haute
    R(60, 360, 150, 560),    // plate-bande gauche
    R(700, 430, 120, 110),   // près de la terrasse
    R(1320, 440, 220, 130),  // devant la maison
    R(900, 1090, 300, 210)   // bas-centre
  ];
  for (const b of flowerBeds) { addBed(b); drawFlowerBed(g, b); }

  // ----- Arbres variés (canopée = non tondable, tronc = solide) -----
  const trees = [
    { type: "oak", x: 250, y: 260, r: 150 },
    { type: "oak", x: 980, y: 1170, r: 140 },
    { type: "pine", x: 430, y: 660, r: 120 },
    { type: "pine", x: 1410, y: 1180, r: 115 },
    { type: "birch", x: 810, y: 760, r: 95 },
    { type: "round", x: 1180, y: 900, r: 85 }
  ];
  for (const t of trees) {
    addCanopy(C(t.x, t.y, t.r));
    addSolid(C(t.x, t.y, Math.max(26, t.r * 0.34))); // tronc/base
  }
  // (dessinés après les massifs pour passer devant)
  for (const t of trees) drawTree(g, t);

  // ----- Banc, rochers, pots -----
  const bench = R(540, 1180, 170, 46);
  addSolid(bench); drawBench(g, bench);

  for (const [x, y, r] of [[720, 560, 30], [905, 640, 24]]) {
    addSolid(C(x, y, r)); drawRock(g, x, y, r);
  }
  for (const [x, y] of [[800, 150], [1130, 150]]) {
    addSolid(C(x, y, 22)); drawPot(g, x, y);
  }

  // ----- Vasque à oiseaux près de la mare -----
  addSolid(C(830, 1010, 19)); drawBirdbath(g, 830, 1010);

  // ----- Arbustes ornementaux isolés -----
  for (const [x, y, r] of [[1150, 660, 18], [690, 990, 16], [330, 430, 17], [1240, 1140, 16]]) {
    addSolid(C(x, y, r * 0.7)); drawShrub(g, x, y, r);
  }

  // ----- Clôture sur tout le pourtour -----
  drawFence(g);
}

// ------------------------------------------------------------
//  Dessins d'éléments
// ------------------------------------------------------------
function drawPaved(g, p) {
  g.fillStyle = "#bdb6a8";
  g.fillRect(p.x, p.y, p.w, p.h);
  g.strokeStyle = "rgba(120,114,103,0.65)";
  g.lineWidth = 1.5;
  for (let x = p.x; x <= p.x + p.w; x += 28) { g.beginPath(); g.moveTo(x, p.y); g.lineTo(x, p.y + p.h); g.stroke(); }
  for (let y = p.y; y <= p.y + p.h; y += 28) { g.beginPath(); g.moveTo(p.x, y); g.lineTo(p.x + p.w, y); g.stroke(); }
}

// Toit en croupe vu de dessus (4 pans + faîtage). col = teinte de base.
function drawRoof(g, b, col, light, dark, chimney) {
  const x = b.x, y = b.y, w = b.w, h = b.h;
  const inset = Math.min(w, h) * 0.30;
  // débord de toit + ombre portée
  g.fillStyle = "rgba(0,0,0,0.22)";
  g.fillRect(x - 10 + 6, y - 10 + 10, w + 20, h + 20);
  const ox = x - 10, oy = y - 10, ow = w + 20, oh = h + 20;

  if (ow >= oh) { // faîtage horizontal
    const my = oy + oh / 2;
    const lx = ox + inset, rx = ox + ow - inset;
    // pan haut (clair), pan bas (foncé), pans gauche/droite (médian)
    quad(g, light, ox, oy, ox + ow, oy, rx, my, lx, my);
    quad(g, dark, ox, oy + oh, ox + ow, oy + oh, rx, my, lx, my);
    tri(g, col, ox, oy, ox, oy + oh, lx, my);
    tri(g, shade(col, -12), ox + ow, oy, ox + ow, oy + oh, rx, my);
    g.strokeStyle = dark; g.lineWidth = 3;
    g.beginPath(); g.moveTo(lx, my); g.lineTo(rx, my); g.stroke();
    // arêtes de croupe
    g.strokeStyle = "rgba(0,0,0,0.20)"; g.lineWidth = 2;
    edges(g, [[ox, oy, lx, my], [ox + ow, oy, rx, my], [ox, oy + oh, lx, my], [ox + ow, oy + oh, rx, my]]);
  } else {        // faîtage vertical
    const mx = ox + ow / 2;
    const ty = oy + inset, by = oy + oh - inset;
    quad(g, light, ox, oy, ox, oy + oh, mx, by, mx, ty);
    quad(g, dark, ox + ow, oy, ox + ow, oy + oh, mx, by, mx, ty);
    tri(g, col, ox, oy, ox + ow, oy, mx, ty);
    tri(g, shade(col, -12), ox, oy + oh, ox + ow, oy + oh, mx, by);
    g.strokeStyle = dark; g.lineWidth = 3;
    g.beginPath(); g.moveTo(mx, ty); g.lineTo(mx, by); g.stroke();
    g.strokeStyle = "rgba(0,0,0,0.20)"; g.lineWidth = 2;
    edges(g, [[ox, oy, mx, ty], [ox + ow, oy, mx, ty], [ox, oy + oh, mx, by], [ox + ow, oy + oh, mx, by]]);
  }
  // gouttière
  g.strokeStyle = shade(col, -25); g.lineWidth = 4; g.strokeRect(ox, oy, ow, oh);

  if (chimney) {
    const cw = 26, ch = 26;
    const cx = x + w * 0.72, cy = y + h * 0.28;
    g.fillStyle = "rgba(0,0,0,0.25)"; g.fillRect(cx - cw / 2 + 4, cy - ch / 2 + 5, cw, ch);
    g.fillStyle = "#7d5a3a"; g.fillRect(cx - cw / 2, cy - ch / 2, cw, ch);
    g.fillStyle = "#3a2a1c"; g.fillRect(cx - cw / 2 + 4, cy - ch / 2 + 4, cw - 8, ch - 8);
  }
}
function quad(g, c, x1, y1, x2, y2, x3, y3, x4, y4) {
  g.fillStyle = c; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.lineTo(x3, y3); g.lineTo(x4, y4); g.closePath(); g.fill();
}
function tri(g, c, x1, y1, x2, y2, x3, y3) {
  g.fillStyle = c; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.lineTo(x3, y3); g.closePath(); g.fill();
}
function edges(g, list) { for (const [a, b, c, d] of list) { g.beginPath(); g.moveTo(a, b); g.lineTo(c, d); g.stroke(); } }
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) + amt, gg = ((n >> 8) & 255) + amt, bb = (n & 255) + amt;
  r = clamp(r, 0, 255); gg = clamp(gg, 0, 255); bb = clamp(bb, 0, 255);
  return `rgb(${r | 0},${gg | 0},${bb | 0})`;
}

function drawStone(g, x, y, r) {
  g.fillStyle = "rgba(0,0,0,0.15)"; g.beginPath(); g.ellipse(x + 2, y + 3, r, r * 0.85, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#bdb6a8"; g.beginPath(); g.ellipse(x, y, r, r * 0.85, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = "rgba(255,255,255,0.18)"; g.beginPath(); g.ellipse(x - r * 0.25, y - r * 0.25, r * 0.5, r * 0.4, 0, 0, Math.PI * 2); g.fill();
}
function drawHedge(g, b) {
  const vertical = b.h > b.w;
  g.fillStyle = "#2a6b27"; roundRectPath(g, b.x, b.y, b.w, b.h, 10); g.fill();
  g.fillStyle = "#357f31";
  if (vertical) for (let y = b.y + 8; y < b.y + b.h; y += 20) { g.beginPath(); g.arc(b.x + b.w / 2, y, b.w / 2, 0, Math.PI * 2); g.fill(); }
  else for (let x = b.x + 8; x < b.x + b.w; x += 20) { g.beginPath(); g.arc(x, b.y + b.h / 2, b.h / 2, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = "rgba(150,210,90,0.25)"; roundRectPath(g, b.x + 3, b.y + 3, b.w - 6, b.h * 0.4, 8); g.fill();
}
function drawBirdbath(g, x, y) {
  g.fillStyle = "rgba(0,0,0,0.18)"; g.beginPath(); g.ellipse(x + 2, y + 3, 20, 16, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#9a9488"; g.beginPath(); g.arc(x, y, 11, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#cdc6ba"; g.beginPath(); g.arc(x, y, 19, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#6fb3d6"; g.beginPath(); g.arc(x, y, 14, 0, Math.PI * 2); g.fill();
  g.fillStyle = "rgba(255,255,255,0.3)"; g.beginPath(); g.arc(x - 5, y - 5, 5, 0, Math.PI * 2); g.fill();
}

function drawPond(g, e) {
  // bordure de pierres
  g.fillStyle = "#9a9488";
  g.beginPath(); g.ellipse(e.cx, e.cy, e.rx + 10, e.ry + 10, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#2f7fb0";
  g.beginPath(); g.ellipse(e.cx, e.cy, e.rx, e.ry, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = "rgba(255,255,255,0.18)";
  g.beginPath(); g.ellipse(e.cx - e.rx * 0.3, e.cy - e.ry * 0.3, e.rx * 0.45, e.ry * 0.35, 0, 0, Math.PI * 2); g.fill();
  // nénuphars
  g.fillStyle = "#2f8f43";
  for (const [dx, dy] of [[-60, 30], [40, -20], [80, 40]]) {
    g.beginPath(); g.arc(e.cx + dx, e.cy + dy, 16, 0, Math.PI * 2); g.fill();
  }
}

function drawVeggie(g, r) {
  g.fillStyle = "#6b4a2a"; g.fillRect(r.x, r.y, r.w, r.h);
  g.strokeStyle = "#553a20"; g.lineWidth = 3;
  for (let y = r.y + 18; y < r.y + r.h; y += 30) { g.beginPath(); g.moveTo(r.x + 6, y); g.lineTo(r.x + r.w - 6, y); g.stroke(); }
  const rnd = mulberry32(7);
  for (let y = r.y + 18; y < r.y + r.h - 8; y += 30) {
    for (let x = r.x + 22; x < r.x + r.w - 12; x += 34) {
      g.fillStyle = "#3f9b3a";
      g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.fill();
      if (rnd() > 0.6) { // quelques légumes colorés
        g.fillStyle = rnd() > 0.5 ? "#e0533d" : "#e8a93f";
        g.beginPath(); g.arc(x + 3, y - 2, 3.2, 0, Math.PI * 2); g.fill();
      }
    }
  }
}

const FLOWER_COLORS = ["#e0533d", "#e85d9e", "#f1c232", "#b06ad6", "#ffffff", "#ff8c42"];
function drawFlower(g, x, y, color, s) {
  g.fillStyle = color;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    g.beginPath(); g.arc(x + Math.cos(a) * 3 * s, y + Math.sin(a) * 3 * s, 2.1 * s, 0, Math.PI * 2); g.fill();
  }
  g.fillStyle = "#ffd23f";
  g.beginPath(); g.arc(x, y, 2.1 * s, 0, Math.PI * 2); g.fill();
}
function drawShrub(g, x, y, r) {
  g.fillStyle = "#2f7d2c";
  for (const [dx, dy, rr] of [[0, 0, r], [-r * 0.6, r * 0.2, r * 0.7], [r * 0.6, r * 0.2, r * 0.7]]) {
    g.beginPath(); g.arc(x + dx, y + dy, rr, 0, Math.PI * 2); g.fill();
  }
  g.fillStyle = "rgba(120,200,90,0.35)";
  g.beginPath(); g.arc(x - r * 0.2, y - r * 0.3, r * 0.5, 0, Math.PI * 2); g.fill();
}
function drawFlowerBed(g, b) {
  // terre
  g.fillStyle = "#5a3d22";
  roundRectPath(g, b.x, b.y, b.w, b.h, 10); g.fill();
  const rnd = mulberry32(Math.floor(b.x * 13 + b.y));
  // buissons + fleurs
  const n = Math.floor((b.w * b.h) / 1700);
  for (let i = 0; i < n; i++) {
    const x = b.x + 8 + rnd() * (b.w - 16);
    const y = b.y + 8 + rnd() * (b.h - 16);
    if (rnd() > 0.55) drawShrub(g, x, y, 8 + rnd() * 8);
    else drawFlower(g, x, y, FLOWER_COLORS[(rnd() * FLOWER_COLORS.length) | 0], 1 + rnd() * 1.2);
  }
}

function drawTree(g, t) {
  const { x, y, r, type } = t;
  // ombre portée
  g.fillStyle = "rgba(0,0,0,0.18)";
  g.beginPath(); g.ellipse(x + r * 0.18, y + r * 0.22, r * 0.95, r * 0.6, 0, 0, Math.PI * 2); g.fill();
  if (type === "pine") {
    g.fillStyle = "#6b4a2a"; g.fillRect(x - 8, y, 16, r * 0.5);
    for (let i = 0; i < 3; i++) {
      const yy = y - r * 0.7 + i * r * 0.45, w = r * (0.9 - i * 0.22);
      g.fillStyle = i === 0 ? "#1f5a1e" : "#256b23";
      g.beginPath(); g.moveTo(x, yy - r * 0.5); g.lineTo(x - w, yy + r * 0.2); g.lineTo(x + w, yy + r * 0.2); g.closePath(); g.fill();
    }
  } else if (type === "birch") {
    g.fillStyle = "#e8e8e0"; g.fillRect(x - 6, y - r * 0.1, 12, r * 0.8);
    g.fillStyle = "#444"; for (let i = 0; i < 4; i++) g.fillRect(x - 6, y + i * (r * 0.18), 12, 2);
    g.fillStyle = "#7cbf3f";
    for (const [dx, dy, rr] of [[0, -r * 0.4, r * 0.6], [-r * 0.4, -r * 0.1, r * 0.45], [r * 0.4, -r * 0.15, r * 0.45]]) {
      g.beginPath(); g.arc(x + dx, y + dy, rr, 0, Math.PI * 2); g.fill();
    }
  } else { // chêne / arbre rond touffu
    g.fillStyle = "#5a3a1e"; g.fillRect(x - 10, y, 20, r * 0.4);
    const base = type === "oak" ? "#2f7d2c" : "#3f9b3a";
    const clusters = [[0, -r * 0.25, r * 0.7], [-r * 0.55, 0, r * 0.55], [r * 0.55, 0, r * 0.55], [-r * 0.25, -r * 0.6, r * 0.5], [r * 0.3, -r * 0.55, r * 0.5]];
    g.fillStyle = base;
    for (const [dx, dy, rr] of clusters) { g.beginPath(); g.arc(x + dx, y + dy, rr, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = "rgba(150,210,90,0.30)";
    for (const [dx, dy, rr] of clusters) { g.beginPath(); g.arc(x + dx - rr * 0.25, y + dy - rr * 0.3, rr * 0.55, 0, Math.PI * 2); g.fill(); }
  }
}

function drawBench(g, b) {
  g.fillStyle = "#8a5a32"; g.fillRect(b.x, b.y, b.w, b.h);
  g.fillStyle = "#6e4626"; g.fillRect(b.x, b.y, b.w, 8);
  for (let x = b.x + 8; x < b.x + b.w; x += 22) g.fillRect(x, b.y + b.h - 10, 6, 10);
}
function drawRock(g, x, y, r) {
  g.fillStyle = "#8a8f96";
  g.beginPath(); g.ellipse(x, y, r, r * 0.8, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#a9aeb4";
  g.beginPath(); g.ellipse(x - r * 0.2, y - r * 0.2, r * 0.55, r * 0.4, 0, 0, Math.PI * 2); g.fill();
}
function drawPot(g, x, y) {
  g.fillStyle = "#b5642f"; g.beginPath(); g.moveTo(x - 16, y - 4); g.lineTo(x + 16, y - 4); g.lineTo(x + 12, y + 16); g.lineTo(x - 12, y + 16); g.closePath(); g.fill();
  drawShrub(g, x, y - 10, 12);
}

function drawFence(g) {
  const m = 22;
  g.strokeStyle = "#8a5a32"; g.lineWidth = 10;
  g.strokeRect(m, m, WORLD_W - 2 * m, WORLD_H - 2 * m);
  g.fillStyle = "#6e4626";
  for (let x = m; x <= WORLD_W - m; x += 60) { g.fillRect(x - 5, m - 12, 10, 24); g.fillRect(x - 5, WORLD_H - m - 12, 10, 24); }
  for (let y = m; y <= WORLD_H - m; y += 60) { g.fillRect(m - 5, y - 12, 10, 24); g.fillRect(WORLD_W - m - 5, y - 12, 10, 24); }
}

function roundRectPath(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// ------------------------------------------------------------
//  Couverture
// ------------------------------------------------------------
function buildCoverage() {
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
//  Partie
// ------------------------------------------------------------
function makeMower() {
  return {
    x: 640, y: 560, angle: 0, speed: 0,
    maxSpeed: 190, accel: 750, friction: 650,
    radius: 17, health: 100
  };
}

function reset() {
  mower = makeMower();
  keys = {};
  score = 0; mowedCount = 0; flowersDestroyed = 0; flowerCd = 0;
  damageCooldown = 0; elapsed = 0; startTime = performance.now();
  state = "playing";
  mowCtx.clearRect(0, 0, WORLD_W, WORLD_H);
  prevX = mower.x; prevY = mower.y;
  stampAt(mower.x, mower.y);
  hideOverlay();
}

function stampAt(x, y) {
  mowCtx.fillStyle = mowPattern || "#a6e066";
  mowCtx.beginPath(); mowCtx.arc(x, y, DECK, 0, Math.PI * 2); mowCtx.fill();

  const minc = Math.max(0, Math.floor((x - DECK) / CELL));
  const maxc = Math.min(CW - 1, Math.floor((x + DECK) / CELL));
  const minr = Math.max(0, Math.floor((y - DECK) / CELL));
  const maxr = Math.min(CH - 1, Math.floor((y + DECK) / CELL));
  const R2 = DECK * DECK;
  for (let r = minr; r <= maxr; r++) {
    for (let c = minc; c <= maxc; c++) {
      const idx = r * CW + c;
      if (cov[idx] !== 0) continue;
      const dx = (c + 0.5) * CELL - x, dy = (r + 0.5) * CELL - y;
      if (dx * dx + dy * dy <= R2) { cov[idx] = 1; mowedCount++; score += 1; }
    }
  }
}
function stampTrail(x0, y0, x1, y1) {
  const d = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(1, Math.ceil(d / (DECK * 0.5)));
  for (let i = 1; i <= steps; i++) { const t = i / steps; stampAt(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t); }
}

// ------------------------------------------------------------
//  Entrées clavier
// ------------------------------------------------------------
document.addEventListener("keydown", (e) => {
  keys[e.key.toLowerCase()] = true;
  if (e.key.toLowerCase() === "r") reset();
  if (["arrowup", "arrowdown", "arrowleft", "arrowright"].includes(e.key.toLowerCase())) e.preventDefault();
});
document.addEventListener("keyup", (e) => { keys[e.key.toLowerCase()] = false; });
el.overlayBtn.addEventListener("click", reset);

// ------------------------------------------------------------
//  Joystick + Turbo + Plein écran (inchangé)
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
  knobEl.style.transform = "translate(0px, 0px)"; joyEl.classList.remove("visible");
}
stageEl.addEventListener("touchstart", (e) => {
  if (joy.active) return;
  const t = e.changedTouches[0]; e.preventDefault();
  joyStart(t.clientX, t.clientY, t.identifier);
}, { passive: false });
window.addEventListener("touchmove", (e) => {
  if (!joy.active) return;
  for (const t of e.changedTouches) if (t.identifier === joy.id) { e.preventDefault(); joyMove(t.clientX, t.clientY); break; }
}, { passive: false });
window.addEventListener("touchend", (e) => { for (const t of e.changedTouches) if (t.identifier === joy.id) { joyEnd(); break; } });
window.addEventListener("touchcancel", joyEnd);
stageEl.addEventListener("mousedown", (e) => { if (e.target === boostBtn) return; e.preventDefault(); joyStart(e.clientX, e.clientY, "mouse"); });
window.addEventListener("mousemove", (e) => { if (joy.active && joy.id === "mouse") joyMove(e.clientX, e.clientY); });
window.addEventListener("mouseup", () => { if (joy.id === "mouse") joyEnd(); });

function boostOn(e) { e.preventDefault(); e.stopPropagation(); boostHeld = true; boostBtn.classList.add("active"); }
function boostOff(e) { if (e) e.stopPropagation(); boostHeld = false; boostBtn.classList.remove("active"); }
boostBtn.addEventListener("touchstart", boostOn, { passive: false });
boostBtn.addEventListener("touchend", boostOff);
boostBtn.addEventListener("touchcancel", boostOff);
boostBtn.addEventListener("mousedown", boostOn);
window.addEventListener("mouseup", boostOff);

function fitCanvas() {
  const fs = document.fullscreenElement === wrapper;
  if (!document.body.classList.contains("touch") && !fs) { canvas.style.width = ""; canvas.style.height = ""; return; }
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
  if (dx !== 0 || dy !== 0) { const len = Math.hypot(dx, dy); return { dx: dx / len, dy: dy / len, mag: 1, active: true }; }
  return { dx: 0, dy: 0, mag: 0, active: false };
}

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
  if (!hitsSolid(mower.x + vx * dt, mower.y, mower.radius)) mower.x += vx * dt; else hitWall = true;
  if (!hitsSolid(mower.x, mower.y + vy * dt, mower.radius)) mower.y += vy * dt; else hitWall = true;

  if (damageCooldown > 0) damageCooldown -= dt;
  if (hitWall && mower.speed > 120 && damageCooldown <= 0) {
    const dmg = Math.round(3 + (mower.speed / mower.maxSpeed) * 6);
    mower.health = Math.max(0, mower.health - dmg);
    score = Math.max(0, score - 5);
    damageCooldown = 0.6; mower.speed *= 0.2;
    if (mower.health <= 0) endGame(false);
  }

  if (mower.x !== prevX || mower.y !== prevY) {
    stampTrail(prevX, prevY, mower.x, mower.y);
    prevX = mower.x; prevY = mower.y;
  }

  if (flowerCd > 0) flowerCd -= dt;
  if (inBed(mower.x, mower.y) && flowerCd <= 0) {
    flowersDestroyed++; score = Math.max(0, score - 30); flowerCd = 0.5;
  }

  if (mowableTotal > 0 && mowedCount >= mowableTotal * 0.97) endGame(true);

  // Caméra : suit la tondeuse, clampée aux bords du monde
  cam.x = clamp(mower.x - viewW / 2, 0, WORLD_W - viewW);
  cam.y = clamp(mower.y - viewH / 2, 0, WORLD_H - viewH);
}

// ------------------------------------------------------------
//  Rendu (caméra : on blit la portion visible du monde)
// ------------------------------------------------------------
function draw() {
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(grassCanvas, cam.x, cam.y, viewW, viewH, 0, 0, canvas.width, canvas.height);
  ctx.drawImage(mowCanvas, cam.x, cam.y, viewW, viewH, 0, 0, canvas.width, canvas.height);
  ctx.drawImage(decorCanvas, cam.x, cam.y, viewW, viewH, 0, 0, canvas.width, canvas.height);
  drawMower();
}

function drawMower() {
  const sx = (mower.x - cam.x) * ZOOM;
  const sy = (mower.y - cam.y) * ZOOM;
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(mower.angle);
  ctx.scale(ZOOM, ZOOM); // dessin en unités-monde

  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.beginPath(); ctx.ellipse(2, 3, 20, 15, 0, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = damageCooldown > 0 ? "#ff7b5e" : "#d83a2f";
  mRoundRect(-18, -14, 34, 28, 7); ctx.fill();
  ctx.fillStyle = "#b32a22"; mRoundRect(5, -12, 14, 24, 5); ctx.fill();

  ctx.strokeStyle = "#e8e8e8"; ctx.lineWidth = 2.5;
  const t = performance.now() / 55;
  ctx.beginPath();
  ctx.moveTo(12 + Math.cos(t) * 7, Math.sin(t) * 7);
  ctx.lineTo(12 - Math.cos(t) * 7, -Math.sin(t) * 7); ctx.stroke();

  ctx.fillStyle = "#222"; mRoundRect(-16, -8, 9, 16, 3); ctx.fill();
  ctx.restore();
}
function mRoundRect(x, y, w, h, r) {
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
function coveragePct() { return mowableTotal ? Math.min(100, Math.round((mowedCount / mowableTotal) * 100)) : 0; }
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

function endGame(won) {
  state = won ? "won" : "lost";
  let stars = "";
  if (won) {
    let s = 1; if (flowersDestroyed === 0) s++; if (elapsed < 90) s++;
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
  el.overlayTitle.textContent = title; el.overlayText.textContent = text;
  el.overlayBtn.textContent = btn; el.overlay.classList.remove("hidden");
}
function hideOverlay() { el.overlay.classList.add("hidden"); }

// ------------------------------------------------------------
//  Boucle
// ------------------------------------------------------------
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  update(dt); draw(); updateHUD();
  requestAnimationFrame(loop);
}

// ------------------------------------------------------------
//  Démarrage
// ------------------------------------------------------------
buildWorld();
mower = makeMower();
keys = {};
state = "menu";
cam.x = clamp(mower.x - viewW / 2, 0, WORLD_W - viewW);
cam.y = clamp(mower.y - viewH / 2, 0, WORLD_H - viewH);
showOverlay(
  "🚜 Mow & Go",
  "Tonds toute la pelouse du jardin 🏡\nLa caméra suit la tondeuse : le jardin défile quand tu approches du bord.\nÉvite les massifs 🌸, la mare, les arbres et la maison.\n\n" +
  (isTouch ? "Pose ton pouce pour conduire · ⚡ Turbo" : "Déplacement : flèches ou ZQSD · Maj = turbo"),
  "Jouer"
);
fitCanvas();
requestAnimationFrame(loop);
