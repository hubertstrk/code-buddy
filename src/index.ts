#!/usr/bin/env node
import chokidar from 'chokidar';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import http from 'node:http';
import https from 'node:https';
import { hideBin } from 'yargs/helpers';
import yargs from 'yargs/yargs';

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
  const includePattern = argv.pattern ?? '**/*.{ts,tsx,js,jsx,json,md,txt}';

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

async function onEvent(kind: 'added' | 'changed', relativeFile: string, live: LiveCoder, baseDir: string) {
  const abs = path.resolve(baseDir, relativeFile);
  const ext = path.extname(abs).toLowerCase();
  try {
    const stat = await fs.stat(abs);
    if (!stat.isFile()) return;
    const sizeKb = Math.round(stat.size / 1024);
    if (stat.size > 1024 * 1024 * 2) {
      console.log(`[skip] ${relativeFile} is too large (${sizeKb} KB)`);
      return;
    }

    const content = await fs.readFile(abs, 'utf8');
    console.log(`\n[${kind}] ${relativeFile} (${sizeKb} KB)`);
    await live.summarizeFile(relativeFile, content, ext);
  } catch (err) {
    console.error('[file:error]', err);
  }
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
  private host: URL;
  private model: string;
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
  return `You are Code-Buddy, a helpful coding assistant.
A file was updated in the workspace. Provide a concise analysis:
- What does the file do?
- Potential bugs or issues?
- Suggestions for improvement.
Keep it short (<= 60 words). If you include code, use ${lang} fences.

Filename: ${filename}
---
${snippet}`;
}

function languageFromExt(ext: string): string {
  switch (ext) {
    case '.ts':
      return 'ts';
    case '.js':
      return 'js';
    case '.json':
      return 'json';
    case '.md':
      return 'md';
    default:
      return '';
  }
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
