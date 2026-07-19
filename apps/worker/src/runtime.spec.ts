import { describe, expect, it } from 'vitest';
import { InMemoryEventQueue } from '@carespaces/eventing';

describe('worker runtime dependencies', () => {
  it('uses an isolated local queue with no external connection', async () => {
    const queue = new InMemoryEventQueue();
    expect(await queue.receive()).toEqual([]);
  });
});
