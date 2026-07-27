'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = __dirname;
const DESTINATION = path.join(ROOT, 'runtime');

function config() {
  const url = String(process.env.SERVICE_URL || '').trim();
  const key = String(process.env.SERVICE_KEY || '').trim();
  if (!/^https:\/\//.test(url) || key.length < 20) throw new Error('Private service configuration is incomplete.');
  return { url, key };
}

function destinationFor(relativePath) {
  const normalized = String(relativePath || '').replace(/\\/g, '/');
  if (!/^[A-Za-z0-9._/-]+$/.test(normalized) || normalized.split('/').includes('..')) {
    throw new Error('Private package contained an invalid path.');
  }
  const destination = path.resolve(DESTINATION, ...normalized.split('/'));
  if (!destination.startsWith(`${path.resolve(DESTINATION)}${path.sep}`)) throw new Error('Private package path escaped its destination.');
  return destination;
}

async function main() {
  const { url, key } = config();
  const response = await fetch(url, {
    method: 'POST',
    redirect: 'follow',
    signal: AbortSignal.timeout(60000),
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ action: 'runtime.pull', secret: key })
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error('Private package could not be retrieved.');
  const compressed = Buffer.from(result.runtimeBase64, 'base64');
  const checksum = crypto.createHash('sha256').update(compressed).digest('hex');
  if (checksum !== result.sha256) throw new Error('Private package checksum did not match.');
  unpackRuntime(compressed);
  console.log('Private package ready.');
}

function unpackRuntime(compressed) {
  const bundle = JSON.parse(zlib.gunzipSync(compressed).toString('utf8'));
  if (bundle.runtimeFormatVersion !== 1 || !Array.isArray(bundle.files)) throw new Error('Private package format was not supported.');
  for (const file of bundle.files) {
    const destination = destinationFor(file.path);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, Buffer.from(file.contentBase64, 'base64'));
  }
  return bundle.files.length;
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { destinationFor, unpackRuntime };
