export class ChangeCache {
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
    if (this.changes.some((c) => c.text === snippet)) return;
    this.changes.push({ text: snippet, ts: Date.now() });
    if (this.changes.length > this.maxSize) this.changes.shift();
  }

  removeDeleted(currentContent: string) {
    this.changes = this.changes.filter((c) => currentContent.includes(c.text));
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
    return this.changes.map((c) => c.text).join("\n\n");
  }
}
