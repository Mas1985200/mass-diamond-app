// supabase/functions/ai-chat/video/catalog/actions.ts
// Everything that can be done with a person's own photo. One row per action.
// "live" rows are connected today; "planned" rows are designed (with where they
// will run) but not connected, so the director never offers them yet.
//
// Everything runs on the person's own phone first; the free cloud is only the
// fallback. Actions that use a face are only for the person's own photo or a
// photo of someone who agreed.

import type { PhotoAction } from "./types.ts";

export const PHOTO_ACTIONS: readonly PhotoAction[] = [
  {
    id: "animate",
    name: "Bring the photo to life",
    description:
      "the photo starts to move: the camera glides through it with real depth and the scene feels alive",
    runner: "device",
    fallback: "cloud",
    status: "live",
    usesFace: false,
    aliases: ["animate", "animatephoto", "متحرک", "متحرککن", "زندهکن", "动起来"],
  },
  {
    id: "restyle",
    name: "Change the photo's style",
    description:
      "the photo is redrawn in another look, such as anime, painting or clay, and keeps its subject",
    runner: "cloud",
    fallback: null,
    status: "planned",
    usesFace: false,
    aliases: ["restyle", "stylize", "تغییرسبک", "سبکعوضکن"],
  },
  {
    id: "talk",
    name: "Make the face talk",
    description:
      "the person in the photo speaks the given words with matching lip movement",
    runner: "device",
    fallback: "cloud",
    status: "planned",
    usesFace: true,
    aliases: ["talk", "speak", "talking", "حرفبزند", "صحبتکند", "حرفزدن", "说话"],
  },
  {
    id: "age-up",
    name: "Make the person older",
    description: "the person in the photo is shown many years older",
    runner: "device",
    fallback: "cloud",
    status: "planned",
    usesFace: true,
    aliases: ["ageup", "older", "old", "پیرکن", "پیرشدن", "پیر"],
  },
  {
    id: "age-down",
    name: "Make the person younger",
    description: "the person in the photo is shown many years younger",
    runner: "device",
    fallback: "cloud",
    status: "planned",
    usesFace: true,
    aliases: ["agedown", "younger", "young", "جوانکن", "جوانشدن", "جوان"],
  },
  {
    id: "place-in-scene",
    name: "Put the person into a scene",
    description:
      "the person is cut out of their photo and placed inside another place or landscape",
    runner: "device",
    fallback: "cloud",
    status: "planned",
    usesFace: true,
    aliases: ["placeinscene", "insert", "composite", "بگذارتوصحنه", "واردصحنهکن"],
  },
  {
    id: "bring-to-life",
    name: "Give life to an object or building",
    description:
      "an object, animal or building in the photo gets a face and speaks with moving lips",
    runner: "device",
    fallback: "cloud",
    status: "planned",
    usesFace: false,
    aliases: ["givelife", "livingobject", "جاندارکن", "بنارازندهکن"],
  },
];
