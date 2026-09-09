/**
 * File Description: Shadow Film module for the "Why Diffusion Transformers (DiT) Replaced U-Net" video package.
 */
import type { Film } from "../schema";

export const whyDitReplacedUnetFilm: Film = {
  "schemaVersion": "1.0.0",
  "id": "why-dit-replaced-unet",
  "title": "Why Diffusion Transformers (DiT) Replaced U-Net",
  "fps": 30,
  "accent": "#635BFF",
  "theme": {
    "background": "smooth-dark",
    "fontFamily": "geist",
    "videoType": "educational",
    "storyStyle": "spatial-map",
    "cameraAngle": "flat",
    "accent": "#635BFF"
  },
  "chapters": [
    "The Hook",
    "The Convolution Ceiling",
    "The DiT Paradigm",
    "AdaLN-Zero Conditioning",
    "The Scaling Law Payoff"
  ],
  "canvas": {
    "nodes": [
      {
        "id": "intro",
        "label": "The Hook",
        "sub": "U-Net Era: 2022",
        "x": -360,
        "y": -140,
        "w": 200,
        "h": 64
      },
      {
        "id": "unet-conv",
        "label": "U-Net Backbone",
        "sub": "Local Convolutions",
        "x": -360,
        "y": 40,
        "w": 210,
        "h": 64
      },
      {
        "id": "unet-bottleneck",
        "label": "Multiscale Bottleneck",
        "sub": "Downsample / Upsample",
        "x": -140,
        "y": 180,
        "w": 220,
        "h": 64
      },
      {
        "id": "dit-patchify",
        "label": "Patchify",
        "sub": "Latents -> Visual Tokens",
        "x": 80,
        "y": 40,
        "w": 210,
        "h": 64
      },
      {
        "id": "vit-attention",
        "label": "ViT Self-Attention",
        "sub": "Global Token Relations",
        "x": 300,
        "y": -100,
        "w": 220,
        "h": 64
      },
      {
        "id": "adaln-zero",
        "label": "AdaLN-Zero",
        "sub": "Zero-Init Gated Conditioning",
        "x": 300,
        "y": 100,
        "w": 220,
        "h": 64
      },
      {
        "id": "scaling-law",
        "label": "Scaling Law",
        "sub": "More Compute -> Lower FID",
        "x": 80,
        "y": 260,
        "w": 210,
        "h": 64
      },
      {
        "id": "payoff",
        "label": "The New Standard",
        "sub": "Sora - Flux - SD3 - Movie Gen",
        "x": -140,
        "y": 340,
        "w": 230,
        "h": 64
      }
    ],
    "edges": [
      {
        "from": "intro",
        "to": "unet-conv"
      },
      {
        "from": "unet-conv",
        "to": "unet-bottleneck"
      },
      {
        "from": "unet-bottleneck",
        "to": "dit-patchify",
        "label": "replaced by"
      },
      {
        "from": "dit-patchify",
        "to": "vit-attention"
      },
      {
        "from": "vit-attention",
        "to": "adaln-zero"
      },
      {
        "from": "adaln-zero",
        "to": "scaling-law"
      },
      {
        "from": "scaling-law",
        "to": "payoff"
      },
      {
        "from": "intro",
        "to": "payoff",
        "dashed": true,
        "label": "today"
      }
    ]
  },
  "shots": [
    {
      "id": "hook-1",
      "dur": 2.913,
      "stage": "frame",
      "look": "intro",
      "move": "cut",
      "drift": true,
      "zoom": 1,
      "scriptText": "Every image AI you've heard of just swapped its brain.",
      "visualDirection": "Split canvas: left side holds a fading grid of 2022-era logos, right side holds a brightening grid of 2024-era logos.",
      "blocks": [
        {
          "c": "TextReveal",
          "text": "Every image AI you've heard of just swapped its brain.",
          "size": "display",
          "accentWord": "swapped"
        }
      ]
    },
    {
      "id": "hook-2",
      "dur": 8.22,
      "stage": "none",
      "look": [
        "intro",
        "unet-conv",
        "unet-bottleneck"
      ],
      "move": "pan",
      "drift": false,
      "zoom": 1,
      "scriptText": "In twenty twenty two, Stable Diffusion, Midjourney four, and Runway Gen-1 all ran on the same backbone: the convolutional U-Net.",
      "visualDirection": "Camera pulls back to reveal the full canvas graph, panning across the U-Net cluster.",
      "blocks": [
        {
          "c": "IconLabel",
          "text": "2022: SD, Midjourney v4, Gen-1 -> all U-Net"
        }
      ]
    },
    {
      "id": "conv-1",
      "dur": 7.762,
      "stage": "anchor",
      "look": "unet-conv",
      "move": "zoom-in",
      "drift": true,
      "zoom": 1.1,
      "scriptText": "U-Net denoises through a fixed hierarchy: local convolutions, downsampling, a bottleneck, then upsampling back out.",
      "visualDirection": "Zoom into the U-Net node; a layer stack builds bottom to top, tracing the classic hourglass shape.",
      "blocks": [
        {
          "c": "Kicker",
          "text": "THE CONVOLUTION CEILING"
        },
        {
          "c": "LayerStack",
          "bottomLabel": "Noisy Latent",
          "topLabel": "Denoised Latent",
          "layers": [
            "Conv 3x3",
            "Downsample",
            "Conv 3x3",
            "Bottleneck",
            "Conv 3x3",
            "Upsample",
            "Skip Concat",
            "Conv 3x3"
          ]
        },
        {
          "c": "Body",
          "text": "A fixed multiscale hierarchy: local kernels, downsampling, a bottleneck, then upsampling back out."
        }
      ]
    },
    {
      "id": "conv-2",
      "dur": 8.662,
      "stage": "anchor",
      "look": "unet-bottleneck",
      "move": "pan",
      "drift": true,
      "zoom": 1,
      "scriptText": "That hierarchy is a hardcoded inductive bias. It's efficient at small resolutions, but convolution compute hits a quality ceiling as scale grows.",
      "visualDirection": "Pan to the bottleneck node; a scale bar needle creeps toward the ceiling as resolution ticks climb.",
      "blocks": [
        {
          "c": "ScaleBar",
          "ticks": [
            "64px",
            "256px",
            "1024px",
            "4096px"
          ],
          "value": 0.3,
          "label": "Resolution Ceiling"
        },
        {
          "c": "Body",
          "text": "Hardcoded inductive bias: efficient small, but convolution compute hits a quality ceiling at scale."
        }
      ]
    },
    {
      "id": "conv-3",
      "dur": 3.021,
      "stage": "frame",
      "look": "unet-bottleneck",
      "move": "zoom-out",
      "drift": true,
      "zoom": 1,
      "scriptText": "Convolutions only ever see their local neighborhood.",
      "visualDirection": "Pull back to a single 3x3 kernel sliding over a patch of pixels; everything outside the patch stays dark.",
      "blocks": [
        {
          "c": "TextReveal",
          "text": "Convolutions only ever see their local neighborhood.",
          "size": "headline",
          "accentWord": "neighborhood"
        }
      ]
    },
    {
      "id": "transition-1",
      "dur": 3.732,
      "stage": "none",
      "look": [
        "unet-bottleneck",
        "dit-patchify"
      ],
      "move": "pan",
      "drift": false,
      "zoom": 1,
      "scriptText": "So the field looked at what worked in language, and started over.",
      "visualDirection": "Camera slides from the U-Net cluster toward the DiT cluster across the open canvas.",
      "blocks": [
        {
          "c": "Divider"
        }
      ]
    },
    {
      "id": "dit-1",
      "dur": 9.369,
      "stage": "anchor",
      "look": "dit-patchify",
      "move": "zoom-in",
      "drift": true,
      "zoom": 1.1,
      "scriptText": "A Diffusion Transformer treats an image exactly like a sentence. It slices the latent into two-by-two patches and flattens them into a sequence of visual tokens.",
      "visualDirection": "Latent grid fractures into 2x2 patch tiles, then straightens into a single horizontal token strip.",
      "blocks": [
        {
          "c": "Kicker",
          "text": "THE DIT PARADIGM"
        },
        {
          "c": "TokenStrip",
          "tokens": [
            "p1",
            "p2",
            "p3",
            "p4",
            "p5",
            "p6",
            "p7",
            "p8"
          ],
          "lit": [
            0,
            1,
            2,
            3,
            4,
            5,
            6,
            7
          ],
          "caption": "Latent cut into 2x2 patches, then flattened"
        },
        {
          "c": "Body",
          "text": "An image, treated exactly like a sentence of visual tokens."
        }
      ]
    },
    {
      "id": "dit-2",
      "dur": 7.83,
      "stage": "anchor",
      "look": "vit-attention",
      "move": "pan",
      "drift": true,
      "zoom": 1,
      "scriptText": "Standard Vision Transformer blocks then run self-attention across that sequence, so every patch can relate to every other patch directly.",
      "visualDirection": "Arcs sweep out from a focus token to every other token across the strip.",
      "blocks": [
        {
          "c": "AttentionArcs",
          "tokens": [
            "p1",
            "p2",
            "p3",
            "p4",
            "p5",
            "p6",
            "p7"
          ],
          "focus": 3,
          "links": [
            0,
            1,
            5,
            6
          ],
          "note": "Global self-attention across every patch"
        },
        {
          "c": "Body",
          "text": "Every patch can relate directly to every other patch, globally."
        }
      ]
    },
    {
      "id": "dit-3",
      "dur": 4.839,
      "stage": "frame",
      "look": "vit-attention",
      "move": "zoom-out",
      "drift": true,
      "zoom": 1,
      "scriptText": "No fixed neighborhood. No multiscale bottleneck. Just global attention.",
      "visualDirection": "The full token strip pulses once as every arc fires simultaneously.",
      "blocks": [
        {
          "c": "TextReveal",
          "text": "No fixed neighborhood. No multiscale bottleneck. Just global attention.",
          "size": "headline",
          "accentWord": "global"
        }
      ]
    },
    {
      "id": "adaln-1",
      "dur": 5.796,
      "stage": "anchor",
      "look": "adaln-zero",
      "move": "zoom-in",
      "drift": true,
      "zoom": 1.1,
      "scriptText": "Timestep t and prompt c modulate the block through adaptive layer norm, gate initialized at zero.",
      "visualDirection": "A gate curve draws itself from near-zero, climbing as training steps advance.",
      "blocks": [
        {
          "c": "Kicker",
          "text": "ADALN-ZERO CONDITIONING"
        },
        {
          "c": "Plot",
          "points": [
            [
              0,
              0.02
            ],
            [
              0.2,
              0.06
            ],
            [
              0.4,
              0.16
            ],
            [
              0.6,
              0.34
            ],
            [
              0.8,
              0.63
            ],
            [
              1,
              0.92
            ]
          ],
          "xLabel": "Training Steps",
          "yLabel": "Gate",
          "endLabel": "Learned Scale"
        },
        {
          "c": "Body",
          "text": "Timestep t and prompt c modulate the block through adaptive layer norm, gate initialized at zero."
        }
      ]
    },
    {
      "id": "adaln-2",
      "dur": 8.118,
      "stage": "frame",
      "look": "adaln-zero",
      "move": "pan",
      "drift": true,
      "zoom": 1,
      "scriptText": "The block starts as pure identity, then learns exactly how much to speak, replacing U-Net's tangle of cross-attention injection layers.",
      "visualDirection": "Two inputs, timestep and prompt embedding, flow into a single modulation gate icon.",
      "blocks": [
        {
          "c": "TextReveal",
          "text": "The block starts as pure identity, then learns exactly how much to speak.",
          "size": "headline"
        },
        {
          "c": "StatCounter",
          "to": 2,
          "label": "Conditioning Inputs: t + c",
          "format": "plain"
        }
      ]
    },
    {
      "id": "transition-2",
      "dur": 2.869,
      "stage": "none",
      "look": [
        "adaln-zero",
        "scaling-law"
      ],
      "move": "pan",
      "drift": false,
      "zoom": 1,
      "scriptText": "That simplicity is what let the architecture scale.",
      "visualDirection": "Camera slides on toward the scaling-law node, tracing the edge that connects them.",
      "blocks": [
        {
          "c": "Divider"
        }
      ]
    },
    {
      "id": "scaling-1",
      "dur": 10.127,
      "stage": "anchor",
      "look": "scaling-law",
      "move": "zoom-in",
      "drift": true,
      "zoom": 1.1,
      "scriptText": "Transformers obey scaling laws. More parameters, more compute, drive Frechet Inception Distance monotonically lower, with crisper text alignment at every step.",
      "visualDirection": "A quality curve rises smoothly and steadily as the compute axis extends right.",
      "blocks": [
        {
          "c": "Kicker",
          "text": "THE SCALING LAW PAYOFF"
        },
        {
          "c": "Plot",
          "points": [
            [
              0,
              0.08
            ],
            [
              0.2,
              0.22
            ],
            [
              0.4,
              0.4
            ],
            [
              0.6,
              0.58
            ],
            [
              0.8,
              0.78
            ],
            [
              1,
              0.95
            ]
          ],
          "xLabel": "Params / FLOPs",
          "yLabel": "Quality (1/FID)",
          "endLabel": "DiT-XL/2"
        },
        {
          "c": "Body",
          "text": "More parameters, more compute, monotonically lower FID and crisper text alignment."
        }
      ]
    },
    {
      "id": "close-1",
      "dur": 7.747,
      "stage": "frame",
      "look": "payoff",
      "move": "zoom-out",
      "drift": true,
      "zoom": 1,
      "scriptText": "Sora. Flux. SD3. Movie Gen. Every state of the art visual generator now runs the same architecture as your LLM.",
      "visualDirection": "Logos for Sora, Flux, SD3, and Movie Gen arrange around the payoff node, then settle.",
      "blocks": [
        {
          "c": "TextReveal",
          "text": "Sora. Flux. SD3. Movie Gen. Same architecture as your LLM.",
          "size": "display",
          "accentWord": "Same"
        }
      ]
    }
  ],
  "voiceover": {
    "src": "videos/why-dit-replaced-unet/voiceover.wav",
    "volume": 1
  },
  "captions": "videos/why-dit-replaced-unet/captions.vtt"
};
