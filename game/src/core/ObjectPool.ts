/**
 * 通用对象池（Object Pool）
 * 预先创建、复用对象，避免运行时频繁 new / GC，满足性能红线「对象池化」要求。
 *
 * 归属说明：本类是**与渲染无关的纯工具**（零 three/cannon 依赖），因此放在 core/ 而不是 render/。
 * 放在 render/ 会让 ui/、audio/ 反向依赖"渲染层"，破坏四层架构的单向依赖。
 */
export class ObjectPool<T> {
  private readonly free: T[] = [];

  constructor(
    private readonly factory: () => T,
    private readonly reset: (obj: T) => void,
    initial = 0,
  ) {
    for (let i = 0; i < initial; i++) this.free.push(factory());
  }

  /** 取出一个对象（池空则新建）。 */
  acquire(): T {
    return this.free.pop() ?? this.factory();
  }

  /** 归还对象，重置后放回池中。 */
  release(obj: T): void {
    this.reset(obj);
    this.free.push(obj);
  }

  /**
   * 取出池中当前全部空闲对象并清空池（不调用 reset）。
   *
   * 用途：宿主需要整体换掉池内容时（例如换食材要重建不同外观的网格），
   * 用它把旧对象捞出来统一 dispose，避免 GPU 资源泄漏。
   * 注意：已被 acquire() 拿走、尚未 release() 的对象不在这里，调用方需自行处理。
   */
  drain(): T[] {
    return this.free.splice(0, this.free.length);
  }

  get available(): number {
    return this.free.length;
  }
}
