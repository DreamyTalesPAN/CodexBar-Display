// The update check at launch (#565), and the one while the app runs with its
// window closed, try a version at most once in 24 hours. An installer that
// fails, a download that never ends in time, or an update source that keeps
// offering a version the installer does not deliver would otherwise hold up
// or close the app again and again. The version and the time are written to
// a file before the download starts; a check that is offered the same version
// within the next 24 hours goes on without it. A running VibeTV update or
// theme install is not an attempt.
// No dependencies, so CI tests this file on its own with `rustc --test`.

use std::path::Path;

pub const RETRY_AFTER_SECS: u64 = 24 * 60 * 60;

// `recorded` is the file's content: the version, a line break, the time of
// the attempt in seconds since 1970. Anything else counts as no attempt, and
// so does a time that lies in the future (the clock was set back).
pub fn due(recorded: Option<&str>, offered: &str, now: u64) -> bool {
    let Some((version, time)) = recorded.and_then(|text| text.trim().split_once('\n')) else {
        return true;
    };
    let Ok(time) = time.trim().parse::<u64>() else {
        return true;
    };
    version.trim() != offered || now < time || now - time >= RETRY_AFTER_SECS
}

// True when the launch check may try `offered` now; the attempt is then on
// file. False also when it could not be written: without the note a failing
// attempt would repeat at every start.
pub fn claim(marker: &Path, offered: &str, now: u64) -> bool {
    if !due(std::fs::read_to_string(marker).ok().as_deref(), offered, now) {
        return false;
    }
    if let Some(dir) = marker.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    std::fs::write(marker, format!("{offered}\n{now}")).is_ok()
}

// For an attempt that ended before anything could be installed, because a
// VibeTV update or theme install was running: the next start tries again.
pub fn release(marker: &Path) {
    let _ = std::fs::remove_file(marker);
}

// An update installed while the window was closed relaunches the app, and
// the app comes back closed too. The installer passes an argument for that;
// this note, written right before the installer starts, makes it count only
// for that relaunch. A note older than this belongs to an installer that
// failed, and the next start shows the window as usual.
pub const RELAUNCH_NOTE_SECS: u64 = 15 * 60;

pub fn note_relaunch(note: &Path, now: u64) {
    if let Some(dir) = note.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::write(note, now.to_string());
}

// True when a fresh note was on file. The note is used up either way.
pub fn take_relaunch_note(note: &Path, now: u64) -> bool {
    let Ok(text) = std::fs::read_to_string(note) else {
        return false;
    };
    let _ = std::fs::remove_file(note);
    text.trim()
        .parse::<u64>()
        .map(|time| time <= now && now - time < RELAUNCH_NOTE_SECS)
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOON: u64 = 1_791_547_200;

    fn marker(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("vibetv-launch-update-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir.join("nested").join("launch-update-attempt.txt")
    }

    #[test]
    fn a_version_is_tried_again_only_after_24_hours() {
        let recorded = format!("1.0.63\n{NOON}");
        assert!(!due(Some(&recorded), "1.0.63", NOON));
        assert!(!due(Some(&recorded), "1.0.63", NOON + RETRY_AFTER_SECS - 1));
        assert!(due(Some(&recorded), "1.0.63", NOON + RETRY_AFTER_SECS));
    }

    #[test]
    fn another_version_is_tried_at_once() {
        let recorded = format!("1.0.63\n{NOON}");
        assert!(due(Some(&recorded), "1.0.64", NOON + 1));
    }

    #[test]
    fn nothing_on_file_or_an_unreadable_note_is_no_attempt() {
        assert!(due(None, "1.0.63", NOON));
        assert!(due(Some(""), "1.0.63", NOON));
        assert!(due(Some("1.0.63"), "1.0.63", NOON));
        assert!(due(Some("1.0.63\nyesterday"), "1.0.63", NOON));
    }

    #[test]
    fn a_clock_that_was_set_back_does_not_keep_the_version_away() {
        let recorded = format!("1.0.63\n{}", NOON + 10 * RETRY_AFTER_SECS);
        assert!(due(Some(&recorded), "1.0.63", NOON));
    }

    #[test]
    fn a_claimed_version_is_on_file() {
        let marker = marker("claim");
        assert!(claim(&marker, "1.0.63", NOON));
        assert!(!claim(&marker, "1.0.63", NOON + 60));
        assert!(claim(&marker, "1.0.63", NOON + RETRY_AFTER_SECS));
        assert!(!claim(&marker, "1.0.63", NOON + RETRY_AFTER_SECS + 60));
        assert!(claim(&marker, "1.0.64", NOON + RETRY_AFTER_SECS + 60));
    }

    #[test]
    fn a_released_version_is_tried_at_the_next_start() {
        let marker = marker("release");
        assert!(claim(&marker, "1.0.63", NOON));
        release(&marker);
        assert!(claim(&marker, "1.0.63", NOON + 60));
        assert!(!claim(&marker, "1.0.63", NOON + 120));
    }

    #[test]
    fn a_relaunch_note_counts_once_and_only_while_fresh() {
        let note = marker("relaunch");
        assert!(!take_relaunch_note(&note, NOON));
        note_relaunch(&note, NOON);
        assert!(take_relaunch_note(&note, NOON + 30));
        assert!(!take_relaunch_note(&note, NOON + 31));

        note_relaunch(&note, NOON);
        assert!(!take_relaunch_note(&note, NOON + RELAUNCH_NOTE_SECS));
        assert!(!note.exists());

        // A clock that was set back, or a note that is not a time.
        note_relaunch(&note, NOON + 60);
        assert!(!take_relaunch_note(&note, NOON));
        std::fs::write(&note, "soon").unwrap();
        assert!(!take_relaunch_note(&note, NOON));
    }

    #[test]
    fn a_version_that_cannot_be_written_is_not_claimed() {
        let marker = marker("blocked");
        // The marker's folder is a file here, so nothing can be written in it.
        let dir = marker.parent().unwrap();
        std::fs::create_dir_all(dir.parent().unwrap()).unwrap();
        std::fs::write(dir, "").unwrap();
        assert!(!claim(&marker, "1.0.63", NOON));
    }
}
