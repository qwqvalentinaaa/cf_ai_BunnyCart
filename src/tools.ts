/**
 * Tool definitions for the AI chat agent
 * Tools can either require human confirmation or execute automatically
 */
import { tool, type ToolSet } from "ai";
import { z } from "zod/v3";

import type { Chat } from "./server";
import { getCurrentAgent } from "agents";
import { scheduleSchema } from "agents/schedule";
import type { RecommendationOutput } from "./workflows/product-recommendation";
import type { Workflow } from "@cloudflare/workers-types";

type Env = {
  PRODUCT_RECOMMENDATION: Workflow;
};

/**
 * Weather information tool that requires human confirmation
 */
const getWeatherInformation = tool({
  description: "Show the weather in a given city to the user",
  inputSchema: z.object({ city: z.string() })
  // Omitting execute makes this tool require human confirmation
});

/**
 * Product recommendation tool factory
 * Wraps the workflow in a tool so the AI can call it
 */
export function makeProductRecommendationTool(env: Env) {
  return tool<{
    query: string;
    minPrice?: string;
    maxPrice?: string;
  }, RecommendationOutput>({
    description: "Recommend products for user",
    inputSchema: z.object({
      query: z.string(),
      minPrice: z.string().optional(),
      maxPrice: z.string().optional(),
    }),
    execute: async ({ query, minPrice, maxPrice }) => {
      console.log(`Running product recommendation for query: ${query}`);
      const minPriceNum = Number(minPrice)
      const maxPriceNum = Number(maxPrice)

      const instance = await env.PRODUCT_RECOMMENDATION.create({
        id: crypto.randomUUID(),
        params: { query, minPriceNum, maxPriceNum },
      });
      let status = await instance.status();
      while (status.status !== "complete" && status.status !== "errored") {
        await new Promise((r) => setTimeout(r, 500)); // wait 500ms
        status = await instance.status();
      }

      if (status.status === "errored") {
        throw new Error(`Workflow failed: ${status}`);
      }

      return status.output as RecommendationOutput;
    },
  });
}

/**
 * Local time tool that executes automatically
 */
const getLocalTime = tool({
  description: "Get the local time for a specified location",
  inputSchema: z.object({ location: z.string() }),
  execute: async ({ location }) => {
    console.log(`Getting local time for ${location}`);
    return "10am";
  }
});

const scheduleTask = tool({
  description: "A tool to schedule a task to be executed at a later time",
  inputSchema: scheduleSchema,
  execute: async ({ when, description }) => {
    console.log("scheduling");
    const { agent } = getCurrentAgent<Chat>();

    function throwError(msg: string): string {
      throw new Error(msg);
    }
    const input =
      when.type === "scheduled"
        ? when.date
        : when.type === "delayed"
          ? when.delayInSeconds
          : when.type === "cron"
            ? when.cron
            : throwError("Not a valid schedule input");
    try {
      agent!.schedule(input!, "executeTask", description);
    } catch (error) {
      console.error("Error scheduling task", error);
      return `Error scheduling task: ${error}`;
    }
    return `Task scheduled for type "${when.type}" : ${input}`;
  }
});

const getScheduledTasks = tool({
  description: "List all tasks that have been scheduled",
  inputSchema: z.object({}),
  execute: async () => {
    const { agent } = getCurrentAgent<Chat>();

    try {
      const tasks = agent!.getSchedules();
      return tasks?.length ? tasks : "No scheduled tasks found.";
    } catch (error) {
      console.error("Error listing scheduled tasks", error);
      return `Error listing scheduled tasks: ${error}`;
    }
  }
});

const cancelScheduledTask = tool({
  description: "Cancel a scheduled task using its ID",
  inputSchema: z.object({
    taskId: z.string().describe("The ID of the task to cancel")
  }),
  execute: async ({ taskId }) => {
    const { agent } = getCurrentAgent<Chat>();
    try {
      await agent!.cancelSchedule(taskId);
      return `Task ${taskId} has been successfully canceled.`;
    } catch (error) {
      console.error("Error canceling scheduled task", error);
      return `Error canceling task ${taskId}: ${error}`;
    }
  }
});

/**
 * Export all available tools
 * Product recommendation tool must be created with env at runtime
 */
export const tools = (env: Env) => ({
  getWeatherInformation,
  getLocalTime,
  scheduleTask,
  getScheduledTasks,
  cancelScheduledTask,
  productRecommendation: makeProductRecommendationTool(env)
} satisfies ToolSet);

/**
 * Implementation of confirmation-required tools
 */
export const executions = {
  getWeatherInformation: async ({ city }: { city: string }) => {
    console.log(`Getting weather information for ${city}`);
    return `The weather in ${city} is sunny`;
  }
};
