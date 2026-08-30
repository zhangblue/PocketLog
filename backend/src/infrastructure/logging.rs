//! 发行包的文件与控制台日志初始化。

use std::{
    fs::{self, File, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
};

use chrono::{Local, NaiveDate};
use thiserror::Error;
use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::{EnvFilter, layer::SubscriberExt, util::SubscriberInitExt};

const LOG_PREFIX: &str = "PocketLog-";
const LOG_SUFFIX: &str = ".jsonl";

/// 初始化进程级订阅器，并返回保证非阻塞文件 writer 持续存活到退出的 guard。
pub fn initialize_logging(
    log_dir: impl AsRef<Path>,
    level: &str,
    retention_days: u16,
) -> Result<WorkerGuard, LoggingError> {
    let log_dir = log_dir.as_ref();
    fs::create_dir_all(log_dir).map_err(|_| LoggingError::Directory)?;
    remove_expired_logs(log_dir, Local::now().date_naive(), retention_days)?;

    let filter = EnvFilter::try_new(level).map_err(|_| LoggingError::Level)?;
    let file_writer =
        DailyJsonlWriter::new(log_dir, retention_days).map_err(|_| LoggingError::Writer)?;
    let (file_writer, guard) = tracing_appender::non_blocking(file_writer);

    tracing_subscriber::registry()
        .with(filter)
        .with(
            tracing_subscriber::fmt::layer()
                .compact()
                .with_target(false)
                .with_writer(io::stderr),
        )
        .with(
            tracing_subscriber::fmt::layer()
                .json()
                .with_ansi(false)
                .with_writer(file_writer),
        )
        .try_init()
        .map_err(|_| LoggingError::Subscriber)?;

    Ok(guard)
}

fn remove_expired_logs(
    log_dir: &Path,
    today: NaiveDate,
    retention_days: u16,
) -> Result<(), LoggingError> {
    let entries = fs::read_dir(log_dir).map_err(|_| LoggingError::Retention)?;
    let names = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            entry
                .file_type()
                .ok()
                .filter(|kind| kind.is_file())
                .map(|_| entry)
        })
        .filter_map(|entry| entry.file_name().into_string().ok())
        .collect::<Vec<_>>();

    for name in select_expired_log_names(&names, today, retention_days) {
        fs::remove_file(log_dir.join(name)).map_err(|_| LoggingError::Retention)?;
    }
    Ok(())
}

fn select_expired_log_names(
    names: &[impl AsRef<str>],
    today: NaiveDate,
    retention_days: u16,
) -> Vec<String> {
    let cutoff = today - chrono::Days::new(u64::from(retention_days));
    names
        .iter()
        .filter_map(|name| {
            let name = name.as_ref();
            log_date(name)
                .filter(|date| *date < cutoff)
                .map(|_| name.to_owned())
        })
        .collect()
}

fn log_date(name: &str) -> Option<NaiveDate> {
    let date = name.strip_prefix(LOG_PREFIX)?.strip_suffix(LOG_SUFFIX)?;
    NaiveDate::parse_from_str(date, "%Y-%m-%d").ok()
}

struct DailyJsonlWriter {
    log_dir: PathBuf,
    date: NaiveDate,
    retention_days: u16,
    file: File,
}

impl DailyJsonlWriter {
    fn new(log_dir: &Path, retention_days: u16) -> io::Result<Self> {
        Self::new_for_date(log_dir, Local::now().date_naive(), retention_days)
    }

    fn new_for_date(log_dir: &Path, date: NaiveDate, retention_days: u16) -> io::Result<Self> {
        let file = open_log_file(log_dir, date)?;
        Ok(Self {
            log_dir: log_dir.to_path_buf(),
            date,
            retention_days,
            file,
        })
    }

    fn refresh_for_today(&mut self) -> io::Result<()> {
        self.refresh_for_date(Local::now().date_naive())
    }

    fn refresh_for_date(&mut self, today: NaiveDate) -> io::Result<()> {
        if today != self.date {
            remove_expired_logs(&self.log_dir, today, self.retention_days)
                .map_err(|_| io::Error::other("expired log files cannot be removed"))?;
            self.file = open_log_file(&self.log_dir, today)?;
            self.date = today;
        }
        Ok(())
    }
}

impl Write for DailyJsonlWriter {
    fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
        self.refresh_for_today()?;
        self.file.write(buffer)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.file.flush()
    }
}

fn open_log_file(log_dir: &Path, date: NaiveDate) -> io::Result<File> {
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_dir.join(format!("{LOG_PREFIX}{}.jsonl", date.format("%Y-%m-%d"))))
}

#[derive(Debug, Error)]
pub enum LoggingError {
    #[error("logging directory cannot be created")]
    Directory,
    #[error("expired log files cannot be removed")]
    Retention,
    #[error("logging level is invalid")]
    Level,
    #[error("log writer cannot be initialized")]
    Writer,
    #[error("logging subscriber cannot be initialized")]
    Subscriber,
}

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf};

    use chrono::NaiveDate;

    use super::{DailyJsonlWriter, initialize_logging, select_expired_log_names};

    #[test]
    fn expired_log_selection_ignores_unknown_files() {
        let names = [
            "PocketLog-2026-08-01.jsonl",
            "qizhang-2026-08-01.jsonl",
            "notes.txt",
            "PocketLog-invalid.jsonl",
        ];

        let expired =
            select_expired_log_names(&names, NaiveDate::from_ymd_opt(2026, 8, 20).unwrap(), 14);

        assert_eq!(expired, vec!["PocketLog-2026-08-01.jsonl"]);
    }

    #[test]
    fn logging_setup_creates_the_configured_directory() {
        let logs = temporary_directory().join("logs");

        let guard = initialize_logging(&logs, "info", 14).unwrap();

        assert!(logs.is_dir());
        drop(guard);
        fs::remove_dir_all(logs.parent().unwrap()).unwrap();
    }

    #[test]
    fn daily_rotation_prunes_expired_logs_and_ignores_unknown_files() {
        let root = temporary_directory();
        let logs = root.join("logs");
        fs::create_dir_all(&logs).unwrap();
        let expired = logs.join("PocketLog-2026-08-01.jsonl");
        let legacy_log = logs.join("qizhang-2026-08-01.jsonl");
        let unknown = logs.join("notes.txt");
        fs::write(&expired, "expired").unwrap();
        fs::write(&legacy_log, "legacy").unwrap();
        fs::write(&unknown, "keep").unwrap();
        let mut writer = DailyJsonlWriter::new_for_date(
            &logs,
            NaiveDate::from_ymd_opt(2026, 8, 19).unwrap(),
            14,
        )
        .unwrap();

        writer
            .refresh_for_date(NaiveDate::from_ymd_opt(2026, 8, 20).unwrap())
            .unwrap();

        assert!(!expired.exists());
        assert!(legacy_log.is_file());
        assert!(unknown.is_file());
        assert!(logs.join("PocketLog-2026-08-20.jsonl").is_file());
        drop(writer);
        fs::remove_dir_all(root).unwrap();
    }

    fn temporary_directory() -> PathBuf {
        std::env::temp_dir().join(format!("pocket-log-logging-{}", uuid::Uuid::new_v4()))
    }
}
