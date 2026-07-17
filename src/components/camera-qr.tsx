"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";

export function CameraQr({ url }: { url: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !url) return;
    QRCode.toCanvas(canvas, url, { width: 220, margin: 2 }).catch((err) => {
      setError(err instanceof Error ? err.message : "QR failed");
    });
  }, [url]);

  return (
    <div className="flex flex-col items-center gap-2">
      <canvas ref={canvasRef} className="rounded-lg bg-white p-2" />
      {error && <p className="text-sm text-red-500">{error}</p>}
      <p className="max-w-[240px] break-all text-center text-xs text-zinc-500">
        {url}
      </p>
    </div>
  );
}
