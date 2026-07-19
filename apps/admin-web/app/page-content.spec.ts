import { describe, expect, it } from 'vitest';
import { adminHomeContent } from './page-content';

describe('admin home content', () => {
  it('defines the operational queues without user data', () => {
    expect(adminHomeContent.title).toBe('Operations workspace');
    expect(adminHomeContent.queues).toEqual([
      'Urgent',
      'Incidents',
      'Replacements',
      'General',
    ]);
  });
});
