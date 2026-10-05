/*
 * Flip scroll: the page moves one full section at a time (mouse wheel,
 * keyboard, dots on the right). The content of a section flips in when
 * it becomes visible. On touch devices the normal scrolling is kept and
 * only snaps to the sections, so long sections can still be read.
 */
(function () {
  var sections = Array.from(document.querySelectorAll(".flip-section"));
  if (sections.length < 2) return;

  document.documentElement.classList.add("flip-scroll");

  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var finePointer = window.matchMedia("(pointer: fine)").matches;
  var locked = false;

  /* ---------- Dots ---------- */
  var nav = document.createElement("nav");
  nav.className = "flip-dots";
  nav.setAttribute("aria-label", "Sections");
  var dots = sections.map((section, index) => {
    var dot = document.createElement("button");
    dot.type = "button";
    dot.className = "flip-dot";
    dot.title = section.dataset.title || "Section " + (index + 1);
    dot.setAttribute("aria-label", dot.title);
    dot.addEventListener("click", () => goTo(index));
    nav.appendChild(dot);
    return dot;
  });
  document.body.appendChild(nav);

  // "Scroll down" buttons
  document.querySelectorAll("[data-flip-next]").forEach((button) => {
    button.addEventListener("click", () => goTo(currentIndex() + 1));
  });

  /* ---------- Active section + flip-in animation ---------- */
  var observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) entry.target.classList.add("in-view");
        else if (entry.intersectionRatio == 0) entry.target.classList.remove("in-view");
      });
      updateDots();
    },
    { threshold: [0, 0.35, 0.6] },
  );
  sections.forEach((section) => observer.observe(section));

  function currentIndex() {
    // The section that covers the middle of the screen
    var middle = window.innerHeight / 2;
    var index = sections.findIndex((section) => {
      var rect = section.getBoundingClientRect();
      return rect.top <= middle && rect.bottom > middle;
    });
    return index < 0 ? 0 : index;
  }

  function updateDots() {
    var index = currentIndex();
    dots.forEach((dot, i) => {
      dot.classList.toggle("active", i == index);
      dot.setAttribute("aria-current", i == index ? "true" : "false");
    });
  }

  window.addEventListener("scroll", updateDots, { passive: true });

  function goTo(index) {
    if (index < 0 || index >= sections.length) return;
    locked = true;
    sections[index].scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
    setTimeout(() => (locked = false), 900);
  }

  // Is there an element under the mouse that can still scroll in this direction?
  function canScrollInside(element, down) {
    for (var node = element; node && node != document.body; node = node.parentElement) {
      var style = getComputedStyle(node);
      if (!/(auto|scroll)/.test(style.overflowY) || node.scrollHeight <= node.clientHeight + 1) continue;
      if (down && node.scrollTop + node.clientHeight < node.scrollHeight - 1) return true;
      if (!down && node.scrollTop > 0) return true;
    }
    return false;
  }

  /* ---------- Mouse wheel (desktop) ---------- */
  if (finePointer) {
    window.addEventListener(
      "wheel",
      (event) => {
        if (event.ctrlKey || Math.abs(event.deltaY) < 4) return;
        // Scrollable areas inside the page (e.g. the scoreboard list) scroll first
        if (canScrollInside(event.target, event.deltaY > 0)) return;

        var index = currentIndex();
        var rect = sections[index].getBoundingClientRect();
        var down = event.deltaY > 0;

        // Sections that are taller than the screen are scrolled normally until their end
        if (down && rect.bottom > window.innerHeight + 2) return;
        if (!down && rect.top < -2) return;

        event.preventDefault();
        if (!locked) goTo(index + (down ? 1 : -1));
      },
      { passive: false },
    );
  }

  /* ---------- Keyboard ---------- */
  document.addEventListener("keydown", (event) => {
    var target = event.target;
    if (target.closest && target.closest("input, textarea, select, [contenteditable]")) return;

    var next = ["PageDown", "ArrowDown", " "].includes(event.key) && !event.shiftKey;
    var previous = event.key == "PageUp" || event.key == "ArrowUp" || (event.key == " " && event.shiftKey);
    if (!next && !previous) return;

    var index = currentIndex();
    var rect = sections[index].getBoundingClientRect();
    if (next && rect.bottom > window.innerHeight + 2) return;
    if (previous && rect.top < -2) return;

    event.preventDefault();
    if (!locked) goTo(index + (next ? 1 : -1));
  });

  updateDots();
})();
