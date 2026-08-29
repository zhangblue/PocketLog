//! 独立发行目录的固定布局与同级 TOML 配置加载。
//!
//! 发行模式下，程序以可执行文件所在目录为锚点查找 `config.toml`、`dist/` 和 `logs/`，
//! 这样无论运维从哪个工作目录启动进程，都能命中同一套部署资源。

use std::{
    io,
    path::{Path, PathBuf},
};

use thiserror::Error;

use crate::config::{Config, ConfigError, load_toml_config_with_frontend};

#[derive(Debug, PartialEq, Eq)]
pub struct ReleaseLayout {
    /// 可执行文件所在目录，是配置、前端资源与日志的共同锚点，不依赖进程 CWD。
    pub root: PathBuf,
    pub config_path: PathBuf,
    pub frontend_dist_dir: PathBuf,
    pub logs_dir: PathBuf,
}

impl ReleaseLayout {
    pub fn from_executable(executable: &Path) -> Self {
        // `current_exe` 通常给出绝对路径；即使调用方传入无父目录的路径也退化为空路径，
        // 使三个派生路径仍保持同一相对根，而不会各自使用不同的默认目录。
        let root = executable
            .parent()
            .unwrap_or_else(|| Path::new(""))
            .to_path_buf();
        Self {
            config_path: root.join("config.toml"),
            frontend_dist_dir: root.join("dist"),
            logs_dir: root.join("logs"),
            root,
        }
    }

    pub fn current() -> Result<Self, ReleaseConfigError> {
        // 不能用 current_dir：服务管理器、双击启动和手工终端的工作目录均可能不同。
        let executable =
            std::env::current_exe().map_err(|_| ReleaseConfigError::CurrentExecutable)?;
        Ok(Self::from_executable(&executable))
    }

    pub fn load_config(&self) -> Result<Config, ReleaseConfigError> {
        // “不存在”是允许回退到开发环境变量的唯一文件错误；权限不足、目录误占位或 TOML
        // 非法都必须让启动失败，避免悄悄以另一套配置运行。
        let source = match std::fs::read_to_string(&self.config_path) {
            Ok(source) => source,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                return Err(ReleaseConfigError::Missing);
            }
            Err(_) => return Err(ReleaseConfigError::Unreadable),
        };
        load_toml_config_with_frontend(&source, self.frontend_dist_dir.clone())
            .map_err(ReleaseConfigError::Invalid)
    }
}

#[derive(Debug, Error)]
pub enum ReleaseConfigError {
    /// 缺失由调用者显式识别为开发模式回退条件，不表示无效发行包。
    #[error("configuration file is missing")]
    Missing,
    #[error("configuration file cannot be read")]
    Unreadable,
    #[error("configuration file location cannot be determined")]
    CurrentExecutable,
    #[error("{0}")]
    Invalid(ConfigError),
}

impl ReleaseConfigError {
    pub fn code(&self) -> &'static str {
        // 进程入口只暴露这些稳定代码；携带 source 的 ConfigError 也只会给出安全的通用消息。
        match self {
            Self::Missing => "config.file_missing",
            Self::Unreadable => "config.file_unreadable",
            Self::CurrentExecutable => "config.file_layout_invalid",
            Self::Invalid(error) => error.code(),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::{Path, PathBuf},
    };

    use super::*;
    use crate::config::load_toml_config;

    #[test]
    fn layout_uses_executable_parent_instead_of_current_directory() {
        let layout = ReleaseLayout::from_executable(Path::new("/tmp/qizhang/pocket-log-backend"));

        assert_eq!(layout.root, PathBuf::from("/tmp/qizhang"));
        assert_eq!(
            layout.config_path,
            PathBuf::from("/tmp/qizhang/config.toml")
        );
        assert_eq!(layout.frontend_dist_dir, PathBuf::from("/tmp/qizhang/dist"));
        assert_eq!(layout.logs_dir, PathBuf::from("/tmp/qizhang/logs"));
    }

    #[test]
    fn malformed_toml_is_a_redacted_configuration_error() {
        let error = load_toml_config("database_url = [").unwrap_err();

        assert_eq!(error.code(), "config.file_invalid");
        assert!(!format!("{error:?}").contains("password"));
    }

    #[test]
    fn sibling_config_forces_the_sibling_dist_directory() {
        let root = temporary_root();
        let layout = ReleaseLayout::from_executable(&root.join("pocket-log-backend"));
        fs::create_dir_all(&root).unwrap();
        fs::write(
            &layout.config_path,
            r#"
database_url = "postgres://user:password@localhost/qizhang"
bind_addr = "127.0.0.1:4100"
pool_min = 2
pool_max = 8
request_timeout_secs = 12
database_connect_timeout_secs = 6
pool_acquire_timeout_secs = 7
body_limit_bytes = 2048

[logging]
level = "warn"
retention_days = 21
"#,
        )
        .unwrap();

        let config = layout.load_config().unwrap();

        assert_eq!(config.frontend_dist_dir, root.join("dist"));
        assert_eq!(config.bind_addr.to_string(), "127.0.0.1:4100");
        assert_eq!(config.pool_min, 2);
        assert_eq!(config.pool_max, 8);
        assert_eq!(config.logging.level, "warn");
        assert_eq!(config.logging.retention_days, 21);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn invalid_file_configuration_redacts_database_credentials() {
        let root = temporary_root();
        let layout = ReleaseLayout::from_executable(&root.join("pocket-log-backend"));
        fs::create_dir_all(&root).unwrap();
        let database_url = "postgres://secret-user:secret-password@localhost/qizhang";
        fs::write(
            &layout.config_path,
            format!("database_url = {database_url:?}\nbind_addr = \"not-an-address\"\n[logging]\n"),
        )
        .unwrap();

        let error = layout.load_config().unwrap_err();

        assert_eq!(error.code(), "config.file_invalid");
        assert!(!format!("{error:?}").contains(database_url));
        assert!(!format!("{error:?}").contains("secret-password"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn missing_and_unreadable_files_have_distinct_safe_codes() {
        let root = temporary_root();
        let layout = ReleaseLayout::from_executable(&root.join("pocket-log-backend"));
        fs::create_dir_all(&root).unwrap();

        let missing = layout.load_config().unwrap_err();
        assert_eq!(missing.code(), "config.file_missing");

        fs::create_dir(&layout.config_path).unwrap();
        let unreadable = layout.load_config().unwrap_err();
        assert_eq!(unreadable.code(), "config.file_unreadable");
        assert!(!format!("{unreadable:?}").contains("password"));
        fs::remove_dir_all(root).unwrap();
    }

    fn temporary_root() -> PathBuf {
        std::env::temp_dir().join(format!("qizhang-release-{}", uuid::Uuid::new_v4()))
    }
}
