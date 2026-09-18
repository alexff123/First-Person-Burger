import type { EventBus } from '../core/EventBus';
import type { BusinessDayMachine } from './BusinessDayMachine';
import { Events } from './events';
import type { GameEvents } from './events';

/**
 * 营业日控制器：把玩法事件接到营业日状态机。
 * 硬约束：状态机只被事件驱动，绝不接触 3D 网格 —— 物理层只发事件，状态机只收事件。
 *   放入锅中(potato:inPot) → 采购推进到烹饪
 *   出餐/焦糊(dish:served|dish:burnt) → 烹饪推进到定价
 */
export class DayController {
  constructor(
    bus: EventBus<GameEvents>,
    private readonly day: BusinessDayMachine,
  ) {
    bus.on(Events.PotatoInPot, () => this.day.advanceTo('cooking'));
    bus.on(Events.DishServed, () => this.day.advanceTo('pricing'));
    bus.on(Events.DishBurnt, () => this.day.advanceTo('pricing'));
    this.day.start(); // 进入第 1 天 · 采购
  }

  /** 打烊 → 次日（手动按钮触发，走完 定价→升级→打烊→次日采购）。 */
  endDay(): void {
    for (let i = 0; i < 5 && this.day.current !== 'procurement'; i++) {
      this.day.advance();
    }
  }

  get current(): string {
    return this.day.current;
  }
  get dayNo(): number {
    return this.day.day;
  }
}
