# 3D 烹饪经营游戏 · 核心原型（灰盒）

当前进度：**第六阶段 —— 采购阶段与食材价格波动**。
全程灰盒（几何体），只验证机制与手感，不做美术。

## 运行

**方式一（推荐）：双击启动器**

项目根目录的 `start-game.bat`（桌面上另有一份副本）。它会自动：

1. 定位 game 目录（优先用脚本所在目录，失败则回退到写死的项目根）
2. 探测 Node 运行时 —— 优先用 managed Node，找不到才回退系统 npm
3. 若 `node_modules` 缺失，先跑 `npm install`
4. 在**独立窗口** `CookingGame-DevServer` 里起 Vite（该窗口独立于任何宿主进程，不会被回收）
5. 轮询直到服务器真的响应（curl 探 `cook.html`；5173 被占则自动识别 5174）
6. 自动打开浏览器到 `cook.html`，启动器自身随即退出

> ⚠️ 关键设计：**用 `start` 开独立窗口，而不是让启动器自己占用前台**。
> 若由某个宿主进程（IDE 终端、Agent 后台任务）代跑 `npm run dev`，
> 宿主一退出，服务器就随进程树被一起回收，浏览器随即报 `ERR_CONNECTION_REFUSED`。
>
> 停止服务器：关掉标题为 `CookingGame-DevServer` 的那个窗口即可。

**方式二：手动**

```bash
npm install
npm run dev
```

| 页面 | 地址 | 用途 |
| --- | --- | --- |
| 烹饪循环（主） | `/cook.html` | 采购进货 → 四档位烹饪 → 连击经济 → HUD + Juice |
| 切土豆 | `/scene.html` | 纯物理：点土豆切块、点地面摆新土豆 |
| 逻辑灰盒 | `/` | 营业日状态机步进器（无 3D） |

构建校验（类型检查 + 打包）：

```bash
npm run build
```

## 目录

```
src/
  core/
    EventBus.ts        # 类型安全事件总线（模块解耦通信通道）
    StateMachine.ts    # 通用有限状态机（可追踪/可调试）
    Ticker.ts          # 统一 rAF 帧循环 + 固定步长 + dt clamp
    ObjectPool.ts      # 通用对象池（纯工具，与渲染无关，故归 core）
  game/
    config.ts          # ★ 数值唯一事实来源：食材 / 外观表 / 灶台 / 经济系数 / 档位阈值
    events.ts          # 事件名常量 + 载荷契约 GameEvents
    BusinessDayMachine.ts  # 营业日状态机：采购→烹饪→定价→升级/事件→打烊→次日
    CookingSystem.ts   # 火候推进 + 四档位判定（不算钱，有阶段闸门）
    EconomySystem.ts   # 连击 / 售价 / 成本 / 罚金（纯计算器，零事件依赖）
    MarketSystem.ts    # 每日价格浮动 / 库存 / 破产保护（纯计算器，零事件依赖）
    DayController.ts   # ★ 唯一结算中枢：采购裁决 + 出餐结算 + 升级 + 破产检查
    DemoDriver.ts      # 灰盒驱动器（仅逻辑页使用，非生产链路）
  render/
    ParticleSystem.ts  # 粒子（InstancedMesh，单批次渲染，支持换色）
    PhysicsScene.ts    # Three.js + cannon-es：场景 / 物理世界 / 射线拾取 / 食材外观
  ui/
    Hud.ts             # 火候条 / 甜区 / 档位提示 / 经济面板 / 进货界面
    Juice.ts           # 震动 / 金币飞入 / 连击弹字 / 黑晕 / 泛红
  audio/
    AudioManager.ts    # WebAudio 程序化音效（六种，通道池上限 12）
  main.ts              # 逻辑灰盒入口
  scene-main.ts        # 切土豆入口
  cook-main.ts         # 烹饪循环入口（主）
  smoke-cook.ts        # ★ 无头冒烟测试（关键测试代码，已纳入版本管理）
index.html / scene.html / cook.html / src/style.css
```

## 玩法（cook.html）

### 采购阶段（每天开头）

1. **左侧「今日进货」面板**列出三种食材的当日价格与库存，价格带涨跌标记（涨红跌绿）。
2. **点 `+1` / `+5` 进货**，立刻扣金币；钱不够的按钮直接禁用。
3. **点食材名**切换"今天主推什么"（也可用右下角按钮）。
4. **破产保护**：钱不够买最便宜的料 **且** 一份库存都没有时，免费发放 3 份豆腐应急。
5. **「开火营业 ▸」**进入烹饪阶段（零库存时禁用）。

### 烹饪阶段

1. **点食材** → 切片入锅，扣一份库存，开始加热，火候条亮起。
2. **火候条上的绿区 = 甜区**。甜区会随**食材**与**灶台等级**实时收放。
3. **在甜区内点锅** → 完美出餐：金光 + 金币飞入 + 屏幕震动 + 上行双音 + 连击倍率。
4. **连续完美** → 收益 ×1 → ×2 → ×3 …（封顶 ×10）。
5. **生食 / 过火** → 连击归零 + 画面泛红 + 下行音。
6. **不点锅，烧穿 100** → 焦糊：黑晕 + 重震 + 顾客愤怒 + 倒赔钱。
7. **库存耗尽才收尾**（进入定价阶段）；还有料就可以一锅接一锅地做。
8. **右侧按钮**：升灶台（更赚也更难，烹饪中不可升）、切换食材。
9. **打烊 → 次日**：走完 定价→升级→打烊→次日采购，次日价格重新掷。

### 四档位

| 档位 | 条件 | 收益 |
| --- | --- | --- |
| 生食 | 甜区下界之前 | 售价 ×0.2，连击归零 |
| 完美 | 甜区内 | 售价 × 连击倍率，连击 +1 |
| 过火 | 甜区上界之后、未到 100 | 收入 0，倒赔售价 ×0.5 |
| 焦糊 | 火候 ≥ 100（自动） | 收入 0，重罚售价 ×0.8，顾客愤怒 |

**成本 = 当日买进价**（不是常量）→ 买贵了赚得少，失误必亏。
数值见 `docs/04-数值策划表.md` 与 `docs/06-采购阶段与价格系统.md`。

## 模块边界（硬约束）

- `game/` 与 `core/` **不 import three / cannon-es**；状态机只被事件驱动，绝不接触 3D 网格。
- `CookingSystem` **不算钱**，只发 `dish:cooked`（带档位 + 质量）；非烹饪阶段不开火。
- `MarketSystem` / `EconomySystem` 是**纯计算器**，零事件总线依赖，只被 `DayController` 调用。
- **金币只能由 `DayController` 结算**，`coin:earned` 全项目仅 3 处发出点（同一类内）。
- `render/` 只发意图事件、订阅领域事件改视觉，不判断游戏规则。
- 数据流单向：**物理输入 → 意图事件 → 玩法判定 → 中枢结算 → 结果事件 → 表现层**。
- 任何模块之间不得直接互相调用，一律经事件总线。

## 无头验证

冒烟测试是**唯一的自动化回归防线**，已纳入 git。跑法（Windows / PowerShell）：

```powershell
$node = "C:\Users\13916\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"
& $node node_modules\typescript\bin\tsc --target ES2022 --module commonjs `
    --moduleResolution node --outDir _smoke --rootDir src --skipLibCheck src/smoke-cook.ts
'{"type":"commonjs"}' | Out-File _smoke\package.json -Encoding ASCII   # 否则被外层 type:module 当 ESM
& $node _smoke\smoke-cook.js
```

当前基线：**83 项断言全通过（16 锅 / 20 笔资金流水），exit 0**。
覆盖：参数解算 / 外观表契约 / 采购阶段不越权 / 资金校验与批量封顶 / 采购→烹饪过渡 /
连击递增与封顶 / 烧穿焦糊 / 生食与过火账目 / 食材切换甜区联动 / 烹饪中禁止升灶 /
事件契约合规 / **事件总线无死循环** / 价格浮动上下限 / **采购成本对利润的影响** / 破产保护。

> 陷阱提醒：`_smoke/` 下必须放 `package.json` 写 `{"type":"commonjs"}`，
> 否则 node 会因为外层 `package.json` 的 `type: module` 而把编译产物当 ESM，报 `exports is not defined`。

## 给未来模块预留的接口

新增模块只需订阅事件，不持有任何引用：

```ts
bus.on('dish:cooked',    (p) => { /* 菜品评级：按 grade + quality 给星 */ });
bus.on('customer:angry', (p) => { /* 顾客AI：降声誉、触发离场 */ });
bus.on('order:created',  (p) => { /* 物理：生成对应食材刚体 */ });
bus.on('market:open',    (p) => { /* 事件系统：根据行情生成随机事件 */ });
```

## 设计文档

- 《GDD 大纲（核心循环 + 系统结构）》`../docs/05-GDD大纲.md`
- 《采购阶段与价格系统》`../docs/06-采购阶段与价格系统.md`
- 《数值策划表》`../docs/04-数值策划表.md`
- 《性能红线与防卡顿规范》`../docs/03-性能红线与防卡顿规范.md`
- 《代码审查记录》`CODE_REVIEW.md`
