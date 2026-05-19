# Approach: Ensure Tool Call

**Feature:** ensure-tool-call  
**Date:** 2026-05-19  
**Status:** Approved for decomposition

---

## Overview

Implement a two-layer enforcement mechanism to ensure every LLM response includes at least one tool call. Layer 1 uses system prompt injection to guide the LLM. Layer 2 validates responses and injects a synthetic no-op tool call if the LLM fails to comply.

---

## Architecture

### Layer 1: System Prompt Injection (D6)

**Goal:** Guide the LLM to always include at least one tool call through explicit instruction.

**Implementation:**
- **Location:** `packages/opencode/src/session/llm.ts:112-137`
- **Mechanism:** Add enforcement instruction to the system prompt array before `system.join("\n")`
- **Instruction text:** `"You MUST call at least one tool in every response. If no other tool is appropriate, you may call a no-op tool, but you must never respond without calling at least one tool."`
- **Placement:** Append to system array after environment and skills prompts, before provider-specific injection

**Integration points:**
```typescript
const system = [
  ...(yield* SystemPrompt.environment(input.model)),
  ...(yield* SystemPrompt.skills(input.model, input.agent)),
  // NEW: Add enforcement instruction here
]
```

**Provider coverage:**
- OpenAI OAuth: `options.instructions = system.join("\n")` (line 152)
- GitLab Workflow: `workflowModel.systemPrompt = system.join("\n")` (line 237)
- Standard providers: System messages passed separately (line 160+)

All providers receive the same system prompt array, so single injection point covers all cases.

### Layer 2: Response Validation + Synthetic Injection (D7)

**Goal:** Guarantee at least one tool call in the final response, even if the LLM ignores Layer 1.

**Implementation:**
- **Location:** `packages/opencode/src/session/prompt.ts:1449-1471` (`onFinish` handler)
- **Mechanism:** 
  1. Check if `toolCalls` array is empty when `onFinish` is called
  2. If empty, inject synthetic tool call to dedicated no-op tool
  3. Update `finishReason` from `"stop"` to `"tool-calls"`
  4. Continue normal response flow

**Validation logic:**
```typescript
onFinish: (event) => {
  if (!event.toolCalls || event.toolCalls.length === 0) {
    // Inject synthetic tool call
    const syntheticCall = {
      toolCallId: generateToolCallId(),
      toolName: "ensure_tool_call_compliance",
      args: { reason: "LLM did not call any tools" },
    }
    event.toolCalls = [syntheticCall]
    event.finishReason = "tool-calls"
  }
  // Continue normal flow
}
```

**No retry mechanism:** Inject immediately, do not regenerate LLM response.

### Layer 3: No-Op Tool (D5)

**Goal:** Provide a dedicated tool for synthetic injection that does nothing and produces no visible output.

**Implementation:**
- **Location:** New file `packages/opencode/src/tool/ensure-compliance.ts`
- **Pattern:** Model after `InvalidTool` (Effect-based) or `_noop` stub (AI SDK-based)
- **Registration:** Add to `ToolRegistry.layer` in `packages/opencode/src/tool/registry.ts`

**Tool definition:**
```typescript
export const EnsureComplianceTool = Tool.define(
  "ensure_tool_call_compliance",
  Effect.succeed({
    description: "Internal tool for ensuring tool call compliance. Do not call this tool explicitly.",
    parameters: Schema.Struct({
      reason: Schema.String.pipe(Schema.optional),
    }),
    execute: (params: { reason?: string }) =>
      Effect.succeed({
        title: "Tool Call Compliance",
        output: "", // No visible output
        metadata: {},
      }),
  }),
)
```

**Visibility:**
- Tool is always available in tool registry
- Description discourages explicit use by LLM
- Execution produces empty output (no user-facing content)

---

## Implementation Strategy

### Phase 1: Foundation (Single Phase)

**Bead 1: Create No-Op Tool**
- Create `packages/opencode/src/tool/ensure-compliance.ts`
- Define `EnsureComplianceTool` using `Tool.define`
- Export tool following self-export pattern
- Register in `ToolRegistry.layer`

**Bead 2: System Prompt Injection**
- Modify `packages/opencode/src/session/llm.ts:112-137`
- Add enforcement instruction to system prompt array
- Ensure instruction appears before `system.join("\n")`
- Verify instruction propagates to all provider paths

**Bead 3: Response Validation**
- Modify `packages/opencode/src/session/prompt.ts:1449-1471`
- Add validation logic in `onFinish` handler
- Check for empty `toolCalls` array
- Inject synthetic tool call if empty
- Update `finishReason` to `"tool-calls"`

**Bead 4: Integration Testing**
- Write test cases for Layer 1 (system prompt injection)
- Write test cases for Layer 2 (response validation + synthetic injection)
- Write test cases for Layer 3 (no-op tool execution)
- Verify end-to-end behavior: LLM response → validation → synthetic injection → tool execution

---

## Risk Assessment

### HIGH Risks

**None identified.**

### MEDIUM Risks

**R1: Effect 4.0 Beta API Instability**
- **Impact:** Tool definition API may change in future Effect releases
- **Mitigation:** Use existing patterns from `InvalidTool` and `_noop` stub; follow Effect Schema conventions
- **Spike needed:** No — existing tools provide stable reference patterns

**R2: AI SDK `streamText` Event Mutation**
- **Impact:** Mutating `event.toolCalls` in `onFinish` may not propagate correctly through AI SDK pipeline
- **Mitigation:** Test mutation behavior; if mutation fails, create new event object with injected tool call
- **Spike needed:** No — straightforward to test during implementation

### LOW Risks

**R3: System Prompt Injection Ignored by LLM**
- **Impact:** LLM may ignore system prompt instruction and still produce zero tool calls
- **Mitigation:** Layer 2 (response validation) guarantees compliance regardless of LLM behavior
- **Spike needed:** No — Layer 2 is the ultimate fallback

**R4: Tool Call ID Generation Collision**
- **Impact:** Synthetic tool call ID may collide with existing tool call IDs
- **Mitigation:** Use UUID or timestamp-based ID generation; collision probability negligible
- **Spike needed:** No — standard ID generation patterns available

---

## Testing Strategy

### Unit Tests

**Test 1: No-Op Tool Execution**
- Call `EnsureComplianceTool.execute()` with valid params
- Assert: Returns empty output, no errors

**Test 2: System Prompt Injection**
- Generate system prompt with enforcement instruction
- Assert: Instruction appears in final system prompt string
- Assert: Instruction propagates to all provider paths

**Test 3: Response Validation (Empty Tool Calls)**
- Simulate `onFinish` event with empty `toolCalls` array
- Assert: Synthetic tool call injected
- Assert: `finishReason` updated to `"tool-calls"`

**Test 4: Response Validation (Non-Empty Tool Calls)**
- Simulate `onFinish` event with existing tool calls
- Assert: No synthetic tool call injected
- Assert: `finishReason` unchanged

### Integration Tests

**Test 5: End-to-End (LLM Compliance)**
- Send prompt to LLM with enforcement instruction
- Assert: LLM response includes at least one tool call
- Assert: No synthetic tool call injected

**Test 6: End-to-End (LLM Non-Compliance)**
- Mock LLM response with zero tool calls
- Assert: Synthetic tool call injected
- Assert: Tool execution completes without errors
- Assert: User sees no visible output from synthetic tool

**Test 7: Multi-Provider Coverage**
- Test enforcement across OpenAI OAuth, GitLab Workflow, and standard providers
- Assert: System prompt injection works for all providers

---

## Open Questions

**None.** All decisions locked in design.md (D1-D7).

---

## Dependencies

**Internal:**
- `packages/opencode/src/session/llm.ts` — system prompt assembly
- `packages/opencode/src/session/prompt.ts` — response handling
- `packages/opencode/src/tool/tool.ts` — tool definition patterns
- `packages/opencode/src/tool/registry.ts` — tool registration

**External:**
- Effect v4.0.0-beta.65 — Effect Schema for tool parameters
- AI SDK v6.0.168 — `streamText` and event handling
- Zod v4.1.8 — Schema validation (if using plugin tool pattern)

---

## Success Criteria

1. **Layer 1 Active:** System prompt includes enforcement instruction for all providers
2. **Layer 2 Active:** Response validation detects empty tool calls and injects synthetic call
3. **Layer 3 Active:** No-op tool executes without errors and produces no visible output
4. **Zero Tool Calls Impossible:** Every LLM response includes at least one tool call (real or synthetic)
5. **Tests Pass:** All unit and integration tests pass with 30-second timeout
6. **Type Check Clean:** `bun typecheck` passes from `packages/opencode`
7. **No Performance Regression:** Validation adds negligible latency (<10ms per response)

---

## Future Considerations

**Opt-In Mechanism (D3 — Agent's Discretion):**
- Current approach: Always active for all LLM interactions
- Future: Add configuration to enable/disable enforcement per agent or per session
- Future: Add configuration to specify which tools are eligible for enforcement (e.g., "all tools" vs "specific tools")

**Observability:**
- Add telemetry to track synthetic tool call injection rate
- Log when Layer 2 activates (LLM non-compliance)
- Monitor system prompt injection effectiveness

**Error Handling:**
- If synthetic tool call injection fails, log error and continue (graceful degradation)
- Do not block LLM response delivery on validation failure
