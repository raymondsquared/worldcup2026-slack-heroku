'use strict';

const { chat, chatWithTools, chatWithAgent } = require('./client');
const { maskPii, demaskPii, sanitizeInput, filterToxic, TOXIC_REPLY } = require('./guardrails');
const { logInteraction } = require('./audit');
const { isFootballRelated: isFootballRelatedKeyword } = require('./scope');
const {
  getSystemPrompt,
  REFERENCE_INSTRUCTION,
  LOCAL_TOOL_INSTRUCTION,
  MCP_TOOL_INSTRUCTION,
} = require('./personas');
const { isLowConfidence } = require('./low-confidence');
const { webSearch } = require('../web-search');
const { TOOL_SCHEMAS, dispatchTool, safeParseArgs } = require('./tools');

// Feature flag: MCP tools (/v1/agents/heroku) vs ADR-6 tools (/v1/chat/completions)
const USE_MCP_TOOLS = process.env.USE_MCP_TOOLS === 'true';

const ANSWER_REGEX = /<answer>([\s\S]*?)<\/answer>/;
const CONFIDENCE_REGEX = /<confidenceLabel>\s*(HIGH|MEDIUM|LOW)\s*<\/confidenceLabel>/i;
const FOOTBALL_RELATED_REGEX =
  /<footballRelatedLabel>\s*(HIGH|MEDIUM|LOW)\s*<\/footballRelatedLabel>/i;

const LOCAL_TOOL_LOOP_MAX_ITERATIONS = 4;
const LOCAL_TOOL_LOOP_BUDGET_IN_MS = 10000;

// Primary retrieval path: offer the read-only tool catalog, run each pick
// via the whitelist `dispatchTool`, and feed `role: tool` results back until a
// final answer. Returns null when nothing grounded an answer (no tool ran,
// exhausted, over budget, or error) so the caller can make a direct call.
async function retrieveWithTools(sanitized, systemPrompt) {
  const deadline = Date.now() + LOCAL_TOOL_LOOP_BUDGET_IN_MS;
  const messages = [
    {
      role: 'system',
      content: `${systemPrompt}\n\n<tool_instructions>\n${LOCAL_TOOL_INSTRUCTION}\n</tool_instructions>`,
    },
    { role: 'user', content: sanitized },
  ];
  const toolsCalled = [];

  try {
    for (let i = 0; i < LOCAL_TOOL_LOOP_MAX_ITERATIONS; i++) {
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
        // Log every tool the model invoked, even one returning {error}:
        // toolsCalled is an attempt log (what the model chose), not a success
        // log, so bogus picks stay observable in the audit record.
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
 * Parse MIA's XML response; falls back gracefully if tags are missing.
 * Expects: <output><answer>...</answer><confidenceLabel>HIGH|MEDIUM|LOW</confidenceLabel>
 *          <footballRelatedLabel>HIGH|MEDIUM|LOW</footballRelatedLabel></output>
 * Returns { answer, confident, footballRelated }: confident/footballRelated are
 * true only for HIGH; footballRelated is null when the tag is absent (caller
 * then falls back to the keyword check).
 */
function parseResponse(raw) {
  // An empty/non-string completion (e.g. a tool-only message) is never a
  // confident answer: mark it low-confidence so the cascade escalates instead
  // of returning nothing as if certain.
  if (!raw || typeof raw !== 'string') {
    return { answer: '', confident: false, footballRelated: null };
  }

  const footballMatch = FOOTBALL_RELATED_REGEX.exec(raw);
  const footballRelated = footballMatch ? footballMatch[1].toUpperCase() === 'HIGH' : null;

  const answerMatch = ANSWER_REGEX.exec(raw);
  if (answerMatch) {
    const answer = answerMatch[1].trim();
    const confMatch = CONFIDENCE_REGEX.exec(raw);
    // Missing/unparseable label defaults to HIGH (confident) to preserve the
    // legacy "answer present but no confidence tag = confident" behavior.
    const label = confMatch ? confMatch[1].toUpperCase() : 'HIGH';
    return { answer, confident: label === 'HIGH', footballRelated };
  }
  // If MIA returns plain text without XML tags, treat as confident.
  // Falls back to phrase detection via isLowConfidence().
  return { answer: raw, confident: true, footballRelated };
}

// Assemble the [system, user] pair for the context and web-search-retry paths.
// `context` is wrapped in a <context> tag so it stays separated from the system
// instructions (role separation = the primary injection defense). `extraSystem`
// segments are appended to the system turn in order.
function buildMessages(systemPrompt, context, userText, ...extraSystem) {
  let systemContent = systemPrompt + (context ? `\n\n<context>\n${context}\n</context>` : '');
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
        content: options.systemOverride + '\n\n<context>\n' + context + '\n</context>',
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

  // 4. Retrieve + answer. The tool loop is the primary retriever; when the
  // caller supplies authoritative context (e.g. a live thread match) we skip
  // tools and answer from it directly. Either way the answer self-rates its
  // confidence, and a low-confidence on-topic answer escalates to web search.
  const systemPrompt = getSystemPrompt(persona);

  let rawOutput;
  let parsed;
  let retrievalPath;
  let toolsCalled = null;

  // (a) Caller-supplied context is authoritative: answer from it in one call.
  // Role separation (the <context> block) is the primary injection defense;
  // temperature 0 keeps it deterministic.
  if (context) {
    rawOutput = await chat(buildMessages(systemPrompt, context, sanitized), { temperature: 0 });
    retrievalPath = 'context';
    parsed = parseResponse(rawOutput);
  } else if (USE_MCP_TOOLS) {
    // (b) MCP agent endpoint with automatic tool execution
    try {
      const messages = buildMessages(
        `${systemPrompt}\n\n<tool_instructions>\n${MCP_TOOL_INSTRUCTION}\n</tool_instructions>`,
        '',
        sanitized,
      );
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
          `<search_results>\n${searchContext}\n</search_results>`,
          `<citation_instructions>\n${REFERENCE_INSTRUCTION}\n</citation_instructions>`,
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

  // 5. Filter toxic output: read `.safe` explicitly and swap in the canned
  // reply at the output boundary.
  const filtered = filterToxic(finalOutput);
  const safeOutput = filtered.safe ? filtered.text : TOXIC_REPLY;

  // 6. Demask PII in response (restore originals for the user)
  const demasked = demaskPii(safeOutput, map);

  // 7. Log with masked values for audit safety. retrievalPath records which
  // path produced the answer so the web-search fallback rate is observable
  // (SC-8).
  logInteraction({ input: masked, output: safeOutput, retrievalPath, toolsCalled });

  return demasked;
}

module.exports = { ask };
