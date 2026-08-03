// 後台：課表 / 動作編輯
import { store } from './store.js';
import { buildTimeline } from './engine.js';
import { fmt } from './ui-timer.js';

const $ = (s) => document.querySelector(s);

export function initEditorUI({ onWorkoutChanged, toast }) {
  let editingId = store.data.activeId;
  const openCards = new Set();

  const el = {
    select: $('#edit-workout-select'),
    name: $('#f-name'),
    prepare: $('#f-prepare'),
    rounds: $('#f-rounds'),
    roundrest: $('#f-roundrest'),
    skiplast: $('#f-skiplast'),
    summary: $('#edit-summary'),
    list: $('#ex-list'),
    count: $('#ex-count'),
  };

  const editing = () => store.data.workouts.find((w) => w.id === editingId) || store.activeWorkout();

  function commit() {
    store.saveData();
    renderSummary();
    if (editing().id === store.data.activeId) onWorkoutChanged();
  }

  // ---- 課表層級 ----
  el.select.addEventListener('change', () => {
    editingId = el.select.value;
    openCards.clear();
    render();
  });

  const bindNum = (input, key, min, max) => {
    input.addEventListener('input', () => {
      const w = editing();
      const v = parseInt(input.value, 10);
      if (Number.isNaN(v)) return;
      w[key] = Math.min(max, Math.max(min, v));
      commit();
    });
    input.addEventListener('blur', () => {
      const w = editing();
      input.value = w[key];
    });
  };

  el.name.addEventListener('input', () => {
    editing().name = el.name.value;
    commit();
    renderSelect();
  });
  bindNum(el.prepare, 'prepareSec', 0, 600);
  bindNum(el.rounds, 'rounds', 1, 99);
  bindNum(el.roundrest, 'roundRestSec', 0, 900);
  el.skiplast.addEventListener('change', () => {
    editing().skipLastRest = el.skiplast.checked;
    commit();
  });

  $('#btn-add-workout').addEventListener('click', () => {
    const w = store.addWorkout();
    editingId = w.id;
    openCards.clear();
    render();
    onWorkoutChanged();
    toast('已建立新課表');
    el.name.focus();
    el.name.select();
  });

  $('#btn-dup-workout').addEventListener('click', () => {
    const w = store.duplicateWorkout(editingId);
    if (!w) return;
    editingId = w.id;
    render();
    onWorkoutChanged();
    toast('已複製課表');
  });

  $('#btn-del-workout').addEventListener('click', () => {
    const w = editing();
    if (!confirm(`確定刪除「${w.name}」？`)) return;
    if (!store.removeWorkout(w.id)) {
      toast('至少要保留一份課表');
      return;
    }
    editingId = store.data.activeId;
    render();
    onWorkoutChanged();
    toast('已刪除');
  });

  // ---- 動作層級 ----
  $('#btn-add-ex').addEventListener('click', () => {
    const w = editing();
    store.addExercise(w);
    openCards.add(w.exercises[w.exercises.length - 1].id);
    render();
    commit();
    el.list.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  function exCard(ex, i, w) {
    const card = document.createElement('div');
    card.className = 'ex-card' + (openCards.has(ex.id) ? ' is-open' : '');

    const head = document.createElement('div');
    head.className = 'ex-head';
    head.innerHTML = `
      <div class="ex-idx">${i + 1}</div>
      <div class="ex-head-main">
        <div class="ex-head-name"></div>
        <div class="ex-head-meta">操 ${ex.workSec}s · 休 ${ex.restSec}s</div>
      </div>
      <svg viewBox="0 0 24 24" class="ico ex-caret"><path d="M7 10l5 5 5-5"/></svg>`;
    head.querySelector('.ex-head-name').textContent = ex.name || `動作 ${i + 1}`;
    head.addEventListener('click', () => {
      const open = card.classList.toggle('is-open');
      open ? openCards.add(ex.id) : openCards.delete(ex.id);
    });

    const body = document.createElement('div');
    body.className = 'ex-body';
    body.innerHTML = `
      <label class="field">
        <span>動作名稱</span>
        <input type="text" class="i-name" maxlength="20" placeholder="例：深蹲">
      </label>
      <label class="field">
        <span>動作描述（計時中會顯示）</span>
        <textarea class="i-desc" rows="2" maxlength="80" placeholder="例：膝蓋對齊腳尖，臀部向後坐"></textarea>
      </label>
      <div class="grid-2">
        <label class="field">
          <span>執行秒數</span>
          <input type="number" class="i-work" min="1" max="3600" inputmode="numeric">
        </label>
        <label class="field">
          <span>休息秒數</span>
          <input type="number" class="i-rest" min="0" max="3600" inputmode="numeric">
        </label>
      </div>
      <div class="ex-tools">
        <button class="icon-btn b-up" aria-label="上移"><svg viewBox="0 0 24 24" class="ico"><path d="M12 19V5M6 11l6-6 6 6"/></svg></button>
        <button class="icon-btn b-down" aria-label="下移"><svg viewBox="0 0 24 24" class="ico"><path d="M12 5v14M6 13l6 6 6-6"/></svg></button>
        <button class="icon-btn b-dup" aria-label="複製"><svg viewBox="0 0 24 24" class="ico"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg></button>
        <button class="icon-btn danger b-del" aria-label="刪除"><svg viewBox="0 0 24 24" class="ico"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg></button>
      </div>`;

    const iName = body.querySelector('.i-name');
    const iDesc = body.querySelector('.i-desc');
    const iWork = body.querySelector('.i-work');
    const iRest = body.querySelector('.i-rest');
    iName.value = ex.name;
    iDesc.value = ex.desc || '';
    iWork.value = ex.workSec;
    iRest.value = ex.restSec;

    const refreshHead = () => {
      head.querySelector('.ex-head-name').textContent = ex.name || `動作 ${i + 1}`;
      head.querySelector('.ex-head-meta').textContent = `操 ${ex.workSec}s · 休 ${ex.restSec}s`;
    };

    iName.addEventListener('input', () => { ex.name = iName.value; refreshHead(); commit(); });
    iDesc.addEventListener('input', () => { ex.desc = iDesc.value; commit(); });
    iWork.addEventListener('input', () => {
      const v = parseInt(iWork.value, 10);
      if (Number.isNaN(v)) return;
      ex.workSec = Math.min(3600, Math.max(1, v));
      refreshHead(); commit();
    });
    iRest.addEventListener('input', () => {
      const v = parseInt(iRest.value, 10);
      if (Number.isNaN(v)) return;
      ex.restSec = Math.min(3600, Math.max(0, v));
      refreshHead(); commit();
    });
    iWork.addEventListener('blur', () => (iWork.value = ex.workSec));
    iRest.addEventListener('blur', () => (iRest.value = ex.restSec));

    const up = body.querySelector('.b-up');
    const down = body.querySelector('.b-down');
    up.disabled = i === 0;
    down.disabled = i === w.exercises.length - 1;
    up.addEventListener('click', () => { store.moveExercise(w, i, i - 1); render(); commit(); });
    down.addEventListener('click', () => { store.moveExercise(w, i, i + 1); render(); commit(); });

    body.querySelector('.b-dup').addEventListener('click', () => {
      const copy = { ...ex, id: Math.random().toString(36).slice(2, 10) };
      w.exercises.splice(i + 1, 0, copy);
      openCards.add(copy.id);
      render(); commit();
    });
    body.querySelector('.b-del').addEventListener('click', () => {
      if (!store.removeExercise(w, ex.id)) {
        toast('至少要保留一個動作');
        return;
      }
      render(); commit();
    });

    card.append(head, body);
    return card;
  }

  function renderSelect() {
    const cur = editingId;
    el.select.innerHTML = '';
    store.data.workouts.forEach((w) => {
      const o = document.createElement('option');
      o.value = w.id;
      o.textContent = w.name + (w.id === store.data.activeId ? '（使用中）' : '');
      el.select.appendChild(o);
    });
    el.select.value = cur;
  }

  function renderSummary() {
    const w = editing();
    const { total, segments } = buildTimeline(w);
    const workSec = segments.filter((s) => s.kind === 'work').reduce((a, s) => a + s.duration, 0);
    el.summary.textContent =
      `總長 ${fmt(total)} ｜ 實際運動 ${fmt(workSec)} ｜ ` +
      `${w.exercises.length} 動作 × ${w.rounds} 輪 = ${segments.filter((s) => s.kind === 'work').length} 段`;
  }

  function render() {
    const w = editing();
    renderSelect();
    el.name.value = w.name;
    el.prepare.value = w.prepareSec;
    el.rounds.value = w.rounds;
    el.roundrest.value = w.roundRestSec;
    el.skiplast.checked = !!w.skipLastRest;
    el.count.textContent = `${w.exercises.length} 個`;
    el.list.innerHTML = '';
    w.exercises.forEach((ex, i) => el.list.appendChild(exCard(ex, i, w)));
    renderSummary();
  }

  return {
    render,
    focusWorkout(id) {
      editingId = id;
      render();
    },
  };
}
