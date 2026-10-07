# token-meter

A Claude Code mod that opens a pane with the tokens read and written in the current session and
over the week (across all projects), the estimated cost at API prices, the context window fill,
and the usage limits (5h, weekly) with the time left until each reset.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install token-meter --marketplace Dumorro/token-meter
```

Answer `y` to add the marketplace and pick the `user` scope. The pane opens when a session starts;
reopen it with `/tokens`.

## Requirements

- `jq` on the `PATH`. It reads the transcripts under `~/.claude/projects` to total the session
  (subagents included) and the week. Without `jq`, the pane shows only what it counted since the
  mod loaded and the totals saved from earlier sessions.

## Notes

- The cost is an estimate from the API price table in `hooks/pricing.ts`, not what a plan bills.
  Models missing from the table are listed as "unpriced" instead of being counted as free.

## Development

```bash
claude plugin validate .
claude plugin test .
```
