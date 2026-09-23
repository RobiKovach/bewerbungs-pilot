import { createRequire } from 'node:module';
import type { JsonSchema } from './types.js';

// ajv is CommonJS; createRequire avoids the default-export interop trap under NodeNext.
const Ajv = createRequire(import.meta.url)('ajv') as typeof import('ajv').default;
const ajv = new Ajv({ allErrors: true, strict: false });

export function validateOutput(schema: JsonSchema, value: unknown): { ok: true } | { ok: false; errors: string } {
  const validate = ajv.compile(schema);
  if (validate(value)) return { ok: true };
  return { ok: false, errors: ajv.errorsText(validate.errors, { separator: '; ' }) + ` (got ${JSON.stringify(value)?.slice(0, 300)})` };
}
