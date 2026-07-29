# Progress bar v1 scope

v1 ships the percent progress bar in `check-balance.ts`'s single-window
percent branch only — covering providers like MiniMax. The single-window
branch shares `formatBalance()` with the multi-window branch, so covering
both in one edit is mechanically trivial; this scope restriction is a
deliberate deferral, not a structural blocker.

## Considered Options

- **Both single- and multi-window in v1** — would require duplicating
  the bar render inside the `r.tiers.map(...)` loop. Brings the visual to
  volcengine's `0%, 0%: 6d13h, 15%: 17d13h` line on day one, where three
  bars in one line crowd narrow terminals.
- **Single-window only (chosen)** — keeps `progressBar()` signature at
  `(used: number, width?: number) => string` for v1. Multi-window can be
  added later by widening the signature to accept `BalanceTier[]` and
  looping; both changes stay local.
- **All percent callers incl. standalone scripts** — each standalone
  provider (`minimax.ts`, `volcengine.ts`) has its own `formatText`
  closure, and duplicating bar rendering there historically drifts from
  the main `formatBalance()`. Adding more surface area increases drift
  risk in proportion.

## Consequences

- `progressBar()` stays single-number for v1. Extending to multi-tier
  later is a contained refactor — change signature, add a loop, no
  caller churn outside `check-balance.ts`.
- The single-vs-multi asymmetry is documented in `CONTEXT.md`, so a
  reader sees it as deliberate rather than as "forgot the multi-window
  case".
- Future requests to extend the bar to volcengine and to standalone
  scripts will arrive. The ADR is the receipt that those paths were
  considered v1-out-of-scope, not missed.
