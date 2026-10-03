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

Fixture JSON uses `input`, optional `args`, `config`, `action`, expected JSON `expected` or numeric `error`, and optional ordered mock `responses`. Fixtures are deterministic contract checks, not live provider or quality evidence.

## Installation contract

Registry entries and immutable bundles live under `${XDG_DATA_HOME:-$HOME/.local/share}/ribbit/extensions`, using the user's home on Windows. Source changes require explicit check, test, and add operations. Removing an installed extension preserves source. Execution checks built artifacts against their recorded hashes.

## Definitions and versions

A named YAML definition selects a type, exact type version, action, configuration, and argument defaults. See [definition reference](reference/definitions.md). The product version and command type versions are separate: a type's `1.0.0` identifier does not mean the alpha product has shipped a stable 1.0 release.
