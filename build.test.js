// Minimal self-check for the Markdown parser. Run: node build.test.js
const assert = require("assert");
const { parseMarkdown, parseMeta } = require("./build.js");

const md = parseMarkdown(
  "# Title\n\nHello **bold** and *em* and `code`.\n\n- a\n- b\n\n1. one\n2. two\n\n> quote\n\n```\nx=1\n```\n\n[link](https://e.com) ![alt](p.png)"
);
assert(md.includes("<h1>Title</h1>"), "h1");
assert(md.includes("<strong>bold</strong>"), "bold");
assert(md.includes("<em>em</em>"), "em");
assert(md.includes("<code>code</code>"), "inline code");
assert(md.includes("<ul><li>a</li><li>b</li></ul>"), "ul");
assert(md.includes("<ol><li>one</li><li>two</li></ol>"), "ol");
assert(md.includes("<blockquote>quote</blockquote>"), "quote");
assert(md.includes("<pre><code>x=1</code></pre>"), "code fence");
assert(md.includes('<a href="https://e.com">link</a>'), "link");
assert(md.includes('<img src="p.png" alt="alt">'), "image");
assert(!md.includes("<script>"), "escapes html");

assert.equal(parseMeta("<!--\ntitle: X\ndate: 2026-01-01\n-->\nbody").title, "X", "meta title");
assert.equal(parseMeta("# Fallback\n\nbody").title, "Fallback", "md h1 fallback");

console.log("build.test.js: all passed");
