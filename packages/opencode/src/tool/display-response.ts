import { Effect, Schema } from "effect"
import * as Tool from "./tool"

// Schema for the single `response` parameter. The description mirrors the
// upstream Roo-Code definition so models that have seen that prompt corpus
// recognize the contract.
export const Parameters = Schema.Struct({
  response: Schema.String.annotate({
    description: "Plain text message to deliver to the user for this turn.",
  }),
})

// DESCRIPTION is taken verbatim from Roo-Code's
// `src/core/prompts/tools/native-tools/display_response.ts` so models calibrated
// against that wording behave identically here. Keep this in sync with
// upstream when updating.
const DESCRIPTION = `Deliver a plain textual response to the user when no other tool is appropriate for the current turn. Use this as a fallback to satisfy the "every assistant turn must call at least one tool" constraint whenever you only need to send textual content — both short conversational replies and long-form structured output — that does not finish the task. Typical use cases:
- Clarifying remarks, brainstorming, short answers, status updates
- Presenting a plan or proposed approach before implementation
- Explaining code, concepts, errors, or trade-offs in depth
- Delivering a long-form report, summary, analysis, or review
- Showing diagrams, tables, or formatted markdown content to the user

STRICT OUTPUT RULES (must follow exactly):
- Put the ENTIRE message inside the \`response\` argument of this tool call.
- Do NOT emit ANY free-form assistant text outside the tool call in the same turn. The assistant text channel MUST be empty when you call \`display_response\`.
- This means: no preamble, no recap, no "Here is…", no trailing remark before or after the tool call. Everything the user should see goes inside \`response\`.

Parameters:
- response: (required) The textual message to deliver to the user. Markdown is supported.

Example (correct — assistant text is empty, all content is inside the tool call):
{ "response": "I looked at the two options and I think Option A is cleaner because it avoids the extra cache lookup." }`

export const DisplayResponseTool = Tool.define(
  "display_response",
  Effect.succeed({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params: { response: string }) =>
      Effect.succeed({
        // Keep `title` empty so the TUI shows just "⚙ display_response" for
        // the tool line. The model's reply is surfaced as a separate, plain
        // assistant text bubble emitted by the session processor (see
        // session/processor.ts handling for `tool-result` of display_response),
        // which mirrors Roo-Code's "Roo said" rendering in
        // roo-code/src/core/tools/DisplayResponseTool.ts:18-26.
        title: "",
        output: params.response,
        metadata: { displayResponse: true },
      }),
  }),
)
