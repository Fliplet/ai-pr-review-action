# Fliplet AI PR Review Action

GitHub Action that reviews pull requests using Claude AI against Fliplet coding standards. Posts inline review comments with severity levels and can request changes for critical issues.

## Features

- **Inline review comments** — Comments on specific lines with `critical`, `warning`, or `suggestion` severity
- **Structured output** — Uses Claude tool_use for guaranteed valid JSON responses
- **Adaptive model selection** — Scores PR complexity (0-100) and auto-escalates to Opus for security changes, large refactors, and multi-file PRs
- **Extended thinking** — Enables Claude's thinking mode for complex reviews, producing more thorough analysis
- **Priority-based diff sorting** — Security and core files are always reviewed first when token budget is tight
- **Full file context** — Fetches complete source of critical files so Claude understands the broader codebase, not just the diff
- **Two-pass triage** — Large diffs get a fast triage pass to identify files with issues, then a deep review of only those files
- **Token budget management** — Fits large diffs within context limits, continues past oversized files
- **Duplicate detection** — Skips posting if an identical review already exists
- **Prompt injection protection** — Sanitizes PR descriptions to prevent instruction override
- **Retry with backoff** — Handles transient API failures gracefully

## Quick Start

Add this workflow to your repository at `.github/workflows/ai-review.yml`:

```yaml
name: AI PR Review

on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  review:
    if: github.event.pull_request.draft != true
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
      contents: read
    steps:
      - name: AI Review
        uses: Fliplet/ai-pr-review-action@main
        with:
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `anthropic-api-key` | Yes | — | Anthropic API key for Claude |
| `github-token` | Yes | — | GitHub token for posting reviews |
| `review-mode` | No | `can-request-changes` | `can-request-changes` or `comment-only` |
| `model` | No | `claude-sonnet-4-20250514` | Explicit model override (bypasses auto-selection) |
| `max-diff-tokens` | No | `15000` | Maximum tokens for diff content |
| `max-output-tokens` | No | `4096` | Maximum tokens for Claude response |
| `auto-model-selection` | No | `true` | Auto-select model based on PR complexity |
| `enable-thinking` | No | `auto` | Extended thinking: `auto`, `always`, or `never` |

## How It Works

### Review Pipeline

```
PR opened/updated
  → Fetch diff from GitHub API
  → Parse into structured file changes
  → Filter to reviewable code files
  → Score PR complexity (0-100)
  → Select model (Sonnet or Opus)
  → Fetch full file context for critical files (if complex)
  → Apply token budget with priority sorting
  → [Optional] Triage pass for large diffs
  → Claude reviews diff with Fliplet standards
  → Post inline comments on GitHub PR
```

### Complexity Scoring

PRs are scored on a 0-100 scale to decide model selection and thinking mode:

| Criterion | Points |
|-----------|--------|
| Total changes > 200 lines | +20 |
| More than 10 files | +15 |
| Security-sensitive file paths (`auth`, `middleware`, `routes`, `session`, `token`, etc.) | +25 |
| Complexity keywords in title/body (`refactor`, `migration`, `security`, `breaking`, etc.) | +15 |
| More than 20 hunks across all files | +10 |
| Any single file with > 100 changes | +15 |

- **Score < 40** → Claude Sonnet (fast, cost-effective)
- **Score >= 40** → Claude Opus (deeper analysis)
- **Score >= 50** → Extended thinking enabled automatically

### Severity Levels

The reviewer classifies issues into three levels:

**Critical** (triggers `request_changes`):
- Security vulnerabilities (XSS, injection, exposed secrets)
- Using browser APIs instead of Fliplet equivalents (`localStorage` → `Fliplet.Storage`, `fetch()` → `Fliplet.API.request()`, `window.location` → `Fliplet.Navigate`)
- `eval()` usage, SQL concatenation, `innerHTML` with user input
- Modifying Fliplet core API objects

**Warning** (posted as `comment`):
- Missing error handling on promises/async
- Global scope pollution (no IIFE)
- Missing input validation
- API calls inside loops
- Vue Options API instead of Composition API

**Suggestion** (informational):
- Style improvements, naming conventions
- Better Fliplet API alternatives
- Code simplification opportunities

### File Prioritization

When the diff exceeds the token budget, files are reviewed in priority order:

1. **Security-sensitive files** (+1000) — `auth`, `middleware`, `routes`, `session`, `token`, `password`, `permission`, `sql`, `encrypt`, etc.
2. **Core application files** (+500) — `index.js`, `app.js`, `server.js`
3. **By change volume** — Files with more additions + deletions

### Two-Pass Triage

For very large diffs (>1.5x token budget AND >5 files):

1. **Pass 1 (Sonnet)** — Quick scan to identify which files likely have issues
2. **Pass 2 (selected model)** — Deep review of only the flagged files

This saves cost and focuses review effort where it matters.

## Full Example Workflow

See [`examples/ai-review.yml`](examples/ai-review.yml) for a production-ready workflow with:
- Path filtering (skips docs/config-only changes)
- Draft PR and bot author skipping
- Concurrency control (cancels stale reviews on new pushes)
- Manual trigger support via `workflow_dispatch`

## Configuration Examples

### Cost-conscious (Sonnet only, no thinking)

```yaml
- uses: Fliplet/ai-pr-review-action@main
  with:
    anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
    github-token: ${{ secrets.GITHUB_TOKEN }}
    auto-model-selection: 'false'
    enable-thinking: 'never'
```

### Maximum thoroughness (always Opus + thinking)

```yaml
- uses: Fliplet/ai-pr-review-action@main
  with:
    anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
    github-token: ${{ secrets.GITHUB_TOKEN }}
    model: 'claude-opus-4-5-20250514'
    enable-thinking: 'always'
    max-output-tokens: '8192'
```

### Comment-only mode (no request_changes)

```yaml
- uses: Fliplet/ai-pr-review-action@main
  with:
    anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
    github-token: ${{ secrets.GITHUB_TOKEN }}
    review-mode: 'comment-only'
```

## Cost Estimates

The action logs model-aware cost estimates after each review:

| Model | Input | Output | Typical Review |
|-------|-------|--------|----------------|
| Sonnet | $3/M tokens | $15/M tokens | ~$0.05-0.10 |
| Opus | $15/M tokens | $75/M tokens | ~$0.25-0.50 |

Adaptive model selection means Opus only triggers for ~10-20% of PRs (complex ones), keeping average cost close to Sonnet-only.

## Project Structure

```
ai-pr-review-action/
├── action.yml                  # GitHub Action definition
├── src/
│   ├── index.js                # Orchestrator: diff → score → triage → review → post
│   ├── claude-reviewer.js      # Claude API calls, prompt building, response parsing
│   ├── complexity-scorer.js    # PR complexity scoring (0-100) and model recommendation
│   ├── constants.js            # Shared patterns (security, core files, keywords, pricing)
│   ├── diff-parser.js          # Unified diff → structured file/hunk/line objects
│   ├── github-poster.js        # GitHub review posting with duplicate detection
│   ├── token-budget.js         # Priority-based truncation to fit context window
│   └── retry.js                # Exponential backoff retry wrapper
├── standards/
│   ├── fliplet-rules.md        # Fliplet coding standards (injected into prompt)
│   └── severity-rules.json     # Pattern definitions for critical/warning/suggestion
├── tests/                      # Jest test suite (128 tests)
├── docker/                     # CI Docker image
└── examples/
    └── ai-review.yml           # Production workflow template
```

## Development

```bash
# Install dependencies
npm ci

# Run tests
npm test

# Run tests with coverage
npx jest --coverage
```

## Requirements

- Node.js 20+
- Anthropic API key with access to Claude Sonnet 4 (and Opus 4.5 for adaptive mode)
- GitHub token with `pull-requests: write` and `contents: read` permissions
