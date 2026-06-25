'use strict';

// Audit trail for every MIA interaction (trust-layer control).
// `retrievalPath` is one of:
//   'context'    - answered from caller-supplied context in a single call
//   'tool_call'  - the model-driven tool loop produced the answer
//   'direct'     - safety-net direct call (tool loop grounded nothing)
//   'web_search' - the low-confidence web-search fallback produced the answer
//   'blocked'    - toxic input rejected before any retrieval ran
//   'recap'      - recap mode (bypasses the grounding pipeline by design)
function logInteraction({ input, output, timestamp, retrievalPath, toolsCalled }) {
  const entry = {
    event: 'mia_interaction',
    timestamp: timestamp || new Date().toISOString(),
    input,
    output,
  };
  if (retrievalPath) entry.retrievalPath = retrievalPath;
  if (toolsCalled && toolsCalled.length) entry.toolsCalled = toolsCalled;
  console.log(JSON.stringify(entry));
}

module.exports = { logInteraction };
