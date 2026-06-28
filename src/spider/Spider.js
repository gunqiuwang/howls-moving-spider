import * as THREE from 'three';
import {
  V3, Q, Y_UP, DOWN, TAU, clamp, clamp01, frac, lerp, smooth, wrapPi, signedAngle,
  twoBoneKnee, twoBoneKneeDecomposed, orientCyl,
} from '../core/dynamics.js';
import { FIELD, terrainH, terrainN } from '../world/terrain.js';
import { colliders, castAll, clearance, occluded } from '../world/collision.js';
import { getMaterials, matStd } from '../materials.js';

export const TUNE = { aRange: 3.14, aSamp: 8, decomposed: true };

function ikKnee(root, target, l1, l2, pole, restAxis, out) {
  return TUNE.decomposed
    ? twoBoneKneeDecomposed(root, target, l1, l2, pole, restAxis, out)
    : twoBoneKnee(root, target, l1, l2, pole, out);
}

const GEO = { cyl: new THREE.CylinderGeometry(1, 1, 1, 8), joint: new THREE.SphereGeometry(1, 10, 8) };

const _sp = V3(), _depP = V3(), _kUp = V3(0, 1, 0);
const _wUp = V3(), _lUp = V3();
const _qT = new THREE.Quaternion(), _qDroop = new THREE.Quaternion(), _qI = new THREE.Quaternion(), _qInv = new THREE.Quaternion();
const _XAX = V3(1, 0, 0), _YAX = V3(0, 1, 0);
function segPen(a, b, nearC, rad) {
  let pen = 0;
  for (let s = 0; s <= 5; s++) { _sp.copy(a).lerp(b, s * 0.2); for (const c of nearC) { const cl = clearance(_sp, c); const dd = rad - cl.d; if (dd > pen) pen = dd; } }
  return pen;
}

function gableRoofGeometry(w, h, d) {
  const hw = w * 0.5, hd = d * 0.5;
  const verts = new Float32Array([
    -hw, 0,  hd,   hw, 0,  hd,   0, h,  hd,
    -hw, 0, -hd,   hw, 0, -hd,   0, h, -hd,
  ]);
  const idx = [
    0, 1, 2,  5, 4, 3,
    0, 3, 4,  0, 4, 1,
    0, 2, 5,  0, 5, 3,
    1, 4, 5,  1, 5, 2,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* ---- verlet chains (steam pipes / flags) ---- */
const _vt = V3();
class Verlet {
  constructor(scene, anchor, localOff, n, seg, stiffDir, grav, color, rad) {
    this.anchor = anchor; this.localOff = localOff.clone(); this.n = n; this.seg = seg; this.stiff = stiffDir.clone(); this.grav = grav; this.rad = rad;
    this.pts = []; this.prev = []; const base = anchor.localToWorld(localOff.clone());
    for (let i = 0; i < n; i++) { const p = base.clone().addScaledVector(stiffDir, seg * i); this.pts.push(p); this.prev.push(p.clone()); }
    this.seg_m = []; const M = matStd(color, { emissive: color, emissiveIntensity: 0.15 });
    for (let i = 0; i < n - 1; i++) { const c = new THREE.Mesh(GEO.cyl, M); c.castShadow = true; scene.add(c); this.seg_m.push(c); }
  }
  step(dt) {
    this.anchor.updateMatrixWorld(); const head = this.anchor.localToWorld(this.localOff.clone()); this.pts[0].copy(head); this.prev[0].copy(head);
    const sw = this.stiff.clone().applyQuaternion(this.anchor.quaternion).normalize(); const g = this.grav * dt * dt;
    for (let i = 1; i < this.n; i++) {
      const p = this.pts[i], pr = this.prev[i]; const vx = (p.x - pr.x) * 0.9, vy = (p.y - pr.y) * 0.9, vz = (p.z - pr.z) * 0.9; pr.copy(p); p.x += vx; p.y += vy - g; p.z += vz;
      const par = this.pts[i - 1]; p.x += (par.x + sw.x * this.seg - p.x) * 0.2; p.y += (par.y + sw.y * this.seg - p.y) * 0.2; p.z += (par.z + sw.z * this.seg - p.z) * 0.2;
    }
    for (let k = 0; k < 3; k++) for (let i = 1; i < this.n; i++) { const a = this.pts[i - 1], b = this.pts[i]; _vt.subVectors(b, a); const d = _vt.length() || 1e-3; _vt.multiplyScalar((d - this.seg) / d * 0.5); if (i > 1) a.add(_vt); b.sub(_vt); }
    for (let i = 0; i < this.n - 1; i++) orientCyl(this.seg_m[i], this.pts[i], this.pts[i + 1], this.rad);
  }
}

/* ---- Steam particle emitter ---- */
class SteamEmitter {
  constructor(scene, count = 30) {
    this.particles = [];
    const geo = new THREE.SphereGeometry(0.08, 4, 3);
    const mat = new THREE.MeshStandardMaterial({ color: 0xd8d0c0, transparent: true, opacity: 0.6, roughness: 1, metalness: 0 });
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(geo, mat.clone());
      m.visible = false; m.castShadow = false;
      scene.add(m);
      this.particles.push({ mesh: m, vel: V3(), life: 0, maxLife: 0 });
    }
    this._idx = 0;
  }
  emit(pos, dir, speed = 3, count = 1) {
    for (let i = 0; i < count; i++) {
      const p = this.particles[this._idx = (this._idx + 1) % this.particles.length];
      p.mesh.position.copy(pos).addScaledVector(dir, Math.random() * 0.2);
      p.vel.copy(dir).multiplyScalar(speed * (0.6 + Math.random() * 0.8));
      p.vel.x += (Math.random() - 0.5) * 0.5;
      p.vel.z += (Math.random() - 0.5) * 0.5;
      p.life = 0; p.maxLife = 0.4 + Math.random() * 0.4;
      p.mesh.visible = true; p.mesh.material.opacity = 0.6;
      const s = 0.3 + Math.random() * 0.3; p.mesh.scale.setScalar(s);
    }
  }
  update(dt) {
    for (const p of this.particles) {
      if (!p.mesh.visible) continue;
      p.life += dt;
      if (p.life >= p.maxLife) { p.mesh.visible = false; continue; }
      const t = p.life / p.maxLife;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.vel.y += 0.5 * dt; // slight rise
      p.mesh.scale.setScalar((0.3 + t * 0.8) * (1 + t));
      p.mesh.material.opacity = 0.6 * (1 - t);
    }
  }
}

/* ============================================================
   CASTLE — Howl's Moving Castle (steampunk fortress)
   ============================================================ */
export class Spider {
  constructor(scene, world) {
    this.scene = scene; this.world = world;
    this.baseSpeed = 5.0; this.sprintMul = 1.75; this.turnRate = 1.6;
    this.femur = 2.3; this.tibia = 2.3; this.legReach = 4.6; this.tarsus = 0.5; this.legRad = 0.22;
    this.rideClear = 3.4; this.minClear = 1.8; this.baseFreq = 1.3; this.duty = 0.72; this.stepH = 0.7; this.stepThresh = 0.85;
    this.maxStride = 2.5; this.bodyR = 2.2; this.minFoot = 1.2;
    this.up = Y_UP.clone(); this.fwd = V3(0, 0, 1); this.right = V3(1, 0, 0); this.heading = 0; this.moveDir = V3(0, 0, 1);
    this.curSpeed = 0; this.activity = 0; this.gaitPhase = 0;
    this.airborne = false; this.vel = V3(); this.tether = null; this.fill = 0.5; this.legsLost = 0;
    this.bodyConform = true; this.conformLift = false; this.conformTiltW = 0.5;
    this.bodyFlex = true; this.abHang = 0.45; this.abDroop = 0.1; this.abMax = 0.6;
    this.flying = false; this.flyT = 0; this.flySpeed = 0; this.flyVel = V3();
    this.pos = V3(0, terrainH(0, 0), 0); this.bodyOrigin = V3(0, terrainH(0, 0) + this.rideClear, 0); this.quat = Q();
    this.root = new THREE.Group(); scene.add(this.root);
    this._buildBody(); this._buildLegs();
    this.antennae = [
      new Verlet(scene, this.root, V3(-0.8, 1.6, 0.0), 6, 0.4, V3(-0.1, 0.6, 0.05), 3.0, 0x4a3e30, 0.06),
      new Verlet(scene, this.root, V3(0.8, 1.6, 0.0), 6, 0.4, V3(0.1, 0.6, -0.05), 3.0, 0x4a3e30, 0.06),
    ];
    this._steamJoint = new SteamEmitter(scene, 60);
    this._steamChimney = new SteamEmitter(scene, 40);
    this._dustLand = new SteamEmitter(scene, 30);
    this._sideGearAngle = 0;
    this.reset();
  }

  _part(parent, geo, mat, x, y, z) {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m);
    this._ink(m, mat);
    return m;
  }

  _ink(mesh, mat) {
    if ((mat.emissiveIntensity || 0) > 0.45 || mat.transparent) return;
    const p = mesh.geometry.parameters || {};
    const size = Math.max(p.width || 0, p.height || 0, p.depth || 0, p.radius || 0, p.radiusTop || 0, p.radiusBottom || 0);
    if (size < 0.16) return;
    const M = getMaterials();
    const line = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 24), M.inkLine);
    line.renderOrder = 1;
    mesh.add(line);
  }

  _gable(parent, mat, x, y, z, w, h, d, ry = 0, rz = 0) {
    const m = new THREE.Mesh(gableRoofGeometry(w, h, d), mat);
    m.position.set(x, y, z); m.rotation.set(0, ry, rz); m.castShadow = true; parent.add(m);
    this._ink(m, mat);
    return m;
  }

  _house(parent, x, y, z, w, h, d, mat, roofMat, opts = {}) {
    const M = getMaterials();
    const body = this._part(parent, new THREE.BoxGeometry(w, h, d), mat, x, y, z);
    body.rotation.set(opts.rx || 0, opts.ry || 0, opts.rz || 0);
    const roof = this._gable(parent, roofMat, x, y + h * 0.5, z, w * 1.16, h * 0.34, d * 1.12, opts.ry || 0, opts.rz || 0);
    const frontZ = z + Math.cos(opts.ry || 0) * d * 0.52;
    this._warmWindow(parent, x - w * 0.23, y + h * 0.08, frontZ, Math.min(0.26, w * 0.22), Math.min(0.22, h * 0.18));
    if (w > 0.9) this._warmWindow(parent, x + w * 0.22, y + h * 0.05, frontZ, Math.min(0.24, w * 0.2), Math.min(0.2, h * 0.16));
    this._part(parent, new THREE.BoxGeometry(w * 0.92, 0.07, 0.08), M.oldWood, x, y + h * 0.42, frontZ + 0.02);
    return { body, roof };
  }

  _enlargeCastleVisuals(scale = 1.25) {
    for (const child of this.root.children) {
      child.position.multiplyScalar(scale);
      child.scale.multiplyScalar(scale);
    }
  }

  _warmWindow(parent, x, y, z, w, h) {
    const M = getMaterials();
    this._part(parent, new THREE.BoxGeometry(w + 0.08, h + 0.08, 0.035), M.oldWood, x, y, z - 0.012);
    return this._part(parent, new THREE.BoxGeometry(w, h, 0.06), M.windowGlow, x, y, z);
  }

  /* ================================================================
     BODY — curved metal head + house modules + gears + chimneys
     ================================================================ */
  _buildBody() {
    const M = getMaterials();

    this.PEDICEL = V3(0, 0.0, -1.2);
    this.abdomen = new THREE.Group(); this.abdomen.position.copy(this.PEDICEL); this.root.add(this.abdomen);
    this._abQ = new THREE.Quaternion();

    // ================================================================
    //  HOWL'S MOVING CASTLE — rounded fish-head front face
    // ================================================================

    // ---- 1. Boiler core: kept low so the silhouette reads as houses first ----
    const headShell = new THREE.Mesh(new THREE.SphereGeometry(1.8, 24, 18), M.rustIron);
    headShell.scale.set(1.02, 0.72, 0.82);
    headShell.position.set(0, 0.78, 0.42);
    headShell.castShadow = true;
    this.root.add(headShell);

    // Lower boiler lip, not a monster jaw.
    const jaw = new THREE.Mesh(new THREE.SphereGeometry(1.2, 18, 12), M.rustIron);
    jaw.scale.set(0.92, 0.32, 0.62);
    jaw.position.set(0, 0.12, 0.7);
    jaw.castShadow = true;
    this.root.add(jaw);

    // ---- EYES: large TorusGeometry rims with warm glass ----
    const eyeY = 1.48, eyeZ = 1.18, eyeSpacing = 0.58;
    for (const side of [-1, 1]) {
      const ex = side * eyeSpacing;
      // Large iron rim (protruding)
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.10, 8, 20), M.darkIron);
      rim.position.set(ex, eyeY, eyeZ); rim.castShadow = true; this.root.add(rim);
      const glass = new THREE.Mesh(new THREE.CircleGeometry(0.38, 18), M.darkGlass);
      glass.position.set(ex, eyeY, eyeZ + 0.02); this.root.add(glass);
      const glint = new THREE.Mesh(new THREE.CircleGeometry(0.14, 12), M.windowGlow);
      glint.position.set(ex - side * 0.08, eyeY + 0.04, eyeZ + 0.035); this.root.add(glint);
      // Mechanical bolts around eye
      this._part(this.root, new THREE.BoxGeometry(0.08, 0.55, 0.08), M.darkIron, ex + side * 0.46, eyeY, eyeZ);
      this._part(this.root, new THREE.BoxGeometry(0.55, 0.08, 0.08), M.darkIron, ex, eyeY + 0.46, eyeZ);
    }

    // ---- MOUTH: warm furnace slit, friendlier than a monster mouth ----
    const mouthY = 0.38, mouthZ = 1.14;
    this._part(this.root, new THREE.BoxGeometry(1.28, 0.24, 0.22), M.darkInterior, 0, mouthY, mouthZ);
    this._part(this.root, new THREE.BoxGeometry(1.35, 0.08, 0.08), M.windowGlow, 0, mouthY - 0.02, mouthZ + 0.08);
    for (let i = 0; i < 5; i++) {
      const tx = -0.48 + i * 0.24;
      this._part(this.root, new THREE.BoxGeometry(0.08, 0.16, 0.08), M.steel, tx, mouthY + 0.2, mouthZ + 0.06);
    }

    // ---- NOSE: ConeGeometry ----
    const nose = this._part(this.root, new THREE.ConeGeometry(0.1, 0.34, 6), M.darkIron, 0, eyeY - 0.28, eyeZ + 0.28);
    nose.rotation.x = Math.PI; // point forward

    // ---- EXHAUST PIPES flanking the nose ----
    for (const side of [-1, 1]) {
      this._part(this.root, new THREE.CylinderGeometry(0.06, 0.08, 0.4, 6), M.darkIron, side * 0.28, eyeY - 0.5, eyeZ + 0.5);
    }

    // ---- 2. SIDE DETAILS: pipes, lanterns, gears ----
    this._sideGears = [];
    for (const side of [-1, 1]) {
      // Vertical pipe
      const p1 = this._part(this.root, new THREE.CylinderGeometry(0.07, 0.07, 2.0, 6), M.darkIron, side * 1.6, 1.0, 0.3);
      p1.rotation.z = side * 0.10;
      // Horizontal pipe
      const p2 = this._part(this.root, new THREE.CylinderGeometry(0.06, 0.06, 1.0, 6), M.darkIron, side * 1.0, 2.0, 0.7);
      p2.rotation.x = -0.3;
      // Diagonal pipe
      const p3 = this._part(this.root, new THREE.CylinderGeometry(0.05, 0.05, 1.2, 6), M.darkIron, side * 1.3, 1.5, -0.5);
      p3.rotation.set(0.2, 0, side * 0.4);
      // Small side lantern instead of a weapon silhouette
      this._part(this.root, new THREE.CylinderGeometry(0.09, 0.11, 0.22, 8), M.brass, side * 1.72, 1.48, 0.62);
      this._part(this.root, new THREE.SphereGeometry(0.12, 8, 6), M.windowGlow, side * 1.72, 1.35, 0.68);

      // ---- Side gears (TorusGeometry with spokes) ----
      const gearGroup = new THREE.Group();
      gearGroup.add(new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.09, 8, 24), M.gearIron));
      gearGroup.add(new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.22, 8), M.darkIron));
      for (let i = 0; i < 10; i++) {
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.04, 0.04), M.darkIron);
        spoke.rotation.z = (i / 10) * Math.PI; gearGroup.add(spoke);
      }
      gearGroup.position.set(side * 1.8, 1.3, -0.3);
      gearGroup.rotation.y = Math.PI / 2;
      this.root.add(gearGroup); this._sideGears.push(gearGroup);
    }

    // ---- 3 small decorative gears ----
    for (const [gx, gy, gz, r] of [[-1.0, 2.8, 0.8, 0.2], [1.3, 2.5, -0.6, 0.18], [0.2, 3.5, 0.5, 0.15]]) {
      const gear = new THREE.Mesh(new THREE.TorusGeometry(r, 0.03, 6, 12), M.darkIron);
      gear.position.set(gx, gy, gz); gear.rotation.x = Math.random() * 0.5;
      gear.castShadow = true; this.root.add(gear);
    }

    // ---- 3. MIDDLE BUILDINGS (stacked boxes with roofs) ----
    // Building 1: large central iron structure
    const b1 = this._part(this.root, new THREE.BoxGeometry(2.2, 1.6, 1.8), M.rustIron, 0, 0.8, -0.4);
    b1.rotation.set(0, 0.02, 0.01);
    const b1roof = this._part(this.root, new THREE.ConeGeometry(1.4, 0.7, 4), M.roofTile, 0, 2.0, -0.4);
    b1roof.rotation.y = Math.PI / 4;

    // Building 2: wooden tower (left)
    const b2 = this._part(this.root, new THREE.BoxGeometry(1.0, 2.0, 0.9), M.oldWood, -0.9, 1.4, 0.2);
    b2.rotation.z = 0.05;
    this._part(this.root, new THREE.ConeGeometry(0.7, 1.0, 5), M.roofTile, -0.9, 3.0, 0.2);

    // Building 3: iron cabin (right)
    const b3 = this._part(this.root, new THREE.BoxGeometry(1.2, 1.2, 1.0), M.rustIron, 0.8, 1.0, -0.1);
    b3.rotation.set(0, -0.03, -0.02);
    const b3roof = this._part(this.root, new THREE.ConeGeometry(0.85, 0.55, 4), M.roofTile, 0.8, 1.9, -0.1);
    b3roof.rotation.y = Math.PI / 4 + 0.2;

    // Building 4: upper small wooden house
    const b4 = this._part(this.root, new THREE.BoxGeometry(1.4, 1.0, 1.2), M.oldWood, -0.2, 2.2, -0.6);
    b4.rotation.set(-0.01, 0.01, 0.015);
    this._part(this.root, new THREE.ConeGeometry(1.0, 0.6, 4), M.roofTile, -0.2, 3.0, -0.6);

    // Building 5: tiny rear iron shed
    const b5 = this._part(this.root, new THREE.BoxGeometry(0.9, 0.8, 0.7), M.rustIron, 0.4, 2.6, -0.9);
    b5.rotation.set(0.01, -0.02, 0.02);
    this._part(this.root, new THREE.ConeGeometry(0.6, 0.5, 4), M.roofTile, 0.4, 3.25, -0.9);

    // Smaller crooked cabins make the silhouette read as a pile of lived-in houses.
    const b6 = this._part(this.root, new THREE.BoxGeometry(0.8, 0.65, 0.75), M.plaster, -1.15, 2.15, -0.55);
    b6.rotation.set(0.02, 0.18, -0.07);
    const b6roof = this._part(this.root, new THREE.ConeGeometry(0.62, 0.48, 4), M.roofTile, -1.15, 2.72, -0.55);
    b6roof.rotation.y = Math.PI / 4 + 0.18;
    const b7 = this._part(this.root, new THREE.BoxGeometry(0.74, 0.58, 0.64), M.oldWood, 1.08, 2.28, -0.72);
    b7.rotation.set(-0.02, -0.16, 0.06);
    const b7roof = this._part(this.root, new THREE.ConeGeometry(0.55, 0.42, 4), M.roofTile, 1.08, 2.78, -0.72);
    b7roof.rotation.y = Math.PI / 4 - 0.16;

    // ---- 3b. CASTLE SILHOUETTE: a crooked stack of real house shapes ----
    this._house(this.root, 0.0, 1.68, 0.28, 2.65, 1.85, 1.18, M.plaster, M.roofTile, { ry: 0.02, rz: -0.015 });
    this._house(this.root, -1.02, 2.14, 0.02, 1.18, 2.15, 0.98, M.oldWood, M.roofTile, { ry: 0.12, rz: -0.08 });
    this._house(this.root, 1.04, 1.95, -0.12, 1.28, 1.58, 1.05, M.plaster, M.roofTile, { ry: -0.14, rz: 0.06 });
    this._house(this.root, 0.18, 3.04, -0.36, 1.48, 1.0, 1.08, M.oldWood, M.roofTile, { ry: -0.04, rz: 0.03 });
    this._house(this.root, -1.68, 1.58, -0.48, 0.92, 1.02, 0.82, M.plaster, M.roofTile, { ry: 0.32, rz: -0.04 });
    this._house(this.root, 1.68, 1.46, -0.62, 0.92, 0.94, 0.78, M.oldWood, M.roofTile, { ry: -0.28, rz: 0.04 });

    // Low planked skirts hide the spider-body read and make the legs feel like supports.
    const skirtFront = this._part(this.root, new THREE.BoxGeometry(3.55, 0.72, 0.16), M.oldWood, 0, 0.58, 1.02);
    skirtFront.rotation.z = -0.015;
    const skirtRear = this._part(this.root, new THREE.BoxGeometry(3.25, 0.62, 0.16), M.oldWood, 0.04, 0.52, -1.16);
    skirtRear.rotation.z = 0.02;
    for (const x of [-1.1, 0, 1.1]) {
      this._part(this.root, new THREE.BoxGeometry(0.08, 0.72, 0.1), M.brass, x, 0.58, 1.12);
      this._part(this.root, new THREE.BoxGeometry(0.08, 0.62, 0.1), M.brass, x, 0.52, -1.26);
    }

    // Lower front facade: turns the visible boiler slab into a little inhabited cabin.
    const lowerCabin = this._part(this.root, new THREE.BoxGeometry(1.85, 1.18, 0.34), M.plaster, 0, 0.86, 1.22);
    lowerCabin.rotation.z = -0.01;
    this._gable(this.root, M.roofTile, 0, 1.45, 1.22, 2.06, 0.42, 0.58, 0.02, -0.01);
    this._warmWindow(this.root, -0.48, 0.98, 1.42, 0.24, 0.22);
    this._warmWindow(this.root, 0.48, 0.98, 1.42, 0.24, 0.22);
    this._part(this.root, new THREE.BoxGeometry(0.34, 0.56, 0.08), M.darkInterior, 0, 0.55, 1.44);
    this._part(this.root, new THREE.BoxGeometry(1.72, 0.08, 0.08), M.oldWood, 0, 1.2, 1.45);
    this._part(this.root, new THREE.BoxGeometry(1.72, 0.08, 0.08), M.oldWood, 0, 0.26, 1.45);
    for (const x of [-0.86, 0.86]) this._part(this.root, new THREE.BoxGeometry(0.08, 1.05, 0.08), M.oldWood, x, 0.78, 1.45);

    // Rear facade is the default camera view, so it carries the strongest house read.
    const rearCabin = this._part(this.root, new THREE.BoxGeometry(2.05, 1.26, 0.36), M.plaster, 0, 0.9, -1.42);
    rearCabin.rotation.z = 0.012;
    this._gable(this.root, M.roofTile, 0, 1.53, -1.42, 2.28, 0.5, 0.62, Math.PI, 0.012);
    this._warmWindow(this.root, -0.58, 1.05, -1.64, 0.28, 0.24);
    this._warmWindow(this.root, 0.58, 1.05, -1.64, 0.28, 0.24);
    this._part(this.root, new THREE.BoxGeometry(0.4, 0.62, 0.08), M.darkInterior, 0, 0.58, -1.66);
    this._part(this.root, new THREE.BoxGeometry(1.92, 0.09, 0.08), M.oldWood, 0, 1.28, -1.67);
    this._part(this.root, new THREE.BoxGeometry(1.92, 0.09, 0.08), M.oldWood, 0, 0.28, -1.67);
    for (const x of [-0.96, 0.96]) this._part(this.root, new THREE.BoxGeometry(0.08, 1.12, 0.08), M.oldWood, x, 0.82, -1.67);
    this._part(this.root, new THREE.BoxGeometry(2.25, 0.08, 0.52), M.darkIron, 0, 0.16, -1.34);
    for (const x of [-0.72, 0, 0.72]) this._part(this.root, new THREE.BoxGeometry(0.05, 0.32, 0.05), M.brass, x, 0.34, -1.68);

    for (const side of [-1, 1]) {
      const sideSkirt = this._part(this.root, new THREE.BoxGeometry(0.18, 0.7, 2.35), M.oldWood, side * 1.72, 0.55, -0.12);
      sideSkirt.rotation.z = side * 0.04;
      this._part(this.root, new THREE.BoxGeometry(0.1, 0.7, 0.08), M.brass, side * 1.83, 0.55, 0.62);
      this._part(this.root, new THREE.BoxGeometry(0.1, 0.7, 0.08), M.brass, side * 1.83, 0.55, -0.78);
    }

    for (const [cx, cy, cz, r, h] of [
      [-0.42, 3.95, 0.18, 0.13, 0.9], [0.34, 3.72, -0.5, 0.11, 0.75],
      [-1.12, 3.58, 0.12, 0.1, 0.82], [1.12, 3.04, -0.08, 0.09, 0.62],
    ]) {
      this._part(this.root, new THREE.CylinderGeometry(r * 0.7, r, h, 6), M.rustIron, cx, cy, cz);
      this._part(this.root, new THREE.CylinderGeometry(r * 1.2, r * 0.75, 0.1, 6), M.darkIron, cx, cy + h * 0.5 + 0.04, cz);
    }

    for (const [x, y, z, w] of [
      [0, 2.38, -0.4, 2.3], [-0.9, 3.08, 0.2, 1.1], [0.8, 1.98, -0.1, 1.25],
      [-0.2, 3.08, -0.6, 1.45], [0.4, 3.32, -0.9, 0.95],
    ]) this._part(this.root, new THREE.BoxGeometry(w, 0.08, 0.08), M.oldWood, x, y, z + 0.46);

    // Balconies
    this._part(this.root, new THREE.BoxGeometry(0.6, 0.08, 1.4), M.darkIron, -1.5, 1.6, 0.0);
    for (const dz of [-0.5, 0, 0.5]) this._part(this.root, new THREE.BoxGeometry(0.04, 0.3, 0.04), M.darkIron, -1.5, 1.85, dz);
    // Railings on right side
    this._part(this.root, new THREE.BoxGeometry(0.5, 0.07, 1.0), M.darkIron, 1.4, 1.6, -0.4);
    for (const dz of [-0.35, 0, 0.35]) this._part(this.root, new THREE.BoxGeometry(0.04, 0.25, 0.04), M.darkIron, 1.4, 1.8, -0.4 + dz);

    // ---- 4. CHIMNEYS (sitting ON the roofs) ----
    this._chimneys = [];
    for (const ch of [
      { x: -0.5, y: 2.35, z: -0.3, r: 0.14, h: 1.0 },
      { x: 0.6, y: 2.15, z: -0.1, r: 0.11, h: 0.8 },
      { x: -0.9, y: 3.55, z: 0.2, r: 0.16, h: 1.2 },
      { x: 0.85, y: 2.25, z: -0.1, r: 0.09, h: 0.6 },
      { x: -0.2, y: 3.35, z: -0.6, r: 0.10, h: 0.7 },
    ]) {
      const chimney = this._part(this.root, new THREE.CylinderGeometry(ch.r * 0.7, ch.r, ch.h, 6), M.rustIron, ch.x, ch.y, ch.z);
      // Smoke cap
      this._part(this.root, new THREE.CylinderGeometry(ch.r * 1.3, ch.r * 0.7, 0.1, 6), M.darkIron, ch.x, ch.y + ch.h * 0.5 + 0.05, ch.z);
      this._chimneys.push({ mesh: chimney, pos: V3(ch.x, ch.y + ch.h * 0.5 + 0.1, ch.z) });
    }

    // ---- 5. WINDOWS (warm glow) ----
    for (const [x, y, z, w, h] of [
      [0.6, 0.8, 0.7, 0.28, 0.22], [-0.5, 0.8, 0.7, 0.28, 0.22],
      [1.3, 1.0, 0.4, 0.2, 0.24], [-1.3, 1.0, 0.4, 0.2, 0.24],
      [0.3, 2.2, 0.5, 0.22, 0.2], [-0.3, 2.2, 0.5, 0.22, 0.2],
      [0.7, 1.6, -0.6, 0.18, 0.2], [-1.15, 2.18, -0.16, 0.16, 0.16],
      [1.08, 2.28, -0.34, 0.16, 0.14], [0.36, 2.62, -0.52, 0.14, 0.13],
    ]) { this._warmWindow(this.root, x, y, z, w, h); }

    // ---- 6. DETAILS ----
    // Wooden beams
    for (const side of [-1, 1]) {
      this._part(this.root, new THREE.BoxGeometry(0.07, 1.8, 0.07), M.oldWood, side * 1.4, 1.0, 0.8);
      this._part(this.root, new THREE.BoxGeometry(0.07, 1.8, 0.07), M.oldWood, side * 1.4, 1.0, -0.8);
    }
    // Hanging lanterns
    for (const [lx, ly, lz] of [[-1.0, 1.4, 0.8], [1.0, 1.4, 0.8]]) {
      this._part(this.root, new THREE.BoxGeometry(0.14, 0.18, 0.14), M.windowGlow, lx, ly, lz);
      this._part(this.root, new THREE.CylinderGeometry(0.01, 0.01, 0.35, 4), M.darkIron, lx, ly + 0.2, lz);
    }
    // Patched steel plates
    this._part(this.root, new THREE.BoxGeometry(0.7, 0.5, 0.08), M.rustIron, 1.4, 2.0, 0.9);
    this._part(this.root, new THREE.BoxGeometry(0.5, 0.4, 0.08), M.rustIron, -1.2, 2.5, 0.7);
    this._part(this.root, new THREE.BoxGeometry(0.6, 0.3, 0.08), M.rustIron, 0.0, 3.0, 0.8);
    for (const [px, py, pz, sx, sy] of [
      [1.45, 2.02, 0.95, 0.78, 0.58], [-1.22, 2.52, 0.75, 0.58, 0.48], [0.0, 3.02, 0.85, 0.68, 0.38],
    ]) {
      this._part(this.root, new THREE.BoxGeometry(sx, 0.035, 0.035), M.brass, px, py + sy * 0.5, pz + 0.05);
      this._part(this.root, new THREE.BoxGeometry(sx, 0.035, 0.035), M.brass, px, py - sy * 0.5, pz + 0.05);
      this._part(this.root, new THREE.BoxGeometry(0.035, sy, 0.035), M.brass, px - sx * 0.5, py, pz + 0.05);
      this._part(this.root, new THREE.BoxGeometry(0.035, sy, 0.035), M.brass, px + sx * 0.5, py, pz + 0.05);
    }
    // Wooden barrel
    this._part(this.root, new THREE.CylinderGeometry(0.18, 0.18, 0.35, 8), M.oldWood, 1.5, 1.1, -0.8);
    // Antenna
    this._part(this.root, new THREE.CylinderGeometry(0.02, 0.02, 1.8, 4), M.darkIron, 0.3, 4.2, -0.5);

    // ---- TRAILING: boiler / abdomen ----
    const py = this.PEDICEL.y, pz = this.PEDICEL.z;
    this.body = this._part(this.abdomen, new THREE.BoxGeometry(2.2, 1.5, 2.0), M.rustIron, 0, 0.0 - py, -1.6 - pz);
    // Furnace slit (glowing)
    this._part(this.abdomen, new THREE.BoxGeometry(1.8, 0.15, 0.1), M.windowGlow, 0, -0.05 - py, -0.6 - pz);
    for (const x of [-0.55, 0.55]) this._warmWindow(this.abdomen, x, 0.35 - py, -0.58 - pz, 0.28, 0.22);
    this._part(this.abdomen, new THREE.BoxGeometry(1.9, 0.08, 0.08), M.oldWood, 0, 0.8 - py, -0.58 - pz);
    this._part(this.abdomen, new THREE.BoxGeometry(1.6, 0.08, 0.08), M.brass, 0, -0.72 - py, -0.58 - pz);
    // Rear chimney
    this._part(this.abdomen, new THREE.CylinderGeometry(0.12, 0.15, 0.7, 6), M.rustIron, 0.4, 0.8 - py, -2.2 - pz);
    // Connecting pipes
    this._part(this.abdomen, new THREE.CylinderGeometry(0.06, 0.06, 1.0, 6), M.darkIron, -0.4, 0.2 - py, -0.4 - pz);
    this._part(this.abdomen, new THREE.CylinderGeometry(0.06, 0.06, 1.0, 6), M.darkIron, 0.4, 0.2 - py, -0.4 - pz);

    // Calcifer glow
    this._calciferLight = new THREE.PointLight(0xE85030, 2, 8);
    this._calciferLight.position.set(0, 0.8, 0);
    this.root.add(this._calciferLight);

    this._enlargeCastleVisuals(1.25);
  }

  /* ================================================================
     LEGS — armor sleeves + 3-toe claws with open/close animation
     ================================================================ */
  _buildLegs() {
    const M = getMaterials();
    const spec = [
      { az: 0.50, off: 0.50, scale: 1.15 },
      { az: 1.12, off: 0.33, scale: 1.1 },
      { az: 1.78, off: 0.17, scale: 1.05 },
      { az: 2.42, off: 0.00, scale: 1.0 },
      { az: -2.42, off: 0.50, scale: 0.95 },
      { az: -1.78, off: 0.67, scale: 0.95 },
      { az: -1.12, off: 0.83, scale: 0.9 },
      { az: -0.50, off: 0.00, scale: 0.9 },
    ];
    const rHip = 1.35, rHome = 3.8; this.legs = [];
    for (const s of spec) {
      const ox = Math.sin(s.az), oz = Math.cos(s.az); const home = V3(ox * rHome, 0, oz * rHome);
      const L = {
        hip: V3(ox * rHip, 0.0, oz * rHip), home, off: s.off, pole: V3(ox * 0.85, 1.45, oz * 0.85).normalize(),
        restAz: Math.atan2(home.x, home.z), restR: rHome, rMin: rHome * 0.78, rMax: rHome * 1.2, ccw: 0.3, cw: 0.3,
        scale: s.scale,
        plant: V3(), from: V3(), to: V3(), surfN: Y_UP.clone(), toN: Y_UP.clone(), t: 1, stepping: false,
        wheelAngle: 0,
      };

      // Build leg geometry groups
      const sc = s.scale;
      const armR = this.legRad * 1.15 * sc; // armor radius

      // Femur group: slimmer old-machine struts instead of thick spider limbs.
      const femGroup = new THREE.Group();
      femGroup.add(new THREE.Mesh(GEO.cyl, M.legArmor));
      femGroup.add(new THREE.Mesh(GEO.joint, M.brass));
      femGroup.add(new THREE.Mesh(GEO.cyl, M.darkIron));
      femGroup.add(new THREE.Mesh(GEO.cyl, M.darkIron));
      femGroup.children[0].scale.set(armR * 0.72, 1, armR * 0.72);
      femGroup.children[1].scale.setScalar(armR * 0.98);
      femGroup.children[2].scale.set(armR * 0.28, 1, armR * 0.28);
      femGroup.children[3].scale.set(armR * 0.28, 1, armR * 0.28);
      this.scene.add(femGroup);

      // Tibia group with paired hydraulic rods.
      const tibGroup = new THREE.Group();
      tibGroup.add(new THREE.Mesh(GEO.cyl, M.legArmor));
      tibGroup.add(new THREE.Mesh(GEO.joint, M.brass));
      tibGroup.add(new THREE.Mesh(GEO.cyl, M.darkIron));
      tibGroup.add(new THREE.Mesh(GEO.cyl, M.darkIron));
      tibGroup.children[0].scale.set(armR * 0.62, 1, armR * 0.62);
      tibGroup.children[1].scale.setScalar(armR * 0.9);
      tibGroup.children[2].scale.set(armR * 0.24, 1, armR * 0.24);
      tibGroup.children[3].scale.set(armR * 0.24, 1, armR * 0.24);
      this.scene.add(tibGroup);

      const footGroup = new THREE.Group();
      const pad = new THREE.Mesh(new THREE.BoxGeometry(0.62 * sc, 0.16 * sc, 0.4 * sc), M.oldWood);
      const toe = new THREE.Mesh(new THREE.BoxGeometry(0.34 * sc, 0.1 * sc, 0.16 * sc), M.brass);
      toe.position.z = 0.26 * sc;
      footGroup.add(pad); footGroup.add(toe);
      this.scene.add(footGroup);

      const footLink = new THREE.Group();
      footLink.add(new THREE.Mesh(GEO.cyl, M.darkIron));
      footLink.add(new THREE.Mesh(GEO.joint, M.brass));
      footLink.add(new THREE.Mesh(GEO.joint, M.brass));
      footLink.children[0].scale.set(armR * 0.28, 1, armR * 0.28);
      footLink.children[1].scale.setScalar(armR * 0.62);
      footLink.children[2].scale.setScalar(armR * 0.52);
      this.scene.add(footLink);

      L.femGroup = femGroup; L.tibGroup = tibGroup;
      L.footGroup = footGroup;
      L.footLink = footLink;
      L.armR = armR;

      L.restAxisL = home.clone().sub(L.hip).normalize();
      this.legs.push(L);
    }
    const margin = 0.06;
    for (let i = 0; i < 8; i++) {
      const L = this.legs[i], nx = this.legs[(i + 1) % 8], pv = this.legs[(i + 7) % 8];
      L.ccw = Math.max(0.12, Math.abs(wrapPi(nx.restAz - L.restAz)) * 0.5 - margin);
      L.cw = Math.max(0.12, Math.abs(wrapPi(pv.restAz - L.restAz)) * 0.5 - margin);
    }
  }

  rebuild() {
    let r = this.up.clone().cross(this.fwd); if (r.lengthSq() < 1e-6) r = this.up.clone().cross(V3(1, 0, 0.001)); r.normalize();
    this.fwd.copy(r.clone().cross(this.up).normalize()); this.right.copy(r);
    this.quat.setFromRotationMatrix(new THREE.Matrix4().makeBasis(this.right, this.up, this.fwd));
  }
  setRoot() {
    this.root.position.copy(this.bodyOrigin); this.root.quaternion.copy(this.quat);
    const br = 1 + Math.sin(performance.now() * 0.002) * 0.006;
    const f = 1 + clamp01(this.fill || 0) * 0.3;
    this.body.scale.set(1.0 * f, 0.9 * br * f, 1.0 * f);
    // Gears rotate
    this._sideGearAngle += this.curSpeed * 0.06;
    if (this._sideGears) for (const g of this._sideGears) g.rotation.y = Math.PI / 2 + this._sideGearAngle;
    // Calcifer flicker
    if (this._calciferLight) this._calciferLight.intensity = 1.8 + Math.sin(performance.now() * 0.01) * 0.4;
    this.root.updateMatrixWorld(true);
  }
  _castFoothold(pW) {
    const down = this.up.clone().negate(); const maxAbove = this.legReach + 0.5;
    let origin = pW.clone().addScaledVector(this.up, 4);
    for (let a = 0; a < 6; a++) {
      const g = castAll(origin, down, this.rideClear + 12);
      if (!g) break;
      const upish = g.n.dot(this.up) > 0.1; const reachable = g.point.clone().sub(this.pos).dot(this.up) < maxAbove;
      let buried = false; for (const c of colliders) { if (clearance(g.point, c).d < -0.15) { buried = true; break; } }
      if (upish && reachable && !buried) return g;
      origin.copy(g.point).addScaledVector(down, 0.15);
    }
    return null;
  }
  footProbe(pW) {
    let g = this._castFoothold(pW); if (g) return g;
    const retreat = this.pos.clone().sub(pW); retreat.addScaledVector(this.up, -retreat.dot(this.up));
    for (let k = 1; k <= 6; k++) { g = this._castFoothold(pW.clone().addScaledVector(retreat, (k / 6) * 0.85)); if (g) return g; }
    const y = terrainH(pW.x, pW.z); return { point: V3(pW.x, y, pW.z), n: terrainN(pW.x, pW.z) };
  }
  reset() {
    if (this._abQ) { this._abQ.identity(); this.abdomen.quaternion.identity(); }
    this.up.copy(Y_UP); this.fwd.set(0, 0, 1); this.right.set(1, 0, 0); this.heading = 0; this.moveDir.set(0, 0, 1); this.curSpeed = 0; this.activity = 0; this.gaitPhase = 0;
    this.pos.set(0, terrainH(0, 0), 0); this.bodyOrigin.copy(this.pos).addScaledVector(this.up, this.rideClear); this.rebuild(); this.setRoot();
    for (const L of this.legs) { const hw = this.root.localToWorld(L.home.clone()); const g = this.footProbe(hw); L.plant.copy(g.point); L.surfN.copy(g.n); L.toN.copy(g.n); L.from.copy(g.point); L.to.copy(g.point); L.t = 1; L.stepping = false; }
  }
  teleport(x, z, headingVec) {
    this.up.copy(Y_UP);
    if (headingVec) { this.fwd.copy(headingVec); this.fwd.y = 0; if (this.fwd.lengthSq() < 1e-6) this.fwd.set(0, 0, 1); this.fwd.normalize(); } else this.fwd.set(0, 0, 1);
    this.right.set(1, 0, 0); this.curSpeed = 0; this.activity = 0; this.gaitPhase = 0; this.moveDir.copy(this.fwd);
    const y = terrainH(x, z); this.pos.set(x, y, z);
    const g = castAll(V3(x, y + 80, z), DOWN, 120); if (g) this.pos.copy(g.point);
    this.bodyOrigin.copy(this.pos).addScaledVector(this.up, this.rideClear); this.rebuild(); this.setRoot();
    for (const L of this.legs) { const hw = this.root.localToWorld(L.home.clone()); const gg = this.footProbe(hw); L.plant.copy(gg.point); L.surfN.copy(gg.n); L.toN.copy(gg.n); L.from.copy(gg.point); L.to.copy(gg.point); L.t = 1; L.stepping = false; }
  }
  spinneret(out = V3()) { return this.abdomen.localToWorld(out.set(0, -0.1 - this.PEDICEL.y, -2.55 - this.PEDICEL.z)); }
  headPoint(out = V3()) { return this.root.localToWorld(out.set(0, 0.2, 1.4)); }
  _updateAbdomen(dt) {
    if (!this.abdomen) return;
    if (!this.bodyFlex) { this._abQ.identity(); this.abdomen.quaternion.identity(); return; }
    _wUp.copy(this.up).lerp(Y_UP, this.abHang); if (_wUp.lengthSq() < 1e-6) _wUp.copy(Y_UP); _wUp.normalize();
    _qInv.copy(this.quat).invert(); _lUp.copy(_wUp).applyQuaternion(_qInv);
    _qT.setFromUnitVectors(_YAX, _lUp); _qDroop.setFromAxisAngle(_XAX, -this.abDroop); _qT.multiply(_qDroop);
    const ang = 2 * Math.acos(clamp(Math.abs(_qT.w), 0, 1));
    if (ang > this.abMax) { _qI.identity(); _qT.copy(_qI.slerp(_qT, this.abMax / ang)); }
    this._abQ.slerp(_qT, 1 - Math.pow(0.02, Math.min(dt, 0.05)));
    this.abdomen.quaternion.copy(this._abQ);
  }

  // ---- flight mode ----
  toggleFlight() {
    this.flying = !this.flying;
    if (this.flying) { this.airborne = true; this.vel.copy(this.up).multiplyScalar(12); this.flyVel.set(0, 0, 0); }
    return this.flying;
  }
  updateFlight(dt, inp) {
    this.flyT = lerp(this.flyT, this.flying ? 1 : 0, 1 - Math.pow(0.03, dt));
    if (this.flyT < 0.01 && !this.flying) { this.flying = false; this.airborne = false; return; }
    const camF = V3(-Math.sin(inp.camYaw), 0, -Math.cos(inp.camYaw));
    const camR = V3(-camF.z, 0, camF.x);
    const intent = camF.multiplyScalar(inp.iy).addScaledVector(camR, inp.ix);
    if (intent.lengthSq() > 0.01) {
      const dir = intent.normalize(); this.flyVel.addScaledVector(dir, 14 * dt);
      const flatDir = V3(dir.x, 0, dir.z);
      if (flatDir.lengthSq() > 0.01 && this.fwd.lengthSq() > 0.01) {
        const turn = clamp(signedAngle(this.fwd, flatDir.normalize(), Y_UP) || 0, -2.2 * dt, 2.2 * dt);
        this.fwd.applyAxisAngle(Y_UP, turn);
      }
    }
    this.flyVel.y += 14 * dt;
    if (inp.iy > 0.1) this.flyVel.y += 6 * inp.iy * dt;
    if (inp.iy < -0.1) this.flyVel.y += 4 * inp.iy * dt;
    const speedMul = inp.sprint ? 1.6 : 1.0;
    this.flyVel.multiplyScalar(Math.pow(0.96, dt * 60));
    const spd = this.flyVel.length();
    if (spd > 18 * speedMul) this.flyVel.multiplyScalar(18 * speedMul / spd);
    this.pos.addScaledVector(this.flyVel, dt); this.curSpeed = spd;
    // Stay perfectly level in flight — no forward tilt
    this.up.copy(Y_UP);
    this.pos.x = clamp(this.pos.x, -FIELD / 2 + 5, FIELD / 2 - 5);
    this.pos.z = clamp(this.pos.z, -FIELD / 2 + 5, FIELD / 2 - 5);
    this.pos.y = clamp(this.pos.y, 5, 120);
    if (!this.flying && this.flyT < 0.15) {
      const tH = terrainH(this.pos.x, this.pos.z);
      if (this.pos.y - tH < this.rideClear + 2) { this.land(V3(this.pos.x, tH, this.pos.z), terrainN(this.pos.x, this.pos.z)); this.flyT = 0; return; }
    }
    this.heading = Math.atan2(this.fwd.x, this.fwd.z); this.rebuild(); this.bodyOrigin.copy(this.pos); this._updateAbdomen(dt); this.setRoot();
    this._poseFlightLegs();
    for (const aa of this.antennae) aa.step(dt);
    if (spd > 3) { const tailPos = this.abdomen.localToWorld(V3(0, 0.5 - this.PEDICEL.y, -2.5 - this.PEDICEL.z)); this._steamChimney.emit(tailPos, V3(0, 1, 0), 2, 2); }
    this._steamChimney.update(dt); this._steamJoint.update(dt);
  }
  _poseFlightLegs() {
    const t = this.flyT;
    for (const L of this.legs) {
      const hipW = this.root.localToWorld(L.hip.clone());
      const out = hipW.clone().sub(this.bodyOrigin); out.addScaledVector(this.up, -out.dot(this.up)); if (out.lengthSq() < 1e-4) out.copy(this.fwd); out.normalize();
      // Graceful flight pose: legs spread outward like wings, slightly swept back
      const spread = lerp(1, 1.8, t); // more spread
      const sweep = lerp(0, 0.3, t); // slight backward sweep
      const knee = hipW.clone()
        .addScaledVector(out, this.femur * spread)
        .addScaledVector(this.up, -this.femur * 0.15 * t) // slight droop
        .addScaledVector(this.fwd, -this.femur * sweep); // sweep back
      const ankle = knee.clone()
        .addScaledVector(out, this.tibia * 0.3)
        .addScaledVector(this.up, -this.tibia * 0.4)
        .addScaledVector(this.fwd, -this.tibia * sweep * 0.5);
      const foot = ankle.clone().addScaledVector(this.up, -this.tarsus * 0.2);
      L.plant.copy(foot);
      this._poseLegMeshes(L, hipW, knee, ankle, foot);
    }
  }
  pounce(dir, power = 1) {
    if (this.airborne) return; this.pos.copy(this.bodyOrigin);
    const d = dir ? dir.clone().normalize() : this.fwd.clone();
    this.vel.copy(d).multiplyScalar(11 * power).addScaledVector(this.up, 7 * power);
    this.airborne = true; this.tether = null;
  }
  jump(boost = false) {
    if (this.airborne) return; this.pos.copy(this.bodyOrigin);
    const moving = this.moveDir.lengthSq() > 0.04;
    const fwd = (moving ? this.moveDir : this.fwd).clone();
    fwd.addScaledVector(this.up, -fwd.dot(this.up)); if (fwd.lengthSq() < 1e-5) fwd.copy(this.fwd); fwd.normalize();
    const up = boost ? 8 : 10, fwdImpulse = (boost ? 17 : (moving ? 3 : 0)) + this.curSpeed * (boost ? 1.0 : 0.7);
    this.vel.copy(this.up).multiplyScalar(up).addScaledVector(fwd, fwdImpulse);
    this.airborne = true; this.tether = null;
    // Jump smoke burst
    for (const ch of this._chimneys) {
      const wp = this.root.localToWorld(ch.pos.clone());
      this._steamChimney.emit(wp, V3(0, 1, 0), 4, 5);
    }
  }
  attachTether(anchorPoint) {
    if (!this.airborne) this.pos.copy(this.bodyOrigin); this.airborne = true;
    this.tether = { anchor: anchorPoint.clone(), points: [anchorPoint.clone()], len: Math.max(1.5, this.pos.distanceTo(anchorPoint)), reel: 0 };
  }
  releaseTether() { if (!this.tether) return; this.tether = null; const sp = this.vel.length(); if (sp > 4) this.vel.addScaledVector(Y_UP, Math.min(sp * 0.55, 9)); }
  reel(rate) { if (this.tether) this.tether.reel = rate; }
  land(P, N) {
    this.airborne = false; this.tether = null; this.vel.set(0, 0, 0);
    if (N) this.up.copy(N).normalize();
    this.pos.copy(P); this.bodyOrigin.copy(this.pos).addScaledVector(this.up, this.rideClear); this.rebuild(); this.setRoot();
    for (const L of this.legs) { const hw = this.root.localToWorld(L.home.clone()); const g = this.footProbe(hw); L.plant.copy(g.point); L.surfN.copy(g.n); L.toN.copy(g.n); L.from.copy(g.point); L.to.copy(g.point); L.t = 1; L.stepping = false; }
    // Landing dust
    this._dustLand.emit(P.clone(), V3(0, 1, 0), 3, 8);
  }
  severLeg(i) { const L = this.legs[i]; if (!L || L.lost) return false; L.lost = true; this.legsLost++; L.femGroup.visible = L.tibGroup.visible = L.footGroup.visible = L.footLink.visible = false; return true; }
  regrowLeg(i) { const L = this.legs[i]; if (!L || !L.lost) return false; L.lost = false; this.legsLost--; L.femGroup.visible = L.tibGroup.visible = L.footGroup.visible = L.footLink.visible = true; return true; }
  updateAirborne(dt, inp) {
    if (dt <= 0) { this.bodyOrigin.copy(this.pos); this.rebuild(); this.setRoot(); return; }
    const G = 26; this.vel.y -= G * dt;
    if (inp && (inp.ix || inp.iy)) {
      const camF = V3(-Math.sin(inp.camYaw || 0), 0, -Math.cos(inp.camYaw || 0)); const camR = V3(-camF.z, 0, camF.x);
      this.vel.addScaledVector(camF.multiplyScalar(inp.iy).addScaledVector(camR, inp.ix), 16 * dt);
    }
    this.vel.multiplyScalar(1 - 0.09 * dt); const oldPos = this.pos.clone(); this.pos.addScaledVector(this.vel, dt);
    if (this.tether) {
      const T = this.tether; if (!T.points) T.points = [T.anchor];
      if (T.reel) T.len = clamp(T.len - T.reel * dt, 1.5, 60);
      if (T.points.length > 1) { const prev = T.points[T.points.length - 2], s2 = this.pos.clone().sub(prev), l2 = s2.length(); if (l2 > 0.6) { const dir = s2.multiplyScalar(1 / l2); const h = castAll(prev.clone().addScaledVector(dir, 0.3), dir, l2 - 0.5); if (!h) T.points.pop(); } }
      let consumed = 0; for (let i = 0; i < T.points.length - 1; i++) consumed += T.points[i].distanceTo(T.points[i + 1]);
      const active = T.points[T.points.length - 1]; const freeLen = Math.max(1.0, T.len - consumed);
      const d = this.pos.clone().sub(active); const dl = d.length() || 1e-6;
      if (dl > freeLen) { this.pos.copy(active).addScaledVector(d.multiplyScalar(1 / dl), freeLen); this.vel.copy(this.pos).sub(oldPos).multiplyScalar(1 / dt); }
      const seg = this.pos.clone().sub(active), sl = seg.length();
      if (sl > 0.8 && T.points.length < 6) { const dir = seg.multiplyScalar(1 / sl); const h = castAll(active.clone().addScaledVector(dir, 0.3), dir, sl - 0.5); if (h && h.point.distanceTo(active) > 0.8) T.points.push(h.point.clone().addScaledVector(h.n, 0.3)); }
    }
    if (!this.tether) {
      let bn = null, bpt = null, bd = this.rideClear;
      for (const c of colliders) { const cl = clearance(this.pos, c); if (cl.d >= bd) continue; if (-this.vel.dot(cl.n) > 1.5 || cl.d < this.minClear) { bn = cl.n.clone(); bpt = this.pos.clone().addScaledVector(cl.n, -cl.d); bd = cl.d; } }
      if (bn) { this.land(bpt, bn); return; }
    }
    for (const c of colliders) { const cl = clearance(this.pos, c); if (cl.d < 0.7) { this.pos.addScaledVector(cl.n, 0.7 - cl.d); const vn = this.vel.dot(cl.n); if (vn < 0) this.vel.addScaledVector(cl.n, -vn); } }
    this.up.lerp(Y_UP, 1 - Math.pow(0.015, dt)); this.up.normalize();
    const vh = V3(this.vel.x, 0, this.vel.z); if (vh.lengthSq() > 0.6) { this.fwd.lerp(vh.normalize(), 1 - Math.pow(0.12, dt)); this.fwd.y = 0; this.fwd.normalize(); }
    const downHit = castAll(this.pos.clone().add(V3(0, 0.5, 0)), DOWN, this.rideClear + 2.5);
    const tH = terrainH(this.pos.x, this.pos.z);
    const swinging = this.tether && this.vel.lengthSq() > 9;
    if (!swinging) {
      if (this.vel.y < 0 && downHit && this.pos.y - downHit.point.y < this.rideClear * 0.7) { this.land(downHit.point, downHit.n); return; }
      if (this.pos.y - this.rideClear < tH + 0.1) { this.land(V3(this.pos.x, tH, this.pos.z), terrainN(this.pos.x, this.pos.z)); return; }
    } else if (this.pos.y - this.rideClear < tH + 0.1) { this.pos.y = tH + this.rideClear + 0.1; }
    this.pos.x = clamp(this.pos.x, -FIELD / 2 + 3, FIELD / 2 - 3); this.pos.z = clamp(this.pos.z, -FIELD / 2 + 3, FIELD / 2 - 3);
    this.heading = Math.atan2(this.fwd.x, this.fwd.z); this.rebuild();
    this.bodyOrigin.copy(this.pos); this._updateAbdomen(dt > 0 ? dt : 1e-4); this.setRoot();
    this.poseAirborneLegs(); for (const aa of this.antennae) aa.step(dt);
  }
  poseAirborneLegs() {
    const down = this.up.clone().negate();
    for (const L of this.legs) {
      if (L.lost) continue;
      const hipW = this.root.localToWorld(L.hip.clone());
      const out = hipW.clone().sub(this.bodyOrigin); out.addScaledVector(this.up, -out.dot(this.up)); if (out.lengthSq() < 1e-4) out.copy(this.fwd); out.normalize();
      const knee = hipW.clone().addScaledVector(out, this.femur * 0.55).addScaledVector(down, this.femur * 0.5);
      const ankle = knee.clone().addScaledVector(down, this.tibia * 0.7).addScaledVector(out, -this.tibia * 0.2);
      const foot = ankle.clone().addScaledVector(down, this.tarsus);
      L.plant.copy(foot);
      this._poseLegMeshes(L, hipW, knee, ankle, foot);
    }
  }

  update(dt, inp) {
    if (this.flying || this.flyT > 0.01) { this.updateFlight(dt, inp); return; }
    if (this.airborne) { this.updateAirborne(dt, inp); return; }
    if (dt > 0) {
      this.rebuild();
      const mag = Math.min(1, Math.hypot(inp.ix, inp.iy));
      if (mag > 0.08) {
        const camF = V3(-Math.sin(inp.camYaw), 0, -Math.cos(inp.camYaw)); const camR = V3(-camF.z, 0, camF.x);
        const intent = camF.multiplyScalar(inp.iy).addScaledVector(camR, inp.ix);
        const dir = intent.clone().addScaledVector(this.up, -intent.dot(this.up));
        const steep = 1 - Math.abs(this.up.y);
        if (steep > 0.25) { const climbAmt = -intent.dot(this.up); const upWall = V3(0, 1, 0).addScaledVector(this.up, -this.up.y); if (upWall.lengthSq() > 1e-4) dir.addScaledVector(upWall.normalize(), climbAmt * steep); }
        if (dir.lengthSq() > 1e-5) {
          dir.normalize(); this.moveDir.copy(dir); this.curSpeed = this.baseSpeed * mag * (inp.sprint ? this.sprintMul : 1);
          this.pos.addScaledVector(dir, this.curSpeed * dt);
          const turn = clamp(signedAngle(this.fwd, dir, this.up), -this.turnRate * dt, this.turnRate * dt); this.fwd.applyAxisAngle(this.up, turn); this.rebuild();
        }
      } else { this.curSpeed = lerp(this.curSpeed, 0, 1 - Math.pow(0.0008, dt)); this.moveDir.multiplyScalar(0.86); }
      this.activity = this.curSpeed / this.baseSpeed;
      let feetC = null, feetN;
      { let cx = 0, cy = 0, cz = 0, wsum = 0, nx = 0, ny = 0, nz = 0;
        for (let i = 0; i < 8; i++) { const L = this.legs[i]; if (L.lost) continue; const A = L.plant, B = this.legs[(i + 1) % 8].plant; nx += (A.y - B.y) * (A.z + B.z); ny += (A.z - B.z) * (A.x + B.x); nz += (A.x - B.x) * (A.y + B.y); if (!L.stepping) { const homeW = this.root.localToWorld(L.home.clone()); const w = clamp01(1 - A.distanceTo(homeW) / (this.maxStride * 1.4)); cx += A.x * w; cy += A.y * w; cz += A.z * w; wsum += w; } }
        if (wsum > 1e-3) feetC = V3(cx / wsum, cy / wsum, cz / wsum);
        feetN = V3(nx, ny, nz); if (feetN.dot(this.up) < 0) feetN.negate(); if (feetN.lengthSq() < 1e-6) feetN.copy(this.up); feetN.normalize();
      }
      let g = castAll(this.pos.clone().addScaledVector(this.up, 1.6), this.up.clone().negate(), this.rideClear + 7);
      if (!g) g = castAll(this.pos.clone().add(V3(0, 3.5, 0)), DOWN, 22);
      if (g && this.curSpeed > 0.5) { const ahO = this.pos.clone().addScaledVector(this.moveDir, 1.2).addScaledVector(this.up, this.rideClear); const ah = castAll(ahO, this.up.clone().negate(), this.rideClear + 9); if (ah) { const dh = ah.point.clone().sub(g.point).dot(this.up); if (dh > 0) g.point.addScaledVector(this.up, Math.min(dh, this.rideClear)); } }
      let aheadN = null;
      if (this.curSpeed > 0.4) { const a = castAll(this.pos.clone().addScaledVector(this.up, 0.5), this.moveDir, this.bodyR + 1.4); if (a && a.n.dot(this.moveDir) < -0.2) aheadN = a.n.clone(); }
      let ridePt = g ? g.point.clone() : null;
      if (g && this.bodyConform && this.conformLift && feetC) { const rise = feetC.clone().sub(g.point).dot(this.up); const MAXLIFT = Math.max(2.2, this.stepH * 3 + 0.8); if (rise > 0) ridePt = g.point.clone().addScaledVector(this.up, Math.min(rise, MAXLIFT)); }
      if (ridePt) { const d = ridePt.clone().sub(this.pos); const dl = d.length(); const cap = (this.curSpeed * 1.7 + 9) * dt; if (dl > cap) this.pos.addScaledVector(d.multiplyScalar(1 / dl), cap); else this.pos.copy(ridePt); } else this.pos.y -= 9 * dt;
      const tH = terrainH(this.pos.x, this.pos.z); if (this.pos.y < tH - 0.3) this.pos.y = tH - 0.3;
      this.pos.x = clamp(this.pos.x, -FIELD / 2 + 3, FIELD / 2 - 3); this.pos.z = clamp(this.pos.z, -FIELD / 2 + 3, FIELD / 2 - 3); this.pos.y = clamp(this.pos.y, -12, 46);
      { const R = this.bodyR + this.legRad + 0.2; const push = V3(); let sidePen = 0; const p = this.pos.clone().addScaledVector(this.up, this.rideClear); for (const c of colliders) { const cc = c.kind === 'sphere' ? c.c : c.p; if (p.distanceTo(cc) > R + c.br + 1) continue; const cl = clearance(p, c); const nu = cl.n.dot(this.up); if (cl.d < R && nu > -0.3 && nu < 0.7) { const amt = R - cl.d; push.addScaledVector(cl.n, amt); if (amt > sidePen) sidePen = amt; } } if (sidePen > 1e-4) { push.addScaledVector(this.up, -push.dot(this.up)); let lift = sidePen; const back = push.dot(this.moveDir); if (back < 0) { push.addScaledVector(this.moveDir, -back); lift -= back; } push.addScaledVector(this.up, lift); const mag2 = Math.min(push.length(), 0.4); if (push.lengthSq() > 1e-9) this.pos.addScaledVector(push.normalize(), mag2); } }
      let surfN = g ? g.n.clone() : Y_UP.clone(); if (aheadN) surfN.multiplyScalar(0.35).addScaledVector(aheadN, 0.65).normalize();
      const fw = this.bodyConform ? this.conformTiltW : 0.2;
      const targetUp = surfN.multiplyScalar(1 - fw).addScaledVector(feetN, fw).normalize();
      this.up.lerp(targetUp, aheadN ? 1 - Math.pow(0.05, dt) : 1 - Math.pow(0.09, dt));
      if (this.up.lengthSq() < 1e-6 || !isFinite(this.up.x)) this.up.copy(Y_UP); this.up.normalize();
    }
    this.rebuild(); this.bodyOrigin.copy(this.pos).addScaledVector(this.up, this.rideClear);
    this.heading = Math.atan2(this.fwd.x, this.fwd.z); this._updateAbdomen(dt > 0 ? dt : 1e-4); this.setRoot();
    this.updateLegs(dt > 0 ? dt : 1e-4);
    // Chimney continuous smoke
    if (dt > 0) {
      const smokeRate = this.curSpeed > 0.5 ? (inp.sprint ? 3 : 1.5) : 0.5;
      if (Math.random() < smokeRate * dt * 10) {
        for (const ch of this._chimneys) {
          const wp = this.root.localToWorld(ch.pos.clone());
          this._steamChimney.emit(wp, V3(0, 1, 0), 1.5, 1);
        }
      }
      this._steamChimney.update(dt); this._steamJoint.update(dt); this._dustLand.update(dt);
    }
  }

  _poseLegMeshes(L, hipW, knee, ankle, foot) {
    const armR = L.armR;
    orientCyl(L.femGroup.children[0], hipW, knee, armR);
    L.femGroup.children[0].position.copy(hipW).add(knee).multiplyScalar(0.5);
    L.femGroup.children[1].position.copy(hipW);
    L.femGroup.children[1].scale.setScalar(armR * 0.98);
    const femSide = knee.clone().sub(hipW).cross(this.up);
    if (femSide.lengthSq() < 1e-5) femSide.copy(this.right);
    femSide.normalize().multiplyScalar(armR * 0.9);
    for (const [idx, sign] of [[2, 1], [3, -1]]) {
      const a = hipW.clone().addScaledVector(femSide, sign);
      const b = knee.clone().addScaledVector(femSide, sign);
      orientCyl(L.femGroup.children[idx], a, b, armR * 0.28);
      L.femGroup.children[idx].position.copy(a).add(b).multiplyScalar(0.5);
    }
    orientCyl(L.tibGroup.children[0], knee, ankle, armR * 0.85);
    L.tibGroup.children[0].position.copy(knee).add(ankle).multiplyScalar(0.5);
    L.tibGroup.children[1].position.copy(knee);
    L.tibGroup.children[1].scale.setScalar(armR * 0.9);
    const tibSide = ankle.clone().sub(knee).cross(this.up);
    if (tibSide.lengthSq() < 1e-5) tibSide.copy(this.right);
    tibSide.normalize().multiplyScalar(armR * 0.72);
    for (const [idx, sign] of [[2, 1], [3, -1]]) {
      const a = knee.clone().addScaledVector(tibSide, sign);
      const b = ankle.clone().addScaledVector(tibSide, sign);
      orientCyl(L.tibGroup.children[idx], a, b, armR * 0.24);
      L.tibGroup.children[idx].position.copy(a).add(b).multiplyScalar(0.5);
    }
    L.footGroup.position.copy(foot).addScaledVector(this.up, 0.08);
    L.footGroup.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(this.right, this.up, this.fwd));
    orientCyl(L.footLink.children[0], ankle, foot, armR * 0.28);
    L.footLink.children[0].position.copy(ankle).add(foot).multiplyScalar(0.5);
    L.footLink.children[1].position.copy(ankle);
    L.footLink.children[2].position.copy(foot).addScaledVector(this.up, 0.12);
  }



  updateLegs(dt) {
    const act = Math.max(this.activity || 0, 0.0001);
    const freq = this.baseFreq * act; if (act > 0.12) this.gaitPhase = frac((this.gaitPhase || 0) + dt * freq);
    const duty = this.duty; const stride = clamp((this.curSpeed / Math.max(freq, 0.25)) * 0.82, 0.35, this.maxStride);
    const swingDur = Math.max((1 - duty) / Math.max(freq, 0.3), 0.05), maxReach = this.femur + this.tibia;
    let swinging = 0; const reqs = [];
    for (let i = 0; i < 8; i++) {
      const L = this.legs[i]; if (L.lost) continue; if (L.stepping) { swinging++; continue; }
      const homeW = this.root.localToWorld(L.home.clone()); const hg = this.footProbe(homeW); L._home = hg.point;
      const hipW = this.root.localToWorld(L.hip.clone()); const reachFrac = hipW.distanceTo(L.plant) / maxReach;
      const lp = this.root.worldToLocal(L.plant.clone()); const dAz = wrapPi(Math.atan2(lp.x, lp.z) - L.restAz), r = Math.hypot(lp.x, lp.z);
      const blocked = occluded(hipW, L.plant);
      const outSec = dAz > L.ccw || dAz < -L.cw || r > L.rMax * 1.05 || r < L.rMin * 0.9 || reachFrac > 0.9 || blocked;
      const dHome = L.plant.distanceTo(hg.point); const legPhase = frac((this.gaitPhase || 0) + L.off); const phaseDue = act > 0.15 && legPhase > duty;
      if (phaseDue || dHome > this.stepThresh || outSec) reqs.push({ i, rf: reachFrac, bl: blocked, u: (outSec ? 2.4 : 0) + dHome * 0.45 + (phaseDue ? 1 : 0) + (reachFrac > 0.9 ? 3 : 0) + (blocked ? 2.5 : 0) });
    }
    reqs.sort((a, b) => b.u - a.u); const maxConc = act > 0.7 ? 4 : 3;
    for (const q of reqs) {
      const crit = q.rf > 0.95 || q.bl; const cap = q.bl ? 8 : (crit ? maxConc + 2 : maxConc);
      if (swinging >= cap) continue;
      const i = q.i, L = this.legs[i];
      if (!crit && (this.legs[(i + 1) % 8].stepping || this.legs[(i + 7) % 8].stepping)) continue;
      const desired = L._home.clone().addScaledVector(this.moveDir, stride);
      let dl = this.root.worldToLocal(desired.clone()); let az = L.restAz + clamp(wrapPi(Math.atan2(dl.x, dl.z) - L.restAz), -L.cw, L.ccw); let rr = clamp(Math.hypot(dl.x, dl.z), L.rMin, L.rMax);
      let w = this.root.localToWorld(V3(Math.sin(az) * rr, dl.y, Math.cos(az) * rr));
      for (let j = 0; j < 8; j++) { if (j === i || this.legs[j].stepping) continue; const f = this.legs[j].plant; const dx = w.x - f.x, dy = w.y - f.y, dz = w.z - f.z, d = Math.hypot(dx, dy, dz); if (d < this.minFoot && d > 1e-3) { w.x = f.x + dx / d * this.minFoot; w.y = f.y + dy / d * this.minFoot; w.z = f.z + dz / d * this.minFoot; } }
      dl = this.root.worldToLocal(w.clone()); az = L.restAz + clamp(wrapPi(Math.atan2(dl.x, dl.z) - L.restAz), -L.cw, L.ccw); rr = clamp(Math.hypot(dl.x, dl.z), L.rMin, L.rMax);
      w = this.root.localToWorld(V3(Math.sin(az) * rr, dl.y, Math.cos(az) * rr));
      const hipC = this.root.localToWorld(L.hip.clone());
      let g = this.footProbe(w), foot = g.point.clone();
      const spans = () => occluded(hipC, foot) || hipC.clone().sub(foot).dot(this.up) > this.rideClear + 1.3;
      for (let ti = 0; ti < 8 && spans(); ti++) { rr = Math.max(L.rMin * 0.7, rr * 0.66); const wc = this.root.localToWorld(V3(Math.sin(az) * rr, dl.y, Math.cos(az) * rr)); g = this.footProbe(wc); foot = g.point.clone(); }
      const tv = foot.clone().sub(hipC); const dd = tv.length(); const safe = maxReach * 0.86; if (dd > safe) foot = hipC.clone().addScaledVector(tv.multiplyScalar(1 / dd), safe);
      L.stepping = true; L.t = 0; L.from.copy(L.plant); L.to.copy(foot); L.toN.copy(g.n); swinging++;
      let mp = 0; for (let s = 1; s < 6; s++) { _depP.copy(L.from).lerp(L.to, s / 6); for (const c of colliders) { const d = clearance(_depP, c).d; if (-d > mp) mp = -d; } }
      let lift = Math.min(this.stepH + mp * 1.1, this.stepH + 1.3);
      const head = castAll(_depP.copy(L.from).lerp(L.to, 0.5).addScaledVector(this.up, 0.2), this.up, lift + 0.6);
      if (head) lift = Math.min(lift, Math.max(0.2, head.t - 0.3));
      L.lift = lift;
    }
    const upv = this.up;
    for (let i = 0; i < 8; i++) {
      const L = this.legs[i]; if (L.lost) continue;
      if (L.stepping) {
        L.t += dt / swingDur; const t = clamp01(L.t); L.plant.lerpVectors(L.from, L.to, smooth(t)); L.plant.addScaledVector(upv, (L.lift || this.stepH) * Math.sin(Math.PI * Math.pow(t, 0.82)));
        if (t >= 1) {
          L.stepping = false; L.plant.copy(L.to); L.surfN.copy(L.toN);
          if (this.curSpeed > 1.2) this.world.puff(L.plant);
          // Joint steam on step
          const hipW = this.root.localToWorld(L.hip.clone());
          this._steamJoint.emit(hipW, upv, 1.5, 2);
        }
      } else {
      }
      const hipW = this.root.localToWorld(L.hip.clone());
      let sN = L.surfN.clone(); sN.multiplyScalar(0.7).addScaledVector(upv, 0.3).normalize(); if (sN.dot(upv) < 0.15) sN.copy(upv);
      const basePole = L.pole.clone().applyQuaternion(this.root.quaternion); let nearC = null;
      const restAxisW = L.restAxisL.clone().applyQuaternion(this.root.quaternion);
      for (const c of colliders) { const cc = c.kind === 'sphere' ? c.c : c.p; if (hipW.distanceTo(cc) < this.legReach + c.br + 1.2) { (nearC || (nearC = [])).push(c); } }
      let foot = L.plant.clone();
      if (nearC) for (const c of nearC) { const cl = clearance(foot, c); const want = this.legRad * 0.6; if (cl.d < want) foot.addScaledVector(cl.n, want - cl.d); }
      { const th = terrainH(foot.x, foot.z); if (foot.y < th) foot.y = th; }
      let ankle = foot.clone().addScaledVector(sN, this.tarsus);
      const maxR = maxReach - 0.03; { const to = ankle.clone().sub(hipW); const da = to.length(); if (da > maxR) ankle = hipW.clone().addScaledVector(to.multiplyScalar(1 / da), maxR); }
      const solveKnee = (ank) => {
        if (!nearC) return { knee: ikKnee(hipW, ank, this.femur, this.tibia, basePole.clone().normalize(), restAxisW, V3()), pen: 0 };
        const axis = ank.clone().sub(hipW); const al = axis.length() || 1e-6; axis.multiplyScalar(1 / al);
        const rng = TUNE.aRange, ns = Math.max(1, TUNE.aSamp | 0); let best = 1e9, bk = null;
        for (let a = 0; a <= ns * 2; a++) {
          const ang = a === 0 ? 0 : (a & 1 ? 1 : -1) * Math.ceil(a / 2) * (rng / ns);
          const pole = basePole.clone().applyAxisAngle(axis, ang).normalize();
          const kk = ikKnee(hipW, ank, this.femur, this.tibia, pole, restAxisW, V3());
          const pen = segPen(hipW, kk, nearC, this.legRad + 0.05) + segPen(kk, ank, nearC, this.legRad + 0.05) + segPen(ank, foot, nearC, this.legRad + 0.05);
          const score = pen + Math.abs(ang) * 0.008;
          if (score < best) { best = score; bk = kk; }
        }
        return { knee: bk, pen: best };
      };
      const sol = solveKnee(ankle);
      let knee = sol.knee || ikKnee(hipW, ankle, this.femur, this.tibia, basePole.clone().normalize(), restAxisW, V3());
      const kneeIK = knee.clone();
      if (nearC) {
        const rad = this.legRad + 0.02;
        const depen = (pt) => { for (const c of nearC) { const cl = clearance(pt, c); if (cl.d < rad) pt.addScaledVector(cl.n, rad - cl.d); } const th = terrainH(pt.x, pt.z) + rad * 0.5; if (pt.y < th) pt.y = th; };
        depen(ankle); { const to = ankle.clone().sub(hipW); const da = to.length(); if (da > maxR) ankle = hipW.clone().addScaledVector(to.multiplyScalar(1 / da), maxR); }
        depen(knee);
        const th2 = (p) => terrainH(p.x, p.z) + rad * 0.5;
        for (let it = 0; it < 16; it++) {
          let kP = 0, kN = null, aP = 0, aN = null;
          for (const [a, b] of [[hipW, knee], [knee, ankle]]) for (let s = 1; s < 10; s++) { _depP.copy(a).lerp(b, s / 10); for (const c of nearC) { const cl = clearance(_depP, c); const p = rad - cl.d; if (p > kP) { kP = p; kN = cl.n; } } const tp = th2(_depP) - _depP.y; if (tp > kP) { kP = tp; kN = _kUp; } }
          for (let s = 0; s < 6; s++) { _depP.copy(ankle).lerp(foot, s / 6); for (const c of nearC) { const cl = clearance(_depP, c); const p = rad - cl.d; if (p > aP) { aP = p; aN = cl.n; } } }
          let moved = false;
          if (kN && kP > 0.01) { knee.addScaledVector(kN, Math.min(kP * 1.4 + 0.02, 0.5)); depen(knee); moved = true; }
          if (aN && aP > 0.01) { ankle.addScaledVector(aN, Math.min(aP + 0.02, 0.12)); const t = th2(ankle); if (ankle.y < t) ankle.y = t; const to = ankle.clone().sub(hipW); const da = to.length(); if (da > maxR) ankle = hipW.clone().addScaledVector(to.multiplyScalar(1 / da), maxR); moved = true; }
          if (!moved) break;
        }
        const kd = knee.clone().sub(kneeIK); const kdl = kd.length(); if (kdl > 1.3) { knee.copy(kneeIK).addScaledVector(kd, 1.3 / kdl); depen(knee); }
      }
      this._poseLegMeshes(L, hipW, knee, ankle, foot);
    }
  }

  get position() { return this.root.position; }
}
