const STATUS_VALUES = ["idle", "scanning", "success", "already_present", "failed", "unknown"];

export function createState() {
  return {
    session: null,
    members: [],
    filter: "all",
    search: "",
    logs: [],
    logLevel: "all",
    logMember: "all",
    batch: { running: false, stopping: false, id: null, total: 0, processed: 0, current: null, startedAt: null, skipped: 0 },
    health: null,
  };
}

export function hydrateMembers(items) {
  return items.map((item) => ({
    ...item,
    selected: false,
    status: "idle",
    result: null,
    server_name: item.display_name || null,
  }));
}

export function matchesSearch(member, query) {
  const haystack = [member.alias, member.display_name, member.server_name, member.class_name, member.student_number]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("vi");
  return haystack.includes(String(query || "").trim().toLocaleLowerCase("vi"));
}

export function visibleMembers(state) {
  return state.members.filter((member) => {
    const filterMatch = state.filter === "all" || (state.filter === "selected" ? member.selected : member.status === state.filter);
    return filterMatch && matchesSearch(member, state.search);
  });
}

export function selectedMembers(state) {
  return state.members.filter((member) => member.selected);
}

export function queueCandidates(state) {
  return selectedMembers(state).filter((member) => !["success", "already_present"].includes(member.status));
}

export function statusCounts(state) {
  const counts = Object.fromEntries(STATUS_VALUES.map((status) => [status, 0]));
  state.members.forEach((member) => { counts[member.status] = (counts[member.status] || 0) + 1; });
  counts.all = state.members.length;
  counts.selected = selectedMembers(state).length;
  counts.verified = state.members.filter((member) => member.result?.verified_present && !member.result?.is_simulation).length;
  counts.realSuccess = state.members.filter((member) => member.status === "success" && member.result?.verified_present).length;
  counts.realPresent = state.members.filter((member) => member.status === "already_present" && member.result?.verified_present).length;
  counts.realFailed = state.members.filter((member) => member.status === "failed" && !member.result?.is_simulation).length;
  counts.realUnknown = state.members.filter((member) => member.status === "unknown" && !member.result?.is_simulation).length;
  return counts;
}

export function applyResult(member, result) {
  member.status = STATUS_VALUES.includes(result.status) ? result.status : "unknown";
  member.result = result;
  if (result.student) {
    member.server_name = result.student.name || member.server_name;
    member.class_name = result.student.class_name || member.class_name;
    member.student_number = result.student.student_number || member.student_number;
    member.role = result.student.role || member.role;
    member.avatar_url = result.student.avatar_url || member.avatar_url;
  }
  return member;
}

export function toggleVisibleSelection(state, selected) {
  const visibleIds = new Set(visibleMembers(state).map((member) => member.id));
  state.members.forEach((member) => { if (visibleIds.has(member.id)) member.selected = selected; });
}

