import express from 'express';
import { ArbitrageBot } from './arbitrage-bot';

const app = express();
const PORT = process.env.PORT || 3000;

// Add basic monitoring
let lastCheckTime: number = 0;
let totalChecks: number = 0;
let successfulTrades: number = 0;
let failedTrades: number = 0;

app.get('/health', (req, res) => {
  const now = Date.now();
  const botStatus = lastCheckTime > 0 && (now - lastCheckTime) < 15 * 60 * 1000 // 15 minutes
    ? 'healthy'
    : 'unhealthy';

  res.json({
    status: botStatus,
    metrics: {
      lastCheckTime: new Date(lastCheckTime).toISOString(),
      totalChecks,
      successfulTrades,
      failedTrades,
      uptime: process.uptime(),
    }
  });
});

// Start the arbitrage bot
async function startBot() {
  const bot = new ArbitrageBot();
  
  try {
    await bot.initialize();
    
    // Check for arbitrage opportunities every minute
    setInterval(async () => {
      try {
        lastCheckTime = Date.now();
        totalChecks++;
        await bot.checkArbitrageOpportunity();
        successfulTrades++;
      } catch (error) {
        failedTrades++;
        console.error('Error in arbitrage check:', error);
      }
    }, 60 * 1000); // Every minute
    
  } catch (error) {
    console.error('Failed to start arbitrage bot:', error);
    process.exit(1);
  }
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  startBot().catch(console.error);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('Received SIGTERM. Performing graceful shutdown...');
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  process.exit(1);
}); 