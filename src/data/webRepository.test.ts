import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebRepository } from './webRepository';

let repo: WebRepository;
beforeEach(() => {
  localStorage.clear();
  repo = new WebRepository(true);
});
afterEach(() => {
  repo.dispose();
  vi.restoreAllMocks();
});

describe('WebRepository durability', () => {
  it('rejects updates to missing documents instead of minting partial records', async () => {
    await expect(repo.update('patients', 'missing', { name: 'Ghost' })).rejects.toThrow(/missing/);
    expect(await repo.get('patients', 'missing')).toBeNull();
  });

  it('fails closed when storage rejects a write', async () => {
    const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key.startsWith('pathlab:patients')) throw new DOMException('quota', 'QuotaExceededError');
      return original.call(this, key, value);
    });
    await expect(repo.set('patients', 'p1', { name: 'Asha' })).rejects.toThrow(/quota/);
    expect(await repo.get('patients', 'p1')).toBeNull();
  });

  it('does not overwrite unreadable stored data with an empty collection', async () => {
    localStorage.setItem('pathlab:patients', '{broken');
    await expect(repo.list('patients')).rejects.toThrow(/not overwritten/);
    expect(localStorage.getItem('pathlab:patients')).toBe('{broken');
  });

  it('merges against the latest storage value rather than a stale tab cache', async () => {
    await repo.set('patients', 'p1', { name: 'Asha' });
    await repo.list('patients'); // warm this tab's cache
    localStorage.setItem(
      'pathlab:patients',
      JSON.stringify({ p1: { name: 'Asha' }, p2: { name: 'Bilal' } }),
    );
    await repo.set('patients', 'p3', { name: 'Chetan' });
    expect(
      Object.keys(JSON.parse(localStorage.getItem('pathlab:patients') ?? '{}')).sort(),
    ).toEqual(['p1', 'p2', 'p3']);
  });
});
