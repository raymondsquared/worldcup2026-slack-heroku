'use strict';

const { chat, chatWithTools, chatWithAgent } = require('./client');
const { maskPii, demaskPii, sanitizeInput, filterToxic, TOXIC_REPLY } = require('./guardrails');
const { logInteraction } = require('./audit');
const { isFootballRelated: isFootballRelatedKeyword } = require('./scope');
const {
  getSystemPrompt,
  CONFIDENCE_THRESHOLD,
  FOOTBALL_RELATED_THRESHOLD,
  REFERENCE_INSTRUCTION,
  TOOL_INSTRUCTION,
} = require('./personas');
const { isLowConfidence } = require('./low-confidence');
const { webSearch } = require('../web-search');
const { TOOL_SCHEMAS, dispatchTool, safeParseArgs } = require('./tools');

// Feature flag: MCP tools (/v1/agents/heroku) vs ADR-6 tools (/v1/chat/completions)
const USE_MCP_TOOLS = process.env.USE_MCP_TOOLS === 'true';

const ANSWER_REGEX = /<answer>([\s\S]*?)<\/answer>/;
const CONFIDENCE_REGEX = /<confidenceScore>(\d+)<\/confidenceScore>/;
const FOOTBALL_RELATED_REGEX = /<isFootballRelatedScore>(\d+)<\/isFootballRelatedScore>/;

const MAX_TOOL_ITERS = 4;
const LOOP_BUDGET_IN_MS = 10000;

// Model-driven retrieval: offer the read-only tool catalog and let the model
// choose which to call, executing each via the whitelist `dispatchTool` and
// feeding `role: tool` results back until it returns a final answer. This is
// the primary retrieval path. Returns null when no tool grounded an answer
// (no tool ran, loop exhausted, over budget, or error); the caller then makes a
// direct model call so a question is never dropped.
async function retrieveWithTools(sanitized, systemPrompt) {
  const deadline = Date.now() + LOOP_BUDGET_IN_MS;
  const messages = [
    { role: 'system', content: `${systemPrompt}\n\n${TOOL_INSTRUCTION}` },
    { role: 'user', content: sanitized },
  ];
  const toolsCalled = [];

  try {
    for (let i = 0; i < MAX_TOOL_ITERS; i++) {
      if (Date.now() >= deadline) break; // wall-clock budget exceeded -> direct call

      const msg = await chatWithTools(messages, TOOL_SCHEMAS, { temperature: 0 });

      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        // Model answered without requesting (further) tools.
        if (toolsCalled.length > 0 && msg.content) {
          return { rawOutput: msg.content, toolsCalled };
        }
        return null;
      }

      // Some endpoints reject content:null on re-sent assistant messages.
      // SEE: https://platform.openai.com/docs/guides/function-calling
      const TOOL_CALL_PLACEHOLDER = '.';
      const assistantContent =
        msg.content && msg.content.trim() ? msg.content : TOOL_CALL_PLACEHOLDER;
      messages.push({ role: 'assistant', content: assistantContent, tool_calls: msg.tool_calls });
      for (const call of msg.tool_calls) {
        // The API contract requires every tool_call id to be answered by a
        // matching role:tool message.
        if (!call.id) return null;
        const name = call.function && call.function.name;
        const args = safeParseArgs(call.function && call.function.arguments);
        const result = dispatchTool(name, args); // whitelist only; never throws
        // Record every tool the model invoked, including one that returned an
        // {error} (unknown name or handler failure): toolsCalled is an attempt
        // log of what the model chose, not a success log, so a poorly-fitting or
        // bogus tool pick stays observable in the audit record.
        if (name) toolsCalled.push(name);
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(result),
        });
      }
    }
  } catch (err) {
    console.error('MIA tool loop failed:', err.message);
    return null; // any error -> direct model call
  }

  return null; // loop exhausted without a final answer -> direct model call
}

/**
 * Parse MIA's XML response. Falls back gracefully if tags are missing.
 * Expects: <response><answer>...</answer><confidenceScore>0-100</confidenceScore>
 *          <isFootballRelatedScore>0-100</isFootballRelatedScore></response>
 * Returns: { answer: string, confident: boolean, footballRelated: boolean|null }
 *   footballRelated is true/false from the score vs threshold, or null when the
 *   tag is absent (caller falls back to the keyword check).
 */
function parseResponse(raw) {
  // An empty or non-string completion (e.g. a null/tool-only message) is never
  // a confident answer. Mark it low-confidence so the cascade escalates instead
  // of returning nothing as if it were certain - this also keeps a null result
  // from poisoning the `rawOutput === undefined` escalation guards in ask().
  if (!raw || typeof raw !== 'string') {
    return { answer: '', confident: false, footballRelated: null };
  }

  const footballMatch = FOOTBALL_RELATED_REGEX.exec(raw);
  const footballRelated = footballMatch
    ? Number(footballMatch[1]) >= FOOTBALL_RELATED_THRESHOLD
    : null;

  const answerMatch = ANSWER_REGEX.exec(raw);
  if (answerMatch) {
    const answer = answerMatch[1].trim();
    const confMatch = CONFIDENCE_REGEX.exec(raw);
    const score = confMatch ? Number(confMatch[1]) : 100;
    return { answer, confident: score >= CONFIDENCE_THRESHOLD, footballRelated };
  }
  // If MIA returns plain text without XML tags, treat as confident.
  // Falls back to phrase detection via isLowConfidence().
  return { answer: raw, confident: true, footballRelated };
}

// Assemble the [system, user] pair shared by the explicit-context and
// web-search-retry paths. `context` (when present) is wrapped in the delimited
// Context block so it stays separated from the system instructions (role
// separation = the primary injection defense). Any `extraSystem` segments - the
// web-search results and the citation instruction on the retry - are appended
// to the system turn in order.
function buildMessages(systemPrompt, context, userText, ...extraSystem) {
  let systemContent = systemPrompt + (context ? `\n\nContext:\n---\n${context}\n---` : '');
  for (const extra of extraSystem) {
    systemContent += `\n\n${extra}`;
  }
  return [
    { role: 'system', content: systemContent },
    { role: 'user', content: userText },
  ];
}

async function ask(userText, opts = {}) {
  // Support legacy positional call: ask(text, contextString)
  const options = typeof opts === 'string' ? { context: opts } : opts;
  const { context = '', persona = null } = options;

  if (options.recap) {
    const recapMessages = [
      {
        role: 'system',
        content: options.systemOverride + '\n\nContext:\n---\n' + context + '\n---',
      },
      { role: 'user', content: userText },
    ];
    const rawOutput = await chat(recapMessages, { temperature: 0 });
    const filtered = filterToxic(rawOutput);
    logInteraction({ input: '[recap]', output: filtered.text, retrievalPath: 'recap' });
    if (!filtered.safe) return null;
    return filtered.text;
  }

  // 1. Mask PII (keep map for demasking the response)
  const { masked, map } = maskPii(userText);

  // 2. Sanitize
  const sanitized = sanitizeInput(masked);

  // 3. Filter toxic input (reject before calling MIA)
  const inputCheck = filterToxic(sanitized);
  if (!inputCheck.safe) {
    logInteraction({ input: masked, output: inputCheck.text, retrievalPath: 'blocked' });
    return inputCheck.text;
  }

  // 4. Retrieve + answer. The model-driven tool loop is the primary retriever:
  // it reads the question, picks read-only tools, and grounds its own answer in
  // live data. When the caller already supplies authoritative data (an explicit
  // thread match context, e.g. live score/events), we skip the tools and answer
  // from that context in a single call. Either way the answer self-rates its
  // confidence (personas BASE_INSTRUCTION step 4); a low-confidence on-topic
  // answer escalates to web search.
  const systemPrompt = getSystemPrompt(persona);

  let rawOutput;
  let parsed;
  let retrievalPath;
  let toolsCalled = null;

  // (a) Caller-supplied context is authoritative: answer from it in one call.
  // Role separation (the delimited Context block) is the primary injection
  // defense; temperature 0 keeps it deterministic.
  if (context) {
    rawOutput = await chat(buildMessages(systemPrompt, context, sanitized), { temperature: 0 });
    retrievalPath = 'context';
    parsed = parseResponse(rawOutput);
  } else if (USE_MCP_TOOLS) {
    // (b) MCP agent endpoint with automatic tool execution
    try {
      const messages = buildMessages(systemPrompt, '', sanitized);
      rawOutput = await chatWithAgent(messages, { enableMcp: true });
      retrievalPath = 'mcp_agent';
      toolsCalled = ['mcp-football'];
      parsed = parseResponse(rawOutput);
    } catch (err) {
      console.error('MCP agent call failed, falling back to direct:', err.message);
      rawOutput = await chat(buildMessages(systemPrompt, '', sanitized), { temperature: 0 });
      retrievalPath = 'direct';
      parsed = parseResponse(rawOutput);
    }
  } else {
    // (c) ADR-6 tool loop
    const toolResult = await retrieveWithTools(sanitized, systemPrompt);
    if (toolResult) {
      rawOutput = toolResult.rawOutput;
      toolsCalled = toolResult.toolsCalled;
      retrievalPath = 'tool_call';
      parsed = parseResponse(rawOutput);
    } else {
      // Safety net: the tool loop grounded nothing (no tool ran, exhausted, over
      // budget, or error). Make a direct call so a question is never dropped.
      rawOutput = await chat(buildMessages(systemPrompt, '', sanitized), { temperature: 0 });
      retrievalPath = 'direct';
      parsed = parseResponse(rawOutput);
    }
  }

  const lowConfidence = !parsed.confident || isLowConfidence(parsed.answer);

  // (c) ESCALATE to web search if the answer is low confidence and on-topic.
  let finalOutput = parsed.answer;
  const footballRelated = parsed.footballRelated === true || isFootballRelatedKeyword(sanitized);
  if (lowConfidence && footballRelated) {
    try {
      const searchContext = await webSearch(sanitized);
      if (searchContext) {
        const augmentedMessages = buildMessages(
          systemPrompt,
          context,
          sanitized,
          searchContext,
          REFERENCE_INSTRUCTION,
        );
        const retryOutput = await chat(augmentedMessages, { temperature: 0 });
        const retryParsed = parseResponse(retryOutput);
        finalOutput = retryParsed.answer;
        retrievalPath = 'web_search';
      }
    } catch (err) {
      console.error('Web search fallback failed:', err.message);
    }
  }

  // 5. Filter toxic output. Read `.safe` explicitly (like the input and recap
  // paths) rather than relying on filterToxic having swapped the text - the
  // canned reply replaces a toxic answer at the output boundary.
  const filtered = filterToxic(finalOutput);
  const safeOutput = filtered.safe ? filtered.text : TOXIC_REPLY;

  // 6. Demask PII in response (restore originals for the user)
  const demasked = demaskPii(safeOutput, map);

  // 7. Log (with masked values for audit safety). retrievalPath records which
  // path produced the answer (tool_call / context / direct / web_search) so the
  // web-search fallback rate is observable and SC-8 is measurable.
  logInteraction({ input: masked, output: safeOutput, retrievalPath, toolsCalled });

  return demasked;
}

module.exports = { ask };
