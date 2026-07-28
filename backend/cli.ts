import { Command } from "commander";
import OpenAI from "openai";
import fs from "fs/promises";
import path from "path";
import { execSync } from "child_process";
import dotenv from "dotenv";

dotenv.config();

const program = new Command();
program
  .name("aideos-backend")
  .description("Generate and render Aideos films from natural language")
  .version("1.0.0");

const openai = new OpenAI();

const blockDescriptions = `
Valid blocks (c):
- Kicker: { c: "Kicker", text: string }
- TextReveal: { c: "TextReveal", text: string, size?: "display"|"headline"|"subhead", accentWord?: string }
- Body: { c: "Body", text: string }
- Math: { c: "Math", text: string }
- StatCounter: { c: "StatCounter", to: number, label: string, format?: "plain"|"compact", suffix?: string }
- ProgressBar: { c: "ProgressBar", value: number, label?: string, chapters?: number }
- Plot: { c: "Plot", points: [number, number][], xLabel?: string, yLabel?: string, endLabel?: string }
- MatrixGrid: { c: "MatrixGrid", values: number[][], rowLabel?: string, colLabel?: string, valueLabel?: string, sweep?: "row"|"cell" }
- Distribution: { c: "Distribution", prompt?: string, items: { label: string, p: number }[], note?: string }
- TokenStrip: { c: "TokenStrip", tokens: string[], lit?: number[], caption?: string }
- AttentionArcs: { c: "AttentionArcs", tokens: string[], focus: number, links: number[], note?: string }
- VectorSpace: { c: "VectorSpace", points: {x: number, y: number, label?: string}[], arrow?: {from: number, to: number, label: string}, xLabel?: string, yLabel?: string }
- LayerStack: { c: "LayerStack", count?: number, bottomLabel?: string, topLabel?: string }
- ScaleBar: { c: "ScaleBar", ticks: string[], value: number, label?: string }
- AnalogyInset: { c: "AnalogyInset", caption: string, src?: string }
- Card: { c: "Card", title: string, body?: string, state?: "idle"|"active" }
- Divider: { c: "Divider" }
- IconLabel: { c: "IconLabel", text: string }
`;

// Basic JSON Schema mapping for the Film Tool
const filmFunctionSchema = {
  name: "generate_aideos_film",
  description: "Generates an Aideos Film JSON structure representing canvas nodes, shots, and blocks.",
  parameters: {
    type: "object",
    properties: {
      id: { type: "string" },
      title: { type: "string" },
      fps: { type: "number", enum: [24, 30, 60] },
      chapters: { type: "array", items: { type: "string" } },
      canvas: {
        type: "object",
        properties: {
          nodes: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                label: { type: "string" },
                sub: { type: "string" },
                x: { type: "number" },
                y: { type: "number" },
                w: { type: "number" },
                h: { type: "number" }
              },
              required: ["id", "label", "x", "y"]
            }
          },
          edges: {
            type: "array",
            items: {
              type: "object",
              properties: {
                from: { type: "string" },
                to: { type: "string" },
                dashed: { type: "boolean" }
              },
              required: ["from", "to"]
            }
          }
        },
        required: ["nodes", "edges"]
      },
      shots: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            dur: { type: "number", description: "Duration in seconds" },
            look: {
              anyOf: [
                { type: "string" },
                { type: "array", items: { type: "string" } }
              ]
            },
            move: { type: "string", enum: ["pan", "zoom-in", "zoom-out", "hold", "cut"] },
            drift: { type: "boolean" },
            stage: { type: "string", enum: ["anchor", "frame", "none"] },
            zoom: { type: "number" },
            blocks: {
              type: "array",
              description: blockDescriptions,
              items: {
                type: "object",
                properties: {
                  c: { type: "string" }
                },
                required: ["c"],
                additionalProperties: true
              }
            }
          },
          required: ["id", "dur", "look", "move", "stage", "blocks"]
        }
      }
    },
    required: ["id", "title", "fps", "chapters", "canvas", "shots"]
  }
};

program
  .command("generate")
  .description("Generate an Aideos film from a prompt")
  .argument("<prompt>", "Natural language description of the video")
  .action(async (prompt) => {
    console.log(`Generating film for prompt: "${prompt}"...`);

    const runner = await openai.chat.completions.create({
      model: "gpt-4o-2024-08-06",
      messages: [
        {
          role: "system",
          content: `You are an expert at generating Aideos Film configurations. Create a visually engaging explainer video.
Make sure all nodes referenced in shots or edges exist in the canvas nodes.
Ensure shots follow pacing guidelines: 
- No device holding past 25s.
- Device blocks: MatrixGrid, Distribution, TokenStrip, AttentionArcs, VectorSpace, LayerStack, ScaleBar, AnalogyInset, Plot.
- Don't use the same device twice in a row.
- Have a text beat (stage: "frame") every 60-90s.
- Return to canvas (stage: "none") every 60-90s.
- Provide realistic 2D coordinates for nodes (e.g. x: 0..2000, y: 0..1000).`
        },
        { role: "user", content: prompt }
      ],
      tools: [
        {
          type: "function",
          function: filmFunctionSchema
        }
      ],
      tool_choice: { type: "function", function: { name: "generate_aideos_film" } }
    });

    const toolCall = runner.choices[0].message.tool_calls?.[0];
    if (!toolCall || toolCall.type !== "function") {
      console.error("Failed to generate film JSON.");
      return;
    }

    const filmJson = JSON.parse(toolCall.function.arguments);
    const outputPath = path.join(process.cwd(), "src/dl/films/generated.ts");
    const exportContent = `import type { Film } from "../schema";\n\nexport const generatedFilm: Film = ${JSON.stringify(filmJson, null, 2)};\n`;

    await fs.writeFile(outputPath, exportContent, "utf-8");
    console.log(`Saved generated film to ${outputPath}`);
    
    // Update activeFilm.ts to point to generatedFilm
    const activeFilmPath = path.join(process.cwd(), "src/dl/activeFilm.ts");
    const activeFilmContent = `import { generatedFilm } from "./films/generated";\nimport type { Film } from "./schema";\n\nexport const ACTIVE_FILM: Film = generatedFilm;\n`;
    await fs.writeFile(activeFilmPath, activeFilmContent, "utf-8");
    console.log(`Updated activeFilm.ts to use generatedFilm.`);

    console.log(`Validating...`);
    try {
      execSync("npm run validate", { stdio: "inherit" });
      console.log(`Validation successful.`);
    } catch (err) {
      console.error("Validation failed.");
      process.exit(1);
    }

    console.log(`Rendering video...`);
    try {
      execSync("npm run render", { stdio: "inherit" });
      console.log(`Render complete.`);
    } catch (err) {
      console.error("Render failed.");
      process.exit(1);
    }
  });

program.parse();
