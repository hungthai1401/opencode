# Phase 1 Story Map: Ensure Tool Call

**Feature:** ensure-tool-call  
**Phase:** 1 (Single Phase)  
**Date:** 2026-05-19

---

## User Story

**As a** developer using OpenCode  
**I want** every LLM response to include at least one tool call  
**So that** the LLM never produces text-only responses without taking action

---

## Story Map Structure

```
Epic: Ensure Tool Call Enforcement
│
├─ Story 1: Create No-Op Tool (Foundation)
│  ├─ Task 1.1: Define tool schema
│  ├─ Task 1.2: Implement execute function
│  ├─ Task 1.3: Register in ToolRegistry
│  └─ Task 1.4: Write unit tests
│
├─ Story 2: System Prompt Injection (Layer 1)
│  ├─ Task 2.1: Add enforcement instruction to system array
│  ├─ Task 2.2: Verify instruction propagates to all providers
│  └─ Task 2.3: Write unit tests
│
├─ Story 3: Response Validation (Layer 2)
│  ├─ Task 3.1: Add validation logic in onFinish handler
│  ├─ Task 3.2: Implement synthetic tool call injection
│  ├─ Task 3.3: Update finishReason to "tool-calls"
│  └─ Task 3.4: Write unit tests
│
└─ Story 4: Integration Testing (Verification)
   ├─ Task 4.1: Test end-to-end with LLM compliance
   ├─ Task 4.2: Test end-to-end with LLM non-compliance
   ├─ Task 4.3: Test multi-provider coverage
   └─ Task 4.4: Verify performance (<10ms latency)
```

---

## Story 1: Create No-Op Tool (Foundation)

**Goal:** Provide a dedicated tool for synthetic injection that executes without errors and produces no visible output.

### Acceptance Criteria

- [ ] Tool ID is `ensure_tool_call_compliance`
- [ ] Tool accepts optional `reason` parameter (string)
- [ ] Tool returns empty output (`""`)
- [ ] Tool returns empty metadata (`{}`)
- [ ] Tool is registered in `ToolRegistry.layer`
- [ ] Tool follows Effect-based pattern (like `InvalidTool`)
- [ ] Tool description discourages explicit use by LLM

### Tasks

**Task 1.1: Define tool schema**
- Create `packages/opencode/src/tool/ensure-compliance.ts`
- Define tool using `Tool.define`
- Set tool ID to `ensure_tool_call_compliance`
- Define parameters schema: `Schema.Struct({ reason: Schema.String.pipe(Schema.optional) })`
- Set description: "Internal tool for ensuring tool call compliance. Do not call this tool explicitly."

**Task 1.2: Implement execute function**
- Implement `execute` function returning `Effect.succeed`
- Return `ExecuteResult` with:
  - `title: "Tool Call Compliance"`
  - `output: ""`
  - `metadata: {}`

**Task 1.3: Register in ToolRegistry**
- Add `EnsureComplianceTool` to `ToolRegistry.layer` in `packages/opencode/src/tool/registry.ts`
- Follow existing pattern for built-in tools

**Task 1.4: Write unit tests**
- Test: Tool executes without errors
- Test: Tool returns empty output
- Test: Tool accepts optional `reason` parameter
- Test: Tool is registered in ToolRegistry

### Dependencies

- Effect v4.0.0-beta.65 (Effect Schema)
- Existing tool patterns (`InvalidTool`, `_noop`)

### Estimated Effort

**Small** — 1-2 hours

---

## Story 2: System Prompt Injection (Layer 1)

**Goal:** Guide the LLM to always include at least one tool call through explicit system prompt instruction.

### Acceptance Criteria

- [ ] Enforcement instruction added to system prompt array
- [ ] Instruction text: "You MUST call at least one tool in every response. If no other tool is appropriate, you may call a no-op tool, but you must never respond without calling at least one tool."
- [ ] Instruction appears before `system.join("\n")`
- [ ] Instruction propagates to OpenAI OAuth provider
- [ ] Instruction propagates to GitLab Workflow provider
- [ ] Instruction propagates to standard providers

### Tasks

**Task 2.1: Add enforcement instruction to system array**
- Modify `packages/opencode/src/session/llm.ts:112-137`
- Add instruction string to system array after environment and skills prompts
- Ensure instruction appears before `system.join("\n")`

**Task 2.2: Verify instruction propagates to all providers**
- Check OpenAI OAuth path: `options.instructions = system.join("\n")` (line 152)
- Check GitLab Workflow path: `workflowModel.systemPrompt = system.join("\n")` (line 237)
- Check standard provider path: system messages passed separately (line 160+)

**Task 2.3: Write unit tests**
- Test: System prompt includes enforcement instruction
- Test: Instruction appears in final system prompt string
- Test: Instruction propagates to all provider paths

### Dependencies

- `packages/opencode/src/session/llm.ts` (system prompt assembly)
- `packages/opencode/src/session/system.ts` (SystemPrompt service)

### Estimated Effort

**Small** — 1-2 hours

---

## Story 3: Response Validation (Layer 2)

**Goal:** Guarantee at least one tool call in the final response by validating and injecting synthetic call if needed.

### Acceptance Criteria

- [ ] Validation logic added to `onFinish` handler
- [ ] Validation checks if `toolCalls` array is empty or undefined
- [ ] Synthetic tool call injected when validation fails
- [ ] Synthetic tool call has unique ID (UUID or timestamp-based)
- [ ] Synthetic tool call targets `ensure_tool_call_compliance` tool
- [ ] Synthetic tool call includes `reason` parameter
- [ ] `finishReason` updated from `"stop"` to `"tool-calls"`
- [ ] Normal response flow continues after injection

### Tasks

**Task 3.1: Add validation logic in onFinish handler**
- Modify `packages/opencode/src/session/prompt.ts:1449-1471`
- Add check: `if (!event.toolCalls || event.toolCalls.length === 0)`
- Implement validation logic in `onFinish` handler

**Task 3.2: Implement synthetic tool call injection**
- Generate unique tool call ID (UUID or timestamp-based)
- Create synthetic tool call object:
  ```typescript
  {
    toolCallId: generateToolCallId(),
    toolName: "ensure_tool_call_compliance",
    args: { reason: "LLM did not call any tools" }
  }
  ```
- Inject into `event.toolCalls` array

**Task 3.3: Update finishReason to "tool-calls"**
- Set `event.finishReason = "tool-calls"`
- Ensure normal response flow continues

**Task 3.4: Write unit tests**
- Test: Validation detects empty `toolCalls` array
- Test: Validation detects undefined `toolCalls`
- Test: Synthetic tool call injected with correct structure
- Test: `finishReason` updated to `"tool-calls"`
- Test: No injection when `toolCalls` is non-empty

### Dependencies

- `packages/opencode/src/session/prompt.ts` (response handling)
- AI SDK v6.0.168 (`streamText` event handling)
- Story 1 (no-op tool must exist)

### Estimated Effort

**Medium** — 2-4 hours

---

## Story 4: Integration Testing (Verification)

**Goal:** Verify end-to-end behavior across all layers and providers.

### Acceptance Criteria

- [ ] End-to-end test with LLM compliance passes
- [ ] End-to-end test with LLM non-compliance passes
- [ ] Multi-provider coverage test passes
- [ ] Performance test confirms <10ms latency
- [ ] All tests run from `packages/opencode` directory
- [ ] All tests complete within 30-second timeout

### Tasks

**Task 4.1: Test end-to-end with LLM compliance**
- Send prompt to LLM with enforcement instruction
- Verify LLM response includes at least one tool call
- Verify no synthetic tool call injected
- Verify normal response flow

**Task 4.2: Test end-to-end with LLM non-compliance**
- Mock LLM response with zero tool calls
- Verify synthetic tool call injected
- Verify tool execution completes without errors
- Verify user sees no visible output from synthetic tool

**Task 4.3: Test multi-provider coverage**
- Test enforcement across OpenAI OAuth provider
- Test enforcement across GitLab Workflow provider
- Test enforcement across standard providers
- Verify system prompt injection works for all

**Task 4.4: Verify performance (<10ms latency)**
- Measure response validation latency
- Use timing logs or OpenTelemetry spans
- Confirm <10ms overhead per response

### Dependencies

- Stories 1, 2, 3 (all layers must be implemented)
- Bun test runner
- OpenTelemetry (for performance measurement)

### Estimated Effort

**Medium** — 3-4 hours

---

## Total Estimated Effort

- Story 1: 1-2 hours
- Story 2: 1-2 hours
- Story 3: 2-4 hours
- Story 4: 3-4 hours

**Total: 7-12 hours**

---

## Critical Path

```
Story 1 (No-Op Tool)
    ↓
Story 2 (System Prompt) ← Can run in parallel with Story 3
    ↓
Story 3 (Response Validation) ← Depends on Story 1
    ↓
Story 4 (Integration Testing) ← Depends on Stories 1, 2, 3
```

**Parallelization Opportunity:** Stories 2 and 3 can be implemented in parallel after Story 1 completes.

---

## Risk Mitigation in Story Map

**R1: Effect 4.0 Beta API Instability**
- Mitigated in Story 1, Task 1.1: Use existing patterns from `InvalidTool`

**R2: AI SDK Event Mutation**
- Mitigated in Story 3, Task 3.2: Test mutation behavior during implementation
- Fallback: Create new event object if mutation fails

**R3: System Prompt Ignored by LLM**
- Mitigated by Story 3: Layer 2 guarantees compliance regardless of Layer 1

**R4: Tool Call ID Collision**
- Mitigated in Story 3, Task 3.2: Use UUID or timestamp-based ID generation

---

## Definition of Done

- [ ] All stories complete (Stories 1-4)
- [ ] All acceptance criteria met
- [ ] All unit tests pass (Stories 1, 2, 3)
- [ ] All integration tests pass (Story 4)
- [ ] Type checking passes (`bun typecheck`)
- [ ] Performance validated (<10ms latency)
- [ ] Code reviewed (self-review or peer review)
- [ ] Changes committed to feature branch
- [ ] Phase 1 contract exit conditions met
