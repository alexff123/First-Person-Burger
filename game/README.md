# 3D 烹饪经营游戏 · 核心原型（灰盒）

当前进度：**第五阶段 —— 火候分档与风险收益经济**。
全程灰盒（几何体），只验证机制与手感，不做美术。

## 运行

```bash
npm install
npm run dev
```

| 页面 | 地址 | 用途 |
| --- | --- | --- |
| 烹饪循环（主） | `/cook.html` | 四档位 + 连击经济 + HUD + Juice |
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
    config.ts          # ★ 数值唯一事实来源：食材 / 灶台 / 经济系数 / 档位阈值
    events.ts          # 事件名常量 + 载荷契约 GameEvents
    BusinessDayMachine.ts  # 营业日状态机：采购→烹饪→定价→升级/事件→打烊→次日
    CookingSystem.ts   # 火候推进 + 四档位判定（不算钱）
    EconomySystem.ts   # 连击 / 售价 / 成本 / 罚金（纯计算器，零事件依赖）
    DayController.ts   # ★ 唯一结算中枢：调 EconomySystem 并广播结果事件
    DemoDriver.ts      # 灰盒驱动器（仅逻辑页使用，非生产链路）
  render/
    ParticleSystem.ts  # 粒子（InstancedMesh，单批次渲染）
    PhysicsScene.ts    # Three.js + cannon-es：场景 / 物理世界 / 射线拾取
  ui/
    Hud.ts             # 火候条 / 甜区 / 档位提示 / 经济面板
    Juice.ts           # 震动 / 金币飞入 / 连击弹字 / 黑晕 / 泛红
  audio/
    AudioManager.ts    # WebAudio 程序化音效（六种，通道池上限 12）
  main.ts              # 逻辑灰盒入口
  scene-main.ts        # 切土豆入口
  cook-main.ts         # 烹饪循环入口（主）
  smoke-cook.ts        # 无头冒烟测试（非交付物，gitignore 忽略）
index.html / scene.html / cook.html / src/style.css
```

## 玩法（cook.html）

1. **点土豆** → 切片入锅，开始加热，火候条亮起。
2. **火候条上的绿区 = 甜区**。甜区会随**食材**与**灶台等级**实时收放。
3. **在甜区内点锅** → 完美出餐：金光 + 金币飞入 + 屏幕震动 + 上行双音 + 连击倍率。
4. **连续完美** → 收益 ×1 → ×2 → ×3 …（封顶 ×10）。
5. **生食 / 过火** → 连击归零 + 画面泛红 + 下行音。
6. **不点锅，烧穿 100** → 焦糊：黑晕 + 重震 + 顾客愤怒 + 倒赔钱。
7. **右侧按钮**：升灶台（更赚也更难，烹饪中不可升）、切换食材（土豆 / 豆腐 / 和牛）。
8. **打烊 → 次日**：走完 定价→升级→打烊→次日采购。

### 四档位

| 档位 | 条件 | 收益 |
| --- | --- | --- |
| 生食 | 甜区下界之前 | 售价 ×0.2，连击归零 |
| 完美 | 甜区内 | 售价 × 连击倍率，连击 +1 |
| 过火 | 甜区上界之后、未到 100 | 收入 0，倒赔售价 ×0.5 |
| 焦糊 | 火候 ≥ 100（自动） | 收入 0，重罚售价 ×0.8，顾客愤怒 |

**任何出餐都会扣食材成本** → 失误必亏。数值见 `docs/04-数值策划表.md`。

## 模块边界（硬约束）

- `game/` 与 `core/` **不 import three / cannon-es**；状态机只被事件驱动，绝不接触 3D 网格。
- `CookingSystem` **不算钱**，只发 `dish:cooked`（带档位 + 质量）。
- **金币只能由 `DayController` 结算**，`coin:earned` 全项目仅一处发出点。
- `render/` 只发意图事件、订阅领域事件改视觉，不判断游戏规则。
- 数据流单向：**物理输入 → 意图事件 → 玩法判定 → 中枢结算 → 结果事件 → 表现层**。
- 任何模块之间不得直接互相调用，一律经事件总线。

## 无头验证

```bash
# 编译冒烟测试到临时目录再跑（WebGL/WebAudio 无法无头验证，逻辑可以）
node node_modules/typescript/bin/tsc --outDir ../_smoke --module commonjs \
  --target ES2020 --moduleResolution node --lib ES2020,DOM --strict src/smoke-cook.ts
node ../_smoke/smoke-cook.js
```

覆盖：参数解算 / 连击递增与封顶 / 烧穿焦糊 / 生食与过火账目 / 食材与灶台切换的甜区联动 / 事件契约合规。

## 给未来模块预留的接口

新增模块只需订阅事件，不持有任何引用：

```ts
bus.on('dish:cooked',    (p) => { /* 菜品评级：按 grade + quality 给星 */ });
bus.on('customer:angry', (p) => { /* 顾客AI：降声誉、触发离场 */ });
bus.on('order:created',  (p) => { /* 物理：生成对应食材刚体 */ });
```

## 设计文档

- 《GDD 大纲（核心循环 + 系统结构）》`../docs/05-GDD大纲.md`
- 《数值策划表》`../docs/04-数值策划表.md`
- 《性能红线与防卡顿规范》`../docs/03-性能红线与防卡顿规范.md`
- 《代码审查记录》`CODE_REVIEW.md`
