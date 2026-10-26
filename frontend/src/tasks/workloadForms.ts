import type { WorkloadSpec, WorkloadType } from "../api/tasks";

/**
 * Form definitions for each supported workload. These give helpful, immediate
 * feedback in the browser; the backend validates everything again and is the
 * authority on what runs.
 */

export interface FieldOption {
  value: string;
  label: string;
}

export interface FieldDef {
  name: string;
  label: string;
  kind: "text" | "textarea" | "number" | "select";
  defaultValue: string;
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  options?: FieldOption[];
  hint?: string;
}

export interface WorkloadForm {
  type: WorkloadType;
  fields: FieldDef[];
  build(values: Record<string, string>): WorkloadSpec;
}

const num = (values: Record<string, string>, name: string) => Number(values[name]);
const text = (values: Record<string, string>, name: string) => (values[name] ?? "").trim();

export const WORKLOAD_FORMS: Record<WorkloadType, WorkloadForm> = {
  echo: {
    type: "echo",
    fields: [
      {
        name: "message",
        label: "Message",
        kind: "text",
        defaultValue: "",
        minLength: 1,
        maxLength: 500,
      },
    ],
    build: (v) => ({ type: "echo", message: text(v, "message") }),
  },
  text_summary: {
    type: "text_summary",
    fields: [
      {
        name: "text",
        label: "Text to summarize",
        kind: "textarea",
        defaultValue: "",
        minLength: 20,
        maxLength: 20_000,
      },
      {
        name: "max_sentences",
        label: "Max sentences",
        kind: "number",
        defaultValue: "3",
        min: 1,
        max: 10,
      },
    ],
    build: (v) => ({
      type: "text_summary",
      text: text(v, "text"),
      max_sentences: num(v, "max_sentences"),
    }),
  },
  sample_inference: {
    type: "sample_inference",
    fields: [
      {
        name: "model",
        label: "Model",
        kind: "select",
        defaultValue: "pixel-tiny-1b",
        options: [
          { value: "pixel-tiny-1b", label: "pixel-tiny-1b (sample, 4 GiB)" },
          { value: "pixel-small-7b", label: "pixel-small-7b (sample, 14 GiB)" },
        ],
        hint: "Sample model names for simulated runs. Not real models.",
      },
      {
        name: "prompt",
        label: "Prompt",
        kind: "textarea",
        defaultValue: "",
        minLength: 1,
        maxLength: 2000,
      },
      {
        name: "max_tokens",
        label: "Max tokens",
        kind: "number",
        defaultValue: "128",
        min: 1,
        max: 512,
      },
    ],
    build: (v) => ({
      type: "sample_inference",
      model: v.model === "pixel-small-7b" ? "pixel-small-7b" : "pixel-tiny-1b",
      prompt: text(v, "prompt"),
      max_tokens: num(v, "max_tokens"),
    }),
  },
  benchmark: {
    type: "benchmark",
    fields: [
      {
        name: "duration_seconds",
        label: "Duration (s)",
        kind: "number",
        defaultValue: "30",
        min: 5,
        max: 120,
      },
      {
        name: "matrix_size",
        label: "Matrix size",
        kind: "select",
        defaultValue: "4096",
        options: ["1024", "2048", "4096", "8192"].map((n) => ({ value: n, label: `${n} × ${n}` })),
      },
    ],
    build: (v) => ({
      type: "benchmark",
      duration_seconds: num(v, "duration_seconds"),
      matrix_size: Number(v.matrix_size) as 1024 | 2048 | 4096 | 8192,
    }),
  },
};

export function defaultValues(form: WorkloadForm): Record<string, string> {
  return Object.fromEntries(form.fields.map((f) => [f.name, f.defaultValue]));
}

/** Browser-side checks only, for fast feedback. Returns field name → message. */
export function validateFields(
  form: WorkloadForm,
  values: Record<string, string>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of form.fields) {
    const raw = (values[field.name] ?? "").trim();
    if (field.kind === "number") {
      const n = Number(raw);
      if (raw === "" || !Number.isInteger(n)) errors[field.name] = "Enter a whole number.";
      else if (field.min !== undefined && n < field.min)
        errors[field.name] = `Minimum is ${field.min}.`;
      else if (field.max !== undefined && n > field.max)
        errors[field.name] = `Maximum is ${field.max}.`;
    } else if (field.minLength && raw.length < field.minLength) {
      errors[field.name] =
        field.minLength === 1 ? "Required." : `At least ${field.minLength} characters.`;
    } else if (field.maxLength && raw.length > field.maxLength) {
      errors[field.name] = `At most ${field.maxLength} characters.`;
    }
  }
  return errors;
}
