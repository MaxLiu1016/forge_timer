// 計時頁的畫面渲染與互動
import { sfx, buzz, speak, unlockAudio, acquireWakeLock, releaseWakeLock, rebindWakeLock } from './feedback.js';

const $ = (s) => document.querySelector(s);
const CIRC = 2 * Math.PI * 88;

const PHASE_TEXT = {
  prepare: '準備',
  work: '進行中',
  rest: '休息',
  roundRest: '輪次休息',
};
const PHASE_VAR = {
  prepare: 'var(--prepare)',
  work: 'var(--work)',
  rest: 'var(--rest)',
  roundRest: 'var(--roundrest)',
};

export function fmt(sec) {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** 大字倒數：60 秒內只顯示秒數，超過才顯示 m:ss */
function bigTime(sec) {
  const s = Math.max(0, Math.ceil(sec - 0.001));
  if (s < 60) return String(s).padStart(2, '0');
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function initTimerUI(engine, { onOpenWorkouts }) {
  const el = {
    body: document.body,
    name: $('#workout-name'),
    round: $('#round-pill'),
    ring: $('#ring-bar'),
    phase: $('#phase-label'),
    time: $('#seg-time'),
    exName: $('#ex-name'),
    exDesc: $('#ex-desc'),
    nextUp: $('#next-up'),
    nextText: $('#next-text'),
    tElapsed: $('#total-elapsed'),
    tAll: $('#total-all'),
    tLeft: $('#total-left'),
    tFill: $('#total-fill'),
    segCount: $('#seg-count'),
    stage: $('#stage'),
    tlList: $('#timeline-list'),
  };

  el.ring.style.strokeDasharray = CIRC;

  // ---- 事件綁定 ----
  $('#btn-play').addEventListener('click', () => {
    unlockAudio();
    engine.toggle();
  });
  $('#btn-reset').addEventListener('click', () => {
    engine.reset();
    buzz(15);
  });
  $('#btn-prev').addEventListener('click', () => { unlockAudio(); engine.prev(); buzz(10); });
  $('#btn-next').addEventListener('click', () => { unlockAudio(); engine.next(); buzz(10); });
  $('#workout-switch').addEventListener('click', onOpenWorkouts);

  // 點畫面中央就能暫停／繼續（運動中手忙，別逼人瞄準小按鈕）
  el.stage.addEventListener('click', () => {
    unlockAudio();
    engine.toggle();
    buzz(8);
  });

  // 空白鍵播放暫停、左右鍵切換段落（桌機投影用）
  document.addEventListener('keydown', (e) => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (!$('#view-timer').classList.contains('is-active')) return;
    if (e.code === 'Space') { e.preventDefault(); unlockAudio(); engine.toggle(); }
    if (e.code === 'ArrowRight') engine.next();
    if (e.code === 'ArrowLeft') engine.prev();
    if (e.code === 'KeyR') engine.reset();
  });

  // ---- 流程總覽 ----
  $('#btn-list').addEventListener('click', () => {
    renderTimeline();
    openSheet('#sheet-timeline');
  });

  function renderTimeline() {
    const cur = engine.current();
    let lastRound = null;
    el.tlList.innerHTML = '';
    engine.timeline.segments.forEach((s, i) => {
      if (s.round !== lastRound && s.kind !== 'prepare') {
        lastRound = s.round;
        const h = document.createElement('div');
        h.className = 'tl-round';
        h.textContent = `第 ${s.round} 輪`;
        el.tlList.appendChild(h);
      }
      const row = document.createElement('div');
      row.className = 'tl-item' + (i === cur?.idx ? ' is-now' : i < (cur?.idx ?? 0) ? ' is-past' : '');
      row.style.setProperty('--dot', PHASE_VAR[s.kind]);
      row.innerHTML = `<span class="tl-name"></span><span class="tl-sec">${s.duration}s</span>`;
      row.querySelector('.tl-name').textContent = s.name;
      row.addEventListener('click', () => {
        engine.seek(s.start);
        closeSheets();
      });
      el.tlList.appendChild(row);
    });
  }

  // ---- 感官回饋 ----
  engine.addEventListener('segment', (e) => {
    const { seg } = e.detail;
    if (seg.kind === 'work') {
      sfx.goWork();
      buzz([0, 90, 60, 90]);
      speak(seg.name);
    } else if (seg.kind === 'rest' || seg.kind === 'roundRest') {
      sfx.goRest();
      buzz(140);
      speak('休息');
    }
  });

  engine.addEventListener('second', (e) => {
    const { secondsLeft } = e.detail;
    if (secondsLeft <= 3 && secondsLeft >= 1) {
      sfx.countdown();
      buzz(35);
    }
  });

  engine.addEventListener('finish', () => {
    sfx.finish();
    buzz([0, 120, 80, 120, 80, 250]);
    speak('完成');
    releaseWakeLock();
  });

  engine.addEventListener('state', () => {
    el.body.classList.toggle('is-running', engine.running);
    if (engine.running) acquireWakeLock();
    else releaseWakeLock();
    render(engine.current());
  });

  engine.addEventListener('load', () => render(engine.current()));
  engine.addEventListener('tick', (e) => render(e.detail));

  rebindWakeLock(() => engine.running);

  // 回到前景時立刻補算一次（背景可能被節流）
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') render(engine.current());
  });

  // ---- 渲染 ----
  function render(cur) {
    const w = engine.workout;
    if (!w) return;
    el.name.textContent = w.name;
    el.tAll.textContent = fmt(engine.total);

    if (!cur) return;
    const done = engine.finished;
    const { seg } = cur;
    const phase = done ? 'done' : seg.kind;

    el.body.dataset.phase = phase;
    el.body.classList.toggle('is-urgent', engine.running && cur.remaining <= 3.2 && cur.remaining > 0);

    el.phase.textContent = done ? '完成' : PHASE_TEXT[seg.kind];
    el.time.textContent = done ? '✓' : bigTime(cur.remaining);

    // 操的時候看動作名稱；休息／準備的時候先預告下一個動作，讓人有時間就位
    if (done) {
      el.exName.textContent = '辛苦了';
      el.exDesc.textContent = `總共 ${fmt(engine.total)}，完成 ${w.rounds} 輪`;
    } else if (seg.kind === 'work') {
      el.exName.textContent = seg.name;
      el.exDesc.textContent = seg.desc || '';
    } else {
      el.exName.textContent = seg.nextName ? `→ ${seg.nextName}` : '';
      el.exDesc.textContent = seg.nextDesc || seg.desc || '';
    }

    // 圓環：本段剩餘比例（順時針退掉）
    el.ring.style.strokeDashoffset = CIRC * (done ? 1 : cur.progress);

    // 「接下來」只在操的時候顯示；休息時環內已經在預告了，不用講兩次
    const nxt = engine.timeline.segments[cur.idx + 1];
    if (nxt && !done && seg.kind === 'work') {
      el.nextUp.hidden = false;
      el.nextText.textContent = `${nxt.name} · ${nxt.duration}s`;
    } else {
      el.nextUp.hidden = true;
    }

    // 輪次 / 動作序號
    const totalEx = w.exercises.length;
    if (done) {
      el.round.textContent = '已完成';
    } else if (seg.index > 0) {
      el.round.textContent = `第 ${seg.round}/${w.rounds} 輪 · 動作 ${seg.index}/${totalEx}`;
    } else {
      el.round.textContent = `${w.rounds} 輪 · ${totalEx} 個動作`;
    }

    // 總進度
    el.tElapsed.textContent = fmt(engine.elapsed);
    el.tLeft.textContent = fmt(engine.remainingTotal);
    el.tFill.style.width = `${(engine.elapsed / (engine.total || 1)) * 100}%`;
    el.segCount.textContent = `段落 ${Math.min(cur.idx + 1, engine.timeline.segments.length)}/${engine.timeline.segments.length}`;
  }

  return { render: () => render(engine.current()) };
}

// ---- 共用的 sheet 控制 ----
export function openSheet(sel) {
  document.querySelector(sel).hidden = false;
}
export function closeSheets() {
  document.querySelectorAll('.sheet').forEach((s) => (s.hidden = true));
}
document.addEventListener('click', (e) => {
  if (e.target.matches('[data-close]')) closeSheets();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSheets();
});
