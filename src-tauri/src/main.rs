#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::{thread, time::Duration};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, PhysicalPosition,
};
use windows::{
    Media::Control::{
        GlobalSystemMediaTransportControlsSession,
        GlobalSystemMediaTransportControlsSessionManager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus,
    },
    Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED},
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MediaInfo {
    title: String,
    artist: String,
    playing: bool,
    position: f64,
    duration: f64,
}

fn current_session() -> windows::core::Result<GlobalSystemMediaTransportControlsSession> {
    unsafe {
        let _ = RoInitialize(RO_INIT_MULTITHREADED);
    }
    let mgr = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()?.get()?;
    mgr.GetCurrentSession()
}

#[tauri::command]
fn get_media() -> Option<MediaInfo> {
    let s = current_session().ok()?;
    let props = s.TryGetMediaPropertiesAsync().ok()?.get().ok()?;
    let title = props.Title().ok()?.to_string();
    if title.is_empty() {
        return None;
    }
    let artist = props.Artist().map(|a| a.to_string()).unwrap_or_default();
    let playing = s.GetPlaybackInfo().ok()?.PlaybackStatus().ok()?
        == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing;

    let tl = s.GetTimelineProperties().ok()?;
    let ticks = 10_000_000.0; // TimeSpan is in 100ns units
    let position = tl.Position().map(|p| p.Duration as f64 / ticks).unwrap_or(0.0);
    let start = tl.StartTime().map(|p| p.Duration).unwrap_or(0);
    let end = tl.EndTime().map(|p| p.Duration).unwrap_or(0);
    let duration = (end - start) as f64 / ticks;

    Some(MediaInfo { title, artist, playing, position, duration })
}

#[tauri::command]
fn media_control(action: String) {
    if let Ok(s) = current_session() {
        let _ = match action.as_str() {
            "toggle" => s.TryTogglePlayPauseAsync().and_then(|a| a.get()),
            "next" => s.TrySkipNextAsync().and_then(|a| a.get()),
            "prev" => s.TrySkipPreviousAsync().and_then(|a| a.get()),
            _ => Ok(false),
        };
    }
}

/// Polls the cursor. Opens the notch when hovered, closes when the cursor leaves.
/// While closed the window ignores the mouse, so clicks pass through to apps below.
fn start_hover_watcher(win: tauri::WebviewWindow) {
    thread::spawn(move || {
        let mut open = false;
        loop {
            thread::sleep(Duration::from_millis(60));
            let (Ok(cur), Ok(pos), Ok(size)) =
                (win.cursor_position(), win.outer_position(), win.outer_size())
            else {
                continue;
            };
            let s = win.scale_factor().unwrap_or(1.0);
            let w = size.width as f64;
            let (wx, wy) = (pos.x as f64, pos.y as f64);

            let (x0, x1, y1) = if open {
                (wx + 10.0 * s, wx + w - 10.0 * s, wy + 200.0 * s)
            } else {
                let cw = 220.0 * s;
                let left = wx + (w - cw) / 2.0;
                (left, left + cw, wy + 40.0 * s)
            };

            let inside = cur.x >= x0 && cur.x <= x1 && cur.y >= wy && cur.y <= y1;
            if inside != open {
                open = inside;
                let _ = win.set_ignore_cursor_events(!open);
                let _ = win.emit("hover", open);
            }
        }
    });
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![get_media, media_control])
        .setup(|app| {
            let win = app.get_webview_window("main").unwrap();

            // center at the top of the primary monitor
            if let Ok(Some(m)) = win.primary_monitor() {
                let size = win.outer_size()?;
                let x = m.position().x + (m.size().width as i32 - size.width as i32) / 2;
                win.set_position(PhysicalPosition::new(x, m.position().y))?;
            }
            win.set_ignore_cursor_events(true)?;
            start_hover_watcher(win);

            // tray icon with Exit
            let quit = MenuItem::with_id(app, "quit", "Exit Notchy", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&quit])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .on_menu_event(|app, event| {
                    if event.id.as_ref() == "quit" {
                        app.exit(0);
                    }
                })
                .build(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Notchy");
}
