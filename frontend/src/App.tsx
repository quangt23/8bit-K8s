import { useCallback, useMemo, useState } from "react";

import type { Task } from "./api/tasks";
import { logoChip } from "./art/sprites";
import { CommandTerminal } from "./components/CommandTerminal";
import { FleetRoster } from "./components/FleetRoster";
import { GpuInspector } from "./components/GpuInspector";
import { PixelSprite } from "./components/PixelSprite";
import { TaskInspector } from "./components/TaskInspector";
import { TaskQueue } from "./components/TaskQueue";
import { FacilityPanel } from "./facility/FacilityPanel";
import { useFleet, type FleetState } from "./hooks/useFleet";
import { useTasks, useWorkloadCatalog } from "./hooks/useTasks";

type Selection = { kind: "gpu"; id: string } | { kind: "task"; id: string } | null;

function LinkChip({ fleet }: { fleet: FleetState }) {
  const [label, tone] =
    fleet.kind === "loading"
      ? ["Linking…", "warn"]
      : fleet.kind === "failed" || fleet.error
        ? ["API offline", "bad"]
        : ["API linked", "ok"];
  return (
    <div className={`chip chip--${tone}`} role="status">
      <span className={`lamp lamp--${tone}`} aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

function EmptyInspector() {
  return (
    <aside className="panel inspector inspector--empty" aria-labelledby="inspector-heading">
      <h2 id="inspector-heading" className="pixel-heading">
        Inspector
      </h2>
      <p>Select a GPU in the facility or roster, or a task in the task list, to inspect it.</p>
    </aside>
  );
}

export default function App() {
  const { state: fleet, reload: reloadFleet } = useFleet();
  const { state: tasks, reload: reloadTasks } = useTasks();
  const { state: catalog } = useWorkloadCatalog();
  const [selection, setSelection] = useState<Selection>(null);

  const gpus = fleet.kind === "ready" ? fleet.data.gpus : [];
  const workers = fleet.kind === "ready" ? fleet.data.workers : [];
  const taskList = tasks.kind === "ready" ? tasks.data.tasks : [];

  const selectedGpu =
    selection?.kind === "gpu" ? (gpus.find((gpu) => gpu.id === selection.id) ?? null) : null;
  const selectedTask =
    selection?.kind === "task" ? (taskList.find((t) => t.id === selection.id) ?? null) : null;
  // A selected task highlights the GPU it is assigned to, if any.
  const highlightedGpuId = selectedGpu?.id ?? selectedTask?.assigned_gpu_id ?? null;
  const selectedWorker = workers.find((w) => w.id === selectedGpu?.worker_id) ?? null;

  const labels = useMemo(
    () => new Map(catalog.kind === "ready" ? catalog.data.map((w) => [w.type, w.label]) : []),
    [catalog],
  );
  const labelFor = useCallback((type: string) => labels.get(type) ?? type, [labels]);

  const selectGpu = useCallback((id: string) => setSelection({ kind: "gpu", id }), []);
  const selectTask = useCallback((id: string) => setSelection({ kind: "task", id }), []);
  const onTaskCreated = useCallback(
    (task: Task) => {
      setSelection({ kind: "task", id: task.id });
      void reloadTasks();
    },
    [reloadTasks],
  );

  let inspector;
  if (selectedGpu) {
    inspector = (
      <GpuInspector
        key={selectedGpu.id}
        gpu={selectedGpu}
        worker={selectedWorker}
        onSelectTask={selectTask}
        labelFor={labelFor}
      />
    );
  } else if (selection?.kind === "task") {
    inspector = (
      <TaskInspector
        key={selection.id}
        taskId={selection.id}
        labelFor={labelFor}
        onSelectGpu={selectGpu}
        onTaskChanged={() => void reloadTasks()}
        onRetried={onTaskCreated}
      />
    );
  } else {
    inspector = <EmptyInspector />;
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <PixelSprite sprite={logoChip} scale={3} />
          <div>
            <h1 className="brand__name">PixelGPU</h1>
            <p className="brand__tagline">GPU orchestration, one pixel at a time</p>
          </div>
        </div>
        <LinkChip fleet={fleet} />
      </header>

      {fleet.kind === "ready" && fleet.error && (
        <p className="banner" role="alert">
          Lost contact with the backend ({fleet.error}). Showing the last known state.
        </p>
      )}

      <main className="control-room">
        <div className="control-room__facility">
          <FacilityPanel
            fleet={fleet}
            selectedGpuId={highlightedGpuId}
            onSelectGpu={selectGpu}
            onRetry={() => void reloadFleet()}
          />
        </div>
        <div className="control-room__inspector">{inspector}</div>
        <div className="control-room__work">
          <CommandTerminal catalog={catalog} onSubmitted={onTaskCreated} />
          <TaskQueue
            tasks={tasks}
            selectedTaskId={selection?.kind === "task" ? selection.id : null}
            onSelectTask={selectTask}
            onRetry={() => void reloadTasks()}
            labelFor={labelFor}
          />
        </div>
        {gpus.length > 0 && (
          <div className="control-room__roster">
            <FleetRoster
              gpus={gpus}
              workers={workers}
              selectedGpuId={selectedGpu?.id ?? null}
              onSelectGpu={selectGpu}
            />
          </div>
        )}
      </main>

      <footer className="footer">
        <span>Phase 3 · scheduler</span>
        <a href="/api/docs" target="_blank" rel="noreferrer">
          API docs
        </a>
      </footer>
    </div>
  );
}
