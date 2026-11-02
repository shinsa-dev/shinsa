import { Context, Schema } from 'effect';
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware, HttpApiSecurity } from 'effect/http-api';
import { Machine, MachineAlreadyPaired, MachineId, MachineNotFound, PairRequest } from './domain.ts';

export class CurrentAccount extends Context.Service<CurrentAccount, { readonly login: string }>()(
  'shinsa/guide/CurrentAccount'
) {}

export class Unauthorized extends Schema.TaggedError<Unauthorized, { readonly brand: unique symbol }>()(
  'Unauthorized',
  { message: Schema.String },
  { httpApiStatus: 401 }
) {}

export class Session extends HttpApiMiddleware.Service<
  Session,
  { provides: CurrentAccount; requires: never }
>()('shinsa/guide/Session', {
  requiredForClient: true,
  security: { bearer: HttpApiSecurity.bearer },
  error: Unauthorized,
}) {}

class MachinesGroup extends HttpApiGroup.make('machines')
  .add(
    HttpApiEndpoint.get('list', '/', { success: Schema.Array(Machine) }),
    HttpApiEndpoint.get('find', '/:id', {
      params: { id: MachineId },
      success: Machine,
      error: MachineNotFound,
    }),
    HttpApiEndpoint.post('pair', '/', {
      payload: PairRequest,
      success: Machine,
      error: MachineAlreadyPaired,
    })
  )
  .middleware(Session)
  .prefix('/machines') {}

export class GuideApi extends HttpApi.make('guide').add(MachinesGroup) {}
