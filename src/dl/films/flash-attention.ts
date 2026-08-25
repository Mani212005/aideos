import type { Film } from "../schema";

export const flashAttentionFilm: Film = {
  "id": "flash-attention",
  "title": "Understanding FlashAttention",
  "fps": 30,
  "accent": "#635BFF",
  "theme": {
    "background": "dot-grid",
    "fontFamily": "geist",
    "storyStyle": "script-metaphor",
    "cameraAngle": "isometric",
    "accent": "#635BFF"
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
        "label": "Understanding FlashAttention",
        "x": -200,
        "y": -100,
        "w": 230,
        "h": 70
      },
      {
        "id": "mechanism",
        "label": "Core Concept",
        "x": 160,
        "y": -100,
        "w": 230,
        "h": 70
      },
      {
        "id": "system",
        "label": "System Flow",
        "x": 160,
        "y": 150,
        "w": 230,
        "h": 70
      },
      {
        "id": "result",
        "label": "Key Payoff",
        "x": -200,
        "y": 150,
        "w": 230,
        "h": 70
      }
    ],
    "edges": [
      {
        "from": "intro",
        "to": "mechanism",
        "dashed": false
      },
      {
        "from": "mechanism",
        "to": "system",
        "dashed": false
      },
      {
        "from": "system",
        "to": "result",
        "dashed": true
      }
    ]
  },
  "shots": [
    {
      "id": "shot-1",
      "dur": 8,
      "look": "intro",
      "move": "cut",
      "stage": "anchor",
      "zoom": 1,
      "drift": true,
      "blocks": [
        {
          "c": "TextReveal",
          "text": "Understanding FlashAttention",
          "size": "headline"
        }
      ]
    },
    {
      "id": "shot-2",
      "dur": 10,
      "look": "mechanism",
      "move": "pan",
      "stage": "frame",
      "zoom": 1.1,
      "drift": true,
      "blocks": [
        {
          "c": "Body",
          "text": "Visualizing the fundamental idea and mechanics."
        }
      ]
    },
    {
      "id": "shot-3",
      "dur": 12,
      "look": "system",
      "move": "pan",
      "stage": "frame",
      "zoom": 1.15,
      "drift": true,
      "blocks": [
        {
          "c": "StatCounter",
          "to": 10,
          "label": "Performance Gain",
          "format": "plain",
          "suffix": "x"
        }
      ]
    },
    {
      "id": "shot-4",
      "dur": 8,
      "look": "result",
      "move": "zoom-out",
      "stage": "anchor",
      "zoom": 0.9,
      "drift": false,
      "blocks": [
        {
          "c": "Body",
          "text": "Summary and key takeaways."
        }
      ]
    }
  ]
};
