import type { Film } from "../schema";

export const rlEnvironmentsFilm: Film = {
  "id": "rl-environments",
  "title": "RL Environments — The AI Playground",
  "fps": 30,
  "accent": "#10B981",
  "chapters": [
    "definition",
    "dynamic duo",
    "four pillars",
    "reality",
    "frameworks",
    "challenges"
  ],
  "canvas": {
    "nodes": [
      {
        "id": "matrix",
        "label": "RL Playground",
        "sub": "Interactive World",
        "x": 40,
        "y": 300,
        "w": 200,
        "h": 64
      },
      {
        "id": "env",
        "label": "Environment (World)",
        "sub": "Physics & Rules",
        "x": 340,
        "y": 180,
        "w": 220,
        "h": 64
      },
      {
        "id": "state-space",
        "label": "State & Action Space",
        "sub": "Observations (S) & Choices (A)",
        "x": 640,
        "y": 180,
        "w": 240,
        "h": 64
      },
      {
        "id": "obs",
        "label": "Observability",
        "sub": "Full vs Partial",
        "x": 640,
        "y": 420,
        "w": 220,
        "h": 64
      },
      {
        "id": "tools",
        "label": "Frameworks",
        "sub": "Gymnasium, MuJoCo, Isaac",
        "x": 940,
        "y": 180,
        "w": 240,
        "h": 64
      },
      {
        "id": "challenges",
        "label": "Sim2Real & Hacking",
        "sub": "Real-world Hurdles",
        "x": 940,
        "y": 420,
        "w": 240,
        "h": 64
      }
    ],
    "edges": [
      {
        "from": "matrix",
        "to": "env",
        "dashed": false
      },
      {
        "from": "env",
        "to": "state-space",
        "dashed": false
      },
      {
        "from": "env",
        "to": "obs",
        "dashed": false
      },
      {
        "from": "state-space",
        "to": "tools",
        "dashed": false
      },
      {
        "from": "obs",
        "to": "challenges",
        "dashed": true
      }
    ]
  },
  "shots": [
    {
      "id": "hook",
      "dur": 18.68,
      "look": "matrix",
      "move": "cut",
      "stage": "anchor",
      "zoom": 0.45,
      "drift": true,
      "scriptText": "Welcome to the Matrix! Imagine a world where a digital brain doesn't just follow instructions, but actually learns by doing. In Reinforcement Learning, we give the machine a playground, a goal, and the freedom to fail until it succeeds. Today, we're diving into the heart of that playground: the RL Environment!",
      "blocks": [
        {
          "c": "Kicker",
          "text": "⚡ VISUAL HOOK · WELCOME TO THE MATRIX"
        },
        {
          "c": "TextReveal",
          "size": "display",
          "text": "WELCOME TO THE MATRIX!",
          "accentWord": "MATRIX!"
        },
        {
          "c": "MatrixGrid",
          "values": [
            [
              1,
              1,
              0
            ],
            [
              0,
              1,
              1
            ],
            [
              1,
              0,
              1
            ]
          ],
          "rowLabel": "Neural State",
          "colLabel": "Action Matrix",
          "sweep": "row"
        },
        {
          "c": "IconLabel",
          "text": "REINFORCEMENT LEARNING · EMBODIED AI PLAYGROUND"
        }
      ]
    },
    {
      "id": "duo",
      "dur": 17.4,
      "look": "env",
      "move": "zoom-in",
      "stage": "anchor",
      "zoom": 0.6,
      "drift": false,
      "scriptText": "At its core, RL is a conversation between two main characters: the Agent and the Environment. Think of the Agent as the student and the Environment as the entire universe it lives in. This interaction is a constant loop called a Markov Decision Process: State, Action, and Reward!",
      "blocks": [
        {
          "c": "Kicker",
          "text": "section 01 · dynamic duo"
        },
        {
          "c": "TextReveal",
          "size": "headline",
          "text": "Agent meets Environment",
          "accentWord": "Environment"
        },
        {
          "c": "Distribution",
          "prompt": "Markov Decision Process Loop",
          "items": [
            {
              "label": "State (S)",
              "p": 0.33
            },
            {
              "label": "Action (A)",
              "p": 0.33
            },
            {
              "label": "Reward (R)",
              "p": 0.34
            }
          ],
          "note": "Continuous feedback loop"
        }
      ]
    },
    {
      "id": "pillars",
      "dur": 20.4,
      "look": "state-space",
      "move": "pan",
      "stage": "frame",
      "zoom": 0.6,
      "drift": false,
      "scriptText": "To make this magic happen, every environment needs four specific things. First, the State Space—everything the agent can see. Second, the Action Space—the menu of choices. Third, the Reward Signal—telling the agent it's doing well. And finally, Transition Dynamics—the rules moving to the next state.",
      "blocks": [
        {
          "c": "Kicker",
          "text": "section 02 · four pillars"
        },
        {
          "c": "TextReveal",
          "size": "headline",
          "text": "The Four Pillars of the Playground",
          "accentWord": "Pillars"
        },
        {
          "c": "LayerStack",
          "count": 4,
          "bottomLabel": "1. State Space",
          "topLabel": "4. Transition Dynamics"
        }
      ]
    },
    {
      "id": "reality",
      "dur": 14.21,
      "look": "obs",
      "move": "pan",
      "stage": "none",
      "zoom": 0.6,
      "drift": false,
      "scriptText": "Not all environments are created equal! Some are Fully Observable, like Chess. Others are Partially Observable, like Poker. We also have Deterministic worlds and Stochastic worlds filled with randomness, plus multi-agent showdowns!",
      "blocks": [
        {
          "c": "Kicker",
          "text": "section 03 · reality"
        },
        {
          "c": "TextReveal",
          "size": "headline",
          "text": "The Many Faces of Reality",
          "accentWord": "Reality"
        },
        {
          "c": "MatrixGrid",
          "values": [
            [
              1,
              0
            ],
            [
              0,
              1
            ]
          ],
          "rowLabel": "Observable",
          "colLabel": "Stochastic",
          "sweep": "row"
        }
      ]
    },
    {
      "id": "tools",
      "dur": 15.08,
      "look": "tools",
      "move": "zoom-in",
      "stage": "anchor",
      "zoom": 0.6,
      "drift": false,
      "scriptText": "How do researchers build these? Gymnasium is the industry standard for games and physics. MuJoCo provides high-fidelity robotics physics, NVIDIA Isaac Gym enables GPU-parallel training, and Unity creates complex 3D worlds!",
      "blocks": [
        {
          "c": "Kicker",
          "text": "section 04 · frameworks"
        },
        {
          "c": "TextReveal",
          "size": "headline",
          "text": "Power Tools of AI",
          "accentWord": "Tools"
        },
        {
          "c": "IconLabel",
          "text": "Gymnasium · MuJoCo · Isaac Gym · Unity 3D"
        }
      ]
    },
    {
      "id": "hurdles",
      "dur": 14.5,
      "look": "matrix",
      "move": "zoom-out",
      "stage": "anchor",
      "zoom": 0.5,
      "drift": true,
      "scriptText": "We face massive hurdles like the Sim2Real Gap, where a simulation genius becomes a real-world klutz. And Reward Hacking, where agents find unexpected loopholes! Solving these makes RL one of technology's most exciting frontiers.",
      "blocks": [
        {
          "c": "Kicker",
          "text": "section 05 · challenges"
        },
        {
          "c": "TextReveal",
          "size": "display",
          "text": "Sim2Real Gap & Reward Hacking",
          "accentWord": "Hacking"
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
