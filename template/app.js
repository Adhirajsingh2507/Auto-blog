/* Global interactions: scroll reveal, live clock, nav state, custom cursor,
   magnetic elements. Home-specific bits (node graph, ⌘K) are inlined on the
   home page. Vanilla, no dependencies. */
(function () {
  var fine = matchMedia("(pointer: fine)").matches;
  var reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // scroll reveal
  var reveals = document.querySelectorAll(".reveal");
  if (reduce || !("IntersectionObserver" in window)) {
    reveals.forEach(function (el) { el.classList.add("is-in"); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); }
      });
    }, { threshold: 0, rootMargin: "0px 0px -10% 0px" });
    reveals.forEach(function (el) { io.observe(el); });
  }

  // nav gains a border once scrolled
  var nav = document.querySelector(".nav");
  if (nav) {
    var onScroll = function () { nav.classList.toggle("scrolled", window.scrollY > 20); };
    onScroll(); addEventListener("scroll", onScroll, { passive: true });
  }

  if (!fine || reduce) return; // no cursor / magnetic on touch or reduced motion

  // custom cursor: instant dot + trailing ring
  var dot = document.createElement("div"); dot.className = "cursor-dot";
  var ring = document.createElement("div"); ring.className = "cursor-ring";
  document.body.appendChild(dot); document.body.appendChild(ring);
  var mx = innerWidth / 2, my = innerHeight / 2, rx = mx, ry = my;
  addEventListener("pointermove", function (e) {
    mx = e.clientX; my = e.clientY;
    dot.style.transform = "translate(" + mx + "px," + my + "px)";
  });
  (function loop() {
    rx += (mx - rx) * 0.18; ry += (my - ry) * 0.18;
    ring.style.transform = "translate(" + rx + "px," + ry + "px)";
    requestAnimationFrame(loop);
  })();
  var HOT = "a,button,input,.magnetic,[data-cursor]";
  addEventListener("pointerover", function (e) { if (e.target.closest(HOT)) document.body.classList.add("cursor-hot"); });
  addEventListener("pointerout", function (e) { if (e.target.closest(HOT)) document.body.classList.remove("cursor-hot"); });

  // magnetic pull toward cursor
  document.querySelectorAll(".magnetic").forEach(function (el) {
    el.addEventListener("pointermove", function (e) {
      var r = el.getBoundingClientRect();
      var x = e.clientX - (r.left + r.width / 2), y = e.clientY - (r.top + r.height / 2);
      el.style.transform = "translate(" + x * 0.25 + "px," + y * 0.25 + "px)";
    });
    el.addEventListener("pointerleave", function () { el.style.transform = ""; });
  });
})();
