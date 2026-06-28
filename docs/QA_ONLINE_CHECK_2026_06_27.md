# 线上运行体检与本轮改进记录

> 日期：2026-06-27  
> 地址：https://howls-moving-spider.vercel.app/  
> 阶段：v0.3 baseline 收口

---

## 1. 线上实际情况

通过真实浏览器打开线上页面，页面可以运行。

观察到的状态：

- 页面标题：哈尔的移动城堡。
- HUD 正常显示。
- 金币数量显示：30/30。
- 帧率显示正常，测试时约 165 FPS。
- 操作提示正常显示：WASD、拖拽视角、空格、Shift、F、R。

---

## 2. 线上发现的问题

### 2.1 Three.js 控制台错误

控制台出现：

```txt
THREE.Object3D.add: object not an instance of THREE.Object3D
```

原因：

`src/world/World.js` 中将 `.position.set(...)` 的返回值传入了 `scene.add()`。

错误写法：

```js
s.add(new THREE.DirectionalLight(0xFFE8CC, 0.2).position.set(-38, 22, -42));
```

`.position.set()` 返回的是 Vector3，不是 Object3D。

已修复为：

```js
const fill = new THREE.DirectionalLight(0xFFE8CC, 0.2);
fill.position.set(-38, 22, -42);
s.add(fill);
```

### 2.2 favicon 404

线上请求 `/favicon.ico` 返回 404。

已新增：

- `public/favicon.svg`
- `index.html` 中加入 favicon 引用

### 2.3 移动端飞行按钮文字不统一

触屏模式下，飞行按钮会被设置成英文：

```txt
FLY / LAND
```

项目是中文 UI，已改为：

```txt
起飞 / 降落
```

### 2.4 金币玩法目标感偏弱

原页面只显示分数和金币数量，用户第一次进入时不够明确“我要做什么”。

已新增 `#mission` 目标提示：

- 初始：目标：收集全部金币
- 收集中：还剩 X 枚 · 继续探索
- 全部收集后：全部收集完成 · 按 R 重新开始

---

## 3. 本轮修改文件

- `src/world/World.js`
  - 修复 DirectionalLight 错误添加导致的 Three.js 控制台错误。

- `src/core/Input.js`
  - 移动端飞行按钮文案改为中文。

- `index.html`
  - 页面标题与描述改为“哈尔风格八足移动城堡”。
  - 增加 favicon 引用。
  - 增加任务提示 DOM。

- `src/main.js`
  - 金币 HUD 增加任务状态更新。

- `src/ui/styles.css`
  - 增加任务提示样式。

- `public/favicon.svg`
  - 新增项目图标。

---

## 4. 已完成验证

```txt
package json ok
js syntax ok
```

已检查：

- `package.json` JSON 格式正常。
- `package-lock.json` JSON 格式正常。
- `src/main.js` 语法检查通过。
- `src/world/World.js` 语法检查通过。
- `src/core/Input.js` 语法检查通过。

---

## 5. 未完成验证

`npm run build` 仍未通过。

原因仍是本地依赖安装异常：

```txt
Cannot find module @rollup/rollup-win32-x64-msvc
```

这与本轮代码修改无关，属于当前工作区 `node_modules` / npm optional dependency 问题。

建议修复命令：

```powershell
Remove-Item -Recurse -Force node_modules
npm install
npm run build
```

Git Bash：

```bash
rm -rf node_modules
npm install
npm run build
```

---

## 6. 当前结论

线上页面可运行，本轮优先修复了实际线上可见/可查的问题：

1. 控制台 Three.js 错误。
2. favicon 404。
3. 移动端英文按钮。
4. 金币玩法目标感不足。

下一步应先修复本地依赖并完成 `npm run build`，再部署验证线上控制台是否清零。
