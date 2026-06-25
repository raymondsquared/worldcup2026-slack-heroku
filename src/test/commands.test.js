'use strict';

jest.mock('../highlights/query', () => ({
  getLatestHighlights: jest.fn(),
}));

const {
  register,
  scheduleBlocks,
  groupsBlocks,
  highlightsBlocks,
} = require('../commands/worldcup');
const { setLiveCache } = require('../data');
const { getLatestHighlights } = require('../highlights/query');

describe('worldcup command - register', () => {
  let handler;
  const mockApp = {
    command: jest.fn((cmd, fn) => {
      handler = fn;
    }),
  };

  beforeAll(() => {
    register(mockApp);
  });

  test('registers /worldcup2026 command', () => {
    expect(mockApp.command).toHaveBeenCalledWith('/worldcup2026', expect.any(Function));
  });

  test('ack is called immediately', async () => {
    const ack = jest.fn();
    const respond = jest.fn();
    await handler({ command: { text: 'schedule' }, ack, respond });
    expect(ack).toHaveBeenCalled();
  });

  test('schedule subcommand responds with blocks', async () => {
    const ack = jest.fn();
    const respond = jest.fn();
    await handler({ command: { text: 'schedule' }, ack, respond });
    expect(respond).toHaveBeenCalledWith({ blocks: expect.any(Array) });
  });

  test('groups subcommand responds with blocks', async () => {
    const ack = jest.fn();
    const respond = jest.fn();
    await handler({ command: { text: 'groups' }, ack, respond });
    expect(respond).toHaveBeenCalledWith({ blocks: expect.any(Array) });
  });

  test('highlights subcommand responds with blocks', async () => {
    getLatestHighlights.mockReturnValue([
      {
        fixture: { id: 1, teams: { homeTeamId: 'MEX', awayTeamId: 'RSA' } },
        url: 'https://youtube.com/watch?v=abc',
        title: 'Highlights | Mexico vs South Africa',
      },
    ]);

    const ack = jest.fn();
    const respond = jest.fn();
    await handler({ command: { text: 'highlights' }, ack, respond });
    expect(respond).toHaveBeenCalledWith({ blocks: expect.any(Array) });

    const blocks = respond.mock.calls[0][0].blocks;
    expect(blocks[0].type).toBe('header');
    expect(blocks[0].text.text).toContain('Highlights');
  });

  test('unknown subcommand responds with help text', async () => {
    const ack = jest.fn();
    const respond = jest.fn();
    await handler({ command: { text: 'unknown' }, ack, respond });
    expect(respond).toHaveBeenCalledWith({
      text: expect.stringContaining('highlights'),
    });
  });

  test('empty subcommand responds with help text', async () => {
    const ack = jest.fn();
    const respond = jest.fn();
    await handler({ command: { text: '' }, ack, respond });
    expect(respond).toHaveBeenCalledWith({
      text: expect.stringContaining('highlights'),
    });
  });
});

describe('scheduleBlocks', () => {
  test('returns header and fixture sections with team names', () => {
    const blocks = scheduleBlocks();
    expect(blocks[0].text.text).toBe('📅 Upcoming Fixtures');

    const fixtureText = blocks[1].text.text;
    expect(fixtureText).not.toContain('homeTeamId');
    expect(fixtureText).toContain(' vs ');
  });

  test('includes Slack date formatting in the context line', () => {
    const blocks = scheduleBlocks();
    // Each fixture renders a section (teams) followed by a context (time)
    const contextText = blocks
      .filter((b) => b.type === 'context')
      .map((b) => b.elements[0].text)
      .join(' ');

    expect(contextText).toMatch(/<!date\^\d+\^/);
  });

  test('includes a shared UTC reference alongside the localized time', () => {
    const blocks = scheduleBlocks();
    const contextText = blocks
      .filter((b) => b.type === 'context')
      .map((b) => b.elements[0].text)
      .join(' ');

    // Fixed UTC anchor, e.g. "19:00 UTC"
    expect(contextText).toMatch(/\d{2}:\d{2} UTC/);
  });

  test('renders a flag for each team in upcoming fixtures', () => {
    const blocks = scheduleBlocks();
    const fixtureSection = blocks.find((b) => b.type === 'section' && b.text.text.includes(' vs '));
    // Flag emoji are regional indicator pairs (U+1F1E6..U+1F1FF)
    expect(fixtureSection.text.text).toMatch(/[\u{1F1E6}-\u{1F1FF}]/u);
  });
});

describe('scheduleBlocks - Live Now section', () => {
  afterEach(() => {
    setLiveCache(null);
    jest.useRealTimers();
  });

  // Fixture 1 is Mexico vs South Africa; mock its live cache entry.
  function mockLive(entries) {
    setLiveCache({ getFixture: (id) => entries[id] || null });
  }

  test('shows Live Now header and score line when matches are live', () => {
    mockLive({ 1: { status: 'Second Half', elapsed: 67, finalScore: { home: 2, away: 1 } } });

    const blocks = scheduleBlocks();
    expect(blocks[0].text.text).toBe('🟢 Live Now');

    // Score on the section, status/elapsed on the following context line
    const liveText = blocks[1].text.text;
    expect(liveText).toContain('Mexico');
    expect(liveText).toContain('South Africa');
    expect(liveText).toContain('2 - 1');

    const statusText = blocks[2].elements[0].text;
    expect(statusText).toContain("Second Half (67')");
  });

  test('shows a divider between live and upcoming sections', () => {
    // Real timers: the committed schedule still has upcoming fixtures.
    mockLive({ 1: { status: 'Second Half', elapsed: 67, finalScore: { home: 2, away: 1 } } });

    const blocks = scheduleBlocks();
    const types = blocks.map((b) => b.type);
    expect(types).toContain('divider');

    const dividerIdx = types.indexOf('divider');
    const upcomingHeader = blocks.slice(dividerIdx).find((b) => b.type === 'header');
    expect(upcomingHeader.text.text).toBe('📅 Upcoming Fixtures');
  });

  test('shows only upcoming (no Live Now header) when nothing is live', () => {
    setLiveCache(null);

    const blocks = scheduleBlocks();
    const headers = blocks.filter((b) => b.type === 'header').map((b) => b.text.text);
    expect(headers).not.toContain('🟢 Live Now');
    expect(headers).toContain('📅 Upcoming Fixtures');
  });

  test('renders Halftime (elapsed null) with no empty parentheses', () => {
    mockLive({ 1: { status: 'Halftime', elapsed: null, finalScore: { home: 0, away: 0 } } });

    const statusText = scheduleBlocks()[2].elements[0].text;
    expect(statusText).toContain('Halftime');
    expect(statusText).not.toContain('()');
    expect(statusText).not.toContain('null');
  });

  test('includes the staleness note when live data is stale', () => {
    mockLive({
      1: { status: 'First Half', elapsed: 30, finalScore: { home: 0, away: 0 }, stale: true },
    });

    const statusText = scheduleBlocks()[2].elements[0].text;
    expect(statusText).toContain('_(data may be outdated)_');
  });

  test('still renders the live section when there are zero upcoming fixtures', () => {
    // Pin the clock past the tournament so getUpcomingFixtures() returns [].
    jest.useFakeTimers().setSystemTime(new Date('2026-08-01T00:00:00Z'));
    mockLive({ 1: { status: 'Second Half', elapsed: 67, finalScore: { home: 2, away: 1 } } });

    const blocks = scheduleBlocks();
    const headers = blocks.filter((b) => b.type === 'header').map((b) => b.text.text);
    expect(headers).toContain('🟢 Live Now');
    expect(headers).not.toContain('📅 Upcoming Fixtures');
    expect(blocks.map((b) => b.type)).not.toContain('divider');
  });
});

describe('groupsBlocks', () => {
  test('returns header and group sections with team names', () => {
    const blocks = groupsBlocks();
    expect(blocks[0].text.text).toBe('🏆 Tournament Groups');

    const groupSection = blocks.find((b) => b.type === 'section' && b.text.text.includes('Group'));
    expect(groupSection.text.text).toContain('Group');
  });

  test('contains actual team names', () => {
    const blocks = groupsBlocks();
    const allText = blocks
      .filter((b) => b.type === 'section')
      .map((b) => b.text.text)
      .join(' ');
    expect(allText).toContain('USA');
    expect(allText).toContain('Brazil');
  });

  test('orders groups alphabetically (Group A first, not insertion order)', () => {
    const blocks = groupsBlocks();
    const groupSections = blocks
      .filter((b) => b.type === 'section')
      .map((b) => b.text.text.split('\n')[0]); // first line is the *Group X* heading

    expect(groupSections[0]).toContain('Group A');
    // Verify the sequence is sorted
    const sorted = [...groupSections].sort();
    expect(groupSections).toEqual(sorted);
  });

  test('puts a divider before each group section', () => {
    const blocks = groupsBlocks();
    expect(blocks.map((b) => b.type)).toContain('divider');
  });

  test('renders flags and standings (rank, pts, GD) for teams', () => {
    const blocks = groupsBlocks();
    const allText = blocks
      .filter((b) => b.type === 'section')
      .map((b) => b.text.text)
      .join('\n');

    // Flag emoji present
    expect(allText).toMatch(/[\u{1F1E6}-\u{1F1FF}]/u);
    // Standings format: "`1.` 🇲🇽 Mexico - 3 pts (+2)"
    expect(allText).toMatch(/`1\.`/);
    expect(allText).toMatch(/\d+ pts? \([+\-±]/);
  });

  test('sorts teams within a group by rank ascending', () => {
    const blocks = groupsBlocks();
    const groupSection = blocks.find(
      (b) => b.type === 'section' && b.text.text.startsWith('*Group A*'),
    );
    const lines = groupSection.text.text.split('\n').slice(1); // drop heading
    const ranks = lines.map((l) => Number(l.match(/`(\d+)\./)[1]));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });
});

describe('highlightsBlocks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns match cards with header, divider, and footer when highlights exist', () => {
    // Use real fixture ids + teams (1 = MEX/RSA, 2 = KOR/CZE) so the data that
    // buildMatchBlocks re-fetches via getFixtureById matches the mocked input.
    getLatestHighlights.mockReturnValue([
      {
        fixture: { id: 1, teams: { homeTeamId: 'MEX', awayTeamId: 'RSA' } },
        url: 'https://youtube.com/watch?v=abc',
        title: 'Highlights | Mexico vs South Africa',
      },
      {
        fixture: { id: 2, teams: { homeTeamId: 'KOR', awayTeamId: 'CZE' } },
        url: 'https://youtube.com/watch?v=def',
        title: 'Highlights | South Korea vs Czechia',
      },
    ]);

    const blocks = highlightsBlocks();

    // header + divider + 2 match sections + divider + context
    expect(blocks).toHaveLength(6);
    expect(blocks[0].type).toBe('header');
    expect(blocks[0].text.text).toContain('Recent Highlights');
    expect(blocks[1].type).toBe('divider');
    expect(blocks[2].type).toBe('section');
    expect(blocks[2].accessory.type).toBe('button');
    expect(blocks[3].type).toBe('section');
    expect(blocks[4].type).toBe('divider');
    expect(blocks[5].type).toBe('context');
    expect(blocks[5].elements[0].text).toContain('2 matches');

    // Content matches the real fixture rows (names/score from getFixtureById)
    expect(blocks[2].text.text).toContain('Mexico');
    expect(blocks[2].text.text).toContain('South Africa');
    expect(blocks[3].text.text).toContain('South Korea');
    expect(blocks[3].text.text).toContain('Czechia');
    // KOR vs CZE real finalScore is 2-1 - input and re-fetched data agree
    expect(blocks[3].text.text).toContain('2 - 1');
  });

  test('returns friendly message when no highlights available', () => {
    getLatestHighlights.mockReturnValue([]);

    const blocks = highlightsBlocks();

    expect(blocks).toHaveLength(1);
    expect(blocks[0].text.text).toContain('No highlights available');
  });

  test('singular "match" label for single highlight', () => {
    getLatestHighlights.mockReturnValue([
      {
        fixture: { id: 1, teams: { homeTeamId: 'MEX', awayTeamId: 'RSA' } },
        url: 'https://youtube.com/watch?v=abc',
        title: 'Highlights | Mexico vs South Africa',
      },
    ]);

    const blocks = highlightsBlocks();
    const footer = blocks[blocks.length - 1];

    expect(footer.elements[0].text).toContain('1 match');
    expect(footer.elements[0].text).not.toContain('1 matches');
  });
});
