// 進入點：路由、設定頁、課表切換、PWA 安裝
import { store } from './store.js';
import { Engine, buildTimeline } from './engine.js';
import { initTimerUI, openSheet, closeSheets, fmt } from './ui-timer.js';
import { initEditorUI } from './ui-editor.js';
import { unlockAudio, applyVolume, sfx, canVibrate, canSpeak } from './feedback.js';
import { initSortable } from './drag-sort.js';

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

// ---------- 是否為「已安裝的 App」 ----------
// iOS 對 display-mode 媒體查詢的支援不一致，從主畫面啟動時舊版會回報 browser，
// 只有 navigator.standalone 一定準，所以兩個都看。
function syncStandalone() {
  const on = matchMedia('(display-mode: standalone)').matches
    || matchMedia('(display-mode: fullscreen)').matches
    || navigator.standalone === true;
  document.documentElement.classList.toggle('is-standalone', on);
}
syncStandalone();
matchMedia('(display-mode: standalone)').addEventListener?.('change', syncStandalone);

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

  // 課表列自成一個容器，排序才不會把下面那顆「編輯課表」也算成清單的一員
  const rows = document.createElement('div');
  rows.className = 'sort-rows';
  list.appendChild(rows);

  store.data.workouts.forEach((w) => {
    const { total } = buildTimeline(w);
    const btn = document.createElement('button');
    btn.className = 'row-item' + (w.id === store.data.activeId ? ' is-active' : '');
    btn.innerHTML = `
      <div class="sort-grip" aria-label="拖曳調整順序">
        <svg viewBox="0 0 24 24" class="ico"><path d="M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01"/></svg>
      </div>
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
    rows.appendChild(btn);
  });

  initSortable({
    list: rows,
    scroller: list,
    handle: '.sort-grip',
    onDrop(from, to) {
      store.moveWorkout(from, to);
      openWorkoutSheet();   // 整份重畫，順序與「使用中」標記一次對齊
      editorUI.render();    // 編輯頁那顆下拉選單也照同一個順序排
    },
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

// 音量滑桿
const vol = $('#p-volume');
const volVal = $('#p-volume-val');
const syncVol = () => {
  vol.value = store.prefs.volume ?? 80;
  volVal.textContent = `${vol.value}%`;
};
syncVol();
vol.addEventListener('input', () => {
  store.prefs.volume = parseInt(vol.value, 10);
  volVal.textContent = `${vol.value}%`;
  applyVolume();
});
vol.addEventListener('change', () => store.savePrefs());
$('#btn-test-sound').addEventListener('click', () => {
  unlockAudio();
  applyVolume();
  sfx.goWork();
});

// 震動與語音是平台功能，不是每台裝置都有（iOS 就完全沒有震動 API）。
// 不支援的時候把開關關掉並寫明原因，免得使用者一直以為是 App 壞了。
function markUnsupported(sel, note) {
  const box = $(sel);
  const label = box.closest('.field-switch');
  box.disabled = true;
  box.checked = false;
  label.classList.add('is-unsupported');
  const span = label.querySelector('span');
  if (!span.querySelector('.unsupported-note')) {
    const n = document.createElement('small');
    n.className = 'unsupported-note';
    n.textContent = note;
    span.appendChild(n);
  }
}
if (!canVibrate) markUnsupported('#p-vibrate', '這台裝置或瀏覽器沒有震動 API（iOS 全系列都沒有）');
if (!canSpeak) markUnsupported('#p-voice', '這個瀏覽器不支援語音合成');

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
  // 已經有 controller 才掛這個監聽：代表這次不是第一次安裝，
  // 而是有新版 SW 搶下控制權（sw.js 裡有 skipWaiting + claim）。
  // 重載一次讓畫面吃到新的 CSS/JS，使用者才不用「關掉再開兩次」。
  if (navigator.serviceWorker.controller) {
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      location.reload();
    });
  }
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
} else if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister()));
  caches?.keys().then((ks) => ks.forEach((k) => caches.delete(k)));
}
