// 計時引擎：把課表攤平成 segment 時間軸，用「絕對時間戳」推算進度
// （不累加 setInterval，手機鎖屏/切背景回來也不會走鐘）

/**
 * Segment {
 *   kind: 'prepare' | 'work' | 'rest' | 'roundRest'
 *   name, desc, duration
 *   round        目前第幾輪（1-based）
 *   index        該輪的第幾個動作（1-based，prepare/roundRest 為 0）
 *   start, end   在整條時間軸上的起訖秒數
 * }
 */
export function buildTimeline(w) {
  const segs = [];
  let t = 0;
  const push = (s) => {
    if (s.duration <= 0) return;
    segs.push({ ...s, start: t, end: t + s.duration });
    t += s.duration;
  };

  if (w.prepareSec > 0) {
    const first = w.exercises[0];
    push({
      kind: 'prepare',
      name: '準備',
      desc: '',
      nextName: first?.name || '',
      nextDesc: first?.desc || '',
      duration: w.prepareSec,
      round: 1,
      index: 0,
    });
  }

  const rounds = Math.max(1, w.rounds || 1);
  for (let r = 1; r <= rounds; r++) {
    w.exercises.forEach((ex, i) => {
      const isLastEx = i === w.exercises.length - 1;
      push({
        kind: 'work',
        name: ex.name || `動作 ${i + 1}`,
        desc: ex.desc || '',
        duration: Math.max(1, ex.workSec || 0),
        round: r,
        index: i + 1,
      });
      const skip = isLastEx && (w.skipLastRest || (r === rounds));
      if (!skip) {
        const next = isLastEx ? w.exercises[0] : w.exercises[i + 1];
        push({
          kind: 'rest',
          name: '休息',
          desc: '',
          nextName: next?.name || '',
          nextDesc: next?.desc || '',
          duration: ex.restSec || 0,
          round: r,
          index: i + 1,
        });
      }
    });

    if (r < rounds && w.roundRestSec > 0) {
      push({
        kind: 'roundRest',
        name: '輪次休息',
        desc: `第 ${r + 1} / ${rounds} 輪即將開始`,
        nextName: w.exercises[0]?.name || '',
        nextDesc: w.exercises[0]?.desc || '',
        duration: w.roundRestSec,
        round: r,
        index: 0,
      });
    }
  }

  return { segments: segs, total: t };
}

export class Engine extends EventTarget {
  constructor() {
    super();
    this.timeline = { segments: [], total: 0 };
    this.workout = null;
    this.elapsed = 0;          // 已經過的總秒數
    this.running = false;
    this._anchor = 0;          // running 時的起算時間戳
    this._anchorElapsed = 0;
    this._lastSegIdx = -1;
    this._lastWhole = -1;
    this._raf = null;
    this._interval = null;
  }

  load(workout, { keepPosition = false } = {}) {
    this.workout = workout;
    this.timeline = buildTimeline(workout);
    if (!keepPosition) this.seek(0);
    else this.seek(Math.min(this.elapsed, this.timeline.total));
    this._lastSegIdx = -1;
    this.emit('load');
  }

  get total() {
    return this.timeline.total;
  }
  get remainingTotal() {
    return Math.max(0, this.total - this.elapsed);
  }
  get finished() {
    return this.elapsed >= this.total && this.total > 0;
  }

  segmentAt(t) {
    const segs = this.timeline.segments;
    if (!segs.length) return null;
    const clamped = Math.min(Math.max(t, 0), Math.max(0, this.total - 0.0001));
    // 線性搜尋足夠：segment 數量通常 < 200
    for (let i = 0; i < segs.length; i++) {
      if (clamped < segs[i].end) return { seg: segs[i], idx: i };
    }
    return { seg: segs[segs.length - 1], idx: segs.length - 1 };
  }

  current() {
    const hit = this.segmentAt(this.elapsed);
    if (!hit) return null;
    const { seg, idx } = hit;
    const done = this.finished;
    return {
      seg,
      idx,
      remaining: done ? 0 : Math.max(0, seg.end - this.elapsed),
      segElapsed: done ? seg.duration : Math.max(0, this.elapsed - seg.start),
      progress: done ? 1 : Math.min(1, (this.elapsed - seg.start) / seg.duration),
    };
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  start() {
    if (this.running || !this.total) return;
    if (this.finished) this.seek(0);
    this.running = true;
    this._anchor = performance.now();
    this._anchorElapsed = this.elapsed;
    this._loop();
    // setInterval 當背景保險（rAF 在背景會停）
    this._interval = setInterval(() => this._tick(), 200);
    this.emit('state');
  }

  pause() {
    if (!this.running) return;
    this._sync();               // 注意：不能呼叫 _tick()，它結束時會再叫 pause() 造成無限遞迴
    this.running = false;
    this._anchorElapsed = this.elapsed;
    cancelAnimationFrame(this._raf);
    clearInterval(this._interval);
    this._raf = this._interval = null;
    this.emit('state');
  }

  toggle() {
    this.running ? this.pause() : this.start();
  }

  reset() {
    this.pause();
    this.seek(0);
    this._lastSegIdx = -1;
    this.emit('state');
  }

  seek(t) {
    this.elapsed = Math.min(Math.max(0, t), this.total);
    this._anchor = performance.now();
    this._anchorElapsed = this.elapsed;
    this._lastWhole = -1;
    this.emit('tick', this.current());
  }

  /** 跳到下一段 / 上一段（上一段：先回到本段開頭，2 秒內再按才真的往前跳） */
  next() {
    const cur = this.current();
    if (!cur) return;
    const nextSeg = this.timeline.segments[cur.idx + 1];
    this.seek(nextSeg ? nextSeg.start : this.total);
    if (this.finished) this.pause();
    this.emit('state');
  }

  prev() {
    const cur = this.current();
    if (!cur) return;
    if (cur.segElapsed > 2 || cur.idx === 0) {
      this.seek(cur.seg.start);
    } else {
      this.seek(this.timeline.segments[cur.idx - 1].start);
    }
    this.emit('state');
  }

  _loop() {
    this._raf = requestAnimationFrame(() => {
      this._tick();
      if (this.running) this._loop();
    });
  }

  /** 依時間戳重算 elapsed */
  _sync() {
    if (!this.running) return;
    this.elapsed = Math.min(this.total, this._anchorElapsed + (performance.now() - this._anchor) / 1000);
  }

  _tick() {
    this._sync();
    const cur = this.current();
    if (!cur) return;

    // 換段事件
    if (cur.idx !== this._lastSegIdx) {
      const prevIdx = this._lastSegIdx;
      this._lastSegIdx = cur.idx;
      if (prevIdx !== -1 || this.running) this.emit('segment', cur);
    }

    // 每秒事件（給嗶聲用）
    const whole = Math.ceil(cur.remaining);
    if (this.running && whole !== this._lastWhole) {
      this._lastWhole = whole;
      this.emit('second', { ...cur, secondsLeft: whole });
    }

    this.emit('tick', cur);

    if (this.running && this.finished) {
      this.pause();
      this.emit('finish');
    }
  }
}
