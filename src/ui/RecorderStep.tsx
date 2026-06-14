import { useEffect, useMemo, useRef, useState } from "react";
import type { Stimulus } from "../stimuli";
import { Button } from "@/components/ui/button";

type RecordingBlob = {
  stimulus: Stimulus;
  blob: Blob;
  mimeType: string;
  durationMs: number;
};

type Props = {
  stimuli: Stimulus[];
  recordings: Record<string, RecordingBlob | undefined>;
  onRecording: (stimulusId: string, rec: RecordingBlob) => void;
  onClearRecording?: (stimulusId: string) => void;
  /** Mic stream acquired on the mic step — reused for all 16 recordings. */
  sharedStream?: MediaStream | null;
};

type Phase = "idle" | "countdown" | "recording" | "review";

const RECORD_LETTER_MS = 2500;
const RECORD_WORD_MS = 4500;
const COUNTDOWN_SECONDS = 1;
const COUNTDOWN_TICK_MS = 800;
const MIN_BLOB_BYTES = 512;
const MAX_RECORD_RETRIES = 2;

function recordDurationMsForStimulus(s: Stimulus): number {
  return s.kind === "letter" ? RECORD_LETTER_MS : RECORD_WORD_MS;
}

function durationHintForStimulus(s: Stimulus): string {
  if (s.kind === "letter") {
    return `You will have about ${RECORD_LETTER_MS / 1000} seconds to pronounce this single letter.`;
  }
  return `You will have about ${RECORD_WORD_MS / 1000} seconds for this word.`;
}

function isIosDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function pickSupportedMimeType(): string {
  const iosPreferred = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/mpeg"];
  const defaultPreferred = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/mpeg",
  ];
  const preferred = isIosDevice() ? iosPreferred : defaultPreferred;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const MR: any = (window as any).MediaRecorder;
  if (!MR?.isTypeSupported) return "";
  for (const t of preferred) {
    if (MR.isTypeSupported(t)) return t;
  }
  return "";
}

function msNow() {
  return performance?.now ? performance.now() : Date.now();
}

export function RecorderStep({
  stimuli,
  recordings,
  onRecording,
  onClearRecording,
  sharedStream,
}: Props) {
  const [idx, setIdx] = useState(0);
  const stimulus = stimuli[idx]!;

  const [phase, setPhase] = useState<Phase>("idle");
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const [error, setError] = useState<string | null>(null);
  const [statusHint, setStatusHint] = useState<string | null>(null);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewDurationMs, setPreviewDurationMs] = useState<number>(0);
  const [previewMimeType, setPreviewMimeType] = useState<string>("");

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const sharedStreamRef = useRef(sharedStream);
  sharedStreamRef.current = sharedStream;
  const previewBlobRef = useRef<Blob | null>(null);
  const recordStartMsRef = useRef<number>(0);
  const countdownIntervalRef = useRef<number | null>(null);
  const countdownGenRef = useRef(0);
  const recordStopTimeoutRef = useRef<number | null>(null);
  const recordingRafRef = useRef<number | null>(null);
  const recordRetryRef = useRef(0);
  const [recordingProgress, setRecordingProgress] = useState<{
    frac: number;
    remainingSec: number;
  } | null>(null);

  const completedCount = useMemo(
    () => Object.values(recordings).filter(Boolean).length,
    [recordings]
  );

  const currentSaved = recordings[stimulus.id];

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stimulus.id]);

  useEffect(() => {
    if (phase === "recording" || phase === "countdown") return;

    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setError(null);
    setStatusHint(null);
    if (currentSaved) {
      previewBlobRef.current = currentSaved.blob;
      const url = URL.createObjectURL(currentSaved.blob);
      setPreviewUrl(url);
      setPreviewDurationMs(currentSaved.durationMs);
      setPreviewMimeType(currentSaved.mimeType);
      setPhase("review");
    } else {
      previewBlobRef.current = null;
      setPreviewUrl(null);
      setPreviewDurationMs(0);
      setPreviewMimeType("");
      setPhase("idle");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stimulus.id, currentSaved]);

  useEffect(() => {
    return () => {
      if (recordingRafRef.current != null) cancelAnimationFrame(recordingRafRef.current);
      if (recordStopTimeoutRef.current != null) window.clearTimeout(recordStopTimeoutRef.current);
      if (countdownIntervalRef.current != null) window.clearInterval(countdownIntervalRef.current);
      // Don't stop the shared stream — parent owns it.
      const owned = streamRef.current;
      if (owned && owned !== sharedStreamRef.current) {
        owned.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  function clearRecordingAnimation() {
    if (recordingRafRef.current != null) {
      cancelAnimationFrame(recordingRafRef.current);
      recordingRafRef.current = null;
    }
    setRecordingProgress(null);
  }

  function clearRecordStopTimeout() {
    if (recordStopTimeoutRef.current != null) {
      window.clearTimeout(recordStopTimeoutRef.current);
      recordStopTimeoutRef.current = null;
    }
  }

  function clearCountdown() {
    if (countdownIntervalRef.current != null) {
      window.clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
  }

  useEffect(() => {
    if (phase !== "recording") {
      clearRecordingAnimation();
      return;
    }
    const total = recordDurationMsForStimulus(stimulus);
    const tick = () => {
      const elapsed = msNow() - recordStartMsRef.current;
      const frac = total > 0 ? Math.min(1, Math.max(0, elapsed / total)) : 1;
      const remainingMs = Math.max(0, total - elapsed);
      const remainingSec = Math.max(0, Math.ceil(remainingMs / 1000));
      setRecordingProgress({ frac, remainingSec });
      if (remainingMs <= 0) {
        recordingRafRef.current = null;
        return;
      }
      recordingRafRef.current = requestAnimationFrame(tick);
    };
    recordingRafRef.current = requestAnimationFrame(tick);
    return () => {
      if (recordingRafRef.current != null) {
        cancelAnimationFrame(recordingRafRef.current);
        recordingRafRef.current = null;
      }
    };
  }, [phase, stimulus.id, stimulus.kind]);

  async function ensurePermission() {
    const shared = sharedStreamRef.current;
    if (shared && shared.getTracks().every((t) => t.readyState === "live")) {
      streamRef.current = shared;
      return shared;
    }

    const existing = streamRef.current;
    if (existing && existing !== shared && existing.getTracks().every((t) => t.readyState === "live")) {
      return existing;
    }

    if (existing && existing !== shared) {
      existing.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      return stream;
    } catch {
      setError("Microphone access is required. Please allow the microphone and tap Record again.");
      throw new Error("mic denied");
    }
  }

  function commitRecording(blob: Blob, mimeType: string, durationMs: number) {
    onRecording(stimulus.id, {
      stimulus,
      blob,
      mimeType,
      durationMs,
    });
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewBlobRef.current = null;
    setPreviewUrl(null);
    setPreviewDurationMs(0);
    setPreviewMimeType("");
    setStatusHint(null);
    setPhase("idle");
    if (idx < stimuli.length - 1) setIdx((p) => p + 1);
  }

  async function startRecording(expectedGen?: number, isRetry = false) {
    if (expectedGen !== undefined && countdownGenRef.current !== expectedGen) return;

    try {
      const stream = await ensurePermission();
      const mimeType = pickSupportedMimeType();

      chunksRef.current = [];
      setPreviewMimeType(mimeType || "audio/webm");
      if (isRetry) setStatusHint("Retrying recording…");

      const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = mr;

      mr.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
      };

      const scheduleRetry = () => {
        if (recordRetryRef.current < MAX_RECORD_RETRIES) {
          recordRetryRef.current++;
          window.setTimeout(() => void startRecording(expectedGen, true), 300);
          return true;
        }
        recordRetryRef.current = 0;
        return false;
      };

      mr.onerror = () => {
        clearRecordStopTimeout();
        clearRecordingAnimation();
        if (scheduleRetry()) return;
        setStatusHint(null);
        setError("Recording failed — tap Record to try again.");
        setPhase("idle");
      };

      mr.onstop = () => {
        clearRecordStopTimeout();
        clearRecordingAnimation();
        const resolvedMime = mr.mimeType || mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: resolvedMime });
        const durationMs = Math.max(0, Math.round(msNow() - recordStartMsRef.current));

        if (blob.size < MIN_BLOB_BYTES) {
          if (scheduleRetry()) return;
          setStatusHint(null);
          setError("Recording was too short — tap Record to try again.");
          setPhase("idle");
          return;
        }

        recordRetryRef.current = 0;
        setStatusHint(null);
        setError(null);
        commitRecording(blob, resolvedMime, durationMs);
      };

      setPhase("recording");
      recordStartMsRef.current = msNow();
      mr.start(250);

      const maxMs = recordDurationMsForStimulus(stimulus);
      clearRecordStopTimeout();
      recordStopTimeoutRef.current = window.setTimeout(() => {
        if (recorderRef.current?.state === "recording") recorderRef.current.stop();
        recordStopTimeoutRef.current = null;
      }, maxMs);
    } catch (e) {
      if (e instanceof Error && e.message === "mic denied") return;
      setStatusHint(null);
      setError(e instanceof Error ? e.message : "Could not start recording — tap Record to try again.");
      setPhase("idle");
    }
  }

  async function beginRecording(skipCountdown: boolean) {
    setError(null);
    clearCountdown();
    clearRecordStopTimeout();
    recordRetryRef.current = 0;

    try {
      await ensurePermission();
    } catch {
      return;
    }

    const gen = ++countdownGenRef.current;

    if (skipCountdown) {
      void startRecording(gen);
      return;
    }

    setPhase("countdown");
    setCountdown(COUNTDOWN_SECONDS);

    let c = COUNTDOWN_SECONDS;
    const interval = window.setInterval(() => {
      if (countdownGenRef.current !== gen) {
        window.clearInterval(interval);
        return;
      }
      c -= 1;
      setCountdown(c);
      if (c <= 0) {
        window.clearInterval(interval);
        countdownIntervalRef.current = null;
        void startRecording(gen);
      }
    }, COUNTDOWN_TICK_MS);
    countdownIntervalRef.current = interval;
  }

  function stopRecordingEarly() {
    clearRecordStopTimeout();
    const mr = recorderRef.current;
    if (mr?.state === "recording") mr.stop();
  }

  function redo() {
    setError(null);
    setStatusHint(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setPreviewDurationMs(0);
    setPreviewMimeType("");
    previewBlobRef.current = null;
    if (currentSaved) onClearRecording?.(stimulus.id);
    void beginRecording(true);
  }

  return (
    <div className="stack">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div className="pill">
          Item {idx + 1}/{stimuli.length} • {stimulus.kind === "letter" ? "Letter" : "Word"}
        </div>
        <div className="pill">Completed: {completedCount}/{stimuli.length}</div>
      </div>

      <div className="stack" style={{ alignItems: "center", textAlign: "center" }}>
        <div className="arabic" aria-label={stimulus.hint}>
          {stimulus.arabic}
        </div>
        <div className="muted">{stimulus.hint}</div>
      </div>

      {error && <div style={{ color: "var(--danger)" }}>{error}</div>}
      {statusHint && !error && <div className="muted">{statusHint}</div>}

      {phase === "idle" && !currentSaved && (
        <div className="stack">
          <div className="muted">{durationHintForStimulus(stimulus)}</div>
          <div className="muted">
            Tap Record when ready. Recording saves automatically when it finishes.
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            <Button className="btn btn-primary" onClick={() => void beginRecording(false)}>
              Record
            </Button>
          </div>
        </div>
      )}

      {phase === "countdown" && (
        <div className="stack" style={{ textAlign: "center" }}>
          <div style={{ fontSize: 46, fontWeight: 800 }}>{countdown}</div>
          <div className="muted">Get ready… recording will start automatically.</div>
          <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
            <Button
              className="danger"
              onClick={() => {
                countdownGenRef.current += 1;
                clearCountdown();
                setPhase("idle");
                setCountdown(COUNTDOWN_SECONDS);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {phase === "recording" && (
        <div className="stack" style={{ textAlign: "center" }}>
          <div className="pill" style={{ justifyContent: "center" }}>
            Recording…
          </div>
          <div className="muted">Speak clearly. Recording will stop and save automatically.</div>
          {recordingProgress && (
            <div className="stack" style={{ width: "100%", maxWidth: 420, margin: "0 auto" }}>
              <div
                className="progressBar"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(recordingProgress.frac * 100)}
              >
                <div
                  className="progressBarFill"
                  style={{ width: `${recordingProgress.frac * 100}%` }}
                />
              </div>
              <div className="muted">Time remaining: {recordingProgress.remainingSec}s</div>
            </div>
          )}
          <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
            <Button className="danger" onClick={stopRecordingEarly}>
              Stop
            </Button>
          </div>
        </div>
      )}

      {phase === "review" && previewUrl && currentSaved && (
        <div className="stack">
          <div className="muted">
            Saved. Listen if you like, or tap Redo to re-record this item.
          </div>
          <audio controls src={previewUrl} />
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Button onClick={redo} className="danger">
              Redo
            </Button>
            {idx < stimuli.length - 1 && (
              <Button className="primary" onClick={() => setIdx((p) => p + 1)}>
                Next item
              </Button>
            )}
          </div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
        <Button disabled={idx === 0} onClick={() => setIdx((p) => Math.max(0, p - 1))}>
          Previous
        </Button>
        <Button
          disabled={idx >= stimuli.length - 1 || !recordings[stimulus.id]}
          title={
            !recordings[stimulus.id]
              ? "Complete this recording before going to the next item"
              : undefined
          }
          onClick={() => setIdx((p) => Math.min(stimuli.length - 1, p + 1))}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
