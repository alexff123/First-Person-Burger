/**
 * 入口（main.ts）
 * 装配事件总线、营业日状态机、演示驱动器，并接上极简 UI。
 * 用「事件订阅」驱动 UI 更新，证明状态机与 UI 完全解耦。
 */
import './style.css';
import { EventBus } from './core/EventBus';
import { BusinessDayMachine } from './game/BusinessDayMachine';
import { DemoDriver } from './game/DemoDriver';
import { Events } from './game/events';
import type { GameEvents } from './game/events';

// ---- 极简日志：同时打到控制台与屏幕面板，满足「可追踪、可调试」 ----
const logEl = document.getElementById('log') as HTMLDivElement;
function uiLog(msg: string): void {
  console.log(msg);
  const line = document.createElement('div');
  line.className = 'log-line';
  line.textContent = msg;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

// ---- 装配核心基建 ----
const bus = new EventBus<GameEvents>({ logger: uiLog });
const dayMachine = new BusinessDayMachine(bus, uiLog);
const driver = new DemoDriver(bus, dayMachine);

// ---- UI 状态展示：仅订阅事件，不主动读取状态机（解耦） ----
const stateEl = document.getElementById('state') as HTMLSpanElement;
const dayEl = document.getElementById('day') as HTMLSpanElement;

bus.on(Events.PhaseChanged, ({ to, day }) => {
  stateEl.textContent = to;
  dayEl.textContent = String(day);
});
bus.on(Events.DayStart, ({ day }) => uiLog(`🌅 第 ${day} 天开张`));
bus.on(Events.DayEnd, ({ day, profit }) => uiLog(`🌙 第 ${day} 天打烊，利润 ${profit}`));

// ---- 示例订阅者：模拟「顾客AI监控模块」，仅监听 customer:angry ----
// 证明未来模块无需知道是谁、为何触发，只管响应事件。
bus.on(Events.CustomerAngry, ({ customerId, reason }) => {
  uiLog(`🤬 顾客 ${customerId} 暴走：${reason}`);
});

// ---- 示例订阅者：模拟「经济模块」，监听出餐计算收入 ----
bus.on(Events.DishCooked, ({ orderId, quality }) => {
  uiLog(`🍽️ ${orderId} 出餐，品质 ${quality}`);
});

// ---- UI 交互 ----
document.getElementById('btn-step')!.addEventListener('click', () => driver.step());
document.getElementById('btn-angry')!.addEventListener('click', () => driver.triggerCustomerAngry());

let timer: number | undefined;
document.getElementById('btn-auto')!.addEventListener('click', (e) => {
  const btn = e.target as HTMLButtonElement;
  if (timer) {
    clearInterval(timer);
    timer = undefined;
    btn.textContent = '⏯ 自动跑一天';
  } else {
    timer = window.setInterval(() => driver.step(), 1200);
    btn.textContent = '⏸ 暂停';
  }
});

uiLog('灰盒就绪：点「推进一阶段」跑通营业日流程');
