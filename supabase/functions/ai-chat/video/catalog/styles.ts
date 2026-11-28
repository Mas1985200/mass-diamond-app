// supabase/functions/ai-chat/video/catalog/styles.ts
// Every look a video can have. One row per style; add a row for a new one.
//
// A recipe describes how it looks and moves, in plain English. It never names a
// studio, an artist, a brand or a character, so the engines make an original
// picture in that kind of look. The ids "realistic", "cinematic", "animation",
// "advertising" and "educational" are the ones the app has always used and must
// keep working.

import type { VideoStyle } from "./types.ts";

export const STYLES: readonly VideoStyle[] = [
  {
    id: "anime",
    name: "Anime",
    group: "anime",
    recipe:
      "Japanese anime look: clean cel-shaded line art, large expressive eyes, vivid saturated colors, dramatic painted skies, soft glowing highlights and dynamic framing",
    aliases: ["anime", "انیمه", "انیمی", "アニメ", "动漫", "動漫", "애니메이션", "аниме"],
  },
  {
    id: "painted-fantasy",
    name: "Hand-painted fantasy",
    group: "anime",
    recipe:
      "soft hand-painted fantasy animation: lush watercolor-like backgrounds, gentle pastel palette, warm natural light, whimsical small details and a calm, dreamy pace",
    aliases: ["fantasy", "paintedfantasy", "فانتزی", "فانتزینقاشی", "نقاشیدستی"],
  },
  {
    id: "soft-3d",
    name: "Soft 3D animation",
    group: "animation",
    recipe:
      "soft 3D animated feature look: rounded friendly shapes, glossy materials, warm cinematic lighting, shallow depth of field and smooth expressive motion",
    aliases: ["3d", "3danimation", "cgi", "سهبعدی", "انیمیشنسهبعدی", "3d动画"],
  },
  {
    id: "claymation",
    name: "Clay stop-motion",
    group: "animation",
    recipe:
      "handmade clay stop-motion look: visible fingerprints in the clay, slightly jittery frame-by-frame motion, tactile miniature sets and warm studio lighting",
    aliases: ["clay", "stopmotion", "گلی", "خمیری", "استاپموشن", "粘土"],
  },
  {
    id: "classic-2d",
    name: "Classic 2D cartoon",
    group: "animation",
    recipe:
      "classic hand-drawn 2D cartoon: bold outlines, flat bright colors, squash-and-stretch motion, simple painted backgrounds and playful timing",
    aliases: ["animation", "cartoon", "classiccartoon", "کارتون", "کارتونی", "انیمیشن", "انیمیشنکلاسیک", "卡通"],
  },
  {
    id: "comic-book",
    name: "Comic book",
    group: "illustration",
    recipe:
      "comic book look: heavy ink outlines, halftone dot shading, bold flat colors, dramatic angles and punchy panel-like compositions",
    aliases: ["comic", "comics", "کمیک", "کامیک", "漫画书"],
  },
  {
    id: "manga",
    name: "Black-and-white manga",
    group: "illustration",
    recipe:
      "black-and-white manga ink drawing: fine pen lines, screentone shading, speed lines, high contrast and expressive close-ups",
    aliases: ["manga", "مانگا", "マンガ", "만화"],
  },
  {
    id: "watercolor",
    name: "Watercolor",
    group: "illustration",
    recipe:
      "flowing watercolor painting: translucent washes of color, soft bleeding edges, visible paper texture and light airy atmosphere",
    aliases: ["watercolor", "watercolour", "آبرنگ", "آبرنگی", "水彩"],
  },
  {
    id: "oil-painting",
    name: "Oil painting",
    group: "illustration",
    recipe:
      "moving oil painting: thick visible brush strokes, rich layered pigments, dramatic chiaroscuro light and a gallery-canvas texture",
    aliases: ["oilpainting", "oil", "رنگروغن", "نقاشیرنگروغن", "油画"],
  },
  {
    id: "persian-miniature",
    name: "Persian miniature",
    group: "illustration",
    recipe:
      "Persian miniature painting: ornate flat perspective, rich jewel colors with gold details, intricate patterned borders, delicate figures and gardens",
    aliases: ["persianminiature", "miniature", "مینیاتور", "نگارگری", "مینیاتورایرانی"],
  },
  {
    id: "ink-wash",
    name: "Ink wash painting",
    group: "illustration",
    recipe:
      "East Asian ink wash painting: flowing black ink gradients, misty mountains, generous empty space, minimal brush strokes and quiet contemplative motion",
    aliases: ["inkwash", "sumi", "نقاشیمرکب", "مرکبی", "水墨"],
  },
  {
    id: "paper-cutout",
    name: "Paper cut-out",
    group: "stylized",
    recipe:
      "layered paper cut-out look: flat shapes with soft drop shadows between layers, visible paper grain, slight parallax motion and a handmade craft feel",
    aliases: ["papercutout", "papercraft", "کاغذی", "برشکاغذ", "剪纸"],
  },
  {
    id: "low-poly",
    name: "Low-poly 3D",
    group: "stylized",
    recipe:
      "low-poly 3D look: faceted flat-shaded triangles, simple geometric forms, clean gradient skies and a minimal modern palette",
    aliases: ["lowpoly", "polygon", "لوپلی", "چندضلعی"],
  },
  {
    id: "pixel-art",
    name: "Pixel art",
    group: "stylized",
    recipe:
      "retro pixel art: chunky visible pixels, limited bright palette, dithered shading, crisp sprite-like characters and tile-based scenery",
    aliases: ["pixel", "pixelart", "8bit", "16bit", "پیکسل", "پیکسلی", "像素"],
  },
  {
    id: "toy-brick",
    name: "Toy brick world",
    group: "stylized",
    recipe:
      "miniature toy-brick world: everything built from small interlocking plastic blocks, glossy studs, bright primary colors and tilt-shift macro lighting",
    aliases: ["toybrick", "bricks", "blocks", "اسباببازی", "آجری", "بلوکی", "积木"],
  },
  {
    id: "neon-cyberpunk",
    name: "Neon cyberpunk",
    group: "stylized",
    recipe:
      "neon cyberpunk night city: rain-soaked streets, glowing magenta and cyan signs, deep shadows, reflective surfaces and moody atmospheric haze",
    aliases: ["cyberpunk", "neon", "سایبرپانک", "نئون", "赛博朋克"],
  },
  {
    id: "retro-vhs",
    name: "Retro 80s VHS",
    group: "retro",
    recipe:
      "1980s VHS look: soft analog blur, scan lines, color bleeding, tracking glitches, warm faded colors and synthwave sunsets",
    aliases: ["vhs", "retro", "80s", "synthwave", "رترو", "ریترو", "دههنود", "وی‌اچ‌اس"],
  },
  {
    id: "historical-bw",
    name: "Historical black and white",
    group: "retro",
    recipe:
      "old black-and-white archive footage: fine film grain, soft vignette, slight flicker, scratches and the gentle motion of early cinema",
    aliases: ["blackandwhite", "bw", "historical", "vintage", "سیاهوسفید", "تاریخی", "قدیمی", "黑白"],
  },
  {
    id: "realistic",
    name: "Realistic",
    group: "realistic",
    recipe:
      "natural realistic footage: true-to-life colors and textures, soft natural light, steady believable camera movement and fine real-world detail",
    aliases: ["realistic", "real", "photorealistic", "واقعی", "واقعگرایانه", "真实"],
  },
  {
    id: "cinematic",
    name: "Cinematic",
    group: "realistic",
    recipe:
      "cinematic film look: widescreen composition, shallow depth of field, graded teal-and-orange color, dramatic lighting and smooth sweeping camera moves",
    aliases: ["cinematic", "film", "movie", "سینمایی", "فیلمی", "电影感"],
  },
  {
    id: "advertising",
    name: "Commercial advertisement",
    group: "purpose",
    recipe:
      "polished commercial look: bright even lighting, product-forward framing, premium clean colors, smooth gliding camera and crisp high-end detail",
    aliases: ["advertising", "advert", "commercial", "ad", "تبلیغاتی", "تبلیغ", "广告"],
  },
  {
    id: "educational",
    name: "Educational explainer",
    group: "purpose",
    recipe:
      "clear educational explainer look: simple clean compositions, readable shapes, calm steady pacing, a bright neutral palette and gentle highlights that guide the eye",
    aliases: ["educational", "education", "explainer", "آموزشی", "آموزش", "教育"],
  },
];
