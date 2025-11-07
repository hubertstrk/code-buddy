export const compact: string = `
Focus only on the lines present in the diff.
Do not comment on unrelated or legacy code.
Provide concise suggestions (≤15 words).
Include one emoji for context (💡 idea, ⚠️ warning, 🚀 perf, 🧹 style).
`;

export const standard: string = `
Focus only on the lines present in the diff.
Do not comment on unrelated or legacy code.
Provide concise suggestions (≤25 words), one emoji.

- Angular templates: *ngIf, *ngFor, async pipes, structural directives.
- TypeScript: redundant null checks, early returns, const/readonly, strict equality.
- RxJS: pipeable operators, unsubscriptions, flatten nested subscriptions.
- Lodash: replace verbose loops, prefer helpers over manual operations.
- HTML/CSS: semantic tags, accessibility, remove redundant classes.
- General: remove debug logs, commented-out code, unnecessary complexity.
`;

export const exhaustive: string = `

🧠 DETAILED CHECKLIST / BEST PRACTICES

🔹 Angular Templates
- *ngIf*: understands falsy values (null, undefined, '', 0). Avoid redundant '!= null' or '!var'.
- *ngFor*: prefer trackBy for dynamic lists.
- Avoid deeply nested *ngIfs or ternaries — suggest refactoring into pipes/getters/components.
- Prefer async pipes over manual subscriptions in templates.
- Detect unused @Input() or @Output() properties.
- Avoid [innerHTML] unless sanitized; suggest safer alternatives.
- Simplify long attribute bindings or repeated class logic.
- Suggest semantic HTML tags for better accessibility.
- Detect missing alt/aria attributes.
- Remove redundant directives or structural bindings.
- Recommend breaking large templates into smaller reusable components.
- Highlight inline styles or redundant utility classes (Tailwind/CSS).

🔹 TypeScript / Component Logic
- Remove unreachable code or no-op expressions (e.g., if(x) y;).
- Detect missing return in getters or early-exit guards.
- Prefer const/readonly for immutable variables.
- Use strict equality (===) instead of == unless coercion intended.
- Detect duplicated logic or unreferenced members.
- Suggest breaking complex functions into smaller, pure helpers.
- Avoid deeply nested conditionals; suggest early returns.
- Detect commented-out code, console logs, or debug statements.
- Recommend extracting constants or configuration objects.
- Identify logical redundancies, unnecessary checks, or overcomplicated expressions.
- Suggest replacing verbose loops with array helpers or Lodash when appropriate.
- Encourage consistent naming (camelCase for variables, PascalCase for components).

🔹 RxJS (Reactive Patterns)
- Prefer pipeable operators (map, switchMap, filter, mergeMap, concatMap).
- Avoid nested subscriptions; suggest using higher-order mapping operators.
- Ensure proper unsubscription (takeUntil(destroy$) or firstValueFrom).
- Replace manual Subject patterns with BehaviorSubject or ReplaySubject when applicable.
- Warn against mixing Promises and Observables unnecessarily.
- Suggest using async pipe in template when possible.
- Detect manual subscription chains that can be simplified with operators.

🔹 Lodash / Utility Patterns
- Replace verbose loops or custom deduplication with helpers (_.uniq, _.groupBy, _.debounce, _.cloneDeep, _.merge).
- Suggest using Lodash over manual object/array manipulation when clearer.
- Warn about excessive Lodash chaining that reduces readability.
- Prefer built-in ES functions (map, reduce, filter, Set) when Lodash adds no value.
- Ensure imports are optimized (lodash-es vs lodash for tree-shaking).

🔹 HTML / Styling / Accessibility
- Detect missing alt, title, or aria attributes.
- Suggest semantic tags instead of generic div/span for interactive elements.
- Flag redundant Tailwind or CSS utility classes.
- Suggest moving inline styles to classes.
- Highlight inconsistent indentation, spacing, or formatting.

🔹 General Code Quality / Logical Improvements
- Detect redundant or unnecessary null checks.
- Suggest replacing verbose ternaries or if/else with cleaner expressions.
- Recommend early returns for complex logic.
- Highlight duplicated logic, commented-out code, leftover debug statements.
- Detect potential security issues (unescaped HTML, unsafe eval, direct DOM access).
- Suggest clearer, idiomatic code for readability and maintainability.
- Flag overly long lines, deeply nested code blocks, or excessive chaining.
- Encourage concise, self-documenting variable and function names.
`;

export const AngularConcisenessLevels: Record<string, string> = {
  compact,
  standard,
  exhaustive,
};
