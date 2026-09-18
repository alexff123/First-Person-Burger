/**
 * 无头冒烟测试（**关键测试代码，已纳入版本管理**）
 * 直接驱动真实链路：EventBus + BusinessDayMachine + CookingSystem + DayController + EconomySystem
 * 验证四档位判定、连击倍率、采购成本、罚金、灶台/食材参数联动是否与《数值策划表》一致。
 *
 * 为什么必须进 git：它是本项目**唯一的自动化回归防线**。
 * WebGL / WebAudio 无法无头验证，但逻辑层可以 —— 每次改玩法数值或事件契约，先跑它。
 *
 * 运行方式（Windows / PowerShell，需使用 managed node）：
 *   $node = "C:\Users\13916\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"
 *   & $node node_modules\typescript\bin\tsc --target ES2022 --module commonjs `
 *       --moduleResolution node --outDir _smoke --rootDir src --skipLibCheck src/smoke-cook.ts
 *   # _smoke/package.json 内容 {"type":"commonjs"}（否则被外层 type:module 当成 ESM）
 *   & $node _smoke\smoke-cook.js
 * 断言数：31 项；当前基线：16 锅全 PASS，exit 0。
 */
import { EventBus } from './core/EventBus';
import { Events } from './game/events';
import type { GameEvents } from './game/events';
import { BusinessDayMachine } from './game/BusinessDayMachine';
import { DayController } from './game/DayController';
import { CookingSystem } from './game/CookingSystem';
import { resolveCookParams, START_COINS } from './game/config';
import type { Grade } from './game/config';

let failed = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  → 实测 ${JSON.stringify(actual)} 期望 ${JSON.stringify(expected)}`);
}

const bus = new EventBus<GameEvents>({ debug: false });
const cooking = new CookingSystem(bus);
const day = new DayController(bus, new BusinessDayMachine(bus));

// 记录事件，用于校验契约
const cooked: { grade: Grade; quality: number; heat: number; byPlayer: boolean }[] = [];
bus.on(Events.DishCooked, (p) => cooked.push({ grade: p.grade, quality: p.quality, heat: p.heat, byPlayer: p.byPlayer }));
const coinLog: number[] = [];
bus.on(Events.CoinEarned, (p) => coinLog.push(p.net));
const comboLog: { combo: number; multiplier: number; broke: boolean }[] = [];
bus.on(Events.ComboChanged, (p) => comboLog.push({ combo: p.combo, multiplier: p.multiplier, broke: p.broke }));

/** 推进到指定火候（步长 1/60，与真实 Ticker 一致）；若中途出餐则立即返回 */
function runTo(target: number): void {
  for (let i = 0; i < 6000; i++) {
    cooking.update(1 / 60);
    if (!cooking.isCooking) return; // 已出餐（典型场景：烧穿自动焦糊，火候被复位为 0）
    if (cooking.heatValue >= target) return;
  }
  throw new Error(`runTo(${target}) 未达成，当前 ${cooking.heatValue}`);
}

console.log('=== 1. 参数解算（食材 × 灶台） ===');
const p1 = resolveCookParams('potato', 1);
check('土豆·家用灶 升温速率', p1.heatRate, 20);
check('土豆·家用灶 甜区', [p1.sweetMin, p1.sweetMax], [60, 80]);
check('土豆·家用灶 售价/成本', [p1.price, p1.cost], [30, 8]);
const p4 = resolveCookParams('potato', 4);
check('土豆·分子灶 升温速率', p4.heatRate, 35);
check('土豆·分子灶 甜区(变窄)', [p4.sweetMin, p4.sweetMax], [63.2, 76.8]);
check('土豆·分子灶 售价(加成)', p4.price, 54);
const pw = resolveCookParams('wagyu', 1);
check('和牛·家用灶 甜区(更窄)', [pw.sweetMin, pw.sweetMax], [66, 72 + 6]);
check('和牛·家用灶 窗口时长(秒)', Number(((pw.sweetMax - pw.sweetMin) / pw.heatRate).toFixed(3)), 0.4);

console.log('=== 2. 完美出锅 → 连击倍率递增 ===');
check('初始资金', day.economy.balance, START_COINS);
bus.emit(Events.PotatoInPot, {});
runTo(70); // 落在甜区正中
bus.emit(Events.PotClicked, {});
check('第1锅 档位', cooked[0].grade, 'perfect');
check('第1锅 质量分', cooked[0].quality, 100);
check('第1锅 净利 (30×1 - 8)', coinLog[0], 22);
check('第1锅 连击/倍率', [comboLog[0].combo, comboLog[0].multiplier], [1, 1]);

bus.emit(Events.PotatoInPot, {});
runTo(70);
bus.emit(Events.PotClicked, {});
check('第2锅 净利 (30×2 - 8)', coinLog[1], 52);
check('第2锅 连击/倍率', [comboLog[1].combo, comboLog[1].multiplier], [2, 2]);
check('第2锅后资金', day.economy.balance, START_COINS + 22 + 52);

console.log('=== 3. 连击封顶（倍率 ≤ 10） ===');
// 再连 10 锅完美，验证倍率封顶
for (let i = 0; i < 10; i++) {
  bus.emit(Events.PotatoInPot, {});
  runTo(70);
  bus.emit(Events.PotClicked, {});
}
const lastCombo = comboLog[comboLog.length - 1];
check('连击数(12)', lastCombo.combo, 12);
check('倍率封顶为 10', lastCombo.multiplier, 10);

console.log('=== 4. 烧穿 → 焦糊，连击中断 + 倒赔 ===');
const coinsBeforeBurn = day.economy.balance;
bus.emit(Events.PotatoInPot, {});
runTo(100); // 不点锅，一路烧到 100
check('档位 burnt', cooked[cooked.length - 1].grade, 'burnt');
check('焦糊为自动(byPlayer=false)', cooked[cooked.length - 1].byPlayer, false);
check('焦糊 连击归零+断档', comboLog[comboLog.length - 1], { combo: 0, multiplier: 0, broke: true });
check('焦糊 净利 (0 - 24 - 8)', coinLog[coinLog.length - 1], -32);
check('焦糊后资金', day.economy.balance, coinsBeforeBurn - 32);

console.log('=== 5. 生食 / 过火 ===');
const c0 = day.economy.balance;
bus.emit(Events.PotatoInPot, {});
runTo(30); // 甜区下界 60 之前
bus.emit(Events.PotClicked, {});
check('档位 raw', cooked[cooked.length - 1].grade, 'raw');
check('生食 净利 (6 - 8)', coinLog[coinLog.length - 1], -2);
check('生食 兜底 3 枚金币不发(净利为负)——资金', day.economy.balance, c0 - 2);

const c1 = day.economy.balance;
bus.emit(Events.PotatoInPot, {});
runTo(90); // 甜区上界 80 之后、100 之前
bus.emit(Events.PotClicked, {});
check('档位 over', cooked[cooked.length - 1].grade, 'over');
check('过火 净利 (0 - 15 - 8)', coinLog[coinLog.length - 1], -23);
check('过火后资金', day.economy.balance, c1 - 23);

console.log('=== 6. 食材切换：甜区实时变化 ===');
bus.emit(Events.IngredientChanged, { id: 'wagyu' });
bus.emit(Events.PotatoInPot, {});
check('和牛 甜区(66~78)', [cooking.sweetRange.min, cooking.sweetRange.max], [66, 78]);
runTo(70);
bus.emit(Events.PotClicked, {});
check('和牛 完美净利 (90×1 - 34)', coinLog[coinLog.length - 1], 56);

console.log('=== 7. 灶台升级 ===');
const coinsNow = day.economy.balance;
bus.emit(Events.StoveUpgrade, {});
if (coinsNow >= 120) {
  check('升级成功 → Lv2', day.economy.balance, coinsNow - 120);
  bus.emit(Events.IngredientChanged, { id: 'potato' });
  bus.emit(Events.PotatoInPot, {});
  check('商用灶 甜区(61.5~78.5)', [cooking.sweetRange.min, cooking.sweetRange.max], [61.5, 78.5]);
} else {
  console.log(`SKIP  资金 ${coinsNow} 不足 120，验证「钱不够不给升」`);
  check('资金不足时余额不变', day.economy.balance, coinsNow);
}

console.log('=== 8. 事件契约合规（审查项） ===');
check('dish:cooked 携带档位', typeof cooked[0].grade, 'string');
check('dish:cooked 携带质量', typeof cooked[0].quality, 'number');
check('dish:cooked 携带火候', typeof cooked[0].heat, 'number');
check('每次出餐都广播 combo:changed', comboLog.length, cooked.length);
check('金币只由结算产生（coin:earned 次数=出餐次数）', coinLog.length, cooked.length);

console.log('');
if (failed > 0) throw new Error(`冒烟测试失败：${failed} 项断言不符合预期`);
console.log(`全部通过（共 ${cooked.length} 锅）`);
