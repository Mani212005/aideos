# Three stage character gates follow-up

Draft PR description and test plan, recorded before implementation. This follow-up closes the
additional-character evidence gap left by P2 without changing the character schema or look plan.

## Change summary

The existing stage gate resolves each embedded character spec through the shared character adapter,
declares that character's palette and the prop's colors, and measures the evaluated meshes through
the shared projection owner. This follow-up makes the deferred Pip and Marlo evidence reproducible:
J4 checks their real design builds through recovery in both crops, and the pixel harness compares
their decisive-pose stage stills with four small committed PNGs. Unit coverage pins the character
palette behavior and its undeclared-color rejection. The CI and character test docs now point to the
new coverage.

## User journeys, risks and tests

| Journey | Risk | Test evidence |
| --- | --- | --- |
| J4: Iona, Pip and Marlo carry the receive action through wide and reel crops | A character-specific proportion, outline or prop crosses the safe square or caption band while the placement anchor still looks valid, or the glider detaches or hides after contact | `backend/journeys/j4_character_crops.journey.ts` builds each character through the real design compiler and checks every evaluated frame from approach through recovery using the shared projected mesh bounds. It checks airborne-to-attached contact and exposed carried-prop depth, a clear inset and an inset overlap, and a deliberately out-of-bounds placement that must fail the design gate. |
| J5: additional characters remain drawable in the real stage | The design check passes from geometry facts while a renderer or crop produces an empty or malformed stage | `backend/characters/pixels.test.ts` renders the decisive attached pose for Pip and Marlo in wide and reel formats, checks those stills against committed PNG evidence, and requires visible character and prop pixels. |
| J8: a character palette declaration is enforced | An undeclared material color on one character silently bypasses the palette gate | `backend/performance/stage.test.ts` confirms the built character meshes fit that character's declared palette and the material checker rejects a rogue color against the same palette; the J4 builds exercise all three characters through `checkFilmDesign`. |

## Risks this list may miss

- Numerical bounds prove projected geometry and outline clearance, but do not prove facial appeal,
  finger contact or exact raster visibility. The additional stills provide visual evidence; human
  review remains necessary for art quality.
- The shared action is authored from Iona. Pip can require the existing clamp policy, and its
  warnings remain visible in the design build; this follow-up does not change retarget behavior.
- Still pixels can vary slightly by browser or software GL implementation. Assertions use the
  existing measured tolerance and structural visibility checks, while the geometry journey remains
  platform independent.
- The earlier journey inventory still had an empty J5 TODO even though the character engine already
  covered multi-character retarget and design builds. This follow-up removes that stale TODO; J4 now
  checks the stage gates for all three committed characters.
