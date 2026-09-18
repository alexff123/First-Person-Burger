/**
 * 烹饪循环入口（cook-main.ts）—— 第四阶段整合 Demo
 * 装配：事件总线 + 统一 Ticker + 物理场景 + 烹饪系统 + 经济系统 + 营业日状态机 + HUD + Juice + 音效。
 *
 * 依赖方向（严格单向，禁止回头）：
 *   物理层发意图 → CookingSystem 判档位 → DayController 统一结算（EconomySystem 只算不广播）
 *   → 结果事件 → HUD / Juice / 音频 / 物理场景 只负责表现。
 */
import './style.css';
import { EventBus } from './core/EventBus';
import { Ticker } from './core/Ticker';
import { BusinessDayMachine } from './game/BusinessDayMachine';
import { DayController } from './game/DayController';
import { CookingSystem } from './game/CookingSystem';
import { PhysicsScene } from './render/PhysicsScene';
import { Hud } from './ui/Hud';
import { Juice } from './ui/Juice';
import { AudioManager } from './audio/AudioManager';
import type { GameEvents } from './game/events';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const bus = new EventBus<GameEvents>({ debug: false }); // 关掉逐事件日志，火候事件高频
const ticker = new Ticker();

const scene = new PhysicsScene(canvas, bus, ticker);
const cooking = new CookingSystem(bus);
const day = new DayController(bus, new BusinessDayMachine(bus));
new Hud(bus);
new Juice(bus, canvas);
new AudioManager(bus);

ticker.add((dt) => cooking.update(dt));
ticker.start();

// 初始摆几个土豆（锅在正中）
scene.spawnWhole(-3, 2, 1.5);
scene.spawnWhole(3, 2, 1.5);
scene.spawnWhole(0, 2, 3);

window.addEventListener('resize', () => scene.resize());
document.getElementById('btn-endday')?.addEventListener('click', () => day.endDay());
