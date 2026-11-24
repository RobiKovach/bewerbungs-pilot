import { defineConfig } from 'vitest/config';

// Generous on purpose: scrypt, zip and PowerShell tests share a busy PC or CI runner, and 5 s made them fail at random.
export default defineConfig({ test: { testTimeout: 30_000, hookTimeout: 30_000 } });
