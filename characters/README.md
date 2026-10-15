<!--
File Description: Authoring guide for aideos.character/1 specs: brief, spec, check, sheet and film use, with a verified starter spec.
-->

# Characters

A character is one JSON file, `<id>.character.json`, in the `aideos.character/1` format. It
is data, not code: skeleton proportions, sockets, joint limits, palette, outline, face,
expressions, views and a list of procedural parts. The engine builds the cel-shaded geometry,
the rig and the fitted receive action from it. Architecture, journeys and risks are in
[docs/CHARACTER_ENGINE.md](../docs/CHARACTER_ENGINE.md).

| Where | What |
|---|---|
| `characters/` | The shared library. `iona.character.json` is the approved quality bar. |
| `videos/<slug>/characters/` | A film's own characters. A package spec wins over a library spec with the same id. |
| `test_fixtures/characters/` | `pip` (child-proportion mascot) and `marlo` (tall adult): worked examples to copy. |

## The loop: brief, spec, check, sheet

1. **Brief.** Write two or three sentences into `description`: who it is, how many heads tall,
   the silhouette idea, the palette, one or two distinguishing features. Height and silhouette
   should differ from the existing cast at a glance (Iona 6 heads, Pip 3, Marlo 7.5).
2. **Spec.** Copy the starter below, or the closest fixture, into the film package as
   `videos/<slug>/characters/<id>.character.json`, change `id`, then edit proportions, palette,
   face and parts. Leave `hash` out while drafting.
3. **Check.** `aideos character check <file-or-id>` validates everything and names the field
   behind every problem (`skeleton.proportions.hips: the rest pose leaves soleL above the ground
   by 0.3000; set hips y to 3.2`). When only the hash is missing, `--stamp` writes it. Any later
   edit, even a colour, changes the content hash, so check and stamp again. The report also gives
   joints, meshes, triangles (budget 120000), heads tall and whether `receive-v1` fits.
4. **Sheet.** `aideos character sheet <file-or-id>` renders, with the stage's own builder and
   projection, into `.frames/characters/<id>/`: `model-sheet.png` (front, three-quarter, side,
   silhouette), `expression-sheet.png`, and the receive at contact in `receive-wide.png` and
   `receive-reel.png` plus a six-phase `receive-strip.png`. Look at every image before using the
   character. `--clamp` draws a character whose limits need clamping; `--placement x,y,units`
   matches a design's stage placement.

## Using a character in a film

In `design/design.json` (schema `aideos.design/2`) a character asset names the spec by id:

```json
{ "id": "juno", "renderer": "three", "kind": "character", "character": "juno", "position": [940, 1210], "unitsToStage": 85, "treatment": "cel-v1" }
```

`position` is where the character's feet (the rig origin) stand on the 1920 square stage;
`unitsToStage` is stage pixels per rig unit, so the same value keeps relative heights honest. In
`design/look.json` the cast item carries `"character": "juno"` too. A performance may set
`"limits": "clamp"`; the default `"fail"` refuses a character whose reach, hinge or rotation
limits cannot hold the action and names the limit, joint and frame. Clamping fits the action
inside the limits by editing sparse keys and the build reports every clamp as a warning.
`aideos design build <slug>` resolves the spec (package first, then library), verifies its hash,
embeds the verified spec in the compiled film and runs the design check in both crops. The
browser re-verifies that embedded copy before it draws anything, so a hand-edited film is
refused rather than rendered. A P0 design that names `"asset": "iona-art-v1"` still builds and
resolves to Iona.

There is no separate performance-count cap. The design schema bounds a stage to 40 total assets
and 1500 authored clips, which bound the package's stage workload.

## Field reference

| Field | Meaning |
|---|---|
| `schema`, `id`, `version`, `hash` | Identity. The rig id is `<id>-v<version>`; `hash` is sha256 of the canonical spec without it. |
| `skeleton.proportions` | Each humanoid joint's rest offset from its parent in rig units (y up, z toward camera), left side only; the right side mirrors x. Joints: hips, spine, chest, neck, head, shoulder, elbow, wrist, fingers, thumb, hip, knee, ankle. Bone lengths are the offset lengths. |
| `skeleton.extraJoints` | Accessory joints (`id`, `parent`, `offset`) after the humanoid ones. |
| `sockets` | `gripL`/`gripR` on the wrists (the palm point that holds a prop) and `soleL`/`soleR` on the ankles (the point that touches the ground). The rest pose must put both soles at y = 0. |
| `limits` | `reach` (largest fraction of a limb's length), `bend.arm`/`bend.leg` (hinge flexion range in radians, 0 is straight) and `rotation.<joint>` (Euler XYZ min and max). |
| `palette`, `outline`, `silhouette` | Named `#rrggbb` material tokens; outline colour token and default width; silhouette fill for the sheet. |
| `views` | Model-sheet yaw in radians for `front`, `threequarter`, `side` and optional `back`. |
| `surfaces` | Cross-section profiles (local `y`, half-widths `rx`, `rz`) that torso tubes and clothing panels share. |
| `face` | The painted face: `base` and `skin` colours, `oval`, optional `ovalLine`, `blush` and `hairline` path, `brows`, `eyes` (`almond` or `round`, position, scale, iris gradient), `mouth`, and `span` (head width the texture covers; raise it for a big head). |
| `expressions` | Named presets: `eyeOpen`, `browTilt`, `browRaise`, `mouthCurve`, `mouthOpen`. `neutral` is required; `receive-v1` also plays `surprised`, `determined` and `relieved`. |
| `secondary` | Swinging pieces bound to an action channel: `rotation = gain x channel + bias` about `pivot`. `receive-v1` drives `coat` (trails from the hips: tails, skirt, tail), `tuft` (trails behind the head: ponytail, pom-pom) and `side` (beside the head: side lock, scarf end). |

## Parts

Every part names a `joint` and a palette `material`, and may set `shading` (`toon` or `flat`),
`ink` (outline width, 0 for none) and `doubleSided`.

| Type | Use |
|---|---|
| `tube` | Tapered elliptical tube along a smooth path: `points`, `radii` (number or `[x, z]`), `origin`, `segments`, `radial`, `caps`. Hair locks, boots, collars, buttons. |
| `head` | The one sculpted head; carries the painted face. Same fields as a tube, no material. |
| `limb` | A tube spanning one bone (`joint` to child `to`), with `start` and `bend` offsets, so it follows any proportions. |
| `torso` | A tube through a named surface profile; panels on that surface hug it. |
| `panel` | Clothing panel between edges `a` and `b` on a surface, lifted by `lift`. |
| `facets` | Explicit flat triangles for small hard pieces. |
| `hand` | Palm to the fingers joint, `fingers.count` curled fingers and a thumb. |

`{ "mirror": ["L", "R"], "parts": [...] }` expands its parts once per side in that order,
replacing `{side}` in ids and joints and mirroring authored x for R; `overrides.R["<id>"]`
replaces fields for one side (authored in left-side space). Common errors and their fixes:
`unknown joint` (spell a humanoid joint, with its side), `unknown palette token` (add it to
`palette`), `must be a child joint` (a limb's `to` must be the next joint down), `needs exactly
one head part`, `over the 120000 budget` (lower `segments` or `radial`).

## Starter

This spec passes `aideos character check --stamp` and performs `receive-v1`; the character
tests extract and verify it, so it cannot drift from the engine.

```json starter
{
  "schema": "aideos.character/1",
  "id": "juno",
  "version": 1,
  "name": "Juno",
  "description": "Starter courier about six heads tall: short dark bob with a swinging ponytail, plum jacket, grey trousers, white sneakers.",
  "treatment": "cel-v1",
  "skeleton": {
    "type": "humanoid",
    "proportions": {
      "hips": [0, 3, 0], "spine": [0, 0.65, 0], "chest": [0, 0.65, 0], "neck": [0, 0.55, 0], "head": [0, 0.6, 0],
      "shoulder": [0.48, 0.45, 0], "elbow": [0.3, -1, 0], "wrist": [0.26, -0.92, 0], "fingers": [0.03, -0.3, 0], "thumb": [-0.05, -0.11, 0.03],
      "hip": [0.24, -0.1, 0], "knee": [0.02, -1.38, 0], "ankle": [0, -1.22, 0]
    }
  },
  "sockets": {
    "gripL": { "joint": "wristL", "offset": [0, -0.36, 0.08] },
    "gripR": { "joint": "wristR", "offset": [0, -0.36, 0.08] },
    "soleL": { "joint": "ankleL", "offset": [0, -0.3, 0] },
    "soleR": { "joint": "ankleR", "offset": [0, -0.3, 0] }
  },
  "limits": {
    "reach": 0.995,
    "bend": { "arm": [0, 2.8], "leg": [0, 2.4] },
    "rotation": {
      "spine": { "min": [-0.5, -0.8, -0.4], "max": [0.6, 0.8, 0.4] },
      "head": { "min": [-0.6, -0.9, -0.5], "max": [0.6, 0.9, 0.5] }
    }
  },
  "palette": { "ink": "#141420", "skin": "#e8b996", "hair": "#2a2333", "plum": "#6a3d6e", "plumDeep": "#4e2b52", "grey": "#4a4f5c", "white": "#efeee8", "rose": "#c95f6f" },
  "outline": { "color": "ink", "width": 0.022 },
  "silhouette": { "fill": "#181622" },
  "views": { "front": 0, "threequarter": -0.62, "side": -1.5708 },
  "surfaces": { "body": { "y": [-0.65, 0, 0.65, 1.2, 1.42], "rx": [0.36, 0.29, 0.36, 0.44, 0.16], "rz": [0.25, 0.2, 0.25, 0.23, 0.16] } },
  "face": {
    "base": "#d29f7c", "skin": "skin", "oval": [0.02, 0.01, 0.35, 0.42],
    "blush": { "color": "#e07a70", "alpha": 0.14, "at": [0.2, -0.14], "size": [0.065, 0.032] },
    "hairline": { "color": "hair", "path": [["M", -0.55, -0.08], ["L", -0.4, -0.08], ["Q", -0.36, 0.2, -0.1, 0.26], ["Q", 0.15, 0.3, 0.36, 0.12], ["L", 0.55, -0.08], ["L", 0.55, 0.6], ["L", -0.55, 0.6]] },
    "brows": { "color": "hair" },
    "eyes": { "style": "almond", "at": [0.18, -0.02], "sclera": "#fbf8f0", "iris": ["#c49a6c", "#6b4226", "#2e1b10"], "pupil": "#120b07", "line": "ink" },
    "mouth": { "line": "#5a2630", "inner": "#7a3040" }
  },
  "expressions": {
    "neutral": { "eyeOpen": 0.8, "browTilt": 0.05, "browRaise": 0, "mouthCurve": 0.012, "mouthOpen": 0 },
    "surprised": { "eyeOpen": 1.15, "browTilt": -0.4, "browRaise": 0.05, "mouthCurve": 0, "mouthOpen": 0.07 },
    "determined": { "eyeOpen": 0.62, "browTilt": 0.5, "browRaise": -0.01, "mouthCurve": -0.012, "mouthOpen": 0 },
    "relieved": { "eyeOpen": 0.3, "browTilt": -0.25, "browRaise": 0.02, "mouthCurve": 0.034, "mouthOpen": 0 }
  },
  "secondary": [
    { "channel": "tuft", "parts": [{ "part": "ponytail", "pivot": [0, 0.15, -0.5], "gain": [[1, 0, 0], [0, 0, 0], [0, 1, 0]] }] }
  ],
  "parts": [
    { "type": "torso", "id": "jacket", "joint": "spine", "material": "plum", "ink": 0.026, "surface": "body", "center": [0, 0, 0] },
    { "type": "panel", "id": "zip", "joint": "spine", "material": "plumDeep", "ink": 0, "doubleSided": true, "surface": "body", "a": [[-0.03, 1.15], [-0.03, 0.4], [-0.03, -0.6]], "b": [[0.03, 1.15], [0.03, 0.4], [0.03, -0.6]], "lift": 0.05, "steps": 4 },
    { "type": "tube", "id": "neckSkin", "joint": "neck", "material": "skin", "ink": 0.012, "points": [[0, 0, 0], [0, 0.45, 0.02]], "radii": [0.11, 0.1] },
    { "type": "tube", "id": "collar", "joint": "neck", "material": "plumDeep", "ink": 0.016, "points": [[0, -0.06, 0], [0, 0.16, 0]], "radii": [[0.23, 0.21], [0.19, 0.18]], "segments": 4, "radial": 24 },
    { "type": "head", "id": "head", "joint": "head", "ink": 0.02, "points": [[0, -0.48, 0.24], [0, -0.42, 0.18], [0, -0.3, 0.1], [0, -0.14, 0.03], [0, 0.05, 0], [0, 0.25, -0.01], [0, 0.4, -0.02], [0, 0.5, -0.02], [0, 0.54, -0.02]], "radii": [[0.05, 0.06], [0.14, 0.15], [0.26, 0.26], [0.36, 0.35], [0.4, 0.4], [0.41, 0.41], [0.37, 0.39], [0.22, 0.27], [0.03, 0.04]] },
    { "type": "tube", "id": "nose", "joint": "head", "material": "skin", "shading": "flat", "ink": 0.004, "points": [[0, -0.02, 0.36], [0, -0.11, 0.43], [0, -0.15, 0.44]], "radii": [[0.03, 0.026], [0.036, 0.03], [0.04, 0.034]], "segments": 14, "radial": 14, "caps": [0.35, 0.5] },
    { "type": "tube", "id": "hairMass", "joint": "head", "material": "hair", "ink": 0.022, "points": [[0, -0.32, -0.1], [0, -0.13, -0.14], [0, 0.06, -0.15], [0, 0.25, -0.12], [0, 0.4, -0.09], [0, 0.5, -0.07], [0, 0.57, -0.07]], "radii": [[0.3, 0.25], [0.42, 0.38], [0.45, 0.42], [0.45, 0.42], [0.4, 0.4], [0.26, 0.29], [0.03, 0.04]], "segments": 28, "radial": 28, "caps": [1, 0.2] },
    { "type": "tube", "id": "ponytail", "joint": "head", "material": "hair", "ink": 0.014, "points": [[0, 0.15, -0.5], [0.02, -0.1, -0.68], [0.06, -0.42, -0.72]], "radii": [[0.12, 0.1], [0.1, 0.08], [0.02, 0.02]], "segments": 16, "radial": 12 },
    { "mirror": ["L", "R"], "parts": [
      { "type": "limb", "id": "upperArm{side}", "joint": "shoulder{side}", "to": "elbow{side}", "material": "plum", "ink": 0.02, "start": [-0.02, 0.08, 0], "radii": [[0.16, 0.15], [0.13, 0.12], [0.11, 0.105]] },
      { "type": "limb", "id": "foreArm{side}", "joint": "elbow{side}", "to": "wrist{side}", "material": "plum", "ink": 0.018, "radii": [[0.11, 0.105], [0.095, 0.09], [0.085, 0.08]] },
      { "type": "hand", "joint": "wrist{side}", "material": "skin",
        "palm": { "radii": [[0.078, 0.034], [0.07, 0.03]] },
        "fingers": { "count": 4, "spacing": 0.039, "lengths": [0.9, 1, 0.95, 0.75], "curls": [0.5, 0.75, 0.95, 0.7], "radii": [0.019, 0.016, 0.011], "reach": [0.14, 0.25], "depth": [0.035, 0.05, 0.07], "fan": [1.2, 1.4], "shift": [0.012, 0.02] },
        "thumb": { "points": [[0, 0, 0], [-0.04, -0.13, 0.04], [-0.02, -0.23, 0.07]], "radii": [0.023, 0.019, 0.012] } },
      { "type": "limb", "id": "thigh{side}", "joint": "hip{side}", "to": "knee{side}", "material": "grey", "ink": 0.02, "start": [0, 0.1, 0], "radii": [[0.24, 0.22], [0.2, 0.19], [0.16, 0.15]] },
      { "type": "limb", "id": "shin{side}", "joint": "knee{side}", "to": "ankle{side}", "material": "grey", "ink": 0.018, "radii": [[0.16, 0.15], [0.13, 0.13], [0.1, 0.1]] },
      { "type": "tube", "id": "shoe{side}", "joint": "ankle{side}", "material": "white", "ink": 0.018, "points": [[0, -0.16, -0.1], [0, -0.2, 0.28], [0, -0.22, 0.56]], "radii": [[0.12, 0.14], [0.12, 0.1], [0.08, 0.08]] }
    ] }
  ]
}
```
