# 代码审查 · 逻辑层核心基建（Phase 2）

审查角色：代码审查专家 ｜ 依据：《性能红线与防卡顿规范》（`docs/03-性能红线与防卡顿规范.md`）

## 结论：通过（PASS），附 3 条集成前跟进项

---

## 1. 红线核对（本阶段适用项）

渲染类红线（Draw call / 三角面 / 显存 / 实例化 / LOD）属表现层，本阶段无渲染，不适用。适用于逻辑层的条款逐项核对：

| 红线 | 结果 | 说明 |
| --- | --- | --- |
| 禁止热循环 new 对象 | 通过 | 状态机无每帧分配；事件派发为响应式触发，非每帧 |
| 禁止 setInterval 跑游戏循环 | 注意（跟进1） | 当前无渲染循环；Demo 自动模式用 setInterval 仅作手动步进器 |
| 禁止全局单例无限增长 | 通过 | 订阅在启动时注册一次；`on()` 返回取消函数，集成时需 teardown 调用 |
| 禁止未释放资源 | 通过 | 逻辑层无纹理/几何；未来 Three 对象按规范 `dispose()` |
| 主线程不阻塞 | 通过 | 无重计算 / 同步加载 |

---

## 2. 设计合规性

- **YAGNI**：未实现物理/经济/AI 真实逻辑，仅留事件接口与灰盒模拟，无过度设计。
- **可追踪**：每次转移打印 `[FSM] from -> to`；进入状态广播 `phase:changed`（含 from/day）；总线打印 `[BUS] emit`。
- **可调试**：`EventBus` / `StateMachine` 接受 `logger` 钩子；`main.ts` 同时打到控制台与 UI 面板。
- **类型安全**：`EventBus<M>` 泛型约束载荷，`emit/on` 强制事件名与载荷匹配，杜绝拼写/结构错误。
- **解耦**：UI 与示例订阅者只监听事件，不持有彼此引用；未来模块即插即用。

---

## 3. 跟进项（集成前处理）

1. 真实游戏循环必须用 `requestAnimationFrame` + 固定步长，**禁用 setInterval**；当前 setInterval 仅为 Demo 步进。
2. 事件总线 `emit` 内部 `[...set]` 快照每次分配数组；当前事件为低频响应式，无碍；若未来每帧派发数百事件，改为无分配遍历或对象池。
3. 集成物理/经济/AI 时，订阅者必须在模块销毁时调用 `on()` 返回的取消函数，避免处理器泄漏。

---

## 4. 验证记录

- `npm run build`：tsc 类型检查 0 错误，vite 打包 9 模块成功（产物 4.87 kB / gzip 2.21 kB）。
- node 端冒烟测试：13 步走完 `idle→采购→烹饪→定价→升级/事件→打烊→次日`，日循环与 `day:end` 结算正常触发。

 verdict：逻辑骨架健壮、零类型错误、状态机流程已验证。可合入 `dev` 分支。

---

# 代码审查 · 切土豆 3D Demo（Phase 3）

审查角色：代码审查专家 ｜ 依据：《性能红线与防卡顿规范》

## 结论：通过（PASS），2 条跟进项

### 1. 红线核对（渲染层本阶段适用项）

| 红线 | 结果 | 说明 |
| --- | --- | --- |
| Draw call ≤ 200 | 通过 | 地面 + ≤3 整土豆 + 少量碎块 + 1 个粒子 InstancedMesh + 灯光，远低于阈值 |
| 同屏三角面 ≤ 50 万 | 通过 | 球体低模 + 300 粒子小球，量级极小 |
| 粒子 ≤ 500 / 用 InstancedMesh | 通过 | 粒子系统单 InstancedMesh（容量 300）一次提交 |
| 物理刚体 ≤ 150 | 通过 | 整土豆(≤3) + 碎块(≤48) 远小于上限 |
| 固定步长物理 | 通过 | `tick` 用 rAF + accumulator，1/60 固定步长，dt clamp 防螺旋死亡 |
| 热路径禁止 new | 通过 | `tick` 内仅做 set/复制，无分配；`cut` 与点击为事件驱动，非每帧 |
| 对象池化 | 通过 | 整土豆(8) / 碎块(48) / 粒子(300) 均预创建复用 |
| 禁止未释放资源 | 通过 | `dispose()` 释放 renderer 与监听；几何/材质随 mesh 回收 |
| 禁止 CSS 重排动画 | 通过 | 仅 canvas 全屏定位，无逐帧 style 动画 |

### 2. 设计合规性

- **YAGNI**：只做"切土豆"验证，未铺开真实烹饪玩法；`onCut` 回调预留接分数/事件总线，不强制耦合。
- **可追踪/可调试**：切割触发 `[FX]` 日志；对象池 `available` 可查余量。
- **类型安全**：Three / cannon-es 全程 TS 类型；`spawnWhole(x,y,z)` 数值接口，避免场景层依赖 THREE 向量。
- **解耦**：物理场景自包含；与灰盒逻辑层（事件总线/状态机）互不影响，后续通过 `onCut` 或事件桥接。

### 3. 跟进项

1. Three.js 主包 ~550 kB（gzip 142 kB），集成时应 `manualChunks` 拆包或按需引入，避免首屏拖慢（红线首屏 ≤8MB 仍满足，但属优化项）。
2. 点击射线每帧无开销，但 `onPointerDown` 内 `filter/map` 每次点击分配数组；点击低频可接受，若上量改为预存整土豆网格列表。

### 4. 验证记录

- `npm run build`：tsc 0 错误；vite 多入口打包 `index.html` + `scene.html` 成功（`scene` 包 549 kB / gzip 142 kB，仅为 Three.js 体积警告）。
- WebGL 运行时需浏览器，无头环境无法自动验证；代码为标准 Three.js + cannon-es 用法。

---

# 代码审查 · 烹饪循环与 Juice（Phase 4）

审查角色：代码审查专家 ｜ 依据：《性能红线与防卡顿规范》
**本阶段重点：状态机与物理引擎的耦合审查。**

## 结论：通过（PASS）

### 0. 核心约束核验（状态机不得直接操作 3D 网格）

检索 `src/`：引用 `three` / `cannon-es` / `THREE.` / `CANNON.` 的文件**只有** `render/ParticleSystem.ts` 与 `render/PhysicsScene.ts`。
`core/`（EventBus / StateMachine / Ticker）与 `game/`（events / BusinessDayMachine / CookingSystem / DayController）**零 3D 依赖**；`game/` 内亦无任何 `render/`、`ObjectPool`、`PhysicsScene` 引用。

| 约束 | 结果 | 证据 |
| --- | --- | --- |
| 状态机不碰 3D 网格 | 通过 | `BusinessDayMachine` 只 import `StateMachine`/`EventBus`/`events`，无 THREE |
| 状态机只被事件驱动 | 通过 | `DayController` 订阅 `potato:inPot`→`advanceTo('cooking')`、`dish:served/burnt`→`advanceTo('pricing')` |
| 物理层只发意图、不判规则 | 通过 | `PhysicsScene` 发 `potato:cut`/`dish:prepared`/`potato:inPot`/`pot:clicked`，规则在 `CookingSystem` |
| 玩法层不依赖渲染 | 通过 | `CookingSystem` 只用事件总线收发，纯数据 |
| HUD/音效/特效仅订阅 | 通过 | `Hud`/`Juice`/`AudioManager` 只 `bus.on(...)`，不反向调用系统 |

数据流单向：**输入(物理层) → 意图事件 → 玩法系统算结果 → 结果事件 → 表现层(视图/HUD/音效/特效)**。

### 1. 红线核对（本阶段适用项）

| 红线 | 结果 | 说明 |
| --- | --- | --- |
| 固定步长 + rAF 单循环 | 通过 | 新增 `Ticker` 统一 rAF，物理固定 1/60；物理/烹饪共享同一 tick |
| 禁止 setInterval 跑游戏循环 | 通过 | 循环全部走 `Ticker`；仅 HUD 文本复位用 `setTimeout`（非循环） |
| 热路径禁止 new 对象 | 通过 | 火候 emitted 仅在整数变化时（≤100 次/锅），非每帧；`Ticker` 回调零分配 |
| 对象池化 | 通过 | 土豆/碎块/粒子复用；**金币 DOM 元素池(24)**；**音频通道池(上限 12)** |
| 粒子 InstancedMesh | 通过 | 果汁/金光/黑烟各一个 InstancedMesh，共 3 次提交 |
| 禁止未释放资源 | 通过 | 碎块 4s 回收；`dispose()` 释放 renderer 与监听 |

### 2. 跟进项

1. Three.js 主包仍 ~553 kB（gzip 144 kB）；已由 Rollup 自动拆出 events/FSM 共享块，后续可 `manualChunks` 进一步分离 three。
2. `PhysicsScene` 订阅了 `cooking:*` 做视觉；这是"视图响应领域事件"，与"状态机操作网格"正交，符合约束。若未来视觉逻辑变厚，抽出独立 `PotView`。
3. 音效通道池对并发发声封顶 12，超限丢弃；如需不丢音可在池满时抢占最早通道。

### 3. 验证记录

- `npm run build`：tsc 0 错误；三入口 `index/scene/cook` 打包成功（Rollup 自动拆包，24 模块）。
- dev 服务器：`cook.html` / `scene.html` / `index.html` / `src/cook-main.ts` 均 200。
- WebGL/WebAudio 运行时需浏览器，无头不可自动验证。

---

# 代码审查 · 火候分档与风险收益经济（Phase 5）

审查角色：代码审查专家 ｜ 依据：《性能红线与防卡顿规范》
**本轮审查重点：事件总线契约 —— 档位与质量的传递、金币结算的唯一性、模块禁止互相直调。**

## 结论：通过（PASS），本轮修掉 5 处真实问题

---

## 0. 核心审查项逐条核验

### 0.1 `dish:cooked` 必须携带档位与质量参数

| 要求 | 结果 | 证据 |
| --- | --- | --- |
| 携带火候档位 | 通过 | 载荷含 `grade: 'raw'\|'perfect'\|'over'\|'burnt'`（`events.ts:64-77`），由 `CookingSystem.finish()` 经 `gradeOf()` 判定后填入 |
| 携带质量参数 | 通过 | 载荷含 `quality`（`qualityOf()` 计算）与原始 `heat` |
| 携带食材标识 | 通过（额外） | 载荷含 `ingredientId`：以"这一锅实际用的食材"为准，避免烹饪中切食材造成账目错配 |
| 四档位走同一出口 | 通过 | 生食/完美/过火（玩家点锅）与焦糊（烧穿自动）**全部**经 `finish()` 发 `dish:cooked`，用 `byPlayer` 区分触发方 |
| 档位判定唯一入口 | 通过 | 全 `src/` 内火候区间比较只出现在 `config.ts → gradeOf()`；其余模块一律读 `grade` 字段 |
| 运行期断言 | 通过 | 冒烟测试 §8 校验三个字段存在，且 `coin:earned` 次数 == 出餐次数 |

### 0.2 金币必须由 DayController 统一结算

| 要求 | 结果 | 证据 |
| --- | --- | --- |
| `CookingSystem` 不算钱 | 通过 | 该文件内零 `coin` / `combo` / `price` 标识符，只发 `dish:cooked` |
| 结算唯一调用点 | 通过 | 全 `src/` 内 `economy.settle()` 仅一处：`DayController.ts:45` |
| 金币事件唯一发出点 | 通过 | `emit(Events.CoinEarned)` 仅 `DayController.ts:52` 一处 |
| 连击事件唯一发出点 | 通过 | `emit(Events.ComboChanged)` 仅 `DayController.ts:47` 一处 |
| `EconomySystem` 不广播 | 通过 | 该类**零事件总线依赖**（不 import EventBus），是纯计算器，仅被 DayController 持有 |
| 金币与成本解耦 | 通过 | 成本在 `EconomySystem` 内扣除；`PhysicsScene`/`Hud`/`Juice`/`AudioManager` 均无金钱计算 |

> **注**：`DemoDriver.ts` 也会发 `dish:cooked` / `customer:angry`，但它是**灰盒模拟器**（仅挂在 `index.html` 的逻辑调试页），
> 不属于 `cook.html` 的真实链路，且**不发任何金币事件**。已在文件头注明其非生产用途。

### 0.3 禁止模块间直接互相调用

| 层 | 允许依赖 | 实测违规 |
| --- | --- | --- |
| `render/PhysicsScene` | three / cannon / core / events / config | 无 |
| `game/CookingSystem` | core / events / config | 无（**不知道 EconomySystem 存在**） |
| `game/EconomySystem` | config 只有 | 无（连 EventBus 都不 import） |
| `game/DayController` | core / events / config / EconomySystem | 无（唯一允许持有 EconomySystem 的模块） |
| `ui/` `audio/` | core / events / config | 无 |

数据流单向：**物理意图 → 玩法判定 → 中枢结算 → 结果事件 → 表现层**。任何一环都不反向调用。

---

## 1. 本轮修掉的 5 处真实问题

| # | 问题 | 发现方式 | 修复 |
| --- | --- | --- | --- |
| 1 | `Juice` 从 `dish:cooked` 解构 `combo`，但该字段**不存在** | `tsc` 编译期报错 | 震动改由 `combo:changed` **单一事件**驱动（该事件每次出餐必发且携带 combo/倍率/断档）。顺带**消除了一处跨事件到达顺序的隐式耦合** |
| 2 | `Hud` 声明 `combo` / `multiplier` 字段却从不读取 | `noUnusedLocals` 编译期报错 | 删除死字段 |
| 3 | 灰盒 `main.ts` / `DemoDriver.ts` 仍用旧契约（`orderId` / `customerId`） | 全量类型检查 | 升级到新契约；`DemoDriver` 现在走真实 `gradeOf`/`qualityOf`/`resolveCookParams` 链路，四个档位都可能产出 |
| 4 | `ObjectPool` 是纯工具类却放在 `render/`，导致 `ui/`、`audio/` 反向依赖"渲染层" | 依赖面 grep | 迁到 `core/ObjectPool.ts`，更新 3 处 import，删除旧文件 |
| 5 | 冒烟测试自身的 `runTo(100)` 永远跑不到（烧穿后火候被复位为 0） | 测试首跑超时抛错 | 改为"出餐即返回"，并用 `isCooking` 判据 |

> 第 4 条是本轮唯一的结构性改进：它把四层架构图里一条不该存在的边（UI → 渲染层）剪掉了。
> 前三层依赖方向现已完全干净，架构图与实际代码一一对应。

---

## 2. 红线核对（本阶段适用项）

| 红线 | 结果 | 说明 |
| --- | --- | --- |
| 固定步长 + rAF 单循环 | 通过 | 火候与物理共享同一 `Ticker`，物理固定 1/60 |
| 禁止 setInterval 跑游戏循环 | 通过 | 循环全走 `Ticker`；`setTimeout` 仅用于 HUD 文案复位（非循环） |
| 热路径禁止 new 对象 | 通过 | 火候事件**按整数变化节流**（≤100 次/锅）；`combo:changed` / `coin:earned` 每锅各 1 条；`Ticker` 回调零分配 |
| 对象池化 | 通过 | 土豆 8 / 碎块 48 / 粒子 300+200+200 / 金币 DOM 24 / 音频通道 12 |
| 粒子 InstancedMesh | 通过 | 3 个 InstancedMesh，共 3 次提交 |
| 禁止未释放资源 | 通过 | 碎块 4s 回收；`dispose()` 释放 renderer 与监听；DTO 均为短命对象（每锅 1 次，非每帧） |
| 事件总量可控 | 通过 | 每锅固定：`cooking:progress` ≤100 + `dish:cooked` + `combo:changed` + `coin:earned`（+焦糊时 `customer:angry`） |

---

## 3. 跟进项

1. `PhysicsScene` 订阅 `cooking:*` 与 `dish:cooked` 做视觉，属"视图响应领域事件"，与"状态机操作网格"正交，符合约束。若视觉继续变厚，应抽出独立 `PotView`。
2. 灶台升级在 `cooking` 阶段被拒（`DayController.upgradeStove`），HUD 也同步禁用按钮 —— **同一规则写了两处**。当前是可接受的冗余（UI 提示 + 逻辑兜底），但若规则再复杂，应改为广播 `stove:upgradeRejected` 事件。
3. `three` 主包仍 553 kB（gzip 144 kB），`PhysicsScene` 独占。集成前按 `manualChunks` 拆分。
4. `ui/Hud.ts` 自行由 `config` 推导展示用售价/成本，与 `EconomySystem` 读同一张表故不漂移；若未来售价受随机事件影响，HUD 必须改为读事件载荷。

---

## 4. 验证记录

- `npm run build`：tsc 0 错误；三入口 `index/scene/cook` 打包成功（26 模块，Rollup 自动拆出 `config` / `events` / `BusinessDayMachine` 共享块）。
- **无头冒烟测试**（`src/smoke-cook.ts` → tsc 编译 → node 执行，直接驱动真实链路）：**31 项断言全部通过（16 锅）**。
  覆盖参数解算、连击递增与倍率封顶、烧穿焦糊、生食/过火账目、食材与灶台切换的甜区联动、事件契约合规。
- 重构后（`ObjectPool` 迁移）重跑：构建 exit 0、冒烟测试 31/31 通过。
- WebGL/WebAudio 运行时需浏览器，无头不可自动验证；已用 dev 服务器确认页面与模块均 200。

