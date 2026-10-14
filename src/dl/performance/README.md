<!--
File Description: Architecture and verification reference for sparse constrained character performances.
-->

# Sparse performances

This is the first renderer-independent action experiment: Iona receives the approved
paper glider. `types.ts` is the serializable action/rig contract, `iona.ts` owns bind
proportions, `receive.ts` owns sparse choreography, `evaluate.ts` owns the absolute-frame
constraint solve, and `critique.ts` measures numerical obligations. Nothing here imports
Three.js, Node, Remotion, the production film schema, or the editor.

The receive is authored once on Iona and retargeted onto any `aideos.character/1` rig by
`retarget.ts` (see `docs/CHARACTER_ENGINE.md`); limits geometry is shared in `limits.ts`.

Use `backend/performance/bindReceive.ts` at the authoring boundary. It calls
`backend/sceneKit/timing.ts`'s existing `createCues().word()` resolver, then places contact
at that absolute frame. There is no second phrase parser or timing authority. The small
`backend/performance/fixture.ts` spine is illustrative timing data, not a recorded narration.

```ts
const action = bindReceive(timing, { shotId: 'catch', phrase: 'catches' });
const evaluate = createPerformanceEvaluator(IONA_RIG, action);
const pose = evaluate(69); // Fractional frames and arbitrary seek order also work.
```

The definition names setup, anticipation, intercept, contact, recoil and settle anchors.
Vector paths specify root position/rotation, body channels and wrist grip targets. Limb
constraints solve those targets with the rig's actual bind-vector lengths. A wrist is the
IK effector; `contact.gripOffset` locates the physical palm grip below it. Planted ankle
targets are fixed in the starting root's world space, including when the root moves.
Unreachable targets clamp the solve without stretching and fail the grip-path critique.
At contact the glider switches from flight to a wrist-relative rigid attachment derived
from the solved contact pose. Its keel meets the palm at that switch and stays attached.

Before contact, cue retiming scales the preparation to the resolved word. Recovery keeps
its authored seconds, including the deliberate final hold. The binding rejects narration
that ends before the action finishes. Missing words and incompatible rigs fail explicitly.
The prepared evaluator copies its inputs, returns fresh transforms and has no simulation
history, random calls, disk reads or camera input. Values hold at both span endpoints.

We chose typed plain records under `src/dl/performance/` because the existing scene engine
keeps deterministic frame math under `src/dl/` and filesystem/authoring work in `backend/`.
The recovered geometry lives in `test_fixtures/performance/iona/`; for the opt-in Three
stage integration (P0) mounting Iona in FilmView, see `docs/THREE_STAGE_P0.md`.
The standalone browser adapter remains an isolated verification tool.

## Validation

```sh
npm run performance:check
npm test
npm run lint
npm run smoke:studio
npm run performance:filmstrip
python3 -m http.server 8781 --directory .frames/iona-performance
```

The filmstrip renders actual cel pixels at eight frames using the archived approved rig
and fixed camera. Its left side uses unchanged approved source by default. To compare
against the actual approved MP4 restored from the art-proof archive:

```sh
npm run performance:filmstrip -- --reference-clip <restored-cel.mp4>
```

FFmpeg extracts exact numbered frames; previously captured frames of the same clip bytes
are retained. The local output stays under `.frames/`. The command stops below 3 GB free.
No new video, model, paid API or dependency install is needed. Three.js is bundled only
with this small fixture, with its MIT notice. The archived dots module is retained solely
because the unchanged reference source imports it; the candidate filmstrip is cel only.

The numerical critique checks fixed bone lengths, planted feet, authored grip-path error,
prop attachment, the independently supplied decisive cue, position/rotation/velocity at
all track and phase seams, repeated/reverse/parity seek order, and frozen half-second
windows during active motion. It explicitly excludes the declared final settled hold
from frozen detection. Ten damaged evaluator fixtures fail their respective obligations.
Tolerances are listed in every report. The cue must be independently resolved by the caller,
not copied from an action being checked. `visualQuality: "unmeasured"` prevents a numerical
pass from claiming art, deformation, acting, occlusion or finger-contact acceptance.

The fixture preserves the approved key poses, rig, artwork, camera and attachment. Three
interpolation repairs are deliberate: C1 smoothstep replaces the proof's ease-out starts
which jump in velocity, the flight twist decays smoothly to zero at attachment, and
in-between elbow pole keys roll each elbow at an even rate. The original left pole ran within
2 degrees of the arm's axis at frame 61, flipping the elbow's bend plane by about 160 degrees
in two frames (0.80 rig units in one frame) and again in the recoil; the `pole-clearance`
obligation now fails any limb whose pole comes within about 7 degrees of its axis. Peak joint
speed fell from 27.8 to 7.9 units per second; the approved keys, contact pose and settled
hold are unchanged. This is a constrained reproduction of the catch, not a pixel-identical
recreation of its timing.
At the inspected anchor frames, maximum joint-position difference from the unchanged
source was below 3e-15 world units. The midpoint at frame 57 differs by up to 0.840264
world units because the new reach starts smoothly. Contact is still frame 69; the planted
feet, glider/palm connection and final silhouette remain the same. These are measured
geometry differences and direct filmstrip observations, not a new human quality approval.
