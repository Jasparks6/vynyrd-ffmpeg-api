import { exec } from "child_process";
import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import { promisify } from "util";
import os from "os";

const execPromise = promisify(exec);

export default async function handler(req, res) {
  try {
    const { backgroundUrl, overlayUrl, overlayWidth = 0.3, position = "bottomLeft" } = req.body;

    if (!backgroundUrl || !overlayUrl) {
      return res.status(400).json({ error: "Missing backgroundUrl or overlayUrl" });
    }

    // Download both videos to temp directory
    const tmpDir = os.tmpdir();
    const backgroundPath = path.join(tmpDir, "background.mp4");
    const overlayPath = path.join(tmpDir, "overlay.mp4");
    const outputPath = path.join(tmpDir, `output_${Date.now()}.mp4`);

    const downloadFile = async (url, outputPath) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Failed to download file: ${response.statusText}`);
      const buffer = await response.arrayBuffer();
      fs.writeFileSync(outputPath, Buffer.from(buffer));
    };

    await downloadFile(backgroundUrl, backgroundPath);
    await downloadFile(overlayUrl, overlayPath);

    // Determine overlay position
    let positionFilter;
    switch (position) {
      case "topLeft":
        positionFilter = "x=0:y=0";
        break;
      case "topRight":
        positionFilter = "x=W-w:y=0";
        break;
      case "bottomRight":
        positionFilter = "x=W-w:y=H-h";
        break;
      case "bottomLeft":
      default:
        positionFilter = "x=0:y=H-h";
        break;
    }

    // 🧠 Correct filter syntax for ffmpeg
    // - [0:v] = first input (background)
    // - [1:v] = second input (overlay)
    // - scale filter applied to overlay before compositing
    const command = `
      ffmpeg -y -i "${backgroundPath}" -i "${overlayPath}" \
      -filter_complex "[1:v]scale=iw*${overlayWidth}:-1[overlay_scaled];[0:v][overlay_scaled]overlay=${positionFilter}" \
      -c:a copy "${outputPath}"
    `;

    console.log("Running command:", command);
    const { stderr } = await execPromise(command);
    if (stderr) console.log("FFmpeg stderr:", stderr);

    // Return video as base64 for debugging or upload to storage
    const videoBuffer = fs.readFileSync(outputPath);

    res.setHeader("Content-Type", "video/mp4");
    res.status(200).send(videoBuffer);

    // Clean up
    fs.unlinkSync(backgroundPath);
    fs.unlinkSync(overlayPath);
    fs.unlinkSync(outputPath);

  } catch (error) {
    console.error("FFmpeg error:", error);
    res.status(500).json({ error: error.message });
  }
}

