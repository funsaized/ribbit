# Extension SDK reference

For the lifecycle procedure, use [build an extension](how-to/build-extension.md). Extensions are trusted executable code; discovery and planning read their manifests without importing them. A complete read-only example is the [GitHub PR evidence extension](../examples/extensions/gh-evidence/README.md).

The adjacent distribution `lib/` is a private `@ribbit/sdk` package. It exports `defineCommand`, `defineAction`, `z`, `recordSchema`, `jsonValueSchema`, `Budget`, `RibbitError` and types. Use strict Zod input, args, config and output schemas. The supported export subset includes primitives, arrays, strict objects, scalar literals/enums, unions, optional/default values and built-in scalar constraints. Transforms, custom refinements, recursive/lazy schemas and arbitrary unknown values are rejected. `jsonValueSchema` explicitly accepts finite JSON.

An action declares description, schemas, mode (`value`, `records`, `text-stream`), input/output kind, effects and capabilities. Record mode receives and returns async iterables. CLI bindings derive from args: scalar fields become kebab-case flags, scalar arrays repeat, complex values use `--args-json`. CLI positionals are explicitly declared in `cli.positionals`. Runtime flag collisions fail generation. Config belongs to the definition; callers override args, not config.

## Inference capabilities

`capabilities` is either an unconditional array (for example `['text']`, or `[]` for no managed inference) or a declarative selector:

```ts
capabilities: { whenAny: ['schema'], ifTrue: ['object'], ifFalse: ['text'] }
```

`whenAny` names one or more distinct top-level string or boolean arguments. After argument defaults and overrides, any truthy selector chooses `ifTrue`; otherwise `ifFalse` applies. Missing optional values, `false`, and empty strings are false. Both branches are explicit capability arrays. Supported names are `text`, `stream`, `object`, `temperature`, `maxOutputTokens`, and `reasoning`. Unknown capabilities, unknown/non-string/non-boolean selector fields, and malformed declarations fail export or installed-manifest admission.

This replaces `inferenceWhen` in place; the manifest schema version remains 1. Update conditional declarations and explicitly rebuild installed extensions with `extensions add`. Discovery never migrates or imports an implementation. Runtime, help, routing and flow planning use the exported declaration; managed calls inconsistent with the selected branch fail before HTTP. Effects remain declarations of possible trusted behavior, not proof that a particular invocation performs every effect.

Execution receives `{input,args,config}` and context with `signal`, `budget`, `log`, optional `inputKind` and managed `llm.text(instruction,evidence)` / `llm.object(instruction,evidence,schema)`. Honor cancellation and await calls. Managed calls share route, retry, repair, time and request budgets. Declared effects describe trusted behavior and do not restrict arbitrary TypeScript.

## Offline fixture diagnostics

Fixture JSON uses `input`, optional `args`, `config`, `action`, expected JSON `expected` or numeric `error`, and optional ordered mock `responses`. Fixtures are deterministic contract checks, not live provider or quality evidence. Managed inference consumes only those ordered responses; a missing response fails locally without contacting a provider. Trusted extension code can still perform its own I/O.

`ribbit extensions test PATH --json` writes a report with `schemaVersion: 1`, `passed`, `failed`, and `results` to stdout. Without `--json`, it pretty-prints the same report without `schemaVersion`. A completed report exits 0 when all fixtures pass, or 5 when any fail. Build/load failures remain command errors rather than fixture comparisons.

Results retain `file`, `pass`, and any existing `error`, `location`, and `message` fields. Passing results, including matching expected errors, have no diagnostic. Failed results add `diagnostic`:

| `kind` | Meaning | Additional fields |
| --- | --- | --- |
| `value-mismatch` | Validated execution returned a different value | `path`, `expected`, `actual`, optional `pathTruncated` |
| `error-mismatch` | An expected error did not occur or its code differed | `expected` and `actual` outcomes: `{outcome:"error",code:2}` or `{outcome:"return"}`; code is omitted if unavailable |
| `execution-failure` | Unexpected execution or schema-validation failure | Existing `error`, `location`, and safe `message` describe the failure |
| `fixture-json` | Fixture could not be read or parsed as JSON | Existing error 2, filename location, and `Invalid fixture JSON` message |
| `diagnostic-unavailable` | Comparison or diagnostic generation threw | No exception details; fixture remains failed and later fixtures still run |

For example, changing the scaffold's expected value to `"WRONG"` produces this failed result (synthetic example):

```json
{
  "file": "echo.json",
  "pass": false,
  "diagnostic": {
    "kind": "value-mismatch",
    "path": "",
    "expected": { "type": "string", "preview": "\"WRONG\"", "truncated": false },
    "actual": { "type": "string", "preview": "\"Say hello!\"", "truncated": false }
  }
}
```

Value diagnostics explain the first mismatch; they do not change deep strict equality or error-code matching. Comparison and diagnostics run outside execution-error matching: throwing getters or serialization hooks cannot turn a failed comparison into an expected-error pass. If comparison itself throws, the fixture fails rather than claiming equality. Object keys are compared in sorted order and array indices in numeric order. `path` is a JSON Pointer relative to the expected/actual result: `""` means the root, `/items/2/name` selects a nested value, and `~` and `/` in keys are escaped as `~0` and `~1`. A missing or extra key/element uses that key/index's path. Traversal stops at 32 segments or before exceeding 512 UTF-16 code units, reports the ancestor values, and sets `pathTruncated: true`.

Each value descriptor contains `type`, a display `preview` limited to 256 UTF-16 code units, and `truncated`. `missing` is distinct from `null` and from strings such as `"missing"`. Previews use JSON notation (with `-0` preserved for scalar comparisons), sorted object keys, or `<missing>`. A truncated preview is not necessarily valid JSON. If serialization fails, the preview is `<preview unavailable>` with `truncated: true`. These are display bounds, not new execution or memory budgets.

Diagnostics never add raw exceptions, stack traces, malformed fixture text, or partial/unvalidated results. Existing error redaction remains in force. **Value previews can contain private fixture/output data: truncation is not secret detection. Sanitize reports before sharing them.**

To read an already saved `extensions test --json` report without loading or executing its extension, use a repository checkout with Bun 1.4.0 and dependencies installed (`bun install --frozen-lockfile --ignore-scripts`):

```sh
bun run eval:report -- saved-fixture-report.json
```

This is a checkout script, not an installed `ribbit` subcommand. It preserves diagnostic previews and truncation flags, defaults to stdout, and accepts `--output NEW.txt` only for a new file. Rendering exit zero means the report was displayed, not that fixtures passed. Unversioned pretty-printed fixture reports are unsupported; save the `--json` form. See [offline report usage and bounds](../evals/README.md#read-a-saved-report-offline).

## Installation contract

Registry entries and immutable bundles live under `${XDG_DATA_HOME:-$HOME/.local/share}/ribbit/extensions`, using the user's home on Windows. Source changes require explicit check, test, and add operations. Removing an installed extension preserves source. Execution checks built artifacts against their recorded hashes.

## Definitions and versions

A named YAML definition selects a type, exact type version, action, configuration, and argument defaults. See [definition reference](reference/definitions.md). The product version and command type versions are separate: a type's `1.0.0` identifier does not mean the alpha product has shipped a stable 1.0 release.
