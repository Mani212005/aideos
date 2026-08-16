import type { Film } from "../schema";

export const whatIsJepaFilm: Film = {
  "id": "what-is-jepa",
  "title": "What is JEPA",
  "fps": 30,
  "accent": "#635BFF",
  "theme": {
    "background": "smooth-dark",
    "fontFamily": "geist",
    "storyStyle": "script-metaphor",
    "cameraAngle": "isometric",
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
        "x": -220,
        "y": -100,
        "w": 220,
        "h": 68
      },
      {
        "id": "lecun",
        "label": "Yann LeCun",
        "sub": "Turing Award & Meta FAIR",
        "x": 60,
        "y": -100,
        "w": 220,
        "h": 68
      },
      {
        "id": "breakup",
        "label": "The Breakup",
        "sub": "AMI Labs $1B+ Seed",
        "x": 340,
        "y": -100,
        "w": 220,
        "h": 68
      },
      {
        "id": "jepa-concept",
        "label": "JEPA Core Idea",
        "sub": "Predict meaning not pixels",
        "x": -220,
        "y": 140,
        "w": 220,
        "h": 68
      },
      {
        "id": "encoders",
        "label": "Joint Encoders",
        "sub": "Context + Target Encoders",
        "x": 60,
        "y": 140,
        "w": 220,
        "h": 68
      },
      {
        "id": "world-models",
        "label": "World Models",
        "sub": "I-JEPA to V-JEPA 2",
        "x": 340,
        "y": 140,
        "w": 220,
        "h": 68
      },
      {
        "id": "conclusion",
        "label": "The Close",
        "sub": "Predicting the world",
        "x": 60,
        "y": 360,
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
      "dur": 12,
      "stage": "anchor",
      "look": "intro",
      "move": "cut",
      "drift": true,
      "zoom": 1,
      "visualDirection": "Black screen. Blinking cursor types quote. Yann LeCun rubber stamp.",
      "metaphor": "typing-cursor-quote" as any,
      "blocks": [
        {
          "c": "TextReveal",
          "text": "JEPA: Betting Against ChatGPT",
          "size": "headline"
        },
        {
          "c": "Body",
          "text": "Why Meta chief AI scientist Yann LeCun walked away from LLMs."
        }
      ]
    },
    {
      "id": "who-is-lecun",
      "dur": 24,
      "stage": "frame",
      "look": "lecun",
      "move": "pan",
      "drift": true,
      "zoom": 1,
      "visualDirection": "Split screen: LLM text wall vs toddler physics understanding.",
      "metaphor": "custom",
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
        }
      ]
    },
    {
      "id": "the-breakup",
      "dur": 25,
      "stage": "frame",
      "look": "breakup",
      "move": "pan",
      "drift": true,
      "zoom": 1,
      "visualDirection": "Meta logo cracking. AMI Labs launch with $1B+ seed.",
      "metaphor": "rocket-launch",
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
      "dur": 6,
      "stage": "none",
      "look": [
        "breakup",
        "jepa-concept"
      ],
      "move": "zoom-out",
      "drift": true,
      "zoom": 0.85,
      "blocks": []
    },
    {
      "id": "jepa-concept-part1",
      "dur": 25,
      "stage": "frame",
      "look": "jepa-concept",
      "move": "pan",
      "drift": true,
      "zoom": 1,
      "visualDirection": "Generative extra finger vs JEPA abstract cloud.",
      "metaphor": "balance-scale",
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
      "dur": 25,
      "stage": "anchor",
      "look": "encoders",
      "move": "pan",
      "drift": true,
      "zoom": 1,
      "visualDirection": "Context encoder and target encoder comparing notes in embedding space.",
      "metaphor": "spider-web",
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
      "dur": 6,
      "stage": "none",
      "look": [
        "encoders",
        "world-models"
      ],
      "move": "zoom-out",
      "drift": true,
      "zoom": 0.85,
      "blocks": []
    },
    {
      "id": "world-models-evolution",
      "dur": 25,
      "stage": "frame",
      "look": "world-models",
      "move": "pan",
      "drift": true,
      "zoom": 1,
      "visualDirection": "Timeline from I-JEPA to V-JEPA to V-JEPA 2 controlling robot arm.",
      "metaphor": "clock-gears",
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
        }
      ]
    },
    {
      "id": "how-to-try",
      "dur": 20,
      "stage": "anchor",
      "look": "world-models",
      "move": "pan",
      "drift": true,
      "zoom": 1,
      "visualDirection": "Hugging Face & GitHub transformers open source.",
      "metaphor": "custom",
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
      "dur": 15,
      "stage": "anchor",
      "look": "conclusion",
      "move": "pan",
      "drift": true,
      "zoom": 1,
      "visualDirection": "Pull back split screen: Chat window fades, glowing 3D world simulation.",
      "metaphor": "custom",
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
    "volume": 1
  }
};
