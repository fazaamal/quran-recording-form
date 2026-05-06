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
};

type Phase = "idle" | "countdown" | "recording" | "review";

/** Single source of truth for auto-stop duration (must match copy below). */
const RECORD_LETTER_MS = 2500;
const RECORD_WORD_MS = 4500;

function recordDurationMsForStimulus(s: Stimulus): number {
  return s.kind === "letter" ? RECORD_LETTER_MS : RECORD_WORD_MS;
}

function durationHintForStimulus(s: Stimulus): string {
  if (s.kind === "letter") {
    return `You will have about ${RECORD_LETTER_MS / 1000} seconds to pronounce this single letter.`;
  }
  return `You will have about ${RECORD_WORD_MS / 1000} seconds for this word.`;
}

function pickSupportedMimeType(): string {
  const preferred = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/mpeg",
  ];
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

export function RecorderStep({ stimuli, recordings, onRecording }: Props) {
  const [idx, setIdx] = useState(0);
  const stimulus = stimuli[idx]!;

  const [phase, setPhase] = useState<Phase>("idle");
  const [countdown, setCountdown] = useState(3);
  const [error, setError] = useState<string | null>(null);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewDurationMs, setPreviewDurationMs] = useState<number>(0);
  const [previewMimeType, setPreviewMimeType] = useState<string>("");
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const recordStartMsRef = useRef<number>(0);
  const countdownIntervalRef = useRef<number | null>(null);
  const countdownGenRef = useRef(0);
  const recordStopTimeoutRef = useRef<number | null>(null);
  const recordingRafRef = useRef<number | null>(null);
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
    // cleanup preview object URLs on stimulus change
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stimulus.id]);

  useEffect(() => {
    // When navigating, show saved recording as preview by default
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (currentSaved) {
      const url = URL.createObjectURL(currentSaved.blob);
      setPreviewUrl(url);
      setPreviewDurationMs(currentSaved.durationMs);
      setPreviewMimeType(currentSaved.mimeType);
      setPhase("review");
    } else {
      setPreviewUrl(null);
      setPreviewDurationMs(0);
      setPreviewMimeType("");
      setPhase("idle");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stimulus.id]);

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

  useEffect(() => {
    return () => {
      if (recordingRafRef.current != null) {
        cancelAnimationFrame(recordingRafRef.current);
        recordingRafRef.current = null;
      }
      if (recordStopTimeoutRef.current != null) {
        window.clearTimeout(recordStopTimeoutRef.current);
        recordStopTimeoutRef.current = null;
      }
      if (countdownIntervalRef.current != null) {
        window.clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
    };
  }, []);

  async function ensurePermission() {
    setError(null);
    try {
      if (streamRef.current) {
        return streamRef.current;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      return stream;
    } catch (e) {
      setError(
        "Microphone permission is required. Please allow microphone access and try again."
      );
      throw e;
    }
  }

  async function startCountdownAndRecord() {
    setError(null);
    if (countdownIntervalRef.current != null) {
      window.clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    clearRecordStopTimeout();

    try {
      await ensurePermission();
    } catch {
      return;
    }

    const gen = ++countdownGenRef.current;
    setPhase("countdown");
    setCountdown(3);

    let c = 3;
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
    }, 900);
    countdownIntervalRef.current = interval;
  }

  async function startRecording(expectedGen?: number) {
    if (expectedGen !== undefined && countdownGenRef.current !== expectedGen) {
      return;
    }
    try {
      const stream = await ensurePermission();
      const mimeType = pickSupportedMimeType();

      chunksRef.current = [];
      setPreviewMimeType(mimeType || "audio/webm");

      const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = mr;

      mr.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
      };

      mr.onerror = () => {
        clearRecordStopTimeout();
        clearRecordingAnimation();
        setError("Recording error. Please try again.");
        setPhase("idle");
      };

      mr.onstop = () => {
        clearRecordStopTimeout();
        clearRecordingAnimation();
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
        const url = URL.createObjectURL(blob);
        setPreviewUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
        const durationMs = Math.max(0, Math.round(msNow() - recordStartMsRef.current));
        setPreviewDurationMs(durationMs);
        setPreviewMimeType(mr.mimeType || blob.type || "audio/webm");
        setPhase("review");
      };

      setPhase("recording");
      recordStartMsRef.current = msNow();
      mr.start(250);

      const maxMs = recordDurationMsForStimulus(stimulus);
      clearRecordStopTimeout();
      recordStopTimeoutRef.current = window.setTimeout(() => {
        if (recorderRef.current && recorderRef.current.state === "recording") {
          recorderRef.current.stop();
        }
        recordStopTimeoutRef.current = null;
      }, maxMs);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start recording.");
      setPhase("idle");
    }
  }

  function stopRecordingEarly() {
    clearRecordStopTimeout();
    const mr = recorderRef.current;
    if (mr && mr.state === "recording") mr.stop();
  }

  async function saveRecording() {
    if (!previewUrl) return;
    const blob = await (await fetch(previewUrl)).blob();
    onRecording(stimulus.id, {
      stimulus,
      blob,
      mimeType: previewMimeType || blob.type || "audio/webm",
      durationMs: previewDurationMs,
    });
    // move to next if possible
    if (idx < stimuli.length - 1) setIdx((p) => p + 1);
  }

  function redo() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setPreviewDurationMs(0);
    setPreviewMimeType("");
    setPhase("idle");
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

      {phase === "idle" && (
        <div className="stack">
          <div className="muted">{durationHintForStimulus(stimulus)}</div>
          <div className="muted">
            When you are ready, press Record. A short countdown will start before recording begins.
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            <Button className="btn btn-primary" onClick={startCountdownAndRecord}>
              Record
            </Button>
          </div>
        </div>
      )}

      {phase === "countdown" && (
        <div className="stack" style={{ textAlign: "center" }}>
          <div style={{ fontSize: 46, fontWeight: 800 }}>{countdown}</div>
          <div className="muted">Get ready… recording will start automatically.</div>
          <div className="muted">{durationHintForStimulus(stimulus)}</div>
          <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
            <Button
              className="danger"
              onClick={() => {
                countdownGenRef.current += 1;
                if (countdownIntervalRef.current != null) {
                  window.clearInterval(countdownIntervalRef.current);
                  countdownIntervalRef.current = null;
                }
                setPhase("idle");
                setCountdown(3);
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
          <div className="muted">
            Speak clearly. Recording will stop automatically.
          </div>
          {recordingProgress && (
            <div className="stack" style={{ width: "100%", maxWidth: 420, margin: "0 auto" }}>
              <div className="progressBar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(recordingProgress.frac * 100)}>
                <div className="progressBarFill" style={{ width: `${recordingProgress.frac * 100}%` }} />
              </div>
              <div className="muted">
                Time remaining: {recordingProgress.remainingSec}s
              </div>
            </div>
          )}
          <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
            <Button className="danger" onClick={stopRecordingEarly}>
              Stop
            </Button>
          </div>
        </div>
      )}

      {phase === "review" && previewUrl && (
        <div className="stack">
          <div className="muted">
            Listen to your recording. If it’s good, save and continue. Otherwise, redo.
          </div>
          <audio ref={previewAudioRef} controls src={previewUrl} />
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Button onClick={redo} className="danger">
              Redo
            </Button>
            <Button className="primary" onClick={saveRecording}>
              Save & next
            </Button>
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
              ? "Save this recording before going to the next item"
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

