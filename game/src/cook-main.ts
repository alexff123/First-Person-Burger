/**
 * 烹饪循环入口（cook-main.ts）—— 第五阶段整合 Demo
 * 装配：事件总线 + 统一 Ticker + 物理场景 + 烹饪系统 + 市场系统 + 经济结算 + 营业日状态机 + HUD + Juice + 音效。
 *
 * 依赖方向（严格单向，禁止回头）：
 *   物理层发意图 → CookingSystem 判档位 → DayController 统一结算（Economy/Market 只算不广播）
 *   → 结果事件 → HUD / Juice / 音频 / 物理场景 只负责表现。
 *
 * ⚠ 装配顺序很关键：
 *   DayController 的构造函数会 `day.start()`，即**立刻**广播 phase:changed 与 market:open。
 *   所以所有"观众"（HUD / Juice / 音频）必须先订阅好，再把 DayController 放到最后创建。
 *   否则 HUD 会漏掉开局那一帧的行情，货架要等到第二天才出现 —— 这是很容易踩的坑。
 */
import './style.css';
import { EventBus } from './core/EventBus';
import { Ticker } from './core/Ticker';
import { BusinessDayMachine } from './game/BusinessDayMachine';
import { DayController } from './game/DayController';
import { CookingSystem } from './game/CookingSystem';
import { MarketSystem } from './game/MarketSystem';
import { PhysicsScene } from './render/PhysicsScene';
import { Hud } from './ui/Hud';
import { Juice } from './ui/Juice';
import { AudioManager } from './audio/AudioManager';
import type { GameEvents } from './game/events';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const bus = new EventBus<GameEvents>({ debug: false }); // 关掉逐事件日志，火候事件高频
const ticker = new Ticker();

// ---- 1. 玩法层（纯计算器，自己不广播）----
const market = new MarketSystem();

// ---- 2. 表现层：必须先订阅，才能收到 DayController 开局的广播 ----
new Hud(bus);
new Juice(bus, canvas);
new AudioManager(bus);

// ---- 3. 物理与烹饪（各自订阅事件）----
const scene = new PhysicsScene(canvas, bus, ticker);
const cooking = new CookingSystem(bus);
ticker.add((dt) => cooking.update(dt));

// ---- 4. 中枢：最后创建，它会立刻 start() 一天 ----
const day = new DayController(bus, new BusinessDayMachine(bus), market);

ticker.start();

// 初始摆几个土豆（锅在正中）
scene.spawnWhole(-3, 2, 1.5);
scene.spawnWhole(3, 2, 1.5);
scene.spawnWhole(0, 2, 3);

window.addEventListener('resize', () => scene.resize());
document.getElementById('btn-endday')?.addEventListener('click', () => day.endDay());
