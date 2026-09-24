// STAY ASLEEP の決まりごと。画面（DOM）に触らない部分をここに集める。
// main.js（ブラウザ）と test.mjs（node）から読む。
//
// 扉の正解は種（seed）から決まる。深さ i（0 から）の扉は、
//   H = SHA-256(seed + ":" + floor(i / 256)) の i % 256 ビット目（先頭のバイトの上のビットから）。0 = 左、1 = 右。
// ふだんの扉は眠りのはじめに乱数で種を作り、SHA-256(seed) を「封」として先に見せる。
// 今日の扉は種が "stay-asleep:YYYY-MM-DD" なので、同じ日なら誰でも同じ並び。

const enc = new TextEncoder();

export const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
export const sha256 = async (text) => new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text)));
export const sealOf = async (seed) => toHex(await sha256(seed));
// 16 バイトの種を 16 進 32 文字で
export const newSeed = () => toHex(crypto.getRandomValues(new Uint8Array(16)));
export const dailySeed = (date) => `stay-asleep:${date}`;

export const bitAt = (bytes, j) => (bytes[j >> 3] >> (7 - (j & 7))) & 1;

export async function answerBlock(seed, block) {
  const h = await sha256(`${seed}:${block}`);
  return Array.from({ length: 256 }, (_, j) => bitAt(h, j));
}

// 深さ 0 から少なくとも n 枚ぶんの正解（256 枚ずつまとめて作る）
export async function answersFor(seed, n) {
  const out = [];
  for (let b = 0; out.length < Math.max(n, 1); b++) out.push(...await answerBlock(seed, b));
  return out;
}

// 封を開ける: 種からもう一度計算して、先に見せた封と同じか
export async function openSeal(seed, seal, n) {
  return { match: (await sealOf(seed)) === seal, answers: (await answersFor(seed, n)).slice(0, n) };
}

// ---- 日付（端末の時計の 0 時で変わる） ----

export function dateKey(d = new Date()) {
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function untilTomorrow(d = new Date()) {
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  const min = Math.max(1, Math.ceil((next - d) / 60000));
  return `${Math.floor(min / 60)} 時間 ${min % 60} 分`;
}

// ---- 確率の書き方（2^n は大きくなるので BigInt） ----

export const group = (s) => String(s).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const UNITS = [['京', 10n ** 16n], ['兆', 10n ** 12n], ['億', 10n ** 8n], ['万', 10n ** 4n]];

// 2^n を「105 万」「10.7 億」「1.10 兆」のように上から 3 桁で
export function approx(n) {
  const v = 1n << BigInt(n);
  for (const [name, base] of UNITS) {
    if (v < base) continue;
    const p = Number((Number(v) / Number(base)).toPrecision(3));
    return `${p >= 100 ? group(Math.round(p)) : p.toPrecision(3)} ${name}`;
  }
  return group(v);
}
// 「1/1,024」（深さ 20 からは「約 105 万回に 1 回」）
export const probText = (n) => (n < 20 ? `1/${group(1n << BigInt(n))}` : `約 ${approx(n)}回に 1 回`);
// 「1,024 回に 1 回」
export const oddsText = (n) => (n < 20 ? `${group(1n << BigInt(n))} 回に 1 回` : `約 ${approx(n)}回に 1 回`);

export function phrase(n) {
  if (n === 0) return 'まばたきほどの夢';
  if (n <= 3) return 'うたた寝';
  if (n <= 9) return 'ひと眠り';
  if (n <= 19) return 'ぐっすり';
  if (n <= 29) return '長い夢';
  return '伝説の眠り';
}

// 節目（5・10・20・30・40…）。notes はチャイムの音の数
export function milestone(n) {
  if (n === 5) return { text: '1/32', notes: 2 };
  if (n >= 10 && n % 10 === 0) return { text: `深さ ${n} ── ${oddsText(n)}`, notes: Math.min(5, n / 10 + 2) };
  return null;
}

// ---- ふだんの扉の記録 ----
// hist[n] = 深さ n で目が覚めた回数（長さはベスト + 1）。open = 途中の眠り（閉じたらその深さで終わった扱い）

const int = (x) => (Number.isInteger(x) && x >= 0 ? x : 0);
const isDate = (x) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x);

export const freshStats = (today) => ({ v: 1, best: 0, bestDate: null, todayDate: today, todayBest: 0, runs: 0, doors: 0, hist: [0], open: null });

export function readStats(raw, today) {
  const s = freshStats(today);
  if (!raw || typeof raw !== 'object' || raw.v !== 1) return s;
  s.best = int(raw.best);
  s.bestDate = isDate(raw.bestDate) ? raw.bestDate : null;
  s.runs = int(raw.runs);
  s.doors = int(raw.doors);
  s.hist = Array.from({ length: s.best + 1 }, (_, i) => int(Array.isArray(raw.hist) ? raw.hist[i] : 0));
  if (raw.todayDate === today) s.todayBest = int(raw.todayBest);
  const o = raw.open;
  if (o && Number.isInteger(o.depth) && o.depth > 0 && isDate(o.date)) s.open = { depth: o.depth, date: o.date };
  return s;
}

// 1 回の眠りが深さ depth で終わった（date はその眠りを始めた日）
export function endRun(s, depth, date) {
  const t = { ...s, hist: [...s.hist], open: null };
  t.runs++;
  t.doors += depth;
  if (depth > t.best) { t.best = depth; t.bestDate = date; }
  while (t.hist.length < t.best + 1) t.hist.push(0);
  t.hist[depth]++;
  if (date > t.todayDate) { t.todayDate = date; t.todayBest = 0; }
  if (date === t.todayDate) t.todayBest = Math.max(t.todayBest, depth);
  return t;
}

// あなたの運（20 回から）: 平均の深さを、運がふつうのとき（平均 1、ばらつき √(2 ÷ 回数)）と比べる
export function luck(s) {
  if (s.runs < 20) return null;
  const mean = s.doors / s.runs;
  const z = (mean - 1) / Math.sqrt(2 / s.runs);
  const label = z > 2 ? 'かなり運がいい' : z > 1 ? '少し運がいい' : z >= -1 ? 'ふつう' : z >= -2 ? '少し運が悪い' : 'かなり運が悪い';
  return { mean, z, label };
}
// 運がふつうなら、深さ d で目が覚めるのは何回くらいか
export const expected = (runs, d) => runs / 2 ** (d + 1);

// ---- 今日の扉 ----
// days[date] = その日の深さ。current = 今日の途中（awake: 目が覚めたか）

export const freshDaily = () => ({ v: 1, days: {}, current: null });

export function readDaily(raw) {
  const d = freshDaily();
  if (!raw || typeof raw !== 'object' || raw.v !== 1) return d;
  for (const [k, v] of Object.entries(raw.days || {})) if (isDate(k) && Number.isInteger(v) && v >= 0) d.days[k] = v;
  const c = raw.current;
  if (c && isDate(c.date) && Number.isInteger(c.depth) && c.depth >= 0) d.current = { date: c.date, depth: c.depth, awake: !!c.awake };
  return d;
}

// 前の日の途中の眠りは、その深さで終わった扱いにして days へ移す
export function settleDaily(d, today) {
  const c = d.current;
  if (!c || c.date === today) return d;
  const days = { ...d.days };
  if (days[c.date] == null) days[c.date] = c.depth;
  return { ...d, days, current: null };
}

export function dailySummary(d, today) {
  const dates = Object.keys(d.days).sort();
  let bestDay = null;
  for (const k of dates) if (!bestDay || d.days[k] > d.days[bestDay]) bestDay = k;
  const recent = [];
  const [y, m, dd] = today.split('-').map(Number);
  for (let i = 13; i >= 0; i--) {
    const k = dateKey(new Date(y, m - 1, dd - i));
    recent.push({ date: k, depth: d.days[k] ?? null });
  }
  return { count: dates.length, bestDay, best: bestDay ? d.days[bestDay] : 0, recent };
}
