export type WeeklyLearning = {
  id: string;
  /** ISO dates, inclusive. */
  weekStart: string;
  weekEnd: string;
  whatWorked: string[];
  whatChanged: string[];
  why: string;
};
