import { join } from 'node:path';
import { Console, Effect, FileSystem } from 'effect';
import { isPreviewHost } from '../../apps/cloud/src/routes/previews/address.ts';
import { createSandboxCloud } from './cloud.ts';
import { respondDashboard, respondEnroll } from './dashboard.ts';
import { createPreviewHandoffs, createPreviewTeammateHandoff, respondSandboxSignIn } from './handoffs.ts';
import { prepareMachine, seedStudio, startMachine } from './machine.ts';
import { findRemoteStylesheet, listSandboxSections, respondStatic } from './page.ts';
import { upgradePreview } from './previews.ts';
import {
  seedProject,
  seedTeammateDuplicate,
  selectBusiestProject,
  shareProjectWithTeam,
} from './projects.ts';
import {
  ENROLL,
  HOST,
  LAPTOP_TASKS,
  LOCAL_WEB,
  MACHINE_APP,
  ORIGIN,
  PORT,
  PREVIEW_ZONE,
  REMOTE_WEB,
  ROOT,
  SANDBOX_DIR,
  SANDBOX_PATH,
  SandboxFailed,
  type SandboxPageModule,
  SHARE_CONNECT,
  TEAMMATE_TASKS,
  type TunnelData,
  USER,
} from './schema.ts';
import { createServicePreview, respondToggle } from './services.ts';
import { createPreviewShares, respondShareConnect } from './shares.ts';
import { teammateLink } from './team.ts';
import { seedTeammateWork } from './teammate-work.ts';
import { TUNNEL_SOCKET, upgradeTunnel } from './tunnel.ts';

export const startSandbox = Effect.fn('Sandbox.start')(function* () {
  const fs = yield* FileSystem.FileSystem;
  const built = yield* Effect.forEach([REMOTE_WEB, LOCAL_WEB], (dir) =>
    fs.exists(join(dir, 'index.html'))
  ).pipe(
    Effect.map((found) => found.every(Boolean)),
    Effect.mapError(
      (error) => new SandboxFailed({ message: `Checking the web build failed: ${error.message}` })
    )
  );
  if (!built)
    return yield* new SandboxFailed({
      message: 'Build the web app first: bun run --cwd apps/web build && bun run --cwd apps/web build:remote',
    });
  yield* fs
    .remove(SANDBOX_DIR, { recursive: true, force: true })
    .pipe(
      Effect.mapError(
        (error) => new SandboxFailed({ message: `Clearing ${SANDBOX_DIR} failed: ${error.message}` })
      )
    );
  const studioData = yield* seedStudio();
  const laptopData = yield* prepareMachine('laptop');
  const studio = yield* startMachine('studio', 'Studio', studioData);
  const laptop = yield* startMachine('laptop', 'Laptop', laptopData);
  yield* seedProject(laptop.engine, laptopData, { repo: 'website', project: 'Website', tasks: LAPTOP_TASKS });
  const teammateData = yield* prepareMachine('kai');
  const teammate = yield* startMachine('kai', 'Kai’s MacBook', teammateData);
  teammateLink.signingKey = yield* Effect.tryPromise({
    try: () => teammate.machine.remote.resolveSigningKey(),
    catch: (error) => new SandboxFailed({ message: `Reading Kai’s signing key failed: ${String(error)}` }),
  });
  const paywalls = yield* seedProject(teammate.engine, teammateData, {
    repo: 'paywalls',
    project: 'Paywalls',
    tasks: TEAMMATE_TASKS,
  });
  yield* shareProjectWithTeam(teammate.engine, paywalls.projectId ?? undefined);
  const studioProject = yield* selectBusiestProject(studio.engine);
  yield* shareProjectWithTeam(studio.engine, studioProject);
  const [teamTask] = Object.values((yield* teammate.engine.core.state).tasks);
  yield* seedTeammateWork(teammate, teammateData, teamTask);
  const keptOver = yield* seedTeammateDuplicate(studio.engine, studioProject, teamTask);
  const machines = [studio.machine, laptop.machine];
  const teammates = [...machines, teammate.machine];
  const shares = yield* createPreviewShares(studio);
  const teamTaskPath = teamTask ? `/tasks/${teamTask.handle}` : null;
  const { preview, shared } = yield* createServicePreview(studio);
  const { serializeSandboxPage }: SandboxPageModule = yield* Effect.tryPromise({
    try: () => import(join(ROOT, 'apps/web/src/components/sandbox/sandbox-page.tsx')),
    catch: (error) => new SandboxFailed({ message: `Loading the sandbox page failed: ${String(error)}` }),
  });
  const sections = listSandboxSections(machines, teammate.machine, shares, teamTaskPath, preview, {
    duplicate: keptOver.handle ?? keptOver.id,
    original: teamTask?.handle ?? null,
  });
  let page = serializeSandboxPage(sections, yield* findRemoteStylesheet());
  const cloud = yield* createSandboxCloud(SANDBOX_DIR, new URL(PREVIEW_ZONE).host, USER.id, teammates).pipe(
    Effect.mapError(
      (error) => new SandboxFailed({ message: `Starting the stand-in cloud failed: ${String(error)}` })
    )
  );

  const respond = Effect.fn('Sandbox.respond')(
    function* (request: Request, url: URL) {
      if (isPreviewHost(url.host, PREVIEW_ZONE)) return yield* Effect.promise(() => cloud.respond(request));
      if (url.pathname === SANDBOX_PATH)
        return new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      const toggled = respondToggle(shared, url);
      if (toggled) return yield* toggled;
      const share = SHARE_CONNECT.exec(url.pathname);
      if (share && request.method === 'POST') return respondShareConnect(share, machines);
      const signIn = respondSandboxSignIn(url, studio.engine);
      if (signIn) return yield* signIn;
      const app = MACHINE_APP.exec(url.pathname);
      const target = teammates.find((entry) => entry.id === app?.[1]);
      if (target)
        return Response.redirect(`http://${HOST}:${target.port}${app?.[2] ?? '/'}${url.search}`, 302);
      const enroll = ENROLL.exec(url.pathname);
      const enrolling = machines.find((entry) => entry.id === enroll?.[1]);
      if (enrolling) return yield* respondEnroll(enrolling, url);
      if (url.pathname.startsWith('/__remote/'))
        return yield* respondDashboard(request, url, machines, teammates);
      return yield* respondStatic(url.pathname);
    },
    Effect.catchTag('SandboxBodyInvalid', (error) =>
      Effect.succeed(
        Response.json({ error: { code: 'invalid_body', message: error.message } }, { status: 400 })
      )
    )
  );
  const run = Effect.runPromiseWith(yield* Effect.context<FileSystem.FileSystem>());

  yield* Effect.acquireRelease(
    Effect.try({
      try: () =>
        Bun.serve<TunnelData>({
          port: PORT,
          hostname: HOST,
          fetch(request, server) {
            const url = new URL(request.url);
            const socket = request.headers.get('upgrade')?.toLowerCase() === 'websocket';
            if (socket && isPreviewHost(url.host, PREVIEW_ZONE))
              return upgradePreview(request, url, teammates, server);
            const tunneled = upgradeTunnel(request, url, teammates, server);
            if (tunneled !== null) return tunneled;
            return run(respond(request, url));
          },
          websocket: TUNNEL_SOCKET,
        }),
      catch: (error) =>
        new SandboxFailed({ message: `Serving the sandbox on ${ORIGIN} failed: ${String(error)}` }),
    }),
    (server) => Effect.promise(() => server.stop(true))
  );
  const handoffs = yield* createPreviewHandoffs(studio);
  const handedToTeammate = yield* createPreviewTeammateHandoff(studio, studioProject);
  page = serializeSandboxPage(
    [
      ...sections,
      { title: 'Handing off a task', links: handoffs },
      { title: 'A task handed to a teammate', links: handedToTeammate },
    ],
    yield* findRemoteStylesheet()
  );
  yield* Console.log(`The sandbox: ${ORIGIN}${SANDBOX_PATH}`);
});
