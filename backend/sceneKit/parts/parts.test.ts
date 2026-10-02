import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { drawGraph } from "./graph";
import { LayerPlanes } from "./layerPlanes";
import { drawChart } from "./chart";
import { drawFlowCards } from "./flowCards";
import { drawCallout } from "./callout";

describe("sceneKit/parts", () => {
  it("renders graph", () => {
    const svg = drawGraph("g1", [{ id: "n1", x: 10, y: 10 }], []);
    assert(svg.includes('<g id="g1"'));
    assert(svg.includes('<circle id="n1" cx="10" cy="10" r="6" fill="#F5F5F5"'));
  });

  it("renders layerPlanes", () => {
    const lp = new LayerPlanes({ id: "lp1" });
    const svg = lp.drawPlanes();
    assert(svg.includes('<g id="lp1"'));
    assert(svg.includes('<polygon id="lp1-plane-0"'));
  });

  it("renders chart", () => {
    const svg = drawChart({ id: "c1", x: 0, y: 0, w: 100, h: 100, data: [{x: 0, y: 0}, {x: 1, y: 1}], dotProgress: 0.5 });
    assert(svg.includes('<g id="c1"'));
    assert(svg.includes('<path id="c1-curve"'));
    assert(svg.includes('<circle id="c1-dot"'));
  });

  it("renders flowCards", () => {
    const svg = drawFlowCards("fc1", [{ id: "c1", x: 0, y: 0, w: 100, h: 50, label: "A" }], []);
    assert(svg.includes('<g id="fc1"'));
    assert(svg.includes('<rect id="c1-rect" x="0" y="0" width="100" height="50"'));
    assert(svg.includes('>A</text>'));
  });

  it("renders callout", () => {
    const svg = drawCallout({ id: "co1", x: 50, y: 50, labelX: 100, labelY: 10, label: "Hi" });
    assert(svg.includes('<g id="co1"'));
    assert(svg.includes('<line id="co1-line" x1="50" y1="50" x2="100" y2="10"'));
    assert(svg.includes('>Hi</text>'));
  });
});
