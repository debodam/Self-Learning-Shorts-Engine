import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpegStatic from "ffmpeg-static";

// Pulls still frames out of a clip so the scorer can see who is on screen. ffmpeg seeks
// over HTTP with range requests, so only a small part of each video is downloaded.

const run = promisify(execFile);

/** Where frames are sampled, as fractions of the clip's length. */
export const FRAME_POSITIONS = [0.1, 0.5, 0.9] as const;

// FFMPEG_PATH overrides the bundled binary, for hosts that ship their own.
const ffmpegPath = () => process.env.FFMPEG_PATH?.trim() || ffmpegStatic || "ffmpeg";

/** One JPEG per position, at most 720 pixels tall (Opus previews are 406x720). */
export async function extractFrames(videoUrl: string, durationSeconds: number): Promise<Buffer[]> {
  return Promise.all(
    FRAME_POSITIONS.map(async (position) => {
      const { stdout } = await run(
        ffmpegPath(),
        [
          "-hide_banner",
          "-loglevel", "error",
          // -ss before -i seeks by keyframe without decoding the whole video.
          "-ss", (durationSeconds * position).toFixed(2),
          "-i", videoUrl,
          "-frames:v", "1",
          "-vf", "scale=-2:'min(720,ih)'",
          "-q:v", "4",
          "-f", "image2",
          "-c:v", "mjpeg",
          "pipe:1",
        ],
        { encoding: "buffer", maxBuffer: 10 * 1024 * 1024, timeout: 30_000 },
      );
      if (stdout.length === 0) throw new Error(`no frame at ${Math.round(position * 100)}%`);
      return stdout;
    }),
  );
}
