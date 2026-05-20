import { Effect, Schema } from "effect"
import * as Tool from "./tool"

export const Parameters = Schema.Struct({})

export const EnsureToolCallComplianceTool = Tool.define(
  "ensure_tool_call_compliance",
  Effect.succeed({
    description: "Internal compliance tool - do not use directly",
    parameters: Parameters,
    execute: () =>
      Effect.succeed({
        title: "",
        output: "",
        metadata: {},
      }),
  }),
)
