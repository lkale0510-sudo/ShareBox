const fileMeta = document.querySelector("#fileMeta");
const form = document.querySelector("#downloadForm");
const passwordInput = document.querySelector("#password");
const downloadButton = document.querySelector("#downloadButton");
const message = document.querySelector("#message");
const fileId = window.location.pathname.split("/").filter(Boolean).pop();

let currentFileName = "download";

function setMessage(text, type = "") {
  message.textContent = text;
  message.className = `message ${type}`.trim();
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function filenameFromDisposition(header) {
  if (!header) return currentFileName;
  const match = header.match(/filename="?([^"]+)"?/i);
  return match ? decodeURIComponent(match[1]) : currentFileName;
}

async function loadFileDetails() {
  try {
    const response = await fetch(`/api/files/${fileId}`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || "Could not load this link.");
    }

    currentFileName = data.file.originalName;
    fileMeta.textContent = `${data.file.originalName} - ${formatBytes(
      data.file.size
    )} - expires ${new Date(data.file.expiresAt).toLocaleString()}`;
  } catch (error) {
    fileMeta.textContent = error.message;
    form.classList.add("hidden");
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage("");

  downloadButton.disabled = true;
  downloadButton.textContent = "Checking...";

  try {
    const response = await fetch(`/api/files/${fileId}/download`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: passwordInput.value })
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.message || "Download failed.");
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filenameFromDisposition(response.headers.get("Content-Disposition"));
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setMessage("Download started.", "success");
  } catch (error) {
    setMessage(error.message, "error");
  } finally {
    downloadButton.disabled = false;
    downloadButton.textContent = "Unlock Download";
  }
});

loadFileDetails();
