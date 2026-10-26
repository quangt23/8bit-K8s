import type { FacilityModel } from "../facility/FacilityScene";

// Phaser needs a real canvas, so component tests replace the scene with this stub.
// It exposes exactly what React hands the scene, plus a way to "click" a GPU.
export const sceneControl = { fail: null as Error | null };

export function FacilityCanvasStub({
  model,
  onSelectGpu,
  onError,
}: {
  model: FacilityModel;
  onSelectGpu: (id: string) => void;
  onError: (error: unknown) => void;
}) {
  if (sceneControl.fail) {
    const error = sceneControl.fail;
    queueMicrotask(() => onError(error));
  }
  return (
    <div data-testid="scene" data-selected={model.selectedGpuId ?? ""}>
      {model.gpus.map((gpu) => (
        <button key={gpu.id} type="button" onClick={() => onSelectGpu(gpu.id)}>
          scene:{gpu.id}
        </button>
      ))}
    </div>
  );
}
