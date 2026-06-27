import * as THREE from 'three';
import { V3, Q, Y_UP, TAU, clamp01, lerp } from '../core/dynamics.js';
import { FIELD, terrainH, WORLD_SCALE } from './terrain.js';
import { addSphere, addBox, clearColliders } from './collision.js';
import { matStd } from '../materials.js';

const TOUCH = matchMedia('(pointer:coarse)').matches || 'ontouchstart' in window;

export class World {
  constructor(scene) {
    this.scene = scene;
    this.envGroup = new THREE.Group();
    scene.add(this.envGroup);
    clearColliders();
    this._lights();
    this._sky();
    this._terrain();
    this._environment();
    this._clouds();
    this._trees();
    this._village();
    this._flowers();
    this._grassClumps();
    this._dust();
  }

  _lights() {
    const s = this.scene;
    s.add(new THREE.HemisphereLight(0x87CEEB, 0xA08060, 1.4));
    s.add(new THREE.AmbientLight(0x4a4040, 0.2));
    const sun = new THREE.DirectionalLight(0xFFF4E0, 1.6);
    sun.position.set(40, 50, 30); sun.castShadow = true;
    sun.shadow.mapSize.set(TOUCH ? 1024 : 2048, TOUCH ? 1024 : 2048);
    sun.shadow.camera.near = 10; sun.shadow.camera.far = 240;
    sun.shadow.camera.left = -70; sun.shadow.camera.right = 70;
    sun.shadow.camera.top = 70; sun.shadow.camera.bottom = -70;
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.04;
    s.add(sun); s.add(sun.target); this.sun = sun;
    s.add(new THREE.DirectionalLight(0xFFE8CC, 0.25).position.set(-38, 22, -42));
  }

  _sky() {
    const c = document.createElement('canvas'); c.width = 16; c.height = 256;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#2860A0');
    g.addColorStop(0.3, '#3878C0');
    g.addColorStop(0.6, '#5098D8');
    g.addColorStop(0.85, '#78B8E8');
    g.addColorStop(1, '#A0D0F0');
    x.fillStyle = g; x.fillRect(0, 0, 16, 256);
    this.scene.background = new THREE.CanvasTexture(c);
    // Subtle distance haze — only fades far objects, doesn't block near view
    this.scene.fog = new THREE.Fog(0xC8DDE8, 180, 500);
  }

  _terrain() {
    const seg = TOUCH ? 180 : 240;
    const g = new THREE.PlaneGeometry(FIELD, FIELD, seg, seg); g.rotateX(-Math.PI / 2);
    const p = g.attributes.position; let mn = 1e9, mx = -1e9;
    for (let i = 0; i < p.count; i++) { const y = terrainH(p.getX(i), p.getZ(i)); p.setY(i, y); if (y < mn) mn = y; if (y > mx) mx = y; }
    g.computeVertexNormals();
    const col = [], n = g.attributes.normal, tmp = new THREE.Color();
    const cDeep = new THREE.Color(0x3A6A28), cGrass = new THREE.Color(0x4A8C3A),
          cLight = new THREE.Color(0x6DB356), cEarth = new THREE.Color(0x7A6848),
          cRock = new THREE.Color(0x5a5048), cPeak = new THREE.Color(0xC8B870);
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i), t = clamp01((y - mn) / (mx - mn + 1e-3)), sl = 1 - clamp01(n.getY(i));
      tmp.copy(cDeep).lerp(cGrass, clamp01(t * 2)).lerp(cLight, clamp01((t - 0.3) * 2.5))
        .lerp(cPeak, clamp01((t - 0.7) * 3)).lerp(cRock, clamp01((sl - 0.3) * 2.5))
        .lerp(cEarth, clamp01((0.15 - t) * 2) * 0.5);
      col.push(tmp.r, tmp.g, tmp.b);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    this.terrain = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.02 }));
    this.terrain.receiveShadow = true;
    this.scene.add(this.terrain);
  }

  _edgeLines(mesh, color, op) {
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), new THREE.LineBasicMaterial({ color, transparent: true, opacity: op || 0.3 }));
    e.position.copy(mesh.position); e.quaternion.copy(mesh.quaternion); e.scale.copy(mesh.scale); this.envGroup.add(e);
  }
  _boulder(x, z, r) {
    const y = terrainH(x, z);
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), this._matRock);
    m.position.set(x, y + r * 0.5, z); m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    m.castShadow = m.receiveShadow = true; this.envGroup.add(m);
    addSphere(V3(x, y + r * 0.5, z), r);
  }
  _box(cx, cy, cz, hx, hy, hz, q, color, emis) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2),
      matStd(color || 0x8A7E70, { emissive: emis || 0x000000, emissiveIntensity: emis ? 0.3 : 0 }));
    m.position.set(cx, cy, cz); if (q) m.quaternion.copy(q); m.castShadow = m.receiveShadow = true;
    this.envGroup.add(m); this._edgeLines(m, 0xc8a060, 0.2); addBox(V3(cx, cy, cz), V3(hx, hy, hz), q);
  }
  _pillar(x, z, w, h) { const y = terrainH(x, z); const q = Q().setFromAxisAngle(Y_UP, Math.random() * TAU); this._box(x, y + h - 0.4, z, w, h, w * 0.8, q, 0x5a4a3a); }

  _environment() {
    const S = WORLD_SCALE;
    this._matRock = matStd(0x8A7E70);
    const zx = 15 * S, zz = -13 * S; let yy = terrainH(zx, zz) - 0.4 * S;
    for (const t of [[10, 1.0, 10], [7.4, 1.0, 7.4], [5, 1.05, 5], [3, 1.1, 3]]) { const h = t[1] * S; this._box(zx, yy + h, zz, t[0] * 0.5 * S, h, t[2] * 0.5 * S, null, 0x6a5840); yy += h * 2; }
    const px = -17 * S, pz = 0;
    for (let i = 0; i < 6; i++) { const sx = px + (9 - i * 0.2) * S, sz = pz + (-5 + i * 2.0) * S, sy = terrainH(sx, sz) + (0.9 + i * 1.15) * S; this._box(sx, sy, sz, 1.7 * S, 0.9 * S, 1.3 * S, null, 0x5a4a38); }
    this._box(px, terrainH(px, pz) + 7.2 * S, pz, 7 * S, 0.6 * S, 6 * S, null, 0x5a4838);
    { const rx = 26 * S, rz = 8 * S, ry = terrainH(rx, rz); const q = Q().setFromAxisAngle(V3(0, 0, 1), 0.42); this._box(rx, ry + 2.1 * S, rz, 5.5 * S, 0.45 * S, 3 * S, q, 0x5a4838); }
    for (const p of [[-20, -6, 2.4, 5.2], [-38, -30, 2.6, 5.5], [40, -8, 2.4, 5.0], [3, 44, 2.6, 6.0], [44, 36, 2.8, 5.5]]) this._pillar(p[0] * S, p[1] * S, p[2] * S, p[3] * S);
    const gx = -6 * S, gz = 28 * S; const garden = []; let tries = 0;
    while (garden.length < 14 && tries < 500) {
      tries++; const a = Math.random() * TAU, rad = Math.random() * 12 * S; const x = gx + Math.cos(a) * rad, z = gz + Math.sin(a) * rad; const r = (1.4 + Math.random() * 1.7) * S;
      let ok = true; for (const q of garden) { if (Math.hypot(q[0] - x, q[1] - z) < q[2] + r + 1.6 * S) { ok = false; break; } }
      if (!ok) continue; garden.push([x, z, r]); this._boulder(x, z, r);
    }
    for (const s of [[30, -30, 2.4], [-44, 12, 2.2], [12, -34, 2.0], [-26, -22, 2.4], [34, 20, 2.1], [-40, 40, 2.6], [22, -18, 1.8]]) if (Math.hypot(s[0], s[1]) > 10) this._boulder(s[0] * S, s[1] * S, s[2] * S);
  }

  _clouds() {
    const c = document.createElement('canvas'); c.width = 128; c.height = 64;
    const x = c.getContext('2d');
    const grad = x.createRadialGradient(64, 32, 5, 64, 32, 50);
    grad.addColorStop(0, 'rgba(255,250,240,0.9)'); grad.addColorStop(0.6, 'rgba(255,245,230,0.4)'); grad.addColorStop(1, 'rgba(255,240,220,0)');
    x.fillStyle = grad; x.fillRect(0, 0, 128, 64);
    for (let i = 0; i < 5; i++) {
      const bx = 30 + Math.random() * 68, by = 20 + Math.random() * 24, br = 12 + Math.random() * 18;
      const g2 = x.createRadialGradient(bx, by, 2, bx, by, br);
      g2.addColorStop(0, 'rgba(255,252,245,0.7)'); g2.addColorStop(1, 'rgba(255,248,235,0)');
      x.fillStyle = g2; x.beginPath(); x.ellipse(bx, by, br, br * 0.6, 0, 0, Math.PI * 2); x.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    this.clouds = [];
    for (let i = 0; i < 25; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.8 + Math.random() * 0.15, depthWrite: false }));
      sp.position.set((Math.random() - 0.5) * 250, 50 + Math.random() * 30, (Math.random() - 0.5) * 250);
      const s = 12 + Math.random() * 18; sp.scale.set(s * 2, s, 1);
      sp.userData.speed = 0.3 + Math.random() * 0.5;
      this.scene.add(sp); this.clouds.push(sp);
    }
  }

  _trees() {
    const trunkMat = matStd(0x5A3A20);
    const leafMats = [matStd(0x5A9A40), matStd(0x3A7A28), matStd(0x2A5A18)];
    const treeData = []; let tries = 0;
    while (treeData.length < 40 && tries < 300) {
      tries++; const x = (Math.random() - 0.5) * FIELD * 0.8; const z = (Math.random() - 0.5) * FIELD * 0.8;
      if (Math.abs(x) < 12 && Math.abs(z) < 12) continue;
      const y = terrainH(x, z); const h = 1.5 + Math.random() * 3; const r = 0.6 + Math.random() * 1.0;
      treeData.push({ x, y, z, h, r });
    }
    for (const t of treeData) {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.15, t.h * 0.4, 5), trunkMat);
      trunk.position.set(t.x, t.y + t.h * 0.2, t.z); trunk.castShadow = true; this.envGroup.add(trunk);
      const leafMat = leafMats[Math.floor(Math.random() * leafMats.length)];
      for (let j = 0; j < 2 + Math.floor(Math.random() * 2); j++) {
        const coneH = t.h * (0.5 - j * 0.1); const coneR = t.r * (1 - j * 0.2);
        const cone = new THREE.Mesh(new THREE.ConeGeometry(coneR, coneH, 6), leafMat);
        cone.position.set(t.x, t.y + t.h * 0.4 + j * t.h * 0.2, t.z);
        cone.rotation.y = Math.random() * Math.PI; cone.castShadow = true; this.envGroup.add(cone);
      }
    }
  }

  _village() {
    const houseMats = [matStd(0xD4B888), matStd(0xC8A878), matStd(0xD4C098)];
    const roofMat = matStd(0x6A3020);
    const S = WORLD_SCALE;
    const houses = [
      { x: 16, z: 10, w: 2.5, d: 2.5, h: 2.0 }, { x: 19, z: 12, w: 2.8, d: 2.5, h: 2.0 },
      { x: 18, z: 8, w: 2.2, d: 2.0, h: 2.2 }, { x: 15, z: 13, w: 3.0, d: 2.5, h: 1.8 },
      { x: -14, z: 16, w: 2.5, d: 2.2, h: 2.0 }, { x: -16, z: 14, w: 2.0, d: 2.0, h: 1.8 },
      { x: 22, z: -10, w: 2.5, d: 2.5, h: 2.0 }, { x: 24, z: -8, w: 3.0, d: 2.5, h: 2.5 },
    ];
    for (const h of houses) {
      const y = terrainH(h.x * S, h.z * S);
      const mat = houseMats[Math.floor(Math.random() * houseMats.length)];
      const wall = new THREE.Mesh(new THREE.BoxGeometry(h.w * S, h.h * S, h.d * S), mat);
      wall.position.set(h.x * S, y + h.h * S * 0.5, h.z * S);
      wall.rotation.y = Math.random() * 0.3; wall.castShadow = wall.receiveShadow = true; this.envGroup.add(wall);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(h.w, h.d) * S * 0.75, h.h * S * 0.6, 4), roofMat);
      roof.position.set(h.x * S, y + h.h * S + h.h * S * 0.3, h.z * S);
      roof.rotation.y = Math.PI / 4 + Math.random() * 0.3; roof.castShadow = true; this.envGroup.add(roof);
    }
  }

  _flowers() {
    const colors = [0xE85050, 0xF0C040, 0xFFFFFF, 0xCC80FF, 0xFF80AA, 0xFF6040, 0x40C0FF];
    for (let i = 0; i < 100; i++) {
      const x = (Math.random() - 0.5) * FIELD * 0.7; const z = (Math.random() - 0.5) * FIELD * 0.7;
      if (Math.abs(x) < 15 && Math.abs(z) < 15) continue;
      const y = terrainH(x, z); const c = colors[Math.floor(Math.random() * colors.length)];
      const flower = new THREE.Mesh(new THREE.SphereGeometry(0.25 + Math.random() * 0.15, 6, 4), matStd(c, { emissive: c, emissiveIntensity: 0.15 }));
      flower.position.set(x, y + 0.1, z); flower.scale.y = 0.6; this.envGroup.add(flower);
    }
  }

  _grassClumps() {
    const grassMat = matStd(0x5A9A38);
    for (let i = 0; i < 80; i++) {
      const x = (Math.random() - 0.5) * FIELD * 0.7; const z = (Math.random() - 0.5) * FIELD * 0.7;
      if (Math.abs(x) < 12 && Math.abs(z) < 12) continue;
      const y = terrainH(x, z); const h = 0.3 + Math.random() * 0.4;
      const clump = new THREE.Mesh(new THREE.ConeGeometry(0.18, h, 4), grassMat);
      clump.position.set(x, y + h * 0.5, z); clump.rotation.y = Math.random() * Math.PI; this.envGroup.add(clump);
    }
  }

  updateClouds(dt) {
    if (!this.clouds) return;
    for (const c of this.clouds) { c.position.x += c.userData.speed * dt; if (c.position.x > 120) c.position.x = -120; }
  }

  _dust() {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(32, 32, 1, 32, 32, 31);
    g.addColorStop(0, 'rgba(220,200,170,.7)'); g.addColorStop(1, 'rgba(220,200,170,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    this.dust = [];
    for (let i = 0; i < 26; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
      s.visible = false; this.scene.add(s); this.dust.push({ s, life: 1, max: 0.45, scl: 1 });
    }
    this._dustI = 0;
  }
  puff(pos) {
    const d = this.dust[this._dustI = (this._dustI + 1) % this.dust.length];
    d.s.position.copy(pos); d.life = 0; d.max = 0.4 + Math.random() * 0.2; d.scl = 0.7 + Math.random() * 0.6;
    d.s.visible = true; d.s.material.opacity = 0.5;
  }
  updateDust(dt) {
    for (const d of this.dust) {
      if (!d.s.visible) continue; d.life += dt; const t = d.life / d.max;
      if (t >= 1) { d.s.visible = false; continue; }
      d.s.scale.setScalar(lerp(0.4, 2.2, t) * d.scl); d.s.material.opacity = 0.5 * (1 - t);
    }
  }
}
