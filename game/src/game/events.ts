/**
 * 游戏事件定义（事件总线载荷契约）
 * 所有模块（物理层 / 玩法系统 / HUD / 音效）只通过事件名与载荷通信，互相不持有引用。
 * 事件名用 '域:动作' 约定，避免冲突、便于检索。
 */
import type { DayState } from './BusinessDayMachine';

/** 事件名常量：用常量代替字符串字面量，避免拼写错误。 */
export const Events = {
  // 营业日 / 状态机
  PhaseChanged: 'phase:changed',
  DayStart: 'day:start',
  DayEnd: 'day:end',
  // 订单 / 顾客
  OrderCreated: 'order:created',
  DishCooked: 'dish:cooked',
  CustomerAngry: 'customer:angry',
  // 物理层发出的意图（input）
  PotatoCut: 'potato:cut',
  PotatoInPot: 'potato:inPot',
  PotClicked: 'pot:clicked',
  // 烹饪循环（玩法系统）
  CookingStart: 'cooking:start',
  CookingProgress: 'cooking:progress',
  DishPrepared: 'dish:prepared',
  DishServed: 'dish:served',
  DishBurnt: 'dish:burnt',
  // 反馈（Juice）
  ComboChanged: 'combo:changed',
  CoinEarned: 'coin:earned',
} as const;

/** 事件名 -> 载荷类型的映射，作为 EventBus 的泛型参数，保证 emit/on 类型安全。 */
export interface GameEvents {
  // 营业日 / 状态机
  'phase:changed': { from: DayState; to: DayState; day: number };
  'day:start': { day: number };
  'day:end': { day: number; profit: number };
  // 订单 / 顾客
  'order:created': { orderId: string; dish: string };
  'dish:cooked': { orderId: string; quality: number };
  'customer:angry': { customerId: string; reason: string };
  // 物理层意图
  'potato:cut': { chunks: number };
  'potato:inPot': Record<string, never>;
  'pot:clicked': Record<string, never>;
  // 烹饪循环
  'cooking:start': { dish: string };
  'cooking:progress': { heat: number; sweetMin: number; sweetMax: number };
  'dish:prepared': { slices: number };
  'dish:served': { perfect: boolean; quality: number; coins: number; combo: number };
  'dish:burnt': { reason: string };
  // 反馈
  'combo:changed': { combo: number };
  'coin:earned': { amount: number; total: number };
}
