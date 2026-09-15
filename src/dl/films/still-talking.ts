import type { Film } from "../schema";

export const stillTalkingFilm: Film = {
  "schemaVersion": "1.0.0",
  "id": "still-talking",
  "title": "Still Talking",
  "fps": 30,
  "accent": "#635BFF",
  "theme": {
    "background": "smooth-dark",
    "fontFamily": "geist",
    "videoType": "educational",
    "storyStyle": "script-metaphor",
    "accent": "#635BFF"
  },
  "chapters": [
    "departure",
    "the grand tour",
    "out of the plane",
    "pale blue dot",
    "the edge",
    "still talking"
  ],
  "canvas": {
    "nodes": [
      {
        "id": "sun",
        "label": "the sun",
        "sub": "where the signal is aimed",
        "x": 60,
        "y": 300,
        "w": 200,
        "h": 62
      },
      {
        "id": "heliopause",
        "label": "the heliopause",
        "sub": "august 2012",
        "x": 400,
        "y": 300,
        "w": 210,
        "h": 62
      },
      {
        "id": "interstellar",
        "label": "interstellar space",
        "sub": "still transmitting",
        "x": 750,
        "y": 300,
        "w": 230,
        "h": 62
      }
    ],
    "edges": [
      {
        "from": "sun",
        "to": "heliopause",
        "dashed": false
      },
      {
        "from": "heliopause",
        "to": "interstellar",
        "dashed": true
      }
    ]
  },
  "scene": {
    "schemaVersion": "1.0.0",
    "sceneId": "still-talking",
    "fps": 30,
    "durationFrames": 4621,
    "audioSource": "videos/still-talking/voiceover.wav",
    "audioDurationMs": 154034,
    "sceneSize": {
      "w": 1920,
      "h": 1920
    },
    "background": {
      "assetId": "space",
      "svgSource": "videos/still-talking/visuals/space.svg",
      "layer": 0,
      "position": {
        "x": 960,
        "y": 960
      },
      "scale": 4.8,
      "rotation": 0,
      "opacity": 1,
      "animation": {
        "timelineId": "space-drift",
        "clips": [
          {
            "clipId": "band-drift",
            "targets": [
              "milky-band"
            ],
            "property": "translateX",
            "from": 0,
            "to": -46,
            "startFrame": 0,
            "durationFrames": 4621,
            "easing": "linear"
          }
        ]
      }
    },
    "props": [
      {
        "assetId": "stars-far",
        "svgSource": "videos/still-talking/visuals/stars-far.svg",
        "layer": 1,
        "position": {
          "x": 960,
          "y": 960
        },
        "scale": 4.8,
        "rotation": 0,
        "opacity": 1,
        "animation": {
          "timelineId": "stars-far-drift",
          "clips": [
            {
              "clipId": "far-cruise-1",
              "targets": [
                "stars-far"
              ],
              "property": "translateX",
              "from": 0,
              "to": -44,
              "startFrame": 0,
              "durationFrames": 1485,
              "easing": "linear"
            },
            {
              "clipId": "far-whip",
              "targets": [
                "stars-far"
              ],
              "property": "translateX",
              "from": -44,
              "to": -80,
              "startFrame": 1485,
              "durationFrames": 156,
              "easing": "expoInOut"
            },
            {
              "clipId": "far-cruise-2",
              "targets": [
                "stars-far"
              ],
              "property": "translateX",
              "from": -80,
              "to": -244,
              "startFrame": 1641,
              "durationFrames": 2980,
              "easing": "linear"
            },
            {
              "clipId": "far-twinkle-a",
              "targets": [
                "stars-far-twinkle-1",
                "stars-far-twinkle-4"
              ],
              "property": "opacity",
              "from": 0.7,
              "to": 0.3,
              "startFrame": 1098,
              "durationFrames": 957,
              "easing": "linear"
            },
            {
              "clipId": "far-twinkle-b",
              "targets": [
                "stars-far-twinkle-2",
                "stars-far-twinkle-6"
              ],
              "property": "opacity",
              "from": 0.7,
              "to": 0.95,
              "startFrame": 2161,
              "durationFrames": 1403,
              "easing": "linear"
            },
            {
              "clipId": "far-twinkle-c",
              "targets": [
                "stars-far-twinkle-3",
                "stars-far-twinkle-7"
              ],
              "property": "opacity",
              "from": 0.7,
              "to": 0.35,
              "startFrame": 3062,
              "durationFrames": 579,
              "easing": "linear"
            },
            {
              "clipId": "far-twinkle-d",
              "targets": [
                "stars-far-twinkle-5",
                "stars-far-twinkle-8"
              ],
              "property": "opacity",
              "from": 0.7,
              "to": 0.9,
              "startFrame": 3986,
              "durationFrames": 635,
              "easing": "linear"
            }
          ]
        }
      },
      {
        "assetId": "stars-near",
        "svgSource": "videos/still-talking/visuals/stars-near.svg",
        "layer": 2,
        "position": {
          "x": 960,
          "y": 960
        },
        "scale": 3.6,
        "rotation": 0,
        "opacity": 1,
        "animation": {
          "timelineId": "stars-near-drift",
          "clips": [
            {
              "clipId": "near-cruise-1",
              "targets": [
                "stars-near"
              ],
              "property": "translateX",
              "from": 0,
              "to": -162,
              "startFrame": 0,
              "durationFrames": 1485,
              "easing": "linear"
            },
            {
              "clipId": "near-whip",
              "targets": [
                "stars-near"
              ],
              "property": "translateX",
              "from": -162,
              "to": -320,
              "startFrame": 1485,
              "durationFrames": 156,
              "easing": "expoInOut"
            },
            {
              "clipId": "near-cruise-2",
              "targets": [
                "stars-near"
              ],
              "property": "translateX",
              "from": -320,
              "to": -1050,
              "startFrame": 1641,
              "durationFrames": 2980,
              "easing": "linear"
            },
            {
              "clipId": "near-twinkle-a",
              "targets": [
                "stars-near-twinkle-1",
                "stars-near-twinkle-3"
              ],
              "property": "opacity",
              "from": 0.7,
              "to": 0.34,
              "startFrame": 1274,
              "durationFrames": 887,
              "easing": "linear"
            },
            {
              "clipId": "near-twinkle-b",
              "targets": [
                "stars-near-twinkle-2",
                "stars-near-twinkle-5"
              ],
              "property": "opacity",
              "from": 0.7,
              "to": 0.96,
              "startFrame": 2362,
              "durationFrames": 1040,
              "easing": "linear"
            },
            {
              "clipId": "near-twinkle-c",
              "targets": [
                "stars-near-twinkle-4",
                "stars-near-twinkle-6"
              ],
              "property": "opacity",
              "from": 0.7,
              "to": 0.4,
              "startFrame": 3641,
              "durationFrames": 980,
              "easing": "linear"
            }
          ]
        }
      },
      {
        "assetId": "boundary",
        "svgSource": "videos/still-talking/visuals/boundary.svg",
        "layer": 3,
        "position": {
          "x": 1960,
          "y": 960
        },
        "scale": 1,
        "rotation": 0,
        "opacity": 1,
        "animation": {
          "timelineId": "heliopause-crossing",
          "clips": [
            {
              "clipId": "boundary-in",
              "targets": [
                "boundary-body"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 3065,
              "durationFrames": 54
            },
            {
              "clipId": "boundary-approach",
              "targets": [
                "boundary-body"
              ],
              "property": "translateX",
              "from": 0,
              "to": -380,
              "startFrame": 3062,
              "durationFrames": 140,
              "easing": "linear"
            },
            {
              "clipId": "boundary-near",
              "targets": [
                "boundary-body"
              ],
              "property": "translateX",
              "from": -380,
              "to": -742,
              "startFrame": 3202,
              "durationFrames": 192,
              "easing": "linear"
            },
            {
              "clipId": "boundary-cross",
              "targets": [
                "boundary-body"
              ],
              "property": "translateX",
              "from": -742,
              "to": -1012,
              "startFrame": 3394,
              "durationFrames": 49,
              "easing": "linear"
            },
            {
              "clipId": "boundary-recede",
              "targets": [
                "boundary-body"
              ],
              "property": "translateX",
              "from": -1012,
              "to": -2040,
              "startFrame": 3443,
              "durationFrames": 728,
              "easing": "linear"
            },
            {
              "clipId": "boundary-out",
              "targets": [
                "boundary-body"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 4005,
              "durationFrames": 166
            },
            {
              "clipId": "arc-draw",
              "targets": [
                "bubble-arc"
              ],
              "property": "drawOn",
              "from": 0,
              "to": 1,
              "startFrame": 3079,
              "durationFrames": 165,
              "easing": "linear"
            },
            {
              "clipId": "arc-inner-draw",
              "targets": [
                "bubble-arc-inner"
              ],
              "property": "drawOn",
              "from": 0,
              "to": 1,
              "startFrame": 3119,
              "durationFrames": 175,
              "easing": "linear"
            },
            {
              "clipId": "wind-stream",
              "targets": [
                "wind-1",
                "wind-2",
                "wind-3",
                "wind-4",
                "wind-5",
                "wind-6",
                "wind-7",
                "wind-8",
                "wind-9",
                "wind-10",
                "wind-11",
                "wind-12",
                "wind-13",
                "wind-14"
              ],
              "property": "translateX",
              "from": 0,
              "to": 108,
              "startFrame": 3073,
              "durationFrames": 61,
              "easing": "linear",
              "staggerFrames": 4
            },
            {
              "clipId": "wind-stall",
              "targets": [
                "wind-1",
                "wind-2",
                "wind-3",
                "wind-4",
                "wind-5",
                "wind-6",
                "wind-7",
                "wind-8",
                "wind-9",
                "wind-10",
                "wind-11",
                "wind-12",
                "wind-13",
                "wind-14"
              ],
              "property": "translateX",
              "from": 108,
              "to": 152,
              "startFrame": 3215,
              "durationFrames": 172,
              "easing": "expoOut"
            },
            {
              "clipId": "wind-die",
              "targets": [
                "wind-1",
                "wind-2",
                "wind-3",
                "wind-4",
                "wind-5",
                "wind-6",
                "wind-7",
                "wind-8",
                "wind-9",
                "wind-10",
                "wind-11",
                "wind-12",
                "wind-13",
                "wind-14"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 3354,
              "durationFrames": 34,
              "staggerFrames": 4
            },
            {
              "clipId": "ism-arrive",
              "targets": [
                "ism-1",
                "ism-2",
                "ism-3",
                "ism-4",
                "ism-5",
                "ism-6",
                "ism-7",
                "ism-8",
                "ism-9",
                "ism-10",
                "ism-11",
                "ism-12",
                "ism-13",
                "ism-14",
                "ism-15",
                "ism-16",
                "ism-17",
                "ism-18",
                "ism-19",
                "ism-20",
                "ism-21",
                "ism-22",
                "ism-23",
                "ism-24",
                "ism-25",
                "ism-26",
                "ism-27",
                "ism-28",
                "ism-29",
                "ism-30",
                "ism-31",
                "ism-32",
                "ism-33",
                "ism-34"
              ],
              "property": "opacity",
              "from": 0,
              "to": 0.55,
              "startFrame": 3229,
              "durationFrames": 39,
              "staggerFrames": 4
            }
          ]
        }
      },
      {
        "assetId": "home-system",
        "svgSource": "videos/still-talking/visuals/home-system.svg",
        "layer": 4,
        "position": {
          "x": 470,
          "y": 1285
        },
        "scale": 0.95,
        "rotation": 0,
        "opacity": 1,
        "animation": {
          "timelineId": "home-system-recedes",
          "clips": [
            {
              "clipId": "orbits-draw",
              "targets": [
                "orbit-earth",
                "orbit-mars",
                "orbit-jupiter",
                "orbit-saturn",
                "orbit-uranus",
                "orbit-neptune"
              ],
              "property": "drawOn",
              "from": 0,
              "to": 1,
              "startFrame": 323,
              "durationFrames": 103,
              "easing": "linear",
              "staggerFrames": 22
            },
            {
              "clipId": "earth-in",
              "targets": [
                "earth-marker"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 329,
              "durationFrames": 58
            },
            {
              "clipId": "earth-dim",
              "targets": [
                "earth-marker"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0.4,
              "startFrame": 1050,
              "durationFrames": 189
            },
            {
              "clipId": "earth-last-look",
              "targets": [
                "earth-marker"
              ],
              "property": "opacity",
              "from": 0.4,
              "to": 0,
              "startFrame": 1969,
              "durationFrames": 75
            },
            {
              "clipId": "earth-ping-1",
              "targets": [
                "earth-halo"
              ],
              "property": "scale",
              "from": 1,
              "to": 2.6,
              "startFrame": 339,
              "durationFrames": 79,
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "earth-ping-1-fade",
              "targets": [
                "earth-halo"
              ],
              "property": "opacity",
              "from": 0.9,
              "to": 0,
              "startFrame": 339,
              "durationFrames": 79
            },
            {
              "clipId": "earth-ping-2-reset",
              "targets": [
                "earth-halo"
              ],
              "property": "scale",
              "from": 2.6,
              "to": 1,
              "startFrame": 418,
              "durationFrames": 7,
              "easing": "hold",
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "earth-ping-2-reset-fade",
              "targets": [
                "earth-halo"
              ],
              "property": "opacity",
              "from": 0,
              "to": 0.9,
              "startFrame": 418,
              "durationFrames": 7,
              "easing": "hold"
            },
            {
              "clipId": "earth-ping-2",
              "targets": [
                "earth-halo"
              ],
              "property": "scale",
              "from": 1,
              "to": 2.6,
              "startFrame": 425,
              "durationFrames": 89,
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "earth-ping-2-fade",
              "targets": [
                "earth-halo"
              ],
              "property": "opacity",
              "from": 0.9,
              "to": 0,
              "startFrame": 425,
              "durationFrames": 89
            },
            {
              "clipId": "rings-shrink-x-1",
              "targets": [
                "home-rings"
              ],
              "property": "scaleX",
              "from": 1,
              "to": 0.62,
              "startFrame": 1098,
              "durationFrames": 218,
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "rings-shrink-x-2",
              "targets": [
                "home-rings"
              ],
              "property": "scaleX",
              "from": 0.62,
              "to": 0.42,
              "startFrame": 1641,
              "durationFrames": 199,
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "rings-flatten-x",
              "targets": [
                "home-rings"
              ],
              "property": "scaleX",
              "from": 0.42,
              "to": 0.54,
              "startFrame": 1840,
              "durationFrames": 215,
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "rings-shrink-y-1",
              "targets": [
                "home-rings"
              ],
              "property": "scaleY",
              "from": 1,
              "to": 0.62,
              "startFrame": 1098,
              "durationFrames": 218,
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "rings-shrink-y-2",
              "targets": [
                "home-rings"
              ],
              "property": "scaleY",
              "from": 0.62,
              "to": 0.42,
              "startFrame": 1641,
              "durationFrames": 199,
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "rings-flatten",
              "targets": [
                "home-rings"
              ],
              "property": "scaleY",
              "from": 0.42,
              "to": 0.045,
              "startFrame": 1840,
              "durationFrames": 172,
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "rings-fall-away",
              "targets": [
                "home-rings"
              ],
              "property": "translateY",
              "from": 0,
              "to": 92,
              "startFrame": 1840,
              "durationFrames": 215,
              "easing": "linear"
            },
            {
              "clipId": "rings-emphasise",
              "targets": [
                "home-rings"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0.95,
              "startFrame": 1851,
              "durationFrames": 75
            },
            {
              "clipId": "rings-gone",
              "targets": [
                "home-rings"
              ],
              "property": "opacity",
              "from": 0.95,
              "to": 0,
              "startFrame": 1991,
              "durationFrames": 117
            }
          ]
        }
      },
      {
        "assetId": "jupiter",
        "svgSource": "videos/still-talking/visuals/jupiter.svg",
        "layer": 5,
        "position": {
          "x": 1000,
          "y": 850
        },
        "scale": 1,
        "rotation": 0,
        "opacity": 1,
        "animation": {
          "timelineId": "jupiter-passage",
          "clips": [
            {
              "clipId": "jup-fade-in",
              "targets": [
                "jupiter-body"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1235,
              "durationFrames": 64
            },
            {
              "clipId": "jup-approach",
              "targets": [
                "jupiter-body"
              ],
              "property": "translateX",
              "from": 1780,
              "to": 80,
              "startFrame": 1242,
              "durationFrames": 209,
              "easing": "expoOut"
            },
            {
              "clipId": "jup-depart",
              "targets": [
                "jupiter-body"
              ],
              "property": "translateX",
              "from": 80,
              "to": -2140,
              "startFrame": 1493,
              "durationFrames": 160,
              "easing": "expoIn"
            },
            {
              "clipId": "jup-loom",
              "targets": [
                "jupiter-body"
              ],
              "property": "scale",
              "from": 0.5,
              "to": 1.9,
              "startFrame": 1242,
              "durationFrames": 209,
              "easing": "expoOut",
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "jup-pass",
              "targets": [
                "jupiter-body"
              ],
              "property": "scale",
              "from": 1.9,
              "to": 2.45,
              "startFrame": 1493,
              "durationFrames": 160,
              "easing": "expoIn",
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "jup-fade-out",
              "targets": [
                "jupiter-body"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1600,
              "durationFrames": 49
            },
            {
              "clipId": "bands-a",
              "targets": [
                "jup-band-1",
                "jup-band-4"
              ],
              "property": "translateX",
              "from": 0,
              "to": 48,
              "startFrame": 1278,
              "durationFrames": 371,
              "easing": "linear"
            },
            {
              "clipId": "bands-b",
              "targets": [
                "jup-band-2",
                "jup-band-5"
              ],
              "property": "translateX",
              "from": 0,
              "to": -40,
              "startFrame": 1278,
              "durationFrames": 371,
              "easing": "linear"
            },
            {
              "clipId": "bands-c",
              "targets": [
                "jup-band-3",
                "jup-band-6"
              ],
              "property": "translateX",
              "from": 0,
              "to": 22,
              "startFrame": 1278,
              "durationFrames": 371,
              "easing": "linear"
            },
            {
              "clipId": "spot-turn",
              "targets": [
                "jup-spot",
                "jup-spot-core"
              ],
              "property": "rotate",
              "from": 0,
              "to": 26,
              "startFrame": 1278,
              "durationFrames": 371,
              "easing": "linear",
              "origin": {
                "x": -62,
                "y": 64
              }
            },
            {
              "clipId": "spot-drift",
              "targets": [
                "jup-spot",
                "jup-spot-core"
              ],
              "property": "translateX",
              "from": 0,
              "to": 34,
              "startFrame": 1278,
              "durationFrames": 371,
              "easing": "linear"
            },
            {
              "clipId": "terminator-sweep",
              "targets": [
                "jup-terminator"
              ],
              "property": "opacity",
              "from": 0.8,
              "to": 1,
              "startFrame": 1295,
              "durationFrames": 330,
              "easing": "linear"
            }
          ]
        }
      },
      {
        "assetId": "saturn",
        "svgSource": "videos/still-talking/visuals/saturn.svg",
        "layer": 6,
        "position": {
          "x": 1000,
          "y": 850
        },
        "scale": 1,
        "rotation": 0,
        "opacity": 1,
        "animation": {
          "timelineId": "saturn-encounter",
          "clips": [
            {
              "clipId": "sat-fade-in",
              "targets": [
                "saturn-body",
                "titan-body"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1597,
              "durationFrames": 68
            },
            {
              "clipId": "sat-approach",
              "targets": [
                "saturn-body"
              ],
              "property": "translateX",
              "from": 1820,
              "to": 60,
              "startFrame": 1604,
              "durationFrames": 216,
              "easing": "expoOut"
            },
            {
              "clipId": "sat-depart",
              "targets": [
                "saturn-body"
              ],
              "property": "translateX",
              "from": 60,
              "to": -2180,
              "startFrame": 1853,
              "durationFrames": 213,
              "easing": "expoIn"
            },
            {
              "clipId": "sat-loom",
              "targets": [
                "saturn-body"
              ],
              "property": "scale",
              "from": 0.45,
              "to": 1.5,
              "startFrame": 1604,
              "durationFrames": 216,
              "easing": "expoOut",
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "sat-pass",
              "targets": [
                "saturn-body"
              ],
              "property": "scale",
              "from": 1.5,
              "to": 1.82,
              "startFrame": 1853,
              "durationFrames": 213,
              "easing": "expoIn",
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "titan-approach",
              "targets": [
                "titan-body"
              ],
              "property": "translateX",
              "from": 1820,
              "to": 60,
              "startFrame": 1604,
              "durationFrames": 216,
              "easing": "expoOut"
            },
            {
              "clipId": "titan-depart",
              "targets": [
                "titan-body"
              ],
              "property": "translateX",
              "from": 60,
              "to": -2180,
              "startFrame": 1853,
              "durationFrames": 213,
              "easing": "expoIn"
            },
            {
              "clipId": "titan-loom",
              "targets": [
                "titan-body"
              ],
              "property": "scale",
              "from": 0.45,
              "to": 0.82,
              "startFrame": 1604,
              "durationFrames": 216,
              "easing": "expoOut",
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "titan-pass",
              "targets": [
                "titan-body"
              ],
              "property": "scale",
              "from": 0.82,
              "to": 0.98,
              "startFrame": 1853,
              "durationFrames": 213,
              "easing": "expoIn",
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "sat-fade-out",
              "targets": [
                "saturn-body",
                "titan-body"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1991,
              "durationFrames": 72
            },
            {
              "clipId": "rings-draw",
              "targets": [
                "sat-ring-back-outer",
                "sat-ring-back-mid",
                "sat-ring-back-inner",
                "sat-ring-front-outer",
                "sat-ring-front-mid",
                "sat-ring-front-inner"
              ],
              "property": "drawOn",
              "from": 0,
              "to": 1,
              "startFrame": 1661,
              "durationFrames": 91,
              "easing": "linear",
              "staggerFrames": 16
            },
            {
              "clipId": "haze-found",
              "targets": [
                "titan-haze",
                "titan-haze-ring"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1777,
              "durationFrames": 48
            },
            {
              "clipId": "haze-swell",
              "targets": [
                "titan-haze-ring"
              ],
              "property": "scale",
              "from": 1,
              "to": 1.55,
              "startFrame": 1768,
              "durationFrames": 115,
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "haze-fade",
              "targets": [
                "titan-haze",
                "titan-haze-ring"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0.35,
              "startFrame": 1894,
              "durationFrames": 75
            }
          ]
        }
      },
      {
        "assetId": "survey",
        "svgSource": "videos/still-talking/visuals/survey.svg",
        "layer": 7,
        "position": {
          "x": 1000,
          "y": 850
        },
        "scale": 1,
        "rotation": 0,
        "opacity": 1,
        "animation": {
          "timelineId": "survey-of-home",
          "clips": [
            {
              "clipId": "survey-in",
              "targets": [
                "survey-body"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 2365,
              "durationFrames": 55
            },
            {
              "clipId": "survey-settle",
              "targets": [
                "survey-body"
              ],
              "property": "scale",
              "from": 1.18,
              "to": 1.35,
              "startFrame": 2365,
              "durationFrames": 76,
              "origin": {
                "x": 100.5,
                "y": 25.5
              }
            },
            {
              "clipId": "survey-dive",
              "targets": [
                "survey-body"
              ],
              "property": "scale",
              "from": 1.35,
              "to": 5,
              "startFrame": 2528,
              "durationFrames": 155,
              "easing": "expoIn",
              "origin": {
                "x": 100.5,
                "y": 25.5
              }
            },
            {
              "clipId": "survey-out",
              "targets": [
                "survey-body"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 2542,
              "durationFrames": 127
            },
            {
              "clipId": "plates-taken",
              "targets": [
                "survey-cell-0",
                "survey-cell-1",
                "survey-cell-2",
                "survey-cell-3",
                "survey-cell-4",
                "survey-cell-5",
                "survey-cell-6",
                "survey-cell-7",
                "survey-cell-8",
                "survey-cell-9",
                "survey-cell-10",
                "survey-cell-11",
                "survey-cell-12",
                "survey-cell-13",
                "survey-cell-14",
                "survey-cell-15",
                "survey-cell-16",
                "survey-cell-17",
                "survey-cell-18",
                "survey-cell-19",
                "survey-cell-20",
                "survey-cell-21",
                "survey-cell-22",
                "survey-cell-23",
                "survey-cell-24",
                "survey-cell-25",
                "survey-cell-26",
                "survey-cell-27",
                "survey-cell-28",
                "survey-cell-29",
                "survey-cell-30",
                "survey-cell-31",
                "survey-cell-32",
                "survey-cell-33",
                "survey-cell-34",
                "survey-cell-35",
                "survey-cell-36",
                "survey-cell-37",
                "survey-cell-38",
                "survey-cell-39",
                "survey-cell-40",
                "survey-cell-41",
                "survey-cell-42",
                "survey-cell-43",
                "survey-cell-44",
                "survey-cell-45",
                "survey-cell-46",
                "survey-cell-47",
                "survey-cell-48",
                "survey-cell-49",
                "survey-cell-50",
                "survey-cell-51",
                "survey-cell-52",
                "survey-cell-53",
                "survey-cell-54",
                "survey-cell-55",
                "survey-cell-56",
                "survey-cell-57",
                "survey-cell-58",
                "survey-cell-59"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 2374,
              "durationFrames": 14,
              "staggerFrames": 2
            },
            {
              "clipId": "sweep-in",
              "targets": [
                "survey-sweep"
              ],
              "property": "opacity",
              "from": 0,
              "to": 0.85,
              "startFrame": 2371,
              "durationFrames": 26
            },
            {
              "clipId": "sweep-across",
              "targets": [
                "survey-sweep"
              ],
              "property": "translateX",
              "from": 0,
              "to": 690,
              "startFrame": 2374,
              "durationFrames": 123,
              "easing": "linear"
            },
            {
              "clipId": "sweep-out",
              "targets": [
                "survey-sweep"
              ],
              "property": "opacity",
              "from": 0.85,
              "to": 0,
              "startFrame": 2486,
              "durationFrames": 31
            },
            {
              "clipId": "mark-found",
              "targets": [
                "survey-mark"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 2508,
              "durationFrames": 41
            },
            {
              "clipId": "mark-out",
              "targets": [
                "survey-mark"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 2597,
              "durationFrames": 72
            }
          ]
        }
      },
      {
        "assetId": "plate",
        "svgSource": "videos/still-talking/visuals/plate.svg",
        "layer": 8,
        "position": {
          "x": 1000,
          "y": 850
        },
        "scale": 1,
        "rotation": 0,
        "opacity": 1,
        "animation": {
          "timelineId": "pale-blue-dot",
          "clips": [
            {
              "clipId": "plate-in",
              "targets": [
                "plate-body"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 2528,
              "durationFrames": 97
            },
            {
              "clipId": "plate-open",
              "targets": [
                "plate-body"
              ],
              "property": "scale",
              "from": 0.45,
              "to": 1.3,
              "startFrame": 2528,
              "durationFrames": 155,
              "origin": {
                "x": 96,
                "y": -46
              }
            },
            {
              "clipId": "plate-hold",
              "targets": [
                "plate-body"
              ],
              "property": "scale",
              "from": 1.3,
              "to": 1.6,
              "startFrame": 2687,
              "durationFrames": 273,
              "easing": "linear",
              "origin": {
                "x": 96,
                "y": -46
              }
            },
            {
              "clipId": "plate-out",
              "targets": [
                "plate-body"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 2972,
              "durationFrames": 82
            },
            {
              "clipId": "reticle-in",
              "targets": [
                "reticle"
              ],
              "property": "opacity",
              "from": 0,
              "to": 0.95,
              "startFrame": 2571,
              "durationFrames": 54
            },
            {
              "clipId": "reticle-close",
              "targets": [
                "reticle"
              ],
              "property": "scale",
              "from": 2.7,
              "to": 1,
              "startFrame": 2571,
              "durationFrames": 109,
              "origin": {
                "x": 96,
                "y": -46
              }
            },
            {
              "clipId": "reticle-release",
              "targets": [
                "reticle"
              ],
              "property": "scale",
              "from": 1,
              "to": 2.3,
              "startFrame": 2937,
              "durationFrames": 61,
              "origin": {
                "x": 96,
                "y": -46
              }
            },
            {
              "clipId": "reticle-out",
              "targets": [
                "reticle"
              ],
              "property": "opacity",
              "from": 0.95,
              "to": 0,
              "startFrame": 2937,
              "durationFrames": 53
            },
            {
              "clipId": "speck-settle",
              "targets": [
                "speck"
              ],
              "property": "scale",
              "from": 0.55,
              "to": 1.25,
              "startFrame": 2597,
              "durationFrames": 79,
              "origin": {
                "x": 96,
                "y": -46
              }
            },
            {
              "clipId": "speck-rest",
              "targets": [
                "speck"
              ],
              "property": "scale",
              "from": 1.25,
              "to": 1,
              "startFrame": 2687,
              "durationFrames": 99,
              "origin": {
                "x": 96,
                "y": -46
              }
            },
            {
              "clipId": "halo-ping-1",
              "targets": [
                "speck-halo"
              ],
              "property": "scale",
              "from": 1,
              "to": 2.8,
              "startFrame": 2702,
              "durationFrames": 99,
              "origin": {
                "x": 96,
                "y": -46
              }
            },
            {
              "clipId": "halo-ping-1-fade",
              "targets": [
                "speck-halo"
              ],
              "property": "opacity",
              "from": 0.85,
              "to": 0,
              "startFrame": 2702,
              "durationFrames": 99
            },
            {
              "clipId": "halo-reset",
              "targets": [
                "speck-halo"
              ],
              "property": "scale",
              "from": 2.8,
              "to": 1,
              "startFrame": 2801,
              "durationFrames": 10,
              "easing": "hold",
              "origin": {
                "x": 96,
                "y": -46
              }
            },
            {
              "clipId": "halo-reset-fade",
              "targets": [
                "speck-halo"
              ],
              "property": "opacity",
              "from": 0,
              "to": 0.85,
              "startFrame": 2801,
              "durationFrames": 10,
              "easing": "hold"
            },
            {
              "clipId": "halo-ping-2",
              "targets": [
                "speck-halo"
              ],
              "property": "scale",
              "from": 1,
              "to": 2.8,
              "startFrame": 2811,
              "durationFrames": 111,
              "origin": {
                "x": 96,
                "y": -46
              }
            },
            {
              "clipId": "halo-ping-2-fade",
              "targets": [
                "speck-halo"
              ],
              "property": "opacity",
              "from": 0.85,
              "to": 0,
              "startFrame": 2811,
              "durationFrames": 111
            },
            {
              "clipId": "beam-drift",
              "targets": [
                "beam-wide"
              ],
              "property": "translateX",
              "from": 0,
              "to": -30,
              "startFrame": 2542,
              "durationFrames": 507,
              "easing": "linear"
            },
            {
              "clipId": "beam-narrow-drift",
              "targets": [
                "beam-narrow"
              ],
              "property": "translateX",
              "from": 0,
              "to": 22,
              "startFrame": 2542,
              "durationFrames": 507,
              "easing": "linear"
            },
            {
              "clipId": "scanlines-settle",
              "targets": [
                "plate-scanlines"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0.32,
              "startFrame": 2551,
              "durationFrames": 210
            }
          ]
        }
      },
      {
        "assetId": "sun",
        "svgSource": "videos/still-talking/visuals/sun.svg",
        "layer": 9,
        "position": {
          "x": 470,
          "y": 1285
        },
        "scale": 1,
        "rotation": 0,
        "opacity": 1,
        "animation": {
          "timelineId": "sun-recedes",
          "clips": [
            {
              "clipId": "sun-shrink-1",
              "targets": [
                "sun-body"
              ],
              "property": "scale",
              "from": 1,
              "to": 0.62,
              "startFrame": 1098,
              "durationFrames": 227,
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "sun-shrink-2",
              "targets": [
                "sun-body"
              ],
              "property": "scale",
              "from": 0.62,
              "to": 0.4,
              "startFrame": 1641,
              "durationFrames": 221,
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "sun-shrink-3",
              "targets": [
                "sun-body"
              ],
              "property": "scale",
              "from": 0.4,
              "to": 0.26,
              "startFrame": 2161,
              "durationFrames": 244,
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "sun-shrink-4",
              "targets": [
                "sun-body"
              ],
              "property": "scale",
              "from": 0.26,
              "to": 0.15,
              "startFrame": 3062,
              "durationFrames": 389,
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "sun-becomes-a-star",
              "targets": [
                "sun-body"
              ],
              "property": "scale",
              "from": 0.15,
              "to": 0.1,
              "startFrame": 3986,
              "durationFrames": 359,
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "rays-fade",
              "targets": [
                "sun-rays"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1098,
              "durationFrames": 334
            },
            {
              "clipId": "halo-thin-1",
              "targets": [
                "sun-halo"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0.5,
              "startFrame": 1098,
              "durationFrames": 334
            },
            {
              "clipId": "halo-thin-2",
              "targets": [
                "sun-halo"
              ],
              "property": "opacity",
              "from": 0.5,
              "to": 0.2,
              "startFrame": 2161,
              "durationFrames": 287
            },
            {
              "clipId": "halo-gone",
              "targets": [
                "sun-halo"
              ],
              "property": "opacity",
              "from": 0.2,
              "to": 0,
              "startFrame": 3062,
              "durationFrames": 437
            },
            {
              "clipId": "corona-thin",
              "targets": [
                "sun-corona"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0.3,
              "startFrame": 1641,
              "durationFrames": 456
            },
            {
              "clipId": "corona-gone",
              "targets": [
                "sun-corona"
              ],
              "property": "opacity",
              "from": 0.3,
              "to": 0,
              "startFrame": 3062,
              "durationFrames": 261
            }
          ]
        }
      },
      {
        "assetId": "probe",
        "svgSource": "videos/still-talking/visuals/probe.svg",
        "layer": 10,
        "position": {
          "x": 1130,
          "y": 1210
        },
        "scale": 1,
        "rotation": 0,
        "opacity": 1,
        "animation": {
          "timelineId": "voyager",
          "clips": [
            {
              "clipId": "frame-open",
              "targets": [
                "probe-body"
              ],
              "property": "scale",
              "from": 0.46,
              "to": 0.52,
              "startFrame": 0,
              "durationFrames": 150,
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "frame-one-job",
              "targets": [
                "probe-body"
              ],
              "property": "scale",
              "from": 0.52,
              "to": 1.3,
              "startFrame": 307,
              "durationFrames": 143,
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "frame-record-push",
              "targets": [
                "probe-body"
              ],
              "property": "scale",
              "from": 1.3,
              "to": 1.75,
              "startFrame": 626,
              "durationFrames": 144,
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "frame-let-go",
              "targets": [
                "probe-body"
              ],
              "property": "scale",
              "from": 1.75,
              "to": 0.7,
              "startFrame": 1050,
              "durationFrames": 136,
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "frame-jupiter",
              "targets": [
                "probe-body"
              ],
              "property": "scale",
              "from": 0.7,
              "to": 0.62,
              "startFrame": 1274,
              "durationFrames": 158,
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "frame-slingshot",
              "targets": [
                "probe-body"
              ],
              "property": "scale",
              "from": 0.62,
              "to": 0.8,
              "startFrame": 1485,
              "durationFrames": 115,
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "frame-saturn",
              "targets": [
                "probe-body"
              ],
              "property": "scale",
              "from": 0.8,
              "to": 0.6,
              "startFrame": 1641,
              "durationFrames": 139,
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "frame-turn",
              "targets": [
                "probe-body"
              ],
              "property": "scale",
              "from": 0.6,
              "to": 0.9,
              "startFrame": 2161,
              "durationFrames": 157,
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "frame-survey",
              "targets": [
                "probe-body"
              ],
              "property": "scale",
              "from": 0.9,
              "to": 0.5,
              "startFrame": 2362,
              "durationFrames": 130,
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "frame-edge",
              "targets": [
                "probe-body"
              ],
              "property": "scale",
              "from": 0.5,
              "to": 0.64,
              "startFrame": 3062,
              "durationFrames": 129,
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "frame-close",
              "targets": [
                "probe-body"
              ],
              "property": "scale",
              "from": 0.64,
              "to": 0.88,
              "startFrame": 3564,
              "durationFrames": 160,
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "frame-dark",
              "targets": [
                "probe-body"
              ],
              "property": "scale",
              "from": 0.88,
              "to": 0.78,
              "startFrame": 3986,
              "durationFrames": 167,
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "frame-away",
              "targets": [
                "probe-body"
              ],
              "property": "scale",
              "from": 0.78,
              "to": 0.72,
              "startFrame": 4328,
              "durationFrames": 293,
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "float-1",
              "targets": [
                "probe-body"
              ],
              "property": "translateY",
              "from": 0,
              "to": -18,
              "startFrame": 307,
              "durationFrames": 223
            },
            {
              "clipId": "float-2",
              "targets": [
                "probe-body"
              ],
              "property": "translateY",
              "from": -18,
              "to": -46,
              "startFrame": 626,
              "durationFrames": 254
            },
            {
              "clipId": "float-3",
              "targets": [
                "probe-body"
              ],
              "property": "translateY",
              "from": -46,
              "to": 8,
              "startFrame": 1050,
              "durationFrames": 287
            },
            {
              "clipId": "float-4",
              "targets": [
                "probe-body"
              ],
              "property": "translateY",
              "from": 8,
              "to": -28,
              "startFrame": 1485,
              "durationFrames": 148
            },
            {
              "clipId": "climb-out-of-plane",
              "targets": [
                "probe-body"
              ],
              "property": "translateY",
              "from": -28,
              "to": -98,
              "startFrame": 1840,
              "durationFrames": 215,
              "easing": "expoOut"
            },
            {
              "clipId": "float-5",
              "targets": [
                "probe-body"
              ],
              "property": "translateY",
              "from": -98,
              "to": -72,
              "startFrame": 2161,
              "durationFrames": 259
            },
            {
              "clipId": "drop-below-the-plate",
              "targets": [
                "probe-body"
              ],
              "property": "translateY",
              "from": -72,
              "to": 34,
              "startFrame": 2506,
              "durationFrames": 109
            },
            {
              "clipId": "float-6",
              "targets": [
                "probe-body"
              ],
              "property": "translateY",
              "from": 34,
              "to": -92,
              "startFrame": 3062,
              "durationFrames": 261
            },
            {
              "clipId": "float-7",
              "targets": [
                "probe-body"
              ],
              "property": "translateY",
              "from": -92,
              "to": -66,
              "startFrame": 3564,
              "durationFrames": 319
            },
            {
              "clipId": "float-8",
              "targets": [
                "probe-body"
              ],
              "property": "translateY",
              "from": -66,
              "to": -18,
              "startFrame": 4328,
              "durationFrames": 293
            },
            {
              "clipId": "whip-out",
              "targets": [
                "probe-body"
              ],
              "property": "translateX",
              "from": 0,
              "to": 108,
              "startFrame": 1485,
              "durationFrames": 87,
              "easing": "expoIn"
            },
            {
              "clipId": "whip-settle",
              "targets": [
                "probe-body"
              ],
              "property": "translateX",
              "from": 108,
              "to": 0,
              "startFrame": 1572,
              "durationFrames": 129,
              "easing": "expoOut"
            },
            {
              "clipId": "keep-going-drift",
              "targets": [
                "probe-body"
              ],
              "property": "translateX",
              "from": 0,
              "to": 236,
              "startFrame": 4328,
              "durationFrames": 293,
              "easing": "linear"
            },
            {
              "clipId": "tilt-out-of-plane",
              "targets": [
                "probe-body"
              ],
              "property": "rotate",
              "from": 0,
              "to": -7,
              "startFrame": 1840,
              "durationFrames": 215,
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "tilt-away",
              "targets": [
                "probe-body"
              ],
              "property": "rotate",
              "from": -7,
              "to": -11,
              "startFrame": 4328,
              "durationFrames": 293,
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "boom-sci-deploy",
              "targets": [
                "probe-boom-sci"
              ],
              "property": "rotate",
              "from": -46,
              "to": 0,
              "startFrame": 323,
              "durationFrames": 127,
              "origin": {
                "x": 26,
                "y": 6
              }
            },
            {
              "clipId": "boom-mag-deploy",
              "targets": [
                "probe-boom-mag"
              ],
              "property": "rotate",
              "from": 54,
              "to": 0,
              "startFrame": 345,
              "durationFrames": 134,
              "origin": {
                "x": 18,
                "y": -14
              }
            },
            {
              "clipId": "boom-rtg-deploy",
              "targets": [
                "probe-rtg"
              ],
              "property": "rotate",
              "from": -58,
              "to": 0,
              "startFrame": 371,
              "durationFrames": 133,
              "origin": {
                "x": 6,
                "y": 14
              }
            },
            {
              "clipId": "lamps-live",
              "targets": [
                "lamp-sci-1",
                "lamp-sci-2",
                "lamp-sci-3",
                "lamp-mag-1"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 402,
              "durationFrames": 35,
              "staggerFrames": 14
            },
            {
              "clipId": "radio-live",
              "targets": [
                "lamp-radio"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 393,
              "durationFrames": 38
            },
            {
              "clipId": "rtg-live",
              "targets": [
                "rtg-glow"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 418,
              "durationFrames": 64
            },
            {
              "clipId": "boom-sci-turn",
              "targets": [
                "probe-boom-sci"
              ],
              "property": "rotate",
              "from": 0,
              "to": 166,
              "startFrame": 2278,
              "durationFrames": 68,
              "easing": "expoInOut",
              "origin": {
                "x": 26,
                "y": 6
              }
            },
            {
              "clipId": "boom-sci-return",
              "targets": [
                "probe-boom-sci"
              ],
              "property": "rotate",
              "from": 166,
              "to": 0,
              "startFrame": 2954,
              "durationFrames": 98,
              "easing": "expoInOut",
              "origin": {
                "x": 26,
                "y": 6
              }
            },
            {
              "clipId": "shutter-1",
              "targets": [
                "lamp-sci-1",
                "lamp-sci-2",
                "lamp-sci-3"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0.25,
              "startFrame": 2376,
              "durationFrames": 15,
              "staggerFrames": 9
            },
            {
              "clipId": "shutter-2",
              "targets": [
                "lamp-sci-1",
                "lamp-sci-2",
                "lamp-sci-3"
              ],
              "property": "opacity",
              "from": 0.25,
              "to": 1,
              "startFrame": 2405,
              "durationFrames": 17,
              "staggerFrames": 9
            },
            {
              "clipId": "cameras-off",
              "targets": [
                "lamp-sci-1",
                "lamp-sci-2",
                "lamp-sci-3"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 2960,
              "durationFrames": 33,
              "staggerFrames": 22
            },
            {
              "clipId": "thread-reaches",
              "targets": [
                "signal-thread"
              ],
              "property": "drawOn",
              "from": 0,
              "to": 1,
              "startFrame": 24,
              "durationFrames": 126,
              "easing": "linear"
            },
            {
              "clipId": "thread-thins",
              "targets": [
                "signal-thread"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0.62,
              "startFrame": 3641,
              "durationFrames": 311
            },
            {
              "clipId": "thread-stops-short",
              "targets": [
                "signal-thread"
              ],
              "property": "drawOn",
              "from": 1,
              "to": 0.3,
              "startFrame": 4196,
              "durationFrames": 123,
              "easing": "expoOut"
            },
            {
              "clipId": "thread-gone",
              "targets": [
                "signal-thread"
              ],
              "property": "opacity",
              "from": 0.62,
              "to": 0,
              "startFrame": 4331,
              "durationFrames": 65
            },
            {
              "clipId": "mag-off",
              "targets": [
                "lamp-mag-1"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 4055,
              "durationFrames": 31
            },
            {
              "clipId": "rtg-cools",
              "targets": [
                "rtg-glow"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 4086,
              "durationFrames": 69
            },
            {
              "clipId": "rtg-dims",
              "targets": [
                "rtg-1",
                "rtg-2",
                "rtg-3"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0.3,
              "startFrame": 4086,
              "durationFrames": 25,
              "staggerFrames": 12
            },
            {
              "clipId": "radio-last",
              "targets": [
                "lamp-radio"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 4187,
              "durationFrames": 135
            },
            {
              "clipId": "record-swells",
              "targets": [
                "probe-record"
              ],
              "property": "scale",
              "from": 1,
              "to": 1.6,
              "startFrame": 4497,
              "durationFrames": 124,
              "origin": {
                "x": 22,
                "y": 24
              }
            },
            {
              "clipId": "glint-dim",
              "targets": [
                "record-glint"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0.2,
              "startFrame": 4328,
              "durationFrames": 194
            },
            {
              "clipId": "glint-catches",
              "targets": [
                "record-glint"
              ],
              "property": "opacity",
              "from": 0.2,
              "to": 1,
              "startFrame": 4522,
              "durationFrames": 99
            },
            {
              "clipId": "pulse-1-x",
              "targets": [
                "signal-pulse-1",
                "signal-pulse-2",
                "signal-pulse-3"
              ],
              "property": "translateX",
              "from": 0,
              "to": -666,
              "startFrame": 40,
              "durationFrames": 130,
              "easing": "linear",
              "staggerFrames": 34
            },
            {
              "clipId": "pulse-1-y",
              "targets": [
                "signal-pulse-1",
                "signal-pulse-2",
                "signal-pulse-3"
              ],
              "property": "translateY",
              "from": 0,
              "to": 78,
              "startFrame": 40,
              "durationFrames": 130,
              "easing": "linear",
              "staggerFrames": 34
            },
            {
              "clipId": "pulse-1-fade",
              "targets": [
                "signal-pulse-1",
                "signal-pulse-2",
                "signal-pulse-3"
              ],
              "property": "opacity",
              "from": 0.95,
              "to": 0,
              "startFrame": 40,
              "durationFrames": 130,
              "easing": "expoIn",
              "staggerFrames": 34
            },
            {
              "clipId": "pulse-2-x",
              "targets": [
                "signal-pulse-1",
                "signal-pulse-2",
                "signal-pulse-3"
              ],
              "property": "translateX",
              "from": 0,
              "to": -666,
              "startFrame": 240,
              "durationFrames": 130,
              "easing": "linear",
              "staggerFrames": 34
            },
            {
              "clipId": "pulse-2-y",
              "targets": [
                "signal-pulse-1",
                "signal-pulse-2",
                "signal-pulse-3"
              ],
              "property": "translateY",
              "from": 0,
              "to": 78,
              "startFrame": 240,
              "durationFrames": 130,
              "easing": "linear",
              "staggerFrames": 34
            },
            {
              "clipId": "pulse-2-fade",
              "targets": [
                "signal-pulse-1",
                "signal-pulse-2",
                "signal-pulse-3"
              ],
              "property": "opacity",
              "from": 0.95,
              "to": 0,
              "startFrame": 240,
              "durationFrames": 130,
              "easing": "expoIn",
              "staggerFrames": 34
            },
            {
              "clipId": "pulse-3-x",
              "targets": [
                "signal-pulse-1",
                "signal-pulse-2",
                "signal-pulse-3"
              ],
              "property": "translateX",
              "from": 0,
              "to": -666,
              "startFrame": 440,
              "durationFrames": 130,
              "easing": "linear",
              "staggerFrames": 34
            },
            {
              "clipId": "pulse-3-y",
              "targets": [
                "signal-pulse-1",
                "signal-pulse-2",
                "signal-pulse-3"
              ],
              "property": "translateY",
              "from": 0,
              "to": 78,
              "startFrame": 440,
              "durationFrames": 130,
              "easing": "linear",
              "staggerFrames": 34
            },
            {
              "clipId": "pulse-3-fade",
              "targets": [
                "signal-pulse-1",
                "signal-pulse-2",
                "signal-pulse-3"
              ],
              "property": "opacity",
              "from": 0.95,
              "to": 0,
              "startFrame": 440,
              "durationFrames": 130,
              "easing": "expoIn",
              "staggerFrames": 34
            },
            {
              "clipId": "pulse-4-x",
              "targets": [
                "signal-pulse-1",
                "signal-pulse-2",
                "signal-pulse-3"
              ],
              "property": "translateX",
              "from": 0,
              "to": -666,
              "startFrame": 640,
              "durationFrames": 130,
              "easing": "linear",
              "staggerFrames": 34
            },
            {
              "clipId": "pulse-4-y",
              "targets": [
                "signal-pulse-1",
                "signal-pulse-2",
                "signal-pulse-3"
              ],
              "property": "translateY",
              "from": 0,
              "to": 78,
              "startFrame": 640,
              "durationFrames": 130,
              "easing": "linear",
              "staggerFrames": 34
            },
            {
              "clipId": "pulse-4-fade",
              "targets": [
                "signal-pulse-1",
                "signal-pulse-2",
                "signal-pulse-3"
              ],
              "property": "opacity",
              "from": 0.95,
              "to": 0,
              "startFrame": 640,
              "durationFrames": 130,
              "easing": "expoIn",
              "staggerFrames": 34
            },
            {
              "clipId": "pulse-5-x",
              "targets": [
                "signal-pulse-1",
                "signal-pulse-2",
                "signal-pulse-3"
              ],
              "property": "translateX",
              "from": 0,
              "to": -666,
              "startFrame": 840,
              "durationFrames": 130,
              "easing": "linear",
              "staggerFrames": 34
            },
            {
              "clipId": "pulse-5-y",
              "targets": [
                "signal-pulse-1",
                "signal-pulse-2",
                "signal-pulse-3"
              ],
              "property": "translateY",
              "from": 0,
              "to": 78,
              "startFrame": 840,
              "durationFrames": 130,
              "easing": "linear",
              "staggerFrames": 34
            },
            {
              "clipId": "pulse-5-fade",
              "targets": [
                "signal-pulse-1",
                "signal-pulse-2",
                "signal-pulse-3"
              ],
              "property": "opacity",
              "from": 0.95,
              "to": 0,
              "startFrame": 840,
              "durationFrames": 130,
              "easing": "expoIn",
              "staggerFrames": 34
            },
            {
              "clipId": "pulse-6-x",
              "targets": [
                "signal-pulse-1",
                "signal-pulse-2",
                "signal-pulse-3"
              ],
              "property": "translateX",
              "from": 0,
              "to": -666,
              "startFrame": 1040,
              "durationFrames": 130,
              "easing": "linear",
              "staggerFrames": 34
            },
            {
              "clipId": "pulse-6-y",
              "targets": [
                "signal-pulse-1",
                "signal-pulse-2",
                "signal-pulse-3"
              ],
              "property": "translateY",
              "from": 0,
              "to": 78,
              "startFrame": 1040,
              "durationFrames": 130,
              "easing": "linear",
              "staggerFrames": 34
            },
            {
              "clipId": "pulse-6-fade",
              "targets": [
                "signal-pulse-1",
                "signal-pulse-2",
                "signal-pulse-3"
              ],
              "property": "opacity",
              "from": 0.95,
              "to": 0,
              "startFrame": 1040,
              "durationFrames": 130,
              "easing": "expoIn",
              "staggerFrames": 34
            },
            {
              "clipId": "pulse-7-x",
              "targets": [
                "signal-pulse-1",
                "signal-pulse-2",
                "signal-pulse-3"
              ],
              "property": "translateX",
              "from": 0,
              "to": -666,
              "startFrame": 1240,
              "durationFrames": 130,
              "easing": "linear",
              "staggerFrames": 34
            },
            {
              "clipId": "pulse-7-y",
              "targets": [
                "signal-pulse-1",
                "signal-pulse-2",
                "signal-pulse-3"
              ],
              "property": "translateY",
              "from": 0,
              "to": 78,
              "startFrame": 1240,
              "durationFrames": 130,
              "easing": "linear",
              "staggerFrames": 34
            },
            {
              "clipId": "pulse-7-fade",
              "targets": [
                "signal-pulse-1",
                "signal-pulse-2",
                "signal-pulse-3"
              ],
              "property": "opacity",
              "from": 0.95,
              "to": 0,
              "startFrame": 1240,
              "durationFrames": 130,
              "easing": "expoIn",
              "staggerFrames": 34
            },
            {
              "clipId": "pulse-8-x",
              "targets": [
                "signal-pulse-1",
                "signal-pulse-2",
                "signal-pulse-3"
              ],
              "property": "translateX",
              "from": 0,
              "to": -666,
              "startFrame": 1440,
              "durationFrames": 130,
              "easing": "linear",
              "staggerFrames": 34
            },
            {
              "clipId": "pulse-8-y",
              "targets": [
                "signal-pulse-1",
                "signal-pulse-2",
                "signal-pulse-3"
              ],
              "property": "translateY",
              "from": 0,
              "to": 78,
              "startFrame": 1440,
              "durationFrames": 130,
              "easing": "linear",
              "staggerFrames": 34
            },
            {
              "clipId": "pulse-8-fade",
              "targets": [
                "signal-pulse-1",
                "signal-pulse-2",
                "signal-pulse-3"
              ],
              "property": "opacity",
              "from": 0.95,
              "to": 0,
              "startFrame": 1440,
              "durationFrames": 130,
              "easing": "expoIn",
              "staggerFrames": 34
            },
            {
              "clipId": "pulse-9-x",
              "targets": [
                "signal-pulse-1",
                "signal-pulse-2",
                "signal-pulse-3"
              ],
              "property": "translateX",
              "from": 0,
              "to": -666,
              "startFrame": 1640,
              "durationFrames": 130,
              "easing": "linear",
              "staggerFrames": 34
            },
            {
              "clipId": "pulse-9-y",
              "targets": [
                "signal-pulse-1",
                "signal-pulse-2",
                "signal-pulse-3"
              ],
              "property": "translateY",
              "from": 0,
              "to": 78,
              "startFrame": 1640,
              "durationFrames": 130,
              "easing": "linear",
              "staggerFrames": 34
            },
            {
              "clipId": "pulse-9-fade",
              "targets": [
                "signal-pulse-1",
                "signal-pulse-2",
                "signal-pulse-3"
              ],
              "property": "opacity",
              "from": 0.95,
              "to": 0,
              "startFrame": 1640,
              "durationFrames": 130,
              "easing": "expoIn",
              "staggerFrames": 34
            },
            {
              "clipId": "pulse-10-x",
              "targets": [
                "signal-pulse-1",
                "signal-pulse-2",
                "signal-pulse-3"
              ],
              "property": "translateX",
              "from": 0,
              "to": -666,
              "startFrame": 1840,
              "durationFrames": 130,
              "easing": "linear",
              "staggerFrames": 34
            },
            {
              "clipId": "pulse-10-y",
              "targets": [
                "signal-pulse-1",
                "signal-pulse-2",
                "signal-pulse-3"
              ],
              "property": "translateY",
              "from": 0,
              "to": 78,
              "startFrame": 1840,
              "durationFrames": 130,
              "easing": "linear",
              "staggerFrames": 34
            },
            {
              "clipId": "pulse-10-fade",
              "targets": [
                "signal-pulse-1",
                "signal-pulse-2",
                "signal-pulse-3"
              ],
              "property": "opacity",
              "from": 0.95,
              "to": 0,
              "startFrame": 1840,
              "durationFrames": 130,
              "easing": "expoIn",
              "staggerFrames": 34
            },
            {
              "clipId": "pulse-11-x",
              "targets": [
                "signal-pulse-1",
                "signal-pulse-2",
                "signal-pulse-3"
              ],
              "property": "translateX",
              "from": 0,
              "to": -666,
              "startFrame": 2040,
              "durationFrames": 130,
              "easing": "linear",
              "staggerFrames": 34
            },
            {
              "clipId": "pulse-11-y",
              "targets": [
                "signal-pulse-1",
                "signal-pulse-2",
                "signal-pulse-3"
              ],
              "property": "translateY",
              "from": 0,
              "to": 78,
              "startFrame": 2040,
              "durationFrames": 130,
              "easing": "linear",
              "staggerFrames": 34
            },
            {
              "clipId": "pulse-11-fade",
              "targets": [
                "signal-pulse-1",
                "signal-pulse-2",
                "signal-pulse-3"
              ],
              "property": "opacity",
              "from": 0.95,
              "to": 0,
              "startFrame": 2040,
              "durationFrames": 130,
              "easing": "expoIn",
              "staggerFrames": 34
            },
            {
              "clipId": "pulse-12-x",
              "targets": [
                "signal-pulse-1",
                "signal-pulse-2",
                "signal-pulse-3"
              ],
              "property": "translateX",
              "from": 0,
              "to": -666,
              "startFrame": 2240,
              "durationFrames": 130,
              "easing": "linear",
              "staggerFrames": 34
            },
            {
              "clipId": "pulse-12-y",
              "targets": [
                "signal-pulse-1",
                "signal-pulse-2",
                "signal-pulse-3"
              ],
              "property": "translateY",
              "from": 0,
              "to": 78,
              "startFrame": 2240,
              "durationFrames": 130,
              "easing": "linear",
              "staggerFrames": 34
            },
            {
              "clipId": "pulse-12-fade",
              "targets": [
                "signal-pulse-1",
                "signal-pulse-2",
                "signal-pulse-3"
              ],
              "property": "opacity",
              "from": 0.95,
              "to": 0,
              "startFrame": 2240,
              "durationFrames": 130,
              "easing": "expoIn",
              "staggerFrames": 34
            },
            {
              "clipId": "pulse-13-x",
              "targets": [
                "signal-pulse-1",
                "signal-pulse-2",
                "signal-pulse-3"
              ],
              "property": "translateX",
              "from": 0,
              "to": -666,
              "startFrame": 2440,
              "durationFrames": 130,
              "easing": "linear",
              "staggerFrames": 34
            },
            {
              "clipId": "pulse-13-y",
              "targets": [
                "signal-pulse-1",
                "signal-pulse-2",
                "signal-pulse-3"
              ],
              "property": "translateY",
              "from": 0,
              "to": 78,
              "startFrame": 2440,
              "durationFrames": 130,
              "easing": "linear",
              "staggerFrames": 34
            },
            {
              "clipId": "pulse-13-fade",
              "targets": [
                "signal-pulse-1",
                "signal-pulse-2",
                "signal-pulse-3"
              ],
              "property": "opacity",
              "from": 0.95,
              "to": 0,
              "startFrame": 2440,
              "durationFrames": 130,
              "easing": "expoIn",
              "staggerFrames": 34
            },
            {
              "clipId": "pulse-14-x",
              "targets": [
                "signal-pulse-1",
                "signal-pulse-2",
                "signal-pulse-3"
              ],
              "property": "translateX",
              "from": 0,
              "to": -666,
              "startFrame": 2640,
              "durationFrames": 130,
              "easing": "linear",
              "staggerFrames": 34
            },
            {
              "clipId": "pulse-14-y",
              "targets": [
                "signal-pulse-1",
                "signal-pulse-2",
                "signal-pulse-3"
              ],
              "property": "translateY",
              "from": 0,
              "to": 78,
              "startFrame": 2640,
              "durationFrames": 130,
              "easing": "linear",
              "staggerFrames": 34
            },
            {
              "clipId": "pulse-14-fade",
              "targets": [
                "signal-pulse-1",
                "signal-pulse-2",
                "signal-pulse-3"
              ],
              "property": "opacity",
              "from": 0.95,
              "to": 0,
              "startFrame": 2640,
              "durationFrames": 130,
              "easing": "expoIn",
              "staggerFrames": 34
            },
            {
              "clipId": "pulse-15-x",
              "targets": [
                "signal-pulse-1",
                "signal-pulse-2",
                "signal-pulse-3"
              ],
              "property": "translateX",
              "from": 0,
              "to": -666,
              "startFrame": 2840,
              "durationFrames": 130,
              "easing": "linear",
              "staggerFrames": 34
            },
            {
              "clipId": "pulse-15-y",
              "targets": [
                "signal-pulse-1",
                "signal-pulse-2",
                "signal-pulse-3"
              ],
              "property": "translateY",
              "from": 0,
              "to": 78,
              "startFrame": 2840,
              "durationFrames": 130,
              "easing": "linear",
              "staggerFrames": 34
            },
            {
              "clipId": "pulse-15-fade",
              "targets": [
                "signal-pulse-1",
                "signal-pulse-2",
                "signal-pulse-3"
              ],
              "property": "opacity",
              "from": 0.95,
              "to": 0,
              "startFrame": 2840,
              "durationFrames": 130,
              "easing": "expoIn",
              "staggerFrames": 34
            },
            {
              "clipId": "pulse-16-x",
              "targets": [
                "signal-pulse-1",
                "signal-pulse-2",
                "signal-pulse-3"
              ],
              "property": "translateX",
              "from": 0,
              "to": -666,
              "startFrame": 3040,
              "durationFrames": 130,
              "easing": "linear",
              "staggerFrames": 34
            },
            {
              "clipId": "pulse-16-y",
              "targets": [
                "signal-pulse-1",
                "signal-pulse-2",
                "signal-pulse-3"
              ],
              "property": "translateY",
              "from": 0,
              "to": 78,
              "startFrame": 3040,
              "durationFrames": 130,
              "easing": "linear",
              "staggerFrames": 34
            },
            {
              "clipId": "pulse-16-fade",
              "targets": [
                "signal-pulse-1",
                "signal-pulse-2",
                "signal-pulse-3"
              ],
              "property": "opacity",
              "from": 0.95,
              "to": 0,
              "startFrame": 3040,
              "durationFrames": 130,
              "easing": "expoIn",
              "staggerFrames": 34
            },
            {
              "clipId": "pulse-17-x",
              "targets": [
                "signal-pulse-1",
                "signal-pulse-2",
                "signal-pulse-3"
              ],
              "property": "translateX",
              "from": 0,
              "to": -666,
              "startFrame": 3240,
              "durationFrames": 130,
              "easing": "linear",
              "staggerFrames": 34
            },
            {
              "clipId": "pulse-17-y",
              "targets": [
                "signal-pulse-1",
                "signal-pulse-2",
                "signal-pulse-3"
              ],
              "property": "translateY",
              "from": 0,
              "to": 78,
              "startFrame": 3240,
              "durationFrames": 130,
              "easing": "linear",
              "staggerFrames": 34
            },
            {
              "clipId": "pulse-17-fade",
              "targets": [
                "signal-pulse-1",
                "signal-pulse-2",
                "signal-pulse-3"
              ],
              "property": "opacity",
              "from": 0.95,
              "to": 0,
              "startFrame": 3240,
              "durationFrames": 130,
              "easing": "expoIn",
              "staggerFrames": 34
            },
            {
              "clipId": "pulse-18-x",
              "targets": [
                "signal-pulse-1",
                "signal-pulse-2",
                "signal-pulse-3"
              ],
              "property": "translateX",
              "from": 0,
              "to": -666,
              "startFrame": 3440,
              "durationFrames": 130,
              "easing": "linear",
              "staggerFrames": 34
            },
            {
              "clipId": "pulse-18-y",
              "targets": [
                "signal-pulse-1",
                "signal-pulse-2",
                "signal-pulse-3"
              ],
              "property": "translateY",
              "from": 0,
              "to": 78,
              "startFrame": 3440,
              "durationFrames": 130,
              "easing": "linear",
              "staggerFrames": 34
            },
            {
              "clipId": "pulse-18-fade",
              "targets": [
                "signal-pulse-1",
                "signal-pulse-2",
                "signal-pulse-3"
              ],
              "property": "opacity",
              "from": 0.95,
              "to": 0,
              "startFrame": 3440,
              "durationFrames": 130,
              "easing": "expoIn",
              "staggerFrames": 34
            },
            {
              "clipId": "solo-pulse-x",
              "targets": [
                "signal-pulse-1"
              ],
              "property": "translateX",
              "from": 0,
              "to": -666,
              "startFrame": 3696,
              "durationFrames": 269,
              "easing": "linear"
            },
            {
              "clipId": "solo-pulse-y",
              "targets": [
                "signal-pulse-1"
              ],
              "property": "translateY",
              "from": 0,
              "to": 78,
              "startFrame": 3696,
              "durationFrames": 269,
              "easing": "linear"
            },
            {
              "clipId": "solo-pulse-fade",
              "targets": [
                "signal-pulse-1"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0.06,
              "startFrame": 3696,
              "durationFrames": 269,
              "easing": "linear"
            },
            {
              "clipId": "solo-pulse-thin",
              "targets": [
                "signal-pulse-1"
              ],
              "property": "scale",
              "from": 1,
              "to": 0.3,
              "startFrame": 3696,
              "durationFrames": 269,
              "easing": "linear",
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "last-pulse-x",
              "targets": [
                "signal-pulse-2"
              ],
              "property": "translateX",
              "from": 0,
              "to": -412.92,
              "startFrame": 4023,
              "durationFrames": 137,
              "easing": "linear"
            },
            {
              "clipId": "last-pulse-y",
              "targets": [
                "signal-pulse-2"
              ],
              "property": "translateY",
              "from": 0,
              "to": 48.36,
              "startFrame": 4023,
              "durationFrames": 137,
              "easing": "linear"
            },
            {
              "clipId": "last-pulse-fade",
              "targets": [
                "signal-pulse-2"
              ],
              "property": "opacity",
              "from": 0.55,
              "to": 0,
              "startFrame": 4023,
              "durationFrames": 137,
              "easing": "linear"
            }
          ]
        }
      },
      {
        "assetId": "record",
        "svgSource": "videos/still-talking/visuals/record.svg",
        "layer": 11,
        "position": {
          "x": 1152,
          "y": 1234
        },
        "scale": 1,
        "rotation": 0,
        "opacity": 1,
        "animation": {
          "timelineId": "golden-record",
          "clips": [
            {
              "clipId": "record-in",
              "targets": [
                "record-body"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 634,
              "durationFrames": 51
            },
            {
              "clipId": "record-open",
              "targets": [
                "record-body"
              ],
              "property": "scale",
              "from": 0.07,
              "to": 2.1,
              "startFrame": 643,
              "durationFrames": 136,
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "record-to-centre-x",
              "targets": [
                "record-body"
              ],
              "property": "translateX",
              "from": 0,
              "to": -152,
              "startFrame": 643,
              "durationFrames": 136,
              "easing": "linear"
            },
            {
              "clipId": "record-to-centre-y",
              "targets": [
                "record-body"
              ],
              "property": "translateY",
              "from": 0,
              "to": -384,
              "startFrame": 643,
              "durationFrames": 136,
              "easing": "linear"
            },
            {
              "clipId": "groove-cut",
              "targets": [
                "rec-groove"
              ],
              "property": "drawOn",
              "from": 0,
              "to": 1,
              "startFrame": 702,
              "durationFrames": 272,
              "easing": "linear"
            },
            {
              "clipId": "record-turn",
              "targets": [
                "record-body"
              ],
              "property": "rotate",
              "from": 0,
              "to": 38,
              "startFrame": 651,
              "durationFrames": 399,
              "easing": "linear",
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "sheen-sweep",
              "targets": [
                "rec-sheen"
              ],
              "property": "translateX",
              "from": -80,
              "to": 280,
              "startFrame": 668,
              "durationFrames": 361,
              "easing": "linear"
            },
            {
              "clipId": "pulsar-in",
              "targets": [
                "rec-pulsar-map"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 863,
              "durationFrames": 43
            },
            {
              "clipId": "pulsar-rays",
              "targets": [
                "pulsar-ray-1",
                "pulsar-ray-2",
                "pulsar-ray-3",
                "pulsar-ray-4",
                "pulsar-ray-5",
                "pulsar-ray-6",
                "pulsar-ray-7",
                "pulsar-ray-8",
                "pulsar-ray-9",
                "pulsar-ray-10",
                "pulsar-ray-11",
                "pulsar-ray-12",
                "pulsar-ray-13",
                "pulsar-ray-14"
              ],
              "property": "drawOn",
              "from": 0,
              "to": 1,
              "startFrame": 872,
              "durationFrames": 42,
              "easing": "linear",
              "staggerFrames": 8
            },
            {
              "clipId": "record-close",
              "targets": [
                "record-body"
              ],
              "property": "scale",
              "from": 2.1,
              "to": 0.07,
              "startFrame": 1050,
              "durationFrames": 101,
              "easing": "expoOut",
              "origin": {
                "x": 0,
                "y": 0
              }
            },
            {
              "clipId": "record-home-x",
              "targets": [
                "record-body"
              ],
              "property": "translateX",
              "from": -152,
              "to": 0,
              "startFrame": 1050,
              "durationFrames": 101,
              "easing": "expoOut"
            },
            {
              "clipId": "record-home-y",
              "targets": [
                "record-body"
              ],
              "property": "translateY",
              "from": -384,
              "to": 0,
              "startFrame": 1050,
              "durationFrames": 101,
              "easing": "expoOut"
            },
            {
              "clipId": "record-out",
              "targets": [
                "record-body"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1050,
              "durationFrames": 87
            }
          ]
        }
      },
      {
        "assetId": "scrim",
        "svgSource": "videos/still-talking/visuals/scrim.svg",
        "layer": 12,
        "position": {
          "x": 960,
          "y": 960
        },
        "scale": 4.8,
        "rotation": 0,
        "opacity": 1,
        "animation": {
          "timelineId": "text-scrim",
          "clips": [
            {
              "clipId": "scrim-up-0",
              "targets": [
                "scrim-fill"
              ],
              "property": "opacity",
              "from": 0,
              "to": 0.44,
              "startFrame": 18,
              "durationFrames": 56
            },
            {
              "clipId": "scrim-down-0",
              "targets": [
                "scrim-fill"
              ],
              "property": "opacity",
              "from": 0.44,
              "to": 0,
              "startFrame": 258,
              "durationFrames": 46
            },
            {
              "clipId": "scrim-up-1",
              "targets": [
                "scrim-fill"
              ],
              "property": "opacity",
              "from": 0,
              "to": 0.34,
              "startFrame": 1278,
              "durationFrames": 47
            },
            {
              "clipId": "scrim-down-1",
              "targets": [
                "scrim-fill"
              ],
              "property": "opacity",
              "from": 0.34,
              "to": 0,
              "startFrame": 1417,
              "durationFrames": 60
            },
            {
              "clipId": "scrim-up-2",
              "targets": [
                "scrim-fill"
              ],
              "property": "opacity",
              "from": 0,
              "to": 0.34,
              "startFrame": 1647,
              "durationFrames": 46
            },
            {
              "clipId": "scrim-down-2",
              "targets": [
                "scrim-fill"
              ],
              "property": "opacity",
              "from": 0.34,
              "to": 0,
              "startFrame": 1772,
              "durationFrames": 58
            },
            {
              "clipId": "scrim-up-3",
              "targets": [
                "scrim-fill"
              ],
              "property": "opacity",
              "from": 0,
              "to": 0.3,
              "startFrame": 2517,
              "durationFrames": 51
            },
            {
              "clipId": "scrim-down-3",
              "targets": [
                "scrim-fill"
              ],
              "property": "opacity",
              "from": 0.3,
              "to": 0,
              "startFrame": 2625,
              "durationFrames": 55
            },
            {
              "clipId": "scrim-up-4",
              "targets": [
                "scrim-fill"
              ],
              "property": "opacity",
              "from": 0,
              "to": 0.34,
              "startFrame": 3068,
              "durationFrames": 43
            },
            {
              "clipId": "scrim-down-4",
              "targets": [
                "scrim-fill"
              ],
              "property": "opacity",
              "from": 0.34,
              "to": 0,
              "startFrame": 3151,
              "durationFrames": 48
            },
            {
              "clipId": "scrim-up-5",
              "targets": [
                "scrim-fill"
              ],
              "property": "opacity",
              "from": 0,
              "to": 0.3,
              "startFrame": 3651,
              "durationFrames": 52
            },
            {
              "clipId": "scrim-down-5",
              "targets": [
                "scrim-fill"
              ],
              "property": "opacity",
              "from": 0.3,
              "to": 0,
              "startFrame": 3862,
              "durationFrames": 90
            },
            {
              "clipId": "scrim-close",
              "targets": [
                "scrim-fill"
              ],
              "property": "opacity",
              "from": 0,
              "to": 0.34,
              "startFrame": 4328,
              "durationFrames": 57
            }
          ]
        }
      }
    ],
    "actors": []
  },
  "shots": [
    {
      "id": "departure",
      "ch": "departure",
      "dur": 10.2333,
      "stage": "frame",
      "look": "all",
      "move": "cut",
      "drift": false,
      "zoom": 1,
      "scriptText": "In September of nineteen seventy seven, a machine about the size of a small car was bolted to the top of a rocket and pointed away from everything it had ever known.",
      "visualDirection": "Wide starfield. The craft is small, dish already turned back toward the sun. The signal thread draws itself home for the first time.",
      "speed": 1,
      "blocks": [
        {
          "c": "TextReveal",
          "text": "Still Talking",
          "size": "display",
          "accentWord": "Talking"
        }
      ]
    },
    {
      "id": "one-job",
      "ch": "departure",
      "dur": 5.3,
      "stage": "none",
      "look": "all",
      "move": "pan",
      "drift": false,
      "zoom": 1,
      "scriptText": "It had one job. Fly past the outer planets, take pictures, and send them home.",
      "visualDirection": "Push in. Three booms swing out and lock. The instrument lamps light in the order they were switched on.",
      "speed": 1,
      "blocks": []
    },
    {
      "id": "not-coming-back",
      "ch": "departure",
      "dur": 5.3333,
      "stage": "none",
      "look": "all",
      "move": "pan",
      "drift": false,
      "zoom": 1,
      "scriptText": "It was never coming back. The people who built it knew that. They packed it a lunch anyway.",
      "visualDirection": "The orbit rings draw themselves outward from the sun. Earth pings on the first ring. Nothing loops back.",
      "speed": 1,
      "blocks": []
    },
    {
      "id": "the-record",
      "ch": "departure",
      "dur": 14.1333,
      "stage": "none",
      "look": "all",
      "move": "pan",
      "drift": false,
      "zoom": 1,
      "scriptText": "Bolted to its side, a gold plated record. Greetings in fifty five languages. Whale song. Photographs of the world it was leaving. And instructions, etched into the cover, for anyone who might one day find it.",
      "visualDirection": "The disc on the craft's flank grows into frame. One continuous groove traces itself from the outside in while the record turns.",
      "speed": 1,
      "blocks": []
    },
    {
      "id": "let-go",
      "ch": "departure",
      "dur": 1.6,
      "stage": "none",
      "look": "all",
      "move": "pan",
      "drift": false,
      "zoom": 1,
      "scriptText": "Then they let it go.",
      "visualDirection": "Pull back fast. The record shrinks to a speck on a craft that is suddenly very small.",
      "speed": 1,
      "blocks": []
    },
    {
      "id": "falling-outward",
      "ch": "the grand tour",
      "dur": 5.8667,
      "stage": "none",
      "look": "all",
      "move": "cut",
      "drift": false,
      "zoom": 1,
      "scriptText": "For eighteen months it fell outward through the dark, a small bright point, talking the whole way.",
      "visualDirection": "Sustained drift. The sun shrinks. Pulses travel the thread toward it, steady as a heartbeat.",
      "speed": 1,
      "blocks": []
    },
    {
      "id": "jupiter",
      "ch": "the grand tour",
      "dur": 7.0333,
      "stage": "frame",
      "look": "all",
      "move": "pan",
      "drift": false,
      "zoom": 1,
      "scriptText": "In March of nineteen seventy nine, Jupiter filled its cameras. A storm wider than the Earth, slowly turning.",
      "visualDirection": "Jupiter arrives and looms until its limb runs off both edges. The cloud bands shear against each other. The storm turns.",
      "speed": 1,
      "blocks": [
        {
          "c": "TextReveal",
          "text": "March 1979 - Jupiter",
          "size": "subhead"
        }
      ]
    },
    {
      "id": "slingshot",
      "ch": "the grand tour",
      "dur": 5.2,
      "stage": "none",
      "look": "all",
      "move": "pan",
      "drift": false,
      "zoom": 1,
      "scriptText": "It stole a little speed from the giant as it went past. The giant never noticed.",
      "visualDirection": "The craft whips outward and the whole star field accelerates with it. Jupiter slides off frame unmoved.",
      "speed": 1,
      "blocks": []
    },
    {
      "id": "saturn",
      "ch": "the grand tour",
      "dur": 6.6333,
      "stage": "frame",
      "look": "all",
      "move": "pan",
      "drift": false,
      "zoom": 1,
      "scriptText": "Twenty months later, Saturn. It swung in close to the moon Titan to look for an atmosphere, and found one.",
      "visualDirection": "Saturn arrives with its rings drawing themselves on. Titan's atmosphere lights as the craft swings past it.",
      "speed": 1,
      "blocks": [
        {
          "c": "TextReveal",
          "text": "November 1980 - Saturn and Titan",
          "size": "subhead"
        }
      ]
    },
    {
      "id": "out-of-plane",
      "ch": "out of the plane",
      "dur": 7.1667,
      "stage": "none",
      "look": "all",
      "move": "cut",
      "drift": false,
      "zoom": 1,
      "scriptText": "That choice cost it the rest of the tour. Titan bent its path up and out of the flat plane the planets travel in.",
      "visualDirection": "The orbit rings flatten into a single line and fall away below as the craft climbs out of the plane of the planets.",
      "speed": 1,
      "blocks": []
    },
    {
      "id": "nothing-but-distance",
      "ch": "out of the plane",
      "dur": 3.5333,
      "stage": "none",
      "look": "all",
      "move": "pan",
      "drift": false,
      "zoom": 1,
      "scriptText": "There was nothing ahead of it any more. Nothing but distance.",
      "visualDirection": "Held drift. Nothing enters frame. The emptiest shot in the film.",
      "speed": 1,
      "blocks": []
    },
    {
      "id": "turn-around",
      "ch": "pale blue dot",
      "dur": 6.7,
      "stage": "none",
      "look": "all",
      "move": "cut",
      "drift": false,
      "zoom": 1,
      "scriptText": "Thirteen years after launch, out past the orbit of Neptune, it was asked to turn around one last time.",
      "visualDirection": "The camera boom swings all the way round to look back the way it came. The dish never leaves the sun.",
      "speed": 1,
      "blocks": []
    },
    {
      "id": "sixty-photographs",
      "ch": "pale blue dot",
      "dur": 4.8,
      "stage": "none",
      "look": "all",
      "move": "pan",
      "drift": false,
      "zoom": 1,
      "scriptText": "It aimed its cameras back the way it had come and took sixty photographs of home.",
      "visualDirection": "Sixty plates fill in one after another under a sweeping scan line. The shutter blinks on the instrument lamps.",
      "speed": 1,
      "blocks": []
    },
    {
      "id": "pale-blue-pixel",
      "ch": "pale blue dot",
      "dur": 6.0333,
      "stage": "frame",
      "look": "all",
      "move": "pan",
      "drift": false,
      "zoom": 1,
      "scriptText": "In one of them, caught by accident in a stray beam of sunlight, there is a single pale blue pixel.",
      "visualDirection": "One plate is marked, and the frame dives into it. A reticle closes on a single accent-coloured speck inside a stray sunbeam.",
      "speed": 1,
      "blocks": [
        {
          "c": "TextReveal",
          "text": "Six billion kilometres from home",
          "size": "subhead"
        }
      ]
    },
    {
      "id": "that-is-everyone",
      "ch": "pale blue dot",
      "dur": 8.2333,
      "stage": "none",
      "look": "all",
      "move": "pan",
      "drift": false,
      "zoom": 1,
      "scriptText": "That is everyone. Every war, every love letter, every person who has ever lived, on one speck of dust suspended in a sunbeam.",
      "visualDirection": "Hold on the speck. The slowest push in the film. It pings twice, then stops.",
      "speed": 1,
      "blocks": []
    },
    {
      "id": "eyes-closed",
      "ch": "pale blue dot",
      "dur": 4.2667,
      "stage": "none",
      "look": "all",
      "move": "pan",
      "drift": false,
      "zoom": 1,
      "scriptText": "Then the cameras went off for good, to save power, and it kept going.",
      "visualDirection": "The reticle releases. The camera lamps go out one after another and the boom swings back to its heading.",
      "speed": 1,
      "blocks": []
    },
    {
      "id": "particles-change",
      "ch": "the edge",
      "dur": 4.7667,
      "stage": "frame",
      "look": "all",
      "move": "cut",
      "drift": false,
      "zoom": 1,
      "scriptText": "On the twenty fifth of August, twenty twelve, the particles around it changed.",
      "visualDirection": "A boundary arc appears far ahead on the right and begins to draw itself across the frame.",
      "speed": 1,
      "blocks": [
        {
          "c": "TextReveal",
          "text": "25 August 2012 - the heliopause",
          "size": "subhead"
        }
      ]
    },
    {
      "id": "last-breath",
      "ch": "the edge",
      "dur": 6.5667,
      "stage": "none",
      "look": "all",
      "move": "pan",
      "drift": false,
      "zoom": 1,
      "scriptText": "The solar wind, the thin breath our sun has been exhaling for four and a half billion years, simply stopped.",
      "visualDirection": "The solar wind streamers decelerate to a dead stop and fade. Outside the arc, a colder and denser field arrives.",
      "speed": 1,
      "blocks": []
    },
    {
      "id": "across-the-edge",
      "ch": "the edge",
      "dur": 5.4,
      "stage": "none",
      "look": "all",
      "move": "pan",
      "drift": false,
      "zoom": 1,
      "scriptText": "It had crossed the edge. The first thing we ever made to leave the sun behind entirely.",
      "visualDirection": "The craft crosses the arc. It closes behind and recedes. The sun is now indistinguishable from the other stars.",
      "speed": 1,
      "blocks": []
    },
    {
      "id": "still-out-there",
      "ch": "still talking",
      "dur": 2.5667,
      "stage": "none",
      "look": "all",
      "move": "cut",
      "drift": false,
      "zoom": 1,
      "scriptText": "It is still out there. Still talking.",
      "visualDirection": "Wide and quiet. The craft alone, the thread still attached, running off the left edge of frame.",
      "speed": 1,
      "blocks": []
    },
    {
      "id": "twenty-two-watts",
      "ch": "still talking",
      "dur": 11.5,
      "stage": "frame",
      "look": "all",
      "move": "pan",
      "drift": false,
      "zoom": 1,
      "scriptText": "Its voice is twenty two watts, about the same as the light in a fridge. By the time that whisper reaches the dishes in the desert, it is fainter than almost anything we know how to hear.",
      "visualDirection": "The heartbeat stops. One pulse leaves the dish alone and travels the whole thread, thinning the whole way.",
      "speed": 1,
      "blocks": [
        {
          "c": "StatCounter",
          "to": 22,
          "label": "transmitter power",
          "format": "plain",
          "suffix": " watts"
        }
      ]
    },
    {
      "id": "going-dark",
      "ch": "still talking",
      "dur": 6.1667,
      "stage": "none",
      "look": "all",
      "move": "pan",
      "drift": false,
      "zoom": 1,
      "scriptText": "Every year it gets a little colder. Instruments shut down one by one to keep the radio alive.",
      "visualDirection": "The instrument lamps go out one at a time. The radio lamp on the bus is left burning by itself.",
      "speed": 1,
      "blocks": []
    },
    {
      "id": "the-last-one",
      "ch": "still talking",
      "dur": 5.2333,
      "stage": "none",
      "look": "all",
      "move": "pan",
      "drift": false,
      "zoom": 1,
      "scriptText": "Some time in the thirties, the last of them will go quiet, and it will stop answering.",
      "visualDirection": "The radio lamp dims to nothing. The signal thread stops drawing partway across the frame.",
      "speed": 1,
      "blocks": []
    },
    {
      "id": "keep-going",
      "ch": "still talking",
      "dur": 5.6333,
      "stage": "frame",
      "look": "all",
      "move": "pan",
      "drift": false,
      "zoom": 1,
      "scriptText": "And then it will simply keep going, in the dark, carrying its record, for a very long time.",
      "visualDirection": "The thread is gone. The craft keeps moving at exactly the rate it always has, out toward frame right.",
      "speed": 1,
      "blocks": [
        {
          "c": "TextReveal",
          "text": "Voyager 1",
          "size": "display"
        }
      ]
    },
    {
      "id": "longer-than-the-sun",
      "ch": "still talking",
      "dur": 4.1333,
      "stage": "frame",
      "look": "all",
      "move": "pan",
      "drift": false,
      "zoom": 1,
      "scriptText": "Long enough that the sun will die first.",
      "visualDirection": "The record on its flank catches one last highlight. The frame settles to stars.",
      "speed": 1,
      "blocks": [
        {
          "c": "TextReveal",
          "text": "Launched 1977. Still transmitting.",
          "size": "subhead",
          "accentWord": "transmitting"
        }
      ]
    }
  ],
  "voiceover": {
    "src": "videos/still-talking/voiceover.wav",
    "volume": 1,
    "speed": 1,
    "durationSec": 154.0333
  },
  "subtitles": false
};
