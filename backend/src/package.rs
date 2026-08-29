//! 发行包组装：把已构建的前端、后端与默认配置放入固定目录布局。
//!
//! 打包动作面向本地开发机构建，不依赖运行中的服务。它先触发前后端生产构建，再把产物
//! 复制到固定的发行目录：可执行文件、`dist/`、`config.toml` 和 `logs/`。

use std::{
    fs, io,
    path::{Path, PathBuf},
    process::Command,
};

use thiserror::Error;

/// 组装发行包所需的三个已生成源文件路径。
#[derive(Debug)]
pub struct PackageInput {
    /// `cargo build --release` 完成后的平台可执行文件，复制前必须确认其为普通文件。
    pub release_binary: PathBuf,
    /// `npm run build` 输出的目录；index.html 是 SPA 可启动的最小完整性标志。
    pub frontend_dist_dir: PathBuf,
    /// 随源码维护的无敏感默认模板，仅在目标配置尚不存在时复制一次。
    pub config_template: PathBuf,
}

/// 创建当前开发机目标平台对应的发行目录。
pub fn package_current_project() -> Result<PathBuf, PackageError> {
    // 从编译期清单目录倒推出项目根，避免开发者从任意工作目录运行 `cargo run -- package`
    // 时把产物落到错误位置。这里假定 backend 与 frontend 是同级目录，这是项目布局契约。
    let backend_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let project_root = backend_dir.parent().ok_or(PackageError::ProjectLayout)?;
    let frontend_dir = project_root.join("frontend");
    let manifest_path = backend_dir.join("Cargo.toml");

    // 前端产物必须先生成；命令输出继承给调用终端，方便开发者定位构建工具自身的错误。
    run_build_command(
        Command::new("npm")
            .arg("--prefix")
            .arg(&frontend_dir)
            .args(["run", "build"]),
        PackageError::FrontendBuild,
    )?;
    // Cargo 文档规定 --release 产物位于 target/release，--manifest-path 锁定本后端清单。
    run_build_command(
        Command::new("cargo")
            .current_dir(project_root)
            .args(["build", "--release", "--manifest-path"])
            .arg(&manifest_path),
        PackageError::BackendBuild,
    )?;

    // 构建命令成功不等于产物路径正确，assemble_release 会再次检查每个输入，确保不发布
    // 半完成目录。发行名带当前平台信息，允许同一源码树暂存多平台构建结果。
    let input = PackageInput {
        release_binary: backend_dir
            .join("target")
            .join("release")
            .join(executable_name("pocket-log-backend")),
        frontend_dist_dir: frontend_dir.join("dist"),
        config_template: backend_dir.join("config.toml.example"),
    };
    let output = project_root
        .join("release")
        .join(format!("qizhang-{}", current_target_name()));
    assemble_release(&input, &output)?;
    Ok(output)
}

/// 把构建产物复制到目标发行目录，保留已有部署配置。
pub fn assemble_release(input: &PackageInput, output: &Path) -> Result<(), PackageError> {
    // 先验证所有不可恢复的输入，再创建/改动输出目录，尽量避免构建失败留下看似可部署的包。
    validate_file(&input.release_binary, PackageError::ReleaseBinaryMissing)?;
    validate_file(
        &input.frontend_dist_dir.join("index.html"),
        PackageError::FrontendDistInvalid,
    )?;
    validate_file(&input.config_template, PackageError::ConfigTemplateMissing)?;

    fs::create_dir_all(output).map_err(|_| PackageError::OutputDirectory)?;
    // dist 允许覆盖以刷新前端资产；config 则是部署人员可能编辑过的状态，绝不可被后续
    // 打包静默覆盖。logs 只创建目录，历史日志同样保留。
    copy_directory_recursively(&input.frontend_dist_dir, &output.join("dist"))?;
    fs::copy(
        &input.release_binary,
        output.join(executable_name("pocket-log-backend")),
    )
    .map_err(|_| PackageError::Copy)?;

    let config_path = output.join("config.toml");
    if matches!(fs::symlink_metadata(&config_path), Err(error) if error.kind() == io::ErrorKind::NotFound)
    {
        fs::copy(&input.config_template, config_path).map_err(|_| PackageError::Copy)?;
    }
    fs::create_dir_all(output.join("logs")).map_err(|_| PackageError::OutputDirectory)?;
    Ok(())
}

/// 返回当前平台的可执行文件名，Windows 额外使用 .exe 后缀。
pub fn executable_name(base_name: &str) -> String {
    if cfg!(target_os = "windows") {
        format!("{base_name}.exe")
    } else {
        base_name.to_owned()
    }
}

fn current_target_name() -> String {
    // 目录名仅标记当前编译机器目标；真正的跨平台交叉编译仍由调用 Cargo 的 target 配置决定。
    format!("{}-{}", std::env::consts::ARCH, std::env::consts::OS)
}

fn run_build_command(command: &mut Command, failure: PackageError) -> Result<(), PackageError> {
    // 子进程沿用终端的 stdout/stderr，保留 npm/cargo 的具体诊断；对外只返回稳定错误码，
    // 不把平台相关命令错误拼进应用日志或 API。
    let status = command.status().map_err(|_| failure.clone())?;
    if status.success() {
        Ok(())
    } else {
        Err(failure)
    }
}

fn validate_file(path: &Path, error: PackageError) -> Result<(), PackageError> {
    // 这里只接受普通文件。若路径是目录或不存在，均视为构建链路未产出可发布对象。
    if path.is_file() { Ok(()) } else { Err(error) }
}

fn copy_directory_recursively(source: &Path, destination: &Path) -> Result<(), PackageError> {
    // 只复制普通文件与目录，显式拒绝链接、管道等特殊文件，避免发行包意外携带指向构建机
    // 的引用或在递归复制中引入不可预测的行为。
    fs::create_dir_all(destination).map_err(|_| PackageError::OutputDirectory)?;
    for entry in fs::read_dir(source).map_err(|_| PackageError::FrontendDistInvalid)? {
        let entry = entry.map_err(|_| PackageError::Copy)?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        let file_type = entry.file_type().map_err(|_| PackageError::Copy)?;
        if file_type.is_dir() {
            copy_directory_recursively(&source_path, &destination_path)?;
        } else if file_type.is_file() {
            fs::copy(source_path, destination_path).map_err(|_| PackageError::Copy)?;
        } else {
            return Err(PackageError::Copy);
        }
    }
    Ok(())
}

#[derive(Clone, Debug, Error, PartialEq, Eq)]
pub enum PackageError {
    #[error("package.frontend_build_failed")]
    FrontendBuild,
    #[error("package.backend_build_failed")]
    BackendBuild,
    #[error("package.project_layout_invalid")]
    ProjectLayout,
    #[error("package.release_binary_missing")]
    ReleaseBinaryMissing,
    #[error("package.frontend_dist_invalid")]
    FrontendDistInvalid,
    #[error("package.config_template_missing")]
    ConfigTemplateMissing,
    #[error("package.output_directory_unavailable")]
    OutputDirectory,
    #[error("package.copy_failed")]
    Copy,
}

impl PackageError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::FrontendBuild => "package.frontend_build_failed",
            Self::BackendBuild => "package.backend_build_failed",
            Self::ProjectLayout => "package.project_layout_invalid",
            Self::ReleaseBinaryMissing => "package.release_binary_missing",
            Self::FrontendDistInvalid => "package.frontend_dist_invalid",
            Self::ConfigTemplateMissing => "package.config_template_missing",
            Self::OutputDirectory => "package.output_directory_unavailable",
            Self::Copy => "package.copy_failed",
        }
    }
}

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf};

    use super::{PackageInput, assemble_release, executable_name};

    #[test]
    fn package_copies_binary_dist_and_template_without_overwriting_config() {
        let fixture = PackageFixture::new();
        fs::write(
            fixture.output.join("config.toml"),
            "database_url = 'keep-me'",
        )
        .unwrap();

        assemble_release(&fixture.input, &fixture.output).unwrap();

        assert!(
            fixture
                .output
                .join(executable_name("pocket-log-backend"))
                .is_file()
        );
        assert!(fixture.output.join("dist/index.html").is_file());
        assert!(fixture.output.join("dist/assets/app.js").is_file());
        assert!(fixture.output.join("logs").is_dir());
        assert_eq!(
            fs::read_to_string(fixture.output.join("config.toml")).unwrap(),
            "database_url = 'keep-me'"
        );
    }

    #[test]
    fn package_rejects_a_frontend_directory_without_index_html() {
        let fixture = PackageFixture::new();
        fs::remove_file(fixture.input.frontend_dist_dir.join("index.html")).unwrap();

        let error = assemble_release(&fixture.input, &fixture.output).unwrap_err();

        assert_eq!(error.code(), "package.frontend_dist_invalid");
        assert!(!format!("{error:?}").contains("password"));
    }

    #[test]
    fn package_uses_the_template_when_the_output_configuration_is_missing() {
        let fixture = PackageFixture::new();

        assemble_release(&fixture.input, &fixture.output).unwrap();

        assert_eq!(
            fs::read_to_string(fixture.output.join("config.toml")).unwrap(),
            "database_url = 'template'\n[logging]\n"
        );
    }

    struct PackageFixture {
        root: PathBuf,
        input: PackageInput,
        output: PathBuf,
    }

    impl PackageFixture {
        fn new() -> Self {
            let root =
                std::env::temp_dir().join(format!("qizhang-package-{}", uuid::Uuid::new_v4()));
            let input_root = root.join("input");
            let frontend_dist_dir = input_root.join("dist");
            let output = root.join("output");
            let release_binary = input_root.join(executable_name("pocket-log-backend"));
            let config_template = input_root.join("config.toml.example");

            fs::create_dir_all(frontend_dist_dir.join("assets")).unwrap();
            fs::create_dir_all(&output).unwrap();
            fs::write(&release_binary, "binary fixture").unwrap();
            fs::write(frontend_dist_dir.join("index.html"), "<main>栖账</main>").unwrap();
            fs::write(frontend_dist_dir.join("assets/app.js"), "export {};").unwrap();
            fs::write(&config_template, "database_url = 'template'\n[logging]\n").unwrap();

            Self {
                root,
                input: PackageInput {
                    release_binary,
                    frontend_dist_dir,
                    config_template,
                },
                output,
            }
        }
    }

    impl Drop for PackageFixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }
}
