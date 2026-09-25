// STAY ASLEEP の画面。決まりは logic.js にあり、ここは描く・触る・鳴らす・保存するだけ。
import * as L from './logic.js';

// localStorage はほかのアプリと共有される（同じ t-of.github.io のため）。キーは必ず 'stay-asleep.' で始める。
const STORE = 'stay-asleep.';

function load(key) {
  try {
    const v = localStorage.getItem(STORE + key);
    return v == null ? null : JSON.parse(v);
  } catch { return null; }
}
function save(key, value) {
  try { localStorage.setItem(STORE + key, JSON.stringify(value)); } catch { /* 保存できなくても遊べる */ }
}

WebAppKit.init({ title: 'STAY ASLEEP', text: '2 枚の扉のうち、夢が続くのは片方だけ。どこまで深く眠れるか。' });

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js');
}

// iPhone のマナーモードでも鳴らす（Safari 16.4 以降）。
// 'playback' にすると音楽アプリの曲が止まるので、アプリの音がオンのときだけにする。
function setAudioSession(soundOn) {
  try { if (navigator.audioSession) navigator.audioSession.type = soundOn ? 'playback' : 'auto'; } catch { /* 対応していない */ }
}

const $ = (s) => document.querySelector(s);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const body = document.body;
const sky = $('#sky'), veil = $('#veil'), motesEl = $('#motes'), flare = $('#flare');
const world = $('#world'), stage = $('#stage'), dawn = $('#dawn'), result = $('#result');
const depthEl = $('#depth'), slot = $('.hud__slot');
const themeMeta = document.querySelector('meta[name="theme-color"]');

// ---------- 保存 ----------

let today = L.dateKey();
const settings = { v: 1, sound: true, coached: false, ...(load('settings') || {}) };
settings.sound = settings.sound !== false;
settings.coached = settings.coached === true;
let stats = L.readStats(load('stats'), today);
let daily = L.settleDaily(L.readDaily(load('daily')), today);
// 前に閉じたときの途中の眠りは、その深さで目が覚めた扱い
if (stats.open) stats = L.endRun(stats, stats.open.depth, stats.open.date);
save('stats', stats);
save('daily', daily);
const saveSettings = () => save('settings', { v: 1, sound: settings.sound, coached: settings.coached });

function refreshToday() {
  today = L.dateKey();
  if (stats.todayDate !== today) stats = { ...stats, todayDate: today, todayBest: 0 };
}

// ---------- 音（Web Audio で作る） ----------

const sfx = (() => {
  let ctx = null, out = null, drone = [];
  function ensure() {
    if (!settings.sound) return null;
    setAudioSession(true);
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      out = ctx.createGain();
      out.gain.value = 0.55;
      out.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function tone({ f, to, type = 'sine', at = 0, dur = 0.3, vol = 0.15, attack = 0.006 }) {
    const c = ensure();
    if (!c) return;
    const t = c.currentTime + at + 0.01;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  // やわらかい鐘: 基音と、少し高い倍音を短く
  const bell = (f, at = 0, vol = 0.14, dur = 0.7) => {
    tone({ f, at, vol, dur, attack: 0.004 });
    tone({ f: f * 2.76, at, vol: vol * 0.12, dur: dur * 0.4, attack: 0.002 });
  };
  const PENTA = [0, 2, 4, 7, 9, 12, 14, 16];
  return {
    ensure,
    ui: () => tone({ f: 1250, type: 'square', dur: 0.015, vol: 0.02 }),
    tap: () => tone({ f: 2300, type: 'square', dur: 0.03, vol: 0.035 }),
    latch: () => { tone({ f: 1500, type: 'triangle', dur: 0.025, vol: 0.05 }); tone({ f: 820, type: 'triangle', at: 0.02, dur: 0.03, vol: 0.04 }); },
    // 心音のような低い「トッ」（小さなスピーカーでも聞こえるよう、少し上の音も重ねる）
    heart: () => { tone({ f: 78, to: 48, dur: 0.16, vol: 0.32, attack: 0.008 }); tone({ f: 150, to: 95, dur: 0.1, vol: 0.06, attack: 0.006 }); },
    // 夢が続く: 深さごとに 5 音音階を 1 段上がる。8 段で 1 周し、周ごとに下に 5 度の音を重ねる
    deeper(depth) {
      const k = (depth - 1) % 8, lap = Math.floor((depth - 1) / 8);
      const f = 523.25 * 2 ** (PENTA[k] / 12);
      for (let j = 0; j <= Math.min(lap, 3); j++) bell(f * (2 / 3) ** j, j * 0.012, j ? 0.07 : 0.14);
    },
    chime(n) {
      const notes = [784, 880, 988, 1175, 1319];
      for (let i = 0; i < n; i++) bell(notes[i], 0.32 + i * 0.15, 0.1, 0.6);
    },
    sparkle: () => [1568, 1976, 2349].forEach((f, i) => tone({ f, type: 'triangle', at: 0.5 + i * 0.07, dur: 0.25, vol: 0.05 })),
    // 目が覚める: やわらかく下がる 2 音と、小さな鳥の「チッ」
    wake() {
      tone({ f: 659.25, type: 'triangle', dur: 0.45, vol: 0.12, attack: 0.02 });
      tone({ f: 493.88, type: 'triangle', at: 0.2, dur: 0.5, vol: 0.12, attack: 0.02 });
      tone({ f: 3300, to: 4300, at: 0.5, dur: 0.06, vol: 0.035, attack: 0.004 });
    },
    sleep: () => tone({ f: 440, to: 294, dur: 0.38, vol: 0.1, attack: 0.02 }),
    // 深さ 10 からの持続音（ほかの音の 1/5 ほど）。10 で 1 音、20 で 2 音、30 で 3 音。0 で 0.6 秒かけて消える
    drone(level) {
      const c = level > 0 ? ensure() : ctx;
      if (!c) return;
      const FREQ = [130.81, 196, 329.63];
      while (drone.length > level) {
        const d = drone.pop();
        d.g.gain.cancelScheduledValues(c.currentTime);
        d.g.gain.setValueAtTime(d.g.gain.value, c.currentTime);
        d.g.gain.linearRampToValueAtTime(0, c.currentTime + 0.6);
        d.o.stop(c.currentTime + 0.7);
      }
      while (drone.length < level) {
        const o = c.createOscillator(), g = c.createGain();
        o.frequency.value = FREQ[drone.length];
        g.gain.setValueAtTime(0, c.currentTime);
        g.gain.linearRampToValueAtTime(0.028, c.currentTime + 2);
        o.connect(g).connect(out);
        o.start();
        drone.push({ o, g });
      }
    },
  };
})();

// ---------- 空の色と景色 ----------

// 深さ 0 は夕暮れのラベンダー → 5 で藍 → 10 で夜 → 20 で深い紺 → 30 で紫がかった黒
const SKY = [
  [0, '#34306a', '#6f5f9e', '#c3a3d6'],
  [5, '#1f2462', '#3c3f8c', '#7a74c0'],
  [10, '#11163a', '#22295e', '#414884'],
  [20, '#080c24', '#111943', '#1f2656'],
  [30, '#0a0614', '#150d2c', '#251a44'],
];
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hex = (c) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
const mix = (a, b, t) => { const x = rgb(a), y = rgb(b); return hex(x.map((v, i) => v + (y[i] - v) * t)); };
function skyAt(d) {
  for (let k = 0; k < SKY.length - 1; k++) {
    const [d0, ...c0] = SKY[k], [d1, ...c1] = SKY[k + 1];
    if (d <= d1) return c0.map((c, i) => mix(c, c1[i], (d - d0) / (d1 - d0)));
  }
  return SKY.at(-1).slice(1);
}
function setBg(c) {
  document.documentElement.style.setProperty('--bg', c);
  themeMeta.content = c;
}
function paintSky(d, instant = false) {
  const [top, mid, bot] = skyAt(d);
  if (instant) sky.style.transition = 'none';
  sky.style.setProperty('--sky-top', top);
  sky.style.setProperty('--sky-mid', mid);
  sky.style.setProperty('--sky-bot', bot);
  body.style.setProperty('--leaf', leafAt(d));
  if (instant) { void sky.offsetWidth; sky.style.transition = ''; }
  setBg(top);
}
// 扉板: 空より少し濃い平らな面（向こうが透けないように不透明）
const leafAt = (d) => mix(skyAt(d)[1], '#120d34', 0.5);
// 扉の向こうに見える、次の夢の色の光
function dreamLight(d) {
  const [, mid] = skyAt(d);
  return { glow: mix(mid, '#ffffff', 0.32), mid };
}

const motes = [];
// 景色は重ねていく: 10 で月、20 で雲の海、30 でオーロラ、40 から星の渦。光の粒は深さの数だけ（30 まで）
function setScene(d) {
  body.classList.toggle('s-moon', d >= 10);
  body.classList.toggle('s-clouds', d >= 20);
  body.classList.toggle('s-aurora', d >= 30);
  body.classList.toggle('s-swirl', d >= 40);
  motes.forEach((m, i) => m.classList.toggle('on', i < Math.min(d, 30)));
}

function buildMotes() {
  const S = Math.ceil(Math.max(innerWidth, innerHeight) * 1.5);
  motesEl.style.setProperty('--S', `${S}px`);
  motesEl.dataset.s = S;
  for (let i = 0; i < 30; i++) {
    const m = document.createElement('i');
    m.className = 'mote';
    const x = S / 2 + (Math.random() - 0.5) * innerWidth * 0.94;
    const y = S / 2 + (Math.random() - 0.5) * innerHeight * 0.9;
    m.dataset.x = x;
    m.dataset.y = y;
    m.style.cssText = `left:${x}px;top:${y}px;--z:${(1.4 + Math.random() * 2).toFixed(1)}px;--a:${(0.45 + Math.random() * 0.5).toFixed(2)};--t:${(2 + Math.random() * 3).toFixed(1)}s;--d:${(-Math.random() * 4).toFixed(1)}s`;
    motesEl.append(m);
    motes.push(m);
  }
}
// 深さ 5: 光の粒が深さの数字に集まって、一度きらめく
function gather() {
  const r = depthEl.getBoundingClientRect();
  const S = +motesEl.dataset.s;
  const tx = r.left + r.width / 2 - (innerWidth / 2 - S / 2), ty = r.top + r.height / 2 - (innerHeight / 2 - S / 2);
  for (const m of motes) {
    m.style.setProperty('--gx', `${tx - m.dataset.x + (Math.random() - 0.5) * 30}px`);
    m.style.setProperty('--gy', `${ty - m.dataset.y + (Math.random() - 0.5) * 20}px`);
  }
  flare.style.setProperty('--fy', `${r.top + r.height / 2}px`);
  body.classList.remove('gather');
  void body.offsetWidth;
  body.classList.add('gather');
  setTimeout(() => body.classList.remove('gather'), 1700);
}

// ---------- 扉 ----------

const doorHTML = (side) => `
  <button class="door" data-side="${side}" aria-label="${side ? '右' : '左'}の扉">
    <span class="door__shadow"></span>
    <span class="door__body">
      <span class="door__beyond"></span>
      <span class="door__leaf"><span class="door__knob"></span></span>
    </span>
    <span class="door__gap"></span>
  </button>`;
function renderDoors() {
  world.className = 'world';
  world.style.transform = '';
  world.style.opacity = '';
  world.innerHTML = doorHTML(0) + doorHTML(1);
  stage.classList.remove('holding');
}
const doorEl = (side) => world.querySelector(`.door[data-side="${side}"]`);
// 扉の向こう: 次の夢の色と、その奥に小さく次の 2 枚（mini は拡大したときにちょうど今の大きさになる倍率）
function fillDream(door, d, mini) {
  const { glow, mid } = dreamLight(d);
  const b = door.querySelector('.door__beyond');
  b.style.background = `radial-gradient(ellipse 80% 55% at 50% 52%, ${glow}, ${mid})`;
  b.innerHTML = `<span class="mini" style="--mini:${mini};--leaf:${leafAt(d)}"><i></i><i></i></span>`;
}
function fillMorning(door) {
  door.querySelector('.door__beyond').style.background = 'radial-gradient(ellipse at 50% 58%, #ffffff, #fff8ea 48%, #f1e4cc)';
}

// ---------- 眠り（1 回ぶん） ----------
// run = { mode, seed, seal, bits, depth, picks, awake, date, … }。ふだんと今日の扉で 1 つずつ持つ

let mode = 'free';
let run = null;
const runs = { free: null, daily: null };
let busy = false;

async function newFreeRun() {
  refreshToday();
  const seed = L.newSeed();
  const [seal, bits] = await Promise.all([L.sealOf(seed), L.answersFor(seed, 64)]);
  return { mode: 'free', seed, seal, bits, depth: 0, picks: [], awake: false, date: today, noticed: false };
}
async function dailyRun() {
  refreshToday();
  daily = L.settleDaily(daily, today);
  save('daily', daily);
  const c = daily.current;
  if (daily.days[today] != null && (!c || c.date !== today || c.awake)) {
    return { mode: 'daily', date: today, depth: daily.days[today], awake: true, revisit: true };
  }
  const depth = c && c.date === today ? c.depth : 0;
  const seed = L.dailySeed(today);
  return { mode: 'daily', seed, bits: await L.answersFor(seed, depth + 64), depth, picks: [], awake: false, date: today };
}
const bestFor = (r) => (r.mode === 'free' ? stats.best
  : Math.max(0, ...Object.entries(daily.days).filter(([k]) => k !== r.date).map(([, v]) => v)));
const droneLevel = (d) => (d >= 30 ? 3 : d >= 20 ? 2 : d >= 10 ? 1 : 0);

function hud() {
  const n = run.depth;
  depthEl.textContent = n;
  $('#prob').innerHTML = n === 0 ? '夢のはじまり'
    : `ここまで来る確率 ${L.probText(n)}${n >= 20 ? `<small>1/2<sup>${n}</sup></small>` : ''}`;
  if (run.mode === 'free') {
    $('#sub').textContent = `ベスト ${stats.best} ・ 今日 ${stats.todayBest}`;
    $('#seal').textContent = `封 ${run.seal.slice(0, 16).match(/.{4}/g).join(' ')}`;
  } else {
    const [, m, d] = run.date.split('-').map(Number);
    $('#sub').textContent = `今日の扉 ${m}/${d} ・ 1 日 1 回`;
    $('#seal').textContent = '今日の扉は日付から決まる。誰でも同じ並び';
  }
}

function show(r, { enter = false } = {}) {
  run = r;
  if (r.awake) { showResult(r, true); return; }
  body.classList.remove('awake');
  result.hidden = true;
  renderDoors();
  paintSky(r.depth, true);
  setScene(r.depth);
  hud();
  depthEl.classList.remove('glow');
  sfx.drone(droneLevel(r.depth));
  $('#coach').hidden = settings.coached;
  if (enter) world.classList.add('enter');
}

function pick(side) {
  if (busy || !run || run.awake || !sheet.hidden) return;
  const i = run.depth;
  if (run.bits[i] === undefined) return;
  busy = true;
  const ok = run.bits[i] === side;
  const best = bestFor(run);
  // 自己ベストに並ぶ扉と、越える扉だけ、ためを長くする
  const long = best >= 3 && (i + 1 === best || i + 1 === best + 1);
  run.picks.push(side);
  commit(ok);
  if (!settings.coached) { settings.coached = true; saveSettings(); $('#coach').hidden = true; }
  play(side, ok, long).catch((e) => { console.error(e); busy = false; });
}

// 結果はタップした瞬間に保存する（開くまでの演出の間に閉じても、なかったことにならない）
function commit(ok) {
  const d = ok ? run.depth + 1 : run.depth;
  if (run.mode === 'free') {
    if (ok) {
      stats.open = { depth: d, date: run.date };
    } else {
      run.newBest = d > stats.best;
      run.newToday = d > stats.todayBest;
      stats = L.endRun(stats, d, run.date);
    }
    save('stats', stats);
  } else {
    daily.current = { date: run.date, depth: d, awake: !ok };
    if (!ok) daily.days[run.date] = d;
    save('daily', daily);
  }
}

async function play(side, ok, long) {
  const T = long ? 1400 : 900;
  const me = doorEl(side), other = doorEl(1 - side);
  // ため: 選んだ扉が前へ、もう片方は後ろへ。取っ手が回り、すき間から白い光（まだどちらか分からない）
  me.style.setProperty('--hold', `${T}ms`);
  stage.classList.add('holding');
  me.classList.add('is-chosen');
  other.classList.add('is-other');
  sfx.tap();
  setTimeout(sfx.latch, 250);
  (long ? [330, 700, 1070] : [330, 620]).forEach((t) => setTimeout(sfx.heart, t));
  await wait(T);

  const next = run.depth + 1;
  if (ok) {
    // 夢が続く: 向こうに次の夢の色と小さな 2 枚。その中へ吸いこまれる
    const zoom = zoomFor(me);
    fillDream(me, next, zoom.mini);
    me.classList.add('is-open');
    sfx.deeper(next);
    await wait(reduced.matches ? 550 : 420);
    if (reduced.matches) {
      world.classList.add('fade');
      world.style.opacity = '0';
      await wait(300);
    } else {
      world.style.transformOrigin = `${zoom.cx}px ${zoom.cy}px`;
      world.classList.add('zoom');
      world.style.transform = `translate(${zoom.dx}px, ${zoom.dy}px) scale(${zoom.s})`;
      other.style.opacity = '0';
      await wait(560);
    }
    run.depth = next;
    // 奥の 2 枚が今の大きさになったところで本物の扉に入れかえ、光の色から空の色へ戻す
    const { glow, mid } = dreamLight(next);
    veil.style.transition = 'none';
    veil.style.background = `radial-gradient(ellipse at 50% 58%, ${glow}, ${mid} 95%)`;
    veil.style.opacity = reduced.matches ? '0' : '1';
    paintSky(next, true);
    renderDoors();
    void veil.offsetWidth;
    veil.style.transition = 'opacity 0.6s ease';
    veil.style.opacity = '0';
    if (reduced.matches) world.classList.add('enter');
    setScene(next);
    hud();
    depthEl.classList.remove('bump');
    void depthEl.offsetWidth;
    depthEl.classList.add('bump');
    sfx.drone(droneLevel(next));
    arrive(next);
    busy = false;
  } else {
    // 目が覚める: 向こうは白い朝の光。溶ける前の一瞬、もう片方が少し開いて夢の続きが見える
    fillMorning(me);
    me.classList.add('is-open');
    sfx.wake();
    sfx.drone(0);
    await wait(180);
    fillDream(other, next, 0.2);
    other.classList.remove('is-other');
    other.classList.add('is-peek');
    await wait(reduced.matches ? 700 : 560);
    const r = me.getBoundingClientRect();
    dawn.style.setProperty('--x', `${r.left + r.width / 2}px`);
    dawn.style.setProperty('--y', `${r.top + r.height / 2}px`);
    dawn.className = 'dawn';
    dawn.hidden = false;
    void dawn.offsetWidth;
    dawn.classList.add('go');
    await wait(reduced.matches ? 450 : 700);
    run.awake = true;
    showResult(run);
    busy = false; // ボタンは showResult の 0.5 秒後に押せるようになる。朝の光が消えるのを待たずに受け付ける
    await wait(150);
    dawn.classList.add('out');
    await wait(720);
    dawn.hidden = true;
  }
}

// 選んだ扉の中心を画面の真ん中へ寄せながら拡大し、扉の内側（アーチの下まで）が画面を覆う倍率
function zoomFor(me) {
  const w = world.getBoundingClientRect(), r = me.getBoundingClientRect();
  const k = r.width / me.offsetWidth;   // ためで前に出た分（1.04）
  const cx = r.left + r.width / 2 - w.left, cy = r.top + r.height / 2 - w.top;
  const sy = w.top + w.height / 2;       // 拡大したあとの扉の中心（画面の高さ）
  const arch = r.height / 2 - r.width / 2;
  const s = 1.12 * Math.max(innerWidth / r.width, sy / arch, (innerHeight - sy) / (r.height / 2));
  return { cx, cy, dx: w.width / 2 - cx, dy: w.height / 2 - cy, s, mini: 1 / (s * k) };
}

// 新しい深さに着いたとき: 節目と、自己ベストを越えたとき（ふだんの扉で、ベストが 3 以上のとき 1 回だけ）
function arrive(n) {
  const m = L.milestone(n);
  const best = run.mode === 'free' ? stats.best : 0;
  const notice = run.mode === 'free' && best >= 3 && n === best + 1 && !run.noticed;
  if (notice) run.noticed = true;
  if (run.mode === 'free' && best >= 3 && n > best) depthEl.classList.add('glow');
  if (!m && !notice) return;
  const msg = $('#msg'), big = $('#msgBig'), small = $('#msgSmall');
  const NOTICE = 'ここから先は、まだ来たことのない深さ';
  big.textContent = m ? m.text : NOTICE;
  big.className = n === 5 ? 'huge' : '';
  big.style.fontSize = m ? '' : '17px';
  small.textContent = m && notice ? NOTICE : '';
  const ms = m && notice ? 3000 : 1800;
  msg.style.animationDuration = `${ms}ms`;
  msg.hidden = true;
  void msg.offsetWidth;
  msg.hidden = false;
  slot.classList.add('showing');
  clearTimeout(arrive.t);
  arrive.t = setTimeout(() => { msg.hidden = true; slot.classList.remove('showing'); }, ms);
  if (m) { sfx.chime(m.notes); if (n === 5) gather(); }
  if (notice) sfx.sparkle();
}

// ---------- 結果 ----------

let waitTimer = 0;
function showResult(r, instant = false) {
  body.classList.add('awake');
  setBg('#eef0f7');
  sfx.drone(0);
  const n = r.depth;
  $('#rTitle').textContent = r.revisit ? '今日の扉は、もう開けた' : '目が覚めた';
  $('#rDepth').textContent = n;
  $('#rPhrase').textContent = L.phrase(n);
  $('#rProb').textContent = n === 0 ? '1 枚目で目が覚めた（夢が続くのは 2 枚に 1 枚）' : `ここまで来る確率 ${L.probText(n)}`;
  const [, mm, dd] = r.date.split('-').map(Number);
  const badges = r.mode === 'daily' ? [`今日の扉 ${mm}/${dd}`] : r.newBest && n > 0 ? ['自己ベスト'] : r.newToday && n > 0 ? ['今日の最高'] : [];
  $('#rBadges').innerHTML = badges.map((b) => `<span>${b}</span>`).join('');
  const again = $('#again');
  again.textContent = r.mode === 'free' ? 'もう一度眠る' : 'ふだんの扉へ';
  $('#rSeal').hidden = r.mode !== 'free';
  const w = $('#rWait');
  w.hidden = r.mode !== 'daily';
  clearInterval(waitTimer);
  if (r.mode === 'daily') {
    const tick = () => { w.textContent = `明日の扉まで あと ${L.untilTomorrow()}`; };
    tick();
    waitTimer = setInterval(tick, 20000);
  }
  result.hidden = false;
  result.style.animation = instant ? 'none' : '';
  // 出てから 0.5 秒は押せない（続けてタップしていた指で押さないように）
  again.disabled = !instant;
  if (!instant) setTimeout(() => { again.disabled = false; }, 500);
}

$('#again').addEventListener('click', async () => {
  if (busy) return;
  if (run.mode === 'daily') { setMode('free'); return; }
  busy = true;
  sfx.sleep();
  runs.free = await newFreeRun();
  // 朝の色から夕暮れへ、眠りに落ちるように
  veil.style.transition = 'none';
  veil.style.background = 'var(--day-bg)';
  veil.style.opacity = '1';
  show(runs.free, { enter: true });
  void veil.offsetWidth;
  veil.style.transition = 'opacity 0.8s ease';
  veil.style.opacity = '0';
  busy = false;
});

async function setMode(m) {
  if (busy || (m === mode && run)) return;
  busy = true;
  if (run) sfx.ui();
  mode = m;
  $('#modeFree').setAttribute('aria-pressed', m === 'free');
  $('#modeDaily').setAttribute('aria-pressed', m === 'daily');
  if (m === 'free') {
    if (!runs.free || runs.free.awake) runs.free = await newFreeRun();
  } else if (!runs.daily || runs.daily.awake || runs.daily.date !== L.dateKey()) {
    runs.daily = await dailyRun();
  }
  show(runs[m], { enter: true });
  busy = false;
}
$('#modeFree').addEventListener('click', () => setMode('free'));
$('#modeDaily').addEventListener('click', () => setMode('daily'));

// 扉か、画面の左半分・右半分（上の帯より下）どこでも
$('#play').addEventListener('click', (e) => {
  if (e.target.closest('a, button:not(.door)')) return;
  const d = e.target.closest('.door');
  pick(d ? +d.dataset.side : e.clientX < innerWidth / 2 ? 0 : 1);
});
addEventListener('keydown', (e) => {
  if (!sheet.hidden) { if (e.key === 'Escape') closeSheet(); return; }
  if (e.key === 'ArrowLeft') pick(0);
  else if (e.key === 'ArrowRight') pick(1);
  else if ((e.key === 'Enter' || e.key === ' ') && !result.hidden && !e.target.closest('button, a')) {
    e.preventDefault();
    if (!$('#again').disabled) $('#again').click();
  }
});
// 最初の音は、さわったときに鳴らせるようにしておく
addEventListener('pointerdown', () => sfx.ensure(), { passive: true });

// ---------- 音のオン・オフ ----------

function renderSound() {
  const b = $('#sound');
  b.textContent = settings.sound ? '音 オン' : '音 オフ';
  b.setAttribute('aria-pressed', settings.sound);
}
$('#sound').addEventListener('click', () => {
  if (settings.sound) sfx.drone(0);
  settings.sound = !settings.sound;
  setAudioSession(settings.sound);
  saveSettings();
  renderSound();
  if (settings.sound) { sfx.ui(); if (run && !run.awake) sfx.drone(droneLevel(run.depth)); }
});

// ---------- 共有 ----------

$('#rShare').addEventListener('click', () => {
  const n = run.depth;
  let text;
  if (run.mode === 'daily') {
    const [, m, d] = run.date.split('-').map(Number);
    text = `STAY ASLEEP 今日の扉 ${m}/${d}: 深さ ${n}${n ? `（${L.probText(n)}）` : ''}`;
  } else {
    text = n === 0 ? 'STAY ASLEEP で、1 枚目で目が覚めた'
      : `${run.newBest ? '自己ベスト！' : ''}STAY ASLEEP で深さ ${n} まで眠れた（ここまで来る確率 ${L.probText(n)}）`;
  }
  WebAppKit.share({ text, url: 'https://t-of.github.io/stay-asleep/' });
});

// ---------- シート（記録・封を開ける） ----------

const sheet = $('#sheet');
function openSheet(title, html) {
  sfx.ui();
  $('#sheetTitle').textContent = title;
  $('#sheetBody').innerHTML = html;
  $('#sheetBody').scrollTop = 0;
  sheet.hidden = false;
  sheet.querySelector('.sheet__head button').focus({ preventScroll: true });
}
function closeSheet() { sheet.hidden = true; }
sheet.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) { sfx.ui(); closeSheet(); } });

const fmtDate = (k) => (k ? k.split('-').map(Number).slice(1).join('/') : '');
const cell = (label, value, note = '') => `<div class="num"><span>${label}</span><b>${value}</b>${note ? `<small>${note}</small>` : ''}</div>`;

function statsHTML(tab) {
  const tabs = `<div class="tabs">
    <button class="seg__btn" data-tab="free" aria-pressed="${tab === 'free'}">ふだん</button>
    <button class="seg__btn" data-tab="daily" aria-pressed="${tab === 'daily'}">今日の扉</button></div>`;
  if (tab === 'daily') {
    const sum = L.dailySummary(daily, today);
    const c = daily.current;
    const now = daily.days[today] != null ? daily.days[today] : c && c.date === today ? c.depth : '—';
    const nowNote = daily.days[today] == null && c && c.date === today ? '眠っている途中' : '';
    const top = Math.max(1, ...sum.recent.map((r) => r.depth || 0));
    const bars = sum.recent.map((r) => `<div><i class="${r.depth == null ? 'none' : ''}" style="height:${r.depth == null ? 2 : Math.max(3, (r.depth / top) * 64)}px" title="${fmtDate(r.date)} 深さ ${r.depth ?? '—'}"></i><span>${+r.date.slice(8)}</span></div>`).join('');
    return `${tabs}<div class="nums">
      ${cell('今日の深さ', now, nowNote)}
      ${cell('これまでの日数', sum.count)}
      ${cell('一番深かった日', sum.bestDay ? sum.best : '—', sum.bestDay ? `${fmtDate(sum.bestDay)}（${L.probText(sum.best)}）` : '')}
      ${cell('明日の扉まで', L.untilTomorrow())}
    </div>
    <h3>最近 14 日</h3><div class="days">${bars}</div>
    <p class="note">今日の扉は日付から決まる。同じ日なら誰でも同じ並び。1 日 1 回で、途中で閉じても同じ深さから続く。</p>`;
  }
  const s = stats;
  const mean = s.runs ? s.doors / s.runs : 0;
  const lk = L.luck(s);
  const luckHTML = lk
    ? `<div class="luck"><span class="note">あなたの運</span><br><b>${lk.label}</b><p class="note">平均の深さ ${mean.toFixed(2)}（運がふつうなら 1）。${s.runs} 回ぶんで比べた。</p></div>`
    : `<div class="luck"><span class="note">あなたの運</span><p class="note">あと ${20 - s.runs} 回眠ると、運がふつうの人と比べられる。</p></div>`;
  let dist = '<p class="note">まだ記録がない。</p>';
  if (s.runs) {
    const max = Math.max(...s.hist, L.expected(s.runs, 0));
    dist = `<div class="dist">${s.hist.map((c, d) => `<span class="dist__d">${d}</span><span class="dist__bar"><i style="width:${(c / max) * 100}%"></i><u style="left:${(L.expected(s.runs, d) / max) * 100}%"></u></span><span class="dist__n">${c}</span>`).join('')}</div>
      <div class="legend"><span><i></i>あなた</span><span><u></u>運がふつうならこのくらい</span></div>`;
  }
  return `${tabs}<div class="nums">
    ${cell('自己ベスト', s.best, s.best ? `${L.probText(s.best)}${s.bestDate ? ` ・ ${fmtDate(s.bestDate)}` : ''}` : '')}
    ${cell('今日の最高', s.todayBest)}
    ${cell('眠った回数', s.runs)}
    ${cell('ぬけた扉の合計', s.doors)}
  </div>
  <div class="nums" style="margin-top:8px">${cell('平均の深さ', s.runs ? mean.toFixed(2) : '—', '運がふつうなら平均は 1')}</div>
  ${luckHTML}
  <h3>深さの分布（目が覚めた深さ）</h3>${dist}`;
}
const openStats = () => openSheet('記録', statsHTML(mode));
$('#sheetBody').addEventListener('click', (e) => {
  const t = e.target.closest('[data-tab]');
  if (t) { sfx.ui(); $('#sheetBody').innerHTML = statsHTML(t.dataset.tab); }
});
$('#openStats').addEventListener('click', openStats);
$('#rStats').addEventListener('click', openStats);

// 封を開ける: 種をもう一度 SHA-256 にかけて、はじめに見せた封と比べる
$('#rSeal').addEventListener('click', async () => {
  const r = run;
  if (r.mode !== 'free' || !r.awake) return;
  const n = r.picks.length;
  const [{ match, answers }, again] = await Promise.all([L.openSeal(r.seed, r.seal, n), L.sealOf(r.seed)]);
  const LR = ['左', '右'];
  const seq = answers.map((a, i) => `<div class="${a === r.picks[i] ? '' : 'miss'}"><span>${i}</span>${LR[a]}<span>${LR[r.picks[i]]}</span></div>`).join('');
  openSheet('封を開ける', `
    <p class="note">扉の正解は、眠りのはじめに作った「種」から決まっていた。種は隠して、種の SHA-256（封）だけを扉の下に出していた。</p>
    <h3>はじめに出した封</h3><p class="hash">${r.seal}</p>
    <h3>種</h3><p class="hash">${r.seed}</p>
    <h3>種の SHA-256（いま計算した）</h3><p class="hash">${again}</p>
    <span class="match ${match ? '' : 'bad'}">${match ? '封と一致' : '封と一致しない'}</span>
    <h3>深さごとの正解（上）と、選んだ扉（下）</h3><div class="seq">${seq}</div>
    <p class="note">深さ i の正解は SHA-256(種 + ":" + ⌊i ÷ 256⌋) の i % 256 ビット目（0 = 左、1 = 右）。</p>
    <h3>手元で確かめる</h3><p class="hash">printf %s ${r.seed} | shasum -a 256</p>`);
});

// ---------- はじめ ----------

renderSound();
if (!settings.sound) setAudioSession(false);
buildMotes();
setMode('free');
