import { log } from './log.ts';
import type { StreamHealth } from './notifications.ts';
import { ping } from './ping.ts';

/** Whether the router sees new notifications; each state tells Ezz once when it ends. */
export interface TriggerState {
  observe(health: StreamHealth | undefined): Promise<TriggerState>;
}

export class Seeing implements TriggerState {
  async observe(health: StreamHealth | undefined): Promise<TriggerState> {
    if (health?.status !== 'failed') return this;
    log('trigger-failing', { error: health.error });
    await ping(
      `Notification Center import stopped loading notifications, so sessions get nothing: ${health.error.slice(0, 300)}`,
    );
    return new Blind();
  }
}

class Blind implements TriggerState {
  async observe(health: StreamHealth | undefined): Promise<TriggerState> {
    if (health?.status === 'failed') return this;
    log('trigger-recovered', {});
    await ping('Notification Center import loads notifications again.');
    return new Seeing();
  }
}
