# Alpha-Agent — Autonomous Paper Trading Platform

An AI-driven **paper-trading** app (no real money, ever). An agent watches a watchlist of Indian stocks, US stocks and crypto, filters news into signal vs noise, backtests a strategy, asks **two LLMs (Groq + Gemini)** for a trade idea, and only trades when they agree **and** a deterministic risk gate approves. Every decision, including every skip and rejection, is written to a journal.

> **Principle:** the LLM proposes, deterministic code disposes. Position sizing, stop-losses and limits are plain code with no LLM involved.

## Features

| Page | What it does |
|---|---|
| **Dashboard** | Equity, daily P&L, open positions, win rate, profit factor, start/stop agent, run one cycle |
| **Price Charts** | Real daily candlesticks, volume, SMA 20/50, and the agent's entries and stop-losses for any symbol |
| **Journal** | Every decision (trade / skip / rejected) with observation, thesis, invalidation, confidence and risk math |
| **Signals** | News headlines scored as signal or noise, plus a prompt-injection test box |
| **Backtest** | Walk-forward backtest with fees and slippage, compared against buy-and-hold |
| **Calibration** | Brier score and expected-vs-actual win rate by confidence bucket |
| **Settings** | Risk limits (stored in the database) and API key status |

**Safety built in**
- Paper only: non-paper broker URLs are refused and the crypto exchange is forced into testnet mode.
- Mandatory stop-loss on every order; trades with a stop on the wrong side of entry are rejected.
- Risk gate: 1% risk per trade, 3% daily loss limit, max 5 positions, 20% exposure per symbol (all editable in Settings).
- Kill switch: stops the agent, cancels orders and closes positions.
- Headlines go through sanitising and injection detection before they reach any LLM.
- A strategy must beat buy-and-hold out of sample before the agent will trade it.

## Tech stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · Prisma + SQLite · Tailwind CSS 4 · Recharts · Groq SDK · Google Generative AI · CCXT · technicalindicators

## Quick start

Requires Node.js 20+.

```bash
npm install            # also runs `prisma generate`
cp .env.example .env   # then fill in what you have (everything is optional)
npx prisma db push     # creates/updates the SQLite database
npm run dev            # http://localhost:3000
```

With **no keys at all** the app starts using the built-in simulated broker and real public prices. To get actual AI-driven trades you need both a Groq and a Gemini key (the trade decision requires both models to agree).

### Environment variables (`.env`)

| Variable | Purpose |
|---|---|
| `GROQ_API_KEY`, `GEMINI_API_KEY` | LLM providers (free tiers). Both needed for trades |
| `GROQ_MODEL`, `GROQ_FALLBACK_MODEL`, `GEMINI_MODEL`, ... | Optional model overrides. Set these if a provider reports "model not found" |
| `ALPACA_API_KEY`, `ALPACA_API_SECRET`, `ALPACA_BASE_URL` | Alpaca **paper** account for US stocks. Empty = simulator |
| `CRYPTO_EXCHANGE`, `CRYPTO_API_KEY`, `CRYPTO_API_SECRET`, `CRYPTO_SANDBOX` | CCXT testnet for crypto. Empty = simulator. `CRYPTO_SANDBOX=false` is refused |
| `CRYPTOPANIC_API_KEY`, `FINNHUB_API_KEY` | Optional news sources |

Risk limits are **not** environment variables. Edit them on the Settings page.

## Using it

1. Open the dashboard. First load creates the agent state (₹10,00,000 starting equity).
2. Press **Start** for a recurring loop (every 5 minutes), or run a single cycle.
3. Watch the **Journal** to see why it traded or skipped.
4. Use the **kill switch** in the header to halt everything.

Default watchlist: `RELIANCE.NS, TCS.NS, INFY.NS, HDFCBANK.NS, TATAMOTORS.NS, AAPL, NVDA, BTC/USDT, ETH/USDT, SOL/USDT`.

Strategies: `sma_crossover` (trending), `rsi_reversion` (ranging), `breakout` (volatile), picked from the detected market regime.

### Simulator vs real paper brokers

- **Simulator (default):** ₹5,00,000 per market, orders fill instantly at the live price, stops and targets are checked each cycle. State is kept in SQLite.
- **Alpaca paper / crypto testnet:** used automatically when their keys are set. Alpaca does not trade Indian `.NS` symbols; those only work in the simulator.

## Demo data

The repo ships with a `prisma/dev.db` that contains some demo journal entries and a sample equity figure.

- Load demo positions and equity: `POST /api/seed-inr`
- Wipe everything to a clean ₹10,00,000 slate: `POST /api/reset`

Both are POST-only so a link prefetch can't change your data.

## API

| Route | Methods | Purpose |
|---|---|---|
| `/api/agent` | GET, POST `{action: start\|stop\|cycle}` | Status and control |
| `/api/kill-switch` | GET, POST `{action: activate\|deactivate}` | Emergency stop |
| `/api/chart` | GET `?symbol=&days=` | Real OHLCV candles, SMAs and agent trades |
| `/api/positions`, `/api/trades` | GET | Positions, trades and stats |
| `/api/journal`, `/api/signals` | GET (signals also POST) | Journal and news signals |
| `/api/backtest` | GET, POST | Run and list backtests |
| `/api/calibration` | GET | Confidence calibration |
| `/api/settings` | GET, POST | Risk limits |
| `/api/init`, `/api/reset`, `/api/seed-inr` | GET / POST / POST | Initialise, wipe, demo data |

## Development

```bash
npm run lint        # ESLint
npx tsc --noEmit    # type-check
npm test            # sanitiser and backtest unit tests
npm run build       # production build
```

Project layout: `src/app` (pages and API routes), `src/lib/agent` (loop), `src/lib/risk` (risk gate), `src/lib/broker` (adapters and simulator), `src/lib/llm` (Groq/Gemini wrapper and ensemble), `src/lib/backtest` (engine), `src/lib/security` (sanitiser), `prisma/schema.prisma`.

## Status and known limits

- Static checks pass (type-check, lint, unit tests, production build), but the full live loop (start, analyse, trade, stop-loss, P&L) has not been exercised end to end against live data and keys. Report problems from your first run.
- Free price sources (Yahoo Finance, Binance public API) can rate-limit; affected symbols are skipped, never traded on a guessed price.
- Stop-losses in the simulator are checked once per cycle, so an intra-cycle spike through a stop is not seen.
- Default LLM model names may go out of date; override them in `.env`.

## Disclaimer

For education and experimentation only. Not financial advice. Paper trading results do not predict real performance.

## Demo mode

The dashboard has a **Demo Simulation** button (POST `/api/demo`) that fills the app with sample positions, closed trades, journal theses and news in INR, and a **Reset** button (POST `/api/reset`) that restores a clean ₹10,00,000 slate.
