/**
 * 演示驱动器（Demo Driver）—— 灰盒验证用，非真实玩法实现（YAGNI）
 * 作用：推进营业日状态机，并在对应阶段抛出示例领域事件，
 *       证明「物理 / 经济 / 顾客AI 模块」未来只需订阅事件即可解耦通信。
 */
import type { EventBus } from '../core/EventBus';
import type { BusinessDayMachine } from './BusinessDayMachine';
import { Events } from './events';
import type { GameEvents } from './events';
import { BURN_AT, gradeOf, qualityOf, resolveCookParams } from './config';

export class DemoDriver {
  private seq = 0;

  constructor(
    private readonly bus: EventBus<GameEvents>,
    private readonly day: BusinessDayMachine,
  ) {}

  /** 推进一步，并模拟该阶段产生的领域事件。 */
  step(): void {
    this.day.advance();
    this.simulatePhase(this.day.current);
  }

  /** 手动触发「顾客暴走」事件，验证事件总线实时解耦通信。 */
  triggerCustomerAngry(): void {
    this.bus.emit(Events.CustomerAngry, {
      reason: '等太久，掀桌了',
      grade: 'burnt',
    });
  }

  // 仅在该阶段抛出对应事件，模拟未来模块的行为；不实现真实逻辑
  private simulatePhase(state: string): void {
    switch (state) {
      case 'cooking': {
        this.bus.emit(Events.OrderCreated, { orderId: `o-${++this.seq}`, dish: '土豆' });
        // 随机火候走一遍真实判定链路，四个档位都可能出现（含 >100 的焦糊）
        const p = resolveCookParams('potato', 1);
        const heat = Math.random() * 106;
        const grade = gradeOf(heat, p.sweetMin, p.sweetMax);
        this.bus.emit(Events.DishCooked, {
          dish: p.dish,
          ingredientId: p.ingredientId,
          grade,
          quality: qualityOf(grade, heat, p.sweetMin, p.sweetMax),
          heat,
          byPlayer: heat < BURN_AT,
        });
        break;
      }
      case 'upgrade':
        // 随机事件：有概率触发顾客不满，验证事件可被独立订阅者捕获
        if (Math.random() < 0.4) this.triggerCustomerAngry();
        break;
      default:
        break;
    }
  }
}
