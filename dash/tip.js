// Tooltips that work in the small corner window. Native `title` tooltips never show in a frameless,
// transparent, unfocused window, so anything with a `data-tip` attribute gets a real DOM tooltip.
//   Tip.attach();            // once per page; uses event delegation, so dynamic elements work
//   el.dataset.tip = 'line one\nline two';
(function () {
  const DELAY_MS = 220;     // a short pause before the first tooltip, none while moving between targets
  const MARGIN = 4;
  let box = null, timer = null, current = null, shownOnce = false;

  function ensure() {
    if (box) return box;
    box = document.createElement('div');
    box.className = 'tip';
    document.body.append(box);
    return box;
  }

  function place(target) {
    const b = ensure();
    const r = target.getBoundingClientRect();
    const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
    b.style.maxWidth = `${Math.max(120, vw - 2 * MARGIN)}px`;
    b.style.left = '0px'; b.style.top = '0px';
    const w = b.offsetWidth, h = b.offsetHeight;
    // Prefer below the target; use whichever side has more room, and clamp inside the window.
    const below = vh - r.bottom - MARGIN, above = r.top - MARGIN;
    const placeBelow = below >= h || below >= above;
    let top = placeBelow ? r.bottom + MARGIN : r.top - h - MARGIN;
    top = Math.max(MARGIN, Math.min(top, vh - h - MARGIN));
    let left = r.left + r.width / 2 - w / 2;
    left = Math.max(MARGIN, Math.min(left, vw - w - MARGIN));
    b.style.left = `${Math.round(left)}px`;
    b.style.top = `${Math.round(top)}px`;
  }

  function show(target) {
    const text = target.dataset.tip;
    if (!text) return;
    const b = ensure();
    b.replaceChildren(...text.split('\n').map((line, i) => {
      const d = document.createElement('div');
      d.className = i === 0 ? 'tip-head' : 'tip-line';
      d.textContent = line;
      return d;
    }));
    b.classList.add('on');
    place(target);
    shownOnce = true;
  }

  function hide() {
    clearTimeout(timer);
    timer = null;
    current = null;
    if (box) box.classList.remove('on');
  }

  function attach(root = document) {
    root.addEventListener('pointerover', (e) => {
      const t = e.target.closest ? e.target.closest('[data-tip]') : null;
      if (!t || t === current) return;
      current = t;
      clearTimeout(timer);
      if (shownOnce && box && box.classList.contains('on')) show(t);   // already open: switch immediately
      else timer = setTimeout(() => { if (current === t && document.contains(t)) show(t); }, DELAY_MS);
    });
    root.addEventListener('pointerout', (e) => {
      const t = e.target.closest ? e.target.closest('[data-tip]') : null;
      if (t && !t.contains(e.relatedTarget)) hide();
    });
    root.addEventListener('pointerdown', hide, true);
    window.addEventListener('blur', hide);
    document.addEventListener('scroll', hide, true);
  }

  window.Tip = { attach, hide };
})();
