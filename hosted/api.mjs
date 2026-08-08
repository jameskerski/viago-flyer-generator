const response = (status, body) => ({ status, body });

export function createHostedApi({ service, authenticate }) {
  return async function handle({ method, path, body, headers = {} }) {
    const actor = await authenticate(headers);
    if (!actor) return response(401, { error: 'sign in required' });
    if (actor.role !== 'TEMPLATE_ADMIN') return response(403, { error: 'TEMPLATE_ADMIN role required' });
    try {
      if (method === 'GET' && path === '/api/studio/session') return response(200, { actor: { id: actor.id, displayName: actor.displayName, role: actor.role } });
      if (method === 'GET' && path === '/api/studio/catalog') return response(200, await service.catalog());
      if (method === 'POST' && path === '/api/studio/publish') return response(200, await service.publish(body, actor));
      if (method === 'POST' && path === '/api/studio/retire') return response(200, await service.retire(body, actor));
      return response(404, { error: 'not found' });
    } catch (error) {
      const status = error.code === 'STALE_REVISION' ? 409 : 400;
      return response(status, { error: error.message, code: error.code, validation: error.validation });
    }
  };
}
