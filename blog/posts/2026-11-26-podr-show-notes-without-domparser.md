---
published: 2026-11-26T16:20:00Z
tags:
  - performance
  - tips
---

# Don't parse show notes until something reads them

[Podr](https://github.com/cascadiacollections/podr) turned every episode and podcast description that contained `<` or `&` into plain text with `DOMParser` on the main thread, during feed load, before the episode list could update. Ordinary notes are a string scan now. The plain text is computed the first time something reads `description`, and cached. Laziness beat a worker: the scan needs no DOM, copying a multi-megabyte feed across threads costs more than the scan, and the fallback needs `DOMParser`, which workers do not have. The change is [podr#188](https://github.com/cascadiacollections/podr/pull/188) ([`10c3607`](https://github.com/cascadiacollections/podr/commit/10c36079365a2096fb251229a18be34d06fa25e8)). [podr#186](https://github.com/cascadiacollections/podr/pull/186) left this open. Large descriptions were still parsed in full on the main thread.

## What I measured

The numbers are from jsdom, on show notes shaped like a CMS export: paragraphs, links, lists, WordPress comments, and the character references those tools emit (`&amp;`, `&#8217;`, `&mdash;`, `&ldquo;`, `&eacute;`). The scanner's text matched `DOMParser`. The 300-episode run produced the same 1,502,260 characters.

|                                               | Before (`DOMParser`)      | After                                                  |
| --------------------------------------------- | ------------------------- | ------------------------------------------------------ |
| One 12,767-byte description                   | 6.9 ms                    | 0.32 ms                                                |
| One 128,381-byte description                  | 42.4 ms                   | 1.7 ms                                                 |
| 300 descriptions, 10,923 bytes each (3.31 MB) | 890 ms, during feed parse | 0.9 ms to parse the feed, then 4.0 ms for the first 30 |

The list mounts 30 rows. Those are the notes that used to be waited on along with the other 270. Reading all 300 with the scanner, for a case that does walk every episode, took 41 ms.

App JS is 17KB gzip. The previous review measured about 15KB, so the reader and its character-reference table are about 2KB.

## Read it when something asks

A feed can carry hundreds of episodes. Scanning every show-notes string before the list paints blocks the main thread for notes the listener has not asked to see. `description` is a getter. Spread would read that getter immediately, so the property is defined on the object:

```ts
function defineLazyDescription<T extends object>(
  target: T,
  raw: string
): T & { readonly description: string } {
  return Object.defineProperty(target, 'description', {
    enumerable: true,
    get(): string {
      return raw ? toPlainText(raw) : '';
    },
  }) as T & { readonly description: string };
}
```

The list mounts a page of rows, and saving keeps a short prefix of the first sixty. Both read `description` and pay for those only. The value is the same plain text `toPlainText` has always returned.

`toPlainText` remembers 64 recent plain-text results. Opening a podcast reads each visible description once for the row and again when the trimmed copy is saved. The second read is the stored string:

```ts
const cached = plainTextCache.get(value);

if (cached !== undefined) {
  return rememberPlainText(value, cached);
}
```

A description that is the only field has to be read during the parse. Markup that leaves no text (`<br>`) is an empty result, the same as a missing description. When the feed already has a title, author, or image, the notes wait until the page shows them.

## Hand the rest to DOMParser

`readHtmlText` in `src/utils/htmlText.ts` returns the text a document's body would expose for ordinary markup. Null means the fragment is outside what the scan claims. The caller then uses `DOMParser`, so the text stays the same.

```ts
const scanned = readHtmlText(prepared);

if (scanned !== null) {
  text = scanned;
} else {
  descriptionParser ??= new DOMParser();
  text = descriptionParser.parseFromString(prepared, 'text/html').body.textContent ?? '';
}
```

A space is inserted before `br`, `/p`, `/div`, `/li`, and heading closers before either reader runs. That space survives as text once the tag is gone, so adjacent paragraphs do not run together, and the two readers stay in agreement.

The scan refuses these tags, and any character reference it does not know completely:

```ts
const RAW_TAGS = new Set([
  'script',
  'style',
  'title',
  'template',
  'textarea',
  'xmp',
  'iframe',
  'noembed',
  'noframes',
  'plaintext',
  'svg',
  'math',
]);
```

Script, style, title, and template land in the document head, so their contents were never part of `body.textContent`. The scanner returns null for them instead of guessing, and `toPlainText` then matches the document:

```ts
expect(readHtmlText('<script>alert(1)</script>Shown')).toBeNull();
expect(readHtmlText('<style>p{}</style>Hi')).toBeNull();
expect(readHtmlText('<svg><text>icon</text></svg>')).toBeNull();
expect(readHtmlText('<p>Ordinary</p>')).toBe('Ordinary');
```

```ts
expect(toPlainText('<script>alert(1)</script>Shown as text')).toBe('Shown as text');
expect(toPlainText('<style>p{color:red}</style>Hi')).toBe('Hi');
```

`DOMParser` runs with scripting disabled. Scripts do not run and images do not load. `<noscript>` is ordinary markup in that mode, and its text is kept.

A name that is only a prefix of a real reference refuses the scan, so the HTML parser can apply the longest-match rule. `&ampere;` stays `&ere;` rather than being guessed.

The comment on `toPlainText` says building a document per episode is what janks a feed of long show notes, and a worker cannot host `DOMParser`. Markup the string reader will not claim still goes through `DOMParser`. The scan itself needs no DOM, and copying a multi-megabyte feed across threads costs more than doing it here.

## The two lines on screen stay in CSS

The full note is still what gets shown. The two-line clamp stays in CSS, so find-in-page and screen readers keep the rest. The long-notes fixture checks that the scan reads the tail:

```ts
// The tail is still there: the scan does not stop at the two lines on screen.
expect(text.endsWith('Episode 7.')).toBe(true);
```

## An independent DOMParser is the oracle

The tests compare `toPlainText` with `domPlainText`, which calls `DOMParser` itself, including hostile markup. A faster reader cannot pass by being compared with itself.

```ts
text =
  new DOMParser().parseFromString(text.replace(blockBoundary, ' $&'), 'text/html').body
    .textContent ?? '';
```

A long show-notes fixture asserts the scanner does not call `parseFromString`. A feed of notes that do need the parser asserts nothing is parsed until `description` is read, and a second read does not parse again:

```ts
expect(parseFromString).not.toHaveBeenCalled();
expect(items[0].description).toBe('One');
expect(parseFromString).toHaveBeenCalledTimes(1);
// The same episode's notes are already plain text.
expect(items[0].description).toBe('One');
expect(parseFromString).toHaveBeenCalledTimes(1);
```

281 tests passed, lint reported no new warnings, and the production build succeeded.

## What I would repeat

- **Defer the parse.** A visible row, the podcast header, or the offline short copy is what reads `description`. The other episodes can wait.
- **Return null when the scan would guess.** Script and style contents stay out because the document puts those elements in the head. The scanner refuses the tags and `DOMParser` does the omission.
- **Leave the clamp in CSS.** Cutting the note while parsing would take it away from find-in-page and screen readers.
- **Skip the worker when the fallback needs DOM.** The copy of a multi-megabyte feed costs more than this scan, and a worker has no `DOMParser`.
