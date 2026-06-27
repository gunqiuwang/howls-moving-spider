import * as THREE from 'three';
import { World } from './world/World.js';
import { Spider, TUNE } from './spider/Spider.js';
import { SpiderCamera } from './camera/SpiderCamera.js';
import { Input } from './core/Input.js';
import { terrainH } from './world/terrain.js';
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
  input.onReset = () => { spider.reset(); if (window._game) { window._game.score = 0; window._game.respawnCoins(); } };
  input.onJump = (boost) => spider.jump(boost);
  input.onFlight = () => {
    try {
      const flying = spider.toggleFlight();
      document.getElementById('flight-indicator').style.display = flying ? 'block' : 'none';
      const flyBtn = document.getElementById('flybtn');
      if (flyBtn) { flyBtn.classList.toggle('active', flying); flyBtn.textContent = flying ? '降落' : '起飞'; }
      return flying;
    } catch(e) { console.error('Flight toggle error:', e); return false; }
  };
} catch (err) {
  fatal('初始化错误: ' + (err && err.message ? err.message : err));
  console.error(err);
}

// ============================================================
//  游戏系统 — 金币 + 积分
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
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      return () => {
        const osc = ctx.createOscillator(); const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = 'square';
        osc.frequency.setValueAtTime(988, ctx.currentTime);
        osc.frequency.setValueAtTime(1319, ctx.currentTime + 0.06);
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.2);
      };
    } catch(e) { return () => {}; }
  }

  _spawnCoins() {
    for (const c of this.coins) { if (c.mesh.parent) c.mesh.parent.remove(c.mesh); }
    this.coins = []; this.totalCoins = 0;

    const positions = [
      [10,0],[-6,8],[4,-10],[-12,-6],[8,12],[24,16],[-20,24],[30,-10],[-24,-16],[16,22],
      [40,30],[-36,40],[44,-24],[-30,-36],[20,44],[60,50],[-56,60],[70,-40],[-64,-50],[50,70],
      [-16,-40],[36,-44],[-50,20],[56,10],[-10,60],[80,20],[-70,-30],[30,80],[-80,40],[60,-60],
    ];

    const coinGeo = new THREE.CylinderGeometry(0.45, 0.45, 0.1, 16);
    const coinMat = new THREE.MeshStandardMaterial({ color: 0xFFD700, emissive: 0xFFAA00, emissiveIntensity: 0.5, roughness: 0.3, metalness: 0.8 });
    const starMat = new THREE.MeshStandardMaterial({ color: 0xFF6B35, emissive: 0xFF4500, emissiveIntensity: 0.7, roughness: 0.3, metalness: 0.7 });

    for (let i = 0; i < positions.length; i++) {
      const [cx, cz] = positions[i];
      const x = cx * 2, z = cz * 2;
      const y = terrainH(x, z) + 1.2;
      const isSpecial = i % 10 === 9;
      const mesh = new THREE.Mesh(coinGeo, isSpecial ? starMat.clone() : coinMat.clone());
      mesh.rotation.x = Math.PI / 2;
      mesh.position.set(x, y, z); mesh.castShadow = true;
      this.scene.add(mesh);
      this.coins.push({ mesh, x, z, baseY: y, collected: false, value: isSpecial ? 5 : 1, bobPhase: Math.random() * Math.PI * 2 });
      this.totalCoins += isSpecial ? 5 : 1;
    }
  }

  respawnCoins() {
    for (const c of this.coins) { c.collected = false; c.mesh.visible = true; }
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
    const sp = this.spider.position;
    const t = performance.now() * 0.001;

    for (const coin of this.coins) {
      if (coin.collected) continue;
      // 动画
      coin.mesh.position.y = coin.baseY + Math.sin(t * 2 + coin.bobPhase) * 0.3;
      coin.mesh.rotation.z += dt * 2.5;
      if (coin.value > 1) coin.mesh.material.emissiveIntensity = 0.5 + Math.sin(t * 3 + coin.bobPhase) * 0.3;
      // 碰撞
      const dx = sp.x - coin.x, dz = sp.z - coin.z;
      if (Math.sqrt(dx * dx + dz * dz) < 3.0 && Math.abs(sp.y - coin.mesh.position.y) < 5) {
        coin.collected = true; coin.mesh.visible = false;
        this.score += coin.value; this._collectSound(); this._updateHUD();
        this._showEffect(coin.value);
      }
    }
  }

  _showEffect(value) {
    const el = document.createElement('div');
    el.textContent = '+' + value;
    el.style.cssText = `position:fixed;left:50%;top:38%;transform:translate(-50%,-50%);font-size:${value > 1 ? '36px' : '28px'};font-weight:bold;color:${value > 1 ? '#FF6B35' : '#FFD700'};text-shadow:0 0 10px rgba(255,200,0,0.8);pointer-events:none;z-index:100;animation:collectFloat 0.8s ease-out forwards;`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 800);
  }
}

// ---------- 主循环 ----------
if (spider) {
  document.getElementById('reset').addEventListener('click', () => {
    spider.reset();
    if (window._game) { window._game.score = 0; window._game.respawnCoins(); }
  });
  document.getElementById('hint').textContent = TOUCH
    ? '左侧拖拽 · 移动     右侧拖拽 · 视角     跳跃     加速     起飞'
    : 'WASD · 移动     拖拽 · 视角     空格 · 跳跃     Shift · 加速     F · 飞行     R · 重置';

  const game = new Game(scene, spider);
  window._game = game;

  const fpsEl = document.getElementById('fps'), spdEl = document.getElementById('spd');
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
    } catch (err) { crashed = true; fatal('运行时错误: ' + (err && err.message ? err.message : err)); console.error(err); }
    fpsAcc += dt; fpsCnt++; fpsT += dt;
    if (fpsT > 0.4) {
      fpsEl.textContent = Math.round(fpsCnt / fpsAcc); spdEl.textContent = spider.curSpeed.toFixed(1);
      fpsAcc = 0; fpsCnt = 0; fpsT = 0;
    }
  }
  animate();
  addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
}
