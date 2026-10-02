import fs from "fs";
import { drawGraph, LayerPlanes, drawChart, drawFlowCards, drawCallout } from "../../backend/sceneKit/parts";
import { g } from "../../backend/sceneKit/svg";

const lp = new LayerPlanes({ id: "lp", layers: 3, cx: 960, tilt: 0.8 });
const planesSvg = lp.drawPlanes();

const graphSvg = drawGraph("graph", 
  [{id: "n1", x: 800, y: 500}, {id: "n2", x: 1100, y: 500}], 
  [{id: "e1", sourceId: "n1", targetId: "n2"}]
);

const chartSvg = drawChart({ id: "chart", x: 400, y: 400, w: 200, h: 150, data: [{x:0, y:0}, {x:1, y:1}], dotProgress: 0.5 });

const cardsSvg = drawFlowCards("flow", 
  [{id: "c1", x: 100, y: 100, w: 150, h: 80, label: "Start"}], 
  []
);

const calloutSvg = drawCallout({ id: "co", x: 800, y: 500, labelX: 850, labelY: 450, label: "Node" });

const doc = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1920" width="1920" height="1920">
  <rect width="1920" height="1920" fill="#0A0A0B"/>
  ${planesSvg}
  ${graphSvg}
  ${chartSvg}
  ${cardsSvg}
  ${calloutSvg}
</svg>
`;

fs.writeFileSync("examples/diagram-parts/visuals/scene.svg", doc);
console.log("Built examples/diagram-parts/visuals/scene.svg");
