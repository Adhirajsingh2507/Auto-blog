/* Scroll reveal for post pages and the reduced-motion/mobile fallback.
   The home reel has its own inline controller. Vanilla, no dependencies. */
(function () {
  var reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  var els = document.querySelectorAll(".reveal");
  if (reduce || !("IntersectionObserver" in window)) {
    els.forEach(function (el) { el.classList.add("is-in"); });
    return;
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); }
    });
  }, { threshold: 0, rootMargin: "0px 0px -10% 0px" });
  els.forEach(function (el) { io.observe(el); });
})();
