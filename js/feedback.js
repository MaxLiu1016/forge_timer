// 感官回饋：嗶聲（WebAudio 合成，免音檔）、震動、語音、螢幕恆亮
import { store } from './store.js';

let ctx = null;
let master = null;

/** 必須由使用者手勢觸發一次，否則 iOS 不給發聲 */
export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    // 所有聲音都走同一條 master，最後掛一顆壓縮器。
    // 完成音那種四顆 oscillator 疊在一起的段落，音量開大就會破音，
    // 有壓縮器擋著才能把整體拉響（運動時手機常常放在地上，離耳朵不近）。
    master = ctx.createGain();
    master.gain.value = 1;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.setValueAtTime(-14, ctx.currentTime);
    comp.ratio.setValueAtTime(12, ctx.currentTime);
    comp.attack.setValueAtTime(0.003, ctx.currentTime);
    comp.release.setValueAtTime(0.12, ctx.currentTime);
    master.connect(comp).connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  // 播一個無聲片段解鎖
  const b = ctx.createBuffer(1, 1, 22050);
  const s = ctx.createBufferSource();
  s.buffer = b;
  s.connect(ctx.destination);
  s.start(0);
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

export function buzz(pattern) {
  if (!store.prefs.vibrate) return;
  if (navigator.vibrate) navigator.vibrate(pattern);
}

export function speak(text) {
  if (!store.prefs.voice || !window.speechSynthesis || !text) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'zh-TW';
  u.rate = 1.05;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
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
