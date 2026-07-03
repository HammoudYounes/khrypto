use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

// Placeholder — replaced by the real program id after `anchor keys sync`
declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

pub const ESCROW_SEED: &[u8] = b"escrow";

/// Khrypto match escrow (DEVNET ONLY).
///
/// Lifecycle:
///   initialize_match (oracle) → deposit (each player) → settle (oracle, to winner)
///                                                     → cancel (oracle, refund both — draw/abort)
///                                                     → reclaim (player, after deadline)
///
/// The PDA is derived from (oracle, game_id_hash) so only escrows initialized
/// by the trusted oracle key are recognized by the Khrypto escrow service.
#[program]
pub mod khrypto_escrow {
    use super::*;

    pub fn initialize_match(
        ctx: Context<InitializeMatch>,
        game_id: String,
        game_id_hash: [u8; 32],
        player_a: Pubkey,
        player_b: Pubkey,
        stake_lamports: u64,
        deadline: i64,
    ) -> Result<()> {
        require!(game_id.len() <= 40, EscrowError::GameIdTooLong);
        require!(stake_lamports > 0, EscrowError::InvalidStake);
        require_keys_neq!(player_a, player_b, EscrowError::SamePlayer);

        let escrow = &mut ctx.accounts.escrow;
        escrow.game_id = game_id;
        escrow.game_id_hash = game_id_hash;
        escrow.oracle = ctx.accounts.oracle.key();
        escrow.player_a = player_a;
        escrow.player_b = player_b;
        escrow.stake_lamports = stake_lamports;
        escrow.deadline = deadline;
        escrow.deposited_a = false;
        escrow.deposited_b = false;
        escrow.settled = false;
        escrow.cancelled = false;
        escrow.winner = Pubkey::default();
        escrow.bump = ctx.bumps.escrow;
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>) -> Result<()> {
        let escrow = &ctx.accounts.escrow;
        require!(!escrow.settled && !escrow.cancelled, EscrowError::EscrowClosed);
        require!(
            Clock::get()?.unix_timestamp < escrow.deadline,
            EscrowError::DeadlinePassed
        );

        let player_key = ctx.accounts.player.key();
        let (is_a, already) = if player_key == escrow.player_a {
            (true, escrow.deposited_a)
        } else if player_key == escrow.player_b {
            (false, escrow.deposited_b)
        } else {
            return err!(EscrowError::NotAPlayer);
        };
        require!(!already, EscrowError::AlreadyDeposited);

        let stake = escrow.stake_lamports;
        transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.player.to_account_info(),
                    to: ctx.accounts.escrow.to_account_info(),
                },
            ),
            stake,
        )?;

        let escrow = &mut ctx.accounts.escrow;
        if is_a {
            escrow.deposited_a = true;
        } else {
            escrow.deposited_b = true;
        }
        Ok(())
    }

    /// Oracle releases the full pot (2 × stake) to the match winner.
    pub fn settle(ctx: Context<Settle>) -> Result<()> {
        let escrow = &ctx.accounts.escrow;
        require!(!escrow.settled && !escrow.cancelled, EscrowError::EscrowClosed);
        require!(
            escrow.deposited_a && escrow.deposited_b,
            EscrowError::DepositsIncomplete
        );

        let winner_key = ctx.accounts.winner.key();
        require!(
            winner_key == escrow.player_a || winner_key == escrow.player_b,
            EscrowError::NotAPlayer
        );

        let pot = escrow
            .stake_lamports
            .checked_mul(2)
            .ok_or(EscrowError::Overflow)?;

        let escrow_info = ctx.accounts.escrow.to_account_info();
        **escrow_info.try_borrow_mut_lamports()? -= pot;
        **ctx.accounts.winner.try_borrow_mut_lamports()? += pot;

        let escrow = &mut ctx.accounts.escrow;
        escrow.settled = true;
        escrow.winner = winner_key;
        Ok(())
    }

    /// Oracle refunds both deposits (draw, aborted match, integrity dispute).
    pub fn cancel(ctx: Context<Cancel>) -> Result<()> {
        let escrow = &ctx.accounts.escrow;
        require!(!escrow.settled && !escrow.cancelled, EscrowError::EscrowClosed);

        let stake = escrow.stake_lamports;
        let refund_a = escrow.deposited_a;
        let refund_b = escrow.deposited_b;

        let escrow_info = ctx.accounts.escrow.to_account_info();
        if refund_a {
            **escrow_info.try_borrow_mut_lamports()? -= stake;
            **ctx.accounts.player_a.try_borrow_mut_lamports()? += stake;
        }
        if refund_b {
            **escrow_info.try_borrow_mut_lamports()? -= stake;
            **ctx.accounts.player_b.try_borrow_mut_lamports()? += stake;
        }

        let escrow = &mut ctx.accounts.escrow;
        escrow.cancelled = true;
        escrow.deposited_a = false;
        escrow.deposited_b = false;
        Ok(())
    }

    /// Player self-service refund if the escrow was never resolved by deadline
    /// (protects funds if the oracle goes dark).
    pub fn reclaim(ctx: Context<Reclaim>) -> Result<()> {
        let escrow = &ctx.accounts.escrow;
        require!(!escrow.settled && !escrow.cancelled, EscrowError::EscrowClosed);
        require!(
            Clock::get()?.unix_timestamp >= escrow.deadline,
            EscrowError::DeadlineNotReached
        );

        let player_key = ctx.accounts.player.key();
        let is_a = if player_key == escrow.player_a {
            require!(escrow.deposited_a, EscrowError::NothingToReclaim);
            true
        } else if player_key == escrow.player_b {
            require!(escrow.deposited_b, EscrowError::NothingToReclaim);
            false
        } else {
            return err!(EscrowError::NotAPlayer);
        };

        let stake = escrow.stake_lamports;
        let escrow_info = ctx.accounts.escrow.to_account_info();
        **escrow_info.try_borrow_mut_lamports()? -= stake;
        **ctx.accounts.player.to_account_info().try_borrow_mut_lamports()? += stake;

        let escrow = &mut ctx.accounts.escrow;
        if is_a {
            escrow.deposited_a = false;
        } else {
            escrow.deposited_b = false;
        }
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(game_id: String, game_id_hash: [u8; 32])]
pub struct InitializeMatch<'info> {
    #[account(
        init,
        payer = oracle,
        space = 8 + EscrowAccount::INIT_SPACE,
        seeds = [ESCROW_SEED, oracle.key().as_ref(), game_id_hash.as_ref()],
        bump
    )]
    pub escrow: Account<'info, EscrowAccount>,
    #[account(mut)]
    pub oracle: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(
        mut,
        seeds = [ESCROW_SEED, escrow.oracle.as_ref(), escrow.game_id_hash.as_ref()],
        bump = escrow.bump
    )]
    pub escrow: Account<'info, EscrowAccount>,
    #[account(mut)]
    pub player: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Settle<'info> {
    #[account(
        mut,
        seeds = [ESCROW_SEED, escrow.oracle.as_ref(), escrow.game_id_hash.as_ref()],
        bump = escrow.bump,
        has_one = oracle @ EscrowError::UnauthorizedOracle
    )]
    pub escrow: Account<'info, EscrowAccount>,
    pub oracle: Signer<'info>,
    /// CHECK: validated against escrow.player_a / player_b in the handler
    #[account(mut)]
    pub winner: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Cancel<'info> {
    #[account(
        mut,
        seeds = [ESCROW_SEED, escrow.oracle.as_ref(), escrow.game_id_hash.as_ref()],
        bump = escrow.bump,
        has_one = oracle @ EscrowError::UnauthorizedOracle,
        has_one = player_a @ EscrowError::NotAPlayer,
        has_one = player_b @ EscrowError::NotAPlayer
    )]
    pub escrow: Account<'info, EscrowAccount>,
    pub oracle: Signer<'info>,
    /// CHECK: constrained by has_one = player_a
    #[account(mut)]
    pub player_a: UncheckedAccount<'info>,
    /// CHECK: constrained by has_one = player_b
    #[account(mut)]
    pub player_b: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Reclaim<'info> {
    #[account(
        mut,
        seeds = [ESCROW_SEED, escrow.oracle.as_ref(), escrow.game_id_hash.as_ref()],
        bump = escrow.bump
    )]
    pub escrow: Account<'info, EscrowAccount>,
    #[account(mut)]
    pub player: Signer<'info>,
}

#[account]
#[derive(InitSpace)]
pub struct EscrowAccount {
    pub game_id_hash: [u8; 32],
    #[max_len(40)]
    pub game_id: String,
    pub oracle: Pubkey,
    pub player_a: Pubkey,
    pub player_b: Pubkey,
    pub stake_lamports: u64,
    pub deadline: i64,
    pub deposited_a: bool,
    pub deposited_b: bool,
    pub settled: bool,
    pub cancelled: bool,
    pub winner: Pubkey,
    pub bump: u8,
}

#[error_code]
pub enum EscrowError {
    #[msg("Game id exceeds 40 characters")]
    GameIdTooLong,
    #[msg("Stake must be greater than zero")]
    InvalidStake,
    #[msg("Players must be distinct")]
    SamePlayer,
    #[msg("Escrow already settled or cancelled")]
    EscrowClosed,
    #[msg("Deposit deadline has passed")]
    DeadlinePassed,
    #[msg("Deadline not reached yet")]
    DeadlineNotReached,
    #[msg("Signer is not a player in this escrow")]
    NotAPlayer,
    #[msg("Player already deposited")]
    AlreadyDeposited,
    #[msg("Both players must deposit before settlement")]
    DepositsIncomplete,
    #[msg("Nothing to reclaim")]
    NothingToReclaim,
    #[msg("Signer is not the escrow oracle")]
    UnauthorizedOracle,
    #[msg("Arithmetic overflow")]
    Overflow,
}
