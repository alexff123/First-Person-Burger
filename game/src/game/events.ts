/**
 * 游戏事件定义（事件总线载荷契约）
 * 所有模块（物理层 / 玩法系统 / HUD / 音效）只通过事件名与载荷通信，互相不持有引用。
 * 事件名用 '域:动作' 约定，避免冲突、便于检索。
 */
import type { DayState } from './BusinessDayMachine';
import type { Grade } from './config';

/** 事件名常量：用常量代替字符串字面量，避免拼写错误。 */
export const Events = {
  // 营业日 / 状态机
  PhaseChanged: 'phase:changed',
  DayStart: 'day:start',
  DayEnd: 'day:end',
  // 订单 / 顾客
  OrderCreated: 'order:created',
  CustomerAngry: 'customer:angry',
  // 物理层发出的意图（input）
  PotatoCut: 'potato:cut',
  PotatoInPot: 'potato:inPot',
  PotClicked: 'pot:clicked',
  // 烹饪循环（玩法系统）
  CookingStart: 'cooking:start',
  CookingProgress: 'cooking:progress',
  DishPrepared: 'dish:prepared',
  /** 唯一的出锅结果事件：四个档位全部走这里（生食/完美/过火/焦糊） */
  DishCooked: 'dish:cooked',
  // 经济结算（仅 DayController 广播）
  ComboChanged: 'combo:changed',
  CoinEarned: 'coin:earned',
  // 经营操作
  StoveUpgrade: 'stove:upgrade',
  StoveChanged: 'stove:changed',
  IngredientChanged: 'ingredient:changed',
} as const;

/** 事件名 -> 载荷类型的映射，作为 EventBus 的泛型参数，保证 emit/on 类型安全。 */
export interface GameEvents {
  // 营业日 / 状态机
  'phase:changed': { from: DayState; to: DayState; day: number };
  'day:start': { day: number };
  'day:end': { day: number; profit: number };
  // 订单 / 顾客
  'order:created': { orderId: string; dish: string };
  'customer:angry': { reason: string; grade: Grade };
  // 物理层意图
  'potato:cut': { chunks: number };
  'potato:inPot': Record<string, never>;
  'pot:clicked': Record<string, never>;
  // 烹饪循环
  'cooking:start': {
    dish: string;
    ingredientId: string;
    heatRate: number;
    sweetMin: number;
    sweetMax: number;
  };
  'cooking:progress': { heat: number; sweetMin: number; sweetMax: number; grade: Grade };
  'dish:prepared': { slices: number };
  /**
   * 出锅结果。审查要求：必须携带档位与质量参数；
   * 金币结算不在此事件内完成，由 DayController 统一处理。
   */
  'dish:cooked': {
    dish: string;
    ingredientId: string;
    grade: Grade;
    quality: number;
    heat: number;
    /** 是否玩家主动出锅（false = 火候烧穿、自动焦糊） */
    byPlayer: boolean;
  };
  // 经济结算
  'combo:changed': { combo: number; multiplier: number; broke: boolean };
  'coin:earned': { net: number; total: number; revenue: number; penalty: number; cost: number };
  // 经营操作
  'stove:upgrade': Record<string, never>;
  'stove:changed': { level: number; name: string };
  'ingredient:changed': { id: string };
}
