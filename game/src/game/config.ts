/**
 * 玩法数值配置（单一事实来源）
 * 所有档位 / 食材 / 灶台 / 经济常量集中在此，改数值只改这一个文件。
 * 约束：本文件零依赖（不 import 任何模块），可被玩法层 / UI 层安全引用。
 */

/** 火候档位：生食 / 完美 / 过火 / 焦糊 */
export type Grade = 'raw' | 'perfect' | 'over' | 'burnt';

/** 档位中文名（UI 与日志共用，避免各处硬编码字符串） */
export const GRADE_LABEL: Record<Grade, string> = {
  raw: '生食',
  perfect: '完美',
  over: '过火',
  burnt: '焦糊',
};

/** 火候封顶值：到达即自动焦糊 */
export const BURN_AT = 100;

/** 连击倍率封顶（防金币指数膨胀；调参入口唯一在此） */
export const MULTIPLIER_CAP = 10;

/** 开局资金（够亏几次，逼玩家尽快学会看火） */
export const START_COINS = 60;

/** 各档位收入 / 罚金系数（乘在"售价"上） */
export const RAW_REVENUE_MUL = 0.2; // 生食：贱卖
export const OVER_PENALTY_MUL = 0.5; // 过火：倒赔顾客
export const BURNT_PENALTY_MUL = 0.8; // 焦糊：重罚

/**
 * 食材外观（灰盒视觉标识，纯表现参数，不参与任何判定）
 *
 * 定位：这是"数值层与表现层之间的唯一契约"。
 *   - 玩法层（CookingSystem / EconomySystem）只读 heatRate/price/cost 等数值字段；
 *   - 表现层（PhysicsScene）只读这里的配色与几何，用来回答"玩家选的是哪种料"。
 * 之所以放在 config.ts 而非 render/：外观跟着食材走，是食材的属性；
 * 放在渲染层会造成"数值改了外观没跟上"的漂移（本阶段就是修这个 bug）。
 */
export interface IngredientLook {
  /** 主体颜色（网格 + 锅内内容物） */
  color: number;
  /**
   * 几何缩放：x 长 / y 高 / z 宽，作用在 SphereGeometry(r) 上。
   * 土豆=椭球、豆腐=方墩、和牛=扁片，全靠这三个数区分（不做真实建模，守灰盒约束）。
   */
  scale: readonly [number, number, number];
  /** 碎块尺寸倍率：和牛切片薄、豆腐块厚 */
  chunkRadius: number;
  /** 切料时的汁水/碎屑粒子颜色 */
  juiceColor: number;
  /** 粗糙度：豆腐哑光、和牛油润 */
  roughness: number;
}

/** 食材：决定火候曲线与价格成本，以及灰盒外观 */
export interface Ingredient {
  id: string;
  name: string;
  /** 基础升温速率（点/秒），还要乘灶台倍率 */
  heatRate: number;
  /** 甜区中心（火候点） */
  sweetCenter: number;
  /** 甜区基础宽度（火候点），还要乘灶台甜区系数 */
  sweetSpan: number;
  /** 基础售价 */
  price: number;
  /** 单次采购成本（每次出锅消耗一份）——仅作默认基准价，实际以当日市价为准 */
  cost: number;
  /** 灰盒外观（表现层专用） */
  look: IngredientLook;
}

export const INGREDIENTS: readonly Ingredient[] = [
  // 土豆：基准菜。5 秒烧完，甜区 1 秒。新手村。外观=黄褐椭球。
  {
    id: 'potato',
    name: '土豆',
    heatRate: 20,
    sweetCenter: 70,
    sweetSpan: 20,
    price: 30,
    cost: 8,
    look: { color: 0xc8a165, scale: [1.2, 0.85, 1.0], chunkRadius: 0.28, juiceColor: 0x9bd64a, roughness: 0.9 },
  },
  // 豆腐：慢火 + 宽窗，容错最高，但也不值钱。外观=米白方墩（scale 三轴接近，看着方正）。
  {
    id: 'tofu',
    name: '豆腐',
    heatRate: 16,
    sweetCenter: 65,
    sweetSpan: 26,
    price: 24,
    cost: 6,
    look: { color: 0xf2ece0, scale: [1.15, 1.15, 1.0], chunkRadius: 0.32, juiceColor: 0xe8e0d0, roughness: 1.0 },
  },
  // 和牛：火快、窗口窄到 0.4 秒，糊一次赔到肉疼。外观=暗红扁片（y 压到 0.45）。
  {
    id: 'wagyu',
    name: '和牛',
    heatRate: 30,
    sweetCenter: 72,
    sweetSpan: 12,
    price: 90,
    cost: 34,
    look: { color: 0x8b3a3a, scale: [1.35, 0.45, 1.1], chunkRadius: 0.22, juiceColor: 0xd94f4f, roughness: 0.55 },
  },
];

/** 灶台等级：越高级越赚，也越难控 */
export interface StoveLevel {
  level: number;
  name: string;
  /** 升温倍率 */
  heatMul: number;
  /** 甜区宽度倍率（<1 = 窗口变窄 = 更难） */
  sweetMul: number;
  /** 售价倍率 */
  priceMul: number;
  /** 升到本级的花费 */
  upgradeCost: number;
}

export const STOVES: readonly StoveLevel[] = [
  { level: 1, name: '家用灶', heatMul: 1.0, sweetMul: 1.0, priceMul: 1.0, upgradeCost: 0 },
  { level: 2, name: '商用灶', heatMul: 1.25, sweetMul: 0.85, priceMul: 1.25, upgradeCost: 120 },
  { level: 3, name: '猛火灶', heatMul: 1.5, sweetMul: 0.75, priceMul: 1.5, upgradeCost: 320 },
  { level: 4, name: '分子料理灶', heatMul: 1.75, sweetMul: 0.68, priceMul: 1.8, upgradeCost: 800 },
];

export function getIngredient(id: string): Ingredient {
  return INGREDIENTS.find((i) => i.id === id) ?? INGREDIENTS[0];
}

export function getStove(level: number): StoveLevel {
  return STOVES.find((s) => s.level === level) ?? STOVES[0];
}

/** 一锅的实参：由「食材 × 灶台」解算，进入烹饪时快照一次 */
export interface CookParams {
  dish: string;
  ingredientId: string;
  /** 实际升温速率（点/秒） */
  heatRate: number;
  sweetMin: number;
  sweetMax: number;
  /** 实际售价（含灶台加成） */
  price: number;
  /** 采购成本 */
  cost: number;
  /** 灰盒外观（表现层用，玩法层忽略） */
  look: IngredientLook;
}

/**
 * 解算一锅的烹饪参数。
 * 甜区宽度 = 食材基础宽度 × 灶台甜区系数（灶台越高级，窗口越窄 → 这就是难度来源）。
 * 甜区中心固定（由食材决定），因此窗口是"向中心两侧收缩"而不是单向漂移。
 */
export function resolveCookParams(ingredientId: string, stoveLevel: number): CookParams {
  const ing = getIngredient(ingredientId);
  const stove = getStove(stoveLevel);
  const span = ing.sweetSpan * stove.sweetMul;
  const half = span / 2;
  return {
    dish: ing.name,
    ingredientId: ing.id,
    heatRate: ing.heatRate * stove.heatMul,
    sweetMin: Math.max(0, ing.sweetCenter - half),
    sweetMax: Math.min(BURN_AT, ing.sweetCenter + half),
    price: Math.round(ing.price * stove.priceMul),
    cost: ing.cost,
    look: ing.look,
  };
}

/** 由火候值判定档位（唯一判定入口，禁止各处自行比较） */
export function gradeOf(heat: number, sweetMin: number, sweetMax: number): Grade {
  if (heat >= BURN_AT) return 'burnt';
  if (heat < sweetMin) return 'raw';
  if (heat <= sweetMax) return 'perfect';
  return 'over';
}

/** 质量分（0~100）：完美恒 100，其余按偏离甜区的距离线性衰减 */
export function qualityOf(grade: Grade, heat: number, sweetMin: number, sweetMax: number): number {
  if (grade === 'perfect') return 100;
  if (grade === 'burnt') return 0;
  if (grade === 'raw') {
    return sweetMin <= 0 ? 0 : Math.round((heat / sweetMin) * 60);
  }
  const span = BURN_AT - sweetMax;
  if (span <= 0) return 30;
  return Math.max(30, Math.round(80 - 50 * ((heat - sweetMax) / span)));
}
