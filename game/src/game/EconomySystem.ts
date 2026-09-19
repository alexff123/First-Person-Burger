import {
  BURNT_PENALTY_MUL,
  getIngredient,
  getStove,
  MULTIPLIER_CAP,
  OVER_PENALTY_MUL,
  RAW_REVENUE_MUL,
  START_COINS,
  STOVES,
} from './config';
import type { Grade, Ingredient, StoveLevel } from './config';

/** 一次结算的完整账目（UI 直接照此展示，无需二次计算） */
export interface SettleResult {
  grade: Grade;
  /** 结算后的连击数 */
  combo: number;
  /** 本次生效的连击倍率（已封顶） */
  multiplier: number;
  /** 连击是否被本次出餐打断 */
  broke: boolean;
  /** 收入（正数） */
  revenue: number;
  /** 罚金（正数，从收入里扣） */
  penalty: number;
  /** 本次消耗的食材成本 */
  cost: number;
  /** 净利 = revenue - penalty - cost，可为负 */
  net: number;
  /** 结算后总资金 */
  coins: number;
}

export interface UpgradeResult {
  ok: boolean;
  level: number;
  cost: number;
  reason?: string;
}

/**
 * 经济系统（玩法逻辑，纯数据计算器）
 *
 * 关键设计：本类**不发任何事件、不依赖事件总线**。
 * 它只被 DayController 持有并调用，结算结果由 DayController 广播出去。
 * 好处：规则可单测、可独立验证，且彻底杜绝"模块间直接互相调用"的耦合链。
 *
 * 金币规则：
 *   完美 → 售价 × 连击倍率（递增，封顶 MULTIPLIER_CAP），连击 +1
 *   生食 → 售价 × 0.2，连击归零
 *   过火 → 收入 0，倒赔售价 × 0.5，连击归零
 *   焦糊 → 收入 0，重罚售价 × 0.8，连击归零
 *   任何出餐都要扣掉食材采购成本 → 所以失误必亏
 */
export class EconomySystem {
  private coins = START_COINS;
  private combo = 0;
  private stoveLevel = 1;
  private ingredientId = 'potato';

  get balance(): number {
    return this.coins;
  }

  get comboValue(): number {
    return this.combo;
  }

  get multiplier(): number {
    return Math.min(this.combo, MULTIPLIER_CAP);
  }

  get stove(): StoveLevel {
    return getStove(this.stoveLevel);
  }

  get ingredient(): Ingredient {
    return getIngredient(this.ingredientId);
  }

  /** 当前档位的实际售价（含灶台加成），UI 展示用 */
  get currentPrice(): number {
    return Math.round(this.ingredient.price * this.stove.priceMul);
  }

  get isMaxStove(): boolean {
    return this.stoveLevel >= STOVES.length;
  }

  setIngredient(id: string): void {
    this.ingredientId = id;
  }

  /** 收款（采购退款 / 未来事件奖励等）。金币变动的唯一正规入口之一。 */
  earn(amount: number): void {
    this.coins += Math.max(0, Math.round(amount));
  }

  /** 付款。返回是否成功；不会让余额变负（不足则拒绝，由调用方处理）。 */
  spend(amount: number): boolean {
    const cost = Math.max(0, Math.round(amount));
    if (cost > this.coins) return false;
    this.coins -= cost;
    return true;
  }

  /**
   * 结算一锅。
   * @param grade 火候档位（由 CookingSystem 判定并随 dish:cooked 传来）
   * @param ingredientId 这一锅实际用的食材（以事件载荷为准，避免"烹饪中切了食材"造成账目错配）
   * @param unitCost 这一锅**实际消耗的采购成本**（= 当日买进价）。
   *        之所以由外部传入而不是内部查 config：因为成本绑在"你什么时候买的"上，
   *        昨天囤的便宜货和今天追高买的贵料，做出来同一道菜利润不同 —— 这正是采购决策的意义。
   */
  settle(grade: Grade, ingredientId: string, unitCost?: number): SettleResult {
    this.ingredientId = ingredientId;
    const ing = getIngredient(ingredientId);
    const price = Math.round(ing.price * this.stove.priceMul);
    const cost = unitCost ?? ing.cost;

    let revenue = 0;
    let penalty = 0;
    let multiplier = 0;
    let broke = false;

    switch (grade) {
      case 'perfect':
        this.combo += 1;
        multiplier = Math.min(this.combo, MULTIPLIER_CAP);
        revenue = Math.round(price * multiplier);
        break;
      case 'raw':
        broke = this.combo > 0;
        this.combo = 0;
        revenue = Math.round(price * RAW_REVENUE_MUL);
        break;
      case 'over':
        broke = this.combo > 0;
        this.combo = 0;
        penalty = Math.round(price * OVER_PENALTY_MUL);
        break;
      case 'burnt':
        broke = this.combo > 0;
        this.combo = 0;
        penalty = Math.round(price * BURNT_PENALTY_MUL);
        break;
    }

    const net = revenue - penalty - cost;
    this.coins += net;

    return {
      grade,
      combo: this.combo,
      multiplier,
      broke,
      revenue,
      penalty,
      cost,
      net,
      coins: this.coins,
    };
  }

  /** 尝试升级灶台。钱不够或已满级则拒绝，并给出原因。 */
  tryUpgradeStove(): UpgradeResult {
    const next = STOVES.find((s) => s.level === this.stoveLevel + 1);
    if (!next) return { ok: false, level: this.stoveLevel, cost: 0, reason: '已是最高级灶台' };
    if (this.coins < next.upgradeCost) {
      return { ok: false, level: this.stoveLevel, cost: next.upgradeCost, reason: '资金不足' };
    }
    this.coins -= next.upgradeCost;
    this.stoveLevel = next.level;
    return { ok: true, level: next.level, cost: next.upgradeCost };
  }
}
