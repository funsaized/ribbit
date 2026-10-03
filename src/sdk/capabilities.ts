import { z } from 'zod';
import { RibbitError } from '../engine/records/index.ts';
import type { JsonSchema } from './manifest/index.ts';

const names = z.enum(['text', 'stream', 'object', 'temperature', 'maxOutputTokens', 'reasoning']);
const capabilities = z.array(names);
const declarationSchema = z.union([
  capabilities,
  z.strictObject({ whenAny: z.array(z.string()).min(1), ifTrue: capabilities, ifFalse: capabilities }),
]);

export type Capabilities = string[] | { whenAny: string[]; ifTrue: string[]; ifFalse: string[] };

export type CapabilityResolution =
  | { status: 'exact' | 'semantic'; capabilities: string[] }
  | { status: 'unresolved'; arguments: string[] };

export function validateCapabilities(value: unknown, args: JsonSchema, code = 2): Capabilities {
  const parsed = declarationSchema.safeParse(value);

  if (!parsed.success) throw new RibbitError(code, 'Invalid capability declaration');
  const result = parsed.data;

  if (!Array.isArray(result)) {
    if (new Set(result.whenAny).size !== result.whenAny.length)
      throw new RibbitError(code, 'Duplicate capability selector argument');
    for (const field of result.whenAny) {
      const property = args.properties?.[field];

      if (!property || !['string', 'boolean'].includes(property.type))
        throw new RibbitError(code, `Capability selector ${field} must name a string or boolean argument`);
    }
  }

  return result;
}

export function resolveCapabilities(
  action: { capabilities: Capabilities; args: JsonSchema },
  args: Record<string, unknown>,
  unresolved: ReadonlySet<string> = new Set(),
): CapabilityResolution {
  const declaration = action.capabilities;
  let selected: string[];

  if (Array.isArray(declaration)) selected = declaration;
  else {
    const knownTrue = declaration.whenAny.some(
      (field) =>
        !unresolved.has(field) &&
        !!(Object.hasOwn(args, field) ? args[field] : action.args.properties?.[field]?.default),
    );
    const pending = declaration.whenAny.filter((field) => unresolved.has(field));

    if (!knownTrue && pending.length) return { status: 'unresolved', arguments: pending };
    selected = knownTrue ? declaration.ifTrue : declaration.ifFalse;
  }
  const required = [...new Set(selected)];

  return { status: required.length ? 'semantic' : 'exact', capabilities: required };
}
