import { Connection, PublicKey, Transaction, sendAndConfirmTransaction, TransactionInstruction, Keypair } from '@solana/web3.js';
import { Jupiter } from '@jup-ag/core';
import { MangoClient } from '@blockworks-foundation/mango-client';
import { RaydiumApi } from '@raydium-io/raydium-sdk';
import { Token, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { BN } from 'bn.js';
import * as dotenv from 'dotenv';
import pandas as pd;
import fs from 'fs';

dotenv.config();

interface TokenConfig {
  mint: string;
  decimals: number;
  minSize: number; // Minimum trade size in token units
}

interface TradingPair {
  tokenA: TokenConfig;
  tokenB: TokenConfig;
  minProfitPercent: number;
  maxSlippage: number;
}

interface TradeLog {
  timestamp: string;
  successful: boolean;
  tokenPair: string;
  principal: number;
  interest?: number;
  gasFee?: number;
  slippage?: number;
  profitLoss?: number;
  jupiterPrice?: number;
  raydiumPrice?: number;
  errorMessage?: string;
}

class ArbitrageBot {
  private connection: Connection;
  private wallet: Keypair;
  private mangoClient: MangoClient;
  private jupiter: Jupiter;
  private lastTradeTime: number = 0;
  private readonly RATE_LIMIT_MS = 1000; // 1 second between trades
  private readonly MAX_RETRIES = 3;
  private readonly TRANSACTION_FEE = 0.000005; // SOL (5000 lamports)
  private tradeHistory: TradeLog[] = [];
  private readonly LOG_FILE = 'trade_history.csv';
  
  // Trading configuration
  private readonly TRADING_PAIRS: TradingPair[] = [
    {
      tokenA: {
        mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
        decimals: 6,
        minSize: 100, // Minimum 100 USDC
      },
      tokenB: {
        mint: 'So11111111111111111111111111111111111111112', // SOL
        decimals: 9,
        minSize: 0.1, // Minimum 0.1 SOL
      },
      minProfitPercent: 0.5, // 0.5% minimum profit
      maxSlippage: 0.1, // 0.1% max slippage
    },
    // Add more pairs as needed
  ];

  // Add this to your ArbitrageBot class
  private readonly PROGRAM_ID = new PublicKey("ArB1TR9ge5nP4r1M2ooHhqrFe1T8yLmxqGCqFJBvmdzz");

  constructor() {
    // Load configuration from environment variables
    this.connection = new Connection(
      process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
      { commitment: 'confirmed' }
    );

    // Load wallet from private key
    const privateKeyString = process.env.WALLET_PRIVATE_KEY;
    if (!privateKeyString) {
      throw new Error('WALLET_PRIVATE_KEY not found in environment variables');
    }
    
    // Convert private key string to Uint8Array and create Keypair
    const privateKeyUint8 = Uint8Array.from(Buffer.from(privateKeyString, 'base58'));
    this.wallet = Keypair.fromSecretKey(privateKeyUint8);

    // Load program ID from environment
    this.PROGRAM_ID = new PublicKey(
      process.env.ARBITRAGE_PROGRAM_ID || 
      'ArB1TR9ge5nP4r1M2ooHhqrFe1T8yLmxqGCqFJBvmdzz'
    );
    
    // Load trading parameters
    this.MIN_PROFIT_PERCENT = parseFloat(process.env.MIN_PROFIT_PERCENT || '0.5');
    this.MAX_SLIPPAGE_PERCENT = parseFloat(process.env.MAX_SLIPPAGE_PERCENT || '0.1');
    this.RATE_LIMIT_MS = parseInt(process.env.RATE_LIMIT_MS || '1000');

    this.mangoClient = new MangoClient(this.connection, 'mainnet-beta');
  }

  async initialize() {
    try {
      this.jupiter = await Jupiter.load({
        connection: this.connection,
        cluster: 'mainnet-beta',
        restrictIntermediateTokens: true, // Reduce routing complexity
        wrapUnwrapSOL: true,
      });
      console.log('Arbitrage bot initialized successfully');
    } catch (error) {
      console.error('Failed to initialize arbitrage bot:', error);
      throw error;
    }
  }

  private async getRateLimit(): Promise<boolean> {
    const now = Date.now();
    if (now - this.lastTradeTime < this.RATE_LIMIT_MS) {
      return false;
    }
    this.lastTradeTime = now;
    return true;
  }

  private calculatePriceImpact(inputAmount: number, outputAmount: number, price: number): number {
    const expectedOutput = inputAmount * price;
    return Math.abs((outputAmount - expectedOutput) / expectedOutput) * 100;
  }

  private async getJupiterPrice(
    inputMint: string,
    outputMint: string,
    amount: number,
    pair: TradingPair
  ): Promise<{ price: number; route: any } | null> {
    try {
      const routes = await this.jupiter.computeRoutes({
        inputMint: new PublicKey(inputMint),
        outputMint: new PublicKey(outputMint),
        amount: new BN(amount),
        slippageBps: Math.floor(pair.maxSlippage * 100), // Convert to basis points
      });

      if (!routes.routesInfos.length) return null;

      const bestRoute = routes.routesInfos[0];
      const price = Number(bestRoute.outAmount) / Number(bestRoute.inAmount);
      
      // Check price impact
      const priceImpact = this.calculatePriceImpact(
        Number(bestRoute.inAmount),
        Number(bestRoute.outAmount),
        price
      );
      
      if (priceImpact > pair.maxSlippage) {
        console.log(`High price impact detected: ${priceImpact}%`);
        return null;
      }

      return { price, route: bestRoute };
    } catch (error) {
      console.error('Error getting Jupiter price:', error);
      return null;
    }
  }

  private async logTrade(trade: TradeLog) {
    this.tradeHistory.push(trade);
    
    // Convert to pandas DataFrame and save to CSV
    const df = pd.DataFrame(this.tradeHistory);
    df.to_csv(this.LOG_FILE, index=false);
  }

  private async executeArbitrage(
    pair: TradingPair,
    jupiterPrice: number,
    raydiumPrice: number,
    amount: number
  ) {
    const tradeLog: TradeLog = {
      timestamp: new Date().toISOString(),
      successful: false,
      tokenPair: `${pair.tokenA.mint}/${pair.tokenB.mint}`,
      principal: amount,
      jupiterPrice,
      raydiumPrice,
    };

    try {
      if (!await this.getRateLimit()) {
        console.log('Rate limit reached, skipping trade');
        return;
      }

      // Calculate potential profit including fees
      const estimatedGasCost = this.TRANSACTION_FEE * 2;
      tradeLog.gasFee = estimatedGasCost;

      const potentialProfit = Math.abs(jupiterPrice - raydiumPrice) * amount;
      const netProfit = potentialProfit - estimatedGasCost;

      if (netProfit <= 0) {
        tradeLog.errorMessage = 'No profit after fees';
        await this.logTrade(tradeLog);
        return;
      }

      // Take flash loan from Mango
      const flashLoanAmount = new BN(amount);
      const flashLoan = await this.mangoClient.flashLoan(
        flashLoanAmount,
        pair.tokenA.mint,
        {
          maxBorrowRateBps: 5000,
        }
      );

      tradeLog.interest = flashLoan.getInterest().toNumber();

      // Execute trades with retry mechanism
      let success = false;
      for (let i = 0; i < this.MAX_RETRIES && !success; i++) {
        try {
          if (jupiterPrice < raydiumPrice) {
            await this.executeJupiterTrade(pair, amount, true);
            await this.executeRaydiumTrade(pair, amount, false);
          } else {
            await this.executeRaydiumTrade(pair, amount, true);
            await this.executeJupiterTrade(pair, amount, false);
          }
          success = true;
        } catch (error) {
          tradeLog.errorMessage = `Trade attempt ${i + 1} failed: ${error.message}`;
          if (i === this.MAX_RETRIES - 1) throw error;
        }
      }

      // Repay flash loan
      await flashLoan.repay();

      tradeLog.successful = true;
      tradeLog.profitLoss = netProfit;
      console.log(`Arbitrage executed successfully! Net profit: ${netProfit} SOL`);

    } catch (error) {
      tradeLog.successful = false;
      tradeLog.errorMessage = error.message;
      console.error('Error executing arbitrage:', error);
    } finally {
      await this.logTrade(tradeLog);
    }
  }

  async checkArbitrageOpportunity() {
    for (const pair of this.TRADING_PAIRS) {
      try {
        const amount = pair.tokenA.minSize;
        
        // Get prices from both DEXs
        const jupiterQuote = await this.getJupiterPrice(
          pair.tokenA.mint,
          pair.tokenB.mint,
          amount,
          pair
        );
        
        if (!jupiterQuote) continue;

        const raydiumQuote = await this.getRaydiumPrice(
          pair.tokenA.mint,
          pair.tokenB.mint,
          amount,
          pair
        );
        
        if (!raydiumQuote) continue;

        // Calculate price difference percentage
        const priceDiff = Math.abs(jupiterQuote.price - raydiumQuote.price) / 
          Math.min(jupiterQuote.price, raydiumQuote.price) * 100;

        if (priceDiff > pair.minProfitPercent) {
          await this.executeArbitrage(
            pair,
            jupiterQuote.price,
            raydiumQuote.price,
            amount
          );
        }
      } catch (error) {
        console.error(`Error checking arbitrage for pair ${pair.tokenA.mint}/${pair.tokenB.mint}:`, error);
      }
    }
  }

  // Add method to get trade history
  public getTradeHistory(): pd.DataFrame {
    return pd.DataFrame(this.tradeHistory);
  }

  // Add method to get trade statistics
  public getTradeStats() {
    const df = this.getTradeHistory();
    return {
      totalTrades: df.shape[0],
      successfulTrades: df[df['successful'] === true].shape[0],
      totalProfit: df['profitLoss'].sum(),
      averageProfit: df[df['successful'] === true]['profitLoss'].mean(),
      totalGasFees: df['gasFee'].sum(),
      totalInterest: df['interest'].sum(),
    };
  }
}

export { ArbitrageBot }; 