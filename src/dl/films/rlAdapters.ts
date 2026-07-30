import type { Film } from "../schema";

export const rlAdaptersFilm: Film = {
  "id": "rl-adapters",
  "title": "RL Adapters — Fine-Tuning with Reinforcement Learning",
  "fps": 30,
  "accent": "#635BFF",
  "chapters": [
    "definition",
    "architectures",
    "ppo vs grpo",
    "self learning"
  ],
  "canvas": {
    "nodes": [
      {
        "id": "base",
        "label": "frozen base model",
        "sub": "W (pretrained)",
        "x": 40,
        "y": 300,
        "w": 200,
        "h": 64
      },
      {
        "id": "adapter",
        "label": "RL adapter",
        "sub": "delta W (trainable)",
        "x": 340,
        "y": 300,
        "w": 200,
        "h": 64
      },
      {
        "id": "lora",
        "label": "LoRA / QLoRA",
        "sub": "delta W = B x A",
        "x": 640,
        "y": 100,
        "w": 200,
        "h": 64
      },
      {
        "id": "ppo",
        "label": "PPO & GRPO",
        "sub": "policy optimization",
        "x": 640,
        "y": 500,
        "w": 200,
        "h": 64
      },
      {
        "id": "loop",
        "label": "self-learning loop",
        "sub": "online RL updates",
        "x": 940,
        "y": 300,
        "w": 200,
        "h": 64
      }
    ],
    "edges": [
      {
        "from": "base",
        "to": "adapter",
        "dashed": false
      },
      {
        "from": "adapter",
        "to": "lora",
        "dashed": false
      },
      {
        "from": "adapter",
        "to": "ppo",
        "dashed": false
      },
      {
        "from": "lora",
        "to": "loop",
        "dashed": false
      },
      {
        "from": "ppo",
        "to": "loop",
        "dashed": true
      }
    ]
  },
  "shots": [
    {
      "id": "open",
      "dur": 9.84,
      "look": "base",
      "move": "cut",
      "stage": "frame",
      "zoom": 0.5,
      "drift": true,
      "scriptText": "Today we are going to talk about RL adaptors. An RL adapter is a small, trainable parameter module inserted into a large frozen pretrained model.",
      "blocks": [
        {
          "c": "TextReveal",
          "size": "display",
          "text": "RL Adapters",
          "accentWord": "Adapters"
        },
        {
          "c": "Body",
          "text": "Trainable deltas alongside frozen base models."
        }
      ]
    },
    {
      "id": "definition",
      "dur": 5.05,
      "look": "adapter",
      "move": "zoom-in",
      "stage": "anchor",
      "zoom": 0.6,
      "drift": false,
      "scriptText": "Only the adapter parameters receive gradients from the reinforcement learning objective.",
      "blocks": [
        {
          "c": "Kicker",
          "text": "section 01 · definition"
        },
        {
          "c": "TextReveal",
          "size": "headline",
          "text": "W_eff = W + delta W",
          "accentWord": "delta W"
        },
        {
          "c": "Body",
          "text": "Decouples core general capability from task-specific policy tuning."
        }
      ]
    },
    {
      "id": "lora",
      "dur": 10.26,
      "look": "lora",
      "move": "pan",
      "stage": "anchor",
      "zoom": 0.6,
      "drift": false,
      "scriptText": "LoRA decomposes delta W into B times A where rank r is typically 4 to 64. QLoRA applies LoRA on top of a 4-bit quantized base model.",
      "blocks": [
        {
          "c": "Kicker",
          "text": "section 02 · lora & qlora"
        },
        {
          "c": "TextReveal",
          "size": "headline",
          "text": "Low-Rank Parameter Efficiency",
          "accentWord": "Efficiency"
        },
        {
          "c": "MatrixGrid",
          "values": [
            [
              0.8,
              0.1
            ],
            [
              0.2,
              0.9
            ]
          ],
          "rowLabel": "B matrix",
          "colLabel": "A matrix",
          "sweep": "row"
        }
      ]
    },
    {
      "id": "algos",
      "dur": 9.3,
      "look": "ppo",
      "move": "pan",
      "stage": "anchor",
      "zoom": 0.6,
      "drift": false,
      "scriptText": "PPO uses advantage estimation and clips probability ratios. GRPO removes the critic model and uses group relative normalization to compute advantages.",
      "blocks": [
        {
          "c": "Kicker",
          "text": "section 04 · ppo vs grpo"
        },
        {
          "c": "TextReveal",
          "size": "headline",
          "text": "Policy Optimization Algorithms",
          "accentWord": "Policy"
        },
        {
          "c": "Distribution",
          "prompt": "Group Relative Policy Optimization",
          "items": [
            {
              "label": "PPO",
              "p": 0.4
            },
            {
              "label": "GRPO",
              "p": 0.6
            }
          ],
          "note": "GRPO eliminates separate critic network"
        }
      ]
    },
    {
      "id": "loop",
      "dur": 5.86,
      "look": "loop",
      "move": "zoom-out",
      "stage": "none",
      "zoom": 1,
      "drift": true,
      "scriptText": "Self-learning loops compute gradients only for adapter parameters while keeping the base model frozen and untouched.",
      "blocks": [
        {
          "c": "TextReveal",
          "size": "display",
          "text": "Self-Learning Iterative Loop",
          "accentWord": "Self-Learning"
        }
      ]
    }
  ],
  "voiceover": {
    "src": "voiceover.wav",
    "volume": 1
  },
  "captions": "captions.vtt"
};
