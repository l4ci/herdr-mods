// Pure parsers for the command output the panel samples, one script per OS.
// No Herdr imports, so tests can load this file with plain Node.
// macOS parsers adapted from ozcberkay/herdr-coban (machine-vitals), Apache-2.0.

const GIB = 2 ** 30;

// `iostat -n 0 -c 2 -w 1`: the first row counts from boot, the last one covers the last second.
export const MAC_SCRIPT = [
  "export LC_ALL=C", // a German locale prints "2073,25M" and "88,6"
  "echo @cpu; iostat -n 0 -c 2 -w 1",
  "echo @vm; vm_stat",
  "echo @sys; sysctl -n hw.memsize kern.memorystatus_vm_pressure_level vm.swapusage",
  "echo @df; df -k /",
  "echo @batt; pmset -g batt",
  "echo @net; netstat -ibn",
].join("; ");

// No sleep: CPU comes from the delta between two samples of /proc/stat.
export const LINUX_SCRIPT = [
  "export LC_ALL=C",
  "echo @stat; head -1 /proc/stat",
  "echo @mem; grep -E '^(MemTotal|MemAvailable|SwapTotal|SwapFree):' /proc/meminfo",
  "echo @psi; cat /proc/pressure/memory 2>/dev/null",
  "echo @df; df -kP /",
  "echo @net; cat /proc/net/dev",
].join("; ");

// Asked only while the pointer is on the CPU row: `ps` reads every process.
export const MAC_PROCS = "LC_ALL=C ps -Aceo pcpu=,comm= -r | head -n 6";
export const LINUX_PROCS = "LC_ALL=C ps -eo pcpu=,comm= --sort=-pcpu | head -n 6";

const part = (out, name) => out.split(`@${name}\n`)[1]?.split("\n@")[0] ?? "";

function disk(out) {
  const df = part(out, "df").trim().split("\n").at(-1)?.split(/\s+/) ?? [];
  return df.length > 3 ? { total: Number(df[1]) * 1024, free: Number(df[3]) * 1024 } : null;
}

// Byte counters since boot, summed over the interfaces that carry real traffic.
// macOS `netstat -ibn`: one "<Link#n>" row per interface; the address column can be
// empty, so the byte columns are counted from the end of the row.
function macNet(out) {
  let rx = 0, tx = 0, seen = false;
  for (const line of part(out, "net").split("\n")) {
    const f = line.trim().split(/\s+/);
    if (!/^en\d+\*?$/.test(f[0]) || !f[2]?.startsWith("<Link#") || f.length < 10) continue;
    const i = Number(f.at(-5)), o = Number(f.at(-2));
    if (!Number.isFinite(i) || !Number.isFinite(o)) continue;
    rx += i; tx += o; seen = true;
  }
  return seen ? { rx, tx } : null;
}

// Linux /proc/net/dev: "iface: rxbytes 7 more fields txbytes ...". Loopback and the
// virtual interfaces that repeat traffic of a physical one are left out.
function linuxNet(out) {
  let rx = 0, tx = 0, seen = false;
  for (const line of part(out, "net").split("\n")) {
    const m = line.match(/^\s*([^\s:]+):\s*(.+)$/);
    if (!m || /^(lo|veth|docker|br-|virbr|tun|tap|tailscale|wg|zt)/.test(m[1])) continue;
    const f = m[2].trim().split(/\s+/).map(Number);
    if (f.length < 9 || !Number.isFinite(f[0]) || !Number.isFinite(f[8])) continue;
    rx += f[0]; tx += f[8]; seen = true;
  }
  return seen ? { rx, tx } : null;
}

export function parseMac(out) {
  const cpuRow = part(out, "cpu").trim().split("\n").at(-1)?.trim().split(/\s+/) ?? [];
  const idle = cpuRow.length >= 3 && /^\d+$/.test(cpuRow[2]) ? Number(cpuRow[2]) : null;

  const vm = part(out, "vm");
  const pageSize = Number(vm.match(/page size of (\d+)/)?.[1] ?? 16384);
  const pages = (label) => Number(vm.match(new RegExp(`${label}:\\s+(\\d+)`))?.[1] ?? 0);
  // Activity Monitor's "Memory Used": app memory + wired + compressed.
  const used = (pages("Anonymous pages") - pages("Pages purgeable") + pages("Pages wired down") + pages("Pages occupied by compressor")) * pageSize;

  const [memsize, pressure, swap = ""] = part(out, "sys").split("\n");
  const swapBytes = (key) => {
    const m = swap.match(new RegExp(`${key} = ([\\d.]+)([MG])`));
    return m ? Number(m[1]) * (m[2] === "G" ? GIB : 2 ** 20) : 0;
  };

  const batt = part(out, "batt");
  const level = batt.match(/(\d+)%;\s*([^;]+)/);

  return {
    cpu: idle === null ? null : Math.max(0, Math.min(100, 100 - idle)),
    mem: { used, total: Number(memsize) || 0, pressure: { 1: "normal", 2: "warning", 4: "critical" }[Number(pressure)] ?? "normal" },
    swap: { used: swapBytes("used"), total: swapBytes("total") },
    disk: disk(out),
    net: macNet(out),
    battery: level ? { pct: Number(level[1]), state: level[2].trim(), ac: batt.includes("AC Power") } : null,
  };
}

// `prev` is the `raw` of the previous sample (or null). Returns `raw` to pass to the next call.
export function parseLinux(out, prev = null) {
  const f = part(out, "stat").trim().split(/\s+/).slice(1, 9).map(Number);
  const raw = f.length >= 4 && f.every(Number.isFinite) ? { total: f.reduce((a, b) => a + b, 0), idle: f[3] + (f[4] ?? 0) } : null;
  let cpu = null;
  if (raw && prev && raw.total > prev.total) {
    cpu = Math.max(0, Math.min(100, (1 - (raw.idle - prev.idle) / (raw.total - prev.total)) * 100));
  }

  const mem = part(out, "mem");
  const kb = (key) => (Number(mem.match(new RegExp(`^${key}:\\s+(\\d+)`, "m"))?.[1]) || 0) * 1024;
  const total = kb("MemTotal");
  const swapTotal = kb("SwapTotal");

  // PSI "some avg10": thresholds 10 / 40 are judgment calls.
  const psi = Number(part(out, "psi").match(/^some .*?avg10=([\d.]+)/m)?.[1]);
  const pressure = !Number.isFinite(psi) ? "normal" : psi >= 40 ? "critical" : psi >= 10 ? "warning" : "normal";

  return {
    cpu,
    raw,
    mem: { used: total - kb("MemAvailable"), total, pressure },
    swap: { used: swapTotal - kb("SwapFree"), total: swapTotal },
    disk: disk(out),
    net: linuxNet(out),
    battery: null,
  };
}

// `ps -eo pcpu=,comm=` sorted busiest first, minus the processes this panel started.
export function parseProcs(out, count = 3) {
  return out.split("\n")
    .map((l) => l.match(/^\s*([\d.]+)\s+(.+?)\s*$/))
    .filter((m) => m && !["ps", "head", "sh"].includes(m[2]))
    .slice(0, count)
    .map((m) => ({ name: m[2], cpu: Number(m[1]) }));
}

export const gb = (bytes) => String(bytes / GIB >= 100 ? Math.round(bytes / GIB) : Math.round((bytes / GIB) * 10) / 10);

// Bytes per second between two `net` samples, each with the time `at` (ms) it was taken.
// null on the first sample and when a counter went backwards (reboot, interface reset).
export function netRate(prev, cur) {
  if (!prev || !cur || cur.at <= prev.at || cur.rx < prev.rx || cur.tx < prev.tx) return null;
  const sec = (cur.at - prev.at) / 1000;
  return { rx: (cur.rx - prev.rx) / sec, tx: (cur.tx - prev.tx) / sec };
}

export function rate(bytes) {
  if (bytes < 1000) return `${Math.round(bytes)} B/s`;
  for (const unit of ["KB", "MB", "GB"]) {
    bytes /= 1000;
    if (bytes < 999.5 || unit === "GB") return `${bytes < 9.95 ? bytes.toFixed(1) : Math.round(bytes)} ${unit}/s`;
  }
}
