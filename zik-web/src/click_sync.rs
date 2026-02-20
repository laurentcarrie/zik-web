use axum::{
    Extension, Json,
    extract::Path,
    extract::ws::{Message, WebSocket, WebSocketUpgrade},
    response::Response,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::{Mutex, Notify, broadcast};

fn now_ms() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs_f64()
        * 1000.0
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
enum ClientMessage {
    Ping { client_time: f64 },
    SetBpm { bpm: f64 },
    SetSong { song: String },
    SetBar { bar: u64 },
    Start,
    Stop,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
enum ServerMessage {
    Pong {
        client_time: f64,
        server_time: f64,
    },
    Tick {
        server_time: f64,
        bpm: f64,
        beat_number: u64,
        song: String,
        bar: u64,
    },
    State {
        bpm: f64,
        running: bool,
        beat_number: u64,
        client_count: u32,
        origin: f64,
        song: String,
        bar: u64,
    },
}

struct ClickSyncInner {
    bpm: f64,
    running: bool,
    beat_number: u64,
    client_count: u32,
    /// Milliseconds since Unix epoch when beat 0 started
    origin: f64,
    song: String,
    bar: u64,
    /// When client_count dropped to 0 (None if clients are connected)
    empty_since: Option<std::time::Instant>,
}

#[derive(Clone)]
struct ClickSyncState {
    inner: Arc<Mutex<ClickSyncInner>>,
    tx: broadcast::Sender<String>,
    notify: Arc<Notify>,
}

impl ClickSyncState {
    fn new() -> Self {
        let (tx, _) = broadcast::channel(256);
        let state = Self {
            inner: Arc::new(Mutex::new(ClickSyncInner {
                bpm: 120.0,
                running: false,
                beat_number: 0,
                client_count: 0,
                origin: 0.0,
                song: String::new(),
                bar: 0,
                empty_since: Some(std::time::Instant::now()),
            })),
            tx,
            notify: Arc::new(Notify::new()),
        };

        let inner = state.inner.clone();
        let tx = state.tx.clone();
        let notify = state.notify.clone();
        tokio::spawn(ticker_loop(inner, tx, notify));

        state
    }
}

#[derive(Clone)]
pub struct ClickSyncManager {
    sessions: Arc<Mutex<HashMap<String, ClickSyncState>>>,
}

impl ClickSyncManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    async fn get_or_create(&self, name: &str) -> ClickSyncState {
        let mut sessions = self.sessions.lock().await;
        sessions
            .entry(name.to_string())
            .or_insert_with(ClickSyncState::new)
            .clone()
    }

    async fn mark_empty_if_needed(&self, name: &str) {
        let sessions = self.sessions.lock().await;
        if let Some(state) = sessions.get(name) {
            let mut inner = state.inner.lock().await;
            if inner.client_count == 0 && inner.empty_since.is_none() {
                inner.empty_since = Some(std::time::Instant::now());
            }
        }
    }

    pub fn spawn_cleanup(self) {
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(60)).await;
                let mut sessions = self.sessions.lock().await;
                sessions.retain(|_, state| {
                    // Try to lock without blocking — skip if busy
                    let Ok(inner) = state.inner.try_lock() else {
                        return true;
                    };
                    match inner.empty_since {
                        Some(since) => since.elapsed() < Duration::from_secs(300),
                        None => true,
                    }
                });
            }
        });
    }
}

#[derive(Serialize)]
pub struct SessionInfo {
    name: String,
    bpm: f64,
    running: bool,
    client_count: u32,
    song: String,
    bar: u64,
}

pub async fn list_sessions_handler(
    Extension(manager): Extension<ClickSyncManager>,
) -> Json<Vec<SessionInfo>> {
    let sessions = manager.sessions.lock().await;
    let mut infos = Vec::new();
    for (name, state) in sessions.iter() {
        let inner = state.inner.lock().await;
        infos.push(SessionInfo {
            name: name.clone(),
            bpm: inner.bpm,
            running: inner.running,
            client_count: inner.client_count,
            song: inner.song.clone(),
            bar: inner.bar,
        });
    }
    Json(infos)
}

async fn ticker_loop(
    inner: Arc<Mutex<ClickSyncInner>>,
    tx: broadcast::Sender<String>,
    notify: Arc<Notify>,
) {
    loop {
        let (running, bpm, beat_number, origin) = {
            let state = inner.lock().await;
            (state.running, state.bpm, state.beat_number, state.origin)
        };

        if !running {
            notify.notified().await;
            continue;
        }

        let next_beat = beat_number + 1;
        let interval_ms = 60_000.0 / bpm;
        let next_beat_time = origin + (next_beat as f64) * interval_ms;
        let sleep_ms = (next_beat_time - now_ms()).max(0.0);

        tokio::select! {
            _ = tokio::time::sleep(Duration::from_secs_f64(sleep_ms / 1000.0)) => {
                let mut state = inner.lock().await;
                if !state.running {
                    continue;
                }
                state.beat_number = next_beat;
                let msg = ServerMessage::Tick {
                    server_time: now_ms(),
                    bpm: state.bpm,
                    beat_number: state.beat_number,
                    song: state.song.clone(),
                    bar: state.bar,
                };
                let json = serde_json::to_string(&msg).unwrap();
                let _ = tx.send(json);
            }
            _ = notify.notified() => {
                continue;
            }
        }
    }
}

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    Path(name): Path<String>,
    Extension(manager): Extension<ClickSyncManager>,
) -> Response {
    let state = manager.get_or_create(&name).await;
    let session_name = name;
    let mgr = manager;
    ws.on_upgrade(move |socket| handle_socket(socket, state, session_name, mgr))
}

async fn handle_socket(
    mut socket: WebSocket,
    state: ClickSyncState,
    session_name: String,
    manager: ClickSyncManager,
) {
    {
        let mut inner = state.inner.lock().await;
        inner.client_count += 1;
        inner.empty_since = None;
    }
    broadcast_state(&state).await;

    let mut broadcast_rx = state.tx.subscribe();
    let (direct_tx, mut direct_rx) = tokio::sync::mpsc::channel::<String>(32);

    loop {
        tokio::select! {
            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        handle_client_message(&text, &state, &direct_tx).await;
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    _ => {}
                }
            }
            msg = broadcast_rx.recv() => {
                if let Ok(text) = msg {
                    if socket.send(Message::Text(text.into())).await.is_err() {
                        break;
                    }
                }
            }
            msg = direct_rx.recv() => {
                if let Some(text) = msg {
                    if socket.send(Message::Text(text.into())).await.is_err() {
                        break;
                    }
                }
            }
        }
    }

    {
        let mut inner = state.inner.lock().await;
        inner.client_count = inner.client_count.saturating_sub(1);
    }
    broadcast_state(&state).await;
    manager.mark_empty_if_needed(&session_name).await;
}

async fn handle_client_message(
    text: &str,
    state: &ClickSyncState,
    direct_tx: &tokio::sync::mpsc::Sender<String>,
) {
    let Ok(msg) = serde_json::from_str::<ClientMessage>(text) else {
        return;
    };

    match msg {
        ClientMessage::Ping { client_time } => {
            let pong = ServerMessage::Pong {
                client_time,
                server_time: now_ms(),
            };
            let json = serde_json::to_string(&pong).unwrap();
            let _ = direct_tx.send(json).await;
        }
        ClientMessage::SetBpm { bpm } => {
            if (30.0..=300.0).contains(&bpm) {
                let mut inner = state.inner.lock().await;
                if inner.running {
                    // Recalculate origin to maintain beat phase
                    let now = now_ms();
                    let old_interval = 60_000.0 / inner.bpm;
                    let elapsed_beats = (now - inner.origin) / old_interval;
                    let new_interval = 60_000.0 / bpm;
                    inner.origin = now - elapsed_beats * new_interval;
                }
                inner.bpm = bpm;
            }
            state.notify.notify_one();
            broadcast_state(state).await;
        }
        ClientMessage::Start => {
            {
                let mut inner = state.inner.lock().await;
                inner.running = true;
                inner.beat_number = 0;
                inner.origin = now_ms();
            }
            state.notify.notify_one();
            broadcast_state(state).await;
        }
        ClientMessage::Stop => {
            {
                let mut inner = state.inner.lock().await;
                inner.running = false;
            }
            state.notify.notify_one();
            broadcast_state(state).await;
        }
        ClientMessage::SetSong { song } => {
            state.inner.lock().await.song = song;
            broadcast_state(state).await;
        }
        ClientMessage::SetBar { bar } => {
            state.inner.lock().await.bar = bar;
            broadcast_state(state).await;
        }
    }
}

async fn broadcast_state(state: &ClickSyncState) {
    let inner = state.inner.lock().await;
    let msg = ServerMessage::State {
        bpm: inner.bpm,
        running: inner.running,
        beat_number: inner.beat_number,
        client_count: inner.client_count,
        origin: inner.origin,
        song: inner.song.clone(),
        bar: inner.bar,
    };
    let json = serde_json::to_string(&msg).unwrap();
    let _ = state.tx.send(json);
}
