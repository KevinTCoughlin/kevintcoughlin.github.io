---
published: 2026-12-02T16:00:00Z
tags:
  - web
  - http
  - tips
---

# Accept.includes treated image/avif;q=0 as AVIF

In [Bauhaus](https://github.com/cascadiacollections/bauhaus), `negotiateFormat` used `Accept.includes("image/avif")`. `image/avif;q=0` selected AVIF, and a higher JPEG `q` lost. The change is [bauhaus#202](https://github.com/cascadiacollections/bauhaus/pull/202) ([`18ef0bb`](https://github.com/cascadiacollections/bauhaus/commit/18ef0bb963fdb8c4aa271e669fe4066985ce3c4a)).

## The substring was the whole check

The worker returned on the first hit:

```
const accept = request.headers.get("Accept") ?? "";
if (accept.includes("image/avif")) return "avif";
if (accept.includes("image/webp")) return "webp";
return "jpeg";
```

`image/avif;q=0` means do not send AVIF. The characters `image/avif` are still in the header, so the worker sent AVIF. A client that cannot decode it gets a broken image. Quality was never read. `image/avif;q=0.5, image/jpeg;q=1` contains `image/avif`, so AVIF won over the higher JPEG `q`.

## A q of 0 does not win

Named types are parsed with their `q`. A missing `q` is 1, and the number is clamped into 0 through 1. The best `q` so far starts at 0, so a candidate has to beat 0:

```
let best: ImageFormat | null = null;
let bestQ = 0;
for (const format of NEGOTIATED_FORMATS) {
  const q = explicitAcceptQuality(accept, FORMAT_CONTENT_TYPE[format]);
  // Equal q keeps the earlier format: AVIF, then WebP, then JPEG.
  if (q === null || q <= bestQ) continue;
  best = format;
  bestQ = q;
}
return best ?? "jpeg";
```

`NEGOTIATED_FORMATS` is `["avif", "webp", "jpeg"]`. Equal `q` keeps the earlier format. `?format=avif`, `webp`, or `jpeg` still returns before the header is read.

The helper counts a part only when the type is exactly the mime it was asked about:

```
if (typeRaw.trim().toLowerCase() !== mime) continue;
```

`*/*` and `image/*` are not those names, so they are not a request for AVIF. The first mention of a type is the one that sticks, so a later duplicate cannot raise a `q=0`. The doc comment splits those wildcards, because `*/` would end the block comment:

```
 * A wildcard (`*` / `*`) or `image/` + `*` is not a match.
```

curl and the wallpaper one-liners send `*/*` and get JPEG, which is what they can decode. On macOS, KDE, and GNOME those one-liners are `curl -sfo /tmp/bauhaus.jpg`.

## What the tests pin

`image/avif;q=0, image/webp, image/jpeg` selects WebP. Both of the others default to `q=1`, and WebP is earlier. `image/avif;q=0.5, image/jpeg;q=1` selects JPEG. `*/*` stays on JPEG. `image/jpeg;q=0.8, image/webp;q=0.8, image/avif;q=0.8` selects AVIF. A header that already named `image/avif` with no `q`, beside WebP, JPEG, and `*/*`, still selects AVIF.

The worker CI job runs `npx tsc --noEmit`, then `npm test`. That run reported 235 passed.

The EXIF allowlist on the published JPEG is a separate change, in [Pillow's convert() kept the camera GPS on the published original](https://kevintcoughlin.com/blog/pillow-convert-keeps-exif-gps/).

## What I would repeat

- **`includes` is not content negotiation.** `image/avif;q=0` still contains `image/avif`. That `q` means do not send AVIF.
- **Let the highest `q` win.** Start from 0 so `q=0` cannot. On a tie, AVIF, then WebP, then JPEG.
- **`*/*` stays on JPEG.** curl and the wallpaper one-liners save a `.jpg`. They do not ask for AVIF.
