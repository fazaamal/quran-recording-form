import { useEffect, useMemo, useRef } from "react";

type Props = {
  value: string | null;
  onChange: (pngDataUrl: string | null) => void;
};

function getCanvasPos(e: PointerEvent, canvas: HTMLCanvasElement) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (canvas.width / rect.width),
    y: (e.clientY - rect.top) * (canvas.height / rect.height),
  };
}

function canvasThemeStyles() {
  const prefersLight =
    typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: light)")?.matches;
  return prefersLight
    ? { fill: "rgba(0,0,0,0.04)", stroke: "rgba(0,0,0,0.88)" }
    : { fill: "rgba(255,255,255,0.06)", stroke: "rgba(255,255,255,0.92)" };
}

export function SignaturePad({ value, onChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const size = useMemo(() => ({ w: 900, h: 280 }), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = size.w;
    canvas.height = size.h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { fill, stroke } = canvasThemeStyles();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 6;
    ctx.strokeStyle = stroke;

    if (value) {
      const img = new Image();
      img.onload = () => {
        const c = canvasRef.current;
        const cctx = c?.getContext("2d");
        if (!c || !cctx) return;
        const t = canvasThemeStyles();
        cctx.clearRect(0, 0, c.width, c.height);
        cctx.fillStyle = t.fill;
        cctx.fillRect(0, 0, c.width, c.height);
        cctx.drawImage(img, 0, 0, c.width, c.height);
      };
      img.src = value;
    }
  }, [size.h, size.w, value]);

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
        const png = canvasEl.toDataURL("image/png");
        onChangeRef.current(png);
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
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button
          className="danger"
          onClick={() => {
            const canvas = canvasRef.current;
            const ctx = canvas?.getContext("2d");
            if (canvas && ctx) {
              const { fill } = canvasThemeStyles();
              ctx.clearRect(0, 0, canvas.width, canvas.height);
              ctx.fillStyle = fill;
              ctx.fillRect(0, 0, canvas.width, canvas.height);
            }
            onChange(null);
          }}
        >
          Clear signature
        </button>
        <div className="muted" style={{ alignSelf: "center" }}>
          Use your finger on mobile, or mouse/trackpad on desktop.
        </div>
      </div>
    </div>
  );
}
