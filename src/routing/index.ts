import { type Config, type Inference, type Provider, inferenceSchema } from '../config/index.ts';
import { RibbitError } from '../engine/records/index.ts';

export const LAYERS = [
  'global',
  'project',
  'savedFlow',
  'invocationFlow',
  'perCommand',
  'definition',
  'step',
  'cli',
] as const;

export type Layer = (typeof LAYERS)[number];

export interface Route {
  provider: string;
  model: string;
  temperature?: number;
  maxOutputTokens?: number;
  timeout?: number;
  reasoning?: 'off' | 'on';
  source: Record<string, string>;
  endpoint: Provider;
}

export function selectRoute(config: Config, layers: Partial<Record<Layer, Inference>>, forceProfile?: string): Route {
  let route: Partial<Inference> = {},
    source: Record<string, string> = {};

  for (const name of LAYERS) {
    const raw = name === 'global' ? (layers.global ?? config.default) : layers[name];

    if (!raw) continue;
    const parsed = inferenceSchema.safeParse(raw);

    if (!parsed.success) throw new RibbitError(3, `Invalid inference fields at ${name}`);
    const layer = parsed.data;

    if (layer.profile !== undefined) {
      const profile = config.profiles[layer.profile];

      if (!profile) throw new RibbitError(3, `Unknown profile at ${name}`);
      route = { ...route, ...profile, provider: profile.provider, model: profile.model };
      for (const key of Object.keys(profile)) source[key] = name;
    }
    if (layer.provider !== undefined) {
      const provider = config.providers[layer.provider];

      if (!provider) throw new RibbitError(3, `Unknown provider at ${name}`);
      route.provider = layer.provider;
      route.model = provider.defaultModel;
      source.provider = name;
      source.model = name;
      if (!route.model && !layer.model)
        throw new RibbitError(3, `Provider at ${name} requires a configured default model or explicit model`);
    }
    for (const key of ['model', 'temperature', 'maxOutputTokens', 'timeout', 'reasoning'] as const) {
      if (layer[key] !== undefined) {
        Object.assign(route, { [key]: layer[key] });
        source[key] = name;
      }
    }
  }
  if (forceProfile !== undefined) {
    const profile = config.profiles[forceProfile];

    if (!profile) throw new RibbitError(3, 'Unknown force-profile');
    route = { ...profile };
    source = Object.fromEntries(Object.keys(profile).map((key) => [key, 'forceProfile']));
  }
  if (!route.provider || !route.model) throw new RibbitError(3, 'No complete route; configure a provider and model');
  const endpoint = config.providers[route.provider];

  if (!endpoint) throw new RibbitError(3, 'Resolved provider is not configured');

  return { ...route, provider: route.provider, model: route.model, source, endpoint };
}

export function routeChecks(route: Route, capabilities: string[]) {
  const required = [
    ...capabilities,
    ...(route.temperature === undefined ? [] : ['temperature']),
    ...(route.maxOutputTokens === undefined ? [] : ['maxOutputTokens']),
    ...(route.reasoning === undefined ? [] : ['reasoning']),
  ];

  return {
    modelAllowed: !route.endpoint.models || route.endpoint.models.includes(route.model),
    required: [...new Set(required)],
    missing: [...new Set(required)].filter(
      (capability) => !route.endpoint.capabilities.includes(capability as Provider['capabilities'][number]),
    ),
  };
}

export function resolveRoute(
  config: Config,
  layers: Partial<Record<Layer, Inference>>,
  forceProfile?: string,
  capabilities: string[] = ['text'],
  invocation = 'Invocation',
): Route {
  const route = selectRoute(config, layers, forceProfile);
  const checks = routeChecks(route, capabilities);

  if (!checks.modelAllowed) throw new RibbitError(3, 'Resolved model is not in provider model allowlist');
  for (const capability of checks.missing)
    throw new RibbitError(
      3,
      `${invocation} requires ${capability}; provider ${route.provider}, model ${route.model}, declares [${route.endpoint.capabilities.join(', ')}]. Select an explicitly configured compatible route or correct the provider declaration after verifying support.`,
    );

  return route;
}

export function commandRoute(config: Config, name: string, typeAction?: string): Inference | undefined {
  return config.routes[name] ?? (typeAction ? config.routes[typeAction] : undefined);
}

export function inspectRoute(route: Route) {
  const { endpoint, ...safe } = route;

  return {
    schemaVersion: 1,
    ...safe,
    endpoint: {
      type: endpoint.type,
      baseUrl: endpoint.baseUrl,
      authentication: endpoint.apiKeyEnv ? 'environment' : 'none',
    },
  };
}
