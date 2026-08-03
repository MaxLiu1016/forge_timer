// 資料層：課表 / 設定的讀寫（localStorage）
const KEY_DATA = 'forge.data.v1';
const KEY_PREFS = 'forge.prefs.v1';

const uid = () => Math.random().toString(36).slice(2, 10);

/**
 * Workout {
 *   id, name,
 *   prepareSec        開始前準備秒數
 *   rounds            整份動作清單重複幾輪
 *   roundRestSec      每輪之間的休息秒數
 *   skipLastRest      最後一個動作後是否略過休息
 *   exercises: [{ id, name, desc, workSec, restSec }]
 * }
 */
function defaultData() {
  return {
    activeId: 'w_classic',
    workouts: [
      {
        id: 'w_classic',
        name: '經典 Tabata',
        prepareSec: 10,
        rounds: 8,
        roundRestSec: 0,
        skipLastRest: false,
        exercises: [
          { id: uid(), name: '全力衝刺', desc: '20 秒全力，維持動作品質', workSec: 20, restSec: 10 },
        ],
      },
      {
        id: 'w_hiit',
        name: '全身 HIIT 循環',
        prepareSec: 15,
        rounds: 3,
        roundRestSec: 60,
        skipLastRest: true,
        exercises: [
          { id: uid(), name: '波比跳', desc: '下蹲—撐地—跳起，核心收緊', workSec: 40, restSec: 20 },
          { id: uid(), name: '深蹲', desc: '膝蓋對齊腳尖，臀部向後坐', workSec: 40, restSec: 20 },
          { id: uid(), name: '登山者', desc: '肩膀在手腕正上方，收緊腹部', workSec: 40, restSec: 20 },
          { id: uid(), name: '棒式', desc: '身體成一直線，不要塌腰', workSec: 40, restSec: 20 },
        ],
      },
    ],
  };
}

function defaultPrefs() {
  return {
    sound: true,        // 嗶聲提示
    vibrate: true,      // 震動提示
    voice: false,       // 語音報動作名稱
    keepAwake: true,    // 螢幕恆亮
    theme: 'dark',
  };
}

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback();
    return { ...fallback(), ...JSON.parse(raw) };
  } catch {
    return fallback();
  }
}

export const store = {
  data: read(KEY_DATA, defaultData),
  prefs: read(KEY_PREFS, defaultPrefs),

  saveData() {
    localStorage.setItem(KEY_DATA, JSON.stringify(this.data));
  },
  savePrefs() {
    localStorage.setItem(KEY_PREFS, JSON.stringify(this.prefs));
  },

  activeWorkout() {
    return this.data.workouts.find((w) => w.id === this.data.activeId) || this.data.workouts[0];
  },
  setActive(id) {
    this.data.activeId = id;
    this.saveData();
  },
  addWorkout() {
    const w = {
      id: 'w_' + uid(),
      name: '新課表',
      prepareSec: 10,
      rounds: 1,
      roundRestSec: 30,
      skipLastRest: true,
      exercises: [{ id: uid(), name: '動作 1', desc: '', workSec: 30, restSec: 15 }],
    };
    this.data.workouts.push(w);
    this.data.activeId = w.id;
    this.saveData();
    return w;
  },
  duplicateWorkout(id) {
    const src = this.data.workouts.find((w) => w.id === id);
    if (!src) return null;
    const copy = structuredClone(src);
    copy.id = 'w_' + uid();
    copy.name = src.name + ' 複本';
    copy.exercises.forEach((e) => (e.id = uid()));
    this.data.workouts.push(copy);
    this.data.activeId = copy.id;
    this.saveData();
    return copy;
  },
  removeWorkout(id) {
    if (this.data.workouts.length <= 1) return false;
    this.data.workouts = this.data.workouts.filter((w) => w.id !== id);
    if (this.data.activeId === id) this.data.activeId = this.data.workouts[0].id;
    this.saveData();
    return true;
  },
  addExercise(workout) {
    const last = workout.exercises[workout.exercises.length - 1];
    workout.exercises.push({
      id: uid(),
      name: `動作 ${workout.exercises.length + 1}`,
      desc: '',
      workSec: last ? last.workSec : 30,
      restSec: last ? last.restSec : 15,
    });
    this.saveData();
  },
  removeExercise(workout, exId) {
    if (workout.exercises.length <= 1) return false;
    workout.exercises = workout.exercises.filter((e) => e.id !== exId);
    this.saveData();
    return true;
  },
  moveExercise(workout, from, to) {
    if (to < 0 || to >= workout.exercises.length) return;
    const [item] = workout.exercises.splice(from, 1);
    workout.exercises.splice(to, 0, item);
    this.saveData();
  },

  exportJSON() {
    return JSON.stringify({ data: this.data, prefs: this.prefs }, null, 2);
  },
  importJSON(text) {
    const parsed = JSON.parse(text);
    if (!parsed?.data?.workouts?.length) throw new Error('格式不符：找不到 workouts');
    this.data = { ...defaultData(), ...parsed.data };
    if (parsed.prefs) this.prefs = { ...defaultPrefs(), ...parsed.prefs };
    this.saveData();
    this.savePrefs();
  },
  resetAll() {
    this.data = defaultData();
    this.prefs = defaultPrefs();
    this.saveData();
    this.savePrefs();
  },
};

export { uid };
