# Auto Blog

A tiny, zero-dependency static blog generator. Write posts in **Markdown or HTML**,
drop them in a folder, push — and they appear on an editorial-style site deployed to Vercel.

**Live:** https://adhiraj-blog.vercel.app

---

## How it works

1. Each post is a folder inside `posts/` containing an `index.md` or `index.html`.
2. `build.js` scans `posts/`, wraps each post in a shared template, and generates `dist/`
   (a homepage listing every post + one page per post).
3. Vercel serves `dist/`. Push to Git → it rebuilds and redeploys automatically.

No framework, no runtime server, no database. Just Node's standard library.

## Writing a post

Create a folder and add an `index.md` (or `index.html`) that starts with a metadata comment:

```
<!--
title: My Post Title
date: 2026-08-10
description: One line shown on the homepage card.
-->

Your content here...
```

- `title` falls back to the first heading, then the folder name, if omitted.
- Posts are sorted newest-first by `date`.
- Images go in the same folder; reference them with a relative path (`./photo.jpg`).
- Markdown supports headings, bold/italic, inline code, links, images, lists,
  blockquotes, code fences, and horizontal rules. For anything more, use an `index.html`.

## Develop locally

```bash
node build.js            # build into dist/
npx serve dist           # or: python3 -m http.server -d dist
node build.test.js       # run the Markdown-parser checks
```

## Deploy

Connected to Vercel — every push to `main` triggers a production build (`node build.js` → `dist/`).

## Configuration

Edit the constants at the top of `build.js`: `SITE_TITLE`, `SITE_KICKER`,
`SITE_TAGLINE`, and `SITE_LINKS`. Visual styling lives in `template/styles.css`.

## License

[MIT](./LICENSE) © Adhiraj Singh

