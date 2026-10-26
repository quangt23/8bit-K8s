import { useEffect, useRef } from "react";

import type { FacilityHandle } from "./createFacilityGame";
import type { FacilityModel } from "./FacilityScene";

interface FacilityCanvasProps {
  model: FacilityModel;
  onSelectGpu: (gpuId: string) => void;
  onError: (error: unknown) => void;
}

/**
 * Hosts the Phaser game. Phaser is loaded lazily so the rest of the app works,
 * and loads faster, even when the scene cannot start. The canvas is hidden from
 * assistive technology; the fleet roster is its accessible equivalent.
 */
export function FacilityCanvas({ model, onSelectGpu, onError }: FacilityCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<FacilityHandle | null>(null);
  const latest = useRef({ model, onSelectGpu, onError });

  useEffect(() => {
    latest.current = { model, onSelectGpu, onError };
    handleRef.current?.setModel(model);
  }, [model, onSelectGpu, onError]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const controller = new AbortController();

    import("./createFacilityGame")
      .then(({ createFacilityGame }) =>
        createFacilityGame(
          container,
          {
            onSelectGpu: (id) => latest.current.onSelectGpu(id),
            onError: (error) => latest.current.onError(error),
          },
          controller.signal,
        ),
      )
      .then((handle) => {
        if (!handle) return;
        if (controller.signal.aborted) {
          handle.destroy();
          return;
        }
        handleRef.current = handle;
        handle.setModel(latest.current.model);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) latest.current.onError(error);
      });

    return () => {
      controller.abort();
      handleRef.current?.destroy();
      handleRef.current = null;
    };
  }, []);

  return <div ref={containerRef} className="facility__canvas" aria-hidden="true" />;
}
