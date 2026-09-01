//! 进程命令边界：显式迁移和服务启动拥有不同的数据库生命周期。
//!
//! 命令层把内部启动失败收敛为不泄露连接细节的错误，同时保留稳定的退出码供部署系统判断。

use thiserror::Error;

use crate::config::Config;
use crate::infrastructure::{
    db::connect,
    schema::{run_migrations, verify_schema},
    seed::{clear_ledger, initialize_predefined_categories, seed_demo_if_needed},
    static_files::ensure_static_assets,
};
use crate::package::{PackageError, package_current_project};

pub const USAGE: &str = "Usage: pocket-log-backend [migrate|init|demo|clean|serve|package]";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Command {
    /// 唯一允许改变数据库 schema 的运维命令；需要显式输入，不能由服务启动隐式触发。
    Migrate,
    /// 只写入缺失的预置分类；按标准化名称幂等，不创建账户、图标或交易。
    Init,
    /// 仅为空账本写入一套演示数据；会先校验迁移已完成，且不会覆盖已有数据。
    Demo,
    /// 清空所有账本业务数据；不会删除表结构或迁移记录，之后需先执行 init 再执行 demo。
    Clean,
    /// 常驻 HTTP 服务命令；启动前仅校验 schema 和准备静态文件，不会写入账本数据。
    Serve,
    /// 本地构建辅助命令；它不依赖运行时配置或 PostgreSQL，输出可直接部署的目录。
    Package,
}

/// 判断命令是否需要数据库与服务运行时配置；打包只处理本机构建产物。
pub fn command_requires_runtime_configuration(command: Command) -> bool {
    !matches!(command, Command::Package)
}

impl Command {
    pub fn parse<I, S>(args: I) -> Result<Self, CommandParseError>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        // 无参数等价于 serve；其余调用只接受一个明确命令，避免部署脚本的拼写错误被
        // 静默忽略。
        let mut args = args.into_iter();
        let Some(command) = args.next() else {
            return Ok(Self::Serve);
        };
        if args.next().is_some() {
            return Err(CommandParseError);
        }

        match command.as_ref() {
            "migrate" => Ok(Self::Migrate),
            "init" => Ok(Self::Init),
            "demo" => Ok(Self::Demo),
            "clean" => Ok(Self::Clean),
            "serve" => Ok(Self::Serve),
            "package" => Ok(Self::Package),
            _ => Err(CommandParseError),
        }
    }
}

#[derive(Debug, Error, PartialEq, Eq)]
#[error("{USAGE}")]
pub struct CommandParseError;

impl CommandParseError {
    pub fn code(&self) -> &'static str {
        "command.invalid"
    }

    pub fn usage(&self) -> &'static str {
        USAGE
    }
}

#[derive(Debug, Error)]
pub enum CommandExecutionError {
    #[error("startup failed")]
    Startup,
    /// 这是用户可执行修复的运维前置条件，明确暴露稳定错误码以提示先运行 `init`。
    #[error("demo.categories_not_initialized: 请先执行 init")]
    DemoCategoriesNotInitialized,
    /// 预置分类存在但被停用时，提示用户恢复分类，而不是把停用分类写入新演示交易。
    #[error("demo.categories_inactive: 请先启用预置分类后重试")]
    DemoCategoriesInactive,
    /// 同名分类类型被用户调整后无法用于演示交易；保持错误稳定且不暴露数据库细节。
    #[error("demo.categories_kind_invalid: 请修正预置分类类型后重试")]
    DemoCategoriesKindInvalid,
    #[error("{0}")]
    Package(#[from] PackageError),
}

pub async fn run(command: Command, config: Config) -> Result<(), CommandExecutionError> {
    match command {
        // schema 变更只能由显式 migrate 完成；serve 仅校验，防止启动时意外改库。
        Command::Migrate => {
            let db = connect(&config)
                .await
                .map_err(|_| CommandExecutionError::Startup)?;
            run_migrations(&db)
                .await
                .map_err(|_| CommandExecutionError::Startup)
        }
        // init 与 demo、clean 一样只能操作完成迁移的 schema；初始化分类本身不创建其它业务数据。
        Command::Init => {
            let db = connect_verified(&config).await?;
            initialize_predefined_categories(&db, &crate::application::clock::SystemClock)
                .await
                .map_err(|_| CommandExecutionError::Startup)
        }
        // demo 与 clean 只操作已迁移的业务表。先验证 schema 可避免在未初始化数据库上
        // 产生难以恢复的半成品数据或把 SQL 错误泄露到命令行。
        Command::Demo => {
            let db = connect_verified(&config).await?;
            seed_demo_if_needed(&db, &crate::application::clock::SystemClock)
                .await
                .map_err(|error| match error.code() {
                    "demo.categories_not_initialized" => {
                        CommandExecutionError::DemoCategoriesNotInitialized
                    }
                    "demo.categories_inactive" => CommandExecutionError::DemoCategoriesInactive,
                    "demo.categories_kind_invalid" => {
                        CommandExecutionError::DemoCategoriesKindInvalid
                    }
                    _ => CommandExecutionError::Startup,
                })
        }
        Command::Clean => {
            let db = connect_verified(&config).await?;
            clear_ledger(&db)
                .await
                .map_err(|_| CommandExecutionError::Startup)
        }
        Command::Serve => serve_connected(config).await,
        // 打包只构建并复制本地产物，既不读取数据库配置也不连接数据库。
        Command::Package => package_current_project()
            .map(|output| println!("release package created at {}", output.display()))
            .map_err(CommandExecutionError::from),
    }
}

pub async fn prepare_serve(
    config: &Config,
) -> Result<sea_orm::DatabaseConnection, CommandExecutionError> {
    // 服务启动顺序先校验 schema、准备静态资源，再绑定端口；任一步失败都
    // 不宣称 ready，后台清理任务也会在绑定失败或服务退出时收到停止信号。
    // 先建立连接，随后在真正监听端口前完成所有确定性的前置条件。调用方只有拿到成功
    // 返回值才应创建路由并暴露服务，因此客户端不会撞上“端口已开但 schema 未就绪”的窗口。
    let db = connect_verified(config).await?;
    ensure_static_assets(&config.frontend_dist_dir).map_err(|_| CommandExecutionError::Startup)?;
    Ok(db)
}

/// 建立连接并只读校验已应用的迁移版本。
///
/// 该函数被 init、demo、clean 和 serve 共用：它们都必须在完整 schema 上运行，但只有各自的
/// 命令分支决定是否写入业务数据。这样 `serve` 不会因“首次使用”而隐式改变数据库。
async fn connect_verified(
    config: &Config,
) -> Result<sea_orm::DatabaseConnection, CommandExecutionError> {
    let db = connect(config)
        .await
        .map_err(|_| CommandExecutionError::Startup)?;
    verify_schema(&db)
        .await
        .map_err(|_| CommandExecutionError::Startup)?;
    Ok(db)
}

async fn serve_connected(config: Config) -> Result<(), CommandExecutionError> {
    let db = prepare_serve(&config).await?;
    // 后台清理任务持有独立的连接句柄，并通过 watch 广播退出意图。无论绑定失败、收到
    // Ctrl-C 还是 Axum 自身返回错误，下面都发送停止信号并 await，避免任务遗留到运行时结束。
    let (stop_tx, stop_rx) = tokio::sync::watch::channel(false);
    let cleanup = crate::infrastructure::cleanup::spawn_cleanup(db.clone(), stop_rx);
    let listener = match tokio::net::TcpListener::bind(config.bind_addr).await {
        Ok(listener) => listener,
        Err(_) => {
            let _ = stop_tx.send(true);
            let _ = cleanup.await;
            return Err(CommandExecutionError::Startup);
        }
    };
    let result = axum::serve(listener, crate::api::build_router(db, &config))
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await
        .map_err(|_| CommandExecutionError::Startup);
    let _ = stop_tx.send(true);
    let _ = cleanup.await;
    result
}

pub async fn entry<AI, AS, EI, EK, EV>(args: AI, environment: EI) -> u8
where
    AI: IntoIterator<Item = AS>,
    AS: AsRef<str>,
    EI: IntoIterator<Item = (EK, EV)>,
    EK: Into<String>,
    EV: Into<String>,
{
    let command = match Command::parse(args) {
        Ok(command) => command,
        Err(error) => {
            eprintln!("{error}");
            return 2;
        }
    };
    if !command_requires_runtime_configuration(command) {
        return execute(command, None).await;
    }
    // 此入口专供开发环境或测试：环境变量在这里被一次性转换并校验，之后的服务层只接收
    // 强类型 Config，不会在运行中重新读取会变化的进程环境。
    let config = match Config::from_map(environment) {
        Ok(config) => config,
        Err(error) => {
            eprintln!("{}: {error}", error.code());
            return 2;
        }
    };
    execute(command, Some(config)).await
}

pub async fn entry_with_config<AI, AS>(args: AI, config: Config) -> u8
where
    AI: IntoIterator<Item = AS>,
    AS: AsRef<str>,
{
    let command = match Command::parse(args) {
        Ok(command) => command,
        Err(error) => {
            eprintln!("{error}");
            return 2;
        }
    };
    // 发行配置已经在 main 中完成严格解析；这里不再读取环境变量，保持配置来源单一。
    execute(command, Some(config)).await
}

async fn execute(command: Command, config: Option<Config>) -> u8 {
    // 将业务错误压缩为进程退出码：2 表示调用/配置错误（在入口提前返回），1 表示已解析
    // 命令执行失败；错误本身只输出稳定、脱敏的文本，部署脚本无需解析内部错误细节。
    let result = match command {
        Command::Package => package_current_project()
            .map(|output| println!("release package created at {}", output.display()))
            .map_err(CommandExecutionError::from),
        command => {
            run(
                command,
                config.expect("runtime commands must have validated configuration"),
            )
            .await
        }
    };
    match result {
        Ok(()) => 0,
        Err(error) => {
            eprintln!("{error}");
            1
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Config;

    fn config() -> Config {
        Config::from_map([("DATABASE_URL", "postgres://not-running.invalid/pocket_log")]).unwrap()
    }

    #[test]
    fn parses_supported_commands() {
        assert_eq!(Command::parse(["migrate"]).unwrap(), Command::Migrate);
        assert_eq!(Command::parse(["init"]).unwrap(), Command::Init);
        assert_eq!(Command::parse(["demo"]).unwrap(), Command::Demo);
        assert_eq!(Command::parse(["clean"]).unwrap(), Command::Clean);
        assert_eq!(Command::parse(["serve"]).unwrap(), Command::Serve);
        assert_eq!(Command::parse(["package"]).unwrap(), Command::Package);
    }

    #[test]
    fn defaults_to_serve_when_no_command_is_given() {
        assert_eq!(Command::parse(Vec::<&str>::new()).unwrap(), Command::Serve);
    }

    #[test]
    fn package_does_not_require_runtime_configuration() {
        assert!(!command_requires_runtime_configuration(Command::Package));
        assert!(command_requires_runtime_configuration(Command::Migrate));
        assert!(command_requires_runtime_configuration(Command::Init));
        assert!(command_requires_runtime_configuration(Command::Demo));
        assert!(command_requires_runtime_configuration(Command::Clean));
        assert!(command_requires_runtime_configuration(Command::Serve));
    }

    #[test]
    fn rejects_missing_unknown_and_extra_commands_with_usage() {
        for args in [vec!["unknown"], vec!["serve", "extra"]] {
            let error = Command::parse(args).unwrap_err();
            assert_eq!(error.code(), "command.invalid");
            assert_eq!(
                error.usage(),
                "Usage: pocket-log-backend [migrate|init|demo|clean|serve|package]"
            );
        }
    }

    #[tokio::test]
    async fn dispatch_boundary_reports_database_failure_without_leaking_details() {
        let error = run(Command::Serve, config()).await.unwrap_err();
        assert_eq!(error.to_string(), "startup failed");
        assert!(!format!("{error:?}").contains("not-running.invalid"));
    }

    #[tokio::test]
    async fn invalid_invocations_return_nonzero_exit_code() {
        assert_eq!(entry(["unknown"], Vec::<(&str, &str)>::new()).await, 2);
        assert_eq!(
            entry(["unknown"], [("DATABASE_URL", "postgres://unused")]).await,
            2
        );
    }

    #[tokio::test]
    async fn no_argument_entry_dispatches_to_serve() {
        assert_eq!(
            entry(
                Vec::<&str>::new(),
                [("DATABASE_URL", "postgres://127.0.0.1:1/pocket_log")],
            )
            .await,
            1
        );
    }
}
