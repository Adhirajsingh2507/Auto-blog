<!--
title: How to Write Posts
date: 2026-08-09
description: A short guide to adding new posts in Markdown or HTML. Delete this whenever you like.
-->

This post is written in **Markdown** (`index.md`). You can also write posts in
**HTML** (`index.html`) — the build supports both.

## Adding a post

1. Make a new folder inside `posts/`, e.g. `posts/my-idea/`.
2. Add either an `index.md` or an `index.html`.
3. Put a metadata comment at the very top (see below).
4. Push to Git — Vercel rebuilds and it appears on the homepage automatically.

## The metadata block

Every post starts with this comment. It works in both `.md` and `.html`:

```
<!--
title: My Post Title
date: 2026-08-09
description: One line shown on the homepage card.
-->
```

If you skip `title`, it falls back to the first heading, then the folder name.

## Markdown you can use

- **bold**, *italic*, `inline code`
- [links](https://example.com) and images: `![alt](./photo.jpg)`
- lists, quotes, and code blocks

> Newest posts (by date) show first on the homepage.

## Images

Drop the image in the same folder as your post and reference it with a relative
path: `![my diagram](./diagram.png)`.
