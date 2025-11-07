#!/usr/bin/env node
import chokidar from "chokidar";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import http from "node:http";
import https from "node:https";
import { hideBin } from "yargs/helpers";
import yargs from "yargs/yargs";
import { AngularConcisenessLevels } from "./concise-level/angular.js";
import { Personalities } from "./personalities.js";
import * as simpleGitModule from "simple-git";
const git = simpleGitModule.simpleGit;
const gitInstance = git();

import { existsDir } from "./helper.js";
import { CliArgs } from "./model.js";

const DEFAULT_HOST = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || "phi4-mini";
const DEFAULT_CONSICENESS = process.env.CONSICENESS || "standard";
const DEFAULT_PERSONALITY = process.env.PERSONALITY || "neutral";

function resolveUrl(urlStr: string): URL {
  try {
    return new URL(urlStr);
  } catch {
    return new URL("http://127.0.0.1:11434");
  }
}

async function main() {
  const argv = yargs(hideBin(process.argv))
    .scriptName("code-buddy")
    .usage("Usage: $0 -w <folder> [options]")
    .option("watch", {
      alias: "w",
      describe: "Folder to watch for live coding",
      type: "string",
      demandOption: true,
    })
    .option("model", {
      alias: "m",
      describe: "Ollama model to use",
      type: "string",
      default: DEFAULT_MODEL,
    })
    .option("conciseness", {
      alias: "c",
      describe:
        "The conciseness level of the AI model [compact, standard (default), exhaustive]",
      type: "string",
      default: DEFAULT_CONSICENESS,
    })
    .option("personality", {
      alias: "p",
      describe: "The AI personality style [rude, neutral (default), cheerful]",
      type: "string",
      default: DEFAULT_PERSONALITY,
    })
    .option("host", {
      alias: "h",
      describe: "Ollama host (e.g., http://127.0.0.1:11434)",
      type: "string",
      default: DEFAULT_HOST,
    })
    .option("pattern", {
      alias: "ip",
      describe: 'Glob pattern to include (e.g., "**/*.ts")',
      type: "string",
    })
    .option("ignore", {
      alias: "i",
      describe: "Glob patterns to ignore (comma separated)",
      type: "string",
    })
    .help()
    .alias("help", "help")
    .epilog(
      "code-buddy — watches files and streams insights from your local Ollama LLM"
    )
    .parseSync() as unknown as CliArgs;

  const watchDir = path.resolve(argv.watch);
  const exists = await existsDir(watchDir);
  if (!exists) {
    console.error(`Error: Watch folder does not exist: ${watchDir}`);
    process.exit(1);
  }
  // set git cwd to watch dir
  gitInstance.cwd(watchDir);

  const hostUrl = resolveUrl(argv.host || DEFAULT_HOST);
  const ignoreGlobs = parseList(argv.ignore) ?? [
    "**/node_modules/**",
    "**/.git/**",
    "**/.DS_Store",
  ];
  const includePattern = argv.pattern ?? "**/*.{ts,html,vue,json,md}";
  const conciseness = argv.conciseness || DEFAULT_CONSICENESS;
  const personality = argv.personality || DEFAULT_PERSONALITY;

  console.log(`[code-buddy] Watching: ${watchDir} (${includePattern})`);
  console.log("[code-buddy] Ollama:", `${hostUrl.origin} model=${argv.model}`);
  console.log("[code-buddy] Conciseness:", conciseness);
  console.log("[code-buddy] Personality:", personality);

  const watcher = chokidar.watch(includePattern, {
    cwd: watchDir,
    ignored: ignoreGlobs,
    persistent: true,
    ignoreInitial: false,
    awaitWriteFinish: {
      stabilityThreshold: 250,
      pollInterval: 250,
    },
  });

  const live = new LiveCoder({
    host: hostUrl,
    model: argv.model,
    conciseness,
    personality,
  });

  watcher
    // .on("add", (file) => onEvent("added", file, live, watchDir))
    .on("change", (file) => onEvent("changed", file, live, watchDir))
    .on("error", (err) => console.error("[watcher:error]", err));

  process.on("SIGINT", () => {
    console.log("\n[code-buddy] Shutting down...");
    watcher.close().then(() => process.exit(0));
  });
}

function parseList(input?: string | string[]): string[] | undefined {
  if (!input) return undefined;
  if (Array.isArray(input)) return input;
  return input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const baselines = new Map<string, string>(); // abs path -> original baseline content

async function onEvent(
  kind: "added" | "changed",
  relativeFile: string,
  live: LiveCoder,
  baseDir: string
) {
  console.log(`[file:${kind}] ${relativeFile}`);
  const abs = path.resolve(baseDir, relativeFile);
  const ext = path.extname(abs).toLowerCase();
  const content = await fs.readFile(abs, "utf8");

  console.log(`[file:${kind}] ${relativeFile}`);

  // -----------------------------
  // 1️⃣ Git HEAD baseline
  // -----------------------------
  let headContent = "";
  if (await fileExistsInHEAD(relativeFile)) {
    headContent = await gitInstance.show([`HEAD:${relativeFile}`]);
  }

  // -----------------------------
  // 2️⃣ Local baseline (last save)
  // -----------------------------
  const lastBaseline = baselines.get(abs) ?? headContent;
  const localDiff = computeSimpleDiff(lastBaseline, content);

  // Update local baseline for next change
  baselines.set(abs, content);

  // -----------------------------
  // 3️⃣ Git diff (vs HEAD)
  // -----------------------------
  const gitDiff = await gitInstance.diff([relativeFile]);

  // console.log("---- Git Diff (vs HEAD) ----");
  // console.log(gitDiff || "[no changes in git]");
  // console.log("---- Local Diff (since last change) ----");
  // console.log(localDiff || "[no local changes]");

  console.log(`[analyzing] ${relativeFile}...`);
  await live.summarizeFile(relativeFile, content, gitDiff, localDiff, ext);
}

async function fileExistsInHEAD(relativeFile: string) {
  try {
    await gitInstance.catFile(["-e", `HEAD:${relativeFile}`]);
    return true;
  } catch {
    return false;
  }
}

function computeSimpleDiff(oldText: string, newText: string): string {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const changes: string[] = [];

  newLines.forEach((line, i) => {
    if (oldLines[i] !== line) {
      changes.push(`+ ${line}`);
    }
  });

  return changes.join("\n");
}

class LiveCoder {
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
    const prompt = buildPrompt(
      relativeFile,
      content,
      gitDiff,
      localDiff,
      ext,
      this.conciseness,
      this.personality
    );

    console.log("[prompt]", prompt);

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
}

function buildPrompt(
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

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
