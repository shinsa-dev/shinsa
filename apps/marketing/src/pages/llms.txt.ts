import type { APIRoute } from 'astro';
import { serializeLlms } from '../lib/llms';

export const GET: APIRoute = () =>
  new Response(serializeLlms(), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
