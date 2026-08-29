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
const SITE_URL = "https://adhiraj-blog-ivory.vercel.app";
const SITE_DESC =
  "Adhiraj Singh — developer building deterministic systems around large, unreliable models. Essays on LLM trust layers, local-first agents, and going faster by deleting the fancy parts.";
// dark galaxy-dot favicon, inline so there's no extra request
const FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%23161826'/%3E%3Ccircle cx='16' cy='16' r='9' fill='none' stroke='%239184d9' stroke-width='1.4' opacity='.6'/%3E%3Ccircle cx='16' cy='16' r='3.4' fill='%239184d9'/%3E%3C/svg%3E";

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

function pageShell({ title, body, base, bodyClass, head = "", desc = SITE_DESC }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="theme-color" content="#161826">
<link rel="icon" href="${FAVICON}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${SITE_URL}/poster.jpg">
<meta name="twitter:card" content="summary_large_image">
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
for (let i = 0; i < 5; i++)
  fs.copyFileSync(path.join(TEMPLATE_DIR, `clip${i}.webm`), path.join(DIST, `clip${i}.webm`));
fs.copyFileSync(path.join(TEMPLATE_DIR, "poster.jpg"), path.join(DIST, "poster.jpg"));
fs.copyFileSync(path.join(TEMPLATE_DIR, "mob.webm"), path.join(DIST, "mob.webm"));           // lightweight mobile sky
fs.copyFileSync(path.join(TEMPLATE_DIR, "mob-poster.jpg"), path.join(DIST, "mob-poster.jpg"));

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
<a class="brand magnetic" href="../index.html"><b>Adhiraj</b> Singh</a>
<a class="right magnetic" href="../index.html">← Index</a>
</div>
<main class="article">
<a class="back magnetic" href="../index.html">&larr; All writing</a>
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
    pageShell({ title: `${title} — ${SITE_TITLE}`, body: article, base: "../", bodyClass: "post", desc: meta.description || SITE_DESC })
  );

  posts.push({ slug, title, date: meta.date || "", description: meta.description || "" });
  console.log(`  ok  ${dir.name} -> /${slug}/`);
}

// newest first; posts without a date sink to the bottom
posts.sort((a, b) => (b.date || "").localeCompare(a.date || "") || a.title.localeCompare(b.title));

// --- home page: faithful port of the Nocturne "State of the Gallery" dive ----
const picks = posts.slice(0, 3);
// Honest stats (the design ships placeholder demo numbers; these are real).
const STATS = [
  { target: posts.length, suffix: "", dec: 0, label: "essays published" },
  { target: 13, suffix: "×", dec: 0, label: "biggest speedup" },
  { target: 70, suffix: "B", dec: 0, label: "largest model" },
];
const chipsHtml = SITE_LINKS.map(
  (l) => `<a href="${esc(l.url)}"${extAttr(l.url)}>${esc(l.label)}</a>`
).join("\n");
const clipsHtml = [0, 1, 2, 3, 4]
  .map((i) => `<video class="clip" data-i="${i}" src="./clip${i}.webm" muted loop playsinline preload="${i === 0 ? "auto" : "none"}"${i === 0 ? ' poster="./poster.jpg" style="opacity:.55"' : ""} aria-hidden="true"></video>`)
  .join("\n");
const numBlocksHtml = STATS.map(
  (s, i) => `<div class="block b-num" data-target="${s.target}" data-dec="${s.dec}" data-suffix="${esc(s.suffix)}">
<div class="col"><div class="row"><div class="dot"></div><div class="k kicker">0${i + 1} / ${esc(s.label)}</div></div>
<div class="val">0${esc(s.suffix)}</div></div></div>`
).join("\n");
const pickRowsHtml = picks
  .map(
    (p, i) => `<a class="pick" href="./${p.slug}/index.html">
<span class="p-rank">0${i + 1}</span>
<span class="p-name">${esc(p.title)}</span>
<span class="p-desc">${esc(p.date || "")}</span></a>`
  )
  .join("\n");

const home = `<div class="intro" id="intro" aria-hidden="true"></div>
<div class="grain" aria-hidden="true"></div>
<div class="reel" id="reel">
<div class="stage"><div class="frame" id="frame">

<div class="sky" id="sky">
<div class="nebula"></div>
${clipsHtml}
</div>
<div class="sky-vignette"></div>
<div class="scrim" id="scrim"></div>
<div class="close-scrim" id="closeScrim"></div>

<div class="world">
<div class="starfield" id="starfield"></div>

<div class="block b-open" id="bOpen"><div class="col">
<div class="k kicker">scroll to dive in</div>
<div class="line" id="openLine"></div>
</div></div>

<div class="block b-title" id="bTitle"><div class="col">
<div class="ey" id="titleEy"><div class="dash" id="titleDash"></div><div class="k kicker">${esc(SITE_KICKER)} · 2026</div></div>
<div class="name" id="titleName">Adhiraj Singh</div>
<div class="sub" id="titleSub">Developers making future</div>
</div></div>

${numBlocksHtml}

<div class="block b-picks" id="bPicks"><div class="col">
<div class="k kicker">selected writing</div>
${pickRowsHtml || '<div class="p-desc">No posts yet.</div>'}
</div></div>

<div class="block b-close" id="bClose"><div class="col">
<div class="cname" id="closeName">Adhiraj Singh</div>
<div class="line" id="closeLine"></div>
<div class="k kicker" id="closeKick">developers making future</div>
<div class="close-channels" id="closeChannels">
${SITE_LINKS.map((l) => `<a class="cbtn magnetic" href="${esc(l.url)}"${extAttr(l.url)}>${esc(l.label)}</a>`).join("\n")}
</div>
</div></div>
</div>

<div class="chrome chrome-l">adhiraj</div>
<div class="chrome chrome-r" id="chromeTime">00s / 41s</div>
<div class="chrome chrome-b"><div class="fill" id="chromeFill"></div></div>

</div></div>
</div>

<div class="fallback">
<div class="fb-hero">
<div class="fb-neb"></div>
<video src="./mob.webm" poster="./mob-poster.jpg" muted loop playsinline autoplay preload="auto" aria-hidden="true"></video>
<div class="fb-brand mono">Adhiraj Singh</div>
<div class="inner">
<p class="fb-eyebrow">${esc(SITE_KICKER)} · 2026</p>
<h1 class="name">Adhiraj Singh</h1>
<p class="sub">Developers making future</p>
<div class="fb-cue mono">Scroll <span>&#8595;</span></div>
</div>
</div>
<div class="fb-sec reveal"><p class="kicker">in numbers</p>
${STATS.map((s) => `<div class="fb-stat"><span class="n">${s.target}<span class="suf">${esc(s.suffix)}</span></span><span class="l">${esc(s.label)}</span></div>`).join("\n")}
</div>
<div class="fb-sec reveal"><p class="kicker">selected writing</p><div class="fb-list">
${picks.map((p, i) => `<a class="fb-pick" href="./${p.slug}/index.html"><span class="r">0${i + 1}</span><span class="fb-pt"><span class="t">${esc(p.title)}</span>${p.date ? `<time>${esc(p.date)}</time>` : ""}</span><span class="fb-go" aria-hidden="true">&#8599;</span></a>`).join("\n")}
</div></div>
<div class="fb-sec reveal"><p class="kicker">channels</p><div class="fb-chips">${chipsHtml}</div></div>
${footerHtml}
</div>`;

const homeScript = `<script>
(function () {
  var reel = document.getElementById('reel'), frame = document.getElementById('frame');
  if (!reel || !frame) return;
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var fallback = matchMedia('(max-width: 860px)').matches || reduce;

  function fit() { frame.style.setProperty('--s', Math.max(innerWidth/1920, innerHeight/1080)); }
  fit(); addEventListener('resize', fit);

  // page-load reveal (fade the intro out once ready — runs in all modes)
  function reveal(){ document.body.classList.add('loaded'); }
  if (document.readyState === 'complete') setTimeout(reveal, 220);
  else addEventListener('load', function(){ setTimeout(reveal, 220); });
  setTimeout(reveal, 2600);       // safety net

  if (fallback) {
    if (reduce) { [].forEach.call(document.querySelectorAll('video'), function (v) { try { v.pause(); } catch (e) {} }); }
    return;                       // CSS shows the stacked .fallback
  }

  // ---- math (ported from support.js) ----
  function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
  function mod(a,n){ return ((a%n)+n)%n; }
  var E = {
    outCubic:  function(t){ t-=1; return t*t*t+1; },
    outQuart:  function(t){ t-=1; return 1-t*t*t*t; },
    inOutSine: function(t){ return -(Math.cos(Math.PI*t)-1)/2; },
    outBack:   function(t){ var c1=1.70158, c3=c1+1; return 1+c3*Math.pow(t-1,3)+c1*Math.pow(t-1,2); }
  };
  function animate(from,to,start,end,ease){ return function(t){ if(t<=start)return from; if(t>=end)return to; return from+(to-from)*ease((t-start)/(end-start)); }; }
  function interp(input,output,ease){ ease=ease||function(x){return x;}; return function(t){ var n=input.length; if(t<=input[0])return output[0]; if(t>=input[n-1])return output[n-1]; for(var i=0;i<n-1;i++){ if(t>=input[i]&&t<=input[i+1]){ var sp=input[i+1]-input[i], l=sp===0?0:(t-input[i])/sp; return output[i]+(output[i+1]-output[i])*ease(l); } } return output[n-1]; }; }
  function enter(start,dur){ return animate(0,1,start,start+(dur||1.1),E.outCubic); }
  function drift(from,to,start,end){ return animate(from,to,start,end,E.inOutSine); }
  function pop(start,dur){ return animate(0,1,start,start+(dur||0.5),E.outBack); }
  function zFade(far,near){ return interp([far,far+380,near-500,near],[0,1,1,0]); }
  function zOpacity(zs,far,near){ far=(far===undefined?-900:far); near=(near===undefined?720:near); return clamp(zFade(far,near)(zs),0,1); }

  var CUES = { Title:6, Numbers:14, Picks:28, Close:36 }, TOTAL = 41, GALAXY = 0.6;
  var camZfn = interp(
    [0, CUES.Title-1.2, CUES.Title, CUES.Numbers-0.55, CUES.Numbers,
     CUES.Numbers+4.3, CUES.Numbers+8.0, CUES.Numbers+11.7,
     CUES.Picks, CUES.Picks+6.4, CUES.Close, TOTAL],
    [-320,-20,2140,2560,4920, 5320,5860,6420, 6960,7420,8760,9240], E.inOutSine);

  var sky=document.getElementById('sky'), scrim=document.getElementById('scrim'), closeScrim=document.getElementById('closeScrim');
  var vids=[].slice.call(document.querySelectorAll('.clip'));
  var clipsMeta=[ {from:-2,to:CUES.Title+1.8}, {from:CUES.Title-0.9,to:CUES.Numbers+1.4}, {from:CUES.Numbers,to:CUES.Picks+1.4}, {from:CUES.Picks,to:CUES.Close+1.4}, {from:CUES.Close-1.0,to:TOTAL+6} ];
  var chromeL=document.querySelector('.chrome-l'), chromeR=document.getElementById('chromeTime'), chromeB=document.querySelector('.chrome-b'), chromeFill=document.getElementById('chromeFill');
  var bOpen=document.getElementById('bOpen'), openLine=document.getElementById('openLine'), openCol=bOpen.querySelector('.col');
  var bTitle=document.getElementById('bTitle'), titleEy=document.getElementById('titleEy'), titleDash=document.getElementById('titleDash'), titleName=document.getElementById('titleName'), titleSub=document.getElementById('titleSub');
  var numBlocks=[].slice.call(document.querySelectorAll('.b-num'));
  var NUMPOS=[ {z:5180,x:-63,y:-270}, {z:5760,x:-63,y:10}, {z:6320,x:-63,y:300} ];
  var bPicks=document.getElementById('bPicks'), pickRows=[].slice.call(bPicks.querySelectorAll('.pick'));
  var bClose=document.getElementById('bClose'), closeName=document.getElementById('closeName'), closeLine=document.getElementById('closeLine'), closeKick=document.getElementById('closeKick'), closeChannels=document.getElementById('closeChannels');

  function rng(seed){ var s=seed; return function(){ s=(s*1103515245+12345)%2147483648; return s/2147483648; }; }
  var r=rng(7), STARDATA=[], starEls=[], sf=document.getElementById('starfield');
  for(var si=0;si<150;si++) STARDATA.push({ x:(r()-0.5)*3600, y:(r()-0.5)*2400, z:r()*2400, s:1+r()*2.4, a:0.25+r()*0.6, ph:r()*6.283, ts:0.6+r()*1.6 });
  STARDATA.forEach(function(d,i){ var el=document.createElement('div'); el.className='star'; el.style.width=el.style.height=d.s+'px'; el.style.background=(i%9===0)?'var(--accent)':'var(--neutral-300)'; sf.appendChild(el); starEls.push(el); });

  var camZ=0;
  function put(el,z,x,y,extra,far,near){ var zs=camZ-z, op=zOpacity(zs,far,near)*extra;
    if(op<=0.004){ el.style.opacity=0; el.style.visibility='hidden'; return; }
    el.style.visibility=''; el.style.opacity=op;
    el.style.transform='translate(-50%,-50%) translate3d('+x+'px,'+y+'px,'+zs+'px)'; }

  function render(T){
    camZ = camZfn(T);
    var now = performance.now() * 0.001;   // wall-clock for ambient twinkle
    var skyDown=animate(0,1,CUES.Title-0.8,CUES.Title+1.5,E.inOutSine)(T);
    var skyUp=animate(0,1,CUES.Close-0.9,CUES.Close+1.3,E.inOutSine)(T);
    sky.style.opacity=clamp(1-0.74*skyDown+0.74*skyUp,0.26,1);
    sky.style.transform='scale('+drift(1.06,1.3,0,TOTAL)(T)+')';
    for(var i=0;i<vids.length;i++){ var m=clipsMeta[i], op=clamp(enter(m.from,1.2)(T)-enter(m.to-1.2,1.2)(T),0,1), v=vids[i];
      v.style.opacity=op*0.94*GALAXY;
      if(op>0.02){ if(v.paused){ v.play().catch(function(){}); } } else if(!v.paused){ v.pause(); } }
    scrim.style.opacity=clamp(interp([0,CUES.Title,CUES.Numbers,CUES.Picks-1.4,CUES.Picks+1.2,TOTAL-1.2],[0.12,0.2,0.34,0.42,0.9,0.9],E.inOutSine)(T),0,1);
    closeScrim.style.opacity=clamp(enter(CUES.Close-1.2,1.4)(T)-enter(TOTAL-1.0,0.8)(T),0,1)*0.88;
    var chrome=clamp(enter(0.15,0.7)(T)-enter(TOTAL-0.85,0.7)(T),0,1);
    chromeL.style.opacity=0.85*chrome; chromeR.style.opacity=chrome; chromeB.style.opacity=chrome;
    chromeR.textContent=('0'+Math.floor(T)).slice(-2)+'s / '+Math.round(TOTAL)+'s';
    chromeFill.style.width=(clamp(T/TOTAL,0,1)*100)+'%';
    for(var i=0;i<starEls.length;i++){ var d=STARDATA[i], zs=mod(camZ-d.z+2000,2400)-2000, el=starEls[i];
      var op2=zOpacity(zs)*d.a*0.9*(0.72+0.28*Math.sin(now*d.ts+d.ph));
      if(op2<=0.01){ el.style.opacity=0; el.style.visibility='hidden'; continue; }
      el.style.visibility=''; el.style.opacity=op2; el.style.transform='translate(-50%,-50%) translate3d('+d.x+'px,'+d.y+'px,'+zs+'px)'; }
    // open
    put(bOpen,-260,0,330,clamp(1-enter(CUES.Title-1.6,1.2)(T),0,1));
    openCol.style.opacity=0.72+0.28*(0.5+0.5*Math.sin(T*2.1));
    openLine.style.height=drift(28,108,0.6,5.6)(T)+'px';
    // title
    put(bTitle,2400,-63,0,1,-900,1500);
    titleEy.style.opacity=enter(CUES.Title-0.9,1.0)(T);
    titleDash.style.width=drift(0,120,CUES.Title-0.7,CUES.Title+0.9)(T)+'px';
    titleName.style.opacity=enter(CUES.Title-0.5,1.3)(T);
    titleName.style.transform='translateY('+drift(46,0,CUES.Title-0.5,CUES.Title+1.3)(T)+'px)';
    titleSub.style.opacity=enter(CUES.Title+0.5,1.2)(T);
    titleSub.style.transform='translateY('+drift(26,0,CUES.Title+0.5,CUES.Title+1.7)(T)+'px)';
    // numbers
    for(var i=0;i<numBlocks.length;i++){ var el=numBlocks[i], c=NUMPOS[i], at=CUES.Numbers+1.2+i*3.7;
      var slot=clamp(enter(at-2.6,1.4)(T)-enter(at+3.1,0.9)(T),0,1);
      put(el,c.z,c.x,c.y,slot,-2100,720);
      el.querySelector('.dot').style.transform='scale('+pop(at-0.25,0.5)(T)+')';
      var target=+el.getAttribute('data-target'), dec=+el.getAttribute('data-dec'), suf=el.getAttribute('data-suffix')||'';
      var val=animate(0,target,at-1.6,at+1.2,E.outQuart)(T);
      el.querySelector('.val').textContent=(dec?val.toFixed(1):Math.round(val))+suf; }
    // picks
    put(bPicks,7200,-63,0,1);
    for(var i=0;i<pickRows.length;i++){ var at=CUES.Picks-0.3+i*0.62;
      pickRows[i].style.opacity=enter(at,0.9)(T);
      pickRows[i].style.transform='translateX('+drift(70,0,at,at+1.1)(T)+'px)'; }
    // close — rests as the final frame (no fade-back-to-sky; this isn't a loop)
    put(bClose,9000,0,0,1);
    closeName.style.opacity=enter(CUES.Close-0.5,1.1)(T);
    closeLine.style.width=drift(0,420,CUES.Close,CUES.Close+1.4)(T)+'px';
    closeKick.style.opacity=enter(CUES.Close+0.5,1.0)(T);
    closeChannels.style.opacity=enter(CUES.Close+0.9,1.1)(T);
  }

  // smooth "slow-motion" scroll: ease the authored time toward the scroll target
  var T=0, targetT=0;
  function retarget(){ var top=reel.offsetTop, span=reel.offsetHeight-innerHeight; targetT=(span>0?clamp((scrollY-top)/span,0,1):0)*TOTAL; }
  (function loop(){ T += (targetT-T)*0.06; if(Math.abs(targetT-T)<0.0008) T=targetT; render(T); requestAnimationFrame(loop); })();
  addEventListener('scroll', retarget, { passive:true });
  addEventListener('resize', function(){ fit(); retarget(); });
  retarget();
})();
</script>`;

fs.writeFileSync(
  path.join(DIST, "index.html"),
  pageShell({ title: SITE_TITLE, body: home, base: "./", bodyClass: "home", head: homeScript })
);

console.log(`Done. ${posts.length} post(s) -> dist/`);
