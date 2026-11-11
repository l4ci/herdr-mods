// Subscription usage for each Claude account and Codex as one line in the status bar:
// per source its icon, name and, per window, the percent used: white, then orange
// (ansi3) and red (ansi1) as it nears the limit. The details (reset time, pace, age)
// are in the tooltip. A copy of the Limits mod's view;
// data.js is the same file as limits/mods/limits/data.js. Colors from
// ozcberkay/herdr-coban claude-status, Apache-2.0.
import { View, div, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { exec, theme } from "herdr";
import { SCRIPT, parseOutput, windowState, tone, ageText, isStale, span, clock, DAYS } from "./data.js";

const EVERY = 30000; // ms between reads
const URLS = { claude: "https://claude.ai/settings/usage", codex: "https://chatgpt.com/codex/settings/usage" };

export default class LimitsBar extends View {
  init(_props, cx) {
    this.data = null; // null: not read yet, undefined: the read failed
    this.sig = "";
    this.busy = false;
    this.read(cx);
    cx.timer.every(EVERY, (cx) => this.read(cx));
  }

  read(cx) {
    if (this.busy) return;
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        const out = (await exec("sh", ["-c", SCRIPT])).stdout;
        // Redraw on new data or when the minute turns (the pace mark moves).
        const sig = `${out}|${Math.floor(Date.now() / 60000)}`;
        if (sig !== this.sig) {
          this.sig = sig;
          this.data = parseOutput(out);
          cx.notify();
        }
      } catch {
        if (this.data !== undefined) {
          this.data = undefined;
          this.sig = "";
          cx.notify();
        }
      } finally {
        this.busy = false;
      }
    });
  }

  // The tooltip: every window's numbers, then how old they are.
  tip(name, windows, at, now) {
    const lines = [name];
    for (const s of windows) {
      if (s.reset) { lines.push(`${s.name}: reset, new numbers with the next response`); continue; }
      let line = `${s.name}: ${Math.round(s.used)}% used`;
      if (s.left !== null) {
        const d = new Date(s.at * 1000);
        line += `, resets ${s.left > 86400 ? `${DAYS[d.getDay()]} ` : ""}${clock(d)} (in ${span(s.left)})`;
      }
      if (s.pace !== null) line += `, ${Math.round(s.pace)}% by then at this pace`;
      lines.push(line);
    }
    const age = ageText(at, now);
    if (age) lines.push(`Read ${age}${age === "now" ? "" : " ago"}`);
    lines.push("Click for the usage page");
    return lines.join("\n");
  }

  item(id, kind, name, src, t, now) {
    const color = (s) => t[tone(s)];
    const windows = (src?.windows ?? []).map((w) => windowState(w, now));
    const stale = isStale(src?.at, now);
    const win = (s) =>
      h_flex().gap(5).items_center().flex_none()
        .child(div().text_color(t.dim).child(s.label))
        .child(div().text_color(s.reset ? t.dim : color(s) === t.accent ? t.foreground : color(s)).child(`${Math.round(s.used)}%`));
    return h_flex().id(id).flex_none().gap(7).items_center().px(6).h(22).rounded(5).cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .tooltip(this.tip(name, windows, src?.at, now))
      .on_click(() => exec("open", [URLS[kind]]).catch(() => {}))
      .child(image(`icons/${kind}.svg`).size(12).flex_none())
      .child(div().text_color(stale ? t.ansi3 : t.muted).child(name))
      .when(windows.length === 0, (el) => el.child(div().text_color(t.dim).child(this.data === undefined ? "cannot read" : "no data")))
      .children(windows.map(win));
  }

  render() {
    const t = theme();
    const now = Date.now() / 1000;
    const root = h_flex().id("limits-bar").size_full().px(8).gap(6).items_center().justify_end().overflow_hidden()
      .bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8);
    if (this.data === null) return root;
    const d = this.data ?? { claude: [], codex: null };
    return root
      .children(d.claude.map((a) => this.item(`lb-${a.name}`, "claude", a.label, a, t, now)))
      .child(this.item("lb-codex", "codex", "Codex", d.codex, t, now));
  }
}
