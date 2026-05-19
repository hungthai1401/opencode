# Ensure Tool Call — Design

**Feature slug:** ensure-tool-call
**Date:** 2026-05-19
**Brainstorming session:** complete
**Scope:** Standard

---

<domain>
## Feature Boundary

A mechanism that ensures the LLM always includes at least one tool call in every response, using system prompt enforcement as the primary method and synthetic tool injection as a fallback when the LLM fails to comply.

**Domain type(s):** CALL

</domain>

---

<decisions>
## Locked Decisions

These are fixed. Planning must implement them exactly. No creative reinterpretation.

### Scope and Behavior
- **D1** Ensure **at least one tool call** happens in every LLM response (any tool, not zero tool calls)
  *Rationale: User wants to prevent responses with no tool calls, not enforce a specific tool*

- **D4** Always active — applies to every LLM interaction, no context-specific filtering
  *Rationale: User wants universal enforcement across all conversation types*

### Architecture
- **D5** Create a dedicated no-op tool for synthetic injection (e.g., `ensure_tool_call_compliance` or `_internal_tool_call_marker`)
  *Rationale: Explicit intent, debuggability, easy to identify synthetic calls in logs, minimal user impact*

### Two-Layer Enforcement
- **D6** Layer 1 (Primary): System prompt injection — inject explicit instruction "You MUST call at least one tool in every response. Never respond with only text." into system prompt before generation
  *Rationale: User requested "force in system prompt too, don't depend LLM" — system prompt is first line of defense*

- **D7** Layer 2 (Fallback): Response validation + synthetic tool call — if LLM doesn't call a tool, automatically inject a synthetic no-op tool call. No retry, no regeneration.
  *Rationale: User said "do as best as LLM can" and "we don't need to retry" — prefer synthetic injection over retry mechanism*

### Agent's Discretion
- **D2** (Agent's Discretion) Enforcement behavior implementation details — agent decides specific implementation approach during planning
  *Constraint: must be effective at ensuring tool calls happen, prefer non-blocking approaches that guide the LLM rather than hard failures*

- **D3** (Agent's Discretion) Tool opt-in mechanism — agent decides how tools are marked as "must-call" during planning
  *Constraint: must be flexible enough to support both "all tools" and "specific tools" scenarios, prefer declarative approach over imperative registration*

</decisions>

---

<specifics>
## Specific Ideas & References

- User emphasized not depending solely on LLM behavior: "we need force in system prompt too, don't depend LLM"
- User preferred synthetic injection over retry: "I think we don't need to retry, we need do as best as LLM can"
- User delegated technical decisions: "do the best" and "choose the best for me"

</specifics>

---

<code_context>
## Existing Code Context

From the quick codebase scout during brainstorming.
Downstream agents: read these files before planning to avoid reinventing existing patterns.

### Reusable Assets
- `packages/plugin/src/tool.ts` — Tool system foundation with ToolContext, ToolResult, and tool() helper function for defining tools
- Tool definitions can be placed in `.opencode/tools/` (local) or `~/.config/opencode/tools/` (global)
- Multiple tools per file supported via named exports

### Established Patterns
- Effect library patterns: Use Effect for async operations, error handling, and dependency injection
- Style guide: inline single-use values, avoid destructuring, prefer const over let, avoid else statements, keep helpers below main functions
- Zod schemas: Used for tool argument validation

### Integration Points
- Tool system at `packages/plugin/src/tool.ts` — extend or integrate with existing tool infrastructure
- System prompt generation — locate where system prompts are constructed and inject enforcement instruction
- Response handling pipeline — locate where LLM responses are processed and add validation + synthetic injection logic

</code_context>

---

<outstanding_questions>
## Outstanding Questions

### Deferred to Planning
- [ ] Where is the system prompt constructed in the codebase? — Codebase investigation will locate the prompt generation logic
- [ ] Where is the LLM response processed before delivery? — Codebase investigation will locate the response handling pipeline
- [ ] What is the best location for the dedicated no-op tool? — Codebase investigation will determine appropriate tool directory
- [ ] Should the no-op tool be hidden from user-facing tool lists? — Technical decision based on UX patterns in existing codebase

</outstanding_questions>

---

<deferred>
## Deferred Ideas

None captured during brainstorming.

</deferred>

---

## Handoff Note

design.md is the single source of truth for this feature.

- **writing-plans** reads: locked decisions, code context, canonical refs, deferred-to-planning questions
- **validating** reads: locked decisions (to verify plan-checker coverage)
- **executing-plans** reads: locked decisions (to honor during implementation)
- **reviewing** reads: locked decisions (for UAT verification)

Decision IDs (D1, D2...) are stable. Reference them by ID in all downstream artifacts.
