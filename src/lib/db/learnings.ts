import "server-only";
import { connection } from "next/server";
import { getDb } from "@/lib/db/client";
import type { WeeklyLearning } from "@/lib/learnings";
import { mockWeeklyLearnings } from "@/lib/mock/weekly-learnings";

/** Weekly learning reports, newest first. */
export async function getWeeklyLearnings(): Promise<WeeklyLearning[]> {
  await connection();
  const db = getDb();
  if (!db) return mockWeeklyLearnings;

  const { data, error } = await db
    .from("learnings")
    .select("id, week_start, what_worked, what_changed, reasoning")
    .order("week_start", { ascending: false });
  if (error) throw new Error(`Failed to load learnings: ${error.message}`);

  return data.map((row) => ({
    id: row.id,
    weekStart: row.week_start,
    weekEnd: addDays(row.week_start, 6),
    whatWorked: row.what_worked,
    whatChanged: row.what_changed,
    why: row.reasoning,
  }));
}

function addDays(isoDate: string, days: number) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
