import type { Film } from "../schema";

export const ragExplainerFilm: Film = {
  "schemaVersion": "1.0.0",
  "id": "rag-explainer",
  "title": "RAG, in four steps",
  "fps": 30,
  "accent": "#FF5A1F",
  "theme": {
    "background": "smooth-dark",
    "fontFamily": "geist",
    "videoType": "educational",
    "storyStyle": "script-metaphor",
    "accent": "#FF5A1F"
  },
  "chapters": [
    "the problem",
    "the fix",
    "the pipeline",
    "the answer",
    "the catch"
  ],
  "canvas": {
    "nodes": [
      {
        "id": "docs",
        "label": "your documents",
        "sub": "chunked and embedded",
        "x": 60,
        "y": 300,
        "w": 220,
        "h": 62
      },
      {
        "id": "retrieve",
        "label": "top-k retrieval",
        "sub": "nearest chunks to the question",
        "x": 420,
        "y": 300,
        "w": 250,
        "h": 62
      },
      {
        "id": "answer",
        "label": "grounded answer",
        "sub": "with a source",
        "x": 820,
        "y": 300,
        "w": 220,
        "h": 62
      }
    ],
    "edges": [
      {
        "from": "docs",
        "to": "retrieve",
        "dashed": false
      },
      {
        "from": "retrieve",
        "to": "answer",
        "dashed": false
      }
    ]
  },
  "scene": {
    "schemaVersion": "1.0.0",
    "sceneId": "rag-explainer",
    "fps": 30,
    "durationFrames": 1976,
    "audioSource": "videos/rag-explainer/voiceover.wav",
    "audioDurationMs": 65867,
    "sceneSize": {
      "w": 1920,
      "h": 1920
    },
    "background": {
      "assetId": "backdrop",
      "svgSource": "videos/rag-explainer/visuals/backdrop.svg",
      "layer": 0,
      "position": {
        "x": 0,
        "y": 0
      },
      "scale": 1,
      "rotation": 0,
      "opacity": 1
    },
    "props": [
      {
        "assetId": "liar",
        "svgSource": "videos/rag-explainer/visuals/liar.svg",
        "layer": 2,
        "position": {
          "x": 0,
          "y": 0
        },
        "scale": 1,
        "rotation": 0,
        "opacity": 1,
        "animation": {
          "timelineId": "liar-motion",
          "clips": [
            {
              "clipId": "root-opacity-0",
              "targets": [
                "root"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 382,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "axis-drawOn-1",
              "targets": [
                "axis"
              ],
              "property": "drawOn",
              "from": 0,
              "to": 1,
              "startFrame": 0,
              "durationFrames": 26,
              "easing": "expoOut"
            },
            {
              "clipId": "ticks-opacity-2",
              "targets": [
                "ticks"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 6,
              "durationFrames": 12
            },
            {
              "clipId": "dd-0-opacity-3",
              "targets": [
                "dd-0"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 2,
              "durationFrames": 8
            },
            {
              "clipId": "dd-1-opacity-4",
              "targets": [
                "dd-1"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 6,
              "durationFrames": 8
            },
            {
              "clipId": "dd-2-opacity-5",
              "targets": [
                "dd-2"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 10,
              "durationFrames": 8
            },
            {
              "clipId": "dd-3-opacity-6",
              "targets": [
                "dd-3"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 14,
              "durationFrames": 8
            },
            {
              "clipId": "dd-4-opacity-7",
              "targets": [
                "dd-4"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 18,
              "durationFrames": 8
            },
            {
              "clipId": "dd-5-opacity-8",
              "targets": [
                "dd-5"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 22,
              "durationFrames": 8
            },
            {
              "clipId": "dd-6-opacity-9",
              "targets": [
                "dd-6"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 26,
              "durationFrames": 8
            },
            {
              "clipId": "dd-7-opacity-10",
              "targets": [
                "dd-7"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 30,
              "durationFrames": 8
            },
            {
              "clipId": "dd-8-opacity-11",
              "targets": [
                "dd-8"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 34,
              "durationFrames": 8
            },
            {
              "clipId": "dd-9-opacity-12",
              "targets": [
                "dd-9"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 38,
              "durationFrames": 8
            },
            {
              "clipId": "cutoff-drawOn-13",
              "targets": [
                "cutoff"
              ],
              "property": "drawOn",
              "from": 0,
              "to": 1,
              "startFrame": 58,
              "durationFrames": 10
            },
            {
              "clipId": "cutoff-label-opacity-14",
              "targets": [
                "cutoff-label"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 62,
              "durationFrames": 10
            },
            {
              "clipId": "empty-opacity-15",
              "targets": [
                "empty"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 62,
              "durationFrames": 10
            },
            {
              "clipId": "empty-label-opacity-16",
              "targets": [
                "empty-label"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 62,
              "durationFrames": 10
            },
            {
              "clipId": "inv-0-scale-17",
              "targets": [
                "inv-0"
              ],
              "property": "scale",
              "from": 0,
              "to": 1,
              "startFrame": 130,
              "durationFrames": 10,
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "inv-1-scale-18",
              "targets": [
                "inv-1"
              ],
              "property": "scale",
              "from": 0,
              "to": 1,
              "startFrame": 133,
              "durationFrames": 10,
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "inv-2-scale-19",
              "targets": [
                "inv-2"
              ],
              "property": "scale",
              "from": 0,
              "to": 1,
              "startFrame": 136,
              "durationFrames": 10,
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "inv-3-scale-20",
              "targets": [
                "inv-3"
              ],
              "property": "scale",
              "from": 0,
              "to": 1,
              "startFrame": 139,
              "durationFrames": 10,
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "inv-4-scale-21",
              "targets": [
                "inv-4"
              ],
              "property": "scale",
              "from": 0,
              "to": 1,
              "startFrame": 142,
              "durationFrames": 10,
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "inv-5-scale-22",
              "targets": [
                "inv-5"
              ],
              "property": "scale",
              "from": 0,
              "to": 1,
              "startFrame": 145,
              "durationFrames": 10,
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "inv-6-scale-23",
              "targets": [
                "inv-6"
              ],
              "property": "scale",
              "from": 0,
              "to": 1,
              "startFrame": 148,
              "durationFrames": 10,
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "inv-7-scale-24",
              "targets": [
                "inv-7"
              ],
              "property": "scale",
              "from": 0,
              "to": 1,
              "startFrame": 151,
              "durationFrames": 10,
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "inv-0-opacity-25",
              "targets": [
                "inv-0"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 130,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "inv-1-opacity-26",
              "targets": [
                "inv-1"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 133,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "inv-2-opacity-27",
              "targets": [
                "inv-2"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 136,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "inv-3-opacity-28",
              "targets": [
                "inv-3"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 139,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "inv-4-opacity-29",
              "targets": [
                "inv-4"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 142,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "inv-5-opacity-30",
              "targets": [
                "inv-5"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 145,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "inv-6-opacity-31",
              "targets": [
                "inv-6"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 148,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "inv-7-opacity-32",
              "targets": [
                "inv-7"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 151,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "graph-opacity-33",
              "targets": [
                "graph"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 169,
              "durationFrames": 8,
              "easing": "linear"
            },
            {
              "clipId": "w-stale-34-translateY-35",
              "targets": [
                "w-stale-34"
              ],
              "property": "translateY",
              "from": 47.2,
              "to": 0,
              "startFrame": 0,
              "durationFrames": 10
            },
            {
              "clipId": "w-stale-34-opacity-36",
              "targets": [
                "w-stale-34"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 0,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-stale-37-translateY-38",
              "targets": [
                "w-stale-37"
              ],
              "property": "translateY",
              "from": 47.2,
              "to": 0,
              "startFrame": 1,
              "durationFrames": 10
            },
            {
              "clipId": "w-stale-37-opacity-39",
              "targets": [
                "w-stale-37"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-stale-40-translateY-41",
              "targets": [
                "w-stale-40"
              ],
              "property": "translateY",
              "from": 47.2,
              "to": 0,
              "startFrame": 6,
              "durationFrames": 10
            },
            {
              "clipId": "w-stale-40-opacity-42",
              "targets": [
                "w-stale-40"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 6,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-stale-43-translateY-44",
              "targets": [
                "w-stale-43"
              ],
              "property": "translateY",
              "from": 47.2,
              "to": 0,
              "startFrame": 12,
              "durationFrames": 10
            },
            {
              "clipId": "w-stale-43-opacity-45",
              "targets": [
                "w-stale-43"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 12,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-stale-46-translateY-47",
              "targets": [
                "w-stale-46"
              ],
              "property": "translateY",
              "from": 47.2,
              "to": 0,
              "startFrame": 28,
              "durationFrames": 10
            },
            {
              "clipId": "w-stale-46-opacity-48",
              "targets": [
                "w-stale-46"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 28,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-stale-49-translateY-50",
              "targets": [
                "w-stale-49"
              ],
              "property": "translateY",
              "from": 47.2,
              "to": 0,
              "startFrame": 31,
              "durationFrames": 10
            },
            {
              "clipId": "w-stale-49-opacity-51",
              "targets": [
                "w-stale-49"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 31,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-stale-52-translateY-53",
              "targets": [
                "w-stale-52"
              ],
              "property": "translateY",
              "from": 47.2,
              "to": 0,
              "startFrame": 34,
              "durationFrames": 10
            },
            {
              "clipId": "w-stale-52-opacity-54",
              "targets": [
                "w-stale-52"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 34,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-stale-55-translateY-56",
              "targets": [
                "w-stale-55"
              ],
              "property": "translateY",
              "from": 47.2,
              "to": 0,
              "startFrame": 40,
              "durationFrames": 10
            },
            {
              "clipId": "w-stale-55-opacity-57",
              "targets": [
                "w-stale-55"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 40,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-stale-58-translateY-59",
              "targets": [
                "w-stale-58"
              ],
              "property": "translateY",
              "from": 47.2,
              "to": 0,
              "startFrame": 49,
              "durationFrames": 10
            },
            {
              "clipId": "w-stale-58-opacity-60",
              "targets": [
                "w-stale-58"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 49,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-stale-61-translateY-62",
              "targets": [
                "w-stale-61"
              ],
              "property": "translateY",
              "from": 47.2,
              "to": 0,
              "startFrame": 57,
              "durationFrames": 10
            },
            {
              "clipId": "w-stale-61-opacity-63",
              "targets": [
                "w-stale-61"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 57,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-stale-34-opacity-64",
              "targets": [
                "w-stale-34"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 76,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-stale-34-translateY-65",
              "targets": [
                "w-stale-34"
              ],
              "property": "translateY",
              "from": 0,
              "to": -21.24,
              "startFrame": 76,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-stale-37-opacity-66",
              "targets": [
                "w-stale-37"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 76,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-stale-37-translateY-67",
              "targets": [
                "w-stale-37"
              ],
              "property": "translateY",
              "from": 0,
              "to": -21.24,
              "startFrame": 76,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-stale-40-opacity-68",
              "targets": [
                "w-stale-40"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 76,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-stale-40-translateY-69",
              "targets": [
                "w-stale-40"
              ],
              "property": "translateY",
              "from": 0,
              "to": -21.24,
              "startFrame": 76,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-stale-43-opacity-70",
              "targets": [
                "w-stale-43"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 76,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-stale-43-translateY-71",
              "targets": [
                "w-stale-43"
              ],
              "property": "translateY",
              "from": 0,
              "to": -21.24,
              "startFrame": 76,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-stale-46-opacity-72",
              "targets": [
                "w-stale-46"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 76,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-stale-46-translateY-73",
              "targets": [
                "w-stale-46"
              ],
              "property": "translateY",
              "from": 0,
              "to": -21.24,
              "startFrame": 76,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-stale-49-opacity-74",
              "targets": [
                "w-stale-49"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 76,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-stale-49-translateY-75",
              "targets": [
                "w-stale-49"
              ],
              "property": "translateY",
              "from": 0,
              "to": -21.24,
              "startFrame": 76,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-stale-52-opacity-76",
              "targets": [
                "w-stale-52"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 76,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-stale-52-translateY-77",
              "targets": [
                "w-stale-52"
              ],
              "property": "translateY",
              "from": 0,
              "to": -21.24,
              "startFrame": 76,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-stale-55-opacity-78",
              "targets": [
                "w-stale-55"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 76,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-stale-55-translateY-79",
              "targets": [
                "w-stale-55"
              ],
              "property": "translateY",
              "from": 0,
              "to": -21.24,
              "startFrame": 76,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-stale-58-opacity-80",
              "targets": [
                "w-stale-58"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 76,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-stale-58-translateY-81",
              "targets": [
                "w-stale-58"
              ],
              "property": "translateY",
              "from": 0,
              "to": -21.24,
              "startFrame": 76,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-stale-61-opacity-82",
              "targets": [
                "w-stale-61"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 76,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-stale-61-translateY-83",
              "targets": [
                "w-stale-61"
              ],
              "property": "translateY",
              "from": 0,
              "to": -21.24,
              "startFrame": 76,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-invent-84-translateY-85",
              "targets": [
                "w-invent-84"
              ],
              "property": "translateY",
              "from": -59,
              "to": 0,
              "startFrame": 83,
              "durationFrames": 10
            },
            {
              "clipId": "w-invent-84-opacity-86",
              "targets": [
                "w-invent-84"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 83,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-invent-87-translateY-88",
              "targets": [
                "w-invent-87"
              ],
              "property": "translateY",
              "from": -59,
              "to": 0,
              "startFrame": 89,
              "durationFrames": 10
            },
            {
              "clipId": "w-invent-87-opacity-89",
              "targets": [
                "w-invent-87"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 89,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-invent-90-translateY-91",
              "targets": [
                "w-invent-90"
              ],
              "property": "translateY",
              "from": -59,
              "to": 0,
              "startFrame": 93,
              "durationFrames": 10
            },
            {
              "clipId": "w-invent-90-opacity-92",
              "targets": [
                "w-invent-90"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 93,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-invent-93-translateY-94",
              "targets": [
                "w-invent-93"
              ],
              "property": "translateY",
              "from": -59,
              "to": 0,
              "startFrame": 98,
              "durationFrames": 10
            },
            {
              "clipId": "w-invent-93-opacity-95",
              "targets": [
                "w-invent-93"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 98,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-invent-96-translateY-97",
              "targets": [
                "w-invent-96"
              ],
              "property": "translateY",
              "from": -59,
              "to": 0,
              "startFrame": 108,
              "durationFrames": 10
            },
            {
              "clipId": "w-invent-96-opacity-98",
              "targets": [
                "w-invent-96"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 108,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-invent-99-translateY-100",
              "targets": [
                "w-invent-99"
              ],
              "property": "translateY",
              "from": -59,
              "to": 0,
              "startFrame": 123,
              "durationFrames": 10
            },
            {
              "clipId": "w-invent-99-opacity-101",
              "targets": [
                "w-invent-99"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 123,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-invent-102-translateY-103",
              "targets": [
                "w-invent-102"
              ],
              "property": "translateY",
              "from": -59,
              "to": 0,
              "startFrame": 129,
              "durationFrames": 10
            },
            {
              "clipId": "w-invent-102-opacity-104",
              "targets": [
                "w-invent-102"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 129,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-invent-105-translateY-106",
              "targets": [
                "w-invent-105"
              ],
              "property": "translateY",
              "from": -59,
              "to": 0,
              "startFrame": 137,
              "durationFrames": 10
            },
            {
              "clipId": "w-invent-105-opacity-107",
              "targets": [
                "w-invent-105"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 137,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-invent-84-opacity-108",
              "targets": [
                "w-invent-84"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 157,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-invent-84-translateY-109",
              "targets": [
                "w-invent-84"
              ],
              "property": "translateY",
              "from": 0,
              "to": -21.24,
              "startFrame": 157,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-invent-87-opacity-110",
              "targets": [
                "w-invent-87"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 157,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-invent-87-translateY-111",
              "targets": [
                "w-invent-87"
              ],
              "property": "translateY",
              "from": 0,
              "to": -21.24,
              "startFrame": 157,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-invent-90-opacity-112",
              "targets": [
                "w-invent-90"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 157,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-invent-90-translateY-113",
              "targets": [
                "w-invent-90"
              ],
              "property": "translateY",
              "from": 0,
              "to": -21.24,
              "startFrame": 157,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-invent-93-opacity-114",
              "targets": [
                "w-invent-93"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 157,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-invent-93-translateY-115",
              "targets": [
                "w-invent-93"
              ],
              "property": "translateY",
              "from": 0,
              "to": -21.24,
              "startFrame": 157,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-invent-96-opacity-116",
              "targets": [
                "w-invent-96"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 157,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-invent-96-translateY-117",
              "targets": [
                "w-invent-96"
              ],
              "property": "translateY",
              "from": 0,
              "to": -21.24,
              "startFrame": 157,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-invent-99-opacity-118",
              "targets": [
                "w-invent-99"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 157,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-invent-99-translateY-119",
              "targets": [
                "w-invent-99"
              ],
              "property": "translateY",
              "from": 0,
              "to": -21.24,
              "startFrame": 157,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-invent-102-opacity-120",
              "targets": [
                "w-invent-102"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 157,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-invent-102-translateY-121",
              "targets": [
                "w-invent-102"
              ],
              "property": "translateY",
              "from": 0,
              "to": -21.24,
              "startFrame": 157,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-invent-105-opacity-122",
              "targets": [
                "w-invent-105"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 157,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-invent-105-translateY-123",
              "targets": [
                "w-invent-105"
              ],
              "property": "translateY",
              "from": 0,
              "to": -21.24,
              "startFrame": 157,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-halluc-124-scale-125",
              "targets": [
                "w-halluc-124"
              ],
              "property": "scale",
              "from": 1.5,
              "to": 1,
              "startFrame": 164,
              "durationFrames": 9,
              "origin": {
                "x": 102.64499999999998,
                "y": -27
              }
            },
            {
              "clipId": "w-halluc-124-opacity-126",
              "targets": [
                "w-halluc-124"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 164,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-halluc-127-scale-128",
              "targets": [
                "w-halluc-127"
              ],
              "property": "scale",
              "from": 1.5,
              "to": 1,
              "startFrame": 166,
              "durationFrames": 9,
              "origin": {
                "x": 77.94000000000001,
                "y": -27
              }
            },
            {
              "clipId": "w-halluc-127-opacity-129",
              "targets": [
                "w-halluc-127"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 166,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-halluc-130-scale-131",
              "targets": [
                "w-halluc-130"
              ],
              "property": "scale",
              "from": 1.5,
              "to": 1,
              "startFrame": 174,
              "durationFrames": 9,
              "origin": {
                "x": 30.15,
                "y": -27
              }
            },
            {
              "clipId": "w-halluc-130-opacity-132",
              "targets": [
                "w-halluc-130"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 174,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-halluc-133-scale-134",
              "targets": [
                "w-halluc-133"
              ],
              "property": "scale",
              "from": 1.5,
              "to": 1,
              "startFrame": 177,
              "durationFrames": 9,
              "origin": {
                "x": 514.164,
                "y": -50.4
              }
            },
            {
              "clipId": "w-halluc-133-opacity-135",
              "targets": [
                "w-halluc-133"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 177,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-halluc-136-scale-137",
              "targets": [
                "w-halluc-136"
              ],
              "property": "scale",
              "from": 1.5,
              "to": 1,
              "startFrame": 213,
              "durationFrames": 9,
              "origin": {
                "x": 12.600000000000001,
                "y": -27
              }
            },
            {
              "clipId": "w-halluc-136-opacity-138",
              "targets": [
                "w-halluc-136"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 213,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-halluc-139-scale-140",
              "targets": [
                "w-halluc-139"
              ],
              "property": "scale",
              "from": 1.5,
              "to": 1,
              "startFrame": 217,
              "durationFrames": 9,
              "origin": {
                "x": 77.94000000000001,
                "y": -27
              }
            },
            {
              "clipId": "w-halluc-139-opacity-141",
              "targets": [
                "w-halluc-139"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 217,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-halluc-142-scale-143",
              "targets": [
                "w-halluc-142"
              ],
              "property": "scale",
              "from": 1.5,
              "to": 1,
              "startFrame": 224,
              "durationFrames": 9,
              "origin": {
                "x": 30.15,
                "y": -27
              }
            },
            {
              "clipId": "w-halluc-142-opacity-144",
              "targets": [
                "w-halluc-142"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 224,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-halluc-145-scale-146",
              "targets": [
                "w-halluc-145"
              ],
              "property": "scale",
              "from": 1.5,
              "to": 1,
              "startFrame": 227,
              "durationFrames": 9,
              "origin": {
                "x": 240.03000000000003,
                "y": -27
              }
            },
            {
              "clipId": "w-halluc-145-opacity-147",
              "targets": [
                "w-halluc-145"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 227,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-halluc-124-opacity-148",
              "targets": [
                "w-halluc-124"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 252,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-halluc-127-opacity-149",
              "targets": [
                "w-halluc-127"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 252,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-halluc-130-opacity-150",
              "targets": [
                "w-halluc-130"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 252,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-halluc-133-opacity-151",
              "targets": [
                "w-halluc-133"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 252,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-halluc-136-opacity-152",
              "targets": [
                "w-halluc-136"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 252,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-halluc-139-opacity-153",
              "targets": [
                "w-halluc-139"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 252,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-halluc-142-opacity-154",
              "targets": [
                "w-halluc-142"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 252,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-halluc-145-opacity-155",
              "targets": [
                "w-halluc-145"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 252,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "gauge-opacity-156",
              "targets": [
                "gauge"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 222,
              "durationFrames": 8
            },
            {
              "clipId": "conf-bar-scaleX-157",
              "targets": [
                "conf-bar"
              ],
              "property": "scaleX",
              "from": 0,
              "to": 0.99,
              "startFrame": 226,
              "durationFrames": 24,
              "origin": {
                "x": 340,
                "y": 0
              }
            },
            {
              "clipId": "gauge-opacity-158",
              "targets": [
                "gauge"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 250,
              "durationFrames": 8
            },
            {
              "clipId": "w-nexttoken-159-translateY-160",
              "targets": [
                "w-nexttoken-159"
              ],
              "property": "translateY",
              "from": 40,
              "to": 0,
              "startFrame": 259,
              "durationFrames": 10
            },
            {
              "clipId": "w-nexttoken-159-opacity-161",
              "targets": [
                "w-nexttoken-159"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 259,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-nexttoken-162-translateY-163",
              "targets": [
                "w-nexttoken-162"
              ],
              "property": "translateY",
              "from": 40,
              "to": 0,
              "startFrame": 263,
              "durationFrames": 10
            },
            {
              "clipId": "w-nexttoken-162-opacity-164",
              "targets": [
                "w-nexttoken-162"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 263,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-nexttoken-165-translateY-166",
              "targets": [
                "w-nexttoken-165"
              ],
              "property": "translateY",
              "from": 40,
              "to": 0,
              "startFrame": 279,
              "durationFrames": 10
            },
            {
              "clipId": "w-nexttoken-165-opacity-167",
              "targets": [
                "w-nexttoken-165"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 279,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-nexttoken-168-translateY-169",
              "targets": [
                "w-nexttoken-168"
              ],
              "property": "translateY",
              "from": 40,
              "to": 0,
              "startFrame": 282,
              "durationFrames": 10
            },
            {
              "clipId": "w-nexttoken-168-opacity-170",
              "targets": [
                "w-nexttoken-168"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 282,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-nexttoken-171-translateY-172",
              "targets": [
                "w-nexttoken-171"
              ],
              "property": "translateY",
              "from": 40,
              "to": 0,
              "startFrame": 305,
              "durationFrames": 10
            },
            {
              "clipId": "w-nexttoken-171-opacity-173",
              "targets": [
                "w-nexttoken-171"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 305,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-nexttoken-174-translateY-175",
              "targets": [
                "w-nexttoken-174"
              ],
              "property": "translateY",
              "from": 40,
              "to": 0,
              "startFrame": 308,
              "durationFrames": 10
            },
            {
              "clipId": "w-nexttoken-174-opacity-176",
              "targets": [
                "w-nexttoken-174"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 308,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-nexttoken-177-translateY-178",
              "targets": [
                "w-nexttoken-177"
              ],
              "property": "translateY",
              "from": 40,
              "to": 0,
              "startFrame": 312,
              "durationFrames": 10
            },
            {
              "clipId": "w-nexttoken-177-opacity-179",
              "targets": [
                "w-nexttoken-177"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 312,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-nexttoken-180-translateY-181",
              "targets": [
                "w-nexttoken-180"
              ],
              "property": "translateY",
              "from": 40,
              "to": 0,
              "startFrame": 317,
              "durationFrames": 10
            },
            {
              "clipId": "w-nexttoken-180-opacity-182",
              "targets": [
                "w-nexttoken-180"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 317,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-nexttoken-183-translateY-184",
              "targets": [
                "w-nexttoken-183"
              ],
              "property": "translateY",
              "from": 40,
              "to": 0,
              "startFrame": 327,
              "durationFrames": 10
            },
            {
              "clipId": "w-nexttoken-183-opacity-185",
              "targets": [
                "w-nexttoken-183"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 327,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-nexttoken-159-opacity-186",
              "targets": [
                "w-nexttoken-159"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 347,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-nexttoken-159-translateY-187",
              "targets": [
                "w-nexttoken-159"
              ],
              "property": "translateY",
              "from": 0,
              "to": -18,
              "startFrame": 347,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-nexttoken-162-opacity-188",
              "targets": [
                "w-nexttoken-162"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 347,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-nexttoken-162-translateY-189",
              "targets": [
                "w-nexttoken-162"
              ],
              "property": "translateY",
              "from": 0,
              "to": -18,
              "startFrame": 347,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-nexttoken-165-opacity-190",
              "targets": [
                "w-nexttoken-165"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 347,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-nexttoken-165-translateY-191",
              "targets": [
                "w-nexttoken-165"
              ],
              "property": "translateY",
              "from": 0,
              "to": -18,
              "startFrame": 347,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-nexttoken-168-opacity-192",
              "targets": [
                "w-nexttoken-168"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 347,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-nexttoken-168-translateY-193",
              "targets": [
                "w-nexttoken-168"
              ],
              "property": "translateY",
              "from": 0,
              "to": -18,
              "startFrame": 347,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-nexttoken-171-opacity-194",
              "targets": [
                "w-nexttoken-171"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 347,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-nexttoken-171-translateY-195",
              "targets": [
                "w-nexttoken-171"
              ],
              "property": "translateY",
              "from": 0,
              "to": -18,
              "startFrame": 347,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-nexttoken-174-opacity-196",
              "targets": [
                "w-nexttoken-174"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 347,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-nexttoken-174-translateY-197",
              "targets": [
                "w-nexttoken-174"
              ],
              "property": "translateY",
              "from": 0,
              "to": -18,
              "startFrame": 347,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-nexttoken-177-opacity-198",
              "targets": [
                "w-nexttoken-177"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 347,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-nexttoken-177-translateY-199",
              "targets": [
                "w-nexttoken-177"
              ],
              "property": "translateY",
              "from": 0,
              "to": -18,
              "startFrame": 347,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-nexttoken-180-opacity-200",
              "targets": [
                "w-nexttoken-180"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 347,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-nexttoken-180-translateY-201",
              "targets": [
                "w-nexttoken-180"
              ],
              "property": "translateY",
              "from": 0,
              "to": -18,
              "startFrame": 347,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-nexttoken-183-opacity-202",
              "targets": [
                "w-nexttoken-183"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 347,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-nexttoken-183-translateY-203",
              "targets": [
                "w-nexttoken-183"
              ],
              "property": "translateY",
              "from": 0,
              "to": -18,
              "startFrame": 347,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "tp-204-translateY-227",
              "targets": [
                "tp-204"
              ],
              "property": "translateY",
              "from": 30,
              "to": 0,
              "startFrame": 262,
              "durationFrames": 14
            },
            {
              "clipId": "tp-204-opacity-228",
              "targets": [
                "tp-204"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 262,
              "durationFrames": 10,
              "easing": "linear"
            },
            {
              "clipId": "tp-cover-205-scaleX-229",
              "targets": [
                "tp-cover-205"
              ],
              "property": "scaleX",
              "from": 1,
              "to": 0.9655172413793104,
              "startFrame": 268,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 548,
                "y": 0
              }
            },
            {
              "clipId": "tp-cover-205-scaleX-230",
              "targets": [
                "tp-cover-205"
              ],
              "property": "scaleX",
              "from": 0.9655172413793104,
              "to": 0.9310344827586207,
              "startFrame": 269,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 548,
                "y": 0
              }
            },
            {
              "clipId": "tp-cover-205-scaleX-231",
              "targets": [
                "tp-cover-205"
              ],
              "property": "scaleX",
              "from": 0.9310344827586207,
              "to": 0.896551724137931,
              "startFrame": 270,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 548,
                "y": 0
              }
            },
            {
              "clipId": "tp-cover-205-scaleX-232",
              "targets": [
                "tp-cover-205"
              ],
              "property": "scaleX",
              "from": 0.896551724137931,
              "to": 0.8620689655172413,
              "startFrame": 271,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 548,
                "y": 0
              }
            },
            {
              "clipId": "tp-cover-205-scaleX-233",
              "targets": [
                "tp-cover-205"
              ],
              "property": "scaleX",
              "from": 0.8620689655172413,
              "to": 0.8275862068965517,
              "startFrame": 272,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 548,
                "y": 0
              }
            },
            {
              "clipId": "tp-cover-205-scaleX-234",
              "targets": [
                "tp-cover-205"
              ],
              "property": "scaleX",
              "from": 0.8275862068965517,
              "to": 0.7931034482758621,
              "startFrame": 273,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 548,
                "y": 0
              }
            },
            {
              "clipId": "tp-cover-205-scaleX-235",
              "targets": [
                "tp-cover-205"
              ],
              "property": "scaleX",
              "from": 0.7931034482758621,
              "to": 0.7586206896551724,
              "startFrame": 274,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 548,
                "y": 0
              }
            },
            {
              "clipId": "tp-cover-205-scaleX-236",
              "targets": [
                "tp-cover-205"
              ],
              "property": "scaleX",
              "from": 0.7586206896551724,
              "to": 0.7241379310344828,
              "startFrame": 275,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 548,
                "y": 0
              }
            },
            {
              "clipId": "tp-cover-205-scaleX-237",
              "targets": [
                "tp-cover-205"
              ],
              "property": "scaleX",
              "from": 0.7241379310344828,
              "to": 0.6896551724137931,
              "startFrame": 276,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 548,
                "y": 0
              }
            },
            {
              "clipId": "tp-cover-205-scaleX-238",
              "targets": [
                "tp-cover-205"
              ],
              "property": "scaleX",
              "from": 0.6896551724137931,
              "to": 0.6551724137931034,
              "startFrame": 277,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 548,
                "y": 0
              }
            },
            {
              "clipId": "tp-cover-205-scaleX-239",
              "targets": [
                "tp-cover-205"
              ],
              "property": "scaleX",
              "from": 0.6551724137931034,
              "to": 0.6206896551724138,
              "startFrame": 278,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 548,
                "y": 0
              }
            },
            {
              "clipId": "tp-cover-205-scaleX-240",
              "targets": [
                "tp-cover-205"
              ],
              "property": "scaleX",
              "from": 0.6206896551724138,
              "to": 0.5862068965517242,
              "startFrame": 279,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 548,
                "y": 0
              }
            },
            {
              "clipId": "tp-cover-205-scaleX-241",
              "targets": [
                "tp-cover-205"
              ],
              "property": "scaleX",
              "from": 0.5862068965517242,
              "to": 0.5517241379310345,
              "startFrame": 280,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 548,
                "y": 0
              }
            },
            {
              "clipId": "tp-cover-205-scaleX-242",
              "targets": [
                "tp-cover-205"
              ],
              "property": "scaleX",
              "from": 0.5517241379310345,
              "to": 0.5172413793103448,
              "startFrame": 281,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 548,
                "y": 0
              }
            },
            {
              "clipId": "tp-cover-205-scaleX-243",
              "targets": [
                "tp-cover-205"
              ],
              "property": "scaleX",
              "from": 0.5172413793103448,
              "to": 0.48275862068965514,
              "startFrame": 282,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 548,
                "y": 0
              }
            },
            {
              "clipId": "tp-cover-205-scaleX-244",
              "targets": [
                "tp-cover-205"
              ],
              "property": "scaleX",
              "from": 0.48275862068965514,
              "to": 0.4482758620689655,
              "startFrame": 284,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 548,
                "y": 0
              }
            },
            {
              "clipId": "tp-cover-205-scaleX-245",
              "targets": [
                "tp-cover-205"
              ],
              "property": "scaleX",
              "from": 0.4482758620689655,
              "to": 0.4137931034482759,
              "startFrame": 285,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 548,
                "y": 0
              }
            },
            {
              "clipId": "tp-cover-205-scaleX-246",
              "targets": [
                "tp-cover-205"
              ],
              "property": "scaleX",
              "from": 0.4137931034482759,
              "to": 0.3793103448275862,
              "startFrame": 286,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 548,
                "y": 0
              }
            },
            {
              "clipId": "tp-cover-205-scaleX-247",
              "targets": [
                "tp-cover-205"
              ],
              "property": "scaleX",
              "from": 0.3793103448275862,
              "to": 0.3448275862068966,
              "startFrame": 287,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 548,
                "y": 0
              }
            },
            {
              "clipId": "tp-cover-205-scaleX-248",
              "targets": [
                "tp-cover-205"
              ],
              "property": "scaleX",
              "from": 0.3448275862068966,
              "to": 0.31034482758620685,
              "startFrame": 288,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 548,
                "y": 0
              }
            },
            {
              "clipId": "tp-cover-205-scaleX-249",
              "targets": [
                "tp-cover-205"
              ],
              "property": "scaleX",
              "from": 0.31034482758620685,
              "to": 0.27586206896551724,
              "startFrame": 289,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 548,
                "y": 0
              }
            },
            {
              "clipId": "tp-cover-205-scaleX-250",
              "targets": [
                "tp-cover-205"
              ],
              "property": "scaleX",
              "from": 0.27586206896551724,
              "to": 0.24137931034482762,
              "startFrame": 290,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 548,
                "y": 0
              }
            },
            {
              "clipId": "tp-cover-205-scaleX-251",
              "targets": [
                "tp-cover-205"
              ],
              "property": "scaleX",
              "from": 0.24137931034482762,
              "to": 0.2068965517241379,
              "startFrame": 291,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 548,
                "y": 0
              }
            },
            {
              "clipId": "tp-cover-205-scaleX-252",
              "targets": [
                "tp-cover-205"
              ],
              "property": "scaleX",
              "from": 0.2068965517241379,
              "to": 0.1724137931034483,
              "startFrame": 292,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 548,
                "y": 0
              }
            },
            {
              "clipId": "tp-cover-205-scaleX-253",
              "targets": [
                "tp-cover-205"
              ],
              "property": "scaleX",
              "from": 0.1724137931034483,
              "to": 0.13793103448275867,
              "startFrame": 293,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 548,
                "y": 0
              }
            },
            {
              "clipId": "tp-cover-205-scaleX-254",
              "targets": [
                "tp-cover-205"
              ],
              "property": "scaleX",
              "from": 0.13793103448275867,
              "to": 0.10344827586206895,
              "startFrame": 294,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 548,
                "y": 0
              }
            },
            {
              "clipId": "tp-cover-205-scaleX-255",
              "targets": [
                "tp-cover-205"
              ],
              "property": "scaleX",
              "from": 0.10344827586206895,
              "to": 0.06896551724137934,
              "startFrame": 295,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 548,
                "y": 0
              }
            },
            {
              "clipId": "tp-cover-205-scaleX-256",
              "targets": [
                "tp-cover-205"
              ],
              "property": "scaleX",
              "from": 0.06896551724137934,
              "to": 0.03448275862068961,
              "startFrame": 296,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 548,
                "y": 0
              }
            },
            {
              "clipId": "tp-cover-205-scaleX-257",
              "targets": [
                "tp-cover-205"
              ],
              "property": "scaleX",
              "from": 0.03448275862068961,
              "to": 0,
              "startFrame": 297,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 548,
                "y": 0
              }
            },
            {
              "clipId": "tp-caret-206-translateX-258",
              "targets": [
                "tp-caret-206"
              ],
              "property": "translateX",
              "from": 0,
              "to": 18,
              "startFrame": 268,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "tp-caret-206-translateX-259",
              "targets": [
                "tp-caret-206"
              ],
              "property": "translateX",
              "from": 18,
              "to": 36,
              "startFrame": 269,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "tp-caret-206-translateX-260",
              "targets": [
                "tp-caret-206"
              ],
              "property": "translateX",
              "from": 36,
              "to": 54,
              "startFrame": 270,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "tp-caret-206-translateX-261",
              "targets": [
                "tp-caret-206"
              ],
              "property": "translateX",
              "from": 54,
              "to": 72,
              "startFrame": 271,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "tp-caret-206-translateX-262",
              "targets": [
                "tp-caret-206"
              ],
              "property": "translateX",
              "from": 72,
              "to": 90,
              "startFrame": 272,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "tp-caret-206-translateX-263",
              "targets": [
                "tp-caret-206"
              ],
              "property": "translateX",
              "from": 90,
              "to": 108,
              "startFrame": 273,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "tp-caret-206-translateX-264",
              "targets": [
                "tp-caret-206"
              ],
              "property": "translateX",
              "from": 108,
              "to": 126,
              "startFrame": 274,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "tp-caret-206-translateX-265",
              "targets": [
                "tp-caret-206"
              ],
              "property": "translateX",
              "from": 126,
              "to": 144,
              "startFrame": 275,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "tp-caret-206-translateX-266",
              "targets": [
                "tp-caret-206"
              ],
              "property": "translateX",
              "from": 144,
              "to": 162,
              "startFrame": 276,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "tp-caret-206-translateX-267",
              "targets": [
                "tp-caret-206"
              ],
              "property": "translateX",
              "from": 162,
              "to": 180,
              "startFrame": 277,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "tp-caret-206-translateX-268",
              "targets": [
                "tp-caret-206"
              ],
              "property": "translateX",
              "from": 180,
              "to": 198,
              "startFrame": 278,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "tp-caret-206-translateX-269",
              "targets": [
                "tp-caret-206"
              ],
              "property": "translateX",
              "from": 198,
              "to": 216,
              "startFrame": 279,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "tp-caret-206-translateX-270",
              "targets": [
                "tp-caret-206"
              ],
              "property": "translateX",
              "from": 216,
              "to": 234,
              "startFrame": 280,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "tp-caret-206-translateX-271",
              "targets": [
                "tp-caret-206"
              ],
              "property": "translateX",
              "from": 234,
              "to": 252,
              "startFrame": 281,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "tp-caret-206-translateX-272",
              "targets": [
                "tp-caret-206"
              ],
              "property": "translateX",
              "from": 252,
              "to": 270,
              "startFrame": 282,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "tp-caret-206-translateX-273",
              "targets": [
                "tp-caret-206"
              ],
              "property": "translateX",
              "from": 270,
              "to": 288,
              "startFrame": 284,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "tp-caret-206-translateX-274",
              "targets": [
                "tp-caret-206"
              ],
              "property": "translateX",
              "from": 288,
              "to": 306,
              "startFrame": 285,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "tp-caret-206-translateX-275",
              "targets": [
                "tp-caret-206"
              ],
              "property": "translateX",
              "from": 306,
              "to": 324,
              "startFrame": 286,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "tp-caret-206-translateX-276",
              "targets": [
                "tp-caret-206"
              ],
              "property": "translateX",
              "from": 324,
              "to": 342,
              "startFrame": 287,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "tp-caret-206-translateX-277",
              "targets": [
                "tp-caret-206"
              ],
              "property": "translateX",
              "from": 342,
              "to": 360,
              "startFrame": 288,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "tp-caret-206-translateX-278",
              "targets": [
                "tp-caret-206"
              ],
              "property": "translateX",
              "from": 360,
              "to": 378,
              "startFrame": 289,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "tp-caret-206-translateX-279",
              "targets": [
                "tp-caret-206"
              ],
              "property": "translateX",
              "from": 378,
              "to": 396,
              "startFrame": 290,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "tp-caret-206-translateX-280",
              "targets": [
                "tp-caret-206"
              ],
              "property": "translateX",
              "from": 396,
              "to": 414,
              "startFrame": 291,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "tp-caret-206-translateX-281",
              "targets": [
                "tp-caret-206"
              ],
              "property": "translateX",
              "from": 414,
              "to": 432,
              "startFrame": 292,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "tp-caret-206-translateX-282",
              "targets": [
                "tp-caret-206"
              ],
              "property": "translateX",
              "from": 432,
              "to": 450,
              "startFrame": 293,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "tp-caret-206-translateX-283",
              "targets": [
                "tp-caret-206"
              ],
              "property": "translateX",
              "from": 450,
              "to": 468,
              "startFrame": 294,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "tp-caret-206-translateX-284",
              "targets": [
                "tp-caret-206"
              ],
              "property": "translateX",
              "from": 468,
              "to": 486,
              "startFrame": 295,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "tp-caret-206-translateX-285",
              "targets": [
                "tp-caret-206"
              ],
              "property": "translateX",
              "from": 486,
              "to": 504,
              "startFrame": 296,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "tp-caret-206-translateX-286",
              "targets": [
                "tp-caret-206"
              ],
              "property": "translateX",
              "from": 504,
              "to": 522,
              "startFrame": 297,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "tp-bar-208-scaleX-287",
              "targets": [
                "tp-bar-208"
              ],
              "property": "scaleX",
              "from": 0,
              "to": 0.34,
              "startFrame": 302,
              "durationFrames": 14,
              "origin": {
                "x": 250,
                "y": 0
              }
            },
            {
              "clipId": "tp-barhot-209-scaleX-288",
              "targets": [
                "tp-barhot-209"
              ],
              "property": "scaleX",
              "from": 0,
              "to": 0.34,
              "startFrame": 302,
              "durationFrames": 14,
              "origin": {
                "x": 250,
                "y": 0
              }
            },
            {
              "clipId": "tp-v0-210-opacity-289",
              "targets": [
                "tp-v0-210"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 302,
              "durationFrames": 6
            },
            {
              "clipId": "tp-hot-207-opacity-290",
              "targets": [
                "tp-hot-207"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 302,
              "durationFrames": 6
            },
            {
              "clipId": "tp-bar-213-scaleX-291",
              "targets": [
                "tp-bar-213"
              ],
              "property": "scaleX",
              "from": 0,
              "to": 0.27,
              "startFrame": 305,
              "durationFrames": 14,
              "origin": {
                "x": 250,
                "y": 0
              }
            },
            {
              "clipId": "tp-barhot-214-scaleX-292",
              "targets": [
                "tp-barhot-214"
              ],
              "property": "scaleX",
              "from": 0,
              "to": 0.27,
              "startFrame": 305,
              "durationFrames": 14,
              "origin": {
                "x": 250,
                "y": 0
              }
            },
            {
              "clipId": "tp-v0-215-opacity-293",
              "targets": [
                "tp-v0-215"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 305,
              "durationFrames": 6
            },
            {
              "clipId": "tp-bar-218-scaleX-294",
              "targets": [
                "tp-bar-218"
              ],
              "property": "scaleX",
              "from": 0,
              "to": 0.22,
              "startFrame": 308,
              "durationFrames": 14,
              "origin": {
                "x": 250,
                "y": 0
              }
            },
            {
              "clipId": "tp-barhot-219-scaleX-295",
              "targets": [
                "tp-barhot-219"
              ],
              "property": "scaleX",
              "from": 0,
              "to": 0.22,
              "startFrame": 308,
              "durationFrames": 14,
              "origin": {
                "x": 250,
                "y": 0
              }
            },
            {
              "clipId": "tp-v0-220-opacity-296",
              "targets": [
                "tp-v0-220"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 308,
              "durationFrames": 6
            },
            {
              "clipId": "tp-bar-223-scaleX-297",
              "targets": [
                "tp-bar-223"
              ],
              "property": "scaleX",
              "from": 0,
              "to": 0.17,
              "startFrame": 311,
              "durationFrames": 14,
              "origin": {
                "x": 250,
                "y": 0
              }
            },
            {
              "clipId": "tp-barhot-224-scaleX-298",
              "targets": [
                "tp-barhot-224"
              ],
              "property": "scaleX",
              "from": 0,
              "to": 0.17,
              "startFrame": 311,
              "durationFrames": 14,
              "origin": {
                "x": 250,
                "y": 0
              }
            },
            {
              "clipId": "tp-v0-225-opacity-299",
              "targets": [
                "tp-v0-225"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 311,
              "durationFrames": 6
            },
            {
              "clipId": "tp-204-opacity-300",
              "targets": [
                "tp-204"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 371,
              "durationFrames": 8,
              "easing": "linear"
            },
            {
              "clipId": "tp-barhot-209-pin-301",
              "targets": [
                "tp-barhot-209"
              ],
              "property": "opacity",
              "from": 1,
              "to": 1,
              "startFrame": 0,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "tp-v1-211-pin-302",
              "targets": [
                "tp-v1-211"
              ],
              "property": "opacity",
              "from": 0,
              "to": 0,
              "startFrame": 0,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "tp-barhot-214-pin-303",
              "targets": [
                "tp-barhot-214"
              ],
              "property": "opacity",
              "from": 0,
              "to": 0,
              "startFrame": 0,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "tp-hot-212-pin-304",
              "targets": [
                "tp-hot-212"
              ],
              "property": "opacity",
              "from": 0,
              "to": 0,
              "startFrame": 0,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "tp-v1-216-pin-305",
              "targets": [
                "tp-v1-216"
              ],
              "property": "opacity",
              "from": 0,
              "to": 0,
              "startFrame": 0,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "tp-barhot-219-pin-306",
              "targets": [
                "tp-barhot-219"
              ],
              "property": "opacity",
              "from": 0,
              "to": 0,
              "startFrame": 0,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "tp-hot-217-pin-307",
              "targets": [
                "tp-hot-217"
              ],
              "property": "opacity",
              "from": 0,
              "to": 0,
              "startFrame": 0,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "tp-v1-221-pin-308",
              "targets": [
                "tp-v1-221"
              ],
              "property": "opacity",
              "from": 0,
              "to": 0,
              "startFrame": 0,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "tp-barhot-224-pin-309",
              "targets": [
                "tp-barhot-224"
              ],
              "property": "opacity",
              "from": 0,
              "to": 0,
              "startFrame": 0,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "tp-hot-222-pin-310",
              "targets": [
                "tp-hot-222"
              ],
              "property": "opacity",
              "from": 0,
              "to": 0,
              "startFrame": 0,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "tp-v1-226-pin-311",
              "targets": [
                "tp-v1-226"
              ],
              "property": "opacity",
              "from": 0,
              "to": 0,
              "startFrame": 0,
              "durationFrames": 1,
              "easing": "linear"
            }
          ]
        }
      },
      {
        "assetId": "fix",
        "svgSource": "videos/rag-explainer/visuals/fix.svg",
        "layer": 4,
        "position": {
          "x": 0,
          "y": 0
        },
        "scale": 1,
        "rotation": 0,
        "opacity": 1,
        "animation": {
          "timelineId": "fix-motion",
          "clips": [
            {
              "clipId": "root-opacity-0",
              "targets": [
                "root"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 353,
              "durationFrames": 4,
              "easing": "linear"
            },
            {
              "clipId": "root-opacity-1",
              "targets": [
                "root"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 513,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-lookup-2-translateY-3",
              "targets": [
                "w-lookup-2"
              ],
              "property": "translateY",
              "from": 47.2,
              "to": 0,
              "startFrame": 352,
              "durationFrames": 10
            },
            {
              "clipId": "w-lookup-2-opacity-4",
              "targets": [
                "w-lookup-2"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 352,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-lookup-5-translateY-6",
              "targets": [
                "w-lookup-5"
              ],
              "property": "translateY",
              "from": 47.2,
              "to": 0,
              "startFrame": 356,
              "durationFrames": 10
            },
            {
              "clipId": "w-lookup-5-opacity-7",
              "targets": [
                "w-lookup-5"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 356,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-lookup-8-translateY-9",
              "targets": [
                "w-lookup-8"
              ],
              "property": "translateY",
              "from": 47.2,
              "to": 0,
              "startFrame": 362,
              "durationFrames": 10
            },
            {
              "clipId": "w-lookup-8-opacity-10",
              "targets": [
                "w-lookup-8"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 362,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-lookup-11-translateY-12",
              "targets": [
                "w-lookup-11"
              ],
              "property": "translateY",
              "from": 47.2,
              "to": 0,
              "startFrame": 366,
              "durationFrames": 10
            },
            {
              "clipId": "w-lookup-11-opacity-13",
              "targets": [
                "w-lookup-11"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 366,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-lookup-14-translateY-15",
              "targets": [
                "w-lookup-14"
              ],
              "property": "translateY",
              "from": 47.2,
              "to": 0,
              "startFrame": 370,
              "durationFrames": 10
            },
            {
              "clipId": "w-lookup-14-opacity-16",
              "targets": [
                "w-lookup-14"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 370,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-lookup-17-translateY-18",
              "targets": [
                "w-lookup-17"
              ],
              "property": "translateY",
              "from": 47.2,
              "to": 0,
              "startFrame": 394,
              "durationFrames": 10
            },
            {
              "clipId": "w-lookup-17-opacity-19",
              "targets": [
                "w-lookup-17"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 394,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-lookup-20-translateY-21",
              "targets": [
                "w-lookup-20"
              ],
              "property": "translateY",
              "from": 47.2,
              "to": 0,
              "startFrame": 398,
              "durationFrames": 10
            },
            {
              "clipId": "w-lookup-20-opacity-22",
              "targets": [
                "w-lookup-20"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 398,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-lookup-23-translateY-24",
              "targets": [
                "w-lookup-23"
              ],
              "property": "translateY",
              "from": 47.2,
              "to": 0,
              "startFrame": 403,
              "durationFrames": 10
            },
            {
              "clipId": "w-lookup-23-opacity-25",
              "targets": [
                "w-lookup-23"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 403,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-lookup-26-translateY-27",
              "targets": [
                "w-lookup-26"
              ],
              "property": "translateY",
              "from": 47.2,
              "to": 0,
              "startFrame": 407,
              "durationFrames": 10
            },
            {
              "clipId": "w-lookup-26-opacity-28",
              "targets": [
                "w-lookup-26"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 407,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-lookup-29-translateY-30",
              "targets": [
                "w-lookup-29"
              ],
              "property": "translateY",
              "from": 47.2,
              "to": 0,
              "startFrame": 410,
              "durationFrames": 10
            },
            {
              "clipId": "w-lookup-29-opacity-31",
              "targets": [
                "w-lookup-29"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 410,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-lookup-2-opacity-32",
              "targets": [
                "w-lookup-2"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 422,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-lookup-2-translateY-33",
              "targets": [
                "w-lookup-2"
              ],
              "property": "translateY",
              "from": 0,
              "to": -21.24,
              "startFrame": 422,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-lookup-5-opacity-34",
              "targets": [
                "w-lookup-5"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 422,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-lookup-5-translateY-35",
              "targets": [
                "w-lookup-5"
              ],
              "property": "translateY",
              "from": 0,
              "to": -21.24,
              "startFrame": 422,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-lookup-8-opacity-36",
              "targets": [
                "w-lookup-8"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 422,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-lookup-8-translateY-37",
              "targets": [
                "w-lookup-8"
              ],
              "property": "translateY",
              "from": 0,
              "to": -21.24,
              "startFrame": 422,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-lookup-11-opacity-38",
              "targets": [
                "w-lookup-11"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 422,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-lookup-11-translateY-39",
              "targets": [
                "w-lookup-11"
              ],
              "property": "translateY",
              "from": 0,
              "to": -21.24,
              "startFrame": 422,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-lookup-14-opacity-40",
              "targets": [
                "w-lookup-14"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 422,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-lookup-14-translateY-41",
              "targets": [
                "w-lookup-14"
              ],
              "property": "translateY",
              "from": 0,
              "to": -21.24,
              "startFrame": 422,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-lookup-17-opacity-42",
              "targets": [
                "w-lookup-17"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 422,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-lookup-17-translateY-43",
              "targets": [
                "w-lookup-17"
              ],
              "property": "translateY",
              "from": 0,
              "to": -21.24,
              "startFrame": 422,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-lookup-20-opacity-44",
              "targets": [
                "w-lookup-20"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 422,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-lookup-20-translateY-45",
              "targets": [
                "w-lookup-20"
              ],
              "property": "translateY",
              "from": 0,
              "to": -21.24,
              "startFrame": 422,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-lookup-23-opacity-46",
              "targets": [
                "w-lookup-23"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 422,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-lookup-23-translateY-47",
              "targets": [
                "w-lookup-23"
              ],
              "property": "translateY",
              "from": 0,
              "to": -21.24,
              "startFrame": 422,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-lookup-26-opacity-48",
              "targets": [
                "w-lookup-26"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 422,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-lookup-26-translateY-49",
              "targets": [
                "w-lookup-26"
              ],
              "property": "translateY",
              "from": 0,
              "to": -21.24,
              "startFrame": 422,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-lookup-29-opacity-50",
              "targets": [
                "w-lookup-29"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 422,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-lookup-29-translateY-51",
              "targets": [
                "w-lookup-29"
              ],
              "property": "translateY",
              "from": 0,
              "to": -21.24,
              "startFrame": 422,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "search-opacity-52",
              "targets": [
                "search"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 396,
              "durationFrames": 10
            },
            {
              "clipId": "sb-cover-scaleX-53",
              "targets": [
                "sb-cover"
              ],
              "property": "scaleX",
              "from": 1,
              "to": 0.9,
              "startFrame": 404,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 520,
                "y": 0
              }
            },
            {
              "clipId": "sb-cover-scaleX-54",
              "targets": [
                "sb-cover"
              ],
              "property": "scaleX",
              "from": 0.9,
              "to": 0.85,
              "startFrame": 405,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 520,
                "y": 0
              }
            },
            {
              "clipId": "sb-cover-scaleX-55",
              "targets": [
                "sb-cover"
              ],
              "property": "scaleX",
              "from": 0.85,
              "to": 0.75,
              "startFrame": 406,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 520,
                "y": 0
              }
            },
            {
              "clipId": "sb-cover-scaleX-56",
              "targets": [
                "sb-cover"
              ],
              "property": "scaleX",
              "from": 0.75,
              "to": 0.65,
              "startFrame": 407,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 520,
                "y": 0
              }
            },
            {
              "clipId": "sb-cover-scaleX-57",
              "targets": [
                "sb-cover"
              ],
              "property": "scaleX",
              "from": 0.65,
              "to": 0.6,
              "startFrame": 408,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 520,
                "y": 0
              }
            },
            {
              "clipId": "sb-cover-scaleX-58",
              "targets": [
                "sb-cover"
              ],
              "property": "scaleX",
              "from": 0.6,
              "to": 0.5,
              "startFrame": 409,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 520,
                "y": 0
              }
            },
            {
              "clipId": "sb-cover-scaleX-59",
              "targets": [
                "sb-cover"
              ],
              "property": "scaleX",
              "from": 0.5,
              "to": 0.4,
              "startFrame": 410,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 520,
                "y": 0
              }
            },
            {
              "clipId": "sb-cover-scaleX-60",
              "targets": [
                "sb-cover"
              ],
              "property": "scaleX",
              "from": 0.4,
              "to": 0.35,
              "startFrame": 411,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 520,
                "y": 0
              }
            },
            {
              "clipId": "sb-cover-scaleX-61",
              "targets": [
                "sb-cover"
              ],
              "property": "scaleX",
              "from": 0.35,
              "to": 0.25,
              "startFrame": 412,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 520,
                "y": 0
              }
            },
            {
              "clipId": "sb-cover-scaleX-62",
              "targets": [
                "sb-cover"
              ],
              "property": "scaleX",
              "from": 0.25,
              "to": 0.15000000000000002,
              "startFrame": 413,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 520,
                "y": 0
              }
            },
            {
              "clipId": "sb-cover-scaleX-63",
              "targets": [
                "sb-cover"
              ],
              "property": "scaleX",
              "from": 0.15000000000000002,
              "to": 0.09999999999999998,
              "startFrame": 414,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 520,
                "y": 0
              }
            },
            {
              "clipId": "sb-cover-scaleX-64",
              "targets": [
                "sb-cover"
              ],
              "property": "scaleX",
              "from": 0.09999999999999998,
              "to": 0,
              "startFrame": 415,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 520,
                "y": 0
              }
            },
            {
              "clipId": "sb-caret-translateX-65",
              "targets": [
                "sb-caret"
              ],
              "property": "translateX",
              "from": 0,
              "to": 40.8,
              "startFrame": 404,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "sb-caret-translateX-66",
              "targets": [
                "sb-caret"
              ],
              "property": "translateX",
              "from": 40.8,
              "to": 61.199999999999996,
              "startFrame": 405,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "sb-caret-translateX-67",
              "targets": [
                "sb-caret"
              ],
              "property": "translateX",
              "from": 61.199999999999996,
              "to": 102,
              "startFrame": 406,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "sb-caret-translateX-68",
              "targets": [
                "sb-caret"
              ],
              "property": "translateX",
              "from": 102,
              "to": 142.79999999999998,
              "startFrame": 407,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "sb-caret-translateX-69",
              "targets": [
                "sb-caret"
              ],
              "property": "translateX",
              "from": 142.79999999999998,
              "to": 163.2,
              "startFrame": 408,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "sb-caret-translateX-70",
              "targets": [
                "sb-caret"
              ],
              "property": "translateX",
              "from": 163.2,
              "to": 204,
              "startFrame": 409,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "sb-caret-translateX-71",
              "targets": [
                "sb-caret"
              ],
              "property": "translateX",
              "from": 204,
              "to": 244.79999999999998,
              "startFrame": 410,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "sb-caret-translateX-72",
              "targets": [
                "sb-caret"
              ],
              "property": "translateX",
              "from": 244.79999999999998,
              "to": 265.2,
              "startFrame": 411,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "sb-caret-translateX-73",
              "targets": [
                "sb-caret"
              ],
              "property": "translateX",
              "from": 265.2,
              "to": 306,
              "startFrame": 412,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "sb-caret-translateX-74",
              "targets": [
                "sb-caret"
              ],
              "property": "translateX",
              "from": 306,
              "to": 346.79999999999995,
              "startFrame": 413,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "sb-caret-translateX-75",
              "targets": [
                "sb-caret"
              ],
              "property": "translateX",
              "from": 346.79999999999995,
              "to": 367.2,
              "startFrame": 414,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "sb-caret-translateX-76",
              "targets": [
                "sb-caret"
              ],
              "property": "translateX",
              "from": 367.2,
              "to": 408,
              "startFrame": 415,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "search-opacity-77",
              "targets": [
                "search"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 424,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-title-78-translateY-79",
              "targets": [
                "w-title-78"
              ],
              "property": "translateY",
              "from": 224.4,
              "to": 0,
              "startFrame": 429,
              "durationFrames": 14
            },
            {
              "clipId": "w-title-80-translateY-81",
              "targets": [
                "w-title-80"
              ],
              "property": "translateY",
              "from": 224.4,
              "to": 0,
              "startFrame": 444,
              "durationFrames": 14
            },
            {
              "clipId": "w-title-82-translateY-83",
              "targets": [
                "w-title-82"
              ],
              "property": "translateY",
              "from": 224.4,
              "to": 0,
              "startFrame": 475,
              "durationFrames": 14
            },
            {
              "clipId": "note-0-opacity-84",
              "targets": [
                "note-0"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 436,
              "durationFrames": 8
            },
            {
              "clipId": "note-1-opacity-85",
              "targets": [
                "note-1"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 451,
              "durationFrames": 8
            },
            {
              "clipId": "note-2-opacity-86",
              "targets": [
                "note-2"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 482,
              "durationFrames": 8
            },
            {
              "clipId": "card-translateY-87",
              "targets": [
                "card"
              ],
              "property": "translateY",
              "from": 1080,
              "to": 0,
              "startFrame": 420,
              "durationFrames": 16
            },
            {
              "clipId": "card-translateY-88",
              "targets": [
                "card"
              ],
              "property": "translateY",
              "from": 0,
              "to": -1080,
              "startFrame": 497,
              "durationFrames": 16,
              "easing": "expoInOut"
            }
          ]
        }
      },
      {
        "assetId": "flow",
        "svgSource": "videos/rag-explainer/visuals/flow.svg",
        "layer": 6,
        "position": {
          "x": 0,
          "y": 0
        },
        "scale": 1,
        "rotation": 0,
        "opacity": 1,
        "animation": {
          "timelineId": "flow-motion",
          "clips": [
            {
              "clipId": "root-opacity-0",
              "targets": [
                "root"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 511,
              "durationFrames": 4,
              "easing": "linear"
            },
            {
              "clipId": "root-opacity-1",
              "targets": [
                "root"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1382,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "step-0-opacity-2",
              "targets": [
                "step-0"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 512,
              "durationFrames": 6
            },
            {
              "clipId": "step-0-opacity-3",
              "targets": [
                "step-0"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 816,
              "durationFrames": 5,
              "easing": "linear"
            },
            {
              "clipId": "step-1-opacity-4",
              "targets": [
                "step-1"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 818,
              "durationFrames": 6
            },
            {
              "clipId": "step-1-opacity-5",
              "targets": [
                "step-1"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1039,
              "durationFrames": 5,
              "easing": "linear"
            },
            {
              "clipId": "step-2-opacity-6",
              "targets": [
                "step-2"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1041,
              "durationFrames": 6
            },
            {
              "clipId": "step-2-opacity-7",
              "targets": [
                "step-2"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1236,
              "durationFrames": 5,
              "easing": "linear"
            },
            {
              "clipId": "step-3-opacity-8",
              "targets": [
                "step-3"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1238,
              "durationFrames": 6
            },
            {
              "clipId": "ro-0-0-opacity-9",
              "targets": [
                "ro-0-0"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 521,
              "durationFrames": 8
            },
            {
              "clipId": "ro-0-1-opacity-10",
              "targets": [
                "ro-0-1"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 527,
              "durationFrames": 8
            },
            {
              "clipId": "ro-0-0-opacity-11",
              "targets": [
                "ro-0-0"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 816,
              "durationFrames": 5,
              "easing": "linear"
            },
            {
              "clipId": "ro-0-1-opacity-12",
              "targets": [
                "ro-0-1"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 816,
              "durationFrames": 5,
              "easing": "linear"
            },
            {
              "clipId": "ro-1-0-opacity-13",
              "targets": [
                "ro-1-0"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 827,
              "durationFrames": 8
            },
            {
              "clipId": "ro-1-1-opacity-14",
              "targets": [
                "ro-1-1"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 833,
              "durationFrames": 8
            },
            {
              "clipId": "ro-1-0-opacity-15",
              "targets": [
                "ro-1-0"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1039,
              "durationFrames": 5,
              "easing": "linear"
            },
            {
              "clipId": "ro-1-1-opacity-16",
              "targets": [
                "ro-1-1"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1039,
              "durationFrames": 5,
              "easing": "linear"
            },
            {
              "clipId": "ro-2-0-opacity-17",
              "targets": [
                "ro-2-0"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1050,
              "durationFrames": 8
            },
            {
              "clipId": "ro-2-1-opacity-18",
              "targets": [
                "ro-2-1"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1056,
              "durationFrames": 8
            },
            {
              "clipId": "ro-2-0-opacity-19",
              "targets": [
                "ro-2-0"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1236,
              "durationFrames": 5,
              "easing": "linear"
            },
            {
              "clipId": "ro-2-1-opacity-20",
              "targets": [
                "ro-2-1"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1236,
              "durationFrames": 5,
              "easing": "linear"
            },
            {
              "clipId": "ro-3-0-opacity-21",
              "targets": [
                "ro-3-0"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1247,
              "durationFrames": 8
            },
            {
              "clipId": "ro-3-1-opacity-22",
              "targets": [
                "ro-3-1"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1253,
              "durationFrames": 8
            },
            {
              "clipId": "w-tear-23-translateY-24",
              "targets": [
                "w-tear-23"
              ],
              "property": "translateY",
              "from": 41.6,
              "to": 0,
              "startFrame": 510,
              "durationFrames": 10
            },
            {
              "clipId": "w-tear-23-opacity-25",
              "targets": [
                "w-tear-23"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 510,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-tear-26-translateY-27",
              "targets": [
                "w-tear-26"
              ],
              "property": "translateY",
              "from": 41.6,
              "to": 0,
              "startFrame": 515,
              "durationFrames": 10
            },
            {
              "clipId": "w-tear-26-opacity-28",
              "targets": [
                "w-tear-26"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 515,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-tear-29-translateY-30",
              "targets": [
                "w-tear-29"
              ],
              "property": "translateY",
              "from": 41.6,
              "to": 0,
              "startFrame": 534,
              "durationFrames": 10
            },
            {
              "clipId": "w-tear-29-opacity-31",
              "targets": [
                "w-tear-29"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 534,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-tear-32-translateY-33",
              "targets": [
                "w-tear-32"
              ],
              "property": "translateY",
              "from": 41.6,
              "to": 0,
              "startFrame": 537,
              "durationFrames": 10
            },
            {
              "clipId": "w-tear-32-opacity-34",
              "targets": [
                "w-tear-32"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 537,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-tear-35-translateY-36",
              "targets": [
                "w-tear-35"
              ],
              "property": "translateY",
              "from": 41.6,
              "to": 0,
              "startFrame": 541,
              "durationFrames": 10
            },
            {
              "clipId": "w-tear-35-opacity-37",
              "targets": [
                "w-tear-35"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 541,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-tear-38-translateY-39",
              "targets": [
                "w-tear-38"
              ],
              "property": "translateY",
              "from": 41.6,
              "to": 0,
              "startFrame": 555,
              "durationFrames": 10
            },
            {
              "clipId": "w-tear-38-opacity-40",
              "targets": [
                "w-tear-38"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 555,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-tear-41-translateY-42",
              "targets": [
                "w-tear-41"
              ],
              "property": "translateY",
              "from": 41.6,
              "to": 0,
              "startFrame": 561,
              "durationFrames": 10
            },
            {
              "clipId": "w-tear-41-opacity-43",
              "targets": [
                "w-tear-41"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 561,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-tear-23-opacity-44",
              "targets": [
                "w-tear-23"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 581,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-tear-23-translateY-45",
              "targets": [
                "w-tear-23"
              ],
              "property": "translateY",
              "from": 0,
              "to": -18.72,
              "startFrame": 581,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-tear-26-opacity-46",
              "targets": [
                "w-tear-26"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 581,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-tear-26-translateY-47",
              "targets": [
                "w-tear-26"
              ],
              "property": "translateY",
              "from": 0,
              "to": -18.72,
              "startFrame": 581,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-tear-29-opacity-48",
              "targets": [
                "w-tear-29"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 581,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-tear-29-translateY-49",
              "targets": [
                "w-tear-29"
              ],
              "property": "translateY",
              "from": 0,
              "to": -18.72,
              "startFrame": 581,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-tear-32-opacity-50",
              "targets": [
                "w-tear-32"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 581,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-tear-32-translateY-51",
              "targets": [
                "w-tear-32"
              ],
              "property": "translateY",
              "from": 0,
              "to": -18.72,
              "startFrame": 581,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-tear-35-opacity-52",
              "targets": [
                "w-tear-35"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 581,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-tear-35-translateY-53",
              "targets": [
                "w-tear-35"
              ],
              "property": "translateY",
              "from": 0,
              "to": -18.72,
              "startFrame": 581,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-tear-38-opacity-54",
              "targets": [
                "w-tear-38"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 581,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-tear-38-translateY-55",
              "targets": [
                "w-tear-38"
              ],
              "property": "translateY",
              "from": 0,
              "to": -18.72,
              "startFrame": 581,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-tear-41-opacity-56",
              "targets": [
                "w-tear-41"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 581,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-tear-41-translateY-57",
              "targets": [
                "w-tear-41"
              ],
              "property": "translateY",
              "from": 0,
              "to": -18.72,
              "startFrame": 581,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-overlap-58-translateY-59",
              "targets": [
                "w-overlap-58"
              ],
              "property": "translateY",
              "from": 36.800000000000004,
              "to": 0,
              "startFrame": 588,
              "durationFrames": 10
            },
            {
              "clipId": "w-overlap-58-opacity-60",
              "targets": [
                "w-overlap-58"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 588,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-overlap-61-translateY-62",
              "targets": [
                "w-overlap-61"
              ],
              "property": "translateY",
              "from": 36.800000000000004,
              "to": 0,
              "startFrame": 594,
              "durationFrames": 10
            },
            {
              "clipId": "w-overlap-61-opacity-63",
              "targets": [
                "w-overlap-61"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 594,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-overlap-64-translateY-65",
              "targets": [
                "w-overlap-64"
              ],
              "property": "translateY",
              "from": 36.800000000000004,
              "to": 0,
              "startFrame": 604,
              "durationFrames": 10
            },
            {
              "clipId": "w-overlap-64-opacity-66",
              "targets": [
                "w-overlap-64"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 604,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-overlap-67-translateY-68",
              "targets": [
                "w-overlap-67"
              ],
              "property": "translateY",
              "from": 36.800000000000004,
              "to": 0,
              "startFrame": 613,
              "durationFrames": 10
            },
            {
              "clipId": "w-overlap-67-opacity-69",
              "targets": [
                "w-overlap-67"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 613,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-overlap-70-translateY-71",
              "targets": [
                "w-overlap-70"
              ],
              "property": "translateY",
              "from": 36.800000000000004,
              "to": 0,
              "startFrame": 616,
              "durationFrames": 10
            },
            {
              "clipId": "w-overlap-70-opacity-72",
              "targets": [
                "w-overlap-70"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 616,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-overlap-73-translateY-74",
              "targets": [
                "w-overlap-73"
              ],
              "property": "translateY",
              "from": 36.800000000000004,
              "to": 0,
              "startFrame": 619,
              "durationFrames": 10
            },
            {
              "clipId": "w-overlap-73-opacity-75",
              "targets": [
                "w-overlap-73"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 619,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-overlap-76-translateY-77",
              "targets": [
                "w-overlap-76"
              ],
              "property": "translateY",
              "from": 36.800000000000004,
              "to": 0,
              "startFrame": 633,
              "durationFrames": 10
            },
            {
              "clipId": "w-overlap-76-opacity-78",
              "targets": [
                "w-overlap-76"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 633,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-overlap-79-translateY-80",
              "targets": [
                "w-overlap-79"
              ],
              "property": "translateY",
              "from": 36.800000000000004,
              "to": 0,
              "startFrame": 646,
              "durationFrames": 10
            },
            {
              "clipId": "w-overlap-79-opacity-81",
              "targets": [
                "w-overlap-79"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 646,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-overlap-82-translateY-83",
              "targets": [
                "w-overlap-82"
              ],
              "property": "translateY",
              "from": 36.800000000000004,
              "to": 0,
              "startFrame": 652,
              "durationFrames": 10
            },
            {
              "clipId": "w-overlap-82-opacity-84",
              "targets": [
                "w-overlap-82"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 652,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-overlap-85-translateY-86",
              "targets": [
                "w-overlap-85"
              ],
              "property": "translateY",
              "from": 36.800000000000004,
              "to": 0,
              "startFrame": 663,
              "durationFrames": 10
            },
            {
              "clipId": "w-overlap-85-opacity-87",
              "targets": [
                "w-overlap-85"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 663,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-overlap-88-translateY-89",
              "targets": [
                "w-overlap-88"
              ],
              "property": "translateY",
              "from": 36.800000000000004,
              "to": 0,
              "startFrame": 675,
              "durationFrames": 10
            },
            {
              "clipId": "w-overlap-88-opacity-90",
              "targets": [
                "w-overlap-88"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 675,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-overlap-58-opacity-91",
              "targets": [
                "w-overlap-58"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 692,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-overlap-58-translateY-92",
              "targets": [
                "w-overlap-58"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 692,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-overlap-61-opacity-93",
              "targets": [
                "w-overlap-61"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 692,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-overlap-61-translateY-94",
              "targets": [
                "w-overlap-61"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 692,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-overlap-64-opacity-95",
              "targets": [
                "w-overlap-64"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 692,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-overlap-64-translateY-96",
              "targets": [
                "w-overlap-64"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 692,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-overlap-67-opacity-97",
              "targets": [
                "w-overlap-67"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 692,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-overlap-67-translateY-98",
              "targets": [
                "w-overlap-67"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 692,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-overlap-70-opacity-99",
              "targets": [
                "w-overlap-70"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 692,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-overlap-70-translateY-100",
              "targets": [
                "w-overlap-70"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 692,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-overlap-73-opacity-101",
              "targets": [
                "w-overlap-73"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 692,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-overlap-73-translateY-102",
              "targets": [
                "w-overlap-73"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 692,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-overlap-76-opacity-103",
              "targets": [
                "w-overlap-76"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 692,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-overlap-76-translateY-104",
              "targets": [
                "w-overlap-76"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 692,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-overlap-79-opacity-105",
              "targets": [
                "w-overlap-79"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 692,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-overlap-79-translateY-106",
              "targets": [
                "w-overlap-79"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 692,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-overlap-82-opacity-107",
              "targets": [
                "w-overlap-82"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 692,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-overlap-82-translateY-108",
              "targets": [
                "w-overlap-82"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 692,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-overlap-85-opacity-109",
              "targets": [
                "w-overlap-85"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 692,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-overlap-85-translateY-110",
              "targets": [
                "w-overlap-85"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 692,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-overlap-88-opacity-111",
              "targets": [
                "w-overlap-88"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 692,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-overlap-88-translateY-112",
              "targets": [
                "w-overlap-88"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 692,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-sizes-113-translateY-114",
              "targets": [
                "w-sizes-113"
              ],
              "property": "translateY",
              "from": -42,
              "to": 0,
              "startFrame": 699,
              "durationFrames": 10
            },
            {
              "clipId": "w-sizes-113-opacity-115",
              "targets": [
                "w-sizes-113"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 699,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-sizes-116-translateY-117",
              "targets": [
                "w-sizes-116"
              ],
              "property": "translateY",
              "from": -42,
              "to": 0,
              "startFrame": 702,
              "durationFrames": 10
            },
            {
              "clipId": "w-sizes-116-opacity-118",
              "targets": [
                "w-sizes-116"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 702,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-sizes-119-translateY-120",
              "targets": [
                "w-sizes-119"
              ],
              "property": "translateY",
              "from": -42,
              "to": 0,
              "startFrame": 720,
              "durationFrames": 10
            },
            {
              "clipId": "w-sizes-119-opacity-121",
              "targets": [
                "w-sizes-119"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 720,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-sizes-122-translateY-123",
              "targets": [
                "w-sizes-122"
              ],
              "property": "translateY",
              "from": -42,
              "to": 0,
              "startFrame": 721,
              "durationFrames": 10
            },
            {
              "clipId": "w-sizes-122-opacity-124",
              "targets": [
                "w-sizes-122"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 721,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-sizes-125-translateY-126",
              "targets": [
                "w-sizes-125"
              ],
              "property": "translateY",
              "from": -42,
              "to": 0,
              "startFrame": 729,
              "durationFrames": 10
            },
            {
              "clipId": "w-sizes-125-opacity-127",
              "targets": [
                "w-sizes-125"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 729,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-sizes-128-translateY-129",
              "targets": [
                "w-sizes-128"
              ],
              "property": "translateY",
              "from": -42,
              "to": 0,
              "startFrame": 735,
              "durationFrames": 10
            },
            {
              "clipId": "w-sizes-128-opacity-130",
              "targets": [
                "w-sizes-128"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 735,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-sizes-131-translateY-132",
              "targets": [
                "w-sizes-131"
              ],
              "property": "translateY",
              "from": -42,
              "to": 0,
              "startFrame": 754,
              "durationFrames": 10
            },
            {
              "clipId": "w-sizes-131-opacity-133",
              "targets": [
                "w-sizes-131"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 754,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-sizes-134-translateY-135",
              "targets": [
                "w-sizes-134"
              ],
              "property": "translateY",
              "from": -42,
              "to": 0,
              "startFrame": 760,
              "durationFrames": 10
            },
            {
              "clipId": "w-sizes-134-opacity-136",
              "targets": [
                "w-sizes-134"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 760,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-sizes-137-translateY-138",
              "targets": [
                "w-sizes-137"
              ],
              "property": "translateY",
              "from": -42,
              "to": 0,
              "startFrame": 775,
              "durationFrames": 10
            },
            {
              "clipId": "w-sizes-137-opacity-139",
              "targets": [
                "w-sizes-137"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 775,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-sizes-140-translateY-141",
              "targets": [
                "w-sizes-140"
              ],
              "property": "translateY",
              "from": -42,
              "to": 0,
              "startFrame": 777,
              "durationFrames": 10
            },
            {
              "clipId": "w-sizes-140-opacity-142",
              "targets": [
                "w-sizes-140"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 777,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-sizes-143-translateY-144",
              "targets": [
                "w-sizes-143"
              ],
              "property": "translateY",
              "from": -42,
              "to": 0,
              "startFrame": 784,
              "durationFrames": 10
            },
            {
              "clipId": "w-sizes-143-opacity-145",
              "targets": [
                "w-sizes-143"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 784,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-sizes-113-opacity-146",
              "targets": [
                "w-sizes-113"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 809,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-sizes-113-translateY-147",
              "targets": [
                "w-sizes-113"
              ],
              "property": "translateY",
              "from": 0,
              "to": -15.12,
              "startFrame": 809,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-sizes-116-opacity-148",
              "targets": [
                "w-sizes-116"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 809,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-sizes-116-translateY-149",
              "targets": [
                "w-sizes-116"
              ],
              "property": "translateY",
              "from": 0,
              "to": -15.12,
              "startFrame": 809,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-sizes-119-opacity-150",
              "targets": [
                "w-sizes-119"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 809,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-sizes-119-translateY-151",
              "targets": [
                "w-sizes-119"
              ],
              "property": "translateY",
              "from": 0,
              "to": -15.12,
              "startFrame": 809,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-sizes-122-opacity-152",
              "targets": [
                "w-sizes-122"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 809,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-sizes-122-translateY-153",
              "targets": [
                "w-sizes-122"
              ],
              "property": "translateY",
              "from": 0,
              "to": -15.12,
              "startFrame": 809,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-sizes-125-opacity-154",
              "targets": [
                "w-sizes-125"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 809,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-sizes-125-translateY-155",
              "targets": [
                "w-sizes-125"
              ],
              "property": "translateY",
              "from": 0,
              "to": -15.12,
              "startFrame": 809,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-sizes-128-opacity-156",
              "targets": [
                "w-sizes-128"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 809,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-sizes-128-translateY-157",
              "targets": [
                "w-sizes-128"
              ],
              "property": "translateY",
              "from": 0,
              "to": -15.12,
              "startFrame": 809,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-sizes-131-opacity-158",
              "targets": [
                "w-sizes-131"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 809,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-sizes-131-translateY-159",
              "targets": [
                "w-sizes-131"
              ],
              "property": "translateY",
              "from": 0,
              "to": -15.12,
              "startFrame": 809,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-sizes-134-opacity-160",
              "targets": [
                "w-sizes-134"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 809,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-sizes-134-translateY-161",
              "targets": [
                "w-sizes-134"
              ],
              "property": "translateY",
              "from": 0,
              "to": -15.12,
              "startFrame": 809,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-sizes-137-opacity-162",
              "targets": [
                "w-sizes-137"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 809,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-sizes-137-translateY-163",
              "targets": [
                "w-sizes-137"
              ],
              "property": "translateY",
              "from": 0,
              "to": -15.12,
              "startFrame": 809,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-sizes-140-opacity-164",
              "targets": [
                "w-sizes-140"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 809,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-sizes-140-translateY-165",
              "targets": [
                "w-sizes-140"
              ],
              "property": "translateY",
              "from": 0,
              "to": -15.12,
              "startFrame": 809,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-sizes-143-opacity-166",
              "targets": [
                "w-sizes-143"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 809,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-sizes-143-translateY-167",
              "targets": [
                "w-sizes-143"
              ],
              "property": "translateY",
              "from": 0,
              "to": -15.12,
              "startFrame": 809,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "page-opacity-168",
              "targets": [
                "page"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 515,
              "durationFrames": 10
            },
            {
              "clipId": "ck-0-opacity-169",
              "targets": [
                "ck-0"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 515,
              "durationFrames": 10
            },
            {
              "clipId": "ck-1-opacity-170",
              "targets": [
                "ck-1"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 515,
              "durationFrames": 10
            },
            {
              "clipId": "ck-2-opacity-171",
              "targets": [
                "ck-2"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 515,
              "durationFrames": 10
            },
            {
              "clipId": "ck-3-opacity-172",
              "targets": [
                "ck-3"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 515,
              "durationFrames": 10
            },
            {
              "clipId": "ck-4-opacity-173",
              "targets": [
                "ck-4"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 515,
              "durationFrames": 10
            },
            {
              "clipId": "ck-5-opacity-174",
              "targets": [
                "ck-5"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 515,
              "durationFrames": 10
            },
            {
              "clipId": "page-opacity-175",
              "targets": [
                "page"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 560,
              "durationFrames": 8,
              "easing": "linear"
            },
            {
              "clipId": "ck-0-translateX-176",
              "targets": [
                "ck-0"
              ],
              "property": "translateX",
              "from": 0,
              "to": -10,
              "startFrame": 556,
              "durationFrames": 16,
              "origin": {
                "x": 200,
                "y": 30
              }
            },
            {
              "clipId": "ck-0-rotate-177",
              "targets": [
                "ck-0"
              ],
              "property": "rotate",
              "from": 0,
              "to": -1.8,
              "startFrame": 556,
              "durationFrames": 16,
              "origin": {
                "x": 200,
                "y": 30
              }
            },
            {
              "clipId": "ck-1-translateX-178",
              "targets": [
                "ck-1"
              ],
              "property": "translateX",
              "from": 0,
              "to": 26,
              "startFrame": 559,
              "durationFrames": 16,
              "origin": {
                "x": 200,
                "y": 30
              }
            },
            {
              "clipId": "ck-1-translateY-179",
              "targets": [
                "ck-1"
              ],
              "property": "translateY",
              "from": 0,
              "to": 14,
              "startFrame": 559,
              "durationFrames": 16,
              "origin": {
                "x": 200,
                "y": 30
              }
            },
            {
              "clipId": "ck-1-rotate-180",
              "targets": [
                "ck-1"
              ],
              "property": "rotate",
              "from": 0,
              "to": 2.2,
              "startFrame": 559,
              "durationFrames": 16,
              "origin": {
                "x": 200,
                "y": 30
              }
            },
            {
              "clipId": "ck-2-translateX-181",
              "targets": [
                "ck-2"
              ],
              "property": "translateX",
              "from": 0,
              "to": -10,
              "startFrame": 562,
              "durationFrames": 16,
              "origin": {
                "x": 200,
                "y": 30
              }
            },
            {
              "clipId": "ck-2-translateY-182",
              "targets": [
                "ck-2"
              ],
              "property": "translateY",
              "from": 0,
              "to": 28,
              "startFrame": 562,
              "durationFrames": 16,
              "origin": {
                "x": 200,
                "y": 30
              }
            },
            {
              "clipId": "ck-2-rotate-183",
              "targets": [
                "ck-2"
              ],
              "property": "rotate",
              "from": 0,
              "to": -1.8,
              "startFrame": 562,
              "durationFrames": 16,
              "origin": {
                "x": 200,
                "y": 30
              }
            },
            {
              "clipId": "ck-3-translateX-184",
              "targets": [
                "ck-3"
              ],
              "property": "translateX",
              "from": 0,
              "to": 26,
              "startFrame": 565,
              "durationFrames": 16,
              "origin": {
                "x": 200,
                "y": 30
              }
            },
            {
              "clipId": "ck-3-translateY-185",
              "targets": [
                "ck-3"
              ],
              "property": "translateY",
              "from": 0,
              "to": 42,
              "startFrame": 565,
              "durationFrames": 16,
              "origin": {
                "x": 200,
                "y": 30
              }
            },
            {
              "clipId": "ck-3-rotate-186",
              "targets": [
                "ck-3"
              ],
              "property": "rotate",
              "from": 0,
              "to": 2.2,
              "startFrame": 565,
              "durationFrames": 16,
              "origin": {
                "x": 200,
                "y": 30
              }
            },
            {
              "clipId": "ck-4-translateX-187",
              "targets": [
                "ck-4"
              ],
              "property": "translateX",
              "from": 0,
              "to": -10,
              "startFrame": 568,
              "durationFrames": 16,
              "origin": {
                "x": 200,
                "y": 30
              }
            },
            {
              "clipId": "ck-4-translateY-188",
              "targets": [
                "ck-4"
              ],
              "property": "translateY",
              "from": 0,
              "to": 56,
              "startFrame": 568,
              "durationFrames": 16,
              "origin": {
                "x": 200,
                "y": 30
              }
            },
            {
              "clipId": "ck-4-rotate-189",
              "targets": [
                "ck-4"
              ],
              "property": "rotate",
              "from": 0,
              "to": -1.8,
              "startFrame": 568,
              "durationFrames": 16,
              "origin": {
                "x": 200,
                "y": 30
              }
            },
            {
              "clipId": "ck-5-translateX-190",
              "targets": [
                "ck-5"
              ],
              "property": "translateX",
              "from": 0,
              "to": 26,
              "startFrame": 571,
              "durationFrames": 16,
              "origin": {
                "x": 200,
                "y": 30
              }
            },
            {
              "clipId": "ck-5-translateY-191",
              "targets": [
                "ck-5"
              ],
              "property": "translateY",
              "from": 0,
              "to": 70,
              "startFrame": 571,
              "durationFrames": 16,
              "origin": {
                "x": 200,
                "y": 30
              }
            },
            {
              "clipId": "ck-5-rotate-192",
              "targets": [
                "ck-5"
              ],
              "property": "rotate",
              "from": 0,
              "to": 2.2,
              "startFrame": 571,
              "durationFrames": 16,
              "origin": {
                "x": 200,
                "y": 30
              }
            },
            {
              "clipId": "cb-0-opacity-193",
              "targets": [
                "cb-0"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 562,
              "durationFrames": 10
            },
            {
              "clipId": "cb-1-opacity-194",
              "targets": [
                "cb-1"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 565,
              "durationFrames": 10
            },
            {
              "clipId": "cb-2-opacity-195",
              "targets": [
                "cb-2"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 568,
              "durationFrames": 10
            },
            {
              "clipId": "cb-3-opacity-196",
              "targets": [
                "cb-3"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 571,
              "durationFrames": 10
            },
            {
              "clipId": "cb-4-opacity-197",
              "targets": [
                "cb-4"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 574,
              "durationFrames": 10
            },
            {
              "clipId": "cb-5-opacity-198",
              "targets": [
                "cb-5"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 577,
              "durationFrames": 10
            },
            {
              "clipId": "cl-0-opacity-199",
              "targets": [
                "cl-0"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 562,
              "durationFrames": 8
            },
            {
              "clipId": "cl-1-opacity-200",
              "targets": [
                "cl-1"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 565,
              "durationFrames": 8
            },
            {
              "clipId": "cl-2-opacity-201",
              "targets": [
                "cl-2"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 568,
              "durationFrames": 8
            },
            {
              "clipId": "cl-3-opacity-202",
              "targets": [
                "cl-3"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 571,
              "durationFrames": 8
            },
            {
              "clipId": "cl-4-opacity-203",
              "targets": [
                "cl-4"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 574,
              "durationFrames": 8
            },
            {
              "clipId": "cl-5-opacity-204",
              "targets": [
                "cl-5"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 577,
              "durationFrames": 8
            },
            {
              "clipId": "ov-0-opacity-205",
              "targets": [
                "ov-0"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 620,
              "durationFrames": 8
            },
            {
              "clipId": "ov-1-opacity-206",
              "targets": [
                "ov-1"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 624,
              "durationFrames": 8
            },
            {
              "clipId": "ov-2-opacity-207",
              "targets": [
                "ov-2"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 628,
              "durationFrames": 8
            },
            {
              "clipId": "ov-3-opacity-208",
              "targets": [
                "ov-3"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 632,
              "durationFrames": 8
            },
            {
              "clipId": "ov-4-opacity-209",
              "targets": [
                "ov-4"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 636,
              "durationFrames": 8
            },
            {
              "clipId": "ov-label-opacity-210",
              "targets": [
                "ov-label"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 624,
              "durationFrames": 8
            },
            {
              "clipId": "stack-opacity-211",
              "targets": [
                "stack"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 694,
              "durationFrames": 8,
              "easing": "linear"
            },
            {
              "clipId": "small-box-opacity-212",
              "targets": [
                "small-box"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 699,
              "durationFrames": 8
            },
            {
              "clipId": "chip-0-opacity-213",
              "targets": [
                "chip-0"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 703,
              "durationFrames": 8
            },
            {
              "clipId": "chip-1-opacity-214",
              "targets": [
                "chip-1"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 705,
              "durationFrames": 8
            },
            {
              "clipId": "chip-2-opacity-215",
              "targets": [
                "chip-2"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 707,
              "durationFrames": 8
            },
            {
              "clipId": "chip-3-opacity-216",
              "targets": [
                "chip-3"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 709,
              "durationFrames": 8
            },
            {
              "clipId": "chip-4-opacity-217",
              "targets": [
                "chip-4"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 711,
              "durationFrames": 8
            },
            {
              "clipId": "chip-5-opacity-218",
              "targets": [
                "chip-5"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 713,
              "durationFrames": 8
            },
            {
              "clipId": "chip-6-opacity-219",
              "targets": [
                "chip-6"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 715,
              "durationFrames": 8
            },
            {
              "clipId": "chip-7-opacity-220",
              "targets": [
                "chip-7"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 717,
              "durationFrames": 8
            },
            {
              "clipId": "chip-8-opacity-221",
              "targets": [
                "chip-8"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 719,
              "durationFrames": 8
            },
            {
              "clipId": "chip-9-opacity-222",
              "targets": [
                "chip-9"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 721,
              "durationFrames": 8
            },
            {
              "clipId": "chip-10-opacity-223",
              "targets": [
                "chip-10"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 723,
              "durationFrames": 8
            },
            {
              "clipId": "chip-11-opacity-224",
              "targets": [
                "chip-11"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 725,
              "durationFrames": 8
            },
            {
              "clipId": "big-box-opacity-225",
              "targets": [
                "big-box"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 757,
              "durationFrames": 8
            },
            {
              "clipId": "noise-opacity-226",
              "targets": [
                "noise"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 761,
              "durationFrames": 14
            },
            {
              "clipId": "signal-opacity-227",
              "targets": [
                "signal"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 761,
              "durationFrames": 8
            },
            {
              "clipId": "signal-opacity-228",
              "targets": [
                "signal"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0.18,
              "startFrame": 785,
              "durationFrames": 14,
              "easing": "linear"
            },
            {
              "clipId": "small-box-opacity-229",
              "targets": [
                "small-box"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 807,
              "durationFrames": 8,
              "easing": "linear"
            },
            {
              "clipId": "chip-0-opacity-230",
              "targets": [
                "chip-0"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 807,
              "durationFrames": 8,
              "easing": "linear"
            },
            {
              "clipId": "chip-1-opacity-231",
              "targets": [
                "chip-1"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 807,
              "durationFrames": 8,
              "easing": "linear"
            },
            {
              "clipId": "chip-2-opacity-232",
              "targets": [
                "chip-2"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 807,
              "durationFrames": 8,
              "easing": "linear"
            },
            {
              "clipId": "chip-3-opacity-233",
              "targets": [
                "chip-3"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 807,
              "durationFrames": 8,
              "easing": "linear"
            },
            {
              "clipId": "chip-4-opacity-234",
              "targets": [
                "chip-4"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 807,
              "durationFrames": 8,
              "easing": "linear"
            },
            {
              "clipId": "chip-5-opacity-235",
              "targets": [
                "chip-5"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 807,
              "durationFrames": 8,
              "easing": "linear"
            },
            {
              "clipId": "chip-6-opacity-236",
              "targets": [
                "chip-6"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 807,
              "durationFrames": 8,
              "easing": "linear"
            },
            {
              "clipId": "chip-7-opacity-237",
              "targets": [
                "chip-7"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 807,
              "durationFrames": 8,
              "easing": "linear"
            },
            {
              "clipId": "chip-8-opacity-238",
              "targets": [
                "chip-8"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 807,
              "durationFrames": 8,
              "easing": "linear"
            },
            {
              "clipId": "chip-9-opacity-239",
              "targets": [
                "chip-9"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 807,
              "durationFrames": 8,
              "easing": "linear"
            },
            {
              "clipId": "chip-10-opacity-240",
              "targets": [
                "chip-10"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 807,
              "durationFrames": 8,
              "easing": "linear"
            },
            {
              "clipId": "chip-11-opacity-241",
              "targets": [
                "chip-11"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 807,
              "durationFrames": 8,
              "easing": "linear"
            },
            {
              "clipId": "big-box-opacity-242",
              "targets": [
                "big-box"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 807,
              "durationFrames": 8,
              "easing": "linear"
            },
            {
              "clipId": "w-vectors-243-translateY-244",
              "targets": [
                "w-vectors-243"
              ],
              "property": "translateY",
              "from": 36.800000000000004,
              "to": 0,
              "startFrame": 816,
              "durationFrames": 10
            },
            {
              "clipId": "w-vectors-243-opacity-245",
              "targets": [
                "w-vectors-243"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 816,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-vectors-246-translateY-247",
              "targets": [
                "w-vectors-246"
              ],
              "property": "translateY",
              "from": 36.800000000000004,
              "to": 0,
              "startFrame": 821,
              "durationFrames": 10
            },
            {
              "clipId": "w-vectors-246-opacity-248",
              "targets": [
                "w-vectors-246"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 821,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-vectors-249-translateY-250",
              "targets": [
                "w-vectors-249"
              ],
              "property": "translateY",
              "from": 36.800000000000004,
              "to": 0,
              "startFrame": 837,
              "durationFrames": 10
            },
            {
              "clipId": "w-vectors-249-opacity-251",
              "targets": [
                "w-vectors-249"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 837,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-vectors-252-translateY-253",
              "targets": [
                "w-vectors-252"
              ],
              "property": "translateY",
              "from": 36.800000000000004,
              "to": 0,
              "startFrame": 843,
              "durationFrames": 10
            },
            {
              "clipId": "w-vectors-252-opacity-254",
              "targets": [
                "w-vectors-252"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 843,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-vectors-255-translateY-256",
              "targets": [
                "w-vectors-255"
              ],
              "property": "translateY",
              "from": 36.800000000000004,
              "to": 0,
              "startFrame": 850,
              "durationFrames": 10
            },
            {
              "clipId": "w-vectors-255-opacity-257",
              "targets": [
                "w-vectors-255"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 850,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-vectors-258-translateY-259",
              "targets": [
                "w-vectors-258"
              ],
              "property": "translateY",
              "from": 36.800000000000004,
              "to": 0,
              "startFrame": 858,
              "durationFrames": 10
            },
            {
              "clipId": "w-vectors-258-opacity-260",
              "targets": [
                "w-vectors-258"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 858,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-vectors-261-translateY-262",
              "targets": [
                "w-vectors-261"
              ],
              "property": "translateY",
              "from": 36.800000000000004,
              "to": 0,
              "startFrame": 862,
              "durationFrames": 10
            },
            {
              "clipId": "w-vectors-261-opacity-263",
              "targets": [
                "w-vectors-261"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 862,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-vectors-264-translateY-265",
              "targets": [
                "w-vectors-264"
              ],
              "property": "translateY",
              "from": 36.800000000000004,
              "to": 0,
              "startFrame": 882,
              "durationFrames": 10
            },
            {
              "clipId": "w-vectors-264-opacity-266",
              "targets": [
                "w-vectors-264"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 882,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-vectors-267-translateY-268",
              "targets": [
                "w-vectors-267"
              ],
              "property": "translateY",
              "from": 36.800000000000004,
              "to": 0,
              "startFrame": 886,
              "durationFrames": 10
            },
            {
              "clipId": "w-vectors-267-opacity-269",
              "targets": [
                "w-vectors-267"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 886,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-vectors-270-translateY-271",
              "targets": [
                "w-vectors-270"
              ],
              "property": "translateY",
              "from": 36.800000000000004,
              "to": 0,
              "startFrame": 892,
              "durationFrames": 10
            },
            {
              "clipId": "w-vectors-270-opacity-272",
              "targets": [
                "w-vectors-270"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 892,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-vectors-273-translateY-274",
              "targets": [
                "w-vectors-273"
              ],
              "property": "translateY",
              "from": 36.800000000000004,
              "to": 0,
              "startFrame": 897,
              "durationFrames": 10
            },
            {
              "clipId": "w-vectors-273-opacity-275",
              "targets": [
                "w-vectors-273"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 897,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-vectors-243-opacity-276",
              "targets": [
                "w-vectors-243"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 917,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-vectors-243-translateY-277",
              "targets": [
                "w-vectors-243"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 917,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-vectors-246-opacity-278",
              "targets": [
                "w-vectors-246"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 917,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-vectors-246-translateY-279",
              "targets": [
                "w-vectors-246"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 917,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-vectors-249-opacity-280",
              "targets": [
                "w-vectors-249"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 917,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-vectors-249-translateY-281",
              "targets": [
                "w-vectors-249"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 917,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-vectors-252-opacity-282",
              "targets": [
                "w-vectors-252"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 917,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-vectors-252-translateY-283",
              "targets": [
                "w-vectors-252"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 917,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-vectors-255-opacity-284",
              "targets": [
                "w-vectors-255"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 917,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-vectors-255-translateY-285",
              "targets": [
                "w-vectors-255"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 917,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-vectors-258-opacity-286",
              "targets": [
                "w-vectors-258"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 917,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-vectors-258-translateY-287",
              "targets": [
                "w-vectors-258"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 917,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-vectors-261-opacity-288",
              "targets": [
                "w-vectors-261"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 917,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-vectors-261-translateY-289",
              "targets": [
                "w-vectors-261"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 917,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-vectors-264-opacity-290",
              "targets": [
                "w-vectors-264"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 917,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-vectors-264-translateY-291",
              "targets": [
                "w-vectors-264"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 917,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-vectors-267-opacity-292",
              "targets": [
                "w-vectors-267"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 917,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-vectors-267-translateY-293",
              "targets": [
                "w-vectors-267"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 917,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-vectors-270-opacity-294",
              "targets": [
                "w-vectors-270"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 917,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-vectors-270-translateY-295",
              "targets": [
                "w-vectors-270"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 917,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-vectors-273-opacity-296",
              "targets": [
                "w-vectors-273"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 917,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-vectors-273-translateY-297",
              "targets": [
                "w-vectors-273"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 917,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-meaning-298-translateY-299",
              "targets": [
                "w-meaning-298"
              ],
              "property": "translateY",
              "from": -46,
              "to": 0,
              "startFrame": 924,
              "durationFrames": 10
            },
            {
              "clipId": "w-meaning-298-opacity-300",
              "targets": [
                "w-meaning-298"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 924,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-meaning-301-translateY-302",
              "targets": [
                "w-meaning-301"
              ],
              "property": "translateY",
              "from": -46,
              "to": 0,
              "startFrame": 930,
              "durationFrames": 10
            },
            {
              "clipId": "w-meaning-301-opacity-303",
              "targets": [
                "w-meaning-301"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 930,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-meaning-304-translateY-305",
              "targets": [
                "w-meaning-304"
              ],
              "property": "translateY",
              "from": -46,
              "to": 0,
              "startFrame": 939,
              "durationFrames": 10
            },
            {
              "clipId": "w-meaning-304-opacity-306",
              "targets": [
                "w-meaning-304"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 939,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-meaning-307-translateY-308",
              "targets": [
                "w-meaning-307"
              ],
              "property": "translateY",
              "from": -46,
              "to": 0,
              "startFrame": 944,
              "durationFrames": 10
            },
            {
              "clipId": "w-meaning-307-opacity-309",
              "targets": [
                "w-meaning-307"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 944,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-meaning-310-translateY-311",
              "targets": [
                "w-meaning-310"
              ],
              "property": "translateY",
              "from": -46,
              "to": 0,
              "startFrame": 975,
              "durationFrames": 10
            },
            {
              "clipId": "w-meaning-310-opacity-312",
              "targets": [
                "w-meaning-310"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 975,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-meaning-313-translateY-314",
              "targets": [
                "w-meaning-313"
              ],
              "property": "translateY",
              "from": -46,
              "to": 0,
              "startFrame": 986,
              "durationFrames": 10
            },
            {
              "clipId": "w-meaning-313-opacity-315",
              "targets": [
                "w-meaning-313"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 986,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-meaning-316-translateY-317",
              "targets": [
                "w-meaning-316"
              ],
              "property": "translateY",
              "from": -46,
              "to": 0,
              "startFrame": 1002,
              "durationFrames": 10
            },
            {
              "clipId": "w-meaning-316-opacity-318",
              "targets": [
                "w-meaning-316"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1002,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-meaning-319-translateY-320",
              "targets": [
                "w-meaning-319"
              ],
              "property": "translateY",
              "from": -46,
              "to": 0,
              "startFrame": 1013,
              "durationFrames": 10
            },
            {
              "clipId": "w-meaning-319-opacity-321",
              "targets": [
                "w-meaning-319"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1013,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-meaning-298-opacity-322",
              "targets": [
                "w-meaning-298"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1032,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-meaning-298-translateY-323",
              "targets": [
                "w-meaning-298"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 1032,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-meaning-301-opacity-324",
              "targets": [
                "w-meaning-301"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1032,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-meaning-301-translateY-325",
              "targets": [
                "w-meaning-301"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 1032,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-meaning-304-opacity-326",
              "targets": [
                "w-meaning-304"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1032,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-meaning-304-translateY-327",
              "targets": [
                "w-meaning-304"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 1032,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-meaning-307-opacity-328",
              "targets": [
                "w-meaning-307"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1032,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-meaning-307-translateY-329",
              "targets": [
                "w-meaning-307"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 1032,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-meaning-310-opacity-330",
              "targets": [
                "w-meaning-310"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1032,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-meaning-310-translateY-331",
              "targets": [
                "w-meaning-310"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 1032,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-meaning-313-opacity-332",
              "targets": [
                "w-meaning-313"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1032,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-meaning-313-translateY-333",
              "targets": [
                "w-meaning-313"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 1032,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-meaning-316-opacity-334",
              "targets": [
                "w-meaning-316"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1032,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-meaning-316-translateY-335",
              "targets": [
                "w-meaning-316"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 1032,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-meaning-319-opacity-336",
              "targets": [
                "w-meaning-319"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1032,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-meaning-319-translateY-337",
              "targets": [
                "w-meaning-319"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 1032,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "card-0-opacity-338",
              "targets": [
                "card-0"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 838,
              "durationFrames": 8
            },
            {
              "clipId": "card-1-opacity-339",
              "targets": [
                "card-1"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 840,
              "durationFrames": 8
            },
            {
              "clipId": "card-2-opacity-340",
              "targets": [
                "card-2"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 842,
              "durationFrames": 8
            },
            {
              "clipId": "card-3-opacity-341",
              "targets": [
                "card-3"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 844,
              "durationFrames": 8
            },
            {
              "clipId": "card-4-opacity-342",
              "targets": [
                "card-4"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 846,
              "durationFrames": 8
            },
            {
              "clipId": "card-5-opacity-343",
              "targets": [
                "card-5"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 848,
              "durationFrames": 8
            },
            {
              "clipId": "card-6-opacity-344",
              "targets": [
                "card-6"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 850,
              "durationFrames": 8
            },
            {
              "clipId": "card-7-opacity-345",
              "targets": [
                "card-7"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 852,
              "durationFrames": 8
            },
            {
              "clipId": "card-8-opacity-346",
              "targets": [
                "card-8"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 854,
              "durationFrames": 8
            },
            {
              "clipId": "card-9-opacity-347",
              "targets": [
                "card-9"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 856,
              "durationFrames": 8
            },
            {
              "clipId": "vec-opacity-348",
              "targets": [
                "vec"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 859,
              "durationFrames": 8
            },
            {
              "clipId": "ax-x-drawOn-349",
              "targets": [
                "ax-x"
              ],
              "property": "drawOn",
              "from": 0,
              "to": 1,
              "startFrame": 881,
              "durationFrames": 18
            },
            {
              "clipId": "ax-y-drawOn-350",
              "targets": [
                "ax-y"
              ],
              "property": "drawOn",
              "from": 0,
              "to": 1,
              "startFrame": 881,
              "durationFrames": 18
            },
            {
              "clipId": "ax-x-l-opacity-351",
              "targets": [
                "ax-x-l"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 893,
              "durationFrames": 8
            },
            {
              "clipId": "ax-y-l-opacity-352",
              "targets": [
                "ax-y-l"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 893,
              "durationFrames": 8
            },
            {
              "clipId": "card-0-translateX-353",
              "targets": [
                "card-0"
              ],
              "property": "translateX",
              "from": 0,
              "to": 65,
              "startFrame": 863,
              "durationFrames": 22,
              "easing": "expoInOut",
              "origin": {
                "x": 110,
                "y": 33
              }
            },
            {
              "clipId": "card-0-translateY-354",
              "targets": [
                "card-0"
              ],
              "property": "translateY",
              "from": 0,
              "to": 112,
              "startFrame": 863,
              "durationFrames": 22,
              "easing": "expoInOut",
              "origin": {
                "x": 110,
                "y": 33
              }
            },
            {
              "clipId": "card-0-scale-355",
              "targets": [
                "card-0"
              ],
              "property": "scale",
              "from": 1,
              "to": 0.22,
              "startFrame": 863,
              "durationFrames": 22,
              "easing": "expoInOut",
              "origin": {
                "x": 110,
                "y": 33
              }
            },
            {
              "clipId": "card-0-opacity-356",
              "targets": [
                "card-0"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 877,
              "durationFrames": 8,
              "easing": "linear"
            },
            {
              "clipId": "pt-0-scale-357",
              "targets": [
                "pt-0"
              ],
              "property": "scale",
              "from": 0,
              "to": 1,
              "startFrame": 879,
              "durationFrames": 8,
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "pt-0-opacity-358",
              "targets": [
                "pt-0"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 879,
              "durationFrames": 4,
              "easing": "linear"
            },
            {
              "clipId": "card-1-translateX-359",
              "targets": [
                "card-1"
              ],
              "property": "translateX",
              "from": 0,
              "to": -138,
              "startFrame": 866,
              "durationFrames": 22,
              "easing": "expoInOut",
              "origin": {
                "x": 110,
                "y": 33
              }
            },
            {
              "clipId": "card-1-translateY-360",
              "targets": [
                "card-1"
              ],
              "property": "translateY",
              "from": 0,
              "to": 169,
              "startFrame": 866,
              "durationFrames": 22,
              "easing": "expoInOut",
              "origin": {
                "x": 110,
                "y": 33
              }
            },
            {
              "clipId": "card-1-scale-361",
              "targets": [
                "card-1"
              ],
              "property": "scale",
              "from": 1,
              "to": 0.22,
              "startFrame": 866,
              "durationFrames": 22,
              "easing": "expoInOut",
              "origin": {
                "x": 110,
                "y": 33
              }
            },
            {
              "clipId": "card-1-opacity-362",
              "targets": [
                "card-1"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 880,
              "durationFrames": 8,
              "easing": "linear"
            },
            {
              "clipId": "pt-1-scale-363",
              "targets": [
                "pt-1"
              ],
              "property": "scale",
              "from": 0,
              "to": 1,
              "startFrame": 882,
              "durationFrames": 8,
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "pt-1-opacity-364",
              "targets": [
                "pt-1"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 882,
              "durationFrames": 4,
              "easing": "linear"
            },
            {
              "clipId": "card-2-translateX-365",
              "targets": [
                "card-2"
              ],
              "property": "translateX",
              "from": 0,
              "to": 30,
              "startFrame": 869,
              "durationFrames": 22,
              "easing": "expoInOut",
              "origin": {
                "x": 110,
                "y": 33
              }
            },
            {
              "clipId": "card-2-translateY-366",
              "targets": [
                "card-2"
              ],
              "property": "translateY",
              "from": 0,
              "to": 89,
              "startFrame": 869,
              "durationFrames": 22,
              "easing": "expoInOut",
              "origin": {
                "x": 110,
                "y": 33
              }
            },
            {
              "clipId": "card-2-scale-367",
              "targets": [
                "card-2"
              ],
              "property": "scale",
              "from": 1,
              "to": 0.22,
              "startFrame": 869,
              "durationFrames": 22,
              "easing": "expoInOut",
              "origin": {
                "x": 110,
                "y": 33
              }
            },
            {
              "clipId": "card-2-opacity-368",
              "targets": [
                "card-2"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 883,
              "durationFrames": 8,
              "easing": "linear"
            },
            {
              "clipId": "pt-2-scale-369",
              "targets": [
                "pt-2"
              ],
              "property": "scale",
              "from": 0,
              "to": 1,
              "startFrame": 885,
              "durationFrames": 8,
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "pt-2-opacity-370",
              "targets": [
                "pt-2"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 885,
              "durationFrames": 4,
              "easing": "linear"
            },
            {
              "clipId": "card-3-translateX-371",
              "targets": [
                "card-3"
              ],
              "property": "translateX",
              "from": 0,
              "to": -100,
              "startFrame": 872,
              "durationFrames": 22,
              "easing": "expoInOut",
              "origin": {
                "x": 110,
                "y": 33
              }
            },
            {
              "clipId": "card-3-translateY-372",
              "targets": [
                "card-3"
              ],
              "property": "translateY",
              "from": 0,
              "to": 19,
              "startFrame": 872,
              "durationFrames": 22,
              "easing": "expoInOut",
              "origin": {
                "x": 110,
                "y": 33
              }
            },
            {
              "clipId": "card-3-scale-373",
              "targets": [
                "card-3"
              ],
              "property": "scale",
              "from": 1,
              "to": 0.22,
              "startFrame": 872,
              "durationFrames": 22,
              "easing": "expoInOut",
              "origin": {
                "x": 110,
                "y": 33
              }
            },
            {
              "clipId": "card-3-opacity-374",
              "targets": [
                "card-3"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 886,
              "durationFrames": 8,
              "easing": "linear"
            },
            {
              "clipId": "pt-3-scale-375",
              "targets": [
                "pt-3"
              ],
              "property": "scale",
              "from": 0,
              "to": 1,
              "startFrame": 888,
              "durationFrames": 8,
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "pt-3-opacity-376",
              "targets": [
                "pt-3"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 888,
              "durationFrames": 4,
              "easing": "linear"
            },
            {
              "clipId": "card-4-translateX-377",
              "targets": [
                "card-4"
              ],
              "property": "translateX",
              "from": 0,
              "to": 410,
              "startFrame": 875,
              "durationFrames": 22,
              "easing": "expoInOut",
              "origin": {
                "x": 110,
                "y": 33
              }
            },
            {
              "clipId": "card-4-translateY-378",
              "targets": [
                "card-4"
              ],
              "property": "translateY",
              "from": 0,
              "to": -149,
              "startFrame": 875,
              "durationFrames": 22,
              "easing": "expoInOut",
              "origin": {
                "x": 110,
                "y": 33
              }
            },
            {
              "clipId": "card-4-scale-379",
              "targets": [
                "card-4"
              ],
              "property": "scale",
              "from": 1,
              "to": 0.22,
              "startFrame": 875,
              "durationFrames": 22,
              "easing": "expoInOut",
              "origin": {
                "x": 110,
                "y": 33
              }
            },
            {
              "clipId": "card-4-opacity-380",
              "targets": [
                "card-4"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 889,
              "durationFrames": 8,
              "easing": "linear"
            },
            {
              "clipId": "pt-4-scale-381",
              "targets": [
                "pt-4"
              ],
              "property": "scale",
              "from": 0,
              "to": 1,
              "startFrame": 891,
              "durationFrames": 8,
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "pt-4-opacity-382",
              "targets": [
                "pt-4"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 891,
              "durationFrames": 4,
              "easing": "linear"
            },
            {
              "clipId": "card-5-translateX-383",
              "targets": [
                "card-5"
              ],
              "property": "translateX",
              "from": 0,
              "to": 212,
              "startFrame": 878,
              "durationFrames": 22,
              "easing": "expoInOut",
              "origin": {
                "x": 110,
                "y": 33
              }
            },
            {
              "clipId": "card-5-translateY-384",
              "targets": [
                "card-5"
              ],
              "property": "translateY",
              "from": 0,
              "to": -91,
              "startFrame": 878,
              "durationFrames": 22,
              "easing": "expoInOut",
              "origin": {
                "x": 110,
                "y": 33
              }
            },
            {
              "clipId": "card-5-scale-385",
              "targets": [
                "card-5"
              ],
              "property": "scale",
              "from": 1,
              "to": 0.22,
              "startFrame": 878,
              "durationFrames": 22,
              "easing": "expoInOut",
              "origin": {
                "x": 110,
                "y": 33
              }
            },
            {
              "clipId": "card-5-opacity-386",
              "targets": [
                "card-5"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 892,
              "durationFrames": 8,
              "easing": "linear"
            },
            {
              "clipId": "pt-5-scale-387",
              "targets": [
                "pt-5"
              ],
              "property": "scale",
              "from": 0,
              "to": 1,
              "startFrame": 894,
              "durationFrames": 8,
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "pt-5-opacity-388",
              "targets": [
                "pt-5"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 894,
              "durationFrames": 4,
              "easing": "linear"
            },
            {
              "clipId": "card-6-translateX-389",
              "targets": [
                "card-6"
              ],
              "property": "translateX",
              "from": 0,
              "to": 372,
              "startFrame": 881,
              "durationFrames": 22,
              "easing": "expoInOut",
              "origin": {
                "x": 110,
                "y": 33
              }
            },
            {
              "clipId": "card-6-translateY-390",
              "targets": [
                "card-6"
              ],
              "property": "translateY",
              "from": 0,
              "to": -185,
              "startFrame": 881,
              "durationFrames": 22,
              "easing": "expoInOut",
              "origin": {
                "x": 110,
                "y": 33
              }
            },
            {
              "clipId": "card-6-scale-391",
              "targets": [
                "card-6"
              ],
              "property": "scale",
              "from": 1,
              "to": 0.22,
              "startFrame": 881,
              "durationFrames": 22,
              "easing": "expoInOut",
              "origin": {
                "x": 110,
                "y": 33
              }
            },
            {
              "clipId": "card-6-opacity-392",
              "targets": [
                "card-6"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 895,
              "durationFrames": 8,
              "easing": "linear"
            },
            {
              "clipId": "pt-6-scale-393",
              "targets": [
                "pt-6"
              ],
              "property": "scale",
              "from": 0,
              "to": 1,
              "startFrame": 897,
              "durationFrames": 8,
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "pt-6-opacity-394",
              "targets": [
                "pt-6"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 897,
              "durationFrames": 4,
              "easing": "linear"
            },
            {
              "clipId": "card-7-translateX-395",
              "targets": [
                "card-7"
              ],
              "property": "translateX",
              "from": 0,
              "to": 32,
              "startFrame": 884,
              "durationFrames": 22,
              "easing": "expoInOut",
              "origin": {
                "x": 110,
                "y": 33
              }
            },
            {
              "clipId": "card-7-translateY-396",
              "targets": [
                "card-7"
              ],
              "property": "translateY",
              "from": 0,
              "to": 95,
              "startFrame": 884,
              "durationFrames": 22,
              "easing": "expoInOut",
              "origin": {
                "x": 110,
                "y": 33
              }
            },
            {
              "clipId": "card-7-scale-397",
              "targets": [
                "card-7"
              ],
              "property": "scale",
              "from": 1,
              "to": 0.22,
              "startFrame": 884,
              "durationFrames": 22,
              "easing": "expoInOut",
              "origin": {
                "x": 110,
                "y": 33
              }
            },
            {
              "clipId": "card-7-opacity-398",
              "targets": [
                "card-7"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 898,
              "durationFrames": 8,
              "easing": "linear"
            },
            {
              "clipId": "pt-7-scale-399",
              "targets": [
                "pt-7"
              ],
              "property": "scale",
              "from": 0,
              "to": 1,
              "startFrame": 900,
              "durationFrames": 8,
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "pt-7-opacity-400",
              "targets": [
                "pt-7"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 900,
              "durationFrames": 4,
              "easing": "linear"
            },
            {
              "clipId": "card-8-translateX-401",
              "targets": [
                "card-8"
              ],
              "property": "translateX",
              "from": 0,
              "to": 342,
              "startFrame": 887,
              "durationFrames": 22,
              "easing": "expoInOut",
              "origin": {
                "x": 110,
                "y": 33
              }
            },
            {
              "clipId": "card-8-translateY-402",
              "targets": [
                "card-8"
              ],
              "property": "translateY",
              "from": 0,
              "to": 41,
              "startFrame": 887,
              "durationFrames": 22,
              "easing": "expoInOut",
              "origin": {
                "x": 110,
                "y": 33
              }
            },
            {
              "clipId": "card-8-scale-403",
              "targets": [
                "card-8"
              ],
              "property": "scale",
              "from": 1,
              "to": 0.22,
              "startFrame": 887,
              "durationFrames": 22,
              "easing": "expoInOut",
              "origin": {
                "x": 110,
                "y": 33
              }
            },
            {
              "clipId": "card-8-opacity-404",
              "targets": [
                "card-8"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 901,
              "durationFrames": 8,
              "easing": "linear"
            },
            {
              "clipId": "pt-8-scale-405",
              "targets": [
                "pt-8"
              ],
              "property": "scale",
              "from": 0,
              "to": 1,
              "startFrame": 903,
              "durationFrames": 8,
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "pt-8-opacity-406",
              "targets": [
                "pt-8"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 903,
              "durationFrames": 4,
              "easing": "linear"
            },
            {
              "clipId": "card-9-translateX-407",
              "targets": [
                "card-9"
              ],
              "property": "translateX",
              "from": 0,
              "to": -14,
              "startFrame": 890,
              "durationFrames": 22,
              "easing": "expoInOut",
              "origin": {
                "x": 110,
                "y": 33
              }
            },
            {
              "clipId": "card-9-translateY-408",
              "targets": [
                "card-9"
              ],
              "property": "translateY",
              "from": 0,
              "to": 49,
              "startFrame": 890,
              "durationFrames": 22,
              "easing": "expoInOut",
              "origin": {
                "x": 110,
                "y": 33
              }
            },
            {
              "clipId": "card-9-scale-409",
              "targets": [
                "card-9"
              ],
              "property": "scale",
              "from": 1,
              "to": 0.22,
              "startFrame": 890,
              "durationFrames": 22,
              "easing": "expoInOut",
              "origin": {
                "x": 110,
                "y": 33
              }
            },
            {
              "clipId": "card-9-opacity-410",
              "targets": [
                "card-9"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 904,
              "durationFrames": 8,
              "easing": "linear"
            },
            {
              "clipId": "pt-9-scale-411",
              "targets": [
                "pt-9"
              ],
              "property": "scale",
              "from": 0,
              "to": 1,
              "startFrame": 906,
              "durationFrames": 8,
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "pt-9-opacity-412",
              "targets": [
                "pt-9"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 906,
              "durationFrames": 4,
              "easing": "linear"
            },
            {
              "clipId": "vec-opacity-413",
              "targets": [
                "vec"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1032,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "hull-0-drawOn-414",
              "targets": [
                "hull-0"
              ],
              "property": "drawOn",
              "from": 0,
              "to": 1,
              "startFrame": 976,
              "durationFrames": 18
            },
            {
              "clipId": "hull-1-drawOn-415",
              "targets": [
                "hull-1"
              ],
              "property": "drawOn",
              "from": 0,
              "to": 1,
              "startFrame": 984,
              "durationFrames": 18
            },
            {
              "clipId": "hull-2-drawOn-416",
              "targets": [
                "hull-2"
              ],
              "property": "drawOn",
              "from": 0,
              "to": 1,
              "startFrame": 992,
              "durationFrames": 18
            },
            {
              "clipId": "hull-l-0-opacity-417",
              "targets": [
                "hull-l-0"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 984,
              "durationFrames": 8
            },
            {
              "clipId": "hull-l-1-opacity-418",
              "targets": [
                "hull-l-1"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 992,
              "durationFrames": 8
            },
            {
              "clipId": "hull-l-2-opacity-419",
              "targets": [
                "hull-l-2"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1000,
              "durationFrames": 8
            },
            {
              "clipId": "w-query-420-translateY-421",
              "targets": [
                "w-query-420"
              ],
              "property": "translateY",
              "from": 36.800000000000004,
              "to": 0,
              "startFrame": 1039,
              "durationFrames": 10
            },
            {
              "clipId": "w-query-420-opacity-422",
              "targets": [
                "w-query-420"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1039,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-query-423-translateY-424",
              "targets": [
                "w-query-423"
              ],
              "property": "translateY",
              "from": 36.800000000000004,
              "to": 0,
              "startFrame": 1044,
              "durationFrames": 10
            },
            {
              "clipId": "w-query-423-opacity-425",
              "targets": [
                "w-query-423"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1044,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-query-426-translateY-427",
              "targets": [
                "w-query-426"
              ],
              "property": "translateY",
              "from": 36.800000000000004,
              "to": 0,
              "startFrame": 1063,
              "durationFrames": 10
            },
            {
              "clipId": "w-query-426-opacity-428",
              "targets": [
                "w-query-426"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1063,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-query-429-translateY-430",
              "targets": [
                "w-query-429"
              ],
              "property": "translateY",
              "from": 36.800000000000004,
              "to": 0,
              "startFrame": 1066,
              "durationFrames": 10
            },
            {
              "clipId": "w-query-429-opacity-431",
              "targets": [
                "w-query-429"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1066,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-query-432-translateY-433",
              "targets": [
                "w-query-432"
              ],
              "property": "translateY",
              "from": 36.800000000000004,
              "to": 0,
              "startFrame": 1075,
              "durationFrames": 10
            },
            {
              "clipId": "w-query-432-opacity-434",
              "targets": [
                "w-query-432"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1075,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-query-435-translateY-436",
              "targets": [
                "w-query-435"
              ],
              "property": "translateY",
              "from": 36.800000000000004,
              "to": 0,
              "startFrame": 1090,
              "durationFrames": 10
            },
            {
              "clipId": "w-query-435-opacity-437",
              "targets": [
                "w-query-435"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1090,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-query-438-translateY-439",
              "targets": [
                "w-query-438"
              ],
              "property": "translateY",
              "from": 36.800000000000004,
              "to": 0,
              "startFrame": 1094,
              "durationFrames": 10
            },
            {
              "clipId": "w-query-438-opacity-440",
              "targets": [
                "w-query-438"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1094,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-query-441-translateY-442",
              "targets": [
                "w-query-441"
              ],
              "property": "translateY",
              "from": 36.800000000000004,
              "to": 0,
              "startFrame": 1099,
              "durationFrames": 10
            },
            {
              "clipId": "w-query-441-opacity-443",
              "targets": [
                "w-query-441"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1099,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-query-420-opacity-444",
              "targets": [
                "w-query-420"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1116,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-query-420-translateY-445",
              "targets": [
                "w-query-420"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 1116,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-query-423-opacity-446",
              "targets": [
                "w-query-423"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1116,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-query-423-translateY-447",
              "targets": [
                "w-query-423"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 1116,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-query-426-opacity-448",
              "targets": [
                "w-query-426"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1116,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-query-426-translateY-449",
              "targets": [
                "w-query-426"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 1116,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-query-429-opacity-450",
              "targets": [
                "w-query-429"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1116,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-query-429-translateY-451",
              "targets": [
                "w-query-429"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 1116,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-query-432-opacity-452",
              "targets": [
                "w-query-432"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1116,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-query-432-translateY-453",
              "targets": [
                "w-query-432"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 1116,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-query-435-opacity-454",
              "targets": [
                "w-query-435"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1116,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-query-435-translateY-455",
              "targets": [
                "w-query-435"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 1116,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-query-438-opacity-456",
              "targets": [
                "w-query-438"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1116,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-query-438-translateY-457",
              "targets": [
                "w-query-438"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 1116,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-query-441-opacity-458",
              "targets": [
                "w-query-441"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1116,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-query-441-translateY-459",
              "targets": [
                "w-query-441"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 1116,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-topk-460-translateY-461",
              "targets": [
                "w-topk-460"
              ],
              "property": "translateY",
              "from": -44,
              "to": 0,
              "startFrame": 1123,
              "durationFrames": 10
            },
            {
              "clipId": "w-topk-460-opacity-462",
              "targets": [
                "w-topk-460"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1123,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-topk-463-translateY-464",
              "targets": [
                "w-topk-463"
              ],
              "property": "translateY",
              "from": -44,
              "to": 0,
              "startFrame": 1130,
              "durationFrames": 10
            },
            {
              "clipId": "w-topk-463-opacity-465",
              "targets": [
                "w-topk-463"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1130,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-topk-466-translateY-467",
              "targets": [
                "w-topk-466"
              ],
              "property": "translateY",
              "from": -44,
              "to": 0,
              "startFrame": 1138,
              "durationFrames": 10
            },
            {
              "clipId": "w-topk-466-opacity-468",
              "targets": [
                "w-topk-466"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1138,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-topk-469-translateY-470",
              "targets": [
                "w-topk-469"
              ],
              "property": "translateY",
              "from": -44,
              "to": 0,
              "startFrame": 1147,
              "durationFrames": 10
            },
            {
              "clipId": "w-topk-469-opacity-471",
              "targets": [
                "w-topk-469"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1147,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-topk-472-translateY-473",
              "targets": [
                "w-topk-472"
              ],
              "property": "translateY",
              "from": -44,
              "to": 0,
              "startFrame": 1164,
              "durationFrames": 10
            },
            {
              "clipId": "w-topk-472-opacity-474",
              "targets": [
                "w-topk-472"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1164,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-topk-475-translateY-476",
              "targets": [
                "w-topk-475"
              ],
              "property": "translateY",
              "from": -44,
              "to": 0,
              "startFrame": 1170,
              "durationFrames": 10
            },
            {
              "clipId": "w-topk-475-opacity-477",
              "targets": [
                "w-topk-475"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1170,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-topk-478-translateY-479",
              "targets": [
                "w-topk-478"
              ],
              "property": "translateY",
              "from": -44,
              "to": 0,
              "startFrame": 1176,
              "durationFrames": 10
            },
            {
              "clipId": "w-topk-478-opacity-480",
              "targets": [
                "w-topk-478"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1176,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-topk-481-translateY-482",
              "targets": [
                "w-topk-481"
              ],
              "property": "translateY",
              "from": -44,
              "to": 0,
              "startFrame": 1182,
              "durationFrames": 10
            },
            {
              "clipId": "w-topk-481-opacity-483",
              "targets": [
                "w-topk-481"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1182,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-topk-484-translateY-485",
              "targets": [
                "w-topk-484"
              ],
              "property": "translateY",
              "from": -44,
              "to": 0,
              "startFrame": 1198,
              "durationFrames": 10
            },
            {
              "clipId": "w-topk-484-opacity-486",
              "targets": [
                "w-topk-484"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1198,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-topk-487-translateY-488",
              "targets": [
                "w-topk-487"
              ],
              "property": "translateY",
              "from": -44,
              "to": 0,
              "startFrame": 1207,
              "durationFrames": 10
            },
            {
              "clipId": "w-topk-487-opacity-489",
              "targets": [
                "w-topk-487"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1207,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-topk-490-translateY-491",
              "targets": [
                "w-topk-490"
              ],
              "property": "translateY",
              "from": -44,
              "to": 0,
              "startFrame": 1213,
              "durationFrames": 10
            },
            {
              "clipId": "w-topk-490-opacity-492",
              "targets": [
                "w-topk-490"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1213,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-topk-460-opacity-493",
              "targets": [
                "w-topk-460"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1229,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-topk-460-translateY-494",
              "targets": [
                "w-topk-460"
              ],
              "property": "translateY",
              "from": 0,
              "to": -15.84,
              "startFrame": 1229,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-topk-463-opacity-495",
              "targets": [
                "w-topk-463"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1229,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-topk-463-translateY-496",
              "targets": [
                "w-topk-463"
              ],
              "property": "translateY",
              "from": 0,
              "to": -15.84,
              "startFrame": 1229,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-topk-466-opacity-497",
              "targets": [
                "w-topk-466"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1229,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-topk-466-translateY-498",
              "targets": [
                "w-topk-466"
              ],
              "property": "translateY",
              "from": 0,
              "to": -15.84,
              "startFrame": 1229,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-topk-469-opacity-499",
              "targets": [
                "w-topk-469"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1229,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-topk-469-translateY-500",
              "targets": [
                "w-topk-469"
              ],
              "property": "translateY",
              "from": 0,
              "to": -15.84,
              "startFrame": 1229,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-topk-472-opacity-501",
              "targets": [
                "w-topk-472"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1229,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-topk-472-translateY-502",
              "targets": [
                "w-topk-472"
              ],
              "property": "translateY",
              "from": 0,
              "to": -15.84,
              "startFrame": 1229,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-topk-475-opacity-503",
              "targets": [
                "w-topk-475"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1229,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-topk-475-translateY-504",
              "targets": [
                "w-topk-475"
              ],
              "property": "translateY",
              "from": 0,
              "to": -15.84,
              "startFrame": 1229,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-topk-478-opacity-505",
              "targets": [
                "w-topk-478"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1229,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-topk-478-translateY-506",
              "targets": [
                "w-topk-478"
              ],
              "property": "translateY",
              "from": 0,
              "to": -15.84,
              "startFrame": 1229,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-topk-481-opacity-507",
              "targets": [
                "w-topk-481"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1229,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-topk-481-translateY-508",
              "targets": [
                "w-topk-481"
              ],
              "property": "translateY",
              "from": 0,
              "to": -15.84,
              "startFrame": 1229,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-topk-484-opacity-509",
              "targets": [
                "w-topk-484"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1229,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-topk-484-translateY-510",
              "targets": [
                "w-topk-484"
              ],
              "property": "translateY",
              "from": 0,
              "to": -15.84,
              "startFrame": 1229,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-topk-487-opacity-511",
              "targets": [
                "w-topk-487"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1229,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-topk-487-translateY-512",
              "targets": [
                "w-topk-487"
              ],
              "property": "translateY",
              "from": 0,
              "to": -15.84,
              "startFrame": 1229,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-topk-490-opacity-513",
              "targets": [
                "w-topk-490"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1229,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-topk-490-translateY-514",
              "targets": [
                "w-topk-490"
              ],
              "property": "translateY",
              "from": 0,
              "to": -15.84,
              "startFrame": 1229,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "pill-opacity-515",
              "targets": [
                "pill"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1063,
              "durationFrames": 8
            },
            {
              "clipId": "pill-translateX-516",
              "targets": [
                "pill"
              ],
              "property": "translateX",
              "from": 0,
              "to": 75,
              "startFrame": 1095,
              "durationFrames": 18,
              "easing": "expoInOut",
              "origin": {
                "x": 220,
                "y": 27
              }
            },
            {
              "clipId": "pill-translateY-517",
              "targets": [
                "pill"
              ],
              "property": "translateY",
              "from": 0,
              "to": 263,
              "startFrame": 1095,
              "durationFrames": 18,
              "easing": "expoInOut",
              "origin": {
                "x": 220,
                "y": 27
              }
            },
            {
              "clipId": "pill-scale-518",
              "targets": [
                "pill"
              ],
              "property": "scale",
              "from": 1,
              "to": 0.06,
              "startFrame": 1095,
              "durationFrames": 18,
              "easing": "expoInOut",
              "origin": {
                "x": 220,
                "y": 27
              }
            },
            {
              "clipId": "pill-opacity-519",
              "targets": [
                "pill"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1107,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "q-dot-scale-520",
              "targets": [
                "q-dot"
              ],
              "property": "scale",
              "from": 0,
              "to": 1,
              "startFrame": 1111,
              "durationFrames": 10,
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "q-dot-opacity-521",
              "targets": [
                "q-dot"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1111,
              "durationFrames": 4,
              "easing": "linear"
            },
            {
              "clipId": "q-label-opacity-522",
              "targets": [
                "q-label"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1117,
              "durationFrames": 8
            },
            {
              "clipId": "q-pulse-opacity-523",
              "targets": [
                "q-pulse"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1113,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "q-pulse-scale-524",
              "targets": [
                "q-pulse"
              ],
              "property": "scale",
              "from": 0,
              "to": 3.4,
              "startFrame": 1113,
              "durationFrames": 22,
              "easing": "expoOut",
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "q-pulse-opacity-525",
              "targets": [
                "q-pulse"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1115,
              "durationFrames": 20,
              "easing": "linear"
            },
            {
              "clipId": "ring-0-drawOn-526",
              "targets": [
                "ring-0"
              ],
              "property": "drawOn",
              "from": 0,
              "to": 1,
              "startFrame": 1131,
              "durationFrames": 18
            },
            {
              "clipId": "ring-1-drawOn-527",
              "targets": [
                "ring-1"
              ],
              "property": "drawOn",
              "from": 0,
              "to": 1,
              "startFrame": 1138,
              "durationFrames": 18
            },
            {
              "clipId": "ring-2-drawOn-528",
              "targets": [
                "ring-2"
              ],
              "property": "drawOn",
              "from": 0,
              "to": 1,
              "startFrame": 1145,
              "durationFrames": 18
            },
            {
              "clipId": "hot-0-scale-529",
              "targets": [
                "hot-0"
              ],
              "property": "scale",
              "from": 0.4,
              "to": 1,
              "startFrame": 1177,
              "durationFrames": 10,
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "hot-1-scale-530",
              "targets": [
                "hot-1"
              ],
              "property": "scale",
              "from": 0.4,
              "to": 1,
              "startFrame": 1180,
              "durationFrames": 10,
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "hot-2-scale-531",
              "targets": [
                "hot-2"
              ],
              "property": "scale",
              "from": 0.4,
              "to": 1,
              "startFrame": 1183,
              "durationFrames": 10,
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "hot-3-scale-532",
              "targets": [
                "hot-3"
              ],
              "property": "scale",
              "from": 0.4,
              "to": 1,
              "startFrame": 1186,
              "durationFrames": 10,
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "hot-0-opacity-533",
              "targets": [
                "hot-0"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1177,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "hot-1-opacity-534",
              "targets": [
                "hot-1"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1180,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "hot-2-opacity-535",
              "targets": [
                "hot-2"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1183,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "hot-3-opacity-536",
              "targets": [
                "hot-3"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1186,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "nn-0-drawOn-537",
              "targets": [
                "nn-0"
              ],
              "property": "drawOn",
              "from": 0,
              "to": 1,
              "startFrame": 1183,
              "durationFrames": 14
            },
            {
              "clipId": "nn-1-drawOn-538",
              "targets": [
                "nn-1"
              ],
              "property": "drawOn",
              "from": 0,
              "to": 1,
              "startFrame": 1186,
              "durationFrames": 14
            },
            {
              "clipId": "nn-2-drawOn-539",
              "targets": [
                "nn-2"
              ],
              "property": "drawOn",
              "from": 0,
              "to": 1,
              "startFrame": 1189,
              "durationFrames": 14
            },
            {
              "clipId": "nn-3-drawOn-540",
              "targets": [
                "nn-3"
              ],
              "property": "drawOn",
              "from": 0,
              "to": 1,
              "startFrame": 1192,
              "durationFrames": 14
            },
            {
              "clipId": "pt-4-opacity-541",
              "targets": [
                "pt-4"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0.22,
              "startFrame": 1177,
              "durationFrames": 14,
              "easing": "linear"
            },
            {
              "clipId": "pt-5-opacity-542",
              "targets": [
                "pt-5"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0.22,
              "startFrame": 1177,
              "durationFrames": 14,
              "easing": "linear"
            },
            {
              "clipId": "pt-6-opacity-543",
              "targets": [
                "pt-6"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0.22,
              "startFrame": 1177,
              "durationFrames": 14,
              "easing": "linear"
            },
            {
              "clipId": "pt-7-opacity-544",
              "targets": [
                "pt-7"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0.22,
              "startFrame": 1177,
              "durationFrames": 14,
              "easing": "linear"
            },
            {
              "clipId": "pt-8-opacity-545",
              "targets": [
                "pt-8"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0.22,
              "startFrame": 1177,
              "durationFrames": 14,
              "easing": "linear"
            },
            {
              "clipId": "pt-9-opacity-546",
              "targets": [
                "pt-9"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0.22,
              "startFrame": 1177,
              "durationFrames": 14,
              "easing": "linear"
            },
            {
              "clipId": "hull-1-opacity-547",
              "targets": [
                "hull-1"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0.22,
              "startFrame": 1177,
              "durationFrames": 14,
              "easing": "linear"
            },
            {
              "clipId": "hull-2-opacity-548",
              "targets": [
                "hull-2"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0.22,
              "startFrame": 1177,
              "durationFrames": 14,
              "easing": "linear"
            },
            {
              "clipId": "hull-l-1-opacity-549",
              "targets": [
                "hull-l-1"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0.22,
              "startFrame": 1177,
              "durationFrames": 14,
              "easing": "linear"
            },
            {
              "clipId": "hull-l-2-opacity-550",
              "targets": [
                "hull-l-2"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0.22,
              "startFrame": 1177,
              "durationFrames": 14,
              "easing": "linear"
            },
            {
              "clipId": "topk-label-opacity-551",
              "targets": [
                "topk-label"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1208,
              "durationFrames": 8
            },
            {
              "clipId": "w-stuff-552-translateY-553",
              "targets": [
                "w-stuff-552"
              ],
              "property": "translateY",
              "from": 36.800000000000004,
              "to": 0,
              "startFrame": 1236,
              "durationFrames": 10
            },
            {
              "clipId": "w-stuff-552-opacity-554",
              "targets": [
                "w-stuff-552"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1236,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-stuff-555-translateY-556",
              "targets": [
                "w-stuff-555"
              ],
              "property": "translateY",
              "from": 36.800000000000004,
              "to": 0,
              "startFrame": 1240,
              "durationFrames": 10
            },
            {
              "clipId": "w-stuff-555-opacity-557",
              "targets": [
                "w-stuff-555"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1240,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-stuff-558-translateY-559",
              "targets": [
                "w-stuff-558"
              ],
              "property": "translateY",
              "from": 36.800000000000004,
              "to": 0,
              "startFrame": 1260,
              "durationFrames": 10
            },
            {
              "clipId": "w-stuff-558-opacity-560",
              "targets": [
                "w-stuff-558"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1260,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-stuff-561-translateY-562",
              "targets": [
                "w-stuff-561"
              ],
              "property": "translateY",
              "from": 36.800000000000004,
              "to": 0,
              "startFrame": 1264,
              "durationFrames": 10
            },
            {
              "clipId": "w-stuff-561-opacity-563",
              "targets": [
                "w-stuff-561"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1264,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-stuff-564-translateY-565",
              "targets": [
                "w-stuff-564"
              ],
              "property": "translateY",
              "from": 36.800000000000004,
              "to": 0,
              "startFrame": 1273,
              "durationFrames": 10
            },
            {
              "clipId": "w-stuff-564-opacity-566",
              "targets": [
                "w-stuff-564"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1273,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-stuff-567-translateY-568",
              "targets": [
                "w-stuff-567"
              ],
              "property": "translateY",
              "from": 36.800000000000004,
              "to": 0,
              "startFrame": 1284,
              "durationFrames": 10
            },
            {
              "clipId": "w-stuff-567-opacity-569",
              "targets": [
                "w-stuff-567"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1284,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-stuff-570-translateY-571",
              "targets": [
                "w-stuff-570"
              ],
              "property": "translateY",
              "from": 36.800000000000004,
              "to": 0,
              "startFrame": 1291,
              "durationFrames": 10
            },
            {
              "clipId": "w-stuff-570-opacity-572",
              "targets": [
                "w-stuff-570"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1291,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-stuff-573-translateY-574",
              "targets": [
                "w-stuff-573"
              ],
              "property": "translateY",
              "from": 36.800000000000004,
              "to": 0,
              "startFrame": 1296,
              "durationFrames": 10
            },
            {
              "clipId": "w-stuff-573-opacity-575",
              "targets": [
                "w-stuff-573"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1296,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-stuff-552-opacity-576",
              "targets": [
                "w-stuff-552"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1315,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-stuff-552-translateY-577",
              "targets": [
                "w-stuff-552"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 1315,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-stuff-555-opacity-578",
              "targets": [
                "w-stuff-555"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1315,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-stuff-555-translateY-579",
              "targets": [
                "w-stuff-555"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 1315,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-stuff-558-opacity-580",
              "targets": [
                "w-stuff-558"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1315,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-stuff-558-translateY-581",
              "targets": [
                "w-stuff-558"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 1315,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-stuff-561-opacity-582",
              "targets": [
                "w-stuff-561"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1315,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-stuff-561-translateY-583",
              "targets": [
                "w-stuff-561"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 1315,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-stuff-564-opacity-584",
              "targets": [
                "w-stuff-564"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1315,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-stuff-564-translateY-585",
              "targets": [
                "w-stuff-564"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 1315,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-stuff-567-opacity-586",
              "targets": [
                "w-stuff-567"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1315,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-stuff-567-translateY-587",
              "targets": [
                "w-stuff-567"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 1315,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-stuff-570-opacity-588",
              "targets": [
                "w-stuff-570"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1315,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-stuff-570-translateY-589",
              "targets": [
                "w-stuff-570"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 1315,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-stuff-573-opacity-590",
              "targets": [
                "w-stuff-573"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1315,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-stuff-573-translateY-591",
              "targets": [
                "w-stuff-573"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 1315,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-receipts-592-translateY-593",
              "targets": [
                "w-receipts-592"
              ],
              "property": "translateY",
              "from": -46,
              "to": 0,
              "startFrame": 1322,
              "durationFrames": 10
            },
            {
              "clipId": "w-receipts-592-opacity-594",
              "targets": [
                "w-receipts-592"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1322,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-receipts-595-translateY-596",
              "targets": [
                "w-receipts-595"
              ],
              "property": "translateY",
              "from": -46,
              "to": 0,
              "startFrame": 1328,
              "durationFrames": 10
            },
            {
              "clipId": "w-receipts-595-opacity-597",
              "targets": [
                "w-receipts-595"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1328,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-receipts-598-translateY-599",
              "targets": [
                "w-receipts-598"
              ],
              "property": "translateY",
              "from": -46,
              "to": 0,
              "startFrame": 1335,
              "durationFrames": 10
            },
            {
              "clipId": "w-receipts-598-opacity-600",
              "targets": [
                "w-receipts-598"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1335,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-receipts-601-translateY-602",
              "targets": [
                "w-receipts-601"
              ],
              "property": "translateY",
              "from": -46,
              "to": 0,
              "startFrame": 1339,
              "durationFrames": 10
            },
            {
              "clipId": "w-receipts-601-opacity-603",
              "targets": [
                "w-receipts-601"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1339,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-receipts-604-translateY-605",
              "targets": [
                "w-receipts-604"
              ],
              "property": "translateY",
              "from": -46,
              "to": 0,
              "startFrame": 1354,
              "durationFrames": 10
            },
            {
              "clipId": "w-receipts-604-opacity-606",
              "targets": [
                "w-receipts-604"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1354,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-receipts-607-translateY-608",
              "targets": [
                "w-receipts-607"
              ],
              "property": "translateY",
              "from": -46,
              "to": 0,
              "startFrame": 1361,
              "durationFrames": 10
            },
            {
              "clipId": "w-receipts-607-opacity-609",
              "targets": [
                "w-receipts-607"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1361,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-receipts-610-translateY-611",
              "targets": [
                "w-receipts-610"
              ],
              "property": "translateY",
              "from": -46,
              "to": 0,
              "startFrame": 1368,
              "durationFrames": 10
            },
            {
              "clipId": "w-receipts-610-opacity-612",
              "targets": [
                "w-receipts-610"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1368,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-receipts-592-opacity-613",
              "targets": [
                "w-receipts-592"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1384,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-receipts-592-translateY-614",
              "targets": [
                "w-receipts-592"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 1384,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-receipts-595-opacity-615",
              "targets": [
                "w-receipts-595"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1384,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-receipts-595-translateY-616",
              "targets": [
                "w-receipts-595"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 1384,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-receipts-598-opacity-617",
              "targets": [
                "w-receipts-598"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1384,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-receipts-598-translateY-618",
              "targets": [
                "w-receipts-598"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 1384,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-receipts-601-opacity-619",
              "targets": [
                "w-receipts-601"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1384,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-receipts-601-translateY-620",
              "targets": [
                "w-receipts-601"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 1384,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-receipts-604-opacity-621",
              "targets": [
                "w-receipts-604"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1384,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-receipts-604-translateY-622",
              "targets": [
                "w-receipts-604"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 1384,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-receipts-607-opacity-623",
              "targets": [
                "w-receipts-607"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1384,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-receipts-607-translateY-624",
              "targets": [
                "w-receipts-607"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 1384,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-receipts-610-opacity-625",
              "targets": [
                "w-receipts-610"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1384,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-receipts-610-translateY-626",
              "targets": [
                "w-receipts-610"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 1384,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "prompt-opacity-627",
              "targets": [
                "prompt"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1257,
              "durationFrames": 10
            },
            {
              "clipId": "plane-opacity-628",
              "targets": [
                "plane"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0.14,
              "startFrame": 1257,
              "durationFrames": 14,
              "easing": "linear"
            },
            {
              "clipId": "rc-0-opacity-629",
              "targets": [
                "rc-0"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1275,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "rc-0-scale-630",
              "targets": [
                "rc-0"
              ],
              "property": "scale",
              "from": 0.12,
              "to": 1,
              "startFrame": 1275,
              "durationFrames": 18,
              "origin": {
                "x": 390,
                "y": 43
              }
            },
            {
              "clipId": "rc-0-translateX-631",
              "targets": [
                "rc-0"
              ],
              "property": "translateX",
              "from": -175,
              "to": 0,
              "startFrame": 1275,
              "durationFrames": 18,
              "origin": {
                "x": 390,
                "y": 43
              }
            },
            {
              "clipId": "rc-0-translateY-632",
              "targets": [
                "rc-0"
              ],
              "property": "translateY",
              "from": 50,
              "to": 0,
              "startFrame": 1275,
              "durationFrames": 18,
              "origin": {
                "x": 390,
                "y": 43
              }
            },
            {
              "clipId": "hot-0-opacity-633",
              "targets": [
                "hot-0"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1275,
              "durationFrames": 8,
              "easing": "linear"
            },
            {
              "clipId": "nn-0-opacity-634",
              "targets": [
                "nn-0"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1275,
              "durationFrames": 8,
              "easing": "linear"
            },
            {
              "clipId": "src-0-opacity-635",
              "targets": [
                "src-0"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1340,
              "durationFrames": 8
            },
            {
              "clipId": "rc-1-opacity-636",
              "targets": [
                "rc-1"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1284,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "rc-1-scale-637",
              "targets": [
                "rc-1"
              ],
              "property": "scale",
              "from": 0.12,
              "to": 1,
              "startFrame": 1284,
              "durationFrames": 18,
              "origin": {
                "x": 390,
                "y": 43
              }
            },
            {
              "clipId": "rc-1-translateX-638",
              "targets": [
                "rc-1"
              ],
              "property": "translateX",
              "from": -128,
              "to": 0,
              "startFrame": 1284,
              "durationFrames": 18,
              "origin": {
                "x": 390,
                "y": 43
              }
            },
            {
              "clipId": "rc-1-translateY-639",
              "targets": [
                "rc-1"
              ],
              "property": "translateY",
              "from": 9,
              "to": 0,
              "startFrame": 1284,
              "durationFrames": 18,
              "origin": {
                "x": 390,
                "y": 43
              }
            },
            {
              "clipId": "hot-1-opacity-640",
              "targets": [
                "hot-1"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1284,
              "durationFrames": 8,
              "easing": "linear"
            },
            {
              "clipId": "nn-1-opacity-641",
              "targets": [
                "nn-1"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1284,
              "durationFrames": 8,
              "easing": "linear"
            },
            {
              "clipId": "src-1-opacity-642",
              "targets": [
                "src-1"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1345,
              "durationFrames": 8
            },
            {
              "clipId": "rc-2-opacity-643",
              "targets": [
                "rc-2"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1293,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "rc-2-scale-644",
              "targets": [
                "rc-2"
              ],
              "property": "scale",
              "from": 0.12,
              "to": 1,
              "startFrame": 1293,
              "durationFrames": 18,
              "origin": {
                "x": 390,
                "y": 43
              }
            },
            {
              "clipId": "rc-2-translateX-645",
              "targets": [
                "rc-2"
              ],
              "property": "translateX",
              "from": -210,
              "to": 0,
              "startFrame": 1293,
              "durationFrames": 18,
              "origin": {
                "x": 390,
                "y": 43
              }
            },
            {
              "clipId": "rc-2-translateY-646",
              "targets": [
                "rc-2"
              ],
              "property": "translateY",
              "from": -71,
              "to": 0,
              "startFrame": 1293,
              "durationFrames": 18,
              "origin": {
                "x": 390,
                "y": 43
              }
            },
            {
              "clipId": "hot-2-opacity-647",
              "targets": [
                "hot-2"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1293,
              "durationFrames": 8,
              "easing": "linear"
            },
            {
              "clipId": "nn-2-opacity-648",
              "targets": [
                "nn-2"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1293,
              "durationFrames": 8,
              "easing": "linear"
            },
            {
              "clipId": "src-2-opacity-649",
              "targets": [
                "src-2"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1350,
              "durationFrames": 8
            },
            {
              "clipId": "rc-3-opacity-650",
              "targets": [
                "rc-3"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1302,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "rc-3-scale-651",
              "targets": [
                "rc-3"
              ],
              "property": "scale",
              "from": 0.12,
              "to": 1,
              "startFrame": 1302,
              "durationFrames": 18,
              "origin": {
                "x": 390,
                "y": 43
              }
            },
            {
              "clipId": "rc-3-translateX-652",
              "targets": [
                "rc-3"
              ],
              "property": "translateX",
              "from": -90,
              "to": 0,
              "startFrame": 1302,
              "durationFrames": 18,
              "origin": {
                "x": 390,
                "y": 43
              }
            },
            {
              "clipId": "rc-3-translateY-653",
              "targets": [
                "rc-3"
              ],
              "property": "translateY",
              "from": -239,
              "to": 0,
              "startFrame": 1302,
              "durationFrames": 18,
              "origin": {
                "x": 390,
                "y": 43
              }
            },
            {
              "clipId": "hot-3-opacity-654",
              "targets": [
                "hot-3"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1302,
              "durationFrames": 8,
              "easing": "linear"
            },
            {
              "clipId": "nn-3-opacity-655",
              "targets": [
                "nn-3"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1302,
              "durationFrames": 8,
              "easing": "linear"
            },
            {
              "clipId": "src-3-opacity-656",
              "targets": [
                "src-3"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1355,
              "durationFrames": 8
            },
            {
              "clipId": "ctx-bar-scaleX-657",
              "targets": [
                "ctx-bar"
              ],
              "property": "scaleX",
              "from": 0,
              "to": 0.147,
              "startFrame": 1275,
              "durationFrames": 45,
              "origin": {
                "x": 550,
                "y": 0
              }
            },
            {
              "clipId": "ck-0-pin-658",
              "targets": [
                "ck-0"
              ],
              "property": "translateY",
              "from": 0,
              "to": 0,
              "startFrame": 0,
              "durationFrames": 1,
              "easing": "linear"
            }
          ]
        }
      },
      {
        "assetId": "ground",
        "svgSource": "videos/rag-explainer/visuals/ground.svg",
        "layer": 8,
        "position": {
          "x": 0,
          "y": 0
        },
        "scale": 1,
        "rotation": 0,
        "opacity": 1,
        "animation": {
          "timelineId": "ground-motion",
          "clips": [
            {
              "clipId": "root-opacity-0",
              "targets": [
                "root"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1392,
              "durationFrames": 4,
              "easing": "linear"
            },
            {
              "clipId": "root-opacity-1",
              "targets": [
                "root"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1547,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-shift-2-translateY-3",
              "targets": [
                "w-shift-2"
              ],
              "property": "translateY",
              "from": 40,
              "to": 0,
              "startFrame": 1391,
              "durationFrames": 10
            },
            {
              "clipId": "w-shift-2-opacity-4",
              "targets": [
                "w-shift-2"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1391,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-shift-5-translateY-6",
              "targets": [
                "w-shift-5"
              ],
              "property": "translateY",
              "from": 40,
              "to": 0,
              "startFrame": 1395,
              "durationFrames": 10
            },
            {
              "clipId": "w-shift-5-opacity-7",
              "targets": [
                "w-shift-5"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1395,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-shift-8-translateY-9",
              "targets": [
                "w-shift-8"
              ],
              "property": "translateY",
              "from": 40,
              "to": 0,
              "startFrame": 1402,
              "durationFrames": 10
            },
            {
              "clipId": "w-shift-8-opacity-10",
              "targets": [
                "w-shift-8"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1402,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-shift-11-translateY-12",
              "targets": [
                "w-shift-11"
              ],
              "property": "translateY",
              "from": 40,
              "to": 0,
              "startFrame": 1408,
              "durationFrames": 10
            },
            {
              "clipId": "w-shift-11-opacity-13",
              "targets": [
                "w-shift-11"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1408,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-shift-14-translateY-15",
              "targets": [
                "w-shift-14"
              ],
              "property": "translateY",
              "from": 40,
              "to": 0,
              "startFrame": 1417,
              "durationFrames": 10
            },
            {
              "clipId": "w-shift-14-opacity-16",
              "targets": [
                "w-shift-14"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1417,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-shift-17-translateY-18",
              "targets": [
                "w-shift-17"
              ],
              "property": "translateY",
              "from": 40,
              "to": 0,
              "startFrame": 1427,
              "durationFrames": 10
            },
            {
              "clipId": "w-shift-17-opacity-19",
              "targets": [
                "w-shift-17"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1427,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-shift-20-translateY-21",
              "targets": [
                "w-shift-20"
              ],
              "property": "translateY",
              "from": 40,
              "to": 0,
              "startFrame": 1432,
              "durationFrames": 10
            },
            {
              "clipId": "w-shift-20-opacity-22",
              "targets": [
                "w-shift-20"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1432,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-shift-23-translateY-24",
              "targets": [
                "w-shift-23"
              ],
              "property": "translateY",
              "from": 40,
              "to": 0,
              "startFrame": 1441,
              "durationFrames": 10
            },
            {
              "clipId": "w-shift-23-opacity-25",
              "targets": [
                "w-shift-23"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1441,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-shift-2-opacity-26",
              "targets": [
                "w-shift-2"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1464,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-shift-2-translateY-27",
              "targets": [
                "w-shift-2"
              ],
              "property": "translateY",
              "from": 0,
              "to": -18,
              "startFrame": 1464,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-shift-5-opacity-28",
              "targets": [
                "w-shift-5"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1464,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-shift-5-translateY-29",
              "targets": [
                "w-shift-5"
              ],
              "property": "translateY",
              "from": 0,
              "to": -18,
              "startFrame": 1464,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-shift-8-opacity-30",
              "targets": [
                "w-shift-8"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1464,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-shift-8-translateY-31",
              "targets": [
                "w-shift-8"
              ],
              "property": "translateY",
              "from": 0,
              "to": -18,
              "startFrame": 1464,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-shift-11-opacity-32",
              "targets": [
                "w-shift-11"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1464,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-shift-11-translateY-33",
              "targets": [
                "w-shift-11"
              ],
              "property": "translateY",
              "from": 0,
              "to": -18,
              "startFrame": 1464,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-shift-14-opacity-34",
              "targets": [
                "w-shift-14"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1464,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-shift-14-translateY-35",
              "targets": [
                "w-shift-14"
              ],
              "property": "translateY",
              "from": 0,
              "to": -18,
              "startFrame": 1464,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-shift-17-opacity-36",
              "targets": [
                "w-shift-17"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1464,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-shift-17-translateY-37",
              "targets": [
                "w-shift-17"
              ],
              "property": "translateY",
              "from": 0,
              "to": -18,
              "startFrame": 1464,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-shift-20-opacity-38",
              "targets": [
                "w-shift-20"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1464,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-shift-20-translateY-39",
              "targets": [
                "w-shift-20"
              ],
              "property": "translateY",
              "from": 0,
              "to": -18,
              "startFrame": 1464,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-shift-23-opacity-40",
              "targets": [
                "w-shift-23"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1464,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-shift-23-translateY-41",
              "targets": [
                "w-shift-23"
              ],
              "property": "translateY",
              "from": 0,
              "to": -18,
              "startFrame": 1464,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-grounded-42-translateY-43",
              "targets": [
                "w-grounded-42"
              ],
              "property": "translateY",
              "from": -46,
              "to": 0,
              "startFrame": 1471,
              "durationFrames": 10
            },
            {
              "clipId": "w-grounded-42-opacity-44",
              "targets": [
                "w-grounded-42"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1471,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-grounded-45-translateY-46",
              "targets": [
                "w-grounded-45"
              ],
              "property": "translateY",
              "from": -46,
              "to": 0,
              "startFrame": 1473,
              "durationFrames": 10
            },
            {
              "clipId": "w-grounded-45-opacity-47",
              "targets": [
                "w-grounded-45"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1473,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-grounded-48-translateY-49",
              "targets": [
                "w-grounded-48"
              ],
              "property": "translateY",
              "from": -46,
              "to": 0,
              "startFrame": 1480,
              "durationFrames": 10
            },
            {
              "clipId": "w-grounded-48-opacity-50",
              "targets": [
                "w-grounded-48"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1480,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-grounded-51-translateY-52",
              "targets": [
                "w-grounded-51"
              ],
              "property": "translateY",
              "from": -46,
              "to": 0,
              "startFrame": 1489,
              "durationFrames": 10
            },
            {
              "clipId": "w-grounded-51-opacity-53",
              "targets": [
                "w-grounded-51"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1489,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-grounded-54-translateY-55",
              "targets": [
                "w-grounded-54"
              ],
              "property": "translateY",
              "from": -46,
              "to": 0,
              "startFrame": 1510,
              "durationFrames": 10
            },
            {
              "clipId": "w-grounded-54-opacity-56",
              "targets": [
                "w-grounded-54"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1510,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-grounded-57-translateY-58",
              "targets": [
                "w-grounded-57"
              ],
              "property": "translateY",
              "from": -46,
              "to": 0,
              "startFrame": 1512,
              "durationFrames": 10
            },
            {
              "clipId": "w-grounded-57-opacity-59",
              "targets": [
                "w-grounded-57"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1512,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-grounded-60-translateY-61",
              "targets": [
                "w-grounded-60"
              ],
              "property": "translateY",
              "from": -46,
              "to": 0,
              "startFrame": 1521,
              "durationFrames": 10
            },
            {
              "clipId": "w-grounded-60-opacity-62",
              "targets": [
                "w-grounded-60"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1521,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-grounded-63-translateY-64",
              "targets": [
                "w-grounded-63"
              ],
              "property": "translateY",
              "from": -46,
              "to": 0,
              "startFrame": 1528,
              "durationFrames": 10
            },
            {
              "clipId": "w-grounded-63-opacity-65",
              "targets": [
                "w-grounded-63"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1528,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-grounded-66-translateY-67",
              "targets": [
                "w-grounded-66"
              ],
              "property": "translateY",
              "from": -46,
              "to": 0,
              "startFrame": 1531,
              "durationFrames": 10
            },
            {
              "clipId": "w-grounded-66-opacity-68",
              "targets": [
                "w-grounded-66"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1531,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-grounded-42-opacity-69",
              "targets": [
                "w-grounded-42"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1549,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-grounded-42-translateY-70",
              "targets": [
                "w-grounded-42"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 1549,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-grounded-45-opacity-71",
              "targets": [
                "w-grounded-45"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1549,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-grounded-45-translateY-72",
              "targets": [
                "w-grounded-45"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 1549,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-grounded-48-opacity-73",
              "targets": [
                "w-grounded-48"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1549,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-grounded-48-translateY-74",
              "targets": [
                "w-grounded-48"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 1549,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-grounded-51-opacity-75",
              "targets": [
                "w-grounded-51"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1549,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-grounded-51-translateY-76",
              "targets": [
                "w-grounded-51"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 1549,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-grounded-54-opacity-77",
              "targets": [
                "w-grounded-54"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1549,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-grounded-54-translateY-78",
              "targets": [
                "w-grounded-54"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 1549,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-grounded-57-opacity-79",
              "targets": [
                "w-grounded-57"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1549,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-grounded-57-translateY-80",
              "targets": [
                "w-grounded-57"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 1549,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-grounded-60-opacity-81",
              "targets": [
                "w-grounded-60"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1549,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-grounded-60-translateY-82",
              "targets": [
                "w-grounded-60"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 1549,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-grounded-63-opacity-83",
              "targets": [
                "w-grounded-63"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1549,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-grounded-63-translateY-84",
              "targets": [
                "w-grounded-63"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 1549,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-grounded-66-opacity-85",
              "targets": [
                "w-grounded-66"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1549,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-grounded-66-translateY-86",
              "targets": [
                "w-grounded-66"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 1549,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "tp-87-translateY-110",
              "targets": [
                "tp-87"
              ],
              "property": "translateY",
              "from": 30,
              "to": 0,
              "startFrame": 1393,
              "durationFrames": 14
            },
            {
              "clipId": "tp-87-opacity-111",
              "targets": [
                "tp-87"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1393,
              "durationFrames": 10,
              "easing": "linear"
            },
            {
              "clipId": "tp-cover-88-scaleX-112",
              "targets": [
                "tp-cover-88"
              ],
              "property": "scaleX",
              "from": 1,
              "to": 0.9310344827586207,
              "startFrame": 1396,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 548,
                "y": 0
              }
            },
            {
              "clipId": "tp-cover-88-scaleX-113",
              "targets": [
                "tp-cover-88"
              ],
              "property": "scaleX",
              "from": 0.9310344827586207,
              "to": 0.896551724137931,
              "startFrame": 1397,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 548,
                "y": 0
              }
            },
            {
              "clipId": "tp-cover-88-scaleX-114",
              "targets": [
                "tp-cover-88"
              ],
              "property": "scaleX",
              "from": 0.896551724137931,
              "to": 0.8275862068965517,
              "startFrame": 1398,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 548,
                "y": 0
              }
            },
            {
              "clipId": "tp-cover-88-scaleX-115",
              "targets": [
                "tp-cover-88"
              ],
              "property": "scaleX",
              "from": 0.8275862068965517,
              "to": 0.7931034482758621,
              "startFrame": 1399,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 548,
                "y": 0
              }
            },
            {
              "clipId": "tp-cover-88-scaleX-116",
              "targets": [
                "tp-cover-88"
              ],
              "property": "scaleX",
              "from": 0.7931034482758621,
              "to": 0.7241379310344828,
              "startFrame": 1400,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 548,
                "y": 0
              }
            },
            {
              "clipId": "tp-cover-88-scaleX-117",
              "targets": [
                "tp-cover-88"
              ],
              "property": "scaleX",
              "from": 0.7241379310344828,
              "to": 0.6551724137931034,
              "startFrame": 1401,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 548,
                "y": 0
              }
            },
            {
              "clipId": "tp-cover-88-scaleX-118",
              "targets": [
                "tp-cover-88"
              ],
              "property": "scaleX",
              "from": 0.6551724137931034,
              "to": 0.6206896551724138,
              "startFrame": 1402,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 548,
                "y": 0
              }
            },
            {
              "clipId": "tp-cover-88-scaleX-119",
              "targets": [
                "tp-cover-88"
              ],
              "property": "scaleX",
              "from": 0.6206896551724138,
              "to": 0.5517241379310345,
              "startFrame": 1403,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 548,
                "y": 0
              }
            },
            {
              "clipId": "tp-cover-88-scaleX-120",
              "targets": [
                "tp-cover-88"
              ],
              "property": "scaleX",
              "from": 0.5517241379310345,
              "to": 0.48275862068965514,
              "startFrame": 1404,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 548,
                "y": 0
              }
            },
            {
              "clipId": "tp-cover-88-scaleX-121",
              "targets": [
                "tp-cover-88"
              ],
              "property": "scaleX",
              "from": 0.48275862068965514,
              "to": 0.4482758620689655,
              "startFrame": 1405,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 548,
                "y": 0
              }
            },
            {
              "clipId": "tp-cover-88-scaleX-122",
              "targets": [
                "tp-cover-88"
              ],
              "property": "scaleX",
              "from": 0.4482758620689655,
              "to": 0.3793103448275862,
              "startFrame": 1406,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 548,
                "y": 0
              }
            },
            {
              "clipId": "tp-cover-88-scaleX-123",
              "targets": [
                "tp-cover-88"
              ],
              "property": "scaleX",
              "from": 0.3793103448275862,
              "to": 0.3448275862068966,
              "startFrame": 1407,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 548,
                "y": 0
              }
            },
            {
              "clipId": "tp-cover-88-scaleX-124",
              "targets": [
                "tp-cover-88"
              ],
              "property": "scaleX",
              "from": 0.3448275862068966,
              "to": 0.27586206896551724,
              "startFrame": 1408,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 548,
                "y": 0
              }
            },
            {
              "clipId": "tp-cover-88-scaleX-125",
              "targets": [
                "tp-cover-88"
              ],
              "property": "scaleX",
              "from": 0.27586206896551724,
              "to": 0.2068965517241379,
              "startFrame": 1409,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 548,
                "y": 0
              }
            },
            {
              "clipId": "tp-cover-88-scaleX-126",
              "targets": [
                "tp-cover-88"
              ],
              "property": "scaleX",
              "from": 0.2068965517241379,
              "to": 0.1724137931034483,
              "startFrame": 1410,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 548,
                "y": 0
              }
            },
            {
              "clipId": "tp-cover-88-scaleX-127",
              "targets": [
                "tp-cover-88"
              ],
              "property": "scaleX",
              "from": 0.1724137931034483,
              "to": 0.10344827586206895,
              "startFrame": 1411,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 548,
                "y": 0
              }
            },
            {
              "clipId": "tp-cover-88-scaleX-128",
              "targets": [
                "tp-cover-88"
              ],
              "property": "scaleX",
              "from": 0.10344827586206895,
              "to": 0.06896551724137934,
              "startFrame": 1412,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 548,
                "y": 0
              }
            },
            {
              "clipId": "tp-cover-88-scaleX-129",
              "targets": [
                "tp-cover-88"
              ],
              "property": "scaleX",
              "from": 0.06896551724137934,
              "to": 0,
              "startFrame": 1413,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 548,
                "y": 0
              }
            },
            {
              "clipId": "tp-caret-89-translateX-130",
              "targets": [
                "tp-caret-89"
              ],
              "property": "translateX",
              "from": 0,
              "to": 36,
              "startFrame": 1396,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "tp-caret-89-translateX-131",
              "targets": [
                "tp-caret-89"
              ],
              "property": "translateX",
              "from": 36,
              "to": 54,
              "startFrame": 1397,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "tp-caret-89-translateX-132",
              "targets": [
                "tp-caret-89"
              ],
              "property": "translateX",
              "from": 54,
              "to": 90,
              "startFrame": 1398,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "tp-caret-89-translateX-133",
              "targets": [
                "tp-caret-89"
              ],
              "property": "translateX",
              "from": 90,
              "to": 108,
              "startFrame": 1399,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "tp-caret-89-translateX-134",
              "targets": [
                "tp-caret-89"
              ],
              "property": "translateX",
              "from": 108,
              "to": 144,
              "startFrame": 1400,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "tp-caret-89-translateX-135",
              "targets": [
                "tp-caret-89"
              ],
              "property": "translateX",
              "from": 144,
              "to": 180,
              "startFrame": 1401,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "tp-caret-89-translateX-136",
              "targets": [
                "tp-caret-89"
              ],
              "property": "translateX",
              "from": 180,
              "to": 198,
              "startFrame": 1402,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "tp-caret-89-translateX-137",
              "targets": [
                "tp-caret-89"
              ],
              "property": "translateX",
              "from": 198,
              "to": 234,
              "startFrame": 1403,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "tp-caret-89-translateX-138",
              "targets": [
                "tp-caret-89"
              ],
              "property": "translateX",
              "from": 234,
              "to": 270,
              "startFrame": 1404,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "tp-caret-89-translateX-139",
              "targets": [
                "tp-caret-89"
              ],
              "property": "translateX",
              "from": 270,
              "to": 288,
              "startFrame": 1405,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "tp-caret-89-translateX-140",
              "targets": [
                "tp-caret-89"
              ],
              "property": "translateX",
              "from": 288,
              "to": 324,
              "startFrame": 1406,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "tp-caret-89-translateX-141",
              "targets": [
                "tp-caret-89"
              ],
              "property": "translateX",
              "from": 324,
              "to": 342,
              "startFrame": 1407,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "tp-caret-89-translateX-142",
              "targets": [
                "tp-caret-89"
              ],
              "property": "translateX",
              "from": 342,
              "to": 378,
              "startFrame": 1408,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "tp-caret-89-translateX-143",
              "targets": [
                "tp-caret-89"
              ],
              "property": "translateX",
              "from": 378,
              "to": 414,
              "startFrame": 1409,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "tp-caret-89-translateX-144",
              "targets": [
                "tp-caret-89"
              ],
              "property": "translateX",
              "from": 414,
              "to": 432,
              "startFrame": 1410,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "tp-caret-89-translateX-145",
              "targets": [
                "tp-caret-89"
              ],
              "property": "translateX",
              "from": 432,
              "to": 468,
              "startFrame": 1411,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "tp-caret-89-translateX-146",
              "targets": [
                "tp-caret-89"
              ],
              "property": "translateX",
              "from": 468,
              "to": 486,
              "startFrame": 1412,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "tp-caret-89-translateX-147",
              "targets": [
                "tp-caret-89"
              ],
              "property": "translateX",
              "from": 486,
              "to": 522,
              "startFrame": 1413,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "tp-bar-91-scaleX-148",
              "targets": [
                "tp-bar-91"
              ],
              "property": "scaleX",
              "from": 0,
              "to": 0.34,
              "startFrame": 1418,
              "durationFrames": 14,
              "origin": {
                "x": 250,
                "y": 0
              }
            },
            {
              "clipId": "tp-barhot-92-scaleX-149",
              "targets": [
                "tp-barhot-92"
              ],
              "property": "scaleX",
              "from": 0,
              "to": 0.34,
              "startFrame": 1418,
              "durationFrames": 14,
              "origin": {
                "x": 250,
                "y": 0
              }
            },
            {
              "clipId": "tp-v0-93-opacity-150",
              "targets": [
                "tp-v0-93"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1418,
              "durationFrames": 6
            },
            {
              "clipId": "tp-hot-90-opacity-151",
              "targets": [
                "tp-hot-90"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1418,
              "durationFrames": 6
            },
            {
              "clipId": "tp-bar-96-scaleX-152",
              "targets": [
                "tp-bar-96"
              ],
              "property": "scaleX",
              "from": 0,
              "to": 0.27,
              "startFrame": 1421,
              "durationFrames": 14,
              "origin": {
                "x": 250,
                "y": 0
              }
            },
            {
              "clipId": "tp-barhot-97-scaleX-153",
              "targets": [
                "tp-barhot-97"
              ],
              "property": "scaleX",
              "from": 0,
              "to": 0.27,
              "startFrame": 1421,
              "durationFrames": 14,
              "origin": {
                "x": 250,
                "y": 0
              }
            },
            {
              "clipId": "tp-v0-98-opacity-154",
              "targets": [
                "tp-v0-98"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1421,
              "durationFrames": 6
            },
            {
              "clipId": "tp-bar-101-scaleX-155",
              "targets": [
                "tp-bar-101"
              ],
              "property": "scaleX",
              "from": 0,
              "to": 0.22,
              "startFrame": 1424,
              "durationFrames": 14,
              "origin": {
                "x": 250,
                "y": 0
              }
            },
            {
              "clipId": "tp-barhot-102-scaleX-156",
              "targets": [
                "tp-barhot-102"
              ],
              "property": "scaleX",
              "from": 0,
              "to": 0.22,
              "startFrame": 1424,
              "durationFrames": 14,
              "origin": {
                "x": 250,
                "y": 0
              }
            },
            {
              "clipId": "tp-v0-103-opacity-157",
              "targets": [
                "tp-v0-103"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1424,
              "durationFrames": 6
            },
            {
              "clipId": "tp-bar-106-scaleX-158",
              "targets": [
                "tp-bar-106"
              ],
              "property": "scaleX",
              "from": 0,
              "to": 0.17,
              "startFrame": 1427,
              "durationFrames": 14,
              "origin": {
                "x": 250,
                "y": 0
              }
            },
            {
              "clipId": "tp-barhot-107-scaleX-159",
              "targets": [
                "tp-barhot-107"
              ],
              "property": "scaleX",
              "from": 0,
              "to": 0.17,
              "startFrame": 1427,
              "durationFrames": 14,
              "origin": {
                "x": 250,
                "y": 0
              }
            },
            {
              "clipId": "tp-v0-108-opacity-160",
              "targets": [
                "tp-v0-108"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1427,
              "durationFrames": 6
            },
            {
              "clipId": "tp-bar-91-scaleX-161",
              "targets": [
                "tp-bar-91"
              ],
              "property": "scaleX",
              "from": 0.34,
              "to": 0.04,
              "startFrame": 1442,
              "durationFrames": 20,
              "origin": {
                "x": 250,
                "y": 0
              }
            },
            {
              "clipId": "tp-barhot-92-scaleX-162",
              "targets": [
                "tp-barhot-92"
              ],
              "property": "scaleX",
              "from": 0.34,
              "to": 0.04,
              "startFrame": 1442,
              "durationFrames": 20,
              "origin": {
                "x": 250,
                "y": 0
              }
            },
            {
              "clipId": "tp-v0-93-opacity-163",
              "targets": [
                "tp-v0-93"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1452,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "tp-v1-94-opacity-164",
              "targets": [
                "tp-v1-94"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1452,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "tp-hot-90-opacity-165",
              "targets": [
                "tp-hot-90"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1442,
              "durationFrames": 8
            },
            {
              "clipId": "tp-barhot-92-opacity-166",
              "targets": [
                "tp-barhot-92"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1442,
              "durationFrames": 8
            },
            {
              "clipId": "tp-bar-96-scaleX-167",
              "targets": [
                "tp-bar-96"
              ],
              "property": "scaleX",
              "from": 0.27,
              "to": 0.93,
              "startFrame": 1442,
              "durationFrames": 20,
              "origin": {
                "x": 250,
                "y": 0
              }
            },
            {
              "clipId": "tp-barhot-97-scaleX-168",
              "targets": [
                "tp-barhot-97"
              ],
              "property": "scaleX",
              "from": 0.27,
              "to": 0.93,
              "startFrame": 1442,
              "durationFrames": 20,
              "origin": {
                "x": 250,
                "y": 0
              }
            },
            {
              "clipId": "tp-v0-98-opacity-169",
              "targets": [
                "tp-v0-98"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1452,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "tp-v1-99-opacity-170",
              "targets": [
                "tp-v1-99"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1452,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "tp-hot-95-opacity-171",
              "targets": [
                "tp-hot-95"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1446,
              "durationFrames": 8
            },
            {
              "clipId": "tp-barhot-97-opacity-172",
              "targets": [
                "tp-barhot-97"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1446,
              "durationFrames": 8
            },
            {
              "clipId": "tp-bar-101-scaleX-173",
              "targets": [
                "tp-bar-101"
              ],
              "property": "scaleX",
              "from": 0.22,
              "to": 0.02,
              "startFrame": 1442,
              "durationFrames": 20,
              "origin": {
                "x": 250,
                "y": 0
              }
            },
            {
              "clipId": "tp-barhot-102-scaleX-174",
              "targets": [
                "tp-barhot-102"
              ],
              "property": "scaleX",
              "from": 0.22,
              "to": 0.02,
              "startFrame": 1442,
              "durationFrames": 20,
              "origin": {
                "x": 250,
                "y": 0
              }
            },
            {
              "clipId": "tp-v0-103-opacity-175",
              "targets": [
                "tp-v0-103"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1452,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "tp-v1-104-opacity-176",
              "targets": [
                "tp-v1-104"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1452,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "tp-bar-106-scaleX-177",
              "targets": [
                "tp-bar-106"
              ],
              "property": "scaleX",
              "from": 0.17,
              "to": 0.01,
              "startFrame": 1442,
              "durationFrames": 20,
              "origin": {
                "x": 250,
                "y": 0
              }
            },
            {
              "clipId": "tp-barhot-107-scaleX-178",
              "targets": [
                "tp-barhot-107"
              ],
              "property": "scaleX",
              "from": 0.17,
              "to": 0.01,
              "startFrame": 1442,
              "durationFrames": 20,
              "origin": {
                "x": 250,
                "y": 0
              }
            },
            {
              "clipId": "tp-v0-108-opacity-179",
              "targets": [
                "tp-v0-108"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1452,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "tp-v1-109-opacity-180",
              "targets": [
                "tp-v1-109"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1452,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "hc-label-opacity-181",
              "targets": [
                "hc-label"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1448,
              "durationFrames": 8
            },
            {
              "clipId": "hc-track-opacity-182",
              "targets": [
                "hc-track"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1448,
              "durationFrames": 8
            },
            {
              "clipId": "hc-bar-scaleX-183",
              "targets": [
                "hc-bar"
              ],
              "property": "scaleX",
              "from": 0,
              "to": 0.83,
              "startFrame": 1448,
              "durationFrames": 14,
              "origin": {
                "x": 1000,
                "y": 0
              }
            },
            {
              "clipId": "hc-0-opacity-184",
              "targets": [
                "hc-0"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1448,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "hc-0-opacity-185",
              "targets": [
                "hc-0"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1483,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "hc-1-opacity-186",
              "targets": [
                "hc-1"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1483,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "hc-1-opacity-187",
              "targets": [
                "hc-1"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1493,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "hc-2-opacity-188",
              "targets": [
                "hc-2"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1493,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "hc-2-opacity-189",
              "targets": [
                "hc-2"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1502,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "hc-3-opacity-190",
              "targets": [
                "hc-3"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1502,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "hc-3-opacity-191",
              "targets": [
                "hc-3"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1512,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "hc-4-opacity-192",
              "targets": [
                "hc-4"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1512,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "hc-4-opacity-193",
              "targets": [
                "hc-4"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1521,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "hc-5-opacity-194",
              "targets": [
                "hc-5"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1521,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "hc-5-opacity-195",
              "targets": [
                "hc-5"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1531,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "hc-6-opacity-196",
              "targets": [
                "hc-6"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1531,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "hc-6-opacity-197",
              "targets": [
                "hc-6"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1540,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "hc-7-opacity-198",
              "targets": [
                "hc-7"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1540,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "hc-bar-scaleX-199",
              "targets": [
                "hc-bar"
              ],
              "property": "scaleX",
              "from": 0.83,
              "to": 0.71,
              "startFrame": 1483,
              "durationFrames": 10,
              "origin": {
                "x": 1000,
                "y": 0
              }
            },
            {
              "clipId": "hc-bar-scaleX-200",
              "targets": [
                "hc-bar"
              ],
              "property": "scaleX",
              "from": 0.71,
              "to": 0.56,
              "startFrame": 1493,
              "durationFrames": 9,
              "origin": {
                "x": 1000,
                "y": 0
              }
            },
            {
              "clipId": "hc-bar-scaleX-201",
              "targets": [
                "hc-bar"
              ],
              "property": "scaleX",
              "from": 0.56,
              "to": 0.41,
              "startFrame": 1502,
              "durationFrames": 10,
              "origin": {
                "x": 1000,
                "y": 0
              }
            },
            {
              "clipId": "hc-bar-scaleX-202",
              "targets": [
                "hc-bar"
              ],
              "property": "scaleX",
              "from": 0.41,
              "to": 0.27,
              "startFrame": 1512,
              "durationFrames": 9,
              "origin": {
                "x": 1000,
                "y": 0
              }
            },
            {
              "clipId": "hc-bar-scaleX-203",
              "targets": [
                "hc-bar"
              ],
              "property": "scaleX",
              "from": 0.27,
              "to": 0.16,
              "startFrame": 1521,
              "durationFrames": 10,
              "origin": {
                "x": 1000,
                "y": 0
              }
            },
            {
              "clipId": "hc-bar-scaleX-204",
              "targets": [
                "hc-bar"
              ],
              "property": "scaleX",
              "from": 0.16,
              "to": 0.09,
              "startFrame": 1531,
              "durationFrames": 9,
              "origin": {
                "x": 1000,
                "y": 0
              }
            },
            {
              "clipId": "hc-bar-scaleX-205",
              "targets": [
                "hc-bar"
              ],
              "property": "scaleX",
              "from": 0.09,
              "to": 0.04,
              "startFrame": 1540,
              "durationFrames": 10,
              "origin": {
                "x": 1000,
                "y": 0
              }
            },
            {
              "clipId": "answer-opacity-206",
              "targets": [
                "answer"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1507,
              "durationFrames": 8
            },
            {
              "clipId": "an-cover-scaleX-207",
              "targets": [
                "an-cover"
              ],
              "property": "scaleX",
              "from": 1,
              "to": 0.9411764705882353,
              "startFrame": 1513,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 395.2,
                "y": 0
              }
            },
            {
              "clipId": "an-cover-scaleX-208",
              "targets": [
                "an-cover"
              ],
              "property": "scaleX",
              "from": 0.9411764705882353,
              "to": 0.8235294117647058,
              "startFrame": 1514,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 395.2,
                "y": 0
              }
            },
            {
              "clipId": "an-cover-scaleX-209",
              "targets": [
                "an-cover"
              ],
              "property": "scaleX",
              "from": 0.8235294117647058,
              "to": 0.7647058823529411,
              "startFrame": 1515,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 395.2,
                "y": 0
              }
            },
            {
              "clipId": "an-cover-scaleX-210",
              "targets": [
                "an-cover"
              ],
              "property": "scaleX",
              "from": 0.7647058823529411,
              "to": 0.7058823529411764,
              "startFrame": 1516,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 395.2,
                "y": 0
              }
            },
            {
              "clipId": "an-cover-scaleX-211",
              "targets": [
                "an-cover"
              ],
              "property": "scaleX",
              "from": 0.7058823529411764,
              "to": 0.5882352941176471,
              "startFrame": 1517,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 395.2,
                "y": 0
              }
            },
            {
              "clipId": "an-cover-scaleX-212",
              "targets": [
                "an-cover"
              ],
              "property": "scaleX",
              "from": 0.5882352941176471,
              "to": 0.5294117647058824,
              "startFrame": 1518,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 395.2,
                "y": 0
              }
            },
            {
              "clipId": "an-cover-scaleX-213",
              "targets": [
                "an-cover"
              ],
              "property": "scaleX",
              "from": 0.5294117647058824,
              "to": 0.47058823529411764,
              "startFrame": 1519,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 395.2,
                "y": 0
              }
            },
            {
              "clipId": "an-cover-scaleX-214",
              "targets": [
                "an-cover"
              ],
              "property": "scaleX",
              "from": 0.47058823529411764,
              "to": 0.4117647058823529,
              "startFrame": 1520,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 395.2,
                "y": 0
              }
            },
            {
              "clipId": "an-cover-scaleX-215",
              "targets": [
                "an-cover"
              ],
              "property": "scaleX",
              "from": 0.4117647058823529,
              "to": 0.2941176470588235,
              "startFrame": 1521,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 395.2,
                "y": 0
              }
            },
            {
              "clipId": "an-cover-scaleX-216",
              "targets": [
                "an-cover"
              ],
              "property": "scaleX",
              "from": 0.2941176470588235,
              "to": 0.23529411764705888,
              "startFrame": 1522,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 395.2,
                "y": 0
              }
            },
            {
              "clipId": "an-cover-scaleX-217",
              "targets": [
                "an-cover"
              ],
              "property": "scaleX",
              "from": 0.23529411764705888,
              "to": 0.17647058823529416,
              "startFrame": 1523,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 395.2,
                "y": 0
              }
            },
            {
              "clipId": "an-cover-scaleX-218",
              "targets": [
                "an-cover"
              ],
              "property": "scaleX",
              "from": 0.17647058823529416,
              "to": 0.05882352941176472,
              "startFrame": 1524,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 395.2,
                "y": 0
              }
            },
            {
              "clipId": "an-cover-scaleX-219",
              "targets": [
                "an-cover"
              ],
              "property": "scaleX",
              "from": 0.05882352941176472,
              "to": 0,
              "startFrame": 1525,
              "durationFrames": 1,
              "easing": "linear",
              "origin": {
                "x": 395.2,
                "y": 0
              }
            },
            {
              "clipId": "an-src-opacity-220",
              "targets": [
                "an-src"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1532,
              "durationFrames": 8
            },
            {
              "clipId": "tp-barhot-102-pin-221",
              "targets": [
                "tp-barhot-102"
              ],
              "property": "opacity",
              "from": 0,
              "to": 0,
              "startFrame": 0,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "tp-hot-100-pin-222",
              "targets": [
                "tp-hot-100"
              ],
              "property": "opacity",
              "from": 0,
              "to": 0,
              "startFrame": 0,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "tp-barhot-107-pin-223",
              "targets": [
                "tp-barhot-107"
              ],
              "property": "opacity",
              "from": 0,
              "to": 0,
              "startFrame": 0,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "tp-hot-105-pin-224",
              "targets": [
                "tp-hot-105"
              ],
              "property": "opacity",
              "from": 0,
              "to": 0,
              "startFrame": 0,
              "durationFrames": 1,
              "easing": "linear"
            }
          ]
        }
      },
      {
        "assetId": "fail",
        "svgSource": "videos/rag-explainer/visuals/fail.svg",
        "layer": 10,
        "position": {
          "x": 0,
          "y": 0
        },
        "scale": 1,
        "rotation": 0,
        "opacity": 1,
        "animation": {
          "timelineId": "fail-motion",
          "clips": [
            {
              "clipId": "root-opacity-0",
              "targets": [
                "root"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1557,
              "durationFrames": 4,
              "easing": "linear"
            },
            {
              "clipId": "root-opacity-1",
              "targets": [
                "root"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1757,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-wrong-2-translateY-3",
              "targets": [
                "w-wrong-2"
              ],
              "property": "translateY",
              "from": 33.6,
              "to": 0,
              "startFrame": 1556,
              "durationFrames": 10
            },
            {
              "clipId": "w-wrong-2-opacity-4",
              "targets": [
                "w-wrong-2"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1556,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-wrong-5-translateY-6",
              "targets": [
                "w-wrong-5"
              ],
              "property": "translateY",
              "from": 33.6,
              "to": 0,
              "startFrame": 1558,
              "durationFrames": 10
            },
            {
              "clipId": "w-wrong-5-opacity-7",
              "targets": [
                "w-wrong-5"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1558,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-wrong-8-translateY-9",
              "targets": [
                "w-wrong-8"
              ],
              "property": "translateY",
              "from": 33.6,
              "to": 0,
              "startFrame": 1564,
              "durationFrames": 10
            },
            {
              "clipId": "w-wrong-8-opacity-10",
              "targets": [
                "w-wrong-8"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1564,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-wrong-11-translateY-12",
              "targets": [
                "w-wrong-11"
              ],
              "property": "translateY",
              "from": 33.6,
              "to": 0,
              "startFrame": 1571,
              "durationFrames": 10
            },
            {
              "clipId": "w-wrong-11-opacity-13",
              "targets": [
                "w-wrong-11"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1571,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-wrong-14-translateY-15",
              "targets": [
                "w-wrong-14"
              ],
              "property": "translateY",
              "from": 33.6,
              "to": 0,
              "startFrame": 1577,
              "durationFrames": 10
            },
            {
              "clipId": "w-wrong-14-opacity-16",
              "targets": [
                "w-wrong-14"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1577,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-wrong-17-translateY-18",
              "targets": [
                "w-wrong-17"
              ],
              "property": "translateY",
              "from": 33.6,
              "to": 0,
              "startFrame": 1597,
              "durationFrames": 10
            },
            {
              "clipId": "w-wrong-17-opacity-19",
              "targets": [
                "w-wrong-17"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1597,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-wrong-20-translateY-21",
              "targets": [
                "w-wrong-20"
              ],
              "property": "translateY",
              "from": 33.6,
              "to": 0,
              "startFrame": 1601,
              "durationFrames": 10
            },
            {
              "clipId": "w-wrong-20-opacity-22",
              "targets": [
                "w-wrong-20"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1601,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-wrong-23-translateY-24",
              "targets": [
                "w-wrong-23"
              ],
              "property": "translateY",
              "from": 33.6,
              "to": 0,
              "startFrame": 1604,
              "durationFrames": 10
            },
            {
              "clipId": "w-wrong-23-opacity-25",
              "targets": [
                "w-wrong-23"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1604,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-wrong-26-translateY-27",
              "targets": [
                "w-wrong-26"
              ],
              "property": "translateY",
              "from": 33.6,
              "to": 0,
              "startFrame": 1607,
              "durationFrames": 10
            },
            {
              "clipId": "w-wrong-26-opacity-28",
              "targets": [
                "w-wrong-26"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1607,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-wrong-29-translateY-30",
              "targets": [
                "w-wrong-29"
              ],
              "property": "translateY",
              "from": 33.6,
              "to": 0,
              "startFrame": 1615,
              "durationFrames": 10
            },
            {
              "clipId": "w-wrong-29-opacity-31",
              "targets": [
                "w-wrong-29"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1615,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-wrong-32-translateY-33",
              "targets": [
                "w-wrong-32"
              ],
              "property": "translateY",
              "from": 33.6,
              "to": 0,
              "startFrame": 1622,
              "durationFrames": 10
            },
            {
              "clipId": "w-wrong-32-opacity-34",
              "targets": [
                "w-wrong-32"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1622,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-wrong-2-opacity-35",
              "targets": [
                "w-wrong-2"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1650,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-wrong-2-translateY-36",
              "targets": [
                "w-wrong-2"
              ],
              "property": "translateY",
              "from": 0,
              "to": -15.12,
              "startFrame": 1650,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-wrong-5-opacity-37",
              "targets": [
                "w-wrong-5"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1650,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-wrong-5-translateY-38",
              "targets": [
                "w-wrong-5"
              ],
              "property": "translateY",
              "from": 0,
              "to": -15.12,
              "startFrame": 1650,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-wrong-8-opacity-39",
              "targets": [
                "w-wrong-8"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1650,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-wrong-8-translateY-40",
              "targets": [
                "w-wrong-8"
              ],
              "property": "translateY",
              "from": 0,
              "to": -15.12,
              "startFrame": 1650,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-wrong-11-opacity-41",
              "targets": [
                "w-wrong-11"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1650,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-wrong-11-translateY-42",
              "targets": [
                "w-wrong-11"
              ],
              "property": "translateY",
              "from": 0,
              "to": -15.12,
              "startFrame": 1650,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-wrong-14-opacity-43",
              "targets": [
                "w-wrong-14"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1650,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-wrong-14-translateY-44",
              "targets": [
                "w-wrong-14"
              ],
              "property": "translateY",
              "from": 0,
              "to": -15.12,
              "startFrame": 1650,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-wrong-17-opacity-45",
              "targets": [
                "w-wrong-17"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1650,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-wrong-17-translateY-46",
              "targets": [
                "w-wrong-17"
              ],
              "property": "translateY",
              "from": 0,
              "to": -15.12,
              "startFrame": 1650,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-wrong-20-opacity-47",
              "targets": [
                "w-wrong-20"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1650,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-wrong-20-translateY-48",
              "targets": [
                "w-wrong-20"
              ],
              "property": "translateY",
              "from": 0,
              "to": -15.12,
              "startFrame": 1650,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-wrong-23-opacity-49",
              "targets": [
                "w-wrong-23"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1650,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-wrong-23-translateY-50",
              "targets": [
                "w-wrong-23"
              ],
              "property": "translateY",
              "from": 0,
              "to": -15.12,
              "startFrame": 1650,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-wrong-26-opacity-51",
              "targets": [
                "w-wrong-26"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1650,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-wrong-26-translateY-52",
              "targets": [
                "w-wrong-26"
              ],
              "property": "translateY",
              "from": 0,
              "to": -15.12,
              "startFrame": 1650,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-wrong-29-opacity-53",
              "targets": [
                "w-wrong-29"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1650,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-wrong-29-translateY-54",
              "targets": [
                "w-wrong-29"
              ],
              "property": "translateY",
              "from": 0,
              "to": -15.12,
              "startFrame": 1650,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-wrong-32-opacity-55",
              "targets": [
                "w-wrong-32"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1650,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-wrong-32-translateY-56",
              "targets": [
                "w-wrong-32"
              ],
              "property": "translateY",
              "from": 0,
              "to": -15.12,
              "startFrame": 1650,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-garbage-57-translateY-58",
              "targets": [
                "w-garbage-57"
              ],
              "property": "translateY",
              "from": -46,
              "to": 0,
              "startFrame": 1657,
              "durationFrames": 10
            },
            {
              "clipId": "w-garbage-57-opacity-59",
              "targets": [
                "w-garbage-57"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1657,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-garbage-60-translateY-61",
              "targets": [
                "w-garbage-60"
              ],
              "property": "translateY",
              "from": -46,
              "to": 0,
              "startFrame": 1669,
              "durationFrames": 10
            },
            {
              "clipId": "w-garbage-60-opacity-62",
              "targets": [
                "w-garbage-60"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1669,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-garbage-63-translateY-64",
              "targets": [
                "w-garbage-63"
              ],
              "property": "translateY",
              "from": -46,
              "to": 0,
              "startFrame": 1681,
              "durationFrames": 10
            },
            {
              "clipId": "w-garbage-63-opacity-65",
              "targets": [
                "w-garbage-63"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1681,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-garbage-66-translateY-67",
              "targets": [
                "w-garbage-66"
              ],
              "property": "translateY",
              "from": -46,
              "to": 0,
              "startFrame": 1690,
              "durationFrames": 10
            },
            {
              "clipId": "w-garbage-66-opacity-68",
              "targets": [
                "w-garbage-66"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1690,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-garbage-69-translateY-70",
              "targets": [
                "w-garbage-69"
              ],
              "property": "translateY",
              "from": -46,
              "to": 0,
              "startFrame": 1715,
              "durationFrames": 10
            },
            {
              "clipId": "w-garbage-69-opacity-71",
              "targets": [
                "w-garbage-69"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1715,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-garbage-72-translateY-73",
              "targets": [
                "w-garbage-72"
              ],
              "property": "translateY",
              "from": -46,
              "to": 0,
              "startFrame": 1721,
              "durationFrames": 10
            },
            {
              "clipId": "w-garbage-72-opacity-74",
              "targets": [
                "w-garbage-72"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1721,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-garbage-75-translateY-76",
              "targets": [
                "w-garbage-75"
              ],
              "property": "translateY",
              "from": -46,
              "to": 0,
              "startFrame": 1736,
              "durationFrames": 10
            },
            {
              "clipId": "w-garbage-75-opacity-77",
              "targets": [
                "w-garbage-75"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1736,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-garbage-78-translateY-79",
              "targets": [
                "w-garbage-78"
              ],
              "property": "translateY",
              "from": -46,
              "to": 0,
              "startFrame": 1741,
              "durationFrames": 10
            },
            {
              "clipId": "w-garbage-78-opacity-80",
              "targets": [
                "w-garbage-78"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1741,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-garbage-81-translateY-82",
              "targets": [
                "w-garbage-81"
              ],
              "property": "translateY",
              "from": -46,
              "to": 0,
              "startFrame": 1744,
              "durationFrames": 10
            },
            {
              "clipId": "w-garbage-81-opacity-83",
              "targets": [
                "w-garbage-81"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1744,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-garbage-57-opacity-84",
              "targets": [
                "w-garbage-57"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1759,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-garbage-57-translateY-85",
              "targets": [
                "w-garbage-57"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 1759,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-garbage-60-opacity-86",
              "targets": [
                "w-garbage-60"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1759,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-garbage-60-translateY-87",
              "targets": [
                "w-garbage-60"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 1759,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-garbage-63-opacity-88",
              "targets": [
                "w-garbage-63"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1759,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-garbage-63-translateY-89",
              "targets": [
                "w-garbage-63"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 1759,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-garbage-66-opacity-90",
              "targets": [
                "w-garbage-66"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1759,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-garbage-66-translateY-91",
              "targets": [
                "w-garbage-66"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 1759,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-garbage-69-opacity-92",
              "targets": [
                "w-garbage-69"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1759,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-garbage-69-translateY-93",
              "targets": [
                "w-garbage-69"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 1759,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-garbage-72-opacity-94",
              "targets": [
                "w-garbage-72"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1759,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-garbage-72-translateY-95",
              "targets": [
                "w-garbage-72"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 1759,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-garbage-75-opacity-96",
              "targets": [
                "w-garbage-75"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1759,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-garbage-75-translateY-97",
              "targets": [
                "w-garbage-75"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 1759,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-garbage-78-opacity-98",
              "targets": [
                "w-garbage-78"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1759,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-garbage-78-translateY-99",
              "targets": [
                "w-garbage-78"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 1759,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-garbage-81-opacity-100",
              "targets": [
                "w-garbage-81"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1759,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-garbage-81-translateY-101",
              "targets": [
                "w-garbage-81"
              ],
              "property": "translateY",
              "from": 0,
              "to": -16.56,
              "startFrame": 1759,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "f-q-opacity-102",
              "targets": [
                "f-q"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1561,
              "durationFrames": 10
            },
            {
              "clipId": "f-l1-drawOn-103",
              "targets": [
                "f-l1"
              ],
              "property": "drawOn",
              "from": 0,
              "to": 1,
              "startFrame": 1559,
              "durationFrames": 12
            },
            {
              "clipId": "f-r-opacity-104",
              "targets": [
                "f-r"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1572,
              "durationFrames": 10
            },
            {
              "clipId": "f-tag-scale-105",
              "targets": [
                "f-tag"
              ],
              "property": "scale",
              "from": 0,
              "to": 1,
              "startFrame": 1578,
              "durationFrames": 10,
              "origin": {
                "x": 113,
                "y": 20
              }
            },
            {
              "clipId": "f-tag-opacity-106",
              "targets": [
                "f-tag"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1578,
              "durationFrames": 5,
              "easing": "linear"
            },
            {
              "clipId": "f-l2-drawOn-107",
              "targets": [
                "f-l2"
              ],
              "property": "drawOn",
              "from": 0,
              "to": 1,
              "startFrame": 1605,
              "durationFrames": 12
            },
            {
              "clipId": "f-a-opacity-108",
              "targets": [
                "f-a"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1605,
              "durationFrames": 10
            },
            {
              "clipId": "f-cite-opacity-109",
              "targets": [
                "f-cite"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1623,
              "durationFrames": 8
            },
            {
              "clipId": "f-gi-opacity-110",
              "targets": [
                "f-gi"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1658,
              "durationFrames": 8
            },
            {
              "clipId": "f-co-opacity-111",
              "targets": [
                "f-co"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1682,
              "durationFrames": 8
            },
            {
              "clipId": "f-bug-drawOn-112",
              "targets": [
                "f-bug"
              ],
              "property": "drawOn",
              "from": 0,
              "to": 1,
              "startFrame": 1722,
              "durationFrames": 16
            },
            {
              "clipId": "f-bug-tag-opacity-113",
              "targets": [
                "f-bug-tag"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1745,
              "durationFrames": 8
            }
          ]
        }
      },
      {
        "assetId": "outro",
        "svgSource": "videos/rag-explainer/visuals/outro.svg",
        "layer": 12,
        "position": {
          "x": 0,
          "y": 0
        },
        "scale": 1,
        "rotation": 0,
        "opacity": 1,
        "animation": {
          "timelineId": "outro-motion",
          "clips": [
            {
              "clipId": "root-opacity-0",
              "targets": [
                "root"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1767,
              "durationFrames": 4,
              "easing": "linear"
            },
            {
              "clipId": "w-recap-1-scale-2",
              "targets": [
                "w-recap-1"
              ],
              "property": "scale",
              "from": 1.5,
              "to": 1,
              "startFrame": 1766,
              "durationFrames": 9,
              "origin": {
                "x": 191.394,
                "y": -37.199999999999996
              }
            },
            {
              "clipId": "w-recap-1-opacity-3",
              "targets": [
                "w-recap-1"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1766,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-recap-4-scale-5",
              "targets": [
                "w-recap-4"
              ],
              "property": "scale",
              "from": 1.5,
              "to": 1,
              "startFrame": 1774,
              "durationFrames": 9,
              "origin": {
                "x": 41.53999999999999,
                "y": -37.199999999999996
              }
            },
            {
              "clipId": "w-recap-4-opacity-6",
              "targets": [
                "w-recap-4"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1774,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-recap-7-scale-8",
              "targets": [
                "w-recap-7"
              ],
              "property": "scale",
              "from": 1.5,
              "to": 1,
              "startFrame": 1780,
              "durationFrames": 9,
              "origin": {
                "x": 202.92600000000002,
                "y": -37.199999999999996
              }
            },
            {
              "clipId": "w-recap-7-opacity-9",
              "targets": [
                "w-recap-7"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1780,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-recap-10-scale-11",
              "targets": [
                "w-recap-10"
              ],
              "property": "scale",
              "from": 1.5,
              "to": 1,
              "startFrame": 1785,
              "durationFrames": 9,
              "origin": {
                "x": 41.53999999999999,
                "y": -37.199999999999996
              }
            },
            {
              "clipId": "w-recap-10-opacity-12",
              "targets": [
                "w-recap-10"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1785,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-recap-13-scale-14",
              "targets": [
                "w-recap-13"
              ],
              "property": "scale",
              "from": 1.5,
              "to": 1,
              "startFrame": 1800,
              "durationFrames": 9,
              "origin": {
                "x": 208.816,
                "y": -37.199999999999996
              }
            },
            {
              "clipId": "w-recap-13-opacity-15",
              "targets": [
                "w-recap-13"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1800,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-recap-16-scale-17",
              "targets": [
                "w-recap-16"
              ],
              "property": "scale",
              "from": 1.5,
              "to": 1,
              "startFrame": 1804,
              "durationFrames": 9,
              "origin": {
                "x": 41.53999999999999,
                "y": -37.199999999999996
              }
            },
            {
              "clipId": "w-recap-16-opacity-18",
              "targets": [
                "w-recap-16"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1804,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-recap-19-scale-20",
              "targets": [
                "w-recap-19"
              ],
              "property": "scale",
              "from": 1.5,
              "to": 1,
              "startFrame": 1818,
              "durationFrames": 9,
              "origin": {
                "x": 150.536,
                "y": -37.199999999999996
              }
            },
            {
              "clipId": "w-recap-19-opacity-21",
              "targets": [
                "w-recap-19"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1818,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-recap-22-scale-23",
              "targets": [
                "w-recap-22"
              ],
              "property": "scale",
              "from": 1.5,
              "to": 1,
              "startFrame": 1824,
              "durationFrames": 9,
              "origin": {
                "x": 41.53999999999999,
                "y": -37.199999999999996
              }
            },
            {
              "clipId": "w-recap-22-opacity-24",
              "targets": [
                "w-recap-22"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1824,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-recap-1-opacity-25",
              "targets": [
                "w-recap-1"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1837,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-recap-4-opacity-26",
              "targets": [
                "w-recap-4"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1837,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-recap-7-opacity-27",
              "targets": [
                "w-recap-7"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1837,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-recap-10-opacity-28",
              "targets": [
                "w-recap-10"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1837,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-recap-13-opacity-29",
              "targets": [
                "w-recap-13"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1837,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-recap-16-opacity-30",
              "targets": [
                "w-recap-16"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1837,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-recap-19-opacity-31",
              "targets": [
                "w-recap-19"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1837,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "w-recap-22-opacity-32",
              "targets": [
                "w-recap-22"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1837,
              "durationFrames": 7,
              "easing": "linear"
            },
            {
              "clipId": "cell-0-scale-33",
              "targets": [
                "cell-0"
              ],
              "property": "scale",
              "from": 0.7,
              "to": 1,
              "startFrame": 1767,
              "durationFrames": 12,
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "cell-0-opacity-34",
              "targets": [
                "cell-0"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1767,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "cell-0-opacity-35",
              "targets": [
                "cell-0"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1837,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "cell-1-scale-36",
              "targets": [
                "cell-1"
              ],
              "property": "scale",
              "from": 0.7,
              "to": 1,
              "startFrame": 1781,
              "durationFrames": 12,
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "cell-1-opacity-37",
              "targets": [
                "cell-1"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1781,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "cell-1-opacity-38",
              "targets": [
                "cell-1"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1837,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "cell-2-scale-39",
              "targets": [
                "cell-2"
              ],
              "property": "scale",
              "from": 0.7,
              "to": 1,
              "startFrame": 1801,
              "durationFrames": 12,
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "cell-2-opacity-40",
              "targets": [
                "cell-2"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1801,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "cell-2-opacity-41",
              "targets": [
                "cell-2"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1837,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "cell-3-scale-42",
              "targets": [
                "cell-3"
              ],
              "property": "scale",
              "from": 0.7,
              "to": 1,
              "startFrame": 1819,
              "durationFrames": 12,
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "cell-3-opacity-43",
              "targets": [
                "cell-3"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1819,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "cell-3-opacity-44",
              "targets": [
                "cell-3"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1837,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-end-45-scale-46",
              "targets": [
                "w-end-45"
              ],
              "property": "scale",
              "from": 1.5,
              "to": 1,
              "startFrame": 1842,
              "durationFrames": 9,
              "origin": {
                "x": 398.705,
                "y": -69
              }
            },
            {
              "clipId": "w-end-45-opacity-47",
              "targets": [
                "w-end-45"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1842,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-end-48-scale-49",
              "targets": [
                "w-end-48"
              ],
              "property": "scale",
              "from": 1.5,
              "to": 1,
              "startFrame": 1849,
              "durationFrames": 9,
              "origin": {
                "x": 77.05,
                "y": -69
              }
            },
            {
              "clipId": "w-end-48-opacity-50",
              "targets": [
                "w-end-48"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1849,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-end-51-translateY-52",
              "targets": [
                "w-end-51"
              ],
              "property": "translateY",
              "from": 30.400000000000002,
              "to": 0,
              "startFrame": 1863,
              "durationFrames": 10
            },
            {
              "clipId": "w-end-51-opacity-53",
              "targets": [
                "w-end-51"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1863,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-end-54-translateY-55",
              "targets": [
                "w-end-54"
              ],
              "property": "translateY",
              "from": 30.400000000000002,
              "to": 0,
              "startFrame": 1866,
              "durationFrames": 10
            },
            {
              "clipId": "w-end-54-opacity-56",
              "targets": [
                "w-end-54"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1866,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-end-57-translateY-58",
              "targets": [
                "w-end-57"
              ],
              "property": "translateY",
              "from": 30.400000000000002,
              "to": 0,
              "startFrame": 1871,
              "durationFrames": 10
            },
            {
              "clipId": "w-end-57-opacity-59",
              "targets": [
                "w-end-57"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1871,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-end-60-translateY-61",
              "targets": [
                "w-end-60"
              ],
              "property": "translateY",
              "from": 30.400000000000002,
              "to": 0,
              "startFrame": 1874,
              "durationFrames": 10
            },
            {
              "clipId": "w-end-60-opacity-62",
              "targets": [
                "w-end-60"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1874,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "w-end-63-translateY-64",
              "targets": [
                "w-end-63"
              ],
              "property": "translateY",
              "from": 30.400000000000002,
              "to": 0,
              "startFrame": 1881,
              "durationFrames": 10
            },
            {
              "clipId": "w-end-63-opacity-65",
              "targets": [
                "w-end-63"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1881,
              "durationFrames": 6,
              "easing": "linear"
            },
            {
              "clipId": "end-rule-drawOn-66",
              "targets": [
                "end-rule"
              ],
              "property": "drawOn",
              "from": 0,
              "to": 1,
              "startFrame": 1867,
              "durationFrames": 26,
              "easing": "expoOut"
            },
            {
              "clipId": "end-tag-opacity-67",
              "targets": [
                "end-tag"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1899,
              "durationFrames": 14
            }
          ]
        }
      },
      {
        "assetId": "hud",
        "svgSource": "videos/rag-explainer/visuals/hud.svg",
        "layer": 20,
        "position": {
          "x": 0,
          "y": 0
        },
        "scale": 1,
        "rotation": 0,
        "opacity": 1,
        "animation": {
          "timelineId": "hud-motion",
          "clips": [
            {
              "clipId": "ctx-0-opacity-0",
              "targets": [
                "ctx-0"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1283,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "ctx-1-opacity-1",
              "targets": [
                "ctx-1"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1283,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "ctx-1-opacity-2",
              "targets": [
                "ctx-1"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1292,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "ctx-2-opacity-3",
              "targets": [
                "ctx-2"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1292,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "ctx-2-opacity-4",
              "targets": [
                "ctx-2"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1301,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "ctx-3-opacity-5",
              "targets": [
                "ctx-3"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1301,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "ctx-3-opacity-6",
              "targets": [
                "ctx-3"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1310,
              "durationFrames": 1,
              "easing": "linear"
            },
            {
              "clipId": "ctx-4-opacity-7",
              "targets": [
                "ctx-4"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1310,
              "durationFrames": 1,
              "easing": "linear"
            }
          ]
        }
      }
    ],
    "actors": []
  },
  "shots": [
    {
      "id": "stale",
      "ch": "the problem",
      "dur": 2.8,
      "stage": "none",
      "look": "all",
      "move": "cut",
      "drift": false,
      "zoom": 1,
      "scriptText": "I know so much, but I stopped learning last spring.",
      "visualDirection": "A timeline of training data stops dead at a hard cutoff line.",
      "speed": 1,
      "blocks": []
    },
    {
      "id": "invent",
      "ch": "the problem",
      "dur": 2.7,
      "stage": "none",
      "look": "all",
      "move": "pan",
      "drift": false,
      "zoom": 1,
      "scriptText": "Ask me about today, and I'll invent anything.",
      "visualDirection": "Hollow question-mark answers pop into the empty space after the cutoff.",
      "speed": 1,
      "blocks": []
    },
    {
      "id": "halluc",
      "ch": "the problem",
      "dur": 3.1667,
      "stage": "none",
      "look": "all",
      "move": "pan",
      "drift": false,
      "zoom": 1,
      "scriptText": "They call it hallucination. I call it confidence.",
      "visualDirection": "Hallucination in giant type; a confidence bar runs to full against an accuracy bar that cannot be measured.",
      "speed": 1,
      "blocks": []
    },
    {
      "id": "nexttoken",
      "ch": "the problem",
      "dur": 3.1,
      "stage": "none",
      "look": "all",
      "move": "pan",
      "drift": false,
      "zoom": 1,
      "scriptText": "No source, no brakes. Just the next likely word.",
      "visualDirection": "A terminal panel types the question and shows the model picking the most plausible wrong number.",
      "speed": 1,
      "blocks": []
    },
    {
      "id": "lookup",
      "ch": "the fix",
      "dur": 2.5667,
      "stage": "none",
      "look": "all",
      "move": "cut",
      "drift": false,
      "zoom": 1,
      "scriptText": "So don't make me remember. Let me look it up.",
      "visualDirection": "",
      "speed": 1,
      "blocks": []
    },
    {
      "id": "title",
      "ch": "the fix",
      "dur": 2.7,
      "stage": "none",
      "look": "all",
      "move": "pan",
      "drift": false,
      "zoom": 1,
      "scriptText": "Retrieval. Augmented. Generation.",
      "visualDirection": "",
      "speed": 1,
      "blocks": []
    },
    {
      "id": "tear",
      "ch": "the pipeline",
      "dur": 2.6,
      "stage": "none",
      "look": "all",
      "move": "cut",
      "drift": false,
      "zoom": 1,
      "scriptText": "Step one: tear your documents into chunks.",
      "visualDirection": "",
      "speed": 1,
      "blocks": []
    },
    {
      "id": "overlap",
      "ch": "the pipeline",
      "dur": 3.7,
      "stage": "none",
      "look": "all",
      "move": "pan",
      "drift": false,
      "zoom": 1,
      "scriptText": "Small pieces, with a little overlap, so no sentence gets cut.",
      "visualDirection": "",
      "speed": 1,
      "blocks": []
    },
    {
      "id": "sizes",
      "ch": "the pipeline",
      "dur": 3.9,
      "stage": "none",
      "look": "all",
      "move": "pan",
      "drift": false,
      "zoom": 1,
      "scriptText": "Too small, it loses the plot. Too big, the signal drowns.",
      "visualDirection": "",
      "speed": 1,
      "blocks": []
    },
    {
      "id": "vectors",
      "ch": "the pipeline",
      "dur": 3.6,
      "stage": "none",
      "look": "all",
      "move": "pan",
      "drift": false,
      "zoom": 1,
      "scriptText": "Step two: every chunk becomes a vector, a point in space.",
      "visualDirection": "",
      "speed": 1,
      "blocks": []
    },
    {
      "id": "meaning",
      "ch": "the pipeline",
      "dur": 3.8333,
      "stage": "none",
      "look": "all",
      "move": "pan",
      "drift": false,
      "zoom": 1,
      "scriptText": "Meaning is just coordinates. Similar ideas land close.",
      "visualDirection": "",
      "speed": 1,
      "blocks": []
    },
    {
      "id": "query",
      "ch": "the pipeline",
      "dur": 2.8,
      "stage": "none",
      "look": "all",
      "move": "pan",
      "drift": false,
      "zoom": 1,
      "scriptText": "Step three: your question becomes a point too.",
      "visualDirection": "",
      "speed": 1,
      "blocks": []
    },
    {
      "id": "topk",
      "ch": "the pipeline",
      "dur": 3.7667,
      "stage": "none",
      "look": "all",
      "move": "pan",
      "drift": false,
      "zoom": 1,
      "scriptText": "Draw rings around it. Grab the nearest few. That's top k.",
      "visualDirection": "",
      "speed": 1,
      "blocks": []
    },
    {
      "id": "stuff",
      "ch": "the answer",
      "dur": 2.8667,
      "stage": "none",
      "look": "all",
      "move": "cut",
      "drift": false,
      "zoom": 1,
      "scriptText": "Step four: stuff those chunks into my prompt.",
      "visualDirection": "",
      "speed": 1,
      "blocks": []
    },
    {
      "id": "receipts",
      "ch": "the answer",
      "dur": 2.3,
      "stage": "none",
      "look": "all",
      "move": "pan",
      "drift": false,
      "zoom": 1,
      "scriptText": "Now I've got receipts before I speak.",
      "visualDirection": "",
      "speed": 1,
      "blocks": []
    },
    {
      "id": "shift",
      "ch": "the answer",
      "dur": 2.6667,
      "stage": "none",
      "look": "all",
      "move": "pan",
      "drift": false,
      "zoom": 1,
      "scriptText": "Watch the odds shift once the context lands.",
      "visualDirection": "",
      "speed": 1,
      "blocks": []
    },
    {
      "id": "grounded",
      "ch": "the answer",
      "dur": 2.8333,
      "stage": "none",
      "look": "all",
      "move": "pan",
      "drift": false,
      "zoom": 1,
      "scriptText": "The guesses fall away. The answer has a source.",
      "visualDirection": "",
      "speed": 1,
      "blocks": []
    },
    {
      "id": "wrong",
      "ch": "the catch",
      "dur": 3.3667,
      "stage": "none",
      "look": "all",
      "move": "cut",
      "drift": false,
      "zoom": 1,
      "scriptText": "But fetch the wrong chunk, and I'll be wrong, with citations.",
      "visualDirection": "",
      "speed": 1,
      "blocks": []
    },
    {
      "id": "garbage",
      "ch": "the catch",
      "dur": 3.6333,
      "stage": "none",
      "look": "all",
      "move": "pan",
      "drift": false,
      "zoom": 1,
      "scriptText": "Garbage in, confident out. Bad retrieval is the bug.",
      "visualDirection": "",
      "speed": 1,
      "blocks": []
    },
    {
      "id": "recap",
      "ch": "the catch",
      "dur": 2.5333,
      "stage": "none",
      "look": "all",
      "move": "pan",
      "drift": false,
      "zoom": 1,
      "scriptText": "Chunk it. Embed it. Search it. Stuff it.",
      "visualDirection": "",
      "speed": 1,
      "blocks": []
    },
    {
      "id": "end",
      "ch": "the catch",
      "dur": 4.4333,
      "stage": "none",
      "look": "all",
      "move": "pan",
      "drift": false,
      "zoom": 1,
      "scriptText": "Ground it. Then let the model speak.",
      "visualDirection": "",
      "speed": 1,
      "blocks": []
    }
  ],
  "voiceover": {
    "src": "videos/rag-explainer/voiceover.wav",
    "volume": 1,
    "speed": 1,
    "durationSec": 65.8667
  },
  "subtitles": false
};
