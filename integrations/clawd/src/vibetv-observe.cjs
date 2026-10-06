// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {buildObservation} = require('./hooks.cjs');

async function deliver(runtimeDir, body) {
  const endpoint = JSON.parse(fs.readFileSync(path.join(runtimeDir, 'endpoint.json'), 'utf8'));
  const url = new URL(endpoint.url);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !/^[a-f0-9]{64}$/.test(endpoint.token)) return;
  // Upstream-normalized payload stays local; only the metadata snapshot is exported.
  const data = JSON.stringify(body);
  if (Buffer.byteLength(data) > 16384) return;
  await new Promise(resolve => {
    const req = http.request(new URL('/state', url), {
      method: 'POST', timeout: 500,
      headers: {Authorization: 'Bearer ' + endpoint.token, 'Content-Type': 'application/json'},
    }, res => {res.resume(); res.once('end', resolve);});
    req.on('timeout', () => req.destroy());
    req.on('error', resolve);
    req.end(data);
  });
}

async function main() {
  const [runtimeDir, agentId, event] = process.argv.slice(2);
  if (!runtimeDir || !path.isAbsolute(runtimeDir) || !event) return;
  let input = Buffer.alloc(0);
  for await (const chunk of process.stdin) {
    if (input.length + chunk.length > 1048576) return;
    input = Buffer.concat([input, chunk]);
  }
  const body = buildObservation(agentId, event, JSON.parse(input.toString()));
  if (body) await deliver(runtimeDir, body);
}

if (require.main === module) {
  // Success, failure and timeout have exactly the same neutral output. Never
  // emit Gemini's explicit allow or any approval/answer supplied by Clawd.
  console.log = console.warn = console.error = () => {};
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    process.stdout.write('{}\n', () => process.exit(0));
  };
  setTimeout(finish, 2000);
  main().then(finish, finish);
}
module.exports = {deliver};
