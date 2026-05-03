require("dotenv").config();

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const mongoose = require("mongoose");
const multer = require("multer");

const app = express();

const PORT = Number(process.env.PORT || 3000);
const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/secure-file-sharing";
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(
  /\/$/,
  ""
);
const MAX_FILE_SIZE_MB = Number(process.env.MAX_FILE_SIZE_MB || 25);
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const UPLOAD_DIR = path.join(__dirname, "uploads");

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

mongoose
  .connect(MONGODB_URI)
  .then(() => console.log("Connected to MongoDB"))
  .catch((error) => {
    console.error("MongoDB connection error:", error.message);
    process.exit(1);
  });

const fileSchema = new mongoose.Schema(
  {
    originalName: { type: String, required: true },
    storedName: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    downloadId: { type: String, required: true, unique: true, index: true },
    passwordHash: { type: String, required: true },
    expiresAt: { type: Date, required: true, index: true },
    downloads: { type: Number, default: 0 }
  },
  { timestamps: true }
);

const SharedFile = mongoose.model("SharedFile", fileSchema);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).slice(0, 20);
    cb(null, `${Date.now()}-${crypto.randomBytes(16).toString("hex")}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!file.originalname || file.originalname.length > 255) {
      return cb(new Error("Invalid file name."));
    }
    cb(null, true);
  }
});

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", "data:"]
      }
    }
  })
);
app.use(express.json({ limit: "20kb" }));
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 150,
    standardHeaders: true,
    legacyHeaders: false
  })
);
app.use(express.static(path.join(__dirname, "public")));

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function removeUpload(storedName) {
  const target = path.join(UPLOAD_DIR, path.basename(storedName));
  fs.promises.unlink(target).catch(() => {});
}

function publicFileData(file) {
  return {
    id: file.downloadId,
    originalName: file.originalName,
    size: file.size,
    mimeType: file.mimeType,
    expiresAt: file.expiresAt
  };
}

app.post(
  "/api/files",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ message: "Please choose a file to upload." });
    }

    const password = String(req.body.password || "");
    const expiryHours = Number(req.body.expiryHours || 24);

    if (password.length < 4 || password.length > 100) {
      removeUpload(req.file.filename);
      return res
        .status(400)
        .json({ message: "Password must be between 4 and 100 characters." });
    }

    if (!Number.isFinite(expiryHours) || expiryHours < 1 || expiryHours > 168) {
      removeUpload(req.file.filename);
      return res
        .status(400)
        .json({ message: "Expiry must be between 1 hour and 7 days." });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const downloadId = crypto.randomBytes(24).toString("hex");
    const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000);

    const file = await SharedFile.create({
      originalName: path.basename(req.file.originalname),
      storedName: req.file.filename,
      mimeType: req.file.mimetype || "application/octet-stream",
      size: req.file.size,
      downloadId,
      passwordHash,
      expiresAt
    });

    res.status(201).json({
      message: "File uploaded successfully.",
      file: publicFileData(file),
      downloadUrl: `${BASE_URL}/download/${downloadId}`
    });
  })
);

app.get(
  "/api/files/:id",
  asyncHandler(async (req, res) => {
    const file = await SharedFile.findOne({ downloadId: req.params.id });

    if (!file) {
      return res.status(404).json({ message: "File link was not found." });
    }

    if (file.expiresAt <= new Date()) {
      removeUpload(file.storedName);
      await file.deleteOne();
      return res.status(410).json({ message: "This file link has expired." });
    }

    res.json({ file: publicFileData(file) });
  })
);

app.post(
  "/api/files/:id/download",
  asyncHandler(async (req, res) => {
    const password = String(req.body.password || "");

    if (!password) {
      return res.status(400).json({ message: "Password is required." });
    }

    const file = await SharedFile.findOne({ downloadId: req.params.id });

    if (!file) {
      return res.status(404).json({ message: "File link was not found." });
    }

    if (file.expiresAt <= new Date()) {
      removeUpload(file.storedName);
      await file.deleteOne();
      return res.status(410).json({ message: "This file link has expired." });
    }

    const isValidPassword = await bcrypt.compare(password, file.passwordHash);
    if (!isValidPassword) {
      return res.status(401).json({ message: "Incorrect password." });
    }

    const filePath = path.join(UPLOAD_DIR, path.basename(file.storedName));

    if (!fs.existsSync(filePath)) {
      await file.deleteOne();
      return res.status(404).json({ message: "Stored file is missing." });
    }

    file.downloads += 1;
    await file.save();

    res.download(filePath, file.originalName);
  })
);

app.get("/download/:id", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "download.html"));
});

app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    return res
      .status(413)
      .json({ message: `File is too large. Max size is ${MAX_FILE_SIZE_MB} MB.` });
  }

  console.error(error);
  res.status(500).json({ message: error.message || "Something went wrong." });
});

async function cleanupExpiredFiles() {
  const expiredFiles = await SharedFile.find({ expiresAt: { $lte: new Date() } });
  await Promise.all(
    expiredFiles.map(async (file) => {
      removeUpload(file.storedName);
      await file.deleteOne();
    })
  );
}

setInterval(() => {
  cleanupExpiredFiles().catch((error) =>
    console.error("Expired file cleanup failed:", error.message)
  );
}, 60 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`Secure file sharing app running at ${BASE_URL}`);
});
