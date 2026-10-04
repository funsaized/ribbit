# Diagnose a failing pipeline

Start with the failing command's exit code and stderr. Keep stdout separate so diagnostics do not become downstream evidence.

## Check configuration and the route

```sh
ribbit doctor --json
ribbit route inspect --json -- ask 'Who owns the fix?' --profile local-small
ribbit doctor --json --probe -- ask 'Who owns the fix?' --profile local-small
```

Doctor reports partial readiness with exit 3: exact non-picker commands may still work without a default route or fzf. Scope it with `-- COMMAND [args]` to check the failing invocation. Ordinary inspection and `--probe=false` are offline. `--probe` explicitly lists the selected provider's models; it does not test inference or model-specific capability support. Confirm the endpoint and exact model identifier before retrying a semantic task. For a local endpoint, check that its server is running and the model is available there.

## Capture diagnostics without mixing them into data

```sh
ribbit ask 'Who owns the fix?' --file meeting.txt --profile local-small \
  --stats --error-format json > answer.txt 2> diagnostics.jsonl
```

Inspect the exit status before accepting `answer.txt`. A stream may have emitted a valid prefix before a later failure. In Bash, use `set -o pipefail` when any failed stage must fail a shell pipeline.

| Symptom | Action |
| --- | --- |
| Exit 2 / records required | Choose `--input lines`, `--input jsonl`, or a Ribbit record stream explicitly |
| Exit 3 / missing route or capability | Inspect the profile, provider capabilities, and exact model ID |
| Exit 4 / invalid or truncated semantic output | Inspect the output budget and provider behavior; try a more suitable model rather than accepting partial output |
| Exit 5 / extension failure | Run the extension's check/test commands and inspect trusted source |
| Exit 6 / budget exhausted | Reduce input first; raise only the finite limits appropriate to the job |
| Exit 7 / terminal or filesystem failure | Check path access; interactive `pick` requires fzf and a controlling terminal |
| Labels disappear downstream | Keep record output; JSONL export and rendering intentionally drop annotations |
| Valid result, wrong answer | Treat it as a semantic failure; preserve the fixture and evaluate another route |

## Bound the next attempt

```sh
ribbit ask 'List the decisions supported by this text.' \
  --file meeting.txt --profile local-small \
  --max-bytes 65536 --max-requests 2 --request-ms 30000 --total-ms 60000 --stats
```

These are invocation limits. A provider's context window may be smaller, and missing token usage cannot be enforced as if it were reported. Use [limit and error reference](../reference/runtime.md) for the exact defaults and categories.

For a reproducible bug report, include a sanitized fixture, exact command, version, OS/architecture, exit code, and separate stdout/stderr. For a semantic failure, include the provider/model and whether the problem is formatting or factual content. Use [private reporting](https://github.com/funsaized/ribbit/security/policy) for vulnerabilities.
