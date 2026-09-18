import type { EventBus } from '../core/EventBus';
import type { BusinessDayMachine } from './BusinessDayMachine';
import { Events } from './events';
import type { GameEvents } from './events';
import { EconomySystem } from './EconomySystem';

/**
 * 营业日控制器：玩法事件的**唯一结算中枢**。
 *
 * 硬约束（代码审查重点）：
 *   1. CookingSystem 只发 dish:cooked（带档位 + 质量），**不算钱**；
 *   2. 金币只能在这里结算 —— 由本类调用 EconomySystem 后广播 coin:earned / combo:changed；
 *   3. 任何模块之间不得直接互相调用，全部经事件总线。
 *
 * 事件接线：
 *   放入锅中(potato:inPot)        → 采购推进到烹饪
 *   出锅(dish:cooked)             → 统一结算 → 烹饪推进到定价
 *   升级灶台(stove:upgrade)        → 校验资金后升级并广播 stove:changed
 */
export class DayController {
  /** 经济系统归本控制器持有：外部只能通过事件影响它，拿不到引用去乱改 */
  readonly economy = new EconomySystem();

  private readonly bus: EventBus<GameEvents>;

  constructor(
    bus: EventBus<GameEvents>,
    private readonly day: BusinessDayMachine,
  ) {
    this.bus = bus;

    bus.on(Events.PotatoInPot, () => this.day.advanceTo('cooking'));
    bus.on(Events.DishCooked, (payload) => this.settleDish(payload));
    bus.on(Events.StoveUpgrade, () => this.upgradeStove());
    bus.on(Events.IngredientChanged, ({ id }) => this.economy.setIngredient(id));

    this.day.start(); // 进入第 1 天 · 采购
  }

  /**
   * 统一结算：所有金币变动只有这一条路径。
   * 结算完再广播结果事件，表现层只负责演，不负责算。
   */
  private settleDish(payload: GameEvents['dish:cooked']): void {
    const r = this.economy.settle(payload.grade, payload.ingredientId);

    this.bus.emit(Events.ComboChanged, {
      combo: r.combo,
      multiplier: r.multiplier,
      broke: r.broke,
    });
    this.bus.emit(Events.CoinEarned, {
      net: r.net,
      total: r.coins,
      revenue: r.revenue,
      penalty: r.penalty,
      cost: r.cost,
    });
    if (payload.grade === 'burnt') {
      this.bus.emit(Events.CustomerAngry, {
        reason: payload.byPlayer ? '客人看着那锅黑东西，退单了' : '糊味飘满店，客人直接起身走人',
        grade: payload.grade,
      });
    }

    // 出餐即进入定价阶段
    this.day.advanceTo('pricing');
  }

  /** 升灶台：灶上有火时不允许换（否则本锅的账会对不上）。 */
  private upgradeStove(): void {
    if (this.day.current === 'cooking') return;
    const r = this.economy.tryUpgradeStove();
    if (r.ok) {
      this.bus.emit(Events.StoveChanged, { level: r.level, name: this.economy.stove.name });
    }
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
