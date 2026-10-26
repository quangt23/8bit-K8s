import { useId, useMemo, useState, type FormEvent, type KeyboardEvent } from "react";

import { ApiError } from "../api/client";
import {
  createTask,
  type Task,
  type TaskCreate,
  type WorkloadInfo,
  type WorkloadType,
} from "../api/tasks";
import type { Resource } from "../hooks/usePolledResource";
import { shortId } from "../tasks/taskStatus";
import {
  defaultValues,
  validateFields,
  WORKLOAD_FORMS,
  type FieldDef,
} from "../tasks/workloadForms";

interface CommandTerminalProps {
  catalog: Resource<WorkloadInfo[]>;
  onSubmitted: (task: Task) => void;
}

type Values = Record<string, string>;

const MAX_NOTE = 2000;

function without(errors: Record<string, string>, key: string): Record<string, string> {
  return Object.fromEntries(Object.entries(errors).filter(([k]) => k !== key));
}

function isWorkloadType(type: string): type is WorkloadType {
  return type in WORKLOAD_FORMS;
}

/** Map backend error fields ("workload.text", "prompt", ...) onto form fields. */
function fieldErrorsFrom(error: ApiError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const detail of error.details) {
    if (!detail.field) continue;
    const key = detail.field.startsWith("workload.")
      ? detail.field.slice("workload.".length)
      : detail.field === "prompt"
        ? "note"
        : detail.field === "resources.min_memory_mb"
          ? "memory"
          : null;
    if (key) errors[key] = detail.message;
  }
  return errors;
}

export function CommandTerminal({ catalog, onSubmitted }: CommandTerminalProps) {
  const ids = useId();
  const workloads = useMemo(
    () => (catalog.kind === "ready" ? catalog.data.filter((w) => isWorkloadType(w.type)) : []),
    [catalog],
  );
  const [selectedType, setSelectedType] = useState<WorkloadType | null>(null);
  const type = selectedType ?? (workloads[0]?.type as WorkloadType | undefined) ?? null;
  const [valuesByType, setValuesByType] = useState<Partial<Record<WorkloadType, Values>>>({});
  const [note, setNote] = useState("");
  const [memoryGiB, setMemoryGiB] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [lastTask, setLastTask] = useState<Task | null>(null);

  if (catalog.kind !== "ready") {
    return (
      <section className="terminal" aria-labelledby={`${ids}-title`}>
        <header className="terminal__header">
          <h2 id={`${ids}-title`} className="terminal__title">
            Command terminal
          </h2>
        </header>
        <div className="terminal__body">
          {catalog.kind === "loading" ? (
            <p className="terminal__muted" role="status">
              Loading supported workloads…
            </p>
          ) : (
            <p className="terminal__error" role="alert">
              Couldn't load supported workloads: {catalog.error}
            </p>
          )}
        </div>
      </section>
    );
  }

  const form = type ? WORKLOAD_FORMS[type] : null;
  const info = workloads.find((w) => w.type === type);
  const values: Values = (type && valuesByType[type]) || (form ? defaultValues(form) : {});

  const memoryMb = memoryGiB.trim() === "" ? undefined : Math.round(Number(memoryGiB) * 1024);
  const request: TaskCreate | null = form
    ? {
        ...(note.trim() ? { prompt: note.trim() } : {}),
        workload: form.build(values),
        ...(memoryMb !== undefined ? { resources: { min_memory_mb: memoryMb } } : {}),
      }
    : null;

  function setValue(name: string, value: string) {
    if (!type || !form) return;
    setValuesByType((prev) => ({ ...prev, [type]: { ...values, [name]: value } }));
    setErrors((prev) => without(prev, name));
  }

  async function submit() {
    if (!form || !request || submitting) return;
    const fieldErrors = validateFields(form, values);
    if (memoryGiB.trim() !== "" && !(Number(memoryGiB) > 0))
      fieldErrors.memory = "Enter a positive number of GiB.";
    if (note.length > MAX_NOTE) fieldErrors.note = `At most ${MAX_NOTE} characters.`;
    setErrors(fieldErrors);
    setSubmitError(null);
    if (Object.keys(fieldErrors).length > 0) return;

    setSubmitting(true);
    try {
      const task = await createTask(request);
      setLastTask(task);
      setNote("");
      onSubmitted(task);
    } catch (error) {
      if (error instanceof ApiError) {
        setErrors(fieldErrorsFrom(error));
        setSubmitError(error.message);
      } else {
        setSubmitError("Something went wrong submitting the task.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void submit();
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void submit();
    }
  }

  const fieldId = (name: string) => `${ids}-${type}-${name}`;

  function renderField(field: FieldDef) {
    const id = fieldId(field.name);
    const error = errors[field.name];
    const common = {
      id,
      name: field.name,
      value: values[field.name] ?? "",
      "aria-invalid": error ? true : undefined,
      "aria-describedby":
        [error && `${id}-error`, field.hint && `${id}-hint`].filter(Boolean).join(" ") || undefined,
      onChange: (e: { target: { value: string } }) => setValue(field.name, e.target.value),
    };
    return (
      <div key={field.name} className={`term-field term-field--${field.kind}`}>
        <label htmlFor={id}>{field.label}</label>
        {field.kind === "textarea" ? (
          <textarea {...common} rows={field.name === "text" ? 5 : 3} maxLength={field.maxLength} />
        ) : field.kind === "select" ? (
          <select {...common}>
            {field.options?.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            {...common}
            type={field.kind === "number" ? "number" : "text"}
            inputMode={field.kind === "number" ? "numeric" : undefined}
            min={field.min}
            max={field.max}
            maxLength={field.maxLength}
          />
        )}
        {field.hint && (
          <span id={`${id}-hint`} className="term-field__hint">
            {field.hint}
          </span>
        )}
        {error && (
          <span id={`${id}-error`} className="term-field__error">
            {error}
          </span>
        )}
      </div>
    );
  }

  return (
    <section className="terminal" aria-labelledby={`${ids}-title`}>
      <header className="terminal__header">
        <h2 id={`${ids}-title`} className="terminal__title">
          Command terminal
        </h2>
        <span className="terminal__muted">Ctrl+Enter to submit</span>
      </header>

      <form className="terminal__body" onSubmit={onSubmit} onKeyDown={onKeyDown} noValidate>
        <fieldset className="workload-picker">
          <legend>Workload</legend>
          {workloads.map((w) => (
            <label key={w.type} className="workload-picker__option">
              <input
                type="radio"
                name={`${ids}-workload`}
                value={w.type}
                checked={w.type === type}
                onChange={() => {
                  setSelectedType(w.type as WorkloadType);
                  setErrors({});
                  setSubmitError(null);
                }}
              />
              <span>{w.label}</span>
            </label>
          ))}
        </fieldset>
        {info && <p className="terminal__muted">{info.description}</p>}

        {form && <div className="term-fields">{form.fields.map(renderField)}</div>}

        <div className="term-field">
          <label htmlFor={`${ids}-memory`}>Min memory (GiB)</label>
          <input
            id={`${ids}-memory`}
            type="number"
            inputMode="decimal"
            min={0.5}
            step={0.5}
            placeholder="workload default"
            value={memoryGiB}
            aria-invalid={errors.memory ? true : undefined}
            aria-describedby={errors.memory ? `${ids}-memory-error` : undefined}
            onChange={(e) => {
              setMemoryGiB(e.target.value);
              setErrors((prev) => without(prev, "memory"));
            }}
          />
          {errors.memory && (
            <span id={`${ids}-memory-error`} className="term-field__error">
              {errors.memory}
            </span>
          )}
        </div>

        <div className="term-field">
          <label htmlFor={`${ids}-note`}>Note (optional)</label>
          <input
            id={`${ids}-note`}
            type="text"
            maxLength={MAX_NOTE}
            placeholder="Why you're running this"
            value={note}
            aria-invalid={errors.note ? true : undefined}
            aria-describedby={`${ids}-note-hint`}
            onChange={(e) => setNote(e.target.value)}
          />
          <span id={`${ids}-note-hint`} className="term-field__hint">
            Saved with the task for context. Never executed.
          </span>
          {errors.note && <span className="term-field__error">{errors.note}</span>}
        </div>

        {request && (
          <div className="spec-preview">
            <p className="spec-preview__title">Will run exactly this workload:</p>
            <pre aria-label="Workload specification">
              {JSON.stringify(request.workload, null, 2)}
            </pre>
          </div>
        )}

        <div className="terminal__actions">
          <button type="submit" className="pixel-button" disabled={submitting || !form}>
            {submitting ? "Submitting…" : "Submit ▶"}
          </button>
          <div className="terminal__feedback" role="status" aria-live="polite">
            {lastTask && !submitError && (
              <span className="terminal__ok">
                ✓ task {shortId(lastTask.id)} {lastTask.status}
                {lastTask.queue_position ? ` (#${lastTask.queue_position} in queue)` : ""}
              </span>
            )}
          </div>
        </div>
        {submitError && (
          <p className="terminal__error" role="alert">
            {submitError}
          </p>
        )}
      </form>
    </section>
  );
}
