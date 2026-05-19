# Discovery: Ensure Tool Call

**Feature:** ensure-tool-call  
**Date:** 2026-05-19  
**Phase:** Discovery complete

---

## Institutional Learnings

No prior learnings found for this domain. This is the first feature implementing LLM response validation and synthetic tool injection.

---

## Agent A: Architecture Snapshot

### System Prompt Generation

**Primary Location:** `packages/opencode/src/session/llm.ts:112-137`

The system prompt is assembled as an array of strings, then joined with `\n`:

```typescript
const system = [
  ...(yield* SystemPrompt.environment(input.model)),
  ...(yield* SystemPrompt.skills(input.model, input.agent)),
]
```

**Provider-Specific Injection Points:**
- **OpenAI OAuth:** `options.instructions = system.join("\n")` (line 152)
- **GitLab Workflow:** `workflowModel.systemPrompt = system.join("\n")` (line 237)
- **Standard providers:** System messages passed separately (line 160+)

**SystemPrompt Service:** `packages/opencode/src/session/system.ts`
- Provides `environment()` and `skills()` methods returning `Effect.Effect<string[]>`
- Prompts built dynamically based on model and agent
- Provider-specific prompts selected via `provider(model)` function (lines 19-33)

**Integration Point for D6 (System Prompt Injection):**
Add enforcement instruction to the system prompt array before `system.join("\n")` in `llm.ts:137`.

### Response Handling Pipeline

**Primary Location:** `packages/opencode/src/session/prompt.ts:1449-1471`

The LLM response is processed through event handlers:
- `onChunk`: Processes streaming chunks
- `onFinish`: Called when generation completes with finish reason (`"stop"`, `"tool-calls"`, `"length"`, etc.)

**Current Flow:**
1. `streamText()` generates response with tool calls
2. Events stream through `onChunk` handlers
3. `onFinish` receives final state with `finishReason` and `toolCalls`
4. Response delivered to user

**No existing validation layer** — validation happens at tool execution level, not response level.

**Integration Point for D7 (Response Validation + Synthetic Injection):**
Add validation logic in `onFinish` handler to check if `toolCalls` is empty. If empty, inject synthetic tool call and update finish reason to `"tool-calls"`.

### Tool System Architecture

**Tool Definition:** `packages/opencode/src/tool/tool.ts:35-45`

Two tool systems coexist:
1. **Effect-based tools** (internal): Use Effect Schema, return `Effect.Effect<ExecuteResult<M>>`
2. **Plugin tools** (external): Use Zod schemas, return `Promise<ToolResult>`

**Tool Registry:** `packages/opencode/src/tool/registry.ts:226-246`
- Built-in tools hardcoded in `ToolRegistry.layer`
- Custom tools auto-discovered from `{tool,tools}/*.{js,ts}` in config directories
- Tools initialized lazily via `Tool.init()`

**Tool Resolution:** `packages/opencode/src/session/tools.ts:24-206`
- Tools resolved into `Record<string, AITool>` dictionary
- Sorted alphabetically before passing to LLM (line 225)
- Converted from internal `Tool.Def` to AI SDK's `Tool` format

**Integration Point for D5 (No-Op Tool):**
Create new tool in `packages/opencode/src/tool/` directory, register in `ToolRegistry.layer`.

### Entry Points

**Main LLM Interaction:** `packages/opencode/src/session/llm.ts:85-430`
- `stream()` function orchestrates: prompt assembly → tool resolution → `streamText()` → event handling
- Receives: model, agent, messages, tools
- Returns: streaming response with tool calls

**Tool Execution:** `packages/opencode/src/tool/registry.ts:145-198`
- Plugin tools bridged to Effect tools
- Validation via `Schema.decodeUnknownEffect` or Zod `safeParse()`
- Execution wrapped with OpenTelemetry spans

---

## Agent B: Pattern Search

### Response Validation Patterns

**No existing LLM response validators found.** Validation happens at tool execution level:

**Tool Input Validation** (`packages/opencode/src/tool/tool.ts:79-130`):
```typescript
const decode = Schema.decodeUnknownEffect(toolInfo.parameters)
const decoded = yield* decode(args).pipe(
  Effect.mapError((error) =>
    toolInfo.formatValidationError
      ? new Error(toolInfo.formatValidationError(error), { cause: error })
      : new Error(
          `The ${id} tool was called with invalid arguments: ${error}.\nPlease rewrite the input so it satisfies the expected schema.`,
          { cause: error },
        ),
  ),
)
```

**Tool Call Repair** (`packages/opencode/src/session/llm.ts:410-430`):
- `streamText` includes `experimental_repairToolCall` to fix malformed tool calls
- Post-hoc repair, not validation

**Key Insight:** Need to create new validation layer for LLM responses — no existing pattern.

### Tool Definition Patterns

**Standard Tool Structure** (`packages/opencode/src/tool/tool.ts:35-45`):
```typescript
export interface Def<
  Parameters extends Schema.Decoder<unknown> = Schema.Decoder<unknown>,
  M extends Metadata = Metadata,
> {
  id: string
  description: string
  parameters: Parameters
  jsonSchema?: JSONSchema7
  execute(args: Schema.Schema.Type<Parameters>, ctx: Context): Effect.Effect<ExecuteResult<M>>
  formatValidationError?(error: unknown): string
}
```

**Example: Simple No-Op Tool** (`packages/opencode/src/tool/invalid.ts`):
```typescript
export const InvalidTool = Tool.define(
  "invalid",
  Effect.succeed({
    description: "Do not use",
    parameters: Parameters,
    execute: (params: { tool: string; error: string }) =>
      Effect.succeed({
        title: "Invalid Tool",
        output: `The arguments provided to the tool are invalid: ${params.error}`,
        metadata: {},
      }),
  }),
)
```

**GitHub Copilot Stub Tool** (`packages/opencode/src/session/llm.ts:209-224`):
- Injected when tools array is empty but message history has tool calls
- Never meant to be invoked, exists for API compatibility
- Uses AI SDK's `tool()` helper directly (not `Tool.define`)

```typescript
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
```

**Reusable Pattern:** Model no-op tool after `InvalidTool` or `_noop` stub.

### Prompt Modification Patterns

**System Prompt Assembly** (`packages/opencode/src/session/llm.ts:140-160`):
- System prompts are arrays of strings joined with `\n`
- Different injection points for different providers

**Dynamic Prompt Injection Example** (`packages/opencode/src/session/system.ts:48-63`):
```typescript
environment: Effect.fn("SystemPrompt.environment")(function* (model: Provider.Model) {
  const ctx = yield* InstanceState.context
  return [
    [
      `You are powered by the model named ${model.api.id}. The exact model ID is ${model.providerID}/${model.api.id}`,
      `Here is some useful information about the environment you are running in:`,
      `<env>`,
      `  Working directory: ${ctx.directory}`,
      // ... more lines
      `</env>`,
    ].join("\n"),
  ]
})
```

**Key Insight:** System prompts built as string arrays, then joined. Add enforcement instruction to array before join.

### Error Handling & Logging

**Effect Error Handling Pattern:**
- Use `Effect.orDie` to convert recoverable errors to defects
- Use `Effect.mapError` to transform errors
- Use `Effect.withSpan` for tracing

**Logging Pattern** (`packages/opencode/src/session/llm.ts:85-97`):
```typescript
const l = log
  .clone()
  .tag("providerID", input.model.providerID)
  .tag("modelID", input.model.id)
  .tag("session.id", input.sessionID)
  .tag("small", (input.small ?? false).toString())
  .tag("agent", input.agent.name)
  .tag("mode", input.agent.mode)
l.info("stream", {
  modelID: input.model.id,
  providerID: input.model.providerID,
})
```

**Plugin Hooks** (`packages/opencode/src/session/tools.ts:88-107`):
- `plugin.trigger("tool.execute.before", ...)` before execution
- `plugin.trigger("tool.execute.after", ...)` after execution
- Used for observability, not validation

**No middleware/pipeline pattern** for LLM responses — need to create new validation layer.

---

## Agent C: Constraints Analysis

### Runtime & Dependencies

**Core Runtime:**
- **Bun:** `1.3.14` (packageManager)
- **TypeScript:** `5.8.2` (catalog)
- **Node Types:** `24.12.2`

**Key Dependencies:**
- **Effect:** `4.0.0-beta.65` (catalog) — Beta version, API may evolve
- **Zod:** `4.1.8` (catalog) — Major version 4.x with breaking changes from 3.x
- **AI SDK (Vercel):** `6.0.168` — Used for LLM streaming (`streamText`)

**Other Relevant:**
- `@effect/platform-node`: `4.0.0-beta.65`
- `@effect/opentelemetry`: `4.0.0-beta.65`
- `@standard-schema/spec`: `1.0.0`

### Build & Test Requirements

**Type Checking:**
- Command: `bun typecheck` from package directories (e.g., `packages/opencode`)
- Uses `tsgo --noEmit` under the hood
- **Critical:** Tests cannot run from repo root (guard: `do-not-run-tests-from-root`)

**Testing:**
- Command: `bun test --timeout 30000` from `packages/opencode`
- Test runner: Bun's built-in test runner
- Timeout: 30 seconds per test
- Test count: ~240 test files in `packages/opencode/test/`

**Linting:**
- Root command: `bun run lint` → `oxlint`
- Version: `oxlint@1.60.0` + `oxlint-tsgolint@0.21.0`

### Tool System Constraints

**Tool Definition Architecture:**
- **Two tool systems coexist:**
  1. **Effect-based tools:** Use Effect Schema, return `Effect.Effect<ExecuteResult<M>>`
  2. **Plugin tools:** Use Zod schemas, return `Promise<ToolResult>`
  - Bridge layer converts plugin tools to Effect tools in `registry.ts:145-198`

**Tool Discovery & Loading:**
- Built-in tools: Hardcoded in `ToolRegistry.layer`
- Custom tools: Auto-discovered from `{tool,tools}/*.{js,ts}` in config directories
- Plugin tools: Loaded from plugin manifests via `Plugin.Service`
- Tools initialized lazily via `Tool.init()`

**Naming Conventions:**
- Tool IDs are strings (e.g., `"read"`, `"edit"`, `"bash"`)
- No strict naming pattern enforced
- Custom tools: `namespace` or `namespace_exportName` format
- Internal tools use lowercase snake_case (e.g., `task_status`, `repo_clone`)

**Tool Limits:**
- No hard limit on number of tools
- Tools filtered per-model in `ToolRegistry.tools()`
- Tool selection respects agent permissions via `Permission.evaluate()`

**Validation:**
- Effect tools: Schema validation via `Schema.decodeUnknownEffect()`
- Plugin tools: Zod validation via `safeParse()`, converted to Effect Schema at registry boundary
- Validation errors wrapped with helpful messages

### Performance Considerations

**Response Validation Performance:**
- **Not performance-critical** — validation happens once per tool call, not in hot loops
- Schema compilation memoized: `decodeUnknownEffect` closure created once per tool init
- Tool definitions cached in `InstanceState` to avoid re-initialization

**LLM Interaction Latency:**
- **No explicit latency budgets found**
- Retry configuration: `maxRetries: input.retries ?? 0` (default: no retries)
- Step limits: `agent.steps ?? Infinity` (configurable per agent)
- Tool execution timeout: Controlled by `AbortSignal` passed to tool context
- Test timeout: 30 seconds (may indicate expected upper bound)

**Performance Monitoring:**
- OpenTelemetry tracing enabled for tool execution
- Spans created with attributes: `tool.name`, `session.id`, `message.id`, `tool.call_id`
- Timing logs via `log.time(tool.id)` in registry

**Output Truncation:**
- Tools automatically truncate large outputs via `Truncate.Service`
- Metadata tracks truncation state and output file paths
- Prevents excessive token usage in LLM context

**Concurrency:**
- Tool definition resolution: `concurrency: "unbounded"` (parallel processing)
- File edit operations: Semaphore-based locking per file path to prevent conflicts
- No global tool execution concurrency limits found

### Additional Technical Constraints

**Module System:**
- ESM-only (`"type": "module"` in all packages)
- Conditional imports for Bun vs Node (e.g., `#db`, `#pty`)
- Self-reexport pattern: `export * as Tool from "./tool"` at file bottom

**Error Handling:**
- Effect-based error handling throughout
- Tools should use `Effect.orDie` for unrecoverable errors
- Validation errors must be mapped to helpful messages

**Testing Constraints:**
- Cannot mock easily (per AGENTS.md: "Avoid mocks as much as possible")
- Tests should use actual implementations
- Must run from package directories, not repo root

**Breaking Changes Risk:**
- Effect 4.0 is in beta (API may change)
- Zod 4.x is a major version (different from Zod 3.x)

---

## Summary

**Key Findings:**

1. **System Prompt Injection (D6):** Add enforcement instruction to system prompt array in `llm.ts:137` before `system.join("\n")`

2. **Response Validation (D7):** Create new validation layer in `onFinish` handler (`prompt.ts:1449-1471`) to check for empty `toolCalls` and inject synthetic call

3. **No-Op Tool (D5):** Model after `InvalidTool` or `_noop` stub, register in `ToolRegistry.layer`

4. **No Existing Patterns:** No middleware/pipeline for LLM response validation — need to create new layer

5. **Performance:** Not critical — validation happens once per response, schema compilation memoized

6. **Testing:** Run from `packages/opencode`, 30-second timeout, avoid mocks

**Integration Points:**
- `packages/opencode/src/session/llm.ts` — system prompt assembly, response handling
- `packages/opencode/src/session/prompt.ts` — `onFinish` handler for validation
- `packages/opencode/src/tool/` — new no-op tool definition
- `packages/opencode/src/tool/registry.ts` — tool registration

**Constraints:**
- Effect 4.0 beta (API may evolve)
- ESM-only, self-reexport pattern
- Effect-based error handling required
- OpenTelemetry tracing for observability
