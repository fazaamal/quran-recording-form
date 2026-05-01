import { useMemo, useState } from "react";
import { Stimulus, stimuli } from "../stimuli";
import { SignaturePad } from "../ui/SignaturePad";
import { RecorderStep } from "../ui/RecorderStep";
import { apiCreateUploadUrls, apiSubmitResponse } from "../utils/api";

type TajweedLevel = "beginner" | "intermediate" | "advanced" | "teacher" | "other";

type ParticipantInfo = {
  tajweedLevel: TajweedLevel;
  yearsReading: number | "";
  age: number | "";
  ethnicity: string;
  hadTajweedClasses: boolean | null;
};

type Step = "welcome" | "environment" | "info" | "consent" | "mic" | "recordings" | "done";

type RecordingBlob = {
  stimulus: Stimulus;
  blob: Blob;
  mimeType: string;
  durationMs: number;
};

export function ParticipantFlow() {
  const [step, setStep] = useState<Step>("welcome");
  const [info, setInfo] = useState<ParticipantInfo>({
    tajweedLevel: "beginner",
    yearsReading: "",
    age: "",
    ethnicity: "",
    hadTajweedClasses: null,
  });
  const [signaturePngDataUrl, setSignaturePngDataUrl] = useState<string | null>(null);
  const [micReady, setMicReady] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);

  const [recordings, setRecordings] = useState<Record<string, RecordingBlob | undefined>>({});
  const allDone = useMemo(
    () => stimuli.every((s) => Boolean(recordings[s.id]?.blob)),
    [recordings]
  );

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [resultId, setResultId] = useState<string | null>(null);

  async function enableMicrophone() {
    setMicError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const t of stream.getTracks()) t.stop();
      setMicReady(true);
    } catch (e) {
      setMicReady(false);
      setMicError(
        e instanceof Error ? e.message : "Could not access the microphone. Please check permissions."
      );
    }
  }

  async function submitAll() {
    if (!signaturePngDataUrl) {
      setSubmitError("Please add your signature before submitting.");
      return;
    }
    if (!allDone) {
      setSubmitError("Please complete all 16 recordings before submitting.");
      return;
    }
    if (info.hadTajweedClasses === null) {
      setSubmitError("Please complete the survey (including tajweed classes question).");
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      const signaturePngBlob = await (await fetch(signaturePngDataUrl)).blob();

      const uploadPlan = await apiCreateUploadUrls({
        recordings: stimuli.map((s) => {
          const rec = recordings[s.id]!;
          return { stimulusId: s.id, contentType: rec.mimeType };
        }),
        signature: { contentType: "image/png" },
      });

      await fetch(uploadPlan.signature.putUrl, {
        method: "PUT",
        headers: { "Content-Type": "image/png" },
        body: signaturePngBlob,
      });

      for (const s of stimuli) {
        const rec = recordings[s.id]!;
        const putUrl = uploadPlan.recordings[s.id]?.putUrl;
        if (!putUrl) throw new Error(`Missing upload URL for ${s.id}`);
        await fetch(putUrl, {
          method: "PUT",
          headers: { "Content-Type": rec.mimeType },
          body: rec.blob,
        });
      }

      const submitRes = await apiSubmitResponse({
        participant: {
          tajweedLevel: info.tajweedLevel,
          yearsReading: Number(info.yearsReading || 0),
          age: Number(info.age || 0),
          ethnicity: info.ethnicity.trim(),
          hadTajweedClasses: info.hadTajweedClasses,
        },
        signature: {
          s3Key: uploadPlan.signature.s3Key,
        },
        recordings: stimuli.map((s) => {
          const rec = recordings[s.id]!;
          return {
            stimulusId: s.id,
            stimulusTextAr: s.arabic,
            kind: s.kind,
            letter: s.letter,
            harakah: s.harakah,
            s3Key: uploadPlan.recordings[s.id]!.s3Key,
            contentType: rec.mimeType,
            durationMs: rec.durationMs,
          };
        }),
      });

      setResultId(submitRes.responseId);
      setStep("done");
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Submit failed");
    } finally {
      setSubmitting(false);
    }
  }

  const infoComplete =
    info.hadTajweedClasses !== null &&
    info.ethnicity.trim() !== "" &&
    info.age !== "" &&
    info.yearsReading !== "";

  return (
    <div className="stack">
      {step === "welcome" && (
        <div className="card stack">
          <div style={{ fontSize: 20, fontWeight: 750 }}>
            السلام عليكم ورحمة الله وبركاته
          </div>
          <div className="muted">
            Thank you for participating in this Masters research project. جزاك الله خيرا
          </div>
          <div className="muted">
            You will see brief guidance on recording conditions, answer a short survey, sign the
            consent form, enable your microphone, then record 16 short audio clips.
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button className="primary" onClick={() => setStep("environment")}>
              Start
            </button>
            <a className="pill" href="/pdf/consent_form.pdf" target="_blank" rel="noreferrer">
              View consent PDF
            </a>
          </div>
        </div>
      )}

      {step === "environment" && (
        <div className="card stack">
          <div style={{ fontSize: 18, fontWeight: 750 }}>Before you begin</div>
          <ul className="muted" style={{ margin: 0, paddingLeft: 20, lineHeight: 1.6 }}>
            <li>Choose a <strong>quiet</strong> environment with as little background noise as possible.</li>
            <li>
              Hold your phone or sit at your computer so your mouth is about <strong>10 cm</strong>{" "}
              from the microphone while you pronounce each prompt.
            </li>
            <li>Close windows, fans, or other noise sources if you can.</li>
          </ul>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button onClick={() => setStep("welcome")}>Back</button>
            <button className="primary" onClick={() => setStep("info")}>
              Continue
            </button>
          </div>
        </div>
      )}

      {step === "info" && (
        <div className="card stack">
          <div style={{ fontSize: 18, fontWeight: 750 }}>Participant information</div>
          <div className="row">
            <label>
              Tajwīd proficiency level
              <select
                value={info.tajweedLevel}
                onChange={(e) => setInfo((p) => ({ ...p, tajweedLevel: e.target.value as TajweedLevel }))}
              >
                <option value="beginner">Beginner</option>
                <option value="intermediate">Intermediate</option>
                <option value="advanced">Advanced</option>
                <option value="teacher">Teacher / Ijāzah holder</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label>
              Years reading Quran (approx.)
              <input
                inputMode="numeric"
                value={info.yearsReading}
                onChange={(e) => setInfo((p) => ({ ...p, yearsReading: e.target.value === "" ? "" : Number(e.target.value) }))}
                placeholder="e.g. 5"
              />
            </label>
          </div>
          <div className="row">
            <label>
              Age
              <input
                inputMode="numeric"
                value={info.age}
                onChange={(e) => setInfo((p) => ({ ...p, age: e.target.value === "" ? "" : Number(e.target.value) }))}
                placeholder="e.g. 23"
              />
            </label>
            <label>
              Ethnicity
              <input
                value={info.ethnicity}
                onChange={(e) => setInfo((p) => ({ ...p, ethnicity: e.target.value }))}
                placeholder="e.g. Malay"
              />
            </label>
          </div>
          <fieldset style={{ border: "1px solid var(--border)", borderRadius: 12, padding: "12px 14px", margin: 0 }}>
            <legend style={{ padding: "0 6px", color: "var(--muted)", fontSize: 13 }}>
              Have you attended formal tajweed classes before?
            </legend>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <label style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <input
                  type="radio"
                  name="hadTajweed"
                  checked={info.hadTajweedClasses === true}
                  onChange={() => setInfo((p) => ({ ...p, hadTajweedClasses: true }))}
                />
                Yes
              </label>
              <label style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <input
                  type="radio"
                  name="hadTajweed"
                  checked={info.hadTajweedClasses === false}
                  onChange={() => setInfo((p) => ({ ...p, hadTajweedClasses: false }))}
                />
                No
              </label>
            </div>
          </fieldset>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button onClick={() => setStep("environment")}>Back</button>
            <button className="primary" disabled={!infoComplete} onClick={() => setStep("consent")}>
              Continue
            </button>
          </div>
        </div>
      )}

      {step === "consent" && (
        <div className="card stack">
          <div style={{ fontSize: 18, fontWeight: 750 }}>Consent & signature</div>
          <div className="muted">
            Please read the consent form and provide your handwritten signature below.
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <a className="pill" href="/pdf/consent_form.pdf" target="_blank" rel="noreferrer">
              Open consent PDF
            </a>
          </div>
          <SignaturePad value={signaturePngDataUrl} onChange={setSignaturePngDataUrl} />
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button onClick={() => setStep("info")}>Back</button>
            <button
              className="primary"
              disabled={!signaturePngDataUrl}
              onClick={() => {
                setMicReady(false);
                setMicError(null);
                setStep("mic");
              }}
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {step === "mic" && (
        <div className="card stack">
          <div style={{ fontSize: 18, fontWeight: 750 }}>Microphone</div>
          <div className="muted">
            The recording section needs access to your microphone. Tap the button below when you are
            ready. Your browser will ask for permission—you can allow it for this site only.
          </div>
          {micError && <div style={{ color: "var(--danger)" }}>{micError}</div>}
          {micReady && (
            <div className="pill" style={{ color: "var(--ok)", borderColor: "rgba(105, 219, 124, 0.45)" }}>
              Microphone enabled — you can continue to the recordings.
            </div>
          )}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button onClick={() => setStep("consent")}>Back</button>
            {!micReady && (
              <button className="primary" onClick={enableMicrophone}>
                {micError ? "Try again" : "Enable microphone"}
              </button>
            )}
            {micReady && (
              <button className="primary" onClick={() => setStep("recordings")}>
                Continue to recordings
              </button>
            )}
          </div>
        </div>
      )}

      {step === "recordings" && (
        <div className="card stack">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div style={{ fontSize: 18, fontWeight: 750 }}>Recordings</div>
            <div className="pill">
              {Object.values(recordings).filter(Boolean).length}/{stimuli.length} completed
            </div>
          </div>
          <div className="progressBar" aria-hidden="true">
            <div
              className="progressBarFill"
              style={{
                width: `${(Object.values(recordings).filter(Boolean).length / stimuli.length) * 100}%`,
              }}
            />
          </div>

          <RecorderStep
            stimuli={stimuli}
            recordings={recordings}
            onRecording={(stimulusId, rec) =>
              setRecordings((p) => ({ ...p, [stimulusId]: rec }))
            }
          />

          {submitError && <div style={{ color: "var(--danger)" }}>{submitError}</div>}

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button onClick={() => setStep("mic")}>Back</button>
            <button className="primary" disabled={!allDone || submitting} onClick={submitAll}>
              {submitting ? "Submitting..." : "Submit"}
            </button>
          </div>
        </div>
      )}

      {step === "done" && (
        <div className="card stack">
          <div style={{ fontSize: 20, fontWeight: 750 }}>Thank you</div>
          <div className="muted">
            Your response has been submitted successfully. جزاك الله خيرا
          </div>
          {resultId && <div className="pill">Response ID: {resultId}</div>}
          <a className="pill" href="/" onClick={() => window.location.reload()}>
            Submit another response
          </a>
        </div>
      )}
    </div>
  );
}
