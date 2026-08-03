// 感官回饋：嗶聲（WebAudio 合成，免音檔）、震動、語音、螢幕恆亮
import { store } from './store.js';

let ctx = null;

/** 必須由使用者手勢觸發一次，否則 iOS 不給發聲 */
export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
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
  osc.connect(g).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

export const sfx = {
  countdown: () => tone(760, 0.1, 0.2, 'triangle'),          // 倒數 3-2-1
  goWork: () => {                                            // 開始操
    tone(520, 0.14, 0.28, 'square');
    tone(880, 0.28, 0.28, 'square', 0.13);
  },
  goRest: () => {                                            // 進入休息
    tone(660, 0.16, 0.22, 'sine');
    tone(440, 0.3, 0.22, 'sine', 0.15);
  },
  finish: () => {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.3, 0.26, 'triangle', i * 0.14));
  },
  tap: () => tone(320, 0.05, 0.12, 'sine'),
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
