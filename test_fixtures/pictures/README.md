<!--
File Description: Explains the picture fixtures of the illustrated stage tests (synthetic images, never generated art).
-->

# Picture fixtures

- `text-signal.png` (240 x 80, about 4 KB): the word SIGNAL in Geist Bold, dark on a light card. It is the case the
  design check's no-text rule must catch (`backend/designCheck/pictures.test.ts`). It was drawn by the native renderer
  from `text-signal.render.json`:
  `native/target/release/aideos-render test_fixtures/pictures/text-signal.render.json --frame 0 --package <dir with fonts/Geist-latin.ttf> --out text-signal.png`.

The fixture film's pictures (a plate, an orb and a chip) live in `test_fixtures/packages/pictures-stage/visuals/generated/`
and are drawn pixel by pixel in `backend/testSupport/pictureFixtures.ts`.
