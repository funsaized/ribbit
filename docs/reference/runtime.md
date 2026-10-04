# Limits, errors, and statistics

## Default invocation limits

| Limit | Semantic invocation | Exact input |
| --- | --- | --- |
| Input bytes | 8 MiB | 128 MiB |
| Records | 10,000 | 1,000,000 |
| Global rank/group candidates | 200 | Not applicable |
| Filesystem entries inspected by default | 100 | Command-specific traversal bound |
| Request time | 60 seconds | No inference |
| Total time | 120 seconds | See command execution contract |
| Model requests | 32 | Zero |
| Aggregate reported tokens | 64,000 | Zero |

Finite overrides are `--max-bytes`, `--max-records`, `--max-requests`, `--max-tokens`, `--request-ms`, and `--total-ms`. Command-specific traversal flags remain separate. These bounds are not a guarantee that input fits a model's context window.

A flow shares invocation budgets and accounts for outputs cumulatively. Separate shell processes own separate budgets. Structured output allows at most one repair; repairs and retries share the invocation budget. Missing provider token usage is reported as unknown, not zero. Per-request output-token allowances belong in the route/profile's `maxOutputTokens` setting.

Exact selections (`where`, `select`, `take`, `unique`, `sort`) can return empty records; `rank` and `group` also return empty without inference. Text/model operations that require evidence, such as `summarize` and `reduce`, reject empty evidence. Candidate caps of 200 for rank/group apply independently of input admission; 10,000 admitted records do not imply a 10,000-record model request. For shell pipelines, enable `set -o pipefail` where supported and check the exit status before using captured stdout. Keep stderr separate.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success, including handled downstream pipe closure |
| 2 | Invalid arguments, input, definition, or flow |
| 3 | Route, provider, or configuration failure |
| 4 | Invalid semantic result |
| 5 | Extension execution failure |
| 6 | Budget exceeded |
| 7 | Filesystem, terminal, or output failure |
| 130 | Cancellation |

`--error-format json` selects versioned JSON diagnostics on stderr. Default diagnostics are text. stdout remains the result channel. Streaming output emitted before an error is only a valid prefix, not proof of a complete result.

For `doctor`, exit 0 means applicable readiness checks passed for the requested scope; exit 3 means partial/unavailable readiness even if some commands remain usable. Ordinary checks stay offline, and unverified provider/model behavior is not a failure by itself. See [doctor readiness](management.md#readiness-with-doctor).

## Statistics

`--stats` writes a JSON statistics object to stderr. It includes request, repair, retry, route, token, and elapsed-time information. Exact commands make zero model requests. Token values may be unknown when the provider does not supply usage.

Use [troubleshooting](../how-to/troubleshoot.md) for a procedure to capture and interpret a failing invocation.
