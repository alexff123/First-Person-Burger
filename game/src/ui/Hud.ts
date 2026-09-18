import type { EventBus } from '../core/EventBus';
import { Events } from '../game/events';
import type { GameEvents } from '../game/events';

const PHASE_LABEL: Record<string, string> = {
  idle: '待机',
  procurement: '采购',
  cooking: '烹饪',
  pricing: '定价',
  upgrade: '升级/事件',
  closing: '打烊',
};

/**
 * HUD（火候条 / 订单栏 / 金币 / 连击 / 天数阶段）
 * 纯订阅事件更新 DOM，不主动读取任何系统状态，天然解耦。
 */
export class Hud {
  private readonly heatBar = document.getElementById('heatbar') as HTMLElement;
  private readonly heatFill = document.getElementById('heat-fill') as HTMLElement;
  private readonly heatNum = document.getElementById('heat-num') as HTMLElement;
  private readonly sweetZone = document.getElementById('sweet-zone') as HTMLElement;
  private readonly orderDish = document.getElementById('order-dish') as HTMLElement;
  private readonly orderStatus = document.getElementById('order-status') as HTMLElement;
  private readonly comboEl = document.getElementById('combo') as HTMLElement;
  private readonly coinsEl = document.getElementById('coins') as HTMLElement;
  private readonly dayEl = document.getElementById('hud-day') as HTMLElement;
  private readonly phaseEl = document.getElementById('hud-phase') as HTMLElement;

  constructor(bus: EventBus<GameEvents>) {
    bus.on(Events.CookingStart, ({ dish }) => {
      this.heatBar.classList.add('active'); // 火候条"亮起来"
      this.orderDish.textContent = `${dish} ×1`;
      this.setOrder('烹饪中', 'cooking');
    });
    bus.on(Events.CookingProgress, ({ heat, sweetMin, sweetMax }) => {
      this.heatFill.style.width = `${heat}%`;
      this.heatNum.textContent = String(Math.round(heat));
      this.sweetZone.style.left = `${sweetMin}%`;
      this.sweetZone.style.width = `${sweetMax - sweetMin}%`;
      this.heatFill.classList.toggle('sweet', heat >= sweetMin && heat <= sweetMax);
    });
    bus.on(Events.DishPrepared, ({ slices }) => this.setOrder(`已切片 ×${slices}`, 'prepared'));
    bus.on(Events.DishServed, ({ perfect }) => {
      this.heatBar.classList.remove('active');
      this.setOrder(perfect ? '完美出餐！' : '出餐（勉强）', perfect ? 'perfect' : 'ok');
      this.heatFill.style.width = '0%';
      this.heatNum.textContent = '0';
      window.setTimeout(() => this.setOrder('待制作', ''), 900);
    });
    bus.on(Events.DishBurnt, () => {
      this.heatBar.classList.remove('active');
      this.setOrder('糊了…', 'burnt');
      this.heatFill.style.width = '0%';
      this.heatNum.textContent = '0';
      window.setTimeout(() => this.setOrder('待制作', ''), 1200);
    });
    bus.on(Events.ComboChanged, ({ combo }) => {
      this.comboEl.textContent = combo > 1 ? `连击 x${combo} 🔥` : '';
    });
    bus.on(Events.CoinEarned, ({ total }) => {
      this.coinsEl.textContent = String(total);
    });
    bus.on(Events.PhaseChanged, ({ to, day }) => {
      this.phaseEl.textContent = PHASE_LABEL[to] ?? to;
      this.dayEl.textContent = `第 ${day} 天`;
    });
  }

  private setOrder(text: string, cls: string): void {
    this.orderStatus.textContent = text;
    this.orderStatus.className = `order-status ${cls}`.trim();
  }
}
