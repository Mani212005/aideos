import type { Film } from "../schema";

export const speculativeDecodingDesignedFilm: Film = {
  "schemaVersion": "1.0.0",
  "id": "speculative-decoding-designed",
  "title": "Speculative Decoding (designed)",
  "fps": 30,
  "accent": "#635BFF",
  "theme": {
    "background": "smooth-dark",
    "fontFamily": "geist",
    "accent": "#635BFF"
  },
  "chapters": [
    "The Waiting Problem",
    "Memory, Not Math",
    "The Asymmetry",
    "The Draft Model",
    "One Pass, Many Checks",
    "Exactly the Same Answer",
    "What It Buys"
  ],
  "canvas": {
    "nodes": [
      {
        "id": "waiting",
        "label": "The Waiting Problem",
        "sub": "One token at a time",
        "x": 160,
        "y": 200,
        "w": 280,
        "h": 124
      },
      {
        "id": "memory-bound",
        "label": "Memory, Not Math",
        "sub": "Memory bound, not compute bound",
        "x": 590,
        "y": 200,
        "w": 280,
        "h": 124
      },
      {
        "id": "asymmetry",
        "label": "The Asymmetry",
        "sub": "Checking beats guessing",
        "x": 1020,
        "y": 200,
        "w": 280,
        "h": 124
      },
      {
        "id": "draft",
        "label": "The Draft Model",
        "sub": "A small model writes ahead",
        "x": 1020,
        "y": 474,
        "w": 280,
        "h": 124
      },
      {
        "id": "verify",
        "label": "One Pass, Many Checks",
        "sub": "Verify all five at once",
        "x": 590,
        "y": 474,
        "w": 280,
        "h": 124
      },
      {
        "id": "identical",
        "label": "Exactly the Same Answer",
        "sub": "Not an approximation",
        "x": 160,
        "y": 474,
        "w": 280,
        "h": 124
      },
      {
        "id": "payoff",
        "label": "What It Buys",
        "sub": "Two to three times faster",
        "x": 160,
        "y": 748,
        "w": 280,
        "h": 124
      }
    ],
    "edges": [
      {
        "from": "waiting",
        "to": "memory-bound",
        "dashed": false
      },
      {
        "from": "memory-bound",
        "to": "asymmetry",
        "dashed": false
      },
      {
        "from": "asymmetry",
        "to": "draft",
        "dashed": false
      },
      {
        "from": "draft",
        "to": "verify",
        "dashed": false
      },
      {
        "from": "verify",
        "to": "identical",
        "dashed": false
      },
      {
        "from": "identical",
        "to": "payoff",
        "dashed": false
      }
    ]
  },
  "scene": {
    "schemaVersion": "1.0.0",
    "sceneId": "speculative-decoding-designed",
    "fps": 30,
    "durationFrames": 5650,
    "audioSource": "videos/speculative-decoding/voiceover.wav",
    "audioDurationMs": 188349,
    "sceneSize": {
      "w": 1920,
      "h": 1920
    },
    "background": {
      "assetId": "background",
      "svgSource": "videos/speculative-decoding-designed/visuals/canvas.svg",
      "layer": 0,
      "position": {
        "x": 960,
        "y": 960
      },
      "scale": 4.8,
      "rotation": 0,
      "opacity": 1
    },
    "props": [
      {
        "assetId": "memory",
        "svgSource": "videos/speculative-decoding-designed/visuals/memory.svg",
        "layer": 2,
        "position": {
          "x": 600,
          "y": 1215
        },
        "scale": 0.9,
        "rotation": 0,
        "opacity": 1,
        "animation": {
          "timelineId": "memory-motion",
          "clips": [
            {
              "clipId": "memory-in",
              "targets": [
                "memory"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 0,
              "durationFrames": 47,
              "easing": "expoOut"
            },
            {
              "clipId": "scan-1",
              "targets": [
                "read-scan"
              ],
              "property": "translateY",
              "from": 0,
              "to": 210,
              "startFrame": 674,
              "durationFrames": 80,
              "easing": "linear"
            },
            {
              "clipId": "scan-back",
              "targets": [
                "read-scan"
              ],
              "property": "translateY",
              "from": 210,
              "to": 0,
              "startFrame": 1227,
              "durationFrames": 129,
              "easing": "linear"
            }
          ]
        }
      },
      {
        "assetId": "chip",
        "svgSource": "videos/speculative-decoding-designed/visuals/chip.svg",
        "layer": 2,
        "position": {
          "x": 1320,
          "y": 1215
        },
        "scale": 0.9,
        "rotation": 0,
        "opacity": 1,
        "animation": {
          "timelineId": "chip-motion",
          "clips": [
            {
              "clipId": "chip-in",
              "targets": [
                "chip"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 0,
              "durationFrames": 66,
              "easing": "expoOut"
            },
            {
              "clipId": "busy",
              "targets": [
                "chip-busy"
              ],
              "property": "drawOn",
              "from": 0,
              "to": 1,
              "startFrame": 1058,
              "durationFrames": 38,
              "easing": "expoOut"
            },
            {
              "clipId": "idle",
              "targets": [
                "chip-lamp"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0.25,
              "startFrame": 1152,
              "durationFrames": 36,
              "easing": "expoOut"
            },
            {
              "clipId": "lamp-back",
              "targets": [
                "chip-lamp"
              ],
              "property": "opacity",
              "from": 0.25,
              "to": 1,
              "startFrame": 3412,
              "durationFrames": 59
            }
          ]
        }
      },
      {
        "assetId": "road",
        "svgSource": "videos/speculative-decoding-designed/visuals/road.svg",
        "layer": 1,
        "position": {
          "x": 960,
          "y": 1215
        },
        "scale": 0.9,
        "rotation": 0,
        "opacity": 1,
        "animation": {
          "timelineId": "road-motion",
          "clips": [
            {
              "clipId": "road-draw",
              "targets": [
                "road"
              ],
              "property": "drawOn",
              "from": 0,
              "to": 1,
              "startFrame": 38,
              "durationFrames": 75,
              "easing": "expoOut"
            },
            {
              "clipId": "glow-hidden",
              "targets": [
                "road-glow"
              ],
              "property": "drawOn",
              "from": 0,
              "to": 0,
              "startFrame": 0,
              "durationFrames": 1,
              "easing": "hold"
            },
            {
              "clipId": "five-hidden",
              "targets": [
                "cargo-five"
              ],
              "property": "opacity",
              "from": 0,
              "to": 0,
              "startFrame": 0,
              "durationFrames": 1,
              "easing": "hold"
            },
            {
              "clipId": "trip-1",
              "targets": [
                "cargo"
              ],
              "property": "translateX",
              "from": 0,
              "to": 480,
              "startFrame": 719,
              "durationFrames": 217,
              "easing": "expoInOut"
            },
            {
              "clipId": "cargo-hide-1",
              "targets": [
                "cargo"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 1198,
              "durationFrames": 6
            },
            {
              "clipId": "cargo-back-1",
              "targets": [
                "cargo"
              ],
              "property": "translateX",
              "from": 0,
              "to": 0,
              "startFrame": 1204,
              "durationFrames": 1,
              "easing": "hold"
            },
            {
              "clipId": "cargo-show-1",
              "targets": [
                "cargo"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 1206,
              "durationFrames": 6
            },
            {
              "clipId": "trip-2",
              "targets": [
                "cargo"
              ],
              "property": "translateX",
              "from": 0,
              "to": 480,
              "startFrame": 1227,
              "durationFrames": 129,
              "easing": "expoInOut"
            },
            {
              "clipId": "the-trip",
              "targets": [
                "road-glow"
              ],
              "property": "drawOn",
              "from": 0,
              "to": 1,
              "startFrame": 1609,
              "durationFrames": 55,
              "easing": "expoOut"
            },
            {
              "clipId": "cargo-out",
              "targets": [
                "cargo"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 3146,
              "durationFrames": 8
            },
            {
              "clipId": "five-in",
              "targets": [
                "cargo-five"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 3154,
              "durationFrames": 8
            },
            {
              "clipId": "one-pass",
              "targets": [
                "cargo-five"
              ],
              "property": "translateX",
              "from": 0,
              "to": 500,
              "startFrame": 3246,
              "durationFrames": 138,
              "easing": "expoInOut"
            },
            {
              "clipId": "five-hide",
              "targets": [
                "cargo-five"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 5422,
              "durationFrames": 6
            },
            {
              "clipId": "five-back",
              "targets": [
                "cargo-five"
              ],
              "property": "translateX",
              "from": 0,
              "to": 0,
              "startFrame": 5428,
              "durationFrames": 1,
              "easing": "hold"
            },
            {
              "clipId": "five-show",
              "targets": [
                "cargo-five"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 5430,
              "durationFrames": 6
            },
            {
              "clipId": "carry-more",
              "targets": [
                "cargo-five"
              ],
              "property": "translateX",
              "from": 0,
              "to": 500,
              "startFrame": 5594,
              "durationFrames": 56,
              "easing": "expoOut"
            }
          ]
        }
      },
      {
        "assetId": "tokens",
        "svgSource": "videos/speculative-decoding-designed/visuals/tokens.svg",
        "layer": 3,
        "position": {
          "x": 960,
          "y": 640
        },
        "scale": 1.3,
        "rotation": 0,
        "opacity": 1,
        "animation": {
          "timelineId": "tokens-motion",
          "clips": [
            {
              "clipId": "tokens-hidden",
              "targets": [
                "tok-1",
                "tok-2",
                "tok-3",
                "tok-4",
                "tok-5",
                "ok-1",
                "ok-2",
                "ok-3",
                "no-4",
                "fix-4",
                "tokens-label"
              ],
              "property": "opacity",
              "from": 0,
              "to": 0,
              "startFrame": 0,
              "durationFrames": 1,
              "easing": "hold"
            },
            {
              "clipId": "trickle",
              "targets": [
                "tok-1",
                "tok-2",
                "tok-3"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 189,
              "durationFrames": 24,
              "easing": "expoOut",
              "staggerFrames": 40
            },
            {
              "clipId": "tokens-clear",
              "targets": [
                "tok-1",
                "tok-2",
                "tok-3"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0,
              "startFrame": 2103,
              "durationFrames": 41
            },
            {
              "clipId": "draft-writes",
              "targets": [
                "tok-1",
                "tok-2",
                "tok-3",
                "tok-4",
                "tok-5"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 2896,
              "durationFrames": 36,
              "easing": "expoOut",
              "staggerFrames": 8
            },
            {
              "clipId": "label-in",
              "targets": [
                "tokens-label"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 2982,
              "durationFrames": 27
            },
            {
              "clipId": "accepted",
              "targets": [
                "ok-1",
                "ok-2",
                "ok-3"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 3710,
              "durationFrames": 32,
              "easing": "expoOut",
              "staggerFrames": 6
            },
            {
              "clipId": "disagree",
              "targets": [
                "no-4"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 3675,
              "durationFrames": 35
            },
            {
              "clipId": "correct",
              "targets": [
                "fix-4"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 3843,
              "durationFrames": 52,
              "easing": "expoOut"
            },
            {
              "clipId": "drop-rest",
              "targets": [
                "tok-4",
                "tok-5"
              ],
              "property": "opacity",
              "from": 1,
              "to": 0.25,
              "startFrame": 3843,
              "durationFrames": 52
            }
          ]
        }
      },
      {
        "assetId": "draft",
        "svgSource": "videos/speculative-decoding-designed/visuals/draft.svg",
        "layer": 3,
        "position": {
          "x": 960,
          "y": 1120
        },
        "scale": 0.8,
        "rotation": 0,
        "opacity": 1,
        "animation": {
          "timelineId": "draft-motion",
          "clips": [
            {
              "clipId": "draft-hidden",
              "targets": [
                "draft"
              ],
              "property": "opacity",
              "from": 0,
              "to": 0,
              "startFrame": 0,
              "durationFrames": 1,
              "easing": "hold"
            },
            {
              "clipId": "draft-in",
              "targets": [
                "draft"
              ],
              "property": "opacity",
              "from": 0,
              "to": 1,
              "startFrame": 2420,
              "durationFrames": 35,
              "easing": "expoOut"
            }
          ]
        }
      }
    ],
    "actors": []
  },
  "design": {
    "source": "hand-built",
    "brief": {
      "concept": "The wait was never the arithmetic, it was the walk to memory. A memory bank and the accelerator sit on one road; every word costs a trip, and the fix is making each trip carry five.",
      "throughLine": "The road between memory and the chip, and the cargo that travels it on every beat.",
      "motifs": [
        "the road",
        "cargo packets",
        "drafted token tiles"
      ]
    }
  },
  "shots": [
    {
      "id": "beat-01",
      "ch": "The Waiting Problem",
      "dur": 6.305,
      "stage": "frame",
      "look": "waiting",
      "move": "cut",
      "drift": true,
      "zoom": 1,
      "scriptText": "Ask a large language model a question, and watch the answer arrive. It does not appear. It trickles.",
      "visualDirection": "B-roll: a single drop of liquid falling in near darkness, caught at high speed against deep indigo light.",
      "needsFootage": true,
      "speed": 1,
      "blocks": [
        {
          "c": "TextReveal",
          "text": "One token at a time",
          "size": "headline"
        }
      ]
    },
    {
      "id": "beat-02",
      "ch": "The Waiting Problem",
      "dur": 6.101,
      "stage": "frame",
      "look": "waiting",
      "move": "pan",
      "drift": true,
      "zoom": 1,
      "scriptText": "One word, then the next, then the next, at a pace that has almost nothing to do with how much compute you own.",
      "visualDirection": "B-roll: a single drop of liquid falling in near darkness, caught at high speed against deep indigo light.",
      "speed": 1,
      "blocks": [
        {
          "c": "TextReveal",
          "text": "Speed you cannot buy",
          "size": "display",
          "accentWord": "cannot"
        }
      ]
    },
    {
      "id": "beat-03",
      "ch": "The Waiting Problem",
      "dur": 7.701,
      "stage": "frame",
      "look": "waiting",
      "move": "pan",
      "drift": true,
      "zoom": 1,
      "scriptText": "Here is the part that surprises people. During that trickle, your very expensive accelerator is sitting almost completely idle.",
      "visualDirection": "B-roll: a single drop of liquid falling in near darkness, caught at high speed against deep indigo light.",
      "speed": 1,
      "blocks": [
        {
          "c": "TextReveal",
          "text": "The accelerator is idle",
          "size": "display",
          "accentWord": "accelerator"
        }
      ]
    },
    {
      "id": "beat-04",
      "ch": "Memory, Not Math",
      "dur": 11.284,
      "stage": "frame",
      "look": "memory-bound",
      "move": "cut",
      "drift": true,
      "zoom": 1.05,
      "scriptText": "To produce a single token, the model has to read every one of its weights out of memory. For a seventy billion parameter model, that is well over a hundred gigabytes moved, for one word.",
      "speed": 1,
      "blocks": [
        {
          "c": "TextReveal",
          "text": "Memory bound, not compute bound",
          "size": "headline"
        }
      ]
    },
    {
      "id": "beat-05",
      "ch": "Memory, Not Math",
      "dur": 13.821,
      "stage": "none",
      "look": [
        "waiting",
        "memory-bound",
        "asymmetry",
        "verify"
      ],
      "move": "zoom-out",
      "drift": true,
      "zoom": 0.9,
      "scriptText": "The arithmetic itself is trivial by comparison. The chip finishes the math in a small fraction of the time, and then it waits. And then it waits again, for the next word, and the one after that, for as long as the answer runs.",
      "speed": 1,
      "blocks": []
    },
    {
      "id": "beat-06",
      "ch": "Memory, Not Math",
      "dur": 10.444,
      "stage": "frame",
      "look": "memory-bound",
      "move": "pan",
      "drift": true,
      "zoom": 1,
      "scriptText": "Which leads somewhere strange. Reading those weights costs the same whether you use them to compute one token or a hundred. The bottleneck is the trip, not the cargo.",
      "speed": 1,
      "blocks": [
        {
          "c": "TextReveal",
          "text": "The trip, not the cargo",
          "size": "display",
          "accentWord": "cargo"
        }
      ]
    },
    {
      "id": "beat-07",
      "ch": "The Asymmetry",
      "dur": 6.56,
      "stage": "frame",
      "look": "asymmetry",
      "move": "cut",
      "drift": true,
      "zoom": 1,
      "scriptText": "That asymmetry is the whole trick. Generating a word is slow, because each one depends on the one before it.",
      "speed": 1,
      "blocks": [
        {
          "c": "TextReveal",
          "text": "Checking beats guessing",
          "size": "display",
          "accentWord": "Checking"
        }
      ]
    },
    {
      "id": "beat-08",
      "ch": "The Asymmetry",
      "dur": 7.681,
      "stage": "none",
      "look": [
        "memory-bound",
        "asymmetry",
        "draft"
      ],
      "move": "zoom-out",
      "drift": true,
      "zoom": 0.9,
      "scriptText": "Checking a word is fast, because a whole batch of them can be examined in a single pass, using weights you were going to load anyway.",
      "speed": 1,
      "blocks": []
    },
    {
      "id": "beat-09",
      "ch": "The Asymmetry",
      "dur": 8.796,
      "stage": "none",
      "look": [
        "waiting",
        "memory-bound",
        "asymmetry",
        "draft",
        "verify"
      ],
      "move": "zoom-out",
      "drift": true,
      "zoom": 0.8,
      "scriptText": "So here is the move. Instead of asking the expensive model to write the answer, we are going to ask it to grade one that somebody else already wrote.",
      "visualDirection": "The camera pulls back across the canvas so the whole argument so far is visible at once.",
      "speed": 1,
      "blocks": []
    },
    {
      "id": "beat-10",
      "ch": "The Draft Model",
      "dur": 5.633,
      "stage": "frame",
      "look": "draft",
      "move": "cut",
      "drift": true,
      "zoom": 1,
      "scriptText": "Alongside the large model, we run a small one. Maybe twenty times smaller, and far quicker.",
      "visualDirection": "B-roll: sparks streaming off a fast spinning grinding wheel in a dark workshop, shallow focus.",
      "needsFootage": true,
      "speed": 1,
      "blocks": [
        {
          "c": "TextReveal",
          "text": "A small model writes ahead",
          "size": "headline"
        }
      ]
    },
    {
      "id": "beat-11",
      "ch": "The Draft Model",
      "dur": 10.791,
      "stage": "none",
      "look": [
        "asymmetry",
        "draft",
        "verify"
      ],
      "move": "zoom-out",
      "drift": true,
      "zoom": 0.9,
      "scriptText": "Most of what any model writes is not actually hard. Articles, prepositions, the second half of a common phrase. The small model gets those right almost every time.",
      "visualDirection": "B-roll: sparks streaming off a fast spinning grinding wheel in a dark workshop, shallow focus.",
      "speed": 1,
      "blocks": []
    },
    {
      "id": "beat-12",
      "ch": "The Draft Model",
      "dur": 9.765,
      "stage": "frame",
      "look": "draft",
      "move": "pan",
      "drift": true,
      "zoom": 1,
      "scriptText": "So it runs ahead and drafts the next handful of tokens by itself. Five words, guessed cheaply, in the time the large model would have spent on part of one.",
      "visualDirection": "B-roll: sparks streaming off a fast spinning grinding wheel in a dark workshop, shallow focus.",
      "speed": 1,
      "blocks": [
        {
          "c": "TextReveal",
          "text": "Five tokens, guessed cheaply",
          "size": "display",
          "accentWord": "guessed"
        }
      ]
    },
    {
      "id": "beat-13",
      "ch": "One Pass, Many Checks",
      "dur": 10.739,
      "stage": "frame",
      "look": "verify",
      "move": "cut",
      "drift": true,
      "zoom": 1.05,
      "scriptText": "Now the large model reads all five drafted tokens in a single forward pass. One trip to memory. One set of weights loaded. Five predictions checked in parallel.",
      "speed": 1,
      "blocks": [
        {
          "c": "TextReveal",
          "text": "Verify all five at once",
          "size": "headline"
        }
      ]
    },
    {
      "id": "beat-14",
      "ch": "One Pass, Many Checks",
      "dur": 4.014,
      "stage": "frame",
      "look": "verify",
      "move": "pan",
      "drift": true,
      "zoom": 1,
      "scriptText": "It compares each drafted token against what it would have chosen itself.",
      "visualDirection": "B-roll: five thin parallel beams of violet light sweeping across a dark polished surface in unison.",
      "needsFootage": true,
      "speed": 1,
      "blocks": [
        {
          "c": "TextReveal",
          "text": "One pass, many checks",
          "size": "headline"
        }
      ]
    },
    {
      "id": "beat-15",
      "ch": "One Pass, Many Checks",
      "dur": 6.075,
      "stage": "none",
      "look": [
        "draft",
        "verify",
        "identical",
        "memory-bound"
      ],
      "move": "zoom-out",
      "drift": true,
      "zoom": 0.9,
      "scriptText": "Everything from the beginning of the draft up to the first disagreement is accepted and kept, in one go.",
      "visualDirection": "B-roll: five thin parallel beams of violet light sweeping across a dark polished surface in unison.",
      "speed": 1,
      "blocks": []
    },
    {
      "id": "beat-16",
      "ch": "Exactly the Same Answer",
      "dur": 11.987,
      "stage": "frame",
      "look": "identical",
      "move": "cut",
      "drift": true,
      "zoom": 1,
      "scriptText": "At that first disagreement, the large model supplies the correct token itself, drawn from a carefully corrected distribution. Nothing is quietly dropped, and nothing is silently approximated.",
      "speed": 1,
      "blocks": [
        {
          "c": "TextReveal",
          "text": "Not an approximation",
          "size": "display",
          "accentWord": "approximation"
        }
      ]
    },
    {
      "id": "beat-17",
      "ch": "Exactly the Same Answer",
      "dur": 4.167,
      "stage": "frame",
      "look": "identical",
      "move": "pan",
      "drift": true,
      "zoom": 1,
      "scriptText": "That is what makes speculative decoding unusual among speed-ups.",
      "visualDirection": "B-roll: two sheets of clear glass sliding into perfect alignment, thin violet rim light along the edges.",
      "needsFootage": true,
      "speed": 1,
      "blocks": [
        {
          "c": "TextReveal",
          "text": "Exactly the same answer",
          "size": "headline"
        }
      ]
    },
    {
      "id": "beat-18",
      "ch": "Exactly the Same Answer",
      "dur": 7.482,
      "stage": "none",
      "look": [
        "verify",
        "identical",
        "payoff"
      ],
      "move": "zoom-out",
      "drift": true,
      "zoom": 0.9,
      "scriptText": "The text you get out is sampled from exactly the same distribution as the slow path. Bit for bit, it is the same model.",
      "visualDirection": "B-roll: two sheets of clear glass sliding into perfect alignment, thin violet rim light along the edges.",
      "speed": 1,
      "blocks": []
    },
    {
      "id": "beat-19",
      "ch": "What It Buys",
      "dur": 14.879,
      "stage": "frame",
      "look": "payoff",
      "move": "cut",
      "drift": true,
      "zoom": 1.05,
      "scriptText": "In practice, on ordinary prose, the draft is accepted often enough to deliver two to three times the throughput. No retraining, no quantisation, no loss of quality. You are simply using the memory bandwidth you were already paying for.",
      "speed": 1,
      "blocks": [
        {
          "c": "TextReveal",
          "text": "Two to three times faster",
          "size": "headline"
        }
      ]
    },
    {
      "id": "beat-20",
      "ch": "What It Buys",
      "dur": 10.898,
      "stage": "none",
      "look": [
        "identical",
        "payoff"
      ],
      "move": "zoom-out",
      "drift": true,
      "zoom": 0.9,
      "scriptText": "On dense or unpredictable text, more of the draft gets rejected, and the gain shrinks toward nothing. The speed-up is really a bet on how predictable your output is.",
      "speed": 1,
      "blocks": []
    },
    {
      "id": "beat-21",
      "ch": "What It Buys",
      "dur": 13.224,
      "stage": "frame",
      "look": "payoff",
      "move": "pan",
      "drift": true,
      "zoom": 1,
      "scriptText": "Which is the lesson hiding underneath all of it. The wait was never the arithmetic. It was the walk to memory. And once you see that, the fix stops looking like a trick, and starts looking obvious: make every walk carry more.",
      "speed": 1,
      "blocks": [
        {
          "c": "TextReveal",
          "text": "The wait was never the math",
          "size": "display",
          "accentWord": "never"
        }
      ]
    }
  ],
  "voiceover": {
    "src": "videos/speculative-decoding/voiceover.wav",
    "volume": 1,
    "speed": 1,
    "durationSec": 188.349375
  },
  "captions": "videos/speculative-decoding/captions.vtt"
};
