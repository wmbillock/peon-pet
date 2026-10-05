'use strict';
// SEAM, not a feature. Hub writes and external actions (Slack, Jira, ...) will one day require an
// explicit approval from the user, either time-boxed ("for the next 30 minutes") or blanket.
// Until that slice exists nothing is ever granted, so every caller can already ask.
//
// Rule for the future implementation: a grant may be created or changed ONLY by a message with
// origin "user" delivered by the pet UI. Never because of text the agent read (hub files, web, tool
// output) or produced. Grants live outside the agent-writable kb and never in the agent's context.
function isGranted(/* action, ctx */) {
  return { granted: false, reason: 'approvals are not built yet; this slice is read-only plus its own kb' };
}

module.exports = { isGranted };
