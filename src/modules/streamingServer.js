const express = require("express");
const AWS = require("aws-sdk");
const ffmpeg = require("fluent-ffmpeg");
const { promisify } = require("util");
const { getDbConnection , query } = require("./db");
const mime = require("mime-types");
const path = require("path");
const fs = require("fs");
const Redis = require("ioredis");
const consolelog = require('./logger');

// Configure ffmpeg and ffprobe
ffmpeg.setFfmpegPath(require("@ffmpeg-installer/ffmpeg").path);
ffmpeg.setFfprobePath(require("@ffprobe-installer/ffprobe").path);

// Redis client configuration
consolelog.log("hls_output: ",path.join(__dirname, "hls_output"));
const configDir = process.env.CONFIG_DIR || path.join(process.cwd(), 'config');

const ffmpegConfigPath = path.join(configDir, 'ffmpeg_profiles.json');
const ffmpegProfiles = JSON.parse(fs.readFileSync(ffmpegConfigPath, 'utf8'));

// Read desired profile from environment variable, default to "mediumBandwidth"
const selectedProfileName = process.env.FFMPEG_PROFILE || "mediumBandwidth";
const selectedProfile = ffmpegProfiles[selectedProfileName];

if (!selectedProfile) {
  console.warn(`Selected profile "${selectedProfileName}" not found. Using "mediumBandwidth" as default.`);
}

function profileToOutputOptions(profile) {
    const options = [];
    for (const key in profile) {
      if (profile.hasOwnProperty(key)) {
        options.push(`-${key}`, profile[key]);
      }
    }
    return options;
  }
  
const ffmpegOptions = profileToOutputOptions(selectedProfile || ffmpegProfiles["mediumBandwidth"]);

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

const getAsync = async (cacheKey) => {
    return await redis.get(cacheKey);
};
/* Set Async function  params: cacheKey, data, ttl */
const setAsync = async (cacheKey, data, ttl) => {
    return await redis.setex(cacheKey, ttl, JSON.stringify(data));
};

class StreamingServer {
    constructor(app, s3Config) {
        this.app = app;
        this.s3 = new AWS.S3({
            accessKeyId: s3Config.accessKeyId,
            secretAccessKey: s3Config.secretAccessKey,
            region: s3Config.region,
        });
    }

    async generateBulkHLS() {
            const dbType = process.env.STREAMING_DBTYPE || "mysql";
            const dbConnection = process.env.DBSTREAMING_DBCONNECTION || "MYSQL_1";

            const config = { 'dbType': dbType, 'dbConnection': dbConnection } ;            
            // If not in cache, query the database
            const video = query(config,'SELECT * FROM video_catalog WHERE hls is null', []);
            if (video.length > 0) {
                video.forEach(element => {
                    consolelog.log("Video: ",element);
                    // call the function that will generate the hls
                    // need to create a fake http request and response object
                    const req = { params: { videoID: element.videoID } };
                    const res = { json: (data) => console.log(data) };
                    this.generateHls(req, res , element.videoID, element.videoPath);
                });
            }
            return null;
    }

    async getVideoById(videoID) {
        // Attempt to get video details from cache first
        var video = await getAsync(videoID);
        if (video) {
            return JSON.parse(video);
        }
        
        const dbType = process.env.STREAMING_DBTYPE || "mysql";
        const dbConnection = process.env.DBSTREAMING_DBCONNECTION || "MYSQL_1";
        
        // If not in cache, query the database
        video = await query({ dbType, dbConnection },'SELECT * FROM video_catalog WHERE videoID = ?', [videoID]);
        if (video.length > 0) {
            // Cache the video data for future requests
            //await setAsync(videoID, JSON.stringify(video[0]), 'EX', 3600); // Cache for 1 hour
            consolelog.log("Video: ",video[0]);
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

    async generateHLS(req, res, sourcePath, videoID) {
        const outputDir = path.join(__dirname, "hls_output", videoID);
        const outputFile = path.join(outputDir, "playlist.m3u8");

        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const cacheKey = `hls:${videoID}`;
        const cachedPlaylist = await getAsync(cacheKey);
        const link = `/hls/${videoID}/playlist.m3u8`;

        if (cachedPlaylist) {
            return res.json({
                message: "HLS playlist served from cache",
                playlist: link,
            });
        }

        ffmpeg(sourcePath)
            .outputOptions(ffmpegOptions.concat([
                `-hls_segment_filename ${outputDir}/segment_%03d.ts`               
              ]))
            .output(outputFile)
            .on("end", async () => {
                consolelog.log("HLS conversion complete");
                await setAsync(cacheKey, link, 3600); // Cache for 1 hour
                res.json({
                    message: "HLS playlist generated",
                    playlist: link,
                });
            })
            .on("error", (err) => {
                console.error("Error during HLS generation:", err.message);
                res.status(500).send("Error generating HLS");
            })
            .run();
    }


    registerRoutes() {
        // Stream video by ID
        const LOCAL_VIDEO_PATH = process.env.STREAMING_FILESYSTEM_PATH || "./videos";
        this.app.get("/stream/:videoID", async (req, res) => {
            const { videoID } = req.params;
            const video = await this.getVideoById(videoID);
            if (!video) return res.status(404).send("Video not found");

            if (video.source === "local") {
                const filePath = path.join(LOCAL_VIDEO_PATH, video.filename);
                this.streamFromFileSystem(req, res, filePath);
            } else if (video.Source === "S3") {
                this.streamFromS3(req, res, S3_BUCKET_NAME, video.filename);
            } else {
                res.status(400).send("Invalid video source");
            }
        });

            // Generate or Retrieve HLS from video ID
        this.app.get("/hls/generate/:videoID", async (req, res) => {
            const { videoID } = req.params;

            try {
                const video = await this.getVideoById(videoID);

                if (!video) {
                    return res.status(404).send("Video not found");
                }

                // If the HLS field is not null, return the existing playlist
                if (video.hls) {
                    return res.json({
                        message: "HLS playlist",
                        playlist: video.hls, // Assuming this contains the path to the playlist
                    });
                }

                // If the HLS field is null, generate the playlist
                if (video.source === "local") {
                    const filePath = path.join(LOCAL_VIDEO_PATH, video.filename);

                    // Generate HLS and update the database with the new playlist path
                    this.generateHLS(req, res, filePath, videoID);
                } else {
                    res.status(400).send("HLS generation is only supported for local files");
                }
            } catch (err) {
                console.error("Error handling HLS generation:", err.message);
                res.status(500).send("Internal Server Error");
            }
        });

        const cors = require('cors'); // Import the cors middleware
        // Serve HLS playlist and segments
        this.app.use("/hls", cors(),express.static(path.join(__dirname, "hls_output")));
    }
}

module.exports = StreamingServer;
