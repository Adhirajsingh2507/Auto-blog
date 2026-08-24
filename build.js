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

function pageShell({ title, body, cssPath, bodyClass }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght,SOFT@0,9..144,300..500,0..100;1,9..144,300..500,0..100&family=IBM+Plex+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="${cssPath}">
</head>
<body class="${bodyClass}">
${body}
<script>
/* Spatial canvas: drag/wheel pan + depth parallax + live clock.
   Runs only on the home page with a fine pointer and motion allowed;
   otherwise the CSS fallback shows a static stacked column. */
(function () {
  var canvas = document.getElementById('canvas');
  if (!canvas) return;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var coarse = window.matchMedia('(max-width: 820px), (pointer: coarse)').matches;

  // live UTC clock (runs regardless of layout mode)
  var clock = document.getElementById('clock');
  if (clock) {
    var tick = function () {
      clock.textContent = new Date().toISOString().slice(11, 19) + ' UTC';
    };
    tick(); setInterval(tick, 1000);
  }

  if (reduce || coarse) return; // static fallback owns layout

  var cards = document.getElementById('cards');
  var W = 2000, H = 1400;
  // clamp pan so the field always covers the viewport
  var panX, panY;
  function clamp() {
    var minX = window.innerWidth - W, minY = window.innerHeight - H;
    panX = Math.min(0, Math.max(minX, panX));
    panY = Math.min(0, Math.max(minY, panY));
  }
  function apply() {
    cards.style.setProperty('--pan-x', panX + 'px');
    cards.style.setProperty('--pan-y', panY + 'px');
  }
  // start centered on the identity card
  var id = cards.querySelector('.card--id');
  var cx = id ? parseFloat(id.style.getPropertyValue('--x')) + 230 : W / 2;
  var cy = id ? parseFloat(id.style.getPropertyValue('--y')) + 120 : H / 2;
  panX = window.innerWidth / 2 - cx;
  panY = window.innerHeight / 2 - cy;
  clamp(); apply();

  // staggered entrance (IntersectionObserver reveal can't see off-viewport cards)
  var all = cards.querySelectorAll('.card');
  all.forEach(function (el, i) { setTimeout(function () { el.classList.add('is-in'); }, 80 + i * 70); });

  // drag to pan
  var dragging = false, sx = 0, sy = 0, px = 0, py = 0, moved = false;
  canvas.addEventListener('pointerdown', function (e) {
    dragging = true; moved = false; sx = e.clientX; sy = e.clientY; px = panX; py = panY;
    canvas.classList.add('dragging'); canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    var dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
    panX = px + dx; panY = py + dy; clamp(); apply();
  });
  var endDrag = function () { dragging = false; canvas.classList.remove('dragging'); };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  // suppress the click that follows a drag so cards don't navigate on release
  canvas.addEventListener('click', function (e) { if (moved) { e.preventDefault(); e.stopPropagation(); } }, true);

  // two-finger / wheel scroll pans
  canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    panX -= e.deltaX; panY -= e.deltaY; clamp(); apply();
  }, { passive: false });

  window.addEventListener('resize', function () { clamp(); apply(); });
})();
(function () {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var targets = document.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window) || !targets.length) {
    targets.forEach(function (el) { el.classList.add('is-in'); });
    return;
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
    });
  }, { threshold: 0, rootMargin: '0px 0px -8% 0px' });
  targets.forEach(function (el) { io.observe(el); });
})();
</script>
</body>
</html>`;
}

// --- build -----------------------------------------------------------------
module.exports = { parseMarkdown, parseMeta, slugify };
if (require.main !== module) return;

const linksHtml = SITE_LINKS.map(
  (l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`
).join('<span class="dot">·</span>');
const footerHtml = `<footer class="site-footer"><div class="wrap">
${linksHtml ? `<nav class="footer-links">${linksHtml}</nav>` : ""}
<p class="footer-copy">&copy; ${new Date().getFullYear()} ${esc(SITE_TITLE)}</p>
</div></footer>`;

console.log("Building blog...");
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });
fs.copyFileSync(path.join(TEMPLATE_DIR, "styles.css"), path.join(DIST, "styles.css"));

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

  const article = `<main class="wrap article">
<a class="back" href="../index.html">&larr; All posts</a>
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
    pageShell({ title: `${title} — ${SITE_TITLE}`, body: article, cssPath: "../styles.css", bodyClass: "post" })
  );

  posts.push({ slug, title, date: meta.date || "", description: meta.description || "" });
  console.log(`  ok  ${dir.name} -> /${slug}/`);
}

// newest first; posts without a date sink to the bottom
posts.sort((a, b) => (b.date || "").localeCompare(a.date || "") || a.title.localeCompare(b.title));

// deterministic card placement on the 2000x1400 canvas (see styles.css .cards).
// {x,y}=top-left px, z=parallax depth (± drift on pan), r=rotation.
const pos = (x, y, z, r) => `--x:${x};--y:${y};--z:${z};--r:${r}deg`;
const POST_POS = [
  [720, 170, 0.10, 2], [1200, 120, -0.08, -2.5], [1540, 480, 0.13, 1.5],
  [1180, 770, -0.06, -2], [300, 980, 0.09, 2.5], [760, 840, -0.11, -1.5],
];

const postCards = posts
  .map((p, i) => {
    const [x, y, z, r] = POST_POS[i % POST_POS.length];
    const num = String(i + 1).padStart(2, "0");
    return `<a class="card card--post reveal" style="${pos(x, y, z, r)};--d:${(i % 3) * 80}ms" href="./${p.slug}/index.html">
<div class="card-inner">
<span class="num">[${num}]</span>
${p.date ? `<time datetime="${esc(p.date)}">${esc(p.date)}</time>` : ""}
<h2>${esc(p.title)}</h2>
${p.description ? `<p>${esc(p.description)}</p>` : ""}
</div></a>`;
  })
  .join("\n");

const channelsHtml = SITE_LINKS.map(
  (l, i) =>
    `<li><a class="channel" href="${esc(l.url)}"${l.url.startsWith("mailto:") ? "" : ' target="_blank" rel="noopener"'}>
<span class="idx mono">${String(i + 1).padStart(2, "0")}</span>${esc(l.label)}<span class="arrow">↗</span></a></li>`
).join("\n");

const idCard = `<section class="card card--id reveal" style="${pos(140, 500, 0.03, -2)}">
<div class="card-inner">
<p class="eyebrow">${esc(SITE_KICKER)} · Est. 2026</p>
<h1>Adhiraj<br>Singh</h1>
<p class="role">${esc(SITE_ROLE)}</p>
</div></section>`;

const aboutCard = `<section class="card card--about reveal" style="${pos(700, 610, -0.05, 1.5)}">
<div class="card-inner">
<span class="tag">// about</span>
<p>${esc(SITE_ABOUT)}</p>
</div></section>`;

const contactCard = `<section class="card card--contact reveal" style="${pos(1200, 1050, 0.07, -2)}">
<div class="card-inner">
<span class="tag">// channels</span>
<ul>${channelsHtml}</ul>
</div></section>`;

const home = `<div class="hud">
<span class="hud-name">${esc(SITE_TITLE)}</span>
<span class="hud-clock mono" id="clock">--:--:-- UTC</span>
<span class="hud-hint">drag to explore</span>
</div>
<div class="canvas" id="canvas" role="region" aria-label="Site index — drag to explore">
<div class="cards" id="cards">
${idCard}
${postCards}
${aboutCard}
${contactCard}
</div>
</div>
${footerHtml}`;

fs.writeFileSync(
  path.join(DIST, "index.html"),
  pageShell({ title: SITE_TITLE, body: home, cssPath: "./styles.css", bodyClass: "home" })
);

console.log(`Done. ${posts.length} post(s) -> dist/`);
