// node test.mjs — 決まりの自己チェック（正解の出し方・封・今日の扉・偏り・確率の書き方・記録）
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as L from './logic.js';

let n = 0;
const test = async (name, fn) => { await fn(); n++; console.log(`ok ${name}`); };

// 仕様どおりの計算を node の crypto で別に書いたもの（logic.js と食い違えば落ちる）
function spec(seed, count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const h = createHash('sha256').update(`${seed}:${Math.floor(i / 256)}`).digest();
    out.push((h[(i % 256) >> 3] >> (7 - (i % 8))) & 1);
  }
  return out;
}

const SEED = '00112233445566778899aabbccddeeff';

await test('正解: 決まった種なら、いつも同じ並び。仕様の式と一致する（256 枚目からは次のかたまり）', async () => {
  const a = await L.answersFor(SEED, 600);
  const b = await L.answersFor(SEED, 600);
  assert.deepEqual(a, b);
  assert.deepEqual(a.slice(0, 600), spec(SEED, 600));
  assert.ok(a.every((x) => x === 0 || x === 1));
  assert.notDeepEqual(a.slice(0, 256), a.slice(256, 512));
});

await test('封: SHA-256(種) と一致し、種を 1 文字でも変えると一致しない', async () => {
  const seal = await L.sealOf(SEED);
  assert.equal(seal, createHash('sha256').update(SEED).digest('hex'));
  const ok = await L.openSeal(SEED, seal, 12);
  assert.equal(ok.match, true);
  assert.deepEqual(ok.answers, spec(SEED, 12));
  const bad = await L.openSeal(SEED.replace(/f$/, 'e'), seal, 12);
  assert.equal(bad.match, false);
});

await test('種: 16 進 32 文字で、毎回ちがう', () => {
  const s = new Set(Array.from({ length: 200 }, L.newSeed));
  assert.equal(s.size, 200);
  for (const x of s) assert.match(x, /^[0-9a-f]{32}$/);
});

await test('今日の扉: 同じ日なら同じ並び、ちがう日ならちがう並び', async () => {
  assert.equal(L.dailySeed('2026-09-25'), 'stay-asleep:2026-09-25');
  const a = (await L.answersFor(L.dailySeed('2026-09-25'), 64)).slice(0, 64);
  const b = (await L.answersFor(L.dailySeed('2026-09-25'), 64)).slice(0, 64);
  const c = (await L.answersFor(L.dailySeed('2026-09-26'), 64)).slice(0, 64);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.deepEqual(a, spec('stay-asleep:2026-09-25', 64));
});

await test('偏りがない: 1 万個の種で、1 枚目の右は 45〜55%。1 つの種の 2,560 枚でも半々に近い', async () => {
  let right = 0;
  for (let i = 0; i < 10000; i++) right += (await L.answerBlock(L.newSeed(), 0))[0];
  assert.ok(right > 4500 && right < 5500, `右 ${right}`);
  const long = await L.answersFor(SEED, 2560);
  const r = long.reduce((a, b) => a + b, 0) / long.length;
  assert.ok(r > 0.45 && r < 0.55, `右の割合 ${r}`);
  // 同じ深さ 1 万回の眠りで、深さの平均は 1 に近い（運がふつう）
  let doors = 0;
  for (let i = 0; i < 10000; i++) {
    const bits = await L.answerBlock(L.newSeed(), 0);
    const picks = await L.answerBlock(L.newSeed(), 0);   // 選び方も乱数で
    let d = 0; while (bits[d] === picks[d]) d++;
    doors += d;
  }
  assert.ok(Math.abs(doors / 10000 - 1) < 0.08, `平均 ${doors / 10000}`);
});

await test('確率の書き方', () => {
  assert.equal(L.probText(10), '1/1,024');
  assert.equal(L.probText(12), '1/4,096');
  assert.equal(L.probText(19), '1/524,288');
  assert.equal(L.probText(20), '約 105 万回に 1 回');
  assert.equal(L.oddsText(10), '1,024 回に 1 回');
  assert.equal(L.oddsText(30), '約 10.7 億回に 1 回');
  assert.equal(L.oddsText(40), '約 1.10 兆回に 1 回');
  assert.equal(L.approx(26), '6,710 万');
  for (let k = 20; k < 70; k++) assert.doesNotMatch(L.approx(k), /^10,000 /, `2^${k}`);
  assert.deepEqual(L.milestone(5), { text: '1/32', notes: 2 });
  assert.equal(L.milestone(10).text, '深さ 10 ── 1,024 回に 1 回');
  assert.equal(L.milestone(20).text, '深さ 20 ── 約 105 万回に 1 回');
  assert.equal(L.milestone(50).notes, 5);
  assert.equal(L.milestone(7), null);
  assert.equal(L.phrase(0), 'まばたきほどの夢');
  assert.equal(L.phrase(30), '伝説の眠り');
});

await test('記録: 眠りが終わるとベスト・今日・回数・合計・分布が進む', () => {
  let s = L.freshStats('2026-09-25');
  s = L.endRun(s, 3, '2026-09-25');
  s = L.endRun(s, 0, '2026-09-25');
  s = L.endRun(s, 5, '2026-09-25');
  assert.equal(s.best, 5);
  assert.equal(s.bestDate, '2026-09-25');
  assert.equal(s.todayBest, 5);
  assert.equal(s.runs, 3);
  assert.equal(s.doors, 8);
  assert.deepEqual(s.hist, [1, 0, 0, 1, 0, 1]);
  // 次の日に読むと今日の最高は 0 から
  const t = L.readStats(JSON.parse(JSON.stringify(s)), '2026-09-26');
  assert.equal(t.todayBest, 0);
  assert.equal(t.best, 5);
  // 前の日に始めた眠りを今日片づけても、今日の最高は動かない
  const u = L.endRun(t, 4, '2026-09-25');
  assert.equal(u.todayBest, 0);
  assert.equal(u.runs, 4);
});

await test('記録: 壊れた値・知らない項目・途中の眠りを読む', () => {
  const s = L.readStats({ v: 1, best: 2, runs: 'x', hist: [1, 'a'], junk: 1, open: { depth: 4, date: '2026-09-25' } }, '2026-09-25');
  assert.equal(s.runs, 0);
  assert.deepEqual(s.hist, [1, 0, 0]);
  assert.equal('junk' in s, false);
  assert.deepEqual(s.open, { depth: 4, date: '2026-09-25' });
  assert.deepEqual(L.readStats(null, '2026-09-25'), L.freshStats('2026-09-25'));
  assert.deepEqual(L.readStats({ v: 9 }, '2026-09-25'), L.freshStats('2026-09-25'));
});

await test('あなたの運: 20 回から。平均 1 はふつう、平均 2 はかなり運がいい', () => {
  assert.equal(L.luck({ runs: 19, doors: 19 }), null);
  assert.equal(L.luck({ runs: 50, doors: 50 }).label, 'ふつう');
  assert.equal(L.luck({ runs: 50, doors: 100 }).label, 'かなり運がいい');
  assert.equal(L.luck({ runs: 50, doors: 20 }).label, 'かなり運が悪い');
  assert.equal(L.expected(64, 0), 32);
  assert.equal(L.expected(64, 2), 8);
});

await test('今日の扉: 前の日の途中は、その深さで終わった扱い。今日の途中はそのまま', () => {
  let d = L.readDaily({ v: 1, days: { '2026-09-20': 2, bad: 3 }, current: { date: '2026-09-24', depth: 6, awake: false } });
  assert.deepEqual(d.days, { '2026-09-20': 2 });
  d = L.settleDaily(d, '2026-09-25');
  assert.equal(d.current, null);
  assert.equal(d.days['2026-09-24'], 6);
  const e = { v: 1, days: {}, current: { date: '2026-09-25', depth: 3, awake: false } };
  assert.equal(L.settleDaily(e, '2026-09-25'), e);
  const sum = L.dailySummary(d, '2026-09-25');
  assert.equal(sum.count, 2);
  assert.equal(sum.best, 6);
  assert.equal(sum.recent.length, 14);
  assert.equal(sum.recent.at(-1).date, '2026-09-25');
  assert.equal(sum.recent.at(-2).depth, 6);
});

await test('日付: 端末の日付で、0 時まであと何分', () => {
  assert.equal(L.dateKey(new Date(2026, 8, 5, 23, 59)), '2026-09-05');
  assert.equal(L.untilTomorrow(new Date(2026, 8, 25, 18, 48)), '5 時間 12 分');
});

console.log(`\n${n} 件すべて合格`);
