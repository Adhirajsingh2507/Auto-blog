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
const SITE_TAGLINE =
  "Thoughts on technology, AI, building things, and everything I’m learning along the way.";
const SITE_LINKS = [
  { label: "GitHub", url: "https://github.com/Adhirajsingh2507" },
  { label: "LinkedIn", url: "https://www.linkedin.com/in/adhiraj-singh-39631b363/" },
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
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&display=swap">
<link rel="stylesheet" href="${cssPath}">
</head>
<body class="${bodyClass}">
${body}
<script>
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
  }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
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

// deterministic "scatter": cycle through size + vertical-offset variants by index
const SIZE = ["s-lg", "", "s-sm", "", "s-lg", "s-sm"];
const OFF = ["", "off-2", "off-1", "off-3", "off-1", ""];

const tiles = posts
  .map((p, i) => {
    const cls = ["tile", "reveal", SIZE[i % SIZE.length], OFF[i % OFF.length]].filter(Boolean).join(" ");
    const num = String(i + 1).padStart(2, "0");
    const delay = (i % 3) * 90; // light stagger within each row
    return `<a class="${cls}" style="--d:${delay}ms" href="./${p.slug}/index.html">
<span class="num">[${num}]</span>
<h2 class="tile-title">${esc(p.title)}</h2>
${p.date ? `<time datetime="${esc(p.date)}">${esc(p.date)}</time>` : ""}
${p.description ? `<p>${esc(p.description)}</p>` : ""}
</a>`;
  })
  .join("\n");

const home = `<header class="site-header reveal is-in"><div class="wrap">
<p class="kicker">${esc(SITE_KICKER)}</p>
<h1>${esc(SITE_TITLE)}</h1>
<p>${esc(SITE_TAGLINE)}</p>
</div></header>
<main class="wrap">
${posts.length ? `<div class="gallery">\n${tiles}\n</div>` : `<p class="empty">No posts yet — add a folder in posts/ with an index.md or index.html.</p>`}
</main>
${footerHtml}`;

fs.writeFileSync(
  path.join(DIST, "index.html"),
  pageShell({ title: SITE_TITLE, body: home, cssPath: "./styles.css", bodyClass: "home" })
);

console.log(`Done. ${posts.length} post(s) -> dist/`);
