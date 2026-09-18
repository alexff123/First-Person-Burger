import { ObjectPool } from '../render/ObjectPool';
import type { EventBus } from '../core/EventBus';
import { Events } from '../game/events';
import type { GameEvents } from '../game/events';

/**
 * 打击感反馈（Juice）：屏幕震动 / 金币飞入 / 连击弹字 / 焦糊晕影。
 * 全部订阅事件触发；金币 DOM 元素走对象池复用。
 */
export class Juice {
  private readonly coinPool: ObjectPool<HTMLElement>;
  private readonly fxLayer = document.getElementById('fx-layer') as HTMLElement;
  private readonly vignette = document.getElementById('vignette') as HTMLElement;
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

    bus.on(Events.CoinEarned, ({ amount }) => {
      const n = Math.min(12, Math.max(3, Math.round(amount / 5)));
      for (let i = 0; i < n; i++) this.flyCoin(i * 45);
    });
    bus.on(Events.DishServed, ({ perfect, combo }) => {
      this.shake(perfect ? Math.min(18, 6 + combo * 2) : 5);
    });
    bus.on(Events.ComboChanged, ({ combo }) => {
      if (combo >= 2) this.showCombo(combo);
    });
    bus.on(Events.DishBurnt, () => {
      this.shake(12);
      this.flashVignette();
    });
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

  private flashVignette(): void {
    this.vignette.animate([{ opacity: 0 }, { opacity: 1 }, { opacity: 0 }], {
      duration: 800,
      easing: 'ease-out',
    });
  }

  private showCombo(n: number): void {
    this.comboPop.textContent = `连击 x${n} 🔥`;
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
