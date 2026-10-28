import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./App.css";

type Media = {
  title: string;
  artist: string;
  playing: boolean;
  position: number;
  duration: number;
};
type Line = { t: number; text: string };

const PAGES = ["Music", "Focus", "Water"] as const;
const WATER_GOAL = 1500;
const FOCUS_SECONDS = 25 * 60;

function parseLrc(lrc: string): Line[] {
  const out: Line[] = [];
  for (const raw of lrc.split("\n")) {
    const m = raw.match(/^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/);
    if (m) out.push({ t: Number(m[1]) * 60 + Number(m[2]), text: m[3].trim() });
  }
  return out;
}

const mmss = (s: number) => {
  const v = Math.max(0, Math.floor(s));
  return `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`;
};

function chime() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 1);
  } catch {
    /* ignore */
  }
}

function loadWater(): number {
  try {
    const d = JSON.parse(localStorage.getItem("water") || "{}");
    return d.date === new Date().toDateString() ? d.ml : 0;
  } catch {
    return 0;
  }
}

export default function App() {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [clock, setClock] = useState(new Date());

  const [media, setMedia] = useState<Media | null>(null);
  const fetchedAt = useRef(Date.now());
  const [now, setNow] = useState(Date.now());
  const [lyrics, setLyrics] = useState<Line[]>([]);

  const [secs, setSecs] = useState(FOCUS_SECONDS);
  const [running, setRunning] = useState(false);

  const [water, setWater] = useState(loadWater());

  // hover events from Rust
  useEffect(() => {
    const p = listen<boolean>("hover", (e) => setOpen(e.payload));
    return () => {
      p.then((f) => f());
    };
  }, []);

  // clock
  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // media polling (faster when open)
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const m = await invoke<Media | null>("get_media");
        if (alive) {
          fetchedAt.current = Date.now();
          setMedia(m);
        }
      } catch {
        if (alive) setMedia(null);
      }
    };
    poll();
    const id = setInterval(poll, open ? 500 : 2500);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [open]);

  // smooth progress while open
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [open]);

  // lyrics from LRCLIB when the track changes
  const title = media?.title;
  const artist = media?.artist;
  const duration = media?.duration ?? 0;
  useEffect(() => {
    setLyrics([]);
    if (!title) return;
    const url =
      `https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist || "")}` +
      `&track_name=${encodeURIComponent(title)}&duration=${Math.round(duration)}`;
    fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setLyrics(j?.syncedLyrics ? parseLrc(j.syncedLyrics) : []))
      .catch(() => setLyrics([]));
  }, [title, artist, Math.round(duration)]);

  // pomodoro
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setSecs((s) => {
        if (s <= 1) {
          setRunning(false);
          chime();
          return FOCUS_SECONDS;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [running]);

  // page switching: wheel + arrow keys
  useEffect(() => {
    if (!open) return;
    const next = (d: number) => setPage((p) => (p + d + PAGES.length) % PAGES.length);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") next(1);
      if (e.key === "ArrowLeft") next(-1);
    };
    const onWheel = (e: WheelEvent) => next(e.deltaY > 0 ? 1 : -1);
    window.addEventListener("keydown", onKey);
    window.addEventListener("wheel", onWheel);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("wheel", onWheel);
    };
  }, [open]);

  const addWater = (ml: number) => {
    const v = Math.max(0, Math.min(water + ml, 5000));
    setWater(v);
    localStorage.setItem("water", JSON.stringify({ date: new Date().toDateString(), ml: v }));
  };

  const ctl = (action: "toggle" | "next" | "prev") => invoke("media_control", { action });

  const pos = media
    ? media.position + (media.playing && open ? (now - fetchedAt.current) / 1000 : 0)
    : 0;
  let current = -1;
  for (let i = 0; i < lyrics.length; i++) if (lyrics[i].t <= pos) current = i;

  const clockText = clock.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="stage">
      <div className={`notch ${open ? "open" : ""}`}>
        {!open && (
          <div className="closed">
            {media?.playing ? (
              <span className="eq">
                <i /><i /><i />
              </span>
            ) : null}
            <span className="clock">{clockText}</span>
          </div>
        )}

        {open && (
          <div className="panel">
            <div className="dots">
              {PAGES.map((p, i) => (
                <button
                  key={p}
                  className={i === page ? "dot on" : "dot"}
                  onClick={() => setPage(i)}
                  title={p}
                />
              ))}
            </div>

            {page === 0 && (
              <div className="page">
                {media ? (
                  <>
                    <div className="song">
                      <div className="t">{media.title}</div>
                      <div className="a">{media.artist}</div>
                    </div>
                    <div className="lyric">
                      {lyrics.length
                        ? (current >= 0 ? lyrics[current].text : "♪") || "♪"
                        : "No synced lyrics"}
                    </div>
                    <div className="bar">
                      <div
                        className="fill"
                        style={{ width: `${media.duration ? Math.min(100, (pos / media.duration) * 100) : 0}%` }}
                      />
                    </div>
                    <div className="times">
                      <span>{mmss(pos)}</span>
                      <span>{mmss(media.duration)}</span>
                    </div>
                    <div className="ctl">
                      <button onClick={() => ctl("prev")}>⏮</button>
                      <button className="big" onClick={() => ctl("toggle")}>
                        {media.playing ? "⏸" : "▶"}
                      </button>
                      <button onClick={() => ctl("next")}>⏭</button>
                    </div>
                  </>
                ) : (
                  <div className="empty">Nothing playing</div>
                )}
              </div>
            )}

            {page === 1 && (
              <div className="page center">
                <div className="big-num">{mmss(secs)}</div>
                <div className="sub">Pomodoro · Focus time</div>
                <div className="ctl">
                  <button onClick={() => setRunning((r) => !r)}>{running ? "Pause" : "Start"}</button>
                  <button
                    onClick={() => {
                      setRunning(false);
                      setSecs(FOCUS_SECONDS);
                    }}
                  >
                    Reset
                  </button>
                </div>
              </div>
            )}

            {page === 2 && (
              <div className="page center">
                <div className="big-num">
                  {(water / 1000).toFixed(2)} <small>/ {(WATER_GOAL / 1000).toFixed(1)} L</small>
                </div>
                <div className="bar wide">
                  <div className="fill blue" style={{ width: `${Math.min(100, (water / WATER_GOAL) * 100)}%` }} />
                </div>
                <div className="ctl">
                  <button onClick={() => addWater(250)}>+250 ml</button>
                  <button onClick={() => addWater(500)}>+500 ml</button>
                  <button onClick={() => addWater(-250)}>−250</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
