//! 共享自定义 Emoji 图标库迁移。
use sea_orm::ConnectionTrait;
use sea_orm_migration::prelude::*;

pub struct Migration;
impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20260831_000002_create_custom_icons"
    }
}
#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.get_connection().execute_unprepared(r#"
            CREATE TABLE custom_icons (
                id UUID PRIMARY KEY,
                emoji TEXT NOT NULL CONSTRAINT custom_icons_emoji_key UNIQUE,
                created_at TIMESTAMPTZ NOT NULL,
                CONSTRAINT custom_icons_emoji_length_check CHECK (char_length(btrim(emoji)) BETWEEN 1 AND 16)
            )
        "#).await.map(|_| ())
    }
    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .get_connection()
            .execute_unprepared("DROP TABLE custom_icons")
            .await
            .map(|_| ())
    }
}
