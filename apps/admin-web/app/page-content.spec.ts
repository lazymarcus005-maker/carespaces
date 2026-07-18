import { describe, expect, it } from 'vitest';
import { adminHomeContent } from './page-content';

describe('admin home content', () => {
  it('defines the operational queues without user data', () => {
    expect(adminHomeContent.title).toBe('Care Ops');
    expect(adminHomeContent.description).toContain(
      'ยังไม่มีข้อมูลผู้ใช้งานจริง',
    );
    expect(adminHomeContent.queues).toEqual([
      'Verification',
      'Clinical review',
      'Active incidents',
      'Finance',
    ]);
  });
});
