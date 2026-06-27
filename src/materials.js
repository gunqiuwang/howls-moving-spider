import * as THREE from 'three';

function canvas2d(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  return { c, x: c.getContext('2d'), w, h };
}
function tex(c) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
}
function mulberry32(a) { return function() { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function pick(colors, rng) {
  const base = colors[Math.floor(rng() * colors.length)];
  const r = (base >> 16) & 0xff, g = (base >> 8) & 0xff, b = base & 0xff;
  const v = 0.85 + rng() * 0.3;
  return `rgb(${Math.min(255, r * v | 0)},${Math.min(255, g * v | 0)},${Math.min(255, b * v | 0)})`;
}

export function makeRustRivetTexture(seed = 42) {
  const { c, x, w, h } = canvas2d(512, 512); const rng = mulberry32(seed);
  x.fillStyle = '#7a6a55'; x.fillRect(0, 0, w, h);
  for (let i = 0; i < 40; i++) {
    const rx = rng() * w, ry = rng() * h, rr = 15 + rng() * 50;
    const grad = x.createRadialGradient(rx, ry, 0, rx, ry, rr);
    const rv = 0.6 + rng() * 0.8;
    grad.addColorStop(0, `rgba(${180 * rv | 0},${100 * rv | 0},${40 * rv | 0},0.4)`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = grad; x.fillRect(rx - rr, ry - rr, rr * 2, rr * 2);
  }
  for (let i = 0; i < 20; i++) {
    x.strokeStyle = `rgba(${60 + rng() * 40 | 0},${50 + rng() * 30 | 0},${30 + rng() * 20 | 0},${0.12 + rng() * 0.1})`;
    x.lineWidth = 0.5 + rng() * 1.5; x.beginPath(); x.moveTo(rng() * w, rng() * h); x.lineTo(rng() * w, rng() * h); x.stroke();
  }
  for (let row = 0; row < 16; row++) for (let col = 0; col < 16; col++) {
    const rx = col * 32 + 16 + (rng() - 0.5) * 8, ry = row * 32 + 16 + (rng() - 0.5) * 8, r = 2 + rng() * 1.5;
    x.fillStyle = 'rgba(0,0,0,0.25)'; x.beginPath(); x.arc(rx + 0.5, ry + 0.5, r + 0.5, 0, Math.PI * 2); x.fill();
    const rv = 0.7 + rng() * 0.4;
    x.fillStyle = `rgb(${140 * rv | 0},${120 * rv | 0},${90 * rv | 0})`;
    x.beginPath(); x.arc(rx, ry, r, 0, Math.PI * 2); x.fill();
    x.fillStyle = 'rgba(255,240,200,0.12)'; x.beginPath(); x.arc(rx - 0.5, ry - 0.5, r * 0.5, 0, Math.PI * 2); x.fill();
  }
  const imgData = x.getImageData(0, 0, w, h);
  for (let i = 0; i < imgData.data.length; i += 4) { const n = (rng() - 0.5) * 12; imgData.data[i] += n; imgData.data[i+1] += n; imgData.data[i+2] += n; }
  x.putImageData(imgData, 0, 0); return tex(c);
}

export function makeOldWoodTexture(seed = 77) {
  const { c, x, w, h } = canvas2d(256, 256); const rng = mulberry32(seed);
  x.fillStyle = '#8a6a40'; x.fillRect(0, 0, w, h);
  for (let i = 0; i < 80; i++) { const y = rng() * h; x.strokeStyle = `rgba(${40 + rng() * 40 | 0},${25 + rng() * 20 | 0},${10 + rng() * 10 | 0},${0.1 + rng() * 0.15})`; x.lineWidth = 0.5 + rng() * 2; x.beginPath(); x.moveTo(0, y); for (let px = 0; px < w; px += 6) x.lineTo(px, y + (rng() - 0.5) * 4); x.stroke(); }
  for (let i = 1; i < 4; i++) { const px = i * w / 4 + (rng() - 0.5) * 6; x.fillStyle = 'rgba(0,0,0,0.2)'; x.fillRect(px - 1, 0, 2, h); }
  return tex(c);
}

export function makeRoofTexture(seed = 55) {
  const { c, x, w, h } = canvas2d(256, 256); const rng = mulberry32(seed);
  x.fillStyle = '#5a3018'; x.fillRect(0, 0, w, h);
  const tw = 24, th = 14;
  for (let row = 0; row < h / th + 1; row++) { const off = (row % 2) * (tw / 2); for (let col = -1; col < w / tw + 1; col++) { const tx = col * tw + off, ty = row * th; const v = 0.7 + rng() * 0.5; x.fillStyle = `rgb(${75 * v | 0},${40 * v | 0},${20 * v | 0})`; x.beginPath(); x.ellipse(tx + tw / 2, ty + th / 2, tw / 2 - 1, th / 2 - 1, 0, 0, Math.PI * 2); x.fill(); } }
  return tex(c);
}

export function makeStoneTexture(seed = 123) {
  const { c, x, w, h } = canvas2d(256, 256); const rng = mulberry32(seed);
  const colors = [0x8a8070, 0x9a9080, 0x7a7065, 0xa09888, 0x6a6258];
  x.fillStyle = '#6a6055'; x.fillRect(0, 0, w, h);
  for (let i = 0; i < 25; i++) { const sx = rng() * w, sy = rng() * h, sw = 25 + rng() * 50, sh = 18 + rng() * 35; x.fillStyle = pick(colors, rng); x.fillRect(sx, sy, sw, sh); x.strokeStyle = 'rgba(0,0,0,0.15)'; x.lineWidth = 1; x.strokeRect(sx, sy, sw, sh); }
  const imgData = x.getImageData(0, 0, w, h);
  for (let i = 0; i < imgData.data.length; i += 4) { const n = (rng() - 0.5) * 16; imgData.data[i] += n; imgData.data[i+1] += n; imgData.data[i+2] += n; }
  x.putImageData(imgData, 0, 0); return tex(c);
}

export function matFromTexture(texture, opts = {}) {
  return new THREE.MeshStandardMaterial({ map: texture, roughness: opts.roughness ?? 0.85, metalness: opts.metalness ?? 0.15, emissive: opts.emissive || 0x000000, emissiveIntensity: opts.emissiveIntensity ?? 0, transparent: opts.transparent ?? false, opacity: opts.opacity ?? 1, flatShading: opts.flat ?? false, ...opts });
}
export function matStd(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: opts.roughness ?? 0.75, metalness: opts.metalness ?? 0.2, emissive: opts.emissive || 0x000000, emissiveIntensity: opts.emissiveIntensity ?? 0, flatShading: opts.flat ?? false, ...opts });
}

let _cache = null;
export function getMaterials() {
  if (_cache) return _cache;
  const rustTex = makeRustRivetTexture(42);
  const woodTex = makeOldWoodTexture(77);
  const roofTex = makeRoofTexture(55);
  const stoneTex = makeStoneTexture(123);
  _cache = {
    rustIron:   matFromTexture(rustTex, { roughness: 0.78, metalness: 0.25 }),
    oldWood:    matFromTexture(woodTex, { roughness: 0.88, metalness: 0.05 }),
    roofTile:   matFromTexture(roofTex, { roughness: 0.82, metalness: 0.1 }),
    stoneBase:  matFromTexture(stoneTex, { roughness: 0.9, metalness: 0.08 }),
    darkGlass:  matStd(0x3a3a3a, { roughness: 0.3, metalness: 0.4, transparent: true, opacity: 0.7, emissive: 0x2a2a2a, emissiveIntensity: 0.15 }),
    steel:      matStd(0x8a7a65, { roughness: 0.6, metalness: 0.5 }),
    darkInterior: matStd(0x1a1208, { roughness: 0.95, metalness: 0.05 }),
    windowGlow: matStd(0xFFB347, { emissive: 0xFFA030, emissiveIntensity: 0.8 }),
    darkIron:   matStd(0x5a5040, { roughness: 0.65, metalness: 0.4 }),
    legArmor:   matFromTexture(rustTex, { roughness: 0.78, metalness: 0.25 }),
    clawSteel:  matStd(0x7a6a55, { roughness: 0.55, metalness: 0.5 }),
    gearIron:   matStd(0x5a4e38, { roughness: 0.6, metalness: 0.45 }),
  };
  return _cache;
}
