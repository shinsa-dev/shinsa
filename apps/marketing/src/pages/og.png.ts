import type { APIRoute } from 'astro';
import { renderOgImage } from '../lib/og';

export const GET: APIRoute = async () =>
  new Response(new Uint8Array(await renderOgImage()), { headers: { 'Content-Type': 'image/png' } });
