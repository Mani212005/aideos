<!--
File Description: Explains the diagram-parts example package demonstrating ready-made diagram building blocks.
-->

# diagram-parts

A scene film demonstrating ready-made diagram building blocks (graphs, layer planes, charts, flowchart cards, and callouts) composed on a single persistent stage using sceneKit.

- `film.json`: the manifest, configuring a 1920 x 1920 square scene canvas and shots.
- `visuals/scene.svg`: static scene artwork compiled from diagram primitives in `backend/sceneKit/parts/`.
- `build.ts`: authoring script generating `visuals/scene.svg`.

Run `npm run design:check -- diagram-parts` to validate against the design system rules.
