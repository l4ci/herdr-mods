import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseMac, parseLinux, parseProcs, netRate, rate, gb, MAC_SCRIPT, LINUX_SCRIPT } from "../stats.js";

const fx = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8");

test("mac: cpu, memory, swap, disk, battery from a real capture", () => {
  const s = parseMac(fx("mac.txt"));
  assert.equal(s.cpu, 21); // iostat last row: us 15 sy 6 id 79
  assert.equal(s.mem.total, 25769803776);
  assert.equal(s.mem.pressure, "normal");
  assert.ok(s.mem.used > 0 && s.mem.used < s.mem.total);
  assert.deepEqual(s.swap, { used: 2073.25 * 2 ** 20, total: 3072 * 2 ** 20 });
  // en0 + en1 link rows only: no loopback, no address rows, no VPN tunnel
  assert.deepEqual(s.net, { rx: 6976826835 + 90000, tx: 2644107281 + 10000 });
  assert.deepEqual(s.disk, { total: 482797652 * 1024, free: 66147484 * 1024 });
  assert.deepEqual(s.battery, { pct: 100, state: "charged", ac: true });
});

test("mac: garbage input yields nulls, not throws", () => {
  const s = parseMac("");
  assert.equal(s.cpu, null);
  assert.equal(s.disk, null);
  assert.equal(s.battery, null);
  assert.equal(s.net, null);
  assert.deepEqual(s.swap, { used: 0, total: 0 });
});

test("linux: first sample has no cpu, second is the delta", () => {
  const a = parseLinux(fx("linux-1.txt"), null);
  assert.equal(a.cpu, null);
  assert.deepEqual(a.raw, { total: 184930011 + 74203652 + 113838541 + 746931419 + 6613963 + 0 + 1993666 + 0, idle: 746931419 + 6613963 });
  const b = parseLinux(fx("linux-2.txt"), a.raw);
  // by hand: total delta 14+0+6+3223+0+0+1+0 = 3244, idle delta 3223
  assert.ok(Math.abs(b.cpu - (1 - 3223 / 3244) * 100) < 1e-9);
  assert.ok(b.cpu >= 0 && b.cpu <= 100);
});

test("linux: memory, swap, pressure, disk", () => {
  const s = parseLinux(fx("linux-1.txt"), null);
  assert.equal(s.mem.total, 15988544 * 1024);
  assert.equal(s.mem.used, (15988544 - 12347496) * 1024);
  assert.equal(s.mem.pressure, "normal");
  assert.deepEqual(s.swap, { used: (4194300 - 734204) * 1024, total: 4194300 * 1024 });
  // eth0 only: no loopback, bridge, veth or VPN (interface list as on a real Debian host)
  assert.deepEqual(s.net, { rx: 8123456789, tx: 3123456789 });
  assert.deepEqual(s.disk, { total: 78425224 * 1024, free: 7139740 * 1024 });
  assert.equal(s.battery, null);
});

test("linux: PSI thresholds and missing PSI", () => {
  const base = fx("linux-1.txt");
  const withPsi = (v) => base.replace(/some avg10=[\d.]+/, `some avg10=${v}`);
  assert.equal(parseLinux(withPsi("9.99")).mem.pressure, "normal");
  assert.equal(parseLinux(withPsi("10.00")).mem.pressure, "warning");
  assert.equal(parseLinux(withPsi("39.9")).mem.pressure, "warning");
  assert.equal(parseLinux(withPsi("40.00")).mem.pressure, "critical");
  assert.equal(parseLinux(base.replace(/@psi\n[\s\S]*?@df/, "@psi\n@df")).mem.pressure, "normal");
});

test("linux: counter reset or garbage gives no cpu", () => {
  const a = parseLinux(fx("linux-2.txt"), null);
  assert.equal(parseLinux(fx("linux-1.txt"), a.raw).cpu, null);
  assert.equal(parseLinux("", null).raw, null);
});

test("procs: top 3, helper processes dropped", () => {
  assert.deepEqual(parseProcs(fx("linux-procs.txt")), [
    { name: "syncthing", cpu: 4.3 }, { name: "herdr", cpu: 2.5 }, { name: "jbd2/sda1-8", cpu: 1.3 },
  ]);
  const mac = parseProcs(fx("mac-procs.txt"));
  assert.equal(mac.length, 3);
  assert.equal(mac[1].name, "WindowServer");
  assert.deepEqual(parseProcs(" 9.0 ps\n 8.0 sh\n 1.0 foo\n"), [{ name: "foo", cpu: 1 }]);
});

test("gb rounding", () => {
  assert.equal(gb(2 ** 30 * 1.26), "1.3");
  assert.equal(gb(2 ** 30 * 150.4), "150");
});

test("scripts force the C locale", () => {
  assert.match(MAC_SCRIPT, /LC_ALL=C/);
  assert.match(LINUX_SCRIPT, /LC_ALL=C/);
});

test("net rate: delta per second, null on first sample or counter reset", () => {
  const a = { ...parseLinux(fx("linux-1.txt")).net, at: 10_000 };
  const b = { ...parseLinux(fx("linux-2.txt")).net, at: 13_000 };
  assert.deepEqual(netRate(a, b), { rx: 100_000, tx: 20_000 });
  assert.equal(netRate(null, b), null);
  assert.equal(netRate(b, a), null);
  assert.equal(netRate(a, { ...a, rx: a.rx - 1, at: 13_000 }), null);
  assert.equal(netRate(a, { ...b, at: a.at }), null);
});

test("rate formatting", () => {
  assert.equal(rate(0), "0 B/s");
  assert.equal(rate(999), "999 B/s");
  assert.equal(rate(1200), "1.2 KB/s");
  assert.equal(rate(340_000), "340 KB/s");
  assert.equal(rate(999_900), "1.0 MB/s");
  assert.equal(rate(12_400_000), "12 MB/s");
  assert.equal(rate(2_500_000_000), "2.5 GB/s");
});
