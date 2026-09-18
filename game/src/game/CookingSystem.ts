import type { EventBus } from '../core/EventBus';
import { Events } from './events';
import type { GameEvents } from './events';

/**
 * 烹饪系统（玩法逻辑，纯数据，绝不接触 3D 网格）
 * 订阅事件总线：土豆入锅 → 起锅加热 → 广播火候；点锅 → 出锅判定；超时 → 焦糊。
 * 连击 / 金币也在这里结算，结果一律广播出去，由 HUD / 音效 / 特效自行响应。
 */
export class CookingSystem {
  readonly sweetMin = 60;
  readonly sweetMax = 80;
  private readonly heatRate = 20; // 每秒火候增量
  private heat = 0;
  private cooking = false;
  private combo = 0;
  private coins = 0;
  private lastHeatInt = -1;

  constructor(private readonly bus: EventBus<GameEvents>) {
    bus.on(Events.PotatoInPot, () => this.startCooking());
    bus.on(Events.PotClicked, () => this.tryServe());
  }

  get heatValue(): number {
    return this.heat;
  }
  get isCooking(): boolean {
    return this.cooking;
  }
  get coinTotal(): number {
    return this.coins;
  }

  private startCooking(): void {
    this.cooking = true;
    this.heat = 0;
    this.lastHeatInt = -1;
    this.bus.emit(Events.CookingStart, { dish: '土豆片' });
    this.bus.emit(Events.CookingProgress, { heat: 0, sweetMin: this.sweetMin, sweetMax: this.sweetMax });
  }

  /** 由 Ticker 每帧驱动（只做数值，不碰渲染）。 */
  update(dt: number): void {
    if (!this.cooking) return;
    this.heat = Math.min(100, this.heat + this.heatRate * dt);
    const h = Math.floor(this.heat);
    if (h !== this.lastHeatInt) {
      this.lastHeatInt = h;
      this.bus.emit(Events.CookingProgress, {
        heat: this.heat,
        sweetMin: this.sweetMin,
        sweetMax: this.sweetMax,
      });
    }
    if (this.heat >= 100) this.burn('火太大，糊锅了');
  }

  private tryServe(): void {
    if (!this.cooking) return;
    const h = this.heat;
    this.cooking = false;
    this.heat = 0;

    const perfect = h >= this.sweetMin && h <= this.sweetMax;
    if (perfect) {
      this.combo += 1;
      const coins = 20 + this.combo * 5; // 连击加成
      this.coins += coins;
      this.bus.emit(Events.DishServed, { perfect: true, quality: 100, coins, combo: this.combo });
      this.bus.emit(Events.ComboChanged, { combo: this.combo });
      this.bus.emit(Events.CoinEarned, { amount: coins, total: this.coins });
    } else {
      this.combo = 0;
      const coins = 5;
      this.coins += coins;
      this.bus.emit(Events.DishServed, {
        perfect: false,
        quality: h < this.sweetMin ? 45 : 60,
        coins,
        combo: 0,
      });
      this.bus.emit(Events.ComboChanged, { combo: 0 });
      this.bus.emit(Events.CoinEarned, { amount: coins, total: this.coins });
    }
  }

  private burn(reason: string): void {
    if (!this.cooking) return;
    this.cooking = false;
    this.heat = 0;
    this.combo = 0;
    this.bus.emit(Events.DishBurnt, { reason });
    this.bus.emit(Events.ComboChanged, { combo: 0 });
  }
}
