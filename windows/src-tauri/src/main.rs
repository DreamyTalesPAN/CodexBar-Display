// VibeTV Control Center shell for Windows.
//
// Mirrors macos/VibeTVControlCenter/main.swift: one tray icon, one WebView2
// window on the local Companion, the Companion registered as a per-user
// Scheduled Task, updates driven from the Companion's Updates tab. No
// provider or device logic and no state of its own live here; everything the
// shell needs to know it asks the Companion.
#![cfg_attr(windows, windows_subsystem = "windows")]

use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use serde::Deserialize;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_updater::UpdaterExt;
use url::Url;

const WINDOW_LABEL: &str = "main";
const DEFAULT_RUNTIME_ORIGIN: &str = "http://127.0.0.1:47832";
const RUNTIME_LABEL: &str = "shop.vibetv.control-center.runtime";
const LAST_GOOD_MAX_AGE: &str = "168h";
const RUNTIME_INITIAL_HEALTH_TIMEOUT: Duration = Duration::from_secs(8);
const RUNTIME_HEALTH_TIMEOUT: Duration = Duration::from_secs(35);
const RUNTIME_HEALTH_POLL: Duration = Duration::from_millis(500);
const RUNTIME_HEALTH_REQUEST_TIMEOUT: Duration = Duration::from_secs(5);
const WINDOW_CLOSE_FLUSH_DELAY: Duration = Duration::from_secs(1);

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
    preparing: Mutex<bool>,
    updating: Mutex<bool>,
    last_error: Mutex<Option<String>>,
    // Bumped on every present; a delayed hide only applies if nothing
    // presented the window again while it waited.
    presentations: AtomicU64,
}

fn main() {
    tauri::Builder::default()
        // A second launch (autostart plus Start menu, or the updater's
        // relaunch) brings the existing window forward instead of starting a
        // second shell that would fight over the same Companion.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            present_window(app)
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .app_name("VibeTV Control Center")
                .build(),
        )
        .manage(Shell {
            runtime_origin: Mutex::new(Url::parse(DEFAULT_RUNTIME_ORIGIN).expect("static origin")),
            preparing: Mutex::new(false),
            updating: Mutex::new(false),
            last_error: Mutex::new(None),
            presentations: AtomicU64::new(0),
        })
        .setup(|app| {
            let handle = app.handle().clone();
            configure_tray(&handle)?;
            if let Err(error) = handle.autolaunch().enable() {
                log(&format!("could not enable autostart: {error}"));
            }
            create_window(&handle)?;
            std::thread::spawn(move || prepare_and_load(handle));
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
    // A GUI-subsystem executable has no customer-visible stderr.
    if let Some(appdata) = std::env::var_os("APPDATA") {
        let dir = PathBuf::from(appdata).join("codexbar-display").join("logs");
        if std::fs::create_dir_all(&dir).is_ok() {
            use std::io::Write;
            if let Ok(mut file) = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(dir.join("windows-shell.log"))
            {
                let _ = writeln!(file, "{message}");
            }
        }
    }
}

fn version(app: &AppHandle) -> String {
    app.package_info().version.to_string()
}

fn user_agent(app: &AppHandle) -> String {
    format!("VibeTVControlCenter/{}+{}", version(app), BUILD)
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
            &MenuItem::with_id(
                app,
                MENU_OPEN,
                "Open VibeTV Control Center",
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(
                app,
                MENU_RELOAD,
                "Reload Control Center",
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(app, MENU_UPDATES, "Check for Updates…", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                MENU_QUIT,
                "Quit VibeTV Control Center",
                true,
                None::<&str>,
            )?,
        ],
    )?;
    let tray = app
        .tray_by_id("main")
        .ok_or_else(|| tauri::Error::AssetNotFound("tray icon".into()))?;
    tray.set_menu(Some(menu))?;
    tray.on_menu_event(|app, event| match event.id().as_ref() {
        MENU_OPEN => present_window(app),
        MENU_RELOAD => {
            if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
                let _ = window.reload();
            }
            present_window(app);
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

fn create_window(app: &AppHandle) -> tauri::Result<()> {
    let actions = app.clone();
    let window = WebviewWindowBuilder::new(app, WINDOW_LABEL, WebviewUrl::App("index.html".into()))
        .title("VibeTV Control Center")
        .inner_size(1280.0, 900.0)
        .min_inner_size(960.0, 640.0)
        .user_agent(&user_agent(app))
        .on_page_load(|window, _| {
            // The first runtime failure can arrive before the welcome page
            // attaches its listener. Replay it when that page is ready.
            let shell = window.state::<Shell>();
            let error = shell.last_error.lock().unwrap().clone();
            let detail = serde_json::json!({ "error": error });
            let _ = window.eval(format!("window.dispatchEvent(new CustomEvent('vibetv:shell-status', {{ detail: {detail} }}))"));
        })
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
        .build()?;
    let handle = app.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            hide_after_flush(&handle);
        }
    });
    Ok(())
}

fn present_window(app: &AppHandle) {
    app.state::<Shell>()
        .presentations
        .fetch_add(1, Ordering::SeqCst);
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

// Theme Studio saves unsaved work on this event; give it a moment, then hide.
fn hide_after_flush(app: &AppHandle) {
    let Some(window) = app.get_webview_window(WINDOW_LABEL) else {
        return;
    };
    let _ = window.eval("window.dispatchEvent(new Event('vibetv:native-window-will-close'))");
    let handle = app.clone();
    let presented = handle.state::<Shell>().presentations.load(Ordering::SeqCst);
    std::thread::spawn(move || {
        std::thread::sleep(WINDOW_CLOSE_FLUSH_DELAY);
        // Reopened from the tray or a second launch meanwhile: keep it open.
        if handle.state::<Shell>().presentations.load(Ordering::SeqCst) == presented {
            let _ = window.hide();
        }
    });
}

fn handle_native_action(app: &AppHandle, url: &Url) {
    match native_action(url).unwrap_or_default() {
        "open-control-center" => present_window(app),
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
            let success = restart_runtime(app) && prepare_and_load(app.clone());
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

fn native_action(url: &Url) -> Option<&str> {
    if url.scheme() != "vibetv"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || !matches!(url.path(), "" | "/")
    {
        return None;
    }
    match url.host_str()? {
        action @ ("open-control-center"
        | "restart-control-center"
        | "repair-runtime"
        | "check-for-updates"
        | "repair-codexbar"
        | "finish-codexbar-recovery"
        | "open-codexbar") => Some(action),
        _ => None,
    }
}

fn dispatch_result(app: &AppHandle, event: &str, success: bool) {
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        let _ = window.eval(format!(
            "window.dispatchEvent(new CustomEvent('{event}', {{ detail: {{ success: {success} }} }}))"
        ));
    }
}

fn show_status(app: &AppHandle, error: Option<&str>) {
    *app.state::<Shell>().last_error.lock().unwrap() = error.map(str::to_owned);
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        let detail = serde_json::json!({ "error": error });
        let _ = window.eval(format!(
            "window.dispatchEvent(new CustomEvent('vibetv:shell-status', {{ detail: {detail} }}))"
        ));
    }
}

// Register (or re-register) the Companion task with this build's identity,
// wait until the runtime that answers is the one just registered, then load
// the Control Center. Returns false when the runtime never became healthy.
fn prepare_and_load(app: AppHandle) -> bool {
    let shell = app.state::<Shell>();
    {
        let mut preparing = shell.preparing.lock().unwrap();
        if *preparing {
            return false;
        }
        *preparing = true;
    }
    show_status(&app, None);
    present_window(&app);
    let result = prepare_runtime(&app);
    match &result {
        Ok(origin) => {
            *shell.runtime_origin.lock().unwrap() = origin.clone();
            if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
                let _ = window.navigate(origin.join("/control-center").expect("static path"));
            }
        }
        Err(error) => {
            log(error);
            show_status(&app, Some(error));
        }
    }
    *shell.preparing.lock().unwrap() = false;
    result.is_ok()
}

fn prepare_runtime(app: &AppHandle) -> Result<Url, String> {
    let expected_version = run_companion(app, &["version", "--short"])?;
    // A healthy runtime of this exact build needs no re-registration; this is
    // the common path on every start after the first.
    if let Ok(origin) =
        wait_for_healthy_runtime(app, &expected_version, RUNTIME_INITIAL_HEALTH_TIMEOUT)
    {
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

fn wait_for_healthy_runtime(
    app: &AppHandle,
    expected_version: &str,
    timeout: Duration,
) -> Result<Url, String> {
    let deadline = Instant::now() + timeout;
    let mut last_error = String::from("no response");
    let http = ureq::Agent::new_with_config(
        ureq::Agent::config_builder()
            .timeout_global(Some(RUNTIME_HEALTH_REQUEST_TIMEOUT))
            .http_status_as_error(false)
            .build(),
    );
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

fn check_runtime_health(
    app: &AppHandle,
    http: &ureq::Agent,
    origin: &Url,
    expected_version: &str,
) -> Result<(), String> {
    let url = origin.join("/v1/runtime-health").expect("static path");
    let mut response = http
        .get(url.as_str())
        .call()
        .map_err(|error| error.to_string())?;
    if response.status() != 200 {
        return Err(format!("HTTP {}", response.status()));
    }
    let body = response
        .body_mut()
        .read_to_string()
        .map_err(|error| error.to_string())?;
    let health: RuntimeHealth = serde_json::from_str(&body).map_err(|error| error.to_string())?;
    if !health.ok {
        return Err("runtime reports not ok".into());
    }
    if health.companion.version != expected_version {
        return Err(format!(
            "runtime version {} != {expected_version}",
            health.companion.version
        ));
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
        return Err(format!(
            "runtime is owned by {}",
            health.companion.runtime.listener_owner
        ));
    }
    Ok(())
}

// With --api-fallback the Companion may listen on another loopback port and
// publishes it in run/runtime-endpoint.json.
fn runtime_origin_candidates() -> Vec<Url> {
    let mut candidates = Vec::new();
    if let Some(appdata) = std::env::var_os("APPDATA") {
        let path = PathBuf::from(appdata)
            .join("codexbar-display")
            .join("run")
            .join("runtime-endpoint.json");
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
// the new build, which re-registers the Companion task on start.
fn check_for_updates(app: AppHandle) {
    {
        let shell = app.state::<Shell>();
        let mut updating = shell.updating.lock().unwrap();
        if *updating {
            return;
        }
        *updating = true;
    }
    tauri::async_runtime::spawn(async move {
        let result = async {
            let updater = app.updater().map_err(|error| error.to_string())?;
            match updater.check().await.map_err(|error| error.to_string())? {
                Some(update) => {
                    let message = format!(
                        "VibeTV Control Center {} is available. Install this update now?",
                        update.version
                    );
                    let confirmed = tauri::async_runtime::spawn_blocking(move || {
                        native_update_dialog(&message, true)
                    })
                    .await
                    .unwrap_or(false);
                    if confirmed {
                        update
                            .download_and_install(|_, _| {}, || {})
                            .await
                            .map_err(|error| error.to_string())?;
                    }
                }
                None => {
                    let _ = tauri::async_runtime::spawn_blocking(|| {
                        native_update_dialog("VibeTV Control Center is up to date.", false)
                    })
                    .await;
                }
            }
            Ok::<(), String>(())
        }
        .await;
        if let Err(error) = result {
            log(&format!("update check/install failed: {error}"));
            let _ = tauri::async_runtime::spawn_blocking(|| native_update_dialog(
                "The Windows update could not be completed. Check your connection and try again later. If this continues, open Support in VibeTV Control Center.", false)).await;
        }
        *app.state::<Shell>().updating.lock().unwrap() = false;
    });
}

fn native_update_dialog(message: &str, confirm: bool) -> bool {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            IDYES, MB_ICONINFORMATION, MB_OK, MB_SETFOREGROUND, MB_TASKMODAL, MB_YESNO, MessageBoxW,
        };
        let text: Vec<u16> = message.encode_utf16().chain(Some(0)).collect();
        let title: Vec<u16> = "VibeTV Control Center"
            .encode_utf16()
            .chain(Some(0))
            .collect();
        let style = (if confirm { MB_YESNO } else { MB_OK })
            | MB_ICONINFORMATION
            | MB_SETFOREGROUND
            | MB_TASKMODAL;
        // Both strings are NUL-terminated and remain alive for the modal call.
        return unsafe {
            MessageBoxW(std::ptr::null_mut(), text.as_ptr(), title.as_ptr(), style) == IDYES
        };
    }
    #[cfg(not(windows))]
    {
        let _ = confirm;
        log(message);
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_actions_match_mac_url_boundary() {
        for action in [
            "open-control-center",
            "restart-control-center",
            "repair-runtime",
            "check-for-updates",
            "repair-codexbar",
            "finish-codexbar-recovery",
            "open-codexbar",
        ] {
            assert_eq!(
                native_action(&Url::parse(&format!("vibetv://{action}")).unwrap()),
                Some(action)
            );
        }
        for url in [
            "https://repair-runtime",
            "vibetv://repair-runtime/path",
            "vibetv://repair-runtime?x=1",
            "vibetv://repair-runtime#x",
            "vibetv://user@repair-runtime",
            "vibetv://repair-runtime:123",
            "vibetv://unknown",
        ] {
            assert_eq!(native_action(&Url::parse(url).unwrap()), None, "{url}");
        }
    }
}
