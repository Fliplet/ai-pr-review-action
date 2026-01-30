# Refresh Knowledge Runbook

This runbook documents how to regenerate the repo-specific standards files using the Fliplet Knowledge MCP. This is a **manual process** run by a developer with Claude Code access when the codebase evolves significantly.

## When to Refresh

- Major refactoring of fliplet-api route patterns or middleware
- New authentication or authorization patterns introduced
- Fliplet Studio migrates to a new Vue version or framework
- Widget SDK changes (new lifecycle methods, deprecated APIs)
- New core libraries added to fliplet-api
- Significant changes to widget.json schema or conventions

## Prerequisites

- Claude Code CLI with MCP access
- Fliplet Knowledge MCP server configured and running
- Access to the `ai-pr-review-action` repository

## Files to Regenerate

| File | Repo | What to Query |
|------|------|---------------|
| `standards/fliplet-api-rules.md` | fliplet-api | Route patterns, middleware chains, libs, Sequelize patterns, response conventions |
| `standards/fliplet-studio-rules.md` | fliplet-studio | Vue component patterns, state management, event bus, router config |
| `standards/fliplet-widget-rules.md` | fliplet-widget-* | Widget lifecycle, IIFE patterns, widget.json, provider pattern |
| `standards/severity-rules.json` | all | `repoSpecific` section — update pattern IDs and descriptions |

## Step-by-Step Process

### 1. Research Current Patterns

Open Claude Code in the `ai-pr-review-action` directory and run MCP queries:

**For fliplet-api:**
```
search_fliplet_code(query="Express route middleware authenticate preloaders hasAnyRoles", repo="fliplet-api")
search_fliplet_code(query="res.json res.error response patterns route handler", repo="fliplet-api")
search_fliplet_code(query="Sequelize query raw SQL parameterized database model", repo="fliplet-api")
search_fliplet_code(query="libs authenticate organizationAdmin billing io.js", repo="fliplet-api")
```

**For fliplet-studio:**
```
search_fliplet_code(query="Vue Composition API setup ref reactive component", repo="fliplet-studio")
search_fliplet_code(query="LFD framework studio component pattern", repo="fliplet-studio")
search_fliplet_code(query="bus.$emit bus.$on event bus pattern", repo="fliplet-studio")
search_fliplet_code(query="state management store mutations", repo="fliplet-studio")
```

**For widgets:**
```
search_fliplet_code(query="Fliplet.Widget.instance getData save complete lifecycle build.js")
search_fliplet_code(query="widget.json provider pattern interface.html build.html IIFE")
search_fliplet_code(query="Fliplet.Widget.onSaveRequest validation complete")
```

### 2. Review MCP Results

For each query, review the returned code snippets and identify:
- **Standard patterns** that appear in most files (these become rules)
- **Anti-patterns** that are known problems (these become violations)
- **New patterns** not currently in the standards files

### 3. Update Standards Files

Edit each `standards/*.md` file with:
- Updated code examples from real MCP results
- New rules for patterns that have emerged
- Removed rules for deprecated patterns
- Accurate middleware/library names from current code

### 4. Update severity-rules.json

Update the `repoSpecific` section with any new pattern IDs and descriptions.

### 5. Run Tests

```bash
cd ai-pr-review-action
npm test
```

Ensure all tests pass — the test suite validates that:
- `buildSystemPrompt()` loads severity rules correctly
- `buildUserPrompt()` includes standards and repo-specific content
- Repo-specific standards files are loadable

### 6. Commit and Tag

```bash
git add standards/ scripts/
git commit -m "chore: refresh repo-specific standards from MCP knowledge"
git push
# Update the v1 tag if using semantic action versioning
git tag -fa v1 -m "Update v1 tag"
git push --force origin v1
```

## Notes

- The MCP is a local protocol — it cannot be called from CI runners
- Standards files are static assets committed to the repo
- Token budget: aim for ~200-300 lines per repo-specific file (~1,000-1,500 tokens each)
- The base `fliplet-rules.md` should remain under 300 lines
- Total standards in prompt: base + repo-specific ≈ 3,000-4,000 tokens (well within budget)
