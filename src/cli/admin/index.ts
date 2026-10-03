import { mkdir, writeFile, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { stringify } from 'yaml';
import { configPath, loadConfig, loadProjectInference, configSchema, providerSchema } from '../../config/index.ts';
import { builtins, types } from '../../catalog/index.ts';
import { definitions, resolveInvocation } from '../../definitions/index.ts';
import { inspectRoute } from '../../routing/index.ts';
import { routeFor } from '../../engine/runtime/index.ts';
import { RibbitError } from '../../engine/records/index.ts';
import { OllamaAdapter } from '../../providers/ollama/index.ts';
import { CompatibleAdapter } from '../../providers/openai-compatible/index.ts';
import { listInstalled, removeInstalled } from '../../extensions/install/index.ts';
import { RUNTIME_FLAGS } from '../../sdk/manifest/index.ts';
import { ADMIN, MANAGEMENT, managementBooleans } from './contract.ts';
import { scalarTypes } from '../parser/index.ts';

export function options(tokens: string[], allowed: string[]) {
  // Management handlers validate heterogeneous flag values against their own schemas.
  const flags: Record<string, any> = {},
    positionals: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (token.startsWith('--')) {
      const eq = token.indexOf('='),
        name = token.slice(2, eq < 0 ? undefined : eq);

      if (!allowed.includes(name) && name !== 'json' && name !== 'error-format')
        throw new RibbitError(2, `Unknown management flag --${name}`);
      if (name in flags) throw new RibbitError(2, `Duplicate management flag --${name}`);
      if (managementBooleans.has(name)) {
        const value = eq < 0 ? undefined : token.slice(eq + 1);

        if (value !== undefined && !['true', 'false'].includes(value))
          throw new RibbitError(2, `--${name} expects true or false`);
        flags[name] = value !== 'false';
      } else {
        const value = eq < 0 ? tokens[++i] : token.slice(eq + 1);

        if (value === undefined) throw new RibbitError(2, `--${name} requires a value`);
        flags[name] = value;
      }
    } else positionals.push(token);
  }

  return { flags, positionals };
}

async function saveConfig(value: unknown) {
  const config = configSchema.parse(value),
    path = configPath();

  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = path + '.' + crypto.randomUUID() + '.tmp';

  await writeFile(temp, stringify(config), { mode: 0o600, flag: 'wx' });
  await rename(temp, path);

  return config;
}

export function respond(value: unknown, json: boolean) {
  console.log(
    json
      ? JSON.stringify({ schemaVersion: 1, ...(value as object) })
      : typeof value === 'string'
        ? value
        : JSON.stringify(value, null, 2),
  );
}

export async function admin(command: string, tokens: string[]): Promise<void> {
  const operations = MANAGEMENT[command];
  const { flags: f, positionals: p } = options(
    tokens,
    Object.values(operations).flatMap((op) => op.flags),
  );
  const contract = operations[p[0] ?? (operations[''] ? '' : 'list')];

  if (!contract) throw new RibbitError(2, `Use ribbit ${command} --help`);
  for (const flag of Object.keys(f))
    if (!['json', 'error-format'].includes(flag) && !contract.flags.includes(flag))
      throw new RibbitError(2, `Unknown management flag --${flag} for this operation`);

  if (f['error-format'] && !['json', 'text'].includes(f['error-format']))
    throw new RibbitError(2, 'Unknown error format');
  const operation = p[0] ?? 'list',
    name = p[1],
    json = !!f.json;
  const result = (value: unknown) => respond(value, json);

  if (command === 'completions') {
    if (!['bash', 'zsh', 'fish'].includes(operation)) throw new RibbitError(2, 'Choose bash, zsh or fish');
    const named = (await definitions()).flatMap((d) => [d.value.name, `${d.scope}:${d.value.name}`]);
    const names = [...new Set([...Object.keys(builtins), ...named, ...ADMIN, 'run', 'flow'])].join(' ');
    const flags = [
      ...new Set([
        ...[...RUNTIME_FLAGS].map((flag) => '--' + flag),
        '--json',
        '--error-format',
        ...Object.values(MANAGEMENT).flatMap((entries) =>
          Object.values(entries).flatMap((op) => op.flags.map((flag) => '--' + flag)),
        ),
        ...(await types()).flatMap((m) =>
          Object.values(m.actions).flatMap((a) =>
            a.bindings.filter((b) => scalarTypes.has(b.type)).map((b) => '--' + b.flag),
          ),
        ),
      ]),
    ].join(' ');

    if (operation === 'bash')
      console.log(
        `_ribbit_complete() { COMPREPLY=( $(compgen -W '${names} ${flags}' -- "\${COMP_WORDS[COMP_CWORD]}") ); }\ncomplete -F _ribbit_complete ribbit`,
      );
    if (operation === 'zsh') console.log(`#compdef ribbit\n_arguments '*:argument:(${names} ${flags})'`);
    if (operation === 'fish') console.log(`complete -c ribbit -f -a '${names} ${flags}'`);

    return;
  }
  if (command === 'types' || command === 'commands') {
    if (operation === 'list') {
      result(
        command === 'types'
          ? { types: await types() }
          : { commands: [...Object.keys(builtins), ...(await definitions()).map((d) => `${d.scope}:${d.value.name}`)] },
      );

      return;
    }
    if (!name) throw new RibbitError(2, 'A name is required');
    if (command === 'types') {
      if (operation !== 'describe') throw new RibbitError(2, 'Use types list or describe');
      const type = (await types()).find((t) => t.type === name);

      if (!type) throw new RibbitError(2, 'Unknown type; use a scoped ID such as @ribbit/take or run types list');
      result({ type });

      return;
    }
    if (!['describe', 'validate'].includes(operation)) throw new RibbitError(2, 'Use list, describe or validate');
    const invocation = await resolveInvocation(name);

    result({
      name,
      valid: true,
      type: invocation.manifest,
      action: invocation.action,
      defaults: invocation.args,
      config: invocation.config,
    });

    return;
  }
  if (command === 'extensions') {
    if (operation === 'list') {
      result({ extensions: await listInstalled() });

      return;
    }
    if (!name) throw new RibbitError(2, 'An extension path or type is required');
    if (operation === 'remove') {
      await removeInstalled(name);
      result({ removed: name });

      return;
    }
    if (operation === 'scaffold') {
      const { scaffold } = await import('../../scaffold/index.ts');

      result(await scaffold(name, f.type));

      return;
    }
    if (operation === 'test') {
      const { testExtension } = await import('../../scaffold/index.ts');
      const report = await testExtension(name);

      result(report);
      if (report.failed) process.exitCode = 5;

      return;
    }
    const builder = await import('../../extensions/build/index.ts');

    if (operation === 'check') {
      result({ manifest: (await builder.checkExtension(name)).manifest });

      return;
    }
    if (operation === 'add') {
      result({ installed: await builder.addExtension(name) });

      return;
    }
    throw new RibbitError(2, 'Unknown extensions operation');
  }
  if (command === 'init') {
    const path = join(process.cwd(), '.ribbit.yaml');

    try {
      await writeFile(path, 'apiVersion: ribbit/v1\ninference: {}\n', { flag: 'wx' });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
    if (f.agent) {
      const { initGuidance } = await import('../../scaffold/index.ts');

      await initGuidance(f.agent);
    }
    result({ initialized: path, agent: f.agent ?? null });

    return;
  }
  const config = await loadConfig();

  if (command === 'providers') {
    if (operation === 'list') {
      result({ providers: config.providers });

      return;
    }
    if (!name || !/^[a-z][a-z0-9-]*$/.test(name))
      throw new RibbitError(2, 'Provider name must be a lowercase identifier');
    if (operation === 'add') {
      if (config.providers[name]) throw new RibbitError(3, 'Provider already exists');
      const provider = providerSchema.safeParse({
        type: f.type,
        baseUrl: f['base-url'],
        defaultModel: f['default-model'],
        apiKeyEnv: f['api-key-env'],
        capabilities: f.capabilities?.split(','),
      });

      if (!provider.success) throw new RibbitError(2, 'Invalid provider fields; specify --type and --base-url');
      config.providers[name] = provider.data;
    } else if (operation === 'remove') {
      if (!config.providers[name]) throw new RibbitError(3, 'Unknown provider');
      if (
        Object.values(config.profiles).some((profile) => profile.provider === name) ||
        config.default.provider === name ||
        Object.values(config.routes).some((r) => r.provider === name)
      )
        throw new RibbitError(3, 'Provider is still referenced');
      delete config.providers[name];
    } else throw new RibbitError(2, 'Use providers list, add or remove');
    await saveConfig(config);
    result({ provider: name, operation });

    return;
  }
  if (command === 'profiles') {
    if (operation === 'list') {
      result({ profiles: config.profiles });

      return;
    }
    if (!name || !/^[a-z][a-z0-9-]*$/.test(name)) throw new RibbitError(2, 'Profile name required');
    if (operation === 'show') {
      if (!config.profiles[name]) throw new RibbitError(3, 'Unknown profile');
      result({ name, profile: config.profiles[name] });

      return;
    }
    if (operation === 'set') {
      const value = {
        provider: f.provider,
        model: f.model,
        ...(f.temperature === undefined ? {} : { temperature: Number(f.temperature) }),
        ...(f['max-output-tokens'] === undefined ? {} : { maxOutputTokens: Number(f['max-output-tokens']) }),
        ...(f.timeout === undefined ? {} : { timeout: Number(f.timeout) }),
      };

      if (!value.provider || !value.model || !config.providers[value.provider])
        throw new RibbitError(3, 'Profile requires a configured provider and explicit model');
      config.profiles[name] = value;
    } else if (operation === 'remove') {
      if (config.default.profile === name || Object.values(config.routes).some((r) => r.profile === name))
        throw new RibbitError(3, 'Profile is still referenced');
      if (!config.profiles[name]) throw new RibbitError(3, 'Unknown profile');
      delete config.profiles[name];
    } else throw new RibbitError(2, 'Use profiles list, show, set or remove');
    await saveConfig(config);
    result({ profile: name, operation });

    return;
  }
  if (command === 'models') {
    if (operation !== 'list' || !f.provider || !config.providers[f.provider])
      throw new RibbitError(3, 'Use models list --provider NAME');
    const provider = config.providers[f.provider],
      adapter = provider.type === 'ollama' ? new OllamaAdapter() : new CompatibleAdapter();

    result({ provider: f.provider, models: await adapter.models(provider, AbortSignal.timeout(5000)) });

    return;
  }
  if (command === 'route') {
    if (operation !== 'inspect' || !name) throw new RibbitError(2, 'Use route inspect COMMAND');
    const invocation = await resolveInvocation(name);
    const route = routeFor(invocation, config, {
      project: await loadProjectInference(join(process.cwd(), '.ribbit.yaml')),
      cli: {
        ...(f.profile ? { profile: f.profile } : {}),
        ...(f.provider ? { provider: f.provider } : {}),
        ...(f.model ? { model: f.model } : {}),
      },
    });

    result(
      route
        ? inspectRoute(route)
        : { inference: false, effects: invocation.manifest.actions[invocation.action].effects },
    );

    return;
  }
  if (command === 'setup') {
    const discovered = [];

    for (const candidate of [
      { name: 'ollama', type: 'ollama', baseUrl: 'http://127.0.0.1:11434' },
      { name: 'lmstudio', type: 'openai-compatible', baseUrl: 'http://127.0.0.1:1234/v1' },
    ]) {
      const provider = providerSchema.parse({
        type: candidate.type,
        baseUrl: candidate.baseUrl,
        capabilities: ['text', 'stream', 'object', 'temperature', 'maxOutputTokens'],
      });
      let models: string[] = [];
      let reachable = false;

      try {
        models = await (provider.type === 'ollama' ? new OllamaAdapter() : new CompatibleAdapter()).models(
          provider,
          AbortSignal.timeout(3000),
        );
        reachable = true;
      } catch {}
      discovered.push({ name: candidate.name, baseUrl: candidate.baseUrl, reachable, models });
    }
    result({
      providers: discovered,
      downloadPerformed: false,
      next: 'Use providers add and profiles set with an installed model. No configuration was changed.',
    });

    return;
  }
  if (command === 'doctor') {
    const checks: any[] = [{ name: 'configuration', ok: true }];
    const picker = Bun.which('fzf');

    checks.push({ name: 'picker', ok: !!picker });
    for (const extension of await listInstalled()) {
      const { sourceDigest } = await import('../../extensions/install/index.ts');
      let ok = false;

      try {
        ok = (await sourceDigest(extension.source)) === extension.manifest.sourceHash;
      } catch {}
      checks.push({ name: extension.manifest.type, ok });
    }
    if (f.probe)
      for (const [providerName, provider] of Object.entries(config.providers)) {
        try {
          const models = await (provider.type === 'ollama' ? new OllamaAdapter() : new CompatibleAdapter()).models(
            provider,
            AbortSignal.timeout(3000),
          );

          checks.push({ name: providerName, ok: true, models, capabilities: provider.capabilities });
        } catch {
          checks.push({ name: providerName, ok: false });
        }
      }
    result({ checks, ok: checks.every((c) => c.ok) });
    if (checks.some((c) => !c.ok)) process.exitCode = 3;

    return;
  }
  throw new RibbitError(2, 'Unknown management command');
}
