// Render blog/posts/*.md into static pages, tag pages, and an Atom feed.
//
//   bun scripts/blog.js          # write blog/index.html, blog/<slug>/index.html,
//                                # blog/tags/index.html, blog/tags/<tag>/index.html,
//                                # blog/feed.atom, and the generated regions of
//                                # index.html and sitemap.xml
//   bun scripts/blog.js --check  # fail if the committed output is stale (CI)
//
// The output is committed so Pages still serves plain files with no build step.
// Feed follows https://kevincox.ca/2022/05/06/rss-feed-best-practices/: Atom,
// absolute URLs, permalink ids, full content, and dates that never move.
// A post's `published` time is fixed once it ships; bump `updated` only for
// significant edits.
//
// Every post needs a `tags` list in front matter: lowercase hyphenated labels,
// shown alphabetically. Each tag links to blog/tags/<tag>/.
//
// Optional `title` is the document and social title when the heading is too
// long for a search result. Optional `description` is the meta description
// when the first paragraph is past ~160 characters. The heading stays the h1.

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import * as prettier from 'prettier';

const SITE = 'https://kevintcoughlin.com';
const BLOG_URL = `${SITE}/blog/`;
const FEED_URL = `${SITE}/blog/feed.atom`;
const FEED_TITLE = "Kevin Coughlin's Blog";
const AUTHOR = 'Kevin T. Coughlin';
const POSTS_DIR = 'blog/posts';
// How many posts the homepage "Writing" section lists.
const HOME_POSTS = 3;

const escape = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Lowercase words, digits, and single hyphens: `github-actions`, not `GitHub Actions`.
const TAG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function parseFrontMatter(file, block) {
  const meta = {};
  const lines = block.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const colon = line.indexOf(':');
    if (colon === -1 || /^\s/.test(line)) {
      throw new Error(`${file}: bad front matter line "${line}"`);
    }
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (Object.hasOwn(meta, key)) throw new Error(`${file}: duplicate front matter key "${key}"`);
    if (value === '') {
      const items = [];
      while (i + 1 < lines.length && /^\s+-\s+\S/.test(lines[i + 1])) {
        i += 1;
        items.push(lines[i].replace(/^\s+-\s+/, '').trim());
      }
      if (!items.length) throw new Error(`${file}: "${key}" needs a value or a list`);
      meta[key] = items;
    } else if (value.startsWith('[') && value.endsWith(']')) {
      meta[key] = value
        .slice(1, -1)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    } else {
      meta[key] = value;
    }
  }
  return meta;
}

function parseTags(file, raw) {
  if (raw == null) throw new Error(`${file}: missing tags`);
  const tags = Array.isArray(raw)
    ? raw
    : String(raw)
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean);
  if (!tags.length) throw new Error(`${file}: tags must list at least one tag`);
  for (const tag of tags) {
    if (!TAG_RE.test(tag)) {
      throw new Error(`${file}: invalid tag "${tag}" (lowercase words, digits, and hyphens)`);
    }
  }
  if (new Set(tags).size !== tags.length) throw new Error(`${file}: duplicate tag`);
  return [...tags].sort();
}

function parsePost(file) {
  const raw = readFileSync(join(POSTS_DIR, file), 'utf8');
  const fm = raw.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fm) throw new Error(`${file}: missing front matter`);
  const meta = parseFrontMatter(file, fm[1]);
  const body = raw.slice(fm[0].length).trim();
  const heading = body.match(/^# (.+)\n/);
  if (!heading) throw new Error(`${file}: first line must be a "# Title" heading`);
  const markdown = body.slice(heading[0].length).trim();
  const firstParagraph = markdown.split(/\n\n/)[0].replace(/\s+/g, ' ');

  const published = new Date(meta.published);
  const updated = new Date(meta.updated ?? meta.published);
  if (Number.isNaN(published.getTime())) throw new Error(`${file}: bad published date`);
  if (updated < published) throw new Error(`${file}: updated is before published`);

  const headline = heading[1].trim();
  const seoTitle = singleLine(file, 'title', meta.title);
  const customDescription = singleLine(file, 'description', meta.description);
  if (seoTitle.length > TITLE_MAX) {
    throw new Error(
      `${file}: title is ${seoTitle.length} characters; aim for ${TITLE_MAX} or fewer`
    );
  }
  const docTitle = documentTitle(seoTitle || headline);
  if (docTitle.length > TITLE_MAX) {
    throw new Error(
      `${file}: document title is ${docTitle.length} characters. Set a shorter title in front matter (aim ≤ ${TITLE_MAX}).`
    );
  }

  // Plain text: keep link text, drop inline Markdown markers. Escaped on output.
  const summary = firstParagraph
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*`]/g, '')
    .trim();
  let description = customDescription;
  if (description.length > DESC_MAX) {
    throw new Error(
      `${file}: description is ${description.length} characters; keep it to ${DESC_MAX}`
    );
  }
  if (!description) {
    description = metaDescription(summary);
    if (description.endsWith('…')) {
      console.warn(
        `${file}: meta description was cut mid-sentence. Set description in front matter.`
      );
    }
  }

  const slug = file.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/, '');
  // Root-relative links would break in feed readers; make every URL absolute.
  const html = addHeadingIds(
    Bun.markdown.html(markdown).replace(/(href|src)="\//g, `$1="${SITE}/`)
  );
  return {
    slug,
    url: `${BLOG_URL}${slug}/`,
    title: headline,
    docTitle,
    summary,
    description,
    published,
    updated,
    tags: parseTags(file, meta.tags),
    html,
  };
}

function singleLine(file, key, value) {
  if (value == null) return '';
  if (typeof value !== 'string') throw new Error(`${file}: ${key} must be a single line`);
  return value.trim();
}

// GitHub-style heading anchors, so in-post links like [x](#some-heading) work.
// Duplicate headings get -1, -2, ... suffixes.
function addHeadingIds(html) {
  const seen = new Map();
  return html.replace(/<h([2-6])>([\s\S]*?)<\/h\1>/g, (_, level, inner) => {
    // Strip tags until none are left; the id keeps only letters, digits and hyphens.
    let text = inner;
    for (let prev = ''; prev !== text;) {
      prev = text;
      text = text.replace(/<[^>]*>/g, '');
    }
    const base = text
      .replace(/&[a-z0-9#]+;/gi, '')
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .replace(/\s/g, '-');
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    const id = count ? `${base}-${count}` : base;
    return `<h${level} id="${id}">${inner}</h${level}>`;
  });
}

// Feed readers resolve fragment-only links against the feed URL, so point
// them at the post's permalink.
const absoluteFragments = (html, url) => html.replace(/href="#/g, `href="${url}#`);

const isoDate = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
const humanDate = (d) =>
  d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });

// Search results show about 60–65 characters of a title and ~160 of a
// description. Keep the site suffix when it still fits. A longer heading needs
// `title` in front matter; a longer lead needs `description`, or it is cut on
// a sentence boundary.
const TITLE_MAX = 65;
const TITLE_SUFFIX = ' — Kevin Coughlin';
const DESC_MAX = 160;
const OG_IMAGE = `${SITE}/og-image.png`;
const OG_IMAGE_ALT = 'Kevin Coughlin — Making useful things for curious people.';
const SITE_NAME = 'Kevin Coughlin';
const AUTHOR_NAME = 'Kevin Coughlin';
const BLOG_DESCRIPTION = 'Notes on developer tooling, games and servers by Kevin Coughlin.';
const TAGS_DESCRIPTION = "All tags on Kevin Coughlin's blog.";
const BLOG_ID = `${BLOG_URL}#blog`;

const documentTitle = (headline) => {
  const withSite = `${headline}${TITLE_SUFFIX}`;
  return withSite.length <= TITLE_MAX ? withSite : headline;
};

function splitSentences(text) {
  const parts = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c !== '.' && c !== '!' && c !== '?') continue;
    const atEnd = i + 1 === text.length;
    if (!atEnd && text[i + 1] !== ' ') continue;
    // Keep decimals such as 2.5 and 1.6 inside the sentence.
    if (
      c === '.' &&
      i > 0 &&
      /\d/.test(text[i - 1]) &&
      i + 1 < text.length &&
      /\d/.test(text[i + 1])
    ) {
      continue;
    }
    parts.push(text.slice(start, i + 1).trim());
    start = i + 1;
  }
  const rest = text.slice(start).trim();
  if (rest) parts.push(rest);
  return parts;
}

function metaDescription(summary) {
  const text = summary.replace(/\s+/g, ' ').trim();
  if (text.length <= DESC_MAX) return text;
  let out = '';
  for (const sentence of splitSentences(text)) {
    const next = out ? `${out} ${sentence}` : sentence;
    if (next.length > DESC_MAX) break;
    out = next;
  }
  if (out) return out;
  let cut = text.slice(0, DESC_MAX - 1);
  const space = cut.lastIndexOf(' ');
  if (space >= 80) cut = cut.slice(0, space);
  return `${cut.replace(/[,:;]+$/, '').trimEnd()}…`;
}

const person = () => ({ '@type': 'Person', name: AUTHOR_NAME, url: `${SITE}/` });

function itemList(items) {
  return {
    '@type': 'ItemList',
    numberOfItems: items.length,
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      ...item,
    })),
  };
}

function blogPostRef(post) {
  return {
    '@type': 'BlogPosting',
    headline: post.title,
    url: post.url,
    datePublished: isoDate(post.published),
    dateModified: isoDate(post.updated),
  };
}

function collectionLd({ id, name, description, url, posts, about }) {
  const data = {
    '@context': 'https://schema.org',
    '@type': ['Blog', 'CollectionPage'],
    name,
    description,
    url,
    image: OG_IMAGE,
    inLanguage: 'en',
    author: person(),
  };
  if (id) data['@id'] = id;
  else data.isPartOf = { '@id': BLOG_ID };
  if (about) data.about = { '@type': 'Thing', name: about };
  if (posts) {
    data.blogPost = posts.map(blogPostRef);
    data.mainEntity = itemList(posts.map((post) => ({ name: post.title, url: post.url })));
  }
  return data;
}

function postJsonLd(post) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.description,
    image: OG_IMAGE,
    datePublished: isoDate(post.published),
    dateModified: isoDate(post.updated),
    author: person(),
    publisher: person(),
    url: post.url,
    mainEntityOfPage: { '@type': 'WebPage', '@id': post.url },
    isPartOf: { '@id': BLOG_ID },
  };
}

function jsonLdScript(data) {
  const json = JSON.stringify(data, null, 2).replace(/</g, '\\u003c');
  const body = json
    .split('\n')
    .map((line) => `      ${line}`)
    .join('\n');
  return `    <script type="application/ld+json">\n${body}\n    </script>`;
}

function socialTags({ title, description, url, type, published, updated, tags }) {
  const lines = [
    `<meta property="og:type" content="${type}" />`,
    `<meta property="og:title" content="${escape(title)}" />`,
    `<meta property="og:description" content="${escape(description)}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${OG_IMAGE}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${escape(OG_IMAGE_ALT)}" />`,
    `<meta property="og:image:type" content="image/png" />`,
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:locale" content="en_US" />`,
  ];
  if (type === 'article') {
    lines.push(
      `<meta property="article:published_time" content="${isoDate(published)}" />`,
      `<meta property="article:modified_time" content="${isoDate(updated)}" />`,
      `<meta property="article:author" content="${SITE}/" />`
    );
    for (const tag of tags) lines.push(`<meta property="article:tag" content="${escape(tag)}" />`);
  }
  lines.push(
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:creator" content="@kevintcoughlin" />`,
    `<meta name="twitter:title" content="${escape(title)}" />`,
    `<meta name="twitter:description" content="${escape(description)}" />`,
    `<meta name="twitter:image" content="${OG_IMAGE}" />`,
    `<meta name="twitter:image:alt" content="${escape(OG_IMAGE_ALT)}" />`
  );
  return lines.map((line) => `    ${line}`).join('\n');
}

function page({
  title,
  description,
  canonical,
  main,
  tagsCurrent = false,
  type = 'website',
  jsonLd,
  published,
  updated,
  tags,
}) {
  const social = socialTags({
    title,
    description,
    url: canonical,
    type,
    published,
    updated,
    tags,
  });
  const structured = jsonLd ? `\n${jsonLdScript(jsonLd)}` : '';
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
      content="default-src 'self'; script-src 'self' https://static.cloudflareinsights.com; style-src 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self' https://cloudflareinsights.com; object-src 'none'; base-uri 'self'; form-action 'none'"
    />
    <meta name="referrer" content="strict-origin-when-cross-origin" />
${social}
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
      ul.tags {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin: 12px 0 0;
        padding: 0;
        list-style: none;
      }
      ul.tags a {
        padding: 2px 10px;
        border: 1px solid var(--line);
        border-radius: 999px;
        color: var(--muted);
        font-family: var(--mono);
        font-size: 0.75rem;
        text-decoration: none;
      }
      ul.tags a:hover,
      ul.tags a:focus-visible,
      ul.tags a[aria-current='page'] {
        color: var(--ink);
        background: var(--line);
      }
      ul.tag-index {
        margin: 8px 0 0;
        padding: 0;
        list-style: none;
      }
      ul.tag-index a {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 16px;
        padding: 10px 0;
        border-bottom: 1px solid var(--line);
        text-decoration: none;
      }
      ul.tag-index a span:first-child {
        text-decoration: underline;
        text-underline-offset: 0.15em;
      }
      ul.tag-index .count {
        color: var(--muted);
        font-family: var(--mono);
        font-size: 0.8rem;
      }
      ul.tag-index a:hover,
      ul.tag-index a:focus-visible,
      ul.tag-index a:hover .count,
      ul.tag-index a:focus-visible .count {
        color: var(--ink);
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
    ></script>${structured}
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
      <a href="/blog/tags/"${tagsCurrent ? ' aria-current="page"' : ''}>Tags</a>
      ·
      <a href="${FEED_URL}">Subscribe via Atom feed</a>
    </footer>
  </body>
</html>
`;
}

const countLabel = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`;

function tagsList(tags, indent, currentTag) {
  const pad = ' '.repeat(indent);
  const items = tags
    .map((tag) => {
      const current = tag === currentTag ? ' aria-current="page"' : '';
      return `${pad}  <li><a href="/blog/tags/${tag}/"${current}>${escape(tag)}</a></li>`;
    })
    .join('\n');
  return `${pad}<ul class="tags" aria-label="Tags">\n${items}\n${pad}</ul>`;
}

function postListItem(post, currentTag) {
  return `        <li>
          <time datetime="${isoDate(post.published)}">${humanDate(post.published)}</time>
          <h2><a href="/blog/${post.slug}/">${escape(post.title)}</a></h2>
          <p>${escape(post.summary)}</p>
${tagsList(post.tags, 10, currentTag)}
        </li>`;
}

function postList(posts, currentTag) {
  return `      <ul class="posts">
${posts.map((post) => postListItem(post, currentTag)).join('\n')}
      </ul>`;
}

function postPage(post) {
  return page({
    title: post.docTitle,
    description: post.description,
    canonical: post.url,
    type: 'article',
    published: post.published,
    updated: post.updated,
    tags: post.tags,
    jsonLd: postJsonLd(post),
    main: `      <article>
        <h1>${escape(post.title)}</h1>
        <time datetime="${isoDate(post.published)}">${humanDate(post.published)}</time>
${tagsList(post.tags, 8)}
${post.html}
      </article>`,
  });
}

function indexPage(posts) {
  return page({
    title: FEED_TITLE,
    description: BLOG_DESCRIPTION,
    canonical: BLOG_URL,
    jsonLd: collectionLd({
      id: BLOG_ID,
      name: FEED_TITLE,
      description: BLOG_DESCRIPTION,
      url: BLOG_URL,
      posts,
    }),
    main: `      <h1>Blog</h1>
      <p class="meta"><a href="/blog/tags/">All tags</a></p>
${postList(posts)}`,
  });
}

// Posts are newest-first, so each tag's list stays newest-first.
function postsByTag(posts) {
  const groups = new Map();
  for (const post of posts) {
    for (const tag of post.tags) {
      const list = groups.get(tag);
      if (list) list.push(post);
      else groups.set(tag, [post]);
    }
  }
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function tagPage(tag, tagged) {
  const url = `${BLOG_URL}tags/${tag}/`;
  const description = `Posts tagged ${tag}.`;
  const title = documentTitle(tag);
  return page({
    title,
    description,
    canonical: url,
    jsonLd: collectionLd({
      name: title,
      description,
      url,
      posts: tagged,
      about: tag,
    }),
    main: `      <h1>${escape(tag)}</h1>
      <p class="meta">${countLabel(tagged.length, 'post')} · <a href="/blog/tags/">All tags</a></p>
${postList(tagged, tag)}`,
  });
}

function tagIndexPage(tagGroups) {
  const items = tagGroups
    .map(([tag, tagged]) => {
      const label = countLabel(tagged.length, 'post');
      return `        <li>
          <a href="/blog/tags/${tag}/">
            <span>${escape(tag)}</span>
            <span class="count">${label}</span>
          </a>
        </li>`;
    })
    .join('\n');
  const title = documentTitle('Tags');
  return page({
    title,
    description: TAGS_DESCRIPTION,
    canonical: `${BLOG_URL}tags/`,
    tagsCurrent: true,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': ['Blog', 'CollectionPage'],
      name: title,
      description: TAGS_DESCRIPTION,
      url: `${BLOG_URL}tags/`,
      image: OG_IMAGE,
      inLanguage: 'en',
      author: person(),
      isPartOf: { '@id': BLOG_ID },
      mainEntity: itemList(
        tagGroups.map(([tag]) => ({ name: tag, url: `${BLOG_URL}tags/${tag}/` }))
      ),
    },
    main: `      <h1>Tags</h1>
      <p class="meta">${countLabel(tagGroups.length, 'tag')}</p>
      <ul class="tag-index">
${items}
      </ul>`,
  });
}

function feed(posts) {
  const updated = new Date(Math.max(...posts.map((p) => p.updated.getTime())));
  const entries = posts
    .map((p) => {
      const categories = p.tags.map((tag) => `    <category term="${escape(tag)}"/>`).join('\n');
      return `  <entry>
    <title>${escape(p.title)}</title>
    <link rel="alternate" type="text/html" href="${p.url}"/>
    <id>${p.url}</id>
    <published>${isoDate(p.published)}</published>
    <updated>${isoDate(p.updated)}</updated>
${categories}
    <summary>${escape(p.summary)}</summary>
    <content type="html">${escape(absoluteFragments(p.html, p.url))}</content>
  </entry>`;
    })
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

const ymd = (d) => d.toISOString().slice(0, 10);

// Replace the lines between `<!-- {name}:start ... -->` and `<!-- {name}:end -->`
// in a hand-written file, so new posts reach it without manual edits.
function splice(path, name, lines) {
  const text = readFileSync(path, 'utf8');
  const re = new RegExp(
    `(<!-- ${name}:start[^>]*-->\\n)[\\s\\S]*?(\\n[ \\t]*<!-- ${name}:end -->)`
  );
  if (!re.test(text)) throw new Error(`${path}: missing <!-- ${name}:start/end --> markers`);
  return text.replace(re, (_, start, end) => `${start}${lines}${end}`);
}

async function homePage(posts) {
  const items = posts
    .slice(0, HOME_POSTS)
    .map(
      (p) =>
        `<li><a href="/blog/${p.slug}/"><time datetime="${ymd(p.published)}">${ymd(p.published)}</time><span>${escape(p.title)}</span></a></li>`
    )
    .join('\n');
  const html = splice('index.html', 'blog:latest', items);
  // index.html is Prettier-checked in CI, so emit it already formatted.
  const options = await prettier.resolveConfig('index.html');
  return prettier.format(html, { ...options, filepath: 'index.html' });
}

function sitemap(posts, tagGroups) {
  const updated = new Date(Math.max(...posts.map((p) => p.updated.getTime())));
  const urls = [
    { loc: BLOG_URL, lastmod: updated },
    ...[...posts].reverse().map((p) => ({ loc: p.url, lastmod: p.updated })),
    { loc: `${BLOG_URL}tags/`, lastmod: updated },
    ...tagGroups.map(([tag, tagged]) => ({
      loc: `${BLOG_URL}tags/${tag}/`,
      lastmod: new Date(Math.max(...tagged.map((p) => p.updated.getTime()))),
    })),
  ];
  return splice(
    'sitemap.xml',
    'blog',
    urls
      .map(
        ({ loc, lastmod }) => `  <url>
    <loc>${loc}</loc>
    <lastmod>${ymd(lastmod)}</lastmod>
  </url>`
      )
      .join('\n')
  );
}

function filesUnder(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...filesUnder(path));
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

function removeEmptyDirs(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) removeEmptyDirs(`${dir}/${entry.name}`);
  }
  if (readdirSync(dir).length === 0) rmSync(dir);
}

const decode = (s) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

function assertPage(path, html) {
  if (!path.startsWith('blog/') || !path.endsWith('.html')) return;
  const isPost = path !== 'blog/index.html' && !path.startsWith('blog/tags/');
  const required = [
    'property="og:title"',
    'property="og:description"',
    'property="og:url"',
    'property="og:type"',
    `property="og:image" content="${OG_IMAGE}"`,
    'name="twitter:card" content="summary_large_image"',
    'name="twitter:title"',
    'name="twitter:description"',
    'name="twitter:image"',
    'type="application/ld+json"',
  ];
  for (const token of required) {
    if (!html.includes(token)) throw new Error(`${path}: missing ${token}`);
  }
  const canonical = html.match(/rel="canonical" href="([^"]+)"/);
  const ogUrl = html.match(/property="og:url" content="([^"]+)"/);
  if (!canonical || !ogUrl || canonical[1] !== ogUrl[1]) {
    throw new Error(`${path}: og:url does not match canonical`);
  }
  const ogType = html.match(/property="og:type" content="([^"]+)"/);
  if (isPost && ogType?.[1] !== 'article') throw new Error(`${path}: og:type should be article`);
  if (!isPost && ogType?.[1] !== 'website') throw new Error(`${path}: og:type should be website`);
  const title = decode(html.match(/<title>([^<]*)<\/title>/)?.[1] ?? '');
  const description = decode(html.match(/name="description" content="([^"]*)"/)?.[1] ?? '');
  if (!title) throw new Error(`${path}: missing title`);
  if (!description) throw new Error(`${path}: missing description`);
  if (title.length > TITLE_MAX) throw new Error(`${path}: title is ${title.length} characters`);
  if (description.length > DESC_MAX) {
    throw new Error(`${path}: description is ${description.length} characters`);
  }
  const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!ld) throw new Error(`${path}: JSON-LD block not found`);
  const data = JSON.parse(ld[1]);
  if (isPost) {
    if (data['@type'] !== 'BlogPosting') throw new Error(`${path}: expected BlogPosting`);
    for (const key of ['headline', 'datePublished', 'dateModified', 'author', 'url', 'image']) {
      if (data[key] == null) throw new Error(`${path}: JSON-LD missing ${key}`);
    }
    if (data.author?.['@type'] !== 'Person' || data.author.name !== AUTHOR_NAME) {
      throw new Error(`${path}: author should be a Person named ${AUTHOR_NAME}`);
    }
    if (data.url !== canonical[1] || data.image !== OG_IMAGE) {
      throw new Error(`${path}: JSON-LD url or image does not match the page`);
    }
  } else {
    const types = [].concat(data['@type']);
    if (!types.includes('Blog') || !types.includes('CollectionPage')) {
      throw new Error(`${path}: expected Blog and CollectionPage JSON-LD`);
    }
    if (data.url !== canonical[1] || data.image !== OG_IMAGE) {
      throw new Error(`${path}: JSON-LD url or image does not match the page`);
    }
  }
}

const posts = readdirSync(POSTS_DIR)
  .filter((f) => f.endsWith('.md'))
  .map(parsePost)
  .sort((a, b) => b.published - a.published);
const tagGroups = postsByTag(posts);

const outputs = new Map([
  ['blog/index.html', indexPage(posts)],
  ['blog/feed.atom', feed(posts)],
  ['blog/tags/index.html', tagIndexPage(tagGroups)],
  ['index.html', await homePage(posts)],
  ['sitemap.xml', sitemap(posts, tagGroups)],
  ...posts.map((p) => [`blog/${p.slug}/index.html`, postPage(p)]),
  ...tagGroups.map(([tag, tagged]) => [`blog/tags/${tag}/index.html`, tagPage(tag, tagged)]),
]);

for (const [path, text] of outputs) assertPage(path, text);

const unexpected = filesUnder('blog/tags').filter((path) => !outputs.has(path));

if (process.argv.includes('--check')) {
  const stale = [...outputs].filter(
    ([path, text]) => !existsSync(path) || readFileSync(path, 'utf8') !== text
  );
  const paths = [...stale.map(([p]) => p), ...unexpected];
  if (paths.length) {
    console.error(`Stale blog output (run \`bun run blog\`): ${paths.join(', ')}`);
    process.exit(1);
  }
  console.log(`Blog output up to date (${posts.length} posts, ${tagGroups.length} tags)`);
} else {
  for (const path of unexpected) rmSync(path);
  removeEmptyDirs('blog/tags');
  for (const [path, text] of outputs) {
    mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true });
    writeFileSync(path, text);
  }
  console.log(`Wrote ${outputs.size} files for ${posts.length} posts and ${tagGroups.length} tags`);
}
