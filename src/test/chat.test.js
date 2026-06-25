'use strict';

// Set env before requiring modules that read it
process.env.BROADCAST_CHANNEL_ID = 'C_BROADCAST';

jest.mock('../mia', () => ({ ask: jest.fn() }));
jest.mock('../handlers/match-context', () => ({ buildMatchContext: jest.fn() }));

const { ask } = require('../mia');
const { buildMatchContext } = require('../handlers/match-context');
const { register, stripMention, detectMatchFromThread } = require('../handlers/chat');

const BROADCAST_CHANNEL = 'C_BROADCAST';

describe('chat handlers - register', () => {
  let mentionHandler;
  let messageHandler;
  const mockApp = {
    event: jest.fn((name, fn) => {
      if (name === 'app_mention') mentionHandler = fn;
    }),
    message: jest.fn((fn) => {
      messageHandler = fn;
    }),
  };

  beforeAll(() => {
    register(mockApp);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Stub client that returns no metadata by default
  function makeClient(metadata = undefined) {
    return {
      conversations: {
        history: jest.fn().mockResolvedValue({
          messages: [{ ts: '100.000', metadata }],
        }),
      },
    };
  }

  describe('app_mention - general (no thread context)', () => {
    test('replies in thread with AI response', async () => {
      ask.mockResolvedValue('The next match is USA vs Mexico.');
      const say = jest.fn();
      const client = makeClient();
      const event = { text: '<@U123> when does USA play?', ts: '123.456', channel: 'C_OTHER' };

      await mentionHandler({ event, say, client });

      expect(ask).toHaveBeenCalledWith('when does USA play?');
      expect(say).toHaveBeenCalledWith({
        text: 'The next match is USA vs Mexico.',
        thread_ts: '123.456',
      });
    });

    test('continues existing thread (non-broadcast channel)', async () => {
      ask.mockResolvedValue('Answer');
      const say = jest.fn();
      const client = makeClient();
      const event = {
        text: '<@U123> question',
        ts: '200.000',
        thread_ts: '100.000',
        channel: 'C_OTHER',
      };

      await mentionHandler({ event, say, client });

      // Should NOT call conversations.history for non-broadcast channel
      expect(client.conversations.history).not.toHaveBeenCalled();
      expect(ask).toHaveBeenCalledWith('question');
      expect(say).toHaveBeenCalledWith({
        text: 'Answer',
        thread_ts: '100.000',
      });
    });

    test('responds with error message on failure', async () => {
      ask.mockRejectedValue(new Error('MIA down'));
      const say = jest.fn();
      const client = makeClient();
      const event = { text: '<@U123> hi', ts: '123.456', channel: 'C_OTHER' };

      await mentionHandler({ event, say, client });

      expect(say).toHaveBeenCalledWith({
        text: 'Sorry, something went wrong. Please try again.',
        thread_ts: '123.456',
      });
    });
  });

  describe('app_mention - thread-grounded AI', () => {
    test('detects match from broadcast thread and uses match context with persona', async () => {
      const client = makeClient({
        event_type: 'worldcup_match',
        event_payload: { matchId: 101, persona: 'sporty' },
      });
      buildMatchContext.mockReturnValue('Match: Mexico vs South Africa\nScore: 2-1');
      ask.mockResolvedValue('Mexico is winning 2-1');
      const say = jest.fn();

      const event = {
        text: '<@U123> what is the score?',
        ts: '200.000',
        thread_ts: '100.000',
        channel: BROADCAST_CHANNEL,
      };

      await mentionHandler({ event, say, client });

      expect(client.conversations.history).toHaveBeenCalledWith({
        channel: BROADCAST_CHANNEL,
        latest: '100.000',
        limit: 1,
        inclusive: true,
        include_all_metadata: true,
      });
      expect(buildMatchContext).toHaveBeenCalledWith(101);
      expect(ask).toHaveBeenCalledWith('what is the score?', {
        context: 'Match: Mexico vs South Africa\nScore: 2-1',
        persona: 'sporty',
      });
      expect(say).toHaveBeenCalledWith({
        text: 'Mexico is winning 2-1',
        thread_ts: '100.000',
      });
    });

    test('passes persona even when buildMatchContext returns null', async () => {
      const client = makeClient({
        event_type: 'worldcup_match',
        event_payload: { matchId: 999, persona: 'funny' },
      });
      buildMatchContext.mockReturnValue(null);
      ask.mockResolvedValue("I don't have info on that match.");
      const say = jest.fn();

      const event = {
        text: '<@U123> what is the score?',
        ts: '200.000',
        thread_ts: '100.000',
        channel: BROADCAST_CHANNEL,
      };

      await mentionHandler({ event, say, client });

      expect(buildMatchContext).toHaveBeenCalledWith(999);
      expect(ask).toHaveBeenCalledWith('what is the score?', { persona: 'funny' });
    });

    test('legacy metadata without persona passes persona as null', async () => {
      const client = makeClient({
        event_type: 'worldcup_match',
        event_payload: { matchId: 101 },
      });
      buildMatchContext.mockReturnValue('Match context');
      ask.mockResolvedValue('Answer');
      const say = jest.fn();

      const event = {
        text: '<@U123> hello',
        ts: '200.000',
        thread_ts: '100.000',
        channel: BROADCAST_CHANNEL,
      };

      await mentionHandler({ event, say, client });

      expect(ask).toHaveBeenCalledWith('hello', { context: 'Match context', persona: null });
    });

    test('falls back to general grounding when no metadata on parent', async () => {
      const client = makeClient(undefined); // no metadata
      ask.mockResolvedValue('General answer');
      const say = jest.fn();

      const event = {
        text: '<@U123> hello',
        ts: '200.000',
        thread_ts: '100.000',
        channel: BROADCAST_CHANNEL,
      };

      await mentionHandler({ event, say, client });

      expect(client.conversations.history).toHaveBeenCalled();
      expect(buildMatchContext).not.toHaveBeenCalled();
      expect(ask).toHaveBeenCalledWith('hello');
    });

    test('falls back to general grounding in non-broadcast channel thread', async () => {
      const client = makeClient({
        event_type: 'worldcup_match',
        event_payload: { matchId: 101 },
      });
      ask.mockResolvedValue('General answer');
      const say = jest.fn();

      const event = {
        text: '<@U123> hello',
        ts: '200.000',
        thread_ts: '100.000',
        channel: 'C_RANDOM', // NOT broadcast channel
      };

      await mentionHandler({ event, say, client });

      // Should NOT call conversations.history for wrong channel
      expect(client.conversations.history).not.toHaveBeenCalled();
      expect(buildMatchContext).not.toHaveBeenCalled();
      expect(ask).toHaveBeenCalledWith('hello');
    });

    test('falls back to general grounding when not in a thread', async () => {
      const client = makeClient();
      ask.mockResolvedValue('General answer');
      const say = jest.fn();

      const event = {
        text: '<@U123> hello',
        ts: '123.456',
        channel: BROADCAST_CHANNEL,
        // no thread_ts
      };

      await mentionHandler({ event, say, client });

      expect(client.conversations.history).not.toHaveBeenCalled();
      expect(buildMatchContext).not.toHaveBeenCalled();
      expect(ask).toHaveBeenCalledWith('hello');
    });

    test('falls back to general grounding when API call fails', async () => {
      const client = {
        conversations: {
          history: jest.fn().mockRejectedValue(new Error('channel_not_found')),
        },
      };
      ask.mockResolvedValue('General answer');
      const say = jest.fn();

      const event = {
        text: '<@U123> hello',
        ts: '200.000',
        thread_ts: '100.000',
        channel: BROADCAST_CHANNEL,
      };

      await mentionHandler({ event, say, client });

      expect(buildMatchContext).not.toHaveBeenCalled();
      expect(ask).toHaveBeenCalledWith('hello');
    });

    test('falls back when matchId is not a number in metadata', async () => {
      const client = makeClient({
        event_type: 'worldcup_match',
        event_payload: { matchId: 'invalid' },
      });
      ask.mockResolvedValue('General answer');
      const say = jest.fn();

      const event = {
        text: '<@U123> hello',
        ts: '200.000',
        thread_ts: '100.000',
        channel: BROADCAST_CHANNEL,
      };

      await mentionHandler({ event, say, client });

      expect(buildMatchContext).not.toHaveBeenCalled();
      expect(ask).toHaveBeenCalledWith('hello');
    });

    test('all guardrails still active (ask called with same input pipeline)', async () => {
      const client = makeClient({
        event_type: 'worldcup_match',
        event_payload: { matchId: 101, persona: 'serious' },
      });
      buildMatchContext.mockReturnValue('Match context');
      ask.mockResolvedValue('Safe answer');
      const say = jest.fn();

      const event = {
        text: '<@U123> <script>alert(1)</script>',
        ts: '200.000',
        thread_ts: '100.000',
        channel: BROADCAST_CHANNEL,
      };

      await mentionHandler({ event, say, client });

      // Text is stripped of mention but passed to ask() where guardrails run
      expect(ask).toHaveBeenCalledWith('<script>alert(1)</script>', {
        context: 'Match context',
        persona: 'serious',
      });
    });
  });

  describe('DM (app.message)', () => {
    test('replies with AI response', async () => {
      ask.mockResolvedValue('World Cup starts June 11.');
      const say = jest.fn();
      const message = { text: 'When does it start?', channel_type: 'im' };

      await messageHandler({ message, say });

      expect(ask).toHaveBeenCalledWith('When does it start?');
      expect(say).toHaveBeenCalledWith('World Cup starts June 11.');
    });

    test('ignores bot messages', async () => {
      const say = jest.fn();
      const message = {
        text: 'bot reply',
        channel_type: 'im',
        bot_id: 'B123',
      };

      await messageHandler({ message, say });

      expect(ask).not.toHaveBeenCalled();
      expect(say).not.toHaveBeenCalled();
    });

    test('ignores non-IM channel messages', async () => {
      const say = jest.fn();
      const message = { text: 'hello', channel_type: 'channel' };

      await messageHandler({ message, say });

      expect(ask).not.toHaveBeenCalled();
      expect(say).not.toHaveBeenCalled();
    });

    test('responds with error message on failure', async () => {
      ask.mockRejectedValue(new Error('timeout'));
      const say = jest.fn();
      const message = { text: 'hi', channel_type: 'im' };

      await messageHandler({ message, say });

      expect(say).toHaveBeenCalledWith('Sorry, something went wrong. Please try again.');
    });
  });
});

describe('stripMention', () => {
  test('removes bot mention from text', () => {
    expect(stripMention('<@U123ABC> when does USA play?')).toBe('when does USA play?');
  });

  test('removes multiple mentions', () => {
    expect(stripMention('<@U123> <@U456> hello')).toBe('hello');
  });

  test('returns text unchanged if no mention', () => {
    expect(stripMention('just a question')).toBe('just a question');
  });
});

describe('detectMatchFromThread', () => {
  const BROADCAST = 'C_BROADCAST';

  test('returns { matchId, persona } when metadata has both', async () => {
    const client = {
      conversations: {
        history: jest.fn().mockResolvedValue({
          messages: [
            {
              ts: '100.000',
              metadata: {
                event_type: 'worldcup_match',
                event_payload: { matchId: 42, persona: 'sporty' },
              },
            },
          ],
        }),
      },
    };
    const event = { thread_ts: '100.000', channel: BROADCAST };

    const result = await detectMatchFromThread(client, event);

    expect(result).toEqual({ matchId: 42, persona: 'sporty' });
  });

  test('returns { matchId, persona: null } for legacy metadata without persona', async () => {
    const client = {
      conversations: {
        history: jest.fn().mockResolvedValue({
          messages: [
            {
              ts: '100.000',
              metadata: { event_type: 'worldcup_match', event_payload: { matchId: 42 } },
            },
          ],
        }),
      },
    };
    const event = { thread_ts: '100.000', channel: BROADCAST };

    const result = await detectMatchFromThread(client, event);

    expect(result).toEqual({ matchId: 42, persona: null });
  });

  test('returns null when no thread_ts', async () => {
    const client = { conversations: { history: jest.fn() } };
    const event = { channel: BROADCAST }; // no thread_ts

    const result = await detectMatchFromThread(client, event);

    expect(result).toBeNull();
    expect(client.conversations.history).not.toHaveBeenCalled();
  });

  test('returns null when channel is not broadcast', async () => {
    const client = { conversations: { history: jest.fn() } };
    const event = { thread_ts: '100.000', channel: 'C_RANDOM' };

    const result = await detectMatchFromThread(client, event);

    expect(result).toBeNull();
    expect(client.conversations.history).not.toHaveBeenCalled();
  });

  test('returns null on API error', async () => {
    const client = {
      conversations: {
        history: jest.fn().mockRejectedValue(new Error('missing_scope')),
      },
    };
    const event = { thread_ts: '100.000', channel: BROADCAST };

    const result = await detectMatchFromThread(client, event);

    expect(result).toBeNull();
  });
});
