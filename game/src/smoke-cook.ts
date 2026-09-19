/**
 * 无头冒烟测试（**关键测试代码，已纳入版本管理**）
 * 直接驱动真实链路：
 *   EventBus + BusinessDayMachine + CookingSystem + DayController + EconomySystem + MarketSystem
 * 覆盖：四档位判定、连击倍率、采购成本、罚金、价格浮动、库存扣减、破产保护、事件总线无死循环。
 *
 * 为什么必须进 git：它是本项目**唯一的自动化回归防线**。
 * WebGL / WebAudio 无法无头验证，但逻辑层可以 —— 每次改玩法数值或事件契约，先跑它。
 *
 * 运行方式（Windows / PowerShell，需使用 managed node）：
 *   $node = "C:\Users\13916\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"
 *   & $node node_modules\typescript\bin\tsc --target ES2022 --module commonjs `
 *       --moduleResolution node --outDir _smoke --rootDir src --skipLibCheck src/smoke-cook.ts
 *   # 在 _smoke/ 放 package.json 内容 {"type":"commonjs"}（否则被外层 type:module 当成 ESM）
 *   & $node _smoke\smoke-cook.js
 */
import { EventBus } from './core/EventBus';
import { Events } from './game/events';
import type { GameEvents } from './game/events';
import { BusinessDayMachine } from './game/BusinessDayMachine';
import { DayController } from './game/DayController';
import { CookingSystem } from './game/CookingSystem';
import { MarketSystem } from './game/MarketSystem';
import {
  BANKRUPTCY_RESCUE,
  MAX_BUY_BATCH,
  PRICE_SWING,
  resolveCookParams,
  START_COINS,
} from './game/config';
import type { Grade } from './game/config';

let failed = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  → 实测 ${JSON.stringify(actual)} 期望 ${JSON.stringify(expected)}`);
}
function section(title: string): void {
  console.log(`\n=== ${title} ===`);
}

/* ============================================================
 * 场景 A：主链路（确定性价格，rng 恒为 0.5 → 浮动 0 → 单价 = 基准成本）
 * 用固定随机源是为了让金额断言可复现 —— 否则每次跑数都不一样，回归测试就没意义了。
 * ============================================================ */
const RNG_FLAT = (): number => 0.5; // delta = 0 → price = cost
const bus = new EventBus<GameEvents>({ debug: false });
const cooking = new CookingSystem(bus);
const market = new MarketSystem(RNG_FLAT);
const day = new DayController(bus, new BusinessDayMachine(bus), market);

// ---- 事件记录 ----
const cooked: { grade: Grade; quality: number; heat: number; byPlayer: boolean }[] = [];
bus.on(Events.DishCooked, (p) =>
  cooked.push({ grade: p.grade, quality: p.quality, heat: p.heat, byPlayer: p.byPlayer }),
);
const coins: GameEvents['coin:earned'][] = [];
bus.on(Events.CoinEarned, (p) => coins.push({ ...p }));
const combos: { combo: number; multiplier: number; broke: boolean }[] = [];
bus.on(Events.ComboChanged, (p) => combos.push({ ...p }));
const phases: string[] = [];
bus.on(Events.PhaseChanged, ({ to }) => phases.push(to));

/** 出餐结算记录（采购扣款与升级扣款也走 coin:earned，靠 revenue/penalty 是否为 0 区分） */
const dishNets = (): number[] =>
  coins.filter((c) => c.revenue > 0 || c.penalty > 0).map((c) => c.net);

/** 推进到指定火候（步长 1/60，与真实 Ticker 一致）；途中出餐则立即返回 */
function runTo(target: number): void {
  for (let i = 0; i < 6000; i++) {
    cooking.update(1 / 60);
    if (!cooking.isCooking) return; // 已出餐（典型场景：烧穿自动焦糊，火候被复位为 0）
    if (cooking.heatValue >= target) return;
  }
  throw new Error(`runTo(${target}) 未达成，当前 ${cooking.heatValue}`);
}
/** 完美出锅一锅（按当前选中食材） */
function perfectOne(): void {
  bus.emit(Events.PotatoInPot, {});
  runTo(70);
  bus.emit(Events.PotClicked, {});
}

section('1. 参数解算（食材 × 灶台）');
const p1 = resolveCookParams('potato', 1);
check('土豆·家用灶 升温速率', p1.heatRate, 20);
check('土豆·家用灶 甜区', [p1.sweetMin, p1.sweetMax], [60, 80]);
check('土豆·家用灶 售价/基准成本', [p1.price, p1.cost], [30, 8]);
const p4 = resolveCookParams('potato', 4);
check('土豆·分子灶 升温速率', p4.heatRate, 35);
check('土豆·分子灶 甜区(变窄)', [p4.sweetMin, p4.sweetMax], [63.2, 76.8]);
check('土豆·分子灶 售价(加成)', p4.price, 54);
const pw = resolveCookParams('wagyu', 1);
check('和牛·家用灶 甜区(更窄)', [pw.sweetMin, pw.sweetMax], [66, 78]);
check('和牛·家用灶 窗口时长(秒)', Number(((pw.sweetMax - pw.sweetMin) / pw.heatRate).toFixed(3)), 0.4);
// 外观表契约（第五阶段新增：表现层靠它区分豆腐/和牛，这里只验证数据完备）
check('外观表：土豆是椭球', p1.look.scale, [1.2, 0.85, 1.0]);
check('外观表：豆腐是方墩', resolveCookParams('tofu', 1).look.scale, [1.15, 1.15, 1.0]);
check('外观表：和牛是扁片', pw.look.scale, [1.35, 0.45, 1.1]);

section('2. 采购阶段：状态机不越权');
check('开局资金', day.economy.balance, START_COINS);
check('开局处于采购阶段', day.current, 'procurement');
check('今日土豆单价(=基准 8)', market.priceOf('potato'), 8);
check('零库存时合计为 0', market.totalStock, 0);

// 采购阶段点食材不应开火（CookingSystem 有阶段闸门）
bus.emit(Events.PotatoInPot, {});
check('采购阶段点食材不开火', cooking.isCooking, false);
check('采购阶段点食材不推进阶段', day.current, 'procurement');

// 零库存时"开火营业"应被拒
bus.emit(Events.ProcurementDone, {});
check('零库存不能进入烹饪', day.current, 'procurement');

section('3. 采购：资金校验 / 批量上限 / 库存累积');
day.economy.earn(500); // 测试注资，便于验证批量与多锅
const coinsBeforeBuy = day.economy.balance;
const buyLog: GameEvents['market:bought'][] = [];
bus.on(Events.MarketBought, (p) => buyLog.push({ ...p }));

bus.emit(Events.MarketBuy, { id: 'potato', qty: 999 }); // 触发批量封顶
check('单次买入被封顶到 MAX_BUY_BATCH', buyLog[buyLog.length - 1].qty, MAX_BUY_BATCH);
check('买入扣款 = 单价 × 份数', coinsBeforeBuy - day.economy.balance, 20 * 8);
check('土豆库存 20', market.stockOf('potato'), 20);

bus.emit(Events.MarketBuy, { id: 'wagyu', qty: 5 });
bus.emit(Events.MarketBuy, { id: 'tofu', qty: 5 });
check('和牛库存 5', market.stockOf('wagyu'), 5);
check('豆腐库存 5', market.stockOf('tofu'), 5);
check('全部库存合计 30', market.totalStock, 30);
const coinsAfterBuy = day.economy.balance;
check('采购后余额', coinsAfterBuy, 60 + 500 - 160 - 170 - 30);

// 有库存就不该触发救济（哪怕钱花光）
check('有库存时不触发破产保护', market.rescueNeeded(0), false);

section('4. 采购 → 烹饪 过渡');
bus.emit(Events.ProcurementDone, {});
check('进入烹饪阶段', day.current, 'cooking');

section('5. 完美出锅 → 连击倍率递增（成本以买入价计）');
perfectOne();
check('第1锅 档位', cooked[0].grade, 'perfect');
check('第1锅 质量分', cooked[0].quality, 100);
check('第1锅 净利 (30×1 - 8)', dishNets()[0], 22);
check('第1锅 连击/倍率', [combos[0].combo, combos[0].multiplier], [1, 1]);
check('入锅扣掉 1 份库存', market.stockOf('potato'), 19);

perfectOne();
check('第2锅 净利 (30×2 - 8)', dishNets()[1], 52);
check('第2锅 连击/倍率', [combos[1].combo, combos[1].multiplier], [2, 2]);
check('两锅后仍在烹饪阶段（还有料）', day.current, 'cooking');

section('6. 连击封顶（倍率 ≤ 10）');
for (let i = 0; i < 10; i++) perfectOne();
const lastCombo = combos[combos.length - 1];
check('连击数(12)', lastCombo.combo, 12);
check('倍率封顶为 10', lastCombo.multiplier, 10);
check('第12锅 净利 (30×10 - 8)', dishNets()[11], 292);

section('7. 烧穿 → 焦糊：连击中断 + 倒赔');
const cBeforeBurn = day.economy.balance;
bus.emit(Events.PotatoInPot, {});
runTo(100); // 不点锅，一路烧到 100
check('档位 burnt', cooked[cooked.length - 1].grade, 'burnt');
check('焦糊为自动(byPlayer=false)', cooked[cooked.length - 1].byPlayer, false);
check('焦糊 连击归零+断档', combos[combos.length - 1], { combo: 0, multiplier: 0, broke: true });
check('焦糊 净利 (0 - 24 - 8)', dishNets()[dishNets().length - 1], -32);
check('焦糊后资金', day.economy.balance, cBeforeBurn - 32);

section('8. 生食 / 过火');
bus.emit(Events.PotatoInPot, {});
runTo(30); // 甜区下界 60 之前
bus.emit(Events.PotClicked, {});
check('档位 raw', cooked[cooked.length - 1].grade, 'raw');
check('生食 净利 (6 - 8)', dishNets()[dishNets().length - 1], -2);

bus.emit(Events.PotatoInPot, {});
runTo(90); // 甜区上界 80 之后、100 之前
bus.emit(Events.PotClicked, {});
check('档位 over', cooked[cooked.length - 1].grade, 'over');
check('过火 净利 (0 - 15 - 8)', dishNets()[dishNets().length - 1], -23);

section('9. 切食材：甜区与售价实时变化（成本用和牛买入价 34）');
bus.emit(Events.IngredientChanged, { id: 'wagyu' });
bus.emit(Events.PotatoInPot, {});
check('和牛 甜区(66~78)', [cooking.sweetRange.min, cooking.sweetRange.max], [66, 78]);
runTo(70);
bus.emit(Events.PotClicked, {});
check('和牛 完美净利 (90×1 - 34)', dishNets()[dishNets().length - 1], 56);
check('和牛库存扣 1', market.stockOf('wagyu'), 4);

section('10. 灶台升级：烹饪中禁止换灶（防账目错配）');
const cBeforeUp = day.economy.balance;
check('升级前处于烹饪阶段', day.current, 'cooking');
bus.emit(Events.StoveUpgrade, {});
check('烹饪阶段升级被拒（等级与余额都不变）', [day.economy.stove.level, day.economy.balance], [1, cBeforeUp]);

// 收尾到次日采购 —— 只有离开烹饪阶段才允许换灶
day.endDay();
check('收尾后回到采购阶段', day.current, 'procurement');
bus.emit(Events.StoveUpgrade, {});
check('采购阶段升级成功 → Lv2', [day.economy.stove.level, cBeforeUp - day.economy.balance], [2, 120]);

bus.emit(Events.IngredientChanged, { id: 'potato' });
bus.emit(Events.ProcurementDone, {});
bus.emit(Events.PotatoInPot, {});
check('商用灶 甜区(61.5~78.5)', [cooking.sweetRange.min, cooking.sweetRange.max], [61.5, 78.5]);

section('11. 事件契约合规（审查项）');
check('dish:cooked 携带档位', typeof cooked[0].grade, 'string');
check('dish:cooked 携带质量', typeof cooked[0].quality, 'number');
check('dish:cooked 携带火候', typeof cooked[0].heat, 'number');
check('每次出餐都广播 combo:changed', combos.length, cooked.length);
check('每次出餐都有且仅有一次结算浮字', dishNets().length, cooked.length);

section('12. 事件总线无死循环：一次收尾只走固定步数');
// openMarket 由 phase:changed(→procurement) 触发，它自己又发 market:open；
// 若构成环就会无限递归。用"阶段推进次数"钉死它。
const dayBefore = day.dayNo;
phases.length = 0;
day.endDay(); // cooking → pricing → upgrade → closing → procurement
check('收尾推进的阶段序列', phases, ['pricing', 'upgrade', 'closing', 'procurement']);
check('阶段推进次数固定为 4（无额外回环）', phases.length, 4);
check('次日天数 +1', day.dayNo, dayBefore + 1);
check('回到采购阶段', day.current, 'procurement');
check('次日价格已重掷（确定性 rng 下仍为 8）', market.priceOf('potato'), 8);

/* ============================================================
 * 场景 B：价格浮动的边界（用 rng 极值钉死上下限）
 * ============================================================ */
section('13. 价格浮动 ±20%');
const hi = new MarketSystem(() => 1); // delta = +0.2
const lo = new MarketSystem(() => 0); // delta = -0.2
check('上限：土豆 8 → 10', hi.priceOf('potato'), 10);
check('下限：土豆 8 → 6', lo.priceOf('potato'), 6);
check('上限：和牛 34 → 41', hi.priceOf('wagyu'), 41);
check('下限：和牛 34 → 27', lo.priceOf('wagyu'), 27);
const hiOk = hi.list().every((q) => q.price === Math.max(1, Math.round(q.ingredient.cost * (1 + PRICE_SWING))));
const loOk = lo.list().every((q) => q.price === Math.max(1, Math.round(q.ingredient.cost * (1 - PRICE_SWING))));
check('全部食材封顶在 +20% 的取整值', hiOk, true);
check('全部食材封底在 -20% 的取整值', loOk, true);

/* ============================================================
 * 场景 C：买贵了赚得少 —— 采购决策直接影响利润
 * 同一道菜、同一档位，只因进价不同，净利就差一截。这是风险收益的核心。
 * ============================================================ */
section('14. 采购成本决定利润（同一锅菜，进价不同）');
function netForOnePotato(rng: () => number): number {
  const b = new EventBus<GameEvents>({ debug: false });
  const c = new CookingSystem(b);
  const m = new MarketSystem(rng);
  const d = new DayController(b, new BusinessDayMachine(b), m);
  const nets: number[] = [];
  b.on(Events.CoinEarned, (p) => {
    if (p.revenue > 0 || p.penalty > 0) nets.push(p.net);
  });
  d.economy.earn(100);
  b.emit(Events.MarketBuy, { id: 'potato', qty: 1 });
  b.emit(Events.ProcurementDone, {});
  b.emit(Events.PotatoInPot, {});
  for (let i = 0; i < 6000; i++) {
    c.update(1 / 60);
    if (!c.isCooking) break;
    if (c.heatValue >= 70) break;
  }
  b.emit(Events.PotClicked, {});
  return nets[0];
}
check('便宜时（进价 6）净利 24', netForOnePotato(() => 0), 24);
check('基准时（进价 8）净利 22', netForOnePotato(() => 0.5), 22);
check('贵时（进价 10）净利 20', netForOnePotato(() => 1), 20);

/* ============================================================
 * 场景 D：破产保护
 * ============================================================ */
section('15. 破产保护（钱不够买料 且 零库存）');
const bus2 = new EventBus<GameEvents>({ debug: false });
const market2 = new MarketSystem(RNG_FLAT); // 土豆 8
const day2 = new DayController(bus2, new BusinessDayMachine(bus2), market2);
let rescued = 0;
let rescuedName = '';
let rescuedGranted = 0;
bus2.on(Events.BankruptcyAverted, ({ ingredientName, granted }) => {
  rescued++;
  rescuedName = ingredientName;
  rescuedGranted = granted;
});

check('开局有购买力 → 不触发', market2.rescueNeeded(day2.economy.balance), false);
day2.economy.spend(day2.economy.balance - 5); // 只剩 5 币，买不起 8 块的土豆
check('钱不够买土豆(8) 且零库存 → 需要救济', market2.rescueNeeded(day2.economy.balance), true);
const didRescue = day2.checkBankruptcy();
check('触发破产保护', didRescue, true);
check('救济事件只发一次', rescued, 1);
check('救济份数随事件载荷下发', rescuedGranted, BANKRUPTCY_RESCUE);
check('救济发的是最便宜的料', rescuedName, '豆腐'); // 豆腐 6 < 土豆 8 < 和牛 34
check(`发放 ${BANKRUPTCY_RESCUE} 份救济`, market2.stockOf('tofu'), BANKRUPTCY_RESCUE);
check('救济只发一次（再次检查不再发）', day2.checkBankruptcy(), false);
check('有料之后不再判定为需要救济', market2.rescueNeeded(day2.economy.balance), false);

/* ============================================================ */
console.log('');
if (failed > 0) throw new Error(`冒烟测试失败：${failed} 项断言不符合预期`);
console.log(`全部通过（共 ${cooked.length} 锅 / ${coins.length} 笔资金流水）`);
