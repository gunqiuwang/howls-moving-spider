import * as THREE from 'three';
import { World } from './world/World.js';
import { Spider, TUNE } from './spider/Spider.js';
import { SpiderCamera } from './camera/SpiderCamera.js';
import { Input } from './core/Input.js';
import { V3 } from './core/dynamics.js';

const TOUCH = matchMedia('(pointer:coarse)').matches || 'ontouchstart' in window;
const errEl = document.getElementById('err');
function fatal(msg) { errEl.style.display = 'flex'; errEl.textContent = msg; }

let renderer, scene, camera, world, spider, spiderCam, input;
try {
  const app = document.getElementById('app');
  renderer = new THREE.WebGLRenderer({ antialias: !TOUCH, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, TOUCH ? 1.5 : 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.3;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  app.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 700);

  world = new World(scene);
  spider = new Spider(scene, world);
  spiderCam = new SpiderCamera(camera);
  input = new Input(renderer.domElement, spiderCam);
  input.onReset = () => { spider.reset(); if (window._game) window._game.score = 0; window._game.respawnCoins(); };
  input.onJump = (boost) => spider.jump(boost);
  input.onFlight = () => {
    try {
      const flying = spider.toggleFlight();
      document.getElementById('flight-indicator').style.display = flying ? 'block' : 'none';
      const flyBtn = document.getElementById('flybtn');
      if (flyBtn) { flyBtn.classList.toggle('active', flying); flyBtn.textContent = flying ? 'LAND' : 'FLY'; }
      return flying;
    } catch(e) { console.error('Flight toggle error:', e); return false; }
  };
} catch (err) {
  fatal('Init error: ' + (err && err.message ? err.message : err));
  console.error(err);
}

// ============================================================
//  GAME SYSTEM — coins + score
// ============================================================
class Game {
  constructor(scene, spider) {
    this.scene = scene; this.spider = spider;
    this.score = 0; this.totalCoins = 0;
    this.coins = [];
    this._collectSound = this._createCollectSound();
    this._spawnCoins();
    this._updateHUD();
  }

  _createCollectSound() {
    // Simple 8-bit coin sound using Web Audio API
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      return () => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = 'square';
        osc.frequency.setValueAtTime(988, ctx.currentTime); // B5
        osc.frequency.setValueAtTime(1319, ctx.currentTime + 0.06); // E6
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.2);
      };
    } catch(e) { return () => {}; }
  }

  _spawnCoins() {
    // Clean up old coins
    for (const c of this.coins) { if (c.mesh.parent) c.mesh.parent.remove(c.mesh); }
    this.coins = [];
    this.totalCoins = 0;

    const { terrainH } = require('./world/terrain.js') || {};
    // Spawn coins around the world
    const coinPositions = [
      // Near center (easy)
      [5, 0], [-3, 4], [2, -5], [-6, -3], [4, 6],
      // Medium distance
      [12, 8], [-10, 12], [15, -5], [-12, -8], [8, -12],
      [20, 15], [-18, 20], [22, -12], [-15, -18], [10, 22],
      // Far (hard to reach)
      [30, 25], [-28, 30], [35, -20], [-32, -25], [25, 35],
      // On elevated terrain
      [-8, -20], [18, -22], [-25, 10], [28, 5], [-5, 30],
      // Scattered
      [40, 10], [-35, -15], [15, 40], [-40, 20], [30, -30],
    ];

    const coinGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.08, 16);
    const coinMat = new THREE.MeshStandardMaterial({
      color: 0xFFD700, emissive: 0xFFAA00, emissiveIntensity: 0.4,
      roughness: 0.3, metalness: 0.8,
    });
    const starMat = new THREE.MeshStandardMaterial({
      color: 0xFF6B35, emissive: 0xFF4500, emissiveIntensity: 0.6,
      roughness: 0.3, metalness: 0.7,
    });

    for (let i = 0; i < coinPositions.length; i++) {
      const [cx, cz] = coinPositions[i];
      const x = cx * 2; const z = cz * 2;
      // Dynamic import won't work here, use the terrain function from world
      // We'll calculate y from the scene instead
      const raycaster = new THREE.Raycaster();
      raycaster.set(new THREE.Vector3(x, 100, z), new THREE.Vector3(0, -1, 0));
      // Just use a fixed height offset, will be adjusted in update
      const y = 1.5; // will be corrected on first frame

      const isSpecial = i % 10 === 9; // every 10th coin is a star (worth 5)
      const mesh = new THREE.Mesh(coinGeo, isSpecial ? starMat.clone() : coinMat.clone());
      mesh.rotation.x = Math.PI / 2;
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      this.scene.add(mesh);

      this.coins.push({
        mesh, x, z, y: y,
        collected: false,
        value: isSpecial ? 5 : 1,
        bobPhase: Math.random() * Math.PI * 2,
        glowPhase: Math.random() * Math.PI * 2,
        baseY: y,
        grounded: false,
      });
      this.totalCoins += isSpecial ? 5 : 1;
    }
  }

  respawnCoins() {
    for (const c of this.coins) {
      c.collected = false; c.mesh.visible = true;
      c.grounded = false;
    }
    this._updateHUD();
  }

  _updateHUD() {
    const scoreEl = document.getElementById('score');
    const coinsEl = document.getElementById('coins');
    if (scoreEl) scoreEl.textContent = this.score;
    if (coinsEl) {
      const remaining = this.coins.filter(c => !c.collected).length;
      coinsEl.textContent = remaining + '/' + this.coins.length;
    }
  }

  update(dt) {
    if (!this.spider) return;
    const spiderPos = this.spider.position;
    const t = performance.now() * 0.001;

    for (const coin of this.coins) {
      if (coin.collected) continue;

      // Ground the coin to terrain on first frame
      if (!coin.grounded) {
        // Raycast down to find terrain
        const origin = new THREE.Vector3(coin.x, 200, coin.z);
        const dir = new THREE.Vector3(0, -1, 0);
        // Simple approach: cast against all scene meshes
        const raycaster = new THREE.Raycaster(origin, dir);
        const intersects = raycaster.intersectObjects(this.scene.children, true);
        let groundY = 0.5;
        for (const hit of intersects) {
          if (hit.object === this.spider.root || coin.mesh === hit.object) continue;
          if (hit.point.y > -50) { groundY = hit.point.y + 1.0; break; }
        }
        coin.baseY = groundY; coin.y = groundY;
        coin.mesh.position.y = groundY;
        coin.grounded = true;
      }

      // Bob and spin animation
      coin.mesh.position.y = coin.baseY + Math.sin(t * 2 + coin.bobPhase) * 0.25;
      coin.mesh.rotation.z += dt * 2;

      // Glow pulse for stars
      if (coin.value > 1) {
        const glow = 0.4 + Math.sin(t * 3 + coin.glowPhase) * 0.3;
        coin.mesh.material.emissiveIntensity = glow;
      }

      // Collision check — spider body radius ~2.2
      const dx = spiderPos.x - coin.x;
      const dz = spiderPos.z - coin.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const collectRadius = 2.8; // slightly bigger than body

      if (dist < collectRadius) {
        // Check height — spider must be close to coin height
        const dy = Math.abs(spiderPos.y - coin.mesh.position.y);
        if (dy < 4) {
          coin.collected = true;
          coin.mesh.visible = false;
          this.score += coin.value;
          this._collectSound();
          this._updateHUD();
          this._showCollectEffect(coin.mesh.position, coin.value);
        }
      }
    }
  }

  _showCollectEffect(pos, value) {
    // Floating "+1" or "+5" text effect
    const el = document.createElement('div');
    el.className = 'collect-effect';
    el.textContent = '+' + value;
    el.style.cssText = `
      position: fixed; left: 50%; top: 40%; transform: translate(-50%, -50%);
      font-size: ${value > 1 ? '36px' : '28px'}; font-weight: bold;
      color: ${value > 1 ? '#FF6B35' : '#FFD700'};
      text-shadow: 0 0 10px ${value > 1 ? 'rgba(255,107,53,0.8)' : 'rgba(255,215,0,0.8)'};
      pointer-events: none; z-index: 100;
      animation: collectFloat 0.8s ease-out forwards;
    `;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 800);
  }
}

// ---------- hud + game loop ----------
if (spider) {
  document.getElementById('reset').addEventListener('click', () => {
    spider.reset();
    if (window._game) { window._game.score = 0; window._game.respawnCoins(); }
  });
  document.getElementById('hint').textContent = TOUCH
    ? 'LEFT STICK · MOVE     RIGHT DRAG · LOOK     JUMP     BOOST     FLY'
    : 'WASD · MOVE     DRAG · LOOK     SPACE · JUMP     SHIFT · BOOST     F · FLY     R · RESET';

  // Initialize game
  const game = new Game(scene, spider);
  window._game = game;

  const fpsEl = document.getElementById('fps'), spdEl = document.getElementById('spd'), gradeEl = document.getElementById('grade');
  const clock = new THREE.Clock();
  let fpsAcc = 0, fpsCnt = 0, fpsT = 0, crashed = false;

  function animate() {
    requestAnimationFrame(animate);
    if (crashed) return;
    const dt = Math.min(clock.getDelta(), 0.033);
    try {
      const inp = input.getInput();
      spider.update(dt, inp);
      game.update(dt);
      world.updateDust(dt); world.updateClouds(dt); world.updateButterflies(dt);
      spiderCam.update(dt, spider, input.dragging);
      renderer.render(scene, camera);
    } catch (err) { crashed = true; fatal('Runtime error: ' + (err && err.message ? err.message : err)); console.error(err); }
    fpsAcc += dt; fpsCnt++; fpsT += dt;
    if (fpsT > 0.4) {
      fpsEl.textContent = Math.round(fpsCnt / fpsAcc); spdEl.textContent = spider.curSpeed.toFixed(1);
      const uy = spider.up.y; const gr = uy > 0.93 ? 'FLAT' : uy > 0.55 ? 'INCLINE' : uy > -0.3 ? 'WALL' : 'OVERHANG';
      gradeEl.textContent = gr; gradeEl.style.color = uy < 0.55 ? '#b86a30' : '#d4a040';
      fpsAcc = 0; fpsCnt = 0; fpsT = 0;
    }
  }
  animate();
  addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
}
