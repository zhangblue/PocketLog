//! 初始账本 schema 迁移。
//!
//! 该迁移一次性建立单用户记账所需的全部基础表、约束和索引。设计上把关键业务不变量
//! 下沉到 PostgreSQL 约束中，保证即使未来有脚本直接写库，也不会破坏交易形状、标签
//! 生命周期和幂等记录的一致性。

use sea_orm::ConnectionTrait;
use sea_orm_migration::prelude::*;

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        // 迁移名既用于 SeaORM 记录，也用于运行时 schema 基线比对；修改会破坏已发布版本。
        "m20260826_000001_create_ledger"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // 本迁移使用单段 SQL 创建相互关联的表、索引和约束。外层 `run_migrations` 已持有
        // PostgreSQL 事务级 advisory lock；这里不得自行开启独立事务，否则会破坏原子性。
        // 初始 schema 将业务不变量下沉到数据库约束，阻止绕过应用层的非法账本数据。
        manager
            .get_connection()
            .execute_unprepared(
                r#"
                CREATE TABLE categories (
                    id UUID PRIMARY KEY,
                    name TEXT NOT NULL,
                    normalized_name TEXT NOT NULL CONSTRAINT categories_normalized_name_key UNIQUE,
                    kind TEXT NOT NULL CONSTRAINT categories_kind_check CHECK (kind IN ('expense', 'income')),
                    emoji TEXT NOT NULL,
                    color TEXT NOT NULL,
                    semantic_key TEXT NULL CONSTRAINT categories_semantic_key_key UNIQUE,
                    sort_order INTEGER NOT NULL,
                    active BOOLEAN NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL,
                    updated_at TIMESTAMPTZ NOT NULL,
                    CONSTRAINT categories_id_kind_key UNIQUE (id, kind),
                    CONSTRAINT categories_sort_order_key UNIQUE (sort_order) DEFERRABLE INITIALLY IMMEDIATE,
                    CONSTRAINT categories_name_length_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 40),
                    CONSTRAINT categories_normalized_name_length_check CHECK (char_length(normalized_name) BETWEEN 1 AND 40),
                    CONSTRAINT categories_emoji_length_check CHECK (char_length(emoji) BETWEEN 1 AND 16),
                    CONSTRAINT categories_color_check CHECK (color ~ '^#[0-9A-Fa-f]{6}$')
                );

                CREATE TABLE account_labels (
                    id UUID PRIMARY KEY,
                    name TEXT NOT NULL,
                    normalized_name TEXT NOT NULL CONSTRAINT account_labels_normalized_name_key UNIQUE,
                    active BOOLEAN NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL,
                    updated_at TIMESTAMPTZ NOT NULL,
                    CONSTRAINT account_labels_name_length_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 40),
                    CONSTRAINT account_labels_normalized_name_length_check CHECK (char_length(normalized_name) BETWEEN 1 AND 40)
                );

                CREATE TABLE transactions (
                    id UUID PRIMARY KEY,
                    kind TEXT NOT NULL CONSTRAINT transactions_kind_check CHECK (kind IN ('expense', 'income', 'transfer')),
                    amount NUMERIC(18,2) NOT NULL CONSTRAINT transactions_amount_check CHECK (amount > 0),
                    category_id UUID NULL,
                    account_id UUID NOT NULL,
                    target_account_id UUID NULL,
                    merchant TEXT NOT NULL,
                    note TEXT NOT NULL,
                    occurred_at TIMESTAMPTZ NOT NULL,
                    local_date DATE NOT NULL,
                    local_time TIME NOT NULL,
                    utc_offset_minutes SMALLINT NOT NULL,
                    pending_delete_until TIMESTAMPTZ NULL,
                    deletion_token UUID NULL,
                    created_at TIMESTAMPTZ NOT NULL,
                    updated_at TIMESTAMPTZ NOT NULL,
                    CONSTRAINT transactions_category_kind_fkey
                        FOREIGN KEY (category_id, kind) REFERENCES categories (id, kind) ON DELETE RESTRICT,
                    CONSTRAINT transactions_account_id_fkey
                        FOREIGN KEY (account_id) REFERENCES account_labels (id) ON DELETE RESTRICT,
                    CONSTRAINT transactions_target_account_id_fkey
                        FOREIGN KEY (target_account_id) REFERENCES account_labels (id) ON DELETE RESTRICT,
                    CONSTRAINT transactions_shape_check CHECK (
                        -- 收入/支出必须有分类且不能有目标账户；转账反之且两账户不同。此检查
                        -- 即使维护脚本绕过 Rust 应用层写库，也能保留交易的基本业务形状。
                        (kind IN ('expense', 'income') AND category_id IS NOT NULL AND target_account_id IS NULL)
                        OR
                        (kind = 'transfer' AND category_id IS NULL AND target_account_id IS NOT NULL
                            AND account_id <> target_account_id)
                    ),
                    CONSTRAINT transactions_offset_check CHECK (utc_offset_minutes BETWEEN -840 AND 840),
                    CONSTRAINT transactions_deletion_pair_check CHECK (
                        (pending_delete_until IS NULL) = (deletion_token IS NULL)
                    ),
                    CONSTRAINT transactions_merchant_length_check CHECK (
                        char_length(btrim(merchant)) BETWEEN 1 AND 120
                    ),
                    CONSTRAINT transactions_note_length_check CHECK (char_length(note) <= 1000)
                );

                CREATE INDEX idx_transactions_local_date_occurred_at
                    ON transactions (local_date, occurred_at DESC);
                CREATE INDEX idx_transactions_kind_local_date
                    ON transactions (kind, local_date);
                CREATE INDEX idx_transactions_category_local_date
                    ON transactions (category_id, local_date);
                CREATE INDEX idx_transactions_account_local_date
                    ON transactions (account_id, local_date);
                CREATE INDEX idx_transactions_target_account_local_date
                    ON transactions (target_account_id, local_date);
                CREATE INDEX idx_transactions_pending_delete
                    ON transactions (pending_delete_until)
                    WHERE pending_delete_until IS NOT NULL;

                CREATE TABLE app_state (
                    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE,
                    seed_version INTEGER NOT NULL,
                    data_revision BIGINT NOT NULL,
                    CONSTRAINT app_state_singleton_check CHECK (singleton),
                    CONSTRAINT app_state_seed_version_check CHECK (seed_version >= 0),
                    CONSTRAINT app_state_data_revision_check CHECK (data_revision >= 0)
                );

                INSERT INTO app_state (singleton, seed_version, data_revision)
                VALUES (TRUE, 0, 0);

                CREATE TABLE idempotency_requests (
                    idempotency_key TEXT PRIMARY KEY,
                    request_fingerprint TEXT NOT NULL,
                    status TEXT NOT NULL CONSTRAINT idempotency_requests_status_check
                        CHECK (status IN ('pending', 'completed')),
                    response JSONB NULL,
                    created_at TIMESTAMPTZ NOT NULL,
                    completed_at TIMESTAMPTZ NULL,
                    expires_at TIMESTAMPTZ NOT NULL,
                    CONSTRAINT idempotency_requests_completion_check CHECK (
                        -- 进行中的请求不能暴露响应；完成请求必须同时保存响应和完成时间，防止
                        -- 重试读取到一半的幂等记录。
                        (status = 'pending' AND response IS NULL AND completed_at IS NULL)
                        OR (status = 'completed' AND response IS NOT NULL AND completed_at IS NOT NULL)
                    ),
                    CONSTRAINT idempotency_requests_expiry_check CHECK (expires_at > created_at)
                );

                CREATE INDEX idx_idempotency_requests_expires_at
                    ON idempotency_requests (expires_at);
                "#,
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // 回滚按依赖的反方向删除表，供测试或显式迁移流程安全撤销整套 schema。
        manager
            .get_connection()
            .execute_unprepared(
                r#"
                DROP TABLE IF EXISTS idempotency_requests;
                DROP TABLE IF EXISTS app_state;
                DROP TABLE IF EXISTS transactions;
                DROP TABLE IF EXISTS account_labels;
                DROP TABLE IF EXISTS categories;
                "#,
            )
            .await?;
        Ok(())
    }
}
