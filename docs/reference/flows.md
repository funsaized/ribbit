# Flow documents

A flow is a linear sequence of typed command steps. Its document uses `apiVersion: ribbit/v1` and `kind: Flow`.

| Field | Contract |
| --- | --- |
| `name` | Flow name |
| `input` | Optional input JSON Schema |
| `inference` | Optional default inference settings |
| `steps` | Between 1 and 100 ordered steps |
| `output` | Optional output binding; otherwise the last step's result |

Each step has a unique `id`, a `command`, optional `args`, optional `input`, and optional `inference`. IDs begin with a letter and contain letters, digits, underscores, or hyphens. The default step input is the preceding output, or the flow input for the first step.

A complete exact flow:

```yaml
apiVersion: ribbit/v1
kind: Flow
name: first-name
steps:
  - id: project
    command: select
    args:
      fields: name
  - id: first
    command: take
    args:
      count: 1
```

## References

A reference is an object containing only a string `$ref`:

```yaml
input: {$ref: input}
```

```yaml
input: {$ref: steps.first.output.title}
```

Numeric array indices use `[0]`. Property keys use letters, digits, underscores, and hyphens with a letter or underscore first. Forward references, prototype-related keys, executable expressions, and string interpolation are rejected. References retain JSON types. Schema information that is unavailable during planning is validated at runtime.

## CLI forms

```sh
ribbit flow validate FILE.yaml
ribbit flow plan FILE.yaml
ribbit flow run FILE.yaml --file INPUT --input jsonl
```

Inline flows use a standalone `::` argv token between commands:

```sh
ribbit flow run --input jsonl --output jsonl -- select name :: take 1
```

The example reads stdin. A literal standalone `::` is reserved even if shell-quoted; a longer instruction containing those characters remains an ordinary argument.

Each planned step includes `inference.status`: `exact`, `semantic`, or `unresolved`. Exact and semantic results include their resolved `capabilities`; unresolved results list the selector `arguments` and their `references`. A null route can mean exact execution **or deferred resolution**; always inspect the status. References in unrelated arguments do not prevent resolving known requirements, and a known true argument determines a `whenAny` branch even when another selector is unresolved.

Referenced mode selectors are never treated as truthy objects or replaced by the union of both capability branches. Their route and capability checks are deferred until execution binds and validates the actual values. Potentially semantic steps use bounded semantic limits while unresolved. Defaults still apply to known arguments. `flow validate` reports structural `valid` status separately from capability-check `complete` status and lists `deferred` steps; neither guarantees runtime data or model correctness.

Planning and validation inspect declarations without importing extension code or contacting models. Steps share budgets. Single-use whole outputs stream where possible; reused outputs and nested references buffer within those limits. Flow output accounting is cumulative.

Route precedence is documented in [configuration](configuration.md). For running supplied examples, see [mixed-model routing](../how-to/route-workflows.md).
