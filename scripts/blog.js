// Render blog/posts/*.md into static pages and an Atom feed.
//
//   bun scripts/blog.js          # write blog/index.html, blog/<slug>/index.html, blog/feed.atom
//   bun scripts/blog.js --check  # fail if the committed output is stale (CI)
//
// The output is committed so Pages still serves plain files with no build step.
// Feed follows https://kevincox.ca/2022/05/06/rss-feed-best-practices/: Atom,
// absolute URLs, permalink ids, full content, and dates that never move.
// A post's `published` time is fixed once it ships; bump `updated` only for
// significant edits.

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SITE = 'https://kevintcoughlin.com';
const BLOG_URL = `${SITE}/blog/`;
const FEED_URL = `${SITE}/blog/feed.atom`;
const FEED_TITLE = "Kevin Coughlin's Blog";
const AUTHOR = 'Kevin T. Coughlin';
const POSTS_DIR = 'blog/posts';

const escape = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function parsePost(file) {
  const raw = readFileSync(join(POSTS_DIR, file), 'utf8');
  const fm = raw.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fm) throw new Error(`${file}: missing front matter`);
  const meta = Object.fromEntries(
    fm[1].split('\n').map((line) => {
      const i = line.indexOf(':');
      return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
    })
  );
  const body = raw.slice(fm[0].length).trim();
  const heading = body.match(/^# (.+)\n/);
  if (!heading) throw new Error(`${file}: first line must be a "# Title" heading`);
  const markdown = body.slice(heading[0].length).trim();
  const firstParagraph = markdown.split(/\n\n/)[0].replace(/\s+/g, ' ');

  const published = new Date(meta.published);
  const updated = new Date(meta.updated ?? meta.published);
  if (Number.isNaN(published.getTime())) throw new Error(`${file}: bad published date`);
  if (updated < published) throw new Error(`${file}: updated is before published`);

  const slug = file.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/, '');
  // Root-relative links would break in feed readers; make every URL absolute.
  const html = Bun.markdown.html(markdown).replace(/(href|src)="\//g, `$1="${SITE}/`);
  return {
    slug,
    url: `${BLOG_URL}${slug}/`,
    title: heading[1].trim(),
    summary: Bun.markdown
      .html(firstParagraph)
      .replace(/<[^>]+>/g, '')
      .trim(),
    published,
    updated,
    html,
  };
}

const isoDate = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
const humanDate = (d) =>
  d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });

function page({ title, description, canonical, main }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="${escape(description)}" />
    <meta name="author" content="${AUTHOR}" />
    <meta name="theme-color" content="#14211d" />
    <link rel="canonical" href="${canonical}" />
    <link rel="icon" type="image/png" href="/favicon.png" />
    <link rel="alternate" type="application/atom+xml" title="${escape(FEED_TITLE)}" href="${FEED_URL}" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src https://static.cloudflareinsights.com; style-src 'unsafe-inline'; img-src 'self' https: data:; connect-src https://cloudflareinsights.com; object-src 'none'; base-uri 'self'; form-action 'none'"
    />
    <meta name="referrer" content="strict-origin-when-cross-origin" />
    <title>${escape(title)}</title>
    <style>
      :root {
        color-scheme: dark;
        --ink: #edf0e9;
        --muted: #a8b4aa;
        --line: rgba(237, 240, 233, 0.18);
        --accent: #d7ef72;
        --serif: Georgia, 'Times New Roman', serif;
        --sans: Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
        --mono: 'SF Mono', ui-monospace, 'Cascadia Code', monospace;
      }
      body {
        margin: 0;
        color: var(--ink);
        background: #14211d;
        font-family: var(--sans);
        line-height: 1.65;
      }
      .shell {
        width: min(720px, calc(100% - 32px));
        margin: 0 auto;
      }
      header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 18px 0;
        border-bottom: 1px solid var(--line);
      }
      header a {
        color: inherit;
        text-decoration: none;
      }
      .wordmark {
        font-family: var(--serif);
        font-weight: 600;
      }
      .wordmark span,
      a {
        color: var(--accent);
      }
      h1,
      h2,
      h3 {
        font-family: var(--serif);
        line-height: 1.2;
      }
      h1 {
        font-size: clamp(2rem, 5vw, 2.8rem);
        margin: 48px 0 8px;
      }
      time,
      .meta {
        color: var(--muted);
        font-family: var(--mono);
        font-size: 0.8rem;
      }
      pre {
        overflow-x: auto;
        padding: 16px;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: rgba(0, 0, 0, 0.25);
      }
      code {
        font-family: var(--mono);
        font-size: 0.88em;
      }
      table {
        display: block;
        overflow-x: auto;
        border-collapse: collapse;
      }
      th,
      td {
        padding: 6px 12px;
        border: 1px solid var(--line);
        text-align: left;
      }
      ul.posts {
        padding: 0;
        list-style: none;
      }
      ul.posts li {
        margin: 32px 0;
      }
      ul.posts h2 {
        margin: 4px 0;
      }
      footer {
        margin: 64px auto 32px;
        padding-top: 16px;
        border-top: 1px solid var(--line);
        color: var(--muted);
        font-size: 0.85rem;
      }
    </style>
    <script
      defer
      src="https://static.cloudflareinsights.com/beacon.min.js"
      data-cf-beacon='{"token": "0d360b4cb7b148b5a55c50a0bdfabcb1"}'
    ></script>
  </head>
  <body>
    <header class="shell">
      <a class="wordmark" href="/" aria-label="Kevin Coughlin home">Kevin Coughlin<span>.</span></a>
      <a href="/blog/">Blog</a>
    </header>
    <main class="shell">
${main}
    </main>
    <footer class="shell">
      <a href="${FEED_URL}">Subscribe via Atom feed</a>
    </footer>
  </body>
</html>
`;
}

function postPage(post) {
  return page({
    title: `${post.title} — Kevin Coughlin`,
    description: post.summary,
    canonical: post.url,
    main: `      <article>
        <h1>${escape(post.title)}</h1>
        <time datetime="${isoDate(post.published)}">${humanDate(post.published)}</time>
${post.html}
      </article>`,
  });
}

function indexPage(posts) {
  const items = posts
    .map(
      (p) => `        <li>
          <time datetime="${isoDate(p.published)}">${humanDate(p.published)}</time>
          <h2><a href="/blog/${p.slug}/">${escape(p.title)}</a></h2>
          <p>${escape(p.summary)}</p>
        </li>`
    )
    .join('\n');
  return page({
    title: FEED_TITLE,
    description: 'Notes on developer tooling, games and servers by Kevin Coughlin.',
    canonical: BLOG_URL,
    main: `      <h1>Blog</h1>
      <ul class="posts">
${items}
      </ul>`,
  });
}

function feed(posts) {
  const updated = new Date(Math.max(...posts.map((p) => p.updated.getTime())));
  const entries = posts
    .map(
      (p) => `  <entry>
    <title>${escape(p.title)}</title>
    <link rel="alternate" type="text/html" href="${p.url}"/>
    <id>${p.url}</id>
    <published>${isoDate(p.published)}</published>
    <updated>${isoDate(p.updated)}</updated>
    <summary>${escape(p.summary)}</summary>
    <content type="html">${escape(p.html)}</content>
  </entry>`
    )
    .join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="en">
  <title>${escape(FEED_TITLE)}</title>
  <id>${BLOG_URL}</id>
  <link rel="alternate" type="text/html" href="${BLOG_URL}"/>
  <link rel="self" type="application/atom+xml" href="${FEED_URL}"/>
  <updated>${isoDate(updated)}</updated>
  <author>
    <name>${AUTHOR}</name>
    <uri>${SITE}/</uri>
  </author>
${entries}
</feed>
`;
}

const posts = readdirSync(POSTS_DIR)
  .filter((f) => f.endsWith('.md'))
  .map(parsePost)
  .sort((a, b) => b.published - a.published);

const outputs = new Map([
  ['blog/index.html', indexPage(posts)],
  ['blog/feed.atom', feed(posts)],
  ...posts.map((p) => [`blog/${p.slug}/index.html`, postPage(p)]),
]);

if (process.argv.includes('--check')) {
  const stale = [...outputs].filter(
    ([path, text]) => !existsSync(path) || readFileSync(path, 'utf8') !== text
  );
  if (stale.length) {
    console.error(`Stale blog output (run \`bun run blog\`): ${stale.map(([p]) => p).join(', ')}`);
    process.exit(1);
  }
  console.log(`Blog output up to date (${posts.length} posts)`);
} else {
  for (const [path, text] of outputs) {
    mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true });
    writeFileSync(path, text);
  }
  console.log(`Wrote ${outputs.size} files for ${posts.length} posts`);
}
