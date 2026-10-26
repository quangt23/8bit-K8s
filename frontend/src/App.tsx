import { useCallback, useMemo, useState } from "react";

import type { FleetSnapshot } from "./api/fleet";
import type { Task } from "./api/tasks";
import { logoChip } from "./art/sprites";
import { ActivityFeed } from "./components/ActivityFeed";
import { CommandTerminal } from "./components/CommandTerminal";
import { ConnectionChip } from "./components/ConnectionChip";
import { FleetRoster } from "./components/FleetRoster";
import { GpuInspector } from "./components/GpuInspector";
import { MetricsStrip } from "./components/MetricsStrip";
import { PixelSprite } from "./components/PixelSprite";
import { TaskInspector } from "./components/TaskInspector";
import { TaskQueue } from "./components/TaskQueue";
import { FacilityPanel } from "./facility/FacilityPanel";
import type { Resource } from "./hooks/usePolledResource";
import { useWorkloadCatalog } from "./hooks/useTasks";
import { useLive } from "./live/useLive";

type Selection = { kind: "gpu"; id: string } | { kind: "task"; id: string } | null;

/** Narrow the live snapshot to one part of it, keeping its loading and error state. */
function select<T>(
  snapshot: ReturnType<typeof useLive>["snapshot"],
  pick: (data: Extract<typeof snapshot, { kind: "ready" }>["data"]) => T,
): Resource<T> {
  return snapshot.kind === "ready"
    ? { kind: "ready", data: pick(snapshot.data), error: snapshot.error }
    : snapshot;
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
  const { snapshot, connection, feed, refresh } = useLive();
  const { state: catalog } = useWorkloadCatalog();
  const [selection, setSelection] = useState<Selection>(null);

  const fleet: Resource<FleetSnapshot> = useMemo(
    () => select(snapshot, (s) => s.fleet),
    [snapshot],
  );
  const tasks: Resource<{ tasks: Task[]; total: number }> = useMemo(
    () => select(snapshot, (s) => ({ tasks: s.tasks, total: s.total_tasks })),
    [snapshot],
  );
  const live = snapshot.kind === "ready" ? snapshot.data : null;
  const gpus = live?.fleet.gpus ?? [];
  const workers = live?.fleet.workers ?? [];
  const revision = live?.revision ?? 0;

  const selectedGpu =
    selection?.kind === "gpu" ? (gpus.find((gpu) => gpu.id === selection.id) ?? null) : null;
  const selectedTask =
    selection?.kind === "task" ? (live?.tasks.find((t) => t.id === selection.id) ?? null) : null;
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
      void refresh();
    },
    [refresh],
  );

  let inspector;
  if (selectedGpu) {
    inspector = (
      <GpuInspector
        key={selectedGpu.id}
        gpu={selectedGpu}
        refreshKey={revision}
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
        refreshKey={revision}
        labelFor={labelFor}
        onSelectGpu={selectGpu}
        onTaskChanged={() => void refresh()}
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
        <ConnectionChip connection={connection} snapshot={snapshot} />
      </header>

      {snapshot.kind === "ready" && snapshot.error && (
        <p className="banner" role="alert">
          Lost contact with the backend ({snapshot.error}). Showing the last known state; retrying.
        </p>
      )}

      <main className="control-room">
        {live && (
          <div className="control-room__metrics">
            <MetricsStrip metrics={live.metrics} />
          </div>
        )}
        <div className="control-room__facility">
          <FacilityPanel
            fleet={fleet}
            selectedGpuId={highlightedGpuId}
            onSelectGpu={selectGpu}
            onRetry={() => void refresh()}
          />
        </div>
        <div className="control-room__inspector">{inspector}</div>
        <div className="control-room__work">
          <CommandTerminal catalog={catalog} onSubmitted={onTaskCreated} />
          <TaskQueue
            tasks={tasks}
            selectedTaskId={selection?.kind === "task" ? selection.id : null}
            onSelectTask={selectTask}
            onRetry={() => void refresh()}
            labelFor={labelFor}
          />
        </div>
        <div className="control-room__ops">
          <ActivityFeed events={feed} onSelectTask={selectTask} labelFor={labelFor} />
          {gpus.length > 0 && (
            <FleetRoster
              gpus={gpus}
              workers={workers}
              selectedGpuId={selectedGpu?.id ?? null}
              onSelectGpu={selectGpu}
            />
          )}
        </div>
      </main>

      <footer className="footer">
        <span>Phase 4 · live</span>
        <a href="/api/docs" target="_blank" rel="noreferrer">
          API docs
        </a>
      </footer>
    </div>
  );
}
