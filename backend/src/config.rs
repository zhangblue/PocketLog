//! 运行时配置解析与安全边界。
//!
//! 配置从环境变量一次性解析为强类型值；连接池、超时和请求体限制在启动时校验，避免
//! 将不安全或不可用的参数带入运行中的服务。

use std::{collections::HashMap, fmt, net::SocketAddr, path::PathBuf, time::Duration};

use sea_orm::SqlxPostgresConnector;
use serde::Deserialize;
use thiserror::Error;

const DEFAULT_BIND_ADDR: &str = "127.0.0.1:3000";
const DEFAULT_FRONTEND_DIST_DIR: &str = "dist";
const DEFAULT_POOL_MIN: u32 = 1;
const DEFAULT_POOL_MAX: u32 = 10;
const DEFAULT_REQUEST_TIMEOUT_SECS: u64 = 15;
const DEFAULT_BODY_LIMIT_BYTES: usize = 1024 * 1024;
const DEFAULT_DATABASE_CONNECT_TIMEOUT_SECS: u64 = 5;
const DEFAULT_POOL_ACQUIRE_TIMEOUT_SECS: u64 = 5;
const DEFAULT_LOG_LEVEL: &str = "info";
const DEFAULT_LOG_RETENTION_DAYS: u16 = 14;

#[derive(Debug)]
pub struct Config {
    /// 仅在连接池创建时借用原始值；其 Debug 实现固定脱敏，禁止把凭据带入诊断输出。
    pub database_url: SecretDatabaseUrl,
    /// TCP 监听地址。解析阶段即验证为 SocketAddr，避免启动到一半才发现地址格式错误。
    pub bind_addr: SocketAddr,
    /// 前端构建产物根目录；发行配置加载时由 ReleaseLayout 强制为可执行文件同级 dist。
    pub frontend_dist_dir: PathBuf,
    /// 连接池最小连接数。较小值有利于空闲时节省数据库资源。
    pub pool_min: u32,
    /// 连接池最大连接数，是后台并发访问 PostgreSQL 的硬上限。
    pub pool_max: u32,
    /// HTTP 请求总超时；超时后响应在中间件层统一转换为稳定错误格式。
    pub request_timeout: Duration,
    /// 单请求体上限，保护写接口不被异常大载荷拖垮。
    pub body_limit_bytes: usize,
    /// 建立新数据库连接的超时，避免数据库不可达时启动或请求长期挂起。
    pub database_connect_timeout: Duration,
    /// 从连接池借连接的最长等待时间；超过后由上层归一为失败。
    pub pool_acquire_timeout: Duration,
    /// 进程日志相关配置，供 main 在极早期初始化 tracing 使用。
    pub logging: LoggingConfig,
}

#[derive(Debug, PartialEq, Eq)]
pub struct LoggingConfig {
    /// tracing 的过滤表达式；仅接受非空值，具体语法在初始化订阅器时再次验证。
    pub level: String,
    /// 保留天数，以本地日志文件名中的日期计算；零天没有可解释的保留语义。
    pub retention_days: u16,
}

impl Config {
    pub fn from_map<I, K, V>(input: I) -> Result<Self, ConfigError>
    where
        I: IntoIterator<Item = (K, V)>,
        K: Into<String>,
        V: Into<String>,
    {
        // 先收集环境变量再统一校验，便于给出稳定错误码；敏感连接串只在内部保存，不能
        // 通过 Debug 或启动错误回显到日志。
        let values = input
            .into_iter()
            .map(|(key, value)| (key.into(), value.into()))
            .collect::<HashMap<_, _>>();

        let database_url = values
            .get("DATABASE_URL")
            .filter(|value| !value.trim().is_empty())
            .cloned()
            .ok_or_else(|| {
                ConfigError::new("config.database_url_missing", "database URL is required")
            })?;
        if !SqlxPostgresConnector::accepts(&database_url) {
            return Err(ConfigError::new(
                "config.database_url_invalid",
                "database URL is invalid",
            ));
        }
        let bind_addr = values
            .get("BIND_ADDR")
            .map(String::as_str)
            .unwrap_or(DEFAULT_BIND_ADDR)
            .parse()
            .map_err(|_| ConfigError::new("config.bind_addr_invalid", "bind address is invalid"))?;
        let pool_min = positive_value(
            &values,
            "POOL_MIN",
            DEFAULT_POOL_MIN,
            "config.pool_min_invalid",
        )?;
        let pool_max = positive_value(
            &values,
            "POOL_MAX",
            DEFAULT_POOL_MAX,
            "config.pool_max_invalid",
        )?;
        if pool_min > pool_max {
            return Err(ConfigError::new(
                "config.pool_range_invalid",
                "connection pool range is invalid",
            ));
        }
        let request_timeout = Duration::from_secs(positive_value(
            &values,
            "REQUEST_TIMEOUT_SECS",
            DEFAULT_REQUEST_TIMEOUT_SECS,
            "config.request_timeout_invalid",
        )?);
        let database_connect_timeout = Duration::from_secs(positive_value(
            &values,
            "DATABASE_CONNECT_TIMEOUT_SECS",
            DEFAULT_DATABASE_CONNECT_TIMEOUT_SECS,
            "config.database_connect_timeout_invalid",
        )?);
        let pool_acquire_timeout = Duration::from_secs(positive_value(
            &values,
            "POOL_ACQUIRE_TIMEOUT_SECS",
            DEFAULT_POOL_ACQUIRE_TIMEOUT_SECS,
            "config.pool_acquire_timeout_invalid",
        )?);
        let body_limit_bytes = positive_value(
            &values,
            "BODY_LIMIT_BYTES",
            DEFAULT_BODY_LIMIT_BYTES,
            "config.body_limit_invalid",
        )?;

        Ok(Self {
            database_url: SecretDatabaseUrl(database_url),
            bind_addr,
            frontend_dist_dir: values
                .get("FRONTEND_DIST_DIR")
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from(DEFAULT_FRONTEND_DIST_DIR)),
            pool_min,
            pool_max,
            request_timeout,
            body_limit_bytes,
            database_connect_timeout,
            pool_acquire_timeout,
            logging: LoggingConfig {
                level: DEFAULT_LOG_LEVEL.to_owned(),
                retention_days: DEFAULT_LOG_RETENTION_DAYS,
            },
        })
    }
}

#[derive(Deserialize)]
struct FileConfig {
    /// TOML 文件中的数据库连接串；正式发行时这是生产配置的唯一来源。
    database_url: String,
    bind_addr: Option<String>,
    pool_min: Option<u32>,
    pool_max: Option<u32>,
    request_timeout_secs: Option<u64>,
    database_connect_timeout_secs: Option<u64>,
    pool_acquire_timeout_secs: Option<u64>,
    body_limit_bytes: Option<usize>,
    logging: LoggingFileConfig,
}

#[derive(Deserialize)]
struct LoggingFileConfig {
    level: Option<String>,
    retention_days: Option<u16>,
}

pub fn load_toml_config(source: &str) -> Result<Config, ConfigError> {
    // 此公开入口主要服务单元测试和非发行调用；正式发行加载会改用下方内部函数，传入
    // 固定的同级 dist 路径，不能由 TOML 任意指定静态资源位置。
    load_toml_config_with_frontend(source, PathBuf::from(DEFAULT_FRONTEND_DIST_DIR))
}

pub(crate) fn load_toml_config_with_frontend(
    source: &str,
    frontend_dist_dir: PathBuf,
) -> Result<Config, ConfigError> {
    // 先按文件模型反序列化，再复用 Config::from_map 的全部数值/数据库地址校验，避免
    // 环境变量与 TOML 两套配置规则逐渐漂移。任何失败统一映射为文件错误，以免回显原文。
    let file_config = toml::from_str::<FileConfig>(source)
        .map_err(|_| ConfigError::new("config.file_invalid", "configuration file is invalid"))?;
    let logging_level = file_config
        .logging
        .level
        .unwrap_or_else(|| DEFAULT_LOG_LEVEL.to_owned());
    if logging_level.trim().is_empty() {
        return Err(ConfigError::new(
            "config.file_invalid",
            "configuration file is invalid",
        ));
    }
    let logging_retention_days = file_config
        .logging
        .retention_days
        .unwrap_or(DEFAULT_LOG_RETENTION_DAYS);
    if logging_retention_days == 0 {
        return Err(ConfigError::new(
            "config.file_invalid",
            "configuration file is invalid",
        ));
    }

    Config::from_map([
        ("DATABASE_URL", file_config.database_url),
        (
            "BIND_ADDR",
            file_config
                .bind_addr
                .unwrap_or_else(|| DEFAULT_BIND_ADDR.to_owned()),
        ),
        (
            "POOL_MIN",
            file_config.pool_min.unwrap_or(DEFAULT_POOL_MIN).to_string(),
        ),
        (
            "POOL_MAX",
            file_config.pool_max.unwrap_or(DEFAULT_POOL_MAX).to_string(),
        ),
        (
            "REQUEST_TIMEOUT_SECS",
            file_config
                .request_timeout_secs
                .unwrap_or(DEFAULT_REQUEST_TIMEOUT_SECS)
                .to_string(),
        ),
        (
            "DATABASE_CONNECT_TIMEOUT_SECS",
            file_config
                .database_connect_timeout_secs
                .unwrap_or(DEFAULT_DATABASE_CONNECT_TIMEOUT_SECS)
                .to_string(),
        ),
        (
            "POOL_ACQUIRE_TIMEOUT_SECS",
            file_config
                .pool_acquire_timeout_secs
                .unwrap_or(DEFAULT_POOL_ACQUIRE_TIMEOUT_SECS)
                .to_string(),
        ),
        (
            "BODY_LIMIT_BYTES",
            file_config
                .body_limit_bytes
                .unwrap_or(DEFAULT_BODY_LIMIT_BYTES)
                .to_string(),
        ),
    ])
    .map(|mut config| {
        // 发行模式下前端目录始终以可执行文件同级 dist 为准，不接受配置文件覆盖，避免把
        // 发布包误指向构建机上的其他路径。
        config.frontend_dist_dir = frontend_dist_dir;
        config.logging = LoggingConfig {
            level: logging_level,
            retention_days: logging_retention_days,
        };
        config
    })
    .map_err(|_| ConfigError::new("config.file_invalid", "configuration file is invalid"))
}

fn positive_value<T>(
    values: &HashMap<String, String>,
    key: &str,
    default: T,
    code: &'static str,
) -> Result<T, ConfigError>
where
    T: Copy + Default + PartialOrd + std::str::FromStr,
{
    // 所有容量、数量和时长都必须为正数；零值无法表达可用的连接池、超时或请求体限制，
    // 因此在启动阶段拒绝，避免服务进入无效配置状态。
    let Some(raw) = values.get(key) else {
        return Ok(default);
    };
    let value = raw
        .parse::<T>()
        .map_err(|_| ConfigError::new(code, "configuration value is invalid"))?;
    if value <= T::default() {
        return Err(ConfigError::new(code, "configuration value is invalid"));
    }
    Ok(value)
}

pub struct SecretDatabaseUrl(String);

impl SecretDatabaseUrl {
    pub(crate) fn as_str(&self) -> &str {
        // 此访问范围限制在 crate 内的数据库适配器，降低未来 API 或日志层误输出原始 URL 的机会。
        &self.0
    }
}

impl fmt::Debug for SecretDatabaseUrl {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        // 数据库 URL 可能包含密码，调试输出必须固定脱敏，防止错误日志泄露凭据。
        let _ = &self.0;
        formatter.write_str("[REDACTED]")
    }
}

#[derive(Debug, Error, PartialEq, Eq)]
#[error("{message}")]
pub struct ConfigError {
    code: &'static str,
    message: &'static str,
}

impl ConfigError {
    fn new(code: &'static str, message: &'static str) -> Self {
        Self { code, message }
    }

    pub fn code(&self) -> &'static str {
        self.code
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct ConfigInput(Vec<(String, String)>);

    impl ConfigInput {
        fn valid() -> Self {
            Self(vec![(
                "DATABASE_URL".to_owned(),
                "postgres://user:password@localhost/qizhang".to_owned(),
            )])
        }

        fn with(mut self, key: &str, value: &str) -> Self {
            self.0.retain(|(existing, _)| existing != key);
            self.0.push((key.to_owned(), value.to_owned()));
            self
        }

        fn without(mut self, key: &str) -> Self {
            self.0.retain(|(existing, _)| existing != key);
            self
        }
    }

    impl IntoIterator for ConfigInput {
        type Item = (String, String);
        type IntoIter = std::vec::IntoIter<Self::Item>;

        fn into_iter(self) -> Self::IntoIter {
            self.0.into_iter()
        }
    }

    #[test]
    fn rejects_invalid_configuration_values() {
        let cases = [
            (
                ConfigInput::valid().without("DATABASE_URL"),
                "config.database_url_missing",
            ),
            (
                ConfigInput::valid().with("BIND_ADDR", "not-a-socket-address"),
                "config.bind_addr_invalid",
            ),
            (
                ConfigInput::valid().with("POOL_MIN", "0"),
                "config.pool_min_invalid",
            ),
            (
                ConfigInput::valid().with("POOL_MAX", "0"),
                "config.pool_max_invalid",
            ),
            (
                ConfigInput::valid().with("POOL_MIN", "11"),
                "config.pool_range_invalid",
            ),
            (
                ConfigInput::valid().with("REQUEST_TIMEOUT_SECS", "0"),
                "config.request_timeout_invalid",
            ),
            (
                ConfigInput::valid().with("DATABASE_CONNECT_TIMEOUT_SECS", "0"),
                "config.database_connect_timeout_invalid",
            ),
            (
                ConfigInput::valid().with("POOL_ACQUIRE_TIMEOUT_SECS", "0"),
                "config.pool_acquire_timeout_invalid",
            ),
            (
                ConfigInput::valid().with("BODY_LIMIT_BYTES", "0"),
                "config.body_limit_invalid",
            ),
        ];

        for (input, expected_code) in cases {
            assert_eq!(
                Config::from_map(input).unwrap_err().code(),
                expected_code,
                "unexpected result for {expected_code}"
            );
        }
    }

    #[test]
    fn defaults_to_loopback() {
        let config = Config::from_map(ConfigInput::valid()).unwrap();
        assert_eq!(config.bind_addr.to_string(), "127.0.0.1:3000");
        assert_eq!(config.pool_min, 1);
        assert_eq!(config.pool_max, 10);
        assert_eq!(config.request_timeout, Duration::from_secs(15));
        assert_eq!(config.body_limit_bytes, 1_048_576);
        assert_eq!(config.database_connect_timeout, Duration::from_secs(5));
        assert_eq!(config.pool_acquire_timeout, Duration::from_secs(5));
    }

    #[test]
    fn accepts_valid_overrides() {
        let config = Config::from_map(
            ConfigInput::valid()
                .with("BIND_ADDR", "0.0.0.0:8080")
                .with("FRONTEND_DIST_DIR", "/srv/qizhang")
                .with("POOL_MIN", "2")
                .with("POOL_MAX", "20")
                .with("REQUEST_TIMEOUT_SECS", "30")
                .with("DATABASE_CONNECT_TIMEOUT_SECS", "7")
                .with("POOL_ACQUIRE_TIMEOUT_SECS", "8")
                .with("BODY_LIMIT_BYTES", "2048"),
        )
        .unwrap();

        assert_eq!(config.bind_addr.to_string(), "0.0.0.0:8080");
        assert_eq!(config.frontend_dist_dir, PathBuf::from("/srv/qizhang"));
        assert_eq!(config.pool_min, 2);
        assert_eq!(config.pool_max, 20);
        assert_eq!(config.request_timeout, Duration::from_secs(30));
        assert_eq!(config.database_connect_timeout, Duration::from_secs(7));
        assert_eq!(config.pool_acquire_timeout, Duration::from_secs(8));
        assert_eq!(config.body_limit_bytes, 2048);
    }

    #[test]
    fn redacts_database_url_from_debug_output() {
        let secret = "postgres://secret-user:secret-password@localhost/qizhang";
        let config = Config::from_map(ConfigInput::valid().with("DATABASE_URL", secret)).unwrap();

        let debug = format!("{config:?}");
        assert!(debug.contains("[REDACTED]"));
        assert!(!debug.contains(secret));

        let error = Config::from_map(
            ConfigInput::valid()
                .with("DATABASE_URL", secret)
                .with("BIND_ADDR", "invalid"),
        )
        .unwrap_err();
        assert!(!format!("{error:?}").contains(secret));
    }

    #[test]
    fn rejects_invalid_database_url_without_leaking_it() {
        let invalid = "not-a-url";
        let error =
            Config::from_map(ConfigInput::valid().with("DATABASE_URL", invalid)).unwrap_err();

        assert_eq!(error.code(), "config.database_url_invalid");
        assert!(!error.to_string().contains(invalid));
        assert!(!format!("{error:?}").contains(invalid));
    }

    #[test]
    fn toml_configuration_uses_file_defaults_and_logging_values() {
        let config = load_toml_config(
            r#"
database_url = "postgres://user:password@localhost/qizhang"

[logging]
level = "debug"
retention_days = 30
"#,
        )
        .unwrap();

        assert_eq!(config.frontend_dist_dir, PathBuf::from("dist"));
        assert_eq!(config.bind_addr.to_string(), "127.0.0.1:3000");
        assert_eq!(config.pool_min, 1);
        assert_eq!(config.pool_max, 10);
        assert_eq!(config.logging.level, "debug");
        assert_eq!(config.logging.retention_days, 30);
    }

    #[test]
    fn invalid_toml_values_use_file_errors_without_credentials() {
        let database_url = "postgres://secret-user:secret-password@localhost/qizhang";
        let error = load_toml_config(&format!(
            "database_url = {database_url:?}\npool_min = 0\n[logging]\n"
        ))
        .unwrap_err();

        assert_eq!(error.code(), "config.file_invalid");
        assert!(!format!("{error:?}").contains(database_url));
        assert!(!format!("{error:?}").contains("secret-password"));
    }
}
