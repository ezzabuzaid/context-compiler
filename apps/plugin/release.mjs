// Publishes dist/plugin-marketplace, which `marketplace` builds, to the
// release branch that Codex installs the plugin from (`--ref release`). Codex
// copies the plugin folder from a git ref and runs it as it is, so the branch
// holds the bundled server, which main does not.
// It writes the commit through GitHub's Git Database API with the gh CLI's
// token: no checkout of the branch and no git command runs here. A build whose
// files match the branch's tree publishes nothing.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const repository = 'ezzabuzaid/context-compiler';
const branch = 'release';
const folder = 'dist/plugin-marketplace';

const token = execFileSync('gh', ['auth', 'token'], {
  encoding: 'utf8',
}).trim();

async function github(method, path, body) {
  const response = await fetch(
    `https://api.github.com/repos/${repository}${path}`,
    {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );
  if (method === 'GET' && response.status === 404) return undefined;
  if (!response.ok)
    throw new Error(
      `GitHub ${method} ${path}: ${response.status} ${await response.text()}`,
    );
  return response.json();
}

// The blob id git gives these bytes, so an unchanged file is never uploaded.
const blobId = (content) =>
  createHash('sha1')
    .update(`blob ${content.length}\0`)
    .update(content)
    .digest('hex');

function files(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    const stats = lstatSync(path);
    if (stats.isDirectory()) return files(path);
    if (!stats.isFile())
      throw new Error(`${path} is neither a file nor a folder`);
    const content = readFileSync(path);
    return [
      {
        path: relative(folder, path).split(sep).join('/'),
        mode: stats.mode & 0o111 ? '100755' : '100644',
        sha: blobId(content),
        content,
      },
    ];
  });
}

const build = files(folder);
const { version } = JSON.parse(
  readFileSync(
    join(folder, 'plugins/context-compiler/.codex-plugin/plugin.json'),
    'utf8',
  ),
);

const head = await github('GET', `/git/ref/heads/${branch}`);
const published = new Map();
if (head !== undefined) {
  const commit = await github('GET', `/git/commits/${head.object.sha}`);
  const tree = await github('GET', `/git/trees/${commit.tree.sha}?recursive=1`);
  if (tree.truncated)
    throw new Error(`The ${branch} tree is too large to list in one answer`);
  for (const entry of tree.tree)
    if (entry.type === 'blob') published.set(entry.path, entry);
}

const unchanged =
  published.size === build.length &&
  build.every(({ path, mode, sha }) => {
    const entry = published.get(path);
    return entry?.sha === sha && entry?.mode === mode;
  });
if (unchanged) {
  console.log(`${branch} already holds this build (plugin ${version}).`);
} else {
  const stored = new Set([...published.values()].map(({ sha }) => sha));
  for (const file of build.filter(({ sha }) => !stored.has(sha))) {
    const blob = await github('POST', '/git/blobs', {
      content: file.content.toString('base64'),
      encoding: 'base64',
    });
    if (blob.sha !== file.sha)
      throw new Error(
        `GitHub stored ${file.path} as ${blob.sha}, not ${file.sha}`,
      );
    stored.add(blob.sha);
  }
  // A full tree, not one based on the previous: a file the build no longer
  // has leaves the branch.
  const tree = await github('POST', '/git/trees', {
    tree: build.map(({ path, mode, sha }) => ({
      path,
      mode,
      type: 'blob',
      sha,
    })),
  });
  const commit = await github('POST', '/git/commits', {
    message: `plugin ${version}`,
    tree: tree.sha,
    parents: head === undefined ? [] : [head.object.sha],
  });
  if (head === undefined)
    await github('POST', '/git/refs', {
      ref: `refs/heads/${branch}`,
      sha: commit.sha,
    });
  else
    await github('PATCH', `/git/refs/heads/${branch}`, {
      sha: commit.sha,
      force: false,
    });
  console.log(`Published plugin ${version} to ${branch} as ${commit.sha}.`);
}
