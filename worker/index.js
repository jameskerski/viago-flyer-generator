import { onRequest as studioApi } from '../functions/api/studio/[[path]].js';
import { onRequest as photoApi } from '../functions/api/photos/[[path]].js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/studio/')) return studioApi({ request, env, waitUntil: ctx.waitUntil.bind(ctx) });
    if (url.pathname.startsWith('/api/photos/')) return photoApi({ request, env, waitUntil: ctx.waitUntil.bind(ctx) });
    if (url.pathname === '/photos') return Response.redirect(`${url.origin}/photos/`, 302);
    return env.ASSETS.fetch(request);
  }
};
