# 哈尔风格八足移动城堡 — Howl's Moving Spider Castle

> Three.js / Vite 程序化 3D 小游戏：操控一座八足机械移动城堡，在童话山野中行走、飞行、收集金币。

**在线体验**: https://howls-moving-spider.vercel.app/  
**当前阶段**: v0.3 baseline → 视觉气质改造阶段

---

## 当前项目判断

项目已经可以在线运行，核心玩法雏形成立：

- 八足 IK 行走
- 第三人称跟随镜头
- 跳跃与飞行模式
- 金币收集与任务提示
- 程序化地形、村庄、风车、云、树、粒子
- 中文 UI 与移动端触屏按钮

下一步不要继续盲目堆功能，而是做一轮 **视觉气质优先改造**。

目标不是电影原版一比一复刻，而是让项目更接近：

> 宫崎骏 / 吉卜力式童话机械世界：温暖、手工感、旧机械、生活气、风与光。

---

## 当前主线

### 保留

- 保留 8 足机械移动城堡方向。
- 保留行走、跳跃、飞行、金币收集玩法。
- 保留 Three.js 程序化建模路线。
- 保留中文 UI 和移动端适配。

### 不做

- 不改成电影原版双足结构。
- 不做赛博朋克、军武机甲、冷科幻风。
- 不复刻电影具体镜头、角色、场景资产。
- 不在视觉改造阶段引入复杂新玩法。

---

## Codex 必读文档

让 Codex 开工前，先读取这些文档：

1. [`docs/CODEX_VISUAL_TASK.md`](docs/CODEX_VISUAL_TASK.md) — 本轮视觉改造任务单
2. [`docs/VISUAL_DIRECTION.md`](docs/VISUAL_DIRECTION.md) — 视觉方向与禁区
3. [`docs/ACCEPTANCE.md`](docs/ACCEPTANCE.md) — 验收标准
4. [`docs/QA_ONLINE_CHECK_2026_06_27.md`](docs/QA_ONLINE_CHECK_2026_06_27.md) — 线上体检记录
5. [`docs/REDESIGN.md`](docs/REDESIGN.md) — 未来双足方案备忘，不进入当前主线

---

## 第一轮视觉改造优先级

### P0：先改整体气质

1. 光照更温暖、柔和、有空气感。
2. 天空、雾气、远景更像童话世界。
3. 城堡第一眼更像“会走的房子群”，不是普通蜘蛛机器人。
4. 材质统一到旧铁皮、老木头、暗红瓦、暖窗光。
5. UI 从调试 HUD 往童话机械仪表方向靠。

### P1：再补生活感

1. 窗户暖光。
2. 烟囱蒸汽。
3. 帘布、旗子、外露木梁、补丁铁皮。
4. 村庄、风车、水井、围栏更绘本化。
5. 金币反馈更像冒险发现，而不是纯街机得分。

---

## 技术栈

| 层 | 技术 |
|---|---|
| 渲染 | Three.js |
| 构建 | Vite |
| 语言 | Vanilla JS / ES Modules |
| 部署 | Vercel |

---

## 开发命令

```bash
npm install
npm run dev
npm run build
npm run preview
```

如果本地出现 Rollup optional dependency 问题，先重装依赖：

```bash
rm -rf node_modules
npm install
npm run build
```

Windows PowerShell：

```powershell
Remove-Item -Recurse -Force node_modules
npm install
npm run build
```

---

## 当前验收口径

本阶段不是看“功能是否更多”，而是看：

- 第一眼是否更像移动城堡。
- 画面是否更温暖、更童话、更有旧机械生活气。
- UI 是否更贴合世界观。
- 玩法是否没有被破坏。
- 构建、运行、移动端基本操作是否仍然成立。
