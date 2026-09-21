// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {readJsonFile, writeJsonAtomic, removeMatchingCommandHooks, decodeWindowsEncodedCommand, formatNodeHookCommand} = require('../upstream/hooks/json-utils');
const claude = require('../upstream/hooks/install');
const copilot = require('../upstream/hooks/copilot-install');

// Event lists stay upstream-owned. Only observation installation differs:
// no permission responder, status line, autostart or account configuration.
const profiles = {
  'claude-code': {module: claude, file: () => claude.resolveClaudeSettingsPath()},
  'antigravity-cli': {module: require('../upstream/hooks/antigravity-install'), group: true},
  'gemini-cli': {module: require('../upstream/hooks/gemini-install'), events: 'GEMINI_HOOK_EVENTS'},
  'qwen-code': {module: require('../upstream/hooks/qwen-code-install'), events: 'QWEN_CODE_HOOK_EVENTS'},
  qoder: {module: require('../upstream/hooks/qoder-install'), events: 'QODER_HOOK_EVENTS', bash: true},
  qoderwork: {module: require('../upstream/hooks/qoderwork-install'), events: 'QODERWORK_HOOK_EVENTS', bash: true},
  qwenwork: {module: require('../upstream/hooks/qwenwork-install'), events: 'QWENWORK_HOOK_EVENTS', bash: true},
  'copilot-cli': {module: copilot, events: 'COPILOT_HOOK_EVENTS', flat: true, file: () => copilot.resolveCopilotHooksPath()},
};
const marker = 'vibetv-observe.cjs';
const owned = command => typeof command === 'string' && (command.includes(marker) || (decodeWindowsEncodedCommand(command) || '').includes(marker));
const posix = value => "'" + String(value).replaceAll("'", "'\\''") + "'";

function readSettings(file) {
  try {
    if (fs.statSync(file).size > 1048576) throw Error('agent-settings-too-large');
    const settings = readJsonFile(file);
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw Error('invalid-agent-settings');
    if (settings.hooks != null && (typeof settings.hooks !== 'object' || Array.isArray(settings.hooks))) throw Error('invalid-agent-hooks');
    return settings;
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}
function fileFor(profile) { return profile.file ? profile.file() : profile.module.DEFAULT_CONFIG_PATH; }
function cleanEntries(entries, flat) {
  if (!Array.isArray(entries)) throw Error('invalid-agent-hook-event');
  return flat ? entries.filter(entry => !owned(entry?.bash) && !owned(entry?.powershell)) : removeMatchingCommandHooks(entries, owned).entries;
}
function hasOwned(settings, profile) {
  const events = profile.group ? settings.vibetv : settings.hooks;
  return Object.values(events || {}).some(entries => Array.isArray(entries) && JSON.stringify(cleanEntries(entries, profile.flat)) !== JSON.stringify(entries));
}
function blocked(settings) {
  return settings.disableAllHooks === true || settings.hooks?.enabled === false || settings.vibetv?.enabled === false;
}
function connection(agentId) {
  if (agentId === 'codex') return 'automatic';
  const profile = profiles[agentId];
  if (!profile) return 'unsupported';
  try {
    const settings = readSettings(fileFor(profile));
    if (blocked(settings)) return 'blocked';
    return hasOwned(settings, profile) ? 'connected' : 'disconnected';
  } catch { return 'blocked'; }
}

function eventsFor(agentId, {claudeVersionInfo} = {}) {
  const profile = profiles[agentId];
  if (profile.group) return profile.module.ANTIGRAVITY_HOOK_EVENTS;
  if (agentId !== 'claude-code') return profile.module[profile.events];
  // Let the original installer choose version-compatible events, but only in
  // an empty temporary fixture. Never run its permission installer on a user.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibetv-hook-schema-'));
  try {
    const settingsPath = path.join(dir, 'settings.json');
    claude.registerHooks({settingsPath, nodeBin: process.execPath, silent: true, autoStart: false, claudeVersionInfo});
    return Object.keys(readSettings(settingsPath).hooks);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
}

function entryFor(agentId, event, {runtimeDir, directory, platform = process.platform}) {
  const profile = profiles[agentId];
  const node = path.join(directory, platform === 'win32' ? 'node.exe' : 'node');
  const script = path.join(directory, 'src', marker);
  const args = [runtimeDir, agentId, event];
  const bash = [node, script, ...args].map(value => posix(platform === 'win32' ? value.replaceAll('\\', '/') : value)).join(' ');
  // Reuse upstream's encoded PowerShell quoting for spaces, quotes and $ in
  // installed paths. Git Bash clients require POSIX quoting, not PATH's node.
  const powershell = formatNodeHookCommand(node, script, {platform: 'win32', windowsWrapper: 'encoded', args});
  if (profile.flat) return {type: 'command', bash, powershell, timeoutSec: 5};
  const hook = {type: 'command', command: platform === 'win32' && !profile.bash ? powershell : bash, timeout: 5};
  if (agentId === 'claude-code' && platform === 'win32') hook.shell = 'powershell';
  if (agentId === 'qwen-code') hook.timeout = 5000; // Qwen's schema uses milliseconds.
  const entry = {hooks: [hook]};
  if (agentId !== 'qwen-code' || !['UserPromptSubmit', 'Stop'].includes(event)) entry.matcher = agentId === 'claude-code' ? '' : '*';
  return entry;
}

function prepare(agentId, enabled, options) {
  const profile = profiles[agentId];
  if (!profile || typeof enabled !== 'boolean') throw Error('unsupported-integration');
  const requestedPath = options.settingsPath || fileFor(profile);
  let file = requestedPath;
  try { file = fs.realpathSync(file); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    try { if (fs.lstatSync(file).isSymbolicLink()) throw Error('broken-agent-settings-link'); }
    catch (linkError) { if (linkError.code !== 'ENOENT') throw linkError; }
  }
  const originalBytes = fs.existsSync(file) ? fs.readFileSync(file) : null;
  const settings = readSettings(file);
  if (enabled && blocked(settings)) throw Error('agent-hooks-disabled');
  const before = JSON.stringify(settings);
  if (profile.group) {
    const existing = settings.vibetv;
    if (existing != null && (!existing || typeof existing !== 'object' || Array.isArray(existing))) throw Error('invalid-agent-hooks');
    const group = existing || {};
    for (const [event, entries] of Object.entries(group)) {
      if (!Array.isArray(entries)) continue;
      const cleaned = cleanEntries(entries, false);
      if (cleaned.length) group[event] = cleaned;
      else if (cleaned.length !== entries.length) delete group[event];
    }
    if (enabled) {
      const desired = profile.module.__test.buildAntigravityHooks(event => entryFor(agentId, event, options).hooks[0].command).clawd;
      for (const [event, entries] of Object.entries(desired)) {
        if (group[event] != null && !Array.isArray(group[event])) throw Error('invalid-agent-hook-event');
        group[event] = [...(group[event] || []), ...entries];
      }
    }
    if (Object.keys(group).length) settings.vibetv = group;
    else delete settings.vibetv;
  } else {
  if (!settings.hooks) settings.hooks = {};
  for (const [event, entries] of Object.entries(settings.hooks)) {
    // Keep upstream's metadata keys (Gemini enabled/disabled) untouched.
    if (!Array.isArray(entries)) continue;
    const cleaned = cleanEntries(entries, profile.flat);
    if (cleaned.length) settings.hooks[event] = cleaned;
    else if (cleaned.length !== entries.length) delete settings.hooks[event];
  }
  if (enabled) {
    if (profile.flat) {
      if (settings.version != null && settings.version !== 1) throw Error('unsupported-hook-schema');
      settings.version = 1;
    }
    for (const event of eventsFor(agentId, options)) {
      const entries = settings.hooks[event] || [];
      if (!Array.isArray(entries)) throw Error('invalid-agent-hook-event');
      settings.hooks[event] = [...entries, entryFor(agentId, event, options)];
    }
  }
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
  }
  if (JSON.stringify(settings) === before) return;
  let writtenBytes;
  return {
    commit() {
      // Version detection can invoke a CLI. Refuse stale edits.
      const current = fs.existsSync(file) ? fs.readFileSync(file) : null;
      if ((originalBytes === null) !== (current === null) || originalBytes && !originalBytes.equals(current)) throw Error('agent-settings-changed');
      if (originalBytes) {
        try { fs.copyFileSync(file, file + '.vibetv-backup', fs.constants.COPYFILE_EXCL); fs.chmodSync(file + '.vibetv-backup', 0o600); }
        catch (error) { if (error.code !== 'EEXIST') throw error; }
      }
      writeJsonAtomic(file, settings);
      writtenBytes = fs.readFileSync(file);
      fs.chmodSync(file, 0o600);
    },
    rollback() {
      // Never overwrite another process's edit while undoing a failed batch.
      if (!writtenBytes) return;
      if (!fs.readFileSync(file).equals(writtenBytes)) throw Error('agent-settings-changed');
      if (originalBytes === null) fs.unlinkSync(file);
      else fs.writeFileSync(file, originalBytes, {mode: 0o600});
    },
  };
}

function configure(agentId, enabled, options) {
  prepare(agentId, enabled, options)?.commit();
}

function configureAll(enabled, options) {
  if (typeof enabled !== 'boolean') throw Error('invalid-agent-activity');
  // Validate every client's native settings before changing any of them.
  const plans = Object.keys(profiles).map(id => prepare(id, enabled, options)).filter(Boolean);
  const attempted = [];
  try {
    for (const plan of plans) { attempted.push(plan); plan.commit(); }
  } catch (error) {
    const errors = [error];
    for (const plan of attempted.reverse()) {
      try { plan.rollback(); } catch (rollbackError) { errors.push(rollbackError); }
    }
    throw new AggregateError(errors, 'agent-activity-could-not-be-saved');
  }
}

// The app updater replaces the containing bundle. Refresh only integrations
// the user previously enabled; never turn on another client during startup.
function refreshConfigured(options) {
  for (const agentId of Object.keys(profiles)) {
    if (connection(agentId) !== 'connected') continue;
    try { configure(agentId, true, options); } catch { /* Preserve user settings on conflict. */ }
  }
}

module.exports = {profiles, connection, configure, configureAll, entryFor, eventsFor, refreshConfigured};
