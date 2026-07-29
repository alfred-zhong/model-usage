# model-usage

Ubiquitous-language glossary for the `model-usage` CLI — AI model provider
balance/usage queries. Captures terms that recur across providers, output
formatting, and the percent / credit display layer. Code-agnostic: no
implementation details, no spec — vocabulary only.

## Display formats

**Progress bar**:
A `████████░░`-style 10-cell Unicode block bar rendered before the percent
text in the single-window percent-provider display. Filled portion is
coloured by the project's threshold scheme (green / orange / red);
empty portion is rendered uncoloured.
_Avoid_: meter, gauge, slider, indicator

**`%X` (percent text)**:
The numeric percent accompanying the progress bar — e.g. `4%`, `75%`,
`95%`. May not align cell-perfect with the bar: the bar rounds to the
nearest cell, so a fractional `used` (e.g. `4.5%`) can show as 0 filled
cells even while the text reads `4.5%`.

## Provider taxonomy

**Single-window percent provider**:
A provider whose `BalanceResult` has `currency === "percent"` and no
`tiers` array. Has one usage number and (typically) one reset
countdown. Currently: MiniMax. The v1 progress bar applies here.
_Avoid_: percent-only provider (ambiguous with multi-window)

**Multi-window percent provider**:
A provider whose `BalanceResult.tiers` is a non-empty array — each
tier is one sub-window (e.g. 5-hour / weekly / monthly). Currently:
volcengine Coding Plan. The v1 progress bar does NOT apply here
(deferred; see [ADR-0001](./docs/adr/0001-progress-bar-scope.md)).
_Avoid_: tiered provider, multi-tier provider
