import ffmpegPath from "ffmpeg-static";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";
import os from "os";

ffmpeg.setFfmpegPath(ffmpegPath);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { backgroundUrl, overlayUrl, overlayWidth = 0.3, position = "bottomRight" } = req.body || {};

    if (!backgroundUrl || !overlayUrl) {
      return res.status(400).json({ error: "Missing backgroundUrl or overlayUrl" });
    }

    // Temporary working directory
    const tmpDir = path.join(os.tmpdir(), `overlay-${Date.now()}`);
    await fs.ensureDir(tmpDir);

    const backgroundPath = path.join(tmpDir, "background.mp4");
    const overlayPath = path.join(tmpDir, "overlay.mp4");
    const outputPath = path.join(tmpDir, "output.mp4");
    const maskPath = path.join(tmpDir, "mask.png");

    // Download both videos
    await downloadFile(backgroundUrl, backgroundPath);
    await downloadFile(overlayUrl, overlayPath);

    // Create circular mask (white circle on black background)
    await createCircularMask(maskPath, 720);

    // Define position logic
    const positions = {
      bottomRight: "(main_w-overlay_w-20):(main_h-overlay_h-20)",
      bottomLeft: "20:(main_h-overlay_h-20)",
      topRight: "(main_w-overlay_w-20):20",
      topLeft: "20:20",
      center: "(main_w-overlay_w)/2:(main_h-overlay_h)/2"
    };

    const overlayPosition = positions[position] || positions.bottomRight;

    // FFmpeg command
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(backgroundPath)
        .input(overlayPath)
        .input(maskPath)
        .complexFilter([
          // Resize overlay video
          `[1:v]scale=iw*${overlayWidth}:-1[resized];` +
          // Resize mask to same size as overlay
          `[2:v]scale=iw*${overlayWidth}:-1[mask];` +
          // Apply circular mask to overlay
          `[resized][mask]alphamerge[masked];` +
          // Overlay masked video onto background
          `[0:v][masked]overlay=${overlayPosition}[outv]`
        ], "outv")
        .outputOptions([
          "-map [outv]",
          "-map 0:a?",
          "-c:v libx264",
          "-pix_fmt yuv420p"
        ])
        .output(outputPath)
        .on("end", resolve)
        .on("error", reject)
        .run();
    });

    const outputBuffer = await fs.readFile(outputPath);
    res.setHeader("Content-Type", "video/mp4");
    res.status(200).send(outputBuffer);

    // Cleanup
    await fs.remove(tmpDir);
  } catch (err) {
    console.error("FFmpeg overlay error:", err);
    res.status(500).json({ error: err.message });
  }
}

// Utility to download file
async function downloadFile(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.statusText}`);
  const buffer = await res.arrayBuffer();
  await fs.writeFile(dest, Buffer.from(buffer));
}

// Create circular mask PNG
async function createCircularMask(outputPath, size) {
  const { createCanvas } = await import("canvas");
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, size, size);
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fillStyle = "white";
  ctx.fill();

  const buffer = canvas.toBuffer("image/png");
  await fs.writeFile(outputPath, buffer);
}
