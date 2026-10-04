import { join } from 'node:path';
import { loadConfig, loadDotenv, loadProjectInference, type Config, type Inference } from '../../config/index.ts';
import { invocationLayers, routeFor } from '../../engine/runtime/index.ts';
import { inspectRoute, selectRoute, routeChecks, type Route } from '../../routing/index.ts';
import { RibbitError } from '../../engine/records/index.ts';
import { listInstalled, sourceDigest } from '../../extensions/install/index.ts';
import { checkPicker } from '../../picker/index.ts';
import { OllamaAdapter } from '../../providers/ollama/index.ts';
import { CompatibleAdapter } from '../../providers/openai-compatible/index.ts';
import type { PreparedInvocation } from '../invocation.ts';

function describe(prepared: PreparedInvocation) {
  return {
    command: prepared.invocation.name,
    type: prepared.invocation.manifest.type,
    action: prepared.invocation.action,
    args: prepared.invocation.args,
    runtime: prepared.runtime,
    limits: prepared.limits,
    inference: prepared.inference,
    effects: prepared.action.effects,
  };
}

export async function inspectInvocation(prepared: PreparedInvocation) {
  loadDotenv();
  const config = await loadConfig();
  const project = await loadProjectInference(join(process.cwd(), '.ribbit.yaml'));
  const route = routeFor(prepared.invocation, config, { project, cli: prepared.cli });

  return { schemaVersion: 1, offline: true, ...describe(prepared), route: route ? inspectRoute(route) : null };
}

type Check = { name: string; ok: boolean | null; status: string } & Record<string, unknown>;

function diagnostic(error: unknown) {
  return error instanceof RibbitError ? error.message : 'Check failed (details redacted)';
}

export async function doctor(prepared: PreparedInvocation | undefined, probe: boolean) {
  const checks: Check[] = [];
  let config: Config | undefined;
  let route: Route | undefined;
  let project: Inference = {};

  try {
    loadDotenv();
    config = await loadConfig();
    project = await loadProjectInference(join(process.cwd(), '.ribbit.yaml'));
    checks.push({ name: 'configuration', ok: true, status: 'valid' });
  } catch (error) {
    checks.push({ name: 'configuration', ok: false, status: 'invalid', message: diagnostic(error) });
    config = undefined;
  }
  if (!prepared)
    checks.push({
      name: 'exact-commands',
      ok: !!config,
      status: config ? 'available' : 'blocked',
      message: 'Individual arguments, files and input data are not checked.',
    });
  const semantic = !prepared || prepared.semantic;

  if (!semantic)
    checks.push({
      name: 'route',
      ok: null,
      status: 'not-applicable',
      message: 'Exact invocation; no inference route is required.',
    });
  else if (!config) checks.push({ name: 'route', ok: null, status: 'blocked' });
  else {
    try {
      route = selectRoute(
        config,
        prepared ? invocationLayers(prepared.invocation, config, { project, cli: prepared.cli }) : { project },
      );
      checks.push({ name: 'route', ok: true, status: 'complete', route: inspectRoute(route) });
    } catch (error) {
      checks.push({ name: 'route', ok: false, status: 'incomplete', message: diagnostic(error) });
    }
  }
  if (route) {
    const capabilities = prepared?.inference.status === 'semantic' ? prepared.inference.capabilities : [];
    const admission = routeChecks(route, capabilities);

    checks.push({
      name: 'model',
      ok: admission.modelAllowed,
      status: admission.modelAllowed ? 'allowed' : 'not-allowlisted',
      model: route.model,
      availability: 'unverified',
      capabilitySupport: 'unverified',
      message: 'Allowlist admission is not proof of model availability or capability support.',
    });
    checks.push({
      name: 'capabilities',
      ok: !admission.missing.length,
      status: admission.missing.length ? 'unsupported' : prepared ? 'declared-compatible' : 'controls-only',
      required: admission.required,
      declared: route.endpoint.capabilities,
      missing: admission.missing,
      message: admission.missing.length
        ? 'Select an explicitly configured compatible route or correct the provider declaration after verifying support.'
        : prepared
          ? 'Provider declarations only; model-specific support is unverified.'
          : 'Only inference controls checked; use doctor -- COMMAND [args] to check a selected mode. Model-specific support is unverified.',
    });
    const authentication = !route.endpoint.apiKeyEnv
      ? 'not-configured'
      : process.env[route.endpoint.apiKeyEnv]
        ? 'environment-present'
        : 'missing';

    checks.push({
      name: 'authentication',
      ok: authentication !== 'missing',
      status: authentication,
      verified: false,
      ...(authentication === 'missing'
        ? {
            message:
              'Set the environment variable referenced by the selected provider apiKeyEnv; credentials are not printed.',
          }
        : {}),
    });
  } else {
    for (const name of ['model', 'capabilities', 'authentication'])
      checks.push({ name, ok: null, status: semantic ? 'blocked' : 'not-applicable' });
  }
  if (!prepared || prepared.invocation.manifest.type === '@ribbit/pick') {
    const picker = await checkPicker();

    checks.push({
      name: 'picker',
      ok: picker.status === 'supported',
      ...picker,
      message: `Requires fzf >=${picker.minimum} and a controlling terminal when running pick. No tools are installed by doctor.`,
    });
  } else checks.push({ name: 'picker', ok: null, status: 'not-applicable' });

  if (!prepared || !prepared.invocation.manifest.type.startsWith('@ribbit/')) {
    try {
      const extensions = (await listInstalled()).filter(
        (extension) => !prepared || extension.manifest.type === prepared.invocation.manifest.type,
      );

      for (const extension of extensions) {
        let fresh = false;

        try {
          fresh = (await sourceDigest(extension.source)) === extension.manifest.sourceHash;
        } catch {}
        checks.push({
          name: `extension:${extension.manifest.type}`,
          ok: fresh,
          status: fresh ? 'fresh' : 'stale',
          ...(fresh
            ? {}
            : {
                message:
                  'Restore the original source or explicitly rebuild with extensions add; extensions remove can uninstall stale registrations.',
              }),
        });
      }
    } catch (error) {
      checks.push({ name: 'extensions', ok: false, status: 'invalid', message: diagnostic(error) });
    }
  }
  if (probe && config) {
    const providers = prepared
      ? route
        ? ([[route.provider, route.endpoint]] as const)
        : []
      : Object.entries(config.providers);

    if (!providers.length)
      checks.push({ name: 'provider-probes', ok: null, status: semantic ? 'no-selected-provider' : 'not-applicable' });
    for (const [name, provider] of providers) {
      try {
        const adapter = provider.type === 'ollama' ? new OllamaAdapter() : new CompatibleAdapter();
        const models = await adapter.models(provider, AbortSignal.timeout(3000));
        const selectedModelAvailable = route?.provider === name ? models.includes(route.model) : undefined;

        checks.push({
          name: `probe:${name}`,
          ok: selectedModelAvailable !== false,
          status: selectedModelAvailable === false ? 'model-not-listed' : 'reachable',
          models,
          selectedModelAvailable,
          message: 'Model listing only; no inference, loaded-state or capability verification.',
        });
      } catch (error) {
        checks.push({
          name: `probe:${name}`,
          ok: false,
          status: 'failed',
          message: `${diagnostic(error)}. Check endpoint connectivity, credentials and model availability; no fallback was attempted.`,
        });
      }
    }
  } else checks.push({ name: 'provider-probes', ok: null, status: probe ? 'blocked' : 'not-requested' });
  const ok = checks.every((check) => check.ok !== false);

  return {
    schemaVersion: 1,
    scope: prepared ? 'invocation' : 'installation',
    invocation: prepared ? describe(prepared) : null,
    probeRequested: probe,
    verification: checks.some((check) => check.name.startsWith('probe:')) ? 'offline-and-model-list' : 'offline',
    checks,
    ok,
    status: ok ? 'ready' : !prepared && config ? 'partial' : 'unavailable',
  };
}
