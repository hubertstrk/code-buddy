import http from "node:http";
import https from "node:https";

import { AngularConcisenessLevels } from "./concise-level/angular.js";
import { Personalities } from "./personalities.js";

export class LiveCoder {
  private readonly host: URL;
  private readonly model: string;
  private readonly conciseness: string;
  private readonly personality: string;

  constructor(opts: {
    host: URL;
    model: string;
    conciseness: string;
    personality: string;
  }) {
    this.host = opts.host;
    this.model = opts.model;
    this.conciseness = opts.conciseness;
    this.personality = opts.personality;
  }

  async summarizeFile(
    relativeFile: string,
    content: string,
    gitDiff: string,
    localDiff: string,
    ext: string
  ) {
    const prompt = this.buildPrompt(
      relativeFile,
      content,
      gitDiff,
      localDiff,
      ext,
      this.conciseness,
      this.personality
    );

    try {
      process.stdout.write("[ollama] ");
      await this.generate({ prompt });
      process.stdout.write("\n");
    } catch (err: any) {
      console.error("\n[ollama:error]", err?.message || err);
      console.error(
        "Hint: Ensure Ollama is running locally. Default: http://127.0.0.1:11434"
      );
    }
  }

  private async generate(body: { prompt: string }) {
    const url = new URL("/api/generate", this.host);
    const payload = JSON.stringify({
      model: this.model,
      prompt: body.prompt,
      stream: true,
    });

    const isHttps = url.protocol === "https:";
    const mod = isHttps ? https : http;

    await new Promise<void>((resolve, reject) => {
      const req = mod.request(
        {
          method: "POST",
          hostname: url.hostname,
          port: url.port || (isHttps ? 443 : 80),
          path: url.pathname,
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload),
          },
        },
        (res) => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}`));
            res.resume();
            return;
          }
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            try {
              const lines = chunk.toString().split(/\r?\n/).filter(Boolean);
              for (const line of lines) {
                const obj = JSON.parse(line);
                if (obj.response) process.stdout.write(String(obj.response));
                if (obj.done) {
                  resolve();
                }
              }
            } catch {
              // best-effort streaming
              process.stdout.write(chunk.toString());
            }
          });
          res.on("end", () => resolve());
        }
      );
      req.on("error", reject);
      req.write(payload);
      req.end();
    });
  }

  private buildPrompt(
    filename: string,
    fullContent: string,
    gitDiff: string,
    localDiff: string,
    ext: string,
    conciseness: string,
    personality: string
  ) {
    const lang = ext.replace(".", "");
    const snippet =
      fullContent.length > 10000
        ? fullContent.slice(0, 10000) + "\n... [truncated]"
        : fullContent;

    return `
  ${Personalities[personality]}

  ${AngularConcisenessLevels[conciseness]}

  File: ${filename}
  Language: ${lang}

  === Full File Content ===
  ${snippet}

  === Git Diff (vs HEAD) ===
  ${gitDiff}

  === Local Diff (since last change) ===
  ${localDiff}
  `;
  }
}
