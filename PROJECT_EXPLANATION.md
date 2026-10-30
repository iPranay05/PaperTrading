# ALPHA-AGENT: Autonomous Agentic Paper-Trading Platform
> **Specification**: Problem Statement 02 (PS-02) — Autonomous Paper-Trading Bot  
> **Tech Stack**: Next.js 16 (App Router), Tailwind CSS v4, Prisma ORM, SQLite, Recharts, CCXT, Groq SDK, Google Generative AI SDK  
> **Mode**: **STRICTLY SIMULATION / PAPER TRADING ONLY** (Zero real capital at risk)

---

## 1. Executive Summary

**ALPHA-AGENT** is a full-stack, autonomous algorithmic trading platform that leverages **Dual-LLM Ensemble intelligence** (Groq + Google Gemini) combined with **hard-coded, deterministic mathematical risk gates** and automated **pre-registered journaling**.

Unlike conventional black-box trading bots or naive AI wrappers that directly send buy/sell orders, ALPHA-AGENT implements a multi-stage defense-in-depth trading pipeline:

```
[ Market Data & News ]
         │
         ▼
[ Ingestion & Prompt Injection Sanitizer ] ──► (Discards spam, prompt attacks)
         │
         ▼
[ Autonomous Agent Loop & Regime Detector ] ──► (Trending, Ranging, Volatile)
         │
         ▼
[ Walk-Forward Strategy Backtest Verification ] ──► (Must beat Buy & Hold on Sharpe)
         │
         ▼
[ Dual-LLM Ensemble Consensus (Groq + Gemini) ] ──► (Independent thesis & confidence)
         │
         ▼
[ Pre-Registered Thesis & Invalidation Register ] ──► (Explicit stop & thesis recorded)
         │
         ▼
[ Deterministic Risk Gate (Code, Not LLM) ] ──► (1% risk, 3% daily limit, 5 positions)
         │
         ▼
[ Paper Broker Adapter (Alpaca / Binance Testnet) ] ──► (Bracket orders only)
         │
         ▼
[ Journal Audit Trail & Calibration Scorecard ] ──► (Brier score & reliability tracking)
```

---

## 2. Core Pillars & Architecture

### A. Dual-LLM Ensemble Architecture
No single LLM is granted unilateral trading authority. Every candidate asset is evaluated independently across two distinct LLM providers:
1. **Groq Cloud**: Evaluated using high-speed reasoning models (`openai/gpt-oss-20b`, falling back to `qwen/qwen3.8-27b`).
2. **Google Gemini**: Evaluated using deep multimodal reasoning models (`gemini-3.5-flash-lite`, falling back to `gemini-3.1-flash-lite`, then `gemini-3.5-flash`).

- **Agreement Logic**:
  - **Full Consensus**: Both models recommend the same action and side $\rightarrow$ Order size proceeds at full formula allocation.
  - **Partial Disagreement**: Models agree on side but differ on confidence $\rightarrow$ Order size automatically **halved (shrunk by 50%)**.
  - **Directional Conflict**: One model recommends Buy, the other recommends Sell/Skip $\rightarrow$ **Trade is automatically aborted/skipped**.

---

### B. Deterministic Mathematical Risk Gate
> **Crucial Rule**: The LLM *never* sizes positions or bypasses risk boundaries. Position sizes and stops are calculated strictly by deterministic mathematical code:

1. **Fixed Risk Formula**:
   $$\text{Position Size} = \frac{\text{Portfolio Equity} \times 1\%}{|\text{Entry Price} - \text{Stop-Loss Price}|}$$
2. **Mandatory Bracket Orders**: Every submitted order must carry a hard-coded stop-loss. Unhedged market orders are rejected.
3. **Daily Loss Limit**: If cumulative daily drawdown reaches **3.0%** of starting portfolio equity, trading immediately halts for the remainder of the session.
4. **Position Caps**:
   - Maximum **5 concurrent open positions**.
   - Maximum **20.0% total portfolio exposure** in any single asset.
5. **Emergency Kill Switch**:
   - One-click trigger in the UI header and API (`/api/kill-switch`).
   - Instantly halts the autonomous loop, cancels all open broker orders, and closes open positions.

---

### C. Signal vs. Noise Filter & Prompt Injection Defense
Financial news headlines and social media streams often contain sensational clickbait, PR noise, or adversarial prompt injections.

- **Automated Headline Scoring**: The agent evaluates news relevance on a `0.00` to `1.00` scale. Only high-conviction signals ($\ge 0.75$) influence strategy priors.
- **Prompt Injection Defense** (`src/lib/security/sanitize.ts`), layered:
  1. *Sanitize*: Unicode NFKC, strip zero-width/bidi/control characters, collapse all whitespace **including newlines** into one line, neutralise backticks/angle brackets, cap at 280 chars.
  2. *Detect*: pattern heuristics (instruction overrides, role markers, chat-template tokens, forced-trade/leverage language, JSON look-alikes, embedded newlines). Flagged headlines are **rejected before any LLM call** and logged as noise with the matched rule names.
  3. *Fence*: surviving text is passed to the LLM as numbered JSON string literals inside a block with a random per-call token, so it cannot close the block or start a fake instruction line. System prompts tell the model that block is data only.
  4. *Hard stop*: even a fully fooled model cannot trade: every order still passes the deterministic risk gate and the kill switch.
  This is defense in depth, not a guarantee; heuristics can be evaded, which is why layer 4 exists.

---

### D. Walk-Forward Backtest Engine
Before committing simulated capital, strategies must prove statistical viability:
- **Strategies Supported**:
  1. *Fast/Slow SMA Crossover* (Trend following)
  2. *RSI Mean-Reversion* (Oversold/Overbought counter-trend)
  3. *Donchian Breakout* (Volatility breakouts with volume confirmation)
- **Anchored walk-forward with real parameter fitting**: the first 70% of history is the initial training window and the rest is cut into 3 out-of-sample folds (configurable). For each fold, a small parameter grid is scored **only on bars before the fold**; the best in-sample Sharpe (min 5 trades) wins, is frozen, and then trades the unseen fold. Fold results are chained into one out-of-sample equity curve. Passing explicit `params` disables fitting. Tests prove the chosen parameters do not change when future data is altered.
- **Realistic Friction**: Incorporates trading commissions (0.10%) and execution slippage (5 bps).
- **Benchmark Comparison**: Must beat a passive **Buy-and-Hold** strategy out-of-sample: enough evidence (default ≥100 test bars and ≥10 trades), positive net return, and higher total return *and* Sharpe than buy-and-hold. Sharpe is annualised with √252 for stocks and √365 for crypto.
- **Execution model**: Shorts receive sale proceeds on entry and are marked to market as a liability; signals are bound to their bar by index; bars with missing prices are dropped, never zero-filled. Run `npm run test:backtest` for the regression tests.

---

### E. Pre-Registered Theses & Journaling
Every trade records a permanent record in SQLite via Prisma:
- **Observation**: Exact price action, moving averages, and news headlines present at decision time.
- **Thesis**: Why the agent is entering the trade.
- **Falsifiable Invalidation Condition**: What exact market behavior proves the thesis wrong (e.g. *"Daily close below 200 EMA at $224.00"*).
- **Confidence Breakdown**: Individual Groq vs. Gemini probabilities and ensemble action.
- **Risk Calculation**: Exact formula variables and capital allocation.
- **Outcome & P&L**: Post-trade realization upon closure.

---

### F. Model Calibration Scorecard (Brier Score)
Measures whether the LLM's subjective confidence matches empirical reality:
- **Brier Score Metric**:
  $$\text{BS} = \frac{1}{N} \sum_{t=1}^N (f_t - o_t)^2$$
  *(where $f_t$ is the forecast probability between 0 and 1, and $o_t \in \{0, 1\}$ is the actual trade win/loss outcome)*.
- **Reliability Diagram**: Compares predicted confidence buckets (50-60%, 60-70%, 70-80%, 80-90%, 90-100%) against realized win rates.

---

## 3. Directory Layout

```
paper-trading-bot/
├── prisma/
│   ├── schema.prisma              # Data models: Trade, JournalEntry, BacktestResult, Position, AgentState, NewsItem, DailySnapshot
│   └── dev.db                     # Local SQLite database
├── src/
│   ├── app/
│   │   ├── layout.tsx             # Global layout with sticky simulation banner, header, & sidebar
│   │   ├── globals.css            # Dark theme styles & Tailwind v4
│   │   ├── page.tsx               # Overview dashboard (KPIs, Recharts equity curve, positions, decisions)
│   │   ├── journal/page.tsx       # Pre-registered theses & dual-LLM journal feed
│   │   ├── backtest/page.tsx      # Out-of-sample strategy backtest runner & comparison
│   │   ├── signals/page.tsx       # Signal vs noise filter & prompt injection defense sandbox
│   │   ├── calibration/page.tsx   # Model calibration reliability diagram & Brier scorecard
│   │   ├── settings/page.tsx      # Risk gate parameters & live broker/LLM connectivity
│   │   └── api/
│   │       ├── agent/route.ts     # Loop controls: start, stop, manual cycle
│   │       ├── kill-switch/route.ts # Emergency cancellation & liquidation
│   │       ├── trades/route.ts    # Trade history & performance statistics
│   │       ├── positions/route.ts # Mark-to-market open positions
│   │       ├── journal/route.ts   # Decision journal feed & filtering
│   │       ├── backtest/route.ts  # Historical backtesting endpoint
│   │       ├── signals/route.ts   # Headline scoring & injection test
│   │       ├── calibration/route.ts # Brier score calculations
│   │       ├── settings/route.ts  # Risk configuration persistence
│   │       └── init/route.ts      # Database seeding & initial state setup
│   ├── lib/
│   │   ├── agent/loop.ts          # Autonomous agent orchestrator & tool execution
│   │   ├── risk/gate.ts           # Deterministic risk validation & sizing logic
│   │   ├── broker/adapters.ts     # Alpaca Paper API & Binance Testnet adapters
│   │   ├── llm/wrapper.ts         # Dual-LLM ensemble (Groq + Gemini) with disk caching
│   │   ├── backtest/engine.ts     # Historical simulation engine with train/test splits
│   │   ├── db.ts                  # Prisma Client singleton
│   │   ├── types.ts               # Shared TypeScript schemas & interfaces
│   │   └── seed.ts                # Initial demo dataset
│   └── components/
│       ├── layout/PaperModeBanner.tsx # Sticky warning banner (Zero capital risk)
│       ├── layout/Header.tsx          # Real-time status badges & emergency kill switch
│       └── layout/Sidebar.tsx         # Section navigation & system health
├── .env.example                   # Environment configuration template
└── package.json                   # Dependencies & run scripts
```

---

## 4. Environment Variables (`.env`)

Copy `.env.example` to `.env`. The variables the code actually reads:

```env
GROQ_API_KEY / GEMINI_API_KEY            # LLM providers (GOOGLE_API_KEY also accepted)
GROQ_MODEL, GROQ_FALLBACK_MODEL          # optional overrides
GEMINI_MODEL, GEMINI_FALLBACK_MODEL, GEMINI_LAST_RESORT_MODEL
ALPACA_API_KEY / ALPACA_API_SECRET / ALPACA_BASE_URL   # stock paper broker
CRYPTO_EXCHANGE / CRYPTO_API_KEY / CRYPTO_API_SECRET / CRYPTO_SANDBOX  # crypto testnet via CCXT
CRYPTOPANIC_API_KEY / FINNHUB_API_KEY    # news
```

Risk limits (1% per trade, 3% daily loss, 5 positions, 20% exposure) are stored in the database and edited on the Settings page; they are not environment variables.

---

## 5. Getting Started & Local Execution

### 1. Install Dependencies
```bash
npm install
```

### 2. Setup SQLite Database
```bash
npx prisma db push
```

### 3. Run the Development Server
```bash
npm run dev
```

Open **`http://localhost:3000`** in your browser.

---

## 6. Page-by-Page Feature Tour

1. **Dashboard Overview (`/`)**:
   - Total Simulated Equity, Daily P&L ($ and %), Win Rate, and Profit Factor KPI cards.
   - Live interactive Recharts Equity Curve.
   - Open Positions table with unrealized P&L, stop-loss price, and portfolio exposure %.
   - Live Agent controls: Start Agent Loop, Stop Agent, or Trigger Single Cycle Now.
   - Emergency Kill Switch button.

2. **Agent Journal (`/journal`)**:
   - Searchable, filterable feed (All, Executed Trades, Skips, Risk Rejected).
   - Pre-registered trade thesis cards displaying market observations, Dual-LLM consensus breakdown, exact deterministic risk math, and falsifiable invalidation conditions.

3. **Backtesting (`/backtest`)**:
   - Interactive walk-forward strategy runner (SMA, RSI, Breakout).
   - Adjustable parameters, fees, slippage, and train/test splits.
   - Direct comparison against Buy & Hold benchmark with Sharpe ratio and Drawdown analysis.

4. **Signal vs. Noise (`/signals`)**:
   - Real-time news feed categorized into Actionable Signal vs. Filtered Noise.
   - Interactive Prompt Injection Defense sandbox: enter adversarial inputs and inspect real-time sanitization and gate rejection.

5. **Calibration Scorecard (`/calibration`)**:
   - Mathematical Brier score evaluating model confidence accuracy.
   - Reliability diagram comparing predicted probabilities against realized win rates.

6. **Settings & Risk Controls (`/settings`)**:
   - Configure hard limits: risk per trade %, daily loss limit %, max positions, max single-asset exposure.
   - Real-time connectivity status badges for Groq, Gemini, Alpaca, and Binance.
