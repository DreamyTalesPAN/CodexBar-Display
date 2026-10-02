// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const {isDeepStrictEqual} = require('node:util');
const {readTranscriptTailEntries} = require('../upstream/hooks/clawd-hook');

// PermissionRequest omits tool_use_id in Claude's documented native schema.
// Resolve only one unresolved call with exactly the same session, tool and
// input from Clawd's bounded transcript reader. Ambiguity stays unavailable.
function permissionCallId(payload) {
  if (!payload.session_id || !payload.tool_name || !payload.tool_input) return null;
  const pending = new Map();
  for (const entry of readTranscriptTailEntries(payload.transcript_path) || []) {
    if (entry.sessionId !== payload.session_id || !Array.isArray(entry.message?.content)) continue;
    for (const item of entry.message.content) {
      if (entry.type === 'assistant' && item.type === 'tool_use' && item.name === payload.tool_name && isDeepStrictEqual(item.input, payload.tool_input)) pending.set(item.id, true);
      if (entry.type === 'user' && item.type === 'tool_result') pending.delete(item.tool_use_id);
    }
  }
  return pending.size === 1 ? pending.keys().next().value : null;
}

// Claude emits neither PostToolUseFailure nor PermissionDenied for a manually
// rejected dialog. Reuse Clawd's bounded transcript reader to settle only the
// exact tool call being observed. No text, guessed idle timeout or second store.
function reconcileWait(id, session, update, now) {
  const wait = session.observation?.wait;
  if (session.agentId !== 'claude-code' || session.host || !wait?.callId || !wait.transcriptPath) return;
  const sessionId = String(session.rawSessionId || id).replace(/^claude-code:/, '').split(':subagent:')[0];
  for (const entry of readTranscriptTailEntries(wait.transcriptPath) || []) {
    if (entry.sessionId !== sessionId || entry.type !== 'user' || !Array.isArray(entry.message?.content)) continue;
    const at = Date.parse(entry.timestamp);
    if (!Number.isFinite(at) || at > now || at < wait.at - 1000) continue;
    const result = entry.message.content.find(item => item?.type === 'tool_result' && item.tool_use_id === wait.callId);
    if (!result) continue;
    update(id, result.is_error === true ? 'error' : 'working', result.is_error === true ? 'PostToolUseFailure' : 'PostToolUse', {
      agentId: session.agentId, recapOccurredAt: at,
    });
    return;
  }
}
module.exports = {reconcileWait, permissionCallId};
