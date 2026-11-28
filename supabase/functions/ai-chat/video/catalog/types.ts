// supabase/functions/ai-chat/video/catalog/types.ts
// The shapes of the video catalog: every look (style) a video can have and
// every thing that can be done with a person's own photo is ONE row of data.
// A new viral style or a new photo ability is a new row, not new code: the
// director, the tool settings and the checks all read the rows.
//
// Pure types: no network, no Deno, so everything built on them is tested.

// Where work runs first. The person's own phone is always tried first (it costs
// nothing and has no limit); the free cloud is only the fallback.
export type Runner = "device" | "cloud";

// "live" = connected and working today. "planned" = designed but not connected
// yet: it is never offered to the person and the status report shows it as not
// built, so nothing is promised that does not exist.
export type Availability = "live" | "planned";

export type StyleGroup =
  | "anime"
  | "animation"
  | "illustration"
  | "stylized"
  | "retro"
  | "realistic"
  | "purpose";

export interface VideoStyle {
  // Stable id: lowercase words joined by "-". Never renamed once shipped.
  readonly id: string;
  // The English name the director translates into the person's language.
  readonly name: string;
  readonly group: StyleGroup;
  // The look, in plain English, added to the prompt of the picture or video
  // engine. It describes how it looks; it never names a studio, an artist, a
  // brand or a character.
  readonly recipe: string;
  // Other words people use for it, in any language. They only help to
  // recognise what the person means; they are never sent to an engine.
  readonly aliases: readonly string[];
}

export type PhotoActionId =
  | "animate"
  | "restyle"
  | "talk"
  | "age-up"
  | "age-down"
  | "place-in-scene"
  | "bring-to-life";

export interface PhotoAction {
  readonly id: PhotoActionId;
  readonly name: string;
  // One plain sentence for the director: what the person gets.
  readonly description: string;
  readonly runner: Runner;
  // Where it goes when the first choice cannot do it, or null.
  readonly fallback: Runner | null;
  readonly status: Availability;
  // True when the action changes or animates a real person's face. Only the
  // person's own photo, or a photo of someone who agreed, may be used.
  readonly usesFace: boolean;
  readonly aliases: readonly string[];
}
