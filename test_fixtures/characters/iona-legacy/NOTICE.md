# Iona art v1 (frozen legacy reference)

`iona-art-v1.js` is byte-identical to the module the merged P0 stage rendered
(sha256 `e3ca9debc7df90774ac05a9d97939a2ed7b8fe5f0d5360c1184367ac374ac75c`). Iona is now
data: `characters/iona.character.json`, built by `src/dl/scene/characters/`. This file is
kept only as the golden reference that proves the promotion changed nothing: the character
tests compare every mesh, material, outline and joint, and the browser test compares pixels.
Nothing in production imports it. Original procedural art authored for aideos, MIT, under the
repository LICENSE.
