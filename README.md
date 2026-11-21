[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/zairzuab/token-radar-v3/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/zairzuab/token-radar-v3/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

# Token Radar v3 — fitted comparables, token odds, costed farm verdicts

Entry for [make.fun bounty token-radar-01](https://make.fun/bounty/token-radar-01): build the best token launch radar. It reads a sealed snapshot of every protocol DefiLlama tracks, works out which ones still record no token, and ranks them by what their launch would be worth — then hands in a web dashboard with the board, a detail view for each protocol and the steps to farm it.

## The model (all three parts derive from the snapshot's own figures)

1. **Fitted value.** The 128 protocols in the snapshot that record a token with a market cap are the comparables. Least squares fits `log10(market cap) = 3.025 + 0.522 × log10(TVL)` (R² = 0.194), tested with a deterministic 5-fold holdout: median absolute log error 0.54 dex (~3.5×). Richer fits (adding growth, age, chain count) were tried and rejected on the same holdout — R² only 0.215 while the holdout error gets worse.
2. **Token odds.** The share of same-category peers at a similar TVL that already record a token, shrunk toward the category and global rates (global: 416 of 758).
3. **Screen.** The house's own watchlist rule applied to the whole pre-token universe: CEXs, bridges, liquid-staking / restaking products, wrapped or staked products, exchange-branded and versioned names keep 2% of value and sink to the bottom with a "Screened out" verdict — on size alone the naive top of the list is exchanges and wrapped BTC.

`implied = fitted_mcap(TVL) × growth_tilt × token_odds × screen_factor`

The board covers **all 342 pre-token protocols** (the 40-protocol watchlist whole, plus every eligible protocol below the floor), each with a costed farm plan: concrete steps with estimated gas cost by chain and minutes, plus a verdict (Priority farm / Worth farming / Marginal / Skip / Screened out) from value per dollar spent.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

`main.ts` (Node 22, standard library only) reads `/input/snapshot.json`, writes `board.json`, `data.js`, copies `dashboard/` and `screenshots/` to `/output`, and writes `dossier.json` with `buildDossier` from `vendor/makefun-board.ts`. The dashboard is a static page with no network: sortable/filterable board, per-protocol detail with the value decomposition, nearest live-token comparables, the fitted curve with its holdout table, a model sandbox, and a separate reference list of the protocols that already have a token.

## Honest limits

The fitted curve explains only R² = 0.194 of log market cap and the holdout median error is 0.54 dex — treat every implied value as an order of magnitude, not a price target. "Records no token" means the snapshot records none. Nothing here predicts whether or when a token is issued. Gas costs are rough per-transaction estimates by chain.
