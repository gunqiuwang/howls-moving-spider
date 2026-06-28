import * as THREE from 'three';
import { V3, Q, Y_UP, TAU, clamp01, lerp } from '../core/dynamics.js';
import { FIELD, terrainH, WORLD_SCALE } from './terrain.js';
import { addSphere, addBox, clearColliders } from './collision.js';
import { matStd } from '../materials.js';

const TOUCH = matchMedia('(pointer:coarse)').matches || 'ontouchstart' in window;

export class World {
  constructor(scene) {
    this.scene = scene;
    this.envGroup = new THREE.Group(); scene.add(this.envGroup);
    clearColliders();
    this._lights(); this._sky(); this._terrain(); this._environment();
    this._clouds(); this._trees(); this._village(); this._flowers(); this._grassClumps();
    this._windmill(); this._well(); this._fences(); this._bushes();
    this._pond(); this._paths(); this._butterflies(); this._birds(); this._ribbons();
    this._hatShop(); this._dust();
  }

  _lights() {
    const s = this.scene;
    s.add(new THREE.HemisphereLight(0xb8dcff, 0xb58a52, 1.08));
    s.add(new THREE.AmbientLight(0x6a5138, 0.22));
    const sun = new THREE.DirectionalLight(0xffd28a, 1.45);
    sun.position.set(42, 34, 28); sun.castShadow = true;
    sun.shadow.mapSize.set(TOUCH ? 1024 : 2048, TOUCH ? 1024 : 2048);
    sun.shadow.camera.near = 10; sun.shadow.camera.far = 240;
    sun.shadow.camera.left = -70; sun.shadow.camera.right = 70; sun.shadow.camera.top = 70; sun.shadow.camera.bottom = -70;
    sun.shadow.bias = -0.00045; sun.shadow.normalBias = 0.075;
    s.add(sun); s.add(sun.target); this.sun = sun;
    const fill = new THREE.DirectionalLight(0xffead0, 0.34);
    fill.position.set(-38, 24, -42);
    s.add(fill);
  }

  _sky() {
    const c = document.createElement('canvas'); c.width = 512; c.height = 512;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, '#5f96cf'); g.addColorStop(0.28, '#8ebce0');
    g.addColorStop(0.55, '#c8dfeb'); g.addColorStop(0.76, '#f2d7a7');
    g.addColorStop(0.92, '#f3b878'); g.addColorStop(1, '#d88d54');
    x.fillStyle = g; x.fillRect(0, 0, 512, 512);
    const sunX = 380, sunY = 380, sunR = 60;
    const sg = x.createRadialGradient(sunX, sunY, 0, sunX, sunY, sunR * 3);
    sg.addColorStop(0, 'rgba(255,244,210,0.68)'); sg.addColorStop(0.36, 'rgba(255,214,148,0.34)');
    sg.addColorStop(0.75, 'rgba(255,188,112,0.12)'); sg.addColorStop(1, 'rgba(255,170,80,0)');
    x.fillStyle = sg; x.beginPath(); x.arc(sunX, sunY, sunR * 3, 0, Math.PI * 2); x.fill();
    const sc = x.createRadialGradient(sunX, sunY, 0, sunX, sunY, sunR);
    sc.addColorStop(0, 'rgba(255,255,240,1)'); sc.addColorStop(0.5, 'rgba(255,240,200,0.9)'); sc.addColorStop(1, 'rgba(255,220,150,0)');
    x.fillStyle = sc; x.beginPath(); x.arc(sunX, sunY, sunR, 0, Math.PI * 2); x.fill();
    const h = x.createLinearGradient(0, 400, 0, 512);
    h.addColorStop(0, 'rgba(255,220,160,0)'); h.addColorStop(0.5, 'rgba(255,206,128,0.22)'); h.addColorStop(1, 'rgba(255,186,104,0.42)');
    x.fillStyle = h; x.fillRect(0, 400, 512, 112);
    this.scene.background = new THREE.CanvasTexture(c);
    this.scene.fog = new THREE.FogExp2(0xc8d8dc, 0.0035);
  }

  _terrain() {
    const seg = TOUCH ? 180 : 240;
    const g = new THREE.PlaneGeometry(FIELD, FIELD, seg, seg); g.rotateX(-Math.PI / 2);
    const p = g.attributes.position; let mn = 1e9, mx = -1e9;
    for (let i = 0; i < p.count; i++) { const y = terrainH(p.getX(i), p.getZ(i)); p.setY(i, y); if (y < mn) mn = y; if (y > mx) mx = y; }
    g.computeVertexNormals();
    const col = [], n = g.attributes.normal, tmp = new THREE.Color();
    const cD = new THREE.Color(0x476b2d), cG = new THREE.Color(0x6f9650), cL = new THREE.Color(0xa1b96b),
          cE = new THREE.Color(0x91714f), cR = new THREE.Color(0x74655a), cP = new THREE.Color(0xd4bf79);
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i), t = clamp01((y - mn) / (mx - mn + 1e-3)), sl = 1 - clamp01(n.getY(i));
      tmp.copy(cD).lerp(cG, clamp01(t * 2)).lerp(cL, clamp01((t - 0.3) * 2.5)).lerp(cP, clamp01((t - 0.7) * 3)).lerp(cR, clamp01((sl - 0.3) * 2.5)).lerp(cE, clamp01((0.15 - t) * 2) * 0.5);
      col.push(tmp.r, tmp.g, tmp.b);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    this.terrain = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.02 }));
    this.terrain.receiveShadow = true; this.scene.add(this.terrain);
  }

  _edgeLines(mesh, color, op) {
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), new THREE.LineBasicMaterial({ color, transparent: true, opacity: op || 0.3 }));
    e.position.copy(mesh.position); e.quaternion.copy(mesh.quaternion); e.scale.copy(mesh.scale); this.envGroup.add(e);
  }
  _boulder(x, z, r) {
    const y = terrainH(x, z); const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), this._matRock);
    m.position.set(x, y + r * 0.5, z); m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    m.castShadow = m.receiveShadow = true; this.envGroup.add(m); addSphere(V3(x, y + r * 0.5, z), r);
  }
  _box(cx, cy, cz, hx, hy, hz, q, color, emis) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2),
      matStd(color || 0x8A7E70, { emissive: emis || 0x000000, emissiveIntensity: emis ? 0.3 : 0 }));
    m.position.set(cx, cy, cz); if (q) m.quaternion.copy(q); m.castShadow = m.receiveShadow = true;
    this.envGroup.add(m); this._edgeLines(m, 0xc8a060, 0.2); addBox(V3(cx, cy, cz), V3(hx, hy, hz), q);
  }
  _pillar(x, z, w, h) {
    const y = terrainH(x, z);
    const layers = Math.max(2, Math.round(h / (1.7 * WORLD_SCALE)));
    for (let i = 0; i < layers; i++) {
      const r = w * (0.92 - i * 0.12);
      const yy = y + r * 0.45 + i * r * 0.7;
      const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(Math.max(w * 0.36, r), 1), this._matRock);
      rock.position.set(x + (Math.random() - 0.5) * w * 0.36, yy, z + (Math.random() - 0.5) * w * 0.36);
      rock.scale.set(1.05, 0.62 + Math.random() * 0.25, 0.86 + Math.random() * 0.3);
      rock.rotation.set(Math.random() * 0.6, Math.random() * TAU, Math.random() * 0.35);
      rock.castShadow = rock.receiveShadow = true; this.envGroup.add(rock);
    }
    addSphere(V3(x, y + h * 0.42, z), Math.max(w * 0.95, h * 0.28));
  }

  _environment() {
    const S = WORLD_SCALE; this._matRock = matStd(0x8A7E70);
    const zx = 15 * S, zz = -13 * S; let yy = terrainH(zx, zz) - 0.4 * S;
    for (const t of [[4.6, 1.0, 0, 0], [3.4, 0.88, 2.2, 0.8], [2.7, 0.76, -1.6, -1.0], [2.0, 0.68, 0.5, 2.0]]) {
      const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(t[0] * S, 1), this._matRock);
      rock.position.set(zx + t[2] * S, yy + t[0] * S * 0.38, zz + t[3] * S);
      rock.scale.set(1.18, t[1] * 0.55, 0.92);
      rock.rotation.set(0.1, Math.random() * TAU, -0.08);
      rock.castShadow = rock.receiveShadow = true; this.envGroup.add(rock);
      yy += t[0] * S * 0.32;
    }
    addSphere(V3(zx, terrainH(zx, zz) + 3.2 * S, zz), 5.2 * S);
    const px = -17 * S, pz = 0;
    for (let i = 0; i < 6; i++) {
      const sx = px + (8.5 - i * 0.35) * S, sz = pz + (-5 + i * 1.9) * S;
      this._boulder(sx, sz, (1.1 + i * 0.16) * S);
    }
    for (const p of [[-20, -6, 1.8, 3.4], [-38, -30, 1.9, 3.2], [40, -8, 1.7, 3.0], [3, 44, 1.9, 3.6], [44, 36, 1.8, 3.1]]) this._pillar(p[0] * S, p[1] * S, p[2] * S, p[3] * S);
    const gx = -6 * S, gz = 28 * S; const garden = []; let tries = 0;
    while (garden.length < 14 && tries < 500) {
      tries++; const a = Math.random() * TAU, rad = Math.random() * 12 * S; const x = gx + Math.cos(a) * rad, z = gz + Math.sin(a) * rad; const r = (1.4 + Math.random() * 1.7) * S;
      let ok = true; for (const q of garden) { if (Math.hypot(q[0] - x, q[1] - z) < q[2] + r + 1.6 * S) { ok = false; break; } }
      if (!ok) continue; garden.push([x, z, r]); this._boulder(x, z, r);
    }
    for (const s of [[30, -30, 2.4], [-44, 12, 2.2], [12, -34, 2.0], [-26, -22, 2.4], [34, 20, 2.1], [-40, 40, 2.6], [22, -18, 1.8]]) if (Math.hypot(s[0], s[1]) > 10) this._boulder(s[0] * S, s[1] * S, s[2] * S);
  }

  _clouds() {
    const c = document.createElement('canvas'); c.width = 256; c.height = 128;
    const x = c.getContext('2d'); x.clearRect(0, 0, 256, 128);
    const blobs = [{ x: 128, y: 64, rx: 80, ry: 35 }, { x: 90, y: 58, rx: 50, ry: 28 }, { x: 170, y: 60, rx: 55, ry: 30 },
      { x: 110, y: 50, rx: 40, ry: 22 }, { x: 150, y: 52, rx: 45, ry: 24 }, { x: 70, y: 65, rx: 35, ry: 20 }, { x: 190, y: 68, rx: 38, ry: 22 }];
    for (const b of blobs) {
      const grad = x.createRadialGradient(b.x, b.y - 5, 0, b.x, b.y, b.rx);
      grad.addColorStop(0, 'rgba(255,252,238,0.88)'); grad.addColorStop(0.42, 'rgba(255,241,216,0.62)');
      grad.addColorStop(0.72, 'rgba(246,224,204,0.28)'); grad.addColorStop(1, 'rgba(246,224,204,0)');
      x.fillStyle = grad; x.beginPath(); x.ellipse(b.x, b.y, b.rx, b.ry, 0, 0, Math.PI * 2); x.fill();
    }
    const tex = new THREE.CanvasTexture(c); this.clouds = [];
    for (let i = 0; i < 30; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.7 + Math.random() * 0.2, depthWrite: false }));
      sp.position.set((Math.random() - 0.5) * 300, 50 + Math.random() * 30, (Math.random() - 0.5) * 300);
      const s = 12 + Math.random() * 18; sp.scale.set(s * 2, s, 1); sp.userData.speed = 0.2 + Math.random() * 0.4;
      this.scene.add(sp); this.clouds.push(sp);
    }
  }

  _trees() {
    const trunkMat = matStd(0x5A3A20);
    const leafMats = [matStd(0x5A9A40), matStd(0x3A7A28), matStd(0x2A5A18)];
    const treeData = []; let tries = 0;
    while (treeData.length < 50 && tries < 400) {
      tries++; const x = (Math.random() - 0.5) * FIELD * 0.8, z = (Math.random() - 0.5) * FIELD * 0.8;
      if (Math.abs(x) < 12 && Math.abs(z) < 12) continue;
      const y = terrainH(x, z), h = 1.5 + Math.random() * 3.5, r = 0.5 + Math.random() * 1.2;
      treeData.push({ x, y, z, h, r });
    }
    for (const t of treeData) {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.15, t.h * 0.4, 5), trunkMat);
      trunk.position.set(t.x, t.y + t.h * 0.2, t.z); trunk.castShadow = true; this.envGroup.add(trunk);
      const leafMat = leafMats[Math.floor(Math.random() * leafMats.length)];
      for (let j = 0; j < 2 + Math.floor(Math.random() * 2); j++) {
        const coneH = t.h * (0.5 - j * 0.08), coneR = t.r * (1 - j * 0.15);
        const cone = new THREE.Mesh(new THREE.ConeGeometry(coneR, coneH, 6), leafMat);
        cone.position.set(t.x, t.y + t.h * 0.4 + j * t.h * 0.18, t.z);
        cone.rotation.y = Math.random() * Math.PI; cone.castShadow = true; this.envGroup.add(cone);
      }
    }
  }

  _village() {
    const houseMats = [matStd(0xD4B888), matStd(0xC8A878), matStd(0xD4C098)];
    const roofMat = matStd(0x6A3020); const windowMat = matStd(0xFFC36A, { emissive: 0xFF9A2A, emissiveIntensity: 0.55 });
    const beamMat = matStd(0x6a4a2a); const S = WORLD_SCALE;
    const houses = [
      { x: 16, z: 10, w: 2.5, d: 2.5, h: 2.0 }, { x: 19, z: 12, w: 2.8, d: 2.5, h: 2.0 },
      { x: 18, z: 8, w: 2.2, d: 2.0, h: 2.2 }, { x: 15, z: 13, w: 3.0, d: 2.5, h: 1.8 },
      { x: -14, z: 16, w: 2.5, d: 2.2, h: 2.0 }, { x: -16, z: 14, w: 2.0, d: 2.0, h: 1.8 },
      { x: 22, z: -10, w: 2.5, d: 2.5, h: 2.0 }, { x: 24, z: -8, w: 3.0, d: 2.5, h: 2.5 },
      { x: -30, z: -20, w: 2.0, d: 1.8, h: 1.5 }, { x: 40, z: 25, w: 2.5, d: 2.0, h: 1.8 },
    ];
    for (const h of houses) {
      const y = terrainH(h.x * S, h.z * S);
      const mat = houseMats[Math.floor(Math.random() * houseMats.length)];
      const wall = new THREE.Mesh(new THREE.BoxGeometry(h.w * S, h.h * S, h.d * S), mat);
      wall.position.set(h.x * S, y + h.h * S * 0.5, h.z * S);
      wall.rotation.y = Math.random() * 0.3; wall.castShadow = wall.receiveShadow = true; this.envGroup.add(wall);
      addBox(V3(h.x * S, y + h.h * S * 0.5, h.z * S), V3(h.w * S * 0.5, h.h * S * 0.5, h.d * S * 0.5));
      const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(h.w, h.d) * S * 0.75, h.h * S * 0.6, 4), roofMat);
      roof.position.set(h.x * S, y + h.h * S + h.h * S * 0.3, h.z * S);
      roof.rotation.y = Math.PI / 4 + Math.random() * 0.3; roof.castShadow = true; this.envGroup.add(roof);
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.3 * S, 0.24 * S, 0.05 * S), windowMat);
      win.position.set(h.x * S + h.w * S * 0.18, y + h.h * S * 0.58, h.z * S + h.d * S * 0.51);
      win.rotation.y = wall.rotation.y; this.envGroup.add(win);
      const beam = new THREE.Mesh(new THREE.BoxGeometry(h.w * S * 0.92, 0.07 * S, 0.06 * S), beamMat);
      beam.position.set(h.x * S, y + h.h * S * 0.92, h.z * S + h.d * S * 0.52);
      beam.rotation.y = wall.rotation.y; beam.castShadow = true; this.envGroup.add(beam);
    }
  }

  _flowers() {
    const colors = [0xE85050, 0xF0C040, 0xFFFFFF, 0xCC80FF, 0xFF80AA, 0xFF6040, 0x40C0FF];
    for (let i = 0; i < 120; i++) {
      const x = (Math.random() - 0.5) * FIELD * 0.7, z = (Math.random() - 0.5) * FIELD * 0.7;
      if (Math.abs(x) < 15 && Math.abs(z) < 15) continue;
      const y = terrainH(x, z), c = colors[Math.floor(Math.random() * colors.length)];
      const flower = new THREE.Mesh(new THREE.SphereGeometry(0.2 + Math.random() * 0.12, 6, 4), matStd(c, { emissive: c, emissiveIntensity: 0.15 }));
      flower.position.set(x, y + 0.1, z); flower.scale.y = 0.6; this.envGroup.add(flower);
    }
  }

  _grassClumps() {
    const grassMat = matStd(0x73974b);
    for (let i = 0; i < 100; i++) {
      const x = (Math.random() - 0.5) * FIELD * 0.7, z = (Math.random() - 0.5) * FIELD * 0.7;
      if (Math.abs(x) < 12 && Math.abs(z) < 12) continue;
      const y = terrainH(x, z), h = 0.3 + Math.random() * 0.5;
      const clump = new THREE.Mesh(new THREE.ConeGeometry(0.15, h, 4), grassMat);
      clump.position.set(x, y + h * 0.5, z); clump.rotation.y = Math.random() * Math.PI; this.envGroup.add(clump);
    }
  }

  _windmill() {
    const S = WORLD_SCALE; const x = -25 * S, z = 30 * S, y = terrainH(x, z);
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.8 * S, 1.2 * S, 5 * S, 8), matStd(0xD4C098));
    tower.position.set(x, y + 2.5 * S, z); tower.castShadow = true; this.envGroup.add(tower);
    addBox(V3(x, y + 2.5 * S, z), V3(0.8 * S, 2.5 * S, 0.8 * S));
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.0 * S, 1.5 * S, 6), matStd(0x6A3020));
    roof.position.set(x, y + 5.75 * S, z); roof.castShadow = true; this.envGroup.add(roof);
    this._windmillBlades = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.15 * S, 3.5 * S, 0.05 * S), matStd(0x8a7a60));
      blade.position.y = 1.75 * S; const arm = new THREE.Group(); arm.rotation.z = (i / 4) * Math.PI * 2; arm.add(blade); this._windmillBlades.add(arm);
    }
    this._windmillBlades.position.set(x, y + 4.5 * S, z); this.envGroup.add(this._windmillBlades);
  }

  _well() {
    const S = WORLD_SCALE; const x = 20 * S, z = -18 * S, y = terrainH(x, z);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.8 * S, 0.2 * S, 8, 12), matStd(0x7a7065));
    ring.position.set(x, y + 0.2 * S, z); ring.rotation.x = Math.PI / 2; ring.castShadow = true; this.envGroup.add(ring);
    for (const dx of [-0.6, 0.6]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06 * S, 0.06 * S, 1.5 * S, 5), matStd(0x6a4a2a));
      post.position.set(x + dx * S, y + 0.95 * S, z); post.castShadow = true; this.envGroup.add(post);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(1.4 * S, 0.08 * S, 0.08 * S), matStd(0x6a4a2a));
    beam.position.set(x, y + 1.7 * S, z); beam.castShadow = true; this.envGroup.add(beam);
  }

  _fences() {
    const S = WORLD_SCALE; const postMat = matStd(0x6a4a2a), railMat = matStd(0x7a5a38);
    const posts = [[14, 14], [16, 16], [18, 18], [20, 20], [22, 18], [24, 16]];
    for (let i = 0; i < posts.length; i++) {
      const [fx, fz] = posts[i], fy = terrainH(fx * S, fz * S);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05 * S, 0.06 * S, 1.0 * S, 5), postMat);
      post.position.set(fx * S, fy + 0.5 * S, fz * S); post.castShadow = true; this.envGroup.add(post);
      if (i < posts.length - 1) {
        const [nx, nz] = posts[i + 1], nfy = terrainH(nx * S, nz * S);
        const len = Math.hypot(nx - fx, nz - fz) * S;
        const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.06 * S, 0.04 * S), railMat);
        rail.position.set((fx + nx) / 2 * S, (fy + nfy) / 2 * S + 0.7 * S, (fz + nz) / 2 * S);
        rail.lookAt(nx * S, nfy * S + 0.7 * S, nz * S); rail.castShadow = true; this.envGroup.add(rail);
      }
    }
  }

  _bushes() {
    const bushMats = [matStd(0x3a6a28), matStd(0x2a5a18)];
    for (let i = 0; i < 35; i++) {
      const x = (Math.random() - 0.5) * FIELD * 0.6, z = (Math.random() - 0.5) * FIELD * 0.6;
      if (Math.abs(x) < 14 && Math.abs(z) < 14) continue;
      const y = terrainH(x, z), r = 0.4 + Math.random() * 0.6;
      const bush = new THREE.Mesh(new THREE.SphereGeometry(r, 6, 5), bushMats[Math.floor(Math.random() * 2)]);
      bush.position.set(x, y + r * 0.4, z); bush.scale.y = 0.6; bush.castShadow = true; this.envGroup.add(bush);
    }
  }

  _pond() {
    const S = WORLD_SCALE; const x = -35 * S, z = -25 * S, y = terrainH(x, z) - 0.3;
    const water = new THREE.Mesh(new THREE.CircleGeometry(4 * S, 24),
      new THREE.MeshStandardMaterial({ color: 0x6fa4b0, transparent: true, opacity: 0.52, roughness: 0.55, metalness: 0.02 }));
    water.position.set(x, y, z); water.rotation.x = -Math.PI / 2; water.receiveShadow = true; this.envGroup.add(water);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.random() * 0.3, r = 3.5 * S + Math.random() * 1.5 * S;
      const rx = x + Math.cos(a) * r, rz = z + Math.sin(a) * r, ry = terrainH(rx, rz);
      const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3 + Math.random() * 0.4, 0), matStd(0x6a6055));
      rock.position.set(rx, ry + 0.2, rz); rock.rotation.set(Math.random(), Math.random(), Math.random()); rock.castShadow = true; this.envGroup.add(rock);
    }
  }

  _paths() {
    const S = WORLD_SCALE;
    const pathMat = new THREE.MeshStandardMaterial({ color: 0xc2aa78, roughness: 0.96, metalness: 0.01 });
    const points = [[0, 0], [5, 3], [10, 6], [15, 9], [20, 12]];
    for (let i = 0; i < points.length - 1; i++) {
      const [x1, z1] = points[i], [x2, z2] = points[i + 1];
      const mx = (x1 + x2) / 2 * S, mz = (z1 + z2) / 2 * S, my = terrainH(mx, mz);
      const len = Math.hypot(x2 - x1, z2 - z1) * S;
      const path = new THREE.Mesh(new THREE.BoxGeometry(len, 0.05, 1.5 * S), pathMat);
      path.position.set(mx, my + 0.03, mz); path.rotation.y = -Math.atan2(z2 - z1, x2 - x1); path.receiveShadow = true; this.envGroup.add(path);
    }
  }

  _butterflies() {
    const colors = [0xFF8844, 0xFFCC00, 0xFFFFFF, 0xFF6688];
    this._butterfliesArr = [];
    for (let i = 0; i < 15; i++) {
      const color = colors[Math.floor(Math.random() * colors.length)];
      const wing = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.1),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.3, side: THREE.DoubleSide, transparent: true, opacity: 0.8 }));
      const x = (Math.random() - 0.5) * 60, z = (Math.random() - 0.5) * 60, y = terrainH(x, z) + 1 + Math.random() * 3;
      wing.position.set(x, y, z); this.envGroup.add(wing);
      this._butterfliesArr.push({ mesh: wing, baseY: y, phase: Math.random() * Math.PI * 2, speed: 0.5 + Math.random() * 1.0, radius: 2 + Math.random() * 4, centerX: x, centerZ: z });
    }
  }

  _birds() {
    const birdGeo = new THREE.PlaneGeometry(0.3, 0.08);
    const birdMat = new THREE.MeshStandardMaterial({ color: 0x2a2018, side: THREE.DoubleSide, transparent: true, opacity: 0.7 });
    this._birdsArr = [];
    for (let i = 0; i < 8; i++) {
      const bird = new THREE.Mesh(birdGeo, birdMat);
      const x = (Math.random() - 0.5) * 100, z = (Math.random() - 0.5) * 100, y = 30 + Math.random() * 20;
      bird.position.set(x, y, z); this.envGroup.add(bird);
      this._birdsArr.push({ mesh: bird, centerX: x, centerZ: z, baseY: y, radius: 8 + Math.random() * 15, speed: 0.3 + Math.random() * 0.4, phase: Math.random() * Math.PI * 2, flapSpeed: 5 + Math.random() * 3 });
    }
  }

  _ribbons() {
    const colors = [0xff4444, 0xff8800, 0xffcc00, 0x44aaff];
    this._ribbonsArr = [];
    for (let i = 0; i < 3; i++) {
      const color = colors[i % colors.length];
      const group = new THREE.Group(); const meshes = [];
      for (let j = 0; j < 6; j++) {
        const seg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.25),
          new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.2, transparent: true, opacity: 0.8 }));
        seg.position.z = j * 0.25; group.add(seg); meshes.push(seg);
      }
      const positions = [[-0.4, 3.5, 0.1], [0.5, 4.0, -0.1], [-0.5, 5.8, 0.2]];
      group.position.set(...positions[i]); this.scene.add(group);
      this._ribbonsArr.push({ group, meshes, phase: Math.random() * Math.PI * 2 });
    }
  }

  _hatShop() {
    const S = WORLD_SCALE; const x = -28 * S, z = -15 * S, y = terrainH(x, z);
    const wall = new THREE.Mesh(new THREE.BoxGeometry(2.5 * S, 2.0 * S, 2.0 * S), matStd(0xD4B888));
    wall.position.set(x, y + 1.0 * S, z); wall.castShadow = true; this.envGroup.add(wall); addBox(V3(x, y + 1.0 * S, z), V3(1.25 * S, 1.0 * S, 1.0 * S));
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.8 * S, 1.0 * S, 4), matStd(0x6A3020));
    roof.position.set(x, y + 2.5 * S, z); roof.rotation.y = Math.PI / 4; roof.castShadow = true; this.envGroup.add(roof);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.5 * S, 0.8 * S, 0.08 * S), matStd(0x4a3020));
    door.position.set(x, y + 0.4 * S, z + 1.02 * S); door.castShadow = true; this.envGroup.add(door);
    const win = new THREE.Mesh(new THREE.BoxGeometry(0.35 * S, 0.3 * S, 0.06 * S), matStd(0xFFB347, { emissive: 0xFFA030, emissiveIntensity: 0.6 }));
    win.position.set(x + 0.6 * S, y + 1.2 * S, z + 1.02 * S); this.envGroup.add(win);
  }

  updateButterflies(dt) {
    if (!this._butterfliesArr) return;
    const t = performance.now() * 0.001;
    for (const b of this._butterfliesArr) {
      b.mesh.position.x = b.centerX + Math.sin(t * b.speed + b.phase) * b.radius;
      b.mesh.position.z = b.centerZ + Math.cos(t * b.speed * 0.7 + b.phase) * b.radius;
      b.mesh.position.y = b.baseY + Math.sin(t * 3 + b.phase) * 0.5;
      b.mesh.rotation.y = Math.atan2(Math.cos(t * b.speed + b.phase) * b.radius, -Math.sin(t * b.speed * 0.7 + b.phase) * b.radius);
      b.mesh.rotation.x = Math.sin(t * 8 + b.phase) * 0.5;
    }
  }

  updateBirds(dt) {
    if (!this._birdsArr) return;
    const t = performance.now() * 0.001;
    for (const b of this._birdsArr) {
      const angle = t * b.speed + b.phase;
      b.mesh.position.x = b.centerX + Math.cos(angle) * b.radius;
      b.mesh.position.z = b.centerZ + Math.sin(angle) * b.radius;
      b.mesh.position.y = b.baseY + Math.sin(t * 0.5 + b.phase) * 3;
      b.mesh.rotation.y = angle + Math.PI / 2;
      b.mesh.rotation.x = Math.sin(t * b.flapSpeed + b.phase) * 0.4;
    }
  }

  updateRibbons(dt) {
    if (!this._ribbonsArr) return;
    const t = performance.now() * 0.001;
    for (const r of this._ribbonsArr) {
      for (let i = 0; i < r.meshes.length; i++) {
        const m = r.meshes[i];
        m.rotation.x = Math.sin(t * 2 + r.phase + i * 0.5) * 0.3 * (i / r.meshes.length);
        m.rotation.y = Math.sin(t * 1.5 + r.phase + i * 0.3) * 0.2 * (i / r.meshes.length);
      }
    }
  }

  updateClouds(dt) {
    if (!this.clouds) return;
    for (const c of this.clouds) { c.position.x += c.userData.speed * dt; if (c.position.x > 150) c.position.x = -150; }
    if (this._windmillBlades) this._windmillBlades.rotation.z += dt * 0.3;
  }

  _dust() {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d'); const g = x.createRadialGradient(32, 32, 1, 32, 32, 31);
    g.addColorStop(0, 'rgba(220,200,170,.7)'); g.addColorStop(1, 'rgba(220,200,170,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c); this.dust = [];
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
