import { ObjectPool } from '../core/ObjectPool';
import type { EventBus } from '../core/EventBus';
import { Events } from '../game/events';
import type { GameEvents } from '../game/events';

/**
 * 打击感反馈（Juice）：屏幕震动 / 金币飞入 / 连击弹字 / 焦糊黑晕 / 断连泛红。
 *
 * 设计要点（避免踩坑）：
 *   震动**只由 combo:changed 一个事件驱动**。该事件每次出餐都会广播（含 combo=0 的情况），
 *   且同时携带 combo / multiplier / broke，信息完备。
 *   若改成从 dish:cooked 取 combo，就得依赖两个事件的到达顺序 —— 那是隐式耦合，审查不认。
 *
 * 档位 → 反馈映射（正反馈给"爽"，负反馈给"痛"）：
 *   完美(combo≥1)          → 强震（随连击递增、封顶）+ 连击弹字
 *   断连(broke)            → 泛红 + 中震（这是"痛感"的主来源）
 *   无连击的普通失败        → 轻震（提示"你搞砸了"，但不至于刺眼）
 *   焦糊                   → 黑晕（3D 冒烟由物理层负责）
 */
export class Juice {
  private readonly coinPool: ObjectPool<HTMLElement>;
  private readonly fxLayer = document.getElementById('fx-layer') as HTMLElement;
  private readonly vignette = document.getElementById('vignette') as HTMLElement;
  private readonly redflash = document.getElementById('redflash') as HTMLElement;
  private readonly comboPop = document.getElementById('combo-pop') as HTMLElement;

  constructor(
    bus: EventBus<GameEvents>,
    private readonly shakeTarget: HTMLElement,
  ) {
    this.coinPool = new ObjectPool<HTMLElement>(
      () => {
        const el = document.createElement('div');
        el.className = 'coin';
        this.fxLayer.appendChild(el);
        return el;
      },
      (el) => {
        el.style.display = 'none';
      },
      24,
    );

    // 金币：只有净利为正才飞钱，亏钱不飞（省得误导）
    bus.on(Events.CoinEarned, ({ net }) => {
      if (net <= 0) return;
      const n = Math.min(12, Math.max(3, Math.round(net / 5)));
      for (let i = 0; i < n; i++) this.flyCoin(i * 45);
    });

    // 出餐：只处理档位专属的视觉（震动统一归 combo:changed，见类注释）
    bus.on(Events.DishCooked, ({ grade }) => {
      if (grade === 'burnt') this.flashVignette();
    });

    // 连击：一次出餐的全部"手感"都在这里
    bus.on(Events.ComboChanged, ({ combo, multiplier, broke }) => {
      if (broke) {
        // 断档：最痛的一档
        this.flashRed();
        this.shake(10);
        return;
      }
      if (combo >= 1) {
        // 完美出锅：越连越猛，封顶防晕动症
        this.shake(Math.min(18, 6 + combo * 2));
        if (combo >= 2) this.showCombo(combo, multiplier);
        return;
      }
      // 连击为 0 且没断档 = 本来就是裸锅失败，给轻震
      this.shake(6);
    });

    // 顾客愤怒：额外一次强红闪，明确"这不是小失误"
    bus.on(Events.CustomerAngry, () => this.flashRed(1.0));
  }

  private coinTarget(): { x: number; y: number } {
    const el = document.getElementById('coins');
    const r = el?.getBoundingClientRect();
    return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: window.innerWidth - 60, y: 30 };
  }

  private flyCoin(stagger: number): void {
    const coin = this.coinPool.acquire();
    coin.style.display = 'block';
    const from = { x: window.innerWidth / 2 + (Math.random() - 0.5) * 140, y: window.innerHeight * 0.5 };
    const to = this.coinTarget();
    const anim = coin.animate(
      [
        { transform: `translate(${from.x}px, ${from.y}px) scale(0.6)`, opacity: 1 },
        { transform: `translate(${to.x}px, ${to.y}px) scale(1.1)`, opacity: 1 },
      ],
      {
        duration: 520 + Math.random() * 220,
        delay: stagger,
        easing: 'cubic-bezier(.3,.7,.3,1)',
        fill: 'forwards',
      },
    );
    anim.onfinish = () => {
      coin.style.display = 'none';
      this.coinPool.release(coin);
    };
  }

  private shake(intensity: number): void {
    const i = intensity;
    this.shakeTarget.animate(
      [
        { transform: 'translate(0,0)' },
        { transform: `translate(${i}px, ${-i}px)` },
        { transform: `translate(${-i}px, ${i * 0.6}px)` },
        { transform: `translate(${i * 0.7}px, ${i * 0.3}px)` },
        { transform: 'translate(0,0)' },
      ],
      { duration: 260, easing: 'ease-out' },
    );
  }

  /** 焦糊黑晕（事故） */
  private flashVignette(): void {
    this.vignette.animate([{ opacity: 0 }, { opacity: 1 }, { opacity: 0 }], {
      duration: 800,
      easing: 'ease-out',
    });
  }

  /** 断连/顾客愤怒泛红（失误） */
  private flashRed(peak = 0.85): void {
    this.redflash.animate([{ opacity: 0 }, { opacity: peak }, { opacity: 0 }], {
      duration: 620,
      easing: 'ease-out',
    });
  }

  private showCombo(n: number, multiplier: number): void {
    this.comboPop.textContent = `连击 x${n}　收益 ×${multiplier}`;
    this.comboPop.animate(
      [
        { transform: 'translate(-50%,-50%) scale(0.4)', opacity: 0 },
        { transform: 'translate(-50%,-50%) scale(1.15)', opacity: 1, offset: 0.3 },
        { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: 0.7 },
        { transform: 'translate(-50%,-50%) scale(1.4)', opacity: 0 },
      ],
      { duration: 900, easing: 'ease-out' },
    );
  }
}
