#!/usr/bin/env node
import chokidar from 'chokidar';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import http from 'node:http';
import https from 'node:https';
import { hideBin } from 'yargs/helpers';
import yargs from 'yargs/yargs';
import { diffLines } from 'diff';

interface CliArgs {
  watch: string;
  model: string;
  host: string;
  pattern?: string;
  ignore?: string[];
}

const DEFAULT_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || 'codellama:7b';

function resolveUrl(urlStr: string): URL {
  try {
    return new URL(urlStr);
  } catch {
    return new URL('http://127.0.0.1:11434');
  }
}

async function main() {
  const argv = yargs(hideBin(process.argv))
    .scriptName('code-buddy')
    .usage('Usage: $0 -w <folder> [options]')
    .option('watch', {
      alias: 'w',
      describe: 'Folder to watch for live coding',
      type: 'string',
      demandOption: true,
    })
    .option('model', {
      alias: 'm',
      describe: 'Ollama model to use',
      type: 'string',
      default: DEFAULT_MODEL,
    })
    .option('host', {
      alias: 'h',
      describe: 'Ollama host (e.g., http://127.0.0.1:11434)',
      type: 'string',
      default: DEFAULT_HOST,
    })
    .option('pattern', {
      alias: 'p',
      describe: 'Glob pattern to include (e.g., "**/*.ts")',
      type: 'string',
    })
    .option('ignore', {
      alias: 'i',
      describe: 'Glob patterns to ignore (comma separated)',
      type: 'string',
    })
    .help()
    .alias('help', 'help')
    .epilog('code-buddy — watches files and streams insights from your local Ollama LLM')
    .parseSync() as unknown as CliArgs;

  const watchDir = path.resolve(argv.watch);
  const exists = await existsDir(watchDir);
  if (!exists) {
    console.error(`Error: Watch folder does not exist: ${watchDir}`);
    process.exit(1);
  }

  const hostUrl = resolveUrl(argv.host || DEFAULT_HOST);
  const ignoreGlobs = parseList(argv.ignore) ?? ['**/node_modules/**', '**/.git/**', '**/.DS_Store'];
  const includePattern = argv.pattern ?? '**/*.{ts,html,vue,json,md}';

  console.log('[code-buddy] Watching:', watchDir);
  console.log('[code-buddy] Include:', includePattern);
  console.log('[code-buddy] Ignore:', ignoreGlobs.join(', '));
  console.log('[code-buddy] Ollama:', `${hostUrl.origin} model=${argv.model}`);

  const watcher = chokidar.watch(includePattern, {
    cwd: watchDir,
    ignored: ignoreGlobs,
    persistent: true,
    ignoreInitial: false,
    awaitWriteFinish: {
      stabilityThreshold: 250,
      pollInterval: 50,
    },
  });

  const live = new LiveCoder({ host: hostUrl, model: argv.model });

  watcher
    .on('add', (file) => onEvent('added', file, live, watchDir))
    .on('change', (file) => onEvent('changed', file, live, watchDir))
    .on('error', (err) => console.error('[watcher:error]', err));

  process.on('SIGINT', () => {
    console.log('\n[code-buddy] Shutting down...');
    watcher.close().then(() => process.exit(0));
  });
}

function parseList(input?: string | string[]): string[] | undefined {
  if (!input) return undefined;
  if (Array.isArray(input)) return input;
  return input.split(',').map((s) => s.trim()).filter(Boolean);
}

const baselines = new Map<string, string>();   // abs path -> original baseline content
const caches = new Map<string, ChangeCache>();      // abs path -> ChangeCache
const MAX_CHANGES = 3;
const MAX_DIFF_LINES = 100;    // safety limit

async function onEvent(kind: 'added' | 'changed', relativeFile: string, live: LiveCoder, baseDir: string) {

  const abs = path.resolve(baseDir, relativeFile);
  const ext = path.extname(abs).toLowerCase();
  const content = await fs.readFile(abs, "utf8");

  // initialize baseline if not yet stored
  if (!baselines.has(abs)) {
    baselines.set(abs, content);
    caches.set(abs, new ChangeCache(MAX_CHANGES));
    // console.log(`[init] baseline set for ${relativeFile}`);
    return;
  }

  const baseline = baselines.get(abs)!;
  const cache = caches.get(abs)!;

  // compute diff vs baseline (not vs last content)
  const diff = diffLines(baseline, content);

  const added = diff
      .filter(p => p.added)
      .map(p => p.value.trim())
      .filter(Boolean);

  // detect excessive diff (e.g., refactor or branch switch)
  const totalLines = added.reduce((sum, a) => sum + a.split("\n").length, 0);
  if (totalLines > MAX_DIFF_LINES) {
    console.log(`[reset] ${relativeFile} diff too large → resetting baseline`);
    baselines.set(abs, content);
    cache.clear();
    return;
  }

  // update cache with new additions
  for (const snippet of added) {
    cache.add(snippet);
  }

  // remove deleted snippets (that no longer exist)
  cache.removeDeleted(content);

  // nothing new to analyze
  if (cache.isEmpty()) return;

  const context = cache.getContext();

  await live.summarizeFile(relativeFile, context, ext);
}

async function existsDir(dir: string): Promise<boolean> {
  try {
    const s = await fs.stat(dir);
    return s.isDirectory();
  } catch {
    return false;
  }
}

class LiveCoder {
  private readonly host: URL;
  private readonly model: string;

  constructor(opts: { host: URL; model: string }) {
    this.host = opts.host;
    this.model = opts.model;
  }

  async summarizeFile(filename: string, content: string, ext: string) {
    const prompt = buildPrompt(filename, content, ext);
    try {
      process.stdout.write('[ollama] ');
      await this.generate({ prompt });
      process.stdout.write('\n');
    } catch (err: any) {
      console.error('\n[ollama:error]', err?.message || err);
      console.error('Hint: Ensure Ollama is running locally. Default: http://127.0.0.1:11434');
    }
  }

  private async generate(body: { prompt: string }) {
    const url = new URL('/api/generate', this.host);
    const payload = JSON.stringify({ model: this.model, prompt: body.prompt, stream: true });

    const isHttps = url.protocol === 'https:';
    const mod = isHttps ? https : http;

    await new Promise<void>((resolve, reject) => {
      const req = mod.request(
        {
          method: 'POST',
          hostname: url.hostname,
          port: url.port || (isHttps ? 443 : 80),
          path: url.pathname,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          },
        },
        (res) => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}`));
            res.resume();
            return;
          }
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
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
          res.on('end', () => resolve());
        }
      );
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }
}

function buildPrompt(filename: string, content: string, ext: string): string {
  const lang = languageFromExt(ext);
  const snippet = content.length > 4000 ? content.slice(0, 4000) + '\n... [truncated]' : content;
  return `You are a sarcastic, cursing, rude and funny coding assistant.
- Respond as short as possible unsing emojis, **a maximum of 20 words**!!!, and be on point.
- Start saying whether you like the changes or not (be sarcastic, funny and curse).
- Focus on the quality of the code changes and suggest alternative and improvements.
- When using code snippets, use short (maximum of 3 lines) and concise snippets with language fences.

The following code changes were made to the file "${filename}":
---
${snippet}`;
}

function languageFromExt(ext: string): string {
  switch (ext) {
    case '.ts':
      return 'ts';
    case '.tsx':
      return 'tsx';
    case '.js':
      return 'js';
    case '.jsx':
      return 'jsx';
    case '.json':
      return 'json';
    case '.md':
      return 'md';
    case '.html':
      return 'html';
    case '.vue':
      return 'vue';
    default:
      return '';
  }
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});

class ChangeCache {
  private readonly maxSize: number;
  private changes: Array<{ text: string; ts: number }>;

  constructor(maxSize = 10) {
    this.maxSize = maxSize;
    this.changes = []; // { text, ts }
  }

  add(snippet: string) {
    snippet = snippet.trim();
    if (!snippet) return;
    // dedupe identical snippets
    if (this.changes.some(c => c.text === snippet)) return;
    this.changes.push({ text: snippet, ts: Date.now() });
    if (this.changes.length > this.maxSize) this.changes.shift();
  }

  removeDeleted(currentContent: string) {
    this.changes = this.changes.filter(c => currentContent.includes(c.text));
  }

  clear() {
    this.changes = [];
  }

  isEmpty() {
    return this.changes.length === 0;
  }

  size() {
    return this.changes.length;
  }

  getContext() {
    return this.changes.map(c => c.text).join("\n\n");
  }
}
