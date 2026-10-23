import type { Choice } from '@workspace/connector/choice';
import { Connector } from '@workspace/connector/connector';
import { AppleClockSource } from '@workspace/source-apple-clock/apple-clock-source';

export default class ClockConnector extends Connector {
  readonly datedBy = null;
  readonly fullDiskAccess = true;
  protected readonly choices: readonly Choice[] = [];
  protected override readonly probe = 'alarms';
  protected readonly unscoped = [];
  protected readonly storeCopies = [];
  protected access(): string {
    return 'Open Clock once to create its stores. Clock need not stay open: this imports saved alarms, timers, world clocks and the current stopwatch with its laps.';
  }
  protected source() {
    return new AppleClockSource();
  }
}
