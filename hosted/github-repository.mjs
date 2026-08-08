const API = 'https://api.github.com';

function assertSegment(value, label) {
  if (!/^[A-Za-z0-9_.-]+$/.test(value || '')) throw new Error(`${label} is not configured safely`);
}

export function createGitHubRepository({ owner, repository, branch = 'main', token, fetchImpl = fetch }) {
  assertSegment(owner, 'GitHub owner'); assertSegment(repository, 'GitHub repository'); assertSegment(branch, 'GitHub branch');
  if (!token) throw new Error('server-side GitHub credential is not configured');
  const base = `${API}/repos/${owner}/${repository}`;
  const request = async (path, options = {}) => {
    const response = await fetchImpl(`${base}${path}`, { ...options, headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', ...(options.body ? { 'Content-Type': 'application/json' } : {}) } });
    const result = await response.json();
    if (!response.ok) throw new Error(`GitHub ${response.status}: ${result.message || 'request failed'}`);
    return result;
  };
  const blob = async (content, encoding = 'utf-8') => (await request('/git/blobs', { method: 'POST', body: JSON.stringify({ content: encoding === 'base64' ? Buffer.from(content).toString('base64') : content, encoding }) })).sha;
  return {
    async snapshot() {
      const ref = await request(`/git/ref/heads/${encodeURIComponent(branch)}`);
      const commit = await request(`/git/commits/${ref.object.sha}`);
      const catalog = await request(`/contents/public/templates.json?ref=${encodeURIComponent(ref.object.sha)}`);
      return { revision: ref.object.sha, treeSha: commit.tree.sha, catalog: Buffer.from(catalog.content, 'base64') };
    },
    async read(path, revision) {
      const value = await request(`/contents/${path}?ref=${encodeURIComponent(revision)}`);
      return Buffer.from(value.content, 'base64');
    },
    async commit({ baseRevision, baseTree, message, actor, writes, deletes = [] }) {
      const tree = [];
      for (const [path, bytes] of Object.entries(writes)) tree.push({ path, mode: '100644', type: 'blob', sha: await blob(bytes, Buffer.isBuffer(bytes) ? 'base64' : 'utf-8') });
      for (const path of deletes) tree.push({ path, mode: '100644', type: 'blob', sha: null });
      const nextTree = await request('/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: baseTree, tree }) });
      const commit = await request('/git/commits', { method: 'POST', body: JSON.stringify({ message: `${message}\n\nPublished-by: ${actor.id} (${actor.displayName})`, tree: nextTree.sha, parents: [baseRevision] }) });
      await request(`/git/refs/heads/${encodeURIComponent(branch)}`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha, force: false }) });
      return { sha: commit.sha };
    }
  };
}
