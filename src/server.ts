import express from 'express';
import { ArbitrageBot } from './arbitrage-bot';
import { Response } from 'express';
import path from 'path';

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

app.get('/trades', (req, res) => {
  const tradeHistory = bot.getTradeHistory();
  res.json(tradeHistory.to_json({ orient: 'records' }));
});

app.get('/trade-stats', (req, res) => {
  const stats = bot.getTradeStats();
  res.json(stats);
});

// Add new endpoint for CSV export
app.get('/export-trades', (req, res: Response) => {
  try {
    const tradeHistory = bot.getTradeHistory();
    
    // Set headers for CSV download
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=trade_history.csv');
    
    // Convert DataFrame to CSV and send
    tradeHistory.to_csv(res, {
      index: false,
      header: true
    });
    
  } catch (error) {
    console.error('Error exporting trades:', error);
    res.status(500).json({ error: 'Failed to export trades' });
  }
});

// Optional: Add endpoint to get trades within a date range
app.get('/export-trades/:startDate/:endDate', (req, res: Response) => {
  try {
    const { startDate, endDate } = req.params;
    const tradeHistory = bot.getTradeHistory();
    
    // Filter trades by date range
    const filteredTrades = tradeHistory[
      (tradeHistory['timestamp'] >= startDate) & 
      (tradeHistory['timestamp'] <= endDate)
    ];
    
    // Set headers for CSV download
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=trade_history.csv');
    
    // Convert filtered DataFrame to CSV and send
    filteredTrades.to_csv(res, {
      index: false,
      header: true
    });
    
  } catch (error) {
    console.error('Error exporting trades:', error);
    res.status(500).json({ error: 'Failed to export trades' });
  }
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