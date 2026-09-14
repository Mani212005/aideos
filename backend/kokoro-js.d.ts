/**
 * File Description: Ambient declaration for kokoro-js. The package ships its types behind an
 * "exports" map that the repo's classic "node" moduleResolution cannot follow, so the surface
 * the narration pipeline actually uses is declared here instead of loosening tsconfig for
 * every module in the project.
 */

declare module "kokoro-js" {
  /** Raw mono PCM handed back by a generate() call. */
  export interface KokoroRawAudio {
    audio: Float32Array;
    sampling_rate: number;
  }

  /** Loaded Kokoro model instance. */
  export class KokoroTTS {
    static from_pretrained(
      modelId: string,
      options?: { dtype?: string; device?: string },
    ): Promise<KokoroTTS>;
    readonly voices: Record<string, unknown>;
    generate(text: string, options?: { voice?: string; speed?: number }): Promise<KokoroRawAudio>;
  }
}
