import { useEffect, useRef, useState } from "react";

export type Field =
  | { name: string; label: string; type: "text"; value?: string; placeholder?: string; required?: boolean; mono?: boolean }
  | { name: string; label: string; type: "textarea"; value?: string; placeholder?: string; required?: boolean }
  | { name: string; label: string; type: "checkbox"; value?: boolean; hint?: string }
  | { name: string; label: string; type: "radio"; value?: string; options: { value: string; label: string; hint?: string }[] }
  | { name: string; label: string; type: "select"; value?: string; options: { value: string; label: string }[] }
  | { name: string; label: string; type: "folder"; value?: string; required?: boolean };

export type Values = Record<string, string | boolean>;

export interface AskOptions {
  title: string;
  message?: React.ReactNode;
  fields?: Field[];
  ok?: string;
  cancel?: string | false;
  danger?: boolean;
  /** Extra validation; return an error message to block OK. */
  validate?: (v: Values) => string | null;
}

type Pending = AskOptions & { resolve: (v: Values | null) => void };
let pushGlobal: (p: Pending) => void = () => {};

/** Show a modal dialog. Resolves with field values, or null on cancel. */
export function ask(opts: AskOptions): Promise<Values | null> {
  return new Promise((resolve) => pushGlobal({ ...opts, resolve }));
}

export async function confirm(title: string, message: React.ReactNode, ok = "OK", danger = false) {
  return (await ask({ title, message, ok, danger })) !== null;
}

export function info(title: string, message: React.ReactNode) {
  return ask({ title, message, cancel: false });
}

export function DialogHost({ pickFolder }: { pickFolder: () => Promise<string | null> }) {
  const [queue, setQueue] = useState<Pending[]>([]);
  pushGlobal = (p) => setQueue((q) => [...q, p]);
  const current = queue[0];
  if (!current) return null;
  return (
    <DialogView
      key={queue.length + current.title}
      opts={current}
      pickFolder={pickFolder}
      onDone={(v) => {
        current.resolve(v);
        setQueue((q) => q.slice(1));
      }}
    />
  );
}

function initial(fields: Field[] = []): Values {
  const v: Values = {};
  for (const f of fields) {
    if (f.type === "checkbox") v[f.name] = f.value ?? false;
    else if (f.type === "radio" || f.type === "select") v[f.name] = f.value ?? f.options[0]?.value ?? "";
    else v[f.name] = f.value ?? "";
  }
  return v;
}

function DialogView({
  opts,
  onDone,
  pickFolder,
}: {
  opts: Pending;
  onDone: (v: Values | null) => void;
  pickFolder: () => Promise<string | null>;
}) {
  const [values, setValues] = useState<Values>(() => initial(opts.fields));
  const [error, setError] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const set = (k: string, v: string | boolean) => setValues((s) => ({ ...s, [k]: v }));

  useEffect(() => {
    const el = formRef.current?.querySelector<HTMLElement>("input:not([type=checkbox]):not([type=radio]), textarea");
    (el ?? formRef.current?.querySelector<HTMLElement>("button.primary"))?.focus();
    const key = (e: KeyboardEvent) => e.key === "Escape" && doneRef.current(null);
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    for (const f of opts.fields ?? []) {
      if ("required" in f && f.required && !String(values[f.name]).trim()) {
        setError(`${f.label} is required`);
        return;
      }
    }
    const err = opts.validate?.(values);
    if (err) return setError(err);
    onDone(values);
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onDone(null)}>
      <form ref={formRef} className="dialog" onSubmit={submit}>
        <header>{opts.title}</header>
        <div className="dialog-body">
          {opts.message && <div className="dialog-message">{opts.message}</div>}
          {opts.fields?.map((f) => (
            <div key={f.name} className={`field field-${f.type}`}>
              {f.type === "checkbox" ? (
                <label className="check">
                  <input type="checkbox" checked={!!values[f.name]} onChange={(e) => set(f.name, e.target.checked)} />
                  {f.label}
                  {f.hint && <span className="hint">{f.hint}</span>}
                </label>
              ) : f.type === "radio" ? (
                <fieldset>
                  <legend>{f.label}</legend>
                  {f.options.map((o) => (
                    <label key={o.value} className="check">
                      <input
                        type="radio"
                        name={f.name}
                        checked={values[f.name] === o.value}
                        onChange={() => set(f.name, o.value)}
                      />
                      <b>{o.label}</b>
                      {o.hint && <span className="hint">{o.hint}</span>}
                    </label>
                  ))}
                </fieldset>
              ) : (
                <>
                  <label>{f.label}</label>
                  {f.type === "textarea" ? (
                    <textarea
                      value={String(values[f.name])}
                      placeholder={f.placeholder}
                      onChange={(e) => set(f.name, e.target.value)}
                      rows={4}
                    />
                  ) : f.type === "select" ? (
                    <select value={String(values[f.name])} onChange={(e) => set(f.name, e.target.value)}>
                      {f.options.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : f.type === "folder" ? (
                    <div className="folder-input">
                      <input value={String(values[f.name])} onChange={(e) => set(f.name, e.target.value)} />
                      <button
                        type="button"
                        onClick={async () => {
                          const p = await pickFolder();
                          if (p) set(f.name, p);
                        }}
                      >
                        Browse…
                      </button>
                    </div>
                  ) : (
                    <input
                      className={f.mono ? "mono" : ""}
                      value={String(values[f.name])}
                      placeholder={f.placeholder}
                      onChange={(e) => set(f.name, e.target.value)}
                      spellCheck={false}
                    />
                  )}
                </>
              )}
            </div>
          ))}
          {error && <div className="error">{error}</div>}
        </div>
        <footer>
          {opts.cancel !== false && (
            <button type="button" onClick={() => onDone(null)}>
              {opts.cancel ?? "Cancel"}
            </button>
          )}
          <button type="submit" className={opts.danger ? "danger" : "primary"}>
            {opts.ok ?? "OK"}
          </button>
        </footer>
      </form>
    </div>
  );
}
