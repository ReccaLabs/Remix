'use client';
import { Button } from '@remix/ui';
import { Camera, Radio } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { noHardware, scanNfc, subscribeHardware, supportsNfc } from '@/lib/card-nfc';
import { createWedgeDetector } from '@/lib/card-wedge';
import { CameraCardScanner, supportsCardCamera } from './camera-card-scanner';

export function CounterScanner({
  onScan,
  disabled,
}: {
  onScan: (value: string) => void;
  disabled: boolean;
}) {
  const t = useTranslations('fees.scan');
  const [camera, setCamera] = useState(false);
  const [tapping, setTapping] = useState(false);
  const [failed, setFailed] = useState(false);
  const cameraSupported = useSyncExternalStore(subscribeHardware, supportsCardCamera, noHardware);
  const nfcSupported = useSyncExternalStore(subscribeHardware, supportsNfc, noHardware);
  const scan = useRef<AbortController | null>(null);
  const callback = useRef({ onScan, disabled });
  useEffect(() => {
    callback.current = { onScan, disabled };
  }, [onScan, disabled]);
  useEffect(() => {
    const detect = createWedgeDetector();
    const keydown = (event: KeyboardEvent) => {
      // Manual money entry and editable controls retain their keys. The search field handles Enter itself.
      if (
        callback.current.disabled ||
        event.isComposing ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        (event.target instanceof Element &&
          event.target.closest('input, textarea, select, [contenteditable="true"], dialog'))
      )
        return;
      const code = detect(event.key, event.timeStamp);
      if (code) {
        event.preventDefault();
        event.stopPropagation();
        callback.current.onScan(code);
      }
    };
    document.addEventListener('keydown', keydown, true);
    return () => {
      document.removeEventListener('keydown', keydown, true);
      scan.current?.abort();
    };
  }, []);
  function stopNfc() {
    scan.current?.abort();
    setTapping(false);
  }
  async function tap() {
    stopNfc();
    const controller = new AbortController();
    scan.current = controller;
    setTapping(true);
    setFailed(false);
    try {
      await scanNfc(
        controller.signal,
        (value) => {
          stopNfc();
          if (!callback.current.disabled) callback.current.onScan(value);
        },
        () => {
          stopNfc();
          setFailed(true);
        },
      );
    } catch {
      if (!controller.signal.aborted) {
        stopNfc();
        setFailed(true);
      }
    }
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        {cameraSupported ? (
          <Button
            size="lg"
            variant="secondary"
            disabled={disabled || camera}
            onClick={() => {
              stopNfc();
              setCamera(true);
            }}
          >
            <Camera aria-hidden size={18} />
            {t('camera')}
          </Button>
        ) : null}
        {nfcSupported ? (
          <Button
            size="lg"
            variant="secondary"
            disabled={disabled || tapping}
            onClick={() => {
              setCamera(false);
              void tap();
            }}
          >
            <Radio aria-hidden size={18} />
            {t('tap')}
          </Button>
        ) : null}
        {tapping ? (
          <Button size="lg" variant="secondary" onClick={stopNfc}>
            {t('close')}
          </Button>
        ) : null}
      </div>
      {tapping ? (
        <p role="status" className="m-0 text-muted">
          {t('tapHint')}
        </p>
      ) : null}
      {failed ? (
        <p role="alert" className="m-0 text-danger-ink">
          {t('tapError')}
        </p>
      ) : null}
      {camera ? (
        <CameraCardScanner
          onClose={() => setCamera(false)}
          onRead={(code) => {
            setCamera(false);
            if (!callback.current.disabled) callback.current.onScan(code);
          }}
        />
      ) : null}
    </div>
  );
}
