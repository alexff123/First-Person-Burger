/**
 * 场景入口（scene-main.ts）
 * 装配切土豆 Demo：创建物理场景、初始摆几个土豆、绑定 resize、启动循环。
 */
import './style.css';
import { PhysicsScene } from './render/PhysicsScene';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const game = new PhysicsScene(canvas, {
  onCut: (n) => console.log(`[FX] 切出 ${n} 块，果汁四溅`),
});

// 初始摆 3 个土豆
game.spawnWhole(0, 2, 0);
game.spawnWhole(-2.5, 2, 1);
game.spawnWhole(2.5, 2, -1);

window.addEventListener('resize', () => game.resize());
game.start();
