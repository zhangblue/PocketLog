//! 二进制入口只负责启动 Tokio 运行时并把进程参数交给命令层。
//!
//! 具体配置、迁移/服务边界和退出码集中在 `command`，保持 main 不携带业务逻辑。

use std::process::ExitCode;

use pocket_log_backend::{
    command::{Command, command_requires_runtime_configuration},
    infrastructure::logging::initialize_logging,
    release::{ReleaseConfigError, ReleaseLayout},
};

#[tokio::main]
async fn main() -> ExitCode {
    // 在解析任何配置前先冻结参数列表。这样 `package` 能完全绕开数据库/日志初始化；同时
    // 后续命令层再次解析的是同一份输入，不会受到迭代器已经被消费的影响。
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    let command = match Command::parse(&args) {
        Ok(command) => command,
        Err(error) => {
            eprintln!("{error}");
            return ExitCode::from(2);
        }
    };
    // package 是开发机构建命令，不需要数据库、发行配置或日志目录；其余命令维持既有
    // 发行优先配置边界。
    if !command_requires_runtime_configuration(command) {
        return ExitCode::from(
            pocket_log_backend::command::entry(args, std::iter::empty::<(String, String)>()).await,
        );
    }

    // 发行版的根目录来自实际可执行文件，而不是调用时的工作目录。运维可从任意目录启动
    // 服务而仍能找到随包发布的 config、dist 与 logs 三个同级资源。
    let layout = match ReleaseLayout::current() {
        Ok(layout) => layout,
        Err(error) => {
            eprintln!("{}: {error}", error.code());
            return ExitCode::from(1);
        }
    };
    // 同级配置文件一旦存在，便是唯一配置来源；只有缺失时才允许开发环境读取环境变量。
    // 这避免发行包被宿主机遗留环境变量意外重写。
    let release_config = match layout.load_config() {
        Ok(config) => Some(config),
        Err(ReleaseConfigError::Missing) => None,
        Err(error) => {
            eprintln!("{}: {error}", error.code());
            return ExitCode::from(1);
        }
    };
    // 日志必须早于连接数据库和绑定端口初始化，才能保留整个启动失败链路；若仍处于开发
    // 环境（没有同级 TOML），使用与配置默认值一致的安全默认日志策略。
    let (level, retention_days) = release_config
        .as_ref()
        .map(|config| (config.logging.level.as_str(), config.logging.retention_days))
        .unwrap_or(("info", 14));
    let _logging_guard = match initialize_logging(&layout.logs_dir, level, retention_days) {
        Ok(guard) => guard,
        Err(error) => {
            eprintln!("logging.initialization_failed: {error}");
            return ExitCode::from(1);
        }
    };

    // 已读到发行配置时绝不把环境变量混入其中；只有确认没有配置文件时才走环境变量入口，
    // 从而避免宿主机残留变量悄悄改变生产服务的数据库或监听地址。
    let code = match release_config {
        Some(config) => pocket_log_backend::command::entry_with_config(args, config).await,
        None => pocket_log_backend::command::entry(args, std::env::vars()).await,
    };
    ExitCode::from(code)
}
