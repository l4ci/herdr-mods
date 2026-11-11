// The sidebar's agent rules, with no Herdr imports so Node can test them.

export const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };

// A sub-agent without a pane isn't in agents(): its raw word, error counting as
// blocked. It's never done: it reports to its parent, and the parent's done is the news.
export function kidStatus(k, listed) {
  const s = listed.get(k.address) ?? k.status;
  return s === "error" ? "blocked" : s === "done" ? "idle" : s;
}

// A kept sub-agent is in agents() too: where a tree shows it, it gets no row of
// its own, unless it's pinned.
export function topLevel(list, nested) {
  return list.filter((a) => a.pinned || !nested.has(a.address));
}

// Pinned first; then most urgent, most recently changed, newest.
export function sortAgents(list, rankOf, sinceOf) {
  const by = (x, y) => (rankOf(y) ?? 0) - (rankOf(x) ?? 0) || sinceOf(y) - sinceOf(x) || y.seq - x.seq;
  return [...list.filter((a) => a.pinned).sort(by), ...list.filter((a) => !a.pinned).sort(by)];
}

export function bySpace(list) {
  const out = new Map();
  for (const a of list) {
    if (!out.has(a.space)) out.set(a.space, []);
    out.get(a.space).push(a);
  }
  return out;
}

const NAME = Object.fromEntries(Object.entries(RANK).map(([k, v]) => [v, k]));

// What a folded space or device says: how many, and the most urgent state.
export function summary(list, rankOf) {
  if (!list.length) return null;
  const top = Math.max(...list.map((a) => rankOf(a) ?? 0));
  return { count: list.length, status: NAME[top] ?? null };
}

export function navOrder(groups) {
  return groups.flat().map((a) => a.address);
}

// Space rows in the order the list draws them: by device (this computer first),
// keeping the order inside each. Devices not in `names` are left out.
export function byDevice(rows, names) {
  return names.flatMap((m) => rows.filter((r) => (r.w.machine ?? null) === m));
}
