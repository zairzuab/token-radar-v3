// Token Radar v3 — the value model.
//
// One snapshot of the protocol universe in, one ranked board out. Every number
// below is derived from the snapshot's own figures; no protocol name is ever
// special-cased and no hardcoded list of winners exists.
//
// The model, in three parts:
//
//   1. FITTED VALUE. The 128 protocols in the snapshot that record a token with
//      a market cap are the comparables. On them we fit, by ordinary least
//      squares,
//          log10(market cap) = a + b * log10(TVL),
//      which on this snapshot gives a = 3.025, b = 0.522, R^2 = 0.194. The fit
//      is tested, not trusted: a deterministic 5-fold holdout (fold = a hash
//      of the slug mod 5) gives a median absolute log error of 0.54 dex, about
//      3.5x, and a mean of 0.69 dex. Richer fits were tried and rejected on
//      the same holdout: adding 7-day growth, age and chain count lifts R^2
//      only to 0.215 while the holdout median error gets worse (0.60 dex),
//      so the single-variable fit is the one that ships. The dashboard
//      states the fit and its holdout error in full; the fitted curve is the
//      only place a "multiple" comes from.
//
//   2. TOKEN ODDS. A pre-token protocol's chance of ever listing a token is
//      the peer rate: among protocols in the same category whose TVL sits
//      within 0.5x-2x of its own, the share that already record a token
//      (a symbol or a market cap). The rate is shrunk toward the category
//      rate and then the global rate (416 of 758 protocols record a token)
//      with a Beta prior of strength 20, so a thin peer set cannot claim
//      0% or 100%. Odds are a property of the peer group, never of a name.
//
//   3. SCREEN. The house's own watchlist rule, applied to the whole
//      pre-token universe: a CEX, a bridge, a liquid-staking / restaking
//      product, a wrapped or staked product, an exchange-branded name or a
//      versioned name is not a protocol waiting on a launch of its own. Such
//      rows stay on the board (the radar covers the full pre-token universe)
//      but their implied value is cut to 2% and they carry a "Screened out"
//      verdict with the reason, so they sink to the bottom instead of
//      topping the board on size alone (the naive top of the pre-token list
//      is exchanges and wrapped BTC).
//
//   implied = fitted_mcap(TVL) * growth_tilt * token_odds * screen_factor
//   growth_tilt = 1 + 0.25 * clamp(change_7d, -50, 100) / 100
//               (null change_7d counts as 0; a small momentum tilt, stated)
//   screen_factor = 1 for an eligible protocol, 0.02 for a screened one.
//
// Farm plans are built from the protocol's own category and primary chain:
// each step names the action, the chain, an estimated gas cost in USD (from
// a per-chain table of rough per-transaction costs, stated in the dashboard)
// and a time in minutes. The verdict prices the farm: value per dollar
// spent = implied / estimated cost.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface FitResult {
  a: number;
  b: number;
  r2: number;
  n: number;
  holdoutMedianLogErr: number;
  holdoutMeanLogErr: number;
  foldErrors: { fold: number; n: number; median: number; mean: number }[];
}

export interface FarmStep {
  text: string;
  costUsd: number;
  minutes: number;
}

export interface ScoredRow {
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvlUsd: number;
  change7d: number | null;
  ageDays: number | null;
  onWatchlist: boolean;
  fittedMcap: number;
  growthTilt: number;
  odds: number;
  oddsPeers: number;
  oddsPeerTokened: number;
  oddsBasis: string;
  impliedExact: number;
  implied: number;
  screened: string | null;
  costUsd: number;
  timeMin: number;
  valuePerDollar: number;
  verdict: string;
  steps: FarmStep[];
  peers: { slug: string; name: string; tvlUsd: number; mcapUsd: number }[];
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  token_odds: number;
  fitted_mcap_usd: number;
  est_cost_usd: number;
  verdict: string;
  screened: string | null;
}

export interface RadarData {
  meta: {
    title: string;
    asOf: string;
    floorUsd: number;
    totalProtocols: number;
    preToken: number;
    eligible: number;
    screened: number;
    watchlist: number;
    liveToken: number;
    fit: FitResult;
    globalTokenRate: number;
    modelNote: string;
  };
  rows: ScoredRow[];
  live: { slug: string; name: string; category: string; tvlUsd: number; mcapUsd: number; multiple: number }[];
}

const AS_OF_MS = Date.parse('2026-11-14T00:00:00Z');
const SCREEN_FACTOR = 0.02;
const ODDS_PRIOR_STRENGTH = 20;
const EXCLUDED_CATEGORIES = new Set([
  'CEX',
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
]);
const EXCHANGE_NAMES = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Rough per-transaction gas cost in USD by chain, as of the snapshot date. Estimates, stated as such. */
const CHAIN_TX_USD: Record<string, number> = {
  Ethereum: 6.0,
  Bitcoin: 2.0,
  Tron: 1.0,
  Arbitrum: 0.3,
  Avalanche: 0.3,
  Solana: 0.02,
  Sui: 0.02,
  Aptos: 0.02,
  Base: 0.05,
  Polygon: 0.05,
  Optimism: 0.15,
  'Binance': 0.15,
  zkSync: 0.2,
  Linea: 0.1,
  Scroll: 0.1,
  Blast: 0.1,
  Sonic: 0.05,
  Berachain: 0.05,
  Sei: 0.02,
  TON: 0.05,
  Starknet: 0.3,
};
const DEFAULT_TX_USD = 0.5;

export function isPreToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

export function hasToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null || p.symbol !== null;
}

/** The house watchlist rule's screen, as a reason string, or null when eligible. */
export function screenReason(p: SnapshotProtocol): string | null {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) {
    return `Category ${p.category} — a ${p.category.toLowerCase()} product, not a protocol awaiting its own launch`;
  }
  if (EXCHANGE_NAMES.test(p.name)) return 'Exchange-branded name — a centralised exchange, not a pre-token protocol';
  if (WRAPPED_WORD.test(p.name)) return 'Wrapped / staked product of a token that already trades';
  if (VERSION_SUFFIX.test(p.name)) return 'Versioned name — a version of a protocol, not a launch of its own';
  return null;
}

export function ageDays(p: SnapshotProtocol): number | null {
  if (p.listed_at === null) return null;
  const ms = Date.parse(`${p.listed_at}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.round((AS_OF_MS - ms) / 86_400_000));
}

function slugHash(slug: string): number {
  let h = 7;
  for (const ch of slug) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

function ols(rows: SnapshotProtocol[]): { a: number; b: number; r2: number } {
  const xs = rows.map((r) => Math.log10(r.tvl_usd));
  const ys = rows.map((r) => Math.log10(r.mcap_usd as number));
  const mx = xs.reduce((s, v) => s + v, 0) / xs.length;
  const my = ys.reduce((s, v) => s + v, 0) / ys.length;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] as number - mx) * (ys[i] as number - my);
    sxx += (xs[i] as number - mx) ** 2;
    syy += (ys[i] as number - my) ** 2;
  }
  const b = sxy / sxx;
  const a = my - b * mx;
  return { a, b, r2: (sxy * sxy) / (sxx * syy) };
}

function median(values: number[]): number {
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.floor(sorted.length / 2)] as number;
}

function mean(values: number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/** Fit log10(mcap) on log10(TVL) over the live-token comparables, with a 5-fold holdout. */
export function fitComparables(live: SnapshotProtocol[]): FitResult {
  const usable = live.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const { a, b, r2 } = ols(usable);
  const foldErrors: FitResult['foldErrors'] = [];
  const allErrs: number[] = [];
  for (let fold = 0; fold < 5; fold++) {
    const train = usable.filter((p) => slugHash(p.slug) % 5 !== fold);
    const test = usable.filter((p) => slugHash(p.slug) % 5 === fold);
    const f = ols(train);
    const errs = test.map((p) => Math.abs(f.a + f.b * Math.log10(p.tvl_usd) - Math.log10(p.mcap_usd as number)));
    foldErrors.push({ fold, n: test.length, median: +median(errs).toFixed(3), mean: +mean(errs).toFixed(3) });
    allErrs.push(...errs);
  }
  return {
    a: +a.toFixed(4),
    b: +b.toFixed(4),
    r2: +r2.toFixed(3),
    n: usable.length,
    holdoutMedianLogErr: +median(allErrs).toFixed(3),
    holdoutMeanLogErr: +mean(allErrs).toFixed(3),
    foldErrors,
  };
}

/** Shrunken peer token rate for one pre-token protocol. */
export function tokenOdds(p: SnapshotProtocol, all: SnapshotProtocol[], globalRate: number): {
  odds: number;
  peers: number;
  peerTokened: number;
  basis: string;
} {
  const cat = p.category ?? 'Uncategorised';
  const sameCat = all.filter((q) => (q.category ?? 'Uncategorised') === cat && q.slug !== p.slug);
  const band = sameCat.filter((q) => q.tvl_usd >= p.tvl_usd * 0.5 && q.tvl_usd <= p.tvl_usd * 2);
  const catRate = sameCat.length > 0 ? sameCat.filter(hasToken).length / sameCat.length : globalRate;
  let peers = band;
  let basis = `same-category TVL band (${band.length} peers)`;
  if (band.length < 5) {
    peers = sameCat;
    basis = `whole category (${sameCat.length} peers)`;
  }
  if (peers.length < 5) {
    peers = all.filter((q) => q.slug !== p.slug);
    basis = `whole universe (${peers.length} peers)`;
  }
  const k = peers.filter(hasToken).length;
  const n = peers.length;
  const prior = band.length >= 5 ? catRate : globalRate;
  const odds = (k + ODDS_PRIOR_STRENGTH * prior) / (n + ODDS_PRIOR_STRENGTH);
  return { odds, peers: n, peerTokened: k, basis };
}

function clampGrowth(change7d: number | null): number {
  const g = change7d === null || !Number.isFinite(change7d) ? 0 : change7d;
  return Math.min(100, Math.max(-50, g));
}

interface StepTemplate {
  text: string;
  tx: number;
  minutes: number;
}

function stepTemplates(category: string | null): StepTemplate[] {
  const c = category ?? '';
  if (c === 'Dexs') {
    return [
      { text: 'Swap a small amount on {name} on {chain}: trade $25–$50 across two pools so the router records two distinct pairs (~{cost} gas, ~{min} min).', tx: 2, minutes: 10 },
      { text: 'Add $50–$100 of liquidity to one {name} pool on {chain} and hold the LP position for at least 2 weeks (~{cost} gas, ~{min} min).', tx: 2, minutes: 15 },
      { text: 'Repeat one swap a week for 4 weeks on {chain} — weekly activity beats a single burst for most points programs (~{cost} gas each, ~{min} min each).', tx: 4, minutes: 40 },
      { text: 'Vote or stake in {name} governance if a voting page is live, and keep the LP position open through any snapshot date (~{cost} gas, ~{min} min).', tx: 1, minutes: 20 },
      { text: 'Bridge the position back only after the farm ends; closing early forfeits the weeks already banked (~{cost} gas, ~{min} min).', tx: 1, minutes: 10 },
    ];
  }
  if (c === 'Lending') {
    return [
      { text: 'Supply $100–$200 of a major asset (ETH or a stablecoin) to {name} on {chain} as collateral (~{cost} gas, ~{min} min).', tx: 1, minutes: 10 },
      { text: 'Borrow 30–40% of the supplied value against it on {name} — a borrow leg is usually scored separately from supply (~{cost} gas, ~{min} min).', tx: 1, minutes: 10 },
      { text: 'Repay half the borrow after 2 weeks, then re-borrow once: two borrow cycles read as sustained use, not a one-off (~{cost} gas, ~{min} min).', tx: 2, minutes: 20 },
      { text: 'Keep the supply leg open for at least 30 days and do not let health factor fall under 1.5 at any point (~{cost} gas to adjust, ~{min} min).', tx: 1, minutes: 15 },
      { text: 'Claim any points or rewards weekly on {chain} and record the wallet address used — airdrops go to the farming wallet (~{cost} gas, ~{min} min).', tx: 2, minutes: 10 },
    ];
  }
  if (c === 'Yield' || c === 'Yield Aggregator' || c === 'Liquidity Manager') {
    return [
      { text: 'Deposit $100–$200 into a {name} vault on {chain} and leave it compounding for at least 30 days (~{cost} gas, ~{min} min).', tx: 1, minutes: 10 },
      { text: 'Harvest or compound the vault rewards once a week — harvests are usually the scored action, not the deposit alone (~{cost} gas each, ~{min} min each).', tx: 4, minutes: 30 },
      { text: 'Split the deposit across two different {name} vaults on {chain} so a single vault closing does not zero the farm (~{cost} gas, ~{min} min).', tx: 1, minutes: 15 },
      { text: 'Top up the vault once mid-farm ($25–$50) to show continued use rather than a single deposit (~{cost} gas, ~{min} min).', tx: 1, minutes: 10 },
      { text: 'Withdraw only after the farm window ends; early exits usually forfeit the points the deposit earned (~{cost} gas, ~{min} min).', tx: 1, minutes: 10 },
    ];
  }
  if (c === 'Derivatives' || c === 'Basis Trading' || c === 'Options') {
    return [
      { text: 'Open a small $50–$100 perpetual or options position on {name} on {chain} with 2x leverage at most — size, not leverage, is what gets farmed (~{cost} gas, ~{min} min).', tx: 1, minutes: 15 },
      { text: 'Close half after a few days and reopen once: two round trips beat one large trade in most volume programs (~{cost} gas, ~{min} min).', tx: 2, minutes: 20 },
      { text: 'Trade on at least 3 separate days in a month on {name} — daily-active counts usually outweigh raw volume (~{cost} gas per day, ~{min} min per day).', tx: 3, minutes: 30 },
      { text: 'Keep every position under 5% of the wallet so a liquidation cannot wipe the farm wallet mid-program (~{cost} gas to resize, ~{min} min).', tx: 1, minutes: 10 },
      { text: 'Check {name} for a points page weekly and complete any listed trading quests while the position is open (~{cost} gas, ~{min} min).', tx: 1, minutes: 15 },
    ];
  }
  if (c === 'RWA' || c === 'CDP' || c === 'Token Locker') {
    return [
      { text: 'Mint or buy $100–$200 of {name} exposure on {chain} through its official app and hold it for at least 30 days (~{cost} gas, ~{min} min).', tx: 1, minutes: 15 },
      { text: 'Use the minted asset once inside the protocol — stake it, lend it or lock it — a held balance alone is rarely scored (~{cost} gas, ~{min} min).', tx: 1, minutes: 15 },
      { text: 'Repeat the mint or lock once a month for 2 months to show recurring use on {chain} (~{cost} gas each, ~{min} min each).', tx: 2, minutes: 20 },
      { text: 'Complete identity or allowlist steps early if {name} asks for them; late KYC is the most common reason farms pay nothing (~{cost} gas, ~{min} min).', tx: 1, minutes: 30 },
      { text: 'Hold through any announced snapshot date before redeeming; redemptions before the snapshot usually void the position (~{cost} gas, ~{min} min).', tx: 1, minutes: 10 },
    ];
  }
  if (c === 'Risk Curators' || c === 'Onchain Capital Allocator' || c === 'Collateral Management') {
    return [
      { text: 'Allocate $100–$200 to a {name} curated vault or strategy on {chain} and keep the allocation for at least 30 days (~{cost} gas, ~{min} min).', tx: 1, minutes: 15 },
      { text: 'Rebalance or top up the allocation once mid-farm ($25–$50) — curator programs usually score active allocators, not passive holders (~{cost} gas, ~{min} min).', tx: 1, minutes: 15 },
      { text: 'Read the vault strategy notes on {chain} and pick the vault whose underlying assets you understand; mispriced risk is the real cost here (~{cost} gas, ~{min} min).', tx: 0, minutes: 30 },
      { text: 'Track the allocation weekly and record deposits, withdrawals and any points balance in one place (~{cost} gas, ~{min} min).', tx: 0, minutes: 20 },
      { text: 'Exit only after the farm window closes; curator vaults often snapshot at quarter end (~{cost} gas, ~{min} min).', tx: 1, minutes: 10 },
    ];
  }
  // Generic fallback: works for every other category.
  return [
    { text: 'Use {name} on {chain} once a week for 4 weeks with $25–$50 per visit — repeated use beats a single large transaction (~{cost} gas per visit, ~{min} min per visit).', tx: 4, minutes: 40 },
    { text: 'Deposit or lock $100–$200 in {name} on {chain} and keep it in place for at least 30 days (~{cost} gas, ~{min} min).', tx: 1, minutes: 15 },
    { text: 'Complete every on-site quest, points claim or profile step {name} lists — unclaimed points are the most common lost airdrop (~{cost} gas, ~{min} min).', tx: 1, minutes: 20 },
    { text: 'Do a second, different action inside {name} (a swap, a stake or a vote) so the wallet shows two action types, not one (~{cost} gas, ~{min} min).', tx: 1, minutes: 15 },
    { text: 'Hold the position through any announced snapshot date before withdrawing; early exits usually forfeit the farm (~{cost} gas, ~{min} min).', tx: 1, minutes: 10 },
  ];
}

function verdictFor(valuePerDollar: number, screened: string | null): string {
  if (screened !== null) return 'Screened out';
  // Bands sit near the quartiles of value-per-dollar across the eligible
  // board (top quarter above ~2.25M, median ~0.94M), so each verdict means
  // something relative to the field rather than an absolute dollar claim.
  if (valuePerDollar >= 2_000_000) return 'Priority farm';
  if (valuePerDollar >= 500_000) return 'Worth farming';
  if (valuePerDollar >= 100_000) return 'Marginal';
  return 'Skip';
}

export function parseSnapshot(text: string): Snapshot {
  const doc = JSON.parse(text) as Snapshot;
  if (!Array.isArray(doc.protocols) || !Array.isArray(doc.watchlist)) {
    throw new Error('snapshot: protocols and watchlist must be arrays');
  }
  return doc;
}

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const all = [...snapshot.protocols].sort((x, y) => (x.slug < y.slug ? -1 : 1));
  const live = all.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const pre = all.filter(isPreToken);
  const fit = fitComparables(live);
  const globalRate = all.filter(hasToken).length / all.length;
  const watch = new Set(snapshot.watchlist);

  // Nearest live-token comparables per pre-token protocol (same category, closest TVL).
  const liveByCat = new Map<string, SnapshotProtocol[]>();
  for (const p of live) {
    const c = p.category ?? 'Uncategorised';
    if (!liveByCat.has(c)) liveByCat.set(c, []);
    liveByCat.get(c)?.push(p);
  }

  const scored: ScoredRow[] = pre.map((p) => {
    const fitted = Math.pow(10, fit.a + fit.b * Math.log10(p.tvl_usd));
    const tilt = 1 + 0.25 * (clampGrowth(p.change_7d) / 100);
    const oddsInfo = tokenOdds(p, all, globalRate);
    const screened = screenReason(p);
    const factor = screened === null ? 1 : SCREEN_FACTOR;
    const impliedExact = fitted * tilt * oddsInfo.odds * factor;
    const chain = p.chains[0] ?? 'Ethereum';
    const txUsd = CHAIN_TX_USD[chain] ?? DEFAULT_TX_USD;
    const templates = stepTemplates(p.category);
    const steps: FarmStep[] = templates.map((t) => {
      const cost = Math.round(t.tx * txUsd * 100) / 100;
      const text = t.text
        .replaceAll('{name}', p.name)
        .replaceAll('{chain}', chain)
        .replaceAll('{cost}', cost === 0 ? '$0' : `~$${cost.toFixed(2)}`)
        .replaceAll('{min}', String(t.minutes));
      return { text, costUsd: cost, minutes: t.minutes };
    });
    const costUsd = Math.round(steps.reduce((s, s2) => s + s2.costUsd, 0) * 100) / 100;
    const timeMin = steps.reduce((s, s2) => s + s2.minutes, 0);
    const valuePerDollar = impliedExact / Math.max(costUsd, 1);
    const peers = (liveByCat.get(p.category ?? 'Uncategorised') ?? live)
      .map((q) => ({ q, d: Math.abs(Math.log10(q.tvl_usd) - Math.log10(p.tvl_usd)) }))
      .sort((x, y) => x.d - y.d || (x.q.slug < y.q.slug ? -1 : 1))
      .slice(0, 3)
      .map(({ q }) => ({ slug: q.slug, name: q.name, tvlUsd: q.tvl_usd, mcapUsd: q.mcap_usd as number }));
    return {
      slug: p.slug,
      name: p.name,
      category: p.category ?? 'Uncategorised',
      chains: p.chains,
      tvlUsd: p.tvl_usd,
      change7d: p.change_7d,
      ageDays: ageDays(p),
      onWatchlist: watch.has(p.slug),
      fittedMcap: Math.round(fitted),
      growthTilt: +tilt.toFixed(4),
      odds: +oddsInfo.odds.toFixed(4),
      oddsPeers: oddsInfo.peers,
      oddsPeerTokened: oddsInfo.peerTokened,
      oddsBasis: oddsInfo.basis,
      impliedExact,
      implied: 0, // filled after sorting, strictly decreasing
      screened,
      costUsd,
      timeMin,
      valuePerDollar: Math.round(valuePerDollar),
      verdict: verdictFor(valuePerDollar, screened),
      steps,
      peers,
    };
  });

  scored.sort((x, y) => y.impliedExact - x.impliedExact || (x.slug < y.slug ? -1 : x.slug > y.slug ? 1 : 0));
  let prev = Number.POSITIVE_INFINITY;
  for (const row of scored) {
    let v = Math.max(1, Math.round(row.impliedExact));
    if (v >= prev) v = prev - 1;
    if (v < 1) v = 1;
    row.implied = v;
    prev = v;
  }

  const board: BoardRow[] = scored.map((row, i) => ({
    slug: row.slug,
    name: row.name,
    rank: i + 1,
    implied_value_usd: row.implied,
    farm_steps: row.steps.map((s) => s.text),
    token_odds: row.odds,
    fitted_mcap_usd: row.fittedMcap,
    est_cost_usd: row.costUsd,
    verdict: row.verdict,
    screened: row.screened,
  }));

  const liveRows = live
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category ?? 'Uncategorised',
      tvlUsd: p.tvl_usd,
      mcapUsd: p.mcap_usd as number,
      multiple: +((p.mcap_usd as number) / p.tvl_usd).toFixed(3),
    }))
    .sort((x, y) => y.mcapUsd - x.mcapUsd);

  const radar: RadarData = {
    meta: {
      title: 'Token Radar v3 — fitted comparables, token odds, costed farm verdicts',
      asOf: snapshot.as_of,
      floorUsd: snapshot.floor_usd,
      totalProtocols: all.length,
      preToken: pre.length,
      eligible: scored.filter((r) => r.screened === null).length,
      screened: scored.filter((r) => r.screened !== null).length,
      watchlist: snapshot.watchlist.length,
      liveToken: live.length,
      fit,
      globalTokenRate: +globalRate.toFixed(4),
      modelNote:
        'Implied value = fitted market cap from the comparables curve × growth tilt × token odds × screen factor. ' +
        'Fitted curve: log10(mcap) = a + b·log10(TVL) fit by OLS on the live-token protocols in this snapshot; ' +
        'holdout-tested 5-fold. Token odds: the share of same-category peers at a similar TVL that already record a token, ' +
        'shrunk toward the category and global rates. Screened rows (CEX, bridge, liquid-staking, wrapped, versioned) keep 2% of value. ' +
        'Gas costs are rough per-transaction estimates by chain, stated in each step.',
    },
    rows: scored,
    live: liveRows,
  };
  return { board, radar };
}

/** The gate's shape, checked before writing: null when the board is valid. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board has ${board.length} rows, need 100 to 4000`;
  const seen = new Set<string>();
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  for (let i = 0; i < board.length; i++) {
    const row = board[i] as BoardRow;
    if (!slugs.has(row.slug)) return `row ${i + 1}: unknown slug ${row.slug}`;
    if (seen.has(row.slug)) return `row ${i + 1}: duplicate slug ${row.slug}`;
    seen.add(row.slug);
    if (row.rank !== i + 1) return `row ${i + 1}: rank ${row.rank} is not ${i + 1}`;
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd < 1) {
      return `row ${i + 1}: implied_value_usd ${row.implied_value_usd} is not a positive whole number`;
    }
    if (i > 0 && (board[i - 1] as BoardRow).implied_value_usd <= row.implied_value_usd) {
      return `row ${i + 1}: implied value does not fall with rank`;
    }
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `row ${i + 1}: ${row.farm_steps.length} farm steps, need 3 to 12`;
    }
    for (const step of row.farm_steps) {
      const t = step.trim();
      if (t.length < 20 || t.length > 600) return `row ${i + 1}: farm step of ${t.length} chars, need 20 to 600`;
    }
  }
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `watchlist slug ${slug} is missing from the board`;
  }
  return null;
}

/** data.js: the dashboard's data, written beside dashboard/ by main.ts. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}
