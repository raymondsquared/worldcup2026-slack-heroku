'use strict';

const { diffAll, buildMatchEndDiff, clear } = require('../live-data/differ');

describe('live-data/differ', () => {
  beforeEach(() => {
    clear();
  });

  function makeEntry(id, events, score = { home: 1, away: 0 }, elapsed = 45) {
    return [
      id,
      {
        events: events.map((e) => ({
          type: e.type || 'Goal',
          minute: e.minute,
          playerExternalId: e.playerExternalId || 100,
          playerName: e.playerName || 'Player',
          ...e,
        })),
        finalScore: score,
        elapsed,
      },
    ];
  }

  test('first call for a fixture seeds state, emits an initial diff (restart guard)', () => {
    const entries = [makeEntry(1, [{ type: 'Goal', minute: 23, playerExternalId: 101 }])];

    const diffs = diffAll(entries);

    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({
      fixtureId: 1,
      newEvents: [],
      scoreChanged: false,
      elapsedChanged: false,
      initial: true,
      currentScore: { home: 1, away: 0 },
      elapsed: 45,
    });
  });

  test('initial diff is emitted exactly once; the second poll uses normal change detection', () => {
    const entries = [makeEntry(1, [], { home: 0, away: 0 }, 10)];

    const first = diffAll(entries); // first observation -> initial diff
    expect(first).toHaveLength(1);
    expect(first[0].initial).toBe(true);

    // Identical second poll: no change, and crucially NOT another initial diff.
    const second = diffAll(entries);
    expect(second).toEqual([]);
  });

  test('same events on second call returns empty (no changes)', () => {
    const entries = [makeEntry(1, [{ type: 'Goal', minute: 23, playerExternalId: 101 }])];

    diffAll(entries); // seed
    const diffs = diffAll(entries); // same data

    expect(diffs).toEqual([]);
  });

  test('new events returns only unseen events', () => {
    const seed = [makeEntry(1, [{ type: 'Goal', minute: 23, playerExternalId: 101 }])];
    diffAll(seed);

    const updated = [
      makeEntry(
        1,
        [
          { type: 'Goal', minute: 23, playerExternalId: 101 },
          { type: 'Goal', minute: 55, playerExternalId: 202 },
        ],
        { home: 2, away: 0 },
      ),
    ];
    const diffs = diffAll(updated);

    expect(diffs).toHaveLength(1);
    expect(diffs[0].fixtureId).toBe(1);
    expect(diffs[0].newEvents).toHaveLength(1);
    expect(diffs[0].newEvents[0].minute).toBe(55);
    expect(diffs[0].scoreChanged).toBe(true);
  });

  test('handles API reordering (event inserted at earlier minute)', () => {
    const seed = [makeEntry(1, [{ type: 'Goal', minute: 55, playerExternalId: 202 }])];
    diffAll(seed);

    // API now returns an earlier event (VAR-awarded goal at minute 23)
    const reordered = [
      makeEntry(
        1,
        [
          { type: 'Goal', minute: 23, playerExternalId: 101 },
          { type: 'Goal', minute: 55, playerExternalId: 202 },
        ],
        { home: 2, away: 0 },
      ),
    ];
    const diffs = diffAll(reordered);

    expect(diffs).toHaveLength(1);
    expect(diffs[0].newEvents).toHaveLength(1);
    expect(diffs[0].newEvents[0].minute).toBe(23);
    expect(diffs[0].newEvents[0].playerExternalId).toBe(101);
  });

  // Regression: the API revises an event's minute between polls. The dedup key
  // must be minute-independent for subs and cards, or the same event re-posts
  // under the drifted minute (observed: a sub at 75' reappearing at 76').
  describe('minute drift (duplicate suppression)', () => {
    test('substitution re-reported at a drifted minute is not a new event', () => {
      const seed = [
        makeEntry(1, [
          {
            type: 'subst',
            minute: 75,
            playerExternalId: 500,
            playerName: 'D. Fonville',
            assistPlayerExternalId: 600,
            assistPlayerName: 'R. van Eijma',
          },
        ]),
      ];
      diffAll(seed);

      // Same sub, API now reports it one minute later.
      const drifted = [
        makeEntry(1, [
          {
            type: 'subst',
            minute: 76,
            playerExternalId: 500,
            playerName: 'D. Fonville',
            assistPlayerExternalId: 600,
            assistPlayerName: 'R. van Eijma',
          },
        ]),
      ];
      const diffs = diffAll(drifted);

      expect(diffs).toEqual([]);
    });

    test('yellow card re-reported at a drifted minute is not a new event', () => {
      const seed = [
        makeEntry(1, [
          {
            type: 'Card',
            detail: 'Yellow Card',
            minute: 75,
            playerExternalId: 700,
            playerName: 'J. Gaari',
          },
        ]),
      ];
      diffAll(seed);

      const drifted = [
        makeEntry(1, [
          {
            type: 'Card',
            detail: 'Yellow Card',
            minute: 74,
            playerExternalId: 700,
            playerName: 'J. Gaari',
          },
        ]),
      ];
      const diffs = diffAll(drifted);

      expect(diffs).toEqual([]);
    });

    test('two distinct subs for the same player-off are independent events', () => {
      // Defensive: a player can only be subbed off once, but verify the key
      // distinguishes a different (off, on) pair rather than collapsing on type.
      const seed = [
        makeEntry(1, [
          {
            type: 'subst',
            minute: 60,
            playerExternalId: 10,
            playerName: 'A Off',
            assistPlayerExternalId: 11,
            assistPlayerName: 'A On',
          },
        ]),
      ];
      diffAll(seed);

      const updated = [
        makeEntry(1, [
          {
            type: 'subst',
            minute: 60,
            playerExternalId: 10,
            playerName: 'A Off',
            assistPlayerExternalId: 11,
            assistPlayerName: 'A On',
          },
          {
            type: 'subst',
            minute: 70,
            playerExternalId: 20,
            playerName: 'B Off',
            assistPlayerExternalId: 21,
            assistPlayerName: 'B On',
          },
        ]),
      ];
      const diffs = diffAll(updated);

      expect(diffs).toHaveLength(1);
      expect(diffs[0].newEvents).toHaveLength(1);
      expect(diffs[0].newEvents[0].playerExternalId).toBe(20);
    });

    test('a genuine brace (same scorer, two minutes) still emits both goals', () => {
      const seed = [
        makeEntry(1, [{ type: 'Goal', minute: 12, playerExternalId: 9, playerName: 'Striker' }], {
          home: 1,
          away: 0,
        }),
      ];
      diffAll(seed);

      const brace = [
        makeEntry(
          1,
          [
            { type: 'Goal', minute: 12, playerExternalId: 9, playerName: 'Striker' },
            { type: 'Goal', minute: 40, playerExternalId: 9, playerName: 'Striker' },
          ],
          { home: 2, away: 0 },
        ),
      ];
      const diffs = diffAll(brace);

      expect(diffs).toHaveLength(1);
      expect(diffs[0].newEvents).toHaveLength(1);
      expect(diffs[0].newEvents[0].minute).toBe(40);
    });

    test('a second yellow card is distinct from the first (different detail)', () => {
      const seed = [
        makeEntry(1, [
          {
            type: 'Card',
            detail: 'Yellow Card',
            minute: 30,
            playerExternalId: 8,
            playerName: 'Rough',
          },
        ]),
      ];
      diffAll(seed);

      const secondYellow = [
        makeEntry(1, [
          {
            type: 'Card',
            detail: 'Yellow Card',
            minute: 30,
            playerExternalId: 8,
            playerName: 'Rough',
          },
          {
            type: 'Card',
            detail: 'Second Yellow card',
            minute: 70,
            playerExternalId: 8,
            playerName: 'Rough',
          },
        ]),
      ];
      const diffs = diffAll(secondYellow);

      expect(diffs).toHaveLength(1);
      expect(diffs[0].newEvents).toHaveLength(1);
      expect(diffs[0].newEvents[0].detail).toBe('Second Yellow card');
    });

    test('red card re-reported at a drifted minute is not a new event', () => {
      const seed = [
        makeEntry(1, [
          {
            type: 'Card',
            detail: 'Red Card',
            minute: 66,
            playerExternalId: 900,
            playerName: 'Sent Off',
          },
        ]),
      ];
      diffAll(seed);

      const drifted = [
        makeEntry(1, [
          {
            type: 'Card',
            detail: 'Red Card',
            minute: 67,
            playerExternalId: 900,
            playerName: 'Sent Off',
          },
        ]),
      ];
      const diffs = diffAll(drifted);

      expect(diffs).toEqual([]);
    });

    test('substitution with no assist fields dedupes by player-off alone', () => {
      // Malformed/partial API event: no assist (player on) data. The key falls
      // back to an empty playerOn, and a drifted minute must still not re-emit.
      const seed = [
        makeEntry(1, [
          {
            type: 'subst',
            minute: 80,
            playerExternalId: 42,
            playerName: 'Off Only',
            assistPlayerExternalId: null,
            assistPlayerName: null,
          },
        ]),
      ];
      diffAll(seed);

      const drifted = [
        makeEntry(1, [
          {
            type: 'subst',
            minute: 81,
            playerExternalId: 42,
            playerName: 'Off Only',
            assistPlayerExternalId: null,
            assistPlayerName: null,
          },
        ]),
      ];
      const diffs = diffAll(drifted);

      expect(diffs).toEqual([]);
    });

    // Documents the accepted trade-off: goals keep the minute in their key (so a
    // genuine brace stays two alerts), which means a goal whose minute drifts
    // CAN re-post. If this ever bites in production, revisit the goal key.
    test('goal minute drift DOES re-emit (accepted trade-off for braces)', () => {
      const seed = [
        makeEntry(1, [{ type: 'Goal', minute: 45, playerExternalId: 9, playerName: 'Striker' }], {
          home: 1,
          away: 0,
        }),
      ];
      diffAll(seed);

      const drifted = [
        makeEntry(1, [{ type: 'Goal', minute: 46, playerExternalId: 9, playerName: 'Striker' }], {
          home: 1,
          away: 0,
        }),
      ];
      const diffs = diffAll(drifted);

      expect(diffs).toHaveLength(1);
      expect(diffs[0].newEvents).toHaveLength(1);
      expect(diffs[0].newEvents[0].minute).toBe(46);
    });
  });

  test('detects score change without new events', () => {
    const seed = [makeEntry(1, [], { home: 0, away: 0 })];
    diffAll(seed);

    const updated = [makeEntry(1, [], { home: 1, away: 0 })];
    const diffs = diffAll(updated);

    expect(diffs).toHaveLength(1);
    expect(diffs[0].scoreChanged).toBe(true);
    expect(diffs[0].previousScore).toEqual({ home: 0, away: 0 });
    expect(diffs[0].currentScore).toEqual({ home: 1, away: 0 });
    expect(diffs[0].newEvents).toEqual([]);
  });

  test('handles multiple fixtures independently', () => {
    const seed = [
      makeEntry(1, [{ type: 'Goal', minute: 10, playerExternalId: 100 }], { home: 1, away: 0 }),
      makeEntry(2, [], { home: 0, away: 0 }),
    ];
    diffAll(seed);

    const updated = [
      makeEntry(1, [{ type: 'Goal', minute: 10, playerExternalId: 100 }], { home: 1, away: 0 }),
      makeEntry(2, [{ type: 'Goal', minute: 30, playerExternalId: 300 }], { home: 1, away: 0 }),
    ];
    const diffs = diffAll(updated);

    // Only fixture 2 changed
    expect(diffs).toHaveLength(1);
    expect(diffs[0].fixtureId).toBe(2);
    expect(diffs[0].newEvents).toHaveLength(1);
    expect(diffs[0].scoreChanged).toBe(true);
  });

  test('clear resets all state', () => {
    const entries = [makeEntry(1, [{ type: 'Goal', minute: 23, playerExternalId: 101 }])];
    diffAll(entries); // seed (emits the initial diff)

    clear();

    const diffs = diffAll(entries);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].initial).toBe(true);
    expect(diffs[0].newEvents).toEqual([]);
  });

  describe('elapsed tracking', () => {
    test('elapsed change with no events or score change emits diff', () => {
      const seed = [makeEntry(1, [], { home: 1, away: 0 }, 23)];
      diffAll(seed);

      const updated = [makeEntry(1, [], { home: 1, away: 0 }, 24)];
      const diffs = diffAll(updated);

      expect(diffs).toHaveLength(1);
      expect(diffs[0].elapsedChanged).toBe(true);
      expect(diffs[0].elapsed).toBe(24);
      expect(diffs[0].scoreChanged).toBe(false);
      expect(diffs[0].newEvents).toEqual([]);
    });

    test('elapsed unchanged with no events or score emits nothing', () => {
      const seed = [makeEntry(1, [], { home: 1, away: 0 }, 30)];
      diffAll(seed);

      const same = [makeEntry(1, [], { home: 1, away: 0 }, 30)];
      const diffs = diffAll(same);

      expect(diffs).toEqual([]);
    });

    test('both elapsed and score change emits single diff with both flags', () => {
      const seed = [makeEntry(1, [], { home: 0, away: 0 }, 44)];
      diffAll(seed);

      const updated = [makeEntry(1, [], { home: 1, away: 0 }, 45)];
      const diffs = diffAll(updated);

      expect(diffs).toHaveLength(1);
      expect(diffs[0].scoreChanged).toBe(true);
      expect(diffs[0].elapsedChanged).toBe(true);
      expect(diffs[0].elapsed).toBe(45);
    });

    test('first poll seeds elapsed and emits an initial diff echoing the seeded elapsed', () => {
      const seed = [makeEntry(1, [], { home: 0, away: 0 }, 10)];
      const diffs = diffAll(seed);

      expect(diffs).toHaveLength(1);
      expect(diffs[0]).toMatchObject({
        initial: true,
        elapsedChanged: false,
        elapsed: 10,
        newEvents: [],
      });
    });

    test('elapsed transitions from number to null (halftime)', () => {
      const seed = [makeEntry(1, [], { home: 1, away: 0 }, 45)];
      diffAll(seed);

      const halftime = [makeEntry(1, [], { home: 1, away: 0 }, null)];
      const diffs = diffAll(halftime);

      expect(diffs).toHaveLength(1);
      expect(diffs[0].elapsedChanged).toBe(true);
      expect(diffs[0].elapsed).toBe(null);
    });

    test('elapsed stays null across consecutive polls (no diff)', () => {
      const seed = [makeEntry(1, [], { home: 1, away: 0 }, null)];
      diffAll(seed);

      const same = [makeEntry(1, [], { home: 1, away: 0 }, null)];
      const diffs = diffAll(same);

      expect(diffs).toEqual([]);
    });

    test('elapsed transitions from null to number (second half start)', () => {
      const seed = [makeEntry(1, [], { home: 1, away: 0 }, null)];
      diffAll(seed);

      const secondHalf = [makeEntry(1, [], { home: 1, away: 0 }, 46)];
      const diffs = diffAll(secondHalf);

      expect(diffs).toHaveLength(1);
      expect(diffs[0].elapsedChanged).toBe(true);
      expect(diffs[0].elapsed).toBe(46);
    });
  });

  describe('buildMatchEndDiff', () => {
    test('returns diff with matchEnded true and scoreChanged true', () => {
      const data = {
        finalScore: { home: 2, away: 1 },
        events: [
          { type: 'Goal', minute: 23, playerName: 'Scorer A' },
          { type: 'Goal', minute: 55, playerName: 'Scorer B' },
        ],
      };

      const diff = buildMatchEndDiff(7, data);

      expect(diff.fixtureId).toBe(7);
      expect(diff.matchEnded).toBe(true);
      expect(diff.scoreChanged).toBe(true);
      expect(diff.elapsedChanged).toBe(false);
      expect(diff.elapsed).toBe(null);
      expect(diff.currentScore).toEqual({ home: 2, away: 1 });
      // Events are NOT included - they were already broadcast during the live phase
      expect(diff.newEvents).toEqual([]);
    });

    test('returns correct structure with empty events', () => {
      const data = {
        finalScore: { home: 0, away: 0 },
        events: [],
      };

      const diff = buildMatchEndDiff(3, data);

      expect(diff.fixtureId).toBe(3);
      expect(diff.matchEnded).toBe(true);
      expect(diff.scoreChanged).toBe(true);
      expect(diff.newEvents).toEqual([]);
      expect(diff.currentScore).toEqual({ home: 0, away: 0 });
    });

    test('handles missing finalScore and events gracefully', () => {
      const diff = buildMatchEndDiff(5, {});

      expect(diff.fixtureId).toBe(5);
      expect(diff.matchEnded).toBe(true);
      expect(diff.scoreChanged).toBe(true);
      expect(diff.currentScore).toEqual({ home: null, away: null });
      expect(diff.newEvents).toEqual([]);
    });
  });
});
