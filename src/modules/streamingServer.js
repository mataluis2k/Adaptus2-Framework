const express = require("express");
const multer = require("multer");
const AWS = require("aws-sdk");
const fs = require("fs");
const path = require("path");
const mime = require("mime-types");
const ffmpeg = require("fluent-ffmpeg");
const redis = require("redis");
const { promisify } = require("util");

// Configure ffmpeg and ffprobe
ffmpeg.setFfmpegPath(require("@ffmpeg-installer/ffmpeg").path);
ffmpeg.setFfprobePath(require("@ffprobe-installer/ffprobe").path);

// Environment variables for paths
const LOCAL_VIDEO_PATH = process.env.LOCAL_VIDEO_PATH;
const S3_BUCKET_NAME = process.env.S3_BUCKET_NAME;

// Redis client configuration
const redisClient = redis.createClient();
const getAsync = promisify(redisClient.get).bind(redisClient);
const setAsync = promisify(redisClient.set).bind(redisClient);

class StreamingServer {
    constructor(app, s3Config, db) {
        this.app = app;
        this.db = db; // Database instance for video catalog
        this.s3 = new AWS.S3({
            accessKeyId: s3Config.accessKeyId,
            secretAccessKey: s3Config.secretAccessKey,
            region: s3Config.region,
        });
    }

    async getVideoById(videoID) {
        // Attempt to get video details from cache first
        let video = await getAsync(videoID);
        if (video) {
            return JSON.parse(video);
        }

        // If not in cache, query the database
        video = await this.db.query('SELECT * FROM video_catalog WHERE videoID = ?', [videoID]);
        if (video.length > 0) {
            // Cache the video data for future requests
            await setAsync(videoID, JSON.stringify(video[0]), 'EX', 3600); // Cache for 1 hour
            return video[0];
        }
        return null;
    }

    streamFromFileSystem(req, res, filePath) {
        fs.stat(filePath, (err, stats) => {
            if (err) {
                return res.status(404).send("File not found");
            }

            const range = req.headers.range;
            if (!range) {
                return res.status(416).send("Requires Range header");
            }

            const CHUNK_SIZE = 10 ** 6; // 1MB
            const start = Number(range.replace(/\D/g, ""));
            const end = Math.min(start + CHUNK_SIZE, stats.size - 1);

            res.writeHead(206, {
                "Content-Range": `bytes ${start}-${end}/${stats.size}`,
                "Accept-Ranges": "bytes",
                "Content-Length": end - start + 1,
                "Content-Type": mime.lookup(filePath) || "video/mp4",
            });

            const stream = fs.createReadStream(filePath, { start, end });
            stream.pipe(res);
        });
    }

    async streamFromS3(req, res, bucket, key) {
        const params = {
            Bucket: bucket,
            Key: key,
        };

        try {
            const data = await this.s3.headObject(params).promise();
            const range = req.headers.range;

            if (!range) {
                return res.status(416).send("Requires Range header");
            }

            const CHUNK_SIZE = 10 ** 6; // 1MB
            const start = Number(range.replace(/\D/g, ""));
            const end = Math.min(start + CHUNK_SIZE, data.ContentLength - 1);

            res.writeHead(206, {
                "Content-Range": `bytes ${start}-${end}/${data.ContentLength}`,
                "Accept-Ranges": "bytes",
                "Content-Length": end - start + 1,
                "Content-Type": mime.lookup(key) || "video/mp4",
            });

            const stream = this.s3
                .getObject({
                    ...params,
                    Range: `bytes=${start}-${end}`,
                })
                .createReadStream();

            stream.pipe(res);
        } catch (err) {
            console.error("Error streaming from S3:", err.message);
            res.status(500).send("Internal Server Error");
        }
    }

    async generateHLS(req, res, sourcePath) {
        const cacheKey = `hls:${sourcePath}`;
        let cachedPlaylist = await getAsync(cacheKey);

        if (cachedPlaylist) {
            return res.json({ message: "HLS playlist served from cache", playlist: cachedPlaylist });
        }

        const outputDir = path.join(__dirname, "hls_output");
        const outputFile = path.join(outputDir, "playlist.m3u8");

        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        ffmpeg(sourcePath)
            .outputOptions([
                "-preset veryfast",
                "-g 48",
                "-sc_threshold 0",
                "-map 0:0",
                "-map 0:1",
                "-c:v libx264",
                "-c:a aac",
                "-b:v:0 800k",
                "-maxrate:v:0 856k",
                "-bufsize:v:0 1200k",
                "-b:a 96k",
                "-hls_time 6",
                "-hls_playlist_type vod",
                `-hls_segment_filename ${outputDir}/segment_%03d.ts`,
            ])
            .output(outputFile)
            .on("end", async () => {
                console.log("HLS conversion complete");
                await setAsync(cacheKey, "/hls/playlist.m3u8", 'EX', 3600); // Cache for 1 hour
                res.json({ message: "HLS playlist generated", playlist: "/hls/playlist.m3u8" });
            })
            .on("error", (err) => {
                console.error("Error during HLS generation:", err.message);
                res.status(500).send("Error generating HLS");
            })
            .run();
    }

    registerRoutes() {
        // Stream video by ID
        this.app.get("/stream/:videoID", async (req, res) => {
            const { videoID } = req.params;
            const video = await this.getVideoById(videoID);
            if (!video) return res.status(404).send("Video not found");

            if (video.Source === "local") {
                const filePath = path.join(LOCAL_VIDEO_PATH, video.filename);
                this.streamFromFileSystem(req, res, filePath);
            } else if (video.Source === "S3") {
                this.streamFromS3(req, res, S3_BUCKET_NAME, video.filename);
            } else {
                res.status(400).send("Invalid video source");
            }
        });

        // Generate HLS from video ID
        this.app.get("/hls/generate/:videoID", async (req, res) => {
            const { videoID } = req.params;
            const video = await this.getVideoById(videoID);
            if (!video) return res.status(404).send("Video not found");

            if (video.Source === "local") {
                const filePath = path.join(LOCAL_VIDEO_PATH, video.filename);
                this.generateHLS(req, res, filePath);
            } else if (video.Source === "S3") {
                res.status(400).send("HLS generation from S3 is not supported yet");
            } else {
                res.status(400).send("Invalid video source");
            }
        });

        // Serve HLS playlist and segments
        this.app.use("/hls", express.static(path.join(__dirname, "hls_output")));
    }
}

module.exports = StreamingServer;
