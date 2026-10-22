// VibeTV Control Center shell for Windows.
//
// Mirrors macos/VibeTVControlCenter/main.swift: one tray icon, one WebView2
// window on the local Companion, the Companion registered as a per-user
// Scheduled Task, updates driven from the Companion's Updates tab. No
// provider or device logic and no state of its own live here; everything the
// shell needs to know it asks the Companion.
#![cfg_attr(windows, windows_subsystem = "windows")]

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Condvar, Mutex};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, Instant};

use serde::Deserialize;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_updater::UpdaterExt;
use url::Url;

mod launch_update;

const WINDOW_LABEL: &str = "main";
const DEFAULT_RUNTIME_ORIGIN: &str = "http://127.0.0.1:47832";
const RUNTIME_LABEL: &str = "shop.vibetv.control-center.runtime";
const LAST_GOOD_MAX_AGE: &str = "168h";
const RUNTIME_INITIAL_HEALTH_TIMEOUT: Duration = Duration::from_secs(8);
const RUNTIME_HEALTH_TIMEOUT: Duration = Duration::from_secs(35);
const RUNTIME_HEALTH_POLL: Duration = Duration::from_millis(500);
const RUNTIME_HEALTH_REQUEST_TIMEOUT: Duration = Duration::from_secs(5);
const WINDOW_CLOSE_FLUSH_DELAY: Duration = Duration::from_secs(1);
// Without an answer from the update source the start goes on after this limit.
const LAUNCH_UPDATE_CHECK_LIMIT: Duration = Duration::from_secs(5);
// The start waits for the download of a found update, so that has limits
// too: this long in all (the installer is about 14 MB), and this long
// without a single byte. After either the start goes on without the update.
const LAUNCH_UPDATE_DOWNLOAD_LIMIT: Duration = Duration::from_secs(180);
const LAUNCH_UPDATE_STALL_LIMIT: Duration = Duration::from_secs(20);
const LAUNCH_UPDATE_MARKER: &str = "launch-update-attempt.txt";
// While the app runs it looks for its update this often, like the Companion's
// own release check, and installs it only with the window closed.
const IDLE_UPDATE_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);
// An update installed with the window closed relaunches the app with this
// argument and this note, and the app comes back in the tray only.
const AFTER_IDLE_UPDATE_ARG: &str = "--after-idle-update";
const IDLE_UPDATE_RELAUNCH_MARKER: &str = "idle-update-relaunch.txt";

const MENU_OPEN: &str = "open";
const MENU_RELOAD: &str = "reload";
const MENU_UPDATES: &str = "updates";
const MENU_QUIT: &str = "quit";

// Build number: the CI run number, "0" for local builds. Version comes from
// Cargo.toml / tauri.conf.json.
const BUILD: &str = match option_env!("VIBETV_BUILD") {
    Some(build) => build,
    None => "0",
};

struct Shell {
    runtime_origin: Mutex<Url>,
    pending_theme: Mutex<Option<String>>,
    preparing: Mutex<bool>,
    // Bumped on every present; a delayed hide only applies if nothing
    // presented the window again while it waited.
    presentations: AtomicU64,
    // One updater at a time: the check at launch, the tray item and
    // vibetv://check-for-updates must not launch two NSIS installers over
    // the same files.
    updater: Mutex<Updater>,
    // Whether Windows gave us Ctrl+Alt+Shift+P; a window created again after
    // a close needs it for its user agent.
    provider_shortcut: AtomicBool,
    // The presentation count + 1 at which hide_after_flush released the
    // window; 0 when no release is under way.
    released_at: AtomicU64,
    window_creation: Mutex<()>,
    // Set once setup stored the shortcut registration result. ensure_window
    // waits for it: a second launch can reach ensure_window before setup.
    shortcut_registered: Mutex<bool>,
    // Counts the windows built; the Destroyed handler tells a replacement
    // that a present already built from the window that is going away.
    windows_created: AtomicU64,
    // Raised when a window the runtime reported as built turns out to be
    // missing (ensure_live_window). Tauri keeps such a label for the whole
    // run, so the next window is built under a new one.
    window_generation: AtomicU64,
    // Where the window was when a close released it; the next window goes
    // there. Process lifetime only.
    // Stored with the number of the event that took it; see store_if_newer.
    window_geometry: Mutex<Option<(u64, Remembered)>>,
    // Numbers the geometry snapshots in event order.
    geometry_seq: AtomicU64,
    // Closes requested and not cancelled by a present. The startup load
    // compares it to tell that the customer closed the window while the
    // update check ran.
    closes: AtomicU64,
    shortcut_registered_changed: Condvar,
}

// Who holds the updater, in one lock so a click or an opened window can
// never fall between two pieces of it.
#[derive(Clone, Copy, PartialEq)]
enum Updater {
    Free,
    // At launch, or the customer's own run.
    Busy,
    // The check with the window closed. A click on Update or the tray item
    // meanwhile is noted in `asked`, an opened window in `presented`.
    Idle { asked: bool, presented: bool },
    // That check has decided to install with the window closed; the
    // installer starts now and the app is to come back in the tray. A click
    // meanwhile is kept in `asked` in case the installer fails.
    IdleInstalling { asked: bool },
}

// Takes the updater for `run`; false while it is held. A click while the
// check with the window closed holds it is noted for that check.
fn take_updater(app: &AppHandle, run: UpdateRun) -> bool {
    let shell = app.state::<Shell>();
    let mut updater = shell.updater.lock().unwrap();
    match *updater {
        Updater::Free => {
            *updater = if run == UpdateRun::Idle {
                Updater::Idle { asked: false, presented: false }
            } else {
                Updater::Busy
            };
            true
        }
        Updater::Idle { presented, .. } if run == UpdateRun::Asked => {
            *updater = Updater::Idle { asked: true, presented };
            log("update requested during the check with the window closed; it takes the request over");
            false
        }
        Updater::IdleInstalling { .. } if run == UpdateRun::Asked => {
            *updater = Updater::IdleInstalling { asked: true };
            // The customer asked for the update: if the installer succeeds,
            // the app must come back with its window, as after a present.
            if let Ok(folder) = app.path().app_local_data_dir() {
                launch_update::release(&folder.join(IDLE_UPDATE_RELAUNCH_MARKER));
            }
            log("update requested while the installer starts; the app comes back with its window");
            false
        }
        _ => false,
    }
}

// Frees the updater; true when a click came during the check with the window
// closed and was not used by an install.
fn free_updater(app: &AppHandle) -> bool {
    let shell = app.state::<Shell>();
    let mut updater = shell.updater.lock().unwrap();
    let asked = matches!(*updater, Updater::Idle { asked: true, .. });
    *updater = Updater::Free;
    asked
}

enum IdleDecision {
    // A click came meanwhile: the customer's install, the window comes back.
    Asked,
    // The window was opened: nothing is installed.
    InUse,
    // Install with the window closed; the relaunch note is on file.
    Hidden,
}

// The last word of the check with the window closed, under the same lock as
// `present_window`: a window opened before it stops the install, one opened
// after it removes the relaunch note so the app comes back with its window.
// Visibility is read before the lock: Tauri asks the main thread, where a
// tray click may be waiting for this lock in `present_window`. A window opened
// after that read is caught by `presented`.
fn decide_idle_install(app: &AppHandle, note: Option<&Path>) -> IdleDecision {
    let visible = window_in_use(app);
    let shell = app.state::<Shell>();
    let mut updater = shell.updater.lock().unwrap();
    match *updater {
        Updater::Idle { asked: true, .. } => {
            *updater = Updater::Busy;
            IdleDecision::Asked
        }
        Updater::Idle { presented: true, .. } => IdleDecision::InUse,
        _ if visible => IdleDecision::InUse,
        _ => {
            if let Some(note) = note {
                launch_update::note_relaunch(note, unix_now());
            }
            *updater = Updater::IdleInstalling { asked: false };
            IdleDecision::Hidden
        }
    }
}

fn main() {
    tauri::Builder::default()
        // A second launch (autostart plus Start menu, or the updater's
        // relaunch) brings the existing window forward instead of starting a
        // second shell that would fight over the same Companion.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            present_window(app);
            if args.len() == 2 && queue_install_link(app, args.get(1).map(String::as_str)) {
                let handle = app.clone();
                std::thread::spawn(move || {
                    if !navigate_to_pending_theme(&handle, true) {
                        prepare_and_load(handle);
                    }
                });
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .app_name("VibeTV Control Center")
                .build(),
        )
        .manage(Shell {
            runtime_origin: Mutex::new(Url::parse(DEFAULT_RUNTIME_ORIGIN).expect("static origin")),
            pending_theme: Mutex::new(None),
            // The update at launch owns the start until it has ended.
            preparing: Mutex::new(true),
            presentations: AtomicU64::new(0),
            updater: Mutex::new(Updater::Free),
            provider_shortcut: AtomicBool::new(false),
            released_at: AtomicU64::new(0),
            window_creation: Mutex::new(()),
            shortcut_registered: Mutex::new(false),
            windows_created: AtomicU64::new(0),
            window_generation: AtomicU64::new(0),
            window_geometry: Mutex::new(None),
            geometry_seq: AtomicU64::new(0),
            closes: AtomicU64::new(0),
            shortcut_registered_changed: Condvar::new(),
        })
        .setup(|app| {
            let handle = app.handle().clone();
            configure_tray(&handle)?;
            if let Err(error) = handle.autolaunch().enable() {
                log(&format!("could not enable autostart: {error}"));
            }
            let visible = !relaunched_after_idle_update(&handle);
            {
                // A second launch during startup recreates the window through
                // ensure_window, which waits for this result instead of
                // building the window with "ProviderShortcut/unavailable".
                let shell = handle.state::<Shell>();
                let provider_shortcut = register_provider_shortcut(handle.clone());
                shell.provider_shortcut.store(provider_shortcut, Ordering::SeqCst);
                *shell.shortcut_registered.lock().unwrap() = true;
                shell.shortcut_registered_changed.notify_all();
            }
            // Back from an update installed with the window closed: stay in
            // the tray without a WebView2; opening the app creates the window.
            // Through ensure_window: a second launch that arrives during
            // startup goes the same check-and-create way, so only one window
            // is built.
            // Sampled before the window exists, so no close can be missed.
            let closes_before = handle.state::<Shell>().closes.load(Ordering::SeqCst);
            if visible {
                ensure_window(&handle);
            }
            let args: Vec<_> = std::env::args_os().collect();
            if args.len() == 2 {
                queue_install_link(&handle, args[1].to_str());
            }
            std::thread::spawn(move || {
                launch_update_check(&handle);
                *handle.state::<Shell>().preparing.lock().unwrap() = false;
                // Closed while the update check ran: it stays closed until the
                // tray opens it, as after any close.
                let closed_meanwhile =
                    handle.state::<Shell>().closes.load(Ordering::SeqCst) != closes_before;
                load(handle.clone(), visible && !closed_meanwhile);
                loop {
                    std::thread::sleep(IDLE_UPDATE_INTERVAL);
                    idle_update_check(&handle);
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("VibeTV Control Center could not build its shell")
        .run(|_app, event| {
            // Closing the window must not end the app: the tray keeps the
            // Control Center reachable, like the Mac App.
            if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
                if code.is_none() {
                    api.prevent_exit();
                }
            }
        });
}

fn log(message: &str) {
    eprintln!("VibeTV Control Center: {message}");
}

fn version(app: &AppHandle) -> String {
    app.package_info().version.to_string()
}

// The suffix tells Settings that Ctrl+Alt+Shift+P is not available.
fn user_agent(app: &AppHandle, provider_shortcut: bool) -> String {
    let suffix = if provider_shortcut { "" } else { " ProviderShortcut/unavailable" };
    format!("VibeTVControlCenter/{}+{}{suffix}", version(app), BUILD)
}

fn companion_path(app: &AppHandle) -> PathBuf {
    let exe = std::env::current_exe().unwrap_or_default();
    let dir = exe.parent().map(PathBuf::from).unwrap_or_default();
    let _ = app;
    dir.join("codexbar-display.exe")
}

// Sidecar calls must not flash a console window.
fn companion_command(app: &AppHandle, args: &[&str]) -> Command {
    let mut command = Command::new(companion_path(app));
    command.args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW);
    }
    command
}

fn run_companion(app: &AppHandle, args: &[&str]) -> Result<String, String> {
    let output = companion_command(app, args)
        .output()
        .map_err(|error| format!("could not run codexbar-display {}: {error}", args.join(" ")))?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if output.status.success() {
        return Ok(stdout);
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(format!(
        "codexbar-display {} failed ({}): {}",
        args.join(" "),
        output.status,
        if stderr.is_empty() { stdout } else { stderr }
    ))
}

fn configure_tray(app: &AppHandle) -> tauri::Result<()> {
    let menu = Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, MENU_OPEN, "Open VibeTV Control Center", true, None::<&str>)?,
            &MenuItem::with_id(app, MENU_RELOAD, "Reload Control Center", true, None::<&str>)?,
            &MenuItem::with_id(app, MENU_UPDATES, "Check for Updates…", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, MENU_QUIT, "Quit VibeTV Control Center", true, None::<&str>)?,
        ],
    )?;
    let tray = app
        .tray_by_id("main")
        .ok_or_else(|| tauri::Error::AssetNotFound("tray icon".into()))?;
    tray.set_menu(Some(menu))?;
    tray.on_menu_event(|app, event| match event.id().as_ref() {
        MENU_OPEN => present_window(app),
        MENU_RELOAD => {
            // While the runtime UI has not loaded yet (startup timed out or
            // failed transiently), reloading the bootstrap page would only
            // show the starting screen again; rerun the preparation instead.
            // The bootstrap page lives on Tauri's own origin
            // (http://tauri.localhost), the runtime UI on the Companion's.
            let runtime_origin = app.state::<Shell>().runtime_origin.lock().unwrap().clone();
            let runtime_loaded = main_window(app)
                .and_then(|window| window.url().ok())
                .map(|url| url.origin() == runtime_origin.origin())
                .unwrap_or(false);
            if runtime_loaded {
                if let Some(window) = main_window(app) {
                    let _ = window.reload();
                }
                present_window(app);
            } else {
                let handle = app.clone();
                std::thread::spawn(move || prepare_and_load(handle));
            }
        }
        MENU_UPDATES => check_for_updates(app.clone()),
        MENU_QUIT => app.exit(0),
        _ => {}
    });
    tray.on_tray_icon_event(|tray, event| {
        if let TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
        } = event
        {
            present_window(tray.app_handle());
        }
    });
    Ok(())
}

// The first window is "main"; after a failed build the next ones get a new
// label, because Tauri keeps the label of a window that never existed.
fn label_for_generation(generation: u64) -> String {
    if generation == 0 {
        WINDOW_LABEL.to_string()
    } else {
        format!("{WINDOW_LABEL}-{generation}")
    }
}

fn main_label(app: &AppHandle) -> String {
    label_for_generation(app.state::<Shell>().window_generation.load(Ordering::SeqCst))
}

fn main_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    app.get_webview_window(&main_label(app))
}

// Physical pixels, as Tauri reports them.
#[derive(Clone, Copy, Debug, PartialEq)]
struct WindowRect {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

// Where the window was when a close released it, and whether it was maximized.
// The rectangle is the outer one (caption and borders included). While
// maximized, it is the last normal one (Tauri only reports the maximized
// bounds); None when the window was never restored.
type Remembered = (Option<WindowRect>, bool);

#[derive(Debug, PartialEq)]
enum Placement {
    // First start: 1280x900, centred.
    Default,
    Remembered { rect: Option<WindowRect>, maximized: bool },
}

// The window's minimum inner size in logical pixels (create_window).
const MIN_INNER: (f64, f64) = (960.0, 640.0);

// A monitor's work area, and the window's minimum size on it in physical pixels.
type Screen = (WindowRect, (u32, u32));

fn choose_placement(remembered: Option<Remembered>, screens: &[Screen]) -> Placement {
    match remembered {
        // Fully visible across all monitors: kept as it was, even over two monitors.
        Some((Some(rect), maximized)) if fully_visible(rect, screens) => {
            Placement::Remembered { rect: Some(rect), maximized }
        }
        // Partly out of reach: pulled inside the work area of its centre, so a
        // taskbar cannot hide its lower edge.
        Some((Some(rect), maximized)) => match work_area_of_centre(rect, screens) {
            Some((area, min)) => {
                Placement::Remembered { rect: Some(fit_into(rect, area, min)), maximized }
            }
            None => Placement::Default,
        },
        // Maximized, never restored: maximize again at the default size.
        Some((None, true)) => Placement::Remembered { rect: None, maximized: true },
        // Nothing remembered, or the window was on a monitor that is gone.
        _ => Placement::Default,
    }
}

// The rectangle and maximized state to keep for a window being released.
fn remembered_for(current: WindowRect, maximized: bool, previous: Option<Remembered>) -> Remembered {
    if maximized {
        (previous.and_then(|(rect, _)| rect), true)
    } else {
        (Some(current), false)
    }
}

// The centre must lie on a monitor, so the window cannot open out of reach.
fn work_area_of_centre(rect: WindowRect, screens: &[Screen]) -> Option<Screen> {
    let cx = i64::from(rect.x) + i64::from(rect.width) / 2;
    let cy = i64::from(rect.y) + i64::from(rect.height) / 2;
    screens.iter().copied().find(|(area, _)| {
        let (left, top) = (i64::from(area.x), i64::from(area.y));
        cx >= left
            && cx < left + i64::from(area.width)
            && cy >= top
            && cy < top + i64::from(area.height)
    })
}

// Work areas do not overlap, so their overlaps add up to the rectangle's area
// only when no part of it lies outside all of them.
fn fully_visible(rect: WindowRect, screens: &[Screen]) -> bool {
    let visible: i64 = screens.iter().map(|(area, _)| overlap_area(rect, *area)).sum();
    visible == i64::from(rect.width) * i64::from(rect.height)
}

fn overlap_area(a: WindowRect, b: WindowRect) -> i64 {
    let width = (i64::from(a.x) + i64::from(a.width)).min(i64::from(b.x) + i64::from(b.width))
        - i64::from(a.x).max(i64::from(b.x));
    let height = (i64::from(a.y) + i64::from(a.height)).min(i64::from(b.y) + i64::from(b.height))
        - i64::from(a.y).max(i64::from(b.y));
    width.max(0) * height.max(0)
}

// Shrinks the rectangle if it is larger than the area, then moves it inside.
// Never smaller than the minimum: in an area smaller than that, the top-left
// corner stays inside the area, so the title bar is still reachable.
fn fit_into(rect: WindowRect, area: WindowRect, min: (u32, u32)) -> WindowRect {
    let width = rect.width.min(area.width).max(min.0);
    let height = rect.height.min(area.height).max(min.1);
    let x = keep_inside(rect.x, area.x, area.width, width);
    let y = keep_inside(rect.y, area.y, area.height, height);
    WindowRect { x, y, width, height }
}

// Keeps a window start inside the area, but never before the area's start.
fn keep_inside(start: i32, area_start: i32, area_size: u32, size: u32) -> i32 {
    let last = (i64::from(area_start) + i64::from(area_size) - i64::from(size))
        .max(i64::from(area_start));
    i64::from(start).clamp(i64::from(area_start), last) as i32
}

fn min_size_px(scale: f64) -> (u32, u32) {
    ((MIN_INNER.0 * scale).ceil() as u32, (MIN_INNER.1 * scale).ceil() as u32)
}

// The client size for an outer rectangle, given the caption and borders
// (outer size minus inner size, as Tauri reports them).
fn inner_within(outer: WindowRect, frame: (u32, u32)) -> (u32, u32) {
    (outer.width.saturating_sub(frame.0), outer.height.saturating_sub(frame.1))
}

// None while minimized, because its position says nothing about where it was
// used; None means "keep the previous one".
fn remembered_after(
    current: WindowRect,
    reported: WindowRect,
    minimized: bool,
    maximized: bool,
    previous: Option<Remembered>,
) -> Option<Remembered> {
    if minimized {
        return None;
    }
    // The event reported another rectangle than the window has now, and the
    // window is maximized: it was maximized after the event, so the reported
    // one is the last normal place.
    if maximized && reported != current {
        return Some((Some(reported), true));
    }
    Some(remembered_for(current, maximized, previous))
}

// What a Moved or Resized event reported, in physical pixels.
#[derive(Clone, Copy)]
enum Change {
    Moved(tauri::PhysicalPosition<i32>),
    Resized(tauri::PhysicalSize<u32>),
}

// The window as the event saw it: Moved gives the outer position, Resized the
// inner size, which the frame (outer minus inner size) turns into the outer one.
fn reported_rect(change: Option<Change>, current: WindowRect, frame: (u32, u32)) -> WindowRect {
    match change {
        None => current,
        Some(Change::Moved(position)) => WindowRect { x: position.x, y: position.y, ..current },
        Some(Change::Resized(size)) => WindowRect {
            width: size.width + frame.0,
            height: size.height + frame.1,
            ..current
        },
    }
}

// Worker threads only: the getters wait for the event loop. The outer
// rectangle is stored, so the clamp sees the caption and borders too.
fn window_geometry(
    window: &tauri::WebviewWindow,
    change: Option<Change>,
    previous: Option<Remembered>,
) -> Option<Remembered> {
    let minimized = window.is_minimized().ok()?;
    let position = window.outer_position().ok()?;
    let size = window.outer_size().ok()?;
    let maximized = window.is_maximized().ok()?;
    let current = WindowRect {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    };
    let inner = window.inner_size().ok()?;
    let frame = (size.width.saturating_sub(inner.width), size.height.saturating_sub(inner.height));
    let reported = reported_rect(change, current, frame);
    remembered_after(current, reported, minimized, maximized, previous)
}

// The workers run unordered, so a snapshot of an older event must not replace
// a newer one.
fn store_if_newer(slot: &mut Option<(u64, Remembered)>, seq: u64, geometry: Remembered) {
    if slot.is_some_and(|(stored, _)| seq < stored) {
        return;
    }
    *slot = Some((seq, geometry));
}

// Worker threads only. Called on every move and resize, so a close while the
// window is maximized still has the last normal place (Tauri reports only the
// maximized bounds then).
fn remember_window_geometry(
    app: &AppHandle,
    window: &tauri::WebviewWindow,
    change: Option<Change>,
    seq: u64,
) {
    let shell = app.state::<Shell>();
    let previous = shell.window_geometry.lock().unwrap().map(|(_, geometry)| geometry);
    if let Some(geometry) = window_geometry(window, change, previous) {
        store_if_newer(&mut shell.window_geometry.lock().unwrap(), seq, geometry);
    }
}

// Worker threads only (it asks for the monitors). The monitors are asked
// only after a release, so the first start never waits for the event loop.
fn placement_for(app: &AppHandle) -> Placement {
    let Some((_, remembered)) = *app.state::<Shell>().window_geometry.lock().unwrap() else {
        return Placement::Default;
    };
    let screens: Vec<Screen> = app
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|monitor| {
            let area = monitor.work_area();
            let rect = WindowRect {
                x: area.position.x,
                y: area.position.y,
                width: area.size.width,
                height: area.size.height,
            };
            (rect, min_size_px(monitor.scale_factor()))
        })
        .collect();
    choose_placement(Some(remembered), &screens)
}

fn create_window(app: &AppHandle, provider_shortcut: bool, visible: bool) -> tauri::Result<()> {
    let actions = app.clone();
    let remembered = match placement_for(app) {
        Placement::Remembered { rect, maximized } => Some((rect, maximized)),
        Placement::Default => None,
    };
    let window = WebviewWindowBuilder::new(app, main_label(app), WebviewUrl::App("index.html".into()))
        .title("VibeTV Control Center")
        // A remembered place is set while the window is still hidden, so it
        // does not jump from the default place.
        .visible(visible && remembered.is_none())
        .inner_size(1280.0, 900.0)
        .min_inner_size(MIN_INNER.0, MIN_INNER.1)
        // Issue #548: 1280x900 plus the title bar is taller than the space
        // above the taskbar on a 1080p screen scaled to 125 % or more, and
        // Windows chose the position. Tauri shrinks the window to the
        // primary monitor's work area and centres it there.
        .prevent_overflow()
        .center()
        .user_agent(&user_agent(app, provider_shortcut))
        // vibetv:// links are the UI's way of asking the shell for something;
        // handled here, so WebView2 never looks for a protocol handler.
        .on_navigation(move |url| {
            if url.scheme() != "vibetv" {
                return true;
            }
            let app = actions.clone();
            let url = url.clone();
            std::thread::spawn(move || handle_native_action(&app, &url));
            false
        })
        .on_page_load(|window, payload| {
            if payload.event() == PageLoadEvent::Finished {
                let app = window.app_handle().clone();
                let url = payload.url().clone();
                std::thread::spawn(move || acknowledge_loaded_theme(app, url));
            }
        })
        .build()?;
    if let Some((rect, maximized)) = remembered {
        if let Some(rect) = rect {
            // Moved first: a monitor with another scale resizes the window when it
            // arrives, so the frame is measured and the size set where it stays.
            let _ = window.set_position(PhysicalPosition::new(rect.x, rect.y));
            let frame = match (window.outer_size(), window.inner_size()) {
                (Ok(outer), Ok(inner)) => (outer.width - inner.width, outer.height - inner.height),
                _ => (0, 0),
            };
            let (width, height) = inner_within(rect, frame);
            let _ = window.set_size(PhysicalSize::new(width, height));
        }
        if maximized {
            let _ = window.maximize();
        }
        if visible {
            let _ = window.show();
        }
    }
    app.state::<Shell>().windows_created.fetch_add(1, Ordering::SeqCst);
    let handle = app.clone();
    let tracked = window.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            hide_after_flush(&handle);
        }
        WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
            let change = match event {
                WindowEvent::Moved(position) => Change::Moved(*position),
                WindowEvent::Resized(size) => Change::Resized(*size),
                _ => unreachable!(),
            };
            let handle = handle.clone();
            let window = tracked.clone();
            // Numbered here, in event order, before the worker starts.
            let seq = handle.state::<Shell>().geometry_seq.fetch_add(1, Ordering::SeqCst) + 1;
            std::thread::spawn(move || remember_window_geometry(&handle, &window, Some(change), seq));
        }
        // A present that came between hide_after_flush's check and the
        // destroy showed the old window just before it went away: create it
        // again. Only our own release sets `released_at`; quitting does not.
        WindowEvent::Destroyed => {
            let shell = handle.state::<Shell>();
            let released_at = shell.released_at.swap(0, Ordering::SeqCst);
            if released_at != 0 {
                let created_before = shell.windows_created.load(Ordering::SeqCst);
                let handle = handle.clone();
                std::thread::spawn(move || {
                    // Tauri drops the label only after the Destroyed
                    // listeners ran; until then ensure_window would find the
                    // dying window and create nothing, and a present would
                    // show it. Compare only once the label is gone: a present
                    // after that creates its own window.
                    for _ in 0..40 {
                        if main_window(&handle).is_none() {
                            break;
                        }
                        std::thread::sleep(Duration::from_millis(25));
                    }
                    let shell = handle.state::<Shell>();
                    let presented = shell.presentations.load(Ordering::SeqCst);
                    // A present that already built a replacement loads it
                    // itself; loading again could leave a theme page.
                    let replaced = shell.windows_created.load(Ordering::SeqCst) != created_before;
                    if presented + 1 != released_at && !replaced {
                        prepare_and_load(handle);
                    }
                });
            }
        }
        _ => {}
    });
    Ok(())
}

fn present_window(app: &AppHandle) {
    let shell = app.state::<Shell>();
    shell.presentations.fetch_add(1, Ordering::SeqCst);
    {
        // The update check with the window closed must hear of it.
        let mut updater = shell.updater.lock().unwrap();
        match *updater {
            Updater::Idle { asked, .. } => *updater = Updater::Idle { asked, presented: true },
            Updater::IdleInstalling { .. } => {
                // Too late to stop the installer: the app comes back with
                // its window instead.
                if let Ok(folder) = app.path().app_local_data_dir() {
                    launch_update::release(&folder.join(IDLE_UPDATE_RELAUNCH_MARKER));
                }
            }
            _ => {}
        }
    }
    match main_window(app) {
        Some(window) => {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
        // Closed earlier and released (hide_after_flush). Building a WebView2
        // window from an event handler can deadlock, so a thread builds it and
        // loads the Control Center as a start does.
        None => {
            let handle = app.clone();
            std::thread::spawn(move || {
                prepare_and_load(handle);
            });
        }
    }
}

// Creates the window again when a close released it. Never call this on the
// event-loop thread (see present_window).
fn ensure_window(app: &AppHandle) -> bool {
    // One check-and-create at a time: two presents (a theme link reaches a
    // tray-only app as a second launch and as a queued link) would otherwise
    // both see no window and build two "main" windows.
    let shell = app.state::<Shell>();
    {
        // The window's user agent says whether the shortcut works; build it
        // only once setup knows. Bounded: a registration that never reports
        // must not keep the window away.
        let registered = shell.shortcut_registered.lock().unwrap();
        let _ = shell
            .shortcut_registered_changed
            .wait_timeout_while(registered, Duration::from_secs(5), |done| !*done)
            .unwrap();
    }
    let _creating = shell.window_creation.lock().unwrap();
    if main_window(app).is_some() {
        return true;
    }
    let provider_shortcut = app.state::<Shell>().provider_shortcut.load(Ordering::SeqCst);
    match create_window(app, provider_shortcut, true) {
        Ok(()) => true,
        Err(error) => {
            log(&format!("could not create the window again: {error}"));
            false
        }
    }
}

// Worker threads only: is_visible waits for the event loop. create_window
// reports success once Tauri has queued the build; a build that then fails on
// the event loop leaves no window, so the check is whether one answers.
// After a miss the next attempt uses a new label (see label_for_generation).
fn ensure_live_window(app: &AppHandle) -> bool {
    for _ in 0..2 {
        if !ensure_window(app) {
            return false;
        }
        // Check and switch under the creation lock: a build in flight either
        // finished (and is found here) or has not started (it takes the new
        // label). The event loop never takes this lock.
        let shell = app.state::<Shell>();
        let _creating = shell.window_creation.lock().unwrap();
        let generation = shell.window_generation.load(Ordering::SeqCst);
        let live = app
            .get_webview_window(&label_for_generation(generation))
            .is_some_and(|window| window.is_visible().is_ok());
        if live {
            return true;
        }
        // Only the generation that was checked moves on. A concurrent worker
        // that checked the same failed window has moved it already.
        if shell
            .window_generation
            .compare_exchange(generation, generation + 1, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
        {
            log("the main window was not built; the next attempt uses a new window");
        }
    }
    false
}

fn theme_id_from_deep_link(raw: &str) -> Option<&str> {
    // Check the original argument; URL parsing would erase dot segments first.
    let theme_id = raw.strip_prefix("vibetv://install-theme/")?;
    if !(3..=64).contains(&theme_id.len())
        || !theme_id.split('-').all(|part| {
            !part.is_empty()
                && part
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
        })
    {
        return None;
    }
    Some(theme_id)
}

fn queue_install_link(app: &AppHandle, raw: Option<&str>) -> bool {
    let Some(theme_id) = raw.and_then(theme_id_from_deep_link) else {
        return false;
    };
    *app.state::<Shell>().pending_theme.lock().unwrap() = Some(theme_id.to_string());
    present_window(app);
    true
}

// `link_just_opened`: the customer opened the link while the app was running.
// After `prepare_and_load` the same page is still loading and the page-load
// event clears the queue once the runtime is healthy.
fn navigate_to_pending_theme(app: &AppHandle, link_just_opened: bool) -> bool {
    let shell = app.state::<Shell>();
    if *shell.preparing.lock().unwrap() {
        return false;
    }
    let origin = shell.runtime_origin.lock().unwrap().clone();
    if !runtime_ready(app, &origin) {
        return false;
    }
    let Some(window) = main_window(app) else {
        return false;
    };
    if !window
        .url()
        .map(|url| url.origin() == origin.origin())
        .unwrap_or(false)
    {
        return false;
    }
    let mut pending = shell.pending_theme.lock().unwrap();
    let Some(theme_id) = pending.as_ref() else {
        return false;
    };
    let target = origin.join(&format!("/control-center/install/{theme_id}")).expect("validated theme ID");
    if window.url().map(|url| url == target).unwrap_or(false) {
        // Already on that theme's page: nothing loads, so no page-load event
        // would clear the queue, and a later runtime repair would send the
        // customer back to this theme.
        if link_just_opened {
            clear_loaded_theme(&mut pending, &target, &origin, true);
        }
        return true;
    }
    window.navigate(target).is_ok()
}

fn clear_loaded_theme(pending: &mut Option<String>, loaded: &Url, origin: &Url, healthy: bool) -> bool {
    let Some(theme_id) = pending.as_ref() else {
        return false;
    };
    if !healthy || loaded != &origin.join(&format!("/control-center/install/{theme_id}")).expect("validated theme ID") {
        return false;
    }
    pending.take();
    true
}

fn acknowledge_loaded_theme(app: AppHandle, loaded: Url) {
    let shell = app.state::<Shell>();
    let origin = shell.runtime_origin.lock().unwrap().clone();
    let pending = shell.pending_theme.lock().unwrap().clone();
    let Some(theme_id) = pending else {
        return;
    };
    if loaded != origin.join(&format!("/control-center/install/{theme_id}")).expect("validated theme ID") {
        return;
    }
    if !runtime_ready(&app, &origin) {
        prepare_and_load(app);
        return;
    }
    let mut pending = shell.pending_theme.lock().unwrap();
    clear_loaded_theme(&mut pending, &loaded, &origin, true);
}

// Theme Studio saves unsaved work on this event; give it a moment, then
// release the window. Like the Mac App, a closed Control Center keeps no
// WebView2 (its processes hold 100+ MB and the page would keep polling);
// opening it from the tray creates the window again.
fn hide_after_flush(app: &AppHandle) {
    let Some(window) = main_window(app) else {
        return;
    };
    let handle = app.clone();
    // Counted at the request, not at the release: a startup load that ends
    // during the flush delay must already see the window as closed. The
    // count goes back when a present cancels the close below.
    handle.state::<Shell>().closes.fetch_add(1, Ordering::SeqCst);
    let _ = window.eval("window.dispatchEvent(new Event('vibetv:native-window-will-close'))");
    let presented = handle.state::<Shell>().presentations.load(Ordering::SeqCst);
    std::thread::spawn(move || {
        std::thread::sleep(WINDOW_CLOSE_FLUSH_DELAY);
        let shell = handle.state::<Shell>();
        let presented_now = shell.presentations.load(Ordering::SeqCst);
        if close_stands(presented, presented_now) {
            // Kept for the window built next; a minimized one keeps the last.
            let seq = shell.geometry_seq.fetch_add(1, Ordering::SeqCst) + 1;
            remember_window_geometry(&handle, &window, None, seq);
            // Stored as count + 1, so a release before the first present
            // (count 0) is still told apart from "no release".
            shell.released_at.store(presented + 1, Ordering::SeqCst);
            let _ = window.destroy();
        } else {
            // Reopened from the tray or a second launch meanwhile: keep it open.
            shell.closes.fetch_sub(1, Ordering::SeqCst);
        }
    });
}

// A close stands only when nothing presented the window since it was requested.
fn close_stands(presented_at_request: u64, presented_after_flush: u64) -> bool {
    presented_at_request == presented_after_flush
}

// Issue #424: Ctrl+Alt+Shift+P shows the next provider on VibeTV from any app.
// Windows delivers WM_HOTKEY to the thread that registered the hot key, so
// that thread keeps a message loop of its own. Returns false when Windows
// refused the keys, which it does while another app holds them.
fn register_provider_shortcut(app: AppHandle) -> bool {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
            MOD_ALT, MOD_CONTROL, MOD_NOREPEAT, MOD_SHIFT, RegisterHotKey,
        };
        use windows_sys::Win32::UI::WindowsAndMessaging::{GetMessageW, MSG, WM_HOTKEY};
        let (report, registered) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            // SAFETY: no window handle and no pointer is passed; 0x50 is the P key.
            let ok = unsafe {
                RegisterHotKey(
                    std::ptr::null_mut(),
                    1,
                    MOD_CONTROL | MOD_ALT | MOD_SHIFT | MOD_NOREPEAT,
                    0x50,
                )
            } != 0;
            let _ = report.send(ok);
            if !ok {
                return;
            }
            // SAFETY: MSG is plain data and GetMessageW fills it in.
            let mut message: MSG = unsafe { std::mem::zeroed() };
            while unsafe { GetMessageW(&mut message, std::ptr::null_mut(), 0, 0) } > 0 {
                if message.message == WM_HOTKEY {
                    show_next_provider(&app);
                }
            }
        });
        registered.recv().unwrap_or(false)
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        false
    }
}

// Which provider comes next is the Companion's decision; the shell only asks
// for it, and only its own runtime.
#[cfg(windows)]
fn show_next_provider(app: &AppHandle) {
    let origin = app.state::<Shell>().runtime_origin.lock().unwrap().clone();
    let http = runtime_http();
    if !runtime_identity_matches(&http, &origin) {
        log("next provider skipped: the runtime did not answer at its known address");
        return;
    }
    let url = origin.join("/v1/provider-display/next").expect("static path");
    match http
        .post(url.as_str())
        .header("Content-Type", "application/json")
        .send("{}")
    {
        Ok(response) if response.status() == 200 => {
            // An open Settings page shows the display choice; it reads it again.
            if let Some(window) = main_window(app) {
                let _ = window.eval("window.dispatchEvent(new Event('vibetv:provider-display-changed'))");
            }
        }
        Ok(response) => log(&format!("next provider refused: HTTP {}", response.status())),
        Err(error) => log(&format!("next provider request failed: {error}")),
    }
}

fn handle_native_action(app: &AppHandle, url: &Url) {
    match url.host_str().unwrap_or_default() {
        "restart-control-center" => app.restart(),
        "repair-runtime" => {
            let success = prepare_and_load(app.clone());
            dispatch_result(app, "vibetv:runtime-repair-result", success);
        }
        "check-for-updates" => check_for_updates(app.clone()),
        // CodexBar on Windows is a plain console CLI that the Companion
        // daemon runs itself. The usage engine is therefore that daemon:
        // replace its running Scheduled Task instance and only then wait
        // for a healthy runtime, so a stuck or repeatedly failing engine is
        // really restarted instead of merely re-checked.
        "repair-codexbar" => {
            let success = match claim_update_hold() {
                UpdateHold::UpdateRunning => {
                    log("usage service restart deferred: a firmware update or theme install owns the runtime");
                    false
                }
                UpdateHold::Granted | UpdateHold::NoAnswer => {
                    let restarted = restart_runtime(app);
                    if !restarted {
                        // The runtime survived; do not leave updates refused
                        // for the rest of the hold window.
                        release_update_hold();
                    }
                    restarted && prepare_and_load(app.clone())
                }
            };
            dispatch_result(app, "vibetv:codexbar-repair-result", success);
        }
        "finish-codexbar-recovery" => {}
        "open-codexbar" => {
            log("open-codexbar is not available on Windows: the CLI has no window");
        }
        other => log(&format!("ignoring unknown native action {other}")),
    }
}

// `service start` stops a running task instance before starting it again.
// A missing task is not a failure here: prepare_and_load installs it.
fn restart_runtime(app: &AppHandle) -> bool {
    match run_companion(app, &["service", "start", "--label", RUNTIME_LABEL]) {
        Ok(_) => true,
        Err(error) if error.contains("rerun setup") => {
            log(&format!("no runtime task to restart yet: {error}"));
            true
        }
        Err(error) => {
            log(&format!("usage service restart failed: {error}"));
            false
        }
    }
}

enum UpdateHold {
    Granted,
    UpdateRunning,
    NoAnswer,
}

// A firmware update or theme install runs inside the Companion process, so
// restarting it mid-job leaves the device half-written. Asking first and
// stopping second is a race; the Companion therefore offers a claim: from
// this call on it refuses new jobs, and answers 409 when one already owns
// the runtime. Same contract as the Mac App's runtimeClaimUpdateHold. A
// runtime that does not answer at all is not running a job either -- the
// job lives in that process -- so the repair proceeds. Only our own runtime
// can promise anything: runtime-endpoint.json may be stale and its port
// reused by an unrelated listener, whose replies are skipped like the
// health check skips them.
fn claim_update_hold() -> UpdateHold {
    let http = runtime_http();
    for origin in runtime_origin_candidates() {
        if !runtime_identity_matches(&http, &origin) {
            continue;
        }
        let url = origin.join("/v1/runtime-health/update-hold").expect("static path");
        // From here on a live runtime of ours is known to exist. A failed
        // hold request does not mean it is idle -- it may be mid-job -- so a
        // transport error must hold back the restart instead of falling
        // through to NoAnswer.
        let response = match http
            .post(url.as_str())
            .header("Content-Type", "application/json")
            .send("{}")
        {
            Ok(response) => response,
            Err(error) => {
                log(&format!("update hold request failed: {error}"));
                return UpdateHold::UpdateRunning;
            }
        };
        return match response.status().as_u16() {
            409 => UpdateHold::UpdateRunning,
            200..=299 => UpdateHold::Granted,
            // An older runtime without the endpoint cannot promise anything;
            // hold back rather than strand an update, as the Mac App does.
            _ => UpdateHold::UpdateRunning,
        };
    }
    UpdateHold::NoAnswer
}

// True when a VibeTV runtime owned by this shell's task answers at origin.
fn runtime_identity_matches(http: &ureq::Agent, origin: &Url) -> bool {
    let url = origin.join("/v1/runtime-health").expect("static path");
    let Ok(mut response) = http.get(url.as_str()).call() else {
        return false;
    };
    if response.status() != 200 {
        return false;
    }
    let Ok(body) = response.body_mut().read_to_string() else {
        return false;
    };
    serde_json::from_str::<RuntimeHealth>(&body)
        .map(|health| health.companion.runtime.listener_owner == RUNTIME_LABEL)
        .unwrap_or(false)
}

fn runtime_ready(app: &AppHandle, origin: &Url) -> bool {
    run_companion(app, &["version", "--short"])
        .and_then(|expected| check_runtime_health(app, &runtime_http(), origin, &expected))
        .is_ok()
}

fn release_update_hold() {
    let http = runtime_http();
    for origin in runtime_origin_candidates() {
        if !runtime_identity_matches(&http, &origin) {
            continue;
        }
        let url = origin.join("/v1/runtime-health/update-hold").expect("static path");
        let _ = http
            .post(url.as_str())
            .header("Content-Type", "application/json")
            .send(r#"{"release":true}"#);
    }
}

fn runtime_http() -> ureq::Agent {
    ureq::Agent::new_with_config(
        ureq::Agent::config_builder()
            .timeout_global(Some(RUNTIME_HEALTH_REQUEST_TIMEOUT))
            .http_status_as_error(false)
            .build(),
    )
}

fn dispatch_result(app: &AppHandle, event: &str, success: bool) {
    if let Some(window) = main_window(app) {
        let _ = window.eval(format!(
            "window.dispatchEvent(new CustomEvent('{event}', {{ detail: {{ success: {success} }} }}))"
        ));
    }
}

fn show_status(app: &AppHandle, error: Option<&str>) {
    dispatch_status(app, serde_json::json!({ "error": error }));
}

// The start screen names the version while the check at launch installs it.
fn show_updating(app: &AppHandle, version: &str) {
    dispatch_status(app, serde_json::json!({ "update": version }));
}

fn dispatch_status(app: &AppHandle, detail: serde_json::Value) {
    if let Some(window) = main_window(app) {
        let _ = window.eval(format!(
            "window.dispatchEvent(new CustomEvent('vibetv:shell-status', {{ detail: {detail} }}))"
        ));
    }
}

// Register (or re-register) the Companion task with this build's identity,
// wait until the runtime that answers is the one just registered, then load
// the Control Center. Returns false when the runtime never became healthy.
fn prepare_and_load(app: AppHandle) -> bool {
    load(app, true)
}

// `present` is false only after an update installed with the window closed:
// the app then loads in the tray, where the customer left it.
fn load(app: AppHandle, present: bool) -> bool {
    // Before the preparing check: present_window below must find a window,
    // or it would hand the load to yet another thread. Without one (WebView2
    // failed to start) this attempt ends here; the next click tries again.
    if present && !ensure_live_window(&app) {
        return false;
    }
    let shell = app.state::<Shell>();
    {
        let mut preparing = shell.preparing.lock().unwrap();
        if *preparing {
            // Also while the update at launch downloads: loading the app
            // now would put it under an installer that ends this process.
            // Reload then only brings the start screen forward.
            present_window(&app);
            return false;
        }
        *preparing = true;
    }
    show_status(&app, None);
    if present {
        present_window(&app);
    }
    let result = prepare_runtime(&app);
    // Which window the navigation below went to: one built later (the old
    // window was closed and released meanwhile) still shows the start page.
    let mut navigated = 0;
    match &result {
        Ok(origin) => {
            *shell.runtime_origin.lock().unwrap() = origin.clone();
            navigated = shell.windows_created.load(Ordering::SeqCst);
            navigate_to_control_center(&app, origin);
        }
        Err(error) => {
            log(error);
            show_status(&app, Some(error));
        }
    }
    *shell.preparing.lock().unwrap() = false;
    if let Ok(origin) = &result {
        // A replacement built while this load ran skipped its own load
        // (preparing was set); point it at the Control Center now.
        if shell.windows_created.load(Ordering::SeqCst) != navigated {
            navigate_to_control_center(&app, origin);
        }
        // A second link may have arrived while the first navigation held the queue.
        navigate_to_pending_theme(&app, false);
    }
    result.is_ok()
}

fn navigate_to_control_center(app: &AppHandle, origin: &Url) {
    let Some(window) = main_window(app) else {
        return;
    };
    let shell = app.state::<Shell>();
    let pending = shell.pending_theme.lock().unwrap();
    let path = pending
        .as_ref()
        .map(|theme_id| format!("/control-center/install/{theme_id}"))
        .unwrap_or_else(|| "/control-center".to_string());
    let _ = window.navigate(origin.join(&path).expect("validated local path"));
}

fn prepare_runtime(app: &AppHandle) -> Result<Url, String> {
    let expected_version = run_companion(app, &["version", "--short"])?;
    // A healthy runtime of this exact build needs no re-registration; this is
    // the common path on every start after the first.
    if let Ok(origin) = wait_for_healthy_runtime(app, &expected_version, RUNTIME_INITIAL_HEALTH_TIMEOUT) {
        return Ok(origin);
    }
    let version = version(app);
    run_companion(
        app,
        &[
            "service",
            "install",
            "--label",
            RUNTIME_LABEL,
            "--transport",
            "wifi",
            "--interval",
            "30s",
            "--api-addr",
            "127.0.0.1:47832",
            "--api-dev-origin",
            DEFAULT_RUNTIME_ORIGIN,
            "--api-fallback",
            "--last-good-max-age",
            LAST_GOOD_MAX_AGE,
            "--native-shell",
            "--app-version",
            &version,
            "--app-build",
            BUILD,
            "--runtime-label",
            RUNTIME_LABEL,
        ],
    )?;
    wait_for_healthy_runtime(app, &expected_version, RUNTIME_HEALTH_TIMEOUT)
}

#[derive(Deserialize)]
struct RuntimeHealth {
    ok: bool,
    companion: CompanionHealth,
}

#[derive(Deserialize)]
struct CompanionHealth {
    version: String,
    app: AppHealth,
    runtime: RuntimeInfo,
}

#[derive(Deserialize)]
struct AppHealth {
    version: String,
    build: String,
    #[serde(rename = "installedInApplications")]
    installed: bool,
}

#[derive(Deserialize)]
struct RuntimeInfo {
    #[serde(rename = "listenerOwner")]
    listener_owner: String,
}

#[derive(Deserialize)]
struct RuntimeEndpoint {
    origin: String,
}

fn wait_for_healthy_runtime(app: &AppHandle, expected_version: &str, timeout: Duration) -> Result<Url, String> {
    let deadline = Instant::now() + timeout;
    let mut last_error = String::from("no response");
    let http = runtime_http();
    loop {
        for origin in runtime_origin_candidates() {
            match check_runtime_health(app, &http, &origin, expected_version) {
                Ok(()) => return Ok(origin),
                Err(error) => last_error = format!("{origin}: {error}"),
            }
        }
        if Instant::now() >= deadline {
            return Err(format!("the Companion did not become ready: {last_error}"));
        }
        std::thread::sleep(RUNTIME_HEALTH_POLL);
    }
}

fn check_runtime_health(app: &AppHandle, http: &ureq::Agent, origin: &Url, expected_version: &str) -> Result<(), String> {
    let url = origin.join("/v1/runtime-health").expect("static path");
    let mut response = http.get(url.as_str()).call().map_err(|error| error.to_string())?;
    if response.status() != 200 {
        return Err(format!("HTTP {}", response.status()));
    }
    let body = response.body_mut().read_to_string().map_err(|error| error.to_string())?;
    let health: RuntimeHealth = serde_json::from_str(&body).map_err(|error| error.to_string())?;
    if !health.ok {
        return Err("runtime reports not ok".into());
    }
    if health.companion.version != expected_version {
        return Err(format!("runtime version {} != {expected_version}", health.companion.version));
    }
    if health.companion.app.version != version(app) || health.companion.app.build != BUILD {
        return Err(format!(
            "runtime registered for app {}+{}, this shell is {}+{BUILD}",
            health.companion.app.version,
            health.companion.app.build,
            version(app)
        ));
    }
    if !health.companion.app.installed {
        return Err("runtime does not run next to the shell".into());
    }
    if health.companion.runtime.listener_owner != RUNTIME_LABEL {
        return Err(format!("runtime is owned by {}", health.companion.runtime.listener_owner));
    }
    Ok(())
}

// With --api-fallback the Companion may listen on another loopback port and
// publishes it in run/runtime-endpoint.json.
fn runtime_origin_candidates() -> Vec<Url> {
    let mut candidates = Vec::new();
    if let Some(appdata) = std::env::var_os("APPDATA") {
        let path = PathBuf::from(appdata).join("codexbar-display").join("run").join("runtime-endpoint.json");
        if let Ok(data) = std::fs::read(path) {
            if let Ok(endpoint) = serde_json::from_slice::<RuntimeEndpoint>(&data) {
                if let Ok(origin) = Url::parse(&endpoint.origin) {
                    if matches!(origin.host_str(), Some("127.0.0.1")) && origin.scheme() == "http" {
                        candidates.push(origin);
                    }
                }
            }
        }
    }
    let default = Url::parse(DEFAULT_RUNTIME_ORIGIN).expect("static origin");
    if !candidates.contains(&default) {
        candidates.push(default);
    }
    candidates
}

// The Updates tab's "Update" button lands here (vibetv://check-for-updates),
// as does the tray item. The NSIS updater exits this process and relaunches
// the new build, which re-registers the Companion task on start. This exe
// has no console, so every outcome the customer waits for is shown in a
// native message box; stderr alone would leave the click unanswered.
fn check_for_updates(app: AppHandle) {
    // During the check with the window closed the click is noted: that
    // check installs right away, or hands over to a new request when it ends
    // without installing.
    if !take_updater(&app, UpdateRun::Asked) {
        log("update check already running; this request is not started");
        return;
    }
    tauri::async_runtime::spawn(async move {
        let result = run_update(&app, UpdateRun::Asked).await;
        // The installer relaunches this process on success; every other
        // outcome frees the guard for the next request.
        free_updater(&app);
        match result {
            Ok(UpdateOutcome::Installed)
            | Ok(UpdateOutcome::AlreadyTried)
            | Ok(UpdateOutcome::InUse) => {}
            Ok(UpdateOutcome::UpToDate) => show_message("VibeTV Control Center is up to date."),
            Ok(UpdateOutcome::Busy) => {
                log("update deferred: a firmware update or theme install owns the runtime");
                show_message(
                    "The update was not installed because a VibeTV update or theme install is running. Try again when it has finished.",
                );
            }
            Err(error) => {
                log(&error);
                show_message(
                    "The update could not be installed. Check your internet connection and try again; if this keeps happening, download the latest installer from vibetv.shop.",
                );
            }
        }
    });
}

// Issue #565: the app installs its own update before it looks for a VibeTV,
// like the Mac App (#561). Nobody asked for this check, so it answers with
// nothing but the start screen's update line: no newer version, no answer
// within the limit, a running VibeTV update, or a download that fails, stalls
// or takes too long all let the start go on without a message.
fn launch_update_check(app: &AppHandle) {
    if !take_updater(app, UpdateRun::Launch) {
        return;
    }
    let result = tauri::async_runtime::block_on(run_update(app, UpdateRun::Launch));
    free_updater(app);
    match result {
        Ok(UpdateOutcome::Installed) => {}
        Ok(UpdateOutcome::UpToDate) => log("launch update check: no newer version"),
        Ok(UpdateOutcome::AlreadyTried) => {
            log("launch update skipped: this version was tried in the last 24 hours, or the attempt could not be noted")
        }
        Ok(UpdateOutcome::Busy) => {
            log("launch update skipped: a firmware update or theme install owns the runtime")
        }
        Ok(UpdateOutcome::InUse) => {}
        Err(error) => log(&format!("launch update skipped: {error}")),
    }
}

// The app runs for weeks in the tray, so an update published meanwhile would
// wait for the next start. It is installed while the customer is not using
// the app: only with the window closed, never during a VibeTV update or theme
// install, and without a message whatever the outcome. The same note as at
// launch keeps it to one attempt per version in 24 hours. Installing restarts
// the app and the background service; VibeTV gets no new numbers for those
// seconds. The window comes back closed (`AFTER_IDLE_UPDATE_ARG`).
fn idle_update_check(app: &AppHandle) {
    if window_in_use(app) {
        log("update check skipped: the window is open");
        return;
    }
    if *app.state::<Shell>().preparing.lock().unwrap() {
        return;
    }
    if !take_updater(app, UpdateRun::Idle) {
        return;
    }
    let result = tauri::async_runtime::block_on(run_update(app, UpdateRun::Idle));
    // A click that came during the check and was not used by an install:
    // it gets its own run, with its messages.
    if free_updater(app) {
        check_for_updates(app.clone());
    }
    match result {
        Ok(UpdateOutcome::Installed) => {}
        Ok(UpdateOutcome::UpToDate) => log("update check: no newer version"),
        Ok(UpdateOutcome::AlreadyTried) => {
            log("update skipped: this version was tried in the last 24 hours, or the attempt could not be noted")
        }
        Ok(UpdateOutcome::Busy) => {
            log("update skipped: a firmware update or theme install owns the runtime")
        }
        Ok(UpdateOutcome::InUse) => log("update skipped: the window was opened before the install"),
        Err(error) => log(&format!("update skipped: {error}")),
    }
}

// Shown, also minimized to the taskbar (a minimized window stays visible):
// the customer may be in the middle of something there. Only the hidden
// window in the tray is free; a window closed while minimized is hidden and
// still minimized, so the minimized state alone says nothing.
fn window_in_use(app: &AppHandle) -> bool {
    main_window(app)
        .map(|window| window.is_visible().unwrap_or(true))
        .unwrap_or(false)
}

// True once, for the start the installer of an update with the window closed
// relaunched. The argument alone is not enough: a process keeps its arguments,
// and the installer of a later update the customer asked for hands them on.
fn relaunched_after_idle_update(app: &AppHandle) -> bool {
    if !std::env::args().any(|arg| arg == AFTER_IDLE_UPDATE_ARG) {
        return false;
    }
    let Ok(folder) = app.path().app_local_data_dir() else {
        return false;
    };
    launch_update::take_relaunch_note(&folder.join(IDLE_UPDATE_RELAUNCH_MARKER), unix_now())
}

fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|since| since.as_secs())
        .unwrap_or(0)
}

#[derive(Clone, Copy, PartialEq)]
enum UpdateRun {
    // The tray item or the Updates tab: the customer asked.
    Asked,
    // At launch, before the app looks for a VibeTV (#565).
    Launch,
    // While the app runs with its window closed.
    Idle,
}

// Check, download and install. On Windows a successful install ends this
// process inside `update.install`.
async fn run_update(app: &AppHandle, run: UpdateRun) -> Result<UpdateOutcome, String> {
    let mut builder = app.updater_builder();
    // The marker keeps the updates nobody asked for to one attempt per
    // version in 24 hours.
    let mut marker: Option<PathBuf> = None;
    let mut relaunch_note: Option<PathBuf> = None;
    if run != UpdateRun::Asked {
        // This limit covers the check only: the plugin hands the update
        // back without one, so the download gets its own below.
        builder = builder
            .timeout(LAUNCH_UPDATE_CHECK_LIMIT)
            .configure_client(|client| client.read_timeout(LAUNCH_UPDATE_STALL_LIMIT));
        let folder = app
            .path()
            .app_local_data_dir()
            .map_err(|error| format!("no folder for the launch update marker: {error}"))?;
        marker = Some(folder.join(LAUNCH_UPDATE_MARKER));
        if run == UpdateRun::Idle {
            // NSIS hands everything after /ARGS to the relaunched app, and
            // the plugin puts these arguments last.
            builder = builder.installer_arg(AFTER_IDLE_UPDATE_ARG);
            relaunch_note = Some(folder.join(IDLE_UPDATE_RELAUNCH_MARKER));
        }
    }
    let updater = builder.build().map_err(|error| format!("updater unavailable: {error}"))?;
    let update = updater.check().await.map_err(|error| format!("update check failed: {error}"))?;
    let Some(mut update) = update else {
        return Ok(UpdateOutcome::UpToDate);
    };
    if let Some(marker) = &marker {
        let now = unix_now();
        if !launch_update::claim(marker, &update.version, now) {
            return Ok(UpdateOutcome::AlreadyTried);
        }
        update.timeout = Some(LAUNCH_UPDATE_DOWNLOAD_LIMIT);
        if run == UpdateRun::Launch {
            show_updating(app, &update.version);
        }
    }
    log(&format!("downloading update {}", update.version));
    let bytes = update
        .download(|_, _| {}, || {})
        .await
        .map_err(|error| format!("update download failed: {error}"))?;
    // Installing replaces the Companion binary and restarts its task
    // while a firmware update or theme install may be writing to the
    // device. The hold lasts one minute, so it is claimed only now,
    // after the download, right before the installer takes over --
    // exactly like repair-codexbar.
    let hold = tauri::async_runtime::spawn_blocking(claim_update_hold)
        .await
        .map_err(|error| format!("update hold check failed: {error}"))?;
    if let UpdateHold::UpdateRunning = hold {
        // Nothing was tried; the next start may install this version.
        if let Some(marker) = &marker {
            launch_update::release(marker);
        }
        return Ok(UpdateOutcome::Busy);
    }
    // Decided only now: the window may have been opened during the download
    // or while the hold was claimed, which can take a few runtime requests. A
    // click on Update meanwhile makes this the customer's install: it goes
    // on, and the app comes back with its window.
    let mut asked = false;
    if run == UpdateRun::Idle {
        match decide_idle_install(app, relaunch_note.as_deref()) {
            IdleDecision::Asked => {
                asked = true;
                relaunch_note = None;
            }
            IdleDecision::InUse => {
                let _ = tauri::async_runtime::spawn_blocking(release_update_hold).await;
                // Nothing was tried; the next check may install this version.
                if let Some(marker) = &marker {
                    launch_update::release(marker);
                }
                return Ok(UpdateOutcome::InUse);
            }
            IdleDecision::Hidden => {}
        }
    }
    log(&format!("installing update {}", update.version));
    if let Err(error) = update.install(bytes) {
        if let Some(note) = &relaunch_note {
            launch_update::release(note);
        }
        if run == UpdateRun::Idle {
            // Back to the check, so freeing the updater works as before; a
            // click, before or while the installer started, still gets its
            // answer, from its own run.
            let shell = app.state::<Shell>();
            let mut updater = shell.updater.lock().unwrap();
            let clicked = asked || matches!(*updater, Updater::IdleInstalling { asked: true });
            *updater = Updater::Idle { asked: clicked, presented: false };
        }
        // Nothing was replaced; give the runtime back to device jobs.
        let _ = tauri::async_runtime::spawn_blocking(release_update_hold).await;
        return Err(format!("update install failed: {error}"));
    }
    Ok(UpdateOutcome::Installed)
}

enum UpdateOutcome {
    Installed,
    UpToDate,
    Busy,
    // Only the updates nobody asked for: they try a version once in 24 hours.
    AlreadyTried,
    // Only with the window closed: it was opened before the install.
    InUse,
}

// Native message box: works while the webview is hidden or still loading.
fn show_message(message: &str) {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            MB_ICONINFORMATION, MB_OK, MB_SETFOREGROUND, MB_TASKMODAL, MessageBoxW,
        };
        let text: Vec<u16> = message.encode_utf16().chain(Some(0)).collect();
        let title: Vec<u16> = "VibeTV Control Center".encode_utf16().chain(Some(0)).collect();
        std::thread::spawn(move || {
            // SAFETY: both buffers are NUL-terminated and outlive the call.
            unsafe {
                MessageBoxW(
                    std::ptr::null_mut(),
                    text.as_ptr(),
                    title.as_ptr(),
                    MB_OK | MB_ICONINFORMATION | MB_SETFOREGROUND | MB_TASKMODAL,
                );
            }
        });
    }
    #[cfg(not(windows))]
    log(message);
}

#[cfg(test)]
mod tests {
    use super::{
        choose_placement, clear_loaded_theme, close_stands, fit_into, inner_within,
        label_for_generation, theme_id_from_deep_link, work_area_of_centre, Placement,
        WindowRect, remembered_after, remembered_for, store_if_newer, reported_rect, Change,
    };
    use url::Url;

    const MIN: (u32, u32) = (960, 640);

    #[test]
    fn theme_link_accepts_only_one_safe_catalog_id() {
        for (input, expected) in [
            ("vibetv://install-theme/clippy", Some("clippy")),
            ("vibetv://install-theme/claude-creature", Some("claude-creature")),
            ("vibetv://install-theme/ab", None),
            ("vibetv://install-theme/Clippy", None),
            ("vibetv://install-theme/a_b", None),
            ("vibetv://install-theme/a--b", None),
            ("vibetv://install-theme/-abc", None),
            ("vibetv://install-theme/abc-", None),
            ("vibetv://install-theme/abc/other", None),
            ("vibetv://install-theme/abc/", None),
            ("vibetv://install-theme/../clippy", None),
            ("vibetv://install-theme/abc/../clippy", None),
            ("vibetv://install-theme/%61bc", None),
            ("vibetv://install-theme/abc?next=other", None),
            ("vibetv://install-theme/abc#other", None),
            ("vibetv://user@install-theme/abc", None),
            ("vibetv://install-theme:123/abc", None),
            ("vibetv://open-control-center/abc", None),
            ("https://install-theme/abc", None),
        ] {
            assert_eq!(theme_id_from_deep_link(input), expected, "{input}");
        }
        let longest = format!("vibetv://install-theme/{}", "a".repeat(64));
        assert!(theme_id_from_deep_link(&longest).is_some());
        let long = format!("vibetv://install-theme/{}", "a".repeat(65));
        assert_eq!(theme_id_from_deep_link(&long), None);
    }

    #[test]
    fn theme_link_stays_queued_until_its_local_page_loads_with_a_healthy_runtime() {
        let origin = Url::parse("http://127.0.0.1:47832").unwrap();
        let theme_page = origin.join("/control-center/install/clippy").unwrap();
        let mut pending = Some("clippy".to_string());
        assert!(!clear_loaded_theme(&mut pending, &theme_page, &origin, false));
        assert_eq!(pending.as_deref(), Some("clippy"));
        assert!(!clear_loaded_theme(&mut pending, &origin.join("/control-center").unwrap(), &origin, true));
        assert_eq!(pending.as_deref(), Some("clippy"));
        assert!(!clear_loaded_theme(&mut pending, &Url::parse("http://127.0.0.1:47833/control-center/install/clippy").unwrap(), &origin, true));
        assert_eq!(pending.as_deref(), Some("clippy"));
        pending = Some("synthwave".to_string());
        assert!(!clear_loaded_theme(&mut pending, &theme_page, &origin, true));
        assert_eq!(pending.as_deref(), Some("synthwave"));
        pending = Some("clippy".to_string());
        assert!(clear_loaded_theme(&mut pending, &theme_page, &origin, true));
        assert_eq!(pending, None);
    }

    #[test]
    fn window_after_a_failed_build_gets_a_label_tauri_has_not_seen() {
        // The first window keeps "main"; a label that Tauri still holds from a
        // failed build must never be handed out again.
        assert_eq!(label_for_generation(0), "main");
        assert_eq!(label_for_generation(1), "main-1");
        assert_ne!(label_for_generation(1), label_for_generation(2));
    }

    #[test]
    fn a_close_is_cancelled_by_any_present_after_the_request() {
        assert!(close_stands(3, 3));
        assert!(!close_stands(3, 4));
    }

    #[test]
    fn older_geometry_snapshot_never_replaces_a_newer_one() {
        let snapshot = |x| (Some(WindowRect { x, y: 0, width: 1280, height: 900 }), false);
        let mut slot = None;
        store_if_newer(&mut slot, 2, snapshot(20));
        store_if_newer(&mut slot, 1, snapshot(10));
        assert_eq!(slot, Some((2, snapshot(20))));
        store_if_newer(&mut slot, 3, snapshot(30));
        assert_eq!(slot, Some((3, snapshot(30))));
    }

    #[test]
    fn window_geometry_choice_remembered_default_or_off_screen() {
        let rect = |x, y, width, height| WindowRect { x, y, width, height };
        // Primary monitor at 0,0 and a second one to its left (negative x).
        let screens = [(rect(0, 0, 1920, 1040), MIN), (rect(-1280, 0, 1280, 1000), MIN)];
        let placed = rect(100, 80, 1280, 900);
        assert_eq!(
            choose_placement(Some((Some(placed), false)), &screens),
            Placement::Remembered { rect: Some(placed), maximized: false }
        );
        // Maximized is kept with the restore rectangle.
        assert_eq!(
            choose_placement(Some((Some(placed), true)), &screens),
            Placement::Remembered { rect: Some(placed), maximized: true }
        );
        // Maximized, never restored: maximize again, no rectangle.
        assert_eq!(
            choose_placement(Some((None, true)), &screens),
            Placement::Remembered { rect: None, maximized: true }
        );
        // Centre on the left monitor is still on a monitor.
        let left = rect(-900, 50, 1280, 900);
        assert_eq!(work_area_of_centre(left, &screens), Some(screens[1]));
        // Nothing remembered: first start default.
        assert_eq!(choose_placement(None, &screens), Placement::Default);
        assert_eq!(choose_placement(Some((None, false)), &screens), Placement::Default);
        // The monitor it was on is unplugged: default, not off-screen.
        let unplugged = rect(3000, 200, 1280, 900);
        assert_eq!(choose_placement(Some((Some(unplugged), false)), &screens), Placement::Default);
        // No monitor known at all: default.
        assert_eq!(choose_placement(Some((Some(placed), false)), &[]), Placement::Default);
    }

    #[test]
    fn a_remembered_window_is_pulled_inside_the_work_area() {
        let rect = |x, y, width, height| WindowRect { x, y, width, height };
        // 1080p with a 48 px taskbar at the bottom: work area ends at y=1032.
        let work = (rect(0, 0, 1920, 1032), MIN);
        // Centre (940, 750) is on screen, but the bottom edge (1200) is behind the taskbar.
        assert_eq!(
            choose_placement(Some((Some(rect(300, 300, 1280, 900)), false)), &[work]),
            Placement::Remembered { rect: Some(rect(300, 132, 1280, 900)), maximized: false }
        );
        // The stored rectangle is the outer one: 900 px client plus a 32 px caption
        // and 8 px borders. Its bottom edge must stay above the taskbar too.
        let outer = rect(300, 300, 1296, 932);
        let Placement::Remembered { rect: Some(placed), maximized: false } =
            choose_placement(Some((Some(outer), false)), &[work])
        else {
            panic!("a remembered window must be placed");
        };
        assert_eq!(placed, rect(300, 100, 1296, 932));
        assert_eq!(inner_within(placed, (16, 32)), (1280, 900));
        // Larger than the screen: shrunk to fit, then moved to the corner.
        assert_eq!(
            choose_placement(Some((Some(rect(50, 50, 2560, 1440)), false)), &[work]),
            Placement::Remembered { rect: Some(work.0), maximized: false }
        );
        // Off the left edge of a monitor that sits at negative x.
        let left = rect(-1280, 0, 1280, 1000);
        assert_eq!(fit_into(rect(-1400, 20, 1000, 800), left, MIN), rect(-1280, 20, 1000, 800));
    }

    #[test]
    fn a_window_across_two_monitors_is_kept_when_it_is_fully_visible() {
        let rect = |x, y, width, height| WindowRect { x, y, width, height };
        // Two 1080p work areas side by side, 1032 px high each.
        let screens = [(rect(0, 0, 1920, 1032), MIN), (rect(1920, 0, 1920, 1032), MIN)];
        // Spans both monitors, centre on the right one: still fully visible, so unchanged.
        let across = rect(1500, 100, 1000, 800);
        assert_eq!(
            choose_placement(Some((Some(across), false)), &screens),
            Placement::Remembered { rect: Some(across), maximized: false }
        );
        // Part of it hangs below both work areas: clamped to the monitor of its centre.
        assert_eq!(
            choose_placement(Some((Some(rect(1500, 300, 1000, 900)), false)), &screens),
            Placement::Remembered { rect: Some(rect(1920, 132, 1000, 900)), maximized: false }
        );
    }

    #[test]
    fn a_work_area_smaller_than_the_minimum_keeps_the_minimum_with_its_top_left_in_reach() {
        let rect = |x, y, width, height| WindowRect { x, y, width, height };
        // 800x500 work area, smaller than the 960x640 minimum.
        let small = rect(0, 0, 800, 500);
        assert_eq!(
            choose_placement(Some((Some(rect(50, 50, 1000, 600)), false)), &[(small, MIN)]),
            Placement::Remembered { rect: Some(rect(0, 0, 960, 640)), maximized: false }
        );
        // Same on a monitor at negative x: the top-left is pinned to the area's corner.
        let left = rect(-1280, 0, 800, 500);
        assert_eq!(
            choose_placement(Some((Some(rect(-1200, 20, 1000, 600)), false)), &[(left, MIN)]),
            Placement::Remembered { rect: Some(rect(-1280, 0, 960, 640)), maximized: false }
        );
    }

    #[test]
    fn a_maximized_window_keeps_its_last_normal_rectangle() {
        let maximized_bounds = WindowRect { x: 0, y: 0, width: 1920, height: 1040 };
        let normal = WindowRect { x: 100, y: 80, width: 1280, height: 900 };
        // Restored earlier: that rectangle survives a close while maximized.
        assert_eq!(remembered_for(maximized_bounds, true, Some((Some(normal), false))), (Some(normal), true));
        // Never restored: no rectangle, only the maximized state.
        assert_eq!(remembered_for(maximized_bounds, true, None), (None, true));
        // Not maximized: the current rectangle is kept.
        assert_eq!(remembered_for(normal, false, Some((None, true))), (Some(normal), false));
    }

    #[test]
    fn a_window_moved_while_normal_keeps_that_place_through_a_maximized_close() {
        let rect = |x, y, width, height| WindowRect {
            x,
            y,
            width,
            height,
        };
        let released_before = rect(0, 0, 1000, 700);
        let moved = rect(100, 80, 1280, 900);
        let maximized_bounds = rect(0, 0, 1920, 1040);
        // Closed normal at an older place, then moved and resized, then maximized.
        let at_last_release = Some(remembered_for(released_before, false, None));
        let after_move = remembered_after(moved, moved, false, false, at_last_release);
        let after_maximize = remembered_after(maximized_bounds, maximized_bounds, false, true, after_move);
        // Closed while maximized: the release keeps the moved place.
        let at_close = remembered_after(maximized_bounds, maximized_bounds, false, true, after_maximize);
        assert_eq!(at_close, Some((Some(moved), true)));
    }

    #[test]
    fn a_restored_window_tracks_its_new_place_and_a_minimized_one_keeps_the_last() {
        let rect = |x, y, width, height| WindowRect {
            x,
            y,
            width,
            height,
        };
        let before = rect(100, 80, 1280, 900);
        let restored = rect(300, 120, 1100, 800);
        let maximized_bounds = rect(0, 0, 1920, 1040);
        let kept = Some((Some(before), true));
        // Restored from maximized: the new normal place is the one to keep.
        assert_eq!(
            remembered_after(restored, restored, false, false, kept),
            Some((Some(restored), false))
        );
        // Minimized: its position says nothing, nothing is stored.
        assert_eq!(remembered_after(maximized_bounds, maximized_bounds, true, false, kept), None);
    }

    #[test]
    fn a_maximize_before_the_worker_runs_keeps_the_place_the_event_reported() {
        let rect = |x, y, width, height| WindowRect { x, y, width, height };
        let older = rect(0, 0, 1000, 700);
        let moved = rect(100, 80, 1280, 900);
        let maximized_bounds = rect(0, 0, 1920, 1040);
        let previous = Some((Some(older), false));
        // The move reported `moved`, but the worker samples the maximized window.
        assert_eq!(
            remembered_after(maximized_bounds, moved, false, true, previous),
            Some((Some(moved), true))
        );
        // The maximize's own event reports the maximized bounds: nothing to take.
        assert_eq!(
            remembered_after(maximized_bounds, maximized_bounds, false, true, Some((Some(moved), false))),
            Some((Some(moved), true))
        );
        // A resize reports the inner size; the frame turns it into the outer one.
        let change = Some(Change::Resized(tauri::PhysicalSize::new(1264, 868)));
        assert_eq!(reported_rect(change, moved, (16, 32)), moved);
    }
}
