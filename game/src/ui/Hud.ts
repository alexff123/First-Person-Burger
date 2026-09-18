import type { EventBus } from '../core/EventBus';
import { Events } from '../game/events';
import type { GameEvents } from '../game/events';
import {
  getIngredient,
  getStove,
  GRADE_LABEL,
  MULTIPLIER_CAP,
  START_COINS,
  STOVES,
} from '../game/config';
import type { Grade } from '../game/config';

const PHASE_LABEL: Record<string, string> = {
  idle: '待机',
  procurement: '采购',
  cooking: '烹饪',
  pricing: '定价',
  upgrade: '升级/事件',
  closing: '打烊',
};

/**
 * HUD（火候条 / 甜区 / 档位提示 / 订单栏 / 经济面板）
 *
 * 纯订阅事件更新 DOM，不主动读取任何系统状态，天然解耦。
 * 唯一"自行推导"的是展示用价格/成本：它们由 config.ts 里的
 * 「食材 × 灶台」唯一确定，与 EconomySystem 读的是同一张表，故不会漂移。
 */
export class Hud {
  private readonly heatBar = document.getElementById('heatbar') as HTMLElement;
  private readonly heatFill = document.getElementById('heat-fill') as HTMLElement;
  private readonly heatNum = document.getElementById('heat-num') as HTMLElement;
  private readonly sweetZone = document.getElementById('sweet-zone') as HTMLElement;
  private readonly gradeTag = document.getElementById('grade-tag') as HTMLElement;
  private readonly orderDish = document.getElementById('order-dish') as HTMLElement;
  private readonly orderStatus = document.getElementById('order-status') as HTMLElement;
  private readonly comboEl = document.getElementById('combo') as HTMLElement;
  private readonly coinsEl = document.getElementById('coins') as HTMLElement;
  private readonly dayEl = document.getElementById('hud-day') as HTMLElement;
  private readonly phaseEl = document.getElementById('hud-phase') as HTMLElement;
  private readonly econStove = document.getElementById('econ-stove') as HTMLElement;
  private readonly econIng = document.getElementById('econ-ing') as HTMLElement;
  private readonly econPrice = document.getElementById('econ-price') as HTMLElement;
  private readonly econCost = document.getElementById('econ-cost') as HTMLElement;
  private readonly netPop = document.getElementById('net-pop') as HTMLElement;
  private readonly btnStove = document.getElementById('btn-stove') as HTMLButtonElement;
  private readonly ingButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>('#ing-switch .ing'),
  );

  // 本地展示态（全部由事件驱动更新）
  private coins = START_COINS;
  private stoveLevel = 1;
  private ingredientId = 'potato';
  private phase = 'procurement';

  constructor(bus: EventBus<GameEvents>) {
    this.coinsEl.textContent = String(START_COINS);

    // ---- 烹饪：火候条 / 甜区 / 档位 ----
    bus.on(Events.CookingStart, ({ dish }) => {
      this.heatBar.classList.add('active'); // 火候条"亮起来"
      this.orderDish.textContent = `${dish} ×1`;
      this.setOrder('烹饪中', 'cooking');
    });
    bus.on(Events.CookingProgress, ({ heat, sweetMin, sweetMax, grade }) => {
      this.heatFill.style.width = `${heat}%`;
      this.heatNum.textContent = String(Math.round(heat));
      // 甜区随食材与灶台实时收放 —— 这是"难度可视化"的核心
      this.sweetZone.style.left = `${sweetMin}%`;
      this.sweetZone.style.width = `${sweetMax - sweetMin}%`;
      this.heatFill.classList.toggle('sweet', grade === 'perfect');
      this.renderGradeTag(grade);
    });
    bus.on(Events.DishPrepared, ({ slices }) => this.setOrder(`已切片 ×${slices}`, 'prepared'));

    // ---- 出餐结果 ----
    bus.on(Events.DishCooked, ({ grade, quality, byPlayer }) => {
      this.heatBar.classList.remove('active');
      this.heatFill.style.width = '0%';
      this.heatNum.textContent = '0';
      this.gradeTag.textContent = '';
      this.gradeTag.className = 'grade-tag';
      const tag = `${GRADE_LABEL[grade]}｜质量 ${quality}`;
      this.setOrder(tag, grade);
      window.setTimeout(() => this.setOrder('待出锅', ''), grade === 'perfect' ? 900 : 1200);
      if (!byPlayer) this.orderDish.textContent = '糊锅了…';
    });

    // ---- 连击 ----
    bus.on(Events.ComboChanged, ({ combo, multiplier, broke }) => {
      if (broke) {
        this.comboEl.textContent = '连击断档 ✖';
        this.comboEl.classList.add('broke');
        window.setTimeout(() => this.comboEl.classList.remove('broke'), 900);
      } else if (combo > 0) {
        const cap = multiplier >= MULTIPLIER_CAP ? '（封顶）' : '';
        this.comboEl.textContent = `连击 x${combo} · 收益 ×${multiplier}${cap}`;
      } else {
        this.comboEl.textContent = '';
      }
    });

    // ---- 金币与账目 ----
    bus.on(Events.CoinEarned, ({ net, total, revenue, penalty, cost }) => {
      this.coins = total;
      this.coinsEl.textContent = String(total);
      this.showNet(net, revenue, penalty, cost);
      this.refreshActions();
    });

    // ---- 营业日 ----
    bus.on(Events.PhaseChanged, ({ to, day }) => {
      this.phase = to;
      this.phaseEl.textContent = PHASE_LABEL[to] ?? to;
      this.dayEl.textContent = `第 ${day} 天`;
      this.refreshActions();
    });

    // ---- 灶台 / 食材 ----
    bus.on(Events.StoveChanged, ({ level }) => {
      this.stoveLevel = level;
      this.refreshEcon();
    });
    bus.on(Events.IngredientChanged, ({ id }) => {
      this.ingredientId = id;
      this.refreshEcon();
    });

    // ---- 经营操作（HUD 只负责"发请求"，不做任何校验）----
    this.btnStove.addEventListener('click', () => bus.emit(Events.StoveUpgrade, {}));
    for (const btn of this.ingButtons) {
      btn.addEventListener('click', () => {
        const id = btn.dataset.ing;
        if (id) bus.emit(Events.IngredientChanged, { id });
      });
    }

    this.refreshEcon();
    this.refreshActions();
  }

  /** 火候条上的实时档位提示：让玩家不用猜"现在是哪一档" */
  private renderGradeTag(grade: Grade): void {
    if (grade === 'perfect') {
      this.gradeTag.textContent = '完美区！出锅';
    } else if (grade === 'over') {
      this.gradeTag.textContent = '过火了，快出锅止损';
    } else if (grade === 'burnt') {
      this.gradeTag.textContent = '焦糊';
    } else {
      this.gradeTag.textContent = '还没熟';
    }
    this.gradeTag.className = `grade-tag ${grade}`;
  }

  /** 结算浮字：一眼看清赚了还是亏了、亏在哪 */
  private showNet(net: number, revenue: number, penalty: number, cost: number): void {
    const sign = net >= 0 ? '+' : '';
    this.netPop.textContent =
      penalty > 0
        ? `${sign}${net}（赔付 -${penalty} 成本 -${cost}）`
        : `${sign}${net}（收入 ${revenue} 成本 -${cost}）`;
    this.netPop.classList.remove('gain', 'loss', 'pop');
    this.netPop.classList.add(net >= 0 ? 'gain' : 'loss');
    // 强制重排以重启动画
    void this.netPop.offsetWidth;
    this.netPop.classList.add('pop');
  }

  private refreshEcon(): void {
    const ing = getIngredient(this.ingredientId);
    const stove = getStove(this.stoveLevel);
    this.econStove.textContent = `${stove.name} Lv${stove.level}`;
    this.econIng.textContent = ing.name;
    this.econPrice.textContent = String(Math.round(ing.price * stove.priceMul));
    this.econCost.textContent = String(ing.cost);
    for (const btn of this.ingButtons) {
      btn.classList.toggle('on', btn.dataset.ing === this.ingredientId);
    }
  }

  /** 按钮可用性完全由本地展示态推导，不向任何系统发问 */
  private refreshActions(): void {
    const next = STOVES.find((s) => s.level === this.stoveLevel + 1);
    if (!next) {
      this.btnStove.textContent = '灶台已满级';
      this.btnStove.disabled = true;
    } else {
      this.btnStove.textContent = `升级灶台 →${next.name} (${next.upgradeCost})`;
      // 灶上有火不允许换灶（DayController 同规则），钱不够也不给按
      this.btnStove.disabled = this.phase === 'cooking' || this.coins < next.upgradeCost;
    }
    const cooking = this.phase === 'cooking';
    for (const btn of this.ingButtons) btn.disabled = cooking;
  }

  private setOrder(text: string, cls: string): void {
    this.orderStatus.textContent = text;
    this.orderStatus.className = `order-status ${cls}`.trim();
  }
}
