import type { APIRoute } from 'astro';
import { Effect } from 'effect';
import { renderOgImage } from '../lib/og';

const program = Effect.map(
  Effect.promise(() => renderOgImage()),
  (png) => new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } })
);

export const GET: APIRoute = () => Effect.runPromise(program);
