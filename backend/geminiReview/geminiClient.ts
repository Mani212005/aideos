/**
 * File Description: Direct Gemini REST client for resumable video file uploads,
 * active state polling, and model generation with gemini-3.8-flash and exponential retry backoff.
 */

import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ quiet: true });

export interface GeminiClientOptions {
  apiKey?: string;
  model?: string;
  fallbackModel?: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
  sleepFn?: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
  maxRetries?: number;
  baseBackoffMs?: number;
  onProgress?: (message: string) => void;
}

export interface UploadedFileResult {
  name: string;
  uri: string;
  state: "ACTIVE" | "PROCESSING" | "FAILED";
}

// Default sleep implementation using setTimeout.
function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class GeminiVideoClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fallbackModel?: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly sleepFn: (ms: number) => Promise<void>;
  private readonly pollIntervalMs: number;
  private readonly maxRetries: number;
  private readonly baseBackoffMs: number;
  private readonly onProgress?: (message: string) => void;

  constructor(options?: GeminiClientOptions) {
    this.apiKey = options?.apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
    this.model = options?.model || process.env.AIDEOS_GEMINI_REVIEW_MODEL || process.env.GEMINI_MODEL || "gemini-3.8-flash";
    this.fallbackModel = options?.fallbackModel || process.env.AIDEOS_GEMINI_FALLBACK_MODEL || "gemini-2.5-flash";
    this.baseUrl = options?.baseUrl || "https://generativelanguage.googleapis.com";
    this.fetchFn = options?.fetchFn || fetch;
    this.sleepFn = options?.sleepFn || defaultSleep;
    this.pollIntervalMs = options?.pollIntervalMs ?? 5000;
    this.maxRetries = options?.maxRetries ?? 6;
    this.baseBackoffMs = options?.baseBackoffMs ?? 10000;
    this.onProgress = options?.onProgress;
  }

  // Executes an HTTP request with automatic retry and backoff on 500, 503, and 429 errors.
  private async requestWithRetry(
    url: string,
    init: RequestInit,
    operationName: string,
  ): Promise<Response> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.fetchFn(url, init);

        if (response.ok) {
          return response;
        }

        const errorText = await response.text().catch(() => "");
        if (
          response.status === 429 &&
          errorText.includes("GenerateRequestsPerDayPerProjectPerModel-FreeTier")
        ) {
          throw new Error(
            `${operationName} failed with HTTP 429: ${errorText || response.statusText}`,
          );
        }

        const isRetryableStatus = [429, 500, 503].includes(response.status);

        if (isRetryableStatus && attempt < this.maxRetries) {
          let backoff = this.baseBackoffMs * attempt;
          if (response.status === 429) {
            const match = errorText.match(/retry in ([0-9.]+)s/i);
            if (match) {
              const seconds = parseFloat(match[1]);
              if (!isNaN(seconds) && seconds > 0) {
                backoff = Math.ceil(seconds * 1000) + 2000;
              }
            } else {
              const retryAfter = response.headers.get("retry-after");
              if (retryAfter) {
                const sec = parseFloat(retryAfter);
                if (!isNaN(sec) && sec > 0) {
                  backoff = Math.ceil(sec * 1000) + 1000;
                }
              } else {
                backoff = Math.max(backoff, 25000);
              }
            }
          }
          this.onProgress?.(`  HTTP ${response.status} during ${operationName}. Waiting ${(backoff / 1000).toFixed(1)}s (attempt ${attempt} of ${this.maxRetries})...`);
          await this.sleepFn(backoff);
          continue;
        }

        throw new Error(
          `${operationName} failed with HTTP ${response.status}: ${errorText || response.statusText}`,
        );
      } catch (err) {
        lastError = err;
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("GenerateRequestsPerDayPerProjectPerModel-FreeTier")) {
          throw err;
        }
        const isNetworkOrRetryable =
          msg.includes("fetch failed") ||
          msg.includes("ECONNRESET") ||
          msg.includes("ETIMEDOUT") ||
          msg.includes("HTTP 500") ||
          msg.includes("HTTP 503") ||
          msg.includes("HTTP 429");

        if (isNetworkOrRetryable && attempt < this.maxRetries) {
          let backoff = this.baseBackoffMs * attempt;
          const match = msg.match(/retry in ([0-9.]+)s/i);
          if (match) {
            const seconds = parseFloat(match[1]);
            if (!isNaN(seconds) && seconds > 0) {
              backoff = Math.ceil(seconds * 1000) + 2000;
            }
          }
          this.onProgress?.(`  Network retry during ${operationName}. Waiting ${(backoff / 1000).toFixed(1)}s (attempt ${attempt} of ${this.maxRetries})...`);
          await this.sleepFn(backoff);
          continue;
        }

        throw err;
      }
    }

    throw lastError;
  }

  // Uploads an mp4 video file using Gemini resumable protocol and waits until state is ACTIVE.
  async uploadVideo(videoPath: string, displayName?: string): Promise<UploadedFileResult> {
    if (!this.apiKey) {
      throw new Error("GEMINI_API_KEY is not set. Cannot upload video to Gemini Files endpoint.");
    }

    const resolvedPath = path.resolve(videoPath);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Video file not found at path: ${resolvedPath}`);
    }

    const stat = fs.statSync(resolvedPath);
    const size = stat.size;
    const name = displayName || path.basename(resolvedPath);

    // Step 1: Initialize resumable upload session
    const startUrl = `${this.baseUrl}/upload/v1beta/files?key=${this.apiKey}`;
    const startResponse = await this.requestWithRetry(
      startUrl,
      {
        method: "POST",
        headers: {
          "X-Goog-Upload-Protocol": "resumable",
          "X-Goog-Upload-Command": "start",
          "X-Goog-Upload-Header-Content-Length": String(size),
          "X-Goog-Upload-Header-Content-Type": "video/mp4",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ file: { display_name: name } }),
      },
      "Start resumable upload",
    );

    const uploadUrl =
      startResponse.headers.get("x-goog-upload-url") ||
      startResponse.headers.get("X-Goog-Upload-URL");

    if (!uploadUrl) {
      throw new Error("Gemini resumable upload did not return X-Goog-Upload-URL header.");
    }

    // Step 2: Upload raw video binary content
    const fileBytes = fs.readFileSync(resolvedPath);
    const uploadResponse = await this.requestWithRetry(
      uploadUrl,
      {
        method: "POST",
        headers: {
          "X-Goog-Upload-Offset": "0",
          "X-Goog-Upload-Command": "upload, finalize",
          "Content-Length": String(size),
          "Content-Type": "video/mp4",
        },
        body: fileBytes,
      },
      "Upload video bytes",
    );

    const uploadJson = (await uploadResponse.json()) as {
      file?: { name: string; uri: string; state: string };
      name?: string;
      uri?: string;
      state?: string;
    };
    let currentFile = uploadJson.file || (uploadJson.name && uploadJson.uri ? (uploadJson as { name: string; uri: string; state: string }) : undefined);

    if (!currentFile) {
      throw new Error("Unexpected empty file metadata received from Gemini upload response.");
    }

    // Step 3: Poll status until file reaches ACTIVE state
    while (currentFile.state === "PROCESSING") {
      await this.sleepFn(this.pollIntervalMs);
      const pollUrl = `${this.baseUrl}/v1beta/${currentFile.name}?key=${this.apiKey}`;
      const pollResponse = await this.requestWithRetry(pollUrl, { method: "GET" }, "Poll file status");
      const pollJson = (await pollResponse.json()) as { name: string; uri: string; state: string; error?: { message?: string } };
      currentFile = pollJson;

      if (currentFile.state === "FAILED") {
        throw new Error(
          `Gemini video processing failed: ${pollJson.error?.message || "Internal processing error"}`,
        );
      }
    }

    if (currentFile.state !== "ACTIVE") {
      throw new Error(`Gemini video upload ended in unexpected state: ${currentFile.state}`);
    }

    return {
      name: currentFile.name,
      uri: currentFile.uri,
      state: "ACTIVE",
    };
  }

  // Generates structured content from a single uploaded video file URI and text prompt.
  async generateContentWithVideo(
    fileUri: string,
    prompt: string,
    options?: {
      temperature?: number;
      systemInstruction?: string;
    },
  ): Promise<string> {
    if (!this.apiKey) {
      throw new Error("GEMINI_API_KEY is not set. Cannot run video review model.");
    }

    const parts: Array<{ text?: string; file_data?: { mime_type: string; file_uri: string } }> = [
      {
        file_data: {
          mime_type: "video/mp4",
          file_uri: fileUri,
        },
      },
      {
        text: prompt,
      },
    ];

    const bodyPayload: Record<string, unknown> = {
      contents: [{ role: "user", parts }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: options?.temperature ?? 0.1,
      },
    };

    if (options?.systemInstruction) {
      bodyPayload.systemInstruction = {
        parts: [{ text: options.systemInstruction }],
      };
    }

    let activeModel = this.model;
    let url = `${this.baseUrl}/v1beta/models/${activeModel}:generateContent?key=${this.apiKey}`;
    let response: Response;

    try {
      response = await this.requestWithRetry(
        url,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(bodyPayload),
        },
        `Generate content with model ${activeModel}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes("GenerateRequestsPerDayPerProjectPerModel-FreeTier") &&
        this.fallbackModel &&
        activeModel !== this.fallbackModel
      ) {
        this.onProgress?.(`  Daily free-tier quota exhausted for ${activeModel} (20 RPD limit). Falling back to ${this.fallbackModel}...`);
        activeModel = this.fallbackModel;
        url = `${this.baseUrl}/v1beta/models/${activeModel}:generateContent?key=${this.apiKey}`;
        response = await this.requestWithRetry(
          url,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(bodyPayload),
          },
          `Generate content with model ${activeModel}`,
        );
      } else {
        throw err;
      }
    }

    const data = (await response.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
    };

    const textPart = data.candidates?.[0]?.content?.parts?.find((p) => typeof p.text === "string");
    return textPart?.text || "";
  }

  // Generates comparison judgment from two uploaded video file URIs in a specified order.
  async generateContentPairwise(
    fileUri1: string,
    fileUri2: string,
    prompt: string,
    options?: {
      temperature?: number;
    },
  ): Promise<string> {
    if (!this.apiKey) {
      throw new Error("GEMINI_API_KEY is not set. Cannot run pairwise video comparison.");
    }

    const parts = [
      { text: "Video 1:" },
      { file_data: { mime_type: "video/mp4", file_uri: fileUri1 } },
      { text: "Video 2:" },
      { file_data: { mime_type: "video/mp4", file_uri: fileUri2 } },
      { text: prompt },
    ];

    const bodyPayload = {
      contents: [{ role: "user", parts }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: options?.temperature ?? 0.1,
      },
    };

    let activeModel = this.model;
    let url = `${this.baseUrl}/v1beta/models/${activeModel}:generateContent?key=${this.apiKey}`;
    let response: Response;

    try {
      response = await this.requestWithRetry(
        url,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(bodyPayload),
        },
        `Generate pairwise comparison with model ${activeModel}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes("GenerateRequestsPerDayPerProjectPerModel-FreeTier") &&
        this.fallbackModel &&
        activeModel !== this.fallbackModel
      ) {
        this.onProgress?.(`  Daily free-tier quota exhausted for ${activeModel} (20 RPD limit). Falling back to ${this.fallbackModel}...`);
        activeModel = this.fallbackModel;
        url = `${this.baseUrl}/v1beta/models/${activeModel}:generateContent?key=${this.apiKey}`;
        response = await this.requestWithRetry(
          url,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(bodyPayload),
          },
          `Generate pairwise comparison with model ${activeModel}`,
        );
      } else {
        throw err;
      }
    }

    const data = (await response.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
    };

    const textPart = data.candidates?.[0]?.content?.parts?.find((p) => typeof p.text === "string");
    return textPart?.text || "";
  }
}
