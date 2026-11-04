import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { isPreviewHost } from '../../apps/cloud/src/routes/previews/address.ts';
import { createSandboxCloud } from './cloud.ts';
import { respondDashboard, respondEnroll } from './dashboard.ts';
import { createPreviewHandoffs, respondSandboxSignIn } from './handoffs.ts';
import { prepareMachine, seedStudio, startMachine } from './machine.ts';
import { findRemoteStylesheet, listSandboxSections, respondStatic } from './page.ts';
import { respondPreviewHost } from './previews.ts';
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
  ORIGIN,
  PORT,
  PREVIEW_ZONE,
  REMOTE_WEB,
  ROOT,
  SANDBOX_DIR,
  SANDBOX_PATH,
  type SandboxPageModule,
  SHARE_CONNECT,
  TEAMMATE_TASKS,
  type TunnelData,
  USER,
} from './schema.ts';
import { createServicePreview, respondToggle } from './services.ts';
import { createPreviewShares, respondShareConnect } from './shares.ts';
import { TEAM, teammateLink } from './team.ts';
import { TUNNEL_SOCKET, upgradeTunnel } from './tunnel.ts';

export async function startSandbox() {
  if (!existsSync(join(REMOTE_WEB, 'index.html')) || !existsSync(join(LOCAL_WEB, 'index.html')))
    throw new Error(
      'Build the web app first: bun run --cwd apps/web build && bun run --cwd apps/web build:remote'
    );
  rmSync(SANDBOX_DIR, { recursive: true, force: true });
  const studioData = seedStudio();
  const laptopData = prepareMachine('laptop');
  const studio = await startMachine('studio', 'Studio', studioData);
  const laptop = await startMachine('laptop', 'Laptop', laptopData);
  await seedProject(laptop.engine, laptopData, { repo: 'website', project: 'Website', tasks: LAPTOP_TASKS });
  const teammateData = prepareMachine('kai');
  const teammate = await startMachine('kai', 'Kai’s MacBook', teammateData);
  teammateLink.signingKey = await teammate.machine.remote.resolveSigningKey();
  const paywalls = await seedProject(teammate.engine, teammateData, {
    repo: 'paywalls',
    project: 'Paywalls',
    tasks: TEAMMATE_TASKS,
  });
  await shareProjectWithTeam(teammate.engine, paywalls.projectId ?? undefined);
  const studioProject = selectBusiestProject(studio.engine);
  await shareProjectWithTeam(studio.engine, studioProject);
  const [teamTask] = Object.values(teammate.engine.state.tasks);
  const keptOver = await seedTeammateDuplicate(studio.engine, studioProject, teamTask);
  const machines = [studio.machine, laptop.machine];
  const teammates = [...machines, teammate.machine];
  const shares = await createPreviewShares(studio);
  const teamTaskPath = teamTask ? `/teams/${TEAM.id}/kai/${teamTask.id}` : null;
  const { preview, shared } = await createServicePreview(studio);
  const { serializeSandboxPage }: SandboxPageModule = await import(
    join(ROOT, 'apps/web/src/components/sandbox/sandbox-page.tsx')
  );
  const sections = listSandboxSections(machines, teammate.machine, shares, teamTaskPath, preview, {
    duplicate: keptOver.handle ?? keptOver.id,
    original: teamTask?.handle ?? null,
  });
  let page = serializeSandboxPage(sections, findRemoteStylesheet());
  const cloud = createSandboxCloud(SANDBOX_DIR, new URL(PREVIEW_ZONE).host, USER.id, machines);
  Bun.serve<TunnelData>({
    port: PORT,
    hostname: HOST,
    fetch(request, server) {
      const url = new URL(request.url);
      if (isPreviewHost(url.host, PREVIEW_ZONE))
        return respondPreviewHost(request, url, machines, cloud, server);
      if (url.pathname === SANDBOX_PATH)
        return new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      const toggled = respondToggle(shared, url);
      if (toggled) return toggled;
      const share = SHARE_CONNECT.exec(url.pathname);
      if (share && request.method === 'POST') return respondShareConnect(share, machines);
      const signIn = respondSandboxSignIn(url, studio.engine);
      if (signIn) return signIn;
      const enroll = ENROLL.exec(url.pathname);
      const enrolling = machines.find((entry) => entry.id === enroll?.[1]);
      if (enrolling) return respondEnroll(enrolling, url);
      const tunneled = upgradeTunnel(request, url, teammates, server);
      if (tunneled !== null) return tunneled;
      if (url.pathname.startsWith('/__remote/')) return respondDashboard(request, url, machines, teammates);
      return respondStatic(url.pathname);
    },
    websocket: TUNNEL_SOCKET,
  });
  const handoffs = await createPreviewHandoffs(studio);
  page = serializeSandboxPage(
    [...sections, { title: 'Handing off a task', links: handoffs }],
    findRemoteStylesheet()
  );
  console.info(`The sandbox: ${ORIGIN}${SANDBOX_PATH}`);
}
