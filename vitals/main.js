// CPU, memory, swap, disk, network (and battery on a Mac) for this computer and every
// connected machine, one card each, with live graphs for CPU, memory and network.
// One shell call per machine per sample. Panel design from
// ozcberkay/herdr-coban (machine-vitals), Apache-2.0.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, theme, layout, window, machines } from "herdr";
import { MAC_SCRIPT, LINUX_SCRIPT, MAC_PROCS, LINUX_PROCS, parseMac, parseLinux, parseProcs, netRate, rate, gb } from "./stats.js";

const SAMPLES = 40; // graph history: 40 samples
const EVERY = 3000; // ms between samples while the window is in front and the tab is shown
const AWAY = 30000; // ms otherwise

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}
const shown = () => {
  const root = layout();
  return !find(root, "panel")?.hidden && find(root, "panel-body")?.active === "vitals";
};

// This computer first, then every named machine; layout "unavailable" = offline.
const list = () => [{ name: null, layout: "ready" }, ...machines().filter((m) => m.name)];

const OS = { Darwin: "macOS", Linux: "Linux" };
const PRESSURE_COLOR = { warning: "ansi3", critical: "ansi1" };
const NET_FLOOR = 100_000; // bytes/s: the network graph never scales below this, so idle chatter stays flat

export default class Vitals extends View {
  init(_props, cx) {
    this.m = new Map(); // machine name ("" = this computer) -> sampling state
    this.tick(cx);
    cx.timer.every(EVERY, (cx) => this.tick(cx));
  }

  tick(cx) {
    const every = window()?.active && shown() ? EVERY : AWAY;
    for (const { name, layout: state } of list()) {
      const s = this.state(name);
      if (state === "unavailable") {
        if (!s.offline) { s.offline = true; cx.notify(); }
      } else if (!s.busy && Date.now() - s.last >= every - 100) this.sample(name, cx);
    }
  }

  state(name) {
    const key = name ?? "";
    if (!this.m.has(key)) this.m.set(key, { os: null, hist: { cpu: [], mem: [], rx: [], tx: [] }, now: null, raw: null, net: null, procs: [], busy: false, last: 0, offline: false });
    return this.m.get(key);
  }

  sample(name, cx) {
    const s = this.state(name);
    s.busy = true;
    s.last = Date.now();
    cx.spawn(async (cx) => {
      try {
        const on = name ?? null;
        s.os ??= (await exec("uname", ["-s"], { on })).stdout.trim();
        if (s.os === "Darwin") s.now = parseMac((await exec("sh", ["-c", MAC_SCRIPT], { on })).stdout);
        else if (s.os === "Linux") {
          s.now = parseLinux((await exec("sh", ["-c", LINUX_SCRIPT], { on })).stdout, s.raw);
          s.raw = s.now.raw;
        }
        if (s.now) {
          const net = s.now.net && { ...s.now.net, at: Date.now() };
          const speed = netRate(s.net, net);
          s.net = net;
          s.speed = speed;
          // One entry per sample in every history (null = no value), so the graphs stay aligned in time.
          const push = (key, v) => { s.hist[key] = [...s.hist[key], v].slice(-SAMPLES); };
          push("cpu", s.now.cpu);
          push("mem", s.now.mem.total ? (s.now.mem.used / s.now.mem.total) * 100 : null);
          push("rx", speed?.rx ?? null);
          push("tx", speed?.tx ?? null);
        }
        s.offline = false;
      } catch {
        s.offline = true;
        s.raw = s.net = null; // the gap would make the next delta meaningless
      } finally {
        s.busy = false;
      }
      cx.notify();
    });
  }

  loadProcs(name, cx) {
    const s = this.state(name);
    cx.spawn(async (cx) => {
      try { s.procs = parseProcs((await exec("sh", ["-c", s.os === "Darwin" ? MAC_PROCS : LINUX_PROCS], { on: name ?? null })).stdout); } catch { s.procs = []; }
      cx.notify();
    });
  }

  section(name, t) {
    const s = this.state(name);
    const id = `v-${name ?? "local"}`;
    const dead = s.offline || !s.now;
    const supported = s.os === null || s.os in OS;
    const warn = (pct, high = 85) => (pct >= 95 ? t.ansi1 : pct >= high ? t.ansi3 : t.accent);

    const b = s.now?.battery;
    // Card with a headline row, as the Files and Changes panels draw theirs.
    const header = h_flex().h(34).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border)
      .child(div().min_w(0).truncate().font_semibold().child(name ?? "This computer"))
      .when(Boolean(OS[s.os]), (el) => el.child(
        div().flex_none().px(5).py(1).rounded(4).border_1().border_color(t.border).text_size(10).text_color(t.muted).child(OS[s.os])))
      .child(div().flex_1())
      .when(Boolean(b) && !s.offline, (el) => el.child(
        div().id(`${id}-battery`).flex_none().text_size(11).text_color(b.pct <= 15 && !b.ac ? t.ansi1 : t.dim)
          .child(`Battery ${b.pct}%${b.ac ? " · AC" : ""}`)
          .tooltip(`Battery ${b.pct}%, ${b.state}${b.ac ? ", on AC power" : ""}`)));

    const card = v_flex().id(id).flex_none().rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border)
      .text_color(t.foreground).opacity(s.offline ? 0.5 : 1)
      .when(name === null && s.os === "Darwin", (el) => el.cursor_pointer()
        .on_click(() => exec("open", ["-a", "Activity Monitor"]).catch(() => {})))
      .child(header);
    const note = (text) => card.child(div().px(12).py(10).text_size(11).text_color(t.dim).child(text));
    if (!supported) return note(`unsupported (${s.os})`);
    if (s.offline) return note("offline");
    if (dead) return note("…");

    const { now, hist } = s;
    const cpu = hist.cpu.at(-1) ?? null;
    const memColor = t[PRESSURE_COLOR[now.mem.pressure]] ?? t.accent;
    const memPct = now.mem.total ? (now.mem.used / now.mem.total) * 100 : 0;
    const swapPct = now.swap.total ? (now.swap.used / now.swap.total) * 100 : 0;
    const diskUsed = now.disk ? 100 - (now.disk.free / now.disk.total) * 100 : 0;
    const strong = (color) => (color === t.accent ? null : color); // values stay plain until they warn

    const bar = (pct, color) =>
      div().flex_1().h(6).rounded(3).bg(t.border).overflow_hidden()
        .child(div().h_full().w(`${Math.max(0, Math.min(100, pct))}%`).rounded(3).bg(color));
    const row = (rid, label, viz, value, valueColor, tip, onHover) =>
      h_flex().id(`${id}-${rid}`).h(20).gap(8).items_center()
        .child(div().w(30).flex_none().text_size(11).text_color(t.dim).child(label))
        .child(viz)
        .child(div().w(72).flex_none().text_right().text_size(11.5).text_color(valueColor ?? t.foreground).truncate().child(value))
        .when(Boolean(tip), (el) => el.tooltip(tip))
        .when(Boolean(onHover), (el) => el.on_hover(onHover));

    // One thin bar per sample, newest on the right and brightest. `down` hangs the bars from the top.
    const graph = (values, max, color, h, down = false) =>
      h_flex().w_full().h(h).flex_none().gap(1).when(!down, (el) => el.items_end()).when(down, (el) => el.items_start()).children(
        Array.from({ length: SAMPLES }, (_, i) => {
          const v = values[i - (SAMPLES - values.length)];
          const c = typeof color === "function" ? color(v ?? 0) : color;
          return div().flex_1().min_w(1).rounded(1)
            .h(v == null ? 1 : Math.max(1, Math.round(Math.min(1, v / max) * h)))
            .bg(v == null ? t.border : i === SAMPLES - 1 ? c : c + "99");
        }),
      );
    const under = (...els) => v_flex().pt(2).pb(6).children(els);

    const netMax = Math.max(NET_FLOOR, ...hist.rx.map((v) => v ?? 0), ...hist.tx.map((v) => v ?? 0));
    const speed = (arrow, v, color) =>
      div().w(84).flex_none().text_right().text_size(11.5).text_color(v == null ? t.dim : color).child(`${arrow} ${v == null ? "…" : rate(v)}`);

    const procs = s.procs.map((p) => `${p.name}  ${Math.round(p.cpu)}%`).join("\n");
    return card.child(v_flex().px(12).pt(8).pb(2).gap(1)
      .child(row("cpu", "CPU", bar(cpu ?? 0, warn(cpu ?? 0)), cpu === null ? "…" : `${Math.round(cpu)}%`, cpu === null ? t.dim : strong(warn(cpu)),
        procs ? `Most CPU lately:\n${procs}` : "Most CPU lately: …", (hovered, cx) => { if (hovered) this.loadProcs(name, cx); }))
      .child(under(graph(hist.cpu, 100, warn, 26)))
      .child(row("mem", "Mem", bar(memPct, memColor), `${gb(now.mem.used)}/${gb(now.mem.total)} GB`, strong(memColor),
        `Memory pressure ${now.mem.pressure}`))
      .child(under(graph(hist.mem, 100, memColor, 26)))
      .child(row("swap", "Swap", bar(swapPct, warn(swapPct)), now.swap.total ? `${gb(now.swap.used)}/${gb(now.swap.total)} GB` : "none",
        now.swap.total ? strong(warn(swapPct)) : t.dim, now.swap.total ? `Swap ${Math.round(swapPct)}% used` : "No swap in use"))
      .child(row("disk", "Disk", bar(diskUsed, warn(diskUsed, 90)), now.disk ? `${gb(now.disk.free)} GB free` : "…", diskUsed >= 90 ? warn(diskUsed, 90) : null, null))
      .when(Boolean(now.net), (el) => el
        .child(h_flex().id(`${id}-net`).h(20).mt(2).gap(8).items_center().tooltip(`Network, all wired and Wi-Fi interfaces\nGraph scale: ${rate(netMax)}`)
          .child(div().w(30).flex_none().text_size(11).text_color(t.dim).child("Net"))
          .child(div().flex_1())
          .child(speed("↓", s.speed?.rx, t.accent))
          .child(speed("↑", s.speed?.tx, t.ansi5)))
        .child(under(
          graph(hist.rx, netMax, t.accent, 16),
          div().h(1).my(1).bg(t.border),
          graph(hist.tx, netMax, t.ansi5, 16, true)))));
  }

  render() {
    const t = theme();
    return v_flex().id("vitals").size_full().bg(t.chrome).p(8).gap(8).text_size(12).overflow_y_scrollbar()
      .children(list().map((m) => this.section(m.name, t)));
  }
}
