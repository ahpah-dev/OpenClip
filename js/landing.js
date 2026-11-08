// OpenClip landing page: entrance animations.
// - Headline: each word slides up out of a clipped line (staggered).
// - Everything else: fades up 24px as it scrolls into view.
(function () {
  var root = document.documentElement;
  if (!root.classList.contains('js')) return;
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) { root.classList.add('no-motion'); return; }

  // ----- headline word reveal -----
  var h = document.querySelector('.headline');
  if (h) {
    h.setAttribute('aria-label', h.textContent.replace(/\s+/g, ' ').trim());
    var line = document.createElement('span');
    line.className = 'hl';
    line.setAttribute('aria-hidden', 'true');
    var n = 0;
    var wrapWords = function (node, into) {
      Array.prototype.slice.call(node.childNodes).forEach(function (child) {
        if (child.nodeType === 3) {
          child.textContent.split(/(\s+)/).forEach(function (part) {
            if (!part) return;
            if (/^\s+$/.test(part)) { into.appendChild(document.createTextNode(' ')); return; }
            var w = document.createElement('span');
            w.className = 'hw';
            w.style.setProperty('--d', 120 + n++ * 80 + 'ms');
            w.textContent = part;
            into.appendChild(w);
          });
        } else if (child.nodeType === 1) {
          var clone = child.cloneNode(false);
          wrapWords(child, clone);
          into.appendChild(clone);
        }
      });
    };
    wrapWords(h, line);
    h.textContent = '';
    h.appendChild(line);
    h.classList.add('split');
  }

  // ----- fade-up reveals -----
  var groups = [
    { sel: '.home-pill', delay: 0, step: 0 },
    { sel: '.title-row, .hero .lead, .hero .facts-row, .hero .cta, .hero .note, .hero .steps', delay: 80, step: 90, base: 5 },
    { sel: '.shots figure', delay: 0, step: 0 },
    { sel: '.block .col, .foot .col', delay: 0, step: 0 }
  ];
  var els = [];
  groups.forEach(function (g) {
    Array.prototype.forEach.call(document.querySelectorAll(g.sel), function (el, i) {
      el.classList.add('reveal');
      if (g.step) el.style.setProperty('--d', (g.delay + (g.base || 0) * 0 + i * g.step + 380) + 'ms');
      els.push(el);
    });
  });
  if (h) els.push(h);

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      e.target.classList.add('in');
      io.unobserve(e.target);
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
  els.forEach(function (el) { io.observe(el); });
})();
