// 清單拖曳排序（課表清單、動作清單共用）
//
// 手機瀏覽器完全不會觸發 HTML5 的 draggable，所以用 Pointer Events 自己做。
// 只有握把能起始拖曳，清單項目其他地方的原本行為（點一下切換／展開）不受影響。
//
// 座標一律換算成「內容座標」= clientY + scrollTop。這樣拖到一半觸發自動捲動時，
// 起始那一刻量到的那組 rect 仍然可以直接拿來比對，不必重新量一次。

/**
 * @param {HTMLElement} list      直接子元素就是要排序的項目
 * @param {HTMLElement} scroller  外層會捲動的容器
 * @param {string} handle         握把的 CSS selector
 * @param {(from: number, to: number) => void} onDrop  順序真的改變時才會被呼叫
 */
export function initSortable({ list, scroller, handle, onDrop }) {
  let drag = null;

  list.addEventListener('pointerdown', (e) => {
    if (drag || e.button > 0) return;
    const grip = e.target.closest?.(handle);
    if (!grip || !list.contains(grip)) return;

    const items = [...list.children];
    const item = items.find((c) => c.contains(grip));
    const from = items.indexOf(item);
    if (from < 0 || items.length < 2) return;

    e.preventDefault();
    e.stopPropagation();

    const rects = items.map((c) => c.getBoundingClientRect());
    drag = {
      grip, item, items, rects, from,
      to: from,
      gap: rects.length > 1 ? Math.max(0, rects[1].top - rects[0].bottom) : 0,
      startY: e.clientY + scroller.scrollTop,
      clientY: e.clientY,
      pointerId: e.pointerId,
      raf: null,
      vel: 0,
    };

    try {
      grip.setPointerCapture(e.pointerId);
    } catch {
      // 沒有作用中的 pointer 就別硬做，不然會卡在「拖曳中」的狀態出不來
      drag = null;
      return;
    }
    item.classList.add('is-dragging');
    list.classList.add('is-reordering');
    document.body.classList.add('is-sorting');
  });

  list.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    e.preventDefault();
    drag.clientY = e.clientY;
    layout();
    autoScroll();
  });

  list.addEventListener('pointerup', end);
  list.addEventListener('pointercancel', end);

  // 放開手指時瀏覽器還是會補一個 click。握把上的 click 一律吃掉，
  // 否則拖完課表會順手把它切換掉、拖完動作會順手把卡片展開。
  list.addEventListener('click', (e) => {
    if (!e.target.closest?.(handle)) return;
    e.preventDefault();
    e.stopPropagation();
  }, true);

  /** 依目前位移算出落點，並把其他項目讓開 */
  function layout() {
    const { rects, from, gap, item, items } = drag;
    const dy = drag.clientY + scroller.scrollTop - drag.startY;
    item.style.transform = `translateY(${dy}px)`;

    const h = rects[from].height;
    const center = rects[from].top + h / 2 + dy;

    let to = from;
    for (let i = 0; i < rects.length; i++) {
      if (i === from) continue;
      const mid = rects[i].top + rects[i].height / 2;
      // 越過某個項目的中線才算換位，避免停在邊界上時抖動
      if (i < from && center < mid) to = Math.min(to, i);
      if (i > from && center > mid) to = Math.max(to, i);
    }
    drag.to = to;

    const shift = h + gap;
    items.forEach((c, i) => {
      if (i === from) return;
      let d = 0;
      if (to > from && i > from && i <= to) d = -shift;
      if (to < from && i >= to && i < from) d = shift;
      c.style.transform = d ? `translateY(${d}px)` : '';
    });
  }

  /** 拖到清單上下緣時自動捲動，長清單才拖得動 */
  function autoScroll() {
    const r = scroller.getBoundingClientRect();
    const EDGE = 56;
    let v = 0;
    if (drag.clientY < r.top + EDGE) v = -Math.ceil((r.top + EDGE - drag.clientY) / 5);
    else if (drag.clientY > r.bottom - EDGE) v = Math.ceil((drag.clientY - (r.bottom - EDGE)) / 5);

    drag.vel = v;
    if (!v) return stopAutoScroll();
    if (drag.raf) return;

    const step = () => {
      if (!drag || !drag.vel) return;
      const before = scroller.scrollTop;
      scroller.scrollTop = before + drag.vel;
      if (scroller.scrollTop !== before) layout();
      drag.raf = requestAnimationFrame(step);
    };
    drag.raf = requestAnimationFrame(step);
  }

  function stopAutoScroll() {
    if (drag?.raf) {
      cancelAnimationFrame(drag.raf);
      drag.raf = null;
    }
  }

  function end(e) {
    if (!drag || (e && e.pointerId !== drag.pointerId)) return;
    stopAutoScroll();

    const { items, item, from, to } = drag;
    items.forEach((c) => (c.style.transform = ''));
    item.classList.remove('is-dragging');
    list.classList.remove('is-reordering');
    document.body.classList.remove('is-sorting');
    drag = null;                 // 先把狀態收乾淨，onDrop 裡通常會整份重畫

    if (to !== from) onDrop(from, to);
  }
}
