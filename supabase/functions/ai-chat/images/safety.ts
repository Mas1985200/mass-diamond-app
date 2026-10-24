// supabase/functions/ai-chat/images/safety.ts
// One place that decides whether the topic of a picture is sexually explicit.
// Every picture source asks it BEFORE searching, so no source (Commons,
// Unsplash, Openverse, the web) is ever asked for such a picture, whatever the
// topic, the wording or the language of the chat. Whole words are required, so
// look-alike words (Essex, Janus, nudibranch, sexual dimorphism of animals)
// do not match. Anatomy and sex education stay available as plain text; only
// pictures are never shown.

const EXPLICIT_WORD =
  /(?<![\p{L}\p{N}])(?:sex|sexual(?!\s+(?:dimorphism|selection|reproduction))|sexuality|nude|nudes|nudity|topless|porn|porno|pornography|pornographic|erotic|erotica|genitals?|genitalia|penis|penises|vagina|vaginas|vulva|vulvae|clitoris|testicles?|scrotum|anus|masturbation|fellatio|cunnilingus|shunga|kamasutra|kama sutra|naked (?:man|men|woman|women|people|person|girls?|boys?|child|children))(?![\p{L}\p{N}])/iu;

// Stems in other languages (matched at the start of a word).
const EXPLICIT_STEM =
  /(?<![\p{L}\p{N}])(?:erot|эрот|порн|desnud|nackt|pornogr|اروتیک|پورن|برهنه|عریان|عريان|جنسی|جنسية)/iu;

export function isExplicitTopic(text: string): boolean {
  const value = text.trim();

  return (
    value.length > 0 &&
    (EXPLICIT_WORD.test(value) || EXPLICIT_STEM.test(value))
  );
}
