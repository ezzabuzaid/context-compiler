import { hash } from 'node:crypto';

import { createMicrosandboxSandbox } from '@deepagents/context';
import { defineSandbox } from '@deepagents/experimental/zukhruf';
import { NetworkPolicy } from 'microsandbox';

import { state } from './stack.ts';

// One named microVM per state directory, with no network and no host mounts,
// so a run with another state directory never attaches to this one. Each turn
// re-attaches to it by name, and it keeps its files across restarts.
const name = `ambient-${hash('sha256', state).slice(0, 16)}`;

export default defineSandbox(() =>
  createMicrosandboxSandbox({
    name,
    configure: (builder) =>
      builder.network((network) => network.policy(NetworkPolicy.none())),
  }),
);
