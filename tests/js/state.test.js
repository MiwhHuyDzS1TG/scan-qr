import test from "node:test";
import assert from "node:assert/strict";

import { createState, hydrateMembers, toggleVisibleSelection, visibleMembers } from "../../public/js/state.js";

test("changing filters preserves selection", () => {
  const state = createState();
  state.members = hydrateMembers([{ id: "A", alias: "A" }, { id: "B", alias: "B" }]);
  state.members[0].selected = true;
  state.filter = "idle";
  assert.equal(visibleMembers(state).length, 2);
  state.filter = "selected";
  assert.deepEqual(visibleMembers(state).map((member) => member.id), ["A"]);
  assert.equal(state.members[0].selected, true);
});

test("select visible only affects filtered results", () => {
  const state = createState();
  state.members = hydrateMembers([{ id: "A", alias: "A" }, { id: "B", alias: "B" }]);
  state.members[1].status = "failed";
  state.filter = "failed";
  toggleVisibleSelection(state, true);
  assert.equal(state.members[0].selected, false);
  assert.equal(state.members[1].selected, true);
});

test("select all selects all six production aliases", () => {
  const aliases = ["MinhHuy", "HoangPhong", "GiaLam", "MinhKhang", "NgocDuc", "KimNgan"];
  const state = createState();
  state.members = hydrateMembers(aliases.map((alias) => ({ id: alias, alias })));
  toggleVisibleSelection(state, true);
  assert.equal(state.members.length, 6);
  assert.equal(state.members.filter((member) => member.selected).length, 6);
});

