import { exec } from "child_process";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import express from "express";
import bodyParser from "body-parser";

const app = express();
app.use(bodyParser.json({ limit: "100mb" }));

app.post("/api/gif", async (req, res) => {
  try {
    const { videoUrl } = req.body;
    if (!videoUrl) return res.status(400).json({ error: "Missing videoUrl" });

    const id = uuidv4();
    const videoPath = path.join("/tmp", `${id}.mp4`);
    const gifPath = path.join("/tmp", `${id}.gif`);
    const playIconPath = path.join(process.cwd(), "public", "play.png"); // upload a white play icon to /public

    // Download the video
    await new Promise((resolve, reject) => {
      exec(`curl -L "${videoUrl}" -o "${videoPath}"`, (err) => (err ? reject(err) : resolve()));
    });

    // Generate GIF (first 5 seconds, 480px wide)
    const cmd = `
      ffmpeg -t 5 -i "${videoPath}" -vf "scale=480:-1,fps=10" -loop 0 "${gifPath}"
    `;
    await new Promise((resolve, reject) => {
      exec(cmd, (err) => (err ? reject(err) : resolve()));
    });

    // Overlay play button in center
    const finalGif = path.join("/tmp", `${id}-final.gif`);
    const overlayCmd = `
      ffmpeg -i "${gifPath}" -i "${playIconPath}" \
      -filter_complex "overlay=(main_w-overlay_w)/2:(main_h-overlay_h)/2" \
      -y "${finalGif}"
    `;
    await new Promise((resolve, reject) => {
      exec(overlayCmd, (err) => (err ? reject(err) : resolve()));
    });

    const gifBuffer = fs.readFileSync(finalGif);
    const base64Gif = gifBuffer.toString("base64");

    res.json({ success: true, gif: `data:image/gif;base64,${base64Gif}` });

    // cleanup
    fs.unlinkSync(videoPath);
    fs.unlinkSync(gifPath);
    fs.unlinkSync(finalGif);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(3000, () => console.log("✅ GIF API running"));
