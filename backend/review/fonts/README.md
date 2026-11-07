# Vendored Geist (weight 700)

The review measures caption words in Geist 700, the render's caption face. The measuring page embeds
these files instead of fetching them from `fonts.gstatic.com`: a stalled connection to the font CDN
leaves headless Chrome waiting until the caller's 25 second kill, which failed
`backend/captionPlacement.test.ts` with `Could not measure caption words: spawnSync ... ETIMEDOUT`.

Each file is the upstream file `@remotion/google-fonts/Geist` lists for weight 700, named
`<subset>-<upstream file name>`. If a Remotion upgrade changes those URLs, measuring throws and names
the missing file; download it from the URL in the error into this folder under that name.

Geist is licensed under the SIL Open Font License 1.1, see `OFL.txt`.
