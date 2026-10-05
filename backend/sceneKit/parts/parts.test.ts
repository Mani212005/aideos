/**
 * File Description: Unit tests for sceneKit ready-made diagram building blocks.
 * Inputs and outputs: diagram part generation parameters -> test assertions.
 * Used by: npm test.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { drawGraph } from "./graph";
import { LayerPlanes } from "./layerPlanes";
import { drawChart } from "./chart";
import { drawFlowCards } from "./flowCards";
import { drawCallout } from "./callout";

describe("sceneKit/parts", () => {
  it("renders graph with nodes, edges, and labels", () => {
    const svg = drawGraph("g1", [{ id: "n1", x: 10, y: 10, label: "Node 1" }], [{ id: "e1", sourceId: "n1", targetId: "n1" }]);
    assert(svg.includes('<g id="g1"'));
    assert(svg.includes('<circle id="n1" cx="10" cy="10" r="6" fill="#F5F5F5"'));
    assert(svg.includes('>Node 1</text>'));
  });

  it("renders layerPlanes with customized layers count", () => {
    const lp = new LayerPlanes({ id: "lp1", layers: 4 });
    const svg = lp.drawPlanes();
    assert(svg.includes('<g id="lp1"'));
    assert(svg.includes('<polygon id="lp1-plane-0"'));
    assert(svg.includes('<polygon id="lp1-plane-3"'));
  });

  it("renders chart and clamps dotProgress bounds safely", () => {
    const svg = drawChart({ id: "c1", x: 0, y: 0, w: 100, h: 100, data: [{x: 0, y: 0}, {x: 1, y: 1}], dotProgress: 1.5 });
    assert(svg.includes('<g id="c1"'));
    assert(svg.includes('<path id="c1-curve"'));
    assert(svg.includes('<circle id="c1-dot"'));

    const svgNegative = drawChart({ id: "c2", x: 0, y: 0, w: 100, h: 100, data: [{x: 0, y: 0}, {x: 1, y: 1}], dotProgress: -0.5 });
    assert(svgNegative.includes('<circle id="c2-dot"'));
  });

  it("renders flowCards with card labels and edge labels", () => {
    const svg = drawFlowCards("fc1", [{ id: "c1", x: 0, y: 0, w: 100, h: 50, label: "A" }, { id: "c2", x: 200, y: 0, w: 100, h: 50, label: "B" }], [{ id: "e1", sourceId: "c1", targetId: "c2", label: "Next" }]);
    assert(svg.includes('<g id="fc1"'));
    assert(svg.includes('<rect id="c1-rect" x="0" y="0" width="100" height="50"'));
    assert(svg.includes('>A</text>'));
    assert(svg.includes('>Next</text>'));
  });

  it("renders callout", () => {
    const svg = drawCallout({ id: "co1", x: 50, y: 50, labelX: 100, labelY: 10, label: "Hi" });
    assert(svg.includes('<g id="co1"'));
    assert(svg.includes('<line id="co1-line" x1="50" y1="50" x2="100" y2="10"'));
    assert(svg.includes('>Hi</text>'));
  });
});
