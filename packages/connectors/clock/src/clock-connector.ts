import { clockLocation } from '@eltjs/sdk-apple-clock/clock-store';
import { AppleClockSource } from '@eltjs/source-apple-clock/apple-clock-source';
import type { Choice } from '@workspace/connector/choice';
import { Connector } from '@workspace/connector/connector';

export default class ClockConnector extends Connector {
  readonly datedBy = null;
  protected readonly choices: readonly Choice[] = [];
  protected override readonly probe = 'alarms';
  protected readonly unscoped = [];
  protected readonly storeCopies = [];
  protected sources() {
    return [new AppleClockSource(clockLocation(this.host.home))] as const;
  }
}
