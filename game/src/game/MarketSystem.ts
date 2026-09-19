/**
 * 市场系统（采购阶段 · 纯数据计算器）
 *
 * 关键设计（与 EconomySystem 同源）：
 *   本类**不发任何事件、不依赖事件总线**，只被 DayController 持有并调用。
 *   好处：价格与库存规则可单测、可独立验证，且彻底杜绝"模块间直接互相调用"的耦合链。
 *
 * 职责（严格限定）：
 *   1. 每日刷新食材市价（基准价 × 随机浮动 ±PRICE_SWING）；
 *   2. 管理当日库存（买多少份、剩多少份）；
 *   3. 破产判定与救济发放。
 *
 * 明确不做：
 *   - 不扣/加金币（金币归 EconomySystem，由 DayController 这两个之间做转账）；
 *   - 不判定火候、不管连击。
 *
 * 为什么价格刷新要"可注入随机源"：让冒烟测试能锁定价格做确定性断言。
 */
import { getIngredient, INGREDIENTS, MAX_BUY_BATCH, PRICE_SWING } from './config';
import type { Ingredient } from './config';

/** 一种食材当日行情 */
export interface Quote {
  ingredient: Ingredient;
  /** 今日单价（已含浮动，取整） */
  price: number;
  /** 相对基准价的涨跌幅度，如 +0.13 / -0.07（UI 用 ↑↓ 展示） */
  delta: number;
  /** 当前库存份数 */
  stock: number;
}

/** 一次采购的结果 */
export interface BuyResult {
  ok: boolean;
  id: string;
  /** 实际成交份数 */
  qty: number;
  /** 实际花费 */
  spent: number;
  reason?: string;
}

export class MarketSystem {
  /** 今日行情：key = 食材 id */
  private readonly quotes = new Map<string, Quote>();
  private readonly rng: () => number;

  constructor(rng: () => number = Math.random) {
    this.rng = rng;
    this.rollPrices(); // 开局先掷一次，保证进采购阶段就有行情可看
  }

  /**
   * 掷今日价格。
   * 每份库存**不清空**（跨日保留）—— 卖不完的料明天接着用，符合经营直觉；
   * 但价格每天重掷，所以"昨天囤的便宜货"是有价值的决策。
   */
  rollPrices(): void {
    for (const ing of INGREDIENTS) {
      const delta = (this.rng() * 2 - 1) * PRICE_SWING; // ∈ [-0.2, 0.2]
      const raw = ing.cost * (1 + delta);
      // 取整但至少 1 元，避免出现 0 元购
      const price = Math.max(1, Math.round(raw));
      const prev = this.quotes.get(ing.id);
      this.quotes.set(ing.id, {
        ingredient: ing,
        price,
        delta: (price - ing.cost) / ing.cost,
        stock: prev?.stock ?? 0,
      });
    }
  }

  /** 今日全部行情（顺序与 INGREDIENTS 一致，UI 可直接遍历） */
  list(): Quote[] {
    return INGREDIENTS.map((i) => this.quotes.get(i.id)!).filter(Boolean);
  }

  quote(id: string): Quote {
    const q = this.quotes.get(id);
    if (q) return q;
    // 理论不可达（id 都来自 config），兜底给一份基准价行情，绝不抛错打断玩法
    const ing = getIngredient(id);
    return { ingredient: ing, price: ing.cost, delta: 0, stock: 0 };
  }

  /** 指定食材的今日单价 */
  priceOf(id: string): number {
    return this.quote(id).price;
  }

  /** 当前库存份数 */
  stockOf(id: string): number {
    return this.quote(id).stock;
  }

  /** 全部库存合计（UI 显示"今天有多少料可做"） */
  get totalStock(): number {
    return this.list().reduce((s, q) => s + q.stock, 0);
  }

  /**
   * 采购：买入 qty 份。
   * 本方法**只算账不动钱**，返回 spent 由 DayController 去扣 —— 保持"金币唯一出口"。
   * @param budget 当前可用资金（由调用方传入，避免本类反向依赖 EconomySystem）
   */
  buy(id: string, qty: number, budget: number): BuyResult {
    const q = this.quote(id);
    if (qty <= 0) return { ok: false, id, qty: 0, spent: 0, reason: '份数必须为正' };

    const want = Math.min(qty, MAX_BUY_BATCH);
    const affordable = Math.floor(budget / q.price);
    const actual = Math.min(want, affordable);

    if (actual <= 0) {
      return {
        ok: false,
        id,
        qty: 0,
        spent: 0,
        reason: budget < q.price ? '资金不足' : '份数无效',
      };
    }

    q.stock += actual;
    return { ok: true, id, qty: actual, spent: actual * q.price };
  }

  /**
   * 消耗一份库存（出一锅菜用掉一份料）。
   * @returns 是否成功扣减；false 表示没料了（此时不该允许开火）
   */
  consume(id: string): boolean {
    const q = this.quote(id);
    if (q.stock <= 0) return false;
    q.stock -= 1;
    return true;
  }

  /**
   * 今日最便宜的食材。破产救济只发它（救济是"让你能继续玩"，不是"奖励破产"）。
   * 抽成私有方法：原先 rescueNeeded / grantRescue / rescueIngredientName 各算一遍，属重复。
   */
  private cheapest(): Ingredient {
    let best = INGREDIENTS[0];
    for (const i of INGREDIENTS) {
      if (this.priceOf(i.id) < this.priceOf(best.id)) best = i;
    }
    return best;
  }

  /**
   * 破产保护：是否需要救济。
   * 判据 = 钱不够买最便宜的料 **且** 一点库存都没有 —— 才算真的走投无路。
   * 只要还剩一份料，玩家就还能开工挣钱，不该发救济。
   */
  rescueNeeded(coins: number): boolean {
    return coins < this.priceOf(this.cheapest().id) && this.totalStock === 0;
  }

  /** 发放救济（免费给最便宜的料若干份）。 */
  grantRescue(qty: number): void {
    const q = this.quote(this.cheapest().id);
    q.stock += qty;
  }

  /** 救济发的是什么料（UI 提示用） */
  get rescueIngredientName(): string {
    return this.cheapest().name;
  }
}
