const form = document.querySelector("#uploadForm");
const fileInput = document.querySelector("#fileInput");
const fileLabel = document.querySelector("#fileLabel");
const expirySelect = document.querySelector("#expiryHours");
const customExpiryWrap = document.querySelector("#customExpiryWrap");
const customExpiry = document.querySelector("#customExpiry");
const message = document.querySelector("#message");
const result = document.querySelector("#result");
const downloadLink = document.querySelector("#downloadLink");
const copyButton = document.querySelector("#copyButton");
const expiryText = document.querySelector("#expiryText");
const uploadButton = document.querySelector("#uploadButton");

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

fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  fileLabel.textContent = file ? `${file.name} (${formatBytes(file.size)})` : "Upload Files";
});

expirySelect.addEventListener("change", () => {
  const isCustom = expirySelect.value === "custom";
  customExpiryWrap.classList.toggle("hidden", !isCustom);
  customExpiry.required = isCustom;
});

copyButton.addEventListener("click", async () => {
  await navigator.clipboard.writeText(downloadLink.value);
  setMessage("Link copied to clipboard.", "success");
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  result.classList.add("hidden");
  setMessage("");

  const file = fileInput.files[0];
  const password = document.querySelector("#password").value;
  const expiryHours =
    expirySelect.value === "custom" ? customExpiry.value : expirySelect.value;

  if (!file) {
    setMessage("Please choose a file.", "error");
    return;
  }

  if (password.length < 4) {
    setMessage("Password must be at least 4 characters.", "error");
    return;
  }

  if (!expiryHours || Number(expiryHours) < 1 || Number(expiryHours) > 168) {
    setMessage("Expiry must be between 1 hour and 7 days.", "error");
    return;
  }

  const formData = new FormData();
  formData.append("file", file);
  formData.append("password", password);
  formData.append("expiryHours", expiryHours);

  uploadButton.disabled = true;
  uploadButton.textContent = "Uploading...";

  try {
    const response = await fetch("/api/files", {
      method: "POST",
      body: formData
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || "Upload failed.");
    }

    form.reset();
    fileLabel.textContent = "Upload Files";
    customExpiryWrap.classList.add("hidden");
    customExpiry.required = false;
    downloadLink.value = data.downloadUrl;
    expiryText.textContent = `Expires ${new Date(data.file.expiresAt).toLocaleString()}.`;
    result.classList.remove("hidden");
    setMessage("Upload complete.", "success");
  } catch (error) {
    setMessage(error.message, "error");
  } finally {
    uploadButton.disabled = false;
    uploadButton.textContent = "Create Secure Link";
  }
});
