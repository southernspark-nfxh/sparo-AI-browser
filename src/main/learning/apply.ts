import type { Lesson } from "./types.js";

export function planFromLessons(lessons: Lesson[]): {
  pause: boolean;
  dismiss: boolean;
  notes: string[];
} {
  let pause = false;
  let dismiss = false;
  const notes: string[] = [];
  for (const l of lessons) {
    if (l.advice === "dismiss_overlay") dismiss = true;
    if (l.advice === "pause" || l.advice === "wait_human") pause = true;
    if (l.note) notes.push(l.note);
  }
  return { pause, dismiss, notes };
}
