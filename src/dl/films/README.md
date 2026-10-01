<!--
File Description: Explains src/dl/films/, a folder of generated film modules that is gitignored apart from this note.
-->

# src/dl/films/

Generated. Each `<slug>.ts` is a shadow of `videos/<slug>/film.json` (or `examples/<slug>/film.json`),
kept only because Remotion's CLI bundles code, not a JSON path. Do not edit them and do not commit
them: `npm run ensure:generated` (`scripts/ensure_generated.ts`) rewrites any that are missing or
stale, and `backend/pipeline/filmStore.ts`'s `writeFilm` keeps them in step on every save.
