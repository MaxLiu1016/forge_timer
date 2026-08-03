// 進入點：路由、設定頁、課表切換、PWA 安裝
import { store } from './store.js';
import { Engine, buildTimeline } from './engine.js';
import { initTimerUI, openSheet, closeSheets, fmt } from './ui-timer.js';
import { initEditorUI } from './ui-editor.js';
import { unlockAudio } from './feedback.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

// ---------- Toast ----------
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 1900);
}

// ---------- 主題 ----------
function applyTheme() {
  document.documentElement.dataset.theme = store.prefs.theme;
  document.querySelector('meta[name=theme-color]')
    .setAttribute('content', store.prefs.theme === 'light' ? '#f4f6fa' : '#0b0f14');
}
applyTheme();

// ---------- 引擎 ----------
const engine = new Engine();
engine.load(store.activeWorkout());

const timerUI = initTimerUI(engine, { onOpenWorkouts: openWorkoutSheet });

const editorUI = initEditorUI({
  toast,
  onWorkoutChanged() {
    engine.pause();
    engine.load(store.activeWorkout());
  },
});
editorUI.render();

// 方便在 DevTools 裡直接操作／除錯
window.__forge = { engine, store, go: (v) => go(v) };

// ---------- 分頁路由 ----------
function go(view) {
  $$('.view').forEach((v) => v.classList.toggle('is-active', v.id === `view-${view}`));
  $$('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.view === view));
  if (view === 'edit') editorUI.render();
  if (view === 'timer') timerUI.render();
  location.hash = view;
}
$$('.tab').forEach((t) => t.addEventListener('click', () => go(t.dataset.view)));
go(['timer', 'edit', 'settings'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'timer');

// ---------- 課表切換 ----------
function openWorkoutSheet() {
  const list = $('#workout-list');
  list.innerHTML = '';
  store.data.workouts.forEach((w) => {
    const { total } = buildTimeline(w);
    const btn = document.createElement('button');
    btn.className = 'row-item' + (w.id === store.data.activeId ? ' is-active' : '');
    btn.innerHTML = `
      <div class="r-main">
        <div class="r-title"></div>
        <div class="r-sub">${fmt(total)} ｜ ${w.exercises.length} 動作 × ${w.rounds} 輪</div>
      </div>
      ${w.id === store.data.activeId ? '<span class="r-badge">使用中</span>' : ''}`;
    btn.querySelector('.r-title').textContent = w.name;
    btn.addEventListener('click', () => {
      store.setActive(w.id);
      engine.pause();
      engine.load(store.activeWorkout());
      editorUI.focusWorkout(w.id);
      closeSheets();
      toast(`已切換到「${w.name}」`);
    });
    list.appendChild(btn);
  });

  const edit = document.createElement('button');
  edit.className = 'btn btn-block';
  edit.style.marginTop = '4px';
  edit.textContent = '編輯課表 →';
  edit.addEventListener('click', () => { closeSheets(); go('edit'); });
  list.appendChild(edit);

  openSheet('#sheet-workouts');
}

// ---------- 設定 ----------
const prefMap = {
  '#p-sound': 'sound',
  '#p-vibrate': 'vibrate',
  '#p-voice': 'voice',
  '#p-wake': 'keepAwake',
};
Object.entries(prefMap).forEach(([sel, key]) => {
  const box = $(sel);
  box.checked = !!store.prefs[key];
  box.addEventListener('change', () => {
    store.prefs[key] = box.checked;
    store.savePrefs();
    if (key === 'sound' && box.checked) unlockAudio();
  });
});

const light = $('#p-light');
light.checked = store.prefs.theme === 'light';
light.addEventListener('change', () => {
  store.prefs.theme = light.checked ? 'light' : 'dark';
  store.savePrefs();
  applyTheme();
});

// 匯出 / 匯入 / 重設
$('#btn-export').addEventListener('click', () => {
  const blob = new Blob([store.exportJSON()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'forge-workouts.json';
  a.click();
  URL.revokeObjectURL(a.href);
  toast('已匯出');
});

$('#btn-import').addEventListener('click', () => $('#file-import').click());
$('#file-import').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    store.importJSON(await file.text());
    engine.pause();
    engine.load(store.activeWorkout());
    editorUI.focusWorkout(store.data.activeId);
    applyTheme();
    syncPrefBoxes();
    toast('匯入成功');
  } catch (err) {
    toast('匯入失敗：' + err.message);
  }
  e.target.value = '';
});

$('#btn-reset-all').addEventListener('click', () => {
  if (!confirm('回復預設會清掉所有自訂課表，確定嗎？')) return;
  store.resetAll();
  engine.pause();
  engine.load(store.activeWorkout());
  editorUI.focusWorkout(store.data.activeId);
  applyTheme();
  syncPrefBoxes();
  toast('已回復預設');
});

function syncPrefBoxes() {
  Object.entries(prefMap).forEach(([sel, key]) => ($(sel).checked = !!store.prefs[key]));
  light.checked = store.prefs.theme === 'light';
}

// ---------- PWA ----------
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  $('#install-card').hidden = false;
});
$('#btn-install').addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  $('#install-card').hidden = true;
});
window.addEventListener('appinstalled', () => {
  $('#install-card').hidden = true;
  toast('安裝完成');
});

// 開發時在網址加上 ?nosw 可以停用快取，改完直接 F5 就看得到
if ('serviceWorker' in navigator && !location.search.includes('nosw')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
} else if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister()));
  caches?.keys().then((ks) => ks.forEach((k) => caches.delete(k)));
}
