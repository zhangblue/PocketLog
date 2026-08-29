//! 软删除超时清理任务。
//!
//! 服务运行期间，这个后台协程定期清理超过撤销窗口的待删除交易。它和 HTTP 请求共享同一
//! 数据库，但独立维护自己的 service / repository 实例，避免把请求上下文泄漏到后台任务。

use crate::{
    application::transactions::TransactionService,
    infrastructure::repositories::SeaOrmLedgerRepository,
};
use sea_orm::DatabaseConnection;
use tokio::sync::watch;

/// 启动有界清理循环：先立即执行一次，之后每分钟执行，并可由服务停止信号中断。
// 清理失败只记录脱敏错误码，不终止服务；下一轮仍会重试，避免短暂数据库故障扩大为服务退出。
pub fn spawn_cleanup(
    db: DatabaseConnection,
    mut stop: watch::Receiver<bool>,
) -> tokio::task::JoinHandle<()> {
    // 返回 JoinHandle 由命令层在所有退出分支 await；不能 fire-and-forget，否则进程关闭时
    // 可能与仍在进行的删除事务竞争。每轮新建 service/repository，避免跨轮保存事务状态。
    tokio::spawn(async move {
        let cleanup = || async {
            // 清理逻辑复用正式应用服务，保证撤销窗口过期后的行为与手动删除/恢复使用同一套
            // 仓储事务边界和错误码，而不是额外维护一份“后台专用 SQL”。
            TransactionService::new(SeaOrmLedgerRepository::new(db.clone()))
                .cleanup()
                .await
        };
        if let Err(error) = cleanup().await {
            tracing::warn!(code = error.code(), "cleanup failed");
        }
        // 以 select 同时等待停止通知和定时器。watch 能合并多个停止信号，接收端断开也视为
        // 应退出，避免没有发送者时清理协程永久存活。
        loop {
            tokio::select! {
                changed = stop.changed() => { if changed.is_err() || *stop.borrow() { break; } }
                _ = tokio::time::sleep(std::time::Duration::from_secs(60)) => {
                    // 固定一分钟轮询，足以覆盖 5 秒撤销窗口后的批量清理，又避免高频空转占用连接。
                    if let Err(error) = cleanup().await { tracing::warn!(code = error.code(), "cleanup failed"); }
                }
            }
        }
    })
}
