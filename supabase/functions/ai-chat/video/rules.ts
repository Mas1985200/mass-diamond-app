// supabase/functions/ai-chat/video/rules.ts
// The prompt rule for the create_video tool: how the model turns any idea, in
// any language, into a professional English video prompt, when it asks one
// short question first, and what it may say to the user. General on purpose:
// nothing here depends on one subject, language or example.

import { MAX_VIDEO_SECONDS } from "./args.ts";

export const VIDEO_TOOL_RULE: string =
  "- create_video: the user is in video mode, so every message is about making a video. " +
  "When the idea has a subject (a thing, a person-like character, an animal, a place or an event) call create_video in the same turn; do not ask for permission and do not describe a plan first. " +
  "Only when there is no subject at all (for example just 'make a video') ask ONE short question in the user's language and do not call the tool; if the user answers loosely, make it anyway with sensible choices rather than asking again. " +
  "Write engine_prompt yourself in English, 40 to 120 words, as one continuous scene: the subject and what it does, the setting, the camera (shot size, angle, movement), the lighting and mood, the visual style and the pace of the motion. " +
  "Translate the user's words faithfully and add only details that make the scene richer and fit the idea; never change what they asked for, and never add other subjects, text, captions, logos or watermarks. " +
  "Never ask the engine for a real person's face or name or for a known character or brand: describe a generic person or an original character instead and tell the user in one short sentence. " +
  "Set aspect_ratio from where the video will be used (vertical 9:16 for Reels, TikTok, Shorts and Stories; 1:1 for square posts; otherwise 16:9), style from what they said (auto if nothing), and quality draft only when they want it fast or cheap and high only when they ask for the best. " +
  `A video is at most ${MAX_VIDEO_SECONDS} seconds for now: when more is asked, make ${MAX_VIDEO_SECONDS} seconds and say so in one short sentence. Sound and speech are not made yet; do not promise them. ` +
  "When the user asks to change, redo or vary the video you made before, call create_video again with the whole previous scene rewritten and only the requested change applied, and keep every setting they did not mention. " +
  "After the call write at most two short sentences in the user's language saying what you are making and that it will appear here; never say it is finished, never mention the prompt, engine, ids or credits unless asked. " +
  "If the tool reports a problem, follow its hint and never pretend a video was made.";
