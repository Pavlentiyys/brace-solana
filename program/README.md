> Часть 4. Реализационное дополнение к «ТЗ: ончейн-программа» (архитектура и модель угроз — там).
> Здесь — структуры, сигнатуры, инварианты и скелет кода. Anchor 0.31.
> Название не закреплено, в коде используется `guard`.

# ТЗ: Rust-программа, уровень реализации

---

## 1. Ключевое изменение против первой редакции

На Kamino ликвидации разрешительные: любой участник может погасить долг чужой позиции и получить залог со скидкой. Это сильный признак того, что **погашение долга за третье лицо не требует подписи владельца обязательства**.

Если так, v1 строится вокруг единственного действия `REPAY`, и **миграция позиции пользователю не нужна** — позиция остаётся там, где есть. Барьер входа падает почти до нуля.

Действие `TOP_UP` (внести залог) почти наверняка требует подписи владельца, поэтому переносится в v2 вместе с моделью обёрнутого обязательства.

**Это допущение проверяется первым, до написания кода.** Способ проверки — в разделе 9. Если оно неверно, v1 меняет форму целиком.

---

## 2. Раскладка модулей

```
programs/guard/src/
  lib.rs              точка входа, объявление инструкций
  state.rs            GuardConfig, битовые маски, константы
  errors.rs           GuardError
  events.rs           события
  math.rs             расчёт LTV и требуемой суммы, только чистые функции
  adapter/
    mod.rs            трейт MarketAdapter, PositionState
    kamino.rs         реализация под Kamino
  instructions/
    init_guard.rs
    deposit_reserve.rs
    withdraw_reserve.rs
    update_policy.rs
    revoke.rs
    execute_action.rs
```

`math.rs` не имеет зависимостей от Anchor — это позволяет тестировать его обычными юнит-тестами и прогонять общий с офчейн-частью набор векторов.

`adapter/` изолирует всё специфичное для кредитного протокола. Смена или добавление протокола не трогает логику ограничений.

---

## 3. Константы и маски

```rust
pub const BPS: u64 = 10_000;

pub const MIN_COOLDOWN_SECONDS: u32 = 30;
pub const MAX_DELEGATION_SECONDS: i64 = 90 * 24 * 60 * 60;
pub const MAX_OBLIGATION_STALENESS_SLOTS: u64 = 2;

pub const ACTION_REPAY: u8 = 1 << 0;
pub const ACTION_TOP_UP: u8 = 1 << 1;

pub const SEED_GUARD: &[u8] = b"guard";
pub const SEED_VAULT: &[u8] = b"vault";

pub const KLEND_PROGRAM_ID: Pubkey = pubkey!("TODO");
```

`KLEND_PROGRAM_ID` — константа, а не аккаунт из входа. Принимать адрес целевой программы параметром означает позволить агенту подсунуть свою.

`MAX_DELEGATION_SECONDS` в 90 дней заставляет пользователя периодически подтверждать делегирование осознанно.

---

## 4. Состояние

```rust
#[account]
#[derive(InitSpace)]
pub struct GuardConfig {
    pub owner: Pubkey,
    pub agent: Pubkey,
    pub obligation: Pubkey,
    pub lending_market: Pubkey,
    pub debt_reserve: Pubkey,
    pub vault: Pubkey,
    pub vault_mint: Pubkey,

    pub trigger_ltv_bps: u16,
    pub target_ltv_bps: u16,
    pub max_action_amount: u64,
    pub max_actions_per_window: u8,
    pub window_seconds: u32,
    pub cooldown_seconds: u32,
    pub allowed_actions: u8,

    pub expires_at: i64,
    pub paused: bool,

    pub last_action_at: i64,
    pub window_started_at: i64,
    pub actions_in_window: u8,
    pub total_actions: u32,
    pub total_repaid: u64,

    pub bump: u8,
    pub vault_bump: u8,
}
```

PDA: `[SEED_GUARD, owner, obligation]` и `[SEED_VAULT, guard_config]`.

Порог задан через LTV в базисных пунктах, а не через health factor: LTV растёт при ухудшении позиции, поэтому все сравнения однонаправленные, а граничные тесты однозначны.

---

## 5. Ошибки

```rust
#[error_code]
pub enum GuardError {
    #[msg("Agent key does not match guard config")]
    UnauthorizedAgent,
    #[msg("Guard is paused")]
    GuardPaused,
    #[msg("Delegation expired")]
    GuardExpired,
    #[msg("Cooldown has not elapsed")]
    CooldownActive,
    #[msg("Action limit for the current window is exhausted")]
    RateLimitExceeded,
    #[msg("Action kind is not permitted by policy")]
    ActionNotAllowed,
    #[msg("Amount exceeds per-action limit or vault balance")]
    AmountExceedsLimit,
    #[msg("Obligation state was not refreshed in the current slot")]
    StaleObligation,
    #[msg("Oracle price is stale or confidence is too wide")]
    StaleOracle,
    #[msg("Current LTV is below the configured trigger")]
    TriggerNotMet,
    #[msg("Action would not improve position health")]
    ActionWouldNotImprove,
    #[msg("Amount overshoots the configured target LTV")]
    Overcorrection,
    #[msg("Policy parameters are inconsistent")]
    InvalidPolicy,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Unexpected lending program")]
    UnexpectedProgram,
}
```

---

## 6. Адаптер рынка

```rust
pub struct PositionState {
    pub collateral_value: u128,
    pub debt_value: u128,
    pub last_update_slot: u64,
}

pub trait MarketAdapter {
    fn read_position(obligation: &AccountInfo) -> Result<PositionState>;
    fn liquidation_ltv_bps(reserve: &AccountInfo) -> Result<u16>;
    fn repay_cpi<'info>(ctx: RepayCtx<'info>, amount: u64, signer: &[&[&[u8]]]) -> Result<()>;
}
```

`collateral_value` и `debt_value` берутся из уже обновлённого состояния обязательства в том же представлении, что использует сам протокол. **Собственный расчёт по спотовым ценам недопустим:** расхождение с протоколом означает срабатывание не в тот момент.

`read_position` обязана проверить владельца аккаунта и дискриминатор, а не доверять типу.

---

## 7. Математика

```rust
pub fn ltv_bps(collateral: u128, debt: u128) -> Result<u16> {
    if collateral == 0 {
        return Ok(u16::MAX.min(BPS as u16));
    }
    let v = debt
        .checked_mul(BPS as u128).ok_or(GuardError::MathOverflow)?
        .checked_div(collateral).ok_or(GuardError::MathOverflow)?;
    Ok(v.min(BPS as u128) as u16)
}

/// Сколько долга погасить, чтобы LTV стал равен target.
/// debt' = debt - x, collateral не меняется при погашении из резерва.
/// (debt - x) / collateral = target  =>  x = debt - target * collateral
pub fn repay_amount_for_target(
    collateral: u128,
    debt: u128,
    target_bps: u16,
) -> Result<u128> {
    let want_debt = collateral
        .checked_mul(target_bps as u128).ok_or(GuardError::MathOverflow)?
        .checked_div(BPS as u128).ok_or(GuardError::MathOverflow)?;
    Ok(debt.saturating_sub(want_debt))
}
```

Погашение из резерва не трогает залог, поэтому формула простая. При `TOP_UP` в v2 меняется знаменатель, и функция будет другой.

Весь модуль — чистые функции без Anchor. Набор тестовых векторов из этого модуля обязателен к прохождению офчейн-наблюдателем, вебом и ботом: формула живёт в четырёх реализациях, расхождение в третьем знаке даёт ложные тревоги у пользователя.

---

## 8. `execute_action`

```rust
#[derive(Accounts)]
pub struct ExecuteAction<'info> {
    #[account(
        mut,
        seeds = [SEED_GUARD, guard.owner.as_ref(), guard.obligation.as_ref()],
        bump = guard.bump,
        has_one = obligation,
        has_one = vault,
    )]
    pub guard: Account<'info, GuardConfig>,

    #[account(
        mut,
        seeds = [SEED_VAULT, guard.key().as_ref()],
        bump = guard.vault_bump,
        constraint = vault.mint == guard.vault_mint @ GuardError::InvalidPolicy,
    )]
    pub vault: Account<'info, TokenAccount>,

    pub agent: Signer<'info>,

    /// CHECK: валидируется адаптером
    #[account(mut)]
    pub obligation: UncheckedAccount<'info>,

    /// CHECK: валидируется адаптером
    #[account(mut)]
    pub debt_reserve: UncheckedAccount<'info>,

    /// CHECK: валидируется адаптером
    pub lending_market: UncheckedAccount<'info>,

    #[account(mut)]
    pub reserve_liquidity_supply: Account<'info, TokenAccount>,

    #[account(address = KLEND_PROGRAM_ID @ GuardError::UnexpectedProgram)]
    /// CHECK: адрес зафиксирован константой
    pub lending_program: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
}
```

Порядок проверок в теле — строго до любого изменения состояния:

```rust
pub fn handler(ctx: Context<ExecuteAction>, action_kind: u8, amount: u64) -> Result<()> {
    let clock = Clock::get()?;
    let guard = &mut ctx.accounts.guard;

    require_keys_eq!(ctx.accounts.agent.key(), guard.agent, GuardError::UnauthorizedAgent);
    require!(!guard.paused, GuardError::GuardPaused);
    require!(clock.unix_timestamp < guard.expires_at, GuardError::GuardExpired);
    require!(
        clock.unix_timestamp - guard.last_action_at >= guard.cooldown_seconds as i64,
        GuardError::CooldownActive
    );

    roll_window(guard, clock.unix_timestamp);
    require!(
        guard.actions_in_window < guard.max_actions_per_window,
        GuardError::RateLimitExceeded
    );

    require!(action_kind & guard.allowed_actions != 0, GuardError::ActionNotAllowed);
    require!(action_kind == ACTION_REPAY, GuardError::ActionNotAllowed); // v1

    require!(
        amount > 0 && amount <= guard.max_action_amount && amount <= ctx.accounts.vault.amount,
        GuardError::AmountExceedsLimit
    );

    let pos = Kamino::read_position(&ctx.accounts.obligation)?;
    require!(
        clock.slot.saturating_sub(pos.last_update_slot) <= MAX_OBLIGATION_STALENESS_SLOTS,
        GuardError::StaleObligation
    );

    let ltv_before = ltv_bps(pos.collateral_value, pos.debt_value)?;
    require!(ltv_before >= guard.trigger_ltv_bps, GuardError::TriggerNotMet);

    let needed = repay_amount_for_target(pos.collateral_value, pos.debt_value, guard.target_ltv_bps)?;
    require!((amount as u128) <= needed, GuardError::Overcorrection);

    let debt_after = pos.debt_value.saturating_sub(amount as u128);
    let ltv_after = ltv_bps(pos.collateral_value, debt_after)?;
    require!(ltv_after < ltv_before, GuardError::ActionWouldNotImprove);

    let guard_key = guard.key();
    let seeds: &[&[u8]] = &[SEED_VAULT, guard_key.as_ref(), &[guard.vault_bump]];
    Kamino::repay_cpi(RepayCtx::from(&ctx), amount, &[seeds])?;

    guard.last_action_at = clock.unix_timestamp;
    guard.actions_in_window += 1;
    guard.total_actions += 1;
    guard.total_repaid = guard.total_repaid.saturating_add(amount);

    emit!(ActionExecuted { /* … */ });
    Ok(())
}
```

Три проверки несут основную нагрузку. **Свежесть состояния** закрывает работу по устаревшим данным. **Порог** делает бессмысленным произвольный вызов и, как следствие, закрывает атаку через отложенное исполнение: заранее подписанная транзакция с durable nonce не пройдёт, если в момент реального исполнения условие не выполняется — именно этот вектор дал захват полномочий в инциденте Drift на $285 млн в апреле 2026. **Постусловие** не даёт сделать хуже.

Единственный `Signer` здесь — агент, и он не является получателем средств ни в одном пути исполнения.

---

## 9. Что проверить до кода

**Разрешительное ли погашение.** Способ: взять на devnet чужое обязательство и попытаться погасить часть долга подписью, не являющейся владельцем. Если проходит — v1 в текущем виде. Если нет — нужна модель обёрнутого обязательства и две дополнительные инструкции.

**Бюджет вычислений.** Цикл включает обновление резервов, обновление обязательства, нашу валидацию и CPI. Измерить на форке mainnet. При нехватке: запрос увеличенного лимита, затем разбивка на две транзакции внутри одного Jito-бандла.

**Формат состояния обязательства.** Определяет `adapter/kamino.rs`: где лежат стоимости, в каком масштабе, где номер слота обновления.

**Учитывает ли протокол borrow factor** при расчёте LTV. Если да, наша формула обязана его повторять, иначе пороги разъедутся.

---

## 10. Тесты

**Юнит (`math.rs`):** нулевой залог, нулевой долг, максимальные значения, точность на границе, совпадение с эталонными векторами.

**LiteSVM, негативные — по одному на каждую ошибку:**

`agent_mismatch_rejected`, `paused_rejected`, `expired_rejected`, `cooldown_rejected`, `window_limit_rejected`, `disallowed_action_rejected`, `amount_over_limit_rejected`, `amount_over_vault_rejected`, `stale_obligation_rejected`, `ltv_below_trigger_rejected`, `overcorrection_rejected`, `no_improvement_rejected`, `foreign_lending_program_rejected`, `durable_nonce_replay_rejected`, `withdraw_works_when_revoked`, `withdraw_works_when_expired`, `withdraw_works_when_paused`.

Последние три доказывают, что выход пользователя не блокируется ничем, — это ключевая гарантия продукта, и она должна быть покрыта тестом явно.

**Фаззинг:** случайные пары `(collateral, debt)` — проверка, что `execute_action` никогда не увеличивает LTV и никогда не переводит средства мимо `reserve_liquidity_supply`.

**Интеграция:** локальный валидатор с клонированными аккаунтами mainnet, воспроизведение исторического падения цены, полный цикл.

---

## 11. Зависимости

```toml
[dependencies]
anchor-lang = { version = "0.31", features = ["init-if-needed"] }
anchor-spl = "0.31"

[dev-dependencies]
litesvm = "0.6"
proptest = "1"
```

Внешние SDK кредитного протокола в зависимости программы не тянуть — только необходимые константы и разбор структур в `adapter/kamino.rs`. Иначе обновление их SDK ломает сборку программы.

**Аудит обязателен до приёма реальных средств.** Закладывать в бюджет и сроки сразу.