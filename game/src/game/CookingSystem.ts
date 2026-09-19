import type { EventBus } from '../core/EventBus';
import { Events } from './events';
import type { GameEvents } from './events';
import { BURN_AT, gradeOf, qualityOf, resolveCookParams } from './config';
import type { CookParams, Grade } from './config';

/**
 * 烹饪系统（玩法逻辑，纯数据，绝不接触 3D 网格）
 *
 * 职责（严格限定）：
 *   1. 按「食材 × 灶台」解算的速率推进火候；
 *   2. 判定四档位（生食 / 完美 / 过火 / 焦糊）与质量分；
 *   3. 广播 cooking:* 与 dish:cooked。
 *
 * 明确不做：
 *   - 不算金币、不管连击倍率、不碰成本 → 全部交给 DayController + EconomySystem 结算；
 *   - 不直接调用任何其他模块，只通过事件总线收发。
 *
 * 档位阈值 / 速率全部来自 config.ts，本文件无魔法数字。
 */
export class CookingSystem {
  /** 当前一锅的实参快照（入锅时解算；烹饪中不随灶台/食材切换而变，避免中途变卦） */
  private params: CookParams = resolveCookParams('potato', 1);
  private ingredientId = 'potato';
  private stoveLevel = 1;

  private heat = 0;
  private cooking = false;
  /** 上次广播时的火候整数值，用于抑制重复事件（单锅最多 100 次） */
  private lastHeatInt = -1;
  private lastGrade: Grade = 'raw';
  /**
   * 阶段闸门：只有营业日进入"烹饪"阶段才允许开火。
   * 为什么要它：采购阶段玩家可能在 3D 场景里随手点到食材，若无闸门就会
   * 直接跳进烹饪、把进货界面顶掉 —— 属于"误触毁掉一轮决策"。
   * 这里只订阅事件，不反向调用状态机，符合单向依赖。
   */
  private inCookingPhase = false;

  constructor(private readonly bus: EventBus<GameEvents>) {
    bus.on(Events.PotatoInPot, () => this.start());
    bus.on(Events.PotClicked, () => this.serve());
    bus.on(Events.PhaseChanged, ({ to }) => {
      this.inCookingPhase = to === 'cooking';
    });
    // 食材 / 灶台切换只记录，下次入锅才生效（烹饪中换灶不符合直觉，直接排队到下一锅）
    bus.on(Events.StoveChanged, ({ level }) => {
      this.stoveLevel = level;
    });
    bus.on(Events.IngredientChanged, ({ id }) => {
      this.ingredientId = id;
    });
  }

  get isCooking(): boolean {
    return this.cooking;
  }

  get heatValue(): number {
    return this.heat;
  }

  /** 当前甜区（供调试/测试读取，UI 一律走事件） */
  get sweetRange(): { min: number; max: number } {
    return { min: this.params.sweetMin, max: this.params.sweetMax };
  }

  private start(): void {
    // 阶段闸门：采购/定价/打烊阶段点食材不应开火
    if (!this.inCookingPhase) return;
    // 入锅瞬间快照参数：本锅的速率与甜区就此锁定
    this.params = resolveCookParams(this.ingredientId, this.stoveLevel);
    this.cooking = true;
    this.heat = 0;
    this.lastHeatInt = -1;
    this.lastGrade = 'raw';

    this.bus.emit(Events.CookingStart, {
      dish: this.params.dish,
      ingredientId: this.params.ingredientId,
      heatRate: this.params.heatRate,
      sweetMin: this.params.sweetMin,
      sweetMax: this.params.sweetMax,
    });
    this.bus.emit(Events.CookingProgress, {
      heat: 0,
      sweetMin: this.params.sweetMin,
      sweetMax: this.params.sweetMax,
      grade: 'raw',
    });
  }

  /** 由 Ticker 每帧驱动（只做数值，不碰渲染）。 */
  update(dt: number): void {
    if (!this.cooking) return;

    this.heat = Math.min(BURN_AT, this.heat + this.params.heatRate * dt);

    const grade = gradeOf(this.heat, this.params.sweetMin, this.params.sweetMax);
    const h = Math.floor(this.heat);
    // 整数变化 或 档位跨越时才广播（档位跨越必须报，否则 UI 提示会延迟）
    if (h !== this.lastHeatInt || grade !== this.lastGrade) {
      this.lastHeatInt = h;
      this.lastGrade = grade;
      this.bus.emit(Events.CookingProgress, {
        heat: this.heat,
        sweetMin: this.params.sweetMin,
        sweetMax: this.params.sweetMax,
        grade,
      });
    }

    // 火候烧穿 → 自动焦糊（玩家没点锅，属于事故）
    if (this.heat >= BURN_AT) this.finish(false);
  }

  /** 玩家点锅 = 主动出锅（可能是生食/完美/过火，也可能在临界帧被判成焦糊）。 */
  private serve(): void {
    if (!this.cooking) return;
    this.finish(true);
  }

  /**
   * 唯一出餐出口：判定档位 → 算质量 → 广播 dish:cooked。
   * 注意这里不产生任何金币，金币归 DayController。
   */
  private finish(byPlayer: boolean): void {
    const grade = gradeOf(this.heat, this.params.sweetMin, this.params.sweetMax);
    const quality = qualityOf(grade, this.heat, this.params.sweetMin, this.params.sweetMax);
    const heat = this.heat;

    this.cooking = false;
    this.heat = 0;
    this.lastHeatInt = -1;
    this.lastGrade = 'raw';

    this.bus.emit(Events.DishCooked, {
      dish: this.params.dish,
      ingredientId: this.params.ingredientId,
      grade,
      quality,
      heat,
      byPlayer,
    });
  }
}
