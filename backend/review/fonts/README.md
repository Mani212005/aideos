# Vendored Geist (weight 700)

The review measures caption words in Geist 700, the render's caption face. The measuring page embeds
these files instead of fetching them from `fonts.gstatic.com`. See [review documentation](../../../docs/REVIEW.md)
for the browser startup and timeout behavior.

Each file is the upstream file `@remotion/google-fonts/Geist` lists for weight 700, named
`<subset>-<upstream file name>`. If a Remotion upgrade changes those URLs, measuring throws and names
the missing file; download it from the URL in the error into this folder under that name.

Geist is licensed under the SIL Open Font License 1.1, see `OFL.txt`.
