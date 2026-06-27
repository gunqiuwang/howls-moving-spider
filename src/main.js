import * as THREE from 'three';
import { World } from './world/World.js';
import { Spider, TUNE } from './spider/Spider.js';
import { SpiderCamera } from './camera/SpiderCamera.js';
import { Input } from './core/Input.js';

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
  input.onReset = () => spider.reset();
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

// ---------- tuning panel ----------
function buildPanel() {
  const sldWrap = document.getElementById('sliders');
  const defs = [
    { label: 'Speed', min: 1, max: 12, step: 0.5, get: () => spider.baseSpeed, set: (v) => (spider.baseSpeed = v) },
    { label: 'Ride height', min: 1.5, max: 4.0, step: 0.05, get: () => spider.rideClear, set: (v) => (spider.rideClear = v) },
    { label: 'Step height', min: 0.2, max: 1.4, step: 0.05, get: () => spider.stepH, set: (v) => (spider.stepH = v) },
    { label: 'Gait rate', min: 0.6, max: 2.6, step: 0.05, get: () => spider.baseFreq, set: (v) => (spider.baseFreq = v) },
    { label: 'Turn rate', min: 0.6, max: 3.0, step: 0.1, get: () => spider.turnRate, set: (v) => (spider.turnRate = v) },
    { label: 'Stride', min: 1.2, max: 3.4, step: 0.1, get: () => spider.maxStride, set: (v) => (spider.maxStride = v) },
    { label: 'Knee swivel range', min: 0.5, max: 3.14, step: 0.05, get: () => TUNE.aRange, set: (v) => (TUNE.aRange = v) },
    { label: 'Knee swivel samples', min: 2, max: 14, step: 1, get: () => TUNE.aSamp, set: (v) => (TUNE.aSamp = v) },
  ];
  const fmt = (v) => (Math.abs(v) >= 10 ? '' + Math.round(v) : (+v).toFixed(2));

  {
    const row = document.createElement('div'); row.className = 'tog';
    const nm = document.createElement('span'); nm.textContent = 'IK SOLVER';
    const val = document.createElement('b');
    const render = () => { val.textContent = TUNE.decomposed ? 'DECOMPOSED' : 'ANALYTIC'; row.classList.toggle('on', !!TUNE.decomposed); };
    render(); row.appendChild(nm); row.appendChild(val);
    row.addEventListener('click', () => { TUNE.decomposed = !TUNE.decomposed; render(); });
    row.addEventListener('pointerdown', (e) => e.stopPropagation());
    sldWrap.appendChild(row);
  }
  {
    const row = document.createElement('div'); row.className = 'tog';
    const nm = document.createElement('span'); nm.textContent = 'BODY CONFORM';
    const val = document.createElement('b');
    const render = () => { val.textContent = spider.bodyConform ? 'ON' : 'OFF'; row.classList.toggle('on', !!spider.bodyConform); };
    render(); row.appendChild(nm); row.appendChild(val);
    row.addEventListener('click', () => { spider.bodyConform = !spider.bodyConform; render(); });
    row.addEventListener('pointerdown', (e) => e.stopPropagation());
    sldWrap.appendChild(row);
  }
  {
    const row = document.createElement('div'); row.className = 'tog';
    const nm = document.createElement('span'); nm.textContent = 'BODY FLEX';
    const val = document.createElement('b');
    const render = () => { val.textContent = spider.bodyFlex ? 'ON' : 'OFF'; row.classList.toggle('on', !!spider.bodyFlex); };
    render(); row.appendChild(nm); row.appendChild(val);
    row.addEventListener('click', () => { spider.bodyFlex = !spider.bodyFlex; render(); });
    row.addEventListener('pointerdown', (e) => e.stopPropagation());
    sldWrap.appendChild(row);
  }
  for (const d of defs) {
    const row = document.createElement('div'); row.className = 'sld';
    const lab = document.createElement('label'); const nm = document.createElement('span'); nm.textContent = d.label; const val = document.createElement('b'); val.textContent = fmt(d.get()); lab.appendChild(nm); lab.appendChild(val);
    const inp = document.createElement('input'); inp.type = 'range'; inp.min = d.min; inp.max = d.max; inp.step = d.step; inp.value = d.get();
    inp.addEventListener('input', () => { const v = parseFloat(inp.value); d.set(v); val.textContent = fmt(v); });
    inp.addEventListener('pointerdown', (e) => e.stopPropagation());
    row.appendChild(lab); row.appendChild(inp); sldWrap.appendChild(row);
  }
  const panel = document.getElementById('panel'), head = document.getElementById('panelHead'), tog = document.getElementById('panelTog');
  head.addEventListener('click', () => { panel.classList.toggle('closed'); tog.innerHTML = panel.classList.contains('closed') ? '+' : '&ndash;'; });
  panel.addEventListener('pointerdown', (e) => e.stopPropagation());
  if (TOUCH) { panel.classList.add('closed'); tog.innerHTML = '+'; }
}

// ---------- hud + loop ----------
if (spider) {
  buildPanel();
  document.getElementById('reset').addEventListener('click', () => spider.reset());
  document.getElementById('hint').textContent = TOUCH
    ? 'LEFT STICK · MOVE     RIGHT DRAG · LOOK     JUMP     BOOST (hold + JUMP = lunge)'
    : 'WASD · MOVE     DRAG · LOOK     SCROLL · ZOOM     SPACE · JUMP     SHIFT · BOOST     F · FLY/LAND     R · RESET';

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
