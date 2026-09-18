/**
 * 场景入口（scene-main.ts）—— 纯切土豆 Demo
 * 只做物理渲染，不接玩法系统；用于单独验证物理与粒子。
 */
import './style.css';
import { EventBus } from './core/EventBus';
import { Ticker } from './core/Ticker';
import { PhysicsScene } from './render/PhysicsScene';
import type { GameEvents } from './game/events';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const bus = new EventBus<GameEvents>();
const ticker = new Ticker();

const scene = new PhysicsScene(canvas, bus, ticker);
scene.spawnWhole(0, 2, 0);
scene.spawnWhole(-2.5, 2, 1);
scene.spawnWhole(2.5, 2, -1);

window.addEventListener('resize', () => scene.resize());
ticker.start();
