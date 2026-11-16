// src/features/video/useVideoCredits.ts
// React hook of the credit display: it asks the video function how many
// credits are left this month each time "active" turns on (the model list is
// opened), so the number is fresh when it is looked at. All rules live in
// videoCredits.ts and videoApi.ts; this file only joins them to React.
//
// When the credits cannot be read (no internet, signed out, an error) the
// answer is null and nothing is shown: a missing number is better than a wrong
// one. A reply that arrives after the list was closed again is ignored.

import { useEffect, useState } from "react";

import { videoCreditsApi } from "./videoClient.ts";
import type { CreditsStatus } from "./videoCredits.ts";

export function useVideoCredits(active: boolean): CreditsStatus | null {
  const [credits, setCredits] = useState<CreditsStatus | null>(null);

  useEffect(() => {
    if (!active) {
      return;
    }

    const controller = new AbortController();

    void videoCreditsApi.credits(controller.signal).then((outcome) => {
      if (controller.signal.aborted) {
        return;
      }

      setCredits(
        outcome.kind === "answer" && outcome.answer.ok
          ? outcome.answer.credits
          : null,
      );
    });

    return () => controller.abort();
  }, [active]);

  return credits;
}

// end of useVideoCredits.ts
