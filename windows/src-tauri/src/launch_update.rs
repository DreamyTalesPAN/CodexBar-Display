// The update check at launch (#565) installs a version only once. An
// installer that fails, or an update source that keeps offering a version
// the installer does not deliver, would otherwise close the app at every
// start. The version is written to a file right before the installer runs;
// a start that is offered the same version again goes on without it.
// No dependencies, so CI tests this file on its own with `rustc --test`.

use std::path::Path;

pub fn tried(marker: &Path, offered: &str) -> bool {
    std::fs::read_to_string(marker).is_ok_and(|version| version.trim() == offered)
}

// False when the version could not be written: without the note a failing
// install would repeat, so the caller must not install.
pub fn record(marker: &Path, offered: &str) -> bool {
    if let Some(dir) = marker.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    std::fs::write(marker, offered).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn marker(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("vibetv-launch-update-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir.join("nested").join("launch-update-attempt.txt")
    }

    #[test]
    fn a_version_is_installed_at_launch_only_once() {
        let marker = marker("once");
        assert!(!tried(&marker, "1.0.63"));
        assert!(record(&marker, "1.0.63"));
        assert!(tried(&marker, "1.0.63"));
    }

    #[test]
    fn the_next_version_is_installed_again() {
        let marker = marker("next");
        assert!(record(&marker, "1.0.63"));
        assert!(!tried(&marker, "1.0.64"));
        assert!(record(&marker, "1.0.64"));
        assert!(tried(&marker, "1.0.64"));
        assert!(!tried(&marker, "1.0.63"));
    }

    #[test]
    fn a_version_that_cannot_be_written_is_not_recorded() {
        let marker = marker("blocked");
        // The marker's folder is a file here, so nothing can be written in it.
        let dir = marker.parent().unwrap();
        std::fs::create_dir_all(dir.parent().unwrap()).unwrap();
        std::fs::write(dir, "").unwrap();
        assert!(!record(&marker, "1.0.63"));
        assert!(!tried(&marker, "1.0.63"));
    }
}
