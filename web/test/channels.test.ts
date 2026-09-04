import { describe, expect, it } from 'vitest';
import { customisedChannels, differsFromPanel, effectiveOverrides } from '../src/lib/channels';

/**
 * A channel counts as customised only when its values actually differ from the
 * panel's. Testing for the presence of a stored key marks a channel forever after
 * a flag is toggled on and then off again, because the field is still stored —
 * with the panel's own value.
 */
describe('channel customisation', () => {
  const base = { on1: false, athr1: 0, tthr1_ns: 100 };

  it('sees no difference when nothing is stored', () => {
    expect(differsFromPanel(undefined, base)).toBe(false);
    expect(differsFromPanel({}, base)).toBe(false);
  });

  it('sees a difference when a value diverges', () => {
    expect(differsFromPanel({ on1: true }, base)).toBe(true);
    expect(differsFromPanel({ athr1: 7 }, base)).toBe(true);
  });

  it('sees no difference once a value is set back to the panel value', () => {
    // Toggled on, then off again: the key remains but the value matches.
    expect(differsFromPanel({ on1: false }, base)).toBe(false);
    expect(differsFromPanel({ athr1: 0 }, base)).toBe(false);
  });

  it('ignores fields that match while reporting those that do not', () => {
    expect(effectiveOverrides({ on1: false, athr1: 9 }, base)).toEqual(['athr1']);
  });

  it('follows the panel value when that changes', () => {
    // The same stored value is a customisation against one panel value and not
    // against another.
    expect(differsFromPanel({ athr1: 5 }, { ...base, athr1: 0 })).toBe(true);
    expect(differsFromPanel({ athr1: 5 }, { ...base, athr1: 5 })).toBe(false);
  });

  it('compares arrays by value, not identity', () => {
    const withArray = { coef: [1, 2] };
    expect(differsFromPanel({ coef: [1, 2] }, withArray)).toBe(false);
    expect(differsFromPanel({ coef: [1, 3] }, withArray)).toBe(true);
  });

  it('lists customised channels in hardware order', () => {
    const channels = {
      '1:3': { athr1: 1 },
      '0:11': { athr1: 2 },
      '0:2': { athr1: 3 },
      '2:0': { on1: false }, // matches the panel, so not customised
    };
    expect(customisedChannels(channels, base)).toEqual(['0:2', '0:11', '1:3']);
  });

  it('reports nothing when every channel matches the panel', () => {
    expect(customisedChannels({ '0:0': { on1: false }, '0:1': {} }, base)).toEqual([]);
  });
});
