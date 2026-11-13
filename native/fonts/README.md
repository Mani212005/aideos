<!--
File Description: Provenance of the two variable fonts the native renderer sets every film's type in, and how to refresh them.
-->

# Native renderer fonts

The Remotion render loads Geist and JetBrains Mono from Google Fonts through `@remotion/google-fonts`
(`src/dl/tokens.ts`). Both are served as one variable `woff2` file per Unicode subset, the same file for
every weight. The native renderer must never fetch fonts, so it reads these vendored copies of exactly
those files instead. The emitter (`backend/renderIr/emit.ts`) declares one font asset per weight it uses,
all pointing at the same file, and the renderer sets the variable font's `wght` axis to that weight, as a
browser does for `font-weight`.

| File | Upstream file (`latin` subset) | Axis |
| --- | --- | --- |
| `Geist-latin.ttf` | `https://fonts.gstatic.com/s/geist/v5/gyByhwUxId8gMEwcGFU.woff2` (sha256 `19f9c925...d54e1`) | `wght` 100 to 900 |
| `JetBrainsMono-latin.ttf` | `https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbV2o-flEEny0FZhsfKu5WU4xD7OwE.woff2` (sha256 `18be4527...f6a7e`) | `wght` 100 to 800 |

Each `.ttf` is the upstream `woff2` unpacked losslessly to plain sfnt with fontTools
(`TTFont(src); font.flavor = None; font.save(dst)`), because Skia's FreeType cannot read `woff2`. The
outlines, metrics and kerning are the upstream ones. Only the `latin` subset is vendored: text outside it
has no glyph, since the renderer disables font fallback.

If a Remotion upgrade changes the URLs above (see `getInfo()` of `@remotion/google-fonts/Geist` and
`.../JetBrainsMono`), download the new `latin` files and unpack them the same way.

Both fonts are licensed under the SIL Open Font License 1.1: `Geist-OFL.txt`, `JetBrainsMono-OFL.txt`.
