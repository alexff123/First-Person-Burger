/**
 * 事件总线（Event Bus）
 * 全游戏模块间解耦通信的唯一通道。
 * 物理 / 经济 / 顾客AI 等未来模块通过 on() 订阅、emit() 发布，互相不持有引用。
 */

export type EventHandler<T> = (payload: T) => void;

export interface BusOptions {
  debug?: boolean;
  /** 日志钩子，默认 console.log；传入自定义函数可同时打到 UI 面板，便于调试追踪。 */
  logger?: (msg: string) => void;
}

export class EventBus<M extends object> {
  private handlers = new Map<keyof M, Set<EventHandler<unknown>>>();
  private readonly debug: boolean;
  private readonly logger: (msg: string) => void;

  constructor(opts: BusOptions = {}) {
    this.debug = opts.debug ?? true;
    this.logger = opts.logger ?? ((m: string) => console.log(m));
  }

  /** 订阅事件，返回取消函数（组件卸载时调用，防泄漏）。 */
  on<K extends keyof M>(name: K, handler: EventHandler<M[K]>): () => void {
    let set = this.handlers.get(name);
    if (!set) {
      set = new Set();
      this.handlers.set(name, set);
    }
    set.add(handler as EventHandler<unknown>);
    return () => this.off(name, handler);
  }

  off<K extends keyof M>(name: K, handler: EventHandler<M[K]>): void {
    this.handlers.get(name)?.delete(handler as EventHandler<unknown>);
  }

  emit<K extends keyof M>(name: K, payload: M[K]): void {
    if (this.debug) this.logger(`[BUS] emit ${String(name)} ${JSON.stringify(payload)}`);
    const set = this.handlers.get(name);
    if (!set || set.size === 0) return;
    // 复制快照遍历：允许回调内安全地增删订阅，不影响本次派发
    for (const handler of [...set]) {
      (handler as EventHandler<M[K]>)(payload);
    }
  }
}
