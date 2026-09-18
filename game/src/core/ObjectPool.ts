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

  get available(): number {
    return this.free.length;
  }
}
