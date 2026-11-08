// supabase/functions/ai-chat/tools/video.ts
// create_video tool: starts a video in the video function and shows a video
// card (progress, then the video) under the answer. The model writes the
// professional prompt itself; this file checks it, starts the video and tells
// the model, in plain words, what happened so it can answer the person.

import type { ToolContext, ToolDefinition, ToolOutcome } from "../types.ts";
import { parseCreateVideoArgs, MAX_VIDEO_SECONDS } from "../video/args.ts";
import type { VideoCreateFailure } from "../video/port.ts";

export const CREATE_VIDEO_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "create_video",
    description:
      "Starts making a real AI video. Use it when the user's idea for a video is clear enough to make, or when they ask to change, redo or vary the video you made before (write the whole new prompt, changing only what they asked). If the idea is too vague to make a good video (no subject at all), do NOT call it: ask ONE short question in the user's language instead. The app shows a progress card and then the video under your answer; write at most two short sentences after the call and never claim the video is finished.",
    parameters: {
      type: "object",
      properties: {
        idea: {
          type: "string",
          description:
            "What the user asked for, in one short sentence in the user's own language (shown in their history).",
        },
        engine_prompt: {
          type: "string",
          description:
            "The full professional prompt for the video engine, ALWAYS in English, 40 to 120 words: the main subject and what it does, the setting, the camera (shot size, angle and movement), the lighting and mood, the visual style, and the pace of the motion. Describe one continuous scene. No on-screen text, captions, logos or watermarks; never ask for a real person's face or name.",
        },
        style: {
          type: "string",
          enum: ["auto", "realistic", "cinematic", "animation", "advertising", "educational"],
          description: "The visual style. Use auto when the user did not say.",
        },
        aspect_ratio: {
          type: "string",
          enum: ["16:9", "9:16", "1:1"],
          description:
            "16:9 for normal wide video and YouTube; 9:16 for Reels, TikTok, Shorts and Stories (vertical); 1:1 for square feed posts. Default 16:9.",
        },
        duration_seconds: {
          type: "integer",
          description: `Length in seconds, 1 to ${MAX_VIDEO_SECONDS}. Default ${MAX_VIDEO_SECONDS}. Longer videos are not possible yet.`,
        },
        quality: {
          type: "string",
          enum: ["draft", "standard", "high"],
          description:
            "draft is fast and cheap, standard is the default, high is the best look and costs the most credits.",
        },
        model: {
          type: "string",
          description:
            'Only when the user asked for one specific video model by name. Otherwise leave it out (the app picks the best one).',
        },
      },
      required: ["idea", "engine_prompt"],
    },
  },
};

const FAILURE_HINTS: Readonly<Record<VideoCreateFailure, string>> = {
  quota_exceeded:
    "The user's video credits for this month are used up. Tell them so in one or two short sentences in their language, say they can try again next month or upgrade their plan, and do not start the video.",
  engine_unavailable:
    "No video engine is available right now. Tell the user in one short sentence that video making is temporarily unavailable and to try again in a little while. Never pretend a video was made.",
  unsupported:
    "The video engine cannot make this combination (for example a length or shape that is not supported). Tell the user in one short sentence and suggest a simpler setting. Never pretend a video was made.",
  invalid:
    "The request was refused as invalid. Tell the user in one short sentence that you could not start the video and ask them to describe it again. Never pretend a video was made.",
  not_signed_in:
    "The user is not signed in, so no video can be made. Tell them in one short sentence to sign in again.",
  temporary:
    "A temporary problem stopped the video from starting and nothing was charged for it. Tell the user in one short sentence to try again in a moment. Never pretend a video was made.",
};

export async function runCreateVideo(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  if (!ctx.video) {
    return { data: { status: "video_unavailable" } };
  }

  const parsed = parseCreateVideoArgs(args);
  if (!parsed.ok) {
    return { data: { status: "invalid", hint: parsed.hint } };
  }
  const video = parsed.value;

  const result = await ctx.video.create(video, {
    // The same settings in the same chat turn are the same video.
    requestKey: JSON.stringify([
      video.enginePrompt,
      video.style,
      video.aspectRatio,
      video.durationSeconds,
      video.quality,
      video.model,
    ]),
  });

  if (!result.ok) {
    return {
      data: {
        status: result.code,
        retryable: result.retryable,
        ...(result.quota ? { used: result.quota.used, quota: result.quota.quota } : {}),
        hint: FAILURE_HINTS[result.code],
      },
    };
  }

  const quality =
    result.quality === "draft" || result.quality === "high" ? result.quality : "standard";
  const shape =
    result.aspectRatio === "9:16" || result.aspectRatio === "1:1" ? result.aspectRatio : "16:9";

  return {
    data: {
      status: result.existing ? "already_started" : "started",
      aspect_ratio: shape,
      duration_seconds: result.durationSeconds,
      quality,
      hint: "The video is being made now; the app shows a progress card under your answer and the video appears in it when ready (usually a few minutes). Write one or two short sentences in the user's language: what you are making, in plain words, and that it will appear right here. Never say it is finished, and never mention ids, prompts, engines or credits unless asked.",
    },
    cards: [
      {
        t: "video",
        lang: ctx.lang,
        jobId: result.jobId,
        aspectRatio: shape,
        durationSeconds: result.durationSeconds,
        quality,
      },
    ],
  };
}
