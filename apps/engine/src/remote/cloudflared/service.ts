import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { Context, Effect, FileSystem, Layer } from 'effect';
import { HttpClient } from 'effect/http';
import { isPresent } from '../../files/probe.ts';
import { describeError } from '../../log/redact.ts';
import { Shell } from '../../shell/service.ts';
import { resolveCloudflaredPath } from './asset.ts';
import {
  type CloudflaredAsset,
  CloudflaredInstallFailed,
  CloudflaredTarget,
  CloudflaredUnsupported,
  DOWNLOAD_TIMEOUT,
  UNPACK_TIMEOUT,
  UNSUPPORTED_MESSAGE,
} from './schema.ts';

export class Cloudflared extends Context.Service<
  Cloudflared,
  { readonly install: Effect.Effect<string, CloudflaredUnsupported | CloudflaredInstallFailed> }
>()('shinsa/engine/remote/cloudflared/Cloudflared') {
  static readonly layer = Layer.effect(
    Cloudflared,
    Effect.gen(function* () {
      const target = yield* CloudflaredTarget;
      const http = yield* HttpClient.HttpClient;
      const shell = yield* Shell;
      const fs = yield* FileSystem.FileSystem;
      const withFiles = Effect.provideService(FileSystem.FileSystem, fs);
      const binDir = join(target.dataDir, 'bin');

      const failInstall = (message: string) => (error: unknown) =>
        new CloudflaredInstallFailed({ message: `${message}: ${describeError(error)}` });

      const download = Effect.fn('Cloudflared.download')(function* (asset: CloudflaredAsset) {
        const bytes = yield* Effect.gen(function* () {
          const response = yield* http.get(asset.url);
          if (response.status < 200 || response.status >= 300)
            return yield* new CloudflaredInstallFailed({
              message: `Could not download cloudflared (status ${response.status}).`,
            });
          return new Uint8Array(yield* response.arrayBuffer);
        }).pipe(
          Effect.timeout(DOWNLOAD_TIMEOUT),
          Effect.catchIf(
            (error) => error._tag !== 'CloudflaredInstallFailed',
            () => Effect.fail(new CloudflaredInstallFailed({ message: 'Could not download cloudflared.' }))
          )
        );
        const digest = createHash('sha256').update(bytes).digest('hex');
        if (digest !== asset.sha256)
          return yield* new CloudflaredInstallFailed({
            message: 'The cloudflared download did not match its pinned checksum.',
          });
        return bytes;
      });

      const unpack = Effect.fn('Cloudflared.unpack')(function* (archive: string, dir: string) {
        const result = yield* shell
          .run({ argv: ['tar', '-xzf', archive, '-C', dir], cwd: dir, timeout: UNPACK_TIMEOUT })
          .pipe(
            Effect.mapError(
              (error) =>
                new CloudflaredInstallFailed({ message: `Could not unpack cloudflared: ${error.message}` })
            )
          );
        if (!result.ok)
          return yield* new CloudflaredInstallFailed({
            message: `Could not unpack cloudflared: ${result.stderr}`,
          });
        const binary = join(dir, 'cloudflared');
        if (!(yield* withFiles(isPresent(binary))))
          return yield* new CloudflaredInstallFailed({
            message: 'The cloudflared download did not contain the program.',
          });
        return binary;
      });

      const install = Effect.fn('Cloudflared.install')(function* () {
        const { asset } = target;
        if (!asset) return yield* new CloudflaredUnsupported({ message: UNSUPPORTED_MESSAGE });
        const path = resolveCloudflaredPath(target.dataDir, asset);
        if (yield* withFiles(isPresent(path))) return path;
        const bytes = yield* download(asset);
        yield* fs
          .makeDirectory(binDir, { recursive: true })
          .pipe(Effect.mapError(failInstall('Could not prepare data/bin')));
        const staging = yield* fs
          .makeTempDirectoryScoped({ directory: binDir, prefix: '.cloudflared-' })
          .pipe(Effect.mapError(failInstall('Could not prepare data/bin')));
        const file = join(staging, 'download');
        yield* fs.writeFile(file, bytes).pipe(Effect.mapError(failInstall('Could not save cloudflared')));
        const binary = asset.archive ? yield* unpack(file, staging) : file;
        yield* fs
          .chmod(binary, 0o755)
          .pipe(
            Effect.andThen(fs.rename(binary, path)),
            Effect.mapError(failInstall('Could not install cloudflared'))
          );
        return path;
      }, Effect.scoped);

      return Cloudflared.of({ install: install() });
    })
  );
}
