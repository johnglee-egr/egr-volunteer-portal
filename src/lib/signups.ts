// Whether a shift still accepts new volunteers.
//
// Coordinators close sign-ups once a category or a single shift has enough
// people, even though empty slots remain — the slack is deliberate. This gates
// self-signup, team-captain assignment and the join-a-team flow. Admins are not
// gated: they may still place someone into a closed shift on purpose.

export type ClosableShift = {
  title?: string;
  signupsClosed: boolean;
  category?: { name?: string; signupsClosed: boolean } | null;
};

export function signupsClosedFor(shift: ClosableShift): boolean {
  return shift.signupsClosed || shift.category?.signupsClosed === true;
}

/** Message for a volunteer or captain who tried to sign up anyway. */
export function closedReason(shift: ClosableShift): string {
  if (shift.category?.signupsClosed) {
    const name = shift.category.name ? `"${shift.category.name}"` : "this category";
    return `Sign-ups for ${name} are closed — we have all the volunteers we need. Please pick another category or contact the volunteer coordinator.`;
  }
  const name = shift.title ? `"${shift.title}"` : "this shift";
  return `Sign-ups for ${name} are closed — we have all the volunteers we need. Please pick another shift or contact the volunteer coordinator.`;
}
