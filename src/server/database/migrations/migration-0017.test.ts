import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('migration 0017', () => {
  const sql = readFileSync(
    resolve(__dirname, '0017_drop_subaccount_quota_rows.sql'),
    'utf-8'
  );

  it('deletes user_quota rows for sub-accounts', () => {
    expect(sql).toContain('DELETE FROM user_quota');
    expect(sql).toContain('parent_user_id IS NOT NULL');
  });

  it('does not alter the user_quota table schema', () => {
    expect(sql).not.toContain('ALTER TABLE user_quota');
    expect(sql).not.toContain('CREATE TABLE');
    expect(sql).not.toContain('DROP TABLE user_quota');
  });
});
