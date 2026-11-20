// Subscription usage for each Claude account and Codex as one line in the status bar:
// per source its icon, initials ("CW1" for Claude Work 1) and, per window, the percent used: white, then orange
// (ansi3) and red (ansi1) as it nears the limit. The details (bars, reset time, pace,
// age) are in a card that opens while the pointer rests on an item. A copy of the Limits mod's view;
// data.js is the same file as limits/mods/limits/data.js. Colors from
// ozcberkay/herdr-coban claude-status, Apache-2.0.
import { View, div, image } from "gpui-kit";
import { h_flex, v_flex, HoverCard } from "gpui-base";
import { exec, theme } from "herdr";
import { SCRIPT, parseOutput, initials, windowState, tone, ageText, isStale, span, clock, DAYS } from "./data.js";

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

  // The card shown while the pointer rests on an item: per window a bar with the pace
  // mark, then when it resets and where the use ends at this pace. Same look as the
  // cards of the Limits mod.
  card(id, kind, name, windows, at, t, now) {
    const color = (s) => t[tone(s)];
    const strong = (s) => (s.reset ? t.dim : color(s) === t.accent ? t.foreground : color(s));
    const age = ageText(at, now);
    const header = h_flex().h(36).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border)
      .child(image(`icons/${kind}.svg`).size(14).flex_none())
      .child(div().min_w(0).truncate().text_size(13).font_semibold().child(name))
      .child(div().flex_1())
      .when(Boolean(age), (el) => el.child(
        div().flex_none().text_size(11).text_color(isStale(at, now) ? t.ansi3 : t.dim).child(age === "now" ? "read now" : `read ${age} ago`)));
    const bar = (s) =>
      div().flex_1().h(6).rounded(3).bg(t.border).relative()
        .child(div().h_full().w(`${Math.max(0, Math.min(100, s.used))}%`).rounded(3).bg(color(s)))
        .when(s.passed !== null, (el) => el.child(
          div().absolute().top(-3).h(12).w(2).rounded(1).bg(t.foreground).opacity(0.55).left(`${s.passed * 100}%`)));
    const resets = (s) => {
      if (s.reset) return "Reset. New numbers with the next response";
      if (s.left === null) return "No reset time";
      const d = new Date(s.at * 1000);
      return `Resets ${s.left > 86400 ? `${DAYS[d.getDay()]} ` : ""}${clock(d)} · in ${span(s.left)}`;
    };
    const block = (s) =>
      v_flex().gap(3)
        .child(h_flex().h(18).gap(8).items_center()
          .child(div().w(22).flex_none().text_size(11.5).font_semibold().text_color(t.muted).child(s.label))
          .child(bar(s))
          .child(div().w(34).flex_none().text_right().text_size(12).font_semibold().text_color(strong(s)).child(`${Math.round(s.used)}%`)))
        .child(h_flex().pl(30).gap(8).items_center().text_size(11).text_color(t.dim)
          .child(div().min_w(0).truncate().child(resets(s)))
          .child(div().flex_1())
          .when(s.pace !== null && !s.reset, (el) => el.child(
            div().flex_none().text_color(color(s) === t.accent ? t.dim : color(s)).child(`pace ${Math.round(s.pace)}%`))));
    return v_flex().id(`${id}-card`).w(292).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border)
      .shadow_lg().text_color(t.foreground)
      .child(header)
      .child(v_flex().px(12).py(10).gap(10)
        .when(windows.length === 0, (el) => el.child(
          div().text_size(11.5).text_color(t.dim).child(this.data === undefined ? "Cannot read the limits" : "No data yet")))
        .children(windows.map(block)))
      .child(h_flex().h(26).flex_none().px(12).items_center().border_t(1).border_color(t.border).bg(t.chrome)
        .text_size(10.5).text_color(t.dim).child("Click to open the usage page"));
  }

  item(id, kind, name, src, t, now) {
    const color = (s) => t[tone(s)];
    const windows = (src?.windows ?? []).map((w) => windowState(w, now));
    const stale = isStale(src?.at, now);
    const win = (s) =>
      h_flex().gap(5).items_center().flex_none()
        .child(div().text_color(t.dim).child(s.label))
        .child(div().text_color(s.reset ? t.dim : color(s) === t.accent ? t.foreground : color(s)).child(`${Math.round(s.used)}%`));
    const trigger = h_flex().id(id).flex_none().gap(7).items_center().px(6).h(22).rounded(5).cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click(() => exec("open", [URLS[kind]]).catch(() => {}))
      .child(image(`icons/${kind}.svg`).size(12).flex_none())
      .child(div().text_color(stale ? t.ansi3 : t.muted).child(initials(name)))
      .when(windows.length === 0, (el) => el.child(div().text_color(t.dim).child(this.data === undefined ? "cannot read" : "no data")))
      .children(windows.map(win));
    const card = this.card(id, kind, name, windows, src?.at, t, now);
    return HoverCard.new(`${id}-hover`).anchor("bottom_center").open_delay(250).close_delay(150).trigger(trigger).content(card);
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
