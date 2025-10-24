import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import path from "path";
import { tmpdir } from "os";
import fetch from "node-fetch";

export default async function handler(req, res) {
  try {
    const { backgroundUrl, overlayUrl, overlayWidth = 0.3, position = "bottomLeft" } = req.body;

    if (!backgroundUrl || !overlayUrl) {
      return res.status(400).json({ error: "Missing backgroundUrl or overlayUrl" });
    }

    const bgPath = path.join(tmpdir(), "bg.mp4");
    const ovPath = path.join(tmpdir(), "ov.mp4");
    const outputPath = path.join(tmpdir(), `output-${Date.now()}.mp4`);

    // Download both videos
    const download = async (url, dest) => {
      const res = await fetch(url);
      const file = fs.createWriteStream(dest);
      await new Promise((resolve, reject) => {
        res.body.pipe(file);
        res.body.on("error", reject);
        file.on("finish", resolve);
      });
    };

    await download(backgroundUrl, bgPath);
    await download(overlayUrl, ovPath);

    // Position mapping
    const positions = {
      bottomLeft: { x: "50", y: "H-h-50" },
      bottomRight: { x: "W-w-50", y: "H-h-50" },
      topLeft: { x: "50", y: "50" },
      topRight: { x: "W-w-50", y: "50" },
      center: { x: "(W-w)/2", y: "(H-h)/2" },
    };
    const pos = positions[position] || positions.bottomLeft;

    // Run ffmpeg with circular mask
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(bgPath)
        .input(ovPath)
        .complexFilter([
          // 1️⃣ Scale overlay
          `[1:v]scale=iw*${overlayWidth}:ih*${overlayWidth}[ov];` +
          // 2️⃣ Create circular alpha mask and apply it
          `[ov]format=rgba,geq='if(lte((X-W/2)^2+(Y-H/2)^2,(min(W,H)/2)^2),255,0)':128:128:128[masked];` +
          // 3️⃣ Overlay masked clip onto background
          `[0:v][masked]overlay=${pos.x}:${pos.y}:format=auto`
        ])
        .outputOptions("-movflags +faststart")
        .output(outputPath)
        .on("end", resolve)
        .on("error", reject)
        .run();
    });

    const videoBuffer = fs.readFileSync(outputPath);
    res.setHeader("Content-Type", "video/mp4");
    res.send(videoBuffer);

    fs.unlinkSync(bgPath);
    fs.unlinkSync(ovPath);
    fs.unlinkSync(outputPath);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}

