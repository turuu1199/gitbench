export function formatDate(ts: number) {
  if (!ts) return "";
  return new Date(ts * 1000).toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function relativeDate(ts: number) {
  const s = Date.now() / 1000 - ts;
  const units: [number, string][] = [
    [31536000, "year"],
    [2592000, "month"],
    [604800, "week"],
    [86400, "day"],
    [3600, "hour"],
    [60, "minute"],
  ];
  for (const [n, name] of units) {
    const v = Math.floor(s / n);
    if (v >= 1) return `${v} ${name}${v > 1 ? "s" : ""} ago`;
  }
  return "just now";
}

export const basename = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

export function errorText(e: unknown) {
  return typeof e === "string" ? e : e instanceof Error ? e.message : JSON.stringify(e);
}

/** Split a console line into args, honouring simple "double" and 'single' quotes. */
export function splitArgs(line: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* clipboard unavailable */
  }
}
