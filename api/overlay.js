import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import fs from "fs";
import fetch from "node-fetch";
import path from "path";

export default async function handler(req, res) {
  try {
    const { backgroundUrl, overlayUrl, overlayWidth = 0.3, position = "bottomRight" } = req.body;
    const tmpDir = "/tmp";
    const bgPath = path.join(tmpDir, "background.mp4");
    const ovPath = path.join(tmpDir, "overlay.mp4");
    const outPath = path.join(tmpDir, "output.mp4");

    async function download(url, dest) {
      const r = await fetch(url);
      const fileStream = fs.createWriteStream(dest);
      await new Promise((resolve, reject) => {
        r.body.pipe(fileStream);
        r.body.on("error", reject);
        fileStream.on("finish", resolve);
      });
    }

    await Promise.all([download(backgroundUrl, bgPath), download(overlayUrl, ovPath)]);

    ffmpeg.setFfmpegPath(ffmpegPath);

    const positions = {
      bottomRight: "W-w-40:H-h-40",
      bottomLeft: "40:H-h-40",
      topRight: "W-w-40:40",
      topLeft: "40:40"
    };

    // 🟣 Apply circular mask with feathered edge
    await new Promise((resolve, reject) => {
      ffmpeg(bgPath)
        .input(ovPath)
        .complexFilter([
          // 1️⃣ Scale the overlay
          `[1:v]scale=iw*${overlayWidth}:-1[scaled];` +
          // 2️⃣ Create a circular alpha mask with soft edge
          `[scaled]format=rgba,geq=r='if(lte(sqrt((X-W/2)*(X-W/2)+(Y-H/2)*(Y-H/2)),min(W,H)/2-10),255,0)':g='if(lte(sqrt((X-W/2)*(X-W/2)+(Y-H/2)*(Y-H/2)),min(W,H)/2-10),255,0)':b='if(lte(sqrt((X-W/2)*(X-W/2)+(Y-H/2)*(Y-H/2)),min(W,H)/2-10),255,0)':a='if(lte(sqrt((X-W/2)*(X-W/2)+(Y-H/2)*(Y-H/2)),min(W,H)/2),255,0)',boxblur=15[masked];` +
          // 3️⃣ Overlay masked video on background
          `[0:v][masked]overlay=${positions[position] || positions.bottomRight}:format=auto`
        ])
        .outputOptions("-c:a copy")
        .output(outPath)
        .on("end", resolve)
        .on("error", reject)
        .run();
    });

    const video = fs.readFileSync(outPath);
    res.setHeader("Content-Type", "video/mp4");
    res.send(video);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
}
