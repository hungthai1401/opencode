# Architecture Snapshot: "ensure-tool-call" Feature Integration

## Executive Summary

This document maps the OpenCode architecture for implementing the "ensure-tool-call" feature, which uses a two-layer approach:
1. **System prompt injection**: Instruct the model to always call at least one tool
2. **Response validation + synthetic tool injection**: If the model finishes without tool calls, inject a synthetic no-op tool call

## 1. System Prompt Generation Flow

### Entry Points

**Primary Service**: `packages/opencode/src/session/system.ts`

The `SystemPrompt.Service` provides two key methods:
- `environment(model)`: Generates environment context (working directory, platform, date, model info)
- `skills(agent)`: Generates available skills list if agent has skill permission

### Assembly Flow

**Step 1: Initial Assembly** (`packages/opencode/src/session/prompt.ts:1420-1428`)

```typescript
const [skills, env, instructions, modelMsgs] = yield* Effect.all([
  sys.skills(agent),
  sys.environment(model),
  instruction.system().pipe(Effect.orDie),
  MessageV2.toModelMessagesEffect(msgs, model),
])
const system = [...env, ...instructions, ...(skills ? [skills] : [])]
```

**Step 2: Final Assembly** (`packages/opencode/src/session/llm.ts:112-137`)

```typescript
const system: string[] = []
system.push(
  [
    // use agent prompt otherwise provider prompt
    ...(input.agent.prompt ? [input.agent.prompt] : SystemPrompt.provider(input.model)),
    // any custom prompt passed into this call
    ...input.system,
    // any custom prompt from last user message
    ...(input.user.system ? [input.user.system] : []),
  ]
    .filter((x) => x)
    .join("\n"),
)
```

**Step 3: Plugin Hook** (`packages/opencode/src/session/llm.ts:127-137`)

```typescript
const header = system[0]
yield* plugin.trigger(
  "experimental.chat.system.transform",
  { sessionID: input.sessionID, model: input.model },
  { system },
)
// rejoin to maintain 2-part structure for caching if header unchanged
if (system.length > 2 && system[0] === header) {
  const rest = system.slice(1)
  system.length = 0
  system.push(header, rest.join("\n"))
}
```

### Integration Point #1: System Prompt Injection

**Location**: `packages/opencode/src/session/llm.ts:112-137`

**Strategy**: Add enforcement instruction to the `system` array after the plugin hook but before the final join.

**Example**:
```typescript
// After plugin.trigger and rejoin logic
if (shouldEnforceToolCall(input)) {
  system.push(ENSURE_TOOL_CALL_SYSTEM_PROMPT)
}
```

Where `ENSURE_TOOL_CALL_SYSTEM_PROMPT` could be:
```typescript
const ENSURE_TOOL_CALL_SYSTEM_PROMPT = `CRITICAL: You MUST call at least one tool in your response. If no other tool is appropriate, call the _acknowledge tool to confirm you've read the message. Never respond with only text when tools are available.`
```

## 2. Response Handling Pipeline

### Architecture Overview

```
User Input
    ↓
SessionPrompt.prompt() [prompt.ts:1100+]
    ↓
SessionPrompt.loop() [prompt.ts:1485+]
    ↓
runLoop() [prompt.ts:1200+]
    ↓
    ├─ SystemPrompt.environment() [system.ts:48]
    ├─ SystemPrompt.skills() [system.ts:65]
    ├─ SessionTools.resolve() [tools.ts:24]
    ↓
handle.process() [processor.ts:779]
    ↓
LLM.Service.stream() [llm.ts:471]
    ↓
run() [llm.ts:85]
    ↓
    ├─ AI SDK Path: streamText() [llm.ts:404]
    │   ↓
    │   LLMAISDK.toLLMEvents() [llm/ai-sdk.ts]
    │
    └─ Native Path: LLMClient.stream() [llm/native-runtime.ts]
    ↓
Stream<LLMEvent>
    ↓
SessionProcessor.handleEvent() [processor.ts:304]
    ↓
    ├─ "step-finish" event [processor.ts:554]
    │   └─ Sets ctx.assistantMessage.finish = value.reason
    │
    └─ "finish" event [processor.ts:685]
    ↓
SessionProcessor.process() returns Result [processor.ts:844-846]
    ↓
SessionPrompt.runLoop() checks result [prompt.ts:1449-1471]
```

### Key Components

**1. SessionProcessor.Service** (`packages/opencode/src/session/processor.ts`)

The processor handles the LLM event stream and updates the assistant message state.

**Interface**:
```typescript
export interface Handle {
  readonly message: MessageV2.Assistant
  readonly updateToolCall: (toolCallID: string, update: ...) => Effect.Effect<...>
  readonly completeToolCall: (toolCallID: string, output: ...) => Effect.Effect<void>
  readonly process: (streamInput: LLM.StreamInput) => Effect.Effect<Result>
}

export type Result = "compact" | "stop" | "continue"
```

**Key Events**:
- `step-finish` (line 554): Sets `ctx.assistantMessage.finish = value.reason`
- `finish` (line 685): Final event marker

**Finish Reasons**: The `finish` field can be:
- `"stop"`: Normal completion
- `"tool-calls"`: Stopped to execute tools
- `"length"`: Max tokens reached
- `"content-filter"`: Content filtered
- `"error"`: Error occurred
- `"unknown"`: Unknown reason

**2. SessionPrompt.runLoop()** (`packages/opencode/src/session/prompt.ts:1200+`)

The main orchestration loop that:
1. Calls `handle.process()` to stream LLM response
2. Checks the result and finish reason
3. Decides whether to continue, break, or compact

**Critical Check** (line 1449):
```typescript
const finished = handle.message.finish && !["tool-calls", "unknown"].includes(handle.message.finish)
```

This determines if the model has truly finished (not just paused for tool execution).

### Integration Point #2: Response Validation

**Location**: `packages/opencode/src/session/prompt.ts:1449-1471`

**Strategy**: After `handle.process()` returns, check if:
1. The finish reason is NOT `"tool-calls"` (meaning no tools were called)
2. Tools were available
3. The feature is enabled

If all conditions are met, inject a synthetic tool call.

**Example**:
```typescript
const result = yield* handle.process({
  user: lastUser,
  agent,
  permission: session.permission,
  sessionID,
  parentSessionID: session.parentID,
  system,
  messages: [...modelMsgs, ...(isLastStep ? [{ role: "assistant" as const, content: MAX_STEPS }] : [])],
  tools,
  model,
  toolChoice: format.type === "json_schema" ? "required" : undefined,
})

// NEW: Check if we need to inject synthetic tool call
const finished = handle.message.finish && !["tool-calls", "unknown"].includes(handle.message.finish)
if (finished && shouldEnforceToolCall(input) && Object.keys(tools).length > 0) {
  // Inject synthetic _acknowledge tool call
  yield* injectSyntheticToolCall(handle, sessionID)
  // Continue the loop to process the synthetic tool
  return "continue" as const
}

if (structured !== undefined) {
  handle.message.structured = structured
  handle.message.finish = handle.message.finish ?? "stop"
  yield* sessions.updateMessage(handle.message)
  return "break" as const
}
```

## 3. Tool System Architecture

### Tool Definition

**Location**: `packages/opencode/src/tool/tool.ts`

```typescript
export interface Def<Parameters, M extends Metadata> {
  id: string
  description: string
  parameters: Parameters  // Effect Schema
  jsonSchema?: JSONSchema7
  execute(args: Schema.Schema.Type<Parameters>, ctx: Context): Effect.Effect<ExecuteResult<M>>
  formatValidationError?(error: unknown): string
}
```

### Tool Registry

**Location**: `packages/opencode/src/tool/registry.ts`

Central registry for all built-in tools. Tools are registered with unique IDs.

Examples: `read`, `write`, `edit`, `bash`, `glob`, `grep`, `task`, `question`, etc.

### Tool Resolution

**Location**: `packages/opencode/src/session/tools.ts:24-206`

The `SessionTools.resolve()` function:
1. Assembles available tools for a session
2. Filters based on agent permissions
3. Converts from internal `Tool.Def` format to AI SDK `Tool` format
4. Handles MCP (Model Context Protocol) tools
5. Applies truncation policies

### Existing Synthetic Tool Pattern

**Location**: `packages/opencode/src/session/llm.ts:206-224`

GitHub Copilot compatibility pattern (reference implementation):

```typescript
// GitHub Copilot may require the tools parameter when message history contains
// tool calls but no tools are active (e.g. compaction). Inject a stub tool that
// is never meant to be invoked. LiteLLM-backed providers are excluded.
if (
  input.model.providerID.includes("github-copilot") &&
  Object.keys(tools).length === 0 &&
  hasToolCalls(input.messages)
) {
  tools["_noop"] = aiTool({
    description: "Do not call this tool. It exists only for API compatibility and must never be invoked.",
    inputSchema: jsonSchema({
      type: "object",
      properties: {
        reason: { type: "string", description: "Unused" },
      },
    }),
    execute: async () => ({ output: "", title: "", metadata: {} }),
  })
}
```

### Integration Point #3: No-Op Tool Registration

**Location**: `packages/opencode/src/tool/registry.ts`

**Strategy**: Register a new `_acknowledge` tool that:
1. Has a clear, non-confusing description
2. Takes minimal input (e.g., just a confirmation message)
3. Returns immediately with no side effects
4. Is always available (no permission checks)

**Example**:
```typescript
export const acknowledge = Tool.define({
  id: "_acknowledge",
  description: "Acknowledge that you have read and understood the user's message. Use this when no other tool action is needed but you must call a tool.",
  parameters: Schema.Struct({
    message: Schema.String.pipe(
      Schema.description("Brief acknowledgment message"),
    ),
  }),
  execute: Effect.succeed({
    output: "Acknowledged",
    title: "Message Acknowledged",
    metadata: {},
  }),
})
```

Then add to the registry exports.

### Integration Point #4: Synthetic Tool Call Injection

**Location**: New helper function in `packages/opencode/src/session/prompt.ts`

**Strategy**: When validation detects no tool calls, programmatically inject a synthetic tool call into the message parts.

**Example**:
```typescript
const injectSyntheticToolCall = Effect.fn("SessionPrompt.injectSyntheticToolCall")(function* (
  handle: SessionProcessor.Handle,
  sessionID: SessionID,
) {
  const toolCallID = ulid()
  
  // Create synthetic tool part
  yield* sessions.updatePart({
    id: PartID.ascending(),
    messageID: handle.message.id,
    sessionID,
    type: "tool",
    tool: "_acknowledge",
    callID: toolCallID,
    state: {
      status: "success",
      input: { message: "Acknowledged" },
      raw: JSON.stringify({ message: "Acknowledged" }),
      output: "Acknowledged",
      time: { start: Date.now(), end: Date.now() },
    },
  } satisfies MessageV2.ToolPart)
  
  // Update message finish reason to indicate tool calls
  handle.message.finish = "tool-calls"
  yield* sessions.updateMessage(handle.message)
})
```

## 4. Configuration and Feature Flags

### Recommended Approach

Add a configuration option to enable/disable the feature:

**Location**: `packages/opencode/src/config/config.ts`

```typescript
export interface Config {
  // ... existing fields
  experimental?: {
    // ... existing experimental fields
    ensureToolCall?: boolean
  }
}
```

### Conditional Logic

Use the config flag in all integration points:

```typescript
const shouldEnforceToolCall = (input: { agent: Agent.Info; model: Provider.Model }) => {
  const cfg = yield* Config.Service
  return cfg.experimental?.ensureToolCall === true
}
```

## 5. Implementation Checklist

### Phase 1: Tool Infrastructure
- [ ] Create `_acknowledge` tool definition in `packages/opencode/src/tool/acknowledge.ts`
- [ ] Register tool in `packages/opencode/src/tool/registry.ts`
- [ ] Add tool to exports
- [ ] Write unit tests for the tool

### Phase 2: System Prompt Injection
- [ ] Add `ENSURE_TOOL_CALL_SYSTEM_PROMPT` constant
- [ ] Inject prompt in `packages/opencode/src/session/llm.ts:112-137`
- [ ] Add config flag check
- [ ] Test with various models

### Phase 3: Response Validation
- [ ] Create `injectSyntheticToolCall()` helper in `packages/opencode/src/session/prompt.ts`
- [ ] Add validation logic after `handle.process()` (line 1449-1471)
- [ ] Handle edge cases (no tools available, already has tool calls, etc.)
- [ ] Add logging for debugging

### Phase 4: Configuration
- [ ] Add `experimental.ensureToolCall` config option
- [ ] Update config schema validation
- [ ] Add documentation for the feature
- [ ] Add CLI flag or environment variable

### Phase 5: Testing
- [ ] Unit tests for synthetic tool injection
- [ ] Integration tests for full flow
- [ ] Test with different models (Claude, GPT, etc.)
- [ ] Test edge cases (compaction, errors, interrupts)
- [ ] Performance testing (overhead of synthetic calls)

## 6. Edge Cases and Considerations

### 1. Structured Output Mode
When `format.type === "json_schema"`, the model must use the `StructuredOutput` tool. The ensure-tool-call feature should be disabled in this mode.

**Check**: `packages/opencode/src/session/prompt.ts:1451-1458`

### 2. Compaction
During compaction, tools may not be available. The feature should handle this gracefully.

**Check**: `packages/opencode/src/session/compaction.ts`

### 3. Error States
If the model errors out, don't inject synthetic tool calls.

**Check**: `packages/opencode/src/session/processor.ts:845`

### 4. Summary Generation
When generating summaries, tool calls may not be appropriate.

**Check**: `ctx.assistantMessage.summary` in processor.ts

### 5. Max Steps
If the model hits max steps, don't inject synthetic tool calls.

**Check**: `isLastStep` in prompt.ts

### 6. Tool Choice Override
If `toolChoice` is explicitly set to `"none"`, respect that.

**Check**: `packages/opencode/src/session/prompt.ts:1439`

## 7. Key Files Reference

| File | Purpose | Lines of Interest |
|------|---------|-------------------|
| `packages/opencode/src/session/system.ts` | System prompt service | 42-80 |
| `packages/opencode/src/session/prompt.ts` | Main orchestration loop | 1420-1428, 1449-1471 |
| `packages/opencode/src/session/llm.ts` | LLM interaction | 112-137, 206-224 |
| `packages/opencode/src/session/processor.ts` | Event stream processing | 304-688, 779-848 |
| `packages/opencode/src/session/tools.ts` | Tool resolution | 24-206 |
| `packages/opencode/src/tool/tool.ts` | Tool type definitions | All |
| `packages/opencode/src/tool/registry.ts` | Tool registry | All |
| `packages/opencode/src/config/config.ts` | Configuration schema | All |

## 8. Testing Strategy

### Unit Tests

1. **Tool Definition**
   - Test `_acknowledge` tool executes successfully
   - Test tool returns expected output format
   - Test tool handles various input messages

2. **System Prompt Injection**
   - Test prompt is added when feature is enabled
   - Test prompt is NOT added when feature is disabled
   - Test prompt placement in system array

3. **Response Validation**
   - Test detection of responses without tool calls
   - Test synthetic tool call injection
   - Test finish reason update

### Integration Tests

1. **Full Flow**
   - Send message with feature enabled
   - Verify model response includes tool call
   - Verify synthetic tool call if model doesn't call tools

2. **Edge Cases**
   - Test with structured output mode
   - Test during compaction
   - Test with error states
   - Test with max steps reached

3. **Model Compatibility**
   - Test with Claude models
   - Test with GPT models
   - Test with other providers

### Performance Tests

1. **Overhead Measurement**
   - Measure latency of synthetic tool injection
   - Measure impact on token usage
   - Measure impact on cost

2. **Stress Testing**
   - Test with high message volume
   - Test with concurrent sessions
   - Test with large tool sets

## 9. Rollout Plan

### Stage 1: Development
- Implement core functionality
- Write unit tests
- Internal testing

### Stage 2: Alpha
- Enable for internal users only
- Gather feedback
- Fix critical bugs

### Stage 3: Beta
- Enable via opt-in flag
- Document feature
- Gather user feedback

### Stage 4: General Availability
- Enable by default (with opt-out)
- Monitor metrics
- Iterate based on feedback

## 10. Metrics and Monitoring

### Key Metrics

1. **Adoption**
   - % of sessions with feature enabled
   - % of responses that trigger synthetic tool calls

2. **Effectiveness**
   - % reduction in text-only responses
   - User satisfaction scores

3. **Performance**
   - Average latency overhead
   - Token usage increase
   - Cost impact

4. **Reliability**
   - Error rate
   - Edge case handling success rate

### Logging

Add structured logging at key points:

```typescript
log.info("ensure-tool-call", {
  sessionID,
  enabled: cfg.experimental?.ensureToolCall,
  hadToolCalls: !finished,
  injectedSynthetic: injected,
  toolCount: Object.keys(tools).length,
})
```

## Conclusion

This architecture snapshot provides a complete map of the OpenCode system for implementing the "ensure-tool-call" feature. The four primary integration points are:

1. **System Prompt Injection**: `packages/opencode/src/session/llm.ts:112-137`
2. **Response Validation**: `packages/opencode/src/session/prompt.ts:1449-1471`
3. **No-Op Tool Registration**: `packages/opencode/src/tool/registry.ts`
4. **Synthetic Tool Call Injection**: New helper in `packages/opencode/src/session/prompt.ts`

The implementation should follow the phased approach outlined in Section 5, with careful attention to the edge cases in Section 6.
