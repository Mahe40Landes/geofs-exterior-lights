// Push the add-on to GitHub with the REST API (no git binary needed on Windows).
// Usage: node push.mjs <path-to-folder>
// Needs GH_TOKEN in the environment (scopes: repo).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, posix } from 'node:path';

const OWNER = 'Mahe40Landes';
const REPO = 'geofs-exterior-lights';
const BRANCH = 'main';
const dir = process.argv[2] || '.';
const token = process.env.GH_TOKEN;
if (!token) { console.error('GH_TOKEN missing'); process.exit(1); }

const API = 'https://api.github.com';
const headers = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'geofs-lights-build'
};
const SKIP = new Set(['node_modules', 'test', '.git']);

function walk(root, base = root, out = []) {
  for (const name of readdirSync(root)) {
    if (SKIP.has(name)) continue;
    const p = join(root, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, base, out);
    else out.push(posix.join(...relative(base, p).split('\\')));
  }
  return out;
}

async function api(path, init = {}) {
  const res = await fetch(API + path, { ...init, headers: { ...headers, ...(init.headers || {}) } });
  const text = await res.text();
  let body; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  return body;
}

const files = walk(dir);
console.log('uploading', files.length, 'files:', files.join(', '));

// 1. create blobs
const tree = [];
for (const f of files) {
  const content = readFileSync(join(dir, ...f.split('/'))).toString('base64');
  const blob = await api(`/repos/${OWNER}/${REPO}/git/blobs`, {
    method: 'POST',
    body: JSON.stringify({ content, encoding: 'base64' })
  });
  tree.push({ path: f, mode: '100644', type: 'blob', sha: blob.sha });
}

// 2. tree
const newTree = await api(`/repos/${OWNER}/${REPO}/git/trees`, {
  method: 'POST',
  body: JSON.stringify({ tree })
});

// 3. parent commit (empty repo -> none)
let parents = [];
try {
  const ref = await api(`/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`);
  parents = [ref.object.sha];
} catch { /* first commit */ }

// 4. commit
const commit = await api(`/repos/${OWNER}/${REPO}/git/commits`, {
  method: 'POST',
  body: JSON.stringify({
    message: 'GeoFS Exterior Lights v1.0.0 — nav, beacon, strobe, landing, taxi, turnoff, ice, logo, exit lights',
    tree: newTree.sha,
    parents
  })
});

// 5. ref
if (parents.length) {
  await api(`/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: commit.sha, force: false })
  });
} else {
  await api(`/repos/${OWNER}/${REPO}/git/refs`, {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/heads/${BRANCH}`, sha: commit.sha })
  });
}

console.log('pushed commit', commit.sha);
console.log(`https://github.com/${OWNER}/${REPO}`);
