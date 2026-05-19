# Phase 1 Contract: Ensure Tool Call

**Feature:** ensure-tool-call  
**Phase:** 1 (Single Phase)  
**Date:** 2026-05-19

---

## Phase Goal

Implement a two-layer enforcement mechanism that guarantees every LLM response includes at least one tool call, using system prompt injection (Layer 1) and response validation with synthetic tool injection (Layer 2).

---

## Entry Conditions

- [x] Design locked in `docs/ensure-tool-call/design.md` (D1-D7)
- [x] Discovery complete in `docs/ensure-tool-call/discovery.md`
- [x] Approach approved in `docs/ensure-tool-call/approach.md`
- [x] Feature branch `feature/ensure-tool-call` exists
- [x] All planning artifacts committed

---

## Exit Conditions

### Functional Requirements

- [ ] **FR1:** System prompt includes enforcement instruction for all LLM providers
  - Instruction text: "You MUST call at least one tool in every response. If no other tool is appropriate, you may call a no-op tool, but you must never respond without calling at least one tool."
  - Injection point: `packages/opencode/src/session/llm.ts:112-137`
  - Coverage: OpenAI OAuth, GitLab Workflow, standard providers

- [ ] **FR2:** Response validation detects empty tool calls and injects synthetic call
  - Validation location: `packages/opencode/src/session/prompt.ts:1449-1471` (`onFinish` handler)
  - Detection: Check if `toolCalls` array is empty or undefined
  - Injection: Create synthetic tool call with `toolName: "ensure_tool_call_compliance"`
  - Update: Set `finishReason` to `"tool-calls"`

- [ ] **FR3:** No-op tool exists and executes without errors
  - Tool ID: `ensure_tool_call_compliance`
  - Location: `packages/opencode/src/tool/ensure-compliance.ts`
  - Behavior: Returns empty output, no user-facing content
  - Registration: Added to `ToolRegistry.layer` in `packages/opencode/src/tool/registry.ts`

- [ ] **FR4:** Zero tool calls are impossible
  - Every LLM response includes at least one tool call (real or synthetic)
  - Verified through integration tests

### Quality Requirements

- [ ] **QR1:** All unit tests pass
  - Test 1: No-op tool execution returns empty output
  - Test 2: System prompt includes enforcement instruction
  - Test 3: Response validation injects synthetic call when `toolCalls` is empty
  - Test 4: Response validation does not inject when `toolCalls` is non-empty

- [ ] **QR2:** All integration tests pass
  - Test 5: End-to-end with LLM compliance (no synthetic injection)
  - Test 6: End-to-end with LLM non-compliance (synthetic injection)
  - Test 7: Multi-provider coverage (OpenAI OAuth, GitLab Workflow, standard)

- [ ] **QR3:** Type checking passes
  - Command: `bun typecheck` from `packages/opencode`
  - No new type errors introduced

- [ ] **QR4:** No performance regression
  - Response validation adds <10ms latency per response
  - Measured via timing logs or OpenTelemetry spans

### Documentation Requirements

- [ ] **DR1:** Code comments explain non-obvious logic
  - System prompt injection rationale
  - Response validation mutation behavior
  - No-op tool purpose

- [ ] **DR2:** Test cases document expected behavior
  - Unit tests cover edge cases (empty array, undefined, null)
  - Integration tests cover provider-specific paths

---

## Scope Boundaries

### In Scope

- System prompt injection for all LLM providers
- Response validation in `onFinish` handler
- Synthetic tool call injection when `toolCalls` is empty
- No-op tool creation and registration
- Unit and integration tests for all layers
- Type checking and performance validation

### Out of Scope

- Opt-in mechanism (D3 — deferred to future work)
- Configuration to enable/disable enforcement per agent
- Configuration to specify eligible tools
- Telemetry for synthetic injection rate (future observability work)
- Error handling for synthetic injection failure (graceful degradation deferred)

---

## Dependencies

### Internal

- `packages/opencode/src/session/llm.ts` — system prompt assembly
- `packages/opencode/src/session/prompt.ts` — response handling
- `packages/opencode/src/tool/tool.ts` — tool definition patterns
- `packages/opencode/src/tool/registry.ts` — tool registration

### External

- Effect v4.0.0-beta.65 — Effect Schema for tool parameters
- AI SDK v6.0.168 — `streamText` and event handling
- Bun 1.3.14 — test runner and type checking

---

## Risks

### MEDIUM Risks

**R1: Effect 4.0 Beta API Instability**
- **Impact:** Tool definition API may change in future Effect releases
- **Mitigation:** Use existing patterns from `InvalidTool` and `_noop` stub
- **Status:** Accepted — follow existing patterns

**R2: AI SDK `streamText` Event Mutation**
- **Impact:** Mutating `event.toolCalls` in `onFinish` may not propagate correctly
- **Mitigation:** Test mutation behavior; create new event object if mutation fails
- **Status:** Accepted — test during implementation

### LOW Risks

**R3: System Prompt Injection Ignored by LLM**
- **Impact:** LLM may ignore system prompt instruction
- **Mitigation:** Layer 2 (response validation) guarantees compliance
- **Status:** Accepted — Layer 2 is ultimate fallback

**R4: Tool Call ID Generation Collision**
- **Impact:** Synthetic tool call ID may collide with existing IDs
- **Mitigation:** Use UUID or timestamp-based ID generation
- **Status:** Accepted — collision probability negligible

---

## Success Metrics

- **Zero tool calls impossible:** 100% of LLM responses include at least one tool call
- **Test coverage:** All 7 test cases pass (4 unit, 3 integration)
- **Type safety:** `bun typecheck` passes with no new errors
- **Performance:** Response validation adds <10ms latency per response
- **Code quality:** No linting errors, follows existing patterns

---

## Rollback Plan

If critical issues arise during implementation:

1. **Revert system prompt injection:** Remove enforcement instruction from `llm.ts`
2. **Revert response validation:** Remove validation logic from `prompt.ts`
3. **Remove no-op tool:** Delete `ensure-compliance.ts` and unregister from `ToolRegistry.layer`
4. **Revert tests:** Delete test files for this feature
5. **Merge to dev:** Merge feature branch to `dev` with reverted changes

All changes are isolated to 3 files + tests, making rollback straightforward.

---

## Phase Completion Checklist

- [ ] All functional requirements (FR1-FR4) met
- [ ] All quality requirements (QR1-QR4) met
- [ ] All documentation requirements (DR1-DR2) met
- [ ] All tests pass (`bun test --timeout 30000` from `packages/opencode`)
- [ ] Type checking passes (`bun typecheck` from `packages/opencode`)
- [ ] Code reviewed (self-review or peer review)
- [ ] Changes committed to feature branch
- [ ] Ready for validation phase
