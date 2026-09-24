// Netlify Function: handles owner photo uploads.
// Verifies a shared password, then commits the photo + updates content/gallery.json
// directly in the GitHub repo using a stored Personal Access Token.

const GITHUB_OWNER = "ogbonnavictor103-bot";
const GITHUB_REPO = "perfect-furniture-website";
const BRANCH = "main";
const API = "https://api.github.com";

async function ghRequest(path, options) {
  const res = await fetch(API + path, {
    ...options,
    headers: {
      "Authorization": "Bearer " + process.env.GITHUB_TOKEN,
      "Accept": "application/vnd.github+json",
      "Content-Type": "application/json",
      ...(options && options.headers ? options.headers : {})
    }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error("GitHub API error " + res.status + ": " + JSON.stringify(data));
  }
  return data;
}

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid request body" }) };
  }

  const { password, imageBase64, mimeType, caption, category, videoLink } = body;

  if (!password || password !== process.env.ADMIN_KEY) {
    return { statusCode: 401, body: JSON.stringify({ error: "Wrong password" }) };
  }
  if (!imageBase64 || !caption || !category) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing photo, name, or category" }) };
  }

  try {
    // 1. Build a unique filename for the new image
    const ext = (mimeType && mimeType.includes("png")) ? "png" : "jpg";
    const safeName = caption.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const filename = "gallery-" + safeName + "-" + Date.now() + "." + ext;
    const imagePath = "images/uploads/" + filename;

    // 2. Upload the image file to GitHub
    await ghRequest("/repos/" + GITHUB_OWNER + "/" + GITHUB_REPO + "/contents/" + imagePath, {
      method: "PUT",
      body: JSON.stringify({
        message: "Add new product photo: " + caption,
        content: imageBase64,
        branch: BRANCH
      })
    });

    // 3. Fetch the current gallery.json (need its sha to update it)
    const galleryPath = "content/gallery.json";
    const current = await ghRequest("/repos/" + GITHUB_OWNER + "/" + GITHUB_REPO + "/contents/" + galleryPath + "?ref=" + BRANCH, {
      method: "GET"
    });
    const currentContent = JSON.parse(Buffer.from(current.content, "base64").toString("utf-8"));
    const items = currentContent.items || [];

    // 4. Add the new item
    items.push({
      image: "/" + imagePath,
      caption: caption,
      category: category,
      video_link: videoLink || ""
    });

    const updatedJson = JSON.stringify({ items: items }, null, 2);
    const updatedBase64 = Buffer.from(updatedJson, "utf-8").toString("base64");

    // 5. Commit the updated gallery.json
    await ghRequest("/repos/" + GITHUB_OWNER + "/" + GITHUB_REPO + "/contents/" + galleryPath, {
      method: "PUT",
      body: JSON.stringify({
        message: "Add gallery entry: " + caption,
        content: updatedBase64,
        sha: current.sha,
        branch: BRANCH
      })
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, message: "Photo added! It will appear on the site in about a minute." })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
