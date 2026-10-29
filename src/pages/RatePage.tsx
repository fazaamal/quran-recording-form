import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  AudioWaveform,
  Check,
  CircleHelp,
  Coffee,
  FileX,
  Headphones,
  Hand,
  LoaderCircle,
  MessageSquare,
  PartyPopper,
  Repeat,
  RotateCcw,
  TriangleAlert,
  Undo2,
  VolumeX,
} from "lucide-react";
import {
  apiRateSession,
  apiRateSubmit,
  apiRateUndo,
  type RateItem,
  type RateState,
} from "../utils/api";
import "./rate.css";

const LETTER_LABEL = { dad: "Ḍād ض", ayn: "ʿAyn ع" } as const;
const HARAKAH_LABEL = { fatha: "fatḥah", kasra: "kasrah", damma: "ḍammah", sukoon: "sukūn" } as const;
const PROBLEM_ICON: Record<string, typeof FileX> = {
  unplayable: FileX,
  silent: VolumeX,
  noisy: AudioWaveform,
  wrong_item: Repeat,
  other: MessageSquare,
};
const REPLAY_GAP_MS = 700;
const MAX_AUTO_PLAYS = 12;
const LOAD_TIMEOUT_MS = 10_000;
const BREAK_EVERY = 100;
const SAVED_FLASH_MS = 350;

type Phase = "loading" | "invalid" | "intro" | "rating" | "break" | "done";

export function RatePage({ token }: { token: string }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [name, setName] = useState("");
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [state, setState] = useState<RateState | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const sessionCount = useRef(0);

  useEffect(() => {
    apiRateSession(token)
      .then((s) => {
        setName(s.rater.name);
        setProblems(s.problems);
        setState(s);
        setPhase(s.current ? "intro" : "done");
      })
      .catch(() => setPhase("invalid"));
  }, [token]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  // Warm the browser cache for the next clip.
  useEffect(() => {
    if (!state?.preloadUrl) return;
    const a = new Audio();
    a.preload = "auto";
    a.src = state.preloadUrl;
  }, [state?.preloadUrl]);

  const player = usePlayer(phase === "rating" && !busy ? state?.current ?? null : null);

  const submit = useCallback(
    async (answer: { score?: number; problem?: string; note?: string }) => {
      if (!state?.current || busy) return;
      setBusy(true);
      setSheet(false);
      setSaved(answer.score ? String(answer.score) : "Flagged");
      player.stop();
      try {
        // Hold the "saved" flash long enough to register, even on a fast connection.
        const [next] = await Promise.all([
          apiRateSubmit({
            t: token,
            position: state.current.position,
            ...answer,
            plays: player.plays,
            ms: player.elapsedMs(),
          }),
          new Promise((r) => setTimeout(r, SAVED_FLASH_MS)),
        ]);
        sessionCount.current += 1;
        setState(next);
        if (!next.current) setPhase("done");
        else if (sessionCount.current % BREAK_EVERY === 0) setPhase("break");
      } catch {
        setToast("Couldn't save. Check your connection and try again.");
      } finally {
        setSaved(null);
        setBusy(false);
      }
    },
    [busy, player, state, token]
  );

  const undo = useCallback(async () => {
    if (!state?.canUndo || busy) return;
    setBusy(true);
    try {
      const prev = await apiRateUndo(token);
      sessionCount.current = Math.max(0, sessionCount.current - 1);
      setState(prev);
      setPhase("rating");
      setToast("Went back one clip");
    } catch {
      setToast("Couldn't undo. Try again.");
    } finally {
      setBusy(false);
    }
  }, [busy, state, token]);

  // Keyboard: 1–9 and 0 (=10) rate, space replays, U undoes, P opens audio problems.
  useEffect(() => {
    if (phase !== "rating") return;
    const onKey = (e: KeyboardEvent) => {
      if (sheet || e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^[0-9]$/.test(e.key) && player.heard) {
        e.preventDefault();
        void submit({ score: e.key === "0" ? 10 : Number(e.key) });
      } else if (e.key === " ") {
        e.preventDefault();
        player.replay();
      } else if (e.key.toLowerCase() === "u" || e.key === "Backspace") {
        e.preventDefault();
        void undo();
      } else if (e.key.toLowerCase() === "p") {
        e.preventDefault();
        setSheet(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, player, sheet, submit, undo]);

  const pct = state && state.total ? (state.done / state.total) * 100 : 0;

  return (
    <div className="rate">
      <div className="rate-progress" aria-hidden>
        <div style={{ width: `${pct}%` }} />
      </div>

      {phase === "loading" && (
        <Screen icon={<LoaderCircle className="animate-spin" />} title="Loading…" />
      )}

      {phase === "invalid" && (
        <Screen
          icon={<TriangleAlert />}
          title="This link doesn't work"
          text="Check that you opened the full link you were sent, or ask the researcher for a new one."
        />
      )}

      {phase === "intro" && state && (
        <Intro
          name={name}
          resuming={state.done > 0}
          done={state.done}
          total={state.total}
          onStart={() => setPhase("rating")}
        />
      )}

      {phase === "break" && state && (
        <Screen
          icon={<Coffee />}
          title="Time for a short break"
          text={`You've rated ${sessionCount.current} clips in a row. Rest your ears for a few minutes; your place is saved, so you can also close this page and come back later.`}
        >
          <button className="rate-btn is-primary" onClick={() => setPhase("rating")}>
            Continue rating
          </button>
        </Screen>
      )}

      {phase === "done" && (
        <Screen
          icon={<PartyPopper />}
          title="All done. Thank you!"
          text={`You rated every clip${state ? ` (${state.total.toLocaleString()} in total)` : ""}. You can close this page.`}
        >
          {state?.canUndo && (
            <button className="rate-btn" onClick={() => void undo()} disabled={busy}>
              <Undo2 /> Change my last answer
            </button>
          )}
        </Screen>
      )}

      {phase === "rating" && state?.current && (
        <>
          <div className="rate-top">
            <span>
              <strong>{(state.done + 1).toLocaleString()}</strong> of {state.total.toLocaleString()}
            </span>
            <span>{Math.round(pct)}% done</span>
          </div>

          <main className="rate-main">
            <PromptCard
              key={state.current.position}
              item={state.current}
              player={player}
              saved={saved}
              onMarkUnplayable={() => void submit({ problem: "unplayable" })}
            />

            <ScoreBar
              locked={!player.heard || busy}
              saving={busy}
              lockedHint={player.failed ? "This clip can't be scored. Skip it with the buttons above." : undefined}
              onCommit={(score) => void submit({ score })}
            />

            <div className="rate-actions">
              <button className="rate-btn" onClick={() => void undo()} disabled={!state.canUndo || busy}>
                <Undo2 /> Undo
              </button>
              <button className="rate-btn is-warn" onClick={() => setSheet(true)} disabled={busy}>
                <TriangleAlert /> Audio problem
              </button>
            </div>

            <div className="rate-kbd">
              <kbd>1</kbd>–<kbd>9</kbd>, <kbd>0</kbd> = 10 · <kbd>Space</kbd> replay · <kbd>U</kbd> undo ·{" "}
              <kbd>P</kbd> audio problem
            </div>
          </main>
        </>
      )}

      {sheet && (
        <ProblemSheet
          problems={problems}
          suggested={player.failed ? "unplayable" : null}
          onPick={(problem, note) => void submit({ problem, note })}
          onClose={() => setSheet(false)}
        />
      )}

      {toast && <div className="rate-toast" role="status">{toast}</div>}
    </div>
  );
}

/* ─── Audio ─────────────────────────────────────────────────────────────── */

type Player = ReturnType<typeof usePlayer>;

/** Plays the current clip on a loop with a short gap. `heard` turns true after one full play. */
function usePlayer(item: RateItem | null) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const gapTimer = useRef<number | undefined>(undefined);
  const loadTimer = useRef<number | undefined>(undefined);
  const startedAt = useRef<number | null>(null);
  const playsRef = useRef(0);
  const [plays, setPlays] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [heard, setHeard] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!audioRef.current && typeof Audio !== "undefined") audioRef.current = new Audio();

  const clearTimers = () => {
    window.clearTimeout(gapTimer.current);
    window.clearTimeout(loadTimer.current);
  };

  const start = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = 0;
    a.play().catch((e: DOMException) => {
      if (e.name !== "AbortError" && e.name !== "NotAllowedError") setFailed(true);
    });
  }, []);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    clearTimers();
    a.pause();
    playsRef.current = 0;
    setPlays(0);
    setPlaying(false);
    setProgress(0);
    setHeard(false);
    setFailed(false);
    startedAt.current = null;
    if (!item) return;

    const fail = () => {
      clearTimers();
      setPlaying(false);
      setFailed(true);
    };
    const onPlaying = () => {
      window.clearTimeout(loadTimer.current);
      startedAt.current ??= performance.now();
      setPlaying(true);
    };
    const onTime = () => setProgress(a.duration ? a.currentTime / a.duration : 0);
    const onMeta = () => {
      if (!Number.isFinite(a.duration) || a.duration < 0.15) fail();
    };
    const onEnded = () => {
      setPlaying(false);
      setProgress(1);
      playsRef.current += 1;
      setPlays(playsRef.current);
      setHeard(true);
      if (playsRef.current < MAX_AUTO_PLAYS) gapTimer.current = window.setTimeout(start, REPLAY_GAP_MS);
    };

    a.addEventListener("playing", onPlaying);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onMeta);
    a.addEventListener("ended", onEnded);
    a.addEventListener("error", fail);
    a.src = item.audioUrl;
    a.load();
    loadTimer.current = window.setTimeout(fail, LOAD_TIMEOUT_MS);
    start();

    return () => {
      clearTimers();
      a.pause();
      a.removeEventListener("playing", onPlaying);
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", onMeta);
      a.removeEventListener("ended", onEnded);
      a.removeEventListener("error", fail);
    };
  }, [item?.position, item?.audioUrl, start]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    plays,
    playing,
    progress,
    heard,
    failed,
    replay: () => {
      clearTimers();
      setFailed(false);
      start();
    },
    retry: () => {
      const a = audioRef.current;
      if (!a || !item) return;
      setFailed(false);
      a.src = item.audioUrl;
      a.load();
      loadTimer.current = window.setTimeout(() => setFailed(true), LOAD_TIMEOUT_MS);
      start();
    },
    stop: () => {
      clearTimers();
      audioRef.current?.pause();
    },
    elapsedMs: () => (startedAt.current ? Math.round(performance.now() - startedAt.current) : 0),
  };
}

/* ─── Prompt ────────────────────────────────────────────────────────────── */

function PromptCard({
  item,
  player,
  saved,
  onMarkUnplayable,
}: {
  item: RateItem;
  player: Player;
  saved: string | null;
  onMarkUnplayable: () => void;
}) {
  const r = 14;
  const circ = 2 * Math.PI * r;
  return (
    <div className="rate-card">
      <div className="rate-tags">
        <span className="rate-tag">{LETTER_LABEL[item.letter]}</span>
        <span className="rate-tag">{HARAKAH_LABEL[item.harakah]}</span>
        <span className="rate-tag">{item.kind === "letter" ? "Letter" : "Word"}</span>
      </div>

      <div className={`rate-glyph ${item.kind === "letter" ? "is-letter" : "is-word"}`}>{item.textAr}</div>

      {player.failed ? (
        <div className="rate-error">
          <div className="title">
            <TriangleAlert size={18} /> This clip won't play
          </div>
          <p>It may be corrupt or empty. Try once more, or mark it and move on.</p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
            <button className="rate-btn" onClick={player.retry}>
              <RotateCcw /> Try again
            </button>
            <button className="rate-btn is-warn" onClick={onMarkUnplayable}>
              <FileX /> Mark as unplayable
            </button>
          </div>
        </div>
      ) : (
        <button
          className="rate-listen"
          onClick={player.replay}
          style={{ background: "none", border: 0, padding: 4 }}
          aria-label="Replay clip"
        >
          <svg className="rate-ring" viewBox="0 0 34 34" aria-hidden>
            <circle className="track" cx="17" cy="17" r={r} />
            <circle
              className="fill"
              cx="17"
              cy="17"
              r={r}
              strokeDasharray={circ}
              strokeDashoffset={circ * (1 - player.progress)}
              transform="rotate(-90 17 17)"
            />
          </svg>
          <span className={`rate-bars ${player.playing ? "is-on" : ""}`} aria-hidden>
            <span />
            <span />
            <span />
            <span />
          </span>
          <span>{player.playing ? "Playing" : player.heard ? "Tap to replay" : "Loading audio…"}</span>
          <span className="rate-dots" aria-label={`Played ${player.plays} times`}>
            {Array.from({ length: Math.min(player.plays, 6) }, (_, i) => (
              <i key={i} className="on" />
            ))}
          </span>
        </button>
      )}

      {saved && (
        <div className="rate-saved">
          <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Check size={36} strokeWidth={3} /> {saved}
          </span>
        </div>
      )}
    </div>
  );
}

/* ─── Score bar ─────────────────────────────────────────────────────────── */

/** Drag (or tap) along the bar; releasing commits the score. Starts empty, no default. */
function ScoreBar({
  locked,
  saving,
  lockedHint,
  onCommit,
}: {
  locked: boolean;
  saving: boolean;
  lockedHint?: string;
  onCommit: (score: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);

  const valueAt = (clientX: number) => {
    const rect = ref.current!.getBoundingClientRect();
    const x = Math.min(Math.max(clientX - rect.left, 0), rect.width - 1);
    return Math.floor((x / rect.width) * 10) + 1;
  };

  return (
    <div className="rate-score">
      <div className="rate-score-head">
        <span>1 · Clearly incorrect</span>
        <span>Fully correct · 10</span>
      </div>
      <div
        ref={ref}
        className={`rate-bar ${locked ? "is-locked" : ""}`}
        role="slider"
        aria-label="Score from 1 to 10"
        aria-valuemin={1}
        aria-valuemax={10}
        aria-valuenow={value ?? undefined}
        aria-disabled={locked}
        onPointerDown={(e) => {
          if (locked) return;
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // Capture can fail for synthetic pointers; dragging still works within the bar.
          }
          setDragging(true);
          setValue(valueAt(e.clientX));
        }}
        onPointerMove={(e) => dragging && setValue(valueAt(e.clientX))}
        onPointerUp={(e) => {
          if (!dragging) return;
          setDragging(false);
          const v = valueAt(e.clientX);
          setValue(null);
          onCommit(v);
        }}
        onPointerCancel={() => {
          setDragging(false);
          setValue(null);
        }}
      >
        {value !== null && <div className="rate-bar-fill" style={{ width: `${value * 10}%` }} />}
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} className={`rate-bar-cell ${value !== null && i < value ? "is-in" : ""}`}>
            {i + 1}
          </div>
        ))}
        {value !== null && (
          <div className="rate-bubble" style={{ left: `${value * 10 - 5}%` }}>
            {value}
          </div>
        )}
      </div>
      <div className="rate-hint">
        {saving
          ? "Saving…"
          : locked
            ? (lockedHint ?? "Listen to the clip once, then slide to score")
            : dragging
              ? "Release to save"
              : "Slide or tap to score"}
      </div>
    </div>
  );
}

/* ─── Audio problem sheet ───────────────────────────────────────────────── */

function ProblemSheet({
  problems,
  suggested,
  onPick,
  onClose,
}: {
  problems: Record<string, string>;
  suggested: string | null;
  onPick: (problem: string, note?: string) => void;
  onClose: () => void;
}) {
  const [other, setOther] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="rate-scrim" onClick={onClose}>
      <div className="rate-sheet" role="dialog" aria-label="Audio problem" onClick={(e) => e.stopPropagation()}>
        <div className="rate-sheet-handle" />
        <h2>What's wrong with this clip?</h2>
        <p>It will be skipped without a score.</p>
        {other ? (
          <>
            <textarea
              autoFocus
              placeholder="Describe the problem (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
            />
            <div className="rate-actions">
              <button className="rate-btn" onClick={() => setOther(false)}>
                Back
              </button>
              <button className="rate-btn is-primary" onClick={() => onPick("other", note.trim() || undefined)}>
                Skip this clip
              </button>
            </div>
          </>
        ) : (
          <>
            {Object.entries(problems).map(([key, label]) => {
              const Icon = PROBLEM_ICON[key] ?? CircleHelp;
              return (
                <button
                  key={key}
                  className={`rate-option ${suggested === key ? "is-suggested" : ""}`}
                  onClick={() => (key === "other" ? setOther(true) : onPick(key))}
                >
                  <Icon /> {label}
                </button>
              );
            })}
            <button className="rate-btn" style={{ marginTop: 6 }} onClick={onClose}>
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/* ─── Full-screen states ────────────────────────────────────────────────── */

function Screen({
  icon,
  title,
  text,
  children,
}: {
  icon: ReactNode;
  title: string;
  text?: string;
  children?: ReactNode;
}) {
  return (
    <div className="rate-screen">
      <div className="rate-panel">
        <div className="rate-icon">{icon}</div>
        <h1>{title}</h1>
        {text && <p>{text}</p>}
        {children}
      </div>
    </div>
  );
}

function Intro({
  name,
  resuming,
  done,
  total,
  onStart,
}: {
  name: string;
  resuming: boolean;
  done: number;
  total: number;
  onStart: () => void;
}) {
  return (
    <div className="rate-screen">
      <div className="rate-panel">
        <div className="rate-icon">
          <Headphones />
        </div>
        <h1>{resuming ? `Welcome back, ${name}` : `Assalamu ʿalaykum, ${name}`}</h1>
        <p>
          {resuming
            ? `You've rated ${done.toLocaleString()} of ${total.toLocaleString()} clips. Pick up where you left off.`
            : `You'll hear ${total.toLocaleString()} short recordings of ض and ع. Score how correctly each one is articulated.`}
        </p>
        <ul className="rate-steps">
          <li>
            <Headphones /> <span>Use headphones in a quiet place.</span>
          </li>
          <li>
            <Repeat /> <span>Each clip plays on repeat. The letter or word being read is shown above it.</span>
          </li>
          <li>
            <Hand />
            <span>
              Slide along the bar and let go to save a score from 1 (clearly incorrect) to 10 (fully correct).
              Undo takes you back one clip.
            </span>
          </li>
          <li>
            <TriangleAlert />
            <span>
              If a clip won't play, is silent, or is the wrong letter, use <b>Audio problem</b> instead of
              scoring it.
            </span>
          </li>
          <li>
            <Coffee /> <span>Your progress saves after every clip. Take breaks whenever you need.</span>
          </li>
        </ul>
        <button className="rate-btn is-primary" onClick={onStart}>
          {resuming ? "Continue" : "Start rating"}
        </button>
      </div>
    </div>
  );
}
