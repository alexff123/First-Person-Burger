# 3D 烹饪经营游戏 · 逻辑层核心基建（灰盒）

第二阶段：核心循环状态机 + 事件总线代码骨架。无渲染、无真实玩法，仅供逻辑验证。

## 运行

```bash
npm install
npm run dev      # 打开 http://localhost:5173  (灰盒)  /  http://localhost:5173/scene.html  (切土豆)
```

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
  game/
    events.ts          # 事件名常量 + 载荷契约 GameEvents
    BusinessDayMachine.ts  # 营业日状态机：采购→烹饪→定价→升级/事件→打烊→次日
    DemoDriver.ts      # 灰盒驱动器：推进流程并模拟领域事件
  render/
    ObjectPool.ts      # 通用对象池（土豆 / 碎块 / 粒子复用）
    ParticleSystem.ts  # 果汁粒子（InstancedMesh，单批次渲染）
    PhysicsScene.ts    # Three.js + cannon-es：场景 / 物理世界 / 射线切土豆
  main.ts              # 灰盒装配 + 极简 UI（仅订阅事件更新）
  scene-main.ts        # 切土豆 Demo 装配入口
index.html / scene.html / src/style.css
```

## 验证点（灰盒）

- 点「推进一阶段」：依次走完 采购→烹饪→定价→升级/事件→打烊→次日，UI 仅通过事件刷新。
- 点「🔥 模拟顾客暴走」：发出 `customer:angry`，独立订阅者实时响应，证明解耦。
- 「自动跑一天」：定时推进，观察日循环与 `day:end` 结算。

## 验证点（切土豆 3D Demo，scene.html）

- 点土豆：碎成 6 块并受重力飞溅，撞地面/彼此碰撞；果汁粒子四溅。
- 点地面：在落点摆一个新土豆（对象池复用，无运行时 new）。
- 对象池预创建完整土豆(8) + 碎块(48)；粒子固定 300 容量循环复用。
- 渲染循环 rAF + 固定步长(1/60) 物理，符合性能红线。

## 给未来模块预留的接口

物理 / 经济 / 顾客AI 只需：

```ts
bus.on('order:created', (p) => { /* 物理：生成食材刚体 */ });
bus.on('dish:cooked',   (p) => { /* 经济：结算收入 */ });
bus.on('customer:angry',(p) => { /* AI：降声誉、触发离场 */ });
```

不持有彼此引用，新增模块不影响现有代码（YAGNI）。
