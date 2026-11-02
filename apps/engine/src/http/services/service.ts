import { Context, Layer } from 'effect';
import type { HttpServicesShape } from '../schema.ts';

export class HttpServices extends Context.Service<HttpServices, HttpServicesShape>()(
  'shinsa/engine/http/HttpServices'
) {
  static layer(services: HttpServicesShape) {
    return Layer.succeed(HttpServices, services);
  }
}
