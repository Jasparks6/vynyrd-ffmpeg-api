import fs from "fs-extra";
import path from "path";
import ffmpegPath from "ffmpeg-static";
import ffmpeg from "fluent-ffmpeg";
import fetch from "node-fetch";

ffmpeg.setFfmpegPath(ffmpegPath);

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { backgroundUrl, overlayUrl, overlayWidth = 0.3, position = "bottomLeft" } = req.body;
    if (!backgroundUrl || !overlayUrl) {
      return res.status(400).json({ error: "Missing required URLs" });
    }

    const tmpDir = "/tmp";
    const backgroundPath = path.join(tmpDir, "background.mp4");
    const overlayPath = path.join(tmpDir, "overlay.mp4");
    const outputPath = path.join(tmpDir, "output.mp4");

    // Download both videos
    const downloadFile = async (url, dest) => {
      const response = await fetch(url);
      const buffer = await response.arrayBuffer();
      await fs.writeFile(dest, Buffer.from(buffer));
    };
    await Promise.all([
      downloadFile(backgroundUrl, backgroundPath),
      downloadFile(overlayUrl, overlayPath)
    ]);

    // Create circular overlay mask
    const overlayCircle = path.join(tmpDir, "circle_overlay.mp4");
    await new Promise((resolve, reject) => {
      ffmpeg(overlayPath)
        .complexFilter([
          "format=rgba",
          "geq='r(X,Y)':'g(X,Y)':'b(X,Y)':if(lt((X-W/2)*(X-W/2)+(Y-H/2)*(Y-H/2),(min(W,H)/2)^2),255,0)"
        ])
        .save(overlayCircle)
        .on("end", resolve)
        .on("error", reject);
    });

    // Position
    const posMap = {
      bottomLeft: "10:(main_h-overlay_h-10)",
      bottomRight: "(main_w-overlay_w-10):(main_h-overlay_h-10)",
      topLeft: "10:10",
      topRight: "(main_w-overlay_w-10):10"
    };
    const overlayPos = posMap[position] || "10:(main_h-overlay_h-10)";

    // Merge videos
    await new Promise((resolve, reject) => {
      ffmpeg(backgroundPath)
        .input(overlayCircle)
        .complexFilter([`[0:v][1:v] overlay=${overlayPos}:format=auto`])
        .outputOptions(["-c:v libx264", "-c:a aac"])
        .save(outputPath)
        .on("end", resolve)
        .on("error", reject);
    });

    const fileBuffer = await fs.readFile(outputPath);
    res.setHeader("Content-Type", "video/mp4");
    res.send(fileBuffer);

    // Cleanup
    await fs.remove(backgroundPath);
    await fs.remove(overlayPath);
    await fs.remove(outputPath);
    await fs.remove(overlayCircle);
  } catch (error) {
    console.error("FFmpeg Error:", error);
    res.status(500).json({ error: error.message || "FFmpeg processing failed" });
  }
}
