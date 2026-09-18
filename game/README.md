# 3D 烹饪经营游戏 · 逻辑层核心基建（灰盒）

第二阶段：核心循环状态机 + 事件总线代码骨架。无渲染、无真实玩法，仅供逻辑验证。

## 运行

```bash
npm install
npm run dev      # 打开 http://localhost:5173
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
  main.ts              # 装配 + 极简 UI（仅订阅事件更新）
index.html / src/style.css
```

## 验证点

- 点「推进一阶段」：依次走完 采购→烹饪→定价→升级/事件→打烊→次日，UI 仅通过事件刷新。
- 点「🔥 模拟顾客暴走」：发出 `customer:angry`，独立订阅者实时响应，证明解耦。
- 「自动跑一天」：定时推进，观察日循环与 `day:end` 结算。

## 给未来模块预留的接口

物理 / 经济 / 顾客AI 只需：

```ts
bus.on('order:created', (p) => { /* 物理：生成食材刚体 */ });
bus.on('dish:cooked',   (p) => { /* 经济：结算收入 */ });
bus.on('customer:angry',(p) => { /* AI：降声誉、触发离场 */ });
```

不持有彼此引用，新增模块不影响现有代码（YAGNI）。
