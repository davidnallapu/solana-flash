# Solana Arbitrage Bot

An automated arbitrage bot that monitors and executes profitable trading opportunities between Jupiter and Raydium on Solana.

## Overview

This bot continuously monitors price differences between Jupiter and Raydium DEXs for configured trading pairs. When a profitable opportunity is detected (accounting for fees and slippage), it executes an atomic arbitrage transaction using flash loans from Mango Markets.

### Key Features

- Real-time price monitoring
- Flash loan integration with Mango Markets
- Atomic execution via smart contract
- Slippage protection
- Gas cost optimization
- Rate limiting
- Health monitoring endpoint

## Architecture

The system consists of two main components:

1. **Smart Contract (Rust)**
   - Handles on-chain execution
   - Manages flash loans
   - Ensures atomic execution
   - Interacts with DEX programs

2. **Monitoring Bot (TypeScript)**
   - Monitors prices
   - Detects opportunities
   - Triggers smart contract
   - Provides health metrics

## Prerequisites

- Node.js v16+
- Rust and Cargo
- Solana CLI
- Phantom Wallet with SOL and tokens for trading

## Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/solana-arbitrage-bot.git
cd solana-arbitrage-bot
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env
# Edit .env with your configuration
```

4. Build the smart contract:
```bash
cd programs/arbitrage
cargo build-bpf
```

5. Deploy the smart contract:
```bash
solana program deploy target/deploy/arbitrage.so
```

## Configuration

1. Set your Phantom wallet private key in `.env`
2. Configure trading pairs in `src/arbitrage-bot.ts`
3. Adjust profit thresholds and slippage tolerance
4. Set rate limiting parameters

## Usage

Start the bot:
```bash
npm start
```

Monitor health:
```bash
curl http://localhost:3000/health
```

## Security Considerations

- Never commit your `.env` file
- Secure your private keys
- Start with small trade amounts
- Monitor for unexpected behavior
- Use rate limiting to prevent spam

## Trading Pairs

Currently supported trading pairs:
- USDC/SOL
- (Add other pairs here)

## License

MIT

## Disclaimer

This bot is provided as-is. Use at your own risk. Cryptocurrency trading carries significant risks.