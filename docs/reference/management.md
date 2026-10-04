# Management commands

| Surface | Purpose | Inspection example |
| --- | --- | --- |
| `setup` | Discover local service endpoints without model installation | `ribbit setup --json` |
| `doctor` | Diagnose configuration, picker, extensions, and explicit provider probes | `ribbit doctor --json` |
| `providers` | Add, list, and remove endpoint configurations | `ribbit providers list --json` |
| `models` | List models from an explicitly selected provider | `ribbit models list --provider local` |
| `profiles` | Set, inspect, list, and remove named inference settings | `ribbit profiles list --json` |
| `route` | Inspect the route for a command | `ribbit route inspect --json -- ask 'Who owns the fix?' --profile local-small` |
| `commands` | List and describe commands; validate named definitions | `ribbit commands list --json` |
| `types` | Inspect built-in and installed type contracts | `ribbit types describe @ribbit/summarize --json` |
| `extensions` | Scaffold, check, test, add, list, and remove trusted extensions | `ribbit extensions list --json` |
| `run` | Invoke a named command with argument overrides | `ribbit run brief --file meeting.txt --profile local-small` |
| `flow` | Validate, plan, or run saved and inline flows | `ribbit flow plan examples/flows/triage.yaml` |
| `init` | Create project config and optionally append agent guidance | `ribbit init --agent codex` |
| `completions` | Emit Bash, Zsh, or Fish completions | `ribbit completions bash` |

Examples that refer to a profile or definition require it to exist. `models list` and `doctor --probe` perform explicit network requests. Catalog/help/completion/route inspection/flow planning and doctor inspect declarations without importing installed extension code.

## Inspect a concrete invocation

```sh
ribbit route inspect --json -- map 'Extract owner' --schema owner.json --profile structured
ribbit route inspect --json -- tree repository --describe=false
ribbit route inspect --json -- run brief --words 25 --profile local-small
```

Management flags (`--json`, `--error-format`) precede the separator. After `--`, use the same command arguments and runtime flags as execution, including `run NAME`, `--args-json`, and a second `--` for literal positional arguments. Required arguments must be supplied. The old `route inspect COMMAND` form is rejected; abstract contracts remain available through help and `types describe`.

The report includes parsed `args`, runtime flags, resolved limits, `inference`, declared effects and `route`. Defaults, named-definition overrides, project routing and explicit CLI overrides follow execution rules. `inference.status` is `exact` or `semantic`; exact invocations have an empty capability array and a null route. Semantic routes include provider/model, safe endpoint information and field-level precedence provenance. Use `flow plan` for steps whose selectors are still `unresolved`; a null route there is not necessarily exact. These JSON contracts are updated in place with `schemaVersion: 1`.

Inspection never reads stdin, evidence files or extraction schemas, traverses target directories, launches the picker, or contacts a provider. File names in these examples need not exist until execution. Input/output and budget flags are validated but do not cause I/O. Help after the separator describes the target command without running it. Successful inspection proves declared routing compatibility, not data validity, authentication, model availability or answer quality.

## Readiness with doctor

```sh
ribbit doctor --json
ribbit doctor --json -- map 'Extract owner' --schema owner.json --profile structured
ribbit doctor --json --probe -- ask 'Who owns the fix?' --profile local-small
```

Plain doctor checks global/project configuration, the default route, inference controls, authentication readiness, fzf and installed extension freshness. It reports exact-command availability independently: a missing default route does not make exact commands unusable or erase valid named routes. Without a concrete invocation, no text/object capability requirement is assumed; capability status is `controls-only`.

Invocation-scoped doctor checks the selected mode and applicable dependencies. Exact invocations need no inference route; only built-in `pick` needs fzf. Unrelated extensions and fzf do not block a scoped builtin that does not use them. Configuration still must be valid, as in execution. Doctor does not read task input or external schemas, and extension freshness does not prove extension safety or correctness.

Checks distinguish:

- Route completeness from model allowlist admission and selected-mode capability compatibility.
- Provider capability declarations from **unverified model-specific support**. An allowlist or model listing does not establish quality, loaded state or structured-output support.
- Authentication not configured, a referenced environment value present, and a missing value. Neither credential values nor their environment-variable names are printed; presence is not verified authentication.
- fzf missing, supported, too old, invalid version output, or failed/timed-out version checking. The minimum is **0.74.3**, shared with `pick`. Running `pick` also requires a controlling terminal; doctor does not open one.
- Fresh extensions from stale, unavailable or invalid registrations. Inspection never imports or rebuilds them.

Exit **0** means all applicable checks passed for the reported scope; unchecked/unverified dimensions remain explicit. Exit **3** means partial or unavailable readiness, not that every command is broken. For example, empty configuration plus installed fzf returns 3, while `doctor -- take 1` returns 0. Invalid invocation arguments return **2**. The report includes `ok`, `status`, `scope` and per-check statuses; `ok: null` on a check means not assessed or not applicable, not a pass.

Ordinary doctor and `--probe=false` make **zero provider requests**. Only `--probe` or `--probe=true` explicitly requests bounded model listings: the selected provider when scoped, all configured providers otherwise. A selected model missing from the listing or a failed probe makes the report fail. Scoped exact commands have no provider to probe. No probe performs inference, downloads tools/models, edits configuration or selects a fallback. See [configuration](configuration.md) for route precedence.

`init --agent` supports `codex`, `claude`, `cursor`, and `opencode`. Initialization preserves existing unrelated guidance and does not replace an existing project config. Generated completions include named definitions.

See [model setup](../how-to/configure-models.md), [extension authoring](../how-to/build-extension.md), and [named definitions](definitions.md) for task-specific instructions.
