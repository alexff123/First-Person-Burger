/**
 * 通用有限状态机（FSM）
 * 驱动营业日流程。设计目标：状态流转可追踪（每次转移打印日志）、可调试（可查询当前状态与合法转移）。
 * 不依赖具体业务，BusinessDayMachine 在其上定义营业日状态。
 */

export type EnterHook = (ctx: unknown) => void;

export interface Transition<S extends string> {
  from: S;
  to: S;
  onEnter?: EnterHook;
}

export interface FSMOptions {
  debug?: boolean;
  logger?: (msg: string) => void;
}

export class StateMachine<S extends string> {
  private readonly states: Set<S>;
  private readonly transitions = new Map<S, Set<S>>();
  private readonly enterHooks = new Map<S, EnterHook[]>();
  private _current: S;
  private readonly debug: boolean;
  private readonly logger: (msg: string) => void;

  constructor(initial: S, states: readonly S[], opts: FSMOptions = {}) {
    this._current = initial;
    this.states = new Set(states);
    this.debug = opts.debug ?? true;
    this.logger = opts.logger ?? ((m: string) => console.log(m));
  }

  get current(): S {
    return this._current;
  }

  /** 注册一条合法转移（from -> to）与进入钩子。状态不存在直接抛错，尽早暴露配置错误。 */
  addTransition(t: Transition<S>): this {
    if (!this.states.has(t.from) || !this.states.has(t.to)) {
      throw new Error(`[FSM] 非法状态: ${t.from} -> ${t.to}`);
    }
    if (!this.transitions.has(t.from)) this.transitions.set(t.from, new Set());
    this.transitions.get(t.from)!.add(t.to);
    if (t.onEnter) {
      const hooks = this.enterHooks.get(t.to) ?? [];
      hooks.push(t.onEnter);
      this.enterHooks.set(t.to, hooks);
    }
    return this;
  }

  canGo(to: S): boolean {
    return this.transitions.get(this._current)?.has(to) ?? false;
  }

  /** 显式转移；非法转移直接抛错，便于测试与调试时发现逻辑漏洞。 */
  go(to: S, ctx: unknown = null): void {
    if (!this.canGo(to)) {
      throw new Error(`[FSM] 非法转移: ${this._current} -> ${to}`);
    }
    if (this.debug) this.logger(`[FSM] ${this._current} -> ${to}`);
    this._current = to;
    for (const hook of this.enterHooks.get(to) ?? []) hook(ctx);
  }
}
