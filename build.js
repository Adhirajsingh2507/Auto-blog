#!/usr/bin/env node
/*
 * Static blog builder. No dependencies.
 * Reads posts/<slug>/index.html (body-only), wraps each in the shared template,
 * and generates dist/ with a homepage listing every post.
 *
 * Per-post metadata: an HTML comment at the top of index.html, e.g.
 *   <!--
 *   title: My First Post
 *   date: 2026-08-09
 *   description: A short summary shown on the homepage card.
 *   -->
 * Missing title falls back to the first <h1>, then the folder name.
 */
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const POSTS_DIR = path.join(ROOT, "posts");
const DIST = path.join(ROOT, "dist");
const TEMPLATE_DIR = path.join(ROOT, "template");

const SITE_TITLE = "Adhiraj Singh";
const SITE_KICKER = "Notes, Ideas & Experiments";
const SITE_ROLE = "Engineer building systems that reason.";
const SITE_ABOUT =
  "I build small, deterministic systems around large, unreliable models — trust layers, local-first agents, and things that go faster by deleting the fancy parts. This is where I write it down.";
const SITE_LINKS = [
  { label: "GitHub", url: "https://github.com/Adhirajsingh2507" },
  { label: "LinkedIn", url: "https://www.linkedin.com/in/adhiraj-singh-39631b363/" },
  { label: "Instagram", url: "https://www.instagram.com/coding_andcoffee" },
  { label: "Mail", url: "mailto:techadhiraj07@gmail.com" },
];

// --- helpers ---------------------------------------------------------------
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );

function slugify(name) {
  const s = name
    .normalize("NFKD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "post";
}

function parseMeta(html) {
  const meta = {};
  const m = html.match(/<!--([\s\S]*?)-->/);
  if (m) {
    for (const line of m[1].split("\n")) {
      const kv = line.match(/^\s*(title|date|description)\s*:\s*(.+?)\s*$/i);
      if (kv) meta[kv[1].toLowerCase()] = kv[2];
    }
  }
  if (!meta.title) {
    const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (h1) meta.title = h1[1].replace(/<[^>]+>/g, "").trim();
  }
  if (!meta.title) {
    const md = html.match(/^\s*#\s+(.+?)\s*$/m); // markdown "# Title"
    if (md) meta.title = md[1].trim();
  }
  return meta;
}

// strip the leading <!-- metadata --> comment so it doesn't render
function stripMeta(src) {
  return src.replace(/^\s*<!--[\s\S]*?-->\s*/, "");
}

/* Minimal Markdown -> HTML. Covers common blog needs: headings, bold/italic,
 * inline code, links, images, blockquotes, ordered/unordered lists, code fences,
 * horizontal rules, paragraphs. HTML is escaped first (write raw HTML in .html files). */
function parseMarkdown(src) {
  const inline = (t) =>
    esc(t)
      .replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
      .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img src="$2" alt="$1">')
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");

  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let para = [], list = null, quote = [], fence = null;

  const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(" "))}</p>`); para = []; } };
  const flushList = () => { if (list) { out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.tag}>`); list = null; } };
  const flushQuote = () => { if (quote.length) { out.push(`<blockquote>${inline(quote.join(" "))}</blockquote>`); quote = []; } };
  const flushAll = () => { flushPara(); flushList(); flushQuote(); };

  for (const line of lines) {
    const fenceMatch = line.match(/^```(.*)$/);
    if (fence !== null) {
      if (fenceMatch) { out.push(`<pre><code>${esc(fence.join("\n"))}</code></pre>`); fence = null; }
      else fence.push(line);
      continue;
    }
    if (fenceMatch) { flushAll(); fence = []; continue; }

    if (/^\s*$/.test(line)) { flushAll(); continue; }
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) { flushAll(); out.push("<hr>"); continue; }

    const h = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (h) { flushAll(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue; }

    const q = line.match(/^\s*>\s?(.*)$/);
    if (q) { flushPara(); flushList(); quote.push(q[1]); continue; }

    const ul = line.match(/^\s*[-*+]\s+(.+)$/);
    const ol = line.match(/^\s*\d+\.\s+(.+)$/);
    if (ul || ol) {
      flushPara(); flushQuote();
      const tag = ul ? "ul" : "ol";
      if (!list || list.tag !== tag) { flushList(); list = { tag, items: [] }; }
      list.items.push((ul || ol)[1]);
      continue;
    }

    flushList(); flushQuote();
    para.push(line.trim());
  }
  if (fence !== null) out.push(`<pre><code>${esc(fence.join("\n"))}</code></pre>`);
  flushAll();
  return out.join("\n");
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function pageShell({ title, body, base, bodyClass, head = "" }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="${base}styles.css">
</head>
<body class="${bodyClass}">
${body}
${head}
<script src="${base}app.js" defer></script>
</body>
</html>`;
}

// --- build -----------------------------------------------------------------
module.exports = { parseMarkdown, parseMeta, slugify };
if (require.main !== module) return;

const isMail = (u) => u.startsWith("mailto:");
const extAttr = (u) => (isMail(u) ? "" : ' target="_blank" rel="noopener"');
const handleOf = (u) => (isMail(u) ? u.slice(7) : u.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""));

const footerHtml = `<footer class="site-footer"><div class="shell">
<nav class="footer-links">${SITE_LINKS.map(
  (l) => `<a href="${esc(l.url)}"${extAttr(l.url)}>${esc(l.label)}</a>`
).join('<span class="dot">·</span>')}</nav>
<span>&copy; ${new Date().getFullYear()} ${esc(SITE_TITLE)} · built from scratch</span>
</div></footer>`;

console.log("Building blog...");
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });
fs.copyFileSync(path.join(TEMPLATE_DIR, "styles.css"), path.join(DIST, "styles.css"));
fs.copyFileSync(path.join(TEMPLATE_DIR, "app.js"), path.join(DIST, "app.js"));
fs.copyFileSync(path.join(TEMPLATE_DIR, "sky.webm"), path.join(DIST, "sky.webm"));

const posts = [];
const usedSlugs = new Set();

const dirs = fs.existsSync(POSTS_DIR)
  ? fs.readdirSync(POSTS_DIR, { withFileTypes: true }).filter((e) => e.isDirectory())
  : [];

for (const dir of dirs) {
  const dirPath = path.join(POSTS_DIR, dir.name);
  // accept index.md or index.html (Markdown wins if both exist)
  const mdPath = path.join(dirPath, "index.md");
  const htmlPath = path.join(dirPath, "index.html");
  const isMd = fs.existsSync(mdPath);
  const srcPath = isMd ? mdPath : fs.existsSync(htmlPath) ? htmlPath : null;
  if (!srcPath) {
    console.warn(`  ! skipping "${dir.name}" (no index.md or index.html)`);
    continue;
  }
  let raw;
  try {
    raw = fs.readFileSync(srcPath, "utf8");
  } catch (e) {
    console.warn(`  ! skipping "${dir.name}" (unreadable: ${e.message})`);
    continue;
  }
  const meta = parseMeta(raw);
  const title = meta.title || dir.name;
  const bodyHtml = isMd ? parseMarkdown(stripMeta(raw)) : stripMeta(raw);

  let slug = slugify(dir.name);
  while (usedSlugs.has(slug)) slug += "-2";
  usedSlugs.add(slug);

  // copy the whole post folder (images/assets ride along), then overwrite index.html
  copyDir(dirPath, path.join(DIST, slug));
  fs.rmSync(path.join(DIST, slug, "index.md"), { force: true }); // don't ship the source

  const article = `<div class="bar">
<a class="brand" href="../index.html"><b>Adhiraj</b> Singh</a>
<a class="right" href="../index.html">← Index</a>
</div>
<main class="article">
<a class="back" href="../index.html">&larr; All writing</a>
<article class="reveal">
<header>
${meta.date ? `<time datetime="${esc(meta.date)}">${esc(meta.date)}</time>` : ""}
<h1>${esc(title)}</h1>
</header>
${bodyHtml}
</article>
</main>
${footerHtml}`;

  fs.writeFileSync(
    path.join(DIST, slug, "index.html"),
    pageShell({ title: `${title} — ${SITE_TITLE}`, body: article, base: "../", bodyClass: "post" })
  );

  posts.push({ slug, title, date: meta.date || "", description: meta.description || "" });
  console.log(`  ok  ${dir.name} -> /${slug}/`);
}

// newest first; posts without a date sink to the bottom
posts.sort((a, b) => (b.date || "").localeCompare(a.date || "") || a.title.localeCompare(b.title));

// --- home page: 5-scene cinematic reel --------------------------------------
const picks = posts.slice(0, 3);
const picksHtml = picks
  .map(
    (p, i) => `<a class="pick" href="./${p.slug}/index.html">
<span class="rank">0${i + 1}</span>
<span class="mid">
${p.date ? `<time datetime="${esc(p.date)}">${esc(p.date)}</time>` : ""}
<span class="pick-title">${esc(p.title)}</span>
</span>
<span class="go" aria-hidden="true">&#8599;</span>
</a>`
  )
  .join("\n");

// Three counters (Numbers scene) — drawn from the real writing.
const STATS = [
  { target: posts.length, suffix: "", label: "Essays published" },
  { target: 13, suffix: "×", label: "Biggest speedup shipped" },
  { target: 70, suffix: "B", label: "Largest model wrangled" },
];
const statsHtml = STATS.map(
  (s) => `<div class="stat">
<span class="num" data-target="${s.target}" data-suffix="${esc(s.suffix)}">0<span class="suf">${esc(s.suffix)}</span></span>
<span class="stat-label">${esc(s.label)}</span>
</div>`
).join("\n");

const chipsHtml = SITE_LINKS.map(
  (l) => `<a class="chip" href="${esc(l.url)}"${extAttr(l.url)}>${esc(l.label)}</a>`
).join("\n");

const home = `<div class="bar">
<a class="brand" href="#top"><b>Adhiraj</b> Singh</a>
<a class="right" href="#" data-skip>Writing &#8595;</a>
</div>
<div class="progress" id="progress"></div>

<div class="reel" id="reel">
<div class="stage">
<video id="sky" src="./sky.webm" autoplay muted loop playsinline aria-hidden="true"></video>
<div class="scenes">

<section class="scene scene-open" data-scene>
<div class="inner">
<p class="dive">Scroll to dive in</p>
<div class="dive-chevron"></div>
</div>
</section>

<section class="scene scene-title" data-scene>
<div class="inner">
<h1>Adhiraj<br>Singh</h1>
<p class="sub">Developers making future.</p>
</div>
</section>

<section class="scene scene-numbers" data-scene>
<div class="inner">
<p class="kicker sec-kicker">In numbers</p>
${statsHtml}
</div>
</section>

<section class="scene scene-picks" data-scene>
<div class="inner">
<p class="kicker sec-kicker">Top picks</p>
${picksHtml || '<p class="stat-label">No posts yet.</p>'}
</div>
</section>

<section class="scene scene-close" data-scene>
<div class="inner">
<p class="wordmark">Adhiraj Singh</p>
<p class="closing">Systems that reason — written down.</p>
<div class="channels">${chipsHtml}</div>
</div>
</section>

</div>
</div>
</div>`;

const homeScript = `<script>
(function () {
  var reel = document.getElementById('reel'), sky = document.getElementById('sky');
  if (!reel) return;
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var fallback = matchMedia('(max-width: 860px), (prefers-reduced-motion: reduce)').matches;
  var progress = 0;
  if (sky && reduce) { try { sky.pause(); } catch (e) {} }  // honor reduced motion

  // ----- scroll-scrubbed scenes -----
  if (fallback) return;                        // CSS shows scenes stacked; video plays as ambient bg
  var scenes = Array.prototype.slice.call(document.querySelectorAll('[data-scene]'));
  var bar = document.getElementById('progress');
  // [fadeInStart, fadeInEnd, fadeOutStart, fadeOutEnd] over reel progress 0..1
  var RANGES = [
    [-1, -1, 0.06, 0.12],   // open
    [0.10, 0.17, 0.28, 0.34], // title
    [0.34, 0.41, 0.56, 0.62], // numbers
    [0.62, 0.69, 0.82, 0.88], // picks
    [0.88, 0.93, 2, 2]        // close
  ];
  function ramp(p, a, b) { if (a === b) return p >= b ? 1 : 0; return Math.max(0, Math.min(1, (p-a)/(b-a))); }
  function smooth(t) { return t*t*(3-2*t); }
  var counted = false;
  function tick() {
    var top = reel.offsetTop, span = reel.offsetHeight - window.innerHeight;
    progress = span > 0 ? Math.max(0, Math.min(1, (window.scrollY - top) / span)) : 0;
    if (bar) bar.style.width = (progress*100) + '%';
    if (sky) sky.style.transform = 'scale(' + (1 + progress*0.32).toFixed(3) + ')';  // camera dives into the sky
    for (var i=0;i<scenes.length;i++) {
      var r = RANGES[i];
      var op = smooth(ramp(progress, r[0], r[1])) * (1 - smooth(ramp(progress, r[2], r[3])));
      var mid = (r[1] + r[2]) / 2, d = progress - mid;
      var el = scenes[i];
      el.style.opacity = op.toFixed(3);
      el.style.transform = 'translateY(' + (-d*90).toFixed(1) + 'px) scale(' + (1 - d*0.18).toFixed(3) + ')';
      el.style.pointerEvents = op > 0.5 ? 'auto' : 'none';
    }
    if (!counted && progress > 0.37) { counted = true; runCount(); }
    if (counted && progress < 0.30) counted = false; // allow replay on scroll back up
  }
  function runCount() {
    document.querySelectorAll('.scene-numbers .num').forEach(function (el) {
      var target = +el.getAttribute('data-target'), suf = el.getAttribute('data-suffix') || '', t0 = performance.now(), dur = 1300;
      (function step(now){
        var t = Math.min(1, (now - t0)/dur), val = Math.round(target * (1 - Math.pow(1-t, 3)));
        el.innerHTML = val + '<span class="suf">' + suf + '</span>';
        if (t < 1) requestAnimationFrame(step);
      })(t0);
    });
  }
  addEventListener('scroll', tick, { passive: true });
  addEventListener('resize', tick);
  var skip = document.querySelector('[data-skip]');
  if (skip) skip.addEventListener('click', function (e) { e.preventDefault(); window.scrollTo({ top: reel.offsetTop + (reel.offsetHeight - window.innerHeight) * 0.72, behavior: 'smooth' }); });
  tick();
})();
</script>`;

fs.writeFileSync(
  path.join(DIST, "index.html"),
  pageShell({ title: SITE_TITLE, body: home, base: "./", bodyClass: "home", head: homeScript })
);

console.log(`Done. ${posts.length} post(s) -> dist/`);
