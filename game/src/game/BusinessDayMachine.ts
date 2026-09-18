/**
 * 营业日状态机（Business Day FSM）
 * 在通用 StateMachine 上定义营业日流程：
 *   采购(procurement) → 烹饪(cooking) → 定价(pricing) → 升级/事件(upgrade) → 打烊(closing) → 次日(procurement 循环)
 * 每次进入状态通过事件总线广播 phase:changed，UI 与未来模块据此响应，互不耦合。
 */
import { StateMachine } from '../core/StateMachine';
import type { EventBus } from '../core/EventBus';
import { Events } from './events';
import type { GameEvents } from './events';

export type DayState =
  | 'idle'
  | 'procurement'
  | 'cooking'
  | 'pricing'
  | 'upgrade'
  | 'closing';

// 营业日线性阶段顺序；打烊后回到 procurement 形成日循环
const ORDER: DayState[] = ['procurement', 'cooking', 'pricing', 'upgrade', 'closing'];

export class BusinessDayMachine {
  readonly fsm: StateMachine<DayState>;
  day = 1;

  constructor(
    private readonly bus: EventBus<GameEvents>,
    logger?: (msg: string) => void,
  ) {
    this.fsm = new StateMachine<DayState>('idle', ['idle', ...ORDER], { logger });

    // 仅登记合法转移；转移副作用（广播事件）在 advance() 内统一处理，逻辑集中、易追踪
    this.fsm.addTransition({ from: 'idle', to: 'procurement' });
    for (let i = 0; i < ORDER.length - 1; i++) {
      this.fsm.addTransition({ from: ORDER[i], to: ORDER[i + 1] });
    }
    // 打烊 → 次日采购，闭环
    this.fsm.addTransition({ from: 'closing', to: 'procurement' });
  }

  get current(): DayState {
    return this.fsm.current;
  }

  /** 开张：进入第 1 天采购阶段，并广播 day:start。 */
  start(): void {
    this.transitionTo('procurement');
    this.bus.emit(Events.DayStart, { day: this.day });
  }

  /** 推进一步营业日；非法推进会由底层 FSM 抛错。 */
  advance(): void {
    const cur = this.fsm.current;
    if (cur === 'idle') {
      this.start();
      return;
    }
    const idx = ORDER.indexOf(cur);
    const next = cur === 'closing' ? 'procurement' : ORDER[idx + 1];
    if (cur === 'closing') this.day += 1; // 进入次日
    this.transitionTo(next);
    if (cur === 'closing') {
      this.bus.emit(Events.DayEnd, { day: this.day - 1, profit: this.mockProfit() });
    }
  }

  /** 事件驱动：仅在合法时跳转到目标阶段；非法（乱序事件）直接忽略并返回 false。 */
  advanceTo(target: DayState): boolean {
    if (this.fsm.current === target) return true;
    if (!this.fsm.canGo(target)) return false;
    if (this.fsm.current === 'closing' && target === 'procurement') this.day += 1;
    this.transitionTo(target);
    return true;
  }

  /** 内部：执行 FSM 转移并广播 phase:changed（携带 from，满足可追踪）。 */
  private transitionTo(to: DayState): void {
    const from = this.fsm.current;
    this.fsm.go(to);
    this.bus.emit(Events.PhaseChanged, { from, to, day: this.day });
  }

  // 灰盒占位：真实利润由经济模块计算，这里只给个模拟值
  private mockProfit(): number {
    return Math.floor(Math.random() * 500) - 50;
  }
}
