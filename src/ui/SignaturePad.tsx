import { Button } from "@/components/ui/button";
import { analyzeSignatureCanvas } from "@/utils/signatureValidation";
import { useEffect, useMemo, useRef, useState } from "react";

type Props = {
  value: string | null;
  onChange: (pngDataUrl: string | null) => void;
  onValidityChange?: (valid: boolean, message?: string) => void;
};

function getCanvasPos(e: PointerEvent, canvas: HTMLCanvasElement) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (canvas.width / rect.width),
    y: (e.clientY - rect.top) * (canvas.height / rect.height),
  };
}

function canvasThemeStyles() {
  // Always record signatures in dark ink on a transparent background so they
  // remain visible when stamped onto a white PDF.
  return { stroke: "rgba(0,0,0,0.9)" };
}

export function SignaturePad({ value, onChange, onValidityChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onValidityChangeRef = useRef(onValidityChange);
  onValidityChangeRef.current = onValidityChange;

  const [validationError, setValidationError] = useState<string | null>(null);

  const size = useMemo(() => ({ w: 900, h: 280 }), []);

  function applyValidation(canvas: HTMLCanvasElement) {
    const result = analyzeSignatureCanvas(canvas);
    if (result.valid) {
      setValidationError(null);
      onChangeRef.current(canvas.toDataURL("image/png"));
      onValidityChangeRef.current?.(true);
    } else {
      setValidationError(result.message ?? null);
      onChangeRef.current(null);
      onValidityChangeRef.current?.(false, result.message);
    }
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = size.w;
    canvas.height = size.h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { stroke } = canvasThemeStyles();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 6;
    ctx.strokeStyle = stroke;
  }, [size.h, size.w]);

  useEffect(() => {
    if (!value) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const img = new Image();
    img.onload = () => {
      const c = canvasRef.current;
      const cctx = c?.getContext("2d");
      if (!c || !cctx) return;
      cctx.clearRect(0, 0, c.width, c.height);
      cctx.drawImage(img, 0, 0, c.width, c.height);
      applyValidation(c);
    };
    img.src = value;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const canvasEl: HTMLCanvasElement = canvas;
    const ctx2d: CanvasRenderingContext2D = ctx;

    const lastRef: { current: { x: number; y: number } | null } = { current: null };
    const strokeStartedRef: { current: boolean } = { current: false };

    function applyActiveThemeToContext() {
      const { stroke } = canvasThemeStyles();
      ctx2d.strokeStyle = stroke;
      ctx2d.lineCap = "round";
      ctx2d.lineJoin = "round";
      ctx2d.lineWidth = 6;
    }

    function onPointerDown(e: PointerEvent) {
      if (e.button !== 0) return;
      try {
        canvasEl.setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      applyActiveThemeToContext();
      lastRef.current = getCanvasPos(e, canvasEl);
      strokeStartedRef.current = false;
    }

    function onPointerMove(e: PointerEvent) {
      const last = lastRef.current;
      if (!last) return;
      if (canvasRef.current !== canvasEl) return;
      const hasCap = canvasEl.hasPointerCapture(e.pointerId);
      // Draw when tracking this stroke: either we hold capture, or the browser never granted it (some touch cases).
      if (!hasCap && e.pointerType === "mouse") return;

      const p = getCanvasPos(e, canvasEl);
      ctx2d.beginPath();
      ctx2d.moveTo(last.x, last.y);
      ctx2d.lineTo(p.x, p.y);
      ctx2d.stroke();
      lastRef.current = p;
      strokeStartedRef.current = true;
    }

    function endStroke(e: PointerEvent) {
      const hadCapture = canvasEl.hasPointerCapture(e.pointerId);
      if (hadCapture) {
        try {
          canvasEl.releasePointerCapture(e.pointerId);
        } catch {
          // ignore
        }
      }
      lastRef.current = null;
      if (strokeStartedRef.current) {
        applyValidation(canvasEl);
      }
      strokeStartedRef.current = false;
    }

    canvasEl.addEventListener("pointerdown", onPointerDown);
    canvasEl.addEventListener("pointermove", onPointerMove);
    canvasEl.addEventListener("pointerup", endStroke);
    canvasEl.addEventListener("pointercancel", endStroke);

    return () => {
      canvasEl.removeEventListener("pointerdown", onPointerDown);
      canvasEl.removeEventListener("pointermove", onPointerMove);
      canvasEl.removeEventListener("pointerup", endStroke);
      canvasEl.removeEventListener("pointercancel", endStroke);
    };
  }, []);

  return (
    <div className="stack">
      <div className="muted">Please sign with your full name.</div>
      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: 16,
          overflow: "hidden",
          background: "rgba(255,255,255,0.03)",
        }}
      >
        <canvas
          ref={canvasRef}
          style={{
            width: "100%",
            height: 220,
            touchAction: "none",
            display: "block",
          }}
        />
      </div>
      {validationError && (
        <div style={{ color: "var(--danger)" }}>{validationError}</div>
      )}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Button
          className="danger"
          onClick={() => {
            const canvas = canvasRef.current;
            const ctx = canvas?.getContext("2d");
            if (canvas && ctx) {
              ctx.clearRect(0, 0, canvas.width, canvas.height);
            }
            setValidationError(null);
            onChange(null);
            onValidityChange?.(false);
          }}
        >
          Clear signature
        </Button>
        <div className="muted" style={{ alignSelf: "center" }}>
          Use your finger on mobile, or mouse/trackpad on desktop.
        </div>
      </div>
    </div>
  );
}
