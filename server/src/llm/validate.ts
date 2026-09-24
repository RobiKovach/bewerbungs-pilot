import { createRequire } from 'node:module';
import type { ValidateFunction } from 'ajv';
import type { JsonSchema } from './types.js';

// ajv is CommonJS; createRequire avoids the default-export interop trap under NodeNext.
const Ajv = createRequire(import.meta.url)('ajv') as typeof import('ajv').default;
const ajv = new Ajv({ allErrors: true, strict: false });

// Tasks build a fresh schema object per call; ajv caches by object identity, so without this every call would
// compile (and keep) another validator. Keyed by the schema's JSON text instead.
const compiled = new Map<string, ValidateFunction>();

export function validatorFor(schema: JsonSchema): ValidateFunction {
  const key = JSON.stringify(schema);
  let validate = compiled.get(key);
  if (!validate) {
    validate = ajv.compile(schema);
    compiled.set(key, validate);
  }
  return validate;
}

export function validateOutput(schema: JsonSchema, value: unknown): { ok: true } | { ok: false; errors: string } {
  const validate = validatorFor(schema);
  if (validate(value)) return { ok: true };
  return { ok: false, errors: ajv.errorsText(validate.errors, { separator: '; ' }) + ` (got ${JSON.stringify(value)?.slice(0, 300)})` };
}
