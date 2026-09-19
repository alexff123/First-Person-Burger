import type { EventBus } from '../core/EventBus';
import type { BusinessDayMachine } from './BusinessDayMachine';
import { Events } from './events';
import type { GameEvents } from './events';
import { EconomySystem } from './EconomySystem';
import { MarketSystem } from './MarketSystem';
import { BANKRUPTCY_RESCUE, MAX_BUY_BATCH } from './config';

/**
 * 营业日控制器：玩法事件的**唯一结算中枢**。
 *
 * 硬约束（代码审查重点）：
 *   1. CookingSystem 只发 dish:cooked（带档位 + 质量），**不算钱**；
 *   2. 金币只能在这里结算 —— 由本类调用 EconomySystem 后广播 coin:earned / combo:changed；
 *   3. 任何模块之间不得直接互相调用，全部经事件总线；
 *   4. 采购与库存只能在这里裁决 —— MarketSystem 只算账不动钱。
 *
 * 事件接线（第五阶段含采购）：
 *   采购阶段开市(market:open)        → 由 phase:changed(→procurement) 触发，广播今日行情
 *   买入请求(market:buy)             → 校验资金 → 扣钱 + 加库存 → 广播 market:bought / stock:changed
 *   采购完成(procurement:done)       → 采购推进到烹饪
 *   放入锅中(potato:inPot)           → 无料则拒绝；有料则扣一份库存 + 推进到烹饪
 *   出锅(dish:cooked)                → 统一结算 → 烹饪推进到定价
 *   升级灶台(stove:upgrade)          → 校验资金后升级并广播 stove:changed
 */
export class DayController {
  /** 经济系统归本控制器持有：外部只能通过事件影响它，拿不到引用去乱改 */
  readonly economy = new EconomySystem();
  /** 市场系统同理：价格与库存的唯一权威 */
  readonly market: MarketSystem;

  private readonly bus: EventBus<GameEvents>;
  /** 当前这一锅的采购单价快照（入锅时从当日行情取，避免中途价格变动影响已开的锅） */
  private currentUnitCost = 0;
  /** 是否已经为当前这一锅扣过库存（防重复扣） */
  private consumedThisPot = false;

  constructor(
    bus: EventBus<GameEvents>,
    private readonly day: BusinessDayMachine,
    market?: MarketSystem,
  ) {
    this.bus = bus;
    this.market = market ?? new MarketSystem();

    bus.on(Events.DishCooked, (payload) => this.settleDish(payload));
    bus.on(Events.StoveUpgrade, () => this.upgradeStove());
    bus.on(Events.IngredientChanged, ({ id }) => this.selectIngredient(id));
    bus.on(Events.MarketBuy, ({ id, qty }) => this.buy(id, qty));
    bus.on(Events.ProcurementDone, () => this.finishProcurement());
    bus.on(Events.PotatoInPot, () => this.onPotatoInPot());
    // 每天进入采购阶段都重新掷价 + 开市
    bus.on(Events.PhaseChanged, ({ to, day }) => {
      if (to === 'procurement') this.openMarket(day);
    });

    this.day.start(); // 进入第 1 天 · 采购（会触发 phase:changed → openMarket）
  }

  /* ==================== 采购阶段 ==================== */

  /** 开市：每日重掷价格，广播行情，并做破产检查。 */
  private openMarket(day: number): void {
    this.market.rollPrices();
    this.checkBankruptcy();

    this.bus.emit(Events.MarketOpen, {
      day,
      quotes: this.market.list().map((q) => ({
        id: q.ingredient.id,
        name: q.ingredient.name,
        price: q.price,
        delta: q.delta,
        stock: q.stock,
      })),
    });
    this.emitAllStock();
  }

  /**
   * 破产保护检查。
   * 判据 = 钱不够买最便宜的料 **且** 一点库存都没有 —— 才算真的走投无路；
   * 只要还有一份料，玩家就还能开工挣钱，不需要救济。
   * 公开方法：每日开市自动调用，也便于验证与将来做"破产成就"。
   */
  checkBankruptcy(): boolean {
    if (!this.market.rescueNeeded(this.economy.balance)) return false;
    this.market.grantRescue(BANKRUPTCY_RESCUE);
    this.bus.emit(Events.BankruptcyAverted, {
      ingredientName: this.market.rescueIngredientName,
      granted: BANKRUPTCY_RESCUE,
    });
    return true;
  }

  /**
   * 买入。这是全项目**唯一**能因采购而扣金币的地方。
   * 流程：MarketSystem 算"买得起几份" → 这里真正扣钱 → 广播回执与库存。
   */
  private buy(id: string, qty: number): void {
    if (this.day.current !== 'procurement') {
      // 只在采购阶段可进货；其他阶段静默拒绝（UI 已禁用按钮，这里兜底防误触）
      this.bus.emit(Events.MarketBought, {
        id,
        name: this.market.quote(id).ingredient.name,
        qty: 0,
        spent: 0,
        ok: false,
        reason: '只有在采购阶段能进货',
      });
      return;
    }

    const want = Math.min(Math.max(1, Math.floor(qty)), MAX_BUY_BATCH);
    const r = this.market.buy(id, want, this.economy.balance);

    if (!r.ok) {
      this.bus.emit(Events.MarketBought, {
        id,
        name: this.market.quote(id).ingredient.name,
        qty: 0,
        spent: 0,
        ok: false,
        reason: r.reason,
      });
      return;
    }

    // 扣钱：理论上一定成功（buy 已按余额算过份数），失败则回滚库存
    if (!this.economy.spend(r.spent)) {
      this.market.quote(id).stock -= r.qty;
      this.bus.emit(Events.MarketBought, {
        id,
        name: this.market.quote(id).ingredient.name,
        qty: 0,
        spent: 0,
        ok: false,
        reason: '资金不足',
      });
      return;
    }

    this.bus.emit(Events.MarketBought, {
      id,
      name: this.market.quote(id).ingredient.name,
      qty: r.qty,
      spent: r.spent,
      ok: true,
    });
    // 买入会动钱，必须让 HUD 的金币与按钮状态刷新
    this.bus.emit(Events.CoinEarned, {
      net: -r.spent,
      total: this.economy.balance,
      revenue: 0,
      penalty: 0,
      cost: r.spent,
    });
    this.bus.emit(Events.StockChanged, {
      id,
      stock: this.market.stockOf(id),
      total: this.market.totalStock,
    });
  }

  /** 结束采购，进入烹饪阶段（若一份料都没有则拒绝，避免玩家对着空锅发呆）。 */
  private finishProcurement(): void {
    if (this.day.current !== 'procurement') return;
    if (this.market.totalStock <= 0) {
      // 没料不开工：把请求弹回，UI 会提示"先去进货"
      this.bus.emit(Events.MarketBought, {
        id: '',
        name: '',
        qty: 0,
        spent: 0,
        ok: false,
        reason: '一份食材都没有，先进货',
      });
      return;
    }
    this.day.advanceTo('cooking');
  }

  /* ==================== 烹饪阶段 ==================== */

  /** 切换要做的食材（采购阶段就决定"今天主推什么"，入锅前都能改）。 */
  private selectIngredient(id: string): void {
    this.economy.setIngredient(id);
  }

  /**
   * 入锅：先看阶段，再看库存。
   * 非烹饪阶段 → 直接忽略（采购阶段点食材不该偷跑开工，否则会把进货界面顶掉）；
   * 有料 → 扣一份库存 + 记住单价快照；
   * 没料 → 拒绝，并且**不**推进状态机（否则会出现"空锅在烧"的脏状态）。
   */
  private onPotatoInPot(): void {
    if (this.day.current !== 'cooking') return;

    const id = this.economy.ingredient.id;
    if (!this.market.consume(id)) {
      this.bus.emit(Events.MarketBought, {
        id,
        name: this.economy.ingredient.name,
        qty: 0,
        spent: 0,
        ok: false,
        reason: `${this.economy.ingredient.name}没库存了`,
      });
      return;
    }

    this.currentUnitCost = this.market.priceOf(id); // 用今天买进的价，不用 config 基准价
    this.consumedThisPot = true;
    this.bus.emit(Events.StockChanged, { id, stock: this.market.stockOf(id), total: this.market.totalStock });

    this.day.advanceTo('cooking');
  }

  /**
   * 统一结算：所有金币变动只有这一条路径。
   * 结算完再广播结果事件，表现层只负责演，不负责算。
   */
  private settleDish(payload: GameEvents['dish:cooked']): void {
    // 成本用入锅时锁定的采购价；若没走过入锅流程（如测试直接发事件），退回 config 基准价
    const unitCost = this.consumedThisPot ? this.currentUnitCost : undefined;
    const r = this.economy.settle(payload.grade, payload.ingredientId, unitCost);
    this.consumedThisPot = false;

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

    // 还有料就继续留在烹饪阶段（一锅接一锅地做，这才是"营业"）；
    // 料用光了才进入定价 → 升级 → 打烊收尾。
    if (this.market.totalStock > 0) return;
    this.day.advanceTo('pricing');
  }

  /** 升灶台：灶上有火时不允许换（否则本锅的账会对不上）。 */
  private upgradeStove(): void {
    if (this.day.current === 'cooking') return;
    const r = this.economy.tryUpgradeStove();
    if (r.ok) {
      this.bus.emit(Events.StoveChanged, { level: r.level, name: this.economy.stove.name });
      // 升级扣了钱，同步金币显示
      this.bus.emit(Events.CoinEarned, {
        net: -r.cost,
        total: this.economy.balance,
        revenue: 0,
        penalty: 0,
        cost: r.cost,
      });
    }
  }

  /** 打烊 → 次日（手动按钮触发，走完 定价→升级→打烊→次日采购）。 */
  endDay(): void {
    for (let i = 0; i < 5 && this.day.current !== 'procurement'; i++) {
      this.day.advance();
    }
  }

  /** 广播全部食材库存（开市与批量变动后调用，让 UI 一次对齐）。 */
  private emitAllStock(): void {
    const total = this.market.totalStock;
    for (const q of this.market.list()) {
      this.bus.emit(Events.StockChanged, { id: q.ingredient.id, stock: q.stock, total });
    }
  }

  get current(): string {
    return this.day.current;
  }

  get dayNo(): number {
    return this.day.day;
  }
}
