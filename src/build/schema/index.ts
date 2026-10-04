import type Ajv2020 from 'ajv/dist/2020.js';
import type { ValidateFunction } from 'ajv';
import { z } from 'zod';
import * as compiled from '../../generated/validators.ts';
import { hash, stable } from '../../sdk/manifest/index.ts';
import { RibbitError, isJson, type Json } from '../../engine/records/index.ts';
import type { JsonSchema } from '../../sdk/manifest/index.ts';

let ajv: Ajv2020 | undefined;

function compiler() {
  return (ajv ??= new (require('ajv/dist/2020.js').default)({ allErrors: true, useDefaults: true, strict: false }));
}

const cache = new WeakMap<object, ReturnType<Ajv2020['compile']>>();

// Dynamic schemas cannot supply a static result type; callers own the validated shape.
export function validateJson(schema: JsonSchema, value: unknown, location = 'args', code = 2): any {
  if (!isJson(value)) throw new RibbitError(code, 'Expected finite JSON', location);
  let validator =
    cache.get(schema) ?? (compiled as unknown as Record<string, ValidateFunction>)['v' + hash(stable(schema))];

  try {
    if (!validator) {
      validator = compiler().compile(schema);
      cache.set(schema, validator);
    }
  } catch {
    throw new RibbitError(2, 'Unsupported or invalid JSON Schema', location);
  }
  const copy = structuredClone(value);

  if (!validator(copy))
    throw new RibbitError(
      code,
      validator.errors?.map((e) => `${e.instancePath || location} ${e.message}`).join('; ') ??
        'Schema validation failed',
      location,
    );

  if (!isJson(copy)) throw new RibbitError(code, 'Schema produced non-finite JSON', location);

  return copy;
}

export function validateExternalSchema(schema: unknown): asserts schema is JsonSchema {
  const allowed = new Set([
    '$schema',
    '$id',
    '$defs',
    '$ref',
    'type',
    'properties',
    'required',
    'additionalProperties',
    'items',
    'enum',
    'const',
    'anyOf',
    'oneOf',
    'allOf',
    'minItems',
    'maxItems',
    'minLength',
    'maxLength',
    'pattern',
    'minimum',
    'maximum',
    'exclusiveMinimum',
    'exclusiveMaximum',
    'multipleOf',
    'description',
    'title',
    'default',
    'examples',
  ]);

  if (!isJson(schema)) throw new RibbitError(2, 'Schema must contain finite JSON');
  const seen = new Set<unknown>();

  function visit(raw: unknown, depth = 0) {
    if (depth > 32 || !raw || typeof raw !== 'object' || Array.isArray(raw) || seen.has(raw))
      throw new RibbitError(2, 'Unsupported recursive or invalid schema');
    const node = raw as JsonSchema;

    seen.add(node);
    for (const key of Object.keys(node))
      if (!allowed.has(key)) throw new RibbitError(2, `Unsupported schema keyword: ${key}`);
    if (node.$ref !== undefined)
      throw new RibbitError(2, 'External extraction schemas must be self-contained without $ref');
    if (node.oneOf || node.allOf) throw new RibbitError(2, 'Use anyOf for schema unions');
    const types = Array.isArray(node.type) ? node.type : node.type === undefined ? [] : [node.type];

    if (
      types.some(
        (type: unknown) =>
          !['string', 'number', 'integer', 'boolean', 'null', 'array', 'object'].includes(String(type)),
      )
    )
      throw new RibbitError(2, 'Unsupported schema type');
    if (!types.length && node.const === undefined && !node.enum && !node.anyOf)
      throw new RibbitError(2, 'Schema requires a supported type, enum, const or anyOf');
    if (types.includes('object') && node.additionalProperties !== false)
      throw new RibbitError(2, 'Extraction object schemas must set additionalProperties:false');
    if (types.includes('array') && !node.items) throw new RibbitError(2, 'Array schema requires items');
    const literals: unknown[] = [...(node.enum ?? []), ...(node.const === undefined ? [] : [node.const])];

    if (literals.some((value) => value !== null && !['string', 'number', 'boolean'].includes(typeof value)))
      throw new RibbitError(2, 'Only scalar const and enum schemas are supported');
    for (const child of Object.values(node.properties ?? {})) visit(child, depth + 1);
    for (const child of Object.values(node.$defs ?? {})) visit(child, depth + 1);
    if (node.items) visit(node.items, depth + 1);
    for (const key of ['anyOf', 'oneOf', 'allOf']) for (const child of node[key] ?? []) visit(child, depth + 1);
    if (typeof node.additionalProperties === 'object') visit(node.additionalProperties, depth + 1);
    seen.delete(node);
  }

  try {
    // Compile first so malformed keyword values cannot reach the subset walk.
    compiler().compile(schema as object);
  } catch {
    throw new RibbitError(2, 'Invalid JSON Schema');
  }
  visit(schema);
}

const externalSchemas = new WeakMap<z.ZodType, JsonSchema>();

export function externalJsonSchema(schema: z.ZodType): JsonSchema | undefined {
  const external = externalSchemas.get(schema);

  return external && structuredClone(external);
}

export function schemaToZod(schema: JsonSchema): z.ZodType<Json> {
  if (!isJson(schema)) throw new RibbitError(2, 'Schema must contain finite JSON');
  const external = structuredClone(schema);

  validateExternalSchema(external);
  // AJV is authoritative: converting constraints independently caused semantic drift.
  const result = z.unknown().transform((value, ctx): Json => {
    try {
      return validateJson(external, value, 'inference', 4);
    } catch (error) {
      if (!(error instanceof RibbitError)) throw error;
      ctx.addIssue({ code: 'custom', message: error.message });

      return z.NEVER;
    }
  });

  externalSchemas.set(result, external);

  return result;
}
