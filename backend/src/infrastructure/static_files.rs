//! 启动前静态资源完整性检查。
//!
//! 后端不会构建前端资源，只验证发行目录中的 `dist/` 至少具备可服务的最小条件。更细的
//! 资源读取与缓存策略留给 `api::router` 在请求阶段处理。

use std::path::{Path, PathBuf};

use thiserror::Error;

#[derive(Debug, Error)]
pub enum StaticAssetsError {
    #[error("static asset directory is missing")]
    Missing,
    #[error("index.html is missing")]
    IndexMissing,
}

// 启动前仅检查静态资源目录和 index.html 是否存在。
pub fn ensure_static_assets(dir: &Path) -> Result<(), StaticAssetsError> {
    // 此处只做启动前的最小可服务性检查，不递归扫描 dist：带哈希的 assets 由路由在请求时
    // 按路径读取，构建工具增加新资源不需要修改后端校验代码。
    if !dir.is_dir() {
        return Err(StaticAssetsError::Missing);
    }
    if !dir.join("index.html").is_file() {
        return Err(StaticAssetsError::IndexMissing);
    }
    Ok(())
}

pub fn index_path(dir: &Path) -> PathBuf {
    // 文件名固定为 index.html；生产调用方传入已配置的静态资源目录。
    dir.join("index.html")
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn temp_dir() -> PathBuf {
        std::env::temp_dir().join(format!("qizhang-static-{}", Uuid::new_v4()))
    }

    #[test]
    fn validates_directory_and_index_file() {
        let missing = temp_dir();
        assert!(matches!(
            ensure_static_assets(&missing),
            Err(StaticAssetsError::Missing)
        ));

        let dir = temp_dir();
        std::fs::create_dir_all(&dir).unwrap();
        assert!(matches!(
            ensure_static_assets(&dir),
            Err(StaticAssetsError::IndexMissing)
        ));
        std::fs::write(index_path(&dir), "index").unwrap();
        assert!(ensure_static_assets(&dir).is_ok());
        assert_eq!(index_path(&dir), dir.join("index.html"));
        std::fs::remove_dir_all(dir).unwrap();
    }
}
