import * as THREE from 'three';
import {
  V3, Q, Y_UP, DOWN, TAU, clamp, clamp01, frac, lerp, smooth, wrapPi, signedAngle,
  twoBoneKnee, twoBoneKneeDecomposed, orientCyl,
} from '../core/dynamics.js';
import { FIELD, terrainH, terrainN } from '../world/terrain.js';
import { colliders, castAll, clearance, occluded } from '../world/collision.js';
import { makeBrickTexture, makeStoneTexture, makeWoodTexture, makeRoofTexture, makeRustTexture, makePlasterTexture, texturedMat, toonMat, GHIBLI } from '../textures.js';

export const TUNE = { aRange: 3.14, aSamp: 8, decomposed: true };

function ikKnee(root, target, l1, l2, pole, restAxis, out) {
  return TUNE.decomposed
    ? twoBoneKneeDecomposed(root, target, l1, l2, pole, restAxis, out)
    : twoBoneKnee(root, target, l1, l2, pole, out);
}

const GEO = { cyl: new THREE.CylinderGeometry(1, 1, 1, 8), joint: new THREE.SphereGeometry(1, 10, 8) };
function matStd(c, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color: c, roughness: opts.r ?? 0.7, metalness: opts.m ?? 0.25,
    emissive: opts.e || 0x000000, emissiveIntensity: opts.ei ?? 0,
    flatShading: opts.flat ?? false, ...opts,
  });
}

const _t = V3(), _sp = V3(), _depP = V3(), _kUp = V3(0, 1, 0);
const _wUp = V3(), _lUp = V3();
const _qT = new THREE.Quaternion(), _qDroop = new THREE.Quaternion(), _qI = new THREE.Quaternion(), _qInv = new THREE.Quaternion();
const _XAX = V3(1, 0, 0), _YAX = V3(0, 1, 0);
function segPen(a, b, nearC, rad) {
  let pen = 0;
  for (let s = 0; s <= 5; s++) { _sp.copy(a).lerp(b, s * 0.2); for (const c of nearC) { const cl = clearance(_sp, c); const dd = rad - cl.d; if (dd > pen) pen = dd; } }
  return pen;
}

/* ---- verlet smoke / flags ---- */
const _vt = V3();
class Verlet {
  constructor(scene, anchor, localOff, n, seg, stiffDir, grav, color, rad) {
    this.anchor = anchor; this.localOff = localOff.clone(); this.n = n; this.seg = seg; this.stiff = stiffDir.clone(); this.grav = grav; this.rad = rad;
    this.pts = []; this.prev = []; const base = anchor.localToWorld(localOff.clone());
    for (let i = 0; i < n; i++) { const p = base.clone().addScaledVector(stiffDir, seg * i); this.pts.push(p); this.prev.push(p.clone()); }
    this.seg_m = []; const M = toonMat(color, { emissive: color, emissiveIntensity: 0.3 });
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

/* ============================================================
   CASTLE — Howl's Moving Castle (IK locomotion unchanged)
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
    this.flying = false; this.flyT = 0; this.flySpeed = 0; this.flyVel = V3();
    this.bodyConform = true; this.conformLift = false; this.conformTiltW = 0.5;
    this.bodyFlex = true; this.abHang = 0.45; this.abDroop = 0.1; this.abMax = 0.6;
    this.pos = V3(0, terrainH(0, 0), 0); this.bodyOrigin = V3(0, terrainH(0, 0) + this.rideClear, 0); this.quat = Q();
    this.root = new THREE.Group(); scene.add(this.root);
    this.buildBody(); this.buildLegs();
    this.antennae = [
      new Verlet(scene, this.root, V3(-0.8, 1.6, 0.0), 6, 0.4, V3(-0.1, 0.6, 0.05), 3.0, 0x8b6914, 0.06),
      new Verlet(scene, this.root, V3(0.8, 1.6, 0.0), 6, 0.4, V3(0.1, 0.6, -0.05), 3.0, 0x8b6914, 0.06),
    ];
    this.reset();
  }

  partOn(parent, geo, mat, x, y, z, sx, sy, sz) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); if (sx !== undefined) m.scale.set(sx, sy, sz); m.castShadow = true; parent.add(m); return m; }
  part(geo, mat, x, y, z, sx, sy, sz) { return this.partOn(this.root, geo, mat, x, y, z, sx, sy, sz); }

  buildBody() {
    // --- Ghibli toon materials ---
    const G = GHIBLI;
    const brickWall = toonMat(G.castleBrick);
    const stoneWall = toonMat(G.castleStone);
    const woodBeam  = toonMat(G.castleWood);
    const roofTile  = toonMat(G.castleRoof);
    const rustMetal = toonMat(G.castleRust);
    const plaster   = toonMat(G.castleWall);
    const iron      = toonMat(G.castleIron);
    const warmLight = toonMat(G.windowGlow, { emissive: G.windowGlow, emissiveIntensity: 1.2 });
    const eyeGlow   = toonMat(G.eyeGlow, { emissive: G.eyeGlow, emissiveIntensity: 1.8 });
    const eyeRim    = toonMat(G.eyeRim);
    const doorMat   = toonMat(G.mouthDark);
    const pipeMat   = toonMat(G.castleIron);
    const toothMat  = toonMat(G.toothBone);

    this.PEDICEL = V3(0, 0.0, -1.2);
    this.abdomen = new THREE.Group(); this.abdomen.position.copy(this.PEDICEL); this.root.add(this.abdomen);
    this._abQ = new THREE.Quaternion();

    // helper: tilted box
    const tbox = (w, h, d, mat, x, y, z, rx, ry, rz) => {
      const m = this.part(new THREE.BoxGeometry(w, h, d), mat, x, y, z);
      m.rotation.set(rx || 0, ry || 0, rz || 0); return m;
    };

    // ============================================================
    //  HAPHAZARD BODY — mismatched buildings piled chaotically
    // ============================================================

    // Base platform (wide, irregular)
    this.part(new THREE.BoxGeometry(4.0, 0.5, 3.4), stoneWall, 0, -0.55, -0.2);
    this.part(new THREE.BoxGeometry(3.6, 0.3, 3.0), stoneWall, 0, -0.15, -0.1);

    // Main hall (slightly tilted, like it was dropped on crooked)
    tbox(2.8, 2.0, 2.4, brickWall, 0.1, 1.0, 0.15, 0, 0.03, 0.02);
    // Second floor block — offset to the RIGHT, smaller, different color
    tbox(2.0, 1.4, 1.8, plaster, 0.5, 2.4, -0.2, 0, -0.05, 0.04);
    // Third floor — even more offset, green-tinted metal
    tbox(1.4, 1.0, 1.2, rustMetal, 0.8, 3.4, 0.0, 0, 0, 0.06);

    // Left tower — tall, leaning slightly
    tbox(1.0, 2.6, 0.9, stoneWall, -0.9, 2.6, 0.3, 0, 0, 0.08);
    this.part(new THREE.ConeGeometry(0.75, 1.3, 5), roofTile, -0.9, 4.3, 0.3);

    // Right chimney cluster — two thick chimneys, different heights
    this.part(new THREE.CylinderGeometry(0.25, 0.3, 1.6, 6), rustMetal, 1.0, 3.0, 0.3);
    this.part(new THREE.CylinderGeometry(0.2, 0.25, 1.2, 6), rustMetal, 1.4, 2.8, 0.1);
    // Smoke cap on chimney
    this.part(new THREE.CylinderGeometry(0.35, 0.25, 0.15, 6), rustMetal, 1.0, 3.85, 0.3);

    // Back extension — a lopsided room hanging off the back
    tbox(1.8, 1.2, 1.4, brickWall, -0.3, 1.2, -1.5, 0.05, 0, -0.04);
    // Small back chimney
    this.part(new THREE.CylinderGeometry(0.15, 0.18, 0.8, 5), rustMetal, -0.6, 2.2, -1.8);

    // Walkway/balcony — left side, with railing
    tbox(0.7, 0.12, 1.8, iron, -1.7, 1.6, 0.0, 0, 0, 0.03);
    for (const dz of [-0.7, -0.2, 0.3, 0.8]) this.part(new THREE.BoxGeometry(0.06, 0.35, 0.06), iron, -1.7, 1.85, dz);

    // Small windowed room on the right — like a bumped-out bay window
    tbox(0.8, 0.9, 0.7, woodBeam, 1.65, 1.5, 0.4, 0, 0.1, 0);

    // ============================================================
    //  FACE — big, menacing, movie-accurate
    // ============================================================

    // EYES — large round glowing discs with dark rims
    // Left eye: torus rim + glowing disc
    const eyeY = 2.3, eyeZ = 1.25, eyeSpacing = 0.55;
    for (const side of [-1, 1]) {
      const ex = side * eyeSpacing;
      // Eye rim (torus)
      const rimMesh = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.08, 8, 16), eyeRim);
      rimMesh.position.set(ex, eyeY, eyeZ); rimMesh.castShadow = true; this.root.add(rimMesh);
      // Eye glow (disc)
      const disc = new THREE.Mesh(new THREE.CircleGeometry(0.42, 16), eyeGlow);
      disc.position.set(ex, eyeY, eyeZ + 0.01); this.root.add(disc);
    }
    // Angry eyebrows — thick slanted bars above each eye
    const browL = tbox(0.5, 0.12, 0.22, iron, -eyeSpacing, eyeY + 0.42, eyeZ, 0, 0, 0.18);
    const browR = tbox(0.5, 0.12, 0.22, iron,  eyeSpacing, eyeY + 0.42, eyeZ, 0, 0, -0.18);

    // NOSE — triangular protruding wedge
    const noseG = new THREE.ConeGeometry(0.22, 0.65, 4);
    const noseM = new THREE.Mesh(noseG, stoneWall);
    noseM.position.set(0, eyeY - 0.35, eyeZ + 0.35);
    noseM.rotation.x = -0.25; noseM.rotation.y = Math.PI / 4;
    noseM.castShadow = true; this.root.add(noseM);

    // MOUTH — wide jagged grin with teeth
    const mouthY = 1.2, mouthZ = 1.3;
    // Mouth opening (dark recessed area)
    tbox(1.8, 0.6, 0.2, doorMat, 0, mouthY, mouthZ);
    // Upper teeth — jagged row of pointed blocks
    for (let i = 0; i < 7; i++) {
      const tx = -0.7 + i * 0.23;
      const th = 0.12 + (i % 2) * 0.08;  // alternating heights
      this.part(new THREE.BoxGeometry(0.16, th * 1.3, 0.18), toothMat, tx, mouthY + 0.35 - th * 0.5, mouthZ + 0.05);
    }
    // Lower teeth
    for (let i = 0; i < 6; i++) {
      const tx = -0.55 + i * 0.24;
      const th = 0.1 + ((i + 1) % 2) * 0.07;
      this.part(new THREE.BoxGeometry(0.13, th, 0.13), toothMat, tx, mouthY - 0.35 + th * 0.5, mouthZ + 0.05);
    }

    // ============================================================
    //  SIDE DECORATIONS — big wheel, pipes, gears, crane
    // ============================================================

    // Large decorative wheel/fan on the RIGHT side
    const wheelG = new THREE.Group();
    const bigRim = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.1, 8, 20), rustMetal);
    wheelG.add(bigRim);
    // Hub
    wheelG.add(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.25, 8), rustMetal));
    // 8 spokes
    for (let i = 0; i < 8; i++) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.06, 0.06), pipeMat);
      spoke.rotation.z = (i / 8) * Math.PI; wheelG.add(spoke);
    }
    wheelG.position.set(1.8, 1.8, -0.3);
    wheelG.rotation.y = Math.PI / 2;
    this.root.add(wheelG);
    this._sideWheel = wheelG;  // store for animation

    // Pipes winding around the body
    const pipePts = [
      [1.3, 0.5, 0.8, 1.3, 2.0, 0.8],   // vertical right-front
      [-1.3, 0.3, 0.5, -1.3, 1.8, 0.5],  // vertical left-front
      [0.8, 2.5, 0.8, 0.8, 2.5, -1.0],   // horizontal on second floor
      [-0.5, 3.2, 0.3, -0.5, 3.2, -0.8], // horizontal on tower
    ];
    for (const [x1, y1, z1, x2, y2, z2] of pipePts) {
      const dx = x2 - x1, dy = y2 - y1, dz = z2 - z1;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, len, 6), pipeMat);
      pipe.position.set((x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2);
      // orient along the direction
      const dir = V3(dx, dy, dz).normalize();
      pipe.quaternion.setFromUnitVectors(V3(0, 1, 0), dir);
      pipe.castShadow = true; this.root.add(pipe);
    }

    // Small gear decorations (torus as gear ring)
    for (const [gx, gy, gz, r] of [[-1.0, 2.8, 0.8, 0.25], [1.5, 2.6, -0.6, 0.2], [0.2, 3.5, 0.5, 0.18]]) {
      const gear = new THREE.Mesh(new THREE.TorusGeometry(r, 0.03, 6, 12), pipeMat);
      gear.position.set(gx, gy, gz); gear.rotation.x = Math.random() * 0.5;
      gear.castShadow = true; this.root.add(gear);
    }

    // Crane/arm extending from the top-left
    const armBase = this.part(new THREE.BoxGeometry(0.3, 0.3, 0.3), rustMetal, -1.2, 3.8, 0.0);
    const arm1 = this.part(new THREE.CylinderGeometry(0.05, 0.05, 2.0, 6), pipeMat, -1.2, 4.8, 0.0);
    arm1.rotation.z = 0.4;
    const arm2 = this.part(new THREE.CylinderGeometry(0.04, 0.04, 1.2, 6), pipeMat, -2.0, 5.4, 0.0);
    arm2.rotation.z = -0.6;
    // Dangling hook/chain
    this.part(new THREE.CylinderGeometry(0.02, 0.02, 0.6, 4), pipeMat, -2.5, 5.0, 0.0);

    // ============================================================
    //  SIDE & BACK WINDOWS — warm glow
    // ============================================================
    for (const side of [-1, 1]) {
      for (const [dy, dz] of [[0.5, 0.3], [0.5, -0.5], [1.5, 0.0], [2.3, -0.1]]) {
        this.part(new THREE.BoxGeometry(0.1, 0.28, 0.22), warmLight, side * 1.45, 0.7 + dy, dz);
      }
    }
    for (const [dx, dy] of [[-0.4, 0.8], [0.4, 0.8], [0, 1.8], [-0.7, 1.2]]) {
      this.part(new THREE.BoxGeometry(0.28, 0.22, 0.1), warmLight, dx, dy, -1.3);
    }

    // ============================================================
    //  TRAILING SECTION (abdomen — boiler room)
    // ============================================================
    const py = this.PEDICEL.y, pz = this.PEDICEL.z;
    this.body = this.partOn(this.abdomen, new THREE.BoxGeometry(2.6, 1.8, 2.4), rustMetal, 0, 0.0 - py, -1.8 - pz);
    // Furnace slit
    this.partOn(this.abdomen, new THREE.BoxGeometry(2.2, 0.18, 0.12), warmLight, 0, -0.1 - py, -0.65 - pz);
    // Rear chimney
    this.partOn(this.abdomen, new THREE.CylinderGeometry(0.2, 0.25, 0.9, 6), rustMetal, 0.6, 1.0 - py, -2.4 - pz);
    this.partOn(this.abdomen, new THREE.CylinderGeometry(0.15, 0.18, 0.6, 5), rustMetal, -0.4, 0.8 - py, -2.6 - pz);
    // Connecting pipes
    this.partOn(this.abdomen, new THREE.CylinderGeometry(0.07, 0.07, 1.2, 6), pipeMat, -0.6, 0.2 - py, -0.5 - pz);
    this.partOn(this.abdomen, new THREE.CylinderGeometry(0.07, 0.07, 1.2, 6), pipeMat,  0.6, 0.2 - py, -0.5 - pz);
    // A small gear on the back
    const backGear = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.04, 6, 12), pipeMat);
    backGear.position.set(0, 0.5 - py, -2.95 - pz); this.abdomen.add(backGear);

    // Calcifer fire glow — warm red point light inside the castle
    this._calciferLight = new THREE.PointLight(0xE85030, 2, 8);
    this._calciferLight.position.set(0, 0.8, 0);
    this.root.add(this._calciferLight);
  }

  buildLegs() {
    const G = GHIBLI;
    const fem = toonMat(G.castleRust);
    const tib = toonMat(G.castleIron);
    const jnt = toonMat(G.eyeRim);
    const wheelMat = toonMat(G.castleRust);
    const spokeMat = toonMat(G.castleIron);
    const axleMat  = toonMat(G.eyeRim);
    const spec = [
      { az: 0.50, off: 0.50 }, { az: 1.12, off: 0.33 }, { az: 1.78, off: 0.17 }, { az: 2.42, off: 0.00 },
      { az: -2.42, off: 0.50 }, { az: -1.78, off: 0.67 }, { az: -1.12, off: 0.83 }, { az: -0.50, off: 0.00 },
    ];
    const rHip = 1.35, rHome = 3.8; this.legs = [];
    for (const s of spec) {
      const ox = Math.sin(s.az), oz = Math.cos(s.az); const home = V3(ox * rHome, 0, oz * rHome);
      const L = {
        hip: V3(ox * rHip, 0.0, oz * rHip), home, off: s.off, pole: V3(ox * 0.85, 1.45, oz * 0.85).normalize(),
        restAz: Math.atan2(home.x, home.z), restR: rHome, rMin: rHome * 0.78, rMax: rHome * 1.2, ccw: 0.3, cw: 0.3,
        femurM: new THREE.Mesh(GEO.cyl, fem), tibiaM: new THREE.Mesh(GEO.cyl, tib), tarsusM: null,
        kneeM: new THREE.Mesh(GEO.joint, jnt), hipM: new THREE.Mesh(GEO.joint, jnt),
        plant: V3(), from: V3(), to: V3(), surfN: Y_UP.clone(), toN: Y_UP.clone(), t: 1, stepping: false,
        wheelAngle: 0,
      };
      // build wheel assembly: torus rim + 6 spokes + axle
      const WR = 0.42, tubeR = 0.07;
      const wheelG = new THREE.Group();
      const rim = new THREE.Mesh(new THREE.TorusGeometry(WR, tubeR, 8, 16), wheelMat); rim.castShadow = true;
      wheelG.add(rim);
      const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, WR * 2.2, 6), axleMat);
      axle.rotation.z = Math.PI / 2; axle.castShadow = true; wheelG.add(axle);
      for (let si = 0; si < 6; si++) {
        const ang = (si / 6) * Math.PI;
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(WR * 1.7, 0.04, 0.04), spokeMat);
        spoke.rotation.z = ang; spoke.castShadow = true; wheelG.add(spoke);
      }
      L.tarsusM = wheelG;
      L.restAxisL = home.clone().sub(L.hip).normalize();
      L.femurM.castShadow = L.tibiaM.castShadow = L.kneeM.castShadow = L.hipM.castShadow = true;
      L.kneeM.scale.setScalar(0.28); L.hipM.scale.setScalar(0.34);
      this.scene.add(L.femurM, L.tibiaM, L.tarsusM, L.kneeM, L.hipM); this.legs.push(L);
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
    const br = 1 + Math.sin(performance.now() * 0.002) * 0.008;
    const f = 1 + clamp01(this.fill || 0) * 0.3;
    this.body.scale.set(1.0 * f, 0.9 * br * f, 1.0 * f);
    // spin the decorative side wheel
    if (this._sideWheel) { this._wheelSpin = (this._wheelSpin || 0) + this.curSpeed * 0.04; this._sideWheel.rotation.y = Math.PI / 2 + this._wheelSpin; }
    // Calcifer flicker
    if (this._calciferLight) { this._calciferLight.intensity = 1.8 + Math.sin(performance.now() * 0.01) * 0.4 + Math.sin(performance.now() * 0.023) * 0.2; }
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
  toggleFlight() {
    this.flying = !this.flying;
    if (this.flying) {
      // take off: give upward velocity
      this.airborne = true;
      this.vel.copy(this.up).multiplyScalar(12);
      this.flyVel.set(0, 0, 0);
    } else {
      // landing will happen naturally when close to ground
    }
    return this.flying;
  }
  updateFlight(dt, inp) {
    // smooth fly transition (0=ground, 1=full flight)
    this.flyT = lerp(this.flyT, this.flying ? 1 : 0, 1 - Math.pow(0.03, dt));
    if (this.flyT < 0.01 && !this.flying) { this.flying = false; this.airborne = false; return; }

    const flyGravity = -4; // reduced gravity in flight
    const flyLift = 18;    // upward thrust
    const flyForward = 14; // forward acceleration
    const flyTurnRate = 2.2;
    const maxFlySpeed = 18;
    const drag = 0.96;

    // input → flight direction
    const camF = V3(-Math.sin(inp.camYaw), 0, -Math.cos(inp.camYaw));
    const camR = V3(-camF.z, 0, camF.x);
    const intent = camF.multiplyScalar(inp.iy).addScaledVector(camR, inp.ix);

    // forward thrust
    if (intent.lengthSq() > 0.01) {
      const dir = intent.normalize();
      this.flyVel.addScaledVector(dir, flyForward * dt);
      // turn castle to face movement direction
      const flatDir = V3(dir.x, 0, dir.z);
      if (flatDir.lengthSq() > 0.01) {
        const fd = flatDir.normalize();
        if (fd.lengthSq() > 0.01 && this.fwd.lengthSq() > 0.01) {
          const turn = clamp(signedAngle(this.fwd, fd, Y_UP) || 0, -flyTurnRate * dt, flyTurnRate * dt);
          this.fwd.applyAxisAngle(Y_UP, turn);
        }
      }
    }

    // lift: always maintain some upward force when flying
    this.flyVel.y += (flyLift + flyGravity) * dt;
    // if going up (W pressed), extra lift
    if (inp.iy > 0.1) this.flyVel.y += 6 * inp.iy * dt;
    // if going down (S pressed), reduce lift
    if (inp.iy < -0.1) this.flyVel.y += 4 * inp.iy * dt;

    // sprint = boost
    const speedMul = inp.sprint ? 1.6 : 1.0;

    // drag
    this.flyVel.multiplyScalar(Math.pow(drag, dt * 60));

    // clamp speed
    const spd = this.flyVel.length();
    if (spd > maxFlySpeed * speedMul) this.flyVel.multiplyScalar(maxFlySpeed * speedMul / spd);

    // apply velocity
    this.pos.addScaledVector(this.flyVel, dt);
    this.curSpeed = spd;

    // tilt castle based on velocity (banking) — with NaN safety
    this.up.lerp(Y_UP, 1 - Math.pow(0.1, dt));
    if (!isFinite(this.up.x) || this.up.lengthSq() < 1e-6) this.up.copy(Y_UP);
    // add slight forward tilt when moving fast
    if (spd > 2) {
      const tiltAxis = this.fwd.clone().cross(Y_UP);
      if (tiltAxis.lengthSq() > 1e-6) {
        tiltAxis.normalize();
        const tiltAngle = clamp(spd * 0.015, 0, 0.3);
        const tiltQ = new THREE.Quaternion().setFromAxisAngle(tiltAxis, tiltAngle);
        this.up.applyQuaternion(tiltQ).normalize();
      }
    }
    if (!isFinite(this.up.x) || this.up.lengthSq() < 1e-6) this.up.copy(Y_UP);

    // boundary
    this.pos.x = clamp(this.pos.x, -FIELD / 2 + 5, FIELD / 2 - 5);
    this.pos.z = clamp(this.pos.z, -FIELD / 2 + 5, FIELD / 2 - 5);
    this.pos.y = clamp(this.pos.y, 5, 120);

    // check if we should land (flying=false and close to ground)
    if (!this.flying && this.flyT < 0.15) {
      const tH = terrainH(this.pos.x, this.pos.z);
      if (this.pos.y - tH < this.rideClear + 2) {
        this.land(V3(this.pos.x, tH, this.pos.z), terrainN(this.pos.x, this.pos.z));
        this.flyT = 0;
        return;
      }
    }

    this.heading = Math.atan2(this.fwd.x, this.fwd.z);
    this.rebuild();
    this.bodyOrigin.copy(this.pos);
    this._updateAbdomen(dt);
    this.setRoot();

    // fold legs during flight
    this._poseFlightLegs();

    // update smoke/steam from chimneys
    for (const aa of this.antennae) aa.step(dt);

    // emit flight particles
    if (this.world && spd > 3) {
      const tailPos = this.abdomen.localToWorld(V3(0, 0.5 - this.PEDICEL.y, -2.5 - this.PEDICEL.z));
      this.world.puff(tailPos);
    }
  }
  _poseFlightLegs() {
    // fold legs outward and slightly back during flight (like wings)
    const t = this.flyT;
    for (const L of this.legs) {
      if (L.lost) continue;
      const hipW = this.root.localToWorld(L.hip.clone());
      const out = hipW.clone().sub(this.bodyOrigin);
      out.addScaledVector(this.up, -out.dot(this.up));
      if (out.lengthSq() < 1e-4) out.copy(this.fwd);
      out.normalize();

      // spread outward more during flight
      const spread = lerp(1, 1.8, t);
      const droop = lerp(0.5, 0.15, t); // less droop in flight
      const knee = hipW.clone().addScaledVector(out, this.femur * spread).addScaledVector(this.up, -this.femur * droop);
      const ankle = knee.clone().addScaledVector(out, this.tibia * 0.3).addScaledVector(this.up, -this.tibia * 0.6);
      const foot = ankle.clone().addScaledVector(this.up, -this.tarsus * 0.5);

      L.plant.copy(foot);
      orientCyl(L.femurM, hipW, knee, this.legRad);
      orientCyl(L.tibiaM, knee, ankle, this.legRad * 0.8);
      this._orientWheel(L, ankle, foot);
      L.kneeM.position.copy(knee);
      L.hipM.position.copy(hipW);
    }
  }
  teleport(x, z, headingVec) {
    this.up.copy(Y_UP);
    if (headingVec) { this.fwd.copy(headingVec); this.fwd.y = 0; if (this.fwd.lengthSq() < 1e-6) this.fwd.set(0, 0, 1); this.fwd.normalize(); }
    else this.fwd.set(0, 0, 1);
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
    fwd.addScaledVector(this.up, -fwd.dot(this.up));
    if (fwd.lengthSq() < 1e-5) fwd.copy(this.fwd); fwd.normalize();
    const up = boost ? 8 : 10;
    const fwdImpulse = (boost ? 17 : (moving ? 3 : 0)) + this.curSpeed * (boost ? 1.0 : 0.7);
    this.vel.copy(this.up).multiplyScalar(up).addScaledVector(fwd, fwdImpulse);
    this.airborne = true; this.tether = null;
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
    for (const L of this.legs) { if (L.lost) continue; const hw = this.root.localToWorld(L.home.clone()); const g = this.footProbe(hw); L.plant.copy(g.point); L.surfN.copy(g.n); L.toN.copy(g.n); L.from.copy(g.point); L.to.copy(g.point); L.t = 1; L.stepping = false; }
  }
  severLeg(i) { const L = this.legs[i]; if (!L || L.lost) return false; L.lost = true; this.legsLost++; for (const m of [L.femurM, L.tibiaM, L.tarsusM, L.kneeM, L.hipM]) m.visible = false; return true; }
  regrowLeg(i) { const L = this.legs[i]; if (!L || !L.lost) return false; L.lost = false; this.legsLost--; for (const m of [L.femurM, L.tibiaM, L.tarsusM, L.kneeM, L.hipM]) m.visible = true; return true; }
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
      L.plant.copy(foot); L._hipW = hipW; L._knee = knee; L._ankle = ankle; L._foot = foot;
      orientCyl(L.femurM, hipW, knee, this.legRad); orientCyl(L.tibiaM, knee, ankle, this.legRad * 0.8);
      this._orientWheel(L, ankle, foot);
      L.kneeM.position.copy(knee); L.hipM.position.copy(hipW);
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
        for (let i = 0; i < 8; i++) {
          const L = this.legs[i]; if (L.lost) continue; const A = L.plant, B = this.legs[(i + 1) % 8].plant;
          nx += (A.y - B.y) * (A.z + B.z); ny += (A.z - B.z) * (A.x + B.x); nz += (A.x - B.x) * (A.y + B.y);
          if (!L.stepping) { const homeW = this.root.localToWorld(L.home.clone()); const w = clamp01(1 - A.distanceTo(homeW) / (this.maxStride * 1.4)); cx += A.x * w; cy += A.y * w; cz += A.z * w; wsum += w; }
        }
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
      if (ridePt) { const d = ridePt.clone().sub(this.pos); const dl = d.length(); const cap = (this.curSpeed * 1.7 + 9) * dt; if (dl > cap) this.pos.addScaledVector(d.multiplyScalar(1 / dl), cap); else this.pos.copy(ridePt); }
      else this.pos.y -= 9 * dt;
      const tH = terrainH(this.pos.x, this.pos.z); if (this.pos.y < tH - 0.3) this.pos.y = tH - 0.3;
      this.pos.x = clamp(this.pos.x, -FIELD / 2 + 3, FIELD / 2 - 3); this.pos.z = clamp(this.pos.z, -FIELD / 2 + 3, FIELD / 2 - 3); this.pos.y = clamp(this.pos.y, -12, 46);
      { const R = this.bodyR + this.legRad + 0.2; const push = V3(); let sidePen = 0; const p = this.pos.clone().addScaledVector(this.up, this.rideClear);
        for (const c of colliders) { const cc = c.kind === 'sphere' ? c.c : c.p; if (p.distanceTo(cc) > R + c.br + 1) continue; const cl = clearance(p, c); const nu = cl.n.dot(this.up); if (cl.d < R && nu > -0.3 && nu < 0.7) { const amt = R - cl.d; push.addScaledVector(cl.n, amt); if (amt > sidePen) sidePen = amt; } }
        if (sidePen > 1e-4) { push.addScaledVector(this.up, -push.dot(this.up)); let lift = sidePen; const back = push.dot(this.moveDir); if (back < 0) { push.addScaledVector(this.moveDir, -back); lift -= back; } push.addScaledVector(this.up, lift); const mag2 = Math.min(push.length(), 0.4); if (push.lengthSq() > 1e-9) this.pos.addScaledVector(push.normalize(), mag2); }
      }
      let surfN = g ? g.n.clone() : Y_UP.clone(); if (aheadN) surfN.multiplyScalar(0.35).addScaledVector(aheadN, 0.65).normalize();
      const fw = this.bodyConform ? this.conformTiltW : 0.2;
      const targetUp = surfN.multiplyScalar(1 - fw).addScaledVector(feetN, fw).normalize();
      this.up.lerp(targetUp, aheadN ? 1 - Math.pow(0.05, dt) : 1 - Math.pow(0.09, dt));
      if (this.up.lengthSq() < 1e-6 || !isFinite(this.up.x)) this.up.copy(Y_UP); this.up.normalize();
    }
    this.rebuild(); this.bodyOrigin.copy(this.pos).addScaledVector(this.up, this.rideClear);
    this.heading = Math.atan2(this.fwd.x, this.fwd.z); this._updateAbdomen(dt > 0 ? dt : 1e-4); this.setRoot();
    this.updateLegs(dt > 0 ? dt : 1e-4);
    if (dt > 0) for (const a of this.antennae) a.step(dt);
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
        if (t >= 1) { L.stepping = false; L.plant.copy(L.to); L.surfN.copy(L.toN); if (this.curSpeed > 1.2) this.world.puff(L.plant); }
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
      orientCyl(L.femurM, hipW, knee, this.legRad); orientCyl(L.tibiaM, knee, ankle, this.legRad * 0.8);
      this._orientWheel(L, ankle, foot);
      L.kneeM.position.copy(knee); L.hipM.position.copy(hipW);
      L._hipW = hipW; L._knee = knee; L._ankle = ankle; L._foot = foot;
    }
  }
  _orientWheel(L, ankle, foot) {
    const WR = 0.42;
    const wheelG = L.tarsusM;
    if (!wheelG) return;
    const legDir = foot.clone().sub(ankle); legDir.addScaledVector(this.up, -legDir.dot(this.up));
    if (legDir.lengthSq() < 1e-6) legDir.copy(this.fwd);
    legDir.normalize();
    const axle = this.up.clone().cross(legDir);
    if (axle.lengthSq() < 1e-6) axle.set(1, 0, 0);
    axle.normalize();
    wheelG.position.copy(foot).addScaledVector(this.up, WR);
    const q = new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), axle);
    const spinQ = new THREE.Quaternion().setFromAxisAngle(axle, L.wheelAngle);
    wheelG.quaternion.copy(spinQ).multiply(q);
    L.wheelAngle += this.curSpeed * 0.08;
  }
  get position() { return this.root.position; }
}
