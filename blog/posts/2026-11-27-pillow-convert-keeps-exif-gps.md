---
published: 2026-11-27T16:16:00Z
description: Bauhaus overwrote only title, artist, and copyright in EXIF. Converting the image kept the camera GPS, body serial, and maker notes on the published original.
tags:
  - python
  - tips
---

# Pillow's convert() kept the camera GPS on the published original

In [Bauhaus](https://github.com/cascadiacollections/bauhaus), `embed_exif` started from `image.getexif()` and only overwrote title, artist, and copyright. `Image.convert("RGB")` keeps the source EXIF, so `/api/<date>/original` was published with the camera's GPS IFD, body serial number, and maker notes. That is the file the Atom feed links as "Original". Unsplash photos, which the scheduled run uses when both museum sources fail, commonly carry GPS. The change is [bauhaus#200](https://github.com/cascadiacollections/bauhaus/pull/200) ([`7be86a6`](https://github.com/cascadiacollections/bauhaus/commit/7be86a655bb4c8291b1e634ead573c4083a9005c)).

## The JPEG was not on the allowlist

The metadata JSON was already an allowlist that drops GPS. The JPEG was not. A client that asked for the privacy-safe image and a client that fetched the original were not looking at the same promise.

`embed_exif` copied the image's own directory and wrote three fields over it:

```python
exif = image.getexif()
```

I reproduced that. `convert("RGB")` on a JPEG with a GPS IFD and `BodySerialNumber` still returned both.

## The landscape gate scored the stored raster

A portrait stored as a landscape raster with `Orientation=6` was measured by raw pixels, so it passed `landscapes_only` and would have been published as a wallpaper. Dropping the orientation tag without rotating the pixels would show that photo sideways.

## Start from an empty EXIF directory

Published JPEGs now start from an empty directory and embed only title, artist, and copyright:

```python
exif = Image.Exif()
```

`open_rgb` in `src/quality.py` applies EXIF orientation to the pixels before style transfer, the quality gate, and the published original. The landscape gate scores those upright dimensions. The source `Orientation` tag is no longer copied into `metadata.json`. `Orientation` was added to the deliberately omitted tag set next to `BodySerialNumber`, `LensSerialNumber`, and `CameraOwnerName`:

```python
_DELIBERATELY_OMITTED = frozenset({
    "BodySerialNumber", "LensSerialNumber", "CameraOwnerName", "Orientation",
})
```

`open_rgb` loads the bytes, applies `ImageOps.exif_transpose`, then converts to RGB. `convert()` may return the same object, so the helper copies when that RGB image is the source or the oriented image. The copy survives the source being closed:

```python
with Image.open(BytesIO(image_bytes)) as img:
    img.load()
    oriented = ImageOps.exif_transpose(img) or img
    rgb = oriented.convert("RGB")
    # convert() may return the same object. Copy so the result survives
    # the source image being closed.
    if rgb is img or rgb is oriented:
        rgb = rgb.copy()
    return rgb
```

Already published releases are immutable, so this protects new days.

After the change the published JPEG keeps title and artist, contains neither the serial nor a GPS IFD, and an `Orientation=6` raster of 1200x800 decodes as 800x1200. `uv run pytest` reported 314 passed and 4 skipped.

## What I would repeat

- **`convert()` keeps EXIF.** Writing title, artist, and copyright over `image.getexif()` leaves the GPS IFD, the body serial number, and the maker notes in place.
- **Start from an empty directory and allowlist.** `Image.Exif()` plus those three fields is what the published JPEG carries. The JSON allowlist did not cover that file.
- **Bake orientation into the pixels first.** Run `ImageOps.exif_transpose` before dropping the tag or measuring width and height. A 1200x800 raster with `Orientation=6` is 800x1200 to a viewer.
