import ffmpegPath from "ffmpeg-static";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs-extra";
import path from "path";
import fetch from "node-fetch";
import os from "os";
import { createClient } from "@supabase/supabase-js";

ffmpeg.setFfmpegPath(ffmpegPath);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  try {
    const { backgroundUrl, overlayUrl, overlayWidth = 0.3, position = "bottomRight" } = req.body;
    if (!backgroundUrl || !overlayUrl)
      return res.status(400).json({ error: "Missing backgroundUrl or overlayUrl" });

    const tmpDir = path.join(os.tmpdir(), `overlay-${Date.now()}`);
    await fs.ensureDir(tmpDir);

    const backgroundPath = path.join(tmpDir, "background.mp4");
    const overlayPath = path.join(tmpDir, "overlay.mp4");
    const outputPath = path.join(tmpDir, "output.mp4");

    // Download input videos
    const downloadFile = async (url, dest) => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`Failed to download ${url}`);
      const b = await r.arrayBuffer();
      await fs.writeFile(dest, Buffer.from(b));
    };

    await Promise.all([
      downloadFile(backgroundUrl, backgroundPath),
      downloadFile(overlayUrl, overlayPath)
    ]);

    // Position map
    const pos = {
      bottomRight: "(main_w-overlay_w-40):(main_h-overlay_h-40)",
      bottomLeft: "40:(main_h-overlay_h-40)",
      topRight: "(main_w-overlay_w-40):40",
      topLeft: "40:40",
      center: "(main_w-overlay_w)/2:(main_h-overlay_h)/2"
    }[position] || "(main_w-overlay_w-40):(main_h-overlay_h-40)";

    // FFmpeg circular overlay with soft edges
    await new Promise((resolve, reject) => {
      ffmpeg(backgroundPath)
        .input(overlayPath)
        .complexFilter([
          // Scale and create circular mask with feathered edges
          `[1:v]scale=iw*${overlayWidth}:-1,format=rgba,geq='if(lte(hypot(X-W/2,Y-H/2),(min(W,H)/2-10)),255,(255-((hypot(X-W/2,Y-H/2)-(min(W,H)/2-10))*25)))*between(hypot(X-W/2,Y-H/2),(min(W,H)/2-10),(min(W,H)/2))':128:128:128[masked];`,
          `[0:v][masked]overlay=${pos}:format=auto`
        ])
        .outputOptions([
          "-pix_fmt yuv420p",
          "-preset ultrafast",
          "-movflags +faststart"
        ])
        .save(outputPath)
        .on("end", resolve)
        .on("error", reject);
    });

    // Upload to Supabase
    const videoBuffer = await fs.readFile(outputPath);
    const fileName = `final_${Date.now()}.mp4`;
    const { data, error } = await supabase
      .storage
      .from(process.env.SUPABASE_BUCKET)
      .upload(fileName, videoBuffer, {
        contentType: "video/mp4",
        upsert: true
      });

    if (error) throw new Error("Supabase upload failed: " + error.message);

    const { publicURL } = supabase
      .storage
      .from(process.env.SUPABASE_BUCKET)
      .getPublicUrl(fileName);

    // Return public URL
    res.status(200).json({
      success: true,
      url: publicURL
    });

    // Cleanup
    await fs.remove(tmpDir);
  } catch (err) {
  console.error("Overlay API Error:", err);
  return res.status(500).json({ 
    error: err.message || "Unknown error",
    stack: err.stack
  });
}

}
