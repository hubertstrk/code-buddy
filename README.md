# code-buddy

A minimal Node.js + TypeScript CLI that watches a folder for file changes and streams concise insights from your local Ollama API. Great for lightweight "live coding" feedback on the file you just edited.

Features:

- TypeScript CLI with a single entry point (src/index.ts).
- Watches a designated folder for file additions/changes (via chokidar).
- Calls your local Ollama server (default http://127.0.0.1:11434) and streams responses.
- Configurable model, host, include/ignore patterns.

## Prerequisites

- Node.js 18 or newer
- A local Ollama installation running (e.g., `ollama serve`) with a model pulled, e.g., `ollama pull phi4-mini`.

## Install & Build

```
# From the project root
npm install
npm run build
```

## Usage

You can run it via npm scripts or as a global-like bin after build.

Using npm start (after build):

```
npm start -- -w C:\path\to\watch
```

Using ts-node in dev mode (auto-reloads on src changes):

```
npm run dev -- -w C:\path\to\watch
```

After `npm run build`, you can also invoke the compiled CLI directly:

```
node dist/index.js -w C:\path\to\watch
```

Flags:

- -w, --watch <folder> Required. Folder to watch.
- -m, --model <name> Ollama model (default: env OLLAMA_MODEL or "phi4-mini").
- -h, --host <url> Ollama host (default: env OLLAMA_HOST or http://127.0.0.1:11434).
- -c, --conciseness <level> Conciseness level [compact, standard (default), exhaustive] (default: env CONSICENESS or "standard").
- -p, --personality <style> AI personality style [rude, neutral (default), cheerful] (default: env PERSONALITY or "neutral").
- -ip, --pattern <glob> Include glob (default: \*_/_.{ts,html,vue,json,md}).
- -i, --ignore <globs> Comma-separated ignore globs (default includes node_modules, .git, .DS_Store).

Examples:

```
# Watch a folder with defaults
npm start -- -w C:\Projects\my-app

# Watch only TypeScript files and ignore dist
npm start -- -w C:\Projects\my-app -ip "**/*.ts" -i "**/dist/**,**/node_modules/**"

# Use a different model, conciseness, and personality
npm start -- -w C:\Projects\my-app -m qwen2.5-coder:7b -c compact -p cheerful

# Use a different Ollama host
npm start -- -w C:\Projects\my-app -h http://localhost:11434
```

## Environment variables

- OLLAMA_HOST Default host for Ollama (e.g., http://127.0.0.1:11434)
- OLLAMA_MODEL Default model name (e.g., phi4-mini)
- CONSICENESS Default conciseness level (e.g., standard)
- PERSONALITY Default AI personality (e.g., neutral)

## Notes

- Large files (> 2 MB) are skipped.
- Only regular files are processed (directories, symlinks are ignored).
- Output streams token-by-token as received from Ollama.

## License

See LICENSE.
