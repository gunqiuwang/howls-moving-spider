import * as THREE from 'three';

// Procedural canvas texture generators for Howl's Moving Castle.
function canvas2d(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  return { c, x: c.getContext('2d'), w, h };
}
function tex(c) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function pick(colors, rng) {
  const base = colors[Math.floor(rng() * colors.length)];
  const r = (base >> 16) & 0xff, g = (base >> 8) & 0xff, b = base & 0xff;
  const v = 0.85 + rng() * 0.3;
  return `rgb(${Math.min(255, r * v | 0)},${Math.min(255, g * v | 0)},${Math.min(255, b * v | 0)})`;
}
function mulberry32(a) { return function() { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

export function makeBrickTexture(seed = 42) {
  const { c, x, w, h } = canvas2d(256, 256); const rng = mulberry32(seed);
  const brickW = 32, brickH = 16, mortar = 2;
  const colors = [0x8a6540, 0x7a5535, 0x9a7050, 0x6a4a30, 0xa07858];
  x.fillStyle = '#5a4a38'; x.fillRect(0, 0, w, h);
  for (let row = 0; row < h / brickH; row++) { const off = (row % 2) * (brickW / 2); for (let col = -1; col < w / brickW + 1; col++) { const bx = col * brickW + off, by = row * brickH; x.fillStyle = pick(colors, rng); x.fillRect(bx + mortar, by + mortar, brickW - mortar * 2, brickH - mortar * 2); x.fillStyle = 'rgba(255,255,255,0.06)'; x.fillRect(bx + mortar, by + mortar, brickW - mortar * 2, 2); x.fillStyle = 'rgba(0,0,0,0.1)'; x.fillRect(bx + mortar, by + brickH - mortar - 2, brickW - mortar * 2, 2); } }
  const imgData = x.getImageData(0, 0, w, h); for (let i = 0; i < imgData.data.length; i += 4) { const n = (rng() - 0.5) * 18; imgData.data[i] += n; imgData.data[i+1] += n; imgData.data[i+2] += n; } x.putImageData(imgData, 0, 0);
  return tex(c);
}
export function makeStoneTexture(seed = 123) {
  const { c, x, w, h } = canvas2d(256, 256); const rng = mulberry32(seed);
  const colors = [0x7a7065, 0x8a8070, 0x6a6258, 0x9a9080, 0x5a5548];
  x.fillStyle = '#4a4438'; x.fillRect(0, 0, w, h);
  for (let i = 0; i < 20; i++) { const sx = rng() * w, sy = rng() * h; const sw = 30 + rng() * 60, sh = 20 + rng() * 40; x.fillStyle = pick(colors, rng); x.fillRect(sx, sy, sw, sh); x.strokeStyle = 'rgba(0,0,0,0.15)'; x.lineWidth = 1; x.strokeRect(sx, sy, sw, sh); }
  const imgData = x.getImageData(0, 0, w, h); for (let i = 0; i < imgData.data.length; i += 4) { const n = (rng() - 0.5) * 22; imgData.data[i] += n; imgData.data[i+1] += n; imgData.data[i+2] += n; } x.putImageData(imgData, 0, 0);
  return tex(c);
}
export function makeWoodTexture(seed = 77) {
  const { c, x, w, h } = canvas2d(256, 256); const rng = mulberry32(seed);
  const grad = x.createLinearGradient(0, 0, w, 0); grad.addColorStop(0, '#6a4a2a'); grad.addColorStop(0.5, '#8a6038'); grad.addColorStop(1, '#6a4a2a'); x.fillStyle = grad; x.fillRect(0, 0, w, h);
  for (let i = 0; i < 60; i++) { const y = rng() * h; x.strokeStyle = `rgba(${40 + rng() * 40 | 0},${20 + rng() * 20 | 0},${5 + rng() * 10 | 0},${0.1 + rng() * 0.2})`; x.lineWidth = 0.5 + rng() * 1.5; x.beginPath(); x.moveTo(0, y); for (let px = 0; px < w; px += 8) x.lineTo(px, y + (rng() - 0.5) * 3); x.stroke(); }
  for (let i = 1; i < 4; i++) { const px = i * w / 4 + (rng() - 0.5) * 8; x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(px - 1, 0, 2, h); }
  return tex(c);
}
export function makeRoofTexture(seed = 55) {
  const { c, x, w, h } = canvas2d(256, 256); const rng = mulberry32(seed);
  x.fillStyle = '#3a2818'; x.fillRect(0, 0, w, h);
  const tileW = 24, tileH = 14;
  for (let row = 0; row < h / tileH + 1; row++) { const off = (row % 2) * (tileW / 2); for (let col = -1; col < w / tileW + 1; col++) { const tx = col * tileW + off, ty = row * tileH; const v = 0.8 + rng() * 0.4; x.fillStyle = `rgb(${60 * v | 0},${38 * v | 0},${22 * v | 0})`; x.beginPath(); x.ellipse(tx + tileW / 2, ty + tileH / 2, tileW / 2 - 1, tileH / 2 - 1, 0, 0, Math.PI * 2); x.fill(); } }
  return tex(c);
}
export function makeRustTexture(seed = 99) {
  const { c, x, w, h } = canvas2d(256, 256); const rng = mulberry32(seed);
  x.fillStyle = '#5a4a38'; x.fillRect(0, 0, w, h);
  for (let i = 0; i < 30; i++) { const rx = rng() * w, ry = rng() * h, rr = 8 + rng() * 25; const grad = x.createRadialGradient(rx, ry, 0, rx, ry, rr); const rv = 0.7 + rng() * 0.6; grad.addColorStop(0, `rgba(${120 * rv | 0},${60 * rv | 0},${20 * rv | 0},0.4)`); grad.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = grad; x.fillRect(rx - rr, ry - rr, rr * 2, rr * 2); }
  const imgData = x.getImageData(0, 0, w, h); for (let i = 0; i < imgData.data.length; i += 4) { const n = (rng() - 0.5) * 16; imgData.data[i] += n; imgData.data[i+1] += n; imgData.data[i+2] += n; } x.putImageData(imgData, 0, 0);
  return tex(c);
}
export function makePlasterTexture(seed = 33) {
  const { c, x, w, h } = canvas2d(256, 256); const rng = mulberry32(seed);
  x.fillStyle = '#c8b898'; x.fillRect(0, 0, w, h);
  const imgData = x.getImageData(0, 0, w, h); for (let i = 0; i < imgData.data.length; i += 4) { const n = (rng() - 0.5) * 30; imgData.data[i] += n; imgData.data[i+1] += n - 3; imgData.data[i+2] += n - 8; } x.putImageData(imgData, 0, 0);
  return tex(c);
}
export function texturedMat(texture, opts = {}) {
  return new THREE.MeshStandardMaterial({ map: texture, roughness: opts.r ?? 0.85, metalness: opts.m ?? 0.1, emissive: opts.e || 0x000000, emissiveIntensity: opts.ei ?? 0, flatShading: opts.flat ?? false, ...opts });
}

// ============================================================
//  GHIBLI TOON MATERIAL SYSTEM
// ============================================================
export function makeGradientMap(steps = 3) {
  const c = document.createElement('canvas'); c.width = steps; c.height = 1;
  const x = c.getContext('2d');
  for (let i = 0; i < steps; i++) { const v = Math.round((i / (steps - 1)) * 255); x.fillStyle = `rgb(${v},${v},${v})`; x.fillRect(i, 0, 1, 1); }
  const t = new THREE.CanvasTexture(c);
  t.minFilter = THREE.NearestFilter; t.magFilter = THREE.NearestFilter;
  return t;
}
export const THREE_TONE = makeGradientMap(3);
export const FIVE_TONE = makeGradientMap(5);

export function toonMat(color, opts = {}) {
  return new THREE.MeshToonMaterial({
    color,
    gradientMap: opts.gradientMap || FIVE_TONE,
    emissive: opts.emissive || 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 0,
    ...opts,
  });
}

// ============================================================
//  GHIBLI COLOR PALETTE
// ============================================================
export const GHIBLI = {
  castleWall:    0x8B6E4E, castleBrick: 0x7A5A3A, castleStone: 0x8A7E70,
  castleWood:    0x6A4A2A, castleRoof:  0x5A2E1E, castleIron:  0x4A3E30,
  castleRust:    0x6A4828,
  eyeGlow:       0x44CC88, eyeRim:      0x3A3028,
  mouthDark:     0x1A1208, toothBone:   0xD4C8A8,
  skyTop:        0x5A9AD9, skyBottom:   0xADD8F0, fog: 0xB0D4E8,
  sunLight:      0xFFF4E0, hemiSky:     0x87CEEB, hemiGround: 0x8B7355,
  grassLight:    0x6DB356, grassMid:    0x4A8C3A, grassDark:  0x3A6A28,
  hillTop:       0xC8B870, earth:       0x7A6848,
  leafLight:     0x5A9A40, leafMid:     0x3A7A28, leafDark:   0x2A5A18,
  trunk:         0x5A3A20,
  houseWall:     0xD4B888, houseRoof:   0x6A3020,
  calciferRed:   0xE85030, windowGlow:  0xFFB347, steamWhite: 0xE8E0D0,
};
