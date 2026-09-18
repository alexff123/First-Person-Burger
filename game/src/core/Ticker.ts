/**
 * 统一帧循环（Ticker）
 * rAF 驱动的单一循环，多个系统（物理渲染 / 烹饪逻辑）共享同一 tick，避免各自开循环。
 * dt 已做上限 clamp，配合固定步长物理可防「卡顿后螺旋死亡」。
 */
export type TickFn = (dt: number, elapsed: number) => void;

export class Ticker {
  private readonly fns: TickFn[] = [];
  private raf = 0;
  private last = 0;
  private elapsed = 0;
  private running = false;

  /** 注册每帧回调，返回取消函数。 */
  add(fn: TickFn): () => void {
    this.fns.push(fn);
    return () => {
      const i = this.fns.indexOf(fn);
      if (i >= 0) this.fns.splice(i, 1);
    };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  stop(): void {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
  }

  private loop = (time: number): void => {
    if (!this.running) return;
    const dt = Math.min((time - this.last) / 1000, 0.1);
    this.last = time;
    this.elapsed += dt;
    for (const fn of this.fns) fn(dt, this.elapsed);
    this.raf = requestAnimationFrame(this.loop);
  };
}
