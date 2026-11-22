import { useEffect, useRef, useState } from 'react';
import { Camera, Keyboard, X } from 'lucide-react';

interface CameraBarcodeModalProps {
  open: boolean;
  onClose: () => void;
  onDetected: (code: string) => void;
}

interface DetectedBarcode {
  rawValue?: string;
}

interface BarcodeDetectorLike {
  detect: (source: HTMLVideoElement) => Promise<DetectedBarcode[]>;
}

interface BarcodeDetectorCtor {
  new (opts?: { formats?: string[] }): BarcodeDetectorLike;
}

export function CameraBarcodeModal({ open, onClose, onDetected }: CameraBarcodeModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [manualCode, setManualCode] = useState('');
  const [detectorSupported, setDetectorSupported] = useState(true);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let rafId = 0;

    const stopStream = () => {
      if (rafId) cancelAnimationFrame(rafId);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };

    const startCamera = async () => {
      setErrorMsg('');
      const DetectorCtor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
      if (!DetectorCtor) {
        setDetectorSupported(false);
      } else {
        setDetectorSupported(true);
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        setErrorMsg('المتصفح أو السياق الحالي لا يدعم تشغيل الكاميرا. استخدم الإدخال اليدوي أدناه.');
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        if (DetectorCtor) {
          const detector = new DetectorCtor({
            formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'qr_code'],
          });
          let lastScanAt = 0;

          const scanLoop = async (now: number) => {
            if (cancelled) return;
            if (videoRef.current && videoRef.current.readyState >= 2 && now - lastScanAt > 250) {
              lastScanAt = now;
              try {
                const hits = await detector.detect(videoRef.current);
                const val = hits[0]?.rawValue?.trim();
                if (val) {
                  stopStream();
                  onDetected(val);
                  onClose();
                  return;
                }
              } catch {
                // ignore single-frame decode error
              }
            }
            rafId = requestAnimationFrame(scanLoop);
          };
          rafId = requestAnimationFrame(scanLoop);
        }
      } catch {
        if (!cancelled) {
          setErrorMsg('تعذر الوصول إلى الكاميرا (تحقق من صلاحيات المتصفح). يمكنك كتابة الباركود يدوياً أدناه.');
        }
      }
    };

    startCamera();

    return () => {
      cancelled = true;
      stopStream();
    };
  }, [open, onClose, onDetected]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-2xl border border-slate-700/60 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Camera className="h-5 w-5 text-emerald-600" />
            <h3 className="font-display text-base font-bold text-slate-900 dark:text-white">
              ماسح الباركود بالكاميرا
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="إغلاق"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-slate-950 border border-slate-800">
            <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
            <div className="pointer-events-none absolute inset-x-10 top-1/2 -translate-y-1/2 h-0.5 bg-emerald-400/80 shadow-[0_0_8px_rgba(52,211,153,0.9)]" />
          </div>

          {!detectorSupported && (
            <div className="rounded-xl border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 px-3.5 py-2.5 text-xs text-amber-800 dark:text-amber-300">
              المتصفح الحالي لا يدعم واجهة BarcodeDetector التلقائية؛ يمكنك إدخال الكود يدوياً أدناه أو استخدام جهاز قارئ USB.
            </div>
          )}

          {errorMsg && (
            <div className="rounded-xl border border-rose-300/60 bg-rose-50 dark:bg-rose-950/30 px-3.5 py-2.5 text-xs text-rose-700 dark:text-rose-300">
              {errorMsg}
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              const clean = manualCode.trim();
              if (!clean) return;
              onDetected(clean);
              setManualCode('');
              onClose();
            }}
            className="flex gap-2"
          >
            <div className="relative flex-1">
              <Keyboard className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                placeholder="أو اكتب الباركود / كود الميزان يدوياً..."
                className="w-full min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 pr-9 pl-3 text-sm font-mono-num text-slate-900 dark:text-white"
              />
            </div>
            <button
              type="submit"
              className="min-h-[44px] rounded-xl bg-emerald-600 hover:bg-emerald-700 px-4 text-sm font-bold text-white"
            >
              إدخال
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
