// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const path = require('node:path');
const {getAgent} = require('../upstream/agents/registry');
const {createPidResolver, getPlatformConfig} = require('../upstream/hooks/shared-process');

// Builders, not upstream command entry points: those can answer permissions,
// start the desktop pet or write unrelated account/history state.
const adapters = {
  'claude-code': ['clawd', 'resolver'],
  'codex': ['codex', 'codex'],
  'copilot-cli': ['copilot', 'resolver'],
  'gemini-cli': ['gemini', 'options'],
  'antigravity-cli': ['antigravity', 'options'],
  'kimi-cli': ['kimi', 'resolver'],
  'qwen-code': ['qwen-code', 'resolver'],
  'zcode': ['zcode', 'resolver'],
  'qoder': ['qoder', 'options'],
  'qoderwork': ['qoderwork', 'options'],
  'qwenwork': ['qwenwork', 'options'],
};

function buildObservation(agentId, event, payload, resolve) {
  const adapter = adapters[agentId];
  if (!adapter) throw Error('unsupported-hook-adapter');
  const agent = getAgent(agentId);
  const exports = require(path.join('../upstream/hooks', adapter[0] + '-hook.js'));
  if (!resolve) resolve = createPidResolver({
    agentNames: {win: new Set(agent.processNames.win), mac: new Set(agent.processNames.mac)},
    platformConfig: getPlatformConfig(),
    headlessCheck: exports.isClaudeHeadlessCommandLine,
  });
  const builder = (exports.__test || exports).buildStateBody;
  // Permission bodies are observed through the same normalized identity, but
  // never passed to an upstream permission-response writer.
  const permission = event.toLowerCase() === 'permissionrequest' && agent.capabilities?.permissionApproval === true;
  const builderEvent = permission ? (agentId === 'copilot-cli' ? 'preToolUse' : 'PreToolUse') : event;
  const body = adapter[1] === 'codex'
    ? builder({...payload, hook_event_name: builderEvent}, resolve)
    : builder(builderEvent, payload, adapter[1] === 'options' ? {pidMeta: resolve()} : resolve);
  if (!body) return null;
  if (permission) {
    body.event = 'PermissionRequest';
    if (agentId === 'claude-code' && !body.tool_use_id) {
      const id = require('./claude-wait.cjs').permissionCallId(payload);
      if (id) body.tool_use_id = id;
    }
  }
  return body;
}

module.exports = {adapters, buildObservation};
