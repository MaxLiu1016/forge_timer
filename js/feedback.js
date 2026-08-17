// 感官回饋：嗶聲（WebAudio 合成，免音檔）、震動、語音、螢幕恆亮
import { store } from './store.js';

let ctx = null;
let master = null;   // 所有 tone 的匯流點（壓縮器之前）
let out = null;      // 使用者音量（壓縮器之後）

/** 設定頁的 0-100 對應到 0-2.5 倍。放在壓縮器後面，拉大才是真的變大聲 */
const outGain = () => ((store.prefs.volume ?? 80) / 100) * 2.5;

export function applyVolume() {
  if (out) out.gain.value = outGain();
}

/** 必須由使用者手勢觸發一次，否則 iOS 不給發聲 */
export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    // 訊號鏈：每顆 tone → master → 壓縮器 → out（使用者音量）→ 喇叭
    //
    // 壓縮器擋的是「完成音那種四顆 oscillator 疊在一起」的破音，
    // 但它也會把音量壓回去，所以使用者音量一定要接在它後面，
    // 不然滑桿拉到底也只是餵更多訊號進去被壓掉，聽起來一樣大聲。
    master = ctx.createGain();
    master.gain.value = 1;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.setValueAtTime(-14, ctx.currentTime);
    comp.ratio.setValueAtTime(12, ctx.currentTime);
    comp.attack.setValueAtTime(0.003, ctx.currentTime);
    comp.release.setValueAtTime(0.12, ctx.currentTime);
    out = ctx.createGain();
    out.gain.value = outGain();
    master.connect(comp).connect(out).connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  primeSpeech();
  // 播一個無聲片段解鎖
  const b = ctx.createBuffer(1, 1, 22050);
  const s = ctx.createBufferSource();
  s.buffer = b;
  s.connect(ctx.destination);
  s.start(0);
}

// iOS 規定第一次 speak() 必須發生在使用者手勢裡，沒先開過的話，
// 之後在計時器回呼中呼叫會安安靜靜地失敗——語音「沒反應」多半是這個原因。
let speechPrimed = false;
function primeSpeech() {
  if (speechPrimed || !window.speechSynthesis) return;
  speechPrimed = true;
  try {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    speechSynthesis.speak(u);
  } catch { /* 不支援就算了 */ }
}

function tone(freq, dur = 0.12, gain = 0.25, type = 'sine', delay = 0) {
  if (!store.prefs.sound || !ctx || ctx.state !== 'running') return;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(master || ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

export const sfx = {
  countdownSoft: () => tone(560, 0.09, 0.34, 'triangle'),     // 倒數 5-4：先預告，音高低一點
  countdown: () => tone(780, 0.12, 0.52, 'triangle'),         // 倒數 3-2-1：拉高拉響
  goWork: () => {                                            // 開始操
    tone(520, 0.16, 0.6, 'square');
    tone(880, 0.32, 0.6, 'square', 0.13);
  },
  goRest: () => {                                            // 進入休息
    tone(660, 0.18, 0.45, 'sine');
    tone(440, 0.34, 0.45, 'sine', 0.15);
  },
  finish: () => {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.32, 0.55, 'triangle', i * 0.14));
  },
  tap: () => tone(320, 0.05, 0.18, 'sine'),
};

// 這兩個是平台有沒有給的問題，不是設定問題。設定頁會拿去標示「不支援」。
export const canVibrate = typeof navigator.vibrate === 'function';
export const canSpeak = typeof window.speechSynthesis !== 'undefined';

export function buzz(pattern) {
  if (!store.prefs.vibrate || !canVibrate) return;
  navigator.vibrate(pattern);
}

export function speak(text) {
  if (!store.prefs.voice || !canSpeak || !text) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'zh-TW';
  u.rate = 1.05;
  u.volume = 1;
  speechSynthesis.cancel();
  // iOS 上 cancel() 之後緊接著 speak() 有機會被一起吃掉，讓出一個 tick 再講
  setTimeout(() => {
    try { speechSynthesis.speak(u); } catch { /* 裝置不給就算了 */ }
  }, 0);
}

// ---- Wake Lock：運動中不讓螢幕睡著 ----
let wakeLock = null;

export async function acquireWakeLock() {
  if (!store.prefs.keepAwake || !('wakeLock' in navigator) || wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => {
      wakeLock = null;
    });
  } catch {
    /* 使用者拒絕或不支援，忽略 */
  }
}

export async function releaseWakeLock() {
  try {
    await wakeLock?.release();
  } catch {
    /* noop */
  }
  wakeLock = null;
}

export function rebindWakeLock(shouldHold) {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && shouldHold()) acquireWakeLock();
  });
}
