import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { EnsureToolCallComplianceTool } from "../../src/tool/ensure-compliance"
import { Agent } from "@/agent/agent"
import { Truncate } from "@/tool/truncate"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(Agent.defaultLayer, Truncate.defaultLayer))

describe("EnsureToolCallComplianceTool", () => {
  it.live("is registered with the expected id", () =>
    Effect.gen(function* () {
      const toolInfo = yield* EnsureToolCallComplianceTool
      expect(toolInfo.id).toBe("ensure_tool_call_compliance")
    }),
  )
})
