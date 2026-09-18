/**
 * 游戏事件定义（事件总线载荷契约）
 * 当前列出核心事件；未来物理 / 经济 / 顾客AI 模块在此追加自己的事件名与载荷类型。
 * 事件名用 '域:动作' 约定，避免冲突、便于检索。
 */
import type { DayState } from './BusinessDayMachine';

/** 事件名常量：用常量代替字符串字面量，避免拼写错误。 */
export const Events = {
  PhaseChanged: 'phase:changed',
  DayStart: 'day:start',
  DayEnd: 'day:end',
  OrderCreated: 'order:created',
  DishCooked: 'dish:cooked',
  CustomerAngry: 'customer:angry',
} as const;

/** 事件名 -> 载荷类型的映射，作为 EventBus 的泛型参数，保证 emit/on 类型安全。 */
export interface GameEvents {
  'phase:changed': { from: DayState; to: DayState; day: number };
  'day:start': { day: number };
  'day:end': { day: number; profit: number };
  'order:created': { orderId: string; dish: string };
  'dish:cooked': { orderId: string; quality: number };
  'customer:angry': { customerId: string; reason: string };
}
