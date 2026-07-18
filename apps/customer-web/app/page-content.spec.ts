import { describe, expect, it } from 'vitest';
import { customerHomeContent } from './page-content';

describe('customer home content', () => {
  it('exposes the product identity and readiness status', () => {
    expect(customerHomeContent.title).toBe('พื้นที่ดูแลที่ไว้ใจได้');
    expect(customerHomeContent.status).toBe('Foundation ready');
    expect(customerHomeContent.description).toContain('ติดตามการดูแล');
  });
});
