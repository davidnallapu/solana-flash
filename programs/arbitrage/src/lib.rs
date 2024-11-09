use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer, Mint};
use mango::state::{MangoGroup, MangoAccount, FlashLoan};

declare_id!("Your_Program_ID");

pub const JUPITER_PROGRAM_ID: &str = "JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB";
pub const RAYDIUM_AMM_PROGRAM_ID: &str = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8";
pub const RAYDIUM_V3_PROGRAM_ID: &str = "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK";
pub const MANGO_V4_PROGRAM_ID: &str = "4MangoMjqJ2firMokCjjGgoK8d4MXcrgL7XJaL3w6fVg";
pub const MANGO_V4_GROUP_ID: &str = "78b8f4cGCwmZ9ysPFMWLaLTkkaYnUjwMJYStWe5RTSSX"; // Mainnet group

pub const USDC_MINT: &str = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
pub const SOL_MINT: &str = "So11111111111111111111111111111111111111112";

#[derive(Clone, Copy)]
pub struct TradingPair {
    pub token_a: Pubkey,
    pub token_b: Pubkey,
    pub min_profit_threshold: u64,
}

pub const SUPPORTED_PAIRS: &[TradingPair] = &[
    TradingPair {
        token_a: USDC_MINT.parse::<Pubkey>().unwrap(),
        token_b: SOL_MINT.parse::<Pubkey>().unwrap(),
        min_profit_threshold: 1_000_000, // 1 USDC minimum profit
    },
    // Add more pairs as needed
];

#[program]
pub mod arbitrage {
    use super::*;

    pub fn execute_arbitrage(
        ctx: Context<ExecuteArbitrage>,
        amount: u64,
        min_profit: u64,
    ) -> Result<()> {
        // Validate trading pair is supported
        let trading_pair = TradingPair {
            token_a: USDC_MINT.parse::<Pubkey>().unwrap(),
            token_b: SOL_MINT.parse::<Pubkey>().unwrap(),
            min_profit_threshold: 1_000_000, // 1 USDC minimum profit
        };

        // 1. Borrow flash loan from Mango
        let flash_loan = FlashLoan {
            amount,
            mango_group: ctx.accounts.mango_group.to_account_info(),
            mango_account: ctx.accounts.mango_account.to_account_info(),
            token_account: ctx.accounts.token_account.to_account_info(),
        };

        flash_loan.borrow()?;

        // 2. Determine the optimal order of DEXs for the swaps
        let (first_dex, second_dex) = determine_dex_order(
            &ctx.accounts.first_dex_program,
            &ctx.accounts.second_dex_program,
            amount,
            &ctx.accounts.token_account,
            &ctx.accounts.swap_token_account,
        )?;

        // 3. Execute swap on the chosen first DEX
        let first_swap_amount = execute_swap(
            first_dex,
            amount,
            &ctx.accounts.token_account,
            &ctx.accounts.swap_token_account,
        )?;

        // 4. Execute reverse swap on the second DEX
        let second_swap_amount = execute_swap(
            second_dex,
            first_swap_amount,
            &ctx.accounts.swap_token_account,
            &ctx.accounts.token_account,
        )?;

        // 5. Calculate total repayment required (principal + interest)
        let interest = calculate_flash_loan_interest(amount);
        let total_repayment = amount + interest;

        // 6. Check if the arbitrage resulted in profit
        let profit = second_swap_amount.saturating_sub(total_repayment);
        require!(profit >= min_profit, ArbitrageError::NoProfit);

        // 7. Repay flash loan
        flash_loan.repay(total_repayment)?;

        // 8. Transfer profit to owner
        let profit_transfer_cpi_accounts = Transfer {
            from: ctx.accounts.token_account.to_account_info(),
            to: ctx.accounts.owner_account.to_account_info(),
            authority: ctx.accounts.mango_account.to_account_info(),
        };
        token::transfer(
            CpiContext::new(ctx.accounts.token_program.to_account_info(), profit_transfer_cpi_accounts),
            profit,
        )?;

        emit!(ArbitrageExecuted {
            profit,
            amount,
        });

        Ok(())
    }
}

// Helper function to determine the best DEX order for the swaps
fn determine_dex_order<'info>(
    dex1_program: &Program<'info, DexProgram>,
    dex2_program: &Program<'info, DexProgram>,
    amount: u64,
    from_token_account: &Account<'info, TokenAccount>,
    to_token_account: &Account<'info, TokenAccount>,
) -> Result<(&Program<'info, DexProgram>, &Program<'info, DexProgram>)> {
    // Query both DEXs for the rate
    let dex1_rate = get_swap_rate(dex1_program, amount, from_token_account, to_token_account)?;
    let dex2_rate = get_swap_rate(dex2_program, amount, from_token_account, to_token_account)?;

    // Determine which DEX gives a better initial rate
    if dex1_rate > dex2_rate {
        Ok((dex1_program, dex2_program))
    } else {
        Ok((dex2_program, dex1_program))
    }
}

// Helper function to simulate or query swap rates from a DEX
fn get_swap_rate<'info>(
    dex_program: &Program<'info, DexProgram>,
    amount_in: u64,
    from_token_account: &Account<'info, TokenAccount>,
    to_token_account: &Account<'info, TokenAccount>,
) -> Result<u64> {
    // Placeholder to simulate or fetch the rate; replace with actual API call or on-chain logic
    // Assuming 1% slippage for demonstration
    Ok(amount_in * 99 / 100) // Return 99% of input as an example
}

// Helper function to execute swaps on the selected DEX
fn execute_swap<'info>(
    dex_program: &Program<'info, DexProgram>,
    amount_in: u64,
    from_token_account: &Account<'info, TokenAccount>,
    to_token_account: &Account<'info, TokenAccount>,
) -> Result<u64> {
    // Placeholder for DEX swap logic; perform swap via program or API call
    let amount_out = amount_in * 98 / 100;  // Example 2% slippage
    Ok(amount_out)
}

#[derive(Accounts)]
pub struct ExecuteArbitrage<'info> {
    #[account(address = MANGO_V4_PROGRAM_ID.parse::<Pubkey>().unwrap())]
    pub mango_program: AccountInfo<'info>,
    #[account(mut, address = MANGO_V4_GROUP_ID.parse::<Pubkey>().unwrap())]
    pub mango_group: AccountInfo<'info>,
    #[account(mut)]
    pub mango_account: AccountInfo<'info>,
    #[account(mut)]
    pub token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub swap_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub owner_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub first_dex_program: Program<'info, DexProgram>,
    pub second_dex_program: Program<'info, DexProgram>,
    #[account(address = JUPITER_PROGRAM_ID.parse::<Pubkey>().unwrap())]
    pub jupiter_program: AccountInfo<'info>,
    #[account(address = RAYDIUM_V3_PROGRAM_ID.parse::<Pubkey>().unwrap())]
    pub raydium_program: AccountInfo<'info>,
    #[account(mut)]
    pub token_a_mint: Account<'info, Mint>,
    #[account(mut)]
    pub token_b_mint: Account<'info, Mint>,
}

#[event]
pub struct ArbitrageExecuted {
    pub profit: u64,
    pub amount: u64,
}

#[error_code]
pub enum ArbitrageError {
    #[msg("No profitable arbitrage opportunity found")]
    NoProfit,
}

// Add this function to check prices across DEXs
pub fn check_arbitrage_opportunity(
    pair: &TradingPair,
    amount: u64,
    jupiter_price: u64,
    raydium_price: u64,
) -> Option<(u64, bool)> {  // Returns (profit, use_jupiter_first)
    let jupiter_forward = calculate_swap_outcome(amount, jupiter_price);
    let raydium_back = calculate_swap_outcome(jupiter_forward, raydium_price);
    let profit_path1 = raydium_back.saturating_sub(amount);

    let raydium_forward = calculate_swap_outcome(amount, raydium_price);
    let jupiter_back = calculate_swap_outcome(raydium_forward, jupiter_price);
    let profit_path2 = jupiter_back.saturating_sub(amount);

    if profit_path1 > profit_path2 && profit_path1 > pair.min_profit_threshold {
        Some((profit_path1, true))
    } else if profit_path2 > pair.min_profit_threshold {
        Some((profit_path2, false))
    } else {
        None
    }
}

fn calculate_swap_outcome(amount: u64, price: u64) -> u64 {
    // Implement your price calculation logic here
    // This is a simplified example
    amount.saturating_mul(price).saturating_div(10_000) // Assuming price is in basis points
}
