'use client';
import { Button } from '@remix/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

interface Detector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}
type CameraWindow = Window & {
  BarcodeDetector?: {
    new (options: { formats: string[] }): Detector;
    getSupportedFormats(): Promise<string[]>;
  };
};
export const supportsCardCamera = () =>
  typeof window !== 'undefined' &&
  Boolean((window as CameraWindow).BarcodeDetector && navigator.mediaDevices?.getUserMedia);

export function CameraCardScanner({
  onRead,
  onClose,
}: {
  onRead: (code: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations('fees.scan');
  const video = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const read = useRef(onRead);
  useEffect(() => {
    read.current = onRead;
  }, [onRead]);
  useEffect(() => {
    let closed = false;
    let stream: MediaStream | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const element = video.current;
    async function start() {
      try {
        const Reader = (window as CameraWindow).BarcodeDetector;
        if (!Reader || !element) throw new Error('Camera scan unavailable');
        const supported = await Reader.getSupportedFormats();
        const formats = ['qr_code', 'code_128'].filter((format) => supported.includes(format));
        if (!formats.length || closed) {
          if (!closed) setFailed(true);
          return;
        }
        const detector = new Reader({ formats });
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (closed) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        element.srcObject = stream;
        await element.play();
        async function detect() {
          if (closed || !element) return;
          try {
            if (element.readyState >= 2) {
              const [result] = await detector.detect(element);
              if (closed) return;
              if (result?.rawValue) {
                stream?.getTracks().forEach((track) => track.stop());
                read.current(result.rawValue);
                return;
              }
            }
            timer = setTimeout(() => void detect(), 150);
          } catch {
            if (!closed) {
              stream?.getTracks().forEach((track) => track.stop());
              setFailed(true);
            }
          }
        }
        if (!closed) void detect();
      } catch {
        stream?.getTracks().forEach((track) => track.stop());
        if (!closed) setFailed(true);
      }
    }
    void start();
    return () => {
      closed = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
      if (element) element.srcObject = null;
    };
  }, []);
  return (
    <section
      aria-label={t('camera')}
      className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4"
    >
      <h3 className="m-0 font-semibold">{t('camera')}</h3>
      <p className="m-0 text-muted">{t('cameraHint')}</p>
      {failed ? (
        <p role="alert" className="m-0 text-danger-ink">
          {t('cameraError')}
        </p>
      ) : (
        <video
          ref={video}
          muted
          playsInline
          aria-label={t('preview')}
          className="max-h-80 w-full rounded-md"
        />
      )}
      <Button size="lg" variant="secondary" onClick={onClose}>
        {t('close')}
      </Button>
    </section>
  );
}
