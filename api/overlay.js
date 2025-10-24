import ffmpegPath from "ffmpeg-static";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs-extra";
import path from "path";
import fetch from "node-fetch";
import os from "os";

ffmpeg.setFfmpegPath(ffmpegPath); // ✅ ensures ffmpeg is found, even on Vercel

export default async function handler(req, res) {
  try {
    const { backgroundUrl, overlayUrl, overlayWidth = 0.3, position = "bottomLeft" } = req.body;

    if (!backgroundUrl || !overlayUrl) {
      return res.status(400).json({ error: "Missing backgroundUrl or overlayUrl" });
    }

    const tmpDir = path.join(os.tmpdir(), `overlay-${Date.now()}`);
    await fs.ensureDir(tmpDir);

    const backgroundPath = path.join(tmpDir, "background.mp4");
    const overlayPath = path.join(tmpDir, "overlay.mp4");
    const outputPath = path.join(tmpDir, "output.mp4");

    // download helper
    const downloadFile = async (url, dest) => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`Failed to download: ${url}`);
      const b = await r.arrayBuffer();
      await fs.writeFile(dest, Buffer.from(b));
    };

    await Promise.all([
      downloadFile(backgroundUrl, backgroundPath),
      downloadFile(overlayUrl, overlayPath)
    ]);

    // Define overlay positions
    const posMap = {
      topLeft: "10:10",
      topRight: "(main_w-overlay_w-10):10",
      bottomLeft: "10:(main_h-overlay_h-10)",
      bottomRight: "(main_w-overlay_w-10):(main_h-overlay_h-10)",
      center: "(main_w-overlay_w)/2:(main_h-overlay_h)/2"
    };
    const pos = posMap[position] || posMap.bottomLeft;

    // 🧠 Proper FFmpeg call using fluent-ffmpeg
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(backgroundPath)
        .input(overlayPath)
        .complexFilter([
          `[1:v]scale=iw*${overlayWidth}:-1[overlay_scaled];[0:v][overlay_scaled]overlay=${pos}`
        ])
        .outputOptions(["-pix_fmt yuv420p", "-c:a copy"])
        .save(outputPath)
        .on("end", resolve)
        .on("error", reject);
    });

    const buffer = await fs.readFile(outputPath);
    res.setHeader("Content-Type", "video/mp4");
    res.status(200).send(buffer);

    // Cleanup
    await fs.remove(tmpDir);
  } catch (err) {
    console.error("Overlay Error:", err)
