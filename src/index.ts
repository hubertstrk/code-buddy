#!/usr/bin/env node
import chokidar from "chokidar";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import yargs from "yargs/yargs";
import { hideBin } from "yargs/helpers";

import { LiveCoder } from "./live-coder.js";
import { existsDir, resolveUrl, parseList } from "./helper.js";
import { CliArgs } from "./model.js";

import * as simpleGitModule from "simple-git";
const git = simpleGitModule.simpleGit;
const gitInstance = git();

const DEFAULT_HOST = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || "phi4-mini";
const DEFAULT_CONSICENESS = process.env.CONSICENESS || "standard";
const DEFAULT_PERSONALITY = process.env.PERSONALITY || "neutral";

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

const baselines = new Map<string, string>(); // abs path -> original baseline content

async function onEvent(
  kind: "added" | "changed",
  relativeFile: string,
  live: LiveCoder,
  baseDir: string
) {
  const abs = path.resolve(baseDir, relativeFile);
  const ext = path.extname(abs).toLowerCase();
  const content = await fs.readFile(abs, "utf8");

  let headContent = "";
  if (await fileExistsInHEAD(relativeFile)) {
    headContent = await gitInstance.show([`HEAD:${relativeFile}`]);
  }

  const lastBaseline = baselines.get(abs) ?? headContent;
  const localDiff = computeSimpleDiff(lastBaseline, content);

  baselines.set(abs, content);

  const gitDiff = await gitInstance.diff([relativeFile]);

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

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
