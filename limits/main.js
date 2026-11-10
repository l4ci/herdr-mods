// Subscription usage for each Claude account and Codex, under the machines in the
// Vitals tab. Reads local files only (see SCRIPT in data.js). Bar design (pace mark,
// colors, reset text) from ozcberkay/herdr-coban claude-status, Apache-2.0.
import { View, div, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, theme } from "herdr";
import { SCRIPT, parseOutput, windowState, tone, resetText, ageText, isStale, span, clock, DAYS } from "./data.js";

const EVERY = 30000; // ms between reads
const URLS = { claude: "https://claude.ai/settings/usage", codex: "https://chatgpt.com/codex/settings/usage" };

export default class Limits extends View {
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
        // Redraw on new data or when the minute turns (the mark and countdowns move).
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

  section(id, kind, name, src, t, now) {
    const color = (s) => t[tone(s)];
    const windows = (src?.windows ?? []).map((w) => windowState(w, now));
    const age = ageText(src?.at, now);
    const stale = isStale(src?.at, now);

    // Card with a headline row, the same as the machine cards in the Vitals mod above.
    const header = h_flex().h(34).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border)
      .child(image(`icons/${kind}.svg`).size(13).flex_none())
      .child(div().min_w(0).truncate().font_semibold().child(name))
      .child(div().flex_1())
      .when(Boolean(age), (el) => el.child(
        div().id(`${id}-age`).flex_none().text_size(11).text_color(stale ? t.ansi3 : t.dim).child(age)
          .tooltip(kind === "codex" ? "When Codex last reported these limits" : "When this account's status line last refreshed these limits")));

    const tip = (s) => {
      if (s.reset) return `${s.name}: the window has reset. New numbers come with the next response.`;
      const lines = [`${s.name}: ${Math.round(s.used)}% used`];
      if (s.left !== null) {
        const d = new Date(s.at * 1000);
        lines.push(`Resets ${s.left > 86400 ? `${DAYS[d.getDay()]} ` : ""}${clock(d)} (in ${span(s.left)})`);
      }
      if (s.pace !== null) lines.push(`At this pace: ${Math.round(s.pace)}% by the reset`);
      return lines.join("\n");
    };
    const bar = (s) =>
      div().flex_1().h(6).rounded(3).bg(t.border).relative()
        .child(div().h_full().w(`${Math.max(0, Math.min(100, s.used))}%`).rounded(3).bg(color(s)))
        .when(s.passed !== null, (el) => el.child(
          div().absolute().top(-3).h(12).w(2).rounded(1).bg(t.foreground).opacity(0.55).left(`${s.passed * 100}%`)));
    const row = (s) =>
      h_flex().id(`${id}-${s.label}`).h(20).gap(8).items_center().tooltip(tip(s))
        .child(div().w(30).flex_none().text_size(11).text_color(t.dim).child(s.label))
        .child(bar(s))
        .child(div().w(32).flex_none().text_right().text_size(11.5).text_color(s.reset ? t.dim : color(s) === t.accent ? t.foreground : color(s))
          .child(`${Math.round(s.used)}%`))
        .child(div().w(62).flex_none().text_right().text_size(11).text_color(t.dim).truncate().child(resetText(s)));

    return v_flex().id(id).flex_none().rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border)
      .text_color(t.foreground).cursor_pointer()
      .on_click(() => exec("open", [URLS[kind]]).catch(() => {}))
      .child(header)
      .child(v_flex().px(12).py(8).gap(1)
        .when(windows.length === 0, (el) => el.child(
          div().h(20).text_size(11).text_color(t.dim).child(this.data === undefined ? "cannot read" : "no data yet")))
        .children(windows.map(row)));
  }

  render() {
    const t = theme();
    const now = Date.now() / 1000;
    const root = v_flex().id("limits").size_full().bg(t.chrome).px(8).pb(8).gap(8).text_size(12).overflow_y_scrollbar();
    if (this.data === null) return root;
    const d = this.data ?? { claude: [], codex: null };
    return root
      .children(d.claude.map((a) => this.section(`l-${a.name}`, "claude", a.label, a, t, now)))
      .child(this.section("l-codex", "codex", "Codex", d.codex, t, now));
  }
}
