import { hash } from 'node:crypto';

// The identity of a rule that asks a model: the model's id and the SHA-256
// of what the rule sends besides each item, such as its instructions, its
// schema and its settings. A computed dataset computes every row again when
// the identity changes. digits keeps the first hex digits of the hash.
export function ruleIdentity(
  modelId: string,
  sent: unknown,
  { digits = 64 }: { readonly digits?: number } = {},
): string {
  const digest = hash('sha256', JSON.stringify(sent));
  return `${modelId}:${digest.slice(0, digits)}`;
}
