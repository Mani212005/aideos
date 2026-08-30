import type { Film } from "../schema";

export const whatIsJepaFilm: Film = {
  "schemaVersion": "1.0.0",
  "id": "what-is-jepa",
  "title": "What is JEPA",
  "fps": 30,
  "accent": "#F43F5E",
  "theme": {
    "background": "blueprint",
    "fontFamily": "geist",
    "videoType": "educational",
    "storyStyle": "script-metaphor",
    "cameraAngle": "top-down",
    "accent": "#F43F5E"
  },
  "chapters": [
    "Introduction",
    "Core Mechanism",
    "Architecture",
    "Payoff"
  ],
  "canvas": {
    "nodes": [
      {
        "id": "intro",
        "label": "The Hook",
        "sub": "Betting Against ChatGPT",
        "x": 30,
        "y": -220,
        "w": 220,
        "h": 68
      },
      {
        "id": "lecun",
        "label": "Yann LeCun",
        "sub": "Turing Award & Meta FAIR",
        "x": 0,
        "y": -120,
        "w": 220,
        "h": 68
      },
      {
        "id": "breakup",
        "label": "The Breakup",
        "sub": "AMI Labs $1B+ Seed",
        "x": -10,
        "y": -10,
        "w": 220,
        "h": 68
      },
      {
        "id": "jepa-concept",
        "label": "JEPA Core Idea",
        "sub": "Predict meaning not pixels",
        "x": 40,
        "y": 130,
        "w": 220,
        "h": 68
      },
      {
        "id": "encoders",
        "label": "Joint Encoders",
        "sub": "Context + Target Encoders",
        "x": 50,
        "y": 260,
        "w": 220,
        "h": 68
      },
      {
        "id": "world-models",
        "label": "World Models",
        "sub": "I-JEPA to V-JEPA 2",
        "x": 50,
        "y": 420,
        "w": 220,
        "h": 68
      },
      {
        "id": "conclusion",
        "label": "The Close",
        "sub": "Predicting the world",
        "x": 60,
        "y": 600,
        "w": 220,
        "h": 68
      }
    ],
    "edges": [
      {
        "from": "intro",
        "to": "lecun",
        "dashed": false
      },
      {
        "from": "lecun",
        "to": "breakup",
        "dashed": false
      },
      {
        "from": "breakup",
        "to": "jepa-concept",
        "dashed": false
      },
      {
        "from": "jepa-concept",
        "to": "encoders",
        "dashed": false
      },
      {
        "from": "encoders",
        "to": "world-models",
        "dashed": false
      },
      {
        "from": "world-models",
        "to": "conclusion",
        "dashed": false
      }
    ]
  },
  "shots": [
    {
      "id": "the-hook",
      "dur": 4.8,
      "stage": "anchor",
      "look": "intro",
      "move": "cut",
      "drift": true,
      "zoom": 1,
      "visualDirection": "Black screen. Blinking cursor types quote. Yann LeCun rubber stamp.",
      "speed": 1,
      "blocks": [
        {
          "c": "TextReveal",
          "text": "JEPA: Betting Against ChatGPT",
          "size": "headline"
        },
        {
          "c": "Body",
          "text": "Why Meta chief AI scientist Yann LeCun  \n walked away from LLMs."
        },
        {
          "c": "CharacterBeat",
          "characterId": "developer",
          "poses": [
            {
              "t": 0,
              "groups": {
                "torso": {
                  "rotate": 2
                },
                "head": {
                  "rotate": 6
                },
                "leftArm": {
                  "rotate": -5
                },
                "rightArm": {
                  "rotate": -125
                },
                "legs": {
                  "rotate": 0
                }
              }
            },
            {
              "t": 0.3,
              "groups": {
                "torso": {
                  "rotate": -3
                },
                "head": {
                  "rotate": -5
                },
                "leftArm": {
                  "rotate": 65
                },
                "rightArm": {
                  "rotate": 10
                },
                "legs": {
                  "rotate": 0
                }
              }
            },
            {
              "t": 0.6,
              "groups": {
                "torso": {
                  "rotate": 2
                },
                "head": {
                  "rotate": 6
                },
                "leftArm": {
                  "rotate": -5
                },
                "rightArm": {
                  "rotate": -125
                },
                "legs": {
                  "rotate": 0
                }
              }
            },
            {
              "t": 0.9,
              "groups": {
                "torso": {
                  "rotate": 0
                },
                "head": {
                  "rotate": -4
                },
                "leftArm": {
                  "rotate": 110
                },
                "rightArm": {
                  "rotate": -110
                },
                "legs": {
                  "rotate": 0
                }
              }
            }
          ]
        }
      ]
    },
    {
      "id": "who-is-lecun",
      "position": 12,
      "startSec": 12,
      "dur": 5.03,
      "stage": "frame",
      "look": "lecun",
      "move": "pan",
      "drift": true,
      "zoom": 1,
      "visualDirection": "Split screen: LLM text wall vs toddler physics understanding.",
      "speed": 1,
      "blocks": [
        {
          "c": "StatCounter",
          "to": 2018,
          "label": "Turing Award",
          "format": "plain"
        },
        {
          "c": "Body",
          "text": "Predicting the next word will never add up to real understanding."
        },
        {
          "c": "AnalogyInset",
          "caption": "Visual B-Roll"
        }
      ]
    },
    {
      "id": "the-breakup",
      "dur": 3.97,
      "stage": "frame",
      "look": "breakup",
      "move": "pan",
      "drift": true,
      "zoom": 1,
      "visualDirection": "Meta logo cracking. AMI Labs launch with $1B+ seed.",
      "metaphor": "rocket-launch",
      "speed": 1,
      "blocks": [
        {
          "c": "TextReveal",
          "text": "LeCun Departs Meta · Launches AMI Labs",
          "size": "headline"
        },
        {
          "c": "StatCounter",
          "to": 1,
          "label": "Seed Funding",
          "format": "plain",
          "suffix": "B+"
        }
      ]
    },
    {
      "id": "canvas-anchor-1",
      "dur": 3.97,
      "stage": "none",
      "look": [
        "breakup",
        "jepa-concept"
      ],
      "move": "zoom-out",
      "drift": true,
      "zoom": 0.85,
      "speed": 1,
      "blocks": []
    },
    {
      "id": "jepa-concept-part1",
      "dur": 5,
      "stage": "frame",
      "look": "jepa-concept",
      "move": "pan",
      "drift": true,
      "zoom": 1,
      "visualDirection": "Generative extra finger vs JEPA abstract cloud.",
      "metaphor": "glowing-cluster",
      "speed": 1,
      "blocks": [
        {
          "c": "TextReveal",
          "text": "Predict meaning, not pixels.",
          "size": "headline"
        },
        {
          "c": "Body",
          "text": "Predicts abstract representations instead of reconstructing every tiny detail."
        }
      ]
    },
    {
      "id": "joint-encoders",
      "dur": 5.04,
      "stage": "anchor",
      "look": "encoders",
      "move": "pan",
      "drift": true,
      "zoom": 1,
      "visualDirection": "Context encoder and target encoder comparing notes in embedding space.",
      "speed": 1,
      "blocks": [
        {
          "c": "TokenStrip",
          "tokens": [
            "Context Enc",
            "Embedding",
            "Target Enc"
          ],
          "lit": []
        },
        {
          "c": "Body",
          "text": "Learning what goes together in the real world entirely by watching."
        }
      ]
    },
    {
      "id": "canvas-anchor-2",
      "dur": 4.06,
      "stage": "none",
      "look": [
        "encoders",
        "world-models"
      ],
      "move": "zoom-out",
      "drift": true,
      "zoom": 0.85,
      "speed": 1,
      "blocks": []
    },
    {
      "id": "world-models-evolution",
      "dur": 3.65,
      "stage": "frame",
      "look": "world-models",
      "move": "pan",
      "drift": true,
      "zoom": 1,
      "visualDirection": "Timeline from I-JEPA to V-JEPA to V-JEPA 2 controlling robot arm.",
      "speed": 1,
      "blocks": [
        {
          "c": "TokenStrip",
          "tokens": [
            "I-JEPA",
            "V-JEPA",
            "V-JEPA 2"
          ],
          "lit": []
        },
        {
          "c": "StatCounter",
          "to": 1,
          "label": "Video Training",
          "format": "plain",
          "suffix": "M hrs"
        },
        {
          "c": "AnalogyInset",
          "caption": "V-JEPA 2 World Model · Robot Arm · GPU-Generated B-Roll",
          "framesDir": "gpu_robot_arm",
          "totalFrames": 144,
          "delayFrames": 30,
          "fullScreenHero": true
        }
      ]
    },
    {
      "id": "how-to-try",
      "dur": 4.16,
      "stage": "anchor",
      "look": "world-models",
      "move": "pan",
      "drift": true,
      "zoom": 1,
      "visualDirection": "Hugging Face & GitHub transformers open source.",
      "metaphor": "custom",
      "speed": 1,
      "blocks": [
        {
          "c": "TextReveal",
          "text": "facebookresearch/vjepa2",
          "size": "headline"
        },
        {
          "c": "Body",
          "text": "Open source on Hugging Face & GitHub facebookresearch/vjepa2"
        }
      ]
    },
    {
      "id": "the-close",
      "dur": 2.77,
      "stage": "anchor",
      "look": "conclusion",
      "move": "pan",
      "drift": true,
      "zoom": 1,
      "visualDirection": "Pull back split screen: Chat window fades, glowing 3D world simulation.",
      "speed": 1,
      "blocks": [
        {
          "c": "TextReveal",
          "text": "JEPA: Predicting the world, not words.",
          "size": "headline"
        },
        {
          "c": "Body",
          "text": "Yann LeCun bet his entire career on real world intelligence."
        }
      ]
    }
  ],
  "voiceover": {
    "src": "voiceover_what-is-jepa.wav",
    "volume": 1,
    "speed": 1
  }
};
